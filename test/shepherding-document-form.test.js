const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-405 — a Form Template that is an interview ABOUT somebody.
//
// Ticking "a personal shepherding document" does two things that are really one
// thing: the first question becomes the Directory Person picker that names who
// the document is for, and every document made from it lives on that person's
// Shepherding Profile as well as in the Document Library.
//
// The question has a FIXED id, and that is what makes the filing possible. A
// document keeps a copy of its questions and never reads its template again
// (ADR-0055), so the page that files it has only the answers in hand and has to
// know which key to look under without asking anybody.

const FormsCore = require('../public/forms-core.js');
const Docs = require('../public/shepherding-documents-core.js');

const ROOT = path.join(__dirname, '..');
const read = (dir, name) => fs.readFileSync(path.join(ROOT, dir, name), 'utf8').replace(/\r\n/g, '\n');

const SUBJECT = FormsCore.SUBJECT_QUESTION_ID;

// ── The template ─────────────────────────────────────────────────────────────

test('ticking it puts the person picker first, and it is the only one', () => {
    const f = FormsCore.buildFormTemplate({
        title: 'Elder Membership Interview',
        mode: 'document',
        shepherdingDoc: true,
        questions: [{ id: 'a', type: 'short_text', text: 'Summarise their testimony.' }],
    });
    assert.equal(f.questions.length, 2);
    assert.equal(f.questions[0].id, SUBJECT);
    assert.equal(f.questions[0].type, 'person');
    assert.equal(f.questions[0].required, true);
    assert.equal(f.questions[1].id, 'a');
});

test('a subject question that was moved or retyped is put back where it belongs', () => {
    // The author can drag and delete in a browser. The model is what decides,
    // so the next save is the correction.
    const f = FormsCore.buildFormTemplate({
        title: 'X', mode: 'document', shepherdingDoc: true,
        questions: [
            { id: 'a', type: 'short_text', text: 'First' },
            { id: SUBJECT, type: 'short_text', text: 'Who is this interview for?', retired: true },
        ],
    });
    assert.equal(f.questions[0].id, SUBJECT);
    assert.equal(f.questions[0].type, 'person', 'the subject stopped being a person picker');
    assert.equal(f.questions[0].retired, false, 'the subject was retired out of the way');
    assert.equal(f.questions.filter(q => q.id === SUBJECT).length, 1);
});

test('the wording is the author’s to change, the question is not', () => {
    const f = FormsCore.buildFormTemplate({
        title: 'X', mode: 'document', shepherdingDoc: true,
        questions: [{ id: SUBJECT, type: 'person', text: 'Who is this interview for?' }],
    });
    assert.equal(f.questions[0].text, 'Who is this interview for?');
});

test('unticking it leaves the questions alone and takes the flag off', () => {
    const on = FormsCore.buildFormTemplate({
        title: 'X', mode: 'document', shepherdingDoc: true,
        questions: [{ id: 'a', type: 'short_text', text: 'First' }],
    });
    const off = FormsCore.buildFormTemplate(Object.assign({}, on, { shepherdingDoc: false }));
    assert.equal(off.shepherdingDoc, false);
    assert.equal(off.questions.length, 2, 'the subject question was deleted out from under an author');
    assert.equal(FormsCore.isSubjectQuestion(off, off.questions[0]), false,
        'the question is still treated as pinned on a form that is no longer one');
});

test('only a document can be one — a form people answer has no single subject', () => {
    const responses = FormsCore.buildFormTemplate({ title: 'Sign-up', shepherdingDoc: true });
    assert.equal(responses.shepherdingDoc, false);
    assert.ok(!responses.questions.some(q => q.id === SUBJECT),
        'a form people answer was given a subject question');
});

test('every template carries the flag, so no reader has to guard against it missing', () => {
    assert.ok('shepherdingDoc' in FormsCore.buildFormTemplate({ title: 'X' }));
    assert.equal(FormsCore.isShepherdingDoc(null), false);
    assert.equal(FormsCore.isShepherdingDoc({}), false);
});

// ── Who it is about ──────────────────────────────────────────────────────────

test('the subject is read off the answers under a fixed id, never off the template', () => {
    assert.equal(FormsCore.subjectPersonId({ answers: { [SUBJECT]: { personId: 'p9', name: 'Jane' } } }), 'p9');
    assert.equal(FormsCore.subjectPersonId({ answers: {} }), '');
    assert.equal(FormsCore.subjectPersonId({}), '');
    assert.equal(FormsCore.subjectPersonId(null), '');
});

