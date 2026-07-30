/* @ds-bundle: {"format":3,"namespace":"MosaicChurchDesignSystem_f2292e","components":[{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Avatar","sourcePath":"components/display/Avatar.jsx"},{"name":"Badge","sourcePath":"components/display/Badge.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"NavCard","sourcePath":"components/display/NavCard.jsx"},{"name":"ScriptureBlock","sourcePath":"components/display/ScriptureBlock.jsx"},{"name":"SectionLabel","sourcePath":"components/display/SectionLabel.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"}],"sourceHashes":{"components/core/Button.jsx":"2c3ad7414dcb","components/core/IconButton.jsx":"3c4999c02f6f","components/display/Avatar.jsx":"58e69f65df33","components/display/Badge.jsx":"b8424d23f52a","components/display/Card.jsx":"ff7660e54df2","components/display/NavCard.jsx":"f7f3961a2a9c","components/display/ScriptureBlock.jsx":"91f00b986d6a","components/display/SectionLabel.jsx":"cdaae6566b78","components/forms/Checkbox.jsx":"35590571bd61","components/forms/Input.jsx":"7a9cc399766c","components/forms/Select.jsx":"1a196c9dc28e","ui_kits/hymn_directory/HymnDirectory.jsx":"8b06a9d68058","ui_kits/public_directory/Dashboard.jsx":"8fc2d9443891","ui_kits/public_directory/LoginScreen.jsx":"e038d2826879"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.MosaicChurchDesignSystem_f2292e = window.MosaicChurchDesignSystem_f2292e || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mosaic Button — the primary action element.
 * Primary = navy fill / cream text; secondary = ocean outline;
 * ghost = text only; danger = brand red. Labels use tracked caps
 * for a formal, balanced feel. Corners are soft (10px).
 */
function Button({
  children,
  variant = "primary",
  size = "md",
  icon = null,
  iconRight = null,
  disabled = false,
  type = "button",
  onClick,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: {
      padding: "8px 14px",
      fontSize: "12px"
    },
    md: {
      padding: "11px 20px",
      fontSize: "13px"
    },
    lg: {
      padding: "14px 26px",
      fontSize: "14px"
    }
  };
  const variants = {
    primary: {
      background: "var(--primary)",
      color: "var(--on-primary)",
      border: "1px solid var(--primary)"
    },
    secondary: {
      background: "transparent",
      color: "var(--secondary)",
      border: "1px solid var(--secondary)"
    },
    ghost: {
      background: "transparent",
      color: "var(--on-surface-variant)",
      border: "1px solid transparent"
    },
    danger: {
      background: "var(--error)",
      color: "var(--on-error)",
      border: "1px solid var(--error)"
    }
  };
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    fontFamily: "var(--font-sans)",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    borderRadius: "var(--radius)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    boxShadow: variant === "primary" || variant === "danger" ? "var(--shadow-xs)" : "none",
    transition: "background var(--duration) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), color var(--duration) var(--ease-standard)",
    whiteSpace: "nowrap",
    ...sizes[size],
    ...variants[variant],
    ...style
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    style: base,
    onMouseDown: e => {
      if (!disabled) e.currentTarget.style.transform = "scale(0.98)";
    },
    onMouseUp: e => {
      e.currentTarget.style.transform = "scale(1)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.transform = "scale(1)";
    }
  }, rest), icon, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mosaic IconButton — a square, soft-cornered button holding a single
 * Lucide icon. Used for toolbar actions, close buttons, and the
 * navy floating action button (variant="fab").
 */
