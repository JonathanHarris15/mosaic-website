// Non-serving — the one reader of "Doesn't serve" for whole tags and groups
// (ADR 0086). Every page that offers people for a Role reads it here, once per
// page, so a tag marked on the Roles Manager is honoured by the event picker,
// Auto-assign, Trades and the service pickers alike. What it MEANS is
// RolesCore's (nonServingSetting, nonServingIds); this only fetches it.
//
// Fails open, deliberately: a setting that cannot be read takes nobody out.
// A Person's own mark (people/{id}.doesNotServe) is on their record and is
// unaffected. A group this account cannot read (a member, say) is likewise not
// applied — RolesCore only ever takes out people it can see in a group.
//
// Loaded as a classic <script> (window.NonServing); needs RolesCore first.

(function (global) {
    'use strict';

    const EMPTY = Object.freeze({ nonServing: { tagIds: [], groupIds: [] }, groups: [] });
    let pending = null;

    /** @param {*} db */
    function load(db) {
        if (pending) return pending;
        const Roles = global.RolesCore;
        const where = Roles.NON_SERVING_DOC;
        pending = (async () => {
            let setting = Roles.nonServingSetting(null);
            try {
                const doc = await db.collection(where.collection).doc(where.id).get();
                setting = Roles.nonServingSetting(doc.exists ? doc.data() : null);
            } catch (e) {
                console.warn('Could not read who does not serve:', e);
            }
            let groups = [];
            if (setting.groupIds.length) {
                try {
                    // Constrained like every other group read: unconstrained,
                    // Firestore fails the whole query for anyone not an elder.
                    const snap = await db.collection('relationship_groups')
                        .where('sharedWithEditors', '==', true).get();
                    groups = snap.docs.map((/** @type {*} */ d) => Object.assign({ id: d.id }, d.data()))
                        .filter((/** @type {*} */ g) => setting.groupIds.indexOf(g.id) !== -1);
                } catch (e) {
                    groups = [];
                }
            }
            const value = { nonServing: setting, groups: groups };
            NonServing.current = value;
            return value;
        })();
        return pending;
    }

    // After the setting is changed on this page, the next load reads it fresh.
    function forget() {
        pending = null;
    }

    const NonServing = { load, forget, current: EMPTY, EMPTY };

    if (global) global.NonServing = NonServing;
})(typeof window !== 'undefined' ? window : null);
