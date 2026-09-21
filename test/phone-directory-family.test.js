const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-616 / MS-637 — the phone Membership Directory's plan for a Family edit.
// Nothing here renders a phone. The person page calls this plan, then the
// same Family create and update Shepherding already uses.

require('../public/access-core.js');
require('../public/phone-directory-edit.js');
const Family = require('../public/family-core.js');
global.FamilyCore = Family;
const Fam = require('../public/phone-directory-family.js');

const SEX_UNSET = "Set this person's sex in Edit Details to build their family.";
const SPOUSE_REMOVAL = 'End the marriage record for these two? Each keeps their own record.';

const editor = { permissionLevel: 'editor' };
const admin = { permissionLevel: 'admin' };
const elder = { permissionLevel: 'elder' };
const superAdmin = { permissionLevel: 'super_admin' };
const member = { permissionLevel: 'member' };
const assistant = { permissionLevel: 'member', pastoralAssistant: true };

function person(id, name, sex) {
    return { id: id, name: name, sex: sex };
}

const adam = person('adam', 'Adam West', 'male');
const ada = person('ada', 'Ada Lovelace', 'female');
const ben = person('ben', 'Ben West', 'male');
const bea = person('bea', 'Bea West', 'female');
const cara = person('cara', 'Cara Other', 'female');
const carl = person('carl', 'Carl Other', 'male');
const willa = person('willa', 'Willa Widow', 'female');
const otto = person('otto', 'Otto Orphan', 'male');
const una = person('una', 'Una Unset', null);
const leo = person('leo', 'Leo Loner', 'male');
const ned = person('ned', 'Ned New', 'male');

const people = [adam, ada, ben, bea, cara, carl, willa, otto, una, leo, ned];

const families = [
    { id: 'west', husbandId: 'adam', wifeId: 'ada', childIds: ['ben', 'bea'], anniversary: '2010-05-01' },
    { id: 'widow', husbandId: null, wifeId: 'willa', childIds: ['otto'], anniversary: null },
];

function byId(id) {
    return people.find((p) => p.id === id) || null;
}

function nameOf(id) {
    const found = byId(id);
    return found ? found.name : id;
}

test('sex unset refuses a spouse, a child, and an anniversary, and names Edit Details', () => {
    for (const sex of [null, undefined, '', 'other']) {
        const unset = person('una', 'Una Unset', sex);
        const spouse = Fam.planRelation(families, unset, 'spouse', 'ada', byId);
        const child = Fam.planRelation(families, unset, 'child', 'ned', byId);
        const anniversary = Fam.planAnniversary(families, unset, '2024-06-01');
        for (const planned of [spouse, child, anniversary]) {
            assert.equal(planned.write, false, JSON.stringify(sex));
            assert.equal(planned.sentence, SEX_UNSET);
            assert.equal(planned.plan, null);
        }
    }
    assert.equal(Fam.SEX_UNSET, SEX_UNSET);
    assert.match(SEX_UNSET, /Edit Details/);
});

test('a spouse or child write is the existing family planner plan', () => {
    const added = Fam.planRelation([], leo, 'spouse', 'cara', byId);
    const direct = Family.planAddFamilyRelation([], 'leo', 'spouse', 'cara', byId);
    assert.equal(added.write, true);
    assert.equal(added.sentence, null);
    assert.deepStrictEqual(added.plan, direct);

    const child = Fam.planRelation([], leo, 'child', 'ned', byId);
    const directChild = Family.planAddFamilyRelation([], 'leo', 'child', 'ned', byId);
    assert.deepStrictEqual(child.plan, directChild);
    assert.equal(child.write, true);
});

