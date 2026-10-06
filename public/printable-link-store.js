// Printable link images — the picture a date types onto a linked Printable.
//
// A country map and a team logo are decoration on a page, the same door as
// a brand asset: an editor uploads an image, and the https URL is what the
// Printable binds. Event attachments are a different door and never come
// through here. This file is the one that asks Storage for that URL.

(function (global) {
    'use strict';

    function typedCore() {
        return global.SundayTypedCore || null;
    }

    function intakeLib() {
        return global.ImageIntake || null;
    }

    async function uploadImage(file, path) {
        if (!file) return { url: '', error: 'Choose an image.' };
        if (!file.type || String(file.type).indexOf('image/') !== 0) {
            return { url: '', error: 'Choose an image.' };
        }
        if (file.size > 8 * 1024 * 1024) {
            return { url: '', error: 'That image is too large to upload (max 8 MB).' };
        }
        if (!path || typeof firebase === 'undefined' || !firebase.storage) {
            return { url: '', error: 'Image upload is not available.' };
        }
        let upload = file;
        const Typed = typedCore();
        const intake = intakeLib();
        if (Typed && Typed.fileNeedsPrepare && Typed.fileNeedsPrepare(file) && intake) {
            try {
                upload = await intake.prepare(file, { maxBytes: (Typed.MAX_UPLOAD_BYTES || 8000000) - 1 });
            } catch (e) {
                return { url: '', error: (e && e.message) || 'Could not read that image.' };
            }
        }
        try {
            const ref = firebase.storage().ref(path);
            await ref.put(upload, { contentType: upload.type || 'image/jpeg' });
            const url = await ref.getDownloadURL();
            return { url: url, error: '' };
        } catch (e) {
            console.error(e);
            return { url: '', error: 'That image did not upload.' };
        }
    }

    const PrintableLinkStore = { uploadImage };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableLinkStore;
    }
    if (global) {
        global.PrintableLinkStore = PrintableLinkStore;
    }
})(typeof window !== 'undefined' ? window : globalThis);
