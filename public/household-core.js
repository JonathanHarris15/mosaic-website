// Household Core — the kiosk's Households (MS-318 / MS-319, MS-709).
//
// The foyer groups people by the Household records in `families`: a husband,
// a wife and the children still at home. A child who marries is a husband or
// wife in a record of their own, so they leave their parents' group at the
// desk without anybody touching it. Somebody in no record is a Household of
// one. Nothing here is stored — the kiosk's old `households` collection is no
// longer read (ADR-0075).
//
// Loaded as a classic <script> (window.HouseholdCore) and exported for Node tests.

(function (global) {
    'use strict';

    const PersonName = (typeof require !== 'undefined')
        ? require('./person-name.js')
        : (global && global.PersonName);
    const FamilyCore = (typeof require !== 'undefined')
        ? require('./family-core.js')
        : (global && global.FamilyCore);

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

    // ⚠ THE KID TOGGLE LIVES ON THE PERSON, AND NOTHING ELSE MAY OVERRULE IT
    // (MS-685). A Family's `childIds` is a snapshot of kinship, not a place an
    // editor can turn Kid off, so unticking Kid in the Membership Directory
    // has to win over being somebody's child — or the pickup number is still
    // minted and the guardian stub still printed for somebody who is not a Kid.
    //
    // So a Person who has an answer answers for themselves, and the seat is
    // the fallback only for a Person who has none — which is what still gets a
    // directory child the right tag on day one (CONTEXT.md, Kid).
    function kidFlagFor(p, fallback) {
        if (p.kid != null) return !!p.kid;
        return fallback == null ? false : !!fallback;
    }

    function memberOf(byId, personId, kid) {
        const p = byId[personId];
        if (!p) return null;
        const remembered = PersonName.rememberedLastName(p);
        return {
            personId: personId,
            name: p.name || '',
            lastName: remembered.lastName,
            noLastName: remembered.noLastName,
            sex: p.sex || '',
            kid: kidFlagFor(p, kid),
        };
    }

    // One Household per record, then one per Person who lives in none. Each
    // Person is placed once, in FamilyCore.householdOf: their marriage, else the
    // record they grew up in.
    function householdsFromDirectory(people, families) {
        const byId = personMap(people);
        const list = (families || []).filter(function (f) { return f && f.id; });
        const home = {};
        const place = function (id) {
            if (!id || home[id] !== undefined) return;
            const f = FamilyCore.householdOf(list, id);
            home[id] = f ? f.id : null;
        };
        list.forEach(function (f) {
            [f.husbandId, f.wifeId].concat(f.childIds || []).forEach(place);
        });

        const households = [];
        const seated = {};
        list.forEach(function (family) {
            const members = [];
            const seat = function (id, kid) {
                if (!id || seated[id] || home[id] !== family.id) return;
                const m = memberOf(byId, id, kid);
                if (!m) return;
                members.push(m);
                seated[id] = true;
            };
            seat(family.husbandId, false);
            seat(family.wifeId, false);
            (family.childIds || []).forEach(function (id) { seat(id, true); });
            if (!members.length) return;
            households.push({
                id: 'family:' + family.id,
                familyId: family.id,
                name: householdNameFromMembers(members),
                members: members,
            });
        });

        (people || []).forEach(function (p) {
            if (!p || !p.id || seated[p.id]) return;
            const one = memberOf(byId, p.id, !!p.kid);
            households.push({
                id: 'person:' + p.id,
                personId: p.id,
                name: householdNameFromMembers([one]),
                members: [one],
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

    // `role` is where the row sits in the Household record: a parent is seated
    // as husband or wife by sex, a child joins the children. Ticking Kid moves
    // the row to child; a grown child still at home is a child who is not a Kid.
    function emptyCreatePerson() {
        return {
            firstName: '', lastName: '', suffix: '', noLastName: false,
            phone: '', sex: '', kid: false, role: 'parent',
        };
    }

    function createFault(people) {
        const rows = [];
        (people || []).forEach(function (p) {
            if (!p) return;
            if (PersonName.isNameEntry(p)) {
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

    function roleOf(row) {
        if (row && (row.role === 'parent' || row.role === 'child')) return row.role;
        return row && row.kid ? 'child' : 'parent';
    }

    // The `families` write a kiosk draft makes (MS-709). `target` is the kiosk
    // Household being added to, or null for a new one; `added` is the new People
    // as { personId, sex, role }. A Household of one needs no record, so a lone
    // new Person writes nothing here.
    //
    //   { fault }                               refuse, and write nobody
    //   { action: 'none' }
    //   { action: 'create', changes }
    //   { action: 'update', familyId, changes }
    function householdRecordFor(target, added, families) {
        const family = target && target.familyId
            ? (families || []).find(function (f) { return f.id === target.familyId; }) || null
            : null;
        if (target && target.familyId && !family) return { fault: 'That household has changed. Search for it again.' };
        const seats = {
            husbandId: family ? family.husbandId || null : null,
            wifeId: family ? family.wifeId || null : null,
        };
        const childIds = family ? (family.childIds || []).slice() : [];
        const rows = [];
        if (target && !family && target.personId) {
            const alone = (target.members || [])[0] || {};
            rows.push({ personId: target.personId, sex: alone.sex, role: alone.kid ? 'child' : 'parent', name: alone.name });
        }
        (added || []).forEach(function (a) { rows.push(a); });

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (roleOf(r) === 'child') {
                if (childIds.indexOf(r.personId) === -1) childIds.push(r.personId);
                continue;
            }
            const seat = r.sex === 'male' ? 'husbandId' : r.sex === 'female' ? 'wifeId' : null;
            if (!seat) {
                return { fault: (r.name || 'Everyone') + ' needs male or female recorded before they can be a parent here.' };
            }
            if (seats[seat]) {
                return { fault: seat === 'husbandId'
                    ? 'This household already has a husband. Mark the other man as a child, or give him a household of his own.'
                    : 'This household already has a wife. Mark the other woman as a child, or give her a household of her own.' };
            }
            seats[seat] = r.personId;
        }

        const count = (seats.husbandId ? 1 : 0) + (seats.wifeId ? 1 : 0) + childIds.length;
        if (!family && count < 2) return { action: 'none' };
        if (!seats.husbandId && !seats.wifeId) {
            return { fault: 'Mark at least one person as a parent.' };
        }
        const changes = { husbandId: seats.husbandId, wifeId: seats.wifeId, childIds: childIds };
        return family
            ? { action: 'update', familyId: family.id, changes: changes }
            : { action: 'create', changes: changes };
    }

    // The same check before anybody is written, with stand-in ids.
    function draftRecordFault(target, people, families) {
        const rows = (people || []).filter(function (p) {
            return p && !PersonName.enteredName(p).empty;
        }).map(function (p, i) {
            return { personId: 'draft-' + i, sex: p.sex, role: roleOf(p), name: PersonName.fullName(p) };
        });
        return householdRecordFor(target, rows, families).fault || '';
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

    // A name fixed at the desk. Only the name moves — the rules let the kiosk
    // write `name`, `nameParts` and `updatedAt` on a Person and nothing else.
    //   { fault } | { unchanged: true } | { patch }
    function renameWrite(person, entry, now) {
        const was = PersonName.blanksFor(person);
        const e = entry || {};
        const same = ['firstName', 'lastName', 'suffix'].every(function (k) {
            return String(e[k] || '').trim() === String(was[k] || '').trim();
        }) && !!e.noLastName === !!was.noLastName;
        if (same) return { unchanged: true };
        const saved = PersonName.saveExisting(person, entry);
        if (saved.fault) return { fault: PersonName.nameFixFault(saved.fault) };
        if (!saved.writeParts
            || !PersonName.nameWouldChange(person && person.name, person && person.nameParts, saved.name, saved.nameParts)) {
            return { unchanged: true };
        }
        return { patch: { name: saved.name, nameParts: saved.nameParts, updatedAt: now } };
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
        createFault,
        roleOf,
        householdRecordFor,
        draftRecordFault,
        personWrite,
        renameWrite,
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
