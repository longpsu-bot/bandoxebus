import { createHistory } from '../core/history.js';
import {
  addProjectLayerToStory12,
  addRichEnvelope,
  addScene12,
  addTextEnvelope,
  alignEnvelopes,
  bringEnvelopeForward,
  captureSceneCamera,
  commitEnvelopeFrame,
  deleteEnvelope,
  deleteScene12,
  duplicateEnvelope,
  duplicateScene12,
  editRichEnvelope,
  editTextEnvelope,
  moveScene12,
  sendEnvelopeBackward,
  setEnvelopeAppearance,
  setSceneInteraction,
  setSceneLayerVisibility,
  setSceneTransition
} from '../core/scene-commands.js';
import {
  resolveStory12Appearance,
  STORY_12_FONT_FAMILIES
} from '../../src/scene/scene-contract.js';
import { subscribePreviewAuthoringEvents } from '../preview/bridge.js';
import {
  createBlankMapStoryTemplate,
  createNetworkServicePlanTemplate,
  createRouteProposalTemplate
} from '../core/templates.js';

export const STUDIO_PROJECT_CHOICES = Object.freeze([
  Object.freeze({ id: 'blank', label: 'Blank' }),
  Object.freeze({ id: 'route-proposal', label: 'Route Proposal' }),
  Object.freeze({ id: 'network-service-plan', label: 'Network / Service Plan' }),
  Object.freeze({ id: 'import-existing', label: 'Import Existing' })
]);

export function createStudioProjectEntries(choice, options = {}) {
  if (choice === 'blank') return createBlankMapStoryTemplate(options);
  if (choice === 'route-proposal') return createRouteProposalTemplate(options);
  if (choice === 'network-service-plan') return createNetworkServicePlanTemplate(options);
  if (choice === 'import-existing') throw new TypeError('Import Existing uses Open Folder or Import ZIP.');
  throw new TypeError(`Unknown Studio project choice: ${choice}.`);
}

export function routeStudioImportExisting(kind, { openFolder, importZip }, value) {
  if (kind === 'folder') return openFolder();
  if (kind === 'zip') return importZip(value, { label: value?.name ?? 'Imported project.zip' });
  throw new TypeError(`Unsupported import path: ${kind}.`);
}

let activeStudio = null;
let activeHistory = null;
let activeHistoryKey = null;
let selectedOverlayId = null;
let selectedOverlayIds = [];
let selectedLayerId = null;
let authoringMode = 'select';

export function getStudioAuthoringMode() {
  return authoringMode;
}

function clone(value) {
  return structuredClone(value);
}

function element(documentRef, tag, text, attributes = {}) {
  const node = documentRef.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else if (key === 'checked') node.checked = value;
    else if (key === 'value') node.value = value;
    else node.setAttribute(key, String(value));
  }
  return node;
}

export function createStudioOutputPreviewControls({ documentRef = document, onOutputPreview = () => {} } = {}) {
  const previewStory = element(documentRef, 'button', 'Preview Story', {
    type: 'button', id: 'studio-preview-story'
  });
  const present = element(documentRef, 'button', 'Present', {
    type: 'button', id: 'studio-present-story'
  });
  previewStory.addEventListener('click', () => onOutputPreview('scroll'));
  present.addEventListener('click', () => onOutputPreview('presentation'));
  return Object.freeze({ previewStory, present });
}

function cameraEqual(left, right) {
  return Boolean(left && right)
    && left.zoom === right.zoom && left.pitch === right.pitch && left.bearing === right.bearing
    && left.center?.length === 2 && right.center?.length === 2
    && left.center[0] === right.center[0] && left.center[1] === right.center[1];
}

function selectedEnvelope(story, sceneIndex, id) {
  if (!id) return null;
  return story.states[sceneIndex]?.content?.blocks?.find((item) => item.id === id) ?? null;
}

