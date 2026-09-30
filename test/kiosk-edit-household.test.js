// MS-709 — editing a Household at the kiosk. The kiosk's Households are the
// Household records (ADR-0075), so a child who marries leaves their parents'
// group at the desk, and the edit view rewrites the record and the names.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Household = require('../public/household-core.js');

function directory() {
    return {
        people: [
            { id: 'pa', name: 'Tobias Quill', sex: 'male' },
            { id: 'ma', name: 'Petra Quill', sex: 'female' },
            { id: 'son', name: 'Linus Quill', sex: 'male' },
            { id: 'sis', name: 'Iris Quill', sex: 'female' },
            { id: 'bride', name: 'Nell Quill', sex: 'female' },
        ],
        families: [
            { id: 'origin', husbandId: 'pa', wifeId: 'ma', childIds: ['son', 'sis'] },
        ],
    };
}

function kiosk() {
    const renamed = [];
    const rendered = [];
    const context = {
        console: { log() {}, warn() {}, error() {} },
        auth: { onAuthStateChanged() {} },
        localStorage: { getItem() { return null; }, setItem() {} },
        db: {},
    };
    context.window = context;
    context.PersonName = require('../public/person-name.js');
    context.HouseholdCore = Household;
    context.KioskCore = require('../public/kiosk-core.js');
    context.NametagCore = {};
    context.EventsStore = {};
    context.HouseholdStore = {
        async renamePeople(db, edits) {
            const plans = edits.map(e => Household.renameWrite(e.person, e.entry, 't'));
            const fault = plans.find(p => p.fault);
            if (fault) throw new Error(fault.fault);
            const n = edits.filter((e, i) => plans[i].patch);
            renamed.push(...n.map(e => e.person.id));
            return n.length;
        },
    };
    context.HouseholdEditor = { render(el, opts) { rendered.push(opts); } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'kiosk.js'), 'utf8'), context);
    const page = context.kioskPage();
    const dir = directory();
    page.people = dir.people;
    page.families = dir.families;
    page.households = Household.householdsFromDirectory(dir.people, dir.families);
    page.reloadHouseholds = async () => {};
    return { page, renamed, rendered };
}

const ids = h => h.members.map(m => m.personId);

test('searching my name shows everyone in my Household', () => {
    const { page } = kiosk();
    page.query = 'Petra';
    page.runSearch();
    assert.strictEqual(page.matches.length, 1);
    assert.deepStrictEqual(ids(page.matches[0]), ['pa', 'ma', 'son', 'sis']);
});

test('once a child marries they leave their parents\u2019 group and show up as their own Household', () => {
    const { page, rendered } = kiosk();
    page.openHousehold(page.households.find(h => h.familyId === 'origin'));
    page.startEdit();
    page.renderHouseholdCard({});
    assert.strictEqual(rendered[0].familyId, 'origin');
    assert.strictEqual(rendered[0].canEdit, true);

    // The Household card seats Nell as Linus's wife: a new record for them.
    const next = page.families.concat([{ id: 'newlyweds', husbandId: 'son', wifeId: 'bride', childIds: [] }]);
    rendered[0].onChange(next, { familyId: 'newlyweds', action: 'create' });

    page.query = 'Quill';
    page.runSearch();
    const groups = page.matches.map(ids);
    assert.deepStrictEqual(groups, [['pa', 'ma', 'sis'], ['son', 'bride']]);
});

test('taking the last people out of a record follows the Person the edit started from', () => {
    const { page, rendered } = kiosk();
    page.openHousehold(page.households.find(h => h.familyId === 'origin'));
    page.startEdit();
    assert.strictEqual(page.editAnchor, 'pa');
    page.renderHouseholdCard({});
    rendered[0].onChange([], { familyId: null, action: 'delete' });
    assert.strictEqual(page.selected.id, 'person:pa');
    assert.deepStrictEqual(page.editNames.map(n => n.personId), ['pa']);
});

test('the names start as they are, and Done writes only the one that changed', async () => {
    const { page, renamed } = kiosk();
    page.openHousehold(page.households.find(h => h.familyId === 'origin'));
    page.startEdit();
    assert.deepStrictEqual(page.editNames.map(n => n.firstName), ['Tobias', 'Petra', 'Linus', 'Iris']);
    page.editNames[3].firstName = 'Isla';
    await page.finishEdit();
    assert.deepStrictEqual(renamed, ['sis']);
    assert.strictEqual(page.view, 'present');
});

test('a name with no first name keeps the edit open and says why', async () => {
    const { page, renamed } = kiosk();
    page.openHousehold(page.households.find(h => h.familyId === 'origin'));
    page.startEdit();
    page.editNames[0].firstName = '';
    await page.finishEdit();
    assert.strictEqual(page.view, 'edit');
    assert.match(page.error, /first name/);
    assert.deepStrictEqual(renamed, []);
});
