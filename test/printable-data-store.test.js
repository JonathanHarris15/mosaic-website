const { test } = require('node:test');
const assert = require('node:assert');

// The store's own `fetch` loads the bundle. Passage text has to use the
// platform fetch, or the preview warns that the verses did not load.
global.PrintableDataCore = require('../public/printable-data-core.js');
global.ScripturePassage = require('../public/scripture-passage.js');
const Store = require('../public/printable-data-store.js');
const Live = require('../public/printable-live.js');
const Passage = global.ScripturePassage;

function serviceDb(date, data) {
    return {
        collection(name) {
            return {
                doc(id) {
                    return {
                        get: async () => {
                            if (name === 'services' && id === date) return { exists: true, data: () => data };
                            return { exists: false, data: () => null };
                        },
                    };
                },
                where() { return this; },
                get: async () => ({ docs: [] }),
            };
        },
    };
}

test('a passage wire stores the ESV text under the presentation key', async () => {
    const presentation = { style: 'plain', numbers: false, headings: false, footnotes: false, citation: false, copyright: false };
    const calls = [];
    global.fetch = async (url, opts) => {
        calls.push({ url: String(url), opts: opts });
        return {
            ok: true,
            json: async () => ({ passages: ['For as Jonah was three days and three nights in the belly of the great fish'] }),
        };
    };
    const date = '2026-10-11';
    const bundle = await Store.fetch(serviceDb(date, { keyVerse: 'Matthew 12:45' }), {
        services: [date],
        passages: [{
            source: 'sunday',
            params: { when: { mode: 'this' } },
            field: 'keyVerse',
            presentation: presentation,
            today: date,
        }],
    }, { level: 'editor' });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\.esv\.org\/v3\/passage\/text\//);
    assert.match(calls[0].url, /Matthew%2012%3A45|Matthew\+12%3A45|q=Matthew/);
    assert.equal(calls[0].opts.headers.Authorization.indexOf('Token '), 0);
    const key = Passage.cacheKey('Matthew 12:45', presentation);
    assert.match(bundle.passages[key], /Jonah/);
    const project = {
        id: 'guide',
        pages: [{ id: 'cover', nodes: [{
            id: 'verse',
            tag: 'p',
            bind: { text: {
                scope: 'global', source: 'sunday', field: 'keyVerse',
                params: { when: { mode: 'this' } },
                reading: 'passage',
                passage: presentation,
            } },
        }] }],
    };
    const res = Live.resolver(project, bundle, { today: date, level: 'editor' });
    const got = res.valueFor(project.pages[0].nodes[0].bind.text, null);
    assert.equal(got.ok, true);
    assert.match(got.value, /Jonah/);
});

test('event inputs come off the named occurrence', async () => {
    const db = {
        collection(name) {
            return {
                doc(id) {
                    return {
                        get: async () => {
                            if (name === 'event_occurrences' && id === 'ball_2026-10-08') {
                                return {
                                    exists: true,
                                    data: () => ({ printableInputs: { ball: { home: 'Lions' } } }),
                                };
                            }
                            return { exists: false, data: () => null };
                        },
                    };
                },
            };
        },
    };
    const bundle = await Store.fetch(db, {
        eventInputs: { printableId: 'ball', date: '2026-10-08', occurrenceId: 'ball_2026-10-08' },
    }, { level: 'editor' });
    assert.equal(bundle.eventInputs.home, 'Lions');
});
