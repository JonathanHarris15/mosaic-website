const { test } = require('node:test');
const assert = require('node:assert');

const Groups = require('../public/relationship-group-core.js');

const STEPHEN = 'stephen', TIM = 'tim', CARTER = 'carter', NATHAN = 'nathan';

// A Prioritized Group type: one leader plus a roster of members.
const bibleStudyType = {
    id: 'bs', name: 'Bible Study', kind: 'group', priority: true,
    leaderLabel: 'Leader', memberLabel: 'Member',
};
// A Non-Prioritized Group type: a flat roster, no leader.
const prayerCircleType = {
    id: 'pc', name: 'Prayer Circle', kind: 'group', priority: false,
    label: 'Participant',
};

const tuesdayStudy = () => ({
    id: 'g1', typeId: 'bs', name: 'Tuesday Bible Study',
    leaderId: STEPHEN, memberIds: [TIM, CARTER],
});
const thursdayPrayer = () => ({
    id: 'g2', typeId: 'pc', name: 'Thursday Prayer',
    leaderId: null, memberIds: [CARTER, NATHAN],
});

// ── Roster operations (immutable) ─────────────────────────────────────────────

test('addMember appends a Person to the roster without mutating the original group', () => {
    const before = tuesdayStudy();
    const after = Groups.addMember(before, NATHAN);
    assert.deepStrictEqual(after.memberIds, [TIM, CARTER, NATHAN]);
    assert.deepStrictEqual(before.memberIds, [TIM, CARTER]); // untouched
});

test('addMember is idempotent — a Person already in the roster is not duplicated', () => {
    const after = Groups.addMember(tuesdayStudy(), TIM);
    assert.deepStrictEqual(after.memberIds, [TIM, CARTER]);
});

test('addMember does not demote the leader into the member roster', () => {
    // A Person occupies at most one slot in a group: leader OR member, never both.
    const after = Groups.addMember(tuesdayStudy(), STEPHEN);
    assert.strictEqual(after.leaderId, STEPHEN);
    assert.deepStrictEqual(after.memberIds, [TIM, CARTER]);
});

test('removeMember pulls a Person from the roster and leaves the rest in order', () => {
    const after = Groups.removeMember(tuesdayStudy(), TIM);
    assert.deepStrictEqual(after.memberIds, [CARTER]);
    assert.strictEqual(after.leaderId, STEPHEN);
});

test('setLeader promotes a Person, pulling them out of the member roster', () => {
    const after = Groups.setLeader(tuesdayStudy(), TIM);
    assert.strictEqual(after.leaderId, TIM);
    assert.deepStrictEqual(after.memberIds, [CARTER]); // no longer also a member
});

test('setLeader replaces the sitting leader — a group has at most one', () => {
    const after = Groups.setLeader(tuesdayStudy(), NATHAN);
    assert.strictEqual(after.leaderId, NATHAN);
    assert.deepStrictEqual(after.memberIds, [TIM, CARTER]); // Stephen simply steps down
});

test('clearLeader leaves the group leaderless but intact — a valid resting state', () => {
    const after = Groups.clearLeader(tuesdayStudy());
    assert.strictEqual(after.leaderId, null);
    assert.deepStrictEqual(after.memberIds, [TIM, CARTER]);
    assert.strictEqual(Groups.validateGroup(after, bibleStudyType).valid, true);
});

// ── Valid resting states ──────────────────────────────────────────────────────

test('a freshly created group with no leader and no members is valid', () => {
    const empty = { id: 'g3', typeId: 'bs', name: 'New Study', leaderId: null, memberIds: [] };
    assert.strictEqual(Groups.validateGroup(empty, bibleStudyType).valid, true);
    assert.deepStrictEqual(Groups.rosterIds(empty), []);
});

test('validateGroup rejects a group with no name, and a leader on a Non-Prioritized type', () => {
    const unnamed = { typeId: 'bs', name: '', leaderId: null, memberIds: [] };
    assert.strictEqual(Groups.validateGroup(unnamed, bibleStudyType).valid, false);

    // A Non-Prioritized Group is a flat roster — nobody holds priority, so nobody leads.
    const bogus = { typeId: 'pc', name: 'Thursday Prayer', leaderId: CARTER, memberIds: [NATHAN] };
    assert.strictEqual(Groups.validateGroup(bogus, prayerCircleType).valid, false);
});

// ── Membership queries ────────────────────────────────────────────────────────

test('the roster is the leader plus the members — the leader belongs to the group', () => {
    const g = tuesdayStudy();
    assert.deepStrictEqual(Groups.rosterIds(g), [STEPHEN, TIM, CARTER]);
    assert.strictEqual(Groups.isLeader(g, STEPHEN), true);
    assert.strictEqual(Groups.isMember(g, TIM), true);
    assert.strictEqual(Groups.isMember(g, STEPHEN), false); // he leads, he is not a member
    assert.strictEqual(Groups.belongsTo(g, STEPHEN), true);
    assert.strictEqual(Groups.belongsTo(g, NATHAN), false);
});

test('groupsForPerson returns exactly the groups a Person belongs to, leading or not', () => {
    const all = [tuesdayStudy(), thursdayPrayer()];
    assert.deepStrictEqual(Groups.groupsForPerson(all, STEPHEN).map(g => g.id), ['g1']); // leads
    assert.deepStrictEqual(Groups.groupsForPerson(all, CARTER).map(g => g.id), ['g1', 'g2']); // both
    assert.deepStrictEqual(Groups.groupsForPerson(all, NATHAN).map(g => g.id), ['g2']);
    assert.deepStrictEqual(Groups.groupsForPerson(all, 'nobody'), []);
});

// ── The viewer's hull descriptor (ADR-0014 §5) ────────────────────────────────

test('hullDescriptor carries the group name, type, leader and members for the Relations Viewer', () => {
    const hull = Groups.hullDescriptor(tuesdayStudy(), '#c2410c');
    assert.deepStrictEqual(hull, {
        id: 'g1',
        name: 'Tuesday Bible Study',
        typeId: 'bs',
        colour: '#c2410c',
        leaderId: STEPHEN,
        memberIds: [TIM, CARTER],
    });
});

test('a leaderless group yields a hull with no leader, so the viewer draws no leader line', () => {
    const hull = Groups.hullDescriptor(thursdayPrayer(), '#0e7490');
    assert.strictEqual(hull.leaderId, null);
    assert.deepStrictEqual(hull.memberIds, [CARTER, NATHAN]);
});

// ── Person delete / merge cascade (ADR-0014 §7) ───────────────────────────────

test('removePersonEverywhere pulls a Person from every roster and vacates any leader slot', () => {
    const all = [tuesdayStudy(), thursdayPrayer()];
    const after = Groups.removePersonEverywhere(all, CARTER);
    assert.deepStrictEqual(after[0].memberIds, [TIM]);
    assert.deepStrictEqual(after[1].memberIds, [NATHAN]);
    assert.strictEqual(after[0].leaderId, STEPHEN); // untouched

    const afterLeaderGone = Groups.removePersonEverywhere(all, STEPHEN);
    assert.strictEqual(afterLeaderGone[0].leaderId, null); // leader slot vacated, group survives
    assert.deepStrictEqual(afterLeaderGone[0].memberIds, [TIM, CARTER]);
});
