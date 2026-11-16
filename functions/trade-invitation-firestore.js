/**
 * @fileoverview The Firestore half of texting a Trade invitee (MS-249): the
 * reads both the sender and the Answer link door need, and the sender's
 * deps. Same split as assignment-nudge-firestore.js — the rules live in
 * trade-invitation-text.js, the order of things in trade-invitation-send.js.
 */

const {TRADES} = require("./trade-writes");
const Occ = require("./shared/events-occurrence-core.js");
const {firstNameOf} = require("./prayer-request");
const {TEXT_STATUS} = require("./trade-invitation-text");

/** @typedef {import("firebase-admin/firestore").Firestore} Firestore */
/** @typedef {import("./trade-invitation-text").TradeDoc} TradeDoc */
/** @typedef {import("./trade-invitation-send").InviteDeps} InviteDeps */

const OCCURRENCES = "event_occurrences";
const SERIES = "events";

/**
 * What a Trade invitation reads, wherever it is read from.
 * @typedef {{
 *   loadTrade: (id: string) => Promise<?TradeDoc>,
 *   holderFirstName: (personId: string) => Promise<string>,
 *   eventTime: (trade: TradeDoc) => Promise<?string>,
 * }} TradeReads
 */

/**
 * @param {Firestore} db
 * @return {TradeReads}
 */
function tradeReads(db) {
  return {
    loadTrade: async (id) => {
      const snap = await db.collection(TRADES).doc(id).get();
      return snap.exists ? Object.assign({id: snap.id}, snap.data()) : null;
    },
    holderFirstName: async (personId) => {
      if (!personId) return "";
      const snap = await db.collection("people").doc(personId).get();
      const data = snap.data();
      return firstNameOf((data && data.name) || "");
    },
    // A repeating Event's time lives on its rule; a one-off's on its date.
    eventTime: async (trade) => {
      const assignment = /** @type {*} */ (trade.assignment || {});
      const occurrenceId = assignment.occurrenceId;
      if (!occurrenceId) return null;
      const occ = (await db.collection(OCCURRENCES).doc(occurrenceId).get())
          .data();
      if (!occ) return null;
      let rule = null;
      if (occ.seriesId) {
        const series = (await db.collection(SERIES).doc(occ.seriesId).get())
            .data();
        rule = series ? (series.rule || series.recurrence || null) : null;
      }
      return Occ.timeOf(occ, rule);
    },
  };
}

/**
 * What buildInviteDeps is given: the send path, the clock, and how to mint
 * an Answer link (the door's, passed in so this module does not require it).
 * @typedef {{
 *   churchNow: () => {date: string, hour: number},
 *   now: () => *,
 *   log: (message: string) => void,
 *   tellPerson: (deps: *, request: Object<string, *>) => Promise<*>,
 *   notifierDeps: *,
 *   mintLink: (args: {personId: string, tradeId: string, endDate: string})
 *     => Promise<string>,
 *   deleteField: () => *,
 * }} InviteDepsOptions
 */

/**
 * The sender's deps, from Firestore.
 * @param {Firestore} db
 * @param {InviteDepsOptions} opts
 * @return {InviteDeps}
 */
function buildInviteDeps(db, opts) {
  const trades = db.collection(TRADES);
  return {
    churchNow: opts.churchNow,
    now: opts.now,
    log: opts.log,
    tellPerson: opts.tellPerson,
    notifierDeps: opts.notifierDeps,
    loadTrade: tradeReads(db).loadTrade,
    loadPerson: opts.notifierDeps.loadPerson,
    mintLink: opts.mintLink,
    writeStatus: async (id, status) => {
      await trades.doc(id).update({
        invitationText: status || opts.deleteField(),
      });
    },
    loadHeldTradeIds: async () => {
      const snap = await trades
          .where("invitationText.status", "==", TEXT_STATUS.HELD).get();
      return snap.docs.map((d) => d.id);
    },
  };
}

module.exports = {
  tradeReads,
  buildInviteDeps,
};
