// MS-483 — the Form Document rules the page and the assistant share.
//
// A Form Document used to save by writing every answer back at once, so two
// elders on two different questions overwrote each other, and an answer the
// assistant wrote was put back by the page's next autosave. Now:
//
//   - each answer lives in its own field, and a save writes only the answers
//     that differ from what this page last saved or took in;
//   - a whole answer is the unit — a picked person's id and name travel together;
//   - an answer somebody else changed arrives, unless this page has an unsaved
//     one of its own for that question;
//   - only the save that changed who the document is about re-files it.

const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/form-document-core.js');

const DOC = 'doc-1';
const SUBJECT = 'shepherd_subject';

function record(extra = {}) {
    return Object.assign({
        title: 'Elder Interview',
        docType: 'form',
        shepherdingDoc: true,
        ownerPersonId: 'p-bob',
        questions: [
            { id: SUBJECT, type: 'person', text: 'Who is this document for?' },
            { id: 'h', type: 'section', text: 'About' },
            { id: 'story', type: 'paragraph', text: 'How did they come to faith?' },
            { id: 'nights', type: 'choice_many', text: 'Which nights?', options: ['Mon', 'Tue'] },
            { id: 'ready', type: 'choice_one', text: 'Ready?', options: ['Yes', 'No'] },
        ],
        answers: {
            [SUBJECT]: { personId: 'p-bob', name: 'Bob' },
            story: 'A friend asked him.',
        },
    }, extra);
}

// What the page has on screen: the stored answers, plus the empty list it
// prepares for every select-all question when it opens.
function onScreen(data) {
    return Object.assign({ nights: [] }, JSON.parse(JSON.stringify(data.answers)));
}

// ── Where an answer lives, and what a box is called ──────────────────────────

test('an answer is addressed by its question, as separate segments', () => {
    assert.deepStrictEqual(Core.answerPath('a.b'), ['answers', 'a.b']);
});

test('a question box and the title box name the same thing wherever they are worked out', () => {
    assert.deepStrictEqual(Core.box.question(DOC, 'story'), Core.box.question(DOC, 'story'));
    assert.notDeepStrictEqual(Core.box.question(DOC, 'story'), Core.box.question(DOC, 'ready'));
    assert.notDeepStrictEqual(Core.box.question(DOC, 'story'), Core.box.title(DOC));
    assert.strictEqual(Core.box.question(DOC, 'story').scopeKey, Core.box.title(DOC).scopeKey);
});

test('a section heading is not a box', () => {
    const questions = record().questions;
    assert.strictEqual(Core.isBox(questions.find(q => q.id === 'h')), false);
    assert.strictEqual(Core.isBox(questions.find(q => q.id === 'story')), true);
});

// ── The save set ─────────────────────────────────────────────────────────────

test('opening a form, with its empty select-all lists, saves nothing', () => {
    const data = record();
    const s = Core.createSession(data);
    const save = s.takeSave(onScreen(data), 'Elder Interview');
    assert.deepStrictEqual(save.answers, []);
    assert.strictEqual(save.title, null);
});

test('an empty select-all list and no answer are the same answer', () => {
    assert.strictEqual(Core.sameAnswer([], undefined), true);
    assert.strictEqual(Core.sameAnswer([], null), true);
    assert.strictEqual(Core.sameAnswer('', null), true);
    assert.strictEqual(Core.sameAnswer(['Mon'], []), false);
});

test('the save holds only the answers that changed', () => {
    const data = record();
    const s = Core.createSession(data);
    const now = onScreen(data);
    now.ready = 'Yes';
    const save = s.takeSave(now, 'Elder Interview');
    assert.deepStrictEqual(save.answers, [{ questionId: 'ready', value: 'Yes' }]);
    assert.deepStrictEqual(s.takeSave(now, 'Elder Interview').answers, [], 'a saved answer is not saved again');
});

