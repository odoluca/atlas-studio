// Map colour themes.
export const STYLES = {
  atlas: {
    label: 'Atlas',
    land: '#f1efe9', park: '#cfe6c3', forest: '#b7d6a6', forestDot: '#8fbb7f', sand: '#f3e7c4', water: '#a9d0ea', waterEdge: '#8ebedf', paved: '#e2e0da', farmland: '#eef0d4', farmLine: '#d9dbb4', roundaboutIsland: '#cfe6c3',
    contour: '#b38b5d', contourIndex: '#9c7246', contourLabel: '#8a6238', contourAlpha: 0.55,
    hillshadeDark: 'rgba(60,45,30,1)', hillshadeLight: 'rgba(255,255,255,1)', hillshadeStrength: 0.35,
    building: '#dad5cb', buildingEdge: '#c7c1b4',
    roads: {
      path:    { fill: '#ffffff', casing: '#cfc9bb', dash: [6, 4] },
      street:  { fill: '#ffffff', casing: '#d2cdc2' },
      avenue:  { fill: '#fdf2c8', casing: '#e0c98a' },
      highway: { fill: '#f8c56a', casing: '#d9a24a' },
      rail:    { fill: '#9a9a9a', casing: '#ffffff', rail: true },
      river:   { fill: '#a9d0ea', casing: '#8ebedf', water: true },
    },
    roadLabel: '#4e4a42', roadLabelHalo: '#ffffff',
    labelColors: { city: '#2a2622', district: '#6c655b', water: '#3f7ca3', park: '#4d7c3d', halo: '#ffffff' },
    place: { pin: '#e8613c', text: '#3a3631', halo: '#ffffff' },
    grid: 'rgba(0,0,0,0.06)', selection: '#1f7ae0', ui: '#1f7ae0',
    compassBg: 'rgba(255,255,255,0.88)', compassRing: '#8a8578', compassNorth: '#d9462f', compassSouth: '#5f5b53', compassText: '#2a2622',
  },
  soft: {
    label: 'Soft',
    land: '#faf6f0', park: '#dcefd0', forest: '#c9e2b8', forestDot: '#a7cc96', sand: '#f8eed3', water: '#c4dff0', waterEdge: '#aacde3', paved: '#ede9e2', farmland: '#f3f3dc', farmLine: '#e1e1c3', roundaboutIsland: '#dcefd0',
    contour: '#c9a07a', contourIndex: '#b18863', contourLabel: '#9a7555', contourAlpha: 0.45,
    hillshadeDark: 'rgba(70,55,40,1)', hillshadeLight: 'rgba(255,255,255,1)', hillshadeStrength: 0.25,
    building: '#eae4d9', buildingEdge: '#d9d2c5',
    roads: {
      path:    { fill: '#ffffff', casing: '#e4ded2', dash: [6, 4] },
      street:  { fill: '#ffffff', casing: '#e2dcd0' },
      avenue:  { fill: '#fff7dd', casing: '#ead9a8' },
      highway: { fill: '#fbd891', casing: '#e4b96a' },
      rail:    { fill: '#b0acaa', casing: '#ffffff', rail: true },
      river:   { fill: '#c4dff0', casing: '#aacde3', water: true },
    },
    roadLabel: '#6a645a', roadLabelHalo: '#ffffff',
    labelColors: { city: '#3a3531', district: '#8a8276', water: '#5b8fb3', park: '#6a9458', halo: '#ffffff' },
    place: { pin: '#f07f5e', text: '#4b463f', halo: '#ffffff' },
    grid: 'rgba(0,0,0,0.05)', selection: '#2f88e6', ui: '#2f88e6',
    compassBg: 'rgba(255,255,255,0.9)', compassRing: '#a39c8c', compassNorth: '#e8674a', compassSouth: '#7a746a', compassText: '#3a3531',
  },
  night: {
    label: 'Night',
    land: '#1d2129', park: '#213229', forest: '#1c2c24', forestDot: '#2c4536', sand: '#2e2b23', water: '#141c2e', waterEdge: '#1d2a44', paved: '#262a33', farmland: '#252a24', farmLine: '#30362d', roundaboutIsland: '#213229',
    contour: '#6f6a5a', contourIndex: '#8a8470', contourLabel: '#a39c86', contourAlpha: 0.6,
    hillshadeDark: 'rgba(0,0,0,1)', hillshadeLight: 'rgba(255,255,255,1)', hillshadeStrength: 0.3,
    building: '#2b303b', buildingEdge: '#394050',
    roads: {
      path:    { fill: '#3a3f4a', casing: '#2a2e38', dash: [6, 4] },
      street:  { fill: '#3d4350', casing: '#2a2e38' },
      avenue:  { fill: '#55503b', casing: '#2a2e38' },
      highway: { fill: '#8a6b2a', casing: '#2a2e38' },
      rail:    { fill: '#6c6c74', casing: '#1d2129', rail: true },
      river:   { fill: '#141c2e', casing: '#1d2a44', water: true },
    },
    roadLabel: '#c7c3b8', roadLabelHalo: '#1d2129',
    labelColors: { city: '#f1ede4', district: '#a9a39a', water: '#7fa6cc', park: '#86b47a', halo: '#1d2129' },
    place: { pin: '#ff8a5c', text: '#e6e1d8', halo: '#1d2129' },
    grid: 'rgba(255,255,255,0.06)', selection: '#5aa9ff', ui: '#5aa9ff',
    compassBg: 'rgba(29,33,41,0.85)', compassRing: '#7d7a70', compassNorth: '#ff7a5c', compassSouth: '#b9b4a8', compassText: '#f1ede4',
  },
};

