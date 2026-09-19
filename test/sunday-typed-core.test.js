const { test } = require('node:test');
const assert = require('node:assert');

const Typed = require('../public/sunday-typed-core.js');

test('empty content is blank and normalise fills every leaf', () => {
    const e = Typed.empty();
    assert.equal(Typed.isBlank(e), true);
    assert.deepEqual(e.mosaicKids.summary, []);
    assert.deepEqual(e.announcements, []);
    const n = Typed.normalise({ pastoralPrayer: { nation: '  Kenya  ' }, announcements: null });
    assert.equal(n.pastoralPrayer.nation, 'Kenya');
    assert.equal(n.pastoralPrayer.capital, '');
    assert.deepEqual(n.announcements, []);
});

test('fromService reads typedContent on that Sunday only', () => {
    const a = {
        typedContent: {
            pastoralPrayer: { nation: 'Kenya', capital: 'Nairobi' },
            mosaicKids: { lessonTitle: 'The Lost Sheep' },
            announcements: [{ title: 'Picnic', content: 'Bring a plate' }],
        },
    };
    const b = {
        typedContent: {
            pastoralPrayer: { nation: 'Japan', capital: 'Tokyo' },
            mosaicKids: { lessonTitle: 'Jonah' },
            announcements: [{ title: 'Choir', content: 'Thursday' }],
        },
    };
    const rowA = Typed.toRow(Typed.fromService(a), '2026-09-06');
    const rowB = Typed.toRow(Typed.fromService(b), '2026-09-13');
    assert.equal(rowA.prayerNation, 'Kenya');
    assert.equal(rowA.kidsLessonTitle, 'The Lost Sheep');
    assert.match(rowA.announcements, /Picnic/);
    assert.equal(rowB.prayerNation, 'Japan');
    assert.equal(rowB.kidsLessonTitle, 'Jonah');
    assert.ok(!rowB.announcements.includes('Picnic'), 'Sunday A must not leak onto Sunday B');
    assert.ok(!rowA.announcements.includes('Choir'), 'Sunday B must not leak onto Sunday A');
});

test('a week with only the old guide still reads, and typedContent wins a field', () => {
    const v2 = {
        guide: {
            format: 'v2',
            values: {
                pp_nation: 'Kenya', pp_capital: 'Nairobi',
                kids_lesson_title: 'The Lost Sheep',
                announcements: [{ title: 'Picnic', content: 'Park' }],
            },
        },
        typedContent: { pastoralPrayer: { nation: 'Uganda' } },
    };
    const row = Typed.toRow(Typed.fromService(v2));
    assert.equal(row.prayerNation, 'Uganda', 'the store wins the field that was typed');
    assert.equal(row.prayerCapital, 'Nairobi', 'untouched fields still come from the guide');
    assert.equal(row.kidsLessonTitle, 'The Lost Sheep');

    const legacy = {
        guide: {
            elements: [
                { type: 'pastoral_prayer', nation: 'Ghana', capital: 'Accra' },
                { type: 'kids_section', lessonTitle: 'David', lessonVerse: '1 Sam 17', summary: ['A giant'], questions: ['Who?'] },
                { type: 'announcements', items: [{ title: 'Meal', content: 'After' }] },
            ],
        },
    };
    const leg = Typed.toRow(Typed.fromService(legacy));
    assert.equal(leg.prayerNation, 'Ghana');
    assert.equal(leg.kidsLessonTitle, 'David');
    assert.match(leg.announcements, /Meal/);
});

test('draft round-trips and empty page assets are not invented', () => {
    const content = Typed.fromDraft({
        prayerNation: 'Kenya',
        prayerPrompts: 'Pray for churches\nPray for leaders',
        kidsSummary: 'Point one\nPoint two',
        announcements: [{ title: 'Picnic', content: 'Saturday' }, { title: '', content: '' }],
    });
    assert.deepEqual(content.pastoralPrayer.prompts, ['Pray for churches', 'Pray for leaders']);
    assert.equal(content.announcements.length, 1);
    const draft = Typed.toDraft(content);
    assert.equal(draft.prayerNation, 'Kenya');
    assert.equal(Typed.fromDraft(draft).pastoralPrayer.nation, 'Kenya');
    assert.equal(Typed.fromService(null).pastoralPrayer.countryImage, '');
});
