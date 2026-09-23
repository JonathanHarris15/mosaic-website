const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-614 — phone Membership Directory Edit Mode.
//
// The seam is a pure helper: who is offered the switch, what a visit does to
// it, and the four writes (add, save, delete person, delete Involvement).
// The phone screen is glue over those answers. Gate tests that read the
// screen source are the prior art in mobile-directory-gate.test.js.

require('../public/access-core.js');
global.RolesCore = require('../public/roles-core.js');
const Shepherding = require('../public/shepherding-core.js');
const Edit = require('../public/phone-directory-edit.js');

const root = path.join(__dirname, '..');
function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('an editor, admin, elder, or super admin is offered Edit Mode', () => {
    for (const permissionLevel of ['editor', 'admin', 'elder', 'super_admin']) {
        assert.equal(Edit.mayOfferEditMode({ permissionLevel }), true, permissionLevel);
    }
});

test('a member is not offered Edit Mode', () => {
    assert.equal(Edit.mayOfferEditMode({ permissionLevel: 'member' }), false);
    assert.equal(Edit.mayOfferEditMode({ permissionLevel: 'viewer' }), false);
    assert.equal(Edit.mayOfferEditMode(null), false);
});

test('a Pastoral Assistant is not offered Edit Mode', () => {
    assert.equal(
        Edit.mayOfferEditMode({ permissionLevel: 'member', pastoralAssistant: true }),
        false,
    );
});

test('opening the directory starts Edit Mode off, and it stays on through a person', () => {
    Edit.beginDirectoryVisit();
    assert.equal(Edit.isOn(), false);
    Edit.setOn(true);
    assert.equal(Edit.isOn(), true);
    Edit.beginDirectoryVisit();
    assert.equal(Edit.isOn(), false);
});

test('opening the directory in nav starts Edit Mode off; opening a person does not', () => {
    const app = read('public/mobile/app.js');
    const nav = app.slice(app.indexOf('function nav('), app.indexOf('function Drawer('));
    assert.match(nav, /route === "people" && window\.PhoneDirectoryEdit\) \{\s*window\.PhoneDirectoryEdit\.beginDirectoryVisit\(\);/);
    assert.equal((nav.match(/beginDirectoryVisit/g) || []).length, 1);
});

test('Add person asks for name, email, phone, address, birthday, and sex, and not the Kid mark', () => {
    assert.deepStrictEqual(
        Edit.ADD_PERSON_FIELDS.map((field) => field.key),
        ['name', 'email', 'phone', 'address', 'birthday', 'sex'],
    );
});

test('Add person refuses a blank name and writes nothing', () => {
    for (const name of ['', '   ', null, undefined]) {
        const built = Edit.addPersonDocument({ name, email: 'a@b.c' }, { now: 1 });
        assert.equal(built.ok, false, JSON.stringify(name));
        assert.equal(built.error, Edit.NAME_REQUIRED);
        assert.equal(built.doc, undefined);
    }
});

test('Add person writes the same fields the computer Add Person writes', () => {
    const now = { marker: 'server-time' };
    const built = Edit.addPersonDocument({
        name: '  Ada Lovelace ',
        email: ' ada@example.com ',
        phone: ' 555 ',
        address: ' 1 Street ',
        birthday: '1815-12-10',
        sex: 'female',
        kid: true,
    }, { now });
    assert.equal(built.ok, true);
    assert.deepStrictEqual(built.doc, {
        name: 'Ada Lovelace',
        totalInvolvements: 0,
        contact: { email: 'ada@example.com', phone: '555', address: '1 Street' },
        birthday: '1815-12-10',
        sex: 'female',
        lastPastoralPrayerDate: null,
        tags: [],
        createdAt: now,
        updatedAt: now,
    });
});

