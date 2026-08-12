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

// The Roles surface is shared between the Event detail screen and the service
// page, so its markup lives in roles-panel.js and each page carries a
// placeholder (MS-16). Reading a page here means reading what the browser will
// actually see, so the panel is spliced back in — otherwise every assertion
// about a slot row would quietly pass by finding nothing at all.
const RolesPanel = require('../public/roles-panel.js');

function readPage(htmlFile) {
    const html = fs.readFileSync(path.join(PUBLIC, htmlFile), 'utf8');
    return html.replace(
        /<div data-roles-panel="(\w+)"><\/div>/g,
        (whole, name) => RolesPanel.MARKUP[name] || whole);
}

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
    sandbox.FamilyCore = require('../public/family-core.js');
    sandbox.EventsCore = require('../public/events-core.js');
    sandbox.FairnessCore = require('../public/fairness-core.js');
    sandbox.DateUtils = require('../public/date-utils.js');
    sandbox.AutoAssignCore = require('../public/auto-assign-core.js');
    sandbox.AutoAssignGridCore = require('../public/auto-assign-grid-core.js');
    sandbox.AutoAssignEditCore = require('../public/auto-assign-edit-core.js');
    sandbox.AutoAssignPanelCore = require('../public/auto-assign-panel-core.js');
    sandbox.AutoAssignSavedCore = require('../public/auto-assign-saved-core.js');
    sandbox.RecurringRosterCore = require('../public/recurring-roster-core.js');
    sandbox.AwayCore = require('../public/away-core.js');
    sandbox.AwayStore = require('../public/away-store.js');

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

// Alpine gives every component `$nextTick` and `$refs`; the raw object built
// here has neither. A page that measures its own layout needs both to exist —
// with no DOM behind them the measuring simply finds nothing and stops, which
// is what a test wants.
function withAlpine(page) {
    page.$nextTick = fn => fn();
    page.$refs = {};
    return page;
}

// Every member the component exposes, including getters (which live on the
// object as accessor descriptors, so a plain `in` check finds them).
function membersOf(component) {
    return new Set(Object.keys(Object.getOwnPropertyDescriptors(component)));
}

// ── Pulling the identifiers out of the markup ─────────────────────────────────

const ALPINE_ATTRS = /(?:x-text|x-show|x-if|x-model[.\w]*|x-html|x-for|@click|@change|@keydown[.\w]*|:class|:href|:disabled|:checked|:selected|:value|:aria-label|:style|:inert)\s*=\s*"([^"]*)"/g;

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
    const html = readPage(htmlFile);
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

// ── The markup itself holds together ──────────────────────────────────────────
//
// Both of these shipped, and both render as a page that draws its heading and
// then stops — no error, nothing in the console, just missing.
//
//   A STRAY </div> closed an x-if wrapper early. Alpine renders ONE root
//   element per template, so everything after the stray tag became a sibling
//   and was silently dropped. The page showed a title and a date and nothing
//   else.
//
//   A MISSING ">" on an opening tag, left behind when an attribute was removed.
//   The browser swallows the following elements into the attribute list, so a
//   whole row vanishes into a tag nobody can see.
//
// Neither is catchable by eye in a 400-line template, and neither fails any
// test about behaviour, because the component underneath is perfectly fine.

const VOID_ELEMENTS = new Set([
    'br', 'hr', 'img', 'input', 'meta', 'link', 'source',
    'area', 'base', 'col', 'embed', 'param', 'track', 'wbr',
]);

// Style and script bodies are not markup — CSS braces and JS comparisons both
// contain characters a tag scanner would take for tags.
function markupOf(html) {
    return html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '');
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;

function tagProblems(html) {
    const src = markupOf(html);
    const problems = [];
    const stack = [];

    // An opening tag whose ">" went missing swallows whatever follows it. The
    // giveaway is a "<" inside what the scanner read as the attribute list.
    let m;
    TAG.lastIndex = 0;
    while ((m = TAG.exec(src))) {
        const [, closing, tag, attrs, selfClosing] = m;

        if (attrs.indexOf('<') !== -1) {
            problems.push('<' + tag + '> is missing its ">" — it has swallowed '
                + 'the markup after it: ' + attrs.replace(/\s+/g, ' ').trim().slice(0, 70));
            continue;
        }
        if (VOID_ELEMENTS.has(tag) || selfClosing) continue;

        if (!closing) { stack.push(tag); continue; }
        if (stack[stack.length - 1] === tag) { stack.pop(); continue; }

        problems.push('</' + tag + '> closes nothing — the innermost open tag is <'
            + (stack[stack.length - 1] || 'nothing') + '>');
        break;
    }

    if (stack.length) problems.push('never closed: ' + stack.join(' > '));
    return problems;
}

// Alpine renders the FIRST root element of a template and drops the rest,
// without saying so.
function xIfRootCounts(html) {
    const src = markupOf(html);
    const counts = [];
    const opener = /<template\s+x-if\s*=\s*"([^"]*)"\s*>/g;

    let open;
    while ((open = opener.exec(src))) {
        let depth = 0;
        let roots = 0;
        TAG.lastIndex = open.index + open[0].length;

        let m;
        while ((m = TAG.exec(src))) {
            const [, closing, tag, , selfClosing] = m;
            if (tag === 'template' && closing && depth === 0) break;
            if (VOID_ELEMENTS.has(tag) || selfClosing) { if (depth === 0) roots++; continue; }
            if (!closing) { if (depth === 0) roots++; depth++; } else { depth--; }
        }
        counts.push({ expression: open[1], roots: roots });
    }
    return counts;
}

const CALENDAR_PAGES = ['calendar.html', 'calendar-event.html', 'auto-assign.html', 'recurring-events.html', 'away.html'];

test('every calendar page is well-formed markup', () => {
    CALENDAR_PAGES.forEach(file => {
        assert.deepStrictEqual(tagProblems(readPage(file)), [], file + ' has broken markup');
    });
});

test('every x-if template has exactly one root element', () => {
    CALENDAR_PAGES.forEach(file => {
        xIfRootCounts(readPage(file)).forEach(found => {
            assert.strictEqual(found.roots, 1,
                file + ': x-if="' + found.expression + '" has ' + found.roots
                + ' root elements. Alpine renders the first and silently drops the rest.');
        });
    });
});

// ── The pages ─────────────────────────────────────────────────────────────────

test('the Calendar page only binds to things its component defines', () => {
    checkPage('calendar.html', 'calendar.js', 'calendarPage');
});

test('the Event detail page only binds to things its component defines', () => {
    checkPage('calendar-event.html', 'calendar-event.js', 'eventDetailPage');
});

test('the Auto-assign page only binds to things its component defines', () => {
    checkPage('auto-assign.html', 'auto-assign.js', 'autoAssignPage');
});

test('the Recurring Events page only binds to things its component defines', () => {
    checkPage('recurring-events.html', 'recurring-events.js', 'recurringEventsPage');
});

// ── The Away page's one piece of real logic ──────────────────────────────────

test('a single tapped day is checked for clashes, not just a settled range', () => {
    // REPORTED FROM THE PREVIEW. The first tap sets both ends of the selection,
    // so the button goes live one tap in and the sentence explicitly offers it —
    // "press below for the one day". But the clash was gated on the range being
    // SETTLED, so you could tap a Sunday you were serving on, press the button,
    // and never be told. That is the one thing this screen exists to tell you.
    const page = loadComponent('away.js', 'awayPage');
    page.places = [{ date: '2026-09-27', when: 'Sunday 27 September', role: 'Coffee', event: 'Sunday Service', occurrenceId: 'o1' }];

    page.tap('2026-09-27');

    assert.equal(page.canAdd, true, 'one tap in, the day is saveable');
    assert.equal(page.clashes.length, 1, 'so one tap in, it must already be checked');
    assert.equal(page.hasClash, true);
});

test('anything the button will save has been checked first', () => {
    // The invariant behind the bug above: `canAdd` and the clash check must
    // never disagree about whether a selection is real.
    const page = loadComponent('away.js', 'awayPage');
    page.places = [{ date: '2026-09-27', when: 'Sunday 27 September', role: 'Coffee', event: 'Sunday Service', occurrenceId: 'o1' }];

    ['2026-09-27', '2026-09-28', '2026-10-04'].forEach(iso => {
        page.tap(iso);
        assert.equal(page.canAdd, page.selectionMade,
            'the button and the check disagree after tapping ' + iso);
    });
});

test('a conflict already on record shows with nothing selected at all', () => {
    // The screen opens on it. A place you are serving on a day you already said
    // you were away is still yours to sort out tomorrow, so it is not something
    // the screen mentions only while you happen to be mid-selection.
    const page = loadComponent('away.js', 'awayPage');
    page.places = [{ date: '2026-09-27', when: 'Sunday 27 September', role: 'Coffee', event: 'Sunday Service', occurrenceId: 'o1' }];
    page.stretches = [{ id: 'a1', start: '2026-09-27', end: '2026-09-27' }];

    assert.equal(page.selectionMade, false, 'nothing is selected');
    assert.equal(page.hasClash, true, 'and it still says so');
    assert.equal(page.conflicts.length, 1);
    assert.match(page.clashHeading, /falls on a day you're away/);
});

test('a conflict does not vanish once the days are saved', () => {
    // What saving looks like from the panel's side: the selection clears, the
    // stretch lands, and the conflict carries straight over rather than blinking
    // out at the exact moment it becomes real.
    const page = loadComponent('away.js', 'awayPage');
    page.places = [{ date: '2026-09-27', when: 'Sunday 27 September', role: 'Coffee', event: 'Sunday Service', occurrenceId: 'o1' }];

    page.tap('2026-09-27');
    assert.equal(page.conflicts.length, 1, 'while choosing');

    page.stretches = [{ id: 'a1', start: '2026-09-27', end: '2026-09-27' }];
    page.clearSelection();
    assert.equal(page.conflicts.length, 1, 'and after saving');
});

test('a place inside both a saved stretch and the selection is listed once', () => {
    const page = loadComponent('away.js', 'awayPage');
    page.places = [{ date: '2026-09-27', when: 'Sunday 27 September', role: 'Coffee', event: 'Sunday Service', occurrenceId: 'o1' }];
    page.stretches = [{ id: 'a1', start: '2026-09-27', end: '2026-09-27' }];

    page.tap('2026-09-27');
    assert.equal(page.conflicts.length, 1, 'not doubled');
});

test('the all-clear waits for a settled range, unlike the clash', () => {
    // Warn early, reassure late. Said one tap into an intended fortnight, "nothing
    // of yours falls in these dates" answers a question about a single day nobody
    // meant — and then flips when the range closes.
    const page = loadComponent('away.js', 'awayPage');
    page.places = [];

    page.tap('2026-09-07');
    assert.equal(page.allClear, false, 'silence, not premature reassurance');

    page.tap('2026-09-20');
    assert.equal(page.allClear, true, 'once the range is settled, say so');
});

test('the Away page only binds to things its component defines', () => {
    // MS-188. This page draws the SAME day cell twice — once for the desktop
    // pair of months and once for the phone's scroll — so a helper renamed on
    // one and not the other is exactly the blank-cell bug this file exists for.
    checkPage('away.html', 'away.js', 'awayPage');
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
        // Auto-assign steps the solve across dates, so it needs BOTH the loop
        // and the fairness underneath it — the loop imports nothing and would
        // throw the moment it was handed a solve that was not there.
        'auto-assign.html': ['events-occurrence-core.js', 'events-store.js', 'roles-core.js', 'events-core.js',
                             'fairness-core.js', 'auto-assign-core.js', 'auto-assign-grid-core.js',
                             'auto-assign-edit-core.js', 'auto-assign-panel-core.js',
                             'auto-assign-saved-core.js',
                             'calendar-view.js', 'date-utils.js', 'auto-assign.js'],
        // Away reads the Calendar's own occurrences to find the places a
        // stretch clashes with, rather than opening a second read path.
        'away.html': ['away-core.js', 'away-store.js', 'events-store.js', 'events-occurrence-core.js',
                      'roles-core.js', 'date-utils.js', 'away.js'],
    };

    Object.keys(NEEDED).forEach(page => {
        const html = readPage(page);
        NEEDED[page].forEach(src => {
            assert.match(html, new RegExp('src="' + src.replace('.', '\\.') + '"'), page + ' does not load ' + src);
        });
    });
});

test('the week-shift page loads the modules it now depends on', () => {
    // MS-152 taught the shift to move occurrences; without these it silently
    // skips them and loses the week's roster.
    const html = readPage('service-calendar.html');
    assert.match(html, /src="events-occurrence-core\.js"/);
    assert.match(html, /src="events-store\.js"/);
});

// ── The Calendar is reachable ─────────────────────────────────────────────────

test('the dashboard offers the Calendar, and it is not the Services card', () => {
    const html = readPage('index.html');
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
    const html = readPage('calendar-event.html');
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
    const html = readPage('calendar.html');
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
        const html = readPage(file);
        assert.deepStrictEqual(orphanedRowActions(html), [],
            file + ' hides a control with no .cal-row to reveal it');
    });
});