export const PLACE_CATEGORIES = {
  // Food & drink
  cafe:        { label: 'Café',            glyph: '☕', color: '#b5651d', group: 'Food & drink' },
  restaurant:  { label: 'Restaurant',      glyph: '🍴', color: '#d2553d', group: 'Food & drink' },
  bar:         { label: 'Bar / pub',       glyph: '🍺', color: '#c0782a', group: 'Food & drink' },
  bakery:      { label: 'Bakery',          glyph: '🥐', color: '#c98a3a', group: 'Food & drink' },
  // Shopping
  shop:        { label: 'Shop',            glyph: '🛍', color: '#8a5fc2', group: 'Shopping' },
  mall:        { label: 'Shopping mall',   glyph: '🏬', color: '#7b4fb5', group: 'Shopping' },
  supermarket: { label: 'Supermarket',     glyph: '🛒', color: '#9a63c9', group: 'Shopping' },
  market:      { label: 'Market',          glyph: '🧺', color: '#a86f3d', group: 'Shopping' },
  // Transport
  station:     { label: 'Train station',   glyph: '🚉', color: '#3b6fd4', group: 'Transport' },
  metro:       { label: 'Metro / subway',  glyph: 'M',  color: '#2c5fc4', group: 'Transport' },
  bus:         { label: 'Bus stop',        glyph: '🚌', color: '#4a7fd6', group: 'Transport' },
  airport:     { label: 'Airport',         glyph: '✈',  color: '#3a6fb0', group: 'Transport' },
  harbor:      { label: 'Harbour / ferry', glyph: '⚓', color: '#2c6e9b', group: 'Transport' },
  parking:     { label: 'Parking',         glyph: 'P',  color: '#4a6fa5', group: 'Transport' },
  fuel:        { label: 'Fuel station',    glyph: '⛽', color: '#5b6b8c', group: 'Transport' },
  // Civic & services
  hospital:    { label: 'Hospital',        glyph: '✚',  color: '#d64545', group: 'Civic & services' },
  pharmacy:    { label: 'Pharmacy',        glyph: '💊', color: '#d95f5f', group: 'Civic & services' },
  police:      { label: 'Police',          glyph: '🛡', color: '#3f5fa8', group: 'Civic & services' },
  fire:        { label: 'Fire station',    glyph: '🔥', color: '#d9462f', group: 'Civic & services' },
  post:        { label: 'Post office',     glyph: '✉',  color: '#c9742a', group: 'Civic & services' },
  townhall:    { label: 'Town hall',       glyph: '🏛', color: '#6b5b95', group: 'Civic & services' },
  library:     { label: 'Library',         glyph: '📚', color: '#7a5c3a', group: 'Civic & services' },
  bank:        { label: 'Bank',            glyph: '$',  color: '#4f6d4a', group: 'Civic & services' },
  // Education
  school:      { label: 'School',          glyph: '🎓', color: '#2f8f6b', group: 'Education' },
  university:  { label: 'University',      glyph: '🎓', color: '#246b8f', group: 'Education' },
  // Culture & leisure
  museum:      { label: 'Museum',          glyph: '🏛', color: '#8c6a3f', group: 'Culture & leisure' },
  theatre:     { label: 'Theatre',         glyph: '🎭', color: '#a84a7a', group: 'Culture & leisure' },
  cinema:      { label: 'Cinema',          glyph: '🎬', color: '#8e4a9a', group: 'Culture & leisure' },
  stadium:     { label: 'Stadium',         glyph: '🏟', color: '#3d8a4a', group: 'Culture & leisure' },
  gym:         { label: 'Sports / gym',    glyph: '⚽', color: '#4a8f5a', group: 'Culture & leisure' },
  park:        { label: 'Park',            glyph: '🌳', color: '#4d9a3a', group: 'Culture & leisure' },
  playground:  { label: 'Playground',      glyph: '🛝', color: '#6aa84f', group: 'Culture & leisure' },
  zoo:         { label: 'Zoo',             glyph: '🦁', color: '#b07a2a', group: 'Culture & leisure' },
  beach:       { label: 'Beach',           glyph: '🏖', color: '#d9a441', group: 'Culture & leisure' },
  // Religion
  church:      { label: 'Church',          glyph: '✝',  color: '#7a6a8a', group: 'Religion' },
  mosque:      { label: 'Mosque',          glyph: '☪',  color: '#5f7a8a', group: 'Religion' },
  temple:      { label: 'Temple',          glyph: '⛩',  color: '#9a5a4a', group: 'Religion' },
  cemetery:    { label: 'Cemetery',        glyph: '⚰',  color: '#6c6f72', group: 'Religion' },
  // Lodging
  hotel:       { label: 'Hotel',           glyph: '🛏', color: '#b0567a', group: 'Lodging' },
  campsite:    { label: 'Campsite',        glyph: '⛺', color: '#5a8a4a', group: 'Lodging' },
  // Industry & work
  industrial:  { label: 'Industrial site', glyph: '🏭', color: '#6e6a7a', group: 'Industry & work' },
  factory:     { label: 'Factory',         glyph: '⚙',  color: '#5f5f6e', group: 'Industry & work' },
  warehouse:   { label: 'Warehouse',       glyph: '📦', color: '#7d6f5a', group: 'Industry & work' },
  port:        { label: 'Port / docks',    glyph: '🚢', color: '#3f6a86', group: 'Industry & work' },
  power:       { label: 'Power plant',     glyph: '⚡', color: '#b58a1a', group: 'Industry & work' },
  farm:        { label: 'Farm',            glyph: '🌾', color: '#8a8a2a', group: 'Industry & work' },
  mine:        { label: 'Mine / quarry',   glyph: '⛏',  color: '#7a5a3a', group: 'Industry & work' },
  construction:{ label: 'Construction',    glyph: '🚧', color: '#d08a1a', group: 'Industry & work' },
  office:      { label: 'Office',          glyph: '🏢', color: '#4f6a8a', group: 'Industry & work' },
  // Landmarks & nature
  landmark:    { label: 'Landmark',        glyph: '★',  color: '#c79a2a', group: 'Landmarks & nature' },
  monument:    { label: 'Monument',        glyph: '🗿', color: '#8a7a5a', group: 'Landmarks & nature' },
  castle:      { label: 'Castle',          glyph: '🏰', color: '#7a6a4a', group: 'Landmarks & nature' },
  lighthouse:  { label: 'Lighthouse',      glyph: '🗼', color: '#c75a3a', group: 'Landmarks & nature' },
  viewpoint:   { label: 'Viewpoint',       glyph: '👁', color: '#5a7a8a', group: 'Landmarks & nature' },
  peak:        { label: 'Peak',            glyph: '▲',  color: '#7a5b3a', group: 'Landmarks & nature' },
  cave:        { label: 'Cave',            glyph: '◖',  color: '#5a4a3a', group: 'Landmarks & nature' },
  waterfall:   { label: 'Waterfall',       glyph: '≋',  color: '#3a7a9a', group: 'Landmarks & nature' },
};

/** Options for a grouped category <select>: [value, text, group]. */
export const PLACE_OPTIONS = Object.entries(PLACE_CATEGORIES).map(([k, v]) => [k, v.label, v.group]);

export const LABEL_KINDS = {
  city: { label: 'City', size: 22, weight: 700, upper: true, spacing: 2 },
  district: { label: 'District', size: 14, weight: 600, upper: true, spacing: 3 },
  water: { label: 'Water', size: 14, weight: 500, italic: true, upper: false, spacing: 1 },
  park: { label: 'Park', size: 12, weight: 500, italic: true, upper: false, spacing: 0.5 },
};
