const { test } = require('node:test');
const assert = require('node:assert');

const Link = require('../public/printable-link-core.js');
const Typed = require('../public/sunday-typed-core.js');

test('kids and prayer wires become the Sunday form, and announcements stay out', () => {
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
    const keys = form.sundayFields.map(f => f.key);
    assert.deepEqual(keys, ['prayerNation', 'kidsLessonTitle', 'kidsQuestions']);
    assert.equal(form.sundayGroups.map(g => g.name).join(','), 'Prayer,Mosaic Kids');
    assert.equal(form.sections.length, 0);
    assert.equal(keys.includes('announcements'), false);
});

test('author fields on two printables stay with the printable that named them', () => {
    const ball = {
        id: 'ball',
        name: '3x3',
        inputs: [
            { id: 'home', label: 'Home logo', kind: 'image' },
            { id: 'players', label: 'Players', kind: 'list', fields: [{ id: 'name', label: 'Name', kind: 'text' }] },
        ],
    };
    const other = { id: 'note', name: 'Note', inputs: [{ id: 'title', label: 'Title', kind: 'text' }] };
    const form = Link.formFor([ball, other]);
    assert.equal(form.sections.length, 2);
    assert.equal(form.sections[0].inputs[1].kind, 'list');
    assert.equal(form.sundayFields.length, 0);
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

test('saving kids and prayer leaves announcements on the Sunday', () => {
    const service = {
        typedContent: {
            pastoralPrayer: { nation: 'Old country', prompts: [] },
            mosaicKids: { lessonTitle: 'Old lesson', lessonVerse: '', summary: [], questions: [] },
            announcements: [{ title: 'Potluck', content: 'After the service' }],
        },
    };
    const content = Link.mergeSundayContent(Typed, service, {
        prayerNation: 'Kenya',
        kidsLessonTitle: 'The sower',
        kidsQuestions: 'Who sowed?\nWhat grew?',
    }, ['prayerNation', 'kidsLessonTitle', 'kidsQuestions']);
    assert.equal(content.pastoralPrayer.nation, 'Kenya');
    assert.equal(content.mosaicKids.lessonTitle, 'The sower');
    assert.deepEqual(content.mosaicKids.questions, ['Who sowed?', 'What grew?']);
    assert.equal(content.announcements[0].title, 'Potluck');
    assert.equal(content.announcements[0].content, 'After the service');
});
