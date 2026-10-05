const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Home = require('../public/home-dashboard-core.js');

function hymn(name, id) {
    return { name: name, id: id || '' };
}

function fullLiturgy(overrides) {
    const liturgy = {
        callToWorship: 'Come',
        callToConfession: 'Confess',
        assuranceOfPardon: 'Pardon',
        scriptureReading: 'Psalm 23',
        sermon: 'Psalm 23',
        benediction: 'Go',
        preparatoryHymn: hymn('A', '1'),
        hymn1: hymn('B', '2'),
        hymn2: hymn('C', '3'),
        hymnMid1: hymn('D', '4'),
        hymnMid2: hymn('E', '5'),
        hymnEnd1: hymn('F', '6'),
        hymnEnd2: hymn('G', '7'),
    };
    return Object.assign(liturgy, overrides || {});
}

test('a finished Sunday is every field set', () => {
    const ready = Home.readiness({
        serviceLeader: 'Mark',
        musicLeader: 'Hannah',
        preacher: 'Daniel',
        liturgy: fullLiturgy(),
    });
    assert.equal(ready.notReady, false);
    assert.equal(ready.set, ready.total);
    assert.equal(ready.fraction, ready.set + ' of ' + ready.total + ' set');
    assert.equal(ready.short, '');
});

test('blank fields are named, and an unlinked hymn is not called blank', () => {
    const liturgy = fullLiturgy({
        benediction: '',
        hymnEnd2: { name: '' },
        hymn1: hymn('Amazing Grace', ''),
    });
    const ready = Home.readiness({
        serviceLeader: 'Mark',
        musicLeader: 'Hannah',
        preacher: 'Daniel',
        liturgy: liturgy,
    });
    assert.equal(ready.notReady, true);
    assert.ok(ready.blanks.indexOf('Benediction') !== -1);
    assert.ok(ready.blanks.indexOf('Hymn End 2') !== -1);
    assert.deepEqual(ready.literals, ['Hymn 1']);
    assert.match(ready.short, /Benediction and Hymn End 2 are blank/);
    assert.match(ready.short, /1 hymn is not linked to the book/);
    assert.equal(ready.set, ready.total - ready.blanks.length - ready.literals.length);
});

test('a Sunday with a baptism does not also require the two hymns it replaces', () => {
    const withBaptism = Home.checklist({
        hasBaptism: true,
        liturgy: { baptism: [{ name: 'Ada' }] },
    });
    const labels = withBaptism.map(function (item) { return item.label; });
    assert.ok(labels.indexOf('Baptism') !== -1);
    assert.ok(labels.indexOf('Hymn 2') === -1);
    assert.ok(labels.indexOf('Hymn Mid 1') === -1);

    const without = Home.checklist({ liturgy: {} });
    const plain = without.map(function (item) { return item.label; });
    assert.ok(plain.indexOf('Hymn 2') !== -1);
    assert.ok(plain.indexOf('Baptism') === -1);
});

test('an irregular service is not scored', () => {
    const ready = Home.readiness({ isIrregular: true, preacher: '' });
    assert.equal(ready.irregular, true);
    assert.equal(ready.notReady, false);
    assert.equal(ready.total, 0);
    assert.deepEqual(Home.glance({ isIrregular: true, theme: 'Hidden' }), {
        theme: '', sermon: '', pairs: [], baptism: '',
    });
});

test('dotted liturgy keys fold into the nested liturgy', () => {
    const svc = Home.normalizeService({
        preacher: 'Daniel',
        'liturgy.sermon': 'Psalm 23',
        liturgy: { callToWorship: 'Come' },
    });
    assert.equal(svc.liturgy.sermon, 'Psalm 23');
    assert.equal(svc.liturgy.callToWorship, 'Come');
    assert.equal(svc.preacher, 'Daniel');
});

test('the glance lifts the theme out and keeps the other facts', () => {
    const view = Home.glance({
        theme: 'The Lord Is My Shepherd',
        preacher: 'Daniel',
        serviceLeader: 'Mark',
        musicLeader: 'Hannah',
        hasBaptism: true,
        liturgy: {
            sermon: 'Psalm 23',
            prayerMale: { name: 'Owen' },
            baptism: [{ name: 'Ada' }],
        },
    });
    assert.equal(view.theme, 'The Lord Is My Shepherd');
    assert.equal(view.sermon, 'Psalm 23');
    assert.deepEqual(view.pairs.map(function (pair) { return pair.k; }),
        ['Sermon', 'Preacher', 'Service Leader', 'Music Leader', 'Pastoral Prayer']);
    assert.equal(view.baptism, 'Ada');
});

