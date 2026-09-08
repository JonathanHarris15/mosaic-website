const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const admin = require('firebase-admin');
const H = require('./harness.js');
const gs = require('../../functions/guidance-store.js');
const mcp = require('../../functions/mcp-server.js');

// The guidance an assistant pulls down, and the manifest the MCP Manager page
// draws (MS-262).
//
// ⚠ WHAT MATTERS MOST HERE. A guidance file switched off must be invisible,
// not merely unlisted. Leaving it readable by address would make the toggle a
// suggestion — an assistant told a URI once would keep following retired
// instructions, and the editor who switched it off would have no way to tell.
//
// ⚠ AND THE MANIFEST MUST COME FROM THE SERVER. The read-only half of the
// page exists to tell an editor what the assistant can actually do. A
// hand-written list would be wrong the first time somebody added a tool and
// forgot it, and a screen that confidently describes the wrong capabilities is
// worse than no screen. So describeCapabilities asks a real server through a
// real client, and this is where that is checked against real data.

const DEPS = (db) => ({
    db,
    auth: {uid: 'uid-1', permissionLevel: 'editor'},
    geminiKey: () => '',
    // The origin the live server is given. Only the seal and the address the
    // MCP Manager shows are built from it.
    siteUrl: 'https://mosaic-hymn-mcp.web.app',
    fieldValues: {
        serverTimestamp: () => null,
        deleteField: () => null,
        documentId: () => admin.firestore.FieldPath.documentId(),
    },
});

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('guidance files and the capability manifest', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();
    });

    const put = (id, fields) => db.collection('mcp_guidance').doc(id).set(
        Object.assign({
            slug: id, title: id, summary: 'A summary.',
            body: 'Some guidance.', enabled: true,
        }, fields || {}));

    // ── Listing ──────────────────────────────────────────────────────────

    test('the list carries what an assistant needs to choose, and no bodies', async () => {
        await put('hymn-selection', {
            title: 'Choosing hymns',
            summary: 'How we pick hymns.',
            body: 'A very long body that should not be in the listing.',
        });

        const files = await gs.listGuidance(db);
        assert.strictEqual(files.length, 1);
        assert.strictEqual(files[0].slug, 'hymn-selection');
        assert.strictEqual(files[0].title, 'Choosing hymns');
        assert.strictEqual(files[0].summary, 'How we pick hymns.');
        assert.strictEqual(files[0].body, undefined,
            'listing every body returns the whole library on every ask');
    });

    test('the list is in title order, so it reads the same way twice', async () => {
        await put('c', {title: 'Charlie'});
        await put('a', {title: 'Alpha'});
        await put('b', {title: 'Bravo'});

        const files = await gs.listGuidance(db);
        assert.deepStrictEqual(files.map(f => f.title),
            ['Alpha', 'Bravo', 'Charlie']);
    });

    test('nothing written yet is an empty list, not an error', async () => {
        assert.deepStrictEqual(await gs.listGuidance(db), []);
    });

    // ── Switched off means invisible ─────────────────────────────────────

    test('a switched-off file is not in the list', async () => {
        await put('live', {enabled: true});
        await put('retired', {enabled: false});

        const files = await gs.listGuidance(db);
        assert.deepStrictEqual(files.map(f => f.slug), ['live']);
    });

    test('⚠ a switched-off file cannot be read by its address either', async () => {
        await put('retired', {enabled: false, body: 'Do not follow this.'});

        const file = await gs.getGuidance(db, 'retired');
        assert.strictEqual(file, null,
            'an assistant told this address once would keep following it');
    });

    test('a file that never existed reads as nothing, rather than an empty one', async () => {
        // An empty body would be followed as "no guidance" and never mentioned.
        assert.strictEqual(await gs.getGuidance(db, 'never-written'), null);
    });

    // ── Reading one ──────────────────────────────────────────────────────

    test('a file reads back in full, body and all', async () => {
        await put('themes', {
            title: 'Themes',
            body: '# Themes\n\nRepeating one within a year needs a reason.',
        });

        const file = await gs.getGuidance(db, 'themes');
        assert.strictEqual(file.title, 'Themes');
        assert.match(file.body, /needs a reason/);
    });

    // ── The manifest the page draws ──────────────────────────────────────

    test('the manifest lists the tools an assistant genuinely sees', async () => {
        const caps = await mcp.describeCapabilities(DEPS(db));

        const names = caps.tools.map(t => t.name);
        assert.ok(names.length >= 8, `only ${names.length} tools`);
        assert.ok(names.includes('oos_update_liturgy'));
        assert.ok(names.includes('oos_list_guidance'));

        // Every name belongs to a capability group. MS-278 added `shep_` and
        // `cal_` beside `oos_`, which is exactly what the prefixes were chosen
        // to make possible — so this asserts the shape rather than the one
        // group that happened to exist first.
        names.forEach(n => assert.match(n, /^(oos|shep|cal)_/, n));
        assert.ok(names.includes('shep_write_note'));
        assert.ok(names.includes('cal_list_events'));
    });

    test('⚠ the manifest separates what can change a Sunday from what cannot', async () => {
        // This is the distinction the page is built around; getting it
        // backwards would tell an editor a write tool is harmless.
        const caps = await mcp.describeCapabilities(DEPS(db));
        const byName = Object.fromEntries(caps.tools.map(t => [t.name, t]));

        assert.strictEqual(byName['oos_update_liturgy'].writes, true);
        assert.strictEqual(byName['oos_update_note'].writes, true);
        assert.strictEqual(byName['oos_get_service'].writes, false);
        assert.strictEqual(byName['oos_lookup_hymns'].writes, false);
    });

    test('every tool in the manifest carries a description for the page to show', async () => {
        const caps = await mcp.describeCapabilities(DEPS(db));
        caps.tools.forEach((t) => {
            assert.ok(t.description && t.description.length > 40,
                `${t.name} would draw as a blank row`);
        });
    });

    test('the manifest names each tool\'s inputs', async () => {
        const caps = await mcp.describeCapabilities(DEPS(db));
        const write = caps.tools.find(t => t.name === 'oos_update_liturgy');
        assert.deepStrictEqual(write.inputs.sort(), ['dateKey', 'fields']);
    });

    test('the manifest shows the guidance the server is publishing', async () => {
        await put('hymn-selection', {title: 'Choosing hymns'});
        await put('retired', {title: 'Old advice', enabled: false});

        const caps = await mcp.describeCapabilities(DEPS(db));
        const uris = caps.resources.map(r => r.uri);

        assert.deepStrictEqual(uris, ['oos://guidance/hymn-selection'],
            'a switched-off file must not appear as available');
    });

    test('no guidance at all still produces a manifest, with no resources', async () => {
        const caps = await mcp.describeCapabilities(DEPS(db));
        assert.ok(caps.tools.length > 0, 'the tools do not depend on guidance');
        assert.deepStrictEqual(caps.resources, []);
    });
});

