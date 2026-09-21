const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// MS-618 / MS-644 — the phone Membership Directory's plan for the Directory
// Request queue and for disconnecting an account. Nothing here renders a
// phone. The list and the person page call this plan, then the callables
// the computer already uses.

require('../public/access-core.js');
const Directory = require('../public/directory-request-core.js');
global.DirectoryRequestCore = Directory;
const Plan = require('../public/phone-directory-requests.js');

const editor = { permissionLevel: 'editor' };
const admin = { permissionLevel: 'admin' };
const elder = { permissionLevel: 'elder' };
const superAdmin = { permissionLevel: 'super_admin' };
const member = { permissionLevel: 'member' };
const assistant = { permissionLevel: 'member', pastoralAssistant: true };

const DECLINE_QUESTION = 'Why are you declining? This is shown to the person who asked (optional).';
const KEEP = 'They will keep their directory record, their membership and every shepherding note — they just will not be signed in as this person any more. You can reconnect an account afterwards.';
const NO_MATCH = 'No unclaimed record by that name.';
const OVERRIDE = 'Connect them to an existing record instead.';

function nameOf(id) {
    if (id === 'ada') return 'Ada Lovelace';
    if (id === 'ben') return 'Ben West';
    return null;
}

const connect = {
    id: 'u_link_match',
    kind: 'link_match',
    email: 'ada@example.com',
    personId: 'ada',
    note: 'That record is me.',
    createdAt: { seconds: 30 },
};
const newer = {
    id: 'u_link_new',
    kind: 'link_new',
    email: 'ned@example.com',
    proposed: {
        name: 'Ned New',
        contact: { email: 'ned@example.com', phone: '', address: '1 Chapel Lane' },
    },
    note: '',
    createdAt: { seconds: 10 },
};
const nameFix = {
    id: 'u_name_fix',
    kind: 'name_fix',
    email: 'ada@example.com',
    personId: 'ada',
    proposed: { name: 'Ada King', contact: { email: '', phone: '', address: '' } },
    createdAt: { seconds: 20 },
};
const family = {
    id: 'u_family',
    kind: 'family',
    email: 'ada@example.com',
    personId: 'ada',
    family: { op: 'add', relation: 'child', otherId: 'ben' },
    note: 'Our son.',
    createdAt: { seconds: 40 },
};

test('a member and a Pastoral Assistant are not offered the queue or the disconnect', () => {
    for (const user of [member, assistant, null, { permissionLevel: 'viewer' }]) {
        assert.equal(Plan.offerQueue(user, false), false);
        assert.equal(Plan.offerQueue(user, true), false);
        assert.equal(Plan.offerAccount(user, true, { userId: 'acct' }), false);
    }
});

test('an editor is offered the queue with Edit Mode off, and the disconnect only in Edit Mode when the person has a login', () => {
    for (const user of [editor, admin, elder, superAdmin]) {
        assert.equal(Plan.offerQueue(user, false), true);
        assert.equal(Plan.offerQueue(user, true), true);
        assert.equal(Plan.showQueue(user, false, [connect]), true);
        assert.equal(Plan.showQueue(user, true, []), false);
        assert.equal(Plan.offerAccount(user, false, { userId: 'acct' }), false);
        assert.equal(Plan.offerAccount(user, true, { userId: '' }), false);
        assert.equal(Plan.offerAccount(user, true, { id: 'ada' }), false);
        assert.equal(Plan.offerAccount(user, true, { userId: 'acct', name: 'Ada Lovelace' }), true);
    }
    assert.equal(Plan.ACCOUNT, 'Account');
});

