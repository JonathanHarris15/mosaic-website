// Pure plan helpers for merging duplicate `people` records (MS-771).
// Used by `scripts/merge-duplicate-person.js` and unit tests.
(function (global) {
    'use strict';

    const SERVICE_SCALAR_ID_FIELDS = Object.freeze([
        'serviceLeaderId',
        'musicLeaderId',
        'preacherId',
        'elementsId',
        'otherId',
        'prayerPraiseId',
        'prayerConfessionId',
        'prayerMaleId',
        'prayerFemaleId',
    ]);

    const SERVICE_NESTED_PERSON_REFS = Object.freeze([
        ['serviceLeader', 'id'],
        ['musicLeader', 'id'],
        ['preacher', 'id'],
        ['elements', 'id'],
        ['other', 'id'],
        ['liturgy', 'prayerMale', 'id'],
        ['liturgy', 'prayerFemale', 'id'],
    ]);

    const PERSON_ID_SCALAR_KEYS = Object.freeze([
        'personId',
        'fromId',
        'toId',
        'husbandId',
        'wifeId',
        'leaderId',
        'holderId',
        'counterpartyId',
        'closedBy',
        'aboutPersonId',
        'ownerPersonId',
        'overridePersonId',
        'requesterPersonId',
        'assignedElderId',
        'elderId',
        'subjectPersonId',
        'uploadedByPersonId',
        'linkedPersonId',
        'targetPersonId',
        'otherId',
    ]);

    const PERSON_ID_ARRAY_KEYS = Object.freeze([
        'assigneeIds',
        'participantIds',
        'childIds',
        'memberIds',
        'subjectIds',
        'personIds',
        'seenBy',
        'mentions',
    ]);

    const PEOPLE_SUBCOLLECTIONS = Object.freeze([
        'involvement',
        'pastoral_prayer_history',
        'prayer_requests',
        'away',
        'shepherding_notes',
        'shepherding_activity',
    ]);

    const TOP_LEVEL_COLLECTIONS = Object.freeze([
        'services',
        'users',
        'families',
        'households',
        'relationships',
        'relationship_groups',
        'shepherding_tasks',
        'shepherding_task_occurrences',
        'elder_documents',
        'directory_requests',
        'trades',
        'cover',
        'notifications',
        'form_responses',
        'form_ledger',
        'answer_links',
        'printables',
        'event_occurrences',
        'events',
        'people_tags',
        'shepherding_views',
        'elder_meetings',
        'forms',
        'presence',
    ]);

    const COLLECTION_GROUP_SUBCOLLECTIONS = Object.freeze([
        'roster',
        'attendance',
        'involvement',
        'away',
        'pastoral_prayer_history',
        'prayer_requests',
        'shepherding_notes',
        'shepherding_activity',
    ]);

    function isPlainObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v) &&
            !(v instanceof Date) && typeof v.toDate !== 'function';
    }

    function mergeStringArray(arr, fromId, toId) {
        const out = [];
        const seen = new Set();
        (arr || []).forEach((item) => {
            let next = item;
            if (typeof item === 'string' && item === fromId) next = toId;
            if (typeof next === 'string' && next) {
                if (seen.has(next)) return;
                seen.add(next);
                out.push(next);
            }
        });
        return out;
    }

    function repointPersonRef(value, fromId, toId, toName) {
        if (value === fromId) return toId;
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        if (value.personId === fromId) {
            const next = Object.assign({}, value, { personId: toId });
            if (toName && !next.name) next.name = toName;
            return next;
        }
        if (value.id === fromId) {
            const next = Object.assign({}, value, { id: toId });
            if (toName && !next.name) next.name = toName;
            return next;
        }
        return value;
    }

    function setAtPath(obj, path, value) {
        if (!path.length) return value;
        const root = isPlainObject(obj) ? Object.assign({}, obj) : {};
        let cur = root;
        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            const child = cur[key];
            cur[key] = isPlainObject(child) ? Object.assign({}, child) : {};
            cur = cur[key];
        }
        cur[path[path.length - 1]] = value;
        return root;
    }

    function getAtPath(obj, path) {
        let cur = obj;
        for (let i = 0; i < path.length; i++) {
            if (!isPlainObject(cur)) return undefined;
            cur = cur[path[i]];
        }
        return cur;
    }

    function applyServiceNestedRefs(data, fromId, toId, toName) {
        let next = data;
        let changed = false;
        SERVICE_NESTED_PERSON_REFS.forEach((path) => {
            const current = getAtPath(next, path);
            if (current !== fromId) return;
            next = setAtPath(next, path, toId);
            changed = true;
            const namePath = path.slice(0, -1).concat(['name']);
            const nameVal = getAtPath(next, namePath);
            if (toName && (!nameVal || nameVal === '')) {
                next = setAtPath(next, namePath, toName);
            }
        });
        return { data: next, changed };
    }

    function applyCarriedBy(data, fromId, toId, toName) {
        const carried = data && data.carriedBy;
        if (!isPlainObject(carried)) return { data, changed: false };
        let changed = false;
        const nextCarried = Object.assign({}, carried);
        Object.keys(nextCarried).forEach((slot) => {
            const ref = nextCarried[slot];
            if (!ref || typeof ref !== 'object') return;
            if (ref.id !== fromId) return;
            nextCarried[slot] = Object.assign({}, ref, {
                id: toId,
                name: ref.name || toName || '',
            });
            changed = true;
        });
        if (!changed) return { data, changed: false };
        return { data: Object.assign({}, data, { carriedBy: nextCarried }), changed: true };
    }

    function applyMusicHelpers(data, fromId, toId, toName) {
        const helpers = data && data.musicHelpers;
        if (!Array.isArray(helpers)) return { data, changed: false };
        let changed = false;
        const next = helpers.map((h) => {
            if (!h || h.id !== fromId) return h;
            changed = true;
            return Object.assign({}, h, { id: toId, name: h.name || toName || '' });
        });
        if (!changed) return { data, changed: false };
        const deduped = [];
        const seen = new Set();
        next.forEach((h) => {
            const id = h && h.id;
            if (!id || seen.has(id)) return;
            seen.add(id);
            deduped.push(h);
        });
        return { data: Object.assign({}, data, { musicHelpers: deduped }), changed: true };
    }

    function applyLiturgyBaptism(data, fromId, toId, toName) {
        const liturgy = data && data.liturgy;
        if (!liturgy || !Array.isArray(liturgy.baptism)) return { data, changed: false };
        let changed = false;
        const nextBaptism = liturgy.baptism.map((entry) => {
            if (typeof entry === 'string' && entry === fromId) {
                changed = true;
                return toId;
            }
            if (entry && typeof entry === 'object' && entry.id === fromId) {
                changed = true;
                return Object.assign({}, entry, { id: toId, name: entry.name || toName || '' });
            }
            return entry;
        });
        const deduped = mergeStringArray(
            nextBaptism.map((e) => (typeof e === 'string' ? e : (e && e.id) || null)).filter(Boolean),
            fromId,
            toId,
        );
        const rebuilt = [];
        const seen = new Set();
        nextBaptism.forEach((entry) => {
            const id = typeof entry === 'string' ? entry : (entry && entry.id);
            if (!id || seen.has(id)) return;
            seen.add(id);
            if (typeof entry === 'string') rebuilt.push(id);
            else rebuilt.push(Object.assign({}, entry, { id }));
        });
        if (!changed) return { data, changed: false };
        return {
            data: Object.assign({}, data, {
                liturgy: Object.assign({}, liturgy, { baptism: rebuilt.length ? rebuilt : deduped }),
            }),
            changed: true,
        };
    }

    function applyCareListDataKeys(data, fromId, toId) {
        const cells = data && data.careListData;
        if (!isPlainObject(cells) || !cells[fromId]) return { data, changed: false };
        if (cells[toId]) {
            return {
                data,
                changed: false,
                conflict: {
                    field: 'careListData',
                    message: `target already has careListData.${toId}`,
                },
            };
        }
        const nextCells = Object.assign({}, cells);
        nextCells[toId] = nextCells[fromId];
        delete nextCells[fromId];
        return {
            data: Object.assign({}, data, { careListData: nextCells }),
            changed: true,
        };
    }

    function applyShepherdingAssignedElder(data, fromId, toId) {
        const sh = data && data.shepherding;
        if (!isPlainObject(sh) || sh.assignedElderId !== fromId) {
            return { data, changed: false };
        }
        return {
            data: Object.assign({}, data, {
                shepherding: Object.assign({}, sh, { assignedElderId: toId }),
            }),
            changed: true,
        };
    }

    function deepRepoint(value, fromId, toId, toName, keyHint) {
        if (value === fromId) return toId;
        if (Array.isArray(value)) {
            if (PERSON_ID_ARRAY_KEYS.indexOf(keyHint) !== -1) {
                return mergeStringArray(value, fromId, toId);
            }
            let changed = false;
            const next = value.map((item) => {
                const repointed = deepRepoint(item, fromId, toId, toName, null);
                if (repointed !== item) changed = true;
                return repointed;
            });
            return changed ? next : value;
        }
        if (!isPlainObject(value)) return value;

        let changed = false;
        const next = {};
        Object.keys(value).forEach((key) => {
            let child = value[key];
            if (PERSON_ID_SCALAR_KEYS.indexOf(key) !== -1 && child === fromId) {
                child = toId;
                changed = true;
            } else if (PERSON_ID_ARRAY_KEYS.indexOf(key) !== -1 && Array.isArray(child)) {
                const merged = mergeStringArray(child, fromId, toId);
                if (merged.length !== child.length ||
                    merged.some((v, i) => v !== child[i])) {
                    child = merged;
                    changed = true;
                }
            } else if (key === 'musicHelpers' && Array.isArray(child)) {
                const applied = applyMusicHelpers({ musicHelpers: child }, fromId, toId, toName);
                if (applied.changed) {
                    child = applied.data.musicHelpers;
                    changed = true;
                }
            } else if (key === 'carriedBy' && isPlainObject(child)) {
                const applied = applyCarriedBy({ carriedBy: child }, fromId, toId, toName);
                if (applied.changed) {
                    child = applied.data.carriedBy;
                    changed = true;
                }
            } else if (key === 'careListData' && isPlainObject(child)) {
                const applied = applyCareListDataKeys({ careListData: child }, fromId, toId);
                if (applied.conflict) {
                    next.__careListConflict = applied.conflict;
                } else if (applied.changed) {
                    child = applied.data.careListData;
                    changed = true;
                }
            } else if (key === 'answer' || key === 'answerAs' || key === 'subject') {
                const repointed = repointPersonRef(child, fromId, toId, toName);
                if (repointed !== child) {
                    child = repointed;
                    changed = true;
                }
            } else {
                const repointed = deepRepoint(child, fromId, toId, toName, key);
                if (repointed !== child) {
                    child = repointed;
                    changed = true;
                }
            }
            next[key] = child;
        });
        return changed ? next : value;
    }

    /**
     * @return {{ patch: ?object, changed: boolean, conflicts: Array<object> }}
     */
    function planDocumentRepoint(collection, docId, data, fromId, toId, toName) {
        const conflicts = [];
        if (!data || typeof data !== 'object') {
            return { patch: null, changed: false, conflicts };
        }

        let next = Object.assign({}, data);
        let changed = false;

        if (collection === 'services') {
            SERVICE_SCALAR_ID_FIELDS.forEach((field) => {
                if (next[field] === fromId) {
                    next[field] = toId;
                    changed = true;
                }
            });
            const nested = applyServiceNestedRefs(next, fromId, toId, toName);
            if (nested.changed) {
                next = nested.data;
                changed = true;
            }
            const carried = applyCarriedBy(next, fromId, toId, toName);
            if (carried.changed) {
                next = carried.data;
                changed = true;
            }
            const helpers = applyMusicHelpers(next, fromId, toId, toName);
            if (helpers.changed) {
                next = helpers.data;
                changed = true;
            }
            const baptism = applyLiturgyBaptism(next, fromId, toId, toName);
            if (baptism.changed) {
                next = baptism.data;
                changed = true;
            }
        }

        if (collection === 'people') {
            const elder = applyShepherdingAssignedElder(next, fromId, toId);
            if (elder.changed) {
                next = elder.data;
                changed = true;
            }
        }

        if (collection === 'elder_documents') {
            const care = applyCareListDataKeys(next, fromId, toId);
            if (care.conflict) {
                conflicts.push(Object.assign({ collection, docId }, care.conflict));
            } else if (care.changed) {
                next = care.data;
                changed = true;
            }
        }

        const deep = deepRepoint(next, fromId, toId, toName, null);
        if (deep !== next) {
            next = deep;
            changed = true;
        }
        if (next.__careListConflict) {
            conflicts.push(Object.assign({ collection, docId }, next.__careListConflict));
            delete next.__careListConflict;
        }

        if (collection === 'users' && next.personId === toId && data.personId === fromId) {
            changed = true;
        }

        return {
            patch: changed ? next : null,
            changed,
            conflicts,
        };
    }

    function documentContainsPersonId(value, fromId) {
        if (value === fromId) return true;
        if (Array.isArray(value)) {
            return value.some((item) => documentContainsPersonId(item, fromId));
        }
        if (!isPlainObject(value)) return false;
        return Object.keys(value).some((key) => {
            if (PERSON_ID_SCALAR_KEYS.indexOf(key) !== -1 && value[key] === fromId) return true;
            if (PERSON_ID_ARRAY_KEYS.indexOf(key) !== -1 &&
                Array.isArray(value[key]) && value[key].indexOf(fromId) !== -1) return true;
            if (key === 'carriedBy' && isPlainObject(value[key])) {
                return Object.values(value[key]).some((ref) =>
                    ref && ref.id === fromId);
            }
            if (key === 'careListData' && isPlainObject(value[key]) && value[key][fromId]) {
                return true;
            }
            return documentContainsPersonId(value[key], fromId);
        });
    }

    function planSubcollectionMove(fromId, toId, subcollection, docId, data, targetExists, toName) {
        const fromPath = `people/${fromId}/${subcollection}/${docId}`;
        const toPath = `people/${toId}/${subcollection}/${docId}`;
        return planPersonSubdocMove(fromPath, toPath, data, targetExists, fromId, toId, toName || '');
    }

    /**
     * Move one document under people/{from}/… to the same relative path under people/{to}/….
     * Repoints person-id fields inside the payload from `fromId` → `toId`.
     *
     * @param {string} fromPath
     * @param {string} toPath
     * @param {object} data
     * @param {boolean} targetExists
     * @param {string} fromId
     * @param {string} toId
     * @param {string} toName
     */
    function planPersonSubdocMove(fromPath, toPath, data, targetExists, fromId, toId, toName) {
        if (targetExists) {
            return {
                action: 'conflict',
                reason: 'target_doc_exists',
                fromPath,
                toPath,
            };
        }
        const repointed = deepRepoint(data || {}, fromId, toId, toName, null);
        return {
            action: 'move',
            fromPath,
            toPath,
            data: repointed,
            personSubtree: true,
        };
    }

    function pathDepth(firestorePath) {
        return String(firestorePath || '').split('/').filter(Boolean).length;
    }

    /** Apply person-subtree moves deepest-first so nested subcollections stay addressable. */
    function sortMovesByDepthDesc(moves) {
        return (moves || []).slice().sort((a, b) =>
            pathDepth(b.fromPath) - pathDepth(a.fromPath));
    }

    /**
     * @param {object} [options]
     * @param {'keep-target'} [options.attendanceConflict] when target attendance exists
     */
    function planAttendanceDocMove(occurrenceId, fromId, toId, data, targetExists, options) {
        const attendanceConflict = options && options.attendanceConflict;
        const keepPath = `event_occurrences/${occurrenceId}/attendance/${toId}`;
        const dropPath = `event_occurrences/${occurrenceId}/attendance/${fromId}`;
        if (targetExists) {
            if (attendanceConflict === 'keep-target') {
                return {
                    action: 'attendance_keep_target',
                    collection: 'event_occurrences',
                    occurrenceId,
                    fromId,
                    toId,
                    keepPath,
                    dropPath,
                };
            }
            return {
                action: 'conflict',
                collection: 'event_occurrences',
                occurrenceId,
                reason: 'attendance_target_exists',
                keepPath,
                dropPath,
            };
        }
        return {
            action: 'move',
            fromPath: dropPath,
            toPath: keepPath,
            data: data || {},
        };
    }

    const MergeDuplicatePersonCore = {
        SERVICE_SCALAR_ID_FIELDS,
        SERVICE_NESTED_PERSON_REFS,
        PERSON_ID_SCALAR_KEYS,
        PERSON_ID_ARRAY_KEYS,
        PEOPLE_SUBCOLLECTIONS,
        TOP_LEVEL_COLLECTIONS,
        COLLECTION_GROUP_SUBCOLLECTIONS,
        mergeStringArray,
        planDocumentRepoint,
        documentContainsPersonId,
        planSubcollectionMove,
        planPersonSubdocMove,
        planAttendanceDocMove,
        sortMovesByDepthDesc,
        pathDepth,
        deepRepoint,
        applyCarriedBy,
        applyCareListDataKeys,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = MergeDuplicatePersonCore;
    }
    if (global) {
        global.MergeDuplicatePersonCore = MergeDuplicatePersonCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
