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
    assert.match(html, /class="[^"]*m-header/);
    assert.match(html, /class="m-card/);
    assert.match(html, /class="m-btn m-btn--primary/);
    assert.doesNotMatch(html, /mobile-shell|shell-mobile|MOSAIC_SHELL/);
    assert.doesNotMatch(html, /Start Check-in|check-in/i);
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

test('Attendance is visible on Event detail and the Roles tab', () => {
    const RolesPanel = require('../public/roles-panel.js');
    assert.match(RolesPanel.MARKUP.roles, />Who was present</);
    assert.match(RolesPanel.MARKUP.roles, /x-show="isEditor && attendance.length"/);
    assert.match(read('calendar-event.js'), /Store\.loadAttendance/);
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
