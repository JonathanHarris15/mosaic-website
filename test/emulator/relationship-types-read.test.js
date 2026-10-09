const {describe, test, before} = require("node:test");
const assert = require("node:assert/strict");

const H = require("./harness.js");
const Levels = require("../../public/account-levels-core.js");

// MS-728: Roles Manager lists Shared Relationship Types. Those documents are
// type definitions (name, kind, labels, sharedWithEditors) — no people.
// A custom level whose only editor key is roles.manager.edit or
// services.builder.edit can open the page, but readsAsEditor() refused the
// list. This suite is the before/after smoke for that query: GET a shared
// type as those levels. Edges and group rosters stay closed — they name
// people.

const suite = H.skipReason
  ? (name) => test(name, {skip: H.skipReason}, () => {})
  : describe;

const MEMBER = Levels.buildPresetPermissions(Levels.PRESET_MEMBER);

function customLevel(key, on) {
  const w = Levels.userWriteFromLevel("level_custom_ms728", {
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
    opts.body = JSON.stringify({fields: {name: {stringValue: "ms-728"}}});
  }
  const res = await fetch(url, opts);
  await res.text();
  return res.status;
}

const readAs = (uid, path) => rest(uid, path, "GET");
const writeAs = (uid, path) => rest(uid, path, "PATCH");

suite("MS-728: shared relationship types readable by the Roles/Services keys", () => {
  let db;

  before(async () => {
    db = H.connect();
    await H.wipe();
    await Promise.all([
      db.collection("users").doc("rolesOnly").set(
          customLevel("roles.manager.edit", true)),
      db.collection("users").doc("servicesOnly").set(
          customLevel("services.builder.edit", true)),
      db.collection("users").doc("rolesOff").set(
          customLevel("roles.manager.edit", false)),
      db.collection("users").doc("member").set(Levels.userWriteFromLevel(
          Levels.accountLevelIdForPreset(Levels.PRESET_MEMBER))),
      db.collection("users").doc("viewer").set(Levels.userWriteFromLevel(
          Levels.accountLevelIdForPreset(Levels.PRESET_VIEWER))),
      db.collection("users").doc("legacyEditor").set(
          {permissionLevel: "editor", role: "editor"}),
      db.collection("relationship_types").doc("shared").set({
        name: "Marriage", kind: "group", sharedWithEditors: true,
      }),
      db.collection("relationship_types").doc("secret").set({
        name: "Discipleship", kind: "pairwise", sharedWithEditors: false,
      }),
      db.collection("relationships").doc("edge").set({
        fromId: "p1", toId: "p2", typeId: "shared", sharedWithEditors: true,
      }),
      db.collection("relationship_groups").doc("group").set({
        typeId: "shared", name: "The Smiths", memberIds: ["p1", "p2"],
        sharedWithEditors: true,
      }),
    ]);
  });

  test("a roles.manager.edit-only custom level can read a shared type", async () => {
    assert.equal(await readAs("rolesOnly", "relationship_types/shared"), 200);
  });
  test("a services.builder.edit-only custom level can read a shared type", async () => {
    assert.equal(await readAs("servicesOnly", "relationship_types/shared"), 200);
  });
  test("neither key-only level can read an unshared type", async () => {
    assert.equal(await readAs("rolesOnly", "relationship_types/secret"), 403);
    assert.equal(await readAs("servicesOnly", "relationship_types/secret"), 403);
  });
  test("neither key-only level can read a shared edge (people)", async () => {
    assert.equal(await readAs("rolesOnly", "relationships/edge"), 403);
    assert.equal(await readAs("servicesOnly", "relationships/edge"), 403);
  });
  test("neither key-only level can read a shared group roster (people)", async () => {
    assert.equal(await readAs("rolesOnly", "relationship_groups/group"), 403);
    assert.equal(await readAs("servicesOnly", "relationship_groups/group"), 403);
  });
  test("Member, Viewer and signed-out may not read a shared type", async () => {
    assert.equal(await readAs("member", "relationship_types/shared"), 403);
    assert.equal(await readAs("viewer", "relationship_types/shared"), 403);
    assert.equal(await readAs(null, "relationship_types/shared"), 403);
  });
  test("a custom level with the roles key revoked may not", async () => {
    assert.equal(await readAs("rolesOff", "relationship_types/shared"), 403);
  });
  test("a leftover editor (no map) still may", async () => {
    assert.equal(await readAs("legacyEditor", "relationship_types/shared"), 200);
  });
  test("the Roles key still cannot write a type", async () => {
    assert.equal(await writeAs("rolesOnly", "relationship_types/shared"), 403);
  });
});