test('a picked person\'s id and name are one answer', () => {
    const data = record();
    const s = Core.createSession(data);
    const now = onScreen(data);
    now[SUBJECT] = { personId: 'p-sue', name: 'Sue' };
    const save = s.takeSave(now, 'Elder Interview');
    assert.deepStrictEqual(save.answers, [{ questionId: SUBJECT, value: { personId: 'p-sue', name: 'Sue' } }]);
});

test('the title saves on its own, and a blank one saves as Untitled', () => {
    const data = record();
    const s = Core.createSession(data);
    assert.strictEqual(s.takeSave(onScreen(data), '  Elder Interview ').title, null, 'trimming is not a change');
    assert.strictEqual(s.takeSave(onScreen(data), '   ').title, 'Untitled');
});

test('two editors on different questions write no field path in common', () => {
    const data = record();
    const a = Core.createSession(data);
    const b = Core.createSession(data);
    const aNow = onScreen(data); aNow.ready = 'Yes';
    const bNow = onScreen(data); bNow.nights = ['Tue'];
    const key = ans => Core.answerPath(ans.questionId).join('\u0000');
    const pathsA = a.takeSave(aNow, 'Elder Interview').answers.map(key);
    const pathsB = b.takeSave(bNow, 'Elder Interview').answers.map(key);
    assert.ok(pathsA.length && pathsB.length);
    assert.strictEqual(pathsA.filter(p => pathsB.includes(p)).length, 0);
});

test('a failed save is still unsaved, and the stored copy is back', () => {
    const data = record();
    const s = Core.createSession(data);
    const now = onScreen(data);
    now.ready = 'No';
    const save = s.takeSave(now, 'Elder Interview');
    s.saveFailed(save);
    assert.deepStrictEqual(s.answer('ready'), null);
    assert.deepStrictEqual(s.takeSave(now, 'Elder Interview').answers.map(a => a.questionId), ['ready']);
});

test('two saves of one question on their way at once roll back to what was stored before both', () => {
    const data = record();
    const s = Core.createSession(data);
    const now = onScreen(data);
    now.ready = 'Yes';
    const first = s.takeSave(now, 'Elder Interview');
    now.ready = 'No';
    const second = s.takeSave(now, 'Elder Interview');
    s.saveFailed(second);
    s.saveFailed(first);
    assert.strictEqual(s.answer('ready'), null, 'a failure went back to the other save instead of the stored answer');
});

test('a save that landed is not rolled back by a later failure of the same question', () => {
    const data = record();
    const s = Core.createSession(data);
    const now = onScreen(data);
    now.ready = 'Yes';
    const first = s.takeSave(now, 'Elder Interview');
    s.saveLanded(first);
    now.ready = 'No';
    const second = s.takeSave(now, 'Elder Interview');
    s.saveFailed(second);
    assert.strictEqual(s.answer('ready'), 'Yes');
});

// ── Who it is about ──────────────────────────────────────────────────────────

test('re-filing takes it off the old profile, then puts it on the new one', () => {
    assert.deepStrictEqual(Core.refiling('p-bob', 'p-sue'), { off: 'person_p-bob', on: 'person_p-sue' });
    assert.deepStrictEqual(Core.refiling('', 'p-sue'), { off: null, on: 'person_p-sue' });
    assert.deepStrictEqual(Core.refiling('p-bob', ''), { off: 'person_p-bob', on: null });
    assert.strictEqual(Core.refiling('p-bob', 'p-bob'), null);
    assert.strictEqual(Core.refiling('', null), null);
});

test('a stored document needs moving only when who it is about and where it is filed disagree', () => {
    assert.strictEqual(Core.filingPlan(record()), null, 'filed under its subject already');
    const moved = record();
    moved.answers[SUBJECT] = { personId: 'p-sue', name: 'Sue' };
    assert.deepStrictEqual(Core.filingPlan(moved),
        { before: 'p-bob', after: 'p-sue', off: 'person_p-bob', on: 'person_p-sue' });
    const cleared = record();
    delete cleared.answers[SUBJECT];
    assert.deepStrictEqual(Core.filingPlan(cleared), { before: 'p-bob', after: '', off: 'person_p-bob', on: null });
    const notPersonal = record({ shepherdingDoc: false });
    notPersonal.answers[SUBJECT] = { personId: 'p-sue', name: 'Sue' };
    assert.strictEqual(Core.filingPlan(notPersonal), null, 'an ordinary form document is filed nowhere');
});

