const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-384 — what a Form Document actually is.
//
// It is an Elder Document with a third `docType`. That is worth saying plainly,
// because the ticket expected this to break ADR-0049 ("four documents, one
// shape") and it does not: `care-list` already carries its own payload —
// `careListData` — instead of a body of prose. A Form Document is the same
// move, carrying its questions and answers instead. ADR-0049's "one shape" is
// about the record and its path, not about every document holding TipTap.
//
// So nothing new is stored anywhere new. The Document Library lists it, files
// it, renames it, moves it and deletes it without knowing which kind it is, and
// no rule changes. Only opening it differs.
//
// ⚠ THE SNAPSHOT IS THE PROMISE. A Form Document keeps the questions it was
// created with. Editing the template afterwards must never reach back into
// interviews already filled in — a record has to keep the question it was
// actually asked. Same reasoning that retires a question rather than deleting
// it on a `responses` form.

const ROOT = path.join(__dirname, '..');
const Docs = require('../public/shepherding-documents-core.js');
const FormsCore = require('../public/forms-core.js');

const author = { uid: 'u1', name: 'Keegan' };
const STAMP = 'server-timestamp';

const template = () => FormsCore.buildFormTemplate({
    title: 'Elder Interview',
    mode: 'document',
    questions: [
        { id: 'h', type: 'section', text: 'About you' },
        { id: 'when', type: 'date', text: 'When did you first come?' },
        { id: 'why', type: 'choice_one', text: 'What brought you?', options: ['A friend', 'Moved here'] },
    ],
});

const build = (over) => Docs.buildElderDocument(Object.assign({
    title: 'Elder Interview — Rebecca',
    docType: 'form',
    author: author,
    timestamp: STAMP,
    templateId: 'tmpl_1',
    questions: template().questions,
}, over || {}));

// ── It is a document like the others ─────────────────────────────────────────

test('a Form Document is an Elder Document with a third docType', () => {
    const doc = build();
    assert.strictEqual(doc.docType, 'form');
    assert.strictEqual(doc.title, 'Elder Interview — Rebecca');
    assert.strictEqual(doc.authorName, 'Keegan');
    assert.strictEqual(doc.createdAt, STAMP);
});

test('it carries no body of prose, the way a care list does not either', () => {
    // The precedent this follows. A care list holds careListData; this holds
    // questions and answers. Neither is a TipTap document, and neither is a
    // departure from how documents are stored.
    const doc = build();
    assert.ok(!('contentJson' in doc) || doc.contentJson == null,
        'a form document has no prose body to hold');

    const careList = Docs.buildElderDocument({
        title: 'Care list', docType: 'care-list', author, timestamp: STAMP, filterId: 'f1',
    });
    assert.ok(!careList.contentJson, 'the precedent has moved — check this is still true');
});

test('an ordinary document is completely unaffected', () => {
    const note = Docs.buildElderDocument({
        title: 'Notes', docType: 'note', author, timestamp: STAMP,
    });
    assert.strictEqual(note.docType, 'note');
    assert.strictEqual(note.contentJson, null);
    assert.ok(!('questions' in note), 'a blank document grew form fields');
    assert.ok(!('answers' in note));
});

test('it refuses to exist unauthored, like every other Elder Document', () => {
    assert.throws(() => build({ author: null }));
    assert.throws(() => build({ author: { uid: 'u1' } }));
});

// ── The snapshot ─────────────────────────────────────────────────────────────

test('it keeps the questions it was created with', () => {
    const doc = build();
    assert.deepEqual(doc.questions.map(q => q.id), ['h', 'when', 'why']);
    assert.strictEqual(doc.questions[1].type, 'date');
    assert.deepEqual(doc.questions[2].options, ['A friend', 'Moved here']);
});

test('editing the template afterwards does not reach into a document already made', () => {
    // The promise the record keeps, and the reason the questions are copied
    // rather than referenced.
    const source = template();
    const doc = build({ questions: source.questions });

    source.questions[1].text = 'CHANGED';
    source.questions.push({ id: 'extra', type: 'short_text', text: 'A new question' });

    assert.strictEqual(doc.questions[1].text, 'When did you first come?',
        'the document followed an edit to its template');
    assert.strictEqual(doc.questions.length, 3,
        'a question added to the template appeared in a document already written');
});

test('it remembers which template it came from, without depending on it', () => {
    // Useful for saying "made from the Elder Interview" and for counting how
    // many exist before a template's mode may change. Never read to draw the
    // document — that is what the snapshot is for.
    assert.strictEqual(build().templateId, 'tmpl_1');
});

test('a document made from a template that has since been deleted still opens', () => {
    const doc = build({ templateId: null });
    assert.deepEqual(doc.questions.map(q => q.id), ['h', 'when', 'why'],
        'the questions are the document\'s own, so a missing template costs nothing');
});

// ── Answers ──────────────────────────────────────────────────────────────────

test('a new one starts with no answers rather than absent ones', () => {
    const doc = build();
    assert.deepEqual(doc.answers, {},
        'an absent answers field is one every reader has to guard against');
});

test('a section heading is in the snapshot but can never hold an answer', () => {
    const doc = build();
    const heading = doc.questions.find(q => q.id === 'h');
    assert.strictEqual(heading.type, 'section');
    assert.strictEqual(FormsCore.asksSomething(heading.type), false);
});

// ── Nothing about the rules changed ──────────────────────────────────────────

test('a Form Document needs no rule of its own, and none was written', () => {
    // It is an elder_documents record, so isElder() already covers it. This
    // asserts the ABSENCE deliberately: a rule appearing here later would mean
    // somebody had moved the storage without revisiting the decision.
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(!rules.includes('form_documents'),
        'a separate collection appeared — the ADR says a Form Document is an Elder Document');
    assert.match(rules, /match \/elder_documents\/\{docId\} \{\s*\n\s*allow read, write: if isElder\(\);/,
        'the rule a Form Document relies on has changed');
});
