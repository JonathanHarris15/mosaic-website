const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Every module a page's scripts reach for must be loaded BY that page, and —
// when the reach happens as the script parses — loaded BEFORE it.
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
//
// ── THE THREE SPELLINGS (MS-321) ─────────────────────────────────────────────
//
// A script names a module in one of three ways, and they do not all bind at the
// same moment, so they cannot all be checked the same way:
//
//   1. `: global.Name`            — the require-ternary tail above.
//                                   Binds AS THE SCRIPT PARSES.
//                                   → presence AND order.
//
//   2. `const Alias = window.Name` — a capture at the head of a page script.
//                                   Binds AS THE SCRIPT PARSES.
//                                   Usually ALIASED, so the module's own name
//                                   never appears at the use site — which is
//                                   why matching bare names alone missed these.
//                                   → presence AND order.
//
//   3. `Name.member`              — a bare use inside a function body.
//                                   Runs long after every script has loaded.
//                                   → presence ONLY. Order cannot matter here,
//                                     and asserting it would fail honest code.
//
// Spelling 3 is how MS-303 slipped through: docx-importer.js grew a read of
// ServiceDatesCore, and service-calendar.html loaded it 460 lines too early.
//
// ── OPTIONAL NEIGHBOURS ──────────────────────────────────────────────────────
//
// A shared module may reach for a neighbour it can live without, and says so
// with `typeof Name !== 'undefined'` or `window.Name && …`. That is not a
// missing tag — it is a module written to run on pages that deliberately leave
// half its neighbours out (auth.js reads KioskCore this way on 31 pages; only
// the kiosk loads it). The guard reads the check rather than keeping a list, so
// there is nothing to maintain as the codebase grows. See ADR 0045.
//
// The check is read FILE-WIDE, not per use site: guard a module once and the
// whole file is taken at its word. Deliberate — proximity rules are fragile and
// hard to explain — but it does mean a file that guards a module in one place
// and forgets in another is believed. Keep the guard next to the use.
//
// ── KNOWN LIMIT ──────────────────────────────────────────────────────────────
//
// A top-level bare read — `const x = RolesCore.thing()` at module scope — binds
// at load time but is treated as spelling 3, so its order is not checked. The
// house style captures through `window.` instead, which is checked. Following
// an alias any further needs a real parser and is deliberately out of scope.

const PUBLIC = path.join(__dirname, '..', 'public');

// ── The exemption list ───────────────────────────────────────────────────────
//
// Deliberately empty. An optional neighbour is marked by a typeof check in the
// code itself, not by a line in here — a list needs editing every time somebody
// adds a module, and quietly rots into a set of pages nobody rechecks.
//
// Only a genuine oddity belongs here, and every entry must say why.
// Shape: { page, script, module, why }
const EXEMPT = [];

// ── Reading the source ───────────────────────────────────────────────────────

