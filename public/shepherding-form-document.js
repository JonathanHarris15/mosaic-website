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
