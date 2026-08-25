// MCP Manager — where editors write the guidance an assistant reads, and see
// what the MCP server actually offers (MS-262).
//
// Two halves, and the split is the point:
//
//   GUIDANCE (editable) — the church's standing instructions for building an
//   Order of Service. Not data about a Sunday: the knowledge an editor would
//   otherwise repeat in every conversation.
//
//   CAPABILITIES (read-only) — what the server can do. ⚠ FETCHED FROM THE
//   SERVER, NEVER LISTED HERE. A hand-written list on this page would be
//   wrong the first time somebody added a tool and forgot it, and a screen
//   that confidently describes capabilities the server does not have is worse
//   than no screen. The callable asks a real MCP server, so what is drawn is
//   by construction what an assistant sees.

function mcpManager() {
    return {
        // ── State ────────────────────────────────────────────────────────
        ready: false,
        canEdit: false,
        refused: false,

        files: [],
        selectedId: null,
        draft: null,
        problems: [],
        saving: false,
        dirty: false,

        capabilities: null,
        capabilitiesError: '',
        loadingCapabilities: false,

        // Which half is showing on a narrow screen.
        tab: 'guidance',

        // ── Setup ────────────────────────────────────────────────────────
        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user || user.isAnonymous) {
                    window.location.href = 'login.html';
                    return;
                }
                let level = 'viewer';
                try {
                    const userData = await getUserData(user.uid);
                    level = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                } catch (e) {
                    console.error('Could not read your permissions:', e);
                }

                // ⚠ REFUSED BEFORE ANYTHING IS READ. Whoever can write a
                // guidance file can steer the assistant, so this screen is
                // gated on the same rung that can already rewrite a Sunday.
                // The rules enforce it too — a hidden page is not a lock.
                this.canEdit = ['editor', 'elder', 'admin', 'super_admin'].includes(level);
                if (!this.canEdit) {
                    this.refused = true;
                    this.ready = true;
                    return;
                }

                await Promise.all([this.loadFiles(), this.loadCapabilities()]);
                this.ready = true;
            });

            // Leaving with unsaved words in the box loses them, and a
            // guidance file is writing rather than a form.
            window.addEventListener('beforeunload', (e) => {
                if (!this.dirty) return;
                e.preventDefault();
                e.returnValue = '';
            });
        },

        // ── Guidance files ───────────────────────────────────────────────
        async loadFiles() {
            try {
                const snap = await db.collection('mcp_guidance').get();
                this.files = snap.docs
                    .map(d => Object.assign({id: d.id}, d.data()))
                    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            } catch (e) {
                console.error('Could not load the guidance files:', e);
                this.files = [];
            }
        },

        newFile() {
            if (!this.confirmDiscard()) return;
            this.selectedId = null;
            this.draft = {
                title: '', slug: '', summary: '', body: '', enabled: true,
            };
            this.problems = [];
            this.dirty = false;
            this.tab = 'guidance';
        },

        select(file) {
            if (!this.confirmDiscard()) return;
            this.selectedId = file.id;
            this.draft = {
                title: file.title || '',
                slug: file.slug || '',
                summary: file.summary || '',
                body: file.body || '',
                enabled: file.enabled !== false,
            };
            this.problems = [];
            this.dirty = false;
        },

        confirmDiscard() {
            if (!this.dirty) return true;
            return confirm('You have unsaved changes. Discard them?');
        },

        markDirty() {
            this.dirty = true;
        },

        // The address is derived from the title while a file is NEW, and left
        // alone once it exists. An assistant may have been told to read a
        // particular address, so renaming a title must not silently move it.
        onTitleInput() {
            this.markDirty();
            if (!this.selectedId && this.draft) {
                this.draft.slug = McpGuidanceCore.slugify(this.draft.title);
            }
        },

        get slugLocked() {
            return !!this.selectedId;
        },

        get uriPreview() {
            if (!this.draft || !this.draft.slug) return '';
            return McpGuidanceCore.uriFor(this.draft.slug);
        },

        async save() {
            if (!this.draft || this.saving) return;

            const clean = McpGuidanceCore.normalize(this.draft);
            this.problems = McpGuidanceCore.validate(clean);
            if (this.problems.length) return;

            // Two files at one address means an assistant asking for it gets
            // whichever Firestore happens to return. Caught here rather than
            // left to chance.
            const clash = this.files.find(
                f => f.slug === clean.slug && f.id !== this.selectedId);
            if (clash) {
                this.problems = [
                    `"${clash.title}" already uses the address "${clean.slug}". ` +
                    'Give this one a different address.',
                ];
                return;
            }

            this.saving = true;
            try {
                const user = auth.currentUser;
                const record = Object.assign({}, clean, {
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedByUid: user ? user.uid : null,
                    updatedByName: (this.currentPersonName || (user && user.email)) || null,
                });

                if (this.selectedId) {
                    await db.collection('mcp_guidance').doc(this.selectedId).update(record);
                } else {
                    const ref = await db.collection('mcp_guidance').add(record);
                    this.selectedId = ref.id;
                }
                this.dirty = false;
                await this.loadFiles();
            } catch (e) {
                console.error('Could not save:', e);
                this.problems = ['Could not save. ' + (e.message || '')];
            } finally {
                this.saving = false;
            }
        },

        async toggleEnabled(file) {
            const turningOff = file.enabled !== false;
            if (turningOff && !confirm(
                `Switch off "${file.title}"?\n\nThe assistant will stop being ` +
                'able to read it — including by its address, not just in the list.')) {
                return;
            }
            try {
                await db.collection('mcp_guidance').doc(file.id)
                    .update({enabled: !turningOff});
                await this.loadFiles();
                if (this.selectedId === file.id && this.draft) {
                    this.draft.enabled = !turningOff;
                }
            } catch (e) {
                console.error('Could not change that:', e);
                alert('Could not change that.');
            }
        },

        async remove(file) {
            if (!confirm(
                `Delete "${file.title}"?\n\nThis cannot be undone. If you only ` +
                'want the assistant to stop reading it, switch it off instead.')) {
                return;
            }
            try {
                await db.collection('mcp_guidance').doc(file.id).delete();
                if (this.selectedId === file.id) {
                    this.selectedId = null;
                    this.draft = null;
                    this.dirty = false;
                }
                await this.loadFiles();
            } catch (e) {
                console.error('Could not delete:', e);
                alert('Could not delete that.');
            }
        },

        get enabledCount() {
            return this.files.filter(f => f.enabled !== false).length;
        },

        // ── What the server offers ───────────────────────────────────────
        async loadCapabilities() {
            this.loadingCapabilities = true;
            this.capabilitiesError = '';
            try {
                const call = firebase.functions().httpsCallable('mcpCapabilities');
                const res = await call({});
                this.capabilities = res.data;
            } catch (e) {
                console.error('Could not read what the MCP offers:', e);
                // Said plainly rather than drawn as an empty list: "the server
                // offers nothing" and "we could not ask" look identical on a
                // screen and mean opposite things.
                this.capabilitiesError =
                    'Could not reach the MCP server to ask what it offers. ' +
                    'This does not mean it is down — only that this page could not ask.';
            } finally {
                this.loadingCapabilities = false;
            }
        },

        get writeTools() {
            return ((this.capabilities && this.capabilities.tools) || [])
                .filter(t => t.writes);
        },

        get readTools() {
            return ((this.capabilities && this.capabilities.tools) || [])
                .filter(t => !t.writes);
        },

        // A tool name reads better as words in a list than as a symbol.
        prettyToolName(name) {
            return String(name || '')
                .replace(/^oos_/, '')
                .replace(/_/g, ' ')
                .replace(/^./, c => c.toUpperCase());
        },
    };
}

// Exposed for Node-based tests; ignored in the browser.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {mcpManager};
}
