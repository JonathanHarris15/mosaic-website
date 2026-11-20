const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');

// Doesn't serve, for a whole tag or group.
//
// A Non-server used to be one Person at a time (`doesNotServe` on their record).
// An editor may now say it of a whole Shepherding Tag ("Under 12s") or a whole
// Relationship Group ("Youth group"): everybody carrying the tag or in the group
// is never offered a Role, now and whenever they join it later. Stored once for
// the church, in serving_settings/church — not on the tag or group, because a
// group is an elder's record and an editor cannot write it.

/** @param {*} id @param {*} extra */
const person = (id, extra) => Object.assign({ id: id, name: id, tags: [] }, extra || {});
const ann = person('ann', { tags: ['under12'] });
const bob = person('bob');
const cat = person('cat');
const dan = person('dan', { doesNotServe: true });
const PEOPLE = [ann, bob, cat, dan];
const GROUPS = [{ id: 'youth', typeId: 't', leaderId: 'bob', memberIds: ['cat'] }];

/** @param {*} list */
const ids = list => list.map((/** @type {*} */ p) => p.id);

test('nobody is left out by an empty setting', () => {
    assert.deepEqual(ids(Roles.assignablePeople(PEOPLE, { nonServing: { tagIds: [], groupIds: [] } })), ['ann', 'bob', 'cat']);
});

test('a tag that does not serve takes out everyone carrying it', () => {
    const out = Roles.assignablePeople(PEOPLE, { nonServing: { tagIds: ['under12'], groupIds: [] } });
    assert.deepEqual(ids(out), ['bob', 'cat']);
});

test('a group that does not serve takes out its leader and members alike', () => {
    const out = Roles.assignablePeople(PEOPLE, { nonServing: { tagIds: [], groupIds: ['youth'] }, groups: GROUPS });
    assert.deepEqual(ids(out), ['ann']);
});

test('a person marked on their own record still does not serve', () => {
    assert.equal(ids(Roles.assignablePeople(PEOPLE, {})).indexOf('dan'), -1);
});

test('like a person\'s own mark, it applies to an elder looking too — it is not a privacy rule', () => {
    const out = Roles.assignablePeople(PEOPLE, { rank: 'elder', nonServing: { tagIds: ['under12'] } });
    assert.equal(ids(out).indexOf('ann'), -1);
});

test('a group this account cannot read takes nobody out rather than everybody', () => {
    const out = Roles.assignablePeople(PEOPLE, { nonServing: { groupIds: ['unknown'] }, groups: GROUPS });
    assert.deepEqual(ids(out), ['ann', 'bob', 'cat']);
});

test('nonServingSetting reads a stored document, and a missing one as nothing', () => {
    assert.deepEqual(Roles.nonServingSetting(null), { tagIds: [], groupIds: [] });
    assert.deepEqual(
        Roles.nonServingSetting({ doesNotServeTagIds: ['a'], doesNotServeGroupIds: ['g'], junk: 1 }),
        { tagIds: ['a'], groupIds: ['g'] }
    );
});

test('who a tag or group covers can be counted for the page', () => {
    assert.deepEqual(Roles.coveredByNonServing(PEOPLE, { kind: 'tag', id: 'under12' }, GROUPS).map((/** @type {*} */ p) => p.id), ['ann']);
    assert.deepEqual(Roles.coveredByNonServing(PEOPLE, { kind: 'group', id: 'youth' }, GROUPS).map((/** @type {*} */ p) => p.id).sort(), ['bob', 'cat']);
});

// ── Who may write it ─────────────────────────────────────────────────────────

test('the setting is one document an editor writes, with nothing else in it', () => {
    const rules = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'firestore.rules'), 'utf8');
    const block = (rules.match(/match \/serving_settings\/\{docId\}\s*\{([\s\S]*?)\n {4}\}/) || [])[1];
    assert.ok(block, 'there is no rule for serving_settings');
    assert.match(block, /allow read: if isSignedIn\(\);/);
    assert.match(block, /allow create, update: if isEditor\(\) && docId == 'church'/);
    assert.match(block, /hasOnly\(\['doesNotServeTagIds', 'doesNotServeGroupIds', 'updatedAt'\]\)/);
    assert.match(block, /allow delete: if false;/);
    assert.equal(Roles.NON_SERVING_DOC.collection, 'serving_settings');
    assert.equal(Roles.NON_SERVING_DOC.id, 'church');
});
