// Shared rules for Order-of-Service / calendar person pickers: de-duplicate by
// Person id when several sources are merged, drop people who must not be offered
// (inactive, hidden, does-not-serve — via roles-core), and label same-name
// people so two distinct records do not look like one duplicated row.
(function (global) {
    'use strict';

    function rolesCore() {
        if (typeof RolesCore !== 'undefined') return RolesCore;
        if (typeof require === 'function') {
            try {
                return require('./roles-core.js');
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    function dedupeByPersonId(list) {
        const seen = new Set();
        const out = [];
        (list || []).forEach((person) => {
            if (!person) return;
            if (person.isNew || person.id === 'NEW') {
                out.push(person);
                return;
            }
            const id = person.id;
            if (!id || seen.has(id)) return;
            seen.add(id);
            out.push(person);
        });
        return out;
    }

    function offeredIdSet(registry, assignableOpts) {
        const people = registry || [];
        const Roles = rolesCore();
        const offered = Roles
            ? Roles.assignablePeople(people, assignableOpts || {})
            : people;
        return new Set((offered || []).map(p => p && p.id).filter(Boolean));
    }

    // Drop people who must not be offered, but keep explicit selections (e.g. an
    // inactive Person already on this Sunday before they were marked inactive).
    function filterOffered(list, registry, options) {
        const opts = options || {};
        const keep = new Set((opts.keepIds || []).filter(Boolean));
        const ids = offeredIdSet(registry, opts.assignableOpts);
        return (list || []).filter((person) => {
            if (!person) return false;
            if (person.isNew || person.id === 'NEW') return true;
            if (!person.id) return false;
            if (keep.has(person.id)) return true;
            return ids.has(person.id);
        });
    }

    function excludeIds(list, excludePeople) {
        const ban = new Set((excludePeople || []).map(p => p && p.id).filter(Boolean));
        return (list || []).filter((person) => {
            if (!person || person.isNew || !person.id) return true;
            return !ban.has(person.id);
        });
    }

    function disambiguationDetail(person) {
        const membership = (person && person.membership) || {};
        if (membership.inactive === true || membership.status === 'inactive') return 'inactive';
        if (person && person.inactive === true) return 'inactive';
        const tags = (person && person.tags) || [];
        if (tags.indexOf('Inactive') !== -1) return 'inactive';
        if (person && person.email) return String(person.email);
        if (person && person.phone) return String(person.phone);
        if (person && person.id) return '…' + String(person.id).slice(-6);
        return '';
    }

    function optionLabel(person, visibleList) {
        const name = (person && person.name) || '';
        if (!name) return '';
        const peers = (visibleList || []).filter(
            p => p && !p.isNew && (p.name || '') === name,
        );
        if (peers.length <= 1) return name;
        const detail = disambiguationDetail(person);
        return detail ? (name + ' — ' + detail) : name;
    }

    function finalizePickerList(list, registry, options) {
        return filterOffered(dedupeByPersonId(list), registry, options);
    }

    const PeoplePickerCore = {
        dedupeByPersonId,
        filterOffered,
        excludeIds,
        optionLabel,
        finalizePickerList,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PeoplePickerCore;
    }
    if (global) {
        global.PeoplePickerCore = PeoplePickerCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
