import {
  existingRouteLatLng,
  proposedRouteLatLng,
  existingStopsLatLng,
  proposedStopsLatLng,
  landmarks
} from './route-data.js';
import {
  compareRoutes,
  compareStops,
  haversineMeters,
  lineLengthMeters,
  ROUTE_MATCH_THRESHOLD_METERS,
  STOP_MATCH_THRESHOLD_METERS
} from './comparison.js';
import {
  createRoadLabelCacheController,
  ROAD_LABEL_CORRIDOR_METERS
} from './road-labels.js';
import {
  buildPresentationCameraOptions,
  buildStoryLayoutPadding,
  VIEW_MODES
} from './presentation.js';
import { buildPresentationMetrics } from './presentation-metrics.js';
import { findStoryContentBlock, renderPresentationContent } from './presentation-renderer.js';
import { loadStoryDefinition } from './story-schema.js';
import { createStoryActionRunner } from './story-action-runner.js';
import { createStoryRuntime } from './story-runtime.js';
import { createStoryShell, resolveStoryExperience } from './story-shell.js';
import { createGuidedMapInteractionPolicy } from './story-map-interactions.js';
import {
  createRouteRevealController,
  createRoute612StoryActionHandlers,
  ROUTE_612_STORY_ACTION_CONTRACTS
} from './route-61-2-story-actions.js';
import { createUrbanContextController } from './urban-context.js';
import { prepareBasemapStyle, stripOpenFreeMapDarkStyle } from './basemap-style.js';
import { OVERTURE_BUILDINGS_DATA_URL } from './overture-buildings.js';
import { shouldUpdateAnimationFrame } from './animation-timing.js';
import { createStopPulseTracker } from './stop-pulses.js';

const BUS_STOP_TRIGGER_RADIUS_METERS = 55;
const BUS_LOOP_DURATION_MS = 50_000;
const DEFAULT_BUS_SPEED = 0.75;
const PROPOSED_REVEAL_DURATION_MS = 2_200;
const BUS_ANIMATION_INTERVAL_MS = 1_000 / 30;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const compactView = window.innerWidth <= 760;
const storyExperience = resolveStoryExperience(window.location.search);

const toLngLat = (coordinates) => coordinates.map(([lat, lng]) => [lng, lat]);
const existingCoordinates = toLngLat(existingRouteLatLng);
const proposedCoordinates = toLngLat(proposedRouteLatLng);
const existingStops = existingStopsLatLng.map(([lat, lng]) => ({ coordinates: [lng, lat] }));
const proposedStops = proposedStopsLatLng.map(([lat, lng]) => ({ coordinates: [lng, lat] }));

const routeComparison = compareRoutes(existingCoordinates, proposedCoordinates);
const stopComparison = compareStops(existingStops, proposedStops);
const presentationMetrics = buildPresentationMetrics({ routeComparison, stopComparison, landmarks });

const routeData = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { dataset: 'existing', label: 'Tuyến 61-2 hiện hữu' },
      geometry: { type: 'LineString', coordinates: existingCoordinates }
    },
    {
      type: 'Feature',
      properties: { dataset: 'proposed', label: 'Tuyến 61-2 điều chỉnh' },
      geometry: { type: 'LineString', coordinates: proposedCoordinates }
    }
  ]
};

const rawStopsData = {
  type: 'FeatureCollection',
  features: [
    ...existingStops.map((stop, index) => ({
      type: 'Feature',
      properties: { dataset: 'existing', sourceIndex: index },
      geometry: { type: 'Point', coordinates: stop.coordinates }
    })),
    ...proposedStops.map((stop, index) => ({
      type: 'Feature',
      properties: { dataset: 'proposed', sourceIndex: index },
      geometry: { type: 'Point', coordinates: stop.coordinates }
    }))
  ]
};

const pulseStopsData = {
  type: 'FeatureCollection',
  features: proposedStops.map((stop, index) => ({
    type: 'Feature',
    properties: { stopId: index },
    geometry: { type: 'Point', coordinates: stop.coordinates }
  }))
};

const endpointData = {
  type: 'FeatureCollection',
  features: [
    ['existing', 'Hiện hữu · đầu tuyến', existingCoordinates[0]],
    ['existing', 'Hiện hữu · cuối tuyến', existingCoordinates.at(-1)],
    ['proposed', 'Điều chỉnh · đầu tuyến', proposedCoordinates[0]],
    ['proposed', 'Điều chỉnh · cuối tuyến', proposedCoordinates.at(-1)]
  ].map(([dataset, label, coordinates], index) => ({
    type: 'Feature',
    id: `endpoint-${index}`,
    properties: { dataset, label },
    geometry: { type: 'Point', coordinates }
  }))
};

const poiData = {
  type: 'FeatureCollection',
  features: landmarks.map((landmark, index) => ({
    type: 'Feature',
    id: `poi-${index}`,
    properties: {
      name: landmark.name,
      type: landmark.type,
      glyph: landmark.glyph,
      sourceUrl: landmark.sourceUrl
    },
    geometry: { type: 'Point', coordinates: landmark.coordinates }
  }))
};

