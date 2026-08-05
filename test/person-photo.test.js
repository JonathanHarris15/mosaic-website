const { test } = require('node:test');
const assert = require('node:assert');

const Photo = require('../public/person-photo-core.js');

// A directory photo (ADR-0029) joins the self-editable set from ADR-0012: your
// own without asking, anyone's if you are an editor. These pin the policy the
// Firestore rules and both UIs share.

// ── What may be uploaded ─────────────────────────────────────────────────────

test('JPEG, PNG and WebP are accepted — the formats a canvas can resize', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
        assert.ok(Photo.validatePhotoFile({ type, size: 1000 }).ok, type);
    }
});

test('anything else is refused, in words that say what to do', () => {
    for (const type of ['image/gif', 'image/heic', 'application/pdf', 'text/html', '']) {
        const check = Photo.validatePhotoFile({ type, size: 1000 });
        assert.ok(!check.ok, type);
        assert.match(check.error, /JPEG, PNG or WebP/);
    }
});

test('a file too large to read is refused before the browser chokes on it', () => {
    const check = Photo.validatePhotoFile({ type: 'image/jpeg', size: Photo.MAX_UPLOAD_BYTES + 1 });
    assert.ok(!check.ok);
    assert.match(check.error, /too large/);
});

test('a file exactly at the cap is fine', () => {
    assert.ok(Photo.validatePhotoFile({ type: 'image/jpeg', size: Photo.MAX_UPLOAD_BYTES }).ok);
});

test('no file at all is refused', () => {
    assert.ok(!Photo.validatePhotoFile(null).ok);
    assert.ok(!Photo.validatePhotoFile(undefined).ok);
});

// ── Resizing ─────────────────────────────────────────────────────────────────

test('a large photo is capped on its longest edge, keeping its shape', () => {
    const size = Photo.scaledSize(4000, 3000, 800);
    assert.strictEqual(size.width, 800);
    assert.strictEqual(size.height, 600);
});

test('a portrait photo caps on height', () => {
    const size = Photo.scaledSize(3000, 4000, 800);
    assert.strictEqual(size.width, 600);
    assert.strictEqual(size.height, 800);
});

test('a small photo is left alone — upscaling stores a blurrier, bigger copy', () => {
    assert.deepStrictEqual(Photo.scaledSize(200, 150, 800), { width: 200, height: 150 });
});

test('a photo exactly at the cap is left alone', () => {
    assert.deepStrictEqual(Photo.scaledSize(800, 800, 800), { width: 800, height: 800 });
});

test('an extreme panorama still yields at least one pixel of height', () => {
    const size = Photo.scaledSize(10000, 3, 800);
    assert.strictEqual(size.width, 800);
    assert.ok(size.height >= 1);
});

test('nonsense dimensions do not produce a zero-sized canvas', () => {
    for (const [w, h] of [[0, 0], [-5, 10], [NaN, NaN], [undefined, undefined]]) {
        const size = Photo.scaledSize(w, h, 800);
        assert.ok(size.width >= 1 && size.height >= 1, `${w}x${h}`);
    }
});

test('the default cap is used when none is given', () => {
    assert.deepStrictEqual(
        Photo.scaledSize(4000, 4000), Photo.scaledSize(4000, 4000, Photo.MAX_EDGE_PX));
});

// ── Where it goes ────────────────────────────────────────────────────────────

test('every upload gets its own path, so a replacement is never served from cache', () => {
    const first = Photo.photoStoragePath('p1', 'file1');
    const second = Photo.photoStoragePath('p1', 'file2');
    assert.notStrictEqual(first, second);
    assert.ok(first.startsWith(Photo.STORAGE_ROOT + '/p1/'));
});

// ── What is written on the Person ────────────────────────────────────────────

test('setting a photo writes exactly the two photo fields', () => {
    const update = Photo.buildPhotoUpdate('https://example.com/a.jpg', 'people_photos/p1/f1');
    assert.deepStrictEqual(update, {
        photoUrl: 'https://example.com/a.jpg',
        photoPath: 'people_photos/p1/f1',
    });
    assert.deepStrictEqual(Object.keys(update).sort(), Photo.PHOTO_FIELDS.slice().sort());
});

test('clearing a photo nulls both fields rather than leaving a dangling path', () => {
    assert.deepStrictEqual(Photo.buildPhotoClear(), { photoUrl: null, photoPath: null });
});

test('a photo write never touches membership, tags or anything shepherding', () => {
    const keys = Object.keys(Photo.buildPhotoUpdate('u', 'p'))
        .concat(Object.keys(Photo.buildPhotoClear()));
    for (const key of keys) {
        assert.ok(Photo.PHOTO_FIELDS.includes(key), `${key} is not a photo field`);
    }
});

// ── Who may set it ───────────────────────────────────────────────────────────

test('you may set your own photo', () => {
    assert.ok(Photo.canManagePhoto('member', 'p1', 'p1'));
    assert.ok(Photo.canManagePhoto('viewer', 'p1', 'p1'));
});

test('you may not set somebody else\'s', () => {
    assert.ok(!Photo.canManagePhoto('member', 'p1', 'p2'));
    assert.ok(!Photo.canManagePhoto('viewer', 'p1', 'p2'));
});

test('an unlinked account may set nobody\'s', () => {
    assert.ok(!Photo.canManagePhoto('member', null, 'p1'));
    assert.ok(!Photo.canManagePhoto('member', undefined, 'p1'));
});

test('editors and above may set anyone\'s', () => {
    for (const level of ['editor', 'elder', 'admin', 'super_admin']) {
        assert.ok(Photo.canManagePhoto(level, null, 'p2'), level);
        assert.ok(Photo.canManagePhoto(level, 'p1', 'p2'), level);
    }
});

test('a missing Person is never manageable, whoever is asking', () => {
    assert.ok(!Photo.canManagePhoto('super_admin', 'p1', null));
    assert.ok(!Photo.canManagePhoto('member', 'p1', ''));
});
