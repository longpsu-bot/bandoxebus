import { createStoryActionRunner } from '../story-action-runner.js';
import { createStoryRuntime } from '../story-runtime.js';

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
    const storyRuntime = createStoryRuntime({ definition: project.story, actionRunner });
    const shell = await context.bindStoryExperience?.({
      ...context,
      map,
      project,
      runtime: storyRuntime,
      instances: Object.freeze(instances)
    }) ?? null;
    return Object.freeze({
      map,
      project,
      storyRuntime,
      shell,
      instances: Object.freeze(instances),
      destroy() {
        if (destroyed) return;
        destroyed = true;
        shell?.exit?.();
        shell?.destroy?.();
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
