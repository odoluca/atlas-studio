// Road network as a planar graph: nodes (junctions/ends) and edges (polylines between nodes).
import { closestOnSegment, closestOnPolyline, segmentIntersection, dist, dist2, simplify, uid, SpatialHash, bbox, chaikin, polylineLength, pointAlong } from './geom.js?v=2.2.1';

export const ROAD_TYPES = {
  path:    { label: 'Path',     width: 3,  rank: 0, zoned: false },
  street:  { label: 'Street',   width: 8,  rank: 1, zoned: true },
  avenue:  { label: 'Avenue',   width: 14, rank: 2, zoned: true },
  highway: { label: 'Highway',  width: 22, rank: 3, zoned: false },
  rail:    { label: 'Railway',  width: 4,  rank: 1, zoned: false },
  river:   { label: 'Channel', width: 12, rank: -2, zoned: false, water: true },
};

/** Rendered geometry of an edge: intermediate points are smoothed into curves. */
export function roadGeometry(graph, e) {
  const pts = graph.edgePoints(e);
  return e.pts.length >= 1 ? chaikin(pts, 2, false) : pts;
}

/** Copy of an edge's editable properties (everything except geometry). */
export function edgeProps(e) { return { type: e.type, name: e.name, zoned: e.zoned, width: e.width, bridge: e.bridge, tunnel: !!e.tunnel, bstyle: e.bstyle || '', bdensity: e.bdensity || 0 }; }

export const isWaterType = (type) => !!ROAD_TYPES[type]?.water;

export class RoadGraph {
  constructor() { this.nodes = new Map(); this.edges = new Map(); this.version = 0; }

  addNode(x, y) { const n = { id: uid('n'), x, y }; this.nodes.set(n.id, n); return n; }
  edgePoints(e) { return [this.nodes.get(e.a), ...e.pts, this.nodes.get(e.b)].map((p) => ({ x: p.x, y: p.y })); }
  nodeDegree(id) { let d = 0; for (const e of this.edges.values()) if (e.a === id || e.b === id) d++; return d; }
  width(e) { return e.width || ROAD_TYPES[e.type]?.width || 8; }

  _newEdge(a, b, pts, props) {
    const e = { id: uid('e'), a, b, pts, type: props.type || 'street', name: props.name || '', zoned: props.zoned ?? (ROAD_TYPES[props.type || 'street'].zoned), width: props.width || 0, bridge: !!props.bridge, tunnel: !!props.tunnel, bstyle: props.bstyle || '', bdensity: props.bdensity || 0 };
    this.edges.set(e.id, e);
    return e;
  }

  /** Find nearest node or edge within maxDist. */
  /** Layer of an edge: 'water' for channels, 'road' otherwise. */
  layerOf(e) { return isWaterType(e.type) ? 'water' : 'road'; }
  nodeLayer(nid) { const es = this.edgesAt(nid); return es.length && es.every((e) => isWaterType(e.type)) ? 'water' : 'road'; }

  nearest(x, y, maxDist, excludeEdge = null, layer = null) {
    let best = null;
    const md2 = maxDist * maxDist;
    for (const n of this.nodes.values()) {
      const d2 = dist2(x, y, n.x, n.y);
      if (d2 <= md2 && (!best || d2 < best.d2) && (!layer || this.nodeLayer(n.id) === layer)) best = { kind: 'node', id: n.id, x: n.x, y: n.y, d2 };
    }
    if (best) return best; // nodes win when within range
    for (const e of this.edges.values()) {
      if (e.id === excludeEdge) continue;
      if (layer && this.layerOf(e) !== layer) continue;
      const pts = this.edgePoints(e);
      for (let i = 0; i < pts.length - 1; i++) {
        const c = closestOnSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        if (c.d2 <= md2 && (!best || c.d2 < best.d2)) best = { kind: 'edge', id: e.id, x: c.x, y: c.y, seg: i, t: c.t, d2: c.d2 };
      }
    }
    return best;
  }

  /** Split an edge at a point on its segment index; returns the new node. */
  splitEdge(edgeId, seg, x, y) {
    const e = this.edges.get(edgeId);
    const n = this.addNode(x, y);
    const pts1 = e.pts.slice(0, seg), pts2 = e.pts.slice(seg);
    const props = edgeProps(e);
    this.edges.delete(e.id);
    this._newEdge(e.a, n.id, pts1, props);
    this._newEdge(n.id, e.b, pts2, props);
    this.version++;
    return n;
  }

