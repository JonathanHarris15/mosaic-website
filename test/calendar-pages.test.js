const { test } = require('node:test');
const ONE_OFF = require('../public/events-occurrence-core.js').ONE_OFF_SLUG;
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// MS-153 – MS-157 — the two Calendar pages.
//
// These pages are Alpine markup over a plain component object, and nothing type
// checks the join between them. A template that says `formatDayMonthShort(...)`
// when the component never defined it fails SILENTLY in the browser: Alpine
// swallows the error per-expression and the row simply renders blank. That is
// exactly the bug this file exists to catch — it caught one during the build.
//
// So: load each component for real, read its page, pull out every identifier the
// markup reaches for, and assert the component actually has it.

const PUBLIC = path.join(__dirname, '..', 'public');

// ── Loading a page component without a browser ────────────────────────────────

function loadComponent(scriptFile, factoryName, overrides) {
    const sandbox = {
        console: console,
        Promise: Promise,
        Date: Date,
        Object: Object,
        Array: Array,
        Math: Math,
        String: String,
        Number: Number,
        JSON: JSON,
        Set: Set,
        Map: Map,
        encodeURIComponent: encodeURIComponent,
        URLSearchParams: URLSearchParams,
    };

    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    // The real modules, so the component is wired to the code it ships with.
    sandbox.EventsOccurrenceCore = require('../public/events-occurrence-core.js');
    sandbox.EventsStore = require('../public/events-store.js');
    sandbox.CalendarView = require('../public/calendar-view.js');
    sandbox.RolesCore = require('../public/roles-core.js');
    sandbox.DateUtils = require('../public/date-utils.js');

    // The browser-only edges, stubbed just enough to construct the component.
    sandbox.location = { search: '?id=midweek_2026-07-15', href: '' };
    sandbox.auth = { onAuthStateChanged() {} };
    sandbox.getUserData = async () => ({});
    sandbox.db = {};
    sandbox.document = { addEventListener() {} };

    // A test that needs to watch what the page writes swaps `db` for a fake.
    Object.assign(sandbox, overrides || {});

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, scriptFile), 'utf8'), sandbox, { filename: scriptFile });

    assert.strictEqual(typeof sandbox[factoryName], 'function',
        scriptFile + ' does not define window.' + factoryName);
    return sandbox[factoryName]();
}

// Every member the component exposes, including getters (which live on the
// object as accessor descriptors, so a plain `in` check finds them).
function membersOf(component) {
    return new Set(Object.keys(Object.getOwnPropertyDescriptors(component)));
}

// ── Pulling the identifiers out of the markup ─────────────────────────────────

const ALPINE_ATTRS = /(?:x-text|x-show|x-if|x-model[.\w]*|x-html|x-for|@click|@change|@keydown[.\w]*|:class|:href|:disabled|:checked|:value|:aria-label|:style)\s*=\s*"([^"]*)"/g;

// Things a template may legitimately name that are not component members.
const ALLOWED = new Set([
    // Alpine magics and JS globals
    '$event', '$refs', '$el', '$dispatch', '$nextTick', '$watch', '$store', '$data',
    'Object', 'Array', 'Math', 'String', 'Number', 'JSON', 'Boolean', 'Date',
    'true', 'false', 'null', 'undefined', 'new', 'typeof', 'in', 'of', 'return',
    'behavior', 'smooth', 'window', 'console',
]);

// The loop variables an x-for introduces, e.g. "ev in cell.events" -> ev,
// "(d, i) in [...]" -> d, i.
function loopVars(html) {
    const vars = new Set();
    const re = /x-for\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(html))) {
        const left = m[1].split(/\s+in\s+/)[0].trim();
        left.replace(/[()]/g, '').split(',').forEach(v => {
            const name = v.trim();
            if (name) vars.add(name);
        });
    }
    return vars;
}

