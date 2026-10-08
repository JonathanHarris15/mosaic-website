// The callable's judge, with fetch replaced. A live Jev call does not belong
// in npm test: it spends a key and depends on the network.

const { test } = require('node:test');
const assert = require('node:assert');
const { judge } = require('../functions/liturgy-translate.js');

function hymn(id, name, title) {
    return {
        sourceId: id, origin: 'element', kind: 'hymn', name: name, position: 0,
        value: { id: null, name: title }, note: '', people: false, requests: null,
    };
}

const targets = [
    { id: 'first', kind: 'hymn', name: 'First Hymn', position: 0, requests: null, people: false, header: null },
    { id: 'last', kind: 'hymn', name: 'Last Hymn', position: 1, requests: null, people: false, header: null },
];

test('no key matches by kind and position and does not call TypeSafe', async () => {
    let called = false;
    const plan = await judge('', {
        mode: 'order',
        sources: [hymn('a', 'Hymn', 'Holy Holy Holy'), hymn('b', 'Hymn', 'Doxology')],
        targets: targets,
    }, function () {
        called = true;
        return Promise.resolve({ ok: true, json: async function () { return {}; } });
    });
    assert.equal(called, false);
    assert.equal(plan.judge, 'order');
    assert.equal(plan.placements[0].value.name, 'Holy Holy Holy');
    assert.equal(plan.placements[1].value.name, 'Doxology');
    assert.equal(plan.questions, undefined);
});

test('a TypeSafe distribution is assigned and the question text stays on the server', async () => {
    const plan = await judge('test-key', {
        mode: 'order',
        sources: [hymn('open', 'Gathering', 'Holy Holy Holy'), hymn('close', 'Sending', 'Doxology')],
        targets: targets,
    }, function () {
        return Promise.resolve({
            ok: true,
            json: async function () {
                return {
                    answers: {
                        slot_first: { probabilities: { none: 0.05, open: 0.8, close: 0.15 } },
                        slot_last: { probabilities: { none: 0.05, open: 0.2, close: 0.75 } },
                    },
                    usage: { input_tokens: 10, output_tokens: 4 },
                };
            },
        });
    });
    assert.equal(plan.judge, 'jev');
    assert.equal(plan.usage.input_tokens, 10);
    const byTarget = {};
    plan.placements.forEach(function (placement) { byTarget[placement.targetId] = placement; });
    assert.equal(byTarget.first.sourceId, 'open');
    assert.equal(byTarget.last.sourceId, 'close');
    assert.equal(plan.state, undefined);
});

test('a failed TypeSafe response falls back to kind and position', async () => {
    const plan = await judge('test-key', {
        mode: 'order',
        sources: [hymn('a', 'Hymn', 'Holy Holy Holy')],
        targets: [targets[0]],
    }, function () {
        return Promise.resolve({ ok: false, status: 503, json: async function () { return {}; } });
    });
    assert.equal(plan.judge, 'order');
    assert.equal(plan.placements[0].sourceId, 'a');
});
