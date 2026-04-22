#!/usr/bin/env node
// plan-run.mjs — execute an AQA coverage plan.yaml end-to-end.
//
// Reads a structured plan (suite, device, ruleset, urlFlows, clickFlows, skip)
// and creates every flow + a11y test + weekly scheduler it declares.
// All mutations go through aqa.mjs, so existing_name fallbacks make re-runs safe.
//
// Usage:
//   node <skill-dir>/scripts/plan-run.mjs <plan.yaml> [--dry-run] [--log <path>]
//
// Env: AQA_TEAMSLUG, AQA_API_KEY. Suite ID comes from plan.yaml.

import { readFile } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse as yamlParse } from './yaml-lite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AQA_CLI = resolve(__dirname, 'aqa.mjs');
const PAGECAPTURE_CLI = resolve(__dirname, 'pagecapture-e2e.mjs');

const args = parseArgv(process.argv.slice(2));
const planPath = args._[0];

if (!planPath || args.help) {
  console.error(`Usage: plan-run.mjs <plan.yaml> [--dry-run] [--log <path>]

Reads plan.yaml and executes it end-to-end:
  urlFlows   -> aqa.mjs flows.urlCreate + tests.create + scheduler.create
  clickFlows -> pagecapture-e2e.mjs <journey.yaml> then tests + scheduler

Idempotent: re-runs reuse existing flows/tests/schedulers.

plan.yaml schema (minimal):
  suite: TS35353
  device: D1
  ruleset: { pack: v2, id: wcag22 }
  target: https://example.com       # optional, for reports
  urlFlows:
    - { name: Home, url: https://example.com/ }
  clickFlows:
    - { name: mega-menu, journey: ./mega-menu.yaml }
  skip:
    - { route: /account, reason: auth-gated }

Env: AQA_TEAMSLUG, AQA_API_KEY required. Suite is read from plan.yaml.
`);
  process.exit(planPath ? 0 : 1);
}

requireEnv('AQA_TEAMSLUG');
requireEnv('AQA_API_KEY');

const planAbs = resolve(planPath);
const planDir = dirname(planAbs);
const plan = yamlParse(await readFile(planAbs, 'utf8'));

const suite = plan.suite;
const device = plan.device;
const pack = plan.ruleset?.pack || 'v2';
const ruleset = plan.ruleset?.id || 'wcag22';
const urlFlows = plan.urlFlows || [];
const clickFlows = plan.clickFlows || [];
const skip = plan.skip || [];
const dryRun = !!args['dry-run'];
const logPath = args.log || join(planDir, 'applied.json');

const missing = [];
if (!suite) missing.push('suite');
if (!device) missing.push('device');
if (!urlFlows.length && !clickFlows.length) missing.push('urlFlows or clickFlows (at least one)');
if (missing.length) fail(`plan.yaml missing required fields: ${missing.join(', ')}`);

console.log(`\nAQA plan: ${plan.target || '(no target)'}`);
console.log(`  suite=${suite} device=${device} ruleset=${pack}/${ruleset}`);
console.log(`  urlFlows=${urlFlows.length} clickFlows=${clickFlows.length} skip=${skip.length}`);
console.log(`  log=${logPath}`);
if (dryRun) console.log('  MODE: DRY RUN (no API mutations, no browser launches)');
console.log('');

const results = { urlFlows: [], clickFlows: [], errors: [] };

// ────────────────────────────────────────────────────────────────────────────
// URL flows
// ────────────────────────────────────────────────────────────────────────────

