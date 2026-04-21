# Plan — Approach 1: Playwright + `/a11y/tests/evaluate`

## Context

The repo today is greenfield for this approach: only the spec doc (`docs/approach-1-evaluate.md`), a shared example journey (`examples/journey.yaml`), the AQA OpenAPI (`aqa_openapi.json`), and the PageCapture extension source (used by Approach 2 only). We need to build a **stateless CLI runner** that drives a Playwright journey, snapshots DOM via AQA's `aqa-analyzer.js`, POSTs each snapshot to `/a11y/tests/evaluate`, and emits a local JSON + HTML report with a configurable CI exit code.

**Intended outcome:** `npx aqa-eval examples/journey.yaml` runs end-to-end on a laptop and in CI, producing `reports/{journey}/{timestamp}/report.{json,html}` and exiting non-zero when `failOn` severity is hit. No AQA dashboard state is created.

**Key spec decisions:** Node 20 + TypeScript; fetch `aqa-analyzer.js` from `https://aqa.usablenet.com/aqapool/js/aqa-analyzer.js` and cache per-run; honor `output.report.failOn` from YAML; local-only reports in v1 (no JIRA/S3).

**Key API facts (from `aqa_openapi.json:9464` `/a11y/tests/evaluate`):**
- Body is `application/x-www-form-urlencoded` **or** `multipart/form-data` — **not JSON** (the doc's prose is imprecise here).
- Required fields: `rulesetId`, `pageUrl`, `code`.
- Auth: `x-team: <api-key>` header; path is `/v3.1/{teamslug}/a11y/tests/evaluate`.
- Response: `{ issues[], propertyTitles, descriptions, status: "ok"|"error", error? }`. Each issue has `ruleId`, `solutionId`, `selectors[]`, `properties[]` (contains severity-ish tags like `"needs fix"`, `"high"`, `"average"`), `ruleTitle`, `tagName`, `technology`, `responsibility`.

---

## Project layout (new files)

```
aqa-usablenet-helper/
├─ package.json                         # deps, scripts, bin: aqa-eval
├─ tsconfig.json                        # strict TS, NodeNext, target ES2022
├─ .gitignore                           # node_modules/, reports/, .env
├─ .env.example                         # AQA_TEAMSLUG, AQA_API_KEY, TEST_USER_*
├─ README.md                            # quickstart only
└─ src/
   ├─ cli.ts                            # argv → runJourney(); exit code
   ├─ runner.ts                         # orchestrates load→launch→steps→report
   ├─ journey/
   │  ├─ schema.ts                      # Zod schema for journey.yaml
   │  ├─ load.ts                        # parse YAML + ${ENV} substitution
   │  └─ types.ts                       # inferred Journey, Step, SnapshotStep
   ├─ steps/
   │  └─ execute.ts                     # one switch over Step['type']; handles goto|click|fill|hover|waitFor|snapshot
   ├─ snapshot/
   │  ├─ analyzer.ts                    # fetchAnalyzerSource() + injectAndCapture()
   │  └─ capture.ts                     # awaits _aqaProcessDOM() → string
   ├─ aqa/
   │  └─ evaluate.ts                    # postEvaluate({rulesetId,pageUrl,code}) → EvaluateResponse
   ├─ report/
   │  ├─ aggregate.ts                   # snapshot results → unified Report
   │  ├─ json.ts                        # writeJsonReport(report, dir)
   │  ├─ html.ts                        # writeHtmlReport(report, dir) — single-file template
   │  └─ failPolicy.ts                  # shouldFailCi(report, failOn)
   └─ util/
      ├─ env.ts                         # ${VAR} interpolation for YAML strings
      └─ log.ts                         # thin pino/console wrapper
```

Tests are deferred to v1.1 — see "Out of scope" below.

## Dependencies (package.json)

- `playwright` — browser driver (installs Chromium on first run).
- `js-yaml` + `@types/js-yaml` — parse journey.yaml.
- `zod` — validate parsed YAML against schema.
- `undici` — AQA POST (already in Node, but pinning the package lets us use `FormData`/`fetch` cleanly with explicit version).
- `commander` — small CLI surface.
- `tsx` (dev) — run TS directly for dev ergonomics.
- `typescript` (dev) — for `tsc` build → `dist/`.

`bin.aqa-eval` → `dist/cli.js`.

---

## Module contracts

### `src/journey/schema.ts`
Zod schema mirroring `examples/journey.yaml`:
- Top level: `name`, `description?`, `rulesetId`, `device{name,viewport,userAgent}`, `startUrl`, `secrets?`, `defaults{stepTimeoutMs,networkIdleMs}`, `steps[]`, `output.report{formats[], failOn: 'error'|'warning'|'any'|'none'}`.
- `steps[]` is a discriminated union on `type`: `goto | click | fill | hover | waitFor | snapshot`. Optional `optional: boolean` on any step means "don't fail the run if it doesn't match" (example uses this for the cookie banner).
- Approach-2-only keys (`output.bundle`, `postImport`) are allowed-but-ignored — validate with `.passthrough()` so the same file drives both runners.

### `src/journey/load.ts`
- Read file → `js-yaml.load` → `interpolateEnv(obj, process.env)` → `JourneySchema.parse`.
- `interpolateEnv` walks strings, replaces `${VAR}` and `{{startUrl}}` / `{{secrets.username}}` / `{{name}}` / `{{timestamp}}` using a small context object `{ startUrl, secrets, name, timestamp }`. Missing env vars throw unless the referencing step is `optional: true`.

### `src/steps/execute.ts`
Single `executeStep(page, step, ctx)` function. For `snapshot`, calls `captureSnapshot(page)` → `postEvaluate(...)` and returns `{ label, pageUrl, issues, status }`. `optional` wraps the entire step body in try/catch; log and continue on selector miss (narrow to `TimeoutError`/element-not-found).

### `src/snapshot/analyzer.ts`
- `fetchAnalyzerSource()`: first call hits `https://aqa.usablenet.com/aqapool/js/aqa-analyzer.js`, caches the text in a module-level variable for the process lifetime. Exactly the pattern documented at `aqa_openapi.json:9470`.
- `injectAndCapture(page)`: if `window._aqaProcessDOM` undefined, `page.addScriptTag({ content: analyzerSource })`; then `page.evaluate(() => window._aqaProcessDOM())` → string.

### `src/aqa/evaluate.ts`
```ts
async function postEvaluate(args: {
  teamslug: string; apiKey: string;
  rulesetId: string; pageUrl: string; code: string;
}): Promise<EvaluateResponse>
```
- URL: `https://api-aqa.usablenet.com/v3.1/${teamslug}/a11y/tests/evaluate`.
- Body: `application/x-www-form-urlencoded` via `URLSearchParams` (simpler than multipart for string payloads).
- Headers: `x-team: <apiKey>`, `content-type: application/x-www-form-urlencoded`.
- Retry with exponential backoff on `429` and `5xx` (3 attempts, 1s→2s→4s).
- Response typed against OpenAPI: `{ issues, propertyTitles, descriptions, status, error? }`. If `status === 'error'`, surface `error` in the report but don't throw — the run continues to later snapshots.

### `src/report/aggregate.ts`
Shape:
```
Report {
  journey: { name, rulesetId, startedAt, finishedAt, device }
  snapshots: Array<{
    label, description?, pageUrl, capturedAt,
    status: 'ok'|'error', error?,
    issues: Issue[],                 // raw from API
    counts: { error, warning, info } // derived from issue.properties
  }>
  totals: { error, warning, info }
}
```
Severity derivation: the `properties[]` array embeds tags like `"needs fix" | "check manually"` and impact `"high" | "medium" | "low"`. Start simple: `"needs fix"` → `error`, `"check manually"` → `warning`, anything else → `info`. Centralize this in one helper so it's easy to tune.

### `src/report/failPolicy.ts`
`shouldFailCi(report, failOn)`:
- `error` → any snapshot with `counts.error > 0`.
- `warning` → `counts.error + counts.warning > 0`.
- `any` → any issue at all, or any snapshot with `status: 'error'`.
- `none` → always false.

### `src/report/html.ts`
Single self-contained HTML file — inline `<style>`, no JS framework. Sections: journey header, per-snapshot card with counts badge, expandable issue table (rule, selector, severity, responsibility, solution text pulled from `descriptions[ruleId][solutionId]`). Keep it ≤ ~250 LOC; readability over polish.

### `src/cli.ts`
```
aqa-eval <journey.yaml> [--fail-on=error|warning|any|none] [--out=reports/] [--headed]
```
Exit codes: `0` pass, `1` fail policy tripped, `2` runner error (YAML invalid, launch failed, network down for all snapshots).

---

## Runtime flow (matches `docs/approach-1-evaluate.md:43`)

1. Parse CLI → load + validate journey → mint `runId = timestamp`.
2. Launch Chromium with the journey's viewport/userAgent; new context per run.
3. Walk steps sequentially. For each `snapshot`:
   a. `injectAndCapture(page)` → HTML string.
   b. `postEvaluate({ rulesetId, pageUrl: page.url(), code })` → response.
   c. Push into results keyed by `label`.
4. After last step: `aggregate()` → write `reports/{name}/{runId}/report.json` and `report.html`.
5. Apply `shouldFailCi` → process exit code.
6. Always close browser in `finally`.

## Inputs / outputs

**Inputs:** `examples/journey.yaml` (existing); env vars `AQA_TEAMSLUG`, `AQA_API_KEY`, plus any referenced by `secrets` block (e.g. `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`).

**Outputs:** `reports/{journey-name}/{YYYY-MM-DDTHH-MM-SS}/report.json` and `.../report.html`.

---

## Out of scope for v1 (deferred)

- Keyboard-nav coverage — doc explicitly excludes this (`/evaluate` is DOM-only).
- JIRA and S3 sinks — noted "optional" in the doc; add after v1 ships.
- Week-over-week diffing (one of the doc's open decisions) — report JSON is stable enough to diff externally.
- Automated tests for the runner itself — add a small vitest suite in v1.1 covering `interpolateEnv`, `shouldFailCi`, and severity mapping.

## Verification

1. **Static:** `npm run typecheck` passes (`tsc --noEmit`).
2. **Schema:** `npx aqa-eval examples/journey.yaml --dry-run` (add a `--dry-run` that loads + validates and prints the parsed journey, no browser). Confirms the existing example YAML parses without edits.
3. **End-to-end against a public page:** create a throwaway `examples/smoke.yaml` with `startUrl: https://example.com` + one `snapshot`. Run with real `AQA_TEAMSLUG`/`AQA_API_KEY`, confirm:
   - `reports/smoke/{ts}/report.json` written and contains ≥1 snapshot entry with `status: "ok"`.
   - `report.html` opens in a browser and renders.
   - Exit code matches `failOn` policy.
4. **End-to-end against the real journey:** run `examples/journey.yaml` (requires valid `TEST_USER_*`). Spot-check the mega-menu snapshot appears and has issues attached — this is the click-state the approach is meant to capture.
5. **Failure paths to confirm:**
   - Bad API key → exit 2, clear error.
   - Selector miss on a non-`optional` step → exit 2.
   - Selector miss on `optional: true` cookie banner → run continues, warning logged.
   - `failOn: error` + at least one "needs fix" issue → exit 1.

## Critical files touched / created

- **Created:** everything under `src/`, plus `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`.
- **Read-only references:** `examples/journey.yaml` (drives the schema), `aqa_openapi.json:9464` (endpoint shape), `docs/approach-1-evaluate.md` (spec of record).
- **Not touched:** `pagecapture_src/` and `docs/approach-2-pagecapture.md` — Approach 2's territory.