test('the other Add person fields may be left empty, and sex may be left unset', () => {
    const built = Edit.addPersonDocument({ name: 'Ada', sex: '' }, { now: 1 });
    assert.equal(built.ok, true);
    assert.deepStrictEqual(built.doc.contact, { email: '', phone: '', address: '' });
    assert.equal(built.doc.birthday, null);
    assert.equal(built.doc.sex, null);
    assert.equal(built.doc.totalInvolvements, 0);
    assert.deepStrictEqual(built.doc.tags, []);
    assert.equal(Object.prototype.hasOwnProperty.call(built.doc, 'kid'), false);
});

test('a person added with no Member tag shows on the Non-members tab', () => {
    const built = Edit.addPersonDocument({ name: 'Ada' }, { now: 1 });
    const person = { tags: built.doc.tags, membership: null };
    assert.equal(Shepherding.personMatchesDirectoryTab(person, 'non_members', false), true);
    assert.equal(Shepherding.personMatchesDirectoryTab(person, 'members', false), false);
});

test('saving while Edit Mode is on includes name, sex, and the Kid mark', () => {
    const now = { marker: 'server-time' };
    const payload = Edit.savePayload({
        name: '  Ada ',
        email: ' ada@example.com ',
        phone: ' 555 ',
        address: ' 1 Street ',
        birthday: '1815-12-10',
        sex: 'female',
        kid: true,
    }, { editMode: true, updatedByName: 'Ed Editor', now });
    assert.deepStrictEqual(payload, {
        name: 'Ada',
        'contact.email': 'ada@example.com',
        'contact.phone': '555',
        'contact.address': '1 Street',
        birthday: '1815-12-10',
        sex: 'female',
        kid: true,
        updatedAt: now,
        updatedByName: 'Ed Editor',
    });
});

test('a blank name on an existing person is saved trimmed, even when empty', () => {
    const payload = Edit.savePayload({
        name: '   ',
        email: '',
        phone: '',
        address: '',
        birthday: '',
        sex: '',
        kid: false,
    }, { editMode: true, updatedByName: '', now: 1 });
    assert.equal(payload.name, '');
    assert.equal(payload.sex, null);
    assert.equal(payload.kid, false);
    assert.equal(payload.birthday, null);
});

test('saving the same name leaves remembered parts alone', () => {
    const payload = Edit.savePayload({
        name: 'Jonathan Harris Jr.',
        email: '',
        phone: '',
        address: '',
        birthday: '',
        sex: '',
        kid: false,
    }, {
        editMode: true,
        currentName: 'Jonathan Harris Jr.',
        updatedByName: '',
        now: 1,
    });
    assert.equal(payload.name, 'Jonathan Harris Jr.');
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'nameParts'), false);
});

test('changing the name clears remembered parts and does not invent a split', () => {
    const payload = Edit.savePayload({
        name: 'Jon Harris',
        email: '',
        phone: '',
        address: '',
        birthday: '',
        sex: 'male',
        kid: false,
    }, {
        editMode: true,
        currentName: 'Jonathan Harris Jr.',
        updatedByName: '',
        now: 1,
    });
    assert.equal(payload.name, 'Jon Harris');
    assert.equal(payload.nameParts, Edit.CLEAR_NAME_PARTS);
    assert.equal(payload.nameParts.firstName, undefined);
});

test('Edit Mode off does not clear parts even when the name field differs', () => {
    const payload = Edit.savePayload({
        name: 'Someone Else',
        email: 'a@b.c',
        phone: '',
        address: '',
        birthday: '',
    }, {
        editMode: false,
        currentName: 'Jonathan Harris Jr.',
        updatedByName: '',
        now: 1,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'name'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'nameParts'), false);
});

test('the saved view keeps parts when the name is unchanged and drops them when it changes', () => {
    const person = {
        name: 'Jonathan Harris Jr.',
        nameParts: { firstName: 'Jonathan', lastName: 'Harris', suffix: 'Jr.', noLastName: false },
        email: '', phone: '', address: '', birthday: '',
    };
    const fields = { name: 'Jonathan Harris Jr.', email: '', phone: '', address: '', birthday: '' };
    const same = Edit.savedPersonView(person, fields, true);
    assert.deepStrictEqual(same.nameParts, person.nameParts);
    const changed = Edit.savedPersonView(person, Object.assign({}, fields, { name: 'Jon Harris' }), true);
    assert.equal(changed.name, 'Jon Harris');
    assert.equal(Object.prototype.hasOwnProperty.call(changed, 'nameParts'), false);
});

