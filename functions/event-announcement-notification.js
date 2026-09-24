/**
 * @fileoverview Default and resolved wording for event-announcement
 * Notifications (purpose `event_announcement`, MS-623 / MS-679).
 *
 * Stored in app_config/prayer_request_sms beside pastoral-prayer templates
 * until MS-189's wider notification config lands. Field names match the
 * push*Title / push*Body pattern so a merge stays mechanical.
 */

const PURPOSE = "event_announcement";
const WORDING = "tell";

/** @type {string} */
const DEFAULT_TEXT = "{title}\n\n{prose}\n{link}";

/** @type {{title: string, body: string}} */
const DEFAULT_PUSH = {
  title: "{title}",
  body: "{prose}",
};

/**
 * Firestore field for one half of a push template.
 * @param {string} part title | body
 * @return {string}
 */
function pushField(part) {
  const which = part === "title" ? "Title" : "Body";
  return `pushEventAnnouncement${which}`;
}

/**
 * @param {?Object} config app_config/prayer_request_sms
 * @return {{text: string, push: {title: string, body: string}}}
 */
function resolveEventAnnouncementWording(config) {
  const data = config || {};
  const textRaw = typeof data.eventAnnouncementText === "string" ?
    data.eventAnnouncementText.trim() : "";
  const titleRaw = typeof data[pushField("title")] === "string" ?
    data[pushField("title")].trim() : "";
  const bodyRaw = typeof data[pushField("body")] === "string" ?
    data[pushField("body")].trim() : "";
  return {
    text: textRaw || DEFAULT_TEXT,
    push: {
      title: titleRaw || DEFAULT_PUSH.title,
      body: bodyRaw || DEFAULT_PUSH.body,
    },
  };
}

/**
 * Shape the send path expects when templates are loaded per wording kind.
 * @param {?Object} config
 * @return {Object}
 */
function templatesForSendPath(config) {
  const resolved = resolveEventAnnouncementWording(config);
  return {
    text: {[WORDING]: resolved.text},
    textFallback: {[WORDING]: DEFAULT_TEXT},
    push: {[WORDING]: resolved.push},
    pushFallback: {[WORDING]: DEFAULT_PUSH},
  };
}

/**
 * Fill {name}, {title}, {prose}, and {link} for tests and pre-MS-189 renders.
 * @param {string} template
 * @param {Object} values
 * @return {string}
 */
function fillTemplate(template, values) {
  const src = typeof template === "string" ? template : "";
  const v = values || {};
  const rawName = typeof v.name === "string" ? v.name.trim() : "";
  const name = rawName || "there";
  const title = typeof v.title === "string" ? v.title : "";
  const prose = typeof v.prose === "string" ? v.prose : "";
  const link = typeof v.link === "string" ? v.link : "";
  return src
      .split("{name}").join(name)
      .split("{title}").join(title)
      .split("{prose}").join(prose)
      .split("{link}").join(link);
}

module.exports = {
  PURPOSE,
  WORDING,
  DEFAULT_TEXT,
  DEFAULT_PUSH,
  pushField,
  resolveEventAnnouncementWording,
  templatesForSendPath,
  fillTemplate,
};
