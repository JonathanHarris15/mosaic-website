const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Access = require('../public/access-core.js');

// MS-518 — Firestore and Storage restate AccessCore. The emulator drives
// both engines through the Admin SDK and cannot exercise the rules, so these
// pin the shape, the same way firestore-forms-rules and firestore-kiosk-rules
// already do. Live enforcement stays a human check in production.

const firestore = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');
const storage = fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

const codeOnly = text => text
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n');

const firestoreCode = codeOnly(firestore);
const storageCode = codeOnly(storage);

const fnBody = (source, name) => {
    const m = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n    \\}').exec(source);
    assert.ok(m, 'missing function ' + name + '()');
    return m[1];
};

const blockFor = (source, pattern, label) => {
    const m = source.match(pattern);
    assert.ok(m, 'no rule block matching ' + (label || pattern));
    return m[1];
};

const RECORD_WRITE_PATHS = [
    'elder_documents',
    'elder_document_structure',
    'shepherding_tasks',
    'shepherding_task_occurrences',
];

const ELDER_READ_PATHS = [
    'shepherding_tags',
    'shepherding_views',
    'shepherding_tasks',
    'shepherding_task_occurrences',
    'elder_meetings',
    'elder_documents',
    'elder_document_structure',
];

test('the rules name the AccessCore helpers', () => {
    ['isPastoralAssistant', 'readsAsElder', 'readsAsEditor', 'writesTheRecord', 'canDecide'].forEach(name => {
        assert.match(firestore, new RegExp('function ' + name + '\\(\\)'), name);
    });
});

test('isPastoralAssistant is the pastoral_assistant rank, and the boolean is not a grant', () => {
    const body = fnBody(firestore, 'isPastoralAssistant');
    assert.match(body, /return accessRank\(\) == 'pastoral_assistant';/);
    assert.doesNotMatch(body, /pastoralAssistant == true/);
    assert.doesNotMatch(body, /permissionLevel\(\)/);
    // No user document: accessRank() is '' so the helper is false.
    const rank = fnBody(firestore, 'accessRank');
    assert.match(rank, /!userDocExists\(\) \? ''/);
    const fromMap = fnBody(firestore, 'rankFromMap');
    assert.match(fromMap, /mapGrants\(perms, 'system\.super_admin'\) \? 'super_admin'/);
    assert.match(fromMap, /mapGrants\(perms, 'system\.kiosk'\) \? 'kiosk'/);
    assert.match(fromMap, /mapGrants\(perms, 'visibility\.lift_hidden_tags'\) \? 'pastoral_assistant'/);
    assert.ok(
        fromMap.indexOf('system.super_admin') < fromMap.indexOf('system.kiosk')
            && fromMap.indexOf('system.kiosk') < fromMap.indexOf('visibility.lift_hidden_tags'),
        'super admin is decided before kiosk, and kiosk before pastoral assistant'
    );
});

