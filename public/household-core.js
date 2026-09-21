// Household Core — the kiosk grouping (MS-318 / MS-319).
//
// A Household is a named collection of people who belong together at the
// foyer, not a kinship tree. Family stays husband / wife / children.
// Stored Households are the source of truth once they exist; Families and
// unattached People still project so search is not empty on day one.
//
// Loaded as a classic <script> (window.HouseholdCore) and exported for Node tests.

(function (global) {
    'use strict';

    const PersonName = (typeof require !== 'undefined')
        ? require('./person-name.js')
        : (global && global.PersonName);

    function lastWord(name) {
        return PersonName.lastWord(name);
    }

    function householdNameFromMembers(members) {
        return PersonName.householdName(members);
    }

    function personMap(people) {
        const byId = {};
        (people || []).forEach(function (p) {
            if (p && p.id) byId[p.id] = p;
        });
        return byId;
    }

    function memberOf(byId, personId, kid) {
        const p = byId[personId];
        if (!p) return null;
        const parts = p.nameParts || null;
        const noLastName = !!(parts && parts.noLastName);
        const lastName = (!noLastName && parts && String(parts.lastName || '').trim()) || '';
        return {
            personId: personId,
            name: p.name || '',
            lastName: lastName,
            noLastName: noLastName,
            kid: kid == null ? !!p.kid : !!kid,
        };
    }

    function hydrateStored(stored, byId) {
        const members = (stored.members || []).map(function (m) {
            return memberOf(byId, m.personId, m.kid);
        }).filter(Boolean);
        if (!members.length && stored.memberIds) {
            stored.memberIds.forEach(function (id) {
                const m = memberOf(byId, id, null);
                if (m) members.push(m);
            });
        }
        if (!members.length) return null;
        return {
            id: stored.id,
            name: stored.name || householdNameFromMembers(members),
            members: members,
            stored: true,
        };
    }

    // Stored Households first, then a projection from each Family whose people
    // are not already seated, then a singleton for every remaining Person.
    function householdsFromDirectory(people, families, stored) {
        const byId = personMap(people);
        const seated = {};
        const households = [];

        (stored || []).forEach(function (row) {
            if (!row) return;
            const h = hydrateStored(row, byId);
            if (!h) return;
            h.members.forEach(function (m) { seated[m.personId] = true; });
            households.push(h);
        });

        (families || []).forEach(function (family) {
            if (!family) return;
            const members = [];
            [family.husbandId, family.wifeId].forEach(function (id) {
                if (!id || seated[id]) return;
                const m = memberOf(byId, id, false);
                if (m) {
                    members.push(m);
                    seated[id] = true;
                }
            });
            (family.childIds || []).forEach(function (id) {
                if (!id || seated[id]) return;
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
                stored: false,
            });
        });

        (people || []).forEach(function (p) {
            if (!p || !p.id || seated[p.id]) return;
            const one = memberOf(byId, p.id, !!p.kid);
            const members = one ? [one] : [];
            households.push({
                id: 'person:' + p.id,
                name: householdNameFromMembers(members),
                members: members,
                stored: false,
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

    function emptyCreatePerson() {
        return {
            firstName: '', lastName: '', suffix: '', noLastName: false,
            phone: '', sex: '', kid: false,
        };
    }

    function suggestedHouseholdName(people, query) {
        return PersonName.suggestedHouseholdName(people, query);
    }

    function householdNameForDraft(people, currentName, previousSuggestion, options) {
        return PersonName.householdNameForDraft(people, currentName, previousSuggestion, options);
    }

    function isNameEntry(person) {
        return !!person && Object.prototype.hasOwnProperty.call(person, 'firstName');
    }

    function createFault(people) {
        const rows = [];
        (people || []).forEach(function (p) {
            if (!p) return;
            if (isNameEntry(p)) {
                const entered = PersonName.enteredName(p);
                if (entered.empty) return;
                if (entered.fault) {
                    rows.fault = entered.fault;
                    return;
                }
                rows.push(p);
                return;
            }
            if (String(p.name || '').trim()) rows.push(p);
        });
        if (rows.fault) return rows.fault;
        if (!rows.length) return 'Add at least one person.';
        const missing = rows.find(function (p) { return p.sex !== 'male' && p.sex !== 'female'; });
        if (missing) return 'Say whether each person is male or female.';
        return '';
    }

    function personWrite(draft, now) {
        const entered = PersonName.enteredName(draft);
        const name = (!entered.empty && !entered.fault)
            ? entered.name
            : String(draft && draft.name || '').trim();
        const doc = {
            name: name,
            contact: {
                email: '',
                phone: String(draft && draft.phone || '').trim(),
                address: '',
            },
            sex: draft.sex,
            kid: !!draft.kid,
            membership: { stage: 'visitor' },
            tags: ['Visitor'],
            totalInvolvements: 0,
            lastPastoralPrayerDate: null,
            createdAt: now,
            updatedAt: now,
        };
        // Beside `name`, never instead of it, and never as top-level
        // firstName/lastName — that pair is how a screen once showed the
        // wrong name while its tests stayed green.
        if (entered.parts) doc.nameParts = entered.parts;
        return doc;
    }

    function householdWrite(name, members, now) {
        return {
            name: name,
            memberIds: members.map(function (m) { return m.personId; }),
            members: members.map(function (m) {
                return { personId: m.personId, kid: !!m.kid };
            }),
            createdAt: now,
        };
    }

    // ── Minting a projection (ADR-0044) ──────────────────────────────────────
    // A projected Household is a guess the app makes so the foyer is never empty.
    // The moment somebody USES one — checks people in from it, adds a brother to
    // it — the guess becomes a fact, and a fact belongs in the collection.
    //
    // The minted doc keeps the PROJECTION'S OWN ID (`family:<id>` /
    // `person:<id>`), which is what makes minting idempotent: two greeters
    // checking in the same household on two screens write the same document
    // twice instead of writing two documents. That is the duplicate this design
    // used to accept and no longer does.

    function isProjectionId(id) {
        const s = String(id || '');
        return s.indexOf('family:') === 0 || s.indexOf('person:') === 0;
    }

    // The single write that turns a projection (or an already-stored Household
    // gaining people) into the stored doc. `extra` are brand-new members to
    // append; existing ones are never reordered, so the list a greeter reads
    // does not shuffle under them.
    function mintWrite(household, extra, now) {
        const base = (household && household.members) || [];
        const seen = {};
        const members = [];
        base.concat(extra || []).forEach(function (m) {
            if (!m || !m.personId || seen[m.personId]) return;
            seen[m.personId] = true;
            members.push({ personId: m.personId, name: m.name || '', kid: !!m.kid });
        });
        const doc = householdWrite(
            (household && household.name) || householdNameFromMembers(members),
            members,
            now
        );
        if (household && isProjectionId(household.id)) doc.mintedFrom = household.id;
        return { doc: doc, members: members };
    }

    // ── Duplicate guard (ADR-0044) ───────────────────────────────────────────
    // Two Households with the same name are almost always the same household
    // typed twice on a busy Sunday. The kiosk cannot forbid it outright — a real
    // second Harris family exists — so it names the twin and offers it instead.
    function normalName(name) {
        return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function duplicateOf(households, name, excludeId) {
        const wanted = normalName(name);
        if (!wanted) return null;
        return (households || []).find(function (h) {
            return h && h.id !== excludeId && normalName(h.name) === wanted;
        }) || null;
    }

    // The people in a draft who share a name with somebody already in the
    // Household being added to — the other way the same person gets typed twice.
    function repeatedNames(household, people) {
        const have = {};
        ((household && household.members) || []).forEach(function (m) {
            if (m && m.name) have[normalName(m.name)] = m.name;
        });
        const hits = [];
        (people || []).forEach(function (p) {
            const hit = p && have[normalName(PersonName.fullName(p))];
            if (hit && hits.indexOf(hit) === -1) hits.push(hit);
        });
        return hits;
    }

    const HouseholdCore = {
        lastWord,
        householdNameFromMembers,
        householdsFromDirectory,
        searchHouseholds,
        emptyCreatePerson,
        suggestedHouseholdName,
        householdNameForDraft,
        createFault,
        personWrite,
        householdWrite,
        isProjectionId,
        mintWrite,
        normalName,
        duplicateOf,
        repeatedNames,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = HouseholdCore;
    }
    if (global) {
        global.HouseholdCore = HouseholdCore;
    }
})(typeof window !== 'undefined' ? window : null);
