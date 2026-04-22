---
name: aqa-cover
description: "Fully automated AQA accessibility agent. Given any URL, discovers pages, creates URL flows + click-state PageCapture flows, uploads ZIPs directly to AQA, creates a11y tests + keyboard tests + weekly schedulers — all without manual steps. Use when the user asks to 'cover a site with AQA', 'run accessibility tests on <url>', 'create AQA flows for <url>', or similar. Requires AQA_TEAMSLUG + AQA_API_KEY + AQA_SUITE_ID in environment."
metadata:
  author: 1291pravin
  version: "2.0.0"
---

# aqa-cover — Unified AQA Accessibility Agent

You are the single skill that handles **all** AQA accessibility testing — URL flows via the REST API **and** click-state flows via the official UsableNet PageCapture automation extension. No companion skills needed. No manual ZIP drag-drop. Everything is automated end-to-end.

## Architecture

```
<skill-dir>/
├── SKILL.md                       ← This file (AI agent instructions)
├── AQAPageCapture/                ← Official UsableNet automation extension + plugin
│   ├── extension/                 ← Chrome extension (externally_connectable)
│   ├── plugin.playwright.js       ← Official Playwright SDK
│   └── plugin.playwright.d.ts     ← TypeScript declarations
├── resources/
│   └── aqa-openapi.json           ← Full AQA v3.1 OpenAPI 3.1 spec (reference)
└── scripts/
    ├── aqa.mjs                    ← AQA REST API helper (zero deps, Node 20+)
    ├── pagecapture-e2e.mjs        ← PageCapture automation script (uses official plugin)
    └── yaml-lite.mjs              ← Minimal YAML parser (zero deps)
```

## Extending `aqa.mjs` with new endpoints

`aqa.mjs` wires a curated subset of the AQA v3.1 API (rulesets, devices, suites, URL flows, a11y/keyboard tests, schedulers, evaluate). When a user needs an endpoint that isn't exposed yet — e.g. deleting a flow, triggering a test run, moving a run, listing run results, updating crawlers, user management — **read the OpenAPI spec at `<skill-dir>/resources/aqa-openapi.json` before writing new code.** It is the authoritative source.

How to use it without loading 14k lines into context:

1. Grep for the path you need: `^\s*"/a11y/suites/\{suiteId\}/flows/\{flowId\}/delete"` returns the exact line number.
2. Read a ~80-line window around that line to get the method, params, request body schema, and response schema.
3. Add a new subcommand to `aqa.mjs` following the existing pattern (`req(method, path, body, { form })`, idempotent error handling via `isExistingName` when applicable, `logApplied` for mutations).
4. Remember the form-encoding quirk: `/a11y/tests/evaluate` and `/a11y/suites/{suiteId}/flows/url/create` use `application/x-www-form-urlencoded` — assume JSON for everything else unless the spec says otherwise. The `{ form: true }` option handles this.

Quick index of paths worth knowing about (line numbers in `resources/aqa-openapi.json`):

- `/a11y/suites` (906), `/a11y/suites/{suiteId}` (1049), `/a11y/suites/{suiteId}/flows/{flowId}` GET/update/delete (1208, 1577, 1753)
- `/a11y/suites/{suiteId}/flows/{sourceType}/create` (1419) — covers `url`, and other source types the spec enumerates
- `/a11y/suites/{suiteId}/crawlers/*` (1885–2430) — crawler CRUD, not yet wired
- `/a11y/tests/{testId}/run` (3466), `/a11y/tests/runs/{runId}` GET (3714), `/stop` (3546), `/move` (3627)
- `/a11y/tests/runs/{runId}/flows` + `/flows/{flowId}/issues` (3855, 5287) — fetching run results
- `/a11y/keyboardTests/*` mirrors `/a11y/tests/*` structure (6678+)
- `/users/*` (9778+) — user management, entirely unwired

When in doubt, grep the spec; do not guess paths or payload shapes.

## How it works

**Two types of flows, both fully automated:**

1. **URL flows** — static pages tested via API. No browser needed.
   - `aqa.mjs flows.urlCreate` → `tests.create` → `scheduler.create`

