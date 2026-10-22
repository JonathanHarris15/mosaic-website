const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Events = require('../public/events-core.js');

// Firestore config can't be unit-tested against a live project from here, but it
// CAN be pinned to what the code actually queries. These guard the two ways this
// config silently rots: an index quietly dropped while the query that needs it
// stays, and a new collection landing without a rule (Firestore then denies
// everything, which looks like a bug anywhere but here).

const root = path.join(__dirname, '..');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const indexes = JSON.parse(fs.readFileSync(path.join(root, 'firestore.indexes.json'), 'utf8'));
const { FirestoreApi } = require('firebase-tools/lib/firestore/api');
const firestoreIndexApi = new FirestoreApi(null);

const involvementIndexes = indexes.indexes.filter(i => i.collectionGroup === 'involvement');
const fieldPaths = index => index.fields.map(f => f.fieldPath);

// ── Indexes for the per-series serve-history queries ──────────────────────────

test('serve history can be queried for one Event series, newest first', () => {
    const found = involvementIndexes.find(i =>
        JSON.stringify(fieldPaths(i)) === JSON.stringify(['seriesId', 'serviceDate']));
    assert.ok(found, 'missing the seriesId + serviceDate index');
    assert.equal(found.fields[1].order, 'DESCENDING', 'newest first');
});

test('serve history can be queried for one Role within one series', () => {
    const found = involvementIndexes.find(i =>
        JSON.stringify(fieldPaths(i)) === JSON.stringify(['seriesId', 'type', 'serviceDate']));
    assert.ok(found, 'missing the seriesId + type + serviceDate index');
});

test('the serve-history indexes are collection-group scoped', () => {
    // Involvement lives under each Person, so fairness has to sweep every
    // Person's records in one query. A COLLECTION-scoped index cannot do that.
    assert.ok(involvementIndexes.length > 0);
    involvementIndexes.forEach(i => {
        assert.equal(i.queryScope, 'COLLECTION_GROUP', JSON.stringify(fieldPaths(i)));
    });
});

test('every index leads with the series, so a query can never span series', () => {
    // Fairness is per series (ADR-0016 §5). An index that let seriesId be
    // skipped would quietly permit a global serve count.
    involvementIndexes.forEach(i => {
        assert.equal(fieldPaths(i)[0], 'seriesId');
    });
});

test('the indexes file is a plain valid index spec', () => {
    // No comment keys: the file is schema-validated on deploy.
    indexes.indexes.forEach(i => {
        assert.deepEqual(
            Object.keys(i).sort(),
            ['collectionGroup', 'fields', 'queryScope']
        );
    });
});

test('the indexes file passes Firebase CLI schema validation', () => {
    firestoreIndexApi.validateSpec(indexes);
});

test('field overrides use fieldPath, not composite index shape', () => {
    indexes.fieldOverrides.forEach(fo => {
        assert.deepEqual(
            Object.keys(fo).sort(),
            ['collectionGroup', 'fieldPath', 'indexes']
        );
    });
});

test('the event-tell job can query told announcements across occurrences', () => {
    const found = indexes.fieldOverrides.find(fo =>
        fo.collectionGroup === 'announcement_going_out' && fo.fieldPath === 'way');
    assert.ok(found, 'missing collection-group index on announcement_going_out.way');
    const group = found.indexes.find(i => i.queryScope === 'COLLECTION_GROUP');
    assert.ok(group, 'needs COLLECTION_GROUP scope for collectionGroup().where(way)');
    assert.equal(group.order, 'ASCENDING');
});

// ── Rules for the new collections ─────────────────────────────────────────────

test('roles and events are writable by editors only', () => {
    ['roles', 'events'].forEach(collection => {
        const block = rules.match(
            new RegExp('match /' + collection + '/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n    \\}')
        );
        assert.ok(block, 'no rule block for /' + collection);
        // MS-722: the level names, OR the MS-695 key Admin Accounts grants.
        assert.match(block[1], /allow create, update, delete: if editsWith\('(roles\.manager|calendar\.events)\.edit'\)/);
    });
});

test('the permission tiers are accessRank and the key helpers', () => {
    // ADR-0016 builds on what exists; a bespoke tier here would be a second way
    // to say "editor" that could drift from the first. Composition helpers (e.g.
    // canReadRelationshipRecord, MS-133) are fine — they must be BUILT from
    // these, never replace them — so this pins the tier helpers specifically
    // rather than the whole function list.
    // MS-776: permissionLevel() is gone. Rank labels come from accessRank().
    // isMember() is the member floor (MS-99): a viewer is signed in but sees
    // only public things. isElder() is the count-as-elder key, not a rank list.
    ['accessRank', 'isAdmin', 'isEditor', 'isElder', 'isMember'].forEach(name => {
        assert.ok(rules.includes(`function ${name}()`), `missing ${name}()`);
    });
    assert.equal(rules.includes('function permissionLevel()'), false);
    assert.equal(/function usesPermissionMap\(/.test(rules), false);

    const isAdmin = rules.match(/function isAdmin\(\) \{\s*return ([\s\S]*?)\n {4}\}/);
    assert.ok(isAdmin, 'isAdmin() missing');
    assert.match(isAdmin[1], /accessRank\(\) == 'admin'/);
    assert.match(isAdmin[1], /accessRank\(\) == 'super_admin'/);
    assert.match(isAdmin[1], /keyOn\('admin\.dashboard\.access'\)/);

    const isEditor = rules.match(/function isEditor\(\) \{\s*return ([\s\S]*?)\n {4}\}/);
    assert.ok(isEditor, 'isEditor() missing');
    assert.match(isEditor[1],
        /accessRank\(\) in \['editor', 'admin', 'elder', 'super_admin', 'pastoral_assistant'\]/);
    ['directory.edit_identity', 'printables.edit', 'services.builder.edit',
        'roles.manager.edit', 'hymns.edit'].forEach(key => {
        assert.match(isEditor[1], new RegExp("keyOn\\('" + key + "'\\)"));
    });

    const isMember = rules.match(/function isMember\(\) \{\s*return ([\s\S]*?)\n {4}\}/);
    assert.ok(isMember, 'isMember() missing');
    assert.match(isMember[1],
        /accessRank\(\) in \['member', 'editor', 'admin', 'elder', 'super_admin', 'pastoral_assistant'\]/);
    assert.match(isMember[1], /keyOn\('directory\.view'\)/);
    assert.match(isMember[1], /keyOn\('visibility\.rung\.member'\)/);
    assert.match(isMember[1], /isEditor\(\)/);

    const isElder = rules.match(/function isElder\(\) \{\s*return ([\s\S]*?)\n {4}\}/);
    assert.ok(isElder, 'isElder() missing');
    assert.match(isElder[1], /keyOn\('shep\.count_as_elder'\)/);
    assert.doesNotMatch(isElder[1], /in \[/);

    const rankLists = rules.match(/accessRank\(\) in \[[^\]]*\]/g) || [];
    assert.equal(rankLists.length, 2, 'member and editor are the accessRank lists');
});

// ── No parallel data universe ─────────────────────────────────────────────────

test('no scheduler_ collection appears in the Firestore config', () => {
    assert.equal(/scheduler_/.test(rules), false, 'firestore.rules');
    assert.equal(/scheduler_/.test(JSON.stringify(indexes)), false, 'firestore.indexes.json');
});

test('the series the indexes are built for is the one the code writes', () => {
    assert.equal(Events.SUNDAY_SERVICE_ID, 'sunday_service');
});
