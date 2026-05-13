import { parseBibleReference } from './analytics-utils.js';

export function analyticsPage() {
    return {
        activeTab: 'hymns', // 'hymns' or 'bible'
        loading: true,
        progress: 0,
        services: [],
        hymnStats: [],
        bibleStats: {
            chapters: {}, // { "Genesis-1": { count: 0, services: [] } }
            books: {},    // { "Genesis": { count: 0 } }
            timeline: []  // Flattened chapters for heat map
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
        drillDownData: null,

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
                const snapshot = await db.collection('services').orderBy(firebase.firestore.FieldPath.documentId(), 'desc').get();
                const total = snapshot.size;
                let processed = 0;
                
                const hymnsMap = {}; // { id_or_name: { name, id, count, dates: [] } }
                const bibleChapters = {};

                snapshot.forEach(doc => {
                    const data = doc.data();
                    const date = doc.id;
                    
                    // 1. Process Hymns
                    this.processHymns(data, date, hymnsMap);
                    
                    // 2. Process Bible References
                    this.processBibleReferences(data, date, bibleChapters);

                    processed++;
                    this.progress = Math.round((processed / total) * 100);
                });

                // Finalize Hymn Stats
                this.hymnStats = Object.values(hymnsMap).sort((a, b) => b.count - a.count);

                // Finalize Bible Stats
                this.bibleStats.chapters = bibleChapters;
                this.generateTimeline();

            } catch (error) {
                console.error("Error fetching analytics data:", error);
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
                        map[key] = {
                            name: h.name,
                            id: h.id || null,
                            count: 0,
                            dates: []
                        };
                    }
                    map[key].count++;
                    map[key].dates.push(date);
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
                                services: []
                            };
                        }
                        chapters[chapterKey].count++;
                        chapters[chapterKey].services.push({
                            date,
                            element: field.label,
                            reference: field.value
                        });
                    });
                }
            });
        },

        generateTimeline() {
            const timeline = [];
            const books = Object.keys(BIBLE_DATA);
            
            books.forEach(book => {
                const chapterCount = BIBLE_DATA[book].length;
                for (let i = 1; i <= chapterCount; i++) {
                    const key = `${book}-${i}`;
                    const data = this.bibleStats.chapters[key] || { count: 0 };
                    timeline.push({
                        key,
                        book,
                        chapter: i,
                        count: data.count
                    });
                }
            });
            this.bibleStats.timeline = timeline;
        },

        get filteredHymns() {
            if (!this.hymnSearch) return this.hymnStats;
            const q = this.hymnSearch.toLowerCase();
            return this.hymnStats.filter(h => h.name.toLowerCase().includes(q));
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
            this.drillDownData = this.bibleStats.timeline.filter(t => t.book === book);
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
            const last = new Date(dateStr);
            const now = new Date();
            const diff = now - last;
            return Math.floor(diff / (1000 * 60 * 60 * 24));
        }
    };
}
