// MS-704: a marriage and a parent-and-child link are both Family, and they drew
// as the same line — "I'm connected to Molly, but it looks like I'm also
// connected to the kids in the same way." A marriage is now a double line.
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

test('a spouse edge is a marriage; a parent edge and every other type are not', () => {
  const ctx = {};
  vm.runInNewContext(fnSource('isMarriage') + '; this.isMarriage = isMarriage;', ctx);
  assert.strictEqual(ctx.isMarriage({ type: 'family', rel: 'spouse' }), true);
  assert.strictEqual(ctx.isMarriage({ type: 'family', rel: 'parent' }), false);
  assert.strictEqual(ctx.isMarriage({ type: 'elder', rel: 'shepherds' }), false);
  assert.strictEqual(ctx.isMarriage({ type: 'rel:x', rel: 'spouse' }), false);
});

test('a marriage strokes two parallel lines where a parent link strokes one', () => {
  const calls = [];
  const fakeCtx = {
    beginPath() {}, moveTo(x, y) { calls.push(['M', x, y]); }, lineTo(x, y) { calls.push(['L', x, y]); },
    stroke() { calls.push(['S', this.lineWidth]); }, lineWidth: 0,
  };
  const ctx = {};
  vm.runInNewContext(fnSource('strokeEdge') + '; this.strokeEdge = strokeEdge;', ctx);
  const A = { x: 0, y: 0 }, B = { x: 100, y: 0 };

  calls.length = 0;
  ctx.strokeEdge(fakeCtx, A, B, 0, 0, 2.2, false);
  assert.strictEqual(calls.filter(c => c[0] === 'S').length, 1);

  calls.length = 0;
  ctx.strokeEdge(fakeCtx, A, B, 0, 0, 2.2, true);
  const strokes = calls.filter(c => c[0] === 'S');
  assert.strictEqual(strokes.length, 2);
  const ys = calls.filter(c => c[0] === 'M').map(c => c[2]);
  assert.ok(ys[0] < 0 && ys[1] > 0, 'the two lines sit either side of the centre: ' + ys);
  assert.ok(strokes.every(s => s[1] < 2.2), 'each of the pair is thinner than the single line');
});

test('both the single and the striped connection draw through strokeEdge with the marriage flag', () => {
  const draw = SRC.slice(SRC.indexOf('RelationsViewer.prototype.draw = function'), SRC.indexOf('RelationsViewer.prototype.drawNode'));
  const uses = draw.match(/strokeEdge\(ctx,[^;]+isMarriage\(e0?\)\)/g) || [];
  assert.strictEqual(uses.length, 2, 'single and striped paths: ' + uses);
});

test('the rail tells the reader which Family line is which', () => {
  assert.match(SRC, /data-rv="familyNote"[^<]*>[^<]*double line[^<]*marriage/i);
});
