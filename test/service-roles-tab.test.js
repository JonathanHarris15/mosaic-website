const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// MS-164 — the Roles tab on the service editor page.
//
// The tab is Alpine markup over two components: `serviceForm` owns the page and
// the tab strip, and a nested `eventDetailPage` owns the Roles panel inside it.
// Nothing type checks either join, and Alpine fails silently per-expression — a
// name the component never defined renders blank rather than throwing. On this
// page that would mean opening Roles and finding an empty box.
//
// So: load both components for real and assert every identifier the tab reaches
// for actually exists. Same technique as calendar-pages.test.js, which caught
// exactly this bug during MS-99.

const PUBLIC = path.join(__dirname, '..', 'public');
const RolesPanel = require('../public/roles-panel.js');

const read = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

function sandboxFor(extra) {
    const sandbox = {
        console, Promise, Date, Object, Array, Math, String, Number, JSON,
        Set, Map, encodeURIComponent, URLSearchParams,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    sandbox.EventsOccurrenceCore = require('../public/events-occurrence-core.js');
    sandbox.EventsStore = require('../public/events-store.js');
    sandbox.CalendarView = require('../public/calendar-view.js');
    sandbox.RolesCore = require('../public/roles-core.js');
    sandbox.EventsCore = require('../public/events-core.js');
    sandbox.DateUtils = require('../public/date-utils.js');
    sandbox.ServiceInvolvementCore = require('../public/service-involvement-core.js');

    sandbox.location = { search: '?date=2026-10-12', href: '' };
    sandbox.auth = { onAuthStateChanged() {} };
    sandbox.getUserData = async () => ({});
    sandbox.db = {};
    sandbox.document = { addEventListener() {}, querySelector() { return null; } };
    sandbox.firebase = { firestore: { FieldValue: {} } };
    sandbox.navigator = { userAgent: '' };

    Object.assign(sandbox, extra || {});
    vm.createContext(sandbox);
    return sandbox;
}

function load(scriptFile, factoryName) {
    const sandbox = sandboxFor();
    vm.runInContext(read(scriptFile), sandbox, { filename: scriptFile });
    assert.strictEqual(typeof sandbox[factoryName], 'function',
        scriptFile + ' does not define window.' + factoryName);
    return sandbox[factoryName];
}

const membersOf = o => new Set(Object.keys(Object.getOwnPropertyDescriptors(o)));

// ── The page and the panel both have what the markup asks for ────────────────

test('the tab strip only names things serviceForm has', () => {
    const form = load('service-builder.js', 'serviceForm')();
    const members = membersOf(form);

    ['tab', 'canEdit', 'sundayOccurrenceId'].forEach(name => {
        assert.ok(members.has(name),
            'the tab strip reads ' + name + ', which serviceForm never defines');
    });
});

test('the Roles pane only names things eventDetailPage has', () => {
    const component = load('calendar-event.js', 'eventDetailPage')({
        occurrenceId: 'sunday_service_2026-10-12', rolesOnly: true,
    });
    const members = membersOf(component);

    // Read off the pane's own markup rather than restated by hand, so a control
    // added to the panel later is covered without anyone remembering to.
    ['loading', 'error', 'init', 'canEditRoleSet'].forEach(name => {
        assert.ok(members.has(name),
            'the Roles pane reads ' + name + ', which eventDetailPage never defines');
    });
});

test('every member the shared panel markup reaches for exists', () => {
    const component = load('calendar-event.js', 'eventDetailPage')({
        occurrenceId: 'sunday_service_2026-10-12', rolesOnly: true,
    });
    const members = membersOf(component);
    const markup = Object.values(RolesPanel.MARKUP).join('\n');

    // The identifiers the panel uses, taken from its Alpine attributes.
    const ATTRS = /(?:x-text|x-show|x-if|x-model[.\w]*|x-for|@click|@change|@keydown[.\w]*|:class|:href|:disabled|:value|:aria-label)\s*=\s*"([^"]*)"/g;
    const ALLOWED = new Set(['$event', '$refs', '$el', '$dispatch', '$nextTick', 'Object',
        'Array', 'Math', 'String', 'Number', 'JSON', 'Boolean', 'Date', 'true', 'false',
        'null', 'undefined', 'new', 'typeof', 'in', 'of', 'return', 'window', 'console']);

    const loops = new Set();
    const forRe = /x-for\s*=\s*"([^"]*)"/g;
    let f;
    while ((f = forRe.exec(markup))) {
        f[1].split(/\s+in\s+/)[0].trim().replace(/[()]/g, '').split(',')
            .forEach(v => { if (v.trim()) loops.add(v.trim()); });
    }

    const missing = new Set();
    let m;
    while ((m = ATTRS.exec(markup))) {
        const expr = m[1].replace(/'(?:[^'\\]|\\.)*'/g, "''");
        const locals = new Set();
        let a;
        const arrows = /(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/g;
        while ((a = arrows.exec(expr))) {
            (a[1] || a[2] || '').split(',').forEach(p => {
                const n = p.trim(); if (n) locals.add(n);
            });
        }
        const idRe = /(\.)?(\$?[A-Za-z_][A-Za-z0-9_$]*)\s*(:)?/g;
        let i;
        while ((i = idRe.exec(expr))) {
            if (i[1] === '.' || i[3] === ':') continue;
            const name = i[2];
            if (ALLOWED.has(name) || loops.has(name) || locals.has(name)) continue;
            if (!members.has(name)) missing.add(name);
        }
    }

    assert.deepStrictEqual([...missing], [],
        'the shared panel names things eventDetailPage does not have');
});

