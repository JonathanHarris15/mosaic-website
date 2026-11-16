/**
 * @fileoverview The hourly nudge job (MS-248, MS-446). Thin: it checks the
 * admin switch, reads the dates from tomorrow to 5 days out with their
 * rosters, reads the nudge records, asks the nudge core, calls the one send
 * path once per Person, and stamps the records. No rule of its own.
 *
 * `runNudgeTick` takes every dependency, so a test can run it with no
 * Firestore and no network. `buildDeps` is the Firestore half.
 */

const nudge = require("./assignment-nudge");

const OCCURRENCES = "event_occurrences";
const SERIES = "events";
const RECORDS = "assignment_nudges";

/**
 * One run. Returns how many People were sent a nudge.
 *
 * Every attempt is stamped whatever the outcome — accepted, refused, or
 * nobody reachable — so a failing text is not repeated every hour. The
 * second nudge is the retry. A send held back by the church's hours is
 * not an attempt, and is not stamped.
 *
 * @param {Object} deps today, loadConfig, loadOccurrences, loadRoleNames,
 *   loadRecords, writeRecord, tellPerson, notifierDeps, origin, log
 * @return {Promise<{ran: boolean, sent: number}>}
 */
async function runNudgeTick(deps) {
  const config = await deps.loadConfig();
  if (!nudge.nudgingOn(config)) return {ran: false, sent: 0};

  const today = deps.today();
  const range = nudge.lookAhead(today);
  const occurrences = await deps.loadOccurrences(range.from, range.to);

  const ids = [];
  occurrences.forEach((o) => (o.assignments || []).forEach((a) => {
    if (a && a.personId) ids.push(nudge.nudgeRecordId(o, a));
  }));
  const records = await deps.loadRecords(ids);
  const byId = {};
  records.forEach((r) => {
    byId[r.id] = r;
  });

  const plan = nudge.nudgePlan({
    occurrences: occurrences,
    records: records,
    today: today,
    roleNames: await deps.loadRoleNames(),
  });

  let sent = 0;
  for (const send of plan) {
    let result;
    try {
      result = await deps.tellPerson(
          deps.notifierDeps, nudge.notifyRequest(send, deps.origin));
    } catch (err) {
      if (deps.log) deps.log(`Nudge to ${send.personId} failed: ${err}`);
      result = {accepted: false, channel: null};
    }
    if (result && result.skipped === "window") continue;
    if (result && result.accepted) sent += 1;

    const channel = (result && result.channel) || null;
    for (const place of send.places) {
      const id = place.recordId;
      const stamped = nudge.stampedRecord(byId[id] ? stripId(byId[id]) : null, {
        place: place,
        personId: send.personId,
        today: today,
        channel: channel,
      });
      await deps.writeRecord(id, stamped);
    }
  }
  return {ran: true, sent: sent};
}

/**
 * @param {Object} r a record with its id
 * @return {Object} the record without it
 */
function stripId(r) {
  const out = Object.assign({}, r);
  delete out.id;
  return out;
}

/**
 * Stored occurrences dated in a range, each with its roster, and the
 * series name an occurrence without its own name is known by.
 * @param {Object} db Firestore
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 * @return {Promise<Array<Object>>}
 */
async function loadOccurrences(db, from, to) {
  const snap = await db.collection(OCCURRENCES)
      .where("date", ">=", from)
      .where("date", "<=", to)
      .get();
  const seriesNames = {};
  const out = [];
  for (const doc of snap.docs) {
    const occurrence = Object.assign({id: doc.id}, doc.data());
    if (occurrence.cancelled === true || occurrence.movedTo) continue;
    const roster = await doc.ref.collection("roster").get();
    if (roster.empty) continue;
    occurrence.assignments = roster.docs.map((r) => r.data());
    const seriesId = occurrence.seriesId;
    if (!occurrence.name && seriesId) {
      if (!(seriesId in seriesNames)) {
        const series = await db.collection(SERIES).doc(seriesId).get();
        seriesNames[seriesId] = series.exists ?
          (series.data().name || "") : "";
      }
      occurrence.seriesName = seriesNames[seriesId];
    }
    out.push(occurrence);
  }
  return out;
}

/**
 * Slug → name for every stored Role Definition.
 * @param {Object} db Firestore
 * @return {Promise<Object<string, string>>}
 */
async function loadRoleNames(db) {
  const snap = await db.collection("roles").get();
  const names = {};
  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (data.slug && data.name) names[data.slug] = data.name;
  });
  return names;
}

/**
 * The records for these ids. Missing ones are simply absent.
 * @param {Object} db Firestore
 * @param {Array<string>} ids
 * @return {Promise<Array<Object>>}
 */
async function loadRecords(db, ids) {
  if (!ids.length) return [];
  const refs = ids.map((id) => db.collection(RECORDS).doc(id));
  const snaps = await db.getAll(...refs);
  return snaps.filter((s) => s.exists)
      .map((s) => Object.assign({id: s.id}, s.data()));
}

/**
 * Firestore deps for runNudgeTick. The send path's own deps are passed in,
 * so a nudge goes out by exactly the code every other Notification does.
 * @param {Object} db Firestore
 * @param {Object} opts tellPerson, notifierDeps, origin, today, log,
 *   serverTimestamp
 * @return {Object}
 */
function buildDeps(db, opts) {
  const o = opts || {};
  return {
    today: o.today,
    origin: o.origin,
    log: o.log,
    tellPerson: o.tellPerson,
    notifierDeps: o.notifierDeps,
    loadConfig: async () => {
      const snap = await db.doc(o.configDoc).get();
      return snap.exists ? snap.data() : {};
    },
    loadOccurrences: (from, to) => loadOccurrences(db, from, to),
    loadRoleNames: () => loadRoleNames(db),
    loadRecords: (ids) => loadRecords(db, ids),
    writeRecord: async (id, row) => {
      const data = Object.assign({}, row);
      if (o.serverTimestamp) data.updatedAt = o.serverTimestamp();
      await db.collection(RECORDS).doc(id).set(data);
    },
  };
}

module.exports = {
  RECORDS,
  runNudgeTick,
  buildDeps,
};
