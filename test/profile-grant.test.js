const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Access = require('../public/access-core.js');
const Destinations = require('../public/mobile/destinations.js');

// MS-520 — the grant switch writes only the boolean, the badge text is the
// core's, and creating an account does not switch it on.

const PROFILE = fs.readFileSync(path.join(__dirname, '..', 'public', 'profile.js'), 'utf8');
const PROFILE_HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'profile.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const DATA = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile', 'data.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile-shell-header.js'), 'utf8');

test('the badge text lives on the access core, one string for both layouts', () => {
    assert.equal(Access.badgeLabel({ pastoralAssistant: true }), Access.PASTORAL_ASSISTANT_LABEL);
    assert.equal(Access.badgeLabel({ pastoralAssistant: false }), '');
    assert.equal(Access.badgeLabel({ permissionLevel: 'elder' }), '');
    assert.equal(Access.PASTORAL_ASSISTANT_LABEL, 'Pastoral Assistant');
});

test('the phone drawer labels a Pastoral Assistant from the same core string', () => {
    assert.equal(
        Destinations.accountLabel({ permissionLevel: 'member', pastoralAssistant: true }),
        Destinations.roleLabel('member') + ' · ' + Access.PASTORAL_ASSISTANT_LABEL);
    assert.equal(
        Destinations.accountLabel({ permissionLevel: 'editor', pastoralAssistant: true }),
        Destinations.roleLabel('editor') + ' · ' + Access.PASTORAL_ASSISTANT_LABEL);
    assert.equal(
        Destinations.accountLabel({ permissionLevel: 'member' }),
        Destinations.roleLabel('member'));
});

test('the grant write is only pastoralAssistant — Permission Level is left alone', () => {
    assert.match(PROFILE, /function updateUserPastoralAssistant/);
    const fn = PROFILE.match(/async function updateUserPastoralAssistant[\s\S]*?\n\}/);
    assert.ok(fn, 'updateUserPastoralAssistant is gone');
    assert.match(fn[0], /pastoralAssistant:\s*on\s*===\s*true/);
    assert.doesNotMatch(fn[0], /permissionLevel/);
    assert.doesNotMatch(fn[0], /\brole:/);
});

test('the account panel shows the core badge and a switch only an admin can use', () => {
    assert.match(PROFILE, /AccessCore\.badgeLabel/);
    assert.match(PROFILE, /updateUserPastoralAssistant\(/);
    assert.match(PROFILE_HTML, /access-core\.js/);
    // The admin panel itself is still admin / super_admin — an editor does not
    // see the switch because they never see the list.
    assert.match(PROFILE, /\['admin',\s*'super_admin'\]\.includes\(permissionLevel\)/);
});

test('createUser does not set the grant', () => {
    const set = INDEX.match(/exports\.createUser[\s\S]*?\.set\(\{[\s\S]*?\}\)/);
    assert.ok(set, 'createUser set() is gone');
    assert.doesNotMatch(set[0], /pastoralAssistant/);
});

test('both phone drawers carry the grant into the label', () => {
    assert.match(DATA, /pastoralAssistant:\s*data\.pastoralAssistant\s*===\s*true/);
    assert.match(DATA, /Destinations\.accountLabel\(/);
    assert.match(SHELL, /pastoralAssistant:\s*d\.pastoralAssistant\s*===\s*true/);
    assert.match(SHELL, /accountLabel\(/);
});
