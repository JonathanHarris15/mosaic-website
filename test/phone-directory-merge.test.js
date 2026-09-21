const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-619 / MS-647 — the phone Membership Directory's plan for a directory
// merge. Nothing here renders a phone. The person page asks this plan, then
// writes what it describes with the same documents the computer merge writes.

require('../public/access-core.js');
require('../public/phone-directory-edit.js');
const Shepherding = require('../public/shepherding-core.js');
global.ShepherdingCore = Shepherding;
const Track = require('../public/phone-directory-track.js');
global.PhoneDirectoryTrack = Track;
const Events = require('../public/events-core.js');
global.EventsCore = Events;
const Prayer = require('../public/pastoral-prayer-core.js');
global.PastoralPrayerCore = Prayer;
const Merge = require('../public/phone-directory-merge.js');

const editor = { permissionLevel: 'editor' };
const admin = { permissionLevel: 'admin' };
const elder = { permissionLevel: 'elder' };
const superAdmin = { permissionLevel: 'super_admin' };
const member = { permissionLevel: 'member' };
const assistant = { permissionLevel: 'member', pastoralAssistant: true };

const LINES = [
    'All involvement history will be moved.',
    'All pastoral prayer history will be moved.',
    'Tags from both will be combined.',
    'Missing contact info will be filled from the duplicate.',
];

const FILL_KEYS = ['contact.email', 'contact.phone', 'contact.address', 'birthday', 'sex'];
const COUNT_KEYS = ['totalInvolvements', 'lastPastoralPrayerDate'];
const ALLOWED_UPDATE_KEYS = FILL_KEYS.concat(['tags']).concat(COUNT_KEYS);

function person(over) {
    return Object.assign({
        id: 'p',
        name: 'Ada Lovelace',
        contact: { email: '', phone: '', address: '' },
        birthday: '',
        sex: '',
        tags: [],
        kid: false,
        photoUrl: null,
        membership: { stage: 'visitor', inactive: false },
        lastPastoralPrayerDate: null,
        userId: null,
        shepherdingHidden: false,
    }, over);
}

function serve(id, date, type, seriesId) {
    const row = { id: id, serviceDate: date, type: type };
    if (seriesId) row.seriesId = seriesId;
    return row;
}

function prayer(date, extra) {
    return Object.assign({ id: date, serviceDate: date }, extra || {});
}

function plan(retired, kept, histories) {
    const h = histories || {};
    return Merge.planDirectoryMerge({
        retired: retired,
        kept: kept,
        retiredInvolvement: h.retiredInvolvement || [],
        keptInvolvement: h.keptInvolvement || [],
        retiredPrayers: h.retiredPrayers || [],
        keptPrayers: h.keptPrayers || [],
    });
}

