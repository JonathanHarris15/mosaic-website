// The Membership Track (ADR-0012), server side.
//
// The Track is the single church-relationship state machine: a Person sits at
// exactly one Membership Stage, and the code projects that stage onto a set of
// immutable Membership Tags so the Track plugs into the tag filter system
// rather than a parallel one. The STAGE is the source of truth; the tags are
// its synced projection, written together and never edited independently.
//
// The canonical copy of all of this lives in public/shepherding-core.js. Cloud
// Functions deploy only the functions/ directory, so anything on the server
// that has to move a Person along the Track needs its own copy. This is that
// copy, in one place rather than scattered through the triggers that need it,
// and test/membership-track.test.js pins every table and both functions
// against the canonical ones so the two cannot drift.

// Ordered stages. The order IS the Track direction.
const MEMBERSHIP_STAGES = [
  "visitor",
  "regular_attender",
  "prospective_member",
  "member",
  "moving_membership",
  "previous_member",
];

// Tag identity is the tag name (ADR-0011), so a Membership Tag's id doubles as
// its display name. Moving Membership deliberately carries BOTH its own tag and
// 'Member', so "members = carries the Member tag" stays one query while still
// distinguishing those mid-transfer.
const MEMBERSHIP_STAGE_TAGS = {
  visitor: ["Visitor"],
  regular_attender: ["Regular Attender"],
  prospective_member: ["Prospective Member"],
  member: ["Member"],
  moving_membership: ["Moving Membership", "Member"],
  previous_member: ["Previous Member"],
};

const MEMBER_TAG_ID = "Member";
const INACTIVE_TAG_ID = "Inactive";

// Every code-defined Membership Tag id — the stage tags plus 'Inactive'. This
// is the exact set applyMembershipTags strips before re-projecting.
const MEMBERSHIP_TAG_IDS = [
  "Visitor",
  "Regular Attender",
  "Prospective Member",
  "Member",
  "Moving Membership",
  "Previous Member",
  "Inactive",
];
const MEMBERSHIP_TAG_ID_SET = new Set(MEMBERSHIP_TAG_IDS);

// The stage a Person must reach to count as a member.
const MEMBER_STAGE = "member";

// Someone who has left. Later on the Track than `member`, but emphatically not
// a member — which is why membership is asked of the projection, never of a
// stage's index.
const PREVIOUS_MEMBER_STAGE = "previous_member";

/**
 * Where a stage sits on the Track, or -1 if it is not a stage.
 * @param {?string} stage A Membership Stage id.
 * @return {number} Its index in MEMBERSHIP_STAGES.
 */
function stageIndex(stage) {
  return MEMBERSHIP_STAGES.indexOf(stage);
}

/**
 * The Membership Tag ids a Person's membership projects. Inactive wins and
 * yields ['Inactive'] regardless of any retained stage; a Person with no stage
 * (and not Inactive) projects none.
 * @param {?Object} membership The Person's `membership` block.
 * @return {Array<string>} A fresh array of tag ids.
 */
function membershipTagsFor(membership) {
  const m = membership || {};
  if (m.inactive) return [INACTIVE_TAG_ID];
  if (!m.stage || !MEMBERSHIP_STAGE_TAGS[m.stage]) return [];
  return MEMBERSHIP_STAGE_TAGS[m.stage].slice();
}

/**
 * Re-project a Person's `tags` for a membership: drop EVERY Membership Tag,
 * then append the ones the membership currently projects, preserving order and
 * all non-membership tags. Idempotent — the stage is the source of truth.
 * @param {?Array<string>} currentTags The Person's existing tags.
 * @param {?Object} membership The membership to project.
 * @return {Array<string>} The re-projected tag list.
 */
function applyMembershipTags(currentTags, membership) {
  const out = (currentTags || [])
      .filter((t) => !MEMBERSHIP_TAG_ID_SET.has(t));
  for (const t of membershipTagsFor(membership)) {
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * "Is this Person a current member?" — true iff the projection includes the
 * Member tag (stage member or moving_membership, and not Inactive), so callers
 * never have to special-case Moving Membership.
 * @param {?Object} membership The Person's `membership` block.
 * @return {boolean} True when they carry the Member tag by projection.
 */
function carriesMemberTag(membership) {
  return membershipTagsFor(membership).includes(MEMBER_TAG_ID);
}

module.exports = {
  MEMBERSHIP_STAGES,
  MEMBERSHIP_STAGE_TAGS,
  MEMBERSHIP_TAG_IDS,
  MEMBER_TAG_ID,
  INACTIVE_TAG_ID,
  MEMBER_STAGE,
  PREVIOUS_MEMBER_STAGE,
  stageIndex,
  membershipTagsFor,
  applyMembershipTags,
  carriesMemberTag,
};
