// A read whose RESULT DECIDES A WRITE — a merge, a re-point, a batch of
// deletes. In the phone app ordinary reads are answered from the device
// (local-cache.js); these must not be. Stale input to a write does not show
// you old data, it destroys new data: a merge planned from a people list a
// minute old silently drops whoever was added in that minute. Ignored on the
// web, where reads were always live.
var FRESH_READ = { source: 'server' };

// ── Stepping Sunday to Sunday (MS-303) ──────────────────────────────────────
//
// The order of service is written one Sunday at a time, and at the service
// guide party it is written for eight Sundays in a row. Going back to the
// Services list between each one is the tax this removes.
//
// Both helpers below are pure so they can be tested without a browser: one
// decides whether the move may happen, the other says where it goes.

// Where the arrow points. The tab rides in the address bar because the step is
// a page load, and landing on the order of service when you were staffing Roles
// would undo the reason you pressed the arrow. 'order' is the default, so it is
// left out rather than written down.
function stepHref(date, options) {
    const opts = options || {};
    const params = new URLSearchParams({ date: date });
    if (opts.shell) params.set('shell', opts.shell);
    if (opts.tab && opts.tab !== 'order') params.set('tab', opts.tab);
    return 'service-builder.html?' + params.toString();
}

// Save, then move — or do not move.
//
// A page saves itself rather than asking (ADR-0032), so an arrow pressed
// mid-edit flushes the pending write instead of raising the browser's
// "leave site?" box. But a save that FAILED must not be walked away from: the
// work is still only in this tab, and the next screen would show no sign of it.
// So a failed save leaves you exactly where you were, with the error the page
// already raises.
//
// `go` is handed the target rather than returning it, because the caller
// replaces the current history entry rather than stacking one — back means
// "out to Services", never "undo my last arrow".
async function stepToService(move) {
    if (!move || !move.target) return false;
    if (move.canEdit && move.isDirty) {
        const saved = await move.save();
        if (!saved) return false;
    }
    move.go(move.target);
    return true;
}
const CANONICAL_MAPPING = {
    'Theme': { field: 'theme', type: 'text' },
    'Key Verse': { field: 'keyVerse', type: 'text' },
    'Service Leader': { field: 'serviceLeader', type: 'person' },
    'Music Leader': { field: 'musicLeader', type: 'person' },
    'Preacher': { field: 'preacher', type: 'person' },
    'Prayer (Praise)': { field: 'prayerPraise', type: 'person' },
    'Prayer (Confession)': { field: 'prayerConfession', type: 'person' },
    'Elements of the Service': { field: 'elements', type: 'person' },
    'Other Involvement': { field: 'other', type: 'person' },
    'Baptism': { field: 'baptism', type: 'text', liturgy: true },
    'Preparatory Hymn': { field: 'preparatoryHymn', type: 'hymn', liturgy: true },
    'Call to Worship': { field: 'callToWorship', type: 'text', liturgy: true },
    'Hymn 1': { field: 'hymn1', type: 'hymn', liturgy: true },
    'Hymn 2': { field: 'hymn2', type: 'hymn', liturgy: true },
    'Call to Confession': { field: 'callToConfession', type: 'text', liturgy: true },
    'Assurance of Pardon': { field: 'assuranceOfPardon', type: 'text', liturgy: true },
    'Hymn Mid 1': { field: 'hymnMid1', type: 'hymn', liturgy: true },
    'Hymn Mid 2': { field: 'hymnMid2', type: 'hymn', liturgy: true },
    'Scripture Reading': { field: 'scriptureReading', type: 'text', liturgy: true },
    'Pastoral Prayer': { field: 'scriptureReading', type: 'text', liturgy: true },
    'Prayer Male': { field: 'prayerMale', type: 'person', liturgy: true },
    'Prayer Female': { field: 'prayerFemale', type: 'person', liturgy: true },
    'Sermon': { field: 'sermon', type: 'text', liturgy: true },
    'Hymn End 1': { field: 'hymnEnd1', type: 'hymn', liturgy: true },
    'Hymn End 2': { field: 'hymnEnd2', type: 'hymn', liturgy: true },
    'Benediction': { field: 'benediction', type: 'text', liturgy: true }
};

// Normalize literal dotted-key fields (e.g. 'liturgy.sermon') created by older
// saves that used set() with merge, which stored them as top-level field names
// containing a dot rather than as nested paths. Returns a new object with such
// keys folded into nested objects. An already-nested value wins over a
// dotted-key value for the same leaf (the dotted key is the legacy fallback).
function normalizeDottedKeys(raw) {
    const data = {};
    for (const [key, val] of Object.entries(raw || {})) {
        if (!key.includes('.')) data[key] = val;
    }
    for (const [key, val] of Object.entries(raw || {})) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let obj = data;
            for (let i = 0; i < parts.length - 1; i++) {
                if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) {
                    obj[parts[i]] = {};
                }
                obj = obj[parts[i]];
            }
            const leaf = parts[parts.length - 1];
            if (!obj[leaf]) obj[leaf] = val;
        }
    }
    return data;
}

// The liturgy slots and note keys a save descends into one level, so an edit
// names the slot it touched rather than the whole map. Anything else nested
// (guide, irregularElements) is written whole — it is rebuilt wholesale by
// whoever owns it, so a partial write of it would mean less, not more.
const NESTED_SAVE_MAPS = ['liturgy', 'notes'];

// The editor's nested in-memory model, flattened to the shape the `services`
// document actually stores (name and id side by side rather than a ref object).
// Pure, and the same function is run over the loaded snapshot and over the
// current model, so `changedFieldPaths` gets two things it can compare
// like-for-like. The parts of a save that are not a function of the model —
// the timestamp, the guide record, involvementDeferred — are added by save().
function flattenServiceForSave(service) {
    const ref = (r) => (r && typeof r === 'object') ? r : { id: null, name: '' };
    const s = service || {};
    return {
        theme: s.theme,
        keyVerse: s.keyVerse,
        serviceLeader: ref(s.serviceLeader).name,
        serviceLeaderId: ref(s.serviceLeader).id,
        musicLeader: ref(s.musicLeader).name,
        musicLeaderId: ref(s.musicLeader).id,
        musicHelpers: (Array.isArray(s.musicHelpers) ? s.musicHelpers : [])
            .map(h => ({ name: h.name || '', id: h.id || null })),
        preacher: ref(s.preacher).name,
        preacherId: ref(s.preacher).id,
        prayerPraiseName: ref(s.prayerPraise).name,
        prayerPraiseId: ref(s.prayerPraise).id,
        prayerConfessionName: ref(s.prayerConfession).name,
        prayerConfessionId: ref(s.prayerConfession).id,
        elementsName: ref(s.elements).name,
        elementsId: ref(s.elements).id,
        otherName: ref(s.other).name,
        otherId: ref(s.other).id,
        hasBaptism: s.hasBaptism,
        removedHymns: s.removedHymns || [],
        isIrregular: s.isIrregular,
        irregularElements: s.irregularElements,
        notes: s.notes,
        liturgy: s.liturgy
    };
}

// What this editor actually changed, as Firestore dot-path field updates.
//
// This is what makes a Sunday safe to edit two-up. A save used to send every
// field it held, so a slot left blank on this screen overwrote the same slot
// another editor had just filled — the loser never saw it happen, because a
// stale blank is an ordinary write. Diffing first means an untouched slot is
// not in the write at all, and a race it never entered is a race it cannot
// lose.
//
// Descends exactly one level into the maps in NESTED_SAVE_MAPS and no further.
// A hymn is {id, name} chosen as one act, so the SLOT is the unit; splitting
// it could leave an id pointing at one hymn and a name reading another. Arrays
// are compared whole and replaced whole — a list is edited as a list.
function changedFieldPaths(before, after) {
    const same = (a, b) => JSON.stringify(a === undefined ? null : a) ===
                           JSON.stringify(b === undefined ? null : b);
    const update = {};

    for (const [key, val] of Object.entries(after || {})) {
        const prev = (before || {})[key];

        const nested = NESTED_SAVE_MAPS.includes(key)
            && val && typeof val === 'object' && !Array.isArray(val);

        if (!nested) {
            if (!same(prev, val)) update[key] = val;
            continue;
        }

        const prevMap = (prev && typeof prev === 'object') ? prev : {};
        for (const [slot, slotVal] of Object.entries(val)) {
            if (!same(prevMap[slot], slotVal)) update[`${key}.${slot}`] = slotVal;
        }
    }

    return update;
}

// A Person is one thing on screen and two fields in the document — the name
// and the id sit side by side rather than nested. This is the way back:
// document field -> [model key, leaf].
const PERSON_REF_PATHS = {
    serviceLeader:        ['serviceLeader', 'name'],
    serviceLeaderId:      ['serviceLeader', 'id'],
    musicLeader:          ['musicLeader', 'name'],
    musicLeaderId:        ['musicLeader', 'id'],
    preacher:             ['preacher', 'name'],
    preacherId:           ['preacher', 'id'],
    prayerPraiseName:     ['prayerPraise', 'name'],
    prayerPraiseId:       ['prayerPraise', 'id'],
    prayerConfessionName: ['prayerConfession', 'name'],
    prayerConfessionId:   ['prayerConfession', 'id'],
    elementsName:         ['elements', 'name'],
    elementsId:           ['elements', 'id'],
    otherName:            ['other', 'name'],
    otherId:              ['other', 'id']
};

// Fields that go into the document as they are.
const PLAIN_SAVE_FIELDS = [
    'theme', 'keyVerse', 'musicHelpers', 'hasBaptism', 'removedHymns',
    'isIrregular', 'irregularElements', 'notes', 'liturgy'
];

// Writes one dot-path field back into the editor's nested model — the inverse
// of flattenServiceForSave, and how another editor's change reaches this
// screen without a reload.
//
// A liturgy slot is mutated IN PLACE rather than replaced, because the hymn
// pickers hold a reference to the very object (see load(): "Preserve reference
// for components like hymnPicker"). Swapping it would leave the picker bound to
// an object no longer on the model, and the next thing you typed would go
// nowhere.
//
// Returns whether it recognised the path. An unknown one is ignored rather than
// guessed at: the document carries fields this editor does not own (guide,
// updatedAt, involvementDeferred), and inventing a home for them here would put
// junk on the model.
function applyFlatFieldPath(service, path, value) {
    if (!service || !path) return false;

    const dot = path.indexOf('.');
    if (dot !== -1) {
        const map = path.slice(0, dot);
        const slot = path.slice(dot + 1);
        if (!NESTED_SAVE_MAPS.includes(map)) return false;
        if (!service[map] || typeof service[map] !== 'object') service[map] = {};

        const current = service[map][slot];
        const bothPlainObjects =
            current && typeof current === 'object' && !Array.isArray(current) &&
            value && typeof value === 'object' && !Array.isArray(value);

        if (bothPlainObjects) {
            for (const key of Object.keys(current)) delete current[key];
            Object.assign(current, value);
        } else {
            service[map][slot] = value;
        }
        return true;
    }

    const ref = PERSON_REF_PATHS[path];
    if (ref) {
        const [key, leaf] = ref;
        if (!service[key] || typeof service[key] !== 'object') {
            service[key] = { id: null, name: '' };
        }
        service[key][leaf] = value;
        return true;
    }

    if (PLAIN_SAVE_FIELDS.includes(path)) {
        service[path] = value;
        return true;
    }

    return false;
}

// The document, reduced to the fields this editor actually owns. Everything
// else on a Service — the guide record, updatedAt, involvementDeferred — is
// written by somebody else and is not this screen's to adopt.
function pickSaveFields(docData) {
    const owned = Object.keys(flattenServiceForSave({}));
    const out = {};
    for (const key of owned) {
        if (docData && Object.prototype.hasOwnProperty.call(docData, key)) {
            out[key] = docData[key];
        }
    }
    return out;
}

// What this editor should take from a change that arrived while the page was
// open: every field the document now disagrees with our loaded snapshot about,
// EXCEPT the ones this editor has itself changed.
//
// That exception is the whole rule. A field you have touched is yours until you
// save it; a field you have not touched is not yours to hold, so somebody
// else's value simply arrives. Nothing merges and nothing is asked of anybody —
// the only case that could need a decision, two people in one box, is the case
// the box lock exists to prevent.
function remoteAdoptions(originalFlat, currentFlat, remoteDocData) {
    const mine = changedFieldPaths(originalFlat, currentFlat);
    const theirs = changedFieldPaths(originalFlat, pickSaveFields(remoteDocData));

    const adoptions = {};
    for (const [path, value] of Object.entries(theirs)) {
        if (Object.prototype.hasOwnProperty.call(mine, path)) continue;
        adoptions[path] = value;
    }
    return adoptions;
}

