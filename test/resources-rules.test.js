const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MS-693 — the Resources library boundary, in BOTH engines.
//
// The whole point of the ticket's permissions line is that the gate is not a
// hidden button. A member may read the shelf; an editor fills it; and both
// halves have to be true where the data is, because the page is JavaScript
// anybody can edit in a console.
//
// These rules cannot be exercised from here — that needs a live project, the
// same limit every other rules test in this repo works within. What CAN be
// pinned is the shape, and the shape is where this would fail: one
// `allow read: if request.auth != null` under the Storage catch-all and the
// shelf is open to any self-service sign-up.
//
// Normalised to LF: the block patterns close on a newline plus spaces, which
// never matches a CRLF checkout, leaving the shape they pin unchecked.
const root = path.join(__dirname, '..');
const firestoreRules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');
const storageRules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

const firestoreBlock = (name) => {
    const m = new RegExp('match /' + name + '/\\{[a-zA-Z]+\\}\\s*\\{([\\s\\S]*?)\\n    \\}')
        .exec(firestoreRules);
    assert.ok(m, 'the ' + name + ' Firestore rule has moved or been renamed');
    return m[1];
};

const storageBlock = () => {
    const m = /match \/resources\/\{resourceId\}\/\{fileName\}\s*\{([\s\S]*?)\n    \}/
        .exec(storageRules);
    assert.ok(m, 'the Resources Storage rule has moved or been renamed');
    return m[1];
};

const storageFn = (name) => {
    const m = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n    \\}')
        .exec(storageRules);
    assert.ok(m, 'storage.rules no longer defines ' + name + '()');
    return m[1];
};

// ── Firestore: members read, resources.edit writes ───────────────────────────

for (const collection of ['resources', 'resource_folders']) {
    test(`${collection} is read by members, not by every account`, () => {
        const block = firestoreBlock(collection);
        assert.match(block, /allow read: if isMember\(\);/,
            'the shelf is for the congregation, and `isSignedIn()` here would be ' +
            'the whole library handed to a self-service sign-up (MS-240)');
    });

    test(`${collection} is written with the resources.edit key`, () => {
        const block = firestoreBlock(collection);
        assert.match(block,
            /allow create, update, delete: if editsWith\('resources\.edit'\);/,
            'writes go through the ADR-0082 door so unticking the key in ' +
            'Admin → Accounts actually takes it away');
    });

    test(`${collection} grants nothing on a level name alone`, () => {
        const block = firestoreBlock(collection);
        assert.doesNotMatch(block, /isEditor\(\)/,
            'a plain isEditor() OR beside the key is the one-way grant ADR-0082 removed');
    });
}

test('resources.edit is a real MS-695 permission key', () => {
    const { PERMISSION_KEYS, LABELS } = require('../public/permission-catalog.js');
    assert.ok(PERMISSION_KEYS.includes('resources.edit'));
    assert.equal(typeof LABELS['resources.edit'], 'string');
});

test('the key is on the editor presets, since the surface is new', () => {
    const Catalog = require('../public/permission-catalog.js');
    const Levels = require('../public/account-levels-core.js');
    assert.ok(Catalog.EDITOR_SURFACE_KEYS.includes('resources.edit'));
    for (const preset of ['editor', 'admin', 'elder', 'pastoral_assistant', 'super_admin']) {
        assert.equal(Levels.buildPresetPermissions(preset)['resources.edit'], true, preset);
    }
    for (const preset of ['member', 'viewer']) {
        assert.equal(Levels.buildPresetPermissions(preset)['resources.edit'], false, preset);
    }
});

// ── The page gate answers what the rules answer ──────────────────────────────

test('AccessCore.canEditResources is the mirror of the write door', () => {
    const Access = require('../public/access-core.js');
    const Levels = require('../public/account-levels-core.js');

    const savedEditor = Levels.userWriteFromLevel(Levels.accountLevelIdForPreset('editor'));
    assert.equal(Access.canEditResources(savedEditor), true);

    const savedMember = Levels.userWriteFromLevel(Levels.accountLevelIdForPreset('member'));
    assert.equal(Access.canEditResources(savedMember), false);

    // A legacy account with no saved map keeps the level names.
    assert.equal(Access.canEditResources({ permissionLevel: 'editor' }), true);
    assert.equal(Access.canEditResources({ permissionLevel: 'member' }), false);
    assert.equal(Access.canEditResources(null), false);

    // And a saved map revokes, however editor-ish the stored level string.
    const revoked = Object.assign(
        Levels.userWriteFromLevel('level_custom_x', {
            custom: true,
            presetKey: 'member',
            permissions: Object.assign({}, Levels.buildPresetPermissions('member'), {
                'resources.edit': false,
            }),
        }), { permissionLevel: 'editor', role: 'editor' });
    assert.equal(Access.canEditResources(revoked), false);
});

test('AccessCore.readsAsMember is the mirror of isMember()', () => {
    const Access = require('../public/access-core.js');
    // The rung names in firestore.rules isMember(), read out of the file so
    // the mirror cannot drift from the thing it mirrors.
    const m = /function isMember\(\) \{[\s\S]*?permissionLevel\(\) in \[([^\]]*)\]/
        .exec(firestoreRules);
    assert.ok(m, 'firestore.rules no longer defines isMember() that way');
    const levels = m[1].match(/'[a-z_]+'/g).map(s => s.slice(1, -1));
    assert.deepEqual(Access.MEMBER_READ_LEVELS.slice(), levels);

    for (const level of levels) {
        assert.equal(Access.readsAsMember({ permissionLevel: level }), true, level);
    }
    assert.equal(Access.readsAsMember({ permissionLevel: 'viewer' }), false);
    assert.equal(Access.readsAsMember({ permissionLevel: 'kiosk' }), false);
    assert.equal(Access.readsAsMember(null), false);
    // The leftover flag still counts, the way the rule's isPastoralAssistant() does.
    assert.equal(Access.readsAsMember({ permissionLevel: 'viewer', pastoralAssistant: true }), true);
    // The STORED level, not the rung auth.js resolved — the rules see only the former.
    assert.equal(Access.readsAsMember({ permissionLevel: 'member', storedLevel: 'viewer' }), false);
});

