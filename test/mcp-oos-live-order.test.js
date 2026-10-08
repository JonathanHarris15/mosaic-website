// MS-715 — the Order of Service MCP writes, against a Sunday that follows a
// congregation's OWN Liturgy Order, end to end through the MCP handler.
//
// ⚠ WHY THIS FILE EXISTS. mcp-server.test.js stubs every data module, so it
// proves the wiring and nothing about what is accepted. That is exactly how
// the liturgy-order work (#194–#200) shipped with every write still keyed on
// the Standard seed: the read moved to the live order, the write allowlist did
// not, and the stubbed suite stayed green while `hymn6` was answered "No
// fields given" in production. Here the real liturgy-writes.js and
// note-writes.js run behind a real MCP client, over an in-memory Firestore
// that applies dot-path updates the way Firestore does.

const {describe, test, beforeEach} = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const FUNCTIONS = path.join(__dirname, '..', 'functions');

const TS = '<<server-timestamp>>';
const DEL = '<<delete>>';

// ── An in-memory Firestore, just enough of it ─────────────────────────────

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function makeDb(seed) {
    const data = {}; // collection -> id -> doc
    const writes = [];
    Object.entries(seed || {}).forEach(([col, docs]) => {
        data[col] = {};
        Object.entries(docs).forEach(([id, doc]) => { data[col][id] = clone(doc); });
    });
    const coll = (name) => (data[name] = data[name] || {});

    function setPath(obj, dotted, value) {
        const parts = dotted.split('.');
        let o = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
            o = o[parts[i]];
        }
        const last = parts[parts.length - 1];
        if (value === DEL) delete o[last];
        else o[last] = clone(value);
    }

    function deepMerge(target, src) {
        Object.entries(src).forEach(([k, v]) => {
            if (v === DEL) { delete target[k]; return; }
            if (v && typeof v === 'object' && !Array.isArray(v) &&
                target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
                deepMerge(target[k], v);
            } else {
                target[k] = clone(v);
            }
        });
    }

    const db = {
        __isFakeDb: true,
        data,
        writes,
        collection(name) {
            return {
                async get() {
                    const docs = Object.entries(coll(name)).map(([id, d]) => ({
                        id, exists: true, data: () => clone(d),
                    }));
                    return {docs, size: docs.length, empty: !docs.length};
                },
                doc(id) {
                    return {
                        id,
                        async get() {
                            const d = coll(name)[id];
                            return {id, exists: d !== undefined, data: () => clone(d)};
                        },
                        async update(paths) {
                            if (coll(name)[id] === undefined) {
                                const e = new Error('NOT_FOUND');
                                e.code = 5;
                                throw e;
                            }
                            writes.push({kind: 'update', col: name, id, paths: clone(paths)});
                            Object.entries(paths).forEach(([p, v]) => setPath(coll(name)[id], p, v));
                        },
                        async set(doc, opts) {
                            writes.push({kind: 'set', col: name, id, doc: clone(doc), opts});
                            if (opts && opts.merge && coll(name)[id]) deepMerge(coll(name)[id], doc);
                            else { coll(name)[id] = {}; deepMerge(coll(name)[id], doc); }
                        },
                    };
                },
            };
        },
    };
    return db;
}

