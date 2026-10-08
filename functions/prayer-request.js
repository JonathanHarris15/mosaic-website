/**
 * @fileoverview Pure pastoral-prayer domain logic for the Prayer Request
 * texting flow. No Firebase or Textbelt I/O — the orchestrator in index.js
 * loads the editable templates, performs sends, and writes Firestore; this
 * module only decides and shapes, so every rule here is unit-testable
 * directly.
 */

const nc = require("./notification-core");

/**
 * The church's local timezone, and the send window, live on the notification
 * core so a text and a push share one clock. Re-exported so existing callers
 * (`pr.WINDOW_OPEN_HOUR`, `pr.churchDateParts`) keep their names.
 */
const CHURCH_TIMEZONE = nc.CHURCH_TIMEZONE;
const WINDOW_OPEN_HOUR = nc.WINDOW_OPEN_HOUR;
const WINDOW_CLOSE_HOUR = nc.WINDOW_CLOSE_HOUR;

/** First send happens when the service is this many days away (or fewer). */
const INITIAL_DAYS_OUT = 5;

/** Reminder send happens when the service is this many days away (or fewer). */
const REMINDER_DAYS_OUT = 3;

/**
 * Canonical default Prayer Request message templates. {name} is replaced with
 * the subject's first name when sent. These are the server-side fallback when
 * app_config/prayer_request_sms has no (or a blank) value for a kind. KEEP IN
 * SYNC with PRAYER_MESSAGE_DEFAULTS in public/admin-dashboard.js, which seeds
 * the editor with the same text.
 * @type {{initial: string, reminder: string, thankyou: string}}
 */
const DEFAULT_PRAYER_MESSAGES = {
  initial: "Hi {name}, this is Mosaic Church. You're in our pastoral prayer " +
    "this Sunday. What would you like us to pray about? (This information " +
    "will be private and only shared with Elders) Just reply to this " +
    "message, or answer here: {link}",
  reminder: "Hi {name}, a gentle reminder from Mosaic Church — we'd love to " +
    "pray for you this Sunday. What would you like us to pray about? (This " +
    "information will be private and only shared with Elders) Just reply " +
    "here whenever you're ready, or answer here: {link}",
  thankyou: "Thank you, {name}. We'll be lifting this up in prayer this " +
    "Sunday. — Mosaic Church",
  elderDigest: "Mosaic prayer requests for {date}:\n{requests}",
};

/**
 * Lock-screen wording per purpose. A text runs long; a title does not.
 * KEEP IN SYNC with DEFAULT_PUSH_WORDING in public/admin-dashboard.js and
 * public/mobile/data.js. {name} is the subject's first name.
 * @type {Object}
 */
const DEFAULT_PUSH_WORDING = {
  initial: {
    title: "Sunday's prayer",
    body: "{name}, you're in this Sunday's pastoral prayer. " +
      "What can we pray about?",
  },
  reminder: {
    title: "Prayer reminder",
    body: "{name}, we'd still love to know what to pray about this Sunday.",
  },
  thankyou: {
    title: "Thank you",
    body: "Thank you, {name}. We'll be praying this Sunday.",
  },
};

/** Purposes that have a lock-screen title and body. */
const PUSH_WORDING_KINDS = ["initial", "reminder", "thankyou"];

/** Shown on the Answer page; matches the automated text's promise. */
const PRAYER_ANSWER_PRIVACY_LINE =
  "What you write is private and only shared with Elders.";

/**
 * Config field for one half of a push template, e.g. pushInitialTitle.
 * @param {string} kind initial | reminder | thankyou
 * @param {string} part title | body
 * @return {string}
 */
function pushConfigKey(kind, part) {
  const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
  const which = part === "title" ? "Title" : "Body";
  return `push${cap}${which}`;
}

/**
 * The first whitespace-delimited token of a full name.
 * @param {string} name
 * @return {string}
 */
