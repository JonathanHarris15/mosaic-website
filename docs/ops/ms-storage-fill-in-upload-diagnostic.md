# Storage fill-in image upload diagnostic

When a super admin gets `storage/unauthorized` on `printable_assets/{printableId}/…`,
run the read-only prod ops script before changing rules again.

## Dispatch

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=diagnose-storage-fill-in-upload.js \
  -f 'args=' \
  -f commit=false
```

The script never writes, even if `commit=true` is set.

## What it prints

- **Super-admin-shaped `users/{uid}`** — `permissionLevel`, `role`, `accountLevelId`, and a summary of `permissions` (uid + email only).
- **`account_levels/{id}`** when `accountLevelId` is set.
- **Live Storage rules** release markers (`permissionLevelAccount`, `isSuperAdminAccount`, `printable_assets` write clause, catch-all).
- **Bucket IAM** — whether `service-<projectNumber>@gcp-sa-firebasestorage.iam.gserviceaccount.com` has `roles/firebaserules.firestoreServiceAgent`.

## Client check

Fill-in uploads go through `PrintableLinkStore.uploadImage`, which must pass an explicit `image/*` `contentType` on `put()`. A prepared file whose `.type` is `application/octet-stream` fails `request.resource.contentType.matches('image/.*')` with `storage/unauthorized`.