// Diffs two lists of Person references as SETS keyed by Person id, reporting
// which ids were added and which were removed. Entries without an id (no
// selected Person) are ignored, and a Person listed twice counts once.
// Shared by features that treat a list of people as a set across a save
// (Music Helpers, Baptism Candidates).
function personRefSetChanges(originalRefs, currentRefs) {
    const idSet = (list) => new Set((Array.isArray(list) ? list : []).map(r => r && r.id).filter(Boolean));
    const oldIds = idSet(originalRefs);
    const newIds = idSet(currentRefs);
    return {
        added: [...newIds].filter(id => !oldIds.has(id)),
        removed: [...oldIds].filter(id => !newIds.has(id))
    };
}

// Compares the previously-saved Music Helpers against the current helpers and
// reports which Persons gain a worship_helper involvement and which lose one.
function worshipHelperInvolvementChanges(originalHelpers, currentHelpers) {
    return personRefSetChanges(originalHelpers, currentHelpers);
}

// Parses a free-text baptism value into Baptism Candidate names. Splits on
// commas, ampersands, and the word "and". A segment is a confident candidate
// only when it reads as a First-Last name (two or more word tokens with no
// digits); anything else (a lone first name, digits, junk) sets needsReview so
// the migration's dry-run can flag it for a human rather than guessing.
function parseBaptismNames(value) {
    if (typeof value !== 'string') return { candidates: [], needsReview: false };
    const cleaned = value.trim();
    if (!cleaned || cleaned === '—' || /^(n\/?a|tbd|tba|none)$/i.test(cleaned)) {
        return { candidates: [], needsReview: false };
    }
    const segments = cleaned
        .split(/\s*[,;]\s*|\s*&\s*|\s+and\s+/i)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    const candidates = [];
    const reasons = [];
    for (const seg of segments) {
        if (/\d/.test(seg)) {
            reasons.push(`"${seg}" contains digits`);
        } else if (seg.split(' ').length >= 2) {
            candidates.push(seg);
        } else {
            reasons.push(`"${seg}" has no surname`);
        }
    }
    const result = { candidates, needsReview: reasons.length > 0 };
    if (reasons.length) result.reason = reasons.join('; ');
    return result;
}

// ADR-0006: liturgy.baptism is polymorphic during the migration — an array of
// Person refs post-migration, possibly a legacy free-text string until the
// migration runs. Coerce either shape to a clean array of { name, id } Baptism
// Candidates: array entries are normalised (name/id defaulted), a non-empty
// legacy string becomes a single literal candidate (id null) so it still
// displays, and anything else (empty, absent, blank) becomes [].
function coerceBaptismCandidates(bap) {
    if (Array.isArray(bap)) {
        return bap.map(c => ({ name: c.name || '', id: c.id || null }));
    }
    if (typeof bap === 'string' && bap.trim()) {
        return [{ name: bap.trim(), id: null }];
    }
    return [];
}

