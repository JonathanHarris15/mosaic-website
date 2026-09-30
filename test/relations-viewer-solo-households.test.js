// "Hide one-person Households" under the Relations Viewer's Households toggle:
// a Household of one person — no spouse, no children at home — draws no
// bubble. It is on by default: a bubble round one person says nothing the node
// doesn't, and there are many of them.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'relations-viewer.js'), 'utf8');

function fnSource(name) {
  const start = SRC.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  let depth = 0, i = SRC.indexOf('{', start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) break;
  }
  return SRC.slice(start, i + 1);
}

const ctx = {};
vm.runInNewContext(fnSource('hidesAsSolo') + '; this.hidesAsSolo = hidesAsSolo;', ctx);
const hh = (recorded, shown = recorded) => ({ key: 'household', recorded, memberNodes: Array.from({ length: shown }, (_, i) => ({ id: 'p' + i })) });

test('with the box ticked, a Household of one person is hidden', () => {
  assert.strictEqual(ctx.hidesAsSolo(hh(1), 'household', true), true);
});

test('a Household of two or more still draws', () => {
  assert.strictEqual(ctx.hidesAsSolo(hh(2), 'household', true), false);
  assert.strictEqual(ctx.hidesAsSolo(hh(5), 'household', true), false);
});

test('a couple with one of them hidden as inactive is still a Household of two', () => {
  assert.strictEqual(ctx.hidesAsSolo(hh(2, 1), 'household', true), false);
});

test('unticked, every Household draws, one person or not', () => {
  assert.strictEqual(ctx.hidesAsSolo(hh(1), 'household', false), false);
});

test('a one-person Relationship Group is not a Household and is never hidden by it', () => {
  assert.strictEqual(ctx.hidesAsSolo({ key: 'rel:bible-study', recorded: 1, memberNodes: [{ id: 'a' }] }, 'household', true), false);
});

test('the checkbox sits in the Households rows and starts ticked', () => {
  assert.match(SRC, /this\.hideSoloHouseholds = true;/);
  assert.match(SRC, /data-rv="hideSoloHouseholds"/);
  assert.match(SRC, /Hide one-person Households/);
});
