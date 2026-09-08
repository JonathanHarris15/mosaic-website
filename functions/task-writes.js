/**
 * Every write that changes a Task (MS-79).
 *
 * The page and the assistant both come through here, so the rules exist once.
 * That is the lesson MS-409 already learned for the other shepherding writes:
 * a rule enforced in the browser is a rule the assistant does not have.
 *
 * WHAT IS STORED, AND WHAT IS NOT (ADR-0060). `shepherding_tasks` holds a
 * one-off Task and the standing commitment behind a repeating one — the same
 * collection, because a series IS a Task that happens more than once. A repeat's
 * dates are never written down. `shepherding_task_occurrences` holds only the
 * dates something has been SAID about: ticked, skipped, reassigned, nudged, or
 * given words of their own. A month nobody did has no document at all, and is
 * overdue because the rule produced its date and nothing answered.
 *
 * WHAT AN OCCURRENCE MAY OVERRIDE. Title, body, assignees, time, and the day
 * itself — nothing else, and never the recurrence. "Rob takes this month" is a
 * real need; "repeat differently, but only in March" is not a thing a person
 * means. Same rule an Event occurrence obeys, so elders learn it once.
 *
 * WHO CAN BE GIVEN ONE (ADR-0059). Assignees are Elders, checked against the
 * Elder Tag rather than the directory. Handing a Task to somebody who cannot
 * open the page is a Task nobody will ever do, so it is refused at the door
 * rather than accepted and quietly lost. There is deliberately NO field for the
 * people a Task is about: a Person named in the body is a cross-reference,
 * which is prose.
 *
 * WHO CAN CHANGE ONE. Any elder, anything, including somebody else's. The
 * elders are few and trust each other, and a Task locked to a man on holiday is
 * worse than an accidental tick. Nothing here checks ownership on purpose.
 */

// ⚠ THE FIRESTORE SENTINELS ARE PASSED IN, NEVER REACHED FOR — `functions/`
// carries its own node_modules, so a require("firebase-admin") here would be a
// different copy from whatever made the Firestore handle. Same convention the
// other write modules follow.
const F = require("./mcp-firestore.js");

const TasksCore = require("./shared/tasks-core.js");
const EventsCore = require("./shared/events-occurrence-core.js");
const Actor = require("./mcp-actor.js");
const {refuse, loadPerson} = require("./shepherding-writes.js");
const {ELDER_TAG} = require("./elder-sync.js");

const TASKS = "shepherding_tasks";
const OCCURRENCES = "shepherding_task_occurrences";

// How far either side of today the page and the tools resolve a repeat. Wide
// enough that a yearly glance back and a season forward both work, bounded so a
// rule with no end never asks for infinity.
const LOOK_BACK_DAYS = 365;
const LOOK_AHEAD_DAYS = 180;

const isDateStr = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const isTimeStr = (v) => /^\d{2}:\d{2}$/.test(String(v || ""));

// ── Reading what a caller gave us ──────────────────────────────────────────

/**
 * A Task's title, or a refusal. A Task with nothing to say is not a Task.
 * @param {string} title what the caller sent
 * @return {string} the trimmed title
 */
function titleOf(title) {
  const label = String(title || "").trim();
  if (!label) throw refuse("A task needs something to say.");
  return label;
}

/**
 * A due date, or a refusal.
 *
 * ⚠ REQUIRED, ALWAYS (ADR-0058). Without a date there is no overdue, and
 * overdue is the whole point — an undated list grows forever and nobody prunes
 * it. A TIME on the date is optional, because "ring Dave on Thursday" is what
 * an elder means and forcing 5pm onto it makes the list slightly false.
 * @param {string} due YYYY-MM-DD
 * @return {string} the same date, once it is one
 */
function dueDateOf(due) {
  if (!isDateStr(due)) {
    throw refuse(
        `"${due}" is not a date. A task needs one — give it as YYYY-MM-DD. ` +
        "Without a date nothing can ever read as overdue.");
  }
  return due;
}

