// Where the MCP server is served from, and why it cannot move quietly.
//
// ⚠ THE ORIGIN IS PART OF THE SECURITY, not just configuration. It is the
// issuer an assistant pins to and the audience every access token is minted
// for. If the hosting rewrites and MCP_ISSUER_URL ever name different
// origins, the failure is not a 404 — it is either nothing being able to
// connect at all, or tokens being accepted that were minted for somewhere
// else. Neither announces itself, so it is pinned here.
//
// ⚠ THE FOUR ROOT PATHS ARE NOT OURS TO RENAME. OAuth discovery fixes
// /authorize, /token, /register and /revoke at the root of whichever origin
// serves them. That is the entire reason this has its own hosting site
// instead of living on the church domain — drop one of these rewrites and
// the corresponding step of the sign-in simply stops existing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
const functionsIndex = fs.readFileSync(
    path.join(ROOT, 'functions', 'index.js'), 'utf8');

const MCP_SITE = 'mosaic-hymn-mcp';
const site = config.hosting.find(h => h.site === MCP_SITE);

const sourcesOf = () => (site.rewrites || []).map(r => r.source);

test('the MCP server has a hosting site of its own', () => {
    assert.ok(site, `no hosting entry for ${MCP_SITE} — if this moved, the ` +
        'OAuth paths may now be claiming the church domain\'s root');
    assert.notStrictEqual(site.public, 'public',
        'the MCP site must not serve the church website\'s files');
});

test('every path the sign-in flow needs is routed to the function', () => {
    const sources = sourcesOf();
    // Each of these is a step of the handshake. A missing one breaks that
    // step and nothing else, which is the hard kind of bug to spot.
    ['/mcp', '/authorize', '/token', '/register', '/revoke',
        '/oauth/**', '/.well-known/**'].forEach(needed => {
        assert.ok(sources.includes(needed),
            `${needed} is not routed to the MCP function`);
    });
});

test('every MCP rewrite goes to the mcp function and nowhere else', () => {
    (site.rewrites || []).forEach(r => {
        assert.strictEqual(r.function, 'mcp',
            `${r.source} points somewhere other than the mcp function`);
    });
});

test('the issuer the code advertises is the origin that is actually served', () => {
    const match = functionsIndex.match(
        /defineString\(\s*"MCP_ISSUER_URL"[\s\S]*?default:\s*"([^"]+)"/);
    assert.ok(match, 'MCP_ISSUER_URL is no longer declared with a default — ' +
        'if it is set some other way, this guard needs to follow it there');

    const issuer = match[1];
    assert.strictEqual(issuer, `https://${MCP_SITE}.web.app`,
        'the issuer in functions/index.js and the hosting site in ' +
        'firebase.json name different origins — sign-in will break, or ' +
        'worse, tokens minted for another origin will be accepted');
    assert.ok(!issuer.endsWith('/'),
        'the issuer must have no trailing slash — it is string-compared ' +
        'against what clients send, not normalised');
});

test('the church website is still its own separate site', () => {
    const main = config.hosting.find(h => h.site === 'mosaic-hymn-database');
    assert.ok(main, 'the church website has lost its hosting entry');
    assert.strictEqual(main.public, 'public');
    assert.ok(!main.rewrites || !main.rewrites.some(
        r => ['/authorize', '/token', '/register', '/revoke'].includes(r.source)),
    'the OAuth root paths have leaked onto the church domain');
});
