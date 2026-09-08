// Building a Printable from an assistant (MS-359).
//
// ⚠ WHAT THIS PROVES. Four rules, and the first is the one with teeth:
//
//   1. THE RANK, AND WHY IT LIVES IN CODE. An MCP write goes through
//      firebase-admin, which never consults firestore.rules — so the
//      `isEditor()` rule guarding `printables` DOES NOT RUN for these calls.
//      `Actor.isEditor` is the only gate there is, and it must list exactly
//      what the rule lists. A test that let those two drift would be a test
//      that let a viewer publish a directory of the church's phone numbers.
//   2. HTML IS THE INTERFACE, AND IT ROUND-TRIPS. A page written as markup and
//      read back is the same page, with its wires and its repeat intact
//      (ADR-0056). If that is not true, an assistant editing a page it just
//      read silently drops whatever the round trip lost.
//   3. A REFUSAL SAVES NOTHING. Broken markup is refused by line, and the
//      record it was aimed at is left exactly as it was. A half-written page
//      is worse than no write, because nothing afterwards says so.
//   4. NO VALUE IS EVER STORED. ADR-0057: a Printable holds which field feeds
//      an element, never what that field said today.
//
// The fake db below is a Firestore stand-in that keeps documents in memory.
// It answers the handful of calls printable-writes.js makes and nothing else.

const {describe, test, beforeEach} = require('node:test');
const assert = require('node:assert');

const Actor = require('../functions/mcp-actor.js');
const Firestore = require('../functions/mcp-firestore.js');
const Printables = require('../functions/printable-writes.js');
const Core = require('../functions/shared/printable-core.js');

// The sentinels the real thing takes from firebase-admin. A fixed marker is
// enough: nothing here inspects them, they only have to survive being stored.
Firestore.bind({
    FieldValue: {serverTimestamp: () => '<when>'},
    Timestamp: {fromDate: (d) => d},
});

function fakeDb(seed = {}) {
    const store = JSON.parse(JSON.stringify(seed));
    let next = 0;
    const col = (name) => (store[name] = store[name] || {});
    return {
        store,
        collection(name) {
            return {
                get: async () => ({
                    docs: Object.keys(col(name)).map((id) => ({
                        id, data: () => col(name)[id],
                    })),
                }),
                add: async (data) => {
                    const id = `${name}-${++next}`;
                    col(name)[id] = JSON.parse(JSON.stringify(data));
                    return {id};
                },
                doc(id) {
                    return {
                        get: async () => ({
                            exists: !!col(name)[id],
                            id,
                            data: () => col(name)[id],
                        }),
                        set: async (data, options) => {
                            const now = col(name)[id];
                            col(name)[id] = (options && options.merge && now) ?
                                Object.assign({}, now, JSON.parse(JSON.stringify(data))) :
                                JSON.parse(JSON.stringify(data));
                        },
                        delete: async () => {
                            delete col(name)[id];
                        },
                    };
                },
            };
        },
    };
}

const ACTOR = {uid: 'uid-1', name: 'Jonathan Harris', personId: 'p1'};

// A person card wired to the directory: the exact shape the walkthrough asks
// for, and the one an assistant is most likely to write.
const CARD_HTML =
    '<div style="display:flex;gap:12px" data-repeat=\'{"source":"people",' +
    '"params":{"membership":"members","sort":"last"},"layout":{"direction":' +
    '"column","perLine":1,"gap":12,"maxPerPage":0},"overflow":"new-page"}\'>\n' +
    '  <img src="" style="width:80px;height:80px" data-bind=\'{"src":' +
    '{"scope":"item","field":"photo"}}\' />\n' +
    '  <p style="font-size:16px" data-bind=\'{"text":{"scope":"item",' +
    '"field":"name"}}\'>A name</p>\n' +
    '</div>';

