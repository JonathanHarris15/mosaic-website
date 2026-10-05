const { test } = require('node:test');
const assert = require('node:assert');

const Passage = require('../public/scripture-passage.js');

const RAW = [
    'John 3:16–17',
    '',
    '[16] For God so loved the world. [17] For God did not send his Son.',
    '',
    '(ESV)',
].join('\n');

test('a scripture slot is a citation field, and a person slot is not', () => {
    assert.equal(Passage.isScriptureField('sermon'), true);
    assert.equal(Passage.isScriptureField('scriptureReading'), true);
    assert.equal(Passage.isScriptureField('prayerMale'), false);
});

test('the default passage is styled, without verse numbers, with its citation', () => {
    const p = Passage.normalize(null);
    assert.equal(p.style, 'styled');
    assert.equal(p.numbers, false);
    assert.equal(p.citation, true);
    assert.equal(p.headings, false);
    assert.equal(p.footnotes, false);
});

test('the query asks the API for the switches the wire chose, and always the short copyright', () => {
    const q = new URLSearchParams(Passage.query('John 3:16', {
        style: 'plain', numbers: true, headings: true, footnotes: false, citation: false,
    }));
    assert.equal(q.get('q'), 'John 3:16');
    assert.equal(q.get('include-verse-numbers'), 'true');
    assert.equal(q.get('include-headings'), 'true');
    assert.equal(q.get('include-passage-references'), 'false');
    assert.equal(q.get('include-footnotes'), 'false');
    assert.equal(q.get('include-short-copyright'), 'true');
});

test('plain is one run, and styled keeps lines without taking the publisher\'s markup', () => {
    const plain = Passage.format(RAW, { style: 'plain', numbers: false, citation: true });
    assert.equal(plain.html, '');
    assert.equal(plain.text.includes('\n'), false);
    assert.equal(plain.text.includes('[16]'), false);
    assert.match(plain.text, /For God so loved the world/);

    const styled = Passage.format(RAW, { style: 'styled', numbers: true, citation: true });
    assert.match(styled.html, /m-scripture__line/);
    assert.match(styled.html, /<sup class="m-scripture__n">16<\/sup>/);
    assert.equal(styled.html.includes('<script'), false);
    assert.match(styled.text, /John 3:16/);
});

test('two presentations of one reference do not share a cache key', () => {
    const a = Passage.cacheKey('John 3:16', { style: 'styled', numbers: false });
    const b = Passage.cacheKey('John 3:16', { style: 'plain', numbers: true });
    assert.notEqual(a, b);
});