test('the control that removes a recurring Role from an Event is reachable', () => {
    // It lives on the EVENT screen now, not on one date — but it is still a
    // control that once shipped invisible, so it stays pinned.
    const html = readPage('calendar-event.html');
    assert.ok(/askRemoveSeriesRole\(/.test(html), 'nothing removes a recurring Role');
    assert.deepStrictEqual(orphanedRowActions(html).filter(l => /role/i.test(l)), []);
});

test('an editor can set the state of a one-off assignment, not just remove them', () => {
    // A one-off Role is still a real Assignment carrying a real state — it goes
    // in pending like any other. Without a control here an editor can put
    // somebody on the door and never mark them confirmed, so the strip lies.
    const html = readPage('calendar-event.html');

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
    const html = readPage('calendar-event.html');
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
    const html = readPage('calendar-event.html');
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

test('the Calendar offers the events that repeat as a thing above all their dates', () => {
    // Two different doors, and they must stay different: this one opens the
    // EVENTS - their time, and the Roles each one carries every date - while a
    // chip opens one date of one of them.
    //
    // It used to be a single button marked "Sunday Service", which was the only
    // door to the only series anybody had. A button per Event does not survive
    // the second one, so the door is now the list and the Sunday Service is its
    // first row.
    const html = readPage('calendar.html');
    assert.ok(/href="recurring-events\.html"/.test(html),
        'no way into the events that repeat');

    const hrefs = [];
    const page = calendarIn(hrefs);
    page.open({ id: 'sunday_service_2026-07-12', date: '2026-07-12', isSunday: true });
    assert.doesNotMatch(hrefs[0], /series=/, 'a chip opened the whole series instead of its date');
});

test('the Recurring Events page keeps every door it promises', () => {
    // The page is deliberately read-only, so it exists to be left through: to
    // the Event itself, to one date, to a new recurring Event, and to the draft
    // room with the ticked dates in hand. A door that leads nowhere strands the
    // editor on a screen that cannot change the thing they came to change.
    const page = loadComponent('recurring-events.js', 'recurringEventsPage');
    page.seriesId = 'sunday_service';

    assert.strictEqual(page.seriesHref('sunday_service'),
        'calendar-event.html?series=sunday_service', 'no door to the Event itself');
    assert.strictEqual(page.eventHref, 'calendar-event.html?series=sunday_service');
    assert.strictEqual(page.dateHref('2026-08-09'),
        'calendar-event.html?id=sunday_service_2026-08-09', 'no door into a single date');

    // The create form defaults to "just once", which is the wrong default from a
    // page that is entirely about the ones that come round.
    assert.match(page.newEventHref, /repeats=/, 'a new event from here would not repeat');

    // Auto-assign with nothing ticked drafts the series itself — this is the
    // door that moved off the Calendar, where it could not know which series
    // you meant. With columns ticked it carries that range instead, and the
    // label is the only thing that says which of the two you are about to get.
    assert.strictEqual(page.draftHref, 'auto-assign.html?series=sunday_service');
    assert.strictEqual(page.draftLabel, 'Auto-assign');

    page.allDates = ['2026-08-09', '2026-08-16', '2026-08-23'];
    page.selected = ['2026-08-09', '2026-08-16'];
    assert.strictEqual(page.draftHref,
        'auto-assign.html?series=sunday_service&from=2026-08-09&to=2026-08-16');
    assert.strictEqual(page.draftLabel, 'Auto-assign 2 dates');

    // A scattered tick counts what will really open, not what was ticked.
    page.selected = ['2026-08-09', '2026-08-23'];
    assert.strictEqual(page.draftLabel, 'Auto-assign 3 dates');
});

test('the draft room takes the series and range it is handed', () => {
    // The other half of that door. Landing on a default range of the
    // alphabetically-first series would throw away the choice the editor just
    // made, and make them make it again from a dropdown.
    const page = loadComponent('auto-assign.js', 'autoAssignPage', {
        location: { search: '?series=midweek&from=2026-08-05&to=2026-08-26', href: '' },
    });
    page.series = [{ id: 'sunday_service', name: 'Sunday Service' }, { id: 'midweek', name: 'Midweek' }];
    page.onRangeSettled = () => {};

    page.applyIncoming();

    assert.strictEqual(page.seriesId, 'midweek', 'ignored the series it was sent to');
    assert.strictEqual(page.fromDate, '2026-08-05');
    assert.strictEqual(page.toDate, '2026-08-26');
    assert.strictEqual(page.preset, null, 'a ticked range is not one of the presets');
});

test('the draft room ignores a link it cannot honour, rather than erroring', () => {
    // A stale or hand-typed link should open the ordinary page. An id in the
    // address bar is a request, not a permission.
    const page = loadComponent('auto-assign.js', 'autoAssignPage', {
        location: { search: '?series=elders_only&from=nonsense&to=2026-08-26', href: '' },
    });
    page.series = [{ id: 'sunday_service', name: 'Sunday Service' }];
    page.seriesId = 'sunday_service';
    page.fromDate = '2026-07-01';
    page.toDate = '2026-07-29';
    page.onRangeSettled = () => {};

    page.applyIncoming();

    assert.strictEqual(page.seriesId, 'sunday_service', 'took a series it cannot see');
    assert.strictEqual(page.fromDate, '2026-07-01', 'took half a range');
    assert.strictEqual(page.toDate, '2026-07-29');
});

test('the Recurring Events page loads its models in an order that works', () => {
    // Classic scripts, so a core loaded after the page that reads it is
    // undefined at parse time — the page renders and simply cannot lay a grid
    // out. The same trap the events store test below covers.
    const html = readPage('recurring-events.html');
    const at = name => html.indexOf('src="' + name + '"');

    ['events-core.js', 'events-occurrence-core.js', 'roles-core.js',
        'calendar-view.js', 'recurring-roster-core.js'].forEach(dep => {
        assert.ok(at(dep) !== -1, 'recurring-events.html does not load ' + dep);
        assert.ok(at(dep) < at('recurring-events.js'),
            'recurring-events.js is loaded before ' + dep);
    });
    assert.ok(at('events-core.js') < at('events-store.js'),
        'the events store is loaded before the series model');
});

test('every page that loads the events store loads the series model first', () => {
    // events-store.js now reaches for window.EventsCore. A classic script that
    // loads them the other way round leaves it undefined at parse time — and the
    // page renders, it just cannot manage a series.
    ['calendar.html', 'calendar-event.html', 'service-calendar.html'].forEach(file => {
        const html = readPage(file);
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
    const html = readPage('calendar-event.html');
    assert.ok(!/askRemoveManagedRole\(/.test(html));
    assert.ok(!/addManagedRole\(/.test(html));
    // A way THROUGH to where it is decided, instead.
    assert.ok(/Change the roles this event needs/.test(html));
});

test('a Sunday date shows its Roles section at all', () => {
    // It once did not: the whole section was hidden on a Sunday, so the welcome
    // team and the sound desk had nowhere to be asked. The liturgical Roles stay
    // out of it, which is what made hiding the section look reasonable.
    const html = readPage('calendar-event.html');
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
    const html = readPage('calendar.html');
    assert.ok(/@click\.stop="open\(ev\)"/.test(html),
        'an event chip lets its click reach the day underneath');
});

test('the day menu closes on Escape and on the next click', () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    page.rank = 'editor';
    page.openDayMenu({ date: '2026-07-15' }, { clientX: 10, clientY: 10 });

    page.closeDayMenu();
    assert.strictEqual(page.dayMenu, null);

    const html = readPage('calendar.html');
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
    const html = readPage('calendar-event.html');
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

// ── Getting rid of an Event ───────────────────────────────────────────────────
//
// Two different asks that look like one. A one-off is DELETED — it is its own
// single document and there is nothing above it. One date of a repeating Event
// is SKIPPED — the pattern still produces that date, so deleting the document
// would only remove the note saying it is off and the Calendar would draw the
// event straight back.

test('a one-off can be deleted from its own page; a date of a series cannot', () => {
    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.rank = 'editor';

    page.occurrence = { id: 'harvest', seriesId: null, date: '2026-08-02' };
    assert.strictEqual(page.canDelete, true);

    page.occurrence = { id: 'p_2026-08-02', seriesId: 'p', date: '2026-08-02' };
    assert.strictEqual(page.canDelete, false, 'the pattern would draw it back');

    // A member never gets the offer.
    page.rank = 'member';
    page.occurrence = { id: 'harvest', seriesId: null, date: '2026-08-02' };
    assert.strictEqual(page.canDelete, false);
});

test('the page offers both, and says which people go with it', () => {
    const html = readPage('calendar-event.html');
    assert.ok(/deleteThisEvent\(\)/.test(html), 'a one-off has no way to be deleted');
    assert.ok(/skipThisOne\(\)/.test(html), 'a date of a series has no way to be skipped');
    assert.ok(/pendingDelete/.test(html), 'deleting an event happens without a word of warning');

    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.assignments = [];
    assert.match(page.deleteSentence, /Nobody/);
    page.assignments = [{ personId: 'p1' }];
    assert.match(page.deleteSentence, /^One person/);
    page.assignments = [{ personId: 'p1' }, { personId: 'p2' }];
    assert.match(page.deleteSentence, /^2 people/);
});

test('deleting a one-off takes its roster and leaves the page', async () => {
    const writes = [];
    const fakeDb = {
        collection: name => ({
            doc: id => ({
                path: name + '/' + id,
                async get() {
                    return { exists: true, id: id, data: () => ({ seriesId: null, date: '2026-08-02' }) };
                },
                collection: sub => ({
                    async get() {
                        return {
                            docs: [{ id: 'r1', ref: { path: name + '/' + id + '/' + sub + '/r1' } }],
                        };
                    },
                }),
            }),
        }),
        batch: () => ({
            delete: ref => writes.push(ref.path),
            set() {}, update() {},
            async commit() {},
        }),
    };

    const location = { search: '?id=harvest', href: '' };
    const page = loadComponent('calendar-event.js', 'eventDetailPage', { db: fakeDb, location });
    page.rank = 'editor';
    page.occurrence = { id: 'harvest', seriesId: null, date: '2026-08-02' };
    page.pendingDelete = true;

    await page.deleteThisEvent();

    assert.deepStrictEqual(writes, ['event_occurrences/harvest/roster/r1', 'event_occurrences/harvest']);
    assert.match(location.href, /calendar\.html/,
        'the page stays open on something that is gone');
});

// The bug: "Skip this one" is usually the FIRST thing to land on a date, so its
// write is usually the write that CREATES the document — and it wrote the flag
// alone. An occurrence with no `visibility` is refused to everyone by the rule
// and dropped by every list query, so the skip vanished and the Calendar drew
// the date as though nothing had happened.
test('skipping a date nobody has touched hands over the series, so the date is stamped', async () => {
    let written = null;
    const fakeDb = {
        collection: name => ({
            doc: id => ({
                path: name + '/' + id,
                async get() {
                    const err = new Error('Missing or insufficient permissions.');
                    err.code = 'permission-denied';
                    throw err;
                },
                async set(data, options) { written = { path: name + '/' + id, data, options }; },
            }),
        }),
    };

    const page = loadComponent('calendar-event.js', 'eventDetailPage', { db: fakeDb });
    page.rank = 'editor';
    page.occurrence = { id: 'p_2026-08-02', seriesId: 'p', date: '2026-08-02', cancelled: false };
    page.series = { id: 'p', visibility: 'participant', rosterShared: true };

    await page.skipThisOne();

    assert.strictEqual(page.occurrence.cancelled, true);
    assert.strictEqual(written.path, 'event_occurrences/p_2026-08-02');
    assert.strictEqual(written.data.cancelled, true);
    assert.strictEqual(written.data.visibility, 'participant',
        'unstamped, the skip is invisible to everyone including the editor who made it');
    assert.strictEqual(written.data.seriesId, 'p');
    assert.strictEqual(written.data.date, '2026-08-02');
});

// ── The details of a repeating Event ──────────────────────────────────────────
//
// They live on the SERIES, because they are true of every date of it. So the
// screen that sets which Roles recur is the same screen that sets the name, the
// time, the place and who can see it — one place for "what this Event IS".

test('editing a repeating Event goes to the Event, not to a pattern-only modal', () => {
    const html = readPage('calendar-event.html');
    assert.ok(/'calendar-event\.html\?series=' \+ occurrence\.seriesId/.test(html),
        'one date of a repeating Event has no way through to the Event itself');
});

test('the Event screen edits everything that is true of every date', () => {
    const html = readPage('calendar-event.html');
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
    const html = readPage('calendar-event.html');
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
    const html = readPage('calendar-event.html');
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
    const html = readPage('calendar-event.html');
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
    const html = readPage('calendar-event.html');
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
    const html = readPage('calendar-event.html');
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

    const html = readPage('calendar-event.html');
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

    const html = readPage('calendar-event.html');
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
        const html = readPage(file);
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
        const html = readPage(file);
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
        const html = readPage(file);
        if (!/html\.shell-mobile|body\.shell-mobile/.test(html)) return;
        assert.ok(/src="mobile-shell\.js"/.test(html),
            file + ' styles the phone shell but never loads it, so none of those rules fire');
    });
});

test('the phone offers the Calendar, and it is not the Services screen', () => {
    // On mobile, route "calendar" is SERVICES — it predates MS-99 and was only
    // relabelled. Reading the two the other way round sends somebody to the
    // wrong screen entirely.
    // The drawer list lives in mobile/destinations.js — shared with the shell's
    // own drawer, which is a separate document and cannot load data.js.
    const D = require('../public/mobile/destinations.js');
    const appJs = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');

    const calendar = D.DESTINATIONS.find(d => d.key === 'events');
    assert.ok(calendar && calendar.label === 'Calendar' && calendar.route === 'events',
        'the phone drawer has no Calendar');
    const services = D.DESTINATIONS.find(d => d.key === 'calendar');
    assert.ok(services && services.label === 'Services' && services.route === 'calendar',
        'the Services entry moved or was renamed — check nothing navigates by it');

    assert.ok(/label: "Calendar", route: "events"/.test(appJs), 'the phone home has no Calendar tile');
    assert.strictEqual(D.SHELL_PAGES.events, 'calendar.html', 'the Calendar route opens nothing');
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
    const html = readPage('calendar.html');

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
    const html = readPage('calendar.html');

    // Anchored on stripDots, which only the phone's strip calls — three grids on
    // this page share the seven-column style, and matching on that would test
    // whichever one happened to come first in the file.
    const dots = html.indexOf('stripDots(cell)');
    assert.ok(dots !== -1, 'the strip moved — this test no longer looks at it');

    // The strip is on a rail now, and the gate is on the WRAPPER around it —
    // see the note on that. So the nearest x-show above the call is what has to
    // carry it.
    const gate = html.lastIndexOf('x-show=', dots);
    assert.ok(gate !== -1, 'nothing gates the phone strip at all');
    assert.strictEqual(html.slice(gate, html.indexOf('>', gate)).trim(),
        'x-show="view === \'month\'"',
        'the phone draws its month strip in List as well as Month');
});

test('the "you" block says its sentence once, not twice', () => {
    // The desktop's copy and the phone's navy one are the same sentence. Both
    // on one screen reads as a bug, because it is one.
    const html = readPage('calendar.html');
    const said = html.split(/x-text="mySentence"/).length - 1;
    assert.strictEqual(said, 2, 'the sentence moved or was duplicated again');
    const heading = html.split(/x-text="myMonthHeading"/).length - 1;
    assert.strictEqual(heading, 2, 'a copy of the block cannot say which month it means');
});

test('the "you" block sits under the calendar, not above it', () => {
    // WHERE IT SITS IS WHY IT CAN FOLLOW THE MONTH. It was a card at the top of
    // the page with a window of its own — today through a fortnight, whatever
    // the grid showed — precisely because up there, detached from any month,
    // "You in July" answered a question nobody had asked. Underneath, with the
    // month in its own heading, the question and the answer are together.
    const html = readPage('calendar.html');

    // Phone: after the month strip and before the list body, so it is below the
    // calendar in Month and above the list in List.
    const strip = html.indexOf('class="cal-rail-months" x-ref="monthRail"');
    const you = html.indexOf('x-text="myMonthHeading"');
    const body = html.indexOf('x-for="group in phoneGroups"');
    assert.ok(strip !== -1 && you !== -1 && body !== -1, 'the phone lost one of its three pieces');
    assert.ok(strip < you && you < body,
        'the phone block is no longer between the calendar and the list');

    // And it is gone from the top, where the toggle row and the month nav are.
    const toggle = html.indexOf("x-for=\"opt in [['month','calendar_month','Month'],['list','view_agenda','List']]\"");
    assert.ok(toggle < you, 'the block is still above the row that switches Calendar and List');

    // ⚠ THE DESKTOP KEEPS IT IN THE RAIL, and that is not an oversight. A
    // desktop month grid is most of a screen tall, so "below the calendar"
    // there means a scroll away from the thing it answers about. On a phone the
    // strip is a few rows deep and underneath it really is next to the month.
    // Same block, same rule, placed where each layout puts it beside the month.
    const rail = html.indexOf('<aside class="cal-rail');
    const deskYou = html.lastIndexOf('x-text="myMonthHeading"');
    assert.ok(deskYou > rail, 'the desktop copy sits below a screen-tall grid');
    assert.ok(you < rail, 'the phone copy went into the desktop rail');
});

test('the block has no window to choose, because the grid already chose', () => {
    const html = readPage('calendar.html');
    assert.doesNotMatch(html, /cycleUpcomingWindow|setUpcomingWindow|upcomingWindowLabel/,
        'the block still carries a control for a question the month answers');
    assert.doesNotMatch(html, /<select/,
        'a select is back, and its list is drawn where the page cannot reach it');
});

test('the "you" block reads the month the grid loaded, and asks for nothing more', async () => {
    // TWO READS BECAME ONE. The block had a query of its own, which is how the
    // two could disagree about the same Sunday. It now reads the rows the grid
    // has already fetched, so paging is the only thing that changes it.
    const asked = [];
    const page = withAlpine(loadComponent('calendar.js', 'calendarPage', {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            async loadCalendar(db, opts) {
                asked.push(opts);
                return [{
                    id: 'a', date: '2026-08-09', seriesId: 'sunday_service', name: 'Sunday Service',
                    assignments: [{ personId: 'p1', roleSlug: 'setup', slotId: 's1', state: 'pending', label: 'Setup' }],
                }];
            },
        }),
    }));
    page.personId = 'p1';
    page.today = '2026-08-05';
    page.month = '2026-08';
    page.railAnchor = '2026-06';

    await page.load();

    // ⚠ ONE READ, AND IT COVERS THE WHOLE RAIL. Every month drawn needs its
    // events, or sliding lands on an empty grid that fills in a moment later —
    // which is the swap this replaced, one frame down. The happy consequence is
    // that paging inside the rail costs no read at all.
    assert.strictEqual(asked.length, 1, 'the block still fetches a second time');
    assert.deepStrictEqual({ from: asked[0].from, to: asked[0].to },
        { from: '2026-06-01', to: '2026-10-31' });
    assert.strictEqual(page.myCommitments.length, 1, 'the block answered for the whole rail');
    assert.strictEqual(page.myMonthHeading, 'You in August 2026');

    // Paging moves it, which is the whole point of the change — and it moves
    // without going back to the database, because September is already in hand.
    await page.goToMonth('2026-09');
    assert.strictEqual(page.myMonthHeading, 'You in September 2026');
    assert.strictEqual(asked.length, 1, 'a month already on the rail was fetched again');
});

test('a day already gone is not something the month says you have on', async () => {
    // The current month runs from today; a month ahead runs whole. There is no
    // arithmetic here doing that — `isPast` is stamped on every row by the one
    // load, and the block simply drops those.
    const page = loadComponent('calendar.js', 'calendarPage', {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            async loadCalendar() {
                return [
                    { id: 'gone', date: '2026-08-02', name: 'Workday',
                      assignments: [{ personId: 'p1', roleSlug: 'setup', slotId: 's1', state: 'confirmed', label: 'Setup' }] },
                    { id: 'soon', date: '2026-08-09', name: 'Sunday Service',
                      assignments: [{ personId: 'p1', roleSlug: 'coffee', slotId: 's1', state: 'pending', label: 'Coffee' }] },
                ];
            },
        }),
    });
    page.personId = 'p1';
    page.today = '2026-08-05';
    page.month = '2026-08';

    await page.load();

    assert.strictEqual(page.myCommitments.map(c => c.date).join(), '2026-08-09',
        'a serve already done is listed as something still to do');
});

test('a month you are not in says so, rather than showing nothing at all', async () => {
    const page = loadComponent('calendar.js', 'calendarPage', {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            async loadCalendar() { return []; },
        }),
    });
    page.personId = 'p1';
    page.today = '2026-08-05';
    page.month = '2026-11';

    await page.load();

    assert.deepStrictEqual(page.myCommitments, []);
    assert.strictEqual(page.mySentence, 'Nothing on for you.');
    assert.strictEqual(page.myMonthHeading, 'You in November 2026');
});

test('the "you" block ignores the grid\u2019s filters \u2014 your own serve is not a display option', async () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    page.personId = 'p1';
    page.today = '2026-07-31';
    page.occurrences = [{
        id: 'x', date: '2026-08-02', seriesId: 'sunday_service', name: 'Sunday Service',
        assignments: [{ personId: 'p1', roleSlug: 'setup', slotId: 's1', state: 'confirmed', label: 'Setup' }],
    }];
    page.onlyMine = true;
    page.hiddenSeries = ['sunday_service'];

    assert.strictEqual(page.myCommitments.length, 1,
        'unticking a series in Show hid something you agreed to do');
});

test('a signed-out page has no "you" to answer about', () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    page.personId = null;
    page.occurrences = [{
        id: 'x', date: '2026-08-02', name: 'Sunday Service',
        assignments: [{ personId: 'p1', roleSlug: 'setup', slotId: 's1', state: 'confirmed', label: 'Setup' }],
    }];

    assert.deepStrictEqual(page.myCommitments, []);
    // And the block is not drawn at all, rather than drawn saying "nothing".
    assert.match(readPage('calendar.html'), /<section x-show="personId"/,
        'a visitor is told they have nothing on, which is not the same as having no account');
});

// ── Places still to fill ──────────────────────────────────────────────────────

test('only an editor is shown the places still to fill', () => {
    // A member cannot fill one. A count they can do nothing about is weather.
    const date = { id: 'x', date: '2026-08-09', seriesRoleSlugs: ['sound_desk'] };
    const defs = [{ slug: 'sound_desk', name: 'Sound desk', slots: [{ id: 's1' }] }];

    const member = loadComponent('calendar.js', 'calendarPage');
    member.rank = 'member';
    member.roleDefinitions = defs;
    assert.strictEqual(member.placesToFill(date), 0);

    const editor = loadComponent('calendar.js', 'calendarPage');
    editor.rank = 'editor';
    editor.roleDefinitions = defs;
    assert.strictEqual(editor.placesToFill(date), 1);
    assert.strictEqual(editor.placesToFillLabel(date), '1 place to fill');
});

// This used to assert the opposite, on the grounds that the definitions were
// "read for somebody never shown them". That stopped being true in MS-20: a
// member IS shown them, on their own card, and without them it reads them
// their Role's SLUG. The read is the price of the card saying "Setup &
// Teardown" instead of `setup_teardown`.
test('a member reads the Role definitions too — their own card names Roles', async () => {
    const asked = [];
    const page = loadComponent('calendar.js', 'calendarPage', {
        db: {
            collection: name => {
                asked.push(name);
                return { get: async () => ({ docs: [] }) };
            },
        },
    });
    page.rank = 'member';

    await page.loadRoleDefinitions();
    assert.deepStrictEqual(asked, ['roles']);
});

test('an unfilled chip goes amber, and a decline still outranks it', () => {
    const page = loadComponent('calendar.js', 'calendarPage');
    page.rank = 'editor';
    page.roleDefinitions = [{ slug: 'sound_desk', name: 'Sound desk', slots: [{ id: 's1' }] }];

    const open = { id: 'x', date: '2026-08-09', seriesRoleSlugs: ['sound_desk'] };
    assert.strictEqual(page.chipKind(open), 'unfilled');
    assert.strictEqual(
        page.stripDots({ events: [open] })[0],
        require('../public/calendar-view.js').WARNING_COLOUR);

    // Somebody having said no is the thing that cannot wait.
    assert.strictEqual(page.chipKind(Object.assign({}, open, { needsAttention: true })), 'declined');
    // And a date that is not happening has nothing to fill.
    assert.strictEqual(page.chipKind(Object.assign({}, open, { cancelled: true })), 'off');
});

test('an amber chip still says you are on it', () => {
    // The "you" dot reads off `mine`, or the warning would swallow the one
    // thing the person looking at it cares most about.
    const page = loadComponent('calendar.js', 'calendarPage');
    page.rank = 'editor';
    page.roleDefinitions = [{ slug: 'sound_desk', name: 'Sound desk', slots: [{ id: 's1' }] }];

    const open = { id: 'x', date: '2026-08-09', seriesRoleSlugs: ['sound_desk'], mine: { label: 'Setup' } };
    assert.strictEqual(page.chipKind(open), 'unfilled');
    assert.strictEqual(page.showsYou(open), true);

    // Not on the ones it was never drawn on.
    assert.strictEqual(page.showsYou({ id: 'y', date: '2026-08-09', mine: { label: 'Setup' }, cancelled: true }), false);
    assert.strictEqual(page.showsYou({ id: 'z', date: '2026-08-09' }), false);
});

test('the warning lives on the chip, not in the corner of the day', () => {
    // The corner of a cell says "this day is something to sort" and nothing
    // else. WHICH event is short of people is answered on the event, where you
    // would click to fix it — saying it twice in two places is one place too
    // many, and the day marks would then have to be kept in step by hand.
    const html = readPage('calendar.html');
    const corner = html.indexOf('x-show="cell.needsAttention"');
    const chips = html.indexOf('x-for="ev in cell.events"');
    assert.ok(corner !== -1 && chips > corner, 'the cell corner moved — this test no longer looks at it');

    const dayHeader = html.slice(corner, chips);
    assert.ok(!/warning/.test(dayHeader), 'the amber mark is back in the corner of the day');
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
    const page = withAlpine(loadComponent('calendar.js', 'calendarPage'));
    page.month = '2026-07';
    page.railAnchor = '2026-05';
    page.load = async () => {};

    await page.focusDay({ date: '2026-06-30', inMonth: false });
    assert.strictEqual(page.month, '2026-06');
    assert.strictEqual(page.focusedDate, '2026-06-30');
    assert.strictEqual(page.view, 'month');
});

test('changing month lets go of the day that was tapped', async () => {
    const page = withAlpine(loadComponent('calendar.js', 'calendarPage'));
    page.month = '2026-07';
    page.railAnchor = '2026-05';
    page.today = '2026-07-29';
    page.load = async () => {};

    await page.focusDay({ date: '2026-07-15', inMonth: true });
    assert.strictEqual(page.focusedDate, '2026-07-15');

    await page.nextMonth();
    // August has no 15th selected, and today is not in it — so the strip falls
    // back to the first, which is a day it is actually showing.
    assert.strictEqual(page.focusedDate, '2026-08-01');
});

// ── One fact, one home: what time a repeating Event happens ───────────────────
//
// The Event screen said "4:30 am" at the top and "at 4:30 pm" at the bottom, and
// both were reading real stored data. `rebuildOccurrence` stamps the rule's time
// onto the occurrence for display; the first save of that date wrote the stamp
// back as if the date had chosen it, and from then on the series could not move
// its own time. `seriesColour` was pulled out of this exact trap one line away
// in the same function — time was not.

test('changing a repeating Event\'s time changes every date of it', () => {
    const Core = require('../public/events-occurrence-core.js');
    const rule = { freq: 'monthly', startDate: '2026-08-02', time: '16:30' };
    // The document still carries the stale stamp. The rule wins anyway, so no
    // migration is needed for the dates this already happened to.
    const stamped = { id: 's_2026-08-02', seriesId: 's', date: '2026-08-02', time: '04:30' };

    assert.strictEqual(Core.timeOf(stamped, rule), '16:30');
});

test('a one-off keeps its own time, because there is no rule to keep it on', () => {
    const Core = require('../public/events-occurrence-core.js');
    const oneOff = { id: 'x', seriesId: null, date: '2026-08-02', time: '18:45' };
    assert.strictEqual(Core.timeOf(oneOff, null), '18:45');
    // A series date with no time on the rule has no time — the stamp is ignored
    // rather than resurrected.
    assert.strictEqual(Core.timeOf({ seriesId: 's', time: '04:30' }, { freq: 'weekly' }), null);
});

test('a date of a series never stores a time of its own', async () => {
    // The write half. Without it every save re-froze the stamp.
    const Store = require('../public/events-store.js');
    const written = {};
    const fakeDb = {
        batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }),
        collection: () => ({
            doc: id => ({
                id: id,
                set: async payload => { written[id] = payload; },
                collection: () => ({ get: async () => ({ docs: [] }), doc: () => ({}) }),
            }),
        }),
    };

    await Store.saveOccurrence(fakeDb, {
        id: 's_2026-08-02', seriesId: 's', date: '2026-08-02', time: '04:30', assignments: [],
    });
    assert.ok(!('time' in written['s_2026-08-02']),
        'a date of a series stored a copy of the series time, which freezes it');

    // A one-off's time is its own and must survive.
    await Store.saveOccurrence(fakeDb, {
        id: 'loose', seriesId: null, date: '2026-08-02', time: '18:45', assignments: [],
    });
    assert.strictEqual(written['loose'].time, '18:45',
        'a one-off lost the only time it has');
});

test('the Event screen reads the time through the model, not off the document', () => {
    const html = readPage('calendar-event.html');
    assert.ok(!/occurrence\.time/.test(html),
        'the title line still reads the stored stamp, so it can disagree with the pattern');
    assert.ok(/formatTime\(eventTime\)/.test(html), 'the title line shows no time at all');

    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.occurrence = { id: 's_2026-08-02', seriesId: 's', date: '2026-08-02', time: '04:30' };
    page.series = { id: 's', recurrence: { freq: 'monthly', startDate: '2026-08-02', time: '16:30' } };
    assert.strictEqual(page.eventTime, '16:30',
        'the top of the screen still disagrees with the bottom');
});

// ── Where it is, on the date you are looking at ───────────────────────────────
//
// A repeating Event's place is typed once, on the Event. The Event screen read
// it off the DATE, which never has one — so a gathering with "the hall" filled
// in one screen away showed no place at all on every date of it.

test('a date of a series shows the place typed on the Event', () => {
    const Core = require('../public/events-occurrence-core.js');
    const date = { id: 's_2026-08-02', seriesId: 's', date: '2026-08-02' };
    assert.strictEqual(Core.locationOf(date, { id: 's', location: 'The hall' }), 'The hall');
    // Nothing typed anywhere is nowhere, not an empty chip.
    assert.strictEqual(Core.locationOf(date, { id: 's' }), null);
});

test('a place given to one date beats the series, unlike its time', () => {
    const Core = require('../public/events-occurrence-core.js');
    // A moved instance carries the details it was given, and a one-off's
    // occurrence IS the whole Event — so a stored place is deliberate.
    assert.strictEqual(
        Core.locationOf({ seriesId: 's', location: 'The manse' }, { location: 'The hall' }),
        'The manse');
    assert.strictEqual(Core.locationOf({ seriesId: null, location: 'The park' }, null), 'The park');
});

test('the Event screen reads the place through the model, not off the document', () => {
    const html = readPage('calendar-event.html');
    assert.ok(!/occurrence\.location/.test(html),
        'the title line still reads the date alone, so a repeating Event shows no place');
    assert.ok(/x-text="eventLocation"/.test(html), 'the title line shows no place at all');

    const page = loadComponent('calendar-event.js', 'eventDetailPage');
    page.occurrence = { id: 's_2026-08-02', seriesId: 's', date: '2026-08-02' };
    page.series = { id: 's', location: 'The hall', recurrence: { freq: 'monthly' } };
    assert.strictEqual(page.eventLocation, 'The hall',
        'the header says nowhere while the Event says the hall');
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

test('the Calendar\'s hamburger opens a drawer over the Calendar', () => {
    // It drew a hamburger and did what a back arrow does — went to the app home.
    // Borrowing the app's drawer by navigating to it was no better: the page
    // behind the panel became somewhere else, and closing it was the only way
    // back. A drawer opens over where you are.
    const header = fs.readFileSync(path.join(PUBLIC, 'mobile-shell-header.js'), 'utf8');

    assert.ok(/if \(isMenu\) \{ openDrawer\(\); return; \}/.test(header),
        'the hamburger still navigates somewhere instead of opening a drawer');
    assert.ok(!/mobile\.html#\/home\?menu=1/.test(header),
        'the navigate-away drawer is still wired up');
    assert.ok(/position:fixed;inset:0/.test(header), 'the drawer does not overlay the page');

    // And the app has no leftover machinery for a trip it no longer takes.
    const app = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');
    assert.ok(!/cameForMenu|menu !== "1"/.test(app),
        'the app still carries the come-here-to-open-the-drawer path');
});

test('a hamburger is only drawn where a drawer can open', () => {
    // Without the destination list there is nothing to open, so the header falls
    // back to a back arrow rather than a control that does nothing.
    const header = fs.readFileSync(path.join(PUBLIC, 'mobile-shell-header.js'), 'utf8');
    assert.ok(/isMenu = !!cfg\.menu[^;]*!!window\.MosaicDestinations/.test(header),
        'a page can ask for a hamburger without loading anything for it to open');

    // Every page that asks for one loads the list.
    fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html')).forEach(file => {
        const html = readPage(file);
        if (!/MOBILE_HEADER\s*=\s*\{[^}]*menu:\s*true/.test(html)) return;
        assert.ok(/mobile\/destinations\.js/.test(html),
            file + ' asks for a hamburger but never loads the destinations it would show');
    });
});

