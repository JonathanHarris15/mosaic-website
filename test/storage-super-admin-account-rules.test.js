'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Levels = require('../public/account-levels-core.js');
const rules = fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

test('storage rules honour system.super_admin and accountLevelId on the stored user doc', () => {
    assert.match(rules, /function isSuperAdminAccount\(\)/);
    assert.match(rules, /function permissionLevelAccount\(\)/);
    assert.match(rules, /permissions\['system\.super_admin'\]/);
    assert.match(rules, /level_super_admin/);
});

test('a super admin stored as member with only system.super_admin still opens printables.edit client-side', () => {
    const stored = {
        permissionLevel: 'member',
        accountLevelId: 'level_super_admin',
        permissions: {'system.super_admin': true},
    };
    assert.equal(Levels.canonicalPermissionLevel(stored), 'super_admin');
    assert.equal(Levels.hasPermission(stored, 'printables.edit'), true);
    assert.equal(Levels.storedPermissionLevel(stored), 'member',
        'rules read the stored string, not the canonical rung');
});
