/**
 * @fileoverview Administrative logic for managing people and their involvement.
 */

document.addEventListener('alpine:init', () => {
    const db = firebase.firestore();

    Alpine.data('peoplesPage', () => ({
        people: [],
        isSubmitting: false,
        searchTerm: '',
        sortKey: 'totalInvolvements', // 'name' or 'totalInvolvements'
        sortDirection: 'desc',
        
        // Form data for adding a person
        newPersonName: '',
        
        // Involvement tracking
        selectedPerson: null,
        involvement: [],
        newInvolvement: {
            serviceDate: '',
            type: '',
            prayerType: 'praise',
            prayerText: ''
        },
        
        // UI State
        showInvolvementModal: false,

        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    window.location.href = 'login.html';
                    return;
                }
                const userData = await getUserData(user.uid);
                const role = (userData && userData.role) || 'viewer';
                if (role !== 'editor' && role !== 'admin') {
                    alert('Permission denied.');
                    window.location.href = 'index.html';
                    return;
                }
                this.loadPeople();
            });
        },

        async loadPeople() {
            try {
                // We'll fetch all and sort client-side for flexibility with searches and counts
                const snap = await db.collection('people').get();
                this.people = snap.docs.map(doc => ({ 
                    id: doc.id, 
                    totalInvolvements: 0, 
                    ...doc.data() 
                }));
            } catch (error) {
                console.error("Error loading people:", error);
                this.showToast('Error loading people list', 'error');
            }
        },

        toggleSort(key) {
            if (this.sortKey === key) {
                this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortKey = key;
                this.sortDirection = key === 'totalInvolvements' ? 'desc' : 'asc';
            }
        },

        async addPerson() {
            const name = this.newPersonName.trim();
            if (!name) return;
            
            this.isSubmitting = true;
            try {
                await db.collection('people').add({
                    name: name,
                    totalInvolvements: 0,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.newPersonName = '';
                await this.loadPeople();
                this.showToast('Person added successfully');
            } catch (e) {
                console.error(e);
                this.showToast('Error adding person', 'error');
            } finally {
                this.isSubmitting = false;
            }
        },

        async deletePerson(id) {
            if (!confirm('Are you sure you want to delete this person? Involvement records will remain but will be unlinked.')) return;
            try {
                await db.collection('people').doc(id).delete();
                await this.loadPeople();
                this.showToast('Person removed');
            } catch (e) {
                console.error(e);
                this.showToast('Error deleting person', 'error');
            }
        },

        async viewInvolvement(person) {
            this.selectedPerson = person;
            this.showInvolvementModal = true;
            this.loadInvolvement(person.id);
        },

        async loadInvolvement(personId) {
            try {
                const snap = await db.collection('people').doc(personId)
                    .collection('involvement')
                    .orderBy('serviceDate', 'desc')
                    .get();
                this.involvement = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (error) {
                console.error("Error loading involvement:", error);
            }
        },

        async addInvolvement() {
            if (!this.selectedPerson || !this.newInvolvement.serviceDate || !this.newInvolvement.type) {
                this.showToast('Please fill in Date and Role', 'error');
                return;
            }
            
            this.isSubmitting = true;
            try {
                const personRef = db.collection('people').doc(this.selectedPerson.id);
                const involvementRef = personRef.collection('involvement');
                
                const data = {
                    serviceDate: this.newInvolvement.serviceDate,
                    type: this.newInvolvement.type,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                
                if (this.newInvolvement.type === 'prayer') {
                    data.metadata = {
                        prayer_type: this.newInvolvement.prayerType,
                        prayer_text: this.newInvolvement.prayerText
                    };
                }
                
                const batch = db.batch();
                batch.set(involvementRef.doc(), data);
                batch.update(personRef, {
                    totalInvolvements: firebase.firestore.FieldValue.increment(1)
                });
                
                await batch.commit();
                
                // Update local counts
                this.selectedPerson.totalInvolvements = (this.selectedPerson.totalInvolvements || 0) + 1;

                // Reset form but keep the date for potential batch entries
                const lastDate = this.newInvolvement.serviceDate;
                this.newInvolvement = { 
                    serviceDate: lastDate, 
                    type: '', 
                    prayerType: 'praise', 
                    prayerText: '' 
                };
                
                await this.loadInvolvement(this.selectedPerson.id);
                this.showToast('Involvement logged successfully');
            } catch (e) {
                console.error(e);
                this.showToast('Error logging involvement', 'error');
            } finally {
                this.isSubmitting = false;
            }
        },

        async deleteInvolvement(involvementId) {
            if (!confirm('Remove this involvement record?')) return;
            try {
                const personRef = db.collection('people').doc(this.selectedPerson.id);
                
                const batch = db.batch();
                batch.delete(personRef.collection('involvement').doc(involvementId));
                batch.update(personRef, {
                    totalInvolvements: firebase.firestore.FieldValue.increment(-1)
                });
                
                await batch.commit();

                // Update local counts
                this.selectedPerson.totalInvolvements = Math.max(0, (this.selectedPerson.totalInvolvements || 0) - 1);

                await this.loadInvolvement(this.selectedPerson.id);
                this.showToast('Record removed');
            } catch (e) {
                console.error(e);
            }
        },

        get filteredPeople() {
            let list = [...this.people];
            
            if (this.searchTerm) {
                const term = this.searchTerm.toLowerCase();
                list = list.filter(p => p.name.toLowerCase().includes(term));
            }

            list.sort((a, b) => {
                let valA = a[this.sortKey];
                let valB = b[this.sortKey];

                if (typeof valA === 'string') {
                    valA = valA.toLowerCase();
                    valB = valB.toLowerCase();
                }

                if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
                if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
                return 0;
            });

            return list;
        },

        formatRole(role) {
            return role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        },

        showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded shadow-lg text-white z-50 ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
    }));
});
