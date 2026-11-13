// Plan inlining liturgy_elements onto liturgy_orders (MS-780).
(function (global) {
    'use strict';

    const Liturgy = (typeof require !== 'undefined' &&
            typeof module !== 'undefined' && module.exports) ?
        require('./liturgy-order-core.js') :
        (global && global.LiturgyOrderCore);

    /**
     * @param {object} orderData Firestore order document (with id)
     * @param {Map<string, object>} looseById normalised loose elements
     * @return {{ kind: 'ok', write: boolean, update?: object, blocked?: false }
     *   | { kind: 'blocked', orderId: string, missingIds: string[] }}
     */
    function planOrderInline(orderData, looseById) {
        const order = orderData || {};
        const orderId = String(order.id || '').trim();
        const hasElements = Array.isArray(order.elements) && order.elements.length > 0;
        if (hasElements) {
            return { kind: 'ok', write: false };
        }
        const ids = Array.isArray(order.elementIds) ? order.elementIds : [];
        if (!ids.length) {
            return { kind: 'ok', write: false };
        }
        const elements = [];
        const missingIds = [];
        ids.forEach(function (rawId) {
            const id = String(rawId || '').trim();
            if (!id) return;
            const loose = looseById.get(id);
            if (!loose) {
                missingIds.push(id);
                return;
            }
            elements.push(loose);
        });
        if (missingIds.length) {
            return { kind: 'blocked', orderId: orderId || '(unknown)', missingIds };
        }
        const normalised = elements
            .map(function (el) { return Liturgy.normaliseElement(el, el.id); })
            .filter(Boolean);
        const stored = normalised.map(function (el) {
            const doc = {
                id: el.id,
                kind: el.kind,
                name: el.name,
                hasNote: el.hasNote !== false,
            };
            if (el.kind === 'prayer' && el.requests) {
                doc.requests = el.requests;
                doc.noticeDays = Array.isArray(el.noticeDays) ? el.noticeDays.slice() : [];
                doc.elderDigest = el.elderDigest !== false;
            }
            if (el.kind === 'prayer' && el.message) doc.message = el.message;
            if (el.kind === 'prayer' && el.response) doc.response = el.response;
            if (el.kind === 'prayer' && el.prayedByOther) doc.prayedByOther = true;
            return doc;
        });
        const update = {
            elements: stored,
            elementIds: stored.map(function (el) { return el.id; }),
        };
        return { kind: 'ok', write: true, update };
    }

    /**
     * @param {object[]} orderDocs
     * @param {object[]} looseDocs
     * @return {{ orderWrites: Array<{id: string, update: object}>, deleteLooseIds: string[], blocked: object[] }}
     */
    function planCatalogInline(orderDocs, looseDocs) {
        const looseById = new Map();
        (looseDocs || []).forEach(function (raw) {
            const el = Liturgy.normaliseElement(Object.assign({}, raw, { id: raw.id }));
            if (el) looseById.set(el.id, el);
        });
        const orderWrites = [];
        const blocked = [];
        (orderDocs || []).forEach(function (raw) {
            const plan = planOrderInline(raw, looseById);
            if (plan.kind === 'blocked') {
                blocked.push(plan);
                return;
            }
            if (plan.write && plan.update) {
                orderWrites.push({ id: raw.id, update: plan.update });
            }
        });
        const deleteLooseIds = (looseDocs || []).map(function (d) { return d.id; });
        return { orderWrites, deleteLooseIds, blocked };
    }

    const MigrateInlineLiturgyElementsCore = { planOrderInline, planCatalogInline };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = MigrateInlineLiturgyElementsCore;
    } else {
        global.MigrateInlineLiturgyElementsCore = MigrateInlineLiturgyElementsCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
