const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-385 — the way an elder actually starts one.
//
// The Document Library's new-document menu had two choices; it now has three.
// Picking a form makes a Form Document in the folder you are standing in, from
// a template you choose.
//
// Two things here are easy to get wrong and expensive when you do. Offering a
// `responses` template would make a document out of something meant to be
// published as a link. And reading the questions off the template later, rather
// than copying them now, would let an edit reach back into an interview already
// written (ADR-0055).

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8').replace(/\r\n/g, '\n');

const PAGE = read('shepherding-documents.js');
const MARKUP = read('shepherding-documents.html');

test('the new-document menu offers a form as well as a note and a care list', () => {
    assert.match(MARKUP, /createDocType = 'form'/, 'there is no way to choose a form');
    assert.match(MARKUP, /grid-cols-3/, 'a third choice was added to a two-column grid');
});

test('only document-mode templates are offered', () => {
    // A `responses` template publishes a link and gathers Responses. Making a
    // document from one would be a record of a thing that was never filled in
    // that way.
    const loader = PAGE.match(/async loadFormTemplates\(\)[\s\S]*?\n        \}/);
    assert.ok(loader, 'loadFormTemplates has gone missing');
    assert.match(loader[0], /f\.mode === 'document'/,
        'the menu would offer templates meant to be published as links');
});

test('the questions are copied at creation, not read from the template later', () => {
    // The promise ADR-0055 makes. If this ever became a lookup by templateId,
    // every interview would silently follow its template.
    const create = PAGE.match(/async createDocument\(\)[\s\S]*?questions: template \? template\.questions : null,/);
    assert.ok(create, 'createDocument no longer passes the template questions through');
    assert.match(PAGE, /templateId: template \? template\.id : null/,
        'the document does not record which template it came from');
});

test('a form document is named for its template', () => {
    // What somebody looks for in a folder a year later. It renames like any
    // other document afterwards.
    assert.match(PAGE, /template \? template\.title : 'New Document'/);
});

test('nothing is created until a template has been picked', () => {
    assert.match(MARKUP, /:disabled="createDocType === 'form' && !createTemplateId"/,
        'Create is pressable with no template chosen, which would make an empty form document');
});

test('with no document-mode templates, the menu says what to do about it', () => {
    // An empty list teaches nobody that the answer is on another page.
    const empty = MARKUP.match(/x-show="!formTemplates\.length"[\s\S]{0,400}?<\/p>/);
    assert.ok(empty, 'an empty template list says nothing');
    assert.match(empty[0], /forms\.html/, 'it does not say where to go');
    assert.match(empty[0], /A document/, 'it does not say which choice to make when you get there');
});

test('a library that cannot reach the templates is still a library', () => {
    // Templates are read on their own rather than in the page's main
    // Promise.all. Folders and documents are what this page is FOR; a failure
    // fetching templates must not take it down.
    const loader = PAGE.match(/async loadFormTemplates\(\)[\s\S]*?\n        \}/);
    assert.match(loader[0], /catch/, 'a failed template read would break the page');
    assert.match(loader[0], /this\.formTemplates = \[\]/, 'it does not fall back to an empty list');

    const reads = PAGE.match(/const reads = \[[\s\S]*?\n                \]/);
    assert.ok(reads && !reads[0].includes("collection('forms')"),
        'the template read is inside the load that can fail the page');
});
