# Approach 2 — Playwright + real PageCapture extension

AI-driven recording that produces AQA-format ZIP bundles using the official PageCapture extension. Result: a real flow in the AQA dashboard, with weekly re-runs handled by AQA.

---

## Goal

Let AI drive a browser through a multi-step journey, let the official UsableNet PageCapture extension snapshot each step, and emit a ZIP that a human drops into the AQA UI to create a flow.

## When to use

- You want the flow visible in AQA dashboard (with run history, scheduler, keyboard tests attached).
- Your journey has click-state pages that can't be expressed as a URL (mega-menu open, cart-with-items, mid-wizard).
- You have enough of these journeys to justify automation (≥10 per quarter).

## When NOT to use

- Under ~10 click-state journeys total — manual PageCapture is cheaper.
- You need fully hands-off automation every time — this approach has a manual upload step unless you also automate the AQA web UI (fragile, unsupported).
- You can't give an automated browser a stable test account.

## Why use the real extension (not a clone)

- The ZIP format is **undocumented**. The extension's `snapshotter.bundle.js` captures DOM + computed styles + frame boundaries in a vendor-specific layout.
- If UsableNet changes the format, the extension auto-updates; our code keeps working.
- Reverse-implementing the format = 1–2 weeks upfront + ongoing fragility.

---

## Architecture

```
┌─ journey.yaml ─────┐   ┌─ runner (Node/TS) ───────────────────────┐
│ steps + snapshots  │──►│ 1. launch Chromium + PageCapture ext      │
│ (same schema as    │   │ 2. AI/Playwright executes steps           │
│  Approach 1)       │   │ 3. fire Ctrl+Shift+S at each snapshot     │
└────────────────────┘   │ 4. extension accumulates + zips on export │
                         │ 5. pick up ZIP from Downloads folder      │
                         └───────────────────────────────────────────┘
                                            │
                                            ▼
                                  out/{journey-name}.zip
                                            │
                                            ▼
                          ┌─ manual step ─────────────────────┐
                          │ User opens AQA UI → Import flow   │
                          │ → drag-drop the ZIP → flow created│
                          └───────────────────────────────────┘
                                            │
                                            ▼
                          AQA runs it weekly (native scheduler,
                          keyboard tests attached via public API)
```

## Runtime flow (per journey)

1. **Load** `journey.yaml`.
2. **Launch Chromium in headed mode** with the PageCapture extension loaded from a local unpacked copy.
   - Headed is required — the extension's keyboard shortcut dispatch relies on an active window context.
   - Use a fresh user-data dir per run to isolate cookies / extension state.
3. **Open DevTools programmatically** (the extension's panel runs in DevTools). The snapshot buffer lives there.
4. **Execute steps** — same schema as Approach 1 (`goto`, `click`, `fill`, `waitFor`, `snapshot`).
5. **At each `snapshot`:**
   - `page.keyboard.press('Control+Shift+S')` (or `Meta+Shift+S` on Mac).
   - Wait for the extension's confirmation toast / storage event indicating capture complete.
6. **At journey end:**
   - Trigger the extension's "export ZIP" action (via DevTools panel button click, since the extension exposes it there).
   - Watch the user's Downloads folder for `{flowName}.zip`.
   - Move it to `out/{journey-name}.zip`.
7. **Output:** the ZIP + a manifest describing which journey produced it.

## The AI layer

For each journey, AI can:
- **Translate NL → steps**: *"log in as testuser, accept cookies, open mega menu, click Men's Shoes, open first PDP, add to cart"* → ordered YAML steps.
- **Recover from selector drift**: when a step fails, inspect the DOM, propose a new selector, retry.
- **Recognize implicit steps**: detect cookie banners, overlays, "are you in the right country" modals and dismiss them before proceeding.

The AI does **not** generate the ZIP or touch the capture format — that stays with the extension.

## Inputs

- `journey.yaml`
- Path to unpacked PageCapture extension (`./pagecapture_src/` — already in repo)
- Env vars for test credentials
- Optional: `AQA_TEAMSLUG`, `AQA_API_KEY` only if you also auto-create keyboard tests via public API after the flow is imported

## Outputs

- `out/{journey-name}-{timestamp}.zip` — ready for AQA UI upload
- `out/{journey-name}-{timestamp}.manifest.json` — what was captured, when, by which journey revision
- (Optional) screenshots per step for human review

## Dependencies

- Node 18+ / Bun
- `playwright` — must launch with `--disable-extensions-except` + `--load-extension`
- Chromium-based browser (Firefox extensions won't work here)
- Unpacked PageCapture extension source (we already extracted it to `pagecapture_src/`)
- Optional LLM API key (Anthropic/OpenAI) for the AI layer

## Risks & limitations

| Risk | Mitigation |
|---|---|
| Extension keyboard shortcut doesn't fire | Fallback: send a DevTools panel click event, or message the extension via `chrome.runtime` |
| Extension updates change behavior | Pin to a specific CRX version; check in the unpacked copy |
| ZIP format changes | We don't generate it — vendor owns this; low risk |
| Upload to AQA UI still manual | Either accept it, or build fragile Playwright automation of the AQA web UI |
| AI navigation is non-deterministic | Human reviews a screenshot trail before the ZIP is accepted into the upload queue |
| Test creds exposed in headed browser | Dedicated test accounts, never production |
| Weekly re-run assumes flow still valid | AQA re-runs the captured DOMs, not the live site — so site changes don't invalidate past captures, but you'll want to re-capture when UX changes |

## Effort estimate

- PoC: launch Chromium + extension + capture a single 3-step journey + export ZIP: **~3 days**
- AI NL→steps layer with one journey end-to-end: **~1 week**
- Robust selector recovery, screenshot trail, manifest output: **~1 week**
- (Optional) automated AQA UI upload: **+1 week, ongoing maintenance**
- Total without auto-upload: **~2.5 weeks**
- Total with auto-upload: **~3.5 weeks** + ongoing fragility

## Open decisions

- Headed-only or do we try xvfb for headless? (Extension may not work headless.)
- Do we automate the AQA UI upload, or accept the manual drop step?
- Review gate: who signs off on an AI-captured ZIP before it goes to AQA?
- How do we version journeys — one file per journey or one file with many?

---

## Note on public-API overlap

After the flow is imported into AQA, the public v3.1 API **can** attach keyboard tests, schedulers, and notification groups to it. So Approach 2 produces the flow; the bulk-API script we discussed earlier handles everything that comes after. The two pieces compose.
