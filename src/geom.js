// Geometry helpers. World units are meters, +x east, +y south (screen-like).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Closest point on segment ab to p. Returns {x,y,t,d2}. */
export function closestOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  const x = ax + dx * t, y = ay + dy * t;
  return { x, y, t, d2: dist2(px, py, x, y) };
}

/** Closest point on polyline (array of {x,y}). Returns {x,y,seg,t,d2}. */
export function closestOnPolyline(px, py, pts) {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const c = closestOnSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (!best || c.d2 < best.d2) best = { x: c.x, y: c.y, seg: i, t: c.t, d2: c.d2 };
  }
  return best;
}

/** Proper segment intersection (excluding touching at shared endpoints unless `inclusive`). */
export function segmentIntersection(ax, ay, bx, by, cx, cy, dx, dy, inclusive = false) {
  const r_dx = bx - ax, r_dy = by - ay;
  const s_dx = dx - cx, s_dy = dy - cy;
  const denom = r_dx * s_dy - r_dy * s_dx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((cx - ax) * s_dy - (cy - ay) * s_dx) / denom;
  const u = ((cx - ax) * r_dy - (cy - ay) * r_dx) / denom;
  const eps = inclusive ? -1e-9 : 1e-6;
  if (t < eps || t > 1 - eps || u < eps || u > 1 - eps) return null;
  return { x: ax + r_dx * t, y: ay + r_dy * t, t, u };
}

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
  return L;
}

/** Point at arc-length distance s along polyline; also returns unit tangent. */
export function pointAlong(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = dist(a.x, a.y, b.x, b.y);
    if (acc + L >= s || i === pts.length - 1) {
      const t = L === 0 ? 0 : clamp((s - acc) / L, 0, 1);
      const tx = L === 0 ? 1 : (b.x - a.x) / L, ty = L === 0 ? 0 : (b.y - a.y) / L;
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), tx, ty, seg: i - 1 };
    }
    acc += L;
  }
  const p = pts[0];
  return { x: p.x, y: p.y, tx: 1, ty: 0, seg: 0 };
}

/** Douglas–Peucker simplification. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const c = closestOnSegment(pts[i].x, pts[i].y, pts[s].x, pts[s].y, pts[e].x, pts[e].y);
      if (c.d2 > maxD) { maxD = c.d2; idx = i; }
    }
    if (maxD > tol2 && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Chaikin corner cutting; keeps endpoints for open lines. */
export function chaikin(pts, iterations = 1, closed = false) {
  let cur = pts;
  for (let k = 0; k < iterations; k++) {
    if (cur.length < 3) return cur;
    const out = [];
    const n = cur.length;
    if (!closed) out.push(cur[0]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = cur[i], b = cur[(i + 1) % n];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    if (!closed) out.push(cur[n - 1]);
    cur = out;
  }
  return cur;
}

/** Resample polyline so consecutive points are at most `step` apart. */
export function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = dist(a.x, a.y, b.x, b.y);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push({ x: lerp(a.x, b.x, k / n), y: lerp(a.y, b.y, k / n) });
  }
  return out;
}

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Separating-axis test for two convex polygons. */
export function convexOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = q.y - p.y, ny = p.x - q.x;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of a) { const d = v.x * nx + v.y * ny; if (d < minA) minA = d; if (d > maxA) maxA = d; }
      for (const v of b) { const d = v.x * nx + v.y * ny; if (d < minB) minB = d; if (d > maxB) maxB = d; }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

/** Exact intersection test for two simple polygons (convex or concave): any edge crossing, or one inside the other. */
export function polygonsIntersect(a, b) {
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const r = b[j], s = b[(j + 1) % b.length];
      if (segmentIntersection(p.x, p.y, q.x, q.y, r.x, r.y, s.x, s.y, true)) return true;
    }
  }
  return pointInPolygon(a[0].x, a[0].y, b) || pointInPolygon(b[0].x, b[0].y, a);
}

/** Deterministic 32-bit hash of integers. */
export function hash2(x, y, seed = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2246822519;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

let idCounter = 0;
export function uid(prefix = 'f') {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** Spatial hash for segments / boxes. */
export class SpatialHash {
  constructor(cell = 50) { this.cell = cell; this.map = new Map(); }
  _key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }
  insert(item, minX, minY, maxX, maxY) {
    const c = this.cell;
    for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++)
      for (let cy = Math.floor(minY / c); cy <= Math.floor(maxY / c); cy++) {
        const k = this._key(cx, cy);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(item);
      }
  }
  query(minX, minY, maxX, maxY, out = []) {
    const c = this.cell;
    const seen = new Set();
    for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++)
      for (let cy = Math.floor(minY / c); cy <= Math.floor(maxY / c); cy++) {
        const arr = this.map.get(this._key(cx, cy));
        if (!arr) continue;
        for (const it of arr) if (!seen.has(it)) { seen.add(it); out.push(it); }
      }
    return out;
  }
}