test('both drawers are built from one list', () => {
    // Two renderings of the chrome is the price of a desktop page being its own
    // document. Two LISTS would be the bug — which destinations exist, who may
    // see them, and where each goes are the things that drift into a lie.
    const D = require('../public/mobile/destinations.js');
    assert.ok(D.DESTINATIONS.length, 'the shared list is empty');
    assert.ok(D.DESTINATIONS.every(d => d.icon && d.symbol),
        'a destination is missing one of its two renderings');

    const data = fs.readFileSync(path.join(PUBLIC, 'mobile', 'data.js'), 'utf8');
    const app = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');
    assert.ok(/window\.MosaicDestinations/.test(data) && /Destinations\.DESTINATIONS/.test(data),
        'the app keeps its own copy of the destination list');
    assert.ok(/window\.MosaicDestinations\.SHELL_PAGES/.test(app),
        'the app keeps its own copy of which routes are shell pages');
    assert.ok(!/key: "hymn-directory"/.test(data), 'the old list is still in data.js');
    assert.ok(!/events: "calendar\.html"/.test(app), 'the old shell-page map is still in app.js');

    // mobile.html must load it before the two files that read it.
    const mobile = readPage('mobile.html');
    assert.ok(mobile.indexOf('mobile/destinations.js') < mobile.indexOf('mobile/data.js'),
        'data.js runs before the list it reads exists');
    assert.ok(mobile.indexOf('mobile/destinations.js') < mobile.indexOf('mobile/app.js'),
        'app.js runs before the list it reads exists');
});

test('both drawers say the same three things about you', () => {
    // The chrome is written twice — the app's drawer is Preact inside
    // mobile.html, the shell's is plain DOM on a desktop page — and the first
    // thing that drifted was the avatar, present in one and missing from the
    // other. So the parts are named in the shared file and both are held to it.
    const D = require('../public/mobile/destinations.js');
    assert.deepStrictEqual(Array.from(D.DRAWER_HEAD), ['avatar', 'name', 'roleLabel']);

    const shell = fs.readFileSync(path.join(PUBLIC, 'mobile-shell-header.js'), 'utf8');
    D.DRAWER_HEAD.forEach(part => {
        assert.ok(shell.indexOf('"data-drawer-part", "' + part + '"') !== -1,
            'the shell drawer has no ' + part);
    });

    // The app's drawer draws all three too — its avatar and role label come from
    // the profile it is handed.
    const app = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');
    const drawer = app.slice(app.indexOf('function Drawer('), app.indexOf('function App('));
    assert.ok(/<\$\{Avatar\}/.test(drawer), 'the app drawer has no avatar');
    assert.ok(/user\.name/.test(drawer), 'the app drawer has no name');
    assert.ok(/user\.roleLabel/.test(drawer), 'the app drawer has no role label');
});

test('a super admin is not told they are a member', () => {
    // The label map had no `super_admin` and fell through to "Member" — the
    // highest rung in the app telling its holder they were the lowest.
    const D = require('../public/mobile/destinations.js');
    assert.strictEqual(D.roleLabel('super_admin'), 'Super Admin');
    assert.strictEqual(D.roleLabel('admin'), 'Administrator');
    assert.strictEqual(D.roleLabel('elder'), 'Elder');
    assert.strictEqual(D.roleLabel('editor'), 'Editor');
    assert.strictEqual(D.roleLabel('member'), 'Member');

    // Every rank the app can actually hold has a name of its own.
    const RANKS = ['viewer', 'member', 'editor', 'elder', 'admin', 'super_admin'];
    RANKS.forEach(rank => {
        assert.ok(Object.prototype.hasOwnProperty.call(D.ROLE_LABELS, rank),
            rank + ' falls through to the default label');
    });

    // And both drawers read it from here rather than keeping their own.
    const data = fs.readFileSync(path.join(PUBLIC, 'mobile', 'data.js'), 'utf8');
    assert.ok(/Destinations\.roleLabel\(/.test(data), 'the app keeps its own label map');
    assert.ok(!/var ROLE_LABELS = \{/.test(data), 'the old label map is still in data.js');
});

test('a gated destination is hidden until we know who is looking', () => {
    // Fails closed. Offering the Shepherd Dashboard to somebody who will be
    // refused on arrival is worse than not offering it.
    const D = require('../public/mobile/destinations.js');
    const shepherd = D.DESTINATIONS.find(d => d.route === 'shepherd');

    assert.strictEqual(D.canSee(shepherd, null), false);
    assert.strictEqual(D.canSee(shepherd, { permissionLevel: 'editor' }), false);
    assert.strictEqual(D.canSee(shepherd, { permissionLevel: 'elder' }), true);
    // Ungated entries are for everyone, signed in or not.
    assert.strictEqual(D.canSee(D.DESTINATIONS.find(d => d.route === 'events'), null), true);
});

test('a destination goes to the same place from either drawer', () => {
    // The shell's drawer sits on a desktop page, so it cannot use the app's
    // in-memory routing. Every entry still has to resolve to a real URL.
    const D = require('../public/mobile/destinations.js');
    assert.strictEqual(D.routeHref('events'), 'calendar.html?shell=mobile',
        'the Calendar entry does not open the Calendar');
    assert.strictEqual(D.routeHref('people'), 'mobile.html#/people');
    D.DESTINATIONS.forEach(d => {
        const href = D.routeHref(d.route);
        assert.ok(href && !/undefined/.test(href), d.route + ' resolves to ' + href);
    });
});

test('both Calendar pages say when nobody is signed in', () => {
    ['calendar', 'calendar-event'].forEach(page => {
        const html = readPage(page + '.html');
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
    const html = readPage('calendar-event.html');

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
    //
    // The markup and the rules are in different files now — the panel is shared
    // with the service page — so they are read together and checked as one.
    const html = readPage('calendar-event.html') +
        fs.readFileSync(path.join(PUBLIC, 'roles-panel.css'), 'utf8');

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
    const html = readPage('calendar-event.html');
    // The panel's rules live in roles-panel.css now, because the service page
    // needs them too — so both sources are checked against the same markup.
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>')) +
        fs.readFileSync(path.join(PUBLIC, 'roles-panel.css'), 'utf8');
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
    const html = readPage('calendar.html');
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

// ── A one-off job's own fairness settings (MS-171) ───────────────────────────
//
// A one-off Role is meant to be CHEAP — a label and some people — so these sit
// behind a disclosure. But they have to exist: without them the person who
// unlocks the hall every week reads as doing free work and quietly absorbs
// three more jobs the same morning.

test('a one-off job carries the fairness fields, not just its label', () => {
    // The projection used to drop them, which would have made the toggle below
    // silently do nothing once it existed.
    const page = eventPageWithRole();
    page.occurrence.oneOffRoles = [
        { id: 'o1', label: 'Unlock the hall', intensity: 0.5, allowsAnotherRole: true },
    ];
    const job = page.oneOffRoles[0];

    assert.strictEqual(job.intensity, 0.5);
    assert.strictEqual(job.allowsAnotherRole, true);
});

test('a one-off job nobody has configured owes a week and uses up the morning', () => {
    const job = eventPageWithRole().oneOffRoles[0];
    assert.strictEqual(job.intensity, 1);
    assert.strictEqual(job.allowsAnotherRole, false);
});

test('the options are collapsed until asked for, one job at a time', () => {
    const page = eventPageWithRole();
    assert.strictEqual(page.oneOffOptionsFor, null, 'adding a job stays a sentence and a return key');

    page.toggleOneOffOptions('o1');
    assert.strictEqual(page.oneOffOptionsFor, 'o1');

    page.toggleOneOffOptions('o1');
    assert.strictEqual(page.oneOffOptionsFor, null);
});

test('setting a one-off intensity persists it on the Event', async () => {
    const page = eventPageWithRole();
    await page.setOneOffIntensity('o1', '2.5');

    assert.strictEqual(page.occurrence.oneOffRoles[0].intensity, 2.5);
    assert.strictEqual(page.saved, 1);
});

test('a one-off intensity of 0 is kept — some jobs really are free', async () => {
    const page = eventPageWithRole();
    await page.setOneOffIntensity('o1', '0');
    assert.strictEqual(page.occurrence.oneOffRoles[0].intensity, 0);
});

test('a negative one-off intensity is refused and nothing is written', async () => {
    const page = eventPageWithRole();
    await page.setOneOffIntensity('o1', '-2');

    assert.strictEqual(page.occurrence.oneOffRoles[0].intensity, undefined);
    assert.strictEqual(page.saved, 0);
    assert.match(page.error, /zero or more/i);
});

test('the exclusivity toggle persists on the job it belongs to', async () => {
    const page = eventPageWithRole();
    page.occurrence.oneOffRoles = [{ id: 'o1', label: 'Unlock' }, { id: 'o2', label: 'Lock up' }];

    await page.setOneOffExclusive('o2', true);

    assert.strictEqual(page.occurrence.oneOffRoles[1].allowsAnotherRole, true);
    assert.strictEqual(page.occurrence.oneOffRoles[0].allowsAnotherRole, undefined,
        'the other job is left alone');
});

test('a one-off job with no options set still reads as exclusive to the picker', () => {
    // Absent means exclusive everywhere, so a job created before the toggle
    // existed behaves like every other Role rather than quietly permitting a
    // second one.
    const RolesCore = require('../public/roles-core.js');
    const page = eventPageWithRole();
    assert.strictEqual(RolesCore.allowsAnotherRole(page.oneOffRoles[0]), false);
});

// ── Auto-assign (MS-18) ───────────────────────────────────────────────────────

test('Auto-assign is offered beside a chosen event, to editors, and not on a phone', () => {
    // It MOVED. Auto-assign drafts a run of dates for ONE series, and the
    // Calendar could not know which — so it opened on whichever sorted first
    // alphabetically and made the editor pick again from a dropdown. It now sits
    // on Recurring Events, where a series is already the thing being looked at.
    const calendar = readPage('calendar.html');
    assert.doesNotMatch(calendar, /href="auto-assign\.html"/,
        'the Calendar still offers a door that cannot know which event it opens');

    const html = readPage('recurring-events.html');
    const link = html.match(/<a[^>]*:href="draftHref"[\s\S]*?<\/a>/);

    assert.ok(link, 'Recurring Events does not offer Auto-assign at all');
    // The whole page is inside x-if="isEditor", which is the same promise the
    // Calendar made with x-show="canCreate" — stated here so a later refactor
    // that lifts the grid out cannot quietly drop it.
    assert.match(html, /x-if="isEditor"/, 'the page is offered to people who cannot use it');
    // The room it opens is a wide grid and says so when you arrive. Better not
    // to offer the journey than to end it with a shrug.
    assert.match(link[0], /re-desktop-only/, 'a phone is offered a page it will be refused');
});

// ── The other door into the same room (MS-219) ───────────────────────────────

test('by hand sits beside auto-assign, carrying the same dates', () => {
    // An editor who already knows who they want does not want a rota to undo.
    // The long way round to a blank grid was: draft eight dates, then take
    // everybody off them one at a time.
    const page = loadComponent('recurring-events.js', 'recurringEventsPage');
    page.seriesId = 'sunday_service';

    assert.strictEqual(page.byHandHref, 'auto-assign.html?series=sunday_service&by=hand');
    assert.strictEqual(page.byHandLabel, 'By hand');

    page.allDates = ['2026-08-09', '2026-08-16', '2026-08-23'];
    page.selected = ['2026-08-09', '2026-08-16'];

    assert.strictEqual(page.byHandHref,
        'auto-assign.html?series=sunday_service&from=2026-08-09&to=2026-08-16&by=hand');
    // The count is on BOTH buttons. They open the same dates, so a count on one
    // of them would read as the difference between them.
    assert.strictEqual(page.byHandLabel, 'By hand, 2 dates');
    assert.strictEqual(page.draftLabel, 'Auto-assign 2 dates');
});

test('both doors are drawn, and neither is offered to a phone', () => {
    const html = readPage('recurring-events.html');
    const links = html.match(/<a[^>]*:href="byHandHref"[\s\S]*?<\/a>/g);

    assert.ok(links && links.length === 2,
        'by hand is missing from the header or from the ticked panel — the header ' +
        'scrolls off behind a long list of Roles, which is why it is said twice');
    links.forEach(link => {
        assert.match(link, /re-desktop-only/,
            'a phone is offered a grid it will be refused on arrival');
        assert.match(link, /byHandLabel/, 'the label is written out rather than bound');
    });
});

// ⚠ A MISSING CORE FUNCTION IS INVISIBLE UNTIL SOMEBODY OPENS THE PAGE.
// Alpine swallows a getter that throws — the span renders empty and the console
// fills up where nobody is looking. `Core.dayMonth` shipped like that: defined
// in the module, used by the page, and left out of the exported list. So rather
// than trust each getter to have its own test, read every core call the page
// makes and check the other side answers to that name.
test('every core function Auto-assign calls is actually exported', () => {
    const source = fs.readFileSync(path.join(PUBLIC, 'auto-assign.js'), 'utf8');
    const modules = {
        Core: require('../public/events-occurrence-core.js'),
        Store: require('../public/events-store.js'),
        Roles: require('../public/roles-core.js'),
        Events: require('../public/events-core.js'),
        Fairness: require('../public/fairness-core.js'),
        Loop: require('../public/auto-assign-core.js'),
        Grid: require('../public/auto-assign-grid-core.js'),
        Edit: require('../public/auto-assign-edit-core.js'),
        View: require('../public/calendar-view.js'),
        Dates: require('../public/date-utils.js'),
    };

    const missing = [];
    const call = /\b(Core|Store|Roles|Events|Fairness|Loop|Dates)\.([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = call.exec(source)) !== null) {
        if (typeof modules[m[1]][m[2]] !== 'function') missing.push(m[1] + '.' + m[2]);
    }

    assert.deepEqual([...new Set(missing)], [],
        'the page calls something its module does not offer');
});

// ⚠ AN EMPTY STRING DISABLES A BUTTON. Alpine removes a boolean attribute for
// `false`, `null` and `undefined` — and for anything else it SETS it, so
// `:disabled="saving"` against `saving: ''` renders `disabled="disabled"`. The
// control greys out on load and nothing can be pressed, with no error anywhere.
//
// It shipped exactly once, on the Roles Manager's non-servers list. Rather than
// remember it, read every boolean binding on every page and check what backs it.
test('no boolean attribute is bound to a value that is empty-string when idle', () => {
    const BOOLEAN_ATTRS = ['disabled', 'checked', 'readonly', 'required', 'hidden'];
    const wrong = [];

    fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html')).forEach(file => {
        const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
        const js = path.join(PUBLIC, file.replace(/\.html$/, '.js'));
        if (!fs.existsSync(js)) return;
        const source = fs.readFileSync(js, 'utf8');

        BOOLEAN_ATTRS.forEach(attr => {
            const bind = new RegExp(':' + attr + '="([A-Za-z_$][\\w$.]*)"', 'g');
            let m;
            while ((m = bind.exec(html)) !== null) {
                const name = m[1].split('.')[0];
                // Declared as an empty string somewhere in the component.
                if (new RegExp('\\b' + name + ":\\s*''").test(source)
                    || new RegExp('\\b' + name + ':\\s*""').test(source)) {
                    wrong.push(file + ' :' + attr + '="' + m[1] + '"');
                }
            }
        });
    });

    assert.deepEqual([...new Set(wrong)], [],
        'bind !!value instead — an empty string sets the attribute rather than clearing it');
});

test('Auto-assign is refused to anyone below editor', () => {
    const page = loadComponent('auto-assign.js', 'autoAssignPage');

    page.loading = false;
    ['viewer', 'member'].forEach(rank => {
        page.rank = rank;
        assert.equal(page.isEditor, false, rank + ' should not be able to draft a roster');
        assert.equal(page.refused, true);
    });
    ['editor', 'admin', 'elder', 'super_admin'].forEach(rank => {
        page.rank = rank;
        assert.equal(page.isEditor, true, rank + ' should be able to draft a roster');
        assert.equal(page.refused, false);
    });

    page.rank = null;
    assert.equal(page.signedOut, true);
    assert.equal(page.refused, false, 'signed out and refused are different sentences');
});

test('the three choices about existing people default to keeping them', () => {
    const Loop = require('../public/auto-assign-core.js');
    const page = loadComponent('auto-assign.js', 'autoAssignPage');

    assert.equal(page.choice, Loop.CHOICES.KEEP,
        'an assignment exists because a person put it there; losing one is the ' +
        'failure you do not notice');
    assert.deepEqual(
        page.choices.map(c => c.id),
        [Loop.CHOICES.KEEP, Loop.CHOICES.REPLACE, Loop.CHOICES.LEAVE_OUT]
    );
    // Every option is safer than it sounds, and all three need saying so.
    assert.match(page.choiceFootnote, /already said yes/);
    assert.match(page.choiceFootnote, /said no/);
});

test('the notice about existing people is hidden when there are none', () => {
    const page = loadComponent('auto-assign.js', 'autoAssignPage');

    assert.equal(page.hasOccupied, false);
    page.occupied = ['2026-10-04', '2026-10-11'];
    assert.equal(page.hasOccupied, true);
    assert.match(page.occupiedLine, /^2 of these/);
    page.occupied = ['2026-10-04'];
    assert.match(page.occupiedLine, /^One of these/);
});

test('a range of any length can be drafted — there is no cap', () => {
    const page = loadComponent('auto-assign.js', 'autoAssignPage');
    const Store = require('../public/events-store.js');

    page.series = [{ id: 'sunday_service', name: 'Sunday Service', roleSlugs: [] }];
    page.seriesId = 'sunday_service';
    page.fromDate = '2026-10-04';
    page.toDate = '2027-10-03';        // a whole year, far past the 12-week window

    assert.ok(page.resolvedDates.length > 12);
    assert.equal(page.canDraft, true,
        'a draft that far out is a sketch, and re-drafting nearer the time is the answer');
    assert.equal(Store.SUNDAY_RULE, page.rule, 'the Sunday Service uses its implied rule');
});

// The empty branches of this line return before ever touching a date, so a
// test that only checks those proves the page renders when it has nothing to
// say — and nothing at all about the case the editor actually sees.
test('the resolved range names its first and last date', () => {
    const page = loadComponent('auto-assign.js', 'autoAssignPage');

    page.series = [{ id: 'sunday_service', name: 'Sunday Service', roleSlugs: [] }];
    page.seriesId = 'sunday_service';
    page.fromDate = '2026-10-04';
    page.toDate = '2026-10-25';

    assert.equal(page.resolvedLine, '4 Sundays, 4 October – 25 October');
    assert.equal(page.pretty('2026-10-04'), '4 October');

    page.toDate = '2026-10-04';
    assert.equal(page.resolvedLine, '1 Sunday, 4 October – 4 October');
});

test('nothing can be drafted when the range resolves to no dates', () => {
    const page = loadComponent('auto-assign.js', 'autoAssignPage');

    page.series = [{ id: 'sunday_service', name: 'Sunday Service', roleSlugs: [] }];
    page.seriesId = 'sunday_service';
    page.fromDate = '2026-10-05';      // a Monday
    page.toDate = '2026-10-09';        // to the Friday — no Sunday in between

    assert.deepEqual(page.resolvedDates, []);
    assert.equal(page.canDraft, false);
    assert.match(page.resolvedLine, /No dates/);
});

test('a preset is counted in occurrences, not in weeks', () => {
    const page = loadComponent('auto-assign.js', 'autoAssignPage');

    page.series = [{ id: 'sunday_service', name: 'Sunday Service', roleSlugs: [] }];
    page.seriesId = 'sunday_service';
    page.fromDate = '2026-10-04';
    page.applyPreset(8);

    assert.equal(page.resolvedDates.length, 8,
        'a fortnightly Event\'s twelve is six months of calendar — the number ' +
        'that means anything is its own');
});

// A managed Role launches cold. If a first draft refused to run until somebody
// had already served, no Role could ever have a first draft — the history the
// solve wants is written BY drafting, so the empty case has to go through.
function pageWithHistoryRead(read) {
    const calls = [];
    const query = {
        where(field, op, value) { calls.push([field, op, value]); return query; },
        orderBy(field, dir) { calls.push(['orderBy', field, dir]); return query; },
        get: read,
    };
    const page = loadComponent('auto-assign.js', 'autoAssignPage', {
        db: { collectionGroup: () => query },
    });
    page.series = [{ id: 'sunday_service', name: 'Sunday Service', roleSlugs: [] }];
    page.seriesId = 'sunday_service';
    page.fromDate = '2026-10-04';
    page.toDate = '2026-11-01';
    return { page, calls };
}

test('a first draft with no serve history starts everybody level', async () => {
    const { page } = pageWithHistoryRead(async () => ({ docs: [] }));

    await page.loadHistory(page.resolvedDates);

    assert.deepEqual(page.history, [], 'nobody has served, and that is not an error');
    assert.match(page.notice, /everybody starts level/,
        'the editor should know the draft is even because it is blind, not because it is clever');
    assert.equal(page.error, '', 'a cold start must never block the draft');
});

test('a serve history that cannot be read still lets the draft through', async () => {
    const { page } = pageWithHistoryRead(async () => { throw new Error('missing index'); });

    await assert.doesNotReject(() => page.loadHistory(page.resolvedDates),
        'a roster the editor can fix beats no roster at all');
    assert.deepEqual(page.history, []);
    assert.match(page.notice, /could not be read/);
    assert.match(page.notice, /check the names/, 'say what it cannot know, not just that it failed');
});

test('the serve history is asked for in the order its index is built in', async () => {
    const { page, calls } = pageWithHistoryRead(async () => ({ docs: [] }));

    await page.loadHistory(page.resolvedDates);

    // An inequality with no stated order implies ASCENDING, and the deployed
    // index is (seriesId ASC, serviceDate DESC) — so leaving the order unsaid
    // fails EVERY read, and the failure looks exactly like an empty church.
    assert.deepEqual(calls[calls.length - 1], ['orderBy', 'serviceDate', 'desc']);
    assert.ok(calls.some(c => c[0] === 'seriesId' && c[2] === 'sunday_service'));
});

// A page wired for the grid: one Role with two places, across four Sundays.
function draftedPage(overrides, sandbox) {
    // ⚠ `db` is closed over by the component, so a fake has to go in through
    // the SANDBOX. Setting it on the returned page object looks right and does
    // nothing at all.
    const page = loadComponent('auto-assign.js', 'autoAssignPage', sandbox);
    page.series = [{ id: 'sunday_service', name: 'Sunday Service', roleSlugs: ['coffee'] }];
    page.seriesId = 'sunday_service';
    page.fromDate = '2026-10-04';
    page.toDate = '2026-10-25';
    page.roleDefinitions = [{
        slug: 'coffee', name: 'Coffee', intensity: 1,
        slots: [{ id: 's1', requirement: 'either' }, { id: 's2', requirement: 'female' }],
    }];
    page.people = [
        { id: 'p1', name: 'Alice Brown', sex: 'female' },
        { id: 'p2', name: 'Bob Carter', sex: 'male' },
    ];
    Object.assign(page, overrides || {});
    return page;
}

const drafted = (date, seats, gaps) => ({
    date: date, skipped: false, seats: seats || [], gaps: gaps || [], widened: 0, pool: [],
});

test('the grid turns the draft inside out — Roles down, dates across', () => {
    const page = draftedPage();
    page.draft = {
        dates: [
            drafted('2026-10-04', [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 3 }],
                [{ roleSlug: 'coffee', slotId: 's2', detail: { reason: 'sexUnknown' } }]),
            drafted('2026-10-11'), drafted('2026-10-18'), drafted('2026-10-25'),
        ],
    };
    page.buildGrid();

    assert.equal(page.columns.length, 4);
    assert.deepEqual(page.columns.map(c => c.label),
        ['4 October', '11 October', '18 October', '25 October']);

    const row = page.grid.roleRows[0];
    assert.equal(row.name, 'Coffee');
    assert.equal(row.cells.length, 4);
    assert.deepEqual(row.cells[0].places.map(p => p.filled), [true, false]);
    assert.equal(row.cells[0].places[0].card.name, 'Alice Brown');
    assert.equal(row.cells[0].places[1].wants, 'A woman');
    // The words come from the same place the Roles tab gets them.
    assert.match(row.cells[0].places[1].reason, /sex on file/);
});

// ⚠ THE NUMBERS ON A CARD ARE READ AS OF ITS OWN DATE.
//
// Load and recency both move as the loop walks the range — that is the whole
// point of the carry-forward. A single figure for the range would contradict
// the draft describing it: somebody the solver correctly seated on week one
// would show as over budget because of the work week four gave them.
test('a card reads its load and recency as of its own date, not the range', () => {
    const page = draftedPage();
    page.draft = {
        dates: [
            drafted('2026-10-04', [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }]),
            drafted('2026-10-11', [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }]),
            drafted('2026-10-18', [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }]),
            drafted('2026-10-25', [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }]),
        ],
    };
    page.buildGrid();

    const cards = page.grid.roleRows[0].cells.map(c => c.places[0].card);
    assert.deepEqual(cards.map(c => c.load), [0, 1, 2, 3],
        'week one saw an empty log; week four saw the three the loop had laid down');
    assert.deepEqual(cards.map(c => c.recencyLabel),
        ['Not this season', 'Last time', 'Last time', 'Last time']);
});

