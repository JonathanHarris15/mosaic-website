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
        const used = (already || []).slice();
        const byPerson = {};
        (already || []).forEach(function (row) {
            if (row && row.personId && row.pickupCode) byPerson[row.personId] = row.pickupCode;
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

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, function (ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    }

    function labelMarkup(label) {
        const kind = label.kind;
        const title = kind === 'stub' ? 'Pickup stub' : (kind === 'child' ? 'Child' : '');
        const code = label.code
            ? '<div class="code">' + escapeHtml(label.code) + '</div>'
            : '';
        const kindLine = title
            ? '<div class="kind">' + escapeHtml(title) + '</div>'
            : '';
        return (
            '<article class="label kind-' + escapeHtml(kind) + '">' +
                '<div>' +
                    kindLine +
                    '<div class="first">' + escapeHtml(label.first) + '</div>' +
                    '<div class="last">' + escapeHtml(label.last) + '</div>' +
                '</div>' +
                '<div class="footer">' +
                    '<div>' +
                        '<div class="event">' + escapeHtml(label.eventName) + '</div>' +
                        '<div class="when">' + escapeHtml(label.date) + '</div>' +
                    '</div>' +
                    code +
                '</div>' +
            '</article>'
        );
    }

    function printHtml(labels) {
        const body = (labels || []).map(labelMarkup).join('\n');
        return '<!doctype html><html><head><meta charset="utf-8"><title>Name tags</title>' +
            '<style>' +
            '@page { size: ' + WIDTH + ' ' + HEIGHT + '; margin: 0; }' +
            'html, body { margin: 0; padding: 0; background: #fff; }' +
            '.label { width: ' + WIDTH + '; height: ' + HEIGHT + '; box-sizing: border-box;' +
            ' padding: 3mm 4mm; display: flex; flex-direction: column; justify-content: space-between;' +
            ' page-break-after: always; break-after: page; color: #000; font-family: Arial, Helvetica, sans-serif;' +
            ' -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
            '.label:last-child { page-break-after: auto; break-after: auto; }' +
            '.first { font-size: 15mm; font-weight: 700; line-height: 0.95; letter-spacing: -0.02em; white-space: nowrap; }' +
            '.last { font-size: 6mm; font-weight: 400; line-height: 1; margin-top: 1mm; }' +
            '.kind { font-size: 3mm; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 1mm; }' +
            '.footer { display: flex; align-items: flex-end; justify-content: space-between; gap: 3mm; }' +
            '.event { font-size: 4mm; font-weight: 600; }' +
            '.when { font-size: 2.8mm; margin-top: 0.6mm; }' +
            '.code { font-family: "Courier New", monospace; font-size: 11mm; font-weight: 700; line-height: 0.9; letter-spacing: 0.5mm; }' +
            '.kind-stub { border: 0.6mm dashed #000; }' +
            '</style></head><body>' + body + '</body></html>';
    }

    function printLabels(labels, doc) {
        const html = printHtml(labels);
        if (!doc || !doc.body) return html;
        let frame = doc.getElementById('kiosk-print-frame');
        if (!frame) {
            frame = doc.createElement('iframe');
            frame.id = 'kiosk-print-frame';
            frame.setAttribute('aria-hidden', 'true');
            frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
            doc.body.appendChild(frame);
        }
        const win = frame.contentWindow;
        const inner = frame.contentDocument;
        inner.open();
        inner.write(html);
        inner.close();
        setTimeout(function () { win.focus(); win.print(); }, 50);
        return html;
    }

    const NametagCore = {
        WIDTH,
        HEIGHT,
        splitName,
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
