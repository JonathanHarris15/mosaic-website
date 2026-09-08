const { test } = require('node:test');
const assert = require('node:assert');

const F = require('../functions/mcp-firestore.js');
const Writes = require('../functions/task-writes.js');
const TasksCore = require('../functions/shared/tasks-core.js');

// The Task writes (MS-79, sub-task MS-418) — the rules the page and the
// assistant both come through, against a stub Firestore.
//
// The emulator suite in test/emulator/task-writes.test.js proves the same
// module against a real database. This file pins the DECISIONS, which are the
// part that would otherwise only exist in the browser:
//
//   • a Task with no date is refused, because without one nothing is overdue
//   • an Assignee must be an Elder, because anyone else could never see it
//   • ticking a repeat writes ONE date, never the commitment behind it
//   • a skip is not a tick, and a one-off cannot be skipped
//   • stopping a repeat that has finished work behind it KEEPS that work

// ── A Firestore small enough to read ──────────────────────────────────────────

const SENTINEL = { serverTimestamp: () => '::now::' };
F.bind({ FieldValue: SENTINEL, Timestamp: { fromDate: (d) => d } });

function makeDb(seed) {
    const store = {};
    Object.keys(seed || {}).forEach((c) => { store[c] = Object.assign({}, seed[c]); });
    let auto = 0;

    const collection = (name) => {
        if (!store[name]) store[name] = {};
        const rows = () => Object.keys(store[name]).map(
            (id) => ({ id, ref: doc(id), data: () => store[name][id] }));

        const doc = (id) => ({
            id,
            get: async () => ({
                exists: Object.prototype.hasOwnProperty.call(store[name], id),
                id,
                data: () => store[name][id],
            }),
            set: async (data, opts) => {
                store[name][id] = (opts && opts.merge)
                    ? Object.assign({}, store[name][id] || {}, data)
                    : data;
            },
            update: async (data) => {
                store[name][id] = Object.assign({}, store[name][id] || {}, data);
            },
            delete: async () => { delete store[name][id]; },
        });

        return {
            doc,
            add: async (data) => { const id = 'gen' + (++auto); store[name][id] = data; return doc(id); },
            get: async () => ({ docs: rows() }),
            where: (field, _op, value) => ({
                get: async () => ({ docs: rows().filter((r) => r.data()[field] === value) }),
            }),
        };
    };

    return { collection, _store: store };
}

const ROB = { name: 'Rob', tags: ['Elder', 'Member'] };
const DAVE = { name: 'Dave', tags: ['Member'] };
const ACTOR = { uid: 'u-rob', name: 'Rob' };

const db = (over) => makeDb(Object.assign({
    people: { rob: ROB, dave: DAVE },
    shepherding_tasks: {},
    shepherding_task_occurrences: {},
}, over || {}));

const MONTHLY = {
    freq: TasksCore.FREQ.MONTHLY,
    startDate: '2026-06-02',
    ends: { kind: TasksCore.ENDS.NEVER },
};

const refusal = async (fn, matching) => {
    await assert.rejects(fn, (err) => {
        assert.match(err.message, matching);
        return true;
    });
};


// ── A Task needs something to say, and a day to say it by ─────────────────────

test('a Task is written with a title, a date, and nobody in particular', async () => {
    const d = db();
    const out = await Writes.createTask(d, { title: 'Ring Dave', due: '2026-09-10', actor: ACTOR });
    assert.strictEqual(out.ok, true);
    const row = d._store.shepherding_tasks[out.taskId];
    assert.strictEqual(row.title, 'Ring Dave');
    assert.strictEqual(row.dueDate, '2026-09-10');
    assert.deepStrictEqual(row.assigneeIds, []);
});

test('a Task with no date is refused, and the refusal says why', async () => {
    await refusal(() => Writes.createTask(db(), { title: 'Ring Dave', actor: ACTOR }),
        /overdue/);
});

test('a Task with nothing to say is refused', async () => {
    await refusal(() => Writes.createTask(db(), { title: '   ', due: '2026-09-10', actor: ACTOR }),
        /needs something to say/);
});

test('a time of day is optional, and kept when it is given', async () => {
    const d = db();
    const bare = await Writes.createTask(d, { title: 'A', due: '2026-09-10', actor: ACTOR });
    const timed = await Writes.createTask(d, { title: 'B', due: '2026-09-10', dueTime: '18:00', actor: ACTOR });
    assert.strictEqual(d._store.shepherding_tasks[bare.taskId].dueTime, null);
    assert.strictEqual(d._store.shepherding_tasks[timed.taskId].dueTime, '18:00');
});

