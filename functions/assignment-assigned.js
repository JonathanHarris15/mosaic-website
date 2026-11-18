/**
 * @fileoverview The "you have been assigned" and "an Admin has taken you
 * off" texts. Pure: whether a roster write is an editor putting somebody on
 * a place or taking them off one, whether a text goes now, and the words.
 * No Firestore, no send, no clock of its own.
 *
 * ⚠ IT HANGS OFF THE ROSTER WRITE, like the cover cleanup, so every door an
 * editor fills a place through — auto-assign, the roster grid, a drag on
 * the calendar — sends it. A place a member takes for themselves (cover, a
 * Trade) arrives Confirmed and is not news to them, so only a NEW holder in
 * the Pending state counts.
 *
 * ⚠ ONE TEXT FOR A BURST. Auto-assign writes a month of places in a few
 * seconds. The words name no place ("new service roles"), so the first
 * place sends and the rest within the burst are already covered by it.
 */

const Occ = require("./shared/events-occurrence-core.js");
const Roles = require("./shared/roles-core.js");

const PURPOSE = "assignment_assigned";
const WORDING = "assigned";
const REMOVED_PURPOSE = "assignment_removed";
const REMOVED_WORDING = "removed";

/**
 * A placement older than this is not news: a date moved with its roster,
 * or a row re-filed under its canonical id, copies an old stateSetAt.
 */
const FRESH_MS = 60 * 60 * 1000;

/** Places made within this long of the last text are covered by it. */
const BURST_MS = 5 * 60 * 1000;

const TEXT = "You have been assigned new service roles in the Mosaic " +
  "Manager, please accept or deny them here: {link}";
const PUSH = {
  title: "New service roles",
  body: "You have been assigned new service roles. Tap to accept or deny.",
};

/**
 * Milliseconds since the epoch, from a Timestamp, Date, ISO string or
 * number; null when it is none of those.
 * @param {*} at
 * @return {?number}
 */
function millisOf(at) {
  if (!at) return null;
  if (typeof at.toMillis === "function") return at.toMillis();
  if (typeof at.toDate === "function") return at.toDate().getTime();
  if (at instanceof Date) return at.getTime();
  if (typeof at === "string" || typeof at === "number") {
    const ms = new Date(at).getTime();
    return isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Whether this roster write is an editor putting somebody on a place just
 * now.
 * @param {?Object<string, *>} before the row before, or null
 * @param {?Object<string, *>} after the row after, or null when removed
 * @param {number} nowMs
 * @return {boolean}
 */
function isNewPlacement(before, after, nowMs) {
  if (!after || !after.personId) return false;
  if (Occ.stateOf(after) !== Occ.STATES.PENDING) return false;
  if (Roles.LITURGICAL_SLUGS.indexOf(after.roleSlug || "") !== -1) {
    return false;
  }
  if (before && before.personId === after.personId) return false;
  const at = millisOf(after.stateSetAt);
  if (at === null) return false;
  return nowMs - at <= FRESH_MS && at - nowMs <= FRESH_MS;
}

/**
 * Whether a placement's text was already sent by an earlier one in the
 * same burst.
 * @param {?Object<string, *>} notice assignment_notices/{personId}
 * @param {number} nowMs
 * @return {boolean}
 */
function coveredByBurst(notice, nowMs) {
  const last = millisOf(notice && notice.lastSentAt);
  return last !== null && nowMs - last < BURST_MS;
}

/**
 * Whether this roster write took somebody off a place: their row went, or
 * the row now holds somebody else. Whether an EDITOR did it — rather than
 * a take, a Trade, a moved date or a re-filed row — needs the roster as it
 * stands now, so that is `removedByEditor`.
 * @param {?Object<string, *>} before
 * @param {?Object<string, *>} after
 * @return {boolean}
 */
function isRemoval(before, after) {
  if (!before || !before.personId) return false;
  if (Roles.LITURGICAL_SLUGS.indexOf(before.roleSlug || "") !== -1) {
    return false;
  }
  return !after || after.personId !== before.personId;
}

/**
 * Whether two rows are the same place: Role, slot, and one-off job.
 * @param {Object<string, *>} a
 * @param {Object<string, *>} b
 * @return {boolean}
 */
function samePlace(a, b) {
  return (a.roleSlug || "") === (b.roleSlug || "") &&
    (a.slotId || null) === (b.slotId || null) &&
    (a.oneOffId || null) === (b.oneOffId || null);
}

/**
 * Given the roster as it stands after the write, whether the removed person
 * was taken off by an editor.
 *  - Still on the same place (a row re-filed under its canonical id): no.
 *  - The place now held by somebody who put THEMSELVES there (a take or a
 *    Trade stamps the new holder's own Person id as `stateSetBy`; an editor
 *    stamps their account's uid): no — that has its own text.
 *  - Otherwise: yes.
 * @param {Object<string, *>} before the removed row
 * @param {Array<Object<string, *>>} roster the roster now
 * @return {boolean}
 */
function removedByEditor(before, roster) {
  const rows = (roster || []).filter((r) => r && samePlace(r, before));
  if (rows.some((r) => r.personId === before.personId)) return false;
  if (rows.some((r) => r.personId && r.stateSetBy === r.personId)) {
    return false;
  }
  return true;
}

const REMOVED_TEXT = "An Admin has taken you off of the {place} service " +
  "role. No action needed";

/**
 * The removal text, filled.
 * @param {string} place "Sound on Sunday, November 22"
 * @return {string}
 */
function removedText(place) {
  return REMOVED_TEXT.replace("{place}", place || "a");
}

/**
 * What the send path is asked for a removal.
 * @param {string} personId
 * @param {string} place
 * @param {string} origin
 * @param {?string} date
 * @return {Object<string, *>}
 */
function removedRequest(personId, place, origin, date) {
  return {
    personId: personId,
    purpose: REMOVED_PURPOSE,
    wording: REMOVED_WORDING,
    url: `${origin}/commitments.html`,
    serviceDate: date || null,
    expectReply: false,
    values: {message: removedText(place)},
  };
}

/**
 * What the send path is asked. Who, what and where — never push or text.
 * @param {string} personId
 * @param {string} origin the site Commitments lives on
 * @return {Object<string, *>}
 */
function notifyRequest(personId, origin) {
  return {
    personId: personId,
    purpose: PURPOSE,
    wording: WORDING,
    url: `${origin}/commitments.html`,
    expectReply: false,
    values: {},
  };
}

/**
 * The words in the shape the send path loads. Fixed.
 * @return {Object<string, *>}
 */
function templatesForSendPath() {
  const removedPush = {title: "Taken off a service role", body: "{message}"};
  return {
    text: {[WORDING]: TEXT, [REMOVED_WORDING]: "{message}"},
    textFallback: {[WORDING]: TEXT, [REMOVED_WORDING]: "{message}"},
    push: {[WORDING]: PUSH, [REMOVED_WORDING]: removedPush},
    pushFallback: {[WORDING]: PUSH, [REMOVED_WORDING]: removedPush},
  };
}

module.exports = {
  isRemoval,
  removedByEditor,
  removedRequest,
  isNewPlacement,
  coveredByBurst,
  notifyRequest,
  templatesForSendPath,
};
