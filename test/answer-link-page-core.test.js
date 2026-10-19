const { test } = require('node:test');
const assert = require('node:assert');

const core = require('../public/answer-link-page-core.js');

test('looksLikeAnswerToken matches the door shape gate', () => {
    assert.strictEqual(core.looksLikeAnswerToken('example'), false);
    assert.strictEqual(core.looksLikeAnswerToken('short'), false);
    assert.ok(core.looksLikeAnswerToken('123456789ABCDEFGHJ'));
});

test('readRefusalState maps invalid link codes to invalid', () => {
    assert.strictEqual(core.readRefusalState({ ok: false, code: 'not-found' }), 'invalid');
    assert.strictEqual(core.readRefusalState({
        ok: false, code: 'failed-precondition',
    }), 'invalid');
});

test('readRefusalState keeps rate-limited and closed separate', () => {
    assert.strictEqual(core.readRefusalState({ ok: false, code: 'rate-limited' }), 'limited');
    assert.strictEqual(core.readRefusalState({ ok: false, code: 'closed' }), 'closed');
    assert.strictEqual(core.readRefusalState({ ok: false, code: 'closed' }, false), 'closed');
    assert.strictEqual(core.readRefusalState({ ok: false }, true), 'closed');
    assert.strictEqual(core.readRefusalState({ ok: false }, false), null);
});

test('readRefusalState ignores success', () => {
    assert.strictEqual(core.readRefusalState({ ok: true }), null);
    assert.strictEqual(core.readRefusalState(null), null);
});

test('readCallableErrorState maps Firebase callable codes', () => {
    assert.strictEqual(core.readCallableErrorState({ code: 'functions/not-found' }), 'invalid');
    assert.strictEqual(core.readCallableErrorState({
        code: 'functions/failed-precondition',
    }), 'invalid');
    assert.strictEqual(core.readCallableErrorState({ code: 'functions/internal' }), null);
    assert.strictEqual(core.readCallableErrorState({
        code: 'functions/internal',
        details: { code: 'not-found' },
    }), 'invalid');
});
