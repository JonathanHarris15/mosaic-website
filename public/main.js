/**
 * @fileoverview Main frontend logic for the Mosaic Website hymn lookup.
 * Utilizes Alpine.js for reactive data binding and Firestore for data fetching.
 */

document.addEventListener('alpine:init', () => {
    /**
     * Alpine.js component for the hymn lookup and search functionality.
     * @typedef {Object} HymnLookup
     * @property {Array<Object>} hymns - All hymns fetched from the server.
     * @property {Array<Object>} filteredHymns - Hymns filtered by search query and tags.
     * @property {string} searchQuery - The current text search input.
     * @property {Array<string>} allTags - All available tags from Firestore.
     * @property {Array<string>} selectedTags - Tags currently selected for filtering.
     */
    Alpine.data('hymnLookup', () => ({
        hymns: [],
        filteredHymns: [],
        searchQuery: '',
        allTags: [],
        selectedTags: [],
        loading: true,
        
        /**
         * Initializes the component, fetches tags and the hymn index.
         */
        init() {
            const db = firebase.firestore();
            this.loading = true;
            
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
            }).finally(() => {
                this.loading = false;
            });
        },

        /**
         * Toggles a tag in the selectedTags filter list.
         * @param {string} tag - The tag to toggle.
         */
        toggleTag(tag) {
            if (this.selectedTags.includes(tag)) {
                this.selectedTags = this.selectedTags.filter(t => t !== tag);
            } else {
                this.selectedTags.push(tag);
            }
            this.performSearch();
        },

        /**
         * Filters the hymns based on the current searchQuery and selectedTags.
         */
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
        
        /**
         * Redirects the user to the details page for a specific hymn.
         * @param {string} id - The Firestore ID of the hymn.
         */
        selectHymn(id) {
            window.location.href = `hymn-details.html?id=${id}`;
        }
    }))
})

/**
 * Helper to show/hide admin-only UI elements based on user role.
 */
async function checkAdminAccess(user) {
    const adminActions = document.getElementById('admin-actions');
    if (!adminActions) return;

    if (user && !user.isAnonymous) {
        try {
            const userData = await getUserData(user.uid);
            const role = (userData && userData.role) || 'viewer';
            if (role === 'editor' || role === 'admin') {
                adminActions.classList.remove('hidden');
            } else {
                adminActions.classList.add('hidden');
            }
        } catch (error) {
            console.error("Error checking user role:", error);
            adminActions.classList.add('hidden');
        }
    } else {
        adminActions.classList.add('hidden');
    }
}

// Listen for authentication changes to show/hide admin controls
auth.onAuthStateChanged(checkAdminAccess);
document.addEventListener('auth-changed', (e) => checkAdminAccess(e.detail.user));