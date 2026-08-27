const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The Documents tab on a Shepherding Profile could never create a document, and
// 2000-plus passing tests did not notice (MS-283).
//
// ⚠ THE BUG THIS EXISTS FOR, AND WHY NOTHING ELSE CATCHES IT.
//
// The tab is the Document Library component mounted inside the profile page:
//
//     <template x-if="personId">
//       <div x-data="documentLibrary({ ..., currentUser: currentUser })">
//
// personId comes off the URL, so it is there on the first tick. The signed-in
// user arrives later, from the Firebase Auth callback. An `x-data` expression is
// evaluated exactly once, so the tab mounted in that gap, copied `currentUser`
// as null, and kept the null for the life of the page. Creating a document read
// `.uid` off it and threw before Firestore was ever contacted.
//
// Two things made it invisible. There is no DOM or component harness here — the
// suite is plain `node --test` over pure logic, so no test mounts Alpine. And the
// other two identity fields, the author's name and the permission level, had
// fallbacks: they failed silently, and would have shipped every pastoral document
// authored by the literal string "Elder".
//
// So this guard reads the source, the way page-script-deps.test.js does for
// missing <script> tags. It cannot prove the tab works. It can prove the two
// shapes that broke it are gone.

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const htmlFiles = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'));

// Every `x-data="documentLibrary..."` mount in the app, with its page. Both
// forms count: the standalone Library page mounts it bare, a profile tab calls
// it with a scope. The attribute is double-quoted and the expression inside uses
// single quotes, so the value is everything up to the next double quote.
function documentLibraryMounts() {
    const mounts = [];
    htmlFiles.forEach(html => {
        for (const m of read(html).matchAll(/x-data="(documentLibrary[^"]*)"/g)) {
            mounts.push({ page: html, expression: m[1] });
        }
    });
    return mounts;
}

const embeddedMounts = () =>
    documentLibraryMounts().filter(m => /embedded:\s*true/.test(m.expression));

// The three fields that were copied at mount. Named here rather than inline so
// adding a fourth identity field to the component means adding it here too.
const IDENTITY_KEYS = ['currentUser', 'currentUserName', 'currentPermissionLevel'];

test('an embedded Document Library is handed no snapshotted identity value', () => {
    const snapshots = [];

    embeddedMounts().forEach(({ page, expression }) => {
        IDENTITY_KEYS.forEach(key => {
            // These three are only ever a copy. A reader is passed as `identity`
            // and names its fields user / name / permissionLevel, so one of these
            // appearing as a config key at all is the shape that broke.
            const copied = new RegExp('\\b' + key + '\\s*:');
            if (copied.test(expression)) {
                snapshots.push(page + ' passes ' + key +
                    ' to an embedded documentLibrary by value; it is null at mount');
            }
        });
    });

    assert.deepStrictEqual(snapshots, [],
        'identity must be passed as a reader, not copied — a copy taken before the\n' +
        'auth callback stays null forever and nothing re-mounts the tab:\n  ' +
        snapshots.join('\n  '));
});

test('an embedded Document Library is handed identity it can re-read', () => {
    const wrong = [];

    embeddedMounts().forEach(({ page, expression }) => {
        const identity = /identity\s*:\s*([^,]*)/.exec(expression);
        if (!identity) {
            wrong.push(page + ' mounts an embedded documentLibrary with no identity at all');
            return;
        }
        if (!/=>|function/.test(identity[1])) {
            wrong.push(page + ' passes identity to an embedded documentLibrary as a value, ' +
                'not a function — it will be read once and never again');
        }
    });

    assert.deepStrictEqual(wrong, [], wrong.join('\n  '));
});

test('the component takes no copy of identity from its config either', () => {
    const src = read('shepherding-documents.js');
    const copied = IDENTITY_KEYS.filter(key => src.includes('config.' + key));

    assert.deepStrictEqual(copied, [],
        'reading ' + copied.join(', ') + ' off config freezes it at mount time; ' +
        'read through config.identity() instead');
});

test('the create path never dereferences the signed-in user without a guard', () => {
    const src = read('shepherding-documents.js');
    const unguarded = [...src.matchAll(/this\.currentUser\s*\.\s*([A-Za-z_$][\w$]*)/g)]
        .map(m => 'this.currentUser.' + m[1]);

    assert.deepStrictEqual(unguarded, [],
        'this.currentUser is null until auth resolves, so reading a property off it\n' +
        'throws before Firestore is contacted and the generic catch hides it.\n' +
        'Go through the `author` getter, or guard the read:\n  ' +
        unguarded.join('\n  '));
});

test('the document record is built at the testable seam, not inline', () => {
    const src = read('shepherding-documents.js');

    assert.match(src, /Docs\.buildElderDocument\(/,
        'createDocument must build its record through the core builder — that is ' +
        'what refuses an unauthored document and what a unit test can reach');
    assert.doesNotMatch(src, /authorUid\s*:/,
        'assembling authorUid inline puts the record back where no test can see it');
});

// Without this, a change to the mount's shape would leave the guards above
// silently scanning nothing and passing.
test('this guard is actually looking at the Documents tab', () => {
    const mounts = documentLibraryMounts();
    assert.ok(mounts.length >= 2,
        'expected both the Library page and the profile tab, found ' + mounts.length);

    const embedded = embeddedMounts();
    assert.deepStrictEqual(embedded.map(m => m.page), ['shepherding-profile.html'],
        'the embedded Document Library is the Shepherding Profile Documents tab');
    assert.match(embedded[0].expression, /ownerPersonId:\s*personId/,
        'the embedded mount is scoped to the Person whose profile it is');
});