describe('the rank an assistant must hold to lay out a page', () => {
    test('an editor and everyone above may build a Printable', () => {
        ['editor', 'admin', 'elder', 'super_admin'].forEach((level) => {
            assert.strictEqual(Actor.isEditor(level), true, level);
        });
    });

    test('a viewer, a member and an unauthenticated caller may not', () => {
        [null, undefined, '', 'viewer', 'member'].forEach((level) => {
            assert.strictEqual(Actor.isEditor(level), false, String(level));
        });
    });

    // The gate here is the ONLY one: firestore.rules never runs for an admin
    // write. If somebody widens the rule, this is what should fail first.
    test('the levels match isEditor() in firestore.rules exactly', () => {
        assert.deepStrictEqual(
            Actor.EDITOR_LEVELS.slice().sort(),
            ['admin', 'editor', 'elder', 'super_admin'],
        );
    });

    test('being an editor is not being an elder — a Person stays closed', () => {
        assert.strictEqual(Actor.isEditor('editor'), true);
        assert.strictEqual(Actor.isElder('editor'), false);
        assert.strictEqual(Actor.isElder('admin'), false);
    });

    test('the refusal names the level actually held, so it can be acted on', () => {
        const why = Actor.editorRefusalFor('member');
        assert.match(why, /"member"/);
        assert.match(why, /editor/);
    });
});

describe('starting a Printable', () => {
    let db;
    beforeEach(() => {
        db = fakeDb();
    });

    test('the paper must be chosen, never defaulted into', async () => {
        await assert.rejects(
            () => Printables.create(db, {name: 'Directory'}, ACTOR),
            /Name the paper/,
        );
    });

    test('the paper it is given is the paper it keeps, in pixels', async () => {
        const made = await Printables.create(db, {
            name: 'Membership Directory', paper: 'half_letter', dpi: 150,
        }, ACTOR);
        assert.strictEqual(made.template.paper, 'half_letter');
        assert.strictEqual(made.template.dpi, 150);
        // 5.5in x 8.5in at 150 dpi.
        assert.strictEqual(made.template.widthPx, 825);
        assert.strictEqual(made.template.heightPx, 1275);
    });

    test('it starts with one page even when none was given', async () => {
        const made = await Printables.create(db, {name: 'D', paper: 'a5'}, ACTOR);
        assert.strictEqual(made.pages, 1);
    });

    test('pages given as HTML arrive as elements', async () => {
        const made = await Printables.create(db, {
            name: 'D', paper: 'letter',
            pages: [{name: 'Cover', html: '<h1 style="font-size:40px">Directory</h1>'}],
        }, ACTOR);
        const back = await Printables.read(db, {printableId: made.id});
        assert.strictEqual(back.pages[0].name, 'Cover');
        assert.match(back.pages[0].html, /<h1[^>]*>Directory<\/h1>/);
    });

    test('markup that cannot be read is refused and nothing is created', async () => {
        await assert.rejects(
            () => Printables.create(db, {
                name: 'D', paper: 'letter', pages: [{html: '<div><p>oops</div>'}],
            }, ACTOR),
            /could not be read/,
        );
        assert.deepStrictEqual(Object.keys(db.store.printables || {}), []);
    });
});

