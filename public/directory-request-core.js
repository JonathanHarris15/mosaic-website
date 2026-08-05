// Directory Request Core — the client-side seam for anything a person asks the
// church to change about their own directory record (CONTEXT.md, ADR-0025,
// ADR-0027).
//
// It started as the Link Request: a User with no Person asking to be connected
// to one. The shape turned out to be general. A member who is already linked
// has the same problem with their misspelt name and their missing spouse —
// they can see it is wrong, they are the only one who knows it is wrong, and
// they cannot fix it, because the directory is editor-authored on purpose.
//
// So there is ONE queue and four kinds:
//
//   link_match — "I'm already in the directory, that record is me"
//   link_new   — "I'm not in the directory; here are my details"
//   name_fix   — "my name is spelt wrong; here is the spelling"
//   family     — "add/remove this Family relation of mine"
//
// The first two come from someone with no Person yet; the last two only make
// sense from someone who has one. Every kind lands in the same editor inbox in
// the Membership Directory and is approved or declined the same way.
//
// This file owns only what the BROWSER decides: whether a person may ask, what
// a well-formed request looks like, and how to describe one. What approval DOES
// is privileged and lives in functions/directory-request.js, which cannot
// import this file (Cloud Functions deploy only functions/). The two share the
// vocabulary below and test/directory-request.test.js pins them together.
//
// Loaded as a classic <script>, so it is wrapped in an IIFE and exposes only
// window.DirectoryRequestCore.
(function (global) {
    'use strict';

    const REQUEST_PATH = 'directory_requests';

    const STATUS = {
        PENDING: 'pending',
        APPROVED: 'approved',
        DECLINED: 'declined',
    };

    const KIND = {
        LINK_MATCH: 'link_match',
        LINK_NEW: 'link_new',
        NAME_FIX: 'name_fix',
        FAMILY: 'family',
    };

    const KINDS = [KIND.LINK_MATCH, KIND.LINK_NEW, KIND.NAME_FIX, KIND.FAMILY];

    // The kinds that only make sense BEFORE you have a Person, and the kinds
    // that only make sense after. Nothing is asked of someone in the wrong state.
    const LINK_KINDS = [KIND.LINK_MATCH, KIND.LINK_NEW];
    const LINKED_KINDS = [KIND.NAME_FIX, KIND.FAMILY];

    // The Family relations a member may propose, matching FamilyCore's planners
    // exactly — those are what approval replays, so proposing anything they
    // cannot plan would be proposing something that can never be approved.
    const FAMILY_RELATIONS = ['spouse', 'parent', 'child'];
    const FAMILY_OPS = ['add', 'remove'];

    // Who may approve or decline. Deliberately the same set as the directory's
    // `canEdit` and the Firestore `isEditor()` helper — elders included, which
    // is the point: an elder knows the congregation and should not have to find
    // an admin to confirm that a name belongs to a face.
    const RESOLVER_LEVELS = ['editor', 'elder', 'admin', 'super_admin'];

    function canResolve(permissionLevel) {
        return RESOLVER_LEVELS.indexOf(permissionLevel) !== -1;
    }

    // May this User raise this kind of request? A link request needs them NOT to
    // be a Linked User (a link is the thing it obtains); a name fix or a family
    // change needs them to already have the Person it is about.
    function canRequest(userData, kind) {
        if (!userData) return false;
        if (LINK_KINDS.indexOf(kind) !== -1) return !userData.personId;
        if (LINKED_KINDS.indexOf(kind) !== -1) return !!userData.personId;
        return false;
    }

    // Every request document id begins `${uid}_`, and the security rules require
    // it. That is what keeps one person's requests out of everyone else's
    // namespace without the rules having to trust a field.
    //
    // Link and name-fix ids are fully determined by the kind, so a second ask
    // overwrites the first and "one pending request of this kind" stays true by
    // construction. A family request is per-relation — someone may well want to
    // add a spouse and two children — so its id carries the relation, and the
    // same relation asked twice still overwrites rather than piling up.
    function requestId(uid, kind, familyRelation) {
        if (kind !== KIND.FAMILY) return `${uid}_${kind}`;
        const f = familyRelation || {};
        return `${uid}_${KIND.FAMILY}_${f.op}_${f.relation}_${f.otherId}`;
    }

    function trimmed(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    // Shape whatever the form produced into the Person-ish subset a link_new
    // request carries. Mirrors the Add Person form in the Membership Directory,
    // minus everything that is never self-asserted: no tags, no Membership
    // Stage, no shepherding. What a person may propose about themselves is
    // exactly what a Linked User may later edit about themselves.
    function normalizeProposed(raw) {
        const r = raw || {};
        const contact = r.contact || {};
        return {
            name: trimmed(r.name),
            contact: {
                email: trimmed(r.email !== undefined ? r.email : contact.email),
                phone: trimmed(r.phone !== undefined ? r.phone : contact.phone),
                address: trimmed(r.address !== undefined ? r.address : contact.address),
            },
            birthday: trimmed(r.birthday) || null,
            sex: trimmed(r.sex) || null,
        };
    }

    function normalizeFamily(raw) {
        const f = raw || {};
        return {
            op: trimmed(f.op),
            relation: trimmed(f.relation),
            otherId: trimmed(f.otherId),
        };
    }

    // Is this draft something we are willing to write? Returns a reason rather
    // than a bare false so the form can say what is wrong.
    function validateDraft(draft) {
        const d = draft || {};
        if (!d.uid) return { ok: false, error: 'You must be signed in to make a request.' };

        if (d.kind === KIND.LINK_MATCH) {
            if (!d.personId) return { ok: false, error: 'Choose the directory record that is you.' };
            return { ok: true, error: null };
        }

        if (d.kind === KIND.LINK_NEW) {
            if (!normalizeProposed(d.proposed).name) {
                return { ok: false, error: 'Enter your full name.' };
            }
            return { ok: true, error: null };
        }

        if (d.kind === KIND.NAME_FIX) {
            if (!d.personId) return { ok: false, error: 'Your account is not connected to a directory record yet.' };
            const name = normalizeProposed(d.proposed).name;
            if (!name) return { ok: false, error: 'Enter the correct spelling of your name.' };
            if (name === trimmed(d.currentName)) {
                return { ok: false, error: 'That is the spelling we already have.' };
            }
            return { ok: true, error: null };
        }

        if (d.kind === KIND.FAMILY) {
            if (!d.personId) return { ok: false, error: 'Your account is not connected to a directory record yet.' };
            const f = normalizeFamily(d.family);
            if (FAMILY_OPS.indexOf(f.op) === -1) return { ok: false, error: 'Choose whether to add or remove this relation.' };
            if (FAMILY_RELATIONS.indexOf(f.relation) === -1) return { ok: false, error: 'Choose a relation: spouse, parent or child.' };
            if (!f.otherId) return { ok: false, error: 'Choose the person this relation is with.' };
            if (f.otherId === d.personId) return { ok: false, error: 'You cannot be your own ' + f.relation + '.' };
            return { ok: true, error: null };
        }

        return { ok: false, error: 'Choose what you would like to ask.' };
    }

    // The Firestore document body. The caller adds `createdAt` (a server
    // timestamp, which is not a plain value and so has no place in pure code).
    // Fields are always present — never conditionally omitted — because the
    // security rules match on shape, and an absent key reads differently from a
    // null one.
    function buildRequest(draft) {
        const check = validateDraft(draft);
        if (!check.ok) throw new Error(check.error);

        const kind = draft.kind;
        const carriesProposal = kind === KIND.LINK_NEW || kind === KIND.NAME_FIX;

        return {
            uid: draft.uid,
            email: trimmed(draft.email),
            kind: kind,
            status: STATUS.PENDING,
            // The Person this is ABOUT: the one being claimed for link_match, or
            // the requester's own for a name fix or a family change. Null for
            // link_new, which is asking for a Person to be made.
            personId: kind === KIND.LINK_NEW ? null : (draft.personId || null),
            proposed: carriesProposal ? normalizeProposed(draft.proposed) : null,
            family: kind === KIND.FAMILY ? normalizeFamily(draft.family) : null,
            note: trimmed(draft.note),
            resolvedBy: null,
            resolvedByEmail: null,
            declineReason: null,
        };
    }

    function isPending(request) {
        return !!request && request.status === STATUS.PENDING;
    }

    function isLinkKind(kind) {
        return LINK_KINDS.indexOf(kind) !== -1;
    }

    // Human words for a Family relation, from the requester's side.
    function familyRelationLabel(relation) {
        if (relation === 'spouse') return 'spouse';
        if (relation === 'parent') return 'parent';
        if (relation === 'child') return 'child';
        return relation || '';
    }

    // One line for the approver's inbox. `nameOf` resolves a Person id to a name
    // — only the caller can look those up.
    function summarize(request, nameOf) {
        if (!request) return '';
        const name = typeof nameOf === 'function' ? nameOf : function () { return null; };
        const who = name(request.personId) || request.email || '(unnamed)';

        if (request.kind === KIND.LINK_MATCH) {
            return `${request.email} says they are ${name(request.personId) || '(record no longer exists)'}`;
        }
        if (request.kind === KIND.LINK_NEW) {
            const proposedName = (request.proposed && request.proposed.name) || request.email;
            return `${request.email} is not in the directory and asks to be added as ${proposedName}`;
        }
        if (request.kind === KIND.NAME_FIX) {
            const to = (request.proposed && request.proposed.name) || '';
            return `${who} asks to be spelt “${to}”`;
        }
        if (request.kind === KIND.FAMILY) {
            const f = request.family || {};
            const other = name(f.otherId) || '(record no longer exists)';
            const rel = familyRelationLabel(f.relation);
            return f.op === 'remove' ?
                `${who} asks to remove ${other} as their ${rel}` :
                `${who} asks to record ${other} as their ${rel}`;
        }
        return '';
    }

    // What the requester sees while they wait, or after a decision. An approved
    // request is not described — by then the change is simply true, and the page
    // shows them the result instead.
    function statusMessage(request, nameOf) {
        if (!request) return '';
        if (request.status === STATUS.DECLINED) {
            return request.declineReason ?
                `This request was declined: ${request.declineReason}` :
                'This request was declined. Speak to the church office if that is a mistake.';
        }
        if (request.status !== STATUS.PENDING) return '';

        const name = typeof nameOf === 'function' ? nameOf : function () { return null; };
        if (request.kind === KIND.LINK_MATCH) {
            return `Waiting on the church to confirm you are ${name(request.personId) || 'that person'}.`;
        }
        if (request.kind === KIND.LINK_NEW) {
            return 'Waiting on the church to add you to the directory.';
        }
        if (request.kind === KIND.NAME_FIX) {
            const to = (request.proposed && request.proposed.name) || '';
            return `Waiting on the church to change your name to “${to}”.`;
        }
        if (request.kind === KIND.FAMILY) {
            const f = request.family || {};
            const other = name(f.otherId) || 'that person';
            const rel = familyRelationLabel(f.relation);
            return f.op === 'remove' ?
                `Waiting on the church to remove ${other} as your ${rel}.` :
                `Waiting on the church to record ${other} as your ${rel}.`;
        }
        return '';
    }

    const DirectoryRequestCore = {
        REQUEST_PATH,
        STATUS,
        KIND,
        KINDS,
        LINK_KINDS,
        LINKED_KINDS,
        FAMILY_RELATIONS,
        FAMILY_OPS,
        RESOLVER_LEVELS,
        canResolve,
        canRequest,
        requestId,
        normalizeProposed,
        normalizeFamily,
        validateDraft,
        buildRequest,
        isPending,
        isLinkKind,
        familyRelationLabel,
        summarize,
        statusMessage,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DirectoryRequestCore;
    }
    if (global) {
        global.DirectoryRequestCore = DirectoryRequestCore;
    }
})(typeof window !== 'undefined' ? window : null);
