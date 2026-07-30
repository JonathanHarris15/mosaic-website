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

// -- Where a chip goes --------------------------------------------------------
//
// Every chip opens the Event page, Sundays included. This REVERSES an earlier
// rule that sent a Sunday straight to its order of service.
//
// That rule was defending the LITURGY, and the defence still stands - it just
// moved to where it belongs. The Event page never draws a liturgical Role as a
// fillable card ("a liturgical Role is never drawn as a fillable card on a
// date"), so nothing about the booklet got less safe. What changed is the click:
// a Sunday now carries Servant Roles like any other date, and sending the chip
// to the liturgy made the date with the MOST people on it the only one you could
// not open to see who they were.

function calendarIn(hrefs) {
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
    return ctx.calendarPage();
}

test('every chip opens its own date, Sundays the same as anything else', () => {
    const hrefs = [];
    const page = calendarIn(hrefs);

    page.open({ id: 'sunday_service_2026-07-12', date: '2026-07-12', isSunday: true });
    page.open({ id: 'midweek_2026-07-15', date: '2026-07-15', isSunday: false });

    assert.strictEqual(hrefs[0], 'calendar-event.html?id=sunday_service_2026-07-12');
    assert.strictEqual(hrefs[1], 'calendar-event.html?id=midweek_2026-07-15');
});

test('the order of service is still one click from a Sunday', () => {
    // The chip no longer lands there, so this page is the ONLY route to a
    // Sunday's liturgy from the Calendar. It lives at the top of the side
    // column rather than in the header, but if it ever disappears entirely the
    // liturgy becomes unreachable from here.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(/:href="servicesHref"/.test(html),
        'a Sunday Event page has no link to its order of service');

    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.occurrence = { id: 'sunday_service_2026-07-12', seriesId: 'sunday_service', date: '2026-07-12' };
    assert.strictEqual(page.servicesHref, 'service-builder.html?date=2026-07-12');
});

