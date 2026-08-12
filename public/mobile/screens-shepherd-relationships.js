/* ============================================================
   screens-shepherd-relationships.js — the Relationships tab of the mobile
   "Manage Tags and Relationships" screen (MS-106, ADR-0014).

   Parity with the desktop manager (shepherding-relationships.js): this is the ONE
   home where relationship vocabulary is defined. An elder creates Relationship
   Types here — the kind × priority structures — and manages who holds them: the
   pairs of a Pairwise type, or the named Relationship Groups of a Group type, with
   their leaders and rosters. A profile can only apply what is defined here.

   Every model decision goes through the shared RelationshipCore /
   RelationshipGroupCore, exactly as the desktop does — this screen only loads,
   writes, and confirms. The Relations Viewer is deliberately NOT on mobile.
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, data = M.data, Fragment = M.Fragment;
  var useState = M.hooks.useState, useEffect = M.hooks.useEffect;

  var OVER = { fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--on-surface-variant)" };
  var inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", background: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", outline: "none", fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" };
  var iconBtn = { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-surface-variant)", cursor: "pointer", borderRadius: 8 };

  function pill(variant) {
    return { padding: "9px 16px", borderRadius: "var(--radius-full)", border: "none", background: variant === "ghost" ? "transparent" : "var(--primary)", color: variant === "ghost" ? "var(--on-surface-variant)" : "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
  }

  function Modal(props) {
    return html`<${Fragment}>
      <div onClick=${props.onClose} style=${{ position: "absolute", inset: 0, zIndex: 55, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)" }}></div>
      <div style=${{ position: "absolute", left: 16, right: 16, top: "50%", transform: "translateY(-50%)", zIndex: 56, maxHeight: "84%", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: 18, boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style=${{ padding: "16px 18px 12px", borderBottom: "1px solid var(--outline-variant)", flexShrink: 0 }}>
          <h2 style=${{ margin: 0, fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, color: "var(--primary)" }}>${props.title}</h2>
        </div>
        <div style=${{ padding: 18, overflowY: "auto", flex: 1 }}>${props.children}</div>
        ${props.footer ? html`<div style=${{ padding: "12px 18px", borderTop: "1px solid var(--outline-variant)", display: "flex", justifyContent: "flex-end", gap: 10, flexShrink: 0 }}>${props.footer}</div>` : null}
      </div>
    </${Fragment}>`;
  }

  // A two-way segmented control — the phone's answer to the desktop's kind/priority
  // switches. Disabled when a type already exists: kind is immutable (ADR-0014 s1).
  function Segmented(props) {
    return html`<div style=${{ display: "flex", gap: 3, padding: 3, background: "var(--surface-container)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", opacity: props.disabled ? 0.55 : 1 }}>
      ${props.options.map(function (o) {
        var on = props.value === o.value;
        return html`<button key=${String(o.value)} disabled=${props.disabled}
          onClick=${function () { if (!props.disabled) props.onChange(o.value); }}
          style=${{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 6px", borderRadius: 8, border: "none", cursor: props.disabled ? "default" : "pointer", background: on ? "var(--surface-container-lowest)" : "transparent", color: on ? "var(--primary)" : "var(--on-surface-variant)", boxShadow: on ? "var(--shadow-sm)" : "none", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600 }}>
          ${Ic(o.icon, 16)} ${o.label}
        </button>`;
      })}
    </div>`;
  }

  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  // This tab's own avatar — smaller and tinted, so it does not reuse ui.js's —
  // but it makes the same choice: the Directory Photo when there is one,
  // initials when there is not (ADR-0029).
  function Avatar(props) {
    var size = props.size || 26;
    var base = { width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" };
    if (props.photoUrl) {
      return html`<span style=${Object.assign({}, base, { background: "var(--surface-container-high)" })}>
        <img src=${props.photoUrl} alt="" style=${Object.assign({ width: "100%", height: "100%" }, window.PersonPhotoCore.frameStyleObject(props.photoCrop))} />
      </span>`;
    }
    return html`<span style=${Object.assign({}, base, { background: props.tone === "ocean" ? "var(--secondary)" : "var(--primary)", color: props.tone === "ocean" ? "var(--on-secondary)" : "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 700 })}>${initials(props.name)}</span>`;
  }

  var BLANK_FORM = { name: "", kind: "pairwise", priority: false, holderLabel: "", counterpartLabel: "", leaderLabel: "", memberLabel: "", label: "" };

  // ── The tab ─────────────────────────────────────────────────────────────────
  function RelationshipsTab(props) {
    var showToast = props.showToast;

    var loadingS = useState(true);
    var typesS = useState([]), pairsS = useState([]), groupsS = useState([]), peopleS = useState([]);
    var openTypeS = useState(null);      // expanded type id
    var formS = useState(null);          // { editingId|null, form }
    var confirmDelS = useState(null);    // type id
    var pairModalS = useState(null);     // { typeId, holderId, holderName, counterpartId, counterpartName }
    var pickerS = useState(null);        // { slot: 'holder'|'counterpart'|'member', groupId?, query }
    var newGroupS = useState({});        // typeId -> name being typed

    var types = typesS[0], pairs = pairsS[0], groups = groupsS[0], people = peopleS[0];
    var RC = window.RelationshipCore, GC = window.RelationshipGroupCore;

    useEffect(function () {
      var alive = true;
      Promise.all([
        data.getRelationshipTypes(), data.getRelationships(),
        data.getRelationshipGroups(), data.getShepherdingPeople(),
      ]).then(function (r) {
        if (!alive) return;
        // Legacy `directional` docs are normalized on read, so the tab works before
        // the MS-102 backfill has run (ADR-0014 s6).
        typesS[1](r[0].map(function (t) { return RC.normalizeType(t); })
          .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }));
        pairsS[1](r[1]); groupsS[1](r[2]); peopleS[1](r[3]);
        loadingS[1](false);
      }).catch(function () { if (alive) { loadingS[1](false); showToast("Could not load relationships", "error"); } });
      return function () { alive = false; };
    }, []);

    function personName(id) {
      for (var i = 0; i < people.length; i++) if (people[i].id === id) return people[i].name;
      return "(unknown)";
    }
    function typeById(id) { for (var i = 0; i < types.length; i++) if (types[i].id === id) return types[i]; return null; }
    function pairsFor(id) { return pairs.filter(function (p) { return p.typeId === id; }); }
    function groupsFor(id) { return groups.filter(function (g) { return g.typeId === id; }); }
    function labelFor(t, side) { return RC.labelForSide(t, side) || "Person"; }

    function candidates(query, exclude) {
      var q = String(query || "").toLowerCase().trim();
      return people.filter(function (p) {
        return exclude.indexOf(p.id) === -1 && (!q || String(p.name).toLowerCase().indexOf(q) !== -1);
      }).slice(0, 30);
    }

    // ── Relationship Types ──
    function saveType() {
      var st = formS[0]; if (!st) return;
      var existing = st.editingId ? typeById(st.editingId) : null;
      var check = existing ? RC.validateEdit(existing, st.form) : RC.validateType(st.form);
      if (!check.valid) { showToast(check.errors[0], "error"); return; }

      data.saveRelationshipType(existing, st.form).then(function (saved) {
        var next = existing
          ? types.map(function (t) { return t.id === saved.id ? saved : t; })
          : types.concat([saved]);
        typesS[1](next.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }));
        formS[1](null);
        showToast(existing ? "Type updated" : "Type created");
      }).catch(function () { showToast("Error saving type", "error"); });
    }

    function reallyDeleteType() {
      var id = confirmDelS[0], t = typeById(id);
      if (!t) { confirmDelS[1](null); return; }
      data.deleteRelationshipType(id, pairsFor(id), groupsFor(id)).then(function () {
        typesS[1](types.filter(function (x) { return x.id !== id; }));
        pairsS[1](pairs.filter(function (p) { return p.typeId !== id; }));
        groupsS[1](groups.filter(function (g) { return g.typeId !== id; }));
        if (openTypeS[0] === id) openTypeS[1](null);
        confirmDelS[1](null);
        showToast("Type deleted");
      }).catch(function () { showToast("Error deleting type", "error"); });
    }

    // ── Pairwise ──
    function addPair() {
      var pm = pairModalS[0]; if (!pm) return;
      var t = typeById(pm.typeId);
      if (!t || !pm.holderId || !pm.counterpartId) { showToast("Pick two people", "error"); return; }
      if (pm.holderId === pm.counterpartId) { showToast("A relationship needs two different people", "error"); return; }
      var dup = pairsFor(t.id).some(function (p) {
        return (p.fromId === pm.holderId && p.toId === pm.counterpartId) ||
          (!t.priority && p.fromId === pm.counterpartId && p.toId === pm.holderId);
      });
      if (dup) { showToast("That relationship already exists", "error"); return; }

      data.addRelationshipPair(pm.holderId, pm.counterpartId, t.id).then(function (edge) {
        pairsS[1](pairs.concat([edge]));
        pairModalS[1](null);
        showToast("Relationship added");
      }).catch(function () { showToast("Error adding relationship", "error"); });
    }
    function removePair(p) {
      data.deleteRelationshipPair(p.id).then(function () {
        pairsS[1](pairs.filter(function (x) { return x.id !== p.id; }));
        showToast("Relationship removed");
      }).catch(function () { showToast("Error removing relationship", "error"); });
    }

    // ── Groups — every roster change goes through RelationshipGroupCore ──
    function createGroup(typeId) {
      var name = String(newGroupS[0][typeId] || "").trim();
      if (!name) return;
      data.createRelationshipGroup(typeId, name).then(function (g) {
        groupsS[1](groups.concat([g]));
        var next = Object.assign({}, newGroupS[0]); next[typeId] = "";
        newGroupS[1](next);
        showToast('Group "' + name + '" created');
      }).catch(function () { showToast("Error creating group", "error"); });
    }
    function writeGroup(next) {
      return data.writeRelationshipGroup(next).then(function () {
        groupsS[1](groups.map(function (g) { return g.id === next.id ? next : g; }));
      }).catch(function () { showToast("Error updating group", "error"); });
    }
    function deleteGroup(g) {
      data.deleteRelationshipGroup(g.id).then(function () {
        groupsS[1](groups.filter(function (x) { return x.id !== g.id; }));
        showToast("Group deleted");
      }).catch(function () { showToast("Error deleting group", "error"); });
    }

    // ── The person picker (one modal, three callers) ──
    function choosePerson(p) {
      var pk = pickerS[0]; if (!pk) return;
      if (pk.slot === "member") {
        var g = null;
        for (var i = 0; i < groups.length; i++) if (groups[i].id === pk.groupId) g = groups[i];
        if (g) writeGroup(GC.addMember(g, p.id));
        pickerS[1](null);
        return;
      }
      var pm = Object.assign({}, pairModalS[0]);
      if (pk.slot === "holder") { pm.holderId = p.id; pm.holderName = p.name; }
      else { pm.counterpartId = p.id; pm.counterpartName = p.name; }
      pairModalS[1](pm);
      pickerS[1](null);
    }

    // ── Rendering ──
    function badge(text, icon, tone) {
      return html`<span style=${{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 6, background: tone === "b" ? "var(--tertiary-container, var(--surface-container))" : "var(--secondary-container, var(--surface-container))", color: "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 700 }}>${Ic(icon, 12)} ${text}</span>`;
    }

    function typeCard(t) {
      var open = openTypeS[0] === t.id;
      var isGroup = t.kind === "group";
      var count = isGroup ? groupsFor(t.id).length : pairsFor(t.id).length;
      var labels = t.priority
        ? labelFor(t, RC.sidesForType(t)[0]) + " / " + labelFor(t, RC.sidesForType(t)[1])
        : (t.label || "—");

      return html`<div key=${t.id} style=${{ border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", background: "var(--surface-container-lowest)", overflow: "hidden" }}>
        <div onClick=${function () { openTypeS[1](open ? null : t.id); }} style=${{ display: "flex", alignItems: "center", gap: 10, padding: "12px 12px", cursor: "pointer" }}>
          <div style=${{ flex: 1, minWidth: 0 }}>
            <div style=${{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 700, color: "var(--on-surface)" }}>${t.name}</div>
            <div style=${{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
              ${badge(isGroup ? "Group" : "Pairwise", isGroup ? "users" : "arrow-left-right", "a")}
              ${badge(t.priority ? "Prioritized" : "Symmetric", t.priority ? "move-right" : "arrow-left-right", "b")}
            </div>
            <div style=${{ marginTop: 6, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 12.5, color: "var(--on-surface-variant)" }}>
              ${labels} · ${count} ${isGroup ? (count === 1 ? "group" : "groups") : (count === 1 ? "pair" : "pairs")}
            </div>
          </div>
          <button onClick=${function (e) { e.stopPropagation(); formS[1]({ editingId: t.id, form: Object.assign({}, BLANK_FORM, t) }); }} style=${iconBtn} aria-label="Edit type">${Ic("pencil", 17)}</button>
          <button onClick=${function (e) { e.stopPropagation(); confirmDelS[1](t.id); }} style=${iconBtn} aria-label="Delete type">${Ic("trash-2", 17)}</button>
          <span style=${{ display: "flex", color: "var(--on-surface-variant)" }}>${Ic(open ? "chevron-up" : "chevron-down", 18)}</span>
        </div>

        ${open ? html`<div style=${{ padding: "0 12px 14px", borderTop: "1px solid var(--outline-variant)" }}>
          ${isGroup ? groupSection(t) : pairSection(t)}
        </div>` : null}
      </div>`;
    }

    function pairSection(t) {
      var list = pairsFor(t.id);
      return html`<div style=${{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        ${list.length === 0
          ? html`<div style=${{ padding: 14, border: "1px dashed var(--outline-variant)", borderRadius: "var(--radius)", color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 13 }}>Nobody holds this type yet.</div>`
          : list.map(function (p) {
            var sentence = RC.orientedSentence(t, personName(p.fromId), personName(p.toId))
              || (personName(p.fromId) + " — " + personName(p.toId));
            return html`<div key=${p.id} style=${{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", background: "var(--surface-container-low)", borderRadius: "var(--radius)" }}>
              <span style=${{ flex: 1, fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--on-surface)" }}>${sentence}</span>
              <button onClick=${function () { removePair(p); }} style=${iconBtn} aria-label="Remove">${Ic("x", 16)}</button>
            </div>`;
          })}
        <button onClick=${function () { pairModalS[1]({ typeId: t.id, holderId: "", holderName: "", counterpartId: "", counterpartName: "" }); }}
          style=${Object.assign({}, pill(), { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "flex-start" })}>
          ${Ic("plus", 16)} Add ${t.name}
        </button>
      </div>`;
    }

    function groupSection(t) {
      var list = groupsFor(t.id);
      return html`<div style=${{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        ${list.map(function (g) {
          return html`<div key=${g.id} style=${{ border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style=${{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--surface-container-low)" }}>
              <span style=${{ flex: 1, fontFamily: "var(--font-serif)", fontSize: 15, fontWeight: 600, color: "var(--on-surface)" }}>${g.name}</span>
              <button onClick=${function () { deleteGroup(g); }} style=${iconBtn} aria-label="Delete group">${Ic("trash-2", 16)}</button>
            </div>
            <div style=${{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              ${t.priority ? html`<div>
                <div style=${Object.assign({}, OVER, { marginBottom: 6 })}>${labelFor(t, "leader")}</div>
                ${g.leaderId
                  ? html`<div style=${{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 8px", border: "1px solid var(--warning)", borderRadius: "var(--radius)" }}>
                      <${Avatar} name=${personName(g.leaderId)} />
                      <span style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600 }}>${personName(g.leaderId)}</span>
                      <button onClick=${function () { writeGroup(GC.clearLeader(g)); }} style=${iconBtn} aria-label="Stand down">${Ic("x", 15)}</button>
                    </div>`
                  : html`<div style=${{ padding: "8px 10px", border: "1px dashed var(--outline-variant)", borderRadius: "var(--radius)", fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)" }}>No leader yet — tap a member's star, or leave it open.</div>`}
              </div>` : null}

              <div>
                <div style=${Object.assign({}, OVER, { marginBottom: 6 })}>${labelFor(t, "member")}s</div>
                <div style=${{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  ${g.memberIds.map(function (mid) {
                    return html`<span key=${mid} style=${{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px", background: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)" }}>
                      <${Avatar} name=${personName(mid)} tone="ocean" size=${24} />
                      <span style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600 }}>${personName(mid)}</span>
                      ${t.priority && !g.leaderId ? html`<button onClick=${function () { writeGroup(GC.setLeader(g, mid)); }} style=${Object.assign({}, iconBtn, { width: 26, height: 26 })} aria-label="Make leader">${Ic("star", 14)}</button>` : null}
                      <button onClick=${function () { writeGroup(GC.removeMember(g, mid)); }} style=${Object.assign({}, iconBtn, { width: 26, height: 26 })} aria-label="Remove">${Ic("x", 14)}</button>
                    </span>`;
                  })}
                  ${g.memberIds.length === 0 ? html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)" }}>Empty roster — that's fine.</span>` : null}
                </div>
                <button onClick=${function () { pickerS[1]({ slot: "member", groupId: g.id, query: "" }); }}
                  style=${{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 10px", border: "1px dashed var(--outline-variant)", background: "transparent", borderRadius: "var(--radius)", color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                  ${Ic("user-plus", 15)} Add ${String(labelFor(t, "member")).toLowerCase()}
                </button>
              </div>
            </div>
          </div>`;
        })}
        ${list.length === 0 ? html`<div style=${{ padding: 14, border: "1px dashed var(--outline-variant)", borderRadius: "var(--radius)", color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 13 }}>No groups yet. Name one below.</div>` : null}

        <div style=${{ display: "flex", gap: 8 }}>
          <input value=${newGroupS[0][t.id] || ""}
            onInput=${function (e) { var n = Object.assign({}, newGroupS[0]); n[t.id] = e.target.value; newGroupS[1](n); }}
            onKeyDown=${function (e) { if (e.key === "Enter") createGroup(t.id); }}
            placeholder="New group name…" style=${Object.assign({}, inputStyle, { flex: 1 })} />
          <button onClick=${function () { createGroup(t.id); }} disabled=${!String(newGroupS[0][t.id] || "").trim()}
            style=${Object.assign({}, pill(), { opacity: String(newGroupS[0][t.id] || "").trim() ? 1 : 0.5, whiteSpace: "nowrap" })}>Create</button>
        </div>
      </div>`;
    }

    // ── Modals ──
    function typeFormModal() {
      var st = formS[0]; if (!st) return null;
      var f = st.form;
      function set(k, v) { var n = Object.assign({}, f); n[k] = v; formS[1]({ editingId: st.editingId, form: n }); }

      return html`<${Modal} title=${st.editingId ? "Edit Relationship Type" : "New Relationship Type"} onClose=${function () { formS[1](null); }}
        footer=${html`<${Fragment}>
          <button onClick=${function () { formS[1](null); }} style=${pill("ghost")}>Cancel</button>
          <button onClick=${saveType} style=${pill()}>${st.editingId ? "Save" : "Create"}</button>
        </${Fragment}>`}>
        <div style=${{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style=${Object.assign({}, OVER, { marginBottom: 6 })}>Type Name</div>
            <input value=${f.name} onInput=${function (e) { set("name", e.target.value); }} placeholder="e.g. Discipleship" style=${inputStyle} />
          </div>

          <div>
            <div style=${Object.assign({}, OVER, { marginBottom: 6 })}>Kind${st.editingId ? " · locked after creation" : ""}</div>
            <${Segmented} value=${f.kind} disabled=${!!st.editingId} onChange=${function (v) { set("kind", v); }}
              options=${[{ value: "pairwise", label: "Pairwise", icon: "arrow-left-right" }, { value: "group", label: "Group", icon: "users" }]} />
            <p style=${{ margin: "6px 0 0", fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--on-surface-variant)" }}>
              ${f.kind === "group" ? "A roster of many people around one shared thing." : "A connection between exactly two people."}
            </p>
          </div>

          <div>
            <div style=${Object.assign({}, OVER, { marginBottom: 6 })}>Priority</div>
            <${Segmented} value=${f.priority} onChange=${function (v) { set("priority", v); }}
              options=${[{ value: true, label: "Prioritized", icon: "move-right" }, { value: false, label: "Symmetric", icon: "arrow-left-right" }]} />
            <p style=${{ margin: "6px 0 0", fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--on-surface-variant)" }}>
              ${f.priority
                ? (f.kind === "group" ? "One person leads; the rest are members." : "One side holds priority, and each side gets its own name.")
                : (f.kind === "group" ? "A flat roster. Nobody leads it." : "Both sides are equal and share one name.")}
            </p>
          </div>

          ${!f.priority ? html`<div>
            <div style=${Object.assign({}, OVER, { marginBottom: 6 })}>Label</div>
            <input value=${f.label} onInput=${function (e) { set("label", e.target.value); }} placeholder="e.g. Friend" style=${inputStyle} />
          </div>` : f.kind === "pairwise" ? html`<${Fragment}>
            <div>
              <div style=${Object.assign({}, OVER, { marginBottom: 6 })}>Holder Label</div>
              <input value=${f.holderLabel} onInput=${function (e) { set("holderLabel", e.target.value); }} placeholder="e.g. Discipler" style=${inputStyle} />
            </div>
            <div>
              <div style=${Object.assign({}, OVER, { marginBottom: 6 })}>Counterpart Label</div>
              <input value=${f.counterpartLabel} onInput=${function (e) { set("counterpartLabel", e.target.value); }} placeholder="e.g. Disciplee" style=${inputStyle} />
            </div>
          </${Fragment}>` : html`<${Fragment}>
            <div>
              <div style=${Object.assign({}, OVER, { marginBottom: 6 })}>Leader Label</div>
              <input value=${f.leaderLabel} onInput=${function (e) { set("leaderLabel", e.target.value); }} placeholder="e.g. Leader" style=${inputStyle} />
            </div>
            <div>
              <div style=${Object.assign({}, OVER, { marginBottom: 6 })}>Member Label</div>
              <input value=${f.memberLabel} onInput=${function (e) { set("memberLabel", e.target.value); }} placeholder="e.g. Member" style=${inputStyle} />
            </div>
          </${Fragment}>`}
        </div>
      </${Modal}>`;
    }

    function pairModal() {
      var pm = pairModalS[0]; if (!pm) return null;
      var t = typeById(pm.typeId); if (!t) return null;
      var holderCap = t.priority ? labelFor(t, "holder") : "Person";
      var counterCap = t.priority ? labelFor(t, "counterpart") : "Person";

      function slotBtn(cap, name, slot) {
        return html`<div>
          <div style=${Object.assign({}, OVER, { marginBottom: 6 })}>${cap}</div>
          <button onClick=${function () { pickerS[1]({ slot: slot, query: "" }); }}
            style=${{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", cursor: "pointer", textAlign: "left" }}>
            ${name ? html`<${Avatar} name=${name} />` : null}
            <span style=${{ flex: 1, fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: name ? 600 : 400, color: name ? "var(--on-surface)" : "var(--on-surface-variant)" }}>${name || "Choose someone…"}</span>
            ${Ic("chevron-down", 17)}
          </button>
        </div>`;
      }

      return html`<${Modal} title=${"Add " + t.name} onClose=${function () { pairModalS[1](null); }}
        footer=${html`<${Fragment}>
          <button onClick=${function () { pairModalS[1](null); }} style=${pill("ghost")}>Cancel</button>
          <button onClick=${addPair} style=${Object.assign({}, pill(), { opacity: (pm.holderId && pm.counterpartId) ? 1 : 0.5 })}>Add</button>
        </${Fragment}>`}>
        <div style=${{ display: "flex", flexDirection: "column", gap: 14 }}>
          ${slotBtn(holderCap, pm.holderName, "holder")}
          <div style=${{ display: "flex", justifyContent: "center", color: "var(--secondary)" }}>${Ic(t.priority ? "move-right" : "arrow-left-right", 22)}</div>
          ${slotBtn(counterCap, pm.counterpartName, "counterpart")}
        </div>
      </${Modal}>`;
    }

    function pickerModal() {
      var pk = pickerS[0]; if (!pk) return null;
      var exclude = [];
      if (pk.slot === "member") {
        var g = null;
        for (var i = 0; i < groups.length; i++) if (groups[i].id === pk.groupId) g = groups[i];
        if (g) exclude = [g.leaderId].concat(g.memberIds).filter(Boolean);
      } else {
        var pm = pairModalS[0] || {};
        exclude = [pk.slot === "holder" ? pm.counterpartId : pm.holderId].filter(Boolean);
      }
      var opts = candidates(pk.query, exclude);

      return html`<${Modal} title="Choose a person" onClose=${function () { pickerS[1](null); }}>
        <input autofocus value=${pk.query} onInput=${function (e) { pickerS[1](Object.assign({}, pk, { query: e.target.value })); }}
          placeholder="Search people…" style=${Object.assign({}, inputStyle, { marginBottom: 12 })} />
        <div style=${{ display: "flex", flexDirection: "column", gap: 2 }}>
          ${opts.map(function (p) {
            return html`<button key=${p.id} onClick=${function () { choosePerson(p); }}
              style=${{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px", border: "none", background: "transparent", borderRadius: "var(--radius)", cursor: "pointer", textAlign: "left" }}>
              <${Avatar} name=${p.name} photoUrl=${p.photoUrl} photoCrop=${p.photoCrop} tone="ocean" />
              <span style=${{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" }}>${p.name}</span>
            </button>`;
          })}
          ${opts.length === 0 ? html`<div style=${{ padding: "18px 8px", textAlign: "center", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface-variant)" }}>Nobody left to choose.</div>` : null}
        </div>
      </${Modal}>`;
    }

    function deleteModal() {
      var id = confirmDelS[0]; if (!id) return null;
      var t = typeById(id); if (!t) return null;
      var np = pairsFor(id).length, ng = groupsFor(id).length;
      var bits = [];
      if (np) bits.push(np + " relationship" + (np === 1 ? "" : "s"));
      if (ng) bits.push(ng + " group" + (ng === 1 ? "" : "s"));

      return html`<${Modal} title=${'Delete "' + t.name + '"?'} onClose=${function () { confirmDelS[1](null); }}
        footer=${html`<${Fragment}>
          <button onClick=${function () { confirmDelS[1](null); }} style=${pill("ghost")}>Cancel</button>
          <button onClick=${reallyDeleteType} style=${Object.assign({}, pill(), { background: "var(--error)" })}>Delete</button>
        </${Fragment}>`}>
        <p style=${{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" }}>
          ${bits.length ? "This also removes " + bits.join(" and ") + "." : "Nothing holds this type yet."}
        </p>
      </${Modal}>`;
    }

    if (loadingS[0]) {
      return html`<div style=${{ display: "flex", justifyContent: "center", padding: "40px 20px", color: "var(--on-surface-variant)" }}>
        <span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 24)}</span>
      </div>`;
    }

    return html`<${Fragment}>
      <p style=${{ margin: "0 0 16px", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface-variant)" }}>
        Define the relationship types elders can apply, and manage who holds them. Types and named groups can only be created here.
      </p>

      <button onClick=${function () { formS[1]({ editingId: null, form: Object.assign({}, BLANK_FORM) }); }}
        style=${Object.assign({}, pill(), { display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16 })}>
        ${Ic("plus", 16)} New Relationship Type
      </button>

      <div style=${Object.assign({}, OVER, { marginBottom: 10 })}>All Types · ${types.length}</div>

      ${types.length === 0
        ? html`<div style=${{ padding: "44px 20px", textAlign: "center", color: "var(--on-surface-variant)" }}>
            <div style=${{ display: "inline-flex", opacity: 0.5 }}>${Ic("users", 38)}</div>
            <p style=${{ fontFamily: "var(--font-sans)", fontSize: 13.5, fontStyle: "italic", marginTop: 10 }}>No relationship types yet. Create one above.</p>
          </div>`
        : html`<div style=${{ display: "flex", flexDirection: "column", gap: 10 }}>${types.map(typeCard)}</div>`}

      ${typeFormModal()}
      ${pairModal()}
      ${pickerModal()}
      ${deleteModal()}
    </${Fragment}>`;
  }

  M.RelationshipsTab = RelationshipsTab;
})();
