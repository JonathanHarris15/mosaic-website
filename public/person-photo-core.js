// Person Photo Core — the policy for a directory photo (ADR-0029).
//
// A photo joins the self-editable set from ADR-0012 (contact, birthday, and sex
// while unset). It belongs there for the same reason those do: it is a fact
// about you that only you have, and it is not an identifier anything else in
// the app reads. That is what separates it from the name, which the Service
// Builder, the Calendar, the rosters and every elder's note refer to, and which
// therefore needs an editor (ADR-0027).
//
// So there is no approval queue here. You set your own photo; an editor sets or
// clears anyone's.
//
// The pure half — what may be uploaded, where it goes, and what gets written on
// the Person — lives here so the Firestore rules, the profile page and the
// directory share one allow-list. The browser half at the bottom does the
// resize and the upload, and is a no-op outside a browser.
(function (global) {
    'use strict';

    // What a browser can reliably decode into a <canvas>, which is what the
    // resize needs. A file input restricted to these also makes iOS hand over a
    // JPEG rather than the HEIC it stores.
    const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    // A ceiling on what we will even try to read. Everything is resized before
    // upload, so this only exists to stop a browser choking on a raw camera file.
    const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

    // The longest edge we store. The directory renders these at 56px and the
    // profile page at about 96px, so 800 is generous for a retina screen and
    // still small enough that a whole congregation's worth loads quickly.
    const MAX_EDGE_PX = 800;
    const JPEG_QUALITY = 0.85;

    const STORAGE_ROOT = 'people_photos';

    // The Person fields a photo writes. Named here because the Firestore rules
    // list the same two, and a photo that is stored but not attachable is worse
    // than no photo at all.
    const PHOTO_FIELDS = ['photoUrl', 'photoPath'];

    function validatePhotoFile(file) {
        if (!file) return { ok: false, error: 'Choose a photo first.' };
        if (ACCEPTED_TYPES.indexOf(file.type) === -1) {
            return { ok: false, error: 'Use a JPEG, PNG or WebP image.' };
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            return { ok: false, error: 'That image is too large. Keep it under 15MB.' };
        }
        return { ok: true, error: null };
    }

    // Fit within a square of `maxEdge` without distorting, and never enlarge a
    // small image — upscaling a thumbnail just stores a blurrier, bigger copy.
    function scaledSize(width, height, maxEdge) {
        const max = maxEdge || MAX_EDGE_PX;
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

    // Each upload gets its own path rather than overwriting a fixed one. A fixed
    // path would serve the OLD photo from cache after a replacement — the new
    // bytes are at a URL the browser already has an answer for — and the whole
    // point of replacing a photo is seeing the new one.
    function photoStoragePath(personId, fileId) {
        return `${STORAGE_ROOT}/${personId}/${fileId}`;
    }

    function buildPhotoUpdate(url, path) {
        return { photoUrl: url || null, photoPath: path || null };
    }

    function buildPhotoClear() {
        return { photoUrl: null, photoPath: null };
    }

    async function savePersonCrop(db, personId, crop) {
        const update = buildCropUpdate(crop);
        update.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('people').doc(personId).update(update);
        return update.photoCrop;
    }

    // May this user set or clear this Person's photo? Your own if you are linked
    // to it; anyone's if you are an editor or above. Mirrors the Firestore rule.
    function canManagePhoto(permissionLevel, myPersonId, personId) {
        if (!personId) return false;
        if (['editor', 'elder', 'admin', 'super_admin'].indexOf(permissionLevel) !== -1) {
            return true;
        }
        return !!myPersonId && myPersonId === personId;
    }

    // ── Framing ──────────────────────────────────────────────────────────────
    //
    // A photo is almost never a headshot. It is a group shot, or a wide picture
    // with the person off to one side, and a circular 56px frame shows whatever
    // happens to be in the middle. So the Person carries a CROP alongside the
    // image: where to look, and how close.
    //
    // The crop is stored rather than baked into the file, so reframing later is
    // editing two numbers instead of finding and re-uploading the original —
    // which most people no longer have.
    //
    // `x`/`y` are percentages, the same ones CSS `object-position` takes: 0% is
    // the left/top edge of the source, 100% the right/bottom. `zoom` is a plain
    // multiplier on top of an object-fit: cover baseline.

    const DEFAULT_CROP = { x: 50, y: 50, zoom: 1 };
    const MIN_ZOOM = 1;   // below 1 the image would no longer fill the circle
    const MAX_ZOOM = 4;

    function clamp(value, low, high) {
        const n = Number(value);
        if (!isFinite(n)) return low;
        return Math.min(high, Math.max(low, n));
    }

    // Always yields a usable crop, whatever it is handed — a Person saved before
    // framing existed has no crop at all, and must still render.
    function normalizeCrop(crop) {
        const c = crop || {};
        return {
            x: Math.round(clamp(c.x === undefined ? DEFAULT_CROP.x : c.x, 0, 100)),
            y: Math.round(clamp(c.y === undefined ? DEFAULT_CROP.y : c.y, 0, 100)),
            zoom: Math.round(clamp(c.zoom === undefined ? DEFAULT_CROP.zoom : c.zoom,
                MIN_ZOOM, MAX_ZOOM) * 100) / 100,
        };
    }

    // The ONE place a crop becomes CSS. The reframing preview, the profile page
    // and every directory card call this, which is what makes the preview
    // honest: what you drag to is literally the style everyone else gets.
    function frameStyle(crop) {
        const c = normalizeCrop(crop);
        return `object-fit: cover; object-position: ${c.x}% ${c.y}%; ` +
            `transform: scale(${c.zoom}); transform-origin: ${c.x}% ${c.y}%;`;
    }

    function buildCropUpdate(crop) {
        return { photoCrop: normalizeCrop(crop) };
    }

    // Dragging across the frame pans the image the other way — you are moving
    // the picture under a fixed window, so pulling it right reveals what was off
    // to the left. Movement is expressed as a fraction of the frame so a drag
    // feels the same on a 56px card and a 96px profile preview, and it is
    // divided by the zoom because a zoomed-in image should not fly past.
    function panCrop(crop, dx, dy, frameSize) {
        const c = normalizeCrop(crop);
        const size = Math.max(1, frameSize || 1);
        return normalizeCrop({
            x: c.x - (dx / size) * 100 / c.zoom,
            y: c.y - (dy / size) * 100 / c.zoom,
            zoom: c.zoom,
        });
    }

    // ── Browser half ─────────────────────────────────────────────────────────

    // Draw the file through a canvas at the capped size and hand back a JPEG
    // blob. This is also what normalises a PNG screenshot or a 12-megapixel
    // phone photo into the same small thing.
    function resizeToBlob(file, maxEdge) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const size = scaledSize(img.naturalWidth, img.naturalHeight, maxEdge);
                const canvas = document.createElement('canvas');
                canvas.width = size.width;
                canvas.height = size.height;
                canvas.getContext('2d').drawImage(img, 0, 0, size.width, size.height);
                canvas.toBlob(
                    blob => blob ? resolve(blob) : reject(new Error('Could not read that image.')),
                    'image/jpeg', JPEG_QUALITY);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Could not read that image.'));
            };
            img.src = url;
        });
    }

    // Resize, upload, and point the Person at it.
    //
    // Nothing here deletes the photo it replaces. The blob it orphans is cleaned
    // up by a Firestore trigger watching photoPath (see cleanUpReplacedPhoto in
    // functions/index.js), for two reasons: a browser closed mid-flow would
    // otherwise leak the old file forever, and letting clients delete from
    // Storage means letting ANY signed-in account delete ANY photo — Storage
    // rules cannot read Firestore, so they cannot tell whose photo it is.
    async function uploadPersonPhoto(db, personId, file) {
        const check = validatePhotoFile(file);
        if (!check.ok) throw new Error(check.error);

        const blob = await resizeToBlob(file, MAX_EDGE_PX);
        const fileId = db.collection('people').doc().id;
        const path = photoStoragePath(personId, fileId);

        const ref = firebase.storage().ref().child(path);
        const snap = await ref.put(blob, { contentType: 'image/jpeg' });
        const url = await snap.ref.getDownloadURL();

        // A new photo starts centred. Carrying the old crop over would frame the
        // new picture by where the previous one happened to need looking at.
        const update = buildPhotoUpdate(url, path);
        update.photoCrop = Object.assign({}, DEFAULT_CROP);
        update.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('people').doc(personId).update(update);
        return { url, path, crop: update.photoCrop };
    }

    async function clearPersonPhoto(db, personId) {
        const update = buildPhotoClear();
        update.photoCrop = null;
        update.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('people').doc(personId).update(update);
    }

    const PersonPhotoCore = {
        ACCEPTED_TYPES,
        MAX_UPLOAD_BYTES,
        MAX_EDGE_PX,
        JPEG_QUALITY,
        STORAGE_ROOT,
        PHOTO_FIELDS,
        validatePhotoFile,
        scaledSize,
        photoStoragePath,
        buildPhotoUpdate,
        buildPhotoClear,
        canManagePhoto,
        DEFAULT_CROP,
        MIN_ZOOM,
        MAX_ZOOM,
        normalizeCrop,
        frameStyle,
        buildCropUpdate,
        panCrop,
        // browser-only
        resizeToBlob,
        uploadPersonPhoto,
        clearPersonPhoto,
        savePersonCrop,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PersonPhotoCore;
    }
    if (global) {
        global.PersonPhotoCore = PersonPhotoCore;
    }
})(typeof window !== 'undefined' ? window : null);
