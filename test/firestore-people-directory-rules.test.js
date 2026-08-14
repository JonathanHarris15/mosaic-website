const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-197 — the directory boundary.
//
// Every Person record — name, email, phone number, home address — used to be
// `allow read: if true`. Not "loosely protected": open to anybody who could
// reach the endpoint, which is anybody. So were the households, the tag
// vocabulary, who served what, and who was prayed for. ADR-0031 closes all of
// it to `request.auth != null`.
//
// Like the other rules tests here, this pins the SHAPE rather than exercising
// it: live enforcement needs a real project and stays a human verification
// step. The emulator harness in test/emulator/ cannot stand in — it drives
// Firestore through the Admin SDK, which bypasses rules entirely.
//
// TWO FAILURES ARE GUARDED AGAINST, AND THEY POINT OPPOSITE WAYS.
//   1. A rule drifting back to `if true` in an unrelated edit. That is how the
//      directory got here, and it does not look like a bug in a diff.
//   2. Somebody "tightening" the floor to isMember(). That reads like an
//      improvement and breaks the Directory Request flow (ADR-0025, ADR-0027):
//      a brand-new account has no Person and no rank, and searching the
//      directory for their own name is how they get one. The floor is an
//      ACCOUNT, deliberately, and moving it should cost an argument.
//
// Follows the pattern of firestore-away-rules.test.js.

// Normalised to LF — the block patterns close on `\n    }`, which never matches
// a CRLF checkout, leaving the shape they pin unchecked.
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

const blockFor = pattern => {
    const m = rules.match(pattern);
    assert.ok(m, 'no rule block matching ' + pattern);
    return m[1];
};

