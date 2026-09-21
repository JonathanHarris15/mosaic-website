// Phone Directory Requests — what the phone Membership Directory shows for
// a Directory Request, and when it may disconnect an account (MS-618).
//
// The summary, the approval, and the unlink stay where they already are.
// This plan only answers what the page should not invent: who sees the
// queue, how a request is labelled, which button a New record gets, which
// people Already on file may offer, and the words Decline and Disconnect
// already use on the computer. It does not approve a request and it does
// not break a login.
//
// Loaded as a classic script (window.PhoneDirectoryRequests) and exported
// for Node.

(function (global) {
    'use strict';

    const ACCOUNT = 'Account';
    const CONFIRM = 'Confirm';
    const ADD_AND_CONNECT = 'Add & connect';
    const ALREADY_ON_FILE = 'Already on file…';
    const DECLINE_QUESTION = 'Why are you declining? This is shown to the person who asked (optional).';
    const OVERRIDE_QUESTION = 'Connect them to an existing record instead.';
    const NO_MATCH = 'No unclaimed record by that name.';
    const APPROVED = 'Request approved';
    const DECLINED = 'Request declined';
    const RESOLVE_FAILED = 'Could not resolve that request';
    const DISCONNECT_FAILED = 'Could not disconnect that account';
    const DISCONNECTED = 'Account disconnected';
    const QUEUE_FAILED = "Couldn't load Directory Requests. It did not work.";
    const DIRECTORY_FAILED = "Couldn't load the directory. It did not work.";
    const KEEP = 'They will keep their directory record, their membership and every shepherding note — they just will not be signed in as this person any more. You can reconnect an account afterwards.';
    const SEARCH_LIMIT = 15;

    const LABEL = {
        link_match: 'Connect',
        link_new: 'New record',
        name_fix: 'Name',
        family: 'Family',
    };

    function requests() {
        if (global && global.DirectoryRequestCore) return global.DirectoryRequestCore;
        return null;
    }

    function access() {
        return global && global.AccessCore;
    }

    // The same set that may turn Edit Mode on. The switch is not the gate:
    // answering a request is not editing a person, so this does not read it.
    function offerQueue(user) {
        return !!(access() && access().writesAsEditor(user));
    }

    function hasLogin(person) {
        return !!(person && person.userId);
    }

    // The Account mark and the disconnect. Edit Mode, a login, and the
    // editor set. The mark does not name the account.
    function offerAccount(user, editMode, person) {
        return !!(editMode && offerQueue(user) && hasLogin(person));
    }

    function showQueue(user, editMode, pending) {
        return offerQueue(user) && oldestFirst(pending).length > 0;
    }

    function labelOf(request) {
        const kind = request && request.kind;
        if (LABEL[kind]) return LABEL[kind];
        return kind || '';
    }

    function summaryOf(request, nameOf) {
        const core = requests();
        return core ? core.summarize(request, nameOf) : '';
    }

    function confirmLabel(request) {
        return request && request.kind === 'link_new' ? ADD_AND_CONNECT : CONFIRM;
    }

    function offerAlreadyOnFile(request) {
        return !!(request && request.kind === 'link_new');
    }

    function proposedContact(request) {
        if (!request || request.kind !== 'link_new' || !request.proposed) return '';
        const contact = request.proposed.contact || {};
        return [contact.email, contact.phone, contact.address].filter(Boolean).join(' · ');
    }

    function noteOf(request) {
        const note = request && request.note;
        return typeof note === 'string' ? note.trim() : '';
    }

    function createdSeconds(request) {
        const at = request && request.createdAt;
        if (!at) return 0;
        if (typeof at.seconds === 'number') return at.seconds;
        return 0;
    }

    function oldestFirst(pending) {
        return (pending || []).slice().sort((a, b) => createdSeconds(a) - createdSeconds(b));
    }

    function searchStartsAs(request) {
        const proposed = request && request.proposed;
        const name = proposed && proposed.name;
        return typeof name === 'string' ? name : '';
    }

    function unclaimedSearch(people, query) {
        const q = String(query == null ? '' : query).toLowerCase().trim();
        if (!q) return [];
        return (people || [])
            .filter((person) => !person.userId && String(person.name || '').toLowerCase().includes(q))
            .slice(0, SEARCH_LIMIT);
    }

    function noMatch(query, hits) {
        const q = String(query == null ? '' : query).trim();
        if (!q || (hits && hits.length)) return '';
        return NO_MATCH;
    }

    // null is the prompt's cancel. A blank answer still declines, and no
    // reason is stored.
    function declineAnswer(promptResult) {
        if (promptResult == null) return { write: false, reason: null };
        const reason = String(promptResult).trim();
        return { write: true, reason: reason || null };
    }

    function disconnectMessage(name) {
        return 'Disconnect the website account from ' + (name || '') + '?\n\n' + KEEP;
    }

    function wordsOf(error, fallback) {
        const message = error && typeof error === 'object' ? error.message : error;
        if (typeof message === 'string' && message.trim()) return message.trim();
        return fallback;
    }

    function refusalWords(error) {
        return wordsOf(error, RESOLVE_FAILED);
    }

    function disconnectRefusal(error) {
        return wordsOf(error, DISCONNECT_FAILED);
    }

    function outcomeMessage(decision) {
        return decision === 'approve' ? APPROVED : DECLINED;
    }

    function queueAfter(pending, requestId, succeeded) {
        const list = (pending || []).slice();
        if (!succeeded) return list;
        return list.filter((request) => request.id !== requestId);
    }

    function personAfterDisconnect(person, succeeded) {
        if (!succeeded || !person) return person;
        const next = Object.assign({}, person);
        next.userId = null;
        return next;
    }

    function mayAnswer(answeringId, requestId) {
        return !answeringId || answeringId !== requestId;
    }

    function mayDisconnect(busy) {
        return !busy;
    }

    function resolveCall(request, decision, personId, reason) {
        return {
            callable: 'resolveDirectoryRequest',
            data: {
                requestId: request && request.id,
                decision: decision,
                personId: personId || null,
                reason: reason || null,
            },
        };
    }

    function unlinkCall(personId) {
        return {
            callable: 'unlinkDirectoryPerson',
            data: { personId: personId },
        };
    }

    const PhoneDirectoryRequests = {
        ACCOUNT,
        CONFIRM,
        ADD_AND_CONNECT,
        ALREADY_ON_FILE,
        DECLINE_QUESTION,
        OVERRIDE_QUESTION,
        NO_MATCH,
        APPROVED,
        DECLINED,
        RESOLVE_FAILED,
        DISCONNECT_FAILED,
        DISCONNECTED,
        QUEUE_FAILED,
        DIRECTORY_FAILED,
        SEARCH_LIMIT,
        offerQueue,
        offerAccount,
        showQueue,
        labelOf,
        summaryOf,
        confirmLabel,
        offerAlreadyOnFile,
        proposedContact,
        noteOf,
        oldestFirst,
        searchStartsAs,
        unclaimedSearch,
        noMatch,
        declineAnswer,
        disconnectMessage,
        refusalWords,
        disconnectRefusal,
        outcomeMessage,
        queueAfter,
        personAfterDisconnect,
        mayAnswer,
        mayDisconnect,
        resolveCall,
        unlinkCall,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PhoneDirectoryRequests;
    }
    if (global) {
        global.PhoneDirectoryRequests = PhoneDirectoryRequests;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
