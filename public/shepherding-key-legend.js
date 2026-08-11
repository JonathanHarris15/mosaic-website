// Floating "Quick keys" legend for the Shepherding note editors.
//
// Lists the special inline key commands you can type while editing a note body
// (on the Document page) or a care-list cell (on the Care List page).
//
// It is always reachable: a slim tab is pinned to the right edge of the
// viewport, and clicking it expands the full key card as a floating panel. The
// card and tab are position:fixed and do NOT depend on the page having an empty
// gutter, so the legend can never be squeezed out of existence by a narrow or
// vertically-cramped layout — there is always at least the edge button to
// expand it back (previously the whole panel hid itself when the gutter was too
// small). On first load, with no stored preference, the card starts expanded
// only when the centred content leaves room for it in the right-hand gutter;
// otherwise it starts as just the tab. The user's expand/collapse choice is
// remembered.
//
// Usage: include this script after the page scripts and set `data-key-legend` on
// <body> to a comma-separated list of command keys (see COMMANDS below). Omit the
// attribute to show every command.

(function () {
    'use strict';

    // The full catalogue of inline triggers. Keep in sync with the editors:
    //  @  → Mention            (createDocMentionSuggestion)
    //  /  → Person note panel  (createInlinePickerPlugin — Document page only)
    //  #  → Add tag            (shepherding-inline-triggers.js)
    //  -# → Remove tag         (shepherding-inline-triggers.js)
    //  $$ → Status matrix      (shepherding-inline-triggers.js)
    const COMMANDS = {
        mention:    { keys: ['@'],  title: 'Mention',     desc: 'Link a person, note, document or folder' },
        insertNote: { keys: ['/'],  title: 'Person note', desc: 'Insert a linked Shepherding Note' },
        addTag:     { keys: ['#'],  title: 'Add tag',     desc: 'Tag this person (type to search or create)' },
        removeTag:  { keys: ['-#'], title: 'Remove tag',  desc: 'Remove a tag from this person' },
        status:     { keys: ['$$'], title: 'Set status',  desc: 'Open the urgency × importance matrix' },
    };

    const PANEL_W   = 168;                 // px — card width
    const GAP       = 10;                  // px — breathing room in the gutter
    const STORE_KEY = 'shepKeyLegendExpanded'; // 'open' | 'closed'

    function chip(text) {
        const k = document.createElement('kbd');
        k.textContent = text;
        k.style.cssText = 'display:inline-block;min-width:18px;text-align:center;font-family:"Work Sans",sans-serif;' +
            'font-size:12px;font-weight:600;line-height:1.4;color:var(--primary);background:var(--primary-fixed);border:1px solid var(--primary-fixed-dim);' +
            'border-radius:4px;padding:1px 5px;';
        return k;
    }

    let cardEl = null;
    let tabEl  = null;
    let expanded = false;

    // The full key card — floats out from the right edge, vertically centred,
    // capped to the viewport height so a short window scrolls it internally
    // rather than clipping it off-screen.
    function buildCard(keys) {
        const panel = document.createElement('aside');
        panel.id = 'shep-key-legend';
        panel.setAttribute('aria-label', 'Note editor key commands');
        panel.style.cssText = 'position:fixed;z-index:40;right:10px;top:50%;transform:translateY(-50%);' +
            'width:' + PANEL_W + 'px;max-height:calc(100vh - 20px);overflow-y:auto;background:#fffdf7;' +
            'border:1px solid #c5c6d0;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.12);' +
            'padding:12px 14px;font-family:"Work Sans",sans-serif;display:none;';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;';
        const hTitle = document.createElement('span');
        hTitle.textContent = 'Quick keys';
        hTitle.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#75777f;';
        hdr.appendChild(hTitle);
        const collapseBtn = document.createElement('button');
        collapseBtn.type = 'button';
        collapseBtn.setAttribute('aria-label', 'Collapse quick keys');
        collapseBtn.title = 'Collapse';
        collapseBtn.textContent = '»'; // » — dock back to the edge
        collapseBtn.style.cssText = 'border:none;background:transparent;cursor:pointer;color:#75777f;' +
            'font-size:16px;line-height:1;padding:0 2px;';
        collapseBtn.addEventListener('click', () => setExpanded(false));
        hdr.appendChild(collapseBtn);
        panel.appendChild(hdr);

        keys.forEach(key => {
            const cmd = COMMANDS[key];
            if (!cmd) return;
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-bottom:10px;';

            const top = document.createElement('div');
            top.style.cssText = 'display:flex;align-items:center;gap:6px;';
            cmd.keys.forEach(kk => top.appendChild(chip(kk)));
            const title = document.createElement('span');
            title.textContent = cmd.title;
            title.style.cssText = 'font-size:13px;font-weight:600;color:#1c1c18;';
            top.appendChild(title);
            row.appendChild(top);

            const desc = document.createElement('div');
            desc.textContent = cmd.desc;
            desc.style.cssText = 'font-size:11px;line-height:1.35;color:#75777f;';
            row.appendChild(desc);

            panel.appendChild(row);
        });

        const hint = document.createElement('div');
        hint.textContent = 'Type a key at the start of a word.';
        hint.style.cssText = 'font-size:10px;font-style:italic;color:#9a9ba0;border-top:1px solid #e5e2dc;padding-top:8px;margin-top:2px;';
        panel.appendChild(hint);

        return panel;
    }

    // The always-present edge tab. Pinned to the right edge, vertically centred;
    // the one control that can never be squeezed out, so the card is always
    // recoverable.
    function buildTab() {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.id = 'shep-key-legend-tab';
        tab.setAttribute('aria-label', 'Show quick keys');
        tab.title = 'Quick keys';
        tab.style.cssText = 'position:fixed;z-index:40;right:0;top:50%;transform:translateY(-50%);' +
            'display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;' +
            'background:var(--primary);color:#fff;border:none;border-radius:10px 0 0 10px;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.14);padding:11px 6px;font-family:"Work Sans",sans-serif;';

        const icon = document.createElement('span');
        icon.textContent = '⌨'; // ⌨ keyboard
        icon.style.cssText = 'font-size:16px;line-height:1;';
        tab.appendChild(icon);

        const label = document.createElement('span');
        label.textContent = 'Keys';
        label.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;writing-mode:vertical-rl;';
        tab.appendChild(label);

        tab.addEventListener('click', () => setExpanded(true));
        return tab;
    }

    function setExpanded(v, persist = true) {
        expanded = v;
        if (cardEl) cardEl.style.display = v ? 'block' : 'none';
        if (tabEl)  tabEl.style.display  = v ? 'none'  : 'flex';
        if (persist) {
            try { localStorage.setItem(STORE_KEY, v ? 'open' : 'closed'); } catch (_) {}
        }
    }

    function storedPref() {
        try { return localStorage.getItem(STORE_KEY); } catch (_) { return null; }
    }

    // Choose the initial state when the user hasn't picked one: expand only when
    // the centred content leaves gutter room for the card on the right; otherwise
    // start as just the tab (e.g. a fullscreen document has no gutter).
    function applyDefault() {
        const pref = storedPref();
        if (pref === 'open')  { setExpanded(true,  false); return; }
        if (pref === 'closed'){ setExpanded(false, false); return; }
        const main = document.querySelector('main');
        let roomy = false;
        if (main) {
            const r = main.getBoundingClientRect();
            const rightGutter = window.innerWidth - r.right;
            roomy = r.width > 0 && rightGutter >= PANEL_W + GAP * 2;
        }
        setExpanded(roomy, false);
    }

    function init() {
        const raw = document.body.dataset.keyLegend;
        const keys = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : Object.keys(COMMANDS);

        cardEl = buildCard(keys);
        tabEl  = buildTab();
        document.body.appendChild(cardEl);
        document.body.appendChild(tabEl);

        // Start as just the tab until we can measure, then settle on the default.
        setExpanded(false, false);
        applyDefault();

        // <main> starts hidden (x-show="!loading") and only gets its real size
        // once loading finishes — re-evaluate the default when that first real
        // layout arrives, but only while the user hasn't made a choice.
        const main = document.querySelector('main');
        if (main && window.ResizeObserver) {
            new ResizeObserver(() => { if (!storedPref()) applyDefault(); }).observe(main);
        }
        setTimeout(() => { if (!storedPref()) applyDefault(); }, 400);

        // Escape collapses the open card back to the tab.
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && expanded) setExpanded(false);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
