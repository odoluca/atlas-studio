// Builds the "Westhaven" example map procedurally so there is no large data file to ship.
import { newDoc } from './state.js?v=2.2.0';
import { MAT } from './terrain.js?v=2.2.0';
import { gridLines } from './roads.js?v=2.2.0';
import { mulberry32 } from './geom.js?v=2.2.0';

export function makeExample() {
  const doc = newDoc('Westhaven Bay');
  const T = doc.terrain, G = doc.roads;
  const rnd = mulberry32(1234);

  // Hills to the north-east, gentle rise inland.
  const bumps = [
    [900, -700, 420, 48], [1250, -450, 300, 30], [500, -900, 260, 22], [-300, -600, 380, 26], [-900, -200, 300, 18],
    [1400, 200, 220, 14], [-1200, -800, 350, 20],
  ];
  for (const [x, y, r, h] of bumps) {
    const steps = 14;
    for (let i = 0; i < steps; i++) T.applyHeight(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 60, r * (1 - i / steps * 0.85), 0.2, h / steps, 'raise');
  }
  // Bay: lower terrain below sea level to the south, plus a river from the hills.
  for (let i = 0; i < 40; i++) {
    const x = -1500 + i * 80, y = 650 + Math.sin(i * 0.35) * 120 + (i > 25 ? (i - 25) * -8 : 0);
    T.applyHeight(x, y, 300, 0.4, 2.2, 'lower');
    T.applyHeight(x, y + 420, 420, 0.3, 4, 'lower');
  }
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    const x = 820 - t * 300 + Math.sin(t * 9) * 40, y = -350 + t * 1000;
    T.applyMaterial(x, y, 14 + t * 10, MAT.WATER);
  }
  // Beach and parks and forest
  for (let i = 0; i < 25; i++) T.applyMaterial(-1200 + i * 70, 560 + Math.sin(i * 0.4) * 60, 45, MAT.SAND);
  for (let i = 0; i < 30; i++) T.applyMaterial(700 + (rnd() - 0.5) * 500, -800 + (rnd() - 0.5) * 400, 60 + rnd() * 50, MAT.FOREST);
  for (let i = 0; i < 12; i++) T.applyMaterial(-1250 + (rnd() - 0.5) * 300, -500 + (rnd() - 0.5) * 300, 50 + rnd() * 40, MAT.FOREST);
  for (let i = 0; i < 8; i++) T.applyMaterial(-80 + (rnd() - 0.5) * 120, 120 + (rnd() - 0.5) * 120, 55, MAT.PARK);
  T.applyMaterial(-620, -120, 70, MAT.PARK); T.applyMaterial(-560, -60, 60, MAT.PARK);

  const blocked = (x, y) => T.isWater(x, y) || T.materialAt(x, y) === MAT.PARK;
  // Downtown grid, slightly rotated
  const a = -0.12, u = { x: Math.cos(a), y: Math.sin(a) }, v = { x: -u.y, y: u.x };
  for (const ln of gridLines({ x: -720, y: -380 }, u, v, 900, 560, 90, 70, blocked)) G.addRoad(ln, { type: 'street', zoned: true });
  // Second neighbourhood at another angle
  const b = 0.35, u2 = { x: Math.cos(b), y: Math.sin(b) }, v2 = { x: -u2.y, y: u2.x };
  for (const ln of gridLines({ x: 300, y: -250 }, u2, v2, 520, 420, 75, 60, blocked)) G.addRoad(ln, { type: 'street', zoned: true });
  // Avenue and coastal highway
  G.addRoad([{ x: -1500, y: -100 }, { x: -700, y: -140 }, { x: 200, y: -60 }, { x: 900, y: 60 }, { x: 1500, y: 20 }], { type: 'avenue', name: 'Harbour Avenue', zoned: true });
  G.addRoad([{ x: -1500, y: 420 }, { x: -900, y: 460 }, { x: -200, y: 380 }, { x: 500, y: 430 }, { x: 1100, y: 330 }, { x: 1500, y: 360 }], { type: 'highway', name: 'Coast Highway' });
  G.addRoad([{ x: -260, y: -1000 }, { x: -200, y: -500 }, { x: -230, y: -140 }], { type: 'avenue', name: 'North Road', zoned: true });
  G.addRoad([{ x: -1500, y: -1000 }, { x: -300, y: -700 }, { x: 600, y: -300 }, { x: 1300, y: -600 }], { type: 'rail', name: 'Coastal Line' });
  G.addRoad([{ x: 980, y: -620 }, { x: 1080, y: -560 }, { x: 1180, y: -470 }, { x: 1250, y: -380 }], { type: 'path', name: 'Ridge Trail' });
  for (const e of G.edges.values()) if (!e.name && e.type === 'street') { const name = pickName(rnd); for (const id of G.streetChain(e.id)) G.edges.get(id).name = name; }

  doc.places = [
    { id: 'p1', x: -400, y: -220, name: 'Central Station', category: 'station' },
    { id: 'p2', x: -80, y: 120, name: 'Linden Park', category: 'park' },
    { id: 'p3', x: -1000, y: 500, name: 'Westhaven Beach', category: 'landmark' },
    { id: 'p4', x: 420, y: -120, name: 'Old Harbour', category: 'harbor' },
    { id: 'p5', x: 920, y: -720, name: 'Falcon Peak', category: 'peak' },
    { id: 'p6', x: -550, y: -300, name: 'Bay Café', category: 'cafe' },
    { id: 'p7', x: 540, y: 60, name: 'St. Anne Hospital', category: 'hospital' },
  ];
  doc.labels = [
    { id: 'l1', x: -250, y: -480, text: 'Westhaven', kind: 'city', size: 26, angle: 0 },
    { id: 'l2', x: 500, y: -480, text: 'Harbour Quarter', kind: 'district', size: 14, angle: 0 },
    { id: 'l3', x: -300, y: 1000, text: 'Westhaven Bay', kind: 'water', size: 18, angle: 0 },
    { id: 'l4', x: 760, y: -860, text: 'Falcon Woods', kind: 'park', size: 13, angle: 0 },
  ];
  doc.view = { cx: 0, cy: 0, scale: 0.42 };
  return doc;
}

const FIRST = ['Elm', 'Oak', 'Mill', 'King', 'Queen', 'Harbour', 'Church', 'Market', 'Station', 'Bridge', 'Hill', 'Park', 'Bay', 'Cedar', 'Maple', 'Union', 'Garden', 'Orchard', 'River', 'Castle'];
const LAST = ['Street', 'Street', 'Road', 'Lane', 'Way', 'Terrace'];
export function pickName(rnd) { return `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`; }
