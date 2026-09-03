const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const fp = require('../functions/forms-public.js');
const FormsCore = require('../public/forms-core.js');

const TODAY = '2026-09-02';

const aForm = (over) => FormsCore.buildFormTemplate(Object.assign({
    title: 'Inductive Bible Study — Spring sign-up',
    published: true,
    rung: 'public',
    questions: [
        { id: 'q1', type: 'short_text', text: 'Your name', required: true },
        { id: 'q2', type: 'paragraph', text: 'Anything we should know?' },
    ],
}, over || {}));

const stranger = { signedIn: false, rank: null };
const member = { signedIn: true, rank: 'member' };

// ── The oracle problem ───────────────────────────────────────────────────────

test('a missing form and an unpublished one answer identically', () => {
    // Different answers here would turn the endpoint into an oracle: guess ids,
    // and the replies tell you which are real. The 128-bit id is only worth
    // anything if guessing fails SILENTLY.
    const missing = fp.whatToServe(null, stranger, TODAY);
    const draft = fp.whatToServe(aForm({ published: false }), stranger, TODAY);
    assert.deepStrictEqual(missing, draft);
    assert.strictEqual(missing.code, 'not-found');
});

test('a members-only form does not tell a stranger when it closed', () => {
    // The rung is asked BEFORE the closing date. What a form is called and when
    // it shut are still facts about a form they were never allowed to see.
    const shut = aForm({ rung: 'member', closed: true });
    const served = fp.whatToServe(shut, stranger, TODAY);
    assert.strictEqual(served.code, 'sign-in-required');
    assert.ok(!('title' in served), 'the title leaked');
    assert.ok(!('closedOn' in served));
});

// ── What actually leaves ─────────────────────────────────────────────────────

test('an answerer gets the questions and nothing else about the record', () => {
    const form = aForm({
        createdBy: 'uid-1', createdByName: 'Jonathan Harris', updatedByName: 'Jonathan Harris',
    });
    const served = fp.whatToServe(form, stranger, TODAY);
    assert.ok(served.ok);
    // An exact list on purpose: a new field reaching an answerer should have to
    // be added here deliberately, not arrive because somebody widened a spread.
    assert.deepStrictEqual(Object.keys(served.view).sort(), ['attribution', 'description', 'questions', 'rung', 'title']);
    assert.deepStrictEqual(Object.keys(served.view.questions[0]).sort(),
        ['hint', 'id', 'placeholder', 'required', 'text', 'type']);
    const json = JSON.stringify(served.view);
    assert.ok(!json.includes('createdBy'), 'who wrote it went out with the questions');
    assert.ok(!json.includes('Jonathan'), 'an author name reached an answerer');
    assert.ok(!json.includes('oneEach'));
});

test('a retired question is never served', () => {
    const form = aForm({
        questions: [
            { id: 'q1', type: 'short_text', text: 'Your name', required: true },
            { id: 'qOld', type: 'short_text', text: 'A question we stopped asking', retired: true },
        ],
    });
    const served = fp.whatToServe(form, stranger, TODAY);
    assert.deepStrictEqual(served.view.questions.map(q => q.id), ['q1']);
});

test('a ballot tells the answerer which promise it is keeping', () => {
    const form = aForm({ rung: 'member', attribution: false, oneEach: true });
    const served = fp.whatToServe(form, member, TODAY);
    assert.strictEqual(served.view.ballot, true);
    assert.strictEqual(served.view.promise, FormsCore.BALLOT_PROMISE);
});

test('a closed form gives its title and date, and never its questions', () => {
    const form = aForm({ closingDate: '2026-08-30' });
    const served = fp.whatToServe(form, stranger, TODAY);
    assert.strictEqual(served.ok, false);
    assert.strictEqual(served.code, 'closed');
    assert.strictEqual(served.title, form.title, 'a working link that reads as broken generates a phone call');
    assert.strictEqual(served.closedOn, '2026-08-30');
    assert.ok(!('view' in served), 'the questions went out with the refusal');
});

// ── The rung ─────────────────────────────────────────────────────────────────

