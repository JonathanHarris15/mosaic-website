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
    updateGuidance: (a) => ({ok: true, action: 'updated', slug: a.slug}),
    listGuidance: () => ([{slug: 'hymn-selection', title: 'Choosing hymns',
        summary: 'How we pick hymns.'}]),
    getGuidance: (slug) => (slug === 'hymn-selection' ?
        {slug, title: 'Choosing hymns', summary: 'How we pick hymns.',
            body: 'Prefer something not sung in eight weeks.'} : null),
    updateNote: (a) => ({ok: true, action: a.text ? 'written' : 'cleared',
        element: a.element, html: a.text ? '<p>' + a.text + '</p>' : null}),
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
    set('guidance-writes.js', {
        updateGuidance: async (db, args) => {
            calls.push(['guidance-write', args]);
            return stubs.updateGuidance(args);
        },
    });
    set('guidance-store.js', {
        listGuidance: async (db) => {
            calls.push(['guidance-list', db]);
            return stubs.listGuidance();
        },
        getGuidance: async (db, slug) => {
            calls.push(['guidance-get', slug]);
            return stubs.getGuidance(slug);
        },
    });
    set('note-writes.js', {
        updateNote: async (db, args) => {
            calls.push(['note-writes', args]);
            return stubs.updateNote(args);
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

// The origin the fake server is told it lives at. Only the seal's URL is
// built from it, so any absolute https URL will do here.
const SITE_URL = 'https://mosaic-hymn-mcp.web.app';

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
        siteUrl: SITE_URL,
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
            'oos_get_guidance',
            'oos_get_hymn_history',
            'oos_get_scripture_heatmap',
            'oos_get_service',
            'oos_list_guidance',
            'oos_lookup_hymns',
            'oos_lookup_scripture',
            'oos_score_theme',
            'oos_update_guidance',
            'oos_update_liturgy',
            'oos_update_note',
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

    // -- The comment bubble ----------------------------------------------

    test('a note reaches the note writer as plain text', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_update_note',
            arguments: {date: '2026-08-17', element: 'hymn1', note: 'Bill is away'},
        });
        assert.notStrictEqual(result.isError, true);
        assert.strictEqual(calls[0][0], 'note-writes');
        assert.strictEqual(calls[0][1].element, 'hymn1');
        assert.strictEqual(calls[0][1].text, 'Bill is away');
    });

    test('omitting the note clears it rather than failing', async () => {
        const {client} = await connectAs('editor');
        await client.callTool({
            name: 'oos_update_note',
            arguments: {date: '2026-08-17', element: 'hymn1'},
        });
        assert.strictEqual(calls[0][1].text, '');
    });

    test('a member cannot write a note, and nothing reaches the writer', async () => {
        const {client} = await connectAs('member');
        const result = await client.callTool({
            name: 'oos_update_note',
            arguments: {date: '2026-08-17', element: 'hymn1', note: 'nope'},
        });
        assert.strictEqual(result.isError, true);
        assert.strictEqual(calls.length, 0);
    });

    test('an element that carries no note is rejected by the schema', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_update_note',
            arguments: {date: '2026-08-17', element: 'preacher', note: 'x'},
        });
        assert.strictEqual(result.isError, true);
        assert.strictEqual(calls.length, 0);
    });

    test('the note tool advertises which elements can carry one', async () => {
        const {client} = await connectAs('editor');
        const {tools} = await client.listTools();
        const noteTool = tools.find((t) => t.name === 'oos_update_note');
        const allowed = noteTool.inputSchema.properties.element.enum;
        assert.ok(allowed.includes('hymn1'));
        assert.ok(allowed.includes('baptism'));
        assert.ok(!allowed.includes('preacher'));
    });

    test('the note tool tells the assistant not to send HTML', async () => {
        // The steer is the first line of defence; the escaping is the second.
        const {client} = await connectAs('editor');
        const {tools} = await client.listTools();
        const noteTool = tools.find((t) => t.name === 'oos_update_note');
        assert.match(noteTool.description, /do not send html/i);
    });

    test('the note tool says a note is separate from the element value', async () => {
        const {client} = await connectAs('editor');
        const {tools} = await client.listTools();
        const noteTool = tools.find((t) => t.name === 'oos_update_note');
        assert.match(noteTool.description, /does not change which hymn/i);
    });

    // -- Guidance --------------------------------------------------------

    test('the guidance list reaches the guidance store', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_list_guidance', arguments: {},
        });
        assert.ok(textOf(result).includes('hymn-selection'));
        assert.strictEqual(calls[0][0], 'guidance-list');
    });

    test('an empty library says so rather than looking like a failure', async () => {
        const previous = stubs.listGuidance;
        stubs.listGuidance = () => [];
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_list_guidance', arguments: {},
        });
        assert.notStrictEqual(result.isError, true);
        assert.match(textOf(result), /No guidance has been written yet/i);
        stubs.listGuidance = previous;
    });

    test('a guidance file is fetched by its address', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_get_guidance', arguments: {address: 'hymn-selection'},
        });
        assert.ok(textOf(result).includes('eight weeks'));
        assert.deepStrictEqual(calls[0], ['guidance-get', 'hymn-selection']);
    });

    test('a full URI works as an address too', async () => {
        const {client} = await connectAs('editor');
        await client.callTool({
            name: 'oos_get_guidance',
            arguments: {address: 'oos://guidance/hymn-selection'},
        });
        assert.deepStrictEqual(calls[0], ['guidance-get', 'hymn-selection']);
    });

    test('⚠ a missing guidance file is named, not returned as an empty one', async () => {
        // An assistant handed nothing would follow no guidance and never say so.
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_get_guidance', arguments: {address: 'never-written'},
        });
        assert.strictEqual(result.isError, true);
        assert.match(textOf(result), /no guidance file/i);
        assert.match(textOf(result), /oos_list_guidance/);
    });

    test('the guidance tools tell the assistant to prefer them over its own instincts', async () => {
        const {client} = await connectAs('editor');
        const {tools} = await client.listTools();
        const list = tools.find((t) => t.name === 'oos_list_guidance');
        assert.match(list.description, /before proposing/i);
        assert.match(list.description, /instincts/i);
    });

    test('guidance is offered as a resource as well as a tool', async () => {
        // Client support for resources varies; the tool is what makes it
        // reliable, the resource is what makes it discoverable.
        const {client} = await connectAs('editor');
        const {resources} = await client.listResources();
        assert.ok(resources.some((r) => r.uri === 'oos://guidance/hymn-selection'),
            JSON.stringify(resources));
    });

    test('reading the guidance resource returns the file body', async () => {
        const {client} = await connectAs('editor');
        const res = await client.readResource(
            {uri: 'oos://guidance/hymn-selection'});
        assert.match(res.contents[0].text, /eight weeks/);
    });

    // -- The assistant editing its own instructions ----------------------

    test('a guidance edit reaches the writer, stamped as coming from the assistant', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_update_guidance',
            arguments: {address: 'hymn-selection', body: 'Six weeks, not eight.'},
        });
        assert.notStrictEqual(result.isError, true);

        const [, args] = calls[0];
        assert.strictEqual(args.slug, 'hymn-selection');
        assert.deepStrictEqual(args.fields, {body: 'Six weeks, not eight.'});
        assert.strictEqual(args.source, 'assistant',
            'a machine edit attributed to the page would corrupt the history');
    });

    test('only the fields sent are passed through, so the rest can stand', async () => {
        const {client} = await connectAs('editor');
        await client.callTool({
            name: 'oos_update_guidance',
            arguments: {address: 'hymn-selection', title: 'New title'},
        });
        assert.deepStrictEqual(calls[0][1].fields, {title: 'New title'});
    });

    test('a member cannot rewrite the guidance', async () => {
        const {client} = await connectAs('member');
        const result = await client.callTool({
            name: 'oos_update_guidance',
            arguments: {address: 'hymn-selection', body: 'nope'},
        });
        assert.strictEqual(result.isError, true);
        assert.strictEqual(calls.length, 0);
    });

    test('an unusable address is refused with an example', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_update_guidance',
            arguments: {address: 'Not A Slug', body: 'x'},
        });
        assert.strictEqual(result.isError, true);
        assert.match(textOf(result), /hymn-selection/);
        assert.strictEqual(calls.length, 0);
    });

    test('sending nothing to change is refused rather than written as a no-op', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_update_guidance', arguments: {address: 'hymn-selection'},
        });
        assert.strictEqual(result.isError, true);
        assert.strictEqual(calls.length, 0);
    });

    test('⚠ the tool warns against writing down what it merely READ', async () => {
        // The escalation this guards: wording planted in a note becoming a
        // standing instruction the assistant follows for ever.
        const {client} = await connectAs('editor');
        const {tools} = await client.listTools();
        const t = tools.find((x) => x.name === 'oos_update_guidance');
        assert.match(t.description, /read rather than from the editor/i);
        assert.match(t.description, /do not write it here/i);
    });

    test('the tool says a guidance edit outlasts the Sunday being planned', async () => {
        const {client} = await connectAs('editor');
        const {tools} = await client.listTools();
        const t = tools.find((x) => x.name === 'oos_update_guidance');
        assert.match(t.description, /every Sunday from now on/i);
    });

    test('the assistant is told the change is recorded and reversible', async () => {
        const {client} = await connectAs('editor');
        const result = await client.callTool({
            name: 'oos_update_guidance',
            arguments: {address: 'hymn-selection', body: 'Changed.'},
        });
        assert.match(textOf(result), /history/i);
    });
});

