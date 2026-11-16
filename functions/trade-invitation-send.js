/**
 * @fileoverview Texting a Trade invitee who has no account (MS-249). Thin:
 * it reads the Trade and the two people, asks the invitation rules, mints an
 * Answer link, sends through the one send path, and writes the text status
 * on the Trade. No rule of its own.
 *
 * `tellInvitee` runs right after an invitation is written, and again from
 * the hourly sweep for a text held overnight. It never throws: a text that
 * did not go must not undo the invitation.
 */

const {
  textDecision,
  linkEndDate,
  notifyRequest,
  statusFromSend,
  TEXT_STATUS,
} = require("./trade-invitation-text");

/** @typedef {import("./trade-invitation-text").TradeDoc} TradeDoc */

/**
 * Who a Person is to the send path.
 * @typedef {{uid?: ?string, phone?: string, firstName?: string}} PersonInfo
 */

/**
 * The text status written on a Trade, or null to clear it.
 * @typedef {?{status: string, at: *}} TextStatus
 */

/**
 * Everything a run needs, passed in.
 * @typedef {{
 *   churchNow: () => {date: string, hour: number},
 *   now?: () => *,
 *   log?: (message: string) => void,
 *   tellPerson: (deps: *, request: Object<string, *>) => Promise<*>,
 *   notifierDeps: *,
 *   loadTrade: (id: string) => Promise<?TradeDoc>,
 *   loadPerson: (id: string) => Promise<?PersonInfo>,
 *   mintLink: (args: {personId: string, tradeId: string, endDate: string})
 *     => Promise<string>,
 *   writeStatus: (id: string, status: TextStatus) => Promise<void>,
 *   loadHeldTradeIds: () => Promise<Array<string>>,
 * }} InviteDeps
 */

/**
 * @param {InviteDeps} deps
 * @param {string} status
 * @return {TextStatus}
 */
function stamped(deps, status) {
  return {status: status, at: deps.now ? deps.now() : new Date()};
}

/**
 * Text the person a Trade invites, if they should be texted now.
 * @param {InviteDeps} deps
 * @param {string} tradeId
 * @return {Promise<string>} what happened: none, held, unreachable, sent,
 *   failed, or cleared (a held text whose Trade has ended)
 */
async function tellInvitee(deps, tradeId) {
  try {
    const trade = await deps.loadTrade(tradeId);
    if (!trade) return "none";
    const inviteeId = trade.counterpartyId || "";
    const invitee = (await deps.loadPerson(inviteeId)) || {};
    const clock = deps.churchNow();
    const decision = textDecision({
      trade: trade,
      inviteeId: inviteeId,
      inviteeHasLinkedUser: !!invitee.uid,
      inviteeHasPhone: !!invitee.phone,
      localHour: clock.hour,
      today: clock.date,
    });

    if (decision === "none") {
      // A held text whose Trade has ended goes nowhere, and stops being
      // looked at.
      const held = trade.invitationText;
      if (held && held.status === TEXT_STATUS.HELD) {
        await deps.writeStatus(tradeId, null);
        return "cleared";
      }
      return "none";
    }
    if (decision !== "send") {
      await deps.writeStatus(tradeId, stamped(deps, decision));
      return decision;
    }

    const holder = (await deps.loadPerson(trade.holderId || "")) || {};
    const url = await deps.mintLink({
      personId: inviteeId,
      tradeId: tradeId,
      endDate: linkEndDate(trade),
    });
    const result = await deps.tellPerson(deps.notifierDeps, notifyRequest(
        trade, {
          inviteeId: inviteeId,
          holderFirstName: holder.firstName || "",
          url: url,
        }));
    const status = statusFromSend(result);
    await deps.writeStatus(tradeId, stamped(deps, status));
    return status;
  } catch (err) {
    if (deps.log) deps.log(`Trade invitation text for ${tradeId}: ${err}`);
    try {
      await deps.writeStatus(tradeId, stamped(deps, TEXT_STATUS.FAILED));
    } catch (e) {
      // Nothing more to do; the invitation itself stands.
    }
    return TEXT_STATUS.FAILED;
  }
}

/**
 * The hourly sweep: send every text held overnight that can now go.
 * @param {InviteDeps} deps
 * @return {Promise<number>} how many were sent
 */
async function sweepHeldInvitations(deps) {
  const ids = await deps.loadHeldTradeIds();
  let sent = 0;
  for (const id of ids) {
    if (await tellInvitee(deps, id) === TEXT_STATUS.SENT) sent += 1;
  }
  return sent;
}

module.exports = {
  tellInvitee,
  sweepHeldInvitations,
};
