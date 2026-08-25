/**
 * Writing one element's note on a Sunday (MS-262).
 *
 * `db`-injected like every other data module here, so the emulator tests can
 * drive it. The decisions — which elements may carry a note, and how plain
 * text becomes safe markup — live in shared/service-note-core.js.
 *
 * ⚠ THIS TAKES TEXT AND ONLY TEXT. The note is rendered on the Order of
 * Service page with x-html, so whatever is stored here is injected as markup
 * into an editor's browser. The markup is built from escaped text by the
 * core module; there is no path through this file that lets a caller supply
 * HTML. See the header of service-note-core.js for why an assistant must not
 * be trusted the way the on-page editor is.
 *
 * ⚠ WRITTEN AS A DOT PATH, `notes.{slot}`. `notes` is one of
 * NESTED_SAVE_MAPS in service-builder.js, so the editor already treats it as
 * a map whose slots are saved one at a time. set(merge) would read
 * 'notes.sermon' as a field NAME containing a dot and build a second,
 * parallel notes map beside the real one.
 *
 * ⚠ NO AUTHORSHIP STAMP, DELIBERATELY. `decidedBy` records who CHOSE an
 * element. Writing a note about a hymn is not choosing the hymn, and
 * stamping it would silently reassign credit for the pick to whoever last
 * left a comment. ServiceAuthorship only stamps `liturgy.` paths, so this
 * is the existing rule rather than a new exception.
 */

const NoteCore = require("./shared/service-note-core.js");

const SERVICES = "services";

/**
 * Set or clear one element's note.
 *
 * An empty or whitespace-only note DELETES the key rather than storing an
 * empty string, matching what the website's own editor does — the page tests
 * `notes[key]` for truthiness to decide whether to show a bubble at all, so
 * an empty string would leave an empty bubble hanging on the element.
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {string} args.dateKey the `services/{dateKey}` doc id (YYYY-MM-DD)
 * @param {string} args.element which liturgy element the note belongs to
 * @param {?string} args.text the note as plain text, or null/'' to clear it
 * @param {*} args.serverTimestamp a server timestamp value
 * @param {*} args.deleteField a field-delete sentinel
 * @return {Promise<object>} {ok, action, element, html} or {ok:false, reason}
 */
async function updateNote(db, {dateKey, element, text, serverTimestamp, deleteField}) {
  if (!NoteCore.isNoteKey(element)) {
    return {ok: false, reason: "unknown-element", element};
  }

  const html = NoteCore.textToNoteHtml(text);
  const clearing = html === "";
  const path = `notes.${element}`;
  const ref = db.collection(SERVICES).doc(dateKey);

  try {
    await ref.update({
      [path]: clearing ? deleteField : html,
      updatedAt: serverTimestamp,
    });
  } catch (e) {
    if (e.code !== 5 && e.code !== "not-found") throw e; // gRPC NOT_FOUND = 5

    // No document for this Sunday yet. Clearing a note on a Sunday that does
    // not exist is a no-op rather than a reason to create one — an empty
    // Sunday carrying nothing but a deleted note would be a lie on the
    // calendar.
    if (clearing) return {ok: true, action: "cleared", element, html: null};

    await ref.set({
      notes: {[element]: html},
      updatedAt: serverTimestamp,
    }, {merge: true});
  }

  return {
    ok: true,
    action: clearing ? "cleared" : "written",
    element,
    html: clearing ? null : html,
  };
}

module.exports = {updateNote};
