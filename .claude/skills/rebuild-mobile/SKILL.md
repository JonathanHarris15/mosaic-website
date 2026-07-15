---
name: rebuild-mobile
description: Rebuild the Mosaic Manager mobile apps for BOTH stores after a change that affects both — bumps the build number in lockstep, rebuilds CSS, runs cap sync, produces a signed Android .aab, and archives + uploads iOS to TestFlight. Use when the user says "rebuild both apps", "rebuild mobile", "ship a new mobile build", or after code changes that need to reach iOS and Android.
---

# Rebuild both mobile apps

Mosaic Manager is a Capacitor app whose `public/` folder is bundled into each native
binary. Firestore data updates live, but **code changes require a fresh native build and
re-upload** to each store. This skill does that for both platforms from this Mac.

Background on the release model and stores lives in [docs/mobile-release.md](../../../docs/mobile-release.md).

## What the build script does

`scripts/mobile-build.mjs` (also `npm run mobile:build`) runs, in order:

1. **Preflight** — checks the machine config and that each platform's secrets exist.
2. **Version bump** — increments the build number to `max(android, iOS) + 1` and writes it
   to **both** `android/app/build.gradle` (`versionCode`) and
   `ios/App/App.xcodeproj/project.pbxproj` (`CURRENT_PROJECT_VERSION`), keeping them in
   lockstep. Both stores reject a rebuild of a number they've already seen.
3. **`npm run build:css`** then **`npx cap sync`**.
4. **Android** — `./gradlew bundleRelease` → signed
   `android/app/build/outputs/bundle/release/app-release.aab`.
5. **iOS** — `xcodebuild archive` → `exportArchive` → uploads to App Store Connect
   (TestFlight) via the App Store Connect API key.

## How to run it

Default (both platforms, auto-bump, iOS uploads to TestFlight):

```bash
node scripts/mobile-build.mjs
```

Useful flags:

- `--platform ios` or `--platform android` — build only one (the version bump still applies
  to both files so they stay in lockstep).
- `--set-version 1.2` — also set the marketing/version name on both platforms.
- `--build 7` — force an explicit build number instead of auto-increment.
- `--no-upload` — iOS: export the `.ipa` but don't upload.
- `--no-bump` — leave version numbers unchanged (local test only; stores will reject it).

## Steps for the agent

1. **Confirm what changed and that both platforms need it.** If the change is web-only and
   already live via Firestore, a rebuild may not be needed — say so.
2. **Run the build.** Default to `node scripts/mobile-build.mjs` for both platforms. Stream
   the output; the script fails loudly with an actionable message if a secret is missing.
3. **If preflight fails on a missing secret**, point the user at the setup section below —
   don't try to work around it. The two secrets (keystore, ASC API key) only the user has.
4. **On success**, report the new build number and the per-platform "next" steps the script
   prints: Android `.aab` still needs a manual upload to Play Console → Internal testing;
   iOS lands in TestFlight automatically after Apple finishes processing (5–30 min).
5. **Commit the version bump** if the user wants it committed (the two version files change
   every run). Don't commit `mobile-release.local.json`, `android/keystore.properties`, or
   any `*.p8`/`*.jks` — they're gitignored secrets.

## One-time setup (already done on this Mac unless noted)

Installed and configured:

- **JDK 21** at `/opt/homebrew/opt/openjdk@21` (Homebrew `openjdk@21`).
- **Android SDK** at `/opt/homebrew/share/android-commandlinetools` (platform 36,
  build-tools 36.0.0, platform-tools) — pointed to by `android/local.properties`.
- **`mobile-release.local.json`** — machine config (gitignored). Android section is filled;
  iOS section has placeholders.

**Two secrets the user must supply** (the build cannot upload without them):

1. **Android upload keystore** — copy `mosaic-upload-key.jks` from the backup onto this Mac,
   then copy `android/keystore.properties.example` → `android/keystore.properties` and fill
   in the path + passwords. Losing this key means you can't ship Android updates, so it lives
   only in a password manager / Dropbox, never the repo.
2. **App Store Connect API key** — in App Store Connect → Users and Access → Integrations →
   App Store Connect API, create a key with the **Admin** role. (Admin is required: the
   export step uses cloud signing to create the distribution certificate, which lower roles
   like App Manager are not permitted to do — the symptom is "Cloud signing permission
   error / No signing certificate iOS Distribution found".) Download the `.p8`
   (one-time download) to `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`, then fill
   `teamId`, `ascApiKeyId`, `ascApiIssuerId`, and `ascApiKeyPath` in
   `mobile-release.local.json`.

Both are gitignored. Once in place, `node scripts/mobile-build.mjs` runs fully hands-off.

## Notes

- **TestFlight builds expire 90 days after upload.** Even with no code change, push a fresh
  iOS build roughly every three months or iPhone users see "Expired Build".
- iOS uses **automatic signing** with `-allowProvisioningUpdates`; the API key lets
  `xcodebuild` fetch the distribution profile without any Xcode GUI login.
- Play Console upload is still a manual drag-and-drop (no Google service account is set up).
  If the user wants that automated too, it needs a Play Developer API service-account JSON.
