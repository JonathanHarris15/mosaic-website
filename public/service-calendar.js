// A read whose RESULT DECIDES A WRITE — a merge, a re-point, a batch of
// deletes. In the phone app ordinary reads are answered from the device
// (local-cache.js); these must not be. Stale input to a write does not show
// you old data, it destroys new data: a merge planned from a people list a
// minute old silently drops whoever was added in that minute. Ignored on the
// web, where reads were always live.
var FRESH_READ = { source: 'server' };

// Re-derive a Person's `lastPastoralPrayerDate` from their stored history. Only
// safe once the history change it is meant to reflect has been committed — a
// batch is invisible to a read until it lands. Callers that still have an open
// batch should compute the answer with PastoralPrayerCore.nextLastPrayerDate
// instead and write it in that same batch.
async function recomputeLastPrayerDate(personId) {
    const pRef = db.collection('people').doc(personId);
    const histSnap = await pRef.collection(PastoralPrayerCore.HISTORY_COLLECTION).get(FRESH_READ);
    const dates = histSnap.docs.map(d => d.data().serviceDate || d.id);
    await pRef.update({ lastPastoralPrayerDate: PastoralPrayerCore.latestDate(dates) });
}

function calendarPage() {
    return {
        view: localStorage.getItem('calendarView') || 'list',
        // The Planning view: the table opened out to every liturgy slot, for
        // writing many Sundays in one sitting (MS-245). Remembered, because
        // somebody who is planning is planning for the evening, not for one
        // page load.
        planning: localStorage.getItem('calendarPlanning') === 'true',
        // The Directory drawer, swung out over the table. Never remembered —
        // it is a glance at the dates, not a state you leave a page in.
        railOpen: false,
        showHistory: false,
        showDirectory: false,

        // The Directory is a rail only in the Planning view, and only on the
        // table. Written once here because the markup asks four times.
        get isRail() {
            return this.planning && this.view === 'table';
        },

        peopleRegistry: [],
        peopleFuse: null,

        // --- Person Selector Modal ---
        showPersonSelector: false,
        selectorDateKey: '',
        selectorField: '',
        selectorRoleName: '',
        selectedPersonRef: { id: null, name: '' },
        activeSuggestionsKey: null,
        saving: false,

        async saveVerseSelection(dateKey, field, val) {
            this.saving = true;
            try {
                const updates = {
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    [`liturgy.${field}`]: val
                };
                await db.collection('services').doc(dateKey).set(updates, { merge: true });
                
                if (!serviceDataMap[dateKey]) serviceDataMap[dateKey] = {};
                if (!serviceDataMap[dateKey].liturgy) serviceDataMap[dateKey].liturgy = {};
                serviceDataMap[dateKey].liturgy[field] = val;
                
                // Success - re-inject to update UI
                injectServiceData(serviceDataMap);
            } catch (err) {
                console.error('Error saving verse selection:', err);
                alert('Failed to save.');
            } finally {
                this.saving = false;
            }
        },

        // --- Pastoral Prayer Suggestions ---
        prayerSuggestions: { males: [], females: [] },

        async fetchPrayerSuggestions() {
            try {
                const now = new Date();
                const todayStr = DateUtils.toDateStr(now);

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
        
        openPersonSelector(dateKey, field, current) {
            this.selectorDateKey = dateKey;
            this.selectorField = field;
            // Mutate in place rather than replacing the object — personPicker's x-data captures
            // the selectedPersonRef object reference at init time, so replacing it disconnects
            // personPicker.personRef from this.selectedPersonRef and savePersonSelection() reads stale data.
            this.selectedPersonRef.id = current.id || null;
            this.selectedPersonRef.name = current.name || '';
            this.selectorRoleName = this.getRoleName(field);
            
            // Set suggestions key if applicable
            if (field === 'prayerMale') this.activeSuggestionsKey = 'males';
            else if (field === 'prayerFemale') this.activeSuggestionsKey = 'females';
            else this.activeSuggestionsKey = null;

            if (this.activeSuggestionsKey) this.fetchPrayerSuggestions();
            
            this.showPersonSelector = true;
        },
        
        // One field, one write, nothing else. See the guard in
        // savePersonSelection for why this does not go through the batch there.
        async saveAssignedWriter() {
            this.saving = true;
            try {
                const dateKey = this.selectorDateKey;
                const value = this.selectedPersonRef.id
                    ? { id: this.selectedPersonRef.id, name: this.selectedPersonRef.name || '' }
                    : null;

                const ref = db.collection('services').doc(dateKey);
                const update = {
                    [ASSIGNED_FIELD]: value,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                try {
                    await ref.update(update);
                } catch (e) {
                    if (e.code !== 'not-found') throw e;
                    await ref.set(update, { merge: true });
                }

                if (!serviceDataMap[dateKey]) serviceDataMap[dateKey] = {};
                serviceDataMap[dateKey][ASSIGNED_FIELD] = value;
                injectServiceData(serviceDataMap);

                this.closePersonSelector();
            } catch (err) {
                console.error('Error saving who is assigned:', err);
                alert('Failed to save.');
            } finally {
                this.saving = false;
            }
        },

        // Every way out of the person picker comes through here, so no exit
        // can leave a box locked behind it (MS-246).
        closePersonSelector() {
            this.showPersonSelector = false;
            PresenceStore.release();
        },

        getRoleName(field) {
            const names = {
                'assignedWriter': 'Assigned to write this Sunday',
                'serviceLeader': 'Service Leader',
                'preacher': 'Preacher',
                'musicLeader': 'Music Leader',
                'prayerPraiseName': 'Prayer Leader (Praise)',
                'prayerConfessionName': 'Prayer Leader (Confession)',
                'prayerMale': 'Male Being Prayed For',
                'prayerFemale': 'Female Being Prayed For'
            };
            return names[field] || 'Person';
        },
        
        async savePersonSelection() {
            if (!this.selectorDateKey || !this.selectorField) return;

            if (!this.selectedPersonRef.id && this.selectedPersonRef.name) {
                alert('Please select a person from the list or add them as a new person.');
                return;
            }

            // ⚠ Assigned leaves before any of the machinery below.
            //
            // Everything past this point treats a person on a Sunday as a
            // person who SERVED: it writes an involvement record and moves
            // their number in the fairness engine. Being down to write an order
            // of service is not serving, and running it through here would make
            // whoever volunteers for the most Sundays look over-used and stop
            // being asked. One field, nothing else touched.
            if (this.selectorField === ASSIGNED_FIELD) {
                await this.saveAssignedWriter();
                return;
            }

            this.saving = true;
            try {
                const batch = db.batch();
                const serviceRef = db.collection('services').doc(this.selectorDateKey);
                const svcDoc = await serviceRef.get();
                const svc = svcDoc.data() || {};

                const idFieldMap = {
                    'serviceLeader': 'serviceLeaderId',
                    'musicLeader': 'musicLeaderId',
                    'preacher': 'preacherId',
                    'prayerPraiseName': 'prayerPraiseId',
                    'prayerConfessionName': 'prayerConfessionId',
                    'prayerMale': null,
                    'prayerFemale': null
                };
                const roleMap = {
                    'serviceLeader': 'service_leader',
                    'musicLeader': 'worship_leader',
                    'preacher': 'preacher',
                    'prayerPraiseName': 'prayer',
                    'prayerConfessionName': 'prayer',
                    'prayerMale': 'pastoral_prayer',
                    'prayerFemale': 'pastoral_prayer'
                };

                const idField = idFieldMap[this.selectorField];
                let oldId = idField ? svc[idField] : null;
                const newId = this.selectedPersonRef.id;
                const role = roleMap[this.selectorField];

                if (this.selectorField === 'prayerMale' || this.selectorField === 'prayerFemale') {
                    // Check proper nested structure first, then fall back to old dotted-key literal field format
                    oldId = (svc.liturgy && svc.liturgy[this.selectorField]) ? svc.liturgy[this.selectorField].id : null;
                    if (!oldId) {
                        const dottedKey = `liturgy.${this.selectorField}`;
                        oldId = svc[dottedKey] ? svc[dottedKey].id : null;
                    }
                }

                let metadata = null;
                if (this.selectorField === 'prayerPraiseName') metadata = { prayer_type: 'praise' };
                if (this.selectorField === 'prayerConfessionName') metadata = { prayer_type: 'confession' };

                if (oldId !== newId) {
                    if (oldId) {
                        const oldPersonRef = db.collection('people').doc(oldId);
                        if (role === 'pastoral_prayer') {
                            batch.delete(oldPersonRef
                                .collection(PastoralPrayerCore.HISTORY_COLLECTION)
                                .doc(PastoralPrayerCore.historyDocId(this.selectorDateKey)));
                        } else {
                            let query = oldPersonRef.collection('involvement')
                                .where('serviceDate', '==', this.selectorDateKey)
                                .where('type', '==', role);
                            if (metadata && metadata.prayer_type) query = query.where('metadata.prayer_type', '==', metadata.prayer_type);
                            const invSnap = await query.get(FRESH_READ);
                            invSnap.forEach(d => batch.delete(d.ref));
                            if (!invSnap.empty) {
                                batch.update(oldPersonRef, { totalInvolvements: firebase.firestore.FieldValue.increment(-invSnap.size) });
                            }
                        }
                    }

                    if (newId) {
                        const newPersonRef = db.collection('people').doc(newId);
                        if (role === 'pastoral_prayer') {
                            batch.set(
                                newPersonRef
                                    .collection(PastoralPrayerCore.HISTORY_COLLECTION)
                                    .doc(PastoralPrayerCore.historyDocId(this.selectorDateKey)),
                                Object.assign(
                                    PastoralPrayerCore.historyRecord(this.selectorDateKey),
                                    { createdAt: firebase.firestore.FieldValue.serverTimestamp() }
                                ));
                        } else {
                            // The series this serve belonged to, so fairness can
                            // be counted per Event series (ADR-0016 §5). The
                            // calendar only ever assigns a Sunday.
                            const invData = EventsCore.stampSeries({
                                serviceDate: this.selectorDateKey,
                                type: role,
                                createdAt: firebase.firestore.FieldValue.serverTimestamp()
                            }, EventsCore.SUNDAY_SERVICE_ID);
                            if (metadata) invData.metadata = metadata;
                            batch.set(newPersonRef.collection('involvement').doc(), invData);
                            batch.update(newPersonRef, { totalInvolvements: firebase.firestore.FieldValue.increment(1) });
                        }
                    }
                }

                const updates = {
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                // Update Optimistic Local State
                if (!serviceDataMap[this.selectorDateKey]) serviceDataMap[this.selectorDateKey] = {};
                const localSvc = serviceDataMap[this.selectorDateKey];

                if (this.selectorField === 'prayerMale' || this.selectorField === 'prayerFemale') {
                    // Update liturgy in Firestore
                    const currentLiturgy = (svc.liturgy && typeof svc.liturgy === 'object') ? { ...svc.liturgy } : {};
                    currentLiturgy[this.selectorField] = { id: newId || null, name: this.selectedPersonRef.name || '' };
                    updates.liturgy = currentLiturgy;

                    // Sync names to Guide elements if they exist
                    if (svc.guide && svc.guide.elements) {
                        const prayerEl = svc.guide.elements.find(el => el.type === 'pastoral_prayer');
                        if (prayerEl) {
                            if (this.selectorField === 'prayerMale') prayerEl.maleMember = this.selectedPersonRef.name || '';
                            if (this.selectorField === 'prayerFemale') prayerEl.femaleMember = this.selectedPersonRef.name || '';
                            updates.guide = svc.guide;
                        }
                    }

                    // Update Local State
                    if (!localSvc.liturgy) localSvc.liturgy = {};
                    localSvc.liturgy[this.selectorField] = { id: newId || null, name: this.selectedPersonRef.name || '' };
                } else {
                    updates[this.selectorField] = this.selectedPersonRef.name || '';
                    if (idField) updates[idField] = newId || null;

                    // Update Local State
                    localSvc[this.selectorField] = this.selectedPersonRef.name || '';
                    if (idField) localSvc[idField] = newId || null;
                }

                // Trigger optimistic update
                injectServiceData(serviceDataMap);

                batch.set(serviceRef, updates, { merge: true });
                await batch.commit();

                if (role === 'pastoral_prayer') {
                    const idsToFix = [oldId, newId].filter(id => id);
                    for (const pid of idsToFix) {
                        await recomputeLastPrayerDate(pid);
                    }
                }

                this.closePersonSelector();
                // Redraw from the map the live listener maintains. The write
                // above will arrive through that listener anyway; this just
                // puts it on screen without waiting for the round trip.
                if (window.loadServiceData) await window.loadServiceData();
            } catch (error) {
                console.error('Error saving person selection:', error);
                alert('Failed to save.');
            } finally {
                this.saving = false;
            }
        },

        // --- Person Creation Modal ---
        showPersonAddModal: false,
        personToAdd: { name: '', callback: null },
        duplicateWarning: false,

        promptAddPerson(name, callback) {
            this.personToAdd = { name, callback };
            this.showPersonAddModal = true;
            this.duplicateWarning = false;
            this.checkDuplicatePerson(name);
        },

        async checkDuplicatePerson(name) {
            if (!name) return;
            try {
                const snap = await db.collection('people').where('name', '==', name).limit(1).get();
                this.duplicateWarning = !snap.empty;
            } catch (err) { console.error(err); }
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
                if (this.personToAdd.callback) this.personToAdd.callback(newPerson);
                this.showPersonAddModal = false;
            } catch (err) {
                console.error(err);
                alert('Failed to add person.');
            } finally {
                this.saving = false;
            }
        },

        async init() {
            this.$watch('view', val => {
                localStorage.setItem('calendarView', val);
                if (window.refreshCalendar) window.refreshCalendar(this.showHistory);
            });
            this.$watch('planning', val => {
                localStorage.setItem('calendarPlanning', val ? 'true' : 'false');
                // Leaving the Planning view puts the Directory back where it
                // belongs; a drawer left open would hang over the ordinary
                // sidebar.
                this.railOpen = false;
            });
            this.$watch('showHistory', val => {
                if (window.refreshCalendar) window.refreshCalendar(val);
            });
            await this.loadPeopleRegistry();
        },

        // ⚠ THIS PAGE IS VIEWABLE SIGNED OUT, AND THIS READ IS NOT.
        //
        // The registry is the whole directory, and only the editor's person
        // picker ever looks at it. Since MS-197 the directory needs an account
        // (ADR-0031), so for an anonymous visitor this read is refused. The
        // catch below would swallow it, but a permission error logged on every
        // visit to a public page is an error nobody reads.
        //
        // ⚠ A STANDING LISTENER, NOT A ONE-SHOT. Signing in is a thing that
        // happens ON this page, and the editing controls appear the moment it
        // does (see the listener at the bottom of this file). A registry that
        // asked once, found nobody and gave up would leave that editor's person
        // picker empty for the rest of the visit — and an empty picker does not
        // look broken, it looks like a church with nobody in it and offers to
        // add a new person, which is how duplicate People get made.
        //
        // Waiting for the state rather than reading `currentUser` matters for
        // the same reason in reverse: a signed-in editor's session may still be
        // coming back off IndexedDB when this runs.
        async loadPeopleRegistry() {
            return new Promise(resolve => {
                auth.onAuthStateChanged(async user => {
                    if (user && !this.peopleRegistry.length) await this.fetchPeopleRegistry();
                    // Whatever the answer, init() may carry on. Later calls are
                    // ignored — a promise settles once.
                    resolve();
                });
            });
        },

        async fetchPeopleRegistry() {
            try {
                const snap = await db.collection('people').get();
                this.peopleRegistry = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                // The Assigned badges are drawn outside this component and need
                // a photo for a given id. Re-drawn once the faces are here,
                // since the table is usually on screen before the directory is.
                peopleById = {};
                this.peopleRegistry.forEach(p => { peopleById[p.id] = p; });
                injectServiceData(serviceDataMap);
                this.peopleFuse = new Fuse(this.peopleRegistry, {
                    keys: ['name'],
                    threshold: 0.4,
                    distance: 100,
                    minMatchCharLength: 1
                });
            } catch (error) {
                console.error("Error loading people registry:", error);
            }
        }
    };
}

let allSundays = [];
let serviceDataMap = {};

// The directory keyed by id, so a badge can find a face. Kept at module scope
// because the rendering happens here rather than inside the Alpine component
// that fetches it.
let peopleById = {};

// Who is signed in, as a Person. Null until it resolves, and null for good on
// an account with no Person attached — in which case an edit records no
// authorship rather than a stamp nobody can be named from.
let currentIdentity = null;

// The hymn index behind the Planning view's hymn columns. Shared with the Order
// of Service so both offer the same hymns for the same typing — see
// hymn-registry.js.
let hymnIndex = { hymns: [], fuse: null };

// Fetched alongside the calendar rather than before it: an empty index means
// the dropdown offers nothing for a moment, not that the page is broken, and
// you can still type a hymn the index has never heard of.
async function loadHymnIndex() {
    if (typeof firebase === 'undefined' || typeof db === 'undefined') return;
    try {
        hymnIndex = await HymnRegistry.load({
            getHymnIndex: firebase.app().functions('us-central1').httpsCallable('getHymnIndex'),
            db: db,
            Fuse: typeof Fuse !== 'undefined' ? Fuse : null
        });
    } catch (e) {
        console.error('Could not load the hymn index:', e);
    }
}

// Every scripture reference ever used, for the verse picker's typeahead
// (usage-stats-store.js). Read off the shared UsageStats global — the
// inline verse picker below (setupInlineEdit) is injected outside the page's
// Alpine component tree, so it has no `parent` to thread this through.
async function loadScriptureIndex() {
    if (typeof db === 'undefined') return;
    try {
        UsageStats.scriptureIndex = await UsageStats.loadScriptureIndex(db);
    } catch (e) {
        console.error('Could not load the scripture usage index:', e);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const startDate = new Date(2023, 6, 9); // July 9, 2023 (Month is 0-indexed)
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 2);

    allSundays = [];
    let current = new Date(startDate);
    
    // Ensure we start on a Sunday
    while (current <= endDate) {
        allSundays.push(new Date(current));
        current.setDate(current.getDate() + 7);
    }

    const showHistory = false;
    window.refreshCalendar(showHistory);

    loadHymnIndex();
    loadScriptureIndex();

    // Wait for service data to load so layout is final before we scroll
    await loadServiceData();
    
    // Small delay to ensure any layout shifts from image/content injection are settled
    setTimeout(() => {
        scrollToClosestSunday(allSundays);
    }, 200);
});

window.refreshCalendar = function(showHistory) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Capture the element currently in the center of the viewport to preserve scroll position
    let centerElementId = null;
    const view = localStorage.getItem('calendarView') || 'list';
    const prefix = view === 'table' ? 'table-date-' : 'date-';
    
    // Find the date card closest to the vertical center of the screen
    const centerY = window.innerHeight / 2;
    const dateElements = document.querySelectorAll(`[id^="${prefix}"]`);
    let closestDist = Infinity;
    
    dateElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        const dist = Math.abs((rect.top + rect.height / 2) - centerY);
        if (dist < closestDist) {
            closestDist = dist;
            centerElementId = el.id;
        }
    });

    const filteredSundays = showHistory 
        ? allSundays 
        : allSundays.filter(d => {
            const date = new Date(d);
            date.setHours(0, 0, 0, 0);
            return date >= today;
        });

    const grouped = filteredSundays.reduce((acc, date) => {
        const year = date.getFullYear();
        const month = date.toLocaleString('default', { month: 'long' });
        if (!acc[year]) acc[year] = {};
        if (!acc[year][month]) acc[year][month] = [];
        acc[year][month].push(date);
        return acc;
    }, {});

    renderList(grouped);
    renderTable(grouped);
    renderSidebar(grouped);
    
    // Re-apply loaded service data if it exists
    if (Object.keys(serviceDataMap).length > 0) {
        injectServiceData(serviceDataMap);
    }

    // Restore scroll position to the captured element
    if (centerElementId) {
        const targetElement = document.getElementById(centerElementId);
        if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
    }
};

