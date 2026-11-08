// Scene renderer with Canvas and SVG painters. All geometry passed to painters is in world meters.
import { CELL, MAT, maskOutlines, isolines, cellRanges, hillshade } from './terrain.js?v=2.2.1';
import { ROAD_TYPES, roadGeometry } from './roads.js?v=2.2.1';
export { roadGeometry };
import { STYLES, PLACE_CATEGORIES, LABEL_KINDS } from './styles.js?v=2.2.1';
import { chaikin, polylineLength, pointAlong, hash2 } from './geom.js?v=2.2.1';

export const FONT = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";

/** View: world center (cx, cy), scale px/m, viewport size w,h in px. */
/** View: world centre (cx, cy), scale px/m, viewport w×h px, rot = view rotation in radians (clockwise on screen). */
export function worldToScreen(view, x, y) {
  const dx = (x - view.cx) * view.scale, dy = (y - view.cy) * view.scale;
  if (!view.rot) return { x: dx + view.w / 2, y: dy + view.h / 2 };
  const c = Math.cos(view.rot), s = Math.sin(view.rot);
  return { x: dx * c - dy * s + view.w / 2, y: dx * s + dy * c + view.h / 2 };
}
export function screenToWorld(view, sx, sy) {
  const dx = sx - view.w / 2, dy = sy - view.h / 2;
  if (!view.rot) return { x: dx / view.scale + view.cx, y: dy / view.scale + view.cy };
  const c = Math.cos(view.rot), s = Math.sin(view.rot);
  return { x: (dx * c + dy * s) / view.scale + view.cx, y: (-dx * s + dy * c) / view.scale + view.cy };
}
/** World-space bounding box of the (possibly rotated) viewport. */
export function viewBounds(view) {
  const cs = [screenToWorld(view, 0, 0), screenToWorld(view, view.w, 0), screenToWorld(view, 0, view.h), screenToWorld(view, view.w, view.h)];
  return { minX: Math.min(...cs.map((p) => p.x)), minY: Math.min(...cs.map((p) => p.y)), maxX: Math.max(...cs.map((p) => p.x)), maxY: Math.max(...cs.map((p) => p.y)) };
}