test('something that is not a time of day is refused', async () => {
    await refusal(() => Writes.createTask(db(), { title: 'A', due: '2026-09-10', dueTime: 'sixish', actor: ACTOR }),
        /not a time of day/);
});


// ── An Assignee is an Elder (ADR-0059) ────────────────────────────────────────

test('a Task can be given to an elder', async () => {
    const d = db();
    const out = await Writes.createTask(d, { title: 'A', due: '2026-09-10', assigneeIds: ['rob'], actor: ACTOR });
    assert.deepStrictEqual(d._store.shepherding_tasks[out.taskId].assigneeIds, ['rob']);
});

test('a Task given to somebody who is not an elder is refused', async () => {
    await refusal(
        () => Writes.createTask(db(), { title: 'A', due: '2026-09-10', assigneeIds: ['dave'], actor: ACTOR }),
        /not an elder/);
});

test('the refusal names the person, so it can be acted on', async () => {
    await refusal(
        () => Writes.createTask(db(), { title: 'A', due: '2026-09-10', assigneeIds: ['dave'], actor: ACTOR }),
        /Dave/);
});

test('the same elder twice is one assignee', async () => {
    const d = db();
    const out = await Writes.createTask(d, { title: 'A', due: '2026-09-10', assigneeIds: ['rob', 'rob'], actor: ACTOR });
    assert.deepStrictEqual(d._store.shepherding_tasks[out.taskId].assigneeIds, ['rob']);
});


// ── A repeat, and its vocabulary ──────────────────────────────────────────────

test('a repeat is stored with its rule, and its first date is its due date', async () => {
    const d = db();
    const out = await Writes.createTask(d, { title: 'Widows', recurrence: MONTHLY, actor: ACTOR });
    const row = d._store.shepherding_tasks[out.taskId];
    assert.strictEqual(row.recurrence.freq, TasksCore.FREQ.MONTHLY);
    assert.strictEqual(row.dueDate, '2026-06-02', 'the rule owns the calendar; a second date could disagree');
    assert.strictEqual(out.repeats, true);
});

test('a repeat this app does not know is refused by name', async () => {
    await refusal(
        () => Writes.createTask(db(), { title: 'A', recurrence: { freq: 'daily', startDate: '2026-06-02' }, actor: ACTOR }),
        /weekly, fortnightly or monthly/);
});

test('a repeat ending after a count needs to say how many', async () => {
    await refusal(
        () => Writes.createTask(db(), {
            title: 'A',
            recurrence: { freq: TasksCore.FREQ.WEEKLY, startDate: '2026-06-02', ends: { kind: TasksCore.ENDS.AFTER_COUNT } },
            actor: ACTOR,
        }),
        /how many times/);
});

test('writing a repeat reads its next dates back', async () => {
    const out = await Writes.createTask(db(), {
        title: 'Widows',
        recurrence: { freq: TasksCore.FREQ.WEEKLY, startDate: '2026-06-02', ends: { kind: TasksCore.ENDS.NEVER } },
        actor: ACTOR,
    });
    assert.ok(out.nextDates.length > 0, 'a misread rule has to be visible at the time');
    out.nextDates.forEach(d => assert.match(d, /^\d{4}-\d{2}-\d{2}$/));
});

test('a one-off reads no dates back, having only the one', async () => {
    const out = await Writes.createTask(db(), { title: 'A', due: '2026-09-10', actor: ACTOR });
    assert.deepStrictEqual(out.nextDates, []);
});


// ── Ticking writes one date, never the commitment ─────────────────────────────

test('ticking a one-off writes the Task itself', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'A', due: '2026-09-10', actor: ACTOR });
    const out = await Writes.completeTask(d, { taskId, actor: ACTOR });
    assert.strictEqual(out.repeats, false);
    assert.strictEqual(d._store.shepherding_tasks[taskId].completedAt, '::now::');
    assert.deepStrictEqual(d._store.shepherding_task_occurrences, {}, 'a one-off has no dates of its own');
});

