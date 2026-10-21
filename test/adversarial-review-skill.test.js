const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const CHECKS = [
    'Dead code',
    'Duplicate or overlapping data structures',
    'Legacy fallbacks',
    'Missing behavior tests',
    'Unhandled errors',
];

test('code-review owns the adversarial checklist and the verdict lines', () => {
    const skill = read('.cursor/skills/code-review/SKILL.md');
    for (const item of CHECKS) assert.match(skill, new RegExp(item));
    assert.match(skill, /Adversarial review: PASS/);
    assert.match(skill, /Adversarial review: FAIL/);
    assert.match(skill, /new subagent/i);
    assert.match(skill, /`HEAD` sha/);
});

test('implement, pr, and conventions require a fresh PASS before merge', () => {
    const implement = read('.cursor/skills/implement/SKILL.md');
    const pr = read('.cursor/skills/pr/SKILL.md');
    const spec = read('.cursor/skills/implement-spec/SKILL.md');
    const conventions = read('.cursor/skills/MOSAIC-CONVENTIONS.md');
    const rule = read('.cursor/rules/mosaic-skills.mdc');
    for (const text of [implement, pr, spec, conventions, rule]) {
        assert.match(text, /Adversarial review: PASS/);
        assert.match(text, /code-review/);
    }
    assert.match(implement, /new subagent/i);
    assert.match(pr, /new subagent/i);
    assert.match(spec, /new subagent/i);
    assert.match(implement, /did not write these commits/);
});
