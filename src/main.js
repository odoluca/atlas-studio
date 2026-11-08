// Atlas Studio editor: view, tools, panels, history, autosave, export.
import { newDoc, serialize, deserialize, History } from './state.js?v=2.2.1';
import { MAT } from './terrain.js?v=2.2.1';
import { ROAD_TYPES, RoadGraph, gridLines } from './roads.js?v=2.2.1';
import { generateBuildings, BUILDING_STYLES } from './buildings.js?v=2.2.1';
import { STYLES, PLACE_OPTIONS, LABEL_KINDS } from './styles.js?v=2.2.1';
import { CanvasPainter, SvgPainter, renderTerrain, renderRoads, renderBuildings, renderRoadLabels, renderPlaces, renderLabels, renderScene, renderCompass, worldToScreen, screenToWorld, viewBounds, roadGeometry } from './render.js?v=2.2.1';
import { saveAutosave, loadAutosave, download, pickFile, prefs } from './storage.js?v=2.2.1';
import { makeExample } from './sample.js?v=2.2.1';
import { toGeoJSON, toOSM, toAsciiGrid } from './exporters.js?v=2.2.1';
import { APP_VERSION } from './version.js?v=2.2.1';
import { dist, dist2, closestOnPolyline, uid, simplify, clamp, pointInPolygon, polygonArea } from './geom.js?v=2.2.1';

const $ = (id) => document.getElementById(id);

const TOOLS = [
  { id: 'select', label: 'Select', key: 'V', icon: 'i-select' },
  { id: 'pan', label: 'Pan', key: 'H', icon: 'i-pan' },
  { id: 'road', label: 'Road', key: 'R', icon: 'i-road' },
  { id: 'grid', label: 'Blocks', key: 'G', icon: 'i-grid' },
  { id: 'paint', label: 'Paint', key: 'B', icon: 'i-paint' },
  { id: 'terrain', label: 'Terrain', key: 'T', icon: 'i-terrain' },
  { id: 'place', label: 'Place', key: 'P', icon: 'i-place' },
  { id: 'label', label: 'Label', key: 'L', icon: 'i-label' },
  { id: 'building', label: 'Building', key: 'N', icon: 'i-building' },
  { id: 'roundabout', label: 'Roundabout', key: 'O', icon: 'i-roundabout' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'i-eraser' },
];

const DEFAULT_TS = {
  road: { type: 'street', name: '', zoned: true, snap: true, smooth: true, bstyle: '', bdensity: 0, tunnel: false },
  grid: { blockW: 80, blockD: 60, type: 'street', zoned: true, avoidWater: true, avoidParks: true, snapAngle: false, bstyle: '', bdensity: 0 },
  paint: { material: MAT.PARK, radius: 60 },
  terrain: { mode: 'raise', radius: 120, strength: 6, hardness: 0.35 },
  place: { category: 'cafe', name: '' },
  label: { kind: 'district', text: '' },
  building: { mode: 'rect', levels: 2, align: true, name: '' },
  roundabout: { radius: 14 },
  eraser: { radius: 30, roads: true, places: true, labels: true, buildings: true },
};

class App {
  constructor() {
    this.canvas = $('map');
    this.ctx = this.canvas.getContext('2d');
    this.doc = newDoc();
    this.history = new History();
    this.history.onChange = () => this.updateHistoryButtons();
    this.ts = Object.fromEntries(Object.entries(DEFAULT_TS).map(([k, v]) => [k, { ...v, ...(prefs.get('ts.' + k, {}) || {}) }]));
    this.tool = 'select';
    this.selection = null; // {kind:'road'|'place'|'label', id}
    this.hover = null;
    this.draft = null; // tool-specific transient state
    this.pointer = { x: 0, y: 0, sx: 0, sy: 0, down: false, button: 0 };
    this.space = false;
    this.buildings = [];
    this.buildingsKey = '';
    this.terrainCache = null;
    this.dirty = true;
    this.dpr = window.devicePixelRatio || 1;
    this.autosaveTimer = null;
    this.lastFrame = performance.now();

    this.buildToolbar();
    this.bindUI();
    this.bindCanvas();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setTool(prefs.get('tool', 'select'));
    this.renderMapPanel();
    this.renderSelectionPanel();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- Document lifecycle ----------
  /** Compare the running build with version.json on the server; offer a reload when they differ. */
  async checkForUpdate() {
    try {
      const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { version } = await res.json();
      if (version && version !== APP_VERSION) {
        const t = $('toast');
        t.innerHTML = `A newer version of Atlas Studio is available (${version}). <button class="btn" style="margin-left:8px">Reload</button>`;
        t.querySelector('button').onclick = () => { this.doc.view = { cx: this.view.cx, cy: this.view.cy, scale: this.view.scale, rot: this.view.rot || 0 }; saveAutosave(serialize(this.doc)).catch(() => {}).finally(() => location.reload()); };
        t.hidden = false;
        clearTimeout(this._toastT);
      }
    } catch { /* offline or file:// — ignore */ }
  }
  async boot() {
    this.checkForUpdate();
    setInterval(() => this.checkForUpdate(), 10 * 60 * 1000);
    try {
      const saved = await loadAutosave();
      if (saved) { this.loadDoc(deserialize(saved), false); this.status('Restored from this browser'); return; }
    } catch (e) { console.warn('autosave restore failed', e); }
    this.loadDoc(makeExample(), false);
    this.status('Example loaded');
  }
  loadDoc(doc, pushHistory = true) {
    const prev = this.doc;
    this.doc = doc;
    this.view = { ...doc.view, w: this.view?.w || 800, h: this.view?.h || 600 };
    this.selection = null; this.draft = null;
    this.invalidateTerrain(); this.invalidateBuildings();
    $('mapName').value = doc.name;
    this.history.clear();
    this.renderMapPanel(); this.renderSelectionPanel();
    this.dirty = true;
    this.scheduleAutosave();
    void prev; void pushHistory;
  }
  get view() { return this._view; }
  set view(v) { this._view = v; }

  markChanged() { this.dirty = true; this.scheduleAutosave(); }
  scheduleAutosave() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(async () => {
      try { this.doc.view = { cx: this.view.cx, cy: this.view.cy, scale: this.view.scale, rot: this.view.rot || 0 }; await saveAutosave(serialize(this.doc)); $('saveStatus').textContent = 'Saved in this browser'; }
      catch (e) { $('saveStatus').textContent = 'Autosave unavailable: download to keep your map'; }
    }, 1200);
    $('saveStatus').textContent = 'Unsaved changes…';
  }

