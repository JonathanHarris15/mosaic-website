// Nametag Core — labels printed at the kiosk (MS-317 / MS-320).
//
// An Event that needs name tags prints one adult tag per adult, and two labels
// per kid: the child's tag and a guardian stub, both carrying the same pickup
// number. The number is unique within the Event. Attendance is written first;
// printing is the second, fallible step.
//
// Labels are 75mm × 50mm HTML, printed through the browser and the Zebra
// Windows driver already on the kiosk. window.print() cannot tell whether a
// label came out, so the page offers Print again rather than pretending to know.
//
// Loaded as a classic <script> (window.NametagCore) and exported for Node tests.

(function (global) {
    'use strict';

    const WIDTH = '75mm';
    const HEIGHT = '50mm';
    const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

    function splitName(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return { first: '', last: '' };
        if (parts.length === 1) return { first: parts[0], last: '' };
        return { first: parts[0], last: parts.slice(1).join(' ') };
    }

    function nextPickupCode(used) {
        const taken = {};
        (used || []).forEach(function (c) { if (c) taken[c] = true; });
        let code = '';
        let n = 0;
        do {
            code = '';
            for (let i = 0; i < 4; i++) {
                code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
            }
            n += 1;
            if (n > 200) code = code + String(n);
        } while (taken[code]);
        return code;
    }

    function assignPickupCodes(members, already) {
        // `already` is the Attendance this Event has written so far. Take the
        // CODES out of it — passing the rows straight through left every key
        // reading "[object Object]", so a new number dodged nothing and the
        // promise of one number per Event was only ever probably true.
        const used = [];
        const byPerson = {};
        (already || []).forEach(function (row) {
            if (!row) return;
            const code = (typeof row === 'string') ? row : row.pickupCode;
            if (code) used.push(code);
            if (row.personId && row.pickupCode) byPerson[row.personId] = row.pickupCode;
        });
        (members || []).forEach(function (m) {
            if (!m || !m.kid || !m.personId) return;
            if (byPerson[m.personId]) return;
            const code = nextPickupCode(used);
            used.push(code);
            byPerson[m.personId] = code;
        });
        return byPerson;
    }

    function labelsFor(members, meta, pickupByPersonId) {
        const labels = [];
        const info = meta || {};
        (members || []).forEach(function (m) {
            if (!m) return;
            const names = splitName(m.name);
            if (m.kid) {
                const code = (pickupByPersonId && pickupByPersonId[m.personId]) || '';
                labels.push({
                    kind: 'child',
                    personId: m.personId,
                    first: names.first,
                    last: names.last,
                    code: code,
                    eventName: info.eventName || '',
                    date: info.date || '',
                });
                labels.push({
                    kind: 'stub',
                    personId: m.personId,
                    first: names.first,
                    last: names.last,
                    code: code,
                    eventName: info.eventName || '',
                    date: info.date || '',
                });
            } else {
                labels.push({
                    kind: 'adult',
                    personId: m.personId,
                    first: names.first,
                    last: names.last,
                    eventName: info.eventName || '',
                    date: info.date || '',
                });
            }
        });
        return labels;
    }

    // How big the given name can be printed and still fit across the label.
    //
    // The tag exists to be read across a foyer, so the given name is set as
    // large as the stock allows — but "Christopher" at the size that suits
    // "Ada" runs off the edge, and a clipped name is worse than a small one.
    // CSS cannot measure text before it lays out, so the size is worked out
    // here from the one thing we know: how many characters there are.
    //
    // ⚠ THE USABLE WIDTH IS 48mm, AND THE SUM USED TO SAY 51.
    //
    // 75mm of stock, less 4mm of padding each side, less the 16mm column the
    // Mosaic mark sits in, LESS THE 3mm GAP between the name and that column.
    // The gap was left out, so a name three millimetres too wide was called a
    // fit and ran under the mark — "Dawson" printed straight through the logo.
    // 46 keeps two more millimetres in hand.
    //
    // 0.58em per character was an average, and an average is the wrong number
    // for a worst case: Arial Bold sets 'w' and 'D' far wider than 'i', so a
    // short name of wide letters beat it. 0.66 covers the widest real given
    // names ('Wendy' is 0.67 and is the worst of them). Capped at 15mm so a
    // short name does not become a billboard, floored at 5mm — roughly 14pt,
    // still the biggest thing on the label.
    //
    // The estimate is belt; '.who' clipping its own overflow is braces. No
    // arithmetic here can be trusted absolutely, and a name cut off at the
    // column edge is bad where a name printed across the mark is worse.
    const NAME_WIDTH_MM = 46;
    const NAME_EM_RATIO = 0.66;
    const NAME_MAX_MM = 15;
    const NAME_MIN_MM = 5;

    function firstNameSizeMm(first) {
        const chars = String(first || '').length;
        if (!chars) return NAME_MAX_MM;
        const fits = NAME_WIDTH_MM / (chars * NAME_EM_RATIO);
        const size = Math.min(NAME_MAX_MM, Math.max(NAME_MIN_MM, fits));
        return Math.round(size * 10) / 10;
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, function (ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    }

    // The tag is a name and the Mosaic mark, and nothing else. The event and the
    // date came off it (MS-320): a person wearing the tag knows which gathering
    // they walked into, and every millimetre spent saying so was a millimetre
    // taken off the one thing the tag is for — being read across a room.
    //
    // A Kid keeps the pickup number, on both their tag and the guardian stub.
    // That is not decoration: it is how the right child goes home with the right
    // adult, and it is the reason a stub exists at all.
    function labelMarkup(label, logoSrc) {
        const kind = label.kind;
        const code = label.code
            ? '<div class="code">' + escapeHtml(label.code) + '</div>'
            : '';
        // Only the stub says what it is — the word, and nothing else. It used to
        // carry a dashed border, which reads as a cut line on a label that is
        // never cut: the stub is a whole sticker of its own, the same size as the
        // tag beside it (MS-320).
        const kindLine = kind === 'stub'
            ? '<div class="kind">Pickup stub</div>'
            : '';
        const firstStyle = ' style="font-size:' + firstNameSizeMm(label.first) + 'mm"';
        const mark = '<img class="mark" src="' + escapeHtml(logoSrc) + '" alt="">';
        return (
            '<article class="label kind-' + escapeHtml(kind) + '">' +
                '<div class="who">' +
                    kindLine +
                    '<div class="first"' + firstStyle + '>' + escapeHtml(label.first) + '</div>' +
                    '<div class="last">' + escapeHtml(label.last) + '</div>' +
                '</div>' +
                '<div class="side">' +
                    mark +
                    code +
                '</div>' +
            '</article>'
        );
    }

    // Where the Mosaic mark comes from. A relative path, because the print frame
    // inherits the kiosk page's base URL — and because a data URI would be
    // repeated on every label in the sheet.
    const LOGO_SRC = 'assets/mosaic-icon.png';

    function printHtml(labels, opts) {
        const logoSrc = (opts && opts.logoSrc) || LOGO_SRC;
        const body = (labels || []).map(function (l) { return labelMarkup(l, logoSrc); }).join('\n');
        return '<!doctype html><html><head><meta charset="utf-8"><title>Name tags</title>' +
            '<style>' +
            '@page { size: ' + WIDTH + ' ' + HEIGHT + '; margin: 0; }' +
            'html, body { margin: 0; padding: 0; background: #fff; }' +
            // ⚠ THE CONTENT IS ANCHORED TOP-LEFT, NOT CENTRED. That is what makes
            // the printed label match the preview (MS-320).
            //
            // Chrome lays the page out at the size `@page` asks for, but the paper
            // it hands the driver is whatever stock the Zebra queue is set to — the
            // CSS never gets to choose it (Chromium issue 41010929; the spike wrote
            // this down in docs/plans/ms-317-zebra-label-printing.md). So the page
            // box and the label under the printhead are two slightly different
            // rectangles. Centred content splits that difference on every edge and
            // drifts down and to the right, which is exactly what came out of the
            // printer while the preview looked square. Content pinned to the corner
            // both rectangles share cannot drift: the name lands in the same place
            // whatever stock is loaded, and the mismatch is spent on the empty
            // bottom of the label rather than on the name.
            //
            // ⚠ THE BOX IS AS TALL AS ITS CONTENT, NOT AS TALL AS THE PAGE.
            //
            // It used to be the height of the label less 0.4mm, because a box the
            // exact height of the page box rounds up by a sub-pixel in Chrome and
            // spills onto a second, blank page. That shaving only held while the
            // page really was 50mm — and it is not, because the paper the driver
            // prints on is not the page the CSS asked for (see above). On any
            // shorter stock every tag spilled, and a blank sticker fed out between
            // them. A box that stops where the name stops cannot spill onto a
            // second page on any stock, so the guess is gone rather than retuned.
            // The forced break after each label is what puts one tag on one
            // sticker; the height was never doing that job.
            '.label { width: ' + WIDTH + '; box-sizing: border-box;' +
            ' overflow: hidden;' +
            ' padding: 3mm 4mm; display: flex; flex-direction: row; align-items: flex-start; gap: 3mm;' +
            ' page-break-after: always; break-after: page; color: #000; font-family: Arial, Helvetica, sans-serif;' +
            ' -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
            '.label:last-child { page-break-after: auto; break-after: auto; }' +
            '.who { flex: 1 1 auto; min-width: 0; overflow: hidden; }' +
            // The mark keeps its own column so the name never runs under it.
            '.side { flex: 0 0 16mm; width: 16mm; display: flex; flex-direction: column;' +
            ' align-items: center; justify-content: flex-start; gap: 1.5mm; }' +
            '.mark { width: 16mm; height: 16mm; display: block; object-fit: contain; }' +
            '.first { font-size: 15mm; font-weight: 700; line-height: 0.95; letter-spacing: -0.02em; white-space: nowrap; }' +
            '.last { font-size: 6mm; font-weight: 400; line-height: 1; margin-top: 1mm; }' +
            '.kind { font-size: 3mm; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 1mm; }' +
            '.code { font-family: "Courier New", monospace; font-size: 7mm; font-weight: 700; line-height: 0.9; letter-spacing: 0.4mm; }' +
            '</style></head><body>' + body + '</body></html>';
    }

    // Print the labels through a hidden frame, so the kiosk page itself is not
    // what goes to the printer.
    //
    // ⚠ TWO THINGS HERE ARE NOT COSMETIC.
    //
    // 1. THE FRAME HAS A REAL SIZE. It used to be 0×0, and Chrome will open a
    //    print preview for a zero-sized frame and then close it again on its own
    //    — the dialog "blinks away" and nothing prints. It is parked off-screen
    //    instead, which costs nothing and is what makes the dialog stay.
    //
    // 2. IT WAITS FOR THE FRAME TO LOAD, not for 50ms and a hope. Calling print()
    //    before layout has run gives a preview of a blank page, or of the first
    //    label only. `srcdoc` fires a real `load` event; one animation frame
    //    after it, the pages exist and the dialog can be trusted.
    //
    // The frame is created once and kept. Removing it — even after the dialog
    // opens — takes the dialog with it.
    function printLabels(labels, doc, onReady) {
        const html = printHtml(labels);
        if (!doc || !doc.body) return html;

        let frame = doc.getElementById('kiosk-print-frame');
        if (!frame) {
            frame = doc.createElement('iframe');
            frame.id = 'kiosk-print-frame';
            frame.setAttribute('aria-hidden', 'true');
            frame.setAttribute('tabindex', '-1');
            frame.style.cssText =
                'position:fixed;left:-10000px;top:0;width:320px;height:240px;border:0;opacity:0;';
            doc.body.appendChild(frame);
        }

        const open = function () {
            const win = frame.contentWindow;
            if (!win) return;
            // One frame after load: the document is parsed, and this lets the
            // page boxes lay out before the preview is asked to render them.
            const go = function () {
                try { win.focus(); } catch (e) { /* focus is a nicety, print is not */ }
                win.print();
                if (typeof onReady === 'function') onReady();
            };
            if (win.requestAnimationFrame) win.requestAnimationFrame(go);
            else setTimeout(go, 0);
        };

        frame.onload = open;
        // srcdoc rather than document.write: write() leaves the frame with no
        // load event to wait for, which is what the old 50ms timer was papering
        // over. Same-origin either way, so the print call is still allowed.
        frame.srcdoc = html;
        return html;
    }

    const NametagCore = {
        WIDTH,
        HEIGHT,
        LOGO_SRC,
        splitName,
        firstNameSizeMm,
        nextPickupCode,
        assignPickupCodes,
        labelsFor,
        printHtml,
        printLabels,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = NametagCore;
    }
    if (global) {
        global.NametagCore = NametagCore;
    }
})(typeof window !== 'undefined' ? window : null);