window.jumpToUpcoming = function() {
    scrollToClosestSunday(allSundays);
};

function scrollToClosestSunday(sundays) {
    if (!sundays || sundays.length === 0) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find the first Sunday that is today or in the future
    let upcomingSunday = sundays.find(date => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d >= today;
    });

    // Fallback to the last one if they are all in the past (unlikely)
    if (!upcomingSunday) upcomingSunday = sundays[sundays.length - 1];

    const dateKey = `${upcomingSunday.getFullYear()}-${upcomingSunday.getMonth()}-${upcomingSunday.getDate()}`;
    const view = localStorage.getItem('calendarView') || 'list';
    const prefix = view === 'table' ? 'table-date-' : 'date-';
    const targetId = `${prefix}${dateKey}`;
    const targetElement = document.getElementById(targetId);
    
    if (targetElement) {
        // Smooth jump centered on the element
        setTimeout(() => {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetElement.classList.add('ring-2', 'ring-primary', 'ring-offset-4');
            // Remove highlight after a few seconds
            setTimeout(() => {
                targetElement.classList.remove('ring-2', 'ring-primary', 'ring-offset-4');
            }, 2000);
        }, 100);
    }
}

// ---------------------------------------------------------------------------
// Service Injection — insert a blank service at a chosen upcoming Sunday and
// push every service on or after that Sunday one week later. Doc IDs in the
// `services` collection ARE the date (YYYY-MM-DD), so "shifting" means copying
// each affected doc to date+7 and freeing the chosen slot. People records that
// reference the moved dates (involvement entries + pastoral_prayer_history,
// both keyed/stamped by serviceDate) are re-keyed in the same pass so analytics
// and "last prayed for" stay correct.
// ---------------------------------------------------------------------------

