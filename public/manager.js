document.addEventListener('DOMContentLoaded', () => {
    const hymnListContainer = document.getElementById('hymn-list');
    const addHymnForm = document.getElementById('add-hymn-form');
    const db = firebase.firestore();
    const storage = firebase.storage();

    // Global state for Add/Edit
    let isEditing = false;
    let editingHymnId = null;
    let versions = [];
    let versionCounter = 0;
    let originalPageUrls = [];
    
    // Tag System State
    let currentTags = [];
    let allTags = []; // List of all available tags in the system

    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    firebase.auth().signInAnonymously().then(() => {
        loadHymns();
        loadTags(); // Fetch existing tags
        resetForm(); // initializes the form in "Add" mode
    }).catch((error) => {
        console.error("Error signing in anonymously:", error);
    });

    // --- Loading & Listing Hymns ---

    function loadHymns() {
        db.collection('hymns').orderBy('hymn_name').get().then(querySnapshot => {
            let html = '';
            querySnapshot.forEach(doc => {
                const hymn = doc.data();
                html += `
                    <div class="hymn-item-manager">
                        <strong>${hymn.hymn_name}</strong>
                        <div>
                            <button class="edit-hymn" data-id="${doc.id}">Edit</button>
                            <button class="delete-hymn" data-id="${doc.id}">Delete</button>
                        </div>
                    </div>
                `;
            });
            hymnListContainer.innerHTML = html;

            document.querySelectorAll('.delete-hymn').forEach(button => {
                button.addEventListener('click', (e) => {
                    const hymnId = e.target.dataset.id;
                    deleteHymn(hymnId);
                });
            });

            document.querySelectorAll('.edit-hymn').forEach(button => {
                button.addEventListener('click', (e) => {
                    const hymnId = e.target.dataset.id;
                    startEditHymn(hymnId);
                });
            });
        });
    }

    function loadTags() {
        db.collection('tags').get().then(snapshot => {
            allTags = [];
            snapshot.forEach(doc => {
                // Assuming tag document ID is the tag name or it has a name field
                // Let's assume the document ID is the tag name for uniqueness
                allTags.push(doc.id);
            });
            // Sort tags alphabetically
            allTags.sort();
        }).catch(err => {
            console.error("Error loading tags:", err);
        });
    }

    // --- Form Rendering & State Management ---

    function resetForm() {
        isEditing = false;
        editingHymnId = null;
        versions = [];
        versionCounter = 0;
        currentTags = [];
        originalPageUrls = [];
        
        // Render basic form structure
        renderFormStructure('Add New Hymn', 'Add Hymn');
    }

    function renderFormStructure(titleText, buttonText) {
        // Update the container header if possible (requires DOM traversal since it's outside the form)
        const containerHeader = document.querySelector('#add-hymn-container h1');
        if (containerHeader) containerHeader.textContent = titleText;

        let formHtml = `
            <input type="text" id="hymn_name" placeholder="Hymn Name" required><br>
            <input type="text" id="music_writer" placeholder="Music Writer" required><br>
            <input type="text" id="lyrics_writer" placeholder="Lyrics Writer" required><br>
            <textarea id="attribution" placeholder="Attribution" required></textarea><br>
            
            <label>Tags:</label>
            <div class="tag-wrapper">
                <div class="tag-container" id="tag-container">
                    <input type="text" id="tag-input" placeholder="Add tags...">
                </div>
                <div class="suggestions-list" id="suggestions-list"></div>
            </div>
            
            <div id="versions-container"></div>
            <button type="button" id="add-version">Add Version</button><br>
            
            <div class="form-actions">
                <button type="submit" id="submit-btn">${buttonText}</button>
                ${isEditing ? '<button type="button" id="cancel-edit">Cancel Edit</button>' : ''}
            </div>
        `;
        addHymnForm.innerHTML = formHtml;

        // Initialize Tag Logic
        initTagInput();

        document.getElementById('add-version').addEventListener('click', () => {
            addNewVersionUI();
        });

        if (isEditing) {
            document.getElementById('cancel-edit').addEventListener('click', () => {
                resetForm();
            });
        }
    }

    // --- Tag System Logic ---

    function initTagInput() {
        const tagContainer = document.getElementById('tag-container');
        const tagInput = document.getElementById('tag-input');
        const suggestionsList = document.getElementById('suggestions-list');

        // Render initial tags if any
        renderTags();

        tagInput.addEventListener('input', (e) => {
            const val = e.target.value.trim().toLowerCase();
            suggestionsList.innerHTML = '';
            
            if (val.length > 0) {
                const matches = allTags.filter(tag => 
                    tag.toLowerCase().includes(val) && !currentTags.includes(tag)
                );
                
                if (matches.length > 0) {
                    suggestionsList.style.display = 'block';
                    matches.forEach(tag => {
                        const div = document.createElement('div');
                        div.className = 'suggestion-item';
                        div.textContent = tag;
                        div.addEventListener('click', () => {
                            addTag(tag);
                            tagInput.value = '';
                            suggestionsList.style.display = 'none';
                            tagInput.focus();
                        });
                        suggestionsList.appendChild(div);
                    });
                } else {
                    suggestionsList.style.display = 'none';
                }
            } else {
                suggestionsList.style.display = 'none';
            }
        });

        tagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = tagInput.value.trim();
                if (val) {
                    // Check if it's a case-insensitive match to an existing tag to normalize
                    const existingMatch = allTags.find(t => t.toLowerCase() === val.toLowerCase());
                    addTag(existingMatch || val);
                    tagInput.value = '';
                    suggestionsList.style.display = 'none';
                }
            } else if (e.key === 'Backspace' && tagInput.value === '' && currentTags.length > 0) {
                removeTag(currentTags[currentTags.length - 1]);
            }
        });

        // Hide suggestions when clicking outside
        document.addEventListener('click', (e) => {
            if (!tagContainer.contains(e.target) && !suggestionsList.contains(e.target)) {
                suggestionsList.style.display = 'none';
            }
        });
    }

    function addTag(tag) {
        if (!currentTags.includes(tag)) {
            currentTags.push(tag);
            renderTags();
        }
    }

    function removeTag(tag) {
        currentTags = currentTags.filter(t => t !== tag);
        renderTags();
    }

    function renderTags() {
        const tagContainer = document.getElementById('tag-container');
        const tagInput = document.getElementById('tag-input');
        
        // Remove existing pills
        const pills = tagContainer.querySelectorAll('.tag-pill');
        pills.forEach(p => p.remove());

        // Insert new pills before the input
        currentTags.forEach(tag => {
            const span = document.createElement('span');
            span.className = 'tag-pill';
            span.innerHTML = `${tag} <span class="remove-tag">&times;</span>`;
            span.querySelector('.remove-tag').addEventListener('click', () => {
                removeTag(tag);
            });
            tagContainer.insertBefore(span, tagInput);
        });
    }


    // --- Edit Logic ---

    function startEditHymn(hymnId) {
        db.collection('hymns').doc(hymnId).get().then(doc => {
            if (!doc.exists) {
                showToast("Hymn not found!", "error");
                return;
            }
            const data = doc.data();
            
            isEditing = true;
            editingHymnId = hymnId;
            versions = []; // Reset internal state
            versionCounter = 0;
            currentTags = data.tags || [];
            originalPageUrls = [];

            renderFormStructure('Edit Hymn', 'Update Hymn');

            // Populate text fields
            document.getElementById('hymn_name').value = data.hymn_name || '';
            document.getElementById('music_writer').value = data.music_writer || '';
            document.getElementById('lyrics_writer').value = data.lyrics_writer || '';
            document.getElementById('attribution').value = data.attribution || '';
            
            // Re-render tags since currentTags is updated
            renderTags();

            // Populate versions
            if (data.versions && Array.isArray(data.versions)) {
                data.versions.forEach((vData, index) => {
                    // Create internal state for this version
                    versionCounter++;
                    const versionId = `version-${versionCounter}`;
                    const versionObj = { 
                        id: versionId, 
                        pages: [] 
                    };
                    versions.push(versionObj);

                    // Render version container
                    renderVersionUI(versionId, versionCounter, vData.name);

                    // Handle pages
                    if (vData.pages && Array.isArray(vData.pages)) {
                        vData.pages.forEach((pageUrl, pageIndex) => {
                            const pageId = `page-${versionId}-${pageIndex + 1}`;
                            originalPageUrls.push(pageUrl);
                            // Store as existing page
                            versionObj.pages.push({
                                id: pageId,
                                url: pageUrl,
                                file: null,
                                isExisting: true
                            });
                            renderPageUI(versionId, pageId, pageIndex + 1, pageUrl);
                        });
                    }
                });
            }
        }).catch(err => {
            console.error("Error fetching hymn details:", err);
            showToast("Could not load hymn details.", "error");
        });
    }

    // --- Dynamic Form Elements (Versions/Pages) ---

    function addNewVersionUI() {
        versionCounter++;
        const versionId = `version-${versionCounter}`;
        versions.push({ id: versionId, pages: [] });
        renderVersionUI(versionId, versionCounter, '');
    }

    function renderVersionUI(versionId, count, nameValue) {
        const container = document.getElementById('versions-container');
        const div = document.createElement('div');
        div.className = 'version-manager';
        div.id = versionId;
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h3>Version ${count}</h3>
                <button type="button" class="remove-version">Remove Version</button>
            </div>
            <input type="text" class="version-name" placeholder="Version Name" value="${nameValue}" required><br>
            <div class="pages-container"></div>
            <button type="button" class="add-page">Add Page</button>
        `;
        container.appendChild(div);

        div.querySelector('.add-page').addEventListener('click', () => {
            addNewPageUI(versionId);
        });

        div.querySelector('.remove-version').addEventListener('click', () => {
            // Remove from array
            versions = versions.filter(v => v.id !== versionId);
            // Remove from DOM
            div.remove();
        });
    }

    function addNewPageUI(versionId) {
        const version = versions.find(v => v.id === versionId);
        if (!version) return;

        const pageId = `page-${version.id}-${Date.now()}`; // unique ID
        version.pages.push({ id: pageId, file: null, url: null, isExisting: false });
        
        renderPageUI(versionId, pageId, version.pages.length, null);
    }

    function renderPageUI(versionId, pageId, pageNum, existingUrl) {
        const versionDiv = document.getElementById(versionId);
        const pagesContainer = versionDiv.querySelector('.pages-container');
        
        const pageDiv = document.createElement('div');
        pageDiv.className = 'page-manager';
        pageDiv.id = pageId;
        
        let contentHtml = `<div style="display:flex; justify-content:space-between;"><span>Page</span> <button type="button" class="remove-page">X</button></div>`;
        
        if (existingUrl) {
            contentHtml += `
                <div class="existing-image-preview">
                    <a href="${existingUrl}" target="_blank">View Current Image</a>
                    <input type="hidden" class="existing-url-input" value="${existingUrl}">
                </div>
                <label>Replace Image (optional):</label>
            `;
        }
        
        // File input is always present (required for new pages, optional for existing)
        contentHtml += `<input type="file" class="page-file" accept="image/*" ${existingUrl ? '' : 'required'}>`;

        pageDiv.innerHTML = contentHtml;
        pagesContainer.appendChild(pageDiv);

        // Remove Page Handler
        pageDiv.querySelector('.remove-page').addEventListener('click', () => {
            const version = versions.find(v => v.id === versionId);
            if (version) {
                version.pages = version.pages.filter(p => p.id !== pageId);
            }
            pageDiv.remove();
        });
    }

    // --- Form Submission ---

    addHymnForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSubmit();
    });

    async function handleSubmit() {
        const submitButton = document.getElementById('submit-btn');
        const hymnName = document.getElementById('hymn_name').value;

        // If adding, check for duplicates
        if (!isEditing) {
            const duplicateCheck = await db.collection('hymns').where('hymn_name', '==', hymnName).get();
            if (!duplicateCheck.empty) {
                showToast('A hymn with this name already exists!', 'error');
                return;
            }
        }

        submitButton.disabled = true;
        submitButton.textContent = isEditing ? 'Updating...' : 'Adding...';

        try {
            // Save new tags to the global 'tags' collection
            const tagPromises = [];
            currentTags.forEach(tag => {
                // If tag is not in our locally loaded 'allTags' (implying it's new), add it
                // Note: allTags is just a list of names.
                if (!allTags.includes(tag)) {
                    // Use the tag string as the ID for uniqueness
                    tagPromises.push(db.collection('tags').doc(tag).set({
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    }));
                }
            });
            
            if (tagPromises.length > 0) {
                await Promise.all(tagPromises);
                // Refresh local tags
                loadTags();
            }

            const hymnFolderRef = storage.ref().child(hymnName);
            const processedVersions = [];

            // Process each version
            for (const version of versions) {
                // Get current name from DOM
                const domVersion = document.getElementById(version.id);
                if (!domVersion) continue; // Should not happen

                const versionName = domVersion.querySelector('.version-name').value;
                const finalPages = [];

                // Process each page in this version
                for (const page of version.pages) {
                    const domPage = document.getElementById(page.id);
                    if (!domPage) continue;

                    const fileInput = domPage.querySelector('.page-file');
                    const file = fileInput.files[0];

                    if (file) {
                        // Upload new file
                        const pageRef = hymnFolderRef.child(file.name); 
                        const uploadSnapshot = await pageRef.put(file);
                        const url = await uploadSnapshot.ref.getDownloadURL();
                        finalPages.push(url);
                    } else if (page.isExisting && page.url) {
                        // Keep existing URL
                        finalPages.push(page.url);
                    }
                }

                processedVersions.push({
                    name: versionName,
                    pages: finalPages
                });
            }

            const hymnData = {
                hymn_name: hymnName,
                music_writer: document.getElementById('music_writer').value,
                lyrics_writer: document.getElementById('lyrics_writer').value,
                attribution: document.getElementById('attribution').value,
                tags: currentTags, // Save the tags
                versions: processedVersions
            };
            
            // If adding new, set last_played_date default
            if (!isEditing) {
                hymnData.last_played_date = '';
            }

            const newPageUrls = [];
            processedVersions.forEach(v => {
                if (v.pages) {
                    newPageUrls.push(...v.pages);
                }
            });

            const urlsToDelete = originalPageUrls.filter(url => !newPageUrls.includes(url));

            if (isEditing) {
                await db.collection('hymns').doc(editingHymnId).update(hymnData);
                for (const url of urlsToDelete) {
                    try {
                        const oldImageRef = storage.refFromURL(url);
                        await oldImageRef.delete();
                    } catch (e) {
                        console.warn("Failed to delete orphaned image:", url, e);
                    }
                }
                showToast('Hymn updated successfully!');
            } else {
                await db.collection('hymns').add(hymnData);
                showToast('Hymn added successfully!');
            }

            resetForm();
            loadHymns();

        } catch (error) {
            console.error("Error saving hymn:", error);
            showToast("Error saving hymn.", "error");
            submitButton.disabled = false;
            submitButton.textContent = isEditing ? 'Update Hymn' : 'Add Hymn';
        }
    }


    // --- Delete Functionality (unchanged logic) ---

    function deleteHymn(hymnId) {
        if (!confirm('Are you sure you want to delete this hymn?')) {
            return;
        }

        const hymnRef = db.collection('hymns').doc(hymnId);
        hymnRef.get().then(doc => {
            if (doc.exists) {
                const hymn = doc.data();
                const deletePromises = [];

                if (hymn.versions) {
                    hymn.versions.forEach(version => {
                        if (version.pages) {
                            version.pages.forEach(pageUrl => {
                                const imageRef = storage.refFromURL(pageUrl);
                                deletePromises.push(
                                    imageRef.delete().catch(error => {
                                        if (error.code !== 'storage/object-not-found') {
                                            console.warn("Failed to delete image:", pageUrl, error);
                                        }
                                    })
                                );
                            });
                        }
                    });
                }

                Promise.all(deletePromises).then(() => {
                    hymnRef.delete().then(() => {
                        loadHymns();
                        showToast('Hymn deleted successfully.');
                    }).catch(error => {
                        console.error("Error removing document: ", error);
                        showToast('Error removing hymn data.', 'error');
                    });
                });
            } else {
                showToast("Hymn not found!", "error");
                loadHymns();
            }
        }).catch(error => {
            console.error("Error fetching hymn details:", error);
        });
    }
});