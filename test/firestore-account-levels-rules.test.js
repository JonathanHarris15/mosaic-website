const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

test('account_levels are admin-only', () => {
    const block = rules.match(/match \/account_levels\/\{levelId\} \{[\s\S]*?\n    \}/);
    assert.ok(block, 'account_levels match block missing');
    assert.match(block[0], /allow read: if isAdmin\(\)/);
    assert.match(block[0], /allow create, update, delete: if isAdmin\(\)/);
});

test('rules read denormalized permissions when present', () => {
    assert.match(rules, /function hasPermission\(key\)/);
    assert.match(rules, /hasPermission\('visibility\.lift_hidden_tags'\)/);
    assert.match(rules, /hasPermission\('shep\.count_as_elder'\)/);
});
