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

            window.addEventListener('beforeunload', (e) => {
                if (this.canEdit && this.isDirty) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });
        },

        async load() {
            const doc = await db.collection('services').doc(this.date).get();
            if (doc.exists) {
                const data = doc.data();
                this.service = {
                    theme: data.theme || '',
                    keyVerse: data.keyVerse || '',
                    serviceLeader: data.serviceLeader || '',
                    musicLeader: data.musicLeader || '',
                    preacher: data.preacher || '',
                    hasBaptism: data.hasBaptism || false,
                    notes: data.notes || {},
                    liturgy: {
                        preparatoryHymn: data.liturgy?.preparatoryHymn || { id: null, name: '' },
                        callToWorship: data.liturgy?.callToWorship || '',
                        hymn1: data.liturgy?.hymn1 || { id: null, name: '' },
                        hymn2: data.liturgy?.hymn2 || { id: null, name: '' },
                        callToConfession: data.liturgy?.callToConfession || '',
                        assuranceOfPardon: data.liturgy?.assuranceOfPardon || '',
                        hymnMid1: data.liturgy?.hymnMid1 || { id: null, name: '' },
                        hymnMid2: data.liturgy?.hymnMid2 || { id: null, name: '' },
                        scriptureReading: data.liturgy?.scriptureReading || '',
                        sermon: data.liturgy?.sermon || '',
                        baptism: data.liturgy?.baptism || '',
                        hymnEnd1: data.liturgy?.hymnEnd1 || { id: null, name: '' },
                        hymnEnd2: data.liturgy?.hymnEnd2 || { id: null, name: '' },
                        benediction: data.liturgy?.benediction || ''
                    }
                };
            }
            this.originalService = JSON.stringify(this.service);
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
                if (!this._quill) {
                    this._quill = new Quill(el, {
                        theme: 'snow',
                        modules: { toolbar: [['bold', 'italic'], [{ list: 'bullet' }]] },
                        placeholder: 'Add a note explaining your reasoning…'
                    });
                }
                const existing = (this.service.notes && this.service.notes[key]) || '';
                this._quill.root.innerHTML = existing;
                this.$nextTick(() => this._quill.focus());
            });
            if (!this._scrollHandler) {
                this._scrollHandler = () => {
                    if (this.activeNoteKey) this._positionEditor(this.activeNoteKey);
                };
                window.addEventListener('scroll', this._scrollHandler, { passive: true });
                window.addEventListener('resize', this._scrollHandler, { passive: true });
            }
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
        }
    };
}

function hymnPicker(hymnRef) {
    return {
        open: false,
        query: '',
        results: [],
        async search() {
            if (this.query.length < 2) return;
            const snap = await db.collection('hymns')
                .where('hymn_name', '>=', this.query)
                .where('hymn_name', '<=', this.query + '\uf8ff')
                .limit(5).get();
            this.results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        },
        select(h) {
            hymnRef.id = h.id;
            hymnRef.name = h.hymn_name;
            this.query = '';
            this.results = [];
            this.$el.dispatchEvent(new CustomEvent('input', {
                detail: { id: h.id, name: h.hymn_name },
                bubbles: true
            }));
        },
        clear() {
            hymnRef.id = null;
            hymnRef.name = '';
            this.$el.dispatchEvent(new CustomEvent('input', {
                detail: { id: null, name: '' },
                bubbles: true
            }));
        }
    };
}