test('an owner arriving from somebody else is reported, so the page can show it', () => {
    const data = record();
    const s = Core.createSession(data);
    const theirs = record({ ownerPersonId: 'p-sue' });
    theirs.answers[SUBJECT] = { personId: 'p-sue', name: 'Sue' };
    const out = s.adopt(theirs, onScreen(data), {});
    assert.strictEqual(out.ownerPersonId, 'p-sue');
    assert.strictEqual(s.adopt(theirs, onScreen(theirs), {}).ownerPersonId, undefined, 'and only once');
});

// ── Adopting somebody else's change ──────────────────────────────────────────

test('an answer somebody else changed arrives, and is not then saved back', () => {
    const data = record();
    const s = Core.createSession(data);
    const now = onScreen(data);
    const theirs = record();
    theirs.answers.ready = 'Yes';
    const out = s.adopt(theirs, now, {});
    assert.deepStrictEqual(out.answers, [{ questionId: 'ready', value: 'Yes' }]);
    now.ready = 'Yes';
    assert.deepStrictEqual(s.takeSave(now, 'Elder Interview').answers, []);
    assert.deepStrictEqual(s.adopt(theirs, now, {}).answers, [], 'the same arrival twice is nothing new');
});

test('an answer this page has changed and not saved is not adopted', () => {
    const data = record();
    const s = Core.createSession(data);
    const now = onScreen(data);
    now.story = 'Mine, unsaved';
    const theirs = record();
    theirs.answers.story = 'Theirs';
    assert.deepStrictEqual(s.adopt(theirs, now, {}).answers, []);
    assert.deepStrictEqual(s.takeSave(now, 'Elder Interview').answers, [{ questionId: 'story', value: 'Mine, unsaved' }]);
});

test('the question under the cursor waits, and is caught up on entering or leaving', () => {
    const data = record();
    const s = Core.createSession(data);
    const now = onScreen(data);
    const theirs = record();
    theirs.answers.story = 'From the assistant';
    assert.deepStrictEqual(s.adopt(theirs, now, { inQuestion: 'story' }).answers, []);
    assert.deepStrictEqual(s.catchUpQuestion('story', now), { value: 'From the assistant' });
    assert.strictEqual(s.catchUpQuestion('story', Object.assign({}, now, { story: 'From the assistant' })), null);
});

test('catching up after your own save never puts the older answer back', () => {
    const data = record();
    const s = Core.createSession(data);
    const now = onScreen(data);
    now.story = 'Rewritten';
    s.takeSave(now, 'Elder Interview');
    assert.strictEqual(s.catchUpQuestion('story', now), null);
});

test('a select-all answer arrives as a list even when it was cleared', () => {
    const data = record();
    data.answers.nights = ['Mon'];
    const s = Core.createSession(data);
    const now = onScreen(data);
    const theirs = record();
    const out = s.adopt(theirs, now, {});
    assert.deepStrictEqual(out.answers, [{ questionId: 'nights', value: [] }]);
});

test('the title arrives unless this page is renaming it', () => {
    const data = record();
    const s = Core.createSession(data);
    const now = onScreen(data);
    assert.strictEqual(s.adopt(record({ title: 'Interview — Bob' }), now, {}, 'Elder Interview').title, 'Interview — Bob');
    assert.strictEqual(s.adopt(record({ title: 'Other' }), now, { inTitle: true }, 'Interview — Bob').title, null);
    assert.strictEqual(s.catchUpTitle('Interview — Bob'), 'Other');
    assert.strictEqual(s.adopt(record({ title: 'Third' }), now, {}, 'Typed, unsaved').title, null);
});

test('the subject question is the one the forms module names', () => {
    assert.strictEqual(Core.SUBJECT_QUESTION_ID, require('../public/forms-core.js').SUBJECT_QUESTION_ID);
});
