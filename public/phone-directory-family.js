// Phone Directory Family — what the phone Membership Directory writes for a
// Family, and who may see the controls (MS-616).
//
// The family planners stay the household rules. This plan only answers what
// the person page should not invent: whether sex is saved, which people the
// two searches offer, what an anniversary write is, the spouse-removal
// confirmation, and the sentence to show when sex is unset.
//
// Loaded as a classic script (window.PhoneDirectoryFamily) and exported for Node.

(function (global) {
    'use strict';

    const SEX_UNSET = "Set this person's sex in Edit Details to build their family.";
    const SPOUSE_REMOVAL = 'End the marriage record for these two? Each keeps their own record.';
    const SAVE_FAILED = "Couldn't save the Family. It did not work.";
    const SEARCH_LIMIT = 8;

    function familyCore() {
        return global && global.FamilyCore;
    }

    function edit() {
        return global && global.PhoneDirectoryEdit;
    }

    function sexSaved(person) {
        return !!(person && (person.sex === 'male' || person.sex === 'female'));
    }

    function refusedSex() {
        return { write: false, sentence: SEX_UNSET, plan: null, deletesFamily: false };
    }

    function fromPlanner(plan) {
        return {
            write: !!plan.valid,
            sentence: plan.valid ? null : ((plan.errors && plan.errors[0]) || null),
            plan: plan,
            deletesFamily: false,
        };
    }

    // A spouse or child change. `removing` asks the removal planner. Until sex
    // is saved there is nothing to write, and the sentence names Edit Details.
    function planRelation(families, person, kind, otherId, personById, removing) {
        if (!sexSaved(person)) return refusedSex();
        const core = familyCore();
        const personId = person.id;
        const plan = removing
            ? core.planRemoveFamilyRelation(families, personId, kind, otherId)
            : core.planAddFamilyRelation(families, personId, kind, otherId, personById);
        return fromPlanner(plan);
    }

    function seatFor(person) {
        return person.sex === 'male' ? 'husbandId' : 'wifeId';
    }

    // The anniversary is a date on the Family this person is a spouse in. It
    // is not a relation. Someone who is only a child gets a new Family; the
    // Family they were born into is left alone. Clearing writes it empty.
    function planAnniversary(families, person, value) {
        if (!sexSaved(person)) return refusedSex();
        const anniversary = value || null;
        const mine = familyCore().familyOfSpouse(families, person.id);
        if (!mine) {
            const changes = { husbandId: null, wifeId: null, childIds: [], anniversary: anniversary };
            changes[seatFor(person)] = person.id;
            return {
                write: true,
                sentence: null,
                deletesFamily: false,
                plan: {
                    valid: true,
                    errors: [],
                    collection: 'families',
                    action: 'create',
                    familyId: null,
                    changes: changes,
                },
            };
        }
        return {
            write: true,
            sentence: null,
            deletesFamily: false,
            plan: {
                valid: true,
                errors: [],
                collection: 'families',
                action: 'update',
                familyId: mine.id,
                changes: { anniversary: anniversary },
            },
        };
    }

    // What a create writes. The same base the computer directory stores, so a
    // Family saved on the phone is the Family that page shows.
    function documentFor(planned) {
        const plan = planned && planned.plan;
        if (!plan || !plan.valid || plan.action !== 'create') return null;
        const changes = plan.changes || {};
        return {
            husbandId: changes.husbandId != null ? changes.husbandId : null,
            wifeId: changes.wifeId != null ? changes.wifeId : null,
            childIds: (changes.childIds || []).slice(),
            anniversary: changes.anniversary != null ? changes.anniversary : null,
        };
    }

    function copyFamily(family) {
        return Object.assign({}, family, { childIds: (family.childIds || []).slice() });
    }

    // The Families on the page after a successful write. An invalid plan, or a
    // write that never happened, leaves them as they were.
    function familiesAfter(families, planned, createdId) {
        const list = (families || []).map(copyFamily);
        if (!planned || !planned.write || !planned.plan || !planned.plan.valid) return list;
        const plan = planned.plan;
        if (plan.action === 'create') {
            list.push(Object.assign({ id: createdId }, documentFor(planned)));
            return list;
        }
        return list.map(function (family) {
            if (family.id !== plan.familyId) return family;
            const next = copyFamily(family);
            const changes = plan.changes || {};
            Object.keys(changes).forEach(function (key) {
                if (key === 'childIds') next.childIds = (changes.childIds || []).slice();
                else next[key] = changes[key];
            });
            return next;
        });
    }

    function nameMatches(candidate, query) {
        const q = String(query || '').toLowerCase();
        if (!q) return true;
        return String(candidate && candidate.name || '').toLowerCase().indexOf(q) !== -1;
    }

    function oppositeSex(person) {
        if (!person) return null;
        if (person.sex === 'male') return 'female';
        if (person.sex === 'female') return 'male';
        return null;
    }

    function spouseSearch(families, people, person, query) {
        const need = oppositeSex(person);
        if (!person || !need) return [];
        const core = familyCore();
        const out = [];
        (people || []).forEach(function (candidate) {
            if (out.length >= SEARCH_LIMIT) return;
            if (!candidate || candidate.id === person.id) return;
            if (candidate.sex !== need) return;
            if (!nameMatches(candidate, query)) return;
            if (core.familyOfSpouse(families, candidate.id)) return;
            out.push(candidate);
        });
        return out;
    }

    function childSearch(families, people, person, query) {
        if (!person) return [];
        const core = familyCore();
        const mine = core.familyOfSpouse(families, person.id);
        const spouseId = core.spouseOf(mine, person.id);
        const existing = mine ? (mine.childIds || []) : [];
        const out = [];
        (people || []).forEach(function (candidate) {
            if (out.length >= SEARCH_LIMIT) return;
            if (!candidate || candidate.id === person.id) return;
            if (candidate.id === spouseId) return;
            if (existing.indexOf(candidate.id) !== -1) return;
            if (core.familyOfChild(families, candidate.id)) return;
            if (!nameMatches(candidate, query)) return;
            out.push(candidate);
        });
        return out;
    }

    // The list stays closed until a name is typed and somebody matches, so an
    // empty field does not dump the directory onto the page.
    function searchListOpen(query, candidates) {
        return !!(query && candidates && candidates.length);
    }

    function removalConfirmation(kind) {
        if (kind === 'spouse') return SPOUSE_REMOVAL;
        return null;
    }

    function offerControls(user, editModeOn) {
        const gate = edit();
        return !!(editModeOn && gate && gate.mayOfferEditMode(user));
    }

    // Controls only while Edit Mode is on for someone who may edit, and only
    // once sex is saved. Until then the sentence names Edit Details. A member
    // gets neither the controls nor that sentence.
    function familyEditor(user, editModeOn, person) {
        if (!offerControls(user, editModeOn)) return { show: false, sentence: null };
        if (!sexSaved(person)) return { show: false, sentence: SEX_UNSET };
        return { show: true, sentence: null };
    }

    function familyLineText(line) {
        if (!line) return '';
        const bits = [];
        if (line.spouseName) bits.push(line.spouseName);
        if (line.childNames && line.childNames.length) bits.push(line.childNames.join(', '));
        return bits.join(' · ');
    }

    function spouseSeatLabel(person) {
        if (person && person.sex === 'male') return 'Wife';
        if (person && person.sex === 'female') return 'Husband';
        return 'Spouse';
    }

    function spouseIdOf(families, personId) {
        return familyCore().resolveRelations(families, personId).spouseId;
    }

    function childIdsOf(families, personId) {
        return (familyCore().resolveRelations(families, personId).childIds || []).slice();
    }

    function anniversaryValue(families, personId) {
        const mine = familyCore().familyOfSpouse(families, personId);
        return (mine && mine.anniversary) || '';
    }

    // The line the computer directory card already shows: spouse, then
    // children. No spouse and no children means no line. The anniversary is
    // not on it.
    function familyLine(families, personId, nameOf) {
        const rel = familyCore().resolveRelations(families, personId);
        const childIds = rel.childIds || [];
        if (!rel.spouseId && !childIds.length) return null;
        const name = typeof nameOf === 'function' ? nameOf : function (id) { return id; };
        return {
            spouseName: rel.spouseId ? name(rel.spouseId) : null,
            childNames: childIds.map(name),
        };
    }

    const PhoneDirectoryFamily = {
        SEX_UNSET: SEX_UNSET,
        SPOUSE_REMOVAL: SPOUSE_REMOVAL,
        SAVE_FAILED: SAVE_FAILED,
        planRelation: planRelation,
        planAnniversary: planAnniversary,
        documentFor: documentFor,
        familiesAfter: familiesAfter,
        spouseSearch: spouseSearch,
        childSearch: childSearch,
        searchListOpen: searchListOpen,
        removalConfirmation: removalConfirmation,
        offerControls: offerControls,
        familyEditor: familyEditor,
        familyLine: familyLine,
        familyLineText: familyLineText,
        spouseSeatLabel: spouseSeatLabel,
        spouseIdOf: spouseIdOf,
        childIdsOf: childIdsOf,
        anniversaryValue: anniversaryValue,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PhoneDirectoryFamily;
    }
    if (global) {
        global.PhoneDirectoryFamily = PhoneDirectoryFamily;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
