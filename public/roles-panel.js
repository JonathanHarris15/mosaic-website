// Roles Panel — the one Roles surface, mounted in two places (MS-16).
//
// MS-99 built this for the Event detail screen: managed Role cards with numbered
// slots, the three assignment states, declined flagging, one-off Role strips, and
// the picker that shows who was passed over and why. The Sunday is the Event
// people staff every week, and its order of service is edited on a different page
// entirely — so the same surface is needed there too.
//
// A COPY WOULD DRIFT. The first time either page was touched the two would stop
// agreeing about what a declined slot looks like, or which Roles show, and the
// disagreement would be invisible until somebody staffed a Sunday from the wrong
// one. So the markup lives here once and both pages inject it.
//
// Only the MARKUP is shared. The behaviour behind it stays in eventDetailPage,
// which the service page mounts as a nested component scoped to that Sunday's
// occurrence — so there is one implementation of assigning somebody to a slot,
// not two that have to be kept in step.
//
// Injected synchronously, so this script must load AFTER the placeholders and
// BEFORE Alpine (which is deferred). Alpine then initialises over the finished
// markup exactly as if it had been written inline.
//
// A host page opts in with placeholders, and omits any part it does not want:
//
//     <div data-roles-panel='banner'></div>    the declined banner
//     <div data-roles-panel='roles'></div>     the Role cards
//     <div data-roles-panel='picker'></div>    the picker modal

