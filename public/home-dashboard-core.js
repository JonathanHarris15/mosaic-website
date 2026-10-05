// Home dashboard — the readings on the Sunday-first door.
//
// Pure. The page paints; this decides what the sentences are, so the desktop
// and the phone cannot disagree about the same Sunday.
//
// The checklist is the one the home page already used to decide "not ready":
// the roles, the liturgy text, baptism when the Sunday has one, and each hymn
// slot. A hymn typed in but not linked to the book is not blank, and it is
// not set either. An Irregular Service has no Order of Service to be short of.

(function (global) {
    'use strict';

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const TEXT_FIELDS = [
        ['callToWorship', 'Call to Worship'],
        ['callToConfession', 'Call to Confession'],
        ['assuranceOfPardon', 'Assurance of Pardon'],
        ['scriptureReading', 'Scripture Reading'],
        ['sermon', 'Sermon'],
        ['benediction', 'Benediction'],
    ];

    const HYMN_FIELDS = [
        ['preparatoryHymn', 'Preparatory Hymn'],
        ['hymn1', 'Hymn 1'],
        ['hymnMid2', 'Hymn Mid 2'],
        ['hymnEnd1', 'Hymn End 1'],
        ['hymnEnd2', 'Hymn End 2'],
    ];

    const HYMN_FIELDS_NO_BAPTISM = [
        ['hymn2', 'Hymn 2'],
        ['hymnMid1', 'Hymn Mid 1'],
    ];

    const FIXERS = ['editor', 'elder', 'admin', 'super_admin'];

    function canFixService(level) {
        return FIXERS.indexOf(level) !== -1;
    }

    function isDate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    }

    function parseDate(value) {
        const parts = String(value || '').split('-').map(Number);
        return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
    }

    function formatDate(date) {
        return date.getFullYear() + '-' +
            String(date.getMonth() + 1).padStart(2, '0') + '-' +
            String(date.getDate()).padStart(2, '0');
    }

    function todayKey(now) {
        const d = now instanceof Date ? now : new Date();
        return formatDate(d);
    }

    // "11 October", and the year when it is not this year's.
    function dayMonth(dateStr, today) {
        if (!isDate(dateStr)) return '';
        const d = parseDate(dateStr);
        let text = d.getDate() + ' ' + MONTHS[d.getMonth()];
        if (isDate(today) && dateStr.slice(0, 4) !== today.slice(0, 4)) {
            text += ' ' + d.getFullYear();
        }
        return text;
    }

    function shortDay(dateStr) {
        if (!isDate(dateStr)) return '';
        const d = parseDate(dateStr);
        return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
    }

    // Sunday through Saturday of the week `today` falls in.
    function weekBounds(today) {
        const d = parseDate(today);
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
        return { from: formatDate(start), to: formatDate(end) };
    }

    function addDays(dateStr, n) {
        const d = parseDate(dateStr);
        d.setDate(d.getDate() + n);
        return formatDate(d);
    }

    // Older saves wrote 'liturgy.sermon' as a literal field name. Fold those
    // into the nested liturgy the rest of the page reads. Same pass index.html
    // used to run inline.
    function normalizeService(raw) {
        const src = raw || {};
        const out = {};
        Object.keys(src).forEach(function (key) {
            if (key.indexOf('.') === -1) out[key] = src[key];
        });
        Object.keys(src).forEach(function (key) {
            if (key.indexOf('.') === -1) return;
            const parts = key.split('.');
            let obj = out;
            for (let i = 0; i < parts.length - 1; i++) {
                if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) obj[parts[i]] = {};
                obj = obj[parts[i]];
            }
            const leaf = parts[parts.length - 1];
            if (!obj[leaf]) obj[leaf] = src[key];
        });
        return out;
    }

    function filledText(value) {
        return !!(value && String(value).trim());
    }

    function hymnState(value) {
        const name = value && value.name && String(value.name).trim();
        if (!name) return 'blank';
        if (!value.id) return 'literal';
        return 'set';
    }

    function checklist(svc) {
        const service = svc || {};
        if (service.isIrregular) return [];
        const liturgy = service.liturgy || {};
        const items = [];

        function add(label, state) {
            items.push({ label: label, state: state });
        }

        add('Service Leader', service.serviceLeader ? 'set' : 'blank');
        add('Music Leader', service.musicLeader ? 'set' : 'blank');
        add('Preacher', service.preacher ? 'set' : 'blank');

        TEXT_FIELDS.forEach(function (pair) {
            add(pair[1], filledText(liturgy[pair[0]]) ? 'set' : 'blank');
        });

        if (service.hasBaptism) {
            const bap = liturgy.baptism;
            const count = Array.isArray(bap)
                ? bap.filter(function (c) { return c && c.name; }).length
                : (typeof bap === 'string' && bap.trim() ? 1 : 0);
            add('Baptism', count > 0 ? 'set' : 'blank');
        }

        const hymns = HYMN_FIELDS.concat(service.hasBaptism ? [] : HYMN_FIELDS_NO_BAPTISM);
        hymns.forEach(function (pair) {
            const state = hymnState(liturgy[pair[0]]);
            add(pair[1], state);
        });

        return items;
    }

    function joinNames(labels) {
        if (labels.length === 1) return labels[0];
        if (labels.length === 2) return labels[0] + ' and ' + labels[1];
        return labels[0] + ', ' + labels[1] + ', and ' + (labels.length - 2) + ' more';
    }

    // The short line under the fraction. Blanks are named. A hymn that is only
    // unlinked is said as a count, the way the old banner said it, because a
    // name there would read as if the slot were empty.
    function shortLine(blanks, literals) {
        const parts = [];
        if (blanks.length === 1) parts.push(blanks[0] + ' is blank');
        else if (blanks.length > 1) parts.push(joinNames(blanks) + ' are blank');
        if (literals.length === 1) parts.push('1 hymn is not linked to the book');
        else if (literals.length > 1) parts.push(literals.length + ' hymns are not linked to the book');
        return parts.join(', and ');
    }

    function readiness(svc) {
        const service = svc || {};
        if (service.isIrregular) {
            return {
                irregular: true,
                total: 0,
                set: 0,
                notReady: false,
                fraction: '',
                short: '',
                blanks: [],
                literals: [],
            };
        }
        const items = checklist(service);
        const blanks = items.filter(function (item) { return item.state === 'blank'; }).map(function (item) { return item.label; });
        const literals = items.filter(function (item) { return item.state === 'literal'; }).map(function (item) { return item.label; });
        const set = items.length - blanks.length - literals.length;
        return {
            irregular: false,
            total: items.length,
            set: set,
            notReady: blanks.length + literals.length > 0,
            fraction: set + ' of ' + items.length + ' set',
            short: shortLine(blanks, literals),
            blanks: blanks,
            literals: literals,
        };
    }

    function glance(svc) {
        const service = svc || {};
        if (service.isIrregular) {
            return { theme: '', sermon: '', pairs: [], baptism: '' };
        }
        const liturgy = service.liturgy || {};
        const pairs = [];
        if (filledText(liturgy.sermon)) pairs.push({ k: 'Sermon', v: String(liturgy.sermon).trim() });
        if (service.preacher) pairs.push({ k: 'Preacher', v: String(service.preacher) });
        if (service.serviceLeader) pairs.push({ k: 'Service Leader', v: String(service.serviceLeader) });
        if (service.musicLeader) pairs.push({ k: 'Music Leader', v: String(service.musicLeader) });

        const prayers = [];
        if (liturgy.prayerMale && liturgy.prayerMale.name) prayers.push(liturgy.prayerMale.name);
        if (liturgy.prayerFemale && liturgy.prayerFemale.name) prayers.push(liturgy.prayerFemale.name);
        if (prayers.length) pairs.push({ k: 'Pastoral Prayer', v: prayers.join(', ') });

        let baptism = '';
        if (service.hasBaptism) {
            const bap = liturgy.baptism;
            baptism = (Array.isArray(bap)
                ? bap.map(function (c) { return c && c.name; }).filter(Boolean).join(', ')
                : (typeof bap === 'string' ? bap : '')) || 'Name not specified';
        }

        return {
            theme: filledText(service.theme) ? String(service.theme).trim() : '',
            sermon: filledText(liturgy.sermon) ? String(liturgy.sermon).trim() : '',
            pairs: pairs,
            baptism: baptism,
        };
    }

    // "7pm" from "19:00". A non-zero minute stays: "7:30pm".
    function compactTime(hhmm) {
        const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
        if (!match) return '';
        const hour = Number(match[1]);
        const meridiem = hour < 12 ? 'am' : 'pm';
        const display = hour % 12 === 0 ? 12 : hour % 12;
        return match[2] === '00' ? display + meridiem : display + ':' + match[2] + meridiem;
    }

    // The next thing still ahead this week, and how many follow it.
    function weekStrip(events, today) {
        if (!isDate(today)) return null;
        const end = weekBounds(today).to;
        const rows = (events || []).filter(function (event) {
            if (!event || !isDate(event.date)) return false;
            if (event.cancelled || event.movedTo) return false;
            return event.date >= today && event.date <= end;
        }).slice().sort(function (a, b) {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            return String(a.time || '').localeCompare(String(b.time || ''));
        });
        if (!rows.length) return null;
        const first = rows[0];
        const when = DOW[parseDate(first.date).getDay()];
        const time = compactTime(first.time);
        return {
            name: first.name || 'Event',
            when: time ? when + ' ' + time : when,
            more: rows.length - 1,
        };
    }

    // Up to two commitments. `coverAsked` is the design's second clause —
    // somebody asked you to cover — and the page only sets it when that is
    // actually true.
    function commitmentsStrip(rows) {
        const list = (rows || []).filter(function (row) {
            return row && row.label && isDate(row.date);
        }).slice(0, 2);
        if (!list.length) return null;
        return list.map(function (row) {
            const when = shortDay(row.date);
            return {
                label: row.label,
                text: row.coverAsked ? 'cover asked for ' + when : 'on ' + when,
            };
        });
    }

    const HomeDashboard = {
        canFixService: canFixService,
        todayKey: todayKey,
        dayMonth: dayMonth,
        shortDay: shortDay,
        weekBounds: weekBounds,
        addDays: addDays,
        normalizeService: normalizeService,
        checklist: checklist,
        readiness: readiness,
        glance: glance,
        compactTime: compactTime,
        weekStrip: weekStrip,
        commitmentsStrip: commitmentsStrip,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = HomeDashboard;
    } else {
        global.HomeDashboard = HomeDashboard;
    }
}(typeof window !== 'undefined' ? window : globalThis));
