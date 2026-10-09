# MS-715 follow-ups (a) and (b): the live Standard order's notes and hymn names

The live `liturgy_orders/standard` document only, and only display fields. **No element id changes.** Sundays keep values at `liturgy.<id>` and notes at `notes.<id>`, and printables bind by id. A full copy of the order before the change is in `ms-715-standard-order-before.json` (read Oct 8, 2026, ~6:45 PM CT; order `updatedAt` 2026-10-08T18:49:30Z).

## (a) Notes on Call to Worship and Call to Confession: switch them back on

**Decision: enable `hasNote` on both. The guidance stays as it is.**

- Of 208 stored Sundays, **132 carry a note on `callToWorship` and 133 on `callToConfession`**. Those are the two most-noted elements in the church's history (Assurance of Pardon 127, Sermon 62, Scripture Reading 8). Notes exist on future Sundays too (through 2026-12-13).
- The `order-of-service` guidance's Phase 5 names exactly three noted elements: Call to Worship, Call to Confession, Assurance of Pardon. The Call to Confession note's three confessions seed the Prayer of Confession, so the workflow needs them.
- With `hasNote` off, those 265 stored notes are hidden on the Order of Service, in `oos_get_service`, and in the leader sidebar. `oos_update_note` (MS-715) refuses new ones. Turning the switch back on reveals what's already stored. Nothing is rewritten.
- Scripture Reading stays off, which matches the guidance ("The Scripture Reading does not").

## (b) Distinct names for the seven Standard hymns

All seven hymn elements were named "Hymn". The new names come from where each one sits in the order and from the guidance's Phase 4 placement table:

| id | Position in the order | New name |
|---|---|---|
| `hymn2` | before Call to Worship | Preparatory Hymn |
| `hymn6` | after Call to Worship | Hymn of Praise |
| `hymn7` | after Call to Worship | Second Hymn of Praise |
| `hymn` | after Assurance of Pardon | Hymn of Assurance |
| `hymn3` | after Assurance of Pardon | Second Hymn of Assurance |
| `hymn4` | after the Sermon | Hymn of Response |
| `hymn5` | after the Sermon, before the Benediction | Closing Hymn |

Checked against 2026-10-11: Come, Thou Fount (prep), Be Thou My Vision and O Great God (praise), How Rich a Treasure and Blessed Assurance (after Assurance), Not in Me and I'll Fly Away (response, close).

## Dry run (no credentials, against the copy above)

```
$ node scripts/patch-liturgy-order.js --patch docs/ops/ms-715-standard-order-patch.json \
    --order-json docs/ops/ms-715-standard-order-before.json
DRY RUN — liturgy_orders/standard: 9 change(s)
  hymn2.name: "Hymn" -> "Preparatory Hymn"
  callToWorship.hasNote: false -> true
  hymn6.name: "Hymn" -> "Hymn of Praise"
  hymn7.name: "Hymn" -> "Second Hymn of Praise"
  callToConfession.hasNote: false -> true
  hymn.name: "Hymn" -> "Hymn of Assurance"
  hymn3.name: "Hymn" -> "Second Hymn of Assurance"
  hymn4.name: "Hymn" -> "Hymn of Response"
  hymn5.name: "Hymn" -> "Closing Hymn"
```

## Apply and revert (needs the church service-account key)

From a checkout that has `mosaic-hymn-database-firebase-adminsdk-*.json` at the root, or with `GOOGLE_APPLICATION_CREDENTIALS` set:

```
node scripts/patch-liturgy-order.js --project mosaic-hymn-database --i-mean-prod \
  --patch docs/ops/ms-715-standard-order-patch.json            # live dry run
node scripts/patch-liturgy-order.js --project mosaic-hymn-database --i-mean-prod \
  --patch docs/ops/ms-715-standard-order-patch.json --commit   # apply
```

The apply re-plans inside a transaction and writes `standard-before-<stamp>.json` and `standard-after-<stamp>.json` next to the patch. It also prints the revert command (`--revert <before file> --commit`), which puts every element's name and `hasNote` back.

On the Liturgy Orders page an editor can switch on the note for Call to Worship and Call to Confession and rename any element, hymns included (MS-716; ADR 0080 amendment). The seven Standard hymn display names can be set in the UI or with this script for a one-shot prod patch.

Once set, the names hold. `elementDisplayName` reads a stored hymn name and falls back to "Hymn" when blank; ids never change on rename. A later save from the Liturgy Orders page writes the element back with its name. Hymns still line up by position when a Sunday moves between orders, so the names do not change how a Sunday is translated.
