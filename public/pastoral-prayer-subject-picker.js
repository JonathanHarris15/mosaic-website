// @ts-nocheck
// Pastoral Prayer 1 / 2 on the Order of Service builder — wraps the shared
// personPicker with member-only, rotation-ordered candidates and last-prayed
// labels. Loaded after service-builder.js (which defines personPicker).
(function (global) {
    'use strict';

    function prayerEligibleFromFound(picker, found) {
        const parent = picker.parent;
        const who = picker.prayerWho;
        if (!parent || !who) return found;
        const memberIds = new Set((parent.prayerMembers || []).map(m => m.id));
        let list = (found || []).filter(p => p && p.id && !p.isNew && memberIds.has(p.id));
        if (who === 'male' || who === 'female') {
            list = list.filter(p => p.sex === who);
        }
        const Core = global.PastoralPrayerCore;
        const sortKey = (m) => (Core ? Core.rotationSortKey(m && m.lastPastoralPrayerDate) : '');
        list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
        const currentId = picker.personRef && picker.personRef.id;
        if (currentId && !list.some(m => m.id === currentId)) {
            const current = (parent.prayerMembers || []).find(m => m.id === currentId);
            if (current) list.unshift(current);
        }
        return list;
    }

    function pastoralPrayerPicker(slot, parent, item, idx) {
        const who = parent && parent.requestWho(item, idx);
        const suggestionsKey = who === 'female' ? 'females' : who === 'male' ? 'males' : null;
        const field = who === 'female' ? 'prayerFemale' : who === 'male' ? 'prayerMale' : null;
        const picker = personPicker(slot, parent, suggestionsKey, field);
        picker.prayerWho = who;
        picker.prayerLastLabel = function prayerLastLabel(person) {
            if (parent && typeof parent.prayerLastLabel === 'function') {
                return parent.prayerLastLabel(person);
            }
            const Core = global.PastoralPrayerCore;
            if (Core) return Core.lastPrayedLabel(person && person.lastPastoralPrayerDate);
            return '';
        };
        const baseSearch = picker.search.bind(picker);
        picker.search = async function prayerSubjectSearch() {
            if (who && parent && typeof parent.prayerChoices === 'function') {
                const q = (this.query || '').trim();
                const named = (this.personRef.name || '').trim();
                if (!q || q === named) {
                    let list = parent.prayerChoices(who, this.personRef && this.personRef.id);
                    const suggestions = this.suggestions;
                    if (suggestions && suggestions.length && typeof PeoplePickerCore !== 'undefined') {
                        list = PeoplePickerCore.excludeIds(list, suggestions);
                    }
                    this.results = list;
                    return;
                }
                const fuse = parent.peopleFuse;
                const registry = parent.peopleRegistry;
                if (fuse && registry) {
                    const found = fuse.search(this.query).slice(0, 20).map(r => r.item);
                    this.results = prayerEligibleFromFound(this, found);
                    return;
                }
            }
            await baseSearch();
            if (who) {
                this.results = prayerEligibleFromFound(this, this.results);
            }
        };
        return picker;
    }

    global.pastoralPrayerPicker = pastoralPrayerPicker;
}(typeof window !== 'undefined' ? window : globalThis));
