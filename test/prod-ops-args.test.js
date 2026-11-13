const {test} = require('node:test');
const assert = require('node:assert');
const {assertSafeOpsArgsString, splitOpsArgs} = require('../scripts/prod-ops-args');

test('assertSafeOpsArgsString allows ordinary flags', () => {
    assertSafeOpsArgsString('--id textbelt-url-test --ops');
    assertSafeOpsArgsString('');
});

test('assertSafeOpsArgsString rejects shell metacharacters', () => {
    for (const bad of [';', '&', '|', '`', '$(whoami)', 'a\nb', 'a\rb']) {
        assert.throws(
            () => assertSafeOpsArgsString(bad),
            /shell metacharacters/,
            `expected rejection for ${JSON.stringify(bad)}`);
    }
});

test('splitOpsArgs tokenizes spaces and quotes', () => {
    assert.deepStrictEqual(
        splitOpsArgs('--id textbelt-url-test --ops'),
        ['--id', 'textbelt-url-test', '--ops']);
    assert.deepStrictEqual(
        splitOpsArgs('--id "text belt" --ops'),
        ['--id', 'text belt', '--ops']);
    assert.deepStrictEqual(splitOpsArgs(''), []);
});

test('splitOpsArgs rejects injection before tokenizing', () => {
    assert.throws(
        () => splitOpsArgs('--id x; rm -rf /'),
        /shell metacharacters/);
});
