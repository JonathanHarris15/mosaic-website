// Liturgy Order Core — the congregation's Liturgy Orders (ADR-0080).
//
// The elements are five kinds, hardcoded. An order is a combination of them,
// in a sequence. A kind brings its own fields: a hymn is chosen on the Sunday,
// a scripture is named on the order and is a reference on the Sunday, a prayer
// is named on the order and may send prayer requests or be prayed by someone
// other than the service leader, a person event is named on the order and
// picked on the Sunday, and other is a name and nothing on the Sunday. Each one can take a
// note. There is no separate element record and no primitive to pick.
//
// A Sunday names its order with `liturgyOrderId` and keeps values at
// `liturgy.<elementId>` and notes at `notes[elementId]`. Changing the order
// hides values. It does not delete them.
//
// Pure. Loaded as a classic <script> (window.LiturgyOrderCore) on the pages,
// required under node:test, and copied into functions/shared by
// scripts/sync-shared-to-functions.js for the MCP read.
(function (global) {
    'use strict';

    const KINDS = Object.freeze(['hymn', 'scripture', 'prayer', 'person', 'other']);

    const KIND_LABELS = Object.freeze({
        hymn: 'Hymn',
        scripture: 'Scripture',
        prayer: 'Prayer',
        person: 'Person Event',
        other: 'Other',
    });

    // What older documents called a primitive, read back as a kind.
    const KIND_FROM_PRIMITIVE = Object.freeze({
        song: 'hymn',
        scripture: 'scripture',
        text: 'other',
        people: 'person',
        hymn: 'hymn',
        prayer: 'prayer',
        person: 'person',
        other: 'other',
    });

    const REQUEST_WHO = Object.freeze(['male', 'female', 'either']);
    const REQUEST_PEOPLE_MAX = 12;

    // How many days before the Sunday a prayer that sends requests tells
    // someone. A stored number is that day and the reminder two days closer,
    // the old 5-and-3 gap. Turning the ask on starts at 5, 3, and 1. An
    // empty list tells nobody on its own.
    const DEFAULT_NOTICE_DAYS = 5;
    const DEFAULT_NOTICE_LIST = Object.freeze([5, 3, 1]);
    const NOTICE_DAYS_MAX = 30;
    const NOTICE_REMINDER_GAP = 2;
    const PROSE_MAX = 1000;

    // The older Sunday fields are not elements. They are drawn under the
    // elements the seed already uses for those moments. A leader stays under
    // its row when that element is renamed, because the id does not change.
    // The people being prayed for follow the Sunday's prayer label, which the
    // seed names Pastoral Prayer.
    const LEGACY_PRAISE_ID = 'callToWorship';
    const LEGACY_CONFESSION_ID = 'callToConfession';
    const LEGACY_PRAYER_NAME = 'Pastoral Prayer';

    const STANDARD_ORDER_ID = 'standard';

    const COLLECTIONS = Object.freeze({
        elements: 'liturgy_elements',
        orders: 'liturgy_orders',
    });

    // A placed element's id becomes a key under `liturgy` and `notes` on the
    // Sunday, and a printable field name. These names are already spoken for.
    const RESERVED_IDS = Object.freeze([
        'prayerMale', 'prayerFemale', 'prayerLabel',
        'date', 'theme', 'keyVerse', 'keyVerseText',
        'preacher', 'serviceLeader', 'musicLeader', 'musicHelpers',
        'prayerPraise', 'prayerConfession', 'hasBaptism', 'removedHymns',
        'notes', 'liturgy', 'carriedBy', 'liturgyOrderId', 'decidedBy',
        'isIrregular', 'irregularElements', 'elements', 'other', 'guide',
        'constructor', 'prototype', '__proto__', 'toString', 'hasOwnProperty',
    ]);

    function seedElement(id, name, kind) {
        return decorate({ id: id, name: name, kind: kind, hasNote: true, requests: null });
    }

    // The fourteen slots every Sunday had, expressed as the five kinds. The
    // ids stay, so a Sunday and a printable already bound to `hymn1` or
    // `sermon` still resolve. Baptism stays the one person-event whose Sunday
    // value is the candidates list (ADR-0006).
    const STANDARD_ELEMENTS = Object.freeze([
        seedElement('preparatoryHymn', 'Preparatory Hymn', 'hymn'),
        seedElement('callToWorship', 'Call to Worship', 'scripture'),
        seedElement('hymn1', 'Hymn 1', 'hymn'),
        seedElement('hymn2', 'Hymn 2', 'hymn'),
        seedElement('callToConfession', 'Call to Confession', 'scripture'),
        seedElement('assuranceOfPardon', 'Assurance of Pardon', 'scripture'),
        seedElement('hymnMid1', 'Hymn 3', 'hymn'),
        seedElement('hymnMid2', 'Hymn 4', 'hymn'),
        seedElement('scriptureReading', 'Pastoral Prayer', 'scripture'),
        seedElement('sermon', 'Sermon', 'scripture'),
        seedElement('baptism', 'Baptism', 'person'),
        seedElement('hymnEnd1', 'Closing Hymn', 'hymn'),
        seedElement('hymnEnd2', 'Final Hymn', 'hymn'),
        seedElement('benediction', 'Benediction', 'scripture'),
    ]);

    const STANDARD_ORDER = Object.freeze({
        id: STANDARD_ORDER_ID,
        name: 'Standard',
        elements: Object.freeze(STANDARD_ELEMENTS.map(copyElement)),
        elementIds: Object.freeze(STANDARD_ELEMENTS.map(function (el) { return el.id; })),
    });

    function isKind(value) {
        return KINDS.indexOf(value) !== -1;
    }

    function kindTakesName(kind) {
        return kind === 'scripture' || kind === 'prayer' || kind === 'person' || kind === 'other';
    }

    function prayedByOtherOf(kind, src) {
        return kind === 'prayer' && !!(src && src.prayedByOther === true);
    }

    function whoOf(raw) {
        return REQUEST_WHO.indexOf(raw) === -1 ? 'either' : raw;
    }

    function sharedWho(people) {
        if (!people.length) return 'either';
        const first = people[0].who;
        for (let i = 1; i < people.length; i++) {
            if (people[i].who !== first) return 'either';
        }
        return first;
    }

    // One line per person. An older { count, who } becomes that many lines
    // of the same who.
    function normalisePeople(raw) {
        const src = raw || {};
        let people = [];
        if (Array.isArray(src.people) && src.people.length) {
            people = src.people.map(function (person) {
                return { who: whoOf(person && person.who) };
            });
        } else {
            const who = whoOf(src.who);
            let count = parseInt(src.count, 10);
            if (!count || count < 1) count = 1;
            if (count > REQUEST_PEOPLE_MAX) count = REQUEST_PEOPLE_MAX;
            for (let i = 0; i < count; i++) people.push({ who: who });
        }
        if (people.length > REQUEST_PEOPLE_MAX) people = people.slice(0, REQUEST_PEOPLE_MAX);
        if (!people.length) people = [{ who: 'either' }];
        return people;
    }

    // A number already saved is that day plus the reminder two days closer.
    // A list is the days themselves. Empty tells nobody.
    function legacyNoticeList(n) {
        let first = n;
        if (first > NOTICE_DAYS_MAX) first = NOTICE_DAYS_MAX;
        if (first < 1) return [];
        const reminder = first - NOTICE_REMINDER_GAP;
        if (reminder >= 1) return [first, reminder];
        return [first];
    }

    function normaliseNoticeDays(raw) {
        if (Array.isArray(raw)) {
            const days = [];
            raw.forEach(function (value) {
                let n = parseInt(value, 10);
                if (!Number.isFinite(n) || n < 1) return;
                if (n > NOTICE_DAYS_MAX) n = NOTICE_DAYS_MAX;
                if (days.indexOf(n) === -1) days.push(n);
            });
            days.sort(function (a, b) { return b - a; });
            return days;
        }
        if (raw == null || raw === '') return legacyNoticeList(DEFAULT_NOTICE_DAYS);
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0) return [];
        return legacyNoticeList(n);
    }

    function proseOf(value) {
        const text = String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
        return text.length > PROSE_MAX ? text.slice(0, PROSE_MAX) : text;
    }

    function cleanName(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    // The shape older pages still branch on. Derived, never stored.
    function primitiveOf(el) {
        if (!el) return 'other';
        if (el.kind === 'hymn') return 'song';
        if (el.kind === 'scripture') return 'scripture';
        if (el.kind === 'prayer') return 'prayer';
        if (el.kind === 'person') return el.id === 'baptism' ? 'people' : 'person';
        return 'other';
    }

    function normaliseRequests(kind, raw) {
        if (kind !== 'prayer' || !raw || typeof raw !== 'object') return null;
        const people = normalisePeople(raw);
        return { people: people, count: people.length, who: sharedWho(people) };
    }

    function decorate(src) {
        const kind = src.kind;
        const requests = normaliseRequests(kind, src.requests);
        const el = {
            id: src.id,
            kind: kind,
            name: src.name,
            hasNote: src.hasNote !== false,
            requests: requests,
            noticeDays: requests ? normaliseNoticeDays(src.noticeDays) : null,
            prayedByOther: prayedByOtherOf(kind, src),
            hasRole: false,
        };
        if (kind === 'prayer') {
            el.message = proseOf(src.message);
            el.response = proseOf(src.response);
        }
        el.primitive = primitiveOf(el);
        return el;
    }

    function copyElement(el) {
        return decorate(el);
    }

    function copyOrder(order) {
        const elements = (order.elements || []).map(copyElement);
        return {
            id: order.id,
            name: order.name,
            elements: elements,
            elementIds: elements.map(function (el) { return el.id; }),
        };
    }

    function kindOf(raw) {
        const src = raw || {};
        if (isKind(src.kind)) return src.kind;
        if (src.primitive && KIND_FROM_PRIMITIVE[src.primitive]) return KIND_FROM_PRIMITIVE[src.primitive];
        return null;
    }

    function normaliseElement(raw, fallbackId) {
        const src = raw || {};
        const id = cleanName(src.id != null ? src.id : fallbackId);
        const kind = kindOf(src);
        if (!id || !kind) return null;
        const name = cleanName(src.name) || KIND_LABELS[kind];
        return decorate({
            id: id,
            kind: kind,
            name: name,
            hasNote: src.hasNote,
            requests: src.requests,
            noticeDays: src.noticeDays,
            prayedByOther: src.prayedByOther,
            message: src.message,
            response: src.response,
        });
    }

    function normaliseOrder(raw, fallbackId, looseById) {
        const src = raw || {};
        const id = cleanName(src.id != null ? src.id : fallbackId);
        if (!id) return null;
        const seen = new Set();
        const elements = [];
        const push = function (el) {
            if (!el || seen.has(el.id)) return;
            seen.add(el.id);
            elements.push(el);
        };
        if (Array.isArray(src.elements)) {
            src.elements.forEach(function (rawEl) { push(normaliseElement(rawEl)); });
        } else {
            (Array.isArray(src.elementIds) ? src.elementIds : []).forEach(function (value) {
                const elId = cleanName(value);
                push(elId && looseById ? looseById.get(elId) : null);
            });
        }
        return { id: id, name: cleanName(src.name) || id, elements: elements, elementIds: elements.map(function (el) { return el.id; }) };
    }

    function poolFrom(orders, loose) {
        const seen = new Set();
        const elements = [];
        const push = function (el) {
            if (!el || seen.has(el.id)) return;
            seen.add(el.id);
            elements.push(copyElement(el));
        };
        (orders || []).forEach(function (order) { (order.elements || []).forEach(push); });
        (loose || []).forEach(push);
        return elements;
    }

    function standardCatalog() {
        const order = copyOrder(STANDARD_ORDER);
        return { elements: order.elements.map(copyElement), orders: [order] };
    }

    // What the pages read. An order carries its elements. An older document
    // that stored elements apart from the order is joined back on read.
    // Empty reads as the Standard seed. Standard is always present.
    function catalogFrom(input) {
        const src = input || {};
        const rawElements = Array.isArray(src.elements) ? src.elements : [];
        const rawOrders = Array.isArray(src.orders) ? src.orders : [];
        if (!rawElements.length && !rawOrders.length) return standardCatalog();

        const loose = [];
        const looseById = new Map();
        rawElements.forEach(function (raw) {
            const el = normaliseElement(raw);
            if (!el || looseById.has(el.id)) return;
            looseById.set(el.id, el);
            loose.push(el);
        });

        const orders = [];
        const seenOrder = new Set();
        rawOrders.forEach(function (raw) {
            const order = normaliseOrder(raw, null, looseById);
            if (!order || seenOrder.has(order.id)) return;
            seenOrder.add(order.id);
            orders.push(order);
        });

        if (!orders.length) {
            const seed = copyOrder(STANDARD_ORDER);
            return { elements: loose.length ? loose.map(copyElement) : seed.elements.map(copyElement), orders: [seed] };
        }
        if (!orders.some(function (o) { return o.id === STANDARD_ORDER_ID; })) {
            orders.unshift(copyOrder(STANDARD_ORDER));
        }
        return { elements: poolFrom(orders, loose), orders: orders };
    }

    function elementById(catalog, id) {
        const list = (catalog && catalog.elements) || STANDARD_ELEMENTS;
        for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function orderById(catalog, id) {
        const list = (catalog && catalog.orders) || [STANDARD_ORDER];
        for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function orderIdOf(service) {
        const id = service && typeof service.liturgyOrderId === 'string' ? service.liturgyOrderId.trim() : '';
        return id || STANDARD_ORDER_ID;
    }

    function orderFor(service, catalog) {
        return orderById(catalog, orderIdOf(service)) ||
            orderById(catalog, STANDARD_ORDER_ID) ||
            STANDARD_ORDER;
    }

    function elementsOf(order) {
        if (order && Array.isArray(order.elements) && order.elements.length) return order.elements.slice();
        return [];
    }

    function elementsFor(service, catalog) {
        return elementsOf(orderFor(service, catalog));
    }

    function songIdsOf(order) {
        return elementsOf(order)
            .filter(function (el) { return el.kind === 'hymn'; })
            .map(function (el) { return el.id; });
    }

    function allSongIds(catalog) {
        const list = (catalog && catalog.elements) || STANDARD_ELEMENTS;
        return list.filter(function (el) { return el.kind === 'hymn'; }).map(function (el) { return el.id; });
    }

    function byName(a, b) {
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        if (an !== bn) return an < bn ? -1 : 1;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    }

    function toggledOrders(catalog, toggledIds) {
        const wanted = new Set(Array.isArray(toggledIds) ? toggledIds : []);
        const orders = ((catalog && catalog.orders) || []).filter(function (o) { return wanted.has(o.id); });
        const standard = orders.filter(function (o) { return o.id === STANDARD_ORDER_ID; });
        const rest = orders.filter(function (o) { return o.id !== STANDARD_ORDER_ID; }).sort(byName);
        return standard.concat(rest);
    }

    function tableColumns(catalog, toggledIds) {
        const seen = new Set();
        const out = [];
        toggledOrders(catalog, toggledIds).forEach(function (order) {
            elementsOf(order).forEach(function (el) {
                if (seen.has(el.id)) return;
                seen.add(el.id);
                out.push(el);
            });
        });
        return out;
    }

    function defaultToggles() {
        return [STANDARD_ORDER_ID];
    }

    function readToggles(stored, catalog) {
        if (!Array.isArray(stored)) return defaultToggles();
        const ids = new Set(((catalog && catalog.orders) || []).map(function (o) { return o.id; }));
        const kept = stored.filter(function (id) { return typeof id === 'string' && ids.has(id); });
        return kept.length || !stored.length ? kept : defaultToggles();
    }

    function valueOf(service, el) {
        const liturgy = (service && service.liturgy) || {};
        return liturgy[el.id];
    }

    function carrierOf(service, el) {
        const map = (service && service.carriedBy) || {};
        const ref = map[el.id];
        if (!ref || typeof ref !== 'object') return null;
        const name = cleanName(ref.name);
        if (!name && !ref.id) return null;
        return { id: ref.id || null, name: name };
    }

    function displayValue(kindOrPrimitive, value) {
        const kind = isKind(kindOrPrimitive) ? kindOrPrimitive : (KIND_FROM_PRIMITIVE[kindOrPrimitive] || 'other');
        if (value == null || kind === 'other') return '';
        if (kind === 'hymn') {
            if (typeof value === 'string') return value.trim();
            return cleanName(value.name);
        }
        if (kind === 'person' || kind === 'prayer') {
            if (typeof value === 'string') return value.trim();
            if (Array.isArray(value)) {
                return value.map(function (p) { return p && cleanName(p.name); }).filter(Boolean).join(', ');
            }
            if (typeof value === 'object') return cleanName(value.name);
            return '';
        }
        return typeof value === 'string' ? value.trim() : '';
    }

    function emptyValue(kindOrPrimitive) {
        const kind = isKind(kindOrPrimitive) ? kindOrPrimitive : (KIND_FROM_PRIMITIVE[kindOrPrimitive] || null);
        if (kindOrPrimitive === 'people' || kind === 'prayer') return [];
        if (kind === 'hymn' || kind === 'person') return { name: '', id: null };
        if (kind === 'other') return null;
        return '';
    }

    function cloneCatalog(catalog) {
        const src = catalog || standardCatalog();
        const orders = (src.orders || []).map(copyOrder);
        const loose = (src.elements || []).map(copyElement);
        return { elements: poolFrom(orders, loose), orders: orders };
    }

    function syncPool(catalog) {
        catalog.elements = poolFrom(catalog.orders, catalog.elements);
        catalog.orders.forEach(function (order) {
            order.elementIds = (order.elements || []).map(function (el) { return el.id; });
        });
        return catalog;
    }

    function slugFor(name) {
        const words = cleanName(name)
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Za-z0-9]+/g, ' ')
            .trim()
            .split(' ')
            .filter(Boolean);
        if (!words.length) return 'element';
        let slug = words.map(function (w, i) {
            const lower = w.toLowerCase();
            return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
        }).join('');
        if (/^[0-9]/.test(slug)) slug = 'element' + slug;
        return slug;
    }

    function freshId(base, taken) {
        const reserved = new Set(RESERVED_IDS);
        let id = base;
        let n = 2;
        while (taken.has(id) || reserved.has(id)) {
            id = base + n;
            n += 1;
        }
        return id;
    }

    function takenIds(catalog) {
        const taken = new Set();
        (catalog.elements || []).forEach(function (el) { taken.add(el.id); });
        (catalog.orders || []).forEach(function (order) {
            (order.elements || []).forEach(function (el) { taken.add(el.id); });
        });
        return taken;
    }

    // Place one of the five kinds on an order. The instance is born here:
    // the kind is fixed, and the order holds it.
    function placeKind(catalog, orderId, kind, index, fields) {
        if (!isKind(kind)) throw new Error('That is not one of the elements.');
        const next = cloneCatalog(catalog);
        const order = next.orders.find(function (o) { return o.id === orderId; });
        if (!order) throw new Error('That order is gone.');
        const src = fields || {};
        const name = cleanName(src.name) || KIND_LABELS[kind];
        if (kindTakesName(kind) && !name) throw new Error('An element needs a name.');
        const element = decorate({
            id: freshId(slugFor(name), takenIds(next)),
            kind: kind,
            name: name,
            hasNote: src.hasNote !== false,
            requests: kind === 'prayer' ? src.requests : null,
            noticeDays: src.noticeDays,
            prayedByOther: src.prayedByOther,
            message: src.message,
            response: src.response,
        });
        if (!order.elements) order.elements = [];
        const at = typeof index === 'number' && index >= 0 && index <= order.elements.length
            ? index : order.elements.length;
        order.elements.splice(at, 0, element);
        next.elements.push(copyElement(element));
        syncPool(next);
        return { catalog: next, element: copyElement(element) };
    }

    // Older call: a primitive plus a name. It becomes a kind, held in the
    // collection until an order takes it.
    function addElement(catalog, fields) {
        const src = fields || {};
        const kind = kindOf(src);
        const name = cleanName(src.name);
        if (!name) throw new Error('An element needs a name.');
        if (!kind) throw new Error('Choose hymn, scripture, prayer, person, or other.');
        const next = cloneCatalog(catalog);
        const element = decorate({
            id: freshId(slugFor(name), takenIds(next)),
            kind: kind,
            name: name,
            hasNote: src.hasNote !== false,
            requests: kind === 'prayer' ? src.requests : null,
            noticeDays: src.noticeDays,
            prayedByOther: src.prayedByOther,
            message: src.message,
            response: src.response,
        });
        next.elements.push(element);
        return { catalog: next, element: copyElement(element) };
    }

    function updateElement(catalog, id, patch) {
        const next = cloneCatalog(catalog);
        const src = patch || {};
        const apply = function (el) {
            if (src.name !== undefined && kindTakesName(el.kind)) {
                const name = cleanName(src.name);
                if (!name) throw new Error('An element needs a name.');
                el.name = name;
            }
            if (src.hasNote !== undefined) el.hasNote = src.hasNote === true;
            if (el.kind === 'prayer' && src.requests !== undefined) {
                el.requests = src.requests ? normaliseRequests('prayer', src.requests) : null;
                if (!el.requests) el.noticeDays = null;
                else if (el.noticeDays == null) el.noticeDays = DEFAULT_NOTICE_LIST.slice();
            }
            if (el.kind === 'prayer' && src.noticeDays !== undefined) {
                el.noticeDays = el.requests ? normaliseNoticeDays(src.noticeDays) : null;
            }
            if (el.kind === 'prayer' && src.prayedByOther !== undefined) {
                el.prayedByOther = src.prayedByOther === true;
            }
            if (el.kind === 'prayer' && src.message !== undefined) el.message = proseOf(src.message);
            if (el.kind === 'prayer' && src.response !== undefined) el.response = proseOf(src.response);
            el.primitive = primitiveOf(el);
        };
        let found = false;
        next.elements.forEach(function (el) {
            if (el.id !== id) return;
            found = true;
            apply(el);
        });
        next.orders.forEach(function (order) {
            (order.elements || []).forEach(function (el) {
                if (el.id !== id) return;
                found = true;
                apply(el);
            });
        });
        if (!found) throw new Error('That element is gone.');
        return next;
    }

    function deleteElement(catalog, id) {
        const next = cloneCatalog(catalog);
        next.elements = next.elements.filter(function (e) { return e.id !== id; });
        next.orders.forEach(function (order) {
            order.elements = (order.elements || []).filter(function (el) { return el.id !== id; });
            order.elementIds = order.elements.map(function (el) { return el.id; });
        });
        return next;
    }

    function addOrder(catalog, fields) {
        const next = cloneCatalog(catalog);
        const src = fields || {};
        const name = cleanName(src.name);
        if (!name) throw new Error('An order needs a name.');
        const taken = new Set(next.orders.map(function (o) { return o.id; }));
        let elements = [];
        if (src.copyFrom) {
            const from = next.orders.find(function (o) { return o.id === src.copyFrom; });
            if (from) elements = (from.elements || []).map(copyElement);
        }
        const order = {
            id: freshId(slugFor(name), taken),
            name: name,
            elements: elements,
            elementIds: elements.map(function (el) { return el.id; }),
        };
        next.orders.push(order);
        syncPool(next);
        return { catalog: next, order: copyOrder(order) };
    }

    function renameOrder(catalog, id, name) {
        const next = cloneCatalog(catalog);
        const order = next.orders.find(function (o) { return o.id === id; });
        if (!order) throw new Error('That order is gone.');
        const clean = cleanName(name);
        if (!clean) throw new Error('An order needs a name.');
        order.name = clean;
        return next;
    }

    function deleteOrder(catalog, id) {
        if (id === STANDARD_ORDER_ID) throw new Error('Standard is the default order and stays.');
        const next = cloneCatalog(catalog);
        next.orders = next.orders.filter(function (o) { return o.id !== id; });
        return next;
    }

    function addToOrder(catalog, orderId, elementId, index) {
        const next = cloneCatalog(catalog);
        const order = next.orders.find(function (o) { return o.id === orderId; });
        if (!order) throw new Error('That order is gone.');
        const element = elementById(next, elementId);
        if (!element) throw new Error('That element is gone.');
        if (!order.elements) order.elements = [];
        if (order.elements.some(function (el) { return el.id === elementId; })) {
            order.elementIds = order.elements.map(function (el) { return el.id; });
            return next;
        }
        const at = typeof index === 'number' && index >= 0 && index <= order.elements.length
            ? index : order.elements.length;
        order.elements.splice(at, 0, copyElement(element));
        order.elementIds = order.elements.map(function (el) { return el.id; });
        return next;
    }

    function removeFromOrder(catalog, orderId, elementId) {
        const next = cloneCatalog(catalog);
        const order = next.orders.find(function (o) { return o.id === orderId; });
        if (!order) throw new Error('That order is gone.');
        order.elements = (order.elements || []).filter(function (el) { return el.id !== elementId; });
        order.elementIds = order.elements.map(function (el) { return el.id; });
        const still = next.orders.some(function (o) {
            return (o.elements || []).some(function (el) { return el.id === elementId; });
        });
        if (!still) next.elements = next.elements.filter(function (el) { return el.id !== elementId; });
        return next;
    }

    function moveInOrder(catalog, orderId, from, to) {
        const next = cloneCatalog(catalog);
        const order = next.orders.find(function (o) { return o.id === orderId; });
        if (!order) throw new Error('That order is gone.');
        const elements = order.elements || [];
        if (from < 0 || from >= elements.length) return next;
        const target = Math.max(0, Math.min(elements.length - 1, to));
        if (target === from) return next;
        const moved = elements.splice(from, 1)[0];
        elements.splice(target, 0, moved);
        order.elementIds = elements.map(function (el) { return el.id; });
        return next;
    }

    function validateCatalog(catalog) {
        const problems = [];
        const src = catalog || {};
        const ids = new Set();
        if (!(src.elements || []).length) problems.push('Keep at least one element.');
        (src.elements || []).forEach(function (el) {
            if (!el || !el.id) { problems.push('An element has no id.'); return; }
            if (ids.has(el.id)) problems.push('Two elements share the id "' + el.id + '".');
            ids.add(el.id);
            if (!cleanName(el.name)) problems.push('An element has no name.');
            if (!isKind(el.kind) && !kindOf(el)) problems.push('"' + (el.name || el.id) + '" is not one of the elements.');
        });
        const orderIds = new Set();
        (src.orders || []).forEach(function (order) {
            if (!order || !order.id) { problems.push('An order has no id.'); return; }
            if (orderIds.has(order.id)) problems.push('Two orders share the id "' + order.id + '".');
            orderIds.add(order.id);
            if (!cleanName(order.name)) problems.push('An order has no name.');
            const seen = new Set();
            const list = (order.elements || []).map(function (el) { return el.id; });
            (order.elementIds || []).forEach(function (id) {
                if (list.indexOf(id) === -1) list.push(id);
            });
            list.forEach(function (id) {
                if (seen.has(id)) problems.push('"' + order.name + '" lists an element twice.');
                seen.add(id);
                if (!ids.has(id)) problems.push('"' + order.name + '" lists an element that is gone.');
            });
        });
        if (!orderIds.has(STANDARD_ORDER_ID)) problems.push('The Standard order is missing.');
        return problems;
    }

    // Where the older prayer fields are drawn on a locked order. A missing
    // id means the page draws that field once, after the list.
    function legacyPrayerHomes(order, prayerLabel) {
        const elements = (order && order.elements) || [];
        const label = (cleanName(prayerLabel) || LEGACY_PRAYER_NAME).toLowerCase();
        const named = elements.find(function (el) {
            return cleanName(el.name).toLowerCase() === label;
        });
        const praise = elements.find(function (el) { return el.id === LEGACY_PRAISE_ID; });
        const confession = elements.find(function (el) { return el.id === LEGACY_CONFESSION_ID; });
        return {
            pastoralId: named ? named.id : null,
            praiseId: praise ? praise.id : null,
            confessionId: confession ? confession.id : null,
        };
    }

    const LiturgyOrderCore = {
        KINDS: KINDS,
        KIND_LABELS: KIND_LABELS,
        REQUEST_WHO: REQUEST_WHO,
        REQUEST_PEOPLE_MAX: REQUEST_PEOPLE_MAX,
        DEFAULT_NOTICE_DAYS: DEFAULT_NOTICE_DAYS,
        DEFAULT_NOTICE_LIST: DEFAULT_NOTICE_LIST,
        NOTICE_DAYS_MAX: NOTICE_DAYS_MAX,
        LEGACY_PRAISE_ID: LEGACY_PRAISE_ID,
        LEGACY_CONFESSION_ID: LEGACY_CONFESSION_ID,
        LEGACY_PRAYER_NAME: LEGACY_PRAYER_NAME,
        PRIMITIVES: Object.freeze(['song', 'scripture', 'text', 'people']),
        PRIMITIVE_LABELS: Object.freeze({
            song: 'Hymn',
            scripture: 'Scripture',
            text: 'Other',
            people: 'Person Event',
        }),
        STANDARD_ORDER_ID: STANDARD_ORDER_ID,
        STANDARD_ELEMENTS: STANDARD_ELEMENTS,
        STANDARD_ORDER: STANDARD_ORDER,
        COLLECTIONS: COLLECTIONS,
        RESERVED_IDS: RESERVED_IDS,
        isKind: isKind,
        kindTakesName: kindTakesName,
        isPrimitive: function (value) { return !!KIND_FROM_PRIMITIVE[value]; },
        normaliseElement: normaliseElement,
        normaliseOrder: normaliseOrder,
        standardCatalog: standardCatalog,
        catalogFrom: catalogFrom,
        elementById: elementById,
        orderById: orderById,
        orderIdOf: orderIdOf,
        orderFor: orderFor,
        elementsOf: elementsOf,
        elementsFor: elementsFor,
        songIdsOf: songIdsOf,
        allSongIds: allSongIds,
        toggledOrders: toggledOrders,
        tableColumns: tableColumns,
        defaultToggles: defaultToggles,
        readToggles: readToggles,
        valueOf: valueOf,
        carrierOf: carrierOf,
        displayValue: displayValue,
        emptyValue: emptyValue,
        slugFor: slugFor,
        placeKind: placeKind,
        addElement: addElement,
        updateElement: updateElement,
        deleteElement: deleteElement,
        addOrder: addOrder,
        renameOrder: renameOrder,
        deleteOrder: deleteOrder,
        addToOrder: addToOrder,
        removeFromOrder: removeFromOrder,
        moveInOrder: moveInOrder,
        validateCatalog: validateCatalog,
        legacyPrayerHomes: legacyPrayerHomes,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LiturgyOrderCore;
    } else {
        global.LiturgyOrderCore = LiturgyOrderCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