describe('writing a page as HTML', () => {
    let db; let id;
    beforeEach(async () => {
        db = fakeDb();
        const made = await Printables.create(db,
            {name: 'Directory', paper: 'half_letter'}, ACTOR);
        id = made.id;
    });

    test('a wired, repeating card survives the round trip', async () => {
        await Printables.writePage(db, {printableId: id, pageNumber: 1, html: CARD_HTML}, ACTOR);
        const back = await Printables.read(db, {printableId: id});
        // An attribute holding JSON comes back HTML-escaped, which is correct
        // output and not what a reader wants to assert against.
        const html = back.pages[0].html.replace(/&quot;/g, '"');
        // The repeat and both wires are still there to be read and re-written.
        assert.match(html, /data-repeat=/);
        assert.match(html, /"source":"people"/);
        assert.match(html, /"field":"photo"/);
        assert.match(html, /"field":"name"/);
    });

    test('reading and writing back the same HTML changes nothing', async () => {
        await Printables.writePage(db, {printableId: id, pageNumber: 1, html: CARD_HTML}, ACTOR);
        const once = (await Printables.read(db, {printableId: id})).pages[0].html;
        await Printables.writePage(db, {printableId: id, pageNumber: 1, html: once}, ACTOR);
        const twice = (await Printables.read(db, {printableId: id})).pages[0].html;
        assert.strictEqual(twice, once);
    });

    test('no value is ever stored — only which field feeds the element', async () => {
        await Printables.writePage(db, {printableId: id, pageNumber: 1, html: CARD_HTML}, ACTOR);
        const stored = JSON.stringify(db.store.printables[id]);
        assert.match(stored, /"field":"name"/);
        // Nothing that looks like a resolved row came along.
        assert.doesNotMatch(stored, /photoUrl|@example\.com/);
    });

    test('broken markup is refused by line and the page is left alone', async () => {
        await Printables.writePage(db, {printableId: id, pageNumber: 1, html: CARD_HTML}, ACTOR);
        const before = JSON.stringify(db.store.printables[id].pages);

        await assert.rejects(
            () => Printables.writePage(db,
                {printableId: id, pageNumber: 1, html: '<div><p>no</div>'}, ACTOR),
            (e) => /could not be read/.test(e.message) && /[Ll]ine \d+/.test(e.message),
        );
        assert.strictEqual(JSON.stringify(db.store.printables[id].pages), before);
    });

    test('the page keeps its id, so a second write finds the same page', async () => {
        const first = await Printables.writePage(db,
            {printableId: id, pageNumber: 1, html: '<p>one</p>'}, ACTOR);
        const again = await Printables.writePage(db,
            {printableId: id, pageId: first.pageId, html: '<p>two</p>'}, ACTOR);
        assert.strictEqual(again.pageId, first.pageId);
        const back = await Printables.read(db, {printableId: id});
        assert.strictEqual(back.pages.length, 1);
        assert.match(back.pages[0].html, /two/);
    });

    test('a page nobody named is refused rather than guessed at', async () => {
        await assert.rejects(
            () => Printables.writePage(db, {printableId: id, html: '<p>x</p>'}, ACTOR),
            /Name which page/,
        );
    });

    test('a page number past the end is refused, and says how many there are', async () => {
        await assert.rejects(
            () => Printables.writePage(db,
                {printableId: id, pageNumber: 9, html: '<p>x</p>'}, ACTOR),
            /1 page\(s\); there is no page 9/,
        );
    });

    test('an unknown printable is refused by id', async () => {
        await assert.rejects(
            () => Printables.read(db, {printableId: 'nope'}),
            /No printable has the id "nope"/,
        );
    });
});

