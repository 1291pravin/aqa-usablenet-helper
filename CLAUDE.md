# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mission

This repo exists to automate **AQA UsableNet accessibility test setup**. Creating AQA coverage for one site takes a lot of manual clicking today, and the team has ~600 sites to cover. The agent skills in this repo are the production tool: given a **codebase** and a **live URL**, the agent reads the code, explores the site, proposes a coverage plan, gets the user's approval, then executes it via AQA's v3.1 REST API (plus a headed-browser extension for click-state pages).

The approval gate is non-negotiable — always propose a written plan (`reports/<suite>/<timestamp>/plan.md`) before mutating anything in AQA. Supply `--dry-run` if the user wants to inspect only.

## Repository shape

```
skills/
  aqa-cover/            ← primary skill (v2.0). Unified URL-flow + click-state pipeline.
    SKILL.md            ← agent instructions, 7-phase workflow
    scripts/
      aqa.mjs           ← zero-dep AQA v3.1 REST helper (Node 20+ global fetch)
      pagecapture-e2e.mjs ← Playwright + AQAPageCapture extension → auto ZIP upload
      yaml-lite.mjs     ← minimal YAML parser
    AQAPageCapture/     ← official UsableNet automation extension + Playwright plugin
    examples/mega-menu.yaml
  aqa-pagecapture/      ← legacy skill. DevTools panel + keyboard shortcut + manual ZIP drag-drop.
    SKILL.md            ← kept only for environments that can't run the automation extension
    scripts/pagecapture.mjs
    pagecapture_src/    ← unpacked PageCapture DevTools extension
archive/                ← earlier design explorations; do not ship
```

**Default to `aqa-cover`.** It supersedes `aqa-pagecapture`: uploads ZIPs programmatically via `externally_connectable` instead of requiring the user to drag-drop. Only touch `aqa-pagecapture` if a bug report is specifically about that skill.

## The 7-phase workflow (aqa-cover)

Documented in full in `skills/aqa-cover/SKILL.md`. The phases are:

1. **Scout codebase** — grep for routes, auth gates, click-state components (mega menus, mini-carts, modals), selectors (`data-testid`, `aria-*`).
2. **Explore live site** — use the agent's browser automation tools (playwright-cli skill or claude-in-chrome MCP) to visit ~10 pages and note click-state interactions.
3. **Check AQA** — list rulesets + devices, verify the target suite exists (suite creation is UI-only).
4. **Compose plan** — write `reports/<slug>/<ts>/plan.md` classifying each page as URL-flow, click-state flow, or skipped.
5. **Approval gate** — show counts; user picks approve / dry-run / modify.
6. **Execute** — URL flows via `aqa.mjs`, click-state flows via `pagecapture-e2e.mjs`. All mutations are idempotent (existing-name errors fall back to lookup).
7. **Wrap up** — write `reports/<slug>/<ts>/NEXT-STEPS.md`.

## Common commands

Run from the repo root. Substitute `<skill-dir>` = `skills/aqa-cover` for the primary path.

```bash
# API surface (help on no args)
node skills/aqa-cover/scripts/aqa.mjs
node skills/aqa-cover/scripts/aqa.mjs rulesets
node skills/aqa-cover/scripts/aqa.mjs devices
node skills/aqa-cover/scripts/aqa.mjs suites.get --suite $AQA_SUITE_ID

# Create a URL flow + a11y test + weekly scheduler (idempotent)
node skills/aqa-cover/scripts/aqa.mjs flows.urlCreate \
  --suite $AQA_SUITE_ID --name "Home" --url https://example.com --device D1 \
  --log reports/example/applied.json
node skills/aqa-cover/scripts/aqa.mjs tests.create \
  --suite $AQA_SUITE_ID --name "Home a11y" \
  --pack v2 --ruleset wcag22 --flow <FLOW_ID> \
  --log reports/example/applied.json
node skills/aqa-cover/scripts/aqa.mjs scheduler.create --test <TEST_ID> \
  --log reports/example/applied.json

# Click-state capture + auto-upload (headed Chromium required)
node skills/aqa-cover/scripts/pagecapture-e2e.mjs <journey.yaml> --suite $AQA_SUITE_ID

# First-time Playwright install for pagecapture-e2e
cd skills/aqa-cover && npm install
```

