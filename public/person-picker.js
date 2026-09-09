// Person Picker — one way to choose somebody, injected wherever it is needed.
//
// Choosing a Person is asked all over this app, and until now every screen had
// answered it for itself: a bare <select> here, a type-ahead there, a popover
// with initials on Manage Tags. They do not behave the same — one takes
// keyboard arrows, one does not; one shows a face, one shows a line of text —
// so the same question looked like a different question depending where you
// stood.
//
// This is the Manage Tags one, which is the most finished of them, lifted out
// so it can be used rather than copied. It follows `roles-panel.js`: THE MARKUP
// IS SHARED AND INJECTED, and the behaviour is a mixin the host component folds
// in, so there is one implementation of "search, highlight, choose".
//
// A host page opts in with a placeholder:
//
//     <div data-person-picker
//          data-label="Who it's for"
//          data-empty="Nobody in particular"></div>
//
// and the host COMPONENT provides three things — what the list is, what is
// chosen, and what to do when somebody picks:
//
//     Object.defineProperties({
//         get ppPeople()     { return this.people; },        // [{ id, name }]
//         get ppSelectedId() { return this.form.aboutPersonId; },
//         ppSelect(person)   { this.form.aboutPersonId = person ? person.id : ''; },
//         ...
//     }, Object.getOwnPropertyDescriptors(PersonPicker.mixin()))
//
// ⚠ COMPOSE WITH DESCRIPTORS, NEVER SPREAD OR Object.assign. The mixin's
// `ppOptions` and `ppSelectedName` are GETTERS: spread evaluates them once and
// freezes the answer, and assigning over a getter-only property throws. Same
// trap `withQuickAssign` documents for the profile's quick-assign card.
//
// Injected synchronously, so this script must load AFTER the placeholders and
// BEFORE Alpine (which is deferred). Alpine then initialises over the finished
// markup exactly as if it had been written inline.

