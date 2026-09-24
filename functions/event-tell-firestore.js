/**
 * @fileoverview Firestore helpers for the event-tell hourly job (MS-680).
 */

const admin = require("firebase-admin");
const Ann = require("./shared/event-announcement-core.js");
const Occ = require("./shared/events-occurrence-core.js");
const Tell = require("./shared/event-tell-core.js");
const pr = require("./prayer-request.js");

const GOING_OUT = Ann.GOING_OUT;
const WORDS = Ann.WORDS;
const LEDGER = "event_tell_sent";
const SERIES = "events";
const OCCURRENCES = "event_occurrences";
const PRAYER_CONFIG_DOC = "app_config/prayer_request_sms";

/**
 * @param {FirebaseFirestore.DocumentReference} ref
 * @return {?Object}
 */
function parentFromGoingOutRef(ref) {
  const path = ref.path.split("/");
  if (path.length < 4) return null;
  const collection = path[path.length - 3];
  const parentId = path[path.length - 2];
  if (collection === SERIES) {
    return {kind: "series", seriesId: parentId};
  }
  if (collection === OCCURRENCES) {
    return {kind: "occurrence", occurrenceId: parentId};
  }
  return null;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @return {Promise<Object[]>}
 */
async function loadTellParents(db) {
  const snap = await db.collectionGroup(GOING_OUT)
      .where("way", "==", Ann.TOLD)
      .get();
  const parents = [];
  const seen = new Set();

  for (const doc of snap.docs) {
    const parentRef = doc.ref.parent.parent;
    if (!parentRef) continue;
    const key = parentRef.path;
    if (seen.has(key)) continue;
    seen.add(key);

    const parsed = parentFromGoingOutRef(doc.ref);
    if (!parsed) continue;

    if (parsed.kind === "occurrence") {
      parents.push({
        key,
        eventKind: "one-off",
        occurrenceId: parsed.occurrenceId,
        seriesId: null,
        rule: null,
        stored: [],
        parentRef,
      });
      continue;
    }

    const seriesSnap = await parentRef.get();
    if (!seriesSnap.exists) continue;
    const series = seriesSnap.data() || {};
    const today = Tell.churchNowParts(new Date()).date;
    const to = addDays(today, 400);
    const storedSnap = await db.collection(OCCURRENCES)
        .where("seriesId", "==", parsed.seriesId)
        .where("date", ">=", addDays(today, -30))
        .where("date", "<=", to)
        .get();
    const stored = storedSnap.docs.map((d) => {
      return Object.assign({id: d.id}, d.data());
    });
    parents.push({
      key,
      eventKind: "repeating",
      seriesId: parsed.seriesId,
      occurrenceId: null,
      rule: series.rule || series.recurrence || null,
      stored,
      parentRef,
    });
  }
  return parents;
}

/**
 * @param {string} date
 * @param {number} days
 * @return {string}
 */
function addDays(date, days) {
  const parts = date.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

/**
 * @param {Object} parent
 * @return {Promise<Array<{id: string, data: Object}>>}
 */
async function loadWords(parent) {
  const snap = await parent.parentRef.collection(WORDS).get();
  return snap.docs.map((doc) => ({id: doc.id, data: doc.data()}));
}

/**
 * @param {Object} parent
 * @return {Promise<Array<{id: string, data: Object}>>}
 */
async function loadGoingOut(parent) {
  const snap = await parent.parentRef.collection(GOING_OUT)
      .where("way", "==", Ann.TOLD)
      .get();
  return snap.docs.map((doc) => ({id: doc.id, data: doc.data()}));
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @return {Promise<Object[]>}
 */
async function loadPeopleForTell(db) {
  const snap = await db.collection("people").get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    const contact = data.contact || {};
    return {
      id: doc.id,
      name: data.name || "",
      firstName: pr.firstNameOf(data.name),
      tags: data.tags || [],
      membership: data.membership || {},
      userId: data.userId || null,
      contact: {phone: contact.phone || ""},
    };
  });
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} parent
 * @param {Object} moment
 * @return {Promise<?string>}
 */
async function resolveOccurrenceId(db, parent, moment) {
  if (parent.eventKind === "one-off") {
    return parent.occurrenceId;
  }
  const date = moment.occurrenceDate;
  if (!date || !parent.seriesId) return null;
  const snap = await db.collection(OCCURRENCES)
      .where("seriesId", "==", parent.seriesId)
      .where("date", "==", date)
      .limit(1)
      .get();
  if (!snap.empty) return snap.docs[0].id;
  return Occ.occurrenceId(parent.seriesId, date);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {?Function} tellPerson MS-189 send path when present
 * @param {string} [baseUrl] hosting origin for event links
 * @return {Object}
 */
function buildDeps(db, tellPerson, baseUrl) {
  return {
    now: () => new Date(),
    baseUrl: baseUrl || "https://mosaicmethodist.org",
    tellPerson,
    notifierDeps: null,
    loadTellParents: () => loadTellParents(db),
    loadWords: (parent) => loadWords(parent),
    loadGoingOut: (parent) => loadGoingOut(parent),
    loadPeople: () => loadPeopleForTell(db),
    loadWordingConfig: async () => {
      const snap = await db.doc(PRAYER_CONFIG_DOC).get();
      return snap.exists ? snap.data() : {};
    },
    resolveOccurrenceId: (parent, moment) =>
      resolveOccurrenceId(db, parent, moment),
    hasSentMarker: async (id) => {
      const snap = await db.collection(LEDGER).doc(id).get();
      return snap.exists;
    },
    writeSentMarker: async (id, row) => {
      await db.collection(LEDGER).doc(id).set(Object.assign({}, row, {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }));
    },
  };
}

module.exports = {
  LEDGER,
  buildDeps,
  loadTellParents,
  resolveOccurrenceId,
  parentFromGoingOutRef,
};
