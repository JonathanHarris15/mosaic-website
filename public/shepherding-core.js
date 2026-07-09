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

    // ── Tag Hold derivation (pure) — ADR-0011 ────────────────────────────────
    // A Shepherding Tag has a stable identity independent of its name, so Hold
    // Duration (how long a Person has continuously carried a tag) is derived from
    // the Tag Change history rather than stored. The current hold begins at the
    // most recent `added` Tag Change with no later `removed`; the Person's current
    // `tags` array is the source of truth for what is carried now.

    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    // Map of tagId → { heldSinceMs, durationMs } for every currently-carried tag
    // whose start can be determined. A carried tag with no `added` entry (applied
    // before Tag Changes were recorded), or one whose last change was a `removed`,
    // has an unknown hold and is omitted rather than guessed.
    function deriveTagHolds(activity, currentTags, nowMs) {
        const carried = new Set(currentTags || []);
        const byTag = {};
        for (const e of (activity || [])) {
            if (!e || (e.action !== 'added' && e.action !== 'removed')) continue;
            if (!carried.has(e.tagId)) continue;
            (byTag[e.tagId] || (byTag[e.tagId] = [])).push(e);
        }
        const holds = {};
        for (const tagId of Object.keys(byTag)) {
            const entries = byTag[tagId]
                .slice()
                .sort((a, b) => pastoralEntryTime(a) - pastoralEntryTime(b));
            // Walk oldest-first; the current hold starts at the first `added` of
            // the latest uninterrupted run of carrying the tag.
            let holdStart = null;
            for (const e of entries) {
                if (e.action === 'added') {
                    if (holdStart === null) holdStart = pastoralEntryTime(e);
                } else {
                    holdStart = null;
                }
            }
            if (holdStart !== null) {
                holds[tagId] = { heldSinceMs: holdStart, durationMs: Math.max(0, nowMs - holdStart) };
            }
        }
        return holds;
    }

    // Render a Hold Duration as a single, largest-unit, human span. An unknown
    // (null/undefined) duration renders empty so callers can show their own hint.
    function formatHoldDuration(durationMs) {
        if (durationMs === null || durationMs === undefined) return '';
        const days = Math.floor(durationMs / MS_PER_DAY);
        if (days <= 0) return 'today';
        if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'}`;
        const months = Math.floor(days / 30);
        if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'}`;
        const years = Math.floor(days / 365);
        return `${years} ${years === 1 ? 'year' : 'years'}`;
    }

    // The Hold-Duration filter predicate: a Person passes when the hold is known
    // and at least minDays old. An unknown hold never passes (ADR-0011).
    function holdMeetsMinimum(durationMs, minDays) {
        if (durationMs === null || durationMs === undefined) return false;
        return durationMs >= minDays * MS_PER_DAY;
    }

    // The directional Hold-Duration predicate. comparator 'lt' means "held less
    // than days"; anything else (default) means "held at least days". A zero
    // threshold imposes no constraint (the slider is off). An unknown hold never
    // qualifies in either direction — we don't guess (ADR-0011).
    function holdSatisfies(durationMs, days, comparator) {
        if (!days || days <= 0) return true;
        if (durationMs === null || durationMs === undefined) return false;
        const threshold = days * MS_PER_DAY;
        return comparator === 'lt' ? durationMs < threshold : durationMs >= threshold;
    }

    // Discrete stops (in days) for the per-tag Hold-Duration slider: 0 (anyone
    // carrying the tag) up to a year, in widening increments. Each selected tag
    // filter chip carries its own stop.
    const HOLD_FILTER_STOPS = [0, 7, 14, 30, 60, 90, 180, 270, 365];

    // Nearest slider stop index for a stored day count, so a persisted threshold
    // re-seeds the slider thumb.
    function holdStopIndex(days) {
        const target = days || 0;
        let best = 0;
        let bestDelta = Infinity;
        for (let i = 0; i < HOLD_FILTER_STOPS.length; i++) {
            const delta = Math.abs(HOLD_FILTER_STOPS[i] - target);
            if (delta < bestDelta) { bestDelta = delta; best = i; }
        }
        return best;
    }

    // Compact label for a slider stop ('' at 0, else '1w' / '3mo' / '1y') — the
    // minimal caption shown on a selected tag chip.
    function formatHoldShort(days) {
        if (!days || days <= 0) return '';
        if (days < 30) return `${Math.round(days / 7)}w`;
        if (days < 365) return `${Math.round(days / 30)}mo`;
        return `${Math.round(days / 365)}y`;
    }

    // ── Tag Merge planning (pure) — ADR-0011 ─────────────────────────────────
    // Fold one or more merged tags into a surviving tag. For each affected Person:
    // rewrite the `tags` array (merged ids → survivor, deduped) and re-point their
    // Tag Changes at the survivor so it inherits the history — and, because
    // deriveTagHolds then reads the earliest `added` of the run, the earlier (i.e.
    // longer) hold. The survivor is never among the deleted tags. A browser writer
    // applies personUpdates / activityRewrites / deleteTagIds in chunked batches.
    function planTagMerge({ people, mergedTagIds, survivorTagId }) {
        const mergedSet = new Set((mergedTagIds || []).filter(id => id !== survivorTagId));
        const personUpdates = [];
        const activityRewrites = [];
        for (const p of (people || [])) {
            const tags = p.tags || [];
            if (tags.some(t => mergedSet.has(t))) {
                const seen = new Set();
                const newTags = [];
                for (const t of tags) {
                    const mapped = mergedSet.has(t) ? survivorTagId : t;
                    if (!seen.has(mapped)) { seen.add(mapped); newTags.push(mapped); }
                }
                personUpdates.push({ personId: p.id, newTags });
            }
            for (const e of (p.activity || [])) {
                if (e && mergedSet.has(e.tagId)) {
                    activityRewrites.push({ personId: p.id, activityId: e.id, tagId: survivorTagId });
                }
            }
        }
        return { personUpdates, activityRewrites, deleteTagIds: [...mergedSet] };
    }

    // ── Membership Track (ADR-0012) ──────────────────────────────────────────
    // The single church-relationship state machine. A Person sits at exactly one
    // Membership Stage; from the stage the code projects a set of immutable
    // Membership Tags so the Track plugs into the tag filter system rather than a
    // parallel one. The stage field is the source of truth — membershipTagsFor /
    // applyMembershipTags are the pure projection the dual-write commits. Inactive
    // is orthogonal to the Track: it does not clear the stage (which is retained
    // for restore) but overrides the projection to the single Inactive tag.

    // Ordered stages. The order IS the Track direction; the slider walks this.
    const MEMBERSHIP_STAGES = [
        'visitor',
        'regular_attender',
        'prospective_member',
        'member',
        'moving_membership',
        'previous_member',
    ];

    const MEMBERSHIP_STAGE_LABEL = {
        visitor: 'Visitor',
        regular_attender: 'Regular Attender',
        prospective_member: 'Prospective Member',
        member: 'Member',
        moving_membership: 'Moving Membership',
        previous_member: 'Previous Member',
    };

    // Tag identity is the tag name (ADR-0011), so a Membership Tag's id doubles as
    // its display name — and the `member` stage's 'Member' id is the very tag the
    // legacy directory gate used, so the Track absorbs it with no migration.
    const MEMBER_TAG_ID = 'Member';
    const INACTIVE_TAG_ID = 'Inactive';

    // Each stage's projected Membership Tag ids. Moving Membership deliberately
    // carries BOTH its own tag and 'Member' so "members = carries the Member tag"
    // stays one query while still distinguishing those mid-transfer (ADR-0012).
    const MEMBERSHIP_STAGE_TAGS = {
        visitor: ['Visitor'],
        regular_attender: ['Regular Attender'],
        prospective_member: ['Prospective Member'],
        member: ['Member'],
        moving_membership: ['Moving Membership', 'Member'],
        previous_member: ['Previous Member'],
    };

    // Every code-defined Membership Tag id — the stage tags plus 'Inactive'. This
    // is the immutable subset the tag-management UI must refuse to rename / delete
    // / merge / hide, and the exact set applyMembershipTags strips before
    // re-projecting.
    const MEMBERSHIP_TAG_IDS = [
        'Visitor',
        'Regular Attender',
        'Prospective Member',
        'Member',
        'Moving Membership',
        'Previous Member',
        'Inactive',
    ];
    const MEMBERSHIP_TAG_ID_SET = new Set(MEMBERSHIP_TAG_IDS);

    // Is this tag id one of the code-defined, immutable Membership Tags?
    function isMembershipTagId(tagId) {
        return MEMBERSHIP_TAG_ID_SET.has(tagId);
    }

    // The Membership Tag ids a Person's membership projects. Inactive wins and
    // yields ['Inactive'] regardless of any retained stage; a Person with no stage
    // (and not Inactive) projects none. Returns a fresh array each call.
    function membershipTagsFor(membership) {
        const m = membership || {};
        if (m.inactive) return [INACTIVE_TAG_ID];
        const stage = m.stage;
        if (!stage || !MEMBERSHIP_STAGE_TAGS[stage]) return [];
        return MEMBERSHIP_STAGE_TAGS[stage].slice();
    }

    // Re-project a Person's `tags` for a membership: drop EVERY Membership Tag,
    // then append the ones the membership currently projects, preserving order and
    // all non-membership tags. Idempotent — the stage is the source of truth, never
    // the tags. The pure heart of the MS-83 dual-write.
    function applyMembershipTags(currentTags, membership) {
        const out = (currentTags || []).filter(t => !MEMBERSHIP_TAG_ID_SET.has(t));
        for (const t of membershipTagsFor(membership)) {
            if (out.indexOf(t) === -1) out.push(t);
        }
        return out;
    }

    // "Is this Person a current member?" — the Members-tab predicate. True iff the
    // projection includes the Member tag (stage member or moving_membership, and
    // not Inactive), so callers need not special-case Moving Membership.
    function carriesMemberTag(membership) {
        return membershipTagsFor(membership).indexOf(MEMBER_TAG_ID) !== -1;
    }

    // Migration (ADR-0012): map a legacy `membership.status` value to the new
    // { stage, inactive } shape. visitor/regular_attender/member map straight
    // across; inactive becomes the off-Track flag with no stage; anything absent
    // or unrecognised (including the three new stages, which have no legacy source)
    // yields an empty membership so it can be assigned by hand.
    function membershipFromLegacyStatus(status) {
        switch (status) {
            case 'visitor': return { stage: 'visitor', inactive: false };
            case 'regular_attender': return { stage: 'regular_attender', inactive: false };
            case 'member': return { stage: 'member', inactive: false };
            case 'inactive': return { stage: null, inactive: true };
            default: return { stage: null, inactive: false };
        }
    }

    // Pastoral Record entry for a Track move (ADR-0012). Mirrors buildStatusChange;
    // previous/next are { stage, inactive }. The MS-84 slider is its one writer.
    function buildMembershipChange({ previous, next, authorUid, authorName, source, sourceDocumentId }) {
        return {
            kind: 'membership_change',
            previousStage: (previous && previous.stage) || null,
            newStage: (next && next.stage) || null,
            previousInactive: !!(previous && previous.inactive),
            newInactive: !!(next && next.inactive),
            authorUid: authorUid || null,
            authorName: authorName || '',
            source,
            sourceDocumentId: sourceDocumentId || null,
            explanation: '',
        };
    }

    // Is a Person off the Track / Inactive? The new source of truth is
    // membership.inactive (ADR-0012); the legacy `membership.status === 'inactive'`
    // is honoured too so un-migrated records still read correctly. The single
    // predicate behind every "active people" filter.
    function isInactiveMembership(membership) {
        if (!membership) return false;
        return !!membership.inactive || membership.status === 'inactive';
    }

    // The Membership Directory visibility rule (ADR-0012). The directory splits
    // into two tabs: **members** lists Persons carrying the Member tag (stage
    // Member or Moving Membership); **non_members** lists the remaining active
    // Persons without it. Inactive Persons carry no Member tag, so they never
    // land on the members tab, and they are hidden from non-editors on the
    // non-members tab (visible to editors so they can be managed). `canEdit` is
    // the viewer's edit capability.
    function personMatchesDirectoryTab(person, tab, canEdit) {
        const tags = (person && person.tags) || [];
        const hasMember = tags.indexOf(MEMBER_TAG_ID) !== -1;
        const inactive = isInactiveMembership(person && person.membership);
        if (tab === 'members') return hasMember;
        if (hasMember) return false;
        if (inactive && !canEdit) return false;
        return true;
    }

    // The human sentence for a Membership Change in the Pastoral Record. Reads an
    // Inactive toggle first (it dominates), then compares stage positions on the
    // Track: later index = "Advanced to", earlier = "Moved back to", first
    // placement from no stage = "Set to". Pure, so the feed renderer stays dumb.
    function describeMembershipChange(entry) {
        const e = entry || {};
        if (e.newInactive && !e.previousInactive) return 'Marked Inactive';
        const label = s => (s && MEMBERSHIP_STAGE_LABEL[s]) || 'no stage';
        if (!e.newInactive && e.previousInactive) return `Reactivated as ${label(e.newStage)}`;
        const from = MEMBERSHIP_STAGES.indexOf(e.previousStage);
        const to = MEMBERSHIP_STAGES.indexOf(e.newStage);
        if (from === -1 && to !== -1) return `Set to ${label(e.newStage)}`;
        if (to > from) return `Advanced to ${label(e.newStage)}`;
        if (to < from) return `Moved back to ${label(e.newStage)}`;
        return `Set to ${label(e.newStage)}`;
    }

    // Atomic Track move (browser only) — the membership analogue of the ADR-0005
    // dual-write. In one batch: set the Person's membership field, re-project the
    // Membership Tags, and append one Membership Change. The tag swap is therefore
    // silent — it emits no Tag Changes; the Membership Change is the canonical
    // record. `next` is { stage, inactive }; currentTags is the Person's live tags.
    function commitMembershipChange(db, personId, { currentTags, previous, next, authorUid, authorName, source, sourceDocumentId }) {
        // Dotted field paths so only stage/inactive move — joinedAt and the
        // back-compat status field on the membership object are preserved.
        const personUpdate = {
            'membership.stage': (next && next.stage) || null,
            'membership.inactive': !!(next && next.inactive),
            tags: applyMembershipTags(currentTags, next),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        const record = buildMembershipChange({ previous, next, authorUid, authorName, source, sourceDocumentId });
        return commitPastoralChange(db, personId, personUpdate, record);
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
        deriveTagHolds,
        formatHoldDuration,
        holdMeetsMinimum,
        holdSatisfies,
        HOLD_FILTER_STOPS,
        holdStopIndex,
        formatHoldShort,
        planTagMerge,
        // Membership Track (ADR-0012)
        MEMBERSHIP_STAGES,
        MEMBERSHIP_STAGE_LABEL,
        MEMBERSHIP_STAGE_TAGS,
        MEMBERSHIP_TAG_IDS,
        MEMBER_TAG_ID,
        INACTIVE_TAG_ID,
        isMembershipTagId,
        membershipTagsFor,
        applyMembershipTags,
        carriesMemberTag,
        membershipFromLegacyStatus,
        buildMembershipChange,
        describeMembershipChange,
        personMatchesDirectoryTab,
        isInactiveMembership,
        commitMembershipChange,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ShepherdingCore;
    }
    if (global) {
        global.ShepherdingCore = ShepherdingCore;
    }
})(typeof window !== 'undefined' ? window : null);
