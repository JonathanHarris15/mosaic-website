const { test } = require('node:test');
const assert = require('node:assert');

const { toPathForPerson } = require('../scripts/merge-duplicate-person.js');

const FROM = 'qBZMVskmS1CBJl8aCPcT';
const TO = 'Rqu2n9V9vRBLF8TKkEwg';

test('toPathForPerson preserves relative path under people', () => {
    const fromPath = `people/${FROM}/shepherding_activity/4KeM6rb95pGOx0NxhZ7M`;
    assert.equal(
        toPathForPerson(fromPath, FROM, TO),
        `people/${TO}/shepherding_activity/4KeM6rb95pGOx0NxhZ7M`,
    );
});
