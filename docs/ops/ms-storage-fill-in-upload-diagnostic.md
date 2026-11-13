# Storage rules that read Firestore — the fill-in upload outage

**Status (2026-10-21):** root cause found. The fix is one IAM grant by a
project owner. Nothing in the repo can apply it.

## What is broken

Every Storage request whose rule calls `firestore.get()` or
`firestore.exists()` is refused for every caller in `mosaic-hymn-database`.
That includes a super admin, a fresh editor, and a signed-out reader of a
public occurrence. They all get `storage/unauthorized`, the same error a
wrong rule gives, which is why the fill-in upload looked like a rules bug.

| Path | Broken | Still works |
| --- | --- | --- |
| `printable_assets/…` (fill-in images, logos) | write | signed-in read |
| `sunday_typed/{date}/country_map/…` | write | signed-in read |
| `hymn-sheets/…`, `guide-assets/…` | write, delete | read |
| `resources/…` | read, write, delete | — |
| `event_attachments/…` | read, write | — |
| `form_uploads/…`, `form_uploads_elder/…` | read | — |
| `people_photos/…` | — | everything (no Firestore read) |

`getDownloadURL()` links bypass rules (ADR-0046), so images already placed on
a page still show.

## Root cause

A Storage rule's Firestore read is made by the Cloud Storage for Firebase
service agent, `service-<projectNumber>@gcp-sa-firebasestorage.iam.gserviceaccount.com`.
It works only while that agent holds `roles/firebaserules.firestoreServiceAgent`
("Firebase Rules Firestore Service Agent") on the project. Without it, in
Firebase's words, "Security Rules evaluations will cause your Storage requests
to fail". That quote is from "Manage permissions for cross-service Cloud Storage
Security Rules" in [Manage and deploy Firebase Security Rules](https://firebase.google.com/docs/rules/manage-deploy).

**Why no deploy granted it.** The CLI offers the role only behind a prompt.
firebase-tools 15.23 `lib/rulesDeploy.js` `checkStorageRulesIamPermissions`
does this:

```js
if (this.options.nonInteractive) {
    return;
}
```

So it neither checks nor grants. It is also reached only when the ruleset
content changed: an "already up to date" deploy skips it. Both deploy
workflows pass `--non-interactive`. The two CI deploys that uploaded a new
Storage ruleset, MS-693 (run 39341834588) and MS-769 (run 39454806155),
each logged `uploading rules storage.rules...` and then `released rules`.
Neither logged `updated service account for cross-service rules`, or the
CLI's warning that it could not check. The #293 deploy (run 39627945212)
logged `latest version of storage.rules already up to date, skipping upload...`.

