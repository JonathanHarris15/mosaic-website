const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Live = require('../public/printable-live.js');
const Core = require('../public/printable-core.js');
const Data = require('../public/printable-data-core.js');
const Migrate = require('../public/printable-legacy-migrate-core.js');
require('../public/printable-link-core.js');

const DATE = '2026-09-06';
const TODAY = '2026-09-03';

function bookletProject() {
    const project = Core.buildPrintable({
        name: 'Sunday guide',
        inputs: [
            { id: 'legacy_prayerNation', label: 'Prayer country', kind: 'text' },
            { id: 'legacy_announcements', label: 'Announcements', kind: 'text' },
        ],
        pages: [{
            id: 'pg',
            nodes: [{
                id: 'nation',
                tag: 'p',
                text: 'Country',
                bind: {
                    text: {
                        scope: 'global',
                        source: 'event_field',
                        field: 'legacy_prayerNation',
                        params: {},
                    },
                },
            }],
        }],
    });
    project.id = 'guide';
    return project;
}

function oldSunday() {
    return {
        typedContent: {
            pastoralPrayer: { nation: 'Uganda' },
            announcements: [{ title: 'Picnic', content: 'Bring a plate' }],
        },
        guide: {
            format: 'v2',
            values: { pp_nation: 'Egypt', pp_capital: 'Cairo', pp_continent: 'Africa' },
        },
    };
}

test('MS-777: a filled occurrence prints, a blank stays blank, and the old stores do not', () => {
    const project = bookletProject();
    const bind = project.pages[0].nodes[0].bind.text;
    const old = oldSunday();

    const filled = Live.resolver(project, {
        eventInputs: { legacy_prayerNation: 'Kenya' },
        services: { [DATE]: old },
    }, { today: TODAY, level: 'editor' });
    assert.deepEqual(filled.valueFor(bind, null), { ok: true, value: 'Kenya' });

    const blank = Live.resolver(project, {
        eventInputs: { legacy_prayerNation: '' },
        services: { [DATE]: old },
    }, { today: TODAY, level: 'editor' });
    assert.equal(blank.valueFor(bind, null).ok, false);

    const onlyOld = Live.resolver(project, {
        eventInputs: {},
        services: { [DATE]: old },
    }, { today: TODAY, level: 'editor' });
    assert.equal(onlyOld.valueFor(bind, null).ok, false);
});

test('MS-777: announcements and kids questions read the occurrence, not typed content or the guide', () => {
    const old = oldSunday();
    const data = {
        services: { [DATE]: old },
        bookletByDate: {
            [DATE]: {
                legacy_announcements: 'Choir\nThursday night',
                legacy_kidsQuestions: 'Who is the shepherd?\n\nWhat did he leave?',
            },
        },
    };
    const announcements = /** @type {any} */ (Data.resolve('sunday_announcements', {}, data, { today: TODAY }));
    assert.deepEqual(announcements.rows.map(/** @param {any} row */ row => row.title), ['Choir']);
    assert.equal(announcements.rows[0].content, 'Thursday night');
    assert.ok(!announcements.rows.some(/** @param {any} row */ row => row.title === 'Picnic'));

    const questions = /** @type {any} */ (Data.resolve('sunday_kids_questions', {}, data, { today: TODAY }));
    assert.deepEqual(questions.rows.map(/** @param {any} row */ row => row.text), ['Who is the shepherd?', 'What did he leave?']);

    const cleared = Data.resolve('sunday_announcements', {}, {
        services: { [DATE]: old },
        bookletByDate: { [DATE]: { legacy_announcements: '' } },
    }, { today: TODAY });
    assert.equal(cleared.rows.length, 0);

    const untouched = Data.resolve('sunday_kids_questions', {}, {
        services: { [DATE]: old },
    }, { today: TODAY });
    assert.equal(untouched.rows.length, 0);
});

test('MS-777: the copy fills a missing occurrence key from typed content, then the guide, and leaves a blank', () => {
    const onlyTyped = /** @type {any} */ (Migrate.planOccurrenceFill(null, {
        typedContent: { pastoralPrayer: { nation: 'Kenya' } },
    }));
    assert.equal(onlyTyped.patch.legacy_prayerNation, 'Kenya');
    assert.equal(onlyTyped.wouldWrite, true);
    assert.equal(onlyTyped.deletes, undefined);

    const onlyGuide = Migrate.planOccurrenceFill({}, {
        guide: { format: 'v2', values: { pp_capital: 'Cairo', kids_lesson_title: 'Noah' } },
    });
    assert.equal(onlyGuide.patch.legacy_prayerCapital, 'Cairo');
    assert.equal(onlyGuide.patch.legacy_kidsLessonTitle, 'Noah');

    const blankWins = Migrate.planOccurrenceFill({ legacy_prayerNation: '' }, oldSunday());
    assert.equal(Object.prototype.hasOwnProperty.call(blankWins.patch, 'legacy_prayerNation'), false);
    assert.equal(blankWins.patch.legacy_prayerCapital, 'Cairo');
    assert.equal(blankWins.patch.legacy_prayerContinent, 'Africa');

    const filledWins = Migrate.planOccurrenceFill({ legacy_prayerNation: 'Chile' }, oldSunday());
    assert.equal(Object.prototype.hasOwnProperty.call(filledWins.patch, 'legacy_prayerNation'), false);
    assert.equal(filledWins.bag.legacy_prayerNation, 'Chile');
});

