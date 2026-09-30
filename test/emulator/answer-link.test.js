const {describe, test, before, beforeEach} = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const H = require("./harness.js");
const al = require("../../functions/answer-link.js");
const door = require("../../functions/answer-link-door.js");
const writes = require("../../functions/prayer-request-writes.js");
const pr = require("../../functions/prayer-request.js");

// The Answer link door against real Firestore (MS-513). Decisions are
// pinned in answer-link.test.js and prayer-request.test.js; this proves
// the writes land together: request + one note, rate-limit counters,
// hashed ids with no raw token.

const SERVICE = "2026-06-28";
const NOW = new Date("2026-06-24T15:00:00.000Z");
const JANE = "person-jane";
const JOHN = "person-john";

const suite = H.skipReason
  ? (name) => test(name, {skip: H.skipReason}, () => {})
  : describe;

function liturgy(maleId, femaleId) {
  return {
    prayerMale: {id: maleId || null, name: "Jane"},
    prayerFemale: {id: femaleId || null, name: "John"},
  };
}

async function seedService(db, date, maleId, femaleId) {
  await db.collection("services").doc(date).set({
    liturgy: liturgy(maleId, femaleId),
  });
}

async function seedPeople(db) {
  await Promise.all([
    H.seedPerson(db, JANE, {name: "Jane Doe"}),
    H.seedPerson(db, JOHN, {name: "John Smith"}),
  ]);
}

async function mintFor(db, personId, thing, now) {
  return door.mintAnswerLink(db, {
    purpose: "prayer_request",
    personId,
    thing,
    now: now || NOW,
    randomBytes: crypto.randomBytes(16),
  });
}

const handle = (db, over) => door.handleAnswerLink(db, Object.assign({
  now: NOW,
  callerAddress: "203.0.113.7",
}, over));