/**
 * A time of day, or null. Never a refusal: absent is the ordinary case.
 * @param {string} time HH:MM
 * @return {string|null} the time, or null
 */
function dueTimeOf(time) {
  if (time === undefined || time === null || time === "") return null;
  if (!isTimeStr(time)) {
    throw refuse(`"${time}" is not a time of day. Use HH:MM, or leave it out.`);
  }
  return String(time);
}

/**
 * The elders a Task is being given to, each one checked.
 *
 * An empty list is a real answer, not a missing one: nobody has picked this up,
 * and the dashboard shows it to everybody because of that.
 * @param {object} db the Firestore handle
 * @param {Array<string>} assigneeIds Person ids
 * @return {Promise<Array<string>>} the same ids, once every one is an Elder
 */
async function assigneesOf(db, assigneeIds) {
  const ids = Array.isArray(assigneeIds) ? assigneeIds.filter(Boolean) : [];
  const checked = [];
  for (const personId of ids) {
    const person = await loadPerson(db, personId);
    const tags = person.data.tags || [];
    if (tags.indexOf(ELDER_TAG) === -1) {
      throw refuse(
          `${person.data.name || personId} is not an elder, so a task cannot ` +
          "be given to them — they would never see it. Tasks are elder-only.");
    }
    if (checked.indexOf(personId) === -1) checked.push(personId);
  }
  return checked;
}

/**
 * A recurrence rule, or null for a one-off.
 *
 * The vocabulary is the Calendar's, read off the shared core rather than
 * restated here, so "fortnightly" cannot come to mean two things in one app.
 * @param {object} recurrence freq, startDate, ends
 * @return {object|null} the rule, or null
 */
function recurrenceOf(recurrence) {
  if (!recurrence) return null;
  const freq = String(recurrence.freq || "");
  const allowed = [TasksCore.FREQ.WEEKLY, TasksCore.FREQ.FORTNIGHTLY, TasksCore.FREQ.MONTHLY];
  if (allowed.indexOf(freq) === -1) {
    throw refuse(
        `"${freq}" is not a repeat this app knows. Use weekly, fortnightly ` +
        "or monthly.");
  }
  if (!isDateStr(recurrence.startDate)) {
    throw refuse("A repeat needs a first date, as YYYY-MM-DD.");
  }

  const ends = recurrence.ends || {};
  const kind = String(ends.kind || TasksCore.ENDS.NEVER);
  const endKinds = [TasksCore.ENDS.NEVER, TasksCore.ENDS.ON_DATE, TasksCore.ENDS.AFTER_COUNT];
  if (endKinds.indexOf(kind) === -1) {
    throw refuse(`"${kind}" is not a way for a repeat to stop.`);
  }
  if (kind === TasksCore.ENDS.ON_DATE && !isDateStr(ends.date)) {
    throw refuse("A repeat ending on a date needs the date, as YYYY-MM-DD.");
  }
  if (kind === TasksCore.ENDS.AFTER_COUNT && !(Number(ends.count) > 0)) {
    throw refuse("A repeat ending after a count needs how many times.");
  }

  return {
    freq: freq,
    startDate: recurrence.startDate,
    ends: kind === TasksCore.ENDS.ON_DATE ? {kind, date: ends.date}
      : kind === TasksCore.ENDS.AFTER_COUNT ? {kind, count: Number(ends.count)}
        : {kind: TasksCore.ENDS.NEVER},
  };
}

// ── Loading ─────────────────────────────────────────────────────────────────

/**
 * The Task, or a refusal naming the id that was not found.
 * @param {object} db the Firestore handle
 * @param {string} taskId the id
 * @return {Promise<object>} { ref, data }
 */
async function loadTask(db, taskId) {
  if (!taskId) throw refuse("No task id was given.");
  const ref = db.collection(TASKS).doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) throw refuse(`No task with id "${taskId}".`);
  return {ref, data: snap.data() || {}};
}

