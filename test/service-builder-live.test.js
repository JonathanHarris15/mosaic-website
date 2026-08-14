// MS-244 — the Order of Service keeps up with the other editors.
//
// A Sunday is one document and, on a guide-writing night, several people. The
// page used to read it once when it opened and never look again, so you worked
// all evening against the version you arrived at and found out what everybody
// else had done by reloading.
//
// The rule for a change that lands while you are here is short: a field nobody
// on this screen has touched simply takes the new value; a field this editor
// has changed is left alone until it saves. Nothing merges, and nobody is asked
// a question — the only case that could need a decision, two people in one box,
// is the case the box lock (MS-246) exists to prevent.
//
// The other thing pinned here is that the way OUT of the flat document shape
// stays in step with the way in. flattenServiceForSave and applyFlatFieldPath
// are inverses, and a round trip proves it rather than trusting two hand-kept
// lists to stay level with each other.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
    flattenServiceForSave,
    changedFieldPaths,
    applyFlatFieldPath,
    pickSaveFields,
    remoteAdoptions,
} = require('../public/service-builder.js');

const PUBLIC = path.join(__dirname, '..', 'public');

function model(overrides = {}) {
    const base = {
        theme: '',
        keyVerse: '',
        serviceLeader: { id: null, name: '' },
        musicLeader: { id: null, name: '' },
        musicHelpers: [],
        preacher: { id: null, name: '' },
        prayerPraise: { id: null, name: '' },
        prayerConfession: { id: null, name: '' },
        elements: { id: null, name: '' },
        other: { id: null, name: '' },
        hasBaptism: false,
        removedHymns: [],
        isIrregular: false,
        irregularElements: [],
        notes: {},
        liturgy: {
            preparatoryHymn: { id: null, name: '' },
            hymn1: { id: null, name: '' },
            hymn2: { id: null, name: '' },
            hymnMid1: { id: null, name: '' },
            hymnMid2: { id: null, name: '' },
            hymnEnd1: { id: null, name: '' },
            hymnEnd2: { id: null, name: '' },
            callToWorship: '',
            callToConfession: '',
            assuranceOfPardon: '',
            scriptureReading: '',
            sermon: '',
            benediction: '',
            prayerMale: { id: null, name: '' },
            prayerFemale: { id: null, name: '' },
            baptism: []
        }
    };
    return JSON.parse(JSON.stringify(Object.assign(base, overrides)));
}

// ── Flatten and its inverse must stay in step ──────────────────────────────

test('every field a save writes can be written back onto the model', () => {
    // If these two lists ever drift, a remote change to the drifted field is
    // silently dropped — the page stays stale on exactly one thing and nobody
    // can see why. So: flatten a fully-populated Sunday, push every path back
    // onto an empty one, and require the result to be identical.
    const full = model({
        theme: 'The Kindness of God',
        keyVerse: 'Romans 2:4',
        serviceLeader: { id: 'p-1', name: 'Ann Lee' },
        musicLeader: { id: 'p-2', name: 'Ben Ross' },
        musicHelpers: [{ id: 'p-3', name: 'Cara Woo' }],
        preacher: { id: 'p-4', name: 'Dan Hall' },
        prayerPraise: { id: 'p-5', name: 'Eve Park' },
        prayerConfession: { id: 'p-6', name: 'Finn Roy' },
        elements: { id: 'p-7', name: 'Gus Tate' },
        other: { id: 'p-8', name: 'Hal Vane' },
        hasBaptism: true,
        removedHymns: ['hymn2'],
        isIrregular: true,
        irregularElements: [{ key: 'Sermon', value: 'John 1' }],
        notes: { hymn1: 'check the key' },
    });
    full.liturgy.hymn1 = { id: 'h-1', name: 'Holy Holy Holy' };
    full.liturgy.hymnMid2 = { id: 'h-2', name: 'It Is Well' };
    full.liturgy.sermon = 'Romans 8:28-39';

    const flat = flattenServiceForSave(full);
    const rebuilt = model();
    for (const [p, v] of Object.entries(changedFieldPaths({}, flat))) {
        assert.strictEqual(applyFlatFieldPath(rebuilt, p, v), true,
            `no way back for the field "${p}" — flatten and its inverse have drifted`);
    }

    assert.deepStrictEqual(flattenServiceForSave(rebuilt), flat);
});

test('a liturgy slot is mutated in place, so the hymn picker keeps its object', () => {
    // The pickers bind to service.liturgy.hymn1 itself. Replace the object and
    // the picker is left holding one that is no longer on the model, and the
    // next thing typed into it goes nowhere.
    const m = model();
    const slotBefore = m.liturgy.hymn1;

    applyFlatFieldPath(m, 'liturgy.hymn1', { id: 'h-9', name: 'Abide With Me' });

    assert.strictEqual(m.liturgy.hymn1, slotBefore, 'the slot object must survive');
    assert.deepStrictEqual(m.liturgy.hymn1, { id: 'h-9', name: 'Abide With Me' });
});

test('a field this editor does not own is refused, not guessed at', () => {
    const m = model();
    assert.strictEqual(applyFlatFieldPath(m, 'guide', { format: 'v2' }), false);
    assert.strictEqual(applyFlatFieldPath(m, 'updatedAt', 123), false);
    assert.strictEqual(applyFlatFieldPath(m, 'involvementDeferred', true), false);
    assert.ok(!('guide' in m), 'a refused field must not land on the model');
});

test('the document is read down to the fields this editor owns', () => {
    const picked = pickSaveFields({
        theme: 'Grace',
        guide: { format: 'v2' },
        updatedAt: 'stamp',
        involvementDeferred: true,
        liturgy: { hymn1: { id: 'h-1', name: 'Holy Holy Holy' } }
    });

    assert.deepStrictEqual(Object.keys(picked).sort(), ['liturgy', 'theme']);
});

