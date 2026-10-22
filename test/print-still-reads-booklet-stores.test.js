const { test } = require('node:test');
const assert = require('node:assert');

const Live = require('../public/printable-live.js');
const Core = require('../public/printable-core.js');
require('../public/printable-link-core.js');
require('../public/sunday-typed-core.js');
require('../public/printable-legacy-migrate-core.js');

// This file belongs to the migration pull request. The reader change deletes
// the fallback, so that pull request does not keep this test.

test('an empty occurrence still prints that Sunday from typed content', () => {
    const project = Core.buildPrintable({
        name: 'Sunday guide',
        inputs: [{ id: 'legacy_prayerNation', label: 'Prayer country', kind: 'text' }],
        pages: [{
            id: 'pg',
            nodes: [{
                id: 'nation',
                tag: 'p',
                text: 'Country',
                bind: {
                    text: {
                        scope: 'global',
                        source: 'event_field',
                        field: 'legacy_prayerNation',
                        params: {},
                    },
                },
            }],
        }],
    });
    project.id = 'guide';
    const bind = project.pages[0].nodes[0].bind.text;
    const old = {
        typedContent: { pastoralPrayer: { nation: 'Kenya' } },
    };
    const empty = Live.resolver(project, {
        eventInputs: {},
        services: { '2026-09-06': old },
    }, { today: '2026-09-03', level: 'editor' });
    assert.deepEqual(empty.valueFor(bind, null), { ok: true, value: 'Kenya' });

    const filled = Live.resolver(project, {
        eventInputs: { legacy_prayerNation: 'Egypt' },
        services: { '2026-09-06': old },
    }, { today: '2026-09-03', level: 'editor' });
    assert.deepEqual(filled.valueFor(bind, null), { ok: true, value: 'Egypt' });
});
