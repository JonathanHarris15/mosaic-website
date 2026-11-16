const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The nudge record (MS-248, MS-438): what the scheduler remembers it sent.
//
// Like the other rules tests here, these pin the SHAPE rather than exercising
// the rules. The record is server-only: no client may read it (it would tell a
// member who else has not answered) and no client may write it (a member who
// could stamp their own record could switch their nudges off, and an editor's
// page that wrote it would be the roster-row wipe the record exists to avoid).

const rules = fs.readFileSync(
    path.join(__dirname, '..', 'firestore.rules'), 'utf8');

const nudgeBlock = () => {
    const m = rules.match(/match \/assignment_nudges\/\{recordId\}\s*\{([\s\S]*?)\n    \}/);
    assert.ok(m, 'MS-248 needs an /assignment_nudges collection');
    return m[1];
};

test('the nudge record collection exists', () => {
    assert.ok(nudgeBlock());
});

test('nobody reads or writes a nudge record from a client, not even an admin', () => {
    const block = nudgeBlock();
    assert.match(block, /allow read, write: if false;/);
    const allows = block.match(/allow [^;]*;/g) || [];
    assert.deepEqual(allows, ['allow read, write: if false;'],
        'one closed door and nothing else');
});

test('the scheduler names the same collection the rules close', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'functions', 'assignment-nudge-firestore.js'), 'utf8');
    assert.match(src, /["']assignment_nudges["']/);
});