test('MS-777: a save writes a blank only for a key the occurrence already has, and the draft reads that bag', () => {
    const patch = /** @type {any} */ (Migrate.patchFromContent({
        pastoralPrayer: { nation: '', capital: 'Cairo' },
        announcements: [],
    }, { legacy_prayerNation: 'Kenya' }));
    assert.equal(patch.legacy_prayerNation, '');
    assert.equal(patch.legacy_prayerCapital, 'Cairo');
    assert.equal(Object.prototype.hasOwnProperty.call(patch, 'legacy_prayerContinent'), false);

    const draft = /** @type {any} */ (Migrate.draftFromBag({
        legacy_prayerNation: 'Kenya',
        legacy_announcements: 'Choir\nThursday night',
    }));
    assert.equal(draft.prayerNation, 'Kenya');
    assert.equal(draft.prayerCapital, '');
    assert.equal(draft.announcements[0].title, 'Choir');
    assert.equal(draft.announcements[0].content, 'Thursday night');
});

test('MS-777: booklet pages do not write typed content or read it back as a fallback', () => {
    const root = path.join(__dirname, '..');
    const files = [
        'public/printable-live.js',
        'public/printable-data-store.js',
        'public/printable-data-core.js',
        'public/printable-view.js',
        'public/printable-editor-data.js',
        'public/service-builder.js',
    ];
    files.forEach(rel => {
        const src = fs.readFileSync(path.join(root, rel), 'utf8');
        assert.equal(src.includes('typedContent'), false, rel);
        assert.equal(src.includes('legacyTypedFallback'), false, rel);
        assert.equal(src.includes('mergeEventWithTyped'), false, rel);
    });
    const catalog = fs.readFileSync(path.join(root, 'public/printable-data-core.js'), 'utf8');
    assert.equal(catalog.includes("key: 'sunday_typed'"), false);
});

test('MS-777: the announcements tab reads and writes the Sunday occurrence', async () => {
    const host = /** @type {any} */ (global);
    const Occurrence = require('../public/events-occurrence-core.js');
    const Typed = require('../public/sunday-typed-core.js');
    const prevWindow = host.window;
    host.window = Object.assign({}, prevWindow, {
        SundayTypedCore: Typed,
        EventsOccurrenceCore: Occurrence,
        PrintedAnnouncementGuide: { eventsForSunday: async () => [] },
        PrintedAnnouncementLines: { sourcesForSunday: () => [] },
    });
    /** @type {Record<string, any>} */
    const docs = {};
    host.db = {
        collection() {
            return {
                doc(/** @type {any} */ id) {
                    return {
                        get: async () => ({
                            exists: Object.prototype.hasOwnProperty.call(docs, id),
                            data: () => docs[id],
                        }),
                        set: async (/** @type {any} */ data) => {
                            docs[id] = Object.assign({}, docs[id] || {}, data);
                        },
                    };
                },
            };
        },
    };
    try {
        const { serviceForm } = require('../public/service-builder.js');
        const page = /** @type {any} */ (serviceForm());
        page.date = DATE;
        page.canEdit = true;
        page.serviceGuideTarget = () => ({ printableId: 'guide' });
        const occId = page.sundayOccurrenceId;
        docs[occId] = {
            printableInputs: { guide: { legacy_announcements: 'Choir\nThursday night' } },
        };
        await page.loadSundayAnnouncements();
        assert.equal(page.typedAnnouncements[0].title, 'Choir');
        assert.equal(page.typedAnnouncements[0].content, 'Thursday night');

        page.typedAnnouncements = [];
        await page.saveSundayAnnouncements();
        assert.equal(docs[occId].printableInputs.guide.legacy_announcements, '');
        assert.equal(page.announcementsStatus, 'Saved.');
    } finally {
        delete host.db;
        host.window = prevWindow;
    }
});

test('MS-777: a failed fill-in read is reported', async () => {
    const host = /** @type {any} */ (global);
    const { PrintableEditorData } = require('../public/printable-editor-data.js');
    const ed = /** @type {any} */ (PrintableEditorData({ bundle: {} }));
    ed.id = 'guide';
    ed.viewDate = DATE;
    host.db = {
        collection() {
            return {
                doc() {
                    return { get: async () => { throw new Error('denied'); } };
                },
            };
        },
    };
    /** @type {any[]} */
    const seen = [];
    const orig = console.error;
    console.error = (/** @type {any} */ err) => { seen.push(err); };
    const realMigrate = host.PrintableLegacyMigrate;
    try {
        const bag = await ed.bookletBagFor('2026-09-13');
        assert.deepEqual(bag, {});
        assert.equal(seen.length, 1);
        assert.match(String(seen[0] && seen[0].message), /denied/);

        host.PrintableLegacyMigrate = {
            draftFromBag() { throw new Error('bad bag'); },
        };
        const row = ed.typedRowFor(DATE, { legacy_prayerNation: 'Kenya' });
        assert.deepEqual(row, {});
        assert.equal(seen.length, 2);
    } finally {
        console.error = orig;
        delete host.db;
        host.PrintableLegacyMigrate = realMigrate;
    }
});
