/**
 * @fileoverview Pure helpers for set-liturgy-order-flags.js (list + name resolve).
 */

/**
 * @param {Array<{id: string, name?: string, ops?: boolean, hidden?: boolean}>} orders
 * @param {string} substring
 * @returns {Array<{id: string, name?: string, ops?: boolean, hidden?: boolean}>}
 */
function ordersMatchingName(orders, substring) {
    const needle = String(substring || '').trim().toLowerCase();
    if (!needle) {
        throw new Error('Missing --name-match value.');
    }
    return orders.filter((order) =>
        String(order.name || '').toLowerCase().includes(needle));
}

/**
 * @param {Array<{id: string, name?: string, ops?: boolean, hidden?: boolean}>} orders
 * @param {string} substring
 * @returns {string}
 */
function resolveOrderIdByNameMatch(orders, substring) {
    const matches = ordersMatchingName(orders, substring);
    if (matches.length === 0) {
        throw new Error(`No liturgy_orders document name contains "${substring}".`);
    }
    if (matches.length > 1) {
        const summary = matches.map((o) => `${o.id} (${o.name || ''})`).join('; ');
        throw new Error(
            `Multiple liturgy orders match "${substring}": ${summary}. Pass --id instead.`);
    }
    return matches[0].id;
}

/**
 * @param {{id: string, name?: string, ops?: boolean, hidden?: boolean}} order
 * @returns {{id: string, name: string, ops: boolean, hidden: boolean}}
 */
function orderListRow(order) {
    return {
        id: order.id,
        name: order.name == null ? '' : String(order.name),
        ops: order.ops === true,
        hidden: order.hidden === true,
    };
}

/**
 * @param {Array<{id: string, name?: string, ops?: boolean, hidden?: boolean}>} orders
 * @returns {string[]}
 */
function formatOrderListLines(orders) {
    const rows = orders.map(orderListRow).sort((a, b) => a.id.localeCompare(b.id));
    const lines = ['id\tname\tops\thidden'];
    for (const row of rows) {
        lines.push(`${row.id}\t${row.name}\t${row.ops}\t${row.hidden}`);
    }
    return lines;
}

module.exports = {
    ordersMatchingName,
    resolveOrderIdByNameMatch,
    orderListRow,
    formatOrderListLines,
};
