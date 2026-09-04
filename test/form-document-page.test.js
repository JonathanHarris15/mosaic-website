const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// MS-386 — a Form Document, open.
//
// The page is loaded in a sandbox and exercised against the code it ships with,
// like form-answer-page.test.js.
//
// What is pinned here is mostly the promise the record makes. A Form Document
// draws ITS OWN questions, copied when it was created, and never reads them back
// off its template (ADR-0055) — one line doing that would let an edit reach into
// interviews already written. And saving writes only the answers, so a save can
// never quietly rewrite the questions somebody was actually asked.

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8').replace(/\r\n/g, '\n');

const PAGE_SRC = read('shepherding-form-document.js');
const MARKUP = read('shepherding-form-document.html');

function loadPage(doc) {
    const sandbox = {
        console, Promise, Date, Object, Array, Math, String, Number, JSON,
        Set, Map, encodeURIComponent, URLSearchParams, setTimeout, clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.location = { search: '?id=doc_1', href: '', pathname: '/shepherding-form-document.html' };
    sandbox.FormsCore = require('../public/forms-core.js');
    // The page loads this too, and the component spreads its state in.
    sandbox.NewPersonCard = require('../public/new-person-card.js');

    const writes = [];
    sandbox.db = {
        collection: () => ({
            doc: () => ({
                get: () => Promise.resolve({ exists: !!doc, data: () => doc }),
                update: (patch) => { writes.push(patch); return Promise.resolve(); },
            }),
        }),
    };
    sandbox.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'STAMP' } } };
    sandbox.auth = { onAuthStateChanged: (cb) => { sandbox._authCb = cb; } };
    sandbox.getUserData = () => Promise.resolve({ name: 'Keegan' });

    vm.createContext(sandbox);
    vm.runInContext(PAGE_SRC, sandbox);

    const page = sandbox.formDocumentPage();
    page.$nextTick = (fn) => fn && fn();
    return { page, sandbox, writes };
}

const aDocument = () => ({
    title: 'Elder Interview — Rebecca',
    docType: 'form',
    authorName: 'Keegan',
    templateId: 'tmpl_1',
    questions: [
        { id: 'h', type: 'section', text: 'About you' },
        { id: 'when', type: 'date', text: 'When did you first come?' },
        { id: 'why', type: 'choice_one', text: 'What brought you?', options: ['A friend', 'Moved here'] },
        { id: 'nights', type: 'choice_many', text: 'Which nights?', options: ['Mon', 'Tue'] },
    ],
    answers: { when: '2026-01-11' },
});

async function opened(doc) {
    const loaded = loadPage(doc);
    loaded.page.init();
    await loaded.sandbox._authCb({ uid: 'u1', displayName: 'Keegan' });
    return loaded;
}

// ── It draws its own questions ───────────────────────────────────────────────

test('it opens with the questions the document itself holds', async () => {
    const { page } = await opened(aDocument());
    assert.deepEqual(page.questions.map(q => q.id), ['h', 'when', 'why', 'nights']);
    assert.strictEqual(page.answers.when, '2026-01-11');
    assert.strictEqual(page.title, 'Elder Interview — Rebecca');
});

test('it never reads its template', () => {
    // The line that would undo ADR-0055. The template id is kept so the
    // document can say where it came from, and is never fetched to draw it.
    assert.ok(!PAGE_SRC.includes("collection('forms')"),
        'the page reaches for the template it was made from');
    assert.match(PAGE_SRC, /data\.questions/, 'it does not read the document\'s own questions');
});

test('a document whose template has been deleted still opens', async () => {
    const doc = aDocument();
    doc.templateId = null;
    const { page } = await opened(doc);
    assert.strictEqual(page.questions.length, 4);
    assert.strictEqual(page.problem, '');
});

test('a document that has gone says so rather than spinning', async () => {
    const { page } = await opened(null);
    assert.match(page.problem, /no longer exists/);
    assert.strictEqual(page.loading, false);
});

// ── Numbering ────────────────────────────────────────────────────────────────

test('a heading is not numbered, and does not push the questions along', async () => {
    const { page } = await opened(aDocument());
    assert.strictEqual(page.asks(page.questions[0]), false, 'the heading asks nothing');
    assert.strictEqual(page.numberFor(1), 1, 'the first real question is question 1');
    assert.strictEqual(page.numberFor(2), 2);
    assert.strictEqual(page.numberFor(3), 3);
});

