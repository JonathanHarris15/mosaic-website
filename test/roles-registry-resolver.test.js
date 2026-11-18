const { test } = require('node:test');
const assert = require('node:assert');

// RolesCore.registry — the ONE way a slug becomes a Role, for the browser and
// the functions alike (functions/roles-read.js). The server used to ask
// `where('slug', '==', x).limit(1)`: a Role stored without a slug was never
// found (so its rules were never checked), and one of two Roles sharing a slug
// was picked arbitrarily (so a take was judged against the other's rules).

const Roles = require('../public/roles-core.js');
const { loadRoleRegistry } = require('../functions/roles-read.js');

const def = (id, name, extra) => Object.assign({
    id, name, family: 'servant', slots: [{ id: 's1', requirement: 'either' }], restrictions: [],
}, extra || {});

test('a Role stored without a slug resolves by its name, as it does in the browser', () => {
    const reg = Roles.registry([def('r1', 'Sound Desk')]);
    assert.equal(reg.find('sound_desk').id, 'r1');
    assert.equal(reg.nameOf('sound_desk'), 'Sound Desk');
});

test('two Roles reading as one slug resolve to NEITHER — refused, never guessed', () => {
    const reg = Roles.registry([def('r1', 'Coffee', { slug: 'coffee' }), def('r2', 'coffee!')]);
    assert.equal(reg.find('coffee'), null);
    assert.equal(reg.nameOf('coffee'), null);
    assert.equal(reg.isAmbiguous('coffee'), true);
    assert.deepStrictEqual(reg.duplicates, ['coffee']);
});

test('a stored Role on a liturgical slug is quarantined, and the slug still names the built-in Role', () => {
    const reg = Roles.registry([def('r1', 'Prayers', { slug: 'prayer' })]);
    assert.equal(reg.find('prayer'), null);
    assert.equal(reg.quarantined.length, 1);
    assert.ok(reg.nameOf('prayer'), 'the liturgical name');
    assert.notEqual(reg.nameOf('prayer'), 'Prayers');
});

test('the server reads the whole collection through the same registry', async () => {
    const docs = [['r1', { name: 'Sound Desk' }], ['r2', { name: 'Coffee', slug: 'coffee' }]];
    const db = { collection: name => {
        assert.equal(name, 'roles');
        return { get: async () => ({ docs: docs.map(([id, d]) => ({ id, data: () => d })) }) };
    } };
    const reg = await loadRoleRegistry(db);
    assert.equal(reg.find('sound_desk').id, 'r1');
    assert.equal(reg.find('coffee').id, 'r2');
});

test('no function asks /roles for one slug any more', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(__dirname, '..', 'functions');
    fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        assert.ok(!/collection\("roles"\)\s*\.where\("slug"/.test(src), f + ' looks a Role up by stored slug');
    });
});
