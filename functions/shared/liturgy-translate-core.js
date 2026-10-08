// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/liturgy-translate-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Liturgy translator — carry a filled order onto any other Liturgy Order.
//
// A Sunday follows one order. Switching orders, or reading a bulletin into
// one, has to put each filled moment into the slot that is that same moment
// and leave the rest somewhere the editor can see. Same element id, and a
// name that is the only one of its kind on both sides, are exact and stay in
// code. Everything still ambiguous is a Choice for Jev: one question per open
// slot, options the filled elements (or the bulletin's lines) plus none.
// Code then assigns from the probabilities, so two slots cannot take the same
// element. When Jev does not answer, the same assignment runs on kind and
// position: the next unused element of that kind, in the order they were
// filled. Baptism's candidate list only moves onto baptism. A slot with
// nothing comparable stays empty. What was filled and did not land is a
// leftover, kept until it is discarded.
//
// Pure. Loaded as a classic <script> (window.LiturgyTranslateCore) on the
// pages, required under node:test, and copied into functions/shared for the
// callable that asks Jev. The callable is the only thing that sees the API key.
(function (global) {
    'use strict';

    let Orders = null;
    function orderCore() {
        if (!Orders) {
            Orders = (typeof require !== 'undefined')
                ? require('./liturgy-order-core.js')
                : global.LiturgyOrderCore;
        }
        return Orders;
    }

    // A Choice option below this, or no stronger than "none", does not land.
    // A wrong hymn in a slot is worse than the same hymn sitting in the drawer.
    const MIN_PROBABILITY = 0.4;

    // One Choice allows 255 options. A bulletin longer than this keeps the
    // rest as leftovers rather than dropping lines on the floor.
    const MAX_LINES = 120;
    const PREVIEW_LEN = 180;

    const HEADER_FIELDS = Object.freeze([
        { id: 'date', name: 'Date' },
        { id: 'theme', name: 'Service Theme' },
        { id: 'keyVerse', name: 'Key Verse' },
        { id: 'serviceLeader', name: 'Service Leader' },
        { id: 'musicLeader', name: 'Music Leader' },
        { id: 'preacher', name: 'Preacher' },
    ]);

    // The bulletin this church already prints. A label here is an exact lookup,
    // the same way an element id is. Anything else waits for Jev.
    const LABEL_ALIASES = Object.freeze({
        'date': { header: 'date' },
        'service theme': { header: 'theme' },
        'theme': { header: 'theme' },
        'key verse': { header: 'keyVerse' },
        'service leader': { header: 'serviceLeader' },
        'music leader': { header: 'musicLeader' },
        'preacher': { header: 'preacher' },
        'preparatory hymn': { kind: 'hymn', name: 'Preparatory Hymn', idHint: 'preparatoryHymn' },
        'scriptural call to worship': { kind: 'scripture', name: 'Call to Worship', idHint: 'callToWorship' },
        'call to worship': { kind: 'scripture', name: 'Call to Worship', idHint: 'callToWorship' },
        'call to confession': { kind: 'scripture', name: 'Call to Confession', idHint: 'callToConfession' },
        'scriptural assurance of pardon': { kind: 'scripture', name: 'Assurance of Pardon', idHint: 'assuranceOfPardon' },
        'assurance of pardon': { kind: 'scripture', name: 'Assurance of Pardon', idHint: 'assuranceOfPardon' },
        'scripture reading': { kind: 'scripture', name: 'Pastoral Prayer', idHint: 'scriptureReading' },
        'pastoral prayer': { kind: 'scripture', name: 'Pastoral Prayer', idHint: 'scriptureReading' },
        'sermon': { kind: 'scripture', name: 'Sermon', idHint: 'sermon' },
        'benediction': { kind: 'scripture', name: 'Benediction', idHint: 'benediction' },
        'baptism': { kind: 'person', name: 'Baptism', idHint: 'baptism', people: true },
        'hymn': { kind: 'hymn', name: 'Hymn' },
    });

    // Notes in the old bulletin sit under a "Notes:" heading and name the
    // slot they belong to. Scripture Reading's note travels with the sermon,
    // which is where that bulletin always put it.
    const NOTE_ALIASES = Object.freeze({
        'call to worship': 'callToWorship',
        'call to confession': 'callToConfession',
        'scriptural assurance of pardon': 'assuranceOfPardon',
        'assurance of pardon': 'assuranceOfPardon',
        'scripture reading': 'sermon',
        'sermon': 'sermon',
        'baptism': 'baptism',
    });

    function norm(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function stripHtml(value) {
        return String(value == null ? '' : value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function clip(value, max) {
        const text = String(value == null ? '' : value);
        const limit = max || PREVIEW_LEN;
        if (text.length <= limit) return text;
        return text.slice(0, limit - 1) + '…';
    }

    function clone(value) {
        if (value == null) return value;
        return JSON.parse(JSON.stringify(value));
    }

    function aliasFor(label) {
        const key = norm(label);
        if (!key) return null;
        if (LABEL_ALIASES[key]) return LABEL_ALIASES[key];
        if (key.indexOf('hymn') === 0) return LABEL_ALIASES.hymn;
        return null;
    }

    // "John 3:16" is a reference, not a label. A label is the short name
    // before the colon, with no digits in it.
    function splitLabel(line) {
        const text = String(line || '');
        const idx = text.indexOf(':');
        if (idx <= 0 || idx > 60) return { label: '', value: text.trim() };
        const label = text.slice(0, idx).trim();
        const value = text.slice(idx + 1).trim();
        if (!value || /\d/.test(label)) return { label: '', value: text.trim() };
        return { label: label, value: value };
    }

    function isPeople(el) {
        if (!el) return false;
        return el.id === 'baptism' || el.primitive === 'people' || el.people === true || el.idHint === 'baptism';
    }

    function hasCarrier(ref) {
        return !!(ref && (ref.id || (ref.name && String(ref.name).trim())));
    }

    function previewOf(item) {
        if (!item) return '';
        if (item.kind) {
            const shown = orderCore().displayValue(item.kind, item.value);
            if (shown) return shown;
        }
        if (typeof item.value === 'string' && item.value.trim()) return item.value.trim();
        if (item.valueText && String(item.valueText).trim()) return String(item.valueText).trim();
        if (item.text && String(item.text).trim()) return String(item.text).trim();
        return stripHtml(item.note);
    }

    function itemHasContent(item) {
        if (!item || item.noteOnly) return !!stripHtml(item && item.note);
        if (item.origin === 'line') return !!(item.valueText || item.text);
        if (previewOf(item)) return true;
        if (stripHtml(item.note)) return true;
        if (hasCarrier(item.carriedBy)) return true;
        return false;
    }

    function blankItem(sourceId, origin) {
        return {
            sourceId: sourceId,
            origin: origin,
            kind: null,
            name: '',
            idHint: null,
            header: null,
            position: 0,
            text: '',
            valueText: '',
            value: null,
            note: '',
            noteOnly: false,
            noteFor: null,
            carriedBy: null,
            people: false,
            requests: null,
            skip: false,
        };
    }

    function itemFromElement(service, el, position) {
        const liturgy = (service && service.liturgy) || {};
        const notes = (service && service.notes) || {};
        const carried = (service && service.carriedBy) || {};
        const item = blankItem(el.id, 'element');
        item.kind = el.kind;
        item.name = el.name;
        item.position = position;
        item.value = liturgy[el.id] === undefined ? null : clone(liturgy[el.id]);
        item.note = notes[el.id] || '';
        item.carriedBy = carried[el.id] ? clone(carried[el.id]) : null;
        item.people = isPeople(el);
        item.requests = el.requests || null;
        return item;
    }

    function leftoverToItem(left, position) {
        const item = blankItem(left.sourceId, 'leftover');
        item.kind = left.kind || null;
        item.name = left.name || '';
        item.idHint = left.idHint || null;
        item.header = left.header || null;
        item.position = position;
        item.text = left.text || '';
        item.valueText = left.valueText || '';
        item.value = left.value == null ? null : clone(left.value);
        item.note = left.note || '';
        item.carriedBy = left.carriedBy || null;
        item.people = !!left.people || left.sourceId === 'baptism' || left.idHint === 'baptism';
        item.requests = left.requests || null;
        return item;
    }

    // What this Sunday is actually carrying: the order it follows now, then
    // anything already sitting in the drawer. The drawer is offered again so
    // a second switch can still place it.
    function filledItemsFromService(service, order) {
        const items = [];
        const seen = {};
        const elements = (order && order.elements) || [];
        elements.forEach(function (el, index) {
            const item = itemFromElement(service, el, index);
            if (!itemHasContent(item)) return;
            seen[item.sourceId] = true;
            items.push(item);
        });
        ((service && service.liturgyLeftovers) || []).forEach(function (left, index) {
            if (!left || !left.sourceId || seen[left.sourceId]) return;
            const item = leftoverToItem(left, elements.length + index);
            if (!itemHasContent(item)) return;
            seen[item.sourceId] = true;
            items.push(item);
        });
        return items;
    }

    function fragmentsFromText(text) {
        const lines = String(text == null ? '' : text)
            .split(/\r?\n/)
            .map(function (line) { return line.trim(); })
            .filter(function (line) { return line.length > 0; });
        const fragments = [];
        let inNotes = false;
        lines.forEach(function (line, index) {
            const skip = index >= MAX_LINES;
            if (/^notes:?$/i.test(line) || /^notes:\s*$/i.test(line)) {
                inNotes = true;
                return;
            }
            if (!inNotes && /^notes:/i.test(line)) {
                inNotes = true;
                return;
            }
            if (inNotes) {
                const parsed = splitLabel(line);
                const noteFor = NOTE_ALIASES[norm(parsed.label)];
                if (!noteFor) return;
                const note = blankItem('N' + index, 'note');
                note.noteOnly = true;
                note.noteFor = noteFor;
                note.note = parsed.value;
                note.name = parsed.label;
                note.position = index;
                note.text = line;
                note.valueText = parsed.value;
                note.skip = skip;
                fragments.push(note);
                return;
            }
            const parsed = splitLabel(line);
            const alias = parsed.label ? aliasFor(parsed.label) : null;
            const item = blankItem('L' + index, 'line');
            item.position = index;
            item.text = line;
            item.valueText = parsed.value;
            item.skip = skip;
            if (alias) {
                item.kind = alias.kind || null;
                item.name = alias.name || parsed.label;
                item.idHint = alias.idHint || null;
                item.header = alias.header || null;
                item.people = !!alias.people;
            }
            fragments.push(item);
        });
        return { fragments: fragments };
    }

    function targetsFromOrder(order, options) {
        const opts = options || {};
        const slots = ((order && order.elements) || []).map(function (el, index) {
            return {
                id: el.id,
                kind: el.kind,
                name: el.name,
                position: index,
                requests: el.requests || null,
                people: isPeople(el),
                header: null,
            };
        });
        if (opts.headers) {
            HEADER_FIELDS.forEach(function (field, index) {
                slots.push({
                    id: field.id,
                    kind: 'header',
                    name: field.name,
                    position: 1000 + index,
                    requests: null,
                    people: false,
                    header: field.id,
                });
            });
        }
        return slots;
    }

    function compatible(source, target) {
        if (!source || !target || source.noteOnly || source.skip) return false;
        if (target.header) {
            if (source.kind && !source.header) return false;
            if (source.header && source.header !== target.header) return false;
            return true;
        }
        if (source.header) return false;
        if (source.kind && source.kind !== target.kind) return false;
        if (source.kind === 'person' && isPeople(source) !== !!target.people) return false;
        if (source.kind === 'prayer') {
            const sourceList = !!(source.requests || (Array.isArray(source.value) && source.value.some(hasCarrier)));
            if (sourceList !== !!target.requests) return false;
        }
        return true;
    }

    function claimOf(source, target, method) {
        return { source: source, target: target, method: method, probability: 1 };
    }

    // Exact lookups only. A repeated name is not exact — "Hymn" six times is
    // the case Jev, or kind-and-position, has to sort out.
    function settle(sources, targets) {
        const usedS = {};
        const usedT = {};
        const claims = [];

        function claim(source, target, method) {
            usedS[source.sourceId] = true;
            usedT[target.id] = true;
            claims.push(claimOf(source, target, method));
        }

        targets.forEach(function (target) {
            if (usedT[target.id]) return;
            const hits = sources.filter(function (source) {
                if (usedS[source.sourceId] || !compatible(source, target)) return false;
                if (source.sourceId === target.id || source.idHint === target.id) return true;
                return !!(target.header && source.header === target.header);
            });
            if (hits.length === 1) claim(hits[0], target, 'id');
        });

        targets.forEach(function (target) {
            if (usedT[target.id]) return;
            const name = norm(target.name);
            if (!name) return;
            const hits = sources.filter(function (source) {
                return !usedS[source.sourceId] && compatible(source, target) && norm(source.name) === name;
            });
            if (hits.length !== 1) return;
            const sameName = targets.filter(function (other) {
                return !usedT[other.id] && norm(other.name) === name && compatible(hits[0], other);
            });
            if (sameName.length === 1) claim(hits[0], sameName[0], 'name');
        });

        return { claims: claims, usedS: usedS, usedT: usedT };
    }

    function optionLabel(source, mode) {
        if (mode === 'document') {
            return 'line ' + (source.position + 1) + ': ' + clip(source.text || source.valueText || '', PREVIEW_LEN);
        }
        const kind = source.kind || 'line';
        return (source.name || kind) + ' (' + kind + '): ' + clip(previewOf(source), 160);
    }

    function buildQuestions(sources, targets, options) {
        const opts = options || {};
        const mode = opts.mode === 'document' ? 'document' : 'order';
        const notes = sources.filter(function (source) { return source.noteOnly && !source.skip; });
        const skipped = sources.filter(function (source) { return source.skip; });
        const pool = sources.filter(function (source) { return !source.noteOnly && !source.skip; });
        const settled = settle(pool, targets);
        const questions = {};

        targets.forEach(function (target) {
            if (settled.usedT[target.id]) return;
            const candidates = pool.filter(function (source) {
                return !settled.usedS[source.sourceId] && compatible(source, target);
            }).slice(0, 250);
            if (!candidates.length) return;
            const criteria = {
                none: 'Nothing here is this moment. Leave it empty.',
            };
            candidates.forEach(function (source) {
                if (source.sourceId === 'none') return;
                criteria[source.sourceId] = optionLabel(source, mode);
            });
            questions['slot_' + target.id] = {
                type: 'choice',
                instructions: {
                    question: mode === 'document'
                        ? 'Which line is the text of `targetSlot`? Choose none when no line is that moment. Pick one line as it stands. A slot named only for its kind, such as Hymn 2, is any moment of that kind, and a hymn title or a doxology is a hymn. A full sentence is not a song title. A passage that spans several verses is the sermon or the scripture reading, not a call, an assurance, or a benediction; one verse can be those. When several slots are the same kind, prefer the line that sits in the same place in the service.'
                        : 'Which filled element is the same moment in the service as `targetSlot`? Choose none when none of them is that moment. The same kind is not enough: an opening hymn is not a closing hymn, and a baptism is not some other person. When several of one kind are the same sort of moment, prefer the one in the same place in the service.',
                    targetSlot: {
                        id: target.id,
                        name: target.name,
                        kind: target.header ? 'header' : target.kind,
                        position: target.position,
                    },
                },
                criteria: criteria,
            };
        });

        const state = {
            task: mode === 'document'
                ? 'A bulletin is being read into one liturgy order. Each line is one slot, one Sunday header field, or neither.'
                : 'A filled order of service is being carried onto a different liturgy order. Move a filled element only when it is the same moment in the service.',
            sourceOrder: opts.sourceOrder || '',
            targetOrder: opts.targetOrder || '',
            slots: targets.map(function (target) {
                return {
                    id: target.id,
                    name: target.name,
                    kind: target.header ? 'header' : target.kind,
                    position: target.position,
                };
            }),
        };
        if (mode === 'document') {
            state.lines = pool.map(function (source) {
                return {
                    id: source.sourceId,
                    position: source.position,
                    text: clip(source.text || source.valueText || '', PREVIEW_LEN),
                };
            });
        } else {
            state.filled = pool.map(function (source) {
                return {
                    id: source.sourceId,
                    name: source.name,
                    kind: source.kind,
                    position: source.position,
                    value: clip(previewOf(source), PREVIEW_LEN),
                };
            });
        }

        return {
            state: state,
            questions: questions,
            claims: settled.claims,
            pool: pool,
            notes: notes,
            skipped: skipped,
            mode: mode,
        };
    }

    // Kind and position, as probabilities, so the assigner is the same one
    // Jev's distribution goes through. Untyped bulletin lines are not guessed.
    function positionalAnswers(built) {
        const answers = {};
        const used = {};
        built.claims.forEach(function (claim) { used[claim.source.sourceId] = true; });
        const targets = openTargets(built);
        targets.forEach(function (target) {
            let chosen = null;
            for (let i = 0; i < built.pool.length; i++) {
                const source = built.pool[i];
                if (used[source.sourceId] || !compatible(source, target)) continue;
                if (built.mode === 'document') {
                    if (target.header) {
                        if (source.header !== target.header) continue;
                    } else if (!source.kind) {
                        continue;
                    }
                }
                chosen = source;
                break;
            }
            const probabilities = { none: chosen ? 0.2 : 1 };
            if (chosen) {
                probabilities[chosen.sourceId] = 0.8;
                used[chosen.sourceId] = true;
            }
            answers['slot_' + target.id] = {
                type: 'choice',
                choice: chosen ? chosen.sourceId : 'none',
                probabilities: probabilities,
                confidence: chosen ? 0.8 : 1,
            };
        });
        return answers;
    }

    function openTargets(built) {
        const taken = {};
        built.claims.forEach(function (claim) { taken[claim.target.id] = true; });
        const seen = {};
        const targets = [];
        (built.state.slots || []).forEach(function (slot) { seen[slot.id] = slot; });
        // The slot list is only a sketch. The real targets ride on the claims'
        // questions, rebuilt from the pool's companion list stored beside state.
        (built.targets || []).forEach(function (target) {
            if (!taken[target.id]) targets.push(target);
        });
        targets.sort(function (a, b) { return a.position - b.position; });
        return targets;
    }

    function namesOf(text) {
        const cleaned = String(text || '').trim();
        if (!cleaned) return [];
        return cleaned
            .split(/\s*[,;]\s*|\s*&\s*|\s+and\s+/i)
            .map(function (part) { return part.replace(/\s+/g, ' ').trim(); })
            .filter(Boolean)
            .map(function (name) { return { id: null, name: name }; });
    }

    function valueFor(source, target) {
        if (source.origin !== 'line') {
            const value = clone(source.value);
            if (target.requests && Array.isArray(value)) {
                const named = value.filter(hasCarrier);
                if (named.length > target.requests.count) {
                    return {
                        value: named.slice(0, target.requests.count),
                        extra: named.slice(target.requests.count),
                        note: source.note || '',
                    };
                }
            }
            return { value: value, extra: null, note: source.note || '' };
        }
        const text = source.valueText || source.text || '';
        if (target.header) return { value: text, extra: null, note: '' };
        if (target.kind === 'hymn') return { value: { id: null, name: text }, extra: null, note: '' };
        if (target.kind === 'scripture') return { value: text, extra: null, note: '' };
        if (target.kind === 'other') return { value: null, extra: null, note: text };
        if (target.people || target.id === 'baptism') return { value: namesOf(text), extra: null, note: '' };
        if (target.kind === 'person') return { value: { id: null, name: text }, extra: null, note: '' };
        if (target.kind === 'prayer' && target.requests) {
            const all = namesOf(text);
            return {
                value: all.slice(0, target.requests.count),
                extra: all.length > target.requests.count ? all.slice(target.requests.count) : null,
                note: '',
            };
        }
        if (target.kind === 'prayer') return { value: [], extra: null, note: text };
        return { value: text, extra: null, note: '' };
    }

    function placementFrom(pair) {
        const packed = valueFor(pair.source, pair.target);
        return {
            placement: {
                targetId: pair.target.id,
                sourceId: pair.source.sourceId,
                method: pair.method,
                probability: pair.probability,
                kind: pair.target.header ? 'header' : pair.target.kind,
                name: pair.source.name || pair.target.name,
                header: pair.target.header || null,
                value: packed.value,
                note: packed.note,
                carriedBy: pair.source.carriedBy || null,
                valueText: typeof packed.value === 'string' ? packed.value : (pair.source.valueText || ''),
            },
            extra: packed.extra,
            source: pair.source,
            target: pair.target,
        };
    }

    function serializeLeftover(source, valueOverride) {
        return {
            sourceId: source.sourceId,
            origin: source.origin || 'element',
            kind: source.kind || null,
            name: source.name || '',
            idHint: source.idHint || null,
            header: source.header || null,
            text: source.text || '',
            valueText: source.valueText || '',
            value: valueOverride !== undefined ? clone(valueOverride) : (source.value == null ? null : clone(source.value)),
            note: source.note || '',
            carriedBy: source.carriedBy ? { id: source.carriedBy.id || null, name: source.carriedBy.name || '' } : null,
            people: !!source.people || source.sourceId === 'baptism' || source.idHint === 'baptism',
            requests: source.requests || null,
        };
    }

    function assign(built, answers, methodName) {
        const usedS = {};
        const usedT = {};
        const placements = [];
        const extras = [];

        function take(pair) {
            if (usedS[pair.source.sourceId] || usedT[pair.target.id]) return;
            usedS[pair.source.sourceId] = true;
            usedT[pair.target.id] = true;
            const made = placementFrom(pair);
            placements.push(made.placement);
            if (made.extra && made.extra.length) {
                const extra = serializeLeftover(pair.source, made.extra);
                extra.sourceId = pair.source.sourceId + '__more';
                extra.name = (pair.source.name || 'Prayer') + ' (more people)';
                extra.origin = 'leftover';
                extras.push(extra);
            }
        }

        built.claims.forEach(function (claim) { take(claim); });

        const pairs = [];
        (built.targets || []).forEach(function (target) {
            if (usedT[target.id]) return;
            const answer = answers['slot_' + target.id];
            const probabilities = answer && answer.probabilities;
            if (!probabilities) return;
            const noneP = typeof probabilities.none === 'number' ? probabilities.none : 0;
            Object.keys(probabilities).forEach(function (key) {
                if (key === 'none') return;
                const probability = probabilities[key];
                if (typeof probability !== 'number') return;
                if (!(probability > noneP && probability >= MIN_PROBABILITY)) return;
                const source = built.pool.find(function (item) { return item.sourceId === key; });
                if (!source || !compatible(source, target)) return;
                pairs.push({
                    source: source,
                    target: target,
                    probability: probability,
                    method: methodName,
                });
            });
        });
        pairs.sort(function (a, b) {
            if (b.probability !== a.probability) return b.probability - a.probability;
            return a.target.position - b.target.position;
        });
        pairs.forEach(take);

        const leftovers = built.pool.filter(function (source) { return !usedS[source.sourceId]; })
            .map(function (source) { return serializeLeftover(source); });
        built.skipped.forEach(function (source) {
            leftovers.push(serializeLeftover(source));
        });
        extras.forEach(function (extra) { leftovers.push(extra); });

        const blanks = (built.targets || []).filter(function (target) {
            return !usedT[target.id] && !target.header;
        }).map(function (target) { return target.id; });

        return { placements: placements, leftovers: leftovers, blanks: blanks, usedT: usedT };
    }

    function attachNotes(result, notes, targets) {
        (notes || []).forEach(function (note) {
            const placement = result.placements.find(function (item) { return item.targetId === note.noteFor; });
            if (placement) {
                placement.note = note.note;
                return;
            }
            const target = (targets || []).find(function (item) { return item.id === note.noteFor; });
            if (!target) {
                result.leftovers.push(serializeLeftover(note));
                return;
            }
            result.placements.push({
                targetId: target.id,
                sourceId: note.sourceId,
                method: 'note',
                probability: 1,
                kind: target.kind,
                name: target.name,
                header: null,
                value: orderCore().emptyValue(target.people ? 'people' : target.kind),
                note: note.note,
                carriedBy: null,
                valueText: '',
            });
        });
    }

    function plan(sources, targets, options) {
        const opts = options || {};
        const list = Array.isArray(sources) ? sources : [];
        const slots = Array.isArray(targets) ? targets : [];
        const built = buildQuestions(list, slots, opts);
        built.targets = slots;
        const judged = opts.answers && typeof opts.answers === 'object';
        const answers = judged ? opts.answers : positionalAnswers(built);
        const assigned = assign(built, answers, judged ? 'jev' : 'order');
        attachNotes(assigned, built.notes, slots);
        const guessed = assigned.placements.filter(function (item) { return item.method === 'order'; }).length;
        return {
            judge: judged ? 'jev' : 'order',
            guessed: guessed,
            placements: assigned.placements,
            leftovers: assigned.leftovers,
            blanks: assigned.blanks,
            usage: opts.usage || null,
            questions: built.questions,
            state: built.state,
        };
    }

    function writeSlot(service, id, value) {
        if (!service.liturgy || typeof service.liturgy !== 'object') service.liturgy = {};
        const current = service.liturgy[id];
        if (value && typeof value === 'object' && !Array.isArray(value) &&
            current && typeof current === 'object' && !Array.isArray(current)) {
            Object.keys(current).forEach(function (key) { delete current[key]; });
            Object.assign(current, clone(value));
            return;
        }
        service.liturgy[id] = clone(value);
    }

    function emptySlot(service, id) {
        if (service.liturgy && Object.prototype.hasOwnProperty.call(service.liturgy, id)) {
            const current = service.liturgy[id];
            if (Array.isArray(current)) current.length = 0;
            else if (current && typeof current === 'object') {
                Object.keys(current).forEach(function (key) { delete current[key]; });
                current.id = null;
                current.name = '';
            } else service.liturgy[id] = '';
        }
        if (service.notes && Object.prototype.hasOwnProperty.call(service.notes, id)) service.notes[id] = '';
        if (service.carriedBy && service.carriedBy[id] && typeof service.carriedBy[id] === 'object') {
            service.carriedBy[id].id = null;
            service.carriedBy[id].name = '';
        }
    }

    function applyHeader(service, placement) {
        const text = placement.valueText || (typeof placement.value === 'string' ? placement.value : '');
        if (placement.header === 'theme') service.theme = text;
        else if (placement.header === 'keyVerse') service.keyVerse = text;
        else if (placement.header === 'serviceLeader' && service.serviceLeader) {
            service.serviceLeader.name = text;
            service.serviceLeader.id = null;
        } else if (placement.header === 'musicLeader' && service.musicLeader) {
            service.musicLeader.name = text;
            service.musicLeader.id = null;
        } else if (placement.header === 'preacher' && service.preacher) {
            service.preacher.name = text;
            service.preacher.id = null;
        }
    }

    // Move the plan onto the Sunday the editor is holding. A value that
    // changed slots is cleared on the old id, in place when the picker is
    // holding that object. A target the plan left alone keeps whatever it
    // already had.
    function applyToService(service, targetOrder, translation) {
        const elements = (targetOrder && targetOrder.elements) || [];
        const byId = {};
        elements.forEach(function (el) { byId[el.id] = el; });
        if (!service.notes || typeof service.notes !== 'object') service.notes = {};
        if (!service.carriedBy || typeof service.carriedBy !== 'object') service.carriedBy = {};
        const written = {};
        ((translation && translation.placements) || []).forEach(function (placement) {
            if (placement.header) {
                applyHeader(service, placement);
                return;
            }
            if (!placement.targetId || !byId[placement.targetId]) return;
            // A note with no filled value must not blank a slot the bulletin
            // simply did not mention.
            if (placement.method !== 'note') writeSlot(service, placement.targetId, placement.value);
            service.notes[placement.targetId] = placement.note || '';
            if (hasCarrier(placement.carriedBy)) {
                service.carriedBy[placement.targetId] = {
                    id: placement.carriedBy.id || null,
                    name: placement.carriedBy.name || '',
                };
            }
            written[placement.targetId] = true;
        });
        const emptied = {};
        function emptyStored(sourceId) {
            if (!sourceId || written[sourceId] || emptied[sourceId]) return;
            if (/^[LN]\d+$/.test(sourceId)) return;
            emptySlot(service, sourceId);
            emptied[sourceId] = true;
        }
        ((translation && translation.placements) || []).forEach(function (placement) {
            if (placement.sourceId && placement.sourceId !== placement.targetId) emptyStored(placement.sourceId);
        });
        ((translation && translation.leftovers) || []).forEach(function (left) {
            if (!left || left.origin === 'line' || left.origin === 'note') return;
            emptyStored(left.sourceId);
        });
        service.liturgyOrderId = (targetOrder && targetOrder.id) || '';
        service.liturgyLeftovers = ((translation && translation.leftovers) || []).map(function (left) {
            return serializeLeftover(left);
        });
        return service;
    }

    // The flat fields a bulletin writes onto services/{date}. Leaders stay
    // strings, which is the shape that import has always stored.
    function importPatch(translation, targetOrder) {
        const patch = {
            liturgyOrderId: (targetOrder && targetOrder.id) || '',
            liturgy: {},
            notes: {},
            liturgyLeftovers: ((translation && translation.leftovers) || []).map(function (left) {
                return serializeLeftover(left);
            }),
            dateText: '',
        };
        ((translation && translation.placements) || []).forEach(function (placement) {
            const text = placement.valueText || (typeof placement.value === 'string' ? placement.value : '');
            if (placement.header === 'date') patch.dateText = text;
            else if (placement.header === 'theme') patch.theme = text;
            else if (placement.header === 'keyVerse') patch.keyVerse = text;
            else if (placement.header === 'serviceLeader') patch.serviceLeader = text;
            else if (placement.header === 'musicLeader') patch.musicLeader = text;
            else if (placement.header === 'preacher') patch.preacher = text;
            else if (placement.targetId && placement.method === 'note') {
                if (placement.note) patch.notes[placement.targetId] = placement.note;
            } else if (placement.targetId) {
                patch.liturgy[placement.targetId] = placement.value;
                if (placement.note) patch.notes[placement.targetId] = placement.note;
            }
        });
        const candidates = patch.liturgy.baptism;
        const named = Array.isArray(candidates) && candidates.some(hasCarrier);
        const orderHas = ((targetOrder && targetOrder.elements) || []).some(function (el) { return el.id === 'baptism'; });
        patch.hasBaptism = !!(orderHas && named);
        return patch;
    }

    const LiturgyTranslateCore = {
        MIN_PROBABILITY: MIN_PROBABILITY,
        MAX_LINES: MAX_LINES,
        HEADER_FIELDS: HEADER_FIELDS,
        previewOf: previewOf,
        filledItemsFromService: filledItemsFromService,
        fragmentsFromText: fragmentsFromText,
        targetsFromOrder: targetsFromOrder,
        buildQuestions: buildQuestions,
        plan: plan,
        applyToService: applyToService,
        importPatch: importPatch,
        compatible: compatible,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LiturgyTranslateCore;
    } else {
        global.LiturgyTranslateCore = LiturgyTranslateCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
