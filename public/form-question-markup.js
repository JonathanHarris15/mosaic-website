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
// And four more, owed only by a page that carries the three types which reach
// outside the form (MS-390). A page with none of those types never calls them:
//
//   personQueries      an object keyed by question id, holding what has been
//                      typed into each picker's search box
//   personChoices(q)   the people to offer for `q`, already narrowed by its
//                      scope and by what has been typed
//   pickPerson(q, p)   record `p` as the answer to `q`
//   onFileChosen(q, ev) take the chosen file. The page checks the size BEFORE
//                      uploading and puts any complaint where uploadFault(q)
//                      can find it — nobody should wait for a failure.
//   uploadFault(q)     that complaint, or '' when there is none
//   busyWith(q)        what the page is doing to the chosen file right
//                      now, or '' when it is doing nothing. Shrinking a
//                      photo takes a second or two on an old phone, and
//                      a control that said nothing would look broken.
//   clearUpload(q)     forget the file chosen for `q`
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

        <!-- A Directory Person picker. Searched rather than scrolled: a
             congregation is longer than a list anybody reads. What has already
             been picked shows as the answer, with a way to change it, because a
             picker that hides its own answer is one people re-pick to check. -->
        <div x-show="q.type === 'person'" class="fa-person">
            <div class="fa-person__picked" x-show="answers[q.id] && answers[q.id].personId">
                <span class="material-symbols-outlined">person</span>
                <span x-text="answers[q.id] && answers[q.id].name"></span>
                <button type="button" class="m-btn m-btn--quiet m-btn--sm" @click="pickPerson(q, null)">Change</button>
            </div>
            <template x-if="!(answers[q.id] && answers[q.id].personId)">
                <div class="fa-person__find">
                    <span class="m-search">
                        <span class="material-symbols-outlined">search</span>
                        <input type="text" placeholder="Search by name" x-model="personQueries[q.id]" />
                    </span>
                    <div class="fa-person__list" x-show="(personQueries[q.id] || '').trim()">
                        <template x-for="p in personChoices(q)" :key="p.id">
                            <button type="button" class="fa-person__opt" @click="pickPerson(q, p)">
                                <span class="material-symbols-outlined">person</span>
                                <span x-text="p.name"></span>
                            </button>
                        </template>
                        <p class="m-input-hint" x-show="!personChoices(q).length">Nobody by that name.</p>
                    </div>
                </div>
            </template>
        </div>

        <!-- An image and a file are the same control with two accept rules. The
             image one asks for the camera on a phone, so taking the photo and
             sending it is one motion. -->
        <div x-show="q.type === 'image' || q.type === 'file'" class="fa-file">
            <label class="fa-file__pick" x-show="!(answers[q.id] && answers[q.id].name)">
                <span class="material-symbols-outlined" x-text="q.type === 'image' ? 'add_a_photo' : 'upload_file'"></span>
                <span x-text="q.type === 'image' ? 'Choose a photo' : 'Choose a file'"></span>
                <input type="file" x-show="false"
                       :accept="q.type === 'image' ? 'image/*' : undefined"
                       :capture="q.type === 'image' ? 'environment' : undefined"
                       @change="onFileChosen(q, $event)" />
            </label>
            <div class="fa-file__got" x-show="answers[q.id] && answers[q.id].name">
                <span class="material-symbols-outlined">description</span>
                <span x-text="answers[q.id] && answers[q.id].name"></span>
                <button type="button" class="m-btn m-btn--quiet m-btn--sm" @click="clearUpload(q)">Remove</button>
            </div>
            <span class="m-input-hint" x-show="busyWith(q)" x-text="busyWith(q)"></span>
            <span class="m-input-hint fa-file__fault" x-show="uploadFault(q)" x-text="uploadFault(q)"></span>
        </div>

        <span class="m-input-hint" x-show="q.hint" x-text="q.hint"></span>
    `;

    // Put the controls inside every element carrying `data-form-question`.
    //
    // ⚠ IT HAS TO LOOK INSIDE <template>, AND THAT IS THE WHOLE DIFFICULTY.
    //
    // A question is drawn by `<template x-for="q in questions">`, so the mount
    // point sits inside a template. A template's children are NOT in the
    // document — they live in a separate DocumentFragment that
    // `document.querySelectorAll` does not descend into. The first version of
    // this searched the document, found nothing, filled nothing, and reported
    // zero, and every page using it drew a question with a label and no way to
    // answer it. No error, nothing in the console: the slot was simply empty.
    //
    // So this walks every template's content as well, recursively, because a
    // template can hold a template.
    //
    // ⚠ AND IT MUST RUN AFTER THE BODY IS PARSED BUT BEFORE ALPINE BOOTS.
    // That is a narrow window and it has exactly one reliable spot: a plain
    // inline <script> at the END of <body>. A script in <head> runs before the
    // slots exist; DOMContentLoaded fires AFTER a deferred script, so Alpine
    // has already walked the DOM by then. Both pages call it from the end of
    // the body, and a test pins that.
    function fillSlots(scope) {
        let filled = 0;
        // Counted as we go rather than read off `.length`: what a query returns
        // is only promised to be iterable, and a caller passing anything else
        // iterable should get a straight answer rather than `undefined`.
        scope.querySelectorAll('[data-form-question]').forEach(slot => {
            slot.innerHTML = QUESTION_CONTROLS;
            filled += 1;
        });
        scope.querySelectorAll('template').forEach(tpl => {
            if (tpl.content) filled += fillSlots(tpl.content);
        });
        return filled;
    }

    function mount(root) {
        const scope = root || (typeof document !== 'undefined' ? document : null);
        if (!scope) return 0;
        const filled = fillSlots(scope);

        // ⚠ SAY HOW MANY, ON THE PAGE ITSELF. A mount that finds nothing is
        // otherwise completely silent — no error, no warning, just a question
        // with a label and nothing to answer it with. That is how this shipped
        // broken, and how it stayed broken through a test suite that only read
        // the source. Stamped here so a person opening dev tools and a test
        // driving a real browser can both see it in one glance.
        if (!root && typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.setAttribute('data-form-controls', String(filled));
        }
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
