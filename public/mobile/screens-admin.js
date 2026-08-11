/* ============================================================
   screens-admin.js — native Admin Dashboard for the mobile shell.
   Ported from the desktop admin page (admin-dashboard.js/.html) and
   wired to the same admin-gated SMS callables + Firestore config via
   M.data. A drawer page: hamburger TopBar, role-gated to admin /
   super_admin.
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, data = M.data, Fragment = M.Fragment;
  var useState = M.hooks.useState, useEffect = M.hooks.useEffect;
  var ui = M.ui, Screen = ui.Screen, TopBar = ui.TopBar, Body = ui.Body;

  var OVER = { fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--on-surface-variant)" };
  var PANEL = { background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", padding: 16, marginBottom: 14 };
  var H2 = { margin: 0, fontFamily: "var(--font-serif)", fontSize: 17, fontWeight: 600, color: "var(--primary)" };
  var LABEL = { fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--on-surface-variant)" };
  var iconBtn = { width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-surface-variant)", cursor: "pointer", borderRadius: 8, flexShrink: 0 };
  var inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", background: "var(--surface-container-low)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius)", outline: "none", fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--on-surface)" };
  function pill(variant) {
    return { padding: "9px 16px", borderRadius: "var(--radius-full)", border: variant === "ghost" ? "1px solid var(--outline-variant)" : "none", background: variant === "ghost" ? "transparent" : "var(--primary)", color: variant === "ghost" ? "var(--on-surface-variant)" : "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
  }

  var PRAYER_FIELDS = [
    { key: "initial", label: "Initial request", help: "Sent first, a few days before the service. Uses {name}." },
    { key: "reminder", label: "Reminder", help: "Sent closer to the service if no reply yet. Uses {name}." },
    { key: "thankyou", label: "Thank-you reply", help: "Auto-reply after someone sends their request. Uses {name}." },
    { key: "elderDigest", label: "Elder digest", help: "Texted to Elder-tagged people once all of a service's requests are in by reply. Uses {date} and {requests}." },
  ];

  function Toast(props) {
    if (!props.toast) return null;
    return html`<div style=${{ position: "absolute", bottom: "calc(28px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", zIndex: 70, padding: "11px 18px", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)", background: props.toast.type === "error" ? "var(--error)" : "var(--primary)", color: props.toast.type === "error" ? "var(--on-error)" : "var(--on-primary)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", maxWidth: "90%" }}>${props.toast.message}</div>`;
  }

  function Switch(props) {
    return html`<button onClick=${props.onClick} role="switch" aria-checked=${props.on} style=${{ position: "relative", width: 46, height: 27, flexShrink: 0, border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-full)", cursor: "pointer", background: props.on ? "var(--primary)" : "var(--surface-container)", transition: "background 0.2s" }}>
      <span style=${{ position: "absolute", top: 2, left: props.on ? 21 : 2, width: 21, height: 21, borderRadius: "50%", background: "var(--surface-container-lowest)", boxShadow: "var(--shadow-xs)", transition: "left 0.2s" }} />
    </button>`;
  }

  function fmtDatetime(ts) {
    if (!ts) return "";
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function AdminScreen(props) {
    var loadingS = useState(true);
    var statusLoadingS = useState(false), keyConfiguredS = useState(null), quotaS = useState(null), statusErrS = useState("");
    var testPhoneS = useState(""), testMsgS = useState(""), sendingS = useState(false), lastResultS = useState(null);
    var repliesS = useState([]), repliesLoadingS = useState(false);
    var msgsS = useState(Object.assign({}, data.PRAYER_MESSAGE_DEFAULTS)), prayerSavingS = useState(false);
    var autoSendS = useState(false), autoSavingS = useState(false);
    var toastS = useState(null);

    function showToast(m, t) { toastS[1]({ message: m, type: t || "success" }); setTimeout(function () { toastS[1](null); }, 2800); }

    function refreshStatus() {
      statusLoadingS[1](true); statusErrS[1]("");
      data.getSmsStatus().then(function (s) {
        keyConfiguredS[1](s.configured); quotaS[1](s.quotaRemaining); if (s.error) statusErrS[1](s.error);
      }).catch(function (e) {
        keyConfiguredS[1](null); quotaS[1](null); statusErrS[1]((e && e.message) || "Could not check SMS status.");
      }).then(function () { statusLoadingS[1](false); });
    }
    function loadReplies() {
      repliesLoadingS[1](true);
      data.getSmsReplies().then(function (r) { repliesS[1](r); }).catch(function () { showToast("Could not load replies", "error"); }).then(function () { repliesLoadingS[1](false); });
    }
    function loadPrayer() {
      data.getPrayerMessages().then(function (r) { msgsS[1](r.messages); autoSendS[1](r.autoSendEnabled); }).catch(function () { showToast("Could not load prayer messages", "error"); });
    }

    useEffect(function () {
      var alive = true;
      // Wait until auth resolves + permissionLevel known before hitting admin callables.
      if (props.user === undefined) return;
      if (!props.user || (props.user.permissionLevel !== "admin" && props.user.permissionLevel !== "super_admin")) { loadingS[1](false); return; }
      loadingS[1](false);
      refreshStatus(); loadReplies(); loadPrayer();
      return function () { alive = false; };
    }, [props.user]);

    function sendTest() {
      var phone = testPhoneS[0].trim();
      if (!phone || sendingS[0]) return;
      sendingS[1](true); lastResultS[1](null);
      data.sendTestSms(phone, testMsgS[0].trim()).then(function (d) {
        if (d.success) {
          var extra = (d.quotaRemaining != null) ? " · " + d.quotaRemaining + " credits left" : "";
          lastResultS[1]({ ok: true, message: "Sent. textId " + d.textId + extra });
          if (d.quotaRemaining != null) quotaS[1](d.quotaRemaining);
          showToast("Test SMS sent");
        } else {
          lastResultS[1]({ ok: false, message: d.error || "Textbelt rejected the message." });
          showToast("Send failed", "error");
        }
      }).catch(function (e) {
        lastResultS[1]({ ok: false, message: (e && e.message) || "Send failed." }); showToast("Send failed", "error");
      }).then(function () { sendingS[1](false); });
    }
    function deleteReply(id) {
      data.deleteSmsReply(id).then(function () { repliesS[1](repliesS[0].filter(function (r) { return r.id !== id; })); showToast("Reply deleted"); }).catch(function () { showToast("Error deleting reply", "error"); });
    }
    function clearReplies() {
      if (!repliesS[0].length || !window.confirm("Delete all replies in the stack?")) return;
      data.clearSmsReplies(repliesS[0].map(function (r) { return r.id; })).then(function () { repliesS[1]([]); showToast("Replies cleared"); }).catch(function () { showToast("Error clearing replies", "error"); });
    }
    function savePrayer() {
      prayerSavingS[1](true);
      data.savePrayerMessages(msgsS[0], props.user).then(function () { showToast("Prayer messages saved"); }).catch(function () { showToast("Error saving messages", "error"); }).then(function () { prayerSavingS[1](false); });
    }
    function resetPrayer() { msgsS[1](Object.assign({}, data.PRAYER_MESSAGE_DEFAULTS)); showToast("Reset to defaults — Save to apply"); }
    function toggleAuto() {
      var next = !autoSendS[0];
      autoSavingS[1](true);
      data.setAutoSend(next, props.user).then(function () { autoSendS[1](next); showToast(next ? "Automatic sending ON" : "Automatic sending OFF"); }).catch(function () { showToast("Could not change automation", "error"); }).then(function () { autoSavingS[1](false); });
    }

    var userKnown = props.user !== undefined;
    var isAdmin = userKnown && !!props.user && (props.user.permissionLevel === "admin" || props.user.permissionLevel === "super_admin");
    var lastResult = lastResultS[0];

    if (!userKnown || loadingS[0]) {
      return html`<${Screen}><${TopBar} title="Admin" onMenu=${props.openMenu} serif=${false} />
        <${Body} style=${{ padding: "16px" }}><div style=${{ display: "flex", justifyContent: "center", padding: "48px 20px", color: "var(--on-surface-variant)" }}><span style=${{ display: "flex", animation: "mspin 0.9s linear infinite" }}>${Ic("loader-circle", 26)}</span></div></${Body}></${Screen}>`;
    }
    if (!isAdmin) {
      return html`<${Screen}><${TopBar} title="Admin" onMenu=${props.openMenu} serif=${false} />
        <${Body} style=${{ padding: "60px 24px", textAlign: "center" }}><div style=${{ display: "inline-flex", opacity: 0.5, color: "var(--on-surface-variant)" }}>${Ic("shield-alert", 40)}</div><p style=${{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 15, marginTop: 12, color: "var(--on-surface-variant)" }}>Admin-only tools.</p></${Body}></${Screen}>`;
    }

    return html`
      <${Screen}>
        <${TopBar} title="Admin" onMenu=${props.openMenu} serif=${false} />
        <${Body} style=${{ padding: "16px 16px calc(40px + env(safe-area-inset-bottom, 0px))" }}>
          <div style=${{ marginBottom: 18 }}>
            <div style=${{ fontFamily: "var(--font-serif)", fontSize: 24, fontWeight: 600, color: "var(--primary)" }}>Admin Dashboard</div>
            <p style=${{ margin: "4px 0 0", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--on-surface-variant)" }}>Admin-only system tools.</p>
          </div>

          <!-- SMS status -->
          <div style=${PANEL}>
            <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style=${H2}>SMS Status</h2>
              <button onClick=${refreshStatus} style=${Object.assign({}, pill("ghost"), { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 12 })}>
                ${statusLoadingS[0] ? html`<span style=${{ display: "flex", animation: "mspin 0.7s linear infinite" }}>${Ic("loader-circle", 14)}</span>` : Ic("refresh-cw", 14)} ${statusLoadingS[0] ? "Checking…" : "Refresh"}
              </button>
            </div>
            <div style=${{ display: "flex", gap: 10 }}>
              <div style=${{ flex: 1, background: "var(--surface-container)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
                <div style=${LABEL}>Textbelt key</div>
                <div style=${{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: keyConfiguredS[0] === false ? "var(--error)" : "var(--on-surface)" }}>
                  ${keyConfiguredS[0] == null ? "—" : (keyConfiguredS[0] ? html`<${Fragment}>${Ic("check-circle-2", 16)} Configured<//>` : html`<${Fragment}>${Ic("circle-x", 16)} Missing<//>`)}
                </div>
              </div>
              <div style=${{ flex: 1, background: "var(--surface-container)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
                <div style=${LABEL}>Credits left</div>
                <div style=${{ marginTop: 6, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--primary)" }}>${quotaS[0] == null ? "—" : quotaS[0]}</div>
              </div>
            </div>
            ${statusErrS[0] ? html`<p style=${{ margin: "10px 0 0", fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--error)" }}>${statusErrS[0]}</p>` : null}
          </div>

          <!-- Test send -->
          <div style=${PANEL}>
            <h2 style=${Object.assign({}, H2, { marginBottom: 12 })}>Send a Test SMS</h2>
            <div style=${{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style=${{ display: "flex", flexDirection: "column", gap: 6 }}><span style=${LABEL}>Phone number</span>
                <input type="tel" value=${testPhoneS[0]} onInput=${function (e) { testPhoneS[1](e.target.value); }} placeholder="+1 555 123 4567" style=${inputStyle} /></label>
              <label style=${{ display: "flex", flexDirection: "column", gap: 6 }}><span style=${LABEL}>Message</span>
                <textarea rows=${3} value=${testMsgS[0]} onInput=${function (e) { testMsgS[1](e.target.value); }} placeholder="Test message from Mosaic…" style=${Object.assign({}, inputStyle, { resize: "vertical" })}></textarea></label>
              <div><button onClick=${sendTest} disabled=${sendingS[0] || !testPhoneS[0].trim()} style=${Object.assign({}, pill(), { display: "inline-flex", alignItems: "center", gap: 6, opacity: (sendingS[0] || !testPhoneS[0].trim()) ? 0.5 : 1 })}>
                ${sendingS[0] ? html`<span style=${{ display: "flex", animation: "mspin 0.7s linear infinite" }}>${Ic("loader-circle", 15)}</span>` : Ic("send", 15)} ${sendingS[0] ? "Sending…" : "Send Test"}
              </button></div>
              ${lastResult ? html`<div style=${{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: "var(--radius)", background: lastResult.ok ? "var(--tertiary-container)" : "var(--error-container)", color: lastResult.ok ? "var(--on-tertiary-container)" : "var(--on-error-container)", fontFamily: "var(--font-sans)", fontSize: 12.5 }}>
                ${Ic(lastResult.ok ? "check-circle-2" : "triangle-alert", 15)}<span>${lastResult.message}</span>
              </div>` : null}
            </div>
          </div>

          <!-- Replies -->
          <div style=${PANEL}>
            <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style=${H2}>Inbound Replies ${repliesS[0].length ? html`<span style=${{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, color: "var(--on-surface-variant)" }}>(${repliesS[0].length})</span>` : null}</h2>
              <div style=${{ display: "flex", gap: 4 }}>
                <button onClick=${loadReplies} aria-label="Refresh replies" style=${iconBtn}>${repliesLoadingS[0] ? html`<span style=${{ display: "flex", animation: "mspin 0.7s linear infinite" }}>${Ic("loader-circle", 16)}</span>` : Ic("refresh-cw", 16)}</button>
                ${repliesS[0].length ? html`<button onClick=${clearReplies} aria-label="Clear all replies" style=${Object.assign({}, iconBtn, { color: "var(--error)" })}>${Ic("trash-2", 16)}</button>` : null}
              </div>
            </div>
            ${repliesS[0].length === 0 ? html`<p style=${{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 13, fontStyle: "italic", color: "var(--on-surface-variant)" }}>No replies yet.</p>`
              : html`<div style=${{ display: "flex", flexDirection: "column", gap: 8 }}>
                ${repliesS[0].map(function (r) {
                  return html`<div key=${r.id} style=${{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, background: "var(--surface-container)", borderRadius: "var(--radius)", padding: "10px 12px" }}>
                    <div style=${{ minWidth: 0 }}>
                      <div style=${{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style=${{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, color: "var(--on-surface)" }}>${r.fromNumber || "Unknown number"}</span>
                        <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--on-surface-variant)" }}>${fmtDatetime(r.receivedAt)}</span>
                      </div>
                      <div style=${{ fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--on-surface)", marginTop: 4, wordBreak: "break-word" }}>${r.text}</div>
                    </div>
                    <button onClick=${function () { deleteReply(r.id); }} aria-label="Delete reply" style=${Object.assign({}, iconBtn, { width: 30, height: 30 })}>${Ic("x", 16)}</button>
                  </div>`;
                })}
              </div>`}
          </div>

          <!-- Prayer messages -->
          <div style=${PANEL}>
            <div style=${{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
              <h2 style=${H2}>Prayer-Request Messages</h2>
              <label style=${{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, color: autoSendS[0] ? "var(--primary)" : "var(--on-surface-variant)" }}>Auto-send ${autoSendS[0] ? "ON" : "OFF"}</span>
                <${Switch} on=${autoSendS[0]} onClick=${function () { if (!autoSavingS[0]) toggleAuto(); }} />
              </label>
            </div>
            <div style=${{ display: "flex", flexDirection: "column", gap: 14 }}>
              ${PRAYER_FIELDS.map(function (f) {
                return html`<label key=${f.key} style=${{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style=${LABEL}>${f.label}</span>
                  <span style=${{ fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--on-surface-variant)", lineHeight: 1.35 }}>${f.help}</span>
                  <textarea rows=${3} value=${msgsS[0][f.key]} onInput=${function (e) { var n = Object.assign({}, msgsS[0]); n[f.key] = e.target.value; msgsS[1](n); }} style=${Object.assign({}, inputStyle, { resize: "vertical", marginTop: 2 })}></textarea>
                </label>`;
              })}
            </div>
            <div style=${{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button onClick=${resetPrayer} style=${pill("ghost")}>Reset to defaults</button>
              <button onClick=${savePrayer} disabled=${prayerSavingS[0]} style=${Object.assign({}, pill(), { display: "inline-flex", alignItems: "center", gap: 6, opacity: prayerSavingS[0] ? 0.6 : 1 })}>
                ${prayerSavingS[0] ? html`<span style=${{ display: "flex", animation: "mspin 0.7s linear infinite" }}>${Ic("loader-circle", 15)}</span>` : Ic("save", 15)} Save messages
              </button>
            </div>
          </div>
        </${Body}>
        <${Toast} toast=${toastS[0]} />
      </${Screen}>`;
  }

  M.SCREENS = Object.assign(M.SCREENS || {}, { admin: AdminScreen });
})();
