// Form Document Core (MS-483) — the rules the Form Document page and the
// assistant both follow, so neither can drift. Shaped like care-list-core.js,
// so the assistant's held-box check (MS-433) reads both kinds of box the same way.
//
// ⚠ ONE FIELD PER ANSWER. A Form Document used to save by writing its whole
// answers map back, with the title, on every autosave. Two elders on two
// different questions overwrote each other, and an answer the assistant wrote
// was put back by the page's next save. Each answer now lives at
// `answers.<question>` and a save writes only the answers that changed
// (ADR-0034). The unit is the WHOLE answer: a picked person's id and name, or a
// select-all list, travel together (ADR-0034 §1).
//
// ⚠ COMPARED, NOT FLAGGED. Unlike a Care List cell, an answer is a plain value —
// no rich-text editor rewrites it behind our back — so "changed" is decided by
// comparing with the last-saved copy. An empty select-all list is the same as
// no answer: the page prepares one for every such question when it opens, and
// opening a form must write nothing.
//
// ⚠ ONLY THE SAVE THAT CHANGED THE SUBJECT RE-FILES. A personal shepherding
// document is filed on the profile of whoever its first question names. With
// live updates, a page that merely heard about a new subject would otherwise
// re-file the document on its next unrelated save — two pages fighting over
// where it lives.
//
// Pure rules first; the writes at the bottom take the Firestore handle and the
// namespace holding FieldPath / FieldValue. Mirrored into functions/shared.
(function (global) {
    'use strict';

    const COLLECTION = 'elder_documents';
    const STRUCTURE = 'elder_document_structure';
    const ANSWERS = 'answers';
    // Restated from forms-core.js, which this must not require: the page loads
    // both as plain scripts. A test holds the two together.
    const SUBJECT_QUESTION_ID = 'shepherd_subject';

    // ── Where things live ─────────────────────────────────────────────────────

    function answerPath(questionId) {
        return [ANSWERS, String(questionId)];
    }

    // One Form Document is one scope; each question that asks something is a
    // box, and so is the title. The title box has the same name as a Care
    // List's, because both are "the title of this document".
    const box = {
        question(documentId, questionId) {
            return { scopeKey: 'document:' + documentId, boxKey: 'question:' + questionId };
        },
        title(documentId) {
            return { scopeKey: 'document:' + documentId, boxKey: 'title' };
        },
    };

    // A section heading asks nothing, so nobody holds it.
    function isBox(question) {
        return !!(question && question.id && question.type !== 'section');
    }

    // ── Answers ───────────────────────────────────────────────────────────────

    function isEmpty(value) {
        if (value === null || value === undefined) return true;
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'string') return value.trim() === '';
        return false;
    }

    function stable(value) {
        if (value === undefined) return 'null';
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
        return '{' + Object.keys(value).sort()
            .filter(k => value[k] !== undefined)
            .map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    }

    function sameAnswer(a, b) {
        if (isEmpty(a) && isEmpty(b)) return true;
        return stable(a) === stable(b);
    }

    function copy(value) {
        return value === undefined ? null : JSON.parse(JSON.stringify(value));
    }

    function subjectOf(answers) {
        const answer = answers && answers[SUBJECT_QUESTION_ID];
        return (answer && answer.personId) ? String(answer.personId) : '';
    }

    function titleValue(title) {
        return String(title || '').trim() || 'Untitled';
    }

    // Which profile tree to take the document off, and which to put it on —
    // off first, so it is never on two profiles at once. Null for no change.
    function refiling(before, after) {
        const was = String(before || '');
        const now = String(after || '');
        if (was === now) return null;
        return { off: was ? 'person_' + was : null, on: now ? 'person_' + now : null };
    }

    // ── One page's copy ───────────────────────────────────────────────────────

    // What one open Form Document page knows: the answers, title and owner it
    // last loaded, saved or took in (`saved`), and the last copy that arrived
    // (`latest`). The page keeps what is on screen; each call is handed it.
    function createSession(data) {
        const saved = {
            title: titleValue(data && data.title),
            answers: copy((data && data.answers) || {}),
            owner: String((data && data.ownerPersonId) || ''),
        };
        let latest = { title: saved.title, answers: Object.assign({}, saved.answers) };
        const beforeSave = new Map();
        let titleBeforeSave = null;

        function questionIds(...maps) {
            const ids = new Set();
            maps.forEach(m => Object.keys(m || {}).forEach(id => ids.add(id)));
            return ids;
        }

        return {
            title: () => saved.title,
            answer: (questionId) => copy(saved.answers[questionId]),
            ownerPersonId: () => saved.owner,

            // Everything on screen that differs from the saved copy.
            unsaved(current) {
                return Array.from(questionIds(current, saved.answers))
                    .filter(id => !sameAnswer(current && current[id], saved.answers[id]));
            },

            // What to write now: every answer that differs from the saved
            // copy, and the title if it does. Taking it moves both copies.
            // `subject` is { before, after } when this save changes who the
            // document is about, measured against where it is filed.
            takeSave(current, currentTitle) {
                const answers = [];
                questionIds(current, saved.answers).forEach(id => {
                    const value = current ? current[id] : undefined;
                    if (sameAnswer(value, saved.answers[id])) return;
                    beforeSave.set(id, { saved: saved.answers[id], latest: latest.answers[id] });
                    const written = isEmpty(value) ? (Array.isArray(value) ? [] : null) : copy(value);
                    answers.push({ questionId: id, value: written });
                    saved.answers[id] = written;
                    latest.answers[id] = written;
                });
                let title = null;
                if (currentTitle !== undefined && titleValue(currentTitle) !== saved.title) {
                    title = titleValue(currentTitle);
                    titleBeforeSave = { saved: saved.title, latest: latest.title };
                    saved.title = title;
                    latest.title = title;
                }
                let subject = null;
                if (answers.some(a => a.questionId === SUBJECT_QUESTION_ID)) {
                    const after = subjectOf(saved.answers);
                    if (after !== saved.owner) subject = { before: saved.owner, after };
                }
                return { answers, title, subject };
            },

            // The save did not land: both copies go back, so it is unsaved again.
            saveFailed(save) {
                ((save && save.answers) || []).forEach(a => {
                    const before = beforeSave.get(a.questionId);
                    if (!before) return;
                    saved.answers[a.questionId] = before.saved;
                    latest.answers[a.questionId] = before.latest;
                });
                if (save && save.title !== null && save.title !== undefined && titleBeforeSave) {
                    saved.title = titleBeforeSave.saved;
                    latest.title = titleBeforeSave.latest;
                }
            },

            // The document was re-filed (by this page, or it arrived).
            filedUnder(personId) { saved.owner = String(personId || ''); },

            // Somebody else's version. Returns what the page must put on
            // screen: { answers, title, ownerPersonId }. An answer on screen
            // that differs from the saved copy is this page's own unsaved
            // change and is left alone; so is the question under the cursor
            // (`inQuestion`) and the title while it is being renamed.
            adopt(remote, current, where, currentTitle) {
                const w = where || {};
                latest = {
                    title: titleValue(remote && remote.title),
                    answers: copy((remote && remote.answers) || {}),
                };
                const answers = [];
                questionIds(saved.answers, latest.answers).forEach(id => {
                    if (id === w.inQuestion) return;
                    if (!sameAnswer(current && current[id], saved.answers[id])) return;
                    const theirs = latest.answers[id];
                    if (sameAnswer(saved.answers[id], theirs)) return;
                    const value = theirs === undefined ? null : theirs;
                    saved.answers[id] = value;
                    answers.push({ questionId: id, value: copy(value) });
                });
                // A select-all answer that was cleared arrives as an empty list,
                // which is what its checkboxes bind to.
                answers.forEach(a => {
                    if (a.value === null && Array.isArray(current && current[a.questionId])) a.value = [];
                });

                let title = null;
                const typing = currentTitle !== undefined && titleValue(currentTitle) !== saved.title;
                if (!w.inTitle && !typing && latest.title !== saved.title) {
                    saved.title = latest.title;
                    title = latest.title;
                }

                const owner = String((remote && remote.ownerPersonId) || '');
                let ownerPersonId;
                if (owner !== saved.owner) {
                    saved.owner = owner;
                    ownerPersonId = owner;
                }
                return { answers, title, ownerPersonId };
            },

            // What arrived for this question while the cursor kept it out, as
            // { value }, or null. Asked on entering and on leaving a question.
            catchUpQuestion(id, current) {
                if (!sameAnswer(current && current[id], saved.answers[id])) return null;
                const theirs = latest.answers[id];
                if (sameAnswer(saved.answers[id], theirs)) return null;
                saved.answers[id] = theirs === undefined ? null : theirs;
                const value = copy(saved.answers[id]);
                return { value: value === null && Array.isArray(current && current[id]) ? [] : value };
            },

            catchUpTitle(currentTitle) {
                if (currentTitle !== undefined && titleValue(currentTitle) !== saved.title) return null;
                if (latest.title === saved.title) return null;
                saved.title = latest.title;
                return latest.title;
            },
        };
    }

    // ── The writes ────────────────────────────────────────────────────────────
    //
    // `fs` holds FieldPath and FieldValue. `extra` is any top-level fields a
    // writer stamps as well (the assistant's provenance).

    // Write these answers, and the title if given, each to its own field.
    // edits: { answers: [{questionId, value}], title, byName, extra }
    function saveEdits(db, fs, documentId, edits) {
        const e = edits || {};
        const answers = e.answers || [];
        const hasTitle = e.title !== null && e.title !== undefined;
        if (!answers.length && !hasTitle) return Promise.resolve(false);
        const args = [];
        answers.forEach(a => {
            args.push(new fs.FieldPath(...answerPath(a.questionId)), a.value === undefined ? null : a.value);
        });
        if (hasTitle) args.push('title', e.title);
        args.push('updatedAt', fs.FieldValue.serverTimestamp(), 'updatedByName', e.byName || '');
        Object.keys(e.extra || {}).forEach(k => { args.push(k, e.extra[k]); });
        return db.collection(COLLECTION).doc(documentId)
            .update(args[0], args[1], ...args.slice(2)).then(() => true);
    }

    // Move the document from one person's profile to another's: each profile
    // tree changed in its own transaction, off first, then the record's owner.
    // `docs` is ShepherdingDocsCore (removeFromTree, fileInRoot).
    function refile(db, docs, documentId, before, after) {
        const plan = refiling(before, after);
        if (!plan) return Promise.resolve(false);
        const change = (treeId, fn) => {
            if (!treeId) return Promise.resolve();
            const ref = db.collection(STRUCTURE).doc(treeId);
            return db.runTransaction(tx => tx.get(ref).then(snap => {
                const data = snap.exists ? snap.data() : null;
                const tree = (data && Array.isArray(data.children)) ? { children: data.children } : { children: [] };
                if (!fn(tree)) return;
                tx.set(ref, JSON.parse(JSON.stringify({ children: tree.children })));
            }));
        };
        return change(plan.off, tree => docs.removeFromTree(tree, documentId))
            .then(() => change(plan.on, tree => docs.fileInRoot(tree, documentId)))
            .then(() => db.collection(COLLECTION).doc(documentId).update({
                ownerPersonId: String(after || '') || null,
                inLibrary: true,
            }))
            .then(() => true);
    }

    const FormDocumentCore = {
        COLLECTION,
        SUBJECT_QUESTION_ID,
        answerPath,
        box,
        isBox,
        sameAnswer,
        subjectOf,
        titleValue,
        refiling,
        createSession,
        saveEdits,
        refile,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FormDocumentCore;
    }
    if (global) {
        global.FormDocumentCore = FormDocumentCore;
    }
})(typeof window !== 'undefined' ? window : null);
