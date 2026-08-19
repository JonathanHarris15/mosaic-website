const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Usage stats — how many times each scripture reference has been used, and
// when last, maintained by updateOrderOfServiceUsageStats
// (functions/index.js) reacting to services/{date} writes. Like the other
// rules tests here, this cannot EXERCISE the rules — that needs a live
// project — it pins the SHAPE, so a refactor can't quietly widen write
// access without a test going red.

const rules = fs.readFileSync(
    path.join(__dirname, '..', 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');

const scriptureUsageBlock = () => {
    const m = rules.match(/match \/scripture_usage\/\{referenceId\}\s*\{([\s\S]*?)\n    \}/);
    assert.ok(m, 'no /scripture_usage rule block found');
    return m[1];
};

test('the scripture_usage collection exists and is world-readable', () => {
    assert.match(scriptureUsageBlock(), /allow read: if true/);
});

test('no client may create, edit or delete a scripture_usage doc — editors included', () => {
    const block = scriptureUsageBlock();
    assert.match(block, /allow create, update, delete: if false/);
    assert.doesNotMatch(block, /allow (create|update|delete)[^\n]*isEditor\(\)/,
        'counts are recomputed by the Cloud Function trigger from the whole ' +
        'history — a client writing its own count would drift from the real one');
    assert.doesNotMatch(block, /allow write/);
});
