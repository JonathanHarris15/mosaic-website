// Phone Directory Merge — a directory merge on the phone Membership Directory
// (MS-619).
//
// A directory merge retires one Person into another who remains. This plan
// says what the computer's directory merge would write: which blanks to fill,
// which tags the survivor ends with, which serves and which Sundays to copy,
// which of the retired record's history rows to delete, the serve count, and
// the last pastoral-prayer date. It does not talk to the server. The page
// reads both people and both histories from the server, asks this plan, and
// performs those writes. It does not move a Family, a Household, a login, a
// Directory Photo, a name, a Kid mark, or a relationship.
//
// Loaded as a classic script (window.PhoneDirectoryMerge) and exported for Node.

(function (global) {
    'use strict';

    const MERGE_FAILED = 'Merge operation failed';
    const SEARCH_LIMIT = 15;
    const LINES = Object.freeze([
        'All involvement history will be moved.',
        'All pastoral prayer history will be moved.',
        'Tags from both will be combined.',
        'Missing contact info will be filled from the duplicate.',
    ]);

    let serverList = false;

    function events() {
        return global && global.EventsCore;
    }

    function prayer() {
        return global && global.PastoralPrayerCore;
    }

    function track() {
        return global && global.PhoneDirectoryTrack;
    }

    function edit() {
        return global && global.PhoneDirectoryEdit;
    }

    function listOf(value) {
        return Array.isArray(value) ? value : [];
    }

    function idOf(person) {
        if (!person || person.id == null || person.id === '') return '';
        return String(person.id);
    }

    function displayName(person) {
        if (!person || person.name == null) return '';
        return String(person.name);
    }

    // The computer treats a missing or empty value as a blank, and anything
    // already stored — including a space — as the survivor's answer.
    function present(value) {
        return !!value;
    }

    function contactValue(person, key) {
        const contact = person && person.contact;
        return contact ? contact[key] : undefined;
    }

    function tagList(person) {
        const tags = person && person.tags;
        return Array.isArray(tags) ? tags.slice() : [];
    }

    // Source first, then whatever the survivor has that the source did not.
    // The same order the computer's union writes. A tag the system sets is
    // included. Nothing here re-projects the Membership Track.
    function unionTags(sourceTags, keptTags) {
        const seen = new Set();
        const combined = [];
        sourceTags.concat(keptTags).forEach((tag) => {
            if (seen.has(tag)) return;
            seen.add(tag);
            combined.push(tag);
        });
        return combined;
    }

    function withoutId(record) {
        const data = Object.assign({}, record);
        delete data.id;
        return data;
    }

    // Two serves are the same when they share the date, the role, and the
    // series. A record with no series stored reads as the Sunday Service —
    // seriesIdOf is that answer, and a merge must not restate it.
    function serveKey(record) {
        const row = record || {};
        return String(row.serviceDate) + '_' + (row.type || '') + '_' + events().seriesIdOf(row);
    }

    function prayerDate(record) {
        if (!record) return '';
        return record.serviceDate || record.id || '';
    }

    function refuse(reason) {
        return {
            write: false,
            reason: reason,
            personUpdate: null,
            tags: null,
            copyInvolvement: [],
            deleteInvolvement: [],
            copyPrayers: [],
            deletePrayers: [],
            deletePersonId: null,
            serveCount: null,
            lastPastoralPrayerDate: null,
            keptId: null,
            retiredId: null,
            retiredName: null,
            keptName: null,
            confirmation: null,
        };
    }

    function confirmation(retired, kept) {
        const retiredName = displayName(retired);
        const keptName = displayName(kept);
        return {
            title: 'Confirm Merge',
            warning: 'This action cannot be undone',
            mergingLabel: 'You are merging:',
            mergingName: retiredName,
            survivorLabel: 'Into (Survivor):',
            survivorName: keptName,
            lines: LINES.slice(),
            deleted: 'The record for ' + retiredName + ' will be permanently deleted.',
            cancel: 'Cancel',
            confirm: 'Execute Merge',
        };
    }

    function successMessage(retiredName, keptName) {
        return 'Successfully merged "' + retiredName + '" into "' + keptName + '"';
    }

    function planDirectoryMerge(input) {
        const given = input || {};
        const retired = given.retired;
        const kept = given.kept;
        const retiredId = idOf(retired);
        const keptId = idOf(kept);
        if (!retiredId || !keptId) return refuse('missing');
        if (retiredId === keptId) return refuse('same-person');

        const updates = {};
        ['email', 'phone', 'address'].forEach((key) => {
            const keptValue = contactValue(kept, key);
            const retiredValue = contactValue(retired, key);
            if (!present(keptValue) && present(retiredValue)) {
                updates['contact.' + key] = retiredValue;
            }
        });
        if (!present(kept.birthday) && present(retired.birthday)) {
            updates.birthday = retired.birthday;
        }
        if (!present(kept.sex) && present(retired.sex)) {
            updates.sex = retired.sex;
        }

        const sourceTags = tagList(retired);
        const keptTags = tagList(kept);
        const tags = unionTags(sourceTags, keptTags);
        if (tags.length !== keptTags.length) updates.tags = tags;

        const keptServes = listOf(given.keptInvolvement);
        const haveServe = new Set(keptServes.map(serveKey));
        const copyInvolvement = [];
        const deleteInvolvement = [];
        listOf(given.retiredInvolvement).forEach((record) => {
            if (!record) return;
            const key = serveKey(record);
            if (!haveServe.has(key)) {
                copyInvolvement.push({ data: withoutId(record) });
                haveServe.add(key);
            }
            if (record.id != null && record.id !== '') deleteInvolvement.push(record.id);
        });

        const keptPrayers = listOf(given.keptPrayers);
        const haveSunday = new Set(keptPrayers.map(prayerDate));
        const copyPrayers = [];
        const deletePrayers = [];
        listOf(given.retiredPrayers).forEach((record) => {
            if (!record) return;
            const date = prayerDate(record);
            if (!haveSunday.has(date)) {
                const docId = prayer().historyDocId(date);
                copyPrayers.push({ id: docId, data: withoutId(record) });
                haveSunday.add(date);
            }
            if (record.id != null && record.id !== '') deletePrayers.push(record.id);
        });

        const serveCount = keptServes.length + copyInvolvement.length;
        const historyDates = keptPrayers.map(prayerDate).concat(copyPrayers.map((row) => (
            row.data.serviceDate || row.id
        )));
        const fromHistory = prayer().latestDate(historyDates);
        const lastPastoralPrayerDate = fromHistory || prayer().latestDate([
            kept.lastPastoralPrayerDate,
            retired.lastPastoralPrayerDate,
        ]);

        updates.totalInvolvements = serveCount;
        updates.lastPastoralPrayerDate = lastPastoralPrayerDate;

        return {
            write: true,
            reason: null,
            personUpdate: updates,
            tags: tags,
            copyInvolvement: copyInvolvement,
            deleteInvolvement: deleteInvolvement,
            copyPrayers: copyPrayers,
            deletePrayers: deletePrayers,
            deletePersonId: retiredId,
            serveCount: serveCount,
            lastPastoralPrayerDate: lastPastoralPrayerDate,
            keptId: keptId,
            retiredId: retiredId,
            retiredName: displayName(retired),
            keptName: displayName(kept),
            confirmation: confirmation(retired, kept),
        };
    }

    // Nobody until a name is typed. At most fifteen. Both directory tabs,
    // including someone marked Inactive, and only people this editor can
    // already see. The person being retired is not offered.
    function survivorSearch(people, retiredId, query, user, visibility) {
        const needle = String(query || '').trim().toLowerCase();
        if (!needle) return [];
        const directory = track();
        if (!directory) return [];
        const retired = retiredId == null ? '' : String(retiredId);
        const base = {
            user: user,
            visibility: visibility || {},
            search: '',
            editMode: false,
            chosenTags: [],
        };
        const out = [];
        listOf(people).forEach((candidate) => {
            if (out.length >= SEARCH_LIMIT) return;
            if (!candidate || String(candidate.id) === retired) return;
            const name = String(candidate.name || '').toLowerCase();
            if (name.indexOf(needle) === -1) return;
            const seen = directory.visibleInDirectory(candidate, Object.assign({ tab: 'members' }, base))
                || directory.visibleInDirectory(candidate, Object.assign({ tab: 'non_members' }, base));
            if (!seen) return;
            out.push(candidate);
        });
        return out;
    }

    function offerMerge(user, editModeOn) {
        const gate = edit();
        return !!(editModeOn && gate && gate.mayOfferEditMode(user));
    }

    // Reads both people and both histories through the caller's server reads,
    // then writes exactly the plan. A refusal or a failed read writes nothing.
    function runDirectoryMerge(io, retiredId, keptId) {
        const load = io || {};
        return Promise.all([
            load.loadPerson(retiredId),
            load.loadPerson(keptId),
            load.loadInvolvement(retiredId),
            load.loadInvolvement(keptId),
            load.loadPrayers(retiredId),
            load.loadPrayers(keptId),
        ]).then((parts) => {
            const planned = planDirectoryMerge({
                retired: parts[0],
                kept: parts[1],
                retiredInvolvement: parts[2],
                keptInvolvement: parts[3],
                retiredPrayers: parts[4],
                keptPrayers: parts[5],
            });
            if (!planned.write) {
                return { ok: false, message: MERGE_FAILED, wrote: false };
            }
            return Promise.resolve(load.apply(planned)).then(() => ({
                ok: true,
                message: successMessage(planned.retiredName, planned.keptName),
                wrote: true,
            }));
        }).catch(() => ({ ok: false, message: MERGE_FAILED, wrote: false }));
    }

    // The directory list after a successful merge is read from the server.
    // The copy already on the phone is not that list.
    function markListFromServer() {
        serverList = true;
    }

    function consumeServerList() {
        const on = serverList;
        serverList = false;
        return on;
    }

    const PhoneDirectoryMerge = {
        MERGE_FAILED: MERGE_FAILED,
        SEARCH_LIMIT: SEARCH_LIMIT,
        planDirectoryMerge: planDirectoryMerge,
        confirmation: confirmation,
        successMessage: successMessage,
        survivorSearch: survivorSearch,
        offerMerge: offerMerge,
        runDirectoryMerge: runDirectoryMerge,
        markListFromServer: markListFromServer,
        consumeServerList: consumeServerList,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PhoneDirectoryMerge;
    }
    if (global) {
        global.PhoneDirectoryMerge = PhoneDirectoryMerge;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
