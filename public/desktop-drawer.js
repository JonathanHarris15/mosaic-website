// The desktop header's drawer (MS-691).
//
// ⚠ IT IS BUILT FROM THE TILES, AND THAT IS THE WHOLE DESIGN. The dashboard
// already answers "which pages may this person see?" — eight permission gates,
// AccessCore, and a saved arrangement on top of them. A drawer that answered the
// same question a second time would be a second answer, and the two would drift
// the first time a gate moved. So this one does not answer it at all: it reads
// the tiles the dashboard just drew and mirrors them. Same pages, same order,
// same glyphs, and a tile dragged to the front moves in the drawer too.
//
// It adds exactly one entry the grid cannot have: Home. The dashboard cannot
// offer a door to itself.
//
// No dependencies beyond the DOM. MosaicDestinations is used for the role label
// and the initials when a caller passes an account, so the web drawer and the
// phone's two cannot invent a third name for "Elder".

(function (global) {
    'use strict';

    // The Escape handler of whichever drawer is mounted, so re-mounting can take
    // the previous one off the document.
    let escaped = null;

    const HOME = Object.freeze({
        key: 'home', href: 'index.html', symbol: 'home', label: 'Home',
    });

    /** The tiles a dashboard grid is currently showing, in the order it shows
     *  them. A tile without a data-card-key is not a tile — the drag handle and
     *  anything else the page puts in the grid is skipped. */
    function tilesOf(grid) {
        if (!grid) return [];
        return Array.prototype.slice.call(grid.children)
            .filter(function (el) { return el.dataset && el.dataset.cardKey; })
            .map(function (el) {
                const glyph = el.querySelector('.m-medallion .material-symbols-outlined');
                const title = el.querySelector('.m-nav-card__title');
                return {
                    key: el.dataset.cardKey,
                    href: el.getAttribute('href') || '#',
                    symbol: glyph ? glyph.textContent.trim() : 'chevron_right',
                    label: title ? title.textContent.trim() : el.dataset.cardKey,
                };
            });
    }

    /** Home, then every tile. Pure, so the rule this module exists for can be
     *  tested without a browser. Idempotent: a list that already starts with
     *  Home is returned as-is, so a caller that wrapped once and a mount that
     *  wraps again cannot list Home twice (MS-698). */
    function entriesFor(tiles) {
        const list = tiles || [];
        if (list[0] && list[0].key === HOME.key) return list.slice();
        return [HOME].concat(list);
    }

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    function icon(symbol) {
        const span = el('span', 'material-symbols-outlined', symbol);
        span.setAttribute('aria-hidden', 'true');
        return span;
    }

    /** The head: the way shut, and who you are signed in as. `who` is null when
     *  nobody is — a drawer still lists the pages a visitor may open. */
    function head(who, onClose) {
        const wrap = el('div', 'm-drawer__head');
        const shut = el('button', 'm-icon-btn m-icon-btn--lg');
        shut.type = 'button';
        shut.setAttribute('aria-label', 'Close menu');
        // Inherits the navy head's own colour, and sits on the same optical line
        // as the hamburger it replaced.
        shut.style.color = 'var(--on-primary)';
        shut.style.marginLeft = '-8px';
        shut.appendChild(icon('menu'));
        shut.addEventListener('click', onClose);
        wrap.appendChild(shut);

        if (who && who.name) {
            const link = el('a', 'm-drawer__who');
            link.href = who.href || 'profile.html';
            const avatar = el('span', 'm-avatar', who.initials || '?');
            avatar.setAttribute('aria-hidden', 'true');
            const main = el('span', 'm-drawer__who-main');
            main.appendChild(el('span', 'm-drawer__name', who.name));
            if (who.role) main.appendChild(el('span', 'm-drawer__role', who.role));
            const chev = icon('chevron_right');
            chev.style.color = 'var(--primary-fixed-dim)';
            chev.style.fontSize = '18px';
            link.appendChild(avatar);
            link.appendChild(main);
            link.appendChild(chev);
            wrap.appendChild(link);
        }
        return wrap;
    }

    function list(entries, currentHref) {
        const wrap = el('div', 'm-drawer__list');
        entries.forEach(function (entry) {
            const item = el('a', 'm-drawer__item');
            item.href = entry.href;
            if (entry.href === currentHref) item.setAttribute('aria-current', 'page');
            item.appendChild(icon(entry.symbol));
            item.appendChild(el('span', 'm-drawer__label', entry.label));
            wrap.appendChild(item);
        });
        return wrap;
    }

    function foot(who) {
        const wrap = el('div', 'm-drawer__foot');
        const action = el(who ? 'button' : 'a', 'm-btn m-btn--quiet');
        action.style.width = '100%';
        action.style.justifyContent = 'flex-start';
        if (who) {
            action.type = 'button';
            action.appendChild(icon('logout'));
            action.appendChild(el('span', 'm-btn__label', 'Sign out'));
            action.addEventListener('click', function () {
                if (typeof global.logout === 'function') global.logout();
            });
        } else {
            action.href = 'login.html';
            action.appendChild(icon('login'));
            action.appendChild(el('span', 'm-btn__label', 'Log in'));
        }
        wrap.appendChild(action);
        return wrap;
    }

    /**
     * Draw the drawer and wire the hamburger to it.
     *
     * Called again — when a promotion adds a tile, say — it replaces what it
     * drew before rather than adding a second panel.
     *
     * @param {object} opts
     *   toggle      the hamburger button in the header
     *   grid        the dashboard's tile grid, read for its tiles
     *   entries     tile list already resolved (non-dashboard pages, MS-697)
     *   who         { name, role, initials, href } or null when signed out
     *   currentHref the page the drawer is being opened FROM
     *   behind      elements to make inert while the drawer is open
     */
    function mount(opts) {
        const toggle = opts.toggle;
        if (!toggle) return null;
        const state = document.body;
        const entries = opts.entries
            ? entriesFor(opts.entries)
            : entriesFor(tilesOf(opts.grid));
        const behind = opts.behind || [];

        const old = document.getElementById('app-drawer');
        if (old) old.remove();

        const drawer = el('div', 'm-drawer');
        drawer.id = 'app-drawer';

        // A <button>, so clicking away closes the drawer without a click handler
        // on a <div>; out of the tab order and out of the accessibility tree,
        // because Escape is the keyboard way out.
        const scrim = el('button', 'm-drawer__scrim');
        scrim.type = 'button';
        scrim.tabIndex = -1;
        scrim.setAttribute('aria-hidden', 'true');
        scrim.addEventListener('click', function () { close(); });

        const panel = el('nav', 'm-drawer__panel');
        panel.setAttribute('aria-label', 'Menu');
        const headEl = head(opts.who, function () { close(); });
        panel.appendChild(headEl);
        panel.appendChild(list(entries, opts.currentHref || 'index.html'));
        panel.appendChild(foot(opts.who));

        drawer.appendChild(scrim);
        drawer.appendChild(panel);
        document.body.appendChild(drawer);

        function setInert(on) {
            behind.forEach(function (node) { if (node) node.inert = on; });
        }

        function open() {
            state.dataset.drawer = 'open';
            toggle.setAttribute('aria-expanded', 'true');
            toggle.setAttribute('aria-label', 'Close menu');
            setInert(true);
            const shut = headEl.querySelector('button');
            if (shut) shut.focus();
        }

        function close() {
            delete state.dataset.drawer;
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', 'Open menu');
            setInert(false);
            // The header is inert while the drawer is open, so the focus has to
            // come back deliberately: released in place, it lands on <body> and
            // the next Tab starts at the top of the document.
            toggle.focus();
        }

        // ⚠ MOUNTING TWICE MUST NOT LISTEN TWICE. A promotion that adds a tile
        // re-mounts, and a second handler on the same hamburger opened the
        // drawer and then closed it again within one click — the button simply
        // stopped working, with nothing in the console to say why.
        function onToggle() {
            if (state.dataset.drawer === 'open') close();
            else open();
        }
        function onKey(e) {
            if (e.key === 'Escape' && state.dataset.drawer === 'open') close();
        }
        if (toggle.mosaicDrawerToggle) {
            toggle.removeEventListener('click', toggle.mosaicDrawerToggle);
        }
        if (escaped) document.removeEventListener('keydown', escaped);
        toggle.mosaicDrawerToggle = onToggle;
        escaped = onKey;
        toggle.addEventListener('click', onToggle);
        document.addEventListener('keydown', onKey);

        toggle.hidden = false;
        return { open: open, close: close, entries: entries };
    }

    const DesktopDrawer = { HOME: HOME, tilesOf: tilesOf, entriesFor: entriesFor, mount: mount };

    if (typeof module !== 'undefined' && module.exports) module.exports = DesktopDrawer;
    if (global) global.DesktopDrawer = DesktopDrawer;
}(typeof window !== 'undefined' ? window : null));
