/**
 * @fileoverview Pure Answer link mechanics (MS-510, ADR-0067). Mint and shape
 * a token, hash it for storage, compute church-local expiry, decide whether a
 * stored link is still usable, and rate-limit saves and unknown-token lookups.
 * No Firebase or network — callers pass the clock and persist counter updates.
 */

const crypto = require("crypto");

const FormsCore = require("./shared/forms-core");

/** Public site address written into texts — single origin for `/a/<token>`. */
const SITE_ORIGIN = "https://mosaic-hymn-database.web.app";

/** Church-local calendar for expiry (same clock as notifications). */
const CHURCH_TIMEZONE = "America/Chicago";

/** A link never outlives this many days from minting (ADR-0067). */
const MAX_LINK_AGE_MS = 21 * 24 * 60 * 60 * 1000;

/** Saves allowed on one link per rolling hour. */
const SAVE_LIMIT_PER_HOUR = 10;

/** Unknown-token database lookups allowed per hashed caller per hour. */
const UNKNOWN_LOOKUP_LIMIT_PER_HOUR = 30;

const ROLLING_HOUR_MS = 60 * 60 * 1000;

/**
 * Mint a 128-bit base58 token from caller-supplied random bytes.
 * @param {Uint8Array} randomBytes at least 16 bytes
 * @return {string}
 */
function mintAnswerToken(randomBytes) {
  return FormsCore.formIdFromBytes(randomBytes);
}

/**
 * Whether a token has the right shape to bother hashing — refuse before read.
 * @param {*} token
 * @return {boolean}
 */
function looksLikeAnswerToken(token) {
  return FormsCore.looksLikeFormId(token);
}

/**
 * Firestore document id for an answer_links row: SHA-256 of the token only.
 * @param {string} token
 * @return {string} hex digest
 */
function tokenDocumentId(token) {
  return crypto.createHash("sha256")
      .update(String(token), "utf8")
      .digest("hex");
}

/**
 * Hash a caller address for rate-limit rows; the raw value is never stored.
 * @param {string} address
 * @return {string} hex digest
 */
function hashCallerAddress(address) {
  return crypto.createHash("sha256")
      .update(String(address), "utf8")
      .digest("hex");
}

/**
 * Expiry instant: end of purposeEndDate church-local, capped at 21 days after
 * minting.
 * @param {string} purposeEndDate YYYY-MM-DD (e.g. service date)
 * @param {Date} mintedAt
 * @return {Date}
 */
function linkExpiryAt(purposeEndDate, mintedAt) {
  const purposeEnd = churchEndOfDate(String(purposeEndDate));
  const cap = new Date(mintedAt.getTime() + MAX_LINK_AGE_MS);
  return purposeEnd.getTime() <= cap.getTime() ? purposeEnd : cap;
}

/**
 * Whether a stored link may still be read. Unknown and expired are the same.
 * @param {?Object} linkRecord stored answer_links document fields
 * @param {Date} now
 * @return {{open: boolean}}
 */
function linkUsability(linkRecord, now) {
  const closed = {open: false};
  if (!linkRecord || linkRecord.expiresAt == null) return closed;
  const expiresAt = coerceDate(linkRecord.expiresAt);
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return closed;
  if (now.getTime() > expiresAt.getTime()) return closed;
  return {open: true};
}

/**
 * May this link accept another save now? Returns the counter to persist.
 * @param {?Object} counter {saveTimestamps?: number[]}
 * @param {Date} now
 * @return {{ok: true, saveTimestamps: number[]} | {ok: false}}
 */
function saveRateDecision(counter, now) {
  const stamps = pruneRollingHour(counter && counter.saveTimestamps, now);
  if (stamps.length >= SAVE_LIMIT_PER_HOUR) return {ok: false};
  return {ok: true, saveTimestamps: stamps.concat(now.getTime())};
}

/**
 * May this hashed caller probe another unknown token?
 * @param {?Object} counter {lookupTimestamps?: number[]}
 * @param {Date} now
 * @return {{ok: true, lookupTimestamps: number[]} | {ok: false}}
 */
