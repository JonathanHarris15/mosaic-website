// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/forms-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Forms Core — the shapes a Form Template, a Response and the ballot ledger
// take, and the handful of rules that must mean the same thing on the server,
// in the browser, and on the phone.
//
// Three decisions sit under this file and it is worth naming them here, because
// every one of them is the kind that looks like an arbitrary choice until you
// know what it is holding shut:
//
//   ADR-0051  A signed-out person never touches Firestore, and a form's id is
//             128 bits of base58 rather than anything derived from its title.
//             A readable slug is a guessable one.
//   ADR-0052  The answers carry no person and the ledger carries no answers,
//             and an anonymous answer's handle is POSITIONAL, never
//             chronological — hence the stable shuffle below.
//   ADR-0032  A page editor saves itself and keeps its Save button.
//
// Deliberately self-contained, like every other *-core module here: requires
// nothing, mutates nothing, returns new objects, and knows nothing about
// Firestore. Loaded as a classic <script> (window.FormsCore) and exported for
// Node — the Cloud Function gets its copy through scripts/sync-shared-to-
// functions.js, because functions/ deploys as its own bundle.

(function (global) {
    'use strict';

    // ── The title ────────────────────────────────────────────────────────────
    //
    // 90 characters. Whoever opens the link reads this first and it has to
    // survive a phone. The cap is here rather than in a maxlength attribute
    // because a text box is one of several ways a title arrives.
    const MAX_TITLE_LENGTH = 90;
    const DEFAULT_TITLE = 'Untitled form';

    // Long enough for a real question, short enough to stay a question.
    const MAX_QUESTION_LENGTH = 300;
    const MAX_OPTION_LENGTH = 200;

    // ── The prose an author writes around the questions ──────────────────────
    //
    // Two fields, and deliberately not three. The MS-371 design drew a
    // description at the top, a footnote at the bottom AND a what-happens-next
    // on the thank-you; three prose boxes is a builder nobody fills in, so the
    // footnote folds into the description.
    //
    //   description — read BEFORE answering. What this is, what it costs, when
    //                 it closes, who is running it.
    //   afterword   — read AFTER answering, under "What happens next". The one
    //                 thing somebody wants to know once they have committed.
    const MAX_DESCRIPTION_LENGTH = 400;
    const MAX_AFTERWORD_LENGTH = 300;

    // Per question. A hint sits under the box and explains why the question is
    // being asked; a placeholder sits inside it and shows the shape of an
    // answer. Both are short on purpose — they are read on a phone, standing up.
    const MAX_HINT_LENGTH = 140;
    const MAX_PLACEHOLDER_LENGTH = 80;

    // ── Question types ───────────────────────────────────────────────────────
    //
    // Three work today and ten do not. They are ALL named here, grouped, with
    // `live` saying which is which — because the picker is built for thirteen
    // from the start. A picker that grows from three loose buttons into
    // thirteen is a redesign; a grouped list that lights up is not.
    const QUESTION_TYPES = [
        { id: 'short_text', label: 'Short answer', group: 'Text', live: true },
        { id: 'paragraph', label: 'Paragraph', group: 'Text', live: true },
        { id: 'choice_one', label: 'Multiple choice', group: 'Choice', live: true },
        { id: 'choice_many', label: 'Select all that apply', group: 'Choice', live: false },
        { id: 'dropdown', label: 'Dropdown', group: 'Choice', live: false },
        { id: 'number', label: 'Number', group: 'Number', live: false },
        { id: 'scale', label: 'Linear scale', group: 'Number', live: false },
        { id: 'date', label: 'Date', group: 'When', live: false },
        { id: 'time', label: 'Time', group: 'When', live: false },
        { id: 'image', label: 'Image', group: 'Attach', live: false },
        { id: 'file', label: 'File submission', group: 'Attach', live: false },
        { id: 'person', label: 'Directory Person picker', group: 'From the app', live: false },
        { id: 'payment', label: 'Stripe payment', group: 'From the app', live: false },
    ];

    const TYPES_BY_ID = {};
    QUESTION_TYPES.forEach(t => { TYPES_BY_ID[t.id] = t; });

    // Which types carry a list of options the author writes.
    const OPTION_TYPES = { choice_one: true, choice_many: true, dropdown: true };

    function questionType(id) {
        return TYPES_BY_ID[id] || null;
    }

    function isLiveType(id) {
        const t = TYPES_BY_ID[id];
        return !!(t && t.live);
    }

    function hasOptions(typeId) {
        return !!OPTION_TYPES[typeId];
    }

    // ── Who may answer ───────────────────────────────────────────────────────
    //
    // The Event visibility ladder, reused rather than a second one invented.
    // `public` is the only rung that needs no account — which is why "is
    // sign-in required" is NOT a separate setting: it is read off the rung.
    //
    // MS-360 offers the first two; `editor` and `elder` arrive with MS-361.
    // They are named here because the ladder is the model, not the UI.
    const RUNGS = ['public', 'member', 'editor', 'elder'];
    const RUNGS_LIVE = ['public', 'member'];

    function isRung(rung) {
        return RUNGS.indexOf(rung) !== -1;
    }

    function needsAccount(rung) {
        return rung !== 'public';
    }

    // ── The two settings, and what each rung allows ──────────────────────────
    //
    // Attribution and One Response Each are independent of each other and both
    // constrained by the rung. On `public` neither is available, and they are
    // unavailable for DIFFERENT reasons — which is why this returns a reason per
    // setting rather than one blanket sentence. The design drew both reasons on
    // screen and it was right to: "not yours to change" without a why is just a
    // greyed box.
    function settingsFor(rung) {
        if (rung === 'public') {
            return {
                attribution: {
                    available: false,
                    value: false,
                    why: 'Off, and not yours to change: a public form has no account to attach a name to. Move the rung to Members to record who answered.',
                },
                oneEach: {
                    available: false,
                    value: false,
                    why: 'Off, and not yours to change: a form anyone can open has no way to tell one person from another.',
                },
            };
        }
        return {
            attribution: {
                available: true,
                why: 'Each answer carries the Person who gave it.',
            },
            oneEach: {
                available: true,
                why: 'A second visit opens their own answer to change rather than a blank form.',
            },
        };
    }

    // A secret ballot: we know THAT you answered, not WHAT you said. The one
    // combination where the two settings pull against each other, and the one
    // that has to say so on the form itself.
    function isBallot(form) {
        const f = form || {};
        return needsAccount(f.rung) && f.attribution === false && f.oneEach === true;
    }

    // The promise, in one place, because the words are the safeguard. If this
    // sentence and the storage ever disagree, the storage is not the thing that
    // people were told.
    const BALLOT_PROMISE = 'We record that you answered. We do not record what you said.';

    // ── The form's id ────────────────────────────────────────────────────────
    //
    // 128 bits, base58. NOT derived from the title, ever: `/f/monday-food` is
    // guessable, and a guessable id makes every public form enumerable, which
    // is precisely what ADR-0051's closed door exists to prevent.
    //
    // Takes its randomness rather than reaching for it, so this module stays
    // pure and the test can hand it a known value. Callers pass
    // crypto.getRandomValues(new Uint8Array(16)).
    const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const ID_BYTES = 16;

    function formIdFromBytes(bytes) {
        if (!bytes || bytes.length < ID_BYTES) {
            throw new Error('formIdFromBytes needs at least ' + ID_BYTES + ' bytes of randomness');
        }
        // Big-endian base conversion over the first 16 bytes.
        const digits = [0];
        for (let i = 0; i < ID_BYTES; i++) {
            let carry = bytes[i];
            for (let j = 0; j < digits.length; j++) {
                carry += digits[j] << 8;
                digits[j] = carry % 58;
                carry = (carry / 58) | 0;
            }
            while (carry > 0) {
                digits.push(carry % 58);
                carry = (carry / 58) | 0;
            }
        }
        let out = '';
        for (let i = digits.length - 1; i >= 0; i--) out += BASE58[digits[i]];
        return out;
    }

    function looksLikeFormId(id) {
        const s = String(id == null ? '' : id);
        if (s.length < 16 || s.length > 24) return false;
        for (let i = 0; i < s.length; i++) {
            if (BASE58.indexOf(s[i]) === -1) return false;
        }
        return true;
    }

    // ── Titles and questions ─────────────────────────────────────────────────

    function normaliseTitle(title) {
        const trimmed = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
        if (!trimmed) return DEFAULT_TITLE;
        return trimmed.slice(0, MAX_TITLE_LENGTH);
    }

    function isUntitled(title) {
        return normaliseTitle(title) === DEFAULT_TITLE;
    }

    function trimTo(value, max) {
        return String(value == null ? '' : value).trim().slice(0, max);
    }

    function buildQuestion(spec) {
        const s = spec || {};
        const type = isLiveType(s.type) ? s.type : 'short_text';
        const q = {
            id: String(s.id || ''),
            type: type,
            text: trimTo(s.text, MAX_QUESTION_LENGTH),
            hint: trimTo(s.hint, MAX_HINT_LENGTH),
            placeholder: trimTo(s.placeholder, MAX_PLACEHOLDER_LENGTH),
            required: s.required === true,
            // A question that has gathered answers is RETIRED, never deleted —
            // the tally it already holds would otherwise lose its label. A
            // retired question is not shown to answerers and is still shown on
            // the Responses tab.
            retired: s.retired === true,
        };
        if (hasOptions(type)) {
            q.options = (Array.isArray(s.options) ? s.options : [])
                .map(o => String(o == null ? '' : o).trim().slice(0, MAX_OPTION_LENGTH))
                .filter(o => o.length > 0);
        }
        return q;
    }

    // Questions an answerer is actually shown.
    function askedQuestions(form) {
        return ((form && form.questions) || []).filter(q => !q.retired);
    }

    // ── The Form Template record ─────────────────────────────────────────────

    function buildFormTemplate(spec) {
        const s = spec || {};
        const rung = isRung(s.rung) ? s.rung : 'member';
        const allowed = settingsFor(rung);

        const record = {
            title: normaliseTitle(s.title),
            description: trimTo(s.description, MAX_DESCRIPTION_LENGTH),
            afterword: trimTo(s.afterword, MAX_AFTERWORD_LENGTH),
            questions: (Array.isArray(s.questions) ? s.questions : []).map(buildQuestion),
            rung: rung,
            // Forced values win over whatever was passed. A form saved as
            // `public` while carrying attribution:true would be a record that
            // contradicts its own rung, and something downstream would believe
            // it.
            attribution: allowed.attribution.available ? s.attribution === true : false,
            oneEach: allowed.oneEach.available ? s.oneEach === true : false,
            published: s.published === true,
            closed: s.closed === true,
            closingDate: normaliseDateStr(s.closingDate),
            createdAt: 'createdAt' in s ? s.createdAt : null,
            createdBy: 'createdBy' in s ? s.createdBy : null,
            createdByName: 'createdByName' in s ? s.createdByName : null,
            updatedAt: 'updatedAt' in s ? s.updatedAt : null,
            updatedByName: 'updatedByName' in s ? s.updatedByName : null,
        };
        return record;
    }

    function normaliseDateStr(value) {
        const s = String(value == null ? '' : value).trim();
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    }

    // ── Closed ───────────────────────────────────────────────────────────────
    //
    // Asked, never swept. A form is closed if somebody pressed it closed OR its
    // closing date has passed — computed where it is read, so a sign-up stops on
    // time without a scheduled job having to have run.
    //
    // `todayStr` is passed in (DateUtils.todayStr()) rather than taken from the
    // clock here, so the comparison happens in the church's day rather than
    // UTC's. A form closing on the 21st is answerable all through the 21st.
    function isClosed(form, todayStr) {
        const f = form || {};
        if (f.closed === true) return true;
        const closingDate = normaliseDateStr(f.closingDate);
        const today = normaliseDateStr(todayStr);
        if (!closingDate || !today) return false;
        return today > closingDate;
    }

    // Whether this form can take an answer at all, and why not when it cannot.
    // One function, because "is it answerable" is asked by the fill-in page, by
    // the Cloud Function, and by the preview — and three copies of it is how
    // they come to disagree.
    function answerability(form, todayStr) {
        const f = form || {};
        if (!f.published) return { open: false, reason: 'unpublished' };
        if (isClosed(f, todayStr)) return { open: false, reason: 'closed' };
        return { open: true, reason: null };
    }

    // ── A Response ───────────────────────────────────────────────────────────
    //
    // ⚠ On an anonymous form the person field is ABSENT, not null. A null
    // `personId` sitting beside a populated one on the next form is a shape
    // somebody later "fixes" by backfilling. Absent is unambiguous, and this is
    // the one place that decides it.
    function buildResponse(spec) {
        const s = spec || {};
        const record = {
            formId: String(s.formId || ''),
            answers: normaliseAnswers(s.answers),
            submittedAt: 'submittedAt' in s ? s.submittedAt : null,
        };
        if (s.attribution === true && s.personId) {
            record.personId = String(s.personId);
            record.personName = s.personName ? String(s.personName) : null;
        }
        return record;
    }

    function normaliseAnswers(answers) {
        const out = {};
        const a = answers || {};
        Object.keys(a).forEach(qid => {
            const v = a[qid];
            if (v == null) return;
            if (Array.isArray(v)) {
                const list = v.map(x => String(x)).filter(x => x.length > 0);
                if (list.length) out[qid] = list;
                return;
            }
            const s = String(v).trim();
            if (s.length) out[qid] = s;
        });
        return out;
    }

    // The ledger: who has answered, holding nothing about what they said.
    // One entry per person per form. No fine timestamp — millisecond ordering
    // would line this list back up against the answers without either gaining a
    // field, which is the leak ADR-0052 closes.
    function buildLedgerEntry(spec) {
        const s = spec || {};
        return {
            formId: String(s.formId || ''),
            personId: String(s.personId || ''),
            // Deliberately coarse: the day, and nothing finer.
            answeredOn: normaliseDateStr(s.answeredOn),
        };
    }

    // ── Validation, decided server-side ──────────────────────────────────────
    //
    // Returns the questions that had to be answered and were not. A browser
    // answering a public form is not something we control, so this is the copy
    // that counts — the page runs the same function only to be polite.
    function missingRequired(form, answers) {
        const given = normaliseAnswers(answers);
        return askedQuestions(form)
            .filter(q => q.required && !(q.id in given))
            .map(q => ({ id: q.id, text: q.text }));
    }

    // ── Reading anonymous answers back ───────────────────────────────────────
    //
    // A stable shuffle keyed by the form. Two elders looking at the same poll at
    // the same time see the same "answer 6", and it says nothing about when it
    // arrived. Arrival order is the correlation channel; a fixed permutation
    // that is not arrival order is a handle without one.
    //
    // xmur3 to make a seed out of the form id, mulberry32 to draw from it. Both
    // are tiny, well-known, and deterministic — which is all that is being asked
    // of them. This is not a security shuffle; it is a stable one.
    function seedFrom(str) {
        let h = 1779033703 ^ String(str).length;
        for (let i = 0; i < String(str).length; i++) {
            h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
            h = (h << 13) | (h >>> 19);
        }
        return function () {
            h = Math.imul(h ^ (h >>> 16), 2246822507);
            h = Math.imul(h ^ (h >>> 13), 3266489909);
            return (h ^= h >>> 16) >>> 0;
        };
    }

    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function stableShuffle(items, key) {
        const out = (items || []).slice();
        const rand = mulberry32(seedFrom(key)());
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
        }
        return out;
    }

    // How an anonymous form's answers are handed to a screen: shuffled, then
    // numbered by POSITION. The number is a label, not a field — nothing stores
    // it, and it carries no date, because a date would undo the shuffle.
    function anonymousReadOrder(responses, formId) {
        return stableShuffle(responses, formId).map((r, i) => ({
            response: r,
            handle: i + 1,
        }));
    }

    // ── Counting what came back ──────────────────────────────────────────────
    //
    // Per question. A choice question gets a count and a share per option; a
    // text question gets its answers, in the order the caller hands them over.
    //
    // ⚠ `answered` is counted from the ANSWERS, never from the ledger of who
    // has answered. They are the same number on a form where everybody answered
    // every question and different otherwise, and reaching for the ledger to
    // get the "right" one is the join ADR-0052 forbids.
    function tally(form, responses) {
        const rows = responses || [];
        return ((form && form.questions) || []).map(q => {
            const given = rows
                .map(r => (r.answers || {})[q.id])
                .filter(v => v != null && v !== '');

            const out = {
                id: q.id,
                text: q.text,
                type: q.type,
                retired: q.retired === true,
                answered: given.length,
                of: rows.length,
            };

            if (hasOptions(q.type)) {
                const counts = {};
                (q.options || []).forEach(o => { counts[o] = 0; });
                given.forEach(v => {
                    (Array.isArray(v) ? v : [v]).forEach(one => {
                        if (one in counts) counts[one] += 1;
                    });
                });
                // The share is of the people who ANSWERED THIS QUESTION, not of
                // everybody who submitted. An optional question answered by
                // three of forty is not "7% chili".
                const base = given.length || 1;
                const top = Math.max(1, ...Object.values(counts));
                out.options = (q.options || []).map(o => ({
                    label: o,
                    count: counts[o],
                    share: Math.round((counts[o] / base) * 100),
                    // Bar width is relative to the biggest answer, so a clear
                    // winner fills the track and the rest are read against it.
                    width: Math.round((counts[o] / top) * 100),
                }));
            } else {
                out.answers = given.map(v => String(v));
            }
            return out;
        });
    }

    const FormsCore = {
        MAX_TITLE_LENGTH,
        MAX_QUESTION_LENGTH,
        MAX_OPTION_LENGTH,
        MAX_DESCRIPTION_LENGTH,
        MAX_AFTERWORD_LENGTH,
        MAX_HINT_LENGTH,
        MAX_PLACEHOLDER_LENGTH,
        DEFAULT_TITLE,
        QUESTION_TYPES,
        RUNGS,
        RUNGS_LIVE,
        BALLOT_PROMISE,
        ID_BYTES,
        questionType,
        isLiveType,
        hasOptions,
        isRung,
        needsAccount,
        settingsFor,
        isBallot,
        formIdFromBytes,
        looksLikeFormId,
        normaliseTitle,
        isUntitled,
        buildQuestion,
        askedQuestions,
        buildFormTemplate,
        isClosed,
        answerability,
        buildResponse,
        buildLedgerEntry,
        missingRequired,
        tally,
        stableShuffle,
        anonymousReadOrder,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FormsCore;
    }
    if (global) {
        global.FormsCore = FormsCore;
    }
})(typeof window !== 'undefined' ? window : null);
