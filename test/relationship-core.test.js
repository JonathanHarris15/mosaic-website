const { test } = require('node:test');
const assert = require('node:assert');

const Rel = require('../public/relationship-core.js');

const A = 'a', B = 'b', C = 'c';
const nameOf = id => ({ a: 'Alice', b: 'Bob', c: 'Cara' }[id] || id);

// ── Legacy (pre-MS-97) Relationship Types: a name + a `directional` flag. ──────
// These remain readable during rollout (ADR-0014 §6: defensive old-shape reads).
const mentors = { id: 't1', name: 'mentors', directional: true };
const dating = { id: 't2', name: 'dating', directional: false };

// ── Enriched (MS-97 / ADR-0014) Relationship Types: kind × priority. ───────────
const discipleship = {
    id: 't3', name: 'Discipleship', kind: 'pairwise', priority: true,
    holderLabel: 'Discipler', counterpartLabel: 'Disciplee',
};
const friendship = {
    id: 't4', name: 'Friendship', kind: 'pairwise', priority: false,
    label: 'Friend',
};
const bibleStudy = {
    id: 't5', name: 'Bible Study', kind: 'group', priority: true,
    leaderLabel: 'Leader', memberLabel: 'Member',
};
const prayerCircle = {
    id: 't6', name: 'Prayer Circle', kind: 'group', priority: false,
    label: 'Participant',
};

test('edgesForPerson returns edges where the Person is either end', () => {
    const rels = [
        { id: 'e1', fromId: A, toId: B, typeId: 't1' },
        { id: 'e2', fromId: C, toId: A, typeId: 't2' },
        { id: 'e3', fromId: B, toId: C, typeId: 't1' },
    ];
    assert.deepStrictEqual(Rel.edgesForPerson(rels, A).map(e => e.id).sort(), ['e1', 'e2']);
    assert.deepStrictEqual(Rel.edgesForPerson(rels, C).map(e => e.id).sort(), ['e2', 'e3']);
});

test('findTypeByName reuses an existing type case-insensitively, else null', () => {
    const types = [mentors, dating];
    assert.strictEqual(Rel.findTypeByName(types, 'Mentors'), mentors);
    assert.strictEqual(Rel.findTypeByName(types, 'DATING'), dating);
    assert.strictEqual(Rel.findTypeByName(types, 'roommate'), null); // genuinely new
    assert.strictEqual(Rel.findTypeByName(types, ''), null);
});

// ── The four kind × priority shapes ───────────────────────────────────────────

test('a Prioritized Pairwise type has a holder and a counterpart side, each with its own label', () => {
    assert.deepStrictEqual(Rel.sidesForType(discipleship), ['holder', 'counterpart']);
    assert.strictEqual(Rel.labelForSide(discipleship, 'holder'), 'Discipler');
    assert.strictEqual(Rel.labelForSide(discipleship, 'counterpart'), 'Disciplee');
    assert.strictEqual(Rel.priorityHolderSide(discipleship), 'holder');
    assert.strictEqual(Rel.oppositeSide(discipleship, 'holder'), 'counterpart');
    assert.strictEqual(Rel.oppositeSide(discipleship, 'counterpart'), 'holder');
});

test('a Non-Prioritized Pairwise type has one symmetric side reading the single Label', () => {
    assert.deepStrictEqual(Rel.sidesForType(friendship), ['peer']);
    assert.strictEqual(Rel.labelForSide(friendship, 'peer'), 'Friend');
    assert.strictEqual(Rel.priorityHolderSide(friendship), null);
    assert.strictEqual(Rel.oppositeSide(friendship, 'peer'), 'peer'); // symmetric: its own opposite
});

test('a Prioritized Group type has a leader and a member side, each with its own label', () => {
    assert.deepStrictEqual(Rel.sidesForType(bibleStudy), ['leader', 'member']);
    assert.strictEqual(Rel.labelForSide(bibleStudy, 'leader'), 'Leader');
    assert.strictEqual(Rel.labelForSide(bibleStudy, 'member'), 'Member');
    assert.strictEqual(Rel.priorityHolderSide(bibleStudy), 'leader');
    assert.strictEqual(Rel.oppositeSide(bibleStudy, 'leader'), 'member');
});

test('a Non-Prioritized Group type is a flat roster with one member side and no leader', () => {
    assert.deepStrictEqual(Rel.sidesForType(prayerCircle), ['member']);
    assert.strictEqual(Rel.labelForSide(prayerCircle, 'member'), 'Participant');
    assert.strictEqual(Rel.priorityHolderSide(prayerCircle), null);
});

// ── Validation ────────────────────────────────────────────────────────────────

test('validateType accepts each of the four kind x priority shapes', () => {
    for (const t of [discipleship, friendship, bibleStudy, prayerCircle]) {
        assert.strictEqual(Rel.validateType(t).valid, true, `${t.name} should be valid`);
    }
});