describe('pages, and keeping one as a template', () => {
    let db; let id;
    beforeEach(async () => {
        db = fakeDb();
        const made = await Printables.create(db, {name: 'D', paper: 'letter'}, ACTOR);
        id = made.id;
    });

    test('a page can be added at the end or put first', async () => {
        await Printables.addPage(db, {printableId: id, html: '<p>second</p>'}, ACTOR);
        const first = await Printables.addPage(db,
            {printableId: id, html: '<p>cover</p>', afterPageNumber: 0}, ACTOR);
        assert.strictEqual(first.pageNumber, 1);
        const back = await Printables.read(db, {printableId: id});
        assert.strictEqual(back.pages.length, 3);
        assert.match(back.pages[0].html, /cover/);
        assert.match(back.pages[2].html, /second/);
    });

    test('the only page cannot be deleted', async () => {
        await assert.rejects(
            () => Printables.deletePage(db, {printableId: id, pageNumber: 1}, ACTOR),
            /only page/,
        );
    });

    test('a page kept as a template brings its elements and wires with it', async () => {
        await Printables.writePage(db, {printableId: id, pageNumber: 1, html: CARD_HTML}, ACTOR);
        const saved = await Printables.savePageTemplate(db,
            {printableId: id, pageNumber: 1, name: 'Directory page'}, ACTOR);

        const templates = await Printables.listPageTemplates(db);
        const mine = templates.saved.find((t) => t.id === saved.id);
        assert.ok(mine, 'the template is listed');
        assert.strictEqual(mine.name, 'Directory page');

        // And a new Printable started from it carries the repeat across.
        const made = await Printables.create(db,
            {name: 'Guest directory', fromTemplateId: saved.id}, ACTOR);
        const back = await Printables.read(db, {printableId: made.id});
        assert.match(back.pages[0].html, /data-repeat=/);
    });

    test('the papers a new Printable may start on are offered', async () => {
        const t = await Printables.listPageTemplates(db);
        assert.ok(t.papers.some((p) => p.key === 'half_letter'));
        assert.deepStrictEqual(t.densities, Core.DENSITIES);
    });
});

describe('what a Printable may be told, and by whom', () => {
    test('an editor is offered the People and Sunday sources', () => {
        const cat = Printables.dataCatalog('editor', {});
        const keys = cat.sources.map((s) => s.key);
        assert.ok(keys.includes('people'));
        assert.ok(keys.includes('sunday'));
    });

    // The catalog is the permission boundary's first half (ADR-0057). A tool
    // that described a field the caller could not read would be teaching an
    // assistant to write a page that renders as a warning.
    test('a member is offered less than an editor', () => {
        const forMember = Printables.dataCatalog('member', {}).sources.length;
        const forEditor = Printables.dataCatalog('editor', {}).sources.length;
        assert.ok(forMember < forEditor,
            `member ${forMember} should see fewer sources than editor ${forEditor}`);
    });

    test('nothing elder-only is offered at any level', () => {
        const all = JSON.stringify(Printables.dataCatalog('super_admin', {}));
        assert.doesNotMatch(all, /shepherding|prayer request|pastoral/i);
    });

    test('it explains how to wire a field and how to repeat a box', () => {
        const cat = Printables.dataCatalog('editor', {});
        assert.match(cat.howToWire, /data-bind/);
        assert.match(cat.howToRepeat, /data-repeat/);
    });

    test('one source can be asked for, and a wrong name is refused', () => {
        const one = Printables.dataCatalog('editor', {source: 'people'});
        assert.strictEqual(one.sources.length, 1);
        assert.throws(() => Printables.dataCatalog('editor', {source: 'nope'}),
            /No source is called "nope"/);
    });
});

describe('publishing to members', () => {
    test('members may view is off until it is switched on', async () => {
        const db = fakeDb();
        const made = await Printables.create(db, {name: 'D', paper: 'a5'}, ACTOR);
        let back = await Printables.read(db, {printableId: made.id});
        assert.strictEqual(back.memberVisible, false);

        await Printables.setMemberVisible(db,
            {printableId: made.id, membersMayView: true}, ACTOR);
        back = await Printables.read(db, {printableId: made.id});
        assert.strictEqual(back.memberVisible, true);
    });
});

describe('finding what is there', () => {
    test('the list gives the id, the paper and the page count', async () => {
        const db = fakeDb();
        await Printables.create(db, {
            name: 'Membership Directory', paper: 'half_letter',
            pages: [{html: '<p>a</p>'}, {html: '<p>b</p>'}],
        }, ACTOR);
        const {printables} = await Printables.list(db);
        assert.strictEqual(printables.length, 1);
        assert.strictEqual(printables[0].name, 'Membership Directory');
        assert.strictEqual(printables[0].pages, 2);
        assert.match(printables[0].paper, /Half Letter/);
    });
});
