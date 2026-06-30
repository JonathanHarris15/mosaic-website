// Floating "Quick keys" legend for the Shepherding note editors.
//
// Lists the special inline key commands you can type while editing a note body
// (on the Document page) or a care-list cell (on the Care List page). It sits in
// the page gutter — the empty margin beside the centred content column — and
// hides itself when the viewport is too narrow to fit it without overlapping the
// content.
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

    const PANEL_W = 168;   // px — panel width
    const GAP     = 10;    // px — minimum breathing room each side of the panel

    function chip(text) {
        const k = document.createElement('kbd');
        k.textContent = text;
        k.style.cssText = 'display:inline-block;min-width:18px;text-align:center;font-family:"Work Sans",sans-serif;' +
            'font-size:12px;font-weight:600;line-height:1.4;color:#182F57;background:#d8e2ff;border:1px solid #b2c6f8;' +
            'border-radius:4px;padding:1px 5px;';
        return k;
    }

    function build(keys) {
        const panel = document.createElement('aside');
        panel.id = 'shep-key-legend';
        panel.setAttribute('aria-label', 'Note editor key commands');
        panel.style.cssText = 'position:fixed;z-index:30;width:' + PANEL_W + 'px;background:#fffdf7;border:1px solid #c5c6d0;' +
            'border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.08);padding:12px 14px;' +
            'font-family:"Work Sans",sans-serif;display:none;';

        const hdr = document.createElement('div');
        hdr.textContent = 'Quick keys';
        hdr.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#75777f;margin-bottom:10px;';
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

    // Place the panel centred in the left-hand gutter, or hide it when the
    // gutter is too small to hold it without overlapping the content column.
    function position(panel) {
        const main = document.querySelector('main');
        // While the page is loading <main> is x-show-hidden (display:none) and
        // its rect is all zeros — don't place the panel until it's laid out, or
        // it would land in the middle of the screen.
        if (!main) { panel.style.display = 'none'; return; }
        const r = main.getBoundingClientRect();
        const gutter = r.left; // space between the window edge and the centred column
        if (r.width > 0 && gutter >= PANEL_W + GAP * 2) {
            panel.style.left = Math.round((gutter - PANEL_W) / 2) + 'px';
            panel.style.top = '50%';
            panel.style.transform = 'translateY(-50%)';
            panel.style.display = 'block';
        } else {
            panel.style.display = 'none';
        }
    }

    function init() {
        const raw = document.body.dataset.keyLegend;
        const keys = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : Object.keys(COMMANDS);
        const panel = build(keys);
        document.body.appendChild(panel);
        const reposition = () => position(panel);
        reposition();
        window.addEventListener('resize', reposition);
        // <main> starts hidden (x-show="!loading") and only gets its real size
        // once loading finishes — reposition when that layout change happens.
        const main = document.querySelector('main');
        if (main && window.ResizeObserver) {
            new ResizeObserver(reposition).observe(main);
        }
        // Belt-and-braces in case the layout settles without a ResizeObserver tick.
        setTimeout(reposition, 300);
        setTimeout(reposition, 1200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
