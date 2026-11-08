// Georeferenced exports: GeoJSON, OpenStreetMap XML, and an ESRI ASCII grid of the terrain.
import { CELL, MAT, maskOutlines, isolines, cellRanges, TILE, TILE_M } from './terrain.js?v=2.2.2';
import { roadGeometry } from './roads.js?v=2.2.2';
import { chaikin, pointInPolygon, polygonArea } from './geom.js?v=2.2.2';

const M_PER_DEG = 111320;

/** Converter from world metres (y south) to [lon, lat] using the map's origin and north bearing. */
export function makeGeo(settings) {
  const lat0 = +settings.originLat || 0, lon0 = +settings.originLon || 0;
  const b = ((+settings.northBearing || 0) * Math.PI) / 180;
  const cosB = Math.cos(b), sinB = Math.sin(b);
  const lonScale = M_PER_DEG * Math.max(0.05, Math.cos((lat0 * Math.PI) / 180));
  return (x, y) => {
    const up = -y; // "up" on the map points to the north bearing
    const east = x * cosB + up * sinB;
    const north = -x * sinB + up * cosB;
    return [+(lon0 + east / lonScale).toFixed(7), +(lat0 + north / M_PER_DEG).toFixed(7)];
  };
}

const ROAD_TAGS = {
  path: { highway: 'footway' },
  street: { highway: 'residential' },
  avenue: { highway: 'secondary' },
  highway: { highway: 'trunk' },
  rail: { railway: 'rail' },
  river: { waterway: 'river' },
};
const MAT_TAGS = {
  [MAT.PARK]: { leisure: 'park' },
  [MAT.FOREST]: { natural: 'wood', landuse: 'forest' },
  [MAT.SAND]: { natural: 'sand' },
  [MAT.PAVED]: { highway: 'pedestrian', area: 'yes', surface: 'paved' },
  [MAT.FARMLAND]: { landuse: 'farmland' },
  [MAT.WATER]: { natural: 'water' },
};
const MAT_KIND = { [MAT.PARK]: 'park', [MAT.FOREST]: 'forest', [MAT.SAND]: 'sand', [MAT.PAVED]: 'paved', [MAT.WATER]: 'water', [MAT.FARMLAND]: 'farmland' };
export const PLACE_TAGS = {
  cafe: { amenity: 'cafe' }, restaurant: { amenity: 'restaurant' }, bar: { amenity: 'pub' }, bakery: { shop: 'bakery' },
  shop: { shop: 'yes' }, mall: { shop: 'mall' }, supermarket: { shop: 'supermarket' }, market: { amenity: 'marketplace' },
  station: { railway: 'station', public_transport: 'station' }, metro: { railway: 'station', station: 'subway' }, bus: { highway: 'bus_stop' }, airport: { aeroway: 'aerodrome' }, harbor: { amenity: 'ferry_terminal' }, parking: { amenity: 'parking' }, fuel: { amenity: 'fuel' },
  hospital: { amenity: 'hospital' }, pharmacy: { amenity: 'pharmacy' }, police: { amenity: 'police' }, fire: { amenity: 'fire_station' }, post: { amenity: 'post_office' }, townhall: { amenity: 'townhall' }, library: { amenity: 'library' }, bank: { amenity: 'bank' },
  school: { amenity: 'school' }, university: { amenity: 'university' },
  museum: { tourism: 'museum' }, theatre: { amenity: 'theatre' }, cinema: { amenity: 'cinema' }, stadium: { leisure: 'stadium' }, gym: { leisure: 'sports_centre' }, park: { leisure: 'park' }, playground: { leisure: 'playground' }, zoo: { tourism: 'zoo' }, beach: { natural: 'beach' },
  church: { amenity: 'place_of_worship', religion: 'christian' }, mosque: { amenity: 'place_of_worship', religion: 'muslim' }, temple: { amenity: 'place_of_worship' }, cemetery: { landuse: 'cemetery' },
  hotel: { tourism: 'hotel' }, campsite: { tourism: 'camp_site' },
  industrial: { landuse: 'industrial' }, factory: { man_made: 'works' }, warehouse: { building: 'warehouse' }, port: { landuse: 'port' }, power: { power: 'plant' }, farm: { landuse: 'farmyard' }, mine: { landuse: 'quarry' }, construction: { landuse: 'construction' }, office: { office: 'yes' },
  landmark: { tourism: 'attraction' }, monument: { historic: 'monument' }, castle: { historic: 'castle' }, lighthouse: { man_made: 'lighthouse' }, viewpoint: { tourism: 'viewpoint' }, peak: { natural: 'peak' }, cave: { natural: 'cave_entrance' }, waterfall: { waterway: 'waterfall' },
};
const LABEL_TAGS = { city: { place: 'city' }, district: { place: 'suburb' }, water: { place: 'locality', natural: 'water' }, park: { place: 'locality', leisure: 'park' } };

