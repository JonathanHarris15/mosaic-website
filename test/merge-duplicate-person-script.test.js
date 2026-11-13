const { test } = require('node:test');
const assert = require('node:assert');

const {
    toPathForPerson,
    wouldDeleteFromPerson,
} = require('../scripts/merge-duplicate-person.js');

const FROM = 'qBZMVskmS1CBJl8aCPcT';
const TO = 'Rqu2n9V9vRBLF8TKkEwg';

test('wouldDeleteFromPerson when only an empty source doc remains (no subtree, no refs)', () => {
    assert.equal(wouldDeleteFromPerson({ count: 0, samples: [] }), true);
});

test('wouldDeleteFromPerson stays false while subcollection docs remain under source', () => {
    const FROM = 'fromPerson';
    assert.equal(
        wouldDeleteFromPerson({
            count: 1,
            samples: [`people/${FROM}/shepherding_activity/doc1`],
        }),
        false,
    );
});

test('toPathForPerson preserves relative path under people', () => {
    const fromPath = `people/${FROM}/shepherding_activity/4KeM6rb95pGOx0NxhZ7M`;
    assert.equal(
        toPathForPerson(fromPath, FROM, TO),
        `people/${TO}/shepherding_activity/4KeM6rb95pGOx0NxhZ7M`,
    );
});
