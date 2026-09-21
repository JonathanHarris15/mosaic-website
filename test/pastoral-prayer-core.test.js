const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/pastoral-prayer-core.js');

// Being prayed for is recorded twice: a history record per Sunday, and the
// newest of those dates cached on the Person as `lastPastoralPrayerDate`. Every
// bug this module exists to close came from a surface deciding one of these
// questions for itself.

test('the doc ID for a history record is the service date', () => {
    assert.strictEqual(Core.historyDocId('2026-08-16'), '2026-08-16');
    assert.deepStrictEqual(Core.historyRecord('2026-08-16'), { serviceDate: '2026-08-16' });
});

test('a non-date never becomes a doc ID', () => {
    // Better to fail the write than to strand a record under a junk ID that no
    // later save can address.
    assert.strictEqual(Core.historyDocId(''), null);
    assert.strictEqual(Core.historyDocId('16 Aug'), null);
    assert.strictEqual(Core.historyDocId(undefined), null);
});

test('never prayed for is null, whichever sentinel is stored', () => {
    assert.strictEqual(Core.normalizeDate(null), null);
    assert.strictEqual(Core.normalizeDate(undefined), null);
    assert.strictEqual(Core.normalizeDate(''), null);
    // The legacy sentinel two of the old write paths used.
    assert.strictEqual(Core.normalizeDate('0000-00-00'), null);
    assert.strictEqual(Core.normalizeDate('2026-08-16'), '2026-08-16');

    assert.strictEqual(Core.wasPrayedFor('0000-00-00'), false);
    assert.strictEqual(Core.wasPrayedFor(null), false);
    assert.strictEqual(Core.wasPrayedFor('2026-08-16'), true);
});

test('the cached date is the newest history date', () => {
    assert.strictEqual(
        Core.latestDate(['2026-01-04', '2026-08-16', '2025-11-30']), '2026-08-16');
    assert.strictEqual(Core.latestDate([]), null);
    assert.strictEqual(Core.latestDate(null), null);
});

test('a Sunday still ahead counts as the newest date', () => {
    // A booking six weeks out is already a commitment to pray for that person,
    // so the rotation has to stop offering them from the moment it is made.
    assert.strictEqual(Core.latestDate(['2026-01-04', '2099-01-01']), '2099-01-01');
});

test('junk in the history never outranks a real date', () => {
    assert.strictEqual(Core.latestDate(['2026-01-04', '0000-00-00', '', null]), '2026-01-04');
    assert.strictEqual(Core.latestDate(['0000-00-00']), null);
});

// ── nextLastPrayerDate — the pending-write case ──────────────────────────────
// The editor writes the history change and the cache in one batch, so it has to
// answer "what will the newest date be" from a read taken BEFORE the write. It
// used to just read the newest stored date, which is the answer to the question
// as it stood before the edit.

test('choosing a subject moves their date to this service', () => {
    assert.strictEqual(
        Core.nextLastPrayerDate(['2026-01-04'], '2026-08-16', true), '2026-08-16');
});

test('a first-time subject stops reading as never prayed for', () => {
    assert.strictEqual(Core.nextLastPrayerDate([], '2026-08-16', true), '2026-08-16');
});

test('removing a subject falls back to their previous date', () => {
    assert.strictEqual(
        Core.nextLastPrayerDate(['2026-01-04', '2026-08-16'], '2026-08-16', false),
        '2026-01-04');
});

test('removing a subject with no other history clears the date', () => {
    assert.strictEqual(Core.nextLastPrayerDate(['2026-08-16'], '2026-08-16', false), null);
});

test('re-saving an unchanged subject is idempotent', () => {
    assert.strictEqual(
        Core.nextLastPrayerDate(['2026-08-16'], '2026-08-16', true), '2026-08-16');
});

test('an older service does not overwrite a later one', () => {
    // Editing a Sunday from three months ago must not make that person look
    // like the most recently prayed for.
    assert.strictEqual(
        Core.nextLastPrayerDate(['2026-08-16'], '2026-05-03', true), '2026-08-16');
});

