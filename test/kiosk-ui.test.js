const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

test('the account panel offers kiosk as a permission level', () => {
    const html = read('profile.html');
    const js = read('profile.js');
    assert.match(html, /<option value="kiosk">Kiosk<\/option>/);
    assert.match(js, /'kiosk': 'Kiosk'/);
    assert.match(js, /<option value="kiosk"/);
});

test('signing in as a kiosk lands on the kiosk page', () => {
    assert.match(read('login.html'), /\blandingPageFor\(/);
    assert.match(read('auth.js'), /function landingPageFor/);
});

test('the shared auth wrapper gates a kiosk off every other page', () => {
    const auth = read('auth.js');
    assert.match(auth, /function applyKioskGate/);
    assert.match(auth, /applyKioskGate\(fresh\)/);
    assert.match(auth, /applyKioskGate\(known\)/);
});

test('the kiosk page is desktop UI, not the phone shell', () => {
    const html = read('kiosk.html');
    assert.match(html, /class="m-card/);
    assert.match(html, /class="m-btn m-btn--primary/);
    assert.doesNotMatch(html, /mobile-shell|shell-mobile|MOSAIC_SHELL/);
    assert.doesNotMatch(html, /Start Check-in|check-in/i);
});

test('the kiosk wears the seal and a welcome, not the app header', () => {
    const html = read('kiosk.html');
    assert.match(html, /assets\/mosaic-logo\.png/);
    assert.match(html, />Welcome!</);
    // The app's chrome is deliberately absent from a foyer desk.
    assert.doesNotMatch(html, /class="[^"]*m-header/);
    assert.doesNotMatch(html, /id="auth-container"/);
    // Which means Log Out has to be the page's own, calling auth.js's global.
    assert.match(html, /onclick="logout\(\)"/);
});

test('leaving and logging out are faint, and in the corner', () => {
    const html = read('kiosk.html');
    const corner = html.match(/<div x-show="!loading"[\s\S]*?fixed bottom-4 right-4[\s\S]*?<\/div>\s*<\/body>/);
    assert.ok(corner, 'no bottom-right cluster');
    assert.match(corner[0], /goBack\(\)/);
    assert.match(corner[0], /logout\(\)/);
    assert.match(corner[0], /text-on-surface-variant\/50/);
    // The one thing a volunteer must not lose: which gathering they are in.
    assert.match(corner[0], /x-text="eventTitle"/);
});

test('the kiosk searches Households, not Families', () => {
    const html = read('kiosk.html');
    assert.match(html, /Search by name/);
    assert.match(html, />Create household</);
    assert.doesNotMatch(html, /disabled>Create household</);
    assert.doesNotMatch(html, /Create family/i);
    assert.doesNotMatch(html, />Family</);
    assert.match(html, /view === 'create'/);
});

test('Start Attendance is how a greeter opens the search', () => {
    assert.match(read('kiosk.html'), />Start Attendance</);
    assert.match(read('kiosk.js'), /view = 'search'/);
});

test('the footer button names the live count of people being marked', () => {
    assert.match(read('kiosk.js'), /presentCountLabel/);
    assert.match(read('kiosk.html'), /x-text="footerLabel"/);
});

test('Attendance is a panel of its own, not a card inside Roles', () => {
    const RolesPanel = require('../public/roles-panel.js');
    assert.match(RolesPanel.MARKUP.attendance, />Who was present</);
    assert.doesNotMatch(RolesPanel.MARKUP.roles, />Who was present</);
    // It says so when nobody has been marked. Hiding itself was why there was
    // no answer at all to "did anyone turn up?".
    assert.match(RolesPanel.MARKUP.attendance, /Nobody has been marked present yet/);
    assert.match(read('calendar-event.js'), /Store\.loadAttendance/);
});

test('the Event page has an Attendance tab, and it is where the panel lives', () => {
    const html = read('calendar-event.html');
    assert.match(html, /@click="tab = 'attendance'"/);
    assert.match(html, /@click="tab = 'event'"/);
    assert.match(html, /x-show="isEditor && tab === 'attendance'"/);
    assert.match(html, /data-roles-panel="attendance"/);
    // The Event's own body is the other tab, not always-on beneath it.
    assert.match(html, /cal-cols" x-show="tab === 'event'"/);
    const js = read('calendar-event.js');
    assert.match(js, /tab: 'event',/);
    assert.match(js, /get attendanceRows\(\)/);
});

test('a kiosk can mark a whole household present in one tap', () => {
    const html = read('kiosk.html');
    assert.match(html, /@change="toggleAll\(\)"/);
    assert.match(html, />Everyone</);
    const js = read('kiosk.js');
    // Select-all only ever moves the people who are not already here.
    const fn = js.slice(js.indexOf('toggleAll()'));
    assert.ok(fn, 'no toggleAll');
    assert.match(fn.slice(0, 200), /this\.arrivalsHere\(\)/);
});

test('an event can be marked as needing name tags', () => {
    assert.match(read('calendar-event.html'), /Print name tags when people are marked present/);
    assert.match(read('calendar-event.js'), /setNeedsNameTags/);
});

test('a Person can be marked a Kid from the directory', () => {
    assert.match(read('peoples-page.html'), /x-model="selectedPerson.kid"/);
    assert.match(read('peoples-page.js'), /kid: !!this.selectedPerson.kid/);
});

test('signing out of a kiosk clears Firestore persistence', () => {
    const auth = read('auth.js');
    assert.match(auth, /db\.terminate\(\)/);
    assert.match(auth, /clearPersistence/);
    assert.match(auth, /wasKiosk/);
});

test('a kiosk header has no User Page', () => {
    const AUTH = read('auth.js');
    const store = {};
    const observers = [];
    const container = { innerHTML: '' };
    const sandbox = {
        console: { log() {}, error() {}, warn() {} },
        setTimeout,
        document: {
            readyState: 'interactive',
            body: { appendChild() {} },
            getElementById: id => id === 'auth-container' ? container : null,
            createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
            addEventListener() {},
            dispatchEvent() { return true; },
        },
        location: { hostname: 'mosaic-hymn-database.web.app', href: '', pathname: '/kiosk.html', replace() {} },
        localStorage: {
            getItem: k => store[k] || null,
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: k => { delete store[k]; },
        },
        CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
        firebase: {
            apps: [{}],
            initializeApp() {},
            auth: () => ({
                onAuthStateChanged: fn => observers.push(fn),
                signOut: () => Promise.resolve(),
            }),
            firestore: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }),
        },
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = () => {};
    vm.createContext(sandbox);
    vm.runInContext(AUTH, sandbox);
    store.mosaicUserDoc = JSON.stringify({
        uid: 'kiosk-1',
        data: { permissionLevel: 'kiosk' },
    });
    observers.forEach(fn => fn({ uid: 'kiosk-1', isAnonymous: false }));
    assert.doesNotMatch(container.innerHTML, /User Page/);
    assert.match(container.innerHTML, /Log Out/);
});

// ── MS-321: the second household through the door ──────────────────────────

test('the search bar does not offer the last family typed to the next one', () => {
    const html = read('kiosk.html');
    const search = html.match(/<input type="search"[\s\S]*?>/);
    assert.ok(search, 'no search input on the kiosk');
    assert.match(search[0], /autocomplete="off"/);
    assert.match(search[0], /spellcheck="false"/);
});

test('somebody already marked present is shown as such and cannot be ticked again', () => {
    const html = read('kiosk.html');
    assert.match(html, /:disabled="isPresent\(m\.personId\)"/);
    assert.match(html, />Already here</);
    const js = read('kiosk.js');
    assert.match(js, /if \(this\.isPresent\(personId\)\) return;/);
    // Only arrivals are written and only arrivals are printed.
    assert.match(js, /Kiosk\.arrivals\(this\.checkedMembers\(\), this\.attendance\)/);
});

test('a tag prints again only when a greeter asks for that one person', () => {
    const html = read('kiosk.html');
    assert.match(html, /@click="reprint\(m\)"/);
    assert.match(html, /Reprint tag/);
    const js = read('kiosk.js');
    assert.match(js, /async reprint\(member\)/);
    // The Kid's stub has to carry the number they were already given.
    assert.match(js, /Kiosk\.pickupCodesFrom\(this\.attendance, \[member\]\)/);
});

test('a household can gain people without a second household being made', () => {
    const html = read('kiosk.html');
    assert.match(html, />Add someone</);
    assert.match(html, /@click="startAddPeople\(\)"/);
    const js = read('kiosk.js');
    assert.match(js, /addPeopleToHousehold/);
});

test('the same household typed twice is named rather than quietly duplicated', () => {
    assert.match(read('kiosk.html'), /There is already a household called/);
    assert.match(read('kiosk.js'), /Household\.duplicateOf/);
});

test('marking present returns the kiosk to the bare search screen', () => {
    const js = read('kiosk.js');
    const submit = js.match(/async submitPresent\(\)[\s\S]*?\n        \},/);
    assert.ok(submit, 'no submitPresent');
    assert.match(submit[0], /this\.toSearch\(\);/);
    // The print is started before the screen resets, never after.
    assert.ok(submit[0].indexOf('this.printNow()') < submit[0].indexOf('this.toSearch()'));
});

test('the remove control on the create form is an icon, not a word in a one-column button', () => {
    const html = read('kiosk.html');
    assert.match(html, /aria-label="Remove this person"/);
    assert.match(html, /class="m-icon-btn"/);
    assert.doesNotMatch(html, /m-btn--sm"[^>]*>Remove</);
});

test('a used Household stops being a projection and gets written down', () => {
    const js = read('kiosk.js');
    assert.match(js, /mintIfProjected/);
    assert.match(js, /HouseStore\.mintHousehold/);
});

test('a wrong tap can be taken back off the list', () => {
    const html = read('kiosk.html');
    assert.match(html, /@click="unmark\(m\)"/);
    assert.match(html, /aria-label="Take them back off the list"/);
    const js = read('kiosk.js');
    assert.match(js, /Store\.unmarkPresent/);
    const Store = require('../public/events-store.js');
    assert.strictEqual(typeof Store.unmarkPresent, 'function');
});

test('the household count is a pill, not the Calendar chip that lights up on hover', () => {
    const html = read('kiosk.html');
    assert.match(html, /of ' \+ h\.members\.length \+ ' here/);
    // .m-chip is width:100% with its own :hover background — wrong component.
    assert.doesNotMatch(html, /class="m-chip/);
});

// ── The print escape hatch (MS-317 follow-up) ────────────────────────────────
//
// A switch a greeter can find when the button does nothing and there is a queue
// at the door. It turns off the hidden print frame and puts the labels in a
// window they can see, where the ordinary dialog — and failing that, Ctrl+P —
// still works.

test('the kiosk offers a way out when printing does nothing', () => {
    const html = read('kiosk.html');
    // Their words, not ours. Nothing here ever skipped the dialog, but this is
    // what somebody who has pressed print and seen nothing will look for.
    assert.match(html, /Don't skip print dialog/);
    assert.match(html, /@click="togglePlainPrint\(\)"/);
});

test('the switch sits quietly in the corner, opposite Back and Log Out', () => {
    const html = read('kiosk.html');
    assert.match(html, /fixed bottom-4 left-4/);
    // The same faint uniform the other desk-volunteer controls wear.
    assert.match(html, /text-on-surface-variant\/50[\s\S]{0,80}hover:text-on-surface-variant/);
});

test('the switch says which way it is set', () => {
    // A control that changes how the whole morning prints must not look the
    // same on as off.
    const html = read('kiosk.html');
    assert.match(html, /:aria-pressed="plainPrint/);
    assert.match(html, /plainPrint \? 'check_box' : 'check_box_outline_blank'/);
});

test('with the switch on, the hidden frame is not used at all', () => {
    const js = read('kiosk.js');
    assert.match(js, /if \(this\.plainPrint\) \{[\s\S]*?Nametag\.openPrintWindow\(/);
    // And the ordinary path is still there underneath it.
    assert.match(js, /Nametag\.printLabels\(this\.lastLabels, document/);
});

test('a blocked pop-up is explained rather than looking like another silence', () => {
    const js = read('kiosk.js');
    assert.match(js, /blocked the new tab/i);
    assert.match(js, /Ctrl\+P/);
});

test('the switch is remembered on the machine, not just for the session', () => {
    // A kiosk gets reloaded. A greeter who found this once must not have to
    // find it again mid-morning.
    const js = read('kiosk.js');
    assert.match(js, /PLAIN_PRINT_KEY/);
    assert.match(js, /localStorage\.setItem\(PLAIN_PRINT_KEY/);
    assert.match(js, /this\.loadPrintPreference\(\);/);
});

test('a browser that refuses localStorage still gets a working switch', () => {
    // Locked-down kiosk browsers can throw on the accessor itself, and a switch
    // that cannot be remembered must still be a switch that works today.
    const js = read('kiosk.js');
    assert.match(js, /loadPrintPreference\(\) \{[\s\S]*?try \{[\s\S]*?catch/);
    assert.match(js, /togglePlainPrint\(\) \{[\s\S]*?try \{[\s\S]*?catch/);
});

// ── Reaching the name-tag setting at all ─────────────────────────────────────
//
// ⚠ THE REAL CAUSE OF THE SUNDAY-MORNING SILENCE. The checkbox that decides
// whether an Event prints name tags sat inside the "Who can see this" card,
// which only renders for a ONE-OFF — series visibility moved to the Recurring
// Events tabs in MS-229. So on every repeating event, the Sunday Service
// included, the setting could not be reached. The store wrote it, the kiosk read
// it, the help text explained what it did across a series, and no editor could
// ever tick it. Greeters pressed print and nothing happened, because no event
// had ever been able to say it wanted tags.

test('the name-tag setting can be reached on a repeating event, not just a one-off', () => {
    const html = read('calendar-event.html');
    const marker = 'Print name tags when people are marked present at the kiosk';
    const at = html.indexOf(marker);
    assert.ok(at !== -1, 'the setting must still be on the page');

    // The section it lives in, found by walking back to the nearest <section.
    const openedAt = html.lastIndexOf('<section', at);
    const section = html.slice(openedAt, at);
    assert.ok(!/isOneOff/.test(section),
        'the name-tag setting must not be shut behind isOneOff: ' + section.slice(0, 120));
    assert.match(section, /x-show="isEditor"/);
});

test('name tags are their own setting, not a visibility one', () => {
    const html = read('calendar-event.html');
    const at = html.indexOf('Print name tags when people are marked present');
    const openedAt = html.lastIndexOf('<section', at);
    assert.match(html.slice(openedAt, at), /Name tags/);
});

test('the box reads the same rule the kiosk reads', () => {
    // A date of a repeating event carries nothing itself and inherits from the
    // Event. Reading only the occurrence leaves the box unticked on an event
    // that is busily printing tags.
    const html = read('calendar-event.html');
    const js = read('calendar-event.js');
    assert.match(html, /:checked="needsNameTagsOn"/);
    assert.match(js, /get needsNameTagsOn\(\)[\s\S]*?this\.series && this\.series\.needsNameTags/);

    // And it must match kiosk.js's own getter.
    assert.match(read('kiosk.js'),
        /get needsNameTags\(\)[\s\S]*?series && series\.needsNameTags/);
});

// ── Setting it once for a whole repeating event ──────────────────────────────
//
// The Calendar sets one date. For the Sunday Service that is fifty-two ticks a
// year, so the Event itself has to be able to say it — which is what the kiosk
// already read: the date's own answer first, then the Event's.

test('a repeating event can ask for name tags on every date', () => {
    const html = read('recurring-events.html');
    const at = html.indexOf('Print name tags when people are marked present at the kiosk');
    assert.ok(at !== -1, 'the Recurring Events pane must carry the setting');

    const section = html.slice(html.lastIndexOf('<section', at), at);
    assert.match(section, /x-show="isEditor"/, 'editors only');
    assert.match(section, /Name tags/);
});

test('it sits on THE EVENT tab, with the rest of what is true of every date', () => {
    const html = read('recurring-events.html');
    const eventTab = html.indexOf("tab === 'event'");
    const at = html.indexOf('Print name tags when people are marked present at the kiosk');
    const nextTab = html.indexOf("tab === '", eventTab + 20);
    assert.ok(at > eventTab && (nextTab === -1 || at < nextTab),
        'the setting must be inside the event tab');
});

test('the series toggle writes the Event, and says so', () => {
    const js = read('recurring-events.js');
    assert.match(js, /async setNeedsNameTags\(value\)[\s\S]*?Store\.setNeedsNameTags\(db, \{[\s\S]*?seriesId: this\.seriesId/);
    // Not the occurrences: rewriting every date to restate what the Event now
    // says would be a batch across years of history.
    const fn = js.slice(js.indexOf('async setNeedsNameTags(value)'));
    assert.ok(!/occurrenceId/.test(fn.slice(0, 500)), 'the series write must not touch dates');
});

test('it saves on change, like the start time beside it', () => {
    // A checkbox is never half-ticked, and a greeter about to open the doors
    // should not have to find a Save button.
    const html = read('recurring-events.html');
    assert.match(html, /@change="setNeedsNameTags\(\$event\.target\.checked\)"/);
});

test('the two surfaces agree on what the setting is called', () => {
    // The same sentence on the Calendar's single date and on the Event, so
    // nobody has to work out whether they are the same switch.
    const label = 'Print name tags when people are marked present at the kiosk';
    assert.ok(read('calendar-event.html').includes(label));
    assert.ok(read('recurring-events.html').includes(label));
});
