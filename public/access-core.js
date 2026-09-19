// Access Core — who may read as an elder, write the record, decide in
// software, or count as an elder (MS-426, ADR-0065, MS-594).
//
// Pastoral Assistant is a boolean grant on the User account
// (`users.pastoralAssistant`), stacked on Permission Level, not a new level.
// Every surface that used to ask its own rank list asks here instead, so a
// grant cannot be remembered in one place and forgotten in another.
//
// Five questions, from `permissionLevel` (legacy `role` fallback) plus the
// grant:
//
//   reads as elder     — elder / super admin, or Pastoral Assistant
//   reads as editor    — the editor ladder, or Pastoral Assistant
//   writes the record  — elder / super admin, or Pastoral Assistant
//                        (Elder Documents, Folders, Shepherding Notes, Tasks)
//   can decide         — elder / super admin, or Pastoral Assistant
//                        (shepherding decision/write actions in software;
//                        MS-594 overrides the MS-426 denial)
//   is an elder        — elder / super admin only (counted as an elder:
//                        Elder Tag, pickers, Elder Digest)
//
// writes as editor stays the existing editor ladder; the grant adds nothing
// to it. Event visibility rungs and hidden-tag lifting follow reads-as-elder.
//
// Loaded as a classic <script> (window.AccessCore) and exported for Node.
// Firestore / Storage cannot import this file; they restate the helpers and
// tests pin the restatement.

(function (global) {
    'use strict';

    const PASTORAL_ASSISTANT_LABEL = 'Pastoral Assistant';

    const EDITOR_WRITE_LEVELS = Object.freeze([
        'editor', 'admin', 'elder', 'super_admin',
    ]);

    const ELDER_LEVELS = Object.freeze(['elder', 'super_admin']);

    const VISIBILITY_RUNGS = Object.freeze([
        'public', 'member', 'participant', 'editor', 'elder',
    ]);

    // Which rungs a Permission Level satisfies BY RANK, without the grant.
    // `participant` is not answerable by rank for a member — the Calendar
    // still runs a second query — but everyone above participant sees
    // participant-level Events without holding a Role.
    const RUNGS_BY_LEVEL = Object.freeze({
        viewer: ['public'],
        member: ['public', 'member'],
        editor: ['public', 'member', 'participant', 'editor'],
        admin: ['public', 'member', 'participant', 'editor'],
        elder: ['public', 'member', 'participant', 'editor', 'elder'],
        super_admin: ['public', 'member', 'participant', 'editor', 'elder'],
    });

    function accountOf(value) {
        if (!value || typeof value !== 'object') {
            const level = typeof value === 'string' ? value : null;
            return { permissionLevel: level, pastoralAssistant: false };
        }
        return {
            permissionLevel: value.permissionLevel || value.role || null,
            pastoralAssistant: value.pastoralAssistant === true,
        };
    }

    function permissionLevelOf(value) {
        return accountOf(value).permissionLevel;
    }

    function isPastoralAssistant(value) {
        return accountOf(value).pastoralAssistant === true;
    }

    function isAnElder(value) {
        return ELDER_LEVELS.indexOf(permissionLevelOf(value)) !== -1;
    }

    function writesAsEditor(value) {
        return EDITOR_WRITE_LEVELS.indexOf(permissionLevelOf(value)) !== -1;
    }

    function readsAsElder(value) {
        return isAnElder(value) || isPastoralAssistant(value);
    }

    function readsAsEditor(value) {
        return writesAsEditor(value) || isPastoralAssistant(value);
    }

    function writesTheRecord(value) {
        return isAnElder(value) || isPastoralAssistant(value);
    }

    // MS-594: a Pastoral Assistant has elder software powers for shepherding
    // decision/write actions. They still do not *count* as an elder.
    function canDecide(value) {
        return isAnElder(value) || isPastoralAssistant(value);
    }

    function eventRungsFor(value) {
        if (readsAsElder(value)) return VISIBILITY_RUNGS.slice();
        const listed = RUNGS_BY_LEVEL[permissionLevelOf(value)];
        return (listed || ['public']).slice();
    }

    function liftsHidden(value) {
        return readsAsElder(value);
    }

    function badgeLabel(value) {
        return isPastoralAssistant(value) ? PASTORAL_ASSISTANT_LABEL : '';
    }

    // What a page stores after reading users/{uid}. One object so sixty
    // Alpine/Preact surfaces do not each invent a different flag name.
    function pageFlags(userData) {
        const account = accountOf(userData);
        return {
            account: account,
            currentPermissionLevel: account.permissionLevel || 'viewer',
            pastoralAssistant: account.pastoralAssistant,
            canReadElder: readsAsElder(account),
            canDecide: canDecide(account),
            canWriteRecord: writesTheRecord(account),
            canWriteEditor: writesAsEditor(account),
            canReadEditor: readsAsEditor(account),
        };
    }

    const AccessCore = {
        PASTORAL_ASSISTANT_LABEL,
        EDITOR_WRITE_LEVELS,
        ELDER_LEVELS,
        VISIBILITY_RUNGS,
        accountOf,
        permissionLevelOf,
        isPastoralAssistant,
        isAnElder,
        writesAsEditor,
        readsAsElder,
        readsAsEditor,
        writesTheRecord,
        canDecide,
        eventRungsFor,
        liftsHidden,
        badgeLabel,
        pageFlags,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AccessCore;
    }
    if (global) {
        global.AccessCore = AccessCore;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
