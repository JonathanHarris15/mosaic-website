const { test } = require('node:test');
const assert = require('node:assert');

const FormsCore = require('../public/forms-core.js');

// ── The form's id (ADR-0051) ─────────────────────────────────────────────────

test('a form id is base58 and says nothing about the form', () => {
    const bytes = new Uint8Array(16).fill(0xAB);
    const id = FormsCore.formIdFromBytes(bytes);
    assert.ok(FormsCore.looksLikeFormId(id), 'should be a plausible id: ' + id);
    assert.doesNotMatch(id, /[0OIl]/, 'base58 drops the characters people misread');
});

test('the same bytes give the same id, different bytes do not', () => {
    const a = FormsCore.formIdFromBytes(new Uint8Array(16).fill(1));
    const b = FormsCore.formIdFromBytes(new Uint8Array(16).fill(1));
    const c = FormsCore.formIdFromBytes(new Uint8Array(16).fill(2));
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
});

test('an id is refused rather than shortened when there is not enough randomness', () => {
    // Silently padding would produce a guessable id that looks like a good one.
    assert.throws(() => FormsCore.formIdFromBytes(new Uint8Array(4)), /randomness/);
});

test('a title is never mistaken for an id', () => {
    assert.strictEqual(FormsCore.looksLikeFormId('monday-food'), false);
    assert.strictEqual(FormsCore.looksLikeFormId(''), false);
});

// ── The title ────────────────────────────────────────────────────────────────

test('a title is capped at 90 characters in the model, not the text box', () => {
    const long = 'x'.repeat(200);
    assert.strictEqual(FormsCore.normaliseTitle(long).length, 90);
});

test('a blank title falls back rather than saving empty', () => {
    assert.strictEqual(FormsCore.normaliseTitle('   '), FormsCore.DEFAULT_TITLE);
    assert.ok(FormsCore.isUntitled(''));
    assert.ok(!FormsCore.isUntitled('Church camp'));
});

// ── The rung, and the two settings it constrains ─────────────────────────────

test('public is the only rung that needs no account', () => {
    assert.strictEqual(FormsCore.needsAccount('public'), false);
    ['member', 'editor', 'elder'].forEach(r => {
        assert.strictEqual(FormsCore.needsAccount(r), true, r + ' should need an account');
    });
});

test('a public form cannot record who answered, and says why', () => {
    const s = FormsCore.settingsFor('public');
    assert.strictEqual(s.attribution.available, false);
    assert.strictEqual(s.attribution.value, false);
    assert.match(s.attribution.why, /no account to attach/);
});

test('a public form cannot be one-each, and gives a DIFFERENT reason', () => {
    // Two settings, two reasons. One blanket sentence over both is a greyed box
    // with no why, which is what the design was right to reject.
    const s = FormsCore.settingsFor('public');
    assert.strictEqual(s.oneEach.available, false);
    assert.match(s.oneEach.why, /tell one person from another/);
    assert.notStrictEqual(s.oneEach.why, s.attribution.why);
});

test('a members form offers both', () => {
    const s = FormsCore.settingsFor('member');
    assert.strictEqual(s.attribution.available, true);
    assert.strictEqual(s.oneEach.available, true);
});

test('a form saved as public cannot carry settings its rung forbids', () => {
    // The record must not contradict its own rung — something downstream would
    // believe it.
    const form = FormsCore.buildFormTemplate({
        title: 'Monday food', rung: 'public', attribution: true, oneEach: true,
    });
    assert.strictEqual(form.attribution, false);
    assert.strictEqual(form.oneEach, false);
});

test('a secret ballot is members + anonymous + one each, and nothing else', () => {
    const ballot = FormsCore.buildFormTemplate({ rung: 'member', attribution: false, oneEach: true });
    assert.ok(FormsCore.isBallot(ballot));

    assert.ok(!FormsCore.isBallot(FormsCore.buildFormTemplate({ rung: 'member', attribution: true, oneEach: true })),
        'a named form is not a ballot');
    assert.ok(!FormsCore.isBallot(FormsCore.buildFormTemplate({ rung: 'member', attribution: false, oneEach: false })),
        'anonymous without one-each is just anonymous');
    assert.ok(!FormsCore.isBallot(FormsCore.buildFormTemplate({ rung: 'public' })),
        'a public form cannot be a ballot — it cannot tell voters apart');
});

// ── Closing (asked, never swept) ─────────────────────────────────────────────

test('a form is answerable all through its closing day', () => {
    const form = FormsCore.buildFormTemplate({ closingDate: '2026-09-21', published: true });
    assert.strictEqual(FormsCore.isClosed(form, '2026-09-20'), false);
    assert.strictEqual(FormsCore.isClosed(form, '2026-09-21'), false, 'the 21st is still open');
    assert.strictEqual(FormsCore.isClosed(form, '2026-09-22'), true);
});

