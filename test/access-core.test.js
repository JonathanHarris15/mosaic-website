const { test } = require('node:test');
const assert = require('node:assert/strict');

const Access = require('../public/access-core.js');

// MS-515 — the shared access core is the seam. Every Permission Level, with
// and without the Pastoral Assistant grant, against every question the core
// answers. Written first; the module fills the table in.

const LEVELS = [
    'viewer', 'member', 'editor', 'elder', 'admin', 'super_admin', 'kiosk',
];

const ALL_RUNGS = ['public', 'member', 'participant', 'editor', 'elder'];

const TODAY = {
    viewer: {
        readsAsElder: false, readsAsEditor: false, writesTheRecord: false,
        canDecide: false, isAnElder: false, writesAsEditor: false,
        rungs: ['public'], liftsHidden: false,
    },
    member: {
        readsAsElder: false, readsAsEditor: false, writesTheRecord: false,
        canDecide: false, isAnElder: false, writesAsEditor: false,
        rungs: ['public', 'member'], liftsHidden: false,
    },
    editor: {
        readsAsElder: false, readsAsEditor: true, writesTheRecord: false,
        canDecide: false, isAnElder: false, writesAsEditor: true,
        rungs: ['public', 'member', 'participant', 'editor'], liftsHidden: false,
    },
    elder: {
        readsAsElder: true, readsAsEditor: true, writesTheRecord: true,
        canDecide: true, isAnElder: true, writesAsEditor: true,
        rungs: ALL_RUNGS, liftsHidden: true,
    },
    admin: {
        readsAsElder: false, readsAsEditor: true, writesTheRecord: false,
        canDecide: false, isAnElder: false, writesAsEditor: true,
        rungs: ['public', 'member', 'participant', 'editor'], liftsHidden: false,
    },
    super_admin: {
        readsAsElder: true, readsAsEditor: true, writesTheRecord: true,
        canDecide: true, isAnElder: true, writesAsEditor: true,
        rungs: ALL_RUNGS, liftsHidden: true,
    },
    kiosk: {
        readsAsElder: false, readsAsEditor: false, writesTheRecord: false,
        canDecide: false, isAnElder: false, writesAsEditor: false,
        rungs: ['public'], liftsHidden: false,
    },
};

function account(level, grant) {
    return { permissionLevel: level, pastoralAssistant: grant };
}

function answers(expected, actual, label) {
    assert.equal(actual.readsAsElder, expected.readsAsElder, label + ' readsAsElder');
    assert.equal(actual.readsAsEditor, expected.readsAsEditor, label + ' readsAsEditor');
    assert.equal(actual.writesTheRecord, expected.writesTheRecord, label + ' writesTheRecord');
    assert.equal(actual.canDecide, expected.canDecide, label + ' canDecide');
    assert.equal(actual.isAnElder, expected.isAnElder, label + ' isAnElder');
    assert.equal(actual.writesAsEditor, expected.writesAsEditor, label + ' writesAsEditor');
    assert.deepEqual(actual.rungs, expected.rungs, label + ' eventRungsFor');
    assert.equal(actual.liftsHidden, expected.liftsHidden, label + ' liftsHidden');
}

function ask(acc) {
    return {
        readsAsElder: Access.readsAsElder(acc),
        readsAsEditor: Access.readsAsEditor(acc),
        writesTheRecord: Access.writesTheRecord(acc),
        canDecide: Access.canDecide(acc),
        isAnElder: Access.isAnElder(acc),
        writesAsEditor: Access.writesAsEditor(acc),
        rungs: Access.eventRungsFor(acc),
        liftsHidden: Access.liftsHidden(acc),
    };
}

test('every Permission Level without the grant keeps today\'s answers', () => {
    LEVELS.forEach(level => {
        answers(TODAY[level], ask(account(level, false)), level);
        answers(TODAY[level], ask({ permissionLevel: level }), level + ' (flag absent)');
        answers(TODAY[level], ask(level), level + ' (bare string)');
    });
});

test('a missing account is nobody', () => {
    const nobody = {
        readsAsElder: false, readsAsEditor: false, writesTheRecord: false,
        canDecide: false, isAnElder: false, writesAsEditor: false,
        rungs: ['public'], liftsHidden: false,
    };
    answers(nobody, ask(null), 'null');
    answers(nobody, ask(undefined), 'undefined');
    answers(nobody, ask({}), 'empty object');
});

test('every Permission Level with the grant reads as elder and editor and writes the record', () => {
    LEVELS.forEach(level => {
        const acc = account(level, true);
        const today = TODAY[level];
        answers({
            readsAsElder: true,
            readsAsEditor: true,
            writesTheRecord: true,
            canDecide: true,
            isAnElder: today.isAnElder,
            writesAsEditor: today.writesAsEditor,
            rungs: ALL_RUNGS,
            liftsHidden: true,
        }, ask(acc), level + ' + grant');
        assert.equal(Access.isPastoralAssistant(acc), true, level + ' isPastoralAssistant');
        assert.equal(Access.badgeLabel(acc), 'Pastoral Assistant');
    });
});

test('a member-level Pastoral Assistant reads as elder and editor, writes the record, is not an elder, and does not write as editor', () => {
    const acc = account('member', true);
    assert.equal(Access.readsAsElder(acc), true);
    assert.equal(Access.readsAsEditor(acc), true);
    assert.equal(Access.writesTheRecord(acc), true);
    assert.equal(Access.canDecide(acc), true);
    assert.equal(Access.isAnElder(acc), false);
    assert.equal(Access.writesAsEditor(acc), false);
    assert.deepEqual(Access.eventRungsFor(acc), ALL_RUNGS);
    assert.equal(Access.liftsHidden(acc), true);
});

