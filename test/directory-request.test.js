const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/directory-request-core.js');
const Server = require('../functions/directory-request.js');
const Shepherding = require('../public/shepherding-core.js');

// A Directory Request (ADR-0025, ADR-0027) is anything a person asks the church
// to change about their own record: connect me to a record, add me to the
// directory, fix my name's spelling, record my household. Four kinds, one
// queue, resolved by an editor or above. The client decides what may be ASKED;
// the Cloud Function decides what approval DOES. These pin both halves, and the
// duplicated vocabulary between them.

// ── The two halves must speak the same language ──────────────────────────────

test('client and server agree on the status vocabulary', () => {
    assert.deepStrictEqual(Core.STATUS, Server.STATUS);
});

test('client and server agree on the request kinds', () => {
    assert.deepStrictEqual(Core.KIND, Server.KIND);
    assert.deepStrictEqual(Core.KINDS, Server.KINDS);
});

test('client and server agree on who may resolve a request', () => {
    assert.deepStrictEqual(Core.RESOLVER_LEVELS, Server.RESOLVER_LEVELS);
});

test('a new Person starts at the first Membership Stage with that stage\'s tags', () => {
    assert.strictEqual(Server.INITIAL_STAGE, Shepherding.MEMBERSHIP_STAGES[0]);
    assert.deepStrictEqual(
        Server.INITIAL_STAGE_TAGS,
        Shepherding.membershipTagsFor({ stage: Server.INITIAL_STAGE, inactive: false })
    );
});

test('the family relations offered are exactly the ones the planners accept', () => {
    const FamilyPlan = require('../functions/family-plan.js');
    assert.deepStrictEqual(Core.FAMILY_RELATIONS, FamilyPlan.KINDS);
});

// ── Who may ask what ─────────────────────────────────────────────────────────

test('editors, elders and admins may resolve; members and viewers may not', () => {
    for (const level of ['editor', 'elder', 'admin', 'super_admin']) {
        assert.ok(Core.canResolve(level), level);
        assert.ok(Server.canResolve(level), level);
    }
    for (const level of ['member', 'viewer', '', null, undefined]) {
        assert.ok(!Core.canResolve(level), String(level));
        assert.ok(!Server.canResolve(level), String(level));
    }
});

test('a link request needs you to be unlinked; a name fix and a family change need the opposite', () => {
    const unlinked = { email: 'a@b.com' };
    const linked = { email: 'a@b.com', personId: 'p1' };

    assert.ok(Core.canRequest(unlinked, Core.KIND.LINK_MATCH));
    assert.ok(Core.canRequest(unlinked, Core.KIND.LINK_NEW));
    assert.ok(!Core.canRequest(unlinked, Core.KIND.NAME_FIX));
    assert.ok(!Core.canRequest(unlinked, Core.KIND.FAMILY));

    assert.ok(!Core.canRequest(linked, Core.KIND.LINK_MATCH));
    assert.ok(Core.canRequest(linked, Core.KIND.NAME_FIX));
    assert.ok(Core.canRequest(linked, Core.KIND.FAMILY));
});

// ── Request ids are namespaced, which the security rules rely on ─────────────

test('every request id begins with the uid, whatever the kind', () => {
    const uid = 'abc123';
    for (const kind of Core.KINDS) {
        const id = Core.requestId(uid, kind, { op: 'add', relation: 'spouse', otherId: 'p9' });
        assert.ok(id.startsWith(uid + '_'), `${kind} produced ${id}`);
    }
});

test('link and name-fix ids are fixed per kind, so a second ask overwrites the first', () => {
    assert.strictEqual(Core.requestId('u1', Core.KIND.LINK_MATCH), 'u1_link_match');
    assert.strictEqual(Core.requestId('u1', Core.KIND.NAME_FIX), 'u1_name_fix');
    assert.strictEqual(
        Core.requestId('u1', Core.KIND.NAME_FIX), Core.requestId('u1', Core.KIND.NAME_FIX));
});

test('family ids carry the relation, so a spouse and two children can be asked at once', () => {
    const spouse = Core.requestId('u1', Core.KIND.FAMILY, { op: 'add', relation: 'spouse', otherId: 'p2' });
    const kidA = Core.requestId('u1', Core.KIND.FAMILY, { op: 'add', relation: 'child', otherId: 'p3' });
    const kidB = Core.requestId('u1', Core.KIND.FAMILY, { op: 'add', relation: 'child', otherId: 'p4' });
    assert.notStrictEqual(spouse, kidA);
    assert.notStrictEqual(kidA, kidB);
    // …but the same relation asked twice still overwrites rather than piling up.
    assert.strictEqual(
        kidA, Core.requestId('u1', Core.KIND.FAMILY, { op: 'add', relation: 'child', otherId: 'p3' }));
});

