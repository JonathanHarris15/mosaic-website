const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// "Sunday at a Glance" took as long to appear when you had been on Home ten
// seconds earlier as it did the first time, because Home re-fetched the whole
// services collection on every visit.
//
// The memo that fixed it is plain JS — an object plus sessionStorage — and
// deliberately NOT the Firestore cache in local-cache.js, which is off because
// it hangs the WebView. Nothing here may reintroduce that.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const DATA = read('public', 'mobile', 'data.js');
const APP = read('public', 'mobile', 'app.js');

test('the memo holds nothing for long', () => {
    // The point is "I was just there", not storage. A long TTL turns a speed
    // fix into a staleness bug — somebody else's edit invisible for as long as
    // the window lasts.
    const ttl = DATA.match(/var TTL_MS = ([^;]+);/);
    assert.ok(ttl, 'the memo no longer has a TTL');
    // eslint-disable-next-line no-eval
    assert.ok(eval(ttl[1]) <= 5 * 60 * 1000, `the memo holds data for ${ttl[1]}, which is long enough to be wrong`);
});

test('a failed load is never remembered as an answer', () => {
    // Caching a rejection means one flaky moment gives you a broken Home for
    // the whole TTL, with no way to retry but waiting it out.
    assert.match(DATA, /\.catch\(function \(e\) \{\s*\n\s*delete memo\[key\];/,
        'a failed fetch stays in the memo and every later visit replays the failure');
});

test('opening an editor forgets what it is about to change', () => {
    // The editors are separate documents, so nothing in the app runs again
    // after the edit to clear this. The only moment we know a change is coming
    // is the navigation itself.
    assert.match(APP, /if \(route === "serviceBuilder"\) \{\s*\n\s*if \(data\.forget\) data\.forget\("services"\);/,
        'editing a service leaves Home showing the version you just edited away');
    assert.match(APP, /if \(route === "hymnManager"\) \{\s*\n\s*if \(data\.forget\) data\.forget\("hymns"\);/,
        'editing a hymn leaves the directory showing the old one');
    assert.match(DATA, /forget: forget,/, 'forget is not exposed, so nothing can invalidate anything');
});

test('forget clears BOTH levels', () => {
    // Clearing only the in-memory half looks like it works — you are still on
    // the same document while you test it — and then the stale sessionStorage
    // copy comes back the moment you return from a shell page.
    const body = DATA.match(/function forget\(key\) \{([\s\S]*?)\n  \}/);
    assert.ok(body, 'forget() is gone');
    assert.match(body[1], /delete memo\[key\]/, 'forget leaves the in-memory copy');
    assert.match(body[1], /removeItem/, 'forget leaves the sessionStorage copy, which outlives the document');
});

test('only collections the app never writes are memoised', () => {
    // `people` is written in several places in data.js (adding a person,
    // changing tags, shepherding edits). Memoising it without a forget() at
    // each of those is how you read your own edit back as it was before.
    assert.match(DATA, /function getServices\(\) \{ return remembered\("services", loadServices\); \}/);
    assert.match(DATA, /function getHymns\(\) \{ return remembered\("hymns", loadHymns\); \}/);
    assert.ok(!/remembered\("people"/.test(DATA),
        'people is memoised, but the app writes to it — every write needs forget("people") first');
});

test('the memo is its own thing, not the Firestore cache', () => {
    // local-cache.js is off because switching it on hangs the WebView. This
    // must never become a way to switch it back on by the side door.
    const memo = DATA.slice(DATA.indexOf('var TTL_MS'), DATA.indexOf('function lc('));
    assert.ok(!/enablePersistence|MosaicLocalCache|source: "cache"/.test(memo),
        'the memo reaches into the Firestore cache, which is disabled for a reason');
    assert.match(memo, /sessionStorage/, 'the memo no longer survives a shell page, which is half the trips home');
});
