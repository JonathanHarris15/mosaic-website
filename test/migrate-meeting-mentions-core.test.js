const { test } = require('node:test');
const assert = require('node:assert');

const M = require('../public/migrate-meeting-mentions-core.js');

test('rewriteMentionId upgrades meeting to elder_document', () => {
    const raw = JSON.stringify({kind: 'meeting', id: 'doc-1'});
    const r = M.rewriteMentionId(raw);
    assert.strictEqual(r.changed, true);
    assert.deepStrictEqual(JSON.parse(r.next), {kind: 'elder_document', id: 'doc-1'});
});

test('rewriteContentJson walks nested mention nodes', () => {
    const doc = {
        type: 'doc',
        content: [{
            type: 'paragraph',
            content: [{
                type: 'mention',
                attrs: {
                    id: JSON.stringify({kind: 'meeting', id: 'x'}),
                    label: 'M',
                },
            }],
        }],
    };
    const r = M.rewriteContentJson(doc);
    assert.strictEqual(r.changed, true);
    const mention = r.doc.content[0].content[0];
    assert.deepStrictEqual(JSON.parse(mention.attrs.id), {kind: 'elder_document', id: 'x'});
});
