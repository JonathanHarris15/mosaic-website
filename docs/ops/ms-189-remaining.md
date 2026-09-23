# MS-189 — what is left for Jonathan (MS-260)

No App Store upload and no Play upload was made. Do not treat this branch
as store-ready until the checks below have been done on real phones.

## Secrets and project files (not in git)

See `docs/ops/ms-189-push-setup.md`. Still outstanding:

- `android/app/google-services.json` and `ios/App/App/GoogleService-Info.plist`
  for `mosaic-hymn-database` (gitignored; not invented here).
- An APNs authentication key uploaded in the Firebase console for the church
  project. The `.p8` stays out of the repo.
- Xcode Push Notifications capability (`aps-environment`). The background
  mode is already in the plist; the entitlement is an Xcode account step.
- A Firebase console test message on a real iPhone and a real Android phone
  after a debug build. That is the last box of MS-250.

FCM itself needs no new secret. A deployed function sends with its own
service account.

## Before the renamed log is live

The outbound log is now the `notifications` collection. The copy script
does not run from an agent and does not delete `sms_messages`.

1. Dry-run, then commit, against the church project only:

   ```bash
   node scripts/migrate-sms-messages-to-notifications.js \
     --project mosaic-hymn-database --i-mean-prod
   node scripts/migrate-sms-messages-to-notifications.js \
     --project mosaic-hymn-database --i-mean-prod --commit
   ```

2. Create the composite index on `notifications` (`textId` ASC, `direction`
   ASC) in `firestore.indexes.json`. Indexes are not in the standing deploy
   set. `smsInbound` looks replies up by that index. Deploy the index before
   the functions that read the new collection.

3. Redeploy together, or a reply can miss its outbound row:
   `sendPrayerRequestTexts`, `sendPrayerRequestNow`, `smsInbound`,
   `smsSendTest`, `notifyEldersOnPrayerComplete`.
   `sendPrayerRequestNow` is already in the standing `--only` set.
   The others are not. Do not widen that set in a drive-by; ship them
   together on purpose.

4. `notificationReachability` (user ids that have a device token, for the
   directory sentence) is also not in the standing set. Until it is
   deployed, Edit Mode hides the sentence rather than guessing.

## On a real phone (MS-260)

- Install a debug or TestFlight / internal-track build. Do not submit to
  the public stores from this work.
- Sign in as a linked person. The explainer appears on Home, not on first
  launch and not while signed out. Allow once. Confirm a token document
  appears at `users/{uid}/push_tokens/{id}`.
- Sign out. That document is deleted.
- Deny permission. Home and Profile offer Open Settings. `app-settings:`
  is what iOS opens. Confirm Android opens the app's notification settings;
  if it does not, that is the remaining platform fix.
- Send a pastoral-prayer ask to a person with a live token. It should be a
  push, and a tap should open the URL on the payload. With no token and a
  phone, the same ask is a text. With neither, nothing is sent and the
  editor sees one sentence in Edit Mode.
- The Answer link (`/a/<token>`) is not minted here. MS-247 passes `url`
  into `sendPrayerRequestNow` and the scheduler's ask when that mint
  exists. A push and a text both receive that URL. Nothing in this branch
  invents `/a/`.

## Out of this feature

MS-248, MS-249, and MS-623 are later callers of the same path. They are
not wired.
