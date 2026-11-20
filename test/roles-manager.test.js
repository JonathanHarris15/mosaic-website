const { test } = require('node:test');
const assert = require('node:assert');

// The Roles Manager page (MS-120). The surface, not the model: RolesCore owns
// Role Definitions, slots, restrictions, validation, and the locked liturgical
// registry, and this page renders and persists what it says.
//
// What is pinned here is what the page itself decides — who may open it, what
// reaches Firestore and what is refused before it does, and above all that the
// Relationship Type query is CONSTRAINED to shared Types (ADR-0017): an
// unconstrained one does not return fewer rows, it errors, and the error looks
// exactly like "this church has no relationship types".
//
// The Alpine template's LAYOUT is not covered; that needs a real page. What is
// covered is that every name it binds exists on the factory — see "the template
// only reaches for things the page defines". A name that does not resolve
// renders as nothing at all, with no error anywhere.

// ── An in-memory Firestore that remembers how it was queried ─────────────────

function fakeDb(seed = {}, { deny = [], failWrites = false } = {}) {
    const data = JSON.parse(JSON.stringify(seed));
    const queries = [];
    let n = 1;
    const coll = name => (data[name] = data[name] || {});
    const docsOf = name => Object.entries(coll(name)).map(([id, d]) => ({ id, data: () => d }));

    function query(name, filters) {
        return {
            where: (field, op, value) => query(name, filters.concat([{ field, op, value }])),
            orderBy: () => query(name, filters),
            get: async () => {
                queries.push({ collection: name, filters });
                if (deny.includes(name)) {
                    const e = new Error('Missing or insufficient permissions.');
                    e.code = 'permission-denied';
                    throw e;
                }
                // Firestore fails a list query outright when a returned document
                // would fail its read rule — it does NOT quietly return fewer
                // rows. The shared-records rule is modelled here so an
                // unconstrained relationship query blows up in the test exactly
                // as it would in production.
                const rows = docsOf(name).filter(doc => filters.every(f => doc.data()[f.field] === f.value));
                if (name === 'relationship_types' && rows.some(doc => doc.data().sharedWithEditors !== true)) {
                    const e = new Error('Missing or insufficient permissions.');
                    e.code = 'permission-denied';
                    throw e;
                }
                return { docs: rows, empty: rows.length === 0 };
            },
        };
    }

    let failing = failWrites;
    const guard = fn => async (...args) => {
        if (failing) throw new Error('network down');
        return fn(...args);
    };

    return {
        _data: data,
        _queries: queries,
        // Flip mid-test to model a write that fails after the user has typed.
        _failWritesFromNowOn() { failing = true; },
        collection(name) {
            return Object.assign(query(name, []), {
                add: guard(doc => {
                    const id = 'new' + (n++);
                    coll(name)[id] = JSON.parse(JSON.stringify(doc));
                    return { id };
                }),
                doc: id => ({
                    get: async () => ({
                        id,
                        exists: coll(name)[id] !== undefined,
                        data: () => coll(name)[id],
                    }),
                    // `merge` is honoured, because the difference matters: the
                    // Sunday Service series is written by this page for one
                    // field and by the seeder for the rest, and a fake that
                    // silently replaced the document would hide a real
                    // clobbering bug.
                    set: guard((doc, options) => {
                        const next = JSON.parse(JSON.stringify(doc));
                        coll(name)[id] = (options && options.merge)
                            ? { ...coll(name)[id], ...next }
                            : next;
                    }),
                    update: guard(patch => { coll(name)[id] = { ...coll(name)[id], ...patch }; }),
                    delete: guard(() => { delete coll(name)[id]; }),
                }),
            });
        },
    };
}

global.window = global;
global.AccessCore = require('../public/access-core.js');
const Roles = require('../public/roles-core.js');
require('../public/events-core.js');
require('../public/relationship-core.js');
require('../public/role-editor-core.js');
require('../public/roles-manager.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const KIDS_CLEARED = 'tag_kids';
const SABBATICAL = 'tag_sabbatical';

const TAGS = {
    [KIDS_CLEARED]: { name: 'Kids Cleared' },
    [SABBATICAL]: { name: 'On Sabbatical' },
};

const kidsDefinition = () => ({
    name: 'Kids Ministry',
    slug: 'kids_ministry',
    family: Roles.FAMILIES.SERVANT,
    slots: [
        { id: 's1', requirement: Roles.REQUIREMENTS.FEMALE },
        { id: 's2', requirement: Roles.REQUIREMENTS.EITHER },
        { id: 's3', requirement: Roles.REQUIREMENTS.EITHER },
    ],
    restrictions: [],
});

const coffeeDefinition = () => ({
    name: 'Coffee',
    slug: 'coffee',
    family: Roles.FAMILIES.SERVANT,
    slots: [{ id: 's1', requirement: Roles.REQUIREMENTS.EITHER }],
    restrictions: [],
});

// Mount the page against a seeded store and run its loads, as init() does once
// the permission gate has passed.
async function mountPage(seed = {}, { deny = [], confirmAnswer = true, rank = 'editor' } = {}) {
    global.db = fakeDb({ people_tags: TAGS, ...seed }, { deny });
    global.confirm = () => confirmAnswer;
    const page = window.RolesManager();
    // init() settles the permission level before it loads anything, because the
    // loads read it — hidden tags are filtered by who is asking.
    page.currentPermissionLevel = rank;
    await page.loadEverything();
    return page;
}

const stored = name => global.db._data[name] || {};
const queriesFor = name => global.db._queries.filter(q => q.collection === name);

// ── Who may open the page (MS-135) ───────────────────────────────────────────

test('the Roles Manager is an editor+ surface', () => {
    const page = window.RolesManager();
    for (const level of ['editor', 'elder', 'admin', 'super_admin']) {
        assert.equal(page.mayManageRoles(level), true, level + ' should reach the Roles Manager');
    }
    for (const level of ['viewer', 'member', null, undefined, 'nonsense']) {
        assert.equal(page.mayManageRoles(level), false, String(level) + ' must not reach the Roles Manager');
    }
});

// ── The one roles list (MS-136) ──────────────────────────────────────────────

test('liturgical Roles lead the list in their canonical order, servant Roles follow', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition(), r2: coffeeDefinition() } });
    const slugs = page.roles.map(r => r.slug);
    assert.deepStrictEqual(slugs.slice(0, Roles.LITURGICAL_SLUGS.length), Roles.LITURGICAL_SLUGS.slice());
    assert.deepStrictEqual(slugs.slice(Roles.LITURGICAL_SLUGS.length).sort(), ['coffee', 'kids_ministry']);
});

