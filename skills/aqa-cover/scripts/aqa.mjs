#!/usr/bin/env node
// AQA v3.1 API helper. All mutations are idempotent: existing_name errors fall
// back to a lookup-and-return so re-runs never duplicate.
//
// Env required:
//   AQA_TEAMSLUG   — team slug, e.g. "sweetwater"
//   AQA_API_KEY    — API key, sent as x-team header
//
// Usage: node <skill-dir>/scripts/aqa.mjs <subcommand> [--flag value ...]
// Run with no args for help. Zero runtime deps — Node 20+ global fetch only.

import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE = 'https://api-aqa.usablenet.com/v3.1';

const args = parseArgv(process.argv.slice(2));
const subcommand = args._[0];

if (!subcommand || args.help) {
  printHelp();
  process.exit(subcommand ? 0 : 1);
}

const teamslug = requireEnv('AQA_TEAMSLUG');
const apiKey = requireEnv('AQA_API_KEY');

try {
  const result = await dispatch(subcommand, args);
  if (result !== undefined) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
} catch (err) {
  process.stderr.write(`aqa.mjs: ${err.message}\n`);
  if (err.body) process.stderr.write(JSON.stringify(err.body, null, 2) + '\n');
  process.exit(err.code === 'BAD_INPUT' ? 2 : 1);
}

// ────────────────────────────────────────────────────────────────────────────
// Subcommands
// ────────────────────────────────────────────────────────────────────────────

async function dispatch(name, a) {
  switch (name) {
    case 'rulesets':              return await req('GET', '/a11y/tests/rulesets');
    case 'devices':               return await req('GET', '/aqa/devices');
    case 'notificationGroups':    return await req('GET', '/aqa/notificationGroups');
    case 'suites':                return await req('GET', '/a11y/suites');
    case 'suites.ensure':         return await suitesEnsure(a);
    case 'suites.get':            return await req('GET', `/a11y/suites/${need(a, 'suite')}`);
    case 'flows.urlCreate':       return await flowsUrlCreate(a);
    case 'tests.create':          return await testsCreate(a, 'a11y');
    case 'tests.list':            return await req('GET', '/a11y/tests');
    case 'kbdTests.create':       return await testsCreate(a, 'kbd');
    case 'kbdTests.list':         return await req('GET', '/a11y/keyboardTests');
    case 'scheduler.create':      return await schedulerCreate(a, 'a11y');
    case 'scheduler.kbdCreate':   return await schedulerCreate(a, 'kbd');
    case 'evaluate':              return await evaluate(a);
    default: throw badInput(`unknown subcommand: ${name}`);
  }
}

async function suitesEnsure(a) {
  const name = need(a, 'name');
  const list = await req('GET', '/a11y/suites');
  const match = (list.suites || []).find((s) => s.name === name);
  if (match) return { id: match.id, name: match.name, existed: true };
  // Suite creation is UI-only in the public API — flag this clearly.
  const err = new Error(
    `suite "${name}" not found. The AQA public API does not expose suite creation; ` +
    `create it once in the AQA UI, then re-run.`,
  );
  err.code = 'SUITE_MISSING';
  throw err;
}

async function flowsUrlCreate(a) {
  const suite = need(a, 'suite');
  const body = {
    name: need(a, 'name'),
    url: need(a, 'url'),
    deviceId: need(a, 'device'),
  };
  if (a.description) body.description = a.description;
  try {
    const res = await req('POST', `/a11y/suites/${suite}/flows/url/create`, body, { form: true });
    await logApplied(a.log, { op: 'flows.urlCreate', suite, name: body.name, id: res.id });
    return { ...res, existed: false };
  } catch (err) {
    if (!isExistingName(err)) throw err;
    const details = await req('GET', `/a11y/suites/${suite}`);
    const found = (details.flows || []).find((f) => f.name === body.name);
    if (!found) throw err;
    await logApplied(a.log, { op: 'flows.urlCreate', suite, name: body.name, id: found.id, reused: true });
    return { id: found.id, name: found.name, existed: true };
  }
}

async function testsCreate(a, kind) {
  const body = {
    suiteId: need(a, 'suite'),
    name: need(a, 'name'),
    rulesetPackId: need(a, 'pack'),
    rulesetId: need(a, 'ruleset'),
  };
  const flowIds = many(a, 'flow');
  if (flowIds.length) body.flowIds = flowIds;
  const crawlerIds = many(a, 'crawler');
  if (crawlerIds.length) body.crawlerIds = crawlerIds;
  if (a.notificationGroup) body.notificationGroupId = a.notificationGroup;

  const createPath = kind === 'kbd' ? '/a11y/keyboardTests/create' : '/a11y/tests/create';
  const listPath   = kind === 'kbd' ? '/a11y/keyboardTests'         : '/a11y/tests';

  try {
    const res = await req('POST', createPath, body);
    await logApplied(a.log, { op: `${kind}Tests.create`, name: body.name, id: res.id });
    return { ...res, existed: false };
  } catch (err) {
    if (!isExistingName(err)) throw err;
    const list = await req('GET', listPath);
    const found = (list.tests || list[kind === 'kbd' ? 'keyboardTests' : 'tests'] || [])
      .find((t) => t.name === body.name);
    if (!found) throw err;
    await logApplied(a.log, { op: `${kind}Tests.create`, name: body.name, id: found.id, reused: true });
    return { id: found.id, name: found.name, existed: true };
  }
}

