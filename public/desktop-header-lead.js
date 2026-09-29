// Desktop header lead: hamburger + drawer on top-level destinations, back
// elsewhere (MS-697). Phone shell pages keep their existing chrome.

(function (global) {
    'use strict';

    const TOGGLE_ID = 'drawer-toggle';

    function isDesktopNav() {
        if (global.MOSAIC_SHELL === 'mobile') return false;
        if (!global.matchMedia) return true;
        return global.matchMedia('(min-width: 1024px)').matches;
    }

    function icon(symbol) {
        const span = document.createElement('span');
        span.className = 'material-symbols-outlined';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = symbol;
        return span;
    }

    function createHamburger() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = TOGGLE_ID;
        btn.className = 'm-icon-btn m-icon-btn--lg m-icon-btn--ghost mosaic-desktop-lead';
        btn.hidden = true;
        btn.setAttribute('aria-controls', 'app-drawer');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Open menu');
        btn.appendChild(icon('menu'));
        return btn;
    }

    function createBack(back) {
        const link = document.createElement('a');
        link.className = 'm-back mosaic-desktop-lead';
        if (back.fallbackHistory) {
            link.href = back.href;
            link.addEventListener('click', function (e) {
                if (global.history && global.history.length > 1) {
                    e.preventDefault();
                    global.history.back();
                }
            });
        } else {
            link.href = back.href;
        }
        link.appendChild(icon('chevron_left'));
        const label = document.createElement('span');
        label.className = 'm-back__label';
        label.textContent = back.label;
        link.appendChild(label);
        return link;
    }

    function stripLegacyLead(lead) {
        if (!lead) return;
        lead.querySelectorAll('.m-back, #' + TOGGLE_ID + ', .mosaic-desktop-lead').forEach(function (n) {
            n.remove();
        });
    }

    // The same 1–2 letter rule MosaicDestinations.initials uses. Kept here so
    // a page that has not loaded destinations.js still draws an avatar rather
    // than a '?' or nothing (MS-698).
    function initialsOf(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    /**
     * Who the drawer should say you are. Null only when nobody is signed in —
     * a signed-in viewer still has a name and initials. Treating viewer as
     * signed out is what hid the avatar on every page except Home (MS-698).
     */
    function resolveWho(account, displayName, signedIn) {
        if (!signedIn) return null;
        const Destinations = global && global.MosaicDestinations;
        const name = displayName || 'Friend';
        return {
            name,
            role: Destinations ? Destinations.accountLabel(account) : '',
            initials: Destinations ? Destinations.initials(name) : initialsOf(name),
            href: 'profile.html',
        };
    }

    // auth.js declares `const auth` / `const db`. Those are lexical bindings,
    // not properties of the window object. firebase.auth() is the same
    // singleton that assignment created. Looking them up on the window is why
    // every page except Home drew a signed-out drawer (MS-698; see
    // calendar-pages.test.js).
    function sessionAuth() {
        return (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth() : null;
    }

    function sessionDb() {
        return (typeof firebase !== 'undefined' && firebase.firestore)
            ? firebase.firestore() : null;
    }

    async function loadSession() {
        const auth = sessionAuth();
        const db = sessionDb();
        if (!auth) {
            return { account: DashboardNav.accountOf(null), savedOrder: null, who: null };
        }
        const user = await new Promise(function (resolve) {
            const unsub = auth.onAuthStateChanged(function (u) {
                unsub();
                resolve(u);
            });
        });
        if (!user) {
            return { account: DashboardNav.accountOf(null), savedOrder: null, who: null };
        }
        let permissionLevel = 'viewer';
        let pastoralAssistant = false;
        let savedOrder = null;
        let name = 'Friend';
        try {
            if (typeof getUserData === 'function') {
                const userData = await getUserData(user.uid);
                if (userData) {
                    permissionLevel = userData.permissionLevel || userData.role || 'viewer';
                    pastoralAssistant = userData.pastoralAssistant === true;
                    savedOrder = Array.isArray(userData.dashboardCardOrder)
                        ? userData.dashboardCardOrder : null;
                    if (userData.email) {
                        name = userData.email.split('@')[0];
                        name = name.charAt(0).toUpperCase() + name.slice(1);
                    }
                    if (userData.personId && db) {
                        try {
                            const personDoc = await db.collection('people').doc(userData.personId).get();
                            const personName = personDoc.exists
                                ? (personDoc.data().name || '').trim() : '';
                            if (personName) name = personName.split(/\s+/)[0];
                        } catch (pe) {
                            console.error('Error fetching linked person:', pe);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error fetching user data:', e);
        }
        const account = DashboardNav.accountOf({
            permissionLevel, pastoralAssistant,
        });
        return {
            account,
            savedOrder,
            who: resolveWho(account, name, true),
        };
    }

    let mounted = null;

    /**
     * @param {object} opts
     *   lead          .m-header__lead element (optional)
     *   currentHref   page file name for aria-current
     *   mode          'drawer' | 'back' (optional — classified from currentHref)
     *   back          { href, label } when mode is back
     *   getState      () => ({ mode, back }) for Alpine pages
     *   skipDrawer    true on index.html when dashboard mounts its own drawer
     */
    async function mount(opts) {
        if (!isDesktopNav()) return null;
        const lead = opts.lead || document.querySelector('.m-header__lead');
        if (!lead) return null;

        const currentHref = opts.currentHref || DashboardNav.normalizePage(global.location.pathname);
        let mode = opts.mode;
        let back = opts.back;
        if (typeof opts.getState === 'function') {
            const dynamic = opts.getState();
            if (dynamic) {
                if (dynamic.mode) mode = dynamic.mode;
                if (dynamic.back) back = dynamic.back;
            }
        }
        if (!mode) {
            const classified = DashboardNav.classifyPage(currentHref);
            mode = classified.mode;
            back = back || classified.back;
        }

        stripLegacyLead(lead);

        if (mode === 'drawer') {
            const toggle = createHamburger();
            lead.insertBefore(toggle, lead.firstChild);
            if (opts.skipDrawer) {
                toggle.hidden = false;
                return { toggle, mode };
            }
            const session = await loadSession();
            const tiles = DashboardNav.orderedTiles(session.account, session.savedOrder);
            if (typeof global.DesktopDrawer !== 'undefined') {
                global.DesktopDrawer.mount({
                    toggle: toggle,
                    entries: tiles,
                    who: session.who,
                    currentHref: currentHref,
                    behind: [
                        document.querySelector('main'),
                        document.querySelector('.m-header'),
                    ],
                });
            }
            mounted = { toggle, mode, remount: function () { return mount(opts); } };
            return mounted;
        }

        const backEl = createBack(back || { href: 'index.html', label: 'Home' });
        lead.insertBefore(backEl, lead.firstChild);
        mounted = { backEl, mode };
        return mounted;
    }

    function bootFromDocument() {
        const page = DashboardNav.normalizePage(global.location.pathname);
        const skipDrawer = page === 'index.html';
        mount({ currentHref: page, skipDrawer: skipDrawer });
    }

    const DesktopHeaderLead = {
        isDesktopNav,
        mount,
        bootFromDocument,
        createHamburger,
        createBack,
        resolveWho,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = DesktopHeaderLead;
    if (global) global.DesktopHeaderLead = DesktopHeaderLead;
}(typeof window !== 'undefined' ? window : null));