test('a held place still gets its history, though the solve never scored it', () => {
    const page = draftedPage();
    page.history = [
        { personId: 'p1', type: 'coffee', serviceDate: '2026-09-27', seriesId: 'sunday_service' },
    ];
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', held: true, state: 'confirmed' },
        ])],
    };
    page.buildGrid();

    const card = page.grid.roleRows[0].cells[0].places[0].card;
    assert.equal(card.held, true);
    assert.equal(card.recencyLabel, 'Last time', 'a hand-made pick is not the one card with no history');
    assert.equal(card.load, 1);
});

test('a drafted roster that breaks a rule says so, same as a hand-made one', () => {
    const page = draftedPage();
    // Both places need a woman by way of a second slot; Bob is a man.
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's2', personId: 'p2', recency: 4 },
        ])],
    };
    page.buildGrid();

    const card = page.grid.roleRows[0].cells[0].places[1].card;
    assert.equal(card.name, 'Bob Carter');
    assert.match(card.warning, /needs a woman/, 'ADR-0021 — eligibility advises, and has to say what it advises');
    assert.equal(page.columns[0].problems, 1);
});

// Same class of bug as the card above, on the other path: an unfillable place
// is phrased from the slot's requirement, which is not on the reason either.
test('an unfillable place names the sex it actually asked for', () => {
    const page = draftedPage();
    page.draft = {
        dates: [drafted('2026-10-04', [], [
            { roleSlug: 'coffee', slotId: 's2', detail: { reason: 'sexMismatch' } },
        ])],
    };
    page.buildGrid();

    assert.match(page.grid.roleRows[0].cells[0].places[1].reason, /needs a woman/);
});

// ── Dragging people about (MS-180) ──────────────────────────────────────────

test('dropping somebody on an occupied place sends the occupant to the rail', () => {
    const page = draftedPage();
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 },
        ])],
    };
    page.buildGrid();

    page.startDrag(null, 'p2', null, 'directory');
    page.dropOn('2026-10-04', { roleSlug: 'coffee', slotId: 's1' });

    assert.equal(page.grid.roleRows[0].cells[0].places[0].card.name, 'Bob Carter');
    assert.deepEqual(page.displacedCards.map(d => d.name), ['Alice Brown']);
    assert.equal(page.displacedCards[0].dateLabel, '4 October');
    assert.equal(page.dragging, null, 'the hand is empty once the card lands');
});

test('placing somebody from the rail takes them off it', () => {
    const page = draftedPage();
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 },
        ])],
    };
    page.buildGrid();

    page.startDrag(null, 'p2', null, 'directory');
    page.dropOn('2026-10-04', { roleSlug: 'coffee', slotId: 's1' });
    assert.equal(page.displaced.length, 1);

    // Alice, now waiting, goes into the other place.
    page.startDrag(null, 'p1', { date: '2026-10-04' }, 'rail');
    page.dropOn('2026-10-04', { roleSlug: 'coffee', slotId: 's2' });

    assert.deepEqual(page.displaced, []);
    assert.equal(page.grid.roleRows[0].cells[0].places[1].card.name, 'Alice Brown');
});

test('a card dropped on the rail leaves the rota but not the screen', () => {
    const page = draftedPage();
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 },
        ])],
    };
    page.buildGrid();

    page.startDrag(null, 'p1', { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' });
    page.dropOnRail();

    assert.equal(page.grid.roleRows[0].cells[0].places[0].filled, false);
    assert.deepEqual(page.displacedCards.map(d => d.name), ['Alice Brown']);
    assert.equal(page.tally.empty, 2);
});

test('a moved card is redrawn with the numbers of where it landed', () => {
    const page = draftedPage();
    page.draft = {
        dates: [
            drafted('2026-10-04', [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }]),
            drafted('2026-10-11', []),
        ],
    };
    page.buildGrid();
    assert.equal(page.grid.roleRows[0].cells[1].places[0].filled, false);

    page.startDrag(null, 'p1', { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' });
    page.dropOn('2026-10-11', { roleSlug: 'coffee', slotId: 's1' });

    assert.equal(page.grid.roleRows[0].cells[0].places[0].filled, false);
    const moved = page.grid.roleRows[0].cells[1].places[0].card;
    assert.equal(moved.name, 'Alice Brown');
    assert.equal(moved.load, 0, 'nothing before the 11th any more — the range was re-read');
});

test('dismissing a displaced person is the one way a name leaves the screen', () => {
    const page = draftedPage();
    page.displaced = [{ personId: 'p1', date: '2026-10-04' }];

    page.dismiss({ personId: 'p1', date: '2026-10-04' });
    assert.deepEqual(page.displaced, []);
});

test('re-drafting clears whoever was waiting — they belong to the old draft', () => {
    const page = draftedPage();
    page.displaced = [{ personId: 'p1', date: '2026-10-04' }];
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();

    page.backToSetup();
    assert.equal(page.draft, null);
});

// ── The window that follows the scroll ──────────────────────────────────────

test('the range window is read off the grid, not counted in dates', () => {
    const page = draftedPage();
    page.draft = {
        dates: ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'].map(d => drafted(d)),
    };
    page.buildGrid();

    // Half the range visible, scrolled to the far end.
    page.onGridScroll({ scrollLeft: 400, scrollWidth: 800, clientWidth: 400 });

    assert.equal(page.viewLeft, 0.5);
    assert.equal(page.viewWidth, 0.5);
    assert.equal(page.focused, 2, 'the window is over the second half, so the third date');
});

test('a grid that fits entirely shows a window covering the whole strip', () => {
    const page = draftedPage();
    page.draft = { dates: [drafted('2026-10-04'), drafted('2026-10-11')] };
    page.buildGrid();

    page.onGridScroll({ scrollLeft: 0, scrollWidth: 500, clientWidth: 900 });

    assert.equal(page.viewWidth, 1, 'never wider than the strip, however roomy the screen');
    assert.equal(page.focused, 0);
});

// ── The panel (MS-182) ──────────────────────────────────────────────────────

test('the directory offers everyone assignable, with the grid load reading', () => {
    const page = draftedPage();
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();

    assert.equal(page.directory.count, 2);
    assert.deepEqual(page.directory.rows.map(r => r.name), ['Alice Brown', 'Bob Carter']);
    assert.equal(page.directory.rows[0].budget, page.windowSize,
        'the directory must not rank people differently from the grid');

    page.search = 'bob';
    assert.deepEqual(page.directory.rows.map(r => r.name), ['Bob Carter']);
});

test('the directory never offers somebody a tag hides', () => {
    const page = draftedPage({ rank: 'editor' });
    page.people = page.people.concat([
        { id: 'p9', name: 'Hidden Person', tags: ['staff-only'] },
    ]);
    page.hidingTags = ['staff-only'];
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();

    assert.equal(page.directory.rows.some(r => r.personId === 'p9'), false);
});

test('clicking a card opens the panel for that person and place', () => {
    const page = draftedPage();
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 },
        ])],
    };
    page.buildGrid();

    const place = page.grid.roleRows[0].cells[0].places[0];
    page.selectPlace('2026-10-04', place);

    assert.equal(page.placement.name, 'Alice Brown');
    assert.equal(page.placement.roleName, 'Coffee');
    assert.equal(page.placement.dateLabel, '4 October');
    assert.equal(page.isSelected('2026-10-04', place), true);

    page.closePanel();
    assert.equal(page.selected, null, 'closing returns the panel to the directory');
});

test('an empty place opens nothing — there is no placement to explain', () => {
    const page = draftedPage();
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();

    page.selectPlace('2026-10-04', page.grid.roleRows[0].cells[0].places[0]);
    assert.equal(page.selected, null);
});

test('the panel lists the serves the load is made of, not an invented split', () => {
    const page = draftedPage();
    page.history = [
        { id: 'i1', personId: 'p1', type: 'coffee', serviceDate: '2026-09-27', seeded: true },
        { id: 'i2', personId: 'p1', type: 'coffee', serviceDate: '2026-09-20' },
    ];
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1' },
        ])],
    };
    page.buildGrid();
    page.selectPlace('2026-10-04', page.grid.roleRows[0].cells[0].places[0]);

    assert.deepEqual(page.placement.serves.map(s => s.dateLabel), ['27 September', '20 September']);
    assert.equal(page.placement.load, 2, 'the number is 2 because of these two things');
    assert.deepEqual(page.placement.serves.map(s => s.removable), [true, false],
        'a Sunday that happened is a fact; the seeded one is the editor\'s to take back');
});

test('the panel offers who could take the place instead, and what is wrong with each', () => {
    const page = draftedPage();
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's2', personId: 'p1' },
        ])],
    };
    page.buildGrid();
    // Slot s2 wants a woman; Bob is a man.
    page.selectPlace('2026-10-04', page.grid.roleRows[0].cells[0].places[1]);

    const others = page.placement.replacements;
    assert.deepEqual(others.map(c => c.name), ['Bob Carter']);
    assert.match(others[0].reason, /needs a woman/);
    assert.equal(others.some(c => c.personId === 'p1'), false);
});

// ⚠ A serve is a claim about the PAST, so it writes at once — unlike everything
// else on this screen. A past that only existed if you later accepted a rota
// would be a strange thing indeed.
test('seeding a serve writes immediately, and does not redraw the draft', async () => {
    const written = [];
    const page = draftedPage(null, {
        db: {
            collection: () => ({
                doc: () => ({
                    collection: () => ({
                        add: async data => { written.push(data); return { id: 'new1' }; },
                    }),
                }),
            }),
        },
    });
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1' },
        ])],
    };
    page.buildGrid();
    page.selectPlace('2026-10-04', page.grid.roleRows[0].cells[0].places[0]);

    page.seedRole = 'coffee';
    page.seedDate = '2026-09-27';
    await page.addServe();

    assert.equal(written.length, 1);
    assert.equal(written[0].type, 'coffee');
    assert.equal(written[0].serviceDate, '2026-09-27');
    assert.equal(written[0].seeded, true, 'marked as typed in rather than lived through');
    assert.match(page.seedNote, /not redrawn/,
        'nothing re-solves on its own — re-draft is how the editor acts on it');
});

// The whole reason it records a serve and not a number: fairness has two dials.
test('a seeded serve moves load AND recency, which a typed figure could not', async () => {
    const page = draftedPage(null, {
        db: {
            collection: () => ({
                doc: () => ({ collection: () => ({ add: async () => ({ id: 'new1' }) }) }),
            }),
        },
    });
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1' },
        ])],
    };
    page.buildGrid();
    const before = page.grid.roleRows[0].cells[0].places[0].card;
    assert.equal(before.load, 0);
    assert.equal(before.recencyLabel, 'Not this season');

    page.selectPlace('2026-10-04', page.grid.roleRows[0].cells[0].places[0]);
    page.seedRole = 'coffee';
    page.seedDate = '2026-09-27';
    await page.addServe();

    const after = page.grid.roleRows[0].cells[0].places[0].card;
    assert.equal(after.load, 1, 'the burnout gate moved');
    assert.equal(after.recencyLabel, 'Last time', 'and so did the rotation');
});

test('a serve that will not save says so, and records nothing', async () => {
    const page = draftedPage(null, {
        db: {
            collection: () => ({
                doc: () => ({
                    collection: () => ({ add: async () => { throw new Error('refused'); } }),
                }),
            }),
        },
    });
    page.draft = {
        dates: [drafted('2026-10-04', [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }])],
    };
    page.buildGrid();
    page.selectPlace('2026-10-04', page.grid.roleRows[0].cells[0].places[0]);
    page.seedRole = 'coffee';
    page.seedDate = '2026-09-27';
    await page.addServe();

    assert.match(page.seedNote, /could not be saved/);
    assert.deepEqual(page.history, [], 'nothing was recorded, so nothing is claimed');
});

test('only dates before the range are offered to seed — the future is not the past', () => {
    const page = draftedPage();
    page.draft = { dates: [drafted('2026-10-04', [
        { roleSlug: 'coffee', slotId: 's1', personId: 'p1' },
    ])] };
    page.buildGrid();
    page.selectPlace('2026-10-04', page.grid.roleRows[0].cells[0].places[0]);

    assert.ok(page.seedDates.length > 0);
    assert.equal(page.seedDates.every(d => d < '2026-10-04'), true);
});

test('the page no longer promises that nothing is saved, because one thing is', () => {
    const html = readPage('auto-assign.html');
    assert.doesNotMatch(html, /Nothing is saved until you accept/,
        'seeding a serve writes at once, so the blanket promise became a lie');
    assert.match(html, /No rota is saved until you accept it/);
    assert.match(html, /Serve records save straight away/);
});

// ── Starting blank (MS-219) ─────────────────────────────────────────────────

test('the setup step offers both doors, not just the drafted one', () => {
    const html = readPage('auto-assign.html');

    assert.match(html, /@click="runBlank\(\)"/, 'no way to start with an empty grid');
    assert.match(html, /@click="runDraft\(\)"/);
    // Which picture gets drawn FIRST is the whole of the choice, so it has to be
    // made before the room opens — by the time you are looking at the wrong one
    // it has already been drawn.
    assert.ok(html.indexOf('runBlank()') < html.indexOf('runDraft()'),
        'the blank door should read as the quieter alternative, first in the row');
});

test('the header says which grid you are looking at', () => {
    // An editor who asked for an empty grid and got a header saying
    // "Auto-assign" would reasonably wonder what it had assigned.
    const page = draftedPage();
    assert.equal(page.draftTitle, 'Auto-assign');

    page.byHand = true;
    assert.equal(page.draftTitle, 'By hand');

    const html = readPage('auto-assign.html');
    assert.match(html, /x-text="draftTitle"/, 'the header is hard-coded and cannot say');
});

test('re-drafting the whole range stops calling it a grid you filled in', () => {
    const page = draftedPage();
    page.byHand = true;
    page.draft = { dates: [drafted('2026-10-04'), drafted('2026-10-11')] };

    page.redraftAll();

    assert.equal(page.byHand, false, 'every date on it has now been drafted');
    assert.equal(page.draftTitle, 'Auto-assign');
});

test('re-drafting ONE column leaves the grid the editor\'s own', () => {
    // The columns before that one are still their work. Re-drafting from the
    // fifth date is a repair, not a change of authorship.
    const page = draftedPage();
    page.byHand = true;
    page.draft = { dates: [drafted('2026-10-04'), drafted('2026-10-11')] };

    page.redraftFrom(1);

    assert.equal(page.byHand, true);
});

test('a blank grid asked for in the address bar is remembered and picked back up', () => {
    // The stored draft is what survives a closed tab, and a draft resumed under
    // the wrong heading has the editor looking for an assignment nothing made.
    const page = draftedPage();
    page.byHand = true;
    assert.equal(page.savedContext().byHand, true);

    page.byHand = false;
    page.offered = { draft: { dates: [] }, byHand: true };
    page.offerStale = [];
    page.resumeDraft();
    assert.equal(page.byHand, true);

    // A draft saved before MS-219 has no such field, and reads as the ordinary
    // kind — which is what every draft saved before it was.
    page.offered = { draft: { dates: [] } };
    page.offerStale = [];
    page.resumeDraft();
    assert.equal(page.byHand, false);
});

test('the address bar asks for a blank grid, and only in so many words', () => {
    const asked = search => {
        const page = loadComponent('auto-assign.js', 'autoAssignPage', {
            location: { search: search, href: '' },
        });
        page.onRangeSettled = () => {};
        page.series = [{ id: 'sunday_service', name: 'Sunday Service' }];
        page.applyIncoming();
        return page.startByHand;
    };

    assert.equal(asked('?series=sunday_service&by=hand'), true);
    assert.equal(asked('?series=sunday_service'), false, 'the ordinary door');
    assert.equal(asked('?series=sunday_service&by=magic'), false,
        'a hand-typed link should open the ordinary page rather than guess');
});

// ── Staleness and re-draft from here (MS-181) ───────────────────────────────

// Each date was drafted reading the dates before it as history, so editing the
// 4th leaves every later column balanced against a Sunday that no longer
// exists. Nothing re-solves on its own — a table that rearranges itself while
// it is being reviewed cannot be reviewed.
test('editing a date marks the later columns, and changes none of their people', () => {
    const page = draftedPage();
    page.draft = {
        dates: ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'].map((d, i) => drafted(d, [
            { roleSlug: 'coffee', slotId: 's1', personId: i % 2 ? 'p1' : 'p2' },
        ])),
    };
    page.buildGrid();
    const before = page.grid.roleRows[0].cells.map(c => c.places[0].card.name);

    page.startDrag(null, 'p1', null, 'directory');
    page.dropOn('2026-10-04', { roleSlug: 'coffee', slotId: 's1' });

    const after = page.grid.roleRows[0].cells.map(c => c.places[0].card.name);
    assert.deepEqual(after.slice(1), before.slice(1), 'no other date moved a single person');
    assert.equal(page.isStale(0), false, 'the edited date was balanced against what came before it');
    assert.deepEqual([1, 2, 3].map(i => page.isStale(i)), [true, true, true]);
    assert.equal(page.staleCount, 3);
});

test('re-drafting from a date clears the marker and keeps that date as it stands', () => {
    const page = draftedPage();
    page.draft = {
        dates: ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'].map(d => drafted(d, [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p2' },
        ])),
    };
    page.buildGrid();

    page.startDrag(null, 'p1', null, 'directory');
    page.dropOn('2026-10-04', { roleSlug: 'coffee', slotId: 's1' });
    assert.equal(page.staleCount, 3);

    page.redraftFrom(0);

    assert.equal(page.staleCount, 0);
    assert.equal(page.grid.roleRows[0].cells[0].places[0].card.name, 'Alice Brown',
        'the date the editor settled is kept exactly as they left it');
});

test('re-drafting twice with nothing in between gives the same answer', () => {
    const page = draftedPage();
    page.draft = {
        dates: ['2026-10-04', '2026-10-11'].map(d => drafted(d, [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1' },
        ])),
    };
    page.buildGrid();

    page.redraftFrom(0);
    const once = JSON.stringify(page.draft.dates[1].seats);
    page.redraftFrom(0);

    assert.equal(JSON.stringify(page.draft.dates[1].seats), once,
        'a draft that redraws differently on Wednesday than Tuesday cannot be reviewed');
});

test('seeding a serve drifts the whole range, not just what comes after a date', async () => {
    const page = draftedPage(null, {
        db: {
            collection: () => ({
                doc: () => ({ collection: () => ({ add: async () => ({ id: 'new1' }) }) }),
            }),
        },
    });
    page.draft = {
        dates: ['2026-10-04', '2026-10-11'].map(d => drafted(d, [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1' },
        ])),
    };
    page.buildGrid();
    page.selectPlace('2026-10-04', page.grid.roleRows[0].cells[0].places[0]);
    page.seedRole = 'coffee';
    page.seedDate = '2026-09-27';
    await page.addServe();

    assert.equal(page.isStale(0), true, 'a serve is history — every column read it');
    assert.equal(page.staleCount, 2);
});

// ── The bottom bar and accepting (MS-183) ───────────────────────────────────

