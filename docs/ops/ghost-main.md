# ghost-main — design sandbox branch

`ghost-main` is a long-lived Git branch whose tip is **continuously deployed** to the **ghost** Firebase project (`mosaic-manager-ghost`). It is **never merged into `main`**.

| | Church (production) | Ghost (sandbox) |
| --- | --- | --- |
| Git branch | `main` | `ghost-main` |
| Firebase project | `mosaic-hymn-database` | `mosaic-manager-ghost` |
| Deploy workflow | `.github/workflows/firebase-deploy.yml` (push to `main` only) | `.github/workflows/firebase-deploy-ghost.yml` (push to `ghost-main` + manual dispatch) |
| Public app URL | https://mosaic-hymn-database.web.app | **https://mosaic-manager-ghost.web.app** |
| MCP hosting | https://mosaic-hymn-mcp.web.app | https://mosaic-manager-ghost-mcp.web.app |

Both workflows carry guard steps that refuse the wrong Firebase project id for the branch. Agents must still not run `firebase deploy` from a Cloud Agent box (see `AGENTS.md`).

## What ghost-main is for

Jonathan (and design agents) use the ghost site to **redesign and professionalize** the app without touching production data or the church Firebase project. When something on the ghost site is worth keeping, it comes into `main` through a normal **MS-* ticket and PR** — cherry-pick, re-implement, or design-pull — **not** by merging `ghost-main`.

Periodically, `ghost-main` is **reset** to match `main` and the cycle starts again. Old design tips are kept on archive branches (below).

## How design agents work on ghost-main

1. Branch **off `ghost-main`**, not off `main` (unless you are doing infra-only work that lands on `main` first).
2. Open a PR **into `ghost-main`**, not into `main`.
3. Use **fictional data only** on the ghost (see `scripts/seed-ghost.js` and repo privacy rules). Do not copy real congregation names or records onto the ghost.
4. When **PR CI is green**, merge freely on `ghost-main`. Each merge to `ghost-main` triggers **Deploy Firebase ghost** and updates https://mosaic-manager-ghost.web.app .
5. Manual deploy from another ref (plan only):  
   `gh workflow run "Deploy Firebase ghost" --ref <branch> -f dry_run=true`

PR CI (`.github/workflows/pr-ci.yml`) runs on pull requests targeting **`main`** and **`ghost-main`**.

Nothing in this repo auto-opens a PR from `ghost-main` (or `ghost/*` heads) **into `main`**.

## Pulling a change from ghost into church (`main`)

- **Never** merge `ghost-main` into `main`.
- Pick the commits or UI you want, then either **cherry-pick** onto a ticket branch off `main` or **re-implement** against production constraints in a normal MS-* PR.
- Ship to production only via merge to `main` (church deploy workflow).

## Reset ghost-main to match main

When the sandbox should start fresh from production code:

```bash
gh workflow run "Reset ghost-main"
```

That workflow (`.github/workflows/reset-ghost-main.yml`, **workflow_dispatch only**):

1. If `ghost-main` exists, creates a backup branch **`ghost-archive/<YYYY-MM-DD>`** at the old tip (if that name already exists, **`ghost-archive/<YYYY-MM-DD>-<short-sha>`**).
2. Force-updates **`ghost-main`** to the current **`main`** SHA (creates the branch if missing).
3. Dispatches **Deploy Firebase ghost** on `ghost-main` (required because `GITHUB_TOKEN` pushes do not fire push workflows).

Browse archives on GitHub under branches matching `ghost-archive/*`.

## First-time setup (after infra merge)

1. Merge the infra PR that adds push-to-`ghost-main` on the ghost deploy workflow.
2. Create `ghost-main` from `main` and push (once):

   ```bash
   git fetch origin main
   git branch ghost-main origin/main
   git push -u origin ghost-main
   ```

   Or run **`Reset ghost-main`** once — it creates `ghost-main` from `main` and triggers the first deploy.

3. Confirm **Actions → Deploy Firebase ghost** succeeded for the `ghost-main` push or dispatch.
4. Open https://mosaic-manager-ghost.web.app and verify the app loads against ghost Firebase config.

Optional: seed fictional congregation data locally with  
`node scripts/seed-ghost.js --project mosaic-manager-ghost --commit` (never use `--i-mean-prod` against the church project).

## Related docs

- Ghost deploy workflow and secrets: comments in `.github/workflows/firebase-deploy-ghost.yml`
- Church deploy pin: `.github/workflows/firebase-deploy.yml`, `docs/ops/ms-545-functions-deploy-set.md`
- Agent rules: `AGENTS.md` (ghost-main section)
- Firebase project catalog: `config/firebase-projects.json` (`liveOrigin` for the ghost church site)