test('labels are Connect, New record, Name, and Family, and the summary is the existing summary', () => {
    assert.equal(Plan.labelOf(connect), 'Connect');
    assert.equal(Plan.labelOf(newer), 'New record');
    assert.equal(Plan.labelOf(nameFix), 'Name');
    assert.equal(Plan.labelOf(family), 'Family');
    for (const request of [connect, newer, nameFix, family]) {
        assert.equal(Plan.summaryOf(request, nameOf), Directory.summarize(request, nameOf));
    }
    assert.equal(Plan.proposedContact(newer), 'ned@example.com · 1 Chapel Lane');
    assert.equal(Plan.proposedContact(connect), '');
    assert.equal(Plan.noteOf(connect), 'That record is me.');
    assert.equal(Plan.noteOf(newer), '');
    assert.deepStrictEqual(
        Plan.oldestFirst([connect, family, nameFix, newer]).map((r) => r.id),
        ['u_link_new', 'u_name_fix', 'u_link_match', 'u_family'],
    );
});

test('a New record offers Add & connect and Already on file; the other kinds offer Confirm and do not', () => {
    assert.equal(Plan.confirmLabel(newer), 'Add & connect');
    assert.equal(Plan.offerAlreadyOnFile(newer), true);
    for (const request of [connect, nameFix, family]) {
        assert.equal(Plan.confirmLabel(request), 'Confirm');
        assert.equal(Plan.offerAlreadyOnFile(request), false);
    }
    assert.equal(Plan.ALREADY_ON_FILE, 'Already on file…');
    assert.equal(Plan.OVERRIDE_QUESTION, OVERRIDE);
    assert.equal(Plan.searchStartsAs(newer), 'Ned New');
    assert.equal(Plan.searchStartsAs(connect), '');
});

test('the search offers nobody until there is a query, keeps only people who are not connected, and stops at fifteen', () => {
    const people = [{ id: 'linked', name: 'Ann Linked', userId: 'already' }];
    for (let i = 0; i < 16; i++) people.push({ id: 'n' + i, name: 'Ann ' + i, userId: null });
    people.push({ id: 'ben', name: 'Ben West', userId: null });

    assert.deepStrictEqual(Plan.unclaimedSearch(people, ''), []);
    assert.deepStrictEqual(Plan.unclaimedSearch(people, '   '), []);
    const found = Plan.unclaimedSearch(people, 'ann');
    assert.equal(found.length, 15);
    assert.equal(found.some((p) => p.id === 'linked'), false);
    assert.equal(found.some((p) => p.id === 'ben'), false);
    assert.equal(Plan.noMatch('ann', []), NO_MATCH);
    assert.equal(Plan.noMatch('', []), '');
    assert.equal(Plan.noMatch('ann', found), '');
});

test('decline reports the computer\'s question, and cancel is not a decline', () => {
    assert.equal(Plan.DECLINE_QUESTION, DECLINE_QUESTION);
    assert.deepStrictEqual(Plan.declineAnswer(null), { write: false, reason: null });
    assert.deepStrictEqual(Plan.declineAnswer(''), { write: true, reason: null });
    assert.deepStrictEqual(Plan.declineAnswer('   '), { write: true, reason: null });
    assert.deepStrictEqual(Plan.declineAnswer('  Already a member.  '), {
        write: true,
        reason: 'Already a member.',
    });
});