  /** Split an edge at its intermediate point `index`, making that point a node. Returns the new node. */
  splitAtPoint(edgeId, index) {
    const e = this.edges.get(edgeId);
    if (!e || index < 0 || index >= e.pts.length) return null;
    const p = e.pts[index];
    const n = this.splitEdge(edgeId, index, p.x, p.y);
    // splitEdge keeps the point in the second half; drop that duplicate
    for (const o of this.edges.values()) if (o.a === n.id && o.pts.length && dist2(o.pts[0].x, o.pts[0].y, p.x, p.y) < 1e-6) { o.pts.shift(); break; }
    return n;
  }

  /** Resolve a point to a node (snapping/splitting as needed). */
  _attach(x, y, snapDist, layer = null) {
    const near = this.nearest(x, y, snapDist, null, layer);
    if (!near) return this.addNode(x, y);
    if (near.kind === 'node') return this.nodes.get(near.id);
    return this.splitEdge(near.id, near.seg, near.x, near.y);
  }

  /**
   * Add a road polyline. Endpoints snap to nearby nodes/edges; crossings with existing edges create junctions.
   * Returns array of created edges.
   */
  addRoad(points, props = {}, opts = {}) {
    const snap = opts.snap ?? 12;
    let pts = points.map((p) => ({ x: p.x, y: p.y }));
    if (opts.simplify) pts = simplify(pts, opts.simplify);
    // Remove near-duplicate consecutive points
    pts = pts.filter((p, i) => i === 0 || dist(p.x, p.y, pts[i - 1].x, pts[i - 1].y) > 0.5);
    if (pts.length < 2) return [];

    const layer = isWaterType(props.type) ? 'water' : 'road';
    const start = this._attach(pts[0].x, pts[0].y, snap, layer);
    pts[0] = { x: start.x, y: start.y };
    const endNear = this.nearest(pts[pts.length - 1].x, pts[pts.length - 1].y, snap);
    let end;
    if (endNear && endNear.kind === 'node' && endNear.id === start.id && pts.length < 3) return [];
    end = this._attach(pts[pts.length - 1].x, pts[pts.length - 1].y, snap, layer);
    pts[pts.length - 1] = { x: end.x, y: end.y };

    // Existing nodes lying on the new road become junctions.
    const crossings = []; // {seg, t, x, y, node?}
    const nb = bbox(pts);
    const snap2 = snap * snap;
    for (const n of this.nodes.values()) {
      if (n.id === start.id || n.id === end.id) continue;
      if (this.nodeLayer(n.id) !== layer) continue;
      if (n.x < nb.minX - snap || n.x > nb.maxX + snap || n.y < nb.minY - snap || n.y > nb.maxY + snap) continue;
      const c = closestOnPolyline(n.x, n.y, pts);
      if (c && c.d2 <= snap2) crossings.push({ seg: c.seg, t: c.t, x: n.x, y: n.y, node: n });
    }
    // Find crossings with existing edges
    for (const e of this.edges.values()) {
      if (this.layerOf(e) !== layer) continue; // roads cross water channels without junctions (bridges)
      const ep = this.edgePoints(e);
      const eb = bbox(ep);
      if (eb.maxX < nb.minX || eb.minX > nb.maxX || eb.maxY < nb.minY || eb.minY > nb.maxY) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        for (let k = 0; k < ep.length - 1; k++) {
          const X = segmentIntersection(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, ep[k].x, ep[k].y, ep[k + 1].x, ep[k + 1].y, true);
          if (!X) continue;
          // Skip crossings that coincide with our endpoints or already-known junctions
          if (dist2(X.x, X.y, start.x, start.y) < 1 || dist2(X.x, X.y, end.x, end.y) < 1) continue;
          if (crossings.some((c) => dist2(c.x, c.y, X.x, X.y) < 1)) continue;
          crossings.push({ seg: i, t: X.t, x: X.x, y: X.y, edgeId: e.id, eseg: k });
        }
      }
    }
    // Split crossed edges (process per edge, highest segment index first so indices stay valid)
    const byEdge = new Map();
    for (const c of crossings) { if (!byEdge.has(c.edgeId)) byEdge.set(c.edgeId, []); byEdge.get(c.edgeId).push(c); }
    for (const [edgeId, list] of byEdge) {
      // Split sequentially: after each split, locate the point again on the current graph.
      for (const c of list) {
        if (c.node) continue;
        const near = this.nearest(c.x, c.y, 1.5);
        if (!near) continue;
        if (near.kind === 'node') { c.node = this.nodes.get(near.id); continue; }
        c.node = this.splitEdge(near.id, near.seg, near.x, near.y);
      }
    }
    // Build chain: start, crossings sorted along the line, end
    const sorted = crossings.filter((c) => c.node).sort((p, q) => (p.seg - q.seg) || (p.t - q.t));
    const created = [];
    let curNode = start, curPts = [];
    let ci = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      // crossings on this segment
      while (ci < sorted.length && sorted[ci].seg === i) {
        const c = sorted[ci++];
        if (c.node.id !== curNode.id) { created.push(this._newEdge(curNode.id, c.node.id, curPts, props)); curNode = c.node; curPts = []; }
      }
      if (i + 1 < pts.length - 1) curPts.push({ x: pts[i + 1].x, y: pts[i + 1].y });
    }
    if (curNode.id !== end.id || curPts.length) created.push(this._newEdge(curNode.id, end.id, curPts, props));
    // Fuse with a road that this one continues in a straight line
    const ids = new Set(created.map((e) => e.id));
    for (const nid of [start.id, end.id]) { const merged = this.healNode(nid); if (merged) { ids.add(merged.id); } }
    this.version++;
    return [...ids].map((id) => this.edges.get(id)).filter(Boolean);
  }

  removeEdge(id, heal = true) {
    const e = this.edges.get(id);
    if (!e) return;
    this.edges.delete(id);
    for (const nid of [e.a, e.b]) { if (this.nodeDegree(nid) === 0) this.nodes.delete(nid); else if (heal) this.healNode(nid); }
    this.version++;
  }

  /** Roundabouts: nodes with a ring radius `ra`. Returns [{node, r, width, type}]. */
  roundabouts() {
    const out = [];
    for (const n of this.nodes.values()) {
      if (!n.ra) continue;
      let width = 0, type = 'street', rank = -1;
      for (const e of this.edgesAt(n.id)) { const rk = ROAD_TYPES[e.type]?.rank ?? 1; if (rk > rank || (rk === rank && this.width(e) > width)) { rank = rk; width = this.width(e); type = e.type; } }
      out.push({ node: n, r: n.ra, width: width || 8, type });
    }
    return out;
  }
  /** Nearest junction node (degree >= 3) within maxDist, or null. */
  nearestJunction(x, y, maxDist) {
    let best = null;
    for (const n of this.nodes.values()) {
      const d2 = dist2(x, y, n.x, n.y);
      if (d2 <= maxDist * maxDist && (!best || d2 < best.d2) && (n.ra || this.nodeDegree(n.id) >= 3) && this.nodeLayer(n.id) === 'road') best = { n, d2 };
    }
    return best ? best.n : null;
  }

  /** True when (x,y) lies within a water channel (plus clearance). */
  inChannel(x, y, clearance = 2) {
    for (const e of this.edges.values()) {
      if (!isWaterType(e.type)) continue;
      const half = this.width(e) / 2 + clearance;
      const c = closestOnPolyline(x, y, roadGeometry(this, e));
      if (c && c.d2 <= half * half) return true;
    }
    return false;
  }

  /**
   * Where a node being dragged to (x,y) would connect: a nearby node or edge of the same layer,
   * excluding the node itself, its own edges and its direct neighbours. Returns {kind,id,x,y,seg?} or null.
   */
  snapTargetForNode(nid, x, y, maxDist) {
    const own = this.edgesAt(nid);
    if (!own.length) return null;
    const layer = this.nodeLayer(nid);
    const ownIds = new Set(own.map((e) => e.id));
    const neighbours = new Set(own.map((e) => (e.a === nid ? e.b : e.a)));
    const md2 = maxDist * maxDist;
    let best = null;
    for (const n of this.nodes.values()) {
      if (n.id === nid || neighbours.has(n.id) || this.nodeLayer(n.id) !== layer) continue;
      const d2 = dist2(x, y, n.x, n.y);
      if (d2 <= md2 && (!best || d2 < best.d2)) best = { kind: 'node', id: n.id, x: n.x, y: n.y, d2 };
    }
    if (best) return best;
    for (const e of this.edges.values()) {
      if (ownIds.has(e.id) || this.layerOf(e) !== layer) continue;
      const pts = this.edgePoints(e);
      for (let i = 0; i < pts.length - 1; i++) {
        const c = closestOnSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        if (c.d2 <= md2 && (!best || c.d2 < best.d2)) best = { kind: 'edge', id: e.id, x: c.x, y: c.y, seg: i, d2: c.d2 };
      }
    }
    return best;
  }

  /** Connect node nid to a snap target (from snapTargetForNode): merges nodes, splitting the target edge if needed. */
  connectNode(nid, target) {
    let tn;
    if (target.kind === 'node') tn = this.nodes.get(target.id);
    else { if (!this.edges.has(target.id)) return null; tn = this.splitEdge(target.id, target.seg, target.x, target.y); }
    if (!tn || tn.id === nid) return null;
    for (const e of this.edges.values()) { if (e.a === nid) e.a = tn.id; if (e.b === nid) e.b = tn.id; }
    for (const e of [...this.edges.values()]) if (e.a === e.b) this.edges.delete(e.id);
    this.nodes.delete(nid);
    this.healNode(tn.id);
    this.version++;
    return this.nodes.get(tn.id) || null;
  }

  /** Ids of edges lying entirely within the band of another, wider (or equal) road of the same layer. */
  hiddenRoads() {
    const sh = this.segmentHash(60);
    const out = [];
    for (const e of this.edges.values()) {
      if (e.tunnel) continue;
      const pts = roadGeometry(this, e);
      const L = polylineLength(pts);
      const n = Math.max(2, Math.ceil(L / 5) + 1);
      let hidden = true;
      for (let k = 0; k < n && hidden; k++) {
        const q = pointAlong(pts, (L * k) / n);
        const items = sh.query(q.x - 30, q.y - 30, q.x + 30, q.y + 30);
        let covered = false;
        for (const it of items) {
          const o = it.e;
          if (o.id === e.id || o.tunnel || this.layerOf(o) !== this.layerOf(e)) continue;
          if (this.width(o) < this.width(e)) continue;
          if (this.width(o) === this.width(e) && o.id < e.id) continue; // equal twins: keep the one with the smaller id
          const half = this.width(o) / 2;
          if (closestOnSegment(q.x, q.y, it.ax, it.ay, it.bx, it.by).d2 <= half * half) { covered = true; break; }
        }
        if (!covered) hidden = false;
      }
      if (hidden) out.push(e.id);
    }
    return out;
  }

  /** Edges touching a node. */
  edgesAt(nid) { return [...this.edges.values()].filter((e) => e.a === nid || e.b === nid); }

  /** Unit direction of edge e leaving node nid. */
  dirFrom(e, nid) {
    const pts = this.edgePoints(e);
    if (e.b === nid) pts.reverse();
    const a = pts[0], b = pts[1];
    const L = dist(a.x, a.y, b.x, b.y) || 1;
    return { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  }

  /**
   * The edge that continues e through node nid in (roughly) a straight line with the same type,
   * or null if none is a clear continuation.
   */
  continuation(e, nid, maxDeviationDeg = 35) {
    const d = this.dirFrom(e, nid);
    const minDot = Math.cos((maxDeviationDeg * Math.PI) / 180);
    let best = null, bestDot = -2;
    for (const o of this.edgesAt(nid)) {
      if (o.id === e.id || o.type !== e.type) continue;
      const od = this.dirFrom(o, nid);
      const dot = -(d.x * od.x + d.y * od.y); // 1 when perfectly straight through
      if (dot > bestDot) { bestDot = dot; best = o; }
    }
    return bestDot >= minDot ? best : null;
  }

  /** Ordered chain of edge ids forming one street through junctions, starting from edgeId. */
  streetChain(edgeId) {
    const e0 = this.edges.get(edgeId);
    if (!e0) return [];
    const walk = (startNode) => {
      const out = [];
      let e = e0, nid = startNode;
      const seen = new Set([e0.id]);
      while (true) {
        const next = this.continuation(e, nid);
        if (!next || seen.has(next.id)) break;
        // the continuation must also see us as its best continuation (mutual)
        if (this.continuation(next, nid)?.id !== e.id) break;
        seen.add(next.id); out.push(next.id);
        nid = next.a === nid ? next.b : next.a; e = next;
      }
      return out;
    };
    return [...walk(e0.a).reverse(), e0.id, ...walk(e0.b)];
  }

  /**
   * Merge a node that joins exactly two roads of the same type continuing smoothly into one road.
   * Returns the merged edge, or null when nothing was merged.
   */
  healNode(nid) {
    if (!this.nodes.has(nid)) return null;
    const es = this.edgesAt(nid);
    if (es.length !== 2 || this.nodes.get(nid).ra) return null;
    const [e1, e2] = es;
    if (e1.type !== e2.type || e1.zoned !== e2.zoned || e1.width !== e2.width || e1.bridge !== e2.bridge || !!e1.tunnel !== !!e2.tunnel) return null;
    if (e1.name && e2.name && e1.name !== e2.name) return null;
    if (!this.continuation(e1, nid, 45)) return null;
    const p1 = this.edgePoints(e1), p2 = this.edgePoints(e2);
    if (e1.b !== nid) p1.reverse();
    if (e2.a !== nid) p2.reverse();
    const a = e1.b === nid ? e1.a : e1.b, b = e2.a === nid ? e2.b : e2.a;
    if (a === b) return null;
    const pts = p1.slice(1, -1).concat([{ x: this.nodes.get(nid).x, y: this.nodes.get(nid).y }], p2.slice(1, -1));
    this.edges.delete(e1.id); this.edges.delete(e2.id); this.nodes.delete(nid);
    const merged = this._newEdge(a, b, pts, { ...e1, name: e1.name || e2.name });
    this.version++;
    return merged;
  }

  /** Erase road parts within radius r of (x,y). */
  eraseCircle(x, y, r) {
    const r2 = r * r;
    let changed = false;
    const touched = new Set();
    for (const e of [...this.edges.values()]) {
      const pts = this.edgePoints(e);
      const eb = bbox(pts);
      if (eb.maxX < x - r || eb.minX > x + r || eb.maxY < y - r || eb.minY > y + r) continue;
      // Walk along the polyline; keep sub-segments whose midpoint is outside the circle.
      const pieces = [];
      let cur = null, anyInside = false;
      const inside = (p) => dist2(p.x, p.y, x, y) < r2;
      const close = () => { if (cur && cur.length >= 2) pieces.push(cur); cur = null; };
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ts = [0, ...circleSegmentParams(x, y, r, a, b), 1];
        for (let k = 0; k < ts.length - 1; k++) {
          const t0 = ts[k], t1 = ts[k + 1], tm = (t0 + t1) / 2;
          const mid = { x: a.x + (b.x - a.x) * tm, y: a.y + (b.y - a.y) * tm };
          if (inside(mid)) { close(); anyInside = true; continue; }
          if (!cur) cur = [{ x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 }];
          cur.push({ x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 });
        }
      }
      close();
      if (!anyInside) continue;
      changed = true;
      const props = edgeProps(e);
      this.edges.delete(e.id);
      for (const piece of pieces) {
        if (piece.length < 2) continue;
        if (dist(piece[0].x, piece[0].y, piece[piece.length - 1].x, piece[piece.length - 1].y) < 1) continue;
        const a = this._nodeAt(piece[0], e), b = this._nodeAt(piece[piece.length - 1], e);
        this._newEdge(a.id, b.id, piece.slice(1, -1), props);
      }
      for (const nid of [e.a, e.b]) if (this.nodes.has(nid) && this.nodeDegree(nid) === 0) this.nodes.delete(nid);
      touched.add(e.a); touched.add(e.b);
    }
    if (changed) { for (const nid of touched) this.healNode(nid); this.version++; }
    return changed;
  }
  _nodeAt(p, e) {
    for (const nid of [e.a, e.b]) { const n = this.nodes.get(nid); if (n && dist2(n.x, n.y, p.x, p.y) < 0.01) return n; }
    return this.addNode(p.x, p.y);
  }

  moveNode(id, x, y) { const n = this.nodes.get(id); if (n) { n.x = x; n.y = y; this.version++; } }

  /** Spatial hash of segments: items {e, ax, ay, bx, by}. */
  segmentHash(cell = 60, { skipTunnels = false } = {}) {
    const sh = new SpatialHash(cell);
    for (const e of this.edges.values()) {
      if (skipTunnels && e.tunnel) continue;
      const pts = roadGeometry(this, e);
      for (let i = 0; i < pts.length - 1; i++) {
        const it = { e, ax: pts[i].x, ay: pts[i].y, bx: pts[i + 1].x, by: pts[i + 1].y };
        sh.insert(it, Math.min(it.ax, it.bx), Math.min(it.ay, it.by), Math.max(it.ax, it.bx), Math.max(it.ay, it.by));
      }
    }
    return sh;
  }

  bounds() {
    if (!this.nodes.size) return null;
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const e of this.edges.values()) for (const p of this.edgePoints(e)) { b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x); b.minY = Math.min(b.minY, p.y); b.maxY = Math.max(b.maxY, p.y); }
    return b.minX === Infinity ? null : b;
  }

  toJSON() {
    return { nodes: [...this.nodes.values()].map((n) => (n.ra ? [n.id, +n.x.toFixed(2), +n.y.toFixed(2), +n.ra.toFixed(1)] : [n.id, +n.x.toFixed(2), +n.y.toFixed(2)])),
      edges: [...this.edges.values()].map((e) => ({ id: e.id, a: e.a, b: e.b, pts: e.pts.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]), ...edgeProps(e) })) };
  }
  static fromJSON(j) {
    const g = new RoadGraph();
    for (const [id, x, y, ra] of j?.nodes || []) g.nodes.set(id, ra > 0 ? { id, x, y, ra } : { id, x, y });
    for (const e of j?.edges || []) g.edges.set(e.id, { id: e.id, a: e.a, b: e.b, pts: (e.pts || []).map(([x, y]) => ({ x, y })), type: e.type || 'street', name: e.name || '', zoned: !!e.zoned, width: e.width || 0, bridge: !!e.bridge, tunnel: !!e.tunnel, bstyle: e.bstyle || '', bdensity: e.bdensity || 0 });
    return g;
  }
  clone() { return RoadGraph.fromJSON(this.toJSON()); }
}

