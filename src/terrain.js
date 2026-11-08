// Tiled infinite heightfield + material field, brushes, and marching squares.
import { smoothstep, chaikin } from './geom.js';

export const TILE = 64;          // cells per tile side
export const CELL = 4;           // meters per cell
export const TILE_M = TILE * CELL;

export const MAT = { LAND: 0, PARK: 1, FOREST: 2, SAND: 3, WATER: 4, PAVED: 5 };
export const MAT_NAMES = ['Land', 'Park', 'Forest', 'Sand', 'Water', 'Paved'];

const tileKey = (tx, ty) => (tx + 32768) * 65536 + (ty + 32768);

export class Tile {
  constructor(tx, ty) {
    this.tx = tx; this.ty = ty;
    this.h = new Float32Array(TILE * TILE);
    this.m = new Uint8Array(TILE * TILE);
  }
  clone() { const t = new Tile(this.tx, this.ty); t.h.set(this.h); t.m.set(this.m); return t; }
  isEmpty() {
    for (let i = 0; i < this.h.length; i++) if (this.h[i] !== 0 || this.m[i] !== 0) return false;
    return true;
  }
}

export class Terrain {
  constructor() {
    this.tiles = new Map();
    this.seaLevel = 0;
    this.version = 0;
    this._last = null;
  }

  getTile(tx, ty, create = false) {
    const k = tileKey(tx, ty);
    const last = this._last;
    if (last && last.tx === tx && last.ty === ty) return last;
    let t = this.tiles.get(k);
    if (!t && create) { t = new Tile(tx, ty); this.tiles.set(k, t); }
    if (t) this._last = t;
    return t || null;
  }

  /** Height at integer cell coords. */
  cellH(cx, cy) {
    const t = this.getTile(Math.floor(cx / TILE), Math.floor(cy / TILE));
    if (!t) return 0;
    return t.h[(cy - t.ty * TILE) * TILE + (cx - t.tx * TILE)];
  }
  cellM(cx, cy) {
    const t = this.getTile(Math.floor(cx / TILE), Math.floor(cy / TILE));
    if (!t) return 0;
    return t.m[(cy - t.ty * TILE) * TILE + (cx - t.tx * TILE)];
  }

  /** Bilinear height at world coords. Cell centers are at (cx+0.5)*CELL. */
  heightAt(x, y) {
    const fx = x / CELL - 0.5, fy = y / CELL - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const h00 = this.cellH(x0, y0), h10 = this.cellH(x0 + 1, y0);
    const h01 = this.cellH(x0, y0 + 1), h11 = this.cellH(x0 + 1, y0 + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
  }
  materialAt(x, y) { return this.cellM(Math.floor(x / CELL), Math.floor(y / CELL)); }
  isWater(x, y) { return this.materialAt(x, y) === MAT.WATER || this.heightAt(x, y) < this.seaLevel; }

  /** Bounding box of non-empty content in world coords, or null. */
  bounds() {
    let b = null;
    for (const t of this.tiles.values()) {
      if (t.isEmpty()) continue;
      const x0 = t.tx * TILE_M, y0 = t.ty * TILE_M;
      if (!b) b = { minX: x0, minY: y0, maxX: x0 + TILE_M, maxY: y0 + TILE_M };
      else { b.minX = Math.min(b.minX, x0); b.minY = Math.min(b.minY, y0); b.maxX = Math.max(b.maxX, x0 + TILE_M); b.maxY = Math.max(b.maxY, y0 + TILE_M); }
    }
    return b;
  }

  /**
   * Iterate cells within radius r of world point (x,y). cb(tile, idx, falloff, cx, cy)
   * falloff: 1 inside hardness core, smooth to 0 at radius.
   */
  forEachCell(x, y, r, hardness, cb, create = true) {
    const cx0 = Math.floor((x - r) / CELL), cx1 = Math.floor((x + r) / CELL);
    const cy0 = Math.floor((y - r) / CELL), cy1 = Math.floor((y + r) / CELL);
    const r2 = r * r, core = r * hardness;
    for (let ty = Math.floor(cy0 / TILE); ty <= Math.floor(cy1 / TILE); ty++) {
      for (let tx = Math.floor(cx0 / TILE); tx <= Math.floor(cx1 / TILE); tx++) {
        const t = this.getTile(tx, ty, create);
        if (!t) continue;
        const sx = Math.max(cx0, tx * TILE), ex = Math.min(cx1, tx * TILE + TILE - 1);
        const sy = Math.max(cy0, ty * TILE), ey = Math.min(cy1, ty * TILE + TILE - 1);
        for (let cy = sy; cy <= ey; cy++) {
          const wy = (cy + 0.5) * CELL - y;
          for (let cx = sx; cx <= ex; cx++) {
            const wx = (cx + 0.5) * CELL - x;
            const d2 = wx * wx + wy * wy;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2);
            const f = d <= core ? 1 : 1 - smoothstep(core, r, d);
            cb(t, (cy - ty * TILE) * TILE + (cx - tx * TILE), f, cx, cy);
          }
        }
      }
    }
  }

