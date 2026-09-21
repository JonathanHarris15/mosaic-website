const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const builder = fs.readFileSync(path.join(PUBLIC, 'service-builder.js'), 'utf8');
const calendar = fs.readFileSync(path.join(PUBLIC, 'service-calendar.js'), 'utf8');

function sliceBetween(src, start, end) {
    const from = src.indexOf(start);
    const to = src.indexOf(end, from);
    assert.ok(from > -1 && to > from, `missing ${start}`);
    return src.slice(from, to);
}

test('the Order of Service save decides pastoral prayer from the Sunday it writes', () => {
    const save = sliceBetween(builder, 'async save(manual = false)', 'watchForChanges()');
    assert.match(save, /takeSundayAfterHistoryRead/);
    assert.match(save, /decidePastoralPrayerSave/);
    assert.match(save, /writePastoralPrayerDecision/);
    assert.match(save, /flattenServiceForSave\(frozenService\)/);
    const commit = save.indexOf('await batch.commit()');
    const recorded = save.indexOf('this.originalService = serviceSnapshot(frozenService)');
    assert.ok(commit > -1 && recorded > commit,
        'already-saved is the Sunday that was written, not a later edit');
    assert.ok(!save.includes('this.originalService = serviceSnapshot(this.service)'),
        'a subject chosen during the commit must not be marked saved');
});

test('the calendar picker writes the cached date in the same batch as the history', () => {
    const save = sliceBetween(calendar, 'async savePersonSelection()', 'promptAddPerson(name, callback)');
    assert.match(save, /decidePastoralPrayerSave/);
    assert.match(save, /writePastoralPrayerDecision/);
    assert.ok(!save.includes('recomputeLastPrayerDate'),
        'the cached date is not a follow-up write');
    const commit = save.indexOf('await batch.commit()');
    const write = save.indexOf('writePastoralPrayerDecision');
    assert.ok(write > -1 && write < commit);
    assert.match(save, /chosenId/);
});