// ── Storage: the bytes answer the same question as the record ────────────────

test('reading a resource file is not granted to anyone merely signed in', () => {
    assert.doesNotMatch(storageBlock(), /allow read: if request\.auth != null;/,
        'sign-up is self-service, so that line is the shelf published to the internet ' +
        'with an email address in front of it');
});

test('reading a resource file asks for the member rung', () => {
    assert.match(storageBlock(), /allow read: if isMemberAccount\(\);/);
});

test('storage isMemberAccount restates firestore isMember, rung for rung', () => {
    const inStorage = /levelOf\(myUserDoc\(\)\) in \[([^\]]*)\]/.exec(storageFn('isMemberAccount'));
    assert.ok(inStorage, 'isMemberAccount() no longer reads a rung list');
    const inFirestore = /function isMember\(\) \{[\s\S]*?permissionLevel\(\) in \[([^\]]*)\]/
        .exec(firestoreRules);
    assert.equal(
        inStorage[1].match(/'[a-z_]+'/g).join(','),
        inFirestore[1].match(/'[a-z_]+'/g).join(','),
        'one of the two files learned about a rung and the other did not');
});

test('storage editsWithAccount restates firestore editsWith, clause for clause', () => {
    assert.match(storageFn('editsWithAccount'),
        /hasPermissionAccount\(key\)\s*\|\| \(!usesPermissionMapAccount\(\) && isEditorAccount\(\)\)/,
        'drop the !usesPermissionMapAccount() guard and a saved map stops revoking here');
    assert.match(firestoreRules,
        /function editsWith\(key\) \{\s*return hasPermission\(key\)\s*\|\| \(!usesPermissionMap\(\) && isEditor\(\)\);\s*\}/);
});

test('uploading needs the resources.edit key and stays under the cap', () => {
    const block = storageBlock();
    assert.match(block, /allow write: if editsWithAccount\('resources\.edit'\)/);
    assert.match(block, /request\.resource\.size < 25 \* 1024 \* 1024/,
        'without the cap in the rule, a browser that skips the check parks anything it likes');
});

test('the Storage cap and the cap the browser enforces are the same number', () => {
    const Core = require('../public/resources-core.js');
    const m = /request\.resource\.size < ([0-9]+) \* 1024 \* 1024/.exec(storageBlock());
    assert.equal(Number(m[1]) * 1024 * 1024, Core.MAX_FILE_BYTES);
});

test('deleting the bytes needs the same key as deleting the record', () => {
    assert.match(storageBlock(), /allow delete: if editsWithAccount\('resources\.edit'\);/,
        'unlike the other paths in this file, this one knows whose bytes these are: ' +
        'they live under the id of the record that owns them');
});

// ⚠ THE ORIGINAL VERSION OF THIS TEST WAS WRONG, AND WRONG IN THE DIRECTION
// THAT READS AS SAFE.
//
// It asserted the resources block sits ABOVE the `{allPaths=**}` catch-all,
// on the belief that an earlier rule wins. Firebase Security Rules do not
// work that way: "if any rule the file matches evaluates to true, the result
// is true", and position in the file is not consulted. Moving the block
// bought nothing, and the green test said otherwise.
//
// So this pins the true state instead: the catch-all is still there, it is
// still `request.auth != null`, and that is why the block above it does not
// yet bind. When the catch-all is finally closed, this test fails — which is
// the right moment to delete it and assert the boundary for real.
// docs/ops/ms-693-storage-rules-vs-live.md has the audit.
test('the catch-all still overrides the resources block, and is named as doing so', () => {
    assert.match(storageRules, /match \/\{allPaths=\*\*\} \{\s*\n\s*allow read, write: if request\.auth != null;/,
        'the catch-all changed shape — if it is gone, the resources block now binds, ' +
        'so replace this test with one that asserts the boundary instead of the hole');

    const block = storageBlock();
    assert.match(block, /allow read: if isMemberAccount\(\);/,
        'the rule this path should have, and will have the moment the catch-all goes');

    assert.match(storageRules, /docs\/ops\/ms-693-storage-rules-vs-live\.md/,
        'a reader of this file has to be able to find out why the block above does not bind');
});

// ── The half of the boundary that is not a rule ──────────────────────────────

const codeOnly = (file) => fs.readFileSync(path.join(root, 'public', file), 'utf8')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

test('nothing in the library mints a permanent download link', () => {
    for (const file of ['resources-store.js', 'resources.js']) {
        assert.doesNotMatch(codeOnly(file), /getDownloadURL/,
            file + ': one getDownloadURL() on this path undoes every rule above, permanently');
    }
});

test('a resource file is fetched with the reader\'s own credentials', () => {
    assert.match(codeOnly('resources-store.js'), /Authorization: 'Firebase ' \+ token/,
        'without the reader\'s token on the request, storage.rules cannot tell who is asking');
});

test('the record keeps a path, never a URL, for an uploaded file', () => {
    const Core = require('../public/resources-core.js');
    const file = Core.buildFileResource({
        name: 'Romans 8.docx',
        storagePath: 'resources/abc/Romans 8.docx',
        size: 1234,
    });
    assert.equal(file.url, null, 'a file resource has no URL to hand out');
    assert.equal(file.storagePath, 'resources/abc/Romans 8.docx');
});
