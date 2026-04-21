---
name: aqa-pagecapture
description: Capture click-state page flows (mega menus, mini-carts, mid-wizard states) into AQA-format ZIP bundles using the official UsableNet PageCapture Chrome extension driven by Playwright. Produces ZIPs the user drags into the AQA UI to create flows that URL-only API calls can't cover. Use when the user asks to "capture click-state for AQA", "record a journey for AQA", or when the companion `aqa-cover` skill flags pages that need PageCapture. Requires a display (headed browser) — does not work headless.
metadata:
  author: 1291pravin
  version: "1.0.0"
---

# aqa-pagecapture

You drive the UsableNet PageCapture Chrome extension through a YAML journey and produce a ZIP the user drags into the AQA UI to create a flow. This skill handles the cases that the public AQA API cannot — pages whose state depends on interaction (menu opened, cart populated, wizard past step 1).

The AQA public API has no endpoint for importing these ZIPs. Upload is manual, by design. This skill produces the ZIP; the user does the drag-drop.

## Running scripts in this skill

Throughout this document, `<skill-dir>` is the absolute path of the directory that holds this SKILL.md. You already know it because you read this file from that location. Typical install paths:

- `<project>/.claude/skills/aqa-pagecapture/` (Claude Code, project scope)
- `<project>/.cursor/skills/aqa-pagecapture/` (Cursor)
- `<project>/.windsurf/skills/aqa-pagecapture/` (Windsurf)
- `~/.claude/skills/aqa-pagecapture/` (Claude Code, global — `-g` flag)
- same pattern under the user home for other agents

Substitute the real absolute path wherever `<skill-dir>` appears below.

## Prerequisites

Run these checks in order. Stop on the first failure.

1. **Display available.** PageCapture's extension won't fire keyboard shortcuts headless. Confirm the user is on a machine with a visible desktop — not a headless CI box. If unsure, ask.

2. **Node 20+.** Check `node --version`. Older versions will fail on features used by the bundled script.

3. **Install dependencies if missing.** This skill bundles a `package.json` but no `node_modules`. First use requires a one-time install (downloads Playwright browsers, ~300 MB, 2–3 minutes):

   ```bash
   test -d "<skill-dir>/node_modules" || (cd "<skill-dir>" && npm install)
   ```

   Warn the user about the download size before running the first time. If `npm install` fails (no network, permission issue on a symlinked skill, etc.), tell the user:

   > Dependency install failed. Run `cd <skill-dir> && npm install` manually, then re-run this command.

   …and stop.

4. **Playwright browsers present.** `npm install` triggers `playwright` postinstall which fetches Chromium. If that step was skipped (some environments block postinstall scripts), fix it with:

   ```bash
   cd "<skill-dir>" && npx playwright install chromium
   ```

## Inputs

Parse the user's message for:

- `<journey>` — required. Path to a journey YAML file. Either an absolute path, a path relative to the user's project, or one of the bundled examples under `<skill-dir>/examples/`.
- `--out <dir>` — optional. Where to write the resulting ZIP. Defaults to `./out/` under the current working directory.
- `--capture-wait-ms <ms>` — optional. Pause after each `snapshot` step, default 2000 ms.

If the user didn't provide a journey path, point them at `<skill-dir>/examples/journey.yaml` as a template and ask them to author one. You can help author it (see "Authoring journey YAML" below).

## What a journey is

A journey YAML declares a sequence of steps that drive a headed browser. Schema (see `<skill-dir>/examples/journey.yaml` for a full example):

```yaml
name: mega-menu-men-shoes      # used for the output ZIP name
device:                        # optional viewport + UA overrides
  viewport: { width: 1440, height: 900 }
defaults:
  stepTimeoutMs: 15000
steps:
  - { type: goto, url: https://example.com/ }
  - { type: click, selector: '[data-testid="nav-toggle"]' }
  - { type: hover, selector: 'nav >> text=Men' }
  - { type: waitFor, selector: '[data-testid="mega-menu-men"]' }
  - { type: snapshot, label: men-menu-open }        # triggers the extension
  - { type: click, selector: 'text=Shoes' }
  - { type: waitFor, networkIdle: true }
  - { type: snapshot, label: shoes-landing }
```

Supported step types: `goto`, `click`, `hover`, `fill` (with `value`), `waitFor` (with `selector` or `networkIdle: true` or `timeout: <ms>`), `snapshot`. Any step may add `optional: true` to continue on failure.

Env-var interpolation is supported in string values: `${VAR}` pulls from `process.env`. Use this for credentials (`${TEST_USER_EMAIL}`) — never hardcode them in the YAML.

## Authoring journey YAML

If the user hasn't provided one, offer to author it from their description:

1. Ask what flow to capture (natural language: *"log in, open men's mega menu, pick shoes, view a PDP, add to cart"*).
2. Use the agent's browser-automation skill (e.g. `playwright-cli`) to visit the site and harvest real selectors — prefer `data-testid`, `role`, `aria-label` over bare CSS.
3. Draft the YAML. Keep journeys short (5–10 steps max). Insert `snapshot` at each DOM state worth capturing.
4. Show it to the user, run once as a dry-run (single journey), review the screenshot trail.

## Execute

Once prerequisites pass and a journey is in hand:

```bash
node "<skill-dir>/scripts/pagecapture.mjs" <journey-path> \
  --out ./out \
  --capture-wait-ms 2000
```

The script:

1. Launches headed Chromium with the PageCapture extension auto-loaded from `<skill-dir>/pagecapture_src/`.
2. Opens DevTools (the extension's panel lives there).
3. Walks the journey steps.
4. At each `snapshot`: presses the extension's capture shortcut (`Ctrl+Shift+S` / `Cmd+Shift+S` on Mac).
5. At end of journey: waits for a ZIP to appear in the user's Downloads folder, moves it to `<out>/<journey-name>-<timestamp>.zip`.

## Handling the output

Tell the user exactly what to do with the ZIP:

1. Open the AQA dashboard.
2. Navigate to the target suite → Import flow.
3. Drag-drop `<out>/<journey-name>-<timestamp>.zip`.
4. After AQA creates the flow, attach a11y test + keyboard test + scheduler using the companion `aqa-cover` skill:
   ```bash
   node <aqa-cover-skill-dir>/scripts/aqa.mjs tests.create \
     --suite $SUITE --flow <new-flow-id> --name "<name> a11y" \
     --pack <packId> --ruleset <rulesetId> --log $LOG
   ```
   (and the matching `kbdTests.create` + `scheduler.create` / `scheduler.kbdCreate`).

Never attempt to automate the AQA UI upload. It's fragile and explicitly out of scope.

## Troubleshooting

- **No ZIP appears within 60 seconds.** The extension's DevTools panel may need a manual Export click. The script logs this and leaves Chromium open briefly — tell the user to click Export in the PageCapture panel, then move the ZIP to `--out`.
- **Keyboard shortcut doesn't fire.** The extension expects an active window. Don't minimize Chromium during the run. Try `--capture-wait-ms 4000` to give more settling time.
- **Credential error (`missing env var: FOO`).** The YAML used `${FOO}` but that env var isn't set in the shell running the command.
- **Playwright launch error.** Usually missing browser binaries — rerun `cd "<skill-dir>" && npx playwright install chromium`.

## Ending the turn

After producing a ZIP:
1. One-sentence confirmation and the path to the ZIP.
2. Step-by-step upload instructions (as above).
3. Note which `aqa-cover` commands to run after the flow is imported.

Nothing else.
