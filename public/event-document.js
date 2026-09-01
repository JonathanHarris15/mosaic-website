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
    // The picture-shrinking the Service Guide already does: a ladder of sizes
    // and qualities tried until one comes under a byte budget.
    const ImageCore = window.GuideImageCore;

    const params = new URLSearchParams(window.location.search);
    const OCCURRENCE_ID = params.get('occurrence') || '';
    const DOCUMENT_ID = params.get('id') || '';

    // Long enough that a sentence typed at speed is one write, short enough
    // that closing the laptop mid-thought does not lose it. Matches the Elder
    // Document editor rather than inventing a second answer.
    const SAVE_DEBOUNCE_MS = 1500;

    let editor = null;
    let saveTimer = null;

    // ⚠ KEPT OUT OF ALPINE STATE ON PURPOSE. Alpine wraps state in a proxy, and
    // a proxied File is no longer a File to FileReader — the brand check fails
    // and the read throws. Only what the dialog needs to SAY goes into state.
    let pendingImageFile = null;

    function describeBytes(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
        return (Math.round(n / (1024 * 1024) * 10) / 10) + ' MB';
    }

    window.eventDocumentPage = function eventDocumentPage() {
        return {
            loading: true,
            // Fatal only: the document could not be opened at all, so there is
            // nothing to show. Anything the page can carry on from goes in
            // `notice` — setting `error` for a picture that was too big took
            // the whole document off the screen, which is a worse thing than
            // the picture not going in.
            error: '',
            notice: '',

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
            insertingImage: false,
            // What the "shall I shrink it?" dialog is about, or null for none.
            pendingImage: null,

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
                    Image, Link, TextAlign,
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
                        Image.configure({ inline: false, allowBase64: true }),
                        Link.configure({ openOnClick: false, autolink: true }),
                        TextAlign.configure({ types: ['heading', 'paragraph'] }),
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
                if (!editor) return false;
                // TipTap takes either a node name or a bare bag of attributes —
                // alignment is the second kind, since it is an attribute of
                // whatever block the cursor happens to be in.
                return typeof name === 'object'
                    ? editor.isActive(name)
                    : editor.isActive(name, attrs || {});
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

            // ── Links ────────────────────────────────────────────────────────
            //
            // A prompt rather than a bespoke popover. This is the least
            // interesting part of the editor and a panel would be the most code
            // in it.
            setLink() {
                if (!editor || !this.isEditor) return;
                const existing = editor.getAttributes('link').href || '';
                const entered = window.prompt('Link address', existing);
                if (entered === null) return;

                const href = String(entered).trim();
                if (!href) {
                    this.command(chain => chain.extendMarkRange('link').unsetLink().run());
                    return;
                }
                // A bare address is meant as a web address. Without this,
                // "example.org" becomes a link relative to this app.
                const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : 'https://' + href;
                if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
                    this.notice = 'A link has to be a web address or an email address.';
                    return;
                }
                this.command(chain => chain.extendMarkRange('link').setLink({ href: url }).run());
            },

            // ── A picture ────────────────────────────────────────────────────
            //
            // Read here and kept INSIDE the document as a data URI, never
            // uploaded. That means it is governed by the Event's own visibility
            // rule with nothing else to get wrong, and it is what makes a
            // picture survive the round trip out to Word and back.
            //
            // The cap is far smaller than an Event Attachment's 25MB, and for a
            // different reason: this rides in a Firestore document, which
            // cannot exceed 1MB in total, and base64 adds about a third to
            // whatever the file already weighs.
            chooseImage(event) {
                const file = event && event.target && event.target.files && event.target.files[0];
                if (event && event.target) event.target.value = '';
                if (file) this.insertImage(file);
            },

            // A picture that already fits goes straight in. One that does not
            // is NOT refused — it is offered a shrink. "Attach it as a file
            // instead" is not an answer to somebody who has just picked a photo,
            // and it certainly is not worth taking their document off the screen
            // to say it.
            insertImage(file) {
                if (!editor || !this.isEditor) return;
                this.notice = '';

                const check = ImageCore.validateImageFile(file);
                if (!check.ok) { this.notice = check.error; return; }

                if (!ImageCore.needsRedraw(file, ImageCore.BUDGET_BYTES)) {
                    this.placeImage(file);
                    return;
                }

                pendingImageFile = file;
                this.pendingImage = { name: file.name, size: describeBytes(file.size) };
            },

            confirmImageShrink() {
                const file = pendingImageFile;
                this.pendingImage = null;
                pendingImageFile = null;
                if (file) this.placeImage(file);
            },

            cancelImage() {
                this.pendingImage = null;
                pendingImageFile = null;
            },

            // Shrinks only when it has to — a picture already under budget keeps
            // its own bytes, so a PNG logo is not re-encoded as a JPEG and left
            // with white behind its transparency.
            async placeImage(file) {
                this.insertingImage = true;
                try {
                    const dataUrl = await ImageCore.capToDataUrl(file, ImageCore.BUDGET_BYTES);
                    this.command(chain => chain.setImage({ src: dataUrl, alt: file.name }).run());
                    this.saveStatus = 'unsaved';
                    this.queueSave();
                } catch (e) {
                    console.error('Could not read that picture:', e);
                    this.notice = 'That picture could not be read.';
                } finally {
                    this.insertingImage = false;
                }
            },

            setAlign(align) {
                this.command(chain => align
                    ? chain.setTextAlign(align).run()
                    : chain.unsetTextAlign().run());
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
                    this.notice = 'That would not turn into a Word file. Try again.';
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
                    this.notice = 'That Word file could not be read.';
                } finally {
                    this.importingWord = false;
                }
            },
        };
    };
})();
