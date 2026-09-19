const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MS-530 / MS-563 — People list reads Person.lastNoteAt only.

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('web People list no longer collection-groups shepherding_notes', () => {
    const js = read('public/shepherding-people.js');
    const html = read('public/shepherding-people.html');
    assert.doesNotMatch(js, /collectionGroup\(['"]shepherding_notes['"]\)/);
    assert.doesNotMatch(js, /lastNoteDates/);
    assert.match(js, /a\.lastNoteAt/);
    assert.match(js, /formatLastNote\(person\)/);
    assert.match(html, /formatLastNote\(person\)/);
    assert.match(html, /person\.lastNoteAt/);
    assert.doesNotMatch(html, /lastNoteDates/);
});

test('phone People list reads lastNoteAt from People and drops the notes CG helper', () => {
    const data = read('public/mobile/data.js');
    const screen = read('public/mobile/screens-shepherd.js');
    assert.doesNotMatch(data, /function getShepherdingLastNoteDates/);
    assert.doesNotMatch(data, /getShepherdingLastNoteDates/);
    assert.match(screen, /fmtShortDate\(p\.lastNoteAt\)/);
    assert.doesNotMatch(screen, /getShepherdingLastNoteDates/);
    assert.doesNotMatch(screen, /notesDates/);
});

test('phone mention data may still collection-group notes; People list must not', () => {
    const data = read('public/mobile/data.js');
    const peopleFn = data.slice(
        data.indexOf('function getShepherdingPeople'),
        data.indexOf('function getShepherdingTags')
    );
    assert.doesNotMatch(peopleFn, /collectionGroup/);
    assert.match(data, /function getDocMentionData/);
    assert.match(data, /collectionGroup\("shepherding_notes"\)/);
});