function unknownLookupRateDecision(counter, now) {
  const stamps = pruneRollingHour(counter && counter.lookupTimestamps, now);
  if (stamps.length >= UNKNOWN_LOOKUP_LIMIT_PER_HOUR) return {ok: false};
  return {ok: true, lookupTimestamps: stamps.concat(now.getTime())};
}

/**
 * Full Answer link URL for SMS templates.
 * @param {string} token
 * @return {string}
 */
function buildAnswerUrl(token) {
  return `${SITE_ORIGIN}/a/${token}`;
}

/**
 * Last millisecond of a church-local calendar day.
 * @param {string} dateStr YYYY-MM-DD
 * @return {Date}
 */
function churchEndOfDate(dateStr) {
  const next = addCalendarDay(dateStr);
  const startNext = churchStartOfDate(next);
  return new Date(startNext.getTime() - 1);
}

/**
 * @param {string} dateStr YYYY-MM-DD
 * @return {string} next calendar day YYYY-MM-DD
 */
function addCalendarDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

/**
 * First instant of a church-local calendar day (midnight).
 * @param {string} dateStr YYYY-MM-DD
 * @return {Date}
 */
function churchStartOfDate(dateStr) {
  const anchor = churchInstantOnDate(dateStr, 12, 0, 0);
  let t = anchor.getTime();
  for (let step = 3600000; step >= 1000; step = step > 1000 ? step / 2 : 1000) {
    let probe = churchDateTimeParts(new Date(t - step));
    while (probe.date === dateStr) {
      t -= step;
      probe = churchDateTimeParts(new Date(t - step));
    }
  }
  const at = churchDateTimeParts(new Date(t));
  if (at.date !== dateStr || at.hour !== 0) {
    throw new Error("churchStartOfDate could not resolve " + dateStr);
  }
  return new Date(t);
}

/**
 * Any instant on a church-local calendar day with the given clock time.
 * @param {string} dateStr YYYY-MM-DD
 * @param {number} hour
 * @param {number} minute
 * @param {number} second
 * @return {Date}
 */
function churchInstantOnDate(dateStr, hour, minute, second) {
  const [y, m, d] = dateStr.split("-").map(Number);
  for (let utcHour = 0; utcHour < 48; utcHour++) {
    const t = Date.UTC(y, m - 1, d, utcHour, minute, second, 0);
    const parts = churchDateTimeParts(new Date(t));
    if (parts.date === dateStr && parts.hour === hour &&
        parts.minute === minute && parts.second === second) {
      return new Date(t);
    }
  }
  throw new Error("churchInstantOnDate could not resolve " + dateStr);
}

/**
 * @param {Date} instant
 * @return {{date: string, hour: number, minute: number, second: number}}
 */
function churchDateTimeParts(instant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHURCH_TIMEZONE,
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

/**
 * @param {?Array<number>} timestamps epoch ms
 * @param {Date} now
 * @return {number[]}
 */
function pruneRollingHour(timestamps, now) {
  const list = Array.isArray(timestamps) ? timestamps : [];
  const cutoff = now.getTime() - ROLLING_HOUR_MS;
  return list.filter((t) => typeof t === "number" && t >= cutoff);
}

/**
 * @param {*} value Firestore Timestamp, Date, or epoch ms
 * @return {?Date}
 */
function coerceDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (value && typeof value.toDate === "function") return value.toDate();
  if (typeof value === "string") return new Date(value);
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SITE_ORIGIN,
    CHURCH_TIMEZONE,
    MAX_LINK_AGE_MS,
    SAVE_LIMIT_PER_HOUR,
    UNKNOWN_LOOKUP_LIMIT_PER_HOUR,
    mintAnswerToken,
    looksLikeAnswerToken,
    tokenDocumentId,
    hashCallerAddress,
    linkExpiryAt,
    linkUsability,
    saveRateDecision,
    unknownLookupRateDecision,
    buildAnswerUrl,
    churchEndOfDate,
  };
}
