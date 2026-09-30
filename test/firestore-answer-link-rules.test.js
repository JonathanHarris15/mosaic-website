const {test} = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// MS-513 / ADR-0067 — answer_links is a closed collection.
//
// The public path is the answerLink callable, not a rule. Marking this
// readable would enumerate every live door. These pin the SHAPE: every
// client — signed-out, anonymous, member, elder — is refused. Live
// enforcement stays a human step; the Admin SDK bypasses rules.
//
// Follows firestore-forms-rules.test.js (the form_ledger "if false" pin).

const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8")
    .replace(/\r\n/g, "\n");

const blockFor = (pattern) => {
  const m = rules.match(pattern);
  assert.ok(m, "no rule block matching " + pattern);
  return m[1];
};

const code = (block) => block
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

const linksBlock = () => blockFor(
    /match \/answer_links\/\{linkId\}\s*\{([\s\S]*?)\n    \}/);
const lookupsBlock = () => blockFor(
    /match \/answer_link_lookups\/\{addressHash\}\s*\{([\s\S]*?)\n    \}/);
const prayerRequestsBlock = () => blockFor(
    /match \/prayer_requests\/\{requestId\}\s*\{([\s\S]*?)\n      \}/);

test("answer_links denies every client read and write", () => {
  const block = code(linksBlock());
  assert.match(block, /allow read, write: if false;/);
  assert.doesNotMatch(block, /isSignedIn|isMember|isElder|isAdmin|isEditor/);
  assert.doesNotMatch(block, /if true/);
  assert.doesNotMatch(block, /request\.auth != null/);
});

test("answer_link_lookups is equally closed", () => {
  const block = code(lookupsBlock());
  assert.match(block, /allow read, write: if false;/);
  assert.doesNotMatch(block, /isSignedIn|isMember|isElder|isAdmin/);
});

test("prayer_requests rules are unchanged by the Answer link door", () => {
  const block = code(prayerRequestsBlock());
  assert.match(block, /allow read: if readsAsElder\(\);/);
  assert.match(block, /allow write: if canDecide\(\);/);
  assert.doesNotMatch(block, /if true/);
  assert.doesNotMatch(block, /if false/);
});
