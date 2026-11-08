# Atlas Studio 2

A fictional map designer that runs entirely in the browser: no build step, no dependencies, no backend. Sculpt terrain with contour lines and hill shading, paint parks, forests, sand and water with smooth edges, draw roads that snap and join, lay out Cities-Skylines-style street grids that stop at the water, and let buildings fill in along the streets automatically.

## Run locally

```
python scripts/serve.py 8080
```

Then open http://127.0.0.1:8080. The app uses ES modules, so it needs to be served over HTTP (opening `index.html` directly from disk will not work in most browsers). Any static file server works; the bundled one just disables caching so edits show up on reload.

## Deploy to static hosting (InfinityFree or similar)

1. Run `python scripts/package.py` to build `atlas-studio-site.zip`.
2. Upload the contents of the archive into your `htdocs` folder (or a subfolder). Keep the `src/` and `assets/` folders next to `index.html`.
3. Visit the URL. There is nothing to configure.

## Tools

| Tool | Key | What it does |
|---|---|---|
| Select | V | Click a road, place or label to edit it in the Selection panel. Selecting a road highlights the whole street through its junctions; name, type, width, buildings and delete apply to the whole street unless you untick "Apply to the whole street". Drag places and labels to move them. Drag the circular handles of a road to reshape it; double-click a road to insert a point; Delete removes a selected handle or the whole feature. Ctrl+D duplicates a place or label. |
| Pan | H | Drag to pan, scroll to zoom. Hold Space with any tool to pan. F fits the map. |
| Road | R | Click, click, click to place points and press Enter or double-click to finish. Or press and drag to draw freehand (simplified and smoothed). Ends snap to nearby roads and junctions; crossing another road creates a junction. Tick **Tunnel** to draw a road underground (dashed casing, faded fill, no buildings along it, and buildings may sit on top). To tunnel only part of a road, double-click it to add a point, click that handle and use **Split road here** at each portal, then tick Tunnel on the middle piece. A road that continues another road of the same type in a straight line is fused with it automatically, and leftover joints are fused after erasing or deleting. Right-click or Backspace removes the last draft point. |
| Blocks | G | Drag along the first street to set the grid's direction and length, release, move the mouse to set the depth, then click. Blocks that touch water (or parks, optional) are skipped. Starting on an existing road aligns the grid with it; Shift locks the angle to 15° steps. Block width and depth are settings. |
| Paint | B | Paint park, forest, sand, water or paved ground. Edges are fitted with smooth curves instead of grid steps. Paint Land to erase. `[` and `]` change the brush size. |
| Terrain | T | Raise, lower, smooth or flatten the heightfield while holding the mouse. Alt inverts raise/lower. Hardness controls the brush falloff. Land below sea level becomes water, so lowering makes lakes and bays. |
| Place | P | Click to add a point of interest with an icon and name. 57 categories grouped like the big map apps: food and drink, shopping, transport, civic services, education, culture and leisure, religion, lodging, industry and work (industrial site, factory, warehouse, port, power plant, farm, mine, construction, office), and landmarks and nature. |
| Label | L | Click to add a city, district, water or park label. Size and angle are editable. |
| Building | N | Hand-drawn buildings. Rectangle mode: press and drag, aligned to the nearest road within 150 m. Polygon mode: click each corner and click the first corner, double-click or press Enter to close. Set levels and an optional name. In Select, drag to move, drag corner handles to reshape, double-click an edge to add a corner, Delete removes a selected corner or the building, Ctrl+D duplicates. Automatic buildings keep clear of hand-drawn ones, and all exports include them. |
| Eraser | E | Drag to erase roads (they are cut and split cleanly), places, labels and hand-drawn buildings. |

## Map panel

- **Style:** Atlas, Soft or Night.
- **View:** a Rotate map slider turns the view (place names and labels stay upright; road and contour labels follow their lines). "North up" aligns the view with the north bearing; "Reset" returns to the drawing's orientation. Exports are never rotated.
- **Terrain:** sea level, contour lines with interval and elevation labels, hill shading strength, forest trees.
- **Buildings:** automatic buildings line every road marked "Generate buildings", facing the street, set back from other roads, never on water, parks or forest, never overlapping. Choose a map-wide style (terraced rows, detached houses, mixed, dense downtown) and density. Any road or whole street can override both in the Selection panel, and the Road and Blocks tools can set them for new roads up front. Turning automatic buildings off freezes the current set so you can keep editing without changes.

## Saving and exporting

- The map autosaves to this browser (IndexedDB) after each change.
- **Save** downloads an editable `.atlas.json` project; **Open…** loads one.
- The **Export** menu offers:
  - **Project file (.atlas.json)** – the same as Save: the editor's own format with everything editable.
  - **PNG** – the whole map as an image, up to 3600 px on the long side.
  - **SVG** – vector drawing for Inkscape or Illustrator, hill shading embedded as an image.
  - **GeoJSON** – roads, buildings, painted areas (with holes), contour lines, places and labels for QGIS, Mapbox/MapLibre, Leaflet, Felt and similar. Properties carry both a `layer`/`kind` and OpenStreetMap-style tags.
  - **OSM XML** – the same content as OpenStreetMap data (`highway=residential`, `building=yes`, `natural=water`, `amenity=cafe`, `contour=elevation` …) for JOSM, Maperitive, Mapnik and tile servers. Junctions share nodes, areas with holes become multipolygon relations.
  - **Terrain grid (.asc)** – the heightfield as an ESRI ASCII grid (4 m cells) that QGIS opens directly for its own hillshade and contours.
- **Georeference** (Map panel): the map point (0, 0) is placed at the chosen origin latitude and longitude, and the north bearing rotates the map (0° = up is north). A compass rose shows the bearing on screen and in PNG/SVG exports; it can be hidden.
- Ctrl+Z / Ctrl+Y undo and redo everything, including terrain strokes.

## Project layout

- `index.html`, `styles.css` – shell and layout.
- `src/geom.js` – geometry helpers, hashing, spatial hash.
- `src/terrain.js` – tiled infinite heightfield and material field, brushes, marching squares, mask outlining, hillshade.
- `src/roads.js` – road graph with snapping, splitting, crossings, circle erasing, and block-grid generation.
- `src/buildings.js` – building generation along zoned roads.
- `src/render.js` – scene rendering with Canvas and SVG painters.
- `src/styles.js` – themes, place categories, label kinds.
- `src/state.js` – document model, serialization, undo history.
- `src/storage.js` – IndexedDB autosave, downloads, preferences.
- `src/sample.js` – the procedurally built example map.
- `src/main.js` – the editor: view, tools, panels, export.

## Development

`npm test` runs the Node unit tests (`tests/*.test.mjs`, Node 18+). `npm run check` syntax-checks the sources. No `npm install` is required.

The previous version of the app is kept in `_old/` for reference.
