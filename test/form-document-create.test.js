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
    // The types are the component's answer now (MS-405) rather than three
    // hand-written buttons, because a profile tab offers a different set and
    // two hand-written lists drift.
    assert.match(PAGE, /creatableTypes\(\)[\s\S]*?'note', 'care-list', 'form'/,
        'the Library no longer offers all three types');
    assert.match(MARKUP, /x-for="t in creatableTypes"/,
        'the menu does not draw the types the component says it has');
    assert.match(MARKUP, /repeat\(' \+ creatableTypes\.length/,
        'the grid is a fixed width and will crop or stretch when the types change');
});

// ── From a person's own profile (MS-405) ─────────────────────────────────────
//
// A Form Document is an interview about somebody, and the profile tab is where
// an elder is already standing when they want one. It used to force every
// document made there to a plain note.

test('a profile offers a form document, and no care list', () => {
    assert.match(PAGE, /creatableTypes\(\)[\s\S]*?isProfileScope \? \['note', 'form'\]/,
        'a profile tab does not offer a form document');
});

test('a care list cannot be made on a profile even if something asks for one', () => {
    // A Care List is a list over the whole directory; scoped to one person it
    // means nothing. The type is checked against what this surface offers
    // rather than trusted.
    const create = PAGE.match(/async createDocument\(\)[\s\S]*?const type = [^;]*;/);
    assert.ok(create, 'createDocument has gone missing');
    assert.match(create[0], /creatableTypes\.includes\(this\.createDocType\)/,
        'createDocument writes whatever type it was handed');
});

test('a profile opens the same menu rather than making a note on the spot', () => {
    const open = PAGE.match(/openCreateModal\(\)[\s\S]*?\n        \},/);
    assert.ok(open, 'openCreateModal has gone missing');
    assert.ok(!/isProfileScope[\s\S]{0,60}createDocument\(\)/.test(open[0]),
        'a profile still short-circuits straight to a plain note');
});

test('the templates are loaded on a profile too, or its menu would be empty', () => {
    const load = PAGE.match(/async loadData\(\)[\s\S]*?const \[structSnap/);
    assert.ok(load, 'loadData has gone missing');
    assert.ok(!/isProfileScope\) \{[\s\S]*?loadFormTemplates\(\);[\s\S]*?\}/.test(load[0]),
        'loadFormTemplates is still behind the not-a-profile branch');
    assert.match(load[0], /\n                this\.loadFormTemplates\(\);/,
        'loadFormTemplates is not called for both surfaces');
});

test('the profile draws the menu it needs, bound to the same component', () => {
    const profile = read('shepherding-profile.html');
    assert.match(profile, /x-show="showCreateModal"/, 'the profile has no create menu to open');
    assert.match(profile, /x-for="t in creatableTypes"/,
        'the profile hand-writes its types instead of asking the component');
    assert.match(profile, /x-for="t in formTemplates"/,
        'the profile offers no template to start a form document from');
    assert.match(profile, /createDocType === 'form' && !createTemplateId/,
        'a form document can be created on a profile without choosing a template');
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