test('adding and removing the same relation are different requests', () => {
    const add = Core.requestId('u1', Core.KIND.FAMILY, { op: 'add', relation: 'child', otherId: 'p3' });
    const remove = Core.requestId('u1', Core.KIND.FAMILY, { op: 'remove', relation: 'child', otherId: 'p3' });
    assert.notStrictEqual(add, remove);
});

// ── Validation ───────────────────────────────────────────────────────────────

test('a link_match must name a person; a link_new must carry a name', () => {
    assert.ok(!Core.validateDraft({ uid: 'u1', kind: 'link_match' }).ok);
    assert.ok(Core.validateDraft({ uid: 'u1', kind: 'link_match', personId: 'p1' }).ok);
    assert.ok(!Core.validateDraft({ uid: 'u1', kind: 'link_new', proposed: { name: '  ' } }).ok);
    assert.ok(Core.validateDraft({ uid: 'u1', kind: 'link_new', proposed: { name: 'Jane' } }).ok);
});

test('a name fix must change something', () => {
    const same = Core.validateDraft({
        uid: 'u1', kind: 'name_fix', personId: 'p1',
        currentName: 'Jane Doe', proposed: { name: ' Jane Doe ' },
    });
    assert.ok(!same.ok);
    assert.match(same.error, /already have/);

    assert.ok(Core.validateDraft({
        uid: 'u1', kind: 'name_fix', personId: 'p1',
        currentName: 'Jane Doe', proposed: { name: 'Jayne Doe' },
    }).ok);
});

test('a name fix from an unlinked account is refused', () => {
    const bad = Core.validateDraft({ uid: 'u1', kind: 'name_fix', proposed: { name: 'Jayne' } });
    assert.ok(!bad.ok);
    assert.match(bad.error, /not connected/);
});

test('a family request needs an op, a relation and someone who is not you', () => {
    const base = { uid: 'u1', kind: 'family', personId: 'p1' };
    assert.ok(!Core.validateDraft(Object.assign({}, base, { family: { relation: 'spouse', otherId: 'p2' } })).ok);
    assert.ok(!Core.validateDraft(Object.assign({}, base, { family: { op: 'add', otherId: 'p2' } })).ok);
    assert.ok(!Core.validateDraft(Object.assign({}, base, { family: { op: 'add', relation: 'cousin', otherId: 'p2' } })).ok);
    assert.ok(!Core.validateDraft(Object.assign({}, base, { family: { op: 'add', relation: 'spouse' } })).ok);

    const self = Core.validateDraft(Object.assign({}, base, { family: { op: 'add', relation: 'spouse', otherId: 'p1' } }));
    assert.ok(!self.ok);
    assert.match(self.error, /your own/);

    assert.ok(Core.validateDraft(Object.assign({}, base, { family: { op: 'add', relation: 'spouse', otherId: 'p2' } })).ok);
});

test('an unknown kind is refused', () => {
    assert.ok(!Core.validateDraft({ uid: 'u1', kind: 'become_pope' }).ok);
});

// ── Building ─────────────────────────────────────────────────────────────────

test('a name fix carries the person and the proposal, and no family block', () => {
    const req = Core.buildRequest({
        uid: 'u1', email: 'j@e.com', kind: 'name_fix', personId: 'p1',
        currentName: 'Jane Doe', proposed: { name: ' Jayne Doe ' },
    });
    assert.strictEqual(req.personId, 'p1');
    assert.strictEqual(req.proposed.name, 'Jayne Doe');
    assert.strictEqual(req.family, null);
    assert.strictEqual(req.status, 'pending');
});

test('a family request carries the relation, and no proposal', () => {
    const req = Core.buildRequest({
        uid: 'u1', email: 'j@e.com', kind: 'family', personId: 'p1',
        family: { op: 'add', relation: 'child', otherId: 'p3' },
    });
    assert.deepStrictEqual(req.family, { op: 'add', relation: 'child', otherId: 'p3' });
    assert.strictEqual(req.proposed, null);
});

test('a proposal never carries tags, a stage, or anything shepherding', () => {
    const proposed = Core.normalizeProposed({
        name: 'Jane', tags: ['Member'], membership: { stage: 'member' }, shepherdingStatus: 'urgent',
    });
    assert.deepStrictEqual(Object.keys(proposed).sort(), ['birthday', 'contact', 'name', 'sex']);
});

// ── Describing ───────────────────────────────────────────────────────────────

const nameOf = id => ({ p1: 'Jane Doe', p2: 'John Doe', p3: 'Sam Doe' }[id] || null);