test('a form pressed closed is closed whatever the date says', () => {
    const form = FormsCore.buildFormTemplate({ closed: true, closingDate: '2099-01-01' });
    assert.strictEqual(FormsCore.isClosed(form, '2026-09-02'), true);
});

test('a form with no closing date never closes on its own', () => {
    const form = FormsCore.buildFormTemplate({ published: true });
    assert.strictEqual(FormsCore.isClosed(form, '2099-12-31'), false);
});

test('unpublished and closed are different answers, and both refuse', () => {
    const draft = FormsCore.buildFormTemplate({ published: false });
    assert.deepStrictEqual(FormsCore.answerability(draft, '2026-09-02'), { open: false, reason: 'unpublished' });

    const shut = FormsCore.buildFormTemplate({ published: true, closed: true });
    assert.deepStrictEqual(FormsCore.answerability(shut, '2026-09-02'), { open: false, reason: 'closed' });

    const open = FormsCore.buildFormTemplate({ published: true });
    assert.deepStrictEqual(FormsCore.answerability(open, '2026-09-02'), { open: true, reason: null });
});

// ── Questions ────────────────────────────────────────────────────────────────

test('thirteen ways of asking, one way of not asking, and four still to come', () => {
    // MS-360 shipped three live and ten greyed; MS-377 lit six more, and what
    // is left greyed is the four that need something beyond a control on a page
    // — the directory picker and attachments (MS-363), and payment (MS-364).
    //
    // The fourteenth is the section heading (MS-379), and it is not a way of
    // asking at all: it is the one entry that collects nothing. The picker was
    // built for thirteen so that growing into them was not a redesign; adding a
    // heading to the same list, in its own group, is the same bet paying off.
    assert.strictEqual(FormsCore.QUESTION_TYPES.length, 14);
    const live = FormsCore.QUESTION_TYPES.filter(t => t.live).map(t => t.id);
    assert.deepStrictEqual(live, [
        'short_text', 'paragraph', 'choice_one', 'choice_many',
        'dropdown', 'number', 'scale', 'date', 'time',
        'image', 'file', 'person', 'section',
    ]);
    // MS-388 lit the last three that reach outside the form. Only payment is
    // left, and it is MS-364 — the one that needs an account with Stripe before
    // a single line of it can be true.
    const waiting = FormsCore.QUESTION_TYPES.filter(t => !t.live).map(t => t.id);
    assert.deepStrictEqual(waiting, ['payment']);
});

test('a question of a type that is not live yet falls back rather than saving', () => {
    const q = FormsCore.buildQuestion({ id: 'q1', type: 'payment', text: 'Pay up' });
    assert.strictEqual(q.type, 'short_text');
});

test('only choice questions carry options', () => {
    const choice = FormsCore.buildQuestion({ id: 'q1', type: 'choice_one', options: ['Tuesday, 7pm', '  ', 'Thursday, 7pm'] });
    assert.deepStrictEqual(choice.options, ['Tuesday, 7pm', 'Thursday, 7pm'], 'blank options are dropped');

    const para = FormsCore.buildQuestion({ id: 'q2', type: 'paragraph', options: ['x'] });
    assert.ok(!('options' in para));
});

test('a retired question is kept but never asked', () => {
    // A question carrying answers is retired, never deleted — otherwise the
    // tally it already gathered loses its label.
    const form = FormsCore.buildFormTemplate({
        questions: [
            { id: 'q1', type: 'short_text', text: 'Your name' },
            { id: 'q2', type: 'short_text', text: 'Old question', retired: true },
        ],
    });
    assert.strictEqual(form.questions.length, 2, 'both are kept on the record');
    assert.deepStrictEqual(FormsCore.askedQuestions(form).map(q => q.id), ['q1']);
});

// ── Validation ───────────────────────────────────────────────────────────────

test('a required question left blank is named, an optional one is not', () => {
    const form = FormsCore.buildFormTemplate({
        questions: [
            { id: 'q1', type: 'short_text', text: 'Your name', required: true },
            { id: 'q2', type: 'short_text', text: 'Best phone number', required: true },
            { id: 'q3', type: 'paragraph', text: 'Anything we should know?' },
        ],
    });
    const missing = FormsCore.missingRequired(form, { q1: 'Rebecca' });
    assert.deepStrictEqual(missing, [{ id: 'q2', text: 'Best phone number' }]);
});

test('whitespace is not an answer', () => {
    const form = FormsCore.buildFormTemplate({
        questions: [{ id: 'q1', type: 'short_text', text: 'Your name', required: true }],
    });
    assert.strictEqual(FormsCore.missingRequired(form, { q1: '   ' }).length, 1);
});

