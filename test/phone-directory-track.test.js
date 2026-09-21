const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

// MS-615 / MS-633 — the phone Membership Directory's plan for a Track move,
// a tag add or remove, and who may see them. Nothing here renders a phone.
// The list and the person page call this plan, then the same writes the
// computer directory already uses.

require('../public/access-core.js');
require('../public/phone-directory-edit.js');
const Shepherding = require('../public/shepherding-core.js');
// shepherding-core.js only attaches itself when a browser window exists.
global.ShepherdingCore = Shepherding;
const Track = require('../public/phone-directory-track.js');

const editor = { permissionLevel: 'editor', uid: 'ed', name: 'Edith' };
const admin = { permissionLevel: 'admin', uid: 'ad', name: 'Ada' };
const elder = { permissionLevel: 'elder', uid: 'el', name: 'Eli' };
const superAdmin = { permissionLevel: 'super_admin', uid: 'sa', name: 'Sam' };
const member = { permissionLevel: 'member', uid: 'me', name: 'Mia' };
const assistant = { permissionLevel: 'member', pastoralAssistant: true, uid: 'pa', name: 'Pat' };

function person(over) {
    return Object.assign({
        id: 'p1',
        name: 'Ada Lovelace',
        membership: { stage: 'visitor', inactive: false },
        tags: ['Visitor'],
        shepherdingHidden: false,
    }, over);
}

test('the phone walks the same six stages, in Track order', () => {
    assert.deepStrictEqual(
        Track.STAGES.map((stage) => Track.STAGE_LABEL[stage]),
        [
            'Visitor',
            'Regular Attender',
            'Prospective Member',
            'Member',
            'Moving Membership',
            'Previous Member',
        ],
    );
});

test('a stage move comes back with Inactive cleared', () => {
    const plan = Track.planTrackMove(
        { stage: 'visitor', inactive: false },
        { kind: 'stage', stage: 'regular_attender' },
    );
    assert.equal(plan.write, true);
    assert.deepStrictEqual(plan.next, { stage: 'regular_attender', inactive: false });
    assert.equal(plan.tags, undefined, 'the plan must not invent a second tag write');
});

test('a stage move from someone already Inactive is refused', () => {
    const plan = Track.planTrackMove(
        { stage: 'member', inactive: true },
        { kind: 'stage', stage: 'previous_member' },
    );
    assert.equal(plan.write, false);
    assert.equal(plan.reason, 'inactive');
    assert.equal(plan.next, undefined);
});

test('showing the slider on someone not yet on the Track does not itself write', () => {
    assert.equal(Track.sliderIndex({ stage: null, inactive: false }), 0);
    assert.equal(Track.sliderMoves({ stage: null, inactive: false }), true);
    assert.equal(Track.sliderMoves({ stage: 'visitor', inactive: true }), false);
});

test('moving that slider onto a stage is the write, and it clears Inactive', () => {
    const plan = Track.planTrackMove(
        { stage: null, inactive: false },
        { kind: 'stage', stage: 'visitor' },
    );
    assert.equal(plan.write, true);
    assert.deepStrictEqual(plan.next, { stage: 'visitor', inactive: false });
});

test('marking Inactive keeps the current stage', () => {
    const plan = Track.planTrackMove(
        { stage: 'prospective_member', inactive: false },
        { kind: 'inactive', inactive: true },
    );
    assert.equal(plan.write, true);
    assert.deepStrictEqual(plan.next, { stage: 'prospective_member', inactive: true });
});

test('clearing Inactive restores that stage', () => {
    const plan = Track.planTrackMove(
        { stage: 'moving_membership', inactive: true },
        { kind: 'inactive', inactive: false },
    );
    assert.equal(plan.write, true);
    assert.deepStrictEqual(plan.next, { stage: 'moving_membership', inactive: false });
});

test('the same stage and the same Inactive flag do not write again', () => {
    const plan = Track.planTrackMove(
        { stage: 'member', inactive: false },
        { kind: 'stage', stage: 'member' },
    );
    assert.equal(plan.write, false);
    assert.equal(plan.reason, 'unchanged');
});

test('the row and the page hand the Track commit the same change', () => {
    const who = person({
        membership: { stage: 'visitor', inactive: true },
        tags: ['Inactive', 'Choir'],
    });
    const plan = Track.planTrackMove(who.membership, { kind: 'inactive', inactive: false });
    const fromRow = Track.directoryTrackWrite(who, editor, plan.next);
    const fromPage = Track.directoryTrackWrite(who, editor, plan.next);
    assert.deepStrictEqual(fromRow, fromPage);
    assert.equal(fromRow.source, Track.SOURCE);
    assert.equal(fromRow.source, 'phone_membership_directory');
    assert.deepStrictEqual(fromRow.previous, { stage: 'visitor', inactive: true });
    assert.deepStrictEqual(fromRow.next, { stage: 'visitor', inactive: false });
    assert.equal(fromRow.authorUid, 'ed');
    assert.equal(fromRow.authorName, 'Edith');
    const echoed = Track.personAfterTrackMove(who, plan.next);
    assert.deepStrictEqual(echoed.membership, { stage: 'visitor', inactive: false });
    assert.deepStrictEqual(
        echoed.tags,
        Shepherding.applyMembershipTags(who.tags, plan.next),
    );
});

