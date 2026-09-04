// What a question LOOKS like, written once (MS-383).
//
// Two surfaces draw the same questions. A stranger answering a public form on
// their phone, and an elder filling in a Form Document at a desk — a date is a
// date control on both, a linear scale is its row of points on both, and a
// multiple choice shows every option with the chosen one marked on both.
//
// ⚠ THIS IS THE MARKUP ITSELF, NOT A VIEW MODEL, AND THAT IS THE POINT.
//
// The repo's usual way to share "how something looks" is a `*-view.js` that
// returns data for each page to render (see trades-view.js). That is the right
// shape when the decisions are hard and the markup is trivial. Here it is the
// other way round: the decisions are a switch on a type, and the MARKUP is the
// thing with detail in it — the wrapping scale row, the 44px tap targets, the
// option that shows it was picked. A view model would have left that written
// twice, which is exactly what somebody asked not to happen.
//
// So both pages inject this string as real DOM **before Alpine boots**, the way
// mobile-shell-header.js already injects chrome. Alpine then walks one copy of
// the bindings in each page, sourced from one file, and every binding below is
// ordinary Alpine — no x-html, no lost two-way binding, no event delegation.
//
// ── What a host page must provide ────────────────────────────────────────────
//
// The markup binds to these, and a page that mounts it owes all four:
//
//   q             the question being drawn (from the x-for around the mount)
//   answers       an object keyed by question id; two-way bound
//   scalePoints(q) the numbers a linear scale runs between
//   saidBefore(q, opt)  true when `opt` is what this person answered LAST time.
//                 The fill-in page uses it to mark a previous answer; a Form
//                 Document has no "last time" and returns false.
//
// The chrome AROUND a question — its number, its "Needed" chip, whether it is
// highlighted as missing — is deliberately NOT here. That genuinely differs:
// a fill-in page numbers questions and marks the ones left blank, a document
// does neither. Only the controls are shared, because only the controls are
// the same thing.

(function (global) {
    'use strict';

    const QUESTION_CONTROLS = `
        <input x-show="q.type === 'short_text'" type="text" class="m-input"
               :placeholder="q.placeholder" x-model="answers[q.id]" />

        <textarea x-show="q.type === 'paragraph'" class="m-input" rows="3"
                  :placeholder="q.placeholder" x-model="answers[q.id]"></textarea>

        <div x-show="q.type === 'choice_one'" class="fa-opts">
            <template x-for="opt in (q.options || [])" :key="opt">
                <label class="m-option" :class="answers[q.id] === opt ? 'm-option--picked' : ''">
                    <input type="radio" :name="q.id" :value="opt" x-model="answers[q.id]" />
                    <span class="m-option__mark"></span>
                    <span x-text="opt"></span>
                    <span class="m-option__said" x-show="saidBefore(q, opt)">Your answer</span>
                </label>
            </template>
        </div>

        <div x-show="q.type === 'choice_many'" class="fa-opts">
            <template x-for="opt in (q.options || [])" :key="opt">
                <label class="m-option" :class="(answers[q.id] || []).includes(opt) ? 'm-option--picked' : ''">
                    <input type="checkbox" :value="opt" x-model="answers[q.id]" />
                    <span class="m-option__mark fa-box"></span>
                    <span x-text="opt"></span>
                    <span class="m-option__said" x-show="saidBefore(q, opt)">Your answer</span>
                </label>
            </template>
        </div>

        <!-- A native select, unlike the builder's type picker. There the OS
             popup was wrong because thirteen grouped options opened off the top
             of the window; here it is right, because a phone draws its own
             wheel for this and that beats anything we would draw for somebody
             answering one-handed. -->
        <select x-show="q.type === 'dropdown'" class="m-input" x-model="answers[q.id]">
            <option value="">Choose one…</option>
            <template x-for="opt in (q.options || [])" :key="opt">
                <option :value="opt" x-text="opt"></option>
            </template>
        </select>

        <input x-show="q.type === 'number'" type="number" class="m-input" inputmode="decimal"
               :placeholder="q.placeholder" x-model="answers[q.id]" />

        <div x-show="q.type === 'scale'" class="fa-scale">
            <span class="fa-scale__end" x-show="q.scale && q.scale.minLabel" x-text="q.scale && q.scale.minLabel"></span>
            <div class="fa-scale__points">
                <template x-for="point in scalePoints(q)" :key="point">
                    <label class="fa-scale__point" :class="String(answers[q.id]) === String(point) ? 'fa-scale__point--picked' : ''">
                        <input type="radio" :name="q.id" :value="point" x-model="answers[q.id]" />
                        <span x-text="point"></span>
                    </label>
                </template>
            </div>
            <span class="fa-scale__end" x-show="q.scale && q.scale.maxLabel" x-text="q.scale && q.scale.maxLabel"></span>
        </div>

        <input x-show="q.type === 'date'" type="date" class="m-input" x-model="answers[q.id]" />

        <input x-show="q.type === 'time'" type="time" class="m-input" x-model="answers[q.id]" />

        <span class="m-input-hint" x-show="q.hint" x-text="q.hint"></span>
    `;

    // Put the controls inside every element carrying `data-form-question`.
    //
    // ⚠ MUST RUN BEFORE ALPINE BOOTS. Alpine walks the DOM once at startup and
    // never sees markup added afterwards, so a page that mounts this late gets
    // a question with no control and no error. Both pages call this from a
    // plain <script> above Alpine's own deferred one — the same ordering
    // mobile-shell-header.js relies on.
    function mount(root) {
        const scope = root || (typeof document !== 'undefined' ? document : null);
        if (!scope) return 0;
        let filled = 0;
        // Counted as we go rather than read off `.length`: what a query returns
        // is only promised to be iterable, and a caller passing anything else
        // iterable should get a straight answer rather than `undefined`.
        scope.querySelectorAll('[data-form-question]').forEach(slot => {
            slot.innerHTML = QUESTION_CONTROLS;
            filled += 1;
        });
        return filled;
    }

    const FormQuestionMarkup = { QUESTION_CONTROLS, mount };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FormQuestionMarkup;
    }
    if (global) {
        global.FormQuestionMarkup = FormQuestionMarkup;
    }
})(typeof window !== 'undefined' ? window : null);
