// A read whose RESULT DECIDES A WRITE — a merge, a re-point, a batch of
// deletes. In the phone app ordinary reads are answered from the device
// (local-cache.js); these must not be. Stale input to a write does not show
// you old data, it destroys new data: a merge planned from a people list a
// minute old silently drops whoever was added in that minute. Ignored on the
// web, where reads were always live.
var FRESH_READ = { source: 'server' };
// Which version of a hymn prints (ADR 0073). The page loads hymn-versions.js.

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
// The congregation's Liturgy Elements and Orders (ADR-0080). A global on the
// page; a require under node:test.
function liturgyCore() {
    if (typeof window !== 'undefined' && window.LiturgyOrderCore) return window.LiturgyOrderCore;
    return require('./liturgy-order-core.js');
}

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

// The liturgy slots, note keys, and element carriers a save descends into one
// level, so an edit names the slot it touched rather than the whole map.
// Anything else nested (guide, irregularElements) is written whole — it is
// rebuilt wholesale by whoever owns it, so a partial write of it would mean
// less, not more.
//
// `carriedBy.<elementId>` is the one person who carries a Liturgy Element
// marked hasRole (ADR-0080): kept beside the value, keyed the same way the
// notes are, so it is not a second element and not a second column.
const NESTED_SAVE_MAPS = ['liturgy', 'notes', 'carriedBy'];

// ── Row identity for the lists a person is picked into (MS-277) ─────────────
//
// Music Helpers, Baptism Candidates and the irregular elements are LISTS, and
// each row of one mounts its own picker. A picker takes the entry OBJECT once,
// when its row is first drawn, and mutates that object forever after — see
// personPicker.
//
// Alpine reuses a row when its `:key` is unchanged: it refreshes the loop
// variable and leaves the row's x-data alone. So a list keyed by POSITION hands
// row 0 the second helper's data while row 0's picker is still wired to the
// first helper's object. Take Ann out of [Ann, Ben] and the row reads "Ann"
// while the document says "Ben", and the next name typed into it goes into an
// object no longer on the model — saved nowhere, with nothing on screen to say
// so. That is the whole "music assignments switch around" bug.
//
// So a row is keyed by the ENTRY, not by where the entry sits. `_rowId` is that
// key: a handle for the screen, minted when an entry appears and carried for as
// long as it lives.
//
// It is deliberately NOT part of the Sunday. flattenServiceForSave strips it,
// so it never reaches Firestore, and serviceSnapshot strips it, so it never
// makes a Sunday look edited.
const ROW_ID = '_rowId';
let _rowIdSeq = 0;

// A locally-created row: nothing else can be holding this id.
function newRowId() {
    _rowIdSeq += 1;
    return 'row-' + _rowIdSeq;
}

// A row that arrived from the document rather than from this screen. Derived
// from the entry rather than from a counter because applyFlatFieldPath runs
// over BOTH the live model and the loaded snapshot, and two counter values
// would leave those two disagreeing about a Sunday nobody had edited — which
// reads as permanently unsaved and autosaves in a loop.
function derivedRowId(entry, index) {
    const id = entry && entry.id;
    return id ? 'p:' + id : 'n:' + index;
}

// Deep copy with every `_rowId` left behind.
function withoutRowIds(value) {
    if (value === undefined) return value;
    return JSON.parse(JSON.stringify(value, (k, v) => (k === ROW_ID ? undefined : v)));
}

// The editor's model as a string to compare against — what `isDirty` asks and
// what a save records as "this is now what is stored". Row ids are screen state,
// so a Sunday whose rows were merely re-keyed is not a Sunday with unsaved work.
function serviceSnapshot(service) {
    return JSON.stringify(service, (k, v) => (k === ROW_ID ? undefined : v));
}

// A list of Person references, brought in line with `incoming` WITHOUT
// replacing the objects the pickers hold.
//
// The same care liturgy slots already get (see applyFlatFieldPath: "Preserve
// reference for components like hymnPicker"), for the lists that were missing
// it. An entry that is still in the list keeps its object and its row; one that
// has gone takes its row with it; a new one gets a new object and a new row.
//
// Matched by Person id first, so somebody who merely moved up the list keeps
// the row they are in. Unlinked entries — a half-typed name with no Person yet
// — are matched in the order they are left in, which is the only order they
// have.
function reconcilePersonList(current, incoming) {
    const list = Array.isArray(current) ? current : [];
    const next = Array.isArray(incoming) ? incoming : [];

    const byId = new Map();
    const unlinked = [];
    for (const entry of list) {
        if (entry && entry.id) {
            if (!byId.has(entry.id)) byId.set(entry.id, entry);
        } else if (entry) {
            unlinked.push(entry);
        }
    }

    const out = [];
    next.forEach((raw, index) => {
        const wanted = raw || {};
        let kept = null;
        if (wanted.id && byId.has(wanted.id)) {
            kept = byId.get(wanted.id);
            byId.delete(wanted.id);
        } else if (!wanted.id && unlinked.length) {
            kept = unlinked.shift();
        }

        if (kept) {
            kept.id = wanted.id || null;
            kept.name = wanted.name || '';
            out.push(kept);
            return;
        }

        const made = { name: wanted.name || '', id: wanted.id || null };
        made[ROW_ID] = derivedRowId(wanted, index);
        out.push(made);
    });

    // In place: the array itself is bound to the x-for, so a fresh one would
    // leave every row on screen looking at a list the model no longer has.
    list.length = 0;
    list.push(...out);
    return list;
}

// Stamp row ids onto a list of Person references read out of the document.
function withRowIds(entries) {
    return (Array.isArray(entries) ? entries : []).map(entry => {
        const row = { name: (entry && entry.name) || '', id: (entry && entry.id) || null };
        row[ROW_ID] = newRowId();
        return row;
    });
}

// The same, for a list whose entries are not Person references — the irregular
// elements, which are {key, type, value} and carry a picker of their own. Kept
// whole rather than rebuilt to a known shape, because an element's `value` is
// whatever its type says it is.
//
// `derived` mints ids from position for the adoption path, where this runs over
// both the live model and the loaded snapshot and the two must not diverge.
function stampRowIds(entries, derived) {
    return (Array.isArray(entries) ? entries : []).map((entry, index) => {
        const row = Object.assign({}, entry);
        if (!row[ROW_ID]) row[ROW_ID] = derived ? 'e:' + index : newRowId();
        return row;
    });
}

