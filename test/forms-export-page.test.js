const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-374 — the export, where somebody actually presses it.
//
// The decisions all live in forms-export-core.js and are tested there. What is
// pinned here is that the page does not make any of its own: it hands the form
// and the responses over and downloads what comes back. A page that started
// assembling rows itself would be a second place for "what an anonymous export
// leaves out" to live.

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8').replace(/\r\n/g, '\n');

const PAGE = read('form.js');
const MARKUP = read('form.html');

test('the Responses tab offers an export once anything has come back', () => {
    assert.match(MARKUP, /exportResponses\(\)/, 'there is no way to export');
    assert.match(MARKUP, /x-show="responseCount"/,
        'the export is offered on a form nobody has answered');
});

test('the page loads the module that decides what goes in the file', () => {
    assert.match(MARKUP, /forms-export-core\.js/);
});

test('the page decides nothing about the columns itself', () => {
    // Every rule about what an export contains — and especially what an
    // anonymous one leaves out — belongs in one place.
    const fn = PAGE.match(/exportResponses\(\) \{[\s\S]*?\n        \},/);
    assert.ok(fn, 'exportResponses has gone missing');
    assert.match(fn[0], /FormsExportCore\.toCsv/);
    assert.ok(!fn[0].includes('personName'),
        'the page is reading a name into the export, which an anonymous form must not have');
    assert.ok(!fn[0].includes('submittedAt'),
        'the page is reading a timestamp into the export');
    assert.ok(!fn[0].includes('anonymousReadOrder'),
        'the page is ordering the rows itself rather than letting the model do it');
});

test('the file is made in the tab and fetched from nowhere', () => {
    // A blob built here is not an address. Nothing is uploaded, nothing is
    // stored, and there is no link that could be forwarded.
    const fn = PAGE.match(/exportResponses\(\) \{[\s\S]*?\n        \},/);
    assert.match(fn[0], /new Blob\(\[csv\]/);
    assert.match(fn[0], /revokeObjectURL/, 'the object URL is never released');
    assert.ok(!fn[0].includes('getDownloadURL'));
    assert.ok(!fn[0].includes('uploadBytes'), 'an export should not be stored anywhere');
});

test('the export is named by the model, not by the page', () => {
    const fn = PAGE.match(/exportResponses\(\) \{[\s\S]*?\n        \},/);
    assert.match(fn[0], /FormsExportCore\.fileNameFor/);
});

test('exporting is behind the same gate as the page it is on', () => {
    // No separate permission check, deliberately: form.html already refuses
    // anybody below editor, and a second gate is a second thing to drift.
    assert.match(PAGE, /mayManageForms|permissionLevel/,
        'the form page no longer gates itself, which the export relies on');
});
