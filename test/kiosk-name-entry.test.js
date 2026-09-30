const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The kiosk form calls the shared name rule. What is pinned here is that
// call: a search seeds the first name, the household is named for its
// people rather than typed (MS-709), and adding to a household does not
// rename it. (MS-610)

function kioskPage() {
    const context = {
        console,
        auth: { onAuthStateChanged() {} },
        localStorage: { getItem() { return null; }, setItem() {} },
        saved: null,
        db: {},
    };
    context.window = context;
    context.PersonName = require('../public/person-name.js');
    context.HouseholdCore = require('../public/household-core.js');
    context.KioskCore = {
        arrivals() { return []; },
        presentCountLabel() { return ''; },
    };
    context.EventsStore = {};
    context.HouseholdStore = {
        async saveDraft(db, target, draft) {
            context.saved = { target: target, draft: draft };
            return { id: target ? target.id : 'person:new', added: [] };
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
    assert.strictEqual(page.draftHouseholdName, 'A Household');
});

test('entering Jonathan / Harris / Jr. names it The Harris Household', () => {
    const page = kioskPage().page;
    page.query = '';
    page.startCreate();
    const person = page.draft.people[0];
    person.firstName = 'Jonathan';
    person.lastName = 'Harris';
    person.suffix = 'Jr.';
    person.sex = 'male';
    assert.strictEqual(page.draftHouseholdName, 'The Harris Household');
});

test('the first parent with a last name names the household, not a child typed after', () => {
    const page = kioskPage().page;
    page.startCreate();
    page.draft.people[0].firstName = 'Pip';
    page.draft.people[0].lastName = 'Okafor';
    page.draft.people[0].kid = true;
    page.kidChanged(page.draft.people[0]);
    page.addDraftPerson();
    page.draft.people[1].firstName = 'Ruth';
    page.draft.people[1].lastName = 'Nguyen';
    assert.strictEqual(page.draft.people[0].role, 'child');
    assert.strictEqual(page.draftHouseholdName, 'The Nguyen Household');
});

test('adding to an existing household keeps its name, and a newcomer to a record is a child', () => {
    const page = kioskPage().page;
    page.selected = { id: 'family:f', familyId: 'f', name: 'The Harris Household', members: [] };
    page.startAddPeople();
    page.draft.people[0].firstName = 'Ruth';
    page.draft.people[0].lastName = 'Nguyen';
    assert.strictEqual(page.draftHouseholdName, 'The Harris Household');
    assert.strictEqual(page.addingToHousehold, true);
    assert.strictEqual(page.draft.people[0].role, 'child');
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
    assert.strictEqual(loaded.context.saved, null);
    person.noLastName = true;
    await page.submitDraft();
    assert.strictEqual(page.error, '');
    assert.strictEqual(loaded.context.saved.draft.people[0].firstName, 'Ada');
    assert.strictEqual(loaded.context.saved.target, null);
});

test('two fathers in one new household are refused before anything is written', async () => {
    const loaded = kioskPage();
    const page = loaded.page;
    page.startCreate();
    Object.assign(page.draft.people[0], { firstName: 'Al', lastName: 'Ng', sex: 'male' });
    page.addDraftPerson();
    Object.assign(page.draft.people[1], { firstName: 'Bo', lastName: 'Ng', sex: 'male' });
    await page.submitDraft();
    assert.match(page.error, /already has a husband/);
    assert.strictEqual(loaded.context.saved, null);
});
