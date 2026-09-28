// Image intake — what happens to a picture before it is stored.
//
// Two ways an upload used to die, both of them at the door:
//
//   A phone's camera roll is HEIC. Chrome cannot draw that into a canvas, so
//   every allow-list that asked for JPEG, PNG or WebP refused it. Restricting
//   the file input makes iOS hand over a JPEG, and does nothing for a file
//   that was already HEIC — a desktop, a drag, an Android share.
//
//   A picture over the cap was refused with "too large", even on the paths
//   that already redraw a photo smaller before storing it. The person holding
//   the phone cannot resize it, so the refusal is a dead end.
//
// This module is the one answer. A HEIC file becomes a JPEG. A photo over the
// caller's cap is redrawn down the ladder until it fits, and the page says
// COMPRESSING_MESSAGE while that happens. GIF and SVG are left alone when they
// already fit: a canvas keeps one frame of an animation and flattens a drawing.
// A GIF that is over the cap is redrawn anyway, because the alternative is
// refusing the upload.
//
// The pure half — what a file is, and whether it needs work — is what the
// tests pin. The browser half at the bottom does the decode and is a no-op
// under Node.
(function (global) {
    'use strict';

    const COMPRESSING_MESSAGE = 'Compressing the image…';

    const HEIC_TYPES = {
        'image/heic': true,
        'image/heif': true,
        'image/heic-sequence': true,
        'image/heif-sequence': true,
    };

    // Types a canvas can re-encode. HEIC is included because we convert it
    // first; GIF is included only so an over-cap animation can still get in.
    const PHOTO_TYPES = {
        'image/jpeg': true,
        'image/jpg': true,
        'image/png': true,
        'image/webp': true,
        'image/bmp': true,
        'image/gif': true,
        'image/heic': true,
        'image/heif': true,
        'image/heic-sequence': true,
        'image/heif-sequence': true,
    };

    const PHOTO_EXT = {
        jpg: true, jpeg: true, png: true, webp: true, bmp: true, gif: true,
        heic: true, heif: true,
    };

    // Tried in order until the JPEG is under the caller's cap. The first rung
    // is what a photo on a page still looks like; the last is what it takes to
    // get a raw camera file under a Storage rule.
    const LADDER = Object.freeze([
        { maxEdge: 2400, quality: 0.82 },
        { maxEdge: 1800, quality: 0.74 },
        { maxEdge: 1200, quality: 0.66 },
        { maxEdge: 800, quality: 0.58 },
        { maxEdge: 480, quality: 0.5 },
    ]);

    const HEIC_SCRIPT = '/vendor/heic2any.min.js';

    function fileType(file) {
        return String((file && file.type) || '').toLowerCase().split(';')[0].trim();
    }

    function fileExt(file) {
        const match = /\.([a-z0-9]+)$/i.exec(String((file && file.name) || ''));
        return match ? match[1].toLowerCase() : '';
    }

    function isHeic(file) {
        if (!file) return false;
        const type = fileType(file);
        if (HEIC_TYPES[type]) return true;
        const ext = fileExt(file);
        if (ext !== 'heic' && ext !== 'heif') return false;
        // A JPEG that was merely named .heic is already something a canvas
        // can draw. Sending it through the HEIC decoder would fail it.
        if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' || type === 'image/gif') {
            return false;
        }
        return true;
    }

    function isCompressiblePhoto(file) {
        if (!file) return false;
        if (isHeic(file)) return true;
        const type = fileType(file);
        if (PHOTO_TYPES[type]) return true;
        // Some browsers hand a camera file over with an empty type, or as
        // application/octet-stream, and the name is the only clue.
        if (type && type !== 'application/octet-stream') return false;
        return !!PHOTO_EXT[fileExt(file)];
    }

    // True when the page should convert or redraw before the upload. A HEIC
    // always qualifies: even a small one will not display outside Safari.
    // `maxBytes` null means "convert HEIC, do not redraw for size".
    function needsWork(file, maxBytes) {
        if (!isCompressiblePhoto(file)) return false;
        if (isHeic(file)) return true;
        if (maxBytes == null) return false;
        return Number(file.size) > maxBytes;
    }

    function statusFor(file, maxBytes) {
        return needsWork(file, maxBytes) ? COMPRESSING_MESSAGE : '';
    }

    function jpegName(name) {
        const original = String(name == null ? '' : name).trim() || 'photo';
        if (/\.jpe?g$/i.test(original)) return original;
        return original.replace(/\.[^.\\/]+$/, '') + '.jpg';
    }

    function fittedSize(width, height, maxEdge) {
        const w = Math.max(1, Math.round(Number(width) || 0));
        const h = Math.max(1, Math.round(Number(height) || 0));
        const edge = Math.max(1, Math.round(Number(maxEdge) || LADDER[0].maxEdge));
        const longest = Math.max(w, h);
        if (longest <= edge) return { width: w, height: h };
        const scale = edge / longest;
        return {
            width: Math.max(1, Math.round(w * scale)),
            height: Math.max(1, Math.round(h * scale)),
        };
    }

    function toJpegFile(blob, name) {
        return new File([blob], jpegName(name), { type: 'image/jpeg' });
    }

    // ── Browser half ─────────────────────────────────────────────────────────

    function heicConverter() {
        if (typeof global.heic2any === 'function') return global.heic2any;
        return null;
    }

    function loadHeicConverter() {
        const ready = heicConverter();
        if (ready) return Promise.resolve(ready);
        if (global.__imageIntakeHeic) return global.__imageIntakeHeic;
        global.__imageIntakeHeic = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = HEIC_SCRIPT;
            script.onload = () => {
                const fn = heicConverter();
                if (fn) resolve(fn);
                else reject(new Error('Could not convert that HEIC image.'));
            };
            script.onerror = () => reject(new Error('Could not convert that HEIC image.'));
            (document.head || document.documentElement).appendChild(script);
        });
        return global.__imageIntakeHeic;
    }

    // Safari draws HEIC itself. Everywhere else, createImageBitmap throws and
    // we load the decoder. Trying the browser first keeps an iPhone off the
    // extra library when it does not need it.
    function browserDecodes(file) {
        if (typeof createImageBitmap !== 'function') return Promise.resolve(false);
        return createImageBitmap(file).then(bmp => {
            if (bmp && bmp.close) bmp.close();
            return true;
        }).catch(() => false);
    }

    // One JPEG at the top rung. Used when the browser can already draw a
    // HEIC (Safari) so the stored file is a JPEG everywhere else, not only
    // on the phone that picked it.
    async function encodeJpeg(file) {
        const img = await loadImage(file);
        const blob = await drawJpeg(img, LADDER[0]);
        return toJpegFile(blob, file && file.name);
    }

    async function ensureCanvasFile(file) {
        if (!isHeic(file)) return file;
        if (await browserDecodes(file)) return encodeJpeg(file);
        let result;
        try {
            const convert = await loadHeicConverter();
            result = await convert({ blob: file, toType: 'image/jpeg', quality: 0.85 });
        } catch (e) {
            throw new Error('Could not convert that HEIC image.');
        }
        const blob = Array.isArray(result) ? result[0] : result;
        if (!blob) throw new Error('Could not convert that HEIC image.');
        return toJpegFile(blob, file && file.name);
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Could not read that image.'));
            };
            img.src = url;
        });
    }

    function drawJpeg(img, rung) {
        const size = fittedSize(img.naturalWidth, img.naturalHeight, rung.maxEdge);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d');
        // JPEG has no transparency. A PNG drawn onto an empty canvas comes out
        // on black wherever it was clear.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(img, 0, 0, size.width, size.height);
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (!blob) reject(new Error('Could not read that image.'));
                else resolve(blob);
            }, 'image/jpeg', rung.quality);
        });
    }

    async function compressUnder(file, maxBytes) {
        const img = await loadImage(file);
        const cap = Number(maxBytes);
        let best = null;
        for (let i = 0; i < LADDER.length; i += 1) {
            const blob = await drawJpeg(img, LADDER[i]);
            const next = toJpegFile(blob, file && file.name);
            if (!best || next.size < best.size) best = next;
            if (Number.isFinite(cap) && next.size <= cap) return next;
        }
        return best || file;
    }

    // Convert HEIC, then redraw until the file is under `maxBytes`. A caller
    // that passes no cap only converts. The original comes back unchanged when
    // there is nothing to do.
    async function prepare(file, options) {
        const opts = options || {};
        const maxBytes = opts.maxBytes;
        const current = await ensureCanvasFile(file);
        if (!isCompressiblePhoto(current) && !isCompressiblePhoto(file)) return current;
        if (maxBytes == null || !(Number(current.size) > maxBytes)) return current;
        return compressUnder(current, maxBytes);
    }

    const ImageIntake = {
        COMPRESSING_MESSAGE,
        LADDER,
        HEIC_SCRIPT,
        isHeic,
        isCompressiblePhoto,
        needsWork,
        statusFor,
        jpegName,
        fittedSize,
        ensureCanvasFile,
        compressUnder,
        prepare,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ImageIntake;
    }
    if (global) global.ImageIntake = ImageIntake;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
