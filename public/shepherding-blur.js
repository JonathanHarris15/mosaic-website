// Shepherding Blur — a DEVELOPMENT-ONLY privacy screen for the super admin.
//
// Context: while the app is in development the super_admin role still has read
// access to elder-only shepherding data (Firestore rules fold super_admin into
// isElder()). That is deliberate and temporary — eventually the super_admin role
// is retired and no one outside the elder circle can read this data at all. Until
// then, the super admin (the developer) wants sensitive pastoral content screened
// from view so they don't casually read elders' private notes while building.
//
// THIS IS NOT A SECURITY BOUNDARY. The data is already in the browser; the blur is
// CSS and is trivially bypassed (that is fine and understood — the elders know the
// developer could look if they truly needed to). It exists to prevent *accidental*
// exposure, nothing more. The real confidentiality pass is the retirement of the
// super_admin role, handled elsewhere.
//
// Model (see the blur decision table agreed with the product owner):
//   • Active only when role === 'super_admin'. Real elders never see any blur.
//   • Shepherding CONTENT (note bodies, subjects, explanations, prayer requests,
//     elder-document bodies/titles, care-list cells, status/tag change detail)
//     blurs — UNLESS the current user authored it, or it is on their own profile.
//   • A person's NAME blurs only when it appears as a shepherding-FILTER result
//     (Filtered View, tag/status-filtered People list, Care List rows, the filter
//     builder) — so the super admin can't see at a glance who carries a sensitive
//     tag. On an individual profile reached directly, the name stays visible.
//   • Standard directory data any member can see (names outside filter results,
//     contact, membership, involvement) never blurs.
//
// Mechanism: render sites tag sensitive elements with the `sensitive-blur` class
// based purely on identity/authorship (stable per item). A single attribute on the
// root element — <html data-blur="on|off"> — plus the CSS below drives the actual
// blur and the hover-to-reveal. A floating toggle (and Alt+B) flips the attribute
// and persists the choice. Because the toggle is pure CSS, no framework reactivity
// is needed; the class helpers only depend on who authored what.
//
// Loaded as a classic <script> after shepherding-core.js on every shepherding page.
// Exposes window.ShepherdingBlur; the class helpers are safe to call in Alpine
// expressions (e.g. :class="ShepherdingBlur.contentClass(entry.authorUid)").
(function (global) {
    'use strict';

    const STORAGE_KEY = 'shepherding_blur_enabled';
    const BLUR_CLASS = 'sensitive-blur';

    const state = {
        role: null,
        uid: null,
        personId: null,   // the Person record id that IS the current user, if any
        ready: false,
    };

    function active() {
        return state.role === 'super_admin';
    }

    // ── Class helpers (safe before configure; inert when not active) ───────────

    // Shepherding content. Blurs unless the current user authored it, or it sits on
    // their own profile (opts.ownProfile). Content with no known author blurs — we
    // fail closed for the accidental-exposure goal.
    function contentClass(authorUid, opts) {
        if (!active()) return '';
        if (opts && opts.ownProfile) return '';
        if (authorUid && state.uid && authorUid === state.uid) return '';
        return BLUR_CLASS;
    }

    // Current-state pastoral info that carries no single author (a person's live
    // status chip, their tag chips). Blurs whenever active, except on own profile.
    function pastoralClass(opts) {
        if (!active()) return '';
        if (opts && opts.ownProfile) return '';
        return BLUR_CLASS;
    }

    // A person's name. Only blurs in a shepherding-filter context (a truthy
    // filterContext) — never for a plain directory listing or a profile header.
    function nameClass(opts) {
        if (!active()) return '';
        return (opts && opts.filterContext) ? BLUR_CLASS : '';
    }

    // For x-html render functions that build an HTML string: wrap it so the blur
    // applies to the rendered block. Returns the html untouched when it shouldn't
    // blur. Used where a :class binding on the container isn't convenient.
    function wrapHtml(html, authorUid, opts) {
        return contentClass(authorUid, opts)
            ? `<span class="${BLUR_CLASS}">${html}</span>`
            : html;
    }

    // ── Global on/off (CSS-driven via the root attribute) ─────────────────────

    function isEnabled() {
        try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
    }

    function applyAttr() {
        document.documentElement.dataset.blur = (active() && isEnabled()) ? 'on' : 'off';
    }

    function setEnabled(on) {
        try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch {}
        applyAttr();
        updateToggle();
    }

    function toggle() { setEnabled(!isEnabled()); }

    // ── Injected CSS + floating toggle (only when active) ─────────────────────

    function injectStyle() {
        if (document.getElementById('sb-blur-style')) return;
        const style = document.createElement('style');
        style.id = 'sb-blur-style';
        style.textContent = `
            html[data-blur="on"] .${BLUR_CLASS} {
                filter: blur(7px);
                /* No animation: blur applies instantly, so a name never flashes
                   readable for a frame when a filter is switched on. Re-blur when
                   a hover ends is likewise instant. */
                transition: filter 0s;
                cursor: help;
                user-select: none;
                -webkit-user-select: none;
            }
            /* Reveal only after a sustained 10-second hover — a deliberate,
               high-friction peek. The delay is on the transition, so leaving the
               element before 10s elapse cancels the reveal entirely. */
            html[data-blur="on"] .${BLUR_CLASS}:hover {
                filter: none;
                transition: filter 0s 10s;
                user-select: auto;
                -webkit-user-select: auto;
            }
            /* Editable surfaces (document body/title, care-list cells) reveal
               instantly on focus so they stay usable; hovering to *read* still
               costs the full 10 seconds. */
            html[data-blur="on"] .${BLUR_CLASS}:focus-within {
                filter: none;
                transition: filter 0s;
                user-select: auto;
                -webkit-user-select: auto;
            }
            /* Keep the toggle itself and anything inside it always crisp. */
            html[data-blur="on"] #sb-blur-toggle .${BLUR_CLASS} { filter: none; }

            #sb-blur-toggle {
                position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
                display: inline-flex; align-items: center; gap: 8px;
                padding: 8px 12px; border-radius: 999px; border: none;
                font: 500 12px/1 system-ui, sans-serif; letter-spacing: .01em;
                color: #fff; background: #334155; cursor: pointer;
                box-shadow: 0 2px 8px rgba(0,0,0,.25); opacity: .85;
            }
            #sb-blur-toggle:hover { opacity: 1; }
            #sb-blur-toggle .sb-dot {
                width: 8px; height: 8px; border-radius: 50%; background: #f87171;
            }
            #sb-blur-toggle[data-on="off"] { background: #475569; }
            #sb-blur-toggle[data-on="off"] .sb-dot { background: #4ade80; }
        `;
        document.head.appendChild(style);
    }

    function injectToggle() {
        if (document.getElementById('sb-blur-toggle')) return;
        const btn = document.createElement('button');
        btn.id = 'sb-blur-toggle';
        btn.type = 'button';
        btn.title = 'Toggle elder-content blur (Alt+B). Dev-only privacy screen.';
        btn.addEventListener('click', toggle);
        document.body.appendChild(btn);
        updateToggle();
    }

    function updateToggle() {
        const btn = document.getElementById('sb-blur-toggle');
        if (!btn) return;
        const on = active() && isEnabled();
        btn.dataset.on = on ? 'on' : 'off';
        btn.innerHTML = `<span class="sb-dot"></span>${on ? 'Elder content hidden' : 'Elder content visible'}`;
    }

    function bindShortcut() {
        window.addEventListener('keydown', (e) => {
            if (e.altKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggle(); }
        });
    }

    // ── Setup ─────────────────────────────────────────────────────────────────
    // Call once from a page's auth handler with the resolved user identity.
    //   role     — the current user's role string
    //   uid      — auth uid (to exempt content the user authored)
    //   personId — the Person record id that is the current user, if known (to
    //              exempt their own profile). Optional.
    function configure({ role, uid, personId }) {
        state.role = role || null;
        state.uid = uid || null;
        state.personId = personId || null;
        state.ready = true;
        applyAttr();
        if (active()) {
            injectStyle();
            if (document.body) { injectToggle(); } else {
                document.addEventListener('DOMContentLoaded', injectToggle);
            }
            bindShortcut();
        }
    }

    const ShepherdingBlur = {
        configure,
        active,
        contentClass,
        pastoralClass,
        nameClass,
        wrapHtml,
        toggle,
        setEnabled,
        isEnabled,
        get uid() { return state.uid; },
        get personId() { return state.personId; },
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ShepherdingBlur;
    }
    if (global) {
        global.ShepherdingBlur = ShepherdingBlur;
    }
})(typeof window !== 'undefined' ? window : null);