test('a retired required question does not block a submission', () => {
    const form = FormsCore.buildFormTemplate({
        questions: [{ id: 'q1', type: 'short_text', text: 'Gone', required: true, retired: true }],
    });
    assert.deepStrictEqual(FormsCore.missingRequired(form, {}), []);
});

test('a partial response is ordinary, not broken', () => {
    const form = FormsCore.buildFormTemplate({
        questions: [
            { id: 'q1', type: 'short_text', text: 'Name', required: true },
            { id: 'q2', type: 'paragraph', text: 'Notes' },
        ],
    });
    assert.deepStrictEqual(FormsCore.missingRequired(form, { q1: 'Daniel' }), []);
});

// ── A Response, and the field that must be ABSENT (ADR-0052) ─────────────────

test('an attributed response carries the Person', () => {
    const r = FormsCore.buildResponse({ formId: 'f1', attribution: true, personId: 'p1', personName: 'Rebecca Lyle', answers: { q1: 'yes' } });
    assert.strictEqual(r.personId, 'p1');
    assert.strictEqual(r.personName, 'Rebecca Lyle');
});

test('an anonymous response has NO person field — absent, not null', () => {
    // A null personId beside a populated one on the next form is a shape
    // somebody later "fixes" by backfilling. Absent is unambiguous.
    const r = FormsCore.buildResponse({ formId: 'f1', attribution: false, personId: 'p1', answers: { q1: 'Chili' } });
    assert.ok(!('personId' in r), 'personId must not be present at all');
    assert.ok(!('personName' in r));
    assert.strictEqual(JSON.stringify(r).includes('personId'), false);
});

test('the ledger holds who answered and nothing about what they said', () => {
    const e = FormsCore.buildLedgerEntry({ formId: 'f1', personId: 'p1', answeredOn: '2026-09-02' });
    assert.deepStrictEqual(Object.keys(e).sort(), ['answeredOn', 'formId', 'personId']);
    assert.strictEqual(JSON.stringify(e).includes('answer'), true, 'answeredOn is a date, not an answer');
    assert.ok(!('answers' in e));
});

test('a ledger entry is dated to the day, never finer', () => {
    // Millisecond ordering would line the ledger back up against the answers
    // without either gaining a field.
    const e = FormsCore.buildLedgerEntry({ formId: 'f1', personId: 'p1', answeredOn: '2026-09-02T14:33:07.221Z' });
    assert.strictEqual(e.answeredOn, null, 'anything finer than a day is refused, not truncated silently');
});

// ── Reading anonymous answers back ───────────────────────────────────────────

test('anonymous answers are handed back in an order that is not arrival order', () => {
    const responses = Array.from({ length: 20 }, (_, i) => ({ id: 'r' + i }));
    const read = FormsCore.anonymousReadOrder(responses, 'someFormId');
    const ids = read.map(x => x.response.id);
    assert.notDeepStrictEqual(ids, responses.map(r => r.id), 'arrival order is the correlation channel');
    assert.deepStrictEqual(ids.slice().sort(), responses.map(r => r.id).sort(), 'nothing is lost or duplicated');
});

test('two people reading the same form at once see the same answer 6', () => {
    const responses = Array.from({ length: 20 }, (_, i) => ({ id: 'r' + i }));
    const a = FormsCore.anonymousReadOrder(responses, 'someFormId');
    const b = FormsCore.anonymousReadOrder(responses, 'someFormId');
    assert.deepStrictEqual(a.map(x => x.response.id), b.map(x => x.response.id));
    assert.strictEqual(a[5].handle, 6, 'the handle is a 1-based position');
});

test('a different form shuffles differently', () => {
    const responses = Array.from({ length: 20 }, (_, i) => ({ id: 'r' + i }));
    const a = FormsCore.anonymousReadOrder(responses, 'formOne').map(x => x.response.id);
    const b = FormsCore.anonymousReadOrder(responses, 'formTwo').map(x => x.response.id);
    assert.notDeepStrictEqual(a, b);
});

test('the handle carries no date', () => {
    const read = FormsCore.anonymousReadOrder([{ id: 'r1', submittedAt: '2026-08-31' }], 'f1');
    assert.deepStrictEqual(Object.keys(read[0]).sort(), ['handle', 'response']);
    assert.strictEqual(typeof read[0].handle, 'number');
});

// ── Where the form is filed (MS-375) ─────────────────────────────────────────

test('a Form Template remembers the folder it is filed in', () => {
    const form = FormsCore.buildFormTemplate({ title: 'Harvest supper', folderId: 'y2025' });
    assert.strictEqual(form.folderId, 'y2025');
});