test('validateType rejects a Prioritized type missing a role label', () => {
    const noCounterpart = { name: 'Discipleship', kind: 'pairwise', priority: true, holderLabel: 'Discipler' };
    const noMemberLabel = { name: 'Bible Study', kind: 'group', priority: true, leaderLabel: 'Leader' };
    assert.strictEqual(Rel.validateType(noCounterpart).valid, false);
    assert.strictEqual(Rel.validateType(noMemberLabel).valid, false);
});

test('validateType rejects a Non-Prioritized type with no Label, and an unknown kind', () => {
    assert.strictEqual(Rel.validateType({ name: 'Friendship', kind: 'pairwise', priority: false }).valid, false);
    assert.strictEqual(Rel.validateType({ name: 'Odd', kind: 'triad', priority: false, label: 'x' }).valid, false);
    assert.strictEqual(Rel.validateType({ kind: 'pairwise', priority: false, label: 'x' }).valid, false); // no name
});

test('validateEdit refuses to change a type kind, but allows priority and labels to change', () => {
    const flipKind = Rel.validateEdit(discipleship, { kind: 'group' });
    assert.strictEqual(flipKind.valid, false);
    assert.match(flipKind.errors.join(' '), /kind is immutable/i);

    const relabel = Rel.validateEdit(discipleship, { holderLabel: 'Mentor', counterpartLabel: 'Mentee' });
    assert.strictEqual(relabel.valid, true);

    // Prioritized -> Non-Prioritized must supply the symmetric Label to stay valid.
    assert.strictEqual(Rel.validateEdit(discipleship, { priority: false, label: 'Peer' }).valid, true);
    assert.strictEqual(Rel.validateEdit(discipleship, { priority: false }).valid, false);
});

// ── Migration mapping (legacy `directional` -> kind x priority) ────────────────

test('migrateTypeDoc maps a directional type to a Prioritized Pairwise type, seeding both labels from the name', () => {
    const migrated = Rel.migrateTypeDoc(mentors);
    assert.strictEqual(migrated.kind, 'pairwise');
    assert.strictEqual(migrated.priority, true);
    assert.strictEqual(migrated.holderLabel, 'mentors');
    assert.strictEqual(migrated.counterpartLabel, 'mentors');
    assert.strictEqual('directional' in migrated, false); // the retired flag is dropped
    assert.strictEqual(Rel.validateType(migrated).valid, true);
});

test('migrateTypeDoc maps a non-directional type to a Non-Prioritized Pairwise type', () => {
    const migrated = Rel.migrateTypeDoc(dating);
    assert.strictEqual(migrated.kind, 'pairwise');
    assert.strictEqual(migrated.priority, false);
    assert.strictEqual(migrated.label, 'dating');
    assert.strictEqual('directional' in migrated, false);
    assert.strictEqual(Rel.validateType(migrated).valid, true);
});

test('migrateTypeDoc is idempotent — re-running it on a migrated type changes nothing', () => {
    const once = Rel.migrateTypeDoc(mentors);
    const twice = Rel.migrateTypeDoc(once);
    assert.deepStrictEqual(twice, once);
    assert.strictEqual(Rel.needsMigration(mentors), true);
    assert.strictEqual(Rel.needsMigration(once), false);
    assert.strictEqual(Rel.needsMigration(discipleship), false);
});

// ── Describing a Pairwise Relationship on a Person's profile ──────────────────

test('a Prioritized Pairwise Relationship reads oriented, and labels each side from the viewer out', () => {
    const edge = { fromId: A, toId: B, typeId: 't3' }; // fromId is the priority holder
    const onAlice = Rel.describeRelationship(edge, discipleship, A, nameOf);
    const onBob = Rel.describeRelationship(edge, discipleship, B, nameOf);

    assert.strictEqual(onAlice.otherId, B);
    assert.strictEqual(onAlice.viewerSide, 'holder');
    assert.strictEqual(onAlice.viewerLabel, 'Discipler');
    assert.strictEqual(onAlice.otherLabel, 'Disciplee');

    assert.strictEqual(onBob.otherId, A);
    assert.strictEqual(onBob.viewerSide, 'counterpart');
    assert.strictEqual(onBob.viewerLabel, 'Disciplee');
    assert.strictEqual(onBob.otherLabel, 'Discipler');

    // Oriented: the sentence reads the same from both ends.
    assert.strictEqual(onAlice.sentence, 'Alice (Discipler) → Bob (Disciplee)');
    assert.strictEqual(onBob.sentence, onAlice.sentence);
    assert.strictEqual(onAlice.prioritized, true);
});

