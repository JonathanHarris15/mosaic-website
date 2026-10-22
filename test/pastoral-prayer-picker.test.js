const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PastoralPrayerCore = require('../public/pastoral-prayer-core.js');
const { pastoralPrayerPicker, personPicker, serviceForm } = require('../public/service-builder.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'service-builder.html'), 'utf8');

global.window = global;
global.PastoralPrayerCore = PastoralPrayerCore;

function pageWithMembers(members) {
    const page = serviceForm();
    page.prayerMembers = members;
    return page;
}

test('pastoral prayer subjects use the shared person picker, not a native select', () => {
    assert.doesNotMatch(html, /setPrayerPerson\(item\.key/,
        'the subject slots must not be a <select>');
    assert.match(html, /pastoralPrayerPicker\(slot/,
        'the subject slots mount pastoralPrayerPicker');
    assert.match(html, /prayerLastLabel\(p\)/,
        'each row still shows when they were last prayed for');
});

test('prayerChoices orders members least-recently-prayed first', () => {
    const members = [
        { id: 'a', name: 'Ann', sex: 'female', lastPastoralPrayerDate: '2026-05-01' },
        { id: 'b', name: 'Beth', sex: 'female', lastPastoralPrayerDate: null },
        { id: 'c', name: 'Carl', sex: 'male', lastPastoralPrayerDate: '2020-01-01' },
    ];
    const page = pageWithMembers(members);

    const female = page.prayerChoices('female', null).map(p => p.id);
    assert.deepStrictEqual(female, ['b', 'a']);

    const male = page.prayerChoices('male', null).map(p => p.id);
    assert.deepStrictEqual(male, ['c']);
});

test('choosing in pastoralPrayerPicker writes the same slot shape setPrayerPerson did', () => {
    const members = [
        { id: 'p-1', name: 'Pat Sample', sex: 'male', lastPastoralPrayerDate: '2024-01-07' },
    ];
    const page = pageWithMembers(members);

    const slot = { id: null, name: '' };
    const item = { requestPeople: [{ who: 'male' }], requestsWho: 'either' };
    const picker = pastoralPrayerPicker(slot, page, item, 0);
    picker.select(members[0]);

    assert.strictEqual(slot.id, 'p-1');
    assert.strictEqual(slot.name, 'Pat Sample');

    page.setPrayerPerson('pastoralPrayer', 0, 'p-1');
    assert.strictEqual(slot.id, 'p-1');
    assert.strictEqual(slot.name, 'Pat Sample');
});

test('pastoralPrayerPicker opens on the rotation list when the query is empty', async () => {
    const members = [
        { id: 'm1', name: 'One', sex: 'male', lastPastoralPrayerDate: '2020-01-01' },
        { id: 'm2', name: 'Two', sex: 'male', lastPastoralPrayerDate: '2026-01-01' },
    ];
    const page = pageWithMembers(members);

    const slot = { id: null, name: '' };
    const item = { requestsWho: 'male' };
    const picker = pastoralPrayerPicker(slot, page, item, 0);
    picker.query = '';
    await picker.search();

    assert.deepStrictEqual(picker.results.map(p => p.id), ['m1', 'm2']);
});

test('a pastoral subject picker does not offer "add as new person"', async () => {
    const page = pageWithMembers([]);
    const picker = personPicker({ id: null, name: '' }, page, null, 'prayerMale', 'male');
    picker.parent = Object.assign(page, {
        peopleFuse: { search(q) { return [{ item: { id: 'x', name: q, sex: 'male' } }]; } },
        peopleRegistry: [{ id: 'x', name: 'Nobody Here', sex: 'male' }],
        prayerMembers: [],
    });
    picker.query = 'Nobody Here';
    await picker.search();
    assert.ok(!picker.results.some(p => p.isNew), 'pastoral slots only name existing members');
});
