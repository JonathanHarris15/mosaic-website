// The Hymns page. The rules of the book live in hymns-page.js. This file
// talks to Firestore and Storage, and keeps a crop on the draft until Save.

document.addEventListener('alpine:init', () => {
    Alpine.data('hymnsPage', () => ({
        view: 'list',
        creating: false,
        canEdit: false,
        hymns: [],
        allTags: [],
        searchQuery: '',
        selectedTags: [],
        hymn: null,
        missing: false,
        form: null,
        tagInput: '',
        suggestions: [],
        originalPageUrls: [],
        isSubmitting: false,
        notice: '',
        cropModal: {
            open: false, vIndex: null, pIndex: null, imgSrc: null,
            naturalW: 0, naturalH: 0, rect: null, drag: null,
        },

        get homeHref() {
            return HymnsPage.homeHref(window.MOSAIC_SHELL === 'mobile' ? 'mobile' : 'web');
        },

        get filteredHymns() {
            return this.hymns.filter((hymn) => HymnsPage.hymnMatches(hymn, this.searchQuery, this.selectedTags));
        },

        get tagChoices() {
            return HymnsPage.tagChoices(this.allTags, this.selectedTags);
        },

        get headerTitle() {
            if (this.view === 'form') return this.creating ? 'New hymn' : 'Edit hymn';
            if (this.view === 'hymn' && this.hymn) return this.hymn.hymn_name;
            return 'Hymns';
        },

        init() {
            // The phone shell hides this page's header and draws its own.
            // The hymn's name lives in that header, so the shell has to hear it
            // or the open hymn has no title.
            //
            // The way back belongs in that bar too. This page is three screens
            // — the list, the hymn, the form — and the bar's own button is a
            // hamburger for the list. While a hymn or the form is open the page
            // borrows it, so there is ONE way back and it is where a phone
            // keeps one, rather than a second chevron drawn into the content.
            const publishChrome = () => {
                if (window.MOSAIC_SHELL !== 'mobile') return;
                if (typeof window.setMobileHeaderTitle === 'function') {
                    window.setMobileHeaderTitle(this.headerTitle);
                }
                if (typeof window.setMobileHeaderBack === 'function') {
                    window.setMobileHeaderBack(
                        this.view === 'list' ? null : () => this.leaveView(), 'Hymns');
                }
            };
            this.$watch('headerTitle', publishChrome);
            this.$watch('view', publishChrome);
            const start = (user) => {
                const ready = user
                    ? getUserData(user.uid).then((userData) => {
                        this.canEdit = HymnsPage.canEditHymnBook(userData);
                    }).catch(() => { this.canEdit = false; })
                    : Promise.resolve();
                ready.then(() => this.loadTags())
                    .then(() => this.loadHymns())
                    .then(() => this.applyOpenState())
                    .catch((err) => {
                        console.error(err);
                        this.notice = 'Could not open the hymn book.';
                    });
            };
            const unsub = auth.onAuthStateChanged((user) => {
                unsub();
                start(user);
            });
        },

        applyOpenState() {
            const state = HymnsPage.openState(window.location.search);
            if (state.view === 'form') {
                if (!this.canEdit) {
                    this.view = 'list';
                    return;
                }
                if (state.creating) {
                    this.startCreate(state.name);
                    return;
                }
                const hymn = this.hymns.find((item) => item.id === state.hymnId);
                if (hymn) this.startEdit(hymn);
                else {
                    this.view = 'list';
                    this.notice = 'That hymn is not in the book.';
                }
                return;
            }
            if (state.view === 'hymn') {
                const hymn = this.hymns.find((item) => item.id === state.hymnId);
                if (hymn) this.showHymn(hymn);
                else {
                    this.hymn = null;
                    this.missing = true;
                    this.view = 'hymn';
                }
                return;
            }
            this.view = 'list';
        },

        loadHymns() {
            return firebase.firestore().collection('hymns').orderBy('hymn_name').get().then((snapshot) => {
                this.hymns = snapshot.docs.map((doc) => Object.assign({ id: doc.id }, doc.data()));
            });
        },

        loadTags() {
            return firebase.firestore().collection('tags').get().then((snapshot) => {
                this.allTags = snapshot.docs.map((doc) => doc.id).sort();
            }).catch(() => { this.allTags = []; });
        },

        toggleTag(tag) {
            if (this.selectedTags.includes(tag)) {
                this.selectedTags = this.selectedTags.filter((item) => item !== tag);
            } else {
                this.selectedTags = this.selectedTags.concat([tag]);
            }
        },

        chooseTag(event) {
            const tag = event && event.target ? event.target.value : '';
            if (event && event.target) event.target.value = '';
            if (!tag) return;
            this.selectedTags = HymnsPage.chooseTag(this.selectedTags, tag);
        },

        showHymn(hymn) {
            this.hymn = hymn;
            this.missing = false;
            this.form = null;
            this.view = 'hymn';
        },

        backToList() {
            this.view = 'list';
            this.hymn = null;
            this.missing = false;
        },

        leaveView() {
            if (this.view === 'form') this.cancelForm();
            else this.backToList();
        },

        startCreate(name) {
            if (!this.canEdit) return;
            this.creating = true;
            this.originalPageUrls = [];
            this.form = HymnsPage.blankDraft(name || '');
            this.tagInput = '';
            this.suggestions = [];
            this.notice = '';
            this.view = 'form';
        },

        startEdit(hymn) {
            if (!this.canEdit || !hymn) return;
            this.creating = false;
            this.hymn = hymn;
            this.originalPageUrls = [];
            (hymn.versions || []).forEach((version) => {
                (version.pages || []).forEach((url) => {
                    if (url) this.originalPageUrls.push(url);
                });
            });
            let n = 0;
            this.form = HymnsPage.draftFromHymn(hymn, (kind) => {
                n += 1;
                return kind + '-' + Date.now() + '-' + n;
            });
            this.tagInput = '';
            this.suggestions = [];
            this.notice = '';
            this.view = 'form';
        },

        cancelForm() {
            HymnsPage.unsavedSheetPages(this.form).forEach((page) => {
                if (page.url && String(page.url).indexOf('blob:') === 0) URL.revokeObjectURL(page.url);
            });
            const backToHymn = !this.creating && this.hymn;
            this.form = null;
            this.creating = false;
            this.view = backToHymn ? 'hymn' : 'list';
        },

        prints(index) {
            return HymnsPage.versionPrints(this.hymn, index);
        },

        draftPrints(index) {
            return HymnsPage.versionPrints({ versions: this.form.versions }, index);
        },

        pagesOf(version) {
            return HymnsPage.sheetPages(version);
        },

        async starVersion(index) {
            if (!this.canEdit || !this.hymn) return;
            const versions = HymnsPage.starVersions(this.hymn.versions || [], index);
            try {
                await firebase.firestore().collection('hymns').doc(this.hymn.id).update({ versions: versions });
                this.hymn = Object.assign({}, this.hymn, { versions: versions });
                const row = this.hymns.find((item) => item.id === this.hymn.id);
                if (row) row.versions = versions;
            } catch (err) {
                console.error(err);
                this.notice = 'Could not change which version prints.';
            }
        },

        starDraft(index) {
            this.form.versions = HymnsPage.starVersions(this.form.versions, index);
        },

        addVersion() {
            this.form.versions = HymnsPage.addFormVersion(this.form.versions, {
                id: 'version-' + Date.now() + Math.random(),
                name: '',
                pages: [],
            });
        },

        removeVersion(index) {
            this.form.versions = HymnsPage.removeFormVersion(this.form.versions, index);
        },

        addPage(vIndex) {
            this.form.versions[vIndex].pages.push({
                id: 'page-' + Date.now() + Math.random(),
                url: null,
                file: null,
            });
        },

        removePage(vIndex, pIndex) {
            const page = this.form.versions[vIndex].pages[pIndex];
            if (page && page.url && String(page.url).indexOf('blob:') === 0) URL.revokeObjectURL(page.url);
            this.form.versions[vIndex].pages.splice(pIndex, 1);
        },

        handleFileChange(event, vIndex, pIndex) {
            const file = event.target.files[0];
            if (!file) return;
            const page = this.form.versions[vIndex].pages[pIndex];
            page.file = file;
            if (page.url && String(page.url).indexOf('blob:') === 0) URL.revokeObjectURL(page.url);
            page.url = URL.createObjectURL(file);
        },

        updateSuggestions() {
            const val = this.tagInput.trim().toLowerCase();
            this.suggestions = val
                ? this.allTags.filter((tag) => tag.toLowerCase().includes(val) && !this.form.tags.includes(tag))
                : [];
        },

        addTag() {
            const val = this.tagInput.trim();
            if (!val) return;
            const match = this.allTags.find((tag) => tag.toLowerCase() === val.toLowerCase());
            const finalTag = match || val;
            if (!this.form.tags.includes(finalTag)) this.form.tags.push(finalTag);
            this.tagInput = '';
            this.suggestions = [];
        },

        addTagFromSuggestion(tag) {
            this.tagInput = tag;
            this.addTag();
        },

        handleBackspace() {
            if (this.tagInput === '' && this.form.tags.length > 0) this.form.tags.pop();
        },

        removeTag(tag) {
            this.form.tags = this.form.tags.filter((item) => item !== tag);
        },

        openCropper(vIndex, pIndex) {
            const page = this.form.versions[vIndex].pages[pIndex];
            if (!page || !page.url) return;
            this.cropModal = {
                open: true, vIndex: vIndex, pIndex: pIndex, imgSrc: page.url,
                naturalW: 0, naturalH: 0, rect: null, drag: null,
            };
        },

        cropImageLoaded(e) {
            const el = e.target;
            this.cropModal.naturalW = el.naturalWidth;
            this.cropModal.naturalH = el.naturalHeight;
            this.cropModal.rect = { x: 0, y: 0, w: el.clientWidth, h: el.clientHeight };
        },

        cropDragStart(mode, e) {
            e.preventDefault();
            const el = document.getElementById('crop-target-img');
            if (!el || !this.cropModal.rect) return;
            const box = el.getBoundingClientRect();
            this.cropModal.drag = {
                mode: mode, boxW: box.width, boxH: box.height,
                startX: e.clientX - box.left, startY: e.clientY - box.top,
                startRect: Object.assign({}, this.cropModal.rect),
            };
        },

        cropDragMove(e) {
            const drag = this.cropModal.drag;
            if (!drag) return;
            const el = document.getElementById('crop-target-img');
            if (!el) return;
            const box = el.getBoundingClientRect();
            const x = Math.min(Math.max(e.clientX - box.left, 0), drag.boxW);
            const y = Math.min(Math.max(e.clientY - box.top, 0), drag.boxH);
            const dx = x - drag.startX;
            const dy = y - drag.startY;
            const MIN = 24;
            if (drag.mode === 'move') {
                this.cropModal.rect = {
                    x: Math.min(Math.max(drag.startRect.x + dx, 0), drag.boxW - drag.startRect.w),
                    y: Math.min(Math.max(drag.startRect.y + dy, 0), drag.boxH - drag.startRect.h),
                    w: drag.startRect.w, h: drag.startRect.h,
                };
                return;
            }
            let left = drag.startRect.x, top = drag.startRect.y;
            let right = drag.startRect.x + drag.startRect.w, bottom = drag.startRect.y + drag.startRect.h;
            if (drag.mode.indexOf('w') !== -1) left = Math.min(Math.max(drag.startRect.x + dx, 0), right - MIN);
            if (drag.mode.indexOf('e') !== -1) right = Math.max(Math.min(right + dx, drag.boxW), left + MIN);
            if (drag.mode.indexOf('n') !== -1) top = Math.min(Math.max(drag.startRect.y + dy, 0), bottom - MIN);
            if (drag.mode.indexOf('s') !== -1) bottom = Math.max(Math.min(bottom + dy, drag.boxH), top + MIN);
            this.cropModal.rect = { x: left, y: top, w: right - left, h: bottom - top };
        },

        cropDragEnd() {
            this.cropModal.drag = null;
        },

        cancelCrop() {
            this.cropModal.open = false;
        },

        async _loadCropSource(src) {
            const res = await fetch(src);
            if (!res.ok) throw new Error('Could not read that image.');
            const blob = await res.blob();
            return createImageBitmap(blob);
        },

        async applyCrop() {
            const modal = this.cropModal;
            if (!modal.rect || modal.rect.w < 4 || modal.rect.h < 4) { this.cancelCrop(); return; }
            const version = this.form && this.form.versions[modal.vIndex];
            const target = version && version.pages[modal.pIndex];
            if (!target) {
                this.notice = 'That sheet page is no longer open for editing.';
                this.cancelCrop();
                return;
            }
            const displayedEl = document.getElementById('crop-target-img');
            if (!displayedEl || !displayedEl.clientWidth || !displayedEl.clientHeight) {
                this.notice = 'Could not read the crop area. Reopen the cropper and try again.';
                this.cancelCrop();
                return;
            }
            const scaleX = modal.naturalW / displayedEl.clientWidth;
            const scaleY = modal.naturalH / displayedEl.clientHeight;
            const sx = Math.round(modal.rect.x * scaleX);
            const sy = Math.round(modal.rect.y * scaleY);
            const sw = Math.max(1, Math.round(modal.rect.w * scaleX));
            const sh = Math.max(1, Math.round(modal.rect.h * scaleY));
            let blob;
            try {
                const bitmap = await this._loadCropSource(modal.imgSrc);
                const canvas = document.createElement('canvas');
                canvas.width = sw;
                canvas.height = sh;
                canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
                bitmap.close();
                blob = await new Promise((resolve, reject) => canvas.toBlob(
                    (exported) => exported ? resolve(exported) : reject(new Error('The browser would not export the cropped image.')),
                    'image/jpeg', 0.92));
            } catch (err) {
                console.error(err);
                this.notice = 'Could not crop that image.';
                return;
            }
            if (target.url && String(target.url).indexOf('blob:') === 0) URL.revokeObjectURL(target.url);
            target.file = new File([blob], 'cropped-' + target.id + '.jpg', { type: 'image/jpeg' });
            target.url = URL.createObjectURL(blob);
            this.cropModal.open = false;
        },

        async copyAttribution() {
            const text = this.hymn && this.hymn.attribution;
            if (!text) {
                this.notice = 'This hymn has no attribution.';
                return;
            }
            try {
                await navigator.clipboard.writeText(text);
                this.notice = 'Attribution copied.';
            } catch (err) {
                console.error(err);
                this.notice = 'Could not copy the attribution.';
            }
        },

        async downloadPage(url, versionName, pageNumber) {
            const filename = HymnsPage.sheetFileName(this.hymn && this.hymn.hymn_name, versionName, pageNumber);
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(blobUrl);
            } catch (err) {
                console.error(err);
                this.notice = 'Could not download that page.';
            }
        },

        async deleteHymn() {
            if (!this.canEdit || !this.hymn) return;
            if (!confirm('Delete this hymn? The sheets stored for it go with it.')) return;
            const storage = firebase.storage();
            const urls = [];
            (this.hymn.versions || []).forEach((version) => {
                (version.pages || []).forEach((url) => { if (url) urls.push(url); });
            });
            try {
                await Promise.all(urls.map((url) => storage.refFromURL(url).delete().catch(() => {})));
                await firebase.firestore().collection('hymns').doc(this.hymn.id).delete();
                this.hymns = this.hymns.filter((item) => item.id !== this.hymn.id);
                this.hymn = null;
                this.view = 'list';
                this.notice = 'Hymn deleted.';
            } catch (err) {
                console.error(err);
                this.notice = 'Could not delete that hymn.';
            }
        },

        async handleSubmit() {
            if (!this.canEdit || !this.form) return;
            if (HymnsPage.duplicateTitle(this.hymns, this.form.hymn_name, this.creating)) {
                this.notice = 'A hymn with this name already exists.';
                return;
            }
            this.isSubmitting = true;
            this.notice = '';
            try {
                const db = firebase.firestore();
                const storage = firebase.storage();
                const fresh = HymnsPage.newTags(this.allTags, this.form.tags);
                if (fresh.length) {
                    await Promise.all(fresh.map((tag) => db.collection('tags').doc(tag).set({
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    })));
                    this.allTags = this.allTags.concat(fresh).sort();
                }

                const folder = storage.ref().child(this.form.hymn_name);
                const uploaded = [];
                for (const version of this.form.versions) {
                    const pages = [];
                    for (const page of version.pages) {
                        if (page.file) {
                            const snap = await folder.child(page.file.name).put(page.file);
                            pages.push({ url: await snap.ref.getDownloadURL() });
                        } else if (page.url && String(page.url).indexOf('blob:') !== 0) {
                            pages.push({ url: page.url });
                        }
                    }
                    uploaded.push({ name: version.name, default: version.default === true, pages: pages });
                }
                const stored = HymnsPage.catalogVersions(uploaded);
                const payload = {
                    hymn_name: this.form.hymn_name,
                    music_writer: this.form.music_writer,
                    lyrics_writer: this.form.lyrics_writer,
                    attribution: this.form.attribution,
                    tags: this.form.tags.slice(),
                    versions: stored,
                };
                let id = this.hymn && this.hymn.id;
                if (this.creating) {
                    payload.last_played_date = '';
                    const ref = await db.collection('hymns').add(payload);
                    id = ref.id;
                } else {
                    await db.collection('hymns').doc(id).update(payload);
                    const kept = [];
                    stored.forEach((version) => version.pages.forEach((url) => kept.push(url)));
                    const drop = this.originalPageUrls.filter((url) => kept.indexOf(url) === -1);
                    for (const url of drop) {
                        try { await storage.refFromURL(url).delete(); } catch (e) { /* already gone */ }
                    }
                }
                await this.loadHymns();
                const saved = this.hymns.find((item) => item.id === id);
                this.form = null;
                this.creating = false;
                if (saved) this.showHymn(saved);
                else this.view = 'list';
                this.notice = 'Saved.';
            } catch (err) {
                console.error(err);
                this.notice = (err && err.message) ? err.message : 'Could not save that hymn.';
            } finally {
                this.isSubmitting = false;
            }
        },
    }));
});
