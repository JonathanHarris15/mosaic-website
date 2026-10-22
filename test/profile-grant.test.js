const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Access = require('../public/access-core.js');
const Destinations = require('../public/mobile/destinations.js');
const Levels = require('../public/account-levels-core.js');

function account(preset, extra) {
    const id = Levels.BUILTIN_LEVEL_IDS[preset];
    if (!id) return Object.assign({ accountLevelId: null, permissions: {} }, extra || {});
    return Object.assign({}, Levels.userWriteFromLevel(id), extra || {});
}

// Pastoral Assistant is an account level. badgeLabel is empty; the level's
// own display name is what the drawer prints. A stored flag grants nothing
// and adds no badge.

const ADMIN_ACCOUNTS = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-accounts.js'), 'utf8');
const ADMIN_DASHBOARD_HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-dashboard.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

test('badgeLabel is empty; the Pastoral Assistant level still names itself', () => {
    assert.equal(Access.badgeLabel(account('pastoral_assistant')), '');
    assert.equal(Access.badgeLabel({ pastoralAssistant: true }), '');
    assert.equal(Access.badgeLabel({ permissionLevel: 'pastoral_assistant' }), '');
    assert.equal(Access.badgeLabel(account('elder')), '');
    const level = Levels.BUILTIN_LEVELS.find((row) => row.presetKey === 'pastoral_assistant');
    assert.equal(level.name, 'Pastoral Assistant');
    assert.equal(Levels.DISPLAY_NAMES.pastoral_assistant, Access.PASTORAL_ASSISTANT_LABEL);
    assert.equal(Access.PASTORAL_ASSISTANT_LABEL, 'Pastoral Assistant');
    assert.equal(Access.PASTORAL_ASSISTANT_LEVEL, 'pastoral_assistant');
});

test('the phone drawer names the Pastoral Assistant level, and the old flag does not badge', () => {
    assert.equal(Destinations.accountLabel(account('pastoral_assistant')), 'Pastoral Assistant');
    assert.equal(Destinations.accountLabel('pastoral_assistant'), 'Pastoral Assistant');
    assert.equal(
        Destinations.accountLabel({ permissionLevel: 'member', pastoralAssistant: true }),
        Destinations.roleLabel('viewer'));
    assert.equal(Access.permissionLevelOf({ permissionLevel: 'member', pastoralAssistant: true }), 'viewer');
    assert.equal(Destinations.accountLabel(account('member')), Destinations.roleLabel('member'));
});

test('assigning an account level delegates to account levels core', () => {
    assert.doesNotMatch(ADMIN_ACCOUNTS, /function updateUserPastoralAssistant/);
    assert.doesNotMatch(ADMIN_ACCOUNTS, /type="checkbox"/);
    const fn = ADMIN_ACCOUNTS.match(/async function updateUserAccountLevel[\s\S]*?\n\}/);
    assert.ok(fn, 'updateUserAccountLevel missing');
    assert.match(fn[0], /assignUserAccountLevel/);
    assert.doesNotMatch(ADMIN_ACCOUNTS, /updateUserPastoralAssistant\(/);
});

test('the account directory assigns account levels from Firestore', () => {
    assert.match(ADMIN_ACCOUNTS, /updateUserAccountLevel/);
    assert.match(ADMIN_ACCOUNTS, /accountLevelsForSelect/);
    assert.match(ADMIN_DASHBOARD_HTML, /perm-split/);
    assert.match(ADMIN_DASHBOARD_HTML, /admin-account-levels\.js/);
});

test('createUser writes email, accountLevelId, permissions, and createdAt', () => {
    const set = INDEX.match(/exports\.createUser[\s\S]*?\.set\(\{([\s\S]*?)\}\)/);
    assert.ok(set, 'createUser set() missing');
    const body = set[1];
    assert.match(body, /email/);
    assert.match(body, /accountLevelId/);
    assert.match(body, /permissions/);
    assert.match(body, /createdAt/);
    assert.doesNotMatch(body, /pastoralAssistant/);
    assert.doesNotMatch(body, /permissionLevel/);
    assert.doesNotMatch(body, /\brole\b/);
});
