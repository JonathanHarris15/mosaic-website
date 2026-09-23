const { test } = require('node:test');
const assert = require('node:assert');

const Backfill = require('../scripts/backfill-name-parts.js');
const Household = require('../public/household-core.js');

test('a readable name is a parts write, and the full name is not in it', () => {
    const plan = Backfill.planPerson({ name: 'Jonathan Harris Jr.' });
    assert.strictEqual(plan.write, true);
    assert.deepStrictEqual(Object.keys(plan.update), ['nameParts']);
    assert.strictEqual(plan.update.name, undefined);
    assert.deepStrictEqual(plan.update.nameParts, {
        firstName: 'Jonathan',
        lastName: 'Harris',
        suffix: 'Jr.',
        noLastName: false,
    });
});

test('someone who already has parts is skipped, even when they disagree with the full name', () => {
    const parts = { firstName: 'Jon', lastName: 'H', suffix: '', noLastName: false };
    const plan = Backfill.planPerson({
        name: 'Jonathan Harris',
        nameParts: parts,
    });
    assert.strictEqual(plan.write, false);
    assert.strictEqual(plan.reason, 'already');
});

test('a name that cannot be read is skipped', () => {
    assert.strictEqual(Backfill.planPerson({ name: 'Madonna' }).write, false);
    assert.strictEqual(Backfill.planPerson({ name: 'Harris, Jonathan' }).reason, 'not-taken-apart');
    assert.strictEqual(Backfill.planPerson({ name: '   ' }).write, false);
    assert.strictEqual(Backfill.planPerson({}).write, false);
});

test('planning the same person again after the write is a skip', () => {
    const first = Backfill.planPerson({ name: 'Mary Anne Harris' });
    assert.strictEqual(first.write, true);
    const second = Backfill.planPerson({
        name: 'Mary Anne Harris',
        nameParts: first.update.nameParts,
    });
    assert.strictEqual(second.write, false);
    assert.strictEqual(second.reason, 'already');
});

test('the default run does not write, and only the church project is allowed', () => {
    assert.strictEqual(Backfill.committing(['node', 'backfill-name-parts.js']), false);
    assert.strictEqual(Backfill.committing([
        'node', 'backfill-name-parts.js', '--project', 'mosaic-hymn-database', '--i-mean-prod',
    ]), false);
    assert.strictEqual(Backfill.committing([
        'node', 'backfill-name-parts.js', '--commit',
    ]), true);
    assert.strictEqual(
        Backfill.allowedProject([
            'node', 'backfill-name-parts.js',
            '--project', 'mosaic-hymn-database',
            '--i-mean-prod',
        ]),
        'mosaic-hymn-database'
    );
    assert.throws(() => Backfill.allowedProject([
        'node', 'backfill-name-parts.js',
        '--project', 'mosaic-manager-ghost',
        '--i-mean-prod',
    ]));
    assert.throws(() => Backfill.allowedProject([
        'node', 'backfill-name-parts.js',
        '--project', 'mosaic-hymn-database',
    ]));
});

test('remembered parts name a projected Household after Harris, not Jr.', () => {
    const plan = Backfill.planPerson({ name: 'Jonathan Harris Jr.' });
    const households = Household.householdsFromDirectory([{
        id: 'jon',
        name: 'Jonathan Harris Jr.',
        nameParts: plan.update.nameParts,
    }], []);
    const solo = households.find(h => h.id === 'person:jon');
    assert.strictEqual(solo.name, 'The Harris Household');
});
