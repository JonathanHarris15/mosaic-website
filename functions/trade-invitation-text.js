/**
 * @fileoverview Texting a Trade invitee who has no account (MS-249). Pure:
 * whether to text, what the invitee sees on the Answer link, and the
 * wording. No Firestore, no send, no clock of its own.
 *
 * Somebody with no Linked User cannot answer in the app, so the only way an
 * invitation reaches them is a text carrying an Answer link. One text, no
 * reminder and no "never mind": a Trade dies with its date (CONTEXT.md,
 * Trade). Somebody with an account answers on Commitments instead.
 *
 * Trade states and liveness are read through trade-core, never restated.
 */

const Trade = require("./shared/trade-core.js");
const {isInsideSendWindow} = require("./notification-core");

const PURPOSE = "trade_invitation";
const WORDING = "invitation";

const DEFAULT_TEXT = "Hi {name}, {inviter} from Mosaic Church asked if " +
  "you could take their place: {role} at {event} on {date}. " +
  "Tap to answer: {link}";

/** What is written on a Trade about its invitation text. */
const TEXT_STATUS = Object.freeze({
  HELD: "held",
  SENT: "sent",
  FAILED: "failed",
  UNREACHABLE: "unreachable",
});

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/**
 * The parts of a Trade this module reads.
 * @typedef {{
 *   id?: string,
 *   origin?: string,
 *   state?: string,
 *   holderId?: string,
 *   counterpartyId?: string,
 *   assignment?: {date?: string, roleSlug?: string},
 *   eventName?: string,
 *   roleName?: ?string,
 *   closedBy?: ?string,
 *   closedBecause?: ?string,
 * }} TradeDoc
 */

/**
 * What the invitee sees. Nothing beyond these fields, ever.
 * @typedef {{
 *   status: string,
 *   inviterFirstName: string,
 *   eventName: string,
 *   roleName: string,
 *   dateLabel: string,
 *   canAnswer: Array<string>,
 * }} InviteeView
 */

/**
 * What textDecision is asked.
 * @typedef {{
 *   trade: TradeDoc,
 *   inviteeId?: string,
 *   inviteeHasLinkedUser: boolean,
 *   inviteeHasPhone: boolean,
 *   localHour: number,
 *   today: string,
 * }} DecisionArgs
 */

/**
 * Is this Trade an invitation still waiting on this Person?
 * @param {TradeDoc} trade
 * @param {string} inviteeId
 * @param {string} today church-local YYYY-MM-DD
 * @return {boolean}
 */
function waitingOnInvitee(trade, inviteeId, today) {
  if (!trade || trade.origin !== Trade.ORIGINS.INVITATION) return false;
  if (!Trade.isLive(trade, today)) return false;
  return Trade.waitingOn(trade) === inviteeId;
}

/**
 * Whether to text the invitee now.
 * `send` — text now. `held` — outside 8am–8pm; the hourly sweep sends it.
 * `unreachable` — no account and no phone. `none` — nothing to do.
 * @param {DecisionArgs} args
 * @return {string}
 */
function textDecision(args) {
  const inviteeId = args.inviteeId || args.trade.counterpartyId || "";
  if (!waitingOnInvitee(args.trade, inviteeId, args.today)) return "none";
  if (args.inviteeHasLinkedUser) return "none";
  if (!args.inviteeHasPhone) return TEXT_STATUS.UNREACHABLE;
  if (!isInsideSendWindow(args.localHour)) return TEXT_STATUS.HELD;
  return "send";
}

/**
 * The link dies with the Trade: the end of the Assignment's date.
 * @param {TradeDoc} trade
 * @return {string} YYYY-MM-DD
 */
function linkEndDate(trade) {
  return (trade.assignment && trade.assignment.date) || "";
}

/**
 * "Sunday 20 September".
 * @param {string} dateStr YYYY-MM-DD
 * @return {string}
 */