suite("the Answer link door", () => {
  let db;

  before(() => {
    db = H.connect();
  });

  beforeEach(async () => {
    await H.wipe();
    await seedPeople(db);
    await seedService(db, SERVICE, JANE, JOHN);
  });

  test("a page answer fills the request and creates exactly one note",
      async () => {
        const minted = await mintFor(db, JANE, SERVICE);
        const result = await handle(db, {
          op: "answer",
          token: minted.token,
          answer: "Please pray for my mother.",
        });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.view.existingAnswer,
            "Please pray for my mother.");

        const req = (await db.collection("people").doc(JANE)
            .collection("prayer_requests").doc(SERVICE).get()).data();
        assert.strictEqual(req.prayerRequest, "Please pray for my mother.");
        assert.strictEqual(req.prayerRequestSource, "form");
        assert.ok(req.noteId);
        assert.strictEqual(req.noteGeneratedText, "Please pray for my mother.");
        assert.ok(req.changedAt);

        const notes = await db.collection("people").doc(JANE)
            .collection("shepherding_notes").get();
        assert.strictEqual(notes.size, 1);
        assert.strictEqual(notes.docs[0].id, req.noteId);
        assert.strictEqual(notes.docs[0].data().content,
            "Please pray for my mother.");
      });

  test("a change refreshes an untouched note and leaves an Elder-edited one",
      async () => {
        const minted = await mintFor(db, JANE, SERVICE);
        await handle(db, {
          op: "answer", token: minted.token, answer: "First wording.",
        });
        const req = (await db.collection("people").doc(JANE)
            .collection("prayer_requests").doc(SERVICE).get()).data();
        const noteRef = db.collection("people").doc(JANE)
            .collection("shepherding_notes").doc(req.noteId);

        await handle(db, {
          op: "answer", token: minted.token, answer: "Updated wording.",
        });
        assert.strictEqual((await noteRef.get()).data().content,
            "Updated wording.");

        await noteRef.update({content: "An elder reworded this."});
        await handle(db, {
          op: "answer", token: minted.token, answer: "Subject tries again.",
        });
        assert.strictEqual((await noteRef.get()).data().content,
            "An elder reworded this.");
        const notes = await db.collection("people").doc(JANE)
            .collection("shepherding_notes").get();
        assert.strictEqual(notes.size, 1);
      });

  test("completing the set via form would send the digest once", async () => {
    await db.collection("people").doc(JOHN)
        .collection("prayer_requests").doc(SERVICE).set({
          prayerRequest: "John's request.",
          prayerRequestSource: "reply",
        });
    const minted = await mintFor(db, JANE, SERVICE);
    await handle(db, {
      op: "answer", token: minted.token, answer: "Jane completes the set.",
    });
    const afterJane = (await db.collection("people").doc(JANE)
        .collection("prayer_requests").doc(SERVICE).get()).data();
    const first = pr.elderDigestDecision({
      subjectStates: [{filled: true}, {filled: true}],
      changedSource: afterJane.prayerRequestSource,
      wasCompleteBefore: false,
    });
    assert.strictEqual(first, true);

    await handle(db, {
      op: "answer", token: minted.token, answer: "Jane changes it.",
    });
    const later = pr.elderDigestDecision({
      subjectStates: [{filled: true}, {filled: true}],
      changedSource: "form",
      wasCompleteBefore: true,
    });
    assert.strictEqual(later, false);
  });

  test("expired, no-longer-subject, and unknown refuse the same way",
      async () => {
        const expired = await mintFor(db, JANE, SERVICE,
            new Date("2026-01-01T12:00:00.000Z"));
        const live = await mintFor(db, JANE, SERVICE);
        await seedService(db, SERVICE, "other", JOHN);

        const unknownTok = al.mintAnswerToken(crypto.randomBytes(16));
        const a = await handle(db, {op: "read", token: unknownTok});
        const b = await handle(db, {op: "read", token: expired.token});
        const c = await handle(db, {op: "read", token: live.token});
        assert.deepStrictEqual(a, door.CLOSED);
        assert.deepStrictEqual(b, door.CLOSED);
        assert.deepStrictEqual(c, door.CLOSED);
        assert.deepStrictEqual(a, b);
        assert.deepStrictEqual(b, c);
      });

  test("the 11th save in an hour on one link is refused", async () => {
    const minted = await mintFor(db, JANE, SERVICE);
    for (let i = 0; i < 10; i++) {
      const r = await handle(db, {
        op: "answer",
        token: minted.token,
        answer: "Save " + i,
      });
      assert.strictEqual(r.ok, true, "save " + i);
    }
    const eleventh = await handle(db, {
      op: "answer",
      token: minted.token,
      answer: "One too many",
    });
    assert.strictEqual(eleventh.ok, false);
    assert.strictEqual(eleventh.code, "rate-limited");
    const req = (await db.collection("people").doc(JANE)
        .collection("prayer_requests").doc(SERVICE).get()).data();
    assert.strictEqual(req.prayerRequest, "Save 9");
  });

  test("minting stores the hash and never the raw token", async () => {
    const minted = await mintFor(db, JANE, SERVICE);
    const snap = await db.collection(door.LINKS).doc(minted.id).get();
    assert.ok(snap.exists);
    const data = snap.data();
    assert.strictEqual(data.personId, JANE);
    assert.strictEqual(data.thing, SERVICE);
    const json = JSON.stringify(data);
    assert.ok(!json.includes(minted.token));
    assert.ok(minted.url.includes("/a/" + minted.token));
    assert.strictEqual(minted.id, al.tokenDocumentId(minted.token));
  });

  test("a texted reply records noteId and noteGeneratedText", async () => {
    const result = await writes.applyReply(db, {
      personId: JANE,
      serviceDate: SERVICE,
      replyText: "From the phone.",
      now: NOW,
    });
    assert.strictEqual(result.filled, true);
    const req = (await db.collection("people").doc(JANE)
        .collection("prayer_requests").doc(SERVICE).get()).data();
    assert.strictEqual(req.prayerRequestSource, "reply");
    assert.strictEqual(req.noteId, result.noteId);
    assert.strictEqual(req.noteGeneratedText, "From the phone.");
  });

  test("a signed-in Linked User reads their own open item with no token",
      async () => {
        const result = await handle(db, {
          op: "read",
          personId: JANE,
        });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.items.length, 1);
        assert.strictEqual(result.items[0].thing, SERVICE);
        assert.strictEqual(result.items[0].view.firstName, "Jane");
      });
});
