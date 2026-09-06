/**
 * The Calendar, from the server (MS-278).
 *
 * ⚠ THIS FILE DECIDES ALMOST NOTHING, AND THAT IS THE POINT. Everything true
 * about an Event — how a recurrence expands, what a move does to the
 * assignments riding on a date, why a Sunday cannot be skipped, what an
 * unstamped occurrence does to every list query — already lives in
 * shared/events-store.js and shared/events-occurrence-core.js, which take a
 * `db` and touch no browser API. They come across whole. This is the door,
 * plus the naming and the refusals an assistant needs and a person clicking a
 * button did not.
 *
 * ⚠ ONE DATE OR EVERY DATE IS THE WHOLE QUESTION. `updateEvent` changes one
 * occurrence; `updateSeries` changes the pattern behind all of them. An
 * assistant asked to "move Tuesday's prayer meeting" that reaches for the
 * series has moved a year of Tuesdays. Both the names and the tool descriptions
 * are written so that confusion is hard, and `updateEvent` refuses a re-date of
 * a date belonging to a series outright — that is `moveEvent`.
 *
 * ⚠ ROSTERS, ROLES, AUTO-ASSIGN AND FAIRNESS ARE NOT HERE. `cal_` edits the
 * Event, never who serves on it: that has its own screens and its own rules,
 * and it is out of scope on MS-278. A move still carries its assignments with
 * the date, because that is what moving a date means — it is not editing them.
 *
 * ⚠ A SUNDAY IS AN EVENT BUT ITS LITURGY IS NOT. The Order of Service lives
 * under the DATE, in `services/{date}`, and `oos_` owns it. The Sunday Service
 * series is locked, cannot be skipped and cannot be moved; events-store refuses
 * all three itself, so those refusals arrive here as messages worth passing on
 * rather than as rules restated.
 *
 * ⚠ VISIBILITY QUERIES ARE CONSTRAINED IN THE STORE. An unconstrained one does
 * not return fewer rows — it errors, and the error reads exactly like "this
 * church has no events". Every read here goes through the store's own
 * rank-aware queries at the elder rung, which is who is calling.
 */

const Store = require("./shared/events-store.js");
const Core = require("./shared/events-occurrence-core.js");
const {refuse} = require("./shepherding-writes.js");

// Who the MCP reads the Calendar as. Every `cal_` tool is elder-gated, and an
// elder sees every rung — so nothing is hidden from an assistant that would not
// be hidden from the elder who connected it.
const RANK = "elder";

/** events-store throws plain Errors; an assistant should get a refusal. */
async function pass(work) {
  try {
    return await work();
  } catch (e) {
    throw refuse(e && e.message ? e.message : String(e));
  }
}

/** One occurrence, as an assistant reads it. */
function eventRow(occurrence) {
  return {
    eventId: occurrence.id,
    seriesId: occurrence.seriesId || null,
    name: occurrence.name || "",
    date: occurrence.date,
    endDate: occurrence.endDate || null,
    time: occurrence.time || null,
    location: occurrence.location || null,
    description: occurrence.description || null,
    visibility: occurrence.visibility || null,
    cancelled: !!occurrence.cancelled,
    // A date computed from the pattern has no document yet. Worth saying,
    // because it is why some events cannot be edited until they are touched.
    stored: !!occurrence.stored,
  };
}

/**
 * Every Event occurrence between two dates.
 *
 * @param {object} db the Firestore handle
 * @param {object} args from, to (YYYY-MM-DD), seriesId to narrow to one Event
 * @return {Promise<object>} { from, to, count, events }
 */
async function listEvents(db, {from, to, seriesId}) {
  if (!from || !to) throw refuse("Give a `from` and a `to` date (YYYY-MM-DD).");

  // Already sorted by date, and already a mix of dates that have documents and
  // dates the pattern computed — which is the whole reason to ask the store
  // rather than to read the occurrences collection.
  let events = await pass(() => Store.loadCalendar(db, {from, to, rank: RANK}));
  if (seriesId) events = events.filter((o) => o.seriesId === seriesId);

  events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {from, to, count: events.length, events: events.map(eventRow)};
}

/**
 * One Event occurrence.
 * @param {object} db the Firestore handle
 * @param {object} args eventId
 * @return {Promise<object>} the occurrence
 */
