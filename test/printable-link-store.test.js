'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const Store = require('../public/printable-link-store.js');
const Intake = require('../public/image-intake.js');

test('fileAcceptError allows HEIC and extension-only photos', () => {
    assert.equal(Store.fileAcceptError({ type: '', name: 'IMG_0421.HEIC', size: 1000 }), '');
    assert.equal(Store.fileAcceptError({ type: 'application/octet-stream', name: 'shot.jpg', size: 1000 }), '');
    assert.equal(Store.fileAcceptError({ type: 'image/jpeg', name: 'a.jpg', size: 1000 }), '');
    assert.equal(Store.fileAcceptError({ type: 'application/pdf', name: 'a.pdf', size: 1000 }), 'Choose an image.');
    assert.equal(Store.fileAcceptError(null), 'Choose an image.');
});

test('uploadCapBytes matches Sunday typed ceiling when present', () => {
    const prev = global.SundayTypedCore;
    global.SundayTypedCore = { MAX_UPLOAD_BYTES: 8000000 };
    assert.equal(Store.uploadCapBytes(), 7999999);
    global.SundayTypedCore = prev;
});

test('needsWork path is exercised for large JPEGs (intake contract)', () => {
    const big = { type: 'image/jpeg', name: 'big.jpg', size: 20 * 1024 * 1024 };
    assert.equal(Intake.needsWork(big, Store.uploadCapBytes()), true);
});