2. **Click-state flows** — pages needing interaction (mega menus, mini-carts, modals).
   - `pagecapture-e2e.mjs` launches headed Chromium with the PageCapture extension
   - The official `plugin.playwright.js` communicates via `chrome.runtime.sendMessage`
   - Extension captures DOM + resources → `uploadZip()` sends ZIP directly to AQA
   - Then `aqa.mjs` creates tests + schedulers for the uploaded flow

**Key difference from the old approach:** The old `aqa-pagecapture` skill used a DevTools-panel extension that required keyboard shortcuts and manual ZIP export. This skill uses the **automation extension** with `externally_connectable` — ZIP upload is fully programmatic.

## Running scripts in this skill

`<skill-dir>` = the absolute path of the directory containing this SKILL.md. Substitute it in all commands below.

## Prerequisites

Check in order. Stop on the first failure.

1. **Environment variables.** All three must be set:
   - `AQA_TEAMSLUG` — team slug (e.g. `colgate`)
   - `AQA_API_KEY` — API key (sent as `X-Team` header)
   - `AQA_SUITE_ID` — target suite ID (e.g. `TS35353`)

   If missing, tell the user:
   > Please set `AQA_TEAMSLUG`, `AQA_API_KEY`, and `AQA_SUITE_ID` in your environment.

2. **Node 20+.** Check `node --version`. Needed for global `fetch`.

3. **Playwright (for click-state flows only).** Check if `npx playwright --version` works. If not:
   ```bash
   npm install -g playwright && npx playwright install chromium
   ```
   Warn the user about the ~300 MB download. URL-only flows do NOT need Playwright.

