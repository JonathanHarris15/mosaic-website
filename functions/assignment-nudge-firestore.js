/**
 * @fileoverview The hourly nudge job (MS-248, MS-446). Thin: it checks the
 * admin switch, reads the dates from tomorrow to 5 days out with their
 * rosters, reads the nudge records, asks the nudge core, calls the one send
 * path once per Person, and stamps the records. No rule of its own.
 *
 * `runNudgeTick` takes every dependency, so a test can run it with no
 * Firestore and no network. `buildDeps` is the Firestore half.
 */

const {
  lookAhead,
  namesNeeded,
  nudgePlan,
  nudgeRecordId,
  nudgingOn,
  notifyRequest,
  stampedRecord,
} = require("./assignment-nudge");
const Occ = require("./shared/events-occurrence-core.js");
const RolesCore = require("./shared/roles-core.js");

/** @typedef {import("firebase-admin/firestore").Firestore} Firestore */
/** @typedef {import("./assignment-nudge").Occurrence} Occurrence */
/** @typedef {import("./assignment-nudge").NudgeRecord} NudgeRecord */

/**
 * Everything a run needs, passed in.
 * @typedef {{
 *   today: () => string,
 *   origin: string,
 *   log?: (message: string) => void,
 *   tellPerson: (deps: *, request: Object<string, *>) => Promise<*>,
 *   notifierDeps: *,
 *   loadConfig: () => Promise<Object<string, *>>,
 *   loadOccurrences: (from: string, to: string) => Promise<Array<Occurrence>>,
 *   loadRoleNames: () => Promise<Object<string, string>>,
 *   loadNames?: (ids: Array<string>) => Promise<Object<string, string>>,
 *   loadRecords: (ids: Array<string>) => Promise<Array<NudgeRecord>>,
 *   writeRecord: (id: string, row: NudgeRecord) => Promise<void>,
 * }} NudgeDeps
 */

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
 * @param {NudgeDeps} deps
 * @return {Promise<{ran: boolean, sent: number}>}
 */