test('the ladder here matches the one in firestore.rules', () => {
    // forms-public.js restates isMember()/isEditor()/isElder() because the rules
    // language cannot export anything. Restated is fine; drifted is not.
    const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
    const listFor = name => {
        const m = rules.match(new RegExp('function ' + name + '\\(\\)[\\s\\S]*?in \\[([^\\]]+)\\]'));
        assert.ok(m, 'could not find ' + name + '() in firestore.rules');
        return m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).sort();
    };
    assert.deepStrictEqual(fp.RANKS_AT_OR_ABOVE.member.slice().sort(), listFor('isMember'));
    assert.deepStrictEqual(fp.RANKS_AT_OR_ABOVE.editor.slice().sort(), listFor('isEditor'));
    assert.deepStrictEqual(fp.RANKS_AT_OR_ABOVE.elder.slice().sort(), listFor('isElder'));
});

test('a public form is open to a stranger; a members one is not', () => {
    assert.ok(fp.whatToServe(aForm(), stranger, TODAY).ok);
    assert.strictEqual(fp.whatToServe(aForm({ rung: 'member' }), stranger, TODAY).code, 'sign-in-required');
    assert.ok(fp.whatToServe(aForm({ rung: 'member' }), member, TODAY).ok);
});

test('a signed-in viewer is refused a members form, and told so differently', () => {
    const viewer = { signedIn: true, rank: 'viewer' };
    assert.strictEqual(fp.whatToServe(aForm({ rung: 'member' }), viewer, TODAY).code, 'permission-denied');
});

// ── Taking the answer ────────────────────────────────────────────────────────

test('every reason a form cannot be opened is a reason it cannot be answered', () => {
    const shut = aForm({ closed: true });
    const verdict = fp.judgeSubmission(shut, { formId: 'f1', answers: { q1: 'Rebecca' } }, TODAY);
    assert.strictEqual(verdict.ok, false);
    assert.strictEqual(verdict.code, 'closed');
});

test('a missing required answer is named, not just counted', () => {
    const verdict = fp.judgeSubmission(aForm(), { formId: 'f1', answers: {} }, TODAY);
    assert.strictEqual(verdict.code, 'incomplete');
    assert.deepStrictEqual(verdict.missing, [{ id: 'q1', text: 'Your name' }]);
});

test('an optional question left blank is fine', () => {
    const verdict = fp.judgeSubmission(aForm(), { formId: 'f1', answers: { q1: 'Rebecca' } }, TODAY);
    assert.ok(verdict.ok);
});

test('a public form writes no ledger entry', () => {
    const verdict = fp.judgeSubmission(aForm(), { formId: 'f1', answers: { q1: 'Rebecca' } }, TODAY);
    assert.strictEqual(verdict.ledger, null, 'a form anyone can open has nobody to count');
    assert.ok(!('personId' in verdict.response));
});

test('an attributed one-each form lets somebody change their answer', () => {
    const form = aForm({ rung: 'member', attribution: true, oneEach: true });
    const verdict = fp.judgeSubmission(form, {
        formId: 'f1', answers: { q1: 'Rebecca' }, signedIn: true, rank: 'member',
        personId: 'p1', personName: 'Rebecca Lyle', alreadyAnswered: 'f1_p1',
    }, TODAY);
    assert.ok(verdict.ok);
    assert.strictEqual(verdict.replaces, 'f1_p1');
    assert.strictEqual(verdict.response.personId, 'p1');
    assert.deepStrictEqual(verdict.ledger, { formId: 'f1', personId: 'p1', answeredOn: TODAY });
});

test('a ballot refuses a second answer, because it cannot find the first', () => {
    // Not policy — construction. Returning somebody's own anonymous answer
    // needs the join ADR-0052 forbids, and a system that can show you your own
    // secret vote can be made to show it to somebody else.
    const form = aForm({ rung: 'member', attribution: false, oneEach: true });
    const verdict = fp.judgeSubmission(form, {
        formId: 'f1', answers: { q1: 'Chili' }, signedIn: true, rank: 'member',
        personId: 'p1', alreadyAnswered: 'f1_p1',
    }, TODAY);
    assert.strictEqual(verdict.ok, false);
    assert.strictEqual(verdict.code, 'already-answered');
    assert.match(verdict.message, /secret ballot/);
});

test('a first ballot answer carries no person, but does mark the ledger', () => {
    const form = aForm({ rung: 'member', attribution: false, oneEach: true });
    const verdict = fp.judgeSubmission(form, {
        formId: 'f1', answers: { q1: 'Chili' }, signedIn: true, rank: 'member', personId: 'p1',
    }, TODAY);
    assert.ok(verdict.ok);
    assert.ok(!('personId' in verdict.response), 'the answer must not know who gave it');
    assert.strictEqual(verdict.ledger.personId, 'p1', 'the ledger must know that they answered');
    assert.strictEqual(verdict.ledger.answeredOn, TODAY);
    assert.ok(!('answers' in verdict.ledger), 'the ledger must not know what they said');
});

