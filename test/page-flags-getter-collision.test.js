const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const AccessCore = require('../public/access-core.js');

// The Document Library page never finished loading for anybody signed in.
//
// ⚠ Object.assign ONTO AN ALPINE COMPONENT THROWS ON A GETTER-ONLY KEY.
// `Object.assign(this, AccessCore.pageFlags(userData))` writes every flag onto
// the component's reactive proxy. When the component declares one of those
// names as a getter with no setter, the proxy's set trap answers false and
// Object.assign throws a TypeError. Inside the auth callback that is an
// unhandled rejection: the spinner runs forever and auth.js's boot guard draws
// "This page didn't finish loading." A plain object would have hidden it, so
// no unit test that builds the component as an object literal catches it.

const PUBLIC = path.join(__dirname, '..', 'public');
const FLAG_KEYS = Object.keys(AccessCore.pageFlags({ permissionLevel: 'elder' }));

function filesThatAssignPageFlags() {
    const found = [];
    const walk = (dir) => {
        fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'vendor') walk(full);
            } else if (entry.name.endsWith('.js')) {
                const src = fs.readFileSync(full, 'utf8');
                if (/Object\.assign\(\s*this\s*,\s*AccessCore\.pageFlags\(/.test(src)) {
                    found.push({ file: path.relative(PUBLIC, full), src });
                }
            }
        });
    };
    walk(PUBLIC);
    return found;
}

test('no component spreads pageFlags over a getter of the same name', () => {
    const collisions = [];
    filesThatAssignPageFlags().forEach(({ file, src }) => {
        FLAG_KEYS.forEach(key => {
            if (new RegExp('\\bget\\s+' + key + '\\s*\\(').test(src)) {
                collisions.push(file + ' declares `get ' + key + '()` and assigns pageFlags onto this');
            }
        });
    });

    assert.deepStrictEqual(collisions, [],
        'Object.assign throws on a getter-only key of an Alpine proxy, and the page\n' +
        'never finishes loading. Pick the flags you need instead:\n  ' +
        collisions.join('\n  '));
});

// ⚠ AND A FLAG THE COMPONENT NEVER DECLARED IS A ReferenceError, NOT A FALSE.
// Alpine evaluates x-show="canDecide" against the component's own keys. Until
// the auth callback assigns the flags, a name that is not one of them throws
// on every binding — the Shepherding Profile logged it a dozen times a load.
test('a component declares the flags its template reads before auth answers', () => {
    const undeclared = [];
    filesThatAssignPageFlags().forEach(({ file, src }) => {
        const htmlFile = path.join(PUBLIC, file.replace(/\.js$/, '.html'));
        if (!fs.existsSync(htmlFile)) return;
        if (/\.\.\.AccessCore\.pageFlags\(null\)/.test(src)) return;
        const html = fs.readFileSync(htmlFile, 'utf8');
        FLAG_KEYS.forEach(key => {
            const read = new RegExp('(?:x-show|x-if|:class|:disabled|@click)="[^"]*\\b' + key + '\\b').test(html);
            const declared = new RegExp('^\\s+' + key + '\\s*:', 'm').test(src)
                || new RegExp('\\bget\\s+' + key + '\\s*\\(').test(src);
            if (read && !declared) undeclared.push(file + ' reads ' + key + ' in its template but never declares it');
        });
    });

    assert.deepStrictEqual(undeclared, [],
        'start the component with ...AccessCore.pageFlags(null) so every flag reads closed:\n  ' +
        undeclared.join('\n  '));
});

test('pageFlags(null) is the closed set a component can start from', () => {
    const closed = AccessCore.pageFlags(null);
    FLAG_KEYS.filter(k => k.startsWith('can')).forEach(k => assert.strictEqual(closed[k], false, k));
    assert.strictEqual(closed.pastoralAssistant, false);
});

test('the collision really is fatal on a reactive proxy', () => {
    const component = { get currentPermissionLevel() { return null; } };
    const proxy = new Proxy(component, { set: (t, k, v, r) => Reflect.set(t, k, v, r) });
    assert.throws(() => Object.assign(proxy, AccessCore.pageFlags({ permissionLevel: 'elder' })), TypeError);
});

test('this guard is actually scanning the pages', () => {
    const files = filesThatAssignPageFlags().map(f => f.file);
    assert.ok(files.includes('shepherding-profile.js') && files.length >= 10,
        'expected the Alpine pages that spread pageFlags, found: ' + files.join(', '));
});
