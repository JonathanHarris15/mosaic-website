// MS-262 — the MCP server's tool surface, driven through a real MCP client.
//
// ⚠ WHAT THIS PROVES. Not that Firestore works (the emulator suites cover
// that) — but that every tool is actually reachable over the protocol,
// named correctly, described, and that the permission and allowlist refusals
// come back as refusals the assistant can read rather than as crashes.
//
// It runs the real SDK client against the real server over an in-memory
// transport, so the handshake, tools/list and tools/call are genuine. Only
// the data layer is substituted: each underlying module is replaced with a
// stub that records what it was asked for. That is deliberate — those
// modules are covered against real Firestore in test/emulator/, and what is
// under test here is the wiring, not the queries.

const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

const FUNCTIONS = path.join(__dirname, '..', 'functions');

// The stubs each tool should end up calling.
const calls = [];
const stubs = {
    hymnIndex: () => [{id: 'h-1', hymn_name: 'Holy Holy Holy', times_played: 4}],
    scriptureHeatmap: () => [{reference: 'John 3:16', count: 2, lastUsed: '2026-01-04'}],
    scoreTheme: () => ({uniqueness: 72, matches: []}),
    updateLiturgy: () => ({ok: true, updated: {}}),
    hymnLookup: () => ({hymns: [{hymn_name: 'Holy Holy Holy', times_played: 4}], notFound: []}),
    scriptureLookup: () => ({scripture: [{reference: 'John 3:16', count: 2}], neverUsed: []}),
    getService: (d) => ({date: d, exists: true, theme: 'The God Who Rescues', liturgy: [], people: {}}),
    getServiceRange: (f, t) => ({services: [{date: f, exists: true}], truncated: false, limit: 26}),
};

// Swap the four data modules for recorders before mcp-server.js requires
// them. Done through the module cache rather than a DI parameter because the
// point is to test the file as it actually wires itself up.
function installStubs() {
    const set = (rel, exports) => {
        const full = require.resolve(path.join(FUNCTIONS, rel));
        require.cache[full] = new Module(full, null);
        require.cache[full].filename = full;
        require.cache[full].loaded = true;
        require.cache[full].exports = exports;
    };

    set('hymn-index.js', {
        getHymnIndex: async (db, log, opts) => {
            calls.push(['hymn-index', opts]);
            return stubs.hymnIndex();
        },
        lookupHymns: async (db, args) => {
            calls.push(['hymn-lookup', args]);
            return stubs.hymnLookup(args);
        },
    });
    set('service-read.js', {
        getService: async (db, dateKey) => {
            calls.push(['service-read', dateKey]);
            return stubs.getService(dateKey);
        },
        getServiceRange: async (db, from, through) => {
            calls.push(['service-range', {from, through}]);
            return stubs.getServiceRange(from, through);
        },
    });
    set('scripture-heatmap.js', {
        getScriptureHeatmap: async (db) => {
            calls.push(['scripture-heatmap', db]);
            return stubs.scriptureHeatmap();
        },
        lookupScripture: async (db, args) => {
            calls.push(['scripture-lookup', args]);
            return stubs.scriptureLookup(args);
        },
    });
    set('theme-scoring.js', {
        scoreTheme: async (db, args) => {
            calls.push(['theme-scoring', args]);
            return stubs.scoreTheme(args);
        },
    });
    set('liturgy-writes.js', {
        updateLiturgy: async (db, args) => {
            calls.push(['liturgy-writes', args]);
            return stubs.updateLiturgy(args);
        },
    });
}

const DB = {__isFakeDb: true};
const FIELD_VALUES = {
    serverTimestamp: () => '<<server-timestamp>>',
    deleteField: () => '<<delete>>',
    // Real code passes admin.firestore.FieldPath.documentId() here; the range
    // read is stubbed out, so a marker is enough to prove it was threaded.
    documentId: () => '<<document-id>>',
};

