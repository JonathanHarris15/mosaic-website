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
    assert.deepEqual(body.participantIds, []);
    assert.equal(body.typedContent, undefined);
    assert.equal(Copy.occurrenceId('2026-09-06'), 'sunday_service_2026-09-06');

    const unstamped = Copy.newOccurrenceBody('2026-09-13', {}, {
        guide: { legacy_prayerNation: 'Kenya' },
    }, [{ personId: 'p-abe' }, { personId: 'p-abe' }]);
    assert.equal(unstamped.visibility, 'public');
    assert.deepEqual(unstamped.participantIds, ['p-abe']);
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

test('a legacy guide element still fills a field the typed record left blank', () => {
    const planned = Copy.planServiceCopies({
        typedContent: { pastoralPrayer: { nation: 'Uganda' } },
        guide: {
            elements: [{ type: 'pastoral_prayer', nation: 'Egypt', capital: 'Cairo' }],
        },
    }, { bulletin: {} });
    assert.equal(planned.plans.bulletin.legacy_prayerNation, 'Uganda');
    assert.equal(planned.plans.bulletin.legacy_prayerCapital, 'Cairo');
});

test('only a printable that reads booklet text is selected', () => {
    assert.equal(Copy.readsBookletText({
        inputs: [{ id: 'legacy_prayerNation', label: 'Nation', kind: 'text' }],
        pages: [],
    }), true);
    assert.equal(Copy.readsBookletText({
        inputs: [],
        pages: [{
            id: 'pg',
            nodes: [{ id: 'ann', tag: 'p', repeat: { source: 'sunday_announcements', params: {} } }],
        }],
    }), true);
    assert.equal(Copy.readsBookletText({
        inputs: [],
        pages: [{
            id: 'pg',
            nodes: [{ id: 'q', tag: 'p', repeat: { source: 'sunday_kids_questions', params: {} } }],
        }],
    }), true);
    assert.equal(Copy.readsBookletText({
        inputs: [],
        pages: [{
            id: 'pg',
            nodes: [{
                id: 'img',
                tag: 'img',
                bind: { src: { scope: 'global', source: 'sunday_typed', field: 'prayerCountryImage', params: {} } },
            }],
        }],
    }), true);
    assert.equal(Copy.readsBookletText({
        inputs: [],
        pages: [{
            id: 'pg',
            nodes: [{
                id: 'nested',
                tag: 'div',
                children: [{
                    id: 'nation',
                    tag: 'p',
                    bind: { text: { scope: 'global', source: 'event_field', field: 'legacy_prayerNation', params: {} } },
                }],
            }],
        }],
    }), true);
    assert.equal(Copy.readsBookletText({
        inputs: [{ id: 'sermon_title', label: 'Sermon', kind: 'text' }],
        pages: [{
            id: 'pg',
            nodes: [{
                id: 'title',
                tag: 'p',
                bind: { text: { scope: 'global', source: 'event_field', field: 'sermon_title', params: {} } },
            }],
        }],
    }), false);
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
    assert.equal(src.includes('batch.set(occRef'), false);
    assert.equal(src.includes('await occRef.set'), true);
    assert.equal(src.includes('maxResultBytes'), true);
    assert.equal(src.includes('Migrate.contentFromLegacyStores'), false);
    assert.equal(src.includes('Migrate.planOccurrenceFill'), false);
    assert.equal(src.includes('Migrate.readsBookletText'), false);
    const store = fs.readFileSync(path.join(__dirname, '../public/printable-data-store.js'), 'utf8');
    const live = fs.readFileSync(path.join(__dirname, '../public/printable-live.js'), 'utf8');
    assert.equal(store.includes('mergeEventWithTyped'), true);
    assert.equal(live.includes('function legacyTypedFallback'), true);
});

test('a stored sunday_typed wire is what a commit would save', () => {
    const migrated = Copy.printableMigration({
        id: 'guide',
        inputs: [],
        pages: [{
            id: 'pg',
            nodes: [{
                id: 'nation',
                bind: { text: { scope: 'global', source: 'sunday_typed', field: 'prayerNation', params: {} } },
            }],
        }],
    });
    assert.equal(migrated.changed, true);
    assert.equal(migrated.readsBooklet, true);
    assert.ok(migrated.patch);
    assert.equal(migrated.patch.pages[0].nodes[0].bind.text.source, 'event_field');
    assert.equal(migrated.patch.pages[0].nodes[0].bind.text.field, 'legacy_prayerNation');
    const order = Copy.printableMigration({
        id: 'order',
        inputs: [{ id: 'sermon_title', label: 'Sermon', kind: 'text' }],
        pages: [{
            id: 'pg',
            nodes: [{
                id: 'title',
                bind: { text: { scope: 'global', source: 'event_field', field: 'sermon_title', params: {} } },
            }],
        }],
    });
    assert.equal(order.changed, false);
    assert.equal(order.patch, null);
    assert.equal(order.readsBooklet, false);
});

