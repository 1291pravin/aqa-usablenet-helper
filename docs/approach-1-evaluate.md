# Approach 1 — Playwright + `/a11y/tests/evaluate`

Stateless, fully automated accessibility scanning of multi-step journeys. Bypasses AQA's flow/page model entirely.

---

## Goal

Run a user journey in Playwright, scan each step's DOM against an AQA ruleset, and emit an issue report — without creating anything in the AQA dashboard.

## When to use

- You want a11y checks in CI on every PR / nightly.
- You have stateful journeys (login, cart, mid-wizard) that can't be expressed as a URL flow.
- You're OK with results living in your repo / JIRA instead of the AQA UI.
- Keyboard-nav testing is handled separately (not covered by `/evaluate`).

## When NOT to use

- You want the flow to appear in AQA's dashboard with run history and scheduler. Use Approach 2 or the public API bulk-create instead.
- You want AQA to run keyboard navigation. `/evaluate` is DOM-only; no keyboard simulation.

---

## Architecture

```
┌─ journey.yaml ──────┐      ┌─ runner (Node/TS) ──┐     ┌─ AQA API ──────────┐
│ steps: click, fill, │ ───► │ 1. Playwright exec  │ ──► │ POST /a11y/tests/  │
│ wait, snapshot      │      │ 2. inject analyzer  │     │      evaluate      │
└─────────────────────┘      │ 3. _aqaProcessDOM() │     │  (stateless)       │
                             │ 4. POST per step    │ ◄── │  issues[]          │
                             │ 5. aggregate report │     └────────────────────┘
                             └─────────────────────┘
                                        │
                                        ▼
                               report.json + report.html
                                        │
                                        ▼
                              CI artifact / JIRA ticket
```

## Runtime flow (per journey)

1. **Load** `journey.yaml`, resolve `${ENV_VAR}` placeholders for creds.
2. **Launch** Playwright (chromium, configured viewport / device emulation).
3. **Execute steps** in order. Step types:
   - `goto(url)`
   - `click(selector)`
   - `fill(selector, value)`
   - `waitFor(selector | networkIdle | timeout)`
   - `snapshot(label)` — marks a point to scan
4. **At each `snapshot` step:**
   - Inject `https://aqa.usablenet.com/aqapool/js/aqa-analyzer.js` if not already present.
   - Call `const html = await page.evaluate(() => window._aqaProcessDOM())`.
   - `POST https://api-aqa.usablenet.com/v3.1/{teamslug}/a11y/tests/evaluate` with:
     - `rulesetId` (from journey.yaml)
     - `pageUrl` (the current URL)
     - `code` (the HTML string)
     - Header: `x-team: <api-key>`
   - Store the returned issues keyed by the snapshot's `label`.
5. **Aggregate** all step results into a single report.
6. **Emit**:
   - `report.json` — full structured output
   - `report.html` — human-readable summary
   - CI exit code: non-zero if any `severity >= error` issues found (configurable)

## Inputs

- `journey.yaml` — the journey definition
- Env vars: `AQA_TEAMSLUG`, `AQA_API_KEY`, plus any credentials referenced in the YAML
- Optional: `rulesets.yaml` with named ruleset IDs

## Outputs

- `reports/{journey-name}/{timestamp}/report.json`
- `reports/{journey-name}/{timestamp}/report.html`
- Optional: JIRA issues created via existing JIRA integration
- CI status

## Dependencies

- Node 18+ or Bun
- `playwright` (`@playwright/test` optional)
- `js-yaml`
- `axios` or `undici` for the AQA POST
- AQA v3.1 API key with `x-team` scope

## Risks & limitations

| Risk | Mitigation |
|---|---|
| `_aqaProcessDOM()` changes | Pin a local copy of `aqa-analyzer.js`, refresh quarterly |
| Selector brittleness in Playwright | Use role/testid selectors; keep journeys short |
| No keyboard-nav coverage | Complement with AQA keyboard tests against URL flows (public API) |
| Issues live outside AQA UI | Expected tradeoff — document it for the team |
| Rate limits on `/evaluate` | Throttle, add retry/backoff, cache identical snapshots |

## Effort estimate

- Skeleton runner + one journey working end-to-end: **~3 days**
- Report formatter, CI wiring, retries: **~2 days**
- Total to production-usable: **~1 week**

## Open decisions

- Do we fail CI on `warning` or only on `error`?
- Where do reports land — repo artifacts, S3, JIRA, or all three?
- How do we diff week-over-week — checksum of issue IDs per snapshot?
