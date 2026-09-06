/**
 * Who an assistant is writing AS, and whether it may write at all (MS-278).
 *
 * The Order of Service half of the MCP (MS-262) admits anyone `editor` and up,
 * and that is right: an editor builds Sundays. The Shepherding half must not.
 * A Shepherding Profile is elder-only on every other surface in the app, and a
 * door that is elder-only in the browser and editor-open over the protocol is
 * not a door, it is a gap.
 *
 * ⚠ THIS IS A SECOND GATE, NOT A NARROWER FIRST ONE. `EDITOR_LEVELS` in
 * mcp-auth.js decides who may hold a token at all, and it stays exactly as it
 * is — narrowing it would take the twelve `oos_` tools away from the editors
 * they were built for. This adds a rank check the shepherding tools apply for
 * themselves, on every call.
 *
 * ⚠ PER CALL, NOT PER LOGIN. mcp-auth.js re-reads the caller's permission
 * level every time it verifies a token, so `permissionLevel` arriving here is
 * always fresh. An elder demoted this morning is refused this afternoon
 * without anyone revoking anything.
 *
 * ⚠ THE AUTHOR RULE (CONTEXT.md, Shepherding System). A record whose author
 * cannot be resolved is REFUSED rather than written. An untraceable pastoral
 * record is worse than a create that failed: it exists, it stands in the
 * Pastoral Record, and nothing surfaces the problem. MS-283 found exactly that
 * on the Documents tab, where documents were being authored by `undefined` and
 * by the literal string "Elder".
 *
 * Deliberately tiny and read-only. It decides nothing about what is written,
 * only who is writing and whether they may.
 */

// service-authorship.js's neighbour reaches for MosaicIdentity as a bare
// global because it is written to run in a browser, where every script shares
// one scope. Same trick as liturgy-writes.js: set it before use.
global.MosaicIdentity = require("./shared/mosaic-identity.js");

const USERS = "users";

/**
 * The ranks that may touch the Shepherding System.
 *
 * Matches `isElder()` in firestore.rules — `['elder', 'super_admin']` — and
 * must keep matching it. `admin` is deliberately absent: it is not an elder in
 * the rules either, and the Document Library's access note says so.
 */
const ELDER_LEVELS = ["elder", "super_admin"];

/**
 * Where a Pastoral Record entry written by an assistant says it came from.
 *
 * A Status Change and a Tag Change already record a `source` — `profile`,
 * `people_list` or `document`. An assistant is a fourth place, so it is said in
 * the field that already exists rather than in a second one invented beside it.
 */
const SOURCE = "mcp";

/** The error code a refused write carries, matching the Document Library's. */
const MISSING_AUTHOR = "missing-author";

/**
 * May this caller touch a Person?
 * @param {?string} permissionLevel the caller's level, as mcp-auth read it
 * @return {boolean} true for an elder or a super admin, false for everyone else
 */
function isElder(permissionLevel) {
  return ELDER_LEVELS.includes(permissionLevel);
}

/**
 * Why not, in words an assistant can pass on to the person asking.
 *
 * Not "permission denied": the elder reading this over their assistant's
 * shoulder needs to know it is about their rank, not a mistyped address or a
 * server that fell over.
 *
 * @param {?string} permissionLevel what they actually hold
 * @return {string} the refusal
 */
function refusalFor(permissionLevel) {
  const held = permissionLevel ? `"${permissionLevel}"` : "no permission level";
  return "The Shepherding System is elder-only. This account holds " + held +
    ", which can build a Sunday but cannot read or write a Person's " +
    "shepherding record. Ask a super admin to raise it to elder.";
}

/**
 * Who is calling, as an author — freshly resolved every call.
 *
 * The Person behind the account is preferred, because that is the name every
 * other elder reading the Pastoral Record already knows them by. An account
 * with no Person attached still has an author worth recording, and falls back
 * to the same `email.split('@')[0]` the Shepherding Profile itself writes — one
 * rule, not a stricter server and a looser page.
 *
 * ⚠ NOTHING IS CACHED. One Cloud Functions instance answers many callers in
 * turn; a remembered identity would eventually author one elder's note in
 * another elder's name.
 *
 * @param {object} db the Firestore handle
 * @param {string} uid the caller's Firebase uid
 * @return {Promise<?{uid: string, name: string, personId: ?string}>} the
 *   author, or null when nothing about this account can be traced
 */
async function resolveActor(db, uid) {
  if (!uid) return null;

  const snap = await db.collection(USERS).doc(uid).get();
  const userData = snap.exists ? snap.data() : null;

  // The Person half goes through MosaicIdentity rather than a second copy of
  // the users/{uid}.personId → people/{id} hop, so an account re-pointed at a
  // different Person resolves the same way here as it does on every page.
  const identity = await global.MosaicIdentity.resolve({
    uid,
    db,
    getUserData: async () => userData,
  });

  const email = (userData && userData.email) || "";
  const name = (identity && identity.name) || email.split("@")[0] || "";
  if (!name) return null;

  return {uid, name, personId: (identity && identity.id) || null};
}

/**
 * The same, but refusing instead of returning nothing.
 *
 * Every write tool goes through this. A tool that called resolveActor and
 * carried on with a null would be writing the untraceable record the Author
 * rule exists to prevent.
 *
 * @param {object} db the Firestore handle
 * @param {string} uid the caller's Firebase uid
 * @return {Promise<{uid: string, name: string, personId: ?string}>} the author
 */
async function requireActor(db, uid) {
  const actor = await resolveActor(db, uid);
  if (actor) return actor;

  const err = new Error(
      "This account cannot be traced to anyone, so nothing can be written " +
      "in its name. Link it to a Person in the People Manager first.");
  err.code = MISSING_AUTHOR;
  throw err;
}

/**
 * The mark every record written through the MCP carries.
 *
 * So an elder scrolling their own Pastoral Record can tell at a glance what an
 * assistant wrote from what somebody typed. Merged into the record rather than
 * wrapping it, because everything else about an agent-written note is meant to
 * be identical to a hand-written one — it is a provenance mark, not a
 * different kind of record.
 *
 * @return {object} the stamp, ready to spread into a record
 */
function provenance() {
  return {writtenVia: SOURCE};
}

module.exports = {
  ELDER_LEVELS,
  SOURCE,
  MISSING_AUTHOR,
  isElder,
  refusalFor,
  resolveActor,
  requireActor,
  provenance,
};
