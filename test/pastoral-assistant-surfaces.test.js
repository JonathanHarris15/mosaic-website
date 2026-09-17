const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MS-521 / MS-522 — no shepherding or elder-rung surface still decides
// access from a private rank list. The access core is the one answer.

const PUBLIC = path.join(__dirname, '..', 'public');

const SHEPHERD_JS = [
    'shepherding-dashboard.js',
    'shepherding-profile.js',
    'shepherding-people.js',
    'shepherding-documents.js',
    'shepherding-document.js',
    'shepherding-care-list.js',
    'shepherding-tags.js',
    'shepherding-tasks.js',
    'analytics.js',
    'peoples-page.js',
    'service-builder.js',
    'forms.js',
    'form.js',
    'printables.js',
    'roles-manager.js',
    'mcp-manager.js',
];

const PHONE_JS = [
    'mobile/screens-shepherd.js',
    'mobile/screens-documents.js',
    'mobile/screens-document-editor.js',
    'mobile/screens-carelist.js',
    'mobile/screens-shepherd-tags.js',
    'mobile/screens-content.js',
];

const PRIVATE_ELDER = /\[.elder.,\s*.super_admin.\]\.includes\(/;

test('web shepherd and editor-workroom pages ask the access core, not a private elder list', () => {
    SHEPHERD_JS.forEach((rel) => {
        const src = fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
        assert.doesNotMatch(src, PRIVATE_ELDER, rel + ' still has a private elder list');
        assert.match(src, /AccessCore\.(pageFlags|readsAsElder|readsAsEditor|writesAsEditor|writesTheRecord|isAnElder|liftsHidden)/, rel + ' never asks the access core');
    });
});

test('phone shepherd screens ask the access core instead of permissionLevel === elder', () => {
    PHONE_JS.forEach((rel) => {
        const src = fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
        assert.doesNotMatch(
            src,
            /permissionLevel === ["']elder["'] \|\| .*permissionLevel === ["']super_admin["']/,
            rel + ' still decides shepherding from permissionLevel === elder');
        assert.match(src, /AccessCore/, rel + ' never asks the access core');
    });
});

test('index.html cards ask reads-as-elder / reads-as-editor', () => {
    const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    assert.match(src, /AccessCore\.readsAsElder/);
    assert.match(src, /AccessCore\.readsAsEditor/);
    assert.match(src, /access-core\.js/);
});

test('the super-admin blur does not apply to a Pastoral Assistant', () => {
    const src = fs.readFileSync(path.join(PUBLIC, 'shepherding-blur.js'), 'utf8');
    assert.match(src, /permissionLevel === 'super_admin' && !state\.pastoralAssistant/);
});