// The congregation's re-composed Standard order, the shape the live church
// has after #197: new ids, `hymn2` reused for a DIFFERENT moment than the
// seed's `hymn2`, and prayers and a person event that hold people.
const LIVE_ORDER = {
    id: 'standard',
    name: 'Standard',
    elements: [
        {id: 'hymn', kind: 'hymn', name: 'Preparatory Hymn', hasNote: true},
        {id: 'scripture', kind: 'scripture', name: 'Call to Worship', hasNote: true},
        {id: 'hymn2', kind: 'hymn', name: 'Hymn of Praise', hasNote: true},
        {id: 'prayer', kind: 'prayer', name: 'Prayer of Confession', hasNote: true},
        {id: 'hymn3', kind: 'hymn', name: 'Hymn 3', hasNote: true},
        {id: 'hymn4', kind: 'hymn', name: 'Hymn 4', hasNote: true},
        {id: 'prayer2', kind: 'prayer', name: 'Pastoral Prayer', hasNote: true},
        {id: 'scripture2', kind: 'scripture', name: 'Sermon', hasNote: true},
        {id: 'hymn5', kind: 'hymn', name: 'Hymn 5', hasNote: true},
        {id: 'hymn6', kind: 'hymn', name: 'Hymn 6', hasNote: true},
        {id: 'hymn7', kind: 'hymn', name: 'Closing Hymn', hasNote: true},
        {id: 'prayer3', kind: 'prayer', name: 'Benediction', hasNote: false},
        {id: 'person', kind: 'person', name: 'Baptism', hasNote: true},
    ],
};
LIVE_ORDER.elementIds = LIVE_ORDER.elements.map((e) => e.id);

const DATE = '2026-10-11';

function seed() {
    return {
        liturgy_orders: {standard: LIVE_ORDER},
        users: {'uid-1': {email: 'ed@example.com', personId: 'p-ed'}},
        people: {'p-ed': {name: 'Ed Editor'}},
        services: {
            [DATE]: {
                theme: 'The God Who Rescues',
                liturgy: {hymn: {id: 'h-1', name: 'Holy Holy Holy'}},
                notes: {hymn: '<p>Slow intro</p>'},
            },
        },
    };
}

const FIELD_VALUES = {
    serverTimestamp: () => TS,
    deleteField: () => DEL,
    documentId: () => '<<document-id>>',
    FieldValue: {
        serverTimestamp: () => TS,
        arrayUnion: (v) => ({__arrayUnion: v}),
        arrayRemove: (v) => ({__arrayRemove: v}),
        delete: () => DEL,
    },
    Timestamp: {fromDate: (d) => ({__timestamp: d.toISOString()})},
};

async function connect(db) {
    const {Client} = await import('@modelcontextprotocol/sdk/client/index.js');
    const {InMemoryTransport} = await import('@modelcontextprotocol/sdk/inMemory.js');
    const {buildServer} = require(path.join(FUNCTIONS, 'mcp-server.js'));
    const server = await buildServer({
        db,
        auth: {uid: 'uid-1', permissionLevel: 'editor'},
        geminiKey: () => 'fake-key',
        fieldValues: FIELD_VALUES,
        siteUrl: 'https://mosaic-hymn-mcp.web.app',
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'test-client', version: '1.0.0'});
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return client;
}

function textOf(result) {
    return (result.content || []).map((c) => c.text || '').join('\n');
}

function jsonOf(result) {
    return JSON.parse(textOf(result));
}

