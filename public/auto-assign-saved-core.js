// Auto-assign Saved Core — keeping a draft between visits (MS-184).
//
// Ten Sundays is roughly 150 placements, and reworking that is real work. It
// has to survive a reload, a closed tab, and a laptop going to sleep.
//
// ── Why the browser and not the server ───────────────────────────────────────
//
// A draft document would need a collection, security rules, an owner, a cleanup
// story and an answer to "two editors drafted the same range" — real machinery
// for a church where one person does the rota. The cost is that a draft started
// at the office desktop is not on the laptop at home, and the recovery is to
// draft it again, which takes seconds.
//
// ⚠ A DRAFT IS NEVER AN ASSIGNMENT. The assignment state machine has three
// states and gains no fourth (ADR-0018). A proposal stays outside the model
// until it is accepted, which is exactly why it can live in localStorage at all.
//
// ── Why a restored draft is re-checked ───────────────────────────────────────
//
// People leave, Roles change, dates get cancelled. A draft restored blindly
// shows a picture of a church that has moved on — and it looks completely
// normal, which is what makes it dangerous. So a stored draft states what it
// was drawn against, and anything that no longer matches means offering a fresh
// draft rather than the old one.
//
// Loaded as a classic <script> (window.AutoAssignSavedCore) and exported for Node.

(function (global) {
    'use strict';

    const VERSION = 1;
    const PREFIX = 'mosaic.autoAssign.';

    // Per Event AND range, so drafting September then October does not overwrite
    // September on the way past.
    function keyFor(seriesId, dates) {
        const list = dates || [];
        const from = list[0] || '';
        const to = list[list.length - 1] || '';
        return PREFIX + String(seriesId) + '.' + from + '.' + to;
    }

    // What the draft was drawn against, so the re-check has something to compare
    // to. Sorted, because a set that came back in a different order is not a
    // change and must not read as one.
    function fingerprint(context) {
        const c = context || {};
        return {
            dates: (c.dates || []).slice().sort(),
            roleSlugs: (c.roles || []).map(r => r.slug).sort(),
            // Place counts, because a Role that gained a third place has a draft
            // with a hole in it that nothing else would notice.
            places: (c.roles || []).slice()
                .sort((a, b) => String(a.slug).localeCompare(String(b.slug)))
                .map(r => (Array.isArray(r.slots) ? r.slots.length : 0)),
            people: (c.people || []).map(p => p.id).slice().sort(),
        };
    }

    function pack(draft, context) {
        return {
            version: VERSION,
            savedAt: (context || {}).savedAt || null,
            seriesId: (context || {}).seriesId || null,
            choice: (context || {}).choice || null,
            displaced: (context || {}).displaced || [],
            // What the editor knows and the church has not recorded. Kept with
            // the draft, because that is the only thing it is true of.
            nudges: (context || {}).nudges || {},
            // `out`, renamed from `away` in MS-188 so it stops colliding with
            // the Person's own Away. A draft saved before that rename is still
            // in somebody's browser, so the old key is read as a fallback —
            // losing an editor's out-list to tidy a name would be a poor trade.
            out: (context || {}).out || (context || {}).away || {},
            // Whether the grid started blank (MS-219). Wording only, but a draft
            // picked back up under the wrong heading has the editor looking for
            // an assignment nothing ever made.
            byHand: (context || {}).byHand === true,
            against: fingerprint(context),
            draft: draft,
        };
    }

    const same = (a, b) => (
        (a || []).length === (b || []).length
        && (a || []).every((v, i) => v === b[i])
    );

    // Why a stored draft cannot be shown, in the editor's words. Empty means it
    // is safe to restore.
    //
    // People are deliberately NOT a hard stop on their own count — somebody
    // joining the church does not invalidate a rota. Somebody LEAVING does, if
    // they are in it, and that is checked against the draft rather than the
    // directory.
    function staleReasons(stored, context) {
        const s = stored || {};
        if (!s.draft || s.version !== VERSION) return ['It was saved by an older version of this page.'];

        const now = fingerprint(context);
        const was = s.against || {};
        const out = [];

        if (!same(was.dates, now.dates)) out.push('The dates in the range have changed.');
        if (!same(was.roleSlugs, now.roleSlugs)) out.push('The roles this event carries have changed.');
        else if (!same(was.places, now.places)) out.push('A role has gained or lost a place.');

        const here = {};
        (context && context.people ? context.people : []).forEach(p => {
            if (p && p.id) here[p.id] = true;
        });
        const gone = [];
        ((s.draft || {}).dates || []).forEach(day => {
            (day.seats || []).forEach(seat => {
                if (seat && seat.personId && !here[seat.personId] && gone.indexOf(seat.personId) === -1) {
                    gone.push(seat.personId);
                }
            });
        });
        if (gone.length) {
            out.push(gone.length === 1
                ? 'Somebody in it can no longer be given a role.'
                : gone.length + ' people in it can no longer be given a role.');
        }

        return out;
    }

    // ── The browser side ─────────────────────────────────────────────────────
    //
    // Every call is wrapped: localStorage throws in private browsing and when
    // the quota is full, and a rota screen must not die because a browser
    // refused to remember something.

    function save(storage, key, payload) {
        if (!storage) return false;
        try {
            storage.setItem(key, JSON.stringify(payload));
            return true;
        } catch (e) {
            return false;
        }
    }

    function read(storage, key) {
        if (!storage) return null;
        try {
            const raw = storage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function forget(storage, key) {
        if (!storage) return;
        try { storage.removeItem(key); } catch (e) { /* nothing to do */ }
    }

    const AutoAssignSavedCore = {
        VERSION,
        PREFIX,
        keyFor,
        fingerprint,
        pack,
        staleReasons,
        save,
        read,
        forget,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AutoAssignSavedCore;
    }
    if (global) {
        global.AutoAssignSavedCore = AutoAssignSavedCore;
    }
})(typeof window !== 'undefined' ? window : null);
