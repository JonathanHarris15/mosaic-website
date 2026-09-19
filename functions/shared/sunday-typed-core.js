// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/sunday-typed-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Sunday Typed Core — the weekly booklet text that lives on a Sunday
// (MS-481 / MS-588).
//
// Prayer-country facts, Mosaic Kids lesson, and announcements are typed
// once for a date and stored on `services/{YYYY-MM-DD}.typedContent`.
// Every Printable bound to that Sunday reads the same fields. Nothing
// here lives inside a box tree (ADR-0057: the Printable holds wires,
// not values).
//
// A week that still only has the old Service Guide filled in is read
// through as a fallback, so existing Sundays print without retyping.
// `typedContent` wins field-by-field once an editor saves here.
//
// Pure: no Firestore, no DOM. Browser global + Node export.

(function (global) {
    'use strict';

    function str(v) {
        if (v == null) return '';
        return String(v).trim();
    }

    function asStringList(value) {
        if (value == null || value === '') return [];
        if (typeof value === 'string') {
            return value.split(/\n/).map(s => s.trim()).filter(Boolean);
        }
        if (!Array.isArray(value)) return [];
        return value.map(it => {
            if (typeof it === 'string') return it.trim();
            if (it && typeof it === 'object') return str(it.text || it.content || it.title);
            return '';
        }).filter(Boolean);
    }

    function asAnnouncements(value) {
        if (value == null || value === '') return [];
        if (typeof value === 'string') {
            return value.split(/\n\s*\n/).map(block => {
                const lines = block.split('\n').map(s => s.trim()).filter(Boolean);
                return { title: lines[0] || '', content: lines.slice(1).join('\n') };
            }).filter(a => a.title || a.content);
        }
        if (!Array.isArray(value)) return [];
        return value.map(it => {
            if (typeof it === 'string') return { title: it.trim(), content: '' };
            if (!it || typeof it !== 'object') return null;
            const title = str(it.title);
            const content = str(it.content || it.text);
            return (title || content) ? { title: title, content: content } : null;
        }).filter(Boolean);
    }

    function imageUrl(value) {
        if (value == null || value === '') return '';
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'object') return str(value.url || value.dataUrl || value.src);
        return '';
    }

    // Country-map write policy (MS-591). File bytes go to Storage; the
    // Sunday record keeps an https URL. A pasted data URL that would
    // blow the Firestore 1MB cap is refused before write. https paste
    // stays valid. Matches the Storage rule on
    // sunday_typed/{date}/country_map/{fileId}.
    const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
    const MAX_DATA_URL_BYTES = 200 * 1024;
    const COUNTRY_MAP_STORAGE_PREFIX = 'sunday_typed';
    const OVERSIZE_DATA_URL_MSG = 'That country map is too large to keep in the Sunday record. Upload the image (it is stored in Storage) or paste an https URL.';
    const OVERSIZE_UPLOAD_MSG = 'That country map is too large to upload (max 8 MB). Choose a smaller image.';
    const NOT_IMAGE_MSG = 'The country map must be an image.';
    const NEED_HTTPS_MSG = 'Paste an https URL for the country map, or upload the image.';

    function isHttpsUrl(value) {
        return /^https:\/\//i.test(str(value));
    }

    function isDataUrl(value) {
        return /^data:/i.test(str(value));
    }

    function countryImageWriteError(value) {
        const url = imageUrl(value);
        if (!url) return '';
        if (isHttpsUrl(url)) return '';
        if (isDataUrl(url)) {
            return url.length > MAX_DATA_URL_BYTES ? OVERSIZE_DATA_URL_MSG : '';
        }
        return NEED_HTTPS_MSG;
    }

    function assertCountryImageWritable(value) {
        const err = countryImageWriteError(value);
        if (err) {
            const e = new Error(err);
            e.code = 'country-map-size';
            throw e;
        }
        return imageUrl(value);
    }

    function fileUploadError(file) {
        if (!file) return 'Choose a country map image.';
        if (file.type && !/^image\//.test(file.type)) return NOT_IMAGE_MSG;
        if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) return OVERSIZE_UPLOAD_MSG;
        return '';
    }

    function countryMapStoragePath(date, fileId) {
        const d = str(date);
        const id = str(fileId);
        if (!d || !id) return '';
        return COUNTRY_MAP_STORAGE_PREFIX + '/' + d + '/country_map/' + id;
    }

    function emptyPrayer() {
        return {
            nation: '', continent: '', capital: '', population: '',
            language: '', totalLanguages: '', literacy: '',
            christianPct: '', evangelicalPct: '', unevangelizedPct: '',
            countryImage: '', prompts: [],
        };
    }

    function emptyKids() {
        return { lessonTitle: '', lessonVerse: '', summary: [], questions: [] };
    }

    function empty() {
        return {
            pastoralPrayer: emptyPrayer(),
            mosaicKids: emptyKids(),
            announcements: [],
        };
    }

    function normalisePrayer(raw) {
        const p = raw && typeof raw === 'object' ? raw : {};
        return {
            nation: str(p.nation),
            continent: str(p.continent),
            capital: str(p.capital),
            population: str(p.population),
            language: str(p.language),
            totalLanguages: str(p.totalLanguages),
            literacy: str(p.literacy),
            christianPct: str(p.christianPct),
            evangelicalPct: str(p.evangelicalPct),
            unevangelizedPct: str(p.unevangelizedPct),
            countryImage: imageUrl(p.countryImage),
            prompts: asStringList(p.prompts),
        };
    }

    function normaliseKids(raw) {
        const k = raw && typeof raw === 'object' ? raw : {};
        return {
            lessonTitle: str(k.lessonTitle),
            lessonVerse: str(k.lessonVerse),
            summary: asStringList(k.summary),
            questions: asStringList(k.questions),
        };
    }

    function normalise(raw) {
        const r = raw && typeof raw === 'object' ? raw : {};
        return {
            pastoralPrayer: normalisePrayer(r.pastoralPrayer),
            mosaicKids: normaliseKids(r.mosaicKids),
            announcements: asAnnouncements(r.announcements),
        };
    }

    function pickFilled(primary, fallback) {
        return str(primary) || str(fallback);
    }

    function pickList(primary, fallback) {
        return primary && primary.length ? primary : (fallback || []);
    }

    function mergePreferFilled(primary, fallback) {
        const a = normalise(primary);
        const b = normalise(fallback);
        const ap = a.pastoralPrayer, bp = b.pastoralPrayer;
        const ak = a.mosaicKids, bk = b.mosaicKids;
        return {
            pastoralPrayer: {
                nation: pickFilled(ap.nation, bp.nation),
                continent: pickFilled(ap.continent, bp.continent),
                capital: pickFilled(ap.capital, bp.capital),
                population: pickFilled(ap.population, bp.population),
                language: pickFilled(ap.language, bp.language),
                totalLanguages: pickFilled(ap.totalLanguages, bp.totalLanguages),
                literacy: pickFilled(ap.literacy, bp.literacy),
                christianPct: pickFilled(ap.christianPct, bp.christianPct),
                evangelicalPct: pickFilled(ap.evangelicalPct, bp.evangelicalPct),
                unevangelizedPct: pickFilled(ap.unevangelizedPct, bp.unevangelizedPct),
                countryImage: pickFilled(ap.countryImage, bp.countryImage),
                prompts: pickList(ap.prompts, bp.prompts),
            },
            mosaicKids: {
                lessonTitle: pickFilled(ak.lessonTitle, bk.lessonTitle),
                lessonVerse: pickFilled(ak.lessonVerse, bk.lessonVerse),
                summary: pickList(ak.summary, bk.summary),
                questions: pickList(ak.questions, bk.questions),
            },
            announcements: pickList(a.announcements, b.announcements),
        };
    }

    function fromGuideValues(values) {
        const v = values && typeof values === 'object' ? values : {};
        return normalise({
            pastoralPrayer: {
                nation: v.pp_nation, continent: v.pp_continent, capital: v.pp_capital,
                population: v.pp_population, language: v.pp_language,
                totalLanguages: v.pp_total_languages, literacy: v.pp_literacy,
                christianPct: v.pp_christian, evangelicalPct: v.pp_evangelical,
                unevangelizedPct: v.pp_unevangelized, countryImage: v.pp_country_image,
                prompts: v.pp_prompts,
            },
            mosaicKids: {
                lessonTitle: v.kids_lesson_title, lessonVerse: v.kids_lesson_verse,
                summary: v.kids_summary, questions: v.kids_questions,
            },
            announcements: v.announcements,
        });
    }

    function elementOf(guide, type) {
        const els = guide && Array.isArray(guide.elements) ? guide.elements : [];
        return els.find(el => el && el.type === type) || null;
    }

    function fromLegacyGuide(guide) {
        const prayer = elementOf(guide, 'pastoral_prayer') || {};
        const kids = elementOf(guide, 'kids_section') || {};
        const ann = elementOf(guide, 'announcements') || {};
        return normalise({
            pastoralPrayer: {
                nation: prayer.nation, continent: prayer.continent, capital: prayer.capital,
                population: prayer.population, language: prayer.language,
                totalLanguages: prayer.totalLanguages, literacy: prayer.literacy,
                christianPct: prayer.christianPct, evangelicalPct: prayer.evangelicalPct,
                unevangelizedPct: prayer.unevangelizedPct, countryImage: prayer.countryImage,
                prompts: prayer.prompts,
            },
            mosaicKids: {
                lessonTitle: kids.lessonTitle, lessonVerse: kids.lessonVerse,
                summary: kids.summary, questions: kids.questions,
            },
            announcements: ann.items,
        });
    }

    // One Sunday's typed content. `typedContent` on the service wins
    // field-by-field; the old guide is only a fallback for that same date.
    function fromService(service) {
        const s = service && typeof service === 'object' ? service : null;
        if (!s) return empty();
        const stored = normalise(s.typedContent);
        const guide = s.guide || {};
        const fallback = guide.format === 'v2' || (guide.values && typeof guide.values === 'object')
            ? fromGuideValues(guide.values)
            : fromLegacyGuide(guide);
        return mergePreferFilled(stored, fallback);
    }

    function listText(list) {
        return (list || []).join('\n');
    }

    function announcementsText(items) {
        return (items || []).map(a => {
            const title = str(a && a.title);
            const content = str(a && a.content);
            if (title && content) return title + '\n' + content;
            return title || content;
        }).filter(Boolean).join('\n\n');
    }

    // The single row a Printable binds. Flat keys, no elder-only words.
    function toRow(content, date) {
        const c = normalise(content);
        const p = c.pastoralPrayer;
        const k = c.mosaicKids;
        return {
            _id: date || '',
            date: date || '',
            prayerNation: p.nation,
            prayerContinent: p.continent,
            prayerCapital: p.capital,
            prayerPopulation: p.population,
            prayerLanguage: p.language,
            prayerTotalLanguages: p.totalLanguages,
            prayerLiteracy: p.literacy,
            prayerChristian: p.christianPct,
            prayerEvangelical: p.evangelicalPct,
            prayerUnevangelized: p.unevangelizedPct,
            prayerPrompts: listText(p.prompts),
            prayerCountryImage: p.countryImage,
            kidsLessonTitle: k.lessonTitle,
            kidsLessonVerse: k.lessonVerse,
            kidsSummary: listText(k.summary),
            kidsQuestions: listText(k.questions),
            announcements: announcementsText(c.announcements),
            announcementCount: c.announcements.length,
        };
    }

    function fromDraft(draft) {
        const d = draft && typeof draft === 'object' ? draft : {};
        return normalise({
            pastoralPrayer: {
                nation: d.prayerNation, continent: d.prayerContinent, capital: d.prayerCapital,
                population: d.prayerPopulation, language: d.prayerLanguage,
                totalLanguages: d.prayerTotalLanguages, literacy: d.prayerLiteracy,
                christianPct: d.prayerChristian, evangelicalPct: d.prayerEvangelical,
                unevangelizedPct: d.prayerUnevangelized, countryImage: d.prayerCountryImage,
                prompts: d.prayerPrompts,
            },
            mosaicKids: {
                lessonTitle: d.kidsLessonTitle, lessonVerse: d.kidsLessonVerse,
                summary: d.kidsSummary, questions: d.kidsQuestions,
            },
            announcements: Array.isArray(d.announcements) ? d.announcements : d.announcementsText,
        });
    }

    function toDraft(content) {
        const row = toRow(content);
        return {
            prayerNation: row.prayerNation,
            prayerContinent: row.prayerContinent,
            prayerCapital: row.prayerCapital,
            prayerPopulation: row.prayerPopulation,
            prayerLanguage: row.prayerLanguage,
            prayerTotalLanguages: row.prayerTotalLanguages,
            prayerLiteracy: row.prayerLiteracy,
            prayerChristian: row.prayerChristian,
            prayerEvangelical: row.prayerEvangelical,
            prayerUnevangelized: row.prayerUnevangelized,
            prayerPrompts: row.prayerPrompts,
            prayerCountryImage: row.prayerCountryImage,
            kidsLessonTitle: row.kidsLessonTitle,
            kidsLessonVerse: row.kidsLessonVerse,
            kidsSummary: row.kidsSummary,
            kidsQuestions: row.kidsQuestions,
            announcements: (normalise(content).announcements.length
                ? normalise(content).announcements
                : [{ title: '', content: '' }]).map(a => ({ title: a.title, content: a.content })),
        };
    }

    function isBlank(content) {
        const row = toRow(content);
        return !row.prayerNation && !row.prayerContinent && !row.prayerCapital
            && !row.prayerPopulation && !row.prayerLanguage && !row.prayerTotalLanguages
            && !row.prayerLiteracy && !row.prayerChristian && !row.prayerEvangelical
            && !row.prayerUnevangelized && !row.prayerPrompts && !row.prayerCountryImage
            && !row.kidsLessonTitle && !row.kidsLessonVerse && !row.kidsSummary
            && !row.kidsQuestions && !row.announcements;
    }

    const FIELDS = [
        { key: 'prayerNation', label: 'Prayer country', kind: 'text' },
        { key: 'prayerContinent', label: 'Continent', kind: 'text' },
        { key: 'prayerCapital', label: 'Capital', kind: 'text' },
        { key: 'prayerPopulation', label: 'Population', kind: 'text' },
        { key: 'prayerLanguage', label: 'Official language', kind: 'text' },
        { key: 'prayerTotalLanguages', label: 'Total languages', kind: 'text' },
        { key: 'prayerLiteracy', label: 'Literacy', kind: 'text' },
        { key: 'prayerChristian', label: 'Christian', kind: 'text' },
        { key: 'prayerEvangelical', label: 'Evangelical', kind: 'text' },
        { key: 'prayerUnevangelized', label: 'Un-evangelized', kind: 'text' },
        { key: 'prayerPrompts', label: 'Prayer prompts', kind: 'text' },
        { key: 'prayerCountryImage', label: 'Country map', kind: 'image' },
        { key: 'kidsLessonTitle', label: 'Mosaic Kids lesson', kind: 'text' },
        { key: 'kidsLessonVerse', label: 'Mosaic Kids verse', kind: 'text' },
        { key: 'kidsSummary', label: 'Mosaic Kids summary', kind: 'text' },
        { key: 'kidsQuestions', label: 'Mosaic Kids questions', kind: 'text' },
        { key: 'announcements', label: 'Announcements', kind: 'text' },
        { key: 'announcementCount', label: 'Announcement count', kind: 'number' },
    ];

    const SundayTypedCore = {
        FIELDS,
        MAX_UPLOAD_BYTES,
        MAX_DATA_URL_BYTES,
        COUNTRY_MAP_STORAGE_PREFIX,
        OVERSIZE_DATA_URL_MSG,
        OVERSIZE_UPLOAD_MSG,
        empty,
        normalise,
        fromService,
        fromGuideValues,
        fromLegacyGuide,
        mergePreferFilled,
        toRow,
        fromDraft,
        toDraft,
        isBlank,
        asStringList,
        asAnnouncements,
        announcementsText,
        listText,
        imageUrl,
        isHttpsUrl,
        isDataUrl,
        countryImageWriteError,
        assertCountryImageWritable,
        fileUploadError,
        countryMapStoragePath,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SundayTypedCore;
    }
    if (global) {
        global.SundayTypedCore = SundayTypedCore;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