function firstNameOf(name) {
  if (typeof name !== "string") return "";
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

/**
 * Merges a saved config over the defaults per field, treating a missing or
 * blank value as "use the default" so a half-filled config doc still renders
 * complete messages.
 * @param {?Object} config - app_config/prayer_request_sms data (or null).
 * @return {{initial: string, reminder: string, thankyou: string}}
 */
function resolveTemplates(config) {
  const data = config || {};
  const pick = (kind) => {
    const v = typeof data[kind] === "string" ? data[kind].trim() : "";
    return v || DEFAULT_PRAYER_MESSAGES[kind];
  };
  return {
    initial: pick("initial"),
    reminder: pick("reminder"),
    thankyou: pick("thankyou"),
    elderDigest: pick("elderDigest"),
  };
}

/**
 * Push title and body per purpose. A blank field uses that field's default,
 * so a half-filled config still renders a complete lock screen.
 * @param {?Object} config app_config/prayer_request_sms, or null.
 * @return {Object} initial, reminder, thankyou — each {title, body}
 */
function resolvePushWording(config) {
  const data = config || {};
  const out = {};
  for (const kind of PUSH_WORDING_KINDS) {
    const titleRaw = data[pushConfigKey(kind, "title")];
    const bodyRaw = data[pushConfigKey(kind, "body")];
    const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
    const body = typeof bodyRaw === "string" ? bodyRaw.trim() : "";
    out[kind] = {
      title: title || DEFAULT_PUSH_WORDING[kind].title,
      body: body || DEFAULT_PUSH_WORDING[kind].body,
    };
  }
  return out;
}

/**
 * Renders one Prayer Request message, substituting the subject's first name for
 * every {name} placeholder (falling back to "there" when unknown).
 * @param {'initial'|'reminder'|'thankyou'} kind
 * @param {string} firstName
 * @param {{initial: string, reminder: string, thankyou: string}} [templates]
 * @param {?string} [answerLink] substituted for {link} on initial/reminder
 * @return {string}
 */
function renderPrayerRequestMessage(kind, firstName, templates, answerLink) {
  let tpl = (templates && templates[kind]) ||
    DEFAULT_PRAYER_MESSAGES[kind] || "";
  const name = (typeof firstName === "string" && firstName.trim()) ?
    firstName.trim() : "there";
  const link = typeof answerLink === "string" ? answerLink.trim() : "";
  if (link && (kind === "initial" || kind === "reminder")) {
    tpl = ensureAnswerLinkInTemplate(tpl, link);
  }
  return tpl.split("{name}").join(name).split("{link}").join(link);
}

/**
 * Saved templates without {link} still send a link on its own line (MS-247).
 * @param {string} template
 * @param {string} answerLink
 * @return {string}
 */
function ensureAnswerLinkInTemplate(template, answerLink) {
  const base = String(template == null ? "" : template);
  const link = String(answerLink == null ? "" : answerLink).trim();
  if (!link) return base;
  if (base.includes("{link}")) return base;
  const trimmed = base.trimEnd();
  return trimmed ? `${trimmed}\n${link}` : link;
}

/**
 * Put a {link} slot on initial/reminder when a saved template omitted it.
 * The send path still substitutes the URL; this only keeps the slot.
 * @param {?Object} templates
 * @return {Object}
 */
function templatesWithAnswerLink(templates) {
  const t = templates || {};
  const addSlot = (kind) => {
    const src = typeof t[kind] === "string" ? t[kind] : "";
    if (src.includes("{link}")) return src;
    const trimmed = src.trimEnd();
    return trimmed ? `${trimmed}\n{link}` : "{link}";
  };
  return Object.assign({}, t, {
    initial: addSlot("initial"),
    reminder: addSlot("reminder"),
  });
}

/**
 * The church-local date (YYYY-MM-DD) and hour (0-23) for an instant.
 * Defined on the notification core; this name stays for existing callers.
 * @param {Date} now
 * @return {{date: string, hour: number}}
 */
function churchDateParts(now) {
  return nc.churchDateParts(now);
}

/**
 * Whole days from todayDate to serviceDate (both YYYY-MM-DD). Negative if the
 * service date is in the past.
 * @param {string} serviceDate
 * @param {string} todayDate
 * @return {number}
 */
function daysUntil(serviceDate, todayDate) {
  const toUTC = (d) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((toUTC(serviceDate) - toUTC(todayDate)) / 86400000);
}

/**
 * Whether personId is pastoral prayer on this service's liturgy.
 * @param {?Object} liturgy
 * @param {?string} personId
 * @param {?Array<string>} subjectIds people the order names, when known
 * @return {boolean}
 */
function isPastoralPrayerSubject(liturgy, personId, subjectIds) {
  if (!personId) return false;
  if (Array.isArray(subjectIds)) return subjectIds.indexOf(personId) !== -1;
  if (!liturgy) return false;
  const male = liturgy.prayerMale && liturgy.prayerMale.id;
  const female = liturgy.prayerFemale && liturgy.prayerFemale.id;
  return personId === male || personId === female;
}

/**
 * Days a prayer tells people, furthest first. A stored number is that day
 * and the reminder two days closer. Missing is 5 and 3. An empty list
 * tells nobody.
 * @param {?Object} element
 * @return {Array<number>}
 */
function noticeListOf(element) {
  if (!element || !element.requests) return [];
  const raw = element.noticeDays;
  if (Array.isArray(raw)) {
    const days = [];
    raw.forEach((value) => {
      let n = parseInt(value, 10);
      if (!Number.isFinite(n) || n < 1) return;
      if (n > 30) n = 30;
      if (days.indexOf(n) === -1) days.push(n);
    });
    days.sort((a, b) => b - a);
    return days;
  }
  if (raw == null || raw === "") {
    return [INITIAL_DAYS_OUT, REMINDER_DAYS_OUT];
  }
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return [];
  const first = Math.min(n, 30);
  const reminder = reminderDaysFor(first);
  if (reminder >= 1 && reminder !== first) return [first, reminder];
  return [first];
}

/**
 * The furthest day a prayer tells people. Missing reads as the old five.
 * 0 tells nobody on its own.
 * @param {?Object} element
 * @return {number}
 */
function noticeDaysOf(element) {
  const list = noticeListOf(element);
  return list.length ? list[0] : 0;
}

/**
 * The ask and the thank-you written on a prayer. Blank uses the built-in
 * wording, after any saved config.
 * @param {?Object} element
 * @return {{message: string, response: string}}
 */
function proseOf(element) {
  const text = (value) => (
    typeof value === "string" ? value.trim() : ""
  );
  return {
    message: text(element && element.message),
    response: text(element && element.response),
  };
}

/**
 * A custom message still carries the answer link.
 * @param {?string} text
 * @return {string}
 */
function messageWithLink(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return "";
  if (raw.includes("{link}")) return raw;
  return `${raw}\n{link}`;
}

/**
 * The reminder sits two days closer than the first ask, the old 5-and-3 gap.
 * @param {number} noticeDays
 * @return {number}
 */
function reminderDaysFor(noticeDays) {
  const n = Number(noticeDays);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, n - (INITIAL_DAYS_OUT - REMINDER_DAYS_OUT));
}