test('an unfiled form says so explicitly rather than leaving the field off', () => {
    // Explicit null, so "at the top level" and "written before folders existed"
    // cannot be told apart by accident. Either way the library shows it — a form
    // is reachable by its public link whether or not anybody filed it.
    const form = FormsCore.buildFormTemplate({ title: 'Elder interview' });
    assert.strictEqual(form.folderId, null);
});

// ── The rest of the plain question types (MS-377) ─────────────────────────────
//
// MS-360 named all thirteen types and marked three of them working. Six more go
// live here. Two of those need more than a flag: a linear scale carries the ends
// it runs between, and a date or a time is stored in a form that SORTS, because
// "the 3rd" and "the 12th" fall the wrong way round as ordinary words.

test('the six plain types are live, and payment alone is still to come', () => {
    ['choice_many', 'dropdown', 'number', 'scale', 'date', 'time'].forEach(id => {
        assert.ok(FormsCore.isLiveType(id), id + ' should be live now');
    });
    // Was MS-363 and MS-364; MS-388 lit the first three. Payment alone is
    // still named in the picker and still greyed.
    ['payment'].forEach(id => {
        assert.ok(!FormsCore.isLiveType(id), id + ' belongs to a later ticket');
    });
});

test('a linear scale carries the ends it runs between, and a word for each', () => {
    const q = FormsCore.buildQuestion({
        id: 'q1', type: 'scale', text: 'How often do you come?',
        scale: { min: 1, max: 5, minLabel: 'Never', maxLabel: 'Every week' },
    });
    assert.equal(q.scale.min, 1);
    assert.equal(q.scale.max, 5);
    assert.equal(q.scale.minLabel, 'Never');
    assert.equal(q.scale.maxLabel, 'Every week');
});

test('a scale nobody configured is still answerable', () => {
    const q = FormsCore.buildQuestion({ id: 'q1', type: 'scale', text: 'Rate it' });
    assert.ok(q.scale.max > q.scale.min, 'a scale with no range is a question nobody can answer');
});

test('a scale cannot be built upside down or unreadably long', () => {
    const upsideDown = FormsCore.buildQuestion({
        id: 'q1', type: 'scale', text: 'x', scale: { min: 9, max: 2 },
    });
    assert.ok(upsideDown.scale.max > upsideDown.scale.min);

    const huge = FormsCore.buildQuestion({
        id: 'q2', type: 'scale', text: 'x', scale: { min: 1, max: 500 },
    });
    assert.ok(huge.scale.max <= 10, 'a 500-point scale is a row of buttons off the side of a phone');
});

// ── What counts as an answer, per type ───────────────────────────────────────

const scaleForm = () => ({
    questions: [FormsCore.buildQuestion({
        id: 'q1', type: 'scale', text: 'How often?', scale: { min: 1, max: 5 },
    })],
});

test('a scale answered at either end is fine', () => {
    assert.deepEqual(FormsCore.answerProblems(scaleForm(), { q1: 1 }), []);
    assert.deepEqual(FormsCore.answerProblems(scaleForm(), { q1: 5 }), []);
});

test('a scale answered outside its ends is refused, and the question is named', () => {
    const tooHigh = FormsCore.answerProblems(scaleForm(), { q1: 6 });
    assert.equal(tooHigh.length, 1);
    assert.equal(tooHigh[0].id, 'q1');
    assert.ok(tooHigh[0].text, 'a refusal that does not say which question is not usable');
    assert.equal(FormsCore.answerProblems(scaleForm(), { q1: 0 }).length, 1);
    assert.equal(FormsCore.answerProblems(scaleForm(), { q1: 'three' }).length, 1);
});

test('a number question refuses something that is not a number', () => {
    const form = { questions: [FormsCore.buildQuestion({ id: 'q1', type: 'number', text: 'How many?' })] };
    assert.deepEqual(FormsCore.answerProblems(form, { q1: '12' }), []);
    assert.deepEqual(FormsCore.answerProblems(form, { q1: '-3' }), []);
    assert.equal(FormsCore.answerProblems(form, { q1: 'a few' }).length, 1);
});

test('a date is a date and a time is a time, or neither is accepted', () => {
    const form = {
        questions: [
            FormsCore.buildQuestion({ id: 'd', type: 'date', text: 'Which day?' }),
            FormsCore.buildQuestion({ id: 't', type: 'time', text: 'What time?' }),
        ],
    };
    assert.deepEqual(FormsCore.answerProblems(form, { d: '2026-11-03', t: '18:30' }), []);
    assert.equal(FormsCore.answerProblems(form, { d: '3rd November' }).length, 1);
    assert.equal(FormsCore.answerProblems(form, { d: '2026-13-01' }).length, 1, 'there is no thirteenth month');
    assert.equal(FormsCore.answerProblems(form, { t: '6.30pm' }).length, 1);
    assert.equal(FormsCore.answerProblems(form, { t: '25:00' }).length, 1);
});