function readableId(value) {
  const label = String(value ?? '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : '';
}

function concise(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 42 ? `${text.slice(0, 39).trimEnd()}…` : text;
}

function semanticEnvelopeText(envelope) {
  const block = envelope?.block ?? {};
  if (['heading', 'paragraph'].includes(block.type)) return concise(block.text);
  if (block.type === 'stat-group') return concise(block.items?.[0]?.label ?? block.items?.[0]?.metric);
  if (['chart', 'table'].includes(block.type)) return concise(block.title ?? block.caption);
  if (block.type === 'image') return concise(block.alt || block.asset);
  if (block.type === 'legend') return concise(block.title ?? block.items?.[0]?.label);
  return '';
}

export function deriveStudioObjectLabel(envelope) {
  const block = envelope?.block ?? {};
  const type = block.type === 'stat-group' ? 'Metric'
    : block.type === 'heading' ? 'Heading'
      : block.type === 'paragraph' ? 'Body text'
        : readableId(block.type || 'Object');
  return `${type} · ${semanticEnvelopeText(envelope) || readableId(envelope?.id) || 'Untitled'}`;
}

export function deriveStudioSceneLabel(scene, index = 0) {
  const blocks = scene?.content?.blocks ?? [];
  const heading = blocks.find(({ block }) => block?.type === 'heading' && concise(block.text));
  if (heading) return semanticEnvelopeText(heading);
  const semantic = blocks.map(semanticEnvelopeText).find(Boolean);
  return semantic || readableId(scene?.id) || `Scene ${index + 1}`;
}

export function applyStudioStoryCommand(story, name, payload = {}) {
  if (name === 'replace-story') return clone(payload.story);
  if (name === 'add-scene') return addScene12(story, { activeSceneIndex: payload.sceneIndex });
  if (name === 'duplicate-scene') return duplicateScene12(story, payload.sceneIndex);
  if (name === 'delete-scene') return deleteScene12(story, payload.sceneIndex);
  if (name === 'move-scene') return moveScene12(story, payload.from, payload.to);
  if (name === 'set-layer-visibility') return setSceneLayerVisibility(story, payload);
  if (name === 'capture-camera') return captureSceneCamera(story, payload);
  if (name === 'set-interaction') return setSceneInteraction(story, payload);
  if (name === 'set-transition') return setSceneTransition(story, payload);
  if (name === 'add-project-layer') return addProjectLayerToStory12(story, payload.datasetId, { activeSceneIndex: payload.sceneIndex });
  if (name === 'add-text') return addTextEnvelope(story, payload);
  if (name === 'add-rich-object') return addRichEnvelope(story, payload);
  if (name === 'edit-rich-block') return editRichEnvelope(story, payload);
  if (name === 'edit-text' || name === 'commit-text') return editTextEnvelope(story, payload);
  if (name === 'commit-frame') return commitEnvelopeFrame(story, payload);
  if (name === 'set-appearance') return setEnvelopeAppearance(story, payload);
  if (name === 'duplicate-object') return duplicateEnvelope(story, payload);
  if (name === 'delete-object') return deleteEnvelope(story, payload);
  if (name === 'align-objects') return alignEnvelopes(story, payload);
  if (name === 'bring-forward') return bringEnvelopeForward(story, payload);
  if (name === 'send-backward') return sendEnvelopeBackward(story, payload);
  throw new TypeError(`Unknown Studio Story command: ${name}.`);
}

function historyKey(context) {
  return `${context.manifest?.id ?? 'project'}:${context.story.id}`;
}

function updateHistoryButtons() {
  const documentRef = activeStudio?.documentRef;
  const undo = documentRef?.getElementById?.('undo-command');
  const redo = documentRef?.getElementById?.('redo-command');
  if (undo) undo.disabled = !activeHistory?.canUndo;
  if (redo) redo.disabled = !activeHistory?.canRedo;
}

function normalizeSelection() {
  if (!activeStudio) return;
  const validIds = new Set(activeStudio.story.states[activeStudio.sceneIndex]?.content?.blocks?.map(({ id }) => id) ?? []);
  selectedOverlayIds = selectedOverlayIds.filter((id) => validIds.has(id));
  if (selectedOverlayId && !validIds.has(selectedOverlayId)) selectedOverlayId = null;
  if (selectedOverlayId && !selectedOverlayIds.includes(selectedOverlayId)) selectedOverlayIds.push(selectedOverlayId);
  if (!selectedOverlayId && selectedOverlayIds.length) selectedOverlayId = selectedOverlayIds.at(-1);
  if (selectedLayerId && !Object.hasOwn(activeStudio.story.states[activeStudio.sceneIndex]?.map?.layerVisibility ?? {}, selectedLayerId)) {
    selectedLayerId = null;
  }
}

function rerenderActive() {
  if (!activeStudio) return;
  normalizeSelection();
  mountStudioShell({ ...activeStudio });
}

function ensureHistory(context) {
  const key = historyKey(context);
  if (activeHistory && activeHistoryKey === key) return activeHistory;
  activeHistoryKey = key;
  activeHistory = createHistory({
    limit: 100,
    read() { return clone(activeStudio.story); },
    write(next) { activeStudio.onStoryCommand('replace-story', { story: clone(next) }); },
    onChange: updateHistoryButtons
  });
  updateHistoryButtons();
  return activeHistory;
}

function bindHistoryButtons(documentRef) {
  const undo = documentRef?.getElementById?.('undo-command');
  const redo = documentRef?.getElementById?.('redo-command');
  if (undo && undo.dataset?.studioHistoryBound !== 'true') {
    undo.dataset.studioHistoryBound = 'true';
    undo.addEventListener('click', () => {
      activeHistory?.undo();
      normalizeSelection();
      rerenderActive();
    });
  }
  if (redo && redo.dataset?.studioHistoryBound !== 'true') {
    redo.dataset.studioHistoryBound = 'true';
    redo.addEventListener('click', () => {
      activeHistory?.redo();
      normalizeSelection();
      rerenderActive();
    });
  }
  updateHistoryButtons();
}

function executeStoryCommand(name, payload = {}) {
  if (!activeStudio) return null;
  const history = ensureHistory(activeStudio);
  const next = history.execute((story) => applyStudioStoryCommand(story, name, payload));
  let nextSceneIndex = null;
  if (name === 'add-scene') nextSceneIndex = next.states.length - 1;
  else if (name === 'duplicate-scene') nextSceneIndex = payload.sceneIndex + 1;
  else if (name === 'delete-scene') nextSceneIndex = Math.min(payload.sceneIndex, next.states.length - 1);
  else if (name === 'move-scene') nextSceneIndex = payload.to;

  if (name === 'add-text' || name === 'add-rich-object' || name === 'duplicate-object') {
    const newId = next.states[payload.sceneIndex].content.blocks.at(-1)?.id ?? null;
    selectedOverlayId = newId;
    selectedOverlayIds = newId ? [newId] : [];
  }
  if (name === 'delete-object') {
    selectedOverlayIds = selectedOverlayIds.filter((id) => id !== payload.id);
    selectedOverlayId = selectedOverlayIds.at(-1) ?? null;
  }
  if (nextSceneIndex !== null) {
    selectedOverlayId = null;
    selectedOverlayIds = [];
    selectedLayerId = null;
    activeStudio.onSelectScene(nextSceneIndex);
  } else {
    rerenderActive();
  }
  return next;
}

function selectOverlay(id, { notify = true, additive = false } = {}) {
  selectedLayerId = null;
  if (additive) {
    if (selectedOverlayIds.includes(id)) selectedOverlayIds = selectedOverlayIds.filter((selected) => selected !== id);
    else selectedOverlayIds = [...selectedOverlayIds, id];
    selectedOverlayId = selectedOverlayIds.at(-1) ?? null;
  } else {
    selectedOverlayId = id;
    selectedOverlayIds = id ? [id] : [];
  }
  if (notify) activeStudio?.onSelectOverlay?.(selectedOverlayId);
  rerenderActive();
}

function selectLayer(id) {
  selectedLayerId = id;
  selectedOverlayId = null;
  selectedOverlayIds = [];
  activeStudio?.onPreviewCommand?.('locate-project-layer', { datasetId: id });
  rerenderActive();
}

subscribePreviewAuthoringEvents((event) => {
  if (!activeStudio) return;
  if (event.type === 'editor-preview:select-overlay') {
    selectOverlay(event.payload.id, { notify: true, additive: false });
    return;
  }
  if (event.type === 'editor-preview:commit-frame') {
    executeStoryCommand('commit-frame', {
      sceneIndex: activeStudio.sceneIndex,
      id: event.payload.id,
      frame: event.payload.frame
    });
    return;
  }
  if (event.type === 'editor-preview:commit-text') {
    executeStoryCommand('edit-text', {
      sceneIndex: activeStudio.sceneIndex,
      id: event.payload.id,
      text: event.payload.text
    });
  }
});

function addControl(documentRef, parent, {
  label,
  id,
  type = 'text',
  value,
  checked,
  options,
  onChange
}) {
  const wrapper = element(documentRef, 'label', label, { className: 'studio-property' });
  let control;
  if (options) {
    control = element(documentRef, 'select', undefined, { id });
    for (const item of options) {
      const optionValue = typeof item === 'object' ? item.value : item;
      const optionLabel = typeof item === 'object' ? item.label : item;
      const option = element(documentRef, 'option', optionLabel, { value: optionValue });
      option.value = optionValue;
      option.selected = optionValue === value;
      control.append(option);
    }
    control.value = value;
  } else {
    control = element(documentRef, 'input', undefined, { id, type });
    if (type === 'checkbox') control.checked = Boolean(checked);
    else control.value = value ?? '';
  }
  control.addEventListener('change', () => {
    const nextValue = type === 'checkbox' ? control.checked
      : type === 'number' ? Number(control.value)
        : control.value;
    onChange(nextValue);
  });
  wrapper.append(control);
  parent.append(wrapper);
  return control;
}

function propertyGroup(documentRef, title, className = '') {
  const group = element(documentRef, 'section', undefined, {
    className: `studio-property-group${className ? ` ${className}` : ''}`
  });
  group.append(element(documentRef, 'h3', title));
  return group;
}

function actionButton(documentRef, parent, label, action, { disabled = false } = {}) {
  const button = element(documentRef, 'button', label, { type: 'button' });
  button.disabled = disabled;
  button.addEventListener('click', action);
  parent.append(button);
  return button;
}

function renderObjectHelpers({ documentRef, inspector, sceneIndex, envelope }) {
  const helpers = propertyGroup(documentRef, 'Arrange', 'studio-object-helpers');
  helpers.setAttribute('aria-label', 'Object commands');
  const commands = element(documentRef, 'div', undefined, { className: 'studio-object-commands' });
  actionButton(documentRef, commands, 'Duplicate', () => executeStoryCommand('duplicate-object', { sceneIndex, id: envelope.id }));
  const remove = actionButton(documentRef, commands, 'Delete', () => executeStoryCommand('delete-object', { sceneIndex, id: envelope.id }));
  remove.className = 'is-destructive';
  actionButton(documentRef, commands, 'Bring forward', () => executeStoryCommand('bring-forward', { sceneIndex, id: envelope.id }));
  actionButton(documentRef, commands, 'Send backward', () => executeStoryCommand('send-backward', { sceneIndex, id: envelope.id }));
  const alignment = element(documentRef, 'div', undefined, { className: 'studio-align-commands' });
  const enough = selectedOverlayIds.length >= 2;
  for (const [label, value] of [
    ['Align Left', 'left'], ['Align Center', 'center'], ['Align Right', 'right'],
    ['Align Top', 'top'], ['Align Middle', 'middle'], ['Align Bottom', 'bottom']
  ]) {
    actionButton(documentRef, alignment, label, () => executeStoryCommand('align-objects', {
      sceneIndex,
      ids: [...selectedOverlayIds],
      alignment: value
    }), { disabled: !enough });
  }
  helpers.append(commands, alignment);
  inspector.append(helpers);
}

function renderTextProperties({ documentRef, inspector, sceneIndex, envelope }) {
  const appearance = resolveStory12Appearance(envelope);
  const propertiesHeading = element(documentRef, 'h2', 'Properties');
  const selectionLabel = selectedOverlayIds.length > 1
    ? `Text · ${selectedOverlayIds.length} objects selected`
    : deriveStudioObjectLabel(envelope);
  const objectLabel = element(documentRef, 'p', selectionLabel, { className: 'studio-selection-label' });
  inspector.replaceChildren(propertiesHeading, objectLabel);

  const textGroup = propertyGroup(documentRef, 'Text');
  const content = addControl(documentRef, textGroup, {
    label: 'Content', id: 'studio-text-content', value: envelope.block.text,
    onChange: (text) => executeStoryCommand('edit-text', { sceneIndex, id: envelope.id, text })
  });
  content.parentElement?.classList?.add?.('studio-property--wide');
  addControl(documentRef, textGroup, {
    label: 'Font', id: 'studio-text-font', value: appearance.text.fontFamily,
    options: STORY_12_FONT_FAMILIES,
    onChange: (fontFamily) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { fontFamily } })
  });
  addControl(documentRef, textGroup, {
    label: 'Font size', id: 'studio-text-font-size', type: 'number', value: appearance.text.fontSize,
    onChange: (fontSize) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { fontSize } })
  });
  addControl(documentRef, textGroup, {
    label: 'Bold', id: 'studio-text-bold', type: 'checkbox', checked: appearance.text.bold,
    onChange: (bold) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { bold } })
  });
  addControl(documentRef, textGroup, {
    label: 'Italic', id: 'studio-text-italic', type: 'checkbox', checked: appearance.text.italic,
    onChange: (italic) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { italic } })
  });
  addControl(documentRef, textGroup, {
    label: 'Text color', id: 'studio-text-color', value: appearance.text.color,
    onChange: (color) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { color } })
  });
  addControl(documentRef, textGroup, {
    label: 'Alignment', id: 'studio-text-align', value: appearance.text.align,
    options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }],
    onChange: (align) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { align } })
  });
  addControl(documentRef, textGroup, {
    label: 'Line spacing', id: 'studio-text-line-height', type: 'number', value: appearance.text.lineHeight,
    onChange: (lineHeight) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { lineHeight } })
  });

  const appearanceGroup = propertyGroup(documentRef, 'Appearance');
  addControl(documentRef, appearanceGroup, {
    label: 'Fill', id: 'studio-box-fill', value: appearance.box.fill,
    onChange: (fill) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { fill } })
  });
  addControl(documentRef, appearanceGroup, {
    label: 'Opacity', id: 'studio-box-opacity', type: 'number', value: appearance.box.opacity,
    onChange: (opacity) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { opacity } })
  });
  addControl(documentRef, appearanceGroup, {
    label: 'Border color', id: 'studio-box-border-color', value: appearance.box.borderColor,
    onChange: (borderColor) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { borderColor } })
  });
  addControl(documentRef, appearanceGroup, {
    label: 'Border width', id: 'studio-box-border-width', type: 'number', value: appearance.box.borderWidth,
    onChange: (borderWidth) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { borderWidth } })
  });
  addControl(documentRef, appearanceGroup, {
    label: 'Corner radius', id: 'studio-box-radius', type: 'number', value: appearance.box.radius,
    onChange: (radius) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { radius } })
  });
  addControl(documentRef, appearanceGroup, {
    label: 'Padding', id: 'studio-box-padding', type: 'number', value: appearance.box.padding,
    onChange: (padding) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { padding } })
  });
  const z = element(documentRef, 'output', `Z order · ${envelope.frame.z}`, { id: 'studio-z-order' });
  appearanceGroup.append(z);
  inspector.append(textGroup, appearanceGroup);
  renderObjectHelpers({ documentRef, inspector, sceneIndex, envelope });
}