/**
 * Everyone a Sunday's pastoral prayer asks, from a prayer that sends
 * requests and from the older male and female fields. One person is one
 * row. A prayer's own days win over the older fields.
 * @param {Object} args
 * @param {?Object} args.liturgy
 * @param {Array} [args.elements] the Sunday's order
 * @return {Array<Object>} id, name, noticeDays, noticeList, message,
 *   response, fromElement
 */
function pastoralSubjects(args) {
  const liturgy = (args && args.liturgy) || {};
  const elements = (args && args.elements) || [];
  const byId = new Map();
  const consider = (person, noticeList, fromElement, prose) => {
    if (!person || !person.id) return;
    const list = Array.isArray(noticeList) ? noticeList : [];
    const days = list.length ? list[0] : 0;
    const words = prose || {message: "", response: ""};
    const prev = byId.get(person.id);
    if (!prev) {
      byId.set(person.id, {
        id: person.id,
        name: person.name || "",
        noticeDays: days,
        noticeList: list.slice(),
        message: words.message || "",
        response: words.response || "",
        fromElement: !!fromElement,
      });
      return;
    }
    if (fromElement && !prev.fromElement) {
      prev.noticeDays = days;
      prev.noticeList = list.slice();
      prev.message = words.message || "";
      prev.response = words.response || "";
      prev.fromElement = true;
      if (person.name) prev.name = person.name;
    } else if (fromElement && days > prev.noticeDays) {
      prev.noticeDays = days;
      prev.noticeList = list.slice();
      if (words.message) prev.message = words.message;
      if (words.response) prev.response = words.response;
    }
  };
  const prayers = elements.filter((el) =>
    el && el.kind === "prayer" && el.requests);
  prayers.forEach((el) => {
    const value = liturgy[el.id];
    const named = Array.isArray(value) ? value : [];
    const words = proseOf(el);
    named.forEach((person) =>
      consider(person, noticeListOf(el), true, words));
  });
  let legacyList = null;
  prayers.forEach((el) => {
    const list = noticeListOf(el);
    if (!list.length) return;
    if (!legacyList || list[0] > legacyList[0]) legacyList = list;
  });
  if (!legacyList) {
    legacyList = noticeListOf({
      requests: {count: 1}, noticeDays: INITIAL_DAYS_OUT,
    });
  }
  const quiet = {message: "", response: ""};
  consider(liturgy.prayerMale, legacyList, false, quiet);
  consider(liturgy.prayerFemale, legacyList, false, quiet);
  return Array.from(byId.values());
}

