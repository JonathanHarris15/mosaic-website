// MS-246 — who decided each element of a Sunday.
//
// A small tag under each element on the Order of Service page. The thing this
// file guards is the split: RECORDED on every surface that can decide an
// element, SHOWN on only one.
//
// Record in only one place and the tag becomes a liar — silent about half the
// decisions, which is worse than having no tag at all, because a missing tag
// reads as "nobody has chosen this yet" rather than "we did not write it down".
//
// The other thing worth pinning is that the stamp travels in the SAME write as
// the value it describes. Split them and a half-failure leaves either a hymn
// nobody appears to have chosen, or somebody's name against a hymn that never
// saved.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');

global.MosaicIdentity = require('../public/mosaic-identity.js');
const Authorship = require('../public/service-authorship.js');

const ME = { id: 'p-1', name: 'Bill Smith', photoUrl: null, photoCrop: null };
const AT = 'server-stamp';
// Stands in for firebase.firestore.FieldValue.delete().
const GONE = { __delete: true };

// ── What gets stamped ──────────────────────────────────────────────────────

test('changing a hymn records who chose it', () => {
    const stamps = Authorship.stampsFor(
        { 'liturgy.hymn1': { id: 'h-1', name: 'Holy Holy Holy' } }, ME, AT);

    assert.deepStrictEqual(stamps, {
        'decidedBy.hymn1': { id: 'p-1', name: 'Bill Smith', at: AT }
    });
});

test('the stamp is keyed the same as the value, so the pair is obvious', () => {
    const stamps = Authorship.stampsFor({ 'liturgy.hymnEnd2': { id: 'h-2', name: 'It Is Well' } }, ME, AT);
    assert.ok('decidedBy.hymnEnd2' in stamps);
});

test('several slots in one save each get their own stamp', () => {
    const stamps = Authorship.stampsFor({
        'liturgy.hymn1': { id: 'h-1', name: 'Holy Holy Holy' },
        'liturgy.benediction': 'Numbers 6',
        'liturgy.scriptureReading': 'Psalm 23',
    }, ME, AT);

    assert.deepStrictEqual(Object.keys(stamps).sort(), [
        'decidedBy.benediction', 'decidedBy.hymn1', 'decidedBy.scriptureReading'
    ]);
});

test('only liturgy elements are stamped', () => {
    // The tag sits under a liturgy row. Stamping the theme or the preacher
    // would record something nothing ever draws.
    const stamps = Authorship.stampsFor({
        'liturgy.hymn1': { id: 'h-1', name: 'Holy Holy Holy' },
        theme: 'Grace',
        preacher: 'Dan Hall',
        preacherId: 'p-4',
        updatedAt: 'x',
        assignedWriter: { id: 'p-2', name: 'Ann' },
    }, ME, AT);

    assert.deepStrictEqual(Object.keys(stamps), ['decidedBy.hymn1']);
});

test('a save that changed nothing stamps nothing', () => {
    assert.deepStrictEqual(Authorship.stampsFor({}, ME, AT), {});
});

test('an account with no Person records no stamp rather than a bad one', () => {
    // A tag reading for an unknown id is worse than no tag: it claims a
    // decision has an owner and then cannot name them.
    const hymn = { id: 'h-1', name: 'Holy Holy Holy' };
    assert.deepStrictEqual(Authorship.stampsFor({ 'liturgy.hymn1': hymn }, null, AT), {});
    assert.deepStrictEqual(
        Authorship.stampsFor({ 'liturgy.hymn1': hymn }, { id: null, name: 'x' }, AT), {});
});

test('a single-field surface stamps its one slot', () => {
    // The Planning view writes one liturgy field at a time.
    const hymn = { id: 'h-1', name: 'Holy Holy Holy' };
    assert.deepStrictEqual(Authorship.stampFor('hymnMid1', hymn, ME, AT, GONE), {
        'decidedBy.hymnMid1': { id: 'p-1', name: 'Bill Smith', at: AT }
    });
    assert.deepStrictEqual(Authorship.stampFor('', hymn, ME, AT, GONE), {});
    assert.deepStrictEqual(Authorship.stampFor('hymn1', hymn, null, AT, GONE), {});
});

// ── Taking it back out takes your name with it ─────────────────────────────

test('clearing a hymn clears who chose it', () => {
    // A tag left standing over an empty row claims somebody chose the
    // emptiness, and the next person to look sees a decision nobody made.
    assert.deepStrictEqual(
        Authorship.stampsFor({ 'liturgy.hymn1': { id: null, name: '' } }, ME, AT, GONE),
        { 'decidedBy.hymn1': GONE });
});

test('clearing a scripture reference clears its tag too', () => {
    assert.deepStrictEqual(
        Authorship.stampsFor({ 'liturgy.benediction': '' }, ME, AT, GONE),
        { 'decidedBy.benediction': GONE });
    assert.deepStrictEqual(
        Authorship.stampsFor({ 'liturgy.benediction': '   ' }, ME, AT, GONE),
        { 'decidedBy.benediction': GONE });
});

