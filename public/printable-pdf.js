// Printable PDF — a Printable's pages, as they stand today, as one PDF.
//
// The snapshot filed on an event (MS-400, ADR-0057): the one frozen thing in
// a live system. Every page — overflow pages included — is drawn at true
// pixel size, rasterised with html2canvas, and placed on a PDF page of the
// paper's physical size with jsPDF. Both libraries are vendored (ADR-0050)
// and loaded on demand: a calendar page should not pay for a PDF engine it
// may never use.
//
// Two shapes:
//   • `render` — flat stack (one page per PDF page). Sunday booklet path
//     pads to ×4; no imposition (MS-589 / MS-592).
//   • `renderFolio` — landscape sheets, two pages each, saddle-stitch
//     order from PrintableExportCore.folioSpreads (the Folio print path).
//
// Browser-only. Nothing here reads Firestore — the caller lays the pages out
// through PrintableLive and hands them in.

(function (global) {
    'use strict';

    const HTML2CANVAS = 'vendor/html2canvas-1.4.1.min.js';
    const JSPDF = 'vendor/jspdf-2.5.1.umd.min.js';

    const loading = {};

    function loadScript(src) {
        if (loading[src]) return loading[src];
        loading[src] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => resolve();
            s.onerror = () => { delete loading[src]; reject(new Error('Could not load ' + src)); };
            document.head.appendChild(s);
        });
        return loading[src];
    }

    async function ready() {
        if (typeof global.html2canvas !== 'function') await loadScript(HTML2CANVAS);
        if (!global.jspdf || !global.jspdf.jsPDF) await loadScript(JSPDF);
    }

    // Snapshot the page the editor already laid out. Do not resize or
    // reposition images here. A second fit — shrinking the box, then
    // absolute-positioning the leftover gap — pulls the cover seal and the
    // Connect & Give QR out of the flex flow the preview already got right.
    // html2canvas photographs that layout.

    function waitForImages(root) {
        const imgs = Array.from(root.querySelectorAll('img')).filter(img => img.getAttribute('src'));
        return Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        })));
    }

    function pageForEntry(entry, blankN) {
        if (entry && entry.page) {
            return Object.assign({}, entry.page, {
                nodes: entry.nodes || entry.page.nodes || [],
            });
        }
        return {
            id: 'folio-blank-' + blankN,
            nodes: [],
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            style: { 'background-color': '#ffffff' },
        };
    }

    // `entries` is what PrintableLive.layoutPages returns. `opts.scale` is
    // the raster scale on top of the page's own pixels (1 = the page's
    // density; 2 doubles it).
    async function render(project, entries, opts) {
        const o = opts || {};
        await ready();
        const Dom = global.PrintableDom;
        const t = project.template;
        // Sunday booklet path: pad to ×4. No imposition — printer saddle
        // mode folds this stack (MS-589 / MS-592). Other Printables stay
        // as laid out unless the caller forces padToMultipleOf4.
        const Export = global.PrintableExportCore;
        const pages = Export ? Export.exportEntries(entries || [], project, o) : (entries || []);
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-100000px;top:0;width:' + t.widthPx + 'px;pointer-events:none;';
        document.body.appendChild(host);
        try {
            const orientation = t.widthIn > t.heightIn ? 'landscape' : 'portrait';
            const doc = new global.jspdf.jsPDF({ unit: 'in', format: [t.widthIn, t.heightIn], orientation: orientation, compress: true });
            for (let i = 0; i < pages.length; i++) {
                const entry = pages[i];
                host.innerHTML = '';
                const page = Dom.renderPage(Object.assign({}, entry.page, { nodes: entry.nodes }), t, {
                    scopeId: entry.page.id,
                    pageIndex: entry.pageIndex == null ? i : entry.pageIndex,
                });
                host.appendChild(page);
                await waitForImages(page);
                const canvas = await global.html2canvas(page, {
                    scale: o.scale || 1, useCORS: true, allowTaint: false, backgroundColor: '#ffffff', logging: false,
                    width: t.widthPx, height: t.heightPx, windowWidth: t.widthPx, windowHeight: t.heightPx,
                });
                if (i > 0) doc.addPage([t.widthIn, t.heightIn], orientation);
                doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, t.widthIn, t.heightIn, undefined, 'FAST');
                if (o.onProgress) o.onProgress(i + 1, pages.length);
            }
            return doc.output('blob');
        } finally {
            host.remove();
        }
    }

    // Folio-imposed PDF: two pages per landscape sheet, same pairing as
    // Print folio / PrintableExportCore.folioSpreads. Prefer a pad-ready
    // stack (multiple of 4) so blanks are only what the operator left.
    async function renderFolio(project, entries, opts) {
        const o = opts || {};
        await ready();
        const Dom = global.PrintableDom;
        const Export = global.PrintableExportCore;
        if (!Export || typeof Export.folioSpreads !== 'function' || typeof Export.folioSheet !== 'function') {
            throw new Error('folio export is not available');
        }
        const t = project.template;
        const sheet = Export.folioSheet(t);
        const spreads = Export.folioSpreads(entries || []);
        if (!spreads.length) throw new Error('not laid out');
        const sheetWpx = t.widthPx * 2;
        const sheetHpx = t.heightPx;
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-100000px;top:0;width:' + sheetWpx + 'px;pointer-events:none;';
        document.body.appendChild(host);
        try {
            const doc = new global.jspdf.jsPDF({
                unit: 'in',
                format: [sheet.widthIn, sheet.heightIn],
                orientation: 'landscape',
                compress: true,
            });
            let blankN = 0;
            for (let i = 0; i < spreads.length; i++) {
                const spread = spreads[i];
                host.innerHTML = '';
                const sheetEl = document.createElement('div');
                sheetEl.style.cssText = 'display:flex;flex-direction:row;align-items:stretch;overflow:hidden;'
                    + 'width:' + sheetWpx + 'px;height:' + sheetHpx + 'px;background:#fff;';
                ['left', 'right'].forEach((side) => {
                    const entry = spread[side];
                    const idx = side === 'left' ? spread.leftIdx : spread.rightIdx;
                    const leaf = document.createElement('div');
                    leaf.style.cssText = 'width:' + t.widthPx + 'px;height:' + t.heightPx + 'px;'
                        + 'flex:0 0 ' + t.widthPx + 'px;overflow:hidden;position:relative;background:#fff;';
                    if (!entry || !entry.page) blankN += 1;
                    const page = pageForEntry(entry, blankN);
                    leaf.appendChild(Dom.renderPage(page, t, {
                        scopeId: page.id,
                        pageIndex: idx == null ? 0 : idx,
                    }));
                    sheetEl.appendChild(leaf);
                });
                host.appendChild(sheetEl);
                await waitForImages(sheetEl);
                const canvas = await global.html2canvas(sheetEl, {
                    scale: o.scale || 1, useCORS: true, allowTaint: false, backgroundColor: '#ffffff', logging: false,
                    width: sheetWpx, height: sheetHpx, windowWidth: sheetWpx, windowHeight: sheetHpx,
                });
                if (i > 0) doc.addPage([sheet.widthIn, sheet.heightIn], 'landscape');
                doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, sheet.widthIn, sheet.heightIn, undefined, 'FAST');
                if (o.onProgress) o.onProgress(i + 1, spreads.length);
            }
            return doc.output('blob');
        } finally {
            host.remove();
        }
    }

    // Attachment file name. Optional `title` is what the editor typed; empty
    // falls back to "Name — date". Always ends in .pdf.
    function fileName(project, date, title) {
        const fallback = String(project && project.name || 'Printable').replace(/[\\/:*?"<>|]+/g, ' ').trim()
            + ' — ' + (date || new Date().toISOString().slice(0, 10));
        let base = String(title != null && String(title).trim() !== '' ? title : fallback)
            .replace(/[\\/:*?"<>|]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!base) base = 'Printable';
        if (!/\.pdf$/i.test(base)) base += '.pdf';
        return base;
    }

    const PrintablePdf = { render, renderFolio, fileName, ready };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintablePdf;
    }
    if (global) {
        global.PrintablePdf = PrintablePdf;
    }
})(typeof window !== 'undefined' ? window : globalThis);
