function serviceForm() {
    return {
        date: '',
        saving: false,
        canEdit: false,
        user: null,
        originalService: '',
        activeNoteKey: null,
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
            serviceLeader: '',
            musicLeader: '',
            preacher: '',
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
            this.loadHymnRegistry();

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
                    minMatchCharLength: 2
                });
            } catch (error) {
                console.error("Error loading hymn registry:", error);
            }
        },

        async load() {
            const doc = await db.collection('services').doc(this.date).get();
            if (doc.exists) {
                const data = doc.data();
                // Update top-level properties
                this.service.theme = data.theme || '';
                this.service.keyVerse = data.keyVerse || '';
                this.service.serviceLeader = data.serviceLeader || '';
                this.service.musicLeader = data.musicLeader || '';
                this.service.preacher = data.preacher || '';
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
                let fieldsToCheck = [
                    'preparatoryHymn', 'callToWorship', 'hymn1', 
                    'callToConfession', 'assuranceOfPardon', 'hymnMid2', 
                    'scriptureReading', 'sermon', 'hymnEnd1', 'hymnEnd2', 'benediction'
                ];

                if (this.service.hasBaptism) {
                    fieldsToCheck.push('baptism');
                } else {
                    fieldsToCheck.push('hymn2');
                    fieldsToCheck.push('hymnMid1');
                }

                for (const key of fieldsToCheck) {
                    const val = this.service.liturgy[key];
                    const isEmpty = (val && typeof val === 'object') ? !val.name : !val;

                    if (isEmpty) {
                        const section = document.querySelector(`[data-field-key="${key}"]`);
                        if (section) {
                            section.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            section.classList.add('ring-2', 'ring-red-500', 'ring-offset-2');
                            setTimeout(() => {
                                section.classList.remove('ring-2', 'ring-red-500', 'ring-offset-2');
                            }, 3000);
                            return;
                        }
                    }
                }
            });
        },

        async save() {
            this.saving = true;
            try {
                await db.collection('services').doc(this.date).set({
                    ...this.service,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.originalService = JSON.stringify(this.service);
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
            this.service.serviceLeader = '';
            this.service.musicLeader = '';
            this.service.preacher = '';
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

function hymnPicker(hymnRef) {
    return {
        hymnRef: hymnRef,
        open: false,
        query: hymnRef.name || '',
        results: [],
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
            hymnRef.id = h.id;
            hymnRef.name = h.hymn_name;
            this.query = h.hymn_name;
            this.results = [];
            this.open = false;
            this.$el.dispatchEvent(new CustomEvent('input', {
                detail: { id: h.id, name: h.hymn_name },
                bubbles: true
            }));
        },
        clear() {
            hymnRef.id = null;
            hymnRef.name = '';
            this.query = '';
            this.results = [];
            this.open = false;
            this.$el.dispatchEvent(new CustomEvent('input', {
                detail: { id: null, name: '' },
                bubbles: true
            }));
        }
    };
}
