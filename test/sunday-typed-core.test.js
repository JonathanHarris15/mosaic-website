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

test('https country-map paste round-trips onto typedContent', () => {
    const url = 'https://firebasestorage.googleapis.com/v0/b/app/o/sunday_typed%2F2026-09-06%2Fcountry_map%2Fmap.png?alt=media';
    const content = Typed.fromDraft({ prayerNation: 'Kenya', prayerCountryImage: url });
    assert.equal(content.pastoralPrayer.countryImage, url);
    assert.equal(Typed.countryImageWriteError(url), '');
    assert.equal(Typed.assertCountryImageWritable(url), url);
    const row = Typed.toRow(content);
    assert.equal(row.prayerCountryImage, url);
    const draft = Typed.toDraft(content);
    assert.equal(draft.prayerCountryImage, url);
    assert.equal(Typed.fromDraft(draft).pastoralPrayer.countryImage, url);
});

test('an upload writes a Storage path URL, not a data URL', () => {
    const date = '2026-09-06';
    const path = Typed.countryMapStoragePath(date, 'map_kenya.png');
    assert.equal(path, 'sunday_typed/2026-09-06/country_map/map_kenya.png');
    const stored = 'https://firebasestorage.googleapis.com/v0/b/x/o/' + encodeURIComponent(path);
    assert.ok(!Typed.isDataUrl(stored));
    assert.equal(Typed.isHttpsUrl(stored), true);
    assert.equal(Typed.countryImageWriteError(stored), '');
    const content = Typed.fromDraft({ prayerCountryImage: stored });
    assert.equal(content.pastoralPrayer.countryImage, stored);
    assert.ok(!content.pastoralPrayer.countryImage.startsWith('data:'));
});

test('oversized country-map data URLs and uploads are refused before write', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(Typed.MAX_DATA_URL_BYTES + 1);
    assert.equal(Typed.countryImageWriteError(huge), Typed.OVERSIZE_DATA_URL_MSG);
    assert.throws(() => Typed.assertCountryImageWritable(huge), (err) => {
        assert.equal(err.code, 'country-map-size');
        assert.equal(err.message, Typed.OVERSIZE_DATA_URL_MSG);
        return true;
    });
    const small = 'data:image/png;base64,iVBORw0KGgo=';
    assert.equal(Typed.countryImageWriteError(small), '');
    assert.equal(Typed.fileUploadError({ type: 'image/png', size: Typed.MAX_UPLOAD_BYTES + 1 }), Typed.OVERSIZE_UPLOAD_MSG);
    assert.equal(Typed.fileUploadError({ type: 'application/pdf', size: 12 }), 'The country map must be an image.');
    assert.equal(Typed.fileUploadError({ type: 'image/jpeg', size: 12000 }), '');
    assert.match(Typed.countryImageWriteError('http://example.com/map.png'), /https/);
});

test('the editor uploads the country map to Storage and guards the write', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '../public/printable-editor-data.js'), 'utf8');
    assert.match(src, /countryMapStoragePath/);
    assert.match(src, /getDownloadURL/);
    assert.match(src, /assertCountryImageWritable/);
    assert.doesNotMatch(src, /readAsDataURL/,
        'file upload must not write a data URL onto typedContent');
});