function IconButton({
  icon,
  variant = "ghost",
  size = "md",
  label,
  disabled = false,
  onClick,
  style = {},
  ...rest
}) {
  const dims = {
    sm: 32,
    md: 40,
    lg: 48,
    fab: 56
  };
  const box = dims[size] || dims.md;
  const variants = {
    ghost: {
      background: "transparent",
      color: "var(--on-surface-variant)",
      border: "1px solid transparent"
    },
    outline: {
      background: "var(--surface-container-lowest)",
      color: "var(--on-surface-variant)",
      border: "1px solid var(--outline-variant)"
    },
    primary: {
      background: "var(--primary)",
      color: "var(--on-primary)",
      border: "1px solid var(--primary)"
    },
    fab: {
      background: "var(--primary)",
      color: "var(--on-primary)",
      border: "1px solid var(--primary)"
    }
  };
  const isFab = variant === "fab";
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onClick: onClick,
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: box,
      height: box,
      borderRadius: isFab ? "var(--radius-xl)" : "var(--radius)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      boxShadow: isFab ? "var(--shadow-md)" : "none",
      transition: "background var(--duration) var(--ease-standard), color var(--duration) var(--ease-standard)",
      ...variants[variant],
      ...style
    },
    onMouseEnter: e => {
      if (disabled) return;
      if (variant === "ghost") e.currentTarget.style.background = "var(--surface-container)";
    },
    onMouseLeave: e => {
      if (variant === "ghost") e.currentTarget.style.background = "transparent";
    }
  }, rest), icon);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/display/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mosaic Avatar — a circular initials/photo chip. When no image is
 * provided it renders the person's initials on a navy tile.
 */
function Avatar({
  name = "",
  src,
  size = 40,
  style = {},
  ...rest
}) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
  return /*#__PURE__*/React.createElement("span", _extends({
    title: name,
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: size,
      height: size,
      borderRadius: "var(--radius-full)",
      background: src ? "transparent" : "var(--primary)",
      color: "var(--on-primary)",
      fontFamily: "var(--font-sans)",
      fontWeight: 600,
      fontSize: size * 0.4,
      overflow: "hidden",
      flexShrink: 0,
      border: "1px solid var(--outline-variant)",
      ...style
    }
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    }
  }) : initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mosaic Badge — a small, rectangular tag with the tracked-caps label
 * style. Light tints of the palette denote categories (a theological
 * theme, a ministry area). Tones: neutral, primary, secondary,
 * tertiary, success, warning, error.
 */
function Badge({
  children,
  tone = "secondary",
  icon = null,
  style = {},
  ...rest
}) {
  const tones = {
    neutral: {
      bg: "var(--surface-container-high)",
      fg: "var(--on-surface-variant)"
    },
    primary: {
      bg: "var(--primary-fixed)",
      fg: "var(--primary)"
    },
    secondary: {
      bg: "var(--secondary-container)",
      fg: "var(--on-secondary-container)"
    },
    tertiary: {
      bg: "var(--tertiary-container)",
      fg: "var(--on-tertiary-container)"
    },
    success: {
      bg: "#DCEDE3",
      fg: "#2E5C45"
    },
    warning: {
      bg: "#F3E6C8",
      fg: "#7A5A15"
    },
    error: {
      bg: "var(--error-container)",
      fg: "var(--on-error-container)"
    }
  };
  const t = tones[tone] || tones.secondary;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      padding: "4px 10px",
      background: t.bg,
      color: t.fg,
      fontFamily: "var(--font-sans)",
      fontSize: "12px",
      fontWeight: 600,
      letterSpacing: "0.02em",
      borderRadius: "var(--radius-sm)",
      lineHeight: 1.2,
      whiteSpace: "nowrap",
      ...style
    }
  }, rest), icon, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mosaic Card — the fundamental container. Flat by default with a 1px
 * warm hairline border (no shadow), on the lowest surface. When
 * `interactive`, it lifts with a soft ambient shadow on hover.
 */