test('ticking one month of a repeat writes that month alone', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'Widows', recurrence: MONTHLY, actor: ACTOR });
    await Writes.completeTask(d, { taskId, date: '2026-07-07', actor: ACTOR });

    const occ = d._store.shepherding_task_occurrences[TasksCore.occurrenceIdFor(taskId, '2026-07-07')];
    assert.strictEqual(occ.completedAt, '::now::');
    assert.strictEqual(occ.seriesId, taskId);
    assert.strictEqual(Object.keys(d._store.shepherding_task_occurrences).length, 1,
        'no other month is written down');
    assert.strictEqual(d._store.shepherding_tasks[taskId].completedAt, null,
        'the standing commitment is not finished because one month was');
});

test('a tick can be undone', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'A', due: '2026-09-10', actor: ACTOR });
    await Writes.completeTask(d, { taskId, actor: ACTOR });
    await Writes.reopenTask(d, { taskId });
    assert.strictEqual(d._store.shepherding_tasks[taskId].completedAt, null);
});


// ── A skip is not a tick ──────────────────────────────────────────────────────

test('skipping one month records a skip and no completion', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'Widows', recurrence: MONTHLY, actor: ACTOR });
    await Writes.skipOccurrence(d, { taskId, date: '2026-12-01', actor: ACTOR });

    const occ = d._store.shepherding_task_occurrences[TasksCore.occurrenceIdFor(taskId, '2026-12-01')];
    assert.strictEqual(occ.skippedAt, '::now::');
    assert.strictEqual(occ.completedAt, null, 'December was not done, it was stood down');
});

test('a one-off cannot be skipped — it is done or it is deleted', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'A', due: '2026-09-10', actor: ACTOR });
    await refusal(() => Writes.skipOccurrence(d, { taskId, actor: ACTOR }), /repeating task/);
});


// ── One occurrence may override, and only in named ways ───────────────────────

test('reassigning one month writes that month and leaves the commitment alone', async () => {
    const d = db({ people: { rob: ROB, carl: { name: 'Carl', tags: ['Elder'] }, dave: DAVE } });
    const { taskId } = await Writes.createTask(d, { title: 'Widows', recurrence: MONTHLY, assigneeIds: ['rob'], actor: ACTOR });
    await Writes.editTask(d, { taskId, date: '2026-07-07', assigneeIds: ['carl'] });

    const occ = d._store.shepherding_task_occurrences[TasksCore.occurrenceIdFor(taskId, '2026-07-07')];
    assert.deepStrictEqual(occ.assigneeIds, ['carl']);
    assert.deepStrictEqual(d._store.shepherding_tasks[taskId].assigneeIds, ['rob']);
});

test('a date cannot be given a repeat of its own', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'Widows', recurrence: MONTHLY, actor: ACTOR });
    await refusal(
        () => Writes.editTask(d, { taskId, date: '2026-07-07', recurrence: MONTHLY }),
        /never on one of its dates/);
});

test('nudging one month moves that month and nothing else', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'Widows', recurrence: MONTHLY, actor: ACTOR });
    await Writes.moveTask(d, { taskId, date: '2026-08-04', to: '2026-08-11' });

    const occ = d._store.shepherding_task_occurrences[TasksCore.occurrenceIdFor(taskId, '2026-08-04')];
    assert.strictEqual(occ.movedTo, '2026-08-11');
    assert.strictEqual(d._store.shepherding_tasks[taskId].recurrence.startDate, '2026-06-02',
        'the pattern is untouched');
});

test('moving a one-off changes its own date', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'A', due: '2026-09-10', actor: ACTOR });
    await Writes.moveTask(d, { taskId, to: '2026-09-17' });
    assert.strictEqual(d._store.shepherding_tasks[taskId].dueDate, '2026-09-17');
});

test('editing the commitment reaches every month that has not spoken up', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'Widows', recurrence: MONTHLY, actor: ACTOR });
    await Writes.editTask(d, { taskId, title: 'Check on the widows' });
    assert.strictEqual(d._store.shepherding_tasks[taskId].title, 'Check on the widows');
});


// ── Stopping is not erasing ───────────────────────────────────────────────────