test('the bar counts problems and can take you to the first one', () => {
    const page = draftedPage();
    page.draft = {
        dates: [
            drafted('2026-10-04'),
            // Bob is a man; s2 wants a woman.
            drafted('2026-10-11', [{ roleSlug: 'coffee', slotId: 's2', personId: 'p2' }]),
        ],
    };
    page.buildGrid();

    assert.equal(page.problemCount, 1);
    assert.equal(page.mustLookFirst, true);
    assert.equal(page.acceptLabel, 'Accept anyway');

    page.goToProblems();

    assert.equal(page.selected.personId, 'p2', 'it opens the explanation, not just the column');
    assert.equal(page.focused, 1);
    assert.equal(page.mustLookFirst, false);
});

test('a clean draft says so, and offers the plain button', () => {
    const page = draftedPage();
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();

    assert.equal(page.problemCount, 0);
    assert.equal(page.acceptLabel, 'Accept the roster');
    assert.equal(page.mustLookFirst, false, 'a clean draft should feel clean');
});

// Accepting is always allowed — with empty places, because leaving one for
// nearer the day is a real answer, and with warnings, because the editor is the
// final word (ADR-0021). The bar only makes you LOOK.
test('accepting is allowed with empty places, and writes what it drew', async () => {
    let written = null;
    const page = draftedPage(null, {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            acceptDraft: async (db, draft, options) => {
                written = { draft: draft, options: options };
                return { dates: ['2026-10-04'], occurrences: 1, assignments: 1 };
            },
        }),
    });
    page.draft = {
        dates: [drafted('2026-10-04', [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }])],
    };
    page.buildGrid();
    assert.equal(page.tally.empty, 1);

    await page.acceptRoster();

    assert.ok(written, 'an empty place is not a reason to refuse');
    assert.deepEqual(written.options.roleSlugs, ['coffee']);
    assert.equal(written.options.seriesId, 'sunday_service');
    assert.deepEqual(page.accepted, { dates: ['2026-10-04'], occurrences: 1, assignments: 1 });
});

test('accepting blind is refused; accepting after looking is not', async () => {
    let calls = 0;
    const page = draftedPage(null, {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            acceptDraft: async () => { calls++; return { dates: [], occurrences: 0, assignments: 0 }; },
        }),
    });
    page.draft = {
        dates: [drafted('2026-10-04', [{ roleSlug: 'coffee', slotId: 's2', personId: 'p2' }])],
    };
    page.buildGrid();

    await page.acceptRoster();
    assert.equal(calls, 0, 'not a gate on the decision — a gate on making it blind');

    page.goToProblems();
    await page.acceptRoster();
    assert.equal(calls, 1);
});

// ⚠ A long range is written date by date, so a failure part way through HAS
// really written the dates before it. "Nothing was saved" would be a lie the
// editor discovers on the Calendar.
test('a half-written accept says some dates may already have landed', async () => {
    const page = draftedPage(null, {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            acceptDraft: async () => { throw new Error('network'); },
        }),
    });
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();

    await page.acceptRoster();

    assert.match(page.acceptError, /may already/);
    assert.equal(page.accepted, null);
});

test('the draft owns the one-off jobs on its dates too', () => {
    const page = draftedPage();
    page.occurrences = {
        '2026-10-11': { date: '2026-10-11', oneOffRoles: [{ id: 'j1', label: 'Move the piano' }] },
    };

    assert.deepEqual(page.ownedSlugs, ['coffee', 'j1'],
        'without it the accept keeps the old one-off row and adds the drafted one beside it');
});

// ── Kept in the browser (MS-184) ────────────────────────────────────────────

function withStorage(overrides) {
    const box = {};
    const storage = {
        setItem(k, v) { box[k] = v; },
        getItem(k) { return box[k] === undefined ? null : box[k]; },
        removeItem(k) { delete box[k]; },
    };
    const page = draftedPage(overrides, { localStorage: storage });
    return { page, box, storage };
}

test('a draft is written to the browser as it is edited', () => {
    const { page, box } = withStorage();
    page.draft = {
        dates: [drafted('2026-10-04', [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }])],
    };
    page.buildGrid();

    page.startDrag(null, 'p2', null, 'directory');
    page.dropOn('2026-10-04', { roleSlug: 'coffee', slotId: 's2' });

    const stored = JSON.parse(box[page.savedKey]);
    assert.equal(stored.draft.dates[0].seats.length, 2,
        'half an hour of dragging must not die with a stray click');
});

test('a stored draft that still matches can be picked back up', () => {
    const { page, box } = withStorage();
    page.draft = {
        dates: [drafted('2026-10-04', [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }])],
    };
    page.buildGrid();
    page.remember();

    page.offered = JSON.parse(box[page.savedKey]);
    page.offerStale = [];
    page.resumeDraft();

    assert.equal(page.view, 'draft');
    assert.equal(page.grid.roleRows[0].cells[0].places[0].card.name, 'Alice Brown');
    assert.equal(page.offered, null);
});

test('a stored draft naming somebody who has left is not picked back up', () => {
    const { page, box } = withStorage();
    page.draft = {
        dates: [drafted('2026-10-04', [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1' }])],
    };
    page.buildGrid();
    page.remember();

    const stored = JSON.parse(box[page.savedKey]);
    page.people = [{ id: 'p2', name: 'Bob Carter', sex: 'male' }];
    page.offered = stored;
    page.offerStale = require('../public/auto-assign-saved-core.js')
        .staleReasons(stored, page.savedContext());
    assert.equal(page.offerStale.length, 1);

    page.resumeDraft();
    assert.equal(page.view, 'setup', 'better a fresh draft than a picture of a church that has moved on');
});

test('accepting and discarding both clear what is stored', async () => {
    const { page, box } = withStorage({});
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();
    page.remember();
    assert.ok(box[page.savedKey]);

    page.discard();
    assert.equal(box[page.savedKey], undefined);
    assert.equal(page.view, 'setup');
});

test('a browser that refuses to remember does not break the page', () => {
    const page = draftedPage(null, {
        localStorage: {
            setItem() { throw new Error('quota'); },
            getItem() { throw new Error('denied'); },
            removeItem() { throw new Error('denied'); },
        },
    });
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();

    assert.doesNotThrow(() => page.remember());
    assert.doesNotThrow(() => page.forgetDraft());
});

// ⚠ The grid is the page. A sticky header inside a scrolling BODY still walks
// up and off, taking the range strip with it — and the strip is only worth
// having if it stays put while you read the columns.
test('the page is pinned to the viewport and the grid scrolls inside it', () => {
    const html = readPage('auto-assign.html');

    assert.match(html, /\.aa-page \{[^}]*overflow: hidden/,
        'the body must not be what scrolls');
    assert.match(html, /\.aa-desk \{ display: none/);
    assert.match(html, /\.aa-desk \{ display: flex/,
        'written as block this rule beats Tailwind and cancels the whole flex column');
    assert.match(html, /x-ref="scroller"[\s\S]{0,200}?@scroll="onGridScroll/,
        'the grid is the scrolling container');
});

test('the draft draws one header, not a second one under the first', () => {
    const html = readPage('auto-assign.html');
    const headers = html.match(/<header[\s>]/g) || [];

    assert.equal(headers.length, 1, 'two bars saying the same kind of thing cost 74px of grid');
    // And that one header carries both jobs.
    assert.match(html, /<header[\s\S]*?draftSubtitle[\s\S]*?<\/header>/);
    assert.match(html, /<header[\s\S]*?auth-container[\s\S]*?<\/header>/);
});

// ── The strip is the horizontal scrollbar (thumb behaviour) ─────────────────

function scrubbablePage() {
    const page = draftedPage();
    page.draft = {
        dates: ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'].map(d => drafted(d)),
    };
    page.buildGrid();
    // A grid twice the width of its window: half visible, scrolled to the start.
    const scroller = { scrollLeft: 0, scrollWidth: 1000, clientWidth: 500 };
    page.$refs = { scroller: scroller };
    page.onGridScroll(scroller);
    return { page, scroller };
}

const strip = { getBoundingClientRect: () => ({ left: 0, width: 100 }) };

// ⚠ GRABBED WHERE YOU GRABBED IT. Centring the thumb on the pointer instead
// makes the grid lurch sideways the moment you take hold — the difference
// between dragging a scrollbar and being thrown by one.
test('taking hold of the window does not move it', () => {
    const { page, scroller } = scrubbablePage();
    assert.equal(page.viewWidth, 0.5);

    // Press near the right-hand end of the thumb, which spans 0–50%.
    page.startScrub({ clientX: 40 }, strip);

    assert.equal(scroller.scrollLeft, 0, 'it went nowhere until the pointer did');
    assert.equal(page.grabbedAt, 0.4);
});

test('dragging the window moves the grid one-to-one with the pointer', () => {
    const { page, scroller } = scrubbablePage();

    page.startScrub({ clientX: 10 }, strip);   // grabbed 10% into the thumb
    page.moveScrub({ clientX: 30 }, strip);    // pointer moves 20% along

    assert.ok(Math.abs(scroller.scrollLeft - 200) < 0.001,
        'the thumb starts where the pointer put it: 20% of 1000');
});

test('a press on the empty track jumps, the way a scrollbar track does', () => {
    const { page, scroller } = scrubbablePage();

    // 60% along is past the thumb, which ends at 50%.
    page.startScrub({ clientX: 60 }, strip);

    assert.equal(page.grabbedAt, 0.25, 'centred, because there was no thumb to grab');
    assert.ok(Math.abs(scroller.scrollLeft - 350) < 0.001, 'the window lands under the pointer');
});

test('the window never runs off either end', () => {
    const { page, scroller } = scrubbablePage();

    page.startScrub({ clientX: 25 }, strip);
    page.moveScrub({ clientX: -200 }, strip);
    assert.equal(scroller.scrollLeft, 0);

    page.moveScrub({ clientX: 500 }, strip);
    assert.equal(scroller.scrollLeft, 500, 'the far end is scrollWidth minus one window');
});

test('a grid that fits entirely cannot be dragged, and does not offer to be', () => {
    const page = draftedPage();
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();
    const scroller = { scrollLeft: 0, scrollWidth: 500, clientWidth: 900 };
    page.$refs = { scroller: scroller };
    page.onGridScroll(scroller);

    assert.equal(page.canScrub, false, 'a grab cursor over a dead control is a small lie');
    page.startScrub({ clientX: 50 }, strip);
    assert.equal(page.scrubbing, false);
    assert.equal(scroller.scrollLeft, 0);
});

test('moving the pointer without having grabbed anything scrolls nothing', () => {
    const { page, scroller } = scrubbablePage();

    page.moveScrub({ clientX: 90 }, strip);
    assert.equal(scroller.scrollLeft, 0);
});

test('the grid hides its own horizontal bar but keeps the vertical one', () => {
    const html = readPage('auto-assign.html');

    assert.match(html, /\.aa-scroll-clip \{ overflow: hidden/);
    assert.match(html, /\.aa-scroller \{ height: calc\(100% \+ 18px\)/,
        'the bar is pushed out of sight, not switched off');
    // Clipped, never switched off: the trackpad and shift-wheel still scroll
    // the grid sideways, and the strip just shows where that got you.
    assert.doesNotMatch(html, /\.aa-scroller \{[^}]*overflow-x:\s*hidden/);
});

// ── What the editor knows and the church has not recorded ───────────────────

function placedPage(seats) {
    const page = draftedPage();
    page.draft = {
        dates: ['2026-10-04', '2026-10-11'].map(d => drafted(d, (seats || {})[d] || [])),
    };
    page.buildGrid();
    page.selectPlace('2026-10-04', page.grid.roleRows[0].cells[0].places[0]);
    return page;
}

const ON = (page, date) => {
    const day = page.draft.dates.filter(d => d.date === date)[0];
    return (day.seats || []).map(s => s.personId).sort();
};

test('a nudge adds weeks to a load nothing in the serve log accounts for', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });
    assert.equal(page.placement.load, 0);

    page.nudgeBy('p1', 1);
    page.nudgeBy('p1', 1);

    assert.equal(page.placement.nudge, 2);
    assert.equal(page.placement.load, 2, 'and the card reads it the same way the solve will');
});

// Zero is the absence of a nudge, not a nudge of nothing — otherwise every
// person the editor so much as looked at rides along in the saved draft.
test('nudging back to nothing forgets the nudge', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.nudgeBy('p1', 1);
    page.nudgeBy('p1', -1);

    assert.deepEqual(page.nudges, {});
});

// ⚠ A NUDGE IS NOT A SERVE. The seeding control says "they held this Role on
// this date" and moves both dials. This says only "they are carrying more than
// the record shows" — and must never invent a Sunday to say it.
test('a nudge writes no serve, and tells the solve about no Role', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.nudgeBy('p1', 3);

    assert.deepEqual(page.history, [], 'no Sunday was invented');
    assert.deepEqual(page.placement.serves, [], 'and the breakdown still says what it is made of');
    assert.equal(page.draftOptions().nudges.p1, 3, 'but the solve is told');
});

// ── Taking somebody out ─────────────────────────────────────────────────────

test('out on a date empties their places on it and nothing else', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
        '2026-10-11': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.markOut('date');
    assert.equal(page.outPlaces, 1);
    page.takeOut(false);

    assert.deepEqual(ON(page, '2026-10-04'), []);
    assert.deepEqual(ON(page, '2026-10-11'), ['p1'], 'the next date is a different question');
    assert.equal(page.isOut('2026-10-04', 'p1'), true);
    assert.equal(page.isOut('2026-10-11', 'p1'), false);
});

test('out for the rest of the range takes every date from here on', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
        '2026-10-11': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.markOut('rest');
    assert.equal(page.outPlaces, 2);
    page.takeOut(false);

    assert.deepEqual(ON(page, '2026-10-04'), []);
    assert.deepEqual(ON(page, '2026-10-11'), []);
});

// ⚠ TAKEN OUT IS NOT DISPLACED. A displaced person is waiting to be put
// somewhere; somebody who is away is not there at all, and putting them on the
// rail would invite the editor to drag them straight back in.
test('somebody taken out does not land on the displaced rail', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.markOut('date');
    page.takeOut(false);

    assert.deepEqual(page.displaced, []);
});

test('filling their places again puts somebody else in them', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.markOut('date');
    page.takeOut(true);

    const on = ON(page, '2026-10-04');
    assert.ok(on.length >= 1, 'the place is covered');
    assert.equal(on.indexOf('p1'), -1, 'and never by the person who is not there');
});

// The choice is asked, never assumed: emptying and refilling are opposite
// answers, and either one picked for the editor is wrong half the time.
test('the two answers are opposite, and neither happens until one is picked', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.markOut('date');
    assert.equal(page.outScope, 'date');
    assert.deepEqual(ON(page, '2026-10-04'), ['p1'], 'nothing has happened yet');

    page.cancelOut();
    assert.equal(page.outScope, null);
    assert.deepEqual(ON(page, '2026-10-04'), ['p1']);
    assert.deepEqual(page.out, {});
});

test('being left out survives a re-draft — that is the point of recording it', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.markOut('rest');
    page.takeOut(false);

    assert.deepEqual(page.draftOptions().outOn('2026-10-04'), ['p1']);
    assert.deepEqual(page.draftOptions().outOn('2026-10-11'), ['p1']);
});

test('bringing somebody back clears every date they were out on', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.markOut('rest');
    page.takeOut(false);
    assert.equal(page.outNames.length, 1);
    assert.equal(page.outNames[0].dates, page.resolvedDates.length,
        '"the rest of the range" is the range, not just the drafted part of it');

    page.bringBack('p1', null);
    assert.deepEqual(page.out, {});
    assert.deepEqual(page.outNames, []);
});

// ── Somebody else instead ───────────────────────────────────────────────────

test('picking a replacement seats them and sends the other to Displaced', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.replaceWith('p2');

    assert.deepEqual(ON(page, '2026-10-04'), ['p2']);
    assert.deepEqual(page.displaced.map(d => d.personId), ['p1']);
});

// The editor is looking at a SEAT and wants to see who is in it now — following
// the person would leave them reading about somebody who is no longer there.
test('the panel stays on the place, not on the person who left it', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.replaceSearch = 'bob';
    page.replaceWith('p2');

    assert.equal(page.placement.personId, 'p2');
    assert.equal(page.replaceSearch, '', 'and the box is clear for the next one');
});

test('the search narrows who is offered, without hiding a warning', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.replaceSearch = 'bob';
    assert.deepEqual(page.placement.replacements.map(c => c.name), ['Bob Carter']);

    page.replaceSearch = 'zzz';
    assert.deepEqual(page.placement.replacements, []);
});

test('a nudge and an out list ride with the saved draft', () => {
    const box = {};
    const page = draftedPage(null, {
        localStorage: {
            setItem(k, v) { box[k] = v; },
            getItem(k) { return box[k] === undefined ? null : box[k]; },
            removeItem(k) { delete box[k]; },
        },
    });
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();
    page.nudges = { p1: 3 };
    page.out = { '2026-10-04': ['p2'] };

    page.remember();
    const kept = JSON.parse(box[page.savedKey]);

    assert.deepEqual(kept.nudges, { p1: 3 });
    assert.deepEqual(kept.out, { '2026-10-04': ['p2'] });
});

// ── The same panel, about a person rather than a place ──────────────────────

test('clicking somebody in the directory opens the panel about them', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.selectPerson('p2');

    assert.equal(page.placement.name, 'Bob Carter');
    assert.equal(page.placement.atPlace, false);
    assert.equal(page.placement.subtitle, 'Across the whole range');
});

// ⚠ NO PLACE, NOBODY TO SWAP OUT. Offering to replace a person who is not in
// anything would be a button with no seat to put the answer in.
test('a person opened from the directory is offered no swap', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });

    page.selectPerson('p2');
    assert.deepEqual(page.placement.replacements, []);
});

// A reading has to be taken somewhere, and for a person it is the start of the
// range — the same point the directory ranks by, so the two never disagree.
test('a person’s load reads the same in the panel as it does in the directory', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });
    page.nudgeBy('p2', 3);

    page.selectPerson('p2');

    assert.equal(page.placement.load, 3);
    assert.equal(page.placement.nudge, 3);
    assert.equal(page.loadForDirectory('p2'), 3);
});

test('a person can be nudged and taken out from the directory too', () => {
    const page = placedPage({
        '2026-10-11': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p2', recency: 2 }],
    });

    page.selectPerson('p2');
    page.markOut('rest');
    // No date of their own, so "the rest" is the whole range.
    assert.deepEqual(page.outDates, page.resolvedDates);
    page.takeOut(false);

    assert.equal(page.isOut('2026-10-04', 'p2'), true);
    assert.deepEqual(ON(page, '2026-10-11'), []);
});

test('discarding a draft takes the nudges and the out list with it', () => {
    const page = placedPage({
        '2026-10-04': [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 }],
    });
    page.nudgeBy('p1', 4);
    page.markOut('date');
    page.takeOut(false);
    assert.deepEqual(page.nudges, { p1: 4 });

    page.discard();

    // Neither writes a record anywhere else, so a discard that left them
    // behind would bias the next draft with numbers nobody can see.
    assert.deepEqual(page.nudges, {});
    assert.deepEqual(page.out, {});
    assert.deepEqual(page.displaced, []);
});

test('the panel no longer explains the runners-up, it offers to change them', () => {
    const html = readPage('auto-assign.html');

    assert.doesNotMatch(html, /Others considered/);
    assert.doesNotMatch(html, /Nothing this season/);
    assert.match(html, /Somebody else instead/);
    assert.match(html, /Carrying more than we know/);
    assert.doesNotMatch(html, /A new baby, a parent in hospital/);
    assert.match(html, /Out for the rest of the range/);
    // ⚠ The arrow is drawn INSIDE the box, over the last characters of the
    // longest option — "Children's Ministry" reads as "Children's Minist⌄".
    assert.doesNotMatch(html, /<select[^>]*\bpx-2\b/, 'every select needs room for its arrow');
    assert.match(html, /x-model="seedRole"[\s\S]{0,400}pr-7/);
    assert.match(html, /x-model="seedDate"[\s\S]{0,400}pr-7/);

    // A directory row does two things now: dragging puts them somewhere,
    // clicking asks about them.
    assert.match(html, /@click="selectPerson\(row\.personId\)"/);
    assert.match(html, /x-show="placement\.atPlace"[\s\S]{0,400}Somebody else instead/,
        'no place, nobody to swap out');
});

// ── Hover offers a trade; holding still turns it into a displace ────────────

// Two people, two Roles, one date — the setting for every trade.
function tradeablePage() {
    const page = draftedPage({
        series: [{ id: 'sunday_service', name: 'Sunday Service', roleSlugs: ['coffee', 'setup'] }],
        roleDefinitions: [
            { slug: 'coffee', name: 'Coffee', intensity: 1, slots: [{ id: 's1', requirement: 'either' }] },
            { slug: 'setup', name: 'Setup', intensity: 1, slots: [{ id: 's1', requirement: 'either' }] },
        ],
    });
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 },
            { roleSlug: 'setup', slotId: 's1', personId: 'p2', recency: 2 },
        ])],
    };
    page.buildGrid();

    const rowBySlug = slug => page.grid.roleRows.filter(r => r.slug === slug)[0];
    return {
        page: page,
        coffee: rowBySlug('coffee').cells[0].places[0],
        setup: rowBySlug('setup').cells[0].places[0],
    };
}

const from = place => ({ date: '2026-10-04', roleSlug: place.roleSlug, slotId: place.slotId });
const who = (page, slug) =>
    page.grid.roleRows.filter(r => r.slug === slug)[0].cells[0].places[0].card;

test('hovering somebody else’s place offers a trade', () => {
    const { page, coffee, setup } = tradeablePage();
    page.startDrag({}, 'p1', from(coffee), 'grid');

    page.dragOver('k', '2026-10-04', setup);

    assert.equal(page.intent, 'swap');
    assert.equal(page.aimCard.personId, 'p2', 'and names who would come back the other way');
});

test('letting go on the trade puts each of them in the other’s place', () => {
    const { page, coffee, setup } = tradeablePage();
    page.startDrag({}, 'p1', from(coffee), 'grid');
    page.dragOver('k', '2026-10-04', setup);

    page.dropOn('2026-10-04', setup);

    assert.equal(who(page, 'setup').personId, 'p1');
    assert.equal(who(page, 'coffee').personId, 'p2');
    assert.deepEqual(page.displaced, [], 'a trade puts nobody on the rail — that is the point');
});

// ⚠ THE GESTURE HAS TO TEACH ITSELF. Nothing tells an editor that holding
// still changes the offer except watching the offer change.
test('holding the card still turns the trade into a displace', () => {
    const { page, coffee, setup } = tradeablePage();
    page.startDrag({}, 'p1', from(coffee), 'grid');
    page.dragOver('k', '2026-10-04', setup);
    assert.equal(page.intent, 'swap');

    page.dwellElapsed();
    assert.equal(page.intent, 'displace');

    page.dropOn('2026-10-04', setup);
    assert.equal(who(page, 'setup').personId, 'p1');
    assert.equal(page.grid.roleRows.filter(r => r.slug === 'coffee')[0]
        .cells[0].places[0].filled, false, 'the place they left stays empty');
    assert.deepEqual(page.displaced.map(d => d.personId), ['p2']);
});

