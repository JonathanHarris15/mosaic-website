// MS-706: the Membership Stage key names six colours, and the stage pip on each
// node is meant to wear one of them. The pip was handed `var(--sand)` and the
// like straight from STAGE — a canvas ignores a colour it cannot parse and keeps
// the last one set, so every pip drew in the node's initials colour and the key
// matched nothing on the graph. The Family and Elder Assignment lines, the
// Prioritized arrowheads and the leader ring had the same fault.
//
// Every colour handed to the canvas must be a literal or pass through tok() /
// paint() / hexA(), the three helpers that turn a token into a real colour.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'relations-viewer.js'), 'utf8');

const RESOLVED = /^(?:paint\(|tok\(|self\.hexA\(|this\.hexA\(|'(?:#|rgba?\())/;
// A bare identifier in a ternary is its condition (`sel`, `n.inactive`), not a
// colour — except the palette reads, which are exactly what this is looking for.
const isCondition = s => /^[\w.!]+$/.test(s) && !/\.colou?r$|^lead$/.test(s);

function canvasColours(src) {
  const out = [];
  const re = /(fillStyle|strokeStyle) = ([^;]+);/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    m[2].split(/\s[?:]\s/).map(s => s.trim().replace(/^\(|\)$/g, ''))
      .filter(s => s && !isCondition(s))
      .forEach(value => out.push({ line, prop: m[1], value }));
  }
  return out;
}

test('every colour the viewer hands the canvas is resolved from its token first', () => {
  const found = canvasColours(SRC);
  assert.ok(found.length > 15, 'the scan found the canvas paints (' + found.length + ')');
  const raw = found.filter(f => !RESOLVED.test(f.value));
  assert.deepStrictEqual(raw, [], 'unresolved canvas colours — wrap them in paint()');
});

test('the scan catches the shape of the MS-706 bug', () => {
  const bad = canvasColours("ctx.fillStyle = stageOf(n).color; ctx.strokeStyle = def.color; ctx.strokeStyle = lead;");
  assert.deepStrictEqual(bad.filter(f => !RESOLVED.test(f.value)).map(f => f.value),
    ['stageOf(n).color', 'def.color', 'lead']);
});

test('diamond() is only ever handed a resolved colour', () => {
  const calls = SRC.match(/\.diamond\([^;]+;/g) || [];
  assert.ok(calls.length > 0);
  calls.forEach(c => assert.match(c, /paint\(/, c));
});

test('the stage palette the legend and pips share is still tokens, not hexes', () => {
  // The legend paints with CSS (var() is right there); only the canvas needs
  // paint(). Keeping one palette is what makes the key and the pips agree.
  const block = SRC.slice(SRC.indexOf('var STAGE = {'), SRC.indexOf('var STAGE_ORDER'));
  const colours = block.match(/color: '([^']+)'/g) || [];
  assert.strictEqual(colours.length, 6);
  colours.forEach(c => assert.match(c, /var\(--/));
});
