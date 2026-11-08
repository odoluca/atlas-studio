// Document model, serialization, and undo history.
import { Terrain } from './terrain.js';
import { RoadGraph } from './roads.js';

export const FORMAT_VERSION = 2;

export const DEFAULT_SETTINGS = {
  style: 'atlas',
  contourInterval: 5,
  showContours: true,
  contourLabels: true,
  showHillshade: true,
  exaggeration: 1.6,
  showTrees: true,
  showCompass: true,
  originLat: 0,
  originLon: 0,
  northBearing: 0,
  autoBuildings: true,
  buildingStyle: 'mixed',
  buildingDensity: 1,
};

export function newDoc(name = 'Untitled map') {
  return {
    version: FORMAT_VERSION,
    name,
    settings: { ...DEFAULT_SETTINGS },
    terrain: new Terrain(),
    roads: new RoadGraph(),
    places: [],
    labels: [],
    buildings: [],
    frozenBuildings: null,
    view: { cx: 0, cy: 0, scale: 1, rot: 0 },
  };
}

export function serialize(doc) {
  return {
    app: 'atlas-studio',
    version: FORMAT_VERSION,
    name: doc.name,
    savedAt: new Date().toISOString(),
    settings: doc.settings,
    terrain: doc.terrain.toJSON(),
    roads: doc.roads.toJSON(),
    places: doc.places,
    labels: doc.labels,
    buildings: doc.buildings.map((b) => ({ id: b.id, pts: b.pts.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]), h: b.h, name: b.name || '', ...(b.shape === 'circle' ? { shape: 'circle', cx: +b.cx.toFixed(2), cy: +b.cy.toFixed(2), r: +b.r.toFixed(2) } : {}) })),
    frozenBuildings: doc.frozenBuildings ? doc.frozenBuildings.map((b) => ({ id: b.id, pts: b.pts.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]), h: b.h })) : null,
    view: doc.view,
  };
}

export function deserialize(j) {
  if (!j || typeof j !== 'object') throw new Error('Not a map file');
  if (j.app !== 'atlas-studio' || typeof j.version !== 'number') throw new Error('Not an Atlas Studio map file');
  if (j.version > FORMAT_VERSION) throw new Error(`This file needs a newer version of Atlas Studio (format ${j.version}).`);
  const doc = newDoc(String(j.name || 'Untitled map'));
  doc.settings = { ...DEFAULT_SETTINGS, ...(j.settings || {}) };
  doc.terrain = Terrain.fromJSON(j.terrain);
  doc.roads = RoadGraph.fromJSON(j.roads);
  doc.places = Array.isArray(j.places) ? j.places.filter((p) => typeof p.x === 'number' && typeof p.y === 'number') : [];
  doc.labels = Array.isArray(j.labels) ? j.labels.filter((p) => typeof p.x === 'number' && typeof p.y === 'number') : [];
  doc.buildings = Array.isArray(j.buildings) ? j.buildings.filter((b) => Array.isArray(b.pts) && b.pts.length >= 3).map((b) => ({ id: b.id || `b${Math.random().toString(36).slice(2)}`, pts: b.pts.map(([x, y]) => ({ x, y })), h: b.h || 1, name: b.name || '', manual: true, ...(b.shape === 'circle' && Number.isFinite(b.r) ? { shape: 'circle', cx: +b.cx, cy: +b.cy, r: +b.r } : {}) })) : [];
  doc.frozenBuildings = Array.isArray(j.frozenBuildings) ? j.frozenBuildings.map((b) => ({ id: b.id, pts: b.pts.map(([x, y]) => ({ x, y })), h: b.h || 1 })) : null;
  if (j.view && typeof j.view.scale === 'number') doc.view = { cx: +j.view.cx || 0, cy: +j.view.cy || 0, scale: Math.min(8, Math.max(0.05, j.view.scale)), rot: +j.view.rot || 0 };
  return doc;
}

export class History {
  constructor(limit = 80) { this.limit = limit; this.undoStack = []; this.redoStack = []; this.onChange = null; }
  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange?.();
  }
  undo() { const e = this.undoStack.pop(); if (!e) return null; e.undo(); this.redoStack.push(e); this.onChange?.(); return e; }
  redo() { const e = this.redoStack.pop(); if (!e) return null; e.redo(); this.undoStack.push(e); this.onChange?.(); return e; }
  clear() { this.undoStack.length = 0; this.redoStack.length = 0; this.onChange?.(); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
