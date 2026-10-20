# MS-769 — Storage rules audit (repo vs live, code paths)

Comparison run before shipping the catch-all removal. Method matches
`docs/ops/ms-693-storage-rules-vs-live.md` and `scripts/fetch-live-rules.js`.

- **Project:** `mosaic-hymn-database`
- **Repo rules:** `storage.rules` on this branch (no `{allPaths=**}`)
- **Live ruleset:** run `node scripts/fetch-live-rules.js --project mosaic-hymn-database`
  and `diff -u /tmp/live-storage.rules storage.rules` when
  `FIREBASE_SERVICE_ACCOUNT_PROD` is available in CI or ops.

## Live vs repo (expected delta)

| Path | Live (pre-MS-769) | Repo (MS-769) |
| --- | --- | --- |
| `people_photos/…` | read/write `request.auth != null` | read/write `isSignedIn()` (anonymous denied) |
| `event_attachments/…` | occurrence visibility | unchanged |
| `form_uploads/…` | editor read; write false | unchanged |
| `form_uploads_elder/…` | elder read; write false | unchanged |
| `printable_assets/…` | auth read | `isSignedIn()` read |
| `sunday_typed/…/country_map/…` | auth read | `isSignedIn()` read |
| `resources/…` | member read; `resources.edit` write/delete | unchanged (now binds — catch-all gone) |
| `hymn-sheets/…` | *(catch-all)* | read public; `hymns.edit` write/delete |
| `guide-assets/…` | *(catch-all)* | read public; `services.builder.edit` image write/delete |
| `{allPaths=**}` | **any auth read/write** | **removed** |
| Legacy root `{hymn}/{file}` | catch-all | **denied** (no legacy Storage rule in this PR) |

Anonymous sign-in is enabled on the project. `request.auth != null` on live
rules treats anonymous the same as a member for every path the catch-all
matched.

## Hymn sheets: token URLs vs path reads (merge-order proof)

**Question:** After CI deploys `storage.rules` on merge, do existing hymns break
before `migrate-hymn-sheets-prefix.js` runs?

**Stored shape:** Every page saved through `public/hymns.js` calls
`getDownloadURL()` after `put` and stores that string on
`hymns/{id}.versions[].pages[]` (string or `{url}`). Those URLs are always of
the form `https://firebasestorage.googleapis.com/v0/b/…/o/{encodedPath}?alt=media&token=…`.

**How production reads bytes (no authenticated Storage path fetch):**

| Consumer | Mechanism | Rules evaluated? |
| --- | --- | --- |
| `public/hymns.html` / `hymns.js` | `<img :src="pageUrl">`, `fetch(url)` download | **No** — token in URL (ADR-0046) |
| `public/service-builder.js` OOS PDF | `_getImageDataUrl(pageUrl)` → `fetch(url)` | **No** |
| `functions/shared/printable-data-core.js` `sunday_hymns` catalog | Passes stored URL into printable bind / `<img src>` | **No** |
| `public/guide-components.js` hymn stage | `<img src="…">` from catalog URL | **No** |
| `public/printable-data-core.js` | Same as functions copy via `hymnSheetPages` | **No** |

Nothing in the hymn sheet pipeline calls `storage.ref().child(rootPath).get()` or
`getDownloadURL()` on read for existing pages. The only client Storage API uses
on legacy paths are **delete** paths in `hymns.js` (`refFromURL(url).delete()`),
which need `hymns.edit` on the encoded path — blocked on root after lockdown
until migration rewrites URLs to `hymn-sheets/…` or an editor uploads anew.

**Conclusion:** A temporary read-only legacy rule for root hymn folders is **not**
required for viewing, printables, or PDF export during the post-merge migration
window. **No** `// MS-769 legacy` block was added to `storage.rules`.

**Follow-up:** If a prod audit finds hymn page URLs **without** `token=` (hand-edited
or pre-token data), add a scoped legacy read rule or fix those rows before deleting
root objects. Re-check with a Firestore sample after the dry-run log.

## Client and function Storage paths

| Code | Path pattern | Read under new rules | Write under new rules |
| --- | --- | --- | --- |
| `public/hymns.js` | `hymn-sheets/{name}/{file}` | public (+ token URLs) | `hymns.edit` (editor / map) |
| `public/person-photo-core.js` | `people_photos/{personId}/{fileId}` | signed-in | signed-in + image 5MB |
| `public/calendar-event.js` | `event_attachments/{occ}/{att}/{file}` | occurrence visibility | `isEditorAccount` 25MB |
| `public/form.js` | `form_uploads*` | editor / elder | **false** (publicForm function) |
| `public/printable-editor.js`, `printable-editor-data.js` | `printable_assets/{id}/{file}` | signed-in | editor image 8MB |
| `public/printable-editor-data.js`, `sunday-typed-core` | `sunday_typed/{date}/country_map/{file}` | signed-in | editor image 8MB |
| `public/resources-store.js` | `resources/{id}/{file}` | member | `resources.edit` |
| `public/guide-store.js` | `guide-assets/{id}/{file}` | public (+ token in HTML) | `services.builder.edit` image 8MB |
| `functions/index.js` | `form_uploads*`, attachments cleanup | admin SDK bypasses rules | admin SDK |
| `functions/resource-writes.js` | `resources/{id}/{file}` | admin SDK | admin SDK |

### Anonymous auth

- **Public forms / answer links:** uploads via `publicForm` Cloud Function (admin
  credentials). Client Storage rules stay `write: if false` on `form_uploads/`.
- **Kiosk:** no Storage paths; Firestore-gated reads only.
- **Hymn / guide asset pages:** world-readable Firestore records; img `src` uses
  download tokens. Direct Storage fetch without a token is allowed on
  `hymn-sheets/` and `guide-assets/` to match Firestore `allow read: if true`.

### Production sequence (decided)

1. **Merge** this PR → CI deploys code + `storage.rules`.
2. **Dry-run** `migrate-hymn-sheets-prefix.js` on `main` (prod-ops workflow).
3. **Jonathan reviews** the dry-run log.
4. **Commit run** the same workflow (`commit=true`).
5. **Tiny follow-up PR:** none required for a legacy Storage rule (see above).
   Optional follow-up only if dry-run shows tokenless URLs or after root blob cleanup.

Editor **delete/replace** of legacy root blobs via the Hymns UI may fail between
steps 1 and 4; viewing and print paths keep working on token URLs. See
`docs/ops/ms-769-hymn-sheets-migration.md`.

## Emulator evidence

`test/emulator/storage-rules.test.js` exercises each prefix for anonymous,
member, editor, and elder (plus admin on deny-unknown). Run:

`npm run test:emulator`