test('liturgical Roles come from code and are never fetched', async () => {
    await mountPage({ roles: { r1: kidsDefinition() } });
    assert.equal(queriesFor('roles').length, 1, 'the servant definitions are read once');
    assert.equal(Object.keys(stored('roles')).length, 1, 'nothing liturgical is written to /roles');
});

test('every liturgical Role reads as locked and every Servant Role as editable', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    for (const role of page.roles) {
        assert.equal(
            Roles.isLocked(role),
            role.family === Roles.FAMILIES.LITURGICAL,
            role.slug + ' has the wrong locked state'
        );
    }
});

test('with no Servant Roles defined the page invites the user to create one', async () => {
    const page = await mountPage({ roles: {} });
    assert.equal(page.hasServantRoles, false);
    const withOne = await mountPage({ roles: { r1: coffeeDefinition() } });
    assert.equal(withOne.hasServantRoles, true);
});

test('a stored definition that would take a liturgical slug is quarantined, not fatal', async () => {
    // /roles is editor-writable, so a hand-edited document can arrive claiming a
    // liturgical slug. allRoles rightly throws on that; the page must still open.
    const page = await mountPage({
        roles: {
            bad: { name: 'Preacher', slug: 'preacher', family: Roles.FAMILIES.SERVANT, slots: [{ id: 's1', requirement: 'either' }], restrictions: [] },
            r1: coffeeDefinition(),
        },
    });
    assert.deepStrictEqual(page.roles.filter(r => r.family === Roles.FAMILIES.SERVANT).map(r => r.slug), ['coffee']);
    assert.equal(page.conflictingDefinitions.length, 1);
    assert.equal(page.conflictingDefinitions[0].slug, 'preacher');
});

// ── Create, rename, delete (MS-137) ──────────────────────────────────────────

test('a new Role is only its name and what it involves', async () => {
    // Who it needs, its rules and its rest are each Event's (ADR 0085): an
    // Event that adds the Role gives it its own settings then.
    const page = await mountPage({ roles: {} }, { rank: 'super_admin' });
    await page.createRole('Greeters');
    const made = Object.values(stored('roles'))[0];
    assert.deepStrictEqual(Object.keys(made).sort(), ['description', 'family', 'name', 'slug']);
    assert.deepStrictEqual(Roles.validateDefinition(made).errors, []);
});

test('naming a Role after a liturgical Role is refused before anything is written', async () => {
    const page = await mountPage({ roles: {} });
    await page.createRole('Preacher');
    assert.deepStrictEqual(stored('roles'), {}, 'nothing may reach Firestore');
    assert.ok(page.toast.message.length, 'the refusal is explained');
    assert.match(page.toast.message, /Preacher|liturgical/i);
    assert.equal(page.toast.type, 'error');
});

test('a name that collides with an existing Servant Role slug is refused', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    await page.createRole('kids ministry');
    assert.equal(Object.keys(stored('roles')).length, 1);
    assert.equal(page.toast.type, 'error');
});

test('an unnamed Role is refused', async () => {
    const page = await mountPage({ roles: {} });
    await page.createRole('   ');
    assert.deepStrictEqual(stored('roles'), {});
});

test('renaming changes the display name and leaves the slug — serve history stays attached', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = 'Kids Team';
    await page.saveDraft();
    assert.equal(stored('roles').r1.name, 'Kids Team');
    assert.equal(stored('roles').r1.slug, 'kids_ministry', 'the slug is fixed at creation');
});

test('deleting confirms, says the serve history is kept, and removes only the definition', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    const asked = [];
    global.confirm = message => { asked.push(message); return true; };
    await page.deleteRole(page.roles.find(r => r.slug === 'kids_ministry'));
    assert.equal(asked.length, 1);
    assert.match(asked[0], /serv(ing|e)/i, 'the warning names what is kept');
    assert.match(asked[0], /kept|keep|stay/i);
    assert.deepStrictEqual(stored('roles'), {});
});

test('declining the delete confirmation leaves the Role alone', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } }, { confirmAnswer: false });
    await page.deleteRole(page.roles.find(r => r.slug === 'kids_ministry'));
    assert.equal(Object.keys(stored('roles')).length, 1);
});

test('a locked liturgical Role can be neither edited nor deleted, even if a control is reached', async () => {
    const page = await mountPage({ roles: {} });
    const preacher = page.roles.find(r => r.slug === 'preacher');
    page.startEdit(preacher);
    assert.equal(page.draft, null, 'no draft opens for a locked Role');
    await page.deleteRole(preacher);
    assert.deepStrictEqual(stored('roles'), {});
    assert.equal(page.toast.type, 'error');
});

test('an invalid definition never reaches Firestore, and every problem is reported at once', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = '';
    page.draft.description = 'x'.repeat(Roles.MAX_DESCRIPTION + 1);
    await page.saveDraft();
    assert.equal(stored('roles').r1.name, 'Kids Ministry', 'the stored Role is untouched');
    assert.ok(page.draftErrors.length >= 2, 'the name AND the description are both reported');
    assert.ok(page.draftErrors.some(e => /name/i.test(e)));
});

test('a failed write leaves the on-screen list matching what is actually stored', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = 'Kids Team';
    // The write fails after the user has already typed the new name.
    global.db._failWritesFromNowOn();
    await page.saveDraft();
    assert.equal(page.roleDefinitions.find(d => d.id === 'r1').name, 'Kids Ministry',
        'the list re-reads from the store rather than showing an unsaved name');
    assert.equal(stored('roles').r1.name, 'Kids Ministry');
    assert.equal(page.toast.type, 'error');
});

// ── The slot editor (MS-138) ─────────────────────────────────────────────────

// There is no Cancel (MS-721): a Role saves itself, and leaving it sends what
// was waiting. What leaving must never do is write a Role nobody changed.
test('leaving a Role nobody changed writes nothing', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    await page.closeRole();
    assert.equal(page.draft, null);
    assert.deepStrictEqual(stored('roles').r1, kidsDefinition());
});

// ── Tag restriction rules (MS-139) ───────────────────────────────────────────

// ── Tags an elder keeps private ──────────────────────────────────────────────
//
// `hiddenFromOthers` is an elder saying the TAG is theirs. The name is the
// private thing, so offering it in a rule picker has already leaked it.

// ── The write list, and the field that fell off it ───────────────────────────

test('what is typed into the description is what comes back on reopening', async () => {
    // The behaviour the source checks below are proxies for. Saved through the
    // real page, read back through a fresh mount, opened again for editing.
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.description = '  Arrive by 9:15 and put the urns on.  ';
    await page.saveDraft();

    assert.equal(stored('roles').r1.description, 'Arrive by 9:15 and put the urns on.',
        'the description never reached Firestore');

    const reopened = await mountPage({ roles: stored('roles'), people: PEOPLE });
    const def = reopened.roleDefinitions.find(d => d.id === 'r1');
    assert.equal(Roles.descriptionOf(def), 'Arrive by 9:15 and put the urns on.',
        'a saved description does not read back');

    reopened.startEdit(def);
    assert.equal(reopened.draft.description, 'Arrive by 9:15 and put the urns on.',
        'the editor reopens with an empty box');
});

