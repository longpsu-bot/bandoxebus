import { createScene12 } from './scene-commands.js';

const encoder = new TextEncoder();
const jsonBytes = (value) => encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
const initialView = Object.freeze({ center: [0, 0], zoom: 2, pitch: 0, bearing: 0 });

function entry(path, value, kind, mediaType = 'application/json') {
  return { path, bytes: jsonBytes(value), mediaType, kind, managed: true };
}

function manifest({ id, title, locale, datasets = {}, capabilities = [] }) {
  return {
    schemaVersion: '1.0', id, title, locale,
    stories: { primary: 'main', items: [{ id: 'main', src: './stories/main.story.json' }] },
    map: { basemap: 'openfreemap-dark', initialView: structuredClone(initialView) },
    datasets, assets: {}, focusTargets: {}, capabilities, attribution: {}
  };
}

function heading(id, text) {
  return {
    id: `${id}-heading`,
    frame: { x: 0.08, y: 0.08, width: 0.52, height: 0.18, z: 0 },
    block: { type: 'heading', text }
  };
}

function story(title, scenes) {
  return { schemaVersion: '1.2', id: 'main', title, states: scenes };
}

function scene(id, label, layerVisibility = {}) {
  return createScene12({
    id,
    camera: initialView,
    layerVisibility,
    blocks: label ? [heading(id, label)] : []
  });
}

function options(value = {}, fallbackTitle) {
  return {
    id: value.id ?? 'untitled-project',
    title: value.title ?? fallbackTitle,
    locale: value.locale ?? 'en-US'
  };
}

export function createBlankMapStoryTemplate(value = {}) {
  const selected = options(value, 'Untitled project');
  const project = manifest(selected);
  const definition = story(selected.title, [scene('opening', '')]);
  return [entry('project.json', project, 'manifest'), entry('stories/main.story.json', definition, 'story')];
}

export function createRouteProposalTemplate(value = {}) {
  const selected = options(value, 'Route proposal');
  const datasets = {
    'existing-route': {
      type: 'geojson', geometry: 'line', src: './data/existing-route.geojson', role: 'route.existing',
      label: 'Existing route', render: { type: 'line', color: '#64748B', width: 5, opacity: 0.9, lineStyle: 'solid' }
    },
    'proposed-route': {
      type: 'geojson', geometry: 'line', src: './data/proposed-route.geojson', role: 'route.proposed',
      label: 'Proposed route', render: { type: 'line', color: '#22C55E', width: 5, opacity: 0.95, lineStyle: 'solid' }
    }
  };
  const project = manifest({ ...selected, datasets, capabilities: [{ id: 'route-comparison-v1' }] });
  const snapshots = [
    ['context', 'Context', { 'existing-route': true, 'proposed-route': true }],
    ['existing-route', 'Existing route', { 'existing-route': true, 'proposed-route': false }],
    ['proposed-change', 'Proposed change', { 'existing-route': false, 'proposed-route': true }],
    ['key-connection', 'Key connection', { 'existing-route': true, 'proposed-route': true }],
    ['recommendation', 'Recommendation', { 'existing-route': true, 'proposed-route': true }]
  ];
  const empty = { type: 'FeatureCollection', features: [] };
  return [
    entry('project.json', project, 'manifest'),
    entry('stories/main.story.json', story(selected.title, snapshots.map((args) => scene(...args))), 'story'),
    entry('data/existing-route.geojson', empty, 'dataset', 'application/geo+json'),
    entry('data/proposed-route.geojson', empty, 'dataset', 'application/geo+json')
  ];
}

export function createNetworkServicePlanTemplate(value = {}) {
  const selected = options(value, 'Network / Service Plan');
  const datasets = {
    'network-lines': {
      type: 'geojson', geometry: 'line', src: './data/network-lines.geojson', label: 'Network lines',
      render: { type: 'line', color: '#2563EB', width: 4, opacity: 0.9, lineStyle: 'solid' }
    },
    'service-points': {
      type: 'geojson', geometry: 'point', src: './data/service-points.geojson', label: 'Service points',
      render: { type: 'point', color: '#F59E0B', radius: 6, opacity: 0.95, strokeColor: '#FFFFFF', strokeWidth: 1 }
    }
  };
  const project = manifest({ ...selected, datasets });
  const visibility = { 'network-lines': true, 'service-points': true };
  const empty = { type: 'FeatureCollection', features: [] };
  return [
    entry('project.json', project, 'manifest'),
    entry('stories/main.story.json', story(selected.title, [
      scene('network-overview', 'Network overview', visibility),
      scene('service-needs', 'Service needs', visibility),
      scene('service-plan', 'Service plan', visibility)
    ]), 'story'),
    entry('data/network-lines.geojson', empty, 'dataset', 'application/geo+json'),
    entry('data/service-points.geojson', empty, 'dataset', 'application/geo+json')
  ];
}
