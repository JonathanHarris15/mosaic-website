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
    'shepherding_reminders',
    'elder_meetings',
    'elder_documents',
    'elder_document_structure',
];

test('the rules name the AccessCore helpers', () => {
    ['isPastoralAssistant', 'readsAsElder', 'readsAsEditor', 'writesTheRecord', 'canDecide'].forEach(name => {
        assert.match(firestore, new RegExp('function ' + name + '\\(\\)'), name);
    });
});

test('isPastoralAssistant fails closed when the user doc or the flag is absent', () => {
    const body = fnBody(firestore, 'isPastoralAssistant');
    assert.match(body, /exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)/);
    assert.match(body, /pastoralAssistant == true/);
    assert.doesNotMatch(body, /permissionLevel\(\)/);
});

test('readsAsElder, writesTheRecord and canDecide are isElder or the grant; isAnElder is not widened', () => {
    const reads = fnBody(firestore, 'readsAsElder');
    const writes = fnBody(firestore, 'writesTheRecord');
    const decide = fnBody(firestore, 'canDecide');
    const isElder = fnBody(firestore, 'isElder');
    assert.match(reads, /isElder\(\) \|\| isPastoralAssistant\(\)/);
    assert.match(writes, /isElder\(\) \|\| isPastoralAssistant\(\)/);
    assert.match(decide, /isElder\(\) \|\| isPastoralAssistant\(\)/);
    assert.match(isElder, /permissionLevel\(\) in \['elder', 'super_admin'\]/);
    assert.doesNotMatch(isElder, /isPastoralAssistant/);
});

test('readsAsEditor is isEditor or the grant; writesAsEditor stays the editor ladder', () => {
    const reads = fnBody(firestore, 'readsAsEditor');
    const isEditor = fnBody(firestore, 'isEditor');
    assert.match(reads, /isEditor\(\) \|\| isPastoralAssistant\(\)/);
    assert.match(isEditor, /permissionLevel\(\) in \['editor', 'admin', 'elder', 'super_admin'\]/);
    assert.doesNotMatch(isEditor, /isPastoralAssistant/);
});

