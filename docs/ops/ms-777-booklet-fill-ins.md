# MS-777 — Sunday booklet text onto occurrence fill-ins

Print reads and writes booklet text on the Sunday Service occurrence. It does not read `services/{date}.typedContent` or the week's guide.

The script copies that text (prayer-country facts, Mosaic Kids, announcements) onto:

`event_occurrences/sunday_service_{YYYY-MM-DD}.printableInputs[printableId]`

Fill-in ids are `legacy_*` (`legacy_prayerNation`, `legacy_announcements`, `legacy_kidsQuestions`, and the rest of the migrated blanks).

## Order

Do not merge this reader change until the copy script is already on `main` and `commit=true` has succeeded. Hosting deploys with this merge. A week that still exists only in the old stores prints blank. That is the outage of 21 October 2026.

1. Merge the migration pull request.
2. Dry-run `migrate-booklet-text-to-occurrences.js` on `main`. Read `size.maxResultBytes`, `size.ceilingBytes`, and `size.occurrencesSkipped`.
3. Dispatch `commit=true` only when `size.occurrencesSkipped` is 0 and `size.maxResultBytes` is under `size.ceilingBytes`.
4. Merge this change only after that commit has succeeded.

## After the copy is on `main`

Run the copy from `main`, not from a pull request. This pull request does not add the script.

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

A Sunday that has no occurrence document yet is created with visibility `public` when the series document has none, and `participantIds` taken from the roster already on that date (an empty roster writes `[]`). It does not invent a roster and it does not leave the date without `participantIds`.

The log's `typedContentDeleted` and `guideFieldsDeleted` stay `0`.

## Document size

Firestore refuses a document over 1,048,576 bytes. A country map stored as a `data:` URL is copied onto every booklet printable, and that is what pushed `event_occurrences/sunday_service_2026-09-06` to 1,293,448 bytes. The script moves each data URL of 2,048 bytes or more to Storage at `sunday_typed/{date}/country_map/` and stores the https URL. The same bytes are one object, even when two printables carried them.

Every write is one occurrence, after a size check. The ceiling is 64 KiB under the server limit (`size.ceilingBytes`). A document that would still land over that ceiling is listed in `size.skipped` and the rest of the run continues. The dry run reports `size.maxResultBytes` and `size.maxResultOccurrenceId` for the largest document it would write, and `size.maxBeforeOffloadBytes` with `size.largestBeforeOffload` for the largest document before those images moved. Read those before `commit=true`. Do not commit while `size.occurrencesSkipped` is greater than 0.

## Do not delete the old fields in that run

Leave `services.typedContent` and booklet keys inside `guide.values` / `guide.elements` in place. Print does not read them after this change. A later script may delete them, and only after a dry run of this copy shows nothing left to copy (`fieldsCopied: 0`). That delete is not this script and not this change.