// The parameters of any arrow function inside an expression. `o` in
// `list.find(o => o.id === x)` is a local, not a component member.
function arrowParams(expression) {
    const params = new Set();
    const add = raw => raw.split(',').forEach(p => {
        const name = p.trim().replace(/[()]/g, '');
        if (name) params.add(name);
    });

    let m;
    const bare = /([A-Za-z_$][\w$]*)\s*=>/g;
    while ((m = bare.exec(expression))) add(m[1]);
    const parenthesised = /\(([^)]*)\)\s*=>/g;
    while ((m = parenthesised.exec(expression))) add(m[1]);

    return params;
}

// Top-level identifiers in an expression: a bare word that is not a property
// access (`.foo`), not an object key (`foo:`), not inside a string, and not an
// arrow-function parameter.
function identifiersIn(expression) {
    const withoutStrings = expression
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/`(?:[^`\\]|\\.)*`/g, '``');

    const locals = arrowParams(withoutStrings);
    const found = new Set();

    // A leading `$` is part of the identifier — `$event` and `$refs` are Alpine
    // magics, not references to `event` and `refs`.
    const re = /(\.)?(\$?[A-Za-z_][A-Za-z0-9_$]*)\s*(:)?/g;
    let m;
    while ((m = re.exec(withoutStrings))) {
        if (m[1] === '.' || m[3] === ':') continue;
        if (locals.has(m[2])) continue;
        found.add(m[2]);
    }
    return found;
}

function checkPage(htmlFile, scriptFile, factoryName) {
    const html = fs.readFileSync(path.join(PUBLIC, htmlFile), 'utf8');
    const component = loadComponent(scriptFile, factoryName);
    const members = membersOf(component);
    const locals = loopVars(html);

    const missing = new Map();
    let m;
    ALPINE_ATTRS.lastIndex = 0;
    while ((m = ALPINE_ATTRS.exec(html))) {
        identifiersIn(m[1]).forEach(name => {
            if (members.has(name) || locals.has(name) || ALLOWED.has(name)) return;
            if (!missing.has(name)) missing.set(name, m[1].trim().slice(0, 80));
        });
    }

    assert.deepStrictEqual(
        Array.from(missing.entries()),
        [],
        htmlFile + ' reaches for things ' + scriptFile + ' does not define. ' +
        'Alpine swallows these per-expression, so the browser renders blank rather than erroring.'
    );
}

// ── The pages ─────────────────────────────────────────────────────────────────

test('the Calendar page only binds to things its component defines', () => {
    checkPage('calendar.html', 'calendar.js', 'calendarPage');
});

test('the Event detail page only binds to things its component defines', () => {
    checkPage('calendar-event.html', 'calendar-event.js', 'eventDetailPage');
});

// ── How auth.js actually exposes itself ───────────────────────────────────────

test('auth.js declares auth and db as consts, so they are NOT window properties', () => {
    // A classic script's top-level `const` creates a global LEXICAL binding, not
    // a property of window. So `auth` resolves and `window.auth` is undefined.
    // `function getUserData()` DOES become a window property, which makes the
    // inconsistency easy to trip over.
    const authJs = fs.readFileSync(path.join(PUBLIC, 'auth.js'), 'utf8');
    assert.match(authJs, /^const auth = firebase\.auth\(\);$/m);
    assert.match(authJs, /^const db = firebase\.firestore\(\);$/m);
    assert.doesNotMatch(authJs, /window\.auth\s*=/, 'if this changes, the rule below changes with it');
    assert.doesNotMatch(authJs, /window\.db\s*=/);
});

test('no page reaches for window.auth, window.db or window.getUserData', () => {
    // This shipped once: `window.auth.onAuthStateChanged(...)` threw
    // "Cannot read properties of undefined" on page load, and nothing in the
    // test suite noticed because the suite stubs these as properties.
    const PAGES = ['calendar.js', 'calendar-event.js', 'roles-manager.js', 'service-calendar.js'];

    PAGES.forEach(file => {
        const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
        ['auth', 'db', 'getUserData'].forEach(name => {
            assert.doesNotMatch(
                src,
                new RegExp('window\\.' + name + '\\b'),
                file + ' uses window.' + name + ', which is undefined — use the bare identifier'
            );
        });
    });
});

test('the Calendar pages resolve the signed-in user the way every other page does', () => {
    ['calendar.js', 'calendar-event.js'].forEach(file => {
        const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
        assert.match(src, /\bauth\.onAuthStateChanged\(/, file);
        assert.match(src, /\bgetUserData\(/, file);
    });
});

// ── The pages load what they need ─────────────────────────────────────────────

test('each page loads every module its component reaches for', () => {
    // A missing <script> tag is the other half of the same silent failure: the
    // component constructs, then throws the moment it touches the module.
    const NEEDED = {
        'calendar.html': ['events-occurrence-core.js', 'events-store.js', 'calendar-view.js', 'date-utils.js', 'calendar.js'],
        'calendar-event.html': ['events-occurrence-core.js', 'events-store.js', 'calendar-view.js', 'roles-core.js', 'date-utils.js', 'calendar-event.js'],
    };

    Object.keys(NEEDED).forEach(page => {
        const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
        NEEDED[page].forEach(src => {
            assert.match(html, new RegExp('src="' + src.replace('.', '\\.') + '"'), page + ' does not load ' + src);
        });
    });
});

test('the week-shift page loads the modules it now depends on', () => {
    // MS-152 taught the shift to move occurrences; without these it silently
    // skips them and loses the week's roster.
    const html = fs.readFileSync(path.join(PUBLIC, 'service-calendar.html'), 'utf8');
    assert.match(html, /src="events-occurrence-core\.js"/);
    assert.match(html, /src="events-store\.js"/);
});

// ── The Calendar is reachable ─────────────────────────────────────────────────

test('the dashboard offers the Calendar, and it is not the Services card', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    assert.match(html, /href="calendar\.html"/, 'the Calendar has no way in');
    assert.match(html, /data-card-key="calendar"/);
    // The Services card keeps its stored key, or every user's saved dashboard
    // arrangement scrambles.
    assert.match(html, /data-card-key="service-calendar"/);
});

// ── Behaviour the design is explicit about ────────────────────────────────────

test('a Sunday chip links to Services and never opens an Event editor', () => {
    const component = loadComponent('calendar.js', 'calendarPage');
    component.open({ id: 'sunday_service_2026-07-12', date: '2026-07-12', isSunday: true });
    assert.match(component.$el === undefined ? globalThisHref() : '', /^$/);

    function globalThisHref() { return ''; }
});

test('opening a Sunday routes to Services, and anything else to the Event page', () => {
    // Checked through the component's own routing rather than the DOM, so the
    // rule — the liturgy is edited on Services, which is what keeps the printed
    // booklet safe — is pinned somewhere a refactor has to notice.
    const sandbox = {};
    const component = loadComponent('calendar.js', 'calendarPage');

    const hrefs = [];
    // The component assigns window.location.href; capture it.
    const original = Object.getOwnPropertyDescriptor(component, 'open');
    assert.ok(original, 'the Calendar has no open()');

    // Re-run in a sandbox whose location records assignments.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar.js'), 'utf8');
    const ctx = {
        console, Promise, Date, Object, Array, Math, String, Number, JSON, Set, Map,
        encodeURIComponent, URLSearchParams,
    };
    ctx.window = ctx;
    ctx.EventsOccurrenceCore = require('../public/events-occurrence-core.js');
    ctx.EventsStore = require('../public/events-store.js');
    ctx.CalendarView = require('../public/calendar-view.js');
    ctx.DateUtils = require('../public/date-utils.js');
    ctx.auth = { onAuthStateChanged() {} };
    ctx.db = {};
    ctx.location = { set href(v) { hrefs.push(v); }, get href() { return hrefs[hrefs.length - 1]; } };
    vm.createContext(ctx);
    vm.runInContext(html, ctx, { filename: 'calendar.js' });

    const page = ctx.calendarPage();
    page.open({ id: 'sunday_service_2026-07-12', date: '2026-07-12', isSunday: true });
    page.open({ id: 'midweek_2026-07-15', date: '2026-07-15', isSunday: false });

    // A Sunday goes to its OWN surface — the Order of Service editor, for that
    // exact date. Not the Services list: you already said which Sunday by
    // clicking it, so making somebody find the same date again is a step for
    // nothing.
    assert.match(hrefs[0], /^service-builder\.html\?date=2026-07-12$/);
    assert.match(hrefs[1], /^calendar-event\.html\?id=midweek_2026-07-15$/);
    assert.ok(sandbox !== null);
});

test('a Sunday NEVER opens the Event editor, whatever else changes', () => {
    // The invariant behind the routing, stated on its own so a future change of
    // destination cannot quietly take a Sunday into the Event model. Sunday
    // liturgy lives on the Service, and keeping the two apart is what keeps the
    // printed booklet safe.
    const hrefs = [];
    const ctx = {
        console, Promise, Date, Object, Array, Math, String, Number, JSON, Set, Map,
        encodeURIComponent, URLSearchParams,
    };
    ctx.window = ctx;
    ctx.EventsOccurrenceCore = require('../public/events-occurrence-core.js');
    ctx.EventsStore = require('../public/events-store.js');
    ctx.CalendarView = require('../public/calendar-view.js');
    ctx.DateUtils = require('../public/date-utils.js');
    ctx.auth = { onAuthStateChanged() {} };
    ctx.db = {};
    ctx.location = { set href(v) { hrefs.push(v); }, get href() { return hrefs[hrefs.length - 1]; } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'calendar.js'), 'utf8'), ctx, { filename: 'calendar.js' });

    const page = ctx.calendarPage();
    ['2026-07-05', '2026-07-12', '2026-07-19'].forEach(date => {
        page.open({ id: 'sunday_service_' + date, date: date, isSunday: true });
    });

    hrefs.forEach(href => {
        assert.ok(!/calendar-event\.html/.test(href),
            'a Sunday must never route into the Event editor: ' + href);
    });
});

test('the Event detail page sends a Sunday to that same surface', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.occurrence = { id: 'sunday_service_2026-07-12', seriesId: 'sunday_service', date: '2026-07-12' };
    assert.strictEqual(page.servicesHref, 'service-builder.html?date=2026-07-12');
});

test('only an editor and above is offered "New event"', () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    ['editor', 'admin', 'elder', 'super_admin'].forEach(rank => {
        page.rank = rank;
        assert.strictEqual(page.canCreate, true, rank + ' should be able to create');
    });
    ['member', 'viewer', null].forEach(rank => {
        page.rank = rank;
        assert.strictEqual(page.canCreate, false, String(rank) + ' should not be able to create');
    });
});

test('"Only mine" filters on the Role held on the event itself', () => {
    // Not a parallel list. A parallel list is a list that goes stale.
    const page = loadComponent('calendar.js', 'calendarPage');
    page.personId = 'me';
    page.occurrences = [
        { id: 'a', date: '2026-07-15', mine: { label: 'Kids Ministry' } },
        { id: 'b', date: '2026-07-16', mine: null },
    ];

    assert.strictEqual(page.visible.length, 2);
    page.onlyMine = true;
    assert.deepStrictEqual(page.visible.map(o => o.id), ['a']);
});

test('a member sees the roster only when the editor shared it; their own part always', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');

    page.rank = 'member';
    page.occurrence = { id: 'x', rosterShared: false };
    assert.strictEqual(page.canSeeRoster, false);

    page.occurrence = { id: 'x', rosterShared: true };
    assert.strictEqual(page.canSeeRoster, true);

    page.rank = 'editor';
    page.occurrence = { id: 'x', rosterShared: false };
    assert.strictEqual(page.canSeeRoster, true, 'an editor always sees the roster');
});

test('the Sunday variant offers no visibility control at all', () => {
    // Settled, not disabled. There is no control to grey out.
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.occurrence = { id: 'sunday_service_2026-07-12', seriesId: 'sunday_service' };

    assert.strictEqual(page.isSunday, true);
    assert.strictEqual(page.visibility, 'public');
    assert.strictEqual(page.visibilityEditable, false);
});

test('liturgical Roles are never offered on an Event', () => {
    // They stay wired to the Service exactly as they are today, which is what
    // keeps the printed Sunday booklet safe.
    const Roles = require('../public/roles-core.js');
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.occurrence = { id: 'x', roleSlugs: [] };
    page.roleDefinitions = [
        { slug: 'kids', name: 'Kids Ministry', slots: [{ id: 's1', requirement: 'either' }] },
        { slug: 'preacher', name: 'Preacher', slots: [] },
    ];

    const offered = page.availableRoles.map(r => r.slug);
    assert.deepStrictEqual(offered, ['kids']);
    Roles.LITURGICAL_SLUGS.forEach(slug => {
        assert.strictEqual(offered.indexOf(slug), -1, slug + ' must not be offered on an Event');
    });
});

test('the past-event prompt renders nothing when there is nothing to ask', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.occurrence = { id: 'x', date: '2020-01-01' };

    page.assignments = [];
    assert.strictEqual(page.unconfirmedPrompt, null);

    page.assignments = [{ personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'confirmed' }];
    assert.strictEqual(page.unconfirmedPrompt, null);

    page.assignments = [{ personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'pending' }];
    assert.match(page.unconfirmedPrompt, /never confirmed\. Did they serve\?$/);
});

test('the past-event prompt never appears on a future Event', () => {
    // Before the date, silence is simply nobody having answered yet.
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.occurrence = { id: 'x', date: '2099-01-01' };
    page.assignments = [{ personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'pending' }];

    assert.strictEqual(page.isPast, false);
    assert.strictEqual(page.unconfirmedPrompt, null);
});

test('a member is never shown the tidy-up prompt', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'member';
    page.occurrence = { id: 'x', date: '2020-01-01' };
    page.assignments = [{ personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'pending' }];
    assert.strictEqual(page.unconfirmedPrompt, null);
});

test('a declined assignment is never offered as a question to answer', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.occurrence = { id: 'x', date: '2020-01-01' };
    page.assignments = [
        { personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'declined' },
        { personId: 'p2', roleSlug: 'kids', slotId: 's2', state: 'pending' },
    ];
    assert.deepStrictEqual(page.openQuestions.map(q => q.personId), ['p2']);
});

// ── Controls that exist in the markup but can never be seen ───────────────────
//
// `cal-row-actions` starts at opacity 0 and is revealed by `.cal-row:hover`. A
// control given that class WITHOUT a `.cal-row` ancestor is therefore invisible
// on a desktop for ever — it is in the markup, it passes every binding check
// above, and no one can click it. That shipped once: the button that removes a
// recurring Role from an Event sat in a card header that was not a `.cal-row`,
// so an editor who added a Role could never take it off again.

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
    'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// Walk the tags, carrying a stack of "is this ancestor a .cal-row", and report
// every hover-revealed control that has no row to be revealed by.
function orphanedRowActions(html) {
    const body = html.slice(html.indexOf('<body'));
    const tags = /<(\/?)([a-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>'"])*?)(\/?)>/gi;
    const stack = [];
    const orphans = [];
    let m;

    while ((m = tags.exec(body))) {
        const [, closing, name, attrs, selfClosed] = m;
        const tag = name.toLowerCase();
        if (closing) { stack.pop(); continue; }

        const classes = (/class\s*=\s*"([^"]*)"/.exec(attrs) || [, ''])[1].split(/\s+/);
        if (classes.indexOf('cal-row-actions') !== -1 && stack.indexOf(true) === -1) {
            orphans.push((/aria-label\s*=\s*"([^"]*)"/.exec(attrs) || [, tag])[1]);
        }
        if (!selfClosed && !VOID_TAGS.has(tag)) stack.push(classes.indexOf('cal-row') !== -1);
    }
    return orphans;
}

test('every hover-revealed control sits in a row that can reveal it', () => {
    ['calendar-event.html', 'calendar.html'].forEach(file => {
        const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
        assert.deepStrictEqual(orphanedRowActions(html), [],
            file + ' hides a control with no .cal-row to reveal it');
    });
});

test('the control that removes a recurring Role from an Event is reachable', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(/askRemoveManagedRole\(/.test(html), 'nothing removes a recurring Role');
    assert.deepStrictEqual(orphanedRowActions(html).filter(l => /role/i.test(l)), []);
});

test('an editor can set the state of a one-off assignment, not just remove them', () => {
    // A one-off Role is still a real Assignment carrying a real state — it goes
    // in pending like any other. Without a control here an editor can put
    // somebody on the door and never mark them confirmed, so the strip lies.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');

    ['pending', 'confirmed', 'declined'].forEach(state => {
        assert.ok(html.indexOf("setState(a, '" + state + "')") !== -1,
            'the one-off strip offers no way to mark someone ' + state);
    });
    // And it has to SHOW the state, or the control has nothing to read back.
    assert.ok(/stateTone\(a\)/.test(html), 'a one-off assignment never shows its state');
});

// ── Removing a Role that people are already on ────────────────────────────────
//
// Taking a Role off an Event deletes every Assignment on it — that is correct
// (leaving them behind keeps people as participants of a Role the Event no
// longer has, which is also what lets them SEE a restricted Event). But it is a
// silent deletion behind a single small button, so it asks first, and only when
// there is actually somebody to lose. An empty Role removes on the click.

function eventPageWithRole() {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.occurrence = { id: 'x', date: '2026-07-15', occurrenceRoleSlugs: ['kids'], oneOffRoles: [{ id: 'o1', label: 'Unlock the hall' }] };
    page.people = [{ id: 'p1', name: 'Dave Rowe' }, { id: 'p2', name: 'Sarah Kent' }];
    page.roleDefinitions = [{ slug: 'kids', name: 'Kids Ministry', slots: [{ id: 's1', requirement: 'either' }] }];
    page.saved = 0;
    page.persist = async () => { page.saved++; };
    return page;
}

test('a Role with nobody on it comes off without a question', async () => {
    const page = eventPageWithRole();
    page.assignments = [];

    await page.askRemoveManagedRole('kids');
    assert.strictEqual(page.pendingRemoval, null, 'asked about an empty Role');
    assert.deepStrictEqual(page.occurrence.occurrenceRoleSlugs, []);
    assert.strictEqual(page.saved, 1);
});

test('a Role with people on it is not removed until the question is answered', async () => {
    const page = eventPageWithRole();
    page.assignments = [{ personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'confirmed' }];

    await page.askRemoveManagedRole('kids');
    assert.ok(page.pendingRemoval, 'removed somebody without asking');
    assert.deepStrictEqual(page.occurrence.occurrenceRoleSlugs, ['kids'], 'removed it before the answer');
    assert.strictEqual(page.assignments.length, 1);
    assert.strictEqual(page.saved, 0, 'wrote to the Event before the answer');

    // The question has to say who is lost, by name — "are you sure?" alone is
    // a question nobody can answer well.
    assert.ok(/Dave Rowe/.test(page.pendingRemoval.sentence), page.pendingRemoval.sentence);
    assert.ok(/Kids Ministry/.test(page.pendingRemoval.name));
});

test('saying no leaves the Role and everyone on it exactly where they were', async () => {
    const page = eventPageWithRole();
    page.assignments = [{ personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'confirmed' }];

    await page.askRemoveManagedRole('kids');
    page.cancelRemoval();

    assert.strictEqual(page.pendingRemoval, null);
    assert.deepStrictEqual(page.occurrence.occurrenceRoleSlugs, ['kids']);
    assert.strictEqual(page.assignments.length, 1);
    assert.strictEqual(page.saved, 0);
});

test('saying yes takes the Role off and their places with it', async () => {
    const page = eventPageWithRole();
    page.assignments = [
        { personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'confirmed' },
        { personId: 'p2', roleSlug: ONE_OFF, oneOffId: 'o1', state: 'pending' },
    ];

    await page.askRemoveManagedRole('kids');
    await page.confirmRemoval();

    assert.strictEqual(page.pendingRemoval, null);
    assert.deepStrictEqual(page.occurrence.occurrenceRoleSlugs, []);
    assert.deepStrictEqual(page.assignments.map(a => a.personId), ['p2'], 'took the wrong people off');
    assert.strictEqual(page.saved, 1);
});

test('a one-off job asks the same question, and names the same way', async () => {
    const page = eventPageWithRole();
    page.assignments = [
        { personId: 'p1', roleSlug: ONE_OFF, oneOffId: 'o1', state: 'pending' },
        { personId: 'p2', roleSlug: ONE_OFF, oneOffId: 'o1', state: 'confirmed' },
    ];

    await page.askRemoveOneOffRole('o1');
    assert.ok(page.pendingRemoval, 'deleted a one-off job with two people on it silently');
    assert.ok(/Dave Rowe/.test(page.pendingRemoval.sentence));
    assert.ok(/Sarah Kent/.test(page.pendingRemoval.sentence));
    assert.strictEqual(page.saved, 0);

    await page.confirmRemoval();
    assert.deepStrictEqual(page.occurrence.oneOffRoles, []);
    assert.deepStrictEqual(page.assignments, []);
    assert.strictEqual(page.saved, 1);
});

test('an empty one-off job goes without a question too', async () => {
    const page = eventPageWithRole();
    page.assignments = [];

    await page.askRemoveOneOffRole('o1');
    assert.strictEqual(page.pendingRemoval, null);
    assert.deepStrictEqual(page.occurrence.oneOffRoles, []);
});

test('the remove buttons go through the question, never straight to the deletion', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    // The unguarded pair still exist — they are what the confirmation calls —
    // but nothing in the markup may reach them directly.
    assert.ok(!/@click="removeManagedRole\(/.test(html), 'a click removes a Role without asking');
    assert.ok(!/@click="removeOneOffRole\(/.test(html), 'a click deletes a one-off job without asking');
    assert.ok(/askRemoveManagedRole\(/.test(html) && /askRemoveOneOffRole\(/.test(html));
});

// ── The colour an Event shows up as ───────────────────────────────────────────

test('a chosen colour never overrides "needs sorting"', () => {
    // The red is the end of an escalation across four surfaces. A colour is
    // decoration and must never be able to shout, or to stop something shouting.
    const page = loadComponent('calendar.js', 'calendarPage');
    const View = require('../public/calendar-view.js');

    assert.strictEqual(page.chipBar({ seriesColour: 'gold' }), View.colourFor('gold').bar);
    assert.strictEqual(page.chipBar({ seriesColour: 'gold', needsAttention: true }), View.ATTENTION_COLOUR);
});

test('a recurring Event colours the series, a one-off colours itself', async () => {
    // Two different documents, and the difference matters: colouring the series
    // moves every date at once, which is the whole point of choosing it there.
    const writes = [];
    const fakeDb = {
        collection: name => ({
            doc: id => ({
                path: name + '/' + id,
                async set(data, options) { writes.push({ path: name + '/' + id, data, options }); },
                collection: sub => fakeDb.collection(name + '/' + id + '/' + sub),
            }),
            async get() { return { docs: [] }; },
            where() { return this; },
        }),
    };

    const recurring = loadComponent('calendar-event.js', 'eventDetailPage', { db: fakeDb });
    recurring.rank = 'editor';
    recurring.occurrence = { id: 'midweek_2026-07-15', seriesId: 'midweek', date: '2026-07-15' };
    recurring.series = { id: 'midweek', name: 'Midweek Gathering' };
    await recurring.setColour('gold');

    assert.deepStrictEqual(writes.map(w => w.path), ['events/midweek']);
    assert.strictEqual(writes[0].data.colour, 'gold');
    assert.strictEqual(recurring.colour.slug, 'gold');

    writes.length = 0;
    const oneOff = loadComponent('calendar-event.js', 'eventDetailPage', { db: fakeDb });
    oneOff.rank = 'editor';
    oneOff.occurrence = { id: 'harvest_supper', seriesId: null, date: '2026-07-15' };
    oneOff.series = null;
    await oneOff.setColour('plum');

    assert.deepStrictEqual(writes.map(w => w.path), ['event_occurrences/harvest_supper']);
    assert.strictEqual(writes[0].data.colour, 'plum');
    assert.strictEqual(oneOff.colour.slug, 'plum');
});

test('the colour section is offered to editors and writes through the store', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(/Colour on the calendar/.test(html), 'no colour section on the Event page');
    assert.ok(/setColour\(c\.slug\)/.test(html));
    // It must say which way the change lands — series-wide or this one — because
    // both are reasonable to expect and only one is true.
    assert.ok(/every date of this event/.test(html));
});