test('moving on to another place starts the hold again', () => {
    const { page, coffee, setup } = tradeablePage();
    page.startDrag({}, 'p1', from(coffee), 'grid');
    page.dragOver('k', '2026-10-04', setup);
    page.dwellElapsed();
    assert.equal(page.intent, 'displace');

    page.dragOver('elsewhere', '2026-10-04', setup);
    assert.equal(page.intent, 'swap', 'a fresh place is a fresh offer');
});

// ⚠ `dragleave` FIRES WHEN THE POINTER MOVES ONTO A CHILD, exactly like
// `mouseout`. Clear on every one of them and the hold restarts each time the
// pointer crosses the card inside the place — the offer never changes, however
// long it is held.
test('crossing the card inside a place does not restart the hold', () => {
    const { page, coffee, setup } = tradeablePage();
    page.startDrag({}, 'p1', from(coffee), 'grid');
    page.dragOver('k', '2026-10-04', setup);

    const inner = {};
    const cell = { contains: node => node === inner };
    page.dragOut({ currentTarget: cell, relatedTarget: inner });

    assert.equal(page.over, 'k', 'still over the same place');
    assert.equal(page.intent, 'swap', 'and still counting');

    page.dragOut({ currentTarget: cell, relatedTarget: {} });
    assert.equal(page.over, null, 'genuinely leaving still clears it');
    assert.equal(page.intent, null);
});

// There is nowhere to send the person turned out, so there is nothing to
// offer — the drop displaces and always did.
test('a card from the directory never offers a trade', () => {
    const { page, setup } = tradeablePage();
    page.startDrag({}, 'p9', null, 'directory');

    page.dragOver('k', '2026-10-04', setup);
    assert.equal(page.intent, 'displace');
});

test('an empty place is a plain move, with nothing to hold for', () => {
    const page = draftedPage();
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();
    page.startDrag({}, 'p1', null, 'directory');

    page.dragOver('k', '2026-10-04', page.grid.roleRows[0].cells[0].places[0]);
    assert.equal(page.intent, 'fill');
});

test('two places in one Role on one date can trade with each other', () => {
    const page = draftedPage();
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 },
            { roleSlug: 'coffee', slotId: 's2', personId: 'p2', recency: 2 },
        ])],
    };
    page.buildGrid();
    const places = page.grid.roleRows[0].cells[0].places;
    page.startDrag({}, 'p1', from(places[0]), 'grid');

    page.dragOver('k', '2026-10-04', places[1]);
    assert.equal(page.intent, 'swap', 'each of them still holds exactly one place after');
});

// ⚠ REFUSED, NOT CORRECTED — and the editor is told which of the two they are
// getting before they let go, so the same drop still does something sensible.
test('a trade that would sit somebody twice in one Role is offered as a displace', () => {
    const page = draftedPage();
    page.draft = {
        dates: [
            // p2 is already pouring at the second place on the 4th, so sending
            // them back there would have them in two spots on one morning.
            drafted('2026-10-04', [
                { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 },
                { roleSlug: 'coffee', slotId: 's2', personId: 'p2', recency: 2 },
            ]),
            drafted('2026-10-11', [
                { roleSlug: 'coffee', slotId: 's1', personId: 'p2', recency: 2 },
            ]),
        ],
    };
    page.buildGrid();

    const fourth = page.grid.roleRows[0].cells[0].places[0];
    const eleventh = page.grid.roleRows[0].cells[1].places[0];
    page.startDrag({}, 'p1', from(fourth), 'grid');

    page.dragOver('k', '2026-10-11', eleventh);
    assert.equal(page.intent, 'displace');

    page.dropOn('2026-10-11', eleventh);
    assert.deepEqual(page.displaced.map(d => d.personId), ['p2']);
});

test('the line that runs out matches how long the hold actually is', () => {
    const html = readPage('auto-assign.html');
    const page = draftedPage();

    const css = /animation: aa-dwell-out (\d+)ms linear/.exec(html);
    assert.ok(css, 'the dwell has a line running out under it');
    assert.equal(Number(css[1]), page.DWELL_MS,
        'a line that finishes early or late is worse than no line');
});

test('the two outcomes are told apart before the card lands, not after', () => {
    const html = readPage('auto-assign.html');

    assert.match(html, /intent === 'swap'[\s\S]{0,200}Trades with/);
    assert.match(html, /intent === 'displace'[\s\S]{0,240}goes to Displaced/);
    assert.match(html, /isSwapOrigin\(cell\.date, place\) && aimCard/,
        'the other half of the trade is drawn where it would land');
});

// ── Measuring the window ────────────────────────────────────────────────────
//
// ⚠ A HIDDEN GRID HAS NO WIDTH. Measured while the setup step is still
// showing, the answer is zero by zero — and the untouched starting value says
// the grid fits entirely. Both symptoms at once: a window stretched across the
// whole strip, and a strip that will not drag.

test('the window is measured once the grid is actually on screen', () => {
    const page = draftedPage();
    page.draft = {
        dates: ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'].map(d => drafted(d)),
    };
    page.buildGrid();

    // What the setup step offers: an element with no size at all.
    let width = 0;
    page.$refs = {
        scroller: {
            scrollLeft: 0, scrollTop: 0,
            get scrollWidth() { return width; },
            get clientWidth() { return width ? 500 : 0; },
        },
    };

    page.measureGrid();
    assert.equal(page.viewWidth, 1, 'nothing measurable, so nothing claimed');
    assert.equal(page.canScrub, false);

    width = 1000;                   // the draft view is up; the grid has width
    page.showDraft();

    assert.equal(page.view, 'draft');
    assert.equal(page.viewWidth, 0.5, 'half the range is visible');
    assert.equal(page.canScrub, true, 'and now the strip is a scrollbar');
});

// It hands the grid 320px or takes it away — most of a column.
test('shutting the directory re-measures the window', () => {
    const page = draftedPage();
    page.draft = { dates: ['2026-10-04', '2026-10-11'].map(d => drafted(d)) };
    page.buildGrid();

    let client = 500;
    page.$refs = {
        scroller: {
            scrollLeft: 0, scrollTop: 0, scrollWidth: 1000,
            get clientWidth() { return client; },
        },
    };
    page.showDraft();
    assert.equal(page.viewWidth, 0.5);

    client = 820;                   // the drawer shut and gave the width back
    page.togglePanel();
    assert.equal(page.viewWidth, 0.82);
});

// ── Dragging to the edge scrolls the grid ───────────────────────────────────

// The grid, and the box you can actually see it through. The scroller hangs
// 18px below the clip so its own scrollbar falls off the bottom.
function draggablePage() {
    const page = draftedPage();
    page.draft = {
        dates: ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'].map(d => drafted(d)),
    };
    page.buildGrid();

    const scroller = {
        scrollLeft: 0, scrollTop: 0, scrollWidth: 1000, clientWidth: 500,
        getBoundingClientRect: () => ({ left: 100, right: 600, top: 200, bottom: 718 }),
    };
    const clip = { getBoundingClientRect: () => ({ left: 100, right: 600, top: 200, bottom: 700 }) };
    // The frozen Role column and date header, over the clip's top-left corner.
    const corner = { getBoundingClientRect: () => ({ left: 100, right: 290, top: 200, bottom: 240 }) };
    page.$refs = { scroller: scroller, clip: clip, corner: corner };
    page.onGridScroll(scroller);
    return { page, scroller };
}

test('carrying a card to the right edge scrolls the grid on', () => {
    const { page, scroller } = draggablePage();
    page.startDrag({}, 'p1', null, 'directory');

    page.edgeScrollAt({ clientX: 595, clientY: 450 });
    page.pullGrid();

    assert.ok(scroller.scrollLeft > 0, 'the far dates come to the card');
    assert.ok(page.viewLeft > 0, 'and the range window keeps up');
});

test('carrying a card to the bottom edge scrolls down to the Roles below', () => {
    const { page, scroller } = draggablePage();
    page.startDrag({}, 'p1', null, 'directory');

    page.edgeScrollAt({ clientX: 350, clientY: 695 });
    page.pullGrid();

    assert.ok(scroller.scrollTop > 0);
    assert.equal(scroller.scrollLeft, 0, 'and only down — the pointer was nowhere near a side');
});

// ⚠ MEASURED OFF THE CLIP, NOT THE SCROLLER. The scroller is deliberately
// taller than what you can see, so its bottom edge sits 18px below the screen
// where the pointer can never reach it.
test('the bottom edge is where the grid stops being visible', () => {
    const { page, scroller } = draggablePage();
    page.startDrag({}, 'p1', null, 'directory');

    // Inside the scroller's own box, below the clip's. Nothing is there.
    page.edgeScrollAt({ clientX: 350, clientY: 710 });
    page.pullGrid();
    assert.equal(scroller.scrollTop, 0, 'measuring the scroller would put the edge off screen');
});

// ⚠ THE LEFT EDGE IS THE ROLE COLUMN'S RIGHT EDGE. The Role names are frozen
// over the left of the grid, so an edge measured at the box would sit
// underneath them: to pull the grid left you would have to hover the one part
// of it that never moves.
test('the left edge is where the Role column ends, not where the grid starts', () => {
    const { page, scroller } = draggablePage();
    page.startDrag({}, 'p1', null, 'directory');
    scroller.scrollLeft = 400;

    page.edgeScrollAt({ clientX: 200, clientY: 450 });   // over the Role names
    page.pullGrid();
    assert.equal(scroller.scrollLeft, 400, 'the frozen column is not an edge');

    page.edgeScrollAt({ clientX: 300, clientY: 450 });   // just past them
    page.pullGrid();
    assert.ok(scroller.scrollLeft < 400, 'the first date comes back');
});

// Same defect on the other axis: the date header is frozen over the top.
test('the top edge is below the date header, not above it', () => {
    const { page, scroller } = draggablePage();
    page.startDrag({}, 'p1', null, 'directory');
    scroller.scrollTop = 300;

    page.edgeScrollAt({ clientX: 400, clientY: 210 });   // over the dates
    page.pullGrid();
    assert.equal(scroller.scrollTop, 300);

    page.edgeScrollAt({ clientX: 400, clientY: 250 });   // just below them
    page.pullGrid();
    assert.ok(scroller.scrollTop < 300);
});

test('nothing scrolls unless a card is actually in hand', () => {
    const { page, scroller } = draggablePage();

    page.edgeScrollAt({ clientX: 595, clientY: 695 });
    assert.equal(page.edgeAim, null, 'a pointer at the edge with nothing in hand is just a pointer');
    page.pullGrid();
    assert.equal(scroller.scrollLeft, 0);
    assert.equal(scroller.scrollTop, 0);
});

// ⚠ THE AIM IS WATCHED AT THE WHOLE DRAFT, NOT AT THE GRID. Watch only the
// grid and the last position it saw sticks: carry a card off the bottom into
// the displaced rail and it scrolls on with nobody asking.
test('carrying a card off the grid stops the pull', () => {
    const { page, scroller } = draggablePage();
    page.startDrag({}, 'p1', null, 'directory');

    page.edgeScrollAt({ clientX: 350, clientY: 695 });
    page.pullGrid();
    const got = scroller.scrollTop;
    assert.ok(got > 0);

    page.edgeScrollAt({ clientX: 350, clientY: 760 });   // down in the displaced rail
    page.pullGrid();
    assert.equal(scroller.scrollTop, got, 'it stopped where it was');
});

test('letting go stops the pull', () => {
    const { page, scroller } = draggablePage();
    page.startDrag({}, 'p1', null, 'directory');
    page.edgeScrollAt({ clientX: 595, clientY: 450 });

    page.endDrag();
    assert.equal(page.edgeAim, null);
    page.pullGrid();
    assert.equal(scroller.scrollLeft, 0);
});

test('the whole draft watches the drag, and the clip is what gets measured', () => {
    const html = readPage('auto-assign.html');

    assert.match(html,
        /x-show="view === 'draft'"[\s\S]{0,200}@dragover="edgeScrollAt\(\$event\)"/,
        'watched at the draft, so the aim is always where the pointer really is');
    assert.match(html, /@dragend="stopEdgeScroll\(\)" @drop="stopEdgeScroll\(\)"/);
    assert.match(html, /aa-scroll-clip[^>]*x-ref="clip"/,
        'the visible box, not the scroller that hangs below it');
});

// ── Folding the liturgy away ────────────────────────────────────────────────

test('the liturgy row folds, and the fold is remembered', () => {
    const box = {};
    const page = draftedPage(null, {
        localStorage: {
            setItem(k, v) { box[k] = v; },
            getItem(k) { return box[k] === undefined ? null : box[k]; },
            removeItem(k) { delete box[k]; },
        },
    });

    assert.equal(page.liturgyOpen, true, 'open until somebody folds it');
    page.toggleLiturgy();
    assert.equal(page.liturgyOpen, false);

    // An editor who folded it away to see the grid does not want it back every
    // time they draft.
    page.liturgyOpen = true;
    page.restoreLiturgyFold();
    assert.equal(page.liturgyOpen, false);
});

// ⚠ FOLDED, NOT HIDDEN. This row is here to explain an absence below it — a
// count would say nothing anybody can act on.
test('a folded liturgy cell still names who is tied up', () => {
    const page = draftedPage();

    assert.equal(page.liturgyLine({ holders: [{ name: 'Sam Crites' }] }), 'Sam Crites');
    assert.equal(
        page.liturgyLine({ holders: [{ name: 'Sam Crites' }, { name: 'Tony Baker Jr.' }] }),
        'Sam Crites, Tony Baker Jr.'
    );
    assert.equal(
        page.liturgyLine({ holders: [
            { name: 'Sam Crites' }, { name: 'Tony Baker Jr.' }, { name: 'Ian Riley' },
        ] }),
        'Sam Crites, Tony Baker Jr. +1',
        'names first, and the overflow counted — never just a number'
    );
    assert.equal(page.liturgyLine({ holders: [] }), '');
});

// ⚠ Both states stay in the DOM. Swapping them with x-if would tear one out
// and drop the other in, and there is nothing to animate between two elements
// that never coexist.
// A date is the unit an editor reads down, and four cards a column with
// nothing between them run together.
// ⚠ Put `max-w-container mx-auto` on the SCROLLING element and its scrollbar is
// drawn at that element's right edge — floating in the middle of a wide
// window with page either side of it.
test('the setup step scrolls at the window edge, and has room at the bottom', () => {
    const html = readPage('auto-assign.html');

    assert.match(html,
        /x-show="view === 'setup'" class="flex-grow min-h-0 overflow-auto w-full">/,
        'the scroller is full width; the centring is a layer in');
    assert.doesNotMatch(html,
        /x-show="view === 'setup'"[^>]*overflow-auto[^>]*max-w-container/,
        'centring the scroller itself is what inset the scrollbar');
    assert.match(html, /max-w-container mx-auto px-4 md:px-margin pt-md pb-20/,
        'and the last card is not flush against the bottom edge');
});

