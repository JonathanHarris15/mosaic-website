---
name: jev-smoke-test
description: Smoke-test UI changes with fastbrowse (local Jev + headless Chrome) against the Firebase Hosting emulator or a preview URL before opening a PR. Use after editing hosted surfaces in public/ when keys are present; skip gracefully when API keys are absent.
---

# Jev smoke test (fastbrowse)

[fastbrowse](https://github.com/agent-labs-dev/fastbrowse) (MIT, PyPI `fastbrowse`, v0.5.3+) drives a **local** headless browser with **Jev** for quick, read-only UI checks. Run this **after** UI changes and **before** opening or updating a PR.

**Never** smoke-test production with a real login. Use the Firebase Hosting emulator (`http://localhost:5005`, see `.cursor/environment.json`) or a **preview** URL only.

## Install

Python **3.13+** is pulled by `uv` when needed.

```bash
# Preferred: install the CLI as a uv tool
uv tool install fastbrowse

# One-off without installing
uvx fastbrowse --help
```

If `uv` is missing:

```bash
pip install --user uv
# or: pipx install uv
export PATH="$HOME/.local/bin:${PATH:-}"
```

Chrome or Chromium must be on `PATH`, or set:

```bash
export FASTBROWSE_CHROME=/path/to/chromium
```

Cloud Agent bootstrap may install `fastbrowse` opportunistically via `.cursor/install.sh` (non-fatal). Agents can still install manually with the commands above.

## API keys (env only — never commit)

| Role | Variable | Notes |
| --- | --- | --- |
| Jev (browser agent) | `AI_GATEWAY_API_KEY` | Vercel AI Gateway |
| Jev (alternate) | `TYPESAFE_API_KEY` | [TypeSafe console](https://console.typesafe.ai) |
| Planner / reader LLM | `OPENROUTER_API_KEY` | Required for fastbrowse’s planner |

- Read keys from the environment only. **Never** put keys in git, skills, PRs, or shell history in commits.
- **Do not** use `BROWSER_USE_API_KEY` or any cloud browser integration.
- **Always** pass `--local` on every `fastbrowse` invocation.

## Skip when keys are absent

If `OPENROUTER_API_KEY` is unset, **or** neither `AI_GATEWAY_API_KEY` nor `TYPESAFE_API_KEY` is set:

1. **Skip** the smoke test entirely.
2. Do **not** fail the task and do **not** ask the user for keys.
3. In the PR body (test evidence section), add exactly:

   `jev smoke test skipped: key(s) absent`

Shell guard (use before running fastbrowse):

```bash
jev_smoke_ready() {
  if [ -z "${OPENROUTER_API_KEY:-}" ]; then return 1; fi
  if [ -z "${AI_GATEWAY_API_KEY:-}" ] && [ -z "${TYPESAFE_API_KEY:-}" ]; then return 1; fi
  return 0
}

if ! jev_smoke_ready; then
  echo "jev smoke test skipped: key(s) absent"
else
  # run fastbrowse (see below)
fi
```

## When to use

- After changing any **hosted UI** under `public/` (or other surfaces served by Firebase Hosting).
- **Before** creating or updating the PR.
- Write **1–3 targeted natural-language tasks** per changed screen (happy path + one edge case if useful). Do not run a single vague “check the app” task.

## Running the smoke test

1. Serve the page locally (`firebase emulators:start` → Hosting on port **5005**) **or** use a Firebase Hosting **preview** URL for the branch.
2. Run headless, local, with a tight budget:

```bash
fastbrowse "Confirm the page loads and shows <expected text or element>" \
  --start "http://localhost:5005/<path>" \
  --local \
  --max-steps 15 \
  --max-dollars 0.10 \
  --json
```

Replace `--start` with a preview URL when the emulator is not running.

### Pass / fail

- **Pass:** exit code **0** and JSON `status` is **`complete`** only.
- **Fail:** any other terminal status, including `unverified`, `needs_confirmation`, `needs_login`, `blocked`, `stuck`, `budget_exceeded`, `error`, or non-zero exit code.

On failure, fix the UI or tighten the task; do not open the PR claiming the smoke passed.

### PR body evidence

When smoke runs, add to the PR **test evidence** section:

- Command(s) run (omit secrets).
- Final `status` from JSON.
- **Quoted** excerpts from the result that cite what was seen on the page (headings, labels, visible copy).

When skipped, use the single line: `jev smoke test skipped: key(s) absent`.

## Safety rules (mandatory)

- **Never** pass: `--authorize`, `--secret`, `--bitwarden`, `--profile`, `--cloud-profile`.
- **No** sign-in flows, **no** form submits, **no** destructive actions.
- Read-only checks of the changed UI only (load page, confirm visible content / controls).
- Keep `--max-dollars` small (e.g. `0.10`).
- **Always** `--local`.

## Emulator reminder

| Service | Port |
| --- | --- |
| Firebase Hosting | 5005 |
| Functions | 5001 |
| Firestore | 8080 |
| Auth | 9099 |
| Emulator UI | 4000 |

Start emulators from the repo root after `npm ci` in root and `functions/`; use a demo Firebase project id so a mistake cannot touch production data.
