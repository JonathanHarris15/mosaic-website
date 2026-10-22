// The phone's destinations — one list, two drawer renderings (app + shell).
//
// Gates, hrefs, labels, and drawer order live in dashboard-nav.js. This file
// only carries what the phone needs on top (lucide icons, routes, role labels)
// and re-exports the shared list so mobile.html and shell pages can load it
// without Preact.

(function (root) {
    'use strict';

    function dashboardNav() {
        if (typeof require === 'function') {
            return require('../dashboard-nav.js');
        }
        if (root && root.DashboardNav) {
            return root.DashboardNav;
        }
        throw new Error('dashboard-nav.js must load before MosaicDestinations is read');
    }

    // What a permission level is CALLED to the person holding it.
    const ROLE_LABELS = {
        super_admin: 'Super Admin',
        admin: 'Administrator',
        elder: 'Elder',
        pastoral_assistant: 'Pastoral Assistant',
        editor: 'Editor',
        member: 'Member',
        viewer: 'Member',
        kiosk: 'Kiosk',
    };

    function roleLabel(permissionLevel) {
        return ROLE_LABELS[permissionLevel] || 'Member';
    }

    function accessCore() {
        if (typeof window === 'undefined' && typeof require === 'function') {
            return require('../access-core.js');
        }
        return root.AccessCore;
    }

    function accountLabel(account) {
        const Access = accessCore();
        const level = account && typeof account === 'object'
            ? (Access ? Access.permissionLevelOf(account) : 'viewer')
            : account;
        const role = roleLabel(level);
        const badge = Access ? Access.badgeLabel(account) : '';
        return badge ? role + ' · ' + badge : role;
    }

    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    const DRAWER_HEAD = Object.freeze(['avatar', 'name', 'roleLabel']);

    let cachedDestinations = null;

    function getDestinations() {
        if (!cachedDestinations) {
            cachedDestinations = dashboardNav().mobileDrawerDestinations();
        }
        return cachedDestinations;
    }

    function canSee(item, user) {
        if (!item || !item.key) return false;
        return dashboardNav().canSeeDrawerKey(item.key, user);
    }

    function routeHref(route) {
        return dashboardNav().mobileRouteHref(route);
    }

    function getShellPages() {
        return dashboardNav().MOBILE_SHELL_PAGES;
    }

    const Destinations = {
        get DESTINATIONS() { return getDestinations(); },
        get SHELL_PAGES() { return getShellPages(); },
        ROLE_LABELS,
        DRAWER_HEAD,
        canSee,
        routeHref,
        roleLabel,
        accountLabel,
        initials,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Destinations;
    if (root) root.MosaicDestinations = Destinations;
})(typeof window !== 'undefined' ? window : globalThis);
