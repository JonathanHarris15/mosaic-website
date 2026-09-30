// Household editor + Family tree (MS-709) — one card for every surface that
// shows a Household: the Shepherding Profile, the Directory profile and the
// Households tab of Manage Tags and Relationships.
//
//   HouseholdEditor.render(el, {
//     db,                        firestore handle (writes go to `families`)
//     families, people,          current rosters; people carry { id, name, sex }
//     personId | familyId,       whose Household: a Person's, or one record
//     canEdit,                   off → read-only
//     personHref(id),            where a name links to (optional)
//     onChange(families, info),  after a write; info.familyId is the record written
//     toast(message, kind),      optional
//     headingLevel,              2 or 3 (default 2)
//   })
//
// Call it again whenever the inputs change; it redraws in place and keeps
// whatever is typed in a search box. The planners are FamilyCore's; this file
// only draws and writes. Pages mount it inside an x-ignore element so Alpine
// leaves the DOM to it.

(function (global) {
    'use strict';

    var F = global.FamilyCore;
    var MAX_MATCHES = 8;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function personOf(o, id) {
        return (o.people || []).find(function (p) { return p && p.id === id; }) || null;
    }
    function nameOf(o, id) {
        var p = personOf(o, id);
        return (p && p.name) || 'Unknown person';
    }
    function firstOf(o, id) { return nameOf(o, id).trim().split(/\s+/)[0]; }
    function initials(name) {
        var parts = String(name || '?').trim().split(/\s+/);
        var a = (parts[0] || '?')[0] || '?';
        var b = parts.length > 1 ? parts[parts.length - 1][0] : '';
        return (a + b).toUpperCase();
    }
    function href(o, id) { return typeof o.personHref === 'function' ? o.personHref(id) : null; }
    function linkAttrs(o, id) { return ' href="' + esc(href(o, id)) + '"'; }

    function familyOf(o) {
        if (o.familyId) return (o.families || []).find(function (f) { return f.id === o.familyId; }) || null;
        if (o.personId) return F.householdOf(o.families || [], o.personId);
        return null;
    }

    function householdName(o, family) {
        if (!family) return '';
        return F.familyGroupName(family, o.people || []);
    }

    // ── Writes ───────────────────────────────────────────────────────────────

    function apply(db, families, plan) {
        var col = db.collection('families');
        var list = (families || []).slice();
        if (plan.action === 'create') {
            return col.add(plan.changes).then(function (ref) {
                return { families: list.concat([Object.assign({ id: ref.id }, plan.changes)]), familyId: ref.id };
            });
        }
        if (plan.action === 'merge') {
            var batch = db.batch();
            batch.update(col.doc(plan.familyId), plan.changes);
            batch.delete(col.doc(plan.deleteId));
            return batch.commit().then(function () {
                return {
                    families: list.filter(function (f) { return f.id !== plan.deleteId; })
                        .map(function (f) { return f.id === plan.familyId ? Object.assign({}, f, plan.changes) : f; }),
                    familyId: plan.familyId,
                };
            });
        }
        if (plan.action === 'delete') {
            return col.doc(plan.familyId).delete().then(function () {
                return { families: list.filter(function (f) { return f.id !== plan.familyId; }), familyId: null };
            });
        }
        return col.doc(plan.familyId).update(plan.changes).then(function () {
            return {
                families: list.map(function (f) { return f.id === plan.familyId ? Object.assign({}, f, plan.changes) : f; }),
                familyId: plan.familyId,
            };
        });
    }

    function run(el, plan, okMessage) {
        var o = el._hh.o;
        var toast = typeof o.toast === 'function' ? o.toast : function () {};
        if (!plan.valid) {
            el._hh.error = plan.errors[0] || 'That change could not be made';
            draw(el);
            return;
        }
        el._hh.error = null;
        el._hh.busy = true;
        apply(o.db, o.families, plan).then(function (res) {
            el._hh.busy = false;
            el._hh.q = {};
            if (typeof o.onChange === 'function') o.onChange(res.families, { familyId: res.familyId, action: plan.action });
            else { o.families = res.families; draw(el); }
            toast(okMessage || 'Household updated');
        }, function (e) {
            el._hh.busy = false;
            console.error('Error saving household:', e);
            el._hh.error = 'Could not save the Household. Check your connection and try again.';
            draw(el);
            toast('Error saving household', 'error');
        });
    }

    // ── Drawing ──────────────────────────────────────────────────────────────

    // The person whose page this is gets a plain pill: no link back to the page
    // you are on, and no × to take them out of their own Household from it.
    function chip(o, id, action, label, own) {
        var me = !!o.personId && id === o.personId;
        var h = me ? null : href(o, id);
        var name = esc(nameOf(o, id));
        var inner = h ? '<a' + linkAttrs(o, id) + '>' + name + '</a>' : '<span>' + name + '</span>';
        if (me) return '<span class="hh-chip hh-chip--me' + (own ? ' hh-chip--own' : '') + '" role="listitem" aria-current="page">' + inner + '</span>';
        var x = (o.canEdit && action)
            ? '<button type="button" class="hh-chip__x" data-hh="' + action + '" data-id="' + esc(id) + '" aria-label="' + esc(label) + '">' +
              '<span class="material-symbols-outlined" aria-hidden="true">close</span></button>'
            : '';
        return '<span class="hh-chip' + (own ? ' hh-chip--own' : '') + '" role="listitem">' + inner + x + '</span>';
    }

    function finder(el, key, placeholder) {
        var q = (el._hh.q[key] || '');
        return '<div class="hh-find">' +
            '<input type="text" autocomplete="off" spellcheck="false" data-hh-find="' + key + '" value="' + esc(q) + '"' +
            ' placeholder="' + esc(placeholder) + '" aria-label="' + esc(placeholder) + '" />' +
            '<div data-hh-list="' + key + '">' + matchesHtml(el, key) + '</div></div>';
    }

    function slotKey(key) { return key === 'child' ? 'child' : key; }

    function matchesHtml(el, key) {
        var o = el._hh.o;
        var q = (el._hh.q[key] || '').trim().toLowerCase();
        if (!q) return '';
        var family = familyOf(o);
        var found = F.householdCandidates(o.families || [], o.people || [], family, slotKey(key))
            .filter(function (p) { return String(p.name || '').toLowerCase().indexOf(q) !== -1; })
            .slice(0, MAX_MATCHES);
        if (!found.length) {
            var why = key === 'child'
                ? 'No match. A child who already has parents in another Household is not listed.'
                : 'No match. Only unmarried people recorded as ' + (key === 'husbandId' ? 'male' : 'female') + ' are listed.';
            return '<div class="hh-find__list"><div class="hh-find__none">' + esc(why) + '</div></div>';
        }
        return '<ul class="hh-find__list" role="listbox">' + found.map(function (p) {
            return '<li role="option"><button type="button" data-hh="pick" data-slot="' + key + '" data-id="' + esc(p.id) + '">' + esc(p.name) + '</button></li>';
        }).join('') + '</ul>';
    }

    function parentSlot(el, family, seat) {
        var o = el._hh.o;
        var role = seat === 'husbandId' ? 'Husband' : 'Wife';
        var id = family ? family[seat] : null;
        var body;
        if (id) {
            body = '<div class="hh-chips" role="list">' + chip(o, id, 'unseat', 'Remove ' + nameOf(o, id) + ' as ' + role.toLowerCase(), false) + '</div>';
        } else if (o.canEdit) {
            body = finder(el, seat, 'Find a ' + role.toLowerCase() + '…');
        } else {
            body = '<span class="hh-empty">None</span>';
        }
        return '<div class="hh-slot" data-seat="' + seat + '"><span class="hh-slot__role">' + role + '</span>' + body + '</div>';
    }

    function pill(o, id, meId) {
        var name = nameOf(o, id);
        var h = href(o, id);
        var me = id === meId;
        var inner = '<span class="m-avatar" aria-hidden="true">' + esc(initials(name)) + '</span>' + esc(firstOf(o, id));
        var attrs = ' class="ft-person' + (me ? ' ft-person--me' : '') + '" data-ft-pid="' + esc(id) + '" title="' + esc(name) + '"' + (me ? ' aria-current="true"' : '');
        return (h && !me)
            ? '<a' + attrs + linkAttrs(o, id) + '>' + inner + '</a>'
            : '<span' + attrs + '>' + inner + '</span>';
    }

    function couple(o, h, w, meId) {
        if (h && w) {
            return '<span class="ft-couple">' + pill(o, h, meId) +
                '<span class="ft-couple__bond"><span class="ft-sr">married to</span></span>' + pill(o, w, meId) + '</span>';
        }
        return (h || w) ? pill(o, h || w, meId) : '';
    }

    function unit(o, node, meId, isRoot) {
        var c = couple(o, node.husbandId, node.wifeId, meId);
        var head = isRoot && c ? '<span class="ft-home">' + c + '</span>' : c;
        var kids = node.children.length
            ? '<div class="ftC__kids">' + node.children.map(function (k) {
                return '<div class="ftC__kid">' + (k.household ? unit(o, k.household, meId, false) : pill(o, k.personId, meId)) + '</div>';
            }).join('') + '</div>'
            : '';
        return '<div class="ftC__unit">' + head + kids + '</div>';
    }

    function treeHtml(o, family) {
        var t = F.familyTree(o.families || [], family.id);
        if (!t) return '';
        var single = !t.origins.length && !t.root.children.length;
        if (single) return '<p class="hh-hint">No parents or children recorded yet, so there is no tree to draw.</p>';
        var origins = t.origins.length
            ? '<div class="ftC__origins">' + t.origins.map(function (g) {
                return '<div class="ftC__origin" data-ft-for="' + esc(g.forPersonId) + '"><span class="ftC__olabel">' + esc(firstOf(o, g.forPersonId)) + '’s parents</span>' +
                    (couple(o, g.husbandId, g.wifeId, o.personId) || '<span class="hh-empty">Not recorded</span>') + '</div>';
            }).join('') + '</div>'
            : '';
        return '<div class="ftC-scroll" tabindex="0" role="region" aria-label="Family tree, scrolls sideways">' +
            '<div class="ftC">' + origins + unit(o, t.root, o.personId, true) + '</div></div>';
    }

    // Each origin sits wherever its row's wrapping puts it, so the line from a
    // parents' marriage down to their child in the home couple is measured and
    // drawn after layout, not in CSS.
    var SVG = 'http://www.w3.org/2000/svg';
    function linkOrigins(el) {
        var tree = el.querySelector('.ftC');
        if (!tree) return;
        var old = tree.querySelector('.ftC__links');
        if (old) old.remove();
        var home = tree.querySelector('.ft-home');
        var origins = tree.querySelectorAll('.ftC__origin[data-ft-for]');
        if (!home || !origins.length) return;
        var box = tree.getBoundingClientRect();
        if (!box.width) return;
        var svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('class', 'ftC__links');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('width', box.width);
        svg.setAttribute('height', box.height);
        Array.prototype.forEach.call(origins, function (origin) {
            var child = home.querySelector('[data-ft-pid="' + CSS.escape(origin.getAttribute('data-ft-for')) + '"]');
            var from = origin.querySelector('.ft-couple__bond') || origin.querySelector('.ft-person');
            if (!child || !from) return;
            var a = from.getBoundingClientRect(), b = child.getBoundingClientRect(), o = origin.getBoundingClientRect();
            var x1 = a.left + a.width / 2 - box.left, y1 = a.bottom - box.top;
            var x2 = b.left + b.width / 2 - box.left, y2 = b.top - box.top;
            var mid = (o.bottom + home.getBoundingClientRect().top) / 2 - box.top;
            var path = document.createElementNS(SVG, 'path');
            path.setAttribute('d', 'M' + x1 + ' ' + y1 + ' V' + mid + ' H' + x2 + ' V' + y2);
            svg.appendChild(path);
        });
        tree.appendChild(svg);
    }

    function html(el) {
        var o = el._hh.o;
        var h = 'h' + (o.headingLevel === 3 ? 3 : 2);
        var family = familyOf(o);
        var out = '<section class="hh" aria-label="Household">';
        out += '<div class="hh-head"><' + h + ' class="hh-title">Household</' + h + '>' +
            (family ? '<p class="hh-name">' + esc(householdName(o, family)) + '</p>' : '') + '</div>';

        if (!family && o.personId) {
            var who = personOf(o, o.personId);
            out += '<p class="hh-hint">' + esc(nameOf(o, o.personId)) + ' is not in a Household yet.</p>';
            if (o.canEdit) {
                out += who && who.sex
                    ? '<button type="button" class="m-btn m-btn--secondary m-btn--sm" data-hh="start"><span class="material-symbols-outlined" aria-hidden="true">add_home</span><span class="m-btn__label">Start a Household</span></button>'
                    : '<p class="hh-hint">Record their sex to start a Household with them as husband or wife.</p>';
            }
            return out + errorHtml(el) + '</section>';
        }

        var view = family ? F.householdView(o.families || [], family) : { atHome: [], ownHousehold: [], anniversary: null };
        if (family) out += duplicatesHtml(el, family);

        out += '<div class="hh-group"><span class="m-label">Parents</span><div class="hh-pair">' +
            parentSlot(el, family, 'husbandId') + parentSlot(el, family, 'wifeId') + '</div>' +
            (o.canEdit && family && !(family.husbandId && family.wifeId) ? '<p class="hh-hint">Leave one empty for a single parent.</p>' : '') +
            '</div>';

        if (family) {
            out += '<div class="hh-group"><span class="m-label" id="' + el._hh.uid + '-home">Children at home</span>' +
                (view.atHome.length
                    ? '<div class="hh-chips" role="list" aria-labelledby="' + el._hh.uid + '-home">' + view.atHome.map(function (id) {
                        return chip(o, id, 'removeChild', 'Take ' + nameOf(o, id) + ' out of this Household', false);
                    }).join('') + '</div>'
                    : '<span class="hh-empty">None</span>') +
                (o.canEdit ? finder(el, 'child', 'Add a child…') : '') + '</div>';

            out += '<div class="hh-group"><span class="m-label" id="' + el._hh.uid + '-own">Children with their own Household</span>' +
                (view.ownHousehold.length
                    ? '<div class="hh-chips" role="list" aria-labelledby="' + el._hh.uid + '-own">' + view.ownHousehold.map(function (c) {
                        return chip(o, c.personId, 'removeOwn', 'Take ' + nameOf(o, c.personId) + ' out of this Family tree', true);
                    }).join('') + '</div>'
                    : '<span class="hh-empty">None</span>') +
                '<p class="hh-hint">A child moves here on their own when they marry. They stay in the Family tree.</p></div>';

            if (o.canEdit || view.anniversary) {
                out += '<div class="hh-group"><label class="m-label" for="' + el._hh.uid + '-anniv">Anniversary</label>' +
                    (o.canEdit
                        ? '<input class="hh-date" type="date" id="' + el._hh.uid + '-anniv" data-hh-anniv value="' + esc(view.anniversary || '') + '" />'
                        : '<span id="' + el._hh.uid + '-anniv">' + esc(view.anniversary) + '</span>') + '</div>';
            }

            out += '<div class="hh-group"><span class="m-label">Family tree</span>' + treeHtml(o, family) + '</div>';
        }
        return out + errorHtml(el) + '</section>';
    }

    function seatsFilled(f) { return (f.husbandId ? 1 : 0) + (f.wifeId ? 1 : 0); }

    function duplicatesHtml(el, family) {
        var o = el._hh.o;
        if (!o.canEdit) return '';
        return F.householdDuplicates(o.families || [], family).map(function (d) {
            var who = d.sharedIds.map(function (id) { return nameOf(o, id); }).join(' and ');
            var kids = d.childIds.map(function (id) { return nameOf(o, id); });
            var withKids = kids.length ? ' with ' + kids.join(', ') : '';
            if (!d.mergeable) {
                return '<div class="hh-dup" role="note"><p>' + esc(who) + ' is also a husband or wife in another Household' + esc(withKids) +
                    '. Someone can be married in only one Household, so take them out of one of them.</p></div>';
            }
            return '<div class="hh-dup" role="note"><p>' + esc(who) + ' is also recorded in a second Household' + esc(withKids) +
                '. Merge them so both parents are joined to every child.</p>' +
                '<button type="button" class="m-btn m-btn--secondary m-btn--sm" data-hh="merge" data-id="' + esc(d.familyId) + '">' +
                '<span class="material-symbols-outlined" aria-hidden="true">merge</span><span class="m-btn__label">Merge into one Household</span></button></div>';
        }).join('');
    }

    function errorHtml(el) {
        return el._hh.error ? '<p class="hh-error" role="alert">' + esc(el._hh.error) + '</p>' : '';
    }

    function draw(el) {
        var active = document.activeElement;
        var focusKey = active && el.contains(active) && active.getAttribute('data-hh-find');
        var caret = focusKey ? active.selectionStart : null;
        el.innerHTML = html(el);
        var tree = el.querySelector('.ftC');
        el._hh.ro.disconnect();
        if (tree) el._hh.ro.observe(tree);
        linkOrigins(el);
        if (focusKey) {
            var input = el.querySelector('[data-hh-find="' + focusKey + '"]');
            if (input) { input.focus(); try { input.setSelectionRange(caret, caret); } catch (e) { /* not a text input */ } }
        }
    }

    // ── Events ───────────────────────────────────────────────────────────────

    function confirmWith(o, message) {
        var ask = typeof o.confirm === 'function' ? o.confirm : global.confirm;
        return !ask || ask(message);
    }

    function bind(el) {
        el.addEventListener('input', function (ev) {
            var key = ev.target.getAttribute('data-hh-find');
            if (!key) return;
            el._hh.q[key] = ev.target.value;
            var list = el.querySelector('[data-hh-list="' + key + '"]');
            if (list) list.innerHTML = matchesHtml(el, key);
        });
        el.addEventListener('keydown', function (ev) {
            var key = ev.target.getAttribute('data-hh-find');
            if (!key) return;
            if (ev.key === 'Enter') {
                var first = el.querySelector('[data-hh-list="' + key + '"] button');
                if (first) { ev.preventDefault(); first.click(); }
            } else if (ev.key === 'Escape') {
                el._hh.q[key] = '';
                ev.target.value = '';
                var list = el.querySelector('[data-hh-list="' + key + '"]');
                if (list) list.innerHTML = '';
            }
        });
        el.addEventListener('change', function (ev) {
            if (!ev.target.hasAttribute('data-hh-anniv')) return;
            var o = el._hh.o;
            var family = familyOf(o);
            if (family) run(el, F.planSetAnniversary(o.families, family.id, ev.target.value), 'Anniversary saved');
        });
        el.addEventListener('click', function (ev) {
            var btn = ev.target.closest('[data-hh]');
            if (!btn || !el.contains(btn) || el._hh.busy) return;
            var o = el._hh.o;
            if (!o.canEdit) return;
            var families = o.families || [];
            var family = familyOf(o);
            var fid = family ? family.id : null;
            var act = btn.getAttribute('data-hh');
            var id = btn.getAttribute('data-id');
            var byId = function (pid) { return personOf(o, pid); };

            if (act === 'start') {
                var me = personOf(o, o.personId);
                var seat = me && me.sex === 'male' ? 'husbandId' : 'wifeId';
                run(el, F.planSetParent(families, null, seat, o.personId, byId), 'Household started');
            } else if (act === 'pick') {
                var slot = btn.getAttribute('data-slot');
                run(el, slot === 'child'
                    ? F.planAddChild(families, fid, id)
                    : F.planSetParent(families, fid, slot, id, byId));
            } else if (act === 'unseat') {
                var seatOf = family && family.husbandId === id ? 'husbandId' : 'wifeId';
                if (confirmWith(o, 'Remove ' + nameOf(o, id) + ' as ' + (seatOf === 'husbandId' ? 'husband' : 'wife') + ' of this Household?')) {
                    run(el, F.planSetParent(families, fid, seatOf, null, byId));
                }
            } else if (act === 'merge') {
                var other = (families).find(function (f) { return f.id === id; });
                if (!other || !family) return;
                var keepThis = seatsFilled(family) >= seatsFilled(other);
                run(el, keepThis ? F.planMergeHouseholds(families, fid, id) : F.planMergeHouseholds(families, id, fid), 'Households merged');
            } else if (act === 'removeChild') {
                run(el, F.planRemoveChild(families, fid, id));
            } else if (act === 'removeOwn') {
                if (confirmWith(o, 'Take ' + nameOf(o, id) + ' out of this Family tree? Their own Household is not changed.')) {
                    run(el, F.planRemoveChild(families, fid, id));
                }
            }
        });
    }

    var seq = 0;
    function render(el, opts) {
        if (!el) return;
        if (!el._hh) {
            el._hh = { q: {}, error: null, busy: false, uid: 'hh' + (++seq), key: null };
            el._hh.ro = new ResizeObserver(function () { linkOrigins(el); });
            bind(el);
            if (document.fonts) document.fonts.ready.then(function () { linkOrigins(el); });
        }
        var key = (opts.familyId || '') + '|' + (opts.personId || '');
        if (el._hh.key !== key) { el._hh.q = {}; el._hh.error = null; el._hh.key = key; }
        el._hh.o = opts;
        draw(el);
    }

    var HouseholdEditor = { render: render };
    if (typeof module !== 'undefined' && module.exports) module.exports = HouseholdEditor;
    if (global) global.HouseholdEditor = HouseholdEditor;
})(typeof window !== 'undefined' ? window : null);