test('a choice answer has to be one of the choices offered', () => {
    const form = {
        questions: [
            FormsCore.buildQuestion({ id: 'one', type: 'dropdown', text: 'Pick', options: ['A', 'B'] }),
            FormsCore.buildQuestion({ id: 'many', type: 'choice_many', text: 'Pick some', options: ['A', 'B'] }),
        ],
    };
    assert.deepEqual(FormsCore.answerProblems(form, { one: 'A', many: ['A', 'B'] }), []);
    assert.equal(FormsCore.answerProblems(form, { one: 'C' }).length, 1,
        'an option the form does not offer is somebody typing into the request');
    assert.equal(FormsCore.answerProblems(form, { many: ['A', 'C'] }).length, 1);
});

test('a question left unanswered is not a wrong answer', () => {
    // Only REQUIRED questions must be answered — a partial Response is ordinary.
    // Being absent is missingRequired's business, not this one's.
    assert.deepEqual(FormsCore.answerProblems(scaleForm(), {}), []);
});

// ── Reading them back ────────────────────────────────────────────────────────

test('a scale is read back as a distribution and an average, not a list of strings', () => {
    const form = scaleForm();
    const responses = [
        { answers: { q1: '5' } }, { answers: { q1: '3' } },
        { answers: { q1: '5' } }, { answers: { q1: '1' } },
    ];
    const row = FormsCore.tally(form, responses)[0];
    assert.equal(row.answered, 4);
    assert.equal(row.average, 3.5);
    assert.deepEqual(row.distribution.map(d => [d.value, d.count]),
        [[1, 1], [2, 0], [3, 1], [4, 0], [5, 2]],
        'a scale shows every point on it, including the ones nobody picked');
});

test('a number is read back as a distribution and an average too', () => {
    const form = { questions: [FormsCore.buildQuestion({ id: 'q1', type: 'number', text: 'How many?' })] };
    const row = FormsCore.tally(form, [{ answers: { q1: '2' } }, { answers: { q1: '4' } }])[0];
    assert.equal(row.average, 3);
    assert.deepEqual(row.distribution.map(d => d.value), [2, 4],
        'a free number shows the values given, not every number between them');
});

test('dates and times come back in order', () => {
    const form = {
        questions: [
            FormsCore.buildQuestion({ id: 'd', type: 'date', text: 'Which day?' }),
            FormsCore.buildQuestion({ id: 't', type: 'time', text: 'What time?' }),
        ],
    };
    const rows = FormsCore.tally(form, [
        { answers: { d: '2026-11-12', t: '18:30' } },
        { answers: { d: '2026-11-03', t: '09:00' } },
    ]);
    assert.deepEqual(rows[0].answers, ['2026-11-03', '2026-11-12']);
    assert.deepEqual(rows[1].answers, ['09:00', '18:30']);
});

test('select all that apply counts every box a person ticked', () => {
    const form = {
        questions: [FormsCore.buildQuestion({
            id: 'q1', type: 'choice_many', text: 'Which nights?', options: ['Mon', 'Tue', 'Wed'],
        })],
    };
    const row = FormsCore.tally(form, [
        { answers: { q1: ['Mon', 'Tue'] } },
        { answers: { q1: ['Mon'] } },
    ])[0];
    assert.deepEqual(row.options.map(o => [o.label, o.count]), [['Mon', 2], ['Tue', 1], ['Wed', 0]]);
});

// ── The section heading (MS-379) ─────────────────────────────────────────────
//
// When a form is acting as a structured document rather than a survey, some of
// what is on it is not asking anything — it is a heading, marking where one part
// ends and the next begins. So a section is not a grouping structure and does
// not reshape a Form Template. It is one more entry in the same ordered list,
// and the only one that asks nothing.

test('a section heading is a question type, and the only one that asks nothing', () => {
    assert.ok(FormsCore.isLiveType('section'));
    assert.strictEqual(FormsCore.asksSomething('section'), false);
    ['short_text', 'paragraph', 'choice_one', 'choice_many', 'dropdown',
        'number', 'scale', 'date', 'time'].forEach(id => {
        assert.strictEqual(FormsCore.asksSomething(id), true, id + ' asks something');
    });
});

test('a heading can never be marked required', () => {
    // Forced in the model rather than hidden on the page. "Needed" on something
    // that takes no answer is a form nobody can submit.
    const q = FormsCore.buildQuestion({ id: 'h', type: 'section', text: 'About you', required: true });
    assert.strictEqual(q.required, false);
});

test('a heading carries its text and a line under it, and nothing to type into', () => {
    const q = FormsCore.buildQuestion({
        id: 'h', type: 'section', text: 'About you',
        hint: 'A few details so we can get in touch.', placeholder: 'ignored',
    });
    assert.strictEqual(q.text, 'About you');
    assert.strictEqual(q.hint, 'A few details so we can get in touch.');
    assert.ok(!q.placeholder, 'there is no box, so there is nothing to put inside one');
});