// The editor's nested in-memory model, flattened to the shape the `services`
// document actually stores (name and id side by side rather than a ref object).
// Pure, and the same function is run over the loaded snapshot and over the
// current model, so `changedFieldPaths` gets two things it can compare
// like-for-like. The parts of a save that are not a function of the model —
// the timestamp, the guide record, involvementDeferred — are added by save().
// The two pastoral-prayer subjects, in the shape decidePastoralPrayerSave reads.
// A blank slot is null, not an empty string, so it is not a person id.
function pastoralSunday(service, date) {
    const slotId = (field) => {
        const liturgy = service && service.liturgy;
        const slot = liturgy && liturgy[field];
        const id = slot && slot.id;
        return (typeof id === 'string' && id) ? id : null;
    };
    return {
        date: date,
        prayerMaleId: slotId('prayerMale'),
        prayerFemaleId: slotId('prayerFemale'),
    };
}

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
        // Which Liturgy Order this Sunday follows. Empty reads as Standard.
        liturgyOrderId: s.liturgyOrderId || '',
        // Kept as stored so an older Irregular Service round-trips untouched;
        // nothing on this page edits either any more (ADR-0080).
        isIrregular: s.isIrregular,
        // Both carry lists whose rows are keyed by `_rowId` (irregular elements
        // directly, liturgy through its people elements). The id is a handle
        // for the screen, so it is left behind on the way to the document — and
        // on the way into changedFieldPaths, or re-keying a row would read as a
        // changed field and write a Sunday nobody edited.
        irregularElements: withoutRowIds(s.irregularElements),
        notes: s.notes,
        carriedBy: s.carriedBy || {},
        liturgy: withoutRowIds(s.liturgy)
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
    'liturgyOrderId', 'isIrregular', 'irregularElements', 'notes', 'carriedBy', 'liturgy'
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
        } else if (map === 'liturgy' && Array.isArray(value)) {
            // A people element (Baptism Candidates, or any other) is a list of
            // Person references with a picker per row, so it is brought in
            // line rather than swapped out — same reason as the slot above,
            // and see reconcilePersonList.
            if (!Array.isArray(service[map][slot])) service[map][slot] = [];
            reconcilePersonList(service[map][slot], value);
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

    if (path === 'musicHelpers') {
        // A list of Person references with a picker per row. Replacing the
        // array — which is what this used to do — left every helper box on
        // screen holding an object that was no longer on the model, so the next
        // name typed into one went nowhere. The hymn slots above have always
        // been careful about this; the helper list was not.
        if (!Array.isArray(service.musicHelpers)) service.musicHelpers = [];
        reconcilePersonList(service.musicHelpers, value);
        return true;
    }

    if (path === 'irregularElements') {
        // Rebuilt wholesale by whoever owns it (see NESTED_SAVE_MAPS), so the
        // rows are rebuilt with it — but they still need ids, or the x-for has
        // nothing to key on.
        service.irregularElements = stampRowIds(value, true);
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

function describeLiturgyReadFailure(error) {
    const code = error && error.code;
    if (code === 'permission-denied') {
        return 'The liturgy orders could not be read. This is a permissions problem, not a connection problem. Standard is shown in their place.';
    }
    if (code === 'unavailable') {
        return 'The liturgy orders could not be reached. Check your connection and try again. Standard is shown in their place.';
    }
    return 'The liturgy orders did not load. Try again. Standard is shown in their place.';
}

function serviceForm() {
    return {
        // Closed until auth answers. An undeclared flag is a ReferenceError in
        // every x-show that names it, not a false.
        canDecide: false,
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
        filesOpened: false,
        announcementsOpened: false,
        announcementsSeen: false,
        typedAnnouncements: [],
        printedSources: [],
        announcementsLoading: false,
        announcementsSaving: false,
        announcementsError: '',
        announcementsStatus: '',
        // Prayer Request per pastoral-prayer subject, visible to elders only.
        prayerRequests: {
            male: { text: '', initialSentDate: null, reminderSent: false, source: null, noteGenerated: false },
            female: { text: '', initialSentDate: null, reminderSent: false, source: null, noteGenerated: false },
        },
        prayerSending: { male: false, female: false },
        _prayerLoaded: {},
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
        hymnRegistry: [],
        fuse: null,
        peopleRegistry: [],
        peopleFuse: null,
        // Service Theme similarity (docs/plans/theme-similarity.md).
        // Advisory only — nothing here blocks or changes a save.
        themeSimilaritySession: null,
        themeScore: null,        // { uniqueness, matches } | null
        themeScoreLoading: false,
        themeScoreError: null,
        // Scoring can start as soon as the service loads (so it's ready the
        // moment you look), but the readout only DISPLAYS once you've
        // actually focused the field — otherwise every visit to the page
        // opens with a uniqueness readout nobody asked to see yet.
        themeFieldFocused: false,
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
            // Song elements the user has pulled out of this Sunday. Each entry
            // is an element id (e.g. 'hymn2'). Removed songs are kept in the
            // liturgy data but skipped by the service guide generator, which pads the
            // freed pages with extra sermon-notes pages instead.
            removedHymns: [],
            liturgyOrderId: '',
            notes: {},
            carriedBy: {},
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

        // ── Liturgy Orders (ADR-0080) ──────────────────────────────────────────
        // The congregation's elements and orders. Starts as the Standard seed so
        // the page draws before the read lands; init() reads the real catalog
        // BEFORE load(), so every element's empty slot is on the model before
        // the loaded snapshot is taken and an unfilled slot never reads as an
        // unsaved edit.
        liturgyCatalog: liturgyCore().standardCatalog(),
        liturgyCatalogLoaded: false,
        liturgyStored: null,
        liturgyReadProblem: '',

        async loadLiturgyCatalog() {
            if (!window.LiturgyOrderStore) return;
            try {
                const read = await LiturgyOrderStore.load(db);
                this.liturgyCatalog = read.catalog;
                this.liturgyStored = read.stored;
                this.liturgyCatalogLoaded = true;
                this.liturgyReadProblem = '';
                this.releaseQuietRow();
            } catch (err) {
                // The seed stays on screen so the Sunday can still be read.
                // This page does not write the order.
                console.warn('Liturgy orders could not be read; using Standard.', err);
                this.liturgyCatalogLoaded = false;
                this.liturgyStored = null;
                this.liturgyReadProblem = describeLiturgyReadFailure(err);
            }
        },

        // Every order, Standard first and then by name — the same order the
        // Service calendar lists them in.
        get liturgyOrders() {
            const Core = liturgyCore();
            return Core.toggledOrders(this.liturgyCatalog, this.liturgyCatalog.orders.map(o => o.id));
        },
        get selectedOrderId() {
            return liturgyCore().orderFor(this.service, this.liturgyCatalog).id;
        },
        get orderElements() {
            return liturgyCore().elementsFor(this.service, this.liturgyCatalog);
        },
        orderLabel(order) {
            return order.id === liturgyCore().STANDARD_ORDER_ID ? order.name + ' (default)' : order.name;
        },

        // This Sunday follows another order. Only the Sunday's pointer moves:
        // the shared order is untouched, and values under elements the new
        // order leaves out stay on the document, hidden.
        changeLiturgyOrder(id) {
            if (!this.canEdit || !id || id === this.selectedOrderId) return;
            this.service.liturgyOrderId = id;
            this._ensureLiturgySlots();
            if (this.openKey && !this.orderElements.some(el => el.id === this.openKey)) this.closeRow();
            this.releaseQuietRow();
        },

        // The order is locked on this page. Its shape changes on the Liturgy
        // Orders page, and this Sunday only fills the values.
        legacyHomes() {
            const order = liturgyCore().orderFor(this.service, this.liturgyCatalog);
            const label = this.service.liturgy && this.service.liturgy.prayerLabel;
            return liturgyCore().legacyPrayerHomes(order, label);
        },
        showsPraise(item) {
            const homes = this.legacyHomes();
            if (homes.praiseId) return item.key === homes.praiseId;
            return !!item.legacy;
        },
        showsConfession(item) {
            const homes = this.legacyHomes();
            if (homes.confessionId) return item.key === homes.confessionId;
            return !!item.legacy;
        },
        showsPastoral(item) {
            const homes = this.legacyHomes();
            if (homes.pastoralId) return item.key === homes.pastoralId;
            return !!item.legacy;
        },
        kindLabel(kind) {
            const labels = liturgyCore().KIND_LABELS;
            return (labels && labels[kind]) || kind;
        },
        elementKind(el) {
            return this.kindLabel(el && el.kind);
        },
        get currentOrderName() {
            return liturgyCore().orderFor(this.service, this.liturgyCatalog).name;
        },

        // An empty value under every element the catalog knows and a carrier
        // box for every element that needs a person, so a picker always has an
        // object to bind to. Never overwrites a stored value.
        _ensureLiturgySlots() {
            const Core = liturgyCore();
            if (!this.service.carriedBy || typeof this.service.carriedBy !== 'object') this.service.carriedBy = {};
            for (const el of this.liturgyCatalog.elements) {
                if (el.kind === 'other') continue;
                const current = this.service.liturgy[el.id];
                if (el.kind === 'prayer' && el.requests) {
                    const arr = Array.isArray(current) ? current.slice() : [];
                    while (arr.length < el.requests.count) arr.push({ id: null, name: '' });
                    this.service.liturgy[el.id] = arr.slice(0, el.requests.count);
                } else if (current === undefined || current === null) {
                    this.service.liturgy[el.id] = Core.emptyValue(el.primitive);
                } else if (el.primitive === 'people' && !Array.isArray(current)) {
                    this.service.liturgy[el.id] = withRowIds(coerceBaptismCandidates(current));
                } else if (el.primitive === 'person' && (typeof current !== 'object' || Array.isArray(current))) {
                    this.service.liturgy[el.id] = { name: '', id: null };
                } else if (el.primitive === 'song' && typeof current === 'string') {
                    this.service.liturgy[el.id] = { name: current, id: null };
                }
                if ((el.prayedByOther || el.hasRole) && !this.service.carriedBy[el.id]) {
                    this.service.carriedBy[el.id] = { name: '', id: null };
                }
            }
        },

        // Baptism is the one element with a side effect elsewhere: its
        // candidates' baptismDate (ADR-0006). A Sunday has a baptism when its
        // order carries the element and somebody is on it.
        _orderHasBaptism(service) {
            const s = service || this.service;
            return liturgyCore().elementsFor(s, this.liturgyCatalog).some(el => el.id === 'baptism');
        },
        _deriveHasBaptism(service) {
            const s = service || this.service;
            const bap = s.liturgy && s.liturgy.baptism;
            const named = Array.isArray(bap) && bap.some(c => c && (c.id || (c.name && c.name.trim())));
            s.hasBaptism = this._orderHasBaptism(s) && named;
        },

        // Pastoral-prayer subjects (the two prayed-for members and their
        // request texts) are asked for unless this Sunday's prayer is
        // congregational.
        get showPrayerSubjects() {
            return this.service.liturgy.prayerLabel !== 'Congregational Prayer';
        },

        // The single shared routing rule (calendar + this page never drift).
        guideGenerateHref() {
            if (window.GuideStore) return GuideStore.guideHref(this.service, this.date);
            return 'service-guide-editor.html?date=' + encodeURIComponent(this.date);
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
        prayerMembers: [],

        async fetchPrayerSuggestions() {
            try {
                const now = new Date();
                const todayStr = DateUtils.toDateStr(now);

                // Fetch all members and sort locally to avoid composite index requirements
                const snap = await db.collection('people')
                    .where('tags', 'array-contains', 'Member')
                    .get();
                
                const members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                this.prayerMembers = members;

                const getTop3 = (sex) => PrayerSuggestions.topPrayerCandidates(members, sex, todayStr, 3);

                this.prayerSuggestions = {
                    males: getTop3('male'),
                    females: getTop3('female')
                };
            } catch (err) {
                console.error("Error fetching prayer suggestions:", err);
            }
        },

        // Everyone the prayer's dropdown can offer, oldest prayer first.
        // "Either" is the whole list. Male and female are that sex only.
        requestWho(item, idx) {
            const people = (item && item.requestPeople) || [];
            const line = people[idx];
            if (line && line.who) return line.who;
            return (item && item.requestsWho) || 'either';
        },
        prayerChoices(who, currentId) {
            const NEVER = '0000-00-00';
            const last = (m) => (m && m.lastPastoralPrayerDate) || NEVER;
            const list = (this.prayerMembers || [])
                .filter(m => who !== 'male' && who !== 'female' || m.sex === who)
                .slice()
                .sort((a, b) => String(last(a)).localeCompare(String(last(b))));
            if (currentId && !list.some(m => m.id === currentId)) {
                const found = (this.prayerMembers || []).find(m => m.id === currentId);
                if (found) list.unshift(found);
            }
            return list;
        },
        prayerLastLabel(person) {
            if (window.PastoralPrayerCore) return PastoralPrayerCore.lastPrayedLabel(person && person.lastPastoralPrayerDate);
            return '';
        },
        setPrayerPerson(key, index, personId) {
            const people = this.service.liturgy[key];
            if (!Array.isArray(people) || !people[index]) return;
            const found = (this.prayerMembers || []).find(m => m.id === personId);
            people[index].id = found ? found.id : null;
            people[index].name = found ? (found.name || '') : '';
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
            return this.originalService !== serviceSnapshot(this.service);
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
            if (key === 'files') this.filesOpened = true;
            if (key === 'announcements') {
                this.announcementsOpened = true;
                if (!this.announcementsSeen) {
                    this.announcementsSeen = true;
                    this.loadSundayAnnouncements();
                }
            }
        },

        // Typed lines belong to this Sunday. Printed lines belong to whatever
        // event wrote them — a class, a one-off, the Sunday Service — and this
        // tab only shows the ones the handed-out guide would print.
        async loadSundayAnnouncements() {
            if (!this.date || !window.SundayTypedCore || !window.PrintedAnnouncementGuide || !window.PrintedAnnouncementLines) return;
            this.announcementsLoading = true;
            this.announcementsError = '';
            try {
                const snap = await db.collection('services').doc(this.date).get();
                const service = snap.exists ? snap.data() : null;
                const items = window.SundayTypedCore.fromService(service).announcements || [];
                this.typedAnnouncements = items.map(item => ({
                    title: item.title || '',
                    content: item.content || '',
                }));
                const events = await window.PrintedAnnouncementGuide.eventsForSunday(db, this.date, {
                    level: this.currentPermissionLevel,
                    personId: this.me && this.me.id,
                });
                this.printedSources = window.PrintedAnnouncementLines.sourcesForSunday(this.date, events);
            } catch (e) {
                this.announcementsError = 'These announcements could not be read.';
                this.printedSources = [];
            } finally {
                this.announcementsLoading = false;
            }
        },

        addTypedAnnouncement() {
            this.typedAnnouncements.push({ title: '', content: '' });
            this.announcementsStatus = '';
        },

        removeTypedAnnouncement(index) {
            this.typedAnnouncements.splice(index, 1);
            this.announcementsStatus = '';
        },

        async saveSundayAnnouncements() {
            if (!this.canEdit || !this.date || !window.SundayTypedCore || this.announcementsSaving) return;
            this.announcementsSaving = true;
            this.announcementsStatus = '';
            try {
                const ref = db.collection('services').doc(this.date);
                const snap = await ref.get();
                const data = snap.exists ? snap.data() : {};
                const stored = window.SundayTypedCore.normalise(data.typedContent);
                stored.announcements = window.SundayTypedCore.asAnnouncements(this.typedAnnouncements);
                await ref.set({ typedContent: stored }, { merge: true });
                this.typedAnnouncements = stored.announcements.map(item => ({
                    title: item.title,
                    content: item.content,
                }));
                this.announcementsStatus = 'Saved.';
            } catch (e) {
                this.announcementsStatus = 'Could not save these announcements.';
            } finally {
                this.announcementsSaving = false;
            }
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
                        Object.assign(this, AccessCore.pageFlags(userData));
                        this.canEdit = this.canWriteEditor;
                        // Read the pastoral-prayer panel as an elder (or PA).
                        // Writing or texting a Prayer Request is a decision.
                        this.isShepherd = this.canReadElder;
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
            this.initThemeSimilarity();
            // Before load(): see liturgyCatalog.
            await this.loadLiturgyCatalog();
            await this.load();
            // Score whatever theme this Sunday already has, so returning to
            // a drafted service shows the readout immediately rather than
            // only after the next keystroke.
            if (this.service.theme) this.onThemeInput();
            // On a phone this page's own header is hidden and the app shell
            // draws one instead — which said "Service Editor" and named no
            // Sunday at all (MS-310). After load(), which is safely past the
            // DOMContentLoaded the shell builds its header on.
            if (this.shell === 'mobile' && typeof window.setMobileHeaderTitle === 'function') {
                window.setMobileHeaderTitle(DateUtils.formatDateMedium(this.date));
            }
            await this.loadHymnRegistry();
            await this.loadScriptureIndex();
            await this.loadPeopleRegistry();
            // Carried across a step so staffing several Sundays in a row does
            // not mean re-opening Roles each time (MS-303).
            //
            // After loadPeopleRegistry, not just after load(). The Roles panel
            // is handed `people: peopleRegistry` once, when Alpine first builds
            // it, and loadPeopleRegistry REPLACES that array rather than filling
            // it. Latch the tab any earlier and the panel keeps the empty list
            // it was born with: a Roles tab you cannot put anybody into.
            const askedTab = urlParams.get('tab');
            if (askedTab === 'roles' || askedTab === 'files' || askedTab === 'announcements') {
                this.openTab(askedTab);
            }
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

        // Every scripture reference ever used, folded into the book/chapter/
        // verse heat map the picker colors its buttons with
        // (usage-stats-store.js). Read off the shared UsageStats global
        // rather than kept on this component — verse-picker.js's inline
        // instances on the Service Calendar have no Alpine parent to thread
        // it through, so both pages populate the same one place.
        async loadScriptureIndex() {
            try {
                const references = await UsageStats.loadScriptureIndex(db);
                UsageStats.scriptureHeatMap = UsageStats.buildScriptureHeatMap(references);
            } catch (err) {
                console.error('Error loading scripture usage index:', err);
            }
        },

        // One debounced/memoized session for the lifetime of the page — see
        // theme-similarity-store.js. Synchronous: it only wires up the
        // Cloud Function callable, nothing is fetched until typing starts.
        initThemeSimilarity() {
            this.themeSimilaritySession = ThemeSimilarity.createSession({
                scoreThemeCallable: firebase.app().functions('us-central1').httpsCallable('scoreTheme'),
            });
        },

        // Bound to the Theme field's input event. Debounced network call —
        // advisory only, never blocks typing or saving.
        onThemeInput() {
            this.themeScoreError = null;
            this.themeScoreLoading = true;
            this.themeSimilaritySession.scoreDebounced(
                this.service.theme,
                this.date,
                (data) => {
                    this.themeScore = data;
                    this.themeScoreLoading = false;
                },
                (err) => {
                    console.error('Error scoring theme:', err);
                    this.themeScore = null;
                    this.themeScoreError = 'Could not check this theme right now.';
                    this.themeScoreLoading = false;
                },
            );
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
            const hymnFields = this.songElementIds;

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
                this.service.liturgyOrderId = typeof data.liturgyOrderId === 'string' ? data.liturgyOrderId : '';
                // An Irregular Service from before Liturgy Orders: its custom
                // elements are shown read-only and kept as stored (ADR-0080).
                this.service.isIrregular = data.isIrregular || false;
                this.service.irregularElements = stampRowIds(data.irregularElements);
                
                this.service.serviceLeader.name = data.serviceLeader || '';
                this.service.serviceLeader.id = data.serviceLeaderId || null;
                this.service.musicLeader.name = data.musicLeader || '';
                this.service.musicLeader.id = data.musicLeaderId || null;
                // Row ids so each helper box is drawn against the helper it is
                // wired to, rather than against whatever is in that position.
                this.service.musicHelpers = withRowIds(data.musicHelpers);
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

                this.service.removedHymns = Array.isArray(data.removedHymns) ? data.removedHymns : [];
                this.service.notes = data.notes || {};
                const carriedBy = {};
                Object.entries(data.carriedBy || {}).forEach(([key, ref]) => {
                    if (ref && typeof ref === 'object') carriedBy[key] = { name: ref.name || '', id: ref.id || null };
                });
                this.service.carriedBy = carriedBy;

                // Every liturgy value on the document, whichever order it was
                // filled under: a value under an element this order leaves out
                // is hidden, never dropped (ADR-0080).
                if (data.liturgy) {
                    for (const key in data.liturgy) {
                        const val = data.liturgy[key];
                        const current = this.service.liturgy[key];
                        if (val && typeof val === 'object' && !Array.isArray(val) &&
                            current && typeof current === 'object' && !Array.isArray(current)) {
                            // Preserve reference for components like hymnPicker
                            Object.assign(current, val);
                        } else {
                            this.service.liturgy[key] = val;
                        }
                    }
                }
                // People elements are arrays of Person refs. A legacy free-text
                // value (pre-migration) is wrapped as a single literal entry so
                // it still displays; the migration resolves it properly.
                for (const el of this.liturgyCatalog.elements) {
                    if (el.primitive !== 'people') continue;
                    this.service.liturgy[el.id] = withRowIds(coerceBaptismCandidates(this.service.liturgy[el.id]));
                }
                // Who decided each element (MS-246). Read-only on this page —
                // it is written by the save, never edited directly — so it is
                // kept off flattenServiceForSave and moved by hand.
                this.service[ServiceAuthorship.FIELD] = data[ServiceAuthorship.FIELD] || {};
            }
            this._ensureLiturgySlots();
            // Read off the order and the candidates, not the stored flag, so
            // the save that follows an edit and this snapshot agree.
            this._deriveHasBaptism();
            this.originalService = serviceSnapshot(this.service);
        },

        // ── Prayer Requests (pastoral-prayer subjects) ─────────────────────────
        // Elder/super-admin only. Each subject's Prayer Request and send-state
        // live on people/{id}/prayer_requests/{serviceDate} — a separate record
        // from the pastoral_prayer_history entry that says they were a subject
        // at all, because a request is sensitive and the history is not.

        blankPrayerRequest() {
            return { text: '', initialSentDate: null, reminderSent: false, source: null, noteGenerated: false };
        },

        subjectFor(which) {
            if (which === 'male') return this.service.liturgy.prayerMale || { id: null, name: '' };
            if (which === 'female') return this.service.liturgy.prayerFemale || { id: null, name: '' };
            for (const el of this.orderElements) {
                if (!el.requests) continue;
                const list = this.service.liturgy[el.id];
                if (!Array.isArray(list)) continue;
                const hit = list.find(p => p && p.id === which);
                if (hit) return hit;
            }
            const person = (this.peopleRegistry || []).find(p => p.id === which);
            return { id: which, name: person ? person.name : '' };
        },

        prayerRequestKeys() {
            const keys = ['male', 'female'];
            for (const el of this.orderElements) {
                if (!el.requests) continue;
                const list = this.service.liturgy[el.id];
                if (!Array.isArray(list)) continue;
                list.forEach(slot => { if (slot && slot.id && keys.indexOf(slot.id) === -1) keys.push(slot.id); });
            }
            return keys;
        },

        // A Prayer Request is read far more often than it is typed, and a texted
        // reply can arrive at any length — so the box grows to its whole content
        // rather than hiding it behind a two-row scroll.
        autoResize(el) {
            if (!el) return;
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
        },

        async loadOnePrayerRequest(which) {
            const subject = this.subjectFor(which);
            const blank = this.blankPrayerRequest();
            if (!subject || !subject.id) {
                this.prayerRequests[which] = blank;
                return;
            }
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
                if (!this.prayerRequests[which]) this.prayerRequests[which] = blank;
            }
        },

        async loadPrayerRequests() {
            if (!this.isShepherd || !this.date) return;
            this._prayerLoaded = {};
            for (const which of this.prayerRequestKeys()) {
                await this.loadOnePrayerRequest(which);
                this._prayerLoaded[which] = true;
            }
        },

        ensurePrayerRequest(which) {
            if (!which) return;
            if (!this.prayerRequests[which]) this.prayerRequests[which] = this.blankPrayerRequest();
            if (this.prayerSending[which] == null) this.prayerSending[which] = false;
            if (!this.isShepherd || !this.date || this._prayerLoaded[which]) return;
            this._prayerLoaded[which] = true;
            this.loadOnePrayerRequest(which);
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
            if (!this.canDecide) return;
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
                    await personRef.update({ lastNoteAt: now });
                    await reqRef.update({ noteGenerated: true });
                    state.noteGenerated = true;
                }
                alert('Prayer request saved.');
            } catch (e) {
                console.error('Error saving prayer request:', e);
                alert('Error saving prayer request. Check console.');
            }
        },

        // Whether the manual "Send Now" button can fire. The server picks the
        // route, so a missing phone is not a reason to hide the button: the
        // person may have the app. A filled request still has nothing to ask.
        canSendPrayerText(which) {
            if (!this.canDecide) return false;
            const subject = this.subjectFor(which);
            if (!subject || !subject.id) return false;
            if ((this.prayerRequests[which].text || '').trim()) return false;
            return true;
        },

        prayerSendTitle(which) {
            const subject = this.subjectFor(which);
            if (!subject || !subject.id) return 'Select this person and save first';
            if ((this.prayerRequests[which].text || '').trim()) return 'Already filled — nothing to send';
            if (!this.canSendPrayerText(which)) return 'Nothing to send';
            return 'Tell this person — Mosaic picks how';
        },

        async sendPrayerRequestNow(which) {
            if (!this.canDecide) return;
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
                alert(`${data.kind === 'reminder' ? 'Reminder' : 'Initial request'} sent to ${subject.name}.`);
            } catch (e) {
                console.error('Error sending prayer request:', e);
                alert(e.message || 'Could not send.');
            } finally {
                this.prayerSending[which] = false;
            }
        },

        // An Irregular Service from before Liturgy Orders, read-only: its own
        // elements, each as one line, so nothing it carried is out of sight.
        get irregularRows() {
            if (!this.service.isIrregular) return [];
            return (this.service.irregularElements || []).map((el, index) => {
                const v = el && el.value;
                const text = (v && typeof v === 'object') ? (v.name || '') : (v == null ? '' : String(v));
                return { key: (el && el[ROW_ID]) || 'i' + index, label: (el && el.key) || 'Untitled', value: text };
            });
        },

        async validateForm() {
            this.$nextTick(() => {
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

                // The same slots the progress fraction counts. A hymn pulled
                // out of the order is not in the list. A typed hymn that is
                // not linked to the book is unfinished, same as a blank.
                const items = window.HomeDashboard.checklist(
                    flattenServiceForSave(this.service), this.liturgyCatalog);
                for (const item of items) {
                    if (item.state === 'set') continue;
                    if (highlight(item.key)) return;
                }

                // A people element the tally calls set can still be a typed
                // name with no person behind it. Fix the blanks lands on that
                // row too.
                for (const el of this.orderElements) {
                    if (el.primitive !== 'people') continue;
                    const people = this.service.liturgy[el.id] || [];
                    if (Array.isArray(people) && people.some(c => c && c.name && !c.id) && highlight(el.id)) return;
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

                // Baptism presence is read off this Sunday's Liturgy Order and its
                // candidates (ADR-0080), so the candidate sync below and the saved
                // flag agree with what the page shows.
                this._deriveHasBaptism();

                // 1c. Process Baptism Candidates: each baptized Person's baptismDate is
                // this service's date. The effective set is empty when the Sunday's
                // order leaves Baptism out, so switching to such an order clears the
                // dates it set, and switching back sets them again.
                const oldCandidates = (original.hasBaptism && Array.isArray(original.liturgy.baptism)) ? original.liturgy.baptism : [];
                const newCandidates = (this.service.hasBaptism && Array.isArray(this.service.liturgy.baptism)) ? this.service.liturgy.baptism : [];
                const baptismChanges = personRefSetChanges(oldCandidates, newCandidates);
                for (const personId of baptismChanges.added) {
                    batch.update(db.collection('people').doc(personId), { baptismDate: this.date });
                }
                for (const personId of baptismChanges.removed) {
                    await this._clearBaptismDateIfThisService(batch, personId);
                }

                // Pastoral prayer is decided after the reads above, from the
                // Sunday this save is about to write. Noting the subjects and
                // then writing the Service from a later model is how a subject
                // chosen during the wait landed on the Service and missed the
                // history. The clone taken inside loadLive is that Sunday: the
                // history decision and the Service update both use it, and it
                // is what "already saved" means when the write lands. An edit
                // that arrives after the last read stays on the page, so the
                // next save writes it instead of treating it as done.
                let frozenService = null;
                const loadedSunday = pastoralSunday(original, this.date);
                const taken = await PastoralPrayerCore.takeSundayAfterHistoryRead(
                    loadedSunday,
                    () => {
                        frozenService = JSON.parse(JSON.stringify(this.service));
                        return pastoralSunday(frozenService, this.date);
                    },
                    (personIds) => this._readPastoralHistories(personIds)
                );
                const prayerDecision = PastoralPrayerCore.decidePastoralPrayerSave(
                    loadedSunday, taken.savedSunday, taken.historyByPerson);
                PastoralPrayerCore.writePastoralPrayerDecision(
                    batch, db.collection('people'), prayerDecision,
                    firebase.firestore.FieldValue.serverTimestamp());
                // Write only what THIS editor changed.
                //
                // A Sunday is edited by several people at once at a guide-writing
                // session, so the old whole-document save was a silent clobber:
                // it sent every slot it held, and a slot left blank on this screen
                // overwrote the same slot another editor had just filled. Diffing
                // the flattened model against the flattened snapshot we loaded
                // leaves an untouched slot out of the write entirely, so it cannot
                // lose a race it never entered. See changedFieldPaths.
                const flatNow = flattenServiceForSave(frozenService);
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
                    },
                       // Nested, because set() reads a dot as part of a field
                       // NAME. Without this the first save of a brand-new
                       // Sunday would be the one save that records nobody.
                       firstStamps ? { [ServiceAuthorship.FIELD]: firstStamps } : {}
                    ), { merge: true });
                }

                await batch.commit();
                committed = true;
                this._docExists = true;
                this.originalService = serviceSnapshot(frozenService);
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

            if (adopted) this.originalService = serviceSnapshot(original);
        },

        scheduleSave() {
            if (!this.canEdit || this.saving) return;
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => {
                // save() rewrites parts of `service` (the derived baptism flag),
                // which trips the watcher again. Re-checking isDirty here is what stops
                // that from becoming a save loop.
                if (this.isDirty && !this.saving) this.save();
            }, 3000);
        },

        // ── Order of Service model (one station row per Liturgy Element) ───────
        // The rows are this Sunday's Liturgy Order, in its order (ADR-0080). The
        // HTML renders one generic template per primitive, so the pickers below
        // stay wired to the same service.liturgy field objects.
        _ROW_TYPES: { song: 'hymn', scripture: 'verse', text: 'text', people: 'people', prayer: 'prayer', person: 'person', other: 'other' },

        // Dot colour by element status (canonical/literal hymns, set values,
        // people, or empty) — kept within the brand palette.
        _dotColor(status) {
            return status === 'canonical' ? 'var(--success)'
                : status === 'literal' ? 'var(--warning)'
                : status === 'set' ? 'var(--secondary)'
                : status === 'people' ? 'var(--primary)'
                : 'var(--outline-variant)';
        },

        _stripHtml(html) {
            if (!html) return '';
            const d = document.createElement('div');
            d.innerHTML = html;
            return d.textContent || d.innerText || '';
        },

        _buildItem(el, lit) {
            const key = el.id;
            const type = this._ROW_TYPES[el.primitive];
            const removed = type === 'hymn' && this.isHymnRemoved(key);
            let value = '', status = 'empty', emptyLabel = '';
            if (type === 'hymn') {
                const ref = lit[key] || {};
                value = ref.name || '';
                status = ref.id ? 'canonical' : (ref.name ? 'literal' : 'empty');
                emptyLabel = 'Choose a hymn…';
            } else if (type === 'people') {
                const arr = Array.isArray(lit[key]) ? lit[key] : [];
                const names = arr.map(c => (c && c.name) || '').filter(Boolean);
                value = names.join(', ');
                status = names.length ? 'people' : 'empty';
                emptyLabel = 'Add people…';
            } else if (type === 'text') {
                value = typeof lit[key] === 'string' ? lit[key] : '';
                status = value.trim() ? 'set' : 'empty';
                emptyLabel = 'Add text…';
            } else if (type === 'prayer') {
                const arr = Array.isArray(lit[key]) ? lit[key] : [];
                const names = arr.map(c => (c && c.name) || '').filter(Boolean);
                value = names.join(', ');
                status = names.length ? 'people' : 'empty';
                emptyLabel = el.requests ? 'Choose who is prayed for…' : '';
                if (!el.requests && el.prayedByOther) {
                    const who = liturgyCore().carrierOf(this.service, el);
                    value = who ? who.name : '';
                    status = value ? 'people' : 'empty';
                    emptyLabel = 'Name who prays…';
                }
            } else if (type === 'person') {
                const ref = lit[key] && !Array.isArray(lit[key]) ? lit[key] : {};
                value = ref.name || '';
                status = ref.id || ref.name ? 'people' : 'empty';
                emptyLabel = 'Choose a person…';
            } else if (type === 'other') {
                value = '';
                status = 'empty';
                emptyLabel = '';
            } else {
                value = typeof lit[key] === 'string' ? lit[key] : '';
                status = value ? 'set' : 'empty';
                emptyLabel = 'Add a reference…';
            }
            const carrier = (el.prayedByOther || el.hasRole) ? liturgyCore().carrierOf(this.service, el) : null;
            const note = (this.service.notes && this.service.notes[key]) || '';
            return {
                key, label: el.name, type, value, status, emptyLabel, removed,
                requests: el.requests || null,
                requestsWho: el.requests ? el.requests.who : 'either',
                requestPeople: el.requests && el.requests.people ? el.requests.people : [],
                prayedByOther: !!el.prayedByOther,
                hasRole: el.hasRole,
                carrierName: carrier ? carrier.name : '',
                noteOn: el.hasNote,
                dotColor: this._dotColor(status),
                noted: el.hasNote && !!this._stripHtml(note).trim(),
            };
        },

        // This Sunday's station rows. Changing the order changes which rows
        // show; no value is dropped.
        get rows() {
            const lit = this.service.liturgy;
            return this.orderElements.map(el => this._buildItem(el, lit));
        },

        // The locked order, plus one trailing row when an older prayer field
        // has no element to sit under. That row is not part of the order.
        get displayRows() {
            const rows = this.rows.slice();
            const homes = this.legacyHomes();
            if (homes.praiseId && homes.confessionId && homes.pastoralId) return rows;
            rows.push({
                key: '__legacy_prayer__',
                type: 'legacy',
                legacy: true,
                label: '',
                removed: false,
                requests: null,
                prayedByOther: false,
                hasRole: false,
                noteOn: false,
                value: '',
                emptyLabel: '',
                noted: false,
                carrierName: '',
            });
            return rows;
        },

        // The order's song elements, for linking typed hymns and printing
        // music sheets.
        get songElementIds() {
            return liturgyCore().songIdsOf(
                liturgyCore().orderFor(this.service, this.liturgyCatalog), this.liturgyCatalog);
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

        // "X of Y set" — the same tally the home card and the phone use
        // (home-dashboard-core). This page used to add theme, the key verse,
        // and the optional prayer leaders, and to count a hymn name as finished
        // before it was linked, so the two screens disagreed.
        get filledLabel() {
            const ready = window.HomeDashboard.readiness(
                flattenServiceForSave(this.service), this.liturgyCatalog);
            // An old irregular Sunday has not been given an order yet. The
            // fraction would score it as a blank Standard, which it is not.
            return ready.irregular ? 'Custom order' : ready.fraction;
        },

        // Service notes surfaced for the leader, in service order, one card
        // each. Only elements that take a note; a note under an element whose
        // note was switched off is kept on the document, not shown.
        get notesList() {
            const out = [];
            const notes = this.service.notes || {};
            for (const it of this.rows) {
                if (!it.noteOn) continue;
                const html = notes[it.key];
                if (html && this._stripHtml(html).trim()) {
                    out.push({ key: it.key, label: it.label, value: it.value, dotColor: it.dotColor, html });
                }
            }
            return out;
        },
        get noteCount() { return this.notesList.length; },

        // A row opens only when its panel has a field. A hymn, a scripture, a
        // line of text, or a person is entered there. So is a prayer's people
        // and its leader, and the older praise, confession, and pastoral
        // fields that belong to this row. A prayer or an Other that is only a
        // name on the order has nothing to enter, so it stays closed.
        rowOpens(item) {
            if (!item || item.removed || item.type === 'legacy') return false;
            if (item.noteOn || item.hasRole || item.requests || item.prayedByOther) return true;
            if (this.showsPraise(item) || this.showsConfession(item) || this.showsPastoral(item)) return true;
            return item.type === 'hymn' || item.type === 'verse' || item.type === 'text'
                || item.type === 'people' || item.type === 'person';
        },

        // The open row lost its field (the order changed, or the note came off).
        releaseQuietRow() {
            if (!this.openKey) return;
            const item = this.displayRows.find(r => r.key === this.openKey);
            if (!this.rowOpens(item)) this.closeRow();
        },

        // ── Station rows + inline notes ─────────────────────────────────────────
        // Expanding a row reveals its picker and a rich-text Service Note. The note
        // is a single Quill instance mounted into whichever row is open; switching
        // rows commits the current note first, so service.notes stays in sync (and
        // the Service Notes sidebar updates live).
        toggleRow(key) {
            const item = this.displayRows.find(r => r.key === key);
            if (!this.rowOpens(item)) {
                if (this.openKey === key) this.closeRow();
                return;
            }
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

        // ── The music box (MS-277) ──────────────────────────────────────────
        //
        // The Music Leader and the Music Helpers under him are ONE box, because
        // the helpers are one FIELD: `musicHelpers` is a list, and ADR-0034
        // compares a list whole and writes it whole ("a list is edited as a
        // list"). So two men each adding a helper is not the disjoint write
        // that saves every other slot — whoever's timer lands second writes his
        // whole list over the other's, and a helper disappears with nothing to
        // show it ever arrived.
        //
        // That is the last of the clobber ADR-0034 removed everywhere else, and
        // ADR-0035 already decided what to do with a conflict that field-level
        // saves cannot make disjoint: prevent it at the door rather than
        // resolve it afterwards. So the music box is claimed like a liturgy
        // row, and one man at a time writes it.
        //
        // Leader and helpers together rather than a box each: they are one box
        // on screen already, and it is the same act — settling who is on music
        // this Sunday.
        MUSIC_BOX: 'musicLeader',

        takeMusicBox() {
            if (!this.canEdit) return true;
            if (this.heldByMusic) return false;
            return PresenceStore.claim(this.date, this.MUSIC_BOX);
        },

        // Whoever else is in the music box, or null. Read off presenceEntries
        // rather than the store so Alpine redraws when they arrive or go.
        get heldByMusic() {
            if (!this.user) return null;
            return ServicePresence.holderOf(
                this.presenceEntries, this.user.uid, this.date, this.MUSIC_BOX, Date.now());
        },

        get musicHeldLabel() { return ServicePresence.holderLabel(this.heldByMusic); },
        get musicHeldTitle() { return ServicePresence.holderTitle(this.heldByMusic); },

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
            const item = this.displayRows.find(r => r.key === key);
            if (!this.rowOpens(item)) {
                this.$nextTick(() => this.scrollToRow(key));
                return;
            }
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
            this.service.musicHelpers.push({ name: '', id: null, [ROW_ID]: newRowId() });
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

        // ── People elements (Baptism Candidates, or any other) ───────────────
        addPerson(key) {
            if (!Array.isArray(this.service.liturgy[key])) this.service.liturgy[key] = [];
            this.service.liturgy[key].push({ name: '', id: null, [ROW_ID]: newRowId() });
        },

        removePerson(key, index) {
            if (Array.isArray(this.service.liturgy[key])) this.service.liturgy[key].splice(index, 1);
        },

        // ── Utility ────────────────────────────────────────────────────────────
        // Every liturgy value goes, whichever order it was filled under. The
        // Sunday keeps its Liturgy Order.
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
            this.service.carriedBy = {};
            const liturgy = {
                prayerMale: { id: null, name: '' },
                prayerFemale: { id: null, name: '' },
                prayerLabel: 'Pastoral Prayer',
            };
            Object.keys(this.service.liturgy || {}).forEach(key => {
                if (!(key in liturgy)) liturgy[key] = '';
            });
            this.service.liturgy = liturgy;
            for (const el of this.liturgyCatalog.elements) {
                this.service.liturgy[el.id] = liturgyCore().emptyValue(el.primitive);
            }
            this._ensureLiturgySlots();
        },

        formatDate(dateStr) {
            return DateUtils.formatDateLong(dateStr);
        },

        async downloadMusicSheets() {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF();

            const hymnFields = this.songElementIds;
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
                    const pages = HymnVersions.defaultPages(hymn);
                    if (!pages.length) continue;

                    for (const pageUrl of pages) {
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

            // One line per element in this Sunday's order, songs pulled out of
            // this Sunday left off.
            const visibleItems = this.rows
                .filter(it => !it.removed)
                .map(it => ({ label: it.label, value: it.value || '', italic: it.type === 'hymn' }));

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

        // Stored history dates (the doc id is the Sunday) for the people the
        // decision is about. Read before the Sunday is frozen, so a subject
        // chosen while this is in flight can still be taken afterwards.
        async _readPastoralHistories(personIds) {
            const stored = {};
            await Promise.all((personIds || []).map(async (personId) => {
                const snap = await this._pastoralPrayerHistory(personId).get(FRESH_READ);
                stored[personId] = snap.docs.map(doc => doc.id);
            }));
            return stored;
        }
    };
}

// `field` is the Order of Service "who" slot this picker fills —
// 'preacher', 'serviceLeader', 'prayerMale', etc. — used only to look up
// each candidate's cached usage stat (usage-stats-store.js). null for a
// picker this feature doesn't track (baptism candidates, irregular
// elements), which just shows no stat.
function personPicker(personRef, parent = null, suggestionsKey = null, field = null) {
    if (!personRef) personRef = { name: '', id: null };
    return {
        personRef: personRef,
        parent: parent,
        suggestionsKey: suggestionsKey,
        field: field,
        usageLabelFor(candidate) {
            if (!UsageStats.isTrackedField(this.field)) return '';
            return UsageStats.formatLabel(UsageStats.personStatFor(candidate, this.field));
        },
        // prayerMale/prayerFemale already show PastoralPrayerCore.lastPrayedLabel
        // (the one date label every surface uses) — this only adds the count
        // beside it, rather than replacing that wording with usageLabelFor's.
        prayerCountFor(candidate) {
            const stat = this.field && UsageStats.personStatFor(candidate, this.field);
            return stat && stat.count ? `${stat.count}×` : '';
        },
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
    module.exports = { worshipHelperInvolvementChanges, personRefSetChanges, parseBaptismNames, normalizeDottedKeys, coerceBaptismCandidates, flattenServiceForSave, changedFieldPaths, applyFlatFieldPath, pickSaveFields, remoteAdoptions, ROW_ID, newRowId, withRowIds, stampRowIds, reconcilePersonList, serviceSnapshot, stepHref, stepToService, serviceForm };
}
