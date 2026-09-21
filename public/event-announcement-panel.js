// Event Announcement panel — the Announcements tab on the event pages (MS-632).
//
// The pure model decides what may be saved and who matches. This is the
// state the two event pages share: a one-off, a repeating event, and one
// date of a repeating event. It does not restate the rules.
//
// Loaded as a classic <script> (window.EventAnnouncementPanel) and exported
// for Node tests.

(function (global) {
    'use strict';

    const Ann = (typeof require !== 'undefined')
        ? require('./event-announcement-core.js')
        : global.EventAnnouncementCore;
    const Store = (typeof require !== 'undefined')
        ? require('./event-announcement-store.js')
        : global.EventAnnouncementStore;

    // `db` is the page's Firestore (a top-level const in auth.js, visible to
    // later classic scripts). Node tests hand one in on the global object.
    function database() {
        if (typeof db !== 'undefined') return db;
        if (typeof globalThis !== 'undefined' && globalThis.db) return globalThis.db;
        return null;
    }

    function placeOf(host) {
        if (host && host.chosen && host.chosen.id && !host.occurrence) {
            return { kind: 'repeating', seriesId: host.chosen.id, onDate: false };
        }
        const occurrence = host && host.occurrence;
        if (!occurrence || !occurrence.id) return null;
        if (!occurrence.seriesId) {
            return { kind: 'one-off', occurrenceId: occurrence.id };
        }
        return {
            kind: 'repeating',
            seriesId: occurrence.seriesId,
            occurrenceId: occurrence.id,
            onDate: true,
        };
    }

    function surfaceOf(host) {
        const place = placeOf(host);
        if (!place) return null;
        if (place.onDate) return 'date';
        if (place.kind === 'one-off') return 'one-off';
        return 'series';
    }

    function seriesIdOf(host) {
        const place = placeOf(host);
        return place && place.seriesId || null;
    }

    function viewerMaySeeHidden(host) {
        const Access = (typeof AccessCore !== 'undefined')
            ? AccessCore
            : (global && global.AccessCore);
        if (!Access) return false;
        return Access.liftsHidden(host.account || host.rank);
    }

    function blankForm() {
        return {
            title: '',
            prose: '',
            way: Ann.PRINTED,
            weeks: 1,
            dates: [{ date: '', time: '08:00' }],
            daysBefore: 0,
            time: '08:00',
            tagIds: [],
            savedTagIds: [],
            order: null,
        };
    }

    function scheduleSentence(item) {
        if (!item || !item.way) return '';
        if (item.way === Ann.PRINTED) {
            const weeks = item.weeks;
            return 'Printed ' + weeks + (weeks === 1 ? ' week' : ' weeks') + ' ahead.';
        }
        if (item.dates && item.dates.length) {
            return 'Told ' + item.dates.map(when => when.date + ' at ' + when.time).join(', ') + '.';
        }
        if (item.daysBefore === 0) return 'Told on the day, at ' + item.time + '.';
        return 'Told ' + item.daysBefore + ' days before each occurrence, at ' + item.time + '.';
    }

    function bindings() {
        return {
            announcements: [],
            announcementForm: null,
            announcementRefusal: '',
            announcementNames: [],
            announcementTagCatalogue: [],
            announcementSaving: false,
            announcementEditingId: null,

            announcementPlace() { return placeOf(this); },

            announcementTab() {
                const surface = surfaceOf(this);
                if (!surface) return { editable: false, showsGoingOut: false, seriesHref: null };
                const locked = !!(this.chosen && this.chosen.locked);
                return Ann.whatTheTabShows({
                    surface,
                    isEditor: !!this.isEditor,
                    seriesId: seriesIdOf(this),
                    locked,
                });
            },

            offeredAnnouncementTags() {
                return Ann.tagsTheEditorMayPick(this.announcementTagCatalogue, {
                    viewerMaySeeHiddenTags: viewerMaySeeHidden(this),
                });
            },

            privateAnnouncementTags() {
                const form = this.announcementForm;
                if (!form) return [];
                const offered = this.offeredAnnouncementTags();
                return Ann.tagsAsShown(form.savedTagIds, offered).filter(tag => tag.private);
            },

            announcementTagChosen(id) {
                const form = this.announcementForm;
                return !!(form && form.tagIds && form.tagIds.indexOf(id) !== -1);
            },

            async loadAnnouncements() {
                const place = placeOf(this);
                if (!place) { this.announcements = []; return; }
                const databaseHandle = database();
                if (!databaseHandle || typeof databaseHandle.collection !== 'function') return;
                if (this.isEditor && !this.announcementTagCatalogue.length) {
                    try {
                        const snap = await databaseHandle.collection('people_tags').get();
                        this.announcementTagCatalogue = snap.docs.map(doc =>
                            Object.assign({ id: doc.id }, doc.data())
                        );
                    } catch (e) {
                        this.announcementTagCatalogue = [];
                    }
                }
                try {
                    this.announcements = await Store.loadAnnouncements(databaseHandle, place, {
                        isEditor: !!this.isEditor,
                    });
                } catch (e) {
                    this.announcements = [];
                }
            },

            startAnnouncement() {
                if (!this.announcementTab().editable) return;
                this.announcementEditingId = null;
                this.announcementRefusal = '';
                this.announcementNames = [];
                this.announcementForm = blankForm();
            },

            editAnnouncement(item) {
                if (!this.announcementTab().editable || !item) return;
                const visible = new Set(this.offeredAnnouncementTags().map(tag => tag.id));
                const saved = (item.tagIds || []).slice();
                this.announcementEditingId = item.id;
                this.announcementRefusal = '';
                this.announcementForm = {
                    title: item.title || '',
                    prose: item.prose || '',
                    way: item.way || Ann.PRINTED,
                    weeks: item.weeks != null ? item.weeks : 1,
                    dates: (item.dates && item.dates.length)
                        ? item.dates.map(when => ({ date: when.date, time: when.time }))
                        : [{ date: '', time: '08:00' }],
                    daysBefore: item.daysBefore != null ? item.daysBefore : 0,
                    time: item.time || '08:00',
                    tagIds: saved.filter(id => visible.has(id)),
                    savedTagIds: saved,
                    order: item.order,
                };
                this.refreshAnnouncementNames();
            },

            cancelAnnouncement() {
                this.announcementForm = null;
                this.announcementEditingId = null;
                this.announcementRefusal = '';
                this.announcementNames = [];
            },

            setAnnouncementWay(way) {
                if (!this.announcementForm) return;
                this.announcementForm.way = way;
                this.announcementRefusal = '';
                this.refreshAnnouncementNames();
            },

            addAnnouncementDate() {
                if (!this.announcementForm) return;
                this.announcementForm.dates.push({ date: '', time: '08:00' });
            },

            removeAnnouncementDate(index) {
                if (!this.announcementForm) return;
                this.announcementForm.dates.splice(index, 1);
            },

            toggleAnnouncementTag(id) {
                const form = this.announcementForm;
                if (!form) return;
                const at = form.tagIds.indexOf(id);
                if (at === -1) form.tagIds.push(id);
                else form.tagIds.splice(at, 1);
                this.refreshAnnouncementNames();
            },

            refreshAnnouncementNames() {
                const form = this.announcementForm;
                if (!form || form.way !== Ann.TOLD) {
                    this.announcementNames = [];
                    return;
                }
                const tagIds = Ann.tagsKept({
                    tagIds: form.tagIds,
                    savedTagIds: form.savedTagIds,
                    visibleTagIds: this.offeredAnnouncementTags().map(tag => tag.id),
                });
                const hiding = new Set(
                    (this.announcementTagCatalogue || [])
                        .filter(tag => tag.hidePeople)
                        .map(tag => tag.id)
                );
                const people = (this.people || []).map(person => ({
                    id: person.id,
                    name: person.name,
                    tags: person.tags || [],
                    membership: person.membership || {},
                    hidden: !!(person.shepherdingHidden
                        || (person.tags || []).some(id => hiding.has(id))),
                }));
                this.announcementNames = Ann.whoWouldBeTold({
                    tagIds,
                    people,
                    viewerMaySeeHidden: viewerMaySeeHidden(this),
                }).names;
            },

            async saveAnnouncement() {
                const place = placeOf(this);
                const form = this.announcementForm;
                if (!place || !form || !this.announcementTab().editable) return;
                const draft = {
                    title: form.title,
                    prose: form.prose,
                    way: form.way,
                    weeks: form.weeks,
                    dates: form.way === Ann.TOLD && place.kind === 'one-off' ? form.dates : [],
                    daysBefore: form.daysBefore,
                    time: form.time,
                    tagIds: form.tagIds,
                    savedTagIds: form.savedTagIds,
                    visibleTagIds: this.offeredAnnouncementTags().map(tag => tag.id),
                };
                this.announcementSaving = true;
                this.announcementRefusal = '';
                try {
                    const result = await Store.saveAnnouncement(database(), place, draft, {
                        id: this.announcementEditingId || undefined,
                        order: form.order,
                        existing: this.announcements,
                    });
                    if (!result.ok) {
                        this.announcementRefusal = result.refusal;
                        return;
                    }
                    this.cancelAnnouncement();
                    await this.loadAnnouncements();
                } catch (e) {
                    this.announcementRefusal = 'That announcement could not be saved.';
                } finally {
                    this.announcementSaving = false;
                }
            },

            async deleteAnnouncement(id) {
                const place = placeOf(this);
                if (!place || !this.announcementTab().editable || !id) return;
                this.announcementSaving = true;
                this.announcementRefusal = '';
                try {
                    const result = await Store.deleteAnnouncement(database(), place, id);
                    if (!result.ok) {
                        this.announcementRefusal = result.refusal;
                        return;
                    }
                    if (this.announcementEditingId === id) this.cancelAnnouncement();
                    await this.loadAnnouncements();
                } catch (e) {
                    this.announcementRefusal = 'That announcement could not be deleted.';
                } finally {
                    this.announcementSaving = false;
                }
            },

            announcementSchedule(item) { return scheduleSentence(item); },
        };
    }

    const EventAnnouncementPanel = {
        bindings,
        placeOf,
        surfaceOf,
        scheduleSentence,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = EventAnnouncementPanel;
    }
    if (global) {
        global.EventAnnouncementPanel = EventAnnouncementPanel;
    }
})(typeof window !== 'undefined' ? window : null);