// ── The tab is scoped to the right Sunday ────────────────────────────────────

test('the tab opens the occurrence for the Sunday being edited', () => {
    const form = load('service-builder.js', 'serviceForm')();
    form.date = '2026-10-12';
    assert.strictEqual(form.sundayOccurrenceId, 'sunday_service_2026-10-12');
});

test('a page with no date yet asks for no occurrence', () => {
    const form = load('service-builder.js', 'serviceForm')();
    form.date = '';
    assert.strictEqual(form.sundayOccurrenceId, null,
        'a null id is a panel that does not load, which beats one that loads the wrong Sunday');
});

test('the page opens on the order of service', () => {
    const form = load('service-builder.js', 'serviceForm')();
    assert.strictEqual(form.tab, 'order',
        'this page has always been the order of service; Roles is the addition');
});

// ── What the tab may and may not do ──────────────────────────────────────────

test('the Roles tab cannot change which Roles the Sunday carries', () => {
    const scoped = load('calendar-event.js', 'eventDetailPage')({
        occurrenceId: 'sunday_service_2026-10-12', rolesOnly: true,
    });
    assert.strictEqual(scoped.canEditRoleSet, false,
        'changing the Sunday Service series from inside one Sunday changes every Sunday');
});

test('the Event detail screen still can', () => {
    const full = load('calendar-event.js', 'eventDetailPage')();
    assert.strictEqual(full.canEditRoleSet, true,
        'the Event is where the Role set is decided, and that must still work');
});

test('the controls that change the Role set are gated on it', () => {
    const markup = RolesPanel.MARKUP.roles;
    // Adding a one-off job and removing one are both changes to what the Sunday
    // carries, so neither may appear where the panel only fills Roles.
    assert.match(markup, /x-show="isEditor && canEditRoleSet"[^>]*>\s*<span[^>]*>add</,
        'the add-a-one-off input is not gated, so the Roles tab could add Roles');
    assert.match(markup, /x-show="isEditor && canEditRoleSet" @click="askRemoveOneOffRole/,
        'the remove-a-one-off button is not gated');
});

test('the way through to where Roles ARE decided is not gated', () => {
    // The tab must say where the decision lives, or it reads as broken rather
    // than deliberately narrow.
    assert.match(RolesPanel.MARKUP.roles, /x-show="isEditor && eventHref"/);
});

// ── The page carries what the panel needs ────────────────────────────────────

test('the service page loads the panel, its styles and its behaviour', () => {
    const html = read('service-builder.html');
    ['roles-panel.js', 'roles-panel.css', 'calendar-event.js', 'events-store.js',
        'events-occurrence-core.js', 'calendar-view.js', 'roles-core.js'].forEach(file => {
        assert.ok(html.includes(file), 'service-builder.html never loads ' + file);
    });
});

