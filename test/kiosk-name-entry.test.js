const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The kiosk form calls the shared name rule. What is pinned here is that
// call: a search seeds the first name, the household name follows a last
// name until the greeter edits it, and adding to a household does not
// rename it. (MS-610)

function kioskPage() {
    const context = {
        console,
        auth: { onAuthStateChanged() {} },
        localStorage: { getItem() { return null; }, setItem() {} },
        created: null,
        db: {},
    };
    context.window = context;
    context.HouseholdCore = require('../public/household-core.js');
    context.KioskCore = {
        arrivals() { return []; },
        presentCountLabel() { return ''; },
    };
    context.EventsStore = {};
    context.HouseholdStore = {
        async createHousehold(db, draft) {
            context.created = draft;
            return { id: 'new', name: draft.name, members: [] };
        },
        async addPeopleToHousehold(db, household, draft) {
            context.added = { household: household, draft: draft };
            return { id: household.id, name: household.name, members: household.members };
        },
    };
    context.NametagCore = {};
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'public', 'kiosk.js'), 'utf8'),
        context
    );
    const page = context.kioskPage();
    page.reloadHouseholds = async () => {};
    page.households = [];
    return { page: page, context: context };
}

test('a search that found nobody seeds the first name and does not invent a last name', () => {
    const page = kioskPage().page;
    page.query = 'Jonathan Harris';
    page.startCreate();
    assert.strictEqual(page.draft.people[0].firstName, 'Jonathan Harris');
    assert.strictEqual(page.draft.people[0].lastName, '');
    assert.strictEqual(page.draft.people[0].suffix, '');
    assert.strictEqual(page.draft.name, 'A Household');
});

test('entering Jonathan / Harris / Jr. suggests The Harris Household', () => {
    const page = kioskPage().page;
    page.query = '';
    page.startCreate();
    const person = page.draft.people[0];
    person.firstName = 'Jonathan';
    person.lastName = 'Harris';
    person.suffix = 'Jr.';
    person.sex = 'male';
    page.refreshHouseholdName();
    assert.strictEqual(page.draft.name, 'The Harris Household');
});

test('a household name the greeter edited is left alone while another person is typed', () => {
    const page = kioskPage().page;
    page.startCreate();
    const person = page.draft.people[0];
    person.firstName = 'Jonathan';
    person.lastName = 'Harris';
    person.suffix = 'Jr.';
    page.refreshHouseholdName();
    page.draft.name = 'The Okafor Household';
    page.addDraftPerson();
    page.draft.people[1].firstName = 'Ruth';
    page.draft.people[1].lastName = 'Nguyen';
    page.refreshHouseholdName();
    assert.strictEqual(page.draft.name, 'The Okafor Household');
});

test('adding to an existing household keeps its name', () => {
    const page = kioskPage().page;
    page.selected = { id: 'hh', name: 'The Harris Household', members: [] };
    page.startAddPeople();
    page.draft.people[0].firstName = 'Ruth';
    page.draft.people[0].lastName = 'Nguyen';
    page.refreshHouseholdName();
    assert.strictEqual(page.draft.name, 'The Harris Household');
    assert.strictEqual(page.addingToHousehold, true);
});

test('a new person with no last name cannot be saved unless the pass is marked', async () => {
    const loaded = kioskPage();
    const page = loaded.page;
    page.startCreate();
    const person = page.draft.people[0];
    person.firstName = 'Ada';
    person.sex = 'female';
    await page.submitDraft();
    assert.strictEqual(page.error, 'A new person needs a last name, or mark that they have none.');
    assert.strictEqual(page.saving, false);
    assert.strictEqual(loaded.context.created, null);
    person.noLastName = true;
    await page.submitDraft();
    assert.strictEqual(page.error, '');
    assert.strictEqual(loaded.context.created.people[0].firstName, 'Ada');
    assert.strictEqual(loaded.context.created.name, 'A Household');
});
