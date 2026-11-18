/**
 * Telling somebody with an account when a Trade needs them or ends (MS-824).
 * Plain data in; no Firebase, no clock.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const tell = require('../functions/trade-tell.js');

const TODAY = '2026-09-15';
const BOTH = new Set(['bob', 'ann']);

/**
 * @param {Object<string, *>} [over]
 * @return {*}
 */
function trade(over) {
    return Object.assign({
        id: 't1', origin: 'invitation', state: 'invited',
        holderId: 'bob', counterpartyId: 'ann',
        assignment: {occurrenceId: 'o1', roleSlug: 'sound', slotId: 's1', date: '2026-09-20'},
        eventName: 'Sunday Service', roleName: 'Sound',
        offered: [], closedBy: null, closedBecause: null,
    }, over || {});
}

/**
 * @param {*} before
 * @param {*} after
 * @param {Set<string>} [linked]
 * @return {Array<*>}
 */
function owed(before, after, linked) {
    return tell.tellsFor(before, after, {today: TODAY, linked: linked || BOTH});
}

test('a new invitation tells the invitee', () => {
    assert.deepEqual(owed(null, trade()), [{personId: 'ann', kind: 'invited', state: 'invited'}]);
});

test('an invitee with no account is not told here: MS-249 texts them', () => {
    assert.deepEqual(owed(null, trade(), new Set(['bob'])), []);
});

test('an offer waiting on the holder tells the holder, replied or uninvited', () => {
    const reply = trade({state: 'offered', offered: [{occurrenceId: 'o2'}]});
    assert.deepEqual(owed(trade(), reply), [{personId: 'bob', kind: 'offered', state: 'offered'}]);
    const uninvited = trade({origin: 'offer', state: 'offered', offered: [{occurrenceId: 'o2'}]});
    assert.deepEqual(owed(null, uninvited), [{personId: 'bob', kind: 'offered', state: 'offered'}]);
});

test('an ending tells each party except whoever ended it', () => {
    assert.deepEqual(owed(trade(), trade({state: 'refused', closedBy: 'ann'})),
        [{personId: 'bob', kind: 'ended', state: 'refused'}]);
    assert.deepEqual(owed(trade(), trade({state: 'withdrawn', closedBy: 'bob'})),
        [{personId: 'ann', kind: 'ended', state: 'withdrawn'}]);
    assert.deepEqual(owed(trade(), trade({state: 'settled', closedBy: 'ann'})),
        [{personId: 'bob', kind: 'ended', state: 'settled'}]);
});

test('an ending nobody in the conversation caused tells both', () => {
    const out = owed(trade(), trade({state: 'withdrawn', closedBy: 'editor', closedBecause: 'filled'}));
    assert.deepEqual(out.map((t) => t.personId).sort(), ['ann', 'bob']);
    const killed = owed(trade(), trade({state: 'withdrawn', closedBy: null, closedBecause: 'settled'}));
    assert.deepEqual(killed.map((t) => t.personId).sort(), ['ann', 'bob']);
});

test('nobody without an account hears an ending', () => {
    const out = owed(trade(), trade({state: 'withdrawn', closedBy: 'editor', closedBecause: 'filled'}),
        new Set(['bob']));
    assert.deepEqual(out.map((t) => t.personId), ['bob']);
});

test('a write that does not change the state tells nobody', () => {
    assert.deepEqual(owed(trade(), trade({seenBy: ['bob']})), []);
    const ended = trade({state: 'refused', closedBy: 'ann'});
    assert.deepEqual(owed(ended, Object.assign({}, ended, {seenBy: ['bob']})), []);
});

test('a deleted Trade, or one whose date has passed, tells nobody', () => {
    assert.deepEqual(owed(trade(), null), []);
    const past = trade({assignment: {occurrenceId: 'o1', roleSlug: 'sound', date: '2026-09-14'}});
    assert.deepEqual(owed(null, past), []);
});

test('the record names the Trade, the state and the Person, so a retried trigger sends once', () => {
    assert.equal(tell.recordId('t1', {personId: 'ann', state: 'invited'}), 't1__invited__ann');
});

test('a held message is still true only while nothing has moved', () => {
    const held = {personId: 'ann', kind: 'invited', state: 'invited'};
    assert.equal(tell.stillTrue(trade(), held, TODAY), true);
    assert.equal(tell.stillTrue(trade({state: 'withdrawn', closedBy: 'bob'}), held, TODAY), false);
    assert.equal(tell.stillTrue(trade(), held, '2026-09-21'), false);
    assert.equal(tell.stillTrue(null, held, TODAY), false);
    const ended = {personId: 'bob', kind: 'ended', state: 'refused'};
    assert.equal(tell.stillTrue(trade({state: 'refused', closedBy: 'ann'}), ended, TODAY), true);
});

