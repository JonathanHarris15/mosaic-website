// Guide Image Core — what a picture may weigh before it goes in a Service Guide.
//
// ⚠ THE BUG THIS EXISTS FOR. A picture picked in the guide editor was read
// straight to a base64 data URI and put in `values`, and `values` is written
// INSIDE services/{date}. Firestore refuses a document over 1,048,576 bytes, so
// one photo off a phone took the whole week down with it:
//
//     Document services/2026-09-06 cannot be written because its size
//     (1,130,211 bytes) exceeds the maximum allowed size of 1,048,576 bytes.
//
// And it failed as an AUTOSAVE, which does not shout — the chip said "Unsaved
// changes" and every keystroke after it failed the same way.
//
// Hymn sheets were never the problem and are not capped here: those live in
// Storage, and a guide holds their URLs.
//
// So a picked picture is redrawn to a ceiling BEFORE it is stored, rather than
// stored and then complained about. The ladder below steps down until the
// encoded string is under budget, because "that image is too big" is not an
// answer somebody standing at a Sunday deadline can act on.
//
// Only the ones that need it. A picture that already fits is stored byte for
// byte as it was picked — redrawing it buys nothing and costs something: the
// redraw is a JPEG, and a logo or a QR code comes back with white behind its
// transparency and fuzz along its edges.
//
// The pure half is the policy — what may be picked, what it must fit in, and
// what to try next. The browser half at the bottom does the canvas work and is
// a no-op under Node.
(function (global) {
    'use strict';

    if (typeof module !== 'undefined' && module.exports) {
        require('./image-intake.js');
    }

    function intake() {
        return typeof globalThis !== 'undefined' ? globalThis.ImageIntake : null;
    }

    // What a canvas can redraw on its own, plus HEIC, which image-intake.js
    // converts to JPEG before the redraw. A file input used to exclude HEIC so
    // iOS would transcode; a file that is already HEIC still has to get in.
    const ACCEPTED_TYPES = [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
    ];
    const FILE_ACCEPT = [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'image/heic', 'image/heif', '.heic', '.heif',
    ].join(',');

    // Past this size the page says it is compressing. The redraw below is what
    // actually gets the picture under the document budget — the old refusal
    // ("keep it under 20MB") turned away photos the ladder would have fitted.
    const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

    // What one picture may occupy in the document. The rest of the week's guide
    // is around 180KB — mostly the snapshot, which is the template's HTML and
    // CSS frozen onto the week — so this leaves room for a handful of pictures
    // and everything else before the 1MB wall.
    const BUDGET_BYTES = 250 * 1024;

    // Tried in order until one fits. The first rung is what a picture printed
    // across half a booklet page actually needs; the rest are what it takes to
    // get a photograph of a whole beach under the budget.
    const LADDER = [
        { maxEdge: 1400, quality: 0.82 },
        { maxEdge: 1100, quality: 0.78 },
        { maxEdge: 900, quality: 0.72 },
        { maxEdge: 700, quality: 0.66 },
    ];

    // JPEG has no transparency, so a PNG logo drawn straight onto an empty
    // canvas comes out on black. The guide is printed on white paper.
    const MATTE = '#ffffff';

    function validateImageFile(file) {
        if (!file) return { ok: false, error: 'Choose an image first.', compress: false };
        const lib = intake();
        const type = String(file.type || '').toLowerCase();
        const heic = lib ? lib.isHeic(file) : (type === 'image/heic' || type === 'image/heif');
        if (ACCEPTED_TYPES.indexOf(type) === -1 && !heic) {
            return { ok: false, error: 'Use a JPEG, PNG, WebP, GIF or HEIC image.', compress: false };
        }
        const compress = heic || Number(file.size) > MAX_UPLOAD_BYTES;
        return { ok: true, error: null, compress: compress };
    }

    // Fit within a square of `maxEdge` without distorting, and never enlarge a
    // small image — upscaling a thumbnail stores a blurrier, bigger copy.
    //
    // The same shape as the one in person-photo-core.js, and deliberately not
    // shared with it: a directory photo has a different ceiling and goes to
    // Storage, and loading that module on the guide pages to borrow six lines
    // of arithmetic would tie two features together that have nothing to say
    // to each other.
    function scaledSize(width, height, maxEdge) {
        const max = maxEdge || LADDER[0].maxEdge;
        const w = Math.max(1, Math.round(width || 0));
        const h = Math.max(1, Math.round(height || 0));
        const longest = Math.max(w, h);
        if (longest <= max) return { width: w, height: h };
        const scale = max / longest;
        return {
            width: Math.max(1, Math.round(w * scale)),
            height: Math.max(1, Math.round(h * scale)),
        };
    }

    // What the string will occupy in the document. A data URI is all ASCII, so
    // its length IS its byte count.
    function storedBytes(dataUrl) {
        return String(dataUrl || '').length;
    }

    // What a file WILL occupy if it is stored exactly as it is: base64 spends
    // four characters on every three bytes, rounded up to a multiple of four,
    // behind a header like "data:image/png;base64,".
    function storedBytesFor(file) {
        const type = (file && file.type) || 'application/octet-stream';
        const bytes = Math.max(0, (file && file.size) || 0);
        return ('data:' + type + ';base64,').length + Math.ceil(bytes / 3) * 4;
    }

    // Only a picture that is actually too big is touched. Redrawing one that
    // already fits would re-encode a PNG logo as a JPEG — white behind its
    // transparency, fuzz on its hard edges — to save nothing at all.
    function needsRedraw(file, budget) {
        return storedBytesFor(file) > (budget || BUDGET_BYTES);
    }

    function fitsBudget(dataUrl, budget) {
        return storedBytes(dataUrl) <= (budget || BUDGET_BYTES);
    }

    // The rungs, smallest last. Exported so a test can walk the same list the
    // browser half does rather than a copy of it.
    function attempts() {
        return LADDER.map(rung => ({ maxEdge: rung.maxEdge, quality: rung.quality }));
    }

    // Which rung to keep: the first that fits, and failing that the last one
    // tried. A picture that will not come under budget at 700px is one nobody
    // wants at full size either, and handing back the smallest beats refusing
    // to store anything.
    function chooseAttempt(results, budget) {
        const list = (results || []).filter(r => r && r.dataUrl);
        if (!list.length) return null;
        return list.find(r => fitsBudget(r.dataUrl, budget)) || list[list.length - 1];
    }

    // ── Browser half ─────────────────────────────────────────────────────────

    function readAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Could not read that image.'));
            reader.readAsDataURL(file);
        });
    }

    function decode(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
            img.src = url;
        });
    }

    function drawToDataUrl(img, rung) {
        const size = scaledSize(img.naturalWidth, img.naturalHeight, rung.maxEdge);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = MATTE;
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(img, 0, 0, size.width, size.height);
        return canvas.toDataURL('image/jpeg', rung.quality);
    }

    // Redraw a picked file down to something the document can hold, and hand
    // back the data URI to store.
    async function capToDataUrl(file, budget) {
        const check = validateImageFile(file);
        if (!check.ok) throw new Error(check.error);

        const lib = intake();
        let source = file;
        // A HEIC data URI will not draw outside Safari, however small it is,
        // so it is always converted before the "already fits" shortcut.
        if (lib && lib.isHeic(file)) source = await lib.ensureCanvasFile(file);

        // Small enough already: keep the file's own bytes, whatever format
        // they are in.
        if (!needsRedraw(source, budget)) return readAsDataUrl(source);

        const img = await decode(source);
        const tried = [];
        for (const rung of attempts()) {
            const dataUrl = drawToDataUrl(img, rung);
            tried.push({ rung, dataUrl });
            if (fitsBudget(dataUrl, budget)) break;
        }
        const chosen = chooseAttempt(tried, budget);
        if (!chosen) throw new Error('Could not read that image.');
        return chosen.dataUrl;
    }

    const GuideImageCore = {
        ACCEPTED_TYPES, FILE_ACCEPT, MAX_UPLOAD_BYTES, BUDGET_BYTES, LADDER,
        validateImageFile, scaledSize, storedBytes, storedBytesFor, needsRedraw,
        fitsBudget, attempts, chooseAttempt,
        capToDataUrl,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = GuideImageCore;
    global.GuideImageCore = GuideImageCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
