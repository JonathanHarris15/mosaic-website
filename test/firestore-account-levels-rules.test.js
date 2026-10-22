const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

test('account_levels are admin-only', () => {
    const block = rules.match(/match \/account_levels\/\{levelId\} \{[\s\S]*?\n {4}\}/);
    assert.ok(block, 'account_levels match block missing');
    assert.match(block[0], /allow read: if isAdmin\(\)/);
    assert.match(block[0], /allow create, update, delete: if isAdmin\(\)/);
});

test('a saved permissions map is the whole answer', () => {
    // MS-776: permissions present → mapGrants, even when the value is not a
    // map (that grants nothing and does not fall through). No permissions
    // field → accountLevelId via presetGrants. role and permissionLevel are
    // not read. system.super_admin true opens every key.
    const keyOn = rules.match(/function keyOn\(key\) \{\s*return ([\s\S]*?)\n {4}\}/);
    assert.ok(keyOn, 'keyOn() missing');
    assert.match(keyOn[1], /'permissions' in signedInUserData\(\)/);
    assert.match(keyOn[1], /\? mapGrants\(signedInUserData\(\)\.permissions, key\)/);
    assert.match(keyOn[1], /'accountLevelId' in signedInUserData\(\)/);
    assert.match(keyOn[1], /presetGrants\(signedInUserData\(\)\.accountLevelId, key\)/);
    assert.doesNotMatch(keyOn[1], /permissionLevel|\brole\b|pastoralAssistant/);

    const mapGrants = rules.match(/function mapGrants\(perms, key\) \{\s*return ([\s\S]*?)\n {4}\}/);
    assert.ok(mapGrants, 'mapGrants() missing');
    assert.match(mapGrants[1], /perms is map/);
    assert.match(mapGrants[1], /perms\['system\.super_admin'\] == true/);
    assert.match(mapGrants[1], /perms\[key\] == true/);
    assert.match(rules, /id == 'level_super_admin' \? true/);

    assert.doesNotMatch(rules, /function permissionLevel\(/);
    assert.doesNotMatch(rules, /function usesPermissionMap\(/);
    assert.doesNotMatch(rules, /function levelOf\(/);
});

test('rules read denormalized permissions when present', () => {
    assert.match(rules, /function hasPermission\(key\)/);
    assert.match(rules, /function hasPermission\(key\) \{\s*return keyOn\(key\);\s*\}/);
    assert.match(rules, /keyOn\('visibility\.lift_hidden_tags'\)/);
    assert.match(rules, /keyOn\('shep\.count_as_elder'\)/);
});
