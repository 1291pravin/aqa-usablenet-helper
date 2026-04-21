---
name: aqa-cover
description: Given a URL and access to the app's codebase, propose and (on approval) execute a full AQA accessibility coverage plan — create a suite's URL flows, a11y tests, keyboard tests, and schedulers via the AQA v3.1 public API. Use when the user asks to "cover a site with AQA", "automate AQA setup", "create AQA flows and tests for <url>", or similar phrasing. Requires AQA_TEAMSLUG + AQA_API_KEY in environment. For click-state pages (mega menus, mini-carts), install the companion `aqa-pagecapture` skill.
metadata:
  author: 1291pravin
  version: "1.0.0"
---

# aqa-cover

You orchestrate AQA accessibility coverage for a target site. The user gives you a URL (and optional credentials + codebase path). You discover what pages and flows are worth testing, present one consolidated plan, and — after a single approval — execute it via this skill's bundled helper `scripts/aqa.mjs`.

## Running scripts in this skill

Throughout this document, `<skill-dir>` is the absolute path of the directory that holds this SKILL.md. You already know it because you read this file from that location. Typical install paths:

- `<project>/.claude/skills/aqa-cover/` (Claude Code, project scope)
- `<project>/.cursor/skills/aqa-cover/` (Cursor)
- `<project>/.windsurf/skills/aqa-cover/` (Windsurf)
- `~/.claude/skills/aqa-cover/` (Claude Code, global — `-g` flag)
- same pattern under the user home for other agents

Substitute the real absolute path wherever `<skill-dir>` appears below. Every script invocation looks like `node <skill-dir>/scripts/aqa.mjs …`. No `npm install` required — this skill has zero runtime dependencies (Node 20+ global `fetch` only).

## Prerequisites

Before doing anything else, verify both. Stop immediately if either fails.

1. **Environment:** `AQA_TEAMSLUG` and `AQA_API_KEY` must be set. If missing, tell the user:
   > Please set `AQA_TEAMSLUG` and `AQA_API_KEY` in your environment (`.env` or shell profile), then re-run.

2. **Node version:** Node 20+ (we use global `fetch`). A quick `node --version` check is enough. If older, tell the user to upgrade.

## Inputs

Parse the user's message for:

- `<url>` — required. The starting URL of the site to cover.
- `--codebase <path>` — optional. Absolute path to the frontend repo. Defaults to the current working directory.
- `--user <email>` — optional. Test account username.
- `--pass-env <VAR>` — optional. Env var name holding the password. Never accept a raw password on the command line.
- `--suite <name>` — optional. AQA suite name to populate. If omitted, propose one derived from the site hostname and confirm it with the user in the approval gate.
- `--dry-run` — optional. Run phases 1–4 only; do not mutate AQA, do not produce ZIPs.

Timestamp for this run: generate once as `YYYY-MM-DDTHH-MM-SS` and reuse. All outputs go to `reports/<suite-slug>/<timestamp>/` under the user's project directory (not inside the skill dir).

---

## Phase 1 — Scout the codebase

Purpose: understand what pages exist, which need auth, and what stable selectors the site uses, **without** launching a browser yet.

Use the tools the agent already has — file-reading/globbing/grepping. Keep this inline; no file output needed.

1. **Detect the framework.** Check for `next.config.*`, `app/` + `pages/`, `remix.config.*`, `vite.config.*` with React Router, `vue.config.*` or `router/index.*`, `nuxt.config.*`, or a plain `index.html` with `<script>`. Record what you found.

2. **Enumerate routes.**
   - Next.js App Router: find `app/**/page.{tsx,jsx,ts,js}` and derive URLs from the directory path.
   - Next.js Pages Router: find `pages/**/*.{tsx,jsx,ts,js}` excluding `_*`.
   - React Router / Vue Router: grep for `path: '...'` / `<Route path="..."/>` / route config arrays.
   - Unknown framework: skip — the live crawl in phase 2 will discover pages.

3. **Flag auth-gated routes.** Grep for `middleware.ts`, `withAuth`, `requireAuth`, `getServerSession`, route guards, or redirects to `/login`. Mark each route as `{ needsAuth: true | false | "unknown" }`.

4. **Identify critical flows.** Grep component names and route paths for: `login|signin|auth`, `signup|register`, `checkout|cart|payment`, `search`, `account|profile|settings`. These are the candidate journeys most worth DOM + keyboard coverage.