test('a refusal comes back in the planner\'s own words, and an invalid plan writes nothing', () => {
    const planned = Fam.planRelation([], leo, 'spouse', 'carl', byId);
    const direct = Family.planAddFamilyRelation([], 'leo', 'spouse', 'carl', byId);
    assert.equal(planned.write, false);
    assert.equal(direct.valid, false);
    assert.equal(planned.sentence, direct.errors[0]);
    assert.deepStrictEqual(planned.plan, direct);

    const before = families.map((f) => Object.assign({}, f, { childIds: f.childIds.slice() }));
    const after = Fam.familiesAfter(before, planned, 'should-not-exist');
    assert.deepStrictEqual(after, before);
    assert.equal(after.some((f) => f.id === 'should-not-exist'), false);
    assert.equal(Fam.documentFor(planned), null);
});

test('the written create is the document the computer directory stores', () => {
    const planned = Fam.planRelation([], leo, 'spouse', 'cara', byId);
    assert.deepStrictEqual(Fam.documentFor(planned), {
        husbandId: 'leo',
        wifeId: 'cara',
        childIds: [],
        anniversary: null,
    });
});

test('the spouse search is the opposite sex, not this person, and not someone already a husband or wife', () => {
    const found = Fam.spouseSearch(families, people, leo, 'c');
    assert.deepStrictEqual(found.map((p) => p.id), ['cara']);

    const widower = person('widower', 'Walt Widower', 'male');
    const withWidower = families.concat([
        { id: 'walt', husbandId: 'widower', wifeId: null, childIds: [], anniversary: null },
    ]);
    const forAda = Fam.spouseSearch(withWidower, people.concat([widower]), ada, 'w');
    assert.equal(forAda.some((p) => p.id === 'widower'), false);
    assert.equal(forAda.some((p) => p.id === 'ada'), false);
    assert.equal(forAda.some((p) => p.id === 'willa'), false);
});

test('the child search excludes the spouse, a child of this Family, and a child of any other Family', () => {
    const found = Fam.childSearch(families, people, adam, 'b');
    assert.deepStrictEqual(found.map((p) => p.id), []);

    const open = Fam.childSearch(families, people, adam, 'ned');
    assert.deepStrictEqual(open.map((p) => p.id), ['ned']);
    assert.equal(open.some((p) => p.id === 'ada'), false);
    assert.equal(open.some((p) => p.id === 'ben'), false);
    assert.equal(open.some((p) => p.id === 'otto'), false);
    assert.equal(open.some((p) => p.id === 'adam'), false);
});