// Remove comments and string literals so prose is never read as code: a comment
// in events-core.js explaining what RolesCore does is not a call to RolesCore.
// Removed spans become spaces of the same length, so line numbers still line up
// with the real file.
function stripCode(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    const blank = s => s.replace(/[^\n]/g, ' ');

    while (i < n) {
        const c = src[i];
        const d = src[i + 1];

        if (c === '/' && d === '/') {
            let j = src.indexOf('\n', i);
            if (j < 0) j = n;
            out += blank(src.slice(i, j));
            i = j;
            continue;
        }
        if (c === '/' && d === '*') {
            let j = src.indexOf('*/', i + 2);
            j = j < 0 ? n : j + 2;
            out += blank(src.slice(i, j));
            i = j;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            let j = i + 1;
            while (j < n) {
                if (src[j] === '\\') { j += 2; continue; }
                if (src[j] === quote) { j++; break; }
                if (quote !== '`' && src[j] === '\n') break;
                j++;
            }
            out += blank(src.slice(i, j));
            i = j;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

// Which file publishes which browser global. The house pattern is a single
// `global.Name = Name;` in the module's tail.
//
// `=(?!=)` matters: without it the pattern also matches
// `global.EventsStore === 'undefined'`, and whichever file sorts first wins the
// name. That is how the guard came to believe away-store.js published
// EventsStore when events-store.js does.
function publishedBy(stripped) {
    const definedBy = new Map();
    for (const [file, src] of stripped) {
        for (const m of src.matchAll(/\bglobal\.([A-Z][A-Za-z0-9_]*)\s*=(?!=)/g)) {
            if (!definedBy.has(m[1])) definedBy.set(m[1], file);
        }
    }
    return definedBy;
}

// Is this reference wrapped in an "only if the page loaded it" check?
function isOptional(src, name) {
    const forms = [
        new RegExp('typeof\\s+(?:window\\.|global(?:This)?\\.)?' + name + '\\s*[!=]=='),
        new RegExp('(?:window|global(?:This)?)\\.' + name + '\\s*(?:&&|\\|\\||\\?)')
    ];
    return forms.some(re => re.test(src));
}

// What one script reaches for, and whether the reach binds at load time.
function referencesOf(file, src, definedBy) {
    const found = new Map();

    const note = (owner, ref) => {
        if (!owner || owner === file) return;
        if (found.has(owner)) return;   // first spelling seen wins; load-time first
        found.set(owner, ref);
    };

    // Spelling 1 — the require-ternary tail.
    for (const m of src.matchAll(/:\s*global\.([A-Z][A-Za-z0-9_]*)/g)) {
        note(definedBy.get(m[1]), { name: m[1], binds: 'load', optional: false });
    }

    // Spelling 2 — a capture at the head of a page script.
    const capture = /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:window|global(?:This)?)\.([A-Z][A-Za-z0-9_]*)\s*[;,\r\n]/g;
    for (const m of src.matchAll(capture)) {
        note(definedBy.get(m[1]), { name: m[1], binds: 'load', optional: isOptional(src, m[1]) });
    }

    // Spelling 3 — a bare use, which runs after every script has loaded.
    for (const name of definedBy.keys()) {
        const owner = definedBy.get(name);
        if (owner === file || found.has(owner)) continue;
        const use = new RegExp('(?:^|[^\\w.$])' + name + '\\s*\\.');
        if (!use.test(src)) continue;
        note(owner, { name, binds: 'deferred', optional: isOptional(src, name) });
    }

    return found;
}

// The local scripts a page loads, in load order. Ignores vendored and remote
// ones — those are not part of this contract.
function scriptsOf(html) {
    const out = [];
    for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
        const s = m[1];
        if (s.startsWith('http') || s.includes('/')) continue;
        if (s.endsWith('.js')) out.push(s);
    }
    return out;
}

// ── The guard ────────────────────────────────────────────────────────────────

// js and html are { filename: source }. Returns every fault, so the same
// function serves the real site and a three-line fixture.
function analyse({ js, html }, exempt = []) {
    const stripped = new Map(Object.entries(js).map(([f, s]) => [f, stripCode(s)]));
    const definedBy = publishedBy(stripped);
    const excused = (page, script, module) => exempt.some(e =>
        e.page === page && e.script === script && e.module === module);

    const missing = [];
    const wrongOrder = [];

    for (const [page, source] of Object.entries(html)) {
        const loaded = scriptsOf(source);
        loaded.forEach((script, at) => {
            if (!stripped.has(script)) return;
            for (const [module, ref] of referencesOf(script, stripped.get(script), definedBy)) {
                if (ref.optional || excused(page, script, module)) continue;
                const found = loaded.indexOf(module);
                if (found === -1) {
                    missing.push({ page, script, module, global: ref.name, binds: ref.binds });
                } else if (ref.binds === 'load' && found > at) {
                    wrongOrder.push({ page, script, module, global: ref.name });
                }
            }
        });
    }

    return { missing, wrongOrder, definedBy };
}

function readSite() {
    const js = {}, html = {};
    for (const f of fs.readdirSync(PUBLIC)) {
        if (f.endsWith('.js')) js[f] = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
        else if (f.endsWith('.html')) html[f] = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    }
    return { js, html };
}

const site = analyse(readSite(), EXEMPT);

// ── The site ─────────────────────────────────────────────────────────────────

test('every page loads the modules its own scripts reach for', () => {
    const said = site.missing.map(f =>
        `${f.page} loads ${f.script}, which reads ${f.global} (${f.binds}) ` +
        `— but never loads ${f.module}`);

    assert.deepEqual(said, [],
        'a missing <script> renders a blank panel, not an error:\n  ' + said.join('\n  '));
});

test('a module that binds at load time is loaded before whatever reaches for it', () => {
    const said = site.wrongOrder.map(f =>
        `${f.page} loads ${f.script} before ${f.module}, whose ${f.global} it captures at load time`);

    assert.deepEqual(said, [], said.join('\n  '));
});

// ── The map itself, or the two tests above quietly check nothing ─────────────

test('a global is credited to the file that publishes it, not one that tests for it', () => {
    const wrong = [];
    for (const [name, file] of site.definedBy) {
        const src = stripCode(fs.readFileSync(path.join(PUBLIC, file), 'utf8'));
        const assigns = new RegExp('\\bglobal\\.' + name + '\\s*=(?!=)');
        if (!assigns.test(src)) wrong.push(`${name} credited to ${file}, which never assigns it`);
    }
    assert.deepEqual(wrong, [], wrong.join('\n  '));
});

test('the modules this guard knows about include the ones MS-20 added', () => {
    assert.equal(site.definedBy.get('CommitmentsCore'), 'commitments-core.js');
    assert.equal(site.definedBy.get('CoverCore'), 'cover-core.js');
    assert.equal(site.definedBy.get('CoverStore'), 'cover-store.js');
    assert.equal(site.definedBy.get('EventsOccurrenceCore'), 'events-occurrence-core.js');
    assert.equal(site.definedBy.get('EventsStore'), 'events-store.js');
});

test('every exemption says why it is there', () => {
    EXEMPT.forEach(e => {
        assert.ok(e.page && e.script && e.module, 'an exemption must name page, script and module');
        assert.ok(e.why && e.why.trim().length > 0,
            `the exemption for ${e.module} on ${e.page} has no reason written beside it`);
    });
});

// ── Fixtures: prove the guard goes red when it should ────────────────────────

const CORE = '(function (global) { const A = { run() {} }; global.AlphaCore = A; })(this);';
const OTHER = '(function (global) { const B = { go() {} }; global.BetaCore = B; })(this);';

test('breakage A — a bare deferred read with no <script> tag turns it red', () => {
    const { missing } = analyse({
        js: {
            'alpha-core.js': CORE,
            'page.js': '(function () { function onClick() { AlphaCore.run(); } })();'
        },
        html: { 'p.html': '<script src="page.js"></script>' }
    });

    assert.equal(missing.length, 1);
    assert.deepEqual(
        { page: missing[0].page, script: missing[0].script, module: missing[0].module },
        { page: 'p.html', script: 'page.js', module: 'alpha-core.js' });
});

test('breakage B — a load-time capture before its module turns it red', () => {
    const { wrongOrder } = analyse({
        js: {
            'alpha-core.js': CORE,
            'page.js': '(function () { const A = window.AlphaCore;\n function go() { A.run(); } })();'
        },
        html: {
            'p.html': '<script src="page.js"></script><script src="alpha-core.js"></script>'
        }
    });

    assert.equal(wrongOrder.length, 1);
    assert.equal(wrongOrder[0].module, 'alpha-core.js');
});

test('breakage C — a require-ternary tail before its module turns it red', () => {
    // Spelling 1, the one the guard could already see. Pinned here so it cannot
    // be lost while the other two are added around it.
    const consumer = "const A = (typeof require !== 'undefined')\n" +
        "    ? require('./alpha-core.js')\n" +
        '    : global.AlphaCore;';

    const before = analyse({
        js: { 'alpha-core.js': CORE, 'beta-core.js': consumer },
        html: { 'p.html': '<script src="beta-core.js"></script><script src="alpha-core.js"></script>' }
    });
    assert.equal(before.wrongOrder.length, 1, 'a load-time require tail must bind order');

    const absent = analyse({
        js: { 'alpha-core.js': CORE, 'beta-core.js': consumer },
        html: { 'p.html': '<script src="beta-core.js"></script>' }
    });
    assert.equal(absent.missing.length, 1);
    assert.equal(absent.missing[0].module, 'alpha-core.js');
});

test('a bare deferred read does NOT care where the tag sits', () => {
    const { missing, wrongOrder } = analyse({
        js: {
            'alpha-core.js': CORE,
            'page.js': '(function () { function onClick() { AlphaCore.run(); } })();'
        },
        html: {
            'p.html': '<script src="page.js"></script><script src="alpha-core.js"></script>'
        }
    });

    assert.deepEqual(missing, []);
    assert.deepEqual(wrongOrder, [], 'order is not a fault for a read that runs after load');
});

test('a module named only in a comment or a string is not a dependency', () => {
    const { missing } = analyse({
        js: {
            'alpha-core.js': CORE,
            'page.js': [
                '(function () {',
                '  // AlphaCore.run() is what the other page does.',
                '  /* see AlphaCore.run for the shape */',
                '  const label = "AlphaCore.run";',
                '  const tpl = `AlphaCore.run`;',
                '})();'
            ].join('\n')
        },
        html: { 'p.html': '<script src="page.js"></script>' }
    });

    assert.deepEqual(missing, []);
});

test('an escaped quote does not end a string early', () => {
    const stripped = stripCode('const s = "a \\" AlphaCore.run"; AlphaCore.go();');
    assert.ok(!/AlphaCore\.run/.test(stripped), 'the string contents survived the stripper');
    assert.ok(/AlphaCore\.go/.test(stripped), 'real code after the string was eaten');
});

test('the stripper keeps line numbers honest', () => {
    const src = 'a\n// AlphaCore.run\nb\n/* two\n   lines */\nc\n';
    const stripped = stripCode(src);
    assert.equal(stripped.split('\n').length, src.split('\n').length);
    assert.equal(stripped.length, src.length);
});

test('a comparison is not an assignment — global.X === undefined publishes nothing', () => {
    const definedBy = publishedBy(new Map([
        ['away-store.js', "if (typeof global.BetaCore === 'undefined') return [];"],
        ['beta-core.js', OTHER]
    ]));
    assert.equal(definedBy.get('BetaCore'), 'beta-core.js');
});

test('an optional neighbour behind a typeof check is not a missing tag', () => {
    const guards = [
        "const A = (typeof AlphaCore !== 'undefined') ? AlphaCore : null;\n A && A.run();",
        "if (typeof window.AlphaCore === 'undefined') return;\n window.AlphaCore.run();",
        "if (typeof global.AlphaCore === 'undefined') return;\n global.AlphaCore.run();",
        '(window.AlphaCore && window.AlphaCore.run());'
    ];

    guards.forEach(body => {
        const { missing } = analyse({
            js: { 'alpha-core.js': CORE, 'page.js': '(function () {\n' + body + '\n})();' },
            html: { 'p.html': '<script src="page.js"></script>' }
        });
        assert.deepEqual(missing, [], 'guarded read reported as missing:\n' + body);
    });
});

test('an exemption excuses exactly the pair it names, and nothing else', () => {
    const js = {
        'alpha-core.js': CORE,
        'page.js': '(function () { function go() { AlphaCore.run(); } })();'
    };
    const html = {
        'p.html': '<script src="page.js"></script>',
        'q.html': '<script src="page.js"></script>'
    };
    const excuse = [{ page: 'p.html', script: 'page.js', module: 'alpha-core.js', why: 'fixture' }];

    const { missing } = analyse({ js, html }, excuse);
    assert.equal(missing.length, 1);
    assert.equal(missing[0].page, 'q.html');
});
