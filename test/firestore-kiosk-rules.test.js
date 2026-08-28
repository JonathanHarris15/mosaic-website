const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

const blockFor = pattern => {
    const m = rules.match(pattern);
    assert.ok(m, 'no rule block matching ' + pattern);
    return m[1];
};

test('isKiosk is its own helper, not derived from another rank', () => {
    const fn = blockFor(/function isKiosk\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.match(fn, /permissionLevel\(\) == 'kiosk'/);
    assert.doesNotMatch(fn, /isAdmin|isEditor|isElder|isMember/);
});

test('people and families name isKiosk on the read rule', () => {
    const person = blockFor(/match \/people\/\{personId\}\s*\{([\s\S]*?)\n      match/);
    const families = blockFor(/match \/families\/\{familyId\}\s*\{([\s\S]*?)\n    \}/);
    assert.match(person, /allow read: if isSignedIn\(\) \|\| isKiosk\(\)/);
    assert.match(families, /allow read: if isSignedIn\(\) \|\| isKiosk\(\)/);
});

test('a kiosk cannot read elder-gated shepherding notes', () => {
    const notes = blockFor(/match \/people\/\{personId\}\/shepherding_notes\/\{noteId\}\s*\{([\s\S]*?)\n    \}/);
    assert.match(notes, /allow read, write: if isElder\(\)/);
    assert.doesNotMatch(notes, /isKiosk\(\)/);
});

test('attendance is kiosk-write, and non-kiosk cannot write it', () => {
    const block = blockFor(/match \/attendance\/\{personId\}\s*\{([\s\S]*?)\n      \}/);
    assert.match(block, /allow create, update: if isKiosk\(\)/);
    assert.doesNotMatch(block, /allow create, update: if isEditor\(\)/);
    assert.doesNotMatch(block, /allow write: if true/);
});

test('attendance is readable by the same floors as the roster, plus the kiosk', () => {
    const block = blockFor(/match \/attendance\/\{personId\}\s*\{([\s\S]*?)\n      \}/);
    assert.match(block, /isKiosk\(\)/);
    assert.match(block, /isEditor\(\)/);
    assert.match(block, /rosterShared == true/);
});

test('a kiosk can read every event occurrence, ignoring the visibility ladder', () => {
    const block = blockFor(/match \/event_occurrences\/\{occurrenceId\}\s*\{([\s\S]*?)\n      match \/attendance/);
    assert.match(block, /allow read: if isKiosk\(\)/);
});

test('a kiosk may create a Person and a Household, and cannot delete either', () => {
    const person = blockFor(/match \/people\/\{personId\}\s*\{([\s\S]*?)\n      match/);
    assert.match(person, /allow create: if isKiosk\(\)/);
    assert.doesNotMatch(person, /allow delete: if isKiosk\(\)/);
    const households = blockFor(/match \/households\/\{householdId\}\s*\{([\s\S]*?)\n    \}/);
    assert.match(households, /allow create: if isKiosk\(\)/);
    assert.match(households, /allow delete: if isEditor\(\)/);
    assert.doesNotMatch(households, /allow delete: if isKiosk\(\)/);
});

test('a kiosk may add to a Household but never rename or empty one', () => {
    const households = blockFor(/match \/households\/\{householdId\}\s*\{([\s\S]*?)\n    \}/);
    const update = households.match(/allow update: if([\s\S]*?);/);
    assert.ok(update, 'no update rule on households');
    assert.match(update[1], /isKiosk\(\)/);
    // The name may not move and nobody may be dropped — that is the whole
    // difference between a greeter growing a household and editing one.
    assert.match(update[1], /request\.resource\.data\.name == resource\.data\.name/);
    assert.match(update[1], /memberIds\.hasAll\(resource\.data\.memberIds\)/);
});