/** Sample the terrain over bounds and build polygons per material and contour lines. */
function terrainVectors(doc, bounds, maxSamples = 1400) {
  const T = doc.terrain;
  const W = bounds.maxX - bounds.minX, H = bounds.maxY - bounds.minY;
  const step = Math.max(CELL, Math.max(W, H) / maxSamples);
  const nx = Math.ceil(W / step) + 3, ny = Math.ceil(H / step) + 3;
  const x0 = bounds.minX - step, y0 = bounds.minY - step;
  const { h, m } = T.sample(x0, y0, step, nx, ny);
  const sea = T.seaLevel;
  const areas = []; // {kind, rings:[outer, ...holes]}
  const layers = [[MAT.FARMLAND, (i) => m[i] === MAT.FARMLAND], [MAT.SAND, (i) => m[i] === MAT.SAND], [MAT.PAVED, (i) => m[i] === MAT.PAVED], [MAT.PARK, (i) => m[i] === MAT.PARK], [MAT.FOREST, (i) => m[i] === MAT.FOREST], [MAT.WATER, (i) => m[i] === MAT.WATER || h[i] < sea]];
  for (const [id, fn] of layers) {
    const { lines } = maskOutlines(step, x0, y0, step, nx, ny, fn);
    for (const poly of nestRings(lines)) areas.push({ kind: MAT_KIND[id], mat: id, rings: poly });
  }
  const contours = [];
  if (doc.settings.showContours) {
    const interval = doc.settings.contourInterval || 5;
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < h.length; i++) { if (h[i] < minH) minH = h[i]; if (h[i] > maxH) maxH = h[i]; }
    if (maxH - minH > 0.05) {
      const range = cellRanges(h, nx, ny);
      for (let k = Math.ceil(Math.max(minH, sea) / interval); k <= Math.floor(maxH / interval); k++) {
        const level = k * interval;
        if (level <= sea + 1e-6 && minH < sea) continue;
        for (const ln of isolines(h, nx, ny, level, range)) contours.push({ ele: level, index: k % 5 === 0, pts: chaikin(ln.map((p) => ({ x: x0 + p.x * step, y: y0 + p.y * step })), 1, false) });
      }
    }
  }
  return { areas, contours };
}

/** Group closed rings into polygons with holes (odd nesting depth = hole). */
function nestRings(rings) {
  const info = rings.filter((r) => r.length >= 4).map((r) => ({ r, area: Math.abs(polygonArea(r)), depth: 0, parent: -1 }));
  for (let i = 0; i < info.length; i++) {
    const p = info[i].r[0];
    let best = -1;
    for (let j = 0; j < info.length; j++) {
      if (i === j || info[j].area <= info[i].area) continue;
      if (pointInPolygon(p.x, p.y, info[j].r)) { info[i].depth++; if (best < 0 || info[j].area < info[best].area) best = j; }
    }
    info[i].parent = best;
  }
  const polys = [];
  const outerIndex = new Map();
  for (let i = 0; i < info.length; i++) if (info[i].depth % 2 === 0) { outerIndex.set(i, polys.length); polys.push([info[i].r]); }
  for (let i = 0; i < info.length; i++) if (info[i].depth % 2 === 1 && outerIndex.has(info[i].parent)) polys[outerIndex.get(info[i].parent)].push(info[i].r);
  return polys;
}

function contentBounds(doc, buildings) {
  const bs = [doc.terrain.bounds(), doc.roads.bounds()].filter(Boolean);
  const pts = [...doc.places, ...doc.labels];
  if (pts.length) bs.push({ minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) });
  void buildings;
  if (!bs.length) return { minX: -500, minY: -400, maxX: 500, maxY: 400 };
  const b = { minX: Math.min(...bs.map((x) => x.minX)), minY: Math.min(...bs.map((x) => x.minY)), maxX: Math.max(...bs.map((x) => x.maxX)), maxY: Math.max(...bs.map((x) => x.maxY)) };
  const pad = 40;
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

