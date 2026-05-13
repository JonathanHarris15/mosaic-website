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
        selectedPerson: null,
        personInvolvement: [],
        loadingInvolvement: false,
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
        drillDownData: null, // Will hold the book object with chapters and verses usage
        sortKey: 'count', // 'name', 'status', 'count', 'lastUsed'
        sortOrder: 'desc', // 'asc', 'desc'

        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    window.location.href = 'login.html';
                    return;
                }
                await this.fetchAndProcessData();
                this.loading = false;
            });
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
                    this.progress = Math.round((processed / total) * 100);
                });

                this.hymnStats = Object.values(hymnsMap).sort((a, b) => b.count - a.count);
                this.bibleStats.chapters = bibleChapters;
                this.roleAnalytics = peopleMap;
                this.generateTimeline();
                
                // Fetch people after aggregation is ready
                await this.fetchPeople();

            } catch (error) {
                console.error("Error fetching analytics data:", error);
            }
        },

        processServicePeople(data, map) {
            const roleFields = {
                serviceLeader: 'Service Leader',
                preacher: 'Preacher',
                musicLeader: 'Worship Leader',
                sermonette: 'Sermonette'
            };

            Object.entries(roleFields).forEach(([field, label]) => {
                const name = data[field];
                if (name && typeof name === 'string') {
                    const normalized = name.trim();
                    if (!map[normalized]) map[normalized] = { roles: {} };
                    map[normalized].roles[label] = (map[normalized].roles[label] || 0) + 1;
                }
            });
        },

        async fetchPeople() {
            try {
                const snap = await db.collection('people').get();
                this.people = snap.docs.map(doc => {
                    const data = doc.data();
                    const name = data.name;
                    const analytics = this.roleAnalytics?.[name] || { roles: {} };
                    const topRoles = Object.entries(analytics.roles)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(r => r[0]);

                    return {
                        id: doc.id,
                        name: name,
                        totalInvolvements: data.totalInvolvements || 0,
                        topRoles: topRoles
                    };
                });
            } catch (error) {
                console.error("Error fetching people:", error);
            }
        },

        get filteredPeople() {
            let list = [...this.people];
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
                    const refs = parseBibleReference(field.value);
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
            if (!dateStr) return 0;
            const [y, m, d] = dateStr.split('-').map(Number);
            const last = new Date(y, m - 1, d);
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const diff = now - last;
            return Math.floor(diff / (1000 * 60 * 60 * 24));
        }
    };
}