test('a heading produces no key in a Response', () => {
    const form = FormsCore.buildFormTemplate({
        questions: [
            { id: 'h', type: 'section', text: 'About you' },
            { id: 'q1', type: 'short_text', text: 'Your name' },
        ],
    });
    const kept = FormsCore.answersOnly(form, { h: 'somebody typed this', q1: 'Rebecca' });
    assert.deepEqual(kept, { q1: 'Rebecca' });
});

test('a heading never appears in the tally', () => {
    // Otherwise every form with a heading reports a question nobody answered.
    const form = FormsCore.buildFormTemplate({
        questions: [
            { id: 'h', type: 'section', text: 'About you' },
            { id: 'q1', type: 'short_text', text: 'Your name' },
        ],
    });
    const rows = FormsCore.tally(form, [{ answers: { q1: 'Rebecca' } }]);
    assert.deepEqual(rows.map(r => r.id), ['q1']);
});

test('a heading is not a question that was left blank', () => {
    const form = FormsCore.buildFormTemplate({
        questions: [{ id: 'h', type: 'section', text: 'About you' }],
    });
    assert.deepEqual(FormsCore.missingRequired(form, {}), []);
    assert.deepEqual(FormsCore.answerProblems(form, { h: 'junk' }), []);
});

test('a heading is still shown to whoever is filling the form in', () => {
    // It is not a question, but it IS on the page — askedQuestions is what the
    // fill-in page renders, and a heading that dropped out of it would leave
    // the form reading as one wall again.
    const form = FormsCore.buildFormTemplate({
        questions: [
            { id: 'h', type: 'section', text: 'About you' },
            { id: 'q1', type: 'short_text', text: 'Your name' },
        ],
    });
    assert.deepEqual(FormsCore.askedQuestions(form).map(q => q.id), ['h', 'q1']);
});

// ── Form Mode (MS-382) ───────────────────────────────────────────────────────
//
// A template is one of two things, and it is decided when it is made.
//
// `responses` is what has existed until now: publish a link, many people answer,
// each answer is a data point counted on a tab. `document` is filled in ONCE and
// the filled-in thing is the record — an Elder Interview, not a poll.
//
// Most of what follows is about what a `document` template STOPS offering. A
// control that decides nothing is worse than no control, and the Answering rung
// is the sharpest case: a Form Document lives among the elder documents and is
// elder-only, so a rung on the template would govern nothing at all.

test('a template made before Form Mode existed is a responses form', () => {
    // The default has to be `responses` or every template already stored
    // silently changes meaning.
    const form = FormsCore.buildFormTemplate({ title: 'Monday food' });
    assert.strictEqual(form.mode, 'responses');
});

test('a mode nobody recognises falls back rather than being stored', () => {
    const form = FormsCore.buildFormTemplate({ title: 'x', mode: 'whatever' });
    assert.strictEqual(form.mode, 'responses');
});

test('a document template is never published and carries no link', () => {
    // Forced in the model, not merely hidden on the page. A stored record
    // claiming both would be believed by everything downstream.
    const form = FormsCore.buildFormTemplate({
        title: 'Elder Interview', mode: 'document', published: true,
    });
    assert.strictEqual(form.mode, 'document');
    assert.strictEqual(form.published, false);
});

test('a document template has no answering rung to speak of', () => {
    // It lives among the elder documents, which are elder-only, so the rung
    // would decide nothing. Stored as null rather than as a plausible-looking
    // value nothing honours.
    const form = FormsCore.buildFormTemplate({ mode: 'document', rung: 'public' });
    assert.strictEqual(form.rung, null);
    assert.strictEqual(FormsCore.hasRung(form), false);

    const poll = FormsCore.buildFormTemplate({ mode: 'responses', rung: 'member' });
    assert.strictEqual(poll.rung, 'member');
    assert.strictEqual(FormsCore.hasRung(poll), true);
});

test('a document template is not closeable and has no closing date', () => {
    // Closing is what stops a link taking answers. There is no link.
    const form = FormsCore.buildFormTemplate({
        mode: 'document', closed: true, closingDate: '2026-12-01',
    });
    assert.strictEqual(form.closed, false);
    assert.strictEqual(form.closingDate, null);
});

test('a document template gathers no Responses, so it is never a ballot', () => {
    const form = FormsCore.buildFormTemplate({
        mode: 'document', attribution: false, oneEach: true,
    });
    assert.strictEqual(FormsCore.isBallot(form), false,
        'a secret ballot needs many answers; this is filled in once');
});

