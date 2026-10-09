// Permission catalog — stable keys for account levels (MS-695, ADR-0077).
// Loaded before account-levels-core.js and access-core.js in the browser.

(function (global) {
    'use strict';

    /** @type {readonly string[]} */
    const PERMISSION_KEYS = Object.freeze([
        'core.sign_in',
        'visibility.rung.public',
        'visibility.rung.member',
        'visibility.rung.participant',
        'visibility.rung.editor',
        'visibility.rung.elder',
        'visibility.lift_hidden_tags',
        'directory.view',
        'directory.edit_identity',
        'directory.edit_identity.assistant',
        'directory.resolve_requests',
        'shep.dashboard.view',
        'shep.profile.view',
        'shep.notes.view',
        'shep.documents.view',
        'shep.tasks.view',
        'shep.care_lists.view',
        'shep.relationships.view',
        'shep.forms.view',
        'shep.presence.view',
        'shep.notes.write',
        'shep.documents.write',
        'shep.tasks.write',
        'shep.care_lists.write',
        'shep.forms.write',
        'shep.panels.write',
        'shep.tags.manage',
        'shep.status.manage',
        'shep.views.manage',
        'shep.relationships.manage',
        'shep.elder_assignment.set',
        'shep.membership_stage.set',
        'shep.explain_changes',
        'shep.prayer.send',
        'shep.forms.lock_elder',
        'shep.guidance.lock',
        'shep.count_as_elder',
        'shep.elder_assignment.be_assignee',
        'calendar.view',
        'calendar.events.edit',
        'calendar.away.view',
        'calendar.away.edit',
        'services.builder.view',
        'services.builder.edit',
        'services.week_shift',
        'services.guidance.view',
        'hymns.view',
        'hymns.edit',
        'printables.view',
        'printables.edit',
        'roles.manager.view',
        'roles.manager.edit',
        'analytics.view',
        'admin.dashboard.access',
        'admin.sms.manage',
        'admin.push.manage',
        'admin.accounts.view',
        'admin.accounts.provision',
        'admin.accounts.assign_level',
        'admin.levels.manage',
        'admin.mcp.view',
        'system.kiosk',
        'system.super_admin',
    ]);

    const LABELS = Object.freeze(Object.fromEntries([
        ['core.sign_in', 'Sign in'],
        ['visibility.rung.public', 'See public content'],
        ['visibility.rung.member', 'See member-visible content'],
        ['visibility.rung.participant', 'See participant events'],
        ['visibility.rung.editor', 'See editor-visible events'],
        ['visibility.rung.elder', 'See elder-visible events'],
        ['visibility.lift_hidden_tags', 'See hidden tags and hidden people'],
        ['directory.view', 'Open membership directory'],
        ['directory.edit_identity', 'Edit directory identity (Edit Mode)'],
        ['directory.edit_identity.assistant', 'Edit name, contact, birthday (assistant)'],
        ['directory.resolve_requests', 'Approve directory requests'],
        ['shep.dashboard.view', 'Shepherd dashboard'],
        ['shep.profile.view', 'View pastoral profiles'],
        ['shep.notes.view', 'View shepherding notes'],
        ['shep.documents.view', 'View document library'],
        ['shep.tasks.view', 'View tasks'],
        ['shep.care_lists.view', 'View care lists'],
        ['shep.relationships.view', 'View relationships'],
        ['shep.forms.view', 'View forms library'],
        ['shep.presence.view', 'View shepherding presence'],
        ['shep.notes.write', 'Write shepherding notes'],
        ['shep.documents.write', 'Write documents and folders'],
        ['shep.tasks.write', 'Write tasks'],
        ['shep.care_lists.write', 'Write care lists'],
        ['shep.forms.write', 'Write form documents'],
        ['shep.panels.write', 'Write person panels'],
        ['shep.tags.manage', 'Manage tags'],
        ['shep.status.manage', 'Manage shepherding status'],
        ['shep.views.manage', 'Manage filtered views'],
        ['shep.relationships.manage', 'Manage relationship types'],
        ['shep.elder_assignment.set', 'Set shepherding elder assignment'],
        ['shep.membership_stage.set', 'Set membership stage'],
        ['shep.explain_changes', 'Explain status and tag changes'],
        ['shep.prayer.send', 'Send pastoral prayer SMS'],
        ['shep.forms.lock_elder', 'Shut forms to elders'],
        ['shep.guidance.lock', 'Lock service guidance to elders'],
        ['shep.count_as_elder', 'Count as an elder'],
        ['shep.elder_assignment.be_assignee', 'Appear as assignable shepherding elder'],
        ['calendar.view', 'View calendar'],
        ['calendar.events.edit', 'Create and edit events'],
        ['calendar.away.view', 'View away program'],
        ['calendar.away.edit', 'Edit away program'],
        ['services.builder.view', 'View service builder'],
        ['services.builder.edit', 'Edit services and liturgy'],
        ['services.week_shift', 'Week-shift tool'],
        ['services.guidance.view', 'View locked guidance'],
        ['hymns.view', 'View hymn directory'],
        ['hymns.edit', 'Edit hymns'],
        ['printables.view', 'View printables'],
        ['printables.edit', 'Edit printables'],
        ['roles.manager.view', 'View roles manager'],
        ['roles.manager.edit', 'Edit serving roles'],
        ['analytics.view', 'View analytics'],
        ['admin.dashboard.access', 'Admin dashboard'],
        ['admin.sms.manage', 'SMS and prayer templates'],
        ['admin.push.manage', 'Push notification admin'],
        ['admin.accounts.view', 'View accounts directory'],
        ['admin.accounts.provision', 'Provision and delete accounts'],
        ['admin.accounts.assign_level', 'Assign account levels'],
        ['admin.levels.manage', 'Manage custom account levels'],
        ['admin.mcp.view', 'MCP manager'],
        ['system.kiosk', 'Kiosk-only surface'],
        ['system.super_admin', 'Super admin (all keys)'],
    ]));

    /** UI sections (Variant A). */
    const CATEGORIES = Object.freeze([
        {
            id: 'core',
            title: 'Core and visibility',
            icon: 'visibility',
            keys: [
                'core.sign_in',
                'visibility.rung.public',
                'visibility.rung.member',
                'visibility.rung.participant',
                'visibility.rung.editor',
                'visibility.rung.elder',
                'visibility.lift_hidden_tags',
            ],
        },
        {
            id: 'directory',
            title: 'Membership directory',
            icon: 'contacts',
            keys: [
                'directory.view',
                'directory.edit_identity',
                'directory.edit_identity.assistant',
                'directory.resolve_requests',
            ],
        },
        {
            id: 'shep_read',
            title: 'Shepherding — read',
            icon: 'diversity_3',
            keys: [
                'shep.dashboard.view',
                'shep.profile.view',
                'shep.notes.view',
                'shep.documents.view',
                'shep.tasks.view',
                'shep.care_lists.view',
                'shep.relationships.view',
                'shep.forms.view',
                'shep.presence.view',
            ],
        },
        {
            id: 'shep_record',
            title: 'Shepherding — record write',
            icon: 'edit_note',
            keys: [
                'shep.notes.write',
                'shep.documents.write',
                'shep.tasks.write',
                'shep.care_lists.write',
                'shep.forms.write',
                'shep.panels.write',
            ],
        },
        {
            id: 'shep_decide',
            title: 'Shepherding — decide',
            icon: 'gavel',
            keys: [
                'shep.tags.manage',
                'shep.status.manage',
                'shep.views.manage',
                'shep.relationships.manage',
                'shep.elder_assignment.set',
                'shep.membership_stage.set',
                'shep.explain_changes',
                'shep.prayer.send',
                'shep.forms.lock_elder',
                'shep.guidance.lock',
                'shep.count_as_elder',
                'shep.elder_assignment.be_assignee',
            ],
        },
        {
            id: 'calendar',
            title: 'Calendar and services',
            icon: 'calendar_month',
            keys: [
                'calendar.view',
                'calendar.events.edit',
                'calendar.away.view',
                'calendar.away.edit',
                'services.builder.view',
                'services.builder.edit',
                'services.week_shift',
                'services.guidance.view',
                'hymns.view',
                'hymns.edit',
            ],
        },
        {
            id: 'printables',
            title: 'Printables and serving roles',
            icon: 'print',
            keys: [
                'printables.view',
                'printables.edit',
                'roles.manager.view',
                'roles.manager.edit',
            ],
        },
        {
            id: 'analytics',
            title: 'Analytics',
            icon: 'insights',
            keys: ['analytics.view'],
        },
        {
            id: 'admin',
            title: 'Admin and accounts',
            icon: 'admin_panel_settings',
            keys: [
                'admin.dashboard.access',
                'admin.sms.manage',
                'admin.push.manage',
                'admin.accounts.view',
                'admin.accounts.provision',
                'admin.accounts.assign_level',
                'admin.levels.manage',
                'admin.mcp.view',
            ],
        },
        {
            id: 'system',
            title: 'System',
            icon: 'settings',
            keys: ['system.kiosk', 'system.super_admin'],
        },
    ]);

    const SHEP_READ_KEYS = CATEGORIES.find(c => c.id === 'shep_read').keys;
    const SHEP_RECORD_KEYS = CATEGORIES.find(c => c.id === 'shep_record').keys;
    const SHEP_DECIDE_KEYS = CATEGORIES.find(c => c.id === 'shep_decide').keys
        .filter(k => k !== 'shep.count_as_elder' && k !== 'shep.elder_assignment.be_assignee');

    // MS-725 (Helm, option A): calendar.events.edit belongs on the Editor
    // preset. Editors have always edited Events; leaving the key off meant a
    // saved Editor map lost those doors the moment editsWith became keys-only.
    const EDITOR_SURFACE_KEYS = Object.freeze([
        'directory.edit_identity',
        'calendar.view',
        'calendar.events.edit',
        'calendar.away.view',
        'calendar.away.edit',
        'services.builder.view',
        'services.builder.edit',
        'services.guidance.view',
        'hymns.view',
        'hymns.edit',
        'printables.view',
        'printables.edit',
        'roles.manager.view',
        'roles.manager.edit',
        'shep.forms.view',
    ]);

    const ADMIN_KEYS = Object.freeze([
        'admin.dashboard.access',
        'admin.sms.manage',
        'admin.push.manage',
        'admin.accounts.view',
        'admin.accounts.provision',
        'admin.accounts.assign_level',
        'admin.levels.manage',
        'admin.mcp.view',
    ]);

    const PermissionCatalog = {
        PERMISSION_KEYS,
        LABELS,
        CATEGORIES,
        SHEP_READ_KEYS,
        SHEP_RECORD_KEYS,
        SHEP_DECIDE_KEYS,
        EDITOR_SURFACE_KEYS,
        ADMIN_KEYS,
        emptyPermissions() {
            const map = {};
            PERMISSION_KEYS.forEach(k => { map[k] = false; });
            return map;
        },
        allOn() {
            const map = {};
            PERMISSION_KEYS.forEach(k => { map[k] = true; });
            return map;
        },
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PermissionCatalog;
    }
    if (global) {
        global.PermissionCatalog = PermissionCatalog;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
