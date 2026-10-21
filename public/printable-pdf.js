// Printable PDF — a Printable's pages, as they stand today, as one PDF.
//
// The snapshot filed on an event (MS-400, ADR-0057): the one frozen thing in
// a live system. Every page — overflow pages included — is drawn at true
// pixel size, rasterised for the PDF, and placed on a PDF page of the
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

    // html2canvas paints a bitmap into the element box. It ignores
    // object-fit, clip-path, and mask, so a contained picture stretches and
    // a shaped marker comes out as the square behind the shape. The browser
    // paint of this same DOM is correct, and a foreignObject copy of it
    // cannot be exported (the canvas is tainted). So, in the snapshot DOM
    // only, paint the picture and the marker the browser already showed,
    // into the boxes the page already laid out. Do not move those boxes.

    // Where a picture is drawn inside its box. `cover` crops, `contain` and
    // `scale-down` letterbox. The box itself does not change.
    function fittedDrawRect(boxW, boxH, natW, natH, fit, objectPosition) {
        const bw = Number(boxW) || 0;
        const bh = Number(boxH) || 0;
        const nw = Number(natW) || 0;
        const nh = Number(natH) || 0;
        if (!(bw > 0 && bh > 0 && nw > 0 && nh > 0)) return null;
        let scale = fit === 'cover' ? Math.max(bw / nw, bh / nh) : Math.min(bw / nw, bh / nh);
        if (fit === 'scale-down') scale = Math.min(1, scale);
        const w = nw * scale;
        const h = nh * scale;
        const parts = String(objectPosition || '50% 50%').trim().split(/\s+/);
        return {
            x: axisOffset(parts[0], bw - w),
            y: axisOffset(parts.length > 1 ? parts[1] : 'center', bh - h),
            w: w,
            h: h,
        };
    }

    function axisOffset(token, space) {
        const t = String(token || 'center').trim();
        if (t === 'left' || t === 'top') return 0;
        if (t === 'right' || t === 'bottom') return space;
        if (t === 'center') return space / 2;
        if (/%$/.test(t)) return space * (parseFloat(t) / 100);
        const n = parseFloat(t);
        return Number.isFinite(n) ? n : space / 2;
    }

    function cssLen(token, ref) {
        const t = String(token || '0').trim();
        if (/%$/.test(t)) return ref * (parseFloat(t) / 100);
        const n = parseFloat(t);
        return Number.isFinite(n) ? n : 0;
    }

    // Chrome reports clip-path as `polygon(50% 0px, 8px 2.25px, …)`.
    function parseClipPolygon(clip, width, height) {
        if (!clip || clip === 'none') return null;
        const m = String(clip).match(/polygon\(\s*([^)]*)\)/i);
        if (!m) return null;
        const pts = m[1].split(',').map(pair => {
            const bits = pair.trim().split(/\s+/);
            if (bits.length < 2) return null;
            return [cssLen(bits[0], width), cssLen(bits[1], height)];
        }).filter(Boolean);
        return pts.length >= 3 ? pts : null;
    }

    // A marker drawn with an SVG mask (the hexagon used to be one). The
    // points are in the mask's viewBox; scale them into the marker box.
    function parseMaskPolygon(maskImage, width, height) {
        if (!maskImage || maskImage === 'none') return null;
        let text = String(maskImage);
        const data = text.match(/data:image\/svg\+xml(?:;charset=[^,]*)?,([^)]+)/i);
        if (data) {
            const body = data[1].replace(/["'\s]+$/, '');
            try { text = decodeURIComponent(body); } catch (e) { text = body; }
        }
        const ptsMatch = text.match(/points=['"]([^'"]+)['"]/i);
        if (!ptsMatch) return null;
        const vb = text.match(/viewBox=['"]\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i);
        const raw = ptsMatch[1].trim().split(/\s+/).map(pair => pair.split(',').map(Number));
        const pairs = raw.filter(p => p.length >= 2 && p.every(n => Number.isFinite(n)));
        if (pairs.length < 3) return null;
        const vw = vb ? parseFloat(vb[1]) : Math.max.apply(null, pairs.map(p => p[0]));
        const vh = vb ? parseFloat(vb[2]) : Math.max.apply(null, pairs.map(p => p[1]));
        if (!(vw > 0 && vh > 0)) return null;
        return pairs.map(p => [p[0] / vw * width, p[1] / vh * height]);
    }

    // These have to beat the preview's own marker rules. Those set
    // `content: "" !important` on `.pr-page .m-qlist li::before` (and the
    // ordinary-list dot). A shorter `.pr-raster-nobefore::before` loses that
    // fight, html2canvas still paints the ::before, and because it ignores
    // clip-path the marker comes out as the square behind the hexagon.
    const RASTER_HIDE = [
        '.pr-page .m-qlist li.pr-raster-nobefore::before,',
        '.preview-page .m-qlist li.pr-raster-nobefore::before,',
        '.pr-page ul:not(.m-qlist) > li.pr-raster-nobefore::before,',
        '.preview-page ul:not(.m-qlist) > li.pr-raster-nobefore::before,',
        '.pr-page .pr-raster-nobefore::before,',
        '.preview-page .pr-raster-nobefore::before,',
        '.pr-raster-nobefore::before { content: none !important; background: none !important; display: none !important; }',
        '.pr-page .pr-raster-noafter::after,',
        '.preview-page .pr-raster-noafter::after,',
        '.pr-raster-noafter::after { content: none !important; background: none !important; display: none !important; }',
    ].join('\n');

    function ensureRasterStyle() {
        if (typeof document === 'undefined' || document.getElementById('pr-raster-style')) return;
        const style = document.createElement('style');
        style.id = 'pr-raster-style';
        style.textContent = [
            RASTER_HIDE,
            '.pr-raster-mark { position: absolute; margin: 0; padding: 0; border: 0; display: block; }',
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
    }

    function canvasTaintedBy(source) {
        try {
            const probe = document.createElement('canvas');
            probe.width = 1;
            probe.height = 1;
            probe.getContext('2d').drawImage(source, 0, 0, 1, 1);
            probe.toDataURL();
            return false;
        } catch (e) {
            return true;
        }
    }

    // A picture loaded without CORS cannot be copied onto a canvas. Reload
    // it the same way html2canvas does (anonymous CORS) so the letterbox can
    // be baked. If that fails, the caller leaves the picture as it was.
    function loadCorsImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('cors'));
            image.src = src;
        });
    }

    async function fittedImageUrl(img, px) {
        const cs = global.getComputedStyle(img);
        const fit = cs.objectFit || 'fill';
        if (fit !== 'contain' && fit !== 'cover' && fit !== 'scale-down') return null;
        const box = img.getBoundingClientRect();
        let source = img;
        let natW = img.naturalWidth;
        let natH = img.naturalHeight;
        if (!(natW > 0 && natH > 0)) return null;
        if (canvasTaintedBy(img)) {
            try {
                source = await loadCorsImage(img.currentSrc || img.src);
                natW = source.naturalWidth;
                natH = source.naturalHeight;
            } catch (e) {
                return null;
            }
        }
        const rect = fittedDrawRect(box.width, box.height, natW, natH, fit, cs.objectPosition);
        if (!rect) return null;
        if (Math.abs(rect.x) < 0.5 && Math.abs(rect.y) < 0.5
            && Math.abs(rect.w - box.width) < 0.5 && Math.abs(rect.h - box.height) < 0.5) return null;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(box.width * px));
        canvas.height = Math.max(1, Math.round(box.height * px));
        const ctx = canvas.getContext('2d');
        ctx.scale(px, px);
        ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h);
        return canvas.toDataURL('image/png');
    }

    function markerCanvas(w, h, points, radius, color, px) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * px));
        canvas.height = Math.max(1, Math.round(h * px));
        const ctx = canvas.getContext('2d');
        ctx.scale(px, px);
        ctx.fillStyle = color;
        ctx.beginPath();
        if (points) {
            ctx.moveTo(points[0][0], points[0][1]);
            for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
            ctx.closePath();
        } else if (radius + 0.5 >= Math.min(w, h) / 2) {
            ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        } else {
            const r = radius;
            ctx.moveTo(r, 0);
            ctx.arcTo(w, 0, w, h, r);
            ctx.arcTo(w, h, 0, h, r);
            ctx.arcTo(0, h, 0, 0, r);
            ctx.arcTo(0, 0, w, 0, r);
            ctx.closePath();
        }
        ctx.fill();
        return canvas;
    }

    function paintPseudo(el, pseudo, px) {
        const cs = global.getComputedStyle(el, pseudo);
        const content = cs.content;
        if (!content || content === 'none' || content === 'normal') return;
        const w = parseFloat(cs.width);
        const h = parseFloat(cs.height);
        if (!(w > 0 && h > 0)) return;
        if (cs.left === 'auto' || cs.top === 'auto') return;
        const points = parseClipPolygon(cs.clipPath || cs.webkitClipPath, w, h)
            || parseMaskPolygon(cs.webkitMaskImage || cs.maskImage, w, h);
        const radius = cssLen(String(cs.borderRadius || '0').split(/\s+/)[0], Math.min(w, h));
        if (!points && !(radius > 0.5)) return;
        const color = cs.backgroundColor;
        if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return;
        let canvas;
        try { canvas = markerCanvas(w, h, points, radius, color, px); }
        catch (e) { return; }
        const img = document.createElement('img');
        img.className = 'pr-raster-mark';
        img.alt = '';
        img.src = canvas.toDataURL('image/png');
        img.style.left = cs.left;
        img.style.top = cs.top;
        img.style.width = w + 'px';
        img.style.height = h + 'px';
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
        if (global.getComputedStyle(el).position === 'static') el.style.position = 'relative';
        el.classList.add(pseudo === '::before' ? 'pr-raster-nobefore' : 'pr-raster-noafter');
        el.insertBefore(img, el.firstChild);
    }

    async function prepareRaster(root, scale) {
        if (!root || typeof root.querySelectorAll !== 'function' || !global.getComputedStyle) return;
        ensureRasterStyle();
        const px = Math.max(2, Number(scale) || 1);
        const imgs = Array.from(root.querySelectorAll('img')).filter(img => !img.classList.contains('pr-raster-mark'));
        await Promise.all(imgs.map(async img => {
            if (!img.naturalWidth || !img.naturalHeight) return;
            let url = null;
            try { url = await fittedImageUrl(img, px); } catch (e) { return; }
            if (!url) return;
            img.src = url;
            img.style.objectFit = 'fill';
            try { await img.decode(); } catch (e) { /* the bitmap is already in memory */ }
        }));
        const nodes = [root].concat(Array.from(root.querySelectorAll('*')));
        nodes.forEach(el => {
            if (el.classList && el.classList.contains('pr-raster-mark')) return;
            paintPseudo(el, '::before', px);
            paintPseudo(el, '::after', px);
        });
        await Promise.all(Array.from(root.querySelectorAll('img.pr-raster-mark')).map(img => img.decode().catch(() => {})));
    }

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
            const Core = global.PrintableCore;
            const numberOrigin = Core && typeof Core.numberOriginFromEntries === 'function'
                ? Core.numberOriginFromEntries(pages)
                : 0;
            for (let i = 0; i < pages.length; i++) {
                const entry = pages[i];
                host.innerHTML = '';
                const page = Dom.renderPage(Object.assign({}, entry.page, { nodes: entry.nodes }), t, {
                    scopeId: entry.page.id,
                    pageIndex: entry.pageIndex == null ? i : entry.pageIndex,
                    numberOrigin: numberOrigin,
                });
                host.appendChild(page);
                await waitForImages(page);
                await prepareRaster(page, o.scale || 1);
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
        const Core = global.PrintableCore;
        const numberOrigin = Core && typeof Core.numberOriginFromEntries === 'function'
            ? Core.numberOriginFromEntries(entries || [])
            : 0;
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
                        numberOrigin: numberOrigin,
                    }));
                    sheetEl.appendChild(leaf);
                });
                host.appendChild(sheetEl);
                await waitForImages(sheetEl);
                await prepareRaster(sheetEl, o.scale || 1);
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

    const PrintablePdf = { render, renderFolio, fileName, ready, fittedDrawRect, parseClipPolygon, parseMaskPolygon, prepareRaster };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintablePdf;
    }
    if (global) {
        global.PrintablePdf = PrintablePdf;
    }
})(typeof window !== 'undefined' ? window : globalThis);
