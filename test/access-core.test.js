const { test } = require('node:test');
const assert = require('node:assert/strict');

const Access = require('../public/access-core.js');
const Levels = require('../public/account-levels-core.js');

// MS-776: a rank-label string and the builtin account it names answer the
// same way. A stored permissionLevel, role, or pastoralAssistant flag grants
// nothing.

const LEVELS = [
    'viewer', 'member', 'editor', 'pastoral_assistant', 'elder', 'admin', 'super_admin', 'kiosk',
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
    pastoral_assistant: {
        readsAsElder: true, readsAsEditor: true, writesTheRecord: true,
        canDecide: true, isAnElder: false, writesAsEditor: true,
        rungs: ALL_RUNGS, liftsHidden: true,
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

function builtin(level) {
    return Levels.userWriteFromLevel(Levels.accountLevelIdForPreset(level));
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

test('every builtin preset keeps today\'s answers, as a rank label and as an account', () => {
    LEVELS.forEach(level => {
        answers(TODAY[level], ask(level), level + ' string');
        answers(TODAY[level], ask(builtin(level)), level + ' account');
        answers(TODAY[level], ask(Levels.accountLevelIdForPreset(level)), level + ' id');
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
    answers(nobody, ask('nonsense'), 'unknown label');
});

test('a stored permissionLevel, role, or pastoralAssistant flag grants nothing', () => {
    const nobody = {
        readsAsElder: false, readsAsEditor: false, writesTheRecord: false,
        canDecide: false, isAnElder: false, writesAsEditor: false,
        rungs: ['public'], liftsHidden: false,
    };
    LEVELS.forEach(level => {
        answers(nobody, ask({ permissionLevel: level }), level + ' field');
        answers(nobody, ask({ role: level }), level + ' role');
        answers(nobody, ask({ permissionLevel: level, pastoralAssistant: true }), level + ' flag');
    });
    assert.equal(Access.isPastoralAssistant({ pastoralAssistant: true }), false);
    assert.equal(Access.badgeLabel({ permissionLevel: 'member', pastoralAssistant: true }), '');
    assert.equal(Access.permissionLevelOf({ role: 'elder' }), 'viewer');
    assert.equal(Access.permissionLevelOf({ permissionLevel: 'editor', role: 'viewer' }), 'viewer');
});

test('the pastoral_assistant preset reads as elder for access and is not an elder', () => {
    const acc = builtin('pastoral_assistant');
    answers(TODAY.pastoral_assistant, ask(acc), 'pastoral_assistant');
    assert.equal(Access.isPastoralAssistant(acc), true);
    assert.equal(Access.isPastoralAssistant('pastoral_assistant'), true);
    assert.equal(Access.badgeLabel(acc), '');
    assert.equal(Access.badgeLabel('member'), '');
    assert.equal(Access.PASTORAL_ASSISTANT_LABEL, 'Pastoral Assistant');
    assert.equal(Access.isAnElder(acc), false);
});

test('an editor preset writes as editor and does not decide', () => {
    const acc = builtin('editor');
    assert.equal(Access.writesAsEditor(acc), true);
    assert.equal(Access.isAnElder(acc), false);
    assert.equal(Access.writesTheRecord(acc), false);
    assert.equal(Access.canDecide(acc), false);
});

test('an admin preset is still not an elder', () => {
    const acc = builtin('admin');
    assert.equal(Access.readsAsElder(acc), false);
    assert.equal(Access.isAnElder(acc), false);
    assert.equal(Access.writesAsEditor(acc), true);
});

test('the existing shared cores keep today\'s answers for a rank label', () => {
    const Events = require('../public/events-occurrence-core.js');
    const Roles = require('../public/roles-core.js');
    const Forms = require('../public/forms-core.js');
    const Directory = require('../public/directory-request-core.js');
    const Printable = require('../public/printable-data-core.js');

    LEVELS.forEach(level => {
        assert.deepEqual(Events.rungsFor(level), TODAY[level].rungs, 'events rungsFor ' + level);
        assert.equal(Roles.seesHidden(level), TODAY[level].liftsHidden, 'roles seesHidden ' + level);
        assert.equal(Forms.mayShutToElders(level), TODAY[level].canDecide, 'forms mayShutToElders ' + level);
        assert.equal(Directory.canResolve(level), TODAY[level].writesAsEditor, 'directory canResolve ' + level);
    });

    assert.equal(Printable.mayRead('member', 'editor'), false);
    assert.equal(Printable.mayRead('editor', 'editor'), true);
    assert.equal(Printable.mayRead('admin', 'elder'), false);
    assert.equal(Printable.mayRead('elder', 'elder'), true);
});

test('a ladder object does not open the shared cores', () => {
    const Events = require('../public/events-occurrence-core.js');
    const Roles = require('../public/roles-core.js');
    const Forms = require('../public/forms-core.js');
    const Directory = require('../public/directory-request-core.js');
    const flag = { permissionLevel: 'member', pastoralAssistant: true };
    assert.deepEqual(Events.rungsFor(flag), ['public']);
    assert.equal(Roles.seesHidden(flag), false);
    assert.equal(Forms.mayShutToElders(flag), false);
    assert.equal(Directory.canResolve(flag), false);
    assert.equal(Directory.canResolve({ permissionLevel: 'editor' }), false);
});

test('pageFlags stores the account the map actually is', () => {
    const flags = Access.pageFlags(builtin('pastoral_assistant'));
    assert.equal(flags.canReadElder, true);
    assert.equal(flags.canReadEditor, true);
    assert.equal(flags.canWriteRecord, true);
    assert.equal(flags.canDecide, true);
    assert.equal(flags.canWriteEditor, true);
    assert.equal(flags.pastoralAssistant, true);
    assert.equal(flags.currentPermissionLevel, 'pastoral_assistant');
    const ladder = Access.pageFlags({ permissionLevel: 'member', pastoralAssistant: true });
    assert.equal(ladder.canDecide, false);
    assert.equal(ladder.currentPermissionLevel, 'viewer');
    assert.equal(ladder.pastoralAssistant, false);
});

test('a Pastoral Assistant decides and writes like an elder, and is still not an elder', () => {
    const member = builtin('member');
    const pa = builtin('pastoral_assistant');
    const elder = builtin('elder');

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