test('a repeat with finished work behind it is stopped, not deleted', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'Widows', recurrence: MONTHLY, actor: ACTOR });
    await Writes.completeTask(d, { taskId, date: '2026-07-07', actor: ACTOR });

    const out = await Writes.deleteTask(d, { taskId });
    assert.strictEqual(out.stopped, true);
    assert.strictEqual(out.keptRecords, 1);
    assert.ok(d._store.shepherding_tasks[taskId], 'the commitment stays, so its history has something to hang on');
    assert.ok(d._store.shepherding_tasks[taskId].stoppedOn, 'and it produces no more dates');
    assert.strictEqual(
        Object.keys(d._store.shepherding_task_occurrences).length, 1,
        'the month that was done is still there');
});

test('a repeat nobody ever did is deleted outright', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'Widows', recurrence: MONTHLY, actor: ACTOR });
    await Writes.skipOccurrence(d, { taskId, date: '2026-07-07', actor: ACTOR });

    const out = await Writes.deleteTask(d, { taskId });
    assert.strictEqual(out.stopped, false, 'a skip is not work to protect');
    assert.strictEqual(d._store.shepherding_tasks[taskId], undefined);
    assert.deepStrictEqual(d._store.shepherding_task_occurrences, {});
});

test('a one-off is deleted outright', async () => {
    const d = db();
    const { taskId } = await Writes.createTask(d, { title: 'A', due: '2026-09-10', actor: ACTOR });
    const out = await Writes.deleteTask(d, { taskId });
    assert.strictEqual(out.stopped, false);
    assert.strictEqual(d._store.shepherding_tasks[taskId], undefined);
});

test('a task that is not there is refused by id', async () => {
    await refusal(() => Writes.deleteTask(db(), { taskId: 'nope' }), /No task with id "nope"/);
});


// ── Nobody owns a Task ────────────────────────────────────────────────────────

test('any elder may tick a Task somebody else was given', async () => {
    const d = db({ people: { rob: ROB, carl: { name: 'Carl', tags: ['Elder'] }, dave: DAVE } });
    const { taskId } = await Writes.createTask(d, { title: 'A', due: '2026-09-10', assigneeIds: ['carl'], actor: ACTOR });
    const out = await Writes.completeTask(d, { taskId, actor: { uid: 'u-rob', name: 'Rob' } });
    assert.strictEqual(out.ok, true, 'a Task locked to a man on holiday is worse than a stray tick');
});


// ── What the assistant reads back ─────────────────────────────────────────────

test('the outstanding list leaves out what is finished', async () => {
    const d = db();
    const a = await Writes.createTask(d, { title: 'Open', due: '2026-09-10', actor: ACTOR });
    const b = await Writes.createTask(d, { title: 'Finished', due: '2026-09-10', actor: ACTOR });
    // Complete with a real timestamp rather than the sentinel, since this one is read back.
    d._store.shepherding_tasks[b.taskId].completedAt = Date.now();

    const out = await Writes.listTasks(d);
    assert.deepStrictEqual(out.tasks.map(t => t.title), ['Open']);
    assert.strictEqual(out.count, 1);
    void a;
});

test('the outstanding list says what is late and what nobody has picked up', async () => {
    const d = db();
    await Writes.createTask(d, { title: 'Late', due: '2020-01-01', actor: ACTOR });
    const out = await Writes.listTasks(d);
    assert.strictEqual(out.overdue, 1);
    assert.strictEqual(out.tasks[0].unassigned, true);
});


// ── The door itself ───────────────────────────────────────────────────────────
//
// The rules cannot be exercised from here — that needs a live project — but
// their SHAPE can be pinned, so the boundary cannot be widened by an unrelated
// edit without somebody having to think about it. Same guard MS-133 put on the
// relationship collections. The failure this catches is not a crash; it is a
// rule quietly becoming `if true` and nobody noticing that the elders' loose
// ends went public.

const fs = require('node:fs');
const path = require('node:path');
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

const blockFor = (collection) => {
    const m = rules.match(
        new RegExp('match /' + collection + '/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n    \\}'));
    assert.ok(m, 'no rule block for /' + collection);
    return m[1];
};

[Writes.TASKS, Writes.OCCURRENCES].forEach((collection) => {
    test(`${collection} is elder-only, read and write`, () => {
        const block = blockFor(collection);
        assert.match(block, /allow read, write: if isElder\(\);/);
    });

    test(`${collection} lets nobody below an elder in`, () => {
        const block = blockFor(collection);
        assert.doesNotMatch(block, /if true/);
        assert.doesNotMatch(block, /isMember\(\)|isEditor\(\)|isSignedIn\(\)/);
    });
});
