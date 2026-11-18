// Place Core — what ONE place on an Event is, and what follows from it.
//
// A place is one seat a person stands in: an occurrence, a Role, and either a
// slot (a managed Role) or a one-off job's own id. Every door that touches a
// place — answering it, taking it, trading it, advertising it for cover,
// nudging its holder, converting it into a serve — has to agree about which
// row it means. They used to each say it their own way, and they disagreed:
//
//   • every one-off on an Event is `one_off` with no slot, so a key built from
//     slug and slot alone named ALL of them at once. Taking one landed on
//     whichever came first; two declined one-offs shared one cover entry, and
//     re-confirming either took the advertisement down for both.
//   • the cover list was written by five doors and deleted by a sixth, and none
//     of them ran when a date was cancelled, moved, or made more private — so
//     it advertised places that were not happening, dropped ones that had only
//     moved, and kept showing a tightened Event's name to the wider church.
//
// So the identity is said here once, and so is the cover list: `desiredCover`
// is what the list SHOULD hold for an occurrence, computed from the occurrence
// and its roster, and `coverChanges` is the difference from what it does hold.
// The list is a derived view; anything that changes its inputs reconciles it.
//
// Pure. No Firestore, no DOM. Loaded as a classic <script>
// (window.PlaceCore), required by Node tests, and synced into
// functions/shared by scripts/sync-shared-to-functions.js.