async function runNudgeTick(deps) {
  const config = await deps.loadConfig();
  if (!nudgingOn(config)) return {ran: false, sent: 0};

  const today = deps.today();
  const range = lookAhead(today);
  const occurrences = await deps.loadOccurrences(range.from, range.to);

  /** @type {Array<string>} */
  const ids = [];
  occurrences.forEach((o) => (o.assignments || []).forEach((a) => {
    if (a && a.personId) ids.push(nudgeRecordId(o, a));
  }));
  const records = await deps.loadRecords(ids);
  /** @type {Object<string, NudgeRecord>} */
  const byId = {};
  records.forEach((r) => {
    if (r.id) byId[r.id] = r;
  });

  const wanted = namesNeeded(occurrences, today);
  const names = wanted.length && deps.loadNames ?
    await deps.loadNames(wanted) : {};
  const plan = nudgePlan({
    occurrences: occurrences,
    records: records,
    today: today,
    roleNames: await deps.loadRoleNames(),
    names: names,
  });

  let sent = 0;
  for (const send of plan) {
    let result;
    try {
      result = await deps.tellPerson(
          deps.notifierDeps, notifyRequest(send, deps.origin));
    } catch (err) {
      if (deps.log) {
        deps.log(`${send.kind} to ${send.personId} failed: ${err}`);
      }
      result = {accepted: false, channel: null};
    }
    if (result && result.skipped === "window") continue;
    if (result && result.accepted) sent += 1;

    const channel = (result && result.channel) || null;
    for (const due of send.assignments) {
      const id = due.recordId;
      const stamped = stampedRecord(byId[id] ? stripId(byId[id]) : null, {
        kind: send.kind,
        assignment: due,
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
 * @param {NudgeRecord} r a record with its id
 * @return {NudgeRecord} the record without it
 */
function stripId(r) {
  const out = Object.assign({}, r);
  delete out.id;
  return out;
}

/**
 * Stored occurrences dated in a range, each with its roster, and the
 * series name an occurrence without its own name is known by.
 * @param {Firestore} db
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 * @return {Promise<Array<Occurrence>>}
 */
async function loadOccurrences(db, from, to) {
  const snap = await db.collection(OCCURRENCES)
      .where("date", ">=", from)
      .where("date", "<=", to)
      .get();
  /** @type {Object<string, string>} */
  const seriesNames = {};
  /** @type {Array<Occurrence>} */
  const out = [];
  for (const doc of snap.docs) {
    /** @type {Occurrence} */
    const occurrence = Object.assign({id: doc.id}, doc.data());
    // Skip a date that is not happening before reading its roster.
    if (Occ.notHappening(occurrence)) continue;
    const roster = await doc.ref.collection("roster").get();
    if (roster.empty) continue;
    occurrence.assignments = roster.docs.map((r) => r.data());
    const seriesId = occurrence.seriesId;
    if (!occurrence.name && seriesId) {
      if (!(seriesId in seriesNames)) {
        const series = await db.collection(SERIES).doc(seriesId).get();
        const data = series.data();
        seriesNames[seriesId] = (data && data.name) || "";
      }
      occurrence.seriesName = seriesNames[seriesId];
    }
    out.push(occurrence);
  }
  return out;
}

/**
 * Slug → name for every stored Role Definition.
 * @param {Firestore} db
 * @return {Promise<Object<string, string>>}
 */
async function loadRoleNames(db) {
  // Through the one resolver (roles-read.js): a Role stored without a slug
  // is still named, and two that read as one slug are named by neither.
  const snap = await db.collection("roles").get();
  const docs = snap.docs.map((d) => Object.assign({id: d.id}, d.data()));
  const registry = RolesCore.registry(docs);
  /** @type {Object<string, string>} */
  const names = {};
  docs.forEach((def) => {
    const slug = def.slug || RolesCore.slugify(def.name);
    const name = registry.nameOf(slug);
    if (slug && name) names[slug] = name;
  });
  return names;
}

/**
 * Full names for these People, as the reminder lists them.
 * @param {Firestore} db
 * @param {Array<string>} ids
 * @return {Promise<Object<string, string>>}
 */
async function loadNames(db, ids) {
  if (!ids.length) return {};
  const refs = ids.map((id) => db.collection("people").doc(id));
  const snaps = await db.getAll(...refs);
  /** @type {Object<string, string>} */
  const out = {};
  snaps.forEach((s) => {
    if (!s.exists) return;
    const name = (s.data() || {}).name;
    const text = typeof name === "string" ? name.trim() :
      [name && name.first, name && name.last].filter(Boolean).join(" ");
    if (text) out[s.id] = text;
  });
  return out;
}

/**
 * The records for these ids. Missing ones are simply absent.
 * @param {Firestore} db
 * @param {Array<string>} ids
 * @return {Promise<Array<NudgeRecord>>}
 */
async function loadRecords(db, ids) {
  if (!ids.length) return [];
  const refs = ids.map((id) => db.collection(RECORDS).doc(id));
  const snaps = await db.getAll(...refs);
  return snaps.filter((s) => s.exists)
      .map((s) => Object.assign({id: s.id}, s.data()));
}

/**
 * What buildDeps is given.
 * @typedef {{
 *   configDoc: string,
 *   today: () => string,
 *   origin: string,
 *   log?: (message: string) => void,
 *   tellPerson: (deps: *, request: Object<string, *>) => Promise<*>,
 *   notifierDeps: *,
 *   serverTimestamp?: () => *,
 * }} NudgeDepsOptions
 */

/**
 * Firestore deps for runNudgeTick. The send path's own deps are passed in,
 * so a nudge goes out by exactly the code every other Notification does.
 * @param {Firestore} db
 * @param {NudgeDepsOptions} opts
 * @return {NudgeDeps}
 */
function buildDeps(db, opts) {
  const o = opts;
  return {
    today: o.today,
    origin: o.origin,
    log: o.log,
    tellPerson: o.tellPerson,
    notifierDeps: o.notifierDeps,
    loadConfig: async () => {
      const snap = await db.doc(o.configDoc).get();
      return snap.data() || {};
    },
    loadOccurrences: (from, to) => loadOccurrences(db, from, to),
    loadRoleNames: () => loadRoleNames(db),
    loadNames: (ids) => loadNames(db, ids),
    loadRecords: (ids) => loadRecords(db, ids),
    writeRecord: async (id, row) => {
      /** @type {Object<string, *>} */
      const data = Object.assign({}, row);
      if (o.serverTimestamp) data.updatedAt = o.serverTimestamp();
      await db.collection(RECORDS).doc(id).set(data);
    },
  };
}

module.exports = {
  runNudgeTick,
  buildDeps,
  loadRoleNames,
};
