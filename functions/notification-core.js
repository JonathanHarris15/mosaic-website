/**
 * @fileoverview Pure decisions for reaching a Person. No Firebase, no network,
 * and no clock of its own — the caller passes the hour or the instant.
 *
 * This is the only module that names a channel. Callers outside the send path
 * say who and what; they do not say push or text. The send window lives here
 * so a text and a push cannot drift onto two clocks (ADR-0036).
 */

/** The church's local timezone. */
const CHURCH_TIMEZONE = "America/Chicago";

/** Earliest hour (inclusive, 24h church-local) a Notification may be sent. */
const WINDOW_OPEN_HOUR = 8;

/** Hour (exclusive, church-local) after which no Notification may be sent. */
const WINDOW_CLOSE_HOUR = 20;

/**
 * How long a lock-screen title stays readable. The admin editor shows this
 * count; it does not refuse a longer title.
 */
const PUSH_TITLE_LIMIT = 40;

/** Neutral stand-in when a Person's first name is unknown. */
const NEUTRAL_NAME = "there";

/**
 * Provider codes that mean the device is gone. Both the HTTP v1 names and the
 * firebase-admin `messaging/…` codes are listed: the admin SDK wraps the
 * former in the latter. Anything else is retryable.
 */
const DEAD_TOKEN_CODES = new Set([
  "UNREGISTERED",
  "INVALID_ARGUMENT",
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/**
 * Church-local date (YYYY-MM-DD) and hour (0-23) for an instant.
 * @param {Date} now
 * @return {{date: string, hour: number}}
 */
function churchDateParts(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHURCH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type).value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return {date, hour};
}

/**
 * Whether a church-local hour is inside 8am–8pm.
 * @param {number} localHour
 * @return {boolean}
 */
function isInsideSendWindow(localHour) {
  return typeof localHour === "number" &&
    localHour >= WINDOW_OPEN_HOUR &&
    localHour < WINDOW_CLOSE_HOUR;
}

/**
 * Whether a send may leave now. A manual send bypasses the window; the
 * scheduler does not. One function, so the two cannot disagree.
 * @param {Object} state localHour, and manual when a person is sending now
 * @return {boolean}
 */
function shouldSendNow(state) {
  if (state && state.manual) return true;
  return isInsideSendWindow(state && state.localHour);
}

/**
 * A route only when that route can still be taken.
 * @param {string} channel push or text
 * @param {boolean} hasLiveToken
 * @param {boolean} hasPhone
 * @return {string} the route, or null when it cannot
 */
function routeIfPossible(channel, hasLiveToken, hasPhone) {
  if (channel === "push" && hasLiveToken) return "push";
  if (channel === "text" && hasPhone) return "text";
  return null;
}

/**
 * The route a Notification takes before any provider is asked.
 * Escalate means the last one may not have landed, so use the other route.
 * previousChannel is the route that already went. Without it, the other
 * route is the one that is not natural today.
 * @param {Object} state hasLiveToken, hasPhone, escalate, previousChannel
 * @return {string} push, text, or none
 */
function chooseRoute(state) {
  const hasLiveToken = !!(state && state.hasLiveToken);
  const hasPhone = !!(state && state.hasPhone);
  const natural = hasLiveToken ? "push" : (hasPhone ? "text" : "none");
  if (!state || !state.escalate || natural === "none") return natural;
  // The other route from the one that already went, when the path remembers
  // it. Otherwise the other route from what would be natural today.
  const remembered = state.previousChannel;
  const from = (remembered === "push" || remembered === "text") ?
    remembered : natural;
  const other = from === "push" ? "text" : "push";
  return routeIfPossible(other, hasLiveToken, hasPhone) || natural;
}

/**
 * What the send path does after it has tried every live token.
 * `done` — a token was accepted; do not text.
 * `text` — every token is dead, and a phone exists; text in this same run.
 * `stop` — something failed in a way that might work later; do not text.
 * `unreachable` — nothing left that can carry the message.
 * @param {Object} s anyAccepted, anyRetryable, hasPhone
 * @return {'done'|'text'|'stop'|'unreachable'}
 */
function afterPushAttempt(s) {
  if (s && s.anyAccepted) return "done";
  if (s && s.anyRetryable) return "stop";
  if (s && s.hasPhone) return "text";
  return "unreachable";
}

/**
 * The code string off a provider error, whatever shape it came back in.
 * @param {*} err
 * @return {string}
 */
function errorCode(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err.code === "string") return err.code;
  if (err.errorInfo && typeof err.errorInfo.code === "string") {
    return err.errorInfo.code;
  }
  return "";
}

/**
 * Whether the push provider is saying this device is gone.
 * An unrecognised error is retryable, not dead.
 * @param {*} err a code string or an error object
 * @return {boolean}
 */
function isDeadToken(err) {
  const code = errorCode(err);
  return DEAD_TOKEN_CODES.has(code);
}

/**
 * First name, or the neutral stand-in.
 * @param {string} firstName
 * @return {string}
 */
function nameOrNeutral(firstName) {
  if (typeof firstName === "string" && firstName.trim()) {
    return firstName.trim();
  }
  return NEUTRAL_NAME;
}

/**
 * Fill {name} and {link}. A missing link removes the placeholder; it does
 * not mint a URL. MS-247 passes the Answer link in when one exists.
 * @param {string} template
 * @param {Object} values firstName and an optional link
 * @return {string}
 */
function fill(template, values) {
  const src = typeof template === "string" ? template : "";
  const link = values && typeof values.link === "string" ? values.link : "";
  return src
      .split("{name}").join(nameOrNeutral(values && values.firstName))
      .split("{link}").join(link);
}

/**
 * The longer form a text takes. A blank template uses the fallback.
 * @param {Object} args template, fallback, firstName, link
 * @return {string}
 */
function renderText(args) {
  const a = args || {};
  const chosen = typeof a.template === "string" && a.template.trim() ?
    a.template : (a.fallback || "");
  return fill(chosen, a);
}

/**
 * Title and body for a lock screen. Each field falls back on its own, so a
 * half-filled config still renders a complete notification.
 * @param {Object} args title, body, fallbacks, firstName, link
 * @return {{title: string, body: string}}
 */
function renderLockScreen(args) {
  const a = args || {};
  return {
    title: renderText({
      template: a.title,
      fallback: a.titleFallback,
      firstName: a.firstName,
      link: a.link,
    }),
    body: renderText({
      template: a.body,
      fallback: a.bodyFallback,
      firstName: a.firstName,
      link: a.link,
    }),
  };
}

module.exports = {
  CHURCH_TIMEZONE,
  WINDOW_OPEN_HOUR,
  WINDOW_CLOSE_HOUR,
  // Exported so the admin picture of the send path can name the codes this
  // module actually acts on rather than a second list that drifts (MS-682).
  DEAD_TOKEN_CODES,
  PUSH_TITLE_LIMIT,
  NEUTRAL_NAME,
  churchDateParts,
  isInsideSendWindow,
  shouldSendNow,
  chooseRoute,
  afterPushAttempt,
  isDeadToken,
  renderText,
  renderLockScreen,
};
