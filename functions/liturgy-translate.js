/**
 * Ask Jev which filled moment belongs in which slot of a liturgy order.
 *
 * The pure assignment lives in liturgy-translate-core.js. This file only
 * puts that question to TypeSafe and, when there is no key or no answer,
 * returns the kind-and-position plan instead. The key is read here so it
 * never reaches the browser.
 */

const Translate = require("./shared/liturgy-translate-core.js");

const MODEL = "jev-latest";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/**
 * Drop the question text before the plan goes back to the browser.
 * @param {object} plan the core's plan
 * @return {object} placements, leftovers, and which judge ran
 */
function forTheClient(plan) {
  return {
    judge: plan.judge,
    guessed: plan.guessed,
    placements: plan.placements,
    leftovers: plan.leftovers,
    blanks: plan.blanks,
    usage: plan.usage || null,
  };
}

/**
 * @param {string} apiKey TypeSafe key, or empty when Jev is not configured
 * @param {object} payload sources, targets, mode, and the two order names
 * @param {Function=} fetchImpl test double; production uses global fetch
 * @return {Promise<object>} the translation plan
 */
async function judge(apiKey, payload, fetchImpl) {
  const body = payload || {};
  const mode = body.mode === "document" ? "document" : "order";
  const sources = Array.isArray(body.sources) ? body.sources : [];
  const targets = Array.isArray(body.targets) ? body.targets : [];
  const opts = {
    mode: mode,
    sourceOrder: body.sourceOrder || "",
    targetOrder: body.targetOrder || "",
  };
  const local = function() {
    return forTheClient(Translate.plan(sources, targets, opts));
  };
  if (!apiKey) return local();

  const built = Translate.buildQuestions(sources, targets, opts);
  const questionIds = Object.keys(built.questions);
  if (!questionIds.length) {
    return forTheClient(Translate.plan(sources, targets, opts));
  }

  const doFetch = fetchImpl || fetch;
  try {
    const res = await doFetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        state: built.state,
        questions: built.questions,
      }),
    });
    if (!res.ok) {
      console.warn("translateLiturgy: TypeSafe responded " + res.status);
      return local();
    }
    const data = await res.json();
    return forTheClient(Translate.plan(sources, targets, {
      mode: mode,
      sourceOrder: opts.sourceOrder,
      targetOrder: opts.targetOrder,
      answers: (data && data.answers) || {},
      usage: (data && data.usage) || null,
    }));
  } catch (err) {
    const message = err && err.message ? err.message : err;
    console.warn("translateLiturgy: " + message);
    return local();
  }
}

module.exports = {
  MODEL: MODEL,
  judge: judge,
};
