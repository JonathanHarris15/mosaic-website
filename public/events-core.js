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
        // The rules naming it, and its own settings here, go with it — see
        // withoutRulesNaming.
        return withoutRoleSettings(withoutRulesNaming(
            withRoles(series, rolesOf(series).filter(slug => slug !== roleSlug)),
            roleSlug
        ), roleSlug);
    }

    // ── A Role's settings on this Event ──────────────────────────────────────
    //
    // Who a Role needs (its slots), who may fill it (its restrictions), how much
    // rest it owes (intensity) and whether it uses up the morning
    // (allowsAnotherRole) belong to the EVENT that runs it: Setup needs two men
    // on a Sunday and one of anybody on a Wednesday. The Role itself keeps only
    // its name and what it involves.
    //
    // ⚠ RESOLVE THROUGH effectiveRole AND NOWHERE ELSE. Everything that seats,
    // checks or counts a Role takes a definition-shaped object; this is what
    // makes that object this Event's version of it.
    //
    // A field the Event has not set falls back to the Role Definition's old
    // value. That is the migration: on the day this ships every Event reads
    // exactly what it read before, and an Event takes over a Role the first
    // time an editor changes it there.
    const SETTING_FIELDS = ['slots', 'nextSlotSeq', 'restrictions', 'intensity', 'allowsAnotherRole'];

    /** @param {*} series */
    const roleSettingsMapOf = series => (
        series && series.roleSettings && typeof series.roleSettings === 'object'
            ? series.roleSettings : {}
    );

    /** @param {*} series @param {*} roleSlug */
    function roleSettingsOf(series, roleSlug) {
        const own = roleSettingsMapOf(series)[roleSlug];
        return own && typeof own === 'object' ? own : null;
    }

    /** @param {*} series @param {*} definition */
    function effectiveRole(series, definition) {
        if (!definition) return definition;
        const own = roleSettingsOf(series, definition.slug);
        if (!own) return definition;
        const out = Object.assign({}, definition);
        SETTING_FIELDS.forEach((/** @type {*} */ field) => {
            if (own[field] !== undefined) out[field] = own[field];
        });
        return out;
    }

    /** @param {*} series @param {*} definitions */
    function rolesFor(series, definitions) {
        return (definitions || []).map((/** @type {*} */ def) => effectiveRole(series, def));
    }

    /** @param {*} series @param {*} roleSlug @param {*} settings */
    function withRoleSettings(series, roleSlug, settings) {
        const map = Object.assign({}, roleSettingsMapOf(series));
        map[roleSlug] = settings;
        return Object.assign({}, series, { roleSettings: map });
    }

    /** @param {*} series @param {*} roleSlug */
    function withoutRoleSettings(series, roleSlug) {
        const map = Object.assign({}, roleSettingsMapOf(series));
        if (!(roleSlug in map)) return series;
        delete map[roleSlug];
        return Object.assign({}, series, { roleSettings: map });
    }

    // ── Cross-Role Rules on a series (MS-221) ────────────────────────────────
    //
    // "The Children's Ministry Leader and Helper must not be married to each
    // other" is a rule about a PAIR of Roles, so it belongs to neither of them.
    // It lives on the Event that runs both — which is also the only place that
    // knows they run together at all — and RolesCore judges it.
    //
    // Each is { kind, typeId, roleSlugs: [a, b] }; RolesCore.validateCrossRoleRule
    // says whether one is well-formed, and this module only arranges them.
    /** @param {*} series */
    const crossRoleRulesOf = series => (
        series && Array.isArray(series.crossRoleRules) ? series.crossRoleRules : []
    );

    /** @param {*} series @param {*} rules */
    function withCrossRoleRules(series, rules) {
        return Object.assign({}, series, { crossRoleRules: rules });
    }

    // ⚠ Dropping a Role from an Event drops the rules that named it. A rule
    // about a Role that is no longer here can never fire, and one left lying
    // about is worse than absent: put the Role back a year later and a rule
    // nobody remembers writing starts refusing people.
    /** @param {*} series @param {*} roleSlug */
    function withoutRulesNaming(series, roleSlug) {
        return withCrossRoleRules(series, crossRoleRulesOf(series).filter(
            rule => rolesNamedBy(rule).indexOf(roleSlug) === -1
        ));
    }

    // Every Role a rule across Roles names — a plain pair rule's two, or any
    // Role named by a condition in any option of an OR rule.
    /** @param {*} rule */
    function rolesNamedBy(rule) {
        const out = [];
        /** @param {*} slug */
        /** @param {*} slug */
        const add = slug => { if (slug && out.indexOf(slug) === -1) out.push(slug); };
        /** @param {*} cond */
        /** @param {*} cond */
        const visit = cond => {
            if (!cond) return;
            ((cond.roleSlugs) || []).forEach(add);
            add(cond.roleSlug);
        };
        visit(rule);
        ((rule && rule.options) || []).forEach((/** @type {*} */ option) => ((option && option.conditions) || []).forEach(visit));
        return out;
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

    // ── Seeding, as a reconcile ───────────────────────────────────────────────
    //
    // Seeding has to be safe to run twice, and safe to run against a church that
    // has already added Servant Roles to its Sunday. So it is not a write — it
    // is a reconcile: restore what MUST be true (the series exists, is locked,
    // carries every liturgical Role) without touching what the user owns (the
    // Servant Roles they added, the order they chose, the name they gave it).
    //
    // Returns { series, changed, reason }. `changed: false` is what makes a
    // second run a no-op.
    function reconcileSundayService(stored, liturgicalSlugs) {
        const slugs = (liturgicalSlugs || []).slice();

        if (!stored) {
            return {
                series: sundayServiceSeries(slugs),
                changed: true,
                reason: 'created the Sunday Service series',
            };
        }

        const reasons = [];

        // A Role locked here that is no longer liturgical was RETIRED from the
        // liturgy — `sermonette` (ADR 0033). Only reconcile ever writes
        // `lockedRoleSlugs`, and only with liturgical slugs, so a Servant Role
        // the user added can never be in this list. A retired one is not
        // merely unlocked but taken off the Sunday: it was only ever on it
        // because it was locked there, and leaving it behind as a removable
        // row would keep a Sunday "carrying" something it does not include.
        // One-time by construction: once unlocked it is never retired again,
        // so a Servant Role of the same name can be put back on by hand.
        const lockedNow = lockedRolesOf(stored);
        const retired = lockedNow.filter((/** @type {string} */ slug) => slugs.indexOf(slug) === -1);
        if (retired.length) {
            reasons.push('took retired liturgical Roles off the Sunday: ' + retired.join(', '));
        }

        // Liturgical Roles the stored series has lost. Restored at the FRONT, in
        // liturgical order, so the user's Servant Roles keep their own order
        // behind them.
        const existing = rolesOf(stored);
        const missing = slugs.filter(slug => existing.indexOf(slug) === -1);
        if (missing.length) {
            reasons.push('restored liturgical Roles: ' + missing.join(', '));
        }
        const servant = existing.filter((/** @type {string} */ slug) => (
            slugs.indexOf(slug) === -1 && retired.indexOf(slug) === -1
        ));
        const roleSlugs = slugs.concat(servant);

        if (stored.locked !== true) reasons.push('re-locked the series');

        const lockDrifted = slugs.some(slug => lockedNow.indexOf(slug) === -1);
        if (lockDrifted) reasons.push('re-marked the liturgical Roles undeletable');

        // A Cross-Role Rule naming a Role the Sunday no longer runs could never
        // fire — dropped with it, as setSeriesRoles does.
        const extra = {};
        if (retired.length && Array.isArray(stored.crossRoleRules)) {
            extra.crossRoleRules = crossRoleRulesOf(stored).filter((/** @type {*} */ rule) => (
                ((rule && rule.roleSlugs) || []).every((/** @type {string} */ slug) => retired.indexOf(slug) === -1)
            ));
        }

        return {
            series: Object.assign({}, stored, extra, {
                locked: true,
                roleSlugs: roleSlugs,
                lockedRoleSlugs: slugs,
            }),
            changed: reasons.length > 0,
            reason: reasons.join('; '),
        };
    }

    // ── Involvement carries its series ────────────────────────────────────────
    //
    // Fairness is counted per series (ADR-0016 §5), so a serving assignment
    // records which series it belonged to alongside its date and Role.
    //
    // Every Involvement record carries `seriesId` (backfilled in prod via
    // scripts/backfill-involvement-series.js). A missing field does not match
    // a series query or an in-memory slice.

    function seriesIdOf(involvement) {
        const id = involvement && involvement.seriesId;
        return typeof id === 'string' && id.trim() ? id.trim() : '';
    }

    // One series' slice of a serve history. Order is preserved; nothing is
    // mutated — this is a read.
    function forSeries(involvements, seriesId) {
        return (involvements || []).filter(record => seriesIdOf(record) === seriesId);
    }

    // Stamp an Involvement payload with its series before writing it. Returns a
    // new object so a caller can keep building its batch from the original.
    function stampSeries(data, seriesId) {
        return Object.assign({}, data, { seriesId: seriesId || SUNDAY_SERVICE_ID });
    }

    // ── Fairness config (MS-17, ADR-0020) ─────────────────────────────────────
    //
    // Fairness looks back over a WINDOW of this series' own occurrences — the
    // last 12, about a season for a Sunday. Occurrences and not weeks, so a
    // fortnightly Event is judged on the same amount of its own history as a
    // weekly one rather than half of it.
    //
    // Stored on the series so it CAN vary, but shipped fixed with no UI: the
    // window is the unit load is measured against, so changing it changes what
    // "spent" means for every person at once.
    const DEFAULT_FAIRNESS_WINDOW = 12;

    const usableNumber = (value, min) => (
        typeof value === 'number' && Number.isFinite(value) && value >= min
    );

    function fairnessWindowOf(series) {
        const raw = series && series.fairnessWindow;
        return usableNumber(raw, 1) ? raw : DEFAULT_FAIRNESS_WINDOW;
    }

    // ── Where a Role's intensity lives ────────────────────────────────────────
    //
    // ⚠ THREE HOMES, ONE ANSWER. Resolve through here and nowhere else.
    //
    //   • one-off Role    — on the Event. It has no definition at all, and its
    //                       own value is the only one there is, so it wins.
    //   • liturgical Role — the `liturgicalIntensity` map here. A liturgical Role
    //                       has no stored definition and MUST NEVER GET ONE:
    //                       /roles is editor-writable, so a document there would
    //                       make a locked Role editable, which is the invariant
    //                       ADR-0016 exists to protect. `RolesCore.allRoles`
    //                       refuses such a document outright.
    //   • Servant Role    — its own definition, supplied by the caller.
    //
    // Absent anywhere reads as 1. A stored value that is not a usable number also
    // reads as 1: one bad field must not poison every load in the church. That
    // rule is stated in RolesCore too, because these modules are deliberately
    // independent — and a test holds the two together, since a duplicated rule
    // is a rule that can drift.
    const DEFAULT_INTENSITY = 1;

    function intensityValue(raw) {
        return usableNumber(raw, 0) ? raw : null;
    }

    function roleIntensity(series, roleSlug, options) {
        const opts = options || {};

        // A one-off Role IS the whole Role, so its own value is the only one
        // there is. A Servant Role has a definition, and that definition is the
        // Roles Manager's answer — it must win over the series map, or a stray
        // `liturgicalIntensity: { setup: 3 }` would silently override a Setup
        // definition saying 4, with the Manager showing one number and fairness
        // using another. Only a Role with NO definition falls through to the
        // map, which is exactly the liturgical case the map exists for.
        //
        // A Servant Role's rest now belongs to the Event that runs it, so the
        // Event's own setting comes first and the definition only stands in
        // until the Event has one (see effectiveRole).
        const settings = roleSettingsOf(series, roleSlug);
        const fromEvent = !opts.oneOff && opts.definition && settings
            ? intensityValue(settings.intensity) : null;
        if (fromEvent !== null) return fromEvent;
        const own = opts.oneOff
            ? intensityValue(opts.oneOff.intensity)
            : intensityValue(opts.definition && opts.definition.intensity);
        if (own !== null) return own;
        if (opts.oneOff || opts.definition) return DEFAULT_INTENSITY;

        const liturgical = intensityValue(
            ((series && series.liturgicalIntensity) || {})[roleSlug]
        );
        return liturgical === null ? DEFAULT_INTENSITY : liturgical;
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

        const intensities = s.liturgicalIntensity || {};
        Object.keys(intensities).forEach(slug => {
            const n = intensities[slug];
            if (!usableNumber(n, 0)) {
                errors.push(
                    'The intensity for "' + slug + '" must be a number of weeks, and cannot be negative.'
                );
            }
        });

        const settingsMap = roleSettingsMapOf(s);
        Object.keys(settingsMap).forEach(slug => {
            const own = settingsMap[slug] || {};
            if (slugs.indexOf(slug) === -1) {
                errors.push('There are settings for "' + slug + '", which is not carried by this Event.');
            }
            if (own.slots !== undefined) {
                if (!Array.isArray(own.slots) || !own.slots.length) {
                    errors.push('"' + slug + '" needs at least one person.');
                } else if (own.slots.some(slot => !slot || ['male', 'female', 'either'].indexOf(slot.requirement) === -1)) {
                    errors.push('Each place on "' + slug + '" must ask for a man, a woman or either.');
                }
            }
            if (own.intensity !== undefined && own.intensity !== null && !usableNumber(own.intensity, 0)) {
                errors.push('The rest for "' + slug + '" must be a number of weeks, and cannot be negative.');
            }
            if (own.restrictions !== undefined && !Array.isArray(own.restrictions)) {
                errors.push('The rules for "' + slug + '" must be a list.');
            }
        });

        return { valid: errors.length === 0, errors: errors };
    }

    const EventsCore = {
        SUNDAY_SERVICE_ID,
        SERVICES_COLLECTION,
        DEFAULT_FAIRNESS_WINDOW,
        DEFAULT_INTENSITY,
        // fairness config (MS-17)
        fairnessWindowOf,
        roleIntensity,
        // building
        newSeries,
        sundayServiceSeries,
        reconcileSundayService,
        // roles on a series
        addRole,
        removeRole,
        assertSeriesDeletable,
        // a Role's settings on this Event
        roleSettingsOf,
        effectiveRole,
        rolesFor,
        withRoleSettings,
        withoutRoleSettings,
        // cross-Role rules on a series (MS-221)
        crossRoleRulesOf,
        withCrossRoleRules,
        withoutRulesNaming,
        rolesNamedBy,
        // occurrences
        occurrenceRef,
        // involvement's series
        seriesIdOf,
        forSeries,
        stampSeries,
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
