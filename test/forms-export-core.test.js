const { test } = require('node:test');
const assert = require('node:assert');

// MS-374 — getting the responses out.
//
// ⚠ THE QUESTION THIS TICKET HAD TO SETTLE: may an anonymous form be exported
// at all? Settled yes, and the export carries exactly what the SCREEN carries.
//
// An export is not a new disclosure: the Responses tab already shows every
// anonymous answer to any editor. Sorting a file against "a list of who voted"
// would need the ledger, and no client can read the ledger at all — not an
// editor, not an elder (ADR-0052). Rows leave in the same stable shuffle the
// screen uses, so there is no arrival order in the file, and no timestamp to
// reconstruct one from.
//
// Refusing would have protected nothing that is not already on screen, while
// making somebody retype the answers by hand — and a hand-typed copy has none
// of these protections.
//
// So the tests that matter most here are about what is ABSENT.

const Export = require('../public/forms-export-core.js');
const FormsCore = require('../public/forms-core.js');

const attributed = () => FormsCore.buildFormTemplate({
    title: 'Church camp sign-up',
    rung: 'member',
    attribution: true,
    questions: [
        { id: 'intro', type: 'section', text: 'About you' },
        { id: 'name', type: 'short_text', text: 'Your name' },
        { id: 'nights', type: 'choice_many', text: 'Which nights?', options: ['Fri', 'Sat'] },
        { id: 'who', type: 'person', text: 'Who invited you?' },
        { id: 'waiver', type: 'file', text: 'Signed waiver' },
    ],
});

const anonymous = () => FormsCore.buildFormTemplate({
    title: 'Monday gathering',
    rung: 'member',
    attribution: false,
    oneEach: true,
    questions: [{ id: 'when', type: 'choice_one', text: 'Which night?', options: ['Mon', 'Tue'] }],
});

const rows = (csv) => csv.replace(/^﻿/, '').trim().split('\n');
const header = (csv) => rows(csv)[0];

// ── What an anonymous export must not contain ────────────────────────────────

test('an anonymous export carries no name and no person', () => {
    const csv = Export.toCsv(anonymous(), [
        { id: 'r1', answers: { when: 'Mon' }, personId: 'p1', personName: 'Rebecca' },
    ], { exportedOn: '2026-09-03' });

    assert.ok(!csv.includes('Rebecca'), 'a name reached an anonymous export');
    assert.ok(!csv.includes('p1'), 'a person id reached an anonymous export');
    assert.ok(!header(csv).includes('Name'), 'an anonymous export has a Name column');
    assert.ok(!header(csv).includes('Person ID'));
});

test('an anonymous export carries no timestamp of any kind', () => {
    // Arrival order plus a date is the correlation channel, whether or not it
    // is a stored field (ADR-0052).
    const csv = Export.toCsv(anonymous(), [
        { id: 'r1', answers: { when: 'Mon' }, submittedAt: '2026-09-01T10:30:00Z' },
    ], { exportedOn: '2026-09-03' });

    assert.ok(!csv.includes('10:30'), 'a submission time reached an anonymous export');
    assert.ok(!csv.includes('2026-09-01'), 'a submission date reached an anonymous export');
    assert.ok(!header(csv).includes('Submitted'), 'an anonymous export has a Submitted column');
});

test('an anonymous export never hands out a response id', () => {
    // A document id is a stable per-row identifier, and there is no reason to
    // give one out. The row's handle is positional, like the screen's.
    const csv = Export.toCsv(anonymous(), [
        { id: 'resp_abc123', answers: { when: 'Mon' } },
    ], { exportedOn: '2026-09-03' });
    assert.ok(!csv.includes('resp_abc123'), 'a response id reached an anonymous export');
});

test('anonymous rows come out in the shuffle, not in the order given', () => {
    const form = anonymous();
    const responses = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
        id: id, answers: { when: i % 2 ? 'Mon' : 'Tue' },
    }));
    const csv = Export.toCsv(form, responses, { exportedOn: '2026-09-03', formId: 'f1' });
    const shuffled = FormsCore.anonymousReadOrder(responses, 'f1');

    const answered = rows(csv).slice(1).map(line => line.split(',').pop().replace(/"/g, ''));
    assert.deepEqual(answered, shuffled.map(s => s.response.answers.when),
        'the export gave away arrival order');
});

test('no value drawn from the ledger appears anywhere', () => {
    // The ledger says WHO answered and is unreadable by every client. Nothing
    // that reads it could reach here, and this asserts the shape of that.
    const csv = Export.toCsv(anonymous(), [
        { id: 'r1', answers: { when: 'Mon' }, ledgerId: 'f1_p1', answeredOn: '2026-09-01' },
    ], { exportedOn: '2026-09-03' });
    assert.ok(!csv.includes('f1_p1'), 'a ledger id reached the export');
    assert.ok(!csv.includes('2026-09-01'), 'a ledger date reached the export');
});

// ── What an attributed export does carry ─────────────────────────────────────

test('an attributed export names who answered and when', () => {
    const csv = Export.toCsv(attributed(), [{
        id: 'r1',
        personId: 'p1',
        personName: 'Rebecca Hall',
        submittedAt: '2026-09-01',
        answers: { name: 'Rebecca' },
    }], { exportedOn: '2026-09-03' });

    assert.ok(header(csv).includes('Person ID'));
    assert.ok(header(csv).includes('Name'));
    assert.ok(header(csv).includes('Submitted on'));
    assert.ok(csv.includes('Rebecca Hall'));
});

