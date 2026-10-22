'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Levels = require('../public/account-levels-core.js');
const Access = require('../public/access-core.js');
const rules = fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

test('storage rules honour system.super_admin and accountLevelId on the stored user doc', () => {
    assert.doesNotMatch(rules, /function isSuperAdminAccount\(/);
    assert.doesNotMatch(rules, /function permissionLevelAccount\(/);
    assert.doesNotMatch(rules, /function levelOf\(/);
    assert.match(rules, /perms\['system\.super_admin'\] == true/);
    assert.match(rules, /id == 'level_super_admin' \? true/);
    const keyOn = rules.match(/function keyOnAccount\(key\) \{\s*([\s\S]*?)\n {4}\}/);
    assert.ok(keyOn, 'keyOnAccount() missing');
    assert.match(keyOn[1], /'permissions' in data/);
    assert.match(keyOn[1], /mapGrants\(data\.permissions, key\)/);
    assert.match(keyOn[1], /presetGrants\(data\.accountLevelId, key\)/);
    assert.doesNotMatch(keyOn[1], /permissionLevel|\.role|pastoralAssistant/);
});

test('a super admin map opens printables.edit even when permissionLevel says member', () => {
    const stored = {
        permissionLevel: 'member',
        permissions: {'system.super_admin': true},
    };
    assert.equal(Levels.canonicalPermissionLevel(stored), 'super_admin');
    assert.equal(Levels.hasPermission(stored, 'printables.edit'), true);
    assert.equal(Access.hasPermission(stored, 'printables.edit'), true);
    assert.equal(typeof Levels.storedPermissionLevel, 'undefined');
    assert.equal(typeof Levels.savedPermissionMap, 'undefined');

    assert.equal(Levels.hasPermission('super_admin', 'printables.edit'), true);
    assert.equal(Access.hasPermission('super_admin', 'printables.edit'), true);
    assert.equal(Levels.hasPermission({ accountLevelId: 'level_super_admin' }, 'printables.edit'), true);
    assert.equal(Access.hasPermission({ accountLevelId: 'level_super_admin' }, 'printables.edit'), true);

    assert.equal(Levels.hasPermission({ permissionLevel: 'super_admin' }, 'printables.edit'), false);
    assert.equal(Access.hasPermission({ permissionLevel: 'super_admin' }, 'printables.edit'), false);
    assert.equal(Levels.hasPermission({
        role: 'super_admin',
        permissionLevel: 'super_admin',
        accountLevelId: 'level_super_admin',
        permissions: 'not-a-map',
    }, 'printables.edit'), false);
});
