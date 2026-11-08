import test from 'node:test';
import assert from 'node:assert/strict';
import { Terrain, isolines, maskOutlines, MAT, CELL } from '../src/terrain.js';
import { RoadGraph, gridLines } from '../src/roads.js';
import { simplify, chaikin, convexOverlap } from '../src/geom.js';

test('terrain brush raises and serializes', () => {
  const T = new Terrain();
  T.applyHeight(100, 100, 40, 0.5, 5, 'raise');
  assert.ok(T.heightAt(100, 100) > 4.5);
  assert.equal(T.heightAt(1000, 1000), 0);
  T.applyMaterial(300, 300, 30, MAT.WATER);
  assert.ok(T.isWater(300, 300));
  const j = T.toJSON();
  const T2 = Terrain.fromJSON(JSON.parse(JSON.stringify(j)));
  assert.ok(Math.abs(T2.heightAt(100, 100) - T.heightAt(100, 100)) < 0.11);
  assert.ok(T2.isWater(300, 300));
  // sea level water
  T.applyHeight(600, 600, 40, 0.5, 5, 'lower');
  assert.ok(T.isWater(600, 600));
});

test('isolines produce closed loop around a bump', () => {
  const nx = 20, ny = 20, f = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = 10 - Math.hypot(i - 10, j - 10);
  const lines = isolines(f, nx, ny, 5);
  assert.equal(lines.length, 1);
  const ln = lines[0];
  assert.ok(ln.length > 20);
  const a = ln[0], b = ln[ln.length - 1];
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, 'closed');
});

test('mask outlines smooth a square', () => {
  const nx = 30, ny = 30;
  const { lines } = maskOutlines(1, 0, 0, 2, nx, ny, (i) => { const x = i % nx, y = (i / nx) | 0; return x > 8 && x < 20 && y > 8 && y < 20; });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].length > 40);
});

test('roads: crossing creates junction and splits', () => {
  const g = new RoadGraph();
  g.addRoad([{ x: 0, y: 0 }, { x: 100, y: 0 }], { type: 'street' });
  g.addRoad([{ x: 50, y: -50 }, { x: 50, y: 50 }], { type: 'street' });
  assert.equal(g.nodes.size, 5);
  assert.equal(g.edges.size, 4);
  // snapping to end node
  g.addRoad([{ x: 103, y: 2 }, { x: 200, y: 0 }], { type: 'street' });
  // snaps to the end node and fuses with the straight continuation
  assert.equal(g.nodes.size, 5);
  assert.equal(g.edges.size, 4);
});

test('roads: erase splits an edge into two', () => {
  const g = new RoadGraph();
  g.addRoad([{ x: 0, y: 0 }, { x: 200, y: 0 }], { type: 'street' });
  assert.ok(g.eraseCircle(100, 0, 10));
  assert.equal(g.edges.size, 2);
  assert.equal(g.nodes.size, 4);
  assert.ok(g.eraseCircle(0, 0, 20));
  assert.equal(g.edges.size, 2);
  assert.ok(!g.eraseCircle(1000, 1000, 5));
});

test('grid lines skip blocked cells', () => {
  const lines = gridLines({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, 300, 200, 100, 100, (x, y) => x > 200);
  // 3x2 grid; last column blocked -> lines: verticals i=0,1,2 ; horizontals j=0,1,2 spanning 2 cells
  assert.equal(lines.length, 6);
  const g = new RoadGraph();
  for (const l of lines) g.addRoad(l, { type: 'street' });
  assert.equal(g.nodes.size, 9);
  assert.equal(g.edges.size, 12);
});

test('geom helpers', () => {
  const s = simplify([{ x: 0, y: 0 }, { x: 1, y: 0.01 }, { x: 2, y: 0 }], 0.1);
  assert.equal(s.length, 2);
  assert.equal(chaikin([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], 1).length, 6);
  const A = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const B = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }];
  const C = [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }];
  assert.ok(convexOverlap(A, B)); assert.ok(!convexOverlap(A, C));
});

