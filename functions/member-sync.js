// Pure decision logic for the add-only member-status sync between user accounts
// (users/{uid}) and directory people (people/{personId}). The two Firestore
// triggers in index.js wrap these decisions with reads/writes; the rules
// themselves — member-or-higher, add-only, never-demote, and the skip-write
// that stops the two triggers looping into each other — live here so they can
// be unit-tested in isolation.
//
// ADR-0026 changed what direction A DOES. It used to staple the "Member" tag
// onto the linked Person. Under the Membership Track (ADR-0012) that tag is a
// projection of the Person's Membership Stage, so writing it directly produced
// a Person whose stage said Visitor and whose tags said Member — and since the
// Membership Directory picks its Members tab off the tag, the directory and the
// Track disagreed about the same human. Direction A now moves the STAGE and
// lets the projection write the tag.

const track = require("./membership-track");

const MEMBER_OR_HIGHER = ["member", "editor", "elder", "admin", "super_admin"];

// The directory tag carried by people. Canonical casing is capital-M "Member" —
// that is what the directory and the Service Builder/Calendar member queries
// match on (tags array-contains "Member"). Older writes added a lowercase
// "member", which the frontend queries miss; presence is therefore matched
// case-insensitively so we never add a second variant beside an existing one.
const MEMBER_TAG = track.MEMBER_TAG_ID;

// The user-account permission level granted by the member tag. Levels are
// lowercase, so this is deliberately distinct from MEMBER_TAG: the two used to
// share one constant, which conflated a directory tag with a permission level.
const MEMBER_PERMISSION_LEVEL = "member";

/**
 * True when a permission level is "member" or any higher privilege.
 * @param {?string} permissionLevel The level to test.
 * @return {boolean} True for member and above.
 */
function isMemberOrHigher(permissionLevel) {
  return MEMBER_OR_HIGHER.includes(permissionLevel);
}

/**
 * True when the person already carries the member tag in any casing. Whole-tag,
 * case-insensitive match — so "Member" and a legacy "member" both count, but a
 * different tag that merely contains the word (e.g. "Former Member") does not.
 * @param {?Array<string>} personTags The Person's tags.
 * @return {boolean} True when a Member tag is present in any casing.
 */
function hasMemberTag(personTags) {
  const want = MEMBER_TAG.toLowerCase();
  return (personTags || []).some(
      (t) => typeof t === "string" && t.toLowerCase() === want);
}

/**
 * Direction A — should a linked user's permission level advance their Person
 * along the Membership Track to `member`?
 *
 * Add-only in the same sense the tag version was: this only ever moves someone
 * TOWARDS member, never back. Three cases refuse, and each is a deliberate
 * editor decision that an account's permission level has no business undoing:
 *
 *   • Already a member (stage member, or moving_membership — which projects the
 *     Member tag too). Refusing here is also the loop guard: once in sync the
 *     write is skipped, so the reciprocal trigger is never fired again.
 *   • Previous Member. They left. A login does not re-admit anyone, and note
 *     that this stage sits LATER on the Track than `member` — which is why
 *     membership is asked of the projection, never of a stage's index.
 *   • Inactive. Someone marked inactive stays inactive until an editor says
 *     otherwise; reactivating a person as a side effect of a role change is not
 *     a decision this trigger gets to make.
 *
 * A Person with no stage at all is placed at `member` — that is the case the
 * old tag-writing version was really serving.
 *
 * @param {?string} permissionLevel The linked user's permission level.
 * @param {?Object} membership The Person's `membership` block.
 * @return {boolean} True when the stage should move to `member`.
 */
function shouldAdvanceToMember(permissionLevel, membership) {
  if (!isMemberOrHigher(permissionLevel)) return false;

  const m = membership || {};
  if (m.inactive) return false;
  if (track.carriesMemberTag(m)) return false;
  if (m.stage === track.PREVIOUS_MEMBER_STAGE) return false;
  if (!m.stage) return true;

  return track.stageIndex(m.stage) < track.stageIndex(track.MEMBER_STAGE);
}

/**
 * The `people/{id}` field update that advances a Person to `member`. Dotted
 * paths so only the stage moves — joinedAt and the back-compat status field on
 * the membership object are preserved — and the tags are RE-PROJECTED from the
 * new stage rather than appended to, which is the whole point of ADR-0026.
 *
 * The caller adds `updatedAt` (a server timestamp is not a plain value).
 *
 * @param {?Array<string>} currentTags The Person's existing tags.
 * @return {Object} The update to apply.
 */
function memberAdvanceUpdate(currentTags) {
  const next = {stage: track.MEMBER_STAGE, inactive: false};
  return {
    "membership.stage": track.MEMBER_STAGE,
    "membership.inactive": false,
    "tags": track.applyMembershipTags(currentTags, next),
  };
}

/**
 * The Pastoral Record entry for that advance. An editor moving the stage slider
 * logs a Membership Change (ADR-0012); a stage moved by the account sync has to
 * log one too, or the record quietly credits the move to nobody. `authorUid` is
 * null because no human did it, and the explanation names what did.
 *
 * Mirrors buildMembershipChange in public/shepherding-core.js. The caller adds
 * `createdAt`.
 *
 * @param {?Object} previous The Person's membership before the move.
 * @param {?string} permissionLevel The permission level that caused it.
 * @return {Object} The shepherding_activity record.
 */
function buildMemberAdvanceRecord(previous, permissionLevel) {
  const p = previous || {};
  return {
    kind: "membership_change",
    previousStage: p.stage || null,
    newStage: track.MEMBER_STAGE,
    previousInactive: !!p.inactive,
    newInactive: false,
    authorUid: null,
    authorName: "Account sync",
    source: "account_sync",
    sourceDocumentId: null,
    explanation: "Their login was set to " +
      `'${permissionLevel}', which is member level or above.`,
  };
}

/**
 * Direction B — a person's member tag should promote the linked user iff the
 * user is currently below member. Never demotes; returns false when the user is
 * already member-or-higher, which also skips the write and avoids a loop.
 *
 * Still asked of the TAG rather than the stage, deliberately: after ADR-0026
 * the tag is a faithful projection of the stage, so it gives the same answer,
 * and it additionally still catches records the Track migration has not
 * reached, which carry a hand-applied Member tag and no stage.
 *
 * @param {?string} currentPermissionLevel The linked user's level.
 * @return {boolean} True when the user should be promoted to member.
 */
function shouldPromoteToMember(currentPermissionLevel) {
  return !isMemberOrHigher(currentPermissionLevel);
}

module.exports = {
  MEMBER_OR_HIGHER,
  MEMBER_TAG,
  MEMBER_PERMISSION_LEVEL,
  isMemberOrHigher,
  hasMemberTag,
  shouldAdvanceToMember,
  memberAdvanceUpdate,
  buildMemberAdvanceRecord,
  shouldPromoteToMember,
};
