const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Every module a page's scripts reach for must be loaded BY that page, before
// the script that reaches for it.
//
// ⚠ THE BUG THIS EXISTS FOR, AND WHY NOTHING ELSE CAUGHT IT.
//
// Every *-core module here ends the same way:
//
//     const Core = (typeof require !== 'undefined')
//         ? require('./events-occurrence-core.js')   // ← Node takes this
//         : global.EventsOccurrenceCore;             // ← the browser takes this
//
// Under `node --test` the first branch always wins, so a module can grow a new
// dependency, every test can pass, and the browser still gets `undefined` —
// because nobody added the <script> tag. The page then throws on first render
// and shows a blank panel, which reads like "you have nothing" rather than like
// a crash.
//
// That is exactly what happened when calendar-view.js started reading
// commitments-core.js (MS-20): five pages broke, 2220 tests stayed green.

const PUBLIC = path.join(__dirname, '..', 'public');

const jsFiles = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.js'));
const htmlFiles = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'));

// Which file publishes which browser global. The house pattern is a single
// `global.Name = Name;` (or `global.Name = Value`) in the module's tail.
const definedBy = new Map();
jsFiles.forEach(file => {
    const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    for (const m of src.matchAll(/\bglobal\.([A-Z][A-Za-z0-9_]*)\s*=/g)) {
        if (!definedBy.has(m[1])) definedBy.set(m[1], file);
    }
});

// What a module reaches for in its BROWSER branch, which is the branch tests
// never take.
function browserDepsOf(file) {
    const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    const wanted = new Set();
    for (const m of src.matchAll(/:\s*global\.([A-Z][A-Za-z0-9_]*)/g)) {
        const owner = definedBy.get(m[1]);
        if (owner && owner !== file) wanted.add(owner);
    }
    return [...wanted];
}

// The local scripts a page loads, in load order. Ignores vendored and remote
// ones — those are not part of this contract.
function scriptsOf(html) {
    const src = fs.readFileSync(path.join(PUBLIC, html), 'utf8');
    const out = [];
    for (const m of src.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
        const s = m[1];
        if (s.startsWith('http') || s.includes('/')) continue;
        if (s.endsWith('.js')) out.push(s);
    }
    return out;
}

test('every page loads the modules its own scripts reach for', () => {
    const missing = [];

    htmlFiles.forEach(html => {
        const loaded = scriptsOf(html);
        loaded.forEach(file => {
            if (!jsFiles.includes(file)) return;
            browserDepsOf(file).forEach(dep => {
                if (!loaded.includes(dep)) {
                    missing.push(html + ' loads ' + file +
                        ', which reads ' + dep + ' in the browser — but never loads it');
                }
            });
        });
    });

    assert.deepEqual(missing, [],
        'a missing <script> renders a blank panel, not an error:\n  ' +
        missing.join('\n  '));
});

test('a module is loaded before whatever reaches for it', () => {
    const wrong = [];

    htmlFiles.forEach(html => {
        const loaded = scriptsOf(html);
        loaded.forEach((file, i) => {
            if (!jsFiles.includes(file)) return;
            browserDepsOf(file).forEach(dep => {
                const at = loaded.indexOf(dep);
                if (at !== -1 && at > i) {
                    wrong.push(html + ' loads ' + file + ' before ' + dep +
                        ', which it reads at load time');
                }
            });
        });
    });

    assert.deepEqual(wrong, [], wrong.join('\n  '));
});

// The map itself has to be right, or the two tests above quietly check nothing.
test('the modules this guard knows about include the ones MS-20 added', () => {
    assert.equal(definedBy.get('CommitmentsCore'), 'commitments-core.js');
    assert.equal(definedBy.get('CoverCore'), 'cover-core.js');
    assert.equal(definedBy.get('CoverStore'), 'cover-store.js');
    assert.equal(definedBy.get('EventsOccurrenceCore'), 'events-occurrence-core.js');
});
