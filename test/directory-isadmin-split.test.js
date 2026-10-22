const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Access = require('../public/access-core.js');
const Levels = require('../public/account-levels-core.js');

function account(preset, extra) {
    const id = Levels.BUILTIN_LEVEL_IDS[preset];
    if (!id) return Object.assign({ accountLevelId: null, permissions: {} }, extra || {});
    return Object.assign({}, Levels.userWriteFromLevel(id), extra || {});
}

// MS-542 / MS-583 — directory hide chrome asks canDecide; hidden
// people/tags still lift for a Pastoral Assistant via canReadElder.

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const JS = read('peoples-page.js');
const HTML = read('peoples-page.html');

function getter(name) {
    const start = JS.indexOf('get ' + name + '()');
    assert.ok(start !== -1, name + ' getter is gone');
    const open = JS.indexOf('{', start);
    return JS.slice(open, open + 280);
}

function headOf(name) {
    const start = JS.indexOf(name);
    assert.ok(start !== -1, name + ' is gone');
    const open = JS.indexOf('{', start);
    return JS.slice(open, open + 80);
}

test('the directory no longer names isAdmin as a write-shaped alias', () => {
    assert.doesNotMatch(JS, /\bisAdmin\b/);
    assert.doesNotMatch(HTML, /\bisAdmin\b/);
});

test('hidden tag and people reads stay on canReadElder so a PA still sees them', () => {
    const load = JS.slice(JS.indexOf('async loadTags()'), JS.indexOf('async toggleTagVisibility'));
    assert.match(load, /this\.canReadElder \|\| !data\.hiddenFromOthers/);
    assert.doesNotMatch(load, /canDecide/);
    const roster = JS.slice(JS.indexOf('directoryRoster()'), JS.indexOf('get directoryTabCounts'));
    assert.match(roster, /if\s*\(\s*this\.canReadElder\s*\)\s*return this\.people/);
    assert.doesNotMatch(roster, /canDecide/);
    const filtered = JS.slice(JS.indexOf('get filteredPeople()'), JS.indexOf('personMatchesDirectoryTab'));
    assert.match(filtered, /directoryRoster\(\)/);
    assert.doesNotMatch(filtered, /canDecide/);
});

test('hide-tag and hide-people toggles refuse without canDecide', () => {
    assert.match(headOf('async toggleTagVisibility'), /if\s*\(\s*!this\.canDecide\s*\)\s*return/);
    assert.match(headOf('async togglePeopleVisibility'), /if\s*\(\s*!this\.canDecide\s*\)\s*return/);
});

test('directory hide chrome is canDecide, not the read-elder alias', () => {
    const controls = HTML.slice(
        HTML.indexOf('Hide-vocabulary controls'),
        HTML.indexOf('togglePeopleVisibility(tag)') + 80
    );
    assert.match(controls, /x-show="canDecide"/);
    assert.match(controls, /toggleTagVisibility\(tag\)/);
    assert.match(controls, /togglePeopleVisibility\(tag\)/);
    assert.doesNotMatch(controls, /canReadElder/);
});

test('canReadElder is the View-as-Member read lift; canDecide follows AccessCore', () => {
    const acting = getter('actingAccount');
    assert.match(acting, /viewAsMember/);
    assert.match(acting, /return 'member'/);
    const readLift = getter('canReadElder');
    assert.match(readLift, /AccessCore\.readsAsElder\(this\.actingAccount\)/);
    assert.doesNotMatch(readLift, /viewAsMember/);
    assert.doesNotMatch(readLift, /pastoralAssistant/);
    const decide = getter('canDecide');
    assert.match(decide, /AccessCore\.canDecide\(this\.actingAccount\)/);
    assert.doesNotMatch(decide, /viewAsMember/);
    assert.doesNotMatch(decide, /readsAsElder/);
    assert.doesNotMatch(decide, /AccessCore\.isAnElder/);
});

test('a Pastoral Assistant reads hidden directory vocab and can decide hide flags', () => {
    const flag = Access.pageFlags({ permissionLevel: 'member', pastoralAssistant: true });
    assert.equal(flag.canReadElder, false);
    assert.equal(flag.canDecide, false);
    const editorFlag = Access.pageFlags({ permissionLevel: 'editor', pastoralAssistant: true });
    assert.equal(editorFlag.canReadElder, false);
    assert.equal(editorFlag.canDecide, false);
    const pa = Access.pageFlags(account('pastoral_assistant'));
    assert.equal(pa.canReadElder, true);
    assert.equal(pa.canDecide, true);
    assert.equal(pa.canWriteEditor, true);
    assert.equal(pa.canWriteRecord, true);
    assert.equal(Access.isAnElder(account('pastoral_assistant')), false);
    const elder = Access.pageFlags(account('elder'));
    assert.equal(elder.canReadElder, true);
    assert.equal(elder.canDecide, true);
    assert.equal(Access.readsAsElder('member'), false);
    assert.equal(Access.canDecide('member'), false);
});