test('somebody with no linked Person is refused a one-each form rather than let through', () => {
    const form = aForm({ rung: 'member', attribution: true, oneEach: true });
    const verdict = fp.judgeSubmission(form, {
        formId: 'f1', answers: { q1: 'Rebecca' }, signedIn: true, rank: 'member', personId: null,
    }, TODAY);
    assert.strictEqual(verdict.code, 'no-person');
});

// ── An answer that is there and does not fit (MS-378) ────────────────────────
//
// Six question types went live in MS-377, and each one has a way of being
// answered wrongly that the fill-in page cannot produce. A scale draws a row of
// buttons between its own ends; a date box hands back a date. So a value outside
// those was typed into the request rather than clicked, and the server is the
// only place that matters.

const richForm = (over) => FormsCore.buildFormTemplate(Object.assign({
    title: 'Spring sign-up',
    published: true,
    rung: 'public',
    questions: [
        { id: 'q1', type: 'short_text', text: 'Your name', required: true },
        {
            id: 'howoften', type: 'scale', text: 'How often do you come?',
            scale: { min: 1, max: 5, minLabel: 'Never', maxLabel: 'Every week' },
        },
        { id: 'nights', type: 'choice_many', text: 'Which nights?', options: ['Mon', 'Tue'] },
        { id: 'when', type: 'date', text: 'Which day suits?' },
        { id: 'start', type: 'time', text: 'What time?' },
        { id: 'howmany', type: 'number', text: 'How many of you?' },
    ],
}, over || {}));

const answered = (over) => Object.assign({ q1: 'Rebecca' }, over || {});

test('an answer that fits every question is written', () => {
    const verdict = fp.judgeSubmission(richForm(), {
        formId: 'f1',
        answers: answered({
            howoften: 5, nights: ['Mon'], when: '2026-11-03', start: '19:30', howmany: '2',
        }),
    }, TODAY);
    assert.strictEqual(verdict.ok, true);
});

test('a scale answered off the end of its own range is refused', () => {
    const verdict = fp.judgeSubmission(richForm(), {
        formId: 'f1', answers: answered({ howoften: 9 }),
    }, TODAY);
    assert.strictEqual(verdict.ok, false);
    assert.strictEqual(verdict.code, 'unanswerable');
    assert.strictEqual(verdict.missing.length, 1);
    assert.strictEqual(verdict.missing[0].id, 'howoften');
    assert.ok(verdict.missing[0].text, 'the refusal has to name the question');
});

test('a date that is not a date, and a time that is not a time, are refused', () => {
    const badDate = fp.judgeSubmission(richForm(), {
        formId: 'f1', answers: answered({ when: 'next Tuesday' }),
    }, TODAY);
    assert.strictEqual(badDate.code, 'unanswerable');

    const badTime = fp.judgeSubmission(richForm(), {
        formId: 'f1', answers: answered({ start: 'half seven' }),
    }, TODAY);
    assert.strictEqual(badTime.code, 'unanswerable');
});

test('an option the form never offered is refused', () => {
    const verdict = fp.judgeSubmission(richForm(), {
        formId: 'f1', answers: answered({ nights: ['Mon', 'Sunday'] }),
    }, TODAY);
    assert.strictEqual(verdict.code, 'unanswerable');
});

test('a number question refuses prose', () => {
    const verdict = fp.judgeSubmission(richForm(), {
        formId: 'f1', answers: answered({ howmany: 'a few of us' }),
    }, TODAY);
    assert.strictEqual(verdict.code, 'unanswerable');
});

test('leaving the optional ones blank is not an error', () => {
    // Only REQUIRED questions must be answered. A partial Response is ordinary.
    const verdict = fp.judgeSubmission(richForm(), { formId: 'f1', answers: answered() }, TODAY);
    assert.strictEqual(verdict.ok, true);
});

test('a blank required question is reported before a wrong answer is', () => {
    // Somebody who left half the form empty is told that, rather than being
    // corrected on the half they did fill in.
    const verdict = fp.judgeSubmission(richForm(), {
        formId: 'f1', answers: { howoften: 99 },
    }, TODAY);
    assert.strictEqual(verdict.code, 'incomplete');
});