test('a Projected Tag is refused on add and on remove', () => {
    const vocabulary = ['Member', 'Elder', 'Inactive', 'Choir'];
    for (const name of ['Member', 'Elder', 'Inactive', 'visitor', 'Moving Membership']) {
        const added = Track.planTagChange(['Choir'], vocabulary, { kind: 'add', name });
        assert.equal(added.write, false, 'add ' + name);
        assert.equal(added.reason, 'projected', 'add ' + name);
        const removed = Track.planTagChange(
            ['Choir', name === 'visitor' ? 'Visitor' : name],
            vocabulary,
            { kind: 'remove', name: name === 'visitor' ? 'Visitor' : name },
        );
        assert.equal(removed.write, false, 'remove ' + name);
        assert.equal(removed.reason, 'projected', 'remove ' + name);
    }
});

test('an existing tag matches without regard to capitals and does not create another', () => {
    const plan = Track.planTagChange(
        ['Visitor'],
        [{ id: 'Choir', name: 'Choir' }],
        { kind: 'add', name: '  choir ' },
    );
    assert.equal(plan.write, true);
    assert.equal(plan.create, null);
    assert.deepStrictEqual(plan.tags, ['Visitor', 'Choir']);
    assert.equal(plan.recordTagChange, false);
});

test('a new name creates that tag and applies it', () => {
    const plan = Track.planTagChange(['Visitor'], ['Choir'], { kind: 'add', name: ' Ushers ' });
    assert.equal(plan.write, true);
    assert.deepStrictEqual(plan.create, { id: 'Ushers', name: 'Ushers' });
    assert.deepStrictEqual(plan.tags, ['Visitor', 'Ushers']);
    assert.equal(plan.recordTagChange, false);
    assert.equal(plan.deleteFromVocabulary, false);
});

test('a tag the person already has changes nothing', () => {
    const plan = Track.planTagChange(['Choir'], ['Choir'], { kind: 'add', name: 'Choir' });
    assert.equal(plan.write, false);
    assert.equal(plan.reason, 'already');
    assert.equal(plan.recordTagChange, false);
});

test('removing a tag takes it off the person and leaves the vocabulary', () => {
    const plan = Track.planTagChange(['Visitor', 'Choir'], ['Visitor', 'Choir'], { kind: 'remove', name: 'Choir' });
    assert.equal(plan.write, true);
    assert.deepStrictEqual(plan.tags, ['Visitor']);
    assert.equal(plan.create, null);
    assert.equal(plan.deleteFromVocabulary, false);
    assert.equal(plan.recordTagChange, false);
});

test('a blank tag name is refused', () => {
    for (const name of ['', '   ', null]) {
        const plan = Track.planTagChange([], [], { kind: 'add', name });
        assert.equal(plan.write, false, JSON.stringify(name));
        assert.equal(plan.reason, 'blank');
    }
});

test('an editor matches an Inactive person on the Non-members tab only', () => {
    const inactive = person({
        membership: { stage: 'member', inactive: true },
        tags: ['Inactive'],
    });
    assert.equal(Track.matchesDirectoryTab(inactive, 'non_members', editor), true);
    assert.equal(Track.matchesDirectoryTab(inactive, 'members', editor), false);
    assert.equal(Track.matchesDirectoryTab(inactive, 'non_members', admin), true);
    assert.equal(Track.matchesDirectoryTab(inactive, 'non_members', elder), true);
    assert.equal(Track.matchesDirectoryTab(inactive, 'non_members', superAdmin), true);
});

test('a member matches an Inactive person on neither tab', () => {
    const inactive = person({
        membership: { stage: 'member', inactive: true },
        tags: ['Inactive'],
    });
    assert.equal(Track.matchesDirectoryTab(inactive, 'members', member), false);
    assert.equal(Track.matchesDirectoryTab(inactive, 'non_members', member), false);
    assert.equal(Track.matchesDirectoryTab(inactive, 'members', assistant), false);
    assert.equal(Track.matchesDirectoryTab(inactive, 'non_members', assistant), false);
});

