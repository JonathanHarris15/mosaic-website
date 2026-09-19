# mosaic-website — agent notes

Firebase-hosted church app. Static frontend in `public/`, Cloud Functions in `functions/`, domain language in `CONTEXT.md`, Jira board rules in `CLAUDE.md`. Product tickets are **MS-***.

Do not edit `firestore.rules` or `storage.rules` unless the ticket is explicitly about those rules. Do not deploy from this box (`firebase deploy` / `npm run deploy --prefix functions`). Hosting + `publicForm` + `onAttendanceCreated` ship via GitHub Actions `.github/workflows/firebase-deploy.yml` (`workflow_dispatch` or push to `main`). Standing `--only` set: `docs/ops/ms-545-functions-deploy-set.md`. Do not commit secrets. Do not set App Check to enforce in that workflow.

## Cursor Cloud

Cloud agents start from a checkout of this repo. Dependencies are **not** in git. There are two npm packages, each with its own lockfile:

| Tree | Lockfile | What it is for |
| --- | --- | --- |
| repo root | `package-lock.json` | unit tests (`node --test`), Tailwind, Capacitor, Firebase CLI |
| `functions/` | `functions/package-lock.json` | Cloud Functions (Node **20**), ESLint |

`.cursor/environment.json` runs `.cursor/install.sh` on Build. That script is idempotent: it always `npm ci`s both trees from the lockfiles and does not start servers. Re-running it on a warm disk is expected.

If install has not run in this session:

```bash
bash .cursor/install.sh
```

Equivalent by hand:

```bash
npm ci --no-audit --no-fund
npm ci --prefix functions --no-audit --no-fund
```

Do **not** `npm install` without a reason — that rewrites lockfiles. Do not `npm ci` in `build/tiptap/` unless you are rebuilding the vendored editor (`npm run vendor:tiptap`).

### Verify before you claim done

These are the real scripts. Use them; do not invent aliases.

```bash
npm test                          # root: node --test  (unit suite in test/)
npm run lint --prefix functions   # functions/: eslint .
```

PR CI (`.github/workflows/pr-ci.yml`) runs exactly those two after `npm ci` on both trees, on Node **20** (the `functions.engines` version). Cloud Agent VMs may be Node 22; `npm ci --prefix functions` then warns `EBADENGINE` and still installs.

`npm test` is the default unit gate. It does **not** start emulators. Tests under `test/emulator/` skip unless `FIRESTORE_EMULATOR_HOST` is set (they `require('firebase-admin')` at load; that module comes from the root `npm ci`).

Both commands currently fail on `main`. That is existing product debt, not a reason to rewrite `functions/` or calendar tests in an unrelated PR:

| Command | Baseline observed 2026-09-18 |
| --- | --- |
| `npm test` | ~4424 pass, **59 fail**, 18 skip (AccessCore globals on page modules, calendar page tests, a few glossary/rules assertions) |
| `npm run lint --prefix functions` | **366** eslint errors (mostly `max-len` / `valid-jsdoc`) |

CI exists so every PR runs the same two commands. Do **not** mass-reformat functions or weaken eslint to make lint green. Do **not** treat a red check as a licence to skip running them — quote what you ran and what failed.

### Real package scripts (root `package.json`)

| Script | What it actually runs |
| --- | --- |
| `npm test` | `node --test` — unit tests in `test/` |
| `npm run test:emulator` | `node scripts/run-emulator-tests.mjs` — needs Java + Firebase emulators; not PR CI |
| `npm run check:design` | token + component build `--check`, then drift/component checks `--strict` |
| `npm run build:css` | Tailwind → `public/mosaic.css` |
| `npm run watch:css` | same, `--watch` (long-running; use a terminal, never `install`) |
| `npm run build:tokens` | `node scripts/build-design-tokens.mjs` |
| `npm run build:components` | `node scripts/build-design-components.mjs` |
| `npm run check:design-drift` | `node scripts/check-design-drift.mjs` |
| `npm run check:design-components` | `node scripts/check-design-components.mjs` |
| `npm run fix:design-drift` | `node scripts/fix-design-drift.mjs` |
| `npm run compare:design-tokens` | `node scripts/compare-design-tokens.mjs` |
| `npm run vendor` | vendor JS + fonts into `public/` |
| `npm run vendor:tiptap` | install + build `build/tiptap` → `public/vendor/tiptap/` |
| `npm run sync` | `build:css` then `cap sync` |
| `npm run mobile:build` | `node scripts/mobile-build.mjs` |

### Real package scripts (`functions/package.json`)

| Script | What it actually runs |
| --- | --- |
| `npm run lint --prefix functions` | `eslint .` (Google config; ignores `functions/shared/**`) |
| `npm run serve --prefix functions` | `firebase emulators:start --only functions` |
| `npm start --prefix functions` | functions shell (interactive — not for Cloud) |
| `npm run deploy --prefix functions` | **do not run** from an agent |
| `npm run logs --prefix functions` | live function logs — needs Firebase auth |

Root has no `lint` script. Lint lives only under `functions/`.

### Local emulators (optional, not install)

`firebase.json` emulator ports: Hosting **5005**, Functions **5001**, Firestore **8080**, Auth **9099**, UI **4000**. Start with `firebase emulators:start` from the repo root after both `npm ci`s. Needs Java for Firestore. Use a demo project id (`demo-…`) so a slip cannot write the church database.

`.cursor/environment.json` lists those ports so Cloud can forward them if you start the emulator. It does **not** start it — a foreground emulator belongs in a terminal, not in `install`.

### Shared modules

One authored copy of the pure domain modules lives in `public/`. `node scripts/sync-shared-to-functions.js` copies them into `functions/shared/` (also a functions `predeploy` hook). `test/functions-shared-sync.test.js` fails if the copy is stale. After editing an authored module, run the sync script and keep `npm test` green.

### Docs to read first

- `CONTEXT.md` — domain language. Use those words.
- `CLAUDE.md` — Jira board (`MS`, To Plan → Done). A ticket right of To Plan needs a PRD.
- `GEMINI.md` — stack sketch (Firebase, Node 20 functions, emulator ports).
- `docs/adr/` — decisions already made. Do not re-litigate them in a feature PR.

### PRs

Use `.github/PULL_REQUEST_TEMPLATE.md`. Fill **Jira (`MS-*`)**, **AC**, **test evidence**, **risk**, **preview URL** (or `n/a`), then tick **Ready for Maintain**. Maintain is the Cursor review pass; do not tick it on an empty template.

Preview, when the PR changes a hosted surface, is a Firebase Hosting preview channel on `mosaic-hymn-database`. Infra-only PRs: `n/a`.
