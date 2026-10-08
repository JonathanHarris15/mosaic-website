// Liturgy Order Store — reads and writes the congregation's Liturgy Elements
// and Liturgy Orders (`liturgy_elements`, `liturgy_orders`; ADR-0080).
//
// Public read, editor write, the same as `guide_templates`. An empty
// collection reads as the Standard seed (LiturgyOrderCore.catalogFrom), so the
// pages work before anybody has opened the management page. The management
// page saves the whole draft: every element and order is written, and the
// ones the draft no longer holds are deleted. Nothing here writes a Sunday.
//
// `planSave` is pure and is the test surface; `load` and `save` take an
// injected Firestore so they never run under Node.
(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined') ? require('./liturgy-order-core.js') : global.LiturgyOrderCore;

    function elementDoc(el) {
        return { id: el.id, name: el.name, primitive: el.primitive, hasRole: !!el.hasRole, hasNote: !!el.hasNote };
    }

    function orderDoc(order) {
        return { id: order.id, name: order.name, elementIds: order.elementIds.slice() };
    }

    // What a save writes and deletes, given the ids already stored.
    function planSave(catalog, stored) {
        const before = stored || {};
        const elementIds = new Set(catalog.elements.map(function (el) { return el.id; }));
        const orderIds = new Set(catalog.orders.map(function (o) { return o.id; }));
        return {
            setElements: catalog.elements.map(elementDoc),
            setOrders: catalog.orders.map(orderDoc),
            deleteElements: (before.elementIds || []).filter(function (id) { return !elementIds.has(id); }),
            deleteOrders: (before.orderIds || []).filter(function (id) { return !orderIds.has(id); }),
        };
    }

    async function load(db) {
        const [els, ords] = await Promise.all([
            db.collection(Core.COLLECTIONS.elements).get(),
            db.collection(Core.COLLECTIONS.orders).get(),
        ]);
        const rows = function (snap) {
            return snap.docs.map(function (d) { return Object.assign({}, d.data(), { id: d.id }); });
        };
        const elements = rows(els);
        const orders = rows(ords);
        return {
            catalog: Core.catalogFrom({ elements: elements, orders: orders }),
            stored: {
                elementIds: elements.map(function (e) { return e.id; }),
                orderIds: orders.map(function (o) { return o.id; }),
            },
        };
    }

    // The catalog alone, falling back to the seed when the read fails, for
    // pages that only need to know which elements a Sunday shows.
    async function loadCatalog(db) {
        try {
            return (await load(db)).catalog;
        } catch (err) {
            console.warn('Liturgy orders could not be read; using Standard.', err);
            return Core.standardCatalog();
        }
    }

    async function save(db, catalog, stored) {
        const problems = Core.validateCatalog(catalog);
        if (problems.length) throw new Error(problems[0]);
        const plan = planSave(catalog, stored);
        const ts = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue)
            ? { updatedAt: firebase.firestore.FieldValue.serverTimestamp() } : {};
        const batch = db.batch();
        const els = db.collection(Core.COLLECTIONS.elements);
        const ords = db.collection(Core.COLLECTIONS.orders);
        plan.setElements.forEach(function (doc) { batch.set(els.doc(doc.id), Object.assign({}, doc, ts)); });
        plan.setOrders.forEach(function (doc) { batch.set(ords.doc(doc.id), Object.assign({}, doc, ts)); });
        plan.deleteElements.forEach(function (id) { batch.delete(els.doc(id)); });
        plan.deleteOrders.forEach(function (id) { batch.delete(ords.doc(id)); });
        await batch.commit();
        return {
            elementIds: plan.setElements.map(function (d) { return d.id; }),
            orderIds: plan.setOrders.map(function (d) { return d.id; }),
        };
    }

    const LiturgyOrderStore = { planSave: planSave, load: load, loadCatalog: loadCatalog, save: save };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LiturgyOrderStore;
    } else {
        global.LiturgyOrderStore = LiturgyOrderStore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
