const { test } = require('node:test');
const assert = require('node:assert');

const Merge = require('../public/merge-duplicate-person-core.js');

const FROM = 'qBZMVskmS1CBJl8aCPcT';
const TO = 'Rqu2n9V9vRBLF8TKkEwg';
const NAME = 'Colin Beers';

test('repoints service top-level and carriedBy references', () => {
    const service = {
        preacherId: FROM,
        carriedBy: {
            prayerOfPraise: { id: FROM, name: 'Duplicate' },
        },
        musicHelpers: [{ id: FROM, name: 'Dup' }, { id: TO, name: NAME }],
    };
    const { patch, changed } = Merge.planDocumentRepoint(
        'services', '2026-01-05', service, FROM, TO, NAME);
    assert.equal(changed, true);
    assert.equal(patch.preacherId, TO);
    assert.equal(patch.carriedBy.prayerOfPraise.id, TO);
    assert.equal(patch.musicHelpers.length, 1);
    assert.equal(patch.musicHelpers[0].id, TO);
});

test('merges family childIds without duplicates', () => {
    const family = { husbandId: 'h1', childIds: [FROM, 'kid2', TO] };
    const { patch, changed } = Merge.planDocumentRepoint(
        'families', 'fam1', family, FROM, TO, NAME);
    assert.equal(changed, true);
    assert.deepStrictEqual(patch.childIds, [TO, 'kid2']);
});

test('repoints roster assignment personId', () => {
    const assignment = { personId: FROM, roleSlug: 'kids', slotId: 's1' };
    const { patch, changed } = Merge.planDocumentRepoint(
        'roster', 'a1', assignment, FROM, TO, NAME);
    assert.equal(changed, true);
    assert.equal(patch.personId, TO);
});

test('mergeStringArray dedupes after repoint', () => {
    assert.deepStrictEqual(
        Merge.mergeStringArray([FROM, TO, 'other'], FROM, TO),
        [TO, 'other'],
    );
});

test('documentContainsPersonId finds nested carriedBy', () => {
    const doc = { carriedBy: { hymn1: { id: FROM, name: 'x' } } };
    assert.equal(Merge.documentContainsPersonId(doc, FROM), true);
    assert.equal(Merge.documentContainsPersonId(doc, 'nobody'), false);
});

test('careListData key move conflicts when target row exists', () => {
    const doc = {
        careListData: {
            [FROM]: { col_default: 'notes' },
            [TO]: { col_default: 'existing' },
        },
    };
    const { conflicts } = Merge.planDocumentRepoint(
        'elder_documents', 'doc1', doc, FROM, TO, NAME);
    assert.equal(conflicts.length, 1);
});
