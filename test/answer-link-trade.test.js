/**
 * The Answer link door's Trade invitation purpose (MS-249, MS-526). The
 * Trade moves themselves are the existing ones; here they are stand-ins
 * that record what they were asked, because their transactions need the
 * emulator. What this pins is the door: who the actor is, which move each
 * answer calls, and what the invitee is shown.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const door = require('../functions/answer-link-door.js');

const NOW = new Date('2026-09-15T15:00:00Z');

/** @param {Object<string, *>} [over] */
function setup(over) {
    const o = over || {};
    /** @type {*} */
    const trade = Object.assign({
        id: 't1', origin: 'invitation', state: 'invited',
        holderId: 'holder', counterpartyId: 'invitee',
        assignment: {occurrenceId: 'sunday_service_2026-09-20', roleSlug: 'sound',
            slotId: 's1', date: '2026-09-20'},
        eventName: 'Sunday Service', roleName: 'Sound',
        closedBy: null, closedBecause: null,
    }, o.trade || {});
    /** @type {Array<*>} */
    const moves = [];
    /** @type {*} */
    const deps = {
        loadTrade: async (/** @type {string} */ id) => (id === 't1' ? trade : null),
        holderFirstName: async (/** @type {string} */ id) => (id === 'holder' ? 'Bob' : 'Ann'),
        eventTime: async () => '10:30',
        offer: o.offer || (async (/** @type {*} */ spec) => {
            moves.push(['offer', spec]);
            Object.assign(trade, {state: 'settled', closedBy: spec.actorId});
            return {ok: true, tradeId: 't1', state: 'settled'};
        }),
        refuse: async (/** @type {*} */ spec) => {
            moves.push(['refuse', spec]);
            Object.assign(trade, {state: 'refused', closedBy: spec.actorId});
            return {ok: true, tradeId: 't1', state: 'refused'};
        },
    };
    const link = {purpose: 'trade_invitation', personId: o.linkPerson || 'invitee', thing: 't1'};
    /**
     * @param {string} op
     * @param {*} [answer]
     */
    const call = (op, answer) => door.tradeInvitationPurpose(deps, {
        op, link, answer, now: NOW, linkRef: null,
    });
    return {trade, moves, call};
}

test('read shows the invitee who asked, the Event, the Role and the date, and both answers', async () => {
    const {call} = setup();
    const out = await call('read');
    assert.equal(out.ok, true);
    assert.equal(out.purpose, 'trade_invitation');
    assert.equal(out.view.status, 'waiting');
    assert.equal(out.view.holderFirstName, 'Bob');
    assert.equal(out.view.roleName, 'Sound');
    assert.equal(out.view.timeLabel, '10:30 am');
    assert.deepEqual(out.view.canAnswer, ['take', 'refuse']);
});

test('take is the empty reply that settles, with the invitee off the link as the actor', async () => {
    const {call, moves} = setup();
    const out = await call('answer', 'take');
    assert.equal(out.ok, true);
    assert.equal(out.view.status, 'took');
    assert.equal(moves.length, 1);
    assert.equal(moves[0][0], 'offer');
    assert.equal(moves[0][1].tradeId, 't1');
    assert.equal(moves[0][1].actorId, 'invitee');
    assert.deepEqual(moves[0][1].offered, []);
    assert.equal(moves[0][1].today, '2026-09-15');
});

test('refuse is the refuse move, with the invitee as who ended it', async () => {
    const {call, moves} = setup();
    const out = await call('answer', 'refuse');
    assert.equal(out.view.status, 'refused');
    assert.equal(moves[0][0], 'refuse');
    assert.equal(moves[0][1].actorId, 'invitee');
});

test('an answer that is neither take nor refuse moves nothing', async () => {
    const {call, moves} = setup();
    const out = await call('answer', 'offer my Sunday instead');
    assert.equal(out.ok, false);
    assert.equal(moves.length, 0);
});

test('an ended invitation reads as ended and refuses an answer', async () => {
    for (const t of [{state: 'withdrawn', closedBy: 'holder'},
        {state: 'refused', closedBy: null, closedBecause: 'filled'},
        {state: 'settled', closedBy: 'holder', counterpartyId: 'invitee', closedBecause: 'settled'}]) {
        const {call, moves} = setup({trade: t});
        const read = await call('read');
        assert.equal(read.view.status, 'ended', JSON.stringify(t));
        const out = await call('answer', 'take');
        assert.equal(out.ok, true);
        assert.equal(out.view.status, 'ended');
        assert.equal(moves.length, 0);
    }
});

test('reopening after answering shows the answer and offers nothing', async () => {
    const {call} = setup();
    await call('answer', 'take');
    const again = await call('read');
    assert.equal(again.view.status, 'took');
    assert.deepEqual(again.view.canAnswer, []);
});

test('a refusal from the move (the Role does not allow them) comes back in plain words', async () => {
    const {call} = setup({offer: async () => ({ok: false, code: 'failed-precondition',
        message: 'That swap would put somebody in a place the Role does not allow.'})});
    const out = await call('answer', 'take');
    assert.equal(out.ok, false);
    assert.equal(out.code, 'refused', 'not a code the page reads as a dead link');
    assert.equal(out.message, 'That swap would put somebody in a place the Role does not allow.');
});

test('a link whose Person is not the one invited is closed', async () => {
    const {call} = setup({linkPerson: 'somebody-else'});
    assert.equal((await call('read')).code, 'closed');
});

test('the door dispatches the trade_invitation purpose', () => {
    const src = require('fs').readFileSync(
        require('path').join(__dirname, '../functions/answer-link-door.js'), 'utf8');
    assert.match(src, /purpose === PURPOSE_TRADE/);
    assert.equal(require('../functions/trade-invitation-text.js').PURPOSE, 'trade_invitation');
});
