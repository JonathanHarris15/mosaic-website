const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-617 / MS-642 — the phone Membership Directory's plan for a Directory Photo.
// Nothing here renders a phone. The person page calls this plan, then the
// same upload and clear the computer directory already uses.

require('../public/access-core.js');
require('../public/phone-directory-edit.js');
const Photo = require('../public/person-photo-core.js');
global.PersonPhotoCore = Photo;
const Plan = require('../public/phone-directory-photo.js');

const editor = { permissionLevel: 'editor', personId: 'me' };
const admin = { permissionLevel: 'admin', personId: 'me' };
const elder = { permissionLevel: 'elder', personId: 'me' };
const superAdmin = { permissionLevel: 'super_admin', personId: 'me' };
const member = { permissionLevel: 'member', personId: 'me' };
const assistant = { permissionLevel: 'member', pastoralAssistant: true, personId: 'me' };

const ada = { id: 'ada', name: 'Ada Lovelace', photoUrl: null, photoCrop: null };
const framed = {
    id: 'ada',
    name: 'Ada Lovelace',
    photoUrl: 'https://example.com/ada.jpg',
    photoCrop: { x: 12, y: 80, zoom: 2 },
};
const jpeg = { type: 'image/jpeg', size: 1000 };

function read(rel) {
    return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
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

test('Edit Mode off offers no photo control, whoever is looking', () => {
    for (const user of [editor, admin, elder, superAdmin, member, assistant]) {
        assert.equal(Plan.offerControls(user, false), false);
    }
});

test('a member is not offered a photo control, including on their own page', () => {
    const own = { id: 'me', name: 'Member', photoUrl: null };
    assert.equal(Plan.offerControls(member, true), false);
    assert.equal(Plan.planChosenFile(member, own, true, jpeg).write, false);
    assert.equal(Plan.planRemoval(member, own, true, true).write, false);
});

test('a Pastoral Assistant is not offered a photo control', () => {
    assert.equal(Plan.offerControls(assistant, true), false);
    assert.equal(Plan.planChosenFile(assistant, ada, true, jpeg).write, false);
});

test('an editor, admin, elder, or super admin is offered a photo control only in Edit Mode', () => {
    for (const user of [editor, admin, elder, superAdmin]) {
        assert.equal(Plan.offerControls(user, true), true, user.permissionLevel);
        assert.equal(Plan.offerControls(user, false), false, user.permissionLevel);
    }
});

test('no photo offers Add a photo, and nothing else', () => {
    assert.deepStrictEqual(Plan.controls(ada), {
        add: 'Add a photo',
        replace: null,
        remove: null,
    });
});

test('a photo offers Replace photo and Remove', () => {
    assert.deepStrictEqual(Plan.controls(framed), {
        add: null,
        replace: 'Replace photo',
        remove: 'Remove',
    });
});

test('Remove asks the computer\'s question, naming the person', () => {
    assert.equal(Plan.removalQuestion(framed), 'Remove the photo for Ada Lovelace?');
});

test('cancelling a removal writes nothing', () => {
    const plan = Plan.planRemoval(editor, framed, true, false);
    assert.equal(plan.write, false);
    assert.equal(plan.question, 'Remove the photo for Ada Lovelace?');
});

test('confirming a removal is a clear, and still asks the same question', () => {
    const plan = Plan.planRemoval(editor, framed, true, true);
    assert.equal(plan.write, true);
    assert.equal(plan.question, 'Remove the photo for Ada Lovelace?');
});

test('a rejected file is the existing photo check\'s own error, and writes nothing', () => {
    const gif = { type: 'image/gif', size: 1000 };
    const huge = { type: 'image/jpeg', size: Photo.MAX_UPLOAD_BYTES + 1 };
    for (const file of [gif, huge, null]) {
        const plan = Plan.planChosenFile(editor, ada, true, file);
        const check = Photo.validatePhotoFile(file);
        assert.equal(plan.write, false);
        assert.equal(plan.ok, false);
        assert.equal(plan.error, check.error);
    }
    assert.match(Plan.planChosenFile(editor, ada, true, gif).error, /Use a JPEG, PNG or WebP image\./);
    assert.match(
        Plan.planChosenFile(editor, ada, true, huge).error,
        /That image is too large\. Keep it under 15MB\./,
    );
});

test('a file the computer accepts is a write, with the centred framing', () => {
    const plan = Plan.planChosenFile(editor, framed, true, jpeg);
    assert.equal(plan.write, true);
    assert.equal(plan.error, null);
    assert.deepStrictEqual(plan.framing, Photo.DEFAULT_CROP);
    assert.notDeepStrictEqual(plan.framing, framed.photoCrop);
});

test('a new photo is the centred framing the upload already stores, not the old one', () => {
    assert.deepStrictEqual(Plan.framingForNewPhoto(framed.photoCrop), Photo.DEFAULT_CROP);
    assert.deepStrictEqual(Photo.DEFAULT_CROP, { x: 50, y: 50, zoom: 1 });
});

test('a photo that was not replaced keeps the framing it already had', () => {
    assert.deepStrictEqual(Plan.framingKept(framed), Photo.normalizeCrop(framed.photoCrop));
});

test('the page after an upload shows the new picture, recentred', () => {
    const next = Plan.photoAfterUpload(framed, { url: 'https://example.com/new.jpg' });
    assert.equal(next.photoUrl, 'https://example.com/new.jpg');
    assert.deepStrictEqual(next.photoCrop, Photo.DEFAULT_CROP);
    assert.equal(next.name, framed.name);
});

test('clearing a photo leaves initials: no picture and no framing', () => {
    const next = Plan.photoAfterClear(framed);
    assert.equal(next.photoUrl, null);
    assert.equal(next.photoCrop, null);
    assert.equal(next.name, framed.name);
});

test('a failed upload with no words of its own says the upload did not work', () => {
    assert.equal(Plan.uploadFailureMessage(null), 'That upload did not work');
    assert.equal(Plan.uploadFailureMessage(new Error('')), 'That upload did not work');
});

test('a file that cannot be read keeps that sentence', () => {
    assert.equal(
        Plan.uploadFailureMessage(new Error('Could not read that image.')),
        'Could not read that image.',
    );
});

test('a second claim while a photo is saving does not start another write', () => {
    const session = { saving: false };
    assert.equal(Plan.claimSave(session), true);
    assert.equal(Plan.claimSave(session), false);
    assert.equal(session.saving, true);
    Plan.releaseSave(session);
    assert.equal(session.saving, false);
    assert.equal(Plan.claimSave(session), true);
});

test('an editor cannot attach a photo to a missing person', () => {
    assert.equal(Plan.planChosenFile(editor, { name: 'Nobody' }, true, jpeg).write, false);
    assert.equal(Plan.planRemoval(editor, { name: 'Nobody' }, true, true).write, false);
});

test('the picker accepts the same types the computer accepts', () => {
    assert.equal(Plan.ACCEPT, Photo.ACCEPTED_TYPES.join(','));
    assert.equal(Plan.ACCEPT, 'image/jpeg,image/png,image/webp');
});

test('the phone loads Storage, then the photo plan, before the person page', () => {
    const html = read('public/mobile.html');
    const storageAt = html.indexOf('firebase-storage-compat.js');
    const photoAt = html.indexOf('person-photo-core.js');
    const planAt = html.indexOf('phone-directory-photo.js');
    const screenAt = html.indexOf('mobile/screens-content.js');
    assert.ok(storageAt !== -1 && storageAt < planAt);
    assert.ok(photoAt !== -1 && photoAt < planAt);
    assert.ok(planAt !== -1 && planAt < screenAt);
});

test('the person page offers the photo controls; the directory list does not', () => {
    const src = read('public/mobile/screens-content.js');
    const list = fnBody(src, 'PeopleScreen');
    const page = fnBody(src, 'PersonDetailScreen');
    assert.match(page, /<\$\{DirectoryPhoto\}/);
    assert.match(page, /planChosenFile/);
    assert.match(page, /planRemoval/);
    assert.match(page, /uploadPersonPhoto/);
    assert.match(page, /clearPersonPhoto/);
    assert.match(page, /claimSave/);
    assert.match(page, /photoAfterUpload/);
    assert.match(page, /photoAfterClear/);
    assert.match(page, /uploadFailureMessage/);
    assert.match(page, /REMOVE_FAILED/);
    assert.equal(list.includes('Add a photo'), false);
    assert.equal(list.includes('Replace photo'), false);
    assert.equal(list.includes('planChosenFile'), false);
    assert.equal(list.includes('uploadPersonPhoto'), false);
    assert.equal(list.includes('DirectoryPhoto'), false);
    assert.match(list, /photoUrl=\$\{p\.photoUrl\}/);
});

test('the photo buttons sit with the picture and do not cover it', () => {
    const src = read('public/mobile/screens-content.js');
    const controls = fnBody(src, 'DirectoryPhoto');
    assert.match(controls, /offerControls/);
    assert.match(controls, /controls\(/);
    assert.match(controls, /accept=\$\{[^}]*ACCEPT/);
    assert.match(controls, /<\$\{Avatar\}/);
    assert.equal(controls.includes('position: "absolute"'), false);
    assert.equal(controls.includes('inset'), false);
    assert.equal(controls.includes('hover'), false);
});