test('clearing a description clears it, rather than leaving the old words', async () => {
    const withOne = coffeeDefinition();
    withOne.description = 'The old words.';
    const page = await mountPage({ roles: { r1: withOne }, people: PEOPLE });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.description = '';
    await page.saveDraft();

    assert.equal(stored('roles').r1.description, '');
    assert.equal(Roles.descriptionOf(stored('roles').r1), null);
});

test('EVERY field a new Role has is in the document a Role is stored as', () => {
    // ⚠ THE BUG THIS EXISTS FOR. `description` was added to the model, to the
    // form, and to five screens — and not to the object that was written. So
    // it was typed, validated, and dropped. `newDefinition` is the list of
    // what a Role has; this walks it so the next field added cannot go
    // missing quietly.
    const RoleEditor = require('../public/role-editor-core.js');
    const written = RoleEditor.definitionFrom(RoleEditor.draftFrom(Roles.newDefinition('Anything')));
    Object.keys(Roles.newDefinition('Anything')).forEach(field => {
        assert.ok(field in written, '`' + field + '` is part of a Role but is never written');
    });
});

test('a description is stored trimmed, so what is read back is what is shown', () => {
    const RoleEditor = require('../public/role-editor-core.js');
    const draft = Object.assign(RoleEditor.draftFrom(kidsDefinition()), { description: '  Arrive by nine.  ' });
    assert.equal(RoleEditor.definitionFrom(draft).description, 'Arrive by nine.');
    assert.equal(RoleEditor.definitionFrom(Object.assign(draft, { description: '   ' })).description, '');
});

// ── Relationship restriction rules (MS-140) ──────────────────────────────────

// ── How the list and the editor read (the two-pane redesign) ─────────────────
//
// The list is the navigation now: a row IS the edit control, and it has to say
// enough at a glance that you know which Role to open. These are the sentences
// it says.

test('the roles count covers the Servant Roles the list actually shows', async () => {
    // The liturgical Roles live in their own locked card and are not counted here.
    const page = await mountPage({ roles: { r1: coffeeDefinition() } });
    assert.equal(page.roleCountLabel, '1 role');
    const empty = await mountPage({ roles: {} });
    assert.equal(empty.roleCountLabel, '0 roles');
});

test('the open Role is the selected row, so the list shows where you are', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition(), r2: coffeeDefinition() } });
    const kids = page.roleDefinitions.find(d => d.id === 'r1');
    assert.equal(page.isSelected(kids), false);
    page.startEdit(kids);
    assert.equal(page.isSelected(kids), true);
    assert.equal(page.isSelected(page.roleDefinitions.find(d => d.id === 'r2')), false);
    page.closeRole();
    assert.equal(page.isSelected(kids), false);
});

test('delete acts on the stored Role, not on the half-typed draft name', async () => {
    // The narrow editor carries its own delete button, and by then the only
    // Role in view is the draft — so the confirmation has to name the Role as
    // it is actually saved.
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = 'Half-typed nam';
    const asked = [];
    global.confirm = message => { asked.push(message); return true; };
    await page.deleteRole(page.draftRole);
    assert.match(asked[0], /Kids Ministry/);
    assert.deepStrictEqual(stored('roles'), {});
});

test('deleting nothing does nothing', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    assert.equal(page.draftRole, null, 'no Role is open');
    await page.deleteRole(page.draftRole);
    assert.equal(Object.keys(stored('roles')).length, 1);
});

// ── Composing a rule from one pair of pickers ────────────────────────────────

// ── Group restriction rules (MS-141 reaching the rule builder) ───────────────
//
// The engine has understood same-group / not-same-group since MS-141; this page
// is what lets anyone author one. A church whose only Shared Type is a Group
// must not be told "nothing has been shared with editors yet".

// ── The Roles Manager on a phone (MS-99) ─────────────────────────────────────
//
// The page is opened whole inside the app's WebView with ?shell=mobile rather
// than ported to a native screen: it is the authoring home for what a Role IS,
// and a second copy of it is a second place for slots and restriction rules to
// drift from RolesCore.
//
// What that costs is chrome. The shell draws the header, the page must not draw
// a second one, and every gate the page had was written for a browser tab where
// "away from here" meant index.html. These hold both ends of that.

const fs = require('node:fs');
const path = require('node:path');
const PUBLIC = path.join(__dirname, '..', 'public');

const rolesManagerHtml = () => fs.readFileSync(path.join(PUBLIC, 'roles-manager.html'), 'utf8');
// Line endings normalised: a Windows checkout reads CRLF, and the shape
// checks below are written with \n.
const rolesManagerJs = () => fs.readFileSync(path.join(PUBLIC, 'roles-manager.js'), 'utf8').replace(/\r\n/g, '\n');

test('the Roles Manager can actually enter the phone shell', () => {
    // A page can carry every `html.shell-mobile` rule in the world and never
    // load the one script that sets the class. That has shipped before.
    const html = rolesManagerHtml();
    assert.match(html, /src="mobile-shell\.js"/, 'the page cannot enter the shell');
    assert.match(html, /href="mobile-shell\.css"/, 'the page has no shell stylesheet');
    assert.match(html, /window\.MOBILE_HEADER/, 'the page has no shell header');
    assert.match(html, /src="mobile-shell-header\.js"/, 'the page never builds its header');

    assert.ok(html.indexOf('mobile-shell.js') < html.indexOf('mobile-shell-header.js'),
        'the header is built before the page knows it is in the shell');
    assert.ok(html.indexOf('mobile-shell.js') < html.indexOf('src="roles-manager.js"'),
        'the page script runs before the shell class is set');
});

test('every phone rule on the Roles Manager has something to style', () => {
    // The general form of a whole family of bugs: a rule for a class nothing
    // carries is styling that can never fire, and it reads in review as done.
    const html = rolesManagerHtml();
    const hooks = new Set();
    const re = /html\.shell-mobile\s+\.([\w-]+)/g;
    let m;
    while ((m = re.exec(html))) hooks.add(m[1]);

    assert.ok(hooks.size, 'the phone rules moved off this page');
    hooks.forEach(hook => {
        assert.ok(new RegExp('class="[^"]*\\b' + hook + '\\b').test(html),
            'no element carries ' + hook + ', so that phone rule can never fire');
    });
});

