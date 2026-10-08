// Liturgy Order Store — reads and writes Liturgy Orders (`liturgy_orders`;
// ADR-0080). Each order holds its elements. The five kinds are code, not a
// second collection. An older `liturgy_elements` collection is still read, so
// a document from before the kinds can be joined, and the next save deletes
// those loose documents once they live on the order.
//
// Public read, editor write, the same as `guide_templates`. An empty
// collection reads as the Standard seed (LiturgyOrderCore.catalogFrom), so the
// pages work before anybody has opened the management page. The management
// page saves the whole draft. Nothing here writes a Sunday.
//
// `planSave` is pure and is the test surface; `load` and `save` take an
// injected Firestore so they never run under Node.
(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined') ? require('./liturgy-order-core.js') : global.LiturgyOrderCore;

    // The element lives on the order. `kind` is one of the five. A prayer's
    // request setup is the only extra field. Nothing here is a primitive.
    function elementDoc(el) {
        const doc = { id: el.id, kind: el.kind, name: el.name, hasNote: !!el.hasNote };
        if (el.kind === 'prayer' && el.requests) doc.requests = { count: el.requests.count, who: el.requests.who };
        return doc;
    }

    function orderDoc(order) {
        const elements = (order.elements || []).map(elementDoc);
        return {
            id: order.id,
            name: order.name,
            elements: elements,
            elementIds: elements.map(function (el) { return el.id; }),
        };
    }

    // What a save writes and deletes, given the ids already stored.
    // Elements are written on the order. Ids previously stored in the
    // separate elements collection are deleted, so that collection does not
    // stay on as a second copy.
    function planSave(catalog, stored) {
        const before = stored || {};
        const orderIds = new Set(catalog.orders.map(function (o) { return o.id; }));
        return {
            setElements: [],
            setOrders: catalog.orders.map(orderDoc),
            deleteElements: (before.elementIds || []).slice(),
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
