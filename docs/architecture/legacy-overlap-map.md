# Legacy overlap map

Read-only sweep of places an older data shape and a newer one still meet. Date: 2026-10-21. No application code was changed.

An overlap here is one of: a document that can be either shape, a read that falls back to a legacy field, a newer module still sitting on an older store, two collections for one concept, or two helpers that exist so both shapes keep working. A split an ADR keeps on purpose is listed at the end and has no ticket.

Proposed tickets are in [`legacy-overlap-tickets.json`](legacy-overlap-tickets.json). They are not filed in Jira.

Authored modules live in `public/`. `node scripts/sync-shared-to-functions.js` copies many of them to `functions/shared/`. A cleanup that edits an authored module has to update that copy in the same change. Server-only logic is named where it lives (`functions/`, `firestore.rules`, `storage.rules`).

## How prod was checked

The Firebase CLI on this run was not logged in, so this sweep did not query Firestore itself. What follows is from code plus records that already touched production:

| Evidence | What it shows |
| --- | --- |
| [Prod ops script](https://github.com/JonathanHarris15/mosaic-website/actions/workflows/prod-ops-script.yml) run [39514997653](https://github.com/JonathanHarris15/mosaic-website/actions/runs/39514997653) (`delete-legacy-oos-prayer-fields.js`, commit, 2026-10-20) | 209 `services` scanned, 28 still carried legacy prayer-leader fields, 70 field deletes planned, 0 blocked. |
| Run [39515062649](https://github.com/JonathanHarris15/mosaic-website/actions/runs/39515062649) (same script, dry-run, one minute later) | `servicesWithLegacy: 0`. Those top-level fields were gone. |
| Run [39455246579](https://github.com/JonathanHarris15/mosaic-website/actions/runs/39455246579) (`migrate-hymn-sheets-prefix.js`, commit) | 113 hymns still had legacy Storage URLs. The log says root objects were not deleted. |
| Run [39455459052](https://github.com/JonathanHarris15/mosaic-website/actions/runs/39455459052) (same script, dry-run, immediately after) | `hymns with legacy URLs: 0`. Firestore page URLs pointed at `hymn-sheets/`. |
| [`docs/ops/ms-725-editor-calendar-key-backfill.md`](../ops/ms-725-editor-calendar-key-backfill.md) (2026-10-09) | All 18 `users` docs were scanned. Saved permission maps and the permission-level string both exist in prod. |

Anything not in that table is **unverified** for current prod data.

## Ranked index

| Rank | Risk | Area | Overlap |
| --- | --- | --- | --- |
| 1 | high | Forms | Person pickers read fields the directory does not store |
| 2 | high | Accounts | Rules, Storage, and `rankOf` resolve access differently |
| 3 | high | Services | Sunday booklet text lives in three stores |
| 4 | med | Services | The old service-guide editor still ships beside Printables |
| 5 | med | Services | A Sunday guide is linked from the order and from the series |
| 6 | med | Services | Liturgy orders still join a loose elements collection |
| 7 | med | Services | Service reads still fold dotted liturgy keys |
| 8 | med | Services | Serve rows with no `seriesId` miss Firestore queries |
| 9 | med | Services | Unstamped occurrences cannot be found for a visibility restamp |
| 10 | med | Services | A stale backfill can restore deleted prayer-leader fields |
| 11 | med | People | The old `households` collection is still readable and writable |
| 12 | med | People | Inactive still matches legacy `membership.status` |
| 13 | med | Shepherding | Care lists still accept the pre-column body |
| 14 | med | People | The Elder tag still follows the raw permission string |
| 15 | med | People | `people.accountRank` copies the raw permission string |
| 16 | med | Services | Prayer rotation still sorts the `0000-00-00` sentinel |
| 17 | med | Shepherding | `shepherding_reminders` remains in the rules |
| 18 | med | Shepherding | Old `meeting` mentions render as dead chips |
| 19 | low | People | Booklet last names ignore remembered name parts |
| 20 | low | Services | `occurrenceRoleSlugs` is read and no longer written |
| 21 | low | Services | Baptism candidates still accept a free-text string |
| 22 | low | Services | Irregular Sundays are still read beside liturgy orders |
| 23 | low | People | Relationship types still accept the `directional` flag |
| 24 | low | Shepherding | Notes still fall back to plain `content` |
| 25 | low | Shepherding | `elder_meetings` stays in the rules with no app reader |
| 26 | low | Notifications | `sms_messages` is a copy source the merge script still names |
| 27 | low | Services | Printables still adopt the old page-number wire |
| 28 | low | Services | Hymn sheet pages still accept a string or an object |
| 29 | low | Services | Auto-assign drafts still read the old `away` key |

---

## Services

### 3. Sunday booklet text lives in three stores

**Risk:** high. An editor can type the same blank in the Order of Service, the old guide, or the event fill-in, and print merges them. Empty on the new store still prints the old store, so a cleared blank can come back.

**Systems:** `services/{date}.typedContent` and `services/{date}.guide` (v2 `values`, or legacy `elements`) sit under the Printable fill-ins on `event_occurrences/{id}.printableInputs`, reached by wires that used to be `sunday_typed` and are rewritten to `event_field` ids prefixed `legacy_`.

**Files:**

- `public/sunday-typed-core.js` — `fromService` prefers stored `typedContent`, then fills gaps from `guide.values` or legacy `guide.elements`.
- `public/printable-live.js` — `legacyTypedFallback` fills an empty `event_field` from that Sunday's typed content.
- `public/printable-legacy-migrate-core.js` — rewrites `bind.source === 'sunday_typed'` to `event_field` / `legacy_*` in memory; saving the Printable persists the new wire.
- `public/printable-data-core.js` — still resolves `sunday_typed` (`noDrawer: true`) for unmigrated wires.
- `public/service-builder.js` — still saves `typedContent`.
- `public/printable-view.js`, `public/calendar-event.js` — event fill-ins persist on the occurrence.
- Synced copies: `functions/shared/printable-legacy-migrate-core.js`, `functions/shared/printable-data-core.js`, `functions/shared/sunday-typed-core.js` when present.

**Firestore:**

| Store | Fields |
| --- | --- |
| `services/{YYYY-MM-DD}` | `typedContent`, `guide.values`, `guide.elements`, `guide.format` |
| `event_occurrences/{id}` | `printableInputs.{printableId}` |
| `printables/{id}` | binds: `sunday_typed` or `event_field` + `legacy_*` input ids |

**Prod:** unverified. No prod-ops script rewrites `typedContent` into occurrence fill-ins.

**Cleanup:** one write path, on the occurrence fill-ins. Keep the read-through until a prod pass has copied old weeks. Then delete `sunday_typed` resolution and `fromService`'s guide fallback. A behavior test prints a week that has only `typedContent`, a week that has only occurrence fill-ins, and a week where the occurrence value is blank and must stay blank.

### 4. The old service-guide editor still ships beside Printables

**Risk:** med. Desktop Services no longer opens this editor. The page, the mobile shortcut, and the stored week blob are still there, so an old week and a Printable can disagree about the same Sunday.

**Systems:** per-week guide on the service document (legacy `guide.elements`, or `format: 'v2'` with `guideTemplateId`, `snapshot`, `values`) versus a Printable named on the liturgy order (ADR 0056, ADR 0057, ADR 0080). ADR 0008 left legacy weeks readable and unmigrated.

**Files:**

- `public/guide-store.js` — `isV2Guide`, `isLegacyGuide`.
- `public/service-guide-editor.js` — rebuilds a legacy week onto v2; `extractAnnouncements` reads both shapes.
- `public/service-guide.js` — legacy generator still loads `guide.elements` and still reads `hasBaptism` as the baptism switch.
- `public/service-calendar.js` — `navigateToGuide` opens the Printable and does not fall back to the editor.
- `public/mobile/app.js` — the Service Guide shortcut is still `service-guide-editor.html`.
- `public/dashboard-nav.js` — the old URLs redirect their nav label to Services; the pages themselves remain.

**Firestore:** `services/{date}.guide`; `guide_templates`, `page_templates`, `style_presets`, `guide_assets`.

**Prod:** unverified how many weeks are still `guide.elements` or `format: 'v2'`.

**Cleanup:** rebuild remaining weeks onto the Printable the order names, or accept v2 weeks as history and stop writing them. Remove `service-guide.html` / `service-guide-editor.html` from mobile and from direct URLs once nothing reads `guide.elements`. A behavior test: the Services button opens the order's Printable, and a legacy `elements` blob does not change that Printable's output after the cutover.

### 5. A Sunday guide is linked from the order and from the series

**Risk:** med. Two fields can name a Printable for the same Sunday. The Services button reads only one of them, so a link made on the event page does not turn the button on.

**Systems:** `liturgy_orders.printableId` (one Service Guide per order, MS-762) and `events.printables[]` (any number of Printables on an event series, MS-400).

**Files:**

- `public/liturgy-order-core.js` — `serviceGuideTarget`, `setOrderPrintable`.
- `public/service-calendar.js`, `public/service-builder.js` — the Service Guide button uses the order's id.
- `public/printable-store.js` — `linkToSeries` writes `events/{seriesId}.printables`.
- `public/calendar-event.js`, `public/recurring-events.js` — the event page links through the series array.
- `public/printable-core.js` — `linkPrintable` / `unlinkPrintable`.

**Firestore:** `liturgy_orders/{id}.printableId`; `events/{seriesId}.printables` (array of printable ids). Fill-in values for a linked Printable live on the occurrence (`printableInputs`), which is overlap 3.

**Prod:** unverified whether `events/sunday_service` and the Standard order name the same Printable, or different ones.

**Cleanup:** the order field is the Service Guide. The series array is other handouts. Say that on both screens. A behavior test: linking a Printable only on the series leaves the Services button off; linking it on the order turns the button on and does not require the series array.

### 6. Liturgy orders still join a loose elements collection

**Risk:** med. An order saved before elements were embedded still depends on `liturgy_elements`. A reader that skips the join shows an empty order. Every save also writes `elementIds` beside `elements` so an older reader can walk the sequence.

**Systems:** loose docs in `liturgy_elements` plus `liturgy_orders.elementIds`, versus `liturgy_orders.elements` (ADR 0080).

**Files:**

- `public/liturgy-order-core.js` — `normaliseOrder` uses `elements` when it is an array, otherwise joins `elementIds` through the loose map.
- `public/liturgy-order-store.js` — `load` reads both collections; `planSave` writes elements on the order and deletes the loose docs it already knew about.
- `firestore.rules` — `match /liturgy_elements/{elementId}` is still world-readable and editor-writable.

**Firestore:** `liturgy_orders/{id}.elements`, `.elementIds`; `liturgy_elements/{elementId}`.

**Prod:** unverified. A save of the orders page deletes loose docs it loaded. An order nobody has re-saved keeps the split.

**Cleanup:** a prod pass that inlines every order and deletes `liturgy_elements`, then drop the join and the rules block. Keep writing `elementIds` only while an older deployed reader still needs it; remove that mirror in the same change that removes the reader. A behavior test: an order document with `elements` and no loose docs loads the same sequence as today's join.

### 7. Service reads still fold dotted liturgy keys

**Risk:** med. An old `set` with merge stored literal keys such as `liturgy.sermon`. Nested `liturgy.sermon` wins when both exist. A page that skips the fold shows an empty slot.

**Systems:** flat dotted keys on `services/{date}` versus nested maps (`liturgy`, `notes`, and the same pattern for other dotted paths). ADR 0034.

**Files:** the same fold is copied in `public/service-read-core.js` (`normalizeServiceDoc`), `public/service-builder.js` (`normalizeDottedKeys`), `public/service-calendar.js` (`normalizeServiceDoc`), `public/guide-store.js` (`normalizeServiceData`), and `public/printable-data-core.js` (`normaliseService`). Synced copies under `functions/shared/` follow the authored modules.

**Firestore:** `services/{YYYY-MM-DD}` keys that contain `.`, versus nested objects.

**Prod:** unverified. New field-path updates write nested fields. Dotted keys remain until a rewrite.

**Cleanup:** one normalizer. A prod rewrite that moves dotted keys into nested objects and deletes the flat keys. A behavior test with a document that has only the dotted key, only the nested object, and both (nested wins).

### 8. Serve rows with no `seriesId` miss Firestore queries

**Risk:** med. In memory, a serve with no series counts as Sunday Service, which keeps fairness honest before a backfill. A query `where('seriesId', '==', …)` cannot do that, so auto-assign and the calendar under-count anyone whose rows were written before the field.

**Systems:** `people/{id}/involvement` documents with no `seriesId`, versus the same documents stamped `seriesId`. New writes go through `stampSeries`.

**Files:**

- `public/events-core.js` — `seriesIdOf`, `forSeries`, `stampSeries`.
- Query sites that do not apply the fallback: `public/events-store.js`, `public/auto-assign.js`, `public/calendar-event.js`, `public/recurring-events.js`.
- `scripts/backfill-involvement-series.js`.
- Older involvement rows also used a random id. `public/service-involvement-core.js` `involvementId` is deterministic (`date_slug` or `date_slug_prayerType`) so a second conversion overwrites. Pre-flag Sundays are not reconverted (ADR 0019, `involvementDeferred` on `services/{date}`). Duplicate historical rows are a data residue of that id change.

**Firestore:** `people/{personId}/involvement/{id}.seriesId`; `services/{date}.involvementDeferred`.

**Prod:** unverified. The backfill script is not on the prod-ops allowlist.

**Cleanup:** run the series backfill, then keep `seriesIdOf` only as a guard until a count of missing `seriesId` is zero. Separately, dedupe random-id involvement rows for Sundays that never got `involvementDeferred`. A behavior test: a row with no `seriesId` is included in the Sunday fairness query the same way `seriesIdOf` includes it in memory.

### 9. Unstamped occurrences cannot be found for a visibility restamp

**Risk:** med. An occurrence with no `visibility` matches no read rule, so it is invisible on every surface. `restampSeriesVisibility` queries by visibility and therefore cannot see the row it would repair.

**Systems:** occurrence documents written before visibility was stamped, versus every create stamping `visibility` (and `rosterShared` where that stamp exists).

**Files:**

- `public/events-store.js` — `restampSeriesVisibility` documents the miss.
- `firestore.rules` and `storage.rules` — `stampedVisibility()` treats a missing field as `none`.
- `scripts/backfill-occurrence-visibility.js`.

**Firestore:** `event_occurrences/{id}.visibility`.

**Prod:** unverified. The backfill is not on the prod-ops allowlist.

**Cleanup:** run the backfill with admin credentials (the client cannot list the rows). After a dry-run reports zero unstamped docs, the client comment can stay as history. A behavior test belongs on the script: an occurrence without `visibility` is found by the admin scan and stamped with the series value.

### 10. A stale backfill can restore deleted prayer-leader fields

**Risk:** med. The live Order of Service reads `carriedBy` only. Prod no longer has the old top-level fields (see the prod table). `scripts/backfill-service-roles.js` still writes `prayerPraiseId`, `prayerPraiseName`, `prayerConfessionId`, and `prayerConfessionName` from involvement. It is not on the prod-ops allowlist. Running it puts the deleted shape back. The merge planner still lists those ids, so a merge would repoint them if they returned.

**Systems:** top-level prayer leader fields versus `services/{date}.carriedBy.{elementId}` (MS-771, ADR 0080).

**Files:**

- Runtime reads `carriedBy` only: `public/service-involvement-core.js`, `public/service-read-core.js`, `public/events-occurrence-core.js`.
- Migration only: `public/legacy-oos-migrate-core.js`, `scripts/migrate-legacy-oos-prayer-carriers.js`, `scripts/delete-legacy-oos-prayer-fields.js`, `public/delete-legacy-oos-prayer-fields-core.js`.
- Still writes or names the old fields: `scripts/backfill-service-roles.js`, `public/merge-duplicate-person-core.js` (`SERVICE_SCALAR_ID_FIELDS`).

**Firestore:** `services/{date}` fields `prayerPraiseId`, `prayerPraiseName`, `prayerConfessionId`, `prayerConfessionName`, versus `carriedBy`.

**Prod:** cleared. Commit run 39514997653 found 28 of 209 services and 70 fields. Dry-run 39515062649 found 0. The migrate commit (39510637735) had already copied carriers onto `carriedBy`.

**Cleanup:** delete `backfill-service-roles.js` or retarget it at `carriedBy` and the current leader fields. Drop the four prayer keys from the merge planner. Leave the migrate/delete scripts until a second dry-run is still zero, then remove them with their tests. A behavior test: building a service writes `carriedBy` and does not write the four top-level keys.

### 16. Prayer rotation still sorts the `0000-00-00` sentinel

**Risk:** med. The history subcollection is the record (ADR 0022). `lastPastoralPrayerDate` is a cache. Older writes stored `'0000-00-00'` for "never". The Order of Service sorts on the raw cache and treats missing as that sentinel, so a real date and a sentinel interleave if any sentinel remains. `PastoralPrayerCore.normalizeDate` and `public/analytics.js` already fold the sentinel to empty. The picker does not.

**Systems:** `people/{id}/pastoral_prayer_history/{serviceDate}` versus `people.lastPastoralPrayerDate` and `people.pastoralPrayerStats`.

**Files:**

- `public/service-builder.js` — `prayerChoices` sorts `lastPastoralPrayerDate || '0000-00-00'`.
- `public/pastoral-prayer-core.js` — normalizes the sentinel on the label path.
- `public/analytics.js` — uses the normalizer for the stats date.
- `scripts/sync-pastoral-prayer-dates.js`, `scripts/init-member-prayer-dates.js` (the init script is the old writer of the sentinel).

**Firestore:** `people.lastPastoralPrayerDate`; subcollection `pastoral_prayer_history`.

**Prod:** unverified whether any person still has `'0000-00-00'`.

**Cleanup:** route the picker through `PastoralPrayerCore.normalizeDate`. Run the sync script so the cache matches history. A behavior test: a person with the sentinel sorts with people who have never been prayed for, and a person with a real date sorts after them.

### 20. `occurrenceRoleSlugs` is read and no longer written

**Risk:** low. A date can still show a role that was stored only on the occurrence. Nothing in `public/` writes the field anymore. The series `roleSlugs` is the list that applies to every date.

**Systems:** `event_occurrences.occurrenceRoleSlugs` versus `events.roleSlugs` (and one-off roles on the date).

**Files:** `public/calendar-event.js` (`roleSlugsHere` concatenates series slugs and occurrence slugs), `public/calendar-view.js`. `CONTEXT.md` records the field as read and no longer written.

**Firestore:** `event_occurrences/{id}.occurrenceRoleSlugs`; `events/{id}.roleSlugs`.

**Prod:** unverified.

**Cleanup:** strip the field in a prod pass, then delete the read. A behavior test: a date with only series `roleSlugs` shows those roles, and a leftover `occurrenceRoleSlugs` value does not add a card after the strip.

### 21. Baptism candidates still accept a free-text string

**Risk:** low. Display still works. A string candidate has `id: null`, so it is not a Person and later edits can fork it.

**Systems:** `liturgy.baptism` as a string or a top-level `baptism` string, versus an array of `{id, name}` (ADR 0006).

**Files:** `public/service-builder.js` (`coerceBaptismCandidates`), `public/service-calendar.js` (`baptismCandidateNames`), `scripts/migrate-baptism.cjs`.

**Firestore:** `services/{date}.liturgy.baptism`, and a legacy top-level `baptism`.

**Prod:** unverified. The baptism script is not on the prod-ops allowlist.

**Cleanup:** rewrite remaining strings to person refs (or a single `{name, id: null}` entry) and delete the string branch. A behavior test covers array, string, and absent.

### 22. Irregular Sundays are still read beside liturgy orders

**Risk:** low. ADR 0080 kept old irregular Sundays readable and stopped creating them. They render under the order and come back from the MCP read. They are a second liturgy shape on the same service document.

**Systems:** `isIrregular` + `irregularElements[]` versus `liturgyOrderId` + `liturgy.{elementId}` + `liturgyLeftovers`.

**Files:** `public/service-read-core.js`, `public/service-builder.js`, `public/service-calendar.js`, `functions/shared/liturgy-translate-core.js`.

**Firestore:** `services/{date}.isIrregular`, `.irregularElements`, `.liturgyLeftovers`, `.liturgyOrderId`.

**Prod:** unverified.

**Cleanup:** optional prod pass that maps each irregular Sunday onto an order and clears the flag. Drop the read-only branch when a count is zero. A behavior test: a service with `isIrregular` still returns `irregularElements` from the read core until that pass, and a new save does not set the flag.

### 27. Printables still adopt the old page-number wire

**Risk:** low. An old bind still becomes a page number, so reprints work. The wire and the structured field can both exist on one node until a save strips the wire.

**Systems:** bind source `insert_page_number` versus `node.pageNumber`.

**Files:** `public/printable-core.js` (`legacyPageNumber`, `adoptPageNumber`, `stripLegacyPageNumber`) and the synced `functions/shared/printable-core.js`.

**Firestore:** `printables/{id}` page nodes: `bind.text.source` / `bind.class.source` equal to `insert_page_number`, versus `pageNumber`.

**Prod:** unverified.

**Cleanup:** load-and-save already migrates a node in memory. A pass that rewrites stored printables, then delete `legacyPageNumber`. A behavior test: a node with only the old bind prints the same number as a node with `pageNumber`.

### 28. Hymn sheet pages still accept a string or an object

**Risk:** low for display. Firestore URLs were moved under `hymn-sheets/` on 2026-10-20 (dry-run 39455459052 found 0 legacy URLs). The commit log says root Storage objects were not deleted, so orphan bytes may still be at the bucket root. The page value itself is still either a string or `{url|src}`.

**Systems:** page entry string versus object; Storage path `{hymn}/{file}` versus `hymn-sheets/{hymn}/{file}` (MS-769).

**Files:** `public/hymn-versions.js` (`pageUrl`), `public/hymn-sheets-core.js`, `scripts/migrate-hymn-sheets-prefix.js`. ADR 0073's "no `default` flag means the first version prints" is the current rule, not a second stored shape.

**Firestore:** `hymns/{id}.versions[].pages[]`, `versions[].default`.

**Prod:** URL prefix cleaned in Firestore (113 hymns on the commit, 0 on the following dry-run). Root blobs unverified. Page value shape unverified.

**Cleanup:** rewrite every page to one object shape, then simplify `pageUrl`. Delete root objects only when no hymn URL still points at them. A behavior test: a string page and an `{url}` page both resolve, and a blank slot is dropped.

### 29. Auto-assign drafts still read the old `away` key

**Risk:** low. Browser storage only. A draft saved before the rename still loads.

**Systems:** local draft key `away` versus `out` (MS-188).

**Files:** `public/auto-assign-saved-core.js` — writes `out`, reads `out` or `away`.

**Firestore:** none.

**Prod:** not a Firestore question. Any browser that still has the old key is unverified.

**Cleanup:** drop the `away` read once drafts have been resaved. A behavior test: a packed draft with `away` and no `out` still restores the same absences.

---

## People, accounts, and households

### 2. Rules, Storage, and `rankOf` resolve access differently

**Risk:** high. The same account can be an editor in the browser, a member in Firestore rules, and a third rung in Storage. Unticking a key in Admin → Accounts changes the rules only when a `permissions` map is present, and it does not change `rankOf`.

**Systems:** four generations on `users/{uid}`, and three resolvers.

| Generation | Fields |
| --- | --- |
| MS-119 | `role` |
| Renamed rung | `permissionLevel` |
| ADR 0065, superseded by ADR 0076 | `pastoralAssistant: true` beside a lower `permissionLevel` |
| ADR 0077 / ADR 0082 | `accountLevelId` + `permissions` map |

| Resolver | What it trusts |
| --- | --- |
| `firestore.rules` `permissionLevel()` | `permissionLevel` if the key is present, otherwise `role`. `editsWith` uses the map when `permissions` exists, otherwise the rung. `isPastoralAssistant()` is true for the rung or the boolean. |
| `storage.rules` `permissionLevelAccount()` | The higher of the stored rung, `accountLevelId`, and a rung inferred from the map. |
| `public/account-levels-core.js` `canonicalPermissionLevel` + `public/auth.js` `withResolvedLevel` | The higher builtin of id, stored rung, and map. The session then overwrites `permissionLevel` and `role` with that canonical rung and replaces `permissions` with the effective map. |
| `functions/trade-writes.js` `rankOf` | `permissionLevel` or `role` only. |

Writers still store `role` as a copy of `permissionLevel` (`userWriteFromLevel` in `public/account-levels-core.js`, `createUser` in `functions/index.js`). Many pages also read `permissionLevel || role` themselves (`public/dashboard-nav.js`, `public/auth.js`, `public/commitments.js`, `public/cover.js`, `public/auto-assign.js`, `public/calendar.js`, `public/away.js`, and others) instead of the resolved account.

**Firestore:** `users/{uid}` fields `role`, `permissionLevel`, `pastoralAssistant`, `accountLevelId`, `permissions`.

**Prod:** the MS-725 note scanned all 18 user docs on 2026-10-09 and repaired three saved editor maps. That proves maps and rungs both exist. Whether any doc still has only `role`, or still has `pastoralAssistant: true` without `permissionLevel: 'pastoral_assistant'`, is unverified since that audit.

**Cleanup:** one resolver, used by Firestore rules, Storage rules, `rankOf`, and the client. After every account has `permissionLevel`, stop writing and reading `role` (the rules comment names this MS-127). After every pastoral assistant is the rung, stop reading the boolean. A behavior test: a saved map that turns off `calendar.events.edit` is refused by the rules and by `rankOf`; an account with only `permissionLevel: 'editor'` and no map still edits; a `pastoralAssistant: true` account and a `permissionLevel: 'pastoral_assistant'` account open the same doors.

### 11. The old `households` collection is still readable and writable

**Risk:** med. ADR 0075 moved the kiosk onto `families`. The rules still let any signed-in account read `households`, and a kiosk or editor create or update one. Printable loads still download the collection and then ignore it.

**Systems:** `households/{id}` (minted foyer groups, ADR 0043 / ADR 0044) versus households derived from `families` by `HouseholdCore.householdsFromDirectory`.

**Files:**

- `public/household-core.js` — derives groups from `families`. The file header says the old collection is no longer read.
- `public/printable-data-store.js` — `fetch` still `get()`s `households` when a people or household source is needed.
- `public/printable-data-core.js` — `householdsOf` uses families (and `HouseholdCore` when loaded). It does not read `bundle.households`.
- `firestore.rules` — `match /households/{householdId}` (comment: rules stay until leftover docs are cleared).
- `public/merge-duplicate-person-core.js` — still walks `households` for person ids.

**Firestore:** `households` (legacy: `name`, `memberIds`, …) versus `families` (`husbandId`, `wifeId`, `childIds`, `anniversary`).

**Prod:** unverified whether any `households` documents remain.

**Cleanup:** stop the printable fetch. Export or count the collection, delete leftover docs, delete the rules block and the merge entry. A behavior test: a printable household list built from `families` matches `householdsFromDirectory` and does not change if a `households` doc is present in the bundle.

### 12. Inactive still matches legacy `membership.status`

**Risk:** med. A person with `membership.status === 'inactive'` and no `membership.inactive` flag is treated as inactive by the directory, roles, announcements, and printables. A person whose stage was migrated and whose old status was left behind can be inactive for the wrong reason, or inactive in one reader and not another if a reader forgets the fallback.

**Systems:** `people.membership.status` versus `people.membership.stage` + `people.membership.inactive`, with Membership Tags projected from the stage (ADR 0012). The tag projection itself is the current design and is not this overlap.

**Files:**

- `public/shepherding-core.js` — `isInactiveMembership`, `membershipFromLegacyStatus`.
- The same predicate in `public/roles-core.js`, `public/event-announcement-core.js`, `public/people-picker-core.js`, `public/printable-data-core.js`, and the synced `functions/shared/` copies.
- `scripts/migrate-membership-track.js` — its header says the real directory was mostly tags, and that the script leaves `status` on the document.

**Firestore:** `people.membership.status`, `.stage`, `.inactive`; `people.tags`.

**Prod:** unverified today. The migration script records that `status` was empty for almost everyone when it was written.

**Cleanup:** backfill `inactive` from `status === 'inactive'`, then delete the `status` comparisons. A behavior test: `{inactive: true}` and `{status: 'inactive'}` both exclude a person, and after the cleanup only `inactive` does.

### 14. The Elder tag still follows the raw permission string

**Risk:** med. A custom level whose map counts as an elder, or a pastoral assistant, does not receive the Elder tag. Pickers, the relations graph, and digests that trust the tag disagree with the account screen.

**Systems:** Elder tag projected from `(permissionLevel || role) === 'elder'` (ADR 0013) versus the permission catalog key that counts as an elder (ADR 0077).

**Files:** `public/shepherding-core.js` `isElderUser` / `applyElderTag`; the `reconcileElderTag` trigger in `functions/index.js`; `public/relations-graph-core.js` also treats a person as an elder from the tag or from an elders map.

**Firestore:** `people.tags` containing `Elder`; `users.permissionLevel`, `users.role`, `users.permissions`.

**Prod:** unverified. Depends on overlap 2.

**Cleanup:** project the tag from the same elder test the account screen uses (`shep.count_as_elder` / the canonical rung), and keep a pastoral assistant untagged. A behavior test: permission level `elder` gains the tag; `pastoral_assistant` does not; a custom map that counts as elder matches the account screen.

### 15. `people.accountRank` copies the raw permission string

**Risk:** med. The field exists so a surface that can read People and not other users (the trade picker) can see rank. `rankOf` does not read it. The projection copies `permissionLevel || role` and skips the pastoral-assistant grant and the permission map, so it can disagree with both the client and Storage.

**Systems:** denormalized `people.accountRank` versus live `users` resolution (overlap 2).

**Files:** `functions/account-rank-sync.js` (`rankFromUser`), the `syncAccountRankToPerson` / `reconcileAccountRank` triggers, `scripts/backfill-account-rank.js`, `functions/trade-writes.js` `rankOf`. No `public/` reader of `accountRank` turned up. The trigger comment in `functions/index.js` says the trade picker uses the field. The picker does not read it, and `rankOf` still loads `users`.

**Firestore:** `people.accountRank`; `people.userId` ↔ `users.personId`.

**Prod:** unverified whether every linked person has `accountRank`. The trigger comment says existing links need the one-shot backfill.

**Cleanup:** either make `rankOf` and the projection use the canonical resolver from overlap 2, or stop writing `accountRank` if nothing is allowed to read it. A behavior test: changing a user's map changes `accountRank` and `rankOf` to the same rung.

### 19. Booklet last names ignore remembered name parts

**Risk:** low. Household titles on the kiosk use `nameParts` when they are present (`PersonName.rememberedLastName`). Printable person rows still take the last word of `people.name`. ADR 0074 says booklets that do that stay as they are until someone changes them. A full name that ends in a suffix can title the household from the remembered last name and the booklet from the last word once parts exist.

**Systems:** `people.name` (always) and optional `people.nameParts` (ADR 0069, ADR 0074). `partsToRemember` parses the full name when parts are absent. `lastNameOf` is for a draft row that still has `firstName` / `lastName` before save, not a second stored person field.

**Files:** `public/person-name.js` (`partsToRemember`, `rememberedLastName`, `lastNameOf`), `public/household-core.js`, `public/printable-data-core.js` (`lastName` from `person.name`), `scripts/backfill-name-parts.js`.

**Firestore:** `people.name`, `people.nameParts` (`firstName`, `lastName`, `suffix`, `noLastName`).

**Prod:** unverified. The backfill is not on the prod-ops allowlist. ADR 0074 says it is dry-run until someone applies it.

**Cleanup:** decide whether booklets use `nameParts.lastName` when it is present. If yes, change `printable-data-core` and add a behavior test with a suffix. If booklets stay on the last word, record that next to ADR 0074 and do not treat it as a fallback to delete. Run the name-parts backfill either way so directory blanks are filled.

### 23. Relationship types still accept the `directional` flag

**Risk:** low. A type with no `kind` is rewritten in memory on every read. The relations graph still treats `directional` as the ancestor of `priority` when `kind` is absent. Elders see the migrated labels until the backfill deletes `directional`.

**Systems:** `{name, directional}` versus `{kind, priority, label | holderLabel, counterpartLabel}` (ADR 0014).

**Files:** `public/relationship-core.js` (`needsMigration`, `migrateTypeDoc`), `public/relations-graph-core.js` (`typeIsPrioritized`), `scripts/backfill-relationship-types.js`.

**Firestore:** `relationship_types/{id}.directional`, `.kind`, `.priority`.

**Prod:** unverified.

**Cleanup:** run the backfill, then delete `needsMigration` and the `directional` branch. A behavior test: a doc with `directional: true` and no `kind` reads as a priority pairwise type, and a doc that already has `kind` is unchanged.

### 1. Person pickers read fields the directory does not store

**Risk:** high. A form question scoped to members, non-members, or a tag filters a directory that is built from the wrong fields. Real people have `membership.stage` and `tags`. The picker looks at `isMember`, `membershipStage`, and `tagIds`, which ordinary writes do not set. Member scope then matches nobody. Non-member scope matches everybody. Tag scope matches nobody.

This is separate from the MCP people list, which does map `membership.stage` onto a `membershipStage` argument in `functions/shepherding-read.js`.

**Systems:** the forms directory DTO `{id, name, isMember, tagIds}` versus the Person document.

**Files:**

- `functions/index.js` — `publicForm` fetch builds the directory; `addPerson` pushes `{isMember: false, tagIds: []}`.
- `functions/forms-public.js` — `personInScope`.
- `public/shepherding-form-document.js` — `loadDirectory` and `personChoices` use the same DTO. `createPerson` writes a real Person (`tags: []`, no `isMember`) and then inserts the phantom DTO into the page list.

**Firestore:** reads `people.isMember`, `people.membershipStage`, `people.tagIds`. The stored shape is `people.membership.stage`, `people.membership.inactive`, `people.tags`. `ShepherdingCore.carriesMemberTag` is the member test the directory already uses.

**Prod:** unverified whether any person document actually has `isMember` or `tagIds`. The writers found in this sweep do not set them, so scoped pickers are wrong for the directory as it is stored.

**Cleanup:** build the DTO from `membership` and `tags` (member = `carriesMemberTag`, tag scope = `tags`). Delete the phantom reads. A behavior test: a person at stage Member is offered for scope `member` and withheld for `non_member`; a person carrying a tag id is offered for that tag; a person with only `tags` and `membership.stage` is enough, with `isMember` absent.

---

## Shepherding, notes, and notifications

### 13. Care lists still accept the pre-column body

**Risk:** med. A list from before columns is one TipTap doc per person. It displays as the Notes column and is rewritten to `careListColumns` + `careListData` on save. Until that save, every reader has to understand both shapes, including the synced copy under `functions/shared/`.

**Systems:** bare TipTap doc on the cell versus `{careListColumns, careListData}` (cells keyed by person, then column).

**Files:** `public/care-list-core.js` (`isOldShape`, `normaliseStored`, `saveEdits`), `public/shepherding-core.js` `careListNotesFor` (a cell whose `type` is `doc` is the old body), `public/shepherding-care-list.js`, `public/mobile/screens-carelist.js`, `functions/shepherding-payload-writes.js`.

**Firestore:** `elder_documents` where `docType == 'care-list'`: `careListColumns`, `careListData.{personId}`.

**Prod:** unverified.

**Cleanup:** a batch normalise of every care-list document, then `isOldShape` only on import. A behavior test: a stored bare doc reads as the Notes column and, after normalise, round-trips as column cells.

### 17. `shepherding_reminders` remains in the rules

**Risk:** med. The app reads and writes `shepherding_tasks` (and `shepherding_task_occurrences` for a series). The old collection is still readable and writable by elders. If the migration never ran, those reminders are invisible on the tasks page and still in the database. If it ran, the rules are an unused write surface.

**Systems:** `shepherding_reminders` versus `shepherding_tasks` (MS-79, ADR 0060).

**Files:** `scripts/migrate-reminders-to-tasks.js`; `firestore.rules` match on `shepherding_reminders` (comment: left readable so the migration can be checked). App readers found: `public/shepherding-tasks.js` and the dashboard use tasks. No app reader of `shepherding_reminders` turned up.

**Firestore:** `shepherding_reminders/{id}`; `shepherding_tasks/{id}`; `shepherding_task_occurrences/{id}`.

**Prod:** unverified. The migrate script is not on the prod-ops allowlist.

**Cleanup:** dry-run the migrate script. If it copies anything, commit it. Then delete the collection and the rules block. A behavior test on the script: a reminder becomes one task and a second run does not duplicate it.

### 18. Old `meeting` mentions render as dead chips

**Risk:** med if any note or elder document still has `kind: 'meeting'`. The chip keeps its label and loses its link. Writers only emit `elder_document` and `elder_folder` now.

**Systems:** cross-reference `{kind: 'meeting', id}` versus `elder_document` / `elder_folder` (`CONTEXT.md`).

**Files:** `public/tiptap-render.js` links `person`, `note`, `elder_document`, and `elder_folder`. Any other kind, including `meeting`, becomes a dim chip. Writers: `public/shepherding-profile.js`.

**Firestore:** TipTap JSON `contentJson` on `people/{id}/shepherding_notes` and on `elder_documents`. There is no separate collection.

**Prod:** unverified. This sweep did not scan note JSON.

**Cleanup:** a prod pass that rewrites `kind: 'meeting'` to `elder_document` where the id still exists, or a read-time alias. A behavior test: a mention node with `kind: 'meeting'` renders the same href as `elder_document` for that id.

### 24. Notes still fall back to plain `content`

**Risk:** low. New writes store TipTap `contentJson` and a plain `content` string. A note that has only `content` still opens in the editor and still renders. The MCP list preview uses `content` only, so a note whose plain string was never filled previews empty even when `contentJson` has the body.

**Systems:** plain string `content` versus TipTap `contentJson` (ADR 0048).

**Files:** `public/shepherding-profile.js` (`initEditor` uses `contentJson` or `content`; `renderNoteHtml` does the same), `functions/shepherding-read.js` (list `preview` is `note.content`; `getNote` body is `contentJson`), `functions/shepherding-writes.js` writes both, `public/mobile/data.js` updates both.

**Firestore:** `people/{personId}/shepherding_notes/{noteId}.content`, `.contentJson`.

**Prod:** unverified how many notes lack `contentJson`.

**Cleanup:** backfill `content` from `contentJson` for previews, and backfill `contentJson` from plain `content` where the JSON is missing. Point the list preview at the same plain text the editor uses. A behavior test: a note with only `content` opens as text; a note with only `contentJson` previews that text.

### 25. `elder_meetings` stays in the rules with no app reader

**Risk:** low. Meeting minutes are `elder_documents` (ADR 0015). The old collection is still elder-readable and elder-writable. The merge planner still knows the name.

**Systems:** `elder_meetings` versus `elder_documents` + `elder_document_structure`.

**Files:** `firestore.rules` `match /elder_meetings/{meetingId}`; `public/merge-duplicate-person-core.js`. No app reader or writer of `elder_meetings` turned up outside rules, the merge list, and tests.

**Firestore:** `elder_meetings/{id}`; `elder_documents/{id}`.

**Prod:** unverified whether any meeting docs remain.

**Cleanup:** count the collection. Migrate any row into an elder document, then delete the rules block and the merge entry. A behavior test is the script's dry-run: zero documents, or each old id present as an elder document.

### 26. `sms_messages` is a copy source the merge script still names

**Risk:** low for the app. Inbound and outbound traffic uses `notifications` (ADR 0036). `sms_messages` is not in `firestore.rules`. The copy script does not delete the source. The duplicate-person merge still lists `sms_messages` as a legacy person-ref collection. The admin dashboard still names the old collection in its copy.

**Systems:** `sms_messages` versus `notifications` (`channel` included).

**Files:** `functions/notification-migration.js`, `scripts/migrate-sms-messages-to-notifications.js`, `scripts/merge-duplicate-person.js` (`LEGACY_PERSON_REF_COLLECTIONS`), `public/admin-dashboard.html`. `test/notification-migration.test.js` asserts the app and the rules do not reference `sms_messages`.

**Firestore:** `notifications/{id}`. `sms_messages` is outside the rules file.

**Prod:** unverified whether the old collection still has rows. `docs/ops/ms-189-remaining.md` says not to delete it from an agent run.

**Cleanup:** run the copy if it has not been committed, confirm ids, then archive the collection and drop it from the merge list and the admin copy. A behavior test already locks the runtime to `notifications`; extend it so the merge planner no longer names `sms_messages` after the archive.

---

## Kept on purpose

These are two stores or two fields that the ADRs still want. They are not tickets.

| What | Why it stays |
| --- | --- |
| Leader name and id on the Sunday (`serviceLeader` / `serviceLeaderId`, and the same pair for music, preacher, elements, other) | ADR 0002. Saves write both. The id is the person; the name is the label on the document. |
| Liturgical roles on `services/{date}` and servant assignments on `event_occurrences/{id}/roster` | ADR 0016, ADR 0018, ADR 0019. Sunday liturgy stays on the service. The calendar occurrence is the roster. `liturgicalHolders` reads the service into fairness. `events-core.js` `occurrenceRef` still points at `services` for the Sunday series id; that name is historical and the assignment document is `event_occurrences/sunday_service_{date}`. |
| `pastoral_prayer_history` and `people/{id}/prayer_requests/{serviceDate}` | ADR 0007. The history is the public "prayed for" fact. The request text is elder-only. Same date, two records, on purpose. |
| A Printable resolves live; a PDF filed on the event is the frozen copy | ADR 0057. The per-week guide snapshot (ADR 0008) is the older booklet, covered by overlaps 3 and 4. |
| `people.userId` ↔ `users.personId` | The link is stored on both sides so each collection can answer it. |
| `people.photoUrl` and `people.photoPath` | Display URL and Storage path. Both are current (ADR 0029). |
| Membership stage and Membership Tags | The stage is the source. The tags are the projection the directory filters on (ADR 0012, ADR 0026). The legacy piece is `membership.status`, overlap 12. |
| Assignment conversion in the browser and in Cloud Functions | Same rules in two places (`public/events-occurrence-core.js` and `functions/assignment-conversion.js`, liturgy in `public/service-involvement-core.js` and `functions/service-involvement.js`), kept in sync by tests. That is a shallow duplicate of one rule, not an old shape and a new shape. |

## Out of scope for this map

UI fallbacks (initials when there is no photo, `history.back`), caches that have a single writer and a single reader (`people.lastNoteAt`, `roleStats`), and the attendance subcollection on the occurrence. Those are one shape. A cache that still has a legacy sentinel is included (overlap 16).
