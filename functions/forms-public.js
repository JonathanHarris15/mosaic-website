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
 * Where an uploaded file is kept.
 *
 * Under the form and the response it belongs to, so the rules can answer "may
 * you read this" by looking at the path, and so deleting a response's files is
 * a prefix delete rather than a search.
 *
 * The stored name is the response's own id plus the question's, NOT the name
 * the file arrived with. An answerer picks that name, and a path built from
 * something a stranger chose is a path a stranger can aim. The original name is
 * kept in the record, where it is data rather than an address.
 *
 * @param {string} formId The form.
 * @param {string} responseId The response the file belongs to.
 * @param {string} questionId The question it answers.
 * @param {string} name The name it arrived with, for its extension only.
 * @return {string} The storage path.
 */
function uploadPath(formId, responseId, questionId, name) {
  const dot = String(name || "").lastIndexOf(".");
  const ext = dot > 0 ? String(name).slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  return `form_uploads/${formId}/${responseId}/${questionId}${ext}`;
}

/**
 * Are these files answers this form can actually take?
 *
 * Pure, so the interesting cases are testable without a bucket. What it will
 * not do is trust the page: the size is checked here as well, because the page
 * that checked it is one we do not control on a public form.
 *
 * @param {?Object} form The stored Form Template.
 * @param {?Object} files Question id → {name, contentType, size, dataBase64}.
 * @return {!Array<!Object>} One {id, text, why} per file that cannot be taken.
 */
function judgeUploads(form, files) {
  const out = [];
  const asked = {};
  FormsCore.askedQuestions(form).forEach((q) => {
    asked[q.id] = q;
  });

  Object.keys(files || {}).forEach((qid) => {
    const file = files[qid];
    const q = asked[qid];
    if (!q) {
      out.push({id: qid, text: "", why: "That question is not on this form."});
      return;
    }
    if (!FormsCore.isUploadType(q.type)) {
      out.push({id: qid, text: q.text, why: "That question does not take a file."});
      return;
    }
    const fault = FormsCore.uploadFault(file);
    if (fault) {
      out.push({id: qid, text: q.text, why: fault});
      return;
    }
    // The bytes have to BE bytes. A page sending something else is a page we
    // did not write, which on a public form is the ordinary case.
    if (typeof file.dataBase64 !== "string" || !file.dataBase64.length) {
      out.push({id: qid, text: q.text, why: "That file did not arrive."});
    }
  });
  return out;
}

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

  // An answer that IS there and is the wrong shape for the question it
  // answers: a scale off the end of its own range, a date that is not a date,
  // an option the form never offered. Asked AFTER the missing check, so
  // somebody who left half the form blank is told that first rather than being
  // corrected on the half they did fill in.
  //
  // ⚠ The fill-in page checks none of this, and that is deliberate rather than
  // an omission: a bad value cannot arrive from the controls it draws, so
  // anything that reaches here was typed into the request. This is the copy
  // that counts.
  const unfit = FormsCore.answerProblems(form, a.answers);
  if (unfit.length) {
    return {
      ok: false,
      code: "unanswerable",
      message: unfit.length === 1 ?
        "One answer does not fit its question." :
        `${unfit.length} answers do not fit their questions.`,
      // Same key as the missing list, so the page marks the same questions the
      // same way rather than growing a second highlighting path.
      missing: unfit,
    };
  }

  // Files, judged BEFORE anything is written. An upload that cannot be taken
  // should stop the submission rather than leaving bytes in the bucket with no
  // Response pointing at them.
  const badFiles = judgeUploads(form, a.files);
  if (badFiles.length) {
    return {
      ok: false,
      code: "unanswerable",
      message: badFiles.length === 1 ?
        "One file could not be accepted." :
        `${badFiles.length} files could not be accepted.`,
      missing: badFiles,
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
    // Only answers to questions that ask something. A section heading collects
    // nothing, so anything sent against one is dropped rather than stored.
    answers: FormsCore.answersOnly(form, a.answers),
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
  uploadPath,
  judgeUploads,
  RANKS_AT_OR_ABOVE,
  rankSatisfies,
  answerersView,
  whatToServe,
  judgeSubmission,
};
