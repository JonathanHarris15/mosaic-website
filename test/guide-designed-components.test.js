const { test } = require('node:test');
const assert = require('node:assert');

const Engine = require('../public/guide-engine.js');
const Components = require('../public/guide-components.js');

// The designed booklet (Claude Design import) decomposes the Order of Service
// into granular, fixed-slot value Components rather than the single <oos-list>
// master, so a page author can lay out the liturgy by hand in the editor. These
// tests pin each new Component's render to the structured Service it reads.

const catalog = Components.defaultCatalog;

function ctx() {
    return {
        attrs: {}, params: {}, values: {},
        service: {
            theme: 'The Heavenly Prince',
            preacher: 'J.P. Shafer', musicLeader: 'Sam Crites', serviceLeader: 'Sam Crites',
            liturgy: {
                callToWorship: 'Isaiah 9:2–6', callToConfession: 'Ephesians 2:1–3',
                assuranceOfPardon: 'Revelation 1:4–8', scriptureReading: 'Hebrews 4:14–16',
                sermon: 'Daniel 8', benediction: 'Jude 24–25',
                preparatoryHymn: { name: 'Behold Our God' },
                hymn1: { name: 'All Hail the Power of Jesus’ Name' },
                hymn2: { name: 'Come, Thou Long Expected Jesus' },
                hymnMid1: { name: 'Lord Have Mercy' }, hymnMid2: { name: 'How Sweet and Aweful' },
                hymnEnd1: { name: 'Christ Our Wisdom' }, hymnEnd2: { name: 'All Glory Be to Christ' },
            },
            hymnsByField: { hymn1: { name: 'All Hail the Power of Jesus’ Name', pages: ['h1a.png', 'h1b.png'], attribution: 'CCLI #264766' } },
            schedule: [
                { id: '2025-07-27', preacher: 'Sam Crites', sermon: 'Daniel 9:1–23' },
                { id: '2025-08-03', preacher: 'Sam Crites', sermon: 'Daniel 9:24–27' },
            ],
        },
    };
}
const render = (tag, c) => catalog.get(tag).render(c || ctx());

test('every designed Component is registered, bound, and builder-surface', () => {
    const tags = ['hymn-preparatory', 'hymn-1', 'hymn-2', 'hymn-mid-1', 'hymn-mid-2', 'hymn-end-1', 'hymn-end-2',
        'ref-call-to-worship', 'ref-call-to-confession', 'ref-assurance', 'ref-scripture-reading', 'ref-sermon', 'ref-benediction',
        'preacher-name', 'music-leader-name', 'service-leader-name', 'hymn-name', 'hymn-image', 'hymn-attribution', 'mosaic-schedule'];
    for (const t of tags) {
        const c = catalog.get(t);
        assert.ok(c, `missing component ${t}`);
        assert.strictEqual(c.kind, 'bound', `${t} should be bound`);
        assert.strictEqual(c.surface, 'builder', `${t} should be builder-surface`);
    }
});

test('hymn-slot Components render the fixed liturgy hymn name', () => {
    assert.strictEqual(render('hymn-preparatory'), 'Behold Our God');
    assert.strictEqual(render('hymn-1'), 'All Hail the Power of Jesus’ Name');
    assert.strictEqual(render('hymn-end-2'), 'All Glory Be to Christ');
});

test('ref Components render the scripture reference string', () => {
    assert.strictEqual(render('ref-call-to-worship'), 'Isaiah 9:2–6');
    assert.strictEqual(render('ref-sermon'), 'Daniel 8');
    assert.strictEqual(render('ref-benediction'), 'Jude 24–25');
});

test('person Components render the service roles', () => {
    assert.strictEqual(render('preacher-name'), 'J.P. Shafer');
    assert.strictEqual(render('music-leader-name'), 'Sam Crites');
    assert.strictEqual(render('service-leader-name'), 'Sam Crites');
});

test('an omitted/empty slot renders nothing (no dangling row)', () => {
    const c = ctx(); delete c.service.liturgy.hymn2;
    assert.strictEqual(catalog.get('hymn-2').render(c), '');
});

test('hymn-name / hymn-image bind to the PAGE placement slot via params.field', () => {
    const c = ctx(); c.params = { field: 'hymn1' };
    assert.strictEqual(render('hymn-name', c), 'All Hail the Power of Jesus’ Name');
    const img = render('hymn-image', c);
    assert.match(img, /h1a\.png/);          // first sheet image only (v1; pagination deferred)
    assert.doesNotMatch(img, /h1b\.png/);
    assert.strictEqual(render('hymn-attribution', c), 'CCLI #264766');
});

test('hymn-image falls back to a "not found" note when no sheet on file', () => {
    const c = ctx(); c.params = { field: 'hymn2' };  // no entry in hymnsByField
    assert.match(render('hymn-image', c), /No music sheet found/);
});

test('mosaic-schedule renders the designed grid with Mon-DD dates', () => {
    const out = render('mosaic-schedule');
    assert.match(out, /m-sched-row m-sched-head/);
    assert.match(out, /Jul 27/);
    assert.match(out, /Aug 3/);
    assert.match(out, /Daniel 9:1–23/);
});

test('output is HTML-escaped (no injection from service data)', () => {
    const c = ctx(); c.service.preacher = '<script>x</script>';
    assert.strictEqual(render('preacher-name', c), '&lt;script&gt;x&lt;/script&gt;');
});

test('the new tags carry palette groups for the Manager', () => {
    const pal = catalog.palette();
    const byTag = Object.fromEntries(pal.bound.map(b => [b.tag, b]));
    assert.strictEqual(byTag['hymn-1'].group, 'Order of Service');
    assert.strictEqual(byTag['hymn-image'].group, 'Hymn');
    assert.strictEqual(byTag['mosaic-schedule'].group, 'Announcements');
});