const uiState = {
  mode: VIEW_MODES.DIFFERENCE,
  showStops: true,
  showPois: true,
  showArrows: true
};
let storyRuntime = null;
let storyShell = null;
let map;
let revealToken = 0;
let mapReady = false;
let appliedRoadLabelCollection = null;
let industrialZoneFeature = null;
let overtureBuildingCollection = null;
let urbanContextController = null;

function computeRoadLabelsInWorker(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./road-label-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.cache);
    }, { once: true });
    worker.addEventListener('error', (event) => {
      worker.terminate();
      reject(event.error ?? new Error(event.message));
    }, { once: true });
    worker.postMessage({ input, options: { corridorMeters: ROAD_LABEL_CORRIDOR_METERS } });
  });
}

const roadLabelCache = createRoadLabelCacheController(computeRoadLabelsInWorker);

const kilometer = (meters) => `${(meters / 1000).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;

function setStatus(message) {
  document.getElementById('map-status').textContent = message;
}

function widthExpression(desktopWidth, phoneWidth = desktopWidth + 2.5) {
  const base = compactView ? phoneWidth : desktopWidth;
  return ['interpolate', ['linear'], ['zoom'], 9, Math.max(2.5, base - 1.5), 13, base, 16, base + 2];
}

function setLayerVisible(layerId, visible) {
  if (map?.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function addArrowImage() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);
  context.fillStyle = '#dff8ff';
  context.beginPath();
  context.moveTo(6, 8);
  context.lineTo(26, 16);
  context.lineTo(6, 24);
  context.lineTo(11, 16);
  context.closePath();
  context.fill();
  map.addImage('route-arrow', context.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

function addMapSources() {
  map.addSource('route-raw', { type: 'geojson', data: routeData, lineMetrics: true });
  map.addSource('route-semantics', { type: 'geojson', data: routeComparison.all, lineMetrics: true });
  map.addSource('stops-comparison', { type: 'geojson', data: stopComparison.all });
  map.addSource('stops-raw', { type: 'geojson', data: rawStopsData });
  map.addSource('route-endpoints', { type: 'geojson', data: endpointData });
  map.addSource('route-pois', { type: 'geojson', data: poiData });
  map.addSource('route-road-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
}

function addRouteLayers() {
  map.addLayer({
    id: 'route-removed', type: 'line', source: 'route-semantics',
    filter: ['==', ['get', 'status'], 'removed'],
    layout: { 'line-cap': 'butt', 'line-join': 'round', visibility: 'visible' },
    paint: {
      'line-color': '#ffad32', 'line-opacity': 1, 'line-width': widthExpression(6, 8.5),
      'line-dasharray': [1.35, 1.05]
    }
  });
  map.addLayer({
    id: 'route-retained', type: 'line', source: 'route-semantics',
    filter: ['==', ['get', 'status'], 'retained'],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: { 'line-color': '#708096', 'line-opacity': .64, 'line-width': widthExpression(5.5, 8) }
  });
  map.addLayer({
    id: 'route-added-halo', type: 'line', source: 'route-semantics',
    filter: ['==', ['get', 'status'], 'added'],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      'line-color': '#2bb7ff', 'line-opacity': .24, 'line-blur': 3,
      'line-width': widthExpression(12, 16)
    }
  });
  map.addLayer({
    id: 'route-added-core', type: 'line', source: 'route-semantics',
    filter: ['==', ['get', 'status'], 'added'],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: { 'line-color': '#2bb7ff', 'line-opacity': 1, 'line-width': widthExpression(6.5, 9) }
  });

  map.addLayer({
    id: 'route-existing', type: 'line', source: 'route-raw',
    filter: ['==', ['get', 'dataset'], 'existing'],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': '#718096', 'line-opacity': .82, 'line-width': widthExpression(6, 8.5),
      'line-offset': 0
    }
  });
  map.addLayer({
    id: 'route-proposed-halo', type: 'line', source: 'route-raw',
    filter: ['==', ['get', 'dataset'], 'proposed'],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': '#2bb7ff', 'line-opacity': .2, 'line-blur': 3,
      'line-width': widthExpression(12, 16), 'line-offset': 0
    }
  });
  map.addLayer({
    id: 'route-proposed', type: 'line', source: 'route-raw',
    filter: ['==', ['get', 'dataset'], 'proposed'],
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: {
      'line-color': '#2bb7ff', 'line-opacity': .98, 'line-width': widthExpression(6.5, 9),
      'line-offset': 0
    }
  });
}

function addStopLayers() {
  map.addLayer({
    id: 'stops-retained', type: 'circle', source: 'stops-comparison',
    filter: ['==', ['get', 'status'], 'retained'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.3, 13, 4, 16, 5.5],
      'circle-color': '#8290a3', 'circle-opacity': .74,
      'circle-stroke-color': '#d4dbe5', 'circle-stroke-width': .8
    }
  });
  map.addLayer({
    id: 'stops-added-halo', type: 'circle', source: 'stops-comparison',
    filter: ['==', ['get', 'status'], 'added'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 5, 13, 9, 16, 13],
      'circle-color': '#22d3ee', 'circle-opacity': .28, 'circle-blur': .65
    }
  });
  map.addLayer({
    id: 'stops-added', type: 'circle', source: 'stops-comparison',
    filter: ['==', ['get', 'status'], 'added'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.2, 13, 5.5, 16, 7],
      'circle-color': '#67e8f9', 'circle-opacity': 1,
      'circle-stroke-color': '#ecfeff', 'circle-stroke-width': 1.8
    }
  });
  map.addLayer({
    id: 'stops-removed', type: 'circle', source: 'stops-comparison',
    filter: ['==', ['get', 'status'], 'removed'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 13, 5, 16, 6.5],
      'circle-color': 'rgba(245, 158, 11, 0)',
      'circle-stroke-color': '#f59e0b', 'circle-stroke-width': 2, 'circle-opacity': .95
    }
  });
  map.addLayer({
    id: 'stops-existing-raw', type: 'circle', source: 'stops-raw',
    filter: ['==', ['get', 'dataset'], 'existing'],
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.4, 13, 4.5, 16, 6],
      'circle-color': '#8a98aa', 'circle-opacity': .82,
      'circle-stroke-color': '#e2e8f0', 'circle-stroke-width': 1
    }
  });
  map.addLayer({
    id: 'stops-proposed-raw', type: 'circle', source: 'stops-raw',
    filter: ['==', ['get', 'dataset'], 'proposed'],
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.8, 13, 5, 16, 6.5],
      'circle-color': '#67e8f9', 'circle-opacity': .92,
      'circle-stroke-color': '#ecfeff', 'circle-stroke-width': 1.2
    }
  });
}

function addDirectionLayers() {
  ['existing', 'proposed'].forEach((dataset) => {
    map.addLayer({
      id: `arrows-${dataset}`,
      type: 'symbol',
      source: 'route-raw',
      filter: ['==', ['get', 'dataset'], dataset],
      layout: {
        visibility: dataset === 'proposed' ? 'visible' : 'none',
        'symbol-placement': 'line',
        'symbol-spacing': compactView ? 110 : 145,
        'icon-image': 'route-arrow',
        'icon-size': compactView ? .72 : .62,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'viewport',
        'icon-keep-upright': false
      },
      paint: { 'icon-opacity': dataset === 'existing' ? .55 : .85 }
    });
  });
}

function addEndpointLayers() {
  map.addLayer({
    id: 'route-endpoints', type: 'circle', source: 'route-endpoints',
    filter: ['==', ['get', 'dataset'], 'proposed'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 13, 6.5],
      'circle-color': '#f8fafc', 'circle-stroke-color': '#2bb7ff', 'circle-stroke-width': 2.5
    }
  });
  map.addLayer({
    id: 'route-endpoint-labels', type: 'symbol', source: 'route-endpoints', minzoom: 11,
    filter: ['==', ['get', 'dataset'], 'proposed'],
    layout: {
      'text-field': ['get', 'label'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 1.25],
      'text-font': ['Roboto Regular'], 'text-max-width': 16,
      'text-allow-overlap': false, 'text-pitch-alignment': 'viewport'
    },
    paint: { 'text-color': '#eef7ff', 'text-halo-color': 'rgba(5, 11, 20, .94)', 'text-halo-width': 2 }
  });
}

function addFilteredRoadLabelLayer() {
  map.addLayer({
    id: 'route-road-labels',
    type: 'symbol',
    source: 'route-road-labels',
    minzoom: 9,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 260,
      'text-field': ['get', 'name'],
      'text-font': ['Roboto Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10.5, 13, 12.5, 16, 14],
      'text-pitch-alignment': 'viewport',
      'text-rotation-alignment': 'map',
      'text-keep-upright': true,
      'text-allow-overlap': false,
      'text-ignore-placement': false
    },
    paint: {
      'text-color': '#f1f5f9',
      'text-halo-color': 'rgba(5, 11, 20, .96)',
      'text-halo-width': 2,
      'text-halo-blur': .35
    }
  });
}

function applyCachedRoadLabels() {
  if (!mapReady || !map.getSource('route-road-labels')) return;
  const labels = roadLabelCache.forMode(uiState.mode);
  if (labels === appliedRoadLabelCollection) return;
  appliedRoadLabelCollection = labels;
  document.getElementById('map').dataset.roadLabelCount = String(labels.features.length);
  map.getSource('route-road-labels').setData(labels);
}

function primeRouteRoadLabels() {
  if (!mapReady) return;
  const sourceFeatures = map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name' });
  const roadFeatures = sourceFeatures
    .filter((feature) => {
      const name = feature.properties?.name ?? feature.properties?.name_vi ?? feature.properties?.name_en;
      return name && (feature.geometry?.type === 'LineString' || feature.geometry?.type === 'MultiLineString');
    })
    .map((feature) => ({
      type: 'Feature',
      properties: {
        name: feature.properties?.name,
        name_vi: feature.properties?.name_vi,
        name_en: feature.properties?.name_en
      },
      geometry: {
        type: feature.geometry.type,
        coordinates: feature.geometry.coordinates
      }
    }));

  roadLabelCache.prime({ roadFeatures, existingCoordinates, proposedCoordinates })
    .then(() => {
      document.getElementById('map').dataset.roadLabelState = 'ready';
      appliedRoadLabelCollection = null;
      applyCachedRoadLabels();
    })
    .catch((error) => {
      document.getElementById('map').dataset.roadLabelState = 'error';
      console.warn('Không thể chuẩn bị nhãn đường:', error);
    });
}

function addPoiLayers() {
  map.addLayer({
    id: 'poi-halo', type: 'circle', source: 'route-pois',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 7, 13, 12, 16, 16],
      'circle-color': '#fbbf24', 'circle-opacity': .28, 'circle-blur': .65
    }
  });
  map.addLayer({
    id: 'poi-core', type: 'circle', source: 'route-pois',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 13, 6.5, 16, 8],
      'circle-color': '#fbbf24', 'circle-stroke-color': '#fff7d6', 'circle-stroke-width': 2
    }
  });
  map.addLayer({
    id: 'poi-labels', type: 'symbol', source: 'route-pois', minzoom: 9.5,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12],
      'text-font': ['Roboto Regular'],
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
      'text-radial-offset': 1.15,
      'text-justify': 'auto',
      'text-max-width': 22,
      'text-allow-overlap': false,
      'text-optional': true,
      'text-pitch-alignment': 'viewport'
    },
    paint: {
      'text-color': '#fff5cf', 'text-halo-color': 'rgba(5, 11, 20, .96)',
      'text-halo-width': 2, 'text-halo-blur': .4
    }
  });
}

function resetProposedGradient() {
  revealToken += 1;
  if (map?.getLayer('route-proposed')) map.setPaintProperty('route-proposed', 'line-gradient', '#2bb7ff');
}

function applyMode(mode, { announce = true } = {}) {
  if (!mapReady) return;
  uiState.mode = mode;
  resetProposedGradient();
  const difference = mode === VIEW_MODES.DIFFERENCE;
  const existing = mode === VIEW_MODES.EXISTING || mode === VIEW_MODES.COMPARE;
  const proposed = mode === VIEW_MODES.PROPOSED || mode === VIEW_MODES.COMPARE;

  ['route-removed', 'route-retained', 'route-added-halo', 'route-added-core'].forEach((id) => setLayerVisible(id, difference));
  setLayerVisible('route-existing', existing);
  setLayerVisible('route-proposed-halo', proposed);
  setLayerVisible('route-proposed', proposed);

  const compare = mode === VIEW_MODES.COMPARE;
  map.setPaintProperty('route-existing', 'line-offset', compare ? -4.5 : 0);
  map.setPaintProperty('route-proposed-halo', 'line-offset', compare ? 4.5 : 0);
  map.setPaintProperty('route-proposed', 'line-offset', compare ? 4.5 : 0);

  ['stops-retained', 'stops-added-halo', 'stops-added', 'stops-removed'].forEach((id) => setLayerVisible(id, difference && uiState.showStops));
  setLayerVisible('stops-existing-raw', uiState.showStops && mode === VIEW_MODES.EXISTING);
  setLayerVisible('stops-proposed-raw', uiState.showStops && (mode === VIEW_MODES.PROPOSED || compare));

  setLayerVisible('arrows-existing', uiState.showArrows && (mode === VIEW_MODES.EXISTING || compare));
  setLayerVisible('arrows-proposed', uiState.showArrows && (difference || mode === VIEW_MODES.PROPOSED || compare));

  const endpointDataset = mode === VIEW_MODES.EXISTING ? 'existing' : 'proposed';
  map.setFilter('route-endpoints', ['==', ['get', 'dataset'], endpointDataset]);
  map.setFilter('route-endpoint-labels', ['==', ['get', 'dataset'], endpointDataset]);

  document.querySelectorAll('.mode-button').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.getElementById('difference-legend').classList.toggle('is-muted', !difference);
  applyCachedRoadLabels();
  if (announce) {
    const names = { difference: 'Chênh lệch', existing: 'Hiện hữu', proposed: 'Điều chỉnh', compare: 'Đối chiếu' };
    setStatus(`Chế độ ${names[mode]}.`);
  }
}

function renderMetrics() {
  const metrics = routeComparison.metrics;
  document.getElementById('metric-existing').textContent = kilometer(metrics.existingLengthMeters);
  document.getElementById('metric-proposed').textContent = kilometer(metrics.proposedLengthMeters);
  document.getElementById('metric-added').textContent = kilometer(metrics.addedLengthMeters);
  document.getElementById('metric-removed').textContent = kilometer(metrics.removedLengthMeters);
  document.getElementById('overview-note').textContent = `So sánh hình học dùng ngưỡng ${ROUTE_MATCH_THRESHOLD_METERS} m. Điểm dừng dùng ngưỡng ${STOP_MATCH_THRESHOLD_METERS} m khi không có mã định danh ổn định.`;
  document.getElementById('count-retained-stops').textContent = `${kilometer(metrics.retainedLengthMeters)} · ${stopComparison.metrics.retained} trạm`;
  document.getElementById('count-added-stops').textContent = `${kilometer(metrics.addedLengthMeters)} · ${stopComparison.metrics.added} trạm`;
  document.getElementById('count-removed-stops').textContent = `${kilometer(metrics.removedLengthMeters)} · ${stopComparison.metrics.removed} trạm`;
  document.getElementById('stop-total').textContent = String(proposedStops.length);
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((candidate) => {
        const active = candidate === tab;
        candidate.classList.toggle('is-active', active);
        candidate.setAttribute('aria-selected', String(active));
        document.getElementById(`panel-${candidate.dataset.tab}`).hidden = !active;
      });
    });
  });
}

function buildMeasuredPath(coordinates) {
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative.push(cumulative[index - 1] + haversineMeters(coordinates[index - 1], coordinates[index]));
  }
  return { coordinates, cumulative, total: cumulative.at(-1) };
}

function pointAlongPath(path, distance) {
  const wrapped = ((distance % path.total) + path.total) % path.total;
  let low = 1;
  let high = path.cumulative.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (path.cumulative[middle] < wrapped) low = middle + 1;
    else high = middle;
  }
  const endIndex = low;
  const startIndex = Math.max(0, endIndex - 1);
  const segmentLength = path.cumulative[endIndex] - path.cumulative[startIndex];
  const ratio = segmentLength ? (wrapped - path.cumulative[startIndex]) / segmentLength : 0;
  const start = path.coordinates[startIndex];
  const end = path.coordinates[endIndex];
  return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
}

function makeBusElement(variant, label) {
  const element = document.createElement('div');
  element.className = `bus-marker ${variant}`;
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', label);
  element.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M8 4h16c2.2 0 4 1.8 4 4v13c0 1.7-1.1 3.2-2.7 3.8V28a2 2 0 0 1-4 0v-3H10.7v3a2 2 0 0 1-4 0v-3.2A4 4 0 0 1 4 21V8c0-2.2 1.8-4 4-4Zm1 4v8h14V8H9Zm1 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg>';
  return element;
}

function createBusAnimator({ key, coordinates, variant, label, toggleId, speedId, outputId, offset = 0, enabled }) {
  const path = buildMeasuredPath(coordinates);
  const element = makeBusElement(variant, label);
  const marker = new maplibregl.Marker({ element, anchor: 'center', pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
    .setLngLat(pointAlongPath(path, path.total * offset))
    .addTo(map);
  const toggle = document.getElementById(toggleId);
  const speed = document.getElementById(speedId);
  const output = document.getElementById(outputId);
  const state = { distance: path.total * offset, lastTime: null, loop: 0 };
  toggle.checked = enabled;
  speed.value = String(DEFAULT_BUS_SPEED);

  const sync = () => {
    element.style.display = toggle.checked ? 'grid' : 'none';
    output.value = `${Number(speed.value)}×`;
  };
  toggle.addEventListener('change', sync);
  speed.addEventListener('input', sync);
  sync();

  return {
    update(timestamp) {
      if (state.lastTime === null) state.lastTime = timestamp;
      const elapsed = Math.min(timestamp - state.lastTime, 120);
      state.lastTime = timestamp;
      if (!toggle.checked) return null;
      const nextDistance = (state.distance + elapsed * path.total / BUS_LOOP_DURATION_MS * Number(speed.value)) % path.total;
      if (nextDistance < state.distance) state.loop += 1;
      state.distance = nextDistance;
      const position = pointAlongPath(path, state.distance);
      marker.setLngLat(position);
      return { key, loop: state.loop, position };
    }
  };
}

function startBusSimulation() {
  const animators = [
    createBusAnimator({
      key: 'existing', coordinates: existingCoordinates, variant: 'existing',
      label: 'Xe buýt tuyến 61-2 hiện hữu', toggleId: 'toggle-bus-existing',
      speedId: 'speed-bus-existing', outputId: 'speed-bus-existing-value', enabled: false
    }),
    createBusAnimator({
      key: 'proposed', coordinates: proposedCoordinates, variant: 'proposed',
      label: 'Xe buýt tuyến 61-2 điều chỉnh', toggleId: 'toggle-bus-proposed',
      speedId: 'speed-bus-proposed', outputId: 'speed-bus-proposed-value', offset: .08, enabled: true
    })
  ];
  const stopPulseTracker = createStopPulseTracker({ radiusMeters: BUS_STOP_TRIGGER_RADIUS_METERS });
  let lastStopUpdate = 0;
  let lastAnimationUpdate = null;

  function showStopPulse(feature) {
    if (!uiState.showStops) return;
    const element = document.createElement('div');
    element.className = 'stop-pulse-marker';
    element.setAttribute('aria-hidden', 'true');
    const visual = document.createElement('div');
    visual.className = 'stop-pulse-visual';
    element.appendChild(visual);
    const marker = new maplibregl.Marker({ element, anchor: 'center' })
      .setLngLat(feature.geometry.coordinates)
      .addTo(map);
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      marker.remove();
    };
    visual.addEventListener('animationend', remove, { once: true });
    window.setTimeout(remove, 1_200);
  }

  function updatePulses(busStates) {
    stopPulseTracker.collect(busStates, pulseStopsData.features).forEach(showStopPulse);
  }

  function animate(timestamp) {
    if (!shouldUpdateAnimationFrame(timestamp, lastAnimationUpdate, BUS_ANIMATION_INTERVAL_MS)) {
      requestAnimationFrame(animate);
      return;
    }
    lastAnimationUpdate = timestamp;
    const busStates = animators.map((animator) => animator.update(timestamp)).filter(Boolean);
    if (timestamp - lastStopUpdate >= 60) {
      lastStopUpdate = timestamp;
      updatePulses(busStates);
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

function allCoordinatesFromFeatureCollection(collection) {
  return collection.features.flatMap((feature) => (
    feature.geometry.type === 'Point' ? [feature.geometry.coordinates] : feature.geometry.coordinates
  ));
}

function targetCoordinates(target) {
  switch (target) {
    case 'existing': return existingCoordinates;
    case 'proposed': return proposedCoordinates;
    case 'changes': {
      const changedFeatures = [...routeComparison.added.features, ...routeComparison.removed.features]
        .sort((featureA, featureB) => (
          lineLengthMeters(featureB.geometry.coordinates) - lineLengthMeters(featureA.geometry.coordinates)
        ))
        .slice(0, 2);
      const changed = changedFeatures.flatMap((feature) => feature.geometry.coordinates);
      return changed.length ? changed : [...existingCoordinates, ...proposedCoordinates];
    }
    case 'service-area': return industrialZoneFeature?.geometry?.coordinates?.[0] ?? proposedCoordinates;
    case 'connections': return landmarks.map((landmark) => landmark.coordinates);
    default: return [...existingCoordinates, ...proposedCoordinates, ...landmarks.map((landmark) => landmark.coordinates)];
  }
}

function fitTarget(target, presentationActive, camera = {}, layoutPadding) {
  const coordinates = targetCoordinates(target);
  if (!coordinates.length) return;
  const bounds = coordinates.reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
  map.fitBounds(bounds, buildPresentationCameraOptions({
    target,
    presentationActive,
    compactView,
    reducedMotion: prefersReducedMotion,
    camera,
    layoutPadding
  }));
}

function currentStoryLayoutPadding() {
  if (!storyShell?.active) return undefined;
  const mapRect = document.getElementById('map').getBoundingClientRect();
  const selector = `[data-story-state-index="${storyRuntime.currentIndex}"] .story-step__content`;
  const storyRect = document.querySelector(selector).getBoundingClientRect();
  const stacked = window.matchMedia('(max-width: 760px), (max-height: 640px)').matches;
  return buildStoryLayoutPadding({ mapRect, storyRect, stacked });
}

function emphasizePois(active) {
  document.body.classList.toggle('emphasize-pois', active);
  if (!mapReady) return;
  map.setPaintProperty('poi-halo', 'circle-radius', active
    ? ['interpolate', ['linear'], ['zoom'], 9, 13, 13, 20, 16, 25]
    : ['interpolate', ['linear'], ['zoom'], 9, 7, 13, 12, 16, 16]);
  map.setPaintProperty('poi-halo', 'circle-opacity', active ? .48 : .28);
}

function revealProposedRoute() {
  if (!mapReady || !map.getLayer('route-proposed')) return;
  const token = ++revealToken;
  if (prefersReducedMotion) {
    map.setPaintProperty('route-proposed', 'line-gradient', '#2bb7ff');
    return;
  }
  const start = performance.now();
  function frame(now) {
    if (token !== revealToken || uiState.mode !== VIEW_MODES.PROPOSED) return;
    const progress = Math.min(1, (now - start) / PROPOSED_REVEAL_DURATION_MS);
    if (progress >= 1) {
      map.setPaintProperty('route-proposed', 'line-gradient', '#2bb7ff');
      return;
    }
    map.setPaintProperty('route-proposed', 'line-gradient', [
      'step', ['line-progress'], '#2bb7ff', Math.max(.001, progress), 'rgba(43, 183, 255, 0)'
    ]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

const routeRevealController = createRouteRevealController({
  start: revealProposedRoute,
  cancel: resetProposedGradient,
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clear: (timerId) => window.clearTimeout(timerId),
  reducedMotion: prefersReducedMotion
});

function renderPresentation() {
  document.body.classList.toggle('is-presenting', storyRuntime.active);
  document.getElementById('presentation').hidden = !storyRuntime.active;
  if (!storyRuntime.active) return;

  const state = storyRuntime.currentState;
  const contentShell = document.getElementById('presentation-content');
  renderPresentationContent(contentShell, state, presentationMetrics);
  if (!prefersReducedMotion) {
    contentShell.classList.add('is-changing');
    void contentShell.offsetWidth;
    requestAnimationFrame(() => contentShell.classList.remove('is-changing'));
  }
  document.getElementById('chapter-previous').disabled = storyRuntime.currentIndex === 0;
  document.getElementById('chapter-next').disabled = storyRuntime.currentIndex === storyRuntime.definition.states.length - 1;
  document.querySelectorAll('.chapter-dot').forEach((dot, index) => {
    const active = index === storyRuntime.currentIndex;
    dot.classList.toggle('is-active', active);
    dot.setAttribute('aria-current', active ? 'step' : 'false');
  });
  const eyebrow = findStoryContentBlock(state, 'eyebrow');
  const heading = findStoryContentBlock(state, 'heading');
  setStatus(`Trình chiếu ${eyebrow?.step ?? storyRuntime.currentIndex + 1}: ${heading?.text ?? state.id}.`);
}

function dispatchPresentation(action) {
  switch (action.type) {
    case 'OPEN': storyRuntime.activate(0); break;
    case 'CLOSE':
      storyRuntime.deactivate();
      applyMode(VIEW_MODES.DIFFERENCE, { announce: false });
      emphasizePois(false);
      urbanContextController?.setMode('off');
      break;
    case 'NEXT': storyRuntime.next(); break;
    case 'PREVIOUS': storyRuntime.previous(); break;
    case 'GOTO': storyRuntime.goTo(action.index); break;
    default: return;
  }
  renderPresentation();
}

function bindPresentation() {
  const dots = document.getElementById('chapter-dots');
  storyRuntime.definition.states.forEach((state, index) => {
    const eyebrow = findStoryContentBlock(state, 'eyebrow');
    const heading = findStoryContentBlock(state, 'heading');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chapter-dot';
    button.setAttribute('aria-label', `${eyebrow?.step ?? index + 1}. ${heading?.text ?? state.id}`);
    button.addEventListener('click', () => dispatchPresentation({ type: 'GOTO', index }));
    dots.appendChild(button);
  });
  document.getElementById('presentation-open').addEventListener('click', () => dispatchPresentation({ type: 'OPEN' }));
  document.getElementById('presentation-close').addEventListener('click', () => {
    dispatchPresentation({ type: 'CLOSE' });
    fitTarget('overview', false);
  });
  document.getElementById('chapter-previous').addEventListener('click', () => dispatchPresentation({ type: 'PREVIOUS' }));
  document.getElementById('chapter-next').addEventListener('click', () => dispatchPresentation({ type: 'NEXT' }));
  window.addEventListener('keydown', (event) => {
    const interactive = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (!storyRuntime.active || interactive) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); dispatchPresentation({ type: 'NEXT' }); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); dispatchPresentation({ type: 'PREVIOUS' }); }
    if (event.key === 'Escape') {
      event.preventDefault();
      dispatchPresentation({ type: 'CLOSE' });
      fitTarget('overview', false);
    }
  });
}

function bindStoryShell() {
  storyShell = createStoryShell({
    runtime: storyRuntime,
    elements: {
      root: document.getElementById('story-shell'),
      steps: document.getElementById('story-shell-steps'),
      progressCurrent: document.getElementById('story-progress-current'),
      progressTotal: document.getElementById('story-progress-total'),
      previousButton: document.getElementById('story-previous'),
      nextButton: document.getElementById('story-next'),
      exitButton: document.getElementById('story-explore')
    },
    renderContent: renderPresentationContent,
    metrics: presentationMetrics,
    interactionPolicy: createGuidedMapInteractionPolicy(map),
    reducedMotion: prefersReducedMotion,
    onActivate({ state, index, total }) {
      const heading = findStoryContentBlock(state, 'heading');
      setStatus(`Câu chuyện ${index + 1}/${total}: ${heading?.text ?? state.id}.`);
    },
    onExit() {
      applyMode(VIEW_MODES.DIFFERENCE, { announce: false });
      emphasizePois(false);
      urbanContextController?.setMode('off');
      fitTarget('overview', false);
      setStatus('Sẵn sàng · Chế độ Chênh lệch.');
    }
  });
  const openButton = document.getElementById('presentation-open');
  openButton.textContent = 'Bắt đầu câu chuyện';
  openButton.addEventListener('click', () => storyShell.enter());
}

function bindControls() {
  document.querySelectorAll('.mode-button').forEach((button) => {
    button.addEventListener('click', () => {
      applyMode(button.dataset.mode);
    });
  });
  document.getElementById('toggle-stops').addEventListener('change', (event) => {
    uiState.showStops = event.target.checked;
    applyMode(uiState.mode, { announce: false });
  });
  document.getElementById('toggle-pois').addEventListener('change', (event) => {
    uiState.showPois = event.target.checked;
    ['poi-halo', 'poi-core', 'poi-labels'].forEach((id) => setLayerVisible(id, uiState.showPois));
  });
  document.getElementById('toggle-arrows').addEventListener('change', (event) => {
    uiState.showArrows = event.target.checked;
    applyMode(uiState.mode, { announce: false });
  });
}

function bindMapInteractions() {
  const interactiveLayers = [
    'route-removed', 'route-retained', 'route-added-core', 'route-existing', 'route-proposed',
    'stops-retained', 'stops-added', 'stops-removed', 'stops-existing-raw', 'stops-proposed-raw',
    'route-endpoints', 'poi-core'
  ];
  interactiveLayers.forEach((layerId) => {
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
  });

  ['route-removed', 'route-retained', 'route-added-core', 'route-existing', 'route-proposed'].forEach((layerId) => {
    map.on('click', layerId, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const labels = {
        retained: 'Đoạn giữ lại', added: 'Đoạn bổ sung', removed: 'Đoạn loại bỏ',
        existing: 'Tuyến 61-2 hiện hữu', proposed: 'Tuyến 61-2 điều chỉnh'
      };
      const key = feature.properties.status ?? feature.properties.dataset;
      new maplibregl.Popup().setLngLat(event.lngLat).setText(labels[key] ?? 'Tuyến 61-2').addTo(map);
    });
  });

  ['stops-retained', 'stops-added', 'stops-removed', 'stops-existing-raw', 'stops-proposed-raw'].forEach((layerId) => {
    map.on('click', layerId, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const status = feature.properties.status;
      const label = status === 'added' ? 'Điểm dừng bổ sung'
        : status === 'removed' ? 'Điểm dừng loại bỏ'
          : status === 'retained' ? 'Điểm dừng giữ lại' : 'Điểm dừng tuyến 61-2';
      new maplibregl.Popup({ offset: 10 }).setLngLat(feature.geometry.coordinates).setText(label).addTo(map);
    });
  });

  map.on('click', 'route-endpoints', (event) => {
    const feature = event.features?.[0];
    if (feature) new maplibregl.Popup({ offset: 10 }).setLngLat(feature.geometry.coordinates).setText(feature.properties.label).addTo(map);
  });
  map.on('click', 'poi-core', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    const content = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = feature.properties.name;
    const link = document.createElement('a');
    link.href = feature.properties.sourceUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'Mở vị trí tham chiếu';
    content.append(name, document.createElement('br'), link);
    new maplibregl.Popup({ offset: 12 }).setLngLat(feature.geometry.coordinates).setDOMContent(content).addTo(map);
  });
}

async function initialize() {
  renderMetrics();
  bindTabs();
  bindControls();

  try {
    const [storyDefinition, styleResponse, industrialZoneResponse, overtureBuildingResponse] = await Promise.all([
      loadStoryDefinition('./data/stories/route-61-2.story.json', {
        actionContracts: ROUTE_612_STORY_ACTION_CONTRACTS
      }),
      fetch('./style-openfreemap-dark.json'),
      fetch('./data/industrial-zone-poc.geojson'),
      fetch(OVERTURE_BUILDINGS_DATA_URL).catch(() => null)
    ]);
    if (!styleResponse.ok) throw new Error(`Không tải được style.json (${styleResponse.status}).`);
    if (!industrialZoneResponse.ok) throw new Error(`Không tải được vùng công nghiệp (${industrialZoneResponse.status}).`);
    const industrialZoneCollection = await industrialZoneResponse.json();
    if (industrialZoneCollection.type !== 'FeatureCollection'
      || industrialZoneCollection.features?.length !== 1
      || industrialZoneCollection.features[0]?.geometry?.type !== 'Polygon') {
      throw new TypeError('Dữ liệu vùng công nghiệp phải chứa đúng một Polygon.');
    }
    industrialZoneFeature = industrialZoneCollection.features[0];
    const storyActionRunner = createStoryActionRunner(createRoute612StoryActionHandlers({
      setMode: (mode) => applyMode(mode, { announce: false }),
      focus: (target, camera) => fitTarget(target, true, camera, currentStoryLayoutPadding()),
      setPoiEmphasis: emphasizePois,
      setUrbanContext: (mode) => urbanContextController?.setMode(mode),
      setRouteReveal: routeRevealController.setActive
    }));
    storyRuntime = createStoryRuntime({ definition: storyDefinition, actionRunner: storyActionRunner });
    if (overtureBuildingResponse?.ok) {
      try {
        overtureBuildingCollection = await overtureBuildingResponse.json();
      } catch (error) {
        console.warn('Dữ liệu công trình Overture không hợp lệ; dùng khối tích tổng hợp dự phòng.', error);
      }
    } else {
      console.warn('Không tải được dữ liệu công trình Overture; dùng khối tích tổng hợp dự phòng.');
    }
    const rawBasemapStyle = await styleResponse.json();
    const basemapStyle = prepareBasemapStyle(stripOpenFreeMapDarkStyle(rawBasemapStyle));
    map = new maplibregl.Map({
      container: 'map',
      style: basemapStyle,
      center: [106.63, 11.06],
      zoom: 10.7,
      pitch: 46,
      bearing: -18,
      maxPitch: 72,
      antialias: true,
      canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' }
    });
    document.getElementById('map').dataset.basemapVariant = 'stripped-dark';
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-right');

    map.on('load', () => {
      addMapSources();
      addArrowImage();
      addRouteLayers();
      addStopLayers();
      addDirectionLayers();
      addEndpointLayers();
      addFilteredRoadLabelLayer();
      addPoiLayers();
      urbanContextController = createUrbanContextController({
        map,
        maplibregl,
        zone: industrialZoneFeature,
        overtureBuildings: overtureBuildingCollection,
        routeCoordinates: [existingCoordinates, proposedCoordinates],
        pois: landmarks,
        reducedMotion: prefersReducedMotion
      });
      mapReady = true;
      storyExperience === 'legacy' ? bindPresentation() : bindStoryShell();
      map.once('idle', primeRouteRoadLabels);
      applyMode(VIEW_MODES.DIFFERENCE, { announce: false });
      bindMapInteractions();
      startBusSimulation();
      fitTarget('overview', false);
      setStatus('Sẵn sàng · Chế độ Chênh lệch.');
    });
    map.on('remove', () => {
      urbanContextController?.destroy({ removeLayer: false });
      urbanContextController = null;
    });
    map.on('error', (event) => {
      if (event?.error?.message) console.warn('MapLibre:', event.error.message);
    });
  } catch (error) {
    console.error(error);
    setStatus('Không thể tải nền bản đồ. Hãy mở package qua web server tĩnh.');
  }
}

initialize();