test('a responses template is unchanged in every respect', () => {
    const form = FormsCore.buildFormTemplate({
        title: 'Monday food', mode: 'responses', rung: 'member',
        attribution: true, oneEach: true, published: true, closingDate: '2026-12-01',
    });
    assert.strictEqual(form.rung, 'member');
    assert.strictEqual(form.published, true);
    assert.strictEqual(form.attribution, true);
    assert.strictEqual(form.oneEach, true);
    assert.strictEqual(form.closingDate, '2026-12-01');
});

// ── Changing your mind, and when you may not ─────────────────────────────────

test('the mode can be changed while nothing has been made from the template', () => {
    const verdict = FormsCore.mayChangeMode({ mode: 'responses' }, { responses: 0, documents: 0 });
    assert.strictEqual(verdict.ok, true);
});

test('the mode cannot be changed once records exist, and it says why', () => {
    // A template that switched would leave records nothing knows how to open.
    const withAnswers = FormsCore.mayChangeMode({ mode: 'responses' }, { responses: 4, documents: 0 });
    assert.strictEqual(withAnswers.ok, false);
    assert.match(withAnswers.why, /4/, 'the refusal should name the count');

    const withDocs = FormsCore.mayChangeMode({ mode: 'document' }, { responses: 0, documents: 1 });
    assert.strictEqual(withDocs.ok, false);
    assert.ok(withDocs.why);
});

test('being asked to change to the mode it already has is not a change', () => {
    const verdict = FormsCore.mayChangeMode({ mode: 'document' }, { responses: 0, documents: 3 }, 'document');
    assert.strictEqual(verdict.ok, true, 'saving a template should not be refused for not changing anything');
});

// ── The three that reach outside the form (MS-388) ───────────────────────────
//
// A person picker answers with somebody from the directory; an image and a file
// question take an upload. The rules that come with them live here rather than
// on a page, because a stored record claiming otherwise is believed downstream.

test('the last three types go live, and now every named type is', () => {
    ['person', 'image', 'file'].forEach(id => {
        assert.ok(FormsCore.isLiveType(id), id + ' should be live now');
    });
    // Only payment is left, and it is MS-364.
    const waiting = FormsCore.QUESTION_TYPES.filter(t => !t.live).map(t => t.id);
    assert.deepStrictEqual(waiting, ['payment']);
});

// ── A person question and its scope ──────────────────────────────────────────

test('a person question narrows the directory, and defaults to all of it', () => {
    const anyone = FormsCore.buildQuestion({ id: 'q1', type: 'person', text: 'Who referred you?' });
    assert.strictEqual(anyone.people.scope, 'everyone');

    const members = FormsCore.buildQuestion({
        id: 'q1', type: 'person', text: 'Who?', people: { scope: 'member' },
    });
    assert.strictEqual(members.people.scope, 'member');
});

test('a tag scope keeps the tag it was pointed at', () => {
    const q = FormsCore.buildQuestion({
        id: 'q1', type: 'person', text: 'Who?', people: { scope: 'tag', tagId: 'tag_7' },
    });
    assert.strictEqual(q.people.scope, 'tag');
    assert.strictEqual(q.people.tagId, 'tag_7');
});

test('a tag scope with no tag falls back rather than matching nobody', () => {
    const q = FormsCore.buildQuestion({ id: 'q1', type: 'person', text: 'Who?', people: { scope: 'tag' } });
    assert.strictEqual(q.people.scope, 'everyone',
        'a tag scope pointing at no tag would offer an empty picker with no explanation');
});

test('a scope nobody recognises falls back to everyone', () => {
    const q = FormsCore.buildQuestion({ id: 'q1', type: 'person', text: 'Who?', people: { scope: 'elders' } });
    assert.strictEqual(q.people.scope, 'everyone');
});

test('only a person question carries a scope', () => {
    const text = FormsCore.buildQuestion({ id: 'q1', type: 'short_text', people: { scope: 'member' } });
    assert.ok(!('people' in text));
});

// ── Which tags may be a scope ────────────────────────────────────────────────

test('a tag that hides itself is never offered as a scope', () => {
    const tags = [
        { id: 'a', name: 'Worship team' },
        { id: 'b', name: 'Under care', hiddenFromOthers: true },
    ];
    assert.deepEqual(FormsCore.offerableTags(tags).map(t => t.id), ['a']);
});

test('a tag that hides its carriers is not offered either', () => {
    // Stricter than the ticket asked, and deliberately. Scoping a picker to a
    // tag whose carriers are hidden would list exactly the people that flag
    // exists to conceal, to whoever is filling the form in. Hiding the name and
    // leaking the membership is the wrong half.
    const tags = [
        { id: 'a', name: 'Worship team' },
        { id: 'b', name: 'Safeguarding', hidePeople: true },
    ];
    assert.deepEqual(FormsCore.offerableTags(tags).map(t => t.id), ['a']);
});

