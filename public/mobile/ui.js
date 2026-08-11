/* ============================================================
   ui.js — the phone's components. Exposed on M.ui.

   ⚠ THE STYLING LIVES IN mobile/tokens.css, WHICH IS GENERATED.
   Every component below renders the shared `m-*` classes defined in
   build/design-components.mjs — the same classes the desktop pages use
   and the same ones the design system on claude.ai documents. There is
   one definition of a Button; this file decides its markup and its
   behaviour, not its look.

   Inline styles remain only where the value is genuinely per-instance
   (an avatar's pixel size) or shell-specific (safe-area insets, the
   scroll container). Anything a designer would recognise as a component
   is a class, or the two ends drift again.
   ============================================================ */
(function () {
  "use strict";
  var html = M.html, Ic = M.Ic, Icon = M.Icon;

  /** Join class names, dropping the falsey ones. */
  function cx() {
    return Array.prototype.filter.call(arguments, Boolean).join(" ");
  }

  // ── Layout ────────────────────────────────────────────────
  // Shell furniture: the safe-area maths and the scroll container are
  // the phone's own problem and have no desktop counterpart.
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
          <button class="m-icon-btn m-icon-btn--lg" onClick=${onLeft} aria-label=${props.onBack ? "Back" : "Menu"}>
            ${Ic(props.onBack ? "chevron-left" : "menu", 24)}
          </button>
          <h1 style=${{ flex: 1, margin: 0, minWidth: 0, fontFamily: serif ? "var(--font-display)" : "var(--font-serif)", fontSize: serif ? 17 : 20, fontWeight: 600, letterSpacing: serif ? "0.06em" : "0.01em", color: "var(--on-surface)", textTransform: serif ? "uppercase" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>${props.title}</h1>
          <div style=${{ display: "flex", alignItems: "center", gap: 2 }}>${props.right}</div>
        </div>
      </header>`;
  }

  function BarAction(props) {
    return html`
      <button class="m-icon-btn m-icon-btn--lg" onClick=${props.onClick} aria-label=${props.label}
        style=${{ position: "relative" }}>
        ${Ic(props.icon, 22)}
        ${props.badge ? html`<span class="m-count" >${props.badge}</span>` : null}
      </button>`;
  }

  function Body(props) {
    return html`<div style=${Object.assign({ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }, props.style || {})}>${props.children}</div>`;
  }

  // ── Typography ────────────────────────────────────────────
  function Overline(props) {
    return html`<div class="m-label" style=${props.style || null}>${props.children}</div>`;
  }

  function SerifHead(props) {
    // A caller may still ask for a specific size; the class carries the default.
    return html`<h2 class="m-serif-head" style=${Object.assign({}, props.size ? { fontSize: props.size } : null, props.style || {})}>${props.children}</h2>`;
  }

  // ── Lists ─────────────────────────────────────────────────
  function Row(props) {
    var showChevron = props.trailing === undefined || props.trailing === "chevron";
    return html`
      <button class=${cx("m-row", props.onClick && "m-row--interactive", props.titleSerif && "m-row--serif", props.isLast && "m-row--last")}
        onClick=${props.onClick} style=${props.onClick ? null : { cursor: "default" }}>
        ${props.leading}
        <div class="m-row__main">
          <div class="m-row__title">${props.title}</div>
          ${props.subtitle ? html`<div class="m-row__sub">${props.subtitle}</div>` : null}
        </div>
        ${props.meta ? html`<span class="m-row__meta">${props.meta}</span>` : null}
        ${showChevron && props.onClick ? html`<span class="m-row__chevron">${Ic("chevron-right", 18)}</span>` : (!showChevron ? props.trailing : null)}
      </button>`;
  }

  function CardList(props) {
    return html`<div class="m-card-list" style=${Object.assign({ padding: 0 }, props.style || {})}>${props.children}</div>`;
  }

  function Medallion(props) {
    // Size is per-instance, so it stays inline; the rest is the class.
    var size = props.size || 40;
    return html`<span class=${cx("m-medallion", props.tone === "tint" && "m-medallion--tint")}
      style=${{ width: size, height: size, marginBottom: 0 }}>${Ic(props.icon, Math.round(size * 0.5))}</span>`;
  }

  function SearchBar(props) {
    return html`
      <label class="m-search">
        ${Ic("search", 18)}
        <input value=${props.value} onInput=${props.onChange} placeholder=${props.placeholder || "Search"} />
      </label>`;
  }

  function FAB(props) {
    // Position is the shell's; the button itself is the shared component.
    return html`
      <button class="m-icon-btn m-icon-btn--fab" onClick=${props.onClick} aria-label=${props.label}
        style=${{ position: "absolute", right: 18, bottom: "calc(30px + env(safe-area-inset-bottom, 0px))", zIndex: 30 }}>
        ${Ic(props.icon || "plus", 26)}
      </button>`;
  }

  // ── Design-system components ──────────────────────────────
  function Button(props) {
    return html`
      <button class=${cx("m-btn", "m-btn--" + (props.variant || "primary"), props.size && props.size !== "md" && "m-btn--" + props.size)}
        onClick=${props.onClick} disabled=${props.disabled} style=${props.style || null}>
        ${props.icon}<span>${props.children}</span>
      </button>`;
  }

  function Badge(props) {
    return html`
      <span class=${cx("m-badge", "m-badge--" + (props.tone || "primary"))} style=${props.style || null}>
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
    // Size is per-instance and drives the initials' size, so both stay inline.
    var sizing = { width: size, height: size, fontSize: Math.round(size * 0.4) };
    if (props.photoUrl) {
      return html`
        <span class="m-avatar" style=${Object.assign({}, sizing, { background: "var(--surface-container-high)" })}>
          <img src=${props.photoUrl} alt=${props.name || ""}
               style=${Object.assign({ width: "100%", height: "100%" }, window.PersonPhotoCore.frameStyleObject(props.photoCrop))} />
        </span>`;
    }
    return html`<span class="m-avatar" style=${sizing}>${initials(props.name)}</span>`;
  }

  function Input(props) {
    return html`
      <label class="m-field">
        ${props.label ? html`<span class="m-label" style=${{ display: "block", marginBottom: 6 }}>${props.label}</span>` : null}
        <input class=${cx("m-input", props.invalid && "m-input--invalid")}
          type=${props.type || "text"} placeholder=${props.placeholder} value=${props.value}
          defaultValue=${props.defaultValue} onInput=${props.onInput}
          onKeyDown=${props.onKeyDown} aria-invalid=${props.invalid ? "true" : null} />
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
