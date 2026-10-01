const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Access = require('../public/access-core.js');
const Destinations = require('../public/mobile/destinations.js');

// Pastoral Assistant is a Permission Level on the account list, not a checkbox.
// The old flag still labels an account that has not been moved onto the role.

const PROFILE = fs.readFileSync(path.join(__dirname, '..', 'public', 'profile.js'), 'utf8');
const PROFILE_HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'profile.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

test('the role\'s own name is Pastoral Assistant, and the old flag still badges another level', () => {
    assert.equal(Access.badgeLabel({ permissionLevel: 'pastoral_assistant' }), '');
    assert.equal(Access.badgeLabel({ pastoralAssistant: true }), Access.PASTORAL_ASSISTANT_LABEL);
    assert.equal(Access.badgeLabel({ permissionLevel: 'elder' }), '');
    assert.equal(Access.PASTORAL_ASSISTANT_LABEL, 'Pastoral Assistant');
    assert.equal(Access.PASTORAL_ASSISTANT_LEVEL, 'pastoral_assistant');
});

test('the phone drawer names the role, and still badges the old flag', () => {
    assert.equal(
        Destinations.accountLabel({ permissionLevel: 'pastoral_assistant' }),
        'Pastoral Assistant');
    assert.equal(
        Destinations.accountLabel({ permissionLevel: 'member', pastoralAssistant: true }),
        Destinations.roleLabel('member') + ' · ' + Access.PASTORAL_ASSISTANT_LABEL);
    assert.equal(
        Destinations.accountLabel({ permissionLevel: 'member' }),
        Destinations.roleLabel('member'));
});

test('setting a permission level writes the role and clears the old flag', () => {
    assert.doesNotMatch(PROFILE, /function updateUserPastoralAssistant/);
    assert.doesNotMatch(PROFILE, /type="checkbox"/);
    const fn = PROFILE.match(/async function updateUserRole[\s\S]*?\n\}/);
    assert.ok(fn, 'updateUserRole is gone');
    assert.match(fn[0], /permissionLevel: newRole/);
    assert.match(fn[0], /role: newRole/);
    assert.match(fn[0], /pastoralAssistant: false/);
});

test('the account list offers Pastoral Assistant in the same select as Elder', () => {
    assert.match(PROFILE, /value="pastoral_assistant"/);
    assert.match(PROFILE_HTML, /value="pastoral_assistant"/);
    assert.match(PROFILE, /Pastoral Assistant/);
    assert.doesNotMatch(PROFILE, /updateUserPastoralAssistant\(/);
});

test('createUser does not set the old flag', () => {
    const set = INDEX.match(/exports\.createUser[\s\S]*?\.set\(\{[\s\S]*?\}\)/);
    assert.ok(set, 'createUser set() is gone');
    assert.doesNotMatch(set[0], /pastoralAssistant/);
});