  /** Height brush. mode: raise|lower|smooth|flatten|noise. amount in meters per application. */
  applyHeight(x, y, r, hardness, amount, mode, target = 0) {
    if (mode === 'smooth') {
      const samples = [];
      this.forEachCell(x, y, r, hardness, (t, i, f, cx, cy) => {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += this.cellH(cx + dx, cy + dy);
        samples.push(t, i, f, s / 9);
      });
      const k = Math.min(1, amount * 0.25);
      for (let j = 0; j < samples.length; j += 4) {
        const t = samples[j], i = samples[j + 1], f = samples[j + 2], mean = samples[j + 3];
        t.h[i] += (mean - t.h[i]) * f * k;
      }
    } else if (mode === 'flatten') {
      const k = Math.min(1, amount * 0.3);
      this.forEachCell(x, y, r, hardness, (t, i, f) => { t.h[i] += (target - t.h[i]) * f * k; });
    } else {
      const sign = mode === 'lower' ? -1 : 1;
      this.forEachCell(x, y, r, hardness, (t, i, f) => { t.h[i] += sign * amount * f; });
    }
    this.version++;
  }

  /** Material brush: sets material id within radius (hard edge, outlines are smoothed when rendered). */
  applyMaterial(x, y, r, id) {
    this.forEachCell(x, y, r, 1, (t, i) => { t.m[i] = id; });
    this.version++;
  }

  /** Material at cells in rectangle/polygon helper for undo: snapshot tiles touched by a circle. */
  tilesInCircle(x, y, r) {
    const out = [];
    const tx0 = Math.floor((x - r) / TILE_M), tx1 = Math.floor((x + r) / TILE_M);
    const ty0 = Math.floor((y - r) / TILE_M), ty1 = Math.floor((y + r) / TILE_M);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) out.push([tx, ty]);
    return out;
  }

  snapshotTile(tx, ty) {
    const t = this.getTile(tx, ty);
    return t ? t.clone() : null;
  }
  restoreTile(tx, ty, snap) {
    const k = tileKey(tx, ty);
    if (!snap) this.tiles.delete(k);
    else this.tiles.set(k, snap.clone());
    this._last = null;
    this.version++;
  }

  /**
   * Sample a grid of nx×ny points starting at world (x0,y0) with spacing `step`.
   * Returns { h: Float32Array, m: Uint8Array }.
   */
  sample(x0, y0, step, nx, ny) {
    const h = new Float32Array(nx * ny), m = new Uint8Array(nx * ny);
    let lastT = null, ltx = 1e9, lty = 1e9;
    const get = (cx, cy) => {
      const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE);
      if (tx !== ltx || ty !== lty) { lastT = this.getTile(tx, ty); ltx = tx; lty = ty; }
      return lastT ? (cy - ty * TILE) * TILE + (cx - tx * TILE) : -1;
    };
    const bilinear = step < CELL * 1.5;
    for (let j = 0; j < ny; j++) {
      const wy = y0 + j * step;
      for (let i = 0; i < nx; i++) {
        const wx = x0 + i * step;
        const idx = j * nx + i;
        if (bilinear) {
          const fx = wx / CELL - 0.5, fy = wy / CELL - 0.5;
          const cx = Math.floor(fx), cy = Math.floor(fy);
          const tx = fx - cx, ty = fy - cy;
          let k;
          k = get(cx, cy); const h00 = k < 0 ? 0 : lastT.h[k];
          const mi = Math.floor(wx / CELL), mj = Math.floor(wy / CELL);
          k = get(cx + 1, cy); const h10 = k < 0 ? 0 : lastT.h[k];
          k = get(cx, cy + 1); const h01 = k < 0 ? 0 : lastT.h[k];
          k = get(cx + 1, cy + 1); const h11 = k < 0 ? 0 : lastT.h[k];
          h[idx] = (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
          k = get(mi, mj); m[idx] = k < 0 ? 0 : lastT.m[k];
        } else {
          const cx = Math.floor(wx / CELL), cy = Math.floor(wy / CELL);
          const k = get(cx, cy);
          h[idx] = k < 0 ? 0 : lastT.h[k];
          m[idx] = k < 0 ? 0 : lastT.m[k];
        }
      }
    }
    return { h, m };
  }

  toJSON() {
    const tiles = [];
    for (const t of this.tiles.values()) {
      if (t.isEmpty()) continue;
      const q = new Int16Array(t.h.length);
      for (let i = 0; i < q.length; i++) q[i] = Math.max(-32768, Math.min(32767, Math.round(t.h[i] * 10)));
      tiles.push({ tx: t.tx, ty: t.ty, h: b64(new Uint8Array(q.buffer)), m: b64(t.m) });
    }
    return { seaLevel: this.seaLevel, tiles };
  }
  static fromJSON(j) {
    const T = new Terrain();
    T.seaLevel = j?.seaLevel ?? 0;
    for (const td of j?.tiles || []) {
      const t = new Tile(td.tx, td.ty);
      const q = new Int16Array(unb64(td.h).buffer);
      for (let i = 0; i < q.length; i++) t.h[i] = q[i] / 10;
      t.m.set(unb64(td.m));
      T.tiles.set(tileKey(td.tx, td.ty), t);
    }
    return T;
  }
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return (typeof btoa === 'function') ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}
function unb64(str) {
  const s = (typeof atob === 'function') ? atob(str) : Buffer.from(str, 'base64').toString('binary');
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------- Marching squares ----------

/**
 * Extract iso-lines of scalar field f (nx×ny, row-major) at `level`.
 * Returns array of polylines in grid coordinates [{x,y},...]; closed ones have first==last.
 */
/** Per-cell min/max of the four corners, to skip cells quickly when extracting many levels. */
export function cellRanges(f, nx, ny) {
  const n = (nx - 1) * (ny - 1);
  const min = new Float32Array(n), max = new Float32Array(n);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = f[j * nx + i], b = f[j * nx + i + 1], c = f[(j + 1) * nx + i + 1], d = f[(j + 1) * nx + i];
    const k = j * (nx - 1) + i;
    min[k] = Math.min(a, b, c, d); max[k] = Math.max(a, b, c, d);
  }
  return { min, max };
}

