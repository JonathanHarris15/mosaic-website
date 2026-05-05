function serviceForm() {
    return {
        date: '',
        saving: false,
        service: {
            theme: '',
            keyVerse: '',
            serviceLeader: '',
            musicLeader: '',
            preacher: '',
            hasBaptism: false,
            liturgy: {
                callToWorship: '',
                hymn1: { id: null, name: '' },
                confession: '',
                hymn2: { id: null, name: '' },
                scriptureReading: '',
                sermonPassage: '',
                baptismNames: '',
                baptismNotes: '',
                hymn3: { id: null, name: '' },
                benediction: ''
            }
        },

        async init() {
            const urlParams = new URLSearchParams(window.location.search);
            this.date = urlParams.get('date');
            if (!this.date) {
                window.location.href = 'service-calendar.html';
                return;
            }
            await this.load();
        },

        async load() {
            const doc = await db.collection('services').doc(this.date).get();
            if (doc.exists) {
                const data = doc.data();
                // Merge to handle potential missing fields in old schema
                this.service = { ...this.service, ...data };
                if (!this.service.liturgy) {
                    this.service.liturgy = {
                        callToWorship: '', hymn1: { id: null, name: '' },
                        confession: '', hymn2: { id: null, name: '' },
                        scriptureReading: '', sermonPassage: '',
                        baptismNames: '', baptismNotes: '',
                        hymn3: { id: null, name: '' }, benediction: ''
                    };
                }
            }
        },

        async save() {
            this.saving = true;
            try {
                await db.collection('services').doc(this.date).set({
                    ...this.service,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                alert('Service saved!');
            } catch (e) {
                alert('Error saving. Check console.');
                console.error(e);
            } finally {
                this.saving = false;
            }
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
        },
        clear() {
            hymnRef.id = null;
            hymnRef.name = '';
        }
    };
}
