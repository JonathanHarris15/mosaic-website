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
    // Kept outside Alpine: none of it is drawn (MS-486 / MS-487).
    const live = {
        session: null,   // FormDocumentCore session: what this page last saved or took in
        focus: null,     // the question id under the cursor
        inTitle: false,  // the cursor is in the title
        saving: null,    // the save on its way, if one is
        stops: [],       // what stops a live read or a ticker
    };
    const page = {
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
        currentUser: null,
        _saveTimer: null,
        // Presence (MS-487): everybody's claims, and a tick so a quiet hold is
        // redrawn as free without anybody writing anything.
        presenceEntries: [],
        presenceTick: 0,
        heldNotice: '',
        _heldTimer: null,

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
            this.touch(q);
        },

        // Whoever has a Form Document open is a signed-in elder, and an elder
        // is an editor by the rules' ladder — so the picker may offer to add
        // somebody who is not in the directory yet.
        canAddPerson: true,

        addPerson(q) {
            this.openNewPerson(q, this.personQueries[q.id]);
        },

        // The card gathered it; this writes it, as this elder, under the same
        // rule that governs the People manager. The same shape that manager
        // writes, so a Person added from here is not a second kind of Person.
        async createPerson(details) {
            const now = firebase.firestore.FieldValue.serverTimestamp();
            const ref = await db.collection('people').add({
                name: details.name,
                totalInvolvements: 0,
                contact: { email: details.email, phone: details.phone, address: details.address },
                birthday: details.birthday || null,
                sex: details.sex || null,
                lastPastoralPrayerDate: null,
                tags: [],
                createdAt: now,
                updatedAt: now,
            });
            // Into the list this page searches, so the picker can find them
            // without a reload — and so the answer that follows is a pick from
            // the directory like any other.
            const person = { id: ref.id, name: details.name, isMember: false, tagIds: [] };
            this.directory.push(person);
            return person;
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

        // Nothing to be busy with: this page never takes a file at all.
        busyWith() { return ''; },

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
                    this.currentUser = user;
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
                    // What this page last saved or took in (MS-486). Made before
                    // the empty lists below, which are no answer and never saved.
                    live.session = FormDocumentCore.createSession(data);
                    this.readyForLists();
                    this.loadDirectory();
                } catch (e) {
                    this.problem = 'That did not load. Check your connection and refresh.';
                } finally {
                    this.loading = false;
                }
                // Editing is open by here. Presence only ever takes a box away,
                // and if it fails every box stays open (ADR-0035 §3).
                if (live.session) {
                    this.watchDocument();
                    this.startPresence(user);
                }
            });
            if (typeof window !== 'undefined' && window.addEventListener) {
                window.addEventListener('pagehide', () => {
                    // Anything picked in the last second and a half goes first.
                    this.save();
                    live.stops.forEach(stop => { try { stop(); } catch (e) {} });
                    live.stops = [];
                    try { ShepherdingPresence.leave(); } catch (e) {}
                });
            }
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

        // ── Live (MS-486) ────────────────────────────────────────────────────
        //
        // The document is followed while it is open. An answer, the title or
        // where it is filed that somebody else changed arrives; an answer this
        // page has changed and not yet saved is left alone (FormDocumentCore).
        // Our own write echoing back before the server confirms it is skipped.
        watchDocument() {
            const ref = db.collection('elder_documents').doc(this.docId);
            const onNext = (snap) => {
                if (!snap) return;
                if (!snap.exists) { this.problem = 'This document was deleted.'; return; }
                if (snap.metadata && snap.metadata.hasPendingWrites) return;
                this.adoptRemote(snap.data());
            };
            const onError = (e) => console.warn('Lost the live connection to this document:', e);
            const Live = typeof MosaicLiveRead !== 'undefined' ? MosaicLiveRead : null;
            live.stops.push(Live
                ? Live.watch(ref, onNext, { fallbackEveryMs: Live.PERSON_EVERY_MS, onError })
                : ref.onSnapshot(onNext, onError));
        },

        adoptRemote(data) {
            if (!live.session || !data) return;
            const out = live.session.adopt(data, this.answers,
                { inQuestion: live.focus, inTitle: live.inTitle }, this.title);
            out.answers.forEach(a => { this.answers[a.questionId] = a.value; });
            this.readyForLists();
            if (out.title !== null) this.title = out.title;
            if (out.ownerPersonId !== undefined && this.doc) this.doc.ownerPersonId = out.ownerPersonId || null;
        },

        // ── Saving ───────────────────────────────────────────────────────────
        //
        // The document editor's saving, not a third behaviour invented here:
        // the same 1.5s debounce and the same three states the Care List and
        // the Elder Document both show (ADR-0032). A failed save says so and
        // keeps what is on screen — nothing typed is ever thrown away to make
        // the indicator tidy.
        //
        // It writes only the answers that changed, each to its own field, and
        // the title if it changed (MS-486) — never the whole map, which put
        // back every answer another elder or the assistant had saved since.

        // Every keystroke, pick or search in a question. False back from
        // presence means somebody took the question after you went quiet: the
        // stored answer goes back on screen and nothing is saved over theirs.
        touch(q) {
            if (q && live.session && typeof ShepherdingPresence !== 'undefined' && !ShepherdingPresence.touch()) {
                this.answers[q.id] = live.session.answer(q.id);
                this.readyForLists();
                this.sayHeld(this.questionHolder(q), 'question');
                return;
            }
            this.saveStatus = 'unsaved';
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.save(), 1500);
        },

        onTitleInput() {
            if (live.session && typeof ShepherdingPresence !== 'undefined' && !ShepherdingPresence.touch()) {
                this.title = live.session.title();
                this.sayHeld(this.titleHolder, 'title');
                return;
            }
            this.touch();
        },

        async save() {
            if (!this.docId || !live.session) return;
            clearTimeout(this._saveTimer);
            const edits = live.session.takeSave(this.answers, this.title);
            if (!edits.answers.length && edits.title === null) {
                if (!live.saving) this.saveStatus = 'saved';
                return;
            }
            this.saveStatus = 'saving';
            const saving = FormDocumentCore.saveEdits(db, firebase.firestore, this.docId, {
                answers: edits.answers,
                title: edits.title,
                byName: this.currentUserName,
            }).then(async () => {
                this.saveStatus = 'saved';
                // Only the save that changed who this is about re-files it.
                if (edits.subject) await this.refileForSubject(edits.subject);
            }, (e) => {
                console.error('Error saving form document:', e);
                live.session.saveFailed(edits);
                this.saveStatus = 'unsaved';
                this.problem = 'That did not save. What is on screen is still here — try again in a moment.';
            }).then(() => { if (live.saving === saving) live.saving = null; });
            live.saving = saving;
            await saving;
        },

        // ── Filed by its first answer (MS-405) ───────────────────────────────
        //
        // A personal shepherding document is an interview ABOUT somebody, and
        // it lives in two places at once: the Document Library, and the
        // Documents tab of the Shepherding Profile of whoever the first
        // question names. Answer that question and it appears there; change the
        // answer and it moves — off the old profile first, so it is never on
        // two (FormDocumentCore.refile).
        //
        // ⚠ IT READS THE ANSWER, NOT THE TEMPLATE. A document keeps a copy of
        // its questions and never looks at its template again (ADR-0055), so
        // the fact that this IS a shepherding document is stamped on the record
        // and the subject is read from the answers under a fixed id.
        //
        // ⚠ ONLY WHEN THIS PAGE'S OWN SAVE CHANGED THE SUBJECT (MS-486). A page
        // that heard somebody else change it takes in where it is now filed
        // and leaves the filing alone.
        //
        // The Library entry is never touched. It is in both places by
        // construction, so there is nothing here to opt into and nothing to
        // take away.
        get subjectPersonId() {
            return FormsCore.subjectPersonId({ answers: this.answers });
        },

        async refileForSubject(subject) {
            if (!(this.doc && this.doc.shepherdingDoc)) return;
            try {
                await FormDocumentCore.refile(db, ShepherdingDocsCore, this.docId, subject.before, subject.after);
                live.session.filedUnder(subject.after);
                this.doc.ownerPersonId = subject.after || null;
            } catch (e) {
                // The answer is saved either way — this is where the document
                // is SHOWN, not what it says. Saying so beats a silent miss.
                console.error('Error filing this document on a profile:', e);
                this.problem = 'Saved, but this did not reach their profile. ' +
                    'Change the first answer and back again to try that part once more.';
            }
        },

        // ── One person per question (MS-487) ────────────────────────────────
        //
        // Each question that asks something is a box, and so is the title.
        // Drawn by this page AROUND the shared question markup, never inside
        // it, so the public fill-in page a stranger answers is untouched.

        enterQuestion(q) {
            if (!q || !FormDocumentCore.isBox(q) || live.focus === q.id) return;
            if (typeof ShepherdingPresence === 'undefined') return;
            if (!ShepherdingPresence.claimBox(FormDocumentCore.box.question(this.docId, q.id))) {
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                this.sayHeld(this.questionHolder(q), 'question');
                return;
            }
            // Moving straight from one question to the next: whatever was
            // changed in the last one goes now.
            if (live.focus && live.session.unsaved(this.answers).includes(live.focus)) this.save();
            live.focus = q.id;
            live.inTitle = false;
            const arrived = live.session.catchUpQuestion(q.id, this.answers);
            if (arrived) { this.answers[q.id] = arrived.value; this.readyForLists(); }
        },

        // Out of a question and into nothing else on the form. The hold goes
        // once this question's save has — so letting go never strands an answer.
        async leaveQuestion(q, event) {
            if (!q || live.focus !== q.id) return;
            const next = event && event.relatedTarget;
            if (next && next.closest && next.closest('.fa-q, .fd-title, .np-card')) return;
            live.focus = null;
            if (live.session.unsaved(this.answers).includes(q.id)) await this.save();
            else if (live.saving) await live.saving;
            const arrived = live.session.catchUpQuestion(q.id, this.answers);
            if (arrived) { this.answers[q.id] = arrived.value; this.readyForLists(); }
            if (!live.focus && !live.inTitle) ShepherdingPresence.release();
        },

        enterTitle(event) {
            if (typeof ShepherdingPresence === 'undefined') return;
            if (!ShepherdingPresence.claimBox(FormDocumentCore.box.title(this.docId))) {
                event.target.blur();
                this.sayHeld(this.titleHolder, 'title');
                return;
            }
            if (live.focus && live.session.unsaved(this.answers).includes(live.focus)) this.save();
            live.focus = null;
            live.inTitle = true;
            const arrived = live.session.catchUpTitle(this.title);
            if (arrived !== null) this.title = arrived;
        },

        async leaveTitle() {
            if (!live.inTitle) return;
            live.inTitle = false;
            if (FormDocumentCore.titleValue(this.title) !== live.session.title()) await this.save();
            else if (live.saving) await live.saving;
            const arrived = live.session.catchUpTitle(this.title);
            if (arrived !== null) this.title = arrived;
            if (!live.focus && !live.inTitle) ShepherdingPresence.release();
        },

        startPresence(user) {
            if (typeof ShepherdingPresence === 'undefined') return;
            try {
                ShepherdingPresence.subscribe(entries => { this.presenceEntries = entries; });
                MosaicIdentity.me({ db, getUserData, uid: user.uid }).then(identity => {
                    ShepherdingPresence.start({
                        db,
                        uid: user.uid,
                        identity,
                        // The same page on web and in the phone app, so both
                        // count as being on this document.
                        surface: 'shepherding-form-document',
                        pageKey: this.docId,
                        stamp: () => firebase.firestore.FieldValue.serverTimestamp(),
                    });
                    // Presence waits on who you are; answering does not. A box
                    // entered before it started was let in unrecorded.
                    if (live.focus) ShepherdingPresence.claimBox(FormDocumentCore.box.question(this.docId, live.focus));
                    else if (live.inTitle) ShepherdingPresence.claimBox(FormDocumentCore.box.title(this.docId));
                }).catch(e => console.warn('Presence could not work out who you are:', e));
                live.stops.push((ticker => () => clearInterval(ticker))(
                    setInterval(() => { this.presenceTick++; }, PresenceCore.HEARTBEAT_MS)));
                // leave(), not release(): release writes a fresh timestamp and
                // would leave you looking present for half a minute after going.
                window.addEventListener('beforeunload', () => ShepherdingPresence.leave());
            } catch (e) {
                console.warn('Presence could not start on this document; carrying on without it:', e);
            }
        },

        // Whoever else holds this box, or null.
        heldBy(box) {
            this.presenceTick; // read, so a quiet hold is redrawn as free
            if (typeof ShepherdingPresence === 'undefined') return null;
            return ShepherdingPresence.holderIn(
                this.presenceEntries, this.currentUser && this.currentUser.uid, box, Date.now());
        },

        questionHolder(q) {
            if (!q || !FormDocumentCore.isBox(q)) return null;
            return this.heldBy(FormDocumentCore.box.question(this.docId, q.id));
        },

        get titleHolder() {
            return this.heldBy(FormDocumentCore.box.title(this.docId));
        },

        // The other elders on this document — the row of faces.
        get othersHere() {
            this.presenceTick;
            if (!this.currentUser || typeof PresenceCore === 'undefined') return [];
            return PresenceCore.peopleHere(
                this.presenceEntries, this.currentUser.uid, 'shepherding-form-document', this.docId,
                Date.now(), { idleMs: PresenceCore.SHEPHERDING_IDLE_MS });
        },

        holderLabel(holder) { return PresenceCore.holderLabel(holder); },
        holderTitle(holder) { return PresenceCore.holderTitle(holder); },

        // Trying a question somebody else holds says who has it.
        onQuestionPointer(q) {
            const holder = this.questionHolder(q);
            if (holder) this.sayHeld(holder, 'question');
            else this.enterQuestion(q);
        },

        sayHeld(holder, what) {
            this.heldNotice = (holder ? holder.name : 'Somebody') + ' is answering this ' + what + ' right now.';
            clearTimeout(this._heldTimer);
            this._heldTimer = setTimeout(() => { this.heldNotice = ''; }, 3000);
        },
    };
    // The new-person card brings its own state and its own Save; this page
    // brings the door it writes through (createPerson, above).
    return Object.assign(page, NewPersonCard.state());
}