test('the helper composition matches AccessCore for a member Pastoral Assistant', () => {
    const memberPa = { permissionLevel: 'member', pastoralAssistant: true };
    assert.equal(Access.readsAsElder(memberPa), true);
    assert.equal(Access.readsAsEditor(memberPa), true);
    assert.equal(Access.writesTheRecord(memberPa), true);
    assert.equal(Access.canDecide(memberPa), true);
    assert.equal(Access.isAnElder(memberPa), false);
    assert.equal(Access.writesAsEditor(memberPa), false);
    assert.match(fnBody(firestore, 'readsAsElder'), /isElder\(\) \|\| isPastoralAssistant\(\)/);
    assert.match(fnBody(firestore, 'writesTheRecord'), /isElder\(\) \|\| isPastoralAssistant\(\)/);
    assert.match(fnBody(firestore, 'canDecide'), /isElder\(\) \|\| isPastoralAssistant\(\)/);
    assert.doesNotMatch(fnBody(firestore, 'isElder'), /pastoralAssistant/);
    assert.doesNotMatch(fnBody(firestore, 'isEditor'), /pastoralAssistant/);
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
    const allowLines = firestoreCode.split('\n').filter(line => /^\s*allow /.test(line));
    const editorReads = allowLines.filter(line =>
        /\bread\b/.test(line) && /isEditor\(\)/.test(line) && !/readsAsEditor\(\)/.test(line)
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
        /match \/people\/\{personId\}\/shepherding_notes\/\{noteId\}\s*\{([\s\S]*?)\n    \}/,
        'shepherding_notes'
    );
    assert.match(notes, /allow read: if readsAsElder\(\)/);
    assert.match(notes, /allow write: if writesTheRecord\(\)/);

    // MS-530: lastNoteAt rides on the Person, not on the note. A Pastoral
    // Assistant who writes a note must be able to update that one field.
    const person = blockFor(
        firestore,
        /match \/people\/\{personId\}\s*\{([\s\S]*?)\n      match/,
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
        /match \/people\/\{personId\}\/shepherding_activity\/\{activityId\}\s*\{([\s\S]*?)\n    \}/,
        'shepherding_activity'
    );
    assert.match(block, /allow read: if readsAsElder\(\)/);
    assert.match(block, /allow update, delete: if canDecide\(\)/);
    assert.match(block, /allow create: if canDecide\(\)/);
});

test('tag vocabulary, views, relationships and prayer requests admit a Pastoral Assistant write', () => {
    const granted = {
        shepherding_tags: /match \/shepherding_tags\/\{tagId\}\s*\{([\s\S]*?)\n    \}/,
        shepherding_views: /match \/shepherding_views\/\{viewId\}\s*\{([\s\S]*?)\n    \}/,
        relationships: /match \/relationships\/\{edgeId\}\s*\{([\s\S]*?)\n    \}/,
        relationship_types: /match \/relationship_types\/\{typeId\}\s*\{([\s\S]*?)\n    \}/,
        relationship_groups: /match \/relationship_groups\/\{groupId\}\s*\{([\s\S]*?)\n    \}/,
        prayer_requests: /match \/prayer_requests\/\{requestId\}\s*\{([\s\S]*?)\n      \}/,
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
        /match \/people_tags\/\{tagId\}\s*\{([\s\S]*?)\n    \}/,
        'people_tags'
    );
    assert.match(block, /allow create, update, delete: if isEditor\(\) \|\| canDecide\(\)/);
});

test('isElder stays counted-as-elder only — no Pastoral Assistant in the helper', () => {
    assert.doesNotMatch(fnBody(firestore, 'isElder'), /isPastoralAssistant|pastoralAssistant/);
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
    const block = blockFor(firestore, /match \/form_ledger\/\{entryId\}\s*\{([\s\S]*?)\n    \}/, 'form_ledger');
    assert.match(block, /allow read, write: if false/);
});

test('a user cannot write pastoralAssistant on their own user doc', () => {
    const users = blockFor(firestore, /match \/users\/\{userId\}\s*\{([\s\S]*?)\n    \}/, 'users');
    assert.match(users, /affectedKeys\(\)\.hasOnly\(\['dashboardCardOrder'\]\)/);
    assert.doesNotMatch(
        users,
        /hasOnly\(\[[^\]]*pastoralAssistant/,
        'self-update must not list pastoralAssistant as a writable key'
    );
    assert.match(
        users,
        /pastoralAssistant != true|!request\.resource\.data\.pastoralAssistant/,
        'self-create must refuse pastoralAssistant: true'
    );
});

test('rankCanSee admits a Pastoral Assistant to the editor and elder rungs', () => {
    const body = fnBody(firestore, 'rankCanSee');
    assert.match(body, /readsAsEditor\(\) && visibility in \[[^\]]*'editor'/);
    assert.match(body, /readsAsElder\(\) && visibility == 'elder'/);
});

test('storage restates the same helpers and admits a Pastoral Assistant on elder and editor reads', () => {
    ['isPastoralAssistantAccount', 'readsAsElderAccount', 'readsAsEditorAccount', 'canDecideAccount'].forEach(name => {
        assert.match(storage, new RegExp('function ' + name + '\\(\\)'), name);
    });
    const pa = fnBody(storage, 'isPastoralAssistantAccount');
    assert.match(pa, /pastoralAssistant == true/);
    assert.match(fnBody(storage, 'readsAsElderAccount'), /isElderAccount\(\) \|\| isPastoralAssistantAccount\(\)/);
    assert.match(fnBody(storage, 'readsAsEditorAccount'), /isEditorAccount\(\) \|\| isPastoralAssistantAccount\(\)/);
    assert.match(fnBody(storage, 'canDecideAccount'), /isElderAccount\(\) \|\| isPastoralAssistantAccount\(\)/);

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

    assert.match(fnBody(storage, 'rankOrParticipantSees'), /pastoralAssistant == true/);
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