// ---------------- GeoJSON ----------------
export function toGeoJSON(doc, buildings) {
  const geo = makeGeo(doc.settings);
  const bounds = contentBounds(doc, buildings);
  const { areas, contours } = terrainVectors(doc, bounds);
  const features = [];
  const ring = (pts) => { const out = pts.map((p) => geo(p.x, p.y)); if (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1]) out.push(out[0]); return out; };
  for (const a of areas) features.push({ type: 'Feature', properties: { layer: 'landcover', kind: a.kind, ...MAT_TAGS[a.mat] }, geometry: { type: 'Polygon', coordinates: a.rings.map(ring) } });
  for (const c of contours) features.push({ type: 'Feature', properties: { layer: 'contour', ele: c.ele, index: c.index }, geometry: { type: 'LineString', coordinates: c.pts.map((p) => geo(p.x, p.y)) } });
  const g = doc.roads;
  for (const e of g.edges.values()) features.push({ type: 'Feature', id: e.id, properties: { layer: 'road', kind: e.type, name: e.name || undefined, width: g.width(e), ...ROAD_TAGS[e.type], ...(e.tunnel ? { tunnel: 'yes', layer: -1 } : {}) }, geometry: { type: 'LineString', coordinates: roadGeometry(g, e).map((p) => geo(p.x, p.y)) } });
  for (const ra of g.roundabouts()) {
    const ring = []; const k = 32;
    for (let i = 0; i <= k; i++) { const a = (i / k) * Math.PI * 2; ring.push(geo(ra.node.x + Math.cos(a) * ra.r, ra.node.y + Math.sin(a) * ra.r)); }
    features.push({ type: 'Feature', properties: { layer: 'road', kind: ra.type, junction: 'roundabout', radius: ra.r, ...ROAD_TAGS[ra.type] }, geometry: { type: 'LineString', coordinates: ring } });
  }
  for (const b of buildings || []) features.push({ type: 'Feature', properties: { layer: 'building', building: 'yes', 'building:levels': b.h, name: b.name || undefined, manual: b.manual ? true : undefined }, geometry: { type: 'Polygon', coordinates: [ring(b.pts)] } });
  for (const p of doc.places) features.push({ type: 'Feature', id: p.id, properties: { layer: 'place', kind: p.category, name: p.name || undefined, ...(PLACE_TAGS[p.category] || {}) }, geometry: { type: 'Point', coordinates: geo(p.x, p.y) } });
  for (const l of doc.labels) features.push({ type: 'Feature', id: l.id, properties: { layer: 'label', kind: l.kind, name: l.text, ...(LABEL_TAGS[l.kind] || {}) }, geometry: { type: 'Point', coordinates: geo(l.x, l.y) } });
  return JSON.stringify({ type: 'FeatureCollection', name: doc.name, generator: 'Atlas Studio', origin: { lat: doc.settings.originLat || 0, lon: doc.settings.originLon || 0, northBearing: doc.settings.northBearing || 0 }, features });
}