test('disconnect reports the computer\'s warning, including the person\'s name', () => {
    const message = Plan.disconnectMessage('Ada Lovelace');
    assert.match(message, /^Disconnect the website account from Ada Lovelace\?/);
    assert.match(message, new RegExp(KEEP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(message.includes('ada@example.com'), false);
});

test('a refused approval is the callable\'s reason and writes nothing in the plan', () => {
    const pending = [newer, connect];
    const refused = Plan.queueAfter(pending, newer.id, false);
    assert.deepStrictEqual(refused.map((r) => r.id), ['u_link_new', 'u_link_match']);
    assert.equal(pending.length, 2);
    assert.equal(
        Plan.refusalWords({ message: 'This account is already linked to a directory record.' }),
        'This account is already linked to a directory record.',
    );
    assert.equal(Plan.refusalWords({}), 'Could not resolve that request');
    assert.equal(Plan.refusalWords(null), 'Could not resolve that request');

    const approved = Plan.queueAfter(pending, newer.id, true);
    assert.deepStrictEqual(approved.map((r) => r.id), ['u_link_match']);
    assert.equal(Plan.outcomeMessage('approve'), 'Request approved');
    assert.equal(Plan.outcomeMessage('decline'), 'Request declined');
});

test('a failed disconnect leaves the login, and a success clears only the link', () => {
    const person = {
        id: 'ada',
        name: 'Ada Lovelace',
        userId: 'acct',
        membership: { stage: 'member', inactive: false },
        tags: ['member', 'choir'],
        shepherding: { urgency: 1 },
    };
    assert.equal(Plan.personAfterDisconnect(person, false), person);
    const after = Plan.personAfterDisconnect(person, true);
    assert.equal(after.userId, null);
    assert.equal(after.name, 'Ada Lovelace');
    assert.deepStrictEqual(after.membership, person.membership);
    assert.deepStrictEqual(after.tags, person.tags);
    assert.deepStrictEqual(after.shepherding, person.shepherding);
    assert.equal(person.userId, 'acct');
    assert.equal(Plan.disconnectRefusal({ message: 'That record no longer exists.' }), 'That record no longer exists.');
    assert.equal(Plan.disconnectRefusal({}), 'Could not disconnect that account');
    assert.equal(Plan.DISCONNECTED, 'Account disconnected');
});

test('a second tap on the request being answered does nothing, and another request still can', () => {
    assert.equal(Plan.mayAnswer(null, connect.id), true);
    assert.equal(Plan.mayAnswer(connect.id, connect.id), false);
    assert.equal(Plan.mayAnswer(connect.id, newer.id), true);
    assert.equal(Plan.mayDisconnect(false), true);
    assert.equal(Plan.mayDisconnect(true), false);
});

test('confirm and disconnect name the existing callables and do not invent a writer', () => {
    assert.deepStrictEqual(Plan.resolveCall(newer, 'approve', null, null), {
        callable: 'resolveDirectoryRequest',
        data: { requestId: newer.id, decision: 'approve', personId: null, reason: null },
    });
    assert.deepStrictEqual(Plan.resolveCall(newer, 'approve', 'ada', null).data.personId, 'ada');
    assert.deepStrictEqual(Plan.resolveCall(connect, 'decline', null, 'Already a member.').data, {
        requestId: connect.id,
        decision: 'decline',
        personId: null,
        reason: 'Already a member.',
    });
    assert.deepStrictEqual(Plan.unlinkCall('ada'), {
        callable: 'unlinkDirectoryPerson',
        data: { personId: 'ada' },
    });
});

const root = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fnBody(src, name) {
    const at = src.indexOf('function ' + name + '(');
    assert.notEqual(at, -1, name + ' is missing');
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(at, i + 1);
        }
    }
    assert.fail('unclosed ' + name);
}

test('the phone loads the request plan after the summary and Edit Mode', () => {
    const html = read('public/mobile.html');
    const summaryAt = html.indexOf('directory-request-core.js');
    const editAt = html.indexOf('phone-directory-edit.js');
    const planAt = html.indexOf('phone-directory-requests.js');
    const screenAt = html.indexOf('mobile/screens-content.js');
    assert.ok(summaryAt !== -1 && planAt > summaryAt);
    assert.ok(editAt !== -1 && planAt > editAt);
    assert.ok(screenAt > planAt);
});