test('the phone never draws two headers, or two back arrows', () => {
    const html = rolesManagerHtml();

    // The shell header says "Roles Manager", so the page's own title block —
    // heading and the paragraph explaining the page — stands down entirely.
    //
    // It used to stand down only in the shell, with a `display: none` rule.
    // MS-234 deleted it at every width: the list says what the page is, and the
    // paragraph was costing most of a phone screen before the first Role. So
    // the check is now that it does not exist rather than that it is hidden,
    // which is the stronger of the two.
    assert.doesNotMatch(html, /rm-title-block/,
        'the standfirst is back — the shell would print it under the shell\'s own title');

    // The page is a DRAWER DESTINATION, so its header carries a hamburger like
    // every other one. It used to carry a back arrow that asked the page what
    // back meant, and the editor skipped drawing its own as a duplicate.
    assert.match(html, /MOBILE_HEADER\s*=\s*{[^}]*menu:\s*true/,
        'the header is back to an arrow, so this page is not in the drawer');
    assert.match(html, /MOBILE_HEADER\s*=\s*{[^}]*route:\s*'rolesManager'/,
        'the drawer cannot show which row you are on without the route');

    // ⚠ WHICH MAKES THE EDITOR'S OWN ARROW THE ONLY WAY OUT OF AN OPEN ROLE.
    // A hamburger opens the drawer; it does not close a Role. So this arrow
    // must render in the shell too — gating it behind !inShell, which is what
    // it did while the header had an arrow to borrow, now strands you in the
    // editor with the list unreachable.
    const back = html.slice(0, html.indexOf('Back to the roles list'));
    assert.doesNotMatch(back.slice(-400), /<template x-if="!inShell">/,
        'an open Role has no way back to the list on a phone');
});

test('being refused never throws you out of the app', () => {
    // Both gates fire before anything renders. In a browser tab "away from here"
    // is login.html / index.html; inside the WebView those are the WEBSITE, and
    // landing there is a refusal you cannot come back from.
    const page = window.RolesManager();

    delete global.MOSAIC_SHELL;
    assert.equal(page.signInHref, 'login.html');
    assert.equal(page.homeHref, 'index.html');

    global.MOSAIC_SHELL = 'mobile';
    try {
        assert.equal(page.signInHref, 'mobile.html#/login');
        assert.equal(page.homeHref, 'mobile.html#/home');
    } finally {
        delete global.MOSAIC_SHELL;
    }

    // And the gates use them rather than the literals they replaced.
    const js = rolesManagerJs();
    assert.doesNotMatch(js, /href = 'login\.html'/, 'the sign-in gate still leaves the app');
    assert.doesNotMatch(js, /href = 'index\.html'/, 'the permission gate still leaves the app');
});

// The header on this page is a hamburger now, so nothing fires this today.
// The handler is kept for any shell header that DOES draw a back arrow, and
// this holds it to meaning what the page means by back rather than leaving
// mid-edit.
test('a shell back arrow, where one exists, closes the Role first and leaves the page second', async () => {
    const handlers = {};
    const realDocument = global.document;
    global.MOSAIC_SHELL = 'mobile';
    global.document = { addEventListener(name, fn) { (handlers[name] = handlers[name] || []).push(fn); } };
    global.location = { href: '' };

    try {
        const page = await mountPage({ roles: { r1: coffeeDefinition() } });
        page.listenForShellBack();
        const back = () => handlers['mobile-header:back'].forEach(fn => fn());

        page.startEdit(page.roleDefinitions[0]);
        back();
        assert.equal(page.draft, null, 'back left the page instead of closing the Role');
        assert.equal(global.location.href, '', 'back left the page with a Role still open');

        back();
        assert.equal(global.location.href, 'mobile.html#/home',
            'with nothing open, back does nothing at all');
    } finally {
        delete global.MOSAIC_SHELL;
        if (realDocument === undefined) delete global.document; else global.document = realDocument;
    }
});

test('an editor can actually reach the Roles Manager from a phone', () => {
    // The page gates itself, but a page nothing links to is a page nobody opens.
    const D = require('../public/mobile/destinations.js');
    assert.equal(D.SHELL_PAGES.rolesManager, 'roles-manager.html',
        'the phone has no route to the Roles Manager');
    assert.equal(D.routeHref('rolesManager'), 'roles-manager.html?shell=mobile',
        'the route opens the page outside the shell');

    const appJs = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');
    assert.match(appJs, /homeTiles\(/, 'the phone home no longer reads the shared tile list');
    const onHome = level => D.homeTiles(level).some(t => t.route === 'rolesManager');

    // The same gate as the dashboard card it mirrors — a tile offered to
    // somebody the page will bounce is worse than no tile.
    const gate = ['editor', 'elder', 'admin', 'super_admin'];
    gate.forEach(level => assert.ok(onHome(level),
        level + ' is offered the Roles Manager on the web but not on a phone'));
    ['member', 'viewer'].forEach(level => assert.equal(onHome(level), false,
        level + ' is offered a page they will be refused'));

    const page = window.RolesManager();
    gate.forEach(level => assert.equal(page.mayManageRoles(level), true));
});

test('a desktop page in the shell never reaches for a token it does not have', () => {
    // A bare `var(--x)` that nothing defines does not fall back — the whole
    // declaration is dropped, silently, leaving whatever the utility class
    // already said. That shipped once as a row border nobody could see.
    //
    // The rule used to be "always write a fallback", because the tokens lived
    // in mobile/tokens.css and only mobile.html loaded it. They are generated
    // into mosaic.css now (build/design-tokens), which this page loads at line
    // 8, so naming a real token is enough and a fallback is just a second copy
    // of the value waiting to go stale. What still has to hold is that the
    // token is real.
    const html = rolesManagerHtml();
    assert.match(html, /<link rel="stylesheet" href="mosaic\.css"/,
        'the page does not load the stylesheet its tokens come from');

    // ⚠ This list has to mirror scripts/build-design-tokens.mjs, not a subset of
    // it. It carried only colours, spacing, shadows and families, which was
    // enough while the page's own CSS reached for almost nothing — the first
    // rule to name --radius or --label-xs-size would have failed against a real
    // token. Radius, the container width and the type scale are generated too,
    // and the whole point of the check is that the token is REAL.
    const theme = require('../tailwind.config.js').theme.extend;
    const sizes = theme.fontSize || {};
    const generated = new Set([
        ...Object.keys(theme.colors || {}),
        ...Object.keys(theme.spacing || {}).map(k => 'space-' + k),
        ...Object.keys(theme.boxShadow || {}).map(k => 'shadow-' + k),
        // fontFamily also carries one alias per size role; the build emits only
        // the families that are not also a role, so neither list is wrong here.
        ...Object.keys(theme.fontFamily || {}).map(k => 'font-' + k),
        ...Object.keys(theme.maxWidth || {}).map(k => (k === 'container' ? 'container-max' : 'width-' + k)),
        ...Object.keys(theme.borderRadius || {}).map(k => (k === 'DEFAULT' ? 'radius' : 'radius-' + k)),
        ...Object.keys(sizes).flatMap(k => [k + '-size', k + '-line', k + '-spacing']),
        // Motion. It used to be the trap this test warned about — hand-written
        // AFTER the @generated marker in spacing.css, so a page naming
        // --duration lost the whole declaration. It is in the config now and
        // the build splices it into mosaic.css with everything else, which is
        // why this page is allowed to say var(--duration) again.
        ...Object.keys(theme.transitionDuration || {}).map(k => (k === 'DEFAULT' ? 'duration' : 'duration-' + k)),
        ...Object.keys(theme.transitionTimingFunction || {}).map(k => (k === 'DEFAULT' ? 'ease' : 'ease-' + k)),
    ].map(k => '--' + k));

    // Still not generated, and still the trap. --border-hairline is the design
    // system's own, below the marker, and nothing splices it into mosaic.css.
    ['--border-hairline'].forEach(t => assert.equal(generated.has(t), false,
        t + ' is generated now — this guard is stale, and the page may use it'));

    // And the motion set has to be on the other side of that line, or the
    // allowance above is letting the page name something it cannot resolve.
    ['--duration', '--duration-fast', '--duration-slow', '--ease-standard']
        .forEach(t => assert.equal(generated.has(t), true,
            t + ' has dropped out of the generated set, so every rule naming it is dropped whole'));

    // Comments are stripped first, the same way the next test does it. A note
    // saying "⚠ NOT var(--duration), it resolves to nothing here" is the most
    // useful thing that can be written next to one of these rules, and scanning
    // it as if it were a declaration makes writing it impossible.
    const raw = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const style = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const defined = new Set([...style.matchAll(/(--[\w-]+):/g)].map(m => m[1]));

    [...style.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)].forEach(m => {
        if (defined.has(m[1]) || generated.has(m[1]) || m[2] === ',') return;
        assert.fail(m[1] + ' is not a theme token, is not defined on this page, and has no fallback');
    });
});

