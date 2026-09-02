// The door a public form is served and answered through (MS-360, ADR-0051).
//
// Pure decision logic: what may this caller see, and may this submission be
// written. The callable in index.js wraps these with reads and writes; the
// judgements live here so they can be unit-tested without Firestore.
//
// ⚠ WHY THE SERVER DECIDES AT ALL. A public form is answerable by somebody with
// no Mosaic account, and `firestore.rules` grants that person nothing — see the
// forms blocks there, and the isSignedIn() comment above them. The alternative
// was marking public forms world-readable, which is the exact shape of MS-197
// and would additionally make every public form enumerable. So this is not a
// convenience layer over the rules; it is the only way in, and everything the
// rules would have said has to be said here instead.
//
// This file deliberately does NOT import public/forms-core.js by path —
// Cloud Functions deploy only the functions/ directory. It requires the copy in
// functions/shared/, which scripts/sync-shared-to-functions.js keeps in step and
// test/functions-shared-sync.test.js fails on when stale.

const FormsCore = require("./shared/forms-core");

// The permission ladder, mirroring the isMember()/isEditor()/isElder() helpers
// in firestore.rules. Restated rather than shared because the rules language
// cannot export anything — the same trade ADR-0046 already accepted, and
// test/forms-public.test.js pins the two together.
const RANKS_AT_OR_ABOVE = {
  member: ["member", "editor", "admin", "elder", "super_admin"],
  editor: ["editor", "admin", "elder", "super_admin"],
  elder: ["elder", "super_admin"],
};

/**
 * Does this caller's permission level satisfy the form's rung?
 * @param {?string} rung The form's answering rung.
 * @param {?string} rank The caller's permissionLevel, or null when signed out.
 * @return {boolean} True when they may answer.
 */
function rankSatisfies(rung, rank) {
  if (rung === "public") return true;
  const allowed = RANKS_AT_OR_ABOVE[rung];
  if (!allowed) return false;
  return allowed.indexOf(rank) !== -1;
}

// ── Handing out the questions ────────────────────────────────────────────────

/**
 * What an answerer is given when they open a form's link.
 *
 * ⚠ THIS IS THE ONLY THING THAT LEAVES. Not the stored record — a Form Template
 * carries who wrote it, when it was last saved, and (in the collection beside
 * it) every answer anybody has given. An answerer gets the title, the questions
 * they are being asked, and the sentence the form promises them. Returning the
 * document and trusting a screen not to draw the rest is how the extra fields
 * get read by whoever opens dev tools.
 *
 * @param {!Object} form The stored Form Template.
 * @return {!Object} The answerer's view of it.
 */
function answerersView(form) {
  const view = {
    title: form.title,
    description: form.description || "",
    questions: FormsCore.askedQuestions(form).map((q) => {
      const out = {
        id: q.id,
        type: q.type,
        text: q.text,
        hint: q.hint || "",
        placeholder: q.placeholder || "",
        required: q.required,
      };
      if (FormsCore.hasOptions(q.type)) out.options = (q.options || []).slice();
      return out;
    }),
    rung: form.rung,
    // Whether their name will be recorded. They are entitled to know which of
    // the two promises this form is making before they answer it.
    attribution: form.attribution === true,
  };
  if (FormsCore.isBallot(form)) {
    view.ballot = true;
    view.promise = FormsCore.BALLOT_PROMISE;
  }
  return view;
}

/**
 * May this caller open this form, and what do they get.
 *
 * @param {?Object} form The stored Form Template, or null when there is none.
 * @param {!Object} caller {signedIn, rank}.
 * @param {string} today The church's today, as YYYY-MM-DD.
 * @return {!Object} {ok, view} or {ok:false, code, message, closedOn?}.
 */
