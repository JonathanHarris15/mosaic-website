const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Levels = require('../public/account-levels-core.js');

const ROOT = path.join(__dirname, '..');
const firestore = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const storage = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');

// Helpers that run on many allow lines. Each one used to call keyOn(), and
// keyOn() inlines presetGrants (every builtin list). The Rules compiler
// inlines that again at every allow, and projects/...:test then exceeds its
// deadline and returns HTTP 503. These bodies stay on rankFromMap /
// rankFromLevelId / mapHas. The matrix stays in keyOn(), called once.
const HOT_FIRESTORE = [
    'userData',
    'mapHas',
    'rankFromMap',
    'rankFromLevelId',
    'accessRank',
    'isAdmin',
    'isEditor',
    'isMember',
    'isPastoralAssistant',
    'isKiosk',
    'readsAsElder',
    'readsAsEditor',
    'writesTheRecord',
    'canDecide',
    'rankCanSee',
];

const HOT_STORAGE = [
    'mapHas',
    'rankFromMap',
    'rankFromLevelId',
    'accessRankAccount',
    'isEditorAccount',
    'isMemberAccount',
    'isPastoralAssistantAccount',
    'readsAsElderAccount',
    'readsAsEditorAccount',
    'canDecideAccount',
    'rankOrParticipantSees',
];

const EDITOR_RANKS = ['editor', 'admin', 'elder', 'super_admin', 'pastoral_assistant'];
const MEMBER_RANKS = ['member'].concat(EDITOR_RANKS);
const EDITOR_KEYS = [
    'directory.edit_identity',
    'printables.edit',
    'services.builder.edit',
    'roles.manager.edit',
    'hymns.edit',
];

/**
 * @param {string} source
 * @param {string} name
 * @return {string}
 */
