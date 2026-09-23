/**
 * @fileoverview The one send path. It asks the decision core what to do,
 * talks to the two providers, and writes one log row. It holds no rule of
 * its own: route, dead token, wording, and the send window all come from
 * notification-core.js.
 *
 * Every dependency is passed in, so a test can run this with no network.
 */

const nc = require("./notification-core");

/**
 * A Person's first name for {name}, from the caller's values or the record.
 * @param {Object} request
 * @param {Object} person
 * @return {string}
 */
function firstName(request, person) {
  const values = (request && request.values) || {};
  if (typeof values.name === "string" && values.name.trim()) {
    return values.name.trim();
  }
  return (person && person.firstName) || "";
}

/**
 * Where the notification leads. The caller passes it; nothing here mints one.
 * @param {Object} request
 * @return {string}
 */
function destinationUrl(request) {
  if (request && typeof request.url === "string" && request.url.trim()) {
    return request.url.trim();
  }
  const values = (request && request.values) || {};
  if (typeof values.link === "string" && values.link.trim()) {
    return values.link.trim();
  }
  return "";
}

/**
 * Render both wordings. Templates are already resolved by the caller; the
 * fallbacks cover a purpose the config does not know.
 * @param {Object} templates
 * @param {Object} request
 * @param {Object} person
 * @return {{text: string, title: string, body: string, url: string}}
 */
function wordings(templates, request, person) {
  const t = templates || {};
  const kind = request.wording;
  const name = firstName(request, person);
  const url = destinationUrl(request);
  const textTemplates = t.text || {};
  const textFallbacks = t.textFallback || {};
  const pushTemplates = t.push || {};
  const pushFallbacks = t.pushFallback || {};
  const push = pushTemplates[kind] || {};
  const pushDefault = pushFallbacks[kind] || {};
  const lock = nc.renderLockScreen({
    title: push.title,
    body: push.body,
    titleFallback: pushDefault.title || "",
    bodyFallback: pushDefault.body || "",
    firstName: name,
    link: url,
  });
  return {
    text: nc.renderText({
      template: textTemplates[kind],
      fallback: textFallbacks[kind] || "",
      firstName: name,
      link: url,
    }),
    title: lock.title,
    body: lock.body,
    url: url,
  };
}

/**
 * One log row. The path writes exactly one per attempt that was not skipped
 * for the send window.
 * @param {Object} deps
 * @param {Object} row
 * @return {Promise<void>}
 */
async function record(deps, row) {
  await deps.writeLog(row);
}

/**
 * Send the text and record that outcome.
 * @param {Object} deps
 * @param {Object} request
 * @param {Object} person
 * @param {Object} words
 * @return {Promise<Object>}
 */
async function deliverText(deps, request, person, words) {
  let result;
  try {
    result = await deps.sendText({
      to: person.phone,
      body: words.text,
      expectReply: request.expectReply !== false,
    });
  } catch (err) {
    result = {accepted: false, error: err};
  }
  const accepted = !!(result && result.accepted);
  await record(deps, {
    personId: request.personId,
    channel: "text",
    purpose: request.purpose,
    wording: request.wording || null,
    serviceDate: request.serviceDate || null,
    accepted: accepted,
    url: words.url || null,
    to: person.phone,
    body: words.text,
    textId: accepted && result.textId ? String(result.textId) : null,
  });
  return {
    sent: accepted,
    channel: "text",
    accepted: accepted,
    textId: accepted ? result.textId : null,
    quotaRemaining: result && result.quotaRemaining,
  };
}

/**
 * Tell this Person this thing. The caller names a Person, a purpose, the
 * values its wording needs, and a URL. `escalate` asks for the other route.
 * `manual` bypasses the church's send window.
 * @param {Object} deps loadPerson, loadTokens, loadTemplates, sendPush,
 *   sendText, deleteToken, writeLog, now
 * @param {Object} request personId, purpose, wording, values, url, escalate,
 *   manual, serviceDate, expectReply
 * @return {Promise<Object>} what happened
 */
async function tellPerson(deps, request) {
  const now = deps.now ? deps.now() : new Date();
  const parts = nc.churchDateParts(now);
  if (!nc.shouldSendNow({
    localHour: parts.hour,
    manual: !!(request && request.manual),
  })) {
    return {sent: false, skipped: "window", accepted: false};
  }

  const person = await deps.loadPerson(request.personId);
  const uid = person && person.uid;
  const loaded = uid ? await deps.loadTokens(uid) : [];
  const live = (loaded || []).filter((t) => t && t.token);
  const hasPhone = !!(person && person.phone);
  const route = nc.chooseRoute({
    hasLiveToken: live.length > 0,
    hasPhone: hasPhone,
    escalate: !!(request && request.escalate),
  });
  const templates = await deps.loadTemplates();
  const words = wordings(templates, request, person || {});

  if (route === "none") {
    await record(deps, {
      personId: request.personId,
      channel: "none",
      purpose: request.purpose,
      wording: request.wording || null,
      serviceDate: request.serviceDate || null,
      accepted: false,
      unreachable: true,
      url: words.url || null,
    });
    return {
      sent: false, channel: "none", accepted: false, unreachable: true,
    };
  }

  if (route === "text") {
    return deliverText(deps, request, person, words);
  }

  let anyAccepted = false;
  let anyRetryable = false;
  for (const token of live) {
    let result;
    try {
      result = await deps.sendPush({
        token: token.token,
        title: words.title,
        body: words.body,
        url: words.url,
      });
    } catch (err) {
      result = {accepted: false, error: err};
    }
    if (result && result.accepted) {
      anyAccepted = true;
      continue;
    }
    if (nc.isDeadToken(result && result.error)) {
      await deps.deleteToken(uid, token.id);
    } else {
      anyRetryable = true;
    }
  }

  const next = nc.afterPushAttempt({
    anyAccepted: anyAccepted,
    anyRetryable: anyRetryable,
    hasPhone: hasPhone,
  });

  if (next === "done") {
    await record(deps, {
      personId: request.personId,
      channel: "push",
      purpose: request.purpose,
      wording: request.wording || null,
      serviceDate: request.serviceDate || null,
      accepted: true,
      url: words.url || null,
      title: words.title,
      body: words.body,
    });
    return {sent: true, channel: "push", accepted: true};
  }

  if (next === "text") {
    return deliverText(deps, request, person, words);
  }

  if (next === "unreachable") {
    await record(deps, {
      personId: request.personId,
      channel: "none",
      purpose: request.purpose,
      wording: request.wording || null,
      serviceDate: request.serviceDate || null,
      accepted: false,
      unreachable: true,
      url: words.url || null,
    });
    return {
      sent: false, channel: "none", accepted: false, unreachable: true,
    };
  }

  await record(deps, {
    personId: request.personId,
    channel: "push",
    purpose: request.purpose,
    wording: request.wording || null,
    serviceDate: request.serviceDate || null,
    accepted: false,
    url: words.url || null,
    title: words.title,
    body: words.body,
  });
  return {sent: false, channel: "push", accepted: false};
}

module.exports = {
  tellPerson,
};