test('the legacy sentinel is not treated as a stored date', () => {
    assert.strictEqual(
        Core.nextLastPrayerDate(['0000-00-00'], '2026-08-16', false), null);
});

test('every surface shows the same "last prayed for" label', () => {
    assert.strictEqual(Core.lastPrayedLabel('2026-08-16'), 'Last: 2026-08-16');
    assert.strictEqual(Core.lastPrayedLabel(null), 'Never prayed for');
    assert.strictEqual(Core.lastPrayedLabel('0000-00-00'), 'Never prayed for');
    assert.strictEqual(Core.lastPrayedLabel(undefined), 'Never prayed for');
});

// ── decidePastoralPrayerSave — the Sunday that was actually saved ────────────
// The save used to note the subjects, wait on the history read, then write the
// Service from whatever the page had become. A subject chosen during that wait
// landed on the Service and nowhere in the history. The decision is taken on
// the Sunday being written, against the Sunday that was loaded.

const SUNDAY = '2026-09-20';
const AVA = 'VLgVSj02iWGOpnESrmhd';
const JACOB = 'h2avXZjed7NlW3wIAmvx';

function sunday(overrides) {
    return Object.assign({
        date: SUNDAY,
        prayerMaleId: null,
        prayerFemaleId: null,
    }, overrides);
}

test('a subject who appears only on the saved Sunday is recorded, and the cache includes it', () => {
    const decision = Core.decidePastoralPrayerSave(
        sunday({ prayerMaleId: JACOB }),
        sunday({ prayerMaleId: JACOB, prayerFemaleId: AVA }),
        { [JACOB]: [SUNDAY], [AVA]: [] });

    assert.deepStrictEqual(decision.records, [
        { personId: AVA, serviceDate: SUNDAY, change: 'add' },
    ]);
    assert.deepStrictEqual(decision.caches, [
        { personId: AVA, lastPastoralPrayerDate: SUNDAY },
    ]);
});

test('a subject already on the Sunday, with no history doc, still gets the doc', () => {
    const loaded = sunday({ prayerFemaleId: AVA });
    const decision = Core.decidePastoralPrayerSave(loaded, loaded, { [AVA]: [] });

    assert.deepStrictEqual(decision.records, [
        { personId: AVA, serviceDate: SUNDAY, change: 'add' },
    ]);
    assert.deepStrictEqual(decision.caches, [
        { personId: AVA, lastPastoralPrayerDate: SUNDAY },
    ]);
});

test('saving again when the history doc is already there does not rewrite it', () => {
    const loaded = sunday({ prayerFemaleId: AVA });
    const decision = Core.decidePastoralPrayerSave(
        loaded, loaded, { [AVA]: [SUNDAY] });

    assert.deepStrictEqual(decision.records, []);
    assert.deepStrictEqual(decision.caches, []);
});

test('removing a subject drops that Sunday, and the cache falls back when it was the newest', () => {
    const decision = Core.decidePastoralPrayerSave(
        sunday({ prayerFemaleId: AVA }),
        sunday(),
        { [AVA]: ['2026-01-04', SUNDAY] });

    assert.deepStrictEqual(decision.records, [
        { personId: AVA, serviceDate: SUNDAY, change: 'remove' },
    ]);
    assert.deepStrictEqual(decision.caches, [
        { personId: AVA, lastPastoralPrayerDate: '2026-01-04' },
    ]);
});

test('a Sunday still ahead is the cached date', () => {
    const ahead = '2099-01-03';
    const decision = Core.decidePastoralPrayerSave(
        sunday({ date: ahead }),
        sunday({ date: ahead, prayerFemaleId: AVA }),
        { [AVA]: ['2026-01-04'] });

    assert.deepStrictEqual(decision.records, [
        { personId: AVA, serviceDate: ahead, change: 'add' },
    ]);
    assert.deepStrictEqual(decision.caches, [
        { personId: AVA, lastPastoralPrayerDate: ahead },
    ]);
});