function Card({
  children,
  interactive = false,
  padding = "var(--space-md)",
  as = "div",
  style = {},
  ...rest
}) {
  const Tag = as;
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement(Tag, _extends({
    onMouseEnter: interactive ? () => setHover(true) : undefined,
    onMouseLeave: interactive ? () => setHover(false) : undefined,
    style: {
      background: "var(--surface-container-lowest)",
      border: "1px solid var(--outline-variant)",
      borderRadius: "var(--radius-xl)",
      padding,
      boxShadow: interactive && hover ? "var(--shadow-sm)" : "none",
      transition: "box-shadow var(--duration-slow) var(--ease-standard)",
      cursor: interactive ? "pointer" : "default",
      display: "block",
      color: "var(--on-surface)",
      textDecoration: "none",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/NavCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mosaic NavCard — the centered feature/navigation card used across
 * the dashboard. A circular icon medallion (fills navy-tint on hover),
 * a serif title, and a one-line description. Renders as a link.
 */
function NavCard({
  icon,
  title,
  description,
  href = "#",
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("a", _extends({
    href: href,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      gap: "10px",
      padding: "var(--space-lg) var(--space-md)",
      background: "var(--surface-container-lowest)",
      border: "1px solid var(--outline-variant)",
      borderRadius: "var(--radius-xl)",
      textDecoration: "none",
      color: "var(--on-surface)",
      boxShadow: hover ? "var(--shadow-sm)" : "none",
      transition: "box-shadow var(--duration-slow) var(--ease-standard)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 64,
      height: 64,
      borderRadius: "var(--radius-full)",
      background: hover ? "var(--primary-fixed)" : "var(--surface-container)",
      color: "var(--primary)",
      marginBottom: "4px",
      transition: "background var(--duration-slow) var(--ease-standard)"
    }
  }, icon), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-serif)",
      fontSize: "22px",
      fontWeight: 600,
      lineHeight: 1.2,
      color: "var(--on-surface)"
    }
  }, title), description && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "15px",
      lineHeight: 1.5,
      color: "var(--on-surface-variant)"
    }
  }, description));
}
Object.assign(__ds_scope, { NavCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/NavCard.jsx", error: String((e && e.message) || e) }); }

// components/display/ScriptureBlock.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mosaic ScriptureBlock — a signature element for Bible verses. Set in
 * EB Garamond italic, with a gold vertical divider on the left to mark
 * it as a sacred quote. Optional reference shown as a tracked-caps
 * citation beneath.
 */
function ScriptureBlock({
  children,
  reference,
  center = false,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("figure", _extends({
    style: {
      margin: 0,
      borderLeft: "2px solid var(--gold)",
      padding: "4px 0 4px var(--space-md)",
      textAlign: center ? "center" : "left",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("blockquote", {
    style: {
      margin: 0,
      fontFamily: "var(--font-serif)",
      fontStyle: "italic",
      fontSize: "var(--body-lg-size)",
      lineHeight: 1.7,
      color: "var(--on-surface)"
    }
  }, children), reference && /*#__PURE__*/React.createElement("figcaption", {
    style: {
      marginTop: "10px",
      fontFamily: "var(--font-sans)",
      fontSize: "11px",
      fontWeight: 600,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "var(--on-surface-variant)"
    }
  }, reference));
}
Object.assign(__ds_scope, { ScriptureBlock });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/ScriptureBlock.jsx", error: String((e && e.message) || e) }); }

// components/display/SectionLabel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mosaic SectionLabel — a small tracked-caps overline used as a
 * structural anchor above titles and field groups. Optional thin rule.
 */
function SectionLabel({
  children,
  rule = false,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "11px",
      fontWeight: 600,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: "var(--on-surface-variant)",
      whiteSpace: "nowrap"
    }
  }, children), rule && /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: "var(--outline-variant)"
    }
  }));
}
Object.assign(__ds_scope, { SectionLabel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/SectionLabel.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mosaic Checkbox — a soft-cornered box that fills navy when checked
 * with a cream check. Optional label sits to the right.
 */
function Checkbox({
  checked = false,
  onChange,
  label,
  disabled = false,
  id,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "10px",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      fontFamily: "var(--font-sans)",
      fontSize: "15px",
      color: "var(--on-surface)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 20,
      height: 20,
      borderRadius: "var(--radius-sm)",
      background: checked ? "var(--primary)" : "var(--surface-container-lowest)",
      border: `1px solid ${checked ? "var(--primary)" : "var(--outline)"}`,
      transition: "background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard)",
      flexShrink: 0
    }
  }, checked && /*#__PURE__*/React.createElement("i", {
    "data-lucide": "check",
    style: {
      width: 14,
      height: 14,
      color: "var(--on-primary)"
    }
  })), /*#__PURE__*/React.createElement("input", _extends({
    id: id,
    type: "checkbox",
    checked: checked,
    onChange: onChange,
    disabled: disabled,
    style: {
      position: "absolute",
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * Mosaic Input — a labelled text field. 1px warm border on all sides;
 * on focus the border transitions to steel-teal (tertiary) with a soft
 * ring. Label uses tracked caps. Sits on the low surface tint.
 */
function Input({
  label,
  value,
  defaultValue,
  onChange,
  placeholder,
  type = "text",
  id,
  disabled = false,
  error,
  icon = null,
  style = {},
  ...rest
}) {
  const [focused, setFocused] = useState(false);
  const showError = Boolean(error);
  const borderColor = showError ? "var(--error)" : focused ? "var(--tertiary)" : "var(--outline-variant)";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "11px",
      fontWeight: 600,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "var(--on-surface-variant)"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "flex",
      alignItems: "center"
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 12,
      display: "inline-flex",
      color: "var(--on-surface-variant)",
      pointerEvents: "none"
    }
  }, icon), /*#__PURE__*/React.createElement("input", _extends({
    id: id,
    type: type,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    style: {
      width: "100%",
      padding: icon ? "11px 14px 11px 38px" : "11px 14px",
      background: disabled ? "var(--surface-container)" : "var(--surface-container-low)",
      border: `1px solid ${borderColor}`,
      borderRadius: "var(--radius)",
      outline: "none",
      fontFamily: "var(--font-sans)",
      fontSize: "15px",
      color: "var(--on-surface)",
      boxShadow: focused && !showError ? "0 0 0 3px rgba(93,148,169,0.18)" : "none",
      transition: "border-color var(--duration) var(--ease-standard), box-shadow var(--duration) var(--ease-standard)"
    }
  }, rest))), showError && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "12px",
      color: "var(--error)"
    }
  }, error));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Mosaic Select — a native dropdown styled to match Input. Warm
 * border, soft corners, tracked-caps label, custom chevron.
 */
