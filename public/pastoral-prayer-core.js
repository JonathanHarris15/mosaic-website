// Pastoral Prayer Core — the one place that knows how "who was prayed for, and
// when" is stored, updated, and read back.
//
// Being prayed for is recorded twice, on purpose:
//
//   1. THE HISTORY. `people/{id}/pastoral_prayer_history/{serviceDate}` — one
//      doc per Sunday a person was a subject. The doc ID *is* the service date,
//      which is what lets a save address the exact record it means to add or
//      remove without a query. Anything that copies these docs (a merge, a
//      schedule shift) has to carry that ID across or the record is stranded:
//      still counted, but no longer addressable.
//
//   2. THE CACHE. `people/{id}.lastPastoralPrayerDate` — the newest date in the
//      history, denormalized onto the Person so the rotation and the people
//      lists can rank hundreds of members without reading a subcollection each.
//
// The cache is derived; the history is the truth. Four surfaces used to
// recompute the cache by hand and none of them agreed — two wrote `null` for
// "never" and two wrote `'0000-00-00'`, and the Order of Service editor read
// the history *before* committing the write it was supposed to be reading, so
// the person you had just put down for Sunday came back still overdue. Those
// answers live here now, once.
//
// "Never prayed for" is `null`. `'0000-00-00'` is legacy and is normalized away
// on read, so old records keep working until the repair script has run.
//
// Loaded as a classic <script> before the page scripts; IIFE exposes only
// window.PastoralPrayerCore. Also module.exports for Node tests.
(function (global) {
    'use strict';

    const HISTORY_COLLECTION = 'pastoral_prayer_history';

    // The sentinel two of the old write paths used for "never prayed for". Never
    // written now — only recognised, so data already carrying it reads right.
    const LEGACY_NEVER = '0000-00-00';

    const isDateStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

    // A stored `lastPastoralPrayerDate` as this module means it: a real service
    // date, or `null` for never. Anything else — the legacy sentinel, an empty
    // string, a Timestamp somebody wrote by hand — reads as never rather than
    // sorting to the top of the rotation as a date from the year zero.
    function normalizeDate(value) {
        if (!isDateStr(value) || value === LEGACY_NEVER) return null;
        return value;
    }

    // True when this person has ever been a pastoral-prayer subject.
    function wasPrayedFor(value) {
        return normalizeDate(value) !== null;
    }

    // The doc ID for a history record. The ID is the date, so the same Sunday
    // can never be recorded twice for one person and a removal can address the
    // record directly.
    function historyDocId(serviceDate) {
        return isDateStr(serviceDate) ? serviceDate : null;
    }

    // The stored shape of a history record. `createdAt` is added by the caller,
    // which is the only side that has a server timestamp to hand.
    function historyRecord(serviceDate) {
        return { serviceDate: serviceDate };
    }

    // The newest date in a set of history dates, or null if there are none.
    // Dates are 'YYYY-MM-DD' strings and compare lexicographically, which is
    // valid because the format sorts chronologically.
    //
    // Future dates count. A Sunday six weeks out is already a commitment to pray
    // for that person, so the rotation must stop offering them — which is why
    // this is the newest date and not the newest *past* date.
    function latestDate(dates) {
        let latest = null;
        (dates || []).forEach(d => {
            const date = normalizeDate(d);
            if (date && (latest === null || date > latest)) latest = date;
        });
        return latest;
    }

    // What `lastPastoralPrayerDate` should become once this save lands: the
    // person's existing history dates, with `serviceDate` added or taken away
    // according to whether they are a subject of that service after the edit.
    //
    // This is what lets the cache be written in the same batch as the history
    // change instead of after it. Reading the history and hoping it already
    // reflects an uncommitted batch is what broke the editor.
    function nextLastPrayerDate(existingDates, serviceDate, isSubject) {
        const dates = (existingDates || []).map(normalizeDate).filter(Boolean)
            .filter(d => d !== serviceDate);
        if (isSubject && isDateStr(serviceDate)) dates.push(serviceDate);
        return latestDate(dates);
    }

    // The one label every surface shows for "when were they last prayed for".
    function lastPrayedLabel(value) {
        const date = normalizeDate(value);
        return date ? `Last: ${date}` : 'Never prayed for';
    }

    // The two pastoral-prayer subjects on a Sunday. Empty slots are absent.
    // The same person in both slots is one subject.
    function subjectIds(sunday) {
        const ids = [];
        ['prayerMaleId', 'prayerFemaleId'].forEach(key => {
            const id = sunday && sunday[key];
            if (typeof id === 'string' && id && ids.indexOf(id) === -1) ids.push(id);
        });
        return ids;
    }

    // Every subject on either Sunday, once. The calendar and the decision both
    // need this list before they read history.
    function pastoralSubjectIds(loadedSunday, savedSunday) {
        return subjectIds(loadedSunday).concat(subjectIds(savedSunday))
            .filter((id, index, all) => all.indexOf(id) === index);
    }

    // A stored Service document: nested liturgy, or a slot left under the old
    // dotted field name. Names are for the repair log; the ids are what the
    // decision uses.
    function subjectsFromStoredService(date, data) {
        const raw = data || {};
        const liturgy = (raw.liturgy && typeof raw.liturgy === 'object') ? raw.liturgy : {};
        const slot = (field) => {
            let value = liturgy[field];
            if (!value && raw['liturgy.' + field]) value = raw['liturgy.' + field];
            if (!value || typeof value !== 'object') return { id: null, name: '' };
            const id = (typeof value.id === 'string' && value.id) ? value.id : null;
            return { id: id, name: value.name || '' };
        };
        const male = slot('prayerMale');
        const female = slot('prayerFemale');
        return {
            date: date,
            prayerMaleId: male.id,
            prayerMaleName: male.name,
            prayerFemaleId: female.id,
            prayerFemaleName: female.name,
        };
    }

    function storedDates(historyByPerson, personId) {
        const raw = historyByPerson && historyByPerson[personId];
        if (!Array.isArray(raw)) return [];
        return raw.map(normalizeDate).filter(Boolean);
    }

    // Who gains a history doc, who loses one, and what each cached date becomes,
    // for the Sunday a save is about to write (`savedSunday`) compared with the
    // Sunday that was on the page when editing started (`loadedSunday`).
    //
    // `historyByPerson` maps a person id to the service dates already stored.
    // The doc id is that date, so a date in the list means the doc exists and
    // must be left alone — an existing record keeps the time it was first
    // written. A subject on the saved Sunday whose date is missing still gets
    // the doc, even when their id did not change. A subject who was on the
    // loaded Sunday and is not on the saved one loses that date.
    //
    // The cached date is the newest stored date after that add or remove.
    // A Sunday still ahead counts.
    function decidePastoralPrayerSave(loadedSunday, savedSunday, historyByPerson) {
        const serviceDate = historyDocId(savedSunday && savedSunday.date);
        if (!serviceDate) return { records: [], caches: [] };

        const loaded = subjectIds(loadedSunday);
        const saved = subjectIds(savedSunday);
        const people = pastoralSubjectIds(loadedSunday, savedSunday);
        people.sort();

        const records = [];
        const caches = [];
        people.forEach(personId => {
            const dates = storedDates(historyByPerson, personId);
            const hasSunday = dates.indexOf(serviceDate) !== -1;
            const isSubject = saved.indexOf(personId) !== -1;
            const wasSubject = loaded.indexOf(personId) !== -1;
            let change = null;
            if (isSubject && !hasSunday) change = 'add';
            else if (!isSubject && wasSubject) change = 'remove';
            if (!change) return;
            records.push({ personId: personId, serviceDate: serviceDate, change: change });
            caches.push({
                personId: personId,
                lastPastoralPrayerDate: nextLastPrayerDate(dates, serviceDate, isSubject),
            });
        });
        return { records: records, caches: caches };
    }

    // Person ids the history read still has to cover before the save can decide.
    function unreadSubjectIds(loadedSunday, savedSunday, historyByPerson) {
        return pastoralSubjectIds(loadedSunday, savedSunday)
            .filter(id => !historyByPerson || !Object.prototype.hasOwnProperty.call(historyByPerson, id));
    }

    // Read stored history, then take the Sunday as it stands. A subject chosen
    // while that read was in flight is on the Sunday returned here, and their
    // history has been read, so the Service write and the history write name
    // the same people. A subject chosen during the last read is not taken —
    // the page still has them as unsaved, and the next save writes them.
    //
    // `loadLive` returns `{ prayerMaleId, prayerFemaleId }` for the Sunday on
    // the page right now. `readHistory(personIds)` resolves to
    // `{ [personId]: serviceDate[] }`.
    async function takeSundayAfterHistoryRead(loadedSunday, loadLive, readHistory) {
        const stored = {};
        let chosen = null;
        for (let pass = 0; pass < 4; pass++) {
            const live = loadLive();
            const missing = unreadSubjectIds(loadedSunday, live, stored);
            if (missing.length === 0) {
                chosen = live;
                break;
            }
            Object.assign(stored, await readHistory(missing));
        }
        if (!chosen) {
            chosen = loadLive();
            const missing = unreadSubjectIds(loadedSunday, chosen, stored);
            if (missing.length) Object.assign(stored, await readHistory(missing));
        }
        const saved = chosen || {};
        return {
            savedSunday: {
                date: (loadedSunday && loadedSunday.date) || saved.date || null,
                prayerMaleId: saved.prayerMaleId || null,
                prayerFemaleId: saved.prayerFemaleId || null,
            },
            historyByPerson: stored,
        };
    }

    // Put the decision into one batch: history doc and cached date together.
    // `people` is the people collection. `createdAt` is the server timestamp
    // for a new history doc; an existing doc is not rewritten, so the time it
    // was first written stays.
    function writePastoralPrayerDecision(batch, people, decision, createdAt) {
        (decision.records || []).forEach(record => {
            const ref = people.doc(record.personId)
                .collection(HISTORY_COLLECTION)
                .doc(historyDocId(record.serviceDate));
            if (record.change === 'add') {
                const data = historyRecord(record.serviceDate);
                if (createdAt !== undefined) data.createdAt = createdAt;
                batch.set(ref, data);
            } else if (record.change === 'remove') {
                batch.delete(ref);
            }
        });
        (decision.caches || []).forEach(cache => {
            batch.update(people.doc(cache.personId), {
                lastPastoralPrayerDate: cache.lastPastoralPrayerDate,
            });
        });
    }

    // History docs a repair should create from Service slots, and the cached
    // date each of those people should then hold. A slot that already has a
    // history doc is not a create. A Sunday still ahead is included. The
    // cached date is the newest date once every create for that person is in.
    function planPastoralPrayerRepair(services, historyByPerson) {
        const adds = [];
        (services || []).forEach(service => {
            const sunday = {
                date: service.date,
                prayerMaleId: service.prayerMaleId || null,
                prayerFemaleId: service.prayerFemaleId || null,
            };
            const names = {};
            if (sunday.prayerMaleId) names[sunday.prayerMaleId] = service.prayerMaleName || '';
            if (sunday.prayerFemaleId) names[sunday.prayerFemaleId] = service.prayerFemaleName || '';
            const decision = decidePastoralPrayerSave(sunday, sunday, historyByPerson);
            decision.records.forEach(record => {
                if (record.change !== 'add') return;
                adds.push({
                    personId: record.personId,
                    name: names[record.personId] || '',
                    serviceDate: record.serviceDate,
                });
            });
        });

        const addedDates = {};
        adds.forEach(add => {
            (addedDates[add.personId] = addedDates[add.personId] || []).push(add.serviceDate);
        });
        const caches = Object.keys(addedDates).sort().map(personId => ({
            personId: personId,
            lastPastoralPrayerDate: latestDate(
                storedDates(historyByPerson, personId).concat(addedDates[personId])),
        }));
        return { adds: adds, caches: caches };
    }

    const PastoralPrayerCore = {
        HISTORY_COLLECTION,
        LEGACY_NEVER,
        normalizeDate,
        wasPrayedFor,
        historyDocId,
        historyRecord,
        latestDate,
        nextLastPrayerDate,
        lastPrayedLabel,
        decidePastoralPrayerSave,
        pastoralSubjectIds,
        subjectsFromStoredService,
        takeSundayAfterHistoryRead,
        writePastoralPrayerDecision,
        planPastoralPrayerRepair,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PastoralPrayerCore;
    }
    if (global) {
        global.PastoralPrayerCore = PastoralPrayerCore;
    }
})(typeof window !== 'undefined' ? window : null);
