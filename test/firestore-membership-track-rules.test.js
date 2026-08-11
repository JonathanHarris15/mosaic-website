const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The Membership Track is an editor's to walk (ADR-0012) — but every move logs
// a Membership Change into the Pastoral Record, and the Pastoral Record was
// elder-only end to end. ADR-0005 writes the move and its record in ONE batch,
// so refusing the record refused the move: the editor dragged the stage slider
// and got "Error updating membership" with nothing changed.
//
// The hole opened for that is one entry kind, create-only, self-signed. This
// file pins its edges, because the risk in a rule like that is not that it
// stops working — it is that it quietly widens.
//
// Like the other rules tests here, this pins the SHAPE. Live enforcement needs
// a real project and stays a human verification step.

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

const activityBlock = () => {
    const m = rules.match(/match \/people\/\{personId\}\/shepherding_activity\/\{activityId\}\s*\{([\s\S]*?)\n {4}\}/);
    assert.ok(m, 'the shepherding_activity rule block is gone');
    return m[1];
};

const activityGroupBlock = () => {
    const m = rules.match(/match \/\{path=\*\*\}\/shepherding_activity\/\{activityId\}\s*\{([\s\S]*?)\n {4}\}/);
    assert.ok(m, 'the shepherding_activity collection-group rule block is gone');
    return m[1];
};

test('an editor may append the record of a Track move', () => {
    // Without this the slider is decoration: the batch is atomic, so the person
    // update goes back with the record.
    const block = activityBlock();
    assert.match(block, /allow create[\s\S]*isEditor\(\)/,
        'an editor cannot log a Membership Change, so an editor cannot move anybody');
    assert.match(block, /request\.resource\.data\.kind == 'membership_change'/,
        'the editor hole is not limited to the one entry kind it exists for');
});

test('an editor signs their own entry', () => {
    // The Membership Change names who made the move. An entry that could carry
    // somebody else's uid is not a record of anything.
    assert.match(activityBlock(), /request\.resource\.data\.authorUid == request\.auth\.uid/,
        'an editor can file a Membership Change under another person\'s name');
});

test('the Pastoral Record stays elder-only to READ', () => {
    // The whole point of the boundary. An editor walks the Track; the pastoral
    // history around it — notes, status changes, tag changes — is not theirs.
    const block = activityBlock();
    assert.match(block, /allow read: if isElder\(\);/,
        'the Pastoral Record is readable by somebody below an elder');
    assert.doesNotMatch(block, /allow read[^\n]*isEditor\(\)/,
        'the read rule has picked up isEditor');
    assert.match(activityGroupBlock(), /allow read: if isElder\(\);/,
        'the collection-group read is the same record by another door');
});

test('an entry cannot be edited or erased by an editor', () => {
    // Append-only for them. A history somebody can rewrite is not a history,
    // and revertPastoralChange (which deletes) is an elder surface.
    const block = activityBlock();
    assert.match(block, /allow update, delete: if isElder\(\);/,
        'update/delete is no longer elder-only');
    assert.doesNotMatch(block, /allow write/,
        'a blanket write rule is back, which would hand an editor delete as well');
});