/** Connects a real MCP client to the server, as the given caller. */
async function connectAs(permissionLevel) {
    const {Client} = await import(
        '@modelcontextprotocol/sdk/client/index.js');
    const {InMemoryTransport} = await import(
        '@modelcontextprotocol/sdk/inMemory.js');

    const {buildServer} = require(path.join(FUNCTIONS, 'mcp-server.js'));
    const server = await buildServer({
        db: DB,
        auth: {uid: 'uid-1', permissionLevel},
        geminiKey: () => 'fake-key',
        fieldValues: FIELD_VALUES,
    });

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'test-client', version: '1.0.0'});
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return {client, server};
}

/** The text of a tool result, whatever shape it came back in. */
function textOf(result) {
    return (result.content || []).map((c) => c.text || '').join('\n');
}

describe('the Order of Service MCP server', () => {
    before(() => {
        installStubs();
    });

    beforeEach(() => {
        calls.length = 0;
        stubs.updateLiturgy = () => ({ok: true, updated: {}});
        stubs.getServiceRange = (f, t) => ({services: [{date: f, exists: true}], truncated: false, limit: 26});
    });

    // ── The surface ──────────────────────────────────────────────────────

    test('offers exactly the expected oos_ tools, and every name is prefixed', async () => {
        const {client} = await connectAs('editor');
        const {tools} = await client.listTools();
        const names = tools.map((t) => t.name).sort();

        assert.deepStrictEqual(names, [
            'oos_get_hymn_history',
            'oos_get_scripture_heatmap',
            'oos_get_service',
            'oos_lookup_hymns',
            'oos_lookup_scripture',
            'oos_score_theme',
            'oos_update_liturgy',
        ]);
        names.forEach((n) => assert.ok(n.startsWith('oos_'), n));
    });

    test('every tool carries a description, so an assistant knows when to reach for it', async () => {
        const {client} = await connectAs('editor');
        const {tools} = await client.listTools();
        tools.forEach((t) => {
            assert.ok(t.description && t.description.length > 40,
                `${t.name} needs a real description`);
        });
    });

    test('the write tool advertises the liturgy fields and no person fields', async () => {
        const {client} = await connectAs('editor');
        const {tools} = await client.listTools();
        const write = tools.find((t) => t.name === 'oos_update_liturgy');
        const fields = write.inputSchema.properties.fields.properties;

        assert.ok(fields.theme, 'theme should be settable');
        assert.ok(fields.hymn1, 'hymn1 should be settable');
        assert.ok(fields.sermon, 'sermon should be settable');
        // The whole point of the allowlist.
        assert.strictEqual(fields.preacher, undefined);
        assert.strictEqual(fields.serviceLeader, undefined);
        assert.strictEqual(fields.prayerMale, undefined);
    });

    // ── Reads ────────────────────────────────────────────────────────────

    test('hymn history reaches the shared hymn-index module', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_get_hymn_history', arguments: {},
        });
        assert.ok(textOf(result).includes('Holy Holy Holy'));
        assert.strictEqual(calls[0][0], 'hymn-index');
    });

    test('scripture heatmap reaches the shared scripture-heatmap module', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_get_scripture_heatmap', arguments: {},
        });
        assert.ok(textOf(result).includes('John 3:16'));
        assert.strictEqual(calls[0][0], 'scripture-heatmap');
    });

    test('scoring passes the theme text and excludeDate straight through', async () => {
        const {client} = await connectAs('editor');
        await client.callTool({
            name: 'oos_score_theme',
            arguments: {text: '  The God Who Rescues  ', excludeDate: '2026-03-15'},
        });
        const [, args] = calls[0];
        assert.strictEqual(args.text, 'The God Who Rescues'); // trimmed
        assert.strictEqual(args.excludeDate, '2026-03-15');
    });

    test('a stale theme corpus is explained, not thrown at the user', async () => {
        const {client} = await connectAs('editor');
        const {default: _} = {default: null};
        // Re-stub just for this call.
        const full = require.resolve(path.join(FUNCTIONS, 'theme-scoring.js'));
        const original = require.cache[full].exports.scoreTheme;
        require.cache[full].exports.scoreTheme = async () => {
            const e = new Error('themes/x was embedded with a different model');
            e.reason = 'stale-corpus';
            throw e;
        };

        const result = await client.callTool({
            name: 'oos_score_theme', arguments: {text: 'Anything'},
        });
        assert.strictEqual(result.isError, true);
        assert.ok(/out of date/i.test(textOf(result)));

        require.cache[full].exports.scoreTheme = original;
    });

    // ── The write, and who may do it ─────────────────────────────────────

    test('an editor can write liturgy fields, and they reach the write module', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_update_liturgy',
            arguments: {
                dateKey: '2026-03-15',
                fields: {theme: 'The God Who Rescues'},
            },
        });
        assert.notStrictEqual(result.isError, true);

        const [, args] = calls[0];
        assert.strictEqual(args.dateKey, '2026-03-15');
        assert.deepStrictEqual(args.fields, {theme: 'The God Who Rescues'});
        assert.strictEqual(args.uid, 'uid-1');
    });

    test('a member is refused the write, and nothing reaches the write module', async () => {
        const {client} = await connectAs('member');
        const result = await client.callTool({
            name: 'oos_update_liturgy',
            arguments: {dateKey: '2026-03-15', fields: {theme: 'Nope'}},
        });
        assert.strictEqual(result.isError, true);
        assert.ok(/editors only/i.test(textOf(result)));
        assert.strictEqual(calls.length, 0, 'nothing should have been written');
    });

    test('a member is refused theme scoring too — it costs money', async () => {
        const {client} = await connectAs('member');
        const result = await client.callTool({
            name: 'oos_score_theme', arguments: {text: 'Anything'},
        });
        assert.strictEqual(result.isError, true);
        assert.strictEqual(calls.length, 0);
    });

    test('an elder, admin and super_admin are all treated as editors', async () => {
        for (const level of ['elder', 'admin', 'super_admin']) {
            calls.length = 0;
            const {client} = await connectAs(level);
            const result = await client.callTool({
                name: 'oos_update_liturgy',
                arguments: {dateKey: '2026-03-15', fields: {theme: 'X'}},
            });
            assert.notStrictEqual(result.isError, true, level);
            assert.strictEqual(calls.length, 1, level);
        }
    });

    test('a rejected field comes back as a readable refusal', async () => {
        stubs.updateLiturgy = () => ({
            ok: false, rejectedFields: ['preacher'], invalidFields: [],
        });
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_update_liturgy',
            arguments: {dateKey: '2026-03-15', fields: {theme: 'X'}},
        });
        assert.strictEqual(result.isError, true);
        assert.ok(/preacher/.test(textOf(result)));
    });

    test('an empty field set is refused before it reaches the write', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_update_liturgy',
            arguments: {dateKey: '2026-03-15', fields: {}},
        });
        assert.strictEqual(result.isError, true);
        assert.strictEqual(calls.length, 0);
    });

    test('a malformed date is rejected by the schema, before any code runs', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_update_liturgy',
            arguments: {dateKey: '15/03/2026', fields: {theme: 'X'}},
        });
        assert.strictEqual(result.isError, true);
        assert.strictEqual(calls.length, 0);
    });

    // -- Reading a Sunday back -------------------------------------------

    test('one date reads a single Sunday', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_get_service', arguments: {date: '2026-08-17'},
        });
        assert.ok(textOf(result).includes('The God Who Rescues'));
        assert.deepStrictEqual(calls[0], ['service-read', '2026-08-17']);
    });

    test('a through date reads a span instead', async () => {
        const {client} = await connectAs('editor');
        await client.callTool({
            name: 'oos_get_service',
            arguments: {date: '2026-08-17', through: '2026-09-14'},
        });
        assert.strictEqual(calls[0][0], 'service-range');
        assert.deepStrictEqual(calls[0][1],
            {from: '2026-08-17', through: '2026-09-14'});
    });

    test('a through equal to the date is just the one Sunday, not a range', async () => {
        const {client} = await connectAs('editor');
        await client.callTool({
            name: 'oos_get_service',
            arguments: {date: '2026-08-17', through: '2026-08-17'},
        });
        assert.strictEqual(calls[0][0], 'service-read');
    });

    test('a backwards range is refused rather than silently returning nothing', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_get_service',
            arguments: {date: '2026-09-14', through: '2026-08-17'},
        });
        assert.strictEqual(result.isError, true);
        assert.strictEqual(calls.length, 0);
    });

    test('a truncated range SAYS it was truncated', async () => {
        // A silently short list reads as "that is all there is", which is the
        // one wrong impression a planning conversation must not be given.
        stubs.getServiceRange = () => ({services: [], truncated: true, limit: 26});
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_get_service',
            arguments: {date: '2026-01-01', through: '2026-12-31'},
        });
        assert.match(textOf(result), /narrow the range/i);
    });

    test('a Sunday with nothing planned is an answer, not an error', async () => {
        stubs.getService = (d) => ({date: d, exists: false, liturgy: [], people: {}});
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_get_service', arguments: {date: '2030-01-06'},
        });
        assert.notStrictEqual(result.isError, true);
        assert.match(textOf(result), /"exists": false/);
        stubs.getService = (d) => ({
            date: d, exists: true, theme: 'The God Who Rescues',
            liturgy: [], people: {},
        });
    });

    test('a malformed service date never reaches the reader', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_get_service', arguments: {date: '8/17'},
        });
        assert.strictEqual(result.isError, true);
        assert.strictEqual(calls.length, 0);
    });

    // -- Asking for only what you need -----------------------------------

    test('hymn history asks for a FRESH read, never the cached one', async () => {
        // An assistant may have written a hymn moments ago; planning against
        // counts that predate its own write is the staleness that bites.
        const {client} = await connectAs('editor');
        await client.callTool({name: 'oos_get_hymn_history', arguments: {}});
        assert.deepStrictEqual(calls[0][1], {fresh: true});
    });

    test('named hymns go through to the targeted lookup', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_lookup_hymns',
            arguments: {names: ['Holy Holy Holy', 'Be Thou My Vision']},
        });
        assert.ok(textOf(result).includes('Holy Holy Holy'));
        assert.strictEqual(calls[0][0], 'hymn-lookup');
        assert.deepStrictEqual(calls[0][1].names,
            ['Holy Holy Holy', 'Be Thou My Vision']);
    });

    test('a hymn search prefix goes through too', async () => {
        const {client} = await connectAs('editor');
        await client.callTool({
            name: 'oos_lookup_hymns', arguments: {search: 'Holy'},
        });
        assert.strictEqual(calls[0][1].search, 'Holy');
    });

    test('a hymn lookup with neither names nor search is refused', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_lookup_hymns', arguments: {},
        });
        assert.strictEqual(result.isError, true);
        assert.strictEqual(calls.length, 0);
    });

    test('named scripture references go through to the targeted lookup', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_lookup_scripture', arguments: {references: ['John 3:16']},
        });
        assert.ok(textOf(result).includes('John 3:16'));
        assert.deepStrictEqual(calls[0][1].references, ['John 3:16']);
    });

    test('a book name goes through as a prefix', async () => {
        const {client} = await connectAs('editor');
        await client.callTool({
            name: 'oos_lookup_scripture', arguments: {book: 'Romans'},
        });
        assert.strictEqual(calls[0][1].book, 'Romans');
    });

    test('a scripture lookup with neither references nor book is refused', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_lookup_scripture', arguments: {},
        });
        assert.strictEqual(result.isError, true);
        assert.strictEqual(calls.length, 0);
    });

    test('the whole-history tools point the assistant at the targeted ones first', async () => {
        // The steer lives in the description; without it an assistant reaches
        // for the full dump every time, which is what this change was for.
        const {client} = await connectAs('editor');
        const {tools} = await client.listTools();
        const hymns = tools.find((t) => t.name === 'oos_get_hymn_history');
        const scripture = tools.find(
            (t) => t.name === 'oos_get_scripture_heatmap');
        assert.match(hymns.description, /oos_lookup_hymns/);
        assert.match(scripture.description, /oos_lookup_scripture/);
    });
});