test('the Calendar never promises a Sunday chip goes somewhere it does not', () => {
    // The grid, the legend and the list row all used to advertise "opens its
    // order of service" with a leaves-this-page arrow. A promise the click no
    // longer keeps is worse than no promise.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar.html'), 'utf8');
    assert.ok(!/opens its order of service/.test(html));
    assert.ok(!/north_east/.test(html), 'a chip still advertises leaving for another surface');
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
    // keeps the printed Sunday booklet safe. Offered on the EVENT screen now,
    // since that is the only place Roles are chosen at all.
    const Roles = require('../public/roles-core.js');
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.series = { id: 'x', roleSlugs: [] };
    page.roleDefinitions = [
        { slug: 'kids', name: 'Kids Ministry', slots: [{ id: 's1', requirement: 'either' }] },
        { slug: 'preacher', name: 'Preacher', slots: [] },
    ];

    const offered = page.seriesRolesAvailable.map(r => r.slug);
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
    // It lives on the EVENT screen now, not on one date — but it is still a
    // control that once shipped invisible, so it stays pinned.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(/askRemoveSeriesRole\(/.test(html), 'nothing removes a recurring Role');
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

// The per-date versions of these are gone: WHICH Roles an Event carries is
// decided once, on the Event. The same guarantees now live on that screen —
// "taking a Role off the Event asks first when people are on it" and "the
// question names how many dates and how many people it costs" — where the cost
// is larger, because it is every date rather than one.

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
    // The unguarded ones still exist — they are what the confirmation calls —
    // but nothing in the markup may reach them directly.
    assert.ok(!/@click="removeSeriesRole\(/.test(html), 'a click removes a Role without asking');
    assert.ok(!/@click="removeOneOffRole\(/.test(html), 'a click deletes a one-off job without asking');
    assert.ok(/askRemoveSeriesRole\(/.test(html) && /askRemoveOneOffRole\(/.test(html));
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

// ── Managing the Sunday Service as an Event ───────────────────────────────────
//
// MS-13 built this series — locked, carrying the liturgical Roles — and nothing
// could ever open it. The Calendar now has a door to it. What must NOT change is
// where a Sunday CHIP goes: the liturgy is still built one Sunday at a time in
// the order of service, and that separation is what keeps the printed booklet
// safe.

function seriesDb(seed) {
    const docs = Object.assign({}, seed);
    const writes = [];
    const db = {
        collection: name => ({
            doc: id => ({
                path: name + '/' + id,
                async get() {
                    const d = docs[name + '/' + id];
                    return { exists: !!d, id: id, data: () => d };
                },
                async set(data, options) {
                    writes.push({ path: name + '/' + id, data: data });
                    docs[name + '/' + id] = Object.assign({}, docs[name + '/' + id], data);
                },
                collection: sub => db.collection(name + '/' + id + '/' + sub),
            }),
            where() { return this; },
            async get() { return { docs: [] }; },
        }),
    };
    db.__writes = writes;
    db.__docs = docs;
    return db;
}

test('opening the Sunday Service creates it if it has never existed', async () => {
    const Roles = require('../public/roles-core.js');
    const db = seriesDb({});
    const page = loadComponent('calendar-event.js', 'eventDetailPage', {
        db: db,
        location: { search: '?series=sunday_service', href: '' },
    });
    page.rank = 'editor';

    await page.loadSeriesMode('sunday_service');

    assert.strictEqual(page.managingSeries, true);
    assert.strictEqual(page.series.name, 'Sunday Service');
    assert.deepStrictEqual(db.__writes.map(w => w.path), ['events/sunday_service']);

    // Every liturgical Role is shown, and every one of them is locked.
    const shown = page.liturgicalRoles.map(r => r.slug).sort();
    assert.deepStrictEqual(shown, Roles.LITURGICAL_SLUGS.slice().sort());
    assert.ok(page.liturgicalRoles.every(r => r.locked));
});

test('a liturgical Role is never offered for removal, and refuses if asked', async () => {
    const Roles = require('../public/roles-core.js');
    const db = seriesDb({});
    const page = loadComponent('calendar-event.js', 'eventDetailPage', {
        db: db, location: { search: '?series=sunday_service', href: '' },
    });
    page.rank = 'editor';
    await page.loadSeriesMode('sunday_service');

    // Not in the removable list...
    assert.deepStrictEqual(page.servantRoles, []);
    // ...and not offered for adding either, since it is already on and locked.
    assert.deepStrictEqual(
        page.seriesRolesAvailable.filter(d => Roles.LITURGICAL_SLUGS.indexOf(d.slug) !== -1), []);

    // And the store refuses even if something reached past the screen.
    db.__writes.length = 0;
    await page.removeSeriesRole(Roles.LITURGICAL_SLUGS[0]);
    assert.match(page.error, /locked/i);
    assert.deepStrictEqual(db.__writes, [], 'wrote anyway');
});

test('the Calendar offers the Sunday Service as a thing above all its dates', () => {
    // Two different doors, and they must stay different: this one opens the
    // EVENT - its time, and the Roles every Sunday carries - while a chip opens
    // one date of it.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar.html'), 'utf8');
    assert.ok(/calendar-event\.html\?series=sunday_service/.test(html),
        'no way into the Sunday Service as an Event');

    const hrefs = [];
    const page = calendarIn(hrefs);
    page.open({ id: 'sunday_service_2026-07-12', date: '2026-07-12', isSunday: true });
    assert.doesNotMatch(hrefs[0], /series=/, 'a chip opened the whole series instead of its date');
});

test('every page that loads the events store loads the series model first', () => {
    // events-store.js now reaches for window.EventsCore. A classic script that
    // loads them the other way round leaves it undefined at parse time — and the
    // page renders, it just cannot manage a series.
    ['calendar.html', 'calendar-event.html', 'service-calendar.html'].forEach(file => {
        const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
        if (html.indexOf('events-store.js') === -1) return;
        const core = html.indexOf('src="events-core.js"');
        const store = html.indexOf('src="events-store.js"');
        assert.ok(core !== -1, file + ' loads the events store without the series model');
        assert.ok(core < store, file + ' loads the events store before the series model');
    });
});

// ── Roles the whole Event carries turn up on every date of it ─────────────────
//
// Adding "Sound desk" to the Sunday Service has to mean every Sunday has a sound
// desk to fill. Without this the series screen is a list that does nothing: you
// add a Role, go to a Sunday, and it is not there.

function eventPageOn(occurrence, series, defs) {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.occurrence = occurrence;
    page.series = series;
    page.roleDefinitions = defs;
    return page;
}

const SOUND = { slug: 'sound_desk', name: 'Sound desk', slots: [{ id: 's1', requirement: 'either' }] };
const COFFEE = { slug: 'coffee', name: 'Coffee', slots: [{ id: 'c1', requirement: 'either' }] };

test('a Role added to the Event shows on every date of it, ready to fill', () => {
    const page = eventPageOn(
        { id: 'sunday_service_2026-08-02', seriesId: 'sunday_service', date: '2026-08-02' },
        { id: 'sunday_service', roleSlugs: ['sound_desk'], lockedRoleSlugs: [] },
        [SOUND]
    );

    assert.deepStrictEqual(page.managedRoles.map(r => r.def.slug), ['sound_desk']);
    assert.strictEqual(page.managedRoles[0].slots.length, 1, 'no place to put anybody');
    assert.strictEqual(page.managedRoles[0].fromSeries, true);
});

test('a liturgical Role is never drawn as a fillable card on a date', () => {
    // It prints in the booklet and is filled in the order of service. A card
    // here with a picker on it would be a second, silent way to set it.
    const Roles = require('../public/roles-core.js');
    const liturgical = Roles.LITURGICAL_SLUGS[0];
    const page = eventPageOn(
        { id: 'sunday_service_2026-08-02', seriesId: 'sunday_service', date: '2026-08-02' },
        { id: 'sunday_service', roleSlugs: [liturgical, 'sound_desk'], lockedRoleSlugs: [liturgical] },
        [SOUND, { slug: liturgical, name: 'Preacher', slots: [{ id: 'p1' }] }]
    );

    assert.deepStrictEqual(page.managedRoles.map(r => r.def.slug), ['sound_desk']);
});

test('a Role added to one date only belongs to that date, and can be taken off there', () => {
    const page = eventPageOn(
        { id: 'sunday_service_2026-08-02', seriesId: 'sunday_service', date: '2026-08-02',
          occurrenceRoleSlugs: ['coffee'] },
        { id: 'sunday_service', roleSlugs: ['sound_desk'], lockedRoleSlugs: [] },
        [SOUND, COFFEE]
    );

    // Both show. The Event's Roles come first, because they are the shape of the
    // thing; the one-date addition sits behind them.
    assert.deepStrictEqual(page.managedRoles.map(r => r.def.slug), ['sound_desk', 'coffee']);
    assert.strictEqual(page.managedRoles[0].fromSeries, true);
    assert.strictEqual(page.managedRoles[1].fromSeries, false);
});

test('the same Role on both the Event and the date is drawn once', () => {
    const page = eventPageOn(
        { id: 'x_2026-08-02', seriesId: 'x', date: '2026-08-02', occurrenceRoleSlugs: ['sound_desk'] },
        { id: 'x', roleSlugs: ['sound_desk'] },
        [SOUND]
    );

    assert.deepStrictEqual(page.managedRoles.map(r => r.def.slug), ['sound_desk']);
});

test('assignments on a Sunday Servant Role carry the three states like anywhere else', async () => {
    const page = eventPageOn(
        { id: 'sunday_service_2026-08-02', seriesId: 'sunday_service', date: '2026-08-02' },
        { id: 'sunday_service', roleSlugs: ['sound_desk'], lockedRoleSlugs: [] },
        [SOUND]
    );
    page.people = [{ id: 'p1', name: 'Dave Rowe' }];
    page.persist = async () => {};

    const Core = require('../public/events-occurrence-core.js');
    page.assignments = Core.assignToSlot(page.assignments, {
        personId: 'p1', roleSlug: 'sound_desk', slotId: 's1',
    }, { actorUid: 'u1', at: 'T1' });

    const row = page.managedRoles[0].slots[0];
    assert.strictEqual(row.assignment.state, Core.STATES.PENDING, 'did not start pending');

    await page.setState(row.assignment, 'confirmed');
    assert.strictEqual(page.managedRoles[0].slots[0].assignment.state, 'confirmed');

    await page.setState(page.managedRoles[0].slots[0].assignment, 'declined');
    assert.strictEqual(page.managedRoles[0].needsAttention, true, 'a declined Sunday Role never flags');
});

test('no managed Role is removable from one date at all', () => {
    // WHICH Roles an Event carries is decided once, on the Event. A button here
    // would be silently changing every date, or silently changing none.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(!/askRemoveManagedRole\(/.test(html));
    assert.ok(!/addManagedRole\(/.test(html));
    // A way THROUGH to where it is decided, instead.
    assert.ok(/Change the roles this event needs/.test(html));
});

test('a Sunday date shows its Roles section at all', () => {
    // It once did not: the whole section was hidden on a Sunday, so the welcome
    // team and the sound desk had nowhere to be asked. The liturgical Roles stay
    // out of it, which is what made hiding the section look reasonable.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(!/x-show="!isSunday && \(isEditor \|\| canSeeRoster\)"/.test(html),
        'the Roles section is hidden on a Sunday, so its Servant Roles cannot be filled');
});

test('the Sunday Service screen offers both jobs on a date, and keeps them apart', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.series = { id: 'sunday_service', name: 'Sunday Service' };

    // Who's on → the Event page for that Sunday, where Servant Roles are filled.
    assert.strictEqual(page.dateHref('2026-08-02'),
        'calendar-event.html?id=sunday_service_2026-08-02');
    // The liturgy → still the order of service, and only there.
    assert.strictEqual(page.orderOfServiceHref('2026-08-02'),
        'service-builder.html?date=2026-08-02');
});

// ── Creating an event on a day you clicked ────────────────────────────────────
//
// The month grid is where you already are when you decide something needs to go
// on a date. Making somebody go to "New event" and then type the date they just
// pointed at is a step for nothing.

test('clicking a day offers to create an event on that day', () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    page.rank = 'editor';

    page.openDayMenu({ date: '2026-07-15' }, { clientX: 300, clientY: 200 });

    assert.ok(page.dayMenu, 'clicking a day offered nothing');
    assert.strictEqual(page.dayMenu.date, '2026-07-15');
    assert.strictEqual(page.newEventHref('2026-07-15'),
        'calendar-event.html?new=1&date=2026-07-15');
});

test('somebody who cannot create events is not offered the menu', () => {
    // Offering it and then refusing on the next screen would be a worse answer
    // than not offering it.
    const page = loadComponent('calendar.js', 'calendarPage');
    page.rank = 'member';

    page.openDayMenu({ date: '2026-07-15' }, { clientX: 300, clientY: 200 });
    assert.strictEqual(page.dayMenu, null);
});

test('the menu stays on screen when you click near an edge', () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    page.rank = 'editor';
    page.viewport = { width: 1000, height: 700 };

    // Bottom-right corner: it has to come back inside, or it renders where
    // nobody can reach it.
    page.openDayMenu({ date: '2026-07-15' }, { clientX: 995, clientY: 695 });
    assert.ok(page.dayMenu.x + page.dayMenu.width <= 1000, 'the menu runs off the right');
    assert.ok(page.dayMenu.y + page.dayMenu.height <= 700, 'the menu runs off the bottom');

    // Anywhere with room, it sits where the mouse is.
    page.openDayMenu({ date: '2026-07-15' }, { clientX: 300, clientY: 200 });
    assert.strictEqual(page.dayMenu.x, 300);
    assert.strictEqual(page.dayMenu.y, 200);
});

test('clicking an event opens the event, and never the day menu', () => {
    // The chip sits INSIDE the day cell, so without stopping the click the same
    // gesture would both open an event and offer to create one.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar.html'), 'utf8');
    assert.ok(/@click\.stop="open\(ev\)"/.test(html),
        'an event chip lets its click reach the day underneath');
});

test('the day menu closes on Escape and on the next click', () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    page.rank = 'editor';
    page.openDayMenu({ date: '2026-07-15' }, { clientX: 10, clientY: 10 });

    page.closeDayMenu();
    assert.strictEqual(page.dayMenu, null);

    const html = fs.readFileSync(path.join(PUBLIC, 'calendar.html'), 'utf8');
    assert.ok(/@keydown\.escape\.window="closeDayMenu\(\)"/.test(html));
    assert.ok(/@click\.outside="closeDayMenu\(\)"/.test(html));
});

test('the new-event form starts on the day you clicked, not today', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage', {
        location: { search: '?new=1&date=2026-09-20', href: '' },
    });
    page.rank = 'editor';

    return page.load().then(() => {
        assert.strictEqual(page.creating, true);
        assert.strictEqual(page.draft.date, '2026-09-20');
    });
});

