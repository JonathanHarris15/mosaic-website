const { test } = require('node:test');
const assert = require('node:assert');

const Body = require('../public/shepherding-note-body-core.js');

test('MS-798 — preview uses plain content when present', () => {
    assert.equal(Body.notePreviewPlain({ content: 'Hello world' }), 'Hello world');
});

test('MS-798 — preview uses markdown from contentJson when content is empty', () => {
    const preview = Body.notePreviewPlain({
        content: '',
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prayed with them.' }] }] },
    });
    assert.ok(preview.includes('Prayed'));
});

test('backfill plans content from contentJson when plain is missing', () => {
    const plan = Body.planNoteBodyBackfill({
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note body' }] }] },
    });
    assert.ok(plan && plan.content && plan.content.includes('Note'));
});

test('MS-798 — backfill plans contentJson from plain content when JSON is missing', () => {
    const plan = Body.planNoteBodyBackfill({ content: 'Visited at home.' });
    assert.ok(plan && plan.contentJson && plan.contentJson.type === 'doc');
});