/**
 * Subjects plus whether the order itself has turned asking on. A prayer
 * with days set tells its people even when the old admin switch is off.
 * @param {Object} args liturgy and elements
 * @return {{subjects: Array, notifies: boolean}}
 */
function prayerNoticePlan(args) {
  const elements = (args && args.elements) || [];
  const notifies = elements.some((el) =>
    el && el.kind === "prayer" && el.requests && noticeDaysOf(el) > 0);
  return {subjects: pastoralSubjects(args), notifies};
}

/**
 * Church-local calendar day has moved past the service date.
 * @param {string} todayDate YYYY-MM-DD
 * @param {string} serviceDate YYYY-MM-DD
 * @return {boolean}
 */
function serviceDateHasEnded(todayDate, serviceDate) {
  return String(todayDate) > String(serviceDate);
}

/**
 * May this person open the prayer Answer page now? Link path: still a subject
 * and the service date has not ended. Signed-in without a link: also only from
 * five days out or once the initial text has gone.
 * @param {Object} state
 * @param {string} state.personId
 * @param {string} state.serviceDate
 * @param {string} state.todayDate church-local today
 * @param {?Object} state.liturgy prayerMale / prayerFemale
 * @param {boolean} state.viaAnswerLink
 * @param {?string} state.initialSentDate
 * @return {boolean}
 */
function mayAnswerPrayerRequest(state) {
  const s = state || {};
  const personId = s.personId;
  const serviceDate = s.serviceDate;
  const todayDate = s.todayDate;
  if (!personId || !serviceDate || !todayDate) return false;
  if (!isPastoralPrayerSubject(s.liturgy, personId, s.subjectIds)) return false;
  if (serviceDateHasEnded(todayDate, serviceDate)) return false;
  if (s.viaAnswerLink) return true;
  if (s.initialSentDate) return true;
  const noticeRaw = s.noticeDays == null ?
    INITIAL_DAYS_OUT : Number(s.noticeDays);
  const notice = Number.isFinite(noticeRaw) ? noticeRaw : INITIAL_DAYS_OUT;
  return daysUntil(serviceDate, todayDate) <= notice;
}

/**
 * What the Answer page may show. Elder-typed requests never leak Elder text.
 * @param {Object} args
 * @param {string} args.firstName
 * @param {string} args.serviceDate
 * @param {?Object} args.prayerRequest stored request doc fields
 * @return {Object}
 */
