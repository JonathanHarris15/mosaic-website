const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The cover list's query needs a composite index (MS-20).
//
// ⚠ AN INDEX IS PART OF THE FEATURE, NOT PART OF THE INFRASTRUCTURE. Firestore
// refuses a query it has no index for, and the refusal arrives in the browser
// as a thrown error — so the page does not degrade, it dies, and the reader is
// told "Something went wrong" on a screen whose whole job is to say what the
// church needs.
//
// The tempting fix is the link in the error message, which creates the index in
// the console and leaves the repo none the wiser. Then the next project, the
// next emulator, and anybody restoring from this repo all get a page that has
// never worked. So it lives in firestore.indexes.json, and this holds the file
// against the query it exists for.
//
// The WHY of the index lives here rather than in the JSON, because that file is
// schema-validated on deploy and carries no comment keys — see
// test/firestore-roles-config.test.js, which enforces exactly that.
//
// What the shape is for: the page reads with an `in` over the rungs this viewer
// may see, then a range on date. The rung filter is not an optimisation and
// cannot be dropped — it is what makes the read legal at all — so this index is
// a hard requirement of the page rather than a tuning choice.

const ROOT = path.join(__dirname, '..');

const indexes = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8')).indexes;
const store = fs.readFileSync(
    path.join(ROOT, 'public/cover-store.js'), 'utf8');

test('the cover query’s index is in the repo, not only in the console', () => {
    const hit = indexes.find(i => i.collectionGroup === 'cover');
    assert.ok(hit, 'the cover list will throw on its first read');

    assert.deepEqual(hit.fields.map(f => f.fieldPath), ['visibility', 'date'],
        'the index no longer matches the order the query filters in');
    hit.fields.forEach(f =>
        assert.equal(f.order, 'ASCENDING', f.fieldPath));
});

// The index is shaped by the query, so if the query changes shape the index is
// wrong and nothing else would notice until somebody opened the page.
test('the query is still the shape that index serves', () => {
    assert.match(store, /\.where\('visibility', 'in', rungs\)/,
        'the rung filter is what makes this read legal — it cannot be dropped');
    assert.match(store, /\.where\('date', '>=', opts\.from\)/);
    assert.doesNotMatch(store, /\.orderBy\(/,
        'an `in` filter, a range and an orderBy is more than Firestore will ' +
        'combine — the sort is done client-side on purpose');
});
