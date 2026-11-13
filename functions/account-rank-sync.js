// Pure decision logic for the Person account-rank projection (MS-554 /
// MS-539). The Trade picker can read People and cannot read other `users`
// docs (own-only). Invite-relevant rank is therefore denormalized onto the
// Person as `accountRank`, matching server `rankOf`: the derived account
// rank from accountLevelId and the permissions map.
//
// Exact sync, like the Elder Tag: written on link and permission change,
// cleared on unlink. The Firestore trigger in index.js wraps these
// decisions with reads/writes; skip-write when already correct so the
// people-onWrite member sync does not loop.

/** Field name on `people/{id}`. */
const AccountLevels = require("./shared/account-levels-core");

const ACCOUNT_RANK_FIELD = "accountRank";

/**
 * Invite-relevant rank of a User document, matching server `rankOf`.
 * @param {?Object} user the users/{uid} data, or null
 * @return {?string} the derived rank, or null when there is no user
 */
function rankFromUser(user) {
  if (!user || typeof user !== "object") return null;
  return AccountLevels.accessRank(user);
}

/**
 * What `people.accountRank` should be, given the Person's live link.
 * No Linked User means no rank — even if a User doc was handed in.
 * @param {?string} userId people.userId
 * @param {?Object} user the linked users/{uid} data, or null
 * @return {?string} the projected rank, or null
 */
function projectedAccountRank(userId, user) {
  if (!userId) return null;
  return rankFromUser(user);
}

/**
 * Should the trigger write? Iff the stored field is not already the
 * projection. The equality check is the skip-write that stops a loop.
 * @param {?string} current people.accountRank as stored
 * @param {?string} next the projection
 * @return {boolean}
 */
function accountRankNeedsWrite(current, next) {
  return (current || null) !== (next || null);
}

/**
 * The next field value and whether a write is required.
 * @param {?Object} person the people/{id} data, or null
 * @param {?Object} user the linked users/{uid} data, or null
 * @return {{next: ?string, needsWrite: boolean}}
 */
function planPersonProjection(person, user) {
  const next = projectedAccountRank(person && person.userId, user);
  const current = person && person.accountRank;
  return {
    next: next,
    needsWrite: accountRankNeedsWrite(current, next),
  };
}

/**
 * Which Person ids a `users/{uid}` write must reconcile.
 * After (the live link) first; the previous Person if the link moved
 * or was cleared.
 * @param {?Object} before users/{uid} data before the write, or null
 * @param {?Object} after users/{uid} data after the write, or null
 * @return {Array<string>}
 */
function personIdsToReconcile(before, after) {
  const beforePersonId = before && before.personId;
  const afterPersonId = after && after.personId;
  const ids = [];
  if (afterPersonId) ids.push(afterPersonId);
  if (beforePersonId && beforePersonId !== afterPersonId) {
    ids.push(beforePersonId);
  }
  return ids;
}

module.exports = {
  ACCOUNT_RANK_FIELD,
  rankFromUser,
  projectedAccountRank,
  accountRankNeedsWrite,
  planPersonProjection,
  personIdsToReconcile,
};
