// MS-714 — Directory Photo in the hamburger drawer, with initials when not.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const Photo = require('../public/person-photo-core.js');
const DrawerWho = require('../public/drawer-who.js');
const Drawer = require('../public/desktop-drawer.js');
const DashboardNav = require('../public/dashboard-nav.js');

function fakeEl(tag, className) {
    const el = {
        tagName: tag.toUpperCase(),
        className: className || '',
        textContent: '',
        children: [],
        firstChild: null,
        appendChild(c) {
            this.children.push(c);
            this.firstChild = this.children[0] || null;
            c.parentNode = this;
            return c;
        },
        removeChild(c) {
            const i = this.children.indexOf(c);
            if (i >= 0) this.children.splice(i, 1);
            this.firstChild = this.children[0] || null;
        },
    };
    return el;
}

function fakeDocument() {
    return {
        createElement(tag) {
            const el = fakeEl(tag);
            if (tag === 'img') {
                el.style = { cssText: '' };
                el.addEventListener = function (ev, fn) {
                    if (ev === 'error') el._onerror = fn;
                };
                el.removeEventListener = function () {};
                Object.defineProperty(el, 'src', {
                    set(v) {
                        el._src = v;
                        if (!v || v === 'bad:') setTimeout(() => el._onerror && el._onerror(), 0);
                    },
                    get() { return el._src; },
                });
            }
            return el;
        },
    };
}

test('drawerAvatarLetters falls back to the name when initials are empty', () => {
    assert.equal(Photo.drawerAvatarLetters({ name: 'Jonathan Harris', initials: '' }), 'JH');
    assert.equal(Photo.drawerAvatarLetters({ name: 'Sam', initials: '  ' }), 'S');
});

test('writeDrawerAvatar shows initials when there is no photo', () => {
    const el = fakeEl('span', 'm-avatar');
    Photo.writeDrawerAvatar(el, { name: 'Ada Lowell' }, fakeDocument());
    assert.equal(el.textContent, 'AL');
    assert.equal(el.children.length, 0);
});

test('writeDrawerAvatar uses a Directory Photo when photoUrl is set', () => {
    const el = fakeEl('span', 'm-avatar');
    const doc = fakeDocument();
    Photo.writeDrawerAvatar(el, {
        name: 'Ada Lowell',
        photoUrl: 'https://example.test/ada.jpg',
        photoCrop: { x: 50, y: 40, zoom: 1 },
    }, doc);
    assert.equal(el.children.length, 1);
    assert.equal(el.children[0].tagName, 'IMG');
    assert.match(el.children[0].style.cssText, /object-fit: cover/);
});

test('writeDrawerAvatar falls back to initials when the image fails', async () => {
    const el = fakeEl('span', 'm-avatar');
    const doc = fakeDocument();
    Photo.writeDrawerAvatar(el, {
        name: 'Bill Smith',
        photoUrl: 'bad:',
    }, doc);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(el.textContent, 'BS');
    assert.equal(el.children.length, 0);
});

test('DrawerWho.build carries photoUrl and initials together', () => {
    const account = { permissionLevel: 'elder', pastoralAssistant: false };
    const who = DrawerWho.build({
        account,
        name: 'Jonathan',
        photoUrl: 'https://example.test/j.jpg',
        photoCrop: null,
    });
    assert.equal(who.photoUrl, 'https://example.test/j.jpg');
    assert.equal(who.initials, 'J');
});

test('desktop-drawer uses PersonPhotoCore when drawing the avatar', () => {
    const src = read('desktop-drawer.js');
    assert.match(src, /writeDrawerAvatar/);
});

test('every drawer destination loads drawer-who and person-photo-core (MS-714)', () => {
    for (const file of DashboardNav.DRAWER_HREFS) {
        const html = read(file);
        assert.match(html, /drawer-who\.js/, file + ' is missing drawer-who.js');
        assert.match(html, /person-photo-core\.js/, file + ' is missing person-photo-core.js');
    }
});

test('the home dashboard builds who through DrawerWho', () => {
    assert.match(read('index.html'), /DrawerWho\.fromSession/);
});

test('desktop-header-lead builds who through DrawerWho', () => {
    assert.match(read('desktop-header-lead.js'), /DrawerWho\.fromSession/);
});
