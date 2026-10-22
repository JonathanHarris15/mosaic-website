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

suite("prayer reply/form dedupe", () => {
  let db;
  before(() => { db = H.connect(); });
  beforeEach(async () => {
    await H.wipe();
    await H.seedPerson(db, JANE, {name: "Jane Doe"});
    await db.collection("services").doc(SERVICE).set({
      liturgy: {prayerMale: {id: JANE, name: "Jane"}},
    });
  });

  test("reply then form keeps one note", async () => {
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
    assert.strictEqual(req.prayerRequest, "SMS");
    assert.strictEqual((await db.collection("people").doc(JANE)
        .collection("shepherding_notes").get()).size, 1);
  });

  test("form then reply keeps one note", async () => {
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
    assert.strictEqual(reply.filled, false);
    const req = (await db.collection("people").doc(JANE)
        .collection("prayer_requests").doc(SERVICE).get()).data();
    assert.strictEqual(req.prayerRequest, "link");
    assert.strictEqual((await db.collection("people").doc(JANE)
        .collection("shepherding_notes").get()).size, 1);
  });
});
