// MS-715 — the Standard order's display patch: names and note toggles only,
// ids untouched, refused before anything is written when it would do more.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {planPatch} = require('../scripts/patch-liturgy-order.js');

const ROOT = path.join(__dirname, '..');
const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/ops/ms-715-standard-order-before.json'), 'utf8'))[0];
const patch = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/ops/ms-715-standard-order-patch.json'), 'utf8'));

test('the MS-715 patch keeps every id and their order', () => {
    const plan = planPatch(before, patch);
    assert.deepEqual(plan.problems, []);
    assert.deepEqual(plan.after.map((e) => e.id), before.elements.map((e) => e.id));
});

test('the seven hymns get seven distinct names', () => {
    const plan = planPatch(before, patch);
    const hymns = plan.after.filter((e) => e.kind === 'hymn').map((e) => e.name);
    assert.equal(hymns.length, 7);
    assert.equal(new Set(hymns).size, 7, hymns.join(', '));
});

test('Call to Worship and Call to Confession take notes again', () => {
    const plan = planPatch(before, patch);
    const byId = Object.fromEntries(plan.after.map((e) => [e.id, e]));
    assert.equal(byId.callToWorship.hasNote, true);
    assert.equal(byId.callToConfession.hasNote, true);
});

test('applying the patch twice changes nothing the second time', () => {
    const once = planPatch(before, patch);
    const twice = planPatch(Object.assign({}, before, {elements: once.after}), patch);
    assert.deepEqual(twice.changes, []);
});

test('an unknown id, an id change, or another field is refused', () => {
    assert.match(planPatch(before, {elements: {hymnMid1: {name: 'X'}}}).problems.join(), /not an element/);
    assert.match(planPatch(before, {elements: {hymn: {id: 'opening'}}}).problems.join(), /cannot be patched/);
    assert.match(planPatch(before, {elements: {hymn: {kind: 'prayer'}}}).problems.join(), /cannot be patched/);
    assert.match(planPatch(before, {elements: {hymn: {name: '  '}}}).problems.join(), /empty name/);
});