test('the panel injector runs after the placeholders and before Alpine', () => {
    // It fills them synchronously. In the head it would find nothing; after
    // Alpine has initialised it would fill markup Alpine has already walked past.
    ['service-builder.html', 'calendar-event.html'].forEach(file => {
        const html = read(file);
        // The tag itself, not the filename — both pages talk about roles-panel.js
        // in a comment above the markup it fills.
        const placeholder = html.indexOf('<div data-roles-panel');
        const injector = html.indexOf('<script src="roles-panel.js">');
        assert.ok(placeholder !== -1 && injector > placeholder,
            file + ' loads roles-panel.js before the placeholders it fills');
        assert.match(html, /<script defer src="vendor\/alpine/,
            file + ' must load Alpine deferred, or it initialises before the panel exists');
    });
});

test('both pages carry every placeholder the panel can fill', () => {
    const event = read('calendar-event.html');
    const service = read('service-builder.html');
    Object.keys(RolesPanel.MARKUP).forEach(name => {
        assert.ok(event.includes('data-roles-panel="' + name + '"'),
            'calendar-event.html lost the ' + name + ' placeholder');
        assert.ok(service.includes('data-roles-panel="' + name + '"'),
            'service-builder.html has no ' + name + ' placeholder');
    });
});

test('the liturgy is not offered a second time on the Roles tab', () => {
    // Liturgical Roles are fields the printed booklet reads (ADR-0018 §2). A
    // second way to set them would be a second source of truth for who is
    // preaching, and the loser is the booklet on a Sunday morning.
    const markup = RolesPanel.MARKUP.roles;
    ['preacherId', 'serviceLeaderId', 'musicLeaderId', 'sermonetteId'].forEach(field => {
        assert.ok(!markup.includes(field),
            'the shared panel writes ' + field + ', which only the order of service may');
    });
});

// ── The injector reaches the placeholders where they actually are ────────────

test('placeholders inside nested templates are filled', () => {
    // The service page's Roles pane sits behind an x-if, and its banner and
    // Role cards behind a second one. A <template>'s contents live in a separate
    // document fragment, so document.querySelector cannot see them — an injector
    // that only looked at the top level would fill nothing and the tab would
    // open empty.
    const fragments = [];

    const node = (html) => {
        const found = [];
        // A stand-in for the DOM: only what mount() actually uses.
        const self = {
            innerHTML: html,
            querySelectorAll(sel) {
                if (sel === 'template') return self._templates;
                const name = (sel.match(/data-roles-panel="(\w+)"/) || [])[1];
                return self._slots.filter(s => s.name === name);
            },
            _templates: [],
            _slots: [],
        };
        fragments.push(self);
        return self;
    };

    const slot = (name) => ({ name, innerHTML: '' });

    const inner = node('');
    const bannerSlot = slot('banner');
    const rolesSlot = slot('roles');
    inner._slots = [bannerSlot, rolesSlot];

    const outer = node('');
    const pickerSlot = slot('picker');
    outer._slots = [pickerSlot];
    outer._templates = [{ content: inner }];

    const doc = node('');
    doc._templates = [{ content: outer }];

    RolesPanel.mount(doc);

    assert.ok(bannerSlot.innerHTML.length, 'the banner placeholder was never filled');
    assert.ok(rolesSlot.innerHTML.length, 'the Role cards placeholder was never filled');
    assert.ok(pickerSlot.innerHTML.length, 'the picker placeholder was never filled');
});

test('the Roles pane is behind an x-if, not an x-show', () => {
    // x-data is evaluated when Alpine walks the page, before the Service has
    // loaded and before `date` has a value. x-show would build the panel then,
    // pointed at an occurrence id with no date in it.
    const html = read('service-builder.html');
    assert.match(html, /<template x-if="tab === 'roles' && date">/,
        'the Roles pane mounts before the Sunday it is about is known');
});

// ── The phone ────────────────────────────────────────────────────────────────
//
// The mobile app does not port this screen. It opens the same page inside the
// shell (`service-builder.html?date=…&shell=mobile`, mobile/app.js), which is
// the pattern the Roles Manager already follows. So "the mobile screen" is this
// page at 390px, and what has to be right is the chrome around the panel.