export function isolines(f, nx, ny, level, range = null) {
  // Edge id: horizontal edge from (i,j)->(i+1,j): 2*(j*nx+i); vertical (i,j)->(i,j+1): 2*(j*nx+i)+1
  const segs = []; // [eA, eB]
  const edgePt = new Map(); // edgeId -> {x,y}
  const cross = (a, b) => (a >= level) !== (b >= level);
  const interp = (a, b) => { const d = b - a; return Math.abs(d) < 1e-12 ? 0.5 : (level - a) / d; };
  const hEdge = (i, j) => { const id = 2 * (j * nx + i); if (!edgePt.has(id)) edgePt.set(id, { x: i + interp(f[j * nx + i], f[j * nx + i + 1]), y: j }); return id; };
  const vEdge = (i, j) => { const id = 2 * (j * nx + i) + 1; if (!edgePt.has(id)) edgePt.set(id, { x: i, y: j + interp(f[j * nx + i], f[(j + 1) * nx + i]) }); return id; };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (range) { const k = j * (nx - 1) + i; if (range.max[k] < level || range.min[k] >= level) continue; }
      const a = f[j * nx + i], b = f[j * nx + i + 1], c = f[(j + 1) * nx + i + 1], d = f[(j + 1) * nx + i];
      const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => hEdge(i, j), right = () => vEdge(i + 1, j), bottom = () => hEdge(i, j + 1), left = () => vEdge(i, j);
      switch (code) {
        case 1: case 14: segs.push([left(), top()]); break;
        case 2: case 13: segs.push([top(), right()]); break;
        case 3: case 12: segs.push([left(), right()]); break;
        case 4: case 11: segs.push([right(), bottom()]); break;
        case 6: case 9: segs.push([top(), bottom()]); break;
        case 7: case 8: segs.push([left(), bottom()]); break;
        case 5: { const mid = (a + b + c + d) / 4; if (mid >= level) { segs.push([left(), top()]); segs.push([right(), bottom()]); } else { segs.push([top(), right()]); segs.push([left(), bottom()]); } break; }
        case 10: { const mid = (a + b + c + d) / 4; if (mid >= level) { segs.push([top(), right()]); segs.push([left(), bottom()]); } else { segs.push([left(), top()]); segs.push([right(), bottom()]); } break; }
      }
    }
  }
  // Chain segments by edge id
  const adj = new Map();
  for (let s = 0; s < segs.length; s++) {
    for (const e of segs[s]) { let arr = adj.get(e); if (!arr) adj.set(e, (arr = [])); arr.push(s); }
  }
  const used = new Uint8Array(segs.length);
  const lines = [];
  const walk = (startSeg, startEdge) => {
    const chain = [startEdge];
    let seg = startSeg, edge = startEdge;
    while (true) {
      used[seg] = 1;
      const [p, q] = segs[seg];
      edge = p === edge ? q : p;
      chain.push(edge);
      const nexts = adj.get(edge);
      let nxt = -1;
      for (const s of nexts) if (!used[s]) { nxt = s; break; }
      if (nxt < 0) break;
      seg = nxt;
    }
    return chain;
  };
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    const [e0] = segs[s];
    // Walk one way from e0, then if the start edge has an unused neighbour, walk the other way and join.
    const forward = walk(s, e0);
    const back = (adj.get(e0) || []).find((x) => !used[x]);
    let chain = forward;
    if (back !== undefined) {
      const bw = walk(back, e0);
      bw.shift();
      chain = bw.reverse().concat(forward);
    }
    lines.push(chain.map((e) => edgePt.get(e)));
  }
  return lines;
}