test('adding a person on the phone still asks for one name and writes no parts', () => {
    const built = Edit.addPersonDocument({ name: 'Ada Lovelace' }, { now: 1 });
    assert.equal(built.ok, true);
    assert.equal(built.doc.name, 'Ada Lovelace');
    assert.equal(Object.prototype.hasOwnProperty.call(built.doc, 'nameParts'), false);
});

test('saving while Edit Mode is off keeps the contact fields and leaves name, sex, and the Kid mark alone', () => {
    const payload = Edit.savePayload({
        name: 'Changed',
        email: 'a@b.c',
        phone: '1',
        address: 'x',
        birthday: '',
        sex: 'male',
        kid: true,
    }, { editMode: false, updatedByName: 'Ed', now: 1 });
    assert.deepStrictEqual(payload, {
        'contact.email': 'a@b.c',
        'contact.phone': '1',
        'contact.address': 'x',
        birthday: null,
        updatedAt: 1,
        updatedByName: 'Ed',
    });
});

test('the saved view the phone shows is the fields that were saved, and only those', () => {
    const person = {
        id: 'p', name: 'Old', email: 'old@x', phone: '1', address: 'a',
        birthday: '2000-01-01', sex: 'male', kid: false, tags: ['Member'],
    };
    const fields = {
        name: 'New', email: 'new@x', phone: '2', address: 'b',
        birthday: '', sex: 'female', kid: true,
    };
    const on = Edit.savedPersonView(person, fields, true);
    assert.equal(on.name, 'New');
    assert.equal(on.sex, 'female');
    assert.equal(on.kid, true);
    assert.equal(on.email, 'new@x');
    assert.deepStrictEqual(on.tags, ['Member']);
    const off = Edit.savedPersonView(person, fields, false);
    assert.equal(off.name, 'Old');
    assert.equal(off.sex, 'male');
    assert.equal(off.kid, false);
    assert.equal(off.email, 'new@x');
});

test('the list fallback is not the name an editor saves', () => {
    const unnamed = { name: Edit.DISPLAY_NAME_FALLBACK, directoryName: '' };
    assert.equal(Edit.storedDirectoryName(unnamed), '');
    assert.equal(Edit.storedDirectoryName({ name: Edit.DISPLAY_NAME_FALLBACK }), '');
    assert.equal(Edit.storedDirectoryName({ name: 'Ada' }), 'Ada');
    const saved = Edit.savedPersonView(unnamed, {
        name: '   ', email: '', phone: '', address: '', birthday: '',
    }, true);
    assert.equal(saved.directoryName, '');
    assert.equal(saved.name, Edit.DISPLAY_NAME_FALLBACK);
    const payload = Edit.savePayload({ name: '' }, { editMode: true, now: 1 });
    assert.equal(payload.name, '');
});

test('an Involvement reads as its Role, and a one-off reads as its label', () => {
    assert.equal(Edit.involvementLabel({ type: 'worship_leader' }), 'Music Leader');
    assert.equal(Edit.involvementLabel({ type: 'worship_helper' }), 'Music Helper');
    assert.equal(Edit.involvementLabel({ type: 'one_off', metadata: { label: 'Unlock the hall' } }), 'Unlock the hall');
    assert.equal(Edit.involvementLabel({ type: 'one_off' }), 'One-off Role');
    assert.equal(Edit.involvementLabel({ type: 'kids_ministry' }), 'Kids Ministry');
    assert.equal(Edit.involvementLabel({ serviceDate: '2026-01-01' }), '');
});

