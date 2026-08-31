import { createStoryActionRunner } from '../story-action-runner.js';
import { createStoryRuntime } from '../story-runtime.js';
import { createContentRendererRegistry } from '../content/content-renderers.js';
import { createChartRenderer } from '../content/chart-renderer.js';
import { createLocaleFormatter } from '../metrics/locale-formatter.js';
import { createMetricRegistry } from '../metrics/metric-registry.js';
import { createSceneCompositor } from '../scene/scene-compositor.js';
import { createSceneInteractionPolicy } from '../scene/scene-interaction-policy.js';
import { createSceneLayerRegistry } from '../scene/scene-layer-registry.js';
import { createSceneStateController } from '../scene/scene-state-controller.js';

export function createProjectContentRenderer(project, {
  documentRef = document,
  Chart = globalThis.Chart,
  reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  metrics = project.metrics
} = {}) {
  if (typeof Chart !== 'function') throw new TypeError('The pinned Chart.js constructor is required for Story 1.1 content.');
  const formatter = createLocaleFormatter(project.locale);
  const chartRenderer = createChartRenderer({ Chart, documentRef, reducedMotion, formatter });
  return createContentRendererRegistry({
    documentRef,
    tables: project.tables,
    assets: project.resources,
    metrics,
    attribution: project.attribution,
    formatter,
    chartRenderer
  });
}

export function createRuntimeMetricRegistry(project, instances) {
  const providers = instances.flatMap(({ entry, implementation }) => (entry.descriptor.metrics ?? []).map((descriptor) => ({
    descriptor,
    compute: implementation.metricProviders?.[descriptor.id]
  })));
  const aliases = Object.assign({}, ...instances.map(({ implementation }) => implementation.legacyMetricAliases ?? {}));
  return createMetricRegistry({
    staticMetrics: project.resources.get('metrics')?.value?.metrics ?? {},
    providers,
    aliases,
    context: { project, instances }
  });
}

function defaultCreateMap({ project, maplibregl }) {
  return new maplibregl.Map({
    container: 'map',
    ...project.map.initialView
  });
}

function capabilityContext(context, entry, map) {
  return {
    ...context,
    ...(context.capabilityContexts?.[entry.descriptor.id] ?? {}),
    map,
    project: context.project,
    resources: context.project.resources,
    settings: context.project.capabilities.settings?.[entry.descriptor.id] ?? {}
  };
}

function mergeHandlers(instances) {
  const handlers = {};
  for (const { entry, implementation } of instances) {
    for (const [type, handler] of Object.entries(implementation.handlers ?? {})) {
      if (Object.hasOwn(handlers, type)) {
        throw new TypeError(`Duplicate bootstrap action handler "${type}" from ${entry.descriptor.id}.`);
      }
      handlers[type] = handler;
    }
  }
  return Object.freeze(handlers);
}

function teardown(instances, map) {
  for (const { implementation } of instances.toReversed()) {
    implementation.restore?.();
    implementation.destroy?.();
  }
  map?.remove?.();
}

function createStory12SceneController(context, { project, map, instances, contentRenderer, documentRef }) {
  if (project.story.schemaVersion !== '1.2') return null;
  const root = context.sceneRoot ?? documentRef?.getElementById?.('scene-compositor');
  if (!root) throw new TypeError('Story 1.2 requires a #scene-compositor production root.');
  if (!contentRenderer) throw new TypeError('Story 1.2 requires the production content renderer.');
  const expectedLayerIds = Object.keys(project.story.states[0]?.map?.layerVisibility ?? {});
  const layerRegistry = createSceneLayerRegistry(instances, expectedLayerIds);
  const compositor = createSceneCompositor({
    root,
    documentRef,
    renderBlock: (block) => contentRenderer.renderBlock(block)
  });
  const interactionPolicy = createSceneInteractionPolicy(map, {
    cooperativeScroll: context.cooperativeScroll ?? false
  });
  return createSceneStateController({
    map,
    layerRegistry,
    interactionPolicy,
    compositor,
    reducedMotion: context.reducedMotion ?? false
  });
}

