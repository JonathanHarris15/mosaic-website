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
    this.showIsolated = true;
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
      // Relationship Groups (MS-105). A brand-new collection, so tolerate its
      // absence rather than taking the whole viewer down with it.
      db.collection('relationship_groups').get().catch(function () { return { docs: [] }; }),
    ]).then(function (snaps) {
      var peopleSnap = snaps[0], famSnap = snaps[1], relSnap = snaps[2], typeSnap = snaps[3], usersSnap = snaps[4], groupSnap = snaps[5];

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
        relationshipGroups: toArr(groupSnap),
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
      // `prio` on an edge type means its edges are directional: the `a` end is the
      // priority holder, and the viewer draws an arrowhead at `b`. Family and Elder
      // Assignment are structural and never directional (MS-105).
      var EDGE = {
        family: { label: 'Family',           color: '#182F57', dash: [], w: 2.2, rest: 86,  css: 'solid', custom: false, prio: false },
        elder:  { label: 'Elder Assignment', color: '#5D94A9', dash: [], w: 1.9, rest: 128, css: 'solid', custom: false, prio: false },
      };

      // A Group-kind type has NO edges — it governs bubbles. So it gets its own
      // toggle list and a bubble swatch, not a line in the edge-type list.
      var customKeys = [];   // pairwise types → coloured lines
      var groupKeys = [];    // group types    → bubbles + leader lines
      graph.customTypes.forEach(function (t) {
        if (t.kind === 'group') {
          EDGE[t.key] = { label: t.label, color: null, dash: [], w: 0, rest: 0, css: 'solid', custom: true, group: true, prio: t.prio };
          groupKeys.push(t.key);
          return;
        }
        var pal = CUSTOM_PALETTE[customKeys.length % CUSTOM_PALETTE.length];
        EDGE[t.key] = { label: t.label, color: pal.color, dash: pal.dash, w: 1.9, rest: pal.rest, css: pal.css, custom: true, group: false, prio: t.prio };
        customKeys.push(t.key);
      });

      self.g = { nodes: graph.nodes, edges: graph.edges };
      self.byId = byId;
      self.EDGE = EDGE;
      self.customKeys = customKeys;
      self.groupKeys = groupKeys;
      self.groups = graph.groups;
      self.leaderColour = graph.leaderColourByPerson;
      self.assignedElderName = graph.assignedElderName;
      self.hasData = graph.hasData;
      // default preset = Full Web (every edge type on)
      self.toggles = self.presetToggles('full');
    });
  };

  // Group types are toggled like edge types — one switch governs a type's bubbles
  // AND its leader lines — so they belong in the same key space as the presets.
  RelationsViewer.prototype.allKeys = function () {
    return this.primaryKeys.concat(this.customKeys, this.groupKeys || []);
  };
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

    // Visible Relationship Groups. A group is shown when its TYPE is toggled on —
    // the one switch governs both the bubble and the leader line (MS-105). Members
    // hidden by Show-inactive drop out of the hull; a group left with nobody visible
    // simply isn't drawn this frame.
    this.visGroups = (this.groups || []).filter(function (g) {
      return st.toggles['rel:' + g.typeId];
    }).map(function (g) {
      var memberNodes = g.memberIds.map(function (id) { return self.byId[id]; })
        .filter(function (n) { return n && active[n.id]; });
      var leaderNode = (g.leaderId && active[g.leaderId]) ? self.byId[g.leaderId] : null;
      return {
        id: g.id, name: g.name, typeId: g.typeId, colour: g.colour,
        prio: !!(self.EDGE['rel:' + g.typeId] || {}).prio,
        memberNodes: memberNodes, leaderNode: leaderNode || null,
      };
    }).filter(function (g) { return g.memberNodes.length > 0; });

    // Belonging to a visible group counts as being connected — otherwise a group's
    // members would vanish under "hide isolated people" and leave an empty bubble.
    var deg = {};
    this.visEdges.forEach(function (e) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
    this.visGroups.forEach(function (g) {
      g.memberNodes.forEach(function (n) { deg[n.id] = (deg[n.id] || 0) + 1; });
      if (g.leaderNode) deg[g.leaderNode.id] = (deg[g.leaderNode.id] || 0) + 1;
    });

    this.visNodes = this.g.nodes.filter(function (n) { return active[n.id] && (st.showIsolated || deg[n.id]); });
    this.shownIds = {};
    this.visNodes.forEach(function (n) { self.shownIds[n.id] = true; });

    // Which groups a Person belongs to — used to light up their whole bubble on hover.
    this.nodeGroups = {};
    this.visGroups.forEach(function (g) {
      g.memberNodes.forEach(function (n) { (self.nodeGroups[n.id] || (self.nodeGroups[n.id] = [])).push(g); });
      if (g.leaderNode) (self.nodeGroups[g.leaderNode.id] || (self.nodeGroups[g.leaderNode.id] = [])).push(g);
    });

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
  // ---------- group hull geometry (MS-105) ----------
  // A bubble is a smoothed blob over the convex hull of ring-sampled points around
  // each member node. Sampling a ring (rather than hulling the node centres) means
  // the same code handles a one-person group — which becomes a circle — and a
  // thirty-person group, with the padding always outside the avatars.

  RelationsViewer.prototype.convexHull = function (points) {
    var p = points.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    if (p.length < 3) return p;
    var cross = function (o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); };
    var lower = [], upper = [], i, pt;
    for (i = 0; i < p.length; i++) {
      pt = p[i];
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
      lower.push(pt);
    }
    for (i = p.length - 1; i >= 0; i--) {
      pt = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
      upper.push(pt);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  };

  RelationsViewer.prototype.groupHull = function (gr) {
    var mem = gr.memberNodes;
    if (!mem.length) return null;
    var pts = [], K = 14;
    mem.forEach(function (n) {
      var r = (n.elder ? 22 : 16) + 22; // node radius + bubble padding
      for (var i = 0; i < K; i++) {
        var a = i / K * Math.PI * 2;
        pts.push({ x: n.x + Math.cos(a) * r, y: n.y + Math.sin(a) * r });
      }
    });
    return this.convexHull(pts);
  };

  // Quadratic-through-midpoints: a closed curve that passes near every hull vertex,
  // so the bubble reads as an organic region rather than a polygon.
  RelationsViewer.prototype.tracePath = function (pts) {
    var ctx = this.ctx, n = pts.length;
    if (n === 1) { ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 30, 0, Math.PI * 2); ctx.closePath(); return; }
    if (n === 2) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); return; }
    ctx.beginPath();
    ctx.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
    for (var i = 0; i < n; i++) {
      var p1 = pts[i], p2 = pts[(i + 1) % n];
      ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    }
    ctx.closePath();
  };

  RelationsViewer.prototype.nearestOnHull = function (hull, x, y) {
    var best = null, bd = 1e18;
    for (var i = 0; i < hull.length; i++) {
      var a = hull[i], b = hull[(i + 1) % hull.length];
      var abx = b.x - a.x, aby = b.y - a.y;
      var t = Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / (abx * abx + aby * aby || 1)));
      var px = a.x + abx * t, py = a.y + aby * t;
      var dd = (px - x) * (px - x) + (py - y) * (py - y);
      if (dd < bd) { bd = dd; best = { x: px, y: py }; }
    }
    return best;
  };

  RelationsViewer.prototype.diamond = function (x, y, s, color) {
    var ctx = this.ctx;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color; ctx.fillRect(-s, -s, s * 2, s * 2); ctx.restore();
  };

  RelationsViewer.prototype.roundRect = function (x, y, w, h, r) {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  RelationsViewer.prototype.hexA = function (hex, a) {
    var h = String(hex).replace('#', '');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
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

    // Group clustering (MS-105). A gentle pull toward each visible group's centroid,
    // ADDED on top of the spring model — it changes no rest length, so the Family and
    // Elder structure still decides the layout. Without it a group's members scatter
    // and its bubble degenerates into a useless stretched sliver. The leader is pulled
    // more weakly, so they settle just OUTSIDE the hull — which is what makes the
    // single leader→bubble line read as leadership rather than membership.
    (this.visGroups || []).forEach(function (gr) {
      var mem = gr.memberNodes;
      if (!mem.length) return;
      var cx = 0, cy = 0;
      mem.forEach(function (n) { cx += n.x; cy += n.y; });
      cx /= mem.length; cy /= mem.length;
      var kc = 0.013 * boost;
      mem.forEach(function (n) { n.fx += (cx - n.x) * kc; n.fy += (cy - n.y) * kc; });
      if (gr.leaderNode) {
        var L = gr.leaderNode, kl = 0.008 * boost;
        L.fx += (cx - L.x) * kl; L.fy += (cy - L.y) * kl;
      }
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

  // ---------- Relationship Group bubbles (MS-105) ----------
  // People belong to several groups and leaders lead several, so bubbles overlap —
  // irregularly. Three things keep that legible: fills composite with `multiply`, so
  // an overlap darkens predictably and READS as an intersection rather than as a
  // third colour; larger bubbles are drawn first, so a small bubble's stroke stays on
  // top and can be traced by eye; and a Prioritized type strokes solid while a
  // symmetric one strokes dashed, so the two kinds are distinguishable even where
  // their colours are close.
  RelationsViewer.prototype.drawGroups = function (focusGroupIds) {
    var ctx = this.ctx, self = this;
    if (!this.visGroups || !this.visGroups.length) return;

    var list = this.visGroups.slice().sort(function (a, b) {
      return b.memberNodes.length - a.memberNodes.length;
    });

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    list.forEach(function (gr) {
      var hull = self.groupHull(gr);
      gr._hull = hull;
      if (!hull) return;
      var faded = focusGroupIds && !focusGroupIds[gr.id];
      ctx.globalAlpha = faded ? 0.04 : 0.16;
      ctx.fillStyle = gr.colour;
      self.tracePath(hull); ctx.fill();
    });
    ctx.restore();

    list.forEach(function (gr) {
      var hull = gr._hull;
      if (!hull) return;
      var faded = focusGroupIds && !focusGroupIds[gr.id];
      ctx.globalAlpha = faded ? 0.12 : 0.7;
      ctx.strokeStyle = gr.colour;
      ctx.lineWidth = 1.6;
      ctx.setLineDash(gr.prio ? [] : [7, 5]);
      self.tracePath(hull); ctx.stroke();
      ctx.setLineDash([]);

      // ONE line from the leader to the nearest point on the bubble — not a star to
      // every member. That was the whole reason groups exist. A leaderless group,
      // and any symmetric group, simply has no line.
      if (gr.leaderNode && hull.length) {
        var L = gr.leaderNode;
        var p = self.nearestOnHull(hull, L.x, L.y);
        if (p) {
          var dx = p.x - L.x, dy = p.y - L.y;
          var d = Math.sqrt(dx * dx + dy * dy) || 1;
          var rL = (L.elder ? 22 : 16) + 4;
          var sx = L.x + dx / d * rL, sy = L.y + dy / d * rL;
          ctx.globalAlpha = faded ? 0.14 : 0.92;
          ctx.strokeStyle = gr.colour;
          ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(p.x, p.y); ctx.stroke();
          // The diamond anchors the line to the region, so it reads as "leads this
          // group" rather than "is connected to whoever happens to be nearest".
          self.diamond(p.x, p.y, 4.4, gr.colour);
        }
      }
    });
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  };

  // Group names ride in screen space so they stay level and legible at any zoom.
  RelationsViewer.prototype.drawGroupLabels = function (focusGroupIds) {
    var ctx = this.ctx, self = this;
    if (!this.visGroups || !this.visGroups.length) return;
    var tx = this.cam.tx, ty = this.cam.ty, k = this.cam.k;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

    this.visGroups.forEach(function (gr) {
      var hull = gr._hull;
      if (!hull || !hull.length) return;
      var faded = focusGroupIds && !focusGroupIds[gr.id];
      var top = hull[0];
      hull.forEach(function (p) { if (p.y < top.y) top = p; });
      var sx = top.x * k + tx, sy = top.y * k + ty - 13;
      if (sx < -140 || sx > self.W + 140 || sy < -20 || sy > self.H + 20) return;

      ctx.font = "600 11.5px 'Work Sans', sans-serif";
      var w = ctx.measureText(gr.name).width;
      var dot = 7, gap = 6, padX = 9, h = 22;
      var boxW = padX * 2 + dot + gap + w;
      var bx = sx - boxW / 2, by = sy - h / 2;

      ctx.globalAlpha = faded ? 0.22 : 1;
      ctx.fillStyle = 'rgba(251,247,240,0.94)';           // parchment chip
      self.roundRect(bx, by, boxW, h, 7); ctx.fill();
      ctx.strokeStyle = self.hexA(gr.colour, 0.55);
      ctx.lineWidth = 1;
      self.roundRect(bx, by, boxW, h, 7); ctx.stroke();

      ctx.fillStyle = gr.colour;
      ctx.beginPath(); ctx.arc(bx + padX + dot / 2, sy, dot / 2, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#28324A';
      ctx.fillText(gr.name, bx + padX + dot + gap, sy + 0.5);
    });
    ctx.globalAlpha = 1;
  };

  // ---------- draw (verbatim) ----------
  RelationsViewer.prototype.draw = function () {
    var ctx = this.ctx; if (!ctx) return;
    var tx = this.cam.tx, ty = this.cam.ty, k = this.cam.k, dpr = this.dpr, self = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.translate(tx, ty); ctx.scale(k, k);

    var focusId = this.selectedId || this.hoverId;
    var hi = null, focusGroupIds = null;
    if (focusId && this.shownIds[focusId]) {
      hi = {}; hi[focusId] = true;
      (this.adj[focusId] || []).forEach(function (id) { hi[id] = true; });
      // Focusing someone lights up every group they belong to, whole — a group is
      // one thing, so highlighting half of it would be a lie.
      var grs = this.nodeGroups && this.nodeGroups[focusId];
      if (grs && grs.length) {
        focusGroupIds = {};
        grs.forEach(function (gr) {
          focusGroupIds[gr.id] = true;
          gr.memberNodes.forEach(function (n) { hi[n.id] = true; });
          if (gr.leaderNode) hi[gr.leaderNode.id] = true;
        });
      }
    }

    // Group bubbles sit UNDER everything — they are regions, not marks.
    this.drawGroups(focusGroupIds);

    // Collapse every connection between the same two people onto ONE line.
    // A single connection draws as before; two or more render as a striped line
    // (a solid colour stripe per connection type, interleaved along its length
    // via offset dash patterns) so no connection is hidden under another.
    var order = self.allKeys(), orderIx = {};
    order.forEach(function (k, i) { orderIx[k] = i; });
    var pairs = {}, pairOrder = [];
    this.visEdges.forEach(function (e) {
      var key = e.a < e.b ? e.a + ' ' + e.b : e.b + ' ' + e.a;
      if (!pairs[key]) { pairs[key] = []; pairOrder.push(key); }
      pairs[key].push(e);
    });
    pairOrder.forEach(function (key) {
      var group = pairs[key];
      group.sort(function (x, y) { return (orderIx[x.type] || 0) - (orderIx[y.type] || 0); });
      var e0 = group[0], A = self.byId[e0.a], B = self.byId[e0.b];
      var on = !hi || (hi[e0.a] && hi[e0.b]);
      ctx.globalAlpha = hi ? (on ? 1 : 0.045) : 0.9;
      if (group.length === 1) {
        var def = self.EDGE[e0.type];
        ctx.strokeStyle = def.color;
        ctx.lineWidth = on && hi ? def.w + 0.7 : def.w;
        ctx.setLineDash(def.dash);
        ctx.lineDashOffset = 0;
        ctx.lineCap = def.css === 'dotted' ? 'round' : 'butt';
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        return;
      }
      // Striped combined line: one thin line per connection type, laid side by
      // side and running PARALLEL to the connection (each offset perpendicular
      // to the line direction so the stripes run along its length).
      var nT = group.length, bump = on && hi ? 0.7 : 0;
      var dx = B.x - A.x, dy = B.y - A.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len; // unit perpendicular
      var maxW = 0;
      group.forEach(function (e) { maxW = Math.max(maxW, self.EDGE[e.type].w); });
      var slot = maxW + bump + 1.1; // centre-to-centre spacing between stripes
      var start = -((nT - 1) * slot) / 2;
      group.forEach(function (e, i) {
        var def = self.EDGE[e.type], off = start + i * slot, ox = nx * off, oy = ny * off;
        ctx.strokeStyle = def.color;
        ctx.lineWidth = def.w + bump;
        ctx.setLineDash(def.dash);
        ctx.lineDashOffset = 0;
        ctx.lineCap = def.css === 'dotted' ? 'round' : 'butt';
        ctx.beginPath(); ctx.moveTo(A.x + ox, A.y + oy); ctx.lineTo(B.x + ox, B.y + oy); ctx.stroke();
      });
    });
    ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;

    this.visNodes.forEach(function (n) {
      var alpha = hi ? (hi[n.id] ? 1 : 0.15) : 1;
      self.drawNode(n, alpha, focusId);
    });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Arrowheads on Prioritized relationships (Holder → Counterpart). Drawn in
    // SCREEN space at a constant pixel size, so they stay legible when zoomed out —
    // and drawn as a solid filled triangle after the stroke, so a dashed or dotted
    // edge still gets a clean head. Only prioritized types get one; Family and Elder
    // Assignment never do, or the graph would become a thicket of arrows.
    this.visEdges.forEach(function (e) {
      var def = self.EDGE[e.type];
      if (!def || !def.prio) return;
      var A = self.byId[e.a], B = self.byId[e.b];
      if (!A || !B) return;
      var on = !hi || (hi[e.a] && hi[e.b]);
      var dx = B.x - A.x, dy = B.y - A.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= d; dy /= d;
      var bsx = B.x * k + tx, bsy = B.y * k + ty;
      var rB = (B.elder ? 22 : 16) * k + 2.5;   // sit just outside the counterpart
      var tipx = bsx - dx * rB, tipy = bsy - dy * rB;
      var s = 8.5, ang = Math.atan2(dy, dx);
      ctx.globalAlpha = hi ? (on ? 1 : 0.05) : 0.95;
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.moveTo(tipx, tipy);
      ctx.lineTo(tipx - Math.cos(ang - 0.42) * s, tipy - Math.sin(ang - 0.42) * s);
      ctx.lineTo(tipx - Math.cos(ang + 0.42) * s, tipy - Math.sin(ang + 0.42) * s);
      ctx.closePath(); ctx.fill();
    });
    ctx.globalAlpha = 1;

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

    // Group names last, so nothing overdraws them.
    this.drawGroupLabels(focusGroupIds);
  };
  RelationsViewer.prototype.drawNode = function (n, alpha, focusId) {
    var ctx = this.ctx, r = n.elder ? 22 : 16;
    ctx.globalAlpha = alpha;

    // A leader wears a ring in the colour of the group they lead, so you can see who
    // leads without following the line back to the bubble.
    var lead = this.leaderColour && this.leaderColour[n.id];
    if (lead && this.nodeGroups && this.nodeGroups[n.id]) {
      ctx.strokeStyle = lead;
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 3.5, 0, Math.PI * 2); ctx.stroke();
    }

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
    // Pin the CSS box to the logical size. The width/height attributes above are
    // a low-priority CSS presentation hint; without an explicit style the canvas
    // lays out at its backing-store size (W*dpr) instead of stretching via
    // inset:0, so at DPR>1 it renders scaled and pointer hit-testing drifts. See
    // ADR/notes: this only misbehaves off DPR=1 (laptops with display scaling).
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
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
              '<div><span style="display:block;font-size:10.5px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--on-surface-variant);margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--outline-variant)">Relationship Types</span><div data-rv="primaryTypes"></div><div data-rv="customHdr" style="margin:12px 2px 4px;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--on-surface-variant);opacity:.85;display:none;align-items:center;gap:6px"><span class="msy" style="font-size:14px">hub</span> Custom Relationships</div><div data-rv="customTypes"></div><p data-rv="customNote" style="margin:8px 4px 0;font-size:11px;line-height:1.45;color:var(--on-surface-variant);display:none">Custom types are elder-authored and appear here automatically as they’re created.</p>' +
              '<div data-rv="groupHdr" style="margin:14px 2px 4px;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--on-surface-variant);opacity:.85;display:none;align-items:center;gap:6px"><span class="msy" style="font-size:14px">bubble_chart</span> Relationship Groups</div><div data-rv="groupTypes"></div><p data-rv="groupNote" style="margin:8px 4px 0;font-size:11px;line-height:1.45;color:var(--on-surface-variant);display:none">One toggle governs a type’s bubbles and its leader lines. A group can be leaderless or empty — both are normal.</p></div>' +
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
  // A Group type draws no lines, so a line swatch would be a lie. It gets two
  // overlapping bubbles instead — in the colours of its own groups — and the count
  // is groups, not edges. The one toggle governs the bubbles AND the leader lines.
  RelationsViewer.prototype.groupTypeRow = function (k) {
    var def = this.EDGE[k], sw = this.switchStyles(!!this.toggles[k]);
    var typeId = k.slice(4);
    var mine = (this.groups || []).filter(function (g) { return g.typeId === typeId; });
    var c1 = (mine[0] && mine[0].colour) || '#8A93A6';
    var c2 = (mine[1] && mine[1].colour) || c1;

    var swatch =
      '<span style="position:relative;width:22px;height:14px;flex:0 0 auto">' +
        '<span style="position:absolute;left:0;top:0;width:14px;height:14px;border-radius:50%;background:' + this.hexA(c1, 0.28) + ';border:1.4px solid ' + c1 + '"></span>' +
        '<span style="position:absolute;left:8px;top:0;width:14px;height:14px;border-radius:50%;background:' + this.hexA(c2, 0.28) + ';border:1.4px solid ' + c2 + '"></span>' +
      '</span>';

    var prioMark = def.prio
      ? '<span title="Prioritized — a leader draws one line to the bubble" class="msy" style="font-size:15px;color:var(--on-surface-variant)">workspace_premium</span>'
      : '';

    return '<div class="rv-row" data-act="toggle:' + k + '" style="display:flex;align-items:center;gap:11px;padding:9px 8px;border-radius:9px;cursor:pointer">' +
      swatch +
      '<span style="flex:1 1 auto;font-size:13.5px;font-weight:600;color:var(--navy-900)">' + esc(def.label) + '</span>' +
      prioMark +
      '<span style="font-size:12px;font-weight:600;color:var(--on-surface-variant);min-width:22px;text-align:right">' + mine.length + '</span>' +
      '<span style="' + sw.bg + '"><span style="' + sw.knob + '"></span></span></div>';
  };

  RelationsViewer.prototype.renderTypes = function () {
    var self = this;
    this.refs.primaryTypes.innerHTML = this.primaryKeys.map(function (k) { return self.typeRow(k); }).join('');
    this.refs.customTypes.innerHTML = this.customKeys.map(function (k) { return self.typeRow(k); }).join('');
    var hasCustom = this.customKeys.length > 0;
    this.refs.customHdr.style.display = hasCustom ? 'flex' : 'none';
    this.refs.customNote.style.display = 'block';

    var hasGroups = (this.groupKeys || []).length > 0;
    if (this.refs.groupTypes) {
      this.refs.groupTypes.innerHTML = (this.groupKeys || []).map(function (k) { return self.groupTypeRow(k); }).join('');
      this.refs.groupHdr.style.display = hasGroups ? 'flex' : 'none';
      this.refs.groupNote.style.display = hasGroups ? 'block' : 'none';
    }
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
