#!/usr/bin/env node
// PageCapture E2E automation script — uses the official UsableNet AQAPageCapture
// Playwright plugin to capture click-state flows and upload ZIPs directly to AQA.
//
// Unlike the old pagecapture.mjs which used DevTools keyboard shortcuts and manual
// ZIP export, this script uses chrome.runtime.sendMessage via externally_connectable.
//
// Usage:
//   node <skill-dir>/scripts/pagecapture-e2e.mjs <journey.yaml> \
//     [--suite <suiteId>] [--out <dir>] [--dry-run]
//
// Env required: AQA_TEAMSLUG, AQA_API_KEY
// Env optional: AQA_SUITE_ID (fallback for --suite)

import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parse as yamlParse } from './yaml-lite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', 'AQAPageCapture', 'extension');
const PLUGIN_LOADER = resolve(__dirname, '..', 'AQAPageCapture', 'plugin-loader.cjs');

// ────────────────────────────────────────────────────────────────────────────
// Env + args
// ────────────────────────────────────────────────────────────────────────────

const args = parseArgv(process.argv.slice(2));
const journeyPath = args._[0];

if (!journeyPath || args.help) {
  console.error(`Usage: pagecapture-e2e.mjs <journey.yaml> [--suite <id>] [--dry-run]

Captures click-state page flows using the official AQAPageCapture plugin
and uploads them directly to AQA. No manual ZIP drag-drop needed.

Env: AQA_TEAMSLUG, AQA_API_KEY required.
     AQA_SUITE_ID optional (fallback for --suite).
`);
  process.exit(journeyPath ? 0 : 1);
}

const teamSlug = requireEnv('AQA_TEAMSLUG');
const apiKey = requireEnv('AQA_API_KEY');
const suiteId = args.suite || process.env.AQA_SUITE_ID;
const dryRun = !!args['dry-run'];

if (!suiteId) {
  console.error('Error: --suite <id> or AQA_SUITE_ID env var required');
  process.exit(2);
}

// ────────────────────────────────────────────────────────────────────────────
// Load journey
// ────────────────────────────────────────────────────────────────────────────

const journeyText = await readFile(resolve(journeyPath), 'utf8');
const journey = yamlParse(journeyText);

if (!journey.name) {
  console.error('Error: journey YAML must have a "name" field');
  process.exit(2);
}
if (!journey.steps || !journey.steps.length) {
  console.error('Error: journey YAML must have at least one step');
  process.exit(2);
}

console.log(`\n🚀 PageCapture E2E: ${journey.name}`);
console.log(`   Suite: ${suiteId} | Team: ${teamSlug}`);
console.log(`   Steps: ${journey.steps.length}`);
if (dryRun) console.log('   MODE: DRY RUN (no upload)');
console.log('');

// ────────────────────────────────────────────────────────────────────────────
// Launch browser with extension
// ────────────────────────────────────────────────────────────────────────────

const context = await chromium.launchPersistentContext('', {
  headless: false,
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
  ],
  viewport: journey.device?.viewport || { width: 1440, height: 900 },
});

// Use the first page from the persistent context — this is the active tab.
// The extension uses chrome.tabs.query({active:true, currentWindow:true}) to find
// which tab to snapshot. Creating a new page can cause the wrong tab to be active.
const page = context.pages()[0] || await context.newPage();

// Close any extra pages that might steal focus
for (const p of context.pages()) {
  if (p !== page) await p.close();
}
await page.bringToFront();
console.log(`Using page: ${page.url()} (tabs: ${context.pages().length})`);

// Load the official plugin via CJS wrapper (UMD module needs `this` context)
const require = createRequire(import.meta.url);
const AQAPageCapturePlugin = require(PLUGIN_LOADER);

