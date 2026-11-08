import test from 'node:test';
import assert from 'node:assert/strict';
import { makeExample } from '../src/sample.js';
import { generateBuildings } from '../src/buildings.js';
import { toGeoJSON, toOSM, toAsciiGrid, makeGeo } from '../src/exporters.js';

test('geo conversion respects origin and bearing', () => {
  const geo = makeGeo({ originLat: 10, originLon: 20, northBearing: 0 });
  const [lon, lat] = geo(0, -111320); // 111.32 km up = north
  assert.ok(Math.abs(lat - 11) < 1e-6); assert.ok(Math.abs(lon - 20) < 1e-6);
  const geo90 = makeGeo({ originLat: 0, originLon: 0, northBearing: 90 });
  const [lon2, lat2] = geo90(0, -111320); // up now points east
  assert.ok(Math.abs(lon2 - 1) < 1e-6); assert.ok(Math.abs(lat2) < 1e-6);
});

test('GeoJSON and OSM exports are well formed', () => {
  const doc = makeExample();
  doc.settings.originLat = 41.0; doc.settings.originLon = 29.0;
  const buildings = generateBuildings(doc.roads, doc.terrain, doc.settings);
  const gj = JSON.parse(toGeoJSON(doc, buildings));
  assert.equal(gj.type, 'FeatureCollection');
  const layers = new Set(gj.features.map((f) => f.properties.layer));
  for (const l of ['landcover', 'contour', 'road', 'building', 'place', 'label']) assert.ok(layers.has(l), l);
  const water = gj.features.find((f) => f.properties.kind === 'water');
  assert.ok(water && water.geometry.coordinates[0].length > 10);
  for (const f of gj.features) for (const ring of (f.geometry.type === 'Polygon' ? f.geometry.coordinates : [])) assert.deepEqual(ring[0], ring[ring.length - 1]);
  const osm = toOSM(doc, buildings);
  assert.ok(osm.startsWith('<?xml'));
  assert.ok(osm.includes('<tag k="highway" v="residential"/>'));
  assert.ok(osm.includes('<tag k="natural" v="water"/>'));
  assert.ok(osm.includes('k="contour"'));
  assert.ok((osm.match(/<way /g) || []).length > buildings.length);
  const asc = toAsciiGrid(doc);
  const head = asc.split('\n').slice(0, 6).join(' ');
  assert.match(head, /ncols \d+ nrows \d+ xllcorner -?\d+ yllcorner -?\d+ cellsize 4 NODATA_value -9999/);
});
