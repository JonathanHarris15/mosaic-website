// The ghost congregation is invented. It must refuse the church project even
// when the loud prod flag is present, and every contact has to be obviously
// fake so a copy of the church roster cannot sneak through this script.

const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {PROD_PROJECT_ID} = require('../scripts/firebase-project');
const {
    GHOST_PROJECT_ID,
    GHOST_PASSWORD,
    assertGhostTarget,
    congregation,
} = require('../scripts/seed-ghost');

test('the ghost seed refuses the church project even with the loud flag', () => {
    assert.throws(
        () => assertGhostTarget(PROD_PROJECT_ID),
        /mosaic-hymn-database/);
    assert.throws(
        () => assertGhostTarget('mosaic-hymn-ghost'),
        /mosaic-manager-ghost/);
    assert.doesNotThrow(() => assertGhostTarget(GHOST_PROJECT_ID));
});

test('the invented congregation uses fake phones, fake emails, and a household', () => {
    const plan = congregation('2026-09-21T00:00:00.000Z', {
        'ghost-ada-cole': 'uid-ada',
        'ghost-ben-cole': 'uid-ben',
        'ghost-sam-reed': 'uid-sam',
    });
    assert.ok(plan.people.length >= 3);
    for (const person of plan.people) {
        assert.match(person.doc.contact.phone, /^\+1555/);
        assert.match(person.doc.contact.email, /@example\.test$/);
        assert.strictEqual(person.doc.password, undefined);
        const blob = JSON.stringify(person.doc);
        assert.ok(!blob.includes(GHOST_PASSWORD));
    }
    const byId = Object.fromEntries(plan.people.map(p => [p.id, p]));
    assert.strictEqual(byId['ghost-ada-cole'].doc.sex, 'female');
    assert.strictEqual(byId['ghost-ben-cole'].doc.sex, 'male');
    assert.strictEqual(byId['ghost-cora-cole'].doc.kid, true);
    assert.strictEqual(byId['ghost-ada-cole'].account.permissionLevel, 'elder');
    assert.strictEqual(byId['ghost-ben-cole'].account.permissionLevel, 'member');
    assert.strictEqual(byId['ghost-sam-reed'].account.permissionLevel, 'super_admin');
    assert.strictEqual(byId['ghost-sam-reed'].account.email, 'sam.reed@example.test');
    assert.strictEqual(byId['ghost-sam-reed'].doc.userId, 'uid-sam');
    assert.strictEqual(byId['ghost-sam-reed'].doc.accountRank, 'super_admin');
    assert.strictEqual(byId['ghost-cora-cole'].account, null);
    assert.strictEqual(byId['ghost-drew-lane'].doc.membership.stage, 'visitor');
    assert.strictEqual(byId['ghost-ada-cole'].doc.userId, 'uid-ada');
    assert.strictEqual(byId['ghost-ada-cole'].doc.accountRank, 'elder');
    assert.strictEqual(plan.family.doc.husbandId, 'ghost-ben-cole');
    assert.strictEqual(plan.family.doc.wifeId, 'ghost-ada-cole');
    assert.deepStrictEqual(plan.family.doc.childIds, ['ghost-cora-cole']);
    assert.deepStrictEqual(
        plan.household.doc.memberIds,
        ['ghost-ada-cole', 'ghost-ben-cole', 'ghost-cora-cole']);
    assert.strictEqual(plan.household.doc.name, 'The Cole Household');
});

test('the seed script checks the project before it opens a credential', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'seed-ghost.js'), 'utf8');
    const guard = src.indexOf('assertGhostTarget(projectId)');
    const credential = src.indexOf('serviceAccount()');
    assert.ok(guard > 0 && credential > guard);
});
