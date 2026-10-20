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

test('attendance move becomes keep-target drop when flag set and target exists', () => {
    const plan = Merge.planAttendanceDocMove(
        'sunday_service_2026-10-18', FROM, TO, { present: true }, true,
        { attendanceConflict: 'keep-target' },
    );
    assert.equal(plan.action, 'attendance_keep_target');
    assert.equal(plan.dropPath, `event_occurrences/sunday_service_2026-10-18/attendance/${FROM}`);
    assert.equal(plan.keepPath, `event_occurrences/sunday_service_2026-10-18/attendance/${TO}`);
});

test('attendance still conflicts when target exists and flag omitted', () => {
    const plan = Merge.planAttendanceDocMove(
        'sunday_service_2026-10-18', FROM, TO, { present: true }, true);
    assert.equal(plan.action, 'conflict');
    assert.equal(plan.reason, 'attendance_target_exists');
});

test('planPersonSubdocMove repoints personId inside moved payload', () => {
    const fromPath = `people/${FROM}/shepherding_activity/act1`;
    const toPath = `people/${TO}/shepherding_activity/act1`;
    const move = Merge.planPersonSubdocMove(
        fromPath, toPath, { personId: FROM, note: 'x' }, false, FROM, TO, NAME);
    assert.equal(move.action, 'move');
    assert.equal(move.data.personId, TO);
});

test('planPersonSubdocMove aborts on target id collision', () => {
    const move = Merge.planPersonSubdocMove(
        `people/${FROM}/shepherding_activity/a`,
        `people/${TO}/shepherding_activity/a`,
        {}, true, FROM, TO, NAME);
    assert.equal(move.action, 'conflict');
    assert.equal(move.reason, 'target_doc_exists');
});

test('sortMovesByDepthDesc orders nested person paths before parents', () => {
    const sorted = Merge.sortMovesByDepthDesc([
        { fromPath: `people/${FROM}/notes/n1` },
        { fromPath: `people/${FROM}/notes/n1/revisions/r1` },
    ]);
    assert.ok(Merge.pathDepth(sorted[0].fromPath) >= Merge.pathDepth(sorted[1].fromPath));
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
