# MS-530 — Backfill `Person.lastNoteAt`

One-shot Admin script. Writers (web, phone, assistant, prayer-request
paths) keep `lastNoteAt` in sync from here on. Existing People have no
cache until this pass, so the People list would show **Never** for
everyone who already has notes.

Do **not** run `--commit` from a cloud-agent box against production.
Firebase secrets may be blocked here; do not chase them. Live apply is
ops, after this PR is on `main`.

## Delete-of-latest behaviour this matches

Recompute from remaining notes. Clear to `null` when none remain. Same
as `ShepherdingCore.planLastNoteAtWrite` / `refreshLastNoteAt`.

## How to run

From the repo root, with a
`mosaic-hymn-database-firebase-adminsdk-*.json` service account in that
root (same resolution as `scripts/backfill-account-rank.js`):

```bash
node scripts/backfill-last-note-at.js            # dry run (default)
node scripts/backfill-last-note-at.js --commit   # apply
```

Dry-run prints every Person that would change and writes nothing.
`--commit` applies those updates. A second run is a no-op.

## Proof shape

Paste the dry-run (or commit) summary onto MS-530 / MS-564. Each
changed Person is one row:

```text
{ personId, name, stored, next, action }
```

- `stored` — current `lastNoteAt` (`null` if unset)
- `next` — newest remaining note `createdAt`, or `null` to clear
- `action` — `set` or `clear`

The footer counts:

```text
People checked: N. To update / Updated: X, unchanged: Y.
Proof: X row(s) with { personId, name, stored, next, action }.
```

That count-plus-shape is enough to mark the backfill AC. Live run is
left for Helm if this environment cannot see the service account.
