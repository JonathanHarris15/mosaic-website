/**
 * The editor sentence is derived. A phone clears it before any token read.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const reach = require('../public/notification-reach.js');

test('unreachable is no phone and no token, and a phone clears it immediately', () => {
    const jane = {id: 'p1', userId: 'u1', contact: {phone: ''}};
    assert.equal(reach.isUnreachable(jane, []), true);
    assert.equal(reach.isUnreachable(jane, ['u1']), false);
    assert.equal(reach.isUnreachable({contact: {phone: '512-555-0100'}}, []), false);
    assert.equal(reach.showUnreachable(jane, null), false);
    assert.equal(reach.showUnreachable({phone: '5'}, null), false);
    assert.equal(reach.showUnreachable(jane, []), true);
    assert.match(reach.SENTENCE, /no phone and no app/);
    assert.match(reach.SENTENCE, /Ask in person/);
});
