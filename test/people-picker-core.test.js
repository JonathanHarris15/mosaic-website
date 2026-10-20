const { test } = require('node:test');
const assert = require('node:assert');

const PeoplePickerCore = require('../public/people-picker-core.js');
const Roles = require('../public/roles-core.js');

const colinActive = {
    id: 'Rqu2n9V9vRBLF8TKkEwg',
    name: 'Colin Beers',
    email: 'cobeers12@gmail.com',
    membership: { stage: 'member', inactive: false },
    tags: ['Member'],
};

const colinInactive = {
    id: 'qBZMVskmS1CBJl8aCPcT',
    name: 'Colin Beers',
    phone: '6188891451',
    membership: { inactive: true },
    tags: ['Inactive'],
};

test('dedupeByPersonId keeps one row per id when lists are merged', () => {
    const merged = PeoplePickerCore.dedupeByPersonId([
        colinActive,
        colinActive,
        colinInactive,
        { id: 'NEW', name: 'Someone', isNew: true },
    ]);
    assert.strictEqual(merged.length, 3);
    assert.deepStrictEqual(merged.map(p => p.id), [
        colinActive.id,
        colinInactive.id,
        'NEW',
    ]);
});

test('finalizePickerList drops inactive people but keeps the current assignee', () => {
    const registry = [colinActive, colinInactive];
    const fuseHits = [colinActive, colinInactive];
    const offered = PeoplePickerCore.finalizePickerList(fuseHits, registry, {
        keepIds: [colinInactive.id],
    });
    assert.deepStrictEqual(offered.map(p => p.id), [colinActive.id, colinInactive.id]);

    const searchOnly = PeoplePickerCore.finalizePickerList(fuseHits, registry, {
        keepIds: [],
    });
    assert.deepStrictEqual(searchOnly.map(p => p.id), [colinActive.id]);
});

test('excludeIds removes suggestion rows from the search list', () => {
    const results = PeoplePickerCore.excludeIds(
        [colinActive, { id: 'p-other', name: 'Other' }],
        [colinActive],
    );
    assert.deepStrictEqual(results.map(p => p.id), ['p-other']);
});

test('optionLabel disambiguates two distinct people who share a name', () => {
    const visible = [colinActive, colinInactive];
    assert.strictEqual(
        PeoplePickerCore.optionLabel(colinActive, visible),
        'Colin Beers — cobeers12@gmail.com',
    );
    assert.strictEqual(
        PeoplePickerCore.optionLabel(colinInactive, visible),
        'Colin Beers — inactive',
    );
});

test('inactive filtering matches roles-core assignablePeople', () => {
    const registry = [colinActive, colinInactive];
    const assignable = Roles.assignablePeople(registry, {});
    assert.deepStrictEqual(assignable.map(p => p.id), [colinActive.id]);
});
