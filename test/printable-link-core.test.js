const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const Link = require('../public/printable-link-core.js');

test('a Sunday booklet wire does not invent fill-in fields or group headings', () => {
    const guide = {
        id: 'guide',
        name: 'Sunday Service Guide',
        pages: [{ nodes: [
            { id: 'a', tag: 'p', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'kidsLessonTitle' } } },
            { id: 'b', tag: 'p', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'prayerNation' } } },
            { id: 'c', tag: 'p', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'announcements' } } },
            { id: 'q', tag: 'div', repeat: { source: 'sunday_kids_questions', params: {} }, children: [
                { id: 'qi', tag: 'p', bind: { text: { scope: 'item', field: 'text' } } },
            ] },
        ] }],
    };
    const form = Link.formFor([guide]);
    assert.equal(form.sections.length, 0);
    assert.equal(form.hasFields, false);
    assert.equal(Object.prototype.hasOwnProperty.call(form, 'sundayGroups'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(form, 'sundayFields'), false);
    assert.equal(Link.SUNDAY_FILL, undefined);
    assert.equal(typeof Link.mergeSundayContent, 'undefined');
});

test('author fields on two printables stay with the printable that named them', () => {
    const ball = {
        id: 'ball',
        name: '3x3',
        pages: [{ nodes: [
            { id: 'wired', tag: 'p', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'prayerNation' } } },
        ] }],
        inputs: [
            { id: 'home', label: 'Home logo', kind: 'image' },
            { id: 'players', label: 'Players', kind: 'list', fields: [{ id: 'name', label: 'Name', kind: 'text' }] },
        ],
    };
    const other = { id: 'note', name: 'Note', inputs: [{ id: 'title', label: 'Title', kind: 'text' }] };
    const form = Link.formFor([ball, other]);
    assert.equal(form.sections.length, 2);
    assert.equal(form.sections[0].name, '3x3');
    assert.equal(form.sections[0].inputs[1].kind, 'list');
    assert.equal(form.sections[1].name, 'Note');
    assert.equal(form.hasFields, true);
    const draft = Link.draftFromStored(form.sections[0].inputs, {
        home: 'https://example.test/logo.png',
        players: [{ name: 'Ada' }, { name: 'Lin' }],
    });
    assert.equal(draft.home, 'https://example.test/logo.png');
    assert.equal(draft.players.length, 2);
    assert.equal(draft.players[0].name, 'Ada');
    const merged = Link.mergePrintableInputs({ note: { title: 'Keep' } }, 'ball', draft);
    assert.equal(merged.note.title, 'Keep');
    assert.equal(merged.ball.players[1].name, 'Lin');
});

test('the Sunday and event pages do not render a Prayer or Mosaic Kids fill-in group', () => {
    const files = ['public/service-builder.html', 'public/calendar-event.html'];
    files.forEach(rel => {
        const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        assert.equal(html.includes('linkFill.sundayGroups'), false, rel);
        assert.equal(html.includes('linkFill.sundayDraft'), false, rel);
        assert.equal(html.includes('Mosaic Kids and the prayer country'), false, rel);
        assert.equal(html.includes('uploadSundayFieldImage'), false, rel);
    });
});