function whatToServe(form, caller, today) {
  const c = caller || {};

  // ⚠ A MISSING FORM AND AN UNPUBLISHED ONE ANSWER IDENTICALLY. Saying "that
  // form exists but is not published yet" to an unauthenticated caller turns
  // this endpoint into an oracle: guess ids, and the different answers tell you
  // which ones are real. The whole point of a 128-bit id is that guessing
  // fails, and it fails silently.
  if (!form || !form.published) {
    return {ok: false, code: "not-found", message: "There is no form here."};
  }

  // The rung is asked BEFORE the closing date, so a member-only form does not
  // tell a stranger when it closed. What it is called and when it shut are
  // still things about a form they were never allowed to see.
  if (!rankSatisfies(form.rung, c.signedIn ? c.rank : null)) {
    if (!c.signedIn) {
      return {
        ok: false,
        code: "sign-in-required",
        message: "Sign in to answer this form.",
      };
    }
    return {
      ok: false,
      code: "permission-denied",
      message: "This form is not open to you.",
    };
  }

  if (FormsCore.isClosed(form, today)) {
    // Closed is the one refusal that says more rather than less: whoever holds
    // this link was invited, and a working link that renders as "not found"
    // reads as broken and generates a phone call. They get the title and the
    // date, and never the questions or the tally.
    return {
      ok: false,
      code: "closed",
      message: "This form is closed.",
      title: form.title,
      closedOn: form.closingDate || null,
    };
  }

  return {ok: true, view: answerersView(form)};
}

// ── Taking the answer ────────────────────────────────────────────────────────

/**
 * May this submission be written, and what should be written.
 *
 * @param {?Object} form The stored Form Template.
 * @param {!Object} attempt {answers, signedIn, rank, personId, alreadyAnswered}.
 * @param {string} today The church's today, as YYYY-MM-DD.
 * @return {!Object} {ok, response, ledger, replaces} or {ok:false, code, ...}.
 */
function judgeSubmission(form, attempt, today) {
  const a = attempt || {};

  // Every reason the form could not be OPENED is a reason it cannot be
  // answered, asked in the same order and worded the same way. Two lists would
  // drift, and the pair that drifted would be "you may read this" and "you may
  // write this", which is the pair it matters most about.
  const serve = whatToServe(form, a, today);
  if (!serve.ok) return serve;

  const missing = FormsCore.missingRequired(form, a.answers);
  if (missing.length) {
    return {
      ok: false,
      code: "incomplete",
      message: missing.length === 1 ?
        "One question still needs an answer." :
        `${missing.length} questions still need an answer.`,
      missing: missing,
    };
  }

  // One Response Each. Only reachable above `public` — a form anyone can open
  // has nobody to count — and FormsCore forces the setting off below that, so
  // this cannot fire on a public form even if a stored record claimed it.
  const oneEach = form.oneEach === true && FormsCore.needsAccount(form.rung);
  if (oneEach && !a.personId) {
    // Somebody signed in whose account is not linked to a Person. There is
    // nothing to key the ledger on, so we cannot keep the promise the form
    // makes, and pretending otherwise is worse than refusing.
    return {
      ok: false,
      code: "no-person",
      message: "Your account is not linked to anybody in the directory yet, " +
        "so this form cannot tell whether you have already answered.",
    };
  }

  const response = FormsCore.buildResponse({
    formId: a.formId || null,
    answers: a.answers,
    attribution: form.attribution === true,
    personId: a.personId || null,
    personName: a.personName || null,
  });

  // A second answer REPLACES the first rather than being refused flatly — they
  // get their own answer back to change. Refusing outright would mean somebody
  // who mistyped their phone number has no way to fix it.
  //
  // ⚠ EXCEPT ON A BALLOT, WHERE CHANGING YOUR ANSWER IS IMPOSSIBLE BY
  // CONSTRUCTION, NOT BY POLICY. To hand somebody their own answer back we
  // would have to find it — and on an anonymous form the only thing that could
  // find it is the join between the ledger and the answers that ADR-0052
  // forbids. There is no clever way round this: a system that can show you your
  // own secret vote can show it to somebody else. So a ballot takes one answer
  // per person and says so plainly rather than offering an edit it cannot
  // honour.
  let replaces = null;
  if (oneEach && a.alreadyAnswered) {
    if (form.attribution !== true) {
      return {
        ok: false,
        code: "already-answered",
        message: "You have already answered this one. Because it is a secret " +
          "ballot, nothing here knows which answer was yours — so it cannot " +
          "be found and changed.",
      };
    }
    replaces = a.alreadyAnswered;
  }

  const ledger = oneEach ? FormsCore.buildLedgerEntry({
    formId: a.formId || null,
    personId: a.personId,
    answeredOn: today,
  }) : null;

  return {ok: true, response, ledger, replaces};
}

module.exports = {
  RANKS_AT_OR_ABOVE,
  rankSatisfies,
  answerersView,
  whatToServe,
  judgeSubmission,
};