5. **Harvest stable selectors.** Run a single grep for `data-testid=|role=|aria-label=` and keep the top ~50 examples. Prefer these when authoring journeys — avoid bare CSS selectors where a testid exists.

Produce a concise inline summary — do not write files yet. Example shape:

```
framework: next.js (app router)
routes: 14 total (3 auth-gated)
  - /              (public)
  - /products/[id] (public)
  - /cart          (auth-gated)
  - /checkout      (auth-gated)
  ...
critical flows: login, checkout, search
selectors: 47 data-testid usages harvested
```

If `--codebase` was not given and the current directory doesn't look like a frontend repo, skip this phase and note that you'll rely on live exploration only.

---

## Phase 2 — Explore the live site

Use whatever browser-automation skill your agent has available (e.g. `playwright-cli` in Claude Code, or the agent's built-in browser tool). Give it the URL and ask it to:

1. Visit `<url>`.
2. If `--user` + `--pass-env` were provided, attempt login using the auth flow inferred in phase 1 (or the obvious `/login` / `/signin` route).
3. Walk the critical-flow entrypoints identified in phase 1. For each reachable page, capture a screenshot and note whether any **click-state** is present:
   - Mega menus / nav dropdowns that open on hover or click.
   - Modals (cookie banners, geo-region, newsletter).
   - Mini-carts or badges that appear after an add-to-cart.
   - Multi-step wizards past step 1.
4. Stop after ~10 pages or 3 minutes of exploration — this is a scout, not a crawl.

Record findings as an inline summary:

```
explored: 8 pages, 2 with click-state
click-state pages:
  - /         (mega-menu-opens-on-hover)
  - /product  (mini-cart-after-add)
auth: login succeeded, /cart reachable
```

If creds were not provided and auth-gated routes exist, note which ones you're skipping.

---

## Phase 3 — Check AQA rulesets and devices

Run in parallel:

```bash
node <skill-dir>/scripts/aqa.mjs rulesets
node <skill-dir>/scripts/aqa.mjs devices
```

From rulesets, pick a default: prefer `wcag21` / `wcag21_aa` / any ID containing `aa`. From devices, pick a reasonable desktop entry (note its `id` — format `D<n>`).

Also run `node <skill-dir>/scripts/aqa.mjs suites.ensure --name "<suite-name>"`. If it errors with `SUITE_MISSING`, tell the user:

> The AQA public API does not expose suite creation. Please create the suite "<name>" once in the AQA UI, then re-run this command.

…and stop. (Only suite creation requires manual UI setup; everything else is API-driven.)

---

## Phase 4 — Compose the plan

Write `reports/<suite-slug>/<timestamp>/plan.md` (in the user's project, not inside the skill) laying out exactly what you propose to do. Use this structure:

```markdown
# AQA coverage plan — <suite-name> — <timestamp>

**Target:** <url>
**Ruleset:** <rulesetId> (pack <packId>)
**Device:** <deviceId>

## URL flows (via public API)
1. <name> — <url>   (e.g. "home — https://example.com/")
2. ...

## Click-state flows (requires companion aqa-pagecapture skill → manual ZIP upload)
1. <name> — journey steps summary
2. ...

## Accessibility tests (one per flow)
- <flow-name> a11y — ruleset <rulesetId>

## Keyboard tests (one per flow)
- <flow-name> kbd

## Schedulers
- Weekly, infinite — attached to each test

## Skipped
- <route>: auth-gated, no creds provided
- <route>: unreachable during explore
```

**Classification rules (apply per candidate page):**
- URL-reachable without interaction → **URL flow** (public API, handled by this skill).
- Requires click-state (menu open, cart populated, etc.) → **PageCapture ZIP** (handled by the `aqa-pagecapture` skill; if the user hasn't installed it, list these routes as deferred).
- Auth-gated + no creds → **skip**, note it.
- Every created flow gets one a11y test + one keyboard test + one weekly scheduler unless the user says otherwise.

If click-state pages exist and `aqa-pagecapture` is not installed, include a one-line hint in plan.md:

> Click-state flows require `npx skills add 1291pravin/aqa-usablenet-helper --skill aqa-pagecapture` (then re-run to include them).

---

## Phase 5 — Approval gate (single prompt)

Ask the user to choose one of: `Approve and execute` / `Dry-run only (stop here)` / `Modify plan`. Summarize the counts:

> I'll create in suite **<name>**: N URL flows, N a11y tests, N keyboard tests, N weekly schedulers. Skipping K routes. M click-state pages deferred (need `aqa-pagecapture` skill). Plan file: reports/<suite-slug>/<timestamp>/plan.md.

If `--dry-run` was set: skip this phase entirely and print a message that the plan was produced but not executed. Stop.

If the user picks `Modify plan`: ask what they want changed, update plan.md, re-prompt.

---

## Phase 6 — Execute

Sequence, with the run's `reports/<suite-slug>/<timestamp>/applied.json` used as the log target for every mutation (pass `--log <path>` on each command). All commands are idempotent — safe to re-run.

Let `LOG=reports/<suite-slug>/<timestamp>/applied.json`.

1. **Ensure suite:**
   ```bash
   node <skill-dir>/scripts/aqa.mjs suites.ensure --name "<suite-name>"
   ```
   Capture the `id` as `$SUITE`.

2. **Create URL flows:** for each URL flow in the plan:
   ```bash
   node <skill-dir>/scripts/aqa.mjs flows.urlCreate \
     --suite $SUITE --name "<flow-name>" --url "<url>" --device <deviceId> \
     --log $LOG
   ```
   Capture each returned `id` as `$FLOW_<slug>`.

3. **Create a11y tests:** for each URL flow created in step 2:
   ```bash
   node <skill-dir>/scripts/aqa.mjs tests.create \
     --suite $SUITE --name "<flow-name> a11y" \
     --pack <packId> --ruleset <rulesetId> \
     --flow $FLOW_<slug> \
     --log $LOG
   ```
   Capture each `id` as `$TEST_<slug>`.

4. **Create keyboard tests:** same shape as step 3 but `kbdTests.create`. Capture as `$KBD_<slug>`.

5. **Attach weekly schedulers:** for each test + keyboard test:
   ```bash
   node <skill-dir>/scripts/aqa.mjs scheduler.create    --test $TEST_<slug> --log $LOG
   node <skill-dir>/scripts/aqa.mjs scheduler.kbdCreate --test $KBD_<slug>  --log $LOG
   ```
   Default cadence `week`, infinite repeats.

Stop and ask the user if any single mutation errors unexpectedly — don't retry the full plan. Idempotency means a re-run will pick up where you stopped.

---

## Phase 7 — Wrap up

Write `reports/<suite-slug>/<timestamp>/NEXT-STEPS.md`:

```markdown
# Next steps — <suite-name> — <timestamp>

## Done via API
- Suite: <id>
- URL flows: N (IDs: ...)
- a11y tests: N (IDs: ...)
- Keyboard tests: N (IDs: ...)
- Schedulers: weekly, infinite, attached to all 2N tests

## Deferred (click-state)
- <route>: needs PageCapture ZIP. Install `aqa-pagecapture` skill and re-run to cover.

## Skipped
- <route>: <reason>

## Re-running
This command is idempotent. Re-run with the same `--suite` to resume or pick up newly-added flows.
```

Print the AQA dashboard URLs if you know the team's dashboard host — otherwise just the IDs.

---

## Defaults and reminders

- **Never** write credentials to `plan.md`, `applied.json`, or any report file. `--pass-env` names an env var; the password never enters the conversation.
- Slug naming: suite slug = kebab-case of suite name; flow names in AQA = `<suite>/<route-or-label>`; test names = `<flow-name> a11y` / `<flow-name> kbd`.
- Every mutation command takes `--log <path>` and appends one JSON line. Use the same path for the whole run.
- If `AQA_TEAMSLUG` / `AQA_API_KEY` are missing, `aqa.mjs` will refuse with exit code 2; pass that error straight to the user.
- If the codebase discovery returns nothing because the user pointed `--codebase` at an empty or non-frontend directory, don't block — skip phase 1 and note it in the plan.

## Ending the turn

After phase 7, respond to the user with:
1. One-sentence summary ("Created X URL flows and Y tests in suite <name>.").
2. The path to `NEXT-STEPS.md`.
3. Any warnings (skipped routes, deferred click-state pages).

Nothing else.
