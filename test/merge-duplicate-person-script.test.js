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
    assert.equal(wouldDeleteFromPerson({ count: 1, samples: ['people/from/sub/x'] }), false);
    // The source people/{from} root must not count as a blocking reference.
    assert.equal(wouldDeleteFromPerson({ count: 1, samples: ['people/from'] }), false);
});

test('toPathForPerson preserves relative path under people', () => {
    const fromPath = `people/${FROM}/shepherding_activity/4KeM6rb95pGOx0NxhZ7M`;
    assert.equal(
        toPathForPerson(fromPath, FROM, TO),
        `people/${TO}/shepherding_activity/4KeM6rb95pGOx0NxhZ7M`,
    );
});