// ── How the server introduces itself ─────────────────────────────────────
//
// ⚠ THE ONE PART OF THIS SERVER A PERSON SEES BEFORE ANYTHING WORKS. The
// name, title and seal are drawn in a connector list, and the seal's URL is
// fetched by that client from wherever it points — so a wrong URL here is a
// broken picture on somebody else's machine and an exception nowhere.

describe('the server\'s own identity', () => {
    // ⚠ REQUIRED LAZILY, LIKE connectAs DOES. Requiring mcp-server.js while
    // this file is still being read would load it before installStubs() has
    // swapped the data modules out, and it would hold the real ones for the
    // whole run — which surfaces as unrelated suites failing on a fake db.
    const serverInfo = (url) =>
        require(path.join(FUNCTIONS, 'mcp-server.js')).serverInfo(url);

    test('the name a client keys off is stable, and the title is for people', () => {
        const info = serverInfo(SITE_URL);
        // Renaming this orphans every client already configured against it.
        assert.strictEqual(info.name, 'mosaic-order-of-service');
        assert.strictEqual(info.title, 'Mosaic Order of Service');
    });

    test('the seal is announced as an absolute URL on this server\'s origin', () => {
        const info = serverInfo(SITE_URL);
        assert.deepStrictEqual(info.icons, [{
            src: 'https://mosaic-hymn-mcp.web.app/mosaic-seal.png',
            mimeType: 'image/png',
            sizes: ['328x328'],
        }]);
    });

    test('a trailing slash on the origin does not become a doubled one', () => {
        const info = serverInfo('https://mosaic-hymn-mcp.web.app/');
        assert.strictEqual(info.icons[0].src,
            'https://mosaic-hymn-mcp.web.app/mosaic-seal.png');
    });

    test('⚠ no origin means no icon, rather than a relative one', () => {
        // A relative src resolves against the CLIENT, not this server, so it
        // would fetch the seal from Claude's own domain and fail. Saying
        // nothing is the honest answer.
        [undefined, '', null, 'not-a-url', '/mosaic-seal.png'].forEach((bad) => {
            const info = serverInfo(bad);
            assert.strictEqual(info.icons, undefined, String(bad));
            assert.strictEqual(info.websiteUrl, undefined, String(bad));
            assert.strictEqual(info.name, 'mosaic-order-of-service',
                'the server must still introduce itself without a seal');
        });
    });

    test('a non-web origin is refused, so no client is sent to fetch a file:// path', () => {
        assert.strictEqual(serverInfo('file:///seal.png').icons, undefined);
        assert.strictEqual(serverInfo('javascript:alert(1)').icons, undefined);
    });

    test('a real connected client is handed the seal', async () => {
        // Through the actual handshake rather than the helper, because the
        // identity travels in the initialize response and nowhere else.
        const {client} = await connectAs('editor');
        const info = client.getServerVersion();
        assert.strictEqual(info.title, 'Mosaic Order of Service');
        assert.match(info.icons[0].src, /\/mosaic-seal\.png$/);
    });
});

