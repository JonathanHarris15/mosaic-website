const { test } = require('node:test');
const assert = require('node:assert');

const Intake = require('../public/image-intake.js');
const Forms = require('../public/forms-core.js');

const MB = 1024 * 1024;

test('HEIC is recognised by type or by name, including when the browser leaves the type blank', () => {
    assert.equal(Intake.isHeic({ type: 'image/heic', name: 'a.jpg' }), true);
    assert.equal(Intake.isHeic({ type: 'image/heif', name: 'a' }), true);
    assert.equal(Intake.isHeic({ type: '', name: 'IMG_0421.HEIC' }), true);
    assert.equal(Intake.isHeic({ type: 'application/octet-stream', name: 'shot.heif' }), true);
    assert.equal(Intake.isHeic({ type: 'image/jpeg', name: 'mislabeled.heic' }), false);
    assert.equal(Intake.isHeic({ type: 'image/jpeg', name: 'a.jpg' }), false);
    assert.equal(Intake.isHeic(null), false);
});

test('a HEIC file always needs work, and a large photo needs work only past the cap', () => {
    const heic = { type: 'image/heic', name: 'a.heic', size: 20 * 1024 };
    assert.equal(Intake.needsWork(heic, 15 * MB), true);
    assert.equal(Intake.needsWork(heic, null), true);
    const jpeg = { type: 'image/jpeg', name: 'a.jpg', size: 20 * MB };
    assert.equal(Intake.needsWork(jpeg, 15 * MB), true);
    assert.equal(Intake.needsWork({ type: 'image/jpeg', name: 'a.jpg', size: MB }, 15 * MB), false);
    assert.equal(Intake.needsWork({ type: 'application/pdf', name: 'a.pdf', size: 40 * MB }, MB), false);
    assert.equal(Intake.needsWork({ type: '', name: 'scan.png', size: 9 * MB }, 8 * MB), true);
});

test('the status line is the compressing sentence, and only when there is work to do', () => {
    assert.equal(Intake.COMPRESSING_MESSAGE, 'Compressing the image…');
    assert.equal(Intake.COMPRESSING_MESSAGE, Forms.COMPRESSING_MESSAGE);
    const big = { type: 'image/jpeg', name: 'a.jpg', size: 20 * MB };
    assert.equal(Intake.statusFor(big, 15 * MB), 'Compressing the image…');
    assert.equal(Intake.statusFor({ type: 'image/jpeg', name: 'a.jpg', size: 1000 }, 15 * MB), '');
});

test('a HEIC name becomes a JPEG name, and a JPEG name is left alone', () => {
    assert.equal(Intake.jpegName('IMG_0421.HEIC'), 'IMG_0421.jpg');
    assert.equal(Intake.jpegName('shot.heif'), 'shot.jpg');
    assert.equal(Intake.jpegName('already.jpg'), 'already.jpg');
    assert.equal(Intake.jpegName('scan.jpeg'), 'scan.jpeg');
    assert.equal(Intake.jpegName('photo'), 'photo.jpg');
});

test('the compress ladder keeps the picture\'s shape and never enlarges it', () => {
    assert.deepEqual(Intake.fittedSize(4000, 3000, 2400), { width: 2400, height: 1800 });
    assert.deepEqual(Intake.fittedSize(800, 600, 2400), { width: 800, height: 600 });
    assert.ok(Intake.LADDER.length >= 2);
    assert.ok(Intake.LADDER[0].maxEdge > Intake.LADDER[Intake.LADDER.length - 1].maxEdge);
});