// ── What arrives, and what is held ─────────────────────────────────────────

test("a slot I have not touched takes the other editor's value", () => {
    const loaded = flattenServiceForSave(model());
    const mine = model();   // I have changed nothing

    const adoptions = remoteAdoptions(loaded, flattenServiceForSave(mine), {
        liturgy: Object.assign(model().liturgy, { hymn1: { id: 'h-1', name: 'Holy Holy Holy' } })
    });

    assert.deepStrictEqual(adoptions['liturgy.hymn1'], { id: 'h-1', name: 'Holy Holy Holy' });
});

test('the slot I am editing is mine until I save it', () => {
    const loaded = flattenServiceForSave(model());

    const mine = model();
    mine.liturgy.hymn1 = { id: 'h-mine', name: 'Be Thou My Vision' };

    // Somebody else wrote the same slot before I got my save away.
    const adoptions = remoteAdoptions(loaded, flattenServiceForSave(mine), {
        liturgy: Object.assign(model().liturgy, { hymn1: { id: 'h-theirs', name: 'It Is Well' } })
    });

    assert.ok(!('liturgy.hymn1' in adoptions),
        'a field under my hands must not be replaced from under them');
});

test('their hymn arrives while mine stays put', () => {
    const loaded = flattenServiceForSave(model());

    const mine = model();
    mine.liturgy.hymn1 = { id: 'h-mine', name: 'Be Thou My Vision' };

    const remote = model().liturgy;
    remote.hymn1 = { id: 'h-theirs', name: 'It Is Well' };
    remote.hymnMid2 = { id: 'h-4', name: 'Rock of Ages' };

    const adoptions = remoteAdoptions(loaded, flattenServiceForSave(mine), { liturgy: remote });

    assert.ok(!('liturgy.hymn1' in adoptions), 'mine is mine');
    assert.deepStrictEqual(adoptions['liturgy.hymnMid2'], { id: 'h-4', name: 'Rock of Ages' },
        'theirs still lands');
});

test('a document that agrees with us asks for nothing', () => {
    const m = model({ theme: 'Grace' });
    const flat = flattenServiceForSave(m);
    assert.deepStrictEqual(remoteAdoptions(flat, flat, { theme: 'Grace' }), {});
});

// ── The page ───────────────────────────────────────────────────────────────

function loadPage(overrides) {
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
    Object.assign(sandbox, overrides || {});

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

// A snapshot as Firestore hands one over.
function snapshot(data, opts = {}) {
    return {
        exists: opts.exists !== false,
        metadata: { hasPendingWrites: !!opts.pending },
        data: () => data,
    };
}

test("another editor's hymn appears on my screen", () => {
    const page = loadPage();
    page.adoptRemoteChanges(snapshot({
        liturgy: { hymn1: { id: 'h-1', name: 'Holy Holy Holy' } }
    }));

    assert.strictEqual(page.service.liturgy.hymn1.name, 'Holy Holy Holy');
});

test('a value that merely arrived is not then claimed as my edit', () => {
    // If the loaded snapshot is not moved along with the model, the next save
    // reads the adopted value as a local change and writes it straight back —
    // turning something we received into something we claim, and re-opening
    // the very race this was built to end.
    const page = loadPage();
    page.adoptRemoteChanges(snapshot({
        liturgy: { hymn1: { id: 'h-1', name: 'Holy Holy Holy' } }
    }));

    assert.strictEqual(page.isDirty, false, 'adopting is not editing');

    const mine = changedFieldPaths(
        flattenServiceForSave(JSON.parse(page.originalService)),
        flattenServiceForSave(page.service));
    assert.deepStrictEqual(mine, {}, 'the next save must have nothing to say');
});

test('my unsaved edit survives a change landing beside it', () => {
    const page = loadPage();
    page.service.liturgy.hymn1.id = 'h-mine';
    page.service.liturgy.hymn1.name = 'Be Thou My Vision';

    page.adoptRemoteChanges(snapshot({
        liturgy: {
            hymn1: { id: 'h-theirs', name: 'It Is Well' },
            hymnMid2: { id: 'h-4', name: 'Rock of Ages' }
        }
    }));

    assert.strictEqual(page.service.liturgy.hymn1.name, 'Be Thou My Vision',
        'the box under my hands must hold');
    assert.strictEqual(page.service.liturgy.hymnMid2.name, 'Rock of Ages',
        'the box nobody here is in still updates');
    assert.strictEqual(page.isDirty, true, 'my edit is still unsaved');
});

test('our own write echoing back is ignored', () => {
    const page = loadPage();
    page.service.theme = 'Grace';
    const before = JSON.stringify(page.service);

    page.adoptRemoteChanges(snapshot({ theme: 'Something Else' }, { pending: true }));

    assert.strictEqual(JSON.stringify(page.service), before);
});

test('a Sunday with no document yet is nothing to adopt', () => {
    const page = loadPage();
    const before = JSON.stringify(page.service);
    page.adoptRemoteChanges(snapshot({}, { exists: false }));
    assert.strictEqual(JSON.stringify(page.service), before);
});

test('the page subscribes to its own Sunday', () => {
    const calls = [];
    const page = loadPage({
        db: {
            collection(name) {
                return {
                    doc(id) {
                        calls.push([name, id]);
                        return { onSnapshot() { return () => {}; } };
                    }
                };
            }
        }
    });
    page.date = '2026-08-16';
    page.watchRemoteChanges();
    page.watchRemoteChanges();   // twice must not mean two listeners

    assert.deepStrictEqual(calls, [['services', '2026-08-16']]);
});