(function (global) {
    'use strict';

    // How many rows the popover offers at once. Everybody is reachable by
    // typing; this is what it opens on before anybody has typed anything.
    const LIMIT = 50;

    // The words a host writes on its placeholder are ordinary prose — an
    // apostrophe in "Who it's for" is normal — and they land in two different
    // languages here: HTML text, and an Alpine expression inside an attribute.
    // Escaped for both, so a label can never quietly break the markup it is in.
    const html = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const js = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

    const markup = ({ label, hint, empty, allowNobody }) => `
        <div class="flex flex-col gap-1 relative" @click.outside="ppClose()">
            ${label ? `<span class="font-label-md text-label-md text-on-surface-variant">${html(label)}${
                hint ? ` <span class="opacity-70">${html(hint)}</span>` : ''}</span>` : ''}

            <!-- The trigger says who is chosen rather than making you open it
                 to find out — a face and a name, the way the app draws a Person
                 everywhere else. -->
            <button type="button" @click="ppToggle()"
                :aria-expanded="pp.open"
                class="w-full flex items-center gap-2 bg-surface-container border border-outline-variant rounded-lg px-md py-2 hover:border-secondary transition-colors">
                <span x-show="ppSelectedName"
                      class="w-[26px] h-[26px] rounded-full bg-primary text-on-primary flex items-center justify-center text-[11px] font-semibold shrink-0"
                      x-text="ppInitials(ppSelectedName)"></span>
                <span class="flex-1 text-left truncate font-body-md"
                      :class="ppSelectedName ? 'text-on-surface font-semibold' : 'text-on-surface-variant'"
                      x-text="ppSelectedName || ${js(empty)}"></span>
                <span class="material-symbols-outlined text-[18px] text-on-surface-variant"
                      x-text="pp.open ? 'expand_less' : 'expand_more'"></span>
            </button>

            <div x-show="pp.open" x-cloak
                 class="absolute top-full left-0 right-0 mt-1 z-40 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg overflow-hidden">
                <div class="p-2 border-b border-outline-variant">
                    <!-- ⚠ ARROWS AND ENTER ARE HANDLED HERE, not on the list.
                         The focus never leaves this box while you are choosing,
                         so a keyboard user types two letters and presses enter
                         without ever reaching for the mouse. -->
                    <input type="text" x-ref="ppSearch" x-model="pp.query"
                           @keydown.stop
                           @keydown.arrow-down.prevent="ppMove(1)"
                           @keydown.arrow-up.prevent="ppMove(-1)"
                           @keydown.enter.prevent="ppChooseHighlighted()"
                           @keydown.escape.prevent="ppClose()"
                           placeholder="Search people…"
                           class="w-full bg-surface border border-outline-variant rounded-lg px-sm py-2 font-body-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>

                <div class="max-h-[216px] overflow-y-auto p-1.5">
                    ${allowNobody ? `
                    <!-- Nobody is a real answer, not a blank, so it is a row you
                         can choose rather than a thing you undo by deleting. -->
                    <button type="button" @click="ppChoose(null)"
                        class="w-full flex items-center gap-2 rounded-lg px-2 py-[7px] font-body-md text-sm text-on-surface-variant text-left hover:bg-surface-container transition-colors">
                        <span class="w-[26px] h-[26px] rounded-full border border-dashed border-outline flex items-center justify-center shrink-0">
                            <span class="material-symbols-outlined text-[14px]">remove</span>
                        </span>
                        <span class="flex-1 truncate">${html(empty)}</span>
                    </button>` : ''}

                    <template x-for="(opt, i) in ppOptions" :key="opt.id">
                        <button type="button" @click="ppChoose(opt)" @mouseenter="pp.index = i"
                            :class="pp.index === i ? 'bg-surface-container' : ''"
                            class="w-full flex items-center gap-2 rounded-lg px-2 py-[7px] font-body-md text-sm text-on-surface text-left transition-colors">
                            <span class="w-[26px] h-[26px] rounded-full bg-secondary text-on-secondary flex items-center justify-center text-[11px] font-semibold shrink-0"
                                  x-text="ppInitials(opt.name)"></span>
                            <span class="flex-1 truncate" x-text="opt.name"></span>
                        </button>
                    </template>

                    <div x-show="ppOptions.length === 0" class="py-sm px-2 text-center font-body-md text-sm text-on-surface-variant">
                        <span x-show="pp.query">Nobody matches “<span x-text="pp.query"></span>”.</span>
                        <span x-show="!pp.query">Nobody to choose from.</span>
                    </div>
                </div>
            </div>
        </div>`;

    // The behaviour, for a host component to fold in. It knows nothing about
    // what is being chosen for — only that the host can hand it a list of
    // people, say which one is chosen, and be told when that changes.
    function mixin() {
        return {
            pp: { open: false, query: '', index: 0 },

            // ⚠ `ppPeople`, `ppSelectedId` and `ppSelect` ARE NOT DEFINED HERE,
            // on purpose. They are the host's half of the contract, and a
            // default for them here would silently win over the host's own — the
            // mixin is applied over the component, so a name it holds is a name
            // the component cannot have. Everything below reads them defensively
            // so a host that forgets one gets an empty picker rather than a page
            // that throws on first render.

            get ppOptions() {
                const q = String(this.pp.query || '').trim().toLowerCase();
                return (this.ppPeople || [])
                    .filter(p => p && p.id && (!q || String(p.name || '').toLowerCase().includes(q)))
                    .slice(0, LIMIT);
            },

            get ppSelectedName() {
                const id = this.ppSelectedId;
                if (!id) return '';
                const person = (this.ppPeople || []).find(p => p.id === id);
                // A name we cannot resolve is still a real choice — say so
                // rather than drawing the row as though nobody were chosen.
                return (person && person.name) || 'Someone';
            },

            ppInitials(name) {
                return String(name || '').trim().split(/\s+/).slice(0, 2)
                    .map(part => part.charAt(0).toUpperCase()).join('');
            },

            ppToggle() {
                if (this.pp.open) { this.ppClose(); return; }
                this.pp.open = true;
                this.pp.query = '';
                this.pp.index = 0;
                // Open and already typing: the point of the search box is that
                // nobody has to click it first.
                this.$nextTick(() => { if (this.$refs.ppSearch) this.$refs.ppSearch.focus(); });
            },

            ppClose() { this.pp.open = false; },

            ppMove(step) {
                const count = this.ppOptions.length;
                if (!count) return;
                this.pp.index = (this.pp.index + step + count) % count;
            },

            ppChoose(person) {
                if (typeof this.ppSelect === 'function') this.ppSelect(person);
                this.ppClose();
            },

            ppChooseHighlighted() {
                const opt = this.ppOptions[this.pp.index];
                if (opt) this.ppChoose(opt);
            },
        };
    }

    // Every placeholder on the page, INCLUDING THE ONES INSIDE A <template>.
    //
    // ⚠ THE TEMPLATES ARE THE WHOLE DIFFICULTY. Alpine's `x-if` and `x-for` are
    // <template> elements, and a template's children are inert: they live in a
    // separate fragment that `document.querySelectorAll` cannot see. A picker
    // inside a tab that is only built when you open it — which is exactly where
    // the Shepherding Profile's is — would silently never be filled in, and the
    // page would render a blank space with no error to explain it. So the walk
    // goes into `.content` as well, and injecting there is still injecting
    // BEFORE Alpine, because Alpine clones the finished template later.
    function slotsIn(root) {
        const found = Array.prototype.slice.call(root.querySelectorAll('[data-person-picker]'));
        root.querySelectorAll('template').forEach((t) => {
            if (t.content) found.push(...slotsIn(t.content));
        });
        return found;
    }

    // Fill every placeholder on the page. Each reads its own words off the
    // element, so two pickers on one screen can ask different questions.
    function inject(root) {
        slotsIn(root || document).forEach((slot) => {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = markup({
                label: slot.getAttribute('data-label') || '',
                // The dimmed half of the label — the aside that explains what
                // choosing somebody will do, rather than what the field is.
                hint: slot.getAttribute('data-hint') || '',
                empty: slot.getAttribute('data-empty') || 'Choose someone…',
                // A picker that must have an answer says so by leaving the
                // clearing row out.
                allowNobody: slot.getAttribute('data-required') === null,
            });
            slot.replaceWith(...wrapper.childNodes);
        });
    }

    const PersonPicker = { mixin, inject, markup };

    if (typeof module !== 'undefined' && module.exports) module.exports = PersonPicker;
    if (global) {
        global.PersonPicker = PersonPicker;
        // Same timing contract as roles-panel.js: the placeholders are above
        // this script, Alpine is deferred and comes after, so filling them now
        // is indistinguishable from having written the markup inline.
        if (typeof document !== 'undefined') inject(document);
    }
}(typeof window !== 'undefined' ? window : globalThis));
