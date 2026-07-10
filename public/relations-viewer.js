/**
 * @fileoverview Relations Viewer — the elder-only interactive relationship graph
 * (MS-91 / MS-95). Ported from the Cloud Design "Relations Viewer.dc.html": the
 * canvas physics engine is kept verbatim; the placeholder buildData() is replaced
 * by real Firestore loaders (people, families, relationships, relationship_types),
 * and the DC template chrome is rebuilt as plain DOM with event delegation.
 *
 * Data model (ADR-0013): relationships are DERIVED, never stored. Edges =
 *   Family (spouse + parent→child, from `families`) +
 *   Elder Assignment (member→elder, from shepherding.assignedElderId) +
 *   Custom Relationships (one edge-type per `relationship_types` doc).
 * Elder-ness is interim-resolved from the `elder` User role (users.personId);
 * MS-92 will replace that with the projected Elder Tag.
 */
(function () {
  'use strict';

  // Membership-stage pips (colours are design-chosen; labels mirror ShepherdingCore).
  var STAGE = {
    visitor:            { label: 'Visitor',            color: '#C2B79D' },
    regular_attender:   { label: 'Regular Attender',   color: '#5D94A9' },
    prospective_member: { label: 'Prospective Member', color: '#3E6181' },
    member:             { label: 'Member',             color: '#182F57' },
    moving_membership:  { label: 'Moving Membership',  color: '#B89B6A' },
    previous_member:    { label: 'Previous Member',    color: '#8A93A6' },
  };
  var STAGE_ORDER = ['visitor', 'regular_attender', 'prospective_member', 'member', 'moving_membership', 'previous_member'];
  var STAGE_FALLBACK = { label: '—', color: '#8A93A6' };

  // Colour/dash palette cycled across the elder-defined custom Relationship Types.
  var CUSTOM_PALETTE = [
    { color: '#B89B6A', css: 'dashed', dash: [8, 6],   rest: 150 },
    { color: '#A26B5B', css: 'dotted', dash: [1.5, 6], rest: 160 },
    { color: '#4B8A6B', css: 'dashed', dash: [6, 5],   rest: 152 },
    { color: '#7E5A8C', css: 'dotted', dash: [1.5, 6], rest: 158 },
    { color: '#3E6181', css: 'dashed', dash: [9, 6],   rest: 150 },
    { color: '#B8862E', css: 'dotted', dash: [1.5, 7], rest: 162 },
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function stageOf(n) { return STAGE[n.stage] || STAGE_FALLBACK; }

  function RelationsViewer(mount) {
    this.mount = mount;
    // reactive-ish UI state
    this.toggles = {};          // edgeTypeKey -> bool
    this.showIsolated = false;
    this.showInactive = false;
    this.query = '';
    this.searchFocus = false;
    this.selectedId = null;
    this.narrow = false;
    this.railOpen = false;
    // graph/engine state (plain, non-reactive)
    this.g = { nodes: [], edges: [] };
    this.byId = {};
    this.EDGE = {};             // key -> { label, color, dash, w, rest, css, custom }
    this.primaryKeys = ['family', 'elder'];
    this.customKeys = [];
    this.assignedElderName = {}; // personId -> elder display name (for "Shepherded By")
    this.cam = { tx: 0, ty: 0, k: 1 };
    this.hoverId = null;
    this.dragId = null;
    this.dragged = false;
    this.panning = false;
    this.heat = 1;
    this.autoFit = true;
  }

  RelationsViewer.prototype.start = function () {
    var self = this;
    return this.loadData().then(function () {
      self.buildSkeleton();
      self.grabRefs();
      self.ctx = self.canvas.getContext('2d');
      self.resize();
      self._ro = new ResizeObserver(function () { self.resize(); });
      self._ro.observe(self.wrap);
      self._ro.observe(self.root);
      self.attachEvents();
      self.wireChrome();
      self.recompute();
      self.renderAll();
      self.cam.k = 0.92;
      self.autoFit = true;
      self.raf = requestAnimationFrame(function () { self.loop(); });
    });
  };

  // ---------- data ----------
  // The logical graph (nodes + the union of Family/Elder/Custom edges) is built
  // by the pure RelationsGraphCore; this loader fetches the collections, then
  // decorates the logical result with presentation the core deliberately omits —
  // physics positions on nodes and colours/dashes on edge types.
  RelationsViewer.prototype.loadData = function () {
    var self = this, db = firebase.firestore();
    return Promise.all([
      db.collection('people').get(),
      db.collection('families').get(),
      db.collection('relationships').get(),
      db.collection('relationship_types').get(),
      db.collection('users').get().catch(function () { return { docs: [] }; }),
    ]).then(function (snaps) {
      var peopleSnap = snaps[0], famSnap = snaps[1], relSnap = snaps[2], typeSnap = snaps[3], usersSnap = snaps[4];

      // Elder-ness comes from the projected Elder Tag (MS-92). Interim fallback:
      // personIds linked to an *elder* User (super_admins excluded), so the graph
      // shows elders before the Elder-Tag projection is deployed/backfilled.
      var eldersById = {};
      (usersSnap.docs || []).forEach(function (d) {
        var u = d.data() || {};
        if (u.role === 'elder' && u.personId) eldersById[u.personId] = true;
      });

      var toArr = function (snap) {
        return (snap.docs || []).map(function (d) { var o = d.data() || {}; o.id = d.id; return o; });
      };
      var graph = RelationsGraphCore.buildGraph({
        people: toArr(peopleSnap),
        families: toArr(famSnap),
        relationships: toArr(relSnap),
        relationshipTypes: toArr(typeSnap),
        eldersById: eldersById,
      });

      // Decorate logical nodes with physics positions and index them.
      var byId = {};
      graph.nodes.forEach(function (n) {
        n.x = (Math.random() - 0.5) * 620; n.y = (Math.random() - 0.5) * 440; n.vx = 0; n.vy = 0;
        byId[n.id] = n;
      });

      // Edge-type registry with presentation: Family + Elder fixed, then one per
      // Relationship Type coloured from the cycling custom palette.
      var EDGE = {
        family: { label: 'Family',           color: '#182F57', dash: [], w: 2.2, rest: 86,  css: 'solid', custom: false },
        elder:  { label: 'Elder Assignment', color: '#5D94A9', dash: [], w: 1.9, rest: 128, css: 'solid', custom: false },
      };
      var customKeys = [];
      graph.customTypes.forEach(function (t) {
        var pal = CUSTOM_PALETTE[customKeys.length % CUSTOM_PALETTE.length];
        EDGE[t.key] = { label: t.label, color: pal.color, dash: pal.dash, w: 1.9, rest: pal.rest, css: pal.css, custom: true };
        customKeys.push(t.key);
      });

      self.g = { nodes: graph.nodes, edges: graph.edges };
      self.byId = byId;
      self.EDGE = EDGE;
      self.customKeys = customKeys;
      self.assignedElderName = graph.assignedElderName;
      self.hasData = graph.hasData;
      // default preset = Full Web (every edge type on)
      self.toggles = self.presetToggles('full');
    });
  };

  RelationsViewer.prototype.allKeys = function () { return this.primaryKeys.concat(this.customKeys); };
  RelationsViewer.prototype.presetToggles = function (key) {
    var t = {}, self = this;
    this.allKeys().forEach(function (k) {
      if (key === 'family') t[k] = (k === 'family');
      else if (key === 'elder') t[k] = (k === 'elder');
      else t[k] = true;
    });
    return t;
  };
  RelationsViewer.prototype.activePreset = function () {
    var t = this.toggles, keys = this.allKeys();
    var allOn = keys.every(function (k) { return t[k]; });
    if (allOn) return 'full';
    var onlyFamily = keys.every(function (k) { return k === 'family' ? t[k] : !t[k]; });
    if (onlyFamily) return 'family';
    var onlyElder = keys.every(function (k) { return k === 'elder' ? t[k] : !t[k]; });
    if (onlyElder) return 'elder';
    return '';
  };

  RelationsViewer.prototype.recompute = function () {
    var self = this, st = this;
    var active = {};
    this.g.nodes.forEach(function (n) { if (st.showInactive || !n.inactive) active[n.id] = true; });
    this.visEdges = this.g.edges.filter(function (e) { return st.toggles[e.type] && active[e.a] && active[e.b]; });
    var deg = {};
    this.visEdges.forEach(function (e) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
    this.visNodes = this.g.nodes.filter(function (n) { return active[n.id] && (st.showIsolated || deg[n.id]); });
    this.shownIds = {};
    this.visNodes.forEach(function (n) { self.shownIds[n.id] = true; });
    this.adj = {};
    this.visEdges.forEach(function (e) {
      (self.adj[e.a] || (self.adj[e.a] = [])).push(e.b);
      (self.adj[e.b] || (self.adj[e.b] = [])).push(e.a);
    });
    this.heat = 0.9;
    this.autoFit = true;
  };

  // ---------- physics / camera (verbatim from the design) ----------
  RelationsViewer.prototype.loop = function () {
    var self = this;
    this.physics();
    if (this.autoFit && this.visNodes && this.visNodes.length) {
      var ke = 0; this.visNodes.forEach(function (n) { ke += Math.abs(n.vx) + Math.abs(n.vy); });
      var avg = ke / this.visNodes.length;
      this._settleFrames = avg < 1.2 ? (this._settleFrames || 0) + 1 : 0;
      this._afAge = (this._afAge || 0) + 1;
      if ((this._settleFrames > 10 || this._afAge > 150) && !this.dragId && !this.panning) {
        this.fitView(); this.autoFit = false; this._settleFrames = 0; this._afAge = 0;
      }
    } else if (!this.autoFit) { this._afAge = 0; }
    this.updateCamera();
    this.draw();
    this.raf = requestAnimationFrame(function () { self.loop(); });
  };
  RelationsViewer.prototype.physics = function () {
    var ns = this.visNodes; if (!ns || !ns.length) return;
    this.heat = Math.max(0, this.heat - 0.012);
    var boost = 1 + this.heat * 0.8;
    var rep = 4600 * boost, i, j;
    for (i = 0; i < ns.length; i++) { ns[i].fx = 0; ns[i].fy = 0; }
    for (i = 0; i < ns.length; i++) {
      var a = ns[i];
      for (j = i + 1; j < ns.length; j++) {
        var b = ns[j];
        var dx = a.x - b.x, dy = a.y - b.y;
        var d2 = dx * dx + dy * dy; if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
        var d = Math.sqrt(d2);
        var f = rep / d2;
        var fx = f * dx / d, fy = f * dy / d;
        a.fx += fx; a.fy += fy; b.fx -= fx; b.fy -= fy;
      }
    }
    var self = this;
    this.visEdges.forEach(function (e) {
      var a = self.byId[e.a], b = self.byId[e.b];
      var rest = self.EDGE[e.type].rest;
      var dx = b.x - a.x, dy = b.y - a.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var f = 0.026 * boost * (d - rest);
      var fx = f * dx / d, fy = f * dy / d;
      a.fx += fx; a.fy += fy; b.fx -= fx; b.fy -= fy;
    });
    for (i = 0; i < ns.length; i++) {
      var n = ns[i];
      n.fx += -n.x * 0.0038; n.fy += -n.y * 0.0038;
      if (n.id === this.dragId) { n.vx = 0; n.vy = 0; continue; }
      n.vx = (n.vx + n.fx) * 0.85; n.vy = (n.vy + n.fy) * 0.85;
      var sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (sp > 9) { n.vx = n.vx / sp * 9; n.vy = n.vy / sp * 9; }
      n.x += n.vx; n.y += n.vy;
    }
  };
  RelationsViewer.prototype.updateCamera = function () {
    var goal = this.camGoal;
    if (this.focusNodeId) {
      var n = this.byId[this.focusNodeId];
      if (n) goal = { k: this.focusK, cx: n.x, cy: n.y }; else this.focusNodeId = null;
    }
    if (!goal) return;
    var gx = this.W / 2 - goal.cx * goal.k, gy = this.H / 2 - goal.cy * goal.k;
    this.cam.k += (goal.k - this.cam.k) * 0.16;
    this.cam.tx += (gx - this.cam.tx) * 0.16;
    this.cam.ty += (gy - this.cam.ty) * 0.16;
    if (Math.abs(goal.k - this.cam.k) < 0.003 && Math.abs(gx - this.cam.tx) < 0.5 && Math.abs(gy - this.cam.ty) < 0.5) {
      this.cam.k = goal.k; this.cam.tx = gx; this.cam.ty = gy;
      if (!this.focusNodeId) this.camGoal = null;
    }
  };
  RelationsViewer.prototype.releaseCamera = function () { this.camGoal = null; this.focusNodeId = null; };

  // ---------- draw (verbatim) ----------
  RelationsViewer.prototype.draw = function () {
    var ctx = this.ctx; if (!ctx) return;
    var tx = this.cam.tx, ty = this.cam.ty, k = this.cam.k, dpr = this.dpr, self = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.translate(tx, ty); ctx.scale(k, k);

    var focusId = this.selectedId || this.hoverId;
    var hi = null;
    if (focusId && this.shownIds[focusId]) {
      hi = {}; hi[focusId] = true;
      (this.adj[focusId] || []).forEach(function (id) { hi[id] = true; });
    }

    this.visEdges.forEach(function (e) {
      var A = self.byId[e.a], B = self.byId[e.b], def = self.EDGE[e.type];
      var on = !hi || (hi[e.a] && hi[e.b]);
      ctx.globalAlpha = hi ? (on ? 1 : 0.045) : 0.9;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = on && hi ? def.w + 0.7 : def.w;
      ctx.setLineDash(def.dash);
      ctx.lineCap = def.css === 'dotted' ? 'round' : 'butt';
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    });
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    this.visNodes.forEach(function (n) {
      var alpha = hi ? (hi[n.id] ? 1 : 0.15) : 1;
      self.drawNode(n, alpha, focusId);
    });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    this.visNodes.forEach(function (n) {
      var inHi = hi && hi[n.id];
      if (hi && !inHi) return;
      var show = k >= 0.82 || n.elder || inHi || n.id === focusId;
      if (!show) return;
      var r = (n.elder ? 22 : 16) * k;
      var sx = n.x * k + tx, sy = n.y * k + ty + r + 6;
      if (sx < -60 || sx > self.W + 60 || sy < -20 || sy > self.H + 20) return;
      var emph = n.id === focusId;
      ctx.font = (emph ? '700 ' : '600 ') + (n.elder ? 12.5 : 11.5) + "px 'Work Sans', sans-serif";
      var w = ctx.measureText(n.name).width, pad = 4;
      ctx.globalAlpha = 0.92; ctx.fillStyle = 'rgba(251,247,240,0.85)';
      ctx.fillRect(sx - w / 2 - pad, sy - 1, w + pad * 2, 15);
      ctx.globalAlpha = 1;
      ctx.fillStyle = n.inactive ? '#8A8372' : (emph ? '#0E1C36' : '#28324A');
      ctx.fillText(n.name, sx, sy);
    });
    ctx.globalAlpha = 1;
  };
  RelationsViewer.prototype.drawNode = function (n, alpha, focusId) {
    var ctx = this.ctx, r = n.elder ? 22 : 16;
    ctx.globalAlpha = alpha;
    if (n.id === focusId) {
      var sel = n.id === this.selectedId;
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = sel ? '#182F57' : '#5D94A9'; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 7, 0, Math.PI * 2);
      ctx.fillStyle = sel ? 'rgba(24,47,87,0.06)' : 'rgba(93,148,169,0.06)'; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    if (n.inactive) {
      ctx.fillStyle = '#EFE9DF'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.strokeStyle = '#B9B0A0'; ctx.stroke(); ctx.setLineDash([]);
    } else if (n.elder) {
      ctx.fillStyle = '#182F57'; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#B89B6A'; ctx.stroke();
    } else {
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(24,47,87,0.32)'; ctx.stroke();
    }
    ctx.fillStyle = n.inactive ? '#9A9384' : (n.elder ? '#F2EAE2' : '#182F57');
    ctx.font = '600 ' + (n.elder ? 13 : 11) + "px 'Work Sans', sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n.initials, n.x, n.y + 0.5);
    var pr = 5.2, px = n.x + r * 0.68, py = n.y + r * 0.68;
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = stageOf(n).color;
    ctx.globalAlpha = alpha * (n.inactive ? 0.6 : 1); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#FBF7F0'; ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // ---------- canvas sizing + events ----------
  RelationsViewer.prototype.resize = function () {
    if (!this.canvas || !this.wrap) return;
    var r = this.wrap.getBoundingClientRect();
    this.W = r.width; this.H = r.height;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    var rootW = this.root ? this.root.getBoundingClientRect().width : r.width;
    var narrow = rootW < 900;
    if (narrow !== this.narrow) { this.narrow = narrow; this.applyRailLayout(); var self = this; setTimeout(function () { self.fitView(); }, 60); }
  };
  RelationsViewer.prototype.attachEvents = function () {
    var self = this, c = this.canvas;
    this._onDown = function (e) { self.pointerDown(e); };
    this._onMove = function (e) { self.pointerMove(e); };
    this._onUp = function (e) { self.pointerUp(e); };
    this._onWheel = function (e) { self.wheel(e); };
    c.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    c.addEventListener('wheel', this._onWheel, { passive: false });
  };
  RelationsViewer.prototype.toWorld = function (e) {
    var r = this.canvas.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    return { mx: mx, my: my, x: (mx - this.cam.tx) / this.cam.k, y: (my - this.cam.ty) / this.cam.k };
  };
  RelationsViewer.prototype.hitNode = function (wx, wy) {
    for (var i = this.visNodes.length - 1; i >= 0; i--) {
      var n = this.visNodes[i], r = (n.elder ? 22 : 16) + 3;
      if ((n.x - wx) * (n.x - wx) + (n.y - wy) * (n.y - wy) <= r * r) return n;
    }
    return null;
  };
  RelationsViewer.prototype.pointerDown = function (e) {
    var p = this.toWorld(e), n = this.hitNode(p.x, p.y);
    this.dragged = false; this._downXY = { x: e.clientX, y: e.clientY };
    if (n) { this.dragId = n.id; this.releaseCamera(); }
    else { this.panning = true; this.releaseCamera(); this._panStart = { tx: this.cam.tx, ty: this.cam.ty, mx: e.clientX, my: e.clientY }; }
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
  };
  RelationsViewer.prototype.pointerMove = function (e) {
    if (this.dragId) {
      var p = this.toWorld(e), n = this.byId[this.dragId];
      n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0;
      if (Math.abs(e.clientX - this._downXY.x) + Math.abs(e.clientY - this._downXY.y) > 4) this.dragged = true;
      return;
    }
    if (this.panning) {
      this.cam.tx = this._panStart.tx + (e.clientX - this._panStart.mx);
      this.cam.ty = this._panStart.ty + (e.clientY - this._panStart.my);
      if (Math.abs(e.clientX - this._downXY.x) + Math.abs(e.clientY - this._downXY.y) > 4) this.dragged = true;
      return;
    }
    var q = this.toWorld(e);
    if (q.mx < 0 || q.my < 0 || q.mx > this.W || q.my > this.H) { if (this.hoverId) { this.hoverId = null; this.canvas.style.cursor = 'default'; } return; }
    var hit = this.hitNode(q.x, q.y), id = hit ? hit.id : null;
    if (id !== this.hoverId) { this.hoverId = id; this.canvas.style.cursor = id ? 'pointer' : 'default'; }
  };
  RelationsViewer.prototype.pointerUp = function () {
    if (this.dragId && !this.dragged) this.selectNode(this.dragId);
    else if (this.panning && !this.dragged) { if (this.selectedId) { this.selectedId = null; this.renderPanel(); } }
    this.dragId = null; this.panning = false;
  };
  RelationsViewer.prototype.wheel = function (e) {
    e.preventDefault();
    var r = this.canvas.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var factor = Math.exp(-e.deltaY * 0.0016);
    var nk = Math.max(0.28, Math.min(3.2, this.cam.k * factor));
    this.cam.tx = mx - (mx - this.cam.tx) * (nk / this.cam.k);
    this.cam.ty = my - (my - this.cam.ty) * (nk / this.cam.k);
    this.cam.k = nk; this.releaseCamera();
  };
  RelationsViewer.prototype.selectNode = function (id) {
    this.selectedId = id; this.query = ''; this.searchFocus = false;
    this.camGoal = null; this.focusNodeId = id; this.focusK = Math.max(this.cam.k, 1.1);
    if (this.searchInput) this.searchInput.value = '';
    this.renderResults(); this.renderPanel();
  };
  RelationsViewer.prototype.zoomBy = function (f) {
    this.releaseCamera();
    var mx = this.W / 2, my = this.H / 2;
    var nk = Math.max(0.28, Math.min(3.2, this.cam.k * f));
    this.cam.tx = mx - (mx - this.cam.tx) * (nk / this.cam.k);
    this.cam.ty = my - (my - this.cam.ty) * (nk / this.cam.k);
    this.cam.k = nk;
  };
  RelationsViewer.prototype.fitView = function () {
    var ns = this.visNodes; if (!ns || !ns.length) return;
    if (this.wrap) { var rr = this.wrap.getBoundingClientRect(); this.W = rr.width; this.H = rr.height; }
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    ns.forEach(function (n) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); });
    var pad = 110, w = (maxX - minX) + pad * 2, h = (maxY - minY) + pad * 2;
    var k = Math.max(0.3, Math.min(1.0, Math.min(this.W / w, this.H / h)));
    this.focusNodeId = null; this.camGoal = { k: k, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  };

  // ---------- toggles / presets ----------
  RelationsViewer.prototype.applyPreset = function (key) { this.toggles = this.presetToggles(key); this.autoFit = true; this.afterFilter(); };
  RelationsViewer.prototype.toggleEdge = function (k) { this.toggles[k] = !this.toggles[k]; this.afterFilter(); };
  RelationsViewer.prototype.afterFilter = function () {
    this.recompute(); this.renderPresets(); this.renderTypes(); this.updateCounts(); this.updateEmpty();
  };

  // ---------- style helpers (from the design) ----------
  RelationsViewer.prototype.swatchStyle = function (def) {
    return 'width:26px;height:0;flex:0 0 auto;border-top:3px ' + def.css + ' ' + def.color + ';border-radius:2px';
  };
  RelationsViewer.prototype.switchStyles = function (on) {
    return {
      bg: 'flex:0 0 auto;width:38px;height:22px;border-radius:11px;position:relative;transition:background .18s;background:' + (on ? 'var(--navy)' : 'var(--outline-variant)'),
      knob: 'position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(14,28,54,.2);transition:transform .18s;transform:translateX(' + (on ? 16 : 0) + 'px)',
    };
  };
  RelationsViewer.prototype.avatarStyle = function (n, size) {
    var s = size || 38, bg, col, ring = '';
    if (n.inactive) { bg = '#EFE9DF'; col = '#9A9384'; ring = 'border:1.5px dashed #B9B0A0;'; }
    else if (n.elder) { bg = '#182F57'; col = '#F2EAE2'; ring = 'border:2px solid #B89B6A;'; }
    else { bg = '#FFFFFF'; col = '#182F57'; ring = 'border:1.5px solid rgba(24,47,87,.32);'; }
    return 'flex:0 0 auto;width:' + s + 'px;height:' + s + 'px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-family:var(--font-sans);font-weight:600;font-size:' + (s * 0.36) + 'px;background:' + bg + ';color:' + col + ';' + ring;
  };
  RelationsViewer.prototype.presetBtn = function (on) {
    return 'flex:1 1 0;padding:9px 6px;border-radius:9px;font-family:var(--font-sans);font-size:11.5px;font-weight:600;letter-spacing:.04em;cursor:pointer;border:1px solid ' +
      (on ? 'var(--navy)' : 'var(--outline-variant)') + ';background:' + (on ? 'var(--navy)' : 'var(--surface-container-lowest)') +
      ';color:' + (on ? 'var(--cream)' : 'var(--navy-900)') + ';box-shadow:' + (on ? '0 1px 2px rgba(14,28,54,.14)' : 'none');
  };
  RelationsViewer.prototype.edgeCount = function (k) {
    var st = this, active = {};
    this.g.nodes.forEach(function (n) { if (st.showInactive || !n.inactive) active[n.id] = true; });
    return this.g.edges.filter(function (e) { return e.type === k && active[e.a] && active[e.b]; }).length;
  };

  // ---------- relationships for the detail panel ----------
  RelationsViewer.prototype.relForSelected = function (n) {
    var self = this, groups = {}, order = this.allKeys();
    this.g.edges.forEach(function (e) {
      if (e.a !== n.id && e.b !== n.id) return;
      var otherId = e.a === n.id ? e.b : e.a, o = self.byId[otherId];
      if (!o) return;
      var role = '';
      if (e.type === 'family') { role = e.rel === 'spouse' ? 'Spouse' : (e.a === n.id ? 'Child' : 'Parent'); }
      else if (e.type === 'elder') { role = e.a === n.id ? 'Shepherded by' : 'In care group'; }
      else { role = self.EDGE[e.type] ? self.EDGE[e.type].label : 'Relationship'; }
      (groups[e.type] || (groups[e.type] = [])).push({ o: o, role: role });
    });
    var out = [];
    order.forEach(function (k) {
      if (!groups[k]) return;
      var def = self.EDGE[k];
      out.push({ key: k, label: def.label, swatchStyle: self.swatchStyle(def), hidden: !self.toggles[k], items: groups[k] });
    });
    return out;
  };

  // ---------- DOM skeleton + chrome rendering ----------
  RelationsViewer.prototype.buildSkeleton = function () {
    this.mount.innerHTML =
      '<div data-rv="root" style="height:100vh;width:100%;display:flex;flex-direction:column;background:var(--background);color:var(--on-surface);font-family:var(--font-sans);overflow:hidden;position:relative">' +
        // top bar
        '<header style="flex:0 0 auto;height:64px;display:flex;align-items:center;gap:18px;padding:0 20px;background:var(--surface-container-lowest);border-bottom:1px solid var(--outline-variant);z-index:40">' +
          '<button data-act="toggleRail" data-rv="railBtn" class="rv-icobtn" title="Controls" style="display:none;width:40px;height:40px;border:1px solid var(--outline-variant);border-radius:10px;background:var(--surface-container-lowest);color:var(--navy);cursor:pointer;align-items:center;justify-content:center;flex:0 0 auto"><span class="msy" style="font-size:22px">tune</span></button>' +
          '<a href="shepherding-dashboard.html" title="Back to Shepherd Dashboard" aria-label="Back to Shepherd Dashboard" class="rv-icobtn" style="display:flex;flex:0 0 auto;width:40px;height:40px;border:1px solid var(--outline-variant);border-radius:10px;background:var(--surface-container-lowest);color:var(--navy);cursor:pointer;align-items:center;justify-content:center;text-decoration:none"><span class="msy" style="font-size:22px">arrow_back</span></a>' +
          '<div style="display:flex;align-items:center;gap:12px;flex:0 0 auto">' +
            '<img src="assets/mosaic-logo.png" alt="Mosaic" style="width:34px;height:34px;object-fit:contain">' +
            '<div style="display:flex;flex-direction:column;line-height:1.05">' +
              '<span style="font-size:10px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--on-surface-variant)">Shepherd Dashboard</span>' +
              '<h1 style="margin:0;font-family:var(--font-display);font-weight:600;font-size:20px;letter-spacing:.01em;color:var(--navy-900)">Relations Viewer</h1>' +
            '</div></div>' +
          '<div style="flex:1 1 auto;display:flex;justify-content:center;position:relative;max-width:560px;margin:0 auto">' +
            '<div style="position:relative;width:100%;max-width:420px">' +
              '<span class="msy" style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:20px;color:var(--on-surface-variant);pointer-events:none">search</span>' +
              '<input data-rv="search" class="rv-search" placeholder="Search a member by name…" style="width:100%;height:42px;padding:0 40px 0 42px;background:var(--surface-container-low);border:1px solid var(--outline-variant);border-radius:10px;font-family:var(--font-sans);font-size:14px;font-weight:500;color:var(--navy-900);outline:none;transition:border-color .15s,box-shadow .15s">' +
              '<button data-act="clearSearch" data-rv="clearBtn" class="rv-icobtn" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--on-surface-variant);cursor:pointer;align-items:center;justify-content:center"><span class="msy" style="font-size:18px">close</span></button>' +
              '<div data-rv="results" class="rv-scroll" style="display:none;position:absolute;top:48px;left:0;right:0;max-height:300px;overflow:auto;background:var(--surface-container-lowest);border:1px solid var(--outline-variant);border-radius:12px;box-shadow:0 8px 24px rgba(14,28,54,.12);z-index:60;padding:6px"></div>' +
            '</div></div>' +
          '<div data-rv="stats" style="flex:0 0 auto;display:flex;align-items:center;gap:16px">' +
            '<div style="display:flex;flex-direction:column;align-items:flex-end;line-height:1.1"><span data-rv="peopleCount" style="font-size:16px;font-weight:600;color:var(--navy-900);font-family:var(--font-display)">0</span><span style="font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--on-surface-variant)">People</span></div>' +
            '<div style="width:1px;height:30px;background:var(--outline-variant)"></div>' +
            '<div style="display:flex;flex-direction:column;align-items:flex-end;line-height:1.1"><span data-rv="edgeCount" style="font-size:16px;font-weight:600;color:var(--ocean);font-family:var(--font-display)">0</span><span style="font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--on-surface-variant)">Links Shown</span></div>' +
          '</div>' +
        '</header>' +
        // body
        '<div style="flex:1 1 auto;display:flex;min-height:0;position:relative">' +
          '<aside data-rv="rail" class="rv-scroll" style="flex:0 0 288px;width:288px;background:var(--surface-container-lowest);border-right:1px solid var(--outline-variant);overflow-y:auto;overflow-x:hidden">' +
            '<div style="padding:20px 18px 26px;display:flex;flex-direction:column;gap:22px">' +
              '<div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-size:10.5px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--on-surface-variant)">View Preset</span></div><div data-rv="presets" style="display:flex;gap:6px"></div></div>' +
              '<div><span style="display:block;font-size:10.5px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--on-surface-variant);margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--outline-variant)">Relationship Types</span><div data-rv="primaryTypes"></div><div data-rv="customHdr" style="margin:12px 2px 4px;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--on-surface-variant);opacity:.85;display:none;align-items:center;gap:6px"><span class="msy" style="font-size:14px">hub</span> Custom Relationships</div><div data-rv="customTypes"></div><p data-rv="customNote" style="margin:8px 4px 0;font-size:11px;line-height:1.45;color:var(--on-surface-variant);display:none">Custom types are elder-authored and appear here automatically as they’re created.</p></div>' +
              '<div><span style="display:block;font-size:10.5px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--on-surface-variant);margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--outline-variant)">Display</span>' +
                '<div data-act="toggleIsolated" class="rv-row" style="display:flex;align-items:center;gap:11px;padding:9px 8px;border-radius:9px;cursor:pointer"><span class="msy" style="font-size:19px;color:var(--on-surface-variant)">scatter_plot</span><span style="flex:1 1 auto;font-size:13.5px;font-weight:600;color:var(--navy-900)">Show isolated people</span><span data-rv="isoBg"><span data-rv="isoKnob"></span></span></div>' +
                '<div data-act="toggleInactive" class="rv-row" style="display:flex;align-items:center;gap:11px;padding:9px 8px;border-radius:9px;cursor:pointer"><span class="msy" style="font-size:19px;color:var(--on-surface-variant)">do_not_disturb_on</span><span style="flex:1 1 auto;font-size:13.5px;font-weight:600;color:var(--navy-900)">Show inactive people</span><span data-rv="inactBg"><span data-rv="inactKnob"></span></span></div>' +
              '</div>' +
              '<div><span style="display:block;font-size:10.5px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--on-surface-variant);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--outline-variant)">Membership Stage</span><div data-rv="legend" style="display:flex;flex-direction:column;gap:8px"></div>' +
                '<div style="margin-top:14px;display:flex;flex-direction:column;gap:9px;padding-top:12px;border-top:1px solid var(--outline-variant)">' +
                  '<div style="display:flex;align-items:center;gap:10px"><span style="width:16px;height:16px;border-radius:50%;background:var(--navy);border:2px solid var(--gold);flex:0 0 auto"></span><span style="font-size:12.5px;color:var(--on-surface);font-weight:500">Elder</span></div>' +
                  '<div style="display:flex;align-items:center;gap:10px"><span style="width:16px;height:16px;border-radius:50%;background:#EFE9DF;border:1.5px dashed #B9B0A0;flex:0 0 auto"></span><span style="font-size:12.5px;color:var(--on-surface);font-weight:500">Inactive</span></div>' +
                '</div></div>' +
            '</div>' +
          '</aside>' +
          '<main data-rv="wrap" style="flex:1 1 auto;position:relative;min-width:0;background:var(--surface-container-low);overflow:hidden">' +
            '<div style="position:absolute;top:-140px;right:-120px;width:420px;height:420px;border:1px solid var(--steel);border-radius:50%;opacity:.10;pointer-events:none;z-index:0"></div>' +
            '<div style="position:absolute;bottom:-160px;left:8%;width:360px;height:360px;border:1px solid var(--sand);border-radius:50%;opacity:.14;pointer-events:none;z-index:0"></div>' +
            '<canvas data-rv="canvas" style="position:absolute;inset:0;display:block;z-index:1;touch-action:none"></canvas>' +
            '<div style="position:absolute;left:16px;bottom:16px;z-index:5;display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--surface-container-lowest);border:1px solid var(--outline-variant);border-radius:999px;box-shadow:0 2px 8px rgba(14,28,54,.06);font-size:11.5px;color:var(--on-surface-variant);font-weight:500"><span class="msy" style="font-size:15px">pan_tool</span> Drag people &amp; canvas · scroll to zoom · click to open</div>' +
            '<div style="position:absolute;right:16px;bottom:16px;z-index:5;display:flex;flex-direction:column;gap:1px;background:var(--outline-variant);border:1px solid var(--outline-variant);border-radius:11px;overflow:hidden;box-shadow:0 2px 10px rgba(14,28,54,.08)">' +
              '<button data-act="zoomIn" class="rv-icobtn" title="Zoom in" style="width:40px;height:40px;border:none;background:var(--surface-container-lowest);color:var(--navy);cursor:pointer;display:flex;align-items:center;justify-content:center"><span class="msy" style="font-size:20px">add</span></button>' +
              '<button data-act="zoomOut" class="rv-icobtn" title="Zoom out" style="width:40px;height:40px;border:none;background:var(--surface-container-lowest);color:var(--navy);cursor:pointer;display:flex;align-items:center;justify-content:center"><span class="msy" style="font-size:20px">remove</span></button>' +
              '<button data-act="fitView" class="rv-icobtn" title="Fit to view" style="width:40px;height:40px;border:none;background:var(--surface-container-lowest);color:var(--navy);cursor:pointer;display:flex;align-items:center;justify-content:center"><span class="msy" style="font-size:19px">fit_screen</span></button>' +
            '</div>' +
            '<div data-rv="empty" style="display:none;position:absolute;inset:0;z-index:8;align-items:center;justify-content:center;padding:24px"></div>' +
          '</main>' +
          '<aside data-rv="panel" class="rv-scroll" style="display:none;flex:0 0 340px;width:340px;background:var(--surface-container-lowest);border-left:1px solid var(--outline-variant);overflow-y:auto;overflow-x:hidden"></aside>' +
        '</div>' +
      '</div>';
  };

  RelationsViewer.prototype.grabRefs = function () {
    var q = {}, self = this;
    this.mount.querySelectorAll('[data-rv]').forEach(function (el) { q[el.getAttribute('data-rv')] = el; });
    this.refs = q;
    this.root = q.root; this.wrap = q.wrap; this.canvas = q.canvas; this.searchInput = q.search;
  };

  RelationsViewer.prototype.applyRailLayout = function () {
    var rail = this.refs.rail, panel = this.refs.panel, railBtn = this.refs.railBtn, stats = this.refs.stats;
    if (this.narrow) {
      rail.style.cssText = 'flex:0 0 288px;width:288px;background:var(--surface-container-lowest);border-right:1px solid var(--outline-variant);overflow-y:auto;overflow-x:hidden;position:absolute;top:0;left:0;bottom:0;z-index:35;box-shadow:0 8px 30px rgba(14,28,54,.18);transform:translateX(' + (this.railOpen ? '0' : '-110%') + ');transition:transform .28s';
      railBtn.style.display = 'flex'; if (stats) stats.style.display = 'none';
    } else {
      rail.style.cssText = 'flex:0 0 288px;width:288px;background:var(--surface-container-lowest);border-right:1px solid var(--outline-variant);overflow-y:auto;overflow-x:hidden';
      railBtn.style.display = 'none'; if (stats) stats.style.display = 'flex';
    }
  };

  RelationsViewer.prototype.renderAll = function () {
    this.applyRailLayout();
    this.renderPresets(); this.renderTypes(); this.renderDisplay(); this.renderLegend();
    this.updateCounts(); this.updateEmpty(); this.renderPanel();
  };

  RelationsViewer.prototype.renderPresets = function () {
    var self = this, ap = this.activePreset();
    var defs = [['full', 'Full Web'], ['family', 'By Family'], ['elder', 'By Elder']];
    this.refs.presets.innerHTML = defs.map(function (d) {
      return '<button data-act="preset:' + d[0] + '" class="rv-preset" style="' + self.presetBtn(ap === d[0]) + '">' + d[1] + '</button>';
    }).join('');
  };

  RelationsViewer.prototype.typeRow = function (k) {
    var def = this.EDGE[k], sw = this.switchStyles(!!this.toggles[k]);
    return '<div class="rv-row" data-act="toggle:' + k + '" style="display:flex;align-items:center;gap:11px;padding:9px 8px;border-radius:9px;cursor:pointer">' +
      '<span style="' + this.swatchStyle(def) + '"></span>' +
      '<span style="flex:1 1 auto;font-size:13.5px;font-weight:600;color:var(--navy-900)">' + esc(def.label) + '</span>' +
      '<span style="font-size:12px;font-weight:600;color:var(--on-surface-variant);min-width:22px;text-align:right">' + this.edgeCount(k) + '</span>' +
      '<span style="' + sw.bg + '"><span style="' + sw.knob + '"></span></span></div>';
  };
  RelationsViewer.prototype.renderTypes = function () {
    var self = this;
    this.refs.primaryTypes.innerHTML = this.primaryKeys.map(function (k) { return self.typeRow(k); }).join('');
    this.refs.customTypes.innerHTML = this.customKeys.map(function (k) { return self.typeRow(k); }).join('');
    var hasCustom = this.customKeys.length > 0;
    this.refs.customHdr.style.display = hasCustom ? 'flex' : 'none';
    this.refs.customNote.style.display = 'block';
  };
  RelationsViewer.prototype.renderDisplay = function () {
    var iso = this.switchStyles(this.showIsolated), inact = this.switchStyles(this.showInactive);
    this.refs.isoBg.style.cssText = iso.bg; this.refs.isoKnob.style.cssText = iso.knob;
    this.refs.inactBg.style.cssText = inact.bg; this.refs.inactKnob.style.cssText = inact.knob;
  };
  RelationsViewer.prototype.renderLegend = function () {
    this.refs.legend.innerHTML = STAGE_ORDER.map(function (k) {
      var s = STAGE[k];
      return '<div style="display:flex;align-items:center;gap:10px"><span style="width:13px;height:13px;border-radius:50%;flex:0 0 auto;background:' + s.color + ';border:2px solid #FBF7F0;box-shadow:0 0 0 1px ' + s.color + '"></span><span style="font-size:12.5px;color:var(--on-surface);font-weight:500">' + s.label + '</span></div>';
    }).join('');
  };
  RelationsViewer.prototype.updateCounts = function () {
    this.refs.peopleCount.textContent = this.g.nodes.length;
    this.refs.edgeCount.textContent = (this.visEdges || []).length;
  };

  RelationsViewer.prototype.renderResults = function () {
    var self = this, q = this.query.trim().toLowerCase();
    var show = this.searchFocus && q.length > 0;
    this.refs.clearBtn.style.display = this.query.length > 0 ? 'flex' : 'none';
    if (!show) { this.refs.results.style.display = 'none'; this.refs.results.innerHTML = ''; return; }
    var results = this.g.nodes.filter(function (n) { return n.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 8);
    if (!results.length) {
      this.refs.results.innerHTML = '<div style="padding:14px 12px;font-size:13px;color:var(--on-surface-variant)">No members found.</div>';
    } else {
      this.refs.results.innerHTML = results.map(function (n) {
        var sub = (n.elder ? 'Elder · ' : '') + stageOf(n).label + (n.inactive ? ' · Inactive' : '');
        return '<button data-pick="' + esc(n.id) + '" class="rv-result" style="width:100%;display:flex;align-items:center;gap:11px;padding:9px 10px;border:none;background:transparent;border-radius:8px;cursor:pointer;text-align:left">' +
          '<span style="' + self.avatarStyle(n, 34) + '">' + esc(n.initials) + '</span>' +
          '<span style="display:flex;flex-direction:column;min-width:0"><span style="font-size:14px;font-weight:600;color:var(--navy-900)">' + esc(n.name) + '</span><span style="font-size:11.5px;color:var(--on-surface-variant)">' + esc(sub) + '</span></span></button>';
      }).join('');
    }
    this.refs.results.style.display = 'block';
  };

  RelationsViewer.prototype.updateEmpty = function () {
    var visEdges = this.visEdges || [];
    var showEmpty = visEdges.length === 0 && !this.showIsolated;
    var el = this.refs.empty;
    if (!showEmpty) { el.style.display = 'none'; el.innerHTML = ''; return; }
    var noData = !this.hasData;
    var title = noData ? 'No relationships recorded yet' : 'Nothing to show here';
    var body = noData
      ? 'As families, elder assignments, and custom relationships are recorded, the web will take shape here. Turn on “Show isolated people” to see the congregation as unconnected nodes.'
      : 'The current filters hide every link. Adjust the relationship types, or turn on “Show isolated people” to see everyone as floating nodes.';
    el.innerHTML = '<div style="max-width:400px;text-align:center;background:var(--surface-container-lowest);border:1px solid var(--outline-variant);border-radius:16px;box-shadow:0 8px 24px rgba(14,28,54,.10);padding:40px 34px">' +
      '<div style="width:64px;height:64px;margin:0 auto 20px;border-radius:50%;background:var(--surface-container);display:flex;align-items:center;justify-content:center"><span class="msy" style="font-size:32px;color:var(--ocean)">graph_3</span></div>' +
      '<h2 style="margin:0 0 8px;font-family:var(--font-display);font-weight:600;font-size:21px;color:var(--navy-900)">' + title + '</h2>' +
      '<p style="margin:0 0 22px;font-size:14px;line-height:1.55;color:var(--on-surface-variant)">' + body + '</p>' +
      '<button data-act="showIsolated" class="rv-primary" style="display:inline-flex;align-items:center;gap:8px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;padding:12px 22px;font-family:var(--font-sans);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;box-shadow:0 1px 2px rgba(14,28,54,.14)"><span class="msy" style="font-size:18px">scatter_plot</span>Show Isolated People</button></div>';
    el.style.display = 'flex';
  };

  RelationsViewer.prototype.renderPanel = function () {
    var el = this.refs.panel, self = this;
    var n = this.selectedId ? this.byId[this.selectedId] : null;
    if (!n) { el.style.display = 'none'; el.innerHTML = ''; return; }
    var relGroups = this.relForSelected(n);
    var relCount = relGroups.reduce(function (a, g) { return a + g.items.length; }, 0);
    var careName = n.elder ? null : this.assignedElderName[n.id];
    var statusStyle = n.inactive
      ? 'display:inline-flex;align-items:center;padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600;background:var(--surface-container);color:var(--on-surface-variant);border:1px solid var(--outline-variant)'
      : 'display:inline-flex;align-items:center;padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600;background:rgba(75,138,107,.12);color:var(--success);border:1px solid rgba(75,138,107,.3)';

    var groupsHtml = relGroups.map(function (g) {
      var items = g.items.map(function (it) {
        return '<button data-pick="' + esc(it.o.id) + '" class="rv-row" style="display:flex;align-items:center;gap:11px;padding:8px 8px;border:none;background:transparent;border-radius:9px;cursor:pointer;text-align:left;width:100%">' +
          '<span style="' + self.avatarStyle(it.o, 34) + '">' + esc(it.o.initials) + '</span>' +
          '<span style="display:flex;flex-direction:column;min-width:0;flex:1 1 auto"><span style="font-size:13.5px;font-weight:600;color:var(--navy-900)">' + esc(it.o.name) + '</span><span style="font-size:11.5px;color:var(--on-surface-variant)">' + esc(it.role) + '</span></span>' +
          '<span class="msy" style="font-size:18px;color:var(--outline)">chevron_right</span></button>';
      }).join('');
      var hiddenBadge = g.hidden ? '<span style="font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--on-surface-variant);background:var(--surface-container);padding:2px 7px;border-radius:5px">Hidden</span>' : '';
      return '<div><div style="display:flex;align-items:center;gap:9px;margin-bottom:9px"><span style="' + g.swatchStyle + '"></span><span style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--navy-900)">' + esc(g.label) + '</span>' + hiddenBadge + '</div><div style="display:flex;flex-direction:column;gap:2px">' + items + '</div></div>';
    }).join('');

    var relsBlock = relCount > 0
      ? '<div style="display:flex;flex-direction:column;gap:18px">' + groupsHtml + '</div>'
      : '<p style="margin:0;font-size:13px;line-height:1.5;color:var(--on-surface-variant)">No relationships recorded yet for ' + esc(n.first) + '.</p>';

    el.innerHTML = '<div style="padding:0 20px 24px">' +
      '<div style="position:sticky;top:0;background:var(--surface-container-lowest);padding:18px 0 12px;display:flex;justify-content:flex-end;z-index:2"><button data-act="clearSelection" class="rv-icobtn" title="Close" style="width:34px;height:34px;border:1px solid var(--outline-variant);border-radius:9px;background:var(--surface-container-lowest);color:var(--on-surface-variant);cursor:pointer;display:flex;align-items:center;justify-content:center"><span class="msy" style="font-size:19px">close</span></button></div>' +
      '<div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding-bottom:20px;border-bottom:1px solid var(--outline-variant)">' +
        '<span style="' + this.avatarStyle(n, 84) + '">' + esc(n.initials) + '</span>' +
        '<div><h2 style="margin:0;font-family:var(--font-display);font-weight:600;font-size:23px;letter-spacing:.01em;color:var(--navy-900)">' + esc(n.name) + '</h2>' +
          (n.elder ? '<span style="display:inline-flex;align-items:center;gap:5px;margin-top:8px;padding:4px 10px;background:var(--navy);color:var(--cream);border-radius:6px;font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase"><span class="msy" style="font-size:14px">shield_person</span> Elder</span>' : '') +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">' +
          '<span style="display:inline-flex;align-items:center;gap:7px;padding:5px 11px;background:var(--surface-container);border:1px solid var(--outline-variant);border-radius:6px;font-size:12px;font-weight:600;color:var(--navy-900)"><span style="width:11px;height:11px;border-radius:50%;flex:0 0 auto;background:' + stageOf(n).color + '"></span>' + stageOf(n).label + '</span>' +
          (n.inactive ? '<span style="' + statusStyle + '">Inactive</span>' : '') +
        '</div></div>' +
      (careName ? '<div style="display:flex;align-items:center;gap:11px;padding:14px 0;border-bottom:1px solid var(--outline-variant)"><span class="msy" style="font-size:20px;color:var(--steel)">volunteer_activism</span><div style="line-height:1.3"><div style="font-size:10px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:var(--on-surface-variant)">Shepherded By</div><div style="font-size:14px;font-weight:600;color:var(--navy-900)">' + esc(careName) + '</div></div></div>' : '') +
      '<div style="padding-top:18px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><span style="font-size:10.5px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--on-surface-variant)">Relationships</span><span style="font-size:12px;font-weight:600;color:var(--on-surface-variant)">' + relCount + '</span></div>' + relsBlock + '</div>' +
      '<button data-act="viewProfile" class="rv-primary" style="margin-top:24px;width:100%;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;padding:13px;font-family:var(--font-sans);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;box-shadow:0 1px 2px rgba(14,28,54,.14)"><span class="msy" style="font-size:18px">contact_page</span> View Full Profile</button>' +
    '</div>';
    el.style.display = 'block';
  };

  // ---------- chrome events (delegation) ----------
  RelationsViewer.prototype.wireChrome = function () {
    var self = this;
    this.mount.addEventListener('click', function (e) {
      var pick = e.target.closest('[data-pick]');
      if (pick) { self.selectNode(pick.getAttribute('data-pick')); return; }
      var actEl = e.target.closest('[data-act]');
      if (!actEl) return;
      var act = actEl.getAttribute('data-act');
      if (act.indexOf('preset:') === 0) { self.applyPreset(act.slice(7)); }
      else if (act.indexOf('toggle:') === 0) { self.toggleEdge(act.slice(7)); }
      else if (act === 'toggleIsolated') { self.showIsolated = !self.showIsolated; self.renderDisplay(); self.afterFilter(); }
      else if (act === 'toggleInactive') { self.showInactive = !self.showInactive; self.renderDisplay(); self.afterFilter(); }
      else if (act === 'showIsolated') { self.showIsolated = true; self.renderDisplay(); self.afterFilter(); }
      else if (act === 'clearSearch') { self.query = ''; self.searchInput.value = ''; self.searchFocus = false; self.renderResults(); }
      else if (act === 'clearSelection') { self.selectedId = null; self.renderPanel(); }
      else if (act === 'viewProfile') { if (self.selectedId) window.location.href = 'shepherding-profile.html?id=' + encodeURIComponent(self.selectedId); }
      else if (act === 'toggleRail') { self.railOpen = !self.railOpen; self.applyRailLayout(); }
      else if (act === 'zoomIn') { self.zoomBy(1.25); }
      else if (act === 'zoomOut') { self.zoomBy(0.8); }
      else if (act === 'fitView') { self.fitView(); }
    });
    this.searchInput.addEventListener('input', function (e) { self.query = e.target.value; self.searchFocus = true; self.renderResults(); });
    this.searchInput.addEventListener('focus', function () { self.searchFocus = true; self.renderResults(); });
    this.searchInput.addEventListener('blur', function () { setTimeout(function () { self.searchFocus = false; self.renderResults(); }, 160); });
    this.searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { self.query = ''; self.searchInput.value = ''; self.searchFocus = false; self.renderResults(); }
      else if (e.key === 'Enter') {
        var q = self.query.trim().toLowerCase();
        var first = self.g.nodes.filter(function (n) { return n.name.toLowerCase().indexOf(q) >= 0; })[0];
        if (first) self.selectNode(first.id);
      }
    });
  };

  // ---------- boot (elder-gated) ----------
  function boot(user) {
    getUserData(user.uid).then(function (userData) {
      var role = (userData && userData.role) || 'viewer';
      if (['elder', 'super_admin'].indexOf(role) < 0) { window.location.href = 'index.html'; return; }
      var mount = document.getElementById('app');
      var view = new RelationsViewer(mount);
      view.start().catch(function (err) {
        console.error('Relations Viewer failed to load:', err);
        mount.innerHTML = '<div style="padding:60px 24px;text-align:center;font-family:var(--font-serif);font-style:italic;color:var(--on-surface-variant)">Couldn’t load the relationship graph.</div>';
      });
    });
  }

  auth.onAuthStateChanged(function (user) {
    if (!user) { window.location.href = 'login.html'; return; }
    boot(user);
  });
})();
