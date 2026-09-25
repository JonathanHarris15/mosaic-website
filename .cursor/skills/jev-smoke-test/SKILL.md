---
name: jev-smoke-test
description: Required before PR for any user-visible/hosted UI change (public/, Hosting, mobile). Run fastbrowse + local Jev against the Hosting emulator or a preview URL; repeat after the final fix commit. Skip only when keys or uv are absent (exact PR line) or the change has no UI effect. See .cursor/rules/smoke-test.mdc.
---

# Jev smoke test (fastbrowse)

[fastbrowse](https://github.com/agent-labs-dev/fastbrowse) (MIT, PyPI `fastbrowse`, v0.5.3+) drives a **local** headless browser with **Jev** for quick, read-only UI checks. **Required** for hosted UI changes: run before opening or marking a PR ready, and again after the final fix commit (see `.cursor/rules/smoke-test.mdc`).

**Never** smoke-test production with a real login. Use the Firebase Hosting emulator (`http://localhost:5005`, see `.cursor/environment.json`) or a **preview** URL only.

If this file is missing in your checkout, the environment snapshot is stale — run `git fetch origin main` and read `.cursor/skills/jev-smoke-test/SKILL.md` from `origin/main` before proceeding.

## Install

Python **3.13+** is pulled by `uv` when needed.

Install `uv` in this order (stop at the first method that yields a working `uv` on `PATH`):

1. Use an existing `uv` if `command -v uv` succeeds.
2. `pip install --user uv`
3. `pipx install uv`

After (2) or (3), ensure user-local tools are on `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

If none of the above works, **skip** the smoke test, do not fail the task, and note in the PR body: `jev smoke test skipped: uv unavailable`.

Then install fastbrowse:

```bash
export PATH="$HOME/.local/bin:$PATH"
uv tool install fastbrowse==0.5.3
```

One-off without installing:

```bash
export PATH="$HOME/.local/bin:$PATH"
uvx fastbrowse --help
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

### Optional: cheaper OpenRouter model (smoke runs)

fastbrowse **0.5.3** defaults (via OpenRouter): `google/gemini-3.8-flash` with `low` reasoning for RECOVER, READ, VERIFY, and COMPOSE (~$0.75/M input, $3.75/M output); `google/gemini-3.5-flash-lite` for PLAN, FIELD_TEXT, and SHORTCUT. Override with `FASTBROWSE_LLM_MODEL` (all purposes) or per-purpose `FASTBROWSE_LLM_MODEL_RECOVER`, `_READ`, `_VERIFY`, `_COMPOSE`, `_PLAN`, `_FIELD_TEXT`, `_SHORTCUT`.

Measured on the standard hymn task against `https://mosaic-hymn-database.web.app` (3 runs each, read-only): default median ~$0.014/run and ~16s wall time; **`openai/gpt-6-luna`** via `FASTBROWSE_LLM_MODEL` was **3/3** correct at median ~**$0.006** (~57% cheaper) and ~18s (not meaningfully slower). All-purpose `google/gemini-3.5-flash-lite` was also 3/3 (~$0.009, ~12s). `qwen/qwen3.8-flash`, `deepseek/deepseek-v4.1-flash`, and `z-ai/glm-5.3-flash` were not reliable enough for this task.

- Read keys from the environment only. **Never** put keys in git, skills, PRs, or shell history in commits.
- **Do not** use `BROWSER_USE_API_KEY` or any cloud browser integration.
- **Always** pass `--local` on every `fastbrowse` invocation.

## Skip when keys or tooling are absent

If `OPENROUTER_API_KEY` is unset, **or** neither `AI_GATEWAY_API_KEY` nor `TYPESAFE_API_KEY` is set:

1. **Skip** the smoke test entirely.
2. Do **not** fail the task and do **not** ask the user for keys.
3. In the PR body (test evidence section), add exactly:

   `jev smoke test skipped: key(s) absent`

If `uv` cannot be installed (see Install) or `fastbrowse` is not available after install attempts, skip and add:

`jev smoke test skipped: uv unavailable`

Shell guard (use before running fastbrowse):

```bash
export PATH="$HOME/.local/bin:$PATH"

jev_keys_ready() {
  [ -n "${OPENROUTER_API_KEY:-}" ] && { [ -n "${AI_GATEWAY_API_KEY:-}" ] || [ -n "${TYPESAFE_API_KEY:-}" ]; }
}

jev_tooling_ready() {
  command -v fastbrowse >/dev/null 2>&1 || command -v uv >/dev/null 2>&1
}

if ! jev_keys_ready; then
  echo "jev smoke test skipped: key(s) absent"
elif ! jev_tooling_ready; then
  echo "jev smoke test skipped: uv unavailable"
else
  # run fastbrowse (see below)
fi
```

## When to use (mandatory)

- Any change to **hosted UI** under `public/` or other Firebase Hosting surfaces (including CSS/JS the emulator serves).
- Functions or rules changes that alter what a page shows — smoke-test that page.
- Bug fixes: repro path before the fix and after, when feasible.
- Write **1–3 targeted natural-language tasks** per changed screen (happy path + one edge case if useful). Do not run a single vague “check the app” task.

## Local hosting emulator

For hosting-only smoke tests, do **not** use a `demo-*` project id — `.firebaserc` only defines hosting targets for `mosaic-hymn-database` and `mosaic-manager-ghost`, so a demo project fails to start Hosting.

From the repo root (after `npm ci` in root and `functions/`):

```bash
npx firebase emulators:start --only hosting --project mosaic-hymn-database
```

Hosting listens on port **5005** (see `.cursor/environment.json`). This mode serves **static files from `public/` only**; it does not write production Firestore or other live backend data. Keep checks **read-only** with **no login**.

If the emulator is impractical, use a Firebase Hosting **preview** URL for the branch as the fallback `--start` URL.

## Running the smoke test

1. Start local Hosting (command above) **or** use a preview URL.
2. Run headless, local, with a tight budget:

```bash
export PATH="$HOME/.local/bin:$PATH"
# Optional: cheaper all-purpose OpenRouter model (see API keys section)
export FASTBROWSE_LLM_MODEL=openai/gpt-6-luna

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

### Verified reference (sanity check)

A Cloud Agent trial on **fastbrowse 0.5.3** against the local Hosting emulator reported: **exit 0**, JSON **`status`: `complete`**, cost **~$0.005**, wall time **~10s**. Use that as a ballpark for a single read-only page check; your run may differ slightly.

### PR body evidence

When smoke runs, add to the PR **Smoke test** section:

- Command(s) run (omit secrets).
- Final `status` from JSON.
- **Quoted** excerpts from the result that cite what was seen on the page (headings, labels, visible copy).

When skipped, use the exact skip line from the sections above (`key(s) absent` or `uv unavailable`).

## Safety rules (mandatory)

- **Never** pass: `--authorize`, `--secret`, `--bitwarden`, `--profile`, `--cloud-profile`.
- **No** sign-in flows, **no** form submits, **no** destructive actions.
- Read-only checks of the changed UI only (load page, confirm visible content / controls).
- Keep `--max-dollars` small (e.g. `0.10`).
- **Always** `--local`.

## Emulator ports (full suite)

When you need more than static Hosting, the full emulator set uses:

| Service | Port |
| --- | --- |
| Firebase Hosting | 5005 |
| Functions | 5001 |
| Firestore | 8080 |
| Auth | 9099 |
| Emulator UI | 4000 |

For jev smoke tests, prefer `--only hosting` with `--project mosaic-hymn-database` unless the changed UI truly requires Functions or emulated Auth.