function renderRichProperties({ documentRef, inspector, sceneIndex, envelope, catalogs }) {
  const block = envelope.block;
  const label = block.type === 'stat-group' ? 'Metric' : `${block.type[0].toUpperCase()}${block.type.slice(1)}`;
  inspector.replaceChildren(
    element(documentRef, 'h2', 'Properties'),
    element(documentRef, 'p', deriveStudioObjectLabel(envelope), { className: 'studio-selection-label' })
  );
  const group = propertyGroup(documentRef, label);
  const commit = (update) => executeStoryCommand('edit-rich-block', {
    sceneIndex, id: envelope.id, block: update(clone(block))
  });
  if (block.type === 'stat-group') {
    addControl(documentRef, group, {
      label: 'Label', id: 'studio-metric-label', value: block.items[0].label,
      onChange: (value) => commit((next) => { next.items[0].label = value; return next; })
    });
    addControl(documentRef, group, {
      label: 'Metric', id: 'studio-metric-id', value: block.items[0].metric,
      options: catalogs.metrics?.map(({ id }) => id) ?? [block.items[0].metric],
      onChange: (value) => commit((next) => {
        const metric = catalogs.metrics?.find(({ id }) => id === value);
        next.items[0].metric = value;
        if (metric?.format) next.items[0].format = clone(metric.format);
        return next;
      })
    });
  } else if (block.type === 'chart') {
    addControl(documentRef, group, {
      label: 'Title', id: 'studio-chart-title', value: block.title,
      onChange: (value) => commit((next) => { next.title = value; return next; })
    });
    addControl(documentRef, group, {
      label: 'Chart type', id: 'studio-chart-type', value: block.chartType, options: ['bar', 'line', 'area'],
      onChange: (value) => commit((next) => { next.chartType = value; if (value !== 'bar') delete next.stacked; return next; })
    });
  } else if (block.type === 'table') {
    addControl(documentRef, group, {
      label: 'Title', id: 'studio-table-title', value: block.title ?? '',
      onChange: (value) => commit((next) => { if (value) next.title = value; else delete next.title; return next; })
    });
  } else if (block.type === 'image') {
    addControl(documentRef, group, {
      label: 'Image', id: 'studio-image-asset', value: block.asset,
      options: catalogs.assets?.map((asset) => typeof asset === 'string' ? asset : asset.id) ?? [block.asset],
      onChange: (value) => commit((next) => { next.asset = value; return next; })
    });
    addControl(documentRef, group, {
      label: 'Decorative', id: 'studio-image-decorative', type: 'checkbox', checked: block.decorative,
      onChange: (value) => commit((next) => { if (value) { next.decorative = true; next.alt = ''; } else delete next.decorative; return next; })
    });
    addControl(documentRef, group, {
      label: 'Alternative text', id: 'studio-image-alt', value: block.alt,
      onChange: (value) => commit((next) => { next.alt = value; if (value) delete next.decorative; return next; })
    });
  } else if (block.type === 'legend') {
    addControl(documentRef, group, {
      label: 'Item label', id: 'studio-legend-label', value: block.items[0].label,
      onChange: (value) => commit((next) => { next.items[0].label = value; return next; })
    });
    addControl(documentRef, group, {
      label: 'Sample', id: 'studio-legend-sample', value: block.items[0].sample, options: ['swatch', 'line', 'icon'],
      onChange: (value) => commit((next) => {
        next.items[0].sample = value;
        if (value === 'icon') { delete next.items[0].color; next.items[0].asset = catalogs.assets?.[0]?.id ?? catalogs.assets?.[0]; }
        else { delete next.items[0].asset; next.items[0].color ??= '#000000'; }
        return next;
      })
    });
  }
  inspector.append(group);
  renderObjectHelpers({ documentRef, inspector, sceneIndex, envelope });
}

