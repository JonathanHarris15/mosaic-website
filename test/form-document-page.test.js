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
    sandbox.FormDocumentCore = require('../public/form-document-core.js');
    sandbox.ShepherdingDocsCore = require('../public/shepherding-documents-core.js');

    // An update is either one object, or field/value pairs where a field may be
    // a FieldPath (MS-486). Either way it is recorded as one flat patch, keyed
    // by the dotted path, so a test reads what landed where.
    const writes = [];
    function asPatch(args) {
        if (args.length === 1) return args[0];
        const patch = {};
        for (let i = 0; i < args.length; i += 2) {
            const field = args[i];
            patch[field && field.segments ? field.segments.join('.') : field] = args[i + 1];
        }
        return patch;
    }
    sandbox.db = {
        collection: () => ({
            doc: () => ({
                get: () => Promise.resolve({ exists: !!doc, data: () => doc }),
                update: (...args) => { writes.push(asPatch(args)); return Promise.resolve(); },
                onSnapshot: () => () => {},
            }),
        }),
    };
    class FieldPath { constructor(...segments) { this.segments = segments; } }
    sandbox.firebase = { firestore: { FieldPath, FieldValue: { serverTimestamp: () => 'STAMP', delete: () => 'DELETE' } } };
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
    assert.deepEqual(writes[0]['answers.why'], 'A friend');
    assert.ok(!Object.keys(writes[0]).some(k => k.startsWith('questions')), 'saving rewrote the questions');
    assert.ok(!('templateId' in writes[0]), 'saving rewrote where it came from');
    assert.strictEqual(page.saveStatus, 'saved');
});

test('a save writes only the answer that changed, never the whole map (MS-486)', async () => {
    // The whole map put back every answer somebody else had saved since.
    const { page, writes } = await opened(aDocument());
    page.answers.why = 'Moved here';
    await page.save();
    assert.deepEqual(Object.keys(writes[0]).filter(k => k.startsWith('answers')), ['answers.why']);
    assert.ok(!('answers' in writes[0]), 'the whole answers map was written');
    assert.ok(!('title' in writes[0]), 'an untouched title was written');
});

test('opening a form and touching nothing writes nothing', async () => {
    // Its select-all question gets an empty list on open — which is no answer.
    const { page, writes } = await opened(aDocument());
    await page.save();
    assert.strictEqual(writes.length, 0);
    assert.strictEqual(page.saveStatus, 'saved');
});

test('an answer somebody else saved arrives, and is not written back', async () => {
    const { page, writes } = await opened(aDocument());
    const theirs = aDocument();
    theirs.answers.why = 'A friend';
    page.adoptRemote(theirs);
    assert.strictEqual(page.answers.why, 'A friend');
    await page.save();
    assert.strictEqual(writes.length, 0);
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

// ── Live, and one person per question (MS-486 / MS-487) ─────────────────────

function loadsBefore(first, second) {
    const a = MARKUP.indexOf('src="' + first + '"');
    const b = MARKUP.indexOf('src="' + second + '"');
    return a !== -1 && b !== -1 && a < b;
}

test('the page loads the shared rules and the presence store before itself', () => {
    ['live-read.js', 'mosaic-identity.js', 'presence-core.js', 'shepherding-presence.js', 'form-document-core.js']
        .forEach(script => assert.ok(loadsBefore(script, 'shepherding-form-document.js'), script));
});

test('a held question is drawn around the shared markup, never inside it', () => {
    // The public fill-in page mounts the same markup; the hold must not reach it.
    assert.match(MARKUP, /data-form-question :inert="!!questionHolder\(q\)"/);
    assert.match(MARKUP, /@pointerdown="onQuestionPointer\(q\)"/);
    assert.match(MARKUP, /@focusout="leaveQuestion\(q, \$event\)"/);
    assert.ok(!read('form-question-markup.js').includes('questionHolder'),
        'the shared markup knows about holds');
    assert.ok(!read('form-answer.html').includes('shepherding-presence.js'),
        'the public fill-in page loads presence');
});

test('the title is a box, and the faces show who else is here', () => {
    assert.match(MARKUP, /@focus="enterTitle\(\$event\)"/);
    assert.match(MARKUP, /:readonly="!!titleHolder"/);
    assert.match(MARKUP, /othersHere/);
    assert.match(PAGE_SRC, /surface: 'shepherding-form-document'/);
});

test('a hold is let go only after that question\'s save', () => {
    const at = PAGE_SRC.indexOf('async leaveQuestion(');
    const body = PAGE_SRC.slice(at, PAGE_SRC.indexOf('enterTitle(', at));
    assert.ok(body.indexOf('await this.save()') !== -1 && body.indexOf('await this.save()') < body.indexOf('release()'));
});

test('a question somebody took puts the stored answer back instead of saving', async () => {
    const { page, sandbox, writes } = await opened(aDocument());
    sandbox.ShepherdingPresence = { touch: () => false, claimBox: () => true, release: () => {}, holderIn: () => ({ name: 'Ann Lee' }) };
    const q = page.questions.find(x => x.id === 'why');
    page.answers.why = 'Moved here';
    page.touch(q);
    assert.strictEqual(page.answers.why, null);
    assert.match(page.heldNotice, /Ann Lee/);
    await page.save();
    assert.strictEqual(writes.length, 0);
});