function serviceForm() {
    return {
        date: '',
        // When opened from the mobile shell (service-builder.html?shell=mobile),
        // the back link returns to the mobile app and the chrome gets phone polish.
        shell: null,
        saving: false,
        canEdit: false,
        isShepherd: false,
        currentPermissionLevel: 'viewer',
        // Which half of the Sunday is on screen — the liturgy, or who is
        // standing in its Roles (MS-16). Opens on the order of service, which is
        // what this page has always been.
        tab: 'order',
        // Latches on the first visit to the Roles tab and never clears. It is
        // what builds the panel — so nothing is fetched for somebody who never
        // opens it, and nothing is re-fetched for somebody who switches back and
        // forth. Switching tabs after that is only a matter of what is shown.
        rolesOpened: false,
        // Prayer Request per pastoral-prayer subject, visible to elders only.
        prayerRequests: {
            male: { text: '', initialSentDate: null, reminderSent: false, source: null, noteGenerated: false },
            female: { text: '', initialSentDate: null, reminderSent: false, source: null, noteGenerated: false },
        },
        prayerSending: { male: false, female: false },
        user: null,
        originalService: '',
        // The signed-in user as a Person, for the authorship tags (MS-246).
        me: null,
        // The liturgy element whose station row is currently expanded (one at a
        // time). null = every row collapsed. Drives the inline picker + note editor.
        openKey: null,
        showPrayerPraise: false,
        showPrayerConfession: false,
        _quill: null,
        _sortable: null,
        hymnRegistry: [],
        fuse: null,
        peopleRegistry: [],
        peopleFuse: null,
        service: {
            theme: '',
            keyVerse: '',
            serviceLeader: { name: '', id: null },
            musicLeader: { name: '', id: null },
            musicHelpers: [],
            preacher: { name: '', id: null },
            prayerPraise: { name: '', id: null },
            prayerConfession: { name: '', id: null },
            elements: { name: '', id: null },
            other: { name: '', id: null },
            isIrregular: false,
            irregularElements: [],
            hasBaptism: false,
            // Hymn slots the user has pulled out of the order of service. Each entry
            // is a liturgy field key (e.g. 'hymn2'). Removed hymns are kept in the
            // liturgy data but skipped by the service guide generator, which pads the
            // freed pages with extra sermon-notes pages instead.
            removedHymns: [],
            notes: {},
            liturgy: {
                preparatoryHymn: { id: null, name: '' },
                callToWorship: '',
                hymn1: { id: null, name: '' },
                hymn2: { id: null, name: '' },
                callToConfession: '',
                assuranceOfPardon: '',
                hymnMid1: { id: null, name: '' },
                hymnMid2: { id: null, name: '' },
                scriptureReading: '',
                prayerMale: { id: null, name: '' },
                prayerFemale: { id: null, name: '' },
                prayerLabel: 'Pastoral Prayer',
                sermon: '',
                baptism: [],
                hymnEnd1: { id: null, name: '' },
                hymnEnd2: { id: null, name: '' },
                benediction: ''
            }
        },

        // --- Person Creation Modal ---
        showPersonAddModal: false,
        personToAdd: { name: '', callback: null },
        duplicateWarning: false,

        // ── Service Guide system (ADR-0010) ────────────────────────────────────
        // The Order of Service editor chooses the week's Service Guide Template, or
        // toggles back to the legacy generator. The chosen template's builder-
        // surface section components (baptism, pastoral-prayer subjects) decide
        // which template-driven sections this page prompts.
        guideSystem: 'v2',                  // 'v2' | 'legacy'
        // Whether this week has opted into the new guide controls. False for a week
        // that predates ADR-0010 (no stored guideSystem, no v2 guide) and hasn't been
        // touched this session — so opening + re-saving such a week never silently
        // flips guideSystem, derives hasBaptism, or freezes a v2 guide record (which
        // would, e.g., clear an existing baptism's baptismDate). Set true on load for
        // an already-v2 week, and when the editor toggles legacy or picks a template.
        _guideEngaged: false,
        guideCatalogLoaded: false,
        guideTemplates: [],
        _pageTemplatesById: {},
        _stylePresetsById: {},
        selectedTemplateId: '',
        guideSnapshot: null,

        get useLegacySystem() { return this.guideSystem === 'legacy'; },
        get _guideCatalog() { return (window.GuideComponents && window.GuideComponents.defaultCatalog) || null; },
        // The bespoke Builder sections the chosen template requests (null in legacy
        // mode, where the static form shows everything).
        get _builderSections() {
            if (this.guideSystem === 'legacy' || !this.guideSnapshot || !window.GuideStore) return null;
            return GuideStore.builderSections(this.guideSnapshot, this._guideCatalog);
        },
        // Baptism: legacy uses the "Include Baptism?" checkbox; v2 derives presence
        // from whether the template places the baptism component.
        get showBaptismSection() {
            if (this.guideSystem === 'legacy') return !!this.service.hasBaptism;
            return !!(this._builderSections && this._builderSections.includes('baptism'));
        },
        // Pastoral-prayer subjects (the two prayed-for members + their request
        // texts): always in legacy. In v2 they show unless the chosen template uses
        // congregational prayer, which omits them (ADR-0010). Stated as "not
        // congregational" rather than "has pastoral-prayer-subjects" so a template
        // seeded before this system still shows subjects rather than hiding them.
        get showPrayerSubjects() {
            if (this.guideSystem === 'legacy') return true;
            const sections = this._builderSections;
            if (!sections) return true;
            return !sections.includes('congregational-prayer');
        },

        async loadGuideCatalog() {
            if (!window.GuideStore) return;
            try {
                let data = await GuideStore.loadCatalog(db);
                if (!data.guideTemplates.length && this.canEdit) {
                    await GuideStore.seedAll(db, this._guideCatalog);
                    data = await GuideStore.loadCatalog(db);
                }
                this.guideTemplates = data.guideTemplates;
                this._pageTemplatesById = GuideStore.indexById(data.pageTemplates);
                this._stylePresetsById = GuideStore.indexById(data.stylePresets);
                this.guideCatalogLoaded = true;
                const savedId = (this.service.guide && this.service.guide.guideTemplateId) || '';
                this.selectedTemplateId = savedId || this._defaultTemplateId();
                this._rebuildSnapshot(false);
            } catch (e) {
                console.error('Failed to load the Service Guide catalog:', e);
            }
        },
        _defaultTemplateId() {
            const d = this.guideTemplates.find(t => t.isDefault) || this.guideTemplates[0];
            return d ? d.id : '';
        },
        // Build the snapshot of the selected template (gates the template-driven
        // sections). On a user action (deriveBaptism=true) it also reflects the
        // template's baptism presence into service.hasBaptism so the section and the
        // OOS list update immediately; on initial load it leaves stored data alone.
        _rebuildSnapshot(deriveBaptism) {
            const gt = this.guideTemplates.find(t => t.id === this.selectedTemplateId);
            this.guideSnapshot = gt
                ? GuideStore.buildSnapshot(gt, this._pageTemplatesById, this._stylePresetsById)
                : null;
            if (deriveBaptism && this.guideSystem === 'v2') {
                this.service.hasBaptism = !!(this.guideSnapshot &&
                    GuideStore.templateIncludesBaptism(this.guideSnapshot, this._guideCatalog));
            }
        },
        changeGuideTemplate(id) {
            if (!id || id === this.selectedTemplateId) return;
            this._guideEngaged = true;
            this.selectedTemplateId = id;
            this._rebuildSnapshot(true);
        },
        setUseLegacy(useLegacy) {
            this._guideEngaged = true;
            this.guideSystem = useLegacy ? 'legacy' : 'v2';
            if (this.guideSystem === 'v2') {
                if (!this.selectedTemplateId) this.selectedTemplateId = this._defaultTemplateId();
                this._rebuildSnapshot(true);
            }
        },
        // The single shared routing rule (calendar + this page never drift).
        guideGenerateHref() {
            if (!window.GuideStore) return 'service-guide.html?date=' + encodeURIComponent(this.date);
            return GuideStore.guideHref({ guideSystem: this.guideSystem, guide: this.service.guide }, this.date);
        },

        // --- Hymn Preview ---
        showHymnPreview: false,
        previewHymnData: null,
        previewLoading: false,

        async previewHymn(id) {
            if (!id) return;
            this.previewLoading = true;
            this.showHymnPreview = true;
            try {
                const doc = await db.collection('hymns').doc(id).get();
                if (doc.exists) {
                    this.previewHymnData = doc.data();
                } else {
                    console.error("Hymn not found:", id);
                    this.showHymnPreview = false;
                }
            } catch (err) {
                console.error("Error fetching hymn for preview:", err);
                this.showHymnPreview = false;
            } finally {
                this.previewLoading = false;
            }
        },

        closeHymnPreview() {
            this.showHymnPreview = false;
            this.previewHymnData = null;
        },

        // --- Pastoral Prayer Suggestions ---
        prayerSuggestions: { males: [], females: [] },

        async fetchPrayerSuggestions() {
            try {
                const now = new Date();
                const todayStr = DateUtils.toDateStr(now);

                // Fetch all members and sort locally to avoid composite index requirements
                const snap = await db.collection('people')
                    .where('tags', 'array-contains', 'Member')
                    .get();
                
                const members = snap.docs.map(d => ({ id: d.id, ...d.data() }));

                const getTop3 = (sex) => PrayerSuggestions.topPrayerCandidates(members, sex, todayStr, 3);

                this.prayerSuggestions = {
                    males: getTop3('male'),
                    females: getTop3('female')
                };
            } catch (err) {
                console.error("Error fetching prayer suggestions:", err);
            }
        },

        promptAddPerson(name, callback) {
            this.personToAdd = { name, callback };
            this.showPersonAddModal = true;
            this.duplicateWarning = false;
            
            // Check for exact duplicates immediately
            this.checkDuplicatePerson(name);
        },

        async checkDuplicatePerson(name) {
            if (!name) return;
            try {
                const snap = await db.collection('people')
                    .where('name', '==', name)
                    .limit(1).get();
                this.duplicateWarning = !snap.empty;
            } catch (err) {
                console.error("Error checking duplicates:", err);
            }
        },

        async confirmAddPerson() {
            if (!this.personToAdd.name) return;
            this.saving = true;
            try {
                const docRef = await db.collection('people').add({
                    name: this.personToAdd.name,
                    totalInvolvements: 0,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                const newPerson = { id: docRef.id, name: this.personToAdd.name };
                if (this.peopleRegistry) {
                    this.peopleRegistry.push(newPerson);
                    if (this.peopleFuse) {
                        this.peopleFuse.setCollection(this.peopleRegistry);
                    }
                }
                if (this.personToAdd.callback) {
                    this.personToAdd.callback(newPerson);
                }
                this.showPersonAddModal = false;
            } catch (err) {
                console.error("Error adding person:", err);
                alert("Failed to add person.");
            } finally {
                this.saving = false;
            }
        },

        get isDirty() {
            return this.originalService !== JSON.stringify(this.service);
        },

        // This Sunday as an Event occurrence, which is what the Roles tab mounts
        // (MS-16). A Sunday nobody has staffed yet has no occurrence document —
        // occurrences are sparse — and that is fine: the id is deterministic, so
        // EventsStore rebuilds the occurrence from it and writes a document the
        // first time somebody is actually put in a slot.
        get sundayOccurrenceId() {
            return window.EventsOccurrenceCore
                ? window.EventsOccurrenceCore.occurrenceId(
                    window.EventsOccurrenceCore.SUNDAY_SERVICE_ID, this.date)
                : null;
        },

        // ── The arrows beside the date (MS-303) ─────────────────────────────
        //
        // Which Sunday is next is not this page's opinion — ServiceDatesCore
        // owns the range, and the Services list draws its rows from the same
        // answer. Null at either end, which is what greys the arrow out.
        get previousServiceDate() {
            return window.ServiceDatesCore
                ? ServiceDatesCore.previous(this.date, DateUtils.todayStr())
                : null;
        },

        get nextServiceDate() {
            return window.ServiceDatesCore
                ? ServiceDatesCore.next(this.date, DateUtils.todayStr())
                : null;
        },

        // `stepping` is held from the press until the page actually leaves, so
        // a slow save cannot be double-clicked into two navigations. It is only
        // released when the move was refused — otherwise this page is on its
        // way out and the flag goes with it.
        stepping: false,

        async stepService(direction) {
            if (this.stepping) return false;
            const target = direction < 0 ? this.previousServiceDate : this.nextServiceDate;
            if (!target) return false;

            this.stepping = true;
            let moved = false;
            try {
                moved = await stepToService({
                    target: target,
                    canEdit: this.canEdit,
                    isDirty: this.isDirty,
                    // Manual, so a failure is answered rather than swallowed:
                    // you asked to leave, so you are owed the reason you cannot.
                    save: () => this.save(true),
                    go: (date) => window.location.replace(
                        stepHref(date, { shell: this.shell, tab: this.tab })),
                });
            } finally {
                // Released only when the move was refused — otherwise this page
                // is on its way out and the flag goes with it. In `finally` so a
                // save that THROWS gives the arrows back too, rather than
                // leaving both dead until reload.
                if (!moved) this.stepping = false;
            }
            return moved;
        },

        openTab(key) {
            this.tab = key;
            // Latch on the way in, not on a watcher, so the panel is built by
            // the tap that asked for it. If `date` has not landed yet the
            // template simply waits for it rather than building a panel pointed
            // at no Sunday.
            if (key === 'roles') this.rolesOpened = true;
        },

        // The shell's back arrow, answered by the page (MS-16). A tab is not a
        // place you navigate to, so backing out of Roles should land on the
        // order of service, not throw you out of the Sunday altogether. Only
        // once there is nothing left to back out of does it leave the page.
        //
        // Same rule the Roles Manager follows for the Role it has open.
        listenForShellBack() {
            if (typeof document === 'undefined' || !document.addEventListener) return;
            document.addEventListener('mobile-header:back', () => {
                if (this.tab !== 'order') {
                    this.tab = 'order';
                    return;
                }
                window.location.href = 'mobile.html#/calendar';
            });
        },

        async init() {
            this.listenForShellBack();
            auth.onAuthStateChanged(async (user) => {
                this.user = user;
                if (user) {
                    try {
                        const userData = await getUserData(user.uid);
                        const permissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                        this.currentPermissionLevel = permissionLevel;
                        this.canEdit = (['editor', 'elder', 'admin', 'super_admin'].includes(permissionLevel));
                        this.isShepherd = ['elder', 'super_admin'].includes(permissionLevel);
                        // Who this is, as a Person — stamped onto every element
                        // they decide (MS-246).
                        this.me = await MosaicIdentity.me({ db, getUserData, uid: user.uid });
                        this.loadPrayerRequests();
                    } catch (error) {
                        console.error("Error checking user permissions:", error);
                        this.canEdit = false;
                    }

                    // ⚠ OUTSIDE THE TRY, AND LAST.
                    //
                    // The catch above turns any failure into "you may not
                    // edit" — the right answer for a permissions read, and a
                    // disaster for anything else that happens to be in the same
                    // block. Presence was in it, and one throw made the whole
                    // page read-only with nothing on screen to say why. Being
                    // unable to see who else is here is not a reason to stop
                    // somebody working.
                    if (this.canEdit) this.watchPresence();
                } else {
                    this.canEdit = false;
                }
            });

            const urlParams = new URLSearchParams(window.location.search);
            this.date = urlParams.get('date');
            this.shell = urlParams.get('shell');
            if (this.shell === 'mobile') document.body.classList.add('shell-mobile');
            if (!this.date) {
                window.location.href = this.shell === 'mobile' ? 'mobile.html#/calendar' : 'service-calendar.html';
                return;
            }
            await this.load();
            await this.loadGuideCatalog();
            await this.loadHymnRegistry();
            await this.loadPeopleRegistry();
            // Carried across a step so staffing several Sundays in a row does
            // not mean re-opening Roles each time (MS-303).
            //
            // After loadPeopleRegistry, not just after load(). The Roles panel
            // is handed `people: peopleRegistry` once, when Alpine first builds
            // it, and loadPeopleRegistry REPLACES that array rather than filling
            // it. Latch the tab any earlier and the panel keeps the empty list
            // it was born with: a Roles tab you cannot put anybody into.
            if (urlParams.get('tab') === 'roles') this.openTab('roles');
            await this.loadPrayerRequests();
            await this.autoLinkHymns();
            await this.fetchPrayerSuggestions();
            this.watchForChanges();
            // After watchForChanges, so the snapshot that arrives immediately
            // on subscribing finds originalService already settled by load().
            this.watchRemoteChanges();

            if (urlParams.get('validate') === 'true') {
                this.validateForm();
            }

            window.addEventListener('beforeunload', (e) => {
                // Not while stepping. The arrow has already flushed the save and
                // is on its way to the next Sunday; a keystroke landing in that
                // gap would otherwise raise the browser box this page exists to
                // avoid (ADR-0032).
                if (this.stepping) return;
                if (this.canEdit && this.isDirty) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });

            if (this.service.isIrregular) {
                this.$nextTick(() => this.initSortable());
            }
        },

        // Shared with the Planning view on the Service Calendar (MS-245), so
        // both screens offer the same hymns for the same typing. See
        // hymn-registry.js.
        async loadHymnRegistry() {
            const index = await HymnRegistry.load({
                getHymnIndex: firebase.app().functions('us-central1').httpsCallable('getHymnIndex'),
                db: db,
                Fuse: typeof Fuse !== 'undefined' ? Fuse : null
            });
            this.hymnRegistry = index.hymns;
            this.fuse = index.fuse;
        },

        async loadPeopleRegistry() {
            try {
                const snap = await db.collection('people').get();
                this.peopleRegistry = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                if (typeof Fuse !== 'undefined') {
                    try {
                        this.peopleFuse = new Fuse(this.peopleRegistry, {
                            keys: ['name'],
                            threshold: 0.4,
                            distance: 100,
                            minMatchCharLength: 1
                        });
                    } catch (fuseErr) {
                        console.error("Error creating Fuse instance for people:", fuseErr);
                    }
                }
            } catch (error) {
                console.error("Error loading people registry:", error);
            }
        },

        async autoLinkHymns() {
            if (!this.fuse || !this.hymnRegistry || this.hymnRegistry.length === 0) return;

            let updated = false;
            const hymnFields = [
                'preparatoryHymn', 'hymn1', 'hymn2', 'hymnMid1', 'hymnMid2', 'hymnEnd1', 'hymnEnd2'
            ];

            for (const field of hymnFields) {
                const hymn = this.service.liturgy[field];
                if (hymn && hymn.name && !hymn.id) {
                    // Try to find a match
                    const results = this.fuse.search(hymn.name);
                    if (results.length > 0) {
                        const topMatch = results[0];
                        // If it's a very high confidence match (threshold 0.3 is current, let's say < 0.1 for auto-link)
                        // Or if names match exactly (case insensitive)
                        const isExactMatch = topMatch.item.hymn_name.toLowerCase() === hymn.name.toLowerCase();
                        const isHighConfidence = topMatch.score < 0.1;

                        if (isExactMatch || isHighConfidence) {
                            console.log(`Auto-linking literal hymn "${hymn.name}" to canonical "${topMatch.item.hymn_name}" (ID: ${topMatch.item.id})`);
                            hymn.id = topMatch.item.id;
                            hymn.name = topMatch.item.hymn_name;
                            updated = true;
                        }
                    }
                }
            }

            if (updated && this.canEdit) {
                // We should save the service to persist these links
                console.log("Saving service after auto-linking hymns...");
                await this.save();
            }
        },

        async load() {
            const doc = await db.collection('services').doc(this.date).get();
            // A save writes dot-path field updates, which only update() honours —
            // set(merge) would store 'liturgy.hymn1' as a field name with a dot in
            // it. update() refuses a document that is not there, so the first save
            // of a never-saved Sunday writes the whole thing with set() instead.
            // Nothing can be racing a document that does not exist yet.
            this._docExists = doc.exists;
            if (doc.exists) {
                const raw = doc.data();

                // Fold legacy dotted-key fields (e.g. 'liturgy.sermon') back into
                // nested objects. See normalizeDottedKeys.
                const data = normalizeDottedKeys(raw);
                // Update top-level properties
                this.service.theme = data.theme || '';
                this.service.keyVerse = data.keyVerse || '';
                this.service.isIrregular = data.isIrregular || false;
                this.service.irregularElements = data.irregularElements || [];
                
                this.service.serviceLeader.name = data.serviceLeader || '';
                this.service.serviceLeader.id = data.serviceLeaderId || null;
                this.service.musicLeader.name = data.musicLeader || '';
                this.service.musicLeader.id = data.musicLeaderId || null;
                this.service.musicHelpers = Array.isArray(data.musicHelpers)
                    ? data.musicHelpers.map(h => ({ name: h.name || '', id: h.id || null }))
                    : [];
                this.service.preacher.name = data.preacher || '';
                this.service.preacher.id = data.preacherId || null;
                
                this.service.prayerPraise.name = data.prayerPraiseName || '';
                this.service.prayerPraise.id = data.prayerPraiseId || null;
                this.service.prayerConfession.name = data.prayerConfessionName || '';
                this.service.prayerConfession.id = data.prayerConfessionId || null;

                this.service.elements.name = data.elementsName || '';
                this.service.elements.id = data.elementsId || null;
                this.service.other.name = data.otherName || '';
                this.service.other.id = data.otherId || null;

                // Auto-show prayer pickers if they have data
                if (this.service.prayerPraise.id) this.showPrayerPraise = true;
                if (this.service.prayerConfession.id) this.showPrayerConfession = true;

                this.service.hasBaptism = data.hasBaptism || false;
                this.service.removedHymns = Array.isArray(data.removedHymns) ? data.removedHymns : [];
                this.service.notes = data.notes || {};
                
                // Update liturgy properties
                if (data.liturgy) {
                    for (const key in data.liturgy) {
                        if (this.service.liturgy.hasOwnProperty(key)) {
                            const val = data.liturgy[key];
                            if (val && typeof val === 'object' && !Array.isArray(val)) {
                                // Preserve reference for components like hymnPicker
                                Object.assign(this.service.liturgy[key], val);
                            } else {
                                this.service.liturgy[key] = val;
                            }
                        }
                    }
                }
                // Normalize Baptism Candidates to an array of Person refs. A legacy
                // free-text value (pre-migration) is wrapped as a single literal
                // candidate so it still displays; the migration resolves it properly.
                this.service.liturgy.baptism = coerceBaptismCandidates(this.service.liturgy.baptism);
                // Who decided each element (MS-246). Read-only on this page —
                // it is written by the save, never edited directly — so it is
                // kept off flattenServiceForSave and moved by hand.
                this.service[ServiceAuthorship.FIELD] = data[ServiceAuthorship.FIELD] || {};
                // Store guide data to preserve/update it during save
                this.service.guide = data.guide || null;
                // Which Service Guide system this week is on (ADR-0010): explicit
                // toggle, else legacy for a pre-existing elements blob, else v2.
                if (window.GuideStore) {
                    this.guideSystem = GuideStore.guideSystemOf(data);
                    // A week is already "engaged" only if it explicitly stored a
                    // guideSystem or already carries a v2 guide; a pre-ADR-0010 week
                    // that merely defaults to v2 stays un-engaged until the editor
                    // touches the new controls (guards the destructive save paths).
                    this._guideEngaged = (typeof data.guideSystem === 'string') || GuideStore.isV2Guide(data.guide);
                }
            }
            this.originalService = JSON.stringify(this.service);
        },

        // ── Prayer Requests (pastoral-prayer subjects) ─────────────────────────
        // Elder/super-admin only. Each subject's Prayer Request and send-state
        // live on people/{id}/prayer_requests/{serviceDate} — a separate record
        // from the pastoral_prayer_history entry that says they were a subject
        // at all, because a request is sensitive and the history is not.

        subjectFor(which) {
            return which === 'male' ?
                this.service.liturgy.prayerMale : this.service.liturgy.prayerFemale;
        },

        // A Prayer Request is read far more often than it is typed, and a texted
        // reply can arrive at any length — so the box grows to its whole content
        // rather than hiding it behind a two-row scroll.
        autoResize(el) {
            if (!el) return;
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
        },

        async loadPrayerRequests() {
            if (!this.isShepherd || !this.date) return;
            for (const which of ['male', 'female']) {
                const subject = this.subjectFor(which);
                const blank = { text: '', initialSentDate: null, reminderSent: false, source: null, noteGenerated: false };
                if (!subject || !subject.id) { this.prayerRequests[which] = blank; continue; }
                try {
                    const snap = await db.collection('people').doc(subject.id)
                        .collection('prayer_requests').doc(this.date).get();
                    const d = snap.exists ? snap.data() : {};
                    this.prayerRequests[which] = {
                        text: d.prayerRequest || '',
                        initialSentDate: d.initialSentDate || null,
                        reminderSent: !!d.reminderSent,
                        source: d.prayerRequestSource || null,
                        noteGenerated: !!d.noteGenerated,
                    };
                } catch (e) {
                    console.error('Error loading prayer request:', e);
                }
            }
        },

        prayerRequestStatus(which) {
            const subject = this.subjectFor(which);
            if (!subject || !subject.id) return '';
            const s = this.prayerRequests[which];
            if ((s.text || '').trim()) return s.source === 'reply' ? 'Replied' : 'Filled in';
            const person = this.peopleRegistry.find(p => p.id === subject.id);
            const phone = person && person.contact ? (person.contact.phone || '') : '';
            if (phone.replace(/\D/g, '').length < 10) return 'No phone on file';
            if (s.reminderSent) return 'Reminder sent — awaiting reply';
            if (s.initialSentDate) return 'Text sent — awaiting reply';
            return 'Not sent yet';
        },

        async savePrayerRequest(which) {
            if (!this.isShepherd) return;
            const subject = this.subjectFor(which);
            if (!subject || !subject.id) {
                alert('Save the service with this person selected before adding a prayer request.');
                return;
            }
            const state = this.prayerRequests[which];
            const text = (state.text || '').trim();
            const personRef = db.collection('people').doc(subject.id);
            const reqRef = personRef.collection('prayer_requests').doc(this.date);
            const now = firebase.firestore.FieldValue.serverTimestamp();

            try {
                await reqRef.set({
                    serviceDate: this.date,
                    prayerRequest: text,
                    prayerRequestSource: state.source === 'reply' ? 'reply' : 'elder',
                    requestFilledAt: now,
                }, { merge: true });

                // Generate the Shepherding Note once, on the first non-empty save.
                if (text && !state.noteGenerated) {
                    await personRef.collection('shepherding_notes').add({
                        type: 'Prayer Request',
                        subject: `Prayer Request — ${this.date}`,
                        content: text,
                        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
                        authorName: (this.user && this.user.email) || 'Elder',
                        authorUid: (this.user && this.user.uid) || null,
                        createdAt: now,
                    });
                    await reqRef.update({ noteGenerated: true });
                    state.noteGenerated = true;
                }
                alert('Prayer request saved.');
            } catch (e) {
                console.error('Error saving prayer request:', e);
                alert('Error saving prayer request. Check console.');
            }
        },

        // Whether the manual "Send Now" button can fire: a subject with a phone
        // whose request isn't filled yet (mirrors the server's hard guards).
        canSendPrayerText(which) {
            const subject = this.subjectFor(which);
            if (!subject || !subject.id) return false;
            if ((this.prayerRequests[which].text || '').trim()) return false;
            const person = this.peopleRegistry.find(p => p.id === subject.id);
            const phone = person && person.contact ? (person.contact.phone || '') : '';
            return phone.replace(/\D/g, '').length >= 10;
        },

        prayerSendTitle(which) {
            const subject = this.subjectFor(which);
            if (!subject || !subject.id) return 'Select this person and save first';
            if ((this.prayerRequests[which].text || '').trim()) return 'Already filled — nothing to send';
            if (!this.canSendPrayerText(which)) return 'No phone number on file';
            return 'Text this person to ask for their prayer request';
        },

        async sendPrayerRequestNow(which) {
            const subject = this.subjectFor(which);
            if (!subject || !subject.id || !this.canSendPrayerText(which)) return;
            if (!this.date) { alert('Save the service first.'); return; }
            this.prayerSending[which] = true;
            try {
                const fn = firebase.app().functions('us-central1').httpsCallable('sendPrayerRequestNow');
                const { data } = await fn({ serviceDate: this.date, personId: subject.id });
                // Reflect the new send-state without a full reload.
                if (data.kind === 'initial') {
                    this.prayerRequests[which].initialSentDate = this.date;
                } else if (data.kind === 'reminder') {
                    this.prayerRequests[which].reminderSent = true;
                }
                alert(`${data.kind === 'reminder' ? 'Reminder' : 'Initial request'} text sent to ${subject.name}.`);
            } catch (e) {
                console.error('Error sending prayer request text:', e);
                alert(e.message || 'Could not send the text.');
            } finally {
                this.prayerSending[which] = false;
            }
        },

        toggleIrregular() {
            if (!this.service.isIrregular) {
                // Toggling TO Irregular: Flatten existing fields
                const elements = [];
                // Add in a logical order
                const orderedKeys = [
                    'Theme', 'Key Verse', 'Service Leader', 'Music Leader', 'Preacher',
                    'Prayer (Praise)', 'Prayer (Confession)', 'Baptism', 'Preparatory Hymn', 'Call to Worship',
                    'Hymn 1', 'Hymn 2', 'Call to Confession', 'Assurance of Pardon', 'Hymn Mid 1', 'Hymn Mid 2',
                    'Pastoral Prayer', 'Sermon', 'Hymn End 1', 'Hymn End 2', 'Benediction'
                ];

                for (const key of orderedKeys) {
                    const mapping = CANONICAL_MAPPING[key];
                    if (!mapping) continue;

                    let value;
                    if (mapping.liturgy) {
                        value = this.service.liturgy[mapping.field];
                    } else {
                        value = this.service[mapping.field];
                    }
                    
                    // Only add if it has content OR is a primary role
                    const hasContent = (typeof value === 'object') ? (value && (value.name || value.id)) : value;
                    if (hasContent || ['Service Leader', 'Music Leader', 'Preacher'].includes(key)) {
                        elements.push({ 
                            key, 
                            value: value ? JSON.parse(JSON.stringify(value)) : (mapping.type === 'text' ? '' : {name:'', id:null}), 
                            type: mapping.type 
                        });
                    }
                }
                this.service.irregularElements = elements;
                this.service.isIrregular = true;
                this.$nextTick(() => this.initSortable());
            } else {
                // Toggling BACK to Regular: Sync back what we can
                if (confirm('Toggle back to Regular service? Custom elements will be hidden but preserved in the database.')) {
                    this.service.irregularElements.forEach(el => {
                        const mapping = CANONICAL_MAPPING[el.key];
                        if (mapping) {
                            if (mapping.liturgy) {
                                this.service.liturgy[mapping.field] = JSON.parse(JSON.stringify(el.value));
                            } else {
                                this.service[mapping.field] = JSON.parse(JSON.stringify(el.value));
                            }
                        }
                    });
                    this.service.isIrregular = false;
                }
            }
        },

        addBlankElement() {
            this.service.irregularElements.push({ key: '', value: '', type: 'text' });
        },

        removeElement(index) {
            this.service.irregularElements.splice(index, 1);
        },

        onElementKeyChange(el) {
            const mapping = CANONICAL_MAPPING[el.key];
            if (mapping) {
                // Check if this canonical element already exists elsewhere
                const existing = this.service.irregularElements.filter(e => e.key === el.key);
                if (existing.length > 1) {
                    alert(`Hey, the "${el.key}" element already exists!`);
                    el.key = '';
                    return;
                }
                el.type = mapping.type;
                // Initialize value structure if needed
                if (el.type === 'person' || el.type === 'hymn') {
                    if (typeof el.value !== 'object' || el.value === null) {
                        el.value = { name: '', id: null };
                    }
                } else if (el.type === 'text') {
                    if (typeof el.value === 'object') el.value = '';
                }
            } else {
                el.type = 'text'; // Default for custom keys
            }
        },

        initSortable() {
            const el = document.getElementById('irregular-elements-list');
            if (!el || !window.Sortable) return;
            
            if (this._sortable) this._sortable.destroy();
            
            this._sortable = Sortable.create(el, {
                handle: '.drag-handle',
                animation: 150,
                onEnd: (evt) => {
                    const item = this.service.irregularElements.splice(evt.oldIndex, 1)[0];
                    this.service.irregularElements.splice(evt.newIndex, 0, item);
                }
            });
        },

        async validateForm() {
            this.$nextTick(() => {
                if (this.service.isIrregular) {
                    // Simpler validation for irregular services?
                    // For now, just check if it's empty
                    if (this.service.irregularElements.length === 0) {
                        alert('Irregular service must have at least one element.');
                        return;
                    }
                    return;
                }
                const roleFields = ['serviceLeader', 'musicLeader', 'preacher'];
                let liturgyFields = [
                    'preparatoryHymn', 'callToWorship', 'hymn1', 
                    'callToConfession', 'assuranceOfPardon', 'hymnMid2', 
                    'scriptureReading', 'sermon', 'hymnEnd1', 'hymnEnd2', 'benediction'
                ];

                if (this.service.hasBaptism) {
                    liturgyFields.push('baptism');
                } else {
                    liturgyFields.push('hymn2');
                    liturgyFields.push('hymnMid1');
                }

                const highlight = (key) => {
                    const section = document.querySelector(`[data-field-key="${key}"]`);
                    if (section) {
                        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        section.classList.add('ring-2', 'ring-red-500', 'ring-offset-2');
                        setTimeout(() => {
                            section.classList.remove('ring-2', 'ring-red-500', 'ring-offset-2');
                        }, 3000);
                        return true;
                    }
                    return false;
                };

                // 1. Check Roles
                for (const key of roleFields) {
                    const val = this.service[key];
                    if (!val || !val.name) {
                        if (highlight(key)) return;
                    }
                }

                // 2. Check Liturgy
                for (const key of liturgyFields) {
                    // A hymn pulled out of the order of service is intentionally blank.
                    if (this.isHymnRemoved(key)) continue;
                    if (key === 'baptism') {
                        // Baptism Candidates: incomplete if there are none, or any
                        // candidate is a literal name not yet linked to a Person.
                        const candidates = this.service.liturgy.baptism || [];
                        const incomplete = candidates.length === 0 || candidates.some(c => c.name && !c.id);
                        if (incomplete && highlight(key)) return;
                        continue;
                    }
                    const val = this.service.liturgy[key];
                    const isEmpty = (val && typeof val === 'object') ? !val.name : !val;
                    const isLiteral = (val && typeof val === 'object' && val.name && !val.id);

                    if (isEmpty || isLiteral) {
                        if (highlight(key)) return;
                    }
                }
            });
        },

        async save(manual = false) {
            clearTimeout(this._saveTimer);
            this.saving = true;
            let committed = false;
            try {
                const batch = db.batch();
                const original = JSON.parse(this.originalService);
                
                // For irregular services, sync canonical elements back to standard fields 
                // so they are visible to calendar/dashboard and tracked for involvements.
                if (this.service.isIrregular) {
                    this.service.irregularElements.forEach(el => {
                        const mapping = CANONICAL_MAPPING[el.key];
                        if (mapping) {
                            if (mapping.liturgy) {
                                this.service.liturgy[mapping.field] = JSON.parse(JSON.stringify(el.value));
                            } else {
                                this.service[mapping.field] = JSON.parse(JSON.stringify(el.value));
                            }
                        }
                    });
                }

                // Role synchronization logic
                const roles = [
                    { field: 'serviceLeader', role: 'service_leader' },
                    { field: 'musicLeader', role: 'worship_leader' },
                    { field: 'preacher', role: 'preacher' },
                    { field: 'prayerPraise', role: 'prayer', metadata: { prayer_type: 'praise' } },
                    { field: 'prayerConfession', role: 'prayer', metadata: { prayer_type: 'confession' } },
                    { field: 'elements', role: 'elements' },
                    { field: 'other', role: 'other' }
                ];

                const liturgyRoles = [
                    { field: 'prayerMale', role: 'pastoral_prayer' },
                    { field: 'prayerFemale', role: 'pastoral_prayer' }
                ];

                const peopleToRecalculate = new Set();

                // An Involvement is the fact that somebody served, so it is not
                // written until the day has been (MS-160, ADR-0018 §1). Putting a
                // preacher down for a Sunday six weeks out used to count as
                // serving the moment you saved, and a fairness engine reading
                // that log ranks people by what was hoped for.
                //
                // A Sunday still ahead therefore writes nothing and is stamped
                // `involvementDeferred`, which is the Service saying its records
                // are still owed. The scheduled job pays them the night the date
                // passes, and clears the flag.
                //
                // Pastoral prayer below is untouched: it records being prayed
                // FOR, not serving, and it drives lastPastoralPrayerDate for the
                // prayer rotation.
                const hasHappened = ServiceInvolvementCore.hasPassed(
                    this.date, window.DateUtils.todayStr());

                if (hasHappened) {
                    // 1. Process Standard Roles
                    for (const { field, role, metadata } of roles) {
                        const oldId = original[field] ? original[field].id : null;
                        const newId = this.service[field].id;
                        if (oldId !== newId) {
                            if (oldId) await this._removeInvolvement(batch, oldId, role, metadata);
                            if (newId) await this._addInvolvement(batch, newId, role, metadata);
                        }
                    }

                    // 1b. Process Music Helpers (a set of worship_helper involvements)
                    const helperChanges = worshipHelperInvolvementChanges(original.musicHelpers, this.service.musicHelpers);
                    for (const personId of helperChanges.removed) {
                        await this._removeInvolvement(batch, personId, 'worship_helper');
                    }
                    for (const personId of helperChanges.added) {
                        await this._addInvolvement(batch, personId, 'worship_helper');
                    }
                } else {
                    // Nothing is owed yet — and anything already here is a record
                    // of something that has not happened, whether this save put it
                    // there or the old write-on-save behaviour did. Clearing it on
                    // the way past means a Sunday heals itself the next time it is
                    // touched, rather than waiting on the migration.
                    for (const { field, role, metadata } of roles) {
                        const oldId = original[field] ? original[field].id : null;
                        const newId = this.service[field].id;
                        if (oldId) await this._removeInvolvement(batch, oldId, role, metadata);
                        if (newId && newId !== oldId) {
                            await this._removeInvolvement(batch, newId, role, metadata);
                        }
                    }

                    const helperIds = new Set(
                        [...(original.musicHelpers || []), ...(this.service.musicHelpers || [])]
                            .map(h => h && h.id).filter(Boolean));
                    for (const personId of helperIds) {
                        await this._removeInvolvement(batch, personId, 'worship_helper');
                    }
                }

                // In the new system baptism presence is derived from the chosen
                // template (ADR-0010), not the "Include Baptism?" checkbox; reconcile
                // hasBaptism here so the candidate sync below and the saved flag match
                // the template. Legacy weeks keep the checkbox value as-is.
                if (this._guideEngaged && this.guideSystem === 'v2' && this.guideSnapshot && window.GuideStore) {
                    this.service.hasBaptism = GuideStore.templateIncludesBaptism(this.guideSnapshot, this._guideCatalog);
                }

                // 1c. Process Baptism Candidates: each baptized Person's baptismDate is
                // this service's date. The effective set is empty when baptism is toggled
                // off, so clearing "Include Baptism?" also clears the dates it set.
                const oldCandidates = (original.hasBaptism && Array.isArray(original.liturgy.baptism)) ? original.liturgy.baptism : [];
                const newCandidates = (this.service.hasBaptism && Array.isArray(this.service.liturgy.baptism)) ? this.service.liturgy.baptism : [];
                const baptismChanges = personRefSetChanges(oldCandidates, newCandidates);
                for (const personId of baptismChanges.added) {
                    batch.update(db.collection('people').doc(personId), { baptismDate: this.date });
                }
                for (const personId of baptismChanges.removed) {
                    await this._clearBaptismDateIfThisService(batch, personId);
                }

                // 2. Process Pastoral Prayer Roles (Liturgy)
                // Who is a subject *after* this edit, so the cache below is
                // recomputed against the final state of the service rather than
                // against whichever slot happened to be processed last. A person
                // moved between the two slots is added and removed in the same
                // save, and only the final answer is worth writing.
                const subjectIds = new Set(
                    liturgyRoles
                        .map(({ field }) => this.service.liturgy[field] && this.service.liturgy[field].id)
                        .filter(Boolean)
                );

                for (const { field } of liturgyRoles) {
                    const oldId = original.liturgy[field] ? original.liturgy[field].id : null;
                    const newId = this.service.liturgy[field].id;
                    if (oldId !== newId) {
                        if (oldId) peopleToRecalculate.add(oldId);
                        if (newId) peopleToRecalculate.add(newId);
                    }
                }

                for (const personId of peopleToRecalculate) {
                    if (subjectIds.has(personId)) await this._addPastoralPrayer(batch, personId);
                    else await this._removePastoralPrayer(batch, personId);
                }

                // Recalculate lastPastoralPrayerDate for affected people. Written
                // into the same batch as the history change above, so the cache
                // and the record it caches can never land apart.
                for (const personId of peopleToRecalculate) {
                    const latestDate = await this._calculateLatestPastoralPrayer(
                        personId, subjectIds.has(personId));
                    batch.update(db.collection('people').doc(personId), {
                        lastPastoralPrayerDate: latestDate
                    });
                }

                // Write only what THIS editor changed.
                //
                // A Sunday is edited by several people at once at a guide-writing
                // session, so the old whole-document save was a silent clobber:
                // it sent every slot it held, and a slot left blank on this screen
                // overwrote the same slot another editor had just filled. Diffing
                // the flattened model against the flattened snapshot we loaded
                // leaves an untouched slot out of the write entirely, so it cannot
                // lose a race it never entered. See changedFieldPaths.
                const flatNow = flattenServiceForSave(this.service);
                const toSave = changedFieldPaths(flattenServiceForSave(original), flatNow);

                // Whether this Sunday still owes its serve records. The
                // scheduled job converts only Services carrying it, which is
                // what stops it re-crediting every Sunday in the archive —
                // those were written the old way under auto-generated ids, so
                // a second pass would add a duplicate rather than overwrite.
                toSave.involvementDeferred = !hasHappened;
                toSave.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

                // Who decided each element this save is changing (MS-246).
                // Merged into the SAME update as the values, so an element and
                // the record of who chose it can never land apart — a half
                // failure would otherwise leave a hymn nobody appears to have
                // chosen, or a name against a hymn that never saved.
                //
                // Taking an element back out takes your name out with it.
                const authorRemove = firebase.firestore.FieldValue.delete();
                Object.assign(toSave, ServiceAuthorship.stampsFor(
                    toSave, this.me,
                    firebase.firestore.FieldValue.serverTimestamp(), authorRemove));
                // Only persist the guide system once the editor has engaged the new
                // controls, so untouched pre-ADR-0010 weeks are never silently flipped.
                if (this._guideEngaged) toSave.guideSystem = this.guideSystem;

                // Sync Pastoral Prayer names to Guide elements if they exist.
                // Skip re-saving if the guide is missing hymn2 when it should have it —
                // those stale elements were generated by an old bug and must not be propagated.
                if (this.service.guide && this.service.guide.elements) {
                    const elements = this.service.guide.elements;
                    const isBroken = !this.service.hasBaptism &&
                        this.service.liturgy.hymn2?.name &&
                        !elements.some(el => el.id && el.id.startsWith('hymn-h2'));
                    if (!isBroken) {
                        const prayerEl = elements.find(el => el.type === 'pastoral_prayer');
                        if (prayerEl) {
                            prayerEl.maleMember = this.service.liturgy.prayerMale.name || '';
                            prayerEl.femaleMember = this.service.liturgy.prayerFemale.name || '';
                            toSave.guide = this.service.guide;
                        }
                    }
                }

                // In the new system the Order of Service editor applies the chosen
                // Service Guide Template first (ADR-0010), freezing the per-week v2
                // guide record so the Service Guide generator opens on that template.
                // Existing generator-surface values are preserved (and, on a template
                // switch, pruned to the surviving Entry Field keys).
                if (this._guideEngaged && this.guideSystem === 'v2' && this.guideSnapshot && window.GuideStore) {
                    const existing = (this.service.guide && this.service.guide.format === 'v2') ? this.service.guide : null;
                    let values = (existing && existing.values) || {};
                    if (existing && existing.guideTemplateId !== this.selectedTemplateId) {
                        values = GuideStore.preserveValues(values, this.guideSnapshot);
                    }
                    const gt = this.guideTemplates.find(t => t.id === this.selectedTemplateId) || { id: this.selectedTemplateId };
                    toSave.guide = GuideStore.buildGuideRecord(gt, this.guideSnapshot, values);
                    this.service.guide = toSave.guide;
                }

                const serviceRef = db.collection('services').doc(this.date);
                if (this._docExists) {
                    // update() reads 'liturgy.hymn1' as a path to one slot.
                    // set(merge) would read it as a field NAME containing a dot
                    // and write a second, parallel copy of the liturgy — the same
                    // trap normalizeDottedKeys exists to clean up after.
                    batch.update(serviceRef, toSave);
                } else {
                    // Nothing to race yet, so the first write lays the whole
                    // document down at once. Dot paths are meaningless here.
                    const firstStamps = ServiceAuthorship.nestStamps(toSave, authorRemove);
                    batch.set(serviceRef, Object.assign({}, flatNow, {
                        involvementDeferred: toSave.involvementDeferred,
                        updatedAt: toSave.updatedAt
                    }, toSave.guide ? { guide: toSave.guide } : {},
                       toSave.guideSystem ? { guideSystem: toSave.guideSystem } : {},
                       // Nested, because set() reads a dot as part of a field
                       // NAME. Without this the first save of a brand-new
                       // Sunday would be the one save that records nobody.
                       firstStamps ? { [ServiceAuthorship.FIELD]: firstStamps } : {}
                    ), { merge: true });
                }

                await batch.commit();
                committed = true;
                this._docExists = true;
                this.originalService = JSON.stringify(this.service);
                console.log('Service and involvements saved successfully.');
            } catch (e) {
                // An autosave that fails stays quiet — the "Unsaved changes"
                // marker is already on screen and the next edit tries again.
                // Pressing Save yourself is a question, so it gets an answer.
                if (manual) {
                    if (e.code === 'permission-denied') {
                        alert('Permission denied. Your account does not have permission to save services.');
                    } else {
                        alert('Error saving. Check console for details.');
                    }
                }
                console.error(e);
            } finally {
                this.saving = false;
                // Edits made while the write was in flight got no timer, because
                // scheduleSave stands down during a save. Pick them up here so
                // they are not left sitting until the next keystroke.
                //
                // Only after a write that worked. Re-arming after a failure is a
                // retry loop: a Sunday you have no permission to save would ask
                // Firestore again every three seconds, forever. A failed save
                // leaves the marker up and waits for you to do something.
                if (committed && this.isDirty) this.scheduleSave();
            }
            // Whether the write landed. An autosave ignores this — it is quiet
            // by design — but stepping to another Sunday must not leave one
            // behind if its save failed, so it needs to be told (MS-303).
            return committed;
        },

        // ── Autosave ────────────────────────────────────────────────────────────
        // A Sunday saves itself 3s after the last edit. Longer than the 1.5s the
        // elder documents use, because this save is not one write: it also
        // settles who served and hands the fairness engine new numbers. Three
        // seconds is past the end of a sentence but still short enough that
        // leaving the page loses nothing.
        //
        // The watcher is armed at the end of init, after autoLinkHymns and the
        // rest have had their say, so merely opening a Sunday never writes it.
        //
        // The Save button stays. It cancels the pending timer and writes now.
        _saveTimer: null,

        watchForChanges() {
            this.$watch('service', () => this.scheduleSave());
        },

        // ── Keeping up with the other editors ───────────────────────────────
        // This Sunday is one document and, on a guide-writing night, several
        // people. The page used to read it once on open and never look again,
        // so you worked all evening against the version you arrived at and
        // found out what everyone else had done by reloading.
        //
        // Now it listens. A field nobody here has touched simply takes the new
        // value; a field this editor has changed is left alone until it saves.
        // See remoteAdoptions for why that needs no merge and asks nobody a
        // question.
        _remoteUnsubscribe: null,

        watchRemoteChanges() {
            if (typeof db === 'undefined' || this._remoteUnsubscribe) return;

            this._remoteUnsubscribe = db.collection('services').doc(this.date)
                .onSnapshot(
                    (doc) => this.adoptRemoteChanges(doc),
                    (e) => {
                        console.error('Lost the live connection to this Sunday:', e);
                        this._remoteUnsubscribe = null;
                    }
                );
        },

        adoptRemoteChanges(doc) {
            if (!doc || !doc.exists) return;
            // Our own write, echoing back before the server has confirmed it.
            // Adopting it would be answering our own question.
            if (doc.metadata && doc.metadata.hasPendingWrites) return;

            this._docExists = true;

            const original = JSON.parse(this.originalService);
            const adoptions = remoteAdoptions(
                flattenServiceForSave(original),
                flattenServiceForSave(this.service),
                normalizeDottedKeys(doc.data())
            );

            // Who decided each element travels wholesale. Nobody edits it on
            // this page — it is a by-product of saving — so there is no local
            // version to protect, and a tag that did not keep up would credit
            // the wrong person until somebody reloaded. Applied to BOTH copies
            // for the same reason as everything below.
            const remoteDecided = doc.data()[ServiceAuthorship.FIELD] || {};
            let adopted = JSON.stringify(this.service[ServiceAuthorship.FIELD] || {})
                !== JSON.stringify(remoteDecided) ? 1 : 0;
            if (adopted) {
                this.service[ServiceAuthorship.FIELD] = remoteDecided;
                original[ServiceAuthorship.FIELD] = remoteDecided;
            }

            for (const [path, value] of Object.entries(adoptions)) {
                // Applied to BOTH the live model and the loaded snapshot. Miss
                // the snapshot and the next save reads the adopted value as a
                // local edit and writes it straight back — turning a value we
                // merely received into one we claim, and re-opening the race
                // this was built to end.
                if (applyFlatFieldPath(this.service, path, value)) {
                    applyFlatFieldPath(original, path, value);
                    adopted++;
                }
            }

            if (adopted) this.originalService = JSON.stringify(original);
        },

        scheduleSave() {
            if (!this.canEdit || this.saving) return;
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => {
                // save() rewrites parts of `service` for irregular Sundays, which
                // trips the watcher again. Re-checking isDirty here is what stops
                // that from becoming a save loop.
                if (this.isDirty && !this.saving) this.save();
            }, 3000);
        },

        // ── Order of Service model (movement-grouped station rows) ──────────────
        // The liturgy laid out as the three movements of a Mosaic service. Each
        // entry is [fieldKey, displayLabel, type]. The `movements` getter turns this
        // into display rows; the HTML renders one generic template per type, so the
        // pickers below stay wired to the same service.liturgy field objects.
        _MOVEMENTS: [
            { num: 'I', name: 'Service Leading', keys: [
                ['preparatoryHymn', 'Preparatory Hymn', 'hymn'],
                ['callToWorship', 'Call to Worship', 'verse'],
                ['hymn1', 'Hymn', 'hymn'],
                ['hymn2', 'Hymn', 'hymn'],
                ['callToConfession', 'Call to Confession', 'verse'],
                ['assuranceOfPardon', 'Assurance of Pardon', 'verse'],
                ['hymnMid1', 'Hymn', 'hymn'],
                ['hymnMid2', 'Hymn', 'hymn'],
            ]},
            { num: 'II', name: 'Preaching', keys: [
                ['scriptureReading', 'Pastoral Prayer', 'verse'],
                ['sermon', 'Sermon', 'verse'],
            ]},
            { num: 'III', name: 'Closing', keys: [
                ['baptism', 'Baptism', 'baptism'],
                ['hymnEnd1', 'Hymn', 'hymn'],
                ['hymnEnd2', 'Hymn', 'hymn'],
                ['benediction', 'Benediction', 'verse'],
            ]},
        ],

        // Dot colour by element status (canonical/literal hymns, set references,
        // baptism, or empty) — kept within the brand palette.
        _dotColor(status) {
            return status === 'canonical' ? 'var(--success)'
                : status === 'literal' ? 'var(--warning)'
                : status === 'set' ? 'var(--secondary)'
                : status === 'baptism' ? 'var(--primary)'
                : 'var(--outline-variant)';
        },

        _stripHtml(html) {
            if (!html) return '';
            const d = document.createElement('div');
            d.innerHTML = html;
            return d.textContent || d.innerText || '';
        },

        _buildItem(key, label, type, lit) {
            const removed = type === 'hymn' && this.isHymnRemoved(key);
            let value = '', status = 'empty', emptyLabel = '';
            if (type === 'hymn') {
                const ref = lit[key] || {};
                value = ref.name || '';
                status = ref.id ? 'canonical' : (ref.name ? 'literal' : 'empty');
                emptyLabel = 'Choose a hymn…';
            } else if (type === 'baptism') {
                const arr = Array.isArray(lit.baptism) ? lit.baptism : [];
                const names = arr.map(c => (c && c.name) || '').filter(Boolean);
                value = names.join(', ');
                status = names.length ? 'baptism' : 'empty';
                emptyLabel = 'Add candidates…';
            } else { // verse / text reference
                value = lit[key] || '';
                status = value ? 'set' : 'empty';
                emptyLabel = 'Add a reference…';
            }
            const note = (this.service.notes && this.service.notes[key]) || '';
            return {
                key, label, type, value, status, emptyLabel, removed,
                dotColor: this._dotColor(status),
                hasNote: !!this._stripHtml(note).trim(),
            };
        },

        // The three movements, each with its visible station rows. hymn2 hides when
        // a baptism takes its place; the baptism row only appears when the template
        // (or the legacy checkbox) calls for it (ADR-0010).
        get movements() {
            const lit = this.service.liturgy;
            return this._MOVEMENTS.map(mv => ({
                num: mv.num,
                name: mv.name,
                items: mv.keys
                    .filter(([key]) => {
                        if (key === 'hymn2' && this.service.hasBaptism) return false;
                        if (key === 'baptism' && !this.showBaptismSection) return false;
                        return true;
                    })
                    .map(([key, label, type]) => this._buildItem(key, label, type, lit)),
            }));
        },

        // ── Who decided this element (MS-246) ───────────────────────────────
        // A quiet note under a row, not a column of its own: the row already
        // carries a label and a value, and the interesting thing is almost
        // always what was chosen rather than who chose it.
        decidedTag(key) {
            return ServiceAuthorship.tagLabel(
                ServiceAuthorship.decidedBy(this.service, key));
        },

        decidedTitle(key) {
            return ServiceAuthorship.tagTitle(
                ServiceAuthorship.decidedBy(this.service, key));
        },

        // Fields beyond the liturgy grid that a fully-ready service needs: the two
        // header references (Theme, Key Verse) and the core people roles. Person
        // roles count as set once they have an id or a typed-in name. Optional
        // roles (Elements, Other Involvement) are deliberately left out
        // so the tally can still reach "complete" on a normal Sunday.
        _readinessFields: [
            { label: 'Theme',              get: s => s.theme,            type: 'text'   },
            { label: 'Key Verse',          get: s => s.keyVerse,         type: 'text'   },
            { label: 'Service Leader',     get: s => s.serviceLeader,    type: 'person' },
            { label: 'Music Leader',       get: s => s.musicLeader,      type: 'person' },
            { label: 'Preacher',           get: s => s.preacher,         type: 'person' },
            { label: 'Prayer (Praise)',    get: s => s.prayerPraise,     type: 'person' },
            { label: 'Prayer (Confession)',get: s => s.prayerConfession, type: 'person' },
        ],

        _isFieldSet(val, type) {
            if (type === 'person') return !!(val && (val.id || (val.name || '').trim()));
            return val != null && String(val).trim() !== '';
        },

        // "X of Y set" — a full-readiness tally: the liturgy rows currently in the
        // order (removed hymns are intentionally blank, so they sit out) PLUS the
        // header references and core people roles above. Catches a missing Key
        // Verse or unassigned leader that the liturgy-only count used to miss.
        get filledLabel() {
            let filled = 0, total = 0;
            for (const mv of this.movements) {
                for (const it of mv.items) {
                    if (it.removed) continue;
                    total++;
                    if (it.value) filled++;
                }
            }
            for (const f of this._readinessFields) {
                total++;
                if (this._isFieldSet(f.get(this.service), f.type)) filled++;
            }
            return `${filled} of ${total} set`;
        },

        // Service notes surfaced for the leader, in service order, one card each.
        get notesList() {
            const out = [];
            const notes = this.service.notes || {};
            for (const mv of this.movements) {
                for (const it of mv.items) {
                    const html = notes[it.key];
                    if (html && this._stripHtml(html).trim()) {
                        out.push({ key: it.key, label: it.label, value: it.value, dotColor: it.dotColor, html });
                    }
                }
            }
            return out;
        },
        get noteCount() { return this.notesList.length; },

        // ── Station rows + inline notes ─────────────────────────────────────────
        // Expanding a row reveals its picker and a rich-text Service Note. The note
        // is a single Quill instance mounted into whichever row is open; switching
        // rows commits the current note first, so service.notes stays in sync (and
        // the Service Notes sidebar updates live).
        toggleRow(key) {
            if (this.openKey === key) { this.closeRow(); return; }

            // One person per box (MS-246). A row somebody else is in does not
            // open at all — refusing at the door is what removes the whole
            // question of whose version wins, because two people are never in
            // the same box to disagree.
            if (this.heldBy(key)) return;
            if (!this.takeRow(key)) return;

            this.commitNote();
            this.openKey = key;
            this.$nextTick(() => this.mountNote(key));
        },

        closeRow() {
            this.commitNote();
            this.openKey = null;
            PresenceStore.release();
        },

        // ── Presence (MS-246) ───────────────────────────────────────────────
        presenceEntries: [],

        watchPresence() {
            // Deliberately NOT gated on `me`. An account with no Person record
            // attached still has a uid, which is all a claim needs — the name
            // is cosmetic and falls back to "Someone". Gating on the Person was
            // what stopped presence starting at all for such an account, and a
            // store that never started used to take every editor on the page
            // down with it.
            if (!this.user) return;
            PresenceStore.start({
                db: db,
                uid: this.user.uid,
                identity: this.me,
                surface: 'order-of-service',
                // Which Sunday this page is, so "also here" means here rather
                // than "signed in somewhere".
                pageKey: this.date,
                stamp: () => firebase.firestore.FieldValue.serverTimestamp(),
                // Alpine redraws from this; the store's own list is the truth.
                onChange: (entries) => { this.presenceEntries = entries; }
            });

            // A courtesy, not the mechanism. Expiry is what actually frees a
            // box — this just makes the common case instant.
            // leave(), not release(): release writes a fresh timestamp, which
            // would leave you looking newly arrived for half a minute after
            // closing the tab.
            window.addEventListener('beforeunload', () => PresenceStore.leave());
        },

        takeRow(key) {
            if (!this.canEdit) return true;
            return PresenceStore.claim(this.date, 'liturgy.' + key);
        },

        // Whoever else is in this row, or null. Read off presenceEntries rather
        // than the store so Alpine re-renders when somebody arrives or leaves.
        heldBy(key) {
            if (!this.user) return null;
            return ServicePresence.holderOf(
                this.presenceEntries, this.user.uid, this.date, 'liturgy.' + key, Date.now());
        },

        heldLabel(key) { return ServicePresence.holderLabel(this.heldBy(key)); },
        heldTitle(key) { return ServicePresence.holderTitle(this.heldBy(key)); },

        // Everybody else on this Sunday right now — the row of faces up top.
        get othersHere() {
            if (!this.user) return [];
            return ServicePresence.peopleHere(
                this.presenceEntries, this.user.uid,
                'order-of-service', this.date, Date.now());
        },

        // Open a specific row (from the Service Notes sidebar) and scroll to it.
        openRow(key) {
            if (this.openKey !== key) {
                this.commitNote();
                this.openKey = key;
                this.$nextTick(() => this.mountNote(key));
            }
            this.$nextTick(() => this.scrollToRow(key));
        },

        scrollToRow(key) {
            const row = document.querySelector(`[data-field-key="${key}"]`);
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        },

        mountNote(key) {
            if (!this.canEdit) return; // viewers read the note as HTML; no editor
            const el = document.getElementById('note-quill-inline');
            if (!el) return;
            this._quill = new Quill(el, {
                theme: 'snow',
                modules: { toolbar: [['bold', 'italic'], [{ list: 'bullet' }]] },
                placeholder: 'Add a note for whoever leads the service — context, reminders, reasoning…'
            });
            const existing = (this.service.notes && this.service.notes[key]) || '';
            this._quill.root.innerHTML = existing
                ? (existing.includes('<') ? existing : `<p>${existing}</p>`)
                : '';
            this._quill.on('text-change', () => this._syncNote(key));
        },

        // Write the live editor contents through to service.notes (empty → delete),
        // so the sidebar and the dirty indicator track every keystroke.
        _syncNote(key) {
            if (!this._quill) return;
            if (!this.service.notes) this.service.notes = {};
            if (this._quill.getText().trim() === '') {
                delete this.service.notes[key];
            } else {
                this.service.notes[key] = this._quill.root.innerHTML;
            }
        },

        // Persist and tear down the open row's editor before it is unmounted.
        commitNote() {
            if (this._quill && this.openKey) this._syncNote(this.openKey);
            this._quill = null;
        },

        deleteNote(key) {
            if (!confirm('Delete this note?')) return;
            if (this.service.notes) delete this.service.notes[key];
            if (this._quill) this._quill.root.innerHTML = '';
        },

        // ── Music Helpers ────────────────────────────────────────────────────
        addMusicHelper() {
            this.service.musicHelpers.push({ name: '', id: null });
        },

        removeMusicHelper(index) {
            this.service.musicHelpers.splice(index, 1);
        },

        // ── Removed Hymns ─────────────────────────────────────────────────────
        // Pull a hymn slot out of the order of service. The hymn's data is kept so
        // it can be added back, but the slot collapses to a thin bar and the service
        // guide generator skips it (filling the freed pages with sermon notes).
        isHymnRemoved(field) {
            return Array.isArray(this.service.removedHymns) && this.service.removedHymns.includes(field);
        },

        removeHymn(field) {
            if (!Array.isArray(this.service.removedHymns)) this.service.removedHymns = [];
            if (!this.service.removedHymns.includes(field)) {
                this.service.removedHymns.push(field);
            }
        },

        restoreHymn(field) {
            if (!Array.isArray(this.service.removedHymns)) return;
            this.service.removedHymns = this.service.removedHymns.filter(f => f !== field);
        },

        // ── Baptism Candidates ───────────────────────────────────────────────
        addBaptismCandidate() {
            if (!Array.isArray(this.service.liturgy.baptism)) this.service.liturgy.baptism = [];
            this.service.liturgy.baptism.push({ name: '', id: null });
        },

        removeBaptismCandidate(index) {
            this.service.liturgy.baptism.splice(index, 1);
        },

        // ── Utility ────────────────────────────────────────────────────────────
        clearService() {
            if (!confirm('Are you sure you want to clear the current service? This will reset all liturgy fields.')) return;
            this.service.theme = '';
            this.service.keyVerse = '';
            this.service.serviceLeader = { name: '', id: null };
            this.service.musicLeader = { name: '', id: null };
            this.service.musicHelpers = [];
            this.service.preacher = { name: '', id: null };
            this.service.prayerPraise = { name: '', id: null };
            this.service.prayerConfession = { name: '', id: null };
            this.service.elements = { name: '', id: null };
            this.service.other = { name: '', id: null };
            this.service.hasBaptism = false;
            this.service.removedHymns = [];
            this.service.notes = {};
            this.service.liturgy = {
                preparatoryHymn: { id: null, name: '' },
                callToWorship: '',
                hymn1: { id: null, name: '' },
                hymn2: { id: null, name: '' },
                callToConfession: '',
                assuranceOfPardon: '',
                hymnMid1: { id: null, name: '' },
                hymnMid2: { id: null, name: '' },
                scriptureReading: '',
                prayerMale: { id: null, name: '' },
                prayerFemale: { id: null, name: '' },
                prayerLabel: 'Pastoral Prayer',
                sermon: '',
                baptism: [],
                hymnEnd1: { id: null, name: '' },
                hymnEnd2: { id: null, name: '' },
                benediction: ''
            };
        },

        formatDate(dateStr) {
            return DateUtils.formatDateLong(dateStr);
        },

        async downloadMusicSheets() {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF();

            const hymnFields = [
                'preparatoryHymn', 'hymn1', 'hymn2', 'hymnMid1', 'hymnMid2', 'hymnEnd1', 'hymnEnd2'
            ];
            const removedHymns = Array.isArray(this.service.removedHymns) ? this.service.removedHymns : [];
            const hymnIds = hymnFields
                .filter(field => !removedHymns.includes(field))
                .map(field => this.service.liturgy[field]?.id)
                .filter(id => !!id);

            if (hymnIds.length === 0) {
                alert('No hymns selected in the Order of Service.');
                return;
            }

            let pagesAdded = 0;

            try {
                const btn = document.getElementById('download-music-btn');
                if (btn) btn.innerText = 'Generating PDF...';

                // Page 1: Order of Service
                this._renderOOSPage(pdf);
                pagesAdded++;

                // Remaining pages: one hymn image per page
                for (const id of hymnIds) {
                    const doc = await db.collection('hymns').doc(id).get();
                    if (!doc.exists) continue;

                    const hymn = doc.data();
                    const version = hymn.versions && hymn.versions.length > 0 ? hymn.versions[0] : null;
                    if (!version || !version.pages || version.pages.length === 0) continue;

                    for (const pageUrl of version.pages) {
                        try {
                            const imgData = await this._getImageDataUrl(pageUrl);
                            if (!imgData) continue;

                            let format = 'PNG';
                            if (imgData.includes('image/jpeg') || imgData.includes('image/jpg')) format = 'JPEG';
                            else if (imgData.includes('image/webp')) format = 'WEBP';

                            pdf.addPage();

                            const pageWidth = pdf.internal.pageSize.getWidth();
                            const pageHeight = pdf.internal.pageSize.getHeight();
                            const margin = 10;
                            const titleFontSize = 14;
                            const titlePadding = 8;

                            pdf.setFont('helvetica', 'bold');
                            pdf.setFontSize(titleFontSize);
                            pdf.text(hymn.hymn_name || 'Hymn', pageWidth / 2, margin + 5, { align: 'center' });

                            const img = new Image();
                            await new Promise((resolve, reject) => {
                                img.onload = resolve;
                                img.onerror = () => reject(new Error('Failed to load image: ' + pageUrl));
                                img.src = imgData;
                            });

                            const maxWidth = pageWidth - margin * 2;
                            const maxHeight = pageHeight - margin * 2 - titleFontSize - titlePadding;
                            const ratio = Math.min(maxWidth / img.width, maxHeight / img.height);
                            const dw = img.width * ratio;
                            const dh = img.height * ratio;
                            const dx = (pageWidth - dw) / 2;
                            const dy = margin + titleFontSize + titlePadding + (maxHeight - dh) / 2;

                            pdf.addImage(imgData, format, dx, dy, dw, dh, undefined, 'FAST');
                            pagesAdded++;
                        } catch (e) {
                            console.error('Error adding page to PDF:', e);
                        }
                    }
                }

                if (pagesAdded > 0) {
                    pdf.save(`Music_Sheets_${this.date}.pdf`);
                } else {
                    alert('No music sheets found for the selected hymns.');
                }
            } catch (error) {
                console.error('PDF Generation failed:', error);
                alert('Failed to generate PDF. Check console for details.');
            } finally {
                const btn = document.getElementById('download-music-btn');
                if (btn) {
                    btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">picture_as_pdf</span> Download Music Sheets';
                }
            }
        },

        _renderOOSPage(pdf) {
            const liturgy = this.service.liturgy || {};
            const hasBaptism = this.service.hasBaptism;
            const removedHymns = Array.isArray(this.service.removedHymns) ? this.service.removedHymns : [];
            const prayerLabel = liturgy.prayerLabel || 'Pastoral Prayer';
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            const margin = 15;

            // Header
            let y = margin + 7;
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(15);
            pdf.text('Order of Service', margin, y);
            if (this.service.theme) {
                pdf.setFont('helvetica', 'italic');
                pdf.setFontSize(13);
                pdf.text(this.service.theme, pageW - margin, y, { align: 'right' });
            }
            y += 4;
            pdf.setDrawColor(0);
            pdf.setLineWidth(0.3);
            pdf.line(margin, y, pageW - margin, y);
            y += 6;

            // Key verse reference
            if (this.service.keyVerse) {
                pdf.setFont('helvetica', 'italic');
                pdf.setFontSize(8);
                pdf.text(`— ${this.service.keyVerse}`, pageW / 2, y, { align: 'center' });
                y += 8;
            }

            // Footer reservation
            const footerH = 18;
            const footerY = pageH - margin - footerH;

            // Build item list (mirrors the OOS page in the service guide)
            const items = [
                { label: 'Preparatory',                    value: liturgy.preparatoryHymn?.name || '', italic: true, field: 'preparatoryHymn' },
                { label: 'Welcome' },
                { label: 'Moment of Silent Preparation' },
                { label: 'Scriptural Call to Worship',     value: liturgy.callToWorship || '' },
                { label: 'Hymn',                           value: liturgy.hymn1?.name || '',           italic: true, field: 'hymn1' },
            ];
            if (!hasBaptism) {
                items.push({ label: 'Hymn',                value: liturgy.hymn2?.name || '',           italic: true, field: 'hymn2' });
            }
            items.push(
                { label: 'Prayer of Praise' },
                { label: 'Call To Confession',             value: liturgy.callToConfession || '' },
                { label: 'Prayer of Confession' },
                { label: 'Scriptural Assurance of Pardon', value: liturgy.assuranceOfPardon || '' },
            );
            if (!hasBaptism) {
                items.push({ label: 'Hymn',                value: liturgy.hymnMid1?.name || '',        italic: true, field: 'hymnMid1' });
            }
            items.push(
                { label: 'Hymn',                           value: liturgy.hymnMid2?.name || '',        italic: true, field: 'hymnMid2' },
                { label: 'Scripture Reading',              value: liturgy.scriptureReading || '' },
                { label: prayerLabel },
                { label: 'Sermon',                         value: liturgy.sermon || '' },
            );
            if (hasBaptism) {
                const baptismNames = Array.isArray(liturgy.baptism)
                    ? liturgy.baptism.map(c => c.name).filter(Boolean).join(', ')
                    : (liturgy.baptism || '');
                items.push({ label: 'Sacrament of Baptism', value: baptismNames });
            }
            items.push(
                { label: 'Hymn',                           value: liturgy.hymnEnd1?.name || '',        italic: true, field: 'hymnEnd1' },
                { label: 'Hymn',                           value: liturgy.hymnEnd2?.name || '',        italic: true, field: 'hymnEnd2' },
                { label: "The Lord's Supper" },
                { label: 'Moment of Silent Reflection' },
                { label: 'Benediction',                    value: liturgy.benediction || '' },
            );

            // Drop hymn rows the user pulled out of the order of service.
            const visibleItems = items.filter(it => !it.field || !removedHymns.includes(it.field));

            // Distribute items evenly in available space
            const lineH = (footerY - y) / visibleItems.length;
            pdf.setFontSize(10);
            visibleItems.forEach((item, i) => {
                const itemY = y + (i + 0.72) * lineH;
                pdf.setFont('helvetica', 'bold');
                pdf.text(item.label, margin, itemY);
                if (item.value) {
                    pdf.setFont('helvetica', item.italic ? 'italic' : 'normal');
                    pdf.text(item.value, pageW - margin, itemY, { align: 'right' });
                }
            });

            // Footer
            pdf.setDrawColor(0);
            pdf.setLineWidth(0.3);
            pdf.line(margin, footerY, pageW - margin, footerY);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(8);
            const fy = footerY + 5;
            pdf.text(`Preacher: ${this.service.preacher?.name || 'TBD'}`, margin, fy);
            pdf.text(`Music Leader: ${this.service.musicLeader?.name || 'TBD'}`, pageW / 2, fy, { align: 'center' });
            pdf.text(`Service Leader: ${this.service.serviceLeader?.name || 'TBD'}`, pageW - margin, fy, { align: 'right' });
            pdf.setFont('helvetica', 'italic');
            pdf.text('Our service typically concludes at approximately 11:45 a.m.', pageW / 2, fy + 7, { align: 'center' });
        },

        async _getImageDataUrl(url) {
            const response = await fetch(url);
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        },

        // --- Involvement Helpers ---
        async _addInvolvement(batch, personId, role, metadata = null) {
            const personRef = db.collection('people').doc(personId);
            const invRef = personRef.collection('involvement').doc();
            // The series this serve belonged to, so fairness can be counted per
            // Event series (ADR-0016 §5). The builder only ever edits a Sunday.
            const invData = EventsCore.stampSeries({
                serviceDate: this.date,
                type: role,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }, EventsCore.SUNDAY_SERVICE_ID);
            if (metadata) invData.metadata = metadata;
            batch.set(invRef, invData);
            batch.update(personRef, {
                totalInvolvements: firebase.firestore.FieldValue.increment(1)
            });
        },

        async _removeInvolvement(batch, personId, role, metadata = null) {
            const personRef = db.collection('people').doc(personId);
            let query = personRef.collection('involvement')
                .where('serviceDate', '==', this.date)
                .where('type', '==', role);
            if (metadata && metadata.prayer_type) {
                query = query.where('metadata.prayer_type', '==', metadata.prayer_type);
            }
            const snap = await query.get(FRESH_READ);
            snap.forEach(doc => batch.delete(doc.ref));
            if (!snap.empty) {
                batch.update(personRef, {
                    totalInvolvements: firebase.firestore.FieldValue.increment(-snap.size)
                });
            }
        },

        async _clearBaptismDateIfThisService(batch, personId) {
            // Only clear when the recorded baptismDate is this service's date, so a
            // baptism recorded at a different service is never wiped by this edit.
            const personRef = db.collection('people').doc(personId);
            const snap = await personRef.get(FRESH_READ);
            if (snap.exists && snap.data().baptismDate === this.date) {
                batch.update(personRef, { baptismDate: firebase.firestore.FieldValue.delete() });
            }
        },

        _pastoralPrayerHistory(personId) {
            return db.collection('people').doc(personId)
                .collection(PastoralPrayerCore.HISTORY_COLLECTION);
        },

        async _addPastoralPrayer(batch, personId) {
            const histRef = this._pastoralPrayerHistory(personId)
                .doc(PastoralPrayerCore.historyDocId(this.date));
            batch.set(histRef, Object.assign(
                PastoralPrayerCore.historyRecord(this.date),
                { createdAt: firebase.firestore.FieldValue.serverTimestamp() }
            ));
        },

        async _removePastoralPrayer(batch, personId) {
            const histRef = this._pastoralPrayerHistory(personId)
                .doc(PastoralPrayerCore.historyDocId(this.date));
            batch.delete(histRef);
        },

        // What this person's `lastPastoralPrayerDate` should be once this save
        // lands. The history change is sitting in the same uncommitted batch, so
        // reading the newest stored date would answer the question as it stood
        // before the edit — the bug that left a subject you had just chosen
        // still reading as overdue, and a subject you had just removed still
        // reading as prayed for. Read what is stored, then apply the pending
        // change on top of it.
        async _calculateLatestPastoralPrayer(personId, isSubject) {
            const histSnap = await this._pastoralPrayerHistory(personId).get(FRESH_READ);
            const dates = histSnap.docs.map(d => d.data().serviceDate || d.id);
            return PastoralPrayerCore.nextLastPrayerDate(dates, this.date, isSubject);
        }
    };
}

function personPicker(personRef, parent = null, suggestionsKey = null) {
    if (!personRef) personRef = { name: '', id: null };
    return {
        personRef: personRef,
        parent: parent,
        suggestionsKey: suggestionsKey,
        get suggestions() {
            if (typeof this.suggestionsKey === 'string' && this.parent && this.parent.prayerSuggestions) {
                return this.parent.prayerSuggestions[this.suggestionsKey] || [];
            }
            return Array.isArray(this.suggestionsKey) ? this.suggestionsKey : [];
        },
        open: false,
        query: personRef.name || '',
        results: [],
        keepOpenInterval: null,
        lastFirestoreQuery: '',
        hadFuse: false,
        
        init() {
            // Keep local query in sync with incoming name
            this.$watch('personRef.name', (val) => {
                this.query = val || '';
            });
        },

        ensureInterval(el) {
            if (this.keepOpenInterval) return;
            if (el && document.activeElement === el) {
                this.keepOpenInterval = setInterval(() => {
                    if (document.activeElement === el) {
                        this.open = true;
                        // Periodically call search to check if lazy-loaded fuse registry has arrived
                        this.search();
                    } else {
                        clearInterval(this.keepOpenInterval);
                        this.keepOpenInterval = null;
                    }
                }, 250);
            }
        },

        onFocus(el) {
            this.open = true;
            this.search();
            this.ensureInterval(el);
        },

        async search() {
            const fuse = this.parent && this.parent.peopleFuse;
            const registry = this.parent && this.parent.peopleRegistry;
            const hasFuse = !!(fuse && registry);

            if (hasFuse) {
                this.hadFuse = true;
                let found = [];
                if (!this.query || this.query.trim().length === 0) {
                    if (this.suggestionsKey) {
                        found = [];
                    } else {
                        found = registry.slice(0, 5);
                    }
                } else {
                    found = fuse.search(this.query).slice(0, 5).map(r => r.item);
                }

                if (this.query && this.query.trim().length >= 2) {
                    const exactMatch = found.find(p => p.name.toLowerCase() === this.query.trim().toLowerCase());
                    if (!exactMatch) {
                        found.push({ id: 'NEW', name: this.query.trim(), isNew: true });
                    }
                }
                this.results = found;
                return;
            }

            if (!this.query || this.query.length < 2) {
                this.results = [];
                return;
            }

            // Prevent duplicate Firestore requests while focused/typing
            if (this.lastFirestoreQuery === this.query) {
                return;
            }
            this.lastFirestoreQuery = this.query;

            try {
                // Search Firestore people collection (fallback)
                const snap = await db.collection('people')
                    .where('name', '>=', this.query)
                    .where('name', '<=', this.query + '\uf8ff')
                    .limit(5).get();
                
                let found = snap.docs.map(d => ({ id: d.id, ...d.data() }));

                const exactMatch = found.find(p => p.name.toLowerCase() === this.query.trim().toLowerCase());
                if (!exactMatch && this.query.trim().length >= 2) {
                    found.push({ id: 'NEW', name: this.query.trim(), isNew: true });
                }

                this.results = found;
            } catch (error) {
                console.error("Error searching people:", error);
            }
        },

        select(p) {
            if (this.keepOpenInterval) {
                clearInterval(this.keepOpenInterval);
                this.keepOpenInterval = null;
            }
            if (p.isNew) {
                this.$dispatch('prompt-add-person', { 
                    name: p.name, 
                    callback: (newPerson) => {
                        this.personRef.id = newPerson.id;
                        this.personRef.name = newPerson.name;
                        this.query = newPerson.name;
                    } 
                });
                this.results = [];
                this.open = false;
                this.lastFirestoreQuery = '';
                this.hadFuse = false;
                return;
            }
            this.personRef.id = p.id;
            this.personRef.name = p.name;
            this.query = p.name;
            this.results = [];
            this.open = false;
            this.lastFirestoreQuery = '';
            this.hadFuse = false;
        },

        clear() {
            if (this.keepOpenInterval) {
                clearInterval(this.keepOpenInterval);
                this.keepOpenInterval = null;
            }
            this.personRef.id = null;
            this.personRef.name = '';
            this.query = '';
            this.results = [];
            this.open = false;
            this.lastFirestoreQuery = '';
            this.hadFuse = false;
        },

        onInput(el) {
            this.personRef.id = null; 
            this.open = true;
            this.ensureInterval(el);
            this.search();
        }
    };
}

function hymnPicker(hymnRef, parent = null) {
    return {
        hymnRef: hymnRef,
        parent: parent,
        open: false,
        query: hymnRef.name || '',
        results: [],
        keepOpenInterval: null,
        lastFirestoreQuery: '',
        hadFuse: false,
        
        get isCanonical() {
            return !!this.hymnRef.id;
        },

        get isLiteral() {
            return !this.hymnRef.id && !!this.hymnRef.name;
        },

        init() {
            // Keep query in sync when hymnRef changes (e.g. on load)
            this.$watch('hymnRef.name', (val) => {
                this.query = val || '';
            });
        },
        
        ensureInterval(el) {
            if (this.keepOpenInterval) return;
            if (el && document.activeElement === el) {
                this.keepOpenInterval = setInterval(() => {
                    if (document.activeElement === el) {
                        this.open = true;
                        // Periodically call search to check if lazy-loaded fuse registry has arrived
                        this.search();
                    } else {
                        clearInterval(this.keepOpenInterval);
                        this.keepOpenInterval = null;
                    }
                }, 250);
            }
        },

        onFocus(el) {
            this.open = true;
            this.search();
            this.ensureInterval(el);
        },

        async search() {
            const hasFuse = !!(this.parent && this.parent.fuse);
            
            // Use the pre-loaded registry if it has arrived. The ranking is
            // shared with the Planning view (MS-245) so both screens offer the
            // same hymns for the same typing — see hymn-registry.js.
            if (hasFuse) {
                this.hadFuse = true;
                this.results = HymnRegistry.search(
                    { hymns: this.parent.hymnRegistry, fuse: this.parent.fuse },
                    this.query);
                return;
            }

            if (!this.query || this.query.length < 2) {
                this.results = [];
                return;
            }

            // Prevent duplicate Firestore requests while focused/typing
            if (this.lastFirestoreQuery === this.query) {
                return;
            }
            this.lastFirestoreQuery = this.query;

            try {
                // Fallback to Firestore live search if registry hasn't loaded yet
                const snap = await db.collection('hymns')
                    .where('hymn_name', '>=', this.query)
                    .where('hymn_name', '<=', this.query + '\uf8ff')
                    .limit(5).get();
                this.results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (error) {
                console.error("Error searching hymns fallback:", error);
            }
        },
        select(h) {
            if (this.keepOpenInterval) {
                clearInterval(this.keepOpenInterval);
                this.keepOpenInterval = null;
            }
            this.hymnRef.id = h.id;
            this.hymnRef.name = h.hymn_name;
            this.query = h.hymn_name;
            this.results = [];
            this.open = false;
            this.lastFirestoreQuery = '';
            this.hadFuse = false;
        },
        clear() {
            if (this.keepOpenInterval) {
                clearInterval(this.keepOpenInterval);
                this.keepOpenInterval = null;
            }
            this.hymnRef.id = null;
            this.hymnRef.name = '';
            this.query = '';
            this.results = [];
            this.open = false;
            this.lastFirestoreQuery = '';
            this.hadFuse = false;
        },
        onInput(el) {
            this.hymnRef.id = null;
            this.open = true;
            this.ensureInterval(el);
            this.search();
        }
    };
}

// Expose pure helpers for Node-based unit tests; ignored in the browser.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CANONICAL_MAPPING, worshipHelperInvolvementChanges, personRefSetChanges, parseBaptismNames, normalizeDottedKeys, coerceBaptismCandidates, flattenServiceForSave, changedFieldPaths, applyFlatFieldPath, pickSaveFields, remoteAdoptions, stepHref, stepToService, serviceForm };
}
