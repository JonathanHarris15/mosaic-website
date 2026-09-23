const {test} = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// MS-250 — the Capacitor push plugin is wired. The APNs key, the two platform
// config files, and a console test on a real phone are account work and are
// not asserted here.

const root = path.join(__dirname, "..");

test("the Capacitor push plugin is a dependency and both native projects include it", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(pkg.dependencies["@capacitor/push-notifications"],
      "package.json is missing @capacitor/push-notifications");

  const gradle = fs.readFileSync(
      path.join(root, "android/capacitor.settings.gradle"), "utf8");
  assert.match(gradle, /capacitor-push-notifications/);

  const swift = fs.readFileSync(
      path.join(root, "ios/App/CapApp-SPM/Package.swift"), "utf8");
  assert.match(swift, /CapacitorPushNotifications/);
});

test("native push config files are gitignored rather than invented", () => {
  const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /android\/app\/google-services\.json/);
  assert.match(ignore, /GoogleService-Info\.plist/);
  assert.ok(!fs.existsSync(path.join(root, "android/app/google-services.json")),
      "a google-services.json is in the tree; it must be a real download, not a stub");
  assert.ok(!fs.existsSync(path.join(root, "ios/App/App/GoogleService-Info.plist")),
      "a GoogleService-Info.plist is in the tree; it must be a real download, not a stub");
});
