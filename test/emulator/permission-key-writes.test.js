const {describe, test, before} = require("node:test");
const assert = require("node:assert/strict");

const H = require("./harness.js");
const Levels = require("../../public/account-levels-core.js");

// MS-722 (ADR 0081): every write door that used to ask only isEditor()'s
// list of level names now also honours the one MS-695 key Admin Accounts
// grants for the page that writes there — editsWith(key) in
// firestore.rules. These go through the REAL rules: a signed-in browser
// is played over the emulator's REST door with an unsigned ID token (the
// emulator accepts `alg: none`), so a rule that refuses comes back 403.
// The admin SDK only seeds; it bypasses rules and proves nothing here.
//
// Per collection: a custom level holding the key may write; Member,
// Viewer and signed-out may not; a custom level with the key revoked may
// not. A legacy editor (no map) still may — the level names stay an OR.

const suite = H.skipReason
  ? (name) => test(name, {skip: H.skipReason}, () => {})
  : describe;

const OCC = "occ-oneoff";
const EVENT = "ev-1";
const PERSON = "person-away";

// [label, key, path(uid, tag)] — tag keeps each attempt on its own doc.
const DOORS = [
  ["hymns", "hymns.edit", (u, t) => `hymns/h-${t}`],
  ["roles", "roles.manager.edit", (u, t) => `roles/r-${t}`],
  ["events", "calendar.events.edit", (u, t) => `events/e-${t}`],
  ["events/announcements", "calendar.events.edit",
    (u, t) => `events/${EVENT}/announcements/a-${t}`],
  ["events/announcement_going_out", "calendar.events.edit",
    (u, t) => `events/${EVENT}/announcement_going_out/g-${t}`],
  ["event_occurrences", "calendar.events.edit",
    (u, t) => `event_occurrences/o-${t}`],
  ["event_occurrences/roster", "calendar.events.edit",
    (u, t) => `event_occurrences/${OCC}/roster/r-${t}`],
  ["event_occurrences/attachments", "calendar.events.edit",
    (u, t) => `event_occurrences/${OCC}/attachments/a-${t}`],
  ["event_occurrences/documents", "calendar.events.edit",
    (u, t) => `event_occurrences/${OCC}/documents/d-${t}`],
  ["event_occurrences/announcements", "calendar.events.edit",
    (u, t) => `event_occurrences/${OCC}/announcements/a-${t}`],
  ["event_occurrences/announcement_going_out", "calendar.events.edit",
    (u, t) => `event_occurrences/${OCC}/announcement_going_out/g-${t}`],
  ["services", "services.builder.edit", (u, t) => `services/2099-01-${t}`],
  ["liturgy_elements", "services.builder.edit",
    (u, t) => `liturgy_elements/l-${t}`],
  ["liturgy_orders", "services.builder.edit",
    (u, t) => `liturgy_orders/l-${t}`],
  ["presence (own uid)", "services.builder.edit", (u) => `presence/${u}`],
  ["people/away (someone else's)", "calendar.away.edit",
    (u, t) => `people/${PERSON}/away/s-${t}`],
  ["printables", "printables.edit", (u, t) => `printables/p-${t}`],
  ["printable_folders", "printables.edit",
    (u, t) => `printable_folders/f-${t}`],
  ["printable_templates", "printables.edit",
    (u, t) => `printable_templates/t-${t}`],
];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function idToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  return b64({alg: "none", typ: "JWT"}) + "." + b64({
    iss: `https://securetoken.google.com/${H.PROJECT_ID}`,
    aud: H.PROJECT_ID,
    iat: now, exp: now + 3600, auth_time: now,
    sub: uid, user_id: uid,
    firebase: {sign_in_provider: "password", identities: {}},
  }) + ".";
}

/** Write one doc as `uid` (null = signed out); the HTTP status. */
async function writeAs(uid, docPath) {
  const url = `http://${H.HOST}/v1/projects/${H.PROJECT_ID}` +
    `/databases/(default)/documents/${docPath}`;
  const headers = {"Content-Type": "application/json"};
  if (uid) headers.Authorization = "Bearer " + idToken(uid);
  const res = await fetch(url, {
    method: "PATCH", headers,
    body: JSON.stringify({fields: {note: {stringValue: "ms-722"}}}),
  });
  await res.text();
  return res.status;
}

const MEMBER = Levels.buildPresetPermissions(Levels.PRESET_MEMBER);

// A custom level as Admin → Accounts saves it: Member plus one key.
// permissionLevel is forced to `member` — what member-sync writes back and
// what userWriteFromLevel stores for every key but the editor triad — so
// the key, not a level name, is what is being asked.
function customLevel(key, on) {
  const w = Levels.userWriteFromLevel("level_custom_ms722", {
    custom: true, presetKey: "member",
    permissions: Object.assign({}, MEMBER, {[key]: on}),
  });
  return Object.assign(w, {permissionLevel: "member", role: "member"});
}

function uidFor(kind, key) {
  return `${kind}-${key.replace(/\./g, "_")}`;
}

suite("MS-722: write doors honour the MS-695 key", () => {
  let db;

  before(async () => {
    db = H.connect();
    await H.wipe();
    const keys = [...new Set(DOORS.map((d) => d[1]))];
    const users = {
      member: Levels.userWriteFromLevel(
          Levels.accountLevelIdForPreset(Levels.PRESET_MEMBER)),
      viewer: Levels.userWriteFromLevel(
          Levels.accountLevelIdForPreset(Levels.PRESET_VIEWER)),
      legacyEditor: {permissionLevel: "editor", role: "editor"},
    };
    for (const k of keys) {
      users[uidFor("custom", k)] = customLevel(k, true);
      users[uidFor("revoked", k)] = customLevel(k, false);
    }
    await Promise.all(Object.entries(users).map(([uid, data]) =>
      db.collection("users").doc(uid).set(data)));
    await db.collection("event_occurrences").doc(OCC)
        .set({name: "One-off", date: "2099-01-01"});
    await db.collection("events").doc(EVENT).set({name: "Event"});
    await H.seedPerson(db, PERSON, {name: "Away Person"});
  });

  for (const [label, key, pathOf] of DOORS) {
    describe(`${label} (${key})`, () => {
      test("a custom level holding the key may write", async () => {
        const uid = uidFor("custom", key);
        assert.equal(await writeAs(uid, pathOf(uid, "c")), 200);
      });
      test("Member may not", async () => {
        assert.equal(await writeAs("member", pathOf("member", "m")), 403);
      });
      test("Viewer may not", async () => {
        assert.equal(await writeAs("viewer", pathOf("viewer", "v")), 403);
      });
      test("signed out may not", async () => {
        assert.equal(await writeAs(null, pathOf("anon", "s")), 403);
      });
      test("a custom level with the key revoked may not", async () => {
        const uid = uidFor("revoked", key);
        assert.equal(await writeAs(uid, pathOf(uid, "r")), 403);
      });
      test("a legacy editor (no map) still may", async () => {
        assert.equal(
            await writeAs("legacyEditor", pathOf("legacyEditor", "e")), 200);
      });
    });
  }
});