// ── Somebody preaching cannot also be on the welcome team ─────────────────────
//
// A Sunday's liturgical Roles are fields on the Service, not Assignments, so
// nothing in the Assignment model knows about them. Without this, the picker for
// the sound desk cheerfully offers you the preacher.

function sundayPicker(holders) {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.occurrence = { id: 'sunday_service_2026-08-02', seriesId: 'sunday_service', date: '2026-08-02' };
    page.series = { id: 'sunday_service', roleSlugs: ['sound_desk'], lockedRoleSlugs: [] };
    page.roleDefinitions = [SOUND];
    page.people = [
        { id: 'p1', name: 'Dave Rowe', status: 'active' },
        { id: 'p2', name: 'Sam Hale', status: 'active' },
    ];
    page.liturgicalHolders = holders;
    page.picker = { open: true, roleSlug: 'sound_desk', slotId: 's1', query: '', hideBlocked: false, picked: null };
    return page;
}

test('somebody holding a liturgical Role is blocked from a Sunday Servant Role', () => {
    const page = sundayPicker([{ personId: 'p2', roleSlug: 'preacher' }]);

    const sam = page.candidates.find(c => c.personId === 'p2');
    const dave = page.candidates.find(c => c.personId === 'p1');

    assert.strictEqual(sam.eligible, false, 'the preacher was offered the sound desk');
    assert.strictEqual(dave.eligible, true, 'somebody free was blocked');
});

test('the reason says which liturgical Role they are already down for', () => {
    // "Already serving here" alone leaves the editor hunting for where. This is
    // the whole point of showing blocked people rather than hiding them.
    const page = sundayPicker([{ personId: 'p2', roleSlug: 'preacher' }]);

    const sam = page.candidates.find(c => c.personId === 'p2');
    assert.match(sam.subtitle, /Preacher/,
        'the reason does not name the liturgical Role: ' + sam.subtitle);
});

test('a blocked liturgical holder is still SHOWN, not hidden', () => {
    // Seeing who was passed over, and why, is the feature. Quietly dropping them
    // from the list looks like they do not exist.
    const page = sundayPicker([{ personId: 'p2', roleSlug: 'preacher' }]);
    assert.deepStrictEqual(page.candidates.map(c => c.personId).sort(), ['p1', 'p2']);
    assert.strictEqual(page.blockedCount, 1);
});

test('nothing is blocked on a Sunday with nobody down for the liturgy yet', () => {
    const page = sundayPicker([]);
    assert.strictEqual(page.candidates.filter(c => c.eligible).length, 2);
});

test('a midweek event never consults the liturgy', () => {
    // There is no Service document for a Wednesday, and reading one would be
    // asking a question about the wrong kind of day.
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.occurrence = { id: 'midweek_2026-08-05', seriesId: 'midweek', date: '2026-08-05' };
    page.series = { id: 'midweek', roleSlugs: ['sound_desk'] };
    page.roleDefinitions = [SOUND];
    page.people = [{ id: 'p2', name: 'Sam Hale', status: 'active' }];
    // Even if something put holders here, a non-Sunday must not act on them.
    page.liturgicalHolders = [{ personId: 'p2', roleSlug: 'preacher' }];
    page.picker = { open: true, roleSlug: 'sound_desk', slotId: 's1', query: '', hideBlocked: false, picked: null };

    assert.strictEqual(page.candidates.find(c => c.personId === 'p2').eligible, true);
});

// ── Who the picker will not even offer ────────────────────────────────────────

function pickerWith(people, extra) {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = (extra && extra.rank) || 'editor';
    page.occurrence = { id: 'midweek_2026-08-05', seriesId: 'midweek', date: '2026-08-05' };
    page.series = { id: 'midweek', roleSlugs: ['sound_desk'] };
    page.roleDefinitions = [SOUND];
    page.people = people;
    page.hidingTags = (extra && extra.hidingTags) || [];
    page.picker = { open: true, roleSlug: 'sound_desk', slotId: 's1', query: '', hideBlocked: false, picked: null };
    return page;
}

test('somebody no longer active never appears in the picker, not even blocked', () => {
    const page = pickerWith([
        { id: 'p1', name: 'Dave Rowe' },
        { id: 'p2', name: 'Gone Away', membership: { inactive: true } },
    ]);
    assert.deepStrictEqual(page.candidates.map(c => c.personId), ['p1']);
});

test('somebody hidden by a tag never appears, because a blocked row prints their name', () => {
    const page = pickerWith([
        { id: 'p1', name: 'Dave Rowe' },
        { id: 'p2', name: 'Private Person', tags: ['safeguarding'] },
    ], { hidingTags: ['safeguarding'] });

    assert.deepStrictEqual(page.candidates.map(c => c.personId), ['p1']);
    assert.strictEqual(page.blockedCount, 0, 'a hidden Person was shown as blocked');
});

test('an elder sees the hidden Person, since the tag hides them from everyone else', () => {
    const page = pickerWith([
        { id: 'p1', name: 'Dave Rowe' },
        { id: 'p2', name: 'Private Person', tags: ['safeguarding'] },
    ], { rank: 'elder', hidingTags: ['safeguarding'] });

    assert.deepStrictEqual(page.candidates.map(c => c.personId).sort(), ['p1', 'p2']);
});

test('the page says so when it could not check which tags hide people', () => {
    // Failing open here would offer hidden people to an editor and look like
    // nothing had gone wrong, which is the one outcome a privacy rule must not
    // produce quietly.
    const page = loadComponent('calendar-event.js', 'eventDetailPage', {
        db: { collection: () => ({ async get() { throw new Error('nope'); } }) },
    });

    return page.loadHidingTags().then(() => {
        // strictEqual on the length, not deepStrictEqual on the array: the
        // component is built inside a vm realm, so its [] is not reference-equal
        // to this file's Array.prototype.
        assert.strictEqual(page.hidingTags.length, 0);
        assert.match(page.error, /could not be read/i);
    });
});

// ── A date that is not happening must not look like it is ─────────────────────
//
// "Skip this one" has always written a marker and the Calendar has always
// ignored it, so a skipped date drew a normal chip. Moving an instance makes
// that worse: the original date would draw the event AND the new date would draw
// it, so one gathering would appear twice.

