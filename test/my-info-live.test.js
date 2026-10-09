const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../public/my-info-live.js');
const LiveFields = require('../public/live-fields-core.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

// MS-721 (ADR 0081): Profile → My info saves itself and stays live.

test('a Person reads into the four live fields', () => {
    assert.deepEqual(M.valuesFrom({ contact: { email: 'a@b.c', phone: '1' }, birthday: '1990-01-02', sex: 'male' }),
        { email: 'a@b.c', phone: '1', address: '', birthday: '1990-01-02' });
    assert.deepEqual(M.valuesFrom(null), { email: '', phone: '', address: '', birthday: '' });
});

test('a change writes only its own fields, in the self-edit allow-list', () => {
    assert.deepEqual(M.patchFor({ phone: ' 555 ' }), { 'contact.phone': '555' });
    assert.deepEqual(M.patchFor({ birthday: '' }), { birthday: null });
    assert.deepEqual(M.patchFor({ sex: 'male', email: 'x@y.z' }), { 'contact.email': 'x@y.z' },
        'sex is never on the autosave');
});

test('the controller saves the changed field, keeps typing on failure, and adopts untouched remote values', async () => {
    const writes = [];
    let fail = false;
    const live = LiveFields.create({
        fields: M.FIELDS, initial: M.valuesFrom({ contact: { email: 'a@b.c' } }),
        setTimeout: () => null, clearTimeout: () => {},
        save: async (patch) => { if (fail) throw new Error('denied'); writes.push(M.patchFor(patch)); return M.storedFrom(patch); },
    });
    live.edit('phone', '555');
    await live.flush();
    assert.deepEqual(writes, [{ 'contact.phone': '555' }]);
    assert.equal(live.state.status, 'saved');
    fail = true;
    live.edit('address', '1 Church St');
    await live.flush();
    assert.equal(live.state.status, 'failed');
    assert.equal(live.state.draft.address, '1 Church St');
    live.remote({ email: 'fixed@b.c', phone: '555', address: 'Theirs', birthday: '' }, { pendingWrites: false });
    assert.equal(live.state.draft.email, 'fixed@b.c', 'untouched box follows');
    assert.equal(live.state.draft.address, '1 Church St', 'your typing is kept');
    fail = false;
    await live.retry();
    assert.equal(live.state.status, 'saved');
});

test('the page has no Save my info button, a chip and Retry, and sex keeps an explicit Set', () => {
    const html = read('profile.html');
    assert.equal(html.indexOf('Save my info'), -1);
    assert.match(html, /id="my-info-status" data-live-chip/);
    assert.match(html, /id="my-info-retry" data-live-retry/);
    assert.match(html, /id="my-sex-set"/);
    for (const s of ['live-read.js', 'live-fields-core.js', 'my-info-live.js']) {
        assert.ok(html.indexOf(`src="${s}"`) < html.indexOf('src="profile.js"'), s);
    }
    const js = read('profile.js');
    assert.match(js, /MosaicLiveRead\.watch\(ref/);
    assert.match(js, /live\.revert\(f\)/);
    assert.match(js, /window\.confirm\('Set this now\? Only the office can change it afterwards\.'\)/);
    assert.doesNotMatch(js, /saveTimer = setTimeout\(saveMyInfo/);
});
