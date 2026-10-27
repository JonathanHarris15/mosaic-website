// Plan removal of carriedBy entries that name nobody (MS-808).
//
// A prayer leader is the presence of carriedBy.<elementId> as { id, name }.
// The editor used to write { name: '', id: null } for every prayer someone
// else might pray, so the picker had an object. Those entries are not prayer
// leaders. This plans their deletion. A named person stays.
(function (global) {
    'use strict';

    /**
     * @param {any} ref
     * @return {boolean}
     */
    function namesNobody(ref) {
        if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return true;
        const name = ref.name != null && String(ref.name).trim();
        return !(ref.id || name);
    }

    /**
     * @param {any} data A services document.
     * @return {{deletePaths: string[]}}
     */
    function planEmptyPrayerLeaderDeletion(data) {
        const map = data && data.carriedBy;
        if (!map || typeof map !== 'object' || Array.isArray(map)) {
            return {deletePaths: []};
        }
        const deletePaths = [];
        Object.keys(map).forEach(function (key) {
            if (namesNobody(map[key])) deletePaths.push('carriedBy.' + key);
        });
        deletePaths.sort();
        return {deletePaths: deletePaths};
    }

    const StripEmptyPrayerLeaders = {
        planEmptyPrayerLeaderDeletion: planEmptyPrayerLeaderDeletion,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = StripEmptyPrayerLeaders;
    }
    if (global) {
        global.StripEmptyPrayerLeaders = StripEmptyPrayerLeaders;
    }
}(typeof window !== 'undefined' ? window : null));
