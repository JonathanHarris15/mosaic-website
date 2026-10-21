// Printable link images — the picture a date types onto a linked Printable.
//
// A country map and a team logo are decoration on a page, the same door as
// a brand asset: an editor uploads an image, and the https URL is what the
// Printable binds. Event attachments are a different door and never come
// through here. This file is the one that asks Storage for that URL.

(function (global) {
    'use strict';

    const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

    function typedCore() {
        return global.SundayTypedCore || null;
    }

    function intakeLib() {
        return global.ImageIntake || null;
    }

    // Same acceptance as printable-editor.js: HEIC, extension-only types, and
    // application/octet-stream camera files are photos; a strict image/* MIME
    // gate alone rejects them before ImageIntake can convert or compress.
    function fileAcceptError(file) {
        if (!file) return 'Choose an image.';
        const intake = intakeLib();
        if (intake && intake.isCompressiblePhoto(file)) return '';
        if (file.type && /^image\//.test(file.type)) return '';
        return 'Choose an image.';
    }

    function uploadCapBytes() {
        const Typed = typedCore();
        const cap = (Typed && Typed.MAX_UPLOAD_BYTES) || MAX_UPLOAD_BYTES;
        return cap - 1;
    }

    async function uploadImage(file, path) {
        const acceptErr = fileAcceptError(file);
        if (acceptErr) return { url: '', error: acceptErr };
        if (!path || typeof firebase === 'undefined' || !firebase.storage) {
            return { url: '', error: 'Image upload is not available.' };
        }
        const maxBytes = uploadCapBytes();
        let upload = file;
        const intake = intakeLib();
        if (intake && intake.needsWork(file, maxBytes)) {
            try {
                upload = await intake.prepare(file, { maxBytes: maxBytes });
            } catch (e) {
                return { url: '', error: (e && e.message) || 'Could not read that image.' };
            }
        } else if (file.size > maxBytes) {
            return { url: '', error: 'That image is too large to upload (max 8 MB).' };
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

    const PrintableLinkStore = { uploadImage, fileAcceptError, uploadCapBytes };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableLinkStore;
    }
    if (global) {
        global.PrintableLinkStore = PrintableLinkStore;
    }
})(typeof window !== 'undefined' ? window : globalThis);
