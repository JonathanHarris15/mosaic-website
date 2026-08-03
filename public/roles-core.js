// Roles Core — the pure model for Roles (ADR-0016, MS-13).
//
// All serving participation is a Role, recorded as Involvement. Roles come in
// two families:
//
//   • liturgical — preacher, service leader, worship leader… Code-defined and
//                  LOCKED: undeletable, uneditable, and still wired into the
//                  Service entity and the Service Guide. They have no editable
//                  definition. (The registry lands in MS-25.)
//   • servant    — kids, setup/teardown, coffee, sound… Authored by an editor
//                  in the Roles Manager as a Role Definition.
//
// A Role Definition is name + ordered slots + restriction rules (MS-24). Each
// slot requires male, female, or either; needing three people means three
// slots. The slot — not a count beside a sex rule — is the unit of assignment,
// so a specific person can be pinned to a specific slot.
//
// Slot ids are stable and never re-issued. An assignment points at a slot id,
// so recycling one would silently inherit the previous slot's person.
//
// Loaded as a classic <script> (window.RolesCore) and exported for Node tests.

(function (global) {
    'use strict';

    // ── The two families ──────────────────────────────────────────────────────

    const FAMILIES = Object.freeze({
        LITURGICAL: 'liturgical',
        SERVANT: 'servant',
    });

    // ── What a slot requires of the person filling it ─────────────────────────

    const REQUIREMENTS = Object.freeze({
        MALE: 'male',
        FEMALE: 'female',
        EITHER: 'either',
    });

    const REQUIREMENT_VALUES = Object.freeze([
        REQUIREMENTS.MALE,
        REQUIREMENTS.FEMALE,
        REQUIREMENTS.EITHER,
    ]);

    function isRequirement(value) {
        return REQUIREMENT_VALUES.indexOf(value) !== -1;
    }

    // ── The locked, code-defined liturgical Roles ─────────────────────────────
    //
    // These six are the `type` values the app already writes as Involvement.
    // They stay locked (ADR-0016 §1, Option A): unifying the CONCEPT of a Role
    // costs nothing, but making these editable data would mean rebuilding the
    // Service entity and the Service Guide component system — destabilising the
    // artefact that has to print correctly every Sunday.
    //
    // The names are user-facing strings the guide and calendar already render.
    // Changing one here silently changes the printed booklet.
    const LITURGICAL_ROLES = Object.freeze([
        { slug: 'service_leader', name: 'Service Leader' },
        { slug: 'preacher', name: 'Preacher' },
        { slug: 'worship_leader', name: 'Music Leader' },
        { slug: 'worship_helper', name: 'Music Helper' },
        { slug: 'sermonette', name: 'Sermonette' },
        { slug: 'prayer', name: 'Prayer' },
    ].map(role => Object.freeze(Object.assign({}, role, {
        family: FAMILIES.LITURGICAL,
        locked: true,
    }))));

    const LITURGICAL_SLUGS = Object.freeze(LITURGICAL_ROLES.map(r => r.slug));

    // A Role is locked when it is one of the code-defined liturgical ones. Locked
    // Roles have no editable definition — no slots, no restrictions — because
    // they are assigned through the Service entity, as they always have been.
    function isLocked(role) {
        return !!role && (role.locked === true || role.family === FAMILIES.LITURGICAL);
    }

    function assertEditable(role) {
        if (isLocked(role)) {
            throw new Error(
                'Role "' + ((role && role.name) || '?') + '" is locked: liturgical Roles are ' +
                'code-defined and cannot be edited.'
            );
        }
    }

    function assertDeletable(role) {
        if (isLocked(role)) {
            throw new Error(
                'Role "' + ((role && role.name) || '?') + '" is locked: liturgical Roles are ' +
                'always present and cannot be deleted.'
            );
        }
    }

    // Involvement records a Role by slug, so a Servant Role needs one too. It is
    // derived from the name ONCE, at creation, and then stored — renaming the
    // Role afterwards must not change the slug, or every Involvement record
    // already written under the old one would be orphaned.
    function slugify(name) {
        return String(name || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    const slugOf = def => (def && def.slug) || slugify(def && def.name);

    // Every Role that exists, both families, liturgical first. This is the single
    // list the Roles Manager and the Roles tab render — the whole point of
    // Option A is that the user sees one roles list, not two.
    function allRoles(servantDefinitions) {
        const servant = (servantDefinitions || []).map(def => {
            const slug = slugOf(def);
            if (LITURGICAL_SLUGS.indexOf(slug) !== -1) {
                throw new Error(
                    'Servant Role "' + def.name + '" would take the liturgical slug "' + slug +
                    '", which would mix its Involvement history with the liturgical Role\'s.'
                );
            }
            return Object.assign({}, def, { slug: slug, family: FAMILIES.SERVANT, locked: false });
        });
        return LITURGICAL_ROLES.concat(servant);
    }

    function roleBySlug(slug, servantDefinitions) {
        return allRoles(servantDefinitions).find(role => role.slug === slug) || null;
    }

    // ── Slot identity ─────────────────────────────────────────────────────────

    // Slot ids are `s<n>`. The next one is one past the highest `n` ever used in
    // this definition — not `slots.length + 1`, which would re-issue the id of a
    // removed middle slot and hand its assignments to a brand-new slot.
    function nextSlotId(def) {
        const highest = (def && def.slots ? def.slots : []).reduce((max, slot) => {
            const n = parseInt(String(slot && slot.id).replace(/^s/, ''), 10);
            return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        return 's' + (highest + 1);
    }

    // ── Reading a definition ──────────────────────────────────────────────────

    const slotsOf = def => (def && Array.isArray(def.slots) ? def.slots : []);

    // The ordered slot ids — the order an editor authored, which the Roles tab
    // renders and auto-assign fills in turn.
    function slotOrder(def) {
        return slotsOf(def).map(slot => slot.id);
    }

    // How many people this Role needs: one per slot.
    function slotCount(def) {
        return slotsOf(def).length;
    }

    // ── Building a definition ─────────────────────────────────────────────────

    // A fresh Servant Role Definition: named, with a single either-slot so it is
    // valid the moment it is created and the editor can narrow it from there.
    function newDefinition(name) {
        return {
            name: name,
            slug: slugify(name),
            family: FAMILIES.SERVANT,
            slots: [{ id: 's1', requirement: REQUIREMENTS.EITHER }],
            restrictions: [],
            // Written explicitly rather than left absent, so the Roles Manager
            // form has something to render and the defaults are visible to the
            // editor rather than implied.
            intensity: DEFAULT_INTENSITY,
            allowsAnotherRole: false,
        };
    }

    // Every mutator returns a new definition; none touches its input, so a UI can
    // hold the previous value for cancel/undo. Each refuses a locked Role: the
    // guard lives here, in the model, so a UI that forgets to hide the edit
    // controls still cannot rewrite a liturgical Role.
    function withSlots(def, slots) {
        return Object.assign({}, def, { slots: slots });
    }

    function addSlot(def, requirement) {
        assertEditable(def);
        if (!isRequirement(requirement)) {
            throw new Error('Unknown slot requirement: ' + requirement);
        }
        return withSlots(def, slotsOf(def).concat([
            { id: nextSlotId(def), requirement: requirement },
        ]));
    }

    function removeSlot(def, slotId) {
        assertEditable(def);
        return withSlots(def, slotsOf(def).filter(slot => slot.id !== slotId));
    }

    function setSlotRequirement(def, slotId, requirement) {
        assertEditable(def);
        if (!isRequirement(requirement)) {
            throw new Error('Unknown slot requirement: ' + requirement);
        }
        return withSlots(def, slotsOf(def).map(slot => (
            slot.id === slotId ? Object.assign({}, slot, { requirement: requirement }) : slot
        )));
    }

    // Move the slot at `from` to sit at `to`. Identity and requirement travel
    // with the slot — reordering re-sequences, it never rewrites a slot.
    function reorderSlots(def, from, to) {
        assertEditable(def);
        const slots = slotsOf(def);
        const inRange = i => Number.isInteger(i) && i >= 0 && i < slots.length;
        if (!inRange(from) || !inRange(to) || from === to) return withSlots(def, slots.slice());

        const next = slots.slice();
        next.splice(to, 0, next.splice(from, 1)[0]);
        return withSlots(def, next);
    }

    // ── Restrictions: who may fill a slot ─────────────────────────────────────
    //
    // Rules are written against data that already exists — Shepherding Tags and
    // the Relationship graph — so a church configures serving with the same
    // vocabulary it already uses for everything else.

    const RESTRICTIONS = Object.freeze({
        REQUIRE_TAG: 'requireTag',          // only people carrying the Tag
        EXCLUDE_TAG: 'excludeTag',          // nobody carrying the Tag
        NOT_TOGETHER: 'notTogether',        // no two people joined by a Relationship Type
        NOT_SAME_GROUP: 'notSameGroup',     // no two people from one Relationship Group
        SAME_GROUP: 'sameGroup',            // everyone from ONE Relationship Group
        ALLOWLIST: 'allowlist',             // only these named people
    });

    // Why somebody was passed over. The Roles tab and auto-assign both have to
    // explain themselves, so ineligibility is always a reason, never a silent
    // omission from the list.
    const REASONS = Object.freeze({
        INACTIVE: 'inactive',
        ALREADY_ASSIGNED: 'alreadyAssigned',
        SERVING_ELSEWHERE: 'servingElsewhere',          // holding another Role at this Event
        SEX_MISMATCH: 'sexMismatch',
        SEX_UNKNOWN: 'sexUnknown',
        MISSING_REQUIRED_TAG: 'missingRequiredTag',
        EXCLUDED_BY_TAG: 'excludedByTag',
        NOT_ON_ALLOWLIST: 'notOnAllowlist',             // this Role is kept to a named few
        RELATIONSHIP_CONFLICT: 'relationshipConflict',
        SAME_GROUP_CONFLICT: 'sameGroupConflict',       // already someone here from their group
        NOT_IN_REQUIRED_GROUP: 'notInRequiredGroup',    // not in the group this Role is drawn from
        // Only a whole-roster answer can produce these two: nobody can be
        // offered a Role or a place that has since stopped existing, but a
        // roster written last month can certainly still name one.
        UNKNOWN_ROLE: 'unknownRole',
        UNKNOWN_SLOT: 'unknownSlot',
    });

    // ── How much rest a Role owes the person who does it ─────────────────────
    //
    // Measured in WEEKS (ADR-0020). Sound is 1 — every week is fine. Setup is 4
    // — a month before asking again. Coffee is 1.25: nearly every week, with the
    // occasional break. Fairness sums these over its window, which is why load
    // comes out in the same unit as the window and "spent" needs no constant.
    //
    // 0 is a real value, not an absent one: the job is free. It still counts as
    // serving and still moves the person's recency — it just never makes them
    // look busy.
    //
    // Only a Servant Role keeps its intensity here. A liturgical Role has no
    // stored definition and must never have one, and a one-off Role has no
    // definition at all — both are resolved by EventsCore, which can see the
    // series and the Event.
    const DEFAULT_INTENSITY = 1;

    // A stored value that is not a usable number reads as the default. A single
    // bad field must not poison every load calculation in the church.
    function isUsableIntensity(raw) {
        return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0;
    }

    function intensityOf(def) {
        const raw = def && def.intensity;
        return isUsableIntensity(raw) ? raw : DEFAULT_INTENSITY;
    }

    // ── Whether doing a Role uses up your morning ────────────────────────────
    //
    // EXCLUSIVE IS THE DEFAULT AND THE ASSUMPTION. An absent flag means the Role
    // occupies you, because the Role nobody has thought about must not quietly
    // double-book people.
    //
    // Distinct from intensity, and the two are easy to confuse: intensity says
    // this job TIRES you, exclusivity says this job OCCUPIES you. Sound is
    // plausibly intensity 1 and exclusive — easy work, but you are stuck at the
    // desk all morning.
    function allowsAnotherRole(role) {
        return !!role && role.allowsAnotherRole === true;
    }

    // The most Roles one person may hold at one Event, and only when every one
    // of them permits it.
    const MAX_ROLES_PER_PERSON = 2;

    // An Inactive Person carries no Membership Stage and is off the Track, so
    // they are never proposed — while every Involvement record they already have
    // stays exactly as it was. Reads the current flag and the status value it
    // replaced, so eligibility is right before every record is migrated.
    function isInactive(person) {
        const m = (person && person.membership) || {};
        return m.inactive === true || m.status === 'inactive';
    }

    // ── Who may even be offered ──────────────────────────────────────────────
    //
    // DISTINCT FROM ELIGIBILITY, and the difference is the whole design of the
    // picker. An ineligible Person is SHOWN, blocked, with a reason — seeing who
    // was passed over is the point. These two are not that:
    //
    //   • Somebody no longer active has left. They are not a candidate who lost,
    //     they are not a candidate, and a blocked row for them is an answer to a
    //     question nobody asked.
    //   • Somebody hidden by a tag must not appear AT ALL. A blocked row saying
    //     why they cannot serve still prints the name the tag exists to hide,
    //     which is the tag failing at the one job it has.
    //
    // `hidingTags` are the tag ids whose `people_tags` document carries
    // `hidePeople: true`. Elders and super admins are who those tags hide people
    // FROM everyone else for, so they still see them.
    const SEES_HIDDEN = Object.freeze(['elder', 'super_admin']);

    function assignablePeople(people, options) {
        const opts = options || {};
        const hiding = opts.hidingTags || [];
        const seesHidden = SEES_HIDDEN.indexOf(opts.rank) !== -1;

        return (people || []).filter(person => {
            if (isInactive(person)) return false;
            if (seesHidden) return true;
            if (person && person.shepherdingHidden) return false;
            return !((person && person.tags) || []).some(tag => hiding.indexOf(tag) !== -1);
        });
    }

    function carriesTag(person, tagId) {
        return ((person && person.tags) || []).indexOf(tagId) !== -1;
    }

    // Is there an edge of this Relationship Type between the two? Edges are
    // stored one way round (`fromId` is the priority holder), but "may not serve
    // together" is symmetric, so both orientations count.
    function joinedBy(relationships, typeId, a, b) {
        return (relationships || []).some(edge => (
            edge.typeId === typeId && (
                (edge.fromId === a && edge.toId === b) ||
                (edge.fromId === b && edge.toId === a)
            )
        ));
    }

    // ── Relationship Group membership (MS-141) ────────────────────────────────
    //
    // A Relationship Group is a roster: { id, typeId, name, leaderId, memberIds }.
    //
    // The LEADER IS NOT IN `memberIds` — deliberately, since the Relations Viewer
    // draws them outside the bubble with a line to it (ADR-0014 §5). So the
    // obvious memberIds check silently misses every group leader, and for serving
    // that is the worst way to be wrong: the house-group leader would read as
    // being in no group, and a same-group rule would exclude the very person most
    // likely to be organising the Role.
    //
    // RelationshipGroupCore.belongsTo answers this already, but the *-core modules
    // here are deliberately independent of one another, so the rule is restated.
    // A test asserts the two agree, precisely because a duplicated domain rule is
    // a rule that can drift.
    function inGroup(group, personId) {
        if (!group || !personId) return false;
        if (group.leaderId === personId) return true;
        return (group.memberIds || []).indexOf(personId) !== -1;
    }

    // The groups of one Type that a Person belongs to.
    function groupsFor(groups, typeId, personId) {
        return (groups || []).filter(g => g && g.typeId === typeId && inGroup(g, personId));
    }

    // The groups of one Type that two People both belong to.
    function sharedGroups(groups, typeId, a, b) {
        return groupsFor(groups, typeId, a).filter(g => inGroup(g, b));
    }

    const restrictionsOf = def => (def && Array.isArray(def.restrictions) ? def.restrictions : []);

    // ── Already busy in another Role at this Event ───────────────────────────
    //
    // `assignedElsewhere` is who holds a DIFFERENT Role at this occurrence, each
    // carrying whether that Role leaves them free: [{ personId, roleSlug,
    // allowsAnotherRole }]. Deliberately separate from `assigned`, which is this
    // Role's own seats — the relationship rules stay scoped to one Role, because
    // "no married couple in Kids" says nothing about Coffee.
    //
    // A person may hold a set of Roles only when EVERY Role in it permits a
    // second, and never more than two. Holding one exclusive Role therefore
    // means holding nothing else, because that Role itself says so.
    function servingElsewhere(def, held) {
        if (!held || held.length === 0) return null;

        const blocked = (
            held.length >= MAX_ROLES_PER_PERSON ||
            !allowsAnotherRole(def) ||
            held.some(a => !allowsAnotherRole(a))
        );

        // Name the Role that has them. A bare "unavailable" makes the editor go
        // hunting for which one, on a screen that already knows the answer.
        return blocked
            ? { reason: REASONS.SERVING_ELSEWHERE, roleSlug: held[0].roleSlug || null }
            : null;
    }

    // Judge one Person against one slot. Returns `null` when they may fill it,
    // or the reason they may not. Ordered most-fundamental first, so the user is
    // told the real cause — being Inactive explains everything else about them.
    // `seated` and `busy` are passed in already narrowed rather than derived
    // per candidate: both are the same for every person judged against one slot,
    // and the solver calls this tens of thousands of times.
    function ineligibilityFor(def, slot, candidate, context, seated, busy) {
        if (isInactive(candidate)) return { reason: REASONS.INACTIVE };

        if (seated.some(a => a.personId === candidate.id)) {
            return { reason: REASONS.ALREADY_ASSIGNED };
        }

        const clash = servingElsewhere(def, busy[candidate.id]);
        if (clash) return clash;

        const requirement = slot && slot.requirement;
        if (requirement !== REQUIREMENTS.EITHER) {
            if (!candidate.sex) return { reason: REASONS.SEX_UNKNOWN };
            if (candidate.sex !== requirement) return { reason: REASONS.SEX_MISMATCH };
        }

        for (const rule of restrictionsOf(def)) {
            if (rule.kind === RESTRICTIONS.REQUIRE_TAG && !carriesTag(candidate, rule.tagId)) {
                return { reason: REASONS.MISSING_REQUIRED_TAG, tagId: rule.tagId };
            }
            if (rule.kind === RESTRICTIONS.EXCLUDE_TAG && carriesTag(candidate, rule.tagId)) {
                return { reason: REASONS.EXCLUDED_BY_TAG, tagId: rule.tagId };
            }
            // The named few who serve communion or run coffee. A rule that is
            // ABSENT means everyone; an EMPTY one means nobody, which is why
            // validation refuses it rather than letting it empty a rota.
            if (rule.kind === RESTRICTIONS.ALLOWLIST) {
                const allowed = (rule.personIds || []).indexOf(candidate.id) !== -1;
                if (!allowed) return { reason: REASONS.NOT_ON_ALLOWLIST };
            }
            if (rule.kind === RESTRICTIONS.NOT_TOGETHER) {
                const clash = seated.find(a => joinedBy(
                    context.relationships, rule.typeId, candidate.id, a.personId
                ));
                if (clash) {
                    return {
                        reason: REASONS.RELATIONSHIP_CONFLICT,
                        typeId: rule.typeId,
                        conflictsWith: clash.personId,
                    };
                }
            }
            // Spread the Role: nobody may sit with someone from their own group.
            if (rule.kind === RESTRICTIONS.NOT_SAME_GROUP) {
                for (const seat of seated) {
                    const shared = sharedGroups(
                        context.groups, rule.typeId, candidate.id, seat.personId
                    );
                    if (shared.length) {
                        return {
                            reason: REASONS.SAME_GROUP_CONFLICT,
                            typeId: rule.typeId,
                            groupId: shared[0].id,
                            groupName: shared[0].name,
                            conflictsWith: seat.personId,
                        };
                    }
                }
            }

            // Staff the Role from ONE group. The only cohesive rule in the model:
            // the first person seated is unconstrained, and everyone after them
            // must share a group with EVERY seat already taken.
            //
            // No single group is ever committed to. A candidate passes if any one
            // group satisfies every seat, so the Role can't get pinned to whichever
            // group happened to match first and then wrongly exclude the rest.
            if (rule.kind === RESTRICTIONS.SAME_GROUP) {
                const own = groupsFor(context.groups, rule.typeId, candidate.id);
                if (own.length === 0) {
                    return { reason: REASONS.NOT_IN_REQUIRED_GROUP, typeId: rule.typeId };
                }
                const worksForEverySeat = own.some(
                    group => seated.every(seat => inGroup(group, seat.personId))
                );
                if (!worksForEverySeat) {
                    return { reason: REASONS.NOT_IN_REQUIRED_GROUP, typeId: rule.typeId };
                }
            }

            // A rule kind we don't know is skipped rather than treated as a
            // blanket exclusion — a typo in the config must not empty the list.
        }

        return null;
    }

    // Judge every candidate for one slot of one Role on one Event.
    //
    //   people        — the candidates, in the order to show them
    //   relationships — the pairwise edges (for NOT_TOGETHER)
    //   assigned      — [{ slotId, personId }] already seated in THIS Role on
    //                   THIS Event. Scoped that way on purpose, but ONLY for the
    //                   relationship rules: "no married couple in Kids" says
    //                   nothing about who is on Coffee.
    //   assignedElsewhere
    //                 — [{ personId, roleSlug, allowsAnotherRole }] holding a
    //                   different Role at this Event. Serving another Role the
    //                   same morning IS this Role's business now (ADR-0020):
    //                   exclusive is the default, so by default it blocks.
    //
    // Everybody comes back, eligible or not, so the UI can grey people out with
    // a reason rather than quietly dropping them.
    function candidatesFor(def, slot, context) {
        const ctx = context || {};

        // Narrowed once for the whole slot, not once per candidate.
        const seated = (ctx.assigned || []).filter(a => a.slotId !== slot.id);
        const busy = {};
        (ctx.assignedElsewhere || []).forEach(a => {
            if (!a || !a.personId) return;
            (busy[a.personId] || (busy[a.personId] = [])).push(a);
        });

        return (ctx.people || []).map(candidate => {
            const blocked = ineligibilityFor(def, slot, candidate, ctx, seated, busy);
            return Object.assign(
                { personId: candidate.id, eligible: !blocked, reason: null },
                blocked || {}
            );
        });
    }

    // ── Judging a roster that is already seated ───────────────────────────────
    //
    // The other half of eligibility (ADR-0021). `candidatesFor` asks "may I seat
    // this person NEXT?" and its answer is thrown away the moment they are
    // placed. This asks "is this roster, AS IT STANDS, legal?" and returns a
    // WARNING for every seat that breaks one of the editor's own rules.
    //
    // ⚠ THE TWO ARE DIFFERENT QUESTIONS, and that is the whole reason this
    // exists rather than being folded into the other. A roster can be perfectly
    // legal on the day it is drafted and break later — somebody marries, a tag
    // is removed, a Role gains a restriction. Nothing was overridden and there
    // is still a problem, which is also why the model calls this a Warning and
    // not an override.
    //
    // A warning never REFUSES. Eligibility advises; the editor is the final word,
    // because a tool that will not record the rota the church is actually going
    // to run is a tool the rota leaves. What the app owes them is to say so.
    //
    // Nothing here is stored. Warnings are derived on every read, never stamped
    // on the roster, never acknowledged, never dismissed — one you can wave away
    // is one nobody reads by the third week.
    //
    //   roster            — [{ roleSlug, slotId, personId }] every seat on ONE
    //                       occurrence, across every Role.
    //   roles             — the Role definitions those slugs refer to.
    //   liturgicalHolders — [{ personId, roleSlug }] whoever is preaching or
    //                       leading. Liturgy is fields on the Service rather
    //                       than Assignments, so it cannot arrive in the roster
    //                       and has to be handed in beside it.
    //
    // Empty places produce nothing: leaving one unfilled is a legitimate answer.
    function warningsFor(roster, context) {
        const ctx = context || {};
        const seats = (roster || []).filter(s => s && s.personId && s.roleSlug);

        const defBySlug = {};
        (ctx.roles || []).forEach(def => { if (def && def.slug) defBySlug[def.slug] = def; });
        const personById = {};
        (ctx.people || []).forEach(p => { if (p && p.id) personById[p.id] = p; });

        // Liturgy always occupies the whole morning, so it joins the busy list
        // as an exclusive holding. Reusing `servingElsewhere` rather than
        // writing a second liturgical rule is what keeps the picker's answer and
        // this one identical (ADR-0020 §7).
        const liturgical = (ctx.liturgicalHolders || [])
            .filter(h => h && h.personId)
            .map(h => ({
                personId: h.personId,
                roleSlug: h.roleSlug || null,
                allowsAnotherRole: false,
            }));

        const warnings = [];

        seats.forEach(seat => {
            const def = defBySlug[seat.roleSlug];
            if (!def) {
                warnings.push({
                    personId: seat.personId,
                    roleSlug: seat.roleSlug,
                    slotId: seat.slotId,
                    reason: REASONS.UNKNOWN_ROLE,
                });
                return;
            }

            const slot = slotsOf(def).filter(s => s.id === seat.slotId)[0];
            if (!slot) {
                warnings.push({
                    personId: seat.personId,
                    roleSlug: seat.roleSlug,
                    slotId: seat.slotId,
                    reason: REASONS.UNKNOWN_SLOT,
                });
                return;
            }

            const candidate = personById[seat.personId] || { id: seat.personId };

            // Judge this seat AS THOUGH IT WERE BEING PLACED LAST: everyone else
            // is already sitting there, and the rules see them. Asking the same
            // question `candidatesFor` asks, with the same narrowed inputs, is
            // what stops the two drifting — the paired test pins it.
            const seated = seats.filter(s => (
                s !== seat && s.roleSlug === seat.roleSlug && s.slotId !== seat.slotId
            ));
            const busy = {};
            busy[seat.personId] = seats
                .filter(s => s !== seat && s.personId === seat.personId && s.roleSlug !== seat.roleSlug)
                .map(s => ({
                    personId: s.personId,
                    roleSlug: s.roleSlug,
                    allowsAnotherRole: allowsAnotherRole(defBySlug[s.roleSlug]),
                }))
                .concat(liturgical.filter(h => h.personId === seat.personId));

            const blocked = ineligibilityFor(def, slot, candidate, ctx, seated, busy);
            if (!blocked) return;

            warnings.push(Object.assign({
                personId: seat.personId,
                roleSlug: seat.roleSlug,
                slotId: seat.slotId,
            }, blocked, {
                // `roleSlug` on a SERVING_ELSEWHERE names the Role that has them
                // already, which would otherwise overwrite the Role this warning
                // is about. Both matter, so both are kept and named apart.
                heldRoleSlug: blocked.roleSlug || null,
                roleSlug: seat.roleSlug,
            }));
        });

        return warnings;
    }

    // ── Validating a restriction against the Types on offer ───────────────────
    //
    // A relationship rule may only name a Relationship Type an elder has marked
    // Shared with Editors (MS-128, ADR-0017).
    //
    // The security rules already stop a non-elder READING an unshared Type's
    // edges and rosters. But if the model let such a rule be built anyway,
    // evaluation would be handed an empty list and quietly conclude "nobody
    // qualifies" — a Role that can never be filled, with no clue why. Refusing
    // up front is the kinder failure.

    const TAG_RULES = [RESTRICTIONS.REQUIRE_TAG, RESTRICTIONS.EXCLUDE_TAG];
    const GROUP_RULES = [RESTRICTIONS.SAME_GROUP, RESTRICTIONS.NOT_SAME_GROUP];
    const PAIRWISE_RULES = [RESTRICTIONS.NOT_TOGETHER];

    function validateRestriction(rule, availableTypes) {
        const errors = [];
        const kind = rule && rule.kind;

        if (TAG_RULES.indexOf(kind) !== -1) {
            if (!rule.tagId) errors.push('This rule needs a Tag.');
            return { valid: errors.length === 0, errors: errors };
        }

        // Absent is not empty. No allowlist rule means the Role is open to
        // everyone; an allowlist naming nobody is a Role that can never be
        // filled, and it must be refused here rather than discovered six weeks
        // later as an empty slot on a rota.
        if (kind === RESTRICTIONS.ALLOWLIST) {
            if (!(rule.personIds || []).length) {
                errors.push('An allowlist needs at least one person, or the Role can never be filled.');
            }
            return { valid: errors.length === 0, errors: errors };
        }

        const wantsGroup = GROUP_RULES.indexOf(kind) !== -1;
        const wantsPairwise = PAIRWISE_RULES.indexOf(kind) !== -1;
        if (!wantsGroup && !wantsPairwise) {
            return { valid: false, errors: ['Unknown restriction: ' + kind] };
        }

        // Only Types this user can actually see are offered. An unknown Type is
        // treated as unavailable rather than assumed shared.
        const type = (availableTypes || []).find(t => t && t.id === rule.typeId);
        if (!type) {
            errors.push(
                'That relationship type is not available. An elder has to share it ' +
                'with editors before a serving rule can use it.'
            );
            return { valid: false, errors: errors };
        }

        if (type.sharedWithEditors !== true) {
            errors.push(
                'The relationship type "' + type.name + '" is not shared with editors. ' +
                'An elder has to share it before a serving rule can use it.'
            );
        }

        // A group rule against a pairwise Type would silently match nothing, and
        // vice versa — so the mismatch is an error, not a no-op.
        if (wantsGroup && type.kind !== 'group') {
            errors.push('"' + type.name + '" connects two people, so it cannot be used as a group rule.');
        }
        if (wantsPairwise && type.kind !== 'pairwise') {
            errors.push('"' + type.name + '" is a group, so it cannot be used as a pair rule.');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // The Role's restrictions that can no longer run — typically because a Type
    // was shared when the rule was written and has since been made private again.
    // Reported so the Roles Manager can show the rule as unavailable rather than
    // dropping it silently or pretending it still applies.
    function unavailableRestrictions(def, availableTypes) {
        return restrictionsOf(def)
            .filter(rule => !validateRestriction(rule, availableTypes).valid)
            .map(rule => ({ kind: rule.kind, typeId: rule.typeId, tagId: rule.tagId }));
    }

    // ── Validation ────────────────────────────────────────────────────────────

    // Returns every problem at once rather than the first — the Roles Manager
    // shows them together instead of making the editor fix one, save, repeat.
    function validateDefinition(def) {
        const errors = [];

        const name = def && typeof def.name === 'string' ? def.name.trim() : '';
        if (!name) errors.push('A Role needs a name.');

        // Only liturgical Roles carry the locked family, and they are defined in
        // code — a stored definition claiming it would forge an undeletable Role.
        if (def && def.family !== FAMILIES.SERVANT) {
            errors.push('A Role Definition must belong to the servant family; liturgical Roles are code-defined.');
        }

        // Intensity is optional — absent reads as 1 — but a stored value that is
        // not a usable number is a mistake worth naming, not silently ignoring.
        // Same predicate `intensityOf` reads by, so what validation rejects can
        // never be something reading quietly accepts.
        if (def && def.intensity !== undefined && def.intensity !== null &&
            !isUsableIntensity(def.intensity)) {
            errors.push('Intensity must be a number of weeks, and cannot be negative.');
        }

        // The allowlist is the one restriction that needs no Relationship Type,
        // so it can be judged here without the list of shared Types — and asking
        // validateRestriction keeps one wording for one rule.
        restrictionsOf(def).forEach(rule => {
            if (rule && rule.kind === RESTRICTIONS.ALLOWLIST) {
                validateRestriction(rule, []).errors.forEach(e => errors.push(e));
            }
        });

        const slots = slotsOf(def);
        if (slots.length === 0) {
            errors.push('A Role needs at least one slot.');
        }

        const seen = new Set();
        slots.forEach((slot, i) => {
            const position = 'Slot ' + (i + 1);
            if (!slot || !slot.id) {
                errors.push(position + ' needs an id.');
            } else if (seen.has(slot.id)) {
                errors.push(position + ' repeats the slot id "' + slot.id + '".');
            } else {
                seen.add(slot.id);
            }
            if (!slot || !isRequirement(slot.requirement)) {
                errors.push(position + ' needs a requirement of male, female, or either.');
            }
        });

        return { valid: errors.length === 0, errors: errors };
    }

    const RolesCore = {
        // vocabulary
        FAMILIES,
        REQUIREMENTS,
        REQUIREMENT_VALUES,
        RESTRICTIONS,
        REASONS,
        LITURGICAL_ROLES,
        LITURGICAL_SLUGS,
        DEFAULT_INTENSITY,
        MAX_ROLES_PER_PERSON,
        isRequirement,
        assignablePeople,
        // fairness fields (MS-17, ADR-0020)
        intensityOf,
        allowsAnotherRole,
        // the registry: both families, one list
        allRoles,
        roleBySlug,
        isLocked,
        assertEditable,
        assertDeletable,
        slugify,
        // eligibility
        isInactive,
        candidatesFor,
        warningsFor,
        // relationship group membership (MS-141)
        inGroup,
        groupsFor,
        sharedGroups,
        // reading
        slotOrder,
        slotCount,
        nextSlotId,
        // building
        newDefinition,
        addSlot,
        removeSlot,
        setSlotRequirement,
        reorderSlots,
        // validation
        validateDefinition,
        validateRestriction,
        unavailableRestrictions,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RolesCore;
    }
    if (global) {
        global.RolesCore = RolesCore;
    }
})(typeof window !== 'undefined' ? window : null);
