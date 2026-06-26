const CANONICAL_MAPPING = {
    'Theme': { field: 'theme', type: 'text' },
    'Key Verse': { field: 'keyVerse', type: 'text' },
    'Service Leader': { field: 'serviceLeader', type: 'person' },
    'Music Leader': { field: 'musicLeader', type: 'person' },
    'Preacher': { field: 'preacher', type: 'person' },
    'Sermonette': { field: 'sermonette', type: 'person' },
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
        saving: false,
        canEdit: false,
        isShepherd: false,
        currentUserRole: 'viewer',
        // Prayer Request per pastoral-prayer subject, visible to elders only.
        prayerRequests: {
            male: { text: '', initialSentDate: null, reminderSent: false, source: null, noteGenerated: false },
            female: { text: '', initialSentDate: null, reminderSent: false, source: null, noteGenerated: false },
        },
        prayerSending: { male: false, female: false },
        user: null,
        originalService: '',
        activeNoteKey: null,
        showPrayerPraise: false,
        showPrayerConfession: false,
        noteEditorTop: 100,
        noteEditorLeft: 0,
        noteEditorWidth: 200,
        _quill: null,
        _scrollHandler: null,
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
            sermonette: { name: '', id: null },
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
            this.selectedTemplateId = id;
            this._rebuildSnapshot(true);
        },
        setUseLegacy(useLegacy) {
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

        async init() {
            auth.onAuthStateChanged(async (user) => {
                this.user = user;
                if (user) {
                    try {
                        const userData = await getUserData(user.uid);
                        const role = (userData && userData.role) || 'viewer';
                        this.currentUserRole = role;
                        this.canEdit = (['editor', 'elder', 'admin', 'super_admin'].includes(role));
                        this.isShepherd = ['elder', 'super_admin'].includes(role);
                        this.loadPrayerRequests();
                    } catch (error) {
                        console.error("Error checking user permissions:", error);
                        this.canEdit = false;
                    }
                } else {
                    this.canEdit = false;
                }
            });

            const urlParams = new URLSearchParams(window.location.search);
            this.date = urlParams.get('date');
            if (!this.date) {
                window.location.href = 'service-calendar.html';
                return;
            }
            await this.load();
            await this.loadGuideCatalog();
            await this.loadHymnRegistry();
            await this.loadPeopleRegistry();
            await this.loadPrayerRequests();
            await this.autoLinkHymns();
            await this.fetchPrayerSuggestions();

            if (urlParams.get('validate') === 'true') {
                this.validateForm();
            }

            window.addEventListener('beforeunload', (e) => {
                if (this.canEdit && this.isDirty) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });

            if (this.service.isIrregular) {
                this.$nextTick(() => this.initSortable());
            }
        },

        async loadHymnRegistry() {
            try {
                const getHymnIndex = firebase.app().functions('us-central1').httpsCallable('getHymnIndex');
                const result = await getHymnIndex();
                this.hymnRegistry = result.data;
            } catch (error) {
                console.warn("getHymnIndex failed, falling back to direct Firestore fetch:", error);
                try {
                    const snap = await db.collection('hymns').get();
                    this.hymnRegistry = snap.docs.map(doc => {
                        const data = doc.data();
                        return {
                            id: doc.id,
                            hymn_name: data.hymn_name || "Unknown",
                            variations: data.versions ? data.versions.length : 0,
                            music_writer: data.music_writer || "Unknown",
                            lyrics_writer: data.lyrics_writer || "Unknown",
                            last_played_date: data.last_played_date || null,
                            tags: data.tags || [],
                            database_url: `/hymns/${doc.id}`
                        };
                    });
                } catch (fsError) {
                    console.error("Error loading hymn registry from Firestore:", fsError);
                }
            }

            if (typeof Fuse !== 'undefined' && this.hymnRegistry && this.hymnRegistry.length > 0) {
                try {
                    // Initialize Fuse.js for fuzzy searching
                    this.fuse = new Fuse(this.hymnRegistry, {
                        keys: ['id', 'hymn_name', 'lyrics_writer', 'music_writer'],
                        threshold: 0.4, // Lenient threshold for matching prefixes/typos
                        distance: 100,
                        minMatchCharLength: 1, // Allow 1-character queries
                        includeScore: true
                    });
                } catch (fuseErr) {
                    console.error("Error creating Fuse instance for hymns:", fuseErr);
                }
            }
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
                this.service.sermonette.name = data.sermonette || '';
                this.service.sermonette.id = data.sermonetteId || null;
                
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
                // Store guide data to preserve/update it during save
                this.service.guide = data.guide || null;
                // Which Service Guide system this week is on (ADR-0010): explicit
                // toggle, else legacy for a pre-existing elements blob, else v2.
                if (window.GuideStore) this.guideSystem = GuideStore.guideSystemOf(data);
            }
            this.originalService = JSON.stringify(this.service);
        },

        // ── Prayer Requests (pastoral-prayer subjects) ─────────────────────────
        // Elder/super-admin only. Each subject's Prayer Request and send-state
        // live on people/{id}/pastoral_prayer_history/{serviceDate}.

        subjectFor(which) {
            return which === 'male' ?
                this.service.liturgy.prayerMale : this.service.liturgy.prayerFemale;
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
                    'Theme', 'Key Verse', 'Service Leader', 'Music Leader', 'Preacher', 'Sermonette',
                    'Prayer (Praise)', 'Prayer (Confession)', 'Baptism', 'Preparatory Hymn', 'Call to Worship',
                    'Hymn 1', 'Hymn 2', 'Call to Confession', 'Assurance of Pardon', 'Hymn Mid 1', 'Hymn Mid 2',
                    'Scripture Reading', 'Sermon', 'Hymn End 1', 'Hymn End 2', 'Benediction'
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

        async save() {
            this.saving = true;
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
                    { field: 'sermonette', role: 'sermonette' },
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

                // In the new system baptism presence is derived from the chosen
                // template (ADR-0010), not the "Include Baptism?" checkbox; reconcile
                // hasBaptism here so the candidate sync below and the saved flag match
                // the template. Legacy weeks keep the checkbox value as-is.
                if (this.guideSystem === 'v2' && this.guideSnapshot && window.GuideStore) {
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
                for (const { field, role } of liturgyRoles) {
                    const oldId = original.liturgy[field] ? original.liturgy[field].id : null;
                    const newId = this.service.liturgy[field].id;
                    if (oldId !== newId) {
                        if (oldId) {
                            await this._removePastoralPrayer(batch, oldId);
                            peopleToRecalculate.add(oldId);
                        }
                        if (newId) {
                            await this._addPastoralPrayer(batch, newId);
                            peopleToRecalculate.add(newId);
                        }
                    }
                }

                // Recalculate lastPastoralPrayerDate for affected people
                for (const personId of peopleToRecalculate) {
                    const latestDate = await this._calculateLatestPastoralPrayer(personId);
                    batch.update(db.collection('people').doc(personId), {
                        lastPastoralPrayerDate: latestDate
                    });
                }

                // Flatten service object for Firestore storage
                const toSave = {
                    theme: this.service.theme,
                    keyVerse: this.service.keyVerse,
                    serviceLeader: this.service.serviceLeader.name,
                    serviceLeaderId: this.service.serviceLeader.id,
                    musicLeader: this.service.musicLeader.name,
                    musicLeaderId: this.service.musicLeader.id,
                    musicHelpers: this.service.musicHelpers.map(h => ({ name: h.name || '', id: h.id || null })),
                    preacher: this.service.preacher.name,
                    preacherId: this.service.preacher.id,
                    sermonette: this.service.sermonette.name,
                    sermonetteId: this.service.sermonette.id,
                    prayerPraiseName: this.service.prayerPraise.name,
                    prayerPraiseId: this.service.prayerPraise.id,
                    prayerConfessionName: this.service.prayerConfession.name,
                    prayerConfessionId: this.service.prayerConfession.id,
                    elementsName: this.service.elements.name,
                    elementsId: this.service.elements.id,
                    otherName: this.service.other.name,
                    otherId: this.service.other.id,
                    hasBaptism: this.service.hasBaptism,
                    removedHymns: this.service.removedHymns || [],
                    isIrregular: this.service.isIrregular,
                    irregularElements: this.service.irregularElements,
                    notes: this.service.notes,
                    liturgy: this.service.liturgy,
                    guideSystem: this.guideSystem,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

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
                if (this.guideSystem === 'v2' && this.guideSnapshot && window.GuideStore) {
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
                // Use merge: true to preserve other top-level fields (like 'guide' if it wasn't updated here)
                batch.set(serviceRef, toSave, { merge: true });

                await batch.commit();
                this.originalService = JSON.stringify(this.service);
                console.log('Service and involvements saved successfully.');
            } catch (e) {
                if (e.code === 'permission-denied') {
                    alert('Permission denied. Your account does not have permission to save services.');
                } else {
                    alert('Error saving. Check console for details.');
                }
                console.error(e);
            } finally {
                this.saving = false;
            }
        },

        // ── Note panel ─────────────────────────────────────────────────────────
        openNote(key) {
            this.activeNoteKey = key;
            this._positionEditor(key);
            this.$nextTick(() => {
                if (!this.canEdit) return; // viewers get read-only HTML panel; no Quill needed
                const el = document.getElementById('note-quill-inline');
                if (!el) return;

                if (!this._quill) {
                    this._quill = new Quill(el, {
                        theme: 'snow',
                        modules: { toolbar: [['bold', 'italic'], [{ list: 'bullet' }]] },
                        placeholder: 'Add a note explaining your reasoning...'
                    });

                    this._scrollHandler = () => {
                        if (this.activeNoteKey) this._positionEditor(this.activeNoteKey);
                    };
                    window.addEventListener('scroll', this._scrollHandler, { passive: true });
                    window.addEventListener('resize', this._scrollHandler, { passive: true });
                }

                // Set editor content
                const existing = (this.service.notes && this.service.notes[key]) || '';
                // Ensure the content is wrapped in paragraphs if it's plain text for Quill
                this._quill.root.innerHTML = existing.includes('<p>') ? existing : `<p>${existing}</p>`;

                this.$nextTick(() => this._quill.focus());
            });
        },

        _positionEditor(key) {
            const btn = document.querySelector(`[data-note-key="${key}"]`);
            if (!btn) return;
            const section = btn.closest('.form-section');
            if (!section) return;
            const rect = section.getBoundingClientRect();
            
            // Check if we are on mobile/small screen
            if (window.innerWidth < 1024) {
                // Fixed centered modal for mobile
                this.noteEditorWidth = Math.min(window.innerWidth - 48, 500);
                this.noteEditorLeft = (window.innerWidth - this.noteEditorWidth) / 2;
                this.noteEditorTop = 100; // Fixed top offset
            } else {
                // Anchor to the right of the form-section card for desktop
                const editorLeft  = rect.right + 28;
                const editorRight = window.innerWidth - 40;
                this.noteEditorLeft  = Math.round(editorLeft);
                this.noteEditorWidth = Math.max(160, Math.round(editorRight - editorLeft));
                this.noteEditorTop   = Math.max(70, Math.round(rect.top));
            }
        },

        saveNote() {
            if (!this._quill) return;
            const html  = this._quill.root.innerHTML;
            const empty = this._quill.getText().trim() === '';
            if (!this.service.notes) this.service.notes = {};
            if (empty) {
                delete this.service.notes[this.activeNoteKey];
            } else {
                this.service.notes[this.activeNoteKey] = html;
            }
            this.activeNoteKey = null;
        },

        deleteNote() {
            if (!confirm('Delete this note?')) return;
            if (this.service.notes) delete this.service.notes[this.activeNoteKey];
            this.activeNoteKey = null;
        },

        closeNote() {
            this.activeNoteKey = null;
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
            this.service.sermonette = { name: '', id: null };
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
            const invData = {
                serviceDate: this.date,
                type: role,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
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
            const snap = await query.get();
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
            const snap = await personRef.get();
            if (snap.exists && snap.data().baptismDate === this.date) {
                batch.update(personRef, { baptismDate: firebase.firestore.FieldValue.delete() });
            }
        },

        async _addPastoralPrayer(batch, personId) {
            const personRef = db.collection('people').doc(personId);
            const histRef = personRef.collection('pastoral_prayer_history').doc(this.date);
            batch.set(histRef, {
                serviceDate: this.date,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        },

        async _removePastoralPrayer(batch, personId) {
            const personRef = db.collection('people').doc(personId);
            const histRef = personRef.collection('pastoral_prayer_history').doc(this.date);
            batch.delete(histRef);
        },

        async _calculateLatestPastoralPrayer(personId) {
            const personRef = db.collection('people').doc(personId);
            const histSnap = await personRef.collection('pastoral_prayer_history')
                .orderBy('serviceDate', 'desc')
                .limit(1)
                .get();
            
            if (histSnap.empty) return null;
            return histSnap.docs[0].data().serviceDate;
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
            
            // Use Fuse.js if available (pre-loaded registry)
            if (hasFuse) {
                this.hadFuse = true;
                if (!this.query || this.query.trim().length === 0) {
                    this.results = this.parent.hymnRegistry.slice(0, 5);
                } else {
                    const lowerQuery = this.query.trim().toLowerCase();
                    // Check for exact/case-insensitive ID match first
                    const exactIdMatch = this.parent.hymnRegistry.find(h => h.id.toLowerCase() === lowerQuery);
                    
                    let fuseResults = this.parent.fuse.search(this.query).map(r => r.item);
                    if (exactIdMatch) {
                        fuseResults = [exactIdMatch, ...fuseResults.filter(h => h.id !== exactIdMatch.id)];
                    }
                    this.results = fuseResults.slice(0, 5);        
                }
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
    module.exports = { CANONICAL_MAPPING, worshipHelperInvolvementChanges, personRefSetChanges, parseBaptismNames, normalizeDottedKeys, coerceBaptismCandidates };
}