function prayerAnswerPageView(args) {
  const a = args || {};
  const req = a.prayerRequest && typeof a.prayerRequest === "object" ?
    a.prayerRequest : {};
  const source = req.prayerRequestSource || null;
  const text = String(req.prayerRequest || "").trim();
  const base = {
    firstName: firstNameOf(a.firstName) || "there",
    serviceDateLabel: formatServiceDate(a.serviceDate),
    privacyLine: PRAYER_ANSWER_PRIVACY_LINE,
    eldersAlreadyHaveIt: false,
    showAnswerBox: true,
    existingAnswer: null,
  };
  if (source === "elder" && text) {
    return Object.assign({}, base, {
      eldersAlreadyHaveIt: true,
      showAnswerBox: false,
    });
  }
  if ((source === "reply" || source === "form") && text) {
    return Object.assign({}, base, {existingAnswer: text});
  }
  return base;
}

/**
 * Create, update, or leave the generated Shepherding Note (ADR-0007).
 * @param {Object} args
 * @param {boolean} args.hadRequestBefore
 * @param {?string} args.noteId
 * @param {?string} args.noteText current note body, null when missing
 * @param {?string} args.noteGeneratedText snapshot from the request doc
 * @return {{action: string}}
 */
function prayerRequestNoteDecision(args) {
  const a = args || {};
  if (!a.hadRequestBefore) {
    return {action: "create"};
  }
  if (!a.noteId) {
    return {action: "leave"};
  }
  const generated = String(
      a.noteGeneratedText == null ? "" : a.noteGeneratedText,
  ).trim();
  const current = a.noteText == null ? null :
    String(a.noteText).trim();
  if (current === null || current === "") {
    return {action: "leave"};
  }
  if (current === generated) {
    return {action: "update"};
  }
  return {action: "leave"};
}

/**
 * Whether this subject can be told at all: a live device token or a phone.
 * A token with no phone is still reachable. Neither is not.
 * @param {Object} state hasPhone, hasDeviceToken
 * @return {boolean}
 */
function canBeTold(state) {
  return !!(state && (state.hasPhone || state.hasDeviceToken));
}

/**
 * The automatic (scheduler) decision: what ask, if any, to send a pastoral-
 * prayer subject right now.
 * @param {Object} state
 * @param {number} state.daysUntilService
 * @param {number} state.localHour church-local hour (0-23)
 * @param {boolean} state.hasPhone
 * @param {boolean} [state.hasDeviceToken]
 * @param {boolean} state.requestFilled request already provided
 * @param {?string} state.initialSentDate church-local date the initial went out
 * @param {boolean} state.reminderSent
 * @param {string} state.today church-local date (YYYY-MM-DD)
 * @return {'initial'|'reminder'|'none'}
 */
function prayerRequestAction(state) {
  const {
    daysUntilService,
    localHour,
    requestFilled,
    initialSentDate,
    reminderSent,
    today,
  } = state;

  if (!canBeTold(state)) return "none";
  if (requestFilled) return "none";
  if (daysUntilService < 0) return "none";
  if (!nc.isInsideSendWindow(localHour)) return "none";

  const noticeRaw = state.noticeDays == null ?
    INITIAL_DAYS_OUT : Number(state.noticeDays);
  const notice = Number.isFinite(noticeRaw) ? noticeRaw : INITIAL_DAYS_OUT;
  if (notice <= 0) return "none";
  const reminderRaw = state.reminderDays == null ?
    reminderDaysFor(notice) : Number(state.reminderDays);
  const reminder = Number.isFinite(reminderRaw) ?
    reminderRaw : REMINDER_DAYS_OUT;

  const initialSent = !!initialSentDate;
  if (!initialSent) {
    return daysUntilService <= notice ? "initial" : "none";
  }

  // The reminder sits closer than the first ask, and never on the same
  // church-local day the initial went out (late entries).
  if (!reminderSent &&
      daysUntilService <= reminder &&
      initialSentDate < today) {
    return "reminder";
  }
  return "none";
}

/**
 * Days already sent. An older record with no list still counts the first
 * ask and the reminder.
 * @param {Object} state
 * @param {Array<number>} list
 * @return {Set<number>}
 */
