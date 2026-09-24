/**
 * @fileoverview Event-announcement tell scheduler logic (MS-623 / MS-680).
 *
 * Loads told plans, expands due moments, resolves audience, calls the one
 * Notification send path when present, and records sent markers. Every I/O
 * surface is injected so unit tests need no Firebase.
 */

const Ann = require("./shared/event-announcement-core.js");
const Tell = require("./shared/event-tell-core.js");

/** @type {number} */
const WINDOW_OPEN_HOUR = 8;

/** @type {number} */
const WINDOW_CLOSE_HOUR = 20;

/**
 * Whether the hourly job may run at this church-local hour.
 * @param {number} localHour
 * @return {boolean}
 */
function jobMayRun(localHour) {
  return typeof localHour === "number" &&
    localHour >= WINDOW_OPEN_HOUR &&
    localHour < WINDOW_CLOSE_HOUR;
}

/**
 * @param {string} id announcement id
 * @param {Object} words announcements/{id} words record
 * @param {Object} goingOut announcements_going_out/{id}
 * @return {?Object}
 */
function joinedAnnouncement(id, words, goingOut) {
  if (!words || !goingOut || goingOut.way !== Ann.TOLD) return null;
  const joined = Ann.joined(id, words, goingOut);
  if (joined.way !== Ann.TOLD) return null;
  return joined;
}

/**
 * One send attempt for a person at a moment.
 * @param {Object} deps
 * @param {Object} args
 * @return {Promise<Object>}
 */
async function sendOne(deps, args) {
  const markerId = Tell.ledgerId(
      args.announcementId, args.moment.date, args.moment.time, args.personId);
  if (await deps.hasSentMarker(markerId)) {
    return {sent: false, skipped: "already_sent"};
  }
  if (!Tell.isReachable(args.person)) {
    return {sent: false, skipped: "unreachable"};
  }

  const request = Tell.notifyRequest({
    personId: args.personId,
    firstName: args.firstName,
    title: args.title,
    prose: args.prose,
    url: args.url,
  });

  const tellPerson = deps.tellPerson;
  if (!tellPerson) {
    return {sent: false, skipped: "notification_path_absent"};
  }

  const result = await tellPerson(deps.notifierDeps, request);
  if (!result || !result.accepted) {
    const skipped = result && result.unreachable ?
      "unreachable" : "send_failed";
    return {sent: false, skipped};
  }
  await deps.writeSentMarker(markerId, {
    announcementId: args.announcementId,
    momentDate: args.moment.date,
    momentTime: args.moment.time,
    personId: args.personId,
    occurrenceDate: args.moment.occurrenceDate || null,
    purpose: Tell.PURPOSE,
  });
  return {sent: true};
}

/**
 * Process one parent (series or occurrence) that may carry told announcements.
 * @param {Object} deps
 * @param {Object} parent
 * @return {Promise<number>} sends accepted
 */
async function processParent(deps, parent) {
  const wordsList = await deps.loadWords(parent);
  const goingOutList = await deps.loadGoingOut(parent);
  const goingById = {};
  goingOutList.forEach((row) => {
    goingById[row.id] = row.data;
  });

  const people = await deps.loadPeople();
  const now = deps.now();
  let sent = 0;

  for (const wordsRow of wordsList) {
    const announcement = joinedAnnouncement(
        wordsRow.id, wordsRow.data, goingById[wordsRow.id]);
    if (!announcement) continue;

    const moments = Tell.upcomingTellMoments({
      eventKind: parent.eventKind,
      goingOut: {
        way: Ann.TOLD,
        dates: announcement.dates,
        daysBefore: announcement.daysBefore,
        time: announcement.time,
      },
      seriesId: parent.seriesId,
      rule: parent.rule,
      stored: parent.stored,
      now,
    });
    const due = Tell.momentsDueThisTick(moments, now, Tell.TICK_MS);
    if (!due.length) continue;

    const audience = Tell.audienceAtSendTime({
      tagIds: announcement.tagIds,
      people,
    });

    for (const moment of due) {
      const occurrenceId = await deps.resolveOccurrenceId(parent, moment);
      if (!occurrenceId) continue;
      const url = Tell.eventPageUrl(deps.baseUrl, occurrenceId);
      for (const person of audience) {
        const outcome = await sendOne(deps, {
          announcementId: wordsRow.id,
          moment,
          personId: person.id,
          person,
          firstName: person.firstName || person.name,
          title: announcement.title,
          prose: announcement.prose,
          url,
        });
        if (outcome.sent) sent += 1;
      }
    }
  }
  return sent;
}

/**
 * Hourly tick — returns how many Notifications were accepted.
 * @param {Object} deps
 * @return {Promise<{ran: boolean, sent: number}>}
 */
async function runEventTellTick(deps) {
  const now = deps.now();
  const parts = Tell.churchNowParts(now);
  if (!jobMayRun(parts.hour)) {
    return {ran: false, sent: 0};
  }

  const parents = await deps.loadTellParents();
  let sent = 0;
  for (const parent of parents) {
    sent += await processParent(deps, parent);
  }
  return {ran: true, sent};
}

module.exports = {
  WINDOW_OPEN_HOUR,
  WINDOW_CLOSE_HOUR,
  jobMayRun,
  joinedAnnouncement,
  runEventTellTick,
  sendOne,
  processParent,
};
