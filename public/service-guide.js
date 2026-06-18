// Identifier 'db' is already declared in auth.js

function guideEditor() {
    return {
        date: '',
        service: {
            theme: '',
            keyVerse: '',
            liturgy: {},
            irregularElements: [],
            isIrregular: false
        },
        elements: [],
        previousAnnouncements: [],
        previousAnnouncementsDate: '',
        hymnDetails: {},
        keyVerseText: '',
        schedule: [],
        loading: true,
        userRole: 'viewer',
        hasChanges: false,
        selectedElement: null,
        zoomLevel: 1.0,

        async init() {
            const self = this;
            // Wait for auth to settle
            auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    window.location.href = 'login.html';
                    return;
                }
                const userData = await getUserData(user.uid);
                if (!userData) {
                    window.location.href = 'service-calendar.html';
                    return;
                }
                
                self.userRole = userData.role || 'viewer';

                const urlParams = new URLSearchParams(window.location.search);
                self.date = urlParams.get('date');
                if (!self.date) {
                    window.location.href = 'service-calendar.html';
                    return;
                }

                await self.loadService();
                await self.fetchHymnDetails();
                await self.fetchSchedule();
                await self.fetchPreviousAnnouncements();
                
                // Construct initial elements if not already saved
                if (self.elements.length === 0) {
                    self.generateDefaultElements();
                } else {
                    self.fixBrokenElements();
                }

                if (self.userRole === 'admin' || self.userRole === 'editor') {
                    self.initSortable();
                }
                self.loading = false;

                // Only watch for changes if user has permission
                if (self.userRole === 'admin' || self.userRole === 'editor') {
                    // Watch for changes after initial load
                    self.$watch('elements', (val) => {
                        if (!self.loading) {
                            self.hasChanges = true;
                        }
                    }, { deep: true });
                    
                    self.$watch('selectedElement', (newVal, oldVal) => {
                        if (!self.loading && newVal && oldVal && newVal.id === oldVal.id) {
                            self.hasChanges = true;
                        }
                    }, { deep: true });
                }
            });
        },

        fixBrokenElements() {
            const liturgy = this.service.liturgy || {};
            const hasBaptism = this.service.hasBaptism;
            const removedHymns = Array.isArray(this.service.removedHymns) ? this.service.removedHymns : [];
            const shouldHaveHymn2 = !hasBaptism && liturgy.hymn2?.name && !removedHymns.includes('hymn2');
            const hasHymn2 = this.elements.some(el => el.id.startsWith('hymn-h2'));
            const missingHymn2 = shouldHaveHymn2 && !hasHymn2;

            // hymnMid1 is independent of baptism; only a manual removal pulls it.
            const shouldHaveHymnMid1 = liturgy.hymnMid1?.name && !removedHymns.includes('hymnMid1');
            const hasHymnMid1 = this.elements.some(el => el.id.startsWith('hymn-m1'));
            const missingHymnMid1 = shouldHaveHymnMid1 && !hasHymnMid1;

            if (!missingHymn2 && !missingHymnMid1) return;

            // Saved guide is missing a hymn page that the order of service calls for —
            // regenerate from scratch,
            // preserving any content already filled in for prayer, kids, and announcements.
            const savedPrayer = JSON.parse(JSON.stringify(
                this.elements.find(el => el.type === 'pastoral_prayer') || null
            ));
            const savedKids = JSON.parse(JSON.stringify(
                this.elements.find(el => el.type === 'kids_section') || null
            ));
            const savedAnnouncements = JSON.parse(JSON.stringify(
                this.elements.find(el => el.type === 'announcements') || null
            ));

            this.generateDefaultElements();

            if (savedPrayer) {
                const el = this.elements.find(e => e.type === 'pastoral_prayer');
                if (el) Object.assign(el, savedPrayer);
            }
            if (savedKids) {
                const el = this.elements.find(e => e.type === 'kids_section');
                if (el) Object.assign(el, savedKids);
            }
            if (savedAnnouncements) {
                const el = this.elements.find(e => e.type === 'announcements');
                if (el) Object.assign(el, savedAnnouncements);
            }

            this.hasChanges = true;
        },

        // Rebuild the guide from the current order of service so hymn changes made in
        // the builder (added, swapped, or removed hymns) take effect. Hand-entered
        // content — pastoral prayer, Mosaic Kids, announcements, and custom pages — is
        // preserved; only the auto-generated structure (hymn pages, sermon notes) is
        // recreated.
        regenerateGuide() {
            if (!confirm('Rebuild the guide from the current order of service? Hymn pages will be recreated to match the builder, including any hymns you removed. Your pastoral prayer, Mosaic Kids, announcements, and custom pages are kept.')) return;

            const clone = (el) => el ? JSON.parse(JSON.stringify(el)) : null;
            const savedPrayer = clone(this.elements.find(el => el.type === 'pastoral_prayer'));
            const savedKids = clone(this.elements.find(el => el.type === 'kids_section'));
            const savedAnnouncements = clone(this.elements.find(el => el.type === 'announcements'));
            const savedCustom = this.elements.filter(el => el.type === 'custom_page').map(clone);

            this.selectedElement = null;
            this.generateDefaultElements();

            if (savedPrayer) {
                const el = this.elements.find(e => e.type === 'pastoral_prayer');
                if (el) Object.assign(el, savedPrayer);
            }
            if (savedKids) {
                const el = this.elements.find(e => e.type === 'kids_section');
                if (el) Object.assign(el, savedKids);
            }
            if (savedAnnouncements) {
                const el = this.elements.find(e => e.type === 'announcements');
                if (el) Object.assign(el, savedAnnouncements);
            }
            // Re-append custom pages, then re-pad sermon notes so the booklet still totals 16.
            savedCustom.forEach(c => this.elements.push(c));
            this.recalculateSermonNotes();

            this.hasChanges = true;
        },

        generateDefaultElements() {
            const base = [
                { id: 'title', label: 'Title Page', type: 'title_page', enabled: true },
                { id: 'oos', label: 'Order of Service', type: 'order_of_service', enabled: true },
            ];

            const liturgy = this.service.liturgy || {};
            const removedHymns = Array.isArray(this.service.removedHymns) ? this.service.removedHymns : [];

            const addHymnPages = (hymnRef, idPrefix, fieldKey) => {
                // A hymn the user pulled out of the order of service contributes no pages;
                // recalculateSermonNotes() fills the freed slots with sermon-notes pages.
                if (fieldKey && removedHymns.includes(fieldKey)) return;
                if (!hymnRef || !hymnRef.name) return;

                // If it's a literal hymn (no ID), add 1 page
                if (!hymnRef.id) {
                    base.push({
                        id: `${idPrefix}-literal`,
                        label: `Hymn: ${hymnRef.name}`,
                        type: 'hymn_pages',
                        enabled: true,
                        hymnId: null,
                        hymnName: hymnRef.name,
                        pageIndex: 0,
                        totalPages: 1
                    });
                    return;
                }

                const details = this.hymnDetails[hymnRef.id];
                const pages = details?.versions?.[0]?.pages || [];
                const pageCount = Math.max(1, pages.length);

                for (let i = 0; i < pageCount; i++) {
                    base.push({
                        id: `${idPrefix}-p${i}`,
                        label: `Hymn: ${hymnRef.name} (p${i+1})`,
                        type: 'hymn_pages',
                        enabled: true,
                        hymnId: hymnRef.id,
                        hymnName: hymnRef.name,
                        pageIndex: i,
                        totalPages: pageCount
                    });
                }
            };

            // Sequential Flow: Title -> OOS -> Preparatory -> Hymn 1 -> [Hymn 2 + Mid 1 if no baptism] -> Mid 2 -> Pastoral Prayer
            addHymnPages(liturgy.preparatoryHymn, 'hymn-prep', 'preparatoryHymn');
            addHymnPages(liturgy.hymn1, 'hymn-h1', 'hymn1');
            if (!this.service.hasBaptism) {
                addHymnPages(liturgy.hymn2, 'hymn-h2', 'hymn2');
            }
            addHymnPages(liturgy.hymnMid1, 'hymn-m1', 'hymnMid1');
            addHymnPages(liturgy.hymnMid2, 'hymn-m2', 'hymnMid2');

            // Pastoral Prayer (Pre-initialized with demographic fields)
            base.push({ 
                id: 'prayer', 
                label: 'Pastoral Prayer', 
                type: 'pastoral_prayer', 
                enabled: true,
                nation: '', continent: '', capital: '', population: '', 
                language: '', totalLanguages: '', literacy: '', 
                christianPct: '', evangelicalPct: '', unevangelizedPct: '',
                prompts: [],
                countryImage: null
            });

            // Response Hymns (End 1/2) - Recalculate will put these after notes
            addHymnPages(liturgy.hymnEnd1, 'hymn-e1', 'hymnEnd1');
            addHymnPages(liturgy.hymnEnd2, 'hymn-e2', 'hymnEnd2');

            // Mosaic Kids (Pre-initialized)
            base.push({ 
                id: 'kids', 
                label: 'Mosaic Kids', 
                type: 'kids_section', 
                enabled: true,
                lessonTitle: '', lessonVerse: '', summary: [], questions: []
            });

            // Announcements (Pre-initialized as array)
            base.push({ 
                id: 'announcements', 
                label: 'Announcements', 
                type: 'announcements', 
                enabled: true,
                items: [{ title: '', content: '' }]
            });

            this.elements = base;
            this.recalculateSermonNotes();
        },

        recalculateSermonNotes() {
            this.elements = this.elements.filter(el => el.type !== 'sermon_notes');
            let currentPageCount = this.elements.filter(el => el.enabled).length;
            
            // We need at least one sermon notes page, but we also want to pad to 16
            const notesNeeded = Math.max(1, 16 - currentPageCount);
            
            let insertIndex = this.elements.findIndex(el => el.id.startsWith('hymn-e1'));
            if (insertIndex === -1) insertIndex = this.elements.findIndex(el => el.id === 'kids');
            if (insertIndex === -1) insertIndex = this.elements.length - 1;

            for (let i = 0; i < notesNeeded; i++) {
                this.elements.splice(insertIndex + i, 0, {
                    id: `notes-${i}`,
                    label: `Sermon Notes (Page ${i+1})`,
                    type: 'sermon_notes',
                    enabled: true
                });
            }
        },

        get isOverflowing() {
            return this.visibleElements.length > 16;
        },

        get bookletSpreads() {
            const pages = this.visibleElements;
            if (pages.length !== 16) return []; 

            // Booklet imposition (sum to 17 rule)
            // Left | Right
            return [
                { left: pages[15], leftIdx: 15, right: pages[0],  rightIdx: 0  }, // Spread 1: 16 | 1
                { left: pages[1],  leftIdx: 1,  right: pages[14], rightIdx: 14 }, // Spread 2: 2  | 15
                { left: pages[13], leftIdx: 13, right: pages[2],  rightIdx: 2  }, // Spread 3: 14 | 3
                { left: pages[3],  leftIdx: 3,  right: pages[12], rightIdx: 12 }, // Spread 4: 4  | 13
                { left: pages[11], leftIdx: 11, right: pages[4],  rightIdx: 4  }, // Spread 5: 12 | 5
                { left: pages[5],  leftIdx: 5,  right: pages[10], rightIdx: 10 }, // Spread 6: 6  | 11
                { left: pages[9],  leftIdx: 9,  right: pages[6],  rightIdx: 6  }, // Spread 7: 10 | 7
                { left: pages[7],  leftIdx: 7,  right: pages[8],  rightIdx: 8  }  // Spread 8: 8  | 9
            ];
        },

        async loadService() {
            const doc = await db.collection('services').doc(this.date).get();
            if (doc.exists) {
                const data = this.normalizeServiceData(doc.data());
                this.service = data;
                if (data.guide && data.guide.elements) {
                    this.elements = data.guide.elements;
                }
                if (this.service.keyVerse) {
                    this.getESVPlainText(this.service.keyVerse).then(text => {
                        this.keyVerseText = text;
                    });
                }
            }
        },

        normalizeServiceData(raw) {
            const data = {};
            // First pass: non-dotted keys
            for (const [key, val] of Object.entries(raw)) {
                if (!key.includes('.')) data[key] = val;
            }
            // Second pass: dotted keys (e.g. 'liturgy.sermon')
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
            return data;
        },

        async fetchHymnDetails() {
            const hymns = this.getHymns();
            const details = {};
            for (const h of hymns) {
                if (h.id && !this.hymnDetails[h.id]) {
                    const doc = await db.collection('hymns').doc(h.id).get();
                    if (doc.exists) details[h.id] = doc.data();
                }
            }
            this.hymnDetails = { ...this.hymnDetails, ...details };
        },

        async fetchPreviousAnnouncements() {
            // Find the most recent service BEFORE this.date that has filled-in
            // announcements, and surface its items as reusable suggestions.
            try {
                // Bounded range query (no orderBy => no composite index needed),
                // then sort newest-first client-side.
                const startDate = new Date(this.date + 'T00:00:00');
                startDate.setDate(startDate.getDate() - 120);
                const startStr = startDate.toISOString().split('T')[0];
                const snap = await db.collection('services')
                    .where(firebase.firestore.FieldPath.documentId(), '>=', startStr)
                    .where(firebase.firestore.FieldPath.documentId(), '<', this.date)
                    .get();
                const docs = snap.docs.sort((a, b) => b.id.localeCompare(a.id));
                for (const doc of docs) {
                    const data = this.normalizeServiceData(doc.data());
                    const ann = data.guide && data.guide.elements
                        ? data.guide.elements.find(el => el.type === 'announcements')
                        : null;
                    const items = (ann && ann.items || []).filter(it => it && (it.title || it.content));
                    if (items.length > 0) {
                        this.previousAnnouncements = JSON.parse(JSON.stringify(items));
                        this.previousAnnouncementsDate = doc.id;
                        return;
                    }
                }
            } catch (error) { console.error("Error fetching previous announcements:", error); }
        },

        addSuggestedAnnouncement(item) {
            const el = this.elements.find(e => e.type === 'announcements');
            if (!el) return;
            if (!Array.isArray(el.items)) el.items = [];
            // Avoid adding an exact duplicate that's already present.
            const exists = el.items.some(it => it.title === item.title && it.content === item.content);
            if (exists) return;
            // If the only existing announcement is a blank placeholder, fill it.
            if (el.items.length === 1 && !el.items[0].title && !el.items[0].content) {
                el.items[0].title = item.title || '';
                el.items[0].content = item.content || '';
            } else {
                el.items.push({ title: item.title || '', content: item.content || '' });
            }
        },

        async fetchSchedule() {
            const startDate = new Date(this.date);
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 35);
            const startStr = this.date;
            const endStr = endDate.toISOString().split('T')[0];
            try {
                const snap = await db.collection('services')
                    .where(firebase.firestore.FieldPath.documentId(), '>=', startStr)
                    .where(firebase.firestore.FieldPath.documentId(), '<=', endStr)
                    .get();
                const services = [];
                snap.forEach(doc => { 
                    services.push({ id: doc.id, ...this.normalizeServiceData(doc.data()) }); 
                });
                this.schedule = services.sort((a, b) => a.id.localeCompare(b.id));
            } catch (error) { console.error("Error fetching schedule:", error); }
        },

        async getESVPlainText(reference) {
            const API_KEY = '3ca8c306dfdefdc42598bb88a037361a0f44cb0b';
            const url = `https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(reference)}&include-passage-references=false&include-verse-numbers=false&include-first-verse-numbers=false&include-footnotes=false&include-headings=false&include-short-copyright=false`;
            try {
                const response = await fetch(url, { headers: { 'Authorization': `Token ${API_KEY}` } });
                const data = await response.json();
                return (data.passages[0] || '').trim();
            } catch (error) { return ""; }
        },

        initSortable() {
            const el = document.getElementById('toc-list');
            if (!el) return;
            Sortable.create(el, {
                animation: 150, handle: '.drag-handle', ghostClass: 'ghost',
                onEnd: (evt) => {
                    const item = this.elements.splice(evt.oldIndex, 1)[0];
                    this.elements.splice(evt.newIndex, 0, item);
                }
            });
        },

        getHymns() {
            if (!this.service.liturgy) return [];
            let fields = ['preparatoryHymn', 'hymn1', 'hymn2', 'hymnMid1', 'hymnMid2', 'hymnEnd1', 'hymnEnd2'];
            const removedHymns = Array.isArray(this.service.removedHymns) ? this.service.removedHymns : [];
            return fields.filter(f => !removedHymns.includes(f)).map(f => this.service.liturgy[f]).filter(h => h && h.name);
        },

        addCustomPage() {
            const id = 'custom-' + Date.now();
            const newEl = { id, label: 'Custom Page', type: 'custom_page', enabled: true, content: '<h1>New Custom Page</h1>' };
            this.elements.push(newEl);
            this.selectedElement = newEl;
        },

        deleteElement(id) {
            if (confirm('Are you sure you want to remove this element?')) {
                this.elements = this.elements.filter(el => el.id !== id);
                if (this.selectedElement && this.selectedElement.id === id) this.selectedElement = null;
            }
        },

        selectElement(el) {
            this.selectedElement = el;
            const pageEl = document.getElementById('preview-' + el.id);
            if (pageEl) pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },

        async save() {
            try {
                await db.collection('services').doc(this.date).update({
                    guide: {
                        elements: JSON.parse(JSON.stringify(this.elements)),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }
                });
                this.hasChanges = false;
            } catch (error) { console.error("Error saving guide config:", error); }
        },

        // Build the print booklet by cloning the live-preview pages into
        // imposition order, so the PDF is identical to what's on screen.
        // (Previously the print layer had its own hand-duplicated templates
        // that drifted out of sync with the preview.)
        printGuide() {
            const layer = document.getElementById('booklet-print-layer');
            const spreads = this.bookletSpreads;

            if (!layer || spreads.length === 0) {
                alert(`The print booklet needs exactly 16 pages — the guide currently has ${this.visibleElements.length}. Adjust your elements so it totals 16 pages, then print again.`);
                return;
            }

            const clonePage = (el) => {
                if (el) {
                    const src = document.getElementById('preview-' + el.id);
                    if (src) {
                        const clone = src.cloneNode(true);
                        clone.removeAttribute('id');
                        return clone;
                    }
                }
                const blank = document.createElement('div');
                blank.className = 'preview-page';
                return blank;
            };

            layer.innerHTML = '';
            for (const spread of spreads) {
                const container = document.createElement('div');
                container.className = 'spread-container';
                // Stop Alpine's mutation observer from re-initialising the
                // clones (which would re-run their x-for/x-if and duplicate
                // content). x-ignore on the appended node is the reliable
                // guard; an ancestor's x-ignore does not cover mutation-added
                // nodes because Alpine walks from the added node itself.
                container.setAttribute('x-ignore', '');
                container.appendChild(clonePage(spread.left));
                container.appendChild(clonePage(spread.right));
                layer.appendChild(container);
            }

            const cleanup = () => {
                layer.innerHTML = '';
                window.removeEventListener('afterprint', cleanup);
            };
            window.addEventListener('afterprint', cleanup);

            // Let cloned images settle (they're already cached from the
            // preview) before opening the print dialog.
            setTimeout(() => window.print(), 150);
        },

        getHymnImages(hymnId) {
            if (!hymnId) return [];
            const details = this.hymnDetails[hymnId];
            if (!details || !details.versions || details.versions.length === 0) return [];
            return details.versions[0].pages || [];
        },

        getShortDate(dateStr) {
            const [y, m, d] = dateStr.split('-');
            return `${m}/${d}/${y.slice(-2)}`;
        },

        formatDate(dateStr) {
            if (!dateStr) return '';
            const [y, m, d] = dateStr.split('-');
            return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        },

        // The Baptism Candidates rendered as a display string. Handles the
        // person-ref array and any legacy free-text value still in the data.
        baptismNames() {
            const bap = this.service?.liturgy?.baptism;
            if (Array.isArray(bap)) return bap.map(c => c && c.name).filter(Boolean).join(', ');
            return typeof bap === 'string' ? bap : '';
        },

        // Shrink the candidate names rather than wrapping to a second line as
        // the count grows, so the Baptism row stays on a single line.
        baptismNamesClass() {
            const bap = this.service?.liturgy?.baptism;
            const count = Array.isArray(bap)
                ? bap.filter(c => c && c.name).length
                : (typeof bap === 'string' && bap.trim() ? bap.split(',').length : 0);
            if (count >= 4) return 'text-xs';
            if (count === 3) return 'text-sm';
            return '';
        },

        formatLongDate(dateStr) {
            if (!dateStr) return '';
            const [y, m, d] = dateStr.split('-');
            return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        },

        handleImageUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                if (this.selectedElement && this.selectedElement.type === 'pastoral_prayer') {
                    this.selectedElement.countryImage = e.target.result;
                }
            };
            reader.readAsDataURL(file);
        },

        autoResize(el) {
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
        },

        async handleDocxImport(event) {
            const file = event.target.files[0];
            if (!file || !this.selectedElement) return;

            try {
                const arrayBuffer = await file.arrayBuffer();
                // We use mammoth to convert docx to clean HTML
                // We'll use a style map to ensure it matches our serif/latex look
                const options = {
                    styleMap: [
                        "p => p:fresh",
                        "h1 => h1:fresh",
                        "h2 => h2:fresh",
                        "h3 => h3:fresh",
                        "bold => b",
                        "italic => i"
                    ]
                };
                
                const result = await mammoth.convertToHtml({ arrayBuffer }, options);
                this.selectedElement.content = result.value;
                
                // If there are warnings, log them for debugging
                if (result.messages.length > 0) {
                    console.warn("Mammoth conversion warnings:", result.messages);
                }
            } catch (error) {
                console.error("Error importing .docx:", error);
                alert("Failed to import Word document. Please ensure it is a valid .docx file.");
            } finally {
                event.target.value = ''; // Reset input
            }
        },

        downloadWordTemplate() {
            // Trigger download of the template file we just moved to assets
            const link = document.createElement('a');
            link.href = 'assets/templates/CustomPageTemplate.docx';
            link.download = 'Custom Page Template.docx';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },

        // --- TASK LOGIC ---
        get visibleElements() {
            return this.elements.filter(el => el.enabled);
        },

        get tasks() {
            return {
                prayer: this.elements.find(el => el.type === 'pastoral_prayer'),
                kids: this.elements.find(el => el.type === 'kids_section'),
                announcements: this.elements.find(el => el.type === 'announcements')
            };
        },

        get tasksRemaining() {
            let count = 0;
            const { prayer, kids, announcements } = this.tasks;
            if (prayer && (!prayer.nation || !prayer.capital)) count++;
            if (kids && (!kids.lessonTitle || !kids.lessonVerse)) count++;
            if (announcements && (!announcements.items || announcements.items.length === 0 || !announcements.items[0].title)) count++;
            return count;
        },

        goToNextTask() {
            const { prayer, kids, announcements } = this.tasks;
            if (prayer && (!prayer.nation || !prayer.capital)) { this.selectElement(prayer); return; }
            if (kids && (!kids.lessonTitle || !kids.lessonVerse)) { this.selectElement(kids); return; }
            if (announcements && (!announcements.items || announcements.items.length === 0 || !announcements.items[0].title)) { this.selectElement(announcements); return; }
            this.selectElement(prayer || kids || announcements);
        }
    };
}
