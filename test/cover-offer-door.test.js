const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// "The screen to offer up some of your upcoming roles for a trade only shows up
// when you are personally offered the role by the person who needs help, not
// when you go pick it up from the pool — the only thing it lets you do is
// outright take it."
//
// The model has always said otherwise: "Two doors, one record. The decliner
// invites up to three people at a time; ANYBODY ELSE MAY OFFER OFF THE COVER
// LIST UNINVITED." Trade Core has the state for it (`ORIGINS.OFFER`, which
// opens one step further along than an invitation) and the callable accepts it.
// Only the cover list never grew the button.
//
// ⚠ AND IT COULD NOT HAVE, AS THE CALLABLE STOOD. An uninvited offer needed the
// caller to name `holderId` — and the cover list DELIBERATELY does not say who
// declined (cover-store.js: "Naming the decliner would disclose something the
// list does not need"). So the one screen an uninvited offer starts from was the
// one screen that could not supply what the offer required. The holder is now
// read off the roster server-side, which closes that and also stops a caller
// filing an offer against somebody who has nothing to do with the place.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const TRADE_WRITES = read('functions', 'trade-writes.js');
const INDEX = read('functions', 'index.js');
const COVER_JS = read('public', 'cover.js');
const COVER_HTML = read('public', 'cover.html');
const COVER_STORE = read('public', 'cover-store.js');

// ── The server no longer takes the holder's word for it ──────────────────────

test('the holder of a place is read from the roster, never sent by the caller', () => {
    assert.match(TRADE_WRITES, /async function currentHolderOf\(db, ref\)/,
        'nothing reads who is actually on the place');
    assert.match(TRADE_WRITES, /const onIt = await currentHolderOf\(db, s\.assignment\)/,
        'an uninvited offer does not resolve the holder');
});

test('the callable no longer accepts a holderId at all', () => {
    // Not merely ignored — gone. A parameter that is accepted and disregarded
    // is one somebody wires up again later believing it does something.
    const block = INDEX.match(/exports\.offerTrade = onCall\(([\s\S]*?)\n\);/);
    assert.ok(block, 'the offerTrade callable is gone');

    // Comments about it are welcome — the point is that nothing READS one off
    // the request or passes one on.
    const code = block[1].replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /holderId/,
        'offerTrade still takes a holderId from the client');
});

test('an offer against a place nobody is on is refused', () => {
    assert.match(TRADE_WRITES, /return refuse\("not-found", "Nobody is on that place now\."\)/,
        'an offer against an empty place opens a Trade against nobody');
});

test('a reply to an invitation still reads its holder off the Trade', () => {
    // The two doors are one record and must stay so. A reply names no
    // assignment and no holder — both come from the document.
    assert.match(TRADE_WRITES, /let holderId = trade \? trade\.holderId : null;/,
        'a reply no longer reads the holder from the Trade it is answering');
});

// ── The cover list keeps its silence about who declined ──────────────────────

test('the cover entry still does not name the decliner', () => {
    // The whole reason the holder is resolved server-side. If this ever starts
    // carrying a person, the reasoning above changes and somebody should come
    // back and re-read the decision rather than discovering it.
    assert.match(COVER_STORE, /deliberately does NOT name who declined/i,
        'the cover entry has started naming the decliner');
});

// ── The door itself ──────────────────────────────────────────────────────────

test('the cover list offers a swap as well as a take', () => {
    assert.match(COVER_HTML, /@click="take\(row\)"/, 'taking outright has gone');
    assert.match(COVER_HTML, /@click="openOffer\(row\)"/, 'there is still no way to offer from the list');
    ['openOffer', 'sendOffer', 'offerable', 'togglePick', 'offering', 'picked', 'mine']
        .forEach(name => {
            assert.ok(COVER_JS.indexOf(name) !== -1, name + ' is bound in the markup but does not exist');
        });
});

test('an offer names something, or it is not an offer', () => {
    // ⚠ Asking nothing in return is a TAKE, and Take is right there — faster,
    // and involving nobody else. The model refuses an empty uninvited offer, so
    // the button must not be able to send one.
    assert.match(COVER_HTML, /:disabled="busyOffering \|\| !picked\.length"/,
        'the offer button can be pressed with nothing picked');
    assert.match(COVER_JS, /if \(!this\.offering \|\| this\.busyOffering \|\| !this\.picked\.length\) return;/,
        'sendOffer would fire with an empty offer');
});

test('the offer door only appears where taking is allowed', () => {
    // Offering a swap for a place you could not take even if they said yes is a
    // conversation that ends in a refusal. Both doors sit behind the same test.
    const both = COVER_HTML.match(/<div x-show="row\.permitted"[\s\S]*?<\/div>/);
    assert.ok(both, 'the two doors are no longer behind row.permitted');
    assert.match(both[0], /take\(row\)/);
    assert.match(both[0], /openOffer\(row\)/);
});

test('you cannot offer the very place you are asking for', () => {
    assert.match(COVER_JS, /r\.occurrenceId === this\.offering\.occurrenceId/,
        'the place being offered against is still in the list of what you can put up');
});

test('a liturgical place is never offered up, and neither is one you declined', () => {
    // Liturgy is set in the order of service and is not anybody's to hand over;
    // a place you have declined is looking for cover itself, so offering it
    // hands somebody a problem rather than a place.
    assert.match(COVER_JS, /services: \[\]/, 'the liturgy is being pulled into what you can offer');
    assert.match(COVER_JS, /r\.state !== 'declined'/, 'a declined place of your own can be offered');
});

test('the row stays on the list while an offer sits against it', () => {
    // Nothing is reserved by an offer. The place still needs somebody, and
    // somebody else may still take it outright — removing the row would tell
    // the reader it was settled when it is not.
    assert.match(COVER_JS, /THE ROW STAYS/,
        'the reasoning for leaving the row in place has gone, so the behaviour probably has too');
    const send = COVER_JS.match(/async sendOffer\(\)[\s\S]*?\n {12}\},/);
    assert.ok(send, 'sendOffer is gone');
    assert.doesNotMatch(send[0], /this\.rows = this\.rows\.filter/,
        'sending an offer takes the place off the list as though it were settled');
});

test('the page loads the modules the picker needs', () => {
    // Its own list of what you are down for comes from the same module the
    // Commitments page uses, so the two can never disagree about it.
    assert.match(COVER_HTML, /<script src="commitments-core\.js">/);
    assert.match(COVER_HTML, /<script src="events-store\.js">/);
    assert.match(COVER_JS, /window\.CommitmentsCore\.commitmentsFor/);
});
