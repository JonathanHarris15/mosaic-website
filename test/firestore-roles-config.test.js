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

// ── Rules for the new collections ─────────────────────────────────────────────

test('roles and events are writable by editors only', () => {
    ['roles', 'events'].forEach(collection => {
        const block = rules.match(
            new RegExp('match /' + collection + '/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n    \\}')
        );
        assert.ok(block, 'no rule block for /' + collection);
        assert.match(block[1], /allow create, update, delete: if isEditor\(\)/);
    });
});

test('the new rules introduce no new permission concept', () => {
    // ADR-0016 builds on what exists; a bespoke helper here would be a second
    // way to say "editor" that could drift from the first.
    const helpers = rules.match(/function \w+\(\)/g) || [];
    assert.deepEqual(
        helpers.sort(),
        ['function isAdmin()', 'function isEditor()', 'function isElder()', 'function permissionLevel()']
    );
});

// ── No parallel data universe ─────────────────────────────────────────────────

test('no scheduler_ collection appears in the Firestore config', () => {
    assert.equal(/scheduler_/.test(rules), false, 'firestore.rules');
    assert.equal(/scheduler_/.test(JSON.stringify(indexes)), false, 'firestore.indexes.json');
});

test('the series the indexes are built for is the one the code writes', () => {
    assert.equal(Events.SUNDAY_SERVICE_ID, 'sunday_service');
});
