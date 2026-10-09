const { test } = require('node:test');
const assert = require('node:assert');
require('../public/sunday-typed-core.js');
require('../public/printable-link-core.js');
const Migrate = require('../public/printable-legacy-migrate-core.js');
const Core = require('../public/printable-core.js');
const Data = require('../public/printable-data-core.js');

test('sunday_typed wires become event fill-ins with stable legacy_ ids', () => {
    const project = {
        name: 'Booklet',
        pages: [{
            id: 'p1',
            nodes: [{
                id: 'n1',
                kind: 'text',
                bind: {
                    text: { scope: 'global', source: 'sunday_typed', field: 'prayerNation', params: { when: { mode: 'this' } } },
                },
            }],
        }],
        inputs: [],
    };
    const out = Migrate.migrateProject(project);
    assert.equal(out.changed, true);
    const bind = out.project.pages[0].nodes[0].bind.text;
    assert.equal(bind.source, 'event_field');
    assert.equal(bind.field, 'legacy_prayerNation');
    assert.ok(out.project.inputs.some(i => i.id === 'legacy_prayerNation'));
    assert.ok(out.project.inputs.some(i => i.id === 'legacy_kidsLessonTitle'));
    // Idempotent
    assert.equal(Migrate.migrateProject(out.project).changed, false);
});

test('buildPrintable migrates sunday_typed on load', () => {
    const p = Core.buildPrintable({
        name: 'Guide',
        pages: [{
            nodes: [{
                id: 't',
                kind: 'text',
                bind: { text: { scope: 'global', source: 'sunday_typed', field: 'kidsLessonTitle', params: {} } },
            }],
        }],
    });
    assert.equal(p.pages[0].nodes[0].bind.text.source, 'event_field');
    assert.equal(p.pages[0].nodes[0].bind.text.field, 'legacy_kidsLessonTitle');
});

test('typedContent seeds empty event fill-ins', () => {
    const Typed = require('../public/sunday-typed-core.js');
    const content = Typed.normalise({
        pastoralPrayer: { nation: 'Peru', continent: 'South America' },
        mosaicKids: { lessonTitle: 'Noah' },
        announcements: [],
    });
    const bag = Migrate.valuesFromTyped(content);
    assert.equal(bag.legacy_prayerNation, 'Peru');
    assert.equal(bag.legacy_kidsLessonTitle, 'Noah');
    const merged = Migrate.mergeEventWithTyped({ legacy_prayerNation: 'Chile' }, content);
    assert.equal(merged.legacy_prayerNation, 'Chile', 'occurrence wins');
    assert.equal(merged.legacy_kidsLessonTitle, 'Noah');
});

test('pastoral prayer requests resolve for elders with subject names and request text', () => {
    const date = '2026-09-06';
    const data = {
        liturgy: null,
        services: {
            [date]: {
                liturgy: {
                    prayerMale: { id: 'p-m', name: 'Abe Example' },
                    prayerFemale: { id: 'p-f', name: 'Bea Example' },
                    prayerLabel: 'Pastoral Prayer',
                },
            },
        },
        prayerRequests: {
            ['p-m/' + date]: { prayerRequest: 'Health after surgery' },
            ['p-f/' + date]: { prayerRequest: 'New job' },
        },
    };
    const denied = Data.resolve('sunday_prayer_requests', {}, data, { today: date, level: 'member' });
    assert.equal(denied.rows.length, 0);
    assert.ok(denied.warnings[0]);
    const r = Data.resolve('sunday_prayer_requests', {}, data, { today: date, level: 'elder' });
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0].name, 'Abe Example');
    assert.equal(r.rows[0].request, 'Health after surgery');
    assert.equal(r.rows[1].who, 'woman');
    assert.ok(Data.querySourcesFor('elder').some(s => s.key === 'sunday_prayer_requests'));
    assert.ok(!Data.querySourcesFor('member').some(s => s.key === 'sunday_prayer_requests'));
    assert.ok(!Data.querySourcesFor('editor').some(s => s.key === 'sunday_prayer_requests'));
});
