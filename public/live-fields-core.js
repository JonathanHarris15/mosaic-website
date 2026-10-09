/* ============================================================
   live-fields-core.js — a form that saves itself (ADR 0081, MS-720).

   The pure half of "a page you can change is live": which fields are
   changed, when they save, what the chip says, and what to do with a
   value that arrives from somebody else. No DOM, no Firestore — the page
   hands in `save(patch)` and pipes its listener into `remote(values)`.

     const live = LiveFields.create({
         fields: ['name', 'location'],
         initial: { name: 'Supper', location: 'Hall' },
         save: async (patch) => storedValues,   // only the changed fields
         validate: (draft) => ({ endDate: 'Ends before it starts' }) | null,
         onChange: (state) => { ... },          // redraw
     });
     live.edit('name', 'Harvest Supper');        // typing
     live.flush();                               // blur / Enter
     live.revert('name');                        // Escape
     live.remote(snapshotData, { pendingWrites }); // the listener

   THE CHIP. 'saved' (nothing waiting), 'unsaved' (a change is waiting for
   the debounce, or is invalid), 'saving', 'failed' ("Not saved" + Retry).
   A failed save keeps the change; the next edit tries again on its own
   (team lead decision, Oct 8) and Retry tries again now.

   REMOTE ADOPTION (remoteAdoptions, from the Order of Service). A field
   this editor has not touched takes the incoming value. A field this
   editor has changed is left alone until it saves. Our own write echoing
   back (`pendingWrites`) is ignored.
   ============================================================ */
(function (global) {
    'use strict';

    const DEBOUNCE_MS = 1500;

    function text(v) { return String(v == null ? '' : v).trim(); }
    function sameText(a, b) { return text(a) === text(b); }

    function create(opts) {
        const o = opts || {};
        const fields = (o.fields || []).slice();
        const same = o.same || sameText;
        const debounceMs = o.debounceMs == null ? DEBOUNCE_MS : o.debounceMs;
        const setT = o.setTimeout || ((fn, ms) => setTimeout(fn, ms));
        const clearT = o.clearTimeout || ((id) => clearTimeout(id));
        const save = o.save;
        const validate = o.validate || (() => null);
        const onChange = o.onChange || (() => {});

        const base = {};
        const draft = {};
        fields.forEach((f) => {
            const v = o.initial && o.initial[f] != null ? o.initial[f] : '';
            base[f] = v;
            draft[f] = v;
        });

        const state = {
            status: 'saved',
            error: '',
            invalid: {},
        };
        let timer = null;
        let inFlight = null;
        let disposed = false;

        function dirtyFields() {
            return fields.filter((f) => !same(draft[f], base[f]));
        }

        function snapshot() {
            return {
                draft: Object.assign({}, draft),
                status: state.status,
                error: state.error,
                invalid: Object.assign({}, state.invalid),
                dirty: dirtyFields(),
            };
        }

        function emit() { if (!disposed) onChange(snapshot()); }

        function recheck() {
            state.invalid = validate(Object.assign({}, draft)) || {};
        }

        function settle() {
            // What the chip says when nothing is in flight.
            if (state.status === 'failed' && dirtyFields().length) return;
            state.status = dirtyFields().length ? 'unsaved' : 'saved';
            if (!dirtyFields().length) state.error = '';
        }

        function cancelTimer() {
            if (timer != null) { clearT(timer); timer = null; }
        }

        function schedule() {
            cancelTimer();
            if (disposed) return;
            timer = setT(() => { timer = null; flush(); }, debounceMs);
        }

        async function flush() {
            cancelTimer();
            if (disposed) return false;
            if (inFlight) {
                // A save is already out. Whatever changed meanwhile goes
                // when it lands — see the end of the run below.
                return inFlight;
            }
            const dirty = dirtyFields();
            if (!dirty.length) { settle(); emit(); return true; }
            recheck();
            if (Object.keys(state.invalid).length) {
                // A value that fails its own check does not save; the field
                // says why and the chip stays Unsaved.
                state.status = 'unsaved';
                emit();
                return false;
            }
            const patch = {};
            dirty.forEach((f) => { patch[f] = draft[f]; });
            state.status = 'saving';
            state.error = '';
            emit();
            inFlight = (async () => {
                try {
                    const stored = (await save(patch)) || patch;
                    Object.keys(patch).forEach((f) => {
                        base[f] = f in stored ? (stored[f] == null ? '' : stored[f]) : patch[f];
                        // Typed nothing more while it saved: show what was
                        // stored (trimmed), so the box agrees with the record.
                        if (same(draft[f], patch[f])) draft[f] = base[f];
                    });
                    state.status = 'saved';
                    inFlight = null;
                    if (dirtyFields().length) {
                        state.status = 'unsaved';
                        schedule();
                    }
                    emit();
                    return true;
                } catch (e) {
                    inFlight = null;
                    state.status = 'failed';
                    state.error = (e && e.message) || 'Not saved.';
                    emit();
                    return false;
                }
            })();
            return inFlight;
        }

        function edit(field, value) {
            if (disposed || fields.indexOf(field) === -1) return;
            draft[field] = value == null ? '' : value;
            recheck();
            if (state.status !== 'saving') {
                if (dirtyFields().length) {
                    // From 'failed' too: the next edit is the retry.
                    state.status = 'unsaved';
                } else {
                    settle();
                }
            }
            if (dirtyFields().length) schedule(); else cancelTimer();
            emit();
        }

        function revert(field) {
            if (disposed || fields.indexOf(field) === -1) return;
            draft[field] = base[field];
            recheck();
            if (!dirtyFields().length) cancelTimer();
            if (state.status !== 'saving') {
                if (state.status === 'failed' && !dirtyFields().length) state.status = 'saved';
                settle();
            }
            emit();
        }

        function remote(values, meta) {
            if (disposed || !values) return;
            if (meta && meta.pendingWrites) return;
            fields.forEach((f) => {
                if (!(f in values)) return;
                const incoming = values[f] == null ? '' : values[f];
                const touched = !same(draft[f], base[f]);
                base[f] = incoming;
                if (!touched) draft[f] = incoming;
            });
            recheck();
            if (state.status !== 'saving') settle();
            emit();
        }

        function dispose() {
            cancelTimer();
            disposed = true;
        }

        return {
            edit, flush, retry: flush, revert, remote, dispose,
            dirtyFields,
            get state() { return snapshot(); },
        };
    }

    const CHIP_TEXT = {
        saved: 'Saved',
        unsaved: 'Unsaved changes',
        saving: 'Saving…',
        failed: 'Not saved',
    };

    function chipText(status) { return CHIP_TEXT[status] || ''; }

    const LiveFields = { DEBOUNCE_MS, create, chipText, CHIP_TEXT };

    if (typeof module !== 'undefined' && module.exports) module.exports = LiveFields;
    if (global) global.LiveFields = LiveFields;
})(typeof window !== 'undefined' ? window : null);
