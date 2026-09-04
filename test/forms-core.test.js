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

test('all thirteen types are named, and only three are live', () => {
    assert.strictEqual(FormsCore.QUESTION_TYPES.length, 13);
    const live = FormsCore.QUESTION_TYPES.filter(t => t.live).map(t => t.id);
    assert.deepStrictEqual(live, ['short_text', 'paragraph', 'choice_one']);
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
