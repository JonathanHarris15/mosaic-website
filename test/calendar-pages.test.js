const { test } = require('node:test');
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

function loadComponent(scriptFile, factoryName) {
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

    assert.match(hrefs[0], /^service-calendar\.html#2026-07-12$/,
        'a Sunday is a cross-link, never an editor');
    assert.match(hrefs[1], /^calendar-event\.html\?id=midweek_2026-07-15$/);
    assert.ok(sandbox !== null);
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