test('a skipped or moved date is drawn as not happening', () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    page.rank = 'editor';
    page.today = '2026-08-01';
    page.occurrences = [
        { id: 'a', date: '2026-08-02', seriesId: 's', name: 'Prayer', cancelled: true },
        { id: 'b', date: '2026-08-09', seriesId: 's', name: 'Prayer', movedTo: '2026-08-15' },
        { id: 'c', date: '2026-08-15', seriesId: 's', name: 'Prayer', movedFrom: '2026-08-09' },
        { id: 'd', date: '2026-08-16', seriesId: 's', name: 'Prayer' },
    ];

    assert.strictEqual(page.chipKind(page.occurrences[0]), 'off');
    assert.strictEqual(page.chipKind(page.occurrences[1]), 'off');
    assert.strictEqual(page.chipKind(page.occurrences[2]), 'other', 'the date it moved TO is happening');
    assert.strictEqual(page.chipKind(page.occurrences[3]), 'other');
});

test('a date that moved says where it went', () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    assert.strictEqual(page.movedNote({ movedTo: '2026-08-15' }), 'Moved to 15 August');
    assert.strictEqual(page.movedNote({ movedFrom: '2026-08-09' }), 'Moved from 9 August');
    assert.strictEqual(page.movedNote({ cancelled: true }), 'Not happening');
    assert.strictEqual(page.movedNote({}), '');
});

test('a date not happening never counts as needing sorting', () => {
    // Nobody has to chase a decline for a gathering that is not taking place.
    const Core = require('../public/events-occurrence-core.js');
    const page = loadComponent('calendar.js', 'calendarPage');
    page.rank = 'editor';
    page.today = '2026-08-01';

    const declined = [{ personId: 'p1', roleSlug: 'kids', slotId: 's1', state: 'declined' }];
    assert.strictEqual(Core.needsAttention({ assignments: declined }), true);
    assert.strictEqual(page.chipBar({ cancelled: true, needsAttention: true }),
        require('../public/calendar-view.js').colourOf({}).bar,
        'a skipped date still shouts in the error red');
});

// ── Moving one instance from the Event page ───────────────────────────────────

test('a repeating Event offers to move just this one', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(/openMove\(\)/.test(html), 'no way to move a single date');
    assert.ok(/saveMove\(\)/.test(html));
});

test('moving is offered only where it means something', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';

    // A repeating Event: yes — that is the whole case.
    page.occurrence = { id: 'p_2026-08-02', seriesId: 'p', date: '2026-08-02' };
    page.series = { id: 'p', recurrence: { freq: 'monthly', startDate: '2026-08-02', weekday: 0, nth: 1 } };
    assert.strictEqual(page.canMove, true);

    // A one-off has no pattern to leave alone; you just change its date.
    page.occurrence = { id: 'harvest', seriesId: null, date: '2026-08-02' };
    page.series = null;
    assert.strictEqual(page.canMove, false);

    // The Sunday Service: its order of service lives under its own date.
    page.occurrence = { id: 'sunday_service_2026-08-02', seriesId: 'sunday_service', date: '2026-08-02' };
    page.series = { id: 'sunday_service' };
    assert.strictEqual(page.canMove, false);
});

test('the move form refuses the date it is already on before writing anything', async () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.occurrence = { id: 'p_2026-08-02', seriesId: 'p', date: '2026-08-02' };
    page.series = { id: 'p', recurrence: { freq: 'monthly', startDate: '2026-08-02', weekday: 0, nth: 1 } };

    page.openMove();
    assert.strictEqual(page.move.toDate, '2026-08-02', 'the form does not start where it is');
    assert.strictEqual(page.moveValid, false, 'moving to the same date looked fine');

    page.move.toDate = '2026-08-15';
    assert.strictEqual(page.moveValid, true);
});

// ── The details of a repeating Event ──────────────────────────────────────────
//
// They live on the SERIES, because they are true of every date of it. So the
// screen that sets which Roles recur is the same screen that sets the name, the
// time, the place and who can see it — one place for "what this Event IS".

test('editing a repeating Event goes to the Event, not to a pattern-only modal', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(/'calendar-event\.html\?series=' \+ occurrence\.seriesId/.test(html),
        'one date of a repeating Event has no way through to the Event itself');
});

test('the Event screen edits everything that is true of every date', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    ['seriesDraft.name', 'seriesDraft.location', 'seriesDraft.description',
     'saveSeriesTime(', 'openPattern()', 'setSeriesVisibility(', 'addSeriesRole(', 'setColour(']
        .forEach(binding => {
            assert.ok(html.indexOf(binding) !== -1,
                'the Event screen cannot set ' + binding);
        });
});

test('details are held in a draft, so a half-typed name is never saved', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.series = { id: 'midweek', name: 'Midweek', location: 'The hall', description: '' };
    page.startSeriesDraft();

    assert.strictEqual(page.seriesDetailsChanged, false);
    page.seriesDraft.name = 'Midweek Gathering';
    assert.strictEqual(page.seriesDetailsChanged, true);

    // Undo puts it back rather than leaving a half-edit sitting there.
    page.startSeriesDraft();
    assert.strictEqual(page.seriesDraft.name, 'Midweek');
    assert.strictEqual(page.seriesDetailsChanged, false);
});

test('an Event cannot be saved with no name', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.series = { id: 'midweek', name: 'Midweek' };
    page.startSeriesDraft();
    page.seriesDraft.name = '   ';
    assert.strictEqual(page.seriesDetailsValid, false);
});

test('the Sunday Service keeps its name and its pattern', () => {
    // Everything else in the app refers to both. Renaming it or moving it off
    // Sundays would break the Service Guide and every Involvement record.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(/x-model="seriesDraft.name" :disabled="isSundaySeries"/.test(html),
        'the Sunday Service can be renamed');
    // The "Change pattern" button must sit inside a !isSundaySeries guard: take
    // the text before it and check the nearest guard is that one.
    const before = html.slice(0, html.indexOf('Change pattern'));
    assert.ok(before.lastIndexOf('x-show="!isSundaySeries"') > before.lastIndexOf('</div>') - 400,
        'the Sunday Service pattern can be changed');
    assert.ok(/x-show="!isSundaySeries" class="mt-sm">\s*<button @click="openPattern\(\)"/.test(html),
        'the Change pattern button is not guarded against the Sunday Service');
});

// ── A one-off Event was creatable and then frozen ─────────────────────────────

test('a one-off Event can have its details changed after it exists', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    ['occurrenceDraft.name', 'occurrenceDraft.date', 'occurrenceDraft.time',
     'occurrenceDraft.location', 'occurrenceDraft.description', 'saveOccurrenceDetails()']
        .forEach(binding => {
            assert.ok(html.indexOf(binding) !== -1, 'a one-off cannot set ' + binding);
        });
});

test('the details panel is a one-off\'s, not every Event\'s', () => {
    // One date of a repeating Event must not offer these: its name and time
    // belong to the whole Event, and its date needs "Move this one".
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';

    page.occurrence = { id: 'harvest', seriesId: null, date: '2026-09-20' };
    assert.strictEqual(page.isOneOff, true);

    page.occurrence = { id: 'midweek_2026-08-05', seriesId: 'midweek', date: '2026-08-05' };
    assert.strictEqual(page.isOneOff, false);
});

test('a one-off holds its edits in a draft and can undo them', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.occurrence = { id: 'harvest', seriesId: null, date: '2026-09-20', name: 'Harvest', time: '' };
    page.startOccurrenceDraft();

    assert.strictEqual(page.occurrenceDetailsChanged, false);
    page.occurrenceDraft.time = '18:30';
    assert.strictEqual(page.occurrenceDetailsChanged, true);
    page.startOccurrenceDraft();
    assert.strictEqual(page.occurrenceDraft.time, '');
});