4. **Suite must exist.** Verify with:
   ```bash
   node <skill-dir>/scripts/aqa.mjs suites.get --suite $AQA_SUITE_ID
   ```
   If it fails, tell the user to create the suite in the AQA UI first (API doesn't support suite creation).

---

## Phase 1 — Scout the codebase

Purpose: discover pages, selectors, and auth-gated routes without launching a browser.

Use the agent's file-reading/grepping tools. Keep this inline.

1. **Detect framework.** Look for `next.config.*`, `vite.config.*`, `vue.config.*`, `nuxt.config.*`, `remix.config.*`, Shopify Liquid templates (`*.liquid`), or plain HTML.

2. **Enumerate routes.** Framework-specific:
   - Shopify/Liquid: grep for `{% schema %}`, template files, URL patterns in `routes/`
   - Next.js: find `app/**/page.{tsx,jsx}` or `pages/**/*.{tsx,jsx}`
   - Vue Router: grep for `path:` in router config
   - Unknown: skip — Phase 2 will discover pages

3. **Flag auth-gated routes.** Grep for `middleware`, `requireAuth`, route guards, `/login` redirects, `/account` paths.

4. **Identify click-state components.** Grep for: `mega-menu|megamenu|MegaMenu`, `mini-cart|minicart|MiniCart`, `modal|Modal`, `dropdown|Dropdown`, `accordion|Accordion`. These are candidates for PageCapture flows.

5. **Harvest selectors.** Grep for `data-testid=|role=|aria-label=|aria-haspopup=` — keep top ~50.

Output a concise inline summary:
```
framework: shopify + vue 3 + vite
routes: 12 public, 3 auth-gated
click-state components: MegaMenu.vue, MiniCart.vue
selectors: 38 aria-* usages
```

If no codebase available, skip and note it.

---

## Phase 2 — Explore the live site

Use the agent's browser tool to visit `<url>` and discover pages.

1. Visit the URL.
2. Dismiss cookie consent if present (look for `#truste-consent-button`, `.cookie-accept`, etc.).
3. Navigate key pages: home, product, search, cart, contact, store-locator, etc.
4. Note which pages have click-state interactions (menus, carts, modals).
5. Stop after ~10 pages.

Record findings inline:
```
explored: 8 pages
click-state: / (mega-menu on hover), /products/* (mini-cart after add-to-cart)
skipped: /account (auth-gated)
```

---

## Phase 3 — Check AQA rulesets and devices

```bash
node <skill-dir>/scripts/aqa.mjs rulesets
node <skill-dir>/scripts/aqa.mjs devices
```

Pick defaults:
- **Ruleset:** prefer `wcag22` from pack `v2`, fallback to `wcag21`
- **Device:** pick a desktop entry (note `D<n>` ID)

---

## Phase 4 — Compose the plan

Write `reports/<suite-slug>/<timestamp>/plan.md`:

```markdown
# AQA coverage plan — <suite-name> — <timestamp>

**Target:** <url>
**Ruleset:** <rulesetId> (pack <packId>)
**Device:** <deviceId>
**Approach:** Fully automated (URL flows via API + click-state via PageCapture plugin)

## URL flows (via API — no browser needed)
1. <name> — <url>

## Click-state flows (via PageCapture plugin — headed browser, automated upload)
1. <name> — interaction description

## Tests
- One a11y test per flow (wcag22)
- Weekly schedulers on all a11y tests
- Note: keyboard tests are NOT supported for programmatically-created flows (API limitation)

## Skipped
- <route>: <reason>
```

**Classification rules:**
- Page reachable by URL alone → **URL flow**
- Page needs interaction (hover, click, fill) to reach target state → **Click-state flow**
- Auth-gated + no creds → **skip**
- Every flow gets a11y test + weekly scheduler.
- **Note:** keyboard tests are NOT supported for any programmatically-created flows (AQA API limitation). Skip `kbdTests.create`.

---

## Phase 5 — Approval gate

Present the plan and ask the user:
> I'll create in suite **<name>**: N URL flows, M click-state flows, P a11y tests, Q keyboard tests, R schedulers. Skipping K routes. Plan: `reports/<slug>/<ts>/plan.md`.

Options: `Approve and execute` / `Dry-run only` / `Modify plan`

If `--dry-run`: stop here.

---

## Phase 6 — Execute

Let `LOG=reports/<suite-slug>/<timestamp>/applied.json`.

### 6A. URL flows (API only)

For each URL flow in the plan:

```bash
# Create flow
node <skill-dir>/scripts/aqa.mjs flows.urlCreate \
  --suite $AQA_SUITE_ID --name "<flow-name>" --url "<url>" --device <deviceId> \
  --log $LOG

# Create a11y test
node <skill-dir>/scripts/aqa.mjs tests.create \
  --suite $AQA_SUITE_ID --name "<flow-name> a11y" \
  --pack v2 --ruleset wcag22 --flow $FLOW_ID \
  --log $LOG

# Create weekly scheduler
node <skill-dir>/scripts/aqa.mjs scheduler.create --test $TEST_ID --log $LOG
```

### 6B. Click-state flows (PageCapture plugin)

For each click-state flow, **author a journey YAML** and run:

```bash
node <skill-dir>/scripts/pagecapture-e2e.mjs <journey.yaml> \
  --suite $AQA_SUITE_ID
```

**Journey YAML format:**
```yaml
name: <suite-slug>/<flow-name>
description: <what this flow captures>
device:
  viewport: { width: 1440, height: 900 }
defaults:
  stepTimeoutMs: 15000
steps:
  - { type: goto, url: "https://example.com/" }
  - { type: createFlow }
  - { type: click, selector: "button[id='truste-consent-button']", optional: true }
  - { type: waitFor, timeout: 2000 }
  - { type: snapshot, label: "Home Page" }
  - { type: hover, selector: "nav button[aria-haspopup='true']" }
  - { type: waitFor, timeout: 1000 }
  - { type: snapshot, label: "Mega Menu Open" }
```

Supported step types: `goto`, `click`, `hover`, `fill` (with `value`), `press` (with `key`), `waitFor` (with `selector` or `networkIdle: true` or `timeout: <ms>`), `createFlow`, `snapshot` (with `label`). Any step may add `optional: true`.

Env-var interpolation: `${VAR}` in string values pulls from `process.env`.

After `pagecapture-e2e.mjs` uploads the ZIP, poll for the new flow and create tests:

```bash
# Get the flow ID (it was just uploaded by the plugin)
node <skill-dir>/scripts/aqa.mjs suites.get --suite $AQA_SUITE_ID
# Find the newest flow ID from the response

# Create a11y test
node <skill-dir>/scripts/aqa.mjs tests.create \
  --suite $AQA_SUITE_ID --name "<flow-name> a11y" \
  --pack v2 --ruleset wcag22 --flow $FLOW_ID --log $LOG

# Scheduler
node <skill-dir>/scripts/aqa.mjs scheduler.create --test $TEST_ID --log $LOG
```

All commands are idempotent — safe to re-run.

---

## Phase 7 — Wrap up

Write `reports/<suite-slug>/<timestamp>/NEXT-STEPS.md`:

```markdown
# AQA Coverage Complete — <suite-name>

## Created
- Suite: <id>
- URL flows: N (IDs: ...)
- Click-state flows: M (IDs: ...)
- a11y tests: P (IDs: ...)
- Keyboard tests: N/A (API limitation — only UI-created flows)
- Schedulers: weekly, attached to all tests

## Skipped
- <route>: <reason>

## Re-running
All commands are idempotent. Re-run to pick up new flows or retry failed steps.
```

Respond to the user with:
1. One-sentence summary.
2. Path to `NEXT-STEPS.md`.
3. Any warnings.

---

## Authoring journey YAMLs

When the user wants to cover a click-state page, author the journey YAML for them:

1. Ask what interaction to capture (e.g. "mega menu on hover", "mini-cart after add to cart").
2. Use selectors harvested in Phase 1. Prefer `aria-*`, `data-testid`, `role` over bare CSS.
3. Always include `createFlow` before the first `snapshot`.
4. Always dismiss cookie banners with `optional: true` early in the journey.
5. Keep journeys short: 5-10 steps max.
6. Place `snapshot` at each meaningful DOM state.
7. Save journey YAMLs to `reports/<suite-slug>/<timestamp>/<flow-name>.yaml`.

Example for a mega menu:
```yaml
name: filorga-fr/mega-menu
description: Mega menu navigation click-state
steps:
  - { type: goto, url: "https://fr.filorga.com/" }
  - { type: createFlow }
  - { type: click, selector: "button[id='truste-consent-button']", optional: true }
  - { type: waitFor, timeout: 2000 }
  - { type: snapshot, label: "Home Page" }
  - { type: hover, selector: "nav button[aria-haspopup='true']" }
  - { type: waitFor, timeout: 1000 }
  - { type: snapshot, label: "Mega Menu Open" }
```

---

## Known limitations

- **Suite creation** requires the AQA UI (API doesn't support it)
- **Keyboard tests** are rejected by the AQA API for both URL flows AND PageCapture flows uploaded via the automation plugin (`invalid_flow_ids`). They only work with flows created through the AQA UI. Skip `kbdTests.create` — it will 400.
- **Scheduler creation** may return HTTP 500 intermittently — `aqa.mjs` has retry logic
- **Cookie banners** must be dismissed before PageCapture snapshots — always include as `optional` step
- **Auth-gated pages** need credentials via `${ENV_VAR}` in journey YAML
- **Click-state flows** require a headed browser (no headless) and a display
- **Flow names must NOT contain forward slashes (`/`)** — slashes create subdirectory paths inside the ZIP `.aqaflow` filename, which AQA's server cannot extract. Use dashes (`-`) instead. The `pagecapture-e2e.mjs` script auto-sanitizes slashes → dashes.
- **System Chrome required for PageCapture** — use `channel: 'chromium'` in Playwright launch options. The bundled Chromium may have issues with the `chrome.pageCapture` API.

## Defaults and reminders

- Never write credentials to any report file
- Slug naming: `<suite>-<route-or-label>` for flows (use dashes, never slashes), `<flow-name> a11y` for tests
- All mutation commands take `--log <path>` and append JSON lines
- If `AQA_TEAMSLUG` / `AQA_API_KEY` are missing, `aqa.mjs` exits with code 2