describe('MS-715: oos_update_liturgy against the Sunday\'s own order', () => {
    let db;
    let client;
    beforeEach(async () => {
        db = makeDb(seed());
        client = await connect(db);
    });

    const write = (fields, dateKey) => client.callTool({
        name: 'oos_update_liturgy', arguments: {dateKey: dateKey || DATE, fields},
    });

    test('a live order id (hymn6) is written — Helm\'s probe', async () => {
        const result = await write({hymn6: {id: 'h-btmv', name: 'Be Thou My Vision'}});
        assert.notStrictEqual(result.isError, true, textOf(result));
        const svc = db.data.services[DATE];
        assert.deepStrictEqual(svc.liturgy.hymn6, {id: 'h-btmv', name: 'Be Thou My Vision'});
        assert.strictEqual(svc.updatedAt, TS);
        assert.strictEqual(svc.decidedBy.hymn6.id, 'p-ed');
        const body = jsonOf(result);
        assert.deepStrictEqual(body.written, [{field: 'hymn6', name: 'Hymn 6', kind: 'hymn'}]);
        assert.strictEqual(body.liturgyOrder.id, 'standard');
        // Everything else on the Sunday is untouched.
        assert.deepStrictEqual(svc.liturgy.hymn, {id: 'h-1', name: 'Holy Holy Holy'});
    });

    test('a hymn sent as a bare string is refused by name, with the shape a hymn takes', async () => {
        const result = await write({hymn6: 'Be Thou My Vision'});
        assert.strictEqual(result.isError, true);
        const text = textOf(result);
        assert.match(text, /hymn6 \(Hymn 6\) is a hymn/);
        assert.doesNotMatch(text, /No fields given/);
        assert.strictEqual(db.writes.length, 0);
    });

    test('a freehand hymn with no id is stored with id null', async () => {
        const result = await write({hymn5: {name: 'A New Song'}});
        assert.notStrictEqual(result.isError, true, textOf(result));
        assert.deepStrictEqual(db.data.services[DATE].liturgy.hymn5, {id: null, name: 'A New Song'});
    });

    test('a scripture element takes text', async () => {
        const result = await write({scripture2: 'John 3:16-21'});
        assert.notStrictEqual(result.isError, true, textOf(result));
        assert.strictEqual(db.data.services[DATE].liturgy.scripture2, 'John 3:16-21');
    });

    test('a seed id the order does not have is refused by name, with the valid ids, and nothing is stored', async () => {
        const result = await write({hymnMid1: {id: 'h-2', name: 'Amazing Grace'}, theme: 'New'});
        assert.strictEqual(result.isError, true);
        const text = textOf(result);
        assert.match(text, /hymnMid1/);
        assert.match(text, /"Standard" liturgy order/);
        assert.match(text, /hymn6 = Hymn 6 \(hymn\)/);
        assert.match(text, /scripture2 = Sermon \(scripture\)/);
        assert.match(text, /Nothing was written/);
        assert.strictEqual(db.writes.length, 0, 'not even the valid theme lands');
        assert.strictEqual(db.data.services[DATE].liturgy.hymnMid1, undefined);
    });

    test('hymn2 means the LIVE hymn2, and the result names which moment it is', async () => {
        const result = await write({hymn2: {id: 'h-3', name: 'Crown Him'}});
        assert.notStrictEqual(result.isError, true, textOf(result));
        assert.deepStrictEqual(jsonOf(result).written,
            [{field: 'hymn2', name: 'Hymn of Praise', kind: 'hymn'}]);
    });

    test('prayer and person elements are refused — they hold people', async () => {
        const result = await write({prayer2: 'Bill', person: 'Ann'});
        assert.strictEqual(result.isError, true);
        assert.match(textOf(result), /prayer2 \(Pastoral Prayer\)/);
        assert.match(textOf(result), /person \(Baptism\)/);
        assert.strictEqual(db.writes.length, 0);
    });

    test('a value already there is a true no-op: no write, no updatedAt, no stamp', async () => {
        const result = await write({hymn: {id: 'h-1', name: 'Holy Holy Holy'}, theme: 'The God Who Rescues'});
        assert.notStrictEqual(result.isError, true, textOf(result));
        const body = jsonOf(result);
        assert.deepStrictEqual(body.written, []);
        assert.deepStrictEqual(body.unchanged.sort(), ['hymn', 'theme']);
        assert.strictEqual(db.writes.length, 0);
        assert.strictEqual(db.data.services[DATE].updatedAt, undefined);
        assert.strictEqual(db.data.services[DATE].decidedBy, undefined);
    });

    test('a mix writes only what changed', async () => {
        await write({hymn: {id: 'h-1', name: 'Holy Holy Holy'}, hymn3: {id: 'h-9', name: 'Be Still'}});
        assert.strictEqual(db.writes.length, 1);
        const keys = Object.keys(db.writes[0].paths);
        assert.ok(keys.includes('liturgy.hymn3'));
        assert.ok(!keys.includes('liturgy.hymn'), 'an unchanged slot is not in the write');
        assert.ok(!keys.includes('decidedBy.hymn'), 'and its credit does not move');
    });

    test('the Sunday follows its own liturgyOrderId, not Standard', async () => {
        db.data.liturgy_orders.short = {
            id: 'short', name: 'Short', elements: [
                {id: 'opening', kind: 'hymn', name: 'Opening', hasNote: true},
            ],
        };
        db.data.services[DATE].liturgyOrderId = 'short';
        const refused = await write({hymn6: {id: null, name: 'X'}});
        assert.strictEqual(refused.isError, true);
        assert.match(textOf(refused), /"Short" liturgy order/);
        assert.match(textOf(refused), /opening = Opening \(hymn\)/);
        const ok = await write({opening: {id: null, name: 'X'}});
        assert.notStrictEqual(ok.isError, true, textOf(ok));
    });

    test('a Sunday with no document yet uses the congregation\'s Standard order', async () => {
        const result = await write({hymn7: {id: 'h-7', name: 'Doxology'}}, '2026-10-18');
        assert.notStrictEqual(result.isError, true, textOf(result));
        assert.deepStrictEqual(db.data.services['2026-10-18'].liturgy.hymn7, {id: 'h-7', name: 'Doxology'});
    });
});