test('a one-off cannot be saved with no name or no date', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.occurrence = { id: 'harvest', seriesId: null, date: '2026-09-20', name: 'Harvest' };
    page.startOccurrenceDraft();

    page.occurrenceDraft.name = '  ';
    assert.strictEqual(page.occurrenceDetailsValid, false);
    page.occurrenceDraft.name = 'Harvest';
    page.occurrenceDraft.date = '';
    assert.strictEqual(page.occurrenceDetailsValid, false);
});

test('a one-off\'s visibility control actually changes its visibility', async () => {
    // It used to render, take the click, and do NOTHING: the handler returned
    // early on `!this.series`, and a one-off has none.
    const writes = [];
    const fakeDb = {
        collection: name => ({
            doc: id => ({
                path: name + '/' + id,
                async get() { return { exists: true, id: id, data: () => ({}) }; },
                async set(data) { writes.push({ path: name + '/' + id, data: data }); },
                collection: sub => fakeDb.collection(name + '/' + id + '/' + sub),
            }),
            where() { return this; },
            async get() { return { docs: [] }; },
        }),
    };

    const page = loadComponent('calendar-event.js', 'eventDetailPage', { db: fakeDb });
    page.rank = 'editor';
    page.occurrence = { id: 'harvest', seriesId: null, date: '2026-09-20', visibility: 'member' };
    page.series = null;

    await page.setVisibility('public');

    assert.deepStrictEqual(writes.map(w => w.path), ['event_occurrences/harvest']);
    assert.strictEqual(writes[0].data.visibility, 'public');
    assert.strictEqual(page.visibility, 'public');
});

// ── One date of a repeating Event only decides who is on ─────────────────────
//
// What the Event IS — who may see it, what colour it draws, which Roles it
// carries — is true of every date, so it is decided once, on the Event. One
// date decides only who is standing in those Roles that day, plus the jobs that
// exist for that day alone.
//
// A control that appears on both would let somebody change every date from a
// screen that looks like it is about one of them.

test('one date of a repeating Event does not decide who can see it', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    // The ladder is still on the page — for a ONE-OFF, whose occurrence is the
    // whole Event — so the guard is what matters.
    assert.ok(/x-show="isEditor && isOneOff"[\s\S]*?Who can see this/.test(html),
        'the visibility ladder is offered on one date of a repeating Event');
});

test('one date of a repeating Event does not decide its colour', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';

    page.occurrence = { id: 'midweek_2026-08-05', seriesId: 'midweek', date: '2026-08-05' };
    page.series = { id: 'midweek' };
    assert.strictEqual(page.colourEditable, false, 'a colour set here would change every date');

    // A one-off's occurrence IS the whole Event, so it decides its own.
    page.occurrence = { id: 'harvest', seriesId: null, date: '2026-09-20' };
    page.series = null;
    assert.strictEqual(page.colourEditable, true);
});

test('a Role the Event carries is shown on one date but never changed there', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    // No way to put a managed Role on one date, and no way to take one off it.
    assert.ok(!/addManagedRole\(/.test(html),
        'a managed Role can still be added to one date');
    assert.ok(!/askRemoveManagedRole\(/.test(html),
        'a managed Role can still be removed from one date');
    // The one-off strip is untouched: those jobs exist for that day alone.
    assert.ok(/addOneOffRole\(\)/.test(html));
    assert.ok(/askRemoveOneOffRole\(/.test(html));
});

test('taking a Role off the Event asks first when people are on it', () => {
    // The guard moved with the control. Removing a Role from the EVENT drops
    // everybody in it on EVERY date, which is a bigger thing than the per-date
    // removal this used to guard, not a smaller one.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(/askRemoveSeriesRole\(/.test(html),
        'a Role comes off the whole Event with no question asked');
    assert.ok(!/@click="removeSeriesRole\(/.test(html),
        'a click removes a Role from every date without asking');
});

test('the question names how many dates and how many people it costs', async () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.series = { id: 'midweek', name: 'Midweek', roleSlugs: ['sound_desk'], lockedRoleSlugs: [] };
    page.roleDefinitions = [SOUND];
    page.people = [{ id: 'p1', name: 'Dave Rowe' }, { id: 'p2', name: 'Sam Hale' }];
    page.seriesRoleUsage = async () => ([
        { date: '2026-08-05', personIds: ['p1'] },
        { date: '2026-08-12', personIds: ['p1', 'p2'] },
    ]);

    await page.askRemoveSeriesRole('sound_desk');

    assert.ok(page.pendingRemoval, 'removed a Role from every date without asking');
    assert.match(page.pendingRemoval.sentence, /2 dates/);
    assert.match(page.pendingRemoval.sentence, /Dave Rowe/);
    assert.match(page.pendingRemoval.sentence, /Sam Hale/);
});

test('a Role nobody is on comes off the Event without a question', async () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.series = { id: 'midweek', name: 'Midweek', roleSlugs: ['sound_desk'], lockedRoleSlugs: [] };
    page.roleDefinitions = [SOUND];
    page.seriesRoleUsage = async () => [];
    let saved = null;
    page.setSeriesRoles = async slugs => { saved = slugs; };

    await page.askRemoveSeriesRole('sound_desk');

    assert.strictEqual(page.pendingRemoval, null);
    assert.deepStrictEqual(saved, []);
});

// ── One Sunday decides who is on, and nothing else ────────────────────────────
//
// Same split as any repeating Event, and a Sunday needs it more: what a Sunday
// IS is settled in three different places — its pattern by definition, its
// visibility by rule, its liturgy in the order of service. None of that is one
// date's to change, so none of it is offered here.

function sundayDate() {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.occurrence = { id: 'sunday_service_2026-08-02', seriesId: 'sunday_service', date: '2026-08-02' };
    page.series = { id: 'sunday_service', recurrence: { freq: 'weekly', weekday: 0, startDate: '2023-01-01', time: '10:30' } };
    return page;
}

test('one Sunday does not decide its colour or who can see it', () => {
    const page = sundayDate();
    assert.strictEqual(page.colourEditable, false);
    assert.strictEqual(page.isOneOff, false);
    // Its visibility is settled by rule, not by a control that could be wrong.
    assert.strictEqual(page.visibilityEditable, false);
});

test('one Sunday does not decide the pattern, and is not skippable here', () => {
    // Every Sunday, by definition — there is no pattern to change. And skipping
    // one here would mark the EVENT off while its order of service sat
    // untouched under its own date, so one Sunday would say two things.
    const page = sundayDate();
    assert.strictEqual(page.canMove, false);
    assert.strictEqual(page.patternEditable, false);

    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(/x-show="isEditor && patternEditable"/.test(html),
        'the pattern controls are not guarded for a Sunday');
});

test('a repeating Event that is not a Sunday keeps all of that', () => {
    // The guard has to be about Sundays, not about repeating Events.
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';
    page.occurrence = { id: 'midweek_2026-08-05', seriesId: 'midweek', date: '2026-08-05' };
    page.series = { id: 'midweek', recurrence: { freq: 'weekly', weekday: 3, startDate: '2026-08-05' } };

    assert.strictEqual(page.patternEditable, true);
    assert.strictEqual(page.canMove, true);
});

test('one Sunday has a way through to the Sunday Service itself', () => {
    // Without it, the only door to the Sunday Service as an Event is a button on
    // the Calendar — so from a Sunday you would have to go back to find it.
    const page = sundayDate();
    assert.strictEqual(page.eventHref, 'calendar-event.html?series=sunday_service');

    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    assert.ok(/:href="eventHref"/.test(html), 'no way through to the Event from one date of it');
});

test('the way through is offered on every date of a repeating Event, Sundays included', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';

    page.occurrence = { id: 'sunday_service_2026-08-02', seriesId: 'sunday_service', date: '2026-08-02' };
    assert.strictEqual(page.eventHref, 'calendar-event.html?series=sunday_service');

    page.occurrence = { id: 'midweek_2026-08-05', seriesId: 'midweek', date: '2026-08-05' };
    assert.strictEqual(page.eventHref, 'calendar-event.html?series=midweek');

    // A one-off has no Event above it — it IS the Event.
    page.occurrence = { id: 'harvest', seriesId: null, date: '2026-09-20' };
    assert.strictEqual(page.eventHref, null);
});

