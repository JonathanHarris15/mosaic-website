// Phone Directory Track — what the phone Membership Directory writes for a
// Membership Track move and a tag add or remove, and who may see them (MS-615).
//
// The computer's Track commit stays the write. This plan only answers the
// next stage and Inactive flag that commit already accepts, the tag change
// the computer directory already applies by hand, and which people and tags
// this viewer may see. It does not open the computer page, and it does not
// append a Tag Change.
//
// Loaded as a classic script (window.PhoneDirectoryTrack) and exported for Node.

(function (global) {
    'use strict';

    // Names the phone Membership Directory, the way the computer's commit
    // names the people list with `people_list`.
    const SOURCE = 'phone_membership_directory';
    const TRACK_FAILED = "Couldn't save the Membership Track. It did not work.";
    const TAG_FAILED = "Couldn't save that tag. It did not work.";
    const TAG_LOCKED = 'This tag is set by the system, not manual tagging.';

    function core() {
        return global && global.ShepherdingCore;
    }

    function access() {
        return global && global.AccessCore;
    }

    function edit() {
        return global && global.PhoneDirectoryEdit;
    }

    function trim(value) {
        return String(value == null ? '' : value).trim();
    }

    function currentMembership(membership) {
        const m = membership || {};
        return {
            stage: m.stage || null,
            inactive: !!m.inactive,
        };
    }

    // The slider's home when nobody has set a stage yet. Reading it writes
    // nothing. The slider does not move while Inactive.
    function sliderIndex(membership) {
        const stages = core().MEMBERSHIP_STAGES;
        const i = stages.indexOf(membership && membership.stage);
        return i === -1 ? 0 : i;
    }

    function sliderMoves(membership) {
        return !(membership && membership.inactive);
    }

    // What a Track move writes. `action` is { kind: 'stage', stage } or
    // { kind: 'inactive', inactive }. A stage move is refused while Inactive;
    // the Inactive control is how that flag changes. Setting a stage clears
    // Inactive. Marking Inactive keeps the stage. Clearing it restores it.
    function planTrackMove(membership, action) {
        const current = currentMembership(membership);
        const kind = action && action.kind;
        if (kind === 'stage') {
            if (current.inactive) return { ok: false, write: false, reason: 'inactive' };
            const stage = action.stage;
            if (core().MEMBERSHIP_STAGES.indexOf(stage) === -1) {
                return { ok: false, write: false, reason: 'unknown-stage' };
            }
            const next = { stage: stage, inactive: false };
            if (current.stage === next.stage) {
                return { ok: true, write: false, reason: 'unchanged', next: next };
            }
            return { ok: true, write: true, next: next };
        }
        if (kind === 'inactive') {
            const next = { stage: current.stage, inactive: !!action.inactive };
            if (current.inactive === next.inactive) {
                return { ok: true, write: false, reason: 'unchanged', next: next };
            }
            return { ok: true, write: true, next: next };
        }
        return { ok: false, write: false, reason: 'unknown' };
    }

    // The one change the row and the page both hand to the Track commit.
    function directoryTrackWrite(person, user, next) {
        const current = currentMembership(person && person.membership);
        const step = currentMembership(next);
        return {
            personId: person && person.id,
            currentTags: (person && person.tags) ? person.tags.slice() : [],
            previous: current,
            next: step,
            authorUid: (user && user.uid) || null,
            authorName: (user && user.name) || '',
            source: SOURCE,
        };
    }

    // What the row and the page show after that commit: the stage field, and
    // the Membership Tags the existing projection already derives from it.
    function personAfterTrackMove(person, next) {
        const step = currentMembership(next);
        const tags = core().applyMembershipTags((person && person.tags) || [], step);
        const membership = Object.assign({}, (person && person.membership) || {}, {
            stage: step.stage,
            inactive: step.inactive,
        });
        return Object.assign({}, person, { membership: membership, tags: tags });
    }

    function tagIdentity(entry) {
        if (typeof entry === 'string') return { id: entry, name: entry, hiddenFromOthers: false, hidePeople: false };
        if (!entry) return null;
        const id = entry.id != null ? String(entry.id) : String(entry.name || '');
        const name = entry.name != null ? String(entry.name) : id;
        return {
            id: id,
            name: name,
            hiddenFromOthers: !!entry.hiddenFromOthers,
            hidePeople: !!entry.hidePeople,
        };
    }

    function matchTag(vocabulary, typed) {
        const needle = trim(typed).toLowerCase();
        if (!needle) return null;
        const list = vocabulary || [];
        for (let i = 0; i < list.length; i++) {
            const tag = tagIdentity(list[i]);
            if (!tag) continue;
            if (tag.id.toLowerCase() === needle || tag.name.toLowerCase() === needle) return tag;
        }
        return null;
    }

    // A Projected Tag is refused even when the typed capitals differ, and even
    // when that tag has not been loaded into the vocabulary yet. The id is
    // what the projection writes; a second spelling must not sneak past it.
    function projected(name) {
        if (core().isProjectedTagId(name)) return true;
        const needle = trim(name).toLowerCase();
        if (!needle) return false;
        return core().PROJECTED_TAG_IDS.some((id) => id.toLowerCase() === needle);
    }

    // What a tag add or remove writes. A Projected Tag is refused. An existing
    // name matches aside from capitals. A new name is created and applied in
    // the same write. Nothing here deletes a vocabulary entry or records a
    // Tag Change.
    function planTagChange(personTags, vocabulary, action) {
        const tags = Array.isArray(personTags) ? personTags.slice() : [];
        const kind = action && action.kind;
        if (kind === 'remove') {
            const name = action.name;
            if (projected(name)) return { ok: false, write: false, reason: 'projected' };
            if (tags.indexOf(name) === -1) {
                return {
                    ok: true,
                    write: false,
                    reason: 'missing',
                    recordTagChange: false,
                    deleteFromVocabulary: false,
                };
            }
            return {
                ok: true,
                write: true,
                tags: tags.filter((tag) => tag !== name),
                create: null,
                recordTagChange: false,
                deleteFromVocabulary: false,
            };
        }
        if (kind === 'add') {
            const typed = trim(action && action.name);
            if (!typed) return { ok: false, write: false, reason: 'blank' };
            const matched = matchTag(vocabulary, typed);
            const resolved = matched ? matched.id : typed;
            if (projected(resolved) || projected(typed) || (matched && projected(matched.name))) {
                return { ok: false, write: false, reason: 'projected' };
            }
            if (tags.indexOf(resolved) !== -1) {
                return {
                    ok: true,
                    write: false,
                    reason: 'already',
                    create: null,
                    recordTagChange: false,
                    deleteFromVocabulary: false,
                };
            }
            return {
                ok: true,
                write: true,
                tags: tags.concat([resolved]),
                create: matched ? null : { id: typed, name: typed },
                recordTagChange: false,
                deleteFromVocabulary: false,
            };
        }
        return { ok: false, write: false, reason: 'unknown' };
    }

    function tagLocked(tagId) {
        return projected(tagId);
    }

    function personAfterTagWrite(person, tags) {
        return Object.assign({}, person, { tags: (tags || []).slice() });
    }

    // A Projected Tag stays visible — it is the Track, and it is locked.
    // An ordinary tag hidden from non-elders stays hidden from an editor.
    function tagVisible(tagId, user, visibility) {
        if (tagLocked(tagId)) return true;
        if (readsAsElder(user)) return true;
        const hidden = (visibility && visibility.hidden) || {};
        return !hidden[tagId];
    }

    // The slider, the Inactive control, and tag editing. Same door as Edit Mode.
    function offerEdits(user, editModeOn) {
        return !!(editModeOn && edit() && edit().mayOfferEditMode(user));
    }

    function readsAsElder(user) {
        return !!(access() && access().readsAsElder(user));
    }

    function writesAsEditor(user) {
        return !!(access() && access().writesAsEditor(user));
    }

    function matchesDirectoryTab(person, tab, user) {
        return core().personMatchesDirectoryTab(person, tab, writesAsEditor(user));
    }

    function directoryLabel(person, user) {
        return core().directoryMembershipLabel(person && person.membership, writesAsEditor(user));
    }

    function personHiddenFrom(person, user, visibility) {
        if (readsAsElder(user)) return false;
        if (person && person.shepherdingHidden) return true;
        const hidePeople = (visibility && visibility.hidePeople) || {};
        const tags = (person && person.tags) || [];
        return tags.some((tag) => hidePeople[tag]);
    }

    function carriesEveryChosenTag(who, chosen) {
        const tags = (who && who.tags) || [];
        return (chosen || []).every((tag) => tags.indexOf(tag) !== -1);
    }

    function nameMatches(who, search) {
        const query = trim(search).toLowerCase();
        if (!query) return true;
        return String(who && who.name || '').toLowerCase().indexOf(query) !== -1;
    }

    // Tab, search, and — while Edit Mode is on — every chosen tag. Edit Mode
    // off ignores a leftover choice so the next lookup is the whole tab.
    function visibleInDirectory(who, opts) {
        const options = opts || {};
        if (!matchesDirectoryTab(who, options.tab, options.user)) return false;
        if (personHiddenFrom(who, options.user, options.visibility)) return false;
        if (!nameMatches(who, options.search)) return false;
        if (options.editMode && options.chosenTags && options.chosenTags.length) {
            if (!carriesEveryChosenTag(who, options.chosenTags)) return false;
        }
        return true;
    }

    function chosenTagsWhen(editModeOn, chosen) {
        if (!editModeOn) return [];
        return (chosen || []).slice();
    }

    function tagsOffered(vocabulary, user) {
        const elder = readsAsElder(user);
        const out = [];
        (vocabulary || []).forEach((entry) => {
            const tag = tagIdentity(entry);
            if (!tag || !tag.id) return;
            if (tag.hiddenFromOthers && !elder) return;
            out.push(tag);
        });
        return out;
    }

    const PhoneDirectoryTrack = {
        SOURCE,
        TRACK_FAILED,
        TAG_FAILED,
        TAG_LOCKED,
        STAGES: core().MEMBERSHIP_STAGES,
        STAGE_LABEL: core().MEMBERSHIP_STAGE_LABEL,
        sliderIndex,
        sliderMoves,
        planTrackMove,
        directoryTrackWrite,
        personAfterTrackMove,
        planTagChange,
        tagLocked,
        personAfterTagWrite,
        tagVisible,
        offerEdits,
        matchesDirectoryTab,
        directoryLabel,
        personHiddenFrom,
        carriesEveryChosenTag,
        visibleInDirectory,
        chosenTagsWhen,
        tagsOffered,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PhoneDirectoryTrack;
    }
    if (global) {
        global.PhoneDirectoryTrack = PhoneDirectoryTrack;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