test('the date reads day then month', () => {
    assert.equal(Home.dayMonth('2026-10-11', '2026-10-05'), '11 October');
    assert.equal(Home.dayMonth('2027-01-03', '2026-10-05'), '3 January 2027');
    assert.equal(Home.shortDay('2026-10-18'), '18 Oct');
});

test('only an editor and above is asked to fix the blanks', () => {
    assert.equal(Home.canFixService('editor'), true);
    assert.equal(Home.canFixService('elder'), true);
    assert.equal(Home.canFixService('admin'), true);
    assert.equal(Home.canFixService('super_admin'), true);
    assert.equal(Home.canFixService('member'), false);
    assert.equal(Home.canFixService('viewer'), false);
});

test('this week names the next event and counts the rest', () => {
    const strip = Home.weekStrip([
        { date: '2026-10-04', name: 'Already happened', time: '10:00' },
        { date: '2026-10-06', name: "Elders' Meeting", time: '19:00' },
        { date: '2026-10-07', name: 'Youth Night', time: '18:30' },
        { date: '2026-10-09', name: 'Cancelled', time: '09:00', cancelled: true },
        { date: '2026-10-12', name: 'Next week', time: '10:00' },
    ], '2026-10-05');
    assert.equal(strip.name, "Elders' Meeting");
    assert.equal(strip.when, 'Tue 7pm');
    assert.equal(strip.more, 1);
});

test('a week with nothing ahead says nothing', () => {
    assert.equal(Home.weekStrip([
        { date: '2026-10-04', name: 'Past', time: '10:00' },
    ], '2026-10-05'), null);
});

test('commitments name two ahead, and a cover ask is said as one', () => {
    const strip = Home.commitmentsStrip([
        { label: 'Reader', date: '2026-10-11' },
        { label: 'Nursery', date: '2026-10-18', coverAsked: true },
        { label: 'Welcome', date: '2026-10-25' },
    ]);
    assert.equal(strip.length, 2);
    assert.deepEqual(strip[0], { label: 'Reader', text: 'on 11 Oct' });
    assert.deepEqual(strip[1], { label: 'Nursery', text: 'cover asked for 18 Oct' });
});

test('the home page is the Sunday-first door', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    assert.match(html, /class="dash-sunday"/);
    assert.match(html, /id="sunday-glance"/);
    assert.match(html, /home-dashboard-core\.js/);
    assert.match(html, /id="dash-commitments"/);
    assert.match(html, /\.dash-strip\[hidden\] \{ display: none; \}/);
    assert.match(html, /\.dash-strips\[hidden\] \{ display: none; \}/);
    assert.match(html, /position: fixed; inset: 0/);
    assert.match(html, /id="dash-week"/);
    assert.match(html, /class="dash-ambient"/);
    assert.match(html, /class="dash-ambient__cursor-hex"/);
    assert.match(html, /shadowTau = 0\.02/);
    assert.doesNotMatch(html, /dash-ambient__cursor-ring/);
    assert.match(html, /set\(layers\.a, 14\)/);
    assert.match(html, /set\(layers\.dot, 8\)/);
    assert.match(html, /\.dash-ambient__cursor \{ display: none; \}/);
    assert.match(html, /data-card-key="hymn-directory"/);
    assert.match(html, /id="nav-cards-grid"/);
    assert.match(html, /id="service-notice"/);
    const phone = fs.readFileSync(path.join(__dirname, '../public/mobile/app.js'), 'utf8');
    assert.match(phone, /This Sunday/);
    assert.match(phone, /Not ready/);
});

test('7:00 is 7pm and 7:30 stays', () => {
    assert.equal(Home.compactTime('19:00'), '7pm');
    assert.equal(Home.compactTime('07:30'), '7:30am');
    assert.equal(Home.compactTime('00:00'), '12am');
    assert.equal(Home.compactTime(''), '');
});
