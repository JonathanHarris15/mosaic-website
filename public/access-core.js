// Access Core — who may read as an elder, write the record, decide in
// software, write as an editor, or count as an elder (ADR-0076).
//
// Pastoral Assistant is a Permission Level (`pastoral_assistant`), chosen
// the same way as editor, elder, admin, and super admin. It is not a
// checkbox. A leftover `users.pastoralAssistant` flag still counts, so an
// account granted the old way keeps the doors until an admin sets the role.
//
//   reads as elder     — elder / super admin, or Pastoral Assistant
//   reads as editor    — the editor ladder, or Pastoral Assistant
//   writes as editor   — the editor ladder, or Pastoral Assistant
//                        (the same editorial permissions an elder has)
//   writes the record  — elder / super admin, or Pastoral Assistant
//   can decide         — elder / super admin, or Pastoral Assistant
//   is an elder        — elder / super admin only (counted as an elder:
//                        Elder Tag, pickers, Elder Digest, Relations Viewer)
//
// Event visibility rungs and hidden-tag lifting follow reads-as-elder.
//
// Loaded as a classic <script> (window.AccessCore) and exported for Node.
// Firestore / Storage cannot import this file; they restate the helpers and
// tests pin the restatement.

(function (global) {
    'use strict';

    const PASTORAL_ASSISTANT_LEVEL = 'pastoral_assistant';
    const PASTORAL_ASSISTANT_LABEL = 'Pastoral Assistant';

    const EDITOR_WRITE_LEVELS = Object.freeze([
        'editor', 'admin', 'elder', 'super_admin', PASTORAL_ASSISTANT_LEVEL,
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
        pastoral_assistant: ['public', 'member', 'participant', 'editor', 'elder'],
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
        const account = accountOf(value);
        return account.permissionLevel === PASTORAL_ASSISTANT_LEVEL
            || account.pastoralAssistant === true;
    }

    function isAnElder(value) {
        return ELDER_LEVELS.indexOf(permissionLevelOf(value)) !== -1;
    }

    function writesAsEditor(value) {
        return EDITOR_WRITE_LEVELS.indexOf(permissionLevelOf(value)) !== -1
            || isPastoralAssistant(value);
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

    // The role's own name is Pastoral Assistant. The badge is only for an
    // account that still carries the old flag on some other level.
    function badgeLabel(value) {
        const account = accountOf(value);
        if (account.permissionLevel === PASTORAL_ASSISTANT_LEVEL) return '';
        return account.pastoralAssistant === true ? PASTORAL_ASSISTANT_LABEL : '';
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
        PASTORAL_ASSISTANT_LEVEL,
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
