function serviceBuilder() {
    return {
        date: '',
        status: 'Loading...',
        saving: false,
        service: {
            theme: '',
            keyVerse: '',
            serviceLeader: '',
            musicLeader: '',
            preacher: '',
            elements: []
        },
        hymnsResults: [],
        
        async init() {
            const urlParams = new URLSearchParams(window.location.search);
            this.date = urlParams.get('date');
            
            if (!this.date) {
                alert('No date specified. Redirecting to calendar.');
                window.location.href = 'service-calendar.html';
                return;
            }

            await this.loadService();
        },

        async loadService() {
            try {
                const doc = await db.collection('services').doc(this.date).get();
                if (doc.exists) {
                    this.service = doc.data();
                    this.status = 'Draft';
                } else {
                    this.loadDefaultTemplate();
                    this.status = 'New Service';
                }
            } catch (error) {
                console.error("Error loading service:", error);
                this.status = 'Error Loading';
            }
        },

        loadDefaultTemplate() {
            const defaultElements = [
                { id: this.uid(), type: 'heading', title: 'Preparation', content: '' },
                { id: this.uid(), type: 'custom', title: 'Call to Worship', content: '' },
                { id: this.uid(), type: 'prayer', title: 'Opening Prayer', content: '' },
                { id: this.uid(), type: 'hymn', title: 'Hymn 1', content: '', hymnId: null, hymnData: null },
                { id: this.uid(), type: 'hymn', title: 'Hymn 2', content: '', hymnId: null, hymnData: null },
                { id: this.uid(), type: 'heading', title: 'Word', content: '' },
                { id: this.uid(), type: 'scripture', title: 'Scripture Reading', content: '' },
                { id: this.uid(), type: 'sermon', title: 'Sermon', content: '' },
                { id: this.uid(), type: 'heading', title: 'Response', content: '' },
                { id: this.uid(), type: 'hymn', title: 'Response Hymn', content: '', hymnId: null, hymnData: null },
                { id: this.uid(), type: 'custom', title: 'Lord\'s Supper', content: '' },
                { id: this.uid(), type: 'custom', title: 'Benediction', content: '' }
            ];
            this.service.elements = defaultElements;
        },

        async saveService() {
            this.saving = true;
            try {
                const serviceToSave = {
                    ...this.service,
                    date: this.date,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await db.collection('services').doc(this.date).set(serviceToSave);
                this.status = 'Saved';
                alert('Service saved successfully!');
            } catch (error) {
                console.error("Error saving service:", error);
                alert('Error saving service. Make sure you are logged in as an editor.');
            } finally {
                this.saving = false;
            }
        },

        addElement() {
            this.service.elements.push({
                id: this.uid(),
                type: 'custom',
                title: 'New Element',
                content: ''
            });
        },

        removeElement(index) {
            if (confirm('Are you sure you want to remove this element?')) {
                this.service.elements.splice(index, 1);
            }
        },

        moveElement(index, direction) {
            const targetIndex = index + direction;
            if (targetIndex < 0 || targetIndex >= this.service.elements.length) return;
            
            const element = this.service.elements.splice(index, 1)[0];
            this.service.elements.splice(targetIndex, 0, element);
        },

        handleTypeChange(element) {
            if (element.type === 'hymn' && !element.hymnData) {
                element.hymnId = null;
                element.hymnData = null;
            }
        },

        async searchHymns(query, element) {
            if (!query || query.length < 2) {
                this.hymnsResults = [];
                return;
            }

            try {
                // Simple startsWith search for hymns
                const snapshot = await db.collection('hymns')
                    .where('hymn_name', '>=', query)
                    .where('hymn_name', '<=', query + '\uf8ff')
                    .limit(5)
                    .get();
                
                this.hymnsResults = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (error) {
                console.error("Error searching hymns:", error);
            }
        },

        selectHymn(element, hymn) {
            element.hymnId = hymn.id;
            element.hymnData = {
                hymn_name: hymn.hymn_name,
                lyrics_writer: hymn.lyrics_writer
            };
            this.hymnsResults = [];
        },

        formatDate(dateStr) {
            if (!dateStr) return '';
            const [year, month, day] = dateStr.split('-');
            return new Date(year, month - 1, day).toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        },

        uid() {
            return Math.random().toString(36).substr(2, 9);
        }
    };
}