  // ---------- UI ----------
  buildToolbar() {
    const bar = $('toolbar');
    bar.innerHTML = '';
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = 'tool-btn'; b.dataset.tool = t.id; b.title = `${t.label} (${t.key})`;
      b.innerHTML = `<svg><use href="#${t.icon}"/></svg><span>${t.label}</span>`;
      b.onclick = () => this.setTool(t.id);
      bar.appendChild(b);
    }
  }
  setTool(id) {
    if (!TOOLS.some((t) => t.id === id)) id = 'select';
    this.tool = id; this.draft = null;
    prefs.set('tool', id);
    for (const b of $('toolbar').children) b.classList.toggle('active', b.dataset.tool === id);
    this.renderToolSettings();
    this.updateHint();
    this.canvas.style.cursor = id === 'pan' ? 'grab' : id === 'select' ? 'default' : 'crosshair';
    this.dirty = true;
  }
  updateHint() {
    const hints = {
      select: 'Click a road, place, or label to edit it. Drag handles to reshape roads. Double-click a road to add a point.',
      pan: 'Drag to pan. Scroll to zoom. Hold Space with any tool to pan.',
      road: 'Click to place points, double-click or Enter to finish. Or press and drag to draw freehand. Ends snap to roads.',
      grid: 'Drag along the first street to set direction and length, release, then move to set depth and click.',
      paint: 'Drag to paint. [ and ] change the brush size. Paint Land to erase.',
      terrain: 'Hold to sculpt. Alt inverts raise/lower. [ and ] change size, Shift+[ ] change strength.',
      place: 'Click to add a place. Edit its name and category in the Selection panel.',
      label: 'Click to add a label. Edit text, kind, size and angle in the Selection panel.',
      building: 'Drag a rectangle (aligned to the nearest road) or switch to Polygon and click corners. Automatic buildings keep clear of yours.',
      roundabout: 'Click a junction to add a roundabout; click it again to remove it. Set the radius in the tool settings.',
      eraser: 'Drag to erase roads, places, labels and hand-drawn buildings. Use the Paint tool with Land to clear terrain paint.',
    };
    $('hint').textContent = this.draft?.hint || hints[this.tool] || '';
    $('statusTool').textContent = TOOLS.find((t) => t.id === this.tool)?.label || '';
  }
  bindUI() {
    $('btnNew').onclick = () => { if (confirm('Start a new empty map? The current map stays saved in this browser until you change it.')) { this.loadDoc(newDoc()); this.view.cx = 0; this.view.cy = 0; this.view.scale = 1; } };
    $('btnExample').onclick = () => { if (confirm('Replace the current map with the example?')) this.loadDoc(makeExample()); };
    $('btnOpen').onclick = async () => {
      const file = await pickFile('.json,application/json');
      if (!file) return;
      try { this.loadDoc(deserialize(JSON.parse(await file.text()))); this.toast(`Opened ${file.name}`); }
      catch (e) { this.toast(`Could not open: ${e.message}`); }
    };
    $('btnSave').onclick = () => this.saveFile();
    $('btnUndo').onclick = () => this.undo();
    $('btnRedo').onclick = () => this.redo();
    const menu = $('exportMenu'), menuBtn = $('btnExport');
    const closeMenu = () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
    menuBtn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; menuBtn.setAttribute('aria-expanded', String(!menu.hidden)); };
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
    const wire = (id, fn) => { $(id).onclick = () => { closeMenu(); try { fn(); } catch (err) { console.error(err); this.toast('Export failed: ' + err.message); } }; };
    wire('btnProject', () => this.saveFile());
    wire('btnPng', () => this.exportPng());
    wire('btnSvg', () => this.exportSvg());
    wire('btnGeoJson', () => this.exportText(toGeoJSON(this.doc, this.freshBuildings()), 'geojson', 'application/geo+json', 'GeoJSON exported'));
    wire('btnOsm', () => this.exportText(toOSM(this.doc, this.freshBuildings()), 'osm', 'application/xml', 'OSM XML exported'));
    wire('btnAsc', () => this.exportText(toAsciiGrid(this.doc), 'asc', 'text/plain', 'Terrain grid exported'));
    $('mapName').oninput = (e) => { this.doc.name = e.target.value; this.scheduleAutosave(); };
    $('zoomIn').onclick = () => this.zoomBy(1.5);
    $('zoomOut').onclick = () => this.zoomBy(1 / 1.5);
    $('zoomFit').onclick = () => this.fit();
    for (const tab of document.querySelectorAll('.panel .tab')) tab.onclick = () => this.showTab(tab.dataset.tab);
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.space = false; this.canvas.style.cursor = this.tool === 'pan' ? 'grab' : this.tool === 'select' ? 'default' : 'crosshair'; } });
  }
  showTab(name) {
    for (const tab of document.querySelectorAll('.panel .tab')) tab.classList.toggle('active', tab.dataset.tab === name);
    $('tabMap').hidden = name !== 'map'; $('tabSelection').hidden = name !== 'selection';
  }
  updateHistoryButtons() { $('btnUndo').disabled = !this.history.canUndo; $('btnRedo').disabled = !this.history.canRedo; }
  toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(this._toastT); this._toastT = setTimeout(() => (t.hidden = true), 2600); }
  status(msg) { $('saveStatus').textContent = msg; }

  /** Build a settings form from a schema into `el`, binding to object `obj`. */
  form(el, schema, obj, onChange) {
    el.innerHTML = '';
    for (const f of schema) {
      if (f.type === 'section') { const h = document.createElement('h3'); h.className = 'sec'; h.textContent = f.label; el.appendChild(h); continue; }
      if (f.type === 'info') { const d = document.createElement('div'); d.className = 'info'; d.innerHTML = f.html; el.appendChild(d); continue; }
      if (f.type === 'buttons') { const d = document.createElement('div'); d.className = 'row'; for (const b of f.buttons) { const btn = document.createElement('button'); btn.className = 'btn' + (b.cls ? ' ' + b.cls : ''); btn.textContent = b.label; btn.onclick = b.onClick; d.appendChild(btn); } el.appendChild(d); continue; }
      if (f.type === 'stats') { for (const [k, id] of f.rows) { const d = document.createElement('div'); d.className = 'stat'; d.innerHTML = `<span>${k}</span><b id="${id}">–</b>`; el.appendChild(d); } continue; }
      const wrap = document.createElement('div');
      wrap.className = 'field' + (f.type === 'check' ? ' check' : '');
      const label = document.createElement('label');
      const val = (f.obj || obj)[f.key];
      if (f.type === 'check') {
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!val;
        input.onchange = () => { onChange(f.key, input.checked); };
        label.appendChild(input); label.appendChild(document.createTextNode(f.label)); wrap.appendChild(label);
      } else if (f.type === 'seg') {
        label.textContent = f.label; wrap.appendChild(label);
        const seg = document.createElement('div'); seg.className = 'seg';
        for (const [v, text] of f.options) { const b = document.createElement('button'); b.textContent = text; b.classList.toggle('active', v === val); b.onclick = () => { onChange(f.key, v); for (const c of seg.children) c.classList.toggle('active', c === b); }; seg.appendChild(b); }
        wrap.appendChild(seg);
      } else if (f.type === 'swatches') {
        label.textContent = f.label; wrap.appendChild(label);
        const grid = document.createElement('div'); grid.className = 'swatches';
        for (const [v, text, color] of f.options) { const b = document.createElement('button'); b.className = 'swatch' + (v === val ? ' active' : ''); b.innerHTML = `<i style="background:${color}"></i>${text}`; b.onclick = () => { onChange(f.key, v); for (const c of grid.children) c.classList.toggle('active', c === b); }; grid.appendChild(b); }
        wrap.appendChild(grid);
      } else if (f.type === 'range') {
        const vs = document.createElement('span'); vs.className = 'val'; vs.textContent = fmt(val, f);
        label.textContent = f.label; label.appendChild(vs); wrap.appendChild(label);
        const input = document.createElement('input'); input.type = 'range'; input.min = f.min; input.max = f.max; input.step = f.step || 1; input.value = val;
        input.oninput = () => { const v = parseFloat(input.value); vs.textContent = fmt(v, f); onChange(f.key, v); };
        wrap.appendChild(input);
        wrap._update = (v) => { input.value = v; vs.textContent = fmt(v, f); };
        wrap.dataset.key = f.key;
      } else if (f.type === 'select') {
        label.textContent = f.label; wrap.appendChild(label);
        const sel = document.createElement('select');
        let group = null;
        for (const [v, text, grp] of f.options) {
          const o = document.createElement('option'); o.value = v; o.textContent = text; o.selected = String(v) === String(val);
          if (grp) { if (!group || group.label !== grp) { group = document.createElement('optgroup'); group.label = grp; sel.appendChild(group); } group.appendChild(o); }
          else sel.appendChild(o);
        }
        sel.onchange = () => onChange(f.key, f.numeric ? parseFloat(sel.value) : sel.value);
        wrap.appendChild(sel);
      } else {
        label.textContent = f.label; wrap.appendChild(label);
        const input = document.createElement('input'); input.type = f.type === 'number' ? 'number' : 'text'; input.value = val ?? '';
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.type === 'number') { input.min = f.min; input.max = f.max; input.step = f.step || 1; }
        input.oninput = () => onChange(f.key, f.type === 'number' ? parseFloat(input.value) : input.value);
        if (f.autofocus) setTimeout(() => input.focus(), 0);
        wrap.appendChild(input);
      }
      el.appendChild(wrap);
    }
  }

  renderToolSettings() {
    const el = $('toolSettings');
    const ts = this.ts[this.tool] || {};
    const set = (k, v) => { ts[k] = v; prefs.set('ts.' + this.tool, ts); this.dirty = true; };
    const roadTypes = Object.entries(ROAD_TYPES).map(([k, v]) => [k, v.label]);
    const title = { type: 'section', label: TOOLS.find((t) => t.id === this.tool).label + ' settings' };
    let schema = [title];
    switch (this.tool) {
      case 'road': schema.push(
        { type: 'seg', key: 'type', label: 'Road type', options: roadTypes },
        { type: 'text', key: 'name', label: 'Name (optional)', placeholder: 'e.g. Mill Street' },
        { type: 'check', key: 'zoned', label: 'Generate buildings along it' },
        { type: 'select', key: 'bstyle', label: 'Building style', options: [['', 'Map default'], ...Object.entries(BUILDING_STYLES).map(([k, v]) => [k, v.label])] },
        { type: 'range', key: 'bdensity', label: 'Building density', min: 0, max: 1.6, step: 0.05, pct: true, zeroLabel: 'map default' },
        { type: 'check', key: 'tunnel', label: 'Tunnel (underground)' },
        { type: 'check', key: 'snap', label: 'Snap to existing roads' },
        { type: 'check', key: 'smooth', label: 'Smooth freehand strokes' },
        { type: 'info', html: 'Click-click-click to place points, <kbd>Enter</kbd> or double-click to finish, <kbd>Backspace</kbd> removes the last point, <kbd>Esc</kbd> cancels. Press and drag to draw freehand. Crossing another road creates a junction.' }); break;
      case 'grid': schema.push(
        { type: 'range', key: 'blockW', label: 'Block width', min: 30, max: 300, step: 5, unit: ' m' },
        { type: 'range', key: 'blockD', label: 'Block depth', min: 30, max: 300, step: 5, unit: ' m' },
        { type: 'seg', key: 'type', label: 'Road type', options: roadTypes.filter(([k]) => k !== 'rail' && k !== 'highway' && k !== 'river') },
        { type: 'check', key: 'zoned', label: 'Generate buildings' },
        { type: 'select', key: 'bstyle', label: 'Building style', options: [['', 'Map default'], ...Object.entries(BUILDING_STYLES).map(([k, v]) => [k, v.label])] },
        { type: 'range', key: 'bdensity', label: 'Building density', min: 0, max: 1.6, step: 0.05, pct: true, zeroLabel: 'map default' },
        { type: 'check', key: 'avoidWater', label: 'Skip blocks touching water' },
        { type: 'check', key: 'avoidParks', label: 'Skip blocks touching parks' },
        { type: 'check', key: 'snapAngle', label: 'Snap angle to 15°' },
        { type: 'info', html: 'Start on an existing road to align the grid with it. Hold <kbd>Shift</kbd> while dragging to lock the angle to 15° steps.' }); break;
      case 'paint': schema.push(
        { type: 'swatches', key: 'material', label: 'Material', options: [[MAT.PARK, 'Park', '#cfe6c3'], [MAT.FOREST, 'Forest', '#b7d6a6'], [MAT.SAND, 'Sand', '#f3e7c4'], [MAT.WATER, 'Water', '#a9d0ea'], [MAT.PAVED, 'Paved', '#e2e0da'], [MAT.FARMLAND, 'Farmland', '#eef0d4'], [MAT.LAND, 'Land', '#f1efe9']] },
        { type: 'range', key: 'radius', label: 'Brush size', min: 5, max: 400, step: 1, unit: ' m' },
        { type: 'info', html: 'Edges are fitted with smooth curves. Buildings never appear on water, parks or forest. Paint <b>Land</b> to erase, including sea and lakes that lie below sea level (the ground is lifted just above it).' }); break;
      case 'terrain': schema.push(
        { type: 'seg', key: 'mode', label: 'Mode', options: [['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten']] },
        { type: 'range', key: 'radius', label: 'Brush size', min: 10, max: 800, step: 5, unit: ' m' },
        { type: 'range', key: 'strength', label: 'Strength', min: 0.5, max: 40, step: 0.5, unit: ' m/s' },
        { type: 'range', key: 'hardness', label: 'Hardness', min: 0, max: 1, step: 0.05, pct: true },
        { type: 'info', html: 'Lower land below sea level to make lakes and bays. Flatten uses the height under the cursor when you press. Contours and shading update live; set the interval in the Map panel.' }); break;
      case 'place': schema.push(
        { type: 'select', key: 'category', label: 'Category', options: PLACE_OPTIONS },
        { type: 'text', key: 'name', label: 'Name', placeholder: 'Name for the next place' }); break;
      case 'label': schema.push(
        { type: 'seg', key: 'kind', label: 'Kind', options: Object.entries(LABEL_KINDS).map(([k, v]) => [k, v.label]) },
        { type: 'text', key: 'text', label: 'Text', placeholder: 'Label text' }); break;
      case 'roundabout': schema.push(
        { type: 'range', key: 'radius', label: 'Radius', min: 6, max: 60, step: 1, unit: ' m' },
        { type: 'info', html: 'Works on any junction with three or more roads. The ring takes the colour of the widest road meeting there. Changing the radius and clicking an existing roundabout resizes it.' }); break;
      case 'building': schema.push(
        { type: 'seg', key: 'mode', label: 'Shape', options: [['rect', 'Rectangle'], ['circle', 'Circle'], ['poly', 'Polygon']] },
        { type: 'range', key: 'levels', label: 'Levels', min: 1, max: 40, step: 1 },
        { type: 'check', key: 'align', label: 'Align rectangle to nearest road' },
        { type: 'text', key: 'name', label: 'Name (optional)', placeholder: 'Name for the next building' },
        { type: 'info', html: 'Rectangle: press and drag. Circle: press at the centre and drag out the radius. Polygon: click each corner, then click the first corner, double-click or press <kbd>Enter</kbd> to close. Hand-drawn buildings are kept when automatic buildings regenerate, and automatic ones keep clear of them.' }); break;
      case 'eraser': schema.push(
        { type: 'range', key: 'radius', label: 'Brush size', min: 5, max: 300, step: 1, unit: ' m' },
        { type: 'check', key: 'roads', label: 'Erase roads' },
        { type: 'check', key: 'places', label: 'Erase places' },
        { type: 'check', key: 'labels', label: 'Erase labels' },
        { type: 'check', key: 'buildings', label: 'Erase hand-drawn buildings' }); break;
      case 'select': schema.push({ type: 'info', html: 'Click to select. Drag a place or label to move it. Drag a road handle to reshape it; <kbd>Delete</kbd> removes the selected point or feature. <kbd>Ctrl+D</kbd> duplicates a place or label.' }); break;
      case 'pan': schema.push({ type: 'info', html: 'Drag to pan, scroll to zoom, <kbd>F</kbd> fits the map, <kbd>+</kbd>/<kbd>−</kbd> zoom. Hold <kbd>Space</kbd> with any tool to pan.' }); break;
    }
    this.form(el, schema, ts, set);
  }

  renderMapPanel() {
    const el = $('tabMap');
    const s = this.doc.settings;
    const set = (k, v) => {
      if (typeof v === 'number' && !Number.isFinite(v)) return;
      if (k === 'viewRotation') { this.setRotation(v, false); return; }
      if (k === 'seaLevel') { this.pushSetting('seaLevel', this.doc.terrain.seaLevel, v); this.doc.terrain.seaLevel = v; this.doc.terrain.version++; }
      else { this.pushSetting(k, s[k], v); s[k] = v; }
      if (k === 'autoBuildings') { if (!v) this.doc.frozenBuildings = this.buildings.map((b) => ({ ...b })); else this.doc.frozenBuildings = null; }
      this.invalidateTerrain(); this.invalidateBuildings(); this.markChanged();
    };
    const T = this.doc.terrain;
    const schema = [
      { type: 'section', label: 'Style' },
      { type: 'seg', key: 'style', label: 'Map style', options: Object.entries(STYLES).map(([k, v]) => [k, v.label]) },
      { type: 'section', label: 'Terrain' },
      { type: 'range', key: 'seaLevel', label: 'Sea level', min: -50, max: 200, step: 1, unit: ' m' },
      { type: 'check', key: 'showContours', label: 'Contour lines' },
      { type: 'select', key: 'contourInterval', label: 'Contour interval', numeric: true, options: [[1, '1 m'], [2, '2 m'], [5, '5 m'], [10, '10 m'], [20, '20 m'], [50, '50 m']] },
      { type: 'check', key: 'contourLabels', label: 'Elevation labels' },
      { type: 'check', key: 'showHillshade', label: 'Hill shading' },
      { type: 'range', key: 'exaggeration', label: 'Shading strength', min: 0.2, max: 4, step: 0.1 },
      { type: 'check', key: 'showTrees', label: 'Trees in forests' },
      { type: 'section', label: 'View' },
      { type: 'range', key: 'viewRotation', label: 'Rotate map', min: -180, max: 180, step: 1, unit: '°' },
      { type: 'buttons', buttons: [{ label: 'North up', onClick: () => this.setRotation(this.doc.settings.northBearing || 0) }, { label: 'Reset', onClick: () => this.setRotation(0) }] },
      { type: 'info', html: 'Turns the view only. Place names and labels stay upright; exports are not rotated.' },
      { type: 'section', label: 'Georeference' },
      { type: 'number', key: 'originLat', label: 'Origin latitude (°)', min: -90, max: 90, step: 0.0001 },
      { type: 'number', key: 'originLon', label: 'Origin longitude (°)', min: -180, max: 180, step: 0.0001 },
      { type: 'range', key: 'northBearing', label: 'North bearing', min: -180, max: 180, step: 1, unit: '°' },
      { type: 'check', key: 'showCompass', label: 'Compass rose' },
      { type: 'info', html: 'The map point (0, 0) is placed at this latitude and longitude in GeoJSON and OSM exports. North bearing rotates the map: 0° means up is north, 90° means up is east.' },
      { type: 'section', label: 'Buildings' },
      { type: 'check', key: 'autoBuildings', label: 'Automatic buildings' },
      { type: 'select', key: 'buildingStyle', label: 'Building style', options: Object.entries(BUILDING_STYLES).map(([k, v]) => [k, v.label]) },
      { type: 'range', key: 'buildingDensity', label: 'Density', min: 0.4, max: 1.6, step: 0.05, pct: true },
      { type: 'info', html: 'Map-wide defaults. Buildings line roads marked “Generate buildings”, facing the street, set back from other roads and never on water, parks or forest. Select a road to give it its own style and density. Turning automatic buildings off freezes the current ones.' },
      { type: 'section', label: 'Map' },
      { type: 'stats', rows: [['Roads', 'stRoads'], ['Buildings', 'stBuildings'], ['Places', 'stPlaces'], ['Labels', 'stLabels'], ['Terrain tiles', 'stTiles']] },
      { type: 'buttons', buttons: [{ label: 'Fit to map', onClick: () => this.fit() }, { label: 'Remove hidden roads', onClick: () => this.removeHiddenRoads() }] },
      { type: 'info', html: '“Remove hidden roads” deletes roads that lie completely underneath a wider road, such as a street left under an avenue, together with the buildings they generate.' },
    ];
    const obj = { ...s, seaLevel: T.seaLevel, viewRotation: Math.round(((this.view?.rot || 0) * 180) / Math.PI) };
    this.form(el, schema, obj, set);
  }
  pushSetting(key, before, after) {
    if (before === after) return;
    const apply = (v) => { if (key === 'seaLevel') { this.doc.terrain.seaLevel = v; this.doc.terrain.version++; } else this.doc.settings[key] = v; this.invalidateTerrain(); this.invalidateBuildings(); this.renderMapPanel(); this.markChanged(); };
    // Coalesce rapid slider changes into one history entry
    const top = this.history.undoStack[this.history.undoStack.length - 1];
    if (top && top.key === key && performance.now() - top.time < 1500 && !this.history.redoStack.length) { top.redo = () => apply(after); top.time = performance.now(); return; }
    this.history.push({ label: 'Setting', key, time: performance.now(), undo: () => apply(before), redo: () => apply(after) });
  }

  renderSelectionPanel() {
    const el = $('tabSelection');
    const sel = this.selection;
    if (!sel) { el.innerHTML = '<div class="info">Nothing selected. Use the Select tool and click a road, place, or label.</div>'; return; }
    if (sel.kind === 'road') {
      const e = this.doc.roads.edges.get(sel.id);
      if (!e) { this.selection = null; return this.renderSelectionPanel(); }
      const chain = this.doc.roads.streetChain(e.id);
      const whole = { wholeStreet: prefs.get('wholeStreet', true) };
      const set = (k, v) => {
        if (k === 'wholeStreet') { whole.wholeStreet = v; prefs.set('wholeStreet', v); this.dirty = true; return; }
        const targets = (whole.wholeStreet && k !== 'tunnel' ? chain : [e.id]).map((id) => this.doc.roads.edges.get(id)).filter(Boolean);
        const prevs = targets.map((t) => ({ t, prev: { ...t } }));
        const apply = () => { for (const t of targets) { t[k] = v; if (k === 'type') t.zoned = ROAD_TYPES[v].zoned && !t.tunnel; if (k === 'tunnel' && v) t.zoned = false; } this.doc.roads.version++; this.invalidateBuildings(); this.markChanged(); };
        apply();
        this.history.push({ label: 'Edit road', undo: () => { for (const { t, prev } of prevs) Object.assign(t, prev); this.doc.roads.version++; this.invalidateBuildings(); this.markChanged(); }, redo: apply });
      };
      this.form(el, [
        { type: 'section', label: chain.length > 1 ? `Street · ${chain.length} segments` : 'Road' },
        ...(chain.length > 1 ? [{ type: 'check', key: 'wholeStreet', label: 'Apply to the whole street', obj: whole }] : []),
        { type: 'text', key: 'name', label: 'Name', placeholder: 'Unnamed road' },
        { type: 'seg', key: 'type', label: 'Type', options: Object.entries(ROAD_TYPES).map(([k, v]) => [k, v.label]) },
        { type: 'range', key: 'width', label: 'Width override', min: 0, max: 40, step: 1, unit: ' m', zeroLabel: 'default' },
        { type: 'check', key: 'zoned', label: 'Generate buildings along it' },
        { type: 'select', key: 'bstyle', label: 'Building style', options: [['', 'Map default'], ...Object.entries(BUILDING_STYLES).map(([k, v]) => [k, v.label])] },
        { type: 'range', key: 'bdensity', label: 'Building density', min: 0, max: 1.6, step: 0.05, pct: true, zeroLabel: 'map default' },
        { type: 'check', key: 'tunnel', label: 'Tunnel (this segment only)' },
        { type: 'info', html: 'To put only part of a road underground: double-click the road where the tunnel should start to add a point, click that handle, then <b>Split road here</b>. Repeat at the other end, then tick Tunnel on the middle segment.' },
        ...(sel.handle?.kind === 'pt' ? [{ type: 'buttons', buttons: [{ label: 'Split road here', onClick: () => this.splitAtHandle() }] }] : []),
        { type: 'info', html: 'Drag the circular handles to reshape. Double-click the road to insert a point. Select a handle and press <kbd>Delete</kbd> to remove it.' },
        { type: 'buttons', buttons: [{ label: chain.length > 1 && whole.wholeStreet ? 'Delete street' : 'Delete road', cls: 'danger', onClick: () => this.deleteSelection() }] },
      ], e, set);
    } else if (sel.kind === 'place') {
      const p = this.doc.places.find((x) => x.id === sel.id);
      if (!p) { this.selection = null; return this.renderSelectionPanel(); }
      const set = (k, v) => { const prev = p[k]; p[k] = v; this.history.push({ label: 'Edit place', undo: () => { p[k] = prev; this.markChanged(); }, redo: () => { p[k] = v; this.markChanged(); } }); this.markChanged(); };
      this.form(el, [
        { type: 'section', label: 'Place' },
        { type: 'text', key: 'name', label: 'Name', placeholder: 'Place name', autofocus: sel.fresh },
        { type: 'select', key: 'category', label: 'Category', options: PLACE_OPTIONS },
        { type: 'buttons', buttons: [{ label: 'Delete place', cls: 'danger', onClick: () => this.deleteSelection() }] },
      ], p, set);
    } else if (sel.kind === 'building') {
      const b = this.doc.buildings.find((x) => x.id === sel.id);
      if (!b) { this.selection = null; return this.renderSelectionPanel(); }
      const set = (k, v) => { if (typeof v === 'number' && !Number.isFinite(v)) return; const prev = b[k], prevPts = b.pts; const apply = (val) => { b[k] = val; if (k === 'r') b.pts = this.circlePts(b.cx, b.cy, val); this.markChanged(); }; apply(v); this.history.push({ label: 'Edit building', undo: () => { b[k] = prev; b.pts = prevPts; this.markChanged(); }, redo: () => apply(v) }); };
      this.form(el, [
        { type: 'section', label: 'Building' },
        { type: 'text', key: 'name', label: 'Name (optional)', placeholder: 'e.g. Town Hall', autofocus: sel.fresh },
        { type: 'range', key: 'h', label: 'Levels', min: 1, max: 40, step: 1 },
        ...(b.shape === 'circle' ? [{ type: 'range', key: 'r', label: 'Radius', min: 2, max: 300, step: 1, unit: ' m' }] : []),
        { type: 'info', html: b.shape === 'circle' ? 'Drag the building to move it; drag the handle on its edge or use the slider to change the radius. Automatic buildings keep clear of it.' : 'Drag the building to move it. Drag a corner handle to reshape it; double-click an edge to add a corner. Select a handle and press <kbd>Delete</kbd> to remove it. Automatic buildings keep clear of it.' },
        { type: 'buttons', buttons: [{ label: 'Delete building', cls: 'danger', onClick: () => this.deleteSelection() }] },
      ], b, set);
    } else if (sel.kind === 'label') {
      const l = this.doc.labels.find((x) => x.id === sel.id);
      if (!l) { this.selection = null; return this.renderSelectionPanel(); }
      const set = (k, v) => { const prev = l[k]; l[k] = v; this.history.push({ label: 'Edit label', undo: () => { l[k] = prev; this.markChanged(); }, redo: () => { l[k] = v; this.markChanged(); } }); this.markChanged(); };
      this.form(el, [
        { type: 'section', label: 'Label' },
        { type: 'text', key: 'text', label: 'Text', autofocus: sel.fresh },
        { type: 'seg', key: 'kind', label: 'Kind', options: Object.entries(LABEL_KINDS).map(([k, v]) => [k, v.label]) },
        { type: 'range', key: 'size', label: 'Size', min: 8, max: 64, step: 1, unit: ' px' },
        { type: 'range', key: 'angle', label: 'Angle', min: -90, max: 90, step: 1, unit: '°' },
        { type: 'buttons', buttons: [{ label: 'Delete label', cls: 'danger', onClick: () => this.deleteSelection() }] },
      ], l, set);
    }
    sel.fresh = false;
  }
  select(sel) { this.selection = sel; this.renderSelectionPanel(); if (sel) this.showTab('selection'); this.dirty = true; }

  // ---------- View ----------
  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * this.dpr); this.canvas.height = Math.round(rect.height * this.dpr);
    this.canvas.style.width = rect.width + 'px'; this.canvas.style.height = rect.height + 'px';
    if (!this.view) this.view = { cx: 0, cy: 0, scale: 1 };
    this.view.w = rect.width; this.view.h = rect.height;
    this.invalidateTerrain(); this.dirty = true;
  }
  /** Rotate the view (degrees, clockwise). */
  setRotation(deg, updatePanel = true) {
    let d = ((deg + 180) % 360 + 360) % 360 - 180;
    this.view.rot = (d * Math.PI) / 180;
    this.invalidateTerrain(); this.dirty = true; this.scheduleAutosave();
    if (updatePanel) for (const f of $('tabMap').querySelectorAll('.field')) if (f._update && f.dataset.key === 'viewRotation') f._update(Math.round(d));
  }
  zoomBy(f, sx = this.view.w / 2, sy = this.view.h / 2) {
    const before = screenToWorld(this.view, sx, sy);
    this.view.scale = clamp(this.view.scale * f, 0.04, 12);
    const after = screenToWorld(this.view, sx, sy);
    this.view.cx += before.x - after.x; this.view.cy += before.y - after.y;
    this.invalidateTerrain(); this.dirty = true; this.scheduleAutosave();
  }
  contentBounds() {
    const bs = [this.doc.terrain.bounds(), this.doc.roads.bounds()].filter(Boolean);
    const pts = [...this.doc.places, ...this.doc.labels];
    if (pts.length) bs.push({ minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) });
    if (!bs.length) return null;
    return { minX: Math.min(...bs.map((b) => b.minX)), minY: Math.min(...bs.map((b) => b.minY)), maxX: Math.max(...bs.map((b) => b.maxX)), maxY: Math.max(...bs.map((b) => b.maxY)) };
  }
  fit() {
    const b = this.contentBounds();
    if (!b) { this.view.cx = 0; this.view.cy = 0; this.view.scale = 1; }
    else {
      const w = Math.max(200, b.maxX - b.minX), h = Math.max(200, b.maxY - b.minY);
      this.view.scale = clamp(Math.min(this.view.w / w, this.view.h / h) * 0.9, 0.04, 12);
      this.view.cx = (b.minX + b.maxX) / 2; this.view.cy = (b.minY + b.maxY) / 2;
    }
    this.invalidateTerrain(); this.dirty = true;
  }

  // ---------- Input ----------
  bindCanvas() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); c.focus(); this.onDown(e); });
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('dblclick', (e) => this.onDouble(e));
    c.addEventListener('wheel', (e) => { e.preventDefault(); const f = Math.exp(-e.deltaY * 0.0015); this.zoomBy(f, e.offsetX, e.offsetY); }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  updatePointer(e) {
    const p = this.pointer;
    p.sx = e.offsetX; p.sy = e.offsetY;
    const w = screenToWorld(this.view, p.sx, p.sy);
    p.x = w.x; p.y = w.y;
  }
  onDown(e) {
    this.updatePointer(e);
    const p = this.pointer;
    p.down = true; p.button = e.button; p.startSx = p.sx; p.startSy = p.sy; p.moved = false;
    if (e.button === 1 || this.space || this.tool === 'pan' || (e.button === 2 && this.tool !== 'road')) { this.draft = { kind: 'pan', cx: this.view.cx, cy: this.view.cy }; this.canvas.style.cursor = 'grabbing'; return; }
    if (e.button === 2) { if (this.draft?.kind === 'roadPts') { this.draft.pts.pop(); if (!this.draft.pts.length) this.draft = null; this.dirty = true; } return; }
    const h = this['down_' + this.tool];
    if (h) h.call(this, e);
  }
  onMove(e) {
    this.updatePointer(e);
    const p = this.pointer;
    if (p.down && Math.hypot(p.sx - p.startSx, p.sy - p.startSy) > 4) p.moved = true;
    $('statusCoords').textContent = `x ${Math.round(p.x)}  y ${Math.round(p.y)}  elev ${this.doc.terrain.heightAt(p.x, p.y).toFixed(1)} m`;
    if (this.draft?.kind === 'pan' && p.down) {
      // Screen drag → world offset, accounting for the view rotation
      const dx = p.sx - p.startSx, dy = p.sy - p.startSy, r = this.view.rot || 0, c = Math.cos(r), sn = Math.sin(r);
      this.view.cx = this.draft.cx - (dx * c + dy * sn) / this.view.scale;
      this.view.cy = this.draft.cy - (-dx * sn + dy * c) / this.view.scale;
      this.dirty = true; return;
    }
    const h = this['move_' + this.tool];
    if (h) h.call(this, e);
    this.dirty = true;
  }
  onUp(e) {
    this.updatePointer(e);
    const p = this.pointer;
    if (this.draft?.kind === 'pan') { this.onMove(e); this.draft = null; p.down = false; this.canvas.style.cursor = this.tool === 'pan' ? 'grab' : this.tool === 'select' ? 'default' : 'crosshair'; this.scheduleAutosave(); return; }
    const h = this['up_' + this.tool];
    if (p.down && h) h.call(this, e);
    p.down = false;
    this.dirty = true;
  }
  onDouble(e) {
    this.updatePointer(e);
    if (this.tool === 'road' && this.draft?.kind === 'roadPts') { this.finishRoad(); return; }
    if (this.tool === 'building' && this.draft?.kind === 'bPoly') { this.finishBuildingPoly(); return; }
    if (this.tool === 'select') this.selectDouble();
  }
  onKey(e) {
    const inField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveFile(); return; }
    if (inField) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicateSelection(); return; }
    if (e.code === 'Space') { if (!this.space) { this.space = true; this.canvas.style.cursor = 'grab'; } e.preventDefault(); return; }
    if (e.key === 'Escape') { this.draft = null; this.select(null); this.updateHint(); this.dirty = true; return; }
    if (e.key === 'Enter' && this.draft?.kind === 'roadPts') { this.finishRoad(); return; }
    if (e.key === 'Enter' && this.draft?.kind === 'gridDepth') { this.commitGrid(); return; }
    if (e.key === 'Enter' && this.draft?.kind === 'bPoly') { this.finishBuildingPoly(); return; }
    if (e.key === 'Backspace' && this.draft?.kind === 'bPoly') { this.draft.pts.pop(); if (!this.draft.pts.length) { this.draft = null; this.updateHint(); } this.dirty = true; return; }
    if ((e.key === 'Backspace') && this.draft?.kind === 'roadPts') { this.draft.pts.pop(); if (!this.draft.pts.length) this.draft = null; this.dirty = true; return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { this.deleteSelection(); return; }
    if (e.key === '[' || e.key === ']') { this.adjustBrush(e.key === ']' ? 1 : -1, e.shiftKey); return; }
    if (e.key === '+' || e.key === '=') { this.zoomBy(1.4); return; }
    if (e.key === '-') { this.zoomBy(1 / 1.4); return; }
    if (e.key.toLowerCase() === 'f') { this.fit(); return; }
    const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (t && !mod) this.setTool(t.id);
  }
  adjustBrush(dir, shift) {
    const ts = this.ts[this.tool];
    if (!ts) return;
    if (shift && this.tool === 'terrain') ts.strength = clamp(+(ts.strength * (dir > 0 ? 1.25 : 0.8)).toFixed(1), 0.5, 40);
    else if ('radius' in ts) ts.radius = clamp(Math.round(ts.radius * (dir > 0 ? 1.2 : 1 / 1.2)), 5, 800);
    prefs.set('ts.' + this.tool, ts);
    for (const f of $('toolSettings').querySelectorAll('.field')) if (f._update && f.dataset.key in ts) f._update(ts[f.dataset.key]);
    this.dirty = true;
  }

  // ---------- History helpers ----------
  undo() { const e = this.history.undo(); if (e) { this.draft = null; this.afterHistory(); this.toast(`Undo ${e.label.toLowerCase()}`); } }
  redo() { const e = this.history.redo(); if (e) { this.draft = null; this.afterHistory(); this.toast(`Redo ${e.label.toLowerCase()}`); } }
  afterHistory() { this.invalidateTerrain(); this.invalidateBuildings(); this.renderSelectionPanel(); this.renderMapPanel(); this.markChanged(); }
  /** Snapshot road graph + features; call fn; push history entry. */
  withFeatureHistory(label, fn) {
    const before = this.featureSnapshot();
    const result = fn();
    const after = this.featureSnapshot();
    this.history.push({ label, undo: () => this.restoreFeatures(before), redo: () => this.restoreFeatures(after) });
    this.doc.roads.version++;
    this.invalidateBuildings(); this.markChanged();
    return result;
  }
  featureSnapshot() { return { roads: this.doc.roads.toJSON(), places: JSON.stringify(this.doc.places), labels: JSON.stringify(this.doc.labels), buildings: JSON.stringify(this.doc.buildings) }; }
  restoreFeatures(s) {
    this.doc.roads = RoadGraph.fromJSON(s.roads);
    this.doc.places = JSON.parse(s.places); this.doc.labels = JSON.parse(s.labels); this.doc.buildings = JSON.parse(s.buildings || '[]');
    this.selection = null;
  }
  /** Terrain stroke history: tiles touched. */
  beginTerrainStroke(label) { this.stroke = { label, before: new Map() }; }
  touchTiles(x, y, r) {
    const T = this.doc.terrain;
    for (const [tx, ty] of T.tilesInCircle(x, y, r)) { const k = `${tx},${ty}`; if (!this.stroke.before.has(k)) this.stroke.before.set(k, { tx, ty, snap: T.snapshotTile(tx, ty) }); }
  }
  endTerrainStroke() {
    const st = this.stroke; this.stroke = null;
    if (!st || !st.before.size) return;
    const T = this.doc.terrain;
    const after = new Map();
    for (const [k, v] of st.before) after.set(k, { tx: v.tx, ty: v.ty, snap: T.snapshotTile(v.tx, v.ty) });
    const restore = (map) => { for (const v of map.values()) T.restoreTile(v.tx, v.ty, v.snap); };
    this.history.push({ label: st.label, undo: () => restore(st.before), redo: () => restore(after) });
    this.invalidateBuildings(); this.markChanged(); this.renderMapPanel();
  }

  // ---------- Tools: select ----------
  hitTest(sx, sy) {
    const v = this.view, w = screenToWorld(v, sx, sy);
    // places
    for (const p of [...this.doc.places].reverse()) { const s = worldToScreen(v, p.x, p.y); if (dist2(s.x, s.y, sx, sy) < 12 * 12) return { kind: 'place', id: p.id }; }
    for (const l of [...this.doc.labels].reverse()) {
      const k = LABEL_KINDS[l.kind] || LABEL_KINDS.district; const size = l.size || k.size; const s = worldToScreen(v, l.x, l.y);
      const hw = (l.text.length * size * 0.33) + 6;
      const a = -(l.angle || 0) * Math.PI / 180, dx = sx - s.x, dy = sy - s.y;
      const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(rx) < hw && Math.abs(ry) < size * 0.7) return { kind: 'label', id: l.id };
    }
    for (const b of [...this.doc.buildings].reverse()) if (pointInPolygon(w.x, w.y, b.pts)) return { kind: 'building', id: b.id };
    const g = this.doc.roads;
    const cands = [];
    for (const e of g.edges.values()) {
      const pts = roadGeometry(g, e);
      const c = closestOnPolyline(w.x, w.y, pts);
      const tol = Math.max(g.width(e) / 2 + 2, 7 / v.scale);
      if (c && c.d2 < tol * tol) cands.push({ kind: 'road', id: e.id, d2: c.d2 });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.d2 - b.d2);
    // Clicking the same spot again cycles through overlapping roads (e.g. a street hidden under an avenue)
    const sel = this.selection;
    if (sel?.kind === 'road' && cands.length > 1) {
      const idx = cands.findIndex((c) => c.id === sel.id);
      if (idx >= 0) return { ...cands[(idx + 1) % cands.length], others: cands.length - 1 };
    }
    return { ...cands[0], others: cands.length - 1 };
  }
  roadHandles(e) {
    const g = this.doc.roads;
    const out = [{ kind: 'node', id: e.a, x: g.nodes.get(e.a).x, y: g.nodes.get(e.a).y }];
    e.pts.forEach((p, i) => out.push({ kind: 'pt', index: i, x: p.x, y: p.y }));
    out.push({ kind: 'node', id: e.b, x: g.nodes.get(e.b).x, y: g.nodes.get(e.b).y });
    return out;
  }
  down_select() {
    const p = this.pointer, sel = this.selection;
    if (sel?.kind === 'road') {
      const e = this.doc.roads.edges.get(sel.id);
      if (e) for (const h of this.roadHandles(e)) { const s = worldToScreen(this.view, h.x, h.y); if (dist2(s.x, s.y, p.sx, p.sy) < 10 * 10) { this.draft = { kind: 'dragHandle', handle: h, before: this.featureSnapshot() }; const had = sel.handle?.kind === 'pt'; sel.handle = h; if ((h.kind === 'pt') !== had) this.renderSelectionPanel(); this.dirty = true; return; } }
      if (sel.handle?.kind === 'pt') { sel.handle = null; this.renderSelectionPanel(); }
      sel.handle = null;
    }
    if (sel?.kind === 'building') {
      const b = this.doc.buildings.find((x) => x.id === sel.id);
      if (b && b.shape === 'circle') { const s = worldToScreen(this.view, b.cx + b.r, b.cy); if (dist2(s.x, s.y, p.sx, p.sy) < 10 * 10) { this.draft = { kind: 'dragRadius', before: this.featureSnapshot() }; sel.handle = { kind: 'radius' }; this.dirty = true; return; } }
      else if (b) for (let i = 0; i < b.pts.length; i++) { const s = worldToScreen(this.view, b.pts[i].x, b.pts[i].y); if (dist2(s.x, s.y, p.sx, p.sy) < 10 * 10) { this.draft = { kind: 'dragCorner', index: i, before: this.featureSnapshot() }; sel.handle = { kind: 'corner', index: i }; this.dirty = true; return; } }
      sel.handle = null;
    }
    const hit = this.hitTest(p.sx, p.sy);
    if (!hit) { this.select(null); return; }
    if (!sel || sel.id !== hit.id) { this.select(hit); if (hit.others) this.toast(`${hit.others + 1} roads here – click again to select the next one`); }
    if (hit.kind === 'place' || hit.kind === 'label') {
      const f = (hit.kind === 'place' ? this.doc.places : this.doc.labels).find((x) => x.id === hit.id);
      this.draft = { kind: 'dragFeature', f, ox: f.x - p.x, oy: f.y - p.y, startX: f.x, startY: f.y };
    } else if (hit.kind === 'building') {
      const b = this.doc.buildings.find((x) => x.id === hit.id);
      this.draft = { kind: 'dragBuilding', b, lastX: p.x, lastY: p.y, before: this.featureSnapshot() };
    }
  }
  move_select() {
    const p = this.pointer, d = this.draft;
    if (!p.down) { this.hover = this.hitTest(p.sx, p.sy); this.canvas.style.cursor = this.hover ? 'pointer' : 'default'; return; }
    if (d?.kind === 'dragFeature') { d.f.x = p.x + d.ox; d.f.y = p.y + d.oy; }
    else if (d?.kind === 'dragBuilding') { const dx = p.x - d.lastX, dy = p.y - d.lastY; for (const q of d.b.pts) { q.x += dx; q.y += dy; } if (d.b.shape === 'circle') { d.b.cx += dx; d.b.cy += dy; } d.lastX = p.x; d.lastY = p.y; }
    else if (d?.kind === 'dragRadius') { const b = this.doc.buildings.find((x) => x.id === this.selection.id); if (b) { b.r = Math.max(2, dist(p.x, p.y, b.cx, b.cy)); b.pts = this.circlePts(b.cx, b.cy, b.r); } }
    else if (d?.kind === 'dragCorner') { const b = this.doc.buildings.find((x) => x.id === this.selection.id); if (b) { b.pts[d.index].x = p.x; b.pts[d.index].y = p.y; } }
    else if (d?.kind === 'dragHandle') {
      const e = this.doc.roads.edges.get(this.selection.id);
      if (!e) return;
      if (d.handle.kind === 'node') { const t = this.doc.roads.snapTargetForNode(d.handle.id, p.x, p.y, 12 / this.view.scale + 4); d.snapTarget = t; this.doc.roads.moveNode(d.handle.id, t ? t.x : p.x, t ? t.y : p.y); }
      else { e.pts[d.handle.index].x = p.x; e.pts[d.handle.index].y = p.y; this.doc.roads.version++; }
      d.handle.x = p.x; d.handle.y = p.y;
    }
  }
  up_select() {
    const d = this.draft, p = this.pointer;
    if (d?.kind === 'dragFeature' && p.moved) {
      const f = d.f, from = { x: d.startX, y: d.startY }, to = { x: f.x, y: f.y };
      this.history.push({ label: 'Move', undo: () => { f.x = from.x; f.y = from.y; this.markChanged(); }, redo: () => { f.x = to.x; f.y = to.y; this.markChanged(); } });
      this.markChanged();
    } else if ((d?.kind === 'dragHandle' || d?.kind === 'dragBuilding' || d?.kind === 'dragCorner' || d?.kind === 'dragRadius') && p.moved) {
      let sel = this.selection;
      if (d.kind === 'dragHandle' && d.handle.kind === 'node' && d.snapTarget) {
        const edgeIdBefore = sel.id;
        const node = this.doc.roads.connectNode(d.handle.id, d.snapTarget);
        if (node) {
          const e = this.doc.roads.edges.get(edgeIdBefore) || this.doc.roads.edgesAt(node.id)[0];
          sel = e ? { kind: 'road', id: e.id } : null;
          this.toast('Roads connected');
        }
      }
      const after = this.featureSnapshot(), before = d.before;
      this.history.push({ label: d.kind === 'dragHandle' ? (d.snapTarget ? 'Connect roads' : 'Reshape road') : d.kind === 'dragBuilding' ? 'Move building' : d.kind === 'dragRadius' ? 'Resize building' : 'Reshape building', undo: () => this.restoreFeatures(before), redo: () => this.restoreFeatures(after) });
      this.selection = sel; this.renderSelectionPanel();
      this.invalidateBuildings(); this.markChanged();
    }
    this.draft = null;
  }
  splitAtHandle() {
    const sel = this.selection;
    if (sel?.kind !== 'road' || sel.handle?.kind !== 'pt') return;
    let node = null;
    this.withFeatureHistory('Split road', () => { node = this.doc.roads.splitAtPoint(sel.id, sel.handle.index); });
    if (!node) return;
    const e = [...this.doc.roads.edges.values()].find((x) => x.b === node.id) || [...this.doc.roads.edges.values()].find((x) => x.a === node.id);
    this.select(e ? { kind: 'road', id: e.id } : null);
    this.toast('Road split. Select a piece and tick Tunnel.');
  }
  selectDouble() {
    const sel = this.selection, p = this.pointer;
    if (sel?.kind === 'building') {
      const b = this.doc.buildings.find((x) => x.id === sel.id);
      if (!b || b.shape === 'circle') return;
      const ring = [...b.pts, b.pts[0]];
      const c = closestOnPolyline(p.x, p.y, ring);
      if (!c || c.d2 > (10 / this.view.scale) ** 2) return;
      this.withFeatureHistory('Insert corner', () => { b.pts.splice(c.seg + 1, 0, { x: c.x, y: c.y }); });
      this.selection = sel; this.renderSelectionPanel();
      return;
    }
    if (sel?.kind !== 'road') return;
    const e = this.doc.roads.edges.get(sel.id);
    if (!e) return;
    const pts = this.doc.roads.edgePoints(e);
    const c = closestOnPolyline(p.x, p.y, pts);
    if (!c) return;
    this.withFeatureHistory('Insert point', () => { e.pts.splice(c.seg, 0, { x: c.x, y: c.y }); });
    this.selection = sel; this.renderSelectionPanel();
  }
  deleteSelection() {
    const sel = this.selection;
    if (!sel) return;
    if (sel.kind === 'road') {
      const e = this.doc.roads.edges.get(sel.id);
      if (!e) return;
      if (sel.handle?.kind === 'pt') { this.withFeatureHistory('Delete point', () => e.pts.splice(sel.handle.index, 1)); this.selection = { kind: 'road', id: sel.id }; this.renderSelectionPanel(); return; }
      const ids = prefs.get('wholeStreet', true) ? this.doc.roads.streetChain(sel.id) : [sel.id];
      this.withFeatureHistory(ids.length > 1 ? 'Delete street' : 'Delete road', () => { const ends = new Set(); for (const id of ids) { const ed = this.doc.roads.edges.get(id); if (ed) { ends.add(ed.a); ends.add(ed.b); } this.doc.roads.removeEdge(id, false); } for (const n of ends) this.doc.roads.healNode(n); });
      this.select(null);
    } else if (sel.kind === 'building') {
      const b = this.doc.buildings.find((x) => x.id === sel.id);
      if (!b) return;
      if (sel.handle?.kind === 'corner' && b.shape !== 'circle' && b.pts.length > 3) { this.withFeatureHistory('Delete corner', () => b.pts.splice(sel.handle.index, 1)); this.selection = { kind: 'building', id: sel.id }; this.renderSelectionPanel(); return; }
      this.withFeatureHistory('Delete building', () => { this.doc.buildings = this.doc.buildings.filter((x) => x.id !== sel.id); }); this.select(null);
    } else if (sel.kind === 'place') { this.withFeatureHistory('Delete place', () => { this.doc.places = this.doc.places.filter((x) => x.id !== sel.id); }); this.select(null); }
    else if (sel.kind === 'label') { this.withFeatureHistory('Delete label', () => { this.doc.labels = this.doc.labels.filter((x) => x.id !== sel.id); }); this.select(null); }
  }
  duplicateSelection() {
    const sel = this.selection;
    if (!sel || sel.kind === 'road') return;
    if (sel.kind === 'building') {
      const b = this.doc.buildings.find((x) => x.id === sel.id);
      if (!b) return;
      const off = 30 / this.view.scale;
      const copy = { ...b, id: uid('b'), pts: b.pts.map((q) => ({ x: q.x + off, y: q.y + off })), ...(b.shape === 'circle' ? { cx: b.cx + off, cy: b.cy + off } : {}) };
      this.withFeatureHistory('Duplicate', () => this.doc.buildings.push(copy));
      this.select({ kind: 'building', id: copy.id });
      return;
    }
    const arr = sel.kind === 'place' ? this.doc.places : this.doc.labels;
    const f = arr.find((x) => x.id === sel.id);
    if (!f) return;
    const copy = { ...f, id: uid(sel.kind[0]), x: f.x + 30 / this.view.scale, y: f.y + 30 / this.view.scale };
    this.withFeatureHistory('Duplicate', () => arr.push(copy));
    this.select({ kind: sel.kind, id: copy.id });
  }


  // ---------- Tools: roundabout ----------
  move_roundabout() {
    const p = this.pointer;
    const n = this.doc.roads.nearestJunction(p.x, p.y, 25 / this.view.scale + 10);
    this.hover = n ? { junction: n } : null;
    this.canvas.style.cursor = n ? 'pointer' : 'crosshair';
  }
  up_roundabout() {
    if (this.pointer.moved) return;
    const p = this.pointer, ts = this.ts.roundabout;
    const n = this.doc.roads.nearestJunction(p.x, p.y, 25 / this.view.scale + 10);
    if (!n) { this.toast('Click a junction where three or more roads meet.'); return; }
    const node = n;
    if (node.ra && Math.abs(node.ra - ts.radius) < 0.5) { this.withFeatureHistory('Remove roundabout', () => { delete this.doc.roads.nodes.get(node.id).ra; }); this.toast('Roundabout removed'); }
    else { this.withFeatureHistory(node.ra ? 'Resize roundabout' : 'Add roundabout', () => { this.doc.roads.nodes.get(node.id).ra = ts.radius; }); }
  }

  // ---------- Tools: building ----------
  /** Unit direction of the nearest road within reach, or null. */
  nearestRoadDir(x, y, reach) {
    const g = this.doc.roads;
    let best = null;
    for (const e of g.edges.values()) {
      const pts = roadGeometry(g, e);
      const c = closestOnPolyline(x, y, pts);
      if (c && c.d2 <= reach * reach && (!best || c.d2 < best.d2)) best = { d2: c.d2, a: pts[c.seg], b: pts[c.seg + 1] };
    }
    if (!best) return null;
    const L = dist(best.a.x, best.a.y, best.b.x, best.b.y) || 1;
    return { x: (best.b.x - best.a.x) / L, y: (best.b.y - best.a.y) / L };
  }
  down_building() {
    const p = this.pointer, ts = this.ts.building;
    if (ts.mode === 'poly') {
      if (this.draft?.kind === 'bPoly') {
        const first = this.draft.pts[0];
        if (this.draft.pts.length >= 3 && dist(p.x, p.y, first.x, first.y) < 8 / this.view.scale) { this.finishBuildingPoly(); return; }
        this.draft.pts.push({ x: p.x, y: p.y });
      } else { this.draft = { kind: 'bPoly', pts: [{ x: p.x, y: p.y }], hint: 'Click to add corners. Click the first corner, double-click or press Enter to close. Esc cancels.' }; this.updateHint(); }
      return;
    }
    if (ts.mode === 'circle') { this.draft = { kind: 'bCircle', cx: p.x, cy: p.y }; return; }
    const dir = ts.align ? this.nearestRoadDir(p.x, p.y, 150) : null;
    this.draft = { kind: 'bRect', start: { x: p.x, y: p.y }, u: dir || { x: 1, y: 0 } };
  }
  move_building() {
    const d = this.draft, p = this.pointer;
    if (d?.kind === 'bPoly') d.cursor = { x: p.x, y: p.y };
  }
  rectCorners(d) {
    const p = this.pointer, u = d.u, v = { x: -u.y, y: u.x };
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    const a = dx * u.x + dy * u.y, b = dx * v.x + dy * v.y;
    const P = (s, t) => ({ x: d.start.x + u.x * s + v.x * t, y: d.start.y + u.y * s + v.y * t });
    return [P(0, 0), P(a, 0), P(a, b), P(0, b)];
  }
  circlePts(cx, cy, r) {
    const n = Math.max(16, Math.min(72, Math.round(r * 1.5)));
    const pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
    return pts;
  }
  up_building() {
    const d = this.draft, p = this.pointer;
    if (d?.kind === 'bCircle') {
      this.draft = null;
      const r = dist(p.x, p.y, d.cx, d.cy);
      if (!p.moved || r < 2) return;
      this.commitBuilding(this.circlePts(d.cx, d.cy, r), { shape: 'circle', cx: d.cx, cy: d.cy, r });
      return;
    }
    if (d?.kind !== 'bRect') return;
    this.draft = null;
    if (!p.moved) return;
    const pts = this.rectCorners(d);
    if (Math.abs(polygonArea(pts)) < 4) return;
    this.commitBuilding(pts);
  }
  finishBuildingPoly() {
    const d = this.draft;
    this.draft = null; this.updateHint();
    if (d?.kind === 'bPoly' && d.pts.length >= 3 && Math.abs(polygonArea(d.pts)) >= 4) this.commitBuilding(d.pts);
    this.dirty = true;
  }
  commitBuilding(pts, extra = {}) {
    const ts = this.ts.building;
    if (polygonArea(pts) < 0) pts = pts.slice().reverse();
    const b = { id: uid('b'), pts: pts.map((q) => ({ x: q.x, y: q.y })), h: ts.levels || 1, name: ts.name || '', manual: true, ...extra };
    this.withFeatureHistory('Add building', () => this.doc.buildings.push(b));
    this.select({ kind: 'building', id: b.id, fresh: false });
  }
  buildingCentroid(b) { let x = 0, y = 0; for (const q of b.pts) { x += q.x; y += q.y; } return { x: x / b.pts.length, y: y / b.pts.length }; }

  // ---------- Tools: road ----------
  snapPoint(x, y) {
    const ts = this.ts.road;
    if (!ts.snap) return { x, y };
    const near = this.doc.roads.nearest(x, y, 12 / this.view.scale + 4, null, ROAD_TYPES[ts.type]?.water ? 'water' : 'road');
    return near ? { x: near.x, y: near.y, snapped: true } : { x, y };
  }
  down_road() {
    const p = this.pointer;
    if (this.draft?.kind === 'roadPts') {
      const s = this.snapPoint(p.x, p.y);
      const last = this.draft.pts[this.draft.pts.length - 1];
      if (dist(s.x, s.y, last.x, last.y) < 2 / this.view.scale) { this.finishRoad(); return; }
      this.draft.pts.push({ x: s.x, y: s.y });
      return;
    }
    const s = this.snapPoint(p.x, p.y);
    this.draft = { kind: 'roadStart', pts: [{ x: s.x, y: s.y }] };
  }
  move_road() {
    const p = this.pointer, d = this.draft;
    const s = this.snapPoint(p.x, p.y);
    this.hover = s.snapped ? { snap: s } : null;
    if (!d) return;
    if (d.kind === 'roadStart' && p.down && p.moved) { d.kind = 'roadFree'; d.hint = 'Release to finish the road.'; this.updateHint(); }
    if (d.kind === 'roadFree') { const last = d.pts[d.pts.length - 1]; if (dist(p.x, p.y, last.x, last.y) > 1.5 / this.view.scale) d.pts.push({ x: p.x, y: p.y }); }
    if (d.kind === 'roadPts' || d.kind === 'roadStart') d.cursor = s;
  }
  up_road() {
    const d = this.draft, p = this.pointer;
    if (!d) return;
    if (d.kind === 'roadFree') {
      const s = this.snapPoint(p.x, p.y);
      d.pts.push({ x: s.x, y: s.y });
      this.commitRoad(d.pts, true);
      this.draft = null; this.updateHint();
    } else if (d.kind === 'roadStart') { d.kind = 'roadPts'; d.hint = 'Click to add points. Double-click or Enter to finish, Backspace removes the last point.'; this.updateHint(); }
  }
  finishRoad() {
    const d = this.draft;
    if (d?.kind === 'roadPts' && d.pts.length >= 2) this.commitRoad(d.pts, false);
    this.draft = null; this.updateHint(); this.dirty = true;
  }
  commitRoad(pts, freehand) {
    const ts = this.ts.road;
    const tol = freehand ? Math.max(2, 4 / this.view.scale) : 0;
    let points = freehand ? simplify(pts, tol) : pts;
    if (freehand && ts.smooth && points.length > 2) {
      // Keep the end points, smooth interior with a light pass
      const sm = points.map((q, i) => (i === 0 || i === points.length - 1) ? q : { x: (points[i - 1].x + 2 * q.x + points[i + 1].x) / 4, y: (points[i - 1].y + 2 * q.y + points[i + 1].y) / 4 });
      points = sm;
    }
    const created = this.withFeatureHistory('Draw road', () => this.doc.roads.addRoad(points, { type: ts.type, name: ts.name, zoned: ts.zoned && ROAD_TYPES[ts.type].zoned && !ts.tunnel, bstyle: ts.bstyle, bdensity: ts.bdensity, tunnel: ts.tunnel }, { snap: ts.snap ? 12 / this.view.scale + 4 : 0.5 }));
    if (created.length) this.select({ kind: 'road', id: created[0].id });
    this.renderMapPanel();
  }

  // ---------- Tools: grid ----------
  gridAngleSnap(u, shift) {
    if (!shift && !this.ts.grid.snapAngle) return u;
    const a = Math.round(Math.atan2(u.y, u.x) / (Math.PI / 12)) * (Math.PI / 12);
    return { x: Math.cos(a), y: Math.sin(a) };
  }
  down_grid(e) {
    const p = this.pointer;
    if (this.draft?.kind === 'gridDepth') { this.commitGrid(); return; }
    const near = this.doc.roads.nearest(p.x, p.y, 14 / this.view.scale);
    const O = near ? { x: near.x, y: near.y } : { x: p.x, y: p.y };
    // If started on a road, prefer its direction for the first edge
    let axis = null;
    if (near && near.kind === 'edge') { const ed = this.doc.roads.edges.get(near.id); const pts = this.doc.roads.edgePoints(ed); const a = pts[near.seg], b = pts[near.seg + 1]; const L = dist(a.x, a.y, b.x, b.y) || 1; axis = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }; }
    this.draft = { kind: 'gridEdge', O, axis, hint: 'Drag along the first street, then release.' };
    this.updateHint();
    void e;
  }
  gridGeometry(shift) {
    const d = this.draft, p = this.pointer, ts = this.ts.grid;
    if (!d) return null;
    let u, L;
    if (d.kind === 'gridEdge') {
      const dx = p.x - d.O.x, dy = p.y - d.O.y; L = Math.hypot(dx, dy);
      if (L < 1) return null;
      u = { x: dx / L, y: dy / L };
      if (d.axis) { const dot = u.x * d.axis.x + u.y * d.axis.y; if (Math.abs(dot) > 0.9) u = dot > 0 ? d.axis : { x: -d.axis.x, y: -d.axis.y }; }
      u = this.gridAngleSnap(u, shift);
      L = Math.max(ts.blockW, Math.round(L / ts.blockW) * ts.blockW);
      return { O: d.O, u, v: { x: -u.y, y: u.x }, L, D: ts.blockD };
    }
    u = d.u; L = d.L;
    const v0 = { x: -u.y, y: u.x };
    const depth = (p.x - d.O.x) * v0.x + (p.y - d.O.y) * v0.y;
    const v = depth >= 0 ? v0 : { x: -v0.x, y: -v0.y };
    const D = Math.max(ts.blockD, Math.round(Math.abs(depth) / ts.blockD) * ts.blockD);
    return { O: d.O, u, v, L, D };
  }
  gridPreviewLines(shift) {
    const g = this.gridGeometry(shift); if (!g) return null;
    const ts = this.ts.grid, T = this.doc.terrain;
    const blocked = (x, y) => (ts.avoidWater && (T.isWater(x, y) || this.doc.roads.inChannel(x, y))) || (ts.avoidParks && [MAT.PARK, MAT.FOREST].includes(T.materialAt(x, y)));
    return { g, lines: gridLines(g.O, g.u, g.v, g.L, g.D, ts.blockW, ts.blockD, blocked) };
  }
  move_grid(e) { if (this.draft) this.draft.shift = e.shiftKey; }
  up_grid(e) {
    const d = this.draft;
    if (d?.kind === 'gridEdge') {
      const g = this.gridGeometry(e.shiftKey);
      if (!g || !this.pointer.moved) { this.draft = null; this.updateHint(); return; }
      this.draft = { kind: 'gridDepth', O: g.O, u: g.u, L: g.L, hint: 'Move to set the depth, then click (or press Enter). Esc cancels.' };
      this.updateHint();
    }
  }
  commitGrid() {
    const pv = this.gridPreviewLines(this.draft?.shift);
    this.draft = null; this.updateHint();
    if (!pv || !pv.lines.length) { this.toast('No blocks fit here (water or parks in the way).'); return; }
    const ts = this.ts.grid;
    this.withFeatureHistory('Create blocks', () => { for (const ln of pv.lines) this.doc.roads.addRoad(ln, { type: ts.type, zoned: ts.zoned, bstyle: ts.bstyle, bdensity: ts.bdensity }, { snap: Math.min(12, ts.blockW * 0.3) }); });
    this.renderMapPanel();
    this.toast(`Added ${pv.lines.length} streets`);
  }

  // ---------- Tools: paint / terrain / eraser ----------
  strokeAlong(from, to, spacing, fn) {
    const L = dist(from.x, from.y, to.x, to.y);
    const n = Math.max(1, Math.ceil(L / spacing));
    for (let i = 1; i <= n; i++) fn(from.x + (to.x - from.x) * i / n, from.y + (to.y - from.y) * i / n);
  }
  down_paint() {
    const ts = this.ts.paint, p = this.pointer;
    this.beginTerrainStroke('Paint');
    this.draft = { kind: 'stroke', last: { x: p.x, y: p.y } };
    this.paintAt(p.x, p.y);
    this.invalidateTerrain(true);
  }
  /** Apply the paint brush at a point. Land also lifts ground below sea level so it removes any water. */
  paintAt(x, y) {
    const ts = this.ts.paint, T = this.doc.terrain;
    this.touchTiles(x, y, ts.radius);
    T.applyMaterial(x, y, ts.radius, ts.material);
    // Drain fully inside the brush and feather the new shore out to 1.6× the radius for a gentle slope
    if (ts.material === MAT.LAND) T.applyHeight(x, y, ts.radius * 1.6, 1 / 1.6, Math.max(6, ts.radius * 0.12), 'raiseTo', T.seaLevel + 0.5);
  }
  move_paint() {
    const ts = this.ts.paint, p = this.pointer, d = this.draft;
    if (!p.down || d?.kind !== 'stroke') return;
    this.strokeAlong(d.last, p, Math.max(2, ts.radius * 0.3), (x, y) => this.paintAt(x, y));
    d.last = { x: p.x, y: p.y };
    this.invalidateTerrain(true);
  }
  up_paint() { this.draft = null; this.endTerrainStroke(); this.invalidateTerrain(); }

  down_terrain(e) {
    const ts = this.ts.terrain, p = this.pointer;
    this.beginTerrainStroke('Sculpt');
    this.draft = { kind: 'sculpt', target: this.doc.terrain.heightAt(p.x, p.y), alt: e.altKey, lastT: performance.now() };
    void ts;
  }
  move_terrain(e) { if (this.draft?.kind === 'sculpt') this.draft.alt = e.altKey; }
  up_terrain() { this.draft = null; this.endTerrainStroke(); this.invalidateTerrain(); }
  tickTerrain(dt) {
    const d = this.draft, ts = this.ts.terrain, p = this.pointer;
    if (d?.kind !== 'sculpt' || !p.down) return;
    let mode = ts.mode;
    if (d.alt) mode = mode === 'raise' ? 'lower' : mode === 'lower' ? 'raise' : mode;
    const amount = ts.strength * Math.min(dt, 0.05);
    this.touchTiles(p.x, p.y, ts.radius);
    this.doc.terrain.applyHeight(p.x, p.y, ts.radius, ts.hardness, amount, mode, d.target);
    this.invalidateTerrain(true);
  }

  down_eraser() {
    const p = this.pointer;
    this.draft = { kind: 'erase', before: this.featureSnapshot(), changed: false, last: { x: p.x, y: p.y } };
    this.eraseAt(p.x, p.y);
  }
  move_eraser() {
    const p = this.pointer, d = this.draft;
    if (!p.down || d?.kind !== 'erase') return;
    this.strokeAlong(d.last, p, Math.max(2, this.ts.eraser.radius * 0.4), (x, y) => this.eraseAt(x, y));
    d.last = { x: p.x, y: p.y };
  }
  eraseAt(x, y) {
    const ts = this.ts.eraser, d = this.draft, r = ts.radius;
    if (ts.roads && this.doc.roads.eraseCircle(x, y, r)) d.changed = true;
    if (ts.places) { const n = this.doc.places.length; this.doc.places = this.doc.places.filter((p) => dist2(p.x, p.y, x, y) > r * r); if (this.doc.places.length !== n) d.changed = true; }
    if (ts.labels) { const n = this.doc.labels.length; this.doc.labels = this.doc.labels.filter((p) => dist2(p.x, p.y, x, y) > r * r); if (this.doc.labels.length !== n) d.changed = true; }
    if (ts.buildings) { const n = this.doc.buildings.length; this.doc.buildings = this.doc.buildings.filter((b) => !b.pts.some((q) => dist2(q.x, q.y, x, y) <= r * r) && !pointInPolygon(x, y, b.pts)); if (this.doc.buildings.length !== n) d.changed = true; }
    if (d.changed) { this.invalidateBuildings(); this.dirty = true; }
  }
  up_eraser() {
    const d = this.draft; this.draft = null;
    if (!d?.changed) return;
    const after = this.featureSnapshot();
    this.history.push({ label: 'Erase', undo: () => this.restoreFeatures(d.before), redo: () => this.restoreFeatures(after) });
    this.selection = null; this.renderSelectionPanel(); this.markChanged(); this.renderMapPanel();
  }

  // ---------- Tools: place / label ----------
  up_place() {
    if (this.pointer.moved) return;
    const ts = this.ts.place, p = this.pointer;
    const f = { id: uid('p'), x: p.x, y: p.y, name: ts.name || '', category: ts.category };
    this.withFeatureHistory('Add place', () => this.doc.places.push(f));
    this.select({ kind: 'place', id: f.id, fresh: true });
    this.renderMapPanel();
  }
  up_label() {
    if (this.pointer.moved) return;
    const ts = this.ts.label, p = this.pointer;
    const k = LABEL_KINDS[ts.kind] || LABEL_KINDS.district;
    const f = { id: uid('l'), x: p.x, y: p.y, text: ts.text || k.label, kind: ts.kind, size: k.size, angle: 0 };
    this.withFeatureHistory('Add label', () => this.doc.labels.push(f));
    this.select({ kind: 'label', id: f.id, fresh: true });
    this.renderMapPanel();
  }

  // ---------- Buildings ----------
  invalidateBuildings() { this.buildingsKey = ''; }
  updateBuildings() {
    const s = this.doc.settings;
    if (!s.autoBuildings) { this.buildings = this.doc.frozenBuildings || []; return; }
    const key = `${this.doc.roads.version}|${this.doc.terrain.version}|${s.buildingStyle}|${s.buildingDensity}|${JSON.stringify(this.doc.buildings.map((b) => b.pts))}`;
    if (key === this.buildingsKey) return;
    // Defer while the pointer is held during terrain strokes to keep sculpting smooth
    if (this.pointer.down && (this.tool === 'terrain' || this.tool === 'paint')) return;
    const raObstacles = this.doc.roads.roundabouts().map((ra) => ({ pts: this.circlePts(ra.node.x, ra.node.y, ra.r + ra.width / 2 + 2) }));
    this.buildings = generateBuildings(this.doc.roads, this.doc.terrain, s, raObstacles.length ? [...this.doc.buildings, ...raObstacles] : this.doc.buildings);
    this.buildingsKey = key;
    this.dirty = true;
  }

  // ---------- Rendering ----------
  removeHiddenRoads() {
    const ids = this.doc.roads.hiddenRoads();
    if (!ids.length) { this.toast('No hidden roads found'); return; }
    this.withFeatureHistory('Remove hidden roads', () => { for (const id of ids) this.doc.roads.removeEdge(id, false); for (const n of [...this.doc.roads.nodes.keys()]) if (this.doc.roads.nodes.has(n)) this.doc.roads.healNode(n); });
    this.select(null); this.renderMapPanel();
    this.toast(`Removed ${ids.length} hidden road${ids.length > 1 ? 's' : ''}`);
  }
  /** Signature of water channels so the terrain layer re-renders when they change. */
  channelKey() {
    let k = '';
    for (const e of this.doc.roads.edges.values()) if (ROAD_TYPES[e.type]?.water) { k += e.id + ':' + this.doc.roads.width(e) + ':' + this.doc.roads.edgePoints(e).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(';') + '|'; }
    return k;
  }
  invalidateTerrain(interactive = false) { if (this.terrainCache) this.terrainCache.stale = true; this.terrainInteractive = interactive; this.dirty = true; }
  ensureTerrainCache() {
    const v = this.view, T = this.doc.terrain, s = this.doc.settings;
    const settingsKey = `${s.style}|${s.showContours}|${s.contourInterval}|${s.contourLabels}|${s.showHillshade}|${s.exaggeration}|${s.showTrees}|${T.seaLevel}|${this.channelKey()}`;
    const c = this.terrainCache;
    const margin = 0.35;
    const cw = Math.ceil(v.w * (1 + 2 * margin)), ch = Math.ceil(v.h * (1 + 2 * margin));
    const need = !c || c.stale || c.scale !== v.scale || (c.rot || 0) !== (v.rot || 0) || c.version !== T.version || c.settingsKey !== settingsKey || c.dpr !== this.dpr
      || Math.hypot(v.cx - c.cx, v.cy - c.cy) * v.scale > Math.min(v.w, v.h) * margin * 0.9 || c.cw !== cw || c.ch !== ch
      || (c.interactive && !this.pointer.down);
    if (!need) return c;
    const canvas = c?.canvas || document.createElement('canvas');
    canvas.width = Math.round(cw * this.dpr); canvas.height = Math.round(ch * this.dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const cview = { cx: v.cx, cy: v.cy, scale: v.scale, w: cw, h: ch, rot: v.rot || 0 };
    const painter = new CanvasPainter(ctx, cview);
    const region = viewBounds(cview);
    const interactive = this.pointer.down && (this.tool === 'terrain' || this.tool === 'paint');
    renderTerrain(painter, this.doc, region, v.scale, { canvasFactory: (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; }, maxSamples: interactive ? 300 : 520 });
    this.terrainCache = { canvas, cx: v.cx, cy: v.cy, scale: v.scale, rot: v.rot || 0, cw, ch, version: T.version, settingsKey, dpr: this.dpr, stale: false, interactive };
    return this.terrainCache;
  }

  frame(t) {
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000); this.lastFrame = t;
    if (this.draft?.kind === 'sculpt') this.tickTerrain(dt);
    this.updateBuildings();
    if (this.dirty) {
      this.dirty = false;
      try { this.draw(); } catch (err) { console.error(err); if (!this._drawErrorShown) { this._drawErrorShown = true; this.toast('Rendering error: ' + err.message); } }
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }

  draw() {
    const ctx = this.ctx, v = this.view, S = STYLES[this.doc.settings.style] || STYLES.atlas;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = S.land; ctx.fillRect(0, 0, v.w, v.h);
    const c = this.ensureTerrainCache();
    const corner = screenToWorld({ cx: c.cx, cy: c.cy, scale: c.scale, w: c.cw, h: c.ch, rot: c.rot }, 0, 0);
    const off = worldToScreen(v, corner.x, corner.y);
    ctx.drawImage(c.canvas, off.x, off.y, c.cw, c.ch);
    const painter = new CanvasPainter(ctx, v);
    const bounds = viewBounds(v);
    renderRoads(painter, this.doc, v.scale, bounds);
    renderBuildings(painter, this.doc, this.allBuildings(), v.scale, bounds);
    renderRoadLabels(painter, this.doc, v.scale, bounds);
    renderPlaces(painter, this.doc, v.scale, bounds);
    renderLabels(painter, this.doc, v.scale, bounds);
    this.drawOverlay(painter, S);
    this.updateHud();
  }
  drawOverlay(painter, S) {
    const ctx = this.ctx, v = this.view, p = this.pointer, d = this.draft, g = this.doc.roads;
    if (this.doc.settings.showCompass) { const c = screenToWorld(v, v.w - 44, 118); renderCompass(painter, c.x, c.y, 22, v.scale, this.doc.settings.northBearing, S); }
    const sel = this.selection;
    const acc = S.selection;
    // selection
    if (sel?.kind === 'road') {
      const e = g.edges.get(sel.id);
      if (e) {
        const chain = prefs.get('wholeStreet', true) ? g.streetChain(e.id) : [e.id];
        if (chain.length > 1) painter.strokePolys(chain.filter((id) => id !== e.id).map((id) => roadGeometry(g, g.edges.get(id))), { color: acc, width: g.width(e) + 6 / v.scale, minPx: 6, alpha: 0.16 });
        painter.strokePolys([roadGeometry(g, e)], { color: acc, width: g.width(e) + 6 / v.scale, minPx: 6, alpha: 0.35 });
        for (const h of this.roadHandles(e)) { const active = sel.handle && ((h.kind === 'node' && sel.handle.id === h.id) || (h.kind === 'pt' && sel.handle.kind === 'pt' && sel.handle.index === h.index)); painter.circle(h.x, h.y, active ? 6 : 4.5, { fill: active ? acc : '#fff', stroke: acc, px: 2 }); }
      }
    } else if (sel?.kind === 'place') { const f = this.doc.places.find((x) => x.id === sel.id); if (f) painter.circle(f.x, f.y, 14, { stroke: acc, px: 2 }); }
    else if (sel?.kind === 'label') { const f = this.doc.labels.find((x) => x.id === sel.id); if (f) painter.circle(f.x, f.y, 6, { stroke: acc, px: 2 }); }
    else if (sel?.kind === 'building') {
      const b = this.doc.buildings.find((x) => x.id === sel.id);
      if (b) {
        painter.strokePolys([b.pts], { color: acc, width: 0, px: 2, closed: true, alpha: 0.9 });
        if (b.shape === 'circle') { painter.circle(b.cx, b.cy, 3, { fill: acc }); painter.circle(b.cx + b.r, b.cy, sel.handle?.kind === 'radius' ? 6 : 4.5, { fill: sel.handle?.kind === 'radius' ? acc : '#fff', stroke: acc, px: 2 }); }
        else b.pts.forEach((q, i) => { const active = sel.handle?.kind === 'corner' && sel.handle.index === i; painter.circle(q.x, q.y, active ? 6 : 4.5, { fill: active ? acc : '#fff', stroke: acc, px: 2 }); });
      }
    }
    if (this.tool === 'roundabout' && this.hover?.junction) {
      const n = this.hover.junction, r = n.ra || this.ts.roundabout.radius;
      painter.circle(n.x, n.y, r * v.scale, { stroke: acc, px: 2 });
      painter.circle(n.x, n.y, 4, { fill: acc });
    }
    if (this.tool === 'building' && d) {
      let pts = null;
      if (d.kind === 'bRect' && p.down) pts = this.rectCorners(d);
      if (d.kind === 'bCircle' && p.down) { const r = dist(p.x, p.y, d.cx, d.cy); if (r >= 2) pts = this.circlePts(d.cx, d.cy, r); }
      if (d.kind === 'bPoly') pts = d.cursor ? [...d.pts, d.cursor] : d.pts;
      if (pts && pts.length >= 2) {
        painter.fillPolys([pts], acc, { alpha: 0.18 });
        painter.strokePolys([pts], { color: acc, width: 0, px: 1.5, closed: pts.length >= 3, dash: d.kind === 'bPoly' ? [4, 3] : null });
        if (d.kind === 'bPoly') for (const q of d.pts) painter.circle(q.x, q.y, 3.5, { fill: '#fff', stroke: acc, px: 1.5 });
      }
    }
    if (d?.kind === 'dragHandle' && d.snapTarget) painter.circle(d.snapTarget.x, d.snapTarget.y, 9, { stroke: acc, px: 2.5 });
    // hover
    if (this.tool === 'select' && this.hover && !p.down && (!sel || sel.id !== this.hover.id)) {
      if (this.hover.kind === 'road') { const e = g.edges.get(this.hover.id); if (e) painter.strokePolys([roadGeometry(g, e)], { color: acc, width: g.width(e) + 4 / v.scale, minPx: 4, alpha: 0.18 }); }
      if (this.hover.kind === 'building') { const b = this.doc.buildings.find((x) => x.id === this.hover.id); if (b) painter.fillPolys([b.pts], acc, { alpha: 0.15 }); }
    }
    // brushes
    if (['paint', 'terrain', 'eraser'].includes(this.tool)) {
      const ts = this.ts[this.tool];
      const r = ts.radius * v.scale;
      const s = worldToScreen(v, p.x, p.y);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = this.tool === 'eraser' ? '#d9534f' : acc; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke();
      ctx.fillStyle = this.tool === 'eraser' ? 'rgba(217,83,79,0.08)' : 'rgba(31,122,224,0.08)'; ctx.fill();
      if (this.tool === 'terrain' && ts.hardness < 1) { ctx.beginPath(); ctx.arc(s.x, s.y, r * ts.hardness, 0, Math.PI * 2); ctx.setLineDash([4, 4]); ctx.strokeStyle = acc; ctx.globalAlpha = 0.6; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
    }
    // road draft
    if (this.tool === 'road') {
      const ts = this.ts.road;
      const w = ROAD_TYPES[ts.type].width;
      if (d && (d.kind === 'roadPts' || d.kind === 'roadFree' || d.kind === 'roadStart')) {
        const pts = d.pts.slice();
        if (d.kind === 'roadPts' && d.cursor) pts.push({ x: d.cursor.x, y: d.cursor.y });
        painter.strokePolys([pts], { color: acc, width: w, minPx: 3, alpha: 0.45 });
        painter.strokePolys([pts], { color: '#fff', width: 0, px: 1.5, dash: [4, 4], alpha: 0.9 });
        for (const q of d.pts) painter.circle(q.x, q.y, 3.5, { fill: '#fff', stroke: acc, px: 1.5 });
      }
      if (this.hover?.snap) painter.circle(this.hover.snap.x, this.hover.snap.y, 7, { stroke: acc, px: 2 });
    }
    // grid preview
    if (this.tool === 'grid' && d && (d.kind === 'gridEdge' || d.kind === 'gridDepth')) {
      const pv = this.gridPreviewLines(d.shift);
      if (pv) {
        const { g: gg, lines } = pv;
        const rect = [gg.O, { x: gg.O.x + gg.u.x * gg.L, y: gg.O.y + gg.u.y * gg.L }, { x: gg.O.x + gg.u.x * gg.L + gg.v.x * gg.D, y: gg.O.y + gg.u.y * gg.L + gg.v.y * gg.D }, { x: gg.O.x + gg.v.x * gg.D, y: gg.O.y + gg.v.y * gg.D }];
        painter.fillPolys([rect], acc, { alpha: 0.06 });
        painter.strokePolys([rect], { color: acc, width: 0, px: 1, dash: [6, 4], closed: true, alpha: 0.7 });
        painter.strokePolys(lines, { color: acc, width: ROAD_TYPES[this.ts.grid.type].width, minPx: 2, alpha: 0.5 });
        painter.strokePolys(lines, { color: '#fff', width: 0, px: 1, alpha: 0.8 });
        const nBlocks = Math.round(gg.L / this.ts.grid.blockW) + ' × ' + Math.round(gg.D / this.ts.grid.blockD);
        painter.text(nBlocks + ' blocks', gg.O.x + (gg.u.x * gg.L + gg.v.x * gg.D) / 2, gg.O.y + (gg.u.y * gg.L + gg.v.y * gg.D) / 2, { size: 12, color: acc, halo: '#fff', weight: 600 });
      }
    }
  }
  updateHud() {
    const v = this.view;
    $('zoomLabel').textContent = Math.round(v.scale * 100) + '%';
    const target = 120 / v.scale;
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].find((n) => n >= target) || 20000;
    $('scaleBar').style.width = nice * v.scale + 'px';
    $('scaleText').textContent = nice >= 1000 ? nice / 1000 + ' km' : nice + ' m';
    $('statusInfo').textContent = `${this.doc.roads.edges.size} roads · ${this.buildings.length} buildings · zoom ${v.scale.toFixed(2)} px/m`;
    const stats = { stRoads: this.doc.roads.edges.size, stBuildings: this.buildings.length + this.doc.buildings.length, stPlaces: this.doc.places.length, stLabels: this.doc.labels.length, stTiles: this.doc.terrain.tiles.size };
    for (const [id, val] of Object.entries(stats)) { const el = $(id); if (el && el.textContent !== String(val)) el.textContent = val; }
  }

  // ---------- Files and export ----------
  saveFile() {
    this.doc.view = { cx: this.view.cx, cy: this.view.cy, scale: this.view.scale, rot: this.view.rot || 0 };
    const json = JSON.stringify(serialize(this.doc));
    download(`${slug(this.doc.name)}.atlas.json`, new Blob([json], { type: 'application/json' }));
    this.toast('Project downloaded');
  }
  exportBounds() {
    const b = this.contentBounds() || { minX: -500, minY: -400, maxX: 500, maxY: 400 };
    const pad = Math.max(60, (b.maxX - b.minX) * 0.04);
    return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  }
  exportPng() {
    const b = this.exportBounds();
    const W = b.maxX - b.minX, H = b.maxY - b.minY;
    const maxPx = 3600;
    const scale = Math.min(maxPx / W, maxPx / H, 4);
    const w = Math.round(W * scale), h = Math.round(H * scale);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const view = { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale, w, h };
    const S = STYLES[this.doc.settings.style] || STYLES.atlas;
    ctx.fillStyle = S.land; ctx.fillRect(0, 0, w, h);
    const painter = new CanvasPainter(ctx, view);
    this.updateBuildings();
    renderScene(painter, this.doc, this.allBuildings(), scale, b, { canvasFactory: (cw, ch) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; }, maxSamples: 1400 });
    cv.toBlob((blob) => { download(`${slug(this.doc.name)}.png`, blob); this.toast(`PNG exported (${w} × ${h})`); }, 'image/png');
  }
  freshBuildings() { this.updateBuildings(); return this.allBuildings(); }
  allBuildings() { return this.doc.buildings.length ? [...this.buildings, ...this.doc.buildings] : this.buildings; }
  exportText(text, ext, mime, msg) {
    download(`${slug(this.doc.name)}.${ext}`, new Blob([text], { type: mime }));
    this.toast(`${msg} (${Math.round(text.length / 1024)} KB)`);
  }
  exportSvg() {
    const b = this.exportBounds();
    const W = b.maxX - b.minX, H = b.maxY - b.minY;
    const scale = Math.min(3000 / W, 3000 / H, 4);
    const painter = new SvgPainter(b, scale);
    const S = STYLES[this.doc.settings.style] || STYLES.atlas;
    this.updateBuildings();
    renderScene(painter, this.doc, this.allBuildings(), scale, b, { canvasFactory: (cw, ch) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; }, maxSamples: 1000 });
    download(`${slug(this.doc.name)}.svg`, new Blob([painter.toString(S.land)], { type: 'image/svg+xml' }));
    this.toast('SVG exported');
  }
}

function fmt(v, f) {
  if (f.zeroLabel && !v) return f.zeroLabel;
  if (f.pct) return Math.round(v * 100) + '%';
  return (Number.isInteger(v) ? v : +v.toFixed(2)) + (f.unit || '');
}
const slug = (s) => (s || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';

const app = new App();
window.atlas = app;
app.boot();