function sentNoticeDays(state, list) {
  const sent = new Set();
  const explicit = Array.isArray(state.sentDays) ? state.sentDays : [];
  if (explicit.length) {
    explicit.forEach((d) => {
      const n = Number(d);
      if (list.indexOf(n) !== -1) sent.add(n);
    });
    return sent;
  }
  if (state.initialSentDate && list.length) sent.add(list[0]);
  if (state.reminderSent && list.length > 1) sent.add(list[1]);
  return sent;
}

/**
 * Which listed day to send now, and whether it is the first ask.
 * One send per church-local day. A list walks each day in turn.
 * Without a list, the older single notice and its reminder stand.
 * @param {Object} state
 * @return {{action: string, day: ?number}}
 */
function prayerAskPlan(state) {
  const s = state || {};
  const list = Array.isArray(s.noticeList) ? s.noticeList : null;
  if (!list) {
    const action = prayerRequestAction(s);
    if (action === "none") return {action: "none", day: null};
    const noticeRaw = Number(s.noticeDays);
    const notice = Number.isFinite(noticeRaw) ?
      noticeRaw : INITIAL_DAYS_OUT;
    const reminder = s.reminderDays == null ?
      reminderDaysFor(notice) : Number(s.reminderDays);
    return {action, day: action === "reminder" ? reminder : notice};
  }
  if (!canBeTold(s) || s.requestFilled) {
    return {action: "none", day: null};
  }
  if (s.daysUntilService < 0) return {action: "none", day: null};
  if (!nc.isInsideSendWindow(s.localHour)) {
    return {action: "none", day: null};
  }
  const days = list.filter((n) => Number(n) > 0);
  if (!days.length) return {action: "none", day: null};
  const sent = sentNoticeDays(s, days);
  const last = s.reminderSentDate || s.initialSentDate || null;
  if (last && last === s.today) return {action: "none", day: null};
  const due = days.filter((d) => s.daysUntilService <= d && !sent.has(d));
  if (!due.length) return {action: "none", day: null};
  const day = Math.max.apply(null, due);
  return {action: sent.size ? "reminder" : "initial", day};
}

/**
 * The manual ("Send now") decision: a human is choosing to send now, so the
 * timing/quiet-hours guards are bypassed, but the hard guards remain — refuse
 * when nobody can be reached, or the request is already filled. Initial if
 * none sent yet, reminder once it has (a repeat click re-sends the reminder
 * as a deliberate nudge).
 * @param {Object} state
 * @param {boolean} state.hasPhone
 * @param {boolean} [state.hasDeviceToken]
 * @param {boolean} state.requestFilled
 * @param {?string} state.initialSentDate
 * @param {boolean} state.reminderSent
 * @return {'initial'|'reminder'|'none'}
 */
function manualPrayerRequestKind(state) {
  const {requestFilled, initialSentDate} = state;
  if (!canBeTold(state)) return "none";
  if (requestFilled) return "none";
  return initialSentDate ? "reminder" : "initial";
}

/**
 * What the send path should be asked for this ask. The reminder escalates:
 * the first ask may not have landed, so this one takes the other route.
 * @param {'initial'|'reminder'|'none'} action
 * @return {?{purpose: string, wording: string, escalate: boolean}}
 */
function prayerNotifyRequest(action) {
  if (action !== "initial" && action !== "reminder") return null;
  return {
    purpose: "prayer_request",
    wording: action,
    escalate: action === "reminder",
  };
}

/**
 * The URL a prayer ask leads to. MS-247 mints the Answer link and passes it
 * in. Until then this returns null rather than inventing /a/<token>.
 * @param {?string} url
 * @return {?string}
 */
function prayerAskUrl(url) {
  if (typeof url === "string" && url.trim()) return url.trim();
  return null;
}

/**
 * Minimal TipTap/ProseMirror document wrapping a line of plain text, matching
 * the shape a Shepherding Note's contentJson takes.
 * @param {string} text
 * @return {Object}
 */
function tiptapFromText(text) {
  const value = typeof text === "string" ? text : "";
  const paragraph = {type: "paragraph"};
  if (value) {
    paragraph.content = [{type: "text", text: value}];
  }
  return {type: "doc", content: [paragraph]};
}

