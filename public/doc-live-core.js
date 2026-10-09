/* ============================================================
   doc-live-core.js — whole-document pages stay live (ADR 0081, MS-721).

   Some pages save ONE document as a whole (a Service Guide week, a
   printable, a form, a shepherding document). Per-field merging does not
   fit them, so the team-lead call (Oct 8, 9:44 PM) is:

     - A change made elsewhere is taken ONLY while this copy has nothing
       unsaved (nothing typed since the last save, nothing saving, nothing
       that failed).
     - Otherwise it is held, and the page says quietly "Changed elsewhere —
       reload to see it" with Reload. The local edit stays until the person
       chooses; Reload swaps theirs for the newer copy.
     - Our own write echoing back is ignored (pendingWrites, or the same
       fingerprint we just wrote).

   No DOM, no Firestore. The page keeps its own debounce and save(); it
   tells this core when it edits and how a save went, and pipes its
   listener into remote().

     const live = DocLive.create({
         fingerprint: (data) => JSON.stringify(data.guide || null),
         onAdopt: (data) => { ...apply to the page... },
         onChange: (state) => { saveStatus = state.status; changedElsewhere = state.changedElsewhere; },
     });
     live.loaded(data);             // the first read
     live.edited();                 // every local change
     const t = live.saving();       // a save starts
     live.saved(t, writtenData);    // …and landed
     live.failed(t, err);           // …or did not ("Not saved" + Retry)
     live.remote(data, { pendingWrites });
     live.reload();                 // the Reload button
   ============================================================ */
(function (global) {
    'use strict';

    function create(opts) {
        const o = opts || {};
        const fingerprint = o.fingerprint || ((d) => JSON.stringify(d == null ? null : d));
        const onAdopt = o.onAdopt || (() => {});
        const onChange = o.onChange || (() => {});

        let base = null;         // fingerprint of what this copy last agreed with the server
        let editGen = 0;         // bumped on every local edit
        let savedGen = 0;        // the edit generation the last good save covered
        let inFlight = 0;
        let failed = false;
        let pending = null;      // a remote copy held back while we had unsaved work
        let error = '';

        function status() {
            if (failed) return 'failed';
            if (inFlight) return 'saving';
            if (editGen !== savedGen) return 'unsaved';
            return 'saved';
        }
        function isClean() { return status() === 'saved'; }
        function state() {
            return { status: status(), changedElsewhere: pending != null, error };
        }
        function emit() { onChange(state()); }

        function fp(data) {
            try { return fingerprint(data); } catch (e) { return null; }
        }

        return {
            loaded(data) {
                base = fp(data);
                editGen = savedGen = 0;
                failed = false; pending = null; error = '';
                emit();
            },
            edited() {
                editGen++;
                emit();
            },
            saving() {
                inFlight++;
                emit();
                return editGen;
            },
            saved(ticket, written) {
                inFlight = Math.max(0, inFlight - 1);
                failed = false; error = '';
                if (typeof ticket === 'number' && ticket > savedGen) savedGen = ticket;
                if (written !== undefined) base = fp(written);
                emit();
            },
            failed(ticket, err) {
                inFlight = Math.max(0, inFlight - 1);
                failed = true;
                error = (err && err.message) || String(err || '');
                emit();
            },
            // Returns 'ignored' | 'adopted' | 'held'.
            remote(data, meta) {
                if (meta && meta.pendingWrites) return 'ignored';
                const f = fp(data);
                if (f != null && f === base) return 'ignored';
                if (isClean()) {
                    base = f;
                    pending = null;
                    onAdopt(data);
                    emit();
                    return 'adopted';
                }
                pending = { data, f };
                emit();
                return 'held';
            },
            // The person chose the newer copy: theirs replaces ours.
            reload() {
                if (!pending) return false;
                const p = pending;
                pending = null;
                base = p.f;
                savedGen = editGen;
                failed = false; error = '';
                onAdopt(p.data);
                emit();
                return true;
            },
            dismiss() { pending = null; emit(); },
            get state() { return state(); },
            isClean,
        };
    }

    // The chip's words, shared with LiveFields so every page says the same.
    const CHIP_TEXT = { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', failed: 'Not saved' };
    function chipText(status) { return CHIP_TEXT[status] || ''; }

    const DocLive = { create, chipText, CHIP_TEXT, CHANGED_ELSEWHERE: 'Changed elsewhere — reload to see it' };
    if (typeof module !== 'undefined' && module.exports) module.exports = DocLive;
    if (global) global.DocLive = DocLive;
})(typeof window !== 'undefined' ? window : globalThis);
