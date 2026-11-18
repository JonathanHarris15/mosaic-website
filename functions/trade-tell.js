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

/** Why a message is owed. */
const KIND = Object.freeze({
  INVITED: "invited",
  OFFERED: "offered",
  ENDED: "ended",
});

const ENDED = [Trade.STATES.SETTLED, Trade.STATES.REFUSED,
  Trade.STATES.WITHDRAWN];

/**
 * A Person's first name, by their id.
 * @typedef {(personId: string) => string} NameOf
 */

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
    out = [{personId: after.counterpartyId, kind: KIND.INVITED, state: to}];
  } else if (to === Trade.STATES.OFFERED) {
    out = [{personId: after.holderId, kind: KIND.OFFERED, state: to}];
  } else if (ENDED.indexOf(to) !== -1 && ENDED.indexOf(from) === -1) {
    // Whoever ended it is never told their own news back; when nobody in
    // the conversation ended it, both parties hear (CONTEXT.md, Trade).
    // Keeping the place is the holder's own act even though the Trade
    // records no closer for it, so they are not told "You kept it".
    const actor = after.closedBy ||
      (after.closedBecause === Trade.CAUSES.KEPT ? after.holderId : null);
    out = [after.holderId, after.counterpartyId]
        .filter((id) => id && id !== actor &&
          Trade.needsTelling(after, id, ctx.today))
        .map((id) => ({personId: id, kind: KIND.ENDED, state: to}));
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
  // An ending they have already cleared from Commitments overnight is
  // not news any more.
  if (t.kind === KIND.ENDED) {
    return Trade.needsTelling(trade, t.personId, today);
  }
  return Trade.waitingOn(trade) === t.personId;
}

/**
 * The reader's own Commitments row, as a headline and a detail.
 * @param {*} trade
 * @param {string} personId the reader
 * @param {NameOf} nameOf
 * @return {{headline: string, detail: string}}
 */
function wordsFor(trade, personId, nameOf) {
  const w = View.wordingFor(trade, personId, nameOf);
  return {headline: w.headline, detail: w.detail};
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/**
 * "Sunday, November 22", or "" when there is no date.
 * @param {?string} dateStr YYYY-MM-DD
 * @return {string}
 */
function longDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(day.getTime())) return "";
  return `${WEEKDAYS[day.getUTCDay()]}, ${MONTHS[day.getUTCMonth()]} ${
    day.getUTCDate()}`;
}

/**
 * "Sound on Sunday, November 22".
 * @param {*} trade
 * @return {string}
 */
function placeWords(trade) {
  const a = (trade && trade.assignment) || {};
  const role = (trade && trade.roleName) || a.roleSlug || "service role";
  const date = longDate(a.date);
  return date ? `${role} on ${date}` : role;
}

/**
 * The text for a place taken with nothing asked in return — from the
 * cover list, or as the reply to an invitation.
 * @param {string} takerName
 * @param {*} trade a Trade, or anything with assignment and roleName
 * @return {string}
 */
function takenText(takerName, trade) {
  return `${takerName || "Somebody"} has taken your ${placeWords(trade)} ` +
    "without asking for anything in return. Make sure to thank them!";
}

/**
 * The text a message carries. The three the church wrote its own words
 * for — an invitation, an offer, and a place taken for nothing — use them;
 * everything else says the reader's own Commitments row.
 * @param {*} trade
 * @param {Tell} t
 * @param {{headline: string, detail: string}} words
 * @param {NameOf} fullNameOf
 * @param {string} url
 * @return {string}
 */
function textFor(trade, t, words, fullNameOf, url) {
  if (t.kind === KIND.INVITED) {
    return `${fullNameOf(trade.holderId)} has asked you to trade service ` +
      `roles with them. See the trade here: ${url}`;
  }
  if (t.kind === KIND.OFFERED) {
    return `${fullNameOf(trade.counterpartyId)} has sent you a trade offer ` +
      `for the ${placeWords(trade)} service role. See it here: ${url}`;
  }
  if (t.kind === KIND.ENDED && trade.state === Trade.STATES.SETTLED &&
      !trade.chosen && t.personId === trade.holderId) {
    return takenText(fullNameOf(trade.counterpartyId), trade);
  }
  return `${words.headline}. ${words.detail} ${url}`;
}

/**
 * What the send path is asked. Who, what and where — never push or text.
 * @param {Tell} t
 * @param {{headline: string, detail: string}} words
 * @param {string} origin the site Commitments lives on
 * @param {*} [trade] the Trade, for the church's own sentences
 * @param {NameOf} [fullNameOf] full names, for the same
 * @return {Object<string, *>}
 */
function notifyRequest(t, words, origin, trade, fullNameOf) {
  const url = `${origin}/commitments.html`;
  const names = fullNameOf || (() => "Somebody");
  return {
    personId: t.personId,
    purpose: PURPOSE,
    wording: WORDING,
    url: url,
    expectReply: false,
    values: {
      headline: words.headline,
      detail: words.detail,
      message: trade ? textFor(trade, t, words, names, url) :
        `${words.headline}. ${words.detail} ${url}`,
    },
  };
}

/**
 * The words in the shape the send path loads. Not editable: they are the
 * Commitments row's own sentences, and a second set would drift.
 * @return {Object<string, *>}
 */
function templatesForSendPath() {
  // The whole sentence is built in textFor, link and all: one of them
  // ends without a link, so the template cannot add one.
  const text = "{message}";
  const push = {title: "{headline}", body: "{detail}"};
  return {
    text: {[WORDING]: text},
    textFallback: {[WORDING]: text},
    push: {[WORDING]: push},
    pushFallback: {[WORDING]: push},
  };
}

module.exports = {
  takenText,
  tellsFor,
  recordId,
  stillTrue,
  wordsFor,
  notifyRequest,
  templatesForSendPath,
};
