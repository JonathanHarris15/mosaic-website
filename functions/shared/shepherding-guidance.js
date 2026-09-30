// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/shepherding-guidance.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Shepherding guidance — the standing instructions an assistant reads before
// it changes a person's directory details or answers a form's person picker.
//
// This is not a file an editor writes on the MCP Manager page. Those are
// this church's preferences, and they change. This is how these tools work,
// and it has to match them: a person question stores an id, a phone number
// is a field on the person, and a Pastoral Assistant may not set sex.
// Shipping it here means the assistant and the tools stay in step.
//
// Pure data, copied into functions/shared with the other domain modules.
(function (global) {
    'use strict';

    const BODY = [
        '# Directory details and the person picker',
        '',
        'Read this before you change a phone number, address, or other',
        'directory fact, and before you answer a form question that picks',
        'somebody from the directory.',
        '',
        '## Changing a person\'s details',
        '',
        'Name, email, phone, address and birthday live on the person\'s own',
        'record. An interview form can ask for them, and the answers in the',
        'form are not the record. After you know the person id, call',
        'shep_update_person with only the fields that should change.',
        '',
        'Leave a field out to leave it alone. An empty phone, email or',
        'address clears that one field. A blank name is refused. A birthday',
        'is YYYY-MM-DD, or empty to clear.',
        '',
        'Who may write what:',
        '',
        '- An editor, admin, elder or super admin may also set sex (`male`',
        '  or `female`, or empty to clear) and the kid mark.',
        '- A Pastoral Assistant may set name, email, phone, address and',
        '  birthday. Sex and the kid mark stay an editor\'s write. Those',
        '  fields come back under `refused`; the others still save.',
        '',
        'Get the id from shep_find_person. If more than one person matches,',
        'ask which one is meant. Do not guess. Phone and email are searched',
        'from the contact on the record, not from a note.',
        '',
        'This tool does not move somebody along the Membership Track, and it',
        'does not change tags or shepherding.',
        '',
        '## A person question on a form',
        '',
        'The directory person picker is answerable. It is not a text field.',
        'The page stores `{personId, name}`. Sending a name stores text the',
        'picker cannot show, so the question looks unanswered.',
        '',
        '1. shep_find_person — get the id. Ask if more than one matches.',
        '2. shep_answer_form_document — for that question, pass',
        '   `{"personId": "<id>"}`. A bare id string is accepted too. A name',
        '   comes back under `skipped`.',
        '',
        'The question may be limited to members, to non-members, or to',
        'people carrying one tag. Someone outside that scope is skipped,',
        'with the reason. The stored answer uses the directory\'s current',
        'name.',
        '',
        'The first question of a personal shepherding document',
        '(`shepherd_subject`) is that picker. Answering it, or changing it,',
        'files the document on that person\'s profile. Start the document',
        'with shep_create_form_document and the personId so it is filed',
        'from the beginning. One interview, one document.',
        '',
        'An upload still cannot be attached. It comes back under `skipped`.',
    ].join('\n');

    const FILE = {
        title: 'Directory details and the person picker',
        summary: 'How to change a phone or address, and how to answer a person question.',
        body: BODY,
    };

    function file() {
        return FILE;
    }

    const ShepherdingGuidance = { file: file };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ShepherdingGuidance;
    }
    if (global) {
        global.ShepherdingGuidance = ShepherdingGuidance;
    }
})(typeof window !== 'undefined' ? window : null);
