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

        history: [],
        loadingHistory: false,
        showHistory: false,

        capabilities: null,
        capabilitiesError: '',
        loadingCapabilities: false,

        // ⚠ THE SERVER'S ADDRESS IS ASKED FOR, NEVER WRITTEN DOWN HERE. It is
        // what an editor pastes into their assistant, and the origin it lives
        // at is decided once, in functions/index.js. A copy kept in this file
        // would be a second place for it to be right — and the failure of a
        // wrong one is silent: the editor pastes it, the assistant cannot
        // connect, and nothing on this page looks broken.
        endpoint: '',
        copied: false,

        // Which half is showing.
        tab: 'guidance',

        // On a phone the pane REPLACES the list rather than sitting under it,
        // so the page has to know which of the two you are looking at. `.m-split`
        // deliberately has no opinion about that.
        phonePane: false,

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
            this.history = [];
            this.showHistory = false;
            this.tab = 'guidance';
            this.phonePane = true;
        },

        select(file) {
            if (!this.confirmDiscard()) return;
            this.phonePane = true;
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
            this.loadHistory();
        },

        confirmDiscard() {
            if (!this.dirty) return true;
            return confirm('You have unsaved changes. Discard them?');
        },

        // Back to the list on a phone. The unsaved check is the same one
        // picking another file gets — leaving by the arrow loses just as much.
        backToList() {
            if (!this.confirmDiscard()) return;
            this.dirty = false;
            this.phonePane = false;
        },

        markDirty() {
            this.dirty = true;
        },

        // Not a limit, a sense of length. Guidance that has grown past a
        // screenful is usually two files.
        get wordCount() {
            const words = ((this.draft && this.draft.body) || '')
                .trim().split(/\s+/).filter(Boolean).length;
            return words + (words === 1 ? ' word' : ' words');
        },

        async copyAddress() {
            if (!this.endpoint) return;
            try {
                await navigator.clipboard.writeText(this.endpoint);
                this.copied = true;
                clearTimeout(this._copyTimer);
                this._copyTimer = setTimeout(() => { this.copied = false; }, 2000);
            } catch (e) {
                // Clipboard access can simply be refused. Saying so beats a
                // button that looks like it worked.
                alert('Could not copy it. The address is:\n\n' + this.endpoint);
            }
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
                    // Stamped explicitly rather than left to the trigger's
                    // default: "who" and "through which door" are different
                    // questions, and the history answers both.
                    updatedVia: 'page',
                });

                if (this.selectedId) {
                    await db.collection('mcp_guidance').doc(this.selectedId).update(record);
                } else {
                    const ref = await db.collection('mcp_guidance').add(record);
                    this.selectedId = ref.id;
                }
                this.dirty = false;
                await this.loadFiles();
                // The trigger files the version a moment after the write, so
                // this can race it. A refresh button below covers that rather
                // than a guessed delay.
                await this.loadHistory();
            } catch (e) {
                console.error('Could not save:', e);
                this.problems = ['Could not save. ' + (e.message || '')];
            } finally {
                this.saving = false;
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
                    // On a phone the pane was the whole screen; with nothing
                    // open there is nothing to look at but the list.
                    this.phonePane = false;
                }
                await this.loadFiles();
            } catch (e) {
                console.error('Could not delete:', e);
                alert('Could not delete that.');
            }
        },

        // ── History ──────────────────────────────────────────────────────
        //
        // ⚠ THIS IS WHAT MAKES LETTING THE ASSISTANT WRITE GUIDANCE SAFE.
        // A guidance edit changes how the assistant behaves on every Sunday
        // from then on, and nobody reads this page weekly. The protection is
        // not that a bad edit cannot happen — it is that it cannot happen
        // quietly or permanently.
        async loadHistory() {
            if (!this.selectedId) {
                this.history = [];
                return;
            }
            this.loadingHistory = true;
            try {
                const snap = await db.collection('mcp_guidance')
                    .doc(this.selectedId)
                    .collection('versions')
                    .orderBy('savedAt', 'desc')
                    .limit(50)
                    .get();
                this.history = snap.docs.map(d => Object.assign({id: d.id}, d.data()));
            } catch (e) {
                console.error('Could not load the history:', e);
                this.history = [];
            } finally {
                this.loadingHistory = false;
            }
        },

        whenSaved(version) {
            const at = version && version.savedAt;
            if (!at || !at.toDate) return 'just now';
            return at.toDate().toLocaleString();
        },

        // Who, and through which door. The same person editing on the page
        // and steering the assistant are different events worth telling apart.
        whoSaved(version) {
            const who = (version && version.savedByName) || 'Someone';
            const via = version && version.savedVia;
            if (via === 'assistant') return `${who}, via the assistant`;
            if (via === 'restore') return `${who} put an older version back`;
            return who;
        },

        // A version differing from what is on screen is the interesting kind.
        isCurrent(version) {
            return this.draft ? McpGuidanceCore.sameContent(version, this.draft) : false;
        },

        async restore(version) {
            if (!confirm(
                `Put this version back?

Saved ${this.whenSaved(version)} by ` +
                `${this.whoSaved(version)}.

The current wording is not lost — ` +
                'it stays in the history, so you can undo this too.')) {
                return;
            }
            try {
                const call = firebase.functions().httpsCallable('restoreGuidanceVersion');
                await call({fileId: this.selectedId, versionId: version.id});
                await this.loadFiles();
                const file = this.files.find(f => f.id === this.selectedId);
                if (file) {
                    this.dirty = false;
                    this.select(file);
                }
            } catch (e) {
                console.error('Could not restore:', e);
                alert('Could not put that version back. ' + (e.message || ''));
            }
        },

        // ── What the server offers ───────────────────────────────────────
        async loadCapabilities() {
            this.loadingCapabilities = true;
            this.capabilitiesError = '';
            try {
                const call = firebase.functions().httpsCallable('mcpCapabilities');
                const res = await call({});
                this.capabilities = res.data;
                // Empty rather than a guess if the server did not say. A
                // "Copy address" button that copies the wrong address is worse
                // than no button.
                this.endpoint = (res.data && res.data.server &&
                    res.data.server.endpoint) || '';
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