export async function bootstrapProject(context) {
  const { project } = context;
  if (!project?.story || !project?.capabilities?.ordered) {
    throw new TypeError('A ValidatedProject is required.');
  }
  const documentRef = context.documentRef ?? globalThis.document;
  if (documentRef) applyProjectMetadata(project, { documentRef });
  const createMap = context.createMap ?? defaultCreateMap;
  const map = await createMap({ project, maplibregl: context.maplibregl, documentRef: context.documentRef });
  const instances = [];
  let destroyed = false;
  try {
    for (const entry of project.capabilities.ordered) {
      const implementation = await entry.createCapability(capabilityContext(context, entry, map));
      instances.push(Object.freeze({ entry, implementation }));
    }
    const actionRunner = createStoryActionRunner(mergeHandlers(instances));
    const metrics = await createRuntimeMetricRegistry(project, instances);
    const contentRenderer = documentRef && (context.Chart ?? globalThis.Chart)
      ? createProjectContentRenderer(project, { documentRef, Chart: context.Chart ?? globalThis.Chart, reducedMotion: context.reducedMotion, metrics })
      : null;
    const sceneController = createStory12SceneController(context, {
      project,
      map,
      instances,
      contentRenderer,
      documentRef
    });
    const storyRuntime = createStoryRuntime({
      definition: project.story,
      actionRunner,
      ...(sceneController ? {
        lifecycle: {
          beforeEnter: sceneController.beforeEnter,
          afterExit: sceneController.afterExit
        }
      } : {})
    });
    const shell = await context.bindStoryExperience?.({
      ...context,
      map,
      project,
      runtime: storyRuntime,
      sceneController,
      contentRenderer,
      metrics,
      instances: Object.freeze(instances)
    }) ?? null;
    return Object.freeze({
      map,
      project,
      storyRuntime,
      sceneController,
      shell,
      contentRenderer,
      metrics,
      instances: Object.freeze(instances),
      destroy() {
        if (destroyed) return;
        destroyed = true;
        shell?.exit?.();
        shell?.destroy?.();
        contentRenderer?.destroy?.();
        storyRuntime.deactivate();
        teardown(instances, map);
      }
    });
  } catch (error) {
    teardown(instances, map);
    throw error;
  }
}

export function applyProjectMetadata(project, { documentRef = document } = {}) {
  const title = project?.metadata?.title ?? project?.manifest?.title ?? '';
  const subtitle = project?.metadata?.subtitle ?? project?.manifest?.subtitle ?? '';
  if (project?.locale) documentRef.documentElement.lang = project.locale;
  if (title) documentRef.title = `${title} · Route Storytelling V1`;
  const titleElement = documentRef.getElementById('project-title');
  const subtitleElement = documentRef.getElementById('project-subtitle');
  if (titleElement) titleElement.textContent = title;
  if (subtitleElement) subtitleElement.textContent = subtitle;
  if (title) {
    documentRef.getElementById('map')?.setAttribute('aria-label', `Bản đồ · ${title}`);
    documentRef.getElementById('control-panel')?.setAttribute('aria-label', `Bảng điều khiển · ${title}`);
  }
}

export function renderProjectLoadError(error, { documentRef = document } = {}) {
  let panel = documentRef.getElementById('project-load-error');
  if (!panel) {
    panel = documentRef.createElement('section');
    panel.id = 'project-load-error';
    documentRef.body.prepend(panel);
  }
  const code = error?.code ? `[${error.code}] ` : '';
  const path = error?.path ? `${error.path}: ` : '';
  panel.textContent = `Không thể tải dự án. ${code}${path}${error?.message ?? 'Unknown project error.'}`;
  panel.hidden = false;
  return panel;
}
