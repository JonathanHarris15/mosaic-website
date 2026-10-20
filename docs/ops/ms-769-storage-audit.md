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
| Legacy root `{hymn}/{file}` | catch-all | **denied** after migration |

Anonymous sign-in is enabled on the project. `request.auth != null` on live
rules treats anonymous the same as a member for every path the catch-all
matched.

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

### Deploy prerequisite

Run `migrate-hymn-sheets-prefix.js` with `--commit` **before** or immediately
after rules deploy so no production hymn still points at a root path that is no
longer readable under rules. See `docs/ops/ms-769-hymn-sheets-migration.md`.

## Emulator evidence

`test/emulator/storage-rules.test.js` exercises each prefix for anonymous,
member, editor, and elder (plus admin on deny-unknown). Run:

`npm run test:emulator`