async function getEvent(db, {eventId}) {
  const occurrence = await pass(() => Store.loadOccurrence(db, eventId));
  if (!occurrence) {
    throw refuse(
        `No Event occurrence with id "${eventId}". A date computed from a ` +
        "pattern has no document until something is written on it — use " +
        "cal_list_events over a date range to see what is actually there.");
  }
  return eventRow(occurrence);
}

/**
 * Every recurring Event, as a series rather than as dates.
 * @param {object} db the Firestore handle
 * @return {Promise<object>} { count, series }
 */
async function listSeries(db) {
  const series = await pass(() => Store.loadVisibleSeries(db, {rank: RANK}));
  return {
    count: series.length,
    series: series.map((s) => ({
      seriesId: s.id,
      name: s.name || "",
      locked: !!s.locked,
      recurrence: s.recurrence || null,
      location: s.location || null,
      description: s.description || null,
      visibility: s.visibility || null,
      colour: s.colour || null,
      // Said out loud: the Sunday Service is the one series that cannot be
      // skipped, moved or unlocked, and an assistant should know before it
      // tries.
      isSundayService: s.id === Core.SUNDAY_SERVICE_ID,
    })),
  };
}

/**
 * A new Event — one date, or a repeating series.
 *
 * `recurrence` decides which. Without one, or with `freq: 'once'`, this makes a
 * single dated occurrence. With one, it makes a series and NO occurrence
 * documents at all: the Calendar computes the dates from the pattern, and a
 * document appears only when something is actually written on a date.
 *
 * @param {object} db the Firestore handle
 * @param {object} args name, visibility, date, endDate, time, location,
 *   description, recurrence, rosterShared
 * @return {Promise<object>} { ok, kind, id }
 */
async function createEvent(db, args) {
  const spec = args || {};
  if (!spec.visibility) {
    throw refuse(
        "An Event has to say who can see it. Use one of: " +
        Core.VISIBILITY_ORDER.join(", ") + ".");
  }
  if (Core.VISIBILITY_ORDER.indexOf(spec.visibility) === -1) {
    throw refuse(
        `"${spec.visibility}" is not a visibility. Use one of: ` +
        Core.VISIBILITY_ORDER.join(", ") + ".");
  }

  const made = await pass(() => Store.createEvent(db, spec));
  return {
    ok: true,
    kind: made.kind,
    [made.kind === "series" ? "seriesId" : "eventId"]: made.id,
    note: made.kind === "series" ?
      "A repeating Event. Its dates are computed from the pattern — there are " +
      "no occurrence documents until something is written on a date." :
      "A single dated Event.",
  };
}

/**
 * Change ONE date: its name, time, place or description.
 *
 * ⚠ NOT THE PATTERN. This touches one occurrence and leaves every other date of
 * the series exactly as it was.
 *
 * @param {object} db the Firestore handle
 * @param {object} args eventId, name, time, location, description, visibility
 * @return {Promise<object>} { ok, eventId, changed }
 */
async function updateEvent(db, {eventId, ...details}) {
  if (!eventId) throw refuse("Which date? Give an eventId.");

  const given = {};
  ["name", "time", "location", "description", "visibility", "date", "endDate"]
      .forEach((field) => {
        if (details[field] !== undefined) given[field] = details[field];
      });
  if (!Object.keys(given).length) throw refuse("Nothing to change.");

  const changed = await pass(() => Store.saveOccurrenceDetails(db, eventId, given));
  return {ok: true, eventId, changed};
}

/**
 * Change the EVENT ITSELF: its name, place, description, pattern, time or
 * colour, across every date it has and will ever have.
 *
 * @param {object} db the Firestore handle
 * @param {object} args seriesId, name, location, description, time, colour
 * @return {Promise<object>} { ok, seriesId, changed }
 */
async function updateSeries(db, {seriesId, name, location, description, time, colour}) {
  if (!seriesId) throw refuse("Which Event? Give a seriesId.");

  const details = {};
  if (name !== undefined) details.name = name;
  if (location !== undefined) details.location = location;
  if (description !== undefined) details.description = description;

  const changed = {};
  if (Object.keys(details).length) {
    Object.assign(changed, await pass(
        () => Store.saveSeriesDetails(db, seriesId, details)));
  }
  if (time !== undefined) {
    await pass(() => Store.setSeriesTime(db, seriesId, time));
    changed.time = time;
  }
  if (colour !== undefined) {
    if (Store.COLOUR_SLUGS.indexOf(colour) === -1) {
      throw refuse(
          `"${colour}" is not a colour. Use one of: ` +
          Store.COLOUR_SLUGS.join(", ") + ".");
    }
    await pass(() => Store.setSeriesColour(db, seriesId, colour));
    changed.colour = colour;
  }

  if (!Object.keys(changed).length) throw refuse("Nothing to change.");
  return {
    ok: true,
    seriesId,
    changed,
    note: "Every date of this Event, past and future, not just one.",
  };
}