test('each kind reads as a sentence in the approver inbox', () => {
    const link = Core.buildRequest({ uid: 'u1', email: 'j@e.com', kind: 'link_match', personId: 'p1' });
    assert.match(Core.summarize(link, nameOf), /says they are Jane Doe/);

    const fix = Core.buildRequest({
        uid: 'u1', email: 'j@e.com', kind: 'name_fix', personId: 'p1',
        currentName: 'Jane Doe', proposed: { name: 'Jayne Doe' },
    });
    assert.match(Core.summarize(fix, nameOf), /Jane Doe asks to be spelt “Jayne Doe”/);

    const add = Core.buildRequest({
        uid: 'u1', email: 'j@e.com', kind: 'family', personId: 'p1',
        family: { op: 'add', relation: 'spouse', otherId: 'p2' },
    });
    assert.match(Core.summarize(add, nameOf), /Jane Doe asks to record John Doe as their spouse/);

    const remove = Core.buildRequest({
        uid: 'u1', email: 'j@e.com', kind: 'family', personId: 'p1',
        family: { op: 'remove', relation: 'child', otherId: 'p3' },
    });
    assert.match(Core.summarize(remove, nameOf), /asks to remove Sam Doe as their child/);
});

test('a request whose person vanished still renders rather than blanking', () => {
    const link = Core.buildRequest({ uid: 'u1', email: 'j@e.com', kind: 'link_match', personId: 'gone' });
    assert.match(Core.summarize(link, nameOf), /no longer exists/);
});

test('a declined request tells the requester why', () => {
    const req = Object.assign(
        Core.buildRequest({ uid: 'u1', email: 'j@e.com', kind: 'link_new', proposed: { name: 'Jane' } }),
        { status: 'declined', declineReason: 'We already have you as Jane Smith.' }
    );
    assert.match(Core.statusMessage(req, nameOf), /Jane Smith/);
});

// ── Approving a link ─────────────────────────────────────────────────────────

const matchRequest = { uid: 'u1', kind: 'link_match', personId: 'p1', status: 'pending' };
const newRequest = { uid: 'u1', kind: 'link_new', personId: null, status: 'pending', proposed: { name: 'Jane Doe' } };

test('approving a match links the named person', () => {
    const plan = Server.planApproval(matchRequest, {
        requesterPersonId: null, target: { exists: true, userId: null },
    });
    assert.deepStrictEqual(plan, { action: 'link', personId: 'p1', reason: null });
});

test('approving a new request creates a person', () => {
    assert.strictEqual(Server.planApproval(newRequest, { requesterPersonId: null }).action, 'create');
});

test('an approver may redirect a new request onto an existing record', () => {
    const plan = Server.planApproval(newRequest, {
        requesterPersonId: null, overridePersonId: 'p9', target: { exists: true, userId: null },
    });
    assert.deepStrictEqual(plan, { action: 'link', personId: 'p9', reason: null });
});

test('link approval refuses on every race that actually happens', () => {
    const resolved = Server.planApproval(
        Object.assign({}, matchRequest, { status: 'approved' }),
        { requesterPersonId: null, target: { exists: true, userId: null } });
    assert.match(resolved.reason, /already been resolved/);

    const linkedMeanwhile = Server.planApproval(matchRequest, {
        requesterPersonId: 'p5', target: { exists: true, userId: null } });
    assert.match(linkedMeanwhile.reason, /already linked/);

    const gone = Server.planApproval(matchRequest, {
        requesterPersonId: null, target: { exists: false } });
    assert.match(gone.reason, /no longer exists/);

    const stolen = Server.planApproval(matchRequest, {
        requesterPersonId: null, target: { exists: true, userId: 'other' } });
    assert.match(stolen.reason, /already linked to another account/);
});

test('a created person is a Visitor — nobody self-declares onto the Track', () => {
    const fields = Server.newPersonFields({ name: 'Jane Doe' });
    assert.deepStrictEqual(fields.membership, { stage: 'visitor', inactive: false });
    assert.deepStrictEqual(fields.tags, ['Visitor']);
    assert.deepStrictEqual(fields.contact, { email: '', phone: '', address: '' });
});

// ── Approving a name fix ─────────────────────────────────────────────────────

const nameFix = {
    uid: 'u1', kind: 'name_fix', personId: 'p1', status: 'pending',
    proposed: { name: 'Jayne Doe' },
};

test('approving a name fix renames the person', () => {
    const plan = Server.planApproval(nameFix, {
        requesterPersonId: 'p1', target: { exists: true, name: 'Jane Doe' },
    });
    assert.deepStrictEqual(plan, { action: 'rename', personId: 'p1', name: 'Jayne Doe', reason: null });
});

test('a name fix is refused if the link moved while it queued — it would rename a stranger', () => {
    const plan = Server.planApproval(nameFix, {
        requesterPersonId: 'p9', target: { exists: true, name: 'Jane Doe' },
    });
    assert.strictEqual(plan.action, 'refuse');
    assert.match(plan.reason, /no longer linked/);
});

