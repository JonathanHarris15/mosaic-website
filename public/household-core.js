// Household Core — the kiosk grouping (MS-318, heading into MS-319).
//
// A Household is a named collection of people who belong together at the
// foyer, not a kinship tree. Family stays husband / wife / children. Until
// MS-319 persists Households, they are projected from Families (one Household
// per Family) plus a singleton Household for every Person in no Family, so
// search is not empty on day one.
//
// Loaded as a classic <script> (window.HouseholdCore) and exported for Node tests.

(function (global) {
    'use strict';

    function lastWord(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }

    function householdNameFromMembers(members) {
        const first = (members || []).find(function (m) { return m && !m.child; })
            || (members || [])[0];
        const surname = lastWord(first && first.name);
        return surname ? ('The ' + surname + ' Household') : 'A Household';
    }

    function personMap(people) {
        const byId = {};
        (people || []).forEach(function (p) {
            if (p && p.id) byId[p.id] = p;
        });
        return byId;
    }

    function memberOf(byId, personId, child) {
        const p = byId[personId];
        if (!p) return null;
        return { personId: personId, name: p.name || '', child: !!child };
    }

    // Project Households from the directory as it stands. Family is the source
    // until MS-319 writes a households collection; the kiosk never names Family.
    function householdsFromDirectory(people, families) {
        const byId = personMap(people);
        const seated = {};
        const households = [];

        (families || []).forEach(function (family) {
            if (!family) return;
            const members = [];
            [family.husbandId, family.wifeId].forEach(function (id) {
                const m = memberOf(byId, id, false);
                if (m) {
                    members.push(m);
                    seated[id] = true;
                }
            });
            (family.childIds || []).forEach(function (id) {
                const m = memberOf(byId, id, true);
                if (m) {
                    members.push(m);
                    seated[id] = true;
                }
            });
            if (!members.length) return;
            households.push({
                id: 'family:' + family.id,
                name: householdNameFromMembers(members),
                members: members,
            });
        });

        (people || []).forEach(function (p) {
            if (!p || !p.id || seated[p.id]) return;
            const members = [{ personId: p.id, name: p.name || '', child: false }];
            households.push({
                id: 'person:' + p.id,
                name: householdNameFromMembers(members),
                members: members,
            });
        });

        return households;
    }

    function searchHouseholds(households, query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return [];
        return (households || []).filter(function (h) {
            if ((h.name || '').toLowerCase().indexOf(q) !== -1) return true;
            return (h.members || []).some(function (m) {
                return String(m.name || '').toLowerCase().indexOf(q) !== -1;
            });
        });
    }

    const HouseholdCore = {
        lastWord,
        householdNameFromMembers,
        householdsFromDirectory,
        searchHouseholds,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = HouseholdCore;
    }
    if (global) {
        global.HouseholdCore = HouseholdCore;
    }
})(typeof window !== 'undefined' ? window : null);
