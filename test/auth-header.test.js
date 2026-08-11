const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// "Sometimes when loading the website, the header with the login and sign out
// does not show up."
//
// A race, and the loser was always the header. auth.js is loaded in <head> on
// every page; #auth-container is in the <body>, further down. Firebase resolves
// the stored session off IndexedDB, and how long that takes has nothing to do
// with how long the rest of the HTML takes to parse — so on a warm cache the
// first onAuthStateChanged sometimes lands while the container is still an
// unparsed line of HTML.
//
// updateAuthUI found no container and returned. Nothing asked again: auth state
// only changes at login and logout, so the header stayed empty for the whole
// visit, and the next page load looked fine.
//
// The real script is RUN here rather than read, because the bug is in when
// things happen, and a regex cannot be early.

const AUTH = fs.readFileSync(path.join(__dirname, '..', 'public', 'auth.js'), 'utf8');

// A browser, as much of one as auth.js touches. `container` starts absent when
// we are modelling the race — the <body> has not been parsed yet.
function openPage({ containerPresent = true } = {}) {
    const listeners = {};
    const container = { innerHTML: '' };
    const elements = containerPresent ? { 'auth-container': container } : {};
    const observers = [];

    const document = {
        readyState: 'loading',
        body: { appendChild() {} },
        getElementById: id => elements[id] || null,
        createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        dispatchEvent: event => { (listeners[event.type] || []).slice().forEach(fn => fn(event)); return true; },
    };

    const sandbox = {
        console: { log() {}, error() {}, warn() {} },
        setTimeout,
        document,
        location: { hostname: 'mosaic-hymn-database.web.app', href: '' },
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

    return {
        html: () => container.innerHTML,
        // Firebase has worked out who this is.
        authResolves: user => observers.forEach(fn => fn(user)),
        // The rest of the HTML has arrived.
        bodyParsed: () => {
            elements['auth-container'] = container;
            document.readyState = 'interactive';
            document.dispatchEvent(new sandbox.CustomEvent('DOMContentLoaded', {}));
        },
        heardAuthChanged: () => (listeners['auth-changed'] || []).length,
        onAuthChanged: fn => document.addEventListener('auth-changed', fn),
    };
}

const SIGNED_IN = { uid: 'u1', isAnonymous: false };

test('the header renders when auth resolves after the page is built', () => {
    const page = openPage();
    page.authResolves(SIGNED_IN);
    assert.match(page.html(), /Log Out/);
});

test('a signed-out visitor is offered a way in', () => {
    const page = openPage();
    page.authResolves(null);
    assert.match(page.html(), /Log In/);
});

test('an anonymous session is signed out, not signed in', () => {
    const page = openPage();
    page.authResolves({ uid: 'anon', isAnonymous: true });
    assert.match(page.html(), /Log In/);
});

// ── THE BUG ──────────────────────────────────────────────────────────────────

test('auth resolving before the header exists does not lose the header', () => {
    const page = openPage({ containerPresent: false });
    page.authResolves(SIGNED_IN);
    assert.equal(page.html(), '', 'nothing to render into yet — that part is fine');

    page.bodyParsed();
    assert.match(page.html(), /Log Out/,
        'the header never arrived: auth state was known and thrown away');
});

test('the same race signed out still offers the way in', () => {
    const page = openPage({ containerPresent: false });
    page.authResolves(null);
    page.bodyParsed();
    assert.match(page.html(), /Log In/);
});

test('anything else waiting on auth is told too, however late it started listening', () => {
    // main.js shows the admin controls off this event, against an element that
    // is in the <body> as well — so it loses exactly the same race.
    const page = openPage({ containerPresent: false });
    page.authResolves(SIGNED_IN);

    const heard = [];
    page.onAuthChanged(e => heard.push(e.detail.user));
    page.bodyParsed();
    assert.deepStrictEqual(heard, [SIGNED_IN]);
});

test('a page that won the race is not told twice', () => {
    const page = openPage();
    const heard = [];
    page.onAuthChanged(e => heard.push(e.detail.user));
    page.authResolves(SIGNED_IN);
    page.bodyParsed();
    assert.equal(heard.length, 1, 'the catch-up fired for a header that was already there');
});