// Renders a Service's Baptism Candidates as a display string. Handles the
// person-ref array and any legacy free-text value still present in the data.
function baptismCandidateNames(svc) {
    const bap = svc && (svc.liturgy && svc.liturgy.baptism !== undefined ? svc.liturgy.baptism : svc.baptism);
    if (Array.isArray(bap)) return bap.map(c => c && c.name).filter(Boolean).join(', ');
    return typeof bap === 'string' ? bap : '';
}

// Service-date helpers delegate to DateUtils (date-utils.js) — the single home
// for local-time YYYY-MM-DD handling. Kept as named locals so the many call
// sites below are unchanged.
function dateStrToDate(s) { return DateUtils.parseDateStr(s); }

function dateToStr(dt) { return DateUtils.toDateStr(dt); }

// Add one week to a YYYY-MM-DD string, returning the same format.
function addWeek(dateStr) { return DateUtils.addWeek(dateStr); }

// Upcoming Sundays (today or later) as { value: 'YYYY-MM-DD', label: 'June 14, 2026' }.
window.getUpcomingSundays = function () {
    return DateUtils.upcomingSundays(allSundays);
};

// How many existing services sit on or after the given Sunday (from the
// in-memory map already loaded for the calendar). Drives the modal preview.
window.countServicesFromDate = function (dateStr) {
    if (!dateStr) return 0;
    return Object.keys(serviceDataMap).filter(k => k >= dateStr).length;
};

// Perform the shift. Returns a summary { services, involvements, prayers, people }.
window.injectServiceAtDate = async function (fromDate) {
    if (typeof db === 'undefined') throw new Error('Database is not available.');
    if (!fromDate) throw new Error('No date selected.');

    // Refuse before ANYTHING is written (MS-152). Event occurrences carry a
    // visibility rung, and someone who cannot see every rung would move only
    // part of the schedule — leaving restricted Events sitting on the old week
    // while everything around them slid forward. Checked here, at the top, so a
    // refusal leaves nothing half-done.
    if (window.EventsStore && !window.EventsStore.seesEveryRung(window.currentPermissionLevel)) {
        throw new Error(
            'Shifting the schedule has to be done by an elder or an admin. ' +
            'There may be Events you are not able to see, and moving only some ' +
            'of them would leave the schedule inconsistent.'
        );
    }

    // --- Gather everything that needs to move -----------------------------
    const svcSnap = await db.collection('services').get();
    const affectedServices = [];
    svcSnap.forEach(doc => {
        if (doc.id >= fromDate) affectedServices.push({ id: doc.id, data: doc.data() });
    });

    // collectionGroup .get() with no filter needs no custom index (mirrors analytics.js).
    const invSnap = await db.collectionGroup('involvement').get();
    const affectedInv = [];
    invSnap.forEach(doc => {
        const sd = doc.data().serviceDate;
        if (sd && sd >= fromDate) affectedInv.push(doc);
    });

    const prayerSnap = await db.collectionGroup(PastoralPrayerCore.HISTORY_COLLECTION).get();
    const affectedPrayers = [];
    prayerSnap.forEach(doc => {
        const sd = doc.data().serviceDate || doc.id;
        if (sd && sd >= fromDate) affectedPrayers.push(doc);
    });

    // --- Build write operations -------------------------------------------
    // Sets/updates are applied before any delete so that an aborted run can
    // only ever leave a stale duplicate behind, never lose data.
    const setsAndUpdates = [];
    const deletes = [];

    // Services: keyed by date. Copy each to date+7, then free any slot that
    // nothing moved into (gaps are preserved as shifted gaps). Process from the
    // latest date down so every doc is copied forward (to date+7) before the
    // copy of its predecessor overwrites it — keeps a partial failure across
    // batch boundaries non-destructive.
    const servicesDesc = [...affectedServices].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const svcNewIds = new Set(servicesDesc.map(s => addWeek(s.id)));
    servicesDesc.forEach(s => {
        setsAndUpdates.push({ kind: 'set', ref: db.collection('services').doc(addWeek(s.id)), data: s.data });
    });
    servicesDesc.forEach(s => {
        if (!svcNewIds.has(s.id)) deletes.push({ kind: 'delete', ref: db.collection('services').doc(s.id) });
    });

    // Involvement: auto-id docs — re-stamp the serviceDate field in place.
    affectedInv.forEach(doc => {
        setsAndUpdates.push({ kind: 'update', ref: doc.ref, data: { serviceDate: addWeek(doc.data().serviceDate) } });
    });

    // Pastoral prayer history: doc ID is the date — copy to the date+7 doc and
    // free any vacated slot (collision-safe per person). Latest-first for the
    // same copy-before-overwrite safety as services.
    const prayerDate = doc => doc.data().serviceDate || doc.id;
    const prayersDesc = [...affectedPrayers].sort((a, b) => {
        const da = prayerDate(a), db2 = prayerDate(b);
        return da < db2 ? 1 : da > db2 ? -1 : 0;
    });
    const prayerNewPaths = new Set();
    prayersDesc.forEach(doc => {
        const newDate = addWeek(prayerDate(doc));
        const newRef = doc.ref.parent.doc(PastoralPrayerCore.historyDocId(newDate));
        prayerNewPaths.add(newRef.path);
        setsAndUpdates.push({ kind: 'set', ref: newRef, data: { ...doc.data(), serviceDate: newDate } });
    });
    prayersDesc.forEach(doc => {
        if (!prayerNewPaths.has(doc.ref.path)) deletes.push({ kind: 'delete', ref: doc.ref });
    });

    // --- Commit in <=450-op batches (Firestore caps at 500) ----------------
    const writes = [...setsAndUpdates, ...deletes];
    for (let i = 0; i < writes.length; i += 450) {
        const batch = db.batch();
        writes.slice(i, i + 450).forEach(w => {
            if (w.kind === 'set') batch.set(w.ref, w.data);
            else if (w.kind === 'update') batch.update(w.ref, w.data);
            else if (w.kind === 'delete') batch.delete(w.ref);
        });
        await batch.commit();
    }

    // --- Event occurrences and their rosters (MS-152) ----------------------
    // Occurrences are keyed by date, and their assignments live in a roster
    // subcollection that does NOT follow its parent. Without this the Event
    // moves and the people assigned to it do not — the week's roster is
    // silently lost. Same writes-before-deletes ordering as everything above.
    let occurrenceResult = { occurrences: 0, assignments: 0 };
    if (window.EventsStore) {
        occurrenceResult = await window.EventsStore.shiftOccurrences(db, fromDate, 7, {
            rank: window.currentPermissionLevel,
        });
    }

    // --- Recompute lastPastoralPrayerDate for affected people --------------
    const affectedPeopleIds = new Set(affectedPrayers.map(doc => doc.ref.parent.parent.id));
    for (const pid of affectedPeopleIds) {
        await recomputeLastPrayerDate(pid);
    }

    return {
        services: affectedServices.length,
        involvements: affectedInv.length,
        prayers: affectedPrayers.length,
        people: affectedPeopleIds.size,
        occurrences: occurrenceResult.occurrences,
        assignments: occurrenceResult.assignments
    };
};

window.openInjectModal = function () {
    window.dispatchEvent(new CustomEvent('open-inject-modal'));
};

// Alpine component backing the injection modal.
function injectServiceModal() {
    return {
        show: false,
        step: 'choose', // 'choose' | 'working' | 'done' | 'error'
        selectedDate: '',
        sundays: [],
        shiftCount: 0,
        result: null,
        errorMsg: '',

        openModal() {
            this.sundays = window.getUpcomingSundays();
            this.selectedDate = this.sundays.length ? this.sundays[0].value : '';
            this.step = 'choose';
            this.result = null;
            this.errorMsg = '';
            this.updateCount();
            this.show = true;
        },

        updateCount() {
            this.shiftCount = this.selectedDate ? window.countServicesFromDate(this.selectedDate) : 0;
        },

        get selectedLabel() {
            const s = this.sundays.find(x => x.value === this.selectedDate);
            return s ? s.label : '';
        },

        close() {
            if (this.step !== 'working') this.show = false;
        },

        async confirm() {
            if (!this.selectedDate) return;
            this.step = 'working';
            try {
                this.result = await window.injectServiceAtDate(this.selectedDate);
                this.step = 'done';
            } catch (e) {
                console.error('Service injection failed:', e);
                this.errorMsg = (e && e.message) || 'Something went wrong.';
                this.step = 'error';
            }
        },

        finish() {
            // Full reload guarantees every view is in sync with Firestore,
            // matching the docx-import flow.
            location.reload();
        }
    };
}

