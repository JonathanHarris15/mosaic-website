/* ============================================================
   core.js — mobile shell runtime.
   Binds htm to Preact and exposes a single window.M namespace that
   every other mobile module uses. No build step: preact / preactHooks
   / htm / lucide are loaded as UMD globals before this file.
   ============================================================ */
(function () {
  "use strict";
  var h = preact.h;
  var html = htm.bind(h);

  // kebab-case ("chevron-left", "bar-chart-3") -> PascalCase ("ChevronLeft", "BarChart3")
  function pascal(name) {
    return String(name)
      .split("-")
      .map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); })
      .join("");
  }

  // Lucide icon component. Icons are [tag, attrs] child specs on window.lucide.
  function Icon(props) {
    var name = props.name, size = props.size || 22;
    var data = (window.lucide || {})[pascal(name)];
    var kids = (data || []).map(function (node) { return h(node[0], node[1]); });
    return h("svg", {
      width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      stroke: props.color || "currentColor",
      "stroke-width": props.strokeWidth || 2,
      "stroke-linecap": "round", "stroke-linejoin": "round",
      style: props.style || {},
      "aria-hidden": "true",
    }, kids);
  }

  // Convenience: Ic(name, size) -> vnode, mirroring the design's helper.
  function Ic(name, size) { return h(Icon, { name: name, size: size }); }

  // Load async data inside a component. Returns { loading, data, error }.
  function useAsync(fn, deps) {
    var st = preactHooks.useState({ loading: true, data: null, error: null });
    preactHooks.useEffect(function () {
      var alive = true;
      st[1]({ loading: true, data: null, error: null });
      Promise.resolve().then(fn).then(
        function (d) { if (alive) st[1]({ loading: false, data: d, error: null }); },
        function (e) { if (alive) st[1]({ loading: false, data: null, error: e }); }
      );
      return function () { alive = false; };
    }, deps || []);
    return st[0];
  }

  window.M = {
    h: h,
    html: html,
    render: preact.render,
    Fragment: preact.Fragment,
    hooks: preactHooks,
    useAsync: useAsync,
    Icon: Icon,
    Ic: Ic,
  };
})();
