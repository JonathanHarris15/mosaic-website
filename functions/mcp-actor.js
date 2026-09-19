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

const Access = require("./shared/access-core.js");

const USERS = "users";

/**
 * The ranks that may touch the Shepherding System as an elder.
 *
 * Matches AccessCore.ELDER_LEVELS / `isElder()` in firestore.rules —
 * `['elder', 'super_admin']`. A Pastoral Assistant is not on this list; they
 * reach shepherding through the grant, via readsAsElder / writesTheRecord.
 */
const ELDER_LEVELS = Access.ELDER_LEVELS.slice();

/**
 * The ranks that may build a Printable.
 *
 * Matches AccessCore.EDITOR_WRITE_LEVELS / `isEditor()` in firestore.rules.
 * The grant adds nothing here — a member-level Pastoral Assistant cannot
 * lay out a page.
 *
 * ⚠ THIS IS THE ONLY GATE ON A PRINTABLE WRITE. An MCP tool writes through
 * firebase-admin, which does not consult firestore.rules at all, so the rule
 * protecting `printables` never runs for these calls. If this check is not
 * applied, a viewer can lay out and publish a Printable.
 */
const EDITOR_LEVELS = Access.EDITOR_WRITE_LEVELS.slice();

const READ = "read";
const RECORD = "record";
const DECIDE = "decide";

/**
 * Every `shep_` and `cal_` tool, classified. A tool missing from this map
 * refuses a Pastoral Assistant (fail closed). test/mcp-actor.test.js walks
 * the registered names against this map so a new tool cannot slip through
 * unclassified.
 */
const SHEP_CAL_GATES = Object.freeze({
  shep_find_person: READ,
  shep_get_profile: READ,
  shep_get_pastoral_record: READ,
  shep_list_notes: READ,
  shep_get_note: READ,
  shep_list_people: READ,
  shep_list_tags: READ,
  shep_preview_tag_merge: READ,
  shep_list_documents: READ,
  shep_get_document: READ,
  shep_list_form_templates: READ,
  shep_get_form_document: READ,
  shep_get_care_list: READ,
  shep_list_views: READ,
  shep_list_tasks: READ,
  cal_list_events: READ,
  cal_get_event: READ,
  cal_list_series: READ,
  shep_write_note: RECORD,
  shep_append_to_note: RECORD,
  shep_edit_note: RECORD,
  shep_delete_note: RECORD,
  shep_create_document: RECORD,
  shep_update_document: RECORD,
  shep_append_to_document: RECORD,
  shep_rename_document: RECORD,
  shep_move_document: RECORD,
  shep_delete_document: RECORD,
  shep_create_folder: RECORD,
  shep_rename_folder: RECORD,
  shep_move_folder: RECORD,
  shep_delete_folder: RECORD,
  shep_add_person_panel: RECORD,
  shep_create_form_document: RECORD,
  shep_answer_form_document: RECORD,
  shep_create_care_list: RECORD,
  shep_add_care_list_column: RECORD,
  shep_write_care_list_cell: RECORD,
  shep_create_task: RECORD,
  shep_complete_task: RECORD,
  shep_skip_task: RECORD,
  shep_delete_task: RECORD,
  shep_add_tags: DECIDE,
  shep_remove_tags: DECIDE,
  shep_create_tag: DECIDE,
  shep_delete_tag: DECIDE,
  shep_rename_tag: DECIDE,
  shep_merge_tags: DECIDE,
  shep_set_status: DECIDE,
  shep_clear_status: DECIDE,
  shep_set_elder_assignment: DECIDE,
  shep_set_membership_stage: DECIDE,
  shep_create_view: DECIDE,
  shep_update_view: DECIDE,
  shep_delete_view: DECIDE,
  shep_explain_change: DECIDE,
  cal_create_event: DECIDE,
  cal_update_event: DECIDE,
  cal_update_series: DECIDE,
  cal_move_event: DECIDE,
  cal_cancel_event: DECIDE,
  cal_delete_event: DECIDE,
  cal_create_event_document: DECIDE,
});

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
 * May this caller count as an elder — decisions, pickers, the Elder Tag.
 * Accepts a Permission Level string or an account (`permissionLevel` +
 * `pastoralAssistant`).
 * @param {string|object} value the caller's level or account
 * @return {boolean} whether they count as an elder
 */
function isElder(value) {
  return Access.isAnElder(value);
}