/** Parameters t in (0,1) where segment ab crosses circle boundary, sorted. */
function circleSegmentParams(cx, cy, r, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - cx, fy = a.y - cy;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (A === 0 || disc < 0) return [];
  const s = Math.sqrt(disc);
  const out = [];
  for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) if (t > 1e-9 && t < 1 - 1e-9) out.push(t);
  return out;
}

/**
 * Generate a rotated block grid.
 * origin O, unit u (along the first edge), unit v (perpendicular, pointing into the depth), total length L and depth D,
 * block w (along u) and d (along v). isBlocked(x,y) → true if cell must be dropped (water).
 * Returns array of polylines (world coords) to add as roads.
 */
export function gridLines(O, u, v, L, D, w, d, isBlocked) {
  const nx = Math.max(1, Math.round(L / w)), ny = Math.max(1, Math.round(D / d));
  const P = (i, j) => ({ x: O.x + u.x * i * w + v.x * j * d, y: O.y + u.y * i * w + v.y * j * d });
  const keep = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = P(i + 0.5, j + 0.5);
    let ok = !isBlocked(c.x, c.y);
    if (ok) for (const [di, dj] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) { const q = P(i + di, j + dj); if (isBlocked(q.x, q.y)) { ok = false; break; } }
    keep[j * nx + i] = ok ? 1 : 0;
  }
  const lines = [];
  // lines along v (constant i)
  for (let i = 0; i <= nx; i++) {
    let run = null;
    for (let j = 0; j < ny; j++) {
      const k = (i < nx && keep[j * nx + i]) || (i > 0 && keep[j * nx + i - 1]);
      if (k) { if (!run) run = [P(i, j)]; run.push(P(i, j + 1)); }
      else if (run) { lines.push(run); run = null; }
    }
    if (run) lines.push(run);
  }
  // lines along u (constant j)
  for (let j = 0; j <= ny; j++) {
    let run = null;
    for (let i = 0; i < nx; i++) {
      const k = (j < ny && keep[j * nx + i]) || (j > 0 && keep[(j - 1) * nx + i]);
      if (k) { if (!run) run = [P(i, j)]; run.push(P(i + 1, j)); }
      else if (run) { lines.push(run); run = null; }
    }
    if (run) lines.push(run);
  }
  // Collapse collinear interior points to the two endpoints
  return lines.map((ln) => [ln[0], ln[ln.length - 1]]);
}