There is no build step, no lint config, no test suite. Scripts are plain ESM `.mjs` files.

## Required environment

All three must be set for anything that talks to AQA:

```
AQA_TEAMSLUG   # team slug, sent in URL path
AQA_API_KEY    # sent as x-team header
AQA_SUITE_ID   # target suite; suite creation is UI-only (API returns error)
```

Scripts exit code 2 if any are missing. Auth-gated journeys reference credentials via `${ENV_VAR}` interpolation inside journey YAML — never hardcode passwords.

## Non-obvious constraints (these bit us in production)

- **AQA API has no suite-create endpoint.** `suites.ensure` returns `SUITE_MISSING` if the suite doesn't exist — the user must create it once in the AQA UI.
- **Keyboard tests fail on programmatically-created flows.** Both URL flows created via API and PageCapture flows uploaded via the automation plugin get rejected with `invalid_flow_ids` when you try to attach a keyboard test. Only UI-created flows support them. The plan template in SKILL.md intentionally omits `kbdTests.create`.
- **Flow names cannot contain `/`.** Forward slashes become subdirectory paths inside the `.aqaflow` ZIP filename, which AQA's server can't extract. `pagecapture-e2e.mjs` auto-sanitizes `/` → `-`; keep that behavior when editing.
- **Schedulers return intermittent HTTP 500s.** `aqa.mjs` has retry-with-backoff for 429 + 5xx — don't remove it.
- **PageCapture needs headed Chromium with `channel: 'chromium'` (system Chrome).** The bundled Playwright Chromium has issues with the `chrome.pageCapture` API. Headless fails silently.
- **Cookie banners must be dismissed before snapshots.** Always include `{ type: click, selector: "#truste-consent-button", optional: true }` early in a journey.
- **AQA evaluate endpoint is form-encoded, not JSON.** The OpenAPI doc is imprecise; `aqa.mjs` passes `{ form: true }` for `/a11y/tests/evaluate` and `/flows/url/create`.

## Journey YAML (for click-state flows)

Minimal schema (full example: `skills/aqa-cover/examples/mega-menu.yaml`):

```yaml
name: <slug>/<flow-name>       # slug sanitized on upload; don't use / in the flow-name portion
steps:
  - { type: goto, url: "https://example.com/" }
  - { type: createFlow }        # REQUIRED before first snapshot
  - { type: click, selector: "#truste-consent-button", optional: true }
  - { type: waitFor, timeout: 2000 }
  - { type: snapshot, label: "Home Page" }
  - { type: hover, selector: "nav button[aria-haspopup='true']" }
  - { type: snapshot, label: "Mega Menu Open" }
```

Supported step types: `goto`, `click`, `hover`, `fill` (with `value`), `press` (with `key`), `waitFor` (with `selector` | `networkIdle: true` | `timeout: <ms>`), `createFlow`, `snapshot` (with `label`). Any step accepts `optional: true`. String values support `${ENV_VAR}` interpolation.

## When editing this repo

- The skills are the product. Changes to `SKILL.md` directly change agent behavior — treat SKILL.md like code, not docs.
- `aqa.mjs` is zero-dep by design (Node 20+ global fetch only). Don't add npm deps to `skills/aqa-cover/` unless they're for `pagecapture-e2e.mjs`.
- All `aqa.mjs` mutations must stay idempotent: catch `existing_name` errors and return the existing entity. Re-running a plan should never create duplicates.
- All mutation subcommands accept `--log <path>` and append one JSON line per applied op; preserve this contract — the logs are how re-runs reconcile state.
- `reports/`, `out/`, `node_modules/`, `.env*` are gitignored. Never commit a report directory or an `applied.json`.
