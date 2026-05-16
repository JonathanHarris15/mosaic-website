/**
 * @fileoverview Administrative dashboard logic for managing the hymn database.
 * Provides functionality for adding, editing, and deleting hymns and their associated files.
 */

document.addEventListener('alpine:init', () => {
    const db = firebase.firestore();
    const storage = firebase.storage();

    /**
     * Alpine.js component for managing hymns.
     */
    Alpine.data('hymnManager', () => ({
        hymns: [],
        allTags: [],
        
        isEditing: false,
        showFormModal: false,
        selectedHymnId: null,
        editingHymnId: null,
        isSubmitting: false,
        
        tagInput: '',
        suggestions: [],
        originalPageUrls: [],
        
        formData: {
            hymn_name: '',
            music_writer: '',
            lyrics_writer: '',
            attribution: '',
            tags: [],
            versions: []
        },

        /**
         * Initializes the manager, checking for authentication and user role.
         */
        init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    window.location.href = 'login.html';
                    return;
                }

                // Check role
                const userData = await getUserData(user.uid);
                const role = (userData && userData.role) || 'viewer';
                if (!['editor', 'elder', 'admin', 'super_admin'].includes(role)) {
                    alert('You do not have permission to access the Hymn Manager.');
                    window.location.href = 'index.html';
                    return;
                }

                this.loadHymns();
                this.loadTags();

                // Check for name query param to pre-fill
                const urlParams = new URLSearchParams(window.location.search);
                const nameParam = urlParams.get('name');
                if (nameParam && !this.isEditing) {
                    this.formData.hymn_name = nameParam;
                }
            });
        },

        /**
         * Displays a temporary toast message to the user.
         * @param {string} message - The message to display.
         * @param {string} [type='success'] - The type of toast ('success' or 'error').
         */
        showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        },

        /**
         * Loads the list of all hymns from Firestore, ordered by name.
         */
        loadHymns() {
            db.collection('hymns').orderBy('hymn_name').get().then(snapshot => {
                this.hymns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            });
        },

        /**
         * Loads all available tags from the 'tags' collection.
         */
        loadTags() {
            db.collection('tags').get().then(snapshot => {
                this.allTags = snapshot.docs.map(doc => doc.id).sort();
            });
        },

        /**
         * Resets the form to its default empty state and closes the modal.
         */
        resetForm() {
            this.isEditing = false;
            this.showFormModal = false;
            this.editingHymnId = null;
            this.tagInput = '';
            this.suggestions = [];
            this.originalPageUrls = [];
            this.formData = {
                hymn_name: '',
                music_writer: '',
                lyrics_writer: '',
                attribution: '',
                tags: [],
                versions: []
            };
        },

        /**
         * Opens the modal for creating a new hymn.
         * @param {string} [name=''] - Initial name to pre-fill.
         */
        startCreateHymn(name = '') {
            this.resetForm();
            this.showFormModal = true;
            this.formData.hymn_name = name;
        },

        /**
         * Populates the form with data from an existing hymn to begin editing.
         * @param {Object} hymn - The hymn object to edit.
         */
        startEditHymn(hymn) {
            this.isEditing = true;
            this.showFormModal = true;
            this.editingHymnId = hymn.id;
            this.originalPageUrls = [];
            
            this.formData.hymn_name = hymn.hymn_name || '';
            this.formData.music_writer = hymn.music_writer || '';
            this.formData.lyrics_writer = hymn.lyrics_writer || '';
            this.formData.attribution = hymn.attribution || '';
            this.formData.tags = hymn.tags ? [...hymn.tags] : [];
            
            this.formData.versions = (hymn.versions || []).map((v) => {
                return {
                    id: 'version-' + Date.now() + Math.random(),
                    name: v.name,
                    pages: (v.pages || []).map(url => {
                        this.originalPageUrls.push(url);
                        return {
                            id: 'page-' + Date.now() + Math.random(),
                            url: url,
                            file: null
                        };
                    })
                };
            });
        },

        /**
         * Deletes a hymn from Firestore and its associated images from Firebase Storage.
         * @param {Object} hymn - The hymn object to delete.
         */
        deleteHymn(hymn) {
            if (!confirm('Are you sure you want to delete this hymn?')) return;

            const deletePromises = [];
            if (hymn.versions) {
                hymn.versions.forEach(v => {
                    if (v.pages) {
                        v.pages.forEach(url => {
                            deletePromises.push(
                                storage.refFromURL(url).delete().catch(e => console.warn(e))
                            );
                        });
                    }
                });
            }

            Promise.all(deletePromises).then(() => {
                db.collection('hymns').doc(hymn.id).delete().then(() => {
                    this.loadHymns();
                    this.showToast('Hymn deleted successfully.');
                }).catch(e => {
                    console.error(e);
                    this.showToast('Error removing hymn data.', 'error');
                });
            });
        },

        /**
         * Updates tag suggestions based on current user input.
         */
        updateSuggestions() {
            const val = this.tagInput.trim().toLowerCase();
            if (val.length > 0) {
                this.suggestions = this.allTags.filter(t => 
                    t.toLowerCase().includes(val) && !this.formData.tags.includes(t)
                );
            } else {
                this.suggestions = [];
            }
        },

        /**
         * Adds a tag to the current hymn's tag list.
         */
        addTag() {
            let val = this.tagInput.trim();
            if (val) {
                const match = this.allTags.find(t => t.toLowerCase() === val.toLowerCase());
                const finalTag = match || val;
                if (!this.formData.tags.includes(finalTag)) {
                    this.formData.tags.push(finalTag);
                }
                this.tagInput = '';
                this.suggestions = [];
            }
        },

        /**
         * Adds a tag from a suggestion.
         * @param {string} tag - The tag to add.
         */
        addTagFromSuggestion(tag) {
            this.tagInput = tag;
            this.addTag();
        },

        /**
         * Handles backspace in the tag input to remove the last tag.
         */
        handleBackspace() {
            if (this.tagInput === '' && this.formData.tags.length > 0) {
                this.formData.tags.pop();
            }
        },

        /**
         * Removes a specific tag from the current hymn's tag list.
         * @param {string} tag - The tag to remove.
         */
        removeTag(tag) {
            this.formData.tags = this.formData.tags.filter(t => t !== tag);
        },

        /**
         * Adds a new empty version to the form.
         */
        addVersion() {
            this.formData.versions.push({
                id: 'version-' + Date.now() + Math.random(),
                name: '',
                pages: []
            });
        },

        /**
         * Removes a version from the form by index.
         * @param {number} index - The index of the version to remove.
         */
        removeVersion(index) {
            this.formData.versions.splice(index, 1);
        },

        /**
         * Adds a new empty page placeholder to a specific version.
         * @param {number} vIndex - The index of the version to add the page to.
         */
        addPage(vIndex) {
            this.formData.versions[vIndex].pages.push({
                id: 'page-' + Date.now() + Math.random(),
                url: null,
                file: null
            });
        },

        /**
         * Removes a page from a specific version by index.
         * @param {number} vIndex - The index of the version.
         * @param {number} pIndex - The index of the page to remove.
         */
        removePage(vIndex, pIndex) {
            this.formData.versions[vIndex].pages.splice(pIndex, 1);
        },

        /**
         * Handles file selection for a specific page.
         * @param {Event} event - The file input change event.
         * @param {number} vIndex - The index of the version.
         * @param {number} pIndex - The index of the page.
         */
        handleFileChange(event, vIndex, pIndex) {
            const file = event.target.files[0];
            this.formData.versions[vIndex].pages[pIndex].file = file;
        },

        /**
         * Validates and submits the hymn form to Firestore and Firebase Storage.
         * Handles both creation of new hymns and updates to existing ones.
         */
        async handleSubmit() {
            if (!this.isEditing) {
                const check = await db.collection('hymns').where('hymn_name', '==', this.formData.hymn_name).get();
                if (!check.empty) {
                    this.showToast('A hymn with this name already exists!', 'error');
                    return;
                }
            }

            this.isSubmitting = true;

            try {
                // Save new tags
                const tagPromises = [];
                this.formData.tags.forEach(tag => {
                    if (!this.allTags.includes(tag)) {
                        tagPromises.push(db.collection('tags').doc(tag).set({
                            createdAt: firebase.firestore.FieldValue.serverTimestamp()
                        }));
                    }
                });
                if (tagPromises.length > 0) {
                    await Promise.all(tagPromises);
                    this.loadTags();
                }

                const hymnFolderRef = storage.ref().child(this.formData.hymn_name);
                const processedVersions = [];
                const newPageUrls = [];

                for (const version of this.formData.versions) {
                    const finalPages = [];
                    for (const page of version.pages) {
                        if (page.file) {
                            const pageRef = hymnFolderRef.child(page.file.name);
                            const uploadSnap = await pageRef.put(page.file);
                            const url = await uploadSnap.ref.getDownloadURL();
                            finalPages.push(url);
                            newPageUrls.push(url);
                        } else if (page.url) {
                            finalPages.push(page.url);
                            newPageUrls.push(page.url);
                        }
                    }
                    processedVersions.push({
                        name: version.name,
                        pages: finalPages
                    });
                }

                const payload = {
                    hymn_name: this.formData.hymn_name,
                    music_writer: this.formData.music_writer,
                    lyrics_writer: this.formData.lyrics_writer,
                    attribution: this.formData.attribution,
                    tags: this.formData.tags,
                    versions: processedVersions
                };

                if (!this.isEditing) {
                    payload.last_played_date = '';
                }

                if (this.isEditing) {
                    await db.collection('hymns').doc(this.editingHymnId).update(payload);
                    const urlsToDelete = this.originalPageUrls.filter(u => !newPageUrls.includes(u));
                    for (const url of urlsToDelete) {
                        try {
                            await storage.refFromURL(url).delete();
                        } catch(e) {}
                    }
                    this.showToast('Hymn updated successfully!');
                } else {
                    await db.collection('hymns').add(payload);
                    this.showToast('Hymn added successfully!');
                }

                this.resetForm();
                this.loadHymns();

            } catch (err) {
                console.error(err);
                this.showToast('Error saving hymn', 'error');
            } finally {
                this.isSubmitting = false;
            }
        }
    }));
});