function renderCameraProperties({ documentRef, active, sceneIndex, workingCamera }) {
  const cameraGroup = propertyGroup(documentRef, 'Camera');
  const cameraChanged = workingCamera && !cameraEqual(workingCamera, active.map.camera);
  const cameraStatus = element(documentRef, 'p', cameraChanged ? 'Camera changed · not captured' : 'Camera matches saved Scene', {
    id: 'studio-camera-status', role: 'status', 'aria-live': 'polite'
  });
  const capture = element(documentRef, 'button', 'Capture Camera', { type: 'button', id: 'studio-camera-capture' });
  capture.disabled = !workingCamera || !cameraChanged;
  capture.addEventListener('click', () => executeStoryCommand('capture-camera', { sceneIndex, camera: workingCamera }));
  const restore = element(documentRef, 'button', 'Restore Saved Camera', { type: 'button', id: 'studio-camera-restore' });
  restore.disabled = !cameraChanged;
  restore.addEventListener('click', () => activeStudio.onPreviewCommand('restore-scene-camera', { index: sceneIndex }));
  cameraGroup.append(cameraStatus, capture, restore);
  return cameraGroup;
}

function renderSceneProperties({ documentRef, inspector, active, sceneIndex, workingCamera }) {
  const propertiesHeading = element(documentRef, 'h2', 'Properties');
  const sceneGroup = propertyGroup(documentRef, 'Scene');
  const interactionLabel = element(documentRef, 'label', 'Interaction');
  const interaction = element(documentRef, 'select', undefined, { id: 'studio-scene-interaction' });
  for (const { value, label } of [
    { value: 'locked', label: 'Locked map' },
    { value: 'zoom-only', label: 'Zoom only' },
    { value: 'explore', label: 'Free explore' }
  ]) {
    const option = element(documentRef, 'option', label, { value });
    option.value = value;
    option.selected = active.map.interaction === value;
    interaction.append(option);
  }
  interaction.value = active.map.interaction;
  interaction.addEventListener('change', () => executeStoryCommand('set-interaction', { sceneIndex, interaction: interaction.value }));
  interactionLabel.append(interaction);

  const transitionLabel = element(documentRef, 'label', 'Transition');
  const transition = element(documentRef, 'select', undefined, { id: 'studio-scene-transition' });
  for (const { value, label } of [
    { value: 'fly', label: 'Fly' },
    { value: 'ease', label: 'Smooth' },
    { value: 'instant', label: 'Instant' }
  ]) {
    const option = element(documentRef, 'option', label, { value });
    option.value = value;
    option.selected = active.map.transition.type === value;
    transition.append(option);
  }
  transition.value = active.map.transition.type;
  transition.addEventListener('change', () => executeStoryCommand('set-transition', {
    sceneIndex,
    transition: { type: transition.value, durationMs: transition.value === 'instant' ? 0 : active.map.transition.durationMs }
  }));
  transitionLabel.append(transition);
  sceneGroup.append(interactionLabel, transitionLabel);

  const cameraGroup = renderCameraProperties({ documentRef, active, sceneIndex, workingCamera });
  inspector.replaceChildren(propertiesHeading, sceneGroup, cameraGroup);
}

