// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/access-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Access Core — who may read as an elder, write the record, decide in
// software, write as an editor, or count as an elder (ADR-0076, MS-695).
//
// Pastoral Assistant is a Permission Level (`pastoral_assistant`), chosen
// the same way as editor, elder, admin, and super admin. It is not a
// checkbox. A leftover `users.pastoralAssistant` flag still counts, so an
// account granted the old way keeps the doors until an admin sets the role.
//
// MS-695: helpers resolve from the permission catalog when `permissions` or
// `accountLevelId` is present; legacy `permissionLevel` strings still work.
//
// Loaded as a classic <script> (window.AccessCore) and exported for Node.
// Firestore / Storage cannot import this file; they restate the helpers and
// tests pin the restatement.

(function (global) {
    'use strict';

    const Levels = (typeof require !== 'undefined')
        ? require('./account-levels-core.js')
        : (global.AccountLevelsCore || null);

    const PASTORAL_ASSISTANT_LEVEL = 'pastoral_assistant';
    const PASTORAL_ASSISTANT_LABEL = 'Pastoral Assistant';

    const EDITOR_WRITE_LEVELS = Object.freeze([
        'editor', 'admin', 'elder', 'super_admin', PASTORAL_ASSISTANT_LEVEL,
    ]);

    const ELDER_LEVELS = Object.freeze(['elder', 'super_admin']);

    const VISIBILITY_RUNGS = Object.freeze([
        'public', 'member', 'participant', 'editor', 'elder',
    ]);

    const RUNGS_BY_LEVEL = Object.freeze({
        viewer: ['public'],
        member: ['public', 'member'],
        editor: ['public', 'member', 'participant', 'editor'],
        admin: ['public', 'member', 'participant', 'editor'],
        elder: ['public', 'member', 'participant', 'editor', 'elder'],
        super_admin: ['public', 'member', 'participant', 'editor', 'elder'],
        pastoral_assistant: ['public', 'member', 'participant', 'editor', 'elder'],
    });

    // MS-725 (ADR 0082): what the STORED users/{uid} document said, which is
    // all firestore.rules can see. AccountLevelsCore owns both (it owns what a
    // stored document means); these two are the way in from here.
    //
    // ⚠ A SAVED MAP IS NOT THE SAME THING AS `permissions` BEING PRESENT ON
    // THE OBJECT IN HAND. normalizeAccount() synthesises one from the preset
    // for a legacy account, and auth.js hands every page the EFFECTIVE map, so
    // by the time a page asks, a legacy editor looks like they carry one.
    function savedPermissionMap(value) {
        return Levels ? Levels.savedPermissionMap(value) : null;
    }

    function storedPermissionLevel(value) {
        if (Levels) return Levels.storedPermissionLevel(value);
        if (!value || typeof value !== 'object') {
            return typeof value === 'string' ? value : null;
        }
        return value.permissionLevel || value.role || null;
    }

    function storedPastoralAssistant(value) {
        return storedPermissionLevel(value) === PASTORAL_ASSISTANT_LEVEL
            || !!(value && typeof value === 'object'
                && value.pastoralAssistant === true);
    }

    function accountOf(value) {
        if (!Levels) {
            if (!value || typeof value !== 'object') {
                const level = typeof value === 'string' ? value : null;
                return { permissionLevel: level, pastoralAssistant: false };
            }
            return {
                permissionLevel: value.permissionLevel || value.role || null,
                pastoralAssistant: value.pastoralAssistant === true,
            };
        }
        const norm = Levels.normalizeAccount(value);
        return {
            permissionLevel: norm.permissionLevel,
            pastoralAssistant: norm.pastoralAssistant,
            accountLevelId: norm.accountLevelId,
            permissions: norm.permissions,
            // Carried so pageFlags().account can be handed back to a gate and
            // still answer the question the rules would answer.
            savedPermissions: savedPermissionMap(value),
            storedLevel: storedPermissionLevel(value),
        };
    }

    function permissionLevelOf(value) {
        return accountOf(value).permissionLevel;
    }

    function isPastoralAssistant(value) {
        const account = accountOf(value);
        if (account.permissionLevel === PASTORAL_ASSISTANT_LEVEL) return true;
        if (account.pastoralAssistant === true) return true;
        return false;
    }

    function legacyIsAnElder(level) {
        return ELDER_LEVELS.indexOf(level) !== -1;
    }

    function isAnElder(value) {
        const account = accountOf(value);
        if (Levels && account.permissions) {
            return Levels.hasPermission(account, 'shep.count_as_elder');
        }
        return legacyIsAnElder(account.permissionLevel);
    }

    function legacyWritesAsEditor(level) {
        return EDITOR_WRITE_LEVELS.indexOf(level) !== -1;
    }

    function writesAsEditor(value) {
        const account = accountOf(value);
        if (Levels && account.permissions) {
            if (Levels.hasPermission(account, 'directory.edit_identity')) return true;
            if (Levels.hasPermission(account, 'printables.edit')) return true;
            if (Levels.hasPermission(account, 'roles.manager.edit')) return true;
            if (Levels.hasPermission(account, 'services.builder.edit')) return true;
            return false;
        }
        return legacyWritesAsEditor(account.permissionLevel)
            || isPastoralAssistant(value);
    }

    function readsAsElder(value) {
        const account = accountOf(value);
        if (Levels && account.permissions) {
            return Levels.hasPermission(account, 'visibility.lift_hidden_tags');
        }
        return legacyIsAnElder(account.permissionLevel) || isPastoralAssistant(value);
    }

    function readsAsEditor(value) {
        return writesAsEditor(value) || isPastoralAssistant(value);
    }

    function writesTheRecord(value) {
        const account = accountOf(value);
        if (Levels && account.permissions) {
            return Levels.hasPermission(account, 'shep.notes.write');
        }
        return legacyIsAnElder(account.permissionLevel) || isPastoralAssistant(value);
    }

    function canDecide(value) {
        const account = accountOf(value);
        if (Levels && account.permissions) {
            return Levels.hasPermission(account, 'shep.tags.manage');
        }
        return legacyIsAnElder(account.permissionLevel) || isPastoralAssistant(value);
    }

    function eventRungsFor(value) {
        const account = accountOf(value);
        if (Levels && account.permissions) {
            const perms = Levels.effectivePermissions(account);
            const rungs = [];
            if (perms['visibility.rung.public']) rungs.push('public');
            if (perms['visibility.rung.member']) rungs.push('member');
            if (perms['visibility.rung.participant']) rungs.push('participant');
            if (perms['visibility.rung.editor']) rungs.push('editor');
            if (perms['visibility.rung.elder']) rungs.push('elder');
            return rungs.length ? rungs : ['public'];
        }
        if (readsAsElder(value)) return VISIBILITY_RUNGS.slice();
        const listed = RUNGS_BY_LEVEL[permissionLevelOf(value)];
        return (listed || ['public']).slice();
    }

    function liftsHidden(value) {
        return readsAsElder(value);
    }

    function badgeLabel(value) {
        const account = accountOf(value);
        if (account.permissionLevel === PASTORAL_ASSISTANT_LEVEL) return '';
        return account.pastoralAssistant === true ? PASTORAL_ASSISTANT_LABEL : '';
    }

    function hasPermission(value, key) {
        const account = accountOf(value);
        if (Levels) return Levels.hasPermission(account, key);
        return false;
    }

    function accessesAdminDashboard(value) {
        const account = accountOf(value);
        if (Levels && account.permissions) {
            return Levels.hasPermission(account, 'admin.dashboard.access');
        }
        const level = account.permissionLevel;
        return level === 'admin' || level === 'super_admin';
    }

    function canViewDirectory(value) {
        const account = accountOf(value);
        if (Levels && account.permissions) {
            return Levels.hasPermission(account, 'directory.view');
        }
        const level = account.permissionLevel || 'viewer';
        return [
            'member', 'editor', 'elder', 'admin', 'super_admin',
            PASTORAL_ASSISTANT_LEVEL,
        ].indexOf(level) !== -1;
    }

    // MS-725 (ADR 0082): the mirror of firestore.rules editsWith(key), clause
    // for clause, so a page never offers a control the rules will refuse and
    // never hides one they would allow. Any new write gate on one of the
    // nineteen doors goes through here rather than growing its own shape.
    //
    // The saved map is the whole answer when there is one. There is no OR on
    // the level names beside it, and no overlay: not the Pastoral Assistant
    // grant, not the preset recompute effectivePermissions() does for a
    // builtin rung. The rules read a raw map and so does this.
    function writesWith(value, key) {
        const saved = savedPermissionMap(value);
        if (saved) return saved[key] === true;
        return legacyWritesAsEditor(storedPermissionLevel(value))
            || storedPastoralAssistant(value);
    }

    function canFixSundayService(value) {
        return writesWith(value, 'services.builder.edit');
    }

    // MS-720 (ADR 0081): who may change an Event's details.
    function canEditEvents(value) {
        return writesWith(value, 'calendar.events.edit');
    }

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
        savedPermissionMap,
        storedPermissionLevel,
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
        hasPermission,
        accessesAdminDashboard,
        canViewDirectory,
        writesWith,
        canFixSundayService,
        canEditEvents,
        pageFlags,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AccessCore;
    }
    if (global) {
        global.AccessCore = AccessCore;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