/** Box-blur a float field in place (3x3), `passes` times. Border stays as-is. */
export function blurField(f, nx, ny, passes = 1) {
  let src = f, tmp = new Float32Array(f.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1);
        tmp[j * nx + i] = (src[j * nx + i0] + src[j * nx + i] + src[j * nx + i1]) / 3;
      }
    }
    for (let j = 0; j < ny; j++) {
      const j0 = Math.max(0, j - 1), j1 = Math.min(ny - 1, j + 1);
      for (let i = 0; i < nx; i++) src[j * nx + i] = (tmp[j0 * nx + i] + tmp[j * nx + i] + tmp[j1 * nx + i]) / 3;
    }
  }
  return src;
}

/**
 * Build smooth polygons for a material mask over a sampled grid.
 * mask(i) -> 0/1. Returns polylines in world coords (closed).
 */
export function maskOutlines(sampleRes, x0, y0, step, nx, ny, maskFn) {
  const f = new Float32Array(nx * ny);
  let any = false, all = true;
  for (let i = 0; i < nx * ny; i++) { const v = maskFn(i) ? 1 : 0; f[i] = v; if (v) any = true; else all = false; }
  if (!any) return { lines: [], full: false };
  // Zero border so shapes always close within the grid.
  for (let i = 0; i < nx; i++) { f[i] = 0; f[(ny - 1) * nx + i] = 0; }
  for (let j = 0; j < ny; j++) { f[j * nx] = 0; f[j * nx + nx - 1] = 0; }
  blurField(f, nx, ny, 2);
  const lines = isolines(f, nx, ny, 0.5);
  const out = lines.map((ln) => chaikin(ln.map((p) => ({ x: x0 + p.x * step, y: y0 + p.y * step })), 1, true));
  return { lines: out, full: all };
}

/** Hillshade (0..1) field from sampled heights. */
export function hillshade(h, nx, ny, step, azimuthDeg = 315, altitudeDeg = 45, exaggeration = 1) {
  const az = (azimuthDeg * Math.PI) / 180, alt = (altitudeDeg * Math.PI) / 180;
  const lx = Math.cos(alt) * Math.sin(az), ly = -Math.cos(alt) * Math.cos(az), lz = Math.sin(alt);
  const out = new Float32Array(nx * ny);
  const s = exaggeration / (2 * step);
  for (let j = 0; j < ny; j++) {
    const jm = Math.max(0, j - 1), jp = Math.min(ny - 1, j + 1);
    for (let i = 0; i < nx; i++) {
      const im = Math.max(0, i - 1), ip = Math.min(nx - 1, i + 1);
      const dzdx = (h[j * nx + ip] - h[j * nx + im]) * s;
      const dzdy = (h[jp * nx + i] - h[jm * nx + i]) * s;
      const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const nxv = -dzdx / len, nyv = -dzdy / len, nz = 1 / len;
      out[j * nx + i] = Math.max(0, nxv * lx + nyv * ly + nz * lz);
    }
  }
  return out;
}