// ── The manifest the MCP Manager page draws ──────────────────────────────
//
// ⚠ THE PAGE ASKS; IT DOES NOT KNOW. The address an editor pastes into their
// assistant comes back through this, rather than being written down a second
// time in the browser — because the failure of a wrong copy is silent. The
// editor pastes it, nothing connects, and the page still looks fine.

describe('what the MCP Manager is told', () => {
    const describeCapabilities = (deps) =>
        require(path.join(FUNCTIONS, 'mcp-server.js')).describeCapabilities(deps);

    const deps = (siteUrl) => ({
        db: DB,
        auth: {uid: 'uid-1', permissionLevel: 'editor'},
        geminiKey: () => 'fake-key',
        fieldValues: FIELD_VALUES,
        siteUrl,
    });

    test('the address an editor pastes is the origin the server announces', async () => {
        const caps = await describeCapabilities(deps(SITE_URL));
        assert.strictEqual(caps.server.endpoint,
            'https://mosaic-hymn-mcp.web.app/mcp');
        assert.strictEqual(caps.server.websiteUrl, SITE_URL);
    });

    test('the server names itself for a person as well as for a client', async () => {
        const caps = await describeCapabilities(deps(SITE_URL));
        assert.strictEqual(caps.server.name, 'mosaic-order-of-service');
        assert.strictEqual(caps.server.title, 'Mosaic Order of Service');
    });

    test('⚠ with no origin the page is told nothing, not half an address', async () => {
        // '/mcp' on its own would be copied and pasted, and would resolve
        // against whatever the editor's assistant thinks is current.
        const caps = await describeCapabilities(deps(undefined));
        assert.strictEqual(caps.server.endpoint, null);
        assert.strictEqual(caps.server.websiteUrl, null);
        assert.ok(caps.tools.length, 'the tools should still be listed');
    });

    test('the tools still come back, still split by whether they can write', async () => {
        const caps = await describeCapabilities(deps(SITE_URL));
        const writes = caps.tools.filter(t => t.writes).map(t => t.name);
        assert.ok(writes.includes('oos_update_liturgy'));
        assert.ok(!writes.includes('oos_get_service'));
    });
});
