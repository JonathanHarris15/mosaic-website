const { test } = require('node:test');
const assert = require('node:assert');

const { planFamilyMerges } = require('../scripts/merge-duplicate-families.js');
const Family = require('../public/family-core.js');

// One couple, one household. The repair for the Families that were minted one
// per child before planAddFamilyRelation learned to look for the parent's own
// marriage. Two Families belong to the same household when they share a spouse,
// so a merge is the transitive closure of that: keep one, union the children in,
// delete the rest.

const SAM = 'sam', MOLLY = 'molly';
const KIDS = ['june', 'jacob', 'piper', 'nora', 'ford'];

// The shape found in production: the marriage, plus one Family per child.
const crites = () => [
    { id: 'marriage', husbandId: SAM, wifeId: MOLLY, childIds: [], anniversary: '2009-06-13' },
].concat(KIDS.map((kid, i) => (
    { id: 'dup' + i, husbandId: SAM, wifeId: MOLLY, childIds: [kid] }
)));

test('a couple recorded six times collapses to one household with every child', () => {
    const { merges, conflicts } = planFamilyMerges(crites());
    assert.strictEqual(conflicts.length, 0);
    assert.strictEqual(merges.length, 1);
    const m = merges[0];
    assert.strictEqual(m.keepId, 'marriage');          // it carries the anniversary
    assert.strictEqual(m.dropIds.length, 5);
    assert.deepStrictEqual(m.changes.childIds, KIDS);
});

test('after the merge nobody is a spouse in two Families', () => {
    const merged = apply(crites(), planFamilyMerges(crites()).merges);
    for (const personId of [SAM, MOLLY]) {
        const seatedIn = merged.filter(f => f.husbandId === personId || f.wifeId === personId);
        assert.strictEqual(seatedIn.length, 1, `${personId} sits in ${seatedIn.length} Families`);
    }
    // And the family reads whole from either end.
    assert.deepStrictEqual(Family.resolveRelations(merged, SAM).childIds, KIDS);
    assert.strictEqual(Family.resolveRelations(merged, 'piper').spouseId, null);
    assert.deepStrictEqual(Family.resolveRelations(merged, 'piper').parentIds, [SAM, MOLLY]);
});

test('running it twice changes nothing the second time', () => {
    const once = apply(crites(), planFamilyMerges(crites()).merges);
    assert.deepStrictEqual(planFamilyMerges(once), { merges: [], conflicts: [] });
});

test('households join through a shared spouse, not just an identical pair', () => {
    // Sam+Molly, and Sam alone with a child: the same household by way of Sam.
    const { merges } = planFamilyMerges([
        { id: 'a', husbandId: SAM, wifeId: MOLLY, childIds: [] },
        { id: 'b', husbandId: SAM, childIds: ['june'] },
    ]);
    assert.strictEqual(merges.length, 1);
    assert.deepStrictEqual(merges[0].changes.childIds, ['june']);
});

test('two different wives is a disagreement, so it is reported and left alone', () => {
    const { merges, conflicts } = planFamilyMerges([
        { id: 'a', husbandId: SAM, wifeId: MOLLY, childIds: [] },
        { id: 'b', husbandId: SAM, wifeId: 'jane', childIds: ['june'] },
    ]);
    assert.strictEqual(merges.length, 0);
    assert.strictEqual(conflicts.length, 1);
    assert.deepStrictEqual(conflicts[0].familyIds, ['a', 'b']);
});

test('separate households are left alone', () => {
    const families = [
        { id: 'a', husbandId: SAM, wifeId: MOLLY, childIds: ['june'] },
        { id: 'b', husbandId: 'rob', wifeId: 'mary', childIds: ['ben'] },
    ];
    assert.deepStrictEqual(planFamilyMerges(families), { merges: [], conflicts: [] });
});

test('a Family with no spouse seated is nobody else’s household', () => {
    // Children with no recorded parents must not all be swept into one Family.
    const families = [
        { id: 'a', childIds: ['june'] },
        { id: 'b', childIds: ['ben'] },
    ];
    assert.deepStrictEqual(planFamilyMerges(families), { merges: [], conflicts: [] });
});

// Apply the plan the way the script does, so the assertions above are about the
// data that would actually result.
function apply(families, merges) {
    let out = families.map(f => ({ ...f }));
    merges.forEach(m => {
        out = out
            .filter(f => m.dropIds.indexOf(f.id) === -1)
            .map(f => (f.id === m.keepId ? { ...f, ...m.changes } : f));
    });
    return out;
}