function bodyOf(source, name) {
    const start = source.indexOf('function ' + name + '(');
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

/**
 * @param {string} text
 * @return {string}
 */
function squash(text) {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} body
 * @return {string[]}
 */
function levelIds(body) {
    return [...body.matchAll(/accountLevelId == '([^']+)'/g)].map((match) => match[1]);
}

/**
 * @param {Record<string, boolean>} map
 * @return {string}
 */
function rankWalk(map) {
    if (map['system.super_admin'] === true) return 'super_admin';
    if (map['system.kiosk'] === true) return 'kiosk';
    if (map['shep.count_as_elder'] === true) return 'elder';
    if (map['visibility.lift_hidden_tags'] === true) return 'pastoral_assistant';
    if (map['admin.dashboard.access'] === true) return 'admin';
    if (map['directory.edit_identity'] === true
        || map['services.builder.edit'] === true
        || map['printables.edit'] === true) return 'editor';
    if (map['directory.view'] === true) return 'member';
    return 'viewer';
}

/**
 * @typedef {{ preset: string, id: string, map: Record<string, boolean>, rank: string }} PresetFact
 */

/**
 * @return {PresetFact[]}
 */
function presetFacts() {
    return Levels.BUILTIN_PRESET_KEYS.map((preset) => {
        const map = Levels.buildPresetPermissions(preset);
        return {
            preset,
            id: Levels.accountLevelIdForPreset(preset),
            map,
            rank: rankWalk(map),
        };
    });
}

// keyOn(key) || isPastoralAssistant(). On a preset, pastoral assistant is
// exactly level_pastoral_assistant, so the id list is every builtin that
// holds the key plus that level.
/**
 * @param {PresetFact[]} facts
 * @param {string} key
 * @return {string[]}
 */
function idsForKeyOrPastoralAssistant(facts, key) {
    return facts
        .filter((fact) => fact.map[key] === true || fact.rank === 'pastoral_assistant')
        .map((fact) => fact.id)
        .sort();
}

test('hot helpers do not inline the permission matrix', () => {
    const banned = /\b(?:keyOn(?:Account)?|presetGrants)\s*\(/;
    for (const name of HOT_FIRESTORE) {
        assert.doesNotMatch(bodyOf(firestore, name), banned, 'firestore ' + name);
    }
    for (const name of HOT_STORAGE) {
        assert.doesNotMatch(bodyOf(storage, name), banned, 'storage ' + name);
    }
    assert.match(bodyOf(firestore, 'keyOn'), /presetGrants\(data\.accountLevelId, key\)/);
    assert.match(bodyOf(storage, 'keyOnAccount'), /presetGrants\(data\.accountLevelId, key\)/);
});

test('rank helpers are the same function in both rules files', () => {
    assert.equal(squash(bodyOf(firestore, 'rankFromMap')), squash(bodyOf(storage, 'rankFromMap')));
    assert.equal(
        squash(bodyOf(firestore, 'rankFromLevelId')),
        squash(bodyOf(storage, 'rankFromLevelId'))
    );
});

test('rankFromLevelId follows the preset rank walk', () => {
    const facts = presetFacts();
    const expected = facts
        .filter((fact) => fact.rank !== 'viewer')
        .sort((a, b) => {
            const order = [
                'super_admin', 'kiosk', 'elder', 'pastoral_assistant',
                'admin', 'editor', 'member',
            ];
            return order.indexOf(a.rank) - order.indexOf(b.rank);
        })
        .map((fact) => fact.id + ' -> ' + fact.rank);
    for (const source of [firestore, storage]) {
        const pairs = [...bodyOf(source, 'rankFromLevelId').matchAll(
            /id == '(level_[^']+)' \? '([^']+)'/g
        )].map((match) => match[1] + ' -> ' + match[2]);
        assert.deepEqual(pairs, expected);
    }
    const viewer = facts.find((fact) => fact.preset === 'viewer');
    assert.ok(viewer, 'viewer preset missing');
    assert.equal(viewer.rank, 'viewer');
    assert.equal(bodyOf(firestore, 'rankFromLevelId').includes(viewer.id), false);
});

test('preset-only doors list the builtins that hold the key', () => {
    const facts = presetFacts();
    /** @type {Array<[string, string | null, string]>} */
    const doors = [
        ['readsAsElder', 'readsAsElderAccount', 'visibility.lift_hidden_tags'],
        ['writesTheRecord', null, 'shep.notes.write'],
        ['canDecide', 'canDecideAccount', 'shep.tags.manage'],
    ];
    for (const [firestoreName, storageName, key] of doors) {
        const expected = idsForKeyOrPastoralAssistant(facts, key);
        const fromFirestore = levelIds(bodyOf(firestore, firestoreName)).sort();
        assert.deepEqual(fromFirestore, expected, firestoreName + ' ' + key);
        if (storageName) {
            const fromStorage = levelIds(bodyOf(storage, storageName)).sort();
            assert.deepEqual(fromStorage, fromFirestore, storageName);
        }
        assert.match(bodyOf(firestore, firestoreName), /\('accountLevelId' in data\)/);
        assert.match(bodyOf(firestore, firestoreName), /\('permissions' in data\)/);
    }
});

test('dropping keyOn on the preset path does not narrow a builtin', () => {
    for (const fact of presetFacts()) {
        const editorByKey = EDITOR_KEYS.some((key) => fact.map[key] === true);
        if (editorByKey) {
            assert.ok(EDITOR_RANKS.includes(fact.rank), fact.preset + ' editor key without editor rank');
        }
        const memberByKey = fact.map['directory.view'] === true
            || fact.map['visibility.rung.member'] === true
            || editorByKey;
        if (memberByKey) {
            assert.ok(MEMBER_RANKS.includes(fact.rank), fact.preset + ' member key without member rank');
        }
        if (fact.map['admin.dashboard.access'] === true) {
            assert.ok(
                fact.rank === 'admin' || fact.rank === 'super_admin',
                fact.preset + ' dashboard key without admin rank'
            );
        }
        if (fact.map['visibility.rung.participant'] === true
            || fact.map['visibility.rung.editor'] === true) {
            assert.ok(EDITOR_RANKS.includes(fact.rank), fact.preset + ' editor rung without editor rank');
        }
        if (fact.map['visibility.rung.elder'] === true) {
            assert.ok(
                fact.map['visibility.lift_hidden_tags'] === true || fact.rank === 'pastoral_assistant',
                fact.preset + ' elder rung without the lift door'
            );
        }
    }
});