describe('MS-715: oos_update_note against the Sunday\'s own order', () => {
    let db;
    let client;
    beforeEach(async () => {
        db = makeDb(seed());
        client = await connect(db);
    });

    const note = (element, text) => client.callTool({
        name: 'oos_update_note', arguments: {date: DATE, element, note: text},
    });

    test('a live element (hymn6) takes a note', async () => {
        const result = await note('hymn6', 'Key of D');
        assert.notStrictEqual(result.isError, true, textOf(result));
        assert.strictEqual(db.data.services[DATE].notes.hymn6, '<p>Key of D</p>');
        assert.strictEqual(jsonOf(result).elementName, 'Hymn 6');
    });

    test('a seed id the order does not have is refused by name, listing what can carry one', async () => {
        const result = await note('hymnMid1', 'x');
        assert.strictEqual(result.isError, true);
        assert.match(textOf(result), /"hymnMid1"/);
        assert.match(textOf(result), /hymn6 \(Hymn 6\)/);
        assert.strictEqual(db.writes.length, 0);
    });

    test('an element with hasNote off is refused', async () => {
        const result = await note('prayer3', 'x');
        assert.strictEqual(result.isError, true);
        assert.strictEqual(db.writes.length, 0);
    });

    test('the same note again writes nothing', async () => {
        const result = await note('hymn', 'Slow intro');
        assert.notStrictEqual(result.isError, true, textOf(result));
        assert.strictEqual(jsonOf(result).action, 'unchanged');
        assert.strictEqual(db.writes.length, 0);
        assert.strictEqual(db.data.services[DATE].updatedAt, undefined);
    });
});

describe('MS-715: printable_data_catalog reads one catalog', () => {
    test('"Which hymn" offers the live order\'s hymns, the same ones the fields list', async () => {
        const db = makeDb(seed());
        const client = await connect(db);
        const result = await client.callTool({
            name: 'printable_data_catalog', arguments: {source: 'sunday_hymns'},
        });
        assert.notStrictEqual(result.isError, true, textOf(result));
        const src = jsonOf(result).sources[0];
        const slot = src.filters.find((f) => f.key === 'slot');
        const values = slot.options.map((o) => o.value);
        assert.deepStrictEqual(values,
            ['', 'hymn', 'hymn2', 'hymn3', 'hymn4', 'hymn5', 'hymn6', 'hymn7']);
        assert.ok(!values.includes('hymnMid1'), 'no seed slot the order does not have');
        assert.strictEqual(slot.options.find((o) => o.value === 'hymn2').label, 'Hymn of Praise');

        const sunday = await client.callTool({
            name: 'printable_data_catalog', arguments: {source: 'sunday'},
        });
        const fieldKeys = jsonOf(sunday).sources[0].fields.map((f) => f.key);
        values.filter(Boolean).forEach((v) => assert.ok(fieldKeys.includes(v), v));
    });
});
