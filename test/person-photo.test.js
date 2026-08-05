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

// ── Framing (ADR-0029 §6) ────────────────────────────────────────────────────
//
// A photo is almost never a headshot, so the Person carries a crop alongside
// the image: where to look and how close. It is stored rather than baked in, so
// reframing later edits two numbers instead of needing the original file.

test('a Person saved before framing existed still renders, centred', () => {
    assert.deepStrictEqual(Photo.normalizeCrop(undefined), Photo.DEFAULT_CROP);
    assert.deepStrictEqual(Photo.normalizeCrop(null), Photo.DEFAULT_CROP);
    assert.deepStrictEqual(Photo.normalizeCrop({}), Photo.DEFAULT_CROP);
});

test('the default crop is centred and unzoomed', () => {
    assert.deepStrictEqual(Photo.DEFAULT_CROP, { x: 50, y: 50, zoom: 1 });
});

test('panning past an edge stops at the edge', () => {
    assert.deepStrictEqual(Photo.normalizeCrop({ x: -40, y: 300, zoom: 1 }), { x: 0, y: 100, zoom: 1 });
});

test('zoom never drops below 1 — the image must keep filling the circle', () => {
    assert.strictEqual(Photo.normalizeCrop({ zoom: 0.2 }).zoom, Photo.MIN_ZOOM);
    assert.strictEqual(Photo.normalizeCrop({ zoom: -3 }).zoom, Photo.MIN_ZOOM);
});

test('zoom is capped, so nobody stores a 400x magnification of one pixel', () => {
    assert.strictEqual(Photo.normalizeCrop({ zoom: 99 }).zoom, Photo.MAX_ZOOM);
});

test('junk values fall back rather than producing NaN in a style string', () => {
    const crop = Photo.normalizeCrop({ x: 'left', y: NaN, zoom: Infinity });
    assert.ok(Number.isFinite(crop.x) && Number.isFinite(crop.y) && Number.isFinite(crop.zoom));
    assert.ok(!Photo.frameStyle({ x: 'left' }).includes('NaN'));
});

test('a crop is stored as round numbers, not fifteen decimal places', () => {
    const crop = Photo.normalizeCrop({ x: 33.33333, y: 66.66666, zoom: 1.23456 });
    assert.strictEqual(crop.x, 33);
    assert.strictEqual(crop.y, 67);
    assert.strictEqual(crop.zoom, 1.23);
});

test('the style covers the frame and positions by the crop', () => {
    const style = Photo.frameStyle({ x: 20, y: 80, zoom: 2 });
    assert.match(style, /object-fit: cover/);
    assert.match(style, /object-position: 20% 80%/);
    assert.match(style, /scale\(2\)/);
});

test('normalizing is idempotent — a stored crop reads back unchanged', () => {
    const once = Photo.normalizeCrop({ x: 12.7, y: 91.2, zoom: 2.345 });
    assert.deepStrictEqual(Photo.normalizeCrop(once), once);
});

test('dragging right reveals what was off to the left', () => {
    // You are moving the picture under a fixed window, so the crop travels the
    // opposite way to the pointer.
    const panned = Photo.panCrop({ x: 50, y: 50, zoom: 1 }, 20, 0, 100);
    assert.ok(panned.x < 50);
    assert.strictEqual(panned.y, 50);
});

test('dragging down reveals what was above', () => {
    const panned = Photo.panCrop({ x: 50, y: 50, zoom: 1 }, 0, 20, 100);
    assert.ok(panned.y < 50);
});

test('a drag feels the same on a small frame as a large one', () => {
    // Same fraction of the frame crossed → same movement, so the 56px card and
    // the 96px preview behave alike.
    const small = Photo.panCrop({ x: 50, y: 50, zoom: 1 }, 10, 0, 50);
    const large = Photo.panCrop({ x: 50, y: 50, zoom: 1 }, 20, 0, 100);
    assert.strictEqual(small.x, large.x);
});

test('a zoomed-in image pans more slowly, not faster', () => {
    const near = Photo.panCrop({ x: 50, y: 50, zoom: 1 }, 20, 0, 100);
    const far = Photo.panCrop({ x: 50, y: 50, zoom: 4 }, 20, 0, 100);
    assert.ok(Math.abs(50 - far.x) < Math.abs(50 - near.x));
});

test('panning keeps the zoom it was given', () => {
    assert.strictEqual(Photo.panCrop({ x: 50, y: 50, zoom: 2.5 }, 5, 5, 100).zoom, 2.5);
});

test('panning cannot escape the frame', () => {
    const panned = Photo.panCrop({ x: 50, y: 50, zoom: 1 }, 100000, -100000, 100);
    assert.strictEqual(panned.x, 0);
    assert.strictEqual(panned.y, 100);
});

test('a zero-sized frame does not divide by zero', () => {
    const panned = Photo.panCrop({ x: 50, y: 50, zoom: 1 }, 10, 10, 0);
    assert.ok(Number.isFinite(panned.x) && Number.isFinite(panned.y));
});

test('saving a crop writes only the crop field', () => {
    assert.deepStrictEqual(
        Photo.buildCropUpdate({ x: 10, y: 20, zoom: 1.5 }),
        { photoCrop: { x: 10, y: 20, zoom: 1.5 } });
});

// ── The same framing, in both shapes ─────────────────────────────────────────
// Surfaces differ — some build CSS strings, the phone app builds style objects —
// so the crop has two renderings. They must not be two answers.

test('the object form carries the same numbers as the string form', () => {
    const crop = { x: 20, y: 80, zoom: 2 };
    const obj = Photo.frameStyleObject(crop);
    const str = Photo.frameStyle(crop);
    assert.strictEqual(obj.objectFit, 'cover');
    assert.ok(str.includes(`object-position: ${obj.objectPosition}`));
    assert.ok(str.includes(obj.transform));
});

test('the object form normalizes too, so a missing crop still renders', () => {
    assert.deepStrictEqual(
        Photo.frameStyleObject(undefined), Photo.frameStyleObject(Photo.DEFAULT_CROP));
});

// ── Initials, for a Person with no photo ─────────────────────────────────────

test('initials take the first and last name', () => {
    assert.strictEqual(Photo.initialsOf('Jonathan Harris'), 'JH');
    assert.strictEqual(Photo.initialsOf('Mary Anne Jones'), 'MJ');
});

test('one name yields one letter', () => {
    assert.strictEqual(Photo.initialsOf('Prince'), 'P');
});

test('no name yields something rather than an empty circle', () => {
    assert.strictEqual(Photo.initialsOf(''), '?');
    assert.strictEqual(Photo.initialsOf('   '), '?');
    assert.strictEqual(Photo.initialsOf(null), '?');
    assert.strictEqual(Photo.initialsOf(undefined), '?');
});

test('extra whitespace does not become an extra initial', () => {
    assert.strictEqual(Photo.initialsOf('  Jonathan   Harris  '), 'JH');
});