test('a liturgical Role on the Event screen is named, not slugged', () => {
    // They are code-defined, so they are NOT in the `roles` collection — a
    // lookup that only searches stored definitions falls through to the slug and
    // the screen reads "worship_helper" at somebody.
    const Roles = require('../public/roles-core.js');
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.roleDefinitions = [SOUND];
    page.series = {
        id: 'sunday_service',
        roleSlugs: ['worship_helper', 'sermonette', 'prayer', 'sound_desk'],
        lockedRoleSlugs: ['worship_helper', 'sermonette', 'prayer'],
    };

    const named = {};
    page.seriesRoles.forEach(r => { named[r.slug] = r.name; });

    assert.strictEqual(named.worship_helper, 'Music Helper');
    assert.strictEqual(named.sermonette, 'Sermonette');
    assert.strictEqual(named.prayer, 'Prayer');
    assert.strictEqual(named.sound_desk, 'Sound desk');

    // And every liturgical slug resolves, not just these three.
    page.series = { id: 'sunday_service', roleSlugs: Roles.LITURGICAL_SLUGS.slice(), lockedRoleSlugs: [] };
    page.seriesRoles.forEach(r => {
        assert.notStrictEqual(r.name, r.slug, r.slug + ' renders as its slug');
    });
});

test('a Role says how many people it needs each time, not how many "places"', () => {
    // A slot is the model's word. What an editor is deciding is how many people
    // have to be there on the day.
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.roleDefinitions = [
        { slug: 'coffee', name: 'Coffee', slots: [{ id: 's1' }] },
        { slug: 'kids', name: "Children's Ministry", slots: [{ id: 's1' }, { id: 's2' }] },
        { slug: 'greeter', name: 'Greeter', slots: [] },
    ];
    page.series = { id: 'x', roleSlugs: ['coffee', 'kids', 'greeter'], lockedRoleSlugs: [] };

    const need = {};
    page.seriesRoles.forEach(r => { need[r.slug] = r.needed; });

    assert.strictEqual(need.coffee, 'Needs 1 person');
    assert.strictEqual(need.kids, 'Needs 2 people');
    assert.strictEqual(need.greeter, 'Nobody needed yet');
});

// ── The Calendar on a phone ───────────────────────────────────────────────────
//
// Both Calendar pages were WRITTEN for the phone shell — they carry
// `html.shell-mobile` rules and a layout that stacks the rail above the grid —
// and neither loaded the script that sets that class. So every one of those
// rules was dead: styling for a mode the page had no way to enter.

test('both Calendar pages can actually enter the phone shell', () => {
    ['calendar.html', 'calendar-event.html'].forEach(file => {
        const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
        assert.ok(/src="mobile-shell\.js"/.test(html), file + ' cannot enter the shell');
        assert.ok(/href="mobile-shell\.css"/.test(html), file + ' has no shell stylesheet');
        assert.ok(/window\.MOBILE_HEADER/.test(html), file + ' has no shell header');
        assert.ok(/src="mobile-shell-header\.js"/.test(html), file + ' never builds its header');
    });
});

test('the shell script loads before anything that reads the class', () => {
    // It sets `.shell-mobile` on the documentElement, and the page's own styles
    // and scripts branch on it. Loaded late, the first paint is the desktop one.
    ['calendar.html', 'calendar-event.html'].forEach(file => {
        const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
        assert.ok(html.indexOf('mobile-shell.js') < html.indexOf('mobile-shell-header.js'),
            file + ' builds its header before it knows it is in the shell');
        assert.ok(html.indexOf('mobile-shell.js') < html.indexOf('src="calendar'),
            file + ' runs its page script before the shell class is set');
    });
});

test('a Calendar page carrying shell-mobile rules is a page that loads the shell', () => {
    // The general form of the bug, so the next page to add one of these rules
    // cannot forget the script that makes it mean anything.
    fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html')).forEach(file => {
        const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
        if (!/html\.shell-mobile|body\.shell-mobile/.test(html)) return;
        assert.ok(/src="mobile-shell\.js"/.test(html),
            file + ' styles the phone shell but never loads it, so none of those rules fire');
    });
});

