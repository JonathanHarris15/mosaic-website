/**
 * The "you have been assigned" and "an Admin has taken you off" texts:
 * which roster writes are an editor's, and the words.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const aa = require('../functions/assignment-assigned.js');
const {tellPerson} = require('../functions/notification-send.js');

const NOW = Date.parse('2026-11-18T16:00:00Z');

/** @param {Object<string, *>} [over] @return {*} */
function row(over) {
    return Object.assign({
        personId: 'p1', roleSlug: 'sound', slotId: 's1', oneOffId: null,
        state: 'pending', stateSetBy: 'editor-uid', stateSetAt: '2026-11-18T15:59:00Z',
    }, over || {});
}

test('an editor putting somebody on an empty place is a new placement', () => {
    assert.equal(aa.isNewPlacement(null, row(), NOW), true);
});

test('replacing somebody puts the new person on, Pending', () => {
    assert.equal(aa.isNewPlacement(row({personId: 'p0'}), row(), NOW), true);
});

test('a take or a Trade arrives Confirmed and is not news', () => {
    assert.equal(aa.isNewPlacement(null, row({state: 'confirmed', stateSetBy: 'p1'}), NOW), false);
});

test('a row copied with an old timestamp (a moved date, a re-file) is not news', () => {
    assert.equal(aa.isNewPlacement(null, row({stateSetAt: '2026-11-01T12:00:00Z'}), NOW), false);
    assert.equal(aa.isNewPlacement(null, row({stateSetAt: null}), NOW), false);
});

test('the same person re-saved is not a new placement', () => {
    assert.equal(aa.isNewPlacement(row(), row(), NOW), false);
});

test('a Firestore Timestamp counts as well as a string', () => {
    const ts = {toMillis: () => NOW - 1000};
    assert.equal(aa.isNewPlacement(null, row({stateSetAt: ts}), NOW), true);
});

test('a burst of places within a few minutes is covered by the first text', () => {
    assert.equal(aa.coveredByBurst({lastSentAt: new Date(NOW - 60 * 1000)}, NOW), true);
    assert.equal(aa.coveredByBurst({lastSentAt: new Date(NOW - 10 * 60 * 1000)}, NOW), false);
    assert.equal(aa.coveredByBurst(null, NOW), false);
});

test('the assigned text is the church\'s sentence with the Commitments link', async () => {
    const sent = [];
    await tellPerson({
        now: () => new Date(NOW),
        loadPerson: async () => ({uid: null, phone: '+15550001', firstName: 'Jo'}),
        loadTokens: async () => [],
        loadTemplates: async () => aa.templatesForSendPath(),
        sendText: async (/** @type {*} */ m) => { sent.push(m); return {accepted: true}; },
        writeLog: async () => {},
    }, aa.notifyRequest('p1', 'https://x.test'));
    assert.equal(sent[0].body, 'You have been assigned new service roles in the Mosaic Manager, ' +
        'please accept or deny them here: https://x.test/commitments.html');
});

test('a row going, or holding somebody else, is a removal', () => {
    assert.equal(aa.isRemoval(row(), null), true);
    assert.equal(aa.isRemoval(row(), row({personId: 'p2'})), true);
    assert.equal(aa.isRemoval(row(), row({state: 'confirmed'})), false);
    assert.equal(aa.isRemoval(null, row()), false);
    assert.equal(aa.isRemoval(row({roleSlug: 'preacher'}), null), false);
});

test('an editor emptying or refilling the place took them off', () => {
    assert.equal(aa.removedByEditor(row(), []), true);
    assert.equal(aa.removedByEditor(row(), [row({personId: 'p2'})]), true);
});

test('a take or a Trade is not an editor taking them off', () => {
    const taker = row({personId: 'p2', state: 'confirmed', stateSetBy: 'p2'});
    assert.equal(aa.removedByEditor(row({state: 'declined'}), [taker]), false);
});

test('a row re-filed under another id is not a removal', () => {
    assert.equal(aa.removedByEditor(row(), [row()]), false);
});

test('somebody on another place on the same date was still taken off this one', () => {
    assert.equal(aa.removedByEditor(row(), [row({slotId: 's2'})]), true);
});

test('the removal text names the place and asks nothing', () => {
    assert.equal(aa.removedRequest('p1', 'Sound on Sunday, November 22', 'https://x.test', '2026-11-22')
        .values.message,
    'An Admin has taken you off of the Sound on Sunday, November 22 service role. No action needed');
});

test('with push switched off, somebody with the app is texted', async () => {
    const pushes = [];
    const texts = [];
    await tellPerson({
        now: () => new Date(NOW),
        loadPerson: async () => ({uid: 'u1', phone: '+15550001', firstName: 'Jo'}),
        loadTokens: async () => [{id: 'd1', token: 't1'}],
        pushAllowed: async () => false,
        loadTemplates: async () => aa.templatesForSendPath(),
        sendPush: async (/** @type {*} */ m) => { pushes.push(m); return {accepted: true}; },
        sendText: async (/** @type {*} */ m) => { texts.push(m); return {accepted: true}; },
        writeLog: async () => {},
    }, aa.notifyRequest('p1', 'https://x.test'));
    assert.equal(pushes.length, 0);
    assert.equal(texts.length, 1);
});
