const {describe, test, before} = require("node:test");
const assert = require("node:assert/strict");

const H = require("./harness.js");
const Levels = require("../../public/account-levels-core.js");

// MS-725: whoever may write a Sunday may read who else is in it.
// A custom level built from Member plus services.builder.edit can write its
// own presence claim (editsWith) but, before this, could not read anyone's
// — readsAsEditor() asks for directory.edit_identity or printables.edit.
// These go through the REAL rules over the emulator's REST door.

const suite = H.skipReason
  ? (name) => test(name, {skip: H.skipReason}, () => {})
  : describe;

const MEMBER = Levels.buildPresetPermissions(Levels.PRESET_MEMBER);
const CLAIM = "presence-claim";

function customLevel(key, on) {
  const w = Levels.userWriteFromLevel("level_custom_ms725", {
    custom: true, presetKey: "member",
    permissions: Object.assign({}, MEMBER, {[key]: on}),
  });
  return Object.assign(w, {permissionLevel: "member", role: "member"});
}

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

async function rest(uid, docPath, method) {
  const url = `http://${H.HOST}/v1/projects/${H.PROJECT_ID}` +
    `/databases/(default)/documents/${docPath}`;
  const headers = {"Content-Type": "application/json"};
  if (uid) headers.Authorization = "Bearer " + idToken(uid);
  const opts = {method, headers};
  if (method === "PATCH") {
    opts.body = JSON.stringify({fields: {note: {stringValue: "ms-725"}}});
  }
  const res = await fetch(url, opts);
  await res.text();
  return res.status;
}

const readAs = (uid, path) => rest(uid, path, "GET");
const writeAs = (uid, path) => rest(uid, path, "PATCH");

suite("MS-725: presence read admits services.builder.edit", () => {
  let db;

  before(async () => {
    db = H.connect();
    await H.wipe();
    await Promise.all([
      db.collection("users").doc("builderOnly").set(
          customLevel("services.builder.edit", true)),
      db.collection("users").doc("builderOff").set(
          customLevel("services.builder.edit", false)),
      db.collection("users").doc("member").set(Levels.userWriteFromLevel(
          Levels.accountLevelIdForPreset(Levels.PRESET_MEMBER))),
      db.collection("users").doc("viewer").set(Levels.userWriteFromLevel(
          Levels.accountLevelIdForPreset(Levels.PRESET_VIEWER))),
      db.collection("users").doc("legacyEditor").set(
          {permissionLevel: "editor", role: "editor"}),
      db.collection("presence").doc(CLAIM).set({box: "theme", date: "2099-01-05"}),
      db.collection("shepherding_presence").doc(CLAIM).set({personId: "p1"}),
      db.collection("printables").doc("p-1").set({name: "Bulletin"}),
    ]);
  });

  test("a services.builder.edit-only custom level can read presence", async () => {
    assert.equal(await readAs("builderOnly", `presence/${CLAIM}`), 200);
  });

  test("a legacy editor (no map) can still read presence", async () => {
    assert.equal(await readAs("legacyEditor", `presence/${CLAIM}`), 200);
  });

  test("Member may not read presence", async () => {
    assert.equal(await readAs("member", `presence/${CLAIM}`), 403);
  });

  test("Viewer may not read presence", async () => {
    assert.equal(await readAs("viewer", `presence/${CLAIM}`), 403);
  });

  test("signed out may not read presence", async () => {
    assert.equal(await readAs(null, `presence/${CLAIM}`), 403);
  });

  test("a custom level with the key off may not read presence", async () => {
    assert.equal(await readAs("builderOff", `presence/${CLAIM}`), 403);
  });

  test("the same level still cannot read shepherding_presence", async () => {
    assert.equal(await readAs("builderOnly", `shepherding_presence/${CLAIM}`), 403);
  });

  test("the same level still cannot read printables", async () => {
    assert.equal(await readAs("builderOnly", "printables/p-1"), 403);
  });

  test("the same level can still write its own presence claim", async () => {
    assert.equal(await writeAs("builderOnly", "presence/builderOnly"), 200);
  });
});