test('emptying the baptism candidates clears its tag', () => {
    assert.deepStrictEqual(
        Authorship.stampsFor({ 'liturgy.baptism': [] }, ME, AT, GONE),
        { 'decidedBy.baptism': GONE });
});

test('clearing from the Planning view clears it the same way', () => {
    assert.deepStrictEqual(
        Authorship.stampFor('hymnEnd1', { id: null, name: '' }, ME, AT, GONE),
        { 'decidedBy.hymnEnd1': GONE });
});

test('a clear removes the tag even when we cannot say who cleared it', () => {
    // "We don't know who did this" is no reason to leave a wrong tag up.
    assert.deepStrictEqual(
        Authorship.stampsFor({ 'liturgy.hymn1': { id: null, name: '' } }, null, AT, GONE),
        { 'decidedBy.hymn1': GONE });
});

test('setting and clearing in one save do the right thing each', () => {
    const out = Authorship.stampsFor({
        'liturgy.hymn1': { id: 'h-1', name: 'Holy Holy Holy' },
        'liturgy.hymn2': { id: null, name: '' },
    }, ME, AT, GONE);

    assert.deepStrictEqual(out['decidedBy.hymn1'], { id: 'p-1', name: 'Bill Smith', at: AT });
    assert.strictEqual(out['decidedBy.hymn2'], GONE);
});

test('a hymn typed in freehand still counts as decided', () => {
    // No id, but a name — somebody chose it.
    assert.deepStrictEqual(
        Authorship.stampsFor({ 'liturgy.hymn1': { id: null, name: 'A New Song' } }, ME, AT, GONE),
        { 'decidedBy.hymn1': { id: 'p-1', name: 'Bill Smith', at: AT } });
});

test('what counts as empty, all the way down', () => {
    assert.strictEqual(Authorship.isBlank(null), true);
    assert.strictEqual(Authorship.isBlank(undefined), true);
    assert.strictEqual(Authorship.isBlank(''), true);
    assert.strictEqual(Authorship.isBlank('  '), true);
    assert.strictEqual(Authorship.isBlank([]), true);
    assert.strictEqual(Authorship.isBlank({}), true);
    assert.strictEqual(Authorship.isBlank({ id: null, name: '' }), true);

    assert.strictEqual(Authorship.isBlank('Psalm 23'), false);
    assert.strictEqual(Authorship.isBlank({ id: 'h-1', name: '' }), false);
    assert.strictEqual(Authorship.isBlank({ id: null, name: 'A New Song' }), false);
    assert.strictEqual(Authorship.isBlank([{ id: 'p-1' }]), false);
});

test('a removal is not nested onto a brand-new Sunday', () => {
    // That shape only ever lays down a document that does not exist, and there
    // is nothing there to take a tag off.
    assert.strictEqual(Authorship.nestStamps({ 'decidedBy.hymn1': GONE }, GONE), null);
    assert.deepStrictEqual(
        Authorship.nestStamps({ 'decidedBy.hymn1': { id: 'p-1' }, 'decidedBy.hymn2': GONE }, GONE),
        { hymn1: { id: 'p-1' } });
});

// ── Reading it back ────────────────────────────────────────────────────────

test('a decided element reports who decided it', () => {
    const svc = { decidedBy: { hymn1: { id: 'p-1', name: 'Bill Smith', at: AT } } };
    assert.strictEqual(Authorship.decidedBy(svc, 'hymn1').name, 'Bill Smith');
});

test('an element nobody has decided reports nothing', () => {
    assert.strictEqual(Authorship.decidedBy({}, 'hymn1'), null);
    assert.strictEqual(Authorship.decidedBy(null, 'hymn1'), null);
    assert.strictEqual(Authorship.decidedBy({ decidedBy: {} }, 'hymn1'), null);
    assert.strictEqual(Authorship.decidedBy({ decidedBy: { hymn1: {} } }, 'hymn1'), null);
});

test('the tag is a first name, with the whole one on hover', () => {
    const entry = { id: 'p-1', name: 'Bill Smith', at: AT };
    assert.strictEqual(Authorship.tagLabel(entry), 'Bill');
    assert.strictEqual(Authorship.tagTitle(entry), 'Bill Smith chose this');
});

test('a stamp whose name has since been lost still reads as somebody', () => {
    // The id is what makes the record true; the name is a copy taken at the
    // time. If the copy is gone, "Someone" is honest and blank is not.
    const entry = { id: 'p-1', name: '', at: AT };
    assert.strictEqual(Authorship.tagLabel(entry), 'Someone');
    assert.strictEqual(Authorship.tagTitle(entry), 'Someone chose this');
});

test('nothing at all renders no tag', () => {
    assert.strictEqual(Authorship.tagLabel(null), '');
    assert.strictEqual(Authorship.tagTitle(null), '');
});

