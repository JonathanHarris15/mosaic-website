import { parseBibleReference } from './analytics-utils.js';

export function analyticsPage() {
    return {
        activeTab: 'hymns', // 'hymns' or 'bible'
        loading: true,
        progress: 0,
        people: [],
        peopleSearch: '',
        peopleSortKey: 'totalInvolvements',
        peopleSortOrder: 'desc',
        pastoralSearch: '',
        praiseSortKey: 'lastPrayed',
        praiseSortOrder: 'asc',
        selectedPerson: null,
        personInvolvement: [],
        loadingInvolvement: false,
        hymnStats: [],
        roleAnalytics: {},
        prayerStats: {},
        bibleStats: {
            chapters: {}, // { "Genesis-1": { count: 0, services: [], verses: { 1: count, 2: count } } }
            books: {},    // { "Genesis": { count: 0 } }
            timeline: []  // Array of { book, chapters: [{ chapter, count }] }
        },
        hymnSearch: '',
        bibleFilters: {
            keyVerse: true,
            callToWorship: true,
            callToConfession: true,
            assuranceOfPardon: true,
            scriptureReading: true,
            sermon: true,
            benediction: true
        },
        selectedBook: null,
        selectedChapter: null,
        showBookNames: false,
        gridZoom: 1, // 1 is standard, 0.75 is small, 1.5 is large
        drillDownData: null, // Will hold the book object with chapters and verses usage
        sortKey: 'count', // 'name', 'status', 'count', 'lastUsed'
        sortOrder: 'desc', // 'asc', 'desc'
        currentPermissionLevel: 'viewer',
        tagMetadata: {},

        // Signed in, below editor. The page says so instead of drawing.
        refused: false,

        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    window.location.href = 'login.html';
                    return;
                }
                const userData = await getUserData(user.uid);
                this.currentPermissionLevel = (userData && userData.permissionLevel) || (userData && userData.role) || 'viewer';

                // ── Editors and above ────────────────────────────────────────
                //
                // This screen reads the WHOLE history of the church's services
                // and turns it into who has done what, how often, and when they
                // last did it. That is a planning tool for the people who staff
                // Sundays, not a public record of anybody's serving — a member
                // browsing how many times each person has been on the rota is a
                // different thing from a member reading the rota.
                //
                // ⚠ REFUSED BEFORE THE READ, not after the draw. The tab bar and
                // every panel are gated on the same flag, but the read is what
                // actually assembles the history, and a page that fetches it and
                // then hides it has still handed it to the browser.
                //
                // ⚠ AND IT IS A DOOR, NOT A LOCK. `services`, `involvement` and
                // `people` are all world-readable in firestore.rules — the
                // congregant-facing Service Guide needs them — so this stops the
                // screen, not the data. Anyone who can write a query can still
                // assemble it. Closing that is a rules change with the printed
                // booklet on the other side of it, and it is not this.
                if (!this.isEditor) {
                    this.refused = true;
                    this.loading = false;
                    return;
                }

                await this.loadTagMetadata();
                await this.fetchAndProcessData();
                this.loading = false;
            });
        },

        get isAdmin() {
            return ['elder', 'super_admin'].includes(this.currentPermissionLevel);
        },

        get isEditor() {
            return ['editor', 'elder', 'admin', 'super_admin'].includes(this.currentPermissionLevel);
        },

        async loadTagMetadata() {
            try {
                const snap = await db.collection('people_tags').get();
                const metadata = {};
                snap.forEach(doc => {
                    const data = doc.data();
                    metadata[doc.id] = {
                        hidePeople: data.hidePeople || false
                    };
                });
                this.tagMetadata = metadata;
            } catch (e) {
                console.error("Error loading tag metadata:", e);
            }
        },

        async fetchAndProcessData() {
            try {
                const snapshot = await db.collection('services').get();
                const total = snapshot.size;
                let processed = 0;
                
                const hymnsMap = {}; 
                const bibleChapters = {};
                const peopleMap = {}; // { name: { roles: { role: count } } }

                const now = new Date();
                const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

                snapshot.forEach(doc => {
                    const data = doc.data();
                    const date = doc.id;
                    if (date > todayStr) { processed++; return; }
                    
                    this.processHymns(data, date, hymnsMap);
                    this.processBibleReferences(data, date, bibleChapters);
                    this.processServicePeople(data, peopleMap);

                    processed++;
                    this.progress = Math.round((processed / total) * 0.5 * 100);
                });

                // Fetch Pastoral Prayer History (Collection Group)
                //
                // The history is the record; `lastPastoralPrayerDate` on the
                // Person is only a cache of it, so this page reads the history
                // and does not defer to the cache.
                //
                // Two different questions, two different date sets. How OFTEN
                // someone has been prayed for, and how far apart, can only count
                // Sundays that have happened — a booking six weeks out is not a
                // prayer yet. But "last prayed for" has to include it, or the
                // page shows a member as long overdue on the very week they are
                // already down for.
                const prayerSnap = await db.collectionGroup(PastoralPrayerCore.HISTORY_COLLECTION).get();
                const prayerMap = {}; // { personId: { count, lastDate, dates, allDates } }

                prayerSnap.forEach(doc => {
                    const personId = doc.ref.parent.parent.id;
                    const sDate = PastoralPrayerCore.normalizeDate(doc.data().serviceDate || doc.id);
                    if (!sDate) return;

                    if (!prayerMap[personId]) {
                        prayerMap[personId] = { count: 0, lastDate: null, dates: [], allDates: [] };
                    }
                    prayerMap[personId].allDates.push(sDate);

                    if (sDate <= todayStr) {
                        prayerMap[personId].count++;
                        prayerMap[personId].dates.push(sDate);
                    }
                });

                // Finalize prayer stats (sort dates, calculate intervals)
                Object.values(prayerMap).forEach(stat => {
                    stat.dates.sort();
                    stat.lastDate = PastoralPrayerCore.latestDate(stat.allDates);

                    if (stat.dates.length >= 2) {
                        let totalDiff = 0;
                        for (let i = 1; i < stat.dates.length; i++) {
                            const d1 = new Date(stat.dates[i-1]);
                            const d2 = new Date(stat.dates[i]);
                            totalDiff += (d2 - d1) / (1000 * 60 * 60 * 24);
                        }
                        stat.avgInterval = totalDiff / (stat.dates.length - 1);
                    } else {
                        stat.avgInterval = null;
                    }
                });
                
                this.prayerStats = prayerMap;
                this.progress = 75;

                this.hymnStats = Object.values(hymnsMap).sort((a, b) => b.count - a.count);
                this.bibleStats.chapters = bibleChapters;
                this.roleAnalytics = peopleMap;
                this.generateTimeline();
                
                // Fetch people after aggregation is ready
                await this.fetchPeople();
                this.progress = 100;

            } catch (error) {
                console.error("Error fetching analytics data:", error);
            }
        },

        processServicePeople(data, map) {
            // Some fields store name directly, others use a "Name" suffix
            const roleFields = {
                // Direct name fields
                serviceLeader: 'service_leader',
                preacher: 'preacher',
                musicLeader: 'worship_leader',
                // Suffix name fields
                prayerPraiseName: 'prayer',
                prayerConfessionName: 'prayer',
                elementsName: 'other',
                otherName: 'other'
            };

            const addInvolvement = (val, type) => {
                if (!val) return;
                let name = '';
                if (typeof val === 'string') {
                    name = val.trim();
                } else if (typeof val === 'object' && val.name) {
                    name = val.name.trim();
                }
                
                if (name && name !== '—') { // Ignore the em-dash placeholder
                    if (!map[name]) map[name] = { roles: {} };
                    map[name].roles[type] = (map[name].roles[type] || 0) + 1;
                }
            };

            Object.entries(roleFields).forEach(([field, type]) => {
                // Check the field itself (e.g. 'serviceLeader')
                addInvolvement(data[field], type);
                
                // Also check if there's a version without the "Name" suffix if we are looking at one
                // or vice-versa, just to be safe with legacy data
                if (field.endsWith('Name')) {
                    const baseField = field.replace('Name', '');
                    if (data[baseField] && data[baseField] !== data[field]) {
                        addInvolvement(data[baseField], type);
                    }
                }
            });

            // Music Helpers are stored as a list; each accrues a worship_helper involvement.
            if (Array.isArray(data.musicHelpers)) {
                data.musicHelpers.forEach(h => addInvolvement(h, 'worship_helper'));
            }

            // Handle irregular elements
            if (data.isIrregular && Array.isArray(data.irregularElements)) {
                data.irregularElements.forEach(el => {
                    if (el.type === 'person' && el.value) {
                        let type = el.key.toLowerCase().replace(/\s+/g, '_');
                        // Map common irregular keys to canonical types
                        if (type.includes('prayer')) type = 'prayer';
                        if (type.includes('preacher')) type = 'preacher';
                        if (type.includes('leader')) {
                            if (type.includes('worship') || type.includes('music')) type = 'worship_leader';
                            else if (type.includes('service')) type = 'service_leader';
                        }
                        addInvolvement(el.value, type);
                    }
                });
            }
        },

        async fetchPeople() {
            try {
                const snap = await db.collection('people').get();
                this.people = snap.docs.map(doc => {
                    const data = doc.data();
                    const name = data.name;
                    const pId = doc.id;
                    const analytics = this.roleAnalytics?.[name] || { roles: {} };
                    const topRoles = Object.entries(analytics.roles)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(r => r[0]);

                    const pStats = this.prayerStats?.[pId] || { count: 0, lastDate: null, avgInterval: null };
                    // The cache stands in only where there is no history behind
                    // it — a person whose dates came in from an import. It is
                    // normalized because the old write paths stored '0000-00-00'
                    // for "never", which is truthy and would print as a date.
                    const lastPrayerDate = pStats.lastDate
                        || PastoralPrayerCore.normalizeDate(data.lastPastoralPrayerDate);

                    return {
                        id: pId,
                        name: name,
                        sex: data.sex || null,
                        totalInvolvements: data.totalInvolvements || 0,
                        topRoles: topRoles,
                        tags: data.tags || [],
                        prayerCount: pStats.count,
                        lastPrayerDate: lastPrayerDate,
                        avgInterval: pStats.avgInterval
                    };
                });
            } catch (error) {
                console.error("Error fetching people:", error);
            }
        },

        // Single shared search input across the hymns/people/praise tabs.
        // x-model needs an assignable target, so route reads/writes through
        // this accessor rather than an (unassignable) inline ternary.
        get activeSearch() {
            if (this.activeTab === 'hymns') return this.hymnSearch;
            if (this.activeTab === 'people') return this.peopleSearch;
            return this.pastoralSearch;
        },
        set activeSearch(value) {
            if (this.activeTab === 'hymns') this.hymnSearch = value;
            else if (this.activeTab === 'people') this.peopleSearch = value;
            else this.pastoralSearch = value;
        },

        get filteredPeople() {
            let list = this.people.filter(p => p.totalInvolvements > 0);
            
            // Filter out people with tags marked as hidePeople: true for non-admins
            if (!this.isAdmin) {
                list = list.filter(p => {
                    const personTags = p.tags || [];
                    return !personTags.some(tag => this.tagMetadata[tag]?.hidePeople);
                });
            }

            if (this.peopleSearch) {
                const q = this.peopleSearch.toLowerCase();
                list = list.filter(p => p.name.toLowerCase().includes(q));
            }

            return list.sort((a, b) => {
                let valA, valB;
                if (this.peopleSortKey === 'name') {
                    valA = a.name.toLowerCase();
                    valB = b.name.toLowerCase();
                } else {
                    valA = a.totalInvolvements || 0;
                    valB = b.totalInvolvements || 0;
                }

                if (valA < valB) return this.peopleSortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return this.peopleSortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        },

        sortByPeople(key) {
            if (this.peopleSortKey === key) {
                this.peopleSortOrder = this.peopleSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                this.peopleSortKey = key;
                this.peopleSortOrder = key === 'name' ? 'asc' : 'desc';
            }
        },

        get filteredPraisePeople() {
            return this.getFilteredPraiseList();
        },

        get filteredPraiseMales() {
            return this.getFilteredPraiseList('male');
        },

        get filteredPraiseFemales() {
            return this.getFilteredPraiseList('female');
        },

        getFilteredPraiseList(sexFilter = null) {
            let list = this.people.filter(p => (p.tags || []).includes('Member'));

            if (sexFilter) {
                list = list.filter(p => p.sex === sexFilter);
            }

            if (this.pastoralSearch) {
                const q = this.pastoralSearch.toLowerCase();
                list = list.filter(p => p.name.toLowerCase().includes(q));
            }

            return list.sort((a, b) => {
                let valA, valB;
                if (this.praiseSortKey === 'name') {
                    valA = a.name.toLowerCase();
                    valB = b.name.toLowerCase();
                } else if (this.praiseSortKey === 'count') {
                    valA = a.prayerCount || 0;
                    valB = b.prayerCount || 0;
                } else if (this.praiseSortKey === 'lastPrayed') {
                    valA = a.lastPrayerDate || '0000-00-00';
                    valB = b.lastPrayerDate || '0000-00-00';
                    if (valA === '') valA = '0000-00-00';
                    if (valB === '') valB = '0000-00-00';
                }

                if (valA < valB) return this.praiseSortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return this.praiseSortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        },

        sortByPraise(key) {
            if (this.praiseSortKey === key) {
                this.praiseSortOrder = this.praiseSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                this.praiseSortKey = key;
                this.praiseSortOrder = key === 'name' ? 'asc' : 'desc';
            }
        },

        async selectPerson(person) {
            this.selectedPerson = person;
            this.loadingInvolvement = true;
            this.personInvolvement = [];
            
            try {
                const snap = await db.collection('people').doc(person.id)
                    .collection('involvement')
                    .orderBy('serviceDate', 'desc')
                    .limit(50)
                    .get();
                
                this.personInvolvement = snap.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));

                // Update top roles for this person in the main list
                const roleCounts = {};
                this.personInvolvement.forEach(inv => {
                    roleCounts[inv.type] = (roleCounts[inv.type] || 0) + 1;
                });
                const topRoles = Object.entries(roleCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(entry => entry[0]);
                
                const pIndex = this.people.findIndex(p => p.id === person.id);
                if (pIndex !== -1) {
                    this.people[pIndex].topRoles = topRoles;
                }

            } catch (error) {
                console.error("Error fetching involvement:", error);
            } finally {
                this.loadingInvolvement = false;
            }
        },

        processHymns(data, date, map) {
            const liturgy = data.liturgy || {};
            const fields = ['preparatoryHymn', 'hymn1', 'hymn2', 'hymnMid1', 'hymnMid2', 'hymnEnd1', 'hymnEnd2'];
            
            fields.forEach(f => {
                const h = liturgy[f];
                if (h && h.name) {
                    const key = h.id || h.name.trim().toLowerCase();
                    if (!map[key]) {
                        map[key] = { name: h.name, id: h.id || null, count: 0, dates: [] };
                    }
                    map[key].count++;
                    map[key].dates.unshift(date);
                }
            });
        },

        processBibleReferences(data, date, chapters) {
            const versePickerFields = [
                { key: 'keyVerse', label: 'Key Verse', value: data.keyVerse },
                { key: 'callToWorship', label: 'Call to Worship', value: data.liturgy?.callToWorship },
                { key: 'callToConfession', label: 'Call to Confession', value: data.liturgy?.callToConfession },
                { key: 'assuranceOfPardon', label: 'Assurance of Pardon', value: data.liturgy?.assuranceOfPardon },
                { key: 'scriptureReading', label: 'Scripture Reading', value: data.liturgy?.scriptureReading },
                { key: 'sermon', label: 'Sermon', value: data.liturgy?.sermon },
                { key: 'benediction', label: 'Benediction', value: data.liturgy?.benediction }
            ];

            versePickerFields.forEach(field => {
                if (field.value && this.bibleFilters[field.key]) {
                    const refs = parseBibleReference(field.value, BIBLE_DATA);
                    refs.forEach(ref => {
                        const chapterKey = `${ref.book}-${ref.chapter}`;
                        if (!chapters[chapterKey]) {
                            chapters[chapterKey] = {
                                book: ref.book,
                                chapter: ref.chapter,
                                count: 0,
                                services: [],
                                verseUsage: {} // { 1: count, 2: count }
                            };
                        }
                        chapters[chapterKey].count++;
                        chapters[chapterKey].services.unshift({
                            date,
                            element: field.label,
                            reference: field.value
                        });
                        
                        // Record verse usage
                        if (ref.verses && ref.verses.length > 0) {
                            ref.verses.forEach(v => {
                                chapters[chapterKey].verseUsage[v] = (chapters[chapterKey].verseUsage[v] || 0) + 1;
                            });
                        }
                    });
                }
            });
        },

        generateTimeline() {
            const timeline = [];
            const books = Object.keys(BIBLE_DATA);
            
            books.forEach(book => {
                const chapters = [];
                const chapterCounts = BIBLE_DATA[book];
                for (let i = 1; i <= chapterCounts.length; i++) {
                    const key = `${book}-${i}`;
                    const data = this.bibleStats.chapters[key] || { count: 0 };
                    chapters.push({
                        chapter: i,
                        count: data.count
                    });
                }
                timeline.push({ book, chapters });
            });
            this.bibleStats.timeline = timeline;
        },

        get filteredHymns() {
            let hymns = [...this.hymnStats];
            if (this.hymnSearch) {
                const q = this.hymnSearch.toLowerCase();
                hymns = hymns.filter(h => h.name.toLowerCase().includes(q));
            }

            return hymns.sort((a, b) => {
                let valA, valB;
                if (this.sortKey === 'name') {
                    valA = a.name.toLowerCase();
                    valB = b.name.toLowerCase();
                } else if (this.sortKey === 'status') {
                    valA = a.id ? 1 : 0;
                    valB = b.id ? 1 : 0;
                } else if (this.sortKey === 'count') {
                    valA = a.count;
                    valB = b.count;
                } else if (this.sortKey === 'lastUsed') {
                    valA = a.dates[0] || '';
                    valB = b.dates[0] || '';
                }

                if (valA < valB) return this.sortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return this.sortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        },

        sortBy(key) {
            if (this.sortKey === key) {
                this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortKey = key;
                this.sortOrder = 'desc'; // Default to desc when changing keys for better UX (recency/usage)
            }
        },

        get maxChapterUsage() {
            return Math.max(...Object.values(this.bibleStats.chapters).map(c => c.count), 1);
        },

        getHeatColor(count) {
            if (count === 0) return 'bg-surface-container';
            const intensity = Math.min(Math.ceil((count / this.maxChapterUsage) * 9), 9);
            // Using Tailwind primary color steps (or similar blues)
            const colors = [
                'bg-blue-50', 'bg-blue-100', 'bg-blue-200', 'bg-blue-300', 
                'bg-blue-400', 'bg-blue-500', 'bg-blue-600', 'bg-blue-700', 
                'bg-blue-800', 'bg-blue-900'
            ];
            return colors[intensity];
        },

        selectBook(book) {
            this.selectedBook = book;
            this.selectedChapter = null;
        },

        get drillDownData() {
            if (!this.selectedBook) return null;
            
            const book = this.selectedBook;
            const bookData = BIBLE_DATA[book];
            const chapters = [];
            
            bookData.forEach((verseCount, index) => {
                const chapterNum = index + 1;
                const chapterKey = `${book}-${chapterNum}`;
                const stats = this.bibleStats.chapters[chapterKey] || { count: 0, verseUsage: {} };
                
                const verses = [];
                for (let v = 1; v <= verseCount; v++) {
                    verses.push({
                        verse: v,
                        count: stats.verseUsage[v] || 0
                    });
                }
                
                chapters.push({
                    chapter: chapterNum,
                    count: stats.count,
                    verses: verses
                });
            });
            
            return { book, chapters };
        },

        getVerseHeatColor(count) {
            if (count === 0) return 'bg-surface-container';
            // Verses usually have lower counts than chapters, but we can reuse the same scale logic
            const intensity = Math.min(Math.ceil((count / 3) * 9), 9); // Hardcoded scale for verses for now
            const colors = [
                'bg-blue-50', 'bg-blue-100', 'bg-blue-200', 'bg-blue-300', 
                'bg-blue-400', 'bg-blue-500', 'bg-blue-600', 'bg-blue-700', 
                'bg-blue-800', 'bg-blue-900'
            ];
            return colors[intensity];
        },

        selectChapter(ch) {
            this.selectedChapter = ch;
        },

        get currentCitations() {
            if (!this.selectedBook) return [];
            
            if (this.selectedChapter) {
                const key = `${this.selectedBook}-${this.selectedChapter}`;
                return this.bibleStats.chapters[key]?.services || [];
            }
            
            // Show all services for the book if no chapter selected
            const bookServices = [];
            const chapters = Object.keys(this.bibleStats.chapters).filter(k => k.startsWith(this.selectedBook + '-'));
            chapters.forEach(k => {
                bookServices.push(...(this.bibleStats.chapters[k].services || []));
            });
            // Sort by date descending
            return bookServices.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
        },

        formatDate(dateStr) {
            if (!dateStr) return '';
            const [y, m, d] = dateStr.split('-');
            return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        },

        getDaysSince(dateStr) {
            if (!dateStr || dateStr === '0000-00-00') return Infinity;
            const [y, m, d] = dateStr.split('-').map(Number);
            const last = new Date(y, m - 1, d);
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const diff = now - last;
            // Negative diff means future date
            return Math.floor(diff / (1000 * 60 * 60 * 24));
        }

    };
}
