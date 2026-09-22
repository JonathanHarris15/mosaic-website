// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/person-name.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Person name — entered as a first name, a last name, and an optional suffix.
//
// The full name is those parts in that order, skipping a blank. That full
// name is the only name every screen reads. The parts are remembered beside
// it (nameParts), never as a top-level firstName/lastName pair. A person who
// only has a full name is not parsed apart. A person with no last name is
// still a person. (ADR 0069, MS-602)
//
// Loaded as a classic <script> (window.PersonName) and exported for Node tests.

(function (global) {
    'use strict';

    const NEEDS_FIRST = 'A new person needs a first name.';
    const NEEDS_LAST = 'A new person needs a last name, or mark that they have none.';

    function text(value) {
        return String(value == null ? '' : value).trim();
    }

    function lastWord(name) {
        const parts = text(name).split(/\s+/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }

    // What a greeter or an editor typed into the three blanks. A row with
    // nothing in it is a spare row: ignored, not a fault. A last name typed
    // under "no last name" is not remembered — the pass is the last name.
    function enteredName(entry) {
        const e = entry || {};
        const first = text(e.firstName);
        const suffix = text(e.suffix);
        const noLastName = e.noLastName === true;
        const typedLast = text(e.lastName);
        const last = noLastName ? '' : typedLast;
        if (!first && !suffix && !typedLast) {
            return { empty: true, fault: '', name: '', parts: null };
        }
        if (!first) return { empty: false, fault: NEEDS_FIRST, name: '', parts: null };
        if (!last && !noLastName) return { empty: false, fault: NEEDS_LAST, name: '', parts: null };
        return {
            empty: false,
            fault: '',
            name: [first, last, suffix].filter(Boolean).join(' '),
            parts: { firstName: first, lastName: last, suffix: suffix, noLastName: noLastName },
        };
    }

    // A draft row carries the blanks (firstName is always present, even when
    // blank). A person already in the directory, or a household member, does
    // not — they have a full name, and maybe a last name remembered beside it.
    function isNameEntry(person) {
        return !!person && Object.prototype.hasOwnProperty.call(person, 'firstName');
    }

    function emptyBlanks() {
        return { firstName: '', lastName: '', suffix: '', noLastName: false };
    }

    // The last name remembered beside a full name, for a person who is not
    // being typed into the blanks right now.
    function rememberedLastName(person) {
        const parts = person && person.nameParts;
        if (!parts) return { lastName: '', noLastName: false };
        const noLastName = parts.noLastName === true;
        return {
            lastName: noLastName ? '' : text(parts.lastName),
            noLastName: noLastName,
        };
    }

    function lastNameOf(person) {
        if (!person) return '';
        if (isNameEntry(person)) {
            const entered = enteredName(person);
            if (entered.empty || entered.fault || !entered.parts || entered.parts.noLastName) return '';
            return entered.parts.lastName;
        }
        if (person.noLastName) return '';
        const remembered = text(person.lastName);
        if (remembered) return remembered;
        return lastWord(person.name);
    }

    function householdTitle(lastName) {
        return lastName ? ('The ' + lastName + ' Household') : 'A Household';
    }

    // On create: the first adult who has a last name, else the first person
    // who has one, else the last word of a full name, else "A Household".
    function householdName(people) {
        const list = people || [];
        const adult = list.find(function (p) { return p && !p.kid && lastNameOf(p); });
        const any = list.find(function (p) { return p && lastNameOf(p); });
        return householdTitle(lastNameOf(adult || any));
    }

    // The household name field on create. While it still equals the previous
    // suggestion, it follows the people. Once the greeter has changed it, later
    // rows leave it alone. Adding to a household that already exists does not
    // rename it.
    function householdNameForDraft(people, currentName, previousSuggestion, options) {
        const current = text(currentName);
        if (options && options.adding) {
            return {
                name: current,
                suggestion: previousSuggestion == null ? current : String(previousSuggestion),
            };
        }
        const suggestion = householdName(people);
        const previous = previousSuggestion == null ? null : String(previousSuggestion).trim();
        if (previous != null && current !== previous) {
            return { name: current, suggestion: previous };
        }
        return { name: suggestion, suggestion: suggestion };
    }

    // The old search seed: a query names a household only when nobody is being
    // entered. A first name is not a last name.
    function suggestedHouseholdName(people, query) {
        const named = householdName(people);
        if (named !== 'A Household') return named;
        const anyone = (people || []).some(function (p) {
            return p && (text(p.name) || text(p.firstName) || text(p.lastName) || text(p.suffix));
        });
        if (anyone) return named;
        const q = text(query);
        return q ? householdTitle(lastWord(q)) : 'A Household';
    }

    function saveExisting(existing, entry) {
        const entered = enteredName(entry);
        const current = existing && existing.name != null ? String(existing.name) : '';
        if (entered.empty) return { name: current, fault: '', writeParts: false };
        if (entered.fault) return { name: current, fault: entered.fault, writeParts: false };
        return {
            name: entered.name,
            nameParts: entered.parts,
            fault: '',
            writeParts: true,
        };
    }

    function blanksFor(person) {
        const parts = person && person.nameParts;
        if (!parts) return emptyBlanks();
        return {
            firstName: text(parts.firstName),
            lastName: parts.noLastName ? '' : text(parts.lastName),
            suffix: text(parts.suffix),
            noLastName: parts.noLastName === true,
        };
    }

    // Two remembered splits are the same split. Absent on both sides is the
    // same as well: a name that was never entered in parts has no parts.
    function sameParts(a, b) {
        function canon(parts) {
            if (!parts) return null;
            const entered = enteredName(parts);
            return entered.parts || null;
        }
        const left = canon(a);
        const right = canon(b);
        if (!left && !right) return true;
        if (!left || !right) return false;
        return left.firstName === right.firstName
            && left.lastName === right.lastName
            && left.suffix === right.suffix
            && left.noLastName === right.noLastName;
    }

    // A full name that stays put is still a change when the parts are new.
    // A spelling with no parts is not a change when that spelling is already
    // the full name — clearing a split is not what a same-spelling ask does.
    function nameWouldChange(currentName, currentParts, nextName, nextParts) {
        if (text(nextName) !== text(currentName)) return true;
        if (!nextParts) return false;
        return !sameParts(nextParts, currentParts);
    }

    function fieldsForNewPerson(entry) {
        const entered = enteredName(entry);
        if (entered.empty) return { fault: NEEDS_FIRST };
        if (entered.fault) return { fault: entered.fault };
        return { fault: '', name: entered.name, nameParts: entered.parts };
    }

    // The full name to show and to compare. An entry in parts wins; a person
    // who only has a full name keeps it.
    function fullName(person) {
        const entered = enteredName(person);
        if (!entered.empty && !entered.fault) return entered.name;
        return text(person && person.name);
    }

    const PersonName = {
        enteredName,
        isNameEntry,
        emptyBlanks,
        rememberedLastName,
        lastNameOf,
        householdName,
        householdNameForDraft,
        suggestedHouseholdName,
        saveExisting,
        blanksFor,
        sameParts,
        nameWouldChange,
        fieldsForNewPerson,
        fullName,
        lastWord,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PersonName;
    }
    if (global) {
        global.PersonName = PersonName;
    }
})(typeof window !== 'undefined' ? window : null);
