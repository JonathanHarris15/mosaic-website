/**
 * @fileoverview Telling somebody with an account when a Trade needs them or
 * ends (MS-824). Pure: who is owed a message for a change, whether a held
 * one is still true, and the words. No Firestore, no send, no clock.
 *
 * Every message is a thin layer over Commitments (CONTEXT.md, Commitment):
 * it says the sentence the reader's own row says, and lands them there.
 * Somebody with no Linked User is never told here; their invitation is
 * MS-249's one text, and nothing follows it.
 */

const Trade = require("./shared/trade-core.js");
const View = require("./shared/trades-view.js");

const PURPOSE = "trade_update";
const WORDING = "trade";

const ENDED = [Trade.STATES.SETTLED, Trade.STATES.REFUSED,
  Trade.STATES.WITHDRAWN];

/**
 * One message owed: to whom, why, and the state it is about.
 * @typedef {{personId: string, kind: string, state: string}} Tell
 */

/**
 * @param {*} trade
 * @param {string} today church-local YYYY-MM-DD
 * @return {boolean}
 */
function datePassed(trade, today) {
  const date = trade && trade.assignment && trade.assignment.date;
  return !date || date < today;
}

/**
 * Who is owed a message because a Trade changed.
 * @param {*} before the Trade before the write, or null
 * @param {*} after the Trade after the write, or null when deleted
 * @param {{today: string, linked: Set<string>}} ctx linked holds the
 *   parties who have a Linked User
 * @return {Array<Tell>}
 */
function tellsFor(before, after, ctx) {
  if (!after || datePassed(after, ctx.today)) return [];
  const from = before ? before.state : null;
  const to = after.state;
  if (from === to) return [];

  /** @type {Array<Tell>} */
  let out = [];
  if (to === Trade.STATES.INVITED) {
    out = [{personId: after.counterpartyId, kind: "invited", state: to}];
  } else if (to === Trade.STATES.OFFERED) {
    out = [{personId: after.holderId, kind: "offered", state: to}];
  } else if (ENDED.indexOf(to) !== -1 && ENDED.indexOf(from) === -1) {
    // Whoever ended it is never told their own news back; when nobody in
    // the conversation ended it, both parties hear (CONTEXT.md, Trade).
    out = [after.holderId, after.counterpartyId]
        .filter((id) => id && id !== after.closedBy)
        .map((id) => ({personId: id, kind: "ended", state: to}));
  }
  return out.filter((t) => t.personId && ctx.linked.has(t.personId));
}

/**
 * One record per Trade, state and Person, so a trigger that fires twice
 * sends once.
 * @param {string} tradeId
 * @param {{personId: string, state: string}} t
 * @return {string}
 */
function recordId(tradeId, t) {
  return `${tradeId}__${t.state}__${t.personId}`;
}

/**
 * Whether a message held overnight is still true: the Trade has not moved,
 * its date has not passed, and an invitation or offer still waits on them.
 * @param {*} trade the Trade now, or null when gone
 * @param {Tell} t
 * @param {string} today
 * @return {boolean}
 */
function stillTrue(trade, t, today) {
  if (!trade || trade.state !== t.state || datePassed(trade, today)) {
    return false;
  }
  if (t.kind === "ended") return true;
  return Trade.waitingOn(trade) === t.personId;
}

/**
 * The reader's own Commitments row, as a headline and a detail.
 * @param {*} trade
 * @param {string} personId the reader
 * @param {function(string): string} nameOf
 * @return {{headline: string, detail: string}}
 */
function wordsFor(trade, personId, nameOf) {
  const w = View.wordingFor(trade, personId, nameOf);
  return {headline: w.headline, detail: w.detail};
}

/**
 * What the send path is asked. Who, what and where — never push or text.
 * @param {Tell} t
 * @param {{headline: string, detail: string}} words
 * @param {string} origin the site Commitments lives on
 * @return {Object<string, *>}
 */
function notifyRequest(t, words, origin) {
  return {
    personId: t.personId,
    purpose: PURPOSE,
    wording: WORDING,
    url: `${origin}/commitments.html`,
    expectReply: false,
    values: {headline: words.headline, detail: words.detail},
  };
}

/**
 * The words in the shape the send path loads. Not editable: they are the
 * Commitments row's own sentences, and a second set would drift.
 * @return {Object<string, *>}
 */
function templatesForSendPath() {
  const text = "{headline}. {detail} {link}";
  const push = {title: "{headline}", body: "{detail}"};
  return {
    text: {[WORDING]: text},
    textFallback: {[WORDING]: text},
    push: {[WORDING]: push},
    pushFallback: {[WORDING]: push},
  };
}

module.exports = {
  tellsFor,
  recordId,
  stillTrue,
  wordsFor,
  notifyRequest,
  templatesForSendPath,
};
