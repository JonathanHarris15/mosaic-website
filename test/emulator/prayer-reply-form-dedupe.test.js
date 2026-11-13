// @ts-nocheck
const {describe, test, before, beforeEach} = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const H = require("./harness.js");
const door = require("../../functions/answer-link-door.js");
const writes = require("../../functions/prayer-request-writes.js");

const SERVICE = "2026-06-28";
const NOW = new Date("2026-06-24T15:00:00.000Z");
const JANE = "person-jane";
const suite = H.skipReason ?
  (n) => test(n, {skip: H.skipReason}, () => {}) : describe;

suite("prayer reply/form newest wins", () => {
  let db;
  before(() => { db = H.connect(); });
  beforeEach(async () => {
    await H.wipe();
    await H.seedPerson(db, JANE, {name: "Jane Doe"});
    await db.collection("liturgy_orders").doc("standard").set({
      id: "standard",
      name: "Standard",
      elements: [{
        id: "pastoral",
        name: "Pastoral Prayer",
        kind: "prayer",
        requests: {count: 1, who: "either"},
      }],
    });
    await db.collection("services").doc(SERVICE).set({
      liturgyOrderId: "standard",
      liturgy: {pastoral: [{id: JANE, name: "Jane"}]},
    });
  });

  test("reply then form keeps one note and the form wins", async () => {
    await writes.applyReply(db, {
      personId: JANE, serviceDate: SERVICE, replyText: "SMS", now: NOW,
    });
    const m = await door.mintAnswerLink(db, {
      purpose: "prayer_request", personId: JANE, thing: SERVICE,
      now: NOW, randomBytes: crypto.randomBytes(16),
    });
    const r = await door.handleAnswerLink(db, {
      op: "answer", token: m.token, answer: "link", now: NOW,
      callerAddress: "203.0.113.7",
    });
    assert.strictEqual(r.ok, true);
    const req = (await db.collection("people").doc(JANE)
        .collection("prayer_requests").doc(SERVICE).get()).data();
    assert.strictEqual(req.prayerRequest, "link");
    assert.strictEqual(req.prayerRequestSource, "form");
    const notes = await db.collection("people").doc(JANE)
        .collection("shepherding_notes").get();
    assert.strictEqual(notes.size, 1);
    assert.strictEqual(notes.docs[0].data().content, "link");
  });

  test("form then reply keeps one note and the reply wins", async () => {
    const m = await door.mintAnswerLink(db, {
      purpose: "prayer_request", personId: JANE, thing: SERVICE,
      now: NOW, randomBytes: crypto.randomBytes(16),
    });
    await door.handleAnswerLink(db, {
      op: "answer", token: m.token, answer: "link", now: NOW,
      callerAddress: "203.0.113.7",
    });
    const reply = await writes.applyReply(db, {
      personId: JANE, serviceDate: SERVICE, replyText: "SMS", now: NOW,
    });
    assert.strictEqual(reply.filled, true);
    assert.strictEqual(reply.replaced, true);
    const req = (await db.collection("people").doc(JANE)
        .collection("prayer_requests").doc(SERVICE).get()).data();
    assert.strictEqual(req.prayerRequest, "SMS");
    assert.strictEqual(req.prayerRequestSource, "reply");
    const notes = await db.collection("people").doc(JANE)
        .collection("shepherding_notes").get();
    assert.strictEqual(notes.size, 1);
    assert.strictEqual(notes.docs[0].data().content, "SMS");
  });
});
