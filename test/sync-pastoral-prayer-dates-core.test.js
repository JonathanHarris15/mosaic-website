const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Core = require('../public/sync-pastoral-prayer-dates-core.js');

test('unset cache matches empty history', () => {
    assert.equal(Core.cacheMatchesHistory(undefined, null), true);
    assert.equal(Core.needsCacheCorrection(undefined, []), false);
});

test('legacy sentinel is out of step when history is empty', () => {
    assert.equal(Core.needsCacheCorrection('0000-00-00', []), true);
});

test('cache matches the newest history date', () => {
    const dates = ['2026-01-04', '2026-03-01'];
    assert.equal(Core.needsCacheCorrection('2026-03-01', dates), false);
    assert.equal(Core.needsCacheCorrection('2026-01-04', dates), true);
});

test('history records normalize sentinel doc ids away', () => {
    assert.deepStrictEqual(
        Core.historyDatesFromRecords([
            { serviceDate: '2026-02-01' },
            { docId: '0000-00-00' },
        ]),
        ['2026-02-01'],
    );
});

test('sync script resolves credentials through service-account.js', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'sync-pastoral-prayer-dates.js'),
        'utf8',
    );
    assert.match(src, /require\('\.\/service-account\.js'\)/);
    assert.match(src, /serviceAccount\(\)/);
    assert.doesNotMatch(src, /resolveServiceAccount/);
    assert.doesNotMatch(src, /readdirSync\(root\)/);
});