test('the template only reaches for things the page defines', () => {
    // ⚠ A NAME THE FACTORY DOES NOT HAVE FAILS SILENTLY. Alpine evaluates the
    // expression, gets undefined, and renders nothing — no error, no warning,
    // an empty row where a Role's name should be. Which makes a renamed helper
    // the cheapest possible way to blank a section of this page, and the
    // rewrite in MS-234 touched every binding on it.
    //
    // This is the check the header of this file used to say was missing.
    const html = rolesManagerHtml();
    const DIRECTIVES = /(?:x-text|x-show|x-if|x-model(?:\.\w+)?|x-for|@click|@change|@keydown[\w.]*|:class|:value|:title|:disabled|:aria-[\w-]+|:maxlength)="([^"]*)"/g;
    const exprs = [...html.matchAll(DIRECTIVES)].map(m => m[1]);
    assert.ok(exprs.length > 40, 'the directives are not being found — this test is passing vacuously');

    // Names x-for introduces are locals, not page state, and Alpine's magics
    // belong to Alpine.
    const locals = new Set(['$event', '$el', '$refs', '$store', '$watch', '$dispatch', '$nextTick']);
    for (const [, e] of html.matchAll(/x-for="([^"]*)"/g)) {
        e.split(/\s+in\s+/)[0].trim().replace(/^\(|\)$/g, '')
            .split(',').forEach(v => locals.add(v.trim()));
    }
    const builtin = new Set(['true', 'false', 'null', 'undefined', 'new', 'typeof', 'in', 'of',
        'return', 'if', 'else', 'this', 'length', 'trim', 'indexOf', 'filter', 'map', 'find',
        'slice', 'toLowerCase', 'push', 'concat', 'includes', 'Number', 'String', 'Boolean',
        'Object', 'Array', 'Math', 'JSON']);

    const page = window.RolesManager();
    const defined = new Set(Object.getOwnPropertyNames(page));

    exprs.forEach(e => {
        const code = e
            // A template literal is mostly prose; only what is inside ${} is code.
            .replace(/`([^`]*)`/g, (_, body) => [...body.matchAll(/\$\{([^}]*)\}/g)].map(x => x[1]).join(';'))
            .replace(/'[^']*'/g, "''")
            .replace(/"[^"]*"/g, '""');
        // Leading identifiers only: `draft.name` is a question about `draft`.
        [...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].forEach(([, id]) => {
            if (builtin.has(id) || locals.has(id) || defined.has(id)) return;
            assert.fail(id + ' is bound in the template and defined nowhere on the page: ' + e);
        });
    });
});

test('the page\'s own styles are all still inside the stylesheet', () => {
    // A stray `*/` ends a comment that was never open, and everything after it
    // up to the next `*/` is parsed as garbage — the browser drops the rules in
    // between WITHOUT a word. That is how the row border above went missing on a
    // build where the rule was right there in the file, and why reading the CSS
    // as text is not enough to know it fires.
    const html = rolesManagerHtml();
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const opens = (style.match(/\/\*/g) || []).length;
    const closes = (style.match(/\*\//g) || []).length;
    assert.equal(opens, closes, 'a comment in the page\'s <style> is unbalanced');

    // And nothing outside a comment may start with prose.
    const code = style.replace(/\/\*[\s\S]*?\*\//g, '');
    code.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
        assert.ok(/[{}:;,]|^<style>$|^[.\w#[@]/.test(line),
            'this line is neither CSS nor a comment: ' + line);
    });
});

test('a phone control that must not be pressed is not rendered, not hidden', () => {
    // This one cost a day. Both duplicate controls were hidden with
    // `display: none` inside the shell, and they still fired: a tap anywhere on
    // a Role row arrived at the hidden delete button as a SYNTHESIZED click —
    // clientX/clientY 0,0, not a pointer — so every tap meant to open a Role
    // asked to delete it instead. getBoundingClientRect on the button read
    // 0,0,0x0 and elementFromPoint over the row returned the row's own name,
    // which is exactly why this was invisible from the outside.
    //
    // So the rule is: a control that must not be pressed on a phone does not
    // exist on a phone. An invisible control is still a control.
    const html = rolesManagerHtml();

    // A heading may be hidden — it does nothing when pressed. Anything that
    // ACTS may not be.
    [...html.matchAll(/html\.shell-mobile\s+\.([\w-]+)\s*{([^}]*)}/g)].forEach(([, hook, body]) => {
        if (!/display:\s*none/.test(body)) return;
        const tag = html.slice(html.lastIndexOf('<', html.indexOf('class="' + hook)));
        const opening = tag.slice(0, tag.indexOf('>'));
        assert.doesNotMatch(opening, /^<(button|a)\b|@click/,
            hook + ' is a control hidden by CSS — hidden is not the same as gone');
    });

    // NO gates left, and that is the end state rather than a regression. There
    // were two. The editor's back arrow stopped being gated when this page
    // joined the drawer — a hamburger cannot close a Role, so that arrow is the
    // only way out and always renders. The row's delete stopped being gated in
    // MS-234 because it stopped existing: delete moved into the open Role's own
    // head at every width, so there is no phone-only control left to gate.
    //
    // A gate coming back means a control has been put somewhere it has to be
    // taken away from again, which is the pattern this whole test distrusts.
    assert.equal((html.match(/x-if="!inShell"/g) || []).length, 0,
        'a control is being gated off the phone again — render it nowhere instead');

    // `inShell` itself still has to answer honestly: the page reads it for the
    // sign-in and permission gates, which send a WebView somewhere different.
    const page = window.RolesManager();
    global.MOSAIC_SHELL = 'mobile';
    try {
        assert.equal(page.inShell, true);
    } finally {
        delete global.MOSAIC_SHELL;
    }
    assert.equal(page.inShell, false, 'the web page would lose its own controls');
});

// ── The fairness fields (MS-170) ─────────────────────────────────────────────
//
// Three controls, and the one that matters most is a number that means nothing
// without its sentence: `4` is only legible as "four weeks before asking again".

const PEOPLE = {
    p1: { name: 'Ada Lovelace' },
    p2: { name: 'Grace Hopper' },
    p3: { name: 'Katherine Johnson' },
};

// ── The allowlist ────────────────────────────────────────────────────────────


// ── Liturgical intensity ─────────────────────────────────────────────────────

test('liturgical Roles are still refused by the editor — intensity is the only exception', async () => {
    const page = await mountPage({});
    page.startEdit(page.liturgicalRoles[0]);
    assert.equal(page.draft, null, 'the lock holds everywhere else');
});

// ── Who does not serve ──────────────────────────────────────────────────────
//
// ⚠ A FACT ABOUT THE PERSON, so it lives on their record. A Role's allowlist
// answers "who may do THIS"; this answers "who does none of it", and copying
// that onto each Role is how the two go out of step the next time a Role is
// added.

test('marking somebody as not serving writes it on the person, not on a Role', async () => {
    const page = await mountPage({ roles: { r1: coffeeDefinition() }, people: PEOPLE });

    await page.setDoesNotServe('p2', true);

    assert.equal(stored('people').p2.doesNotServe, true);
    assert.equal(stored('roles').r1.restrictions.length, 0,
        'no Role was touched — the next Role added would not have got the copy');
    assert.deepStrictEqual(page.nonServers.map(p => p.id), ['p2'],
        'and the screen matches without a re-read');
});

test('putting somebody back is the same one field', async () => {
    const page = await mountPage({
        roles: { r1: coffeeDefinition() },
        people: { ...PEOPLE, p2: { name: 'Grace Hopper', doesNotServe: true } },
    });
    assert.deepStrictEqual(page.nonServers.map(p => p.id), ['p2']);

    await page.setDoesNotServe('p2', false);

    assert.equal(stored('people').p2.doesNotServe, false);
    assert.deepStrictEqual(page.nonServers, []);
});

// A search, not a dropdown of the whole church: the list it adds to is short
// and the church is not.
test('the search finds people who are not on the list already', async () => {
    const page = await mountPage({
        roles: { r1: coffeeDefinition() },
        people: { ...PEOPLE, p2: { name: 'Grace Hopper', doesNotServe: true } },
    });

    page.nonServerSearch = 'grace';
    assert.deepStrictEqual(page.nonServerMatches, [], 'already on it');

    page.nonServerSearch = 'ada';
    assert.deepStrictEqual(page.nonServerMatches.map(p => p.id), ['p1']);

    page.nonServerSearch = '';
    assert.deepStrictEqual(page.nonServerMatches, [],
        'an empty box offers the whole church, which is not an offer');
});

test('a write that fails changes nothing on screen', async () => {
    const page = await mountPage(
        { roles: { r1: coffeeDefinition() }, people: PEOPLE },
        { deny: ['people'] }
    );

    await page.setDoesNotServe('p2', true);

    assert.deepStrictEqual(page.nonServers, []);
    assert.equal(page.savingNonServer, '', 'and the control is usable again');
});

// ── A Role saves itself (MS-721, ADR 0081) ───────────────────────────────────

async function mountLive(seed, opts) {
    let onNext = null;
    global.LiveFields = require('../public/live-fields-core.js');
    global.MosaicLiveRead = { watch: (ref, fn) => { onNext = fn; return () => { onNext = null; }; } };
    try {
        const page = await mountPage(seed, opts);
        page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
        return { page, remote: (data, pending) => onNext && onNext({ exists: true, data: () => data, metadata: { hasPendingWrites: !!pending } }) };
    } finally {
        delete global.LiveFields;
        delete global.MosaicLiveRead;
    }
}

test('MS-721: the Role editor has no Save or Cancel — a chip and a Retry instead', () => {
    const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'roles-manager.html'), 'utf8');
    assert.ok(!/>Save Role</.test(html) && !/@click="cancelEdit\(\)"/.test(html));
    assert.ok(html.includes('data-live-chip') && html.includes('data-live-retry'));
    assert.ok(html.includes("revertRole('name')") && html.includes("revertRole('description')"));
    assert.ok(html.includes('src="live-fields-core.js"') && html.includes('src="live-read.js"'));
});

test('MS-721: a renamed Role writes only its name (update), keeps the slug, and the list follows', async () => {
    const { page } = await mountLive({ roles: { r1: kidsDefinition() } });
    assert.ok(page.liveRole);
    page.draft.name = 'Kids Team';
    page.syncLiveRole();
    assert.equal(page.roleChip, 'unsaved');
    await page.saveDraft();
    assert.equal(stored('roles').r1.name, 'Kids Team');
    assert.equal(stored('roles').r1.slug, 'kids_ministry');
    assert.equal(stored('roles').r1.slots.length, 3, 'untouched fields stay');
    assert.equal(page.roleChip, 'saved');
    assert.ok(page.draft, 'the Role stays open after saving');
    assert.equal(page.roleDefinitions.find(d => d.id === 'r1').name, 'Kids Team');
});

test('MS-721: an invalid Role does not save and lists its problems', async () => {
    const { page } = await mountLive({ roles: { r1: kidsDefinition() } });
    page.draft.name = '';
    page.syncLiveRole();
    await page.saveDraft();
    assert.equal(stored('roles').r1.name, 'Kids Ministry');
    assert.equal(page.saveAttempted, true);
    assert.ok(page.draftErrors.some(e => /name/i.test(e)));
});

test('MS-721: a refused save says Not saved, keeps the change, and Retry sends it', async () => {
    const { page } = await mountLive({ roles: { r1: kidsDefinition() } });
    global.db._failWritesFromNowOn();
    page.draft.name = 'Kids Team';
    page.syncLiveRole();
    await page.saveDraft();
    assert.equal(page.roleChip, 'failed');
    assert.equal(page.draft.name, 'Kids Team');
    assert.equal(page.toast.type, 'error');
});

test('MS-721: leaving a Role sends what was waiting', async () => {
    const { page } = await mountLive({ roles: { r1: kidsDefinition(), r2: coffeeDefinition() } });
    page.draft.description = 'Arrive by nine.';
    page.syncLiveRole();
    await page.closeRole();
    assert.equal(stored('roles').r1.description, 'Arrive by nine.');
});

test('MS-721: another editor\'s change lands in fields this editor is not changing', async () => {
    const { page, remote } = await mountLive({ roles: { r1: kidsDefinition() } });
    page.draft.name = 'Mine';
    page.syncLiveRole();
    remote(Object.assign(kidsDefinition(), { name: 'Theirs', description: 'From elsewhere' }));
    assert.equal(page.draft.name, 'Mine');
    assert.equal(page.draft.description, 'From elsewhere');
});

test('MS-721: only roles.manager.edit gets a live editor (the rule on roles)', async () => {
    const Levels = require('../public/account-levels-core.js');
    const member = Levels.buildPresetPermissions(Levels.PRESET_MEMBER);
    const page = window.RolesManager();
    assert.equal(page.mayManageRoles({ permissionLevel: 'member', accountLevelId: 'level_custom_x', permissions: Object.assign({}, member, { 'roles.manager.edit': true }) }), true);
    assert.equal(page.mayManageRoles({ permissionLevel: 'member', accountLevelId: 'level_custom_x', permissions: Object.assign({}, member, { 'printables.edit': true }) }), false);
    const { page: viewerPage } = await mountLive({ roles: { r1: kidsDefinition() } }, { rank: 'viewer' });
    assert.equal(viewerPage.liveRole, null);
    viewerPage.draft.name = 'Nope';
    await viewerPage.saveDraft();
    assert.equal(stored('roles').r1.name, 'Kids Ministry');
});

// ── MS-721 lead call: without roles.manager.edit the page reads, not edits ──

test('MS-721: the write entry points refuse without roles.manager.edit', () => {
    const js = rolesManagerJs();
    for (const fn of ['async createRole(name) {\n        if (!this.canManageRoles) return;',
        'async deleteRole(role) {\n        if (!role || !this.canManageRoles) return;',
        'if (!personId || this.savingNonServer || !this.canSetDoesNotServe) return;',
        'if (!id || this.savingNonServing || !this.canSetDoesNotServe) return;']) {
        assert.ok(js.indexOf(fn) !== -1, fn);
    }
});

test('MS-721: "Doesn\'t serve" follows its own rule, not roles.manager.edit', () => {
    // Liturgical rest moved to the Sunday Service's own Roles & rules tab
    // (ADR 0085), which is calendar.events.edit like every other Event write.
    const html = rolesManagerHtml();
    assert.match(html, /x-show="canSetDoesNotServe" class="m-seg m-seg--fill"/);
    assert.match(html, /x-show="canSetDoesNotServe && nsKind === 'person'"/);
    const js = rolesManagerJs();
    assert.match(js, /AccessCore\.EDITOR_WRITE_LEVELS\.indexOf\(AccessCore\.permissionLevelOf\(who\)\)/);
    assert.equal(js.indexOf('canSetLiturgicalRest'), -1, 'liturgical rest is not this page\'s any more');
});

// ── One Role open at a time, and it writes only itself ──────────────────────
//
// ⚠ The bug report: "creating or renaming a Role renames or overwrites the
// Roles around it". Opening Role B used to swap the page's draft to B and
// THEN stop Role A's session — which flushed A's session with B's values and
// wrote B's name, slots and rules over A. Creating a Role opened it the same
// way, over whichever Role was open.

const pause = () => new Promise(r => setImmediate(r));

test('opening another Role leaves the first one exactly as stored', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition(), r2: coffeeDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r2'));
    await pause();
    assert.deepStrictEqual(stored('roles').r1, kidsDefinition());
    assert.deepStrictEqual(stored('roles').r2, coffeeDefinition());
    assert.deepStrictEqual(page.roleDefinitions.map(d => d.name).sort(), ['Coffee', 'Kids Ministry']);
});

test('creating a Role leaves the open one exactly as stored', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    await page.createRole('Greeters');
    await pause();
    assert.deepStrictEqual(stored('roles').r1, kidsDefinition());
    assert.equal(page.draft.name, 'Greeters', 'and the new Role is the one open');
    assert.deepStrictEqual(page.roleDefinitions.map(d => d.name), ['Greeters', 'Kids Ministry']);
});

test('a rename still waiting when another Role opens goes to the renamed Role, and only there', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition(), r2: coffeeDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = 'Kids Team';
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r2'));
    await pause();
    assert.equal(stored('roles').r1.name, 'Kids Team');
    assert.deepStrictEqual(stored('roles').r1.slots, kidsDefinition().slots);
    assert.deepStrictEqual(stored('roles').r2, coffeeDefinition());
    assert.equal(page.draft.name, 'Coffee');
    assert.equal(page.roleDefinitions.find(d => d.id === 'r1').name, 'Kids Team');
});

test('a save that lands after its Role was left puts that row right and leaves the open Role alone', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition(), r2: coffeeDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = 'Kids Team';
    page.syncLiveRole();
    const sending = page.saveDraft();
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r2'));
    await sending;
    await pause();
    assert.equal(page.draft.name, 'Coffee');
    assert.equal(page.draftId, 'r2');
    assert.equal(page.roleChip, 'saved');
    assert.equal(page.roleDefinitions.find(d => d.id === 'r1').name, 'Kids Team');
});

test('deleting the open Role drops what it was waiting to save, rather than failing after the delete', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = 'Half typed';
    page.syncLiveRole();
    await page.deleteRole(page.draftRole);
    await pause();
    assert.equal(stored('roles').r1, undefined);
    assert.equal(page.draft, null);
    assert.equal(page.toast.type, 'success', page.toast.message);
});

test('renaming a Role stored without a slug keeps the slug its history is under', async () => {
    const legacy = kidsDefinition();
    delete legacy.slug;
    const page = await mountPage({ roles: { r1: legacy } });
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.name = 'Children';
    await page.saveDraft();
    assert.equal(stored('roles').r1.slug, 'kids_ministry');
    assert.equal(stored('roles').r1.name, 'Children');
});

test('a slugless Role opened from its row in the list still keeps its slug on rename', async () => {
    // The template opens `role in servantRoles`, and those rows have been
    // through allRoles — which fills in the slug the stored document lacks.
    // Stored as JSON, so an undefined slug is a document without one.
    const legacy = Object.assign(kidsDefinition(), { slug: undefined });
    const page = await mountPage({ roles: { r1: legacy } });
    page.startEdit(page.servantRoles.find((/** @type {*} */ r) => r.id === 'r1'));
    page.draft.name = 'Prayer';
    await page.saveDraft();
    assert.equal(stored('roles').r1.slug, 'kids_ministry',
        'unpinned, it would read as "prayer" — a liturgical slug — on the next load');
});

test('a new name that slugs onto a Role stored without a slug is refused', async () => {
    const legacy = coffeeDefinition();
    delete legacy.slug;
    const page = await mountPage({ roles: { r1: legacy } });
    await page.createRole('coffee!');
    assert.equal(Object.keys(stored('roles')).length, 1);
    assert.equal(page.toast.type, 'error');
});

test('the Roles list is keyed by document, so two Roles can never share one row', () => {
    assert.match(rolesManagerHtml(), /x-for="role in servantRoles" :key="role\.id"/);
});

test('creating asks the store again, so a Role another editor just made is not duplicated', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    // Another tab creates "Greeters" after this page loaded its list.
    global.db._data.roles.other = Object.assign(coffeeDefinition(), { name: 'Greeters', slug: 'greeters' });
    await page.createRole('Greeters');
    assert.equal(Object.keys(stored('roles')).length, 2, 'no second Greeters');
    assert.equal(page.toast.type, 'error');
    assert.ok(page.roleDefinitions.some(d => d.id === 'other'), 'and the list now shows it');
});

test('Roles that share a slug are said out loud on the page', async () => {
    const legacy = Object.assign(coffeeDefinition(), { name: 'coffee!', slug: undefined });
    const page = await mountPage({ roles: { r1: coffeeDefinition(), r2: legacy } });
    assert.equal(page.sharedSlugs.length, 1);
    assert.match(page.sharedSlugSentence(page.sharedSlugs[0]), /“Coffee” and “coffee!”/);
    assert.match(rolesManagerHtml(), /x-show="sharedSlugs\.length"/);
});


// ── The ledger (who it needs, rules and rest moved to each event) ───────────

test('saving a Role\'s description keeps the rest of it exactly as stored', async () => {
    // Who it needs, its rules and its rest are each event's now, but the old
    // values stay on the Role as what an event reads until it has its own
    // (EventsCore.effectiveRole). Writing a description must not drop them.
    const page = await mountPage({ roles: { r1: kidsDefinition() }, people: PEOPLE });
    const before = JSON.parse(JSON.stringify(stored('roles').r1));
    page.startEdit(page.roleDefinitions.find(d => d.id === 'r1'));
    page.draft.description = 'Two adults in the room at all times.';
    await page.saveDraft();

    const saved = stored('roles').r1;
    assert.equal(saved.description, 'Two adults in the room at all times.');
    assert.deepStrictEqual(saved.slots, before.slots, 'the slots went');
    assert.deepStrictEqual(saved.restrictions || [], before.restrictions || []);
    assert.equal(saved.slug, before.slug, 'the slug moved, orphaning its serve history');
});

test('MS-721: without roles.manager.edit a Role reads as text, and nothing writes', () => {
    const html = rolesManagerHtml();
    for (const field of ['x-model="draft.name"', 'x-model="draft.description"']) {
        const at = html.indexOf(field);
        assert.ok(at !== -1, field);
        const opened = html.lastIndexOf('<template x-if="isSelected(role) && canManageRoles && draft">', at);
        const closed = html.lastIndexOf('</template>', at);
        assert.ok(opened !== -1 && opened > closed, field + ' is rendered without the key');
    }
    assert.ok(html.indexOf('class="rm-create" x-show="canManageRoles"') !== -1, 'create shows without the key');
    assert.match(html, /x-show="canManageRoles" type="button" @click="deleteRole\(role\)"/, 'delete shows without the key');
    assert.match(html, /:disabled="!canManageRoles"\s*@click="startEdit\(role\)"/, 'a read-only row opens nothing');
});

test('the ledger says where each Role runs, through to that event\'s rules', async () => {
    const page = await mountPage({ roles: { r1: kidsDefinition() } });
    const slug = page.roleDefinitions.find(d => d.id === 'r1').slug;
    page.allSeries = [
        { id: 'midweek', name: 'Midweek', roleSlugs: [slug] },
        { id: 'sunday_service', name: 'Sunday Service', roleSlugs: [slug],
          roleSettings: { [slug]: { slots: [{ id: 's1', requirement: 'either' }] } } },
        { id: 'prayer', name: 'Prayer', roleSlugs: ['coffee'] },
    ];
    const uses = page.usesOf(slug);
    assert.deepStrictEqual(uses.map(u => u.id), ['sunday_service', 'midweek'], 'the Sunday comes first');
    assert.equal(uses[0].count, '1 person', 'the event\'s own answer wins');
    assert.equal(uses[1].count, '3 people', 'with no answer of its own, the Role\'s old one stands');
    assert.match(rolesManagerHtml(), /recurring-events\.html\?series=' \+ encodeURIComponent\(use\.id\) \+ '&role='/);
});

// ── Doesn't serve, for a whole tag or group (ADR 0086) ──────────────────────

test('a whole tag can be marked as not serving, from the tags this editor can see', async () => {
    const page = await mountPage({
        people_tags: Object.assign({}, TAGS, { secret: { name: 'Elder only', hiddenFromOthers: true } }),
        people: {
            p1: { name: 'Ann', tags: [KIDS_CLEARED] },
            p2: { name: 'Bob', tags: [] },
        },
    });
    page.nsKind = 'tag';
    assert.ok(page.nsOptions.every(t => t.id !== 'secret'), 'a hidden tag was offered');

    await page.setNonServing('tag', KIDS_CLEARED, true);
    assert.deepStrictEqual(stored('serving_settings').church.doesNotServeTagIds, [KIDS_CLEARED]);
    assert.equal(page.nonServingEntries[0].count, 1, 'the tag says how many it covers');
    assert.equal(page.nonServingCount, 1);

    await page.setNonServing('tag', KIDS_CLEARED, false);
    assert.deepStrictEqual(stored('serving_settings').church.doesNotServeTagIds, []);
});

test('a group can be marked too, and only an editor may mark either', async () => {
    const page = await mountPage({
        relationship_groups: { g1: { name: 'Youth group', typeId: 'hg', sharedWithEditors: true, memberIds: ['p1'] } },
        people: { p1: { name: 'Ann' } },
    }, { rank: 'member' });
    await page.setNonServing('group', 'g1', true);
    assert.equal(stored('serving_settings').church, undefined, 'a member wrote it');
});