// Init the plugin
let aqaPageCapture;
try {
  aqaPageCapture = await AQAPageCapturePlugin.init(page, {
    suite: suiteId,
    team: teamSlug,
    xTeam: apiKey,
  });
  console.log('✓ AQAPageCapture plugin initialized');
} catch (err) {
  console.error('✗ Failed to initialize AQAPageCapture plugin:', err.message);
  await context.close();
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────────────
// Execute journey steps
// ────────────────────────────────────────────────────────────────────────────

let flowCreated = false;
let snapshotCount = 0;

for (const [i, step] of journey.steps.entries()) {
  const label = `[${i + 1}/${journey.steps.length}]`;
  const timeout = step.timeoutMs || journey.defaults?.stepTimeoutMs || 15000;

  try {
    switch (step.type) {
      case 'goto':
        console.log(`${label} goto ${step.url}`);
        await page.goto(interpolateEnv(step.url), { waitUntil: 'domcontentloaded', timeout });
        // Wait for network resources so the plugin's interceptor captures fonts/images
        await page.waitForLoadState('networkidle').catch(() => {});
        break;

      case 'click':
        console.log(`${label} click "${step.selector}"`);
        await page.locator(step.selector).click({ timeout });
        break;

      case 'hover':
        console.log(`${label} hover "${step.selector}"`);
        await page.locator(step.selector).hover({ timeout });
        break;

      case 'fill':
        console.log(`${label} fill "${step.selector}"`);
        await page.locator(step.selector).fill(interpolateEnv(step.value), { timeout });
        break;

      case 'waitFor':
        if (step.selector) {
          console.log(`${label} waitFor "${step.selector}"`);
          await page.locator(step.selector).waitFor({ timeout });
        } else if (step.networkIdle) {
          console.log(`${label} waitFor networkIdle`);
          await page.waitForLoadState('networkidle', { timeout });
        } else {
          console.log(`${label} waitFor ${step.timeout || 2000}ms`);
          await page.waitForTimeout(step.timeout || 2000);
        }
        break;

      case 'createFlow':
        // Sanitize flow name: forward slashes break AQA's ZIP extraction on their server
        const flowName = journey.name.replace(/\//g, '-');
        console.log(`${label} createFlow "${flowName}"`);
        await page.bringToFront();
        await aqaPageCapture.createFlow({
          name: flowName,
          description: step.description || journey.description || '',
        });
        flowCreated = true;
        // Settle time for extension to register the flow
        await page.waitForTimeout(3000);
        break;

      case 'snapshot':
        console.log(`${label} snapshot "${step.label}" (page URL: ${page.url()})`);
        // Ensure this tab is the "active" tab — the extension uses
        // chrome.tabs.query({active:true, currentWindow:true}) to find target
        await page.bringToFront();
        // Ensure page is settled before capturing
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(2000);
        await aqaPageCapture.doSnapshot(step.label);
        snapshotCount++;
        // Post-snapshot settling time for extension to process
        await page.waitForTimeout(3000);
        break;

      case 'press':
        console.log(`${label} press "${step.key}"`);
        await page.keyboard.press(step.key);
        break;

      default:
        console.warn(`${label} ⚠ Unknown step type: ${step.type}`);
    }

    // Post-step wait
    if (step.waitAfter) {
      await page.waitForTimeout(step.waitAfter);
    }
  } catch (err) {
    if (step.optional) {
      console.warn(`${label} ⚠ Optional step failed: ${err.message}`);
    } else {
      console.error(`${label} ✗ Step failed: ${err.message}`);
      await context.close();
      process.exit(1);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Upload
// ────────────────────────────────────────────────────────────────────────────

if (!flowCreated) {
  console.error('✗ No createFlow step found in journey — nothing to upload');
  await context.close();
  process.exit(1);
}

if (snapshotCount === 0) {
  console.error('✗ No snapshots taken — nothing to upload');
  await context.close();
  process.exit(1);
}

if (dryRun) {
  console.log(`\n✓ DRY RUN complete: ${snapshotCount} snapshots captured, upload skipped`);
} else {
  console.log(`\nUploading ZIP to AQA (${snapshotCount} snapshots)...`);
  try {
    await aqaPageCapture.uploadZip();
    console.log('✓ ZIP uploaded successfully to AQA');
  } catch (err) {
    console.error('✗ Upload failed:', err.message);
    await context.close();
    process.exit(1);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Output summary
// ────────────────────────────────────────────────────────────────────────────

console.log(`
Summary:
  Journey:   ${journey.name}
  Suite:     ${suiteId}
  Snapshots: ${snapshotCount}
  Uploaded:  ${dryRun ? 'NO (dry run)' : 'YES'}
`);

await context.close();
process.exit(0);

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function interpolateEnv(str) {
  if (!str) return str;
  return str.replace(/\$\{(\w+)\}/g, (_, name) => {
    const val = process.env[name];
    if (val === undefined) throw new Error(`missing env var: ${name}`);
    return val;
  });
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Error: ${name} is required in environment`);
    process.exit(2);
  }
  return v;
}

function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else {
      out._.push(tok);
    }
  }
  return out;
}