test('every export says which form it is and when it was taken', () => {
    // A file in a Downloads folder six months later has to describe itself.
    const csv = Export.toCsv(attributed(), [{ id: 'r1', answers: {} }], {
        exportedOn: '2026-09-03', formId: 'form_xyz',
    });
    assert.ok(header(csv).includes('Form'));
    assert.ok(header(csv).includes('Form ID'));
    assert.ok(header(csv).includes('Exported on'));
    assert.ok(csv.includes('Church camp sign-up'));
    assert.ok(csv.includes('form_xyz'));
    assert.ok(csv.includes('2026-09-03'));
});

// ── The columns ──────────────────────────────────────────────────────────────

test('a section heading gets no column, because it asks nothing', () => {
    const csv = Export.toCsv(attributed(), [], { exportedOn: '2026-09-03' });
    assert.ok(!header(csv).includes('About you'), 'a heading was exported as a question');
});

test('a retired question keeps its column, because it still has answers', () => {
    const form = FormsCore.buildFormTemplate({
        title: 'T', rung: 'member', attribution: true,
        questions: [{ id: 'old', type: 'short_text', text: 'An old question', retired: true }],
    });
    const csv = Export.toCsv(form, [{ id: 'r1', answers: { old: 'kept' } }], { exportedOn: 'x' });
    assert.ok(header(csv).includes('An old question'), 'a retired question lost its answers');
    assert.ok(csv.includes('kept'));
});

test('a person question exports an id and a name, in two columns', () => {
    const csv = Export.toCsv(attributed(), [{
        id: 'r1', answers: { who: { personId: 'p9', name: 'Sam Okoro' } },
    }], { exportedOn: 'x' });
    assert.ok(header(csv).includes('Who invited you? (Person ID)'));
    assert.ok(header(csv).includes('Who invited you? (Name)'));
    assert.ok(csv.includes('p9'));
    assert.ok(csv.includes('Sam Okoro'));
});

test('an upload exports its name, size and where it lives — never a link', () => {
    const csv = Export.toCsv(attributed(), [{
        id: 'r1',
        answers: { waiver: { name: 'w.pdf', size: 2048, storagePath: 'form_uploads/f/r/waiver.pdf' } },
    }], { exportedOn: 'x' });
    assert.ok(header(csv).includes('Signed waiver (File)'));
    assert.ok(header(csv).includes('Signed waiver (Size)'));
    assert.ok(header(csv).includes('Signed waiver (Stored at)'));
    assert.ok(csv.includes('form_uploads/f/r/waiver.pdf'));
    assert.ok(!csv.includes('http'), 'a URL reached the export');
});

test('select all that apply comes out as one column, joined', () => {
    const csv = Export.toCsv(attributed(), [{
        id: 'r1', answers: { nights: ['Fri', 'Sat'] },
    }], { exportedOn: 'x' });
    assert.ok(csv.includes('Fri; Sat'));
});

test('two questions worded the same are still two columns you can tell apart', () => {
    const form = FormsCore.buildFormTemplate({
        title: 'T', rung: 'member', attribution: true,
        questions: [
            { id: 'a', type: 'short_text', text: 'Name' },
            { id: 'b', type: 'short_text', text: 'Name' },
        ],
    });
    const cols = Export.columnsFor(form);
    const names = cols.map(c => c.header);
    assert.strictEqual(new Set(names).size, names.length, 'two columns share a header');
});

// ── Escaping ─────────────────────────────────────────────────────────────────

test('a comma inside an answer does not shift every column after it', () => {
    const csv = Export.toCsv(attributed(), [{
        id: 'r1', answers: { name: 'Hall, Rebecca' },
    }], { exportedOn: 'x' });
    assert.ok(csv.includes('"Hall, Rebecca"'));
});

test('a quote inside an answer is doubled, as CSV requires', () => {
    const csv = Export.toCsv(attributed(), [{
        id: 'r1', answers: { name: 'She said "yes"' },
    }], { exportedOn: 'x' });
    assert.ok(csv.includes('"She said ""yes"""'));
});

test('a newline inside a paragraph answer stays inside its cell', () => {
    const csv = Export.toCsv(attributed(), [{
        id: 'r1', answers: { name: 'one\ntwo' },
    }], { exportedOn: 'x' });
    assert.ok(csv.includes('"one\ntwo"'));
});

test('the file opens as text in a spreadsheet rather than as mojibake', () => {
    // A byte-order mark is what makes Excel read it as UTF-8. Without it,
    // every name with an accent in it arrives broken.
    const csv = Export.toCsv(attributed(), [], { exportedOn: 'x' });
    assert.ok(csv.startsWith('﻿'), 'the export has no byte-order mark');
});

// ── Odds and ends ────────────────────────────────────────────────────────────

test('a form nobody has answered still exports its headers', () => {
    const csv = Export.toCsv(attributed(), [], { exportedOn: 'x' });
    assert.strictEqual(rows(csv).length, 1, 'an empty export should still describe its columns');
});

test('a missing answer is an empty cell, not the word undefined', () => {
    const csv = Export.toCsv(attributed(), [{ id: 'r1', answers: {} }], { exportedOn: 'x' });
    assert.ok(!csv.includes('undefined'));
    assert.ok(!csv.includes('null'));
});

test('the file is named for the form and the day it was taken', () => {
    const name = Export.fileNameFor(attributed(), '2026-09-03');
    assert.ok(name.endsWith('.csv'));
    assert.ok(name.includes('2026-09-03'));
    assert.ok(/church-camp-sign-up/i.test(name), 'the file does not say which form it is');
    assert.ok(!/[\\/:*?"<>|]/.test(name), 'the name carries characters a filesystem refuses');
});