// The Person document itself, cut at its first subcollection so the nested
// rules (involvement, away, prayer requests) are not read as part of it.
const personBlock = () => blockFor(/match \/people\/\{personId\}\s*\{([\s\S]*?)\n      match/);

// Everything MS-197 closed, by the name it is known by.
const DIRECTORY = {
    'the Person record': personBlock,
    'a Person\'s involvement': () => blockFor(/match \/involvement\/\{involvementId\}\s*\{([\s\S]*?)\n      \}/),
    'involvement across everybody': () => blockFor(/match \/\{path=\*\*\}\/involvement\/\{involvementId\}\s*\{([\s\S]*?)\n    \}/),
    'a Person\'s pastoral prayer history': () => blockFor(/match \/pastoral_prayer_history\/\{historyId\}\s*\{([\s\S]*?)\n      \}/),
    'pastoral prayer history across everybody': () => blockFor(/match \/\{path=\*\*\}\/pastoral_prayer_history\/\{historyId\}\s*\{([\s\S]*?)\n    \}/),
    'Families': () => blockFor(/match \/families\/\{familyId\}\s*\{([\s\S]*?)\n    \}/),
    'the directory tag vocabulary': () => blockFor(/match \/people_tags\/\{tagId\}\s*\{([\s\S]*?)\n    \}/),
};

// ── Closed to the open internet ──────────────────────────────────────────────

for (const [name, block] of Object.entries(DIRECTORY)) {
    test(`${name} is not world-readable`, () => {
        assert.doesNotMatch(
            block(),
            /allow read[^\n]*if true/,
            `${name} is open to anybody who can reach the endpoint — see ADR-0031`
        );
    });

    test(`${name} requires an account to read`, () => {
        assert.match(
            block(),
            /allow read: if isSignedIn\(\)/,
            `${name} must ask for a signed-in reader`
        );
    });

    test(`${name} is not readable by an anonymous session`, () => {
        // ⚠ `request.auth != null` IS NOT AN ACCOUNT, and this project is one
        // where that matters: anonymous sign-in is enabled, so anybody holding
        // the public API key (it ships in the browser, by design) can mint a
        // token in ONE request, with no email and no sign-up form, and satisfy
        // it. That is how this shipped the first time, and it made the whole
        // boundary decorative.
        assert.doesNotMatch(
            block(),
            /allow read: if request\.auth != null/,
            `${name} accepts a bare auth token — an anonymous session passes that`
        );
    });
}

test('isSignedIn excludes anonymous sessions', () => {
    // The one place the distinction is made. Every directory rule above asks
    // this rather than restating it, so there is one thing to get right.
    const fn = blockFor(/function isSignedIn\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.match(fn, /request\.auth != null/);
    assert.match(fn, /sign_in_provider != 'anonymous'/,
        'isSignedIn does not exclude anonymous — it is then just request.auth != null');
});

// ── The floor is an account, not a rank ──────────────────────────────────────

test('no directory read is gated on membership or any other rank', () => {
    // The tempting "improvement" that breaks the flow which MAKES people
    // members. Whoever raises this floor should have to come here and say why.
    for (const [name, block] of Object.entries(DIRECTORY)) {
        const readLines = block().split('\n').filter(l => /allow read/.test(l)).join('\n');
        assert.doesNotMatch(
            readLines,
            /isMember\(\)|isEditor\(\)|isElder\(\)|isAdmin\(\)|permissionLevel\(\)/,
            `${name} is gated on a rank — a new account cannot find itself in the directory ` +
            'to raise a Match Request (ADR-0025, ADR-0027, ADR-0031)'
        );
    }
});

// ── Writes are untouched ─────────────────────────────────────────────────────

test('writing the directory is still editor-only', () => {
    // MS-197 changed who may READ. A write rule that moved with it would be a
    // change nobody asked for, hiding inside a security fix.
    assert.match(personBlock(), /allow create, delete: if isEditor\(\)/);
    assert.match(personBlock(), /allow update: if isEditor\(\)/);
    assert.match(DIRECTORY['Families'](), /allow create, update, delete: if isEditor\(\)/);
    assert.match(DIRECTORY['the directory tag vocabulary'](), /allow create, update, delete: if isEditor\(\)/);
});

test('a Linked User can still edit their own record', () => {
    // The self-service clause (MS-87, ADR-0012, ADR-0029). Closing reads must
    // not have disturbed it.
    const block = personBlock();
    assert.match(block, /resource\.data\.userId == request\.auth\.uid/);
    assert.match(block, /hasOnly\(\['contact', 'birthday', 'sex', 'photoUrl', 'photoPath', 'photoCrop', 'updatedAt'\]\)/);
});

test('neither collection-group rule grants a write', () => {
    // A write from a `{path=**}` rule is a write to anybody's record from any
    // path. Neither of these has ever granted one; neither should start.
    assert.doesNotMatch(DIRECTORY['involvement across everybody'](), /allow (create|update|delete|write)/);
    assert.doesNotMatch(DIRECTORY['pastoral prayer history across everybody'](), /allow (create|update|delete|write)/);
});

// ── The negative space: what must STAY public ────────────────────────────────
//
// The failure on the other side of this change is closing the printed booklet
// to the congregation it is printed for. A visitor is meant to be able to find
// out when the church meets and read Sunday's guide without an account.

const PUBLIC_ON_PURPOSE = {
    'the weekly Service': /match \/services\/\{dateId\}\s*\{([\s\S]*?)\n    \}/,
    'the hymn catalogue': /match \/hymns\/\{hymnId\}\s*\{([\s\S]*?)\n    \}/,
    'Style Presets': /match \/style_presets\/\{presetId\}\s*\{([\s\S]*?)\n    \}/,
    'Page Templates': /match \/page_templates\/\{templateId\}\s*\{([\s\S]*?)\n    \}/,
    'Service Guide Templates': /match \/guide_templates\/\{templateId\}\s*\{([\s\S]*?)\n    \}/,
    'the Asset Library': /match \/guide_assets\/\{assetId\}\s*\{([\s\S]*?)\n    \}/,
};

for (const [name, pattern] of Object.entries(PUBLIC_ON_PURPOSE)) {
    test(`${name} is still readable without an account`, () => {
        assert.match(
            blockFor(pattern),
            /allow read: if true/,
            `${name} feeds the congregant-facing Service Guide — closing it closes the booklet`
        );
    });
}

test('the Sunday Service series is still named as permanently public', () => {
    // ADR-0018 named it rather than stamping it so the Services page keeps
    // working with no migration. Nothing in MS-197 touches that.
    assert.match(
        blockFor(/match \/events\/\{eventId\}\s*\{([\s\S]*?)\n    \}/),
        /eventId == 'sunday_service'/
    );
});

// ── What the directory closing does NOT reach ────────────────────────────────

test('Away is still narrower than the directory', () => {
    // MS-188 built Away into a subcollection because the Person record was open
    // to the world. That reason is gone; the decision is not. A member has no
    // business knowing who is on holiday, so Away stays at editors-and-self
    // while the directory sits at any-account. If these two ever converge,
    // somebody has widened Away by accident.
    const away = blockFor(/match \/away\/\{stretchId\}\s*\{([\s\S]*?)\n      \}/);
    assert.match(away, /isEditor\(\)/);
    assert.match(away, /personId == myPersonId\(\)/);
    assert.doesNotMatch(
        away,
        /allow read[^\n]*if request\.auth != null;/,
        'Away has been flattened to the directory boundary — re-read ADR-0023'
    );
});

test('Shepherding data is still elder-only', () => {
    // The directory closing is a floor, not a ceiling. Nothing pastoral moves.
    const notes = blockFor(/match \/people\/\{personId\}\/shepherding_notes\/\{noteId\}\s*\{([\s\S]*?)\n    \}/);
    const requests = blockFor(/match \/prayer_requests\/\{requestId\}\s*\{([\s\S]*?)\n      \}/);
    assert.match(notes, /allow read, write: if isElder\(\)/);
    assert.match(requests, /allow read, write: if isElder\(\)/);
});