/**
 * May this caller write as an editor? The grant adds nothing.
 * @param {string|object} value the caller's level or account
 * @return {boolean} whether they write as an editor
 */
function isEditor(value) {
  return Access.writesAsEditor(value);
}

/**
 * May this caller read as an elder? The grant admits a Pastoral Assistant.
 * @param {string|object} value the caller's level or account
 * @return {boolean} whether they read as an elder
 */
function readsAsElder(value) {
  return Access.readsAsElder(value);
}

/**
 * May this caller write the Pastoral Record? The grant admits a Pastoral
 * Assistant.
 * @param {string|object} value the caller's level or account
 * @return {boolean} whether they write the record
 */
function writesTheRecord(value) {
  return Access.writesTheRecord(value);
}

/**
 * May this caller make a shepherding decision write in software?
 * MS-594: the grant admits a Pastoral Assistant. They still do not count
 * as an elder (Elder Tag / pickers / digest stay isElder).
 * @param {string|object} value the caller's level or account
 * @return {boolean} whether they may decide
 */
function canDecide(value) {
  return Access.canDecide(value);
}

/**
 * The gate this `shep_` / `cal_` tool is classified under, or null.
 * @param {string} name the tool name
 * @return {?string} `read`, `record`, `decide`, or null
 */
function gateFor(name) {
  return Object.prototype.hasOwnProperty.call(SHEP_CAL_GATES, name) ?
    SHEP_CAL_GATES[name] : null;
}

/**
 * May this account call this `shep_` / `cal_` tool?
 * An unclassified tool refuses a Pastoral Assistant and admits only elders.
 * @param {string|object} account the caller's account
 * @param {string} name the tool name
 * @return {boolean} whether they may call it
 */
function mayUseTool(account, name) {
  const gate = gateFor(name);
  if (gate === READ) return Access.readsAsElder(account);
  if (gate === RECORD) return Access.writesTheRecord(account);
  if (gate === DECIDE) {
    // shep_ decision writes admit a Pastoral Assistant (MS-594).
    // cal_ DECIDE stays counted-as-elder — calendar writes are not
    // shepherding decision actions.
    if (typeof name === "string" && name.indexOf("shep_") === 0) {
      return Access.canDecide(account);
    }
    return Access.isAnElder(account);
  }
  return Access.isAnElder(account);
}

/**
 * The caller's permission level, quoted for a refusal sentence.
 * @param {string|object} value the caller's level or account
 * @return {string} the quoted level, or "no permission level"
 */
function heldLabel(value) {
  const level = Access.permissionLevelOf(value);
  return level ? `"${level}"` : "no permission level";
}

/**
 * Why not, in words an assistant can pass on to the person asking.
 *
 * A Pastoral Assistant refused a decision hears that it is about the role,
 * not a fault and not "raise it to elder".
 *
 * @param {string|object} value the caller's level or account
 * @param {?string} [toolName] the tool they asked for
 * @return {string} the refusal
 */
function refusalFor(value, toolName) {
  if (Access.isPastoralAssistant(value) && !Access.isAnElder(value)) {
    const gate = toolName ? gateFor(toolName) : DECIDE;
    if (gate === DECIDE || gate === null) {
      return "A Pastoral Assistant keeps the record; this is an elder's " +
        "decision.";
    }
  }
  const held = heldLabel(value);
  return "The Shepherding System is elder-only. This account holds " + held +
    ", which can build a Sunday but cannot read or write a Person's " +
    "shepherding record. Ask a super admin to raise it to elder.";
}

/**
 * Why a Printables tool said no, in words an assistant can pass on.
 * @param {string|object} value the caller's level or account
 * @return {string} the refusal
 */
function editorRefusalFor(value) {
  const held = heldLabel(value);
  return "Printables are editor-and-above. This account holds " + held +
    ", which can read the church's pages but cannot lay one out. Ask a super " +
    "admin to raise it to editor.";
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
  EDITOR_LEVELS,
  READ,
  RECORD,
  DECIDE,
  SHEP_CAL_GATES,
  SOURCE,
  MISSING_AUTHOR,
  isElder,
  isEditor,
  readsAsElder,
  writesTheRecord,
  canDecide,
  gateFor,
  mayUseTool,
  refusalFor,
  editorRefusalFor,
  resolveActor,
  requireActor,
  provenance,
};
