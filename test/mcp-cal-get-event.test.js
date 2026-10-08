// MS-715 — cal_get_event reads a date of a series the way cal_list_events
// does. A stored Sunday Service occurrence carries neither its name (that is
// the series') nor its time (occurrencePayload strips it on purpose), so
// returning the raw document read `name: ''`, `time: null` for a date the
// list showed as "Sunday Service, 10:00".
//
// Through the MCP handler, with only the events store substituted: the
// merge itself is events-store.js's loadCalendar, covered elsewhere; what is
// under test is that one date is read through it.

const {test} = require('node:test');
const assert = require('node:assert');
const path = require('node:path');


const FUNCTIONS = path.join(__dirname, '..', 'functions');
const ID = 'sunday_service_2026-10-11';

const STORED = {id: ID, seriesId: 'sunday_service', date: '2026-10-11',
    stored: true, visibility: 'public', participantIds: []};
const MERGED = Object.assign({name: 'Sunday Service', seriesName: 'Sunday Service'},
    STORED, {time: '10:00'});

let calendarAsked = null;
const full = require.resolve(path.join(FUNCTIONS, 'shared', 'events-store.js'));
const real = require(full);
require.cache[full].exports = Object.assign({}, real, {
    loadOccurrence: async (db, id) => (id === ID ? Object.assign({}, STORED) : null),
    loadCalendar: async (db, opts) => {
        calendarAsked = opts;
        return [Object.assign({}, MERGED)];
    },
});


async function connectAsElder() {
    const {Client} = await import('@modelcontextprotocol/sdk/client/index.js');
    const {InMemoryTransport} = await import('@modelcontextprotocol/sdk/inMemory.js');
    const {buildServer} = require(path.join(FUNCTIONS, 'mcp-server.js'));
    const server = await buildServer({
        db: {collection: () => ({doc: () => ({get: async () => ({exists: false})})})},
        auth: {uid: 'uid-1', permissionLevel: 'elder'},
        geminiKey: () => 'k',
        fieldValues: {serverTimestamp: () => 'ts', deleteField: () => 'del',
            documentId: () => 'id', FieldValue: {serverTimestamp: () => 'ts',
                arrayUnion: (v) => v, arrayRemove: (v) => v, delete: () => 'del'},
            Timestamp: {fromDate: (d) => d}},
        siteUrl: 'https://mosaic-hymn-mcp.web.app',
    });
    const [c, s] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 't', version: '1'});
    await Promise.all([server.connect(s), client.connect(c)]);
    return client;
}

test('a stored Sunday Service date reads its series name and time', async () => {
    const client = await connectAsElder();
    const result = await client.callTool({name: 'cal_get_event', arguments: {eventId: ID}});
    assert.notStrictEqual(result.isError, true);
    const row = JSON.parse(result.content.map((c) => c.text).join(''));
    assert.strictEqual(row.name, 'Sunday Service');
    assert.strictEqual(row.time, '10:00');
    assert.strictEqual(row.stored, true);
    assert.deepStrictEqual(calendarAsked && [calendarAsked.from, calendarAsked.to],
        ['2026-10-11', '2026-10-11']);
});

test('an unknown id is still refused with the list hint', async () => {
    const client = await connectAsElder();
    const result = await client.callTool({name: 'cal_get_event', arguments: {eventId: 'nope_2026-10-11'}});
    assert.strictEqual(result.isError, true);
    assert.match(result.content.map((c) => c.text).join(''), /cal_list_events/);
});
