/* ============================================================
   ui.js — reusable mobile primitives, ported from the Mosaic Mobile
   design (app shell + design-system components). Exposed on M.ui.
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, Icon = M.Icon;

  // ── Layout ────────────────────────────────────────────────
  function Screen(props) {
    return html`<div style=${Object.assign({ display: "flex", flexDirection: "column", height: "100%", background: "var(--background)" }, props.style || {})}>${props.children}</div>`;
  }

  function TopBar(props) {
    var serif = props.serif !== false;
    var onLeft = props.onBack || props.onMenu;
    return html`
      <!-- The +4 and the 46px row are the whole header's height budget. They sit
           as close under the safe-area inset as they can without tucking the
           title beneath the island — the inset itself is never reduced.
           mobile-shell-header.js draws this same bar for the desktop pages the
           phone opens, and carries the same two numbers. -->
      <header style=${{ flexShrink: 0, paddingTop: "calc(env(safe-area-inset-top, 20px) + 4px)", background: "var(--surface-container-lowest)", borderBottom: "1px solid var(--outline-variant)" }}>
        <div style=${{ display: "flex", alignItems: "center", gap: 6, height: 46, padding: "0 8px 0 6px" }}>
          <button onClick=${onLeft} aria-label=${props.onBack ? "Back" : "Menu"}
            style=${{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-surface)", cursor: "pointer", borderRadius: 10 }}>
            ${Ic(props.onBack ? "chevron-left" : "menu", 24)}
          </button>
          <h1 style=${{ flex: 1, margin: 0, minWidth: 0, fontFamily: serif ? "var(--font-display)" : "var(--font-serif)", fontSize: serif ? 17 : 20, fontWeight: 600, letterSpacing: serif ? "0.06em" : "0.01em", color: "var(--on-surface)", textTransform: serif ? "uppercase" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${props.title}</h1>
          <div style=${{ display: "flex", alignItems: "center", gap: 2 }}>${props.right}</div>
        </div>
      </header>`;
  }

  function BarAction(props) {
    return html`
      <button onClick=${props.onClick} aria-label=${props.label}
        style=${{ position: "relative", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--on-surface)", cursor: "pointer", borderRadius: 10 }}>
        ${Ic(props.icon, 22)}
        ${props.badge ? html`<span style=${{ position: "absolute", top: 8, right: 8, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8, background: "var(--error)", color: "#fff", fontSize: 10, fontWeight: 700, fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px solid var(--surface-container-lowest)" }}>${props.badge}</span>` : null}
      </button>`;
  }

  function Body(props) {
    return html`<div style=${Object.assign({ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }, props.style || {})}>${props.children}</div>`;
  }

  // ── Typography ────────────────────────────────────────────
  function Overline(props) {
    return html`<div style=${Object.assign({ fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--on-surface-variant)" }, props.style || {})}>${props.children}</div>`;
  }

  function SerifHead(props) {
    return html`<h2 style=${Object.assign({ margin: 0, fontFamily: "var(--font-serif)", fontSize: props.size || 22, fontWeight: 600, lineHeight: 1.2, color: "var(--on-surface)" }, props.style || {})}>${props.children}</h2>`;
  }

  // ── Lists ─────────────────────────────────────────────────
  function Row(props) {
    var showChevron = props.trailing === undefined || props.trailing === "chevron";
    return html`
      <button onClick=${props.onClick}
        style=${{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", border: "none", background: "transparent", cursor: props.onClick ? "pointer" : "default", textAlign: "left", borderBottom: props.isLast ? "none" : "1px solid var(--outline-variant)", fontFamily: "var(--font-sans)" }}>
        ${props.leading}
        <div style=${{ flex: 1, minWidth: 0 }}>
          <div style=${{ fontFamily: props.titleSerif ? "var(--font-serif)" : "var(--font-sans)", fontSize: props.titleSerif ? 17 : 15.5, fontWeight: props.titleSerif ? 600 : 500, color: "var(--on-surface)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${props.title}</div>
          ${props.subtitle ? html`<div style=${{ fontSize: 13, color: "var(--on-surface-variant)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${props.subtitle}</div>` : null}
        </div>
        ${props.meta ? html`<span style=${{ fontSize: 13, color: "var(--on-surface-variant)", flexShrink: 0 }}>${props.meta}</span>` : null}
        ${showChevron && props.onClick ? html`<span style=${{ color: "var(--outline)", display: "flex" }}>${Ic("chevron-right", 18)}</span>` : (!showChevron ? props.trailing : null)}
      </button>`;
  }

  function CardList(props) {
    return html`<div style=${Object.assign({ background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-xl)", overflow: "hidden" }, props.style || {})}>${props.children}</div>`;
  }

  function Medallion(props) {
    var size = props.size || 40;
    return html`<span style=${{ width: size, height: size, borderRadius: "var(--radius-full)", background: props.tone === "tint" ? "var(--primary-fixed)" : "var(--surface-container)", color: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>${Ic(props.icon, Math.round(size * 0.5))}</span>`;
  }

  function SearchBar(props) {
    return html`
      <label style=${{ display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 14px", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-full)", color: "var(--on-surface-variant)" }}>
        ${Ic("search", 18)}
        <input value=${props.value} onInput=${props.onChange} placeholder=${props.placeholder || "Search"}
          style=${{ flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--on-surface)" }} />
      </label>`;
  }

  function FAB(props) {
    return html`
      <button onClick=${props.onClick} aria-label=${props.label}
        style=${{ position: "absolute", right: 18, bottom: "calc(30px + env(safe-area-inset-bottom, 0px))", zIndex: 30, width: 56, height: 56, borderRadius: "var(--radius-xl)", border: "none", background: "var(--primary)", color: "var(--on-primary)", boxShadow: "var(--shadow-md)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        ${Ic(props.icon || "plus", 26)}
      </button>`;
  }

  // ── Design-system components (Button / Badge / Avatar / Input) ──
  function Button(props) {
    var size = props.size || "md";
    var pad = size === "lg" ? "0 20px" : size === "sm" ? "0 14px" : "0 16px";
    var height = size === "lg" ? 52 : size === "sm" ? 38 : 46;
    var fontSize = size === "lg" ? 16 : size === "sm" ? 13.5 : 15;
    var variant = props.variant || "primary";
    var palette = variant === "primary"
      ? { background: "var(--primary)", color: "var(--on-primary)", border: "1px solid var(--primary)" }
      : variant === "secondary"
      ? { background: "var(--surface-container-high)", color: "var(--on-surface)", border: "1px solid var(--outline-variant)" }
      : { background: "transparent", color: "var(--primary)", border: "1px solid transparent" };
    return html`
      <button onClick=${props.onClick} disabled=${props.disabled}
        style=${Object.assign({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, height: height, padding: pad, borderRadius: "var(--radius)", fontFamily: "var(--font-sans)", fontSize: fontSize, fontWeight: 600, cursor: "pointer" }, palette, props.style || {})}>
        ${props.icon}<span>${props.children}</span>
      </button>`;
  }

  function Badge(props) {
    var tone = props.tone || "primary";
    var map = {
      primary: { bg: "var(--primary-fixed)", fg: "var(--primary)" },
      secondary: { bg: "var(--secondary-container)", fg: "var(--on-secondary-container)" },
      tertiary: { bg: "var(--tertiary-container)", fg: "var(--on-tertiary-container)" },
      neutral: { bg: "var(--surface-container-high)", fg: "var(--on-surface-variant)" },
    };
    var c = map[tone] || map.primary;
    return html`
      <span style=${{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "var(--radius-full)", background: c.bg, color: c.fg, fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600 }}>
        ${props.icon}${props.children}
      </span>`;
  }

  function initials(name) {
    return window.PersonPhotoCore.initialsOf(name);
  }

  // The one avatar in the phone app. A Person's Directory Photo when they have
  // one, their initials when they do not (ADR-0029) — so teaching this about
  // photos is what puts them on the directory list, the person page and every
  // other place an avatar appears here.
  //
  // The framing comes from PersonPhotoCore, the same function the web directory
  // and the reframing preview use, so a photo somebody positioned on their
  // profile page arrives here already looking right.
  function Avatar(props) {
    var size = props.size || 40;
    var base = { width: size, height: size, borderRadius: "var(--radius-full)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" };
    if (props.photoUrl) {
      return html`
        <span style=${Object.assign({}, base, { background: "var(--surface-container-high)" })}>
          <img src=${props.photoUrl} alt=${props.name || ""}
               style=${Object.assign({ width: "100%", height: "100%" }, window.PersonPhotoCore.frameStyleObject(props.photoCrop))} />
        </span>`;
    }
    return html`
      <span style=${Object.assign({}, base, { background: "var(--primary-fixed)", color: "var(--primary)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: Math.round(size * 0.4) })}>${initials(props.name)}</span>`;
  }

  function Input(props) {
    return html`
      <label style=${{ display: "block" }}>
        ${props.label ? html`<span style=${{ display: "block", fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--on-surface-variant)", marginBottom: 6 }}>${props.label}</span>` : null}
        <input type=${props.type || "text"} placeholder=${props.placeholder} value=${props.value} defaultValue=${props.defaultValue} onInput=${props.onInput}
          onKeyDown=${props.onKeyDown} aria-invalid=${props.invalid ? "true" : null}
          style=${{ width: "100%", height: 48, padding: "0 14px", borderRadius: "var(--radius)", border: props.invalid ? "1.5px solid var(--error)" : "1px solid var(--outline-variant)", background: props.invalid ? "var(--error-container)" : "var(--surface-container-lowest)", fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--on-surface)", outline: "none" }} />
      </label>`;
  }

  function statusTone(s) {
    if (!s) return null;
    if (s.urgency === "urgent") return { label: "Urgent", color: "var(--error)", bg: "var(--error-container)", fg: "var(--on-error-container)" };
    if (s.urgency === "somewhat_urgent") return { label: "Somewhat urgent", color: "var(--warning)", bg: "var(--warning-container)", fg: "var(--on-warning-container)" };
    return { label: "Not urgent", color: "var(--success)", bg: "var(--success-container)", fg: "var(--on-success-container)" };
  }

  M.ui = {
    Screen: Screen, TopBar: TopBar, BarAction: BarAction, Body: Body,
    Overline: Overline, SerifHead: SerifHead, Row: Row, CardList: CardList,
    Medallion: Medallion, SearchBar: SearchBar, FAB: FAB,
    Button: Button, Badge: Badge, Avatar: Avatar, Input: Input,
    statusTone: statusTone,
  };
})();
