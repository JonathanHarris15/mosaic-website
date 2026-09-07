/**
 * The Firestore sentinels the shepherding writes use, passed in rather than
 * reached for (MS-278).
 *
 * ⚠ WHY THIS EXISTS, AND IT IS NOT TIDINESS. A sentinel — a server timestamp,
 * an arrayUnion — is only understood by the SAME firebase-admin copy that made
 * the Firestore handle it is written through. `functions/` carries its own
 * node_modules, so a module here that does `require("firebase-admin")` gets a
 * different copy from anything driving it from the repo root, and every write
 * fails with "Couldn't serialize object of type ServerTimestampTransform".
 *
 * That is not a test-only problem dressed up as a rule. It is why
 * liturgy-writes.js takes `serverTimestamp` and `deleteField` as arguments and
 * why service-read.js takes `documentId` — the convention was already here and
 * these modules broke it. The emulator suite found it in an afternoon; in
 * production it would have been found by an elder whose note would not save.
 *
 * ⚠ MODULE-SCOPED, AND THAT IS SAFE. `bind` is called once per request, from
 * mcp-shepherding-tools.register, before any tool runs. What it stores is the
 * admin namespace itself — the same object on every request, holding nothing
 * about who is calling. It is not a cache and nothing per-caller may be kept
 * here; the MCP server is rebuilt per request precisely so that nothing is.
 *
 * ⚠ IT ALSO SETS `global.firebase`. shared/shepherding-core.js reaches for
 * `firebase.firestore.FieldValue.serverTimestamp()` as a bare global in its
 * three commit helpers, because it was written for a browser where every script
 * shares one scope. Setting it here is the price of the page and the server
 * running one copy of ADR-0005's dual write instead of two.
 */

let FieldValue = null;
let Timestamp = null;

/**
 * Point this module at the caller's firebase-admin.
 *
 * @param {object} fieldValues {FieldValue, Timestamp} from the admin namespace
 *   that made the Firestore handle these writes will be given
 */
function bind(fieldValues) {
  const f = fieldValues || {};

  // ⚠ MISSING SENTINELS ARE NOT A REGISTRATION FAILURE. This is called while
  // the tool list is being built, and the tool list is built in places that
  // will never write a thing — the MCP Manager page asks a throwaway server to
  // describe itself, and the protocol tests drive one with a stub for a
  // database. Throwing here took every one of those out, and the symptom was
  // sixty tests failing on a server that could not even say what it offered.
  //
  // So what is missing is refused at the moment a write actually needs it,
  // where the message can say so plainly, rather than at the moment the door
  // is opened.
  if (!f.FieldValue) return;

  FieldValue = f.FieldValue;
  Timestamp = f.Timestamp || null;
  global.firebase = {firestore: {FieldValue: FieldValue}};
}

/** Whichever sentinel factory was bound, or a readable failure. */
function bound() {
  if (!FieldValue) {
    throw new Error(
        "mcp-firestore.bind() was never called, so there are no Firestore " +
        "sentinels to write with.");
  }
  return FieldValue;
}

/** @return {*} the server-clock timestamp sentinel */
function now() {
  return bound().serverTimestamp();
}

/**
 * @param {*} value what to add
 * @return {*} the arrayUnion sentinel
 */
function arrayUnion(value) {
  return bound().arrayUnion(value);
}

/**
 * @param {*} value what to take out
 * @return {*} the arrayRemove sentinel
 */
function arrayRemove(value) {
  return bound().arrayRemove(value);
}

/**
 * @param {Date} date the moment
 * @return {*} a Firestore Timestamp
 */
function timestampFrom(date) {
  bound();
  if (!Timestamp) {
    throw new Error(
        "No Firestore Timestamp was bound, so a due date cannot be stored. " +
        "See mcp-firestore.js.");
  }
  return Timestamp.fromDate(date);
}

module.exports = {bind, now, arrayUnion, arrayRemove, timestampFrom};
