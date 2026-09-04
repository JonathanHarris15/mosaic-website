// Adding somebody to the directory without leaving the form (MS-403).
//
// A person question offers the people the directory already knows. When the
// name being typed is not one of them, an editor gets a way to add them there
// and then — and this is that card, written once for both pages that draw a
// question, the same way FormQuestionMarkup writes the question itself.
//
// ⚠ THE CARD DOES NOT WRITE ANYTHING. It gathers what was typed, tidies it,
// and hands it to the page's own createPerson(details). That is not ceremony:
// the two pages reach the directory through genuinely different doors and
// always will. The elder's Form Document is a signed-in page that writes
// `people` under the security rules like every other elder surface; the
// fill-in page touches no Firestore at all (ADR-0051) and must go through the
// one callable it is allowed to call. One card, two doors, and neither door is
// decided here.
//
// What a host page owes:
//
//   createPerson(details)  write them and answer with { id, name }. Throw with
//                          a message a person can read if it will not go
//                          through — the card shows it and stays open.
//   pickPerson(q, person)  already owed for the picker; the card calls it so
//                          the new Person lands as the answer straight away.
//
// And it mounts the markup into a <div data-new-person-card></div> before
// Alpine boots, then spreads NewPersonCard.state() into its Alpine data.

(function (global) {
    'use strict';

    // What goes to the door, from what was typed. Trimmed, and empty strings
    // rather than absent keys: a contact with three blanks is the shape the
    // People manager already writes, and a Person whose contact is missing
    // reads as a Person nobody has ever been able to reach.
    function tidy(fields) {
        const f = fields || {};
        const text = (v) => String(v == null ? '' : v).trim();
        return {
            name: text(f.name).slice(0, 120),
            sex: f.sex === 'male' || f.sex === 'female' ? f.sex : '',
            birthday: text(f.birthday),
            email: text(f.email).slice(0, 200),
            phone: text(f.phone).slice(0, 40),
            address: text(f.address).slice(0, 300),
        };
    }

    // The one thing the card refuses on its own. Everything else is optional,
    // because a name and nothing else is a real thing to know about somebody
    // you have just been told about.
    function whatIsWrong(details) {
        if (!details || !details.name) return 'They need a name.';
        if (details.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(details.birthday)) {
            return 'That birthday is not a date.';
        }
        return '';
    }

    const CARD = [
        '<template x-if="newPerson.open">',
        '    <div class="np-veil" @click.self="closeNewPerson()" @keydown.escape.window="closeNewPerson()">',
        '        <div class="np-card" role="dialog" aria-modal="true" aria-label="Add somebody to the directory">',
        '            <div class="np-card__head">',
        '                <h2>Add to the directory</h2>',
        '                <p>They become a Person in the Membership Directory from now on, not just an answer on this form.</p>',
        '            </div>',
        '            <div class="np-card__body">',
        '                <p class="np-card__problem" x-show="newPerson.problem" x-text="newPerson.problem"></p>',
        '                <label class="np-f"><span>Name</span>',
        '                    <input type="text" x-model="newPerson.name" placeholder="Jane Example" maxlength="120" />',
        '                </label>',
        '                <div class="np-pair">',
        '                    <label class="np-f"><span>Sex</span>',
        '                        <select x-model="newPerson.sex">',
        '                            <option value="">Not said</option>',
        '                            <option value="male">Male</option>',
        '                            <option value="female">Female</option>',
        '                        </select>',
        '                    </label>',
        '                    <label class="np-f"><span>Birthday</span>',
        '                        <input type="date" x-model="newPerson.birthday" />',
        '                    </label>',
        '                </div>',
        '                <div class="np-pair">',
        '                    <label class="np-f"><span>Email</span>',
        '                        <input type="email" x-model="newPerson.email" autocomplete="off" />',
        '                    </label>',
        '                    <label class="np-f"><span>Phone</span>',
        '                        <input type="tel" x-model="newPerson.phone" autocomplete="off" />',
        '                    </label>',
        '                </div>',
        '                <label class="np-f"><span>Address</span>',
        '                    <input type="text" x-model="newPerson.address" autocomplete="off" />',
        '                </label>',
        '                <p class="fa-person__none">Their family, tags and shepherding record are added in the Membership Directory.</p>',
        '            </div>',
        '            <div class="np-card__acts">',
        '                <button type="button" class="m-btn m-btn--quiet" @click="closeNewPerson()" :disabled="newPerson.busy">Cancel</button>',
        '                <button type="button" class="m-btn m-btn--primary" @click="saveNewPerson()" :disabled="newPerson.busy">',
        '                    <span class="m-btn__label" x-text="newPerson.busy ? \'Adding…\' : \'Add them\'"></span>',
        '                </button>',
        '            </div>',
        '        </div>',
        '    </div>',
        '</template>',
    ].join('\n');

    const BLANK = {
        open: false, question: null, busy: false, problem: '',
        name: '', sex: '', birthday: '', email: '', phone: '', address: '',
    };

    function state() {
        return {
            newPerson: Object.assign({}, BLANK),

            // Opened from the picker, carrying whatever was typed into it —
            // the name is the one thing they have already said, and asking for
            // it twice is how a person decides the button did nothing.
            openNewPerson(q, name) {
                this.newPerson = Object.assign({}, BLANK, {
                    open: true, question: q || null, name: String(name || '').trim(),
                });
            },

            closeNewPerson() {
                if (this.newPerson.busy) return;
                this.newPerson = Object.assign({}, BLANK);
            },

            async saveNewPerson() {
                if (this.newPerson.busy) return;
                const details = tidy(this.newPerson);
                const wrong = whatIsWrong(details);
                if (wrong) { this.newPerson.problem = wrong; return; }
                this.newPerson.busy = true;
                this.newPerson.problem = '';
                try {
                    const person = await this.createPerson(details);
                    if (!person || !person.id) throw new Error('They were not added.');
                    const q = this.newPerson.question;
                    this.newPerson = Object.assign({}, BLANK);
                    if (q) this.pickPerson(q, person);
                } catch (e) {
                    this.newPerson.busy = false;
                    this.newPerson.problem = (e && e.message) || 'They could not be added.';
                }
            },
        };
    }

    // Same slot-filling as FormQuestionMarkup: the page leaves an empty div
    // and this puts the real markup in it before Alpine walks the page.
    function mount(root) {
        const scope = root || (typeof document !== 'undefined' ? document : null);
        if (!scope) return 0;
        let filled = 0;
        scope.querySelectorAll('[data-new-person-card]').forEach(slot => {
            slot.innerHTML = CARD;
            filled += 1;
        });
        return filled;
    }

    const NewPersonCard = { CARD, BLANK, tidy, whatIsWrong, state, mount };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = NewPersonCard;
    }
    if (global) {
        global.NewPersonCard = NewPersonCard;
    }
})(typeof window !== 'undefined' ? window : null);