// ── The record it makes ──────────────────────────────────────────────────────

test('the document is stamped, so its page knows what it is holding', () => {
    const doc = Docs.buildElderDocument({
        title: 'Interview', docType: 'form', author: { uid: 'u1', name: 'An Elder' },
        timestamp: 1, templateId: 't1', questions: [], shepherdingDoc: true,
    });
    assert.equal(doc.shepherdingDoc, true);
});

test('started from a profile it opens already answered with them, and in both places', () => {
    const doc = Docs.buildElderDocument({
        title: 'Interview', docType: 'form', author: { uid: 'u1', name: 'An Elder' },
        timestamp: 1, questions: [], ownerPersonId: 'p9', shepherdingDoc: true,
        answers: { [SUBJECT]: { personId: 'p9', name: 'Jane Example' } },
        inLibrary: true,
    });
    assert.equal(doc.ownerPersonId, 'p9');
    assert.equal(doc.inLibrary, true, 'it is waiting to be opted into the Library it is already in');
    assert.equal(FormsCore.subjectPersonId(doc), 'p9');
});

test('an ordinary profile document is still opted into the Library by hand', () => {
    const note = Docs.buildElderDocument({
        title: 'A note', docType: 'note', author: { uid: 'u1', name: 'An Elder' },
        timestamp: 1, ownerPersonId: 'p9',
    });
    assert.equal(note.inLibrary, false);
    assert.equal(note.shepherdingDoc, undefined);
});

test('filing is idempotent, so a document cannot land on one profile twice', () => {
    const structure = { children: [] };
    assert.equal(Docs.fileInRoot(structure, 'd1'), true);
    assert.equal(Docs.fileInRoot(structure, 'd1'), false);
    assert.equal(structure.children.length, 1);
    // Already inside a folder counts as filed — refiling would make a copy.
    const nested = { children: [{ type: 'folder', id: 'f1', children: [{ type: 'document', id: 'd2' }] }] };
    assert.equal(Docs.fileInRoot(nested, 'd2'), false);
});

// ── The builder ──────────────────────────────────────────────────────────────

test('the switch is drawn in the What this is card, for elders only', () => {
    const html = read('public', 'form.html');
    assert.match(html, /setShepherdingDoc\(\$event\.target\.checked\)/, 'there is no switch');
    assert.match(html, /x-show="isDocument && elderOnlySetting\.available"/,
        'the switch is offered on a form people answer, or to somebody who is not an elder');
});

test('the pinned question loses the buttons it would not obey', () => {
    const html = read('public', 'form.html');
    ['Move up', 'Move down', 'Duplicate'].forEach(title => {
        const row = html.split('title="' + title + '"')[0].split('\n').pop();
        assert.ok(row.includes('x-show="!isSubject(q)"'), title + ' is still offered on the subject question');
    });
    assert.match(html, /Always first/, 'nothing says why the buttons are missing');
});

test('the builder refuses to move or delete it, rather than letting the model undo it', () => {
    const js = read('public', 'form.js');
    const remove = js.match(/removeQuestion\(q\) \{[\s\S]*?const n = this\.answersFor/);
    assert.ok(remove && remove[0].includes('isSubject(q)'), 'deleting the subject question is not refused');
    const move = js.match(/move\(q, by\) \{[\s\S]*?\n        \},/);
    assert.ok(move && move[0].includes('isSubject(q)'), 'the subject question can be moved');
    assert.ok(move[0].includes('isShepherdingDoc(this.form) ? 1 : 0'),
        'another question can be moved above the subject question');
});

// ── Both places ──────────────────────────────────────────────────────────────

test('started from a profile, it is filed in the Library as well', () => {
    const js = read('public', 'shepherding-documents.js');
    assert.match(js, /alsoFileInLibrary\(docRef\.id\)/, 'a profile-started document never reaches the Library');
    assert.match(js, /shepherding && this\.isProfileScope/,
        'a Library-started document is filed on a profile before anybody is named');
});

test('answering the first question files it on that person, and changing it moves it', () => {
    const js = read('public', 'shepherding-form-document.js');
    assert.match(js, /async refileForSubject\(\)/, 'nothing files it on a profile');
    assert.match(js, /if \(was\) await this\.unfileFrom/, 'changing the answer leaves it on two profiles');
    assert.ok(js.indexOf('unfileFrom(') < js.indexOf('fileOn(\'person_\' + now)'),
        'it is added to the new profile before being taken off the old one');
    assert.match(js, /this\.doc && this\.doc\.shepherdingDoc/,
        'it reads the template rather than the stamp on the record');
});