// ---------------- Canvas painter ----------------
export class CanvasPainter {
  constructor(ctx, view) { this.ctx = ctx; this.view = view; this.scale = view.scale; }
  _path(polys, closed) {
    const { ctx, view } = this;
    ctx.beginPath();
    for (const poly of polys) {
      if (poly.length < 2) continue;
      for (let i = 0; i < poly.length; i++) {
        const p = worldToScreen(view, poly[i].x, poly[i].y);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      if (closed) ctx.closePath();
    }
  }
  fillPolys(polys, color, o = {}) {
    const { ctx } = this;
    if (!polys.length) return;
    this._path(polys, true);
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.fillStyle = color;
    ctx.fill(o.rule || 'evenodd');
    ctx.globalAlpha = 1;
  }
  strokePolys(polys, o) {
    const { ctx } = this;
    if (!polys.length) return;
    let w = (o.width || 0) * this.scale;
    if (o.minPx != null && w < o.minPx) w = o.minPx;
    if (o.px) w = o.px;
    this._path(polys, !!o.closed);
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.strokeStyle = o.color;
    ctx.lineWidth = w;
    ctx.lineCap = o.cap || 'round';
    ctx.lineJoin = o.join || 'round';
    ctx.setLineDash(o.dash ? o.dash.map((d) => d * Math.max(w, 1)) : []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  image(canvas, x, y, w, h, alpha = 1, op = 'source-over') {
    const { ctx, view } = this;
    const p = worldToScreen(view, x, y);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.imageSmoothingEnabled = true;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (view.rot) ctx.rotate(view.rot);
    ctx.drawImage(canvas, 0, 0, w * this.scale, h * this.scale);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  text(str, x, y, o) {
    const { ctx, view } = this;
    const p = worldToScreen(view, x, y);
    ctx.save();
    ctx.translate(p.x, p.y);
    let angle = o.angle || 0;
    if (o.worldAngle) {
      angle += view.rot || 0;
      if (o.readable !== false) { while (angle > Math.PI / 2) angle -= Math.PI; while (angle < -Math.PI / 2) angle += Math.PI; }
    }
    if (angle) ctx.rotate(angle);
    ctx.font = `${o.italic ? 'italic ' : ''}${o.weight || 500} ${o.size}px ${FONT}`;
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = o.baseline || 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.spacing || 0}px`;
    ctx.globalAlpha = o.alpha ?? 1;
    if (o.halo) { ctx.lineJoin = 'round'; ctx.strokeStyle = o.halo; ctx.lineWidth = o.haloWidth || Math.max(2.5, o.size * 0.22); ctx.strokeText(str, 0, 0); }
    ctx.fillStyle = o.color;
    ctx.fillText(str, 0, 0);
    ctx.restore();
  }
  circle(x, y, rPx, o) {
    const { ctx, view } = this;
    const p = worldToScreen(view, x, y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, rPx, 0, Math.PI * 2);
    if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
    if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.px || 1.5; ctx.stroke(); }
  }
  /** Circles at world positions, radius in world units (used for forest dots). */
  dots(points, rWorld, color) {
    const { ctx, view } = this;
    const r = Math.max(0.6, rWorld * this.scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const q of points) { const p = worldToScreen(view, q.x, q.y); ctx.moveTo(p.x + r, p.y); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); }
    ctx.fill();
  }
}

// ---------------- SVG painter ----------------
export class SvgPainter {
  constructor(bounds, scale) {
    this.scale = scale; this.b = bounds; this.parts = []; this.defs = [];
    this.w = (bounds.maxX - bounds.minX) * scale; this.h = (bounds.maxY - bounds.minY) * scale;
  }
  _d(polys, closed) {
    let d = '';
    for (const poly of polys) {
      if (poly.length < 2) continue;
      d += `M${f(poly[0].x)} ${f(poly[0].y)}`;
      for (let i = 1; i < poly.length; i++) d += `L${f(poly[i].x)} ${f(poly[i].y)}`;
      if (closed) d += 'Z';
    }
    return d;
  }
  fillPolys(polys, color, o = {}) {
    if (!polys.length) return;
    this.parts.push(`<path d="${this._d(polys, true)}" fill="${color}" fill-rule="${o.rule || 'evenodd'}"${o.alpha != null && o.alpha !== 1 ? ` fill-opacity="${o.alpha}"` : ''}/>`);
  }
  strokePolys(polys, o) {
    if (!polys.length) return;
    let w = (o.width || 0);
    if (o.minPx != null && w * this.scale < o.minPx) w = o.minPx / this.scale;
    if (o.px) w = o.px / this.scale;
    const dash = o.dash ? ` stroke-dasharray="${o.dash.map((d) => f(d * w)).join(' ')}"` : '';
    this.parts.push(`<path d="${this._d(polys, !!o.closed)}" fill="none" stroke="${o.color}" stroke-width="${f(w)}" stroke-linecap="${o.cap || 'round'}" stroke-linejoin="${o.join || 'round'}"${dash}${o.alpha != null && o.alpha !== 1 ? ` stroke-opacity="${o.alpha}"` : ''}/>`);
  }
  image(canvas, x, y, w, h, alpha = 1, op = 'source-over') {
    const url = canvas.toDataURL('image/png');
    const blend = op === 'multiply' ? ' style="mix-blend-mode:multiply"' : '';
    this.parts.push(`<image href="${url}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" opacity="${alpha}" preserveAspectRatio="none" image-rendering="optimizeQuality"${blend}/>`);
  }
  text(str, x, y, o) {
    const size = o.size / this.scale;
    const anchor = o.align === 'left' ? 'start' : o.align === 'right' ? 'end' : 'middle';
    const base = o.baseline === 'top' ? 'hanging' : o.baseline === 'bottom' ? 'auto' : 'central';
    const tf = o.angle ? ` transform="translate(${f(x)} ${f(y)}) rotate(${f((o.angle * 180) / Math.PI)})"` : ` transform="translate(${f(x)} ${f(y)})"`;
    const common = `font-family="${FONT.replace(/'/g, '')}" font-size="${f(size)}" font-weight="${o.weight || 500}"${o.italic ? ' font-style="italic"' : ''} text-anchor="${anchor}" dominant-baseline="${base}"${o.spacing ? ` letter-spacing="${f(o.spacing / this.scale)}"` : ''}`;
    const t = esc(str);
    let s = '';
    if (o.halo) s += `<text ${common}${tf} fill="none" stroke="${o.halo}" stroke-width="${f((o.haloWidth || Math.max(2.5, o.size * 0.22)) / this.scale)}" stroke-linejoin="round">${t}</text>`;
    s += `<text ${common}${tf} fill="${o.color}">${t}</text>`;
    this.parts.push(s);
  }
  circle(x, y, rPx, o) {
    this.parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(rPx / this.scale)}" fill="${o.fill || 'none'}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${f((o.px || 1.5) / this.scale)}"` : ''}/>`);
  }
  dots(points, rWorld, color) {
    let s = `<g fill="${color}">`;
    for (const q of points) s += `<circle cx="${f(q.x)}" cy="${f(q.y)}" r="${f(rWorld)}"/>`;
    this.parts.push(s + '</g>');
  }
  toString(bg) {
    const { b } = this;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.round(this.w)}" height="${Math.round(this.h)}" viewBox="${f(b.minX)} ${f(b.minY)} ${f(b.maxX - b.minX)} ${f(b.maxY - b.minY)}">\n<rect x="${f(b.minX)}" y="${f(b.minY)}" width="${f(b.maxX - b.minX)}" height="${f(b.maxY - b.minY)}" fill="${bg}"/>\n${this.parts.join('\n')}\n</svg>`;
  }
}
const f = (v) => (Math.round(v * 100) / 100).toString();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ---------------- Terrain layer ----------------
/**
 * Render terrain (land, materials, hillshade, water, contours) for a world region.
 * region {minX,minY,maxX,maxY}; scale px/m used to pick sampling density.
 */
export function renderTerrain(painter, doc, region, scale, opts = {}) {
  const S = STYLES[doc.settings.style] || STYLES.atlas;
  const T = doc.terrain;
  const maxSamples = opts.maxSamples || 520;
  const W = region.maxX - region.minX, H = region.maxY - region.minY;
  let step = Math.max(CELL / 2, Math.max(W, H) / maxSamples);
  if (scale < 1.5) step = Math.max(step, CELL);
  const nx = Math.ceil(W / step) + 3, ny = Math.ceil(H / step) + 3;
  const x0 = region.minX - step, y0 = region.minY - step;
  const { h, m } = T.sample(x0, y0, step, nx, ny);
  const sea = T.seaLevel;

  // Land base
  painter.fillPolys([[{ x: region.minX, y: region.minY }, { x: region.maxX, y: region.minY }, { x: region.maxX, y: region.maxY }, { x: region.minX, y: region.maxY }]], S.land, { rule: 'nonzero' });

  // Painted materials (non-water)
  const matLayers = [[MAT.FARMLAND, S.farmland], [MAT.SAND, S.sand], [MAT.PAVED, S.paved], [MAT.PARK, S.park], [MAT.FOREST, S.forest]];
  const forestLines = [];
  for (const [id, color] of matLayers) {
    const { lines } = maskOutlines(step, x0, y0, step, nx, ny, (i) => m[i] === id);
    if (lines.length) painter.fillPolys(lines, color);
    if (id === MAT.FOREST && lines.length) forestLines.push(...lines);
  }
  // Forest tree dots (only at readable zoom)
  if (scale >= 0.5 && doc.settings.showTrees !== false) {
    const pts = [];
    const spacing = Math.max(CELL, 6);
    const i0 = Math.floor(region.minX / spacing), i1 = Math.ceil(region.maxX / spacing);
    const j0 = Math.floor(region.minY / spacing), j1 = Math.ceil(region.maxY / spacing);
    if ((i1 - i0) * (j1 - j0) < 400000) {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const r1 = hash2(i, j, 7);
        if (r1 > 0.45) continue;
        const px = (i + 0.2 + hash2(i, j, 3) * 0.6) * spacing, py = (j + 0.2 + hash2(i, j, 5) * 0.6) * spacing;
        if (T.materialAt(px, py) === MAT.FOREST) pts.push({ x: px, y: py });
      }
      if (pts.length) painter.dots(pts, 1.3, S.forestDot);
    }
  }

  // Farmland field lines: a patchwork of blocks with alternating row direction
  if (scale >= 0.45) {
    const rowGap = 6, stepAlong = 6, block = 180;
    const lines = [];
    const i0 = Math.floor(region.minX / rowGap) - 1, i1 = Math.ceil(region.maxX / rowGap) + 1;
    const j0 = Math.floor(region.minY / rowGap) - 1, j1 = Math.ceil(region.maxY / rowGap) + 1;
    if ((i1 - i0) * (j1 - j0) < 1000000) {
      const horizontal = (x, y) => hash2(Math.floor(x / block), Math.floor(y / block), 11) < 0.5;
      const farm = (x, y) => T.materialAt(x, y) === MAT.FARMLAND;
      for (let j = j0; j <= j1; j++) {
        const y = j * rowGap + rowGap / 2;
        let run = null;
        for (let x = region.minX; x <= region.maxX + stepAlong; x += stepAlong) {
          const on = farm(x, y) && horizontal(x, y);
          if (on) { if (!run) run = [{ x, y }]; else run.push({ x, y }); }
          else if (run) { if (run.length > 1) lines.push(run); run = null; }
        }
        if (run && run.length > 1) lines.push(run);
      }
      for (let i = i0; i <= i1; i++) {
        const x = i * rowGap + rowGap / 2;
        let run = null;
        for (let y = region.minY; y <= region.maxY + stepAlong; y += stepAlong) {
          const on = farm(x, y) && !horizontal(x, y);
          if (on) { if (!run) run = [{ x, y }]; else run.push({ x, y }); }
          else if (run) { if (run.length > 1) lines.push(run); run = null; }
        }
        if (run && run.length > 1) lines.push(run);
      }
      if (lines.length) painter.strokePolys(lines, { color: S.farmLine, width: 0, px: 1, cap: 'butt', alpha: 0.8 });
    }
  }

  // Hillshade overlay
  if (doc.settings.showHillshade && opts.canvasFactory) {
    const sh = hillshade(h, nx, ny, step, 315, 45, doc.settings.exaggeration || 1.6);
    const cv = opts.canvasFactory(nx, ny);
    const cx = cv.getContext('2d');
    const img = cx.createImageData(nx, ny);
    const strength = S.hillshadeStrength;
    const dark = parseRGB(S.hillshadeDark), light = parseRGB(S.hillshadeLight);
    let any = false;
    for (let i = 0; i < nx * ny; i++) {
      const isWater = m[i] === MAT.WATER || h[i] < sea;
      const s = sh[i];
      let a = 0, c = dark;
      if (!isWater) {
        if (s < 0.7) { a = (0.7 - s) / 0.7 * strength; c = dark; }
        else { a = (s - 0.7) / 0.3 * strength * 0.5; c = light; }
      }
      if (a > 0.004) any = true;
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
    }
    if (any) {
      cx.putImageData(img, 0, 0);
      painter.image(cv, x0 - step / 2, y0 - step / 2, nx * step, ny * step, 1);
    }
  }

  // Water (painted or below sea level)
  const water = maskOutlines(step, x0, y0, step, nx, ny, (i) => m[i] === MAT.WATER || h[i] < sea);
  // Water channels (river-type roads) belong to the same body of water: outlines of both first, then fills of both,
  // so a channel merges seamlessly where it meets a lake or the sea.
  const channels = new Map(); // width -> polylines
  if (doc.roads) for (const e of doc.roads.edges.values()) {
    if (!ROAD_TYPES[e.type]?.water) continue;
    const w = doc.roads.width(e);
    if (!channels.has(w)) channels.set(w, []);
    channels.get(w).push(roadGeometry(doc.roads, e));
  }
  if (water.lines.length) painter.strokePolys(water.lines, { color: S.waterEdge, width: 0, minPx: 2, closed: true, alpha: 0.9 });
  for (const [w, polys] of channels) painter.strokePolys(polys, { color: S.waterEdge, width: w + 2 / scale, minPx: 2, alpha: 0.9 });
  if (water.lines.length) painter.fillPolys(water.lines, S.water);
  for (const [w, polys] of channels) painter.strokePolys(polys, { color: S.water, width: w, minPx: 1 });

  // Contours
  if (doc.settings.showContours) {
    const interval = doc.settings.contourInterval || 5;
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < h.length; i++) { if (h[i] < minH) minH = h[i]; if (h[i] > maxH) maxH = h[i]; }
    if (maxH - minH > 0.05) {
      const lv0 = Math.ceil(Math.max(minH, sea) / interval), lv1 = Math.floor(maxH / interval);
      const maxLevels = 80;
      const labels = [];
      const range = cellRanges(h, nx, ny);
      for (let k = lv0; k <= lv1 && k - lv0 < maxLevels; k++) {
        const level = k * interval;
        if (level <= sea + 1e-6 && minH < sea) continue; // shoreline is drawn as the water edge
        const lines = isolines(h, nx, ny, level, range).map((ln) => chaikin(ln.map((p) => ({ x: x0 + p.x * step, y: y0 + p.y * step })), 1, false));
        const isIndex = k % 5 === 0;
        painter.strokePolys(lines, { color: isIndex ? S.contourIndex : S.contour, width: 0, minPx: isIndex ? 1.4 : 0.8, alpha: S.contourAlpha });
        if (isIndex && doc.settings.contourLabels !== false && scale >= 0.35) {
          for (const ln of lines) {
            const L = polylineLength(ln);
            if (L * scale < 220) continue;
            const n = Math.max(1, Math.floor((L * scale) / 900));
            for (let q = 0; q < n; q++) {
              const p = pointAlong(ln, (L * (q + 0.5)) / n);
              let ang = Math.atan2(p.ty, p.tx);
              if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
              labels.push({ x: p.x, y: p.y, ang, text: String(Math.round(level)) });
            }
          }
        }
      }
      for (const lb of labels) painter.text(lb.text, lb.x, lb.y, { size: 10, color: S.contourLabel, halo: S.land, haloWidth: 3, angle: lb.ang, worldAngle: true, weight: 600 });
    }
  }
}