function scrollToSection(year, month = null) {
    const view = localStorage.getItem('calendarView') || 'list';
    const prefix = view === 'table' ? 'table-' : '';
    const id = month ? `${prefix}month-${year}-${month}` : `${prefix}year-${year}`;
    const targetElement = document.getElementById(id);
    if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function renderSidebar(grouped) {
    const navs = [
        document.getElementById('sidebar-nav'),
        document.getElementById('mobile-sidebar-nav')
    ];
    
    navs.forEach(nav => {
        if (!nav) return;
        nav.innerHTML = '';

        const years = Object.keys(grouped).sort((a, b) => a - b);

        years.forEach(year => {
            const yearDiv = document.createElement('div');
            yearDiv.className = 'mb-sm';
            
            const yearLink = document.createElement('a');
            yearLink.href = 'javascript:void(0)';
            yearLink.onclick = () => scrollToSection(year);
            yearLink.className = 'block font-headline-md text-secondary hover:text-primary py-1 transition-colors';
            yearLink.textContent = year;
            yearDiv.appendChild(yearLink);

            const monthsDiv = document.createElement('div');
            monthsDiv.className = 'ml-md space-y-1';
            
            const monthsOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            
            monthsOrder.forEach(month => {
                if (grouped[year][month]) {
                    const monthLink = document.createElement('a');
                    monthLink.href = 'javascript:void(0)';
                    monthLink.onclick = () => scrollToSection(year, month);
                    monthLink.className = 'block font-body-md text-on-surface-variant hover:text-primary text-sm py-0.5 transition-colors';
                    monthLink.textContent = month;
                    monthsDiv.appendChild(monthLink);
                }
            });

            yearDiv.appendChild(monthsDiv);
            nav.appendChild(yearDiv);
        });
    });
}

window.navigateToGuide = function(date) {
    const svc = serviceDataMap[date];
    const guide = svc && svc.guide;
    const isViewer = !['editor', 'elder', 'admin', 'super_admin'].includes(window.currentPermissionLevel);

    // Which Service Guide system this week uses — the explicit per-week toggle set
    // in the Order of Service editor, else a legacy `elements` blob, else v2
    // (ADR-0010). One shared rule (GuideStore) so the calendar and the editor's
    // "Generate" button never drift.
    const system = window.GuideStore
        ? GuideStore.guideSystemOf(svc || {})
        : ((guide && guide.format !== 'v2' && Array.isArray(guide.elements)) ? 'legacy' : 'v2');
    const isLegacy = system === 'legacy';
    const target = window.GuideStore
        ? GuideStore.guideHref(svc || {}, date)
        : (isLegacy ? `service-guide.html?date=${date}` : `service-guide-editor.html?date=${date}`);

    if (!isViewer && svc) {
        let incomplete = false;
        if (guide && guide.format === 'v2') {
            // Compute completeness from the frozen snapshot's required Entry
            // Fields — the single source of truth the editor uses — so this never
            // drifts as templates are customised. Fall back to a field heuristic
            // if the guide modules aren't available for some reason.
            if (window.GuideStore && guide.snapshot) {
                incomplete = window.GuideStore.tasksRemaining(guide.snapshot, guide.values || {}) > 0;
            } else {
                const v = guide.values || {};
                const annFilled = Array.isArray(v.announcements) && v.announcements.some(a => a && (a.title || a.content));
                incomplete = (!v.pp_nation || !v.pp_capital) || (!v.kids_lesson_title || !v.kids_lesson_verse) || !annFilled;
            }
        } else if (guide && guide.elements) {
            const prayer = guide.elements.find(el => el.type === 'pastoral_prayer');
            const kids = guide.elements.find(el => el.type === 'kids_section');
            const announcements = guide.elements.find(el => el.type === 'announcements');

            if (prayer && prayer.enabled && (!prayer.nation || !prayer.capital)) incomplete = true;
            if (kids && kids.enabled && (!kids.lessonTitle || !kids.lessonVerse)) incomplete = true;
            if (announcements && announcements.enabled && (!announcements.items || announcements.items.length === 0 || !announcements.items[0].title)) incomplete = true;
        } else {
            // No guide config yet - definitely incomplete
            incomplete = true;
        }

        if (incomplete) {
            const proceed = confirm("Warning: There are elements that you have not completed yet. Please do so before going to the service guide page.\n\nDo you still want to proceed to the editor?");
            if (!proceed) return;
        }
    }
    window.location.href = target;
};

function renderList(grouped) {
    const container = document.getElementById('list-view');
    container.innerHTML = '';

    const years = Object.keys(grouped).sort((a, b) => a - b); 

    years.forEach(year => {
        const yearSection = document.createElement('section');
        yearSection.id = `year-${year}`;
        yearSection.className = 'mb-xl scroll-mt-24';
        yearSection.innerHTML = `<h2 class="font-display-lg text-headline-lg text-primary border-b border-outline-variant pb-xs mb-md">${year}</h2>`;

        const monthsOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        monthsOrder.forEach(month => {
            if (grouped[year][month]) {
                const monthSection = document.createElement('div');
                monthSection.id = `month-${year}-${month}`;
                monthSection.className = 'mb-lg ml-0 sm:ml-md scroll-mt-24';
                monthSection.innerHTML = `<h3 class="font-headline-md text-headline-md text-secondary mb-sm">${month}</h3>`;
                
                const grid = document.createElement('div');
                grid.className = 'grid grid-cols-1 gap-sm';

                grouped[year][month].forEach(date => {
                    const formattedDate = DateUtils.toDateStr(date);

                    const dateRow = document.createElement('div');
                    dateRow.id = `date-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                    dateRow.dataset.serviceDate = formattedDate;
                    dateRow.className = 'bg-surface-container-lowest border border-outline-variant rounded-xl p-md flex flex-col sm:flex-row justify-between items-start group hover:shadow-[0_4px_16px_rgba(4,22,46,0.05)] transition-all duration-300 scroll-mt-32';
                    
                    const dateInfo = document.createElement('div');
                    dateInfo.className = 'flex items-start gap-md mb-md sm:mb-0 w-full sm:w-auto';
                    
                    const dayNum = date.getDate();
                    const dayName = date.toLocaleString('default', { weekday: 'short' });
                    
                    dateInfo.innerHTML = `
                        <div class="bg-primary-fixed text-on-primary-fixed rounded-xl w-14 h-14 flex flex-col items-center justify-center flex-shrink-0">
                            <span class="text-[10px] uppercase font-bold tracking-wider">${dayName}</span>
                            <span class="text-xl font-bold">${dayNum}</span>
                        </div>
                        <div class="min-w-0">
                            <p class="font-headline-md text-body-lg text-on-surface mb-0">${date.toLocaleDateString('default', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                            <p class="font-body-md text-on-surface-variant text-sm">Sunday Service</p>
                            <div class="service-summary hidden mt-2 space-y-0.5"></div>
                        </div>
                    `;

                    const actions = document.createElement('div');
                    actions.className = 'flex flex-col sm:flex-row gap-sm w-full sm:w-auto justify-end flex-shrink-0';
                    actions.innerHTML = `
                        <button onclick="window.navigateToGuide('${formattedDate}')" class="flex-grow sm:flex-none bg-secondary text-on-secondary px-4 py-2 rounded-full font-label-md text-label-md hover:bg-primary transition-colors flex items-center justify-center gap-2 group/btn">
                            <span class="material-symbols-outlined text-[18px]">auto_stories</span>
                            <span>Service Guide</span>
                        </button>
                        <a href="service-builder.html?date=${formattedDate}" class="flex-grow sm:flex-none border border-outline text-secondary px-4 py-2 rounded-full font-label-md text-label-md hover:bg-secondary hover:text-on-secondary hover:border-secondary transition-colors flex items-center justify-center gap-2 group/btn">
                            <span class="material-symbols-outlined text-[18px]">list_alt</span>
                            <span>Order of Service</span>
                        </a>
                    `;

                    dateRow.appendChild(dateInfo);
                    dateRow.appendChild(actions);
                    grid.appendChild(dateRow);
                });

                monthSection.appendChild(grid);
                yearSection.appendChild(monthSection);
            }
        });

        container.appendChild(yearSection);
    });
}

// The liturgy columns the Planning view adds (MS-245).
//
// One list, read three times — the header, the cell, and the editor that opens
// when the cell is clicked. Adding a slot to the order of service means adding
// a line here and nothing else; three hand-kept lists is how a column ends up
// with a heading and no way to type into it.
//
// The existing Pastoral Prayer column carries the two PEOPLE prayed for. The
// one added here is its scripture REFERENCE, which is a different thing and a
// different field.
//
// ⚠ That reference is stored as `liturgy.scriptureReading`. The name is a
// leftover — the Order of Service labels the very same field "Pastoral Prayer"
// (service-builder.js `_MOVEMENTS`), and CANONICAL_MAPPING has both 'Scripture
// Reading' and 'Pastoral Prayer' pointing at it. The heading here follows what
// the Order of Service calls it, because that is what the room calls it.
//
// The hymn names are the ones the code stores (hymnMid1, hymnEnd1 …) rather
// than the Hymn 3/4/5/6 people say in the room. Jonathan's call — the fields
// keep their names, so the headings match what is underneath them.
//
// In liturgical order, so reading left to right reads the service.
const PLANNING_COLUMNS = [
    { label: 'Preparatory',           cell: 'prep-hymn-cell',       field: 'preparatoryHymn',   type: 'hymn'  },
    { label: 'Hymn 1',                cell: 'hymn1-cell',           field: 'hymn1',             type: 'hymn'  },
    { label: 'Hymn 2',                cell: 'hymn2-cell',           field: 'hymn2',             type: 'hymn'  },
    { label: 'Call to Confession',    cell: 'call-confession-cell', field: 'callToConfession',  type: 'verse' },
    { label: 'Assurance of Pardon',   cell: 'assurance-cell',       field: 'assuranceOfPardon', type: 'verse' },
    { label: 'Hymn Mid 1',            cell: 'hymn-mid1-cell',       field: 'hymnMid1',          type: 'hymn'  },
    { label: 'Hymn Mid 2',            cell: 'hymn-mid2-cell',       field: 'hymnMid2',          type: 'hymn'  },
    { label: 'Pastoral Prayer Ref',   cell: 'prayer-ref-cell',      field: 'scriptureReading',  type: 'verse' },
    { label: 'Hymn End 1',            cell: 'hymn-end1-cell',       field: 'hymnEnd1',          type: 'hymn'  },
    { label: 'Hymn End 2',            cell: 'hymn-end2-cell',       field: 'hymnEnd2',          type: 'hymn'  },
    { label: 'Benediction',           cell: 'benediction-cell',     field: 'benediction',       type: 'verse' },
];

// Liturgy fields edited with the scripture picker rather than a plain box.
const LITURGY_VERSE_FIELDS = ['sermon'].concat(
    PLANNING_COLUMNS.filter(c => c.type === 'verse').map(c => c.field));

const LITURGY_HYMN_FIELDS = PLANNING_COLUMNS
    .filter(c => c.type === 'hymn').map(c => c.field);

// Who is down to WRITE this Sunday's order of service.
//
// ⚠ NOT a Role, and NOT an Involvement. Everywhere else on this page, putting a
// person on a Sunday means they served: it writes an involvement record and
// moves their number in the fairness engine. This one deliberately does none of
// that. It is a note on a planning sheet saying who agreed to fill this row in,
// and being assigned five Sundays must never make somebody look over-served.
//
// Deliberately short-lived. When per-element authorship arrives — who actually
// chose each hymn — this is what it replaces. The name says "writer" rather
// than the vaguer "assigned" so that the two can coexist without either being
// mistaken for the other.
const ASSIGNED_FIELD = 'assignedWriter';

// A Person's first name, for the label under the badge. The badge is about
// 3rem wide and a full name does not fit; the whole name is on the tooltip.
function firstNameOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length ? parts[0] : '';
}

// The Assigned badge for one Sunday: a photo with a first name under it, or a
// faint invitation when nobody is down for it yet.
//
// `person` is the directory record, looked up for the photo. A Service stores
// only {id, name}, so a Person with no record found still shows — as initials.
// The alternative, hiding somebody because their directory entry has not
// loaded, would read as "nobody is assigned" and get them assigned twice.
function assignedBadgeHtml(assigned, person) {
    const name = (assigned && assigned.name) || '';
    if (!name) {
        return '<span class="material-symbols-outlined text-[18px] opacity-40">person_add</span>';
    }

    const photoUrl = person && person.photoUrl;
    const face = photoUrl
        ? `<img src="${escapeHtml(photoUrl)}" alt="" style="${escapeHtml(PersonPhotoCore.frameStyle(person.photoCrop))}">`
        : escapeHtml(PersonPhotoCore.initialsOf(name));

    return `<span class="m-avatar m-avatar--sm">${face}</span>` +
           `<span class="assigned-name">${escapeHtml(firstNameOf(name))}</span>`;
}

// How a hymn slot reads in a cell. A slot holds {id, name}: a chosen hymn has
// both, one typed in freehand has only a name, and an empty one has neither.
function hymnCellText(slot) {
    if (!slot) return '—';
    if (typeof slot === 'string') return slot || '—';
    return slot.name || '—';
}

function renderTable(grouped) {
    const container = document.getElementById('calendar-table-container');
    container.innerHTML = '';

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'flex-grow overflow-auto border border-outline-variant rounded-xl bg-surface-container-lowest custom-scrollbar relative';
    
    const table = document.createElement('table');
    table.className = 'w-full text-left border-collapse min-w-[1000px] relative';
    
    // Sticky Header
    const thead = document.createElement('thead');
    thead.className = 'sticky-header font-label-md text-label-md text-primary';
    thead.innerHTML = `
        <tr>
            <th class="px-md py-sm border-b border-outline-variant sticky-col-left">Date</th>
            <th class="px-md py-sm border-b border-outline-variant">Sermon</th>
            <th class="px-md py-sm border-b border-outline-variant">Theme</th>
            <th class="px-md py-sm border-b border-outline-variant">Leader</th>
            <th class="px-md py-sm border-b border-outline-variant">Preacher</th>
            <th class="px-md py-sm border-b border-outline-variant">Baptism</th>
            <th class="px-md py-sm border-b border-outline-variant">Music</th>
            <th class="px-md py-sm border-b border-outline-variant">Prayers</th>
            <th class="px-md py-sm border-b border-outline-variant">Pastoral Prayer</th>
            ${PLANNING_COLUMNS.map(c =>
                `<th class="px-md py-sm border-b border-outline-variant planning-col whitespace-nowrap">${c.label}</th>`
            ).join('')}
            <th class="px-md py-sm border-b border-outline-variant text-right sticky-column">Actions</th>
        </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-outline-variant/30';

    const years = Object.keys(grouped).sort((a, b) => a - b); 

    years.forEach(year => {
        const monthsOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        monthsOrder.forEach(month => {
            if (grouped[year][month]) {
                // Month Separator Row
                const separatorRow = document.createElement('tr');
                separatorRow.id = `table-month-${year}-${month}`;
                separatorRow.className = 'sticky-month-row bg-surface-container-low/50 scroll-mt-24';
                separatorRow.innerHTML = `
                    <td colspan="${10 + PLANNING_COLUMNS.length}" class="px-md py-2 z-25 bg-surface-container-low/90 backdrop-blur-sm">
                        <h3 class="font-headline-md text-sm uppercase tracking-wider text-secondary">${month} ${year}</h3>
                    </td>
                `;
                tbody.appendChild(separatorRow);

                grouped[year][month].forEach(date => {
                    const formattedDate = DateUtils.toDateStr(date);

                    const row = document.createElement('tr');
                    row.id = `table-date-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                    row.dataset.serviceDate = formattedDate;
                    row.className = 'group hover:bg-surface-container-low transition-colors scroll-mt-32';
                    
                    row.innerHTML = `
                        <td class="px-md py-md whitespace-nowrap sticky-col-left">
                            <div class="flex items-center gap-2">
                                <button class="assigned-btn planning-only" data-assigned-for="${formattedDate}" title="Assign someone to write this Sunday"></button>
                                <span class="font-body-md text-on-surface">${date.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                            </div>
                        </td>
                        <td class="px-md py-md min-w-[160px]">
                            <div class="sermon-cell font-body-md text-primary text-sm">—</div>
                        </td>
                        <td class="px-md py-md min-w-[200px]">
                            <div class="theme-cell font-body-md text-on-surface-variant text-sm line-clamp-2">—</div>
                        </td>
                        <td class="px-md py-md whitespace-nowrap">
                            <div class="leader-cell font-body-md text-on-surface-variant text-sm">—</div>
                        </td>
                        <td class="px-md py-md whitespace-nowrap">
                            <div class="preacher-cell font-body-md text-on-surface-variant text-sm">—</div>
                        </td>
                        <td class="px-md py-md whitespace-nowrap">
                            <div class="baptism-cell font-body-md text-on-surface-variant text-sm">—</div>
                        </td>
                        <td class="px-md py-md whitespace-nowrap">
                            <div class="music-cell font-body-md text-on-surface-variant text-sm">—</div>
                        </td>
                        <td class="px-md py-md whitespace-nowrap">
                            <div class="prayers-cell font-body-md text-on-surface-variant text-xs space-y-0.5">—</div>
                        </td>
                        <td class="px-md py-md whitespace-nowrap">
                            <div class="pastoral-prayer-cell font-body-md text-on-surface-variant text-xs space-y-0.5">—</div>
                        </td>
                        ${PLANNING_COLUMNS.map(c => `
                        <td class="px-md py-md planning-col min-w-[150px] relative">
                            <div class="${c.cell} font-body-md text-on-surface-variant text-sm">—</div>
                        </td>`).join('')}
                        <td class="px-md py-md text-right whitespace-nowrap sticky-column">
                            <div class="flex justify-end gap-xs">
                                <button onclick="window.navigateToGuide('${formattedDate}')" title="Service Guide" class="p-2 text-secondary hover:text-primary hover:bg-surface-container rounded-full transition-colors">
                                    <span class="material-symbols-outlined text-[20px]">auto_stories</span>
                                </button>
                                <a href="service-builder.html?date=${formattedDate}" title="Order of Service" class="p-2 text-secondary hover:text-primary hover:bg-surface-container rounded-full transition-colors">
                                    <span class="material-symbols-outlined text-[20px]">list_alt</span>
                                </a>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
            }
        });
    });

    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);
}

/**
 * Fetch all service documents from Firestore and inject summary info
 * (theme, service leader, preacher) into the matching calendar cards.
 */
// Older saves used set() with merge and dotted key names like 'liturgy.sermon',
// which Firestore stores as a literal field name containing a dot rather than
// as a nested path. Normalize those back into their proper nested structure so
// the display code (which reads svc.liturgy.sermon) finds the value.
function normalizeServiceDoc(raw) {
    const data = {};
    for (const [key, val] of Object.entries(raw || {})) {
        if (!key.includes('.')) {
            data[key] = val;
        }
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

// Is this cell's editor open?
//
// Every inline editor on this page works the same way: it hides the cell and
// puts an input or a picker in its place (see setupInlineEdit). So the cell
// being hidden IS the signal that somebody is typing into it, and no separate
// register of who-is-editing-what can drift out of step with the DOM.
//
// This is what makes a live calendar safe. A snapshot landing while you are
// halfway through a hymn must not reach in and rewrite the box under your
// hands; it updates every other cell and leaves yours alone until you are out
// of it.
function isCellBeingEdited(el) {
    return !!el && el.style && el.style.display === 'none';
}

// Write a cell's text unless its editor is open. Reports whether it wrote, so
// a caller can hold back the attributes that belong with the text (a person's
// id has to travel with their name or the cell starts lying about who it is).
function setCellText(el, text) {
    if (!el || isCellBeingEdited(el)) return false;
    el.textContent = text;
    return true;
}

// Is anything inside this container being edited? For cells rebuilt wholesale
// from innerHTML, where refreshing at the wrong moment does not overwrite the
// box — it deletes it.
function hasEditorOpen(container) {
    if (!container || !container.querySelectorAll) return false;
    return Array.from(container.querySelectorAll('*')).some(isCellBeingEdited);
}

let servicesUnsubscribe = null;

// Listen to every Service, for as long as the page is open.
//
// This used to be a single get() at load, which meant the calendar showed you
// the church as it was the moment you arrived and never mentioned that anything
// had changed since. At a service guide session — a dozen men filling in
// Sundays in the same room — that is the whole problem: you cannot see the work
// happening beside you, and two people pick up the same Sunday because neither
// can tell the other has it.
//
// Resolves on the first snapshot so the callers that await it (and then scroll)
// still behave; every snapshot after that just re-injects.
async function loadServiceData() {
    if (typeof db === 'undefined') return;

    if (servicesUnsubscribe) {
        injectServiceData(serviceDataMap);
        return;
    }

    await new Promise((resolve) => {
        let settled = false;
        const settle = () => {
            if (settled) return;
            settled = true;
            resolve();
        };

        servicesUnsubscribe = db.collection('services').onSnapshot(
            (snapshot) => {
                serviceDataMap = {};
                snapshot.forEach(doc => {
                    serviceDataMap[doc.id] = normalizeServiceDoc(doc.data());
                });
                injectServiceData(serviceDataMap);
                settle();
            },
            (e) => {
                console.error('Error loading service data for calendar:', e);
                // A listener that failed is not a listener. Drop it so a later
                // call can try again rather than sit on a dead subscription.
                servicesUnsubscribe = null;
                settle();
            }
        );
    });
}

function injectServiceData(serviceMap) {
    const user = auth.currentUser;
    let canEdit = false;
    
    // We check role from local storage or global state if possible, 
    // but since we need it for injection, we'll try to determine it.
    // In this app, we can use the 'can-edit' class on the body as a signal 
    // if we set it during auth change.
    canEdit = document.body.classList.contains('can-edit');

    // Walk through all rendered date cards/rows and inject data if a service exists
    document.querySelectorAll('[data-service-date]').forEach(el => {
      // ⚠ ONE ROW MUST NOT TAKE THE PAGE WITH IT.
      //
      // Everything below runs inside a forEach, so an exception on any single
      // Sunday abandons the loop and every row after it is left with no edit
      // handlers at all — a page that is silently, entirely read-only, with
      // nothing on screen to say why. That is exactly how the presence work
      // broke both surfaces: one unstarted store, one TypeError, no clue.
      // A row that fails is now one broken row.
      try {
        const dateKey = el.dataset.serviceDate;
        const svc = serviceMap[dateKey] || {};

        // List View Injection
        const summaryEl = el.querySelector('.service-summary');
        if (summaryEl) {
            let html = '';
            
            // Badges Row
            if (svc.hasBaptism || svc.isIrregular) {
                html += `<div class="flex flex-wrap gap-2 mb-2">`;
                if (svc.isIrregular) {
                    html += `
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wider">
                            <span class="material-symbols-outlined text-[14px]">layers</span>
                            Irregular
                        </span>`;
                }
                if (svc.hasBaptism) {
                    const baptismName = baptismCandidateNames(svc);
                    html += `
                        <span class="group/baptism relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider cursor-help">
                            <span class="material-symbols-outlined text-[14px]">water_drop</span>
                            Baptism
                            ${baptismName ? `
                            <div class="invisible group-hover/baptism:visible opacity-0 group-hover/baptism:opacity-100 transition-all duration-200 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-primary text-on-primary text-[11px] font-medium rounded-lg shadow-xl whitespace-nowrap z-[100] normal-case tracking-normal flex flex-col items-center">
                                <span>Candidate: ${escapeHtml(baptismName)}</span>
                                <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-primary"></div>
                            </div>
                            ` : ''}
                        </span>`;
                }
                html += `</div>`;
            }

            if (svc.theme) {
                html += `<p class="text-xs font-label-md text-primary flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">bookmark</span>
                    ${escapeHtml(svc.theme)}
                </p>`;
            }
            // The sermon passage carries as much of "what is this Sunday" as the
            // theme does, so the list shows it too — not the table only.
            if (svc.liturgy && svc.liturgy.sermon) {
                html += `<p class="text-xs font-label-md text-primary flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">menu_book</span>
                    ${escapeHtml(svc.liturgy.sermon)}
                </p>`;
            }
            if (svc.serviceLeader) {
                html += `<p class="hidden md:flex text-xs text-on-surface-variant items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">person</span>
                    Leader: ${escapeHtml(svc.serviceLeader)}
                </p>`;
            }
            if (svc.preacher) {
                html += `<p class="hidden md:flex text-xs text-on-surface-variant items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">podium</span>
                    Preacher: ${escapeHtml(svc.preacher)}
                </p>`;
            }

            if (html) {
                summaryEl.innerHTML = html;
                summaryEl.classList.remove('hidden');
            } else {
                summaryEl.classList.add('hidden');
            }
        }

        // Table View Injection
        const dateCell = el.querySelector('.sticky-col-left');
        if (dateCell && svc.isIrregular) {
            // Check if badge already exists
            if (!dateCell.querySelector('.irregular-indicator')) {
                const indicator = document.createElement('span');
                indicator.className = 'irregular-indicator material-symbols-outlined text-[14px] text-amber-600 ml-1 align-middle cursor-help';
                indicator.textContent = 'layers';
                indicator.title = 'Irregular Service';
                dateCell.appendChild(indicator);
            }
        }

        const sermonCell = el.querySelector('.sermon-cell');
        if (sermonCell) {
            setCellText(sermonCell, (svc.liturgy && svc.liturgy.sermon) || '—');
            if (canEdit) setupInlineEdit(sermonCell, dateKey, 'sermon');
        }

        const themeCell = el.querySelector('.theme-cell');
        if (themeCell) {
            setCellText(themeCell, svc.theme || '—');
            if (canEdit) setupInlineEdit(themeCell, dateKey, 'theme');
        }

        const leaderCell = el.querySelector('.leader-cell');
        if (leaderCell) {
            if (setCellText(leaderCell, svc.serviceLeader || '—')) {
                leaderCell.setAttribute('data-person-id', svc.serviceLeaderId || '');
            }
            if (canEdit) setupInlineEdit(leaderCell, dateKey, 'serviceLeader');
        }

        const preacherCell = el.querySelector('.preacher-cell');
        if (preacherCell) {
            if (setCellText(preacherCell, svc.preacher || '—')) {
                preacherCell.setAttribute('data-person-id', svc.preacherId || '');
            }
            if (canEdit) setupInlineEdit(preacherCell, dateKey, 'preacher');
        }

        const baptismCell = el.querySelector('.baptism-cell');
        if (baptismCell) {
            // Baptism Candidates are linked to People and managed in the Order of
            // Service Builder, so the calendar shows them read-only. Gate on
            // hasBaptism so a stale candidate left in liturgy.baptism (e.g. after
            // the flag was toggled/derived off) isn't shown as an upcoming
            // baptism here when every other view hides it.
            setCellText(baptismCell, (svc.hasBaptism && baptismCandidateNames(svc)) || '—');
        }

        const musicCell = el.querySelector('.music-cell');
        if (musicCell) {
            if (setCellText(musicCell, svc.musicLeader || '—')) {
                musicCell.setAttribute('data-person-id', svc.musicLeaderId || '');
            }
            if (canEdit) setupInlineEdit(musicCell, dateKey, 'musicLeader');
        }

        const prayerFemaleCell = el.querySelector('.prayer-female-cell');
        if (prayerFemaleCell) {
            const val = (svc.liturgy && svc.liturgy.prayerFemale) ? svc.liturgy.prayerFemale.name : '—';
            const id = (svc.liturgy && svc.liturgy.prayerFemale) ? svc.liturgy.prayerFemale.id : '';
            if (setCellText(prayerFemaleCell, val || '—')) {
                prayerFemaleCell.setAttribute('data-person-id', id || '');
            }
            if (canEdit) setupInlineEdit(prayerFemaleCell, dateKey, 'prayerFemale');
        }

        // These two cells are rebuilt from innerHTML rather than written into,
        // so a snapshot landing mid-edit would take the box away underneath the
        // person typing in it. Leave the whole cell alone until they are out.
        const pastoralPrayerCell = el.querySelector('.pastoral-prayer-cell');
        if (pastoralPrayerCell && !hasEditorOpen(pastoralPrayerCell)) {
            pastoralPrayerCell.innerHTML = '';
            
            const maleRow = document.createElement('div');
            maleRow.className = 'flex gap-1 items-center';
            const maleName = (svc.liturgy && svc.liturgy.prayerMale) ? svc.liturgy.prayerMale.name : '—';
            const maleId = (svc.liturgy && svc.liturgy.prayerMale) ? svc.liturgy.prayerMale.id : '';
            maleRow.innerHTML = `<span class="opacity-50">M:</span> <span class="male-name-cell">${maleName || '—'}</span>`;
            maleRow.querySelector('.male-name-cell').setAttribute('data-person-id', maleId || '');
            
            const femaleRow = document.createElement('div');
            femaleRow.className = 'flex gap-1 items-center';
            const femaleName = (svc.liturgy && svc.liturgy.prayerFemale) ? svc.liturgy.prayerFemale.name : '—';
            const femaleId = (svc.liturgy && svc.liturgy.prayerFemale) ? svc.liturgy.prayerFemale.id : '';
            femaleRow.innerHTML = `<span class="opacity-50">F:</span> <span class="female-name-cell">${femaleName || '—'}</span>`;
            femaleRow.querySelector('.female-name-cell').setAttribute('data-person-id', femaleId || '');
            
            pastoralPrayerCell.appendChild(maleRow);
            pastoralPrayerCell.appendChild(femaleRow);

            if (canEdit) {
                setupInlineEdit(maleRow.querySelector('.male-name-cell'), dateKey, 'prayerMale');
                setupInlineEdit(femaleRow.querySelector('.female-name-cell'), dateKey, 'prayerFemale');
            }
        }

        // Who is down to write this Sunday. Shown only in the Planning view,
        // which is the only place the question is being asked.
        const assignedBtn = el.querySelector('.assigned-btn');
        if (assignedBtn) {
            const assigned = svc[ASSIGNED_FIELD] || null;
            const person = assigned && assigned.id ? peopleById[assigned.id] : null;

            // Somebody who cannot edit gets the face but not the invitation.
            // The empty badge is an offer to do something, and an offer that
            // does nothing when pressed is worse than no offer at all.
            assignedBtn.innerHTML = (!canEdit && !assigned)
                ? ''
                : assignedBadgeHtml(assigned, person);
            assignedBtn.title = assigned && assigned.name
                ? `${assigned.name} is writing this Sunday`
                : (canEdit ? 'Assign someone to write this Sunday' : '');

            if (canEdit) {
                assignedBtn.onclick = (e) => {
                    e.stopPropagation();
                    window.openPersonSelector(dateKey, ASSIGNED_FIELD, {
                        name: (assigned && assigned.name) || '',
                        id: (assigned && assigned.id) || null
                    });
                };
            }
        }

        // The Planning view's liturgy columns (MS-245). Present in the markup
        // whether or not the Planning view is on, so turning it on is a class
        // on the table rather than a re-render — a re-render would take away
        // the box somebody was typing in.
        const liturgy = svc.liturgy || {};
        PLANNING_COLUMNS.forEach(col => {
            const cell = el.querySelector('.' + col.cell);
            if (!cell) return;
            const value = col.type === 'hymn'
                ? hymnCellText(liturgy[col.field])
                : (liturgy[col.field] || '—');
            setCellText(cell, value);
            if (canEdit) setupInlineEdit(cell, dateKey, col.field);
        });

        const prayersCell = el.querySelector('.prayers-cell');
        if (prayersCell && !hasEditorOpen(prayersCell)) {
            prayersCell.innerHTML = '';
            
            const praiseRow = document.createElement('div');
            praiseRow.className = 'flex gap-1 items-center';
            praiseRow.innerHTML = `<span class="opacity-50">P:</span> <span class="praise-name-cell">${svc.prayerPraiseName || '—'}</span>`;
            praiseRow.querySelector('.praise-name-cell').setAttribute('data-person-id', svc.prayerPraiseId || '');
            
            const confRow = document.createElement('div');
            confRow.className = 'flex gap-1 items-center';
            confRow.innerHTML = `<span class="opacity-50">C:</span> <span class="conf-name-cell">${svc.prayerConfessionName || '—'}</span>`;
            confRow.querySelector('.conf-name-cell').setAttribute('data-person-id', svc.prayerConfessionId || '');
            
            prayersCell.appendChild(praiseRow);
            prayersCell.appendChild(confRow);

            if (canEdit) {
                setupInlineEdit(praiseRow.querySelector('.praise-name-cell'), dateKey, 'prayerPraiseName');
                setupInlineEdit(confRow.querySelector('.conf-name-cell'), dateKey, 'prayerConfessionName');
            }
        }
      } catch (err) {
        console.error('Could not draw the service row for', el.dataset.serviceDate, err);
      }
    });
}

// Write one liturgy slot, and only that slot.
//
// The same rule the Order of Service now follows (MS-243): update() reads
// 'liturgy.hymn1' as a path to one field, so nothing else on the Sunday is
// touched and nobody else's slot can be overwritten by a stale copy of it.
// set(merge) would read that string as a field NAME containing a dot and
// quietly build a second, parallel liturgy beside the real one.
async function writeLiturgyField(dateKey, field, value) {
    const ref = db.collection('services').doc(dateKey);
    const stamp = firebase.firestore.FieldValue.serverTimestamp();

    // An element decided from the Planning view is just as decided as one
    // chosen on the Order of Service page, so it is recorded the same way
    // (MS-246). The tag is only ever SHOWN on the Order of Service page — but
    // recording it in only one place would make that tag a liar. Clearing a
    // slot takes the tag off with it.
    const remove = firebase.firestore.FieldValue.delete();
    const authorship = ServiceAuthorship.stampFor(field, value, currentIdentity, stamp, remove);

    try {
        await ref.update(Object.assign(
            { [`liturgy.${field}`]: value, updatedAt: stamp }, authorship));
    } catch (e) {
        if (e.code !== 'not-found') throw e;
        // No document for this Sunday yet, so the nested shape is written
        // directly — set() would read 'decidedBy.hymn1' as a field NAME with a
        // dot in it and build a parallel record beside the real one.
        const nested = ServiceAuthorship.nestStamps(authorship, remove);
        await ref.set(Object.assign(
            { liturgy: { [field]: value }, updatedAt: stamp },
            nested ? { [ServiceAuthorship.FIELD]: nested } : {}
        ), { merge: true });
    }

    if (!serviceDataMap[dateKey]) serviceDataMap[dateKey] = {};
    if (!serviceDataMap[dateKey].liturgy) serviceDataMap[dateKey].liturgy = {};
    serviceDataMap[dateKey].liturgy[field] = value;
}

// Pick a hymn straight from the table.
//
// A slot holds {id, name}. Choosing from the list gives both; typing something
// the index does not know still saves, as a name with no id — the Order of
// Service has always allowed that ("isLiteral") and the Planning view must not
// be stricter, or a hymn nobody has catalogued yet cannot be planned.
function openHymnEditor(el, dateKey, field) {
    if (el.dataset.editorOpen === 'true') return;

    const slot = (serviceDataMap[dateKey] && serviceDataMap[dateKey].liturgy || {})[field];
    const original = (slot && typeof slot === 'object') ? slot : { id: null, name: (slot || '') };
    const originalDisplay = el.style.display;

    el.dataset.editorOpen = 'true';
    el.style.display = 'none';

    const box = document.createElement('div');
    box.className = 'hymn-inline-editor relative w-full';
    box.innerHTML = `
        <input type="text" class="w-full bg-surface-container-highest border-primary border rounded px-2 py-1 font-body-md text-sm outline-none focus:ring-1 focus:ring-primary shadow-inner" />
        <div class="hymn-inline-results absolute left-0 right-0 top-full mt-1 z-50 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg overflow-hidden hidden"></div>
    `;
    const input = box.querySelector('input');
    const list = box.querySelector('.hymn-inline-results');
    input.value = original.name || '';

    el.parentElement.appendChild(box);
    input.focus();
    input.select();

    let chosen = null;          // set when a hymn is picked off the list
    let closed = false;

    const render = () => {
        const matches = HymnRegistry.search(hymnIndex, input.value);
        list.innerHTML = '';
        if (!matches.length) {
            list.classList.add('hidden');
            return;
        }
        matches.forEach(h => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'w-full text-left px-3 py-2 text-sm hover:bg-primary-fixed/40 transition-colors block';
            row.innerHTML = `<div class="flex items-baseline justify-between gap-2">
                                <span class="text-on-surface">${escapeHtml(h.hymn_name)}</span>
                                <span class="text-on-surface-variant/60 text-xs ml-2">${escapeHtml(h.id)}</span>
                              </div>
                              <div class="text-on-surface-variant/50 text-[11px]">${escapeHtml(UsageStats.formatLabel({ count: h.times_played, lastUsed: h.last_played_date }))}</div>`;
            // mousedown, not click: blur would close the editor first and the
            // click would land on nothing.
            row.onmousedown = (e) => {
                e.preventDefault();
                chosen = { id: h.id, name: h.hymn_name };
                input.value = h.hymn_name;
                commit();
            };
            list.appendChild(row);
        });
        list.classList.remove('hidden');
    };

    const close = () => {
        if (closed) return;
        closed = true;
        box.remove();
        delete el.dataset.editorOpen;
        el.style.display = originalDisplay;
        PresenceStore.release();
    };

    const commit = async () => {
        if (closed) return;
        const typed = input.value.trim();
        // A hymn off the list keeps its id. Anything else is a literal, and a
        // literal must drop the old id — otherwise the cell reads one hymn and
        // the printed guide fetches another.
        const value = chosen && chosen.name === typed
            ? chosen
            : { id: null, name: typed };

        close();

        if (value.id === original.id && value.name === (original.name || '')) return;

        el.textContent = hymnCellText(value);
        el.classList.add('saving-pulse', 'text-secondary/50');
        try {
            await writeLiturgyField(dateKey, field, value);
            injectServiceData(serviceDataMap);
        } catch (err) {
            console.error('Error saving hymn:', err);
            alert('Failed to save.');
            el.textContent = hymnCellText(original);
        } finally {
            el.classList.remove('saving-pulse', 'text-secondary/50');
        }
    };

    input.oninput = () => { chosen = null; render(); };
    input.onfocus = render;
    input.onblur = () => commit();
    input.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); close(); }
    };

    render();
}

// The presence key for a cell. Liturgy slots are named the way they are
// stored, so the Order of Service page and the Planning view claim the SAME
// box for the same element — a hymn locked on one is locked on the other,
// which is the entire point of locking it.
function presenceKeyFor(field) {
    return LITURGY_HYMN_FIELDS.includes(field) || LITURGY_VERSE_FIELDS.includes(field)
        ? 'liturgy.' + field
        : field;
}

// Mark a cell somebody else is in: a face, a name, and no way in. Drawn on the
// cell rather than beside it so it cannot be missed, and returns whether the
// cell is held so the caller can leave the edit handler off entirely.
function markIfHeld(el, dateKey, field) {
    const holder = PresenceStore.holder(dateKey, presenceKeyFor(field));

    el.querySelectorAll('.held-badge').forEach(b => b.remove());
    el.classList.toggle('cell-held', !!holder);

    if (!holder) return null;

    const badge = document.createElement('span');
    badge.className = 'held-badge';
    badge.title = ServicePresence.holderTitle(holder);
    badge.innerHTML =
        `<span class="m-avatar m-avatar--sm">${
            holder.photoUrl
                ? `<img src="${escapeHtml(holder.photoUrl)}" alt="" style="${escapeHtml(PersonPhotoCore.frameStyle(holder.photoCrop))}">`
                : escapeHtml(PersonPhotoCore.initialsOf(holder.name))
        }</span><span class="held-name">${escapeHtml(ServicePresence.holderLabel(holder))}</span>`;
    el.appendChild(badge);
    return holder;
}

function setupInlineEdit(el, dateKey, field) {
    // A cell somebody else is in gets a face instead of an editor. Checked
    // before the handler is attached, so the cell is not merely refusing
    // clicks — it has nothing to click (MS-246).
    if (markIfHeld(el, dateKey, field)) {
        el.classList.remove('cursor-edit');
        el.onclick = null;
        el.title = ServicePresence.holderTitle(PresenceStore.holder(dateKey, presenceKeyFor(field)));
        return;
    }

    el.classList.add('cursor-edit', 'hover:bg-primary-fixed/30', 'rounded', 'px-1', '-mx-1', 'transition-colors');
    el.title = 'Click to edit';

    // Check if it's a Person field
    const personFields = ['serviceLeader', 'musicLeader', 'preacher', 'prayerPraiseName', 'prayerConfessionName', 'prayerMale', 'prayerFemale'];

    el.onclick = (e) => {
        e.stopPropagation();

        // One person per box (MS-246). Refused at the door, so two people are
        // never in the same cell to disagree about whose version wins.
        if (!PresenceStore.claim(dateKey, presenceKeyFor(field))) return;

        if (personFields.includes(field)) {
            let currentVal = el.textContent === '—' ? '' : el.textContent;
            const currentId = el.getAttribute('data-person-id');
            window.openPersonSelector(dateKey, field, { name: currentVal, id: currentId });
            return;
        }

        if (LITURGY_HYMN_FIELDS.includes(field)) {
            openHymnEditor(el, dateKey, field);
            return;
        }

        if (LITURGY_VERSE_FIELDS.includes(field)) {
            const currentVal = el.textContent === '—' ? '' : el.textContent;

            // Fix flicker by checking if already editing this cell
            if (el.querySelector('.verse-picker-inline')) return;

            const originalDisplay = el.style.display;
            const pickerHtml = `
                <div x-data="versePicker('${currentVal}')"
                     class="verse-picker-inline relative w-full">
                    <div class="flex items-center bg-surface-container-low rounded border border-primary px-2 py-1">
                        <input type="text" x-model="query" @input="value = query" @focus="open = true" class="bg-transparent border-none p-0 w-full focus:ring-0 text-sm" placeholder="e.g. Romans 8:28-39">
                        <button @click="toggle()" class="text-secondary hover:text-primary transition-colors cursor-pointer">
                            <span class="material-symbols-outlined text-[18px]">menu_book</span>
                        </button>
                    </div>
                    <div x-show="open" x-transition class="verse-picker-dropdown">
                        <div class="verse-picker-header">
                            <div class="verse-picker-breadcrumbs">
                                <button @click="step = 'book'; if(selectingRangeEnd){rangeBook=''}else{selectedBook=''}" class="verse-picker-btn verse-picker-btn-book" style="padding: 2px 4px; font-size: 10px;" x-text="breadcrumbBook"></button>
                                <template x-if="activeBook">
                                    <div class="flex items-center gap-1">
                                        <span class="material-symbols-outlined text-[12px]">chevron_right</span>
                                        <button @click="step = 'chapter'; if(selectingRangeEnd){rangeChapter=null}else{selectedChapter=null}" class="verse-picker-btn verse-picker-btn-chapter" style="padding: 2px 4px; font-size: 10px;" x-text="breadcrumbChapter"></button>
                                    </div>
                                </template>
                                <template x-if="activeChapter">
                                    <div class="flex items-center gap-1">
                                        <span class="material-symbols-outlined text-[12px]">chevron_right</span>
                                        <span class="text-secondary" x-text="breadcrumbVerse"></span>
                                    </div>
                                </template>
                            </div>
                            <button @click="open = false" class="text-secondary hover:text-primary cursor-pointer flex items-center">
                                <span class="material-symbols-outlined text-sm">close</span>
                            </button>
                        </div>

                        <div x-show="scriptureMatches.length" class="border-b border-outline-variant overflow-y-auto max-h-40">
                            <template x-for="ref in scriptureMatches" :key="ref.reference">
                                <button @click="selectReference(ref)" class="w-full text-left px-3 py-2 hover:bg-primary-fixed transition-colors border-b last:border-0 flex items-center justify-between gap-3">
                                    <span class="text-sm font-label-md" x-text="ref.reference"></span>
                                    <span class="text-[10px] text-on-surface-variant/60 shrink-0" x-text="UsageStats.formatLabel(ref)"></span>
                                </button>
                            </template>
                        </div>

                        <div class="verse-picker-grid max-h-56" style="grid-template-columns: repeat(4, minmax(0, 1fr))" x-show="step === 'book'">
                            <template x-for="book in filteredBooks" :key="book">
                                <button @click="selectBook(book)" class="verse-picker-btn verse-picker-btn-book" :class="activeBook === book ? 'verse-picker-btn-active' : ''" x-text="book"></button>
                            </template>
                        </div>

                        <div class="verse-picker-grid max-h-56" style="grid-template-columns: repeat(6, minmax(0, 1fr))" x-show="step === 'chapter'">
                            <template x-for="chapter in chapters" :key="chapter">
                                <button @click="selectChapter(chapter)" class="verse-picker-btn verse-picker-btn-chapter" :class="activeChapter === chapter ? 'verse-picker-btn-active' : ''" x-text="chapter"></button>
                            </template>
                        </div>

                        <div class="p-2 flex flex-col" x-show="step === 'verse'">
                            <div class="verse-picker-grid max-h-56" style="grid-template-columns: repeat(6, minmax(0, 1fr))">
                                <template x-for="verse in verses" :key="verse">
                                    <button @click="selectVerse(verse)" class="verse-picker-btn verse-picker-btn-verse" 
                                        :class="{
                                            'verse-picker-btn-active': (!selectingRangeEnd && selectedVerse === verse) || (selectingRangeEnd && rangeVerse === verse),
                                            'border-primary/50 text-primary/60': selectingRangeEnd && verse === selectedVerse && rangeBook === selectedBook && rangeChapter === selectedChapter && rangeVerse !== verse
                                        }" 
                                        x-text="verse"></button>
                                </template>
                            </div>
                            <template x-if="selectedVerse !== null && !selectingRangeEnd">
                                <button @click="startRangeSelection()" class="verse-picker-range-btn">
                                    <span class="material-symbols-outlined text-[14px] align-middle mr-1">arrow_right_alt</span>
                                    Range
                                </button>
                            </template>
                        </div>
                    </div>
                </div>
            `;
            
            el.style.display = 'none';

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = pickerHtml.trim();
            const pickerEl = tempDiv.firstChild;
            
            el.parentElement.appendChild(pickerEl);
            
            const closePicker = async () => {
                if (!pickerEl.isConnected) return;

                // Read the current value from Alpine before removing the element
                const alpineData = window.Alpine ? Alpine.$data(pickerEl) : null;
                const finalVal = (alpineData ? alpineData.query : '').trim();

                pickerEl.remove();
                el.style.display = originalDisplay;
                PresenceStore.release();

                if (finalVal !== currentVal) {
                    try {
                        await writeLiturgyField(dateKey, field, finalVal);
                        injectServiceData(serviceDataMap);
                    } catch (err) {
                        console.error('Error saving scripture reference:', err);
                        alert('Failed to save.');
                    }
                }
            };

            // Initialize Alpine on the new element
            if (window.Alpine) {
                Alpine.initTree(pickerEl);
                setTimeout(() => {
                    const input = pickerEl.querySelector('input');
                    if (input) input.focus();
                }, 10);
            }

            // Dismiss picker when clicking outside — use capture so it runs before Alpine
            const outsideClickHandler = (e) => {
                if (!pickerEl.contains(e.target)) {
                    closePicker();
                    document.removeEventListener('click', outsideClickHandler, true);
                }
            };
            // Defer attachment so the opening click doesn't immediately close it
            setTimeout(() => document.addEventListener('click', outsideClickHandler, true), 50);

            return;
        }

        const currentVal = el.textContent === '—' ? '' : el.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentVal;
        input.className = 'w-full bg-surface-container-highest border-primary border rounded px-2 py-1 font-body-md text-sm outline-none focus:ring-1 focus:ring-primary shadow-inner';
        
        const originalParent = el.parentElement;
        const originalDisplay = el.style.display;
        el.style.display = 'none';
        originalParent.appendChild(input);
        input.focus();

        const save = async () => {
            const newVal = input.value.trim();
            if (newVal !== currentVal) {
                // Show saving state
                el.textContent = newVal || '—';
                el.classList.add('saving-pulse', 'text-secondary/50');
                
                try {
                    // Map display field to ID field if applicable
                    const idFieldMap = {
                        'serviceLeader': 'serviceLeaderId',
                        'musicLeader': 'musicLeaderId',
                        'preacher': 'preacherId',
                        'prayerPraiseName': 'prayerPraiseId',
                        'prayerConfessionName': 'prayerConfessionId'
                    };

                    const updates = {
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    };

                    if (field === 'baptism') {
                        updates.hasBaptism = newVal !== '';
                    } else {
                        updates[field] = newVal;
                    }

                    // Clear ID if we're updating a name field, as it's now a literal string
                    if (idFieldMap[field]) {
                        updates[idFieldMap[field]] = null;
                    }

                    // set() with merge is correct for top-level fields (creates the doc if needed).
                    await db.collection('services').doc(dateKey).set(updates, { merge: true });

                    // Baptism also writes into the nested liturgy map — must use update() so
                    // dot notation is interpreted as a field path, not a literal key name.
                    if (field === 'baptism') {
                        await db.collection('services').doc(dateKey).update({
                            'liturgy.baptism': newVal
                        });
                    }
                    
                    // Update global map to keep views in sync if they toggle
                    if (!serviceDataMap[dateKey]) serviceDataMap[dateKey] = {};
                    if (field === 'baptism') {
                        serviceDataMap[dateKey].hasBaptism = updates.hasBaptism;
                        if (!serviceDataMap[dateKey].liturgy) serviceDataMap[dateKey].liturgy = {};
                        serviceDataMap[dateKey].liturgy.baptism = newVal;
                    } else {
                        serviceDataMap[dateKey][field] = newVal;
                        if (idFieldMap[field]) serviceDataMap[dateKey][idFieldMap[field]] = null;
                    }
                    
                    // Trigger a re-injection to update all views (List and Table)
                    injectServiceData(serviceDataMap);
                } catch (err) {
                    console.error('Error updating service field:', err);
                    alert('Failed to save change.');
                    el.textContent = currentVal || '—';
                } finally {
                    el.classList.remove('saving-pulse', 'text-secondary/50');
                }
            }
            input.remove();
            el.style.display = originalDisplay;
            PresenceStore.release();
        };

        input.onblur = save;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
                input.remove();
                el.style.display = originalDisplay;
                PresenceStore.release();
            }
        };
    };
}

window.openVersePicker = (dateKey, field, current) => {
    const body = document.querySelector('body');
    const alpineData = Alpine.$data(body);
    if (alpineData && alpineData.openVersePicker) {
        alpineData.openVersePicker(dateKey, field, current);
    }
};

/**
 * Global bridge to Alpine person selector modal
 */
window.openPersonSelector = (dateKey, field, current) => {
    // Find Alpine data on body
    const body = document.querySelector('body');
    const alpineData = Alpine.$data(body);
    if (alpineData && alpineData.openPersonSelector) {
        alpineData.openPersonSelector(dateKey, field, current);
    }
};

/**
 * Shared Person Picker component logic (Alpine.js)
 */
function personPicker(personRef, parent = null, suggestionsKey = null) {
    if (!personRef) personRef = { name: '', id: null };
    return {
        personRef: personRef,
        parent: parent,
        suggestionsKey: suggestionsKey,
        // This one component instance is reused for every field the modal
        // opens on (MS-246's shared-modal shape), so — like `suggestions`
        // below already does for `activeSuggestionsKey` — the field has to
        // be read fresh off the parent each time rather than captured once
        // at construction, or every field after the first would still show
        // the previous field's usage stat.
        get field() {
            return this.parent && this.parent.selectorField;
        },
        usageLabelFor(candidate) {
            if (!UsageStats.isTrackedField(this.field)) return '';
            return UsageStats.formatLabel(UsageStats.personStatFor(candidate, this.field));
        },
        get isPastoralPrayerField() {
            return this.field === 'prayerMale' || this.field === 'prayerFemale';
        },
        // prayerMale/prayerFemale keep showing PastoralPrayerCore's own
        // wording (the one label every surface uses) — this only adds the
        // count beside it, rather than replacing it with usageLabelFor's.
        prayerCountFor(candidate) {
            const stat = this.field && UsageStats.personStatFor(candidate, this.field);
            return stat && stat.count ? `${stat.count}×` : '';
        },
        get suggestions() {
            let key = this.suggestionsKey;
            if (key === 'activeSuggestionsKey' && this.parent) {
                key = this.parent.activeSuggestionsKey; 
            }
            
            if ((key === 'males' || key === 'females') && this.parent && this.parent.prayerSuggestions) {
                return this.parent.prayerSuggestions[key] || [];
            }
            return [];
        },
        open: false,
        query: personRef.name || '',
        results: [],
        keepOpenInterval: null,
        lastFirestoreQuery: '',
        hadFuse: false,
        
        init() {
            this.$watch('personRef.name', (val) => {
                this.query = val || '';
            });
            // Auto-open suggestions when modal is shown (watch parent prop proxied via this)
            this.$watch('showPersonSelector', (val) => {
                if (val && this.suggestionsKey) {
                    // Try to grab the input element inside the selector modal
                    const inputEl = document.getElementById('person-selector-input');
                    this.onFocus(inputEl);
                }
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
                let key = this.suggestionsKey;
                if (key === 'activeSuggestionsKey' && this.parent) {
                    key = this.parent.activeSuggestionsKey; 
                }

                if (!this.query || this.query.trim().length === 0) {
                    if (key === 'males' || key === 'females') {
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

// --- AUTH PROTECTION ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const userData = await getUserData(user.uid);
            const permissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
            window.currentPermissionLevel = permissionLevel;
            // Needed before the first edit, so an element decided here records
            // who decided it (MS-246).
            currentIdentity = await MosaicIdentity.me({ db, getUserData, uid: user.uid });
            if (['editor', 'elder', 'admin', 'super_admin'].includes(permissionLevel)) {
                // ⚠ EDITING RIGHTS FIRST, ALWAYS.
                //
                // This whole block sits inside a try/catch. Anything that
                // throws above this line is swallowed and `can-edit` never
                // lands, which does not look like an error — it looks like a
                // page where nothing can be clicked into. Presence used to run
                // first and did exactly that.
                document.body.classList.add('can-edit');

                // Who else is editing, and which cells they hold (MS-246).
                // After the line above, and cannot throw regardless.
                PresenceStore.start({
                    db: db,
                    uid: user.uid,
                    identity: currentIdentity,
                    surface: 'calendar',
                    // One page covering every Sunday, so it has no page key.
                    pageKey: null,
                    stamp: () => firebase.firestore.FieldValue.serverTimestamp(),
                    onChange: () => injectServiceData(serviceDataMap)
                });
                // A courtesy that makes the common case instant. Expiry is
                // what actually frees a box.
                // leave(), not release(): release writes a fresh timestamp,
                // which would leave you looking newly arrived for half a
                // minute after closing the tab.
                window.addEventListener('beforeunload', () => PresenceStore.leave());
                const importBtn = document.getElementById('import-docx-btn');
                if (importBtn) {
                    importBtn.classList.remove('hidden');
                    if (window.initDocxImporter) {
                        window.initDocxImporter(() => {
                            location.reload();
                        });
                    }
                }
                const injectBtn = document.getElementById('inject-service-btn');
                if (injectBtn) injectBtn.classList.remove('hidden');
                // Re-inject data to enable edit handlers
                if (Object.keys(serviceDataMap).length > 0) {
                    injectServiceData(serviceDataMap);
                }
            }
        } catch (error) {
            console.error("Error checking user permissions:", error);
        }
    } else {
        document.body.classList.remove('can-edit');
    }
});

// Escapes text for HTML. Done by hand rather than through a detached <div>,
// because that trick leaves quotes alone — fine for text between tags, wrong
// the moment the value goes into an attribute, which the Assigned badge does
// with a name and a photo URL.
function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
// Expose pure helpers for Node-based unit tests; ignored in the browser.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizeServiceDoc, isCellBeingEdited, setCellText, hasEditorOpen,
        PLANNING_COLUMNS, LITURGY_HYMN_FIELDS, LITURGY_VERSE_FIELDS, hymnCellText,
        ASSIGNED_FIELD, assignedBadgeHtml, firstNameOf, escapeHtml,
        presenceKeyFor, setupInlineEdit, markIfHeld
    };
}
