# MS-725 — Backfill `calendar.events.edit` on saved Editor maps

Helm option A, 2026-10-09. The Editor preset now carries
`calendar.events.edit`. A map already saved on `users/{uid}` is what
`firestore.rules` reads, so three accounts saved onto `level_editor`
still had the old map (key off) and would have lost the nine calendar
doors when `editsWith` became keys-only.

This pass wrote **one field** on those three accounts and nothing else.

## Who was written

Initials and uid prefix only:

| initials | uid prefix | field | before | after |
| --- | --- | --- | --- | --- |
| CO | `STGsqGJW` | `permissions.calendar.events.edit` | false | true |
| DA | `eHIGIuwi` | `permissions.calendar.events.edit` | false | true |
| DL | `tLzstpho` | `permissions.calendar.events.edit` | false | true |

Dry-run listed exactly these three, and only that field. `--commit`
wrote the same three.

The first apply used a dotted string path, which Firestore treated as
nested `{ calendar: { events: { edit: true } } }` and left the flat
catalog key off. That was repaired the same hour: the flat key was set
via `FieldPath('permissions', 'calendar.events.edit')` and the nested
`permissions.calendar` object was deleted. Only those three documents
had the nest (scanned all 18 users). The script now uses FieldPath, and
a second dry-run is a no-op.

## Snapshots

- Before: `docs/ops/ms-725-editor-calendar-key-before-2026-10-09T02-05-19-203Z.json`
- After: `docs/ops/ms-725-editor-calendar-key-after-2026-10-09T02-05-19-203Z.json`

The JSON names no person and no email. It carries the uid, the stored
level, `accountLevelId`, and the one field.

## How to run (again)

From the repo root, with `GOOGLE_APPLICATION_CREDENTIALS` pointing at a
church service account (never commit that file):

```bash
node scripts/backfill-editor-calendar-key.js \
    --project mosaic-hymn-database --i-mean-prod
node scripts/backfill-editor-calendar-key.js \
    --project mosaic-hymn-database --i-mean-prod --commit
```

A second dry-run after this pass is a no-op (0 accounts).

## Post-backfill audit

Read-only re-audit of all 18 user docs under the new `editsWith` (keys-only
for a saved map). **Zero accounts lose write access on any of the 19
doors.** The three saved Editors now carry `calendar.events.edit: true`
and keep the calendar collections.

## Revert

```bash
node scripts/backfill-editor-calendar-key.js \
    --project mosaic-hymn-database --i-mean-prod \
    --revert docs/ops/ms-725-editor-calendar-key-before-2026-10-09T02-05-19-203Z.json \
    --commit
```

That writes `permissions.calendar.events.edit` back to `false` on those
three documents and nothing else.
