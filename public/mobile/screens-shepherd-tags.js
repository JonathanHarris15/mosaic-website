/* ============================================================
   screens-shepherd-tags.js — native Manage Tags screen for the mobile
   shell. Ported from the Mosaic Mobile design (screens_shepherd_tags)
   to Preact/htm and wired to real Firestore data via M.data — replacing
   the old desktop shell (shepherding-tags.html) for the mobile app only.

   Elder-only tool: create, rename, merge & delete the shepherding tags
   used to group members across the shepherding tools, plus the two
   visibility flags (hiddenFromOthers = hide the tag from non-admins;
   hidePeople = hide its carriers from non-admins). Member counts are
   drawn live from the real roster. Toggling hidePeople recomputes each
   carrier's shepherdingHidden — as do Merge/Delete (see M.data).
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, data = M.data, Fragment = M.Fragment;
  var useState = M.hooks.useState, useEffect = M.hooks.useEffect;
  var ui = M.ui, Screen = ui.Screen, TopBar = ui.TopBar, Body = ui.Body;

  var OVER = { fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--on-surface-variant)" };
  var iconBtn = { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-surface-variant)", cursor: "pointer", borderRadius: 8 };
  var inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", background: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", outline: "none", fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" };
  function pill(variant) {
    return { padding: "9px 16px", borderRadius: "var(--radius-full)", border: "none", background: variant === "ghost" ? "transparent" : "var(--primary)", color: variant === "ghost" ? "var(--on-surface-variant)" : "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
  }

  // Centered modal (mirrors screens-shepherd.js Modal).
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

  function Toast(props) {
    if (!props.toast) return null;
    return html`<div style=${{ position: "absolute", bottom: "calc(28px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", zIndex: 70, padding: "11px 18px", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)", background: props.toast.type === "error" ? "var(--error)" : "var(--primary)", color: "#fff", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", maxWidth: "90%" }}>${props.toast.message}</div>`;
  }

  function ManageTagsScreen(props) {
    var loadingS = useState(true), errS = useState(false);
    var peopleS = useState([]), tagsS = useState([]);
    var newTagS = useState("");
    var editingS = useState(null);       // { id, value }
    var actionsOpenS = useState(null);   // tag id whose action menu is expanded
    var mergeSourceS = useState(null);   // tag id
    var confirmDeleteS = useState(null); // tag id
    var busyS = useState(false);         // guards merge/delete network ops
    var toastS = useState(null);

    var people = peopleS[0], tags = tagsS[0], toast = toastS[0];
    function showToast(message, type) { toastS[1]({ message: message, type: type || "success" }); setTimeout(function () { toastS[1](null); }, 2600); }
    function tagById(id) { for (var i = 0; i < tags.length; i++) { if (tags[i].id === id) return tags[i]; } return null; }

    useEffect(function () {
      var alive = true;
      Promise.all([data.getShepherdingPeople(), data.getShepherdingTags()])
        .then(function (r) { if (!alive) return; peopleS[1](r[0]); tagsS[1](r[1]); loadingS[1](false); })
        .catch(function () { if (alive) { errS[1](true); loadingS[1](false); } });
      return function () { alive = false; };
    }, []);

    function countFor(tagId) { return people.reduce(function (n, p) { return n + ((p.tags || []).indexOf(tagId) !== -1 ? 1 : 0); }, 0); }
    var tagIds = tags.map(function (t) { return t.id; });
    var totalTagged = people.filter(function (p) { return (p.tags || []).some(function (t) { return tagIds.indexOf(t) !== -1; }); }).length;

    function sortByName(list) { return list.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }); }

    // ── Create ──
    function createTag() {
      var name = newTagS[0].trim();
      if (!name) return;
      if (tags.some(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })) { showToast("That tag already exists", "error"); return; }
      data.createShepherdingTag(name).then(function (t) {
        tagsS[1](sortByName(tags.concat([t]))); newTagS[1](""); showToast("Created “" + name + "”");
      }).catch(function () { showToast("Error creating tag", "error"); });
    }

    // A Membership Tag (ADR-0012) is code-defined and immutable: no rename,
    // delete, merge, or hide. Guard every mutator so the subset holds.
    function isLocked(id) { return !!(window.ShepherdingCore && window.ShepherdingCore.isMembershipTagId(id)); }
    function rejectLocked(id) {
      if (isLocked(id)) { showToast("Membership Tags are managed by the system", "error"); return true; }
      return false;
    }

    // ── Rename (identity is a stable auto-id, so carriers are untouched) ──
    function commitRename() {
      var ed = editingS[0];
      if (!ed) return;
      if (rejectLocked(ed.id)) { editingS[1](null); return; }
      var next = ed.value.trim(), tag = tagById(ed.id);
      if (!tag) { editingS[1](null); return; }
      if (!next || next === tag.name) { editingS[1](null); return; }
      if (tags.some(function (x) { return x.id !== ed.id && x.name.toLowerCase() === next.toLowerCase(); })) { showToast("That tag already exists", "error"); return; }
      data.renameShepherdingTag(ed.id, next).then(function () {
        tagsS[1](sortByName(tags.map(function (x) { return x.id === ed.id ? Object.assign({}, x, { name: next }) : x; })));
        editingS[1](null); showToast("Tag renamed");
      }).catch(function () { showToast("Error renaming tag", "error"); });
    }

    // ── Merge (directional: mergeSource folds into the chosen survivor) ──
    function doMerge(targetId) {
      if (busyS[0]) return;
      var sourceId = mergeSourceS[0], target = tagById(targetId), source = tagById(sourceId);
      if (!source || !target || sourceId === targetId) { mergeSourceS[1](null); return; }
      if (rejectLocked(sourceId) || rejectLocked(targetId)) { mergeSourceS[1](null); return; }
      busyS[1](true);
      data.mergeShepherdingTag(sourceId, targetId, target.name, tags).then(function () {
        tagsS[1](tags.filter(function (x) { return x.id !== sourceId; }));
        peopleS[1](people.map(function (p) {
          if ((p.tags || []).indexOf(sourceId) === -1) return p;
          var rest = (p.tags || []).filter(function (x) { return x !== sourceId; });
          return Object.assign({}, p, { tags: rest.indexOf(targetId) !== -1 ? rest : rest.concat([targetId]) });
        }));
        busyS[1](false); mergeSourceS[1](null); showToast("Merged into “" + target.name + "”");
      }).catch(function () { busyS[1](false); showToast("Error merging tags", "error"); });
    }

    // ── Delete (removes the tag from every carrier) ──
    function doDelete() {
      if (busyS[0]) return;
      var id = confirmDeleteS[0], tag = tagById(id);
      if (!tag) { confirmDeleteS[1](null); return; }
      if (rejectLocked(id)) { confirmDeleteS[1](null); return; }
      busyS[1](true);
      data.deleteShepherdingTag(id, tag.hidePeople, tags).then(function () {
        tagsS[1](tags.filter(function (x) { return x.id !== id; }));
        peopleS[1](people.map(function (p) { return (p.tags || []).indexOf(id) !== -1 ? Object.assign({}, p, { tags: (p.tags || []).filter(function (x) { return x !== id; }) }) : p; }));
        busyS[1](false); confirmDeleteS[1](null); showToast("Tag deleted");
      }).catch(function () { busyS[1](false); showToast("Error deleting tag", "error"); });
    }

    // ── Visibility flags (hiddenFromOthers / hidePeople) ──
    function toggleFlag(t, field) {
      if (rejectLocked(t.id)) return;
      var newVal = !t[field];
      data.toggleShepherdingTagFlag(t.id, field, newVal, tags).then(function () {
        tagsS[1](tags.map(function (x) { if (x.id !== t.id) return x; var patch = {}; patch[field] = newVal; return Object.assign({}, x, patch); }));
        showToast("Tag updated");
      }).catch(function () { showToast("Error updating tag", "error"); });
    }

    var userKnown = props.user !== undefined; // undefined = still resolving auth
    var isElder = userKnown && !!props.user && (props.user.role === "elder" || props.user.role === "super_admin");
    var newTag = newTagS[0];
    var mergeSource = mergeSourceS[0] ? tagById(mergeSourceS[0]) : null;
    var confirmDelete = confirmDeleteS[0] ? tagById(confirmDeleteS[0]) : null;

    return html`
      <${Screen}>
        <${TopBar} title="Manage Tags" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "16px 16px 40px" }}>
          ${!userKnown ? html`<div style=${{ display: "flex", justifyContent: "center", padding: "48px 20px", color: "var(--on-surface-variant)" }}><span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 26)}</span></div>`
          : !isElder ? html`<div style=${{ padding: "60px 24px", textAlign: "center", color: "var(--on-surface-variant)" }}><div style=${{ display: "inline-flex", opacity: 0.5 }}>${Ic("shield-alert", 40)}</div><p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, marginTop: 12 }}>Elder-only tools.</p></div>`
          : html`
          <div style=${{ marginBottom: 18 }}>
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 24, fontWeight: 600, color: "var(--primary)" }}>Manage Tags</div>
            <p style=${{ margin: "4px 0 0", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface-variant)" }}>Create, rename & merge the tags used to group members across the shepherding tools.</p>
          </div>

          <div style=${Object.assign({}, OVER, { marginBottom: 8 })}>Create a Tag</div>
          <div style=${{ display: "flex", gap: 8, marginBottom: 24 }}>
            <input value=${newTag} onInput=${function (e) { newTagS[1](e.target.value); }} onKeyDown=${function (e) { if (e.key === "Enter") createTag(); }} placeholder="New tag name…" style=${Object.assign({}, inputStyle, { flex: 1 })} />
            <button onClick=${createTag} disabled=${!newTag.trim()} style=${Object.assign({}, pill(), { display: "inline-flex", alignItems: "center", gap: 6, opacity: newTag.trim() ? 1 : 0.5, cursor: newTag.trim() ? "pointer" : "default", whiteSpace: "nowrap" })}>${Ic("plus", 16)} Create</button>
          </div>

          <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style=${OVER}>All Tags · ${tags.length}</span>
            <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--on-surface-variant)" }}>${totalTagged} member${totalTagged === 1 ? "" : "s"} tagged</span>
          </div>

          ${loadingS[0] ? html`<div style=${{ display: "flex", justifyContent: "center", padding: "40px 20px", color: "var(--on-surface-variant)" }}><span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 24)}</span></div>`
            : tags.length === 0 ? html`<div style=${{ padding: "48px 20px", textAlign: "center", color: "var(--on-surface-variant)" }}>
                <div style=${{ display: "inline-flex", opacity: 0.5 }}>${Ic("tags", 40)}</div>
                <p style=${{ fontFamily: "var(--font-sans)", fontSize: 13.5, fontStyle: "italic", marginTop: 10 }}>No tags yet. Create one above to start grouping members.</p>
              </div>`
            : html`<div style=${{ display: "flex", flexDirection: "column", gap: 10 }}>
              ${tags.map(function (t) {
                var count = countFor(t.id);
                var ed = editingS[0];
                var isEditing = ed && ed.id === t.id;
                var actionsOpen = actionsOpenS[0] === t.id;
                var locked = isLocked(t.id); // Membership Tag — code-defined, no actions (ADR-0012)
                return html`<div key=${t.id} style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", padding: 14 }}>
                  ${isEditing ? html`<div style=${{ display: "flex", gap: 8 }}>
                    <input autofocus value=${ed.value} onInput=${function (e) { editingS[1]({ id: t.id, value: e.target.value }); }} onKeyDown=${function (e) { if (e.key === "Enter") commitRename(); if (e.key === "Escape") editingS[1](null); }} style=${Object.assign({}, inputStyle, { flex: 1 })} />
                    <button onClick=${commitRename} aria-label="Save name" style=${Object.assign({}, iconBtn, { width: 40, height: 40, background: "var(--primary)", color: "var(--on-primary)" })}>${Ic("check", 18)}</button>
                    <button onClick=${function () { editingS[1](null); }} aria-label="Cancel rename" style=${Object.assign({}, iconBtn, { width: 40, height: 40, background: "var(--surface-container)" })}>${Ic("x", 18)}</button>
                  </div>`
                  : html`<div style=${{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style=${{ width: 40, height: 40, borderRadius: "var(--radius-full)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--primary-fixed)", color: "var(--primary)" }}>${Ic("tag", 19)}</span>
                    <div style=${{ flex: 1, minWidth: 0 }}>
                      <div style=${{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: "var(--on-surface)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${t.name}</div>
                      <div style=${{ display: "flex", alignItems: "center", gap: 5, marginTop: 2, fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--on-surface-variant)" }}>${Ic("users", 13)} ${count} member${count === 1 ? "" : "s"}</div>
                    </div>
                    <div style=${{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0, overflow: "hidden", maxWidth: actionsOpen ? 184 : 0, opacity: actionsOpen ? 1 : 0, pointerEvents: actionsOpen ? "auto" : "none", transition: "max-width 0.26s ease, opacity 0.2s ease" }}>
                      <button onClick=${function () { actionsOpenS[1](null); editingS[1]({ id: t.id, value: t.name }); }} aria-label=${"Rename " + t.name} tabindex=${actionsOpen ? 0 : -1} style=${Object.assign({}, iconBtn, { flexShrink: 0 })}>${Ic("pencil", 16)}</button>
                      <button onClick=${function () { mergeSourceS[1](t.id); }} disabled=${tags.length < 2} aria-label=${"Merge " + t.name} tabindex=${actionsOpen ? 0 : -1} style=${Object.assign({}, iconBtn, { flexShrink: 0, opacity: tags.length < 2 ? 0.35 : 1, cursor: tags.length < 2 ? "default" : "pointer" })}>${Ic("git-merge", 16)}</button>
                      <button onClick=${function () { toggleFlag(t, "hiddenFromOthers"); }} aria-label=${t.hiddenFromOthers ? "Tag hidden from non-admins — tap to show" : "Tag visible to all — tap to hide from non-admins"} tabindex=${actionsOpen ? 0 : -1} style=${Object.assign({}, iconBtn, { flexShrink: 0, color: t.hiddenFromOthers ? "var(--primary)" : "var(--on-surface-variant)" })}>${Ic(t.hiddenFromOthers ? "eye-off" : "eye", 16)}</button>
                      <button onClick=${function () { toggleFlag(t, "hidePeople"); }} aria-label=${t.hidePeople ? "Carriers hidden from non-admins — tap to show" : "Carriers visible — tap to hide from non-admins"} tabindex=${actionsOpen ? 0 : -1} style=${Object.assign({}, iconBtn, { flexShrink: 0, color: t.hidePeople ? "var(--primary)" : "var(--on-surface-variant)" })}>${Ic(t.hidePeople ? "user-x" : "user", 16)}</button>
                      <button onClick=${function () { confirmDeleteS[1](t.id); }} aria-label=${"Delete " + t.name} tabindex=${actionsOpen ? 0 : -1} style=${Object.assign({}, iconBtn, { flexShrink: 0, color: "var(--error)" })}>${Ic("trash-2", 16)}</button>
                    </div>
                    ${locked
                      ? html`<span aria-label="Managed by the Membership Track" title="Managed by the Membership Track" style=${{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, color: "var(--on-surface-variant)", fontFamily: "var(--font-sans)", fontSize: 11 }}>${Ic("lock", 15)} System</span>`
                      : html`<button onClick=${function () { actionsOpenS[1](actionsOpen ? null : t.id); }} aria-label=${actionsOpen ? "Hide actions for " + t.name : "Show actions for " + t.name} aria-expanded=${actionsOpen} style=${Object.assign({}, iconBtn, { flexShrink: 0, transform: actionsOpen ? "rotate(180deg)" : "none", transition: "transform 0.26s ease" })}>${Ic("chevron-left", 18)}</button>`}
                  </div>`}
                </div>`;
              })}
            </div>`}
          `}
        </${Body}>

        ${mergeSource ? html`<${Modal} onClose=${function () { if (!busyS[0]) mergeSourceS[1](null); }} title="Merge Tag"
          footer=${html`<button onClick=${function () { if (!busyS[0]) mergeSourceS[1](null); }} style=${pill("ghost")}>Cancel</button>`}>
          <p style=${{ margin: "0 0 4px", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--on-surface)" }}>Move every member from <strong style=${{ color: "var(--primary)" }}>${mergeSource.name}</strong> onto another tag, then remove it.</p>
          <p style=${{ margin: "0 0 16px", fontFamily: "var(--font-sans)", fontSize: 12, fontStyle: "italic", color: "var(--on-surface-variant)" }}>${countFor(mergeSource.id)} member${countFor(mergeSource.id) === 1 ? "" : "s"} will be moved. This cannot be undone.</p>
          <div style=${Object.assign({}, OVER, { fontSize: 10, marginBottom: 8 })}>Merge into</div>
          <div style=${{ display: "flex", flexDirection: "column", gap: 8 }}>
            ${tags.filter(function (x) { return x.id !== mergeSource.id && !isLocked(x.id); }).map(function (target) {
              return html`<button key=${target.id} onClick=${function () { doMerge(target.id); }} disabled=${busyS[0]} style=${{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "12px 14px", cursor: busyS[0] ? "default" : "pointer", opacity: busyS[0] ? 0.6 : 1, background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: "var(--on-surface)" }}>
                ${Ic("tag", 16)}
                <span style=${{ flex: 1 }}>${target.name}</span>
                <span style=${{ fontSize: 12, fontWeight: 500, color: "var(--on-surface-variant)" }}>${countFor(target.id)}</span>
                ${Ic("arrow-right", 16)}
              </button>`;
            })}
          </div>
        </${Modal}>` : null}

        ${confirmDelete ? html`<${Modal} onClose=${function () { if (!busyS[0]) confirmDeleteS[1](null); }} title="Delete Tag"
          footer=${html`<${Fragment}><button onClick=${function () { if (!busyS[0]) confirmDeleteS[1](null); }} style=${pill("ghost")}>Cancel</button><button onClick=${doDelete} disabled=${busyS[0]} style=${Object.assign({}, pill(), { background: "var(--error)", opacity: busyS[0] ? 0.6 : 1 })}>Delete Tag</button></${Fragment}>`}>
          <p style=${{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" }}>Delete <strong style=${{ color: "var(--primary)" }}>${confirmDelete.name}</strong>? It will be removed from ${countFor(confirmDelete.id)} member${countFor(confirmDelete.id) === 1 ? "" : "s"}. This cannot be undone.</p>
        </${Modal}>` : null}

        <${Toast} toast=${toast} />
      </${Screen}>`;
  }

  M.SCREENS = Object.assign(M.SCREENS || {}, { shepherdTags: ManageTagsScreen });
})();
