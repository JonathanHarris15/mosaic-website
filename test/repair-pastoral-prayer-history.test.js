const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Repair = require('../scripts/repair-pastoral-prayer-history.js');
const { requireProject } = require('../scripts/firebase-project');

const ROOT = path.join(__dirname, '..');
const AVA = 'VLgVSj02iWGOpnESrmhd';
const SUNDAY = '2026-09-20';

test('a Service doc becomes the two pastoral-prayer subjects', () => {
    const service = Repair.serviceFromDoc(SUNDAY, {
        liturgy: {
            prayerFemale: { id: AVA, name: 'Ava Vance' },
            prayerMale: { id: null, name: '' },
        },
    });
    assert.deepStrictEqual(service, {
        date: SUNDAY,
        prayerMaleId: null,
        prayerMaleName: '',
        prayerFemaleId: AVA,
        prayerFemaleName: 'Ava Vance',
    });
});

test('a slot saved under the old dotted field name still counts', () => {
    const service = Repair.serviceFromDoc(SUNDAY, {
        'liturgy.prayerFemale': { id: AVA, name: 'Ava Vance' },
    });
    assert.strictEqual(service.prayerFemaleId, AVA);
    assert.strictEqual(service.prayerFemaleName, 'Ava Vance');
});

test('dry-run lists Ava on 20 September 2026 and writes nothing', async () => {
    let wrote = false;
    const result = await Repair.repairFromSnapshots(
        [{
            date: SUNDAY,
            prayerFemaleId: AVA,
            prayerFemaleName: 'Ava Vance',
            prayerMaleId: null,
            prayerMaleName: '',
        }],
        [],
        { apply: false, write: async () => { wrote = true; } });

    assert.strictEqual(wrote, false);
    assert.strictEqual(result.wrote, false);
    assert.strictEqual(result.plan.adds.length, 1);
    assert.strictEqual(result.plan.adds[0].name, 'Ava Vance');
    assert.strictEqual(result.plan.adds[0].serviceDate, SUNDAY);
    assert.match(Repair.formatPlan(result.plan)[0], /Ava Vance/);
    assert.match(Repair.formatPlan(result.plan)[0], new RegExp(SUNDAY));
});

test('without --apply the script does not write, including when pointed at the church project', () => {
    assert.strictEqual(Repair.wantsApply([
        'node', 'scripts/repair-pastoral-prayer-history.js',
        '--project', 'mosaic-hymn-database',
        '--i-mean-prod',
    ]), false);
    assert.strictEqual(Repair.wantsApply([
        '--project', 'mosaic-hymn-database',
        '--i-mean-prod',
        '--apply',
    ]), true);
});

test('the church project is refused without --i-mean-prod', () => {
    assert.throws(
        () => requireProject(
            ['node', 'repair-pastoral-prayer-history.js', '--project', 'mosaic-hymn-database'],
            { root: ROOT }),
        /i-mean-prod/);
});

test('the script refuses the church project up front and writes only with --apply', () => {
    const src = fs.readFileSync(
        path.join(ROOT, 'scripts', 'repair-pastoral-prayer-history.js'), 'utf8');
    assert.match(src, /requireProject\(process\.argv\)/);
    assert.match(src, /repairFromSnapshots\(services, historyDocs/);
    const guard = src.indexOf('if (!apply) return { wrote: false');
    const write = src.indexOf('await options.write(plan)');
    assert.ok(guard > -1 && write > guard, 'apply is behind the dry-run guard');
});
