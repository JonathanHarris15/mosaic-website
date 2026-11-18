/**
 * @fileoverview The Firestore half of telling a Trade's parties (MS-824).
 * Thin: on every Trade write it asks the rules who is owed a message, claims
 * a record for each so a retried trigger sends once, and sends through the
 * one send path. Outside the church's hours a message is held; the hourly
 * sweep sends it if it is still true, and drops it if not.
 *
 * `trade_tells` is not a second log. "Did we tell them?" stays in
 * `notifications`, which the send path writes. This record only makes a
 * message go once and holds it overnight. A crash between claiming a record
 * and sending leaves it at "sending" and the message is not retried: once,
 * not at least once.
 */

const {
  tellsFor,
  recordId,
  stillTrue,
  wordsFor,
  notifyRequest,
} = require("./trade-tell");
const {statusFromSend, TEXT_STATUS} = require("./trade-invitation-text");
const {tradeReads} = require("./trade-invitation-firestore");

/** @typedef {import("firebase-admin/firestore").Firestore} Firestore */
/** @typedef {import("./trade-tell").Tell} Tell */
/** @typedef {import("./trade-tell").NameOf} NameOf */

/**
 * A Trade's two parties: who has a Linked User, and their names.
 * @typedef {{linked: Set<string>, nameOf: NameOf, fullNameOf: NameOf}} Parties
 */

const RECORDS = "trade_tells";

/**
 * Who a Person is to the send path.
 * @typedef {{uid?: ?string, firstName?: string, fullName?: string}} PersonInfo
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
 * A Trade's two parties, read once: who has a Linked User, and the first
 * names the Commitments sentence uses.
 * @param {TellDeps} deps
 * @param {*} trade
 * @return {Promise<Parties>}
 */
async function partiesOf(deps, trade) {
  /** @type {Object<string, string>} */
  const names = {};
  /** @type {Object<string, string>} */
  const fullNames = {};
  const linked = new Set();
  for (const id of [trade.holderId, trade.counterpartyId]) {
    if (!id) continue;
    const p = await deps.loadPerson(id);
    names[id] = (p && p.firstName) || "Somebody";
    fullNames[id] = (p && (p.fullName || p.firstName)) || "Somebody";
    if (p && p.uid) linked.add(id);
  }
  return {
    linked: linked,
    nameOf: (personId) => names[personId] || "Somebody",
    fullNameOf: (personId) => fullNames[personId] || "Somebody",
  };
}

/**
 * Send one message and record how it went. Never throws.
 * @param {TellDeps} deps
 * @param {string} id the record
 * @param {*} trade
 * @param {Tell} t
 * @param {Parties} parties
 * @return {Promise<string>}
 */
async function deliver(deps, id, trade, t, parties) {
  let status = "failed";
  try {
    const words = wordsFor(trade, t.personId, parties.nameOf);
    status = statusFromSend(await deps.tellPerson(deps.notifierDeps,
        notifyRequest(t, words, deps.origin, trade, parties.fullNameOf)));
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
  const parties = await partiesOf(deps, after);
  const owed = tellsFor(change.before, after, {
    today: deps.churchNow().date,
    linked: parties.linked,
  });
  let sent = 0;
  for (const t of owed) {
    const id = recordId(change.tradeId, t);
    const claimed = await deps.claimRecord(id, Object.assign(
        {tradeId: change.tradeId, status: "sending", at: deps.now()}, t));
    if (!claimed) continue;
    const status = await deliver(deps, id, after, t, parties);
    if (status === TEXT_STATUS.SENT) {
      sent += 1;
    }
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
    const parties = await partiesOf(deps, trade);
    const status = await deliver(deps, r.id, trade, r, parties);
    if (status === TEXT_STATUS.SENT) {
      sent += 1;
    }
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
    loadTrade: tradeReads(db).loadTrade,
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
      const snap = await records.where("status", "==", TEXT_STATUS.HELD).get();
      return snap.docs.map((d) => Object.assign({id: d.id}, d.data()));
    },
  });
}

module.exports = {
  tellParties,
  sweepHeldTells,
  buildTellDeps,
};