test('a hidden tag is not even named', () => {
    const tags = [{ id: 'b', name: 'Under care', hiddenFromOthers: true }];
    assert.strictEqual(JSON.stringify(FormsCore.offerableTags(tags)).includes('Under care'), false);
});

// ── A picker cannot go on a public form ──────────────────────────────────────

test('a public form may not carry a person question, and the refusal names it', () => {
    // Reading the directory needs an account (ADR-0031). A picker on a public
    // form could only ever be an empty list or a leak.
    const form = {
        rung: 'public',
        questions: [
            { id: 'q1', type: 'short_text', text: 'Your name' },
            { id: 'q2', type: 'person', text: 'Who referred you?' },
        ],
    };
    const verdict = FormsCore.mayBePublic(form);
    assert.strictEqual(verdict.ok, false);
    assert.match(verdict.why, /Who referred you\?/,
        'the refusal should name the question standing in the way');
});

test('a form with no picker may be public', () => {
    const form = { rung: 'public', questions: [{ id: 'q1', type: 'short_text', text: 'Your name' }] };
    assert.strictEqual(FormsCore.mayBePublic(form).ok, true);
});

test('a retired picker does not block a form going public', () => {
    // It is not asked any more, so it cannot fail to be answerable.
    const form = {
        rung: 'public',
        questions: [{ id: 'q2', type: 'person', text: 'Who?', retired: true }],
    };
    assert.strictEqual(FormsCore.mayBePublic(form).ok, true);
});

test('the model refuses to store a public form carrying a picker', () => {
    // Not just the page. A record that said `public` with a picker on it would
    // be a form the fill-in page could not draw and the server would serve.
    const form = FormsCore.buildFormTemplate({
        rung: 'public',
        questions: [{ id: 'q2', type: 'person', text: 'Who referred you?' }],
    });
    assert.notStrictEqual(form.rung, 'public',
        'a public form was stored with a directory picker on it');
});

// ── Uploads ──────────────────────────────────────────────────────────────────

test('an upload has a cap, and it is smaller than an attachment for a reason', () => {
    assert.ok(FormsCore.MAX_UPLOAD_BYTES > 0);
    assert.ok(FormsCore.MAX_UPLOAD_BYTES <= 5 * 1024 * 1024,
        'a callable request is capped near 10MB and base64 inflates by a third');
});

test('a file over the cap is refused, and the refusal says how big it may be', () => {
    const ok = FormsCore.uploadFault({ name: 'a.pdf', size: 1024 });
    assert.strictEqual(ok, '');

    const tooBig = FormsCore.uploadFault({ name: 'a.pdf', size: FormsCore.MAX_UPLOAD_BYTES + 1 });
    assert.ok(tooBig);
    assert.match(tooBig, /5 ?MB/i, 'the refusal does not say what the limit is');
});

test('a file with no name and no size is refused rather than stored as nothing', () => {
    assert.ok(FormsCore.uploadFault(null));
    assert.ok(FormsCore.uploadFault({ name: '', size: 0 }));
});

test('an upload answer is a stored file, and never a URL', () => {
    const answer = FormsCore.buildUploadAnswer({
        name: 'waiver.pdf',
        contentType: 'application/pdf',
        size: 2048,
        storagePath: 'form_uploads/f1/r1/waiver.pdf',
        url: 'https://firebasestorage.example/token',   // must not survive
        downloadURL: 'https://firebasestorage.example/token',
    });
    assert.strictEqual(answer.storagePath, 'form_uploads/f1/r1/waiver.pdf');
    assert.strictEqual(answer.name, 'waiver.pdf');
    assert.ok(!('url' in answer), 'a URL was stored on an upload answer');
    assert.ok(!('downloadURL' in answer), 'a download URL was stored on an upload answer');
    assert.strictEqual(JSON.stringify(answer).includes('http'), false,
        'something URL-shaped survived onto an upload answer');
});

// ── Reading them back ────────────────────────────────────────────────────────

test('the tally does not treat a person or an upload as an option to count', () => {
    const form = FormsCore.buildFormTemplate({
        questions: [
            { id: 'who', type: 'person', text: 'Who referred you?' },
            { id: 'pic', type: 'image', text: 'A photo' },
        ],
        rung: 'member',
    });
    const rows = FormsCore.tally(form, [{
        answers: {
            who: { personId: 'p1', name: 'Rebecca' },
            pic: { name: 'a.jpg', storagePath: 'form_uploads/f/r/a.jpg' },
        },
    }]);
    rows.forEach(row => {
        assert.ok(!row.options, row.type + ' was counted as if it had options');
        assert.ok(!row.distribution, row.type + ' was counted as if it were a number');
    });
});
