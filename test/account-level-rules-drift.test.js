const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Levels = require('../public/account-levels-core.js');

const ROOT = path.join(__dirname, '..');
const firestore = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const storage = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');

const PRESETS = {
    grantsElder: 'elder',
    grantsPastoralAssistant: 'pastoral_assistant',
    grantsEditor: 'editor',
    grantsAdmin: 'admin',
    grantsMember: 'member',
    grantsViewer: 'viewer',
    grantsKiosk: 'kiosk',
};

function bodyOf(source, name) {
    const start = source.indexOf('function ' + name + '(key)');
    assert.ok(start !== -1, name + ' is missing');
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(open, i + 1);
        }
    }
    throw new Error('unclosed ' + name);
}

function keysIn(source, name) {
    return [...bodyOf(source, name).matchAll(/key == '([^']+)'/g)]
        .map((match) => match[1])
        .sort();
}

function presetKeys(preset) {
    const map = Levels.buildPresetPermissions(preset);
    return Object.keys(map).filter((key) => map[key] === true).sort();
}

test('rules preset lists match buildPresetPermissions and each other', () => {
    for (const [fn, preset] of Object.entries(PRESETS)) {
        const expected = presetKeys(preset);
        const fromFirestore = keysIn(firestore, fn);
        const fromStorage = keysIn(storage, fn);
        assert.deepEqual(fromFirestore, expected, 'firestore ' + fn);
        assert.deepEqual(fromStorage, expected, 'storage ' + fn);
    }
});

test('super admin is every key, not a copied list', () => {
    assert.match(firestore, /id == 'level_super_admin' \? true/);
    assert.match(storage, /id == 'level_super_admin' \? true/);
    assert.equal(firestore.includes('function permissionLevel('), false);
    assert.equal(firestore.includes('function usesPermissionMap('), false);
    assert.equal(storage.includes('function levelOf('), false);
    assert.equal(storage.includes('function permissionLevelAccount('), false);
});

test('pastoralAssistant true is only refused on self-create', () => {
    const grants = firestore.match(/pastoralAssistant == true/g) || [];
    assert.deepEqual(grants, []);
    assert.match(firestore, /accountLevelId == 'level_viewer'/);
    assert.match(firestore, /request\.resource\.data\.pastoralAssistant != true/);
});
