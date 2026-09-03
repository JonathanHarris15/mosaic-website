// The phone's destinations — the one list the drawer is built from.
//
// There are TWO drawers, and they cannot be one. The app's (mobile/app.js) is a
// Preact panel inside mobile.html; the shell's (mobile-shell-header.js) is plain
// DOM on a desktop page opened with ?shell=mobile. A desktop page is a separate
// document, so it cannot render the app's component — and a drawer that sends
// you to the home screen to open is a drawer that moves the ground under you.
//
// So the CHROME is written twice and the LIST is written once, here. Everything
// that can drift into a lie — which destinations exist, who may see them, and
// where each one actually goes — lives in this file and nowhere else.
//
// No dependencies: the app has Preact, htm and lucide; a shell page has none of
// them (lucide alone is 400KB, which is not a price six drawer icons pay). That
// is why each entry carries both an `icon` (lucide, for the app) and a `symbol`
// (Material Symbols, for the shell) — one row, both renderings.

(function (global) {
    'use strict';

    // ⚠ TWO CALENDARS, AND THE ROUTE NAMES LIE ABOUT WHICH IS WHICH.
    //
    // Route "calendar" is the SERVICES screen — every Sunday and its order of
    // service. It predates MS-99 and was only relabelled, because the route is
    // what deep links and the native screen registry navigate by.
    //
    // Route "events" is the Calendar proper: everything on at church. Reading
    // these two the other way round is the mistake this comment exists to stop.
    const DESTINATIONS = [
        { key: 'home', label: 'Home', icon: 'house', symbol: 'home', route: 'home' },
        { key: 'hymn-directory', label: 'Hymn Directory', icon: 'book-open', symbol: 'menu_book', route: 'hymnDirectory' },
        { key: 'calendar', label: 'Services', icon: 'church', symbol: 'church', route: 'calendar' },
        { key: 'events', label: 'Calendar', icon: 'calendar-days', symbol: 'calendar_month', route: 'events' },
        // ⚠ GATED SINCE MS-197, AND THE MISSING GATE WAS THE BUG. This entry
        // had none, and `canSee` treats no gate as "everyone" — so a signed-out
        // guest (the phone's "Continue as guest") got a tile straight into the
        // whole church directory. It worked because `people` was world-readable.
        // ADR-0031 closed that, and the gate here now matches the web, where the
        // directory card has always been injected for member and above only.
        { key: 'directory', label: 'Membership Directory', icon: 'users', symbol: 'group', route: 'people', permissionLevels: ['member', 'editor', 'elder', 'admin', 'super_admin'] },
        { key: 'shepherd', label: 'Shepherd Dashboard', icon: 'shield', symbol: 'shield', route: 'shepherd', permissionLevels: ['elder', 'super_admin'] },
        { key: 'admin', label: 'Admin Dashboard', icon: 'settings-2', symbol: 'settings', route: 'admin', permissionLevels: ['admin', 'super_admin'] },
        // On the web the Roles Manager is a dashboard CARD rather than
        // navigation, and it was kept off this list to match. On a phone that
        // reasoning does not survive: the drawer IS the navigation, and a page
        // reachable only by a tile on Home is a page you have to go home to
        // reach. Same gate as the web card (MS-120) — editor and above.
        { key: 'roles-manager', label: 'Roles Manager', icon: 'hand-heart', symbol: 'volunteer_activism', route: 'rolesManager', permissionLevels: ['editor', 'elder', 'admin', 'super_admin'] },
        // Forms, for the same reason the Roles Manager is here: on a phone the
        // drawer IS the navigation, and the web's answer — a dashboard card —
        // does not exist on this surface. Same gate as that card and as the
        // page's own check, editor and above.
        { key: 'forms', label: 'Forms', icon: 'clipboard-list', symbol: 'ballot', route: 'forms', permissionLevels: ['editor', 'elder', 'admin', 'super_admin'] },
    ];

    // What a permission level is CALLED to the person holding it. Shared for the
    // same reason the list is: both drawers print it under the name.
    //
    // ⚠ EVERY level needs an entry. This map used to fall through to "Member",
    // so a super_admin's own drawer told them they were a member — the highest
    // rung in the app, labelled as the lowest.
    const ROLE_LABELS = {
        super_admin: 'Super Admin',
        admin: 'Administrator',
        elder: 'Elder',
        editor: 'Editor',
        member: 'Member',
        viewer: 'Member',
        kiosk: 'Kiosk',
    };

    function roleLabel(permissionLevel) {
        return ROLE_LABELS[permissionLevel] || 'Member';
    }

    // 1–2 letters for the avatar. Same rule as everywhere else in the app.
    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    // Routes that open a full desktop page in-place in the same WebView.
    // `?shell=mobile` makes those pages adapt their chrome and keep navigation
    // inside the shell (see mobile-shell.js).
    const SHELL_PAGES = {
        profile: 'profile.html',
        // The Calendar (MS-99) is the desktop page opened in-shell rather than a
        // native port, so there is only one Calendar to keep in step with the
        // model.
        events: 'calendar.html',
        // The Roles Manager the same way, and for a stronger reason: it is the
        // authoring home for what a Role IS. A second copy of that screen is a
        // second place for the rules about slots and restrictions to drift.
        rolesManager: 'roles-manager.html',
        // The Forms library is the desktop page opened in-shell rather than a
        // native port, so there is one library rather than two to keep in step
        // — the same trade the Calendar and the Roles Manager already make.
        forms: 'forms.html',
    };

    // True when a destination is visible to this user. No gate means everyone.
    //
    // FAILS CLOSED on an unknown user: a gated entry is hidden while we do not
    // yet know who is looking, because offering the Shepherd Dashboard to
    // somebody who will be refused on arrival is worse than not offering it.
    function canSee(item, user) {
        if (!item || !item.permissionLevels) return true;
        return !!(user && item.permissionLevels.indexOf(user.permissionLevel) >= 0);
    }

    // A route as a URL reachable from ANY page — the app's own document or a
    // desktop page running in the shell. The app has richer routing (in-memory
    // params, native screens); this is the subset a drawer needs, and it is the
    // whole of what the shell's drawer can do.
    function routeHref(route) {
        if (SHELL_PAGES[route]) return SHELL_PAGES[route] + '?shell=mobile';
        return 'mobile.html#/' + route;
    }

    // The parts of the drawer's head, so the two renderings cannot disagree
    // about what a drawer says about you. There is one component's worth of
    // chrome written twice here — the app's is Preact inside mobile.html, the
    // shell's is plain DOM on a desktop page — and a test holds them to this
    // list, because the first thing that drifted was the avatar going missing
    // from one of them.
    const DRAWER_HEAD = Object.freeze(['avatar', 'name', 'roleLabel']);

    const Destinations = {
        DESTINATIONS, SHELL_PAGES, ROLE_LABELS, DRAWER_HEAD,
        canSee, routeHref, roleLabel, initials,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Destinations;
    if (global) global.MosaicDestinations = Destinations;
})(typeof window !== 'undefined' ? window : null);