test('the queue sits on the directory list above the tabs and does not wait for Edit Mode', () => {
    const src = read('public/mobile/screens-content.js');
    const list = fnBody(src, 'PeopleScreen');
    const queue = fnBody(src, 'DirectoryQueue');
    const tabsAt = list.indexOf('tabs.map');
    const queueAt = list.indexOf('DirectoryQueue');
    assert.ok(queueAt !== -1 && tabsAt !== -1 && queueAt < tabsAt);
    assert.match(list, /offerQueue\(props\.user\)/);
    assert.match(list, /showQueue\(props\.user, editOn, pending\)/);
    assert.match(list, /seeQueue \? data\.getPendingDirectoryRequests : noPeople/);
    assert.match(list, /QUEUE_FAILED/);
    assert.equal(list.includes('offerAccount'), false);
    assert.equal(list.includes('disconnectMessage'), false);
    assert.equal(list.includes('unlinkDirectoryPerson'), false);
    assert.match(queue, /labelOf/);
    assert.match(queue, /summaryOf/);
    assert.match(queue, /proposedContact/);
    assert.match(queue, /noteOf/);
    assert.match(queue, /confirmLabel/);
    assert.match(queue, /offerAlreadyOnFile/);
    assert.match(queue, /unclaimedSearch/);
    assert.match(queue, /NO_MATCH/);
    assert.match(queue, /searchStartsAs/);
    assert.match(queue, /DECLINE_QUESTION/);
    assert.match(queue, /declineAnswer/);
    assert.match(queue, /mayAnswer/);
    assert.match(queue, /resolveDirectoryRequest/);
    assert.match(queue, /getPeopleFresh/);
    assert.match(queue, /getPendingDirectoryRequests/);
    assert.match(queue, /refreshDirectoryFamilies/);
    assert.match(queue, /DIRECTORY_FAILED/);
    assert.match(queue, /refusalWords/);
    assert.match(queue, /outcomeMessage/);
    assert.equal(queue.includes('hover'), false);
    assert.equal(queue.includes('httpsCallable'), false);
});

test('disconnect is on the person page in Edit Mode, on screen, and not a hover', () => {
    const src = read('public/mobile/screens-content.js');
    const page = fnBody(src, 'PersonDetailScreen');
    const list = fnBody(src, 'PeopleScreen');
    assert.match(page, /offerAccount\(props\.user, editOn, p\)/);
    assert.match(page, /disconnectMessage\(p\.name\)/);
    assert.match(page, /window\.confirm/);
    assert.match(page, /disconnectDirectoryAccount/);
    assert.match(page, /personAfterDisconnect/);
    assert.match(page, /getPeopleFresh/);
    assert.match(page, /mayDisconnect/);
    assert.match(page, /\$\{Req\.ACCOUNT\}/);
    assert.equal(list.includes('Req.ACCOUNT'), false);
    assert.equal(list.includes('disconnectDirectoryAccount'), false);
    assert.equal(page.includes('opacity: 0'), false);
    assert.equal(page.includes('Reconnect'), false);
    const accountAt = page.indexOf('${Req.ACCOUNT}');
    const accountBlock = page.slice(accountAt, accountAt + 500);
    assert.equal(accountBlock.includes('email'), false);
});

test('the security rules are unchanged and the phone uses the existing callables', () => {
    const rules = read('firestore.rules');
    assert.equal(rules.includes('phone-directory-requests'), false);
    const index = read('functions/index.js');
    assert.equal(index.includes('phone-directory-requests'), false);
    const data = read('public/mobile/data.js');
    const pending = fnBody(data, 'getPendingDirectoryRequests');
    const fresh = fnBody(data, 'getPeopleFresh');
    const resolve = fnBody(data, 'resolveDirectoryRequest');
    const unlink = fnBody(data, 'disconnectDirectoryAccount');
    const call = fnBody(data, 'callDirectoryPlan');
    const families = fnBody(data, 'getFamilies');
    const mapped = fnBody(data, 'peopleFromSnap');
    assert.match(pending, /source: "server"|Cache\.fresh|serverGet/);
    assert.match(fresh, /source: "server"|Cache\.fresh|serverGet/);
    assert.match(resolve, /resolveCall/);
    assert.match(resolve, /callDirectoryPlan/);
    assert.match(unlink, /unlinkCall/);
    assert.match(unlink, /callDirectoryPlan/);
    assert.match(call, /httpsCallable/);
    assert.match(families, /familiesAfterAnswer/);
    assert.match(mapped, /userId/);
    assert.equal(mapped.includes('users'), false);
    const removal = fnBody(data, 'deleteDirectoryPerson');
    assert.equal(removal.includes('unlink'), false);
});