function Select({
  label,
  value,
  defaultValue,
  onChange,
  options = [],
  id,
  disabled = false,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "11px",
      fontWeight: 600,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "var(--on-surface-variant)"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "flex",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: id,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    disabled: disabled,
    style: {
      appearance: "none",
      WebkitAppearance: "none",
      width: "100%",
      padding: "11px 38px 11px 14px",
      background: disabled ? "var(--surface-container)" : "var(--surface-container-lowest)",
      border: "1px solid var(--outline-variant)",
      borderRadius: "var(--radius)",
      outline: "none",
      fontFamily: "var(--font-sans)",
      fontSize: "15px",
      color: "var(--on-surface)",
      cursor: disabled ? "not-allowed" : "pointer"
    }
  }, rest), options.map(opt => {
    const val = typeof opt === "string" ? opt : opt.value;
    const lbl = typeof opt === "string" ? opt : opt.label;
    return /*#__PURE__*/React.createElement("option", {
      key: val,
      value: val
    }, lbl);
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      right: 12,
      display: "inline-flex",
      color: "var(--on-surface-variant)",
      pointerEvents: "none"
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "chevron-down",
    style: {
      width: 18,
      height: 18
    }
  }))));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// ui_kits/hymn_directory/HymnDirectory.jsx
try { (() => {
/* Mosaic — Hymn Directory / "Hymn Lookup" (cosmetic recreation) */
function HymnDirectory() {
  const {
    Input,
    Select,
    Badge,
    Card,
    IconButton
  } = window.MosaicChurchDesignSystem_f2292e;
  const tags = [["Abiding in Christ", 24], ["Assurance", 18], ["Atonement", 42], ["Baptism", 12], ["Call to Worship", 36], ["Comfort", 29], ["Communion", 15], ["Creation", 21], ["Eternal Life", 31], ["Faith & Trust", 55], ["Grace", 48], ["Holy Spirit", 22]];
  const [active, setActive] = React.useState("Assurance");
  const hymns = [{
    title: "A Mighty Fortress Is Our God",
    author: "Martin Luther",
    tune: "EIN FESTE BURG",
    tags: ["Assurance", "Faith & Trust", "God's Word"]
  }, {
    title: "Blessed Assurance",
    author: "Fanny J. Crosby",
    tune: "ASSURANCE",
    tags: ["Assurance", "Praise", "Salvation"]
  }, {
    title: "It Is Well with My Soul",
    author: "Horatio G. Spafford",
    tune: "VILLE DU HAVRE",
    tags: ["Assurance", "Comfort", "Peace"]
  }, {
    title: "My Hope Is Built on Nothing Less",
    author: "Edward Mote",
    tune: "SOLID ROCK",
    tags: ["Assurance", "Christ our Rock", "Faith & Trust"]
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("header", {
    style: {
      borderBottom: "1px solid var(--outline-variant)",
      background: "var(--surface)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1120,
      margin: "0 auto",
      padding: "16px 32px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/mosaic-icon.png",
    alt: "Mosaic",
    style: {
      height: 40
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-serif)",
      fontSize: 20,
      fontWeight: 600,
      color: "var(--primary)"
    }
  }, "Mosaic Church")), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "var(--font-sans)",
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "var(--primary)",
      textDecoration: "none"
    }
  }, "Log In ", /*#__PURE__*/React.createElement("i", {
    "data-lucide": "log-in",
    style: {
      width: 15,
      height: 15
    }
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1120,
      margin: "0 auto",
      padding: "48px 32px 64px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: 32
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 46,
      fontWeight: 600,
      letterSpacing: "0.02em",
      color: "var(--primary)",
      margin: "0 0 12px"
    }
  }, "Hymn Lookup"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 17,
      lineHeight: 1.6,
      color: "var(--on-surface-variant)",
      maxWidth: 640,
      margin: "0 auto"
    }
  }, "Search and explore the catalog of hymns arranged for our Sunday service. Use tags to filter by theological theme or scriptural reference.")), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 720,
      margin: "0 auto 40px",
      display: "flex",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Search by title, lyrics, or author\u2026",
    icon: /*#__PURE__*/React.createElement("i", {
      "data-lucide": "search",
      style: {
        width: 18,
        height: 18
      }
    }),
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      display: "inline-flex",
      alignItems: "center",
      padding: "0 26px",
      background: "var(--primary)",
      color: "var(--on-primary)",
      borderRadius: "var(--radius)",
      fontFamily: "var(--font-sans)",
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      textDecoration: "none",
      boxShadow: "var(--shadow-xs)"
    }
  }, "Search")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "260px 1fr",
      gap: 32,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "0",
    style: {
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "16px 18px",
      borderBottom: "1px solid var(--outline-variant)"
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "sliders-horizontal",
    style: {
      width: 18,
      height: 18,
      color: "var(--primary)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-serif)",
      fontSize: 19,
      fontWeight: 600,
      color: "var(--on-surface)"
    }
  }, "Filter by Tags")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 8
    }
  }, tags.map(([name, count]) => {
    const on = active === name;
    return /*#__PURE__*/React.createElement("button", {
      key: name,
      onClick: () => setActive(name),
      style: {
        width: "100%",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 12px",
        background: on ? "var(--primary-fixed)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        fontSize: 14,
        color: on ? "var(--primary)" : "var(--on-surface)",
        fontWeight: on ? 600 : 400
      }
    }, /*#__PURE__*/React.createElement("span", null, name), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: on ? "var(--primary)" : "var(--on-surface-variant)",
        fontVariantNumeric: "tabular-nums"
      }
    }, count));
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 14,
      color: "var(--on-surface-variant)"
    }
  }, "Showing ", hymns.length * 4 + 2, " results for ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--on-surface)"
    }
  }, "\"", active, "\"")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 13,
      color: "var(--on-surface-variant)"
    }
  }, "Sort by"), /*#__PURE__*/React.createElement(Select, {
    options: ["Alphabetical", "Recently added", "Most used"],
    style: {
      width: 190
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, hymns.map(h => /*#__PURE__*/React.createElement(Card, {
    key: h.title,
    interactive: true,
    style: {
      padding: 22
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontFamily: "var(--font-serif)",
      fontSize: 26,
      fontWeight: 600,
      color: "var(--primary)",
      margin: "0 0 8px"
    }
  }, h.title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 20,
      marginBottom: 14,
      fontFamily: "var(--font-sans)",
      fontSize: 14,
      color: "var(--on-surface-variant)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "user",
    style: {
      width: 14,
      height: 14
    }
  }), " ", h.author), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "music",
    style: {
      width: 14,
      height: 14
    }
  }), " ", h.tune)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, h.tags.map(t => /*#__PURE__*/React.createElement(Badge, {
    key: t,
    tone: "secondary"
  }, t))))))))));
}
window.HymnDirectory = HymnDirectory;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/hymn_directory/HymnDirectory.jsx", error: String((e && e.message) || e) }); }