test('a subject chosen while the history read was in flight is on the Sunday that gets written', async () => {
    let live = sunday({ prayerMaleId: JACOB });
    let reads = 0;
    const taken = await Core.takeSundayAfterHistoryRead(
        sunday({ prayerMaleId: JACOB }),
        () => Object.assign({}, live),
        async (personIds) => {
            reads += 1;
            if (reads === 1) live = sunday({ prayerMaleId: JACOB, prayerFemaleId: AVA });
            const stored = {};
            personIds.forEach(id => { stored[id] = []; });
            return stored;
        });

    assert.strictEqual(taken.savedSunday.prayerFemaleId, AVA);
    assert.ok(Object.prototype.hasOwnProperty.call(taken.historyByPerson, AVA));
    const decision = Core.decidePastoralPrayerSave(
        sunday({ prayerMaleId: JACOB }), taken.savedSunday, taken.historyByPerson);
    assert.ok(decision.records.some(record =>
        record.personId === AVA && record.change === 'add' && record.serviceDate === SUNDAY));
});

function fakePeople() {
    return {
        doc(id) {
            return {
                path: 'people/' + id,
                collection() {
                    return {
                        doc(date) {
                            return { path: 'people/' + id + '/pastoral_prayer_history/' + date };
                        },
                    };
                },
            };
        },
    };
}

function fakeBatch() {
    const ops = [];
    return {
        ops,
        set(ref, data) { ops.push({ kind: 'set', path: ref.path, data }); },
        update(ref, data) { ops.push({ kind: 'update', path: ref.path, data }); },
        delete(ref) { ops.push({ kind: 'delete', path: ref.path }); },
    };
}

test('the history doc and the cached date go into the same batch', () => {
    const decision = Core.decidePastoralPrayerSave(
        sunday({ prayerMaleId: JACOB }),
        sunday({ prayerMaleId: JACOB, prayerFemaleId: AVA }),
        { [JACOB]: [SUNDAY], [AVA]: [] });
    const batch = fakeBatch();
    Core.writePastoralPrayerDecision(batch, fakePeople(), decision, 'SERVER_TIME');

    assert.deepStrictEqual(batch.ops.map(op => op.kind + ' ' + op.path), [
        'set people/' + AVA + '/pastoral_prayer_history/' + SUNDAY,
        'update people/' + AVA,
    ]);
    assert.deepStrictEqual(batch.ops[0].data, {
        serviceDate: SUNDAY,
        createdAt: 'SERVER_TIME',
    });
    assert.deepStrictEqual(batch.ops[1].data, { lastPastoralPrayerDate: SUNDAY });
});

test('a repair lists Ava on 20 September 2026 when that history doc is missing', () => {
    const plan = Core.planPastoralPrayerRepair([{
        date: SUNDAY,
        prayerMaleId: JACOB,
        prayerMaleName: 'Jacob Newsom',
        prayerFemaleId: AVA,
        prayerFemaleName: 'Ava Vance',
    }], { [JACOB]: [SUNDAY] });

    assert.deepStrictEqual(plan.adds, [{
        personId: AVA,
        name: 'Ava Vance',
        serviceDate: SUNDAY,
    }]);
    assert.deepStrictEqual(plan.caches, [{
        personId: AVA,
        lastPastoralPrayerDate: SUNDAY,
    }]);
});

test('a subject who already has that Sunday is not a repair create', () => {
    const plan = Core.planPastoralPrayerRepair([{
        date: SUNDAY,
        prayerFemaleId: AVA,
        prayerFemaleName: 'Ava Vance',
    }], { [AVA]: [SUNDAY] });

    assert.deepStrictEqual(plan.adds, []);
    assert.deepStrictEqual(plan.caches, []);
});

test('a Sunday still ahead is a repair row, and it is the cached date', () => {
    const ahead = '2099-01-03';
    const plan = Core.planPastoralPrayerRepair([
        { date: SUNDAY, prayerFemaleId: AVA, prayerFemaleName: 'Ava Vance' },
        { date: ahead, prayerFemaleId: AVA, prayerFemaleName: 'Ava Vance' },
    ], { [AVA]: ['2026-01-04'] });

    assert.deepStrictEqual(plan.adds.map(row => row.serviceDate), [SUNDAY, ahead]);
    assert.deepStrictEqual(plan.caches, [{
        personId: AVA,
        lastPastoralPrayerDate: ahead,
    }]);
});
