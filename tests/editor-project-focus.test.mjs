import assert from 'node:assert/strict';
import test from 'node:test';

import { capturePreviewView, renderEntityInspector } from '../editor/ui/inspectors.js';

function fixtureDraft() {
  const draft = {
    manifest: {
      schemaVersion: '1.0',
      id: 'transit-plan',
      title: 'Transit plan',
      locale: 'en-US',
      stories: { primary: 'main', items: [{ id: 'main', src: './stories/main.story.json' }] },
      map: {
        basemap: 'openfreemap-dark',
        initialView: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 }
      },
      datasets: {
        route: { type: 'geojson', src: './data/route.geojson', label: 'Route', attribution: ['agency'] }
      },
      assets: {
        photo: { type: 'image', src: './assets/photo.webp', mediaType: 'image/webp', attribution: ['agency'] }
      },
      focusTargets: {},
      capabilities: [],
      attribution: { agency: { name: 'Transit agency' } }
    },
    mutations: 0
  };
  draft.mutate = (updater) => {
    draft.mutations += 1;
    updater(draft.manifest);
  };
  return draft;
}

test('Project inspector preserves basemap and applies captured camera only on command', () => {
  const draft = fixtureDraft();
  const telemetry = { center: [106.6, 11.1], zoom: 12, pitch: 20, bearing: -5 };
  const ui = renderEntityInspector({ kind: 'project', manifest: draft.manifest, telemetry, mutate: draft.mutate });

  assert.equal(ui.control('map.basemap').readOnly, true);
  const captured = ui.command('use-current-view');
  assert.deepEqual(captured, { center: [106.6, 11.1], zoom: 12, pitch: 20, bearing: -5 });
  assert.equal(draft.mutations, 0);
  assert.deepEqual(draft.manifest.map.initialView.center, [0, 0]);

  ui.command('confirm-capture');
  assert.equal(draft.mutations, 1);
  assert.deepEqual(draft.manifest.map.initialView, captured);
  assert.equal(draft.manifest.map.basemap, 'openfreemap-dark');
});

test('Project inspector authors metadata, locale, and bounded map settings while IDs stay read-only', () => {
  const draft = fixtureDraft();
  const ui = renderEntityInspector({ kind: 'project', manifest: draft.manifest, mutate: draft.mutate });

  assert.equal(ui.control('schemaVersion').readOnly, true);
  assert.equal(ui.control('id').readOnly, true);
  assert.equal(ui.control('map.basemap').inputType, 'text');
  for (const [path, value] of [
    ['title', 'Network plan'], ['subtitle', 'Draft'], ['description', 'A project'],
    ['locale', 'vi-VN'], ['organization', 'Planning office'], ['author', 'Mai'],
    ['projectDate', '2026-08-30'], ['projectVersion', '2'],
    ['map.minZoom', 4], ['map.maxZoom', 18]
  ]) ui.control(path).set(value);

  assert.equal(draft.manifest.organization, 'Planning office');
  assert.equal(draft.manifest.map.minZoom, 4);
  assert.equal(draft.manifest.map.maxZoom, 18);
  assert.equal(draft.manifest.map.basemap, 'openfreemap-dark');
});

test('Attribution inspector adds, edits, references, and confirms removal with broken-reference details', () => {
  const draft = fixtureDraft();
  const ui = renderEntityInspector({ kind: 'attribution', manifest: draft.manifest, mutate: draft.mutate });

  ui.command('add', 'survey', { name: 'Survey', url: 'https://example.com', license: 'CC BY', updated: '2026-08-30', notes: 'Annual' });
  assert.equal(ui.entity('survey').control('id').readOnly, true);
  ui.entity('survey').control('name').set('Annual survey');
  ui.entity('survey').command('add-reference', { registry: 'datasets', entityId: 'route' });
  assert.deepEqual(draft.manifest.datasets.route.attribution, ['agency', 'survey']);

  const warning = ui.entity('agency').command('request-delete');
  assert.equal(warning.requiresConfirmation, true);
  assert.deepEqual(warning.brokenReferences, ['assets.photo.attribution', 'datasets.route.attribution']);
  assert.ok(draft.manifest.attribution.agency);
  ui.entity('agency').command('confirm-delete');
  assert.equal(draft.manifest.attribution.agency, undefined);
  assert.deepEqual(draft.manifest.datasets.route.attribution, ['survey']);
  assert.deepEqual(draft.manifest.assets.photo.attribution, []);
});

test('Focus inspector authors dataset, coordinate, and bounds forms with camera hints', () => {
  const draft = fixtureDraft();
  const ui = renderEntityInspector({ kind: 'focus', manifest: draft.manifest, mutate: draft.mutate });

  ui.command('add', 'route-overview', { type: 'datasets', datasets: ['route'], camera: { padding: 24 } });
  ui.command('add', 'town', { type: 'coordinate', center: [106.6, 11], zoom: 13, camera: { pitch: 30, bearing: 4 } });
  ui.command('add', 'region', { type: 'bounds', bounds: [[106.5, 10.9], [106.7, 11.1]], camera: { maxZoom: 15 } });

  assert.equal(ui.entity('town').control('id').readOnly, true);
  ui.entity('route-overview').control('camera.padding').set(32);
  assert.deepEqual(draft.manifest.focusTargets['route-overview'], { type: 'datasets', datasets: ['route'], camera: { padding: 32 } });
  assert.deepEqual(draft.manifest.focusTargets.town.camera, { pitch: 30, bearing: 4 });
  assert.deepEqual(draft.manifest.focusTargets.region.camera, { maxZoom: 15 });
});

test('Focus capture stages coordinate and bounds production shapes before one confirmed mutation', () => {
  const draft = fixtureDraft();
  const telemetry = { center: [106.61, 10.99], zoom: 14, pitch: 25, bearing: -8, bounds: [[106.5, 10.9], [106.7, 11.1]] };
  const ui = renderEntityInspector({ kind: 'focus', manifest: draft.manifest, telemetry, mutate: draft.mutate });

  assert.deepEqual(capturePreviewView('coordinate', telemetry), {
    type: 'coordinate', center: [106.61, 10.99], zoom: 14, camera: { pitch: 25, bearing: -8 }
  });
  assert.deepEqual(capturePreviewView('bounds', telemetry), {
    type: 'bounds', bounds: [[106.5, 10.9], [106.7, 11.1]], camera: { maxZoom: 14 }
  });

  const captured = ui.command('capture', 'coordinate');
  assert.equal(draft.mutations, 0);
  assert.equal(captured.type, 'coordinate');
  ui.command('confirm-capture', 'captured-place');
  assert.equal(draft.mutations, 1);
  assert.deepEqual(draft.manifest.focusTargets['captured-place'], captured);
});