test('readsAsElder, writesTheRecord and canDecide are the key or the rank; isElder is the count key', () => {
    const reads = fnBody(firestore, 'readsAsElder');
    const writes = fnBody(firestore, 'writesTheRecord');
    const decide = fnBody(firestore, 'canDecide');
    const isElder = fnBody(firestore, 'isElder');
    const counts = fnBody(firestore, 'countsAsElder');
    assert.match(reads, /mapGrants\(data\.permissions, 'visibility\.lift_hidden_tags'\) \|\| isPastoralAssistant\(\)/);
    assert.match(reads, /accountLevelId == 'level_elder'/);
    assert.match(reads, /accountLevelId == 'level_pastoral_assistant'/);
    assert.doesNotMatch(reads, /keyOn\(/);
    assert.match(writes, /mapGrants\(data\.permissions, 'shep\.notes\.write'\) \|\| isPastoralAssistant\(\)/);
    assert.doesNotMatch(writes, /keyOn\(/);
    assert.match(decide, /mapGrants\(data\.permissions, 'shep\.tags\.manage'\) \|\| isPastoralAssistant\(\)/);
    assert.doesNotMatch(decide, /keyOn\(/);
    assert.doesNotMatch(reads, /usesPermissionMap|pastoralAssistant == true|isElder\(\)/);
    assert.match(isElder, /return keyOn\('shep\.count_as_elder'\);/);
    assert.match(counts, /return keyOn\('shep\.count_as_elder'\);/);
    assert.doesNotMatch(isElder, /isPastoralAssistant|'elder', 'super_admin'/);
    assert.doesNotMatch(counts, /isPastoralAssistant|'elder', 'super_admin'/);
});

test('readsAsEditor is the edit keys, the rank, or isEditor', () => {
    const reads = fnBody(firestore, 'readsAsEditor');
    const isEditor = fnBody(firestore, 'isEditor');
    assert.match(reads, /isPastoralAssistant\(\)/);
    assert.match(reads, /isEditor\(\)/);
    assert.match(isEditor, /mapHas\('directory\.edit_identity'\)/);
    assert.match(isEditor, /mapHas\('printables\.edit'\)/);
    assert.doesNotMatch(reads, /usesPermissionMap|pastoralAssistant == true/);
    assert.match(isEditor,
        /accessRank\(\) in \['editor', 'admin', 'elder', 'super_admin', 'pastoral_assistant'\]/);
    assert.doesNotMatch(isEditor, /isPastoralAssistant\(\)|pastoralAssistant == true|usesPermissionMap/);
});

test('a pastoralAssistant boolean grants nothing; the preset and the rank do', () => {
    const flag = { permissionLevel: 'member', pastoralAssistant: true };
    assert.equal(Access.isPastoralAssistant(flag), false);
    assert.equal(Access.readsAsElder(flag), false);
    assert.equal(Access.readsAsEditor(flag), false);
    assert.equal(Access.writesTheRecord(flag), false);
    assert.equal(Access.canDecide(flag), false);
    assert.equal(Access.isAnElder(flag), false);
    assert.equal(Access.writesAsEditor(flag), false);

    const preset = { accountLevelId: 'level_pastoral_assistant' };
    assert.equal(Access.isPastoralAssistant(preset), true);
    assert.equal(Access.readsAsElder(preset), true);
    assert.equal(Access.readsAsEditor(preset), true);
    assert.equal(Access.writesTheRecord(preset), true);
    assert.equal(Access.canDecide(preset), true);
    assert.equal(Access.isAnElder(preset), false);
    assert.equal(Access.writesAsEditor(preset), true);
    assert.equal(Access.isPastoralAssistant('pastoral_assistant'), true);
    assert.equal(Access.readsAsElder('pastoral_assistant'), true);
    assert.equal(Access.isAnElder('pastoral_assistant'), false);
});

test('every elder-gated read names readsAsElder, so a forgotten collection fails', () => {
    const allowLines = firestoreCode.split('\n').filter(line => /^\s*allow /.test(line));
    const elderReads = allowLines.filter(line =>
        /\bread\b/.test(line) && /isElder\(\)/.test(line) && !/readsAsElder\(\)/.test(line)
    );
    assert.deepEqual(
        elderReads,
        [],
        'these allow-read lines still gate on isElder() without a Pastoral Assistant:\n' +
            elderReads.join('\n')
    );
});

test('every editor-read an elder has names readsAsEditor', () => {
    // rankCanSee, Away, presence, directory requests, forms, printables,
    // guidance versions, roster, attendance — any remaining `allow read` that
    // still says isEditor() and not readsAsEditor() is a gap a Pastoral
    // Assistant would fall through.
    //
    // How an announcement goes out (MS-621, MS-622) is the exception, and it
    // is named in the PRD against ADR 0065: who would be told is not an
    // editor-rung event read. A pastoral assistant who is not an editor does
    // not read a told record. That half of the read stays isEditor(), on the
    // series and on a one-off. A printed week count is the other half, and it
    // follows the words.
    const ANNOUNCEMENT_PLAN_READS = [
        'allow read: if isEditor();',
        'allow read: if isEditor() && oneOffOccurrence();',
    ];
    const allowLines = firestoreCode.split('\n').filter(line => /^\s*allow /.test(line));
    const editorReads = allowLines.filter(line =>
        /\bread\b/.test(line) && /isEditor\(\)/.test(line) && !/readsAsEditor\(\)/.test(line)
        && !ANNOUNCEMENT_PLAN_READS.some(kept => line.trim() === kept)
    );
    assert.deepEqual(
        editorReads,
        [],
        'these allow-read lines still gate on isEditor() without a Pastoral Assistant:\n' +
            editorReads.join('\n')
    );
});

test('a Pastoral Assistant may write the record collections and nothing else elder-gated', () => {
    RECORD_WRITE_PATHS.forEach(collection => {
        const block = blockFor(
            firestore,
            new RegExp('match /' + collection + '/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n    \\}'),
            collection
        );
        assert.match(block, /allow write: if writesTheRecord\(\)/, collection + ' write');
        assert.match(block, /allow read: if readsAsElder\(\)/, collection + ' read');
        assert.doesNotMatch(block, /allow read, write/, collection + ' still grants read and write together');
    });

    const notes = blockFor(
        firestore,
        /match \/people\/\{personId\}\/shepherding_notes\/\{noteId\}\s*\{([\s\S]*?)\n {4}\}/,
        'shepherding_notes'
    );
    assert.match(notes, /allow read: if readsAsElder\(\)/);
    assert.match(notes, /allow write: if writesTheRecord\(\)/);

    // MS-530: lastNoteAt rides on the Person, not on the note. A Pastoral
    // Assistant who writes a note must be able to update that one field.
    const person = blockFor(
        firestore,
        /match \/people\/\{personId\}\s*\{([\s\S]*?)\n {6}match/,
        'people'
    );
    assert.match(person, /allow update: if canDecide\(\)/);
    assert.match(person, /lastNoteAt/);
    assert.match(person, /shepherdingStatus/);
    assert.match(person, /shepherdingHidden/);
    assert.match(person, /membership/);
    assert.match(person, /hasOnly\(/);
});

test('the Pastoral Record admits a Pastoral Assistant to create, update and delete', () => {
    const block = blockFor(
        firestore,
        /match \/people\/\{personId\}\/shepherding_activity\/\{activityId\}\s*\{([\s\S]*?)\n {4}\}/,
        'shepherding_activity'
    );
    assert.match(block, /allow read: if readsAsElder\(\)/);
    assert.match(block, /allow update, delete: if canDecide\(\)/);
    assert.match(block, /allow create: if canDecide\(\)/);
});

test('tag vocabulary, views, relationships and prayer requests admit a Pastoral Assistant write', () => {
    const granted = {
        shepherding_tags: /match \/shepherding_tags\/\{tagId\}\s*\{([\s\S]*?)\n {4}\}/,
        shepherding_views: /match \/shepherding_views\/\{viewId\}\s*\{([\s\S]*?)\n {4}\}/,
        relationships: /match \/relationships\/\{edgeId\}\s*\{([\s\S]*?)\n {4}\}/,
        relationship_types: /match \/relationship_types\/\{typeId\}\s*\{([\s\S]*?)\n {4}\}/,
        relationship_groups: /match \/relationship_groups\/\{groupId\}\s*\{([\s\S]*?)\n {4}\}/,
        prayer_requests: /match \/prayer_requests\/\{requestId\}\s*\{([\s\S]*?)\n {6}\}/,
    };
    Object.keys(granted).forEach(name => {
        const block = blockFor(firestore, granted[name], name);
        assert.match(block, /allow read: if readsAsElder|allow read: if canReadRelationshipRecord/, name);
        assert.match(block, /allow write: if canDecide\(\)/, name + ' write is canDecide');
    });
});

test('people_tags writes admit a Pastoral Assistant via canDecide', () => {
    const block = blockFor(
        firestore,
        /match \/people_tags\/\{tagId\}\s*\{([\s\S]*?)\n {4}\}/,
        'people_tags'
    );
    assert.match(block, /allow create, update, delete: if isEditor\(\) \|\| canDecide\(\)/);
});

test('isElder stays counted-as-elder only — no Pastoral Assistant in the helper', () => {
    const body = fnBody(firestore, 'isElder');
    assert.match(body, /return keyOn\('shep\.count_as_elder'\);/);
    assert.doesNotMatch(body, /isPastoralAssistant|pastoralAssistant/);
    assert.match(fnBody(firestore, 'countsAsElder'), /return keyOn\('shep\.count_as_elder'\);/);
});

test('every isEditor write still names isEditor, not the grant', () => {
    const allowLines = firestoreCode.split('\n').filter(line => /^\s*allow /.test(line));
    const editorWrites = allowLines.filter(line =>
        /\b(create|update|delete|write)\b/.test(line) && /isEditor\(\)/.test(line)
    );
    assert.ok(editorWrites.length > 0, 'expected editor write rules to still exist');
    editorWrites.forEach(line => {
        assert.doesNotMatch(line, /isPastoralAssistant|writesTheRecord|readsAsEditor/, line);
    });
});

test('form_ledger is still sealed', () => {
    const block = blockFor(firestore, /match \/form_ledger\/\{entryId\}\s*\{([\s\S]*?)\n {4}\}/, 'form_ledger');
    assert.match(block, /allow read, write: if false/);
});

test('a user cannot write pastoralAssistant on their own user doc', () => {
    const users = blockFor(firestore, /match \/users\/\{userId\}\s*\{([\s\S]*?)\n {4}\}/, 'users');
    assert.match(users, /affectedKeys\(\)\.hasOnly\(\['dashboardCardOrder'\]\)/);
    assert.doesNotMatch(
        users,
        /hasOnly\(\[[^\]]*pastoralAssistant/,
        'self-update must not list pastoralAssistant as a writable key'
    );
    assert.match(users, /request\.resource\.data\.accountLevelId == 'level_viewer'/);
    assert.match(users, /!\('permissions' in request\.resource\.data\)/);
    assert.match(
        users,
        /request\.resource\.data\.pastoralAssistant != true/,
        'self-create must refuse pastoralAssistant: true'
    );
});

test('rankCanSee admits a Pastoral Assistant to the editor and elder rungs', () => {
    const body = fnBody(firestore, 'rankCanSee');
    assert.match(body, /visibility == 'member' && \(isMember\(\) \|\| mapHas\('visibility\.rung\.member'\)\)/);
    assert.match(body, /visibility == 'participant' && \(readsAsEditor\(\) \|\| mapHas\('visibility\.rung\.participant'\)\)/);
    assert.match(body, /visibility == 'editor' && \(readsAsEditor\(\) \|\| mapHas\('visibility\.rung\.editor'\)\)/);
    assert.match(body, /visibility == 'elder' && \(readsAsElder\(\) \|\| mapHas\('visibility\.rung\.elder'\)\)/);
});

test('storage restates the same helpers and admits a Pastoral Assistant on elder and editor reads', () => {
    ['isPastoralAssistantAccount', 'readsAsElderAccount', 'readsAsEditorAccount', 'canDecideAccount'].forEach(name => {
        assert.match(storage, new RegExp('function ' + name + '\\(\\)'), name);
    });
    const pa = fnBody(storage, 'isPastoralAssistantAccount');
    assert.match(pa, /accessRankAccount\(\) == 'pastoral_assistant'/);
    assert.doesNotMatch(pa, /pastoralAssistant == true/);
    assert.match(fnBody(storage, 'isElderAccount'), /return keyOnAccount\('shep\.count_as_elder'\);/);
    assert.doesNotMatch(fnBody(storage, 'isElderAccount'), /'elder', 'super_admin'/);
    assert.match(fnBody(storage, 'readsAsElderAccount'),
        /mapGrants\(data\.permissions, 'visibility\.lift_hidden_tags'\) \|\| isPastoralAssistantAccount\(\)/);
    assert.doesNotMatch(fnBody(storage, 'readsAsElderAccount'), /keyOnAccount\(/);
    assert.match(fnBody(storage, 'readsAsEditorAccount'), /isPastoralAssistantAccount\(\)/);
    assert.match(fnBody(storage, 'readsAsEditorAccount'), /isEditorAccount\(\)/);
    assert.match(fnBody(storage, 'canDecideAccount'),
        /mapGrants\(data\.permissions, 'shep\.tags\.manage'\) \|\| isPastoralAssistantAccount\(\)/);
    assert.doesNotMatch(fnBody(storage, 'canDecideAccount'), /keyOnAccount\(/);

    const elderReads = storageCode.split('\n').filter(line =>
        /^\s*allow /.test(line) && /\bread\b/.test(line) &&
        /isElderAccount\(\)/.test(line) && !/readsAsElderAccount\(\)/.test(line)
    );
    assert.deepEqual(elderReads, [], 'storage elder reads missing Pastoral Assistant:\n' + elderReads.join('\n'));

    const editorReads = storageCode.split('\n').filter(line =>
        /^\s*allow /.test(line) && /\bread\b/.test(line) &&
        /isEditorAccount\(\)/.test(line) && !/readsAsEditorAccount\(\)/.test(line)
    );
    assert.deepEqual(editorReads, [], 'storage editor reads missing Pastoral Assistant:\n' + editorReads.join('\n'));

    const see = fnBody(storage, 'rankOrParticipantSees');
    assert.match(see, /mapHas\('visibility\.rung\.member'\)/);
    assert.match(see, /mapHas\('visibility\.rung\.participant'\)/);
    assert.match(see, /mapHas\('visibility\.rung\.editor'\)/);
    assert.match(see, /mapHas\('visibility\.rung\.elder'\)/);
    assert.match(see, /readsAsElderAccount\(\)/);
    assert.doesNotMatch(see, /pastoralAssistant == true/);
});

test('every elder-read path listed in the ticket is present and admits a Pastoral Assistant', () => {
    ELDER_READ_PATHS.forEach(collection => {
        const m = firestore.match(new RegExp('match /' + collection + '/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n    \\}'));
        assert.ok(m, 'missing ' + collection);
        assert.match(m[1], /allow read: if readsAsElder\(\)/, collection);
    });
    assert.match(firestore, /match \/\{\s*path=\*\*\}\\?\/shepherding_notes[\s\S]*?allow read: if readsAsElder\(\)/);
    assert.match(firestore, /match \/\{\s*path=\*\*\}\\?\/shepherding_activity[\s\S]*?allow read: if readsAsElder\(\)/);
});
