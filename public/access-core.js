// Access Core — who may read as an elder, write the record, decide in
// software, write as an editor, or count as an elder (ADR-0076, MS-695).
//
// MS-776: every door is accountLevelId plus the saved permissions map
// (ADR 0082, extended). role, permissionLevel, and pastoralAssistant on a
// document grant nothing. A rank-label string ('editor', 'level_editor') is
// that builtin preset — the label accessRank already produced — and is not a
// read of the stored ladder.
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

    const MEMBER_READ_LEVELS = Object.freeze([
        'member', 'editor', 'admin', 'elder', 'super_admin',
        PASTORAL_ASSISTANT_LEVEL,
    ]);

    const WEEK_TOOL_PRESETS = Object.freeze([
        'editor', 'admin', 'elder', 'super_admin', PASTORAL_ASSISTANT_LEVEL,
    ]);

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
        kiosk: ['public'],
    });

    function emptyMap() {
        return {};
    }

    function mapOf(value) {
        if (!Levels) return emptyMap();
        return Levels.accessMap(value);
    }

    function keyOn(value, key) {
        return mapOf(value)[key] === true;
    }

    function accountOf(value) {
        if (!Levels) {
            return {
                permissionLevel: 'viewer',
                pastoralAssistant: false,
                accountLevelId: null,
                permissions: emptyMap(),
            };
        }
        return Levels.normalizeAccount(value);
    }

    function permissionLevelOf(value) {
        return accountOf(value).permissionLevel || 'viewer';
    }

    function isPastoralAssistant(value) {
        return permissionLevelOf(value) === PASTORAL_ASSISTANT_LEVEL;
    }

    function isEditorAccount(value) {
        const rank = permissionLevelOf(value);
        return EDITOR_WRITE_LEVELS.indexOf(rank) !== -1
            || keyOn(value, 'directory.edit_identity')
            || keyOn(value, 'printables.edit')
            || keyOn(value, 'services.builder.edit')
            || keyOn(value, 'roles.manager.edit')
            || keyOn(value, 'hymns.edit');
    }

    function isAnElder(value) {
        return keyOn(value, 'shep.count_as_elder');
    }

    function writesAsEditor(value) {
        return isEditorAccount(value);
    }

    function readsAsElder(value) {
        return keyOn(value, 'visibility.lift_hidden_tags') || isPastoralAssistant(value);
    }

    function readsAsEditor(value) {
        return keyOn(value, 'directory.edit_identity')
            || keyOn(value, 'printables.edit')
            || isPastoralAssistant(value)
            || isEditorAccount(value);
    }

    function writesTheRecord(value) {
        return keyOn(value, 'shep.notes.write') || isPastoralAssistant(value);
    }

    function canDecide(value) {
        return keyOn(value, 'shep.tags.manage') || isPastoralAssistant(value);
    }

    function eventRungsFor(value) {
        if (typeof value === 'string' && RUNGS_BY_LEVEL[value]) {
            return RUNGS_BY_LEVEL[value].slice();
        }
        const perms = mapOf(value);
        const rungs = [];
        if (perms['visibility.rung.public']) rungs.push('public');
        if (perms['visibility.rung.member']) rungs.push('member');
        if (perms['visibility.rung.participant']) rungs.push('participant');
        if (perms['visibility.rung.editor']) rungs.push('editor');
        if (perms['visibility.rung.elder']) rungs.push('elder');
        if (rungs.indexOf('public') === -1) rungs.unshift('public');
        return rungs;
    }

    function liftsHidden(value) {
        return readsAsElder(value);
    }

    function badgeLabel() {
        return '';
    }

    function hasPermission(value, key) {
        return keyOn(value, key);
    }

    function accessesAdminDashboard(value) {
        const rank = permissionLevelOf(value);
        return rank === 'admin' || rank === 'super_admin'
            || keyOn(value, 'admin.dashboard.access');
    }

    function canViewDirectory(value) {
        return keyOn(value, 'directory.view');
    }

    // The saved map is the whole answer. There is no OR on level names.
    function writesWith(value, key) {
        return keyOn(value, key);
    }

    function canFixSundayService(value) {
        return writesWith(value, 'services.builder.edit');
    }

    // MS-770: Import / Inject / Remove. The week_shift key opens them.
    // A builtin editor-family account level also opens them when the account
    // can edit the Sunday table, so the editor preset keeps the toolbar
    // without reading permissionLevel. A custom level does not, unless the
    // key itself is on.
    function canUseServiceCalendarWeekTools(value) {
        const account = accountOf(value);
        if (writesWith(account, 'services.week_shift')) return true;
        if (!writesWith(account, 'services.builder.edit')) return false;
        if (!Levels) return false;
        const preset = Levels.presetKeyFromAccountLevelId(account.accountLevelId);
        return WEEK_TOOL_PRESETS.indexOf(preset) !== -1;
    }

    function canEditEvents(value) {
        return writesWith(value, 'calendar.events.edit');
    }

    function readsAsMember(value) {
        const rank = permissionLevelOf(value);
        return MEMBER_READ_LEVELS.indexOf(rank) !== -1
            || keyOn(value, 'directory.view')
            || keyOn(value, 'visibility.rung.member')
            || isEditorAccount(value);
    }

    function canEditResources(value) {
        return writesWith(value, 'resources.edit');
    }

    function pageFlags(userData) {
        const account = accountOf(userData);
        return {
            account: account,
            currentPermissionLevel: account.permissionLevel || 'viewer',
            pastoralAssistant: account.pastoralAssistant,
            canReadElder: readsAsElder(userData),
            canDecide: canDecide(userData),
            canWriteRecord: writesTheRecord(userData),
            canWriteEditor: writesAsEditor(userData),
            canReadEditor: readsAsEditor(userData),
        };
    }

    const AccessCore = {
        PASTORAL_ASSISTANT_LEVEL,
        PASTORAL_ASSISTANT_LABEL,
        EDITOR_WRITE_LEVELS,
        ELDER_LEVELS,
        MEMBER_READ_LEVELS,
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
        hasPermission,
        accessesAdminDashboard,
        canViewDirectory,
        writesWith,
        canFixSundayService,
        canUseServiceCalendarWeekTools,
        canEditEvents,
        readsAsMember,
        canEditResources,
        pageFlags,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AccessCore;
    }
    if (global) {
        global.AccessCore = AccessCore;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
