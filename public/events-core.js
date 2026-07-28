// Events Core — the pure model for Event series (ADR-0016 §4, MS-13).
//
// An Event is a dated occurrence that carries Roles to be filled. An Event
// SERIES is the recurring thing itself — "the Sunday Service", "the Midweek
// Gathering" — and it owns the list of Roles its occurrences carry.
//
// The Sunday Service is one LOCKED series: always present, undeletable, and its
// liturgical Roles cannot be taken off it.
//
// ── Scope (MS-13) ────────────────────────────────────────────────────────────
// This module is the SERIES layer only. Individual Sundays are NOT migrated:
// an occurrence of the Sunday Service resolves to the date-keyed `services`
// document that already exists, so the Service Guide keeps reading exactly what
// it reads today. A general per-occurrence Event store — needed once arbitrary
// Events exist — arrives with the Calendar (MS-99). `occurrenceRef` returns
// null for any other series rather than inventing a path it cannot honour.
//
// Fairness is scoped per series (ADR-0016 §5): an Involvement record carries the
// series it belonged to, so someone can be overdue for Sunday setup and fresh
// for a midweek Role at the same time.
//
// Deliberately self-contained — like every other *-core module here, it requires
// nothing. It does not know what "liturgical" MEANS; it knows only that a series
// may mark some of its Roles undeletable. The caller supplies which.
//
// Loaded as a classic <script> (window.EventsCore) and exported for Node tests.

(function (global) {
    'use strict';

    // The one series that always exists. Its id is stable and referenced by
    // Involvement records, so it must never be regenerated or renamed.
    const SUNDAY_SERVICE_ID = 'sunday_service';

    // The collection a Sunday Service occurrence already lives in.
    const SERVICES_COLLECTION = 'services';

    const rolesOf = series => (series && Array.isArray(series.roleSlugs) ? series.roleSlugs : []);
    const lockedRolesOf = series => (
        series && Array.isArray(series.lockedRoleSlugs) ? series.lockedRoleSlugs : []
    );

    // ── Building a series ─────────────────────────────────────────────────────

    function newSeries(spec) {
        const s = spec || {};
        return {
            id: s.id,
            name: s.name,
            locked: s.locked === true,
            roleSlugs: (s.roleSlugs || []).slice(),
            lockedRoleSlugs: (s.lockedRoleSlugs || []).slice(),
        };
    }

    // The Sunday Service, carrying the liturgical Roles the caller hands us and
    // marking every one of them undeletable.
    function sundayServiceSeries(liturgicalSlugs) {
        const slugs = (liturgicalSlugs || []).slice();
        return newSeries({
            id: SUNDAY_SERVICE_ID,
            name: 'Sunday Service',
            locked: true,
            roleSlugs: slugs,
            lockedRoleSlugs: slugs,
        });
    }

    // ── Roles on a series ─────────────────────────────────────────────────────

    // Mutators return a new series and never touch the input.
    function withRoles(series, roleSlugs) {
        return Object.assign({}, series, { roleSlugs: roleSlugs });
    }

    function addRole(series, roleSlug) {
        const slugs = rolesOf(series);
        if (slugs.indexOf(roleSlug) !== -1) return withRoles(series, slugs.slice());
        return withRoles(series, slugs.concat([roleSlug]));
    }

    // Locked protects the series' LOCKED Roles, not its whole roster — otherwise
    // adding Coffee to Sunday would be a one-way door.
    function removeRole(series, roleSlug) {
        if (lockedRolesOf(series).indexOf(roleSlug) !== -1) {
            throw new Error(
                'Role "' + roleSlug + '" cannot be removed from "' +
                ((series && series.name) || '?') + '": it is a locked Role of this Event.'
            );
        }
        return withRoles(series, rolesOf(series).filter(slug => slug !== roleSlug));
    }

    function assertSeriesDeletable(series) {
        if (series && series.locked) {
            throw new Error(
                'Event series "' + (series.name || '?') + '" is locked and cannot be deleted.'
            );
        }
    }

    // ── Resolving an occurrence ───────────────────────────────────────────────

    // Where the occurrence of `series` on `date` (YYYY-MM-DD) lives.
    //
    // For the Sunday Service that is the `services/{date}` document that already
    // exists — the date IS the id, so nothing is duplicated or shadowed. Any
    // other series returns null until MS-99 introduces per-occurrence storage.
    function occurrenceRef(series, date) {
        if (!date) return null;
        if (!series || series.id !== SUNDAY_SERVICE_ID) return null;
        return { collection: SERVICES_COLLECTION, id: date };
    }

    // ── Validation ────────────────────────────────────────────────────────────

    function validateSeries(series) {
        const errors = [];
        const s = series || {};

        if (!s.id || !String(s.id).trim()) errors.push('An Event series needs an id.');
        if (!s.name || !String(s.name).trim()) errors.push('An Event series needs a name.');

        const slugs = rolesOf(s);
        const seen = new Set();
        slugs.forEach(slug => {
            if (seen.has(slug)) {
                errors.push('The Role "' + slug + '" is listed twice on this Event.');
            }
            seen.add(slug);
        });

        lockedRolesOf(s).forEach(slug => {
            if (slugs.indexOf(slug) === -1) {
                errors.push('The Role "' + slug + '" is locked but not carried by this Event.');
            }
        });

        return { valid: errors.length === 0, errors: errors };
    }

    const EventsCore = {
        SUNDAY_SERVICE_ID,
        SERVICES_COLLECTION,
        // building
        newSeries,
        sundayServiceSeries,
        // roles on a series
        addRole,
        removeRole,
        assertSeriesDeletable,
        // occurrences
        occurrenceRef,
        // validation
        validateSeries,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = EventsCore;
    }
    if (global) {
        global.EventsCore = EventsCore;
    }
})(typeof window !== 'undefined' ? window : null);
