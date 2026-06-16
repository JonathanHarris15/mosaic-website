function calendarPage() {
    return {
        view: localStorage.getItem('calendarView') || 'list',
        showHistory: false,
        showDirectory: false,
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
                const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

                const snap = await db.collection('people')
                    .where('tags', 'array-contains', 'Member')
                    .get();
                
                const members = snap.docs.map(d => ({ id: d.id, ...d.data() }));

                const getTop3 = (sex) => {
                    return members
                        .filter(m => m.sex === sex)
                        .filter(m => !m.lastPastoralPrayerDate || m.lastPastoralPrayerDate < todayStr)
                        .sort((a, b) => {
                            const dateA = a.lastPastoralPrayerDate || '0000-00-00';
                            const dateB = b.lastPastoralPrayerDate || '0000-00-00';
                            return dateA.localeCompare(dateB);
                        })
                        .slice(0, 3);
                };

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
        
        getRoleName(field) {
            const names = {
                'serviceLeader': 'Service Leader',
                'preacher': 'Preacher',
                'sermonette': 'Sermonette',
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
                    'sermonette': 'sermonetteId',
                    'prayerPraiseName': 'prayerPraiseId',
                    'prayerConfessionName': 'prayerConfessionId',
                    'prayerMale': null,
                    'prayerFemale': null
                };
                const roleMap = {
                    'serviceLeader': 'service_leader',
                    'musicLeader': 'worship_leader',
                    'preacher': 'preacher',
                    'sermonette': 'sermonette',
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
                            batch.delete(oldPersonRef.collection('pastoral_prayer_history').doc(this.selectorDateKey));
                        } else {
                            let query = oldPersonRef.collection('involvement')
                                .where('serviceDate', '==', this.selectorDateKey)
                                .where('type', '==', role);
                            if (metadata && metadata.prayer_type) query = query.where('metadata.prayer_type', '==', metadata.prayer_type);
                            const invSnap = await query.get();
                            invSnap.forEach(d => batch.delete(d.ref));
                            if (!invSnap.empty) {
                                batch.update(oldPersonRef, { totalInvolvements: firebase.firestore.FieldValue.increment(-invSnap.size) });
                            }
                        }
                    }

                    if (newId) {
                        const newPersonRef = db.collection('people').doc(newId);
                        if (role === 'pastoral_prayer') {
                            batch.set(newPersonRef.collection('pastoral_prayer_history').doc(this.selectorDateKey), {
                                serviceDate: this.selectorDateKey,
                                createdAt: firebase.firestore.FieldValue.serverTimestamp()
                            });
                        } else {
                            const invData = {
                                serviceDate: this.selectorDateKey,
                                type: role,
                                createdAt: firebase.firestore.FieldValue.serverTimestamp()
                            };
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
                        const pRef = db.collection('people').doc(pid);
                        const histSnap = await pRef.collection('pastoral_prayer_history').orderBy('serviceDate', 'desc').limit(1).get();
                        const latestDate = histSnap.empty ? '0000-00-00' : histSnap.docs[0].data().serviceDate;
                        await pRef.update({ lastPastoralPrayerDate: latestDate });
                    }
                }

                this.showPersonSelector = false;
                // Full reload to ensure everything is perfectly in sync with Firestore
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
            this.$watch('showHistory', val => {
                if (window.refreshCalendar) window.refreshCalendar(val);
            });
            await this.loadPeopleRegistry();
        },

        async loadPeopleRegistry() {
            try {
                const snap = await db.collection('people').get();
                this.peopleRegistry = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

function dateStrToDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function dateToStr(dt) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Add one week to a YYYY-MM-DD string, returning the same format.
function addWeek(dateStr) {
    const dt = dateStrToDate(dateStr);
    dt.setDate(dt.getDate() + 7);
    return dateToStr(dt);
}

// Upcoming Sundays (today or later) as { value: 'YYYY-MM-DD', label: 'June 14, 2026' }.
window.getUpcomingSundays = function () {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return allSundays
        .filter(d => {
            const x = new Date(d);
            x.setHours(0, 0, 0, 0);
            return x >= today;
        })
        .map(d => ({
            value: dateToStr(d),
            label: d.toLocaleDateString('default', { month: 'long', day: 'numeric', year: 'numeric' })
        }));
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

    const prayerSnap = await db.collectionGroup('pastoral_prayer_history').get();
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
        const oldDate = prayerDate(doc);
        const newRef = doc.ref.parent.doc(addWeek(oldDate));
        prayerNewPaths.add(newRef.path);
        setsAndUpdates.push({ kind: 'set', ref: newRef, data: { ...doc.data(), serviceDate: addWeek(oldDate) } });
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

    // --- Recompute lastPastoralPrayerDate for affected people --------------
    const affectedPeopleIds = new Set(affectedPrayers.map(doc => doc.ref.parent.parent.id));
    for (const pid of affectedPeopleIds) {
        const pRef = db.collection('people').doc(pid);
        const histSnap = await pRef.collection('pastoral_prayer_history').orderBy('serviceDate', 'desc').limit(1).get();
        const latestDate = histSnap.empty ? '0000-00-00' : histSnap.docs[0].data().serviceDate;
        await pRef.update({ lastPastoralPrayerDate: latestDate });
    }

    return {
        services: affectedServices.length,
        involvements: affectedInv.length,
        prayers: affectedPrayers.length,
        people: affectedPeopleIds.size
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
    const isViewer = !['editor', 'elder', 'admin', 'super_admin'].includes(window.currentUserRole);
    
    if (!isViewer && svc) {
        let incomplete = false;
        if (svc.guide && svc.guide.elements) {
            const prayer = svc.guide.elements.find(el => el.type === 'pastoral_prayer');
            const kids = svc.guide.elements.find(el => el.type === 'kids_section');
            const announcements = svc.guide.elements.find(el => el.type === 'announcements');
            
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
    window.location.href = `service-guide.html?date=${date}`;
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
                    const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

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
                    <td colspan="9" class="px-md py-2 z-25 bg-surface-container-low/90 backdrop-blur-sm">
                        <h3 class="font-headline-md text-sm uppercase tracking-wider text-secondary">${month} ${year}</h3>
                    </td>
                `;
                tbody.appendChild(separatorRow);

                grouped[year][month].forEach(date => {
                    const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    
                    const row = document.createElement('tr');
                    row.id = `table-date-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                    row.dataset.serviceDate = formattedDate;
                    row.className = 'group hover:bg-surface-container-low transition-colors scroll-mt-32';
                    
                    row.innerHTML = `
                        <td class="px-md py-md whitespace-nowrap sticky-col-left">
                            <span class="font-body-md text-on-surface">${date.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
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
                            <div class="preacher-column-cell flex flex-col items-start gap-1">
                                <div class="preacher-cell font-body-md text-on-surface-variant text-sm">—</div>
                                <div class="sermonette-row flex items-center gap-1 group/sermonette">
                                    <div class="sermonette-cell font-body-md text-xs text-tertiary hidden"></div>
                                    <button title="Add Sermonette" class="add-sermonette-btn hidden p-0.5 text-tertiary/50 hover:text-tertiary transition-colors rounded">
                                        <span class="material-symbols-outlined text-[16px]">add</span>
                                    </button>
                                </div>
                            </div>
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
async function loadServiceData() {
    if (typeof db === 'undefined') return;

    try {
        const snapshot = await db.collection('services').get();
        serviceDataMap = {};
        snapshot.forEach(doc => {
            const raw = doc.data();

            // Older saves used set() with merge and dotted key names like 'liturgy.sermon',
            // which Firestore stores as a literal field name containing a dot rather than
            // as a nested path. Normalize those back into their proper nested structure so
            // the display code (which reads svc.liturgy.sermon) finds the value.
            const data = {};
            for (const [key, val] of Object.entries(raw)) {
                if (!key.includes('.')) {
                    data[key] = val;
                }
            }
            for (const [key, val] of Object.entries(raw)) {
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

            serviceDataMap[doc.id] = data;
        });

        injectServiceData(serviceDataMap);
    } catch (e) {
        console.error('Error loading service data for calendar:', e);
    }
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
        const dateKey = el.dataset.serviceDate;
        const svc = serviceMap[dateKey] || {};

        // List View Injection
        const summaryEl = el.querySelector('.service-summary');
        if (summaryEl) {
            let html = '';
            
            // Badges Row
            if (svc.hasBaptism || svc.sermonette || svc.isIrregular || canEdit) {
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
                if (svc.sermonette) {
                    html += `
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold uppercase tracking-wider">
                            <span class="material-symbols-outlined text-[14px]">mic</span>
                            Sermonette
                        </span>`;
                } else if (canEdit) {
                    // Hidden "Add Sermonette" ghost button
                    html += `
                        <button onclick="window.openPersonSelector('${dateKey}', 'sermonette', { name: '', id: null })" 
                                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-outline-variant text-on-surface-variant hover:text-primary hover:border-primary text-[10px] font-bold uppercase tracking-wider transition-colors"
                                title="Add Sermonette">
                            <span class="material-symbols-outlined text-[14px]">add</span>
                            Sermonette
                        </button>`;
                }
                html += `</div>`;
            }

            if (svc.theme) {
                html += `<p class="text-xs font-label-md text-primary flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">bookmark</span>
                    ${escapeHtml(svc.theme)}
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
            if (svc.sermonette) {
                html += `<p class="text-xs text-on-surface-variant flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">mic</span>
                    Sermonette: ${escapeHtml(svc.sermonette)}
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
            sermonCell.textContent = (svc.liturgy && svc.liturgy.sermon) || '—';
            if (canEdit) setupInlineEdit(sermonCell, dateKey, 'sermon');
        }

        const themeCell = el.querySelector('.theme-cell');
        if (themeCell) {
            themeCell.textContent = svc.theme || '—';
            if (canEdit) setupInlineEdit(themeCell, dateKey, 'theme');
        }

        const leaderCell = el.querySelector('.leader-cell');
        if (leaderCell) {
            leaderCell.textContent = svc.serviceLeader || '—';
            leaderCell.setAttribute('data-person-id', svc.serviceLeaderId || '');
            if (canEdit) setupInlineEdit(leaderCell, dateKey, 'serviceLeader');
        }

        const preacherCell = el.querySelector('.preacher-cell');
        if (preacherCell) {
            preacherCell.textContent = svc.preacher || '—';
            preacherCell.setAttribute('data-person-id', svc.preacherId || '');
            if (canEdit) setupInlineEdit(preacherCell, dateKey, 'preacher');
        }

        const sermonetteCell = el.querySelector('.sermonette-cell');
        const addSermonetteBtn = el.querySelector('.add-sermonette-btn');
        if (sermonetteCell) {
            if (svc.sermonette) {
                sermonetteCell.textContent = `${svc.sermonette} (Sermonette)`;
                sermonetteCell.setAttribute('data-person-id', svc.sermonetteId || '');
                sermonetteCell.classList.remove('hidden');
                if (addSermonetteBtn) addSermonetteBtn.classList.add('hidden');
            } else {
                sermonetteCell.textContent = '';
                sermonetteCell.setAttribute('data-person-id', '');
                sermonetteCell.classList.add('hidden');
                
                if (canEdit && addSermonetteBtn) {
                    addSermonetteBtn.classList.remove('hidden');
                    addSermonetteBtn.onclick = (e) => {
                        e.stopPropagation();
                        window.openPersonSelector(dateKey, 'sermonette', { name: '', id: null });
                    };
                } else if (addSermonetteBtn) {
                    addSermonetteBtn.classList.add('hidden');
                }
            }
            if (canEdit && svc.sermonette) setupInlineEdit(sermonetteCell, dateKey, 'sermonette');
        }

        const baptismCell = el.querySelector('.baptism-cell');
        if (baptismCell) {
            // Baptism Candidates are linked to People and managed in the Order of
            // Service Builder, so the calendar shows them read-only.
            baptismCell.textContent = baptismCandidateNames(svc) || '—';
        }

        const musicCell = el.querySelector('.music-cell');
        if (musicCell) {
            musicCell.textContent = svc.musicLeader || '—';
            musicCell.setAttribute('data-person-id', svc.musicLeaderId || '');
            if (canEdit) setupInlineEdit(musicCell, dateKey, 'musicLeader');
        }

        const prayerFemaleCell = el.querySelector('.prayer-female-cell');
        if (prayerFemaleCell) {
            const val = (svc.liturgy && svc.liturgy.prayerFemale) ? svc.liturgy.prayerFemale.name : '—';
            const id = (svc.liturgy && svc.liturgy.prayerFemale) ? svc.liturgy.prayerFemale.id : '';
            prayerFemaleCell.textContent = val || '—';
            prayerFemaleCell.setAttribute('data-person-id', id || '');
            if (canEdit) setupInlineEdit(prayerFemaleCell, dateKey, 'prayerFemale');
        }

        const pastoralPrayerCell = el.querySelector('.pastoral-prayer-cell');
        if (pastoralPrayerCell) {
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

        const prayersCell = el.querySelector('.prayers-cell');
        if (prayersCell) {
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
    });
}

function setupInlineEdit(el, dateKey, field) {
    el.classList.add('cursor-edit', 'hover:bg-primary-fixed/30', 'rounded', 'px-1', '-mx-1', 'transition-colors');
    el.title = 'Click to edit';
    
    // Check if it's a Person field
    const personFields = ['serviceLeader', 'musicLeader', 'preacher', 'sermonette', 'prayerPraiseName', 'prayerConfessionName', 'prayerMale', 'prayerFemale'];

    el.onclick = (e) => {
        e.stopPropagation();

        if (personFields.includes(field)) {
            let currentVal = el.textContent === '—' || el.textContent === '— (Sermonette)' ? '' : el.textContent;
            if (field === 'sermonette') currentVal = currentVal.replace(' (Sermonette)', '');
            const currentId = el.getAttribute('data-person-id');
            window.openPersonSelector(dateKey, field, { name: currentVal, id: currentId });
            return;
        }

        if (field === 'sermon') {
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
                        
                        <div class="verse-picker-grid h-32" style="grid-template-columns: repeat(4, minmax(0, 1fr))" x-show="step === 'book'">
                            <template x-for="book in filteredBooks" :key="book">
                                <button @click="selectBook(book)" class="verse-picker-btn verse-picker-btn-book" :class="activeBook === book ? 'verse-picker-btn-active' : ''" x-text="book"></button>
                            </template>
                        </div>

                        <div class="verse-picker-grid h-32" style="grid-template-columns: repeat(6, minmax(0, 1fr))" x-show="step === 'chapter'">
                            <template x-for="chapter in chapters" :key="chapter">
                                <button @click="selectChapter(chapter)" class="verse-picker-btn verse-picker-btn-chapter" :class="activeChapter === chapter ? 'verse-picker-btn-active' : ''" x-text="chapter"></button>
                            </template>
                        </div>

                        <div class="p-2 flex flex-col" x-show="step === 'verse'">
                            <div class="verse-picker-grid h-24" style="grid-template-columns: repeat(6, minmax(0, 1fr))">
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

                if (finalVal !== currentVal) {
                    try {
                        const ref = db.collection('services').doc(dateKey);
                        try {
                            // update() interprets dot notation as a nested field path.
                            // set() with merge treats 'liturgy.sermon' as a literal key name.
                            await ref.update({
                                'liturgy.sermon': finalVal,
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                            });
                        } catch (e) {
                            if (e.code !== 'not-found') throw e;
                            // Document doesn't exist yet — create it
                            await ref.set({
                                liturgy: { sermon: finalVal },
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                            });
                        }
                        if (!serviceDataMap[dateKey]) serviceDataMap[dateKey] = {};
                        if (!serviceDataMap[dateKey].liturgy) serviceDataMap[dateKey].liturgy = {};
                        serviceDataMap[dateKey].liturgy.sermon = finalVal;
                        injectServiceData(serviceDataMap);
                    } catch (err) {
                        console.error('Error saving sermon reference:', err);
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
                        'sermonette': 'sermonetteId',
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
        };

        input.onblur = save;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
                input.remove();
                el.style.display = originalDisplay;
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
            const role = (userData && userData.role) || 'viewer';
            window.currentUserRole = role;
            if (['editor', 'elder', 'admin', 'super_admin'].includes(role)) {
                document.body.classList.add('can-edit');
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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}