/**
 * Builds the core "Prayer Request" Shepherding Note payload from a reply. The
 * caller adds author and timestamp fields before writing.
 * @param {{personName: string, serviceDate: string, requestText: string}} args
 * @return {Object} type, subject, content, contentJson
 */
function buildPrayerRequestNote(args) {
  const {serviceDate, requestText} = args;
  const text = (requestText || "").trim();
  return {
    type: "Prayer Request",
    subject: `Prayer Request — ${serviceDate}`,
    content: text,
    contentJson: tiptapFromText(text),
  };
}

/**
 * Decides whether the elder digest should be sent after a Prayer Request write.
 * Fires only when every designated subject is now filled, the write that
 * completed the set came by text reply, and the set was not already complete
 * before this write (so manual fills and later edits never trigger it).
 * @param {Object} args
 * @param {Array} args.subjectStates one per designated subject, each
 *   {filled}
 * @param {?string} args.changedSource prayerRequestSource of the
 *   just-written doc
 * @param {boolean} args.wasCompleteBefore all subjects filled before
 *   this write
 * @return {boolean}
 */
function elderDigestDecision({
  subjectStates, changedSource, wasCompleteBefore,
}) {
  if (!Array.isArray(subjectStates) || subjectStates.length === 0) return false;
  if (!subjectStates.every((s) => s && s.filled)) return false;
  if (wasCompleteBefore) return false;
  return changedSource === "reply" || changedSource === "form";
}

const DIGEST_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DIGEST_WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/**
 * Renders a YYYY-MM-DD service date as a friendly "Weekday, Month D, YYYY".
 * Computed in UTC so it is deterministic regardless of host timezone.
 * @param {string} serviceDate
 * @return {string}
 */
function formatServiceDate(serviceDate) {
  const [y, m, d] = String(serviceDate || "").split("-").map(Number);
  if (!y || !m || !d) return String(serviceDate || "");
  const weekday = DIGEST_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${DIGEST_MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * Renders the elder digest: substitutes {date} with the friendly service date
 * and {requests} with one "Name — request" line per filled subject.
 * @param {string} [template]
 * @param {Object} data serviceDate and subjects (name, request)
 * @return {string}
 */
function renderElderDigest(template, data) {
  const tpl = (typeof template === "string" && template) ?
    template : DEFAULT_PRAYER_MESSAGES.elderDigest;
  const {serviceDate, subjects} = data;
  const requests = (subjects || [])
      .map((s) => `${s.name} — ${s.request}`)
      .join("\n");
  return tpl
      .split("{date}").join(formatServiceDate(serviceDate))
      .split("{requests}").join(requests);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CHURCH_TIMEZONE,
    INITIAL_DAYS_OUT,
    REMINDER_DAYS_OUT,
    WINDOW_OPEN_HOUR,
    WINDOW_CLOSE_HOUR,
    DEFAULT_PRAYER_MESSAGES,
    DEFAULT_PUSH_WORDING,
    PUSH_WORDING_KINDS,
    PRAYER_ANSWER_PRIVACY_LINE,
    pushConfigKey,
    firstNameOf,
    resolveTemplates,
    resolvePushWording,
    renderPrayerRequestMessage,
    ensureAnswerLinkInTemplate,
    templatesWithAnswerLink,
    churchDateParts,
    daysUntil,
    isPastoralPrayerSubject,
    noticeDaysOf,
    noticeListOf,
    messageWithLink,
    reminderDaysFor,
    pastoralSubjects,
    prayerNoticePlan,
    serviceDateHasEnded,
    mayAnswerPrayerRequest,
    prayerAnswerPageView,
    prayerRequestNoteDecision,
    prayerRequestAction,
    prayerAskPlan,
    manualPrayerRequestKind,
    prayerNotifyRequest,
    prayerAskUrl,
    tiptapFromText,
    buildPrayerRequestNote,
    elderDigestDecision,
    formatServiceDate,
    renderElderDigest,
  };
}