function parseRGB(s) {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(',').map((v) => parseFloat(v));
  const h = s.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ---------------- Feature layers ----------------
export function renderRoads(painter, doc, scale, bounds) {
  const S = STYLES[doc.settings.style] || STYLES.atlas;
  const g = doc.roads;
  const byType = new Map();
  for (const e of g.edges.values()) {
    if (ROAD_TYPES[e.type]?.water) continue; // drawn with the terrain water layer
    const pts = roadGeometry(g, e);
    let vis = !bounds;
    if (bounds) for (const p of pts) if (p.x >= bounds.minX - 50 && p.x <= bounds.maxX + 50 && p.y >= bounds.minY - 50 && p.y <= bounds.maxY + 50) { vis = true; break; }
    if (!vis) continue;
    const key = `${e.type}|${g.width(e)}|${e.tunnel ? 't' : ''}`;
    if (!byType.has(key)) byType.set(key, { type: e.type, width: g.width(e), rank: e.tunnel ? -1 : (ROAD_TYPES[e.type]?.rank ?? 1), tunnel: !!e.tunnel, polys: [], edges: [] });
    const grp = byType.get(key);
    grp.polys.push(pts); grp.edges.push(e);
  }
  renderRoundabouts(painter, doc, scale, bounds, 'casing');
  const groups = [...byType.values()].sort((a, b) => a.rank - b.rank || a.width - b.width);
  // casings by rank then fills by rank: group by rank
  const ranks = [...new Set(groups.map((x) => x.rank))].sort((a, b) => a - b);
  for (const r of ranks) {
    const gs = groups.filter((x) => x.rank === r);
    for (const grp of gs) {
      const rs = S.roads[grp.type] || S.roads.street;
      if (grp.tunnel) {
        // Tunnels: dashed casing, faded fill, drawn beneath everything else
        painter.strokePolys(grp.polys, { color: rs.rail ? rs.fill : rs.casing, width: grp.width + 2 / scale, minPx: 2, dash: [0.5, 0.5], cap: 'butt', alpha: 0.9 });
        painter.strokePolys(grp.polys, { color: rs.rail ? S.land : rs.fill, width: grp.width, minPx: 1, cap: 'butt' });
        painter.strokePolys(grp.polys, { color: S.land, width: grp.width, minPx: 1, cap: 'butt', alpha: 0.5 });
        continue;
      }
      if (rs.rail) continue;
      const casingPx = scale * grp.width < 3 ? 0 : 2;
      painter.strokePolys(grp.polys, { color: rs.casing, width: grp.width + casingPx / scale, minPx: 1.5, dash: rs.dash });
    }
    for (const grp of gs) {
      const rs = S.roads[grp.type] || S.roads.street;
      if (grp.tunnel) continue;
      if (rs.rail) {
        painter.strokePolys(grp.polys, { color: rs.fill, width: grp.width, minPx: 1.2, cap: 'butt' });
        painter.strokePolys(grp.polys, { color: rs.casing, width: grp.width * 0.5, minPx: 0.6, dash: [2.5, 2.5], cap: 'butt' });
        continue;
      }
      painter.strokePolys(grp.polys, { color: rs.fill, width: grp.width, minPx: 1, dash: rs.dash });
    }
  }
  renderRoundabouts(painter, doc, scale, bounds, 'fill');
}

/** Roundabouts: ring road around the junction node plus a central island. phase: 'casing' (under road fills) or 'fill'. */
export function renderRoundabouts(painter, doc, scale, bounds, phase = 'fill') {
  const S = STYLES[doc.settings.style] || STYLES.atlas;
  for (const ra of doc.roads.roundabouts()) {
    const { node: n, r, width, type } = ra;
    if (bounds && (n.x < bounds.minX - r - 50 || n.x > bounds.maxX + r + 50 || n.y < bounds.minY - r - 50 || n.y > bounds.maxY + r + 50)) continue;
    const rs = S.roads[type] || S.roads.street;
    const ring = [];
    const k = Math.max(24, Math.round(r * 2));
    for (let i = 0; i <= k; i++) { const a = (i / k) * Math.PI * 2; ring.push({ x: n.x + Math.cos(a) * r, y: n.y + Math.sin(a) * r }); }
    const casingPx = scale * width < 3 ? 0 : 2;
    if (phase === 'casing') { painter.strokePolys([ring], { color: rs.casing, width: width + casingPx / scale, minPx: 1.5, closed: true }); continue; }
    // Ring fill over the approach roads, then the island covering the middle
    painter.strokePolys([ring], { color: rs.fill, width, minPx: 1, closed: true });
    const island = r - width / 2;
    if (island > 1) {
      const isl = ring.map((p) => ({ x: n.x + (p.x - n.x) * (island / r), y: n.y + (p.y - n.y) * (island / r) }));
      painter.fillPolys([isl], S.roundaboutIsland || S.park, { rule: 'nonzero' });
      painter.strokePolys([isl], { color: rs.casing, width: 0, minPx: 1, closed: true, alpha: 0.8 });
    }
  }
}

export function renderBuildings(painter, doc, buildings, scale, bounds) {
  if (!buildings || !buildings.length || scale < 0.25) return;
  const S = STYLES[doc.settings.style] || STYLES.atlas;
  const polys = [];
  for (const b of buildings) {
    if (bounds) { const p = b.pts[0]; if (p.x < bounds.minX - 60 || p.x > bounds.maxX + 60 || p.y < bounds.minY - 60 || p.y > bounds.maxY + 60) continue; }
    polys.push(b.pts);
  }
  painter.fillPolys(polys, S.building, { rule: 'nonzero' });
  if (scale >= 0.6) painter.strokePolys(polys, { color: S.buildingEdge, width: 0, minPx: 0.8, closed: true, join: 'miter' });
}

export function renderRoadLabels(painter, doc, scale, bounds) {
  if (scale < 0.7) return;
  const S = STYLES[doc.settings.style] || STYLES.atlas;
  const g = doc.roads;
  const done = new Set();
  for (const e of g.edges.values()) {
    if (!e.name) continue;
    const pts = roadGeometry(g, e);
    const L = polylineLength(pts);
    const size = 11;
    const textW = e.name.length * size * 0.6;
    if (L * scale < textW + 20) continue;
    const p = pointAlong(pts, L / 2);
    if (bounds && (p.x < bounds.minX || p.x > bounds.maxX || p.y < bounds.minY || p.y > bounds.maxY)) continue;
    // One label per name within a 350 px neighbourhood
    const cellPx = 350 / scale;
    const key = `${e.name}|${Math.floor(p.x / cellPx)}|${Math.floor(p.y / cellPx)}`;
    if (done.has(key)) continue;
    done.add(key);
    let ang = Math.atan2(p.ty, p.tx);
    if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
    const water = ROAD_TYPES[e.type]?.water;
    painter.text(e.name, p.x, p.y, { size, color: water ? S.labelColors.water : S.roadLabel, halo: water ? S.labelColors.halo : S.roadLabelHalo, angle: ang, worldAngle: true, weight: 500, italic: !!water });
  }
}

export function renderPlaces(painter, doc, scale, bounds) {
  const S = STYLES[doc.settings.style] || STYLES.atlas;
  for (const p of doc.places) {
    if (bounds && (p.x < bounds.minX - 50 || p.x > bounds.maxX + 50 || p.y < bounds.minY - 50 || p.y > bounds.maxY + 50)) continue;
    const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.landmark;
    if (scale < 0.3) { painter.circle(p.x, p.y, 3, { fill: cat.color, stroke: S.place.halo, px: 1 }); continue; }
    painter.circle(p.x, p.y, 9, { fill: cat.color, stroke: S.place.halo, px: 2 });
    painter.text(cat.glyph, p.x, p.y, { size: 10, color: '#ffffff', weight: 700 });
    if (p.name) painter.text(p.name, p.x, p.y + 15 / scale, { size: 11, color: S.place.text, halo: S.place.halo, weight: 600, baseline: 'top' });
  }
}

export function renderLabels(painter, doc, scale, bounds) {
  const S = STYLES[doc.settings.style] || STYLES.atlas;
  for (const l of doc.labels) {
    if (bounds && (l.x < bounds.minX - 400 || l.x > bounds.maxX + 400 || l.y < bounds.minY - 100 || l.y > bounds.maxY + 100)) continue;
    const k = LABEL_KINDS[l.kind] || LABEL_KINDS.district;
    const size = (l.size || k.size);
    const text = k.upper ? l.text.toUpperCase() : l.text;
    painter.text(text, l.x, l.y, { size, color: S.labelColors[l.kind] || S.labelColors.district, halo: S.labelColors.halo, weight: k.weight, italic: k.italic, spacing: k.spacing, angle: (l.angle || 0) * Math.PI / 180 });
  }
}

/** Compass rose. (cx,cy) world centre, rPx radius in screen pixels. */
export function renderCompass(painter, cx, cy, rPx, scale, bearingDeg, S) {
  const r = rPx / scale;
  const b = ((bearingDeg || 0) * Math.PI) / 180;
  const nx = -Math.sin(b), ny = -Math.cos(b);      // north direction on the map (y down)
  const ex = Math.cos(b), ey = -Math.sin(b);        // east
  const P = (dn, de) => ({ x: cx + nx * r * dn + ex * r * de, y: cy + ny * r * dn + ey * r * de });
  painter.circle(cx, cy, rPx, { fill: S.compassBg || 'rgba(255,255,255,0.85)', stroke: S.compassRing || '#8a8578', px: 1 });
  painter.circle(cx, cy, rPx * 0.78, { stroke: S.compassRing || '#8a8578', px: 0.6 });
  // Cardinal ticks
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2;
    const dn = Math.cos(ang), de = Math.sin(ang);
    painter.strokePolys([[P(dn * 0.78, de * 0.78), P(dn * 0.98, de * 0.98)]], { color: S.compassRing || '#8a8578', px: 1 });
  }
  painter.fillPolys([[P(0.72, 0), P(0, 0.14), P(0, -0.14)]], S.compassNorth || '#d9462f', { rule: 'nonzero' });
  painter.fillPolys([[P(-0.72, 0), P(0, 0.14), P(0, -0.14)]], S.compassSouth || '#5f5b53', { rule: 'nonzero' });
  painter.fillPolys([[P(0, 0.72), P(0.14, 0), P(-0.14, 0)], [P(0, -0.72), P(0.14, 0), P(-0.14, 0)]], S.compassSouth || '#5f5b53', { rule: 'nonzero', alpha: 0.45 });
  painter.circle(cx, cy, rPx * 0.08, { fill: '#fff', stroke: S.compassSouth || '#5f5b53', px: 1 });
  const n = P(1.25, 0);
  painter.text('N', n.x, n.y, { size: Math.max(9, rPx * 0.55), color: S.compassText || '#2a2622', halo: S.compassBg || '#ffffff', weight: 700, angle: -b, worldAngle: true, readable: false });
}

/** Full scene for export. */
export function renderScene(painter, doc, buildings, scale, bounds, opts = {}) {
  renderTerrain(painter, doc, bounds, scale, { canvasFactory: opts.canvasFactory, maxSamples: opts.maxSamples || 1400 });
  renderRoads(painter, doc, scale, null);
  renderBuildings(painter, doc, buildings, scale, null);
  renderRoadLabels(painter, doc, scale, null);
  renderPlaces(painter, doc, scale, null);
  renderLabels(painter, doc, scale, null);
  if (doc.settings.showCompass) renderCompass(painter, bounds.maxX - 60 / scale, bounds.minY + 60 / scale, 28, scale, doc.settings.northBearing, STYLES[doc.settings.style] || STYLES.atlas);
}