// ── Recorded everywhere, shown in one place ────────────────────────────────

test('both surfaces that can decide an element record who did', () => {
    // The Order of Service editor and the Planning view. If a new surface ever
    // writes a liturgy field without stamping it, the tag starts lying.
    const builder = fs.readFileSync(path.join(PUBLIC, 'service-builder.js'), 'utf8');
    const calendar = fs.readFileSync(path.join(PUBLIC, 'service-calendar.js'), 'utf8');

    assert.match(builder, /ServiceAuthorship\.stampsFor\(/,
        'the Order of Service editor must stamp what it changes');
    assert.match(calendar, /ServiceAuthorship\.stampFor\(/,
        'the Planning view must stamp what it changes');
});

test('the stamp rides in the same write as the value', () => {
    const builder = fs.readFileSync(path.join(PUBLIC, 'service-builder.js'), 'utf8');
    assert.match(builder, /Object\.assign\(toSave, ServiceAuthorship\.stampsFor\(/,
        'the stamps must be merged into the update, not written separately');
});

test('the tag is shown on the Order of Service and nowhere else', () => {
    const oos = fs.readFileSync(path.join(PUBLIC, 'service-builder.html'), 'utf8');
    const calendar = fs.readFileSync(path.join(PUBLIC, 'service-calendar.html'), 'utf8');

    assert.match(oos, /decidedTag|decided-tag/, 'the Order of Service page shows it');
    assert.ok(!/decided-tag/.test(calendar),
        'the Service Calendar and Planning view deliberately do not');
});

// ── It has to survive the round trip ───────────────────────────────────────

const vm = require('node:vm');

function loadPage() {
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout() { return 0; }, clearTimeout() {}, setInterval() {}, clearInterval() {},
        Promise, Date, Object, Array, Math, String, Number, JSON, Set, Map,
        encodeURIComponent, URLSearchParams, Boolean, Error,
        module: { exports: {} },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.location = { search: '?date=2026-08-16', href: '' };
    sandbox.auth = { onAuthStateChanged() {} };
    sandbox.getUserData = async () => ({});
    sandbox.db = {};
    sandbox.document = { addEventListener() {}, getElementById() { return null; } };
    sandbox.DateUtils = require('../public/date-utils.js');
    sandbox.GuideStore = require('../public/guide-store.js');
    sandbox.MosaicIdentity = require('../public/mosaic-identity.js');
    sandbox.ServiceAuthorship = Authorship;

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'service-builder.js'), 'utf8'),
        sandbox, { filename: 'service-builder.js' });

    const page = sandbox.serviceForm();
    page.$watch = () => {};
    page.$nextTick = fn => fn();
    page.date = '2026-08-16';
    page.canEdit = true;
    page.originalService = JSON.stringify(page.service);
    return page;
}

function snapshot(data) {
    return { exists: true, metadata: { hasPendingWrites: false }, data: () => data };
}

test('a tag written by another editor reaches this page', () => {
    // Without this the tag would credit the wrong person — or nobody — until
    // somebody reloaded, which is exactly when a wrong tag is most believed.
    const page = loadPage();
    page.adoptRemoteChanges(snapshot({
        liturgy: { hymn1: { id: 'h-1', name: 'Holy Holy Holy' } },
        decidedBy: { hymn1: { id: 'p-9', name: 'Ann Lee', at: 'x' } }
    }));

    assert.strictEqual(page.decidedTag('hymn1'), 'Ann');
    assert.strictEqual(page.decidedTitle('hymn1'), 'Ann Lee chose this');
});

test('adopting a tag does not make the page look unsaved', () => {
    // The tag is a by-product of saving, never edited here. If adopting it
    // marked the page dirty, every incoming change would trigger a pointless
    // save — and that save would race the room.
    const page = loadPage();
    page.adoptRemoteChanges(snapshot({
        decidedBy: { hymn1: { id: 'p-9', name: 'Ann Lee', at: 'x' } }
    }));
    assert.strictEqual(page.isDirty, false);
});

test('an element with no tag shows none', () => {
    const page = loadPage();
    assert.strictEqual(page.decidedTag('hymn1'), '');
});

test('the first save of a brand-new Sunday still records who decided', () => {
    // set() reads a dot as part of a field NAME, so the dot-path stamps have
    // to be nested for that one write. Miss it and the very first save is the
    // one save that credits nobody.
    const nested = Authorship.nestStamps({
        'decidedBy.hymn1': { id: 'p-1', name: 'Bill Smith', at: AT },
        'liturgy.hymn1': { id: 'h-1', name: 'Holy Holy Holy' },
        updatedAt: 'x',
    });
    assert.deepStrictEqual(nested, { hymn1: { id: 'p-1', name: 'Bill Smith', at: AT } });
    assert.strictEqual(Authorship.nestStamps({}), null);
});