**Why it surfaced on 2026-10-20.** Matching rules are OR-ed. Until MS-769
(#279) removed `match /{allPaths=**} { allow read, write: if request.auth != null; }`,
that catch-all let every signed-in request through. It made no difference
whether the cross-service rules could evaluate. MS-693 (#272, 2026-10-19)
was the first CI deploy of `storage.rules`, and MS-769 made those rules the
only door.

**Why #289–#293 could not fix it.** Each one changed what a rule checks: the
permission map, the stored `super_admin`, the `image/*` contentType. Every
one of those checks sits behind `firestore.exists` / `firestore.get` on
`users/{uid}`, which fails first.

## Evidence

**Behaviour, in prod.** These are signed-out GETs for objects that do not
exist. A rule answers before the object lookup, so an allowed read is 404
and a denied one is 403. The probe is `scripts/check-storage-cross-service.js --probe-only`.

| Read | Rule | Reads Firestore | Prod | Emulator |
| --- | --- | --- | --- | --- |
| `hymn-sheets/__cross_service_probe__/none` | `if true` | no | 404 allowed | allowed |
| `people_photos/__cross_service_probe__/none` | `isSignedIn()` | no | 403 denied | denied |
| `event_attachments/<public occurrence>/__cross_service_probe__/none` | `canSeeOccurrence` → `firestore.get(event_occurrences/…)` → `'public'` | yes | **403 denied** | allowed |

- Three different public occurrences answered 403 at 2026-10-21T16:04Z. One
  of them answered 403 again at 16:26Z. Each was confirmed `public` with a
  signed-out Firestore read.
- The live ruleset is the repo's `storage.rules` at `b3dcdb9`. Deploy run
  39627945212 logged `released rules storage.rules to firebase.storage` at
  15:42:14Z, and the release `firebase.storage/mosaic-hymn-database.firebasestorage.app`
  has `updateTime` 15:42:13.998Z.
- The emulator needs no IAM for cross-service reads. On the same rules text it
  allows the same request.

**Not yet seen directly: the binding itself.** Reading project IAM needs
credentials an agent box does not have. `gcloud projects get-iam-policy`
(below) shows it, and so does the diagnostic once it is on `main`. If the role
turns out to be bound, the check script says so. It then points at
propagation, an org policy, or a VPC Service Controls perimeter instead.

**The rules are right.** `test/emulator/storage-rules.test.js` writes the
exact failing path, `printable_assets/sEKK4xDbteFhCLNWlfMz/img…_sing-02.png`
as `image/png`. It is allowed for the prod super-admin doc shapes
(`{role: 'super_admin'}` alone, and with `permissionLevel`) and for a fresh
editor (`userWriteFromLevel('level_editor')`). It is denied signed out and
anonymous.

**Not the bucket.** `firebase.json` names no bucket, so the deploy releases to
the Firebase default bucket. That bucket is
`mosaic-hymn-database.firebasestorage.app`, the one `public/firebase-config.js`
uploads to. The timestamps above match.

**Not the client.** Auth and Storage come from the same default app
(`public/auth.js`). A 403 is a rules denial; a failed App Check would be 401.
And a fresh editor fails the same way as Jonathan.

## Fix (a project owner, once)

This changes project IAM, so it needs `resourcemanager.projects.setIamPolicy`
(Owner or Project IAM Admin). The deploy service account does not need that
permission, and should not be given it. Run this in Cloud Shell on the
project, or anywhere `gcloud` is signed in as an owner:

```bash
gcloud projects add-iam-policy-binding mosaic-hymn-database \
  --member="serviceAccount:service-$(gcloud projects describe mosaic-hymn-database --format='value(projectNumber)')@gcp-sa-firebasestorage.iam.gserviceaccount.com" \
  --role="roles/firebaserules.firestoreServiceAgent" \
  --condition=None
```

Re-running a deploy does not do this. Unchanged rules are "already up to
date" and never reach the prompt, and CI never prompts.

**Verify.** IAM takes a few minutes to propagate. This needs no credentials:

```bash
node scripts/check-storage-cross-service.js --project mosaic-hymn-database --i-mean-prod --probe-only
```

The `event_attachments/…` line turns from 403 to 404, and the script prints
`Storage rules can read Firestore.` and exits 0. Then retry the fill-in
upload.

**See the binding.**

```bash
gcloud projects get-iam-policy mosaic-hymn-database \
  --flatten="bindings[].members" \
  --filter="bindings.members:gcp-sa-firebasestorage.iam.gserviceaccount.com" \
  --format="table(bindings.role)"
```

In the Cloud console IAM page, tick **Include Google-provided role grants**.
The agent is hidden without it.

The ghost (`mosaic-manager-ghost`) ships the same `storage.rules` with
`--non-interactive --force`, so it needs the same grant under its own
project id. Its probe cannot decide until some occurrence there is stamped
`public`.

## Keeping it fixed

`.github/workflows/firebase-deploy.yml` runs this after the deploy:

```bash
node scripts/check-storage-cross-service.js --project mosaic-hymn-database --i-mean-prod
```

When `storage.rules` reads Firestore, it reads the project IAM policy (if the
deploy account may) and runs the probe. Behaviour outranks configuration. The
job goes red, with the grant command, when Storage cannot read Firestore. It
runs after the deploy, so a missing grant never holds back hosting.

## The diagnostic

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=diagnose-storage-fill-in-upload.js \
  -f 'args=' \
  -f commit=false
```

It is read-only and ignores `commit=true`. Each section stands alone, so one
refused API call cannot hide the rest. It prints:

- **Buckets**: the client's bucket, the Firebase default bucket (what an
  unnamed `storage` deploy releases to), and the linked buckets.
- **Rules releases per bucket**: every `firebase.storage/<bucket>` release, its
  ruleset, and markers (`sameAsRepo`, `usesCrossService`, catch-all, the
  `printable_assets` write clause).
- **Super-admin `users/{uid}`**: uid, masked email, `permissionLevel`, `role`,
  `accountLevelId`, `pastoralAssistant`, and the permission-map summary.
- **Project IAM**: the project number, and whether the Storage service agent
  holds the role unconditionally.
- **Bucket IAM**: the agent's roles on each bucket. The cross-service role is
  a project binding, so it is not expected there.
- **This caller**: whether the deploy account may read or set the project IAM
  policy.
- **The signed-out probe**, then a verdict with the grant command when it is
  needed.

The run log of a public repo is public. Emails are masked, and no IAM member
other than the Storage service agent is printed.

## Client check (still true, not the cause)

Fill-in uploads go through `PrintableLinkStore.uploadImage`, which must pass an
explicit `image/*` `contentType` on `put()`. A prepared file whose `.type` is
`application/octet-stream` fails `request.resource.contentType.matches('image/.*')`
with `storage/unauthorized`.
