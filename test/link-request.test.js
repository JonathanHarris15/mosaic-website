const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/link-request-core.js');
const Server = require('../functions/link-request.js');
const Shepherding = require('../public/shepherding-core.js');

// A Link Request (ADR-0025) is a User asking to become a Linked User: either
// "I am already this Person" (match) or "I am not in the directory, here I am"
// (new). An editor or above resolves it. The client decides what may be ASKED;
// the Cloud Function decides what approval DOES. These pin both halves, and the
// duplicated vocabulary between them.

// ── The two halves must speak the same language ──────────────────────────────
// public/link-request-core.js and functions/link-request.js cannot import each
// other (Cloud Functions deploy only functions/), so the constants are copied.
// This is what stops the copies drifting.

test('client and server agree on the status vocabulary', () => {
    assert.deepStrictEqual(Core.STATUS, Server.STATUS);
});

test('client and server agree on the request kinds', () => {
    assert.deepStrictEqual(Core.KIND, Server.KIND);
});

test('client and server agree on who may resolve a request', () => {
    assert.deepStrictEqual(Core.RESOLVER_LEVELS, Server.RESOLVER_LEVELS);
});

test('a new Person starts at the first Membership Stage, with that stage\'s projected tags', () => {
    assert.strictEqual(Server.INITIAL_STAGE, Shepherding.MEMBERSHIP_STAGES[0]);
    assert.deepStrictEqual(
        Server.INITIAL_STAGE_TAGS,
        Shepherding.membershipTagsFor({ stage: Server.INITIAL_STAGE, inactive: false })
    );
});

// ── Who may ask, and who may approve ─────────────────────────────────────────

test('editors, elders and admins may resolve a request; members and viewers may not', () => {
    for (const level of ['editor', 'elder', 'admin', 'super_admin']) {
        assert.ok(Core.canResolve(level), `${level} should be able to resolve`);
        assert.ok(Server.canResolve(level), `${level} should be able to resolve (server)`);
    }
    for (const level of ['member', 'viewer', '', null, undefined]) {
        assert.ok(!Core.canResolve(level), `${level} should not be able to resolve`);
        assert.ok(!Server.canResolve(level), `${level} should not be able to resolve (server)`);
    }
});

test('an unlinked user may raise a request', () => {
    assert.ok(Core.canRequest({ email: 'a@b.com' }));
});

test('an already-linked user may not — a link is what the request is FOR', () => {
    assert.ok(!Core.canRequest({ email: 'a@b.com', personId: 'p1' }));
    assert.ok(!Core.canRequest(null));
});

// ── Building a request ───────────────────────────────────────────────────────

test('a match request must name a person', () => {
    const bad = Core.validateDraft({ uid: 'u1', kind: 'match' });
    assert.ok(!bad.ok);
    assert.match(bad.error, /Choose the directory record/);

    assert.ok(Core.validateDraft({ uid: 'u1', kind: 'match', personId: 'p1' }).ok);
});

test('a new request must carry a name', () => {
    const bad = Core.validateDraft({ uid: 'u1', kind: 'new', proposed: { name: '   ' } });
    assert.ok(!bad.ok);
    assert.match(bad.error, /full name/);

    assert.ok(Core.validateDraft({ uid: 'u1', kind: 'new', proposed: { name: 'Jane Doe' } }).ok);
});

test('a request with no kind is refused', () => {
    assert.ok(!Core.validateDraft({ uid: 'u1' }).ok);
});

test('a request with no signed-in user is refused', () => {
    assert.ok(!Core.validateDraft({ kind: 'match', personId: 'p1' }).ok);
});

test('a match request stores the person id and no proposal', () => {
    const req = Core.buildRequest({
        uid: 'u1', email: ' jane@example.com ', kind: 'match', personId: 'p1', note: ' I moved here in May ',
    });
    assert.strictEqual(req.uid, 'u1');
    assert.strictEqual(req.email, 'jane@example.com');
    assert.strictEqual(req.kind, 'match');
    assert.strictEqual(req.personId, 'p1');
    assert.strictEqual(req.proposed, null);
    assert.strictEqual(req.note, 'I moved here in May');
    assert.strictEqual(req.status, 'pending');
});

test('a new request stores the proposal and no person id', () => {
    const req = Core.buildRequest({
        uid: 'u1', email: 'jane@example.com', kind: 'new',
        proposed: { name: ' Jane Doe ', email: ' jane@example.com ', phone: '', address: '', birthday: '', sex: 'female' },
    });
    assert.strictEqual(req.personId, null);
    assert.deepStrictEqual(req.proposed, {
        name: 'Jane Doe',
        contact: { email: 'jane@example.com', phone: '', address: '' },
        birthday: null,
        sex: 'female',
    });
});

test('building an invalid request throws rather than writing something malformed', () => {
    assert.throws(() => Core.buildRequest({ uid: 'u1', kind: 'new', proposed: {} }), /full name/);
});

test('a proposal never carries tags, a stage, or anything shepherding', () => {
    const proposed = Core.normalizeProposed({
        name: 'Jane', tags: ['Member'], membership: { stage: 'member' }, shepherdingStatus: 'urgent',
    });
    assert.deepStrictEqual(Object.keys(proposed).sort(), ['birthday', 'contact', 'name', 'sex']);
});

// ── Describing a request ─────────────────────────────────────────────────────

test('a match request is described by the person it claims', () => {
    const req = Core.buildRequest({ uid: 'u1', email: 'jane@example.com', kind: 'match', personId: 'p1' });
    assert.match(Core.summarize(req, 'Jane Doe'), /jane@example\.com says they are Jane Doe/);
});

