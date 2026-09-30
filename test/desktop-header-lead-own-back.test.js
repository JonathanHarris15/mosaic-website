const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

// Just enough DOM for the header lead: a flat list of children with classes.
function fakeEl(tag, className = '', attrs = {}) {
    const el = {
        tagName: tag.toUpperCase(),
        className,
        id: attrs.id || '',
        children: [],
        attributes: { ...attrs },
        parent: null,
        hidden: false,
        textContent: '',
        setAttribute(k, v) { this.attributes[k] = v; },
        addEventListener() {},
        appendChild(c) { c.parent = this; this.children.push(c); return c; },
        insertBefore(c, ref) {
            c.parent = this;
            const i = ref ? this.children.indexOf(ref) : -1;
            if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
            return c;
        },
        remove() {
            if (!this.parent) return;
            const i = this.parent.children.indexOf(this);
            if (i >= 0) this.parent.children.splice(i, 1);
            this.parent = null;
        },
        get firstChild() { return this.children[0] || null; },
        matches(sel) {
            return sel.split(',').map(s => s.trim()).some(s => {
                const [base, not] = s.split(':not(');
                const hit = (b) => b.startsWith('#')
                    ? this.id === b.slice(1)
                    : b.split('.').filter(Boolean).every(c => this.className.split(/\s+/).includes(c));
                return hit(base) && !(not && hit(not.replace(')', '')));
            });
        },
        querySelectorAll(sel) { return this.children.filter(c => c.matches(sel)); },
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    };
    return el;
}

function loadLead() {
    const window = {
        matchMedia: () => ({ matches: true }),
        location: { pathname: '/shepherding-document.html' },
        history: { length: 1 },
    };
    window.DashboardNav = require('../public/dashboard-nav.js');
    const context = {
        window,
        DashboardNav: window.DashboardNav,
        document: { createElement: (t) => fakeEl(t), querySelector: () => null },
    };
    vm.createContext(context);
    vm.runInContext(read('desktop-header-lead.js'), context);
    return { Lead: window.DesktopHeaderLead };
}

function leadWithOwnBack(label) {
    const lead = fakeEl('div', 'm-header__lead');
    const back = fakeEl('a', 'm-back', { href: 'shepherding-profile.html?id=p1' });
    back.label = label;
    lead.appendChild(back);
    lead.appendChild(fakeEl('div', 'm-header__titles'));
    return { lead, back };
}

test('a back-mode page keeps the back link it drew for itself', async () => {
    // A note opened from a profile says "‹ Profile" and goes back to that
    // Person. The shared lead used to replace it with the static parent,
    // "‹ Documents", and send the reader to the library instead.
    const { Lead } = loadLead();
    const { lead, back } = leadWithOwnBack('Profile');

    await Lead.mount({ lead, currentHref: 'shepherding-document.html' });

    const backs = lead.querySelectorAll('.m-back');
    assert.strictEqual(backs.length, 1, 'exactly one back link');
    assert.strictEqual(backs[0], back, 'the page\'s own back link, untouched');
});

test('a back-mode page with no back link of its own gets the shared one', async () => {
    const { Lead } = loadLead();
    const lead = fakeEl('div', 'm-header__lead');
    lead.appendChild(fakeEl('div', 'm-header__titles'));

    await Lead.mount({ lead, currentHref: 'shepherding-document.html' });

    const backs = lead.querySelectorAll('.m-back');
    assert.strictEqual(backs.length, 1);
    assert.ok(backs[0].matches('.mosaic-desktop-lead'));
});

test('a page that names its back link explicitly still gets that one', async () => {
    // hymns.js passes { back } for the detail views; its markup's own links
    // are the phone ones and must not win on the desktop.
    const { Lead } = loadLead();
    const { lead, back } = leadWithOwnBack('Home');

    await Lead.mount({
        lead, currentHref: 'hymns.html', mode: 'back',
        back: { href: 'hymns.html', label: 'Hymns' },
    });

    const backs = lead.querySelectorAll('.m-back');
    assert.strictEqual(backs.length, 1);
    assert.notStrictEqual(backs[0], back);
});

test('mounting twice never leaves two back links', async () => {
    const { Lead } = loadLead();
    const lead = fakeEl('div', 'm-header__lead');
    await Lead.mount({ lead, currentHref: 'shepherding-document.html' });
    await Lead.mount({ lead, currentHref: 'shepherding-document.html' });
    assert.strictEqual(lead.querySelectorAll('.m-back').length, 1);
});

test('a bare data-mosaic-skip-desktop-lead attribute skips the shared lead', () => {
    // <body data-mosaic-skip-desktop-lead> gives dataset a value of "", which
    // is falsy — so the opt-out never worked, and the Shepherding Profile drew
    // the shared "‹ People" beside its own "‹ People" trail.
    let booted = 0;
    const context = {
        document: {
            readyState: 'complete',
            body: { dataset: { mosaicSkipDesktopLead: '' } },
        },
        DesktopHeaderLead: { bootFromDocument: () => { booted++; } },
        DashboardNav: {},
    };
    vm.createContext(context);
    vm.runInContext(read('desktop-nav-boot.js'), context);
    assert.strictEqual(booted, 0);
});

test('without the attribute the shared lead still boots', () => {
    let booted = 0;
    const context = {
        document: { readyState: 'complete', body: { dataset: {} } },
        DesktopHeaderLead: { bootFromDocument: () => { booted++; } },
        DashboardNav: {},
    };
    vm.createContext(context);
    vm.runInContext(read('desktop-nav-boot.js'), context);
    assert.strictEqual(booted, 1);
});
