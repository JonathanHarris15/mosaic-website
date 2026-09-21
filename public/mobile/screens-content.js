/* ============================================================
   screens-content.js — content screens for the mobile shell,
   ported from the Mosaic Mobile design and wired to real Firestore
   data via M.data loaders. Registered into M.SCREENS (merged by
   app.js, which owns the router).
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, useAsync = M.useAsync, data = M.data;
  var useState = M.hooks.useState, useEffect = M.hooks.useEffect;
  var ui = M.ui;
  var Screen = ui.Screen, TopBar = ui.TopBar, BarAction = ui.BarAction, Body = ui.Body,
      Overline = ui.Overline, SearchBar = ui.SearchBar, FAB = ui.FAB, Button = ui.Button,
      Badge = ui.Badge, Avatar = ui.Avatar, Input = ui.Input, statusTone = ui.statusTone;

  function Loading(props) {
    return html`<div style=${{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 20px", color: "var(--on-surface-variant)" }}>
      <span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 26)}</span>
      <span style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14 }}>${props.label || "Loading…"}</span>
    </div>`;
  }
  function Empty(props) {
    return html`<div style=${{ textAlign: "center", padding: 40, fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--on-surface-variant)" }}>${props.children}</div>`;
  }
  function ErrorNote(props) {
    return html`<div style=${{ margin: "12px 16px", padding: "12px 14px", borderRadius: "var(--radius)", background: "var(--error-container)", color: "var(--on-error-container)", fontFamily: "var(--font-sans)", fontSize: 13 }}>${Ic("triangle-alert", 16)} ${props.children}</div>`;
  }

  function Chip(props) {
    var on = props.active;
    return html`<button onClick=${props.onClick} style=${{ flexShrink: 0, padding: "7px 14px", borderRadius: "var(--radius-full)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", border: on ? "1px solid var(--primary)" : "1px solid var(--outline-variant)", background: on ? "var(--primary)" : "var(--surface-container-lowest)", color: on ? "var(--on-primary)" : "var(--on-surface-variant)" }}>${props.children}</button>`;
  }

  // ── Hymn Directory ───────────────────────────────────────
  function HymnDirectoryScreen(props) {
    var st = useAsync(data.getHymns, []);
    var qS = useState(""), tagsS = useState([]);
    var hymns = st.data || [];
    var allTags = [];
    hymns.forEach(function (h) { h.tags.forEach(function (t) { if (allTags.indexOf(t) < 0) allTags.push(t); }); });
    allTags.sort();
    var q = qS[0], tags = tagsS[0];
    function toggle(t) { tagsS[1](tags.indexOf(t) < 0 ? tags.concat([t]) : tags.filter(function (x) { return x !== t; })); }
    var results = hymns.filter(function (h) {
      var mq = !q || data.lc(h.name).indexOf(data.lc(q)) >= 0 || data.lc(h.author).indexOf(data.lc(q)) >= 0;
      var mt = tags.length === 0 || tags.every(function (t) { return h.tags.indexOf(t) >= 0; });
      return mq && mt;
    });
    return html`
      <${Screen}>
        <${TopBar} title="Hymn Directory" onMenu=${props.openMenu} />
        <${Body} style=${{ paddingTop: 14 }}>
          <div style=${{ padding: "0 16px 12px" }}>
            <${SearchBar} placeholder="Search hymns & authors" value=${q} onChange=${function (e) { qS[1](e.target.value); }} />
          </div>
          ${allTags.length ? html`<div style=${{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 16px 12px" }}>
            ${allTags.map(function (t) { return html`<${Chip} key=${t} active=${tags.indexOf(t) >= 0} onClick=${function () { toggle(t); }}>${t}<//>`; })}
          </div>` : null}
          ${st.loading ? html`<${Loading} label="Loading hymns…" />` : st.error ? html`<${ErrorNote}>Couldn't load hymns.<//>` : html`
            <div style=${{ padding: "0 16px 4px" }}><${Overline}>${results.length} Hymns<//></div>
            <div style=${{ padding: "8px 16px calc(40px + env(safe-area-inset-bottom,0px))", display: "flex", flexDirection: "column", gap: 12 }}>
              ${results.map(function (h) {
                return html`<button key=${h.id} onClick=${function () { props.nav("hymnDetails", { hymn: h }); }} style=${{ display: "block", width: "100%", textAlign: "left", padding: 16, cursor: "pointer", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)" }}>
                  <div style=${{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, color: "var(--on-surface)", lineHeight: 1.25 }}>${h.name}</div>
                  ${h.author ? html`<div style=${{ fontFamily: "var(--font-serif)", fontSize: 14, fontStyle: "italic", color: "var(--on-surface-variant)", marginTop: 3 }}>${h.author}</div>` : null}
                  ${(h.tags.length || h.keys.length || h.hasSheet) ? html`<div style=${{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12, alignItems: "center" }}>
                    ${h.tags.map(function (t) { return html`<${Badge} key=${t} tone="secondary">${t}<//>`; })}
                    <span style=${{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--on-surface-variant)" }}>
                      ${h.keys.length ? html`<span>${h.keys.join(", ")}</span>` : null}
                      ${h.hasSheet ? html`<span style=${{ display: "flex", alignItems: "center", gap: 3 }}>${Ic("music", 13)} ${h.pages.length}</span>` : null}
                    </span>
                  </div>` : null}
                </button>`;
              })}
              ${results.length === 0 ? html`<${Empty}>No hymns match your search.<//>` : null}
            </div>`}
        </${Body}>
        <${FAB} icon="plus" label="Add hymn" onClick=${function () { props.nav("hymnManager", { new: true }); }} />
      </${Screen}>`;
  }

  // ── Hymn Details ─────────────────────────────────────────
  function HymnDetailsScreen(props) {
    var h = (props.params && props.params.hymn) || { name: "Hymn", lyricsWriter: "", musicWriter: "", tags: [], keys: [], pages: [], lastPlayed: "" };
    var writers = [h.lyricsWriter ? "Words: " + h.lyricsWriter : "", h.musicWriter ? "Music: " + h.musicWriter : ""].filter(Boolean).join("  ·  ");
    var stats = [["Sheets", String(h.pages.length)], ["Tags", String(h.tags.length)], ["Last sung", h.lastPlayed ? String(h.lastPlayed).slice(0, 10) : "—"]];
    return html`
      <${Screen}>
        <${TopBar} title="Hymn" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "20px 16px calc(40px + env(safe-area-inset-bottom,0px))" }}>
          ${h.tags.length ? html`<${Overline}>${h.tags.join(" · ")}<//>` : null}
          <div style=${{ fontFamily: "var(--font-serif)", fontSize: 28, fontWeight: 600, color: "var(--primary)", lineHeight: 1.2, marginTop: 8 }}>${h.name}</div>
          ${writers ? html`<div style=${{ fontFamily: "var(--font-serif)", fontSize: 15, fontStyle: "italic", color: "var(--on-surface-variant)", marginTop: 4 }}>${writers}</div>` : null}
          <div style=${{ display: "flex", gap: 10, marginTop: 18 }}>
            ${stats.map(function (kv) { return html`<div key=${kv[0]} style=${{ flex: 1, background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", padding: "12px 10px", textAlign: "center" }}>
              <div style=${{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: "var(--on-surface)" }}>${kv[1]}</div>
              <div style=${{ fontFamily: "var(--font-sans)", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--on-surface-variant)", marginTop: 4 }}>${kv[0]}</div>
            </div>`; })}
          </div>
          <${Overline} style=${{ margin: "22px 0 10px" }}>Sheet Music<//>
          ${h.pages.length ? html`<div style=${{ display: "flex", flexDirection: "column", gap: 12 }}>
            ${h.pages.map(function (url, i) { return html`<img key=${i} src=${url} alt=${"Sheet page " + (i + 1)} loading="lazy" style=${{ width: "100%", display: "block", borderRadius: "var(--radius-xl)", border: "1px solid var(--outline-variant)", background: "var(--surface-container-lowest)" }} />`; })}
          </div>` : html`<div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", height: 140, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--on-surface-variant)" }}>
            <span>${Ic("music", 28)}</span>
            <span style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5 }}>No sheet music uploaded yet</span>
          </div>`}
          <div style=${{ display: "flex", gap: 10, marginTop: 20 }}>
            <div style=${{ flex: 1 }}><${Button} variant="primary" size="md" style=${{ width: "100%" }} icon=${Ic("settings-2", 17)} onClick=${function () { props.nav("hymnManager", { edit: h.id }); }}>Manage Hymn<//></div>
            <div style=${{ flex: 1 }}><${Button} variant="secondary" size="md" style=${{ width: "100%" }} icon=${Ic("file-down", 17)}>Download<//></div>
          </div>
        </${Body}>
      </${Screen}>`;
  }

  // ── Membership Directory (ADR-0012) ──────────────────────
  // Two tabs — Members (carries the Member tag) and Non-members (everyone else
  // the viewer may see). An editor sees Inactive people on Non-members, labeled
  // Inactive, even with Edit Mode off. A member does not see them. The stage
  // slider, the Inactive control, and tag editing are Edit Mode only, and they
  // call the phone plan then the same writes the computer directory uses.
  // Which shepherding-tag ids are hidden from this viewer, keyed for O(1) lookup.
  // hiddenFromOthers → the tag chip itself is hidden; hidePeople → the whole
  // person is suppressed. Both lift for someone who reads as an elder: an
  // elder, a super admin, or a Pastoral Assistant. The same lift as the
  // computer directory.
  function tagVisibility(tagMeta) {
    var hidden = {}, hidePeople = {};
    (tagMeta || []).forEach(function (t) {
      if (t.hiddenFromOthers) hidden[t.id] = true;
      if (t.hidePeople) hidePeople[t.id] = true;
    });
    return { hidden: hidden, hidePeople: hidePeople };
  }
  function isDirectoryAdmin(user) {
    return !!(window.AccessCore && AccessCore.liftsHidden(user));
  }

  // Who may open this screen — asked of the ONE list the tile and the drawer
  // are filtered by (destinations.js), never restated here, because a deep
  // link (`#/people`) reaches this screen without passing either of them and a
  // second copy of the gate is a gate that drifts.
  //
  // ⚠ `undefined` means we do not know yet; `null` means signed out (app.js).
  // Refusing on `undefined` would tell a member to sign in while their own
  // account is still loading.
  function mayOpenDirectory(user) {
    var entry = (data.DESTINATIONS || []).filter(function (d) { return d.key === "directory"; })[0];
    return entry ? data.canSee(entry, user) : !!user;
  }
  function noPeople() { return []; }

  function emptyAddDraft() {
    return { name: "", email: "", phone: "", address: "", birthday: "", sex: "" };
  }
  function vocabularyEntry(created) {
    return Object.assign({ hiddenFromOthers: false, hidePeople: false }, created);
  }
  function saveDirectoryTrack(person, user, action) {
    var Track = window.PhoneDirectoryTrack;
    var plan = Track.planTrackMove(person.membership, action);
    if (!plan.write) return Promise.resolve(null);
    return data.saveDirectoryMembership(Track.directoryTrackWrite(person, user, plan.next)).then(function () {
      return Track.personAfterTrackMove(person, plan.next);
    });
  }
  function saveDirectoryTag(person, vocabulary, action) {
    var Track = window.PhoneDirectoryTrack;
    var plan = Track.planTagChange(person.tags, vocabulary, action);
    if (!plan.write) {
      if (plan.reason === "projected") window.alert(Track.TAG_LOCKED);
      return Promise.resolve(null);
    }
    return data.saveDirectoryTags(person.id, plan).then(function () {
      return { person: Track.personAfterTagWrite(person, plan.tags), create: plan.create };
    });
  }
  function DirectoryTrack(props) {
    var Track = window.PhoneDirectoryTrack;
    var membership = props.person.membership || {};
    var moves = Track.sliderMoves(membership);
    var index = Track.sliderIndex(membership);
    var busy = !!props.busy;
    return html`<div style=${{ marginTop: 10 }}>
      <input type="range" min="0" max=${Track.STAGES.length - 1} step="1" value=${String(index)}
        disabled=${!moves || busy}
        aria-label="Membership Track"
        onChange=${function (e) {
          props.onTrack({ kind: "stage", stage: Track.STAGES[Number(e.target.value)] });
        }}
        style=${{ width: "100%", accentColor: "var(--primary)", opacity: moves ? 1 : 0.45 }} />
      <div style=${{ display: "flex", justifyContent: "space-between", gap: 2, marginTop: 4 }}>
        ${Track.STAGES.map(function (stage, i) {
          var on = moves && Track.STAGES.indexOf(membership.stage) === i;
          return html`<span key=${stage} style=${{ flex: 1, textAlign: "center", fontFamily: "var(--font-sans)", fontSize: 8.5, lineHeight: 1.15, color: on ? "var(--primary)" : "var(--on-surface-variant)", fontWeight: on ? 700 : 400 }}>${Track.STAGE_LABEL[stage]}</span>`;
        })}
      </div>
      <button type="button" disabled=${busy} onClick=${function () {
          // moves means they are not Inactive, so this press marks them Inactive.
          // Otherwise it clears Inactive and the stage comes back.
          props.onTrack({ kind: "inactive", inactive: moves });
        }}
        style=${{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, border: "1px solid " + (moves ? "var(--outline-variant)" : "var(--primary)"), background: moves ? "transparent" : "var(--primary)", color: moves ? "var(--on-surface-variant)" : "var(--on-primary)" }}>
        ${moves ? "Mark inactive" : "Inactive — tap to reactivate"}
      </button>
    </div>`;
  }
  function DirectoryTags(props) {
    var Track = window.PhoneDirectoryTrack;
    var draftS = useState("");
    var busy = !!props.busy;
    var tags = (props.person.tags || []).filter(function (tag) {
      return Track.tagVisible(tag, props.user, props.visibility, props.tagsReady);
    });
    function add(event) {
      event.preventDefault();
      if (busy) return;
      var name = draftS[0];
      draftS[1]("");
      props.onTag({ kind: "add", name: name });
    }
    return html`<div style=${{ marginTop: 10 }}>
      <div style=${{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        ${tags.map(function (tag) {
          var locked = Track.tagLocked(tag);
          var label = Track.tagLabel(tag, props.vocabulary);
          return html`<span key=${tag} style=${{ display: "inline-flex", alignItems: "center", gap: 6, padding: locked ? "5px 12px" : "5px 8px 5px 12px", borderRadius: "var(--radius-full)", background: locked ? "var(--primary-fixed)" : "var(--primary)", color: locked ? "var(--primary)" : "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500 }}>
            ${locked ? html`${Ic("lock", 11)}` : null}${label}
            ${locked ? null : html`<button type="button" aria-label=${"Remove " + label} disabled=${busy} onClick=${function () { props.onTag({ kind: "remove", name: tag }); }} style=${{ border: "none", background: "transparent", color: "var(--on-primary)", cursor: "pointer", display: "flex", padding: 0 }}>${Ic("x", 12)}</button>`}
          </span>`;
        })}
      </div>
      <form onSubmit=${add} style=${{ display: "flex", gap: 8, marginTop: 8 }}>
        <input aria-label="Add a tag" value=${draftS[0]} disabled=${busy} placeholder="Add a tag" onInput=${function (e) { draftS[1](e.target.value); }}
          style=${{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: "var(--radius)", border: "1px solid var(--outline-variant)", background: "var(--surface-container-lowest)", color: "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 14 }} />
        <button type="submit" disabled=${busy} style=${{ padding: "8px 12px", borderRadius: "var(--radius-full)", border: "none", background: "var(--primary)", color: "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Add tag</button>
      </form>
    </div>`;
  }

  function SexSelect(props) {
    return html`<label class="m-field">
      <span class="m-label" style=${{ display: "block", marginBottom: 6 }}>${props.label || "Sex"}</span>
      <span class="m-select-wrap">
        <select class="m-select" value=${props.value || ""} onChange=${props.onChange}>
          <option value="">Select Sex...</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </span>
    </label>`;
  }

  function PeopleScreen(props) {
    // The read is skipped rather than issued and refused — since MS-197 the
    // directory needs an account (ADR-0031), so for a guest this could only
    // fail, and a failure logged on a screen that already knows the answer is
    // noise. Re-runs when we learn who is looking.
    var Edit = window.PhoneDirectoryEdit;
    var Track = window.PhoneDirectoryTrack;
    var mayEdit = Edit.mayOfferEditMode(props.user);
    var modeS = useState(Edit.isOn());
    var chosenS = useState([]);
    useEffect(function () {
      return Edit.subscribe(function (on) {
        modeS[1](on);
        if (!on) chosenS[1]([]);
      });
    }, []);
    var editOn = Track.offerEdits(props.user, modeS[0]);
    var mayOpen = mayOpenDirectory(props.user);
    var reloadS = useState(0);
    var st = useAsync(mayOpen ? data.getPeople : noPeople, [mayOpen, reloadS[0]]);
    var tagsSt = useAsync(mayOpen ? data.getShepherdingTags : noPeople, [mayOpen]);
    var qS = useState(""), fS = useState("members");
    var addOpenS = useState(false), addDraftS = useState(emptyAddDraft()), addingS = useState(false);
    var extraTagsS = useState([]);
    var overrideS = useState({});
    var savingS = useState({});
    var tagsReady = !tagsSt.loading;
    var people = (st.data || []).map(function (p) { return overrideS[0][p.id] || p; });
    var vocabulary = (tagsSt.data || []).concat(extraTagsS[0]);
    var vis = tagVisibility(tagsSt.data);
    var tabs = [["members", "Members"], ["non_members", "Non-members"]];
    var q = qS[0], tab = fS[0];
    function setAdd(key, value) {
      var next = Object.assign({}, addDraftS[0]);
      next[key] = value;
      addDraftS[1](next);
    }
    function openAdd() {
      addDraftS[1](emptyAddDraft());
      addOpenS[1](true);
    }
    function closeAdd() {
      if (addingS[0]) return;
      addOpenS[1](false);
      addDraftS[1](emptyAddDraft());
    }
    function submitAdd() {
      if (addingS[0]) return;
      var draft = addDraftS[0];
      var built = Edit.addPersonDocument(draft, { now: null });
      if (!built.ok) { window.alert(built.error); return; }
      addingS[1](true);
      data.addDirectoryPerson(draft).then(function () {
        addingS[1](false);
        closeAdd();
        fS[1]("non_members");
        reloadS[1](reloadS[0] + 1);
      }).catch(function () {
        addingS[1](false);
        window.alert(Edit.ADD_FAILED);
      });
    }
    function toggleChosen(tagId) {
      var chosen = chosenS[0];
      var on = chosen.indexOf(tagId) !== -1;
      chosenS[1](on ? chosen.filter(function (id) { return id !== tagId; }) : chosen.concat([tagId]));
    }
    function setSaving(id, on) {
      savingS[1](function (prev) {
        var next = Object.assign({}, prev || {});
        if (on) next[id] = true;
        else delete next[id];
        return next;
      });
    }
    function rememberPerson(next) {
      if (!next) return;
      overrideS[1](function (prev) {
        var patch = Object.assign({}, prev || {});
        patch[next.id] = next;
        return patch;
      });
    }
    function rememberTag(created) {
      if (!created) return;
      extraTagsS[1](function (prev) {
        return (prev || []).concat([vocabularyEntry(created)]);
      });
    }
    function onTrack(p, action) {
      if (savingS[0][p.id]) return;
      setSaving(p.id, true);
      saveDirectoryTrack(p, props.user, action).then(function (next) {
        rememberPerson(next);
        setSaving(p.id, false);
      }).catch(function () {
        setSaving(p.id, false);
        window.alert(Track.TRACK_FAILED);
      });
    }
    function onTag(p, action) {
      if (savingS[0][p.id]) return;
      setSaving(p.id, true);
      saveDirectoryTag(p, vocabulary, action).then(function (result) {
        setSaving(p.id, false);
        if (!result) return;
        rememberPerson(result.person);
        rememberTag(result.create);
      }).catch(function () {
        setSaving(p.id, false);
        window.alert(Track.TAG_FAILED);
      });
    }
    var offered = editOn ? Track.tagsOffered(vocabulary, props.user) : [];
    var chosen = Track.chosenTagsWhen(editOn, chosenS[0]);
    var results = people.filter(function (p) {
      return Track.visibleInDirectory(p, {
        tab: tab,
        search: q,
        chosenTags: chosen,
        editMode: editOn,
        user: props.user,
        visibility: vis,
      });
    });
    return html`
      <${Screen}>
        <${TopBar} title="Membership Directory" onMenu=${props.openMenu} />
        <${Body} style=${{ paddingTop: 14 }}>
          <div style=${{ padding: "0 16px 12px" }}><${SearchBar} placeholder="Search people" value=${q} onChange=${function (e) { qS[1](e.target.value); }} /></div>
          ${mayEdit ? html`<div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px 12px" }}>
            <span style=${{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: "var(--on-surface)" }}>Edit Mode</span>
            <button type="button" aria-label="Edit Mode" aria-pressed=${editOn ? "true" : "false"} onClick=${function () { Edit.setOn(!Edit.isOn()); }} style=${{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}>
              <${CalSwitch} on=${editOn} />
            </button>
          </div>` : null}
          <div style=${{ display: "flex", gap: 8, overflowX: "auto", padding: "0 16px 12px" }}>
            ${tabs.map(function (t) { return html`<${Chip} key=${t[0]} active=${t[0] === tab} onClick=${function () { fS[1](t[0]); }}>${t[1]}<//>`; })}
          </div>
          ${offered.length ? html`<div style=${{ display: "flex", gap: 8, overflowX: "auto", padding: "0 16px 12px" }}>
            ${offered.map(function (tag) {
              return html`<${Chip} key=${tag.id} active=${chosen.indexOf(tag.id) !== -1} onClick=${function () { toggleChosen(tag.id); }}>${tag.name}<//>`;
            })}
          </div>` : null}
          ${props.user === undefined ? html`<${Loading} label="Loading people…" />`
            : props.user === null ? html`<${ErrorNote}>The directory is for people with an account. Sign in to see it.<//>`
            : !mayOpen ? html`<${ErrorNote}>The directory isn't available on your account yet. Ask an admin to connect you.<//>`
            : st.loading ? html`<${Loading} label="Loading people…" />` : st.error ? html`<${ErrorNote}>Couldn't load the directory.<//>` : html`
            <div style=${{ padding: "0 16px 4px" }}><${Overline}>${results.length} People<//></div>
            <div style=${{ padding: "8px 16px 90px" }}>
              <div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", overflow: "hidden" }}>
                ${results.map(function (p, i) {
                  var s = statusTone(p.shepherding);
                  var label = Track.directoryLabel(p, props.user);
                  return html`<div key=${p.id} style=${{ padding: "12px 14px", borderBottom: i === results.length - 1 ? "none" : "1px solid var(--outline-variant)" }}>
                    <button type="button" onClick=${function () { props.nav("personDetail", { person: p }); }} style=${{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer", border: "none", background: "transparent", padding: 0 }}>
                      <div style=${{ position: "relative", flexShrink: 0 }}>
                        <${Avatar} name=${p.name} photoUrl=${p.photoUrl} photoCrop=${p.photoCrop} size=${44} />
                        ${s ? html`<span style=${{ position: "absolute", right: -1, bottom: -1, width: 13, height: 13, borderRadius: "50%", background: s.color, border: "2px solid var(--surface-container-lowest)" }}></span>` : null}
                      </div>
                      <div style=${{ flex: 1, minWidth: 0 }}>
                        <div style=${{ fontFamily: "var(--font-sans)", fontSize: 15.5, fontWeight: 600, color: "var(--on-surface)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${p.name}</div>
                        ${p.role ? html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${p.role}</div>` : null}
                        <div style=${{ marginTop: 4 }}><${Badge} tone=${label === "Inactive" ? "secondary" : "primary"}>${label}<//></div>
                      </div>
                      <span style=${{ color: "var(--outline)" }}>${Ic("chevron-right", 18)}</span>
                    </button>
                    ${editOn ? html`<${DirectoryTrack} person=${p} busy=${!!savingS[0][p.id]} onTrack=${function (action) { onTrack(p, action); }} />` : null}
                    ${editOn ? html`<${DirectoryTags} key=${p.id} person=${p} user=${props.user} vocabulary=${vocabulary} visibility=${vis} tagsReady=${tagsReady} busy=${!!savingS[0][p.id]} onTag=${function (action) { onTag(p, action); }} />` : null}
                  </div>`;
                })}
                ${results.length === 0 ? html`<${Empty}>No people match.<//>` : null}
              </div>
            </div>`}
        </${Body}>
        ${mayEdit && editOn ? html`<${FAB} icon="user-plus" label="Add person" onClick=${openAdd} />` : null}
        ${addOpenS[0] ? html`<${CalSheet} title="Add person" subtitle="They show on Non-members" onClose=${closeAdd}>
          <form onSubmit=${function (e) { e.preventDefault(); submitAdd(); }} style=${{ padding: "16px 18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            ${Edit.ADD_PERSON_FIELDS.map(function (field) {
              if (field.type === "sex") {
                return html`<${SexSelect} key=${field.key} label=${field.label} value=${addDraftS[0][field.key] || ""} onChange=${function (e) { setAdd(field.key, e.target.value); }} />`;
              }
              return html`<${Input} key=${field.key} label=${field.label} type=${field.type} value=${addDraftS[0][field.key] || ""} onInput=${function (e) { setAdd(field.key, e.target.value); }} />`;
            })}
            <div style=${{ display: "flex", gap: 10, marginTop: 4 }}>
              <${Button} type="button" variant="secondary" style=${{ flex: 1 }} onClick=${closeAdd}>Cancel<//>
              <${Button} type="submit" variant="primary" disabled=${addingS[0]} style=${{ flex: 1 }}>${addingS[0] ? "Adding…" : "Add person"}<//>
            </div>
          </form>
        </${CalSheet}>` : null}
      </${Screen}>`;
  }

  // A Family write. The phone plan decides what is written; this only calls
  // the Family create and update Shepherding already uses. A refusal writes
  // nothing. The caller keeps the previous Families when this rejects.
  function applyDirectoryFamily(families, planned) {
    var Fam = window.PhoneDirectoryFamily;
    if (!planned || !planned.write) {
      if (planned && planned.sentence) window.alert(planned.sentence);
      return Promise.resolve(null);
    }
    var doc = Fam.documentFor(planned);
    var write = doc
      ? data.addFamily(doc)
      : data.updateFamily(planned.plan.familyId, planned.plan.changes);
    return write.then(function (saved) {
      return Fam.familiesAfter(families, planned, saved && saved.id);
    });
  }

  // Spouse, children, and — for an editor in Edit Mode — the controls. The
  // read line is the computer directory card. The anniversary stays in the
  // editor. Searches sit in the page so a finger can reach them.
  function DirectoryFamily(props) {
    var Fam = window.PhoneDirectoryFamily;
    var person = props.person;
    var families = props.families || [];
    var people = props.people || [];
    var spouseQS = useState("");
    var childQS = useState("");
    var editor = Fam.familyEditor(props.user, props.editMode, person);
    var busy = !!props.busy;
    function personById(id) {
      if (person && person.id === id) return person;
      for (var i = 0; i < people.length; i++) {
        if (people[i].id === id) return people[i];
      }
      return null;
    }
    function nameOf(id) {
      var found = personById(id);
      return found && found.name ? found.name : "(unknown)";
    }
    var line = Fam.familyLineText(Fam.familyLine(families, person && person.id, nameOf));
    var spouseId = Fam.spouseIdOf(families, person && person.id);
    var children = Fam.childIdsOf(families, person && person.id);
    var spouseHits = Fam.spouseSearch(families, people, person, spouseQS[0]);
    var childHits = Fam.childSearch(families, people, person, childQS[0]);
    function removeDirectorySpouse() {
      var ask = Fam.removalConfirmation("spouse");
      if (ask && !window.confirm(ask)) return;
      props.onWrite(Fam.planRelation(families, person, "spouse", spouseId, personById, true));
    }
    function removeDirectoryChild(childId) {
      props.onWrite(Fam.planRelation(families, person, "child", childId, personById, true));
    }
    function chooseSpouse(otherId) {
      props.onWrite(Fam.planRelation(families, person, "spouse", otherId, personById)).then(function (next) {
        if (next) spouseQS[1]("");
      });
    }
    function chooseChild(otherId) {
      props.onWrite(Fam.planRelation(families, person, "child", otherId, personById)).then(function (next) {
        if (next) childQS[1]("");
      });
    }
    if (!line && !editor.sentence && !editor.show) return null;
    var field = { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "var(--radius)", border: "1px solid var(--outline-variant)", background: "var(--surface-container-lowest)", color: "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 14 };
    var hit = { display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: "none", borderBottom: "1px solid var(--outline-variant)", background: "var(--surface-container-lowest)", color: "var(--on-surface)", fontFamily: "var(--font-sans)", fontSize: 14, cursor: "pointer" };
    var removeBtn = { border: "none", background: "transparent", color: "var(--error)", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "4px 0" };
    return html`<div style=${{ marginBottom: 18 }}>
      ${line ? html`<div style=${{ fontFamily: "var(--font-serif)", fontSize: 15, color: "var(--on-surface)", margin: "0 0 8px 4px" }}>${line}</div>` : null}
      ${editor.sentence ? html`<p style=${{ margin: "0 0 8px 4px", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14, color: "var(--on-surface-variant)" }}>${editor.sentence}</p>` : null}
      ${editor.show ? html`<div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style=${{ fontFamily: "var(--font-sans)", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--on-surface-variant)", marginBottom: 6 }}>${Fam.spouseSeatLabel(person)}</div>
          ${spouseId ? html`<div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style=${{ fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--on-surface)" }}>${nameOf(spouseId)}</span>
            <button type="button" aria-label="Remove spouse" disabled=${busy} onClick=${removeDirectorySpouse} style=${removeBtn}>Remove</button>
          </div>` : html`<div>
            <input aria-label="Search to set spouse" placeholder="Search to set spouse" disabled=${busy} value=${spouseQS[0]} onInput=${function (e) { spouseQS[1](e.target.value); }} style=${field} />
            ${Fam.searchListOpen(spouseQS[0], spouseHits) ? html`<div style=${{ border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", marginTop: 6, overflow: "hidden" }}>
              ${spouseHits.map(function (candidate) {
                return html`<button type="button" key=${candidate.id} disabled=${busy} onClick=${function () { chooseSpouse(candidate.id); }} style=${hit}>${candidate.name}</button>`;
              })}
            </div>` : null}
          </div>`}
        </div>
        <div>
          <div style=${{ fontFamily: "var(--font-sans)", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--on-surface-variant)", marginBottom: 6 }}>Children</div>
          ${children.map(function (childId) {
            var childName = nameOf(childId);
            return html`<div key=${childId} style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
              <span style=${{ fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--on-surface)" }}>${childName}</span>
              <button type="button" aria-label=${"Remove " + childName} disabled=${busy} onClick=${function () { removeDirectoryChild(childId); }} style=${removeBtn}>Remove</button>
            </div>`;
          })}
          <input aria-label="Search to add a child" placeholder="Search to add a child" disabled=${busy} value=${childQS[0]} onInput=${function (e) { childQS[1](e.target.value); }} style=${field} />
          ${Fam.searchListOpen(childQS[0], childHits) ? html`<div style=${{ border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", marginTop: 6, overflow: "hidden" }}>
            ${childHits.map(function (candidate) {
              return html`<button type="button" key=${candidate.id} disabled=${busy} onClick=${function () { chooseChild(candidate.id); }} style=${hit}>${candidate.name}</button>`;
            })}
          </div>` : null}
        </div>
        <label style=${{ display: "block" }}>
          <span style=${{ display: "block", fontFamily: "var(--font-sans)", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--on-surface-variant)", marginBottom: 6 }}>Anniversary</span>
          <input type="date" aria-label="Anniversary" disabled=${busy} value=${Fam.anniversaryValue(families, person && person.id)} onChange=${function (e) { props.onWrite(Fam.planAnniversary(families, person, e.target.value)); }} style=${field} />
        </label>
      </div>` : null}
    </div>`;
  }

  // ── Person Detail ────────────────────────────────────────
  // Member-facing person page: contact + membership, no shepherding surface.
  // Editors (editor/elder/admin/super_admin) get an inline Edit Details modal
  // that writes the same contact fields as the shepherd person file.
  // The Family line is on this page for anyone who can open it. The controls
  // are here only while Edit Mode is on, and they are not inside Edit Details.
  function PersonDetailScreen(props) {
    var Edit = window.PhoneDirectoryEdit;
    var Track = window.PhoneDirectoryTrack;
    var mayEdit = Edit.mayOfferEditMode(props.user);
    var editFlagS = useState(Edit.isOn());
    useEffect(function () { return Edit.subscribe(function (on) { editFlagS[1](on); }); }, []);
    var editOn = Track.offerEdits(props.user, editFlagS[0]);
    var pS = useState((props.params && props.params.person) || { name: "Person", status: "member", tags: [], involvements: 0 });
    var p = pS[0];
    var tagsSt = useAsync(data.getShepherdingTags, []);
    var extraTagsS = useState([]);
    var savingTrackS = useState(false);
    var vis = tagVisibility(tagsSt.data);
    var isAdmin = isDirectoryAdmin(props.user);
    var tagsReady = !tagsSt.loading;
    var vocabulary = (tagsSt.data || []).concat(extraTagsS[0]);
    function onTrack(action) {
      if (savingTrackS[0]) return;
      savingTrackS[1](true);
      saveDirectoryTrack(p, props.user, action).then(function (next) {
        if (next) pS[1](next);
        savingTrackS[1](false);
      }).catch(function () {
        savingTrackS[1](false);
        window.alert(Track.TRACK_FAILED);
      });
    }
    function onTag(action) {
      if (savingTrackS[0]) return;
      savingTrackS[1](true);
      saveDirectoryTag(p, vocabulary, action).then(function (result) {
        savingTrackS[1](false);
        if (!result) return;
        pS[1](result.person);
        if (result.create) extraTagsS[1](extraTagsS[0].concat([vocabularyEntry(result.create)]));
      }).catch(function () {
        savingTrackS[1](false);
        window.alert(Track.TAG_FAILED);
      });
    }
    var contact = [["mail", p.email], ["phone", p.phone]].filter(function (r) { return r[1]; });
    // Membership tags always resolve via the Track; other tags obey visibility.
    var chipTags = (p.tags || []).filter(function (t) {
      return !window.ShepherdingCore.isMembershipTagId(t) && (isAdmin || (tagsReady && !vis.hidden[t]));
    });

    var mayOpen = mayOpenDirectory(props.user);
    var familiesSt = useAsync(mayOpen ? data.getFamilies : noPeople, [mayOpen]);
    var peopleSt = useAsync(mayOpen ? data.getPeople : noPeople, [mayOpen]);
    var familiesS = useState(null);
    var familyBusyS = useState(false);
    var familyLockS = useState({ current: false });
    var families = familiesS[0] || familiesSt.data || [];
    var directoryPeople = peopleSt.data || [];
    function onFamily(planned) {
      var lock = familyLockS[0];
      if (lock.current) return Promise.resolve(null);
      var writing = !!(planned && planned.write);
      if (writing) {
        lock.current = true;
        familyBusyS[1](true);
      }
      return applyDirectoryFamily(families, planned).then(function (next) {
        if (writing) {
          lock.current = false;
          familyBusyS[1](false);
        }
        if (next) familiesS[1](next);
        return next;
      }).catch(function () {
        lock.current = false;
        familyBusyS[1](false);
        window.alert(window.PhoneDirectoryFamily.SAVE_FAILED);
      });
    }
    var editS = useState(null);   // null = closed; else the working draft
    var savingS = useState(false);
    var invOpenS = useState(false);
    var invRowsS = useState(null);
    function openEdit() {
      var draft = { email: p.email || "", phone: p.phone || "", address: p.address || "", birthday: p.birthday || "" };
      if (editOn) {
        draft.name = Edit.storedDirectoryName(p);
        draft.sex = p.sex || "";
        draft.kid = !!p.kid;
      }
      editS[1](draft);
    }
    function dismissEdit() {
      if (savingS[0]) return;
      editS[1](null);
    }
    function saveEdit() {
      var d = editS[0]; if (!d) return;
      savingS[1](true);
      data.saveDirectoryPerson(p.id, d, props.user, editOn).then(function () {
        pS[1](Edit.savedPersonView(p, d, editOn));
        savingS[1](false);
        editS[1](null);
      }).catch(function () {
        savingS[1](false);
        window.alert(Edit.SAVE_FAILED);
      });
    }
    function setField(k, v) { var o = Object.assign({}, editS[0]); o[k] = v; editS[1](o); }
    function deleteThisPerson() {
      if (!window.confirm(Edit.DELETE_PERSON_CONFIRM)) return;
      data.deleteDirectoryPerson(p.id).then(function () {
        if (props.back) props.back();
      }).catch(function () {
        window.alert(Edit.DELETE_PERSON_FAILED);
      });
    }
    function openInvolvement() {
      invOpenS[1](true);
      invRowsS[1](null);
      data.getPersonInvolvement(p.id).then(function (rows) {
        invRowsS[1](rows || []);
      }).catch(function () {
        invOpenS[1](false);
        window.alert("Couldn't load Involvement. It did not work.");
      });
    }
    function deleteInvolvementRecord(id) {
      if (!window.confirm(Edit.DELETE_INVOLVEMENT_CONFIRM)) return;
      var plan = Edit.involvementRemoval(p.id, id);
      data.deleteDirectoryInvolvement(p.id, id).then(function () {
        invRowsS[1]((invRowsS[0] || []).filter(function (row) { return row.id !== id; }));
        pS[1](Object.assign({}, p, { totalInvolvements: (p.totalInvolvements || 0) + (plan.ok ? plan.countDelta : -1) }));
      }).catch(function () {
        window.alert(Edit.DELETE_INVOLVEMENT_FAILED);
      });
    }

    return html`
      <${Screen}>
        <${TopBar} title="Directory" onBack=${props.back} serif=${false} />
        <${Body} style=${{ padding: "22px 16px calc(40px + env(safe-area-inset-bottom,0px))" }}>
          <div style=${{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 22 }}>
            <${Avatar} name=${p.name} photoUrl=${p.photoUrl} photoCrop=${p.photoCrop} size=${82} />
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 23, fontWeight: 600, color: "var(--on-surface)", marginTop: 12 }}>${p.name}</div>
            <div style=${{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <${Badge} tone=${Track.directoryLabel(p, props.user) === "Inactive" ? "secondary" : "primary"}>${Track.directoryLabel(p, props.user)}<//>
              ${editOn ? null : chipTags.map(function (t) { return html`<${Badge} key=${t} tone="neutral">${t}<//>`; })}
            </div>
            ${editOn ? html`<div style=${{ width: "100%", marginTop: 8 }}>
              <${DirectoryTrack} person=${p} busy=${savingTrackS[0]} onTrack=${onTrack} />
              <${DirectoryTags} person=${p} user=${props.user} vocabulary=${vocabulary} visibility=${vis} tagsReady=${tagsReady} busy=${savingTrackS[0]} onTag=${onTag} />
            </div>` : null}
          </div>
          ${contact.length ? html`
            <${Overline} style=${{ margin: "0 0 8px 4px" }}>Contact<//>
            <div style=${{ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", overflow: "hidden", marginBottom: 18 }}>
              ${contact.map(function (r, i) { return html`<div key=${r[0]} style=${{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderBottom: i === contact.length - 1 ? "none" : "1px solid var(--outline-variant)" }}>
                <span style=${{ color: "var(--secondary)" }}>${Ic(r[0], 18)}</span>
                <span style=${{ fontFamily: "var(--font-sans)", fontSize: 14.5, color: "var(--on-surface)" }}>${r[1]}</span>
              </div>`; })}
            </div>` : null}
          ${(familiesSt.loading || peopleSt.loading) ? null : html`<${DirectoryFamily} person=${p} user=${props.user} editMode=${editOn} families=${families} people=${directoryPeople} busy=${familyBusyS[0]} onWrite=${onFamily} />`}
          ${mayEdit ? html`<${Button} variant="primary" size="md" style=${{ width: "100%" }} icon=${Ic("square-pen", 17)} onClick=${openEdit}>Edit Details<//>` : null}
          ${editOn ? html`<div style=${{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            <${Button} variant="secondary" size="md" style=${{ width: "100%" }} onClick=${openInvolvement}>Involvement<//>
            <${Button} type="button" variant="danger-outline" style=${{ width: "100%" }} onClick=${deleteThisPerson}>Delete person<//>
          </div>` : null}
        </${Body}>
        ${editS[0] ? html`<${CalSheet} title="Edit Details" subtitle=${p.name} onClose=${dismissEdit}>
          <div style=${{ padding: "16px 18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            ${editOn ? html`<${Input} label="Name" value=${editS[0].name || ""} onInput=${function (e) { setField("name", e.target.value); }} />` : null}
            <${Input} label="Email" type="email" value=${editS[0].email} onInput=${function (e) { setField("email", e.target.value); }} />
            <${Input} label="Phone" type="tel" value=${editS[0].phone} onInput=${function (e) { setField("phone", e.target.value); }} />
            <${Input} label="Address" value=${editS[0].address} onInput=${function (e) { setField("address", e.target.value); }} />
            <${Input} label="Birthday" type="date" value=${editS[0].birthday} onInput=${function (e) { setField("birthday", e.target.value); }} />
            ${editOn ? html`<${M.Fragment}>
              <${SexSelect} value=${editS[0].sex || ""} onChange=${function (e) { setField("sex", e.target.value); }} />
              <label class="m-check">
                <input type="checkbox" checked=${!!editS[0].kid} onChange=${function (e) { setField("kid", e.target.checked); }} />
                Kid
              </label>
              <div class="m-input-hint">Gets a child tag and a guardian stub at the kiosk</div>
            </${M.Fragment}>` : null}
            <${Button} variant="primary" size="md" style=${{ width: "100%", marginTop: 4 }} onClick=${saveEdit}>${savingS[0] ? "Saving…" : "Save Details"}<//>
          </div>
        <//>` : null}
        ${invOpenS[0] ? html`<${CalSheet} title="Involvement" subtitle=${p.name} onClose=${function () { invOpenS[1](false); }}>
          <div style=${{ padding: "8px 0 18px" }}>
            ${invRowsS[0] === null ? html`<div style=${{ padding: 24, textAlign: "center", fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--on-surface-variant)" }}>Loading…</div>`
              : invRowsS[0].length === 0 ? html`<div style=${{ padding: 24, textAlign: "center", fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--on-surface-variant)" }}>No involvement records.</div>`
              : invRowsS[0].map(function (item) {
                return html`<div key=${item.id} style=${{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--outline-variant)" }}>
                  <div style=${{ flex: 1, minWidth: 0 }}>
                    <div style=${{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: "var(--primary)" }}>${Edit.involvementLabel(item)}</div>
                    <div style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", marginTop: 2 }}>${item.serviceDate || ""}</div>
                  </div>
                  <${Button} type="button" variant="danger-outline" onClick=${function () { deleteInvolvementRecord(item.id); }}>Delete<//>
                </div>`;
              })}
          </div>
        </${CalSheet}>` : null}
      </${Screen}>`;
  }

  // ── Shared: segmented control + bar row ──────────────────
  function Segmented(props) {
    return html`<div style=${{ display: "flex", background: "var(--surface-container)", borderRadius: "var(--radius)", padding: 3, border: "1px solid var(--outline-variant)" }}>
      ${props.options.map(function (o) {
        var on = o === props.value;
        return html`<button key=${o} onClick=${function () { props.onChange(o); }} style=${{ flex: 1, padding: "8px 6px", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, letterSpacing: "0.02em", background: on ? "var(--surface-container-lowest)" : "transparent", color: on ? "var(--primary)" : "var(--on-surface-variant)", boxShadow: on ? "var(--shadow-xs)" : "none" }}>${o}</button>`;
      })}
    </div>`;
  }
  function svcLabel(dateStr) {
    var d = new Date(String(dateStr) + "T00:00:00");
    if (isNaN(d.getTime())) return { mon: "", day: String(dateStr), year: "" };
    return { mon: d.toLocaleDateString(undefined, { month: "short" }).toUpperCase(), day: String(d.getDate()), year: String(d.getFullYear()) };
  }

  // ── Services ─────────────────────────────────────────────
  // Native port of mobile/screens_calendar.jsx: every Sunday is a slot,
  // grouped Year › Month (blank until scheduled), with a Historic toggle,
  // List / Table views, a month Directory sheet, Jump-to-Upcoming, and per-
  // service Guide + Order-of-Service actions. Wired to real getServices data.
  // "Inject service" opens the proven desktop scheduler in-shell (that shift
  // is a destructive collectionGroup batch — kept on tested code, not re-ported).
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function pad2(n) { return String(n).length < 2 ? "0" + n : String(n); }
  function keyOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function parseKey(s) { var d = new Date(String(s) + "T00:00:00"); return isNaN(d.getTime()) ? null : d; }
  function sundayOf(d) { var x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function scrollToId(id) { var el = document.getElementById(id); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }

  var CAL_LABEL = { fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--on-surface-variant)" };

  // Small rectangular status chip on the date cards.
  function CalChip(props) {
    var tones = {
      tertiary: { bg: "var(--tertiary-container)", fg: "var(--on-tertiary-container)" },
      secondary: { bg: "var(--secondary-container)", fg: "var(--on-secondary-container)" },
      error: { bg: "var(--error-container)", fg: "var(--on-error-container)" },
    };
    var t = tones[props.tone] || tones.secondary;
    return html`<span style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: "var(--radius-sm)", background: t.bg, color: t.fg, fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600 }}>${Ic(props.icon, 12)}${props.children}</span>`;
  }

  // Presentational only — the surrounding row owns the click. (Giving this its own
  // onClick while the row also had one made every tap fire the toggle twice, so the
  // switch appeared dead: two flips cancelled out.)
  function CalSwitch(props) {
    return html`<span role="switch" aria-checked=${props.on} style=${{ position: "relative", display: "inline-block", width: 44, height: 26, flexShrink: 0, border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-full)", background: props.on ? "var(--primary)" : "var(--surface-container)", transition: "background 0.2s" }}>
      <span style=${{ position: "absolute", top: 2, left: props.on ? 20 : 2, width: 20, height: 20, borderRadius: "50%", background: "var(--surface-container-lowest)", boxShadow: "var(--shadow-xs)", transition: "left 0.2s" }} />
    </span>`;
  }

  function CalSheet(props) {
    return html`<${M.Fragment}>
      <div onClick=${props.onClose} style=${{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(14,28,54,0.42)", backdropFilter: "blur(1.5px)" }} />
      <div style=${{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 51, maxHeight: "78%", background: "var(--surface-container-lowest)", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: "1px solid var(--outline-variant)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column" }}>
        <div style=${{ padding: "16px 18px 12px", borderBottom: "1px solid var(--outline-variant)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, color: "var(--primary)" }}>${props.title}</div>
            ${props.subtitle ? html`<div style=${Object.assign({}, CAL_LABEL, { marginTop: 4 })}>${props.subtitle}</div>` : null}
          </div>
          <button onClick=${props.onClose} aria-label="Close" style=${{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-surface-variant)", cursor: "pointer", flexShrink: 0 }}>${Ic("x", 20)}</button>
        </div>
        <div style=${{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))" }}>${props.children}</div>
      </div>
    </${M.Fragment}>`;
  }

  function calActBtn(primary) {
    return { flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 8px", borderRadius: "var(--radius-full)", cursor: "pointer", background: primary ? "var(--secondary)" : "transparent", color: primary ? "var(--on-secondary)" : "var(--secondary)", border: primary ? "1px solid var(--secondary)" : "1px solid var(--outline)", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600 };
  }
  function calDirRow(isYear) {
    return { width: "100%", textAlign: "left", padding: isYear ? "12px 18px 6px" : "8px 18px 8px 34px", border: "none", background: "transparent", cursor: "pointer", fontFamily: isYear ? "var(--font-display)" : "var(--font-sans)", fontSize: isYear ? 16 : 14, fontWeight: isYear ? 600 : 500, color: isYear ? "var(--primary)" : "var(--on-surface-variant)" };
  }

  // Horizontally-scrolling table block for one month (columns that exist in the data).
  function CalTable(props) {
    var TH = { padding: "10px 12px", textAlign: "left", fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--primary)", borderBottom: "1px solid var(--outline-variant)", whiteSpace: "nowrap", background: "var(--surface-container-low)" };
    var TD = { padding: "11px 12px", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface-variant)", borderBottom: "1px solid var(--outline-variant)", whiteSpace: "nowrap", verticalAlign: "top" };
    var cols = ["Date", "Theme", "Leader", "Preacher", "Music", "Baptism"];
    function dash(v) { return v && String(v).length ? v : "—"; }
    function open(d) { if (props.onOpen) props.onOpen(d); }
    return html`<div style=${{ margin: "0 16px", overflowX: "auto", WebkitOverflowScrolling: "touch", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", background: "var(--surface-container-lowest)" }}>
      <table style=${{ borderCollapse: "collapse", minWidth: 720 }}>
        <thead><tr>${cols.map(function (h) { return html`<th key=${h} style=${TH}>${h}</th>`; })}</tr></thead>
        <tbody>
          ${props.dates.map(function (d) {
            var s = props.byDate[keyOf(d)] || {};
            return html`<tr key=${keyOf(d)} id=${"cal-d-" + keyOf(d)} onClick=${function () { open(d); }} style=${{ cursor: "pointer" }}>
              <td style=${Object.assign({}, TD, { color: "var(--on-surface)", fontWeight: 500 })}>${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</td>
              <td style=${Object.assign({}, TD, { whiteSpace: "normal", minWidth: 160, color: "var(--primary)" })}>${dash(s.theme)}</td>
              <td style=${TD}>${dash(s.serviceLeader)}</td>
              <td style=${TD}>${dash(s.preacher)}</td>
              <td style=${TD}>${dash(s.musicLeader)}</td>
              <td style=${TD}>${s.hasBaptism ? "Yes" : "—"}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
  }

  function CalendarScreen(props) {
    var st = useAsync(data.getServices, []);
    var viewS = useState("List");
    var histS = useState(false);
    var dirS = useState(false);
    var hlS = useState(null);
    var view = viewS[0], hist = histS[0];

    var services = st.data || [];
    var byDate = {};
    services.forEach(function (s) { byDate[s.date] = s; });
    var today = new Date().toISOString().slice(0, 10);

    // Sunday range: from the earliest of (today, first scheduled Sunday) through
    // the later of (last scheduled Sunday, ~120 days out) so upcoming blank slots
    // are always available to schedule into.
    var keys = services.map(function (s) { return s.date; }).filter(function (k) { return !!parseKey(k); });
    var minKey = keys.length ? keys.reduce(function (a, b) { return a < b ? a : b; }) : today;
    var maxKey = keys.length ? keys.reduce(function (a, b) { return a > b ? a : b; }) : today;
    var startD = sundayOf(parseKey(minKey < today ? minKey : today) || new Date());
    var endD = sundayOf(addDays(new Date(), 120));
    var maxD = sundayOf(parseKey(maxKey) || new Date());
    if (maxD.getTime() > endD.getTime()) endD = maxD;
    var sundays = [];
    for (var dd = new Date(startD.getTime()); dd.getTime() <= endD.getTime(); dd = addDays(dd, 7)) sundays.push(new Date(dd.getTime()));

    var upcomingKey = null;
    for (var u = 0; u < sundays.length; u++) { if (keyOf(sundays[u]) >= today) { upcomingKey = keyOf(sundays[u]); break; } }

    var shown = hist ? sundays : sundays.filter(function (d) { return keyOf(d) >= today; });

    // Group into [{ year, months: [{ mi, month, dates: [] }] }]
    var grouped = [];
    shown.forEach(function (d) {
      var y = d.getFullYear(), mi = d.getMonth();
      var yg = null, i;
      for (i = 0; i < grouped.length; i++) { if (grouped[i].year === y) { yg = grouped[i]; break; } }
      if (!yg) { yg = { year: y, months: [] }; grouped.push(yg); }
      var mg = null;
      for (i = 0; i < yg.months.length; i++) { if (yg.months[i].mi === mi) { mg = yg.months[i]; break; } }
      if (!mg) { mg = { mi: mi, month: MONTH_NAMES[mi], dates: [] }; yg.months.push(mg); }
      mg.dates.push(d);
    });

    function jumpUpcoming() {
      if (!upcomingKey) return;
      var el = document.getElementById("cal-d-" + upcomingKey);
      if (el) { el.scrollIntoView({ block: "start", behavior: "smooth" }); hlS[1](upcomingKey); setTimeout(function () { hlS[1](null); }, 2000); }
    }
    function goGuide(s, complete) {
      if (s && !complete && !window.confirm("Warning: There are elements that you have not completed yet. Please do so before going to the service guide page.\n\nDo you still want to proceed to the editor?")) return;
      props.nav("serviceGuide");
    }
    function openScheduler() { window.location.href = "service-calendar.html?shell=mobile"; }

    // Jump to the upcoming service on first load, view switch, or whenever the
    // Historic toggle flips — toggling either way re-anchors the scroll on the
    // upcoming week rather than stranding the user mid-history.
    useEffect(function () {
      if (st.loading || !upcomingKey) return;
      var el = document.getElementById("cal-d-" + upcomingKey);
      if (el) el.scrollIntoView({ block: "start" });
    }, [st.loading, view, hist]);

    function renderCard(d) {
      var key = keyOf(d);
      var s = byDate[key];
      var hl = hlS[0] === key;
      var complete = !!(s && s.theme && s.preacher && s.serviceLeader);
      return html`<div key=${key} id=${"cal-d-" + key} style=${{ background: "var(--surface-container-lowest)", borderRadius: "var(--radius-xl)", padding: 15, border: hl ? "2px solid var(--primary)" : "1px solid var(--outline-variant)", boxShadow: hl ? "var(--shadow-sm)" : "none", transition: "border-color 0.3s, box-shadow 0.3s" }}>
        <div style=${{ display: "flex", gap: 13 }}>
          <div style=${{ flexShrink: 0, width: 52, height: 52, borderRadius: "var(--radius)", background: "var(--primary-fixed)", color: "var(--primary)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style=${{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>${d.toLocaleDateString(undefined, { weekday: "short" })}</span>
            <span style=${{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, lineHeight: 1 }}>${d.getDate()}</span>
          </div>
          <div style=${{ flex: 1, minWidth: 0 }}>
            <div style=${{ fontFamily: "var(--font-sans)", fontSize: 14.5, fontWeight: 600, color: "var(--on-surface)" }}>${d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
            ${s ? html`<${M.Fragment}>
              <div style=${{ fontFamily: "var(--font-serif)", fontSize: 15, fontWeight: 600, color: "var(--primary)", marginTop: 3, lineHeight: 1.25 }}>${s.theme}</div>
              ${s.sermon ? html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 500, color: "var(--primary)", marginTop: 3 }}>${s.sermon}</div>` : null}
              <div style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", marginTop: 3 }}>${s.preacher ? "Preaching · " + s.preacher : "Sunday Service"}</div>
              <div style=${{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                ${s.hasBaptism ? html`<${CalChip} icon="droplets" tone="tertiary">Baptism<//>` : null}
                ${!complete ? html`<${CalChip} icon="triangle-alert" tone="error">Incomplete<//>` : null}
              </div>
            </${M.Fragment}>` : html`<div style=${{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--on-surface-variant)", marginTop: 3 }}>Sunday Service · <span style=${{ fontStyle: "italic" }}>unscheduled</span></div>`}
          </div>
        </div>
        <div style=${{ display: "flex", gap: 8, marginTop: 13 }}>
          <button onClick=${function () { goGuide(s, complete); }} style=${calActBtn(true)}>${Ic("book-open", 16)} Service Guide</button>
          <button onClick=${function () { props.nav("serviceBuilder", { date: key }); }} style=${calActBtn(false)}>${Ic("list-checks", 16)} Order of Service</button>
        </div>
      </div>`;
    }

    return html`
      <${Screen}>
        <${TopBar} title="Services" onMenu=${props.openMenu} right=${html`
          <${BarAction} icon="list-tree" label="Directory" onClick=${function () { dirS[1](true); }} />
          <${BarAction} icon="calendar-plus" label="Inject service" onClick=${openScheduler} />
        `} />

        <div style=${{ flexShrink: 0, background: "var(--surface-container-lowest)", borderBottom: "1px solid var(--outline-variant)", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div role="button" aria-pressed=${hist} onClick=${function () { histS[1](!hist); }} style=${{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
            <span style=${CAL_LABEL}>Historic</span>
            <${CalSwitch} on=${hist} />
          </div>
          <${Segmented} options=${["List", "Table"]} value=${view} onChange=${function (o) { viewS[1](o); }} />
        </div>

        <${Body}>
          ${st.loading ? html`<${Loading} label="Loading services…" />` : st.error ? html`<${ErrorNote}>Couldn't load services.<//>` : html`
            <div style=${{ padding: view === "List" ? "8px 16px 96px" : "8px 0 96px" }}>
              ${grouped.map(function (yg) { return html`
                <div key=${yg.year} id=${"cal-y-" + yg.year}>
                  <h2 style=${{ margin: view === "List" ? "14px 0 8px" : "14px 16px 8px", paddingBottom: 6, borderBottom: "1px solid var(--outline-variant)", fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, color: "var(--primary)" }}>${yg.year}</h2>
                  ${yg.months.map(function (mg) { return html`
                    <div key=${mg.mi} id=${"cal-m-" + yg.year + "-" + mg.mi} style=${{ marginBottom: 18 }}>
                      <h3 style=${{ margin: view === "List" ? "10px 0 8px" : "10px 16px 8px", fontFamily: "var(--font-serif)", fontSize: 17, fontWeight: 600, color: "var(--secondary)" }}>${mg.month}</h3>
                      ${view === "List"
                        ? html`<div style=${{ display: "flex", flexDirection: "column", gap: 10 }}>${mg.dates.map(function (d) { return renderCard(d); })}</div>`
                        : html`<${CalTable} dates=${mg.dates} byDate=${byDate} onOpen=${function (d) { props.nav("serviceBuilder", { date: keyOf(d) }); }} />`}
                    </div>`; })}
                </div>`; })}
              ${grouped.length === 0 ? html`<${Empty}>No services to show.<//>` : null}
            </div>`}
        </${Body}>

        <${FAB} icon="calendar-check" label="Jump to upcoming" onClick=${jumpUpcoming} />

        ${dirS[0] ? html`<${CalSheet} title="Directory" subtitle="Jump to a month" onClose=${function () { dirS[1](false); }}>
          <button onClick=${function () { dirS[1](false); setTimeout(jumpUpcoming, 60); }} style=${{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", border: "none", borderBottom: "1px solid var(--outline-variant)", background: "transparent", cursor: "pointer", color: "var(--primary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>${Ic("calendar-check", 16)} Jump to Upcoming</button>
          ${grouped.map(function (yg) { return html`<div key=${yg.year}>
            <button onClick=${function () { dirS[1](false); setTimeout(function () { scrollToId("cal-y-" + yg.year); }, 60); }} style=${calDirRow(true)}>${yg.year}</button>
            ${yg.months.map(function (mg) { return html`<button key=${mg.mi} onClick=${function () { dirS[1](false); setTimeout(function () { scrollToId("cal-m-" + yg.year + "-" + mg.mi); }, 60); }} style=${calDirRow(false)}>${mg.month}</button>`; })}
          </div>`; })}
        </${CalSheet}>` : null}
      </${Screen}>`;
  }

  // The Shepherd Dashboard is a native screen (see mobile/screens-shepherd.js).
  // The rest of the shepherding cluster — Documents, People, Manage Tags, and a
  // person's file — are the real desktop pages, opened in-place with ?shell=mobile
  // (routed in app.js SHELL_PAGES / nav). Kept out of the Preact shell so mobile
  // gets every feature + the proven save logic — see mobile-shell.js.

  // ── In-shell placeholder for routes not yet ported ───────
  function ComingSoon(props) {
    var title = (props.params && props.params.title) || "Coming soon";
    var page = props.params && props.params.page;
    return html`
      <${Screen}>
        <${TopBar} title=${title} onMenu=${props.openMenu} />
        <${Body} style=${{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
          <span style=${{ color: "var(--primary)" }}>${Ic("hammer", 34)}</span>
          <div style=${{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 600, color: "var(--on-surface)", marginTop: 14, textAlign: "center" }}>${title}</div>
          <div style=${{ fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--on-surface-variant)", marginTop: 6, textAlign: "center", lineHeight: 1.5 }}>This screen is being built for mobile. You can open the full desktop version in the meantime.</div>
          ${page ? html`<div style=${{ marginTop: 22 }}><${Button} variant="secondary" size="md" icon=${Ic("external-link", 16)} onClick=${function () { window.location.href = page; }}>Open full page<//></div>` : null}
        </${Body}>
      </${Screen}>`;
  }

  M.SCREENS = Object.assign(M.SCREENS || {}, {
    hymnDirectory: HymnDirectoryScreen,
    hymnDetails: HymnDetailsScreen,
    people: PeopleScreen,
    personDetail: PersonDetailScreen,
    calendar: CalendarScreen,
    comingSoon: ComingSoon,
  });
})();