test('delete person uses the computer confirmation and does not disconnect a linked account', () => {
    assert.equal(
        Edit.DELETE_PERSON_CONFIRM,
        'Are you sure you want to delete this person? Involvement records will remain but will be unlinked.',
    );
    assert.deepStrictEqual(Edit.personRemoval('person-1'), {
        ok: true,
        personId: 'person-1',
        collection: 'people',
        unlinkAccount: false,
    });
    assert.equal(Edit.personRemoval('').ok, false);
});

test('delete Involvement uses the computer confirmation and lowers the count by one', () => {
    assert.equal(Edit.DELETE_INVOLVEMENT_CONFIRM, 'Remove this involvement record?');
    assert.deepStrictEqual(Edit.involvementRemoval('person-1', 'inv-9'), {
        ok: true,
        personId: 'person-1',
        involvementId: 'inv-9',
        countField: 'totalInvolvements',
        countDelta: -1,
    });
    assert.equal(Edit.involvementRemoval('person-1', '').ok, false);
});

test('a failed save or delete tells the editor it did not work', () => {
    for (const message of [Edit.SAVE_FAILED, Edit.ADD_FAILED, Edit.DELETE_PERSON_FAILED, Edit.DELETE_INVOLVEMENT_FAILED]) {
        assert.match(message, /did not work/);
    }
});

function screenSource() {
    return read('public/mobile/screens-content.js');
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

test('the phone directory offers Edit Mode and Add person only after it is on', () => {
    const src = screenSource();
    const list = fnBody(src, 'PeopleScreen');
    assert.match(list, /mayOfferEditMode\(props\.user\)/);
    assert.match(list, /aria-label="Edit Mode"/);
    assert.match(list, /mayEdit && editOn \? html`<\$\{FAB\} icon="user-plus" label="Add person"/);
    assert.equal((list.match(/label="Add person"/g) || []).length, 1);
    const person = fnBody(src, 'PersonDetailScreen');
    assert.match(person, /storedDirectoryName\(p\)/);
    assert.match(person, />Edit Details</);
    assert.match(person, /guardian stub/);
    assert.equal(person.includes('pickup stub'), false);
    assert.match(person, /involvementLabel\(item\)/);
    assert.match(person, /label="Email"/);
    assert.match(person, /label="Phone"/);
    assert.match(person, /label="Address"/);
    assert.match(person, /label="Birthday"/);
});

test('dismissing the person editor writes nothing; save is the button', () => {
    const src = screenSource();
    const dismiss = fnBody(src, 'dismissEdit');
    assert.equal(dismiss.includes('saveDirectoryPerson'), false);
    assert.equal(dismiss.includes('saveEdit'), false);
    const save = fnBody(src, 'saveEdit');
    assert.match(save, /saveDirectoryPerson/);
    const closeAdd = fnBody(src, 'closeAdd');
    assert.equal(closeAdd.includes('addDirectoryPerson'), false);
    const submitAdd = fnBody(src, 'submitAdd');
    assert.match(submitAdd, /addPersonDocument/);
    assert.match(submitAdd, /addDirectoryPerson/);
});

test('delete controls are on screen, use the computer confirmation, and do not log a new Involvement', () => {
    const src = screenSource();
    const person = fnBody(src, 'PersonDetailScreen');
    assert.match(person, /confirm\(Edit\.DELETE_PERSON_CONFIRM\)/);
    assert.match(person, /confirm\(Edit\.DELETE_INVOLVEMENT_CONFIRM\)/);
    assert.match(person, />Delete person</);
    assert.match(person, />Delete</);
    assert.equal(person.includes('addInvolvement'), false);
    assert.equal(person.includes('unlinkDirectoryPerson'), false);
    assert.equal(person.includes('opacity: 0'), false);
    const data = read('public/mobile/data.js');
    const removal = fnBody(data, 'deleteDirectoryPerson');
    assert.match(removal, /personRemoval/);
    assert.equal(removal.includes('unlink'), false);
    assert.equal(removal.includes('"users"'), false);
    const inv = fnBody(data, 'deleteDirectoryInvolvement');
    assert.match(inv, /involvementRemoval/);
    assert.match(inv, /batch\.commit/);
});
