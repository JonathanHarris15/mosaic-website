// Event Announcement store — the two records on the event (MS-631).
//
// The words (title, prose, order) are one record, readable by whoever can
// already read the event's standing description. How it goes out — the way,
// when, and the tag ids — is a second record, readable and writable only by
// an editor. Firestore cannot hide a field, which is why these are two
// documents. The pure model decides a draft is savable before anything is
// written.
//
// A repeating event keeps both on the series. A one-off keeps both on its
// occurrence. A date of a series does not get a copy: it reads the series.
//
// Loaded as a classic <script> (window.EventAnnouncementStore) and exported
// for Node tests.

(function (global) {
    'use strict';

    const Ann = (typeof require !== 'undefined')
        ? require('./event-announcement-core.js')
        : global.EventAnnouncementCore;

    const SERIES = 'events';
    const OCCURRENCES = 'event_occurrences';
    const DATE_REFUSAL = 'A date of a repeating event cannot change the announcement. Edit it on the series.';

    function parentRef(db, place) {
        const where = Ann.whereAnnouncementsLive(place);
        if (where.on === 'series') {
            return db.collection(SERIES).doc(place.seriesId);
        }
        return db.collection(OCCURRENCES).doc(place.occurrenceId);
    }

    async function saveAnnouncement(db, place, draft, options) {
        const opts = options || {};
        const where = Ann.whereAnnouncementsLive(place);
        if (!where.writable) return { ok: false, refusal: DATE_REFUSAL };

        const accepted = Ann.accept(Object.assign({}, draft, {
            eventKind: place.kind,
        }));
        if (!accepted.ok) return accepted;

        const id = opts.id || parentRef(db, place).collection(Ann.WORDS).doc().id;
        const order = opts.order != null ? opts.order : Ann.nextOrder(opts.existing || []);
        const records = Ann.recordsOf(accepted.announcement, order);
        const parent = parentRef(db, place);
        const batch = db.batch();
        batch.set(parent.collection(Ann.WORDS).doc(id), records.words);
        batch.set(parent.collection(Ann.GOING_OUT).doc(id), records.goingOut);
        await batch.commit();
        return {
            ok: true,
            id: id,
            order: order,
            announcement: accepted.announcement,
        };
    }

    async function loadAnnouncements(db, place, options) {
        const opts = options || {};
        const where = Ann.whereAnnouncementsLive(place);
        const parent = parentRef(db, place);
        let wordsSnap;
        try {
            wordsSnap = await parent.collection(Ann.WORDS).get();
        } catch (e) {
            // A participant-visibility series is not readable by someone who
            // is only on the roster. They already do not see the standing
            // description, and they do not see the words either.
            if (e && e.code === 'permission-denied') return [];
            throw e;
        }

        const goingOut = {};
        if (opts.isEditor && where.writable) {
            const goingOutSnap = await parent.collection(Ann.GOING_OUT).get();
            goingOutSnap.docs.forEach(doc => { goingOut[doc.id] = doc.data(); });
        }

        return wordsSnap.docs
            .map(doc => Ann.joined(doc.id, doc.data(), goingOut[doc.id] || null))
            .sort((a, b) => {
                const order = (a.order || 0) - (b.order || 0);
                if (order) return order;
                return String(a.id).localeCompare(String(b.id));
            });
    }

    async function deleteAnnouncement(db, place, id) {
        const where = Ann.whereAnnouncementsLive(place);
        if (!where.writable) return { ok: false, refusal: DATE_REFUSAL };
        const parent = parentRef(db, place);
        const batch = db.batch();
        batch.delete(parent.collection(Ann.WORDS).doc(id));
        batch.delete(parent.collection(Ann.GOING_OUT).doc(id));
        await batch.commit();
        return { ok: true };
    }

    const EventAnnouncementStore = {
        saveAnnouncement,
        loadAnnouncements,
        deleteAnnouncement,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = EventAnnouncementStore;
    }
    if (global) {
        global.EventAnnouncementStore = EventAnnouncementStore;
    }
})(typeof window !== 'undefined' ? window : null);
