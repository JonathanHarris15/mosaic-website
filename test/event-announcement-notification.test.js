const { test } = require('node:test');
const assert = require('node:assert');

const wording = require('../functions/event-announcement-notification.js');

test('blank config falls back to defaults with title, prose, and link', () => {
    const resolved = wording.resolveEventAnnouncementWording(null);
    assert.match(resolved.text, /\{title\}/);
    assert.match(resolved.text, /\{prose\}/);
    assert.match(resolved.text, /\{link\}/);
    assert.equal(resolved.push.title, '{title}');
    assert.match(resolved.push.body, /\{prose\}/);
});

test('fillTemplate substitutes announcement fields', () => {
    const text = wording.fillTemplate(wording.DEFAULT_TEXT, {
        name: 'Ada',
        title: 'Membership Matters',
        prose: 'Meets tonight.',
        link: 'https://example.test/event',
    });
    assert.match(text, /Membership Matters/);
    assert.match(text, /Meets tonight/);
    assert.match(text, /https:\/\/example\.test\/event/);
});

test('templatesForSendPath exposes the tell wording kind', () => {
    const tpl = wording.templatesForSendPath({});
    assert.ok(tpl.text.tell);
    assert.ok(tpl.push.tell.title);
});