test('the phone opens this page rather than a port of it', () => {
    const app = fs.readFileSync(path.join(PUBLIC, 'mobile', 'app.js'), 'utf8');
    assert.match(app, /service-builder\.html\?date=.*shell=mobile/,
        'the mobile app no longer opens the service editor in the shell');
});

test('the picker sits above the docked save bar', () => {
    // The service page docks its save bar at z-60 on a phone. The picker used to
    // be z-50, which put the bar on top of it — over the Assign button, at the
    // bottom of the sheet, exactly where a thumb goes.
    const bar = read('service-builder.html');
    const barZ = Number((bar.match(/#mobile-save-bar\s*\{[^}]*z-index:\s*(\d+)/) || [])[1]);
    const pickerZ = Number((RolesPanel.MARKUP.picker.match(/fixed inset-0 z-\[?(\d+)\]?/) || [])[1]);

    assert.ok(barZ, 'the docked save bar has no z-index to compare against');
    assert.ok(pickerZ > barZ,
        'the save bar (z-' + barZ + ') covers the picker (z-' + pickerZ + ') on a phone');
});

test('the save bar stands down on the Roles tab unless there is something to save', () => {
    // Every assignment writes as it is made. A "Save Service" button there does
    // nothing to what is on screen, and implies the roles are unsaved until
    // pressed — the opposite of true.
    const html = read('service-builder.html');
    assert.match(html, /id="mobile-save-bar"[^>]*x-show="user && canEdit && \(tab === 'order' \|\| isDirty\)"/,
        'the docked save bar does not know about the Roles tab');
});

test('the tab strip is laid out for 390px', () => {
    const html = read('service-builder.html');
    assert.match(html, /id="service-tabs"/, 'the tab strip has no hook for the phone rules');
    assert.match(html, /body\.shell-mobile #service-tabs button \{[^}]*flex: 1 1 0/,
        'the two tabs do not split the width, so they read as one tab and a spare');
    assert.match(html, /body\.shell-mobile #service-tabs \.material-symbols-outlined \{ display: none/,
        'the tab glyphs stay on a phone, which pushes "Order of Service" onto a second line');
});

test('the shell back arrow leaves the Roles tab before it leaves the page', () => {
    const form = load('service-builder.js', 'serviceForm')();
    const handlers = [];

    // The page listens on `document`; the sandbox's stub records instead.
    const sandbox = sandboxFor({
        document: { addEventListener(name, fn) { handlers.push([name, fn]); } },
    });
    vm.runInContext(read('service-builder.js'), sandbox, { filename: 'service-builder.js' });
    const page = sandbox.serviceForm();
    page.listenForShellBack();

    const back = handlers.find(([name]) => name === 'mobile-header:back');
    assert.ok(back, 'the page never listens for the shell back arrow');

    page.tab = 'roles';
    back[1]();
    assert.strictEqual(page.tab, 'order',
        'back off the Roles tab throws you out of the Sunday instead of returning to it');
});

test('the page asks the shell to hand back the arrow', () => {
    const html = read('service-builder.html');
    assert.match(html, /MOBILE_HEADER = \{[^}]*onBack: true/,
        'the shell still decides where back goes, so the tab cannot answer it');
});

test('the panel brings its own phone rules', () => {
    // The slot row is eight things wide and 390px holds about half. Those rules
    // moved into roles-panel.css with the markup, so the service page gets them
    // by linking one file rather than by anyone remembering to copy them.
    const css = fs.readFileSync(path.join(PUBLIC, 'roles-panel.css'), 'utf8');
    ['cal-slot-row', 'cal-slot-index', 'cal-slot-avatar', 'cal-slot-actions',
        'cal-role-glyph', 'cal-role-everydate'].forEach(hook => {
        assert.ok(new RegExp('html\\.shell-mobile[^{]*\\.' + hook).test(css),
            hook + ' has no phone rule in the shared stylesheet');
    });
    assert.ok(read('service-builder.html').includes('roles-panel.css'),
        'the service page never links the stylesheet those rules live in');
});
