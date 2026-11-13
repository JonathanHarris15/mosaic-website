# `storage.rules`: the repo against the live bucket (MS-693)

MS-693 adds `storage` to the standing deploy set, so the deploy that ships it
is the first time `storage.rules` leaves this repo through CI. This is the
comparison run before that merge.

- **Project:** `mosaic-hymn-database`
- **Release:** `firebase.storage/mosaic-hymn-database.firebasestorage.app`
- **Live ruleset:** `projects/mosaic-hymn-database/rulesets/910d6da2-c074-499d-86c0-ad541e583331`
- **Live since:** 2026-09-08
- **Fetched:** read-only, Firebase Rules API v1, prod service account, 2026-10-19

## The headline: the repo is a month and four tickets ahead of the bucket

Nothing has shipped `storage.rules` since 8 September, because `storage` was
never in the `--only` set (`docs/ops/ms-545-functions-deploy-set.md`). Four
merged tickets' rules have been sitting undeployed:

| Commit | What it changed in `storage.rules` |
| --- | --- |
| `267d1a6` MS-518 | Pastoral Assistant reads as elder |
| `d59e947` MS-591 | `sunday_typed/{date}/country_map/{fileId}` block |
| `f61e226` MS-596 | PA elder shepherding writes |
| `e963750` | Pastoral Assistant as a permission level |
| `bb14060` MS-693 | `resources/{resourceId}/{fileName}` block |

So this deploy carries five tickets, not one. Review it as such.

The control, run at the same time: `cloud.firestore`'s live ruleset
(`68c40128…`, released 2026-10-19) is **byte-identical to `main`**. Firestore
has been in the `--only` set all along and tracks the repo exactly. The same
command against the same project found Storage a month and four tickets
behind. That is the whole argument for the workflow change in one diff.

## Path by path

Nothing live-allowed is lost. No `match` block was removed, and the
`{allPaths=**}` catch-all is byte-identical.

| Path | Live | Repo | Effect |
| --- | --- | --- | --- |
| `people_photos/{personId}/{fileId}` | read auth; write auth + <5MB + image; delete false | identical | — |
| `event_attachments/{occ}/{att}/{file}` | read `canSeeOccurrence`; write `isEditorAccount` + <25MB; delete false | identical text | `isEditorAccount()` now also admits Pastoral Assistant — **widened** |
| `form_uploads/{formId}/{responseId}/{fileName}` | read `isEditorAccount` | read `readsAsEditorAccount` | **widened** (PA) |
| `form_uploads_elder/…` | read `isElderAccount` | read `readsAsElderAccount` | **widened** (PA) |
| `printable_assets/{printableId}/{fileId}` | read auth; write `isEditorAccount` + <8MB + image; delete false | identical text | PA widening only |
| `sunday_typed/{date}/country_map/{fileId}` | *(no block — catch-all)* | read auth; write editor + <8MB + image; delete false | **new block** |
| `resources/{resourceId}/{fileName}` | *(no block — catch-all)* | read member; write/delete `resources.edit`; <25MB | **new block** |
| `{allPaths=**}` | read, write if `request.auth != null` | identical | — |

### The two new blocks are narrower than the catch-all. Both were checked.

`resources/` is new in MS-693; nothing writes there today.

`sunday_typed/{date}/country_map/` had two writers, and both already satisfy
the narrower rule:

- `printable-editor-data.js` uploads behind `canEdit`, with an explicit
  `contentType` that is always `image/*`, after compressing to under 8MB.
- `printable-view.js` → `printable-link-store.js` rejects anything whose
  `file.type` is not `image/*` and anything over 8MB, and `canFill === canEdit
  === writesAsEditor`.

Neither deletes a country map, so `allow delete: if false` takes nothing away.

### Everything still on the catch-all

`guide-assets/{id}/{fileName}` (`guide-store.js`) reads, writes **and deletes**
through the catch-all, which is unchanged. Hymn sheets likewise — see below.

## ⚠ The finding: the catch-all overrides every block above it

Firebase Security Rules are OR-ed, and **order in the file is not
significant**. From the Cloud Storage rules
[documentation](https://firebase.google.com/docs/storage/security/core-syntax):

> If multiple rules match a file, the result is the `OR` of the result of all
> rules evaluations. That is, if any rule the file matches evaluates to `true`,
> the result is `true`.

and, on two overlapping blocks:

> all reads and writes to files whose name starts with `/images/` are allowed
> because the second rule is always `true`, even when the first rule is
> `false`.

`match /{allPaths=**} { allow read, write: if request.auth != null; }` matches
every object in the bucket. So every narrower condition in this file is
currently decoration for any request carrying an auth token:

- the 5MB image cap on a Directory Photo, and its `allow delete: if false`
- `allow write: if false` on `form_uploads/` and `form_uploads_elder/`
- an elder-only Event Attachment read
- the `resources.edit` write gate and member read on the Resources library

**Anonymous sign-in is enabled on this project** (confirmed against the
Identity Toolkit admin config, 2026-10-19:
`signIn.anonymous = {enabled: true}`). `request.auth != null` is therefore not
"a member of this church" or even "somebody who signed up" — it is anybody who
calls `signInAnonymously()` with the public web API key.

### This PR does not make it worse

The catch-all is byte-identical live and in the repo, so deploying changes
nothing about it. What the PR must not do is *claim* otherwise, which is why
the comment on the `resources/` block and `test/resources-rules.test.js` were
both corrected rather than left reading as a boundary.

### Why it is not fixed here

Hymn sheets are written to the bucket **root**, under the hymn's own name:

```js
// public/hymns.js
const folder = storage.ref().child(this.form.hymn_name);
await folder.child(page.file.name).put(page.file);
```

A hymn name is free text, so there is no prefix a `match` could use. Closing
the catch-all means giving hymn sheets a namespace and migrating the objects
already in the bucket — a data migration on the app's oldest feature, which is
its own ticket rather than a line changed inside a feature PR.

Reading an existing hymn page is unaffected either way: those URLs are
`getDownloadURL()` tokens, which bypass rules entirely (ADR-0046 is about
exactly this). It is `put` and `delete` that go through the catch-all.

A narrowing that would work once hymns are namespaced: replace
`match /{allPaths=**}` with explicit blocks per prefix, including one for
`guide-assets/{id}/{fileName}` preserving its current read/write/delete.

## Reproducing this

```bash
# read-only; lists releases and writes the live ruleset source to a file
node scripts/fetch-live-rules.js --project mosaic-hymn-database
diff -u /tmp/live-storage.rules storage.rules
```
