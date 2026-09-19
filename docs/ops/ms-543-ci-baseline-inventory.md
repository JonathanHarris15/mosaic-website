# MS-543 — PR CI baseline inventory (MS-549)

Captured on `main` at `875bbc8` (2026-09-19), Node 22 locally. PR CI uses
Node 20; the same two commands are what `.github/workflows/pr-ci.yml` runs.

This note is the inventory only. Fixes belong in MS-550 (units) and
MS-551 (functions eslint). No product logic changed in this commit.

## Commands

| Command | Result |
| --- | --- |
| `npm test` | **59 fail**, 4457 pass, 19 skip, 4535 tests, ~61s, exit 1 |
| `npm run lint --prefix functions` | **366 errors** in 30 files, exit 1 |

The 19 skips are emulator suites that require `FIRESTORE_EMULATOR_HOST`.
They are not part of this baseline.

## Unit failures by file

| File | Fail | Theme |
| --- | --- | --- |
| `test/calendar-pages.test.js` | 42 | AccessCore missing in the VM sandbox (~32); remaining calendar behaviour |
| `test/mcp-manager-page.test.js` | 6 | MCP tool groups (`shep`/`cal` missing); guidance rules assertion |
| `test/analytics-access.test.js` | 5 | AccessCore missing on `analytics.js`; dashboard card editor gate |
| `test/shepherding-presence.test.js` | 2 | Firestore presence rules now use `readsAsElder` / `readsAsEditor` |
| `test/form-document-surfaces.test.js` | 1 | Glossary copy |
| `test/forms-phone.test.js` | 1 | Forms dashboard card permission gate |
| `test/page-script-deps.test.js` | 1 | `index.html` loads `trades-view.js` without `events-occurrence-core.js` |
| `test/roles-manager.test.js` | 1 | AccessCore missing on `roles-manager.js` |

### Theme 1 — AccessCore globals in page-module tests (~37)

Page modules call `AccessCore.*` (browser global from a `<script>` tag).
The unit harness never puts `AccessCore` on `global` / the VM sandbox, so
the first gate throws `ReferenceError: AccessCore is not defined`.

Suites: `calendar-pages` (most of the 42), `analytics-access` (4 of 5),
`roles-manager` (1).

### Theme 2 — Calendar page behaviour (remaining `calendar-pages`)

After AccessCore, these still fail on their own assertions:

- New-event form start date is not the clicked day
- "You" block: extra fetch, past serves listed, Show-filter hides own serve
- Week expand does not pin neighbouring row height
- Month rail: `loadRange` / `from` undefined; list/"you" stay on the rail
  month; paging / quiet-read recovery

Likely a mix of stale test wiring and real page regressions. Chip by
assertion; do not skip the file.

### Theme 3 — MCP manager page

`groupTools` only returns `oos`. Tests expect `shep` and `cal` as well.
One test still expects the old guidance lock rule
`isElder() \|\| (isEditor() && !guidanceLocked` — product rules may have
moved; **do not rewrite `firestore.rules` here**.

### Theme 4 — Glossary / surface copy

- Form-document glossary omits who can actually use a form document
- Forms dashboard card has no permission gate
- Service Analytics card is injected without the editor-level list the
  test looks for immediately above it

Fix the surface or the assertion, whichever is wrong. Not a Feature
ticket.

### Theme 5 — Stale Firestore rule strings

`shepherding-presence` still expects `allow read: if isElder()` /
`isEditor()`. Current rules use `readsAsElder()` / `readsAsEditor()`
(Pastoral Assistant). Update the tests. **Do not edit `firestore.rules`.**

### Theme 6 — Missing page script

`index.html` loads `trades-view.js`, which reads `EventsOccurrenceCore`
at parse time, but never loads `events-occurrence-core.js`. That is the
bug `page-script-deps` exists to catch (blank panel in the browser).

## Functions eslint by rule

| Rule | Count | Notes |
| --- | --- | --- |
| `max-len` | 266 | Google 80-col. Dominates `index.js` (80) and `mcp-shepherding-tools.js` (84) |
| `valid-jsdoc` | 81 | Missing `@param`, syntax errors |
| `require-jsdoc` | 6 | `assignment-writes`, `mcp-actor` (4), `trade-writes` |
| `no-trailing-spaces` | 4 | All in `functions/index.js` |
| parse error (`unknown`) | 3 | `import` in `mcp-app.js`, `mcp-auth.js`, `mcp-server.js` (`ecmaVersion: 2018`) |
| `no-multi-spaces` | 2 | `task-writes.js` comment alignment |
| `operator-linebreak` | 2 | `task-writes.js` ternary `:` |
| `comma-dangle` | 1 | `liturgy-writes.js` |
| `no-undef` | 1 | `level` in `mcp-printable-tools.js` |

### Files with the most findings

| File | Errors |
| --- | --- |
| `functions/index.js` | 95 |
| `functions/mcp-shepherding-tools.js` | 84 |
| `functions/shepherding-read.js` | 24 |
| `functions/shepherding-doc-writes.js` | 19 |
| `functions/shepherding-writes.js` | 18 |
| `functions/elder-sync.js` | 14 |
| `functions/task-writes.js` | 13 |
| `functions/shepherding-payload-writes.js` | 12 |
| `functions/mcp-actor.js` | 11 |
| `functions/shepherding-tag-writes.js` | 11 |

Twenty more files have 1–9 findings each.

The three `import` parse errors are real: eslint is on ES2018 and those
files use ESM `import()`. That is a parser/env fix for those files, not
a rule weaken.

## Locked for the pay-down

- Keep PR CI required. Do not skip the jobs.
- Do not weaken `.eslintrc.js` rules to buy green.
- Do not mass-reformat unrelated files.
- No Feature work, no `firestore.rules` / `storage.rules`, no MS-544
  transaction work.
- No mass-skip of unit suites.

Build order after this note: MS-550 (`npm test` exit 0) → MS-551
(functions lint exit 0) → MS-552 (parent PR + CI proof).