/**
 * The occurrence record for one date of a repeat, minting it if this is the
 * first thing anybody has said about that date.
 *
 * ⚠ THE ID IS DERIVED FROM THE SERIES AND THE DATE, never auto-generated, so
 * two elders ticking the same month at the same moment write one document
 * rather than two of it. The same guard an Event occurrence uses.
 * @param {object} db the Firestore handle
 * @param {object} task the series
 * @param {string} date the date being spoken about
 * @return {object} the document reference
 */
function occurrenceRef(db, task, date) {
  if (!task.recurrence) {
    throw refuse("That task does not repeat, so it has no separate dates.");
  }
  if (!isDateStr(date)) {
    throw refuse(`"${date}" is not a date. Give the date of the one you mean.`);
  }
  return db.collection(OCCURRENCES).doc(TasksCore.occurrenceIdFor(task.id || task.taskId, date));
}

/**
 * Write to one date of a repeat, or to the Task itself when it does not repeat.
 *
 * This is the one place the two shapes meet. Ticking a one-off writes the Task;
 * ticking one month of a repeat writes that month's record and leaves every
 * other month exactly as it was.
 * @param {object} db the Firestore handle
 * @param {string} taskId which Task
 * @param {string} date which date, for a repeat
 * @param {object} patch the fields to set
 * @return {Promise<object>} { taskId, date, repeats }
 */
async function writeToDate(db, taskId, date, patch) {
  const {ref, data} = await loadTask(db, taskId);

  if (!data.recurrence) {
    await ref.update(Object.assign({}, patch, Actor.provenance()));
    return {taskId, date: data.dueDate || null, repeats: false};
  }

  const occRef = occurrenceRef(db, Object.assign({id: taskId}, data), date);
  await occRef.set(Object.assign({
    seriesId: taskId,
    date: date,
  }, patch, Actor.provenance()), {merge: true});
  return {taskId, date, repeats: true};
}

// ── Writing ─────────────────────────────────────────────────────────────────

/**
 * A new Task — a one-off, or a standing commitment when a recurrence is given.
 * @param {object} db the Firestore handle
 * @param {object} args title, body, due, dueTime, assigneeIds, recurrence, actor
 * @return {Promise<object>} { ok, taskId, title, due, repeats, nextDates }
 */
async function createTask(db, {title, body, due, dueTime, assigneeIds, recurrence, actor}) {
  const label = titleOf(title);
  const rule = recurrenceOf(recurrence);
  const assignees = await assigneesOf(db, assigneeIds);

  // A repeat's first date IS its due date — the rule owns the calendar, so
  // storing a second one would let the two disagree.
  const dueDate = rule ? dueDateOf(rule.startDate) : dueDateOf(due);

  const ref = await db.collection(TASKS).add(Object.assign({
    title: label,
    body: String(body || ""),
    dueDate: dueDate,
    dueTime: dueTimeOf(dueTime),
    assigneeIds: assignees,
    recurrence: rule,
    completedAt: null,
    completedBy: null,
    createdBy: actor.uid,
    createdByName: actor.name,
    createdAt: F.now(),
  }, Actor.provenance()));

  return {
    ok: true,
    taskId: ref.id,
    title: label,
    due: dueDate,
    repeats: !!rule,
    // ⚠ A RULE DICTATED IN CONVERSATION IS EASY TO GET SUBTLY WRONG. "Every
    // other month" is ambiguous, and the mistake otherwise surfaces as a date
    // quietly missing three months later — so the dates come straight back.
    nextDates: rule ? upcomingDates(rule, 4) : [],
  };
}

/**
 * The next few dates a rule produces, for reading back to whoever set it.
 * @param {object} rule the recurrence
 * @param {number} howMany at most this many
 * @return {Array<string>} dates
 */
function upcomingDates(rule, howMany) {
  const from = TasksCore.dayOf(Date.now());
  const to = TasksCore.dayOf(Date.now() + LOOK_AHEAD_DAYS * 86400000);
  return EventsCore.datesBetween(rule, from, to).slice(0, howMany || 4);
}