// ui_kits/public_directory/Dashboard.jsx
try { (() => {
/* Mosaic — Public Directory dashboard (cosmetic recreation) */
function Dashboard({
  signedIn,
  onSignOut
}) {
  const {
    NavCard,
    Card,
    Badge,
    SectionLabel,
    IconButton,
    Avatar
  } = window.MosaicChurchDesignSystem_f2292e;
  const Ic = (n, s = 30) => /*#__PURE__*/React.createElement("i", {
    "data-lucide": n,
    style: {
      width: s,
      height: s
    }
  });
  const cards = [{
    icon: "book-open",
    title: "Hymn Directory",
    description: "Browse & download musical selections."
  }, {
    icon: "calendar",
    title: "Service Calendar",
    description: "View upcoming and past service dates."
  }, {
    icon: "bar-chart-3",
    title: "Service Analytics",
    description: "Insights into historical services."
  }, ...(signedIn ? [{
    icon: "users",
    title: "People's Directory",
    description: "Browse the church directory."
  }, {
    icon: "library",
    title: "Hymn Manager",
    description: "Add & edit the hymn catalog."
  }, {
    icon: "shield",
    title: "Shepherd Dashboard",
    description: "Elder tools & member care."
  }] : [])];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1200,
      margin: "0 auto",
      width: "100%",
      padding: "16px 32px 32px",
      display: "flex",
      flexDirection: "column",
      gap: 28
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "center",
      gap: 12,
      minHeight: 40
    }
  }, signedIn ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: "John Harris",
    size: 34
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 14,
      color: "var(--on-surface)"
    }
  }, "John Harris"), /*#__PURE__*/React.createElement("button", {
    onClick: onSignOut,
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: "var(--on-surface-variant)"
    }
  }, "Sign out")) : /*#__PURE__*/React.createElement("button", {
    onClick: onSignOut,
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: "var(--primary)"
    }
  }, "Log In")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/mosaic-logo.png",
    alt: "Mosaic Church",
    style: {
      height: 84,
      width: 84,
      objectFit: "contain"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "2fr 1fr",
      gap: 28,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "18px 32px",
      position: "relative",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 32,
      fontWeight: 600,
      letterSpacing: "0.02em",
      color: "var(--primary)",
      margin: 0
    }
  }, signedIn ? "Good morning, John" : "Good morning"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "var(--font-sans)",
      fontSize: 14,
      color: "var(--on-surface-variant)"
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "clock",
    style: {
      width: 18,
      height: 18
    }
  }), " Upcoming: The Refuge of God"), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      right: -48,
      top: -64,
      width: 160,
      height: 160,
      border: "1px solid var(--outline-variant)",
      borderRadius: "9999px",
      opacity: 0.2,
      pointerEvents: "none"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 24
    }
  }, cards.map(c => /*#__PURE__*/React.createElement(NavCard, {
    key: c.title,
    icon: Ic(c.icon),
    title: c.title,
    description: c.description,
    href: "#"
  })))), /*#__PURE__*/React.createElement(Card, {
    padding: "0",
    style: {
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "18px 20px 14px",
      borderBottom: "1px solid var(--surface-variant)"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: "var(--font-serif)",
      fontSize: 22,
      fontWeight: 600,
      color: "var(--primary)",
      margin: 0
    }
  }, "Sunday at a Glance")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      display: "flex",
      flexDirection: "column",
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SectionLabel, {
    style: {
      marginBottom: 4
    }
  }, "Theme"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-serif)",
      fontSize: 18,
      fontWeight: 600,
      color: "var(--primary)"
    }
  }, "The Refuge of God")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SectionLabel, {
    style: {
      marginBottom: 4
    }
  }, "Preacher"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 15,
      color: "var(--on-surface)"
    }
  }, "Rev. Daniel Weiss")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SectionLabel, {
    rule: true,
    style: {
      marginBottom: 8
    }
  }, "Roles"), [["Service Leader", "Mark Ellis"], ["Music Leader", "Grace Okafor"]].map(([r, n]) => /*#__PURE__*/React.createElement("div", {
    key: r,
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontFamily: "var(--font-sans)",
      fontSize: 14,
      padding: "3px 0"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--on-surface-variant)"
    }
  }, r), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--on-surface)",
      fontWeight: 500
    }
  }, n)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "tertiary",
    icon: /*#__PURE__*/React.createElement("i", {
      "data-lucide": "droplet",
      style: {
        width: 13,
        height: 13
      }
    })
  }, "Baptism"), /*#__PURE__*/React.createElement(Badge, {
    tone: "secondary"
  }, "Communion")), signedIn && /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      background: "var(--primary)",
      color: "var(--on-primary)",
      padding: "11px 16px",
      borderRadius: "var(--radius)",
      fontFamily: "var(--font-sans)",
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      textDecoration: "none",
      boxShadow: "var(--shadow-xs)"
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "edit-3",
    style: {
      width: 16,
      height: 16
    }
  }), " Open in Service Editor")))), signedIn && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      right: 28,
      bottom: 28
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    variant: "fab",
    size: "fab",
    icon: /*#__PURE__*/React.createElement("i", {
      "data-lucide": "list-plus",
      style: {
        width: 22,
        height: 22
      }
    }),
    label: "New service"
  })));
}
window.Dashboard = Dashboard;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/public_directory/Dashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/public_directory/LoginScreen.jsx
try { (() => {
/* Mosaic — Public Directory login screen (cosmetic recreation) */
function LoginScreen({
  onLogin
}) {
  const {
    Button,
    Input
  } = window.MosaicChurchDesignSystem_f2292e;
  const [mode, setMode] = React.useState("login");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      padding: "48px 24px",
      position: "relative",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      right: -48,
      top: -48,
      width: 256,
      height: 256,
      border: "1px solid var(--outline-variant)",
      borderRadius: "9999px",
      opacity: 0.25,
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: -48,
      bottom: -48,
      width: 192,
      height: 192,
      border: "1px solid var(--outline-variant)",
      borderRadius: "9999px",
      opacity: 0.15,
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      maxWidth: 420,
      background: "var(--surface-container-lowest)",
      border: "1px solid var(--outline-variant)",
      borderRadius: "var(--radius-xl)",
      padding: 48,
      boxShadow: "var(--shadow-sm)",
      position: "relative",
      zIndex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "center",
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/mosaic-logo.png",
    alt: "Mosaic Church",
    style: {
      height: 72,
      width: 72,
      objectFit: "contain"
    }
  })), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 34,
      fontWeight: 600,
      letterSpacing: "0.02em",
      color: "var(--primary)",
      textAlign: "center",
      margin: "0 0 28px"
    }
  }, mode === "login" ? "Log In" : "Sign Up"), /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      onLogin();
    },
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Email Address",
    type: "email",
    placeholder: "email@example.com",
    defaultValue: "pastor@mosaiccs.org"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Password",
    type: "password",
    placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
    defaultValue: "mosaic"
  }), mode === "signup" && /*#__PURE__*/React.createElement(Input, {
    label: "Confirm Password",
    type: "password",
    placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    type: "submit",
    style: {
      marginTop: 8,
      width: "100%"
    }
  }, mode === "login" ? "Access Portal" : "Create Account")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 28,
      display: "flex",
      flexDirection: "column",
      gap: 16,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setMode(mode === "login" ? "signup" : "login"),
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: "var(--secondary)"
    }
  }, mode === "login" ? "Don't have an account? Sign Up" : "Already have an account? Log In"), /*#__PURE__*/React.createElement("button", {
    onClick: onLogin,
    style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      fontFamily: "var(--font-sans)",
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: "var(--on-surface-variant)"
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "arrow-left",
    style: {
      width: 14,
      height: 14
    }
  }), " Back to Public Directory"))));
}
window.LoginScreen = LoginScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/public_directory/LoginScreen.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.NavCard = __ds_scope.NavCard;

__ds_ns.ScriptureBlock = __ds_scope.ScriptureBlock;

__ds_ns.SectionLabel = __ds_scope.SectionLabel;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

})();
