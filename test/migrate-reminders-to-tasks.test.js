const { test } = require('node:test');
const assert = require('node:assert');

const M = require('../scripts/migrate-reminders-to-tasks.js');

// Bringing the old Follow-up Reminders across as one-off Tasks (MS-79, MS-419).
//
// The reminders still sitting in that collection are, by definition, the ones
// nobody has reached yet — a reminder disappeared once its date passed. So this
// is live work, not an archive, and dropping it when the panel changes shape
// would be the migration losing exactly what the feature exists to protect.

const STAMP = Symbol('serverTimestamp()');
const ts = (iso) => ({ toDate: () => new Date(iso) });


// ── What comes across ─────────────────────────────────────────────────────────

test('a reminder becomes a one-off Task with its title and its day', () => {
    const task = M.taskFrom('r1', { title: 'Ring Dave', dueDatetime: ts('2026-09-10T14:30:00') }, STAMP);
    assert.strictEqual(task.title, 'Ring Dave');
    assert.strictEqual(task.dueDate, '2026-09-10');
    assert.strictEqual(task.recurrence, null, 'a reminder was never a repeat');
});

test('it arrives unassigned, because nobody was ever given one', () => {
    const task = M.taskFrom('r1', { title: 'A', dueDatetime: ts('2026-09-10T09:00:00') }, STAMP);
    assert.deepStrictEqual(task.assigneeIds, []);
});

test('it arrives unfinished', () => {
    const task = M.taskFrom('r1', { title: 'A', dueDatetime: ts('2026-09-10T09:00:00') }, STAMP);
    assert.strictEqual(task.completedAt, null);
});

test('a real time of day is kept', () => {
    const task = M.taskFrom('r1', { title: 'A', dueDatetime: ts('2026-09-10T18:05:00') }, STAMP);
    assert.strictEqual(task.dueTime, '18:05');
});

test('midnight is dropped, being what an untouched date box produces rather than a deadline', () => {
    const task = M.taskFrom('r1', { title: 'A', dueDatetime: ts('2026-09-10T00:00:00') }, STAMP);
    assert.strictEqual(task.dueTime, null);
});

test('who wrote it survives', () => {
    const task = M.taskFrom('r1', {
        title: 'A', dueDatetime: ts('2026-09-10T09:00:00'),
        createdBy: 'u-rob', createdByName: 'Rob',
    }, STAMP);
    assert.strictEqual(task.createdBy, 'u-rob');
    assert.strictEqual(task.createdByName, 'Rob');
});

test('a reminder with no title still becomes something readable', () => {
    const task = M.taskFrom('r1', { title: '   ', dueDatetime: ts('2026-09-10T09:00:00') }, STAMP);
    assert.strictEqual(task.title, '(untitled)');
});


// ── What does not come across (ADR-0059) ──────────────────────────────────────

test('the people it was about are dropped, not carried into a field nothing reads', () => {
    const task = M.taskFrom('r1', {
        title: 'Follow up with the Johnsons',
        dueDatetime: ts('2026-09-10T09:00:00'),
        mentions: [{ personId: 'p1', name: 'Dave Johnson' }],
    }, STAMP);
    assert.ok(!('mentions' in task));
    assert.ok(!('personIds' in task));
    assert.deepStrictEqual(task.assigneeIds, [], 'and they are certainly not made responsible for it');
});


// ── What cannot come across ───────────────────────────────────────────────────

test('a reminder with no readable date is left behind rather than given an invented one', () => {
    assert.strictEqual(M.taskFrom('r1', { title: 'A' }, STAMP), null);
    assert.strictEqual(M.taskFrom('r1', { title: 'A', dueDatetime: 'soon' }, STAMP), null);
});


// ── Running it twice ──────────────────────────────────────────────────────────

test('a reminder already brought across is recognised by its own stamp', () => {
    const already = [{ migratedFrom: 'r1' }, { migratedFrom: 'r2' }];
    assert.strictEqual(M.isMigrated('r1', already), true);
    assert.strictEqual(M.isMigrated('r3', already), false);
});

test('a Task written by hand is never mistaken for a migrated one', () => {
    assert.strictEqual(M.isMigrated('r1', [{ title: 'Written on the page' }]), false);
});

test('every migrated Task carries the id it came from, which is what makes a second run safe', () => {
    const task = M.taskFrom('r1', { title: 'A', dueDatetime: ts('2026-09-10T09:00:00') }, STAMP);
    assert.strictEqual(task.migratedFrom, 'r1');
    assert.strictEqual(M.isMigrated('r1', [task]), true);
});


// ── The old collection is left alone ──────────────────────────────────────────

test('the migration names the collection it reads and never claims to empty it', () => {
    assert.strictEqual(M.REMINDERS, 'shepherding_reminders');
    assert.strictEqual(M.TASKS, 'shepherding_tasks');
});