// ---------------- OSM XML ----------------
export function toOSM(doc, buildings) {
  const geo = makeGeo(doc.settings);
  const bounds = contentBounds(doc, buildings);
  const { areas, contours } = terrainVectors(doc, bounds);
  let nextId = -1;
  const nodes = [], ways = [], relations = [];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tagXml = (tags) => Object.entries(tags).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `    <tag k="${esc(k)}" v="${esc(v)}"/>`).join('\n');
  const node = (x, y, tags = null) => { const id = nextId--; const [lon, lat] = geo(x, y); nodes.push({ id, lon, lat, tags }); return id; };
  const way = (nodeIds, tags) => { const id = nextId--; ways.push({ id, nodeIds, tags }); return id; };
  const closedWay = (pts, tags) => { const ids = pts.map((p) => node(p.x, p.y)); ids.push(ids[0]); return way(ids, tags); };
  // Areas (multipolygon relations when there are holes)
  for (const a of areas) {
    const tags = MAT_TAGS[a.mat];
    if (a.rings.length === 1) { closedWay(a.rings[0], tags); continue; }
    const outer = closedWay(a.rings[0], {});
    const inners = a.rings.slice(1).map((r) => closedWay(r, {}));
    relations.push({ id: nextId--, members: [{ role: 'outer', ref: outer }, ...inners.map((ref) => ({ role: 'inner', ref }))], tags: { type: 'multipolygon', ...tags } });
  }
  for (const c of contours) way(c.pts.map((p) => node(p.x, p.y)), { contour: 'elevation', contour_ext: c.index ? 'elevation_major' : 'elevation_minor', ele: c.ele });
  // Roads share junction nodes
  const g = doc.roads;
  const nodeIdMap = new Map();
  for (const n of g.nodes.values()) nodeIdMap.set(n.id, node(n.x, n.y));
  for (const e of g.edges.values()) {
    const pts = roadGeometry(g, e);
    const ids = [nodeIdMap.get(e.a), ...pts.slice(1, -1).map((p) => node(p.x, p.y)), nodeIdMap.get(e.b)];
    way(ids, { ...ROAD_TAGS[e.type], name: e.name || undefined, width: e.width ? e.width : undefined, ...(e.tunnel ? { tunnel: 'yes', layer: '-1' } : {}) });
  }
  for (const ra of g.roundabouts()) {
    const pts = []; const k = 32;
    for (let i = 0; i < k; i++) { const a = (i / k) * Math.PI * 2; pts.push({ x: ra.node.x + Math.cos(a) * ra.r, y: ra.node.y + Math.sin(a) * ra.r }); }
    closedWay(pts, { ...ROAD_TAGS[ra.type], junction: 'roundabout' });
  }
  for (const b of buildings || []) closedWay(b.pts, { building: 'yes', 'building:levels': b.h, name: b.name || undefined });
  for (const p of doc.places) node(p.x, p.y, { ...(PLACE_TAGS[p.category] || { tourism: 'attraction' }), name: p.name || undefined });
  for (const l of doc.labels) node(l.x, l.y, { ...(LABEL_TAGS[l.kind] || { place: 'locality' }), name: l.text });

  const b0 = geo(bounds.minX, bounds.maxY), b1 = geo(bounds.maxX, bounds.minY);
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<osm version="0.6" generator="Atlas Studio">`, `  <bounds minlat="${Math.min(b0[1], b1[1])}" minlon="${Math.min(b0[0], b1[0])}" maxlat="${Math.max(b0[1], b1[1])}" maxlon="${Math.max(b0[0], b1[0])}"/>`];
  for (const n of nodes) {
    if (n.tags) out.push(`  <node id="${n.id}" lat="${n.lat}" lon="${n.lon}" version="1">\n${tagXml(n.tags)}\n  </node>`);
    else out.push(`  <node id="${n.id}" lat="${n.lat}" lon="${n.lon}" version="1"/>`);
  }
  for (const w of ways) out.push(`  <way id="${w.id}" version="1">\n${w.nodeIds.map((r) => `    <nd ref="${r}"/>`).join('\n')}\n${tagXml(w.tags)}\n  </way>`);
  for (const r of relations) out.push(`  <relation id="${r.id}" version="1">\n${r.members.map((m) => `    <member type="way" ref="${m.ref}" role="${m.role}"/>`).join('\n')}\n${tagXml(r.tags)}\n  </relation>`);
  out.push('</osm>');
  return out.join('\n');
}

// ---------------- ESRI ASCII grid (DEM) ----------------
export function toAsciiGrid(doc) {
  const T = doc.terrain;
  const b = T.bounds() || { minX: 0, minY: 0, maxX: TILE_M, maxY: TILE_M };
  const cx0 = Math.floor(b.minX / CELL), cx1 = Math.ceil(b.maxX / CELL);
  const cy0 = Math.floor(b.minY / CELL), cy1 = Math.ceil(b.maxY / CELL);
  const ncols = cx1 - cx0, nrows = cy1 - cy0;
  const rows = [];
  for (let cy = cy0; cy < cy1; cy++) { // north (top) first: smallest y is the top row
    const row = new Array(ncols);
    for (let cx = cx0; cx < cx1; cx++) row[cx - cx0] = T.cellH(cx, cy).toFixed(1);
    rows.push(row.join(' '));
  }
  // Georeference in metres from the origin, x east, y north (ASCII grids are not rotated: north bearing is ignored).
  const xll = cx0 * CELL, yll = -(cy1 * CELL);
  void TILE;
  return `ncols ${ncols}\nnrows ${nrows}\nxllcorner ${xll}\nyllcorner ${yll}\ncellsize ${CELL}\nNODATA_value -9999\n${rows.join('\n')}\n`;
}