/**
 * Change a Task, or one date of a repeating one.
 *
 * ⚠ WITH NO DATE, THIS EDITS THE WHOLE COMMITMENT. With one, it edits that date
 * alone. The recurrence itself is only ever changed on the series — a date
 * cannot repeat differently from the thing it is a date of.
 * @param {object} db the Firestore handle
 * @param {object} args taskId, date, title, body, dueTime, assigneeIds, recurrence
 * @return {Promise<object>} what changed
 */
async function editTask(db, {taskId, date, title, body, dueTime, assigneeIds, recurrence}) {
  const {ref} = await loadTask(db, taskId);
  const patch = {};

  if (title !== undefined) patch.title = titleOf(title);
  if (body !== undefined) patch.body = String(body || "");
  if (dueTime !== undefined) patch.dueTime = dueTimeOf(dueTime);
  if (assigneeIds !== undefined) patch.assigneeIds = await assigneesOf(db, assigneeIds);

  if (date) {
    if (recurrence !== undefined) {
      throw refuse(
          "A repeat is changed on the task itself, never on one of its dates " +
          "— one date cannot repeat differently from the rest.");
    }
    if (!Object.keys(patch).length) return {ok: true, taskId, date, changed: []};
    const out = await writeToDate(db, taskId, date, patch);
    return Object.assign({ok: true, changed: Object.keys(patch)}, out);
  }

  if (recurrence !== undefined) {
    patch.recurrence = recurrenceOf(recurrence);
    if (patch.recurrence) patch.dueDate = dueDateOf(patch.recurrence.startDate);
  }
  if (!Object.keys(patch).length) return {ok: true, taskId, changed: []};

  await ref.update(Object.assign(patch, Actor.provenance()));
  return {ok: true, taskId, changed: Object.keys(patch)};
}

/**
 * Move a Task to a different day.
 *
 * On a repeat this NUDGES one date and leaves the pattern alone — one awkward
 * week does not break a standing commitment.
 * @param {object} db the Firestore handle
 * @param {object} args taskId, date, to
 * @return {Promise<object>} where it went
 */
async function moveTask(db, {taskId, date, to}) {
  const when = dueDateOf(to);
  const {ref, data} = await loadTask(db, taskId);

  if (!data.recurrence) {
    await ref.update(Object.assign({dueDate: when}, Actor.provenance()));
    return {ok: true, taskId, movedTo: when, repeats: false};
  }
  const out = await writeToDate(db, taskId, date, {movedTo: when});
  return Object.assign({ok: true, movedTo: when}, out);
}

/**
 * Mark a Task done.
 *
 * ⚠ DONE IS KEPT, NEVER DELETED (ADR-0058). A tick that erased the evidence
 * would mean nobody could ever say what the elders actually did.
 * @param {object} db the Firestore handle
 * @param {object} args taskId, date, actor
 * @return {Promise<object>} what was finished
 */
async function completeTask(db, {taskId, date, actor}) {
  const out = await writeToDate(db, taskId, date, {
    completedAt: F.now(),
    completedBy: (actor && actor.uid) || null,
    completedByName: (actor && actor.name) || "",
    skippedAt: null,
  });
  return Object.assign({ok: true}, out);
}

/**
 * Un-tick a Task, for the wrong one ticked.
 * @param {object} db the Firestore handle
 * @param {object} args taskId, date
 * @return {Promise<object>} what was reopened
 */
async function reopenTask(db, {taskId, date}) {
  const out = await writeToDate(db, taskId, date, {
    completedAt: null,
    completedBy: null,
    completedByName: "",
  });
  return Object.assign({ok: true}, out);
}

/**
 * Stand one date of a repeat down without claiming it was done.
 *
 * ⚠ A SKIP IS NOT A TICK. December, because it is Christmas, is not work that
 * happened — and if elders learn to mark things done that were not, the
 * completed list stops meaning anything.
 * @param {object} db the Firestore handle
 * @param {object} args taskId, date, actor
 * @return {Promise<object>} what was skipped
 */