test('a name fix is refused if the record is gone, already resolved, or already spelt that way', () => {
    assert.match(Server.planApproval(nameFix, {
        requesterPersonId: 'p1', target: { exists: false },
    }).reason, /no longer exists/);

    assert.match(Server.planApproval(Object.assign({}, nameFix, { status: 'declined' }), {
        requesterPersonId: 'p1', target: { exists: true, name: 'Jane Doe' },
    }).reason, /already been resolved/);

    assert.match(Server.planApproval(nameFix, {
        requesterPersonId: 'p1', target: { exists: true, name: 'Jayne Doe' },
    }).reason, /already has this spelling/);
});

test('a name fix with an empty name cannot be approved', () => {
    const plan = Server.planApproval(
        Object.assign({}, nameFix, { proposed: { name: '   ' } }),
        { requesterPersonId: 'p1', target: { exists: true, name: 'Jane Doe' } });
    assert.strictEqual(plan.action, 'refuse');
});

// ── Approving a family change ────────────────────────────────────────────────

const jane = { id: 'p1', sex: 'female' };
const john = { id: 'p2', sex: 'male' };
const sam = { id: 'p3', sex: 'male' };
const people = { p1: jane, p2: john, p3: sam };
const byId = id => people[id] || null;

function familyRequest(op, relation, otherId) {
    return { uid: 'u1', kind: 'family', personId: 'p1', status: 'pending',
        family: { op, relation, otherId } };
}

test('approving a spouse creates the marriage, seating each by sex', () => {
    const plan = Server.planApproval(familyRequest('add', 'spouse', 'p2'), {
        requesterPersonId: 'p1', families: [], personById: byId,
    });
    assert.strictEqual(plan.action, 'family');
    assert.strictEqual(plan.familyAction, 'create');
    assert.deepStrictEqual(plan.changes, { wifeId: 'p1', husbandId: 'p2', childIds: [] });
});

test('approving a child appends to the existing household', () => {
    const families = [{ id: 'f1', husbandId: 'p2', wifeId: 'p1', childIds: [] }];
    const plan = Server.planApproval(familyRequest('add', 'child', 'p3'), {
        requesterPersonId: 'p1', families, personById: byId,
    });
    assert.strictEqual(plan.familyAction, 'update');
    assert.strictEqual(plan.familyId, 'f1');
    assert.deepStrictEqual(plan.changes, { childIds: ['p3'] });
});

test('approving a removal vacates only the one seat', () => {
    const families = [{ id: 'f1', husbandId: 'p2', wifeId: 'p1', childIds: ['p3'] }];
    const plan = Server.planApproval(familyRequest('remove', 'child', 'p3'), {
        requesterPersonId: 'p1', families, personById: byId,
    });
    assert.deepStrictEqual(plan.changes, { childIds: [] });
});

test('the planner\'s own refusals reach the approver in its words', () => {
    // Both already married to other people — the household rule that lives in
    // FamilyCore, surfaced rather than re-invented here.
    const families = [
        { id: 'f1', husbandId: 'p9', wifeId: 'p1', childIds: [] },
        { id: 'f2', husbandId: 'p2', wifeId: 'p8', childIds: [] },
    ];
    const plan = Server.planApproval(familyRequest('add', 'spouse', 'p2'), {
        requesterPersonId: 'p1', families, personById: byId,
    });
    assert.strictEqual(plan.action, 'refuse');
    assert.match(plan.reason, /already has a spouse/);
});

test('a family change is refused when the requester is no longer that Person', () => {
    const plan = Server.planApproval(familyRequest('add', 'spouse', 'p2'), {
        requesterPersonId: 'p9', families: [], personById: byId,
    });
    assert.strictEqual(plan.action, 'refuse');
    assert.match(plan.reason, /no longer linked/);
});

test('a family change naming an unknown relation cannot be approved', () => {
    const plan = Server.planApproval(familyRequest('add', 'cousin', 'p2'), {
        requesterPersonId: 'p1', families: [], personById: byId,
    });
    assert.strictEqual(plan.action, 'refuse');
});

test('a request that was already resolved cannot be approved again, whatever the kind', () => {
    for (const req of [matchRequest, nameFix, familyRequest('add', 'spouse', 'p2')]) {
        const plan = Server.planApproval(Object.assign({}, req, { status: 'approved' }), {
            requesterPersonId: req.personId, families: [], personById: byId,
            target: { exists: true, name: 'Jane Doe' },
        });
        assert.strictEqual(plan.action, 'refuse', req.kind);
        assert.match(plan.reason, /already been resolved/);
    }
});
