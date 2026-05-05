function serviceForm() {
    return {
        date: '',
        saving: false,
        canEdit: false,
        user: null,
        originalService: '',
        service: {
            theme: '',
            keyVerse: '',
            serviceLeader: '',
            musicLeader: '',
            preacher: '',
            hasBaptism: false,
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
            // Check auth and roles
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
                // Deep merge or specific assignment to handle schema changes
                this.service = {
                    theme: data.theme || '',
                    keyVerse: data.keyVerse || '',
                    serviceLeader: data.serviceLeader || '',
                    musicLeader: data.musicLeader || '',
                    preacher: data.preacher || '',
                    hasBaptism: data.hasBaptism || false,
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
                // alert('Service saved!');
            } catch (e) {
                if (e.code === 'permission-denied') {
                    alert('Permission denied. Your account does not have permission to save services. Please contact an administrator.');
                } else {
                    alert('Error saving. Check console for details.');
                }
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
