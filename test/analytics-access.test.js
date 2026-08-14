const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Service Analytics — who may open it.
//
// The page reads the WHOLE history of the church's services and turns it into
// who has served, how often, and when they last did. That is a planning tool
// for the people who staff Sundays, and a different thing from a member reading
// the rota. Editors and above.
//
// ⚠ It is a DOOR, and these tests cannot pretend it is more than that. There
// is a lock behind it now — MS-197 closed `people` and `involvement` to
// signed-in accounts (ADR-0031) — but the door and the lock are set at
// different heights: the page is editors-and-above, the collections are anyone
// with an account. So a member who types the URL is stopped by this screen and
// by nothing else, and what it must get exactly right is that the refusal
// lands BEFORE the read. A page that assembles the history and then hides it
// has already handed it to the browser.
//
// (`services` stays world-readable — the congregant-facing Service Guide is on
// the other side of it.)

const PUBLIC = path.join(__dirname, '..', 'public');

// Enough of a Firestore to get through a load, and a record of everything it
// was asked for — which is the assertion, not the data.
function fakeDb(reads) {
    const empty = {
        size: 0,
        docs: [],
        forEach() {},
        get: async () => empty,
    };
    return {
        collection(name) {
            reads.push(name);
            return Object.assign({}, empty, {
                doc: () => ({ collection: () => empty, get: async () => empty }),
            });
        },
        collectionGroup(name) {
            reads.push(name);
            return empty;
        },
    };
}

// Open the page as somebody, and run the auth callback its init() registers.
async function open(permissionLevel) {
    const { analyticsPage } = await import('../public/analytics.js');

    const reads = [];
    global.db = fakeDb(reads);
    global.getUserData = async () => ({ permissionLevel });
    // Both ship as plain <script>s on the page, so they are globals here too.
    global.PastoralPrayerCore = { HISTORY_COLLECTION: 'pastoral_prayer_history' };
    global.BIBLE_DATA = { Genesis: 50 };

    let callback = null;
    global.auth = { onAuthStateChanged(fn) { callback = fn; } };

    const page = analyticsPage();
    page.init();
    assert.ok(callback, 'the page never waited for auth to settle');
    await callback({ uid: 'u1' });

    return { page, reads };
}

test('a viewer and a member are refused Service Analytics', async () => {
    for (const level of ['viewer', 'member']) {
        const { page } = await open(level);
        assert.strictEqual(page.refused, true, level + ' was shown the analytics');
        assert.strictEqual(page.loading, false,
            level + ' was left on a loading screen that will never finish');
    }
});

// ⚠ The whole point. Refusing after the fetch would still have assembled every
// person's serving history in the browser and merely declined to draw it.
test('a refused reader triggers no read at all', async () => {
    const { reads } = await open('member');
    assert.deepStrictEqual(reads, [],
        'the history was fetched for somebody who is not allowed to see it');
});

test('an unknown permission level is refused rather than let through', async () => {
    for (const level of [undefined, null, '', 'nonsense']) {
        const { page } = await open(level);
        assert.strictEqual(page.refused, true, String(level) + ' reached the analytics');
    }
});

test('editors and above still get the analytics', async () => {
    for (const level of ['editor', 'admin', 'elder', 'super_admin']) {
        const { page, reads } = await open(level);
        assert.strictEqual(page.refused, false, level + ' was refused the analytics');
        assert.ok(reads.includes('services'),
            level + ' reached the page without it reading the services');
    }
});

// ── The way in ────────────────────────────────────────────────────────────────

test('the dashboard card is injected for editors, not sitting in the page', async () => {
    // A card in the markup is a card a member sees and clicks, and being refused
    // on arrival is worse than never being offered. Every other gated card on
    // this dashboard is injected; this one used to be the exception.
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

    const cards = html.slice(0, html.indexOf('<script>'));
    assert.ok(cards.indexOf('analytics.html') === -1,
        'the Service Analytics card is still in the page for everyone');

    // Injected behind the editor gate, and keeping its stored key — renaming
    // that would drop the card to the end of every dashboard ever arranged.
    const at = html.indexOf("card.href = 'analytics.html'");
    assert.ok(at !== -1, 'nothing injects the Service Analytics card');
    assert.ok(html.slice(0, at).lastIndexOf("['editor', 'elder', 'admin', 'super_admin']")
        > html.slice(0, at).lastIndexOf('grid.appendChild'),
        'the Service Analytics card is injected without an editor gate above it');
    assert.match(html, /cardKey = 'service-analytics'/,
        'the card lost the key every saved dashboard order refers to');
});

test('the page draws nothing but the refusal when it refuses', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'analytics.html'), 'utf8');

    // The tab bar, the panels, and the loading card are each gated, so a refused
    // reader cannot be left with a stray control from a screen they were told
    // they may not see.
    assert.match(html, /x-show="!loading && !refused"/, 'the tab bar ignores a refusal');
    assert.match(html, /x-if="!loading && !refused"/, 'the panels ignore a refusal');
    assert.match(html, /x-if="refused"/, 'a refused reader is shown a blank page');
});
