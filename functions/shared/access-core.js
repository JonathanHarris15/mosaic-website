// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/access-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Access Core — who may read as an elder, write the record, or count as an
// elder (MS-426, ADR-0065).
//
// Pastoral Assistant is a boolean grant on the User account
// (`users.pastoralAssistant`), stacked on Permission Level, not a new level.
// Every surface that used to ask its own rank list asks here instead, so a
// grant cannot be remembered in one place and forgotten in another.
//
// Four questions, from `permissionLevel` (legacy `role` fallback) plus the
// grant:
//
//   reads as elder     — elder / super admin, or Pastoral Assistant
//   reads as editor    — the editor ladder, or Pastoral Assistant
//   writes the record  — elder / super admin, or Pastoral Assistant
//                        (Elder Documents, Folders, Shepherding Notes, Tasks)
//   is an elder        — elder / super admin only (every decision, and every
//                        place that counts someone as an elder)
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
        eventRungsFor,
        liftsHidden,
        badgeLabel,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AccessCore;
    }
    if (global) {
        global.AccessCore = AccessCore;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
