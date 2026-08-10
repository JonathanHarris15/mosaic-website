const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const sync = require('../scripts/sync-shared-to-functions.js');

// `functions/` deploys as its own bundle, so it cannot require across into
// `public/`. The domain modules the server needs are therefore COPIED, and
// these are the tests that stop the copies drifting.
//
// ⚠ WHY IT MATTERS MORE HERE THAN USUAL. The copied logic decides whether a
// member may take a place off the cover list (ADR-0030). A divergence would be
// invisible in the worst possible way: the server would permit what the screen
// refuses, or refuse what it offers, and a test of either half alone would pass.

test('every shared copy matches the module it was taken from', () => {
    sync.MODULES.forEach(name => {
        const at = sync.copyPath(name);
        assert.ok(fs.existsSync(at), name + ' has never been synced');
        assert.equal(
            fs.readFileSync(at, 'utf8'),
            sync.expected(name),
            name + ' is stale — run: node scripts/sync-shared-to-functions.js'
        );
    });
});

test('a copy carries a banner saying not to edit it', () => {
    sync.MODULES.forEach(name => {
        const text = fs.readFileSync(sync.copyPath(name), 'utf8');
        assert.ok(/GENERATED FILE — DO NOT EDIT/.test(text), name);
        assert.ok(text.indexOf('public/' + name) !== -1,
            name + ' should name the original it came from');
    });
});

// The closure has to be complete. A module that requires something absent from
// `functions/shared` would throw the first time a callable touched it — at
// runtime, in production, on somebody's decline.
test('the shared modules require nothing that was not copied too', () => {
    sync.MODULES.forEach(name => {
        const text = sync.sourceOf(name);
        const requires = [...text.matchAll(/require\('\.\/([\w.-]+)'\)/g)]
            .map(m => m[1]);
        requires.forEach(dep => {
            assert.ok(sync.MODULES.indexOf(dep) !== -1,
                name + ' requires ' + dep + ', which is not in the copied set');
        });
    });
});

test('every shared copy actually loads under Node', () => {
    sync.MODULES.forEach(name => {
        const loaded = require(sync.copyPath(name));
        assert.ok(loaded && typeof loaded === 'object', name + ' exported nothing');
    });
});

// The point of the whole exercise: the server's answer and the client's answer
// come from one authored module, so they cannot disagree.
test('the server and the browser load the same eligibility module', () => {
    const server = require(sync.copyPath('cover-core.js'));
    const client = require('../public/cover-core.js');

    assert.deepEqual(Object.keys(server).sort(), Object.keys(client).sort());
    assert.deepEqual(server.REASONS, client.REASONS);
});
