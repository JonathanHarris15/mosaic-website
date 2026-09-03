// A Form Document, open (MS-386).
//
// The other half of MS-362. A `document`-mode Form Template is filled in ONCE,
// and the filled-in thing IS the record — an Elder Interview, not a poll. This
// is the page it is filled in on.
//
// ⚠ IT KEEPS THE FORM'S STRUCTURE, AND THAT IS THE WHOLE POINT. The cheap
// version of this feature would have poured the template's headings into an
// ordinary document body as prose and let somebody type underneath. A date
// question would have stopped being a date control, a multiple choice would
// have stopped showing the options nobody picked, and changing an answer later
// would have meant editing text. Those are the reasons somebody wanted a
// template rather than a blank page, so every question stays its own control.
//
// The controls themselves are `form-question-markup.js`, drawn identically on
// the page a stranger answers a public form on (MS-383). This page owns only
// what is different: it is always editable, it reads from Firestore rather than
// through the public Cloud Function (ADR-0051), and it saves itself.
//
// ⚠ IT DRAWS ITS OWN QUESTIONS, NEVER ITS TEMPLATE'S (ADR-0055). The questions
// were copied when the document was created. Reading them back off the template
// here would undo that in one line and let an edit reach into interviews
// already written.

function formDocumentPage() {
    return {
        loading: true,
        problem: '',
        docId: '',
        doc: null,
        title: '',
        questions: [],
        answers: {},
        saveStatus: 'saved',
        personQueries: {},
        directory: [],
        fileFaults: {},
        currentUserName: '',
        _saveTimer: null,

        get inShell() {
            return new URLSearchParams(location.search).get('shell') === 'mobile'
                || window.MOSAIC_SHELL === 'mobile';
        },

        get backHref() {
            return 'shepherding-documents.html' + (this.inShell ? '?shell=mobile' : '');
        },

        // Questions are numbered by how many QUESTIONS came before them. A
        // section heading in the middle must not turn question 4 into question 5.
        numberFor(index) {
            let n = 0;
            for (let i = 0; i <= index && i < this.questions.length; i += 1) {
                if (FormsCore.asksSomething(this.questions[i].type)) n += 1;
            }
            return n;
        },

        asks(q) { return FormsCore.asksSomething(q && q.type); },

        scalePoints(q) { return FormsCore.scalePoints(q && q.scale); },

        // Owed to the shared question markup. A fill-in page uses it to mark
        // what somebody answered last time; a document has no "last time" —
        // there is one answer and it is the current one.
        saidBefore() { return false; },

        // ── The three that reach outside the form ────────────────────────────
        //
        // The shared markup draws these, so this page owes them whether or not
        // a given template uses them. A missing one is a question that silently
        // does nothing.

        // A Directory Person picker. Read straight from Firestore here, unlike
        // the public fill-in page: whoever has a Form Document open is a signed-in
        // elder, so there is no closed door to go through and no scope to apply
        // on a server that is not involved.
        personChoices(q) {
            const typed = String(this.personQueries[q.id] || '').trim().toLowerCase();
            if (!typed) return [];
            const scope = (q.people && q.people.scope) || 'everyone';
            const tagId = q.people && q.people.tagId;
            return this.directory.filter(p => {
                if (!String(p.name || '').toLowerCase().includes(typed)) return false;
                if (scope === 'member') return p.isMember === true;
                if (scope === 'non_member') return p.isMember !== true;
                if (scope === 'tag') return (p.tagIds || []).includes(tagId);
                return true;
            }).slice(0, 8);
        },

        pickPerson(q, person) {
            this.answers[q.id] = person ? { personId: person.id, name: person.name } : null;
            this.personQueries[q.id] = '';
            this.touch();
        },

        // ⚠ An upload on a Form Document does not work yet, and says so rather
        // than failing quietly.
        //
        // The public fill-in page sends its bytes through the publicForm
        // function, which writes them past storage.rules with admin credentials
        // (ADR-0051). This page has no such door: it writes as a signed-in
        // elder, and the upload path is `write: if false` for every client.
        // Giving a document its own upload route is a real ticket — either a
        // second function or a rule that can tell a Form Document from anything
        // else — and guessing at it here would be the weakest version of both.
        onFileChosen(q) {
            this.fileFaults[q.id] = 'Files cannot be attached to a document yet. ' +
                'Use a form people answer by link, or write the detail into a paragraph question.';
        },

        uploadFault(q) { return this.fileFaults[q.id] || ''; },

        clearUpload(q) {
            this.answers[q.id] = null;
            this.fileFaults[q.id] = '';
        },

        loadDirectory() {
            const wantsPeople = this.questions.some(q => q.type === 'person');
            if (!wantsPeople) return;
            db.collection('people').orderBy('name', 'asc').get().then(snap => {
                this.directory = snap.docs.map(doc => {
                    const d = doc.data() || {};
                    return {
                        id: doc.id,
                        name: d.name || 'Unnamed',
                        isMember: d.isMember === true || d.membershipStage === 'member',
                        tagIds: d.tagIds || [],
                    };
                });
            }).catch(() => { this.directory = []; });
        },

        get answeredCount() {
            return this.questions.filter(q => this.asks(q) && this.hasAnswer(q)).length;
        },

        get askedCount() {
            return this.questions.filter(q => this.asks(q)).length;
        },

        hasAnswer(q) {
            const v = this.answers[q.id];
            if (Array.isArray(v)) return v.length > 0;
            return v != null && String(v).trim() !== '';
        },

        // Read rather than "unanswered", because nothing here is required. A
        // half-filled interview is an ordinary thing, not a warning.
        get progressLine() {
            const asked = this.askedCount;
            if (!asked) return 'No questions on this one.';
            return this.answeredCount + ' of ' + asked + ' filled in';
        },

        async init() {
            this.docId = new URLSearchParams(location.search).get('id') || '';
            if (!this.docId) {
                this.problem = 'No document was asked for.';
                this.loading = false;
                return;
            }
            auth.onAuthStateChanged(async (user) => {
                if (!user) { window.location.href = 'index.html'; return; }
                try {
                    const userData = await getUserData(user.uid);
                    this.currentUserName = (userData && userData.name) || user.displayName || user.email || 'Somebody';

                    const snap = await db.collection('elder_documents').doc(this.docId).get();
                    if (!snap.exists) {
                        this.problem = 'That document no longer exists.';
                        return;
                    }
                    const data = snap.data();
                    this.doc = data;
                    this.title = data.title || '';
                    // The document's OWN questions. Never the template's.
                    this.questions = Array.isArray(data.questions) ? data.questions : [];
                    this.answers = Object.assign({}, data.answers || {});
                    this.readyForLists();
                    this.loadDirectory();
                } catch (e) {
                    this.problem = 'That did not load. Check your connection and refresh.';
                } finally {
                    this.loading = false;
                }
            });
        },

        // A select-all answer is a list, and it has to already BE one before the
        // first box is ticked — binding a checkbox group pushes into an array
        // and does not make one.
        readyForLists() {
            this.questions.forEach(q => {
                if (q.type === 'choice_many' && !Array.isArray(this.answers[q.id])) {
                    this.answers[q.id] = [];
                }
            });
        },

        // ── Saving ───────────────────────────────────────────────────────────
        //
        // The document editor's saving, not a third behaviour invented here:
        // the same 1.5s debounce and the same three states the Care List and
        // the Elder Document both show (ADR-0032). A failed save says so and
        // keeps what is on screen — nothing typed is ever thrown away to make
        // the indicator tidy.

        touch() {
            this.saveStatus = 'unsaved';
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.save(), 1500);
        },

        onTitleInput() { this.touch(); },

        async save() {
            if (!this.docId) return;
            this.saveStatus = 'saving';
            try {
                await db.collection('elder_documents').doc(this.docId).update({
                    title: this.title.trim() || 'Untitled',
                    // Only the answers move. The questions are the record's own
                    // and are never rewritten from here.
                    answers: JSON.parse(JSON.stringify(this.answers)),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedByName: this.currentUserName,
                });
                this.saveStatus = 'saved';
            } catch (e) {
                console.error('Error saving form document:', e);
                this.saveStatus = 'unsaved';
                this.problem = 'That did not save. What is on screen is still here — try again in a moment.';
            }
        },
    };
}