function assertNoIdentity(update) {
    const keys = Object.keys(update);
    keys.forEach((key) => {
        assert.ok(ALLOWED_UPDATE_KEYS.indexOf(key) !== -1, key);
    });
    assert.equal(Object.prototype.hasOwnProperty.call(update, 'name'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(update, 'kid'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(update, 'photoUrl'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(update, 'membership'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(update, 'membership.stage'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(update, 'userId'), false);
}

test('a blank email, phone, address, birthday, or sex is filled from the retired record', () => {
    const retired = person({
        id: 'old',
        name: 'Ada Duplicate',
        contact: { email: 'ada@church.org', phone: '555-0100', address: '1 High Street' },
        birthday: '1815-12-10',
        sex: 'female',
        kid: true,
        photoUrl: 'https://photos.example/ada.jpg',
        membership: { stage: 'member', inactive: false },
        userId: 'user-old',
    });
    const kept = person({
        id: 'keep',
        name: 'Ada Lovelace',
        contact: {},
        birthday: '',
        sex: '',
        kid: false,
        photoUrl: null,
        membership: { stage: 'visitor', inactive: false },
    });
    const merged = plan(retired, kept);
    assert.equal(merged.write, true);
    assert.equal(merged.personUpdate['contact.email'], 'ada@church.org');
    assert.equal(merged.personUpdate['contact.phone'], '555-0100');
    assert.equal(merged.personUpdate['contact.address'], '1 High Street');
    assert.equal(merged.personUpdate.birthday, '1815-12-10');
    assert.equal(merged.personUpdate.sex, 'female');
    assertNoIdentity(merged.personUpdate);
    assert.equal(merged.personUpdate.kid, undefined);
    assert.equal(merged.personUpdate.photoUrl, undefined);
    assert.equal(merged.keptId, 'keep');
    assert.equal(merged.retiredId, 'old');
    assert.equal(merged.deletePersonId, 'old');
});

test('a value the survivor already has stays, including when the retired record disagrees', () => {
    const retired = person({
        id: 'old',
        contact: { email: 'old@church.org', phone: '111', address: 'Old Road' },
        birthday: '1800-01-01',
        sex: 'male',
    });
    const kept = person({
        id: 'keep',
        contact: { email: 'kept@church.org', phone: '222', address: 'Kept Road' },
        birthday: '1815-12-10',
        sex: 'female',
    });
    const merged = plan(retired, kept);
    assert.equal(merged.write, true);
    FILL_KEYS.forEach((key) => {
        assert.equal(Object.prototype.hasOwnProperty.call(merged.personUpdate, key), false, key);
    });
});

test('a blank is an empty value, and a value already stored stays', () => {
    const retired = person({
        id: 'old',
        contact: { email: 'old@church.org', phone: '111', address: 'Old Road' },
        birthday: '1800-01-01',
        sex: 'male',
    });
    const kept = person({
        id: 'keep',
        contact: { email: ' ', phone: null, address: undefined },
        birthday: null,
        sex: 'female',
    });
    const merged = plan(retired, kept);
    assert.equal(merged.personUpdate['contact.email'], undefined);
    assert.equal(merged.personUpdate['contact.phone'], '111');
    assert.equal(merged.personUpdate['contact.address'], 'Old Road');
    assert.equal(merged.personUpdate.birthday, '1800-01-01');
    assert.equal(merged.personUpdate.sex, undefined);
});

test('name, Kid mark, Directory Photo, and Membership Stage are not taken from the retired record', () => {
    const retired = person({
        id: 'old',
        name: 'Other Name',
        kid: true,
        photoUrl: 'https://photos.example/other.jpg',
        membership: { stage: 'member', inactive: true },
        tags: ['Member'],
    });
    const kept = person({
        id: 'keep',
        name: 'Kept Name',
        kid: false,
        photoUrl: '',
        membership: { stage: 'visitor', inactive: false },
        tags: [],
    });
    const merged = plan(retired, kept);
    assert.equal(merged.personUpdate.name, undefined);
    assert.equal(merged.personUpdate.kid, undefined);
    assert.equal(merged.personUpdate.photoUrl, undefined);
    assert.equal(merged.personUpdate.membership, undefined);
    assert.equal(merged.personUpdate['membership.stage'], undefined);
    assert.equal(merged.personUpdate['membership.inactive'], undefined);
    assert.deepStrictEqual(merged.tags, ['Member']);
    assert.deepStrictEqual(merged.personUpdate.tags, ['Member']);
});

test('tags are the combination of both records, including a tag the system sets, and the stage is unchanged', () => {
    const retired = person({
        id: 'old',
        tags: ['Elder', 'Choir'],
        membership: { stage: 'member', inactive: false },
    });
    const kept = person({
        id: 'keep',
        tags: ['Member', 'Choir'],
        membership: { stage: 'visitor', inactive: false },
    });
    const merged = plan(retired, kept);
    assert.deepStrictEqual(merged.tags, ['Elder', 'Choir', 'Member']);
    assert.deepStrictEqual(merged.personUpdate.tags, ['Elder', 'Choir', 'Member']);
    assert.equal(merged.personUpdate.membership, undefined);
    assert.equal(merged.personUpdate['membership.stage'], undefined);
    assert.equal(Shepherding.isProjectedTagId('Elder'), true);
    assert.equal(Shepherding.isProjectedTagId('Member'), true);
    assert.ok(merged.tags.indexOf('Elder') !== -1);
    assert.ok(merged.tags.indexOf('Member') !== -1);
});

test('tags already on the survivor are not rewritten when the retired record adds none', () => {
    const retired = person({ id: 'old', tags: ['Choir'] });
    const kept = person({ id: 'keep', tags: ['Choir', 'Member'] });
    const merged = plan(retired, kept);
    assert.deepStrictEqual(merged.tags, ['Choir', 'Member']);
    assert.equal(merged.personUpdate.tags, undefined);
});

test('an Involvement is copied only when the survivor lacks that date, role, and series', () => {
    const retiredServes = [
        serve('r1', '2024-01-07', 'piano', 'sunday_service'),
        serve('r2', '2024-01-14', 'piano', 'sunday_service'),
        serve('r3', '2024-01-07', 'drums', 'sunday_service'),
    ];
    const keptServes = [
        serve('k1', '2024-01-07', 'piano', 'sunday_service'),
    ];
    const merged = plan(person({ id: 'old' }), person({ id: 'keep' }), {
        retiredInvolvement: retiredServes,
        keptInvolvement: keptServes,
    });
    assert.equal(merged.copyInvolvement.length, 2);
    assert.deepStrictEqual(
        merged.copyInvolvement.map((row) => row.data.serviceDate + ' ' + row.data.type),
        ['2024-01-14 piano', '2024-01-07 drums'],
    );
    merged.copyInvolvement.forEach((row) => {
        assert.equal(row.id, undefined);
        assert.equal(row.data.id, undefined);
    });
    assert.deepStrictEqual(merged.deleteInvolvement, ['r1', 'r2', 'r3']);
    assert.equal(merged.serveCount, 3);
    assert.equal(merged.personUpdate.totalInvolvements, 3);
});

test('a serve with no series stored matches the Sunday Service', () => {
    const retiredServes = [serve('r1', '2024-01-07', 'piano')];
    const keptServes = [serve('k1', '2024-01-07', 'piano', 'sunday_service')];
    const merged = plan(person({ id: 'old' }), person({ id: 'keep' }), {
        retiredInvolvement: retiredServes,
        keptInvolvement: keptServes,
    });
    assert.deepStrictEqual(merged.copyInvolvement, []);
    assert.deepStrictEqual(merged.deleteInvolvement, ['r1']);
    assert.equal(merged.serveCount, 1);
    assert.equal(Events.seriesIdOf(retiredServes[0]), 'sunday_service');
});

test('a serve on another series is not the Sunday already on the survivor', () => {
    const merged = plan(person({ id: 'old' }), person({ id: 'keep' }), {
        retiredInvolvement: [serve('r1', '2024-01-07', 'piano', 'midweek')],
        keptInvolvement: [serve('k1', '2024-01-07', 'piano', 'sunday_service')],
    });
    assert.equal(merged.copyInvolvement.length, 1);
    assert.equal(merged.copyInvolvement[0].data.seriesId, 'midweek');
    assert.equal(merged.serveCount, 2);
});

test('a pastoral-prayer Sunday is copied only when the survivor lacks it, and the copy keeps that date', () => {
    const merged = plan(person({ id: 'old' }), person({ id: 'keep' }), {
        retiredPrayers: [
            prayer('2024-01-07', { note: 'kept-sunday' }),
            prayer('2024-02-04', { note: 'new-sunday' }),
        ],
        keptPrayers: [prayer('2024-01-07')],
    });
    assert.equal(merged.copyPrayers.length, 1);
    assert.equal(merged.copyPrayers[0].id, '2024-02-04');
    assert.equal(merged.copyPrayers[0].data.serviceDate, '2024-02-04');
    assert.equal(merged.copyPrayers[0].data.id, undefined);
    assert.equal(merged.copyPrayers[0].data.note, 'new-sunday');
    assert.deepStrictEqual(merged.deletePrayers, ['2024-01-07', '2024-02-04']);
    assert.equal(merged.lastPastoralPrayerDate, '2024-02-04');
    assert.equal(merged.personUpdate.lastPastoralPrayerDate, '2024-02-04');
    assert.equal(Prayer.historyDocId('2024-02-04'), '2024-02-04');
});

test('the last pastoral-prayer date is the later stored date when the history is empty', () => {
    const kept = person({ id: 'keep', lastPastoralPrayerDate: '2020-01-05' });
    const retired = person({ id: 'old', lastPastoralPrayerDate: '2024-06-02' });
    const merged = plan(retired, kept);
    assert.equal(merged.lastPastoralPrayerDate, '2024-06-02');
    assert.equal(merged.personUpdate.lastPastoralPrayerDate, '2024-06-02');

    const laterKept = plan(
        person({ id: 'old', lastPastoralPrayerDate: '2020-01-05' }),
        person({ id: 'keep', lastPastoralPrayerDate: '2024-06-02' }),
    );
    assert.equal(laterKept.lastPastoralPrayerDate, '2024-06-02');

    const neither = plan(
        person({ id: 'old', lastPastoralPrayerDate: '0000-00-00' }),
        person({ id: 'keep', lastPastoralPrayerDate: null }),
    );
    assert.equal(neither.lastPastoralPrayerDate, null);
    assert.equal(neither.personUpdate.lastPastoralPrayerDate, null);
});

test('a history date wins over a stored date, even when the stored date is later', () => {
    const merged = plan(
        person({ id: 'old', lastPastoralPrayerDate: '2025-12-28' }),
        person({ id: 'keep', lastPastoralPrayerDate: null }),
        { keptPrayers: [prayer('2024-01-07')], retiredPrayers: [] },
    );
    assert.equal(merged.lastPastoralPrayerDate, '2024-01-07');
});

test('the serve count ignores the number previously stored on the survivor', () => {
    const kept = person({ id: 'keep', totalInvolvements: 99 });
    const merged = plan(
        person({ id: 'old' }),
        kept,
        {
            retiredInvolvement: [serve('r1', '2024-03-03', 'piano', 'sunday_service')],
            keptInvolvement: [serve('k1', '2024-01-07', 'piano', 'sunday_service')],
        },
    );
    assert.equal(merged.serveCount, 2);
    assert.equal(merged.personUpdate.totalInvolvements, 2);
});

test('the same person, or a record that is missing, is refused and describes no write', () => {
    const one = person({ id: 'same', name: 'Ada' });
    const same = plan(one, person({ id: 'same', name: 'Ada' }));
    assert.equal(same.write, false);
    assert.equal(same.reason, 'same-person');
    assert.equal(same.personUpdate, null);
    assert.deepStrictEqual(same.copyInvolvement, []);
    assert.deepStrictEqual(same.deleteInvolvement, []);
    assert.deepStrictEqual(same.copyPrayers, []);
    assert.deepStrictEqual(same.deletePrayers, []);
    assert.equal(same.deletePersonId, null);

    for (const pair of [
        [null, person({ id: 'keep' })],
        [person({ id: 'old' }), null],
        [null, null],
        [person({ id: '' }), person({ id: 'keep' })],
    ]) {
        const refused = plan(pair[0], pair[1]);
        assert.equal(refused.write, false);
        assert.equal(refused.reason, 'missing');
        assert.equal(refused.personUpdate, null);
        assert.equal(refused.deletePersonId, null);
    }
});

test('the confirmation sentences are the computer\'s', () => {
    const retired = person({ id: 'old', name: 'Ada Duplicate' });
    const kept = person({ id: 'keep', name: 'Ada Lovelace' });
    const words = Merge.confirmation(retired, kept);
    const merged = plan(retired, kept);
    assert.equal(words.title, 'Confirm Merge');
    assert.equal(words.warning, 'This action cannot be undone');
    assert.equal(words.mergingName, 'Ada Duplicate');
    assert.equal(words.survivorName, 'Ada Lovelace');
    assert.deepStrictEqual(words.lines, LINES);
    assert.equal(words.deleted, 'The record for Ada Duplicate will be permanently deleted.');
    assert.equal(words.cancel, 'Cancel');
    assert.equal(words.confirm, 'Execute Merge');
    assert.deepStrictEqual(merged.confirmation, words);
    assert.equal(Merge.successMessage('Ada Duplicate', 'Ada Lovelace'), 'Successfully merged "Ada Duplicate" into "Ada Lovelace"');
    assert.equal(Merge.MERGE_FAILED, 'Merge operation failed');
});

test('the search offers nobody until a name is typed, stops at fifteen, and leaves out the person being retired', () => {
    const people = [];
    for (let i = 0; i < 16; i++) {
        people.push(person({
            id: 'ann' + i,
            name: 'Ann ' + i,
            tags: ['Visitor'],
            membership: { stage: 'visitor', inactive: false },
        }));
    }
    people.push(person({
        id: 'self',
        name: 'Ann Self',
        tags: ['Visitor'],
    }));
    assert.deepStrictEqual(Merge.survivorSearch(people, 'self', '', editor, {}), []);
    assert.deepStrictEqual(Merge.survivorSearch(people, 'self', '   ', editor, {}), []);
    const found = Merge.survivorSearch(people, 'self', 'ann', editor, {});
    assert.equal(found.length, 15);
    assert.deepStrictEqual(found.map((p) => p.id), [
        'ann0', 'ann1', 'ann2', 'ann3', 'ann4', 'ann5', 'ann6', 'ann7',
        'ann8', 'ann9', 'ann10', 'ann11', 'ann12', 'ann13', 'ann14',
    ]);
    assert.equal(found.some((p) => p.id === 'self'), false);
    assert.equal(found.some((p) => p.id === 'ann15'), false);
});

test('the search looks on both tabs, including Inactive, and hides people the directory hides', () => {
    const mia = person({
        id: 'mia',
        name: 'Mia Member',
        tags: ['Member'],
        membership: { stage: 'member', inactive: false },
    });
    const ivy = person({
        id: 'ivy',
        name: 'Ivy Inactive',
        tags: ['Visitor'],
        membership: { stage: 'visitor', inactive: true },
    });
    const hidden = person({
        id: 'hid',
        name: 'Ivy Hidden',
        tags: ['Visitor'],
        shepherdingHidden: true,
    });
    const tagged = person({
        id: 'tag',
        name: 'Ivy Tagged',
        tags: ['secret'],
        membership: { stage: 'visitor', inactive: false },
    });
    const self = person({ id: 'self', name: 'Ivy Self', tags: ['Visitor'] });
    const people = [mia, ivy, hidden, tagged, self];
    const visibility = { hidden: {}, hidePeople: { secret: true } };

    const forEditor = Merge.survivorSearch(people, 'self', 'ivy', editor, visibility);
    assert.deepStrictEqual(forEditor.map((p) => p.id), ['ivy']);

    const members = Merge.survivorSearch(people, 'self', 'mia', editor, visibility);
    assert.deepStrictEqual(members.map((p) => p.id), ['mia']);

    const forElder = Merge.survivorSearch(people, 'self', 'ivy', elder, visibility);
    assert.deepStrictEqual(forElder.map((p) => p.id), ['ivy', 'hid', 'tag']);

    const forMember = Merge.survivorSearch(people, 'self', 'ivy', member, visibility);
    assert.deepStrictEqual(forMember.map((p) => p.id), []);
});

test('Merge is offered in Edit Mode to an editor, admin, elder, or super admin, and to nobody else', () => {
    for (const user of [editor, admin, elder, superAdmin]) {
        assert.equal(Merge.offerMerge(user, true), true, user.permissionLevel);
    }
    assert.equal(Merge.offerMerge(member, true), false);
    assert.equal(Merge.offerMerge(assistant, true), false);
    assert.equal(Merge.offerMerge(editor, false), false);
    assert.equal(Merge.offerMerge(null, true), false);
});