test('a match request whose person vanished still renders', () => {
    const req = Core.buildRequest({ uid: 'u1', email: 'jane@example.com', kind: 'match', personId: 'p1' });
    assert.match(Core.summarize(req, null), /no longer exists/);
});

test('a new request is described by the proposed name', () => {
    const req = Core.buildRequest({ uid: 'u1', email: 'jane@example.com', kind: 'new', proposed: { name: 'Jane Doe' } });
    assert.match(Core.summarize(req), /asks to be added as Jane Doe/);
});

test('a declined request tells the requester why, when a reason was given', () => {
    const req = Object.assign(
        Core.buildRequest({ uid: 'u1', email: 'j@e.com', kind: 'new', proposed: { name: 'Jane' } }),
        { status: 'declined', declineReason: 'We already have you as Jane Smith.' }
    );
    assert.match(Core.statusMessage(req), /We already have you as Jane Smith/);
});

test('a declined request with no reason still says something useful', () => {
    const req = Object.assign(
        Core.buildRequest({ uid: 'u1', email: 'j@e.com', kind: 'new', proposed: { name: 'Jane' } }),
        { status: 'declined' }
    );
    assert.match(Core.statusMessage(req), /declined/);
});

// ── What approval does ───────────────────────────────────────────────────────

const matchRequest = { uid: 'u1', kind: 'match', personId: 'p1', status: 'pending' };
const newRequest = { uid: 'u1', kind: 'new', personId: null, status: 'pending', proposed: { name: 'Jane Doe' } };

test('approving a match links the named person', () => {
    const plan = Server.planApproval(matchRequest, {
        requesterPersonId: null, target: { exists: true, userId: null },
    });
    assert.deepStrictEqual(plan, { action: 'link', personId: 'p1', reason: null });
});

test('approving a match re-links cleanly when the person already points back at this user', () => {
    const plan = Server.planApproval(matchRequest, {
        requesterPersonId: null, target: { exists: true, userId: 'u1' },
    });
    assert.strictEqual(plan.action, 'link');
});

test('approving a new request creates a person', () => {
    const plan = Server.planApproval(newRequest, { requesterPersonId: null });
    assert.deepStrictEqual(plan, { action: 'create', personId: null, reason: null });
});

test('an approver may redirect a new request onto an existing record instead', () => {
    const plan = Server.planApproval(newRequest, {
        requesterPersonId: null, overridePersonId: 'p9', target: { exists: true, userId: null },
    });
    assert.deepStrictEqual(plan, { action: 'link', personId: 'p9', reason: null });
});

test('an already-resolved request cannot be approved twice', () => {
    const plan = Server.planApproval(
        Object.assign({}, matchRequest, { status: 'approved' }),
        { requesterPersonId: null, target: { exists: true, userId: null } }
    );
    assert.strictEqual(plan.action, 'refuse');
    assert.match(plan.reason, /already been resolved/);
});

test('approval refuses when an admin linked the account while the request sat in the queue', () => {
    const plan = Server.planApproval(matchRequest, {
        requesterPersonId: 'p5', target: { exists: true, userId: null },
    });
    assert.strictEqual(plan.action, 'refuse');
    assert.match(plan.reason, /already linked/);
});

test('approval refuses when the named person has been deleted or merged away', () => {
    const plan = Server.planApproval(matchRequest, {
        requesterPersonId: null, target: { exists: false, userId: null },
    });
    assert.strictEqual(plan.action, 'refuse');
    assert.match(plan.reason, /no longer exists/);
});

test('approval never steals a person already linked to someone else', () => {
    const plan = Server.planApproval(matchRequest, {
        requesterPersonId: null, target: { exists: true, userId: 'other-uid' },
    });
    assert.strictEqual(plan.action, 'refuse');
    assert.match(plan.reason, /already linked to another account/);
});

test('a new request stripped of its proposal cannot be approved', () => {
    const plan = Server.planApproval(
        Object.assign({}, newRequest, { proposed: null }),
        { requesterPersonId: null }
    );
    assert.strictEqual(plan.action, 'refuse');
});

test('a match request that lost its person id cannot be approved', () => {
    const plan = Server.planApproval(
        Object.assign({}, matchRequest, { personId: null }),
        { requesterPersonId: null }
    );
    assert.strictEqual(plan.action, 'refuse');
    assert.match(plan.reason, /names no directory record/);
});

// ── The Person a new request creates ─────────────────────────────────────────

test('a created person carries the proposed details and nothing else', () => {
    const fields = Server.newPersonFields({
        name: 'Jane Doe',
        contact: { email: 'jane@example.com', phone: '555-1234', address: '1 High St' },
        birthday: '1990-04-01',
        sex: 'female',
    });
    assert.strictEqual(fields.name, 'Jane Doe');
    assert.strictEqual(fields.contact.email, 'jane@example.com');
    assert.strictEqual(fields.birthday, '1990-04-01');
    assert.strictEqual(fields.sex, 'female');
    assert.strictEqual(fields.totalInvolvements, 0);
});

test('a created person is a Visitor, not a member — nobody self-declares onto the Track', () => {
    const fields = Server.newPersonFields({ name: 'Jane Doe' });
    assert.deepStrictEqual(fields.membership, { stage: 'visitor', inactive: false });
    assert.deepStrictEqual(fields.tags, ['Visitor']);
    assert.ok(!Shepherding.carriesMemberTag(fields.membership));
});

test('a created person with sparse details still has a well-formed contact block', () => {
    const fields = Server.newPersonFields({ name: 'Jane Doe' });
    assert.deepStrictEqual(fields.contact, { email: '', phone: '', address: '' });
    assert.strictEqual(fields.birthday, null);
    assert.strictEqual(fields.sex, null);
});
