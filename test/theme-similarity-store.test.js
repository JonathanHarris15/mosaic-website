const { test } = require('node:test');
const assert = require('node:assert');

const ThemeSimilarity = require('../public/theme-similarity-store.js');

// createSession's whole job is: debounce, memoize, and never let a stale
// response land after a newer one superseded it. Uses node:test's built-in
// fake timers rather than a real setTimeout — a debounce test that actually
// waits out its own debounce is slow and still leaves the "does cancel()
// really stop it" question unanswered by construction.

function fakeCallable(impl) {
    const calls = [];
    const fn = async (arg) => {
        calls.push(arg);
        return { data: await impl(arg) };
    };
    fn.calls = calls;
    return fn;
}

// node:test's mock timers only fire a callback synchronously on tick() — an
// async callback (ours awaits the callable) still needs a turn of the real
// event loop to run past its first `await`. setImmediate is untouched since
// only 'setTimeout' is mocked below.
function flush() {
    return new Promise(resolve => setImmediate(resolve));
}

test('text shorter than the minimum resolves immediately, with no call and no timer', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const callable = fakeCallable(async () => ({ uniqueness: 50, matches: [] }));
    const session = ThemeSimilarity.createSession({ scoreThemeCallable: callable });

    let result = 'not called';
    session.scoreDebounced('Ab', '2026-08-30', (r) => { result = r; }, () => assert.fail('onError'));

    assert.strictEqual(result, null);
    assert.strictEqual(callable.calls.length, 0);
});

test('a debounced call fires the callable once, after the delay, and reports the result — passing excludeDate through', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const callable = fakeCallable(async ({ text }) => ({ uniqueness: 42, matches: [{ text }] }));
    const session = ThemeSimilarity.createSession({ scoreThemeCallable: callable, debounceMs: 600 });

    let result;
    session.scoreDebounced('The God Who Rescues', '2026-08-30', (r) => { result = r; }, () => assert.fail('onError'));

    assert.strictEqual(callable.calls.length, 0, 'not called before the debounce elapses');
    t.mock.timers.tick(600);
    await flush();

    assert.strictEqual(callable.calls.length, 1);
    assert.deepStrictEqual(callable.calls[0], { text: 'The God Who Rescues', excludeDate: '2026-08-30' });
    assert.strictEqual(result.uniqueness, 42);
});

test('no excludeDate is sent as null, not undefined or omitted', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const callable = fakeCallable(async () => ({ uniqueness: 1, matches: [] }));
    const session = ThemeSimilarity.createSession({ scoreThemeCallable: callable, debounceMs: 600 });

    session.scoreDebounced('The God Who Rescues', null, () => {}, () => assert.fail('onError'));
    t.mock.timers.tick(600);
    await flush();

    assert.strictEqual(callable.calls[0].excludeDate, null);
});

test('typing again before the debounce elapses restarts it and only the last keystroke calls out', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const callable = fakeCallable(async ({ text }) => ({ uniqueness: 1, matches: [{ text }] }));
    const session = ThemeSimilarity.createSession({ scoreThemeCallable: callable, debounceMs: 600 });

    session.scoreDebounced('The God Who Res', '2026-08-30', () => assert.fail('stale result delivered'), () => {});
    t.mock.timers.tick(300);
    await flush(); // not yet elapsed
    let result;
    session.scoreDebounced('The God Who Rescues', '2026-08-30', (r) => { result = r; }, () => assert.fail('onError'));
    t.mock.timers.tick(600);
    await flush();

    assert.strictEqual(callable.calls.length, 1, 'only the final keystroke should reach the network');
    assert.strictEqual(callable.calls[0].text, 'The God Who Rescues');
    assert.strictEqual(result.matches[0].text, 'The God Who Rescues');
});

test('cancel() silences a call already in flight', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const callable = fakeCallable(async ({ text }) => ({ uniqueness: 1, matches: [{ text }] }));
    const session = ThemeSimilarity.createSession({ scoreThemeCallable: callable, debounceMs: 600 });

    session.scoreDebounced('The God Who Rescues', '2026-08-30', () => assert.fail('should have been cancelled'), () => {});
    session.cancel(); // e.g. the field was cleared before the debounce elapsed
    t.mock.timers.tick(600);
    await flush();

    assert.strictEqual(callable.calls.length, 0);
});

test('the same text within a session is served from cache, without a second call', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const callable = fakeCallable(async ({ text }) => ({ uniqueness: 7, matches: [{ text }] }));
    const session = ThemeSimilarity.createSession({ scoreThemeCallable: callable, debounceMs: 600 });

    session.scoreDebounced('The God Who Rescues', '2026-08-30', () => {}, () => assert.fail('onError'));
    t.mock.timers.tick(600);
    await flush();
    assert.strictEqual(callable.calls.length, 1);

    let secondResult;
    session.scoreDebounced('  the god who rescues  ', '2026-08-30', (r) => { secondResult = r; }, () => assert.fail('onError'));
    assert.strictEqual(callable.calls.length, 1, 'a cache hit should not call out again');
    assert.strictEqual(secondResult.uniqueness, 7);
});

test('the same text scored for a different service is not served from the first one\'s cache', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const callable = fakeCallable(async ({ excludeDate }) => ({ uniqueness: excludeDate === '2026-08-30' ? 7 : 90, matches: [] }));
    const session = ThemeSimilarity.createSession({ scoreThemeCallable: callable, debounceMs: 600 });

    session.scoreDebounced('The God Who Rescues', '2026-08-30', () => {}, () => assert.fail('onError'));
    t.mock.timers.tick(600);
    await flush();

    let result;
    session.scoreDebounced('The God Who Rescues', '2020-01-05', (r) => { result = r; }, () => assert.fail('onError'));
    t.mock.timers.tick(600);
    await flush();

    assert.strictEqual(callable.calls.length, 2, 'a different excludeDate is a cache miss, not a hit');
    assert.strictEqual(result.uniqueness, 90);
});

test('formatMatch shows closeness and the most recent use', () => {
    assert.strictEqual(
        ThemeSimilarity.formatMatch({ text: 'x', closenessPercent: 72, dates: ['2020-01-01', '2025-01-19'] }),
        '72% close · last Jan 19, 2025 (2×)');
    assert.strictEqual(
        ThemeSimilarity.formatMatch({ text: 'x', closenessPercent: 40, dates: ['2024-04-14'] }),
        '40% close · last Apr 14, 2024');
});

test('formatMatch handles a theme with no recorded dates', () => {
    assert.strictEqual(
        ThemeSimilarity.formatMatch({ text: 'x', closenessPercent: 15, dates: [] }),
        '15% close');
});

test('an error reaches onError, not onResult, and only for the call that produced it', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const callable = fakeCallable(async () => { throw new Error('permission-denied'); });
    const session = ThemeSimilarity.createSession({ scoreThemeCallable: callable, debounceMs: 600 });

    let error;
    session.scoreDebounced('The God Who Rescues', '2026-08-30', () => assert.fail('onResult'), (e) => { error = e; });
    t.mock.timers.tick(600);
    await flush();

    assert.match(error.message, /permission-denied/);
});