test('an editor reads the stage or Inactive; a member reads only Member or Non-member', () => {
    const visitor = person({ membership: { stage: 'visitor', inactive: false } });
    const inactive = person({ membership: { stage: 'member', inactive: true }, tags: ['Inactive'] });
    const unset = person({ membership: { stage: null, inactive: false }, tags: [] });
    const onTrack = person({ membership: { stage: 'member', inactive: false }, tags: ['Member'] });
    assert.equal(Track.directoryLabel(visitor, editor), 'Visitor');
    assert.equal(Track.directoryLabel(inactive, editor), 'Inactive');
    assert.equal(Track.directoryLabel(unset, editor), 'Not on the Track');
    assert.equal(Track.directoryLabel(onTrack, member), 'Member');
    assert.equal(Track.directoryLabel(visitor, member), 'Non-member');
    assert.equal(Track.directoryLabel(inactive, assistant), 'Non-member');
    assert.equal(Track.directoryLabel(onTrack, assistant), 'Member');
});

test('a member and a Pastoral Assistant are not offered the Track or tag controls', () => {
    assert.equal(Track.offerEdits(member, true), false);
    assert.equal(Track.offerEdits(assistant, true), false);
    assert.equal(Track.offerEdits(member, false), false);
});

test('an editor is offered the Track and tag controls only while Edit Mode is on', () => {
    for (const user of [editor, admin, elder, superAdmin]) {
        assert.equal(Track.offerEdits(user, false), false, user.permissionLevel);
        assert.equal(Track.offerEdits(user, true), true, user.permissionLevel);
    }
});

test('choosing two tags keeps only a person who carries both', () => {
    const both = person({ tags: ['Choir', 'Ushers', 'Visitor'] });
    const one = person({ tags: ['Choir', 'Visitor'] });
    assert.equal(Track.carriesEveryChosenTag(both, ['Choir', 'Ushers']), true);
    assert.equal(Track.carriesEveryChosenTag(one, ['Choir', 'Ushers']), false);
    assert.equal(Track.carriesEveryChosenTag(one, []), true);
});

test('the list still has to match the tab and the search, and Edit Mode off drops the tags', () => {
    const ada = person({ name: 'Ada Lovelace', tags: ['Visitor', 'Choir'] });
    const grace = person({ id: 'p2', name: 'Grace Hopper', tags: ['Visitor', 'Choir', 'Ushers'] });
    const opts = {
        tab: 'non_members',
        search: 'ada',
        chosenTags: ['Choir'],
        editMode: true,
        user: editor,
        visibility: { hidePeople: {} },
    };
    assert.equal(Track.visibleInDirectory(ada, opts), true);
    assert.equal(Track.visibleInDirectory(grace, opts), false);
    assert.equal(Track.visibleInDirectory(ada, Object.assign({}, opts, { tab: 'members' })), false);
    assert.equal(
        Track.visibleInDirectory(ada, Object.assign({}, opts, { editMode: false, chosenTags: ['Ushers'] })),
        true,
    );
    assert.deepStrictEqual(Track.chosenTagsWhen(false, ['Choir']), []);
    assert.deepStrictEqual(Track.chosenTagsWhen(true, ['Choir']), ['Choir']);
});

test('a hiding tag and a hidden person stay hidden from an editor who does not read as an elder', () => {
    const hidden = person({ tags: ['Visitor', 'Private'], shepherdingHidden: false });
    const flagged = person({ id: 'p2', tags: ['Visitor'], shepherdingHidden: true });
    const visibility = { hidePeople: { Private: true }, hidden: { Private: true } };
    assert.equal(Track.personHiddenFrom(hidden, editor, visibility), true);
    assert.equal(Track.personHiddenFrom(flagged, admin, visibility), true);
    assert.equal(Track.personHiddenFrom(hidden, elder, visibility), false);
    assert.equal(Track.personHiddenFrom(flagged, superAdmin, visibility), false);
    assert.equal(Track.personHiddenFrom(hidden, assistant, visibility), false);
});

test('a tag hidden from non-elders is offered to an elder and not to an editor', () => {
    const vocabulary = [
        { id: 'Choir', name: 'Choir', hiddenFromOthers: false },
        { id: 'Private', name: 'Private', hiddenFromOthers: true },
        { id: 'Member', name: 'Member', hiddenFromOthers: false },
    ];
    const forEditor = Track.tagsOffered(vocabulary, editor).map((tag) => tag.id);
    const forElder = Track.tagsOffered(vocabulary, elder).map((tag) => tag.id);
    assert.deepStrictEqual(forEditor, ['Choir', 'Member']);
    assert.deepStrictEqual(forElder, ['Choir', 'Private', 'Member']);
    assert.equal(Track.tagLocked('Member'), true);
    assert.equal(Track.tagLocked('Elder'), true);
    assert.equal(Track.tagLocked('Choir'), false);
});