// ── Guidance locked to elders (MS-278) ─────────────────────────────────────
//
// ⚠ GUIDANCE IS INSTRUCTIONS AN ASSISTANT FOLLOWS. An elder-only file can name
// people and say how to handle them, so a lock that only hid the file from a
// listing would be a lock an assistant walks straight past the first time it is
// told the address — which is exactly the reasoning the `enabled` flag already
// carries, applied to the second flag.
//
// ⚠ AND THIS FILTERING IS THE REAL GATE FOR THE MCP. These reads go through the
// Admin SDK, which goes past firestore.rules entirely. The rules protect the
// browser; this protects the assistant. Neither covers the other.

const ELDER = {level: 'elder'};
const EDITOR = {level: 'editor'};

suite('guidance locked to elders', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();
        await db.collection('mcp_guidance').doc('open').set({
            slug: 'hymn-selection', title: 'Choosing hymns',
            summary: 'How we pick.', body: 'Prefer something not sung lately.',
            enabled: true, eldersOnly: false,
        });
        await db.collection('mcp_guidance').doc('locked').set({
            slug: 'red-flags', title: 'Handling a red flag',
            summary: 'What to do.', body: 'Ring the assigned elder first.',
            enabled: true, eldersOnly: true,
        });
    });

    test('an editor is not offered the locked file', async () => {
        const listed = await gs.listGuidance(db, EDITOR);
        assert.deepStrictEqual(listed.map(f => f.slug), ['hymn-selection']);
    });

    test('an elder is offered both', async () => {
        const listed = await gs.listGuidance(db, ELDER);
        assert.deepStrictEqual(
            listed.map(f => f.slug).sort(), ['hymn-selection', 'red-flags']);
    });

    test('⚠ nor can an editor fetch it by its address', async () => {
        // The whole point. A file an assistant has been told the address of
        // once would otherwise keep answering.
        assert.strictEqual(await gs.getGuidance(db, 'red-flags', EDITOR), null);
        assert.ok(await gs.getGuidance(db, 'red-flags', ELDER));
    });

    test('the refusal is the same as for a file that does not exist', async () => {
        // Saying "that one is elder-only" would confirm it exists and hand over
        // its address, which is most of what the lock is for.
        const locked = await gs.getGuidance(db, 'red-flags', EDITOR);
        const missing = await gs.getGuidance(db, 'never-existed', EDITOR);
        assert.strictEqual(locked, missing);
    });

    test('a caller with no rank at all gets only the open files', async () => {
        assert.deepStrictEqual(
            (await gs.listGuidance(db)).map(f => f.slug), ['hymn-selection']);
        assert.strictEqual(await gs.getGuidance(db, 'red-flags'), null);
    });

    test('a file written before the lock existed stays readable', async () => {
        // The field is absent on it. Absent must mean open, or turning the
        // feature on would have hidden the guidance that was already there.
        await db.collection('mcp_guidance').doc('old').set({
            slug: 'from-before', title: 'Older file', summary: 's',
            body: 'b', enabled: true,
        });

        const listed = await gs.listGuidance(db, EDITOR);
        assert.ok(listed.some(f => f.slug === 'from-before'));
        assert.ok(await gs.getGuidance(db, 'from-before', EDITOR));
    });

    test('switched off still beats the lock, both ways round', async () => {
        await db.collection('mcp_guidance').doc('locked').update({enabled: false});
        assert.strictEqual(await gs.getGuidance(db, 'red-flags', ELDER), null);
        assert.deepStrictEqual(
            (await gs.listGuidance(db, ELDER)).map(f => f.slug), ['hymn-selection']);
    });

    test('the row says whether it is locked, so the page can show it', async () => {
        const file = await gs.getGuidance(db, 'red-flags', ELDER);
        assert.strictEqual(file.eldersOnly, true);
        const open = await gs.getGuidance(db, 'hymn-selection', EDITOR);
        assert.strictEqual(open.eldersOnly, false);
    });
});
