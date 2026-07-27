#!/usr/bin/env node
// Rebuild Mosaic Manager for BOTH stores from this Mac.
//
// Bumps the build number on both platforms (kept in lockstep), rebuilds the CSS,
// runs `cap sync`, then:
//   Android -> signed .aab at android/app/build/outputs/bundle/release/app-release.aab
//   iOS     -> archive + export + upload to App Store Connect (TestFlight)
//
// Usage:
//   node scripts/mobile-build.mjs [options]
//     --platform ios|android|both   (default: both)
//     --set-version 1.2             set marketing/version name on both platforms
//     --build 7                     force an explicit build number (default: auto-increment)
//     --no-bump                     do not change version numbers (local test only)
//     --no-upload                   iOS: export the .ipa but do not upload to App Store Connect
//     --no-sync                     skip build:css + cap sync (rare)
//
// Machine config lives in ./mobile-release.local.json (gitignored). See the .example.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => join(ROOT, ...s);

// ---- tiny helpers -------------------------------------------------------
const C = { reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m' };
const step = (m) => console.log(`\n${C.cyan}${C.bold}==> ${m}${C.reset}`);
const info = (m) => console.log(`    ${m}`);
const ok = (m) => console.log(`    ${C.green}✔ ${m}${C.reset}`);
const warn = (m) => console.log(`    ${C.yellow}! ${m}${C.reset}`);
function die(m) { console.error(`\n${C.red}${C.bold}✗ ${m}${C.reset}\n`); process.exit(1); }
const expandHome = (f) => (f && f.startsWith('~') ? join(homedir(), f.slice(1)) : f);

function run(cmd, args, opts = {}) {
  info(`${C.dim}$ ${cmd} ${args.join(' ')}${C.reset}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) die(`\`${cmd} ${args.join(' ')}\` failed (exit ${r.status ?? r.signal}).`);
}

// ---- args ---------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const platform = String(opt('platform', 'both'));
if (!['ios', 'android', 'both'].includes(platform)) die(`--platform must be ios | android | both (got "${platform}")`);
const doIos = platform === 'ios' || platform === 'both';
const doAndroid = platform === 'android' || platform === 'both';
const setVersion = opt('set-version', null);
const forcedBuild = opt('build', null);
const noBump = argv.includes('--no-bump');
const noSync = argv.includes('--no-sync');
const noUpload = argv.includes('--no-upload');

// ---- config -------------------------------------------------------------
const CFG_PATH = p('mobile-release.local.json');
if (!existsSync(CFG_PATH)) die(`Missing ${CFG_PATH}\n  Copy mobile-release.local.json.example to mobile-release.local.json and fill it in.`);
let cfg;
try { cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8')); }
catch (e) { die(`Could not parse mobile-release.local.json: ${e.message}`); }

// ---- version files ------------------------------------------------------
const GRADLE = p('android', 'app', 'build.gradle');
const PBXPROJ = p('ios', 'App', 'App.xcodeproj', 'project.pbxproj');

function readAndroidVersion() {
  const t = readFileSync(GRADLE, 'utf8');
  const code = Number(t.match(/versionCode\s+(\d+)/)?.[1]);
  const name = t.match(/versionName\s+"([^"]+)"/)?.[1];
  return { code, name };
}
function readIosVersion() {
  const t = readFileSync(PBXPROJ, 'utf8');
  const build = Number(t.match(/CURRENT_PROJECT_VERSION = (\d+)/)?.[1]);
  const market = t.match(/MARKETING_VERSION = ([^;]+);/)?.[1];
  return { build, market };
}
function writeAndroidVersion(code, name) {
  let t = readFileSync(GRADLE, 'utf8');
  t = t.replace(/versionCode\s+\d+/, `versionCode ${code}`);
  if (name) t = t.replace(/versionName\s+"[^"]+"/, `versionName "${name}"`);
  writeFileSync(GRADLE, t);
}
function writeIosVersion(build, market) {
  let t = readFileSync(PBXPROJ, 'utf8');
  t = t.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
  if (market) t = t.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${market};`);
  writeFileSync(PBXPROJ, t);
}

// ---- 1. preflight -------------------------------------------------------
step('Preflight');
run('npx', ['cap', '--version'], { stdio: 'ignore' }); // capacitor present?

let androidEnv = null;
if (doAndroid) {
  const a = cfg.android || {};
  const javaHome = expandHome(a.javaHome);
  const sdk = expandHome(a.androidSdk);
  if (!javaHome || !existsSync(javaHome)) die(`android.javaHome not found: ${javaHome}`);
  if (!sdk || !existsSync(sdk)) die(`android.androidSdk not found: ${sdk}`);
  const ksProps = p('android', 'keystore.properties');
  if (!existsSync(ksProps)) {
    die(`android/keystore.properties is missing — release builds would be UNSIGNED and cannot be uploaded.\n` +
        `  Copy your mosaic-upload-key.jks onto this Mac, then copy android/keystore.properties.example\n` +
        `  to android/keystore.properties and fill in the path + passwords.`);
  }
  androidEnv = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, PATH: `${javaHome}/bin:${process.env.PATH}` };
  ok(`Android: JDK ${javaHome}`);
  ok(`Android: SDK ${sdk}`);
  ok('Android: keystore.properties present');
}

let ios = null;
if (doIos) {
  const i = cfg.ios || {};
  const keyPath = expandHome(i.ascApiKeyPath);
  const missing = [];
  if (!i.teamId || i.teamId.startsWith('YOUR_')) missing.push('teamId');
  if (!i.ascApiKeyId || i.ascApiKeyId === 'THE_KEY_ID') missing.push('ascApiKeyId');
  if (!i.ascApiIssuerId || i.ascApiIssuerId === 'the-issuer-uuid') missing.push('ascApiIssuerId');
  const upload = i.upload !== false && !noUpload;
  if (upload || missing.length) {
    if (missing.length) die(`iOS config incomplete in mobile-release.local.json: ${missing.join(', ')}\n  Fill these in from your Apple Developer account + App Store Connect API key.`);
    if (!keyPath || !existsSync(keyPath)) die(`App Store Connect API key not found: ${keyPath}\n  Download the .p8 from App Store Connect and put it there (it is *.p8, gitignored).`);
  }
  ios = { teamId: i.teamId, keyId: i.ascApiKeyId, issuerId: i.ascApiIssuerId, keyPath, upload };
  ok(`iOS: team ${ios.teamId}, ASC key ${ios.keyId}${ios.upload ? ', will upload to App Store Connect' : ', export only (no upload)'}`);
}

// ---- 2. version bump ----------------------------------------------------
step('Version numbers');
const av = readAndroidVersion();
const iv = readIosVersion();
info(`Current: Android versionCode ${av.code} (name ${av.name}) · iOS build ${iv.build} (version ${iv.market})`);

let newBuild;
if (noBump) {
  warn('--no-bump: leaving version numbers unchanged (stores reject a rebuild of a number they have seen).');
} else {
  newBuild = forcedBuild ? Number(forcedBuild) : Math.max(av.code || 0, iv.build || 0) + 1;
  if (!Number.isInteger(newBuild) || newBuild <= 0) die(`Bad build number: ${forcedBuild}`);
  // Keep both platforms in lockstep even if only one is being built this run.
  writeAndroidVersion(newBuild, setVersion || null);
  writeIosVersion(newBuild, setVersion || null);
  ok(`Set build number to ${newBuild} on both platforms${setVersion ? `, version name -> ${setVersion}` : ''}`);
}

// ---- 3. web assets ------------------------------------------------------
if (!noSync) {
  step('Build web assets + sync native projects');
  run('npm', ['run', 'build:css']);
  const syncTarget = platform === 'both' ? [] : [platform];
  run('npx', ['cap', 'sync', ...syncTarget]);
  ok('cap sync done');
} else {
  warn('--no-sync: skipping build:css + cap sync');
}

const results = [];

// ---- 4. Android ---------------------------------------------------------
if (doAndroid) {
  step('Android — bundleRelease');
  run('./gradlew', ['bundleRelease', '--console=plain'], { cwd: p('android'), env: androidEnv });
  const aab = p('android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  if (!existsSync(aab)) die('Android build finished but app-release.aab was not found.');
  ok(`AAB ready: ${aab}`);
  results.push(['Android', `signed .aab -> ${aab}`, 'Upload to Play Console -> Testing -> Internal testing -> Create new release.']);
}

// ---- 5. iOS -------------------------------------------------------------
if (doIos) {
  const outDir = p('build', 'mobile');
  const archivePath = join(outDir, 'App.xcarchive');
  const exportPath = join(outDir, 'export');
  const optsPlist = join(outDir, 'ExportOptions.plist');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const auth = [
    '-allowProvisioningUpdates',
    '-authenticationKeyPath', ios.keyPath,
    '-authenticationKeyID', ios.keyId,
    '-authenticationKeyIssuerID', ios.issuerId,
  ];

  // Archive UNSIGNED. Automatic signing during `archive` always tries to provision a
  // *development* profile (which needs registered devices) and fails for a store build.
  // The reliable headless pattern is to archive without signing, then let `-exportArchive`
  // do the distribution signing below — it knows this is an App Store build, so it creates
  // the distribution certificate + App Store profile (neither needs a device).
  step('iOS — archive (unsigned)');
  run('xcodebuild', [
    '-project', p('ios', 'App', 'App.xcodeproj'),
    '-scheme', 'App',
    '-configuration', 'Release',
    '-destination', 'generic/platform=iOS',
    '-archivePath', archivePath,
    'clean', 'archive',
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
  ]);
  if (!existsSync(archivePath)) die('Archive step finished but App.xcarchive was not found.');
  ok('Archive created');

  step(`iOS — export${ios.upload ? ' + upload to App Store Connect' : ''}`);
  writeFileSync(optsPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>${ios.upload ? 'upload' : 'export'}</string>
  <key>teamID</key><string>${ios.teamId}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
`);
  run('xcodebuild', [
    '-exportArchive',
    '-archivePath', archivePath,
    '-exportOptionsPlist', optsPlist,
    '-exportPath', exportPath,
    ...auth,
  ]);
  if (ios.upload) {
    ok('Uploaded to App Store Connect — appears in TestFlight after processing (5–30 min).');
    results.push(['iOS', 'uploaded to App Store Connect', 'TestFlight -> add build to your External group (Beta App Review only needed the first time on a version stream).']);
  } else {
    ok(`Exported .ipa -> ${exportPath}`);
    results.push(['iOS', `.ipa -> ${exportPath}`, 'Upload manually (Transporter) or re-run without --no-upload.']);
  }
}

// ---- summary ------------------------------------------------------------
step('Done');
if (newBuild) console.log(`    Build number: ${C.bold}${newBuild}${C.reset}`);
for (const [plat, what, next] of results) {
  console.log(`\n    ${C.bold}${plat}${C.reset}: ${what}`);
  console.log(`      ${C.dim}next:${C.reset} ${next}`);
}
console.log(`\n    ${C.yellow}Remember to commit the version bump${C.reset} (android/app/build.gradle + ios/App/App.xcodeproj/project.pbxproj).\n`);
