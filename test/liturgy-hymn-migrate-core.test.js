// MS-731 — copy legacy Standard hymn slots onto the live order ids.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/liturgy-hymn-migrate-core.js');

function hymn(id, name) {
    return {id: id, name: name};
}

test('maps every seed hymn onto the live Standard hymn id', () => {
    assert.deepEqual(Core.LEGACY_TO_LIVE.map((r) => [r.from, r.to]), [
        ['preparatoryHymn', 'hymn2'],
        ['hymn1', 'hymn6'],
        ['hymn2', 'hymn7'],
        ['hymnMid1', 'hymn'],
        ['hymnMid2', 'hymn3'],
        ['hymnEnd1', 'hymn4'],
        ['hymnEnd2', 'hymn5'],
    ]);
});

test('an empty Sunday plans nothing', () => {
    const plan = Core.planServiceHymnMigration({liturgy: {}});
    assert.deepEqual(plan.changes, []);
    assert.deepEqual(plan.update, {});
});

test('copies seven legacy hymns onto empty live slots', () => {
    const doc = {
        liturgy: {
            preparatoryHymn: hymn('p', 'Prep'),
            hymn1: hymn('1', 'One'),
            hymn2: hymn('2', 'Two'),
            hymnMid1: hymn('m1', 'Mid1'),
            hymnMid2: hymn('m2', 'Mid2'),
            hymnEnd1: hymn('e1', 'End1'),
            hymnEnd2: hymn('e2', 'End2'),
        },
        decidedBy: {
            preparatoryHymn: {id: 'u', name: 'Ada'},
            hymn2: {id: 'u', name: 'Ada'},
        },
        notes: {
            hymnMid1: 'sing verse 2',
        },
    };
    const plan = Core.planServiceHymnMigration(doc);
    assert.equal(plan.update['liturgy.hymn2'].name, 'Prep');
    assert.equal(plan.update['liturgy.hymn6'].name, 'One');
    assert.equal(plan.update['liturgy.hymn7'].name, 'Two');
    assert.equal(plan.update['liturgy.hymn'].name, 'Mid1');
    assert.equal(plan.update['liturgy.hymn3'].name, 'Mid2');
    assert.equal(plan.update['liturgy.hymn4'].name, 'End1');
    assert.equal(plan.update['liturgy.hymn5'].name, 'End2');
    // decidedBy.hymn2 already matched preparatoryHymn's stamp — no rewrite.
    assert.equal(plan.update['decidedBy.hymn2'], undefined);
    assert.deepEqual(plan.update['decidedBy.hymn7'], {id: 'u', name: 'Ada'});
    assert.equal(plan.update['notes.hymn'], 'sing verse 2');
    assert.equal(Object.keys(plan.update).filter((k) => k.startsWith('liturgy.')).length, 7);
});

test('hymn2 collision: preparatory wins the live preparatory slot; Hymn 2 goes to hymn7', () => {
    const collided = {
        liturgy: {
            preparatoryHymn: hymn('prep', 'Tis So Sweet'),
            hymn1: hymn('one', 'How Rich'),
            hymn2: hymn('two', 'Jesus Friend'),
            hymnMid1: hymn('m1', 'Take My Life'),
            hymnMid2: hymn('m2', 'Deep Love'),
            hymnEnd1: hymn('e1', 'All Hail'),
            hymnEnd2: hymn('e2', 'Victory'),
        },
    };
    const plan = Core.planServiceHymnMigration(collided);
    assert.equal(plan.update['liturgy.hymn2'].id, 'prep');
    assert.equal(plan.update['liturgy.hymn7'].id, 'two');
    assert.equal(plan.update['liturgy.hymn6'].id, 'one');
});

test('second pass is a no-op after collision is resolved', () => {
    const prep = hymn('prep', 'Tis So Sweet');
    const one = hymn('one', 'How Rich');
    const two = hymn('two', 'Jesus Friend');
    const m1 = hymn('m1', 'Take My Life');
    const m2 = hymn('m2', 'Deep Love');
    const e1 = hymn('e1', 'All Hail');
    const e2 = hymn('e2', 'Victory');
    const doc = {
        liturgy: {
            preparatoryHymn: prep,
            hymn1: one,
            hymn2: prep,
            hymnMid1: m1,
            hymnMid2: m2,
            hymnEnd1: e1,
            hymnEnd2: e2,
            hymn6: one,
            hymn7: two,
            hymn: m1,
            hymn3: m2,
            hymn4: e1,
            hymn5: e2,
        },
        decidedBy: {
            preparatoryHymn: {id: 'u', name: 'Ada'},
            hymn2: {id: 'u', name: 'Ada'},
            hymn7: {id: 'u', name: 'Ada'},
        },
    };
    const plan = Core.planServiceHymnMigration(doc);
    assert.deepEqual(plan.update, {});
    assert.deepEqual(plan.changes, []);
});

test('partial Sundays only fill the missing live slots', () => {
    const doc = {
        liturgy: {
            preparatoryHymn: hymn('prep', 'Prep'),
            hymn1: hymn('one', 'One'),
            hymn2: hymn('prep', 'Prep'),
            hymn6: hymn('one', 'One'),
            hymnMid1: hymn('m1', 'Mid1'),
        },
    };
    const plan = Core.planServiceHymnMigration(doc);
    assert.equal(plan.update['liturgy.hymn'].id, 'm1');
    assert.equal(plan.update['liturgy.hymn6'], undefined);
    assert.equal(plan.update['liturgy.hymn2'], undefined);
    assert.equal(plan.update['liturgy.hymn7'], undefined);
});

test('freehand name without an id still migrates', () => {
    const doc = {liturgy: {hymn1: {id: null, name: 'A New Song'}}};
    const plan = Core.planServiceHymnMigration(doc);
    assert.deepEqual(plan.update['liturgy.hymn6'], {id: null, name: 'A New Song'});
});
