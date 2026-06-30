// Shepherding Core — the single seam for the Shepherding Status value model and
// the Pastoral Record write invariant (ADR-0005).
//
// Two concerns lived, duplicated and drifting, across shepherding-profile.js,
// shepherding-people.js, shepherding-care-list.js, shepherding-document.js,
// shepherding-dashboard.js, shepherding-documents.js and
// shepherding-inline-triggers.js:
//
//   1. The Shepherding Status value model (urgency × importance levels, their
//      labels, the zone key, and the matrix cell colour). The level arrays were
//      copied verbatim and the labels had drifted into three inconsistent
//      variants. They are now defined once here; callers pick the label variant
//      that fits their surface (full / short / tiny).
//
//   2. The dual write required by ADR-0005: every Shepherding Status (and every
//      Shepherding Tag) change must update the denormalized field on the Person
//      AND append a matching entry to people/{id}/shepherding_activity. That
//      pair was hand-built at eight call sites as two separate awaits — not
//      atomic, so a failed second write left the history inconsistent. The pure
//      record builders (buildStatusChange / buildTagChange) and the atomic
//      writer (commitPastoralChange, a single Firestore batch) now own it.
//
// Loaded as a classic <script> before each page script, so it is wrapped in an
// IIFE and exposes only window.ShepherdingCore — it leaks no globals that would
// collide with a page script's own top-level declarations. The same object is
// exported via module.exports for Node unit tests; the browser-only writer is
// never reached under Node.
(function (global) {
    'use strict';

    // ── Status value model ────────────────────────────────────────────────────
    const URGENCY_LEVELS = ['urgent', 'somewhat_urgent', 'not_urgent'];
    const IMPORTANCE_LEVELS = ['important', 'somewhat_important', 'not_important'];

    // Full labels — Shepherding Profile.
    const URGENCY_LABEL = { urgent: 'Urgent', somewhat_urgent: 'Somewhat Urgent', not_urgent: 'Not Urgent' };
    const IMPORTANCE_LABEL = { important: 'Important', somewhat_important: 'Somewhat Important', not_important: 'Not Important' };

    // Short labels — People list and the Person Panel status matrix (narrow cells).
    const URGENCY_LABEL_SHORT = { urgent: 'Urgent', somewhat_urgent: 'Somewhat', not_urgent: 'Not Urgent' };
    const IMPORTANCE_LABEL_SHORT = { important: 'Important', somewhat_important: 'Somewhat', not_important: 'Not Imp.' };

    // Tiny labels — the inline `$$` status matrix popup (very narrow chips).
    const URGENCY_LABEL_TINY = { urgent: 'Urg', somewhat_urgent: 'Swt', not_urgent: 'Not' };
    const IMPORTANCE_LABEL_TINY = { important: 'Imp', somewhat_important: 'Swt', not_important: 'Not' };

    // Stable key for a status zone (urgency × importance) used by Filtered Views.
    function statusZoneKey(urgency, importance) {
        return `${urgency}__${importance}`;
    }

    // 0 = urgent + important (most urgent) … 4 = not_urgent + not_important.
    function statusScore(urgency, importance) {
        return URGENCY_LEVELS.indexOf(urgency) + IMPORTANCE_LEVELS.indexOf(importance);
    }

    // Tailwind border/background classes for a status-matrix cell, by score band.
    function statusCellColor(urgency, importance) {
        const score = statusScore(urgency, importance);
        if (score <= 1) return 'border-error/40 bg-error-container/20';
        if (score <= 3) return 'border-secondary/30 bg-secondary-container/20';
        return 'border-outline-variant bg-surface-container';
    }

    // ── Pastoral Record entry builders (pure) ─────────────────────────────────
    // Build the activity record only; commitPastoralChange stamps createdAt so
    // these stay pure and unit-testable. Shapes match what the call sites wrote
    // by hand, so existing Pastoral Records are unaffected.

    function buildStatusChange({ previousStatus, newStatus, authorUid, authorName, source, sourceDocumentId }) {
        return {
            kind: 'status_change',
            previousStatus: previousStatus || null,
            newStatus: newStatus || null,
            authorUid: authorUid || null,
            authorName: authorName || '',
            source,
            sourceDocumentId: sourceDocumentId || null,
            explanation: '',
        };
    }

    function buildTagChange({ tagId, tagName, action, authorUid, authorName, source, sourceDocumentId }) {
        return {
            kind: 'tag_change',
            tagId,
            tagName,
            action,
            authorUid: authorUid || null,
            authorName: authorName || '',
            source,
            sourceDocumentId: sourceDocumentId || null,
            explanation: '',
        };
    }

    // ── Atomic Pastoral Record write (browser only) ───────────────────────────
    // ADR-0005: the denormalized Person field and the shepherding_activity entry
    // must always be written together. A single Firestore batch makes the pair
    // atomic — neither half can land without the other.
    //
    //   personUpdate   — fields to set on people/{id} (e.g. { shepherdingStatus }
    //                    or { tags: arrayUnion(id), shepherdingHidden }); pass
    //                    updatedAt yourself when the surface expects it.
    //   activityRecord — output of buildStatusChange / buildTagChange.
    function commitPastoralChange(db, personId, personUpdate, activityRecord) {
        const personRef = db.collection('people').doc(personId);
        const batch = db.batch();
        if (personUpdate && Object.keys(personUpdate).length) {
            batch.update(personRef, personUpdate);
        }
        const activityRef = personRef.collection('shepherding_activity').doc();
        batch.set(activityRef, {
            ...activityRecord,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        // Resolve to the new activity record's id so callers can later undo this
        // exact entry (e.g. a status chip remembers it and deletes it on removal).
        return batch.commit().then(() => activityRef.id);
    }

    // ── Atomic Pastoral Record undo (browser only) ────────────────────────────
    // The mirror of commitPastoralChange: revert the denormalized Person field(s)
    // and DELETE the activity record that logged the change — in one batch — so a
    // change that is taken back (e.g. a status chip backspaced straight out of a
    // care-list cell) leaves no trace in the Pastoral Record timeline, rather than
    // logging a second "changed back" entry.
    function revertPastoralChange(db, personId, personUpdate, activityId) {
        const personRef = db.collection('people').doc(personId);
        const batch = db.batch();
        if (personUpdate && Object.keys(personUpdate).length) {
            batch.update(personRef, personUpdate);
        }
        if (activityId) {
            batch.delete(personRef.collection('shepherding_activity').doc(activityId));
        }
        return batch.commit();
    }

    // ── Pastoral Record assembly (pure) ──────────────────────────────────────
    // The Pastoral Record is the single reverse-chronological feed of a Person's
    // shepherding activity: Shepherding Notes interleaved with Status Changes and
    // Tag Changes. Assembling and collapsing it was inline, untestable getter
    // logic on the profile; it is pure and lives here now.

    // Newest-first sort key. Entries carry a Firestore Timestamp in createdAt;
    // anything without one sorts to the bottom (time 0).
    function pastoralEntryTime(entry) {
        return entry && entry.createdAt && entry.createdAt.toDate
            ? entry.createdAt.toDate().getTime() : 0;
    }

    // Merge Shepherding Notes and activity (Status/Tag Changes) into one feed,
    // tagged with _entryKind and sorted newest-first. A note being edited
    // (options.editingNoteId) is omitted so its live editor isn't duplicated.
    function assemblePastoralRecord(notes, activity, options) {
        const editingNoteId = (options && options.editingNoteId) || null;
        const items = [
            ...(notes || [])
                .filter(n => !editingNoteId || n.id !== editingNoteId)
                .map(n => ({ ...n, _entryKind: 'note' })),
            ...(activity || []).map(a => ({ ...a, _entryKind: a.kind })),
        ];
        return items.sort((a, b) => pastoralEntryTime(b) - pastoralEntryTime(a));
    }

    // Collapse each run of consecutive Status/Tag Changes into one summary
    // entry ({ _entryKind: 'status_group', count }) so a burst of changes reads
    // as one collapsible row. Notes break a run and pass through unchanged.
    function collapsePastoralRecord(record) {
        const result = [];
        let count = 0;
        let groupIdx = 0;
        for (const entry of record) {
            if (entry._entryKind === 'status_change' || entry._entryKind === 'tag_change') {
                count++;
            } else {
                if (count > 0) {
                    result.push({ _entryKind: 'status_group', count, id: 'sg_' + groupIdx++ });
                    count = 0;
                }
                result.push(entry);
            }
        }
        if (count > 0) result.push({ _entryKind: 'status_group', count, id: 'sg_' + groupIdx });
        return result;
    }

    const ShepherdingCore = {
        URGENCY_LEVELS,
        IMPORTANCE_LEVELS,
        URGENCY_LABEL,
        IMPORTANCE_LABEL,
        URGENCY_LABEL_SHORT,
        IMPORTANCE_LABEL_SHORT,
        URGENCY_LABEL_TINY,
        IMPORTANCE_LABEL_TINY,
        statusZoneKey,
        statusScore,
        statusCellColor,
        buildStatusChange,
        buildTagChange,
        commitPastoralChange,
        revertPastoralChange,
        pastoralEntryTime,
        assemblePastoralRecord,
        collapsePastoralRecord,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ShepherdingCore;
    }
    if (global) {
        global.ShepherdingCore = ShepherdingCore;
    }
})(typeof window !== 'undefined' ? window : null);
