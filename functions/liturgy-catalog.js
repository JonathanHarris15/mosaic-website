/**
 * The congregation's Liturgy Elements and Liturgy Orders, read server-side
 * (ADR-0080).
 *
 * The same two collections the pages read through
 * public/liturgy-order-store.js. An empty collection reads as the Standard
 * seed (catalogFrom), so a Sunday reads correctly before anybody has opened
 * the management page.
 *
 * ⚠ A FAILED READ THROWS rather than falling back to Standard. The browser
 * falls back because a page should still draw; an assistant reading a Sunday
 * to plan a write is better told the read failed than handed the Sunday in
 * an order it does not follow.
 */

const Liturgy = require("./shared/liturgy-order-core.js");

/**
 * Every element and order the congregation has saved, normalised.
 *
 * @param {object} db the Firestore handle
 * @return {Promise<object>} {elements, orders}
 */
async function loadLiturgyCatalog(db) {
  const [elements, orders] = await Promise.all([
    db.collection(Liturgy.COLLECTIONS.elements).get(),
    db.collection(Liturgy.COLLECTIONS.orders).get(),
  ]);
  const rows = (snap) =>
    snap.docs.map((d) => Object.assign({}, d.data(), {id: d.id}));
  return Liturgy.catalogFrom({elements: rows(elements), orders: rows(orders)});
}

module.exports = {loadLiturgyCatalog};
