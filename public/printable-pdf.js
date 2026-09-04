// Printable PDF — a Printable's pages, as they stand today, as one PDF.
//
// The snapshot filed on an event (MS-400, ADR-0057): the one frozen thing in
// a live system. Every page — overflow pages included — is drawn at true
// pixel size, rasterised with html2canvas, and placed on a PDF page of the
// paper's physical size with jsPDF. Both libraries are vendored (ADR-0050)
// and loaded on demand: a calendar page should not pay for a PDF engine it
// may never use.
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

    // `entries` is what PrintableLive.layoutPages returns. `opts.scale` is
    // the raster scale on top of the page's own pixels (1 = the page's
    // density; 2 doubles it).
    async function render(project, entries, opts) {
        const o = opts || {};
        await ready();
        const Dom = global.PrintableDom;
        const t = project.template;
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-100000px;top:0;width:' + t.widthPx + 'px;pointer-events:none;';
        document.body.appendChild(host);
        try {
            const orientation = t.widthIn > t.heightIn ? 'landscape' : 'portrait';
            const doc = new global.jspdf.jsPDF({ unit: 'in', format: [t.widthIn, t.heightIn], orientation: orientation, compress: true });
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                host.innerHTML = '';
                const page = Dom.renderPage(Object.assign({}, entry.page, { nodes: entry.nodes }), t, { scopeId: entry.page.id });
                host.appendChild(page);
                await waitForImages(page);
                const canvas = await global.html2canvas(page, {
                    scale: o.scale || 1, useCORS: true, allowTaint: false, backgroundColor: '#ffffff', logging: false,
                    width: t.widthPx, height: t.heightPx, windowWidth: t.widthPx, windowHeight: t.heightPx,
                });
                if (i > 0) doc.addPage([t.widthIn, t.heightIn], orientation);
                doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, t.widthIn, t.heightIn, undefined, 'FAST');
                if (o.onProgress) o.onProgress(i + 1, entries.length);
            }
            return doc.output('blob');
        } finally {
            host.remove();
        }
    }

    function waitForImages(root) {
        const imgs = Array.from(root.querySelectorAll('img')).filter(img => img.getAttribute('src'));
        return Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        })));
    }

    // "Membership directory — 2026-09-13.pdf"
    function fileName(project, date) {
        const base = String(project.name || 'Printable').replace(/[\\/:*?"<>|]+/g, ' ').trim();
        return base + ' — ' + (date || new Date().toISOString().slice(0, 10)) + '.pdf';
    }

    const PrintablePdf = { render, fileName, ready };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintablePdf;
    }
    if (global) {
        global.PrintablePdf = PrintablePdf;
    }
})(typeof window !== 'undefined' ? window : globalThis);