async function schedulerCreate(a, kind) {
  const test = need(a, 'test');
  const body = buildSchedulerBody(a);
  const path = kind === 'kbd'
    ? `/a11y/keyboardTests/${test}/scheduler/create`
    : `/a11y/tests/${test}/scheduler/create`;
  const res = await req('POST', path, body);
  await logApplied(a.log, { op: `${kind}Scheduler.create`, test, body });
  return res;
}

async function evaluate(a) {
  const body = {
    rulesetId: need(a, 'ruleset'),
    pageUrl: need(a, 'url'),
    code: await readFile(need(a, 'html-file'), 'utf8'),
  };
  return await req('POST', '/a11y/tests/evaluate', body, { form: true });
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP core — Node 20+ global fetch.
// ────────────────────────────────────────────────────────────────────────────

async function req(method, path, body, { form = false } = {}) {
  const url = `${BASE}/${teamslug}${path}`;
  const headers = { 'x-team': apiKey, accept: 'application/json' };
  let payload;
  if (body !== undefined && method !== 'GET') {
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(flattenForm(body)).toString();
    } else {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { method, headers, body: payload });
    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (res.ok) return parsed;
    const status = res.status;
    if (status === 429 || (status >= 500 && status < 600)) {
      lastErr = httpErr(method, path, status, parsed ?? text);
      await sleep(500 * Math.pow(2, attempt));
      continue;
    }
    throw httpErr(method, path, status, parsed ?? text);
  }
  throw lastErr;
}

function httpErr(method, path, status, body) {
  const e = new Error(`${method} ${path} → HTTP ${status}`);
  e.status = status;
  e.body = body;
  return e;
}

function isExistingName(err) {
  return err?.status === 400 && err.body?.error === 'existing_name';
}

// Form bodies may contain nested objects / arrays. Flatten via repeated keys
// or JSON blobs depending on the shape. AQA accepts JSON-encoded strings for
// structured fields under form-urlencoded.
function flattenForm(body) {
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') out[k] = JSON.stringify(v);
    else out[k] = String(v);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function buildSchedulerBody(a) {
  const cadence = a.cadence || 'week';
  const repeats = a.repeats !== undefined ? Number(a.repeats) : 0;
  const startTime = a.startTime !== undefined ? Number(a.startTime) : Math.floor(Date.now() / 1000);
  const allowed = new Set(['day', 'week', 'two_weeks', 'month', 'once']);
  if (!allowed.has(cadence)) throw badInput(`--cadence must be one of ${[...allowed].join(', ')}`);
  const body = { startTime, execution: cadence };
  if (cadence !== 'once') body.numRepeats = repeats;
  return body;
}

async function logApplied(logPath, entry) {
  if (!logPath) return;
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
}

function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else {
        if (out[key] === undefined) out[key] = next;
        else if (Array.isArray(out[key])) out[key].push(next);
        else out[key] = [out[key], next];
        i++;
      }
    } else {
      out._.push(tok);
    }
  }
  return out;
}

function need(a, key) {
  const v = a[key];
  if (v === undefined || v === true) throw badInput(`missing --${key}`);
  return Array.isArray(v) ? v[0] : v;
}

function many(a, key) {
  const v = a[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`aqa.mjs: ${name} is required in environment\n`);
    process.exit(2);
  }
  return v;
}

function badInput(msg) {
  const e = new Error(msg);
  e.code = 'BAD_INPUT';
  return e;
}

function safeJson(t) { try { return JSON.parse(t); } catch { return t; } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function printHelp() {
  process.stderr.write(`aqa.mjs — AQA v3.1 API helper

Reads:   rulesets | devices | notificationGroups | suites | suites.get --suite <id>
                 | tests.list | kbdTests.list
Ensure:  suites.ensure --name <name>
Write:   flows.urlCreate     --suite <id> --name <name> --url <url> --device <id>
                              [--description <text>] [--log <path>]
         tests.create        --suite <id> --name <name> --pack <packId> --ruleset <id>
                              [--flow <T…> …] [--crawler <T…> …] [--notificationGroup <NG…>] [--log <path>]
         kbdTests.create     (same flags as tests.create)
         scheduler.create    --test <id> [--cadence week] [--repeats 0] [--startTime <epoch>] [--log <path>]
         scheduler.kbdCreate --test <id> ... (same as scheduler.create)
Scan:    evaluate            --ruleset <id> --url <url> --html-file <path>

Env: AQA_TEAMSLUG, AQA_API_KEY required.
Requires Node.js 20+ (uses global fetch).
`);
}
