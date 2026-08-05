// Link Request Core — the client-side seam for a User asking to become a
// Linked User (CONTEXT.md: "Linked User", ADR-0025).
//
// Until now the only way a login ever reached a directory Person was an admin
// noticing the account and hand-picking the Person from a modal. Nobody was
// prompted, nothing was queued, and a new signup sat as a viewer indefinitely.
// A Link Request turns that into something the person themselves starts: they
// either point at the Person they already are (a MATCH request) or say they
// are not in the directory yet and offer their details (a NEW request). An
// editor or above then approves or declines it.
//
// This file owns only what the BROWSER decides: whether the user may ask, what
// a well-formed request looks like, and how to describe one. What happens on
// approval — creating the Person, writing both sides of the link — is a
// privileged act and lives in functions/link-request.js, which cannot import
// this file (Cloud Functions deploy only the functions/ directory). The two
// share the constant vocabulary below, and test/link-request.test.js pins them
// to each other so they cannot drift.
//
// Loaded as a classic <script> before each page script, so it is wrapped in an
// IIFE and exposes only window.LinkRequestCore.
(function (global) {
    'use strict';

    // A Link Request lives at link_requests/{uid} — the document id IS the
    // requesting user's uid. That is not a convenience: it is what makes "one
    // live request per user" true by construction rather than by a query the
    // rules would have to trust.
    const REQUEST_PATH = 'link_requests';

    const STATUS = {
        PENDING: 'pending',
        APPROVED: 'approved',
        DECLINED: 'declined',
    };

    // MATCH — "I am already in the directory, and that Person is me."
    // NEW   — "I am not in the directory; please create a record for me."
    const KIND = {
        MATCH: 'match',
        NEW: 'new',
    };

    // Who may approve or decline. Deliberately the same set as the directory's
    // `canEdit` and the Firestore `isEditor()` helper — elders included, which
    // is the point: an elder knows the congregation and should not have to find
    // an admin to confirm that a name belongs to a face.
    const RESOLVER_LEVELS = ['editor', 'elder', 'admin', 'super_admin'];

    function canResolve(permissionLevel) {
        return RESOLVER_LEVELS.indexOf(permissionLevel) !== -1;
    }

    // May this User raise a request at all? Only if they are not ALREADY a
    // Linked User — an existing link is the thing the request exists to obtain,
    // and re-pointing a link is an admin act, not a self-service one.
    function canRequest(userData) {
        return !!userData && !userData.personId;
    }

    function trimmed(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    // Shape whatever the form produced into the Person-ish subset a NEW request
    // carries. Mirrors the Add Person form in the Membership Directory, minus
    // everything that is never self-asserted: no tags, no Membership Stage, no
    // shepherding. What a person may propose about themselves is exactly what a
    // Linked User may later edit about themselves.
    function normalizeProposed(raw) {
        const r = raw || {};
        return {
            name: trimmed(r.name),
            contact: {
                email: trimmed(r.email !== undefined ? r.email : (r.contact || {}).email),
                phone: trimmed(r.phone !== undefined ? r.phone : (r.contact || {}).phone),
                address: trimmed(r.address !== undefined ? r.address : (r.contact || {}).address),
            },
            birthday: trimmed(r.birthday) || null,
            sex: trimmed(r.sex) || null,
        };
    }

    // Is this draft something we are willing to write? Returns a reason rather
    // than a bare false so the form can say what is wrong.
    function validateDraft(draft) {
        const d = draft || {};
        if (!d.uid) return { ok: false, error: 'You must be signed in to make a request.' };

        if (d.kind === KIND.MATCH) {
            if (!d.personId) return { ok: false, error: 'Choose the directory record that is you.' };
            return { ok: true, error: null };
        }

        if (d.kind === KIND.NEW) {
            const proposed = normalizeProposed(d.proposed);
            if (!proposed.name) return { ok: false, error: 'Enter your full name.' };
            return { ok: true, error: null };
        }

        return { ok: false, error: 'Choose whether you are already in the directory.' };
    }

    // The Firestore document body. The caller adds `createdAt` (a server
    // timestamp, which is not a plain value and so has no place in pure code).
    // Fields are always present — never conditionally omitted — because the
    // security rules match on shape, and an absent key reads differently from a
    // null one.
    function buildRequest(draft) {
        const check = validateDraft(draft);
        if (!check.ok) throw new Error(check.error);

        const isMatch = draft.kind === KIND.MATCH;
        return {
            uid: draft.uid,
            email: trimmed(draft.email),
            kind: draft.kind,
            status: STATUS.PENDING,
            personId: isMatch ? draft.personId : null,
            proposed: isMatch ? null : normalizeProposed(draft.proposed),
            note: trimmed(draft.note),
            resolvedBy: null,
            resolvedByEmail: null,
            declineReason: null,
        };
    }

    function isPending(request) {
        return !!request && request.status === STATUS.PENDING;
    }

    // The name a request is ABOUT. For a match request that is the chosen
    // Person's name, which only the caller can look up; for a new request it is
    // the name the user typed. Falls back to the account email so an inbox row
    // is never blank.
    function subjectName(request, personName) {
        if (!request) return '';
        if (request.kind === KIND.MATCH) return personName || '(record no longer exists)';
        return (request.proposed && request.proposed.name) || request.email || '(unnamed)';
    }

    // One line for the approver's inbox.
    function summarize(request, personName) {
        if (!request) return '';
        const who = subjectName(request, personName);
        return request.kind === KIND.MATCH ?
            `${request.email} says they are ${who}` :
            `${request.email} is not in the directory and asks to be added as ${who}`;
    }

    // What the requester sees on their own profile page while they wait, or
    // after a decision. Approved requests are not described here — an approved
    // request means they are a Linked User now, and the profile page shows them
    // their own information instead.
    function statusMessage(request, personName) {
        if (!request) return '';
        if (request.status === STATUS.PENDING) {
            return request.kind === KIND.MATCH ?
                `Waiting on the church to confirm you are ${subjectName(request, personName)}.` :
                'Waiting on the church to add you to the directory.';
        }
        if (request.status === STATUS.DECLINED) {
            return request.declineReason ?
                `This request was declined: ${request.declineReason}` :
                'This request was declined. Speak to the church office if that is a mistake.';
        }
        return '';
    }

    const LinkRequestCore = {
        REQUEST_PATH,
        STATUS,
        KIND,
        RESOLVER_LEVELS,
        canResolve,
        canRequest,
        normalizeProposed,
        validateDraft,
        buildRequest,
        isPending,
        subjectName,
        summarize,
        statusMessage,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LinkRequestCore;
    }
    if (global) {
        global.LinkRequestCore = LinkRequestCore;
    }
})(typeof window !== 'undefined' ? window : null);