test('a failed save tells the editor, in words, that it did not work', () => {
    assert.match(Track.TRACK_FAILED, /did not work/);
    assert.match(Track.TAG_FAILED, /did not work/);
});

test('a tag hidden from non-elders stays off an editor, and a Projected Tag stays visible', () => {
    const visibility = { hidden: { Private: true } };
    assert.equal(Track.tagVisible('Private', editor, visibility), false);
    assert.equal(Track.tagVisible('Private', elder, visibility), true);
    assert.equal(Track.tagVisible('Private', assistant, visibility), true);
    assert.equal(Track.tagVisible('Member', editor, visibility), true);
    assert.equal(Track.tagVisible('Elder', member, visibility), true);
    assert.equal(Track.tagVisible('Choir', editor, visibility), true);
    assert.equal(Track.tagVisible('Private', editor, { hidden: {} }, false), false);
    assert.equal(Track.tagVisible('Choir', editor, { hidden: {} }, false), false);
    assert.equal(Track.tagVisible('Member', editor, { hidden: {} }, false), true);
    assert.equal(Track.tagVisible('Private', elder, { hidden: {} }, false), true);
});

test('a tag chip says the vocabulary name, not a different id', () => {
    assert.equal(Track.tagLabel('abc', [{ id: 'abc', name: 'Choir' }]), 'Choir');
    assert.equal(Track.tagLabel('Choir', ['Choir']), 'Choir');
    assert.equal(Track.tagLabel('Ushers', []), 'Ushers');
});

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fnBody(src, name) {
    const at = src.indexOf('function ' + name + '(');
    assert.notEqual(at, -1, name + ' is missing');
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(at, i + 1);
        }
    }
    assert.fail('unclosed ' + name);
}

test('the phone loads the Track plan after Edit Mode', () => {
    const html = read('public/mobile.html');
    const editAt = html.indexOf('phone-directory-edit.js');
    const trackAt = html.indexOf('phone-directory-track.js');
    assert.ok(editAt !== -1 && trackAt > editAt);
});

test('the list and the person page share one slider and one tag control, without a hover', () => {
    const src = read('public/mobile/screens-content.js');
    const list = fnBody(src, 'PeopleScreen');
    const page = fnBody(src, 'PersonDetailScreen');
    const track = fnBody(src, 'DirectoryTrack');
    const tags = fnBody(src, 'DirectoryTags');
    const move = fnBody(src, 'saveDirectoryTrack');
    for (const surface of [list, page]) {
        assert.match(surface, /<\$\{DirectoryTrack\}/);
        assert.match(surface, /<\$\{DirectoryTags\}/);
    }
    assert.match(track, /aria-label="Membership Track"/);
    assert.match(track, /Mark inactive/);
    assert.match(track, /sliderMoves/);
    assert.match(list, /offerEdits\(props\.user, modeS\[0\]\)/);
    assert.match(page, /offerEdits\(props\.user, editFlagS\[0\]\)/);
    assert.match(fnBody(src, 'DirectoryTags'), /tagLabel/);
    assert.match(fnBody(src, 'DirectoryTags'), /tagsReady/);
    assert.equal(track.includes('hover'), false);
    assert.match(tags, /aria-label="Add a tag"/);
    assert.match(tags, /tagLocked/);
    assert.match(tags, /Remove /);
    assert.equal(tags.includes('hover'), false);
    assert.match(move, /planTrackMove/);
    assert.match(move, /directoryTrackWrite/);
    assert.match(move, /saveDirectoryMembership/);
    assert.match(list, /visibleInDirectory/);
    assert.equal(list.includes('personMatchesDirectoryTab(p, tab, false)'), false);
    assert.match(list, /if \(!on\) chosenS\[1\]\(\[\]\)/);
    assert.match(fnBody(src, 'saveDirectoryTag'), /planTagChange/);
    assert.match(fnBody(src, 'saveDirectoryTag'), /saveDirectoryTags/);
});

test('a phone Track move uses the existing commit, and a tag edit writes no Tag Change', () => {
    const data = read('public/mobile/data.js');
    const membership = fnBody(data, 'saveDirectoryMembership');
    const tags = fnBody(data, 'saveDirectoryTags');
    assert.match(membership, /commitMembershipChange/);
    assert.match(membership, /source: write\.source/);
    assert.equal(membership.includes('buildTagChange'), false);
    assert.match(tags, /people_tags/);
    assert.equal(tags.includes('buildTagChange'), false);
    assert.equal(tags.includes('commitPastoralChange'), false);
    assert.equal(tags.includes('shepherding_activity'), false);
    assert.equal(tags.includes('.delete('), false);
});
