// Service Involvement Core — who served at a Sunday, as a pure function of the
// Service document (MS-16, ADR-0018 §1).
//
// Two jobs, both of which the save path used to do inline:
//
//   1. WHO. Given a stored Service, the full set of Involvement records that
//      should exist for it. `service-builder` used to derive this by diffing the
//      previous save against the current one and writing the difference. That
//      works, but it means the answer to "who served on this Sunday" only exists
//      as the accumulated result of every edit ever made, and nothing can check
//      it. Stated as a set, it can be.
//
//   2. WHEN. A record is the fact that somebody served, so it is not written
//      until the date has passed. Assigning a preacher for a Sunday six weeks
//      out used to count as serving immediately, which is the bug ADR-0018 §1
//      named and fixed for Assignments and never fixed here.
//
// This module reads the SAVED shape — `preacherId`, `musicHelpers` — not the
// editor's working shape, so the scheduled conversion job and the editor both
// ask the same question of the same document and get the same answer.
//
// Pastoral prayer is deliberately absent. `liturgy.prayerMale` / `prayerFemale`
// write a `pastoral_prayer` record on the same save, but that records someone
// being prayed FOR, not serving: it drives `lastPastoralPrayerDate` for the
// prayer rotation, and fairness never reads it.

(function (global) {
    'use strict';

    // Field → Role slug. The id field is what makes somebody a Person the app can
    // credit; the name beside it may be a visiting speaker typed in by hand, who
    // is nobody to credit.
    //
    // `prayerPraiseId` and `prayerConfessionId` both carry the `prayer` slug —
    // one Role, two places in the service — so they are told apart by metadata.
    // Anything keyed only by date + slug + person would collide on the Sunday one
    // person does both.
    const SERVING_FIELDS = Object.freeze([
        { idField: 'serviceLeaderId', slug: 'service_leader' },
        { idField: 'musicLeaderId', slug: 'worship_leader' },
        { idField: 'preacherId', slug: 'preacher' },
        { idField: 'prayerPraiseId', slug: 'prayer', metadata: { prayer_type: 'praise' } },
        { idField: 'prayerConfessionId', slug: 'prayer', metadata: { prayer_type: 'confession' } },
        { idField: 'elementsId', slug: 'elements' },
        { idField: 'otherId', slug: 'other' },
        // Music helpers are a list of { name, id }, not a single field.
        { idField: 'musicHelpers', slug: 'worship_helper', list: true },
    ].map(Object.freeze));

    // Every slug a Service save can write. `elements` and `other` are serving but
    // are NOT liturgical Roles — they predate the Role model and are not part of
    // the printed liturgy, so they are not in `RolesCore.LITURGICAL_SLUGS` and
    // must not be tidied into it.
    const SERVING_SLUGS = Object.freeze(
        [...new Set(SERVING_FIELDS.map(f => f.slug))]
    );

    const isDateStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

    // ── Who served ───────────────────────────────────────────────────────────

    // The full set of Involvement records a stored Service should produce, in
    // field order. A name with no id is not a Person and is skipped — the same
    // rule `EventsOccurrenceCore.liturgicalHolders` applies, for the same reason.
    function servingInvolvement(service) {
        const doc = service || {};
        const records = [];

        SERVING_FIELDS.forEach(f => {
            const ids = f.list
                ? (Array.isArray(doc[f.idField]) ? doc[f.idField] : []).map(h => h && h.id)
                : [doc[f.idField]];

            ids.filter(Boolean).forEach(personId => {
                const record = { personId: personId, type: f.slug };
                if (f.metadata) record.metadata = Object.assign({}, f.metadata);
                records.push(record);
            });
        });

        return records;
    }

    // ── The id a record is written under ─────────────────────────────────────
    //
    // Deterministic, so a second conversion run overwrites rather than making a
    // duplicate. The old auto-id (`collection('involvement').doc()`) meant the
    // same fact written twice was two rows, and a serve log that double-counts
    // sends fairness away from exactly the people it should be sending toward.
    //
    // Keyed by date + slug + prayer type, and NOT by person: the record already
    // lives under `people/{id}/involvement`, so the person is the path.
    function involvementId(date, record) {
        if (!isDateStr(date) || !record || !record.type) return null;
        const parts = [date, record.type];
        const prayerType = record.metadata && record.metadata.prayer_type;
        if (prayerType) parts.push(prayerType);
        return parts.join('_');
    }

    // ── When it is written ───────────────────────────────────────────────────
    //
    // `today` is passed in rather than read from the clock, so this stays pure
    // and so the caller is forced to decide whose today it is. Callers use the
    // church's timezone: a Sunday is over when it is over at the church, not
    // when it is over wherever the server happens to be running.
    function hasPassed(date, today) {
        if (!isDateStr(date) || !isDateStr(today)) return false;
        return date < today;
    }

    // The records that should exist for this Service AS AT `today` — the set
    // once the date has passed, and nothing before it. This is the whole of the
    // timing rule, in one place, for both the editor and the scheduled job.
    function involvementAsAt(service, date, today) {
        return hasPassed(date, today) ? servingInvolvement(service) : [];
    }

    // ── Reconciling what exists with what should ─────────────────────────────
    //
    // Returns what to write and what to delete to make the stored records match
    // the desired set. A record that is already right is neither.
    //
    // This is what lets the editor stop diffing against its own previous save:
    // the Service document is the truth, and the records are made to agree.
    //
    // Keyed by PERSON and id together, never id alone. A record lives at
    // `people/{personId}/involvement/{id}`, so the person is part of its address
    // — and the two Music Helpers on a Sunday share the `worship_helper` slug and
    // therefore share an id. Keying by id alone collapses them into one and the
    // helper that loses is never credited for a Sunday they actually played.
    const keyOf = record => (
        record && record.id && record.personId
            ? record.personId + '/' + record.id
            : null
    );

    function reconcile(desired, existing) {
        const want = new Map();
        (desired || []).forEach(r => {
            const key = keyOf(r);
            if (key) want.set(key, r);
        });

        const have = new Map();
        (existing || []).forEach(r => {
            const key = keyOf(r);
            if (key) have.set(key, r);
        });

        const write = [];
        want.forEach((record, key) => {
            if (!have.has(key)) write.push(record);
        });

        const remove = [];
        have.forEach((record, key) => {
            if (!want.has(key)) remove.push(record);
        });

        return { write: write, remove: remove };
    }

    // Every desired record, stamped with the id it will be written under. The
    // shape both the editor and the scheduled job hand to `reconcile`.
    function desiredFor(service, date, today) {
        return involvementAsAt(service, date, today).map(r => Object.assign({
            id: involvementId(date, r),
            serviceDate: date,
        }, r));
    }

    const ServiceInvolvementCore = {
        SERVING_FIELDS,
        SERVING_SLUGS,
        servingInvolvement,
        involvementId,
        hasPassed,
        involvementAsAt,
        desiredFor,
        reconcile,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ServiceInvolvementCore;
    }
    if (global) {
        global.ServiceInvolvementCore = ServiceInvolvementCore;
    }
})(typeof window !== 'undefined' ? window : null);