test('the columns are told apart by a rule and a wash, and the two line up', () => {
    const html = readPage('auto-assign.html');

    assert.match(html, /\.aa-cell, \.aa-head \{ border-right/);
    assert.match(html, /\.aa-col-alt \{ background/);
    // The header sets its own background to stay opaque while sticky, so the
    // wash has to beat it — or the column starts halfway down.
    assert.match(html, /\.aa-head\.aa-col-alt \{ background/);

    // Header and body must read the same column index, or the stripes stagger.
    assert.match(html, /:data-col="col\.index"\s*\n\s*:class="col\.index % 2 \? 'aa-col-alt'/);
    assert.match(html, /x-for="\(cell, ci\) in row\.cells"/);
    assert.match(html, /ci % 2 \? 'aa-col-alt'/);
});

test('the fold animates rather than snapping', () => {
    const html = readPage('auto-assign.html');

    assert.match(html, /\.aa-fold \{[\s\S]*?transition: max-height 240ms/,
        'a table cell has no height to animate, so the ceiling is what moves');
    assert.match(html, /\.aa-fold-open \{ max-height: 320px/);
    assert.match(html, /\.aa-chevron \{ transition: transform/, 'the arrow turns, it is not swapped');
    assert.doesNotMatch(html, /x-if="row\.kind === 'liturgy' && liturgyOpen"/,
        'x-if cannot animate — it removes the element');

    // Somebody who asked their computer to stop moving things still gets the
    // fold, just instantly.
    assert.match(html, /prefers-reduced-motion: reduce[\s\S]{0,160}transition: none/);
});

test('a browser that will not remember the fold does not break the page', () => {
    const page = draftedPage(null, {
        localStorage: {
            setItem() { throw new Error('quota'); },
            getItem() { throw new Error('denied'); },
            removeItem() { throw new Error('denied'); },
        },
    });

    assert.doesNotThrow(() => page.restoreLiturgyFold());
    assert.doesNotThrow(() => page.toggleLiturgy());
    assert.equal(page.liturgyOpen, false, 'the fold still works, it just is not kept');
});

// ── The directory drawer ────────────────────────────────────────────────────

test('the directory shuts like a drawer, and stays shut next time', () => {
    const box = {};
    const page = draftedPage(null, {
        localStorage: {
            setItem(k, v) { box[k] = v; },
            getItem(k) { return box[k] === undefined ? null : box[k]; },
            removeItem(k) { delete box[k]; },
        },
    });

    assert.equal(page.panelOpen, true, 'open until somebody shuts it');
    page.togglePanel();
    assert.equal(page.panelOpen, false);

    page.panelOpen = true;
    page.restorePanelDrawer();
    assert.equal(page.panelOpen, false, 'an editor who wanted the width back keeps it');
});

// ⚠ A shut drawer would swallow the answer, and the click would read as
// having done nothing at all.
test('asking why somebody is placed opens the drawer', () => {
    const page = draftedPage();
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 },
        ])],
    };
    page.buildGrid();
    page.panelOpen = false;

    page.selectPlace('2026-10-04', page.grid.roleRows[0].cells[0].places[0]);
    assert.equal(page.panelOpen, true);
});

// Only a deliberate toggle is remembered — otherwise one click on a card would
// quietly overwrite what the editor chose.
test('opening the drawer to explain a placement is not remembered', () => {
    const box = {};
    const page = draftedPage(null, {
        localStorage: {
            setItem(k, v) { box[k] = v; },
            getItem(k) { return box[k] === undefined ? null : box[k]; },
            removeItem(k) { delete box[k]; },
        },
    });
    page.draft = {
        dates: [drafted('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 2 },
        ])],
    };
    page.buildGrid();

    page.togglePanel();
    page.selectPlace('2026-10-04', page.grid.roleRows[0].cells[0].places[0]);
    assert.equal(page.panelOpen, true, 'the answer is visible');

    page.restorePanelDrawer();
    assert.equal(page.panelOpen, false, 'but shut is still what they asked for');
});

test('the drawer slides, and a shut one cannot be tabbed into', () => {
    const html = readPage('auto-assign.html');

    assert.match(html, /\.aa-panel \{[\s\S]*?transition: width 240ms/);
    assert.match(html, /\.aa-panel-shut \{ width: 0; \}/);
    // The content keeps its own width, or the names re-wrap the whole way shut.
    assert.match(html, /\.aa-panel-body \{ width: 320px/);
    // Delayed out so the slide finishes, immediate in.
    assert.match(html, /\.aa-panel-shut \.aa-panel-body \{ visibility: hidden; transition: visibility 0s 240ms/);
    // The way back is where the way out was.
    assert.match(html, /x-show="!panelOpen"[\s\S]{0,300}Directory/);
});

test('a browser that will not remember the drawer does not break the page', () => {
    const page = draftedPage(null, {
        localStorage: {
            setItem() { throw new Error('quota'); },
            getItem() { throw new Error('denied'); },
            removeItem() { throw new Error('denied'); },
        },
    });

    assert.doesNotThrow(() => page.restorePanelDrawer());
    assert.doesNotThrow(() => page.togglePanel());
    assert.equal(page.panelOpen, false, 'the drawer still works, it just is not kept');
});

test('going back to setup drops the grid with the draft', () => {
    const page = draftedPage();
    page.draft = { dates: [drafted('2026-10-04')] };
    page.buildGrid();
    assert.ok(page.grid);

    page.backToSetup();
    assert.equal(page.grid, null);
    assert.equal(page.draft, null);
    assert.equal(page.view, 'setup');
});

test('the liturgical Roles are never drafted as fillable places', () => {
    const Roles = require('../public/roles-core.js');
    const page = loadComponent('auto-assign.js', 'autoAssignPage');

    const preacher = Roles.LITURGICAL_SLUGS[0];
    page.series = [{ id: 'sunday_service', name: 'Sunday Service', roleSlugs: [preacher, 'coffee'] }];
    page.seriesId = 'sunday_service';
    page.roleDefinitions = [{ slug: 'coffee', name: 'Coffee', slots: [{ id: 's1' }] }];

    assert.deepEqual(page.draftableRoles.map(r => r.slug), ['coffee'],
        'liturgy is fields on the Service that the printed booklet reads (ADR-0018 §2)');
});

// ── Emptying the ticked dates ─────────────────────────────────────────────────
//
// The one write on a screen that is otherwise deliberately read-only, and it
// sits an inch from the button that opens the draft room. Everything below is
// about the two of them not being mistaken for each other.

function recurringPageWith(occurrences, overrides) {
    const calls = [];
    const Store = Object.assign({}, require('../public/events-store.js'), {
        async clearRosters(db, seriesId, dates) {
            calls.push({ seriesId: seriesId, dates: dates });
            dates.forEach(d => { delete occurrences[d]; });
            return { dates: dates, assignments: 0 };
        },
        async loadSeriesWindow() { return occurrences; },
    });

    const page = loadComponent('recurring-events.js', 'recurringEventsPage', Object.assign({
        EventsStore: Store,
        DateUtils: Object.assign({}, require('../public/date-utils.js'), {
            todayStr: () => '2026-08-01',
        }),
        confirm: () => true,
    }, overrides || {}));

    page.seriesId = 'sunday_service';
    page.rank = 'editor';
    page.allDates = ['2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30'];
    page.anchor = '2026-08-09';
    page.occurrences = occurrences;
    page._calls = calls;
    return page;
}

const ROSTERED_WINDOW = () => ({
    '2026-08-09': { assignments: [
        { roleSlug: 'coffee', slotId: 's1', personId: 'p1', state: 'confirmed' },
        { roleSlug: 'setup', slotId: 's1', personId: 'p2', state: 'pending' },
    ] },
    '2026-08-16': { assignments: [
        { roleSlug: 'coffee', slotId: 's1', personId: 'p1', state: 'pending' },
    ] },
    '2026-08-30': { assignments: [
        { roleSlug: 'coffee', slotId: 's1', personId: 'p3', state: 'pending' },
    ] },
});

test('emptying the ticked dates writes to those dates and no others', () => {
    // The button beside it sweeps the dates in between. This one must not, and
    // an editor an inch away from the wrong one has only the words to go on.
    const page = recurringPageWith(ROSTERED_WINDOW());
    page.selected = ['2026-08-09', '2026-08-30'];

    assert.strictEqual(page.draftLabel, 'Auto-assign 4 dates', 'the sweep this is contrasted with is gone');
    assert.strictEqual(page.canWipe, true);

    return page.takeEverybodyOff().then(() => {
        assert.strictEqual(page._calls.length, 1);
        assert.strictEqual(page._calls[0].seriesId, 'sunday_service');
        assert.strictEqual(page._calls[0].dates.join(), '2026-08-09,2026-08-30');
        assert.strictEqual(page.selected.length, 0, 'left the ticks armed over dates that are now blank');
    });
});

test('the two buttons cannot both be called clearing', () => {
    // "Clear" unticks. The other one deletes a rota. They sit an inch apart on
    // one row, and sharing a word is how an editor loses eight Sundays reaching
    // for the tick.
    const html = readPage('recurring-events.html');
    const from = html.indexOf('clearSelection()');
    const panel = html.slice(from, html.indexOf('</div>', html.indexOf('takeEverybodyOff()', from)));

    assert.notStrictEqual(html.indexOf('takeEverybodyOff()'), -1, 'no way to empty the ticked dates');
    assert.strictEqual((panel.match(/>Clear</g) || []).length, 1,
        'two controls on the same row both read as clearing');

    // The label comes from the component, so the two places this button could
    // be drawn cannot word it differently — and so this assertion holds
    // wherever it is drawn.
    assert.match(panel, /x-text="wipeLabel"/, 'the emptying button hardcodes its own words');

    const page = loadComponent('recurring-events.js', 'recurringEventsPage');
    assert.doesNotMatch(page.wipeLabel, /clear/i, 'the emptying button borrows the unticking button\'s word');
    assert.match(page.wipeLabel, /off/, 'the emptying button does not say what it does');
});

test('a yes about to be un-said is put in the question, not discovered after', () => {
    const page = recurringPageWith(ROSTERED_WINDOW());
    page.selected = ['2026-08-09'];

    const asked = page.wipeQuestion;
    assert.match(asked, /2 people/, 'did not say how many people come off');
    assert.match(asked, /9 August/, 'did not name the date');
    assert.match(asked, /already said yes/, 'a confirmed person was taken off in silence');
    assert.match(asked, /cannot be undone/);
});

test('saying no to the question leaves the rota exactly where it was', () => {
    const page = recurringPageWith(ROSTERED_WINDOW(), { confirm: () => false });
    page.selected = ['2026-08-09'];

    return page.takeEverybodyOff().then(() => {
        assert.strictEqual(page._calls.length, 0, 'emptied the dates anyway');
        assert.strictEqual(page.selected.join(), '2026-08-09', 'threw away the ticks it did not act on');
    });
});

test('the past is not emptied, and the button says so rather than sitting dead', () => {
    const page = recurringPageWith(ROSTERED_WINDOW(), {
        DateUtils: Object.assign({}, require('../public/date-utils.js'), {
            todayStr: () => '2026-08-20',
        }),
    });
    page.selected = ['2026-08-09', '2026-08-16'];

    assert.strictEqual(page.canWipe, false);
    assert.match(page.wipeNote, /record of who served/, 'a dead button with no explanation on it');

    // Mixed: the reachable date goes, the past ones are named in the question.
    page.selected = ['2026-08-09', '2026-08-30'];
    assert.strictEqual(page.canWipe, true);
    assert.match(page.wipeQuestion, /left alone/, 'took a past date without saying so');

    return page.takeEverybodyOff().then(() => {
        assert.strictEqual(page._calls[0].dates.join(), '2026-08-30', 'rewrote history');
    });
});

test('ticking dates nobody is on offers nothing to do, and says which', () => {
    const page = recurringPageWith(ROSTERED_WINDOW());
    page.selected = ['2026-08-23'];

    assert.strictEqual(page.canWipe, false);
    assert.strictEqual(page.wipeNote, 'There is nobody on the dates you ticked.');
});

test('the note speaks only when the button will do less than the ticks say', () => {
    // A line repeating the count an inch to its left is noise, and noise is what
    // an editor learns to read past on the day it matters.
    const page = recurringPageWith(ROSTERED_WINDOW());

    page.selected = ['2026-08-09', '2026-08-16'];
    assert.strictEqual(page.wipeNote, '', 'said again what the panel already says');

    page.selected = ['2026-08-09', '2026-08-23'];
    assert.match(page.wipeNote, /would empty 1 date/, 'silently did less than was ticked');
    assert.match(page.wipeNote, /nobody on the other one/);
});

test('a failed emptying reloads the grid instead of claiming nothing happened', async () => {
    // The write goes date by date, so a failure half way through has really
    // emptied half. Saying "that did not work" would be a lie about the ones
    // that did.
    const occurrences = ROSTERED_WINDOW();
    let reloaded = 0;

    const Store = require('../public/events-store.js');
    const original = Store.clearRosters;
    const failing = Object.assign({}, Store, {
        async clearRosters() { throw new Error('permission-denied'); },
        async loadSeriesWindow() { reloaded++; return occurrences; },
    });

    const failed = loadComponent('recurring-events.js', 'recurringEventsPage', {
        EventsStore: failing,
        DateUtils: Object.assign({}, require('../public/date-utils.js'), { todayStr: () => '2026-08-01' }),
        confirm: () => true,
    });
    failed.seriesId = 'sunday_service';
    failed.allDates = ['2026-08-09'];
    failed.anchor = '2026-08-09';
    failed.occurrences = occurrences;
    failed.selected = ['2026-08-09'];

    await failed.takeEverybodyOff();

    assert.match(failed.error, /what is really stored/, 'claimed a clean failure it cannot know it had');
    assert.strictEqual(reloaded, 1, 'left the grid showing a rota that may already be gone');
    assert.strictEqual(failed.clearing, false, 'the button is stuck spinning');
    assert.strictEqual(Store.clearRosters, original, 'the real store was mutated by a test');
});

// ── The desktop's months, on a rail ───────────────────────────────────────────
//
// Paging used to swap the two months on show for two others. It now slides
// along a rail of months that are all already drawn — which is the only reason
// there is anything to slide. Everything below is about the rail staying honest
// about which months those are.

function railPage(overrides) {
    const page = loadComponent('away.js', 'awayPage', Object.assign({
        DateUtils: Object.assign({}, require('../public/date-utils.js'), {
            todayStr: () => '2026-08-04',
        }),
    }, overrides || {}));

    // Alpine's, in the browser. The rail is measured off the DOM, so a test
    // without one drives everything up to the scroll and stops there.
    const scrolled = [];
    page.$nextTick = fn => fn();
    page.$refs = {};   // no DOM, so `slide` measures nothing and stops
    page._scrolled = scrolled;
    page.anchor = { year: 2026, monthIndex: 7 };
    page.loadPlaces = async () => {};
    return page;
}

test('the rail starts on this month and has every month after it already drawn', () => {
    // Drawn, not fetched on arrival: a month that is not in the DOM cannot be
    // scrolled to, so the rail being ahead of the window is the whole trick.
    const page = railPage();

    assert.strictEqual(page.railMonths.length, 12);
    assert.strictEqual(page.railMonths[0].label, 'August 2026');
    assert.strictEqual(page.railIndex, 0, 'the window did not start at the near end');
    assert.strictEqual(page.onRail(0), true);
    assert.strictEqual(page.onRail(1), true, 'the second month on show is not on show');
    assert.strictEqual(page.onRail(2), false, 'a month off screen is reachable by keyboard');
});

test('the rail does not run back past this month', () => {
    // Away is a thing you say BEFORE (ADR-0023 §4), so a month that has been
    // holds nothing left to choose. It is also what keeps the scroll honest:
    // the rail only ever grows forwards, and appending cannot shift what is
    // already on screen.
    const page = railPage();

    assert.strictEqual(page.canGoBack, false, 'the back arrow is live with nothing behind it');
    return page.prevMonths().then(() => {
        assert.strictEqual(page.anchor.monthIndex, 7, 'paged back into a month that has been');
        assert.strictEqual(page.railMonths[0].label, 'August 2026', 'the rail grew backwards');
    });
});

test('paging forward moves the window along the rail, not the rail past the window', async () => {
    const page = railPage();

    await page.nextMonths();
    assert.strictEqual(page.railIndex, 1);
    assert.strictEqual(page.canGoBack, true);
    assert.strictEqual(page.railMonths[0].label, 'August 2026', 'the months already drawn were rebuilt');
    assert.strictEqual(page.onRail(0), false, 'the month scrolled past is still in the tab order');
    assert.strictEqual(page.onRail(1), true);

    await page.prevMonths();
    assert.strictEqual(page.railIndex, 0, 'going back did not undo going forward');
});

test('the rail grows before the window reaches its end, never after', async () => {
    // The month being slid to has to be in the DOM already — scrolling to
    // something that is not there yet is a jump, which is the thing this
    // replaced.
    const page = railPage();

    for (let i = 0; i < 10; i++) await page.nextMonths();

    assert.strictEqual(page.railIndex, 10);
    assert.ok(page.railMonths.length >= 12, 'the rail shrank');
    assert.ok(page.railMonths.length > page.railIndex + 1,
        'the window ran off the end of the rail it is supposed to slide along');
    assert.strictEqual(page.railMonths[page.railIndex].label, 'June 2027',
        'the rail and the window disagree about which month is on screen');
});

test('a clash is measured against the whole rail, not the pair on show', async () => {
    // Every month on the rail is drawn, so a serving dot that only appeared
    // once you scrolled to it would be a dot you could not plan around.
    const page = railPage();

    assert.strictEqual(page.lastMonth.year, 2027);
    assert.strictEqual(page.lastMonth.monthIndex, 6, 'the rail reaches further than the places read for it');

    await page.nextMonths();
    assert.strictEqual(page.lastMonth.monthIndex, 6, 'paging moved the reach, which is the rail\'s job');
});

test('the phone rides the same rail, one month wide', () => {
    // Two layouts, one state, ONE rail. The phone used to run four months on in
    // a vertical scroll of its own; it now pages the way the desktop pages, so
    // everything below this line is shared and there is no second notion of
    // which month you are looking at.
    const page = railPage({ MOSAIC_SHELL: 'mobile' });
    page.phone = true;

    assert.strictEqual(page.monthsShown, 1, 'the phone shows more than one month');
    assert.strictEqual(page.railMonths.length, 12, 'the phone has no rail to slide');
    assert.strictEqual(page.onRail(0), true);
    assert.strictEqual(page.onRail(1), false, 'a phone shows two months at once');

    // The reach is the rail's, not the window's — same as the desktop.
    assert.strictEqual(page.lastMonth.year, 2027);
    assert.strictEqual(page.lastMonth.monthIndex, 6);

    return page.nextMonths().then(() => {
        assert.strictEqual(page.railIndex, 1);
        assert.strictEqual(page.onRail(1), true, 'paging did not move what the phone is looking at');
    });
});

test('a swipe across the rail turns the page the way paper would', () => {
    const page = railPage();
    const drag = (dx, dy) => {
        page.swipeFrom({ changedTouches: [{ clientX: 200, clientY: 300 }] });
        page.swipeTo({ changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
    };

    // Dragged LEFT, the months come from the right.
    drag(-90, 4);
    assert.strictEqual(page.railIndex, 1, 'swiping left did not move forward');
    drag(90, -4);
    assert.strictEqual(page.railIndex, 0, 'swiping right did not come back');

    // Nothing behind this month, so a swipe cannot go there either.
    drag(90, 0);
    assert.strictEqual(page.railIndex, 0, 'a swipe walked back past this month');
});

test('a scroll is not a swipe, and a nudge is not either', () => {
    // The gesture is read on release with nothing prevented, so a finger moving
    // down the page must not also turn the calendar — and a thumb resting on a
    // day must not turn it by a pixel.
    const page = railPage();
    const drag = (dx, dy) => {
        page.swipeFrom({ changedTouches: [{ clientX: 200, clientY: 300 }] });
        page.swipeTo({ changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
    };

    drag(-20, 0);
    assert.strictEqual(page.railIndex, 0, 'a nudge shorter than a tap\'s slop turned the page');

    drag(-60, 200);
    assert.strictEqual(page.railIndex, 0, 'scrolling down the page turned the calendar sideways');

    // A touch that never started here (the finger came from somewhere else)
    // is not a swipe at all.
    page.swipe = null;
    page.swipeTo({ changedTouches: [{ clientX: 40, clientY: 300 }] });
    assert.strictEqual(page.railIndex, 0, 'a release with no matching press turned the page');
});

test('the rail is scrolled to, rather than having its months swapped', () => {
    // The markup half of the same promise. If the window were two slots whose
    // contents got replaced there would be nothing continuous to move, and no
    // amount of easing would make it slide.
    const html = readPage('away.html');

    assert.match(html, /x-ref="rail"/, 'nothing for the component to scroll');
    assert.match(html, /x-for="\(m, i\) in railMonths"/, 'the desktop still draws only the pair on show');
    assert.match(html, /:inert="!onRail\(i\)"/, 'every month on the rail is in the tab order');
    assert.match(html, /aw-rail-track/, 'the months are not laid out in one row');

    assert.match(html, /:style="railStyle"/, 'nothing moves the rail');

    // ⚠ ONE RAIL AT A TIME. Both layouts carry one and both name it `rail`, so
    // if the idle layout were merely hidden rather than absent, `$refs.rail`
    // could resolve to it — and inside a display:none block every offset reads
    // zero, so the calendar would silently stop sliding.
    assert.strictEqual((html.match(/x-ref="rail"/g) || []).length, 2,
        'the two layouts no longer carry one rail each');
    [/x-if="!loading && personId && !phone"/, /x-if="!loading && personId && phone"/].forEach(re => {
        assert.match(html, re, 'a layout block is shown rather than built, so both rails exist at once');
    });

    // The phone's calendar is swipeable; the desktop's has a mouse.
    assert.match(html, /@touchstart="swipeFrom\(\$event\)"/, 'the phone calendar cannot be swiped');
    assert.match(html, /touch-action:\s*pan-y/,
        'the rail takes vertical gestures too, so the page cannot be scrolled past it');
    assert.match(html, /prefers-reduced-motion[\s\S]{0,120}aw-rail-track/,
        'the slide is imposed on somebody who asked for less movement');
});

test('the phone\'s action row is allowed to wrap, however many actions it grows', () => {
    // HOW THIS BROKE. The rule was written when there were two of these and it
    // told them to share the width equally — `flex: 1 1 0`. A flex item will not
    // shrink below its own label, so when Away made a third, it did not squeeze:
    // it hung off the right edge of the phone, and "New event" was unreachable.
    //
    // A count baked into a layout rule is a trap for whoever adds the next
    // button, so the row now wraps and each action asks for half a line. Two sit
    // side by side, a third drops to its own full-width row, and a member who
    // only sees Away gets one button the width of the screen — with no number
    // written down anywhere.
    //
    // This can only read the rule, not lay it out. What it defends is the shape
    // of the rule: that nothing here assumes how many actions there are.
    const html = readPage('calendar.html');
    const rule = html.slice(html.indexOf('html.shell-mobile .cal-title-actions'),
        html.indexOf('}', html.indexOf('html.shell-mobile .cal-title-actions > a')) + 1);

    assert.match(rule, /flex-wrap:\s*wrap/, 'the phone\'s actions cannot wrap, so a third one overflows');
    assert.doesNotMatch(rule, /flex:\s*1 1 0/,
        'the actions are told to share one line equally, which they cannot do below their own labels');
    assert.match(rule, /flex:\s*1 1 calc\(50%/, 'no basis to wrap on');

    // Every action in the row is an <a> — the rule selects on that, so a button
    // added as a <button> would silently sit outside the layout it belongs to.
    const row = html.slice(html.indexOf('cal-title-actions'), html.indexOf('<!-- Signed out'));
    const controls = row.match(/<(a|button)\b/g) || [];
    assert.ok(controls.length >= 3, 'the row this test is about is not there any more');
    assert.deepStrictEqual([...new Set(controls)], ['<a'],
        'an action in this row is not an <a>, so the phone\'s layout rule does not reach it');
});

test('the phone gets the calendar, not three lines about it first', () => {
    // The standfirst was the only thing between the shell's header and the one
    // thing the screen is for. It is not deleted — a desktop has room for it,
    // and it is the sentence that says nobody has to approve any of this — but
    // on a phone the shell already writes "Away" above it and "Worth knowing"
    // repeats the lock chip word for word further down.
    const html = readPage('away.html');

    assert.match(html, /x-text="intro"/, 'the desktop lost the sentence that says nobody approves this');
    assert.match(html, /html\.shell-mobile \.aw-title-block \{ display: none/,
        'a phone still reads a standfirst before it can reach the calendar');
    assert.match(html, /class="aw-title-block/, 'nothing carries the class the rule selects on');
});

test('every rule in the Away stylesheet actually closes its comment', () => {
    // HOW THIS BROKE. A comment gained a paragraph and the `*/` ended up in the
    // middle of it, so everything after — including `overflow: hidden` on the
    // rail — was silently dropped. The page still rendered; it just stopped
    // clipping, and twelve months of calendar hung off the side of the phone.
    // Nothing else here can see a stylesheet, so nothing else could catch it.
    const html = readPage('away.html');
    const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));

    let depth = 0;
    for (let i = 0; i < css.length - 1; i++) {
        if (css.startsWith('/*', i)) { depth++; i++; }
        else if (css.startsWith('*/', i)) { depth--; i++; }
        assert.ok(depth === 0 || depth === 1,
            'a comment closes twice or nests, around character ' + i);
    }
    assert.strictEqual(depth, 0, 'a comment is left open, so the rules after it never load');

    // And the rule that broke, specifically.
    assert.match(css, /\.aw-rail \{[^}]*overflow:\s*hidden/,
        'the rail does not clip, so the whole year of months shows');
});

test('the pinned tray carries its own safe-area inset', () => {
    // ⚠ A `position: fixed` box is laid against the VIEWPORT, so the body
    // padding mobile-shell.css uses to keep content clear of the home indicator
    // never reaches it. The tray had a flat 24px standing in for that — too
    // little on a phone that has an indicator, and 24px of nothing on every
    // phone and browser that does not. It now asks the device.
    const html = readPage('away.html');
    const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));

    assert.match(css, /\.aw-tray \{[^}]*env\(safe-area-inset-bottom/,
        'the tray does not ask the device where the home indicator is');
    assert.match(html, /class="aw-tray fixed/, 'nothing carries the class the rule selects on');
    assert.doesNotMatch(html, /class="aw-tray fixed[^"]*\bpb-\d/,
        'a flat bottom padding is fighting the safe-area inset');

    // The scroll above it clears two different trays, because a clash adds a
    // whole panel to it. One number would either hide the last card behind the
    // warning or leave a hole under it.
    assert.match(html, /hasClash \? 'aw-tray-clearance-clash' : 'aw-tray-clearance'/,
        'the scroll clears one size of tray but the tray has two');
    ['aw-tray-clearance', 'aw-tray-clearance-clash'].forEach(name => {
        assert.match(css, new RegExp('\\.' + name + ' \\{[^}]*padding-bottom'),
            name + ' is used but never defined, so the tray covers the last card');
    });
});

// ── The Calendar's months, on a rail ──────────────────────────────────────────
//
// The same rail the Away screen runs on, and the same reason: paging used to
// swap one grid for another, so somebody reading across a month boundary lost
// what they had just been looking at. The difference here is that a month has
// EVENTS in it, which have to be fetched — so the rail's real cost is the load,
// and everything below is about that load covering what the rail draws.

function railedCalendar(rows) {
    const asked = [];
    const page = withAlpine(loadComponent('calendar.js', 'calendarPage', {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            async loadCalendar(db, opts) { asked.push(opts); return rows || []; },
        }),
    }));
    page.personId = 'p1';
    page.today = '2026-08-05';
    page.month = '2026-08';
    page.railAnchor = '2026-06';
    page._asked = asked;
    return page;
}

test('the rail draws five months, with the one on screen in the middle', () => {
    const page = railedCalendar();

    assert.strictEqual(page.railMonths.map(m => m.month).join(),
        '2026-06,2026-07,2026-08,2026-09,2026-10');
    assert.strictEqual(page.railIndex, 2);
    assert.strictEqual(page.railMonths[2].label, 'August 2026');

    // Every month drawn has a grid of its own — that is what there is to slide.
    page.railMonths.forEach(m => {
        assert.ok(m.cells.length >= 35, m.month + ' was drawn without its days');
    });
});

test('every month on the rail is drawn, and only the one on screen is reachable', () => {
    // Five months of days are in the DOM. Without `inert` a keyboard would tab
    // through four months nobody can see.
    const page = railedCalendar();
    assert.strictEqual([0, 1, 2, 3, 4].map(i => page.onRail(i)).join(),
        'false,false,true,false,false');

    const html = readPage('calendar.html');
    assert.strictEqual((html.match(/:inert="!onRail\(i\)"/g) || []).length, 2,
        'a layout draws the rail without making the months off it inert');
});

test('the load covers the whole rail, not just the month on screen', async () => {
    // A month you can slide to but cannot see the contents of is the swap this
    // replaced, one frame later.
    const page = railedCalendar();
    await page.load();

    assert.deepStrictEqual({ from: page._asked[0].from, to: page._asked[0].to },
        { from: '2026-06-01', to: '2026-10-31' });
});

test('paging inside the rail slides without going back to the database', async () => {
    // The second thing the rail bought, after the animation. Five months are in
    // hand, so most presses cost nothing at all.
    const page = railedCalendar();
    await page.load();
    const reads = page._asked.length;

    await page.nextMonth();
    assert.strictEqual(page.month, '2026-09');
    assert.strictEqual(page.railIndex, 3, 'the window did not move along the rail');
    assert.strictEqual(page._asked.length, reads, 'a month already in hand was fetched again');

    await page.prevMonth();
    await page.prevMonth();
    assert.strictEqual(page.month, '2026-07');
    assert.strictEqual(page.railIndex, 1);
    assert.strictEqual(page._asked.length, reads, 'going back re-read months already drawn');
});

test('the rail re-centres before it runs out, and reads only what it grew into', async () => {
    // ⚠ RE-CENTRING KEEPS ONE MONTH SPARE ON THE SIDE BEING HEADED FOR, so the
    // month slid to is always already drawn and already loaded. Landing on the
    // last month of the rail and re-centring afterwards would mean sliding onto
    // an empty grid.
    const page = railedCalendar();
    await page.load();

    await page.nextMonth();   // 09, index 3
    await page.nextMonth();   // would be index 4 — re-centres first
    assert.strictEqual(page.month, '2026-10');
    assert.strictEqual(page.railIndex, 2, 'the month on screen is not back in the middle');
    assert.strictEqual(page.railMonths.map(m => m.month).join(),
        '2026-08,2026-09,2026-10,2026-11,2026-12');
    assert.deepStrictEqual({ from: page._asked[1].from, to: page._asked[1].to },
        { from: '2026-08-01', to: '2026-12-31' });
});

test('the way back appears once there is somewhere to come back from', () => {
    const page = railedCalendar();          // today is 2026-08-05, month is 2026-08

    assert.strictEqual(page.awayFromToday, false, 'a way back was offered from where it leads');
    page.month = '2026-09';
    assert.strictEqual(page.awayFromToday, true);
    page.month = '2026-07';
    assert.strictEqual(page.awayFromToday, true, 'the past is somewhere to come back from too');
});

test('both layouts carry a way back to today, and the phone hides its when it would do nothing', () => {
    // ⚠ THE PHONE ROW IS THE CONSTRAINT. Two arrows, the month's name and the
    // view toggle already fill it; a fourth control that sits there doing
    // nothing most of the time is what made the row cramped before. So the
    // desktop, which has the room, greys its out and the phone drops its.
    const html = readPage('calendar.html');
    // The phone BLOCK, not the rule that hides it — the class name appears in
    // the stylesheet at the top of the file, long before either toolbar.
    const phoneAt = html.indexOf('class="cal-phone-only mt-md');
    const backs = [...html.matchAll(/goToToday\(\)/g)].map(m => m.index);

    assert.strictEqual(backs.length, 2, 'a layout is without a way back to today');
    assert.ok(backs[0] < phoneAt, 'the desktop toolbar has no way back');
    assert.ok(backs[1] > phoneAt, 'the phone row has no way back');

    // Each is gated on the getter, so neither can be pressed to no effect.
    const desktop = html.slice(backs[0] - 400, backs[0] + 400);
    const phone = html.slice(backs[1] - 400, backs[1] + 400);
    assert.ok(/:disabled="!awayFromToday"/.test(desktop),
        'the desktop way back stays live on the month it goes to');
    assert.ok(/x-show="awayFromToday"/.test(phone),
        'the phone way back sits on the row when it has nothing to do');

    // Icon-only, so it needs a name of its own.
    assert.ok(/aria-label="Back to today"/.test(phone), 'the phone way back is an unlabelled glyph');
});

test('opening the page puts the rail on this month, not on the first one drawn', async () => {
    // ⚠ THE RAIL DOES NOT START WHERE IT LOOKS LIKE IT SHOULD. This month is the
    // third of the five, so a rail left where it was built shows the month two
    // back — and the heading, the list and the "you" block all still say this
    // one. August written over a grid of June, with nothing to contradict it.
    const months = Array.from({ length: 5 }, (_, i) => ({ offsetLeft: i * 400 }));
    const page = withAlpine(loadComponent('calendar.js', 'calendarPage', {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            async loadCalendar() { return []; },
            async loadVisibleSeries() { return []; },
        }),
        auth: { onAuthStateChanged(cb) { cb({ uid: 'u1' }); } },
        getUserData: async () => ({ personId: 'p1', permissionLevel: 'editor' }),
    }));
    page.$refs.monthRailWide = {
        offsetParent: {}, offsetWidth: 400, querySelectorAll: () => months,
    };
    page.month = '2026-08';

    await page.init();

    assert.strictEqual(page.railIndex, 2);
    assert.strictEqual(page.railShift, 800, 'the calendar opened on a month it was not showing');
    assert.strictEqual(page.railSnap, false, 'the easing was left off');
});

test('the easing stays off until the browser has actually drawn the re-anchoring', async () => {
    // ⚠ THE BUG THIS EXISTS FOR: re-centring turned the easing off and straight
    // back on again inside microtasks. The browser only decides what to animate
    // when it comes to draw, and by then the class had been and gone — so it
    // eased the SUM of the re-anchor and the step. That sum points backwards,
    // and the rail slid the wrong way on every other press.
    //
    // A frame callback runs BEFORE its frame is drawn, so one is not enough.
    const frames = [];
    const page = withAlpine(loadComponent('calendar.js', 'calendarPage', {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            async loadCalendar() { return []; },
        }),
        requestAnimationFrame: fn => frames.push(fn),
    }));
    page.month = '2026-08';
    page.railAnchor = '2026-06';

    const done = page.recentreRail('2026-10');
    assert.strictEqual(page.railSnap, true, 'the easing was never turned off');
    assert.strictEqual(frames.length, 1, 'the release did not wait for a frame at all');

    frames.shift()();
    assert.strictEqual(page.railSnap, true,
        'the easing came back on inside the frame, before it was drawn');
    assert.strictEqual(frames.length, 1, 'the release waited for only one frame');

    frames.shift()();
    await done;
    assert.strictEqual(page.railSnap, false, 'the easing never came back');
});

test('a month too far to slide to is landed on, not slid to', async () => {
    // "Today" from six months away, or a date typed into the address bar. There
    // is nothing between here and there to slide past, so it rebuilds around
    // the target rather than animating through half a year.
    const page = railedCalendar();
    await page.load();

    await page.goToMonth('2027-03');

    assert.strictEqual(page.month, '2027-03');
    assert.strictEqual(page.railIndex, 2, 'a jump left the rail pointing somewhere else');
    assert.strictEqual(page.railMonths[2].month, '2027-03');
    assert.deepStrictEqual({ from: page._asked[1].from, to: page._asked[1].to },
        { from: '2027-01-01', to: '2027-05-31' });
});

test('the list and the "you" block still mean the month on screen, not the rail', async () => {
    // ⚠ THE ONE THING THE RAIL LOAD COULD HAVE BROKEN. `occurrences` holds five
    // months now, so anything meaning "this month" has to say so — or the list
    // shows five of them and "You in August" answers for the summer.
    const page = railedCalendar([
        { id: 'jul', date: '2026-07-12', name: 'Sunday Service', seriesId: 'sunday_service',
          assignments: [{ personId: 'p1', roleSlug: 'coffee', slotId: 's1', state: 'pending', label: 'Coffee' }] },
        { id: 'aug', date: '2026-08-09', name: 'Sunday Service', seriesId: 'sunday_service',
          assignments: [{ personId: 'p1', roleSlug: 'coffee', slotId: 's1', state: 'pending', label: 'Coffee' }] },
        { id: 'sep', date: '2026-09-06', name: 'Sunday Service', seriesId: 'sunday_service', assignments: [] },
    ]);
    await page.load();

    assert.strictEqual(page.occurrences.length, 3, 'the rail load did not bring the neighbours');
    assert.strictEqual(page.monthRows.map(o => o.id).join(), 'aug',
        'the month on screen took in its neighbours');
    assert.strictEqual(page.groups.flatMap(g => g.events.map(e => e.id)).join(), 'aug',
        'the list is showing five months');
    assert.strictEqual(page.myCommitments.map(c => c.date).join(), '2026-08-09',
        '"You in August" answered for July as well');
    assert.strictEqual(page.seriesFilters.map(f => f.count).join(), '1',
        'the Show filters counted months nobody is looking at');

    // But the GRIDS are built from everything, so a month waiting off to the
    // side already has its dots before you reach it.
    assert.ok(page.railMonths[1].cells.some(c => c.date === '2026-07-12' && c.events.length),
        'the month next door slides in empty and fills afterwards');
});

test('a swipe across the calendar turns the month the way paper would', async () => {
    const page = railedCalendar();
    await page.load();
    const drag = (dx, dy) => page.swipeFrom({ changedTouches: [{ clientX: 200, clientY: 300 }] })
        || page.swipeTo({ changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });

    await drag(-90, 4);
    assert.strictEqual(page.month, '2026-09', 'swiping left did not go forward');
    await drag(90, -4);
    assert.strictEqual(page.month, '2026-08', 'swiping right did not come back');

    // A scroll is not a swipe, and a nudge is not either.
    await drag(-20, 0);
    assert.strictEqual(page.month, '2026-08', 'a nudge inside the tap slop turned the month');
    await drag(-60, 200);
    assert.strictEqual(page.month, '2026-08', 'scrolling the page turned the month sideways');

    // A release with no matching press is not a gesture at all.
    page.swipe = null;
    await page.swipeTo({ changedTouches: [{ clientX: 40, clientY: 300 }] });
    assert.strictEqual(page.month, '2026-08');
});

test('the rail is slid by transform, and the phone can swipe it', () => {
    const html = readPage('calendar.html');

    assert.strictEqual((html.match(/x-ref="monthRail(Wide)?"/g) || []).length, 2,
        'the two layouts no longer carry one rail each');
    assert.strictEqual((html.match(/:style="railStyle"/g) || []).length, 2);
    assert.match(html, /@touchstart="swipeFrom\(\$event\)"/, 'the calendar cannot be swiped');

    const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
    assert.match(css, /\.cal-rail-months \{[^}]*overflow:\s*hidden/, 'the rail does not clip');
    assert.match(css, /\.cal-rail-months \{[^}]*touch-action:\s*pan-y/,
        'the rail takes vertical gestures, so the page cannot be scrolled past it');
    assert.match(css, /\.cal-rail-track \{[^}]*transition:\s*transform/, 'nothing eases the slide');
    assert.match(css, /cal-rail-snap \{ transition: none/,
        're-anchoring the rail glides sideways for no reason');
    assert.match(css, /prefers-reduced-motion[\s\S]{0,120}cal-rail-track/,
        'the slide is imposed on somebody who asked for less movement');
});

test('the rail is gated from a wrapper, and the two layouts do not share a ref', () => {
    // ⚠ TWO BUGS THE TESTS COULD NOT SEE, both found by opening the page.
    //
    // ONE REF, TWO RAILS. Both layouts carry a rail and both are always in the
    // DOM — they are swapped by a CSS class, not by `x-if`. Sharing a ref name
    // meant `$refs` kept whichever registered last, which was the desktop's,
    // and inside a display:none block every offset reads zero. The rail simply
    // never moved, silently.
    //
    // AND THE GATE GOES ON A WRAPPER. With `x-show="view === 'month'"` on the
    // rail element itself the directive stopped re-evaluating after the first
    // render — the strip was hidden at load (a phone starts on the list) and
    // never came back when you switched to Month, while every other binding on
    // the page kept reacting.
    const html = readPage('calendar.html');

    assert.match(html, /x-ref="monthRail"/, 'the phone rail lost its ref');
    assert.match(html, /x-ref="monthRailWide"/, 'the desktop rail lost its ref');
    assert.strictEqual((html.match(/x-ref="monthRail"/g) || []).length, 1,
        'both layouts answer to one ref again, so the slide measures the hidden one');

    const railTag = html.slice(html.indexOf('<div class="cal-rail-months" x-ref="monthRail"'),
        html.indexOf('>', html.indexOf('<div class="cal-rail-months" x-ref="monthRail"')));
    assert.doesNotMatch(railTag, /x-show/,
        'the gate is back on the rail element, where it stops re-evaluating');

    const page = loadComponent('calendar.js', 'calendarPage');
    assert.ok('rail' in page, 'nothing picks which of the two rails is the live one');
});

test('paging never blanks the calendar to fetch months nobody is looking at', () => {
    // REPORTED FROM THE PREVIEW: "every two slides it still does a hard
    // reload". Every other press re-centres the rail and reads the months it
    // has just grown into — and `load` set `loading`, which hides the whole
    // page behind a spinner. So the calendar vanished mid-slide and came back,
    // which is exactly what a page reloading itself looks like.
    //
    // The read is real and still happens. It just says nothing, because what is
    // on screen was already in hand before the press.
    const seen = [];
    const page = withAlpine(loadComponent('calendar.js', 'calendarPage', {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            async loadCalendar() { seen.push('loading=' + page.loading); return []; },
        }),
    }));
    page.personId = 'p1';
    page.today = '2026-08-05';
    page.month = '2026-08';
    page.railAnchor = '2026-06';

    return page.load()
        .then(() => {
            assert.strictEqual(seen[0], 'loading=true', 'the first read draws nothing and says nothing');
            return page.nextMonth();          // inside the rail — no read at all
        })
        .then(() => {
            assert.strictEqual(seen.length, 1, 'a month already in hand was fetched again');
            return page.nextMonth();          // re-centres, so it tops up
        })
        .then(() => {
            assert.strictEqual(seen.length, 2, 'the rail grew without reading what it grew into');
            assert.strictEqual(seen[1], 'loading=false',
                'the calendar was hidden behind a spinner to fetch a month nobody had asked for');
            assert.strictEqual(page.loading, false);
        });
});

test('a quiet read that fails keeps the months already on screen', () => {
    // Emptying a calendar somebody is reading because the month after next
    // could not be fetched is a far worse answer than the sentence.
    let first = true;
    const page = withAlpine(loadComponent('calendar.js', 'calendarPage', {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            async loadCalendar() {
                if (first) {
                    first = false;
                    return [{ id: 'a', date: '2026-08-09', name: 'Sunday Service', assignments: [] }];
                }
                const e = new Error('nope'); e.code = 'unavailable'; throw e;
            },
        }),
    }));
    page.personId = 'p1';
    page.today = '2026-08-05';
    page.month = '2026-08';
    page.railAnchor = '2026-06';

    return page.load()
        .then(() => page.nextMonth())
        .then(() => page.nextMonth())        // re-centres, tops up, fails
        .then(() => {
            assert.strictEqual(page.occurrences.length, 1, 'the calendar emptied itself over a failed top-up');
            assert.ok(page.error, 'it failed silently instead');
            assert.strictEqual(page.loading, false);
        });
});