test('each search stops at eight people', () => {
    const women = [];
    for (let i = 0; i < 9; i++) women.push(person('w' + i, 'Ann ' + i, 'female'));
    const men = [];
    for (let i = 0; i < 9; i++) men.push(person('m' + i, 'Ned ' + i, 'male'));
    const spouse = Fam.spouseSearch([], women.concat([leo]), leo, 'ann');
    assert.equal(spouse.length, 8);
    assert.deepStrictEqual(spouse.map((p) => p.id), ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
    const children = Fam.childSearch([], men.concat([leo]), leo, 'ned');
    assert.equal(children.length, 8);
    assert.equal(children.some((p) => p.id === 'm8'), false);
});

test('a search list opens only once a name has been typed and someone matches', () => {
    const matches = Fam.spouseSearch(families, people, leo, 'cara');
    assert.equal(Fam.searchListOpen('', matches), false);
    assert.equal(Fam.searchListOpen('cara', []), false);
    assert.equal(Fam.searchListOpen('cara', matches), true);
});

test('an anniversary for someone with no Family of their own creates that Family and seats them by sex', () => {
    const planned = Fam.planAnniversary(families, ben, '2020-01-02');
    assert.equal(planned.write, true);
    assert.equal(planned.deletesFamily, false);
    assert.equal(planned.plan.action, 'create');
    assert.equal(planned.plan.familyId, null);
    assert.equal(planned.plan.changes.husbandId, 'ben');
    assert.equal(planned.plan.changes.wifeId, null);
    assert.deepStrictEqual(planned.plan.changes.childIds, []);
    assert.equal(planned.plan.changes.anniversary, '2020-01-02');

    const after = Fam.familiesAfter(families, planned, 'bens');
    const origin = after.find((f) => f.id === 'west');
    assert.equal(origin.anniversary, '2010-05-01');
    assert.deepStrictEqual(origin.childIds, ['ben', 'bea']);
    assert.equal(origin.husbandId, 'adam');
    const created = after.find((f) => f.id === 'bens');
    assert.equal(created.husbandId, 'ben');
    assert.equal(created.anniversary, '2020-01-02');

    const daughter = Fam.planAnniversary(families, bea, '2021-02-03');
    assert.equal(daughter.plan.changes.wifeId, 'bea');
    assert.equal(daughter.plan.changes.husbandId, null);
});

test('a spouse or child for someone who is only a child starts their own Family', () => {
    const spouse = Fam.planRelation(families, ben, 'spouse', 'cara', byId);
    assert.equal(spouse.plan.action, 'create');
    assert.equal(spouse.plan.changes.husbandId, 'ben');
    assert.equal(spouse.plan.changes.wifeId, 'cara');
    const afterSpouse = Fam.familiesAfter(families, spouse, 'bens');
    assert.equal(afterSpouse.find((f) => f.id === 'west').anniversary, '2010-05-01');
    assert.deepStrictEqual(afterSpouse.find((f) => f.id === 'west').childIds, ['ben', 'bea']);

    const child = Fam.planRelation(families, ben, 'child', 'ned', byId);
    assert.equal(child.plan.action, 'create');
    assert.deepStrictEqual(child.plan.changes.childIds, ['ned']);
    assert.equal(child.plan.changes.husbandId, 'ben');
    const afterChild = Fam.familiesAfter(families, child, 'bens');
    assert.deepStrictEqual(afterChild.find((f) => f.id === 'west').childIds, ['ben', 'bea']);
});

test('clearing an anniversary writes it empty and does not delete the Family', () => {
    for (const value of ['', null, undefined]) {
        const planned = Fam.planAnniversary(families, adam, value);
        assert.equal(planned.write, true, JSON.stringify(value));
        assert.equal(planned.deletesFamily, false);
        assert.equal(planned.plan.action, 'update');
        assert.equal(planned.plan.familyId, 'west');
        assert.deepStrictEqual(planned.plan.changes, { anniversary: null });
        const after = Fam.familiesAfter(families, planned);
        const west = after.find((f) => f.id === 'west');
        assert.ok(west);
        assert.equal(west.anniversary, null);
        assert.equal(west.husbandId, 'adam');
        assert.equal(west.wifeId, 'ada');
        assert.deepStrictEqual(west.childIds, ['ben', 'bea']);
    }
});

test('spouse removal names the computer\'s confirmation; child removal names none', () => {
    assert.equal(Fam.removalConfirmation('spouse'), SPOUSE_REMOVAL);
    assert.equal(Fam.removalConfirmation('child'), null);
});

test('confirming a spouse removal empties that seat and leaves the children and the Family', () => {
    const planned = Fam.planRelation(families, adam, 'spouse', 'ada', byId, true);
    const direct = Family.planRemoveFamilyRelation(families, 'adam', 'spouse', 'ada');
    assert.equal(planned.write, true);
    assert.deepStrictEqual(planned.plan, direct);
    assert.equal(planned.plan.action, 'update');
    assert.deepStrictEqual(planned.plan.changes, { wifeId: null });
    const after = Fam.familiesAfter(families, planned);
    const west = after.find((f) => f.id === 'west');
    assert.equal(west.wifeId, null);
    assert.equal(west.husbandId, 'adam');
    assert.deepStrictEqual(west.childIds, ['ben', 'bea']);
    assert.equal(after.filter((f) => f.id === 'west').length, 1);
});

test('removing a child does not ask, and the other children stay', () => {
    const planned = Fam.planRelation(families, adam, 'child', 'ben', byId, true);
    assert.equal(Fam.removalConfirmation('child'), null);
    assert.equal(planned.write, true);
    assert.deepStrictEqual(planned.plan.changes, { childIds: ['bea'] });
    const after = Fam.familiesAfter(families, planned);
    assert.deepStrictEqual(after.find((f) => f.id === 'west').childIds, ['bea']);
    assert.equal(after.find((f) => f.id === 'west').wifeId, 'ada');
});

test('a member and a Pastoral Assistant are not offered the controls, and Edit Mode off offers none', () => {
    assert.equal(Fam.offerControls(member, true), false);
    assert.equal(Fam.offerControls(assistant, true), false);
    assert.equal(Fam.offerControls(editor, false), false);
    for (const user of [editor, admin, elder, superAdmin]) {
        assert.equal(Fam.offerControls(user, true), true, user.permissionLevel);
    }
});

test('the Family line names the spouse and the children, and not the anniversary', () => {
    const line = Fam.familyLine(families, 'adam', nameOf);
    assert.equal(line.spouseName, 'Ada Lovelace');
    assert.deepStrictEqual(line.childNames, ['Ben West', 'Bea West']);
    assert.equal(Object.prototype.hasOwnProperty.call(line, 'anniversary'), false);

    const widow = Fam.familyLine(families, 'willa', nameOf);
    assert.equal(widow.spouseName, null);
    assert.deepStrictEqual(widow.childNames, ['Otto Orphan']);

    assert.equal(Fam.familyLine(families, 'ben', nameOf), null);
    assert.equal(Fam.familyLine(families, 'leo', nameOf), null);
});

test('joining two Families is refused in the planner\'s words and writes nothing', () => {
    const walt = person('walt', 'Walt Widower', 'male');
    const both = families.concat([
        { id: 'walt', husbandId: 'walt', wifeId: null, childIds: ['ned'], anniversary: null },
    ]);
    const lookup = function (id) {
        if (id === 'walt') return walt;
        return byId(id);
    };
    const planned = Fam.planRelation(both, willa, 'spouse', 'walt', lookup);
    const direct = Family.planAddFamilyRelation(both, 'willa', 'spouse', 'walt', lookup);
    assert.equal(planned.write, false);
    assert.equal(planned.sentence, direct.errors[0]);
    assert.match(planned.sentence, /joined in the directory/);
    const after = Fam.familiesAfter(both, planned, 'joined');
    assert.equal(after.some((f) => f.id === 'joined'), false);
    assert.equal(after.find((f) => f.id === 'widow').wifeId, 'willa');
    assert.equal(after.find((f) => f.id === 'walt').husbandId, 'walt');
});

test('the editor is withheld until sex is saved, and only while the controls are offered', () => {
    assert.deepStrictEqual(Fam.familyEditor(member, true, adam), { show: false, sentence: null });
    assert.deepStrictEqual(Fam.familyEditor(assistant, true, adam), { show: false, sentence: null });
    assert.deepStrictEqual(Fam.familyEditor(editor, false, adam), { show: false, sentence: null });
    assert.deepStrictEqual(Fam.familyEditor(editor, true, una), { show: false, sentence: SEX_UNSET });
    assert.deepStrictEqual(Fam.familyEditor(editor, true, adam), { show: true, sentence: null });
});

test('the Family line reads the way the computer card does, without the anniversary', () => {
    assert.equal(
        Fam.familyLineText(Fam.familyLine(families, 'adam', nameOf)),
        'Ada Lovelace · Ben West, Bea West',
    );
    assert.equal(Fam.familyLineText(Fam.familyLine(families, 'willa', nameOf)), 'Otto Orphan');
    assert.equal(Fam.familyLineText(null), '');
    assert.equal(Fam.spouseSeatLabel(adam), 'Wife');
    assert.equal(Fam.spouseSeatLabel(ada), 'Husband');
    assert.equal(Fam.spouseIdOf(families, 'adam'), 'ada');
    assert.deepStrictEqual(Fam.childIdsOf(families, 'adam'), ['ben', 'bea']);
    assert.equal(Fam.anniversaryValue(families, 'adam'), '2010-05-01');
    assert.equal(Fam.anniversaryValue(families, 'ben'), '');
});

test('a failed write keeps the Family that was already on the page', () => {
    assert.equal(Fam.SAVE_FAILED, "Couldn't save the Family. It did not work.");
    const before = families.map((f) => Object.assign({}, f, { childIds: f.childIds.slice() }));
    const after = Fam.familiesAfter(before, { write: false, sentence: Fam.SAVE_FAILED, plan: null });
    assert.deepStrictEqual(after, before);
});

const root = path.join(__dirname, '..');

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

test('the phone loads the Family plan after the planners and Edit Mode', () => {
    const html = read('public/mobile.html');
    const familyAt = html.indexOf('family-core.js');
    const editAt = html.indexOf('phone-directory-edit.js');
    const planAt = html.indexOf('phone-directory-family.js');
    assert.ok(familyAt !== -1 && planAt > familyAt);
    assert.ok(editAt !== -1 && planAt > editAt);
});

test('the Family line and controls are on the person page, not the list or Edit Details', () => {
    const src = read('public/mobile/screens-content.js');
    const page = fnBody(src, 'PersonDetailScreen');
    const list = fnBody(src, 'PeopleScreen');
    const family = fnBody(src, 'DirectoryFamily');
    const apply = fnBody(src, 'applyDirectoryFamily');
    const onFamily = fnBody(src, 'onFamily');
    const removeSpouse = fnBody(src, 'removeDirectorySpouse');
    const removeChild = fnBody(src, 'removeDirectoryChild');

    assert.match(page, /<\$\{DirectoryFamily\}/);
    assert.ok(page.indexOf('DirectoryFamily') < page.indexOf('title="Edit Details"'));
    assert.equal(list.includes('DirectoryFamily'), false);
    assert.equal(list.includes('familyLine'), false);
    assert.equal(list.includes('planAnniversary'), false);

    const sheet = page.slice(page.indexOf('title="Edit Details"'), page.indexOf('title="Involvement"'));
    assert.equal(sheet.includes('DirectoryFamily'), false);
    assert.equal(sheet.includes('planAnniversary'), false);
    assert.equal(sheet.includes('Anniversary'), false);
    assert.match(page, /person=\$\{p\}/);
    assert.equal(page.includes('person=${editS'), false);

    assert.match(family, /familyLine/);
    assert.match(family, /familyEditor/);
    assert.match(family, /searchListOpen/);
    assert.match(family, /aria-label="Anniversary"/);
    assert.match(family, /aria-label="Remove spouse"/);
    assert.match(family, /aria-label="Search to set spouse"/);
    assert.match(family, /aria-label="Search to add a child"/);
    assert.equal(family.includes('hover'), false);
    assert.equal(family.includes('absolute'), false);
    assert.ok(family.indexOf('aria-label="Anniversary"') > family.indexOf('editor.show'));

    assert.match(removeSpouse, /removalConfirmation\("spouse"\)/);
    assert.match(removeSpouse, /window\.confirm/);
    assert.match(removeSpouse, /planRelation/);
    assert.equal(removeChild.includes('confirm'), false);
    assert.match(removeChild, /planRelation/);

    assert.match(apply, /documentFor/);
    assert.match(apply, /addFamily/);
    assert.match(apply, /updateFamily/);
    assert.match(apply, /familiesAfter/);
    assert.equal(apply.includes('httpsCallable'), false);
    assert.equal(apply.includes('planAddFamilyRelation'), false);

    const caught = onFamily.slice(onFamily.indexOf('.catch'));
    assert.match(caught, /SAVE_FAILED/);
    assert.equal(caught.includes('familiesS'), false);
});

test('the security rules are not how the phone writes a Family', () => {
    const rules = read('firestore.rules');
    assert.equal(rules.includes('phone-directory-family'), false);
    const data = read('public/mobile/data.js');
    const add = fnBody(data, 'addFamily');
    const update = fnBody(data, 'updateFamily');
    assert.match(add, /collection\("families"\)/);
    assert.match(update, /collection\("families"\)/);
    assert.equal(add.includes('httpsCallable'), false);
    assert.equal(update.includes('httpsCallable'), false);
});