test('a Non-Prioritized Pairwise Relationship reads symmetrically, with no oriented sentence', () => {
    const edge = { fromId: A, toId: B, typeId: 't4' };
    const onAlice = Rel.describeRelationship(edge, friendship, A, nameOf);
    const onBob = Rel.describeRelationship(edge, friendship, B, nameOf);

    assert.strictEqual(onAlice.sentence, null);
    assert.strictEqual(onAlice.typeName, 'Friendship');
    assert.strictEqual(onAlice.viewerLabel, 'Friend');
    assert.strictEqual(onAlice.otherLabel, 'Friend');
    assert.strictEqual(onAlice.otherId, B);
    assert.strictEqual(onBob.otherId, A);
    assert.strictEqual(onAlice.prioritized, false);
});

// ── Defensive old-shape reads (ADR-0014 §6) ───────────────────────────────────
// Until the backfill has run, the app still meets legacy `directional` docs.
// They must keep rendering exactly as they did before MS-97.

test('a legacy directional type still renders its original oriented sentence', () => {
    const edge = { fromId: A, toId: B, typeId: 't1' };
    const onAlice = Rel.describeRelationship(edge, mentors, A, nameOf);
    const onBob = Rel.describeRelationship(edge, mentors, B, nameOf);
    assert.strictEqual(onAlice.sentence, 'Alice mentors Bob');
    assert.strictEqual(onBob.sentence, 'Alice mentors Bob'); // oriented, identical
    assert.strictEqual(onAlice.otherId, B);
    assert.strictEqual(onBob.otherId, A);
    assert.strictEqual(onAlice.prioritized, true);
});

test('a legacy non-directional type still renders symmetrically', () => {
    const edge = { fromId: A, toId: B, typeId: 't2' };
    const onAlice = Rel.describeRelationship(edge, dating, A, nameOf);
    assert.strictEqual(onAlice.sentence, null);
    assert.strictEqual(onAlice.typeName, 'dating');
    assert.strictEqual(onAlice.otherId, B);
    assert.strictEqual(onAlice.prioritized, false);
});

// ── Guards on malformed / mis-addressed reads ─────────────────────────────────

test('a Prioritized type missing its role labels yields no sentence rather than a broken one', () => {
    // Malformed (validateType rejects it) but a defensive read can still meet it.
    const malformed = { id: 't9', name: 'Discipleship', kind: 'pairwise', priority: true };
    const edge = { fromId: A, toId: B, typeId: 't9' };
    const desc = Rel.describeRelationship(edge, malformed, A, nameOf);
    assert.strictEqual(desc.sentence, null); // not 'Alice  Bob'
    assert.strictEqual(desc.typeName, 'Discipleship'); // the panel still has something to show
});

test('describing an edge the viewer is not part of returns nothing, rather than guessing a side', () => {
    const edge = { fromId: A, toId: B, typeId: 't3' };
    assert.strictEqual(Rel.describeRelationship(edge, discipleship, C, nameOf), null);
});

// ── The doc as it should be stored ────────────────────────────────────────────

test('canonicalType strips the label fields the current shape does not use', () => {
    // An elder flips Discipleship down to Non-Prioritized: the old role labels
    // must not linger in the doc, ready to resurrect if it is flipped back.
    const flipped = Rel.canonicalType({ ...discipleship, priority: false, label: 'Peer' });
    assert.strictEqual(flipped.label, 'Peer');
    assert.strictEqual('holderLabel' in flipped, false);
    assert.strictEqual('counterpartLabel' in flipped, false);

    // And back the other way: the symmetric Label goes when it stops applying.
    const prioritized = Rel.canonicalType({ ...friendship, priority: true, holderLabel: 'Discipler', counterpartLabel: 'Disciplee' });
    assert.strictEqual('label' in prioritized, false);
    assert.strictEqual(prioritized.holderLabel, 'Discipler');
});

test('canonicalType retires the legacy directional flag', () => {
    const stored = Rel.canonicalType(mentors);
    assert.strictEqual('directional' in stored, false);
    assert.strictEqual(stored.kind, 'pairwise');
    assert.strictEqual(stored.priority, true);
    assert.strictEqual(Rel.validateType(stored).valid, true);
});

test('a migrated directional type still reads as its original verb phrase', () => {
    // The backfill seeds holderLabel = counterpartLabel = the old name (ADR-0014 §6),
    // which is the signal that an elder has not yet given the type real role labels.
    // Until they do, the Relationship must read exactly as it did before the migration
    // rather than degrading to "Alice (mentors) → Bob (mentors)".
    const edge = { fromId: A, toId: B, typeId: 't1' };
    const migrated = Rel.migrateTypeDoc(mentors);
    const onAlice = Rel.describeRelationship(edge, migrated, A, nameOf);
    assert.strictEqual(onAlice.sentence, 'Alice mentors Bob');

    // Once an elder gives it distinct role labels, it reads with them.
    const relabelled = { ...migrated, holderLabel: 'Mentor', counterpartLabel: 'Mentee' };
    const after = Rel.describeRelationship(edge, relabelled, A, nameOf);
    assert.strictEqual(after.sentence, 'Alice (Mentor) → Bob (Mentee)');
});
