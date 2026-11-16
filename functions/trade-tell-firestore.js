/**
 * @fileoverview The Firestore half of telling a Trade's parties (MS-824).
 * Thin: on every Trade write it asks the rules who is owed a message, claims
 * a record for each so a retried trigger sends once, and sends through the
 * one send path. Outside the church's hours a message is held; the hourly
 * sweep sends it if it is still true, and drops it if not.
 */

const {
  tellsFor,
  recordId,
  stillTrue,
  wordsFor,
  notifyRequest,
} = require("./trade-tell");
const {TRADES} = require("./trade-writes");

/** @typedef {import("firebase-admin/firestore").Firestore} Firestore */
/** @typedef {import("./trade-tell").Tell} Tell */

const RECORDS = "trade_tells";

/**
 * Who a Person is to the send path.
 * @typedef {{uid?: ?string, firstName?: string}} PersonInfo
 */

/**
 * Everything a run needs, passed in.
 * @typedef {{
 *   churchNow: () => {date: string, hour: number},
 *   now: () => *,
 *   origin: string,
 *   log?: (message: string) => void,
 *   tellPerson: (deps: *, request: Object<string, *>) => Promise<*>,
 *   notifierDeps: *,
 *   loadPerson: (id: string) => Promise<?PersonInfo>,
 *   loadTrade: (id: string) => Promise<*>,
 *   claimRecord: (id: string, row: Object<string, *>) => Promise<boolean>,
 *   writeRecord: (id: string, patch: Object<string, *>) => Promise<void>,
 *   loadHeldRecords: () => Promise<Array<*>>,
 * }} TellDeps
 */

/**
 * The first names of a Trade's two parties, for the Commitments sentence.
 * @param {TellDeps} deps
 * @param {*} trade
 * @return {Promise<function(string): string>}
 */
async function namesOf(deps, trade) {
  /** @type {Object<string, string>} */
  const names = {};
  for (const id of [trade.holderId, trade.counterpartyId]) {
    if (!id) continue;
    const p = await deps.loadPerson(id);
    names[id] = (p && p.firstName) || "Somebody";
  }
  return (personId) => names[personId] || "Somebody";
}

/**
 * The status a send leaves on its record.
 * @param {*} result tellPerson's outcome
 * @return {string}
 */
function statusOf(result) {
  if (result && result.skipped === "window") return "held";
  if (result && result.accepted) return "sent";
  if (result && result.unreachable) return "unreachable";
  return "failed";
}

/**
 * Send one message and record how it went. Never throws.
 * @param {TellDeps} deps
 * @param {string} id the record
 * @param {*} trade
 * @param {Tell} t
 * @return {Promise<string>}
 */
async function deliver(deps, id, trade, t) {
  let status = "failed";
  try {
    const words = wordsFor(trade, t.personId, await namesOf(deps, trade));
    status = statusOf(await deps.tellPerson(deps.notifierDeps,
        notifyRequest(t, words, deps.origin)));
  } catch (err) {
    if (deps.log) deps.log(`Trade tell ${id}: ${err}`);
  }
  await deps.writeRecord(id, {status: status, at: deps.now()});
  return status;
}

/**
 * Tell the parties whatever a Trade write owes them.
 * @param {TellDeps} deps
 * @param {{tradeId: string, before: *, after: *}} change
 * @return {Promise<number>} how many messages were sent
 */
async function tellParties(deps, change) {
  const after = change.after;
  if (!after) return 0;
  const linked = new Set();
  for (const id of [after.holderId, after.counterpartyId]) {
    if (!id) continue;
    const p = await deps.loadPerson(id);
    if (p && p.uid) linked.add(id);
  }
  const owed = tellsFor(change.before, after, {
    today: deps.churchNow().date,
    linked: linked,
  });
  let sent = 0;
  for (const t of owed) {
    const id = recordId(change.tradeId, t);
    const claimed = await deps.claimRecord(id, Object.assign(
        {tradeId: change.tradeId, status: "sending", at: deps.now()}, t));
    if (!claimed) continue;
    if (await deliver(deps, id, after, t) === "sent") sent += 1;
  }
  return sent;
}

/**
 * The hourly sweep: send what was held overnight if it is still true.
 * @param {TellDeps} deps
 * @return {Promise<number>} how many were sent
 */
async function sweepHeldTells(deps) {
  const today = deps.churchNow().date;
  let sent = 0;
  for (const r of await deps.loadHeldRecords()) {
    const trade = await deps.loadTrade(r.tradeId);
    if (!stillTrue(trade, r, today)) {
      await deps.writeRecord(r.id, {status: "dropped", at: deps.now()});
      continue;
    }
    if (await deliver(deps, r.id, trade, r) === "sent") sent += 1;
  }
  return sent;
}

/**
 * What buildTellDeps is given.
 * @typedef {{
 *   churchNow: () => {date: string, hour: number},
 *   now: () => *,
 *   origin: string,
 *   log: (message: string) => void,
 *   tellPerson: (deps: *, request: Object<string, *>) => Promise<*>,
 *   notifierDeps: *,
 * }} TellDepsOptions
 */

/**
 * The Firestore deps.
 * @param {Firestore} db
 * @param {TellDepsOptions} opts
 * @return {TellDeps}
 */
function buildTellDeps(db, opts) {
  const records = db.collection(RECORDS);
  return Object.assign({}, opts, {
    loadPerson: opts.notifierDeps.loadPerson,
    loadTrade: async (/** @type {string} */ id) => {
      const snap = await db.collection(TRADES).doc(id).get();
      return snap.exists ? Object.assign({id: snap.id}, snap.data()) : null;
    },
    claimRecord: async (/** @type {string} */ id, /** @type {*} */ row) => {
      try {
        await records.doc(id).create(row);
        return true;
      } catch (err) {
        return false;
      }
    },
    writeRecord: async (/** @type {string} */ id, /** @type {*} */ patch) => {
      await records.doc(id).set(patch, {merge: true});
    },
    loadHeldRecords: async () => {
      const snap = await records.where("status", "==", "held").get();
      return snap.docs.map((d) => Object.assign({id: d.id}, d.data()));
    },
  });
}

module.exports = {
  tellParties,
  sweepHeldTells,
  buildTellDeps,
};
