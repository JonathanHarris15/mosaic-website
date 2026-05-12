function serviceForm() {
    return {
        date: '',
        saving: false,
        canEdit: false,
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
        hymnRegistry: [],
        fuse: null,
        service: {
            theme: '',
            keyVerse: '',
            serviceLeader: { name: '', id: null },
            musicLeader: { name: '', id: null },
            preacher: { name: '', id: null },
            sermonette: { name: '', id: null },
            prayerPraise: { name: '', id: null },
            prayerConfession: { name: '', id: null },
            elements: { name: '', id: null },
            other: { name: '', id: null },
            hasBaptism: false,
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
                sermon: '',
                baptism: '',
                hymnEnd1: { id: null, name: '' },
                hymnEnd2: { id: null, name: '' },
                benediction: ''
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
                        this.canEdit = (role === 'editor' || role === 'admin');
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
            await this.loadHymnRegistry();
            await this.autoLinkHymns();

            if (urlParams.get('validate') === 'true') {
                this.validateForm();
            }

            window.addEventListener('beforeunload', (e) => {
                if (this.canEdit && this.isDirty) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });
        },

        async loadHymnRegistry() {
            try {
                const getHymnIndex = firebase.app().functions('us-central1').httpsCallable('getHymnIndex');
                const result = await getHymnIndex();
                this.hymnRegistry = result.data;
                
                // Initialize Fuse.js for fuzzy searching
                this.fuse = new Fuse(this.hymnRegistry, {
                    keys: ['hymn_name', 'lyrics_writer', 'music_writer'],
                    threshold: 0.3, // Lower is stricter, higher is fuzzier
                    distance: 100,
                    minMatchCharLength: 2,
                    includeScore: true
                });
            } catch (error) {
                console.error("Error loading hymn registry:", error);
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
                const data = doc.data();
                // Update top-level properties
                this.service.theme = data.theme || '';
                this.service.keyVerse = data.keyVerse || '';
                
                this.service.serviceLeader.name = data.serviceLeader || '';
                this.service.serviceLeader.id = data.serviceLeaderId || null;
                this.service.musicLeader.name = data.musicLeader || '';
                this.service.musicLeader.id = data.musicLeaderId || null;
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
            }
            this.originalService = JSON.stringify(this.service);
        },

        async validateForm() {
            this.$nextTick(() => {
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

                for (const { field, role, metadata } of roles) {
                    const oldId = original[field].id;
                    const newId = this.service[field].id;

                    if (oldId !== newId) {
                        // 1. Handle removal of old involvement
                        if (oldId) {
                            const oldPersonRef = db.collection('people').doc(oldId);
                            // Find and delete the involvement record for this date and role
                            let query = oldPersonRef.collection('involvement')
                                .where('serviceDate', '==', this.date)
                                .where('type', '==', role);
                            
                            if (metadata && metadata.prayer_type) {
                                query = query.where('metadata.prayer_type', '==', metadata.prayer_type);
                            }

                            const invSnap = await query.get();
                            
                            invSnap.forEach(doc => {
                                batch.delete(doc.ref);
                            });

                            if (!invSnap.empty) {
                                batch.update(oldPersonRef, {
                                    totalInvolvements: firebase.firestore.FieldValue.increment(-invSnap.size)
                                });
                            }
                        }

                        // 2. Handle addition of new involvement
                        if (newId) {
                            const newPersonRef = db.collection('people').doc(newId);
                            const newInvRef = newPersonRef.collection('involvement').doc();
                            
                            const invData = {
                                serviceDate: this.date,
                                type: role,
                                createdAt: firebase.firestore.FieldValue.serverTimestamp()
                            };

                            if (metadata) {
                                invData.metadata = metadata;
                            }
                            
                            batch.set(newInvRef, invData);

                            batch.update(newPersonRef, {
                                totalInvolvements: firebase.firestore.FieldValue.increment(1)
                            });
                        }
                    }
                }

                // Flatten service object for Firestore storage
                const toSave = {
                    theme: this.service.theme,
                    keyVerse: this.service.keyVerse,
                    serviceLeader: this.service.serviceLeader.name,
                    serviceLeaderId: this.service.serviceLeader.id,
                    musicLeader: this.service.musicLeader.name,
                    musicLeaderId: this.service.musicLeader.id,
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
                    notes: this.service.notes,
                    liturgy: this.service.liturgy,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                const serviceRef = db.collection('services').doc(this.date);
                batch.set(serviceRef, toSave);

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
            const mainEl = document.querySelector('main');
            const mainRect = mainEl ? mainEl.getBoundingClientRect() : { right: window.innerWidth - 16 };
            // Anchor to the right of the form-section card, fill to viewport right edge
            const editorLeft  = rect.right + 28;
            const editorRight = window.innerWidth - 40; // 40px clears the scrollbar
            this.noteEditorLeft  = Math.round(editorLeft);
            this.noteEditorWidth = Math.max(160, Math.round(editorRight - editorLeft));
            this.noteEditorTop   = Math.max(70, Math.round(rect.top));
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

        // ── Utility ────────────────────────────────────────────────────────────
        clearService() {
            if (!confirm('Are you sure you want to clear the current service? This will reset all liturgy fields.')) return;
            this.service.theme = '';
            this.service.keyVerse = '';
            this.service.serviceLeader = { name: '', id: null };
            this.service.musicLeader = { name: '', id: null };
            this.service.preacher = { name: '', id: null };
            this.service.sermonette = { name: '', id: null };
            this.service.prayerPraise = { name: '', id: null };
            this.service.prayerConfession = { name: '', id: null };
            this.service.elements = { name: '', id: null };
            this.service.other = { name: '', id: null };
            this.service.hasBaptism = false;
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
                sermon: '',
                baptism: '',
                hymnEnd1: { id: null, name: '' },
                hymnEnd2: { id: null, name: '' },
                benediction: ''
            };
        },

        formatDate(dateStr) {
            if (!dateStr) return '';
            const [y, m, d] = dateStr.split('-');
            return new Date(y, m - 1, d).toLocaleDateString(undefined, {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
        },

        async downloadMusicSheets() {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF();
            
            const hymnFields = [
                'preparatoryHymn', 'hymn1', 'hymn2', 'hymnMid1', 'hymnMid2', 'hymnEnd1', 'hymnEnd2'
            ];
            
            const hymnIds = hymnFields
                .map(field => this.service.liturgy[field]?.id)
                .filter(id => !!id);

            if (hymnIds.length === 0) {
                alert('No hymns selected in the Order of Service.');
                return;
            }

            let pagesAdded = 0;
            const originalText = 'Download Music Sheets';
            
            try {
                // Find the button to show status
                const btn = document.getElementById('download-music-btn');
                if (btn) btn.innerText = 'Generating PDF...';

                for (const id of hymnIds) {
                    const doc = await db.collection('hymns').doc(id).get();
                    if (!doc.exists) continue;
                    
                    const hymn = doc.data();
                    // Always use the first arrangement (version)
                    const version = hymn.versions && hymn.versions.length > 0 ? hymn.versions[0] : null;
                    if (!version || !version.pages || version.pages.length === 0) continue;

                    for (const pageUrl of version.pages) {
                        try {
                            const imgData = await this._getImageDataUrl(pageUrl);
                            if (!imgData) continue;

                            // Detect format from data URL (e.g., "data:image/png;base64,...")
                            let format = 'PNG';
                            if (imgData.includes('image/jpeg') || imgData.includes('image/jpg')) {
                                format = 'JPEG';
                            } else if (imgData.includes('image/webp')) {
                                format = 'WEBP';
                            }

                            if (pagesAdded > 0) {
                                pdf.addPage();
                            }
                            
                            const pageWidth = pdf.internal.pageSize.getWidth();
                            const pageHeight = pdf.internal.pageSize.getHeight();
                            
                            // Layout constants (in mm)
                            const margin = 10;
                            const titleFontSize = 14;
                            const titlePadding = 8;
                            
                            // Draw Title
                            pdf.setFont("helvetica", "bold");
                            pdf.setFontSize(titleFontSize);
                            pdf.text(hymn.hymn_name || 'Hymn', pageWidth / 2, margin + 5, { align: 'center' });

                            // Get image dimensions safely
                            const img = new Image();
                            await new Promise((resolve, reject) => {
                                img.onload = resolve;
                                img.onerror = () => reject(new Error('Failed to load image: ' + pageUrl));
                                img.src = imgData;
                            });

                            const imgWidth = img.width;
                            const imgHeight = img.height;

                            // Available space for the image
                            const maxWidth = pageWidth - (margin * 2);
                            const maxHeight = pageHeight - (margin * 2) - titleFontSize - titlePadding;

                            // Calculate scaling ratio to fit BOTH dimensions (prevents clipping)
                            const ratio = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
                            const dw = imgWidth * ratio;
                            const dh = imgHeight * ratio;

                            // Center the image in the available space
                            const dx = (pageWidth - dw) / 2;
                            // Start image below the title area
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
                alert('Failed to generate PDF. check console for details.');
            } finally {
                const btn = document.getElementById('download-music-btn');
                if (btn) {
                    btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">picture_as_pdf</span> Download Music Sheets';
                }
            }
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
        }
    };
}

function personPicker(personRef) {
    return {
        personRef: personRef,
        open: false,
        query: personRef.name || '',
        results: [],
        
        init() {
            // Keep local query in sync with incoming name
            this.$watch('personRef.name', (val) => {
                this.query = val || '';
            });
        },

        async search() {
            if (this.query.length < 2) {
                this.results = [];
                return;
            }

            try {
                // Search Firestore people collection
                const snap = await db.collection('people')
                    .where('name', '>=', this.query)
                    .where('name', '<=', this.query + '\uf8ff')
                    .limit(5).get();
                
                let found = snap.docs.map(d => ({ id: d.id, ...d.data() }));

                // Add virtual "Add New" result if exact match not found
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
                return;
            }
            this.personRef.id = p.id;
            this.personRef.name = p.name;
            this.query = p.name;
            this.results = [];
            this.open = false;
        },

        clear() {
            this.personRef.id = null;
            this.personRef.name = '';
            this.query = '';
            this.results = [];
            this.open = false;
        },

        onInput() {
            // Clear ID if they are typing, but don't update name yet to enforce selection/creation
            this.personRef.id = null; 
            this.search();
        }
    };
}

function hymnPicker(hymnRef) {
    return {
        hymnRef: hymnRef,
        open: false,
        query: hymnRef.name || '',
        results: [],
        
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
        async search() {
            if (this.query.length < 2) {
                this.results = [];
                return;
            }

            // Use Fuse.js if available (pre-loaded registry)
            if (this.$parent && this.$parent.fuse) {
                this.results = this.$parent.fuse.search(this.query).slice(0, 5).map(r => r.item);        
                return;
            }

            // Fallback to Firestore live search if registry hasn't loaded yet
            const snap = await db.collection('hymns')
                .where('hymn_name', '>=', this.query)
                .where('hymn_name', '<=', this.query + '\uf8ff')
                .limit(5).get();
            this.results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        },
        select(h) {
            this.hymnRef.id = h.id;
            this.hymnRef.name = h.hymn_name;
            this.query = h.hymn_name;
            this.results = [];
            this.open = false;
        },
        clear() {
            this.hymnRef.id = null;
            this.hymnRef.name = '';
            this.query = '';
            this.results = [];
            this.open = false;
        }
    };
}
