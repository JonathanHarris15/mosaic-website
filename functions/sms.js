/**
 * @fileoverview Pure, testable helpers for the SMS (Textbelt) integration.
 *
 * The outbound provider is Textbelt (https://textbelt.com). The prepaid API key
 * is held server-side as the Firebase secret TEXTBELT_KEY and is never exposed
 * to the browser — the Admin Dashboard talks to callable functions that read the
 * secret, so this module deliberately contains no network or Firebase code. That
 * keeps the request/response shaping unit-testable without mocks.
 */

const crypto = require("crypto");

const ADMIN_ROLES = ["admin", "super_admin"];

/** Reject webhook timestamps older/newer than this to blunt replay attacks. */
const WEBHOOK_MAX_SKEW_MS = 15 * 60 * 1000;

/**
 * Normalizes a US phone number to E.164 (+1XXXXXXXXXX) for sending. Returns ""
 * for empty/unparseable input so callers can reject before spending credit.
 * @param {string} raw
 * @return {string}
 */
function toE164US(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  return digits ? `+${digits}` : "";
}

/**
 * Whether a /users role may use the admin SMS tools.
 * @param {string} role
 * @return {boolean}
 */
function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

/**
 * Shapes Textbelt's GET /quota/:key response into the payload the dashboard
 * renders. `configured` is false when no key is set, so the UI can prompt to set
 * one rather than showing a misleading "0 remaining".
 * @param {{success?: boolean, quotaRemaining?: number, error?: string}} json
 * @param {boolean} hasKey - whether a TEXTBELT_KEY secret value was present.
 * @return {{configured: boolean, quotaRemaining: number|null, error: string|null}}
 */
function interpretQuota(json, hasKey) {
  if (!hasKey) {
    return {configured: false, quotaRemaining: null, error: null};
  }
  const data = json || {};
  if (data.success) {
    return {
      configured: true,
      quotaRemaining: Number(data.quotaRemaining) || 0,
      error: null,
    };
  }
  return {
    configured: true,
    quotaRemaining: null,
    error: data.error || "Textbelt rejected the key.",
  };
}

/**
 * Shapes Textbelt's POST /text response into the dashboard's send result.
 * @param {{success?: boolean, textId?: string, quotaRemaining?: number,
 *   error?: string}} json
 * @return {{success: boolean, textId: string|null, quotaRemaining: number|null,
 *   error: string|null}}
 */
function interpretSend(json) {
  const data = json || {};
  if (data.success) {
    return {
      success: true,
      textId: data.textId || null,
      quotaRemaining: Number(data.quotaRemaining),
      error: null,
    };
  }
  return {
    success: false,
    textId: null,
    quotaRemaining: null,
    error: data.error || "Textbelt did not accept the message.",
  };
}

/**
 * Normalizes an inbound Textbelt reply webhook body into the record stored in
 * the test-replies stack. Textbelt POSTs {textId, fromNumber, text} when a
 * recipient replies to a text sent with a replyWebhook. Returns null when the
 * payload carries no message text, so the webhook can ignore junk/health pings
 * rather than littering the stack with blank rows.
 * @param {{textId?: string, fromNumber?: string, text?: string}} body
 * @return {{textId: string, fromNumber: string, text: string}|null}
 */
function parseInboundReply(body) {
  const data = body || {};
  const text = String(data.text || "").trim();
  if (!text) return null;
  return {
    textId: String(data.textId || ""),
    fromNumber: String(data.fromNumber || ""),
    text,
  };
}

/**
 * Verifies a Textbelt reply webhook so forged POSTs can't inject fake replies.
 * Textbelt signs (timestamp + raw JSON body) with the account's API key as the
 * HMAC-SHA256 secret and sends the hex digest in X-textbelt-signature, plus the
 * UNIX-seconds timestamp in X-textbelt-timestamp. We recompute the HMAC over the
 * RAW body (not a re-serialized object — key order/whitespace would differ) and
 * timing-safe compare, after rejecting stale timestamps to blunt replay.
 * @param {Object} args
 * @param {string} args.apiKey - the Textbelt key (HMAC secret).
 * @param {string} args.timestamp - X-textbelt-timestamp header (UNIX seconds).
 * @param {string} args.signature - X-textbelt-signature header (hex digest).
 * @param {string} args.rawBody - the exact request body bytes as a string.
 * @param {number} args.nowMs - current time in ms (injected for testability).
 * @return {boolean}
 */
function verifyTextbeltSignature({apiKey, timestamp, signature, rawBody, nowMs}) {
  if (!apiKey || !timestamp || !signature) return false;

  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds)) return false;
  if (Math.abs(nowMs - tsSeconds * 1000) > WEBHOOK_MAX_SKEW_MS) return false;

  const expected = crypto
      .createHmac("sha256", apiKey)
      .update(timestamp + rawBody)
      .digest("hex");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — a mismatched length is already
  // a failed signature, so short-circuit rather than let it throw.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ADMIN_ROLES,
    WEBHOOK_MAX_SKEW_MS,
    toE164US,
    isAdminRole,
    interpretQuota,
    interpretSend,
    parseInboundReply,
    verifyTextbeltSignature,
  };
}