for (const [i, flow] of urlFlows.entries()) {
  const tag = `[url ${i + 1}/${urlFlows.length}]`;
  if (!flow.name || !flow.url) {
    const msg = `${tag} missing name or url`;
    console.error(`  ✗ ${msg}`);
    results.errors.push(msg);
    continue;
  }
  console.log(`${tag} ${flow.name} — ${flow.url}`);
  if (dryRun) {
    console.log(`  (dry-run) would: flows.urlCreate + tests.create + scheduler.create`);
    continue;
  }
  try {
    const flowRes = await runAqa([
      'flows.urlCreate',
      '--suite', suite, '--name', flow.name, '--url', flow.url,
      '--device', device, '--log', logPath,
    ]);
    const flowId = flowRes.id;
    console.log(`  ✓ flow ${flowId}${flowRes.existed ? ' (existing)' : ''}`);

    const testRes = await runAqa([
      'tests.create',
      '--suite', suite, '--name', `${flow.name} a11y`,
      '--pack', pack, '--ruleset', ruleset, '--flow', flowId,
      '--log', logPath,
    ]);
    const testId = testRes.id;
    console.log(`  ✓ test ${testId}${testRes.existed ? ' (existing)' : ''}`);

    const schedRes = await runAqa([
      'scheduler.create', '--test', testId, '--log', logPath,
    ]);
    console.log(`  ✓ scheduler ${schedRes.id ?? ''}${schedRes.existed ? ' (existing)' : ''}`);

    results.urlFlows.push({ name: flow.name, flowId, testId, schedulerId: schedRes.id });
  } catch (err) {
    const msg = `${tag} ${flow.name}: ${err.message}`;
    console.error(`  ✗ ${msg}`);
    results.errors.push(msg);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Click flows
// ────────────────────────────────────────────────────────────────────────────

for (const [i, flow] of clickFlows.entries()) {
  const tag = `[click ${i + 1}/${clickFlows.length}]`;
  if (!flow.name || !flow.journey) {
    const msg = `${tag} missing name or journey`;
    console.error(`  ✗ ${msg}`);
    results.errors.push(msg);
    continue;
  }
  const journeyAbs = isAbsolute(flow.journey) ? flow.journey : resolve(planDir, flow.journey);
  console.log(`${tag} ${flow.name} — ${flow.journey}`);
  if (dryRun) {
    console.log(`  (dry-run) would: pagecapture-e2e.mjs ${journeyAbs} + tests.create + scheduler.create`);
    continue;
  }
  try {
    // PageCapture sanitizes `/` -> `-` in flow names before upload; match that
    // when we look up the uploaded flow by name after the capture finishes.
    const journeyText = await readFile(journeyAbs, 'utf8');
    const journey = yamlParse(journeyText);
    if (!journey.name) throw new Error(`${journeyAbs}: missing 'name' field`);
    const uploadedName = String(journey.name).replace(/\//g, '-');

    const pc = spawnSync('node', [PAGECAPTURE_CLI, journeyAbs, '--suite', suite], { stdio: 'inherit' });
    if (pc.status !== 0) throw new Error(`pagecapture-e2e exited with code ${pc.status}`);

    const suiteDetails = await runAqa(['suites.get', '--suite', suite]);
    const found = (suiteDetails.flows || []).find((f) => f.name === uploadedName);
    if (!found) throw new Error(`uploaded flow "${uploadedName}" not found in suite ${suite} after capture`);
    const flowId = found.id;
    console.log(`  ✓ uploaded flow ${flowId} ("${uploadedName}")`);

    const testRes = await runAqa([
      'tests.create',
      '--suite', suite, '--name', `${flow.name} a11y`,
      '--pack', pack, '--ruleset', ruleset, '--flow', flowId,
      '--log', logPath,
    ]);
    const testId = testRes.id;
    console.log(`  ✓ test ${testId}${testRes.existed ? ' (existing)' : ''}`);

    const schedRes = await runAqa([
      'scheduler.create', '--test', testId, '--log', logPath,
    ]);
    console.log(`  ✓ scheduler ${schedRes.id ?? ''}${schedRes.existed ? ' (existing)' : ''}`);

    results.clickFlows.push({ name: flow.name, flowId, testId, schedulerId: schedRes.id });
  } catch (err) {
    const msg = `${tag} ${flow.name}: ${err.message}`;
    console.error(`  ✗ ${msg}`);
    results.errors.push(msg);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────

console.log(`
Summary:
  URL flows:   ${results.urlFlows.length}/${urlFlows.length} succeeded
  Click flows: ${results.clickFlows.length}/${clickFlows.length} succeeded
  Skipped:     ${skip.length}
  Errors:      ${results.errors.length}
  Log:         ${logPath}
`);

if (results.errors.length) {
  console.error('Errors:');
  for (const e of results.errors) console.error(`  - ${e}`);
  process.exit(1);
}
process.exit(0);

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function runAqa(argv) {
  const res = spawnSync('node', [AQA_CLI, ...argv], { encoding: 'utf8' });
  if (res.status !== 0) {
    const msg = (res.stderr || '').trim() || `aqa.mjs exited ${res.status}`;
    throw new Error(msg);
  }
  const stdout = (res.stdout || '').trim();
  if (!stdout) return {};
  try { return JSON.parse(stdout); } catch { return { raw: stdout }; }
}

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`plan-run.mjs: ${name} is required in environment`);
    process.exit(2);
  }
}

function fail(msg) {
  console.error(`plan-run.mjs: ${msg}`);
  process.exit(2);
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
