# aqa-usablenet-helper

Two agent skills that automate AQA accessibility coverage setup. Works with Claude Code, Cursor, Windsurf, and any other agent supported by the [open skills ecosystem](https://github.com/vercel-labs/skills).

Point your agent at a URL and your codebase — it discovers routes, explores the live site, proposes a coverage plan (URL flows, a11y tests, keyboard tests, schedulers), and on your approval creates everything in AQA via the v3.1 public API. For click-state pages (mega menus, mini-carts, mid-wizard), a companion skill drives the official PageCapture Chrome extension to produce import-ready ZIPs.

## The two skills

| Skill | What it does | Runtime deps | When to install |
|---|---|---|---|
| [`aqa-cover`](skills/aqa-cover/SKILL.md) | Orchestrates the whole workflow. Creates URL flows, a11y tests, keyboard tests, and schedulers via AQA's public API. | **Zero** (Node 20+ global `fetch`). | Always. |
| [`aqa-pagecapture`](skills/aqa-pagecapture/SKILL.md) | Drives the UsableNet PageCapture Chrome extension through a YAML journey to produce a ZIP for manual upload. Covers pages URL flows can't reach. | Playwright + js-yaml (~300 MB first install). | Only if your site has click-state pages. |

## Prerequisites

- Node.js 20+
- An AQA account with API access (team slug + API key)
- An agent CLI that supports the open skills ecosystem — see [available agents](https://github.com/vercel-labs/skills#available-agents)

## Install

### Both skills

```bash
npx skills add 1291pravin/aqa-usablenet-helper
```

By default this installs into your current project (`./.claude/skills/`, `./.cursor/skills/`, etc. depending on which agents you have). Add `-g` to install globally:

```bash
npx skills add 1291pravin/aqa-usablenet-helper -g
```

### Just one skill

```bash
npx skills add 1291pravin/aqa-usablenet-helper --skill aqa-cover
# or
npx skills add 1291pravin/aqa-usablenet-helper --skill aqa-pagecapture
```

### Target specific agents

```bash
npx skills add 1291pravin/aqa-usablenet-helper -a claude-code -a cursor
```

See `npx skills add --help` for all flags.

## First-run setup for `aqa-pagecapture`

`aqa-cover` works immediately — zero dependencies.

`aqa-pagecapture` needs a one-time `npm install` inside its skill folder on first use. Its SKILL.md tells the agent to run this automatically the first time you invoke it:

```bash
cd <skill-dir> && npm install
```

The first install downloads the Playwright Chromium binary (~300 MB, 2–3 min). Subsequent runs skip the install.

If the auto-install fails (network, permissions, etc.), run it yourself in the skill's install directory — typically `.claude/skills/aqa-pagecapture/` or wherever your agent installed it.

## Environment setup

Add to your `.env` or shell profile:

```bash
AQA_TEAMSLUG=your-team-slug
AQA_API_KEY=your-api-key
```

For auth-gated journeys, also set credentials — referenced by env var, never hardcoded in YAML:

```bash
TEST_USER_EMAIL=testuser@example.com
TEST_USER_PASSWORD=supersecret
```

## Usage

Open your agent in a frontend project directory and say:

```
Cover https://shop.example.com with AQA
```

With options:

```
Cover https://shop.example.com with AQA --suite "My Store" --user testuser@example.com --pass-env TEST_USER_PASSWORD
```

The `aqa-cover` skill will walk through 7 phases:

| Phase | What happens |
|-------|-------------|
| 1. Scout codebase | Discovers routes, auth gates, and stable selectors from source files |
| 2. Explore live site | Visits pages, notes click-state UI (menus, carts, modals) |
| 3. Check AQA | Lists available rulesets and devices; verifies the suite exists |
| 4. Compose plan | Writes `reports/<suite>/<timestamp>/plan.md` with full proposed test setup |
| 5. Approval gate | Shows counts — you approve, dry-run, or request changes |
| 6. Execute | Creates URL flows, a11y tests, keyboard tests, and schedulers via API |
| 7. Wrap up | Writes `NEXT-STEPS.md` listing what was done and what needs manual action |

For click-state pages, the plan defers them to `aqa-pagecapture`. If that skill is installed, you can then say:

```
Capture the mega-menu-open journey from <path/to/journey.yaml>
```

…and drag the resulting ZIP into the AQA dashboard.

## What gets created automatically (via `aqa-cover`)

- URL flows (one per publicly reachable route)
- A11y test per flow (ruleset: `wcag21_aa` by default)
- Keyboard test per flow
- Weekly scheduler per test (infinite repeats)

## What needs a manual upload step (via `aqa-pagecapture`)

- Pages with click-state UI (mega menus, mini-carts, mid-wizard states) → captured as AQA-format ZIPs. You drag them into the AQA UI; the API doesn't expose a ZIP-import endpoint.

## Options (aqa-cover)

| Flag | Default | Description |
|------|---------|-------------|
| `--suite <name>` | derived from hostname | AQA suite to populate |
| `--codebase <path>` | current directory | Frontend repo root |
| `--user <email>` | — | Test account username for auth-gated pages |
| `--pass-env <VAR>` | — | Env var holding the password (never a raw value) |
| `--dry-run` | false | Produce plan only; do not mutate AQA |

## Standalone script usage

Both scripts are runnable outside the agent. Substitute `<skill-dir>` with the actual install path (e.g. `.claude/skills/aqa-cover/`):

```bash
# aqa-cover
node <skill-dir>/scripts/aqa.mjs rulesets
node <skill-dir>/scripts/aqa.mjs devices
node <skill-dir>/scripts/aqa.mjs suites.ensure --name "My Store"
node <skill-dir>/scripts/aqa.mjs flows.urlCreate --suite <id> --name "Home" --url https://example.com --device D1

# aqa-pagecapture
node <skill-dir>/scripts/pagecapture.mjs <skill-dir>/examples/journey.yaml --out ./out
```

Run any script with no args (or `--help`) for its full command reference.

## Journey YAML format

Click-state flows are driven by YAML journeys. See [`skills/aqa-pagecapture/examples/journey.yaml`](skills/aqa-pagecapture/examples/journey.yaml) for a full example covering login, mega-menu open state, add-to-cart, and mini-cart. Schema documented in the skill's SKILL.md.

## Repository layout

```
skills/
  aqa-cover/              — zero-dep skill + API helper
    SKILL.md
    scripts/aqa.mjs
  aqa-pagecapture/        — opt-in, Playwright + extension
    SKILL.md
    package.json
    scripts/pagecapture.mjs
    pagecapture_src/      — unpacked PageCapture Chrome extension
    examples/journey.yaml
archive/                  — earlier exploration docs + original scripts
```

## License

See the PageCapture extension source in `skills/aqa-pagecapture/pagecapture_src/` — that's UsableNet's code, included unpacked so the skill can load it via `--load-extension`. Everything else in this repo is covered by the project's license.