test('a new occurrence reads the roster snapshot, and a size rejection skips the write', async () => {
    let collectionName = '';
    const ref = {
        collection(/** @type {string} */ name) {
            collectionName = name;
            return {
                get: async () => ({
                    docs: [
                        { data: () => ({ personId: 'p-abe' }) },
                        { data: () => ({ personId: 'p-abe' }) },
                    ],
                }),
            };
        },
    };
    const created = await Copy.rosterAssignments(ref, false, true);
    assert.equal(collectionName, 'roster');
    const body = Copy.newOccurrenceBody('2026-09-06', {}, {
        guide: { legacy_prayerNation: 'Kenya' },
    }, created);
    assert.deepEqual(body.participantIds, ['p-abe']);
    assert.deepEqual(await Copy.rosterAssignments(ref, true, true), []);
    assert.deepEqual(await Copy.rosterAssignments(ref, false, false), []);

    const sizeRef = {
        async set() {
            const err = /** @type {any} */ (new Error('size'));
            err.details = 'exceeds the maximum allowed size';
            throw err;
        },
    };
    assert.equal(await Copy.commitOccurrence(sizeRef, {
        overLimit: false,
        body: { printableInputs: {} },
    }), 'skipped');
    const denied = { async set() { throw new Error('permission denied'); } };
    await assert.rejects(
        () => Copy.commitOccurrence(denied, { overLimit: false, body: {} }),
        /permission denied/
    );
    /** @type {any} */
    let saved = null;
    const ok = { async set(/** @type {any} */ body) { saved = body; } };
    assert.equal(await Copy.commitOccurrence(ok, {
        overLimit: false,
        body: { printableInputs: { guide: { legacy_prayerNation: 'Kenya' } } },
    }), 'wrote');
    assert.equal(saved.printableInputs.guide.legacy_prayerNation, 'Kenya');
});

test('a data URL under 2048 bytes stays inline', () => {
    const image = 'data:image/png;base64,' + 'A'.repeat(80);
    assert.ok(Buffer.byteLength(image, 'utf8') < Copy.DATA_URL_MIN_BYTES);
    const prep = Copy.prepareOccurrenceWrite({
        printableInputs: {},
    }, {
        guide: { legacy_prayerCountryImage: image },
    }, {
        occurrenceId: 'sunday_service_2026-09-06',
        date: '2026-09-06',
        bucket: 'mosaic-hymn-database.firebasestorage.app',
    });
    assert.equal(prep.uploads.length, 0);
    assert.equal(prep.imagesOffloaded, 0);
    assert.equal(prep.body.printableInputs.guide.legacy_prayerCountryImage, image);
});

test('--commit without --i-mean-prod throws, and a size rejection is a skip', () => {
    assert.throws(() => Copy.writeMode(['--commit']), /--commit also needs --i-mean-prod/);
    assert.equal(Copy.writeMode(['--commit', '--i-mean-prod']).commit, true);
    assert.equal(Copy.writeMode(['--i-mean-prod']).commit, false);
    assert.equal(Copy.writeOutcome({ overLimit: true }), 'skip');
    assert.equal(Copy.writeOutcome({ overLimit: false }), 'write');
    assert.equal(Copy.writeOutcome({ overLimit: false }, {
        details: 'exceeds the maximum allowed size',
    }), 'skip');
    assert.equal(Copy.writeOutcome({ overLimit: false }, new Error('permission denied')), 'throw');
});

test('a country-map data URL is stored once, as a URL, under the size ceiling', () => {
    const image = 'data:image/png;base64,' + 'A'.repeat(200 * 1024);
    const plans = {
        guide: { legacy_prayerCountryImage: image, legacy_prayerNation: 'Uganda' },
        bulletin: { legacy_prayerCountryImage: image, legacy_prayerNation: 'Uganda' },
    };
    const existing = {
        seriesId: 'sunday_service',
        date: '2026-09-06',
        notes: 'n'.repeat(800 * 1024),
        printableInputs: { other: { note: 'Keep me' } },
    };
    const prep = Copy.prepareOccurrenceWrite(existing, plans, {
        occurrenceId: 'sunday_service_2026-09-06',
        date: '2026-09-06',
        bucket: 'mosaic-hymn-database.firebasestorage.app',
    });
    assert.equal(prep.uploads.length, 1);
    assert.equal(prep.imagesOffloaded, 2);
    assert.ok(prep.inlineImageBytes > 400 * 1024);
    assert.ok(prep.beforeOffloadBytes > Copy.LIMIT_BYTES);
    assert.ok(prep.resultBytes < prep.beforeOffloadBytes);
    assert.ok(prep.resultBytes < Copy.WRITE_CEILING_BYTES);
    assert.equal(prep.overLimit, false);
    assert.equal(prep.body.printableInputs.guide.legacy_prayerNation, 'Uganda');
    assert.equal(
        prep.body.printableInputs.guide.legacy_prayerCountryImage,
        prep.body.printableInputs.bulletin.legacy_prayerCountryImage
    );
    assert.equal(prep.body.printableInputs.guide.legacy_prayerCountryImage.startsWith('data:'), false);
    assert.equal(prep.body.printableInputs.other.note, 'Keep me');
    const imageField = prep.largestBefore.find(field => field.dataUrl);
    assert.ok(imageField);
    assert.equal(imageField.path.includes('legacy_prayerCountryImage'), true);
    assert.equal(JSON.stringify(prep.largestBefore).includes(image.slice(0, 80)), false);
});

test('a document that is still over the ceiling is skipped, and a size error is recognised', () => {
    const fat = 'x'.repeat(1000000);
    const prep = Copy.prepareOccurrenceWrite({
        seriesId: 'sunday_service',
        notes: fat,
        printableInputs: {},
    }, {
        guide: { legacy_prayerNation: 'Uganda' },
    }, {
        occurrenceId: 'sunday_service_2026-09-06',
        date: '2026-09-06',
        bucket: 'mosaic-hymn-database.firebasestorage.app',
    });
    assert.equal(prep.overLimit, true);
    assert.ok(prep.resultBytes > Copy.WRITE_CEILING_BYTES);
    assert.equal(prep.uploads.length, 0);
    assert.equal(Copy.isSizeError({
        details: "Document 'event_occurrences/sunday_service_2026-09-06' cannot be written because its size (1,293,448 bytes) exceeds the maximum allowed size of 1,048,576 bytes.",
    }), true);
    assert.equal(Copy.isSizeError(new Error('permission denied')), false);
});