test('roads: straight continuations fuse into one road', () => {
  const g = new RoadGraph();
  g.addRoad([{ x: 0, y: 0 }, { x: 100, y: 0 }], { type: 'street', name: 'Elm Street' });
  g.addRoad([{ x: 100, y: 0 }, { x: 200, y: 5 }], { type: 'street' });
  assert.equal(g.edges.size, 1, 'collinear roads merge');
  assert.equal([...g.edges.values()][0].name, 'Elm Street');
  // a sharp turn stays separate
  g.addRoad([{ x: 200, y: 5 }, { x: 200, y: 150 }], { type: 'street' });
  assert.equal(g.edges.size, 2);
  // a different type stays separate
  g.addRoad([{ x: 200, y: 150 }, { x: 200, y: 300 }], { type: 'avenue' });
  assert.equal(g.edges.size, 3);
});

test('roads: street chain runs through junctions and deleting a crossing heals', () => {
  const g = new RoadGraph();
  const [main] = g.addRoad([{ x: 0, y: 0 }, { x: 300, y: 0 }], { type: 'street' });
  g.addRoad([{ x: 100, y: -50 }, { x: 100, y: 50 }], { type: 'street' });
  const [cross2] = g.addRoad([{ x: 200, y: -50 }, { x: 200, y: 50 }], { type: 'street' });
  void main;
  const horizontal = [...g.edges.values()].find((e) => Math.abs(g.nodes.get(e.a).y) < 1e-9 && Math.abs(g.nodes.get(e.b).y) < 1e-9);
  assert.equal(g.streetChain(horizontal.id).length, 3);
  // Removing both halves of the second crossing leaves a degree-2 node that heals away
  const halves = [...g.edges.values()].filter((e) => Math.abs(g.nodes.get(e.a).x - 200) < 1e-9 && Math.abs(g.nodes.get(e.b).x - 200) < 1e-9);
  void cross2;
  for (const h of halves) g.removeEdge(h.id);
  assert.equal([...g.edges.values()].filter((e) => Math.abs(g.nodes.get(e.a).y) < 1e-9 && Math.abs(g.nodes.get(e.b).y) < 1e-9).length, 2);
});

test('buildings never straddle a thin railway crossing a zoned street', async () => {
  const { generateBuildings } = await import('../src/buildings.js');
  const { Terrain } = await import('../src/terrain.js');
  const { segmentIntersection } = await import('../src/geom.js');
  const g = new RoadGraph();
  g.addRoad([{ x: 0, y: 0 }, { x: 600, y: 0 }], { type: 'street', zoned: true });
  g.addRoad([{ x: 0, y: 60 }, { x: 600, y: -5 }], { type: 'rail' }); // shallow diagonal rail just north of the lots
  const blds = generateBuildings(g, new Terrain(), { buildingStyle: 'dense', buildingDensity: 1 });
  assert.ok(blds.length > 5);
  const rail = [...g.edges.values()].filter((e) => e.type === 'rail');
  for (const b of blds) for (const e of rail) {
    const pts = g.edgePoints(e);
    for (let i = 0; i < 4; i++) { const p = b.pts[i], q = b.pts[(i + 1) % 4]; for (let k = 0; k < pts.length - 1; k++) assert.ok(!segmentIntersection(p.x, p.y, q.x, q.y, pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y, true), 'lot crosses rail'); }
  }
});

test('roads: split at an intermediate point and tunnels stay separate', () => {
  const g = new RoadGraph();
  const [e] = g.addRoad([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }], { type: 'street' });
  assert.equal(e.pts.length, 2);
  const n = g.splitAtPoint(e.id, 0);
  assert.ok(n && Math.abs(n.x - 100) < 1e-9);
  assert.equal(g.edges.size, 2);
  for (const ed of g.edges.values()) for (const p of ed.pts) assert.ok(Math.abs(p.x - 100) > 1e-6, 'no duplicate point at the split node');
  const second = [...g.edges.values()].find((x) => x.a === n.id);
  second.tunnel = true;
  assert.equal(g.healNode(n.id), null, 'tunnel and surface road do not fuse');
});