test('the phone offers the Calendar, and it is not the Services screen', () => {
    // On mobile, route "calendar" is SERVICES — it predates MS-99 and was only
    // relabelled. Reading the two the other way round sends somebody to the
    // wrong screen entirely.
    const dataJs = fs.readFileSync(path.join(PUBLIC, 'mobile', 'data.js'), 'utf8');
    const appJs = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');

    assert.ok(/\{ key: "events", label: "Calendar", icon: "calendar-days", route: "events" \}/.test(dataJs),
        'the phone drawer has no Calendar');
    assert.ok(/\{ key: "calendar", label: "Services"/.test(dataJs),
        'the Services entry moved or was renamed — check nothing navigates by it');
    assert.ok(/label: "Calendar", route: "events"/.test(appJs), 'the phone home has no Calendar tile');
    assert.ok(/events: "calendar\.html"/.test(appJs), 'the Calendar route opens nothing');
});

test('the Calendar opens as a list on a phone, and a grid on a desktop', () => {
    // Seven columns across a 390px screen gives ~50px a day, which fits a number
    // and nothing else. The list view was already built and reads well one
    // finger-width at a time — so the phone starts there rather than on a grid
    // nobody can use. Month is still one tap away.
    const wide = loadComponent('calendar.js', 'calendarPage');
    assert.strictEqual(wide.view, 'month');

    const phone = loadComponent('calendar.js', 'calendarPage', { MOSAIC_SHELL: 'mobile' });
    assert.strictEqual(phone.view, 'list');
});

// ── The phone's own month ─────────────────────────────────────────────────────
//
// A `dotStrip` helper was once built for a phone month view the templates never
// drew, and was deleted for exactly that reason: it was a feature that could not
// be seen. The design asks for it back — so this time the tests hold BOTH ends,
// the helper and the markup that renders it.

test('the phone has a month of its own, and the desktop grid never runs there', () => {
    // Seven columns across 390px is about 50px a day, which fits a number and
    // nothing else. So the grid stands down and the strip replaces it — rather
    // than the phone showing a squeezed copy nobody can use.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar.html'), 'utf8');

    assert.ok(/html\.shell-mobile \.cal-desktop-only\s*{\s*display:\s*none/.test(html),
        'the desktop layout still draws on a phone');
    assert.ok(/html\.shell-mobile \.cal-phone-only\s*{\s*display:\s*flex/.test(html),
        'the phone block never becomes visible');
    assert.ok(/\.cal-phone-only\s*{\s*display:\s*none/.test(html),
        'the phone block draws on a desktop too');

    // The grid, the desktop toolbar and the desktop list all stand down.
    ['cal-desktop-only mt-gutter flex flex-wrap', 'cal-desktop-only bg-surface-container-lowest']
        .forEach(marker => assert.ok(html.indexOf(marker) !== -1,
            'a desktop-only block was never marked as one: ' + marker));

    assert.ok(/stripDots\(cell\)/.test(html), 'the strip renders no dots');
});

test('List means a list — the strip belongs to Month', () => {
    // A strip above a list is a second answer to a question the list already
    // answers, and it pushes the first card most of a screen down.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar.html'), 'utf8');

    // Anchored on stripDots, which only the phone's strip calls — three grids on
    // this page share the seven-column style, and matching on that would test
    // whichever one happened to come first in the file.
    const dots = html.indexOf('stripDots(cell)');
    assert.ok(dots !== -1, 'the strip moved — this test no longer looks at it');

    // The seven-column grid nearest above that call IS the strip, and its own
    // opening tag is what has to carry the gate.
    const columns = html.lastIndexOf('grid-template-columns', dots);
    const tag = html.slice(html.lastIndexOf('<div', columns), columns);
    assert.ok(/x-show="view === 'month'"/.test(tag),
        'the phone draws its month strip in List as well as Month');
});

test('the phone says "You in July" once, not twice', () => {
    // The rail's panel and the phone's navy hero are the same sentence. Both on
    // one screen reads as a bug, because it is one.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar.html'), 'utf8');
    const said = html.split(/'You in ' \+ monthLabel/).length - 1;
    assert.strictEqual(said, 2, 'the sentence moved or was duplicated again');

    // The rail's copy is the one that stands down.
    const rail = html.indexOf('cal-desktop-only bg-surface-container-lowest border border-outline-variant rounded-lg p-md');
    assert.ok(rail !== -1, 'the rail panel is drawn on a phone as well as the hero');
});

test('the strip shows at most three dots a day', () => {
    // A fourth 5px dot in a ~46px cell has nowhere to go. The strip is a glance;
    // the count lives in the list underneath it.
    const page = loadComponent('calendar.js', 'calendarPage');
    const dots = page.stripDots({ events: [{}, {}, {}, {}, {}] });
    assert.strictEqual(dots.length, 3);
});

test('a day with something to sort shows the same red the chip does', () => {
    const View = require('../public/calendar-view.js');
    const page = loadComponent('calendar.js', 'calendarPage');

    const declined = { needsAttention: true, colour: 'green' };
    assert.strictEqual(page.stripDots({ events: [declined] })[0], View.ATTENTION_COLOUR,
        'a chosen colour was allowed to hide "needs sorting" on the strip');

    // A date nothing is happening on never shouts, exactly as its chip does not.
    const cancelled = { cancelled: true, needsAttention: true };
    assert.notStrictEqual(page.stripDots({ events: [cancelled] })[0], View.ATTENTION_COLOUR);
});

test('the phone body is one day in Month and the whole month in List', () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    page.month = '2026-07';
    page.today = '2026-07-29';
    page.occurrences = [
        { id: 'a', date: '2026-07-29', name: 'Midweek', assignments: [] },
        { id: 'b', date: '2026-07-30', name: "Women's Study", assignments: [] },
    ];

    page.view = 'month';
    assert.strictEqual(page.phoneGroups.length, 1);
    assert.deepStrictEqual(page.phoneGroups[0].events.map(e => e.id), ['a']);
    assert.ok(/Wednesday/.test(page.phoneGroups[0].label), 'the day is not named');

    page.view = 'list';
    assert.strictEqual(
        page.phoneGroups.reduce((n, g) => n + g.events.length, 0), 2);
});

test('an empty day and an empty month say different things', () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    page.view = 'month';
    assert.strictEqual(page.phoneEmptyLine, 'Nothing on this day.');
    page.view = 'list';
    assert.strictEqual(page.phoneEmptyLine, 'Nothing on this month.');
});

test('tapping a corner day of the strip goes to that month', async () => {
    // The strip's first and last cells belong to the neighbouring months, which
    // are not loaded. Showing "nothing on this day" for one of those would be a
    // lie rather than an empty day.
    const page = loadComponent('calendar.js', 'calendarPage');
    page.month = '2026-07';
    page.load = async () => {};

    await page.focusDay({ date: '2026-06-30', inMonth: false });
    assert.strictEqual(page.month, '2026-06');
    assert.strictEqual(page.focusedDate, '2026-06-30');
    assert.strictEqual(page.view, 'month');
});

test('changing month lets go of the day that was tapped', async () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    page.month = '2026-07';
    page.today = '2026-07-29';
    page.load = async () => {};

    await page.focusDay({ date: '2026-07-15', inMonth: true });
    assert.strictEqual(page.focusedDate, '2026-07-15');

    await page.nextMonth();
    // August has no 15th selected, and today is not in it — so the strip falls
    // back to the first, which is a day it is actually showing.
    assert.strictEqual(page.focusedDate, '2026-08-01');
});

// ── Signed out is not the same as an empty church ─────────────────────────────
//
// The phone app opened on its home screen whoever you were. Signed out, that
// meant every tile, the greeting, and behind them every shell page loading as a
// stranger. On the Calendar that renders as a church that holds a service on
// Sunday and does nothing else all week — because a Sunday is fetched BY ID
// regardless of who is asking, while every other Event is filtered by the rungs
// your rank may see. Nothing said so, and no control would let you fix it.

test('the phone app sends a signed-out person to sign in', () => {
    const app = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');

    assert.ok(/nav\("login"\)/.test(app), 'nothing ever routes to the login screen');
    // `undefined` is still loading. Redirecting on it bounces a signed-in person
    // off their own home screen while Firebase restores the session.
    assert.ok(/userState\[0\] !== null\) return/.test(app),
        'the redirect fires on the loading value, not on a decision');
});

test('"continue as guest" is a choice, not a bounce', () => {
    // Without remembering it, the guest lands on home, the redirect fires again
    // and throws them straight back — so the button could never work.
    const app = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');
    assert.ok(/setGuest\(true\); props\.nav\("home"\)/.test(app),
        'choosing guest is not remembered, so the redirect undoes it');
    assert.ok(/if \(isGuest\(\) \|\| routeState\[0\] === "login"\) return/.test(app),
        'the redirect ignores a guest who already chose');
    // And signing in, or out, must not leave the flag behind.
    assert.ok(/if \(u\) setGuest\(false\)/.test(app), 'signing in leaves the guest flag set');
    assert.ok(/setGuest\(false\); data\.signOut\(\)/.test(app), 'signing out leaves the guest flag set');
});

test('the Calendar\'s hamburger opens the drawer rather than going home', () => {
    // It drew a hamburger and did what a back arrow does. The Calendar is the
    // only shell page with one — every other sets `back` — so nothing else was
    // ever going to catch it.
    const header = fs.readFileSync(path.join(PUBLIC, 'mobile-shell-header.js'), 'utf8');
    assert.ok(/isMenu\) \{ window\.location\.href = "mobile\.html#\/home\?menu=1"/.test(header),
        'the hamburger still navigates home instead of asking for the drawer');

    const app = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');
    assert.ok(/currentHashParams\(\)\.menu !== "1"\) return/.test(app),
        'the app ignores the request to open its drawer');

    // ⚠ Assigning location.hash fires `hashchange`, and that handler closes the
    // drawer — so stripping the param that way would close what it just opened.
    assert.ok(/history\.replaceState\(null, "", location\.pathname/.test(app),
        'the menu param is stripped in a way that fires hashchange');
    const strip = app.slice(app.indexOf('currentHashParams().menu !== "1"'));
    assert.ok(!/location\.hash\s*=/.test(strip.slice(0, 500)),
        'the menu param is stripped by assigning location.hash, which closes the drawer');
});

test('closing that drawer goes back to the page that asked for it', () => {
    // Otherwise a tap on the Calendar's hamburger, then a change of mind, leaves
    // you on the home screen having lost the Calendar.
    const app = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');
    const close = app.slice(app.indexOf('function closeMenu()'), app.indexOf('function closeMenu()') + 250);
    assert.ok(/cameForMenu/.test(close) && /history\.back\(\)/.test(close),
        'closing the drawer strands you on the home screen');

    // Every way out uses it: the scrim, and Android's back button.
    assert.ok(/onClose=\$\{closeMenu\}/.test(app), 'the drawer closes without coming back');
    assert.ok(/if \(menuState\[0\]\) \{ closeMenu\(\); return; \}/.test(app),
        'the hardware back button closes the drawer the old way');
    // Picking a destination is a real navigation, so it must NOT come back.
    assert.ok(/cameForMenu = false; nav\(r\)/.test(app),
        'choosing a destination would bounce back to the page you left');
});

test('both Calendar pages say when nobody is signed in', () => {
    ['calendar', 'calendar-event'].forEach(page => {
        const html = fs.readFileSync(path.join(PUBLIC, page + '.html'), 'utf8');
        assert.ok(/x-show="signedOut"/.test(html), page + ' never says you are signed out');
        assert.ok(/:href="signInHref"/.test(html), page + ' says so but offers no way in');
    });

    // And it is a fact about the viewer, not about the month: an editor with
    // nothing on in August must never see it.
    const cal = loadComponent('calendar.js', 'calendarPage');
    cal.loading = false;
    cal.rank = null;
    assert.strictEqual(cal.signedOut, true);
    cal.rank = 'viewer';
    assert.strictEqual(cal.signedOut, false, 'a signed-in viewer is told they are signed out');
    cal.rank = null;
    cal.loading = true;
    assert.strictEqual(cal.signedOut, false, 'the notice flashes before auth has answered');

    const ev = loadComponent('calendar-event.js', 'eventDetailPage');
    ev.loading = false;
    ev.rank = null;
    assert.strictEqual(ev.signedOut, true);
    ev.rank = 'member';
    assert.strictEqual(ev.signedOut, false);
});

test('a Sunday is the one Event a stranger always sees, so it cannot stand for the rest', () => {
    // This is what made the bug read as "my recurring event did not save": the
    // series query filters by visibility rung, and the Sunday Service is added
    // by an explicit fetch outside it. Pin the asymmetry so nobody "tidies" the
    // fetch away, or widens it into a hole.
    const store = fs.readFileSync(path.join(PUBLIC, 'events-store.js'), 'utf8');
    const fn = store.slice(store.indexOf('async function loadVisibleSeries'),
        store.indexOf('async function attachRosters'));

    assert.ok(/where\('visibility', 'in', q\.rungs\)/.test(fn),
        'series are no longer filtered by what the viewer may see');
    assert.ok(/doc\(Core\.SUNDAY_SERVICE_ID\)/.test(fn),
        'the Sunday Service is no longer fetched by id, so a public reader loses it');
    assert.ok(!/doc\((?!Core\.SUNDAY_SERVICE_ID)/.test(fn),
        'something other than the Sunday Service is being fetched around the visibility filter');
});

// ── The Event on a phone ──────────────────────────────────────────────────────

test('a member gets the roster, not the editor\'s Role cards', () => {
    // A member used to get numbered places, empty-slot rows and per-person state
    // controls they cannot use — AND the flat list, so the same people were named
    // twice on one screen. Administering is the editor's job; a member is
    // answering "who else is coming".
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');

    const roles = html.indexOf('<!-- ── Roles ──');
    assert.ok(roles !== -1, 'the Roles section moved');
    const gate = html.slice(roles, html.indexOf('>', html.indexOf('<section', roles)));
    assert.ok(/x-show="isEditor"/.test(gate) && !/canSeeRoster/.test(gate),
        'a member is still shown the editor\'s Role cards');

    // And the list they DO get is named once.
    assert.strictEqual(html.split(">Who's serving<").length - 1, 1,
        'the roster is drawn twice, or its heading moved');
});

test('a slot row is survivable on a 390px screen', () => {
    // Number, requirement, avatar, name, state and four buttons is eight things.
    // 390px holds about half, and the rest wrap into a shape nobody designed.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');

    [
        ['cal-slot-index', 'the place number'],
        ['cal-slot-avatar', 'the avatar'],
        ['cal-role-glyph', 'the badge glyph'],
        ['cal-role-everydate', 'the per-card way through to the Event'],
        ['cal-when-icon', 'the date/time/place glyphs'],
    ].forEach(([hook, what]) => {
        assert.ok(html.indexOf('class="' + hook) !== -1 || html.indexOf(' ' + hook + ' ') !== -1,
            'nothing carries ' + hook + ', so ' + what + ' cannot stand down on a phone');
        assert.ok(new RegExp('html\\.shell-mobile[^{]*\\.' + hook).test(html),
            hook + ' is on an element but no phone rule ever hides it');
    });

    // The controls drop to a line of their own rather than squeezing the name.
    assert.ok(/html\.shell-mobile \.cal-slot-row \{[^}]*flex-wrap: wrap/.test(html),
        'a slot row cannot wrap, so its controls squeeze the name off the screen');
});

test('every phone rule on the Event page has something to style', () => {
    // The general form of the bug this page keeps hitting: a rule for a class
    // nothing carries is styling for an element that does not exist.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar-event.html'), 'utf8');
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const body = html.slice(html.indexOf('</style>'));

    const hooks = new Set();
    const re = /html\.shell-mobile\s+\.([\w-]+)/g;
    let m;
    while ((m = re.exec(style))) hooks.add(m[1]);
    assert.ok(hooks.size, 'the phone rules moved out of this page');

    hooks.forEach(hook => {
        assert.ok(new RegExp('class="[^"]*\\b' + hook + '\\b').test(body),
            'no element carries ' + hook + ', so that phone rule can never fire');
    });
});

test('a phone card names a Sunday once', () => {
    // The name directly above the marker already says "Sunday Service". A card
    // that says the same thing twice reads as a bug, because it is one.
    const html = fs.readFileSync(path.join(PUBLIC, 'calendar.html'), 'utf8');
    assert.ok(!/Sunday service\s*\n?\s*<\/div>/i.test(html),
        'the phone card repeats the event name back at itself');
});

test('a deployed page is never left running against yesterday\'s script', () => {
    // Nothing here is content-hashed — calendar.js is always calendar.js — and
    // Firebase caches everything for an hour by default. So for an hour after a
    // deploy a browser can run the NEW page against the OLD script. Alpine
    // swallows a binding to a member the old script never had, so the symptom is
    // a blank screen rather than an error: this cost an hour to find once.
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));
    const headers = (config.hosting && config.hosting.headers) || [];

    const code = headers.find(h => /html\|js\|css|js\|css/.test(h.source || ''));
    assert.ok(code, 'nothing tells hosting to revalidate the pages and scripts');

    const cacheControl = (code.headers || []).find(h => h.key === 'Cache-Control');
    assert.ok(cacheControl && /no-cache|no-store|max-age=0/.test(cacheControl.value),
        'the pages and scripts are still cached without revalidating');
});

test('the shell tells the page how far under the notch it is', () => {
    // Without `viewport-fit=cover` every env(safe-area-inset-*) reads 0, so the
    // shell's own header pads itself by nothing and lands under the dynamic
    // island. Seven pages had forgotten the meta, mobile-shell.css had two
    // safe-area rules that could never fire, and the symptom reads as "the
    // header is too thin" rather than as a missing inset. So the shell sets it.
    const shell = fs.readFileSync(path.join(PUBLIC, 'mobile-shell.js'), 'utf8');
    assert.ok(/viewport-fit=cover/.test(shell),
        'the shell never asks iOS for the safe-area insets it styles against');
    assert.ok(shell.indexOf('viewport-fit') < shell.indexOf('classList.add("shell-mobile")')
        || /classList\.add\("shell-mobile"\)[\s\S]*viewport-fit/.test(shell),
        'the viewport is set after the page has already painted');
});

test('nothing styles a safe-area inset the shell cannot report', () => {
    // The general form: any file leaning on env(safe-area-inset-*) is relying on
    // the shell having asked for it.
    const css = fs.readFileSync(path.join(PUBLIC, 'mobile-shell.css'), 'utf8');
    const shell = fs.readFileSync(path.join(PUBLIC, 'mobile-shell.js'), 'utf8');
    if (!/env\(safe-area-inset/.test(css)) return;
    assert.ok(/viewport-fit=cover/.test(shell),
        'mobile-shell.css pads by safe-area insets that always read 0');
});