(function (global) {
    'use strict';

    /** @type {*} */
    const g = global || {};
    const Occ = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
        ? require('./events-occurrence-core.js')
        : g.EventsOccurrenceCore;

    const STATES = Occ.STATES;
    const ONE_OFF_SLUG = Occ.ONE_OFF_SLUG;

    /**
     * @typedef {{ occurrenceId: ?string, roleSlug: ?string, slotId: ?string, oneOffId: ?string }} Place
     */

    // ── Identity ─────────────────────────────────────────────────────────────

    /** @param {*} v @returns {?string} */
    const str = v => (typeof v === 'string' && v ? v : null);

    // The place a request, a roster row, a cover entry or a Trade's reference
    // names, in one shape. A one-off job's id only means something on a
    // one-off; on a managed Role it is ignored rather than trusted.
    /**
     * @param {*} ref
     * @returns {Place}
     */
    function placeOf(ref) {
        const r = ref || {};
        const roleSlug = str(r.roleSlug);
        return {
            occurrenceId: str(r.occurrenceId),
            roleSlug,
            slotId: str(r.slotId),
            oneOffId: roleSlug === ONE_OFF_SLUG ? str(r.oneOffId) : null,
        };
    }

    // Does this row stand in the place `ref` names? Within one occurrence's
    // roster, so the occurrence is not compared.
    //
    // ⚠ A ONE-OFF IS TOLD APART BY ITS OWN ID. A caller that does not send one
    // (a page older than MS-818) still matches by slug and slot, which is all
    // it ever could do — but one that DOES send one is held to it.
    /** @param {*} row @param {*} ref */
    function samePlace(row, ref) {
        if (!row) return false;
        const a = placeOf(row);
        const b = placeOf(ref);
        if (a.roleSlug !== b.roleSlug || a.slotId !== b.slotId) return false;
        return !b.oneOffId || a.oneOffId === b.oneOffId;
    }

    // One string per place, for maps and comparisons — never a stored id.
    /** @param {*} ref */
    function placeKey(ref) {
        const p = placeOf(ref);
        return [p.occurrenceId, p.roleSlug, p.oneOffId || p.slotId || 'x'].join('__');
    }

    // The roster document id, as events-store.js files a row. The person is
    // part of it, so a place changing hands is a delete plus a create.
    /** @param {*} assignment */
    function rosterIdFor(assignment) {
        const a = assignment || {};
        return [a.roleSlug, a.oneOffId || a.slotId || 'x', a.personId].join('__');
    }

    // The cover document id. Deterministic, so declining, re-confirming and
    // declining again cannot leave two rows asking for one place.
    //
    // ⚠ A one-off with its own id gets its own entry. One without (written
    // before MS-818) keeps the id it always had, so the reconcile below finds
    // and replaces it rather than leaving it behind.
    /** @param {?string} occurrenceId @param {*} ref */
    function coverIdFor(occurrenceId, ref) {
        const p = placeOf(ref);
        if (p.roleSlug === ONE_OFF_SLUG && p.oneOffId) {
            return [occurrenceId, ONE_OFF_SLUG, p.oneOffId].join('__');
        }
        return [occurrenceId, p.roleSlug, p.slotId || 'one_off'].join('__');
    }

    // ── The cover list ───────────────────────────────────────────────────────

    // Is this place out looking for somebody? Declined, not quiet, on an Event
    // whose rung can reach anybody, on a date that is happening. Each of those
    // is absolute on its own: the rung is the church's, quiet is the person's,
    // and a cancelled or moved date has nobody to cover for.
    /** @param {*} occurrence @param {*} row */
    function isListed(occurrence, row) {
        return !!row && (row.state || STATES.PENDING) === STATES.DECLINED &&
            row.quiet !== true &&
            Occ.canBeCovered(occurrence) &&
            !Occ.notHappening(occurrence);
    }

    // What one open place looks like on the list. Denormalised on purpose: a
    // row must render without opening the occurrence, because the reader may
    // not be allowed to. It does NOT name who declined. `visibility` is
    // stamped from the occurrence so the rule can answer by rank — which is
    // exactly why it has to be re-stamped whenever the occurrence's changes.
    /** @param {*} occurrence @param {*} assignment @param {?string} [roleName] */
    function coverEntryFor(occurrence, assignment, roleName) {
        const o = occurrence || {};
        const p = placeOf(Object.assign({}, assignment, { occurrenceId: o.id }));
        return {
            occurrenceId: o.id || null,
            seriesId: o.seriesId || null,
            date: o.date || null,
            eventName: o.name || o.seriesName || 'Event',
            roleSlug: p.roleSlug,
            slotId: p.slotId,
            oneOffId: p.oneOffId,
            roleName: roleName || (assignment && assignment.label) || null,
            visibility: Occ.visibilityOf(o) || null,
        };
    }

    // What the cover list should hold for one occurrence, by document id.
    // `roleNameOf(slug)` names a managed Role; a one-off names itself.
    /**
     * @param {*} occurrence
     * @param {Array<*>} roster
     * @param {(slug: string) => ?string} [roleNameOf]
     * @returns {Record<string, Record<string, *>>}
     */
    function desiredCover(occurrence, roster, roleNameOf) {
        const o = occurrence || {};
        /** @type {Record<string, Record<string, *>>} */
        const out = {};
        if (!o.id) return out;
        (roster || []).forEach(row => {
            if (!isListed(o, row)) return;
            const name = row.roleSlug === ONE_OFF_SLUG ? null : (roleNameOf ? roleNameOf(row.roleSlug) : null);
            out[coverIdFor(o.id, row)] = coverEntryFor(o, row, name);
        });
        return out;
    }

    /** @param {*} a @param {*} b */
    const sameEntry = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
    /** @param {*} v @returns {*} */
    function sortKeys(v) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
        /** @type {Record<string, *>} */
        const out = {};
        Object.keys(v).sort().forEach(k => { if (v[k] !== undefined) out[k] = sortKeys(v[k]); });
        return out;
    }

    // The writes that turn `existing` (the occurrence's cover documents as
    // stored) into `desired`. Only what differs, so a reconcile that finds the
    // list already right writes nothing — and a trigger that fires on its own
    // echo stops there.
    /**
     * @param {Array<{ id: string, data: Record<string, *> }>} existing
     * @param {Record<string, Record<string, *>>} desired
     * @returns {{ set: Array<{ id: string, entry: Record<string, *> }>, remove: string[] }}
     */
    function coverChanges(existing, desired) {
        /** @type {Record<string, Record<string, *>>} */
        const have = {};
        (existing || []).forEach(d => { have[d.id] = d.data; });
        const set = Object.keys(desired || {})
            .filter(id => !have[id] || !sameEntry(have[id], desired[id]))
            .map(id => ({ id, entry: desired[id] }));
        const remove = Object.keys(have).filter(id => !(desired && desired[id]));
        return { set, remove };
    }

    // ── What the occurrence says about its roster ────────────────────────────

    // Computed from the roster AS IT WILL BE, never patched from what it was.
    // These are the fields the security rules read, so drift is not cosmetic.
    /** @param {*} occurrence @param {Array<*>} roster */
    function derivedFields(occurrence, roster) {
        const withRoster = Object.assign({}, occurrence, { assignments: roster || [] });
        return {
            participantIds: Occ.participantIds(roster || []),
            needsAttention: Occ.needsAttention(withRoster),
            outForCover: Occ.outForCover(withRoster),
        };
    }

    const PlaceCore = {
        STATES,
        ONE_OFF_SLUG,
        placeOf,
        samePlace,
        placeKey,
        rosterIdFor,
        coverIdFor,
        isListed,
        coverEntryFor,
        desiredCover,
        coverChanges,
        derivedFields,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = PlaceCore;
    if (global) global.PlaceCore = PlaceCore;
})(typeof window !== 'undefined' ? window : null);
