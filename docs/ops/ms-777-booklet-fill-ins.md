# MS-777 — Sunday booklet text onto occurrence fill-ins

Booklet text (prayer-country facts, Mosaic Kids, announcements) is stored on the Sunday Service occurrence:

`event_occurrences/sunday_service_{YYYY-MM-DD}.printableInputs[printableId]`

Fill-in ids are `legacy_*` (`legacy_prayerNation`, `legacy_announcements`, `legacy_kidsQuestions`, and the rest of the migrated blanks).

The app does not read or write `services/{date}.typedContent` or the week's guide for this text. The old guide editor can still write a guide. Print does not read it.

## After this change is on `main`

Hosting deploys with the push. The data move is a separate dispatch. Until the commit below has run, a week that only has the old stores prints blank.

Dry-run first. Read the log. Then commit. Both run from `main`, not from a pull request.

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=migrate-booklet-text-to-occurrences.js \
  -f 'args=' \
  -f commit=false
```

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=migrate-booklet-text-to-occurrences.js \
  -f 'args=' \
  -f commit=true
```

Optional range, on the service document id: `-f 'args=--from 2024-01-01 --to 2026-12-31'`.

The script copies a key only when that occurrence has never stored it. A key present as `''` was cleared and stays blank. A present value wins. Where both old stores have the field, the typed record wins a filled field and a blank typed field still takes the guide. It also rewrites stored `sunday_typed` wires to event fill-ins.

The log's `typedContentDeleted` and `guideFieldsDeleted` stay `0`.

## Do not delete the old fields in that run

Leave `services.typedContent` and booklet keys inside `guide.values` / `guide.elements` in place. A later script may delete them, and only after a dry run of this copy shows nothing left to copy (`fieldsCopied: 0`). That delete is not this script and not this change.
