// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/liturgy-order-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Liturgy Order Core — the congregation's Liturgy Elements and the Liturgy
// Orders made of them (ADR-0080).
//
// A Liturgy Element is one slot a Sunday can carry: a stable id, a name, and
// a primitive (song, scripture, text, people). A Liturgy Order is a named,
// ordered list of element ids. A Sunday names its order with `liturgyOrderId`
// and keeps its values where they always were — `liturgy.<elementId>` and
// `notes[elementId]` — so changing the order hides values, never deletes them.
//
// The Standard order below is DATA, not a special case. It is what an empty
// collection reads as, and nothing downstream checks for its ids; another
// church adds an element by saving one, with no code change.
//
// Pure. Loaded as a classic <script> (window.LiturgyOrderCore) on the pages,
// required under node:test, and copied into functions/shared by
// scripts/sync-shared-to-functions.js for the MCP read.
(function (global) {
    'use strict';

    const PRIMITIVES = Object.freeze(['song', 'scripture', 'text', 'people']);

    const PRIMITIVE_LABELS = Object.freeze({
        song: 'Song',
        scripture: 'Scripture',
        text: 'Text',
        people: 'People',
    });

    const STANDARD_ORDER_ID = 'standard';

    const COLLECTIONS = Object.freeze({
        elements: 'liturgy_elements',
        orders: 'liturgy_orders',
    });

    // A new element's id becomes a key under `liturgy`, `notes`, and
    // `carriedBy` on every Sunday, and a printable field name. These names are
    // already spoken for on the Sunday or in the printable catalog.
    const RESERVED_IDS = Object.freeze([
        'prayerMale', 'prayerFemale', 'prayerLabel',
        'date', 'theme', 'keyVerse', 'keyVerseText',
        'preacher', 'serviceLeader', 'musicLeader', 'musicHelpers',
        'prayerPraise', 'prayerConfession', 'hasBaptism', 'removedHymns',
        'notes', 'liturgy', 'carriedBy', 'liturgyOrderId', 'decidedBy',
        'isIrregular', 'irregularElements', 'elements', 'other', 'guide',
        'constructor', 'prototype', '__proto__', 'toString', 'hasOwnProperty',
    ]);

    function seedElement(id, name, primitive) {
        return Object.freeze({ id: id, name: name, primitive: primitive, hasRole: false, hasNote: true });
    }

    const STANDARD_ELEMENTS = Object.freeze([
        seedElement('preparatoryHymn', 'Preparatory Hymn', 'song'),
        seedElement('callToWorship', 'Call to Worship', 'scripture'),
        seedElement('hymn1', 'Hymn 1', 'song'),
        seedElement('hymn2', 'Hymn 2', 'song'),
        seedElement('callToConfession', 'Call to Confession', 'scripture'),
        seedElement('assuranceOfPardon', 'Assurance of Pardon', 'scripture'),
        seedElement('hymnMid1', 'Hymn 3', 'song'),
        seedElement('hymnMid2', 'Hymn 4', 'song'),
        seedElement('scriptureReading', 'Pastoral Prayer', 'scripture'),
        seedElement('sermon', 'Sermon', 'scripture'),
        seedElement('baptism', 'Baptism', 'people'),
        seedElement('hymnEnd1', 'Closing Hymn', 'song'),
        seedElement('hymnEnd2', 'Final Hymn', 'song'),
        seedElement('benediction', 'Benediction', 'scripture'),
    ]);

    const STANDARD_ORDER = Object.freeze({
        id: STANDARD_ORDER_ID,
        name: 'Standard',
        elementIds: Object.freeze(STANDARD_ELEMENTS.map(function (el) { return el.id; })),
    });

    // ── shape ──────────────────────────────────────────────────────────────

    function isPrimitive(value) {
        return PRIMITIVES.indexOf(value) !== -1;
    }

    function cleanName(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    // A stored element, or null when it cannot be one (no id, unknown primitive).
    function normaliseElement(raw, fallbackId) {
        const src = raw || {};
        const id = cleanName(src.id != null ? src.id : fallbackId);
        if (!id || !isPrimitive(src.primitive)) return null;
        return {
            id: id,
            name: cleanName(src.name) || id,
            primitive: src.primitive,
            hasRole: src.hasRole === true,
            hasNote: src.hasNote !== false,
        };
    }

    // A stored order. An element appears at most once; the first stays.
    function normaliseOrder(raw, fallbackId) {
        const src = raw || {};
        const id = cleanName(src.id != null ? src.id : fallbackId);
        if (!id) return null;
        const seen = new Set();
        const elementIds = [];
        (Array.isArray(src.elementIds) ? src.elementIds : []).forEach(function (value) {
            const elId = cleanName(value);
            if (!elId || seen.has(elId)) return;
            seen.add(elId);
            elementIds.push(elId);
        });
        return { id: id, name: cleanName(src.name) || id, elementIds: elementIds };
    }

    function copyElement(el) {
        return { id: el.id, name: el.name, primitive: el.primitive, hasRole: el.hasRole, hasNote: el.hasNote };
    }

    function copyOrder(order) {
        return { id: order.id, name: order.name, elementIds: order.elementIds.slice() };
    }

    function standardCatalog() {
        return {
            elements: STANDARD_ELEMENTS.map(copyElement),
            orders: [copyOrder(STANDARD_ORDER)],
        };
    }

    // What the pages read. Each collection that is empty reads as the seed,
    // so a congregation that has never opened the management page still has
    // Standard. The Standard order is always present: it is what a Sunday with
    // no `liturgyOrderId` means.
    function catalogFrom(input) {
        const src = input || {};
        const rawElements = Array.isArray(src.elements) ? src.elements : [];
        const rawOrders = Array.isArray(src.orders) ? src.orders : [];

        const elements = [];
        const seenEl = new Set();
        rawElements.forEach(function (raw) {
            const el = normaliseElement(raw);
            if (!el || seenEl.has(el.id)) return;
            seenEl.add(el.id);
            elements.push(el);
        });

        const orders = [];
        const seenOrder = new Set();
        rawOrders.forEach(function (raw) {
            const order = normaliseOrder(raw);
            if (!order || seenOrder.has(order.id)) return;
            seenOrder.add(order.id);
            orders.push(order);
        });

        const seed = standardCatalog();
        const out = {
            elements: elements.length ? elements : seed.elements,
            orders: orders.length ? orders : seed.orders,
        };
        if (!out.orders.some(function (o) { return o.id === STANDARD_ORDER_ID; })) {
            out.orders.unshift(copyOrder(STANDARD_ORDER));
        }
        return out;
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

    // The order a Sunday follows. A missing id means Standard; an id whose
    // order has since been deleted also reads as Standard rather than as an
    // empty Sunday.
    function orderFor(service, catalog) {
        return orderById(catalog, orderIdOf(service)) ||
            orderById(catalog, STANDARD_ORDER_ID) ||
            STANDARD_ORDER;
    }

    // An order's elements, in its order. An id with no element (deleted, or
    // a stale write) is skipped rather than shown as a blank slot.
    function elementsOf(order, catalog) {
        const ids = (order && order.elementIds) || [];
        const out = [];
        ids.forEach(function (id) {
            const el = elementById(catalog, id);
            if (el) out.push(el);
        });
        return out;
    }

    function elementsFor(service, catalog) {
        return elementsOf(orderFor(service, catalog), catalog);
    }

    function songIdsOf(order, catalog) {
        return elementsOf(order, catalog)
            .filter(function (el) { return el.primitive === 'song'; })
            .map(function (el) { return el.id; });
    }

    // Every song element the congregation has, in catalog order — what a
    // reader that does not know the Sunday's order yet must be ready for.
    function allSongIds(catalog) {
        const list = (catalog && catalog.elements) || STANDARD_ELEMENTS;
        return list.filter(function (el) { return el.primitive === 'song'; }).map(function (el) { return el.id; });
    }

    // ── table mode ─────────────────────────────────────────────────────────

    function byName(a, b) {
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        if (an !== bn) return an < bn ? -1 : 1;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    }

    // The toggled orders in column order: Standard first when it is on, then
    // the rest by name. Ids that no longer name an order drop out.
    function toggledOrders(catalog, toggledIds) {
        const wanted = new Set(Array.isArray(toggledIds) ? toggledIds : []);
        const orders = ((catalog && catalog.orders) || []).filter(function (o) { return wanted.has(o.id); });
        const standard = orders.filter(function (o) { return o.id === STANDARD_ORDER_ID; });
        const rest = orders.filter(function (o) { return o.id !== STANDARD_ORDER_ID; }).sort(byName);
        return standard.concat(rest);
    }

    // One column per element across the toggled orders, each element at the
    // first place it is seen. A shared element is the same id, so it is one
    // column however many orders carry it.
    function tableColumns(catalog, toggledIds) {
        const seen = new Set();
        const out = [];
        toggledOrders(catalog, toggledIds).forEach(function (order) {
            elementsOf(order, catalog).forEach(function (el) {
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

    // What the page remembered, minus orders that have since gone. Nothing
    // remembered, or only orders that are gone, is the default: Standard
    // alone. An empty list remembered on purpose stays empty.
    function readToggles(stored, catalog) {
        if (!Array.isArray(stored)) return defaultToggles();
        const ids = new Set(((catalog && catalog.orders) || []).map(function (o) { return o.id; }));
        const kept = stored.filter(function (id) { return typeof id === 'string' && ids.has(id); });
        return kept.length || !stored.length ? kept : defaultToggles();
    }

    // ── values on a Sunday ─────────────────────────────────────────────────

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

    // A value as one line of text, whatever its primitive.
    function displayValue(primitive, value) {
        if (value == null) return '';
        if (primitive === 'song') {
            if (typeof value === 'string') return value.trim();
            return cleanName(value.name);
        }
        if (primitive === 'people') {
            if (typeof value === 'string') return value.trim();
            if (!Array.isArray(value)) return '';
            return value.map(function (p) { return p && cleanName(p.name); }).filter(Boolean).join(', ');
        }
        return typeof value === 'string' ? value.trim() : '';
    }

    function emptyValue(primitive) {
        if (primitive === 'song') return { name: '', id: null };
        if (primitive === 'people') return [];
        return '';
    }

    // ── editing (the management page) ──────────────────────────────────────
    //
    // Every edit returns a NEW catalog. The page holds the draft and saves it
    // whole; nothing here touches a Sunday.

    function cloneCatalog(catalog) {
        const src = catalog || standardCatalog();
        return {
            elements: (src.elements || []).map(copyElement),
            orders: (src.orders || []).map(copyOrder),
        };
    }

    // "Offertory Prayer" → "offertoryPrayer". Stable once made: renaming the
    // element later keeps the id, because Sundays and printables hold it.
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

    function addElement(catalog, fields) {
        const next = cloneCatalog(catalog);
        const src = fields || {};
        const name = cleanName(src.name);
        if (!name) throw new Error('An element needs a name.');
        if (!isPrimitive(src.primitive)) throw new Error('Choose song, scripture, text, or people.');
        const taken = new Set(next.elements.map(function (el) { return el.id; }));
        const element = {
            id: freshId(slugFor(name), taken),
            name: name,
            primitive: src.primitive,
            hasRole: src.hasRole === true,
            hasNote: src.hasNote !== false,
        };
        next.elements.push(element);
        return { catalog: next, element: copyElement(element) };
    }

    // Name, hasRole, and hasNote change in place. The primitive is fixed once
    // made: Sundays already hold values in that primitive's shape.
    function updateElement(catalog, id, patch) {
        const next = cloneCatalog(catalog);
        const el = next.elements.find(function (e) { return e.id === id; });
        if (!el) throw new Error('That element is gone.');
        const src = patch || {};
        if (src.name !== undefined) {
            const name = cleanName(src.name);
            if (!name) throw new Error('An element needs a name.');
            el.name = name;
        }
        if (src.hasRole !== undefined) el.hasRole = src.hasRole === true;
        if (src.hasNote !== undefined) el.hasNote = src.hasNote === true;
        return next;
    }

    // Gone from the catalog and from every order. Sunday values under its id
    // are left exactly where they are.
    function deleteElement(catalog, id) {
        const next = cloneCatalog(catalog);
        next.elements = next.elements.filter(function (e) { return e.id !== id; });
        next.orders.forEach(function (o) {
            o.elementIds = o.elementIds.filter(function (elId) { return elId !== id; });
        });
        return next;
    }

    function addOrder(catalog, fields) {
        const next = cloneCatalog(catalog);
        const src = fields || {};
        const name = cleanName(src.name);
        if (!name) throw new Error('An order needs a name.');
        const taken = new Set(next.orders.map(function (o) { return o.id; }));
        let elementIds = [];
        if (src.copyFrom) {
            const from = next.orders.find(function (o) { return o.id === src.copyFrom; });
            if (from) elementIds = from.elementIds.slice();
        }
        const order = { id: freshId(slugFor(name), taken), name: name, elementIds: elementIds };
        next.orders.push(order);
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

    // Standard cannot go: it is what every Sunday without an order reads as.
    // A Sunday naming a deleted order reads as Standard (orderFor).
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
        if (!next.elements.some(function (e) { return e.id === elementId; })) throw new Error('That element is gone.');
        if (order.elementIds.indexOf(elementId) !== -1) return next;
        const at = typeof index === 'number' && index >= 0 && index <= order.elementIds.length
            ? index : order.elementIds.length;
        order.elementIds.splice(at, 0, elementId);
        return next;
    }

    function removeFromOrder(catalog, orderId, elementId) {
        const next = cloneCatalog(catalog);
        const order = next.orders.find(function (o) { return o.id === orderId; });
        if (!order) throw new Error('That order is gone.');
        order.elementIds = order.elementIds.filter(function (id) { return id !== elementId; });
        return next;
    }

    function moveInOrder(catalog, orderId, from, to) {
        const next = cloneCatalog(catalog);
        const order = next.orders.find(function (o) { return o.id === orderId; });
        if (!order) throw new Error('That order is gone.');
        const ids = order.elementIds;
        if (from < 0 || from >= ids.length) return next;
        const target = Math.max(0, Math.min(ids.length - 1, to));
        if (target === from) return next;
        const moved = ids.splice(from, 1)[0];
        ids.splice(target, 0, moved);
        return next;
    }

    // What would stop a save. Empty means the catalog is sound.
    function validateCatalog(catalog) {
        const problems = [];
        const src = catalog || {};
        const ids = new Set();
        // An empty collection reads as the seed, so saving none would bring
        // the deleted Standard elements back.
        if (!(src.elements || []).length) problems.push('Keep at least one element.');
        (src.elements || []).forEach(function (el) {
            if (!el || !el.id) { problems.push('An element has no id.'); return; }
            if (ids.has(el.id)) problems.push('Two elements share the id "' + el.id + '".');
            ids.add(el.id);
            if (!cleanName(el.name)) problems.push('An element has no name.');
            if (!isPrimitive(el.primitive)) problems.push('"' + (el.name || el.id) + '" has no primitive.');
        });
        const orderIds = new Set();
        (src.orders || []).forEach(function (order) {
            if (!order || !order.id) { problems.push('An order has no id.'); return; }
            if (orderIds.has(order.id)) problems.push('Two orders share the id "' + order.id + '".');
            orderIds.add(order.id);
            if (!cleanName(order.name)) problems.push('An order has no name.');
            const seen = new Set();
            (order.elementIds || []).forEach(function (id) {
                if (seen.has(id)) problems.push('"' + order.name + '" lists an element twice.');
                seen.add(id);
                if (!ids.has(id)) problems.push('"' + order.name + '" lists an element that is gone.');
            });
        });
        if (!orderIds.has(STANDARD_ORDER_ID)) problems.push('The Standard order is missing.');
        return problems;
    }

    const LiturgyOrderCore = {
        PRIMITIVES: PRIMITIVES,
        PRIMITIVE_LABELS: PRIMITIVE_LABELS,
        STANDARD_ORDER_ID: STANDARD_ORDER_ID,
        STANDARD_ELEMENTS: STANDARD_ELEMENTS,
        STANDARD_ORDER: STANDARD_ORDER,
        COLLECTIONS: COLLECTIONS,
        RESERVED_IDS: RESERVED_IDS,
        isPrimitive: isPrimitive,
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
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LiturgyOrderCore;
    } else {
        global.LiturgyOrderCore = LiturgyOrderCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