function longDate(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return "";
  const at = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[at.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

/**
 * The Role's name, or its slug when no name was stored.
 * @param {TradeDoc} trade
 * @return {string}
 */
function roleNameOf(trade) {
  return trade.roleName || (trade.assignment && trade.assignment.roleSlug) ||
    "";
}

/**
 * Where the invitation stands, from the invitee's side.
 * @param {TradeDoc} trade
 * @param {string} inviteeId
 * @param {string} today
 * @return {string} waiting, took, refused or ended
 */
function statusFor(trade, inviteeId, today) {
  if (waitingOnInvitee(trade, inviteeId, today)) return "waiting";
  const S = Trade.STATES;
  if (trade.state === S.SETTLED && trade.counterpartyId === inviteeId &&
      !trade.closedBecause) {
    return "took";
  }
  if (trade.state === S.REFUSED && trade.closedBy === inviteeId) {
    return "refused";
  }
  return "ended";
}

/**
 * What the Answer link shows. Never the roster, a surname, contact
 * details, other invitees, or anything the invitee could offer back.
 * @param {TradeDoc} trade
 * @param {{inviteeId: string, inviterFirstName: string, today: string}} ctx
 * @return {InviteeView}
 */
function inviteeView(trade, ctx) {
  const status = statusFor(trade, ctx.inviteeId, ctx.today);
  return {
    status: status,
    inviterFirstName: ctx.inviterFirstName || "Somebody",
    eventName: trade.eventName || "",
    roleName: roleNameOf(trade),
    dateLabel: longDate(linkEndDate(trade)),
    canAnswer: status === "waiting" ? ["take", "refuse"] : [],
  };
}

/**
 * The words a text fills in besides {name} and {link}.
 * @param {TradeDoc} trade
 * @param {{inviterFirstName: string}} ctx
 * @return {Object<string, string>}
 */
function requestValues(trade, ctx) {
  return {
    inviter: ctx.inviterFirstName || "Somebody",
    role: roleNameOf(trade),
    event: trade.eventName || "",
    date: longDate(linkEndDate(trade)),
  };
}

/**
 * What the send path is asked. Who, what and where — never push or text.
 * @param {TradeDoc} trade
 * @param {{inviteeId: string, inviterFirstName: string, url: string}} ctx
 * @return {Object<string, *>}
 */
function notifyRequest(trade, ctx) {
  return {
    personId: ctx.inviteeId,
    purpose: PURPOSE,
    wording: WORDING,
    url: ctx.url,
    expectReply: false,
    values: requestValues(trade, ctx),
  };
}

/**
 * The status written on the Trade, from what the send path returned.
 * @param {*} result tellPerson's outcome
 * @return {string}
 */
function statusFromSend(result) {
  if (result && result.skipped === "window") return TEXT_STATUS.HELD;
  if (result && result.accepted) return TEXT_STATUS.SENT;
  if (result && result.unreachable) return TEXT_STATUS.UNREACHABLE;
  return TEXT_STATUS.FAILED;
}

/**
 * Invitation wording in the shape the send path loads. A blank saved
 * wording uses the default; one without {link} gets it on its own line.
 * @param {?Object<string, *>} config app_config/prayer_request_sms
 * @return {Object<string, *>}
 */
function templatesForSendPath(config) {
  const c = config || {};
  const saved = typeof c.tradeInvitationText === "string" ?
    c.tradeInvitationText.trim() : "";
  let text = saved || DEFAULT_TEXT;
  if (text.indexOf("{link}") === -1) text = `${text}\n{link}`;
  // An invitee has no account, so the path always picks a text. The push
  // wording only keeps the shape whole.
  const push = {title: "{inviter} asked you", body: "{role} on {date}"};
  return {
    text: {[WORDING]: text},
    textFallback: {[WORDING]: DEFAULT_TEXT},
    push: {[WORDING]: push},
    pushFallback: {[WORDING]: push},
  };
}

module.exports = {
  TEXT_STATUS,
  textDecision,
  linkEndDate,
  inviteeView,
  notifyRequest,
  statusFromSend,
  templatesForSendPath,
};
