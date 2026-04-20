#!/usr/bin/env node
// Drives the UsableNet PageCapture extension through a journey YAML and emits
// a ZIP bundle to `out/<journey-name>.zip`.
//
// Why we keep this out of the Skill: the extension's keyboard-shortcut
// dispatch and DevTools-panel export dance are finicky enough that a real
// Playwright launcher is simpler than coaxing the model through it each run.
//
// Usage: node scripts/pagecapture.mjs <journey.yaml> [--out <dir>] [--extension <path>]
//
// Prereqs:
//   - `npm i` has run (installs playwright + js-yaml)
//   - `pagecapture_src/` is present in the repo (extension source)
//   - A display is available — the extension does not work reliably headless.

import { readFile, rename, mkdir, mkdtemp, readdir, stat } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import yaml from 'js-yaml';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const args = parseArgv(process.argv.slice(2));
if (!args._[0] || args.help) {
  process.stderr.write(
    `pagecapture.mjs <journey.yaml> [--out <dir>] [--extension <path>] [--capture-wait-ms 2000]\n`,
  );
  process.exit(args._[0] ? 0 : 1);
}

const journeyPath = resolve(args._[0]);
const outDir      = resolve(args.out       || join(REPO_ROOT, 'out'));
const extPath     = resolve(args.extension || join(REPO_ROOT, 'pagecapture_src'));
const captureWait = Number(args['capture-wait-ms'] || 2000);

if (!existsSync(extPath))     die(`extension not found at ${extPath}`);
if (!existsSync(journeyPath)) die(`journey not found at ${journeyPath}`);

const journey = interpolate(yaml.load(await readFile(journeyPath, 'utf8')), process.env);
if (!journey?.name || !Array.isArray(journey.steps)) die(`invalid journey: missing name or steps`);

await mkdir(outDir, { recursive: true });
const userDataDir = await mkdtemp(join(tmpdir(), 'aqa-pc-'));
const downloadsDir = join(homedir(), 'Downloads');
const downloadsBefore = new Set(existsSync(downloadsDir) ? await readdir(downloadsDir) : []);

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: journey.device?.viewport ?? { width: 1440, height: 900 },
  userAgent: journey.device?.userAgent === 'default' ? undefined : journey.device?.userAgent,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--auto-open-devtools-for-tabs',
  ],
});

const page = context.pages()[0] ?? (await context.newPage());

try {
  await runJourney(page, journey);
  const zip = await waitForZip(downloadsDir, downloadsBefore, 60_000);
  if (zip) {
    const dest = join(outDir, `${journey.name}-${timestamp()}.zip`);
    await rename(join(downloadsDir, zip), dest);
    log(`✓ ZIP moved to ${dest}`);
  } else {
    log(`⚠ no ZIP appeared in ${downloadsDir} within 60s.`);
    log(`  open the PageCapture DevTools panel and click Export, then move the ZIP to ${outDir}.`);
  }
} finally {
  await context.close();
}

// ────────────────────────────────────────────────────────────────────────────
// Journey runner
// ────────────────────────────────────────────────────────────────────────────

async function runJourney(page, j) {
  const timeout = j.defaults?.stepTimeoutMs ?? 15_000;
  for (const [i, step] of j.steps.entries()) {
    const label = `[${i + 1}/${j.steps.length} ${step.type}${step.label ? ' ' + step.label : ''}]`;
    try {
      await runStep(page, step, timeout);
      log(`${label} ok`);
    } catch (err) {
      if (step.optional) log(`${label} skipped (${err.message})`);
      else throw new Error(`${label} failed: ${err.message}`);
    }
  }
}

async function runStep(page, step, timeout) {
  switch (step.type) {
    case 'goto':
      await page.goto(step.url, { timeout, waitUntil: 'domcontentloaded' });
      return;
    case 'click':
      await page.locator(step.selector).first().click({ timeout });
      return;
    case 'hover':
      await page.locator(step.selector).first().hover({ timeout });
      return;
    case 'fill':
      await page.locator(step.selector).first().fill(String(step.value ?? ''), { timeout });
      return;
    case 'waitFor':
      if (step.selector) await page.locator(step.selector).first().waitFor({ timeout });
      else if (step.networkIdle) await page.waitForLoadState('networkidle', { timeout });
      else if (step.timeout) await page.waitForTimeout(Number(step.timeout));
      return;
    case 'snapshot':
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+S' : 'Control+Shift+S');
      await page.waitForTimeout(captureWait);
      return;
    default:
      throw new Error(`unknown step type: ${step.type}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ZIP detection
// ────────────────────────────────────────────────────────────────────────────

async function waitForZip(dir, before, timeoutMs) {
  if (!existsSync(dir)) return null;
  const deadline = Date.now() + timeoutMs;
  // Poll — fs.watch is unreliable across platforms for Downloads, especially
  // while browsers are writing .crdownload temp files.
  while (Date.now() < deadline) {
    const now = await readdir(dir);
    const candidates = now.filter(
      (f) => !before.has(f) && f.endsWith('.zip') && !f.endsWith('.crdownload'),
    );
    if (candidates.length) {
      // Pick the most recent.
      const stats = await Promise.all(
        candidates.map(async (f) => ({ f, m: (await stat(join(dir, f))).mtimeMs })),
      );
      stats.sort((a, b) => b.m - a.m);
      return stats[0].f;
    }
    await sleep(500);
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

// ${VAR} → process.env; {{key}} → scalar journey fields + timestamp.
function interpolate(obj, env) {
  const ctx = { ...obj, timestamp: timestamp() };
  const walk = (v) => {
    if (typeof v === 'string') return interpolateString(v, env, ctx);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, vv] of Object.entries(v)) o[k] = walk(vv);
      return o;
    }
    return v;
  };
  return walk(obj);
}

function interpolateString(s, env, ctx) {
  s = s.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => {
    const v = env[name];
    if (v === undefined) throw new Error(`missing env var: ${name}`);
    return v;
  });
  s = s.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const parts = path.trim().split('.');
    let cur = ctx;
    for (const p of parts) { cur = cur?.[p]; if (cur === undefined) return ''; }
    return String(cur);
  });
  return s;
}

function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) out[k] = true;
      else { out[k] = n; i++; }
    } else out._.push(t);
  }
  return out;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function log(m)   { process.stderr.write(m + '\n'); }
function die(m)   { log('pagecapture.mjs: ' + m); process.exit(2); }
function sleep(ms){ return new Promise((r) => setTimeout(r, ms)); }