test('the words are the Commitments row’s words, seen from the person told', () => {
    /** @type {Object<string, string>} */
    const names = {bob: 'Bob', ann: 'Ann'};
    const w = tell.wordsFor(trade(), 'ann', (/** @type {string} */ id) => names[id]);
    assert.equal(w.headline, 'Bob asked you');
    assert.match(w.detail, /Sound/);
    const o = tell.wordsFor(trade({state: 'offered', offered: [{occurrenceId: 'o2'}]}), 'bob',
        (/** @type {string} */ id) => names[id]);
    assert.equal(o.headline, 'Ann will swap');
});

test('the request lands on Commitments, wants no reply, and names no channel', () => {
    const req = tell.notifyRequest({personId: 'ann', kind: 'invited', state: 'invited'},
        {headline: 'Bob asked you', detail: 'They cannot make Sound.'}, 'https://x.test');
    assert.equal(req.personId, 'ann');
    assert.equal(req.purpose, 'trade_update');
    assert.equal(req.url, 'https://x.test/commitments.html');
    assert.equal(req.expectReply, false);
    assert.equal(req.values.headline, 'Bob asked you');
    assert.equal(req.values.detail, 'They cannot make Sound.');
    assert.equal(req.channel, undefined);
});

test('the push is the headline over the detail; the text is the whole sentence', () => {
    const t = tell.templatesForSendPath();
    assert.deepEqual(t.push.trade, {title: '{headline}', body: '{detail}'});
    assert.equal(t.text.trade, '{message}');
});

/** @param {string} id @return {string} */
const FULL = (id) => ({bob: 'Bob Stone', ann: 'Ann Lee'})[id] || 'Somebody';
const WORDS = {headline: 'h', detail: 'd'};
const PLACE = {holderId: 'bob', counterpartyId: 'ann', roleName: 'Sound',
    assignment: {date: '2026-11-22', roleSlug: 'sound'}};

test('an invitation says who asked and links to the trade', () => {
    const req = tell.notifyRequest({personId: 'ann', kind: 'invited', state: 'invited'},
        WORDS, 'https://x.test', Object.assign({state: 'invited'}, PLACE), FULL);
    assert.equal(req.values.message, 'Bob Stone has asked you to trade service roles with them. ' +
        'See the trade here: https://x.test/commitments.html');
});

test('an offer says who offered, for which place, and links to it', () => {
    const req = tell.notifyRequest({personId: 'bob', kind: 'offered', state: 'offered'},
        WORDS, 'https://x.test', Object.assign({state: 'offered'}, PLACE), FULL);
    assert.equal(req.values.message, 'Ann Lee has sent you a trade offer for the Sound on ' +
        'Sunday, November 22 service role. See it here: https://x.test/commitments.html');
});

test('taking an invitation for nothing tells the holder to say thanks', () => {
    const req = tell.notifyRequest({personId: 'bob', kind: 'ended', state: 'settled'},
        WORDS, 'https://x.test', Object.assign({state: 'settled', chosen: null, closedBy: 'ann'}, PLACE), FULL);
    assert.equal(req.values.message, 'Ann Lee has taken your Sound on Sunday, November 22 ' +
        'without asking for anything in return. Make sure to thank them!');
});

test('any other ending says the Commitments row and the link', () => {
    const req = tell.notifyRequest({personId: 'ann', kind: 'ended', state: 'refused'},
        {headline: 'Bob said no', detail: 'Nothing changed.'}, 'https://x.test',
        Object.assign({state: 'refused'}, PLACE), FULL);
    assert.equal(req.values.message, 'Bob said no. Nothing changed. https://x.test/commitments.html');
});

test('the holder is not told "You kept it" about keeping their own place', () => {
    const kept = trade({state: 'withdrawn', closedBy: null, closedBecause: 'kept'});
    assert.deepEqual(owed(trade(), kept).map((t) => t.personId), ['ann']);
});

test('a holder who refuses an offer is not told; the offerer hears who said no', () => {
    const offered = trade({state: 'offered', offered: [{occurrenceId: 'o2'}]});
    const refused = trade({state: 'refused', closedBy: 'bob', offered: [{occurrenceId: 'o2'}]});
    assert.deepEqual(owed(offered, refused), [{personId: 'ann', kind: 'ended', state: 'refused'}]);
    /** @type {Object<string, string>} */
    const names = {bob: 'Bob', ann: 'Ann'};
    assert.equal(tell.wordsFor(refused, 'ann', (/** @type {string} */ id) => names[id]).headline, 'Bob said no');
});

test('a held ending they already cleared from Commitments is not sent', () => {
    const ended = {personId: 'bob', kind: 'ended', state: 'refused'};
    assert.equal(tell.stillTrue(trade({state: 'refused', closedBy: 'ann', seenBy: ['bob']}), ended, TODAY), false);
});