/**
 * Move ONE date of a repeating Event to another date, carrying whoever is on it.
 *
 * @param {object} db the Firestore handle
 * @param {object} args seriesId, fromDate, toDate
 * @return {Promise<object>} what moved
 */
async function moveEvent(db, {seriesId, fromDate, toDate}) {
  if (!seriesId || !fromDate || !toDate) {
    throw refuse("A move needs a seriesId, a fromDate and a toDate.");
  }
  const moved = await pass(
      () => Store.moveOccurrence(db, seriesId, fromDate, toDate));
  return {
    ok: true,
    seriesId,
    from: moved.from,
    to: moved.to,
    assignmentsCarried: moved.assignments,
  };
}

/**
 * Skip one date of a repeating Event, or put a skipped one back.
 *
 * @param {object} db the Firestore handle
 * @param {object} args seriesId, date, cancelled
 * @return {Promise<object>} { ok }
 */
async function cancelEvent(db, {seriesId, date, cancelled}) {
  if (!seriesId || !date) throw refuse("A skip needs a seriesId and a date.");
  await pass(() => Store.cancelOccurrence(
      db, seriesId, date, cancelled === undefined ? true : !!cancelled));
  return {
    ok: true,
    seriesId,
    date,
    cancelled: cancelled === undefined ? true : !!cancelled,
  };
}

/**
 * Delete one Event occurrence and its roster.
 *
 * ⚠ ONE DATE. There is deliberately no tool that deletes a whole series: an
 * Event with a year of history behind it is not something an assistant should
 * be able to remove on a sentence, and nothing in MS-278 asked for it.
 *
 * @param {object} db the Firestore handle
 * @param {object} args eventId
 * @return {Promise<object>} what was deleted
 */
async function deleteEvent(db, {eventId}) {
  const occurrence = await pass(() => Store.loadOccurrence(db, eventId));
  if (!occurrence) throw refuse(`No Event occurrence with id "${eventId}".`);

  const result = await pass(() => Store.deleteOccurrence(db, eventId));
  return {
    ok: true,
    deleted: {
      eventId,
      name: occurrence.name || "",
      date: occurrence.date,
      assignments: (result && result.assignments) || 0,
    },
  };
}

/**
 * A document attached to one Event.
 *
 * ⚠ AN EVENT DOCUMENT IS NOT AN ELDER DOCUMENT. It hangs off the occurrence and
 * anyone who can see the Event can read it, which is exactly why the Note
 * Module's Cross-Reference picker is off there — a surface that a member may
 * read cannot offer a picker onto elder-only records. Nothing here writes a
 * Cross-Reference into one.
 *
 * @param {object} db the Firestore handle
 * @param {object} args eventId, title, markdown, actor
 * @return {Promise<object>} { ok, documentId }
 */
async function createEventDocument(db, {eventId, title, markdown, actor}) {
  const NoteMarkdownCore = require("./shared/note-markdown-core.js");
  const DocumentBodyCore = require("./shared/document-body-core.js");
  const Actor = require("./mcp-actor.js");

  const occurrence = await pass(() => Store.loadOccurrence(db, eventId));
  if (!occurrence) {
    throw refuse(
        `No Event occurrence with id "${eventId}". A date computed from a ` +
        "pattern has no document to hang one off yet.");
  }

  const documentId = Store.newEventDocumentId(db, eventId);
  const record = DocumentBodyCore.buildDocumentRecord({
    title: String(title || "").trim(),
    contentJson: NoteMarkdownCore.fromMarkdown(String(markdown || "")),
    createdBy: actor.uid,
    createdByName: actor.name,
    updatedByName: actor.name,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await pass(() => Store.saveEventDocument(
      db, eventId, documentId, Object.assign({}, record, Actor.provenance())));

  return {ok: true, eventId, documentId, title: record.title};
}

module.exports = {
  listEvents,
  getEvent,
  listSeries,
  createEvent,
  updateEvent,
  updateSeries,
  moveEvent,
  cancelEvent,
  deleteEvent,
  createEventDocument,
};
