// Automatic building footprints along zoned roads, road- and water-aware.
import { ROAD_TYPES, roadGeometry } from './roads.js?v=2.2.1';
import { MAT } from './terrain.js?v=2.2.1';
import { polylineLength, pointAlong, mulberry32, strHash, SpatialHash, convexOverlap, polygonsIntersect, closestOnSegment, segmentIntersection, pointInPolygon, bbox } from './geom.js?v=2.2.1';

export const BUILDING_STYLES = {
  rows:     { label: 'Terraced rows', lotW: [10, 16], depth: [12, 20], gap: [0, 0], setback: 4, jitter: 0 },
  detached: { label: 'Detached houses', lotW: [10, 14], depth: [9, 13], gap: [5, 9], setback: 7, jitter: 2 },
  mixed:    { label: 'Mixed blocks', lotW: [9, 22], depth: [10, 24], gap: [0, 6], setback: 5, jitter: 1 },
  dense:    { label: 'Dense downtown', lotW: [18, 34], depth: [18, 30], gap: [0, 3], setback: 3, jitter: 0 },
};

/**
 * Generate buildings. Returns array of { id, pts:[4], edge, h }.
 * settings: { style, density (0.2..1.5), autoBuildings }
 */
export function generateBuildings(graph, terrain, settings, obstacles = []) {
  const mapStyle = BUILDING_STYLES[settings.buildingStyle] || BUILDING_STYLES.mixed;
  const mapDensity = settings.buildingDensity ?? 1;
  const segHash = graph.segmentHash(80, { skipTunnels: true });
  const lotHash = new SpatialHash(40);
  const out = [];
  for (const o of obstacles) { if (!o.pts || o.pts.length < 3) continue; const bb = bbox(o.pts); lotHash.insert({ pts: o.pts, obstacle: true }, bb.minX - 2, bb.minY - 2, bb.maxX + 2, bb.maxY + 2); }
  const edges = [...graph.edges.values()].filter((e) => e.zoned && !e.tunnel && ROAD_TYPES[e.type]?.zoned !== undefined && e.type !== 'rail' && e.type !== 'highway' && e.type !== 'path' && !ROAD_TYPES[e.type]?.water);
  // Stable order so results are deterministic between runs
  edges.sort((a, b) => (a.id < b.id ? -1 : 1));

  // True if any road (including the lot's own street) crosses the lot or comes closer than its half width + clearance.
  const roadHitsLot = (poly, clearance) => {
    const bb = bbox(poly);
    const reach = clearance + 12;
    const items = segHash.query(bb.minX - reach, bb.minY - reach, bb.maxX + reach, bb.maxY + reach);
    for (const it of items) {
      const limit = graph.width(it.e) / 2 + clearance, l2 = limit * limit;
      // road segment end inside the lot
      if (pointInPolygon(it.ax, it.ay, poly) || pointInPolygon(it.bx, it.by, poly)) return true;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        // lot edge crosses the road centreline
        if (segmentIntersection(p.x, p.y, q.x, q.y, it.ax, it.ay, it.bx, it.by, true)) return true;
        // lot corner too close to the road
        if (closestOnSegment(p.x, p.y, it.ax, it.ay, it.bx, it.by).d2 < l2) return true;
        // road end too close to the lot edge
        if (closestOnSegment(it.ax, it.ay, p.x, p.y, q.x, q.y).d2 < l2 || closestOnSegment(it.bx, it.by, p.x, p.y, q.x, q.y).d2 < l2) return true;
      }
    }
    return false;
  };
  const badGround = (p) => {
    const m = terrain.materialAt(p.x, p.y);
    return m === MAT.WATER || m === MAT.PARK || m === MAT.FOREST || m === MAT.FARMLAND || terrain.heightAt(p.x, p.y) < terrain.seaLevel;
  };

  for (const e of edges) {
    const pts = roadGeometry(graph, e);
    const L = polylineLength(pts);
    const rnd = mulberry32(strHash(e.id));
    const half = graph.width(e) / 2;
    const st = BUILDING_STYLES[e.bstyle] || mapStyle;
    const density = e.bdensity || mapDensity;
    const setback = st.setback + half;
    for (const side of [1, -1]) {
      let s = 2 + rnd() * 4;
      let guard = 0;
      while (s < L - 4 && guard++ < 400) {
        const lotW = (st.lotW[0] + rnd() * (st.lotW[1] - st.lotW[0])) / Math.sqrt(density);
        const depth = (st.depth[0] + rnd() * (st.depth[1] - st.depth[0]));
        const gap = (st.gap[0] + rnd() * (st.gap[1] - st.gap[0])) / density;
        if (s + lotW > L - 2) break;
        const p0 = pointAlong(pts, s), p1 = pointAlong(pts, s + lotW);
        // normal (perpendicular to local tangent), side chooses left/right
        const nx0 = -p0.ty * side, ny0 = p0.tx * side;
        const nx1 = -p1.ty * side, ny1 = p1.tx * side;
        const sb = setback + rnd() * st.jitter;
        const a = { x: p0.x + nx0 * sb, y: p0.y + ny0 * sb };
        const b = { x: p1.x + nx1 * sb, y: p1.y + ny1 * sb };
        const c = { x: b.x + nx1 * depth, y: b.y + ny1 * depth };
        const d = { x: a.x + nx0 * depth, y: a.y + ny0 * depth };
        const poly = [a, b, c, d];
        const center = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
        let ok = true;
        // Skewed quads on tight curves are rejected
        const cross = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
        if (Math.abs(cross) < lotW * depth * 0.6) ok = false;
        if (ok) for (const q of [a, b, c, d, center]) if (badGround(q)) { ok = false; break; }
        if (ok && roadHitsLot(poly, 1.5)) ok = false;
        if (ok) {
          const bb = bbox(poly);
          const near = lotHash.query(bb.minX, bb.minY, bb.maxX, bb.maxY);
          for (const o of near) if (o.obstacle ? polygonsIntersect(poly, o.pts) : convexOverlap(poly, o.pts)) { ok = false; break; }
        }
        if (ok) {
          const bld = { id: `${e.id}:${side}:${out.length}`, pts: poly, edge: e.id, h: 1 + Math.floor(rnd() * 4) };
          const bb = bbox(poly);
          lotHash.insert(bld, bb.minX, bb.minY, bb.maxX, bb.maxY);
          out.push(bld);
          s += lotW + gap;
        } else {
          s += Math.max(3, lotW * 0.5);
        }
      }
    }
  }
  return out;
}