(function (global) {
    'use strict';

    const BANNER = `
            <!-- ── Declined banner ────────────────────────────────────────── -->
            <!-- Declined escalates across four surfaces so a glance finds it:
                 the slot row, the role card's border, this banner, and the
                 calendar chip. All from one switch. -->
            <div x-show="isEditor && needsAttention"
                 class="mt-md bg-error-container border border-error border-l-4 rounded-lg p-md flex items-start gap-sm">
                <span class="material-symbols-outlined text-[22px] text-error shrink-0">error</span>
                <div class="flex-grow min-w-0">
                    <p class="font-label-md text-[15px] font-semibold text-on-error-container">
                        <span x-text="declined.length === 1 ? 'One place needs reassigning' : declined.length + ' places need reassigning'"></span>
                    </p>
                    <template x-for="a in declined" :key="a.personId + (a.slotId || a.oneOffId)">
                        <p class="text-[13px] text-on-error-container mt-1">
                            <span x-text="personName(a.personId)"></span> said no to
                            <span x-text="a.label || roleName(a.roleSlug)"></span>.
                            They still hold the place until someone takes it.
                        </p>
                    </template>
                </div>
                <button @click="openPicker(declined[0].roleSlug, declined[0].slotId)"
                        x-show="declined.length && declined[0].slotId"
                        class="shrink-0 bg-error text-on-error px-md py-2 rounded-lg font-label-md
                               text-xs uppercase tracking-wider cal-motion cal-press cal-focus">
                    Find someone
                </button>
`;

    const ROLES = `
                    <!-- ── Roles ──────────────────────────────────────────── -->
                    <!-- A Sunday gets this too. It only ever draws NON-liturgical
                         Roles — the liturgical ones are filled in the order of
                         service and print in the booklet, so a fillable card here
                         would be a second, silent way to set one. Hiding the whole
                         section on a Sunday, as this once did, meant the welcome
                         team and the sound desk had nowhere to be asked at all. -->
                    <section x-show="isEditor">
                        <div class="flex items-baseline justify-between gap-md">
                            <h2 class="font-display text-[19px] text-primary">Roles</h2>
                            <p class="text-[12.5px] text-on-surface-variant"
                               x-text="managedRoles.length + (managedRoles.length === 1 ? ' role' : ' roles') +
                                       (oneOffRoles.length ? ' · ' + oneOffRoles.length + ' just for this one' : '')"></p>
                        </div>

                        <p x-show="isSunday" class="text-[12.5px] text-on-surface-variant mt-1 leading-snug">
                            Preacher, reader and the rest are set when you build this Sunday's
                            order of service — not here. This is everything else: welcome team,
                            sound desk, coffee.
                        </p>

                        <p x-show="isEditor && !managedRoles.length && !oneOffRoles.length"
                           class="text-[13px] text-on-surface-variant mt-sm">
                            Nothing needed yet. Add a role below for this date only, or
                            <a :href="'calendar-event.html?series=' + occurrence.seriesId" x-show="occurrence.seriesId"
                               class="text-secondary cal-focus rounded">add one to every date</a>.
                        </p>

                        <!-- A managed Role IS a card: header, rule line, count
                             badge, numbered slot rows. -->
                        <div class="mt-sm flex flex-col gap-md">
                            <template x-for="role in managedRoles" :key="role.def.slug">
                                <div class="bg-surface-container-lowest rounded-lg border overflow-hidden cal-motion"
                                     :class="role.needsAttention ? 'border-error' : 'border-outline-variant'">

                                    <!-- \`cal-row\` is not decoration here: the remove button below is
                                         hover-revealed, and without a row to hover it never appears. -->
                                    <div class="cal-row bg-surface-container-low px-md py-2.5 flex items-center gap-sm border-b border-outline-variant">
                                        <span class="cal-role-glyph material-symbols-outlined text-[18px] text-secondary">badge</span>
                                        <span class="font-headline-lg text-[19px] text-on-surface flex-grow min-w-0 truncate"
                                              x-text="role.def.name"></span>
                                        <span x-show="(role.def.restrictions || []).length"
                                              class="flex items-center gap-1 text-[11.5px] text-on-surface-variant">
                                            <span class="material-symbols-outlined text-[14px]" style="color:#B89B6A;">rule</span>
                                            <span x-text="(role.def.restrictions || []).length + ' rule' + ((role.def.restrictions||[]).length === 1 ? '' : 's')"></span>
                                        </span>
                                        <span class="rounded-md px-2 py-0.5 text-[11.5px] font-label-md"
                                              :class="role.needsAttention
                                                ? 'bg-error-container text-on-error-container'
                                                : 'bg-surface-container text-on-surface-variant'"
                                              x-text="role.filled + ' of ' + role.slots.length"></span>
                                        <!-- WHICH Roles this Event carries is decided on the
                                             Event, not here. This screen decides who is
                                             standing in them today. -->
                                        <a x-show="eventHref" :href="eventHref"
                                           class="cal-role-everydate shrink-0 flex items-center gap-1 text-[11px] font-label-md
                                                  text-on-surface-variant hover:text-secondary cal-motion cal-focus rounded"
                                           title="Change which roles this event needs">
                                            <span class="material-symbols-outlined text-[14px]">repeat</span>
                                            Every date
                                        </a>
                                    </div>

                                    <template x-for="row in role.slots" :key="row.slot.id">
                                        <div class="cal-row cal-slot-row flex items-center gap-sm px-md py-2.5 border-b border-outline-variant last:border-b-0 cal-motion"
                                             :class="row.assignment && stateTone(row.assignment) === 'attention'
                                                ? 'bg-error-container border-l-[3px] border-l-error'
                                                : 'bg-surface'">
                                            <span class="cal-slot-index font-display text-[15px] text-outline w-[18px] shrink-0" x-text="row.index"></span>
                                            <span class="cal-slot-req w-[74px] shrink-0 text-[10px] font-label-md tracking-[.12em] uppercase text-on-surface-variant"
                                                  x-text="row.requirementLabel"></span>

                                            <template x-if="row.assignment">
                                                <div class="flex items-center gap-2 flex-grow min-w-0">
                                                    <span class="cal-slot-avatar w-[28px] h-[28px] rounded-full bg-surface-container-high
                                                                 flex items-center justify-center text-[11px] font-label-md shrink-0"
                                                          x-text="initials(personName(row.assignment.personId))"></span>
                                                    <div class="min-w-0">
                                                        <div class="text-[14.5px] truncate"
                                                             :class="stateTone(row.assignment) === 'attention'
                                                               ? 'font-semibold text-on-error-container' : 'text-on-surface'"
                                                             x-text="personName(row.assignment.personId)"></div>
                                                        <!-- Named, not just flagged. "Something is wrong
                                                             here" sends the editor hunting on a screen
                                                             that already knows the answer. -->
                                                        <div x-show="row.warning" class="text-[12px] text-on-error-container truncate"
                                                             x-text="row.warning && row.warning.text"></div>
                                                    </div>
                                                </div>
                                            </template>
                                            <template x-if="!row.assignment">
                                                <div class="flex items-center gap-2 flex-grow min-w-0">
                                                    <span class="cal-slot-avatar w-[28px] h-[28px] rounded-full border border-dashed border-outline
                                                                 flex items-center justify-center text-outline shrink-0">
                                                        <span class="material-symbols-outlined text-[15px]">person_add</span>
                                                    </span>
                                                    <!-- An empty place is a calm resting state, never an error. -->
                                                    <span class="text-[14px] text-on-surface-variant">Nobody yet</span>
                                                </div>
                                            </template>

                                            <!-- The roster breaks one of this Role's own rules
                                                 here. It is a Warning, never a refusal — the
                                                 editor put them there on purpose, or the data
                                                 moved underneath a roster that was fine when
                                                 it was made (ADR-0021). -->
                                            <template x-if="row.warning">
                                                <span class="shrink-0 inline-flex items-center gap-1 rounded-md
                                                             bg-error-container text-on-error-container border border-error
                                                             px-2 py-1 text-[10px] font-label-md uppercase tracking-wider"
                                                      :title="row.warning.text">
                                                    <span class="material-symbols-outlined text-[13px] text-error">error</span> Breaks a rule
                                                </span>
                                            </template>

                                            <!-- Declined is the only loud state. -->
                                            <template x-if="row.assignment && stateTone(row.assignment) === 'attention'">
                                                <span class="shrink-0 inline-flex items-center gap-1 rounded-md bg-error text-on-error
                                                             px-2 py-1 text-[10px] font-label-md uppercase tracking-wider">
                                                    <span class="material-symbols-outlined text-[13px]">do_not_disturb_on</span> Reassign
                                                </span>
                                            </template>
                                            <template x-if="row.assignment && stateTone(row.assignment) !== 'attention'">
                                                <span class="shrink-0 flex items-center gap-1.5">
                                                    <span class="w-[7px] h-[7px] rounded-full"
                                                          :class="stateTone(row.assignment) === 'good' ? 'bg-success' : 'border-[1.5px] border-outline'"></span>
                                                    <span class="text-[10px] font-label-md tracking-[.12em] uppercase"
                                                          :class="stateTone(row.assignment) === 'good' ? 'text-success' : 'text-on-surface-variant'"
                                                          x-text="stateLabel(row.assignment)"></span>
                                                </span>
                                            </template>

                                            <div x-show="isEditor" class="cal-row-actions shrink-0 flex items-center gap-0.5">
                                                <!-- Only an editor ever changes a state. Members doing
                                                     it for themselves is a later ticket. -->
                                                <template x-if="row.assignment">
                                                    <div class="flex items-center gap-0.5">
                                                        <button @click="setState(row.assignment, 'pending')" aria-label="Mark pending"
                                                                class="w-[30px] h-[30px] rounded-md flex items-center justify-center cal-motion cal-focus hover:bg-surface-container"
                                                                :class="row.assignment.state === 'pending' ? 'text-on-surface' : 'text-outline'">
                                                            <span class="material-symbols-outlined text-[18px]">radio_button_unchecked</span>
                                                        </button>
                                                        <button @click="setState(row.assignment, 'confirmed')" aria-label="Mark confirmed"
                                                                class="w-[30px] h-[30px] rounded-md flex items-center justify-center cal-motion cal-focus hover:bg-surface-container"
                                                                :class="row.assignment.state === 'confirmed' ? 'text-success' : 'text-outline'">
                                                            <span class="material-symbols-outlined text-[18px]">check_circle</span>
                                                        </button>
                                                        <button @click="setState(row.assignment, 'declined')" aria-label="Mark declined"
                                                                class="w-[30px] h-[30px] rounded-md flex items-center justify-center cal-motion cal-focus hover:bg-surface-container"
                                                                :class="row.assignment.state === 'declined' ? 'text-error' : 'text-outline'">
                                                            <span class="material-symbols-outlined text-[18px]">do_not_disturb_on</span>
                                                        </button>
                                                    </div>
                                                </template>
                                                <button @click="openPicker(role.def.slug, row.slot.id)"
                                                        class="w-[30px] h-[30px] rounded-md flex items-center justify-center text-on-surface-variant
                                                               hover:bg-surface-container cal-motion cal-focus"
                                                        :aria-label="row.assignment ? 'Replace' : 'Put someone in'">
                                                    <span class="material-symbols-outlined text-[18px]"
                                                          x-text="row.assignment ? 'swap_horiz' : 'person_add'"></span>
                                                </button>
                                                <button x-show="row.assignment" @click="clearSlot(role.def.slug, row.slot.id)"
                                                        class="w-[30px] h-[30px] rounded-md flex items-center justify-center text-on-surface-variant
                                                               hover:bg-surface-container cal-motion cal-focus" aria-label="Clear this place">
                                                    <span class="material-symbols-outlined text-[18px]">close</span>
                                                </button>
                                            </div>
                                        </div>
                                    </template>
                                </div>
                            </template>
                        </div>

                        <!-- A dashed strip holding one fenced-off box per job,
                             and inside each, one person per row. -->
                        <div x-show="oneOffRoles.length || isEditor"
                             class="mt-md cal-oneoff-strip rounded-lg bg-surface-container-low p-md">
                            <div class="text-[10.5px] font-label-md tracking-[.14em] uppercase text-on-surface-variant">
                                Just for this one
                            </div>
                            <div class="mt-sm flex flex-col gap-sm">
                                <template x-for="job in oneOffRoles" :key="job.id">
                                    <!-- Each job is fenced off from the strip it lives in. It stays
                                         lighter than a managed Role card — no filled header bar, no
                                         count chip — but a job with seven people on it needs an edge,
                                         or it runs into the next one. -->
                                    <div class="rounded-lg border border-outline-variant bg-surface overflow-hidden">
                                        <div class="flex items-center gap-2 px-3 py-2 border-b border-outline-variant bg-surface-container-lowest">
                                            <span class="material-symbols-outlined text-[17px] text-outline shrink-0">label</span>
                                            <span class="text-[14px] text-on-surface flex-grow min-w-0 truncate" x-text="job.label"></span>
                                            <span x-show="job.people.length"
                                                  class="shrink-0 text-[11px] text-on-surface-variant"
                                                  x-text="job.people.length"></span>
                                            <button x-show="isEditor && canEditRoleSet" @click="toggleOneOffOptions(job.id)"
                                                    class="shrink-0 w-[26px] h-[26px] rounded-md flex items-center justify-center
                                                           text-on-surface-variant hover:bg-surface-container cal-motion cal-focus"
                                                    :class="oneOffOptionsFor === job.id ? 'bg-surface-container text-on-surface' : ''"
                                                    aria-label="Settings for this job">
                                                <span class="material-symbols-outlined text-[16px]">tune</span>
                                            </button>
                                            <button x-show="isEditor && canEditRoleSet" @click="askRemoveOneOffRole(job.id)"
                                                    class="shrink-0 w-[26px] h-[26px] rounded-md flex items-center justify-center
                                                           text-on-surface-variant hover:bg-surface-container cal-motion cal-focus"
                                                    aria-label="Remove this job">
                                                <span class="material-symbols-outlined text-[16px]">delete</span>
                                            </button>
                                        </div>

                                        <!-- Collapsed by default, because a one-off is meant to be
                                             cheap: a label and some people. Both defaults are right
                                             almost every time, and every control shown here makes the
                                             cheap thing less cheap. But they have to be reachable —
                                             the person who unlocks the hall every week is doing real
                                             work, and without these fairness reads it as free. -->
                                        <div x-show="isEditor && canEditRoleSet && oneOffOptionsFor === job.id"
                                             x-cloak
                                             class="px-3 py-2.5 border-b border-outline-variant bg-surface-container-lowest flex flex-col gap-2">
                                            <label class="flex items-center gap-2 text-[13px] text-on-surface-variant">
                                                <span class="shrink-0">Rest between turns</span>
                                                <input type="number" min="0" step="0.25"
                                                       :value="job.intensity"
                                                       @change="setOneOffIntensity(job.id, $event.target.value)"
                                                       class="w-16 rounded-md border border-outline-variant bg-surface
                                                              text-[13px] text-on-surface px-2 py-1 cal-focus" />
                                                <span class="shrink-0">weeks</span>
                                            </label>
                                            <label class="flex items-start gap-2 text-[13px] text-on-surface-variant cursor-pointer">
                                                <input type="checkbox"
                                                       :checked="job.allowsAnotherRole"
                                                       @change="setOneOffExclusive(job.id, $event.target.checked)"
                                                       class="mt-[3px] w-3.5 h-3.5 shrink-0 accent-primary" />
                                                <span>They can also take another Role that day</span>
                                            </label>
                                        </div>

                                        <!-- One person per row. Somebody asked for one of these is
                                             still a real Assignment in a real state — it goes in
                                             pending like any other — so each row carries the same
                                             three marks as a managed slot row. Declined tones the
                                             whole row, because declined is the one state that has to
                                             find you. -->
                                        <template x-for="a in job.people" :key="a.personId">
                                            <div class="cal-row cal-slot-row flex items-center gap-sm px-3 py-2 border-b border-outline-variant cal-motion"
                                                 :class="stateTone(a) === 'attention'
                                                    ? 'bg-error-container border-l-[3px] border-l-error'
                                                    : 'bg-surface'">
                                                <span class="cal-slot-avatar w-[26px] h-[26px] rounded-full bg-surface-container-high shrink-0
                                                             flex items-center justify-center text-[10px] font-label-md"
                                                      x-text="initials(personName(a.personId))"></span>
                                                <span class="text-[14px] text-on-surface flex-grow min-w-0 truncate"
                                                      x-text="personName(a.personId)"></span>

                                                <!-- A reader still needs to know where this stands. -->
                                                <span x-show="!isEditor" class="shrink-0 flex items-center gap-1.5">
                                                    <span class="w-[7px] h-[7px] rounded-full"
                                                          :class="stateTone(a) === 'good' ? 'bg-success'
                                                                : (stateTone(a) === 'attention' ? 'bg-error' : 'border-[1.5px] border-outline')"></span>
                                                    <span class="text-[10px] font-label-md tracking-[.12em] uppercase"
                                                          :class="stateTone(a) === 'good' ? 'text-success' : 'text-on-surface-variant'"
                                                          x-text="stateLabel(a)"></span>
                                                </span>

                                                <span x-show="isEditor" class="cal-slot-actions shrink-0 flex items-center gap-0.5">
                                                    <button @click="setState(a, 'pending')" :aria-label="'Mark ' + personName(a.personId) + ' pending'"
                                                            class="w-[28px] h-[28px] rounded-md flex items-center justify-center cal-motion cal-focus hover:bg-surface-container"
                                                            :class="a.state === 'pending' ? 'text-on-surface' : 'text-outline'">
                                                        <span class="material-symbols-outlined text-[17px]">radio_button_unchecked</span>
                                                    </button>
                                                    <button @click="setState(a, 'confirmed')" :aria-label="'Mark ' + personName(a.personId) + ' confirmed'"
                                                            class="w-[28px] h-[28px] rounded-md flex items-center justify-center cal-motion cal-focus hover:bg-surface-container"
                                                            :class="a.state === 'confirmed' ? 'text-success' : 'text-outline'">
                                                        <span class="material-symbols-outlined text-[17px]">check_circle</span>
                                                    </button>
                                                    <button @click="setState(a, 'declined')" :aria-label="'Mark ' + personName(a.personId) + ' declined'"
                                                            class="w-[28px] h-[28px] rounded-md flex items-center justify-center cal-motion cal-focus hover:bg-surface-container"
                                                            :class="a.state === 'declined' ? 'text-error' : 'text-outline'">
                                                        <span class="material-symbols-outlined text-[17px]">do_not_disturb_on</span>
                                                    </button>
                                                    <button @click="removeFromOneOff(job.id, a.personId)"
                                                            class="w-[28px] h-[28px] rounded-md flex items-center justify-center text-on-surface-variant
                                                                   hover:bg-surface-container cal-motion cal-focus"
                                                            :aria-label="'Take ' + personName(a.personId) + ' off'">
                                                        <span class="material-symbols-outlined text-[17px]">close</span>
                                                    </button>
                                                </span>
                                            </div>
                                        </template>

                                        <div x-show="isEditor" class="px-3 py-1.5 bg-surface-container-lowest">
                                            <select @change="addToOneOff(job, $event.target.value); $event.target.value = ''"
                                                    class="cal-focus bg-transparent text-[12.5px] text-secondary border-0 cursor-pointer py-1">
                                                <option value="">+ Someone</option>
                                                <template x-for="p in people" :key="p.id">
                                                    <option :value="p.id" x-text="p.name"></option>
                                                </template>
                                            </select>
                                        </div>
                                    </div>
                                </template>

                                <!-- Adding one is a single always-visible input.
                                     It should take seconds.
                                     Absent where the panel only fills Roles — the
                                     service page's Roles tab staffs a Sunday, it
                                     does not decide what the Sunday needs. -->
                                <div x-show="isEditor && canEditRoleSet" class="flex items-center gap-2 pt-1">
                                    <span class="material-symbols-outlined text-[17px] text-outline">add</span>
                                    <input x-model="oneOffDraft" @keydown.enter="addOneOffRole()"
                                           placeholder="Someone to unlock the hall…"
                                           class="flex-grow bg-transparent border-0 border-b border-dashed border-outline-variant
                                                  text-[14px] text-on-surface placeholder:text-outline py-1 cal-focus" />
                                    <span class="text-[11px] text-outline font-label-md">Press Enter</span>
                                </div>
                            </div>
                        </div>

                        <!-- WHICH Roles this Event needs is decided on the Event, so
                             there is nothing to add here — only a way through to
                             where it IS decided. What this screen adds is a job for
                             this day alone, which is the strip above. -->
                        <a x-show="isEditor && eventHref" :href="eventHref"
                           class="mt-md inline-flex items-center gap-1 text-secondary text-[12px] font-label-md
                                  uppercase tracking-wider cal-focus">
                            <span class="material-symbols-outlined text-[15px]">tune</span>
                            <span x-text="isSunday
                              ? 'Change the roles every Sunday needs'
                              : 'Change the roles this event needs'"></span>
                        </a>
                    </section>
`;

    const PICKER = `
    <!-- ── The picker ─────────────────────────────────────────────────────── -->
    <!-- z-70, not the z-50 this had while it only ever opened over the Event
         page. The service page docks a save bar at z-60 on a phone, which would
         otherwise sit on top of the picker — over the Assign button, at the
         bottom, exactly where a thumb goes. The picker is the frontmost thing on
         either page, so it says so. -->
    <div x-show="picker.open" @keydown.escape.window="closePicker()"
         class="fixed inset-0 z-[70] bg-on-surface/30 flex items-start justify-center overflow-y-auto p-4">
        <div class="bg-surface-container-lowest rounded-lg border border-outline-variant w-full max-w-[640px] mt-[6vh]">
            <div class="px-md py-md border-b border-outline-variant">
                <div class="text-[10.5px] font-label-md tracking-[.14em] uppercase text-on-surface-variant"
                     x-text="pickerTitle"></div>
                <h3 class="font-display text-[21px] text-primary mt-1">Who's taking this place?</h3>
                <div class="mt-2 flex items-center gap-2 flex-wrap">
                    <span x-show="pickerSlot && pickerSlot.requirement === 'female'"
                          class="inline-flex items-center gap-1 rounded-md bg-tertiary-container text-on-tertiary-container px-2 py-1 text-[11px] font-label-md">
                        <span class="material-symbols-outlined text-[13px]">woman</span> Needs a woman
                    </span>
                    <span x-show="pickerSlot && pickerSlot.requirement === 'male'"
                          class="inline-flex items-center gap-1 rounded-md bg-tertiary-container text-on-tertiary-container px-2 py-1 text-[11px] font-label-md">
                        <span class="material-symbols-outlined text-[13px]">person</span> Needs a man
                    </span>
                    <template x-for="rule in (pickerRole && pickerRole.restrictions) || []" :key="rule.kind + (rule.typeId||rule.tagId||'')">
                        <span class="inline-flex items-center gap-1 rounded-md bg-surface-container text-on-surface-variant px-2 py-1 text-[11px] font-label-md">
                            <span class="material-symbols-outlined text-[13px]">rule</span>
                            <span x-text="rule.kind"></span>
                        </span>
                    </template>
                </div>
            </div>

            <div class="px-md py-sm border-b border-outline-variant">
                <div class="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-3 py-2">
                    <span class="material-symbols-outlined text-[18px] text-outline">search</span>
                    <input x-model="picker.query" placeholder="Search people"
                           class="flex-grow bg-transparent border-0 text-[14px] cal-focus" />
                </div>
                <div class="mt-2 flex items-center justify-between gap-sm">
                    <!-- Hidden while the candidates are still being worked out.
                         "0 can take it" is a wrong answer, not a pending one. -->
                    <span class="text-[12.5px] text-on-surface-variant" x-show="!picker.loading"
                          x-text="eligibleCount + ' free · ' + blockedCount + ' would break a rule'"></span>
                    <!-- OFF by default. Seeing who was passed over is the point. -->
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" x-model="picker.hideBlocked" class="accent-primary cal-focus" />
                        <span class="text-[12px] text-on-surface-variant">Only the free ones</span>
                    </label>
                </div>
            </div>

            <div class="max-h-[45vh] overflow-y-auto">
                <!-- Nothing until the privacy tags are in. An empty tag list
                     offers everyone, so a list drawn mid-read would print the
                     names those tags exist to hide. -->
                <div x-show="picker.loading" class="px-md py-8 text-center text-[13px] text-on-surface-variant">
                    Checking who can take it…
                </div>

                <template x-for="c in (picker.loading ? [] : candidates)" :key="c.personId">
                    <!-- A blocked row is READABLE AND PICKABLE. Eligibility
                         advises; the editor decides (ADR-0021). It is dimmed so
                         the fair picks lead the eye, never disabled. -->
                    <button @click="pick(c)"
                            class="w-full text-left flex items-center gap-sm px-md py-2.5 border-b border-outline-variant cal-motion"
                            :class="{
                                'opacity-[.6]': !c.eligible && picker.picked !== c.personId,
                                'bg-error-container': !c.eligible && picker.picked === c.personId,
                                'bg-surface-container': c.eligible && picker.picked === c.personId,
                                'hover:bg-surface-container-low': picker.picked !== c.personId
                            }">
                        <span class="w-[30px] h-[30px] rounded-full bg-surface-container-high flex items-center
                                     justify-center text-[11px] font-label-md shrink-0"
                              x-text="initials(c.name)"></span>
                        <div class="min-w-0 flex-grow">
                            <div class="text-[14px] text-on-surface truncate" x-text="c.name"></div>
                            <!-- The reason, in the same slot a fairness note
                                 would sit — and where an auto-assign suggestion
                                 will sit later, with no relayout needed. -->
                            <div class="text-[12px] text-on-surface-variant truncate" x-text="c.subtitle"></div>
                        </div>
                        <span x-show="!c.eligible && picker.picked !== c.personId"
                              class="material-symbols-outlined text-[18px] text-error shrink-0">error</span>
                        <span x-show="picker.picked === c.personId"
                              class="material-symbols-outlined text-[20px] shrink-0"
                              :class="c.eligible ? 'text-primary' : 'text-error'">check_circle</span>
                    </button>
                </template>
            </div>

            <div class="px-md py-md border-t border-outline-variant flex items-center justify-between gap-md flex-wrap">
                <p class="text-[12.5px] text-on-surface-variant" x-text="pickerConsequence"></p>
                <div class="flex items-center gap-sm ml-auto">
                    <button @click="closePicker()"
                            class="px-md py-2 rounded-lg font-label-md text-xs uppercase tracking-wider
                                   text-on-surface-variant cal-motion cal-focus hover:bg-surface-container">Cancel</button>
                    <button @click="confirmPick()" :disabled="!picker.picked"
                            class="bg-primary text-on-primary px-md py-2 rounded-lg shadow-xs font-label-md
                                   text-xs uppercase tracking-wider cal-motion cal-press cal-focus disabled:opacity-40">
                        Put them in
                    </button>
                </div>
            </div>
        </div>
    </div>
`;

    const MARKUP = { banner: BANNER, roles: ROLES, picker: PICKER };

    // Fill every placeholder this page carries. A missing one is not an error —
    // a page shows the parts of the panel it wants.
    //
    // Recurses into <template> elements, because their contents live in a
    // separate document fragment that document.querySelector cannot see. The
    // service page needs that: its Roles pane is behind an x-if so the panel is
    // built when the tab is opened and the Sunday's date is known, rather than
    // at page load when it is not.
    function fill(root) {
        if (!root || !root.querySelectorAll) return;

        Object.keys(MARKUP).forEach(function (name) {
            const slots = root.querySelectorAll('[data-roles-panel="' + name + '"]');
            Array.prototype.forEach.call(slots, function (slot) {
                slot.innerHTML = MARKUP[name];
            });
        });

        // Terminates: the markup just injected carries x-for templates, and none
        // of those hold a placeholder.
        Array.prototype.forEach.call(root.querySelectorAll('template'), function (t) {
            fill(t.content);
        });
    }

    function mount(doc) {
        fill(doc || (typeof document !== 'undefined' ? document : null));
    }

    const RolesPanel = { MARKUP: MARKUP, mount: mount };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RolesPanel;
    }
    if (global) {
        global.RolesPanel = RolesPanel;
        mount(global.document);
    }
})(typeof window !== 'undefined' ? window : null);
