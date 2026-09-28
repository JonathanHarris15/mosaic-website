// Printable guidance — the standing instructions an assistant reads before
// it changes a Printable (MS-688).
//
// This is not a file an editor writes on the MCP Manager page. Those are
// this church's preferences, and they change. This is how a Printable works,
// and it has to match the tools: a directory is one list, a continuation
// page is not a second copy, and a delete waits for a yes that names the
// pages. Shipping it here means the assistant and the page stay in step
// when the rules change.
//
// Pure data, copied into functions/shared with the other domain modules.
(function (global) {
    'use strict';

    const BODY = [
        '# How an assistant writes a Printable',
        '',
        'Read this before you add, rewrite, or delete a page. Then read the',
        'Printable. The HTML from printable_read is what printable_write_page',
        'accepts. A Printable stores which field feeds an element, never',
        'today\'s value.',
        '',
        '## A directory is one list',
        '',
        'A membership directory is one Repeat of People, on one page, with',
        'overflow set to make a new page. That first Members page is the',
        'list. Later Members pages are continuation pages. printable_read',
        'names them with `continues`: which page the list started on.',
        '',
        'The same list is sliced across those pages. They are not extra',
        'copies of the directory. Each continuation page still carries the',
        'card\'s markup, because the card is the design. The rows are not',
        'stored on the page.',
        '',
        'Do not paste the member list onto another page to make more room.',
        'Do not add a Members page that repeats People again. A second',
        'Repeat of the same people prints the directory twice.',
        '',
        '## Taller cards spill; they do not multiply',
        '',
        'Adding a line — an email, a phone — makes each card taller, so',
        'fewer people fit on a page. The same list then needs more',
        'continuation pages. That is one directory getting longer, not five',
        'directories.',
        '',
        'Write the new line onto the existing Members pages. Leave',
        '`continues` alone. printable_write_page keeps a page\'s',
        'continuation mark when you leave it out. Pass `continues: null`',
        'only when this page should stop being part of that list, which',
        'starts a second copy, and is almost never what you want.',
        '',
        'If several Members pages each have no `continues` and each repeats',
        'People, the directory is already broken: it will print the member',
        'list once per such page, and taller cards make every copy spill',
        'onto extra pages. Keep the first list. Delete the duplicate Members',
        'pages. Do not fix it by copying the list again.',
        '',
        '## Deleting pages',
        '',
        'Deleting pages cannot be undone from here. A printable keeps at',
        'least one page.',
        '',
        'Call printable_delete_page once without `confirm`. It deletes',
        'nothing, and it names every page it would remove and the count. A',
        'multiple-choice chip ("Delete all duplicates now") is not a yes,',
        'and it does not approve the call. Ask the person to reply in chat',
        'with a sentence that names the pages — for example, "yes, delete',
        'Members pages 5–32". Then call again with `confirm` set to the',
        'count from the refusal, and `pageNumbers` listing each page.',
        '',
        'One call can remove the whole run. Do not delete them one at a time.',
        '',
        '## Before you invent a wire',
        '',
        'Call printable_data_catalog before you write a data-bind or a',
        'data-repeat. The paper of a Printable is fixed for its life.',
        'Switching Members may view on publishes the page to every member;',
        'ask before you do that for anything that holds contact details.',
    ].join('\n');

    const FILE = {
        slug: 'printables',
        title: 'How to write a Printable',
        summary: 'One list per directory, continuation pages, and how a delete is confirmed.',
        body: BODY,
    };

    function file() {
        return FILE;
    }

    const PrintableGuidance = { file: file };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableGuidance;
    }
    if (global) {
        global.PrintableGuidance = PrintableGuidance;
    }
})(typeof window !== 'undefined' ? window : null);
