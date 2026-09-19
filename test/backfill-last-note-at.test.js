const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    planForPerson,
    notesByPersonFromDocs,
    proofRow,
} = require('../scripts/backfill-last-note-at.js');

const ts = (ms) => ({ toMillis: () => ms });

test('planForPerson sets the newest note and is a no-op when already right', () => {
    const newer = ts(200);
    const older = ts(100);
    assert.deepEqual(
        planForPerson(null, [{ createdAt: older }, { createdAt: newer }]),
        { lastNoteAt: newer }
    );
    assert.equal(
        planForPerson(newer, [{ createdAt: older }, { createdAt: newer }]),
        null
    );
});

test('planForPerson clears when the Person has no notes', () => {
    assert.deepEqual(planForPerson(ts(200), []), { lastNoteAt: null });
    assert.equal(planForPerson(undefined, []), null);
    assert.equal(planForPerson(null, []), null);
});

test('notesByPersonFromDocs groups collection-group docs by parent Person', () => {
    const docs = [
        {
            ref: { parent: { parent: { id: 'p1' } } },
            data: () => ({ createdAt: ts(1) }),
        },
        {
            ref: { parent: { parent: { id: 'p2' } } },
            data: () => ({ createdAt: ts(2) }),
        },
        {
            ref: { parent: { parent: { id: 'p1' } } },
            data: () => ({ createdAt: ts(3) }),
        },
    ];
    const grouped = notesByPersonFromDocs(docs);
    assert.equal(grouped.p1.length, 2);
    assert.equal(grouped.p2.length, 1);
    assert.equal(planForPerson(null, grouped.p1).lastNoteAt.toMillis(), 3);
});

test('proofRow is the ticket shape: personId, name, stored, next, action', () => {
    const row = proofRow({
        personId: 'abc',
        name: 'Sarah Bell',
        stored: null,
        next: ts(9),
        action: 'set',
    });
    assert.deepEqual(Object.keys(row).sort(), [
        'action', 'name', 'next', 'personId', 'stored',
    ]);
    assert.equal(row.action, 'set');
    assert.equal(row.personId, 'abc');
});

test('the script defaults to dry-run and requires --commit to write', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'scripts/backfill-last-note-at.js'),
        'utf8'
    );
    assert.match(src, /process\.argv\.includes\('--commit'\)/);
    assert.match(src, /DRY RUN/);
    assert.match(src, /if \(COMMIT\)/);
    assert.doesNotMatch(src, /COMMIT = !process\.argv/);
});

test('ops note documents dry-run, --commit, and the proof shape', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'docs/ops/ms-530-last-note-at-backfill.md'),
        'utf8'
    );
    assert.match(src, /node scripts\/backfill-last-note-at\.js/);
    assert.match(src, /--commit/);
    assert.match(src, /personId/);
    assert.match(src, /cloud-agent box against production/);
});