test('it says how much is filled in, and counts only real questions', async () => {
    const { page } = await opened(aDocument());
    assert.strictEqual(page.askedCount, 3, 'the heading was counted as a question');
    assert.strictEqual(page.answeredCount, 1);
    assert.match(page.progressLine, /1 of 3/);
});

// ── Lists ────────────────────────────────────────────────────────────────────

test('a select-all answer is a list before the first box is ticked', async () => {
    // Binding a checkbox group pushes into an array and does not make one.
    const { page } = await opened(aDocument());
    assert.ok(Array.isArray(page.answers.nights));
    assert.deepEqual(page.answers.nights, []);
});

// ── Saving ───────────────────────────────────────────────────────────────────

test('saving writes the answers and never the questions', async () => {
    // A save that rewrote the questions could quietly change what somebody was
    // asked, which is the one thing the record must not do.
    const { page, writes } = await opened(aDocument());
    page.answers.why = 'A friend';
    await page.save();

    assert.strictEqual(writes.length, 1);
    assert.deepEqual(writes[0].answers.why, 'A friend');
    assert.ok(!('questions' in writes[0]), 'saving rewrote the questions');
    assert.ok(!('templateId' in writes[0]), 'saving rewrote where it came from');
    assert.strictEqual(page.saveStatus, 'saved');
});

test('it saves itself on a debounce rather than on a button', async () => {
    const { page } = await opened(aDocument());
    page.touch();
    assert.strictEqual(page.saveStatus, 'unsaved');
    assert.match(PAGE_SRC, /setTimeout\(\(\) => this\.save\(\), 1500\)/,
        'the debounce no longer matches the other document editors');
});

test('a failed save says so and keeps what is on screen', async () => {
    const { page, sandbox } = await opened(aDocument());
    page.answers.why = 'Moved here';
    sandbox.db.collection = () => ({
        doc: () => ({ update: () => Promise.reject(new Error('offline')) }),
    });
    await page.save();

    assert.strictEqual(page.saveStatus, 'unsaved', 'a failed save reported itself as saved');
    assert.strictEqual(page.answers.why, 'Moved here', 'a failed save threw away what was typed');
    assert.match(page.problem, /still here/);
});

test('an untitled document is saved with a name rather than none', async () => {
    const { page, writes } = await opened(aDocument());
    page.title = '   ';
    await page.save();
    assert.strictEqual(writes[0].title, 'Untitled');
});

// ── The page ─────────────────────────────────────────────────────────────────

test('it draws the shared controls rather than its own', async () => {
    assert.match(MARKUP, /data-form-question/, 'no mount point for the shared controls');
    assert.match(MARKUP, /form-question-markup\.js/, 'the shared controls are not loaded');
    ['choice_many', 'dropdown', 'number', 'scale', 'date', 'time'].forEach(type => {
        assert.ok(!MARKUP.includes("q.type === '" + type + "'"),
            'the page has its own ' + type + ' control instead of the shared one');
    });
});

test('the shared controls are mounted at the end of the body', () => {
    // Not "before Alpine's script tag", which is what this used to check and
    // was wrong: a deferred script runs after parsing wherever its tag sits.
    // What matters is that the mount runs after the slots have been parsed and
    // before Alpine walks them — one inline script at the end of <body>.
    // The full reasoning, and the nested-template case, is in
    // form-question-markup.test.js.
    const mountAt = MARKUP.indexOf('FormQuestionMarkup.mount()');
    assert.ok(mountAt !== -1, 'the page never mounts the shared controls');
    assert.ok(mountAt > MARKUP.lastIndexOf('data-form-question'),
        'the controls are mounted before the slot has been parsed');
    assert.ok(mountAt > MARKUP.indexOf('<body'), 'the mount is still in the head');
});

test('it shows the same three save states as the other document editors', () => {
    ['saving', 'saved', 'unsaved'].forEach(state => {
        assert.ok(MARKUP.includes("saveStatus === '" + state + "'"),
            'the ' + state + ' state is not shown');
    });
});

test('the library opens a form document on this page', () => {
    const library = read('shepherding-documents.js');
    assert.match(library, /docType === 'form'/, 'the library does not recognise a form document');
    assert.match(library, /shepherding-form-document\.html\?id=/,
        'the library does not open a form document anywhere');
});
