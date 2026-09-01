// One Event Document, one screen — a document written here and belonging to one
// Event occurrence (ADR-0049).
//
// The same Note Body as everything else in this app, the same editor, the same
// Word import and export. What differs from an Elder Document is the two things
// ADR-0049 says are allowed to differ:
//
//   • WHERE IT HANGS — `event_occurrences/{id}/documents/{id}`, so the Event's
//     own visibility rule governs it with no second sharing switch to get wrong.
//
//   • WHO MAY WRITE IT — an editor. Anyone who can see the Event can read it,
//     and for them the editor mounts read-only rather than the page having a
//     second way of drawing a document.
//
// ⚠ NO MENTION EXTENSION, AND ADDING ONE IS A DISCLOSURE.
// The @-mention picker offers Persons, Shepherding Notes, Elder Documents and
// Folders — every one of them elder-only. This page can be read by any member
// who can see the Event. A member typing `@` must not be handed a list of the
// congregation's pastoral records; the names in that list ARE the leak, whether
// or not the bodies are readable.

(function () {
    'use strict';

    const Store = window.EventsStore;
    const Body = window.DocumentBodyCore;

    const params = new URLSearchParams(window.location.search);
    const OCCURRENCE_ID = params.get('occurrence') || '';
    const DOCUMENT_ID = params.get('id') || '';

    // Long enough that a sentence typed at speed is one write, short enough
    // that closing the laptop mid-thought does not lose it. Matches the Elder
    // Document editor rather than inventing a second answer.
    const SAVE_DEBOUNCE_MS = 1500;

    let editor = null;
    let saveTimer = null;

    window.eventDocumentPage = function eventDocumentPage() {
        return {
            loading: true,
            error: '',

            rank: null,
            uid: null,
            // Stamped onto updatedByName, so a document says who touched it last.
            userName: null,

            occurrence: null,
            doc: null,
            title: '',

            saveStatus: 'saved',
            exportingWord: false,
            importingWord: false,

            // Redrawn whenever the selection moves, so the toolbar can show
            // what is true of the cursor. Alpine cannot watch inside TipTap.
            editorTick: 0,

            get isEditor() {
                return ['editor', 'admin', 'elder', 'super_admin'].indexOf(this.rank) !== -1;
            },

            get backHref() {
                return 'calendar-event.html?id=' + encodeURIComponent(OCCURRENCE_ID);
            },

            get eventName() {
                return (this.occurrence && this.occurrence.name) || 'the event';
            },

            async init() {
                if (!OCCURRENCE_ID || !DOCUMENT_ID) {
                    this.error = 'That link is missing which document to open.';
                    this.loading = false;
                    return;
                }
                await this.resolveViewer();
                await this.load();
            },

            resolveViewer() {
                return new Promise(resolve => {
                    auth.onAuthStateChanged(async user => {
                        if (!user) { this.rank = null; return resolve(); }
                        this.uid = user.uid;
                        try {
                            const data = await getUserData(user.uid);
                            this.rank = (data && (data.permissionLevel || data.role)) || 'viewer';
                            this.userName = (data && (data.displayName || data.name)) || null;
                        } catch (e) {
                            this.rank = 'viewer';
                        }
                        resolve();
                    });
                });
            },

            async load() {
                try {
                    // Both reads are gated by the same rule. A reader who may
                    // not see the Event gets a refusal here rather than an
                    // empty document, which is the honest outcome.
                    const [occurrence, document_] = await Promise.all([
                        Store.loadOccurrence(db, OCCURRENCE_ID),
                        Store.loadEventDocument(db, OCCURRENCE_ID, DOCUMENT_ID),
                    ]);
                    if (!document_) {
                        this.error = 'That document is not here any more.';
                        this.loading = false;
                        return;
                    }
                    this.occurrence = occurrence;
                    this.doc = document_;
                    this.title = document_.title || '';
                    this.loading = false;
                    await this.$nextTick();
                    await this.mountEditor();
                } catch (e) {
                    console.error('Could not open the document:', e);
                    this.error = 'That document could not be opened. You may no longer have access to it.';
                    this.loading = false;
                }
            },

            // ── The editor ───────────────────────────────────────────────────

            async mountEditor() {
                const el = document.getElementById('event-document-editor');
                if (!el) return;

                let TipTap;
                try {
                    // The vendored bundle, not esm.sh. See tiptap-editor-loader.js.
                    TipTap = await window.TiptapEditorLoader.ensureTipTap();
                } catch (e) {
                    console.error('The editor could not load:', e);
                    this.error = 'The editor could not load. Reload the page to try again.';
                    return;
                }

                const {
                    Editor, StarterKit, Underline, TextStyle, FontFamily, FontSize,
                    Highlight, Table, TableRow, TableHeader, TableCell,
                } = TipTap;

                const self = this;
                if (editor) { editor.destroy(); editor = null; }

                editor = new Editor({
                    element: el,
                    // A reader who is not an editor gets the same rendering as
                    // the person who wrote it, simply frozen. One drawing path,
                    // so a document can never look like two different documents.
                    editable: this.isEditor,
                    extensions: [
                        StarterKit,
                        Underline,
                        TextStyle,
                        FontFamily,
                        FontSize,
                        Highlight.configure({ multicolor: true }),
                        Table.configure({ resizable: false }),
                        TableRow,
                        TableHeader,
                        TableCell,
                        // ⚠ Mention is deliberately absent — see the note at the
                        // top of this file.
                    ],
                    content: this.doc.contentJson || Body.emptyBody(),
                    onUpdate() {
                        self.saveStatus = 'unsaved';
                        self.queueSave();
                    },
                    onSelectionUpdate() { self.editorTick++; },
                    onTransaction() { self.editorTick++; },
                });
            },

            // What the toolbar reads to know whether a button is lit. The tick
            // is touched so Alpine re-evaluates when the cursor moves.
            isActive(name, attrs) {
                this.editorTick;
                return !!editor && editor.isActive(name, attrs || {});
            },

            command(run) {
                if (!editor || !this.isEditor) return;
                run(editor.chain().focus());
                this.editorTick++;
            },

            toggle(name) {
                const method = 'toggle' + name.charAt(0).toUpperCase() + name.slice(1);
                this.command(chain => chain[method]().run());
            },

            setHeading(level) {
                this.command(chain => level
                    ? chain.toggleHeading({ level: level }).run()
                    : chain.setParagraph().run());
            },

            insertTable() {
                this.command(chain =>
                    chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run());
            },

            // ── Saving ───────────────────────────────────────────────────────

            queueSave() {
                clearTimeout(saveTimer);
                saveTimer = setTimeout(() => this.save(), SAVE_DEBOUNCE_MS);
            },

            // A PATCH, never a whole record. An autosave that wrote the full
            // shape would restate who created the document on every keystroke,
            // which is not this screen's to say.
            async save() {
                if (!this.isEditor || !editor) return;
                this.saveStatus = 'saving';
                try {
                    await Store.updateEventDocument(db, OCCURRENCE_ID, DOCUMENT_ID, {
                        title: Body.normaliseTitle(this.title),
                        contentJson: editor.getJSON(),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedByName: this.userName || null,
                    });
                    this.saveStatus = 'saved';
                } catch (e) {
                    console.error('Could not save the document:', e);
                    this.saveStatus = 'unsaved';
                }
            },

            onTitleInput() {
                if (!this.isEditor) return;
                this.saveStatus = 'unsaved';
                this.queueSave();
            },

            // ── Word, both ways ──────────────────────────────────────────────
            //
            // No panel bodies to fetch: a Person Panel is an Elder Document
            // thing, and this editor has no way to make one.

            async downloadAsWord() {
                if (this.exportingWord) return;
                this.exportingWord = true;
                try {
                    await DocumentDocx.downloadAsWord({
                        title: Body.normaliseTitle(this.title),
                        doc: editor ? editor.getJSON() : (this.doc && this.doc.contentJson),
                    });
                } catch (e) {
                    console.error('Word export failed:', e);
                    this.error = 'Could not make a Word file.';
                } finally {
                    this.exportingWord = false;
                }
            },

            chooseWordFile(event) {
                const file = event && event.target && event.target.files && event.target.files[0];
                if (event && event.target) event.target.value = '';
                if (file) this.importWordFile(file);
            },

            async importWordFile(file) {
                if (this.importingWord || !editor || !this.isEditor) return;
                this.importingWord = true;
                try {
                    const html = await DocumentDocx.wordFileToHtml(file);
                    // At the cursor, never over the top — the same rule the
                    // Elder Document editor follows, and for the same reason.
                    editor.chain().focus().insertContent(html).run();
                    this.saveStatus = 'unsaved';
                    this.queueSave();
                } catch (e) {
                    console.error('Word import failed:', e);
                    this.error = 'Could not read that Word file.';
                } finally {
                    this.importingWord = false;
                }
            },
        };
    };
})();