async function skipOccurrence(db, {taskId, date, actor}) {
  const {data} = await loadTask(db, taskId);
  if (!data.recurrence) {
    throw refuse(
        "Only a date of a repeating task can be skipped. A one-off is either " +
        "done or deleted.");
  }
  const out = await writeToDate(db, taskId, date, {
    skippedAt: F.now(),
    skippedBy: (actor && actor.uid) || null,
    completedAt: null,
  });
  return Object.assign({ok: true}, out);
}

/**
 * Stop a repeat, or delete a Task outright.
 *
 * ⚠ STOPPING AND ERASING ARE DIFFERENT INTENTIONS, and only one of them is
 * ever asked for. A repeat with finished occurrences behind it is STOPPED: no
 * more dates, and every record of the times it was kept survives. A Task
 * nothing has happened to is deleted, because it was a mistake, not history.
 * @param {object} db the Firestore handle
 * @param {object} args taskId
 * @return {Promise<object>} whether it was stopped or deleted
 */
async function deleteTask(db, {taskId}) {
  const {ref, data} = await loadTask(db, taskId);
  const title = data.title || "";

  if (data.recurrence) {
    const done = await db.collection(OCCURRENCES)
        .where("seriesId", "==", taskId).get();
    const kept = done.docs.filter((d) => (d.data() || {}).completedAt).length;
    if (kept) {
      await ref.update(Object.assign({
        stoppedOn: TasksCore.dayOf(Date.now()),
      }, Actor.provenance()));
      return {ok: true, taskId, title, stopped: true, keptRecords: kept};
    }
    // Nothing was ever done under it, so there is no history to protect.
    for (const doc of done.docs) await doc.ref.delete();
  }

  await ref.delete();
  return {ok: true, taskId, title, stopped: false};
}

// ── Reading, for the tools and the page ─────────────────────────────────────

/**
 * Every Task there is, resolved — one-offs and every date of every repeat.
 *
 * The window bounds the COMPUTED dates only. A one-off is a stored row and is
 * already the answer, so it is never windowed out: hiding an overdue task from
 * six weeks ago is the one thing this feature exists to stop.
 * @param {object} db the Firestore handle
 * @param {object} opts now
 * @return {Promise<Array<object>>} resolved Tasks
 */
async function resolveAll(db, opts) {
  const now = (opts && opts.now) || Date.now();
  const [taskSnap, occSnap] = await Promise.all([
    db.collection(TASKS).get(),
    db.collection(OCCURRENCES).get(),
  ]);

  const rows = taskSnap.docs.map((d) => Object.assign({id: d.id}, d.data()));
  return TasksCore.resolve({
    tasks: rows.filter((t) => !t.recurrence),
    series: rows.filter((t) => t.recurrence),
    occurrences: occSnap.docs.map((d) => Object.assign({id: d.id}, d.data())),
    now: now,
    from: TasksCore.dayOf(now - LOOK_BACK_DAYS * 86400000),
    to: TasksCore.dayOf(now + LOOK_AHEAD_DAYS * 86400000),
  });
}

/**
 * What is outstanding — everything not finished and not stood down.
 * @param {object} db the Firestore handle
 * @return {Promise<object>} { count, tasks }
 */
async function listTasks(db) {
  const all = await resolveAll(db);
  const open = all.filter((t) => t.state === TasksCore.STATES.OPEN ||
    t.state === TasksCore.STATES.OVERDUE);
  return {
    count: open.length,
    overdue: open.filter((t) => t.state === TasksCore.STATES.OVERDUE).length,
    tasks: open.map((t) => ({
      taskId: t.seriesId || t.id,
      date: t.dueDate,
      title: t.title,
      due: t.dueDate + (t.dueTime ? " " + t.dueTime : ""),
      state: t.state,
      repeats: !!t.seriesId,
      assigneeIds: t.assigneeIds,
      unassigned: t.isUnassigned,
    })),
  };
}

module.exports = {
  TASKS,
  OCCURRENCES,
  LOOK_BACK_DAYS,
  LOOK_AHEAD_DAYS,
  createTask,
  editTask,
  moveTask,
  completeTask,
  reopenTask,
  skipOccurrence,
  deleteTask,
  resolveAll,
  listTasks,
  upcomingDates,
};
