const {test} = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const FormsCore = require("../public/forms-core.js");
const al = require("../functions/answer-link.js");

// answer-link.js is the pure Answer link core (MS-510, ADR-0067): mint and shape
// a token, hash it for storage, church-local expiry with a 21-day cap, tell the
// door whether a link record is still usable, and rate-limit saves and unknown
// lookups. No Firebase here — the callable wraps these decisions.

const KNOWN_BYTES = new Uint8Array(16).fill(0xab);

test("mintAnswerToken matches the public form id encoding", () => {
  const token = al.mintAnswerToken(KNOWN_BYTES);
  assert.strictEqual(token, FormsCore.formIdFromBytes(KNOWN_BYTES));
  assert.ok(al.looksLikeAnswerToken(token));
});

test("mintAnswerToken refuses too little randomness", () => {
  assert.throws(() => al.mintAnswerToken(new Uint8Array(4)), /randomness/);
});

test("looksLikeAnswerToken refuses malformed tokens before any read", () => {
  assert.strictEqual(al.looksLikeAnswerToken(""), false);
  assert.strictEqual(al.looksLikeAnswerToken("monday-food"), false);
  assert.strictEqual(al.looksLikeAnswerToken("short"), false);
  assert.strictEqual(al.looksLikeAnswerToken("0OIl"), false);
  assert.strictEqual(al.looksLikeAnswerToken(null), false);
});

test("tokenDocumentId is stable SHA-256 hex and does not embed the token", () => {
  const token = al.mintAnswerToken(KNOWN_BYTES);
  const id = al.tokenDocumentId(token);
  const expected = crypto.createHash("sha256").update(token, "utf8").digest("hex");
  assert.strictEqual(id, expected);
  assert.ok(!id.includes(token.slice(0, 6)));
});

test("expiry is church-local end of the purpose date", () => {
  const mintedAt = new Date("2026-06-10T15:00:00.000Z");
  const expiry = al.linkExpiryAt("2026-06-14", mintedAt);
  const parts = churchParts(expiry);
  assert.strictEqual(parts.date, "2026-06-14");
  assert.strictEqual(parts.hour, 23);
  assert.strictEqual(parts.minute, 59);
  assert.strictEqual(parts.second, 59);
});

test("expiry across spring-forward ends on that church-local calendar day", () => {
  const mintedAt = new Date("2026-03-05T12:00:00.000Z");
  const expiry = al.linkExpiryAt("2026-03-08", mintedAt);
  const parts = churchParts(expiry);
  assert.strictEqual(parts.date, "2026-03-08");
  assert.strictEqual(parts.hour, 23);
});

test("expiry across fall-back ends on that church-local calendar day", () => {
  const mintedAt = new Date("2026-10-28T12:00:00.000Z");
  const expiry = al.linkExpiryAt("2026-11-01", mintedAt);
  const parts = churchParts(expiry);
  assert.strictEqual(parts.date, "2026-11-01");
  assert.strictEqual(parts.hour, 23);
});

test("expiry never lives more than 21 days from minting", () => {
  const mintedAt = new Date("2026-01-01T12:00:00.000Z");
  const farSunday = "2026-03-01";
  const expiry = al.linkExpiryAt(farSunday, mintedAt);
  const cap = new Date(mintedAt.getTime() + al.MAX_LINK_AGE_MS);
  const uncapped = al.churchEndOfDate(farSunday);
  assert.ok(expiry.getTime() <= cap.getTime());
  assert.ok(expiry.getTime() < uncapped.getTime());
});

test("unknown and expired links read the same to the door", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const missing = al.linkUsability(null, now);
  const expired = al.linkUsability({
    expiresAt: new Date("2026-06-01T00:00:00.000Z"),
  }, now);
  assert.deepStrictEqual(missing, expired);
  assert.strictEqual(missing.open, false);
});

test("a link before expiry is open", () => {
  const now = new Date("2026-06-10T12:00:00.000Z");
  const open = al.linkUsability({
    expiresAt: new Date("2026-06-14T23:59:59.999-05:00"),
  }, now);
  assert.strictEqual(open.open, true);
});

test("save rate limit allows the 10th save in a rolling hour and refuses the 11th", () => {
  const now = new Date("2026-06-10T12:00:00.000Z");
  const hourAgo = now.getTime() - 60 * 60 * 1000 + 1000;
  const stamps = [];
  for (let i = 0; i < 9; i++) {
    stamps.push(hourAgo + i * 1000);
  }
  const tenth = al.saveRateDecision({saveTimestamps: stamps}, now);
  assert.strictEqual(tenth.ok, true);
  const afterTen = tenth.saveTimestamps;
  assert.strictEqual(afterTen.length, 10);

  const eleventh = al.saveRateDecision({saveTimestamps: afterTen}, now);
  assert.strictEqual(eleventh.ok, false);
});

test("unknown lookup rate limit allows the 30th probe and refuses the 31st", () => {
  const now = new Date("2026-06-10T12:00:00.000Z");
  const hourAgo = now.getTime() - 60 * 60 * 1000 + 1000;
  const stamps = [];
  for (let i = 0; i < 29; i++) {
    stamps.push(hourAgo + i * 1000);
  }
  const thirtieth = al.unknownLookupRateDecision({lookupTimestamps: stamps}, now);
  assert.strictEqual(thirtieth.ok, true);
  const afterThirty = thirtieth.lookupTimestamps;
  assert.strictEqual(afterThirty.length, 30);

  const thirtyFirst = al.unknownLookupRateDecision(
      {lookupTimestamps: afterThirty}, now);
  assert.strictEqual(thirtyFirst.ok, false);
});

test("rate counters drop stamps older than one rolling hour", () => {
  const now = new Date("2026-06-10T12:00:00.000Z");
  const old = now.getTime() - 2 * 60 * 60 * 1000;
  const recent = now.getTime() - 30 * 60 * 1000;
  const decision = al.saveRateDecision({
    saveTimestamps: [old, recent],
  }, now);
  assert.strictEqual(decision.ok, true);
  assert.deepStrictEqual(decision.saveTimestamps, [recent, now.getTime()]);
});

test("buildAnswerUrl uses the single site origin constant", () => {
  const token = "7bQm2xK9vRt4Lp8sYw3NcF";
  assert.strictEqual(
      al.buildAnswerUrl(token),
      `${al.SITE_ORIGIN}/a/${token}`);
});

test("hashCallerAddress never returns the raw address", () => {
  const hashed = al.hashCallerAddress("203.0.113.7");
  assert.ok(!hashed.includes("203"));
  assert.strictEqual(hashed, al.hashCallerAddress("203.0.113.7"));
});

function churchParts(instant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: al.CHURCH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type).value;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    minute: parseInt(get("minute"), 10),
    second: parseInt(get("second"), 10),
  };
}