test('automatic lots avoid concave hand-drawn buildings exactly', async () => {
  const { generateBuildings } = await import('../src/buildings.js');
  const { Terrain } = await import('../src/terrain.js');
  const { polygonsIntersect } = await import('../src/geom.js');
  const g = new RoadGraph();
  g.addRoad([{ x: 0, y: 0 }, { x: 400, y: 0 }], { type: 'street', zoned: true });
  // U shape opening towards the street: lots may sit inside the opening but never on the arms
  const U = [{ x: 100, y: -8 }, { x: 125, y: -8 }, { x: 125, y: -40 }, { x: 175, y: -40 }, { x: 175, y: -8 }, { x: 200, y: -8 }, { x: 200, y: -70 }, { x: 100, y: -70 }];
  const lots = generateBuildings(g, new Terrain(), { buildingStyle: 'detached', buildingDensity: 1 }, [{ pts: U }]);
  assert.ok(lots.length > 5);
  for (const l of lots) assert.ok(!polygonsIntersect(l.pts, U), 'lot overlaps the U building');
  assert.ok(polygonsIntersect([{ x: 110, y: -50 }, { x: 120, y: -50 }, { x: 120, y: -45 }, { x: 110, y: -45 }], U), 'sanity: inside arm');
  assert.ok(!polygonsIntersect([{ x: 140, y: -20 }, { x: 160, y: -20 }, { x: 160, y: -12 }, { x: 140, y: -12 }], U), 'sanity: in the opening');
});

test('water channels: roads cross without junctions, channels join each other', () => {
  const g = new RoadGraph();
  g.addRoad([{ x: 0, y: 50 }, { x: 300, y: 50 }], { type: 'river', name: 'Mill Brook' });
  g.addRoad([{ x: 150, y: -100 }, { x: 150, y: 200 }], { type: 'street' });
  assert.equal(g.edges.size, 2, 'street passes over the channel as a bridge');
  assert.equal(g.nodes.size, 4);
  // a tributary joins the channel
  g.addRoad([{ x: 100, y: 200 }, { x: 100, y: 52 }], { type: 'river' });
  assert.equal(g.nodes.size, 6);
  assert.equal([...g.edges.values()].filter((e) => e.type === 'river').length, 3, 'channel split at the confluence');
  assert.ok(g.inChannel(50, 50)); assert.ok(!g.inChannel(50, 90));
});

test('roads: dragging an end onto another road connects them', () => {
  const g = new RoadGraph();
  g.addRoad([{ x: 0, y: 0 }, { x: 300, y: 0 }], { type: 'street' });
  const [e2] = g.addRoad([{ x: 150, y: 100 }, { x: 150, y: 200 }], { type: 'street' });
  const endNode = e2.a; // at (150,100)
  const t = g.snapTargetForNode(endNode, 150, 3, 10);
  assert.ok(t && t.kind === 'edge', 'snaps to the street');
  const n = g.connectNode(endNode, t);
  assert.ok(n);
  assert.equal(g.nodeDegree(n.id), 3, 'T junction');
  assert.equal(g.edges.size, 3);
  // end-to-end: two straight pieces fuse into one
  const h = new RoadGraph();
  h.addRoad([{ x: 0, y: 0 }, { x: 100, y: 0 }], { type: 'street', name: 'Elm' });
  const [b] = h.addRoad([{ x: 130, y: 2 }, { x: 250, y: 0 }], { type: 'street' });
  const t2 = h.snapTargetForNode(b.a, 101, 0, 10);
  assert.equal(t2.kind, 'node');
  h.connectNode(b.a, t2);
  assert.equal(h.edges.size, 1, 'fused');
  assert.equal([...h.edges.values()][0].name, 'Elm');
});

test('terrain: raiseTo lifts ground below sea level without lowering hills', () => {
  const T = new Terrain();
  T.applyHeight(0, 0, 60, 0.5, 5, 'lower');   // a basin below sea level
  T.applyHeight(200, 0, 60, 0.5, 20, 'raise'); // a hill
  assert.ok(T.isWater(0, 0));
  T.applyHeight(0, 0, 80, 0.7, 1, 'raiseTo', T.seaLevel + 0.5);
  T.applyHeight(200, 0, 80, 0.7, 1, 'raiseTo', T.seaLevel + 0.5);
  assert.ok(!T.isWater(0, 0), 'basin drained');
  assert.ok(T.heightAt(200, 0) > 15, 'hill untouched');
});
