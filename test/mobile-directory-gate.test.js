const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-197 — who the phone offers the directory to.
//
// The phone has a "Continue as guest" mode: a deliberate, remembered choice to
// use the app signed out. Every destination is filtered through
// `Destinations.canSee`, and an entry with no `permissionLevels` means
// EVERYONE — including a guest.
//
// The Membership Directory entry had no gate. So the phone offered a signed-out
// stranger a tile straight into the whole church directory, and it worked,
// because `people` was `allow read: if true`. ADR-0031 closed the collection;
// this closes the door in front of it, at the same height the web has always
// used (the dashboard card is injected for member and above).
//
// Rules and interface are different failures and both are real: the rule stops
// the DATA, this stops somebody being offered a screen they will be refused on
// arrival — which is the reasoning `canSee` already states for the gated
// entries.

const Destinations = require('../public/mobile/destinations.js');

const directory = () => {
    const d = Destinations.DESTINATIONS.find(x => x.key === 'directory');
    assert.ok(d, 'the Membership Directory destination has gone missing');
    return d;
};

test('a signed-out guest is not offered the Membership Directory', () => {
    assert.equal(Destinations.canSee(directory(), null), false,
        'the phone offers the church directory to anybody who taps "Continue as guest"');
});

test('a viewer is not offered it either — the same gate the web uses', () => {
    // A viewer is what a brand-new self-service account gets. They can read the
    // collection (ADR-0031 puts the floor at an account, so the Directory
    // Request flow works), but the SCREEN is member-and-above on the web and
    // must not be lower here.
    assert.equal(Destinations.canSee(directory(), { permissionLevel: 'viewer' }), false);
});

test('a member and above still get it', () => {
    for (const permissionLevel of ['member', 'editor', 'elder', 'admin', 'super_admin']) {
        assert.equal(Destinations.canSee(directory(), { permissionLevel }), true, permissionLevel);
    }
});

test('the Home tile carries the same gate as the drawer entry', () => {
    // Two renderings of one list (see destinations.js). The tile is declared
    // separately in app.js, so the gate has to be written twice — and a gate
    // written twice is a gate that can drift.
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile', 'app.js'), 'utf8');
    const tile = app.match(/\{[^}]*label: "Membership Directory"[^}]*\}/);
    assert.ok(tile, 'the Membership Directory tile has gone missing from Home');
    for (const permissionLevel of ['member', 'editor', 'elder', 'admin', 'super_admin']) {
        assert.ok(tile[0].includes(`"${permissionLevel}"`),
            `the Home tile does not admit ${permissionLevel}`);
    }
    assert.ok(!tile[0].includes('"viewer"'), 'the Home tile is looser than the drawer');
});