test('an editor with the grant still writes as editor', () => {
    const acc = account('editor', true);
    assert.equal(Access.writesAsEditor(acc), true);
    assert.equal(Access.isAnElder(acc), false);
    assert.equal(Access.writesTheRecord(acc), true);
});

test('an admin with the grant is still not an elder', () => {
    const acc = account('admin', true);
    assert.equal(Access.readsAsElder(acc), true);
    assert.equal(Access.isAnElder(acc), false);
    assert.equal(Access.writesAsEditor(acc), true);
});

test('the grant is fail-closed: only the boolean true counts', () => {
    ['true', 1, 'yes', 'on'].forEach(value => {
        const acc = { permissionLevel: 'member', pastoralAssistant: value };
        assert.equal(Access.isPastoralAssistant(acc), false, String(value));
        assert.equal(Access.readsAsElder(acc), false, String(value) + ' readsAsElder');
    });
});

test('the legacy role field is the Permission Level fallback', () => {
    assert.equal(Access.permissionLevelOf({ role: 'elder' }), 'elder');
    assert.equal(Access.isAnElder({ role: 'elder' }), true);
    assert.equal(Access.readsAsElder({ role: 'member', pastoralAssistant: true }), true);
    assert.equal(Access.writesAsEditor({ role: 'editor' }), true);
    assert.equal(Access.permissionLevelOf({ permissionLevel: 'editor', role: 'viewer' }), 'editor');
});

test('the badge label is empty unless the grant is on', () => {
    assert.equal(Access.badgeLabel(account('elder', false)), '');
    assert.equal(Access.badgeLabel(account('member', false)), '');
    assert.equal(Access.badgeLabel(account('member', true)), 'Pastoral Assistant');
    assert.equal(Access.PASTORAL_ASSISTANT_LABEL, 'Pastoral Assistant');
});

test('the existing shared cores keep today\'s answers for a string rank', () => {
    const Events = require('../public/events-occurrence-core.js');
    const Roles = require('../public/roles-core.js');
    const Forms = require('../public/forms-core.js');
    const Directory = require('../public/directory-request-core.js');
    const Printable = require('../public/printable-data-core.js');

    LEVELS.forEach(level => {
        assert.deepEqual(Events.rungsFor(level), TODAY[level].rungs, 'events rungsFor ' + level);
        assert.equal(Roles.seesHidden(level), TODAY[level].liftsHidden, 'roles seesHidden ' + level);
        assert.equal(Forms.mayShutToElders(level), TODAY[level].isAnElder, 'forms mayShutToElders ' + level);
        assert.equal(Directory.canResolve(level), TODAY[level].writesAsEditor, 'directory canResolve ' + level);
    });

    assert.equal(Printable.mayRead('member', 'editor'), false);
    assert.equal(Printable.mayRead('editor', 'editor'), true);
    assert.equal(Printable.mayRead('admin', 'elder'), false);
    assert.equal(Printable.mayRead('elder', 'elder'), true);
});

test('the existing shared cores honour the grant when handed an account', () => {
    const Events = require('../public/events-occurrence-core.js');
    const Roles = require('../public/roles-core.js');
    const Forms = require('../public/forms-core.js');
    const Directory = require('../public/directory-request-core.js');
    const Printable = require('../public/printable-data-core.js');

    const memberPa = account('member', true);
    assert.deepEqual(Events.rungsFor(memberPa), ALL_RUNGS);
    assert.equal(Roles.seesHidden(memberPa), true);
    assert.equal(Forms.mayShutToElders(memberPa), false);
    assert.equal(Directory.canResolve(memberPa), false);
    assert.equal(Printable.mayRead(memberPa, 'editor'), true);
    assert.equal(Printable.mayRead(memberPa, 'elder'), true);
    assert.equal(Printable.mayRead(memberPa, 'super_admin'), false);

    const editorPa = account('editor', true);
    assert.equal(Forms.mayShutToElders(editorPa), false);
    assert.equal(Directory.canResolve(editorPa), true);
    assert.equal(Printable.mayRead(editorPa, 'editor'), true);
});

test('pageFlags is the one object a surface stores after reading the account', () => {
    const flags = Access.pageFlags({ permissionLevel: 'member', pastoralAssistant: true });
    assert.equal(flags.canReadElder, true);
    assert.equal(flags.canReadEditor, true);
    assert.equal(flags.canWriteRecord, true);
    assert.equal(flags.canDecide, true);
    assert.equal(flags.canWriteEditor, false);
    assert.equal(flags.pastoralAssistant, true);
    assert.equal(flags.currentPermissionLevel, 'member');
});

// MS-594 — PA vs elder vs member for decide/write and counted-as-elder.
test('a Pastoral Assistant decides and writes like an elder, and is still not an elder', () => {
    const member = account('member', false);
    const pa = account('member', true);
    const elder = account('elder', false);

    assert.equal(Access.canDecide(member), false);
    assert.equal(Access.writesTheRecord(member), false);
    assert.equal(Access.isAnElder(member), false);

    assert.equal(Access.canDecide(pa), true);
    assert.equal(Access.writesTheRecord(pa), true);
    assert.equal(Access.isAnElder(pa), false);
    assert.equal(Access.pageFlags(pa).canDecide, true);

    assert.equal(Access.canDecide(elder), true);
    assert.equal(Access.writesTheRecord(elder), true);
    assert.equal(Access.isAnElder(elder), true);
    assert.equal(Access.pageFlags(elder).canDecide, true);
});
