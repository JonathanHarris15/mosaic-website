// The App Check decision on the public form door (MS-534 / MS-508).
//
// ⚠ PLATFORM `enforceAppCheck` STAYS FALSE. Firebase's onCall option rejects
// missing/invalid tokens before this file runs, which makes monitor mode
// impossible and turns a rollback into another functions deploy. The door
// decides in-process instead:
//
//   off      — do not look, do not log, do not refuse.
//   monitor  — log missing/invalid tokens, refuse nothing.
//   enforce  — refuse missing/invalid tokens; allow a valid one.
//
// Default at the param is monitor, so merging this cannot brick prod. The
// enforce flip is PUBLIC_FORM_APP_CHECK_MODE (see docs/ops/
// ms-508-app-check-break-glass.md) and is Atlas-escalated, not a silent
// code default.
//
// Pure: no Firebase, no I/O. test/app-check-door.test.js is the allow/deny
// table. publicForm in index.js is the only caller — one door (ADR-0051).

"use strict";

const MODES = ["off", "monitor", "enforce"];

/**
 * @param {*} raw What the param or config said.
 * @return {"off"|"monitor"|"enforce"} Unknown values fall back to monitor,
 *     never enforce: a typo must not lock the church out of its forms.
 */
function normaliseMode(raw) {
  const mode = String(raw == null ? "monitor" : raw).trim().toLowerCase();
  if (MODES.indexOf(mode) === -1) return "monitor";
  return mode;
}

/**
 * @param {*} requestApp `request.app` from a v2 callable. Firebase leaves
 *     this undefined when the token is missing or invalid and
 *     `enforceAppCheck` is false. A present object is a valid attestation.
 * @return {boolean} True when a valid App Check token arrived.
 */
function attested(requestApp) {
  return requestApp != null && typeof requestApp === "object";
}

/**
 * @param {*} mode off | monitor | enforce (anything else → monitor).
 * @param {*} requestApp `request.app` from the callable.
 * @return {!Object} {reject, log, mode, tokenState, code?}.
 */
function verdict(mode, requestApp) {
  const m = normaliseMode(mode);
  const okToken = attested(requestApp);
  const tokenState = okToken ? "valid" : "missing-or-invalid";

  if (m === "off") {
    return {reject: false, log: false, mode: m, tokenState: tokenState};
  }

  const shouldLog = !okToken;
  if (m === "enforce" && !okToken) {
    return {
      reject: true,
      log: true,
      mode: m,
      tokenState: tokenState,
      code: "unauthenticated",
    };
  }
  return {
    reject: false,
    log: shouldLog,
    mode: m,
    tokenState: tokenState,
  };
}

/**
 * Structured payload for `firebase-functions/logger`. Counts of
 * missing-or-invalid under monitor are the signal to flip enforce.
 *
 * @param {!Object} decision Return value of verdict().
 * @param {Object=} extra op / formId, never answers.
 * @return {!Object} Fields safe to log.
 */
function metricPayload(decision, extra) {
  const out = {
    door: "publicForm",
    appCheckMode: decision.mode,
    appCheckToken: decision.tokenState,
    appCheckReject: decision.reject,
  };
  if (extra && extra.op != null) out.op = extra.op;
  if (extra && extra.formId != null) out.formId = extra.formId;
  return out;
}

module.exports = {
  MODES,
  normaliseMode,
  attested,
  verdict,
  metricPayload,
};
