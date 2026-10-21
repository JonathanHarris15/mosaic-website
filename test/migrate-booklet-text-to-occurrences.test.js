const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');

const Copy = require('../scripts/migrate-booklet-text-to-occurrences.js');

const oldSunday = {
    typedContent: {
        pastoralPrayer: { nation: 'Uganda' },
        announcements: [{ title: 'Picnic', content: 'Bring a plate' }],
    },
    guide: {
        format: 'v2',
        values: { pp_nation: 'Egypt', pp_capital: 'Cairo', pp_continent: 'Africa' },
    },
};

test('the copy fills a missing key, keeps a blank, and does not delete the old stores', () => {
    const planned = Copy.planServiceCopies(oldSunday, {
        guide: { legacy_prayerNation: '' },
        bulletin: {},
    });
    assert.equal(planned.hasBookletText, true);
    assert.equal(planned.wouldWrite, true);
    assert.equal(Object.prototype.hasOwnProperty.call(planned.plans.guide, 'legacy_prayerNation'), false);
    assert.equal(planned.plans.guide.legacy_prayerCapital, 'Cairo');
    assert.equal(planned.plans.guide.legacy_prayerContinent, 'Africa');
    assert.match(planned.plans.guide.legacy_announcements, /Picnic/);
    assert.equal(planned.plans.bulletin.legacy_prayerNation, 'Uganda');
    assert.equal(planned.plans.deletes, undefined);
    assert.ok(planned.blanksLeft >= 1);

    const kept = Copy.planServiceCopies(oldSunday, {
        guide: { legacy_prayerNation: 'Chile' },
    });
    assert.equal(kept.plans.guide.legacy_prayerNation, undefined);
    assert.equal(Copy.planServiceCopies({ theme: 'Grace' }, { guide: {} }).hasBookletText, false);
});

test('a new occurrence is stamped from the series and does not invent a roster', () => {
    const body = Copy.newOccurrenceBody('2026-09-06', {
        visibility: 'public',
        rosterShared: true,
    }, {
        guide: { legacy_prayerCapital: 'Cairo' },
    });
    assert.equal(body.seriesId, 'sunday_service');
    assert.equal(body.date, '2026-09-06');
    assert.equal(body.visibility, 'public');
    assert.equal(body.rosterShared, true);
    assert.equal(body.printableInputs.guide.legacy_prayerCapital, 'Cairo');
    assert.equal(body.participantIds, undefined);
    assert.equal(body.typedContent, undefined);
    assert.equal(Copy.occurrenceId('2026-09-06'), 'sunday_service_2026-09-06');
});

test('merging fill-ins keeps every other printable on the occurrence', () => {
    const next = Copy.mergePrintableInputs({
        guide: { legacy_prayerNation: '' },
        other: { note: 'Keep me' },
    }, {
        guide: { legacy_prayerCapital: 'Cairo' },
    });
    assert.equal(next.guide.legacy_prayerNation, '');
    assert.equal(next.guide.legacy_prayerCapital, 'Cairo');
    assert.equal(next.other.note, 'Keep me');
});

test('the date window is service ids, and the script never deletes', () => {
    assert.equal(Copy.inDateRange('2026-09-06', '2026-09-01', '2026-09-30'), true);
    assert.equal(Copy.inDateRange('2026-08-30', '2026-09-01', null), false);
    assert.equal(Copy.inDateRange('not-a-date', null, null), false);
    const src = fs.readFileSync(
        path.join(__dirname, '../scripts/migrate-booklet-text-to-occurrences.js'),
        'utf8'
    );
    assert.equal(src.includes('FieldValue.delete'), false);
    assert.equal(src.includes('typedContentDeleted: 0'), true);
    assert.equal(src.includes('guideFieldsDeleted: 0'), true);
});