export function mountStudioShell({
  documentRef = document,
  navigation,
  inspector,
  scenesHost,
  previewToolbar,
  manifest,
  story,
  catalogs = {},
  sceneIndex = 0,
  workingCamera = null,
  selectedOverlayId: requestedSelection,
  onSelectScene = () => {},
  onSelectOverlay = () => {},
  onRenderLayerProperties = () => {},
  onAddData = () => {},
  onReplaceData = () => {},
  onStoryCommand = () => {},
  onRequestInsert = (_kind, insert) => insert(),
  onPreviewCommand = () => {},
  onOutputPreview = () => {}
} = {}) {
  if (!navigation?.replaceChildren || !inspector?.replaceChildren || !scenesHost?.replaceChildren) {
    throw new TypeError('Studio shell requires Layers, Properties, and Scenes hosts.');
  }
  const active = story.states[sceneIndex];
  if (!active) throw new RangeError(`Unknown active Scene index: ${sceneIndex}.`);
  if (requestedSelection !== undefined) {
    selectedOverlayId = requestedSelection;
    selectedOverlayIds = requestedSelection ? [requestedSelection] : [];
    selectedLayerId = null;
  }

  activeStudio = {
    documentRef, navigation, inspector, scenesHost, previewToolbar,
    manifest, story, catalogs, sceneIndex, workingCamera,
    onSelectScene, onSelectOverlay, onRenderLayerProperties, onAddData, onReplaceData,
    onStoryCommand, onRequestInsert, onPreviewCommand, onOutputPreview
  };
  normalizeSelection();
  ensureHistory(activeStudio);
  bindHistoryButtons(documentRef);

  const layersHeading = element(documentRef, 'h2', 'Layers');
  const layers = element(documentRef, 'div', undefined, { className: 'studio-layers' });
  const sceneLayerIds = Object.keys(active.map.layerVisibility);
  for (const datasetId of sceneLayerIds) {
    const descriptor = manifest.datasets?.[datasetId];
    const humanLabel = descriptor?.label ?? readableId(datasetId) ?? datasetId;
    const row = element(documentRef, 'div', undefined, {
      className: `studio-layer${selectedLayerId === datasetId ? ' is-current' : ''}`
    });
    const visibility = element(documentRef, 'label', undefined, { className: 'studio-layer-visibility' });
    const input = element(documentRef, 'input', undefined, {
      type: 'checkbox', checked: active.map.layerVisibility[datasetId],
      'aria-label': `Show ${humanLabel}`
    });
    input.addEventListener('change', () => executeStoryCommand('set-layer-visibility', {
      sceneIndex, datasetId, visible: input.checked
    }));
    visibility.append(input, element(documentRef, 'span', 'Visible', { className: 'visually-hidden' }));
    const select = element(documentRef, 'button', humanLabel, {
      type: 'button', className: 'studio-layer-select',
      'aria-pressed': String(selectedLayerId === datasetId), title: `Layer ID: ${datasetId}`
    });
    select.addEventListener('click', () => selectLayer(datasetId));
    const catalogItem = catalogs.datasets?.find(({ id }) => id === datasetId);
    const family = readableId(catalogItem?.geometry ?? descriptor?.geometry ?? '');
    const featureCount = catalogItem?.featureCount;
    const summary = Number.isInteger(featureCount)
      ? `${family} · ${featureCount} ${featureCount === 1 ? 'feature' : 'features'}`
      : family;
    const details = element(documentRef, 'div', undefined, { className: 'studio-layer-details' });
    details.append(select);
    if (summary) details.append(element(documentRef, 'span', summary, { className: 'studio-layer-summary' }));
    row.append(visibility, details);
    layers.append(row);
  }
  if (!sceneLayerIds.length) layers.append(element(documentRef, 'p', 'No map layers yet.'));
  const addData = element(documentRef, 'button', '+ Add data', { type: 'button', className: 'studio-add-data' });
  addData.addEventListener('click', () => onAddData());
  layers.append(addData);

  const insertHeading = element(documentRef, 'h2', 'Insert');
  const addMenu = element(documentRef, 'div', undefined, { className: 'studio-add-menu' });
  const addHeading = element(documentRef, 'button', 'Heading', { type: 'button', title: 'Add heading text' });
  addHeading.addEventListener('click', () => executeStoryCommand('add-text', { sceneIndex, kind: 'heading' }));
  const addBody = element(documentRef, 'button', 'Body text', { type: 'button', title: 'Add body text' });
  addBody.addEventListener('click', () => executeStoryCommand('add-text', { sceneIndex, kind: 'body' }));
  addMenu.append(addHeading, addBody);
  for (const [label, kind] of [
    ['Metric', 'metric'], ['Chart', 'chart'], ['Table', 'table'], ['Image', 'image'], ['Legend', 'legend']
  ]) {
    const button = element(documentRef, 'button', label, { type: 'button', title: `Add ${label.toLowerCase()}` });
    button.addEventListener('click', () => {
      if (kind === 'legend') {
        executeStoryCommand('add-rich-object', { sceneIndex, kind, catalogs });
        return;
      }
      onRequestInsert(kind, (selection = {}, refreshedCatalogs = activeStudio?.catalogs ?? catalogs) => (
        executeStoryCommand('add-rich-object', { sceneIndex, kind, catalogs: refreshedCatalogs, ...selection })
      ));
    });
    addMenu.append(button);
  }
  const objectsHeading = element(documentRef, 'h2', 'Objects');
  const objects = element(documentRef, 'div', undefined, { className: 'studio-object-list' });
  for (const envelope of active.content.blocks) {
    const objectButton = element(documentRef, 'button', deriveStudioObjectLabel(envelope), {
      type: 'button', className: selectedOverlayIds.includes(envelope.id) ? 'is-current' : '',
      title: `Object ID: ${envelope.id}`,
      'aria-pressed': String(selectedOverlayIds.includes(envelope.id))
    });
    objectButton.addEventListener('click', (event) => selectOverlay(envelope.id, {
      notify: true,
      additive: Boolean(event.shiftKey)
    }));
    objects.append(objectButton);
  }
  if (!active.content.blocks.length) objects.append(element(documentRef, 'p', 'No objects in this Scene.'));
  navigation.replaceChildren(layersHeading, layers, insertHeading, addMenu, objectsHeading, objects);

  const selected = selectedEnvelope(story, sceneIndex, selectedOverlayId);
  if (['heading', 'paragraph'].includes(selected?.block?.type)) renderTextProperties({ documentRef, inspector, sceneIndex, envelope: selected });
  else if (selected) renderRichProperties({ documentRef, inspector, sceneIndex, envelope: selected, catalogs });
  else if (selectedLayerId) {
    inspector.replaceChildren(
      element(documentRef, 'h2', 'Properties'),
      element(documentRef, 'p', `Layer · ${manifest.datasets?.[selectedLayerId]?.label ?? readableId(selectedLayerId)}`, { className: 'studio-selection-label' })
    );
    onRenderLayerProperties(selectedLayerId, inspector);
    const replaceData = element(documentRef, 'button', 'Replace data…', { type: 'button', className: 'studio-replace-data' });
    replaceData.addEventListener('click', () => onReplaceData(selectedLayerId));
    inspector.append(replaceData);
    inspector.append(renderCameraProperties({ documentRef, active, sceneIndex, workingCamera }));
  }
  else renderSceneProperties({ documentRef, inspector, active, sceneIndex, workingCamera });

  if (previewToolbar?.replaceChildren) {
    const canvasLabel = element(documentRef, 'strong', 'Live Scene · 16:9', { className: 'studio-canvas-label' });
    const modes = element(documentRef, 'div', undefined, { className: 'studio-mode-switch', 'aria-label': 'Canvas authoring mode' });
    const select = element(documentRef, 'button', 'Select', { type: 'button', id: 'studio-mode-select', 'aria-pressed': String(authoringMode === 'select') });
    const map = element(documentRef, 'button', 'Map', { type: 'button', id: 'studio-mode-map', 'aria-pressed': String(authoringMode === 'map') });
    const chooseMode = (mode) => {
      authoringMode = mode;
      select.setAttribute('aria-pressed', String(mode === 'select'));
      map.setAttribute('aria-pressed', String(mode === 'map'));
      onPreviewCommand('authoring-mode', { mode });
    };
    select.addEventListener('click', () => chooseMode('select'));
    map.addEventListener('click', () => chooseMode('map'));
    modes.append(select, map);
    previewToolbar.replaceChildren(canvasLabel, modes);
  }

  const scenesHeading = element(documentRef, 'h2', 'Scenes');
  const sceneList = element(documentRef, 'div', undefined, { className: 'studio-scene-list', role: 'list' });
  story.states.forEach((scene, index) => {
    const sceneLabel = deriveStudioSceneLabel(scene, index);
    const button = element(documentRef, 'button', undefined, {
      type: 'button', role: 'listitem', className: index === sceneIndex ? 'is-current' : '',
      'aria-current': index === sceneIndex ? 'true' : 'false',
      'aria-label': `Scene ${index + 1}: ${sceneLabel}`, title: `Scene ID: ${scene.id}`
    });
    button.append(
      element(documentRef, 'span', String(index + 1).padStart(2, '0'), { className: 'studio-scene-ordinal' }),
      element(documentRef, 'span', sceneLabel, { className: 'studio-scene-label' })
    );
    button.addEventListener('click', () => {
      selectedOverlayId = null;
      selectedOverlayIds = [];
      selectedLayerId = null;
      onSelectScene(index);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' && index > 0) { selectedOverlayId = null; selectedOverlayIds = []; selectedLayerId = null; onSelectScene(index - 1); }
      if (event.key === 'ArrowRight' && index < story.states.length - 1) { selectedOverlayId = null; selectedOverlayIds = []; selectedLayerId = null; onSelectScene(index + 1); }
    });
    sceneList.append(button);
  });
  const commands = element(documentRef, 'div', undefined, { className: 'studio-scene-commands' });
  const command = (label, name, payload, disabled = false) => {
    const button = element(documentRef, 'button', label, { type: 'button' });
    button.disabled = disabled;
    button.addEventListener('click', () => executeStoryCommand(name, payload));
    commands.append(button);
  };
  command('+ Add Scene', 'add-scene', { sceneIndex });
  command('Duplicate', 'duplicate-scene', { sceneIndex });
  command('Delete', 'delete-scene', { sceneIndex }, story.states.length === 1);
  command('Move previous', 'move-scene', { from: sceneIndex, to: sceneIndex - 1 }, sceneIndex === 0);
  command('Move next', 'move-scene', { from: sceneIndex, to: sceneIndex + 1 }, sceneIndex === story.states.length - 1);
  scenesHost.hidden = false;
  scenesHost.replaceChildren(scenesHeading, sceneList, commands);

  onPreviewCommand('authoring-selection', {
    id: authoringMode === 'select' && selectedOverlayIds.length === 1 ? selectedOverlayId : null
  });
  updateHistoryButtons();
  return Object.freeze({ sceneIndex, selectedLayerId, selectedOverlayId, selectedOverlayIds: Object.freeze([...selectedOverlayIds]), history: activeHistory?.status?.() });
}

export function resetStudioAuthoringSession() {
  activeStudio = null;
  activeHistory = null;
  activeHistoryKey = null;
  selectedOverlayId = null;
  selectedOverlayIds = [];
  selectedLayerId = null;
  authoringMode = 'select';
}
