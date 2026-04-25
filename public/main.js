document.addEventListener('alpine:init', () => {
    Alpine.data('hymnLookup', () => ({
        hymns: [],
        filteredHymns: [],
        searchQuery: '',
        allTags: [],
        selectedTags: [],
        
        init() {
            const db = firebase.firestore();
            
            // Fetch Tags directly from Firestore
            db.collection('tags').orderBy(firebase.firestore.FieldPath.documentId()).get().then(snapshot => {
                this.allTags = [];
                snapshot.forEach(doc => {
                    this.allTags.push(doc.id);
                });
            }).catch(error => {
                console.error("Error fetching tags:", error);
            });

            // Get a reference to the callable function, explicitly specifying the region
            const getHymnIndex = firebase.app().functions('us-central1').httpsCallable('getHymnIndex');

            // Call the function and handle the result
            getHymnIndex().then(result => {
                const data = result.data;
                this.hymns = data;
                this.filteredHymns = data;
                this.performSearch(); // In case there are initial filters
            }).catch(error => {
                console.error("Error fetching hymn index:", error);
            });

            document.getElementById('manager-login-button').addEventListener('click', () => {
                const password = document.getElementById('manager-password').value;
                if (password === '1689') {
                    window.location.href = 'manager.html';
                } else {
                    alert('Incorrect password');
                }
            });
        },

        toggleTag(tag) {
            if (this.selectedTags.includes(tag)) {
                this.selectedTags = this.selectedTags.filter(t => t !== tag);
            } else {
                this.selectedTags.push(tag);
            }
            this.performSearch();
        },

        performSearch() {
            let result = this.hymns;

            // 1. Text Search
            if (this.searchQuery.trim() !== '') {
                const lowerCaseQuery = this.searchQuery.toLowerCase();
                result = result.filter(hymn => {
                    return (
                        hymn.hymn_name.toLowerCase().includes(lowerCaseQuery) ||
                        hymn.music_writer.toLowerCase().includes(lowerCaseQuery) ||
                        hymn.lyrics_writer.toLowerCase().includes(lowerCaseQuery)
                    );
                });
            }

            // 2. Tag Filter (AND logic - must have all selected tags)
            if (this.selectedTags.length > 0) {
                result = result.filter(hymn => {
                    if (!hymn.tags) return false;
                    // Check if every selected tag is present in the hymn's tags
                    return this.selectedTags.every(tag => hymn.tags.includes(tag));
                });
            }

            this.filteredHymns = result;
        },
        
        selectHymn(id) {
            window.location.href = `hymn-details.html?id=${id}`;
        }
    }))
})