test('paging in List leaves the rail right, not parked on the wrong month', () => {
    // ⚠ A HIDDEN RAIL MEASURES ZERO, AND ZERO IS A REAL ANSWER — it is the
    // first month drawn, two back from the one you are on. The arrows live in
    // the header row and work in List, where the grid is not laid out, so
    // paging there wrote a shift of nothing and you found out on switching to
    // Month: a heading saying September over a grid showing July.
    let measured = 0;
    const page = withAlpine(loadComponent('calendar.js', 'calendarPage', {
        EventsStore: Object.assign({}, require('../public/events-store.js'), {
            async loadCalendar() { return []; },
        }),
    }));
    page.personId = 'p1';
    page.today = '2026-08-05';
    page.month = '2026-08';
    page.railAnchor = '2026-06';
    page.view = 'list';
    page.railShift = 999;   // whatever it was left on

    // A rail that is in the DOM but not laid out — exactly what List gives.
    const hidden = { offsetParent: null, offsetWidth: 0, querySelectorAll: () => { measured++; return []; } };
    page.$refs = { monthRail: hidden, monthRailWide: hidden };
    page.phone = true;

    return page.nextMonth().then(() => {
        assert.strictEqual(page.month, '2026-09', 'the arrow did not turn the month');
        assert.strictEqual(page.railShift, 999,
            'a rail nobody can see was measured, and answered zero');
        assert.strictEqual(measured, 0, 'it went looking for months in a box with no layout');

        // And switching to Month is where it catches up.
        const laid = {
            offsetParent: {}, offsetWidth: 358,
            querySelectorAll: () => [{ offsetLeft: 0 }, { offsetLeft: 358 }, { offsetLeft: 716 },
                { offsetLeft: 1074 }, { offsetLeft: 1432 }],
        };
        page.$refs = { monthRail: laid, monthRailWide: laid };
        page.setView('month');

        assert.strictEqual(page.view, 'month');
        assert.strictEqual(page.railShift, 1074,
            'the grid came back showing a month the heading disagrees with');
    });
});

// ── x-show hides; it does not guard ───────────────────────────────────────────

test('nothing dereferences the very thing its x-show is checking for', () => {
    // REPORTED FROM THE LIVE SITE, as a console full of
    // "Cannot read properties of null (reading 'label')".
    //
    // `x-show` sets display:none. It does NOT stop the other directives on the
    // same element being evaluated — so `x-text="'You · ' + ev.mine.label"`
    // guarded by `x-show="ev.mine"` threw on every event you were not on. It
    // threw SILENTLY: Alpine swallows a failed expression and leaves the
    // element blank, which is exactly what a hidden element looks like, so
    // nothing on screen was wrong and nothing in this suite could see it.
    //
    // The fix is a ternary in the expression itself. This is the check that
    // says so, across every page rather than the one that reported it.
    const ATTR = /(x-show|x-text|x-html)\s*=\s*"([^"]*)"/g;
    const offenders = [];

    fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html')).forEach(file => {
        const html = readPage(file);
        (html.match(/<[a-zA-Z][^>]*>/g) || []).forEach(tag => {
            const attrs = {};
            let m;
            ATTR.lastIndex = 0;
            while ((m = ATTR.exec(tag))) if (!(m[1] in attrs)) attrs[m[1]] = m[2];

            const guard = (attrs['x-show'] || '').trim();
            // Only a bare path can be read as "this thing exists". Anything with
            // an operator in it is already saying something more careful.
            if (!guard || !/^[\w$.]+$/.test(guard)) return;

            ['x-text', 'x-html'].forEach(key => {
                const expr = attrs[key];
                if (!expr) return;
                const reaches = new RegExp(guard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\.');
                // Saying it again in the expression is the fix — a ternary, a
                // short-circuit, or optional chaining (which never reaches the
                // `.` this looks for, so it passes without being named).
                const guarded = new RegExp(
                    guard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(\\?|&&)');
                if (reaches.test(expr) && !guarded.test(expr)) {
                    offenders.push(file + ': x-show="' + guard + '" with ' + key + '="' + expr + '"');
                }
            });
        });
    });

    assert.deepStrictEqual(offenders, [],
        'x-show hides an element, it does not stop its own directives running:\n  ' +
        offenders.join('\n  '));
});

// ── The two lanes on the Recurring Events page ────────────────────────────────

test('a member is shown the events that repeat rather than a wall', () => {
    // This page used to answer a member with "this one is for editors". But
    // "what runs every week, and until when?" is an ordinary question for
    // anybody in the church, and the Calendar answers it a month at a time,
    // which is the wrong shape for a thing defined by its pattern.
    const page = loadComponent('recurring-events.js', 'recurringEventsPage');
    page.loading = false;

    page.rank = 'viewer';
    assert.ok(page.browsing, 'a viewer is walled out of the list of what repeats');
    assert.ok(!page.isEditor);

    page.rank = 'member';
    assert.ok(page.browsing);

    page.rank = 'editor';
    assert.ok(!page.browsing, 'an editor was sent down the read-only lane');

    // Signed out is a door, not a wall, and stays its own answer.
    page.rank = null;
    assert.ok(!page.browsing && page.signedOut);
});

test('the browse lane opens and shuts one event at a time', async () => {
    // An accordion, not a selection. The editor lane cannot land on nothing —
    // an empty column beside a list reads as a grid that failed — but a list of
    // rows where every one is already open is not a list.
    const filters = [];
    const query = {
        where(field, op, value) { filters.push({ field, op, value }); return query; },
        async get() { return { docs: [] }; },
    };
    const fakeDb = { collection: () => query };

    const page = loadComponent('recurring-events.js', 'recurringEventsPage', { db: fakeDb });
    page.rank = 'member';
    page.personId = 'p1';
    page.series = [
        { id: 'midweek', name: 'Midweek', recurrence: { freq: 'weekly', weekday: 3, startDate: '2026-01-07' } },
    ];

    assert.strictEqual(page.seriesId, '', 'the list opened itself before anybody asked');

    await page.toggleSeries('midweek');
    assert.ok(page.isOpen('midweek'));
    assert.strictEqual(page.error, '', 'opening an event as a member failed the read');

    // ⚠ The member's read is constrained like every other. Unconstrained it does
    // not return fewer rows, it errors — and the error reads as "this event has
    // no dates", which is exactly what this lane exists to answer.
    assert.ok(filters.some(f => f.field === 'visibility' && f.op === 'in'),
        'the browse lane reads occurrences without naming a rung');

    await page.toggleSeries('midweek');
    assert.ok(!page.isOpen('midweek'), 'tapping the open row again did not shut it');
});

test('the browse lane offers nothing that writes', () => {
    // Everything that changes a series lives inside the editor template. A
    // control that leaks into the member's half is one they will be refused on
    // arrival, which is worse than never offering it.
    const html = readPage('recurring-events.html');
    const lane = html.slice(html.indexOf('x-if="browsing"'), html.indexOf('x-if="isEditor"'));

    assert.ok(lane.length > 400, 'the browse lane is not where this test thinks it is');
    [
        'takeEverybodyOff', 'draftHref', 'byHandHref', 'newEventHref', 'seriesHref', 'eventHref',
        'toggle(', 'clearSelection',
    ].forEach(control => {
        assert.ok(lane.indexOf(control) === -1,
            'the browse lane offers ' + control + ', which a member may not do');
    });

    assert.ok(/toggleSeries\(/.test(lane), 'nothing in the browse lane opens an event');
    assert.ok(/dateHref\(/.test(lane), 'a member cannot reach a single date from the list');
});

// ── Where "back" goes ─────────────────────────────────────────────────────────

test('a series goes back to the list of what repeats, a date to the Calendar', () => {
    // A pattern has no chip on the Calendar — the Calendar draws dates — so a
    // series is only ever reached from the Recurring Events list. Sending it
    // back to the Calendar ended the journey somewhere that could not show the
    // thing just left.
    const series = loadComponent('calendar-event.js', 'eventDetailPage',
        { location: { search: '?series=midweek', href: '' } });
    assert.strictEqual(series.backHref, 'recurring-events.html?series=midweek');
    assert.strictEqual(series.backLabel, 'Recurring events');

    const date = loadComponent('calendar-event.js', 'eventDetailPage',
        { location: { search: '?id=midweek_2026-07-15', href: '' } });
    assert.strictEqual(date.backHref, 'calendar.html', 'one date belongs to the Calendar');
    assert.strictEqual(date.backSentence, 'Back to the calendar');

    // Making an event that REPEATS is a journey that starts on that list too —
    // `?repeats=1` is the list's own doing.
    const making = loadComponent('calendar-event.js', 'eventDetailPage',
        { location: { search: '?new=1&repeats=1', href: '' } });
    assert.strictEqual(making.backHref, 'recurring-events.html');

    const makingOne = loadComponent('calendar-event.js', 'eventDetailPage',
        { location: { search: '?new=1', href: '' } });
    assert.strictEqual(makingOne.backHref, 'calendar.html');
});

test('the Event page says the way back once, and the page draws it three times', () => {
    // The header arrow, the button beside the title, and the create form's
    // Cancel. Three literals is three chances for one of them to keep pointing
    // at the Calendar after the other two moved.
    const html = readPage('calendar-event.html');
    const hardCoded = (html.match(/href="calendar\.html"/g) || []).length;
    assert.strictEqual(hardCoded, 0,
        'a way out of the Event page still points at the Calendar whatever it is showing');
    assert.ok((html.match(/:href="backHref"/g) || []).length >= 3,
        'not every way out of the Event page reads the same answer');
});
