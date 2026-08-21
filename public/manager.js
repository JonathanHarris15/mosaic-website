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
        searchQuery: '',

        isEditing: false,
        showFormModal: false,
        selectedHymnId: null,
        editingHymnId: null,
        pendingEditId: null,   // hymn id from ?edit=<id> to auto-open once loaded (mobile "Manage Hymn")
        isSubmitting: false,
        
        tagInput: '',
        suggestions: [],
        originalPageUrls: [],

        // Handle-based crop modal for a sheet-music page. `rect` is in the
        // displayed <img>'s own pixels, starting at the full image and
        // dragged inward; mapped to the source image's natural pixels only
        // at Apply time.
        cropModal: {
            open: false, vIndex: null, pIndex: null, imgSrc: null,
            naturalW: 0, naturalH: 0, rect: null, drag: null,
        },

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
                const permissionLevel = (userData && userData.permissionLevel) || (userData && userData.role) || 'viewer';
                if (!['editor', 'elder', 'admin', 'super_admin'].includes(permissionLevel)) {
                    alert('You do not have permission to access the Hymn Manager.');
                    window.location.href = window.MOSAIC_SHELL === 'mobile' ? 'mobile.html#/home' : 'index.html';
                    return;
                }

                // Query params: ?name= pre-fills a new hymn; ?new=1 opens the create
                // form straight away (mobile add FAB); ?edit=<id> opens that hymn once
                // the catalog loads (mobile "Manage Hymn").
                const urlParams = new URLSearchParams(window.location.search);
                const nameParam = urlParams.get('name');
                const editId = urlParams.get('edit');
                const wantNew = urlParams.get('new');
                if (editId) this.pendingEditId = editId;

                this.loadHymns();
                this.loadTags();

                if (wantNew) {
                    this.startCreateHymn(nameParam || '');
                } else if (nameParam && !this.isEditing) {
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
                // Deep-link from the mobile app: open the requested hymn for editing.
                if (this.pendingEditId) {
                    const target = this.hymns.find(h => h.id === this.pendingEditId);
                    this.pendingEditId = null;
                    if (target) this.startEditHymn(target);
                    else if (window.MOSAIC_SHELL === 'mobile') this.exitToApp();
                }
            });
        },

        /**
         * Hymns filtered by the search box — matches title, lyrics/music writer,
         * attribution, or any theological tag (case-insensitive).
         */
        get filteredHymns() {
            const q = this.searchQuery.trim().toLowerCase();
            if (!q) return this.hymns;
            return this.hymns.filter(h => [
                h.hymn_name, h.music_writer, h.lyrics_writer, h.attribution,
                ...(Array.isArray(h.tags) ? h.tags : [])
            ].filter(Boolean).join(' ').toLowerCase().includes(q));
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
         * Mobile shell: leave the manager and return to the app's Hymn Directory.
         * The desktop catalog list is intentionally not reachable on mobile.
         */
        exitToApp() {
            window.location.href = 'mobile.html#/hymnDirectory';
        },

        /**
         * Closing the form: on mobile that means leaving the manager entirely
         * (there is no catalog behind it); on desktop it just closes the modal.
         */
        closeForm() {
            if (window.MOSAIC_SHELL === 'mobile') this.exitToApp();
            else this.resetForm();
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
            if (!file) return;
            const page = this.formData.versions[vIndex].pages[pIndex];
            page.file = file;
            // A local preview so the thumbnail (and the cropper) has something
            // to show before this page is ever uploaded.
            if (page.url && page.url.startsWith('blob:')) URL.revokeObjectURL(page.url);
            page.url = URL.createObjectURL(file);
        },

        /**
         * Opens the crop modal against a page's preview — a local blob: URL
         * for a just-chosen file, or the live Storage download URL for an
         * already-saved page. The box starts covering the whole image;
         * cropImageLoaded (fired once the <img> has actually laid out) sets
         * it to the image's full displayed size.
         */
        openCropper(vIndex, pIndex) {
            const page = this.formData.versions[vIndex].pages[pIndex];
            const src = page.url;
            if (!src) return;
            this.cropModal = {
                open: true, vIndex, pIndex, imgSrc: src,
                naturalW: 0, naturalH: 0, rect: null, drag: null,
            };
        },

        cropImageLoaded(e) {
            const el = e.target;
            this.cropModal.naturalW = el.naturalWidth;
            this.cropModal.naturalH = el.naturalHeight;
            this.cropModal.rect = { x: 0, y: 0, w: el.clientWidth, h: el.clientHeight };
        },

        // `mode` is 'move' (drag the box itself) or a corner ('nw'/'ne'/'sw'/'se',
        // dragged via its handle) — the only two gestures a bounded crop box needs.
        cropDragStart(mode, e) {
            e.preventDefault();
            const el = document.getElementById('crop-target-img');
            if (!el || !this.cropModal.rect) return;
            const box = el.getBoundingClientRect();
            this.cropModal.drag = {
                mode, boxW: box.width, boxH: box.height,
                startX: e.clientX - box.left, startY: e.clientY - box.top,
                startRect: Object.assign({}, this.cropModal.rect),
            };
        },

        cropDragMove(e) {
            const d = this.cropModal.drag;
            if (!d) return;
            const el = document.getElementById('crop-target-img');
            if (!el) return;
            const box = el.getBoundingClientRect();
            const x = Math.min(Math.max(e.clientX - box.left, 0), d.boxW);
            const y = Math.min(Math.max(e.clientY - box.top, 0), d.boxH);
            const dx = x - d.startX;
            const dy = y - d.startY;
            const MIN = 24; // smallest edge a crop box may shrink to, in displayed px

            if (d.mode === 'move') {
                this.cropModal.rect = {
                    x: Math.min(Math.max(d.startRect.x + dx, 0), d.boxW - d.startRect.w),
                    y: Math.min(Math.max(d.startRect.y + dy, 0), d.boxH - d.startRect.h),
                    w: d.startRect.w, h: d.startRect.h,
                };
                return;
            }

            let left = d.startRect.x, top = d.startRect.y;
            let right = d.startRect.x + d.startRect.w, bottom = d.startRect.y + d.startRect.h;
            if (d.mode.indexOf('w') !== -1) left = Math.min(Math.max(d.startRect.x + dx, 0), right - MIN);
            if (d.mode.indexOf('e') !== -1) right = Math.max(Math.min(right + dx, d.boxW), left + MIN);
            if (d.mode.indexOf('n') !== -1) top = Math.min(Math.max(d.startRect.y + dy, 0), bottom - MIN);
            if (d.mode.indexOf('s') !== -1) bottom = Math.max(Math.min(bottom + dy, d.boxH), top + MIN);
            this.cropModal.rect = { x: left, y: top, w: right - left, h: bottom - top };
        },

        cropDragEnd() {
            this.cropModal.drag = null;
        },

        cancelCrop() {
            this.cropModal.open = false;
        },

        /**
         * Fetches the source image as bytes and decodes it with
         * createImageBitmap rather than drawing a same-URL <img>/Image into
         * the canvas. A plain <img src> elsewhere on this page (the page
         * thumbnail) may already have cached this exact URL as an opaque,
         * non-CORS-validated response; a later same-URL load done in
         * crossOrigin="anonymous" mode can end up reusing that cache entry in
         * some browsers and tainting the canvas even though the server sends
         * Access-Control-Allow-Origin. A fetch() we make ourselves has no such
         * ambiguity — if it resolves, the bytes are ours to draw.
         */
        async _loadCropSource(src) {
            const res = await fetch(src);
            if (!res.ok) throw new Error('Could not read that image.');
            const blob = await res.blob();
            return createImageBitmap(blob);
        },

        /**
         * Draws the crop box (scaled from displayed to natural pixels) onto a
         * fresh canvas and replaces the page's file/preview with the result.
         * Nothing is uploaded yet — Save still does that, same as any other
         * page.
         */
        async applyCrop() {
            const m = this.cropModal;
            if (!m.rect || m.rect.w < 4 || m.rect.h < 4) { this.cancelCrop(); return; }

            // The page this crop belongs to must still be in the form. If the
            // form was reset underneath the cropper there is nothing to write
            // the result back to, and pressing on would throw on undefined.
            const version = this.formData.versions[m.vIndex];
            const target = version && version.pages[m.pIndex];
            if (!target) {
                alert('That sheet page is no longer open for editing. Reopen the hymn and crop again.');
                this.cancelCrop();
                return;
            }

            const displayedEl = document.getElementById('crop-target-img');
            if (!displayedEl || !displayedEl.clientWidth || !displayedEl.clientHeight) {
                alert('Could not read the crop area. Reopen the cropper and try again.');
                this.cancelCrop();
                return;
            }
            const scaleX = m.naturalW / displayedEl.clientWidth;
            const scaleY = m.naturalH / displayedEl.clientHeight;
            const sx = Math.round(m.rect.x * scaleX);
            const sy = Math.round(m.rect.y * scaleY);
            const sw = Math.max(1, Math.round(m.rect.w * scaleX));
            const sh = Math.max(1, Math.round(m.rect.h * scaleY));

            let blob;
            try {
                const bitmap = await this._loadCropSource(m.imgSrc);
                const canvas = document.createElement('canvas');
                canvas.width = sw;
                canvas.height = sh;
                canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
                bitmap.close();
                blob = await new Promise((resolve, reject) => canvas.toBlob(
                    b => b ? resolve(b) : reject(new Error('The browser would not export the cropped image.')),
                    'image/jpeg', 0.92));
            } catch (e) {
                console.error('Error cropping image:', e);
                alert('Could not crop that image: ' + (e && e.message ? e.message : e));
                return;
            }

            const page = target;
            // Always a fresh, page-unique name — never the original filename.
            // Re-cropping an already-uploaded page uploads to the same Storage
            // path as anything else named after it; reusing the original name
            // would collide with it, and Save's orphan cleanup (which deletes
            // any pre-edit URL no longer referenced) would then delete the
            // crop it just uploaded, since both resolve to the same path.
            if (page.url && page.url.startsWith('blob:')) URL.revokeObjectURL(page.url);
            page.file = new File([blob], `cropped-${page.id}.jpg`, { type: 'image/jpeg' });
            page.url = URL.createObjectURL(blob);

            this.cropModal.open = false;
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
                            let url;
                            try {
                                const uploadSnap = await pageRef.put(page.file);
                                url = await uploadSnap.ref.getDownloadURL();
                            } catch (uploadErr) {
                                throw new Error(
                                    `Could not upload "${page.file.name}" (${version.name || 'unnamed version'}): ` +
                                    (uploadErr && uploadErr.message ? uploadErr.message : uploadErr));
                            }
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

                if (window.MOSAIC_SHELL === 'mobile') { this.exitToApp(); return; }
                this.resetForm();
                this.loadHymns();

            } catch (err) {
                console.error(err);
                this.showToast((err && err.message) ? err.message : 'Error saving hymn', 'error');
            } finally {
                this.isSubmitting = false;
            }
        }
    }));
});