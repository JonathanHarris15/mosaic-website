# Shipping Mosaic Manager to phones

How to get the app onto church members' phones via a private invite link — no public
App Store or Play Store listing, no one can search for it and find it.

Two links, one per platform. You paste both into the group chat.

- **iPhone** → a TestFlight public link. Anyone who taps it installs the app.
- **Android** → a Play Store internal-testing link. Installs like a normal app,
  auto-updates, no "unknown sources" warnings.

Neither route lists the app publicly.

---

## How the app is put together

The native app **bundles** the whole `public/` folder inside the binary. It is not a
browser pointed at the website. That means:

- It opens instantly and works on bad wifi.
- Apple's reviewers see a real app, not a repackaged website (guideline 4.2 is the
  most common rejection reason for web wrappers — bundling avoids it).
- **Church data still updates live.** Services, hymns, people and documents all come
  from Firestore at runtime.
- **Code changes do not.** New pages, new features or bug fixes need a new build and
  a re-upload. See "Shipping an update" at the bottom.

When the app is running natively, `public/index.html` redirects straight into the
mobile shell (`mobile.html`). Browsers are unaffected.

---

## Before you start: two things both stores demand

### 1. A privacy policy URL

Both Apple and Google require a public web page describing what data the app collects.
It just needs to exist at a real URL — e.g. add `public/privacy.html` and deploy, giving
you `https://mosaic-hymn-database.web.app/privacy.html`.

### 2. A demo account for Apple

The app is behind a login. **Apple's reviewer will reject a build they cannot get into.**
Create a real Firebase user with a plain viewer role, and give App Store Connect its
email and password in the TestFlight "Test Information" section.

---

## Part A — Android (do this on Windows, it's the easier half)

### A1. Set up your shell

Java and the Android SDK are installed but not on your PATH. Every terminal session
that builds Android needs:

```powershell
$env:JAVA_HOME = "C:\Users\jono1\android-tools\jdk-21.0.11+10"
```

### A2. Create your upload key (once, ever)

This key identifies you to Google. **If you lose it you cannot ship updates.** Back the
`.jks` file up somewhere outside the repo — a password manager or Dropbox.

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -genkey -v `
  -keystore "$HOME\mosaic-upload-key.jks" `
  -alias mosaic-upload -keyalg RSA -keysize 2048 -validity 10000
```

It will ask for a password and some name/organisation details. Any sane answers are fine.

Then create `android/keystore.properties` (already gitignored — it holds your password,
it must never be committed):

```properties
storeFile=C:/Users/jono1/mosaic-upload-key.jks
storePassword=<the password you just chose>
keyAlias=mosaic-upload
keyPassword=<the same password, unless you set a different one>
```

`android/app/build.gradle` picks this file up automatically and signs release builds
with it. Without the file, release builds come out unsigned — harmless, just not
uploadable.

### A3. Build the upload file

```powershell
npm run build:css
npx cap sync android
cd android
.\gradlew bundleRelease
```

Your upload file lands at `android/app/build/outputs/bundle/release/app-release.aab`.

### A4. Play Console

1. **Create app** — name "Mosaic Manager", app, free.
2. **Complete the "App content" section.** This is the boring hour: privacy policy URL,
   data safety questionnaire, content rating, target audience, "no ads", "not a news
   app", "not a government app". Google will not let you release anything until these
   are all green.
3. **Testing → Internal testing → Testers.** Create an email list. Every member who
   wants the app gives you the Google account email they use on their phone. Cap is
   **100 testers**.
4. **Create a new release**, upload `app-release.aab`. Accept **Play App Signing** when
   offered — this is what lets Google re-issue your key if you ever lose it.
5. **Roll out to internal testing.** Available within minutes; there is no meaningful
   review wait on this track.
6. Copy the **join link** from the Testers tab. That is the link for the group chat.

Members tap the link, accept, then install from the Play Store as normal.

> **Note for later:** Google is phasing in developer verification for apps installed
> outside the Play Store — the pilot countries start September 2026 and it goes global
> in 2027. Because you are shipping through Play, this does not affect you. It is
> precisely why we did not go the "download an APK from a link" route.

---

## Part B — iPhone (this half must happen on the Mac)

### B1. Prepare the Mac

Install **Xcode** from the Mac App Store, then:

```bash
sudo gem install cocoapods       # or: brew install cocoapods
git clone <your repo>            # or pull, if it's already there
cd main
npm install
```

### B2. Create the iOS project

The `ios/` folder does not exist yet — it has never been created, because it can only be
made on a Mac. This is the step that makes it:

```bash
npm run build:css
npx cap add ios
npx capacitor-assets generate --ios     # app icon + splash screens
npx cap sync ios
```

Commit the resulting `ios/` folder.

### B3. Configure signing in Xcode

```bash
npx cap open ios
```

In Xcode, select the **App** target:

- **Signing & Capabilities** → tick "Automatically manage signing", pick your Apple
  Developer team. The bundle ID is already `com.mosaicmanagercstx.app`.
- **Info** → add a row: `ITSAppUsesNonExemptEncryption` = `NO`. (The app only uses
  normal HTTPS. Setting this saves you answering an export-compliance question on every
  single upload.)
- **General** → set Version to `1.0` and Build to `1`.

### B4. Register the app with Apple

In [App Store Connect](https://appstoreconnect.apple.com) → **Apps → +** → New App.
Platform iOS, name "Mosaic Manager", bundle ID `com.mosaicmanagercstx.app`, any SKU.

You are creating a record so TestFlight has somewhere to put builds. **You never submit
it to the App Store.** It stays in "Prepare for Submission" forever, and that is fine.

### B5. Upload a build

In Xcode: **Product → Archive** (make sure the device dropdown says "Any iOS Device",
not a simulator — Archive is greyed out otherwise). When the Organizer opens:
**Distribute App → App Store Connect → Upload**.

Processing on Apple's side takes 5–30 minutes.

### B6. Turn on TestFlight

In App Store Connect → your app → **TestFlight**:

1. Fill in **Test Information**: beta app description, feedback email, your privacy
   policy URL, and — critically — the **demo account** email and password from the
   prerequisites. Skipping this is the number one cause of rejection for a login-gated
   app.
2. Create an **External** testing group (not Internal — Internal is capped at 100 people
   who each need an App Store Connect account; External allows up to 10,000 with no
   accounts at all).
3. Add your build to the group and **submit for Beta App Review**.
4. Review usually takes a day or two. It is much lighter than a full App Store review.
5. Once approved, **enable the Public Link** on the group.

That public link is what goes in the group chat. Anyone who taps it installs TestFlight,
then the app. No Apple ID needs to be collected from anyone.

---

## Shipping an update

**Every upload needs a higher version number** — both stores reject a rebuild of a
version they have already seen.

- Android: bump `versionCode` (and usually `versionName`) in `android/app/build.gradle`.
- iOS: bump the Build number in Xcode.

Then:

```powershell
npm run build:css
npx cap sync
```

…and repeat A3–A4 for Android, B5 for iOS.

### The 90-day rule

**TestFlight builds expire 90 days after upload.** When one expires, your iPhone users
see "Expired Build" and cannot open the app until you upload a new one. So even if you
change nothing, you must push a fresh iOS build roughly every three months.

Rebuilds after the first do **not** need another Beta App Review, as long as you stay on
the same version number stream. Android has no expiry.
