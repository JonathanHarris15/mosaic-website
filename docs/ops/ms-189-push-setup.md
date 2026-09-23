# MS-189 — Push wiring (what code can do, and what it cannot)

The send path uses **Firebase Cloud Messaging** through `firebase-admin`
(already a functions dependency). A deployed function's own service account
can send. There is **no new secret to invent** for FCM, and this repo does
not contain one.

Apple still has to trust that project. Firebase talks to APNs only after an
**APNs authentication key** (`.p8`, already gitignored) is uploaded in the
Firebase console. That key is account work. Do not commit it. Do not paste it
into a workflow.

## Already in the repo

- `@capacitor/push-notifications` in `package.json`, synced into the Android
  and iOS projects (`npx cap sync`).
- Android `POST_NOTIFICATIONS` (required on Android 13+ before a notification
  can show).
- iOS `UIBackgroundModes` → `remote-notification`.
- `android/app/google-services.json` and `ios/App/App/GoogleService-Info.plist`
  are gitignored. The Android Gradle build already skips the Google Services
  plugin when the JSON file is missing, and says so in the log.

## Still Jonathan (MS-250, HITL)

Do these in the **church** Firebase project (`mosaic-hymn-database`), not the
ghost.

1. Firebase console → Project settings → Cloud Messaging: confirm the API is
   on. (It is the default on current projects; there is nothing to commit.)
2. Register the iOS app `com.mosaicmanagercstx.app` if it is not already, and
   download `GoogleService-Info.plist` into `ios/App/App/`.
3. Register the Android app with the same id, and download
   `google-services.json` into `android/app/`.
4. Apple Developer → Keys → create an **APNs authentication key**. Upload it
   under Firebase → Project settings → Cloud Messaging → Apple app
   configuration. The `.p8` stays out of git.
5. Xcode → the App target → Signing & Capabilities → **Push Notifications**.
   The plist background mode is already set; the capability is the signing
   entitlement (`aps-environment`) and only Xcode's account can add it.
6. After a debug build is on a real iPhone and a real Android phone, send a
   test from the Firebase console. That check is MS-250's last box and is not
   done from this agent.

## Still Jonathan (MS-260, do not submit stores from an agent)

See `docs/ops/ms-189-remaining.md`. No App Store or Play upload was made.
