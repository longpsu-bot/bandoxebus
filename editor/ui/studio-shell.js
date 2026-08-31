import { createHistory } from '../core/history.js';
import {
  addProjectLayerToStory12,
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

let activeStudio = null;
let activeHistory = null;
let activeHistoryKey = null;
let selectedOverlayId = null;
let selectedOverlayIds = [];
let authoringMode = 'select';

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

function cameraEqual(left, right) {
  return Boolean(left && right)
    && left.zoom === right.zoom && left.pitch === right.pitch && left.bearing === right.bearing
    && left.center?.length === 2 && right.center?.length === 2
    && left.center[0] === right.center[0] && left.center[1] === right.center[1];
}

function textEnvelope(story, sceneIndex, id) {
  if (!id) return null;
  const envelope = story.states[sceneIndex]?.content?.blocks?.find((item) => item.id === id) ?? null;
  return ['heading', 'paragraph'].includes(envelope?.block?.type) ? envelope : null;
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

  if (name === 'add-text' || name === 'duplicate-object') {
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
    activeStudio.onSelectScene(nextSceneIndex);
  } else {
    rerenderActive();
  }
  return next;
}

function selectOverlay(id, { notify = true, additive = false } = {}) {
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
    for (const optionValue of options) {
      const option = element(documentRef, 'option', optionValue, { value: optionValue });
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

function actionButton(documentRef, parent, label, action, { disabled = false } = {}) {
  const button = element(documentRef, 'button', label, { type: 'button' });
  button.disabled = disabled;
  button.addEventListener('click', action);
  parent.append(button);
  return button;
}

function renderObjectHelpers({ documentRef, inspector, sceneIndex, envelope }) {
  const helpers = element(documentRef, 'section', undefined, { className: 'studio-object-helpers', 'aria-label': 'Object commands' });
  actionButton(documentRef, helpers, 'Duplicate', () => executeStoryCommand('duplicate-object', { sceneIndex, id: envelope.id }));
  actionButton(documentRef, helpers, 'Delete', () => executeStoryCommand('delete-object', { sceneIndex, id: envelope.id }));
  actionButton(documentRef, helpers, 'Bring Forward', () => executeStoryCommand('bring-forward', { sceneIndex, id: envelope.id }));
  actionButton(documentRef, helpers, 'Send Backward', () => executeStoryCommand('send-backward', { sceneIndex, id: envelope.id }));
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
  helpers.append(alignment);
  inspector.append(helpers);
}

function renderTextProperties({ documentRef, inspector, sceneIndex, envelope }) {
  const appearance = resolveStory12Appearance(envelope);
  const propertiesHeading = element(documentRef, 'h2', 'Properties');
  const selectionLabel = selectedOverlayIds.length > 1
    ? `Text · ${selectedOverlayIds.length} objects selected`
    : `Text · ${envelope.id}`;
  const objectLabel = element(documentRef, 'p', selectionLabel, { className: 'studio-selection-label' });
  inspector.replaceChildren(propertiesHeading, objectLabel);

  addControl(documentRef, inspector, {
    label: 'Text', id: 'studio-text-content', value: envelope.block.text,
    onChange: (text) => executeStoryCommand('edit-text', { sceneIndex, id: envelope.id, text })
  });
  addControl(documentRef, inspector, {
    label: 'Font', id: 'studio-text-font', value: appearance.text.fontFamily,
    options: STORY_12_FONT_FAMILIES,
    onChange: (fontFamily) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { fontFamily } })
  });
  addControl(documentRef, inspector, {
    label: 'Font size', id: 'studio-text-font-size', type: 'number', value: appearance.text.fontSize,
    onChange: (fontSize) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { fontSize } })
  });
  addControl(documentRef, inspector, {
    label: 'Bold', id: 'studio-text-bold', type: 'checkbox', checked: appearance.text.bold,
    onChange: (bold) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { bold } })
  });
  addControl(documentRef, inspector, {
    label: 'Italic', id: 'studio-text-italic', type: 'checkbox', checked: appearance.text.italic,
    onChange: (italic) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { italic } })
  });
  addControl(documentRef, inspector, {
    label: 'Text color', id: 'studio-text-color', value: appearance.text.color,
    onChange: (color) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { color } })
  });
  addControl(documentRef, inspector, {
    label: 'Alignment', id: 'studio-text-align', value: appearance.text.align,
    options: ['left', 'center', 'right'],
    onChange: (align) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { align } })
  });
  addControl(documentRef, inspector, {
    label: 'Line spacing', id: 'studio-text-line-height', type: 'number', value: appearance.text.lineHeight,
    onChange: (lineHeight) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, text: { lineHeight } })
  });
  addControl(documentRef, inspector, {
    label: 'Fill', id: 'studio-box-fill', value: appearance.box.fill,
    onChange: (fill) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { fill } })
  });
  addControl(documentRef, inspector, {
    label: 'Opacity', id: 'studio-box-opacity', type: 'number', value: appearance.box.opacity,
    onChange: (opacity) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { opacity } })
  });
  addControl(documentRef, inspector, {
    label: 'Border color', id: 'studio-box-border-color', value: appearance.box.borderColor,
    onChange: (borderColor) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { borderColor } })
  });
  addControl(documentRef, inspector, {
    label: 'Border width', id: 'studio-box-border-width', type: 'number', value: appearance.box.borderWidth,
    onChange: (borderWidth) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { borderWidth } })
  });
  addControl(documentRef, inspector, {
    label: 'Corner radius', id: 'studio-box-radius', type: 'number', value: appearance.box.radius,
    onChange: (radius) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { radius } })
  });
  addControl(documentRef, inspector, {
    label: 'Padding', id: 'studio-box-padding', type: 'number', value: appearance.box.padding,
    onChange: (padding) => executeStoryCommand('set-appearance', { sceneIndex, id: envelope.id, box: { padding } })
  });
  const z = element(documentRef, 'output', `Z order · ${envelope.frame.z}`, { id: 'studio-z-order' });
  inspector.append(z);
  renderObjectHelpers({ documentRef, inspector, sceneIndex, envelope });
}

function renderSceneProperties({ documentRef, inspector, active, sceneIndex, workingCamera }) {
  const propertiesHeading = element(documentRef, 'h2', 'Properties');
  const interactionLabel = element(documentRef, 'label', 'Interaction');
  const interaction = element(documentRef, 'select', undefined, { id: 'studio-scene-interaction' });
  for (const value of ['locked', 'zoom-only', 'explore']) {
    const option = element(documentRef, 'option', value, { value });
    option.value = value;
    option.selected = active.map.interaction === value;
    interaction.append(option);
  }
  interaction.value = active.map.interaction;
  interaction.addEventListener('change', () => executeStoryCommand('set-interaction', { sceneIndex, interaction: interaction.value }));
  interactionLabel.append(interaction);

  const transitionLabel = element(documentRef, 'label', 'Transition');
  const transition = element(documentRef, 'select', undefined, { id: 'studio-scene-transition' });
  for (const value of ['fly', 'ease', 'instant']) {
    const option = element(documentRef, 'option', value, { value });
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
  inspector.replaceChildren(propertiesHeading, interactionLabel, transitionLabel, cameraStatus, capture, restore);
}

export function mountStudioShell({
  documentRef = document,
  navigation,
  inspector,
  scenesHost,
  previewToolbar,
  manifest,
  story,
  sceneIndex = 0,
  workingCamera = null,
  selectedOverlayId: requestedSelection,
  onSelectScene = () => {},
  onSelectOverlay = () => {},
  onStoryCommand = () => {},
  onPreviewCommand = () => {}
} = {}) {
  if (!navigation?.replaceChildren || !inspector?.replaceChildren || !scenesHost?.replaceChildren) {
    throw new TypeError('Studio shell requires Layers, Properties, and Scenes hosts.');
  }
  const active = story.states[sceneIndex];
  if (!active) throw new RangeError(`Unknown active Scene index: ${sceneIndex}.`);
  if (requestedSelection !== undefined) {
    selectedOverlayId = requestedSelection;
    selectedOverlayIds = requestedSelection ? [requestedSelection] : [];
  }

  activeStudio = {
    documentRef, navigation, inspector, scenesHost, previewToolbar,
    manifest, story, sceneIndex, workingCamera,
    onSelectScene, onSelectOverlay, onStoryCommand, onPreviewCommand
  };
  normalizeSelection();
  ensureHistory(activeStudio);
  bindHistoryButtons(documentRef);

  const layersHeading = element(documentRef, 'h2', 'Layers');
  const layers = element(documentRef, 'div', undefined, { className: 'studio-layers' });
  const sceneLayerIds = Object.keys(active.map.layerVisibility);
  for (const datasetId of sceneLayerIds) {
    const label = element(documentRef, 'label', undefined, { className: 'studio-layer' });
    const input = element(documentRef, 'input', undefined, { type: 'checkbox', checked: active.map.layerVisibility[datasetId] });
    input.addEventListener('change', () => executeStoryCommand('set-layer-visibility', {
      sceneIndex, datasetId, visible: input.checked
    }));
    label.append(input, element(documentRef, 'span', manifest.datasets?.[datasetId]?.label ?? datasetId));
    layers.append(label);
  }
  if (!sceneLayerIds.length) layers.append(element(documentRef, 'p', 'No map layers yet.'));

  const textHeading = element(documentRef, 'h2', 'Text');
  const addMenu = element(documentRef, 'div', undefined, { className: 'studio-add-menu' });
  const addHeading = element(documentRef, 'button', 'Add Heading', { type: 'button' });
  addHeading.addEventListener('click', () => executeStoryCommand('add-text', { sceneIndex, kind: 'heading' }));
  const addBody = element(documentRef, 'button', 'Add Body Text', { type: 'button' });
  addBody.addEventListener('click', () => executeStoryCommand('add-text', { sceneIndex, kind: 'body' }));
  addMenu.append(addHeading, addBody);
  const objects = element(documentRef, 'div', undefined, { className: 'studio-object-list' });
  for (const envelope of active.content.blocks.filter(({ block }) => ['heading', 'paragraph'].includes(block?.type))) {
    const objectButton = element(documentRef, 'button', envelope.id, {
      type: 'button', className: selectedOverlayIds.includes(envelope.id) ? 'is-current' : ''
    });
    objectButton.addEventListener('click', (event) => selectOverlay(envelope.id, {
      notify: true,
      additive: Boolean(event.shiftKey)
    }));
    objects.append(objectButton);
  }
  navigation.replaceChildren(layersHeading, layers, textHeading, addMenu, objects);

  const selected = textEnvelope(story, sceneIndex, selectedOverlayId);
  if (selected) renderTextProperties({ documentRef, inspector, sceneIndex, envelope: selected });
  else renderSceneProperties({ documentRef, inspector, active, sceneIndex, workingCamera });

  if (previewToolbar?.replaceChildren) {
    const canvasLabel = element(documentRef, 'strong', 'Canvas · 16:9 live map');
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
    previewToolbar.replaceChildren(canvasLabel, select, map);
  }

  const scenesHeading = element(documentRef, 'h2', 'Scenes');
  const sceneList = element(documentRef, 'div', undefined, { className: 'studio-scene-list', role: 'list' });
  story.states.forEach((scene, index) => {
    const button = element(documentRef, 'button', `${String(index + 1).padStart(2, '0')} · ${scene.id}`, {
      type: 'button', role: 'listitem', className: index === sceneIndex ? 'is-current' : '',
      'aria-current': index === sceneIndex ? 'true' : 'false'
    });
    button.addEventListener('click', () => {
      selectedOverlayId = null;
      selectedOverlayIds = [];
      onSelectScene(index);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' && index > 0) { selectedOverlayId = null; selectedOverlayIds = []; onSelectScene(index - 1); }
      if (event.key === 'ArrowRight' && index < story.states.length - 1) { selectedOverlayId = null; selectedOverlayIds = []; onSelectScene(index + 1); }
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
  command('Add Scene', 'add-scene', { sceneIndex });
  command('Duplicate Scene', 'duplicate-scene', { sceneIndex });
  command('Delete Scene', 'delete-scene', { sceneIndex }, story.states.length === 1);
  command('Move Scene Up', 'move-scene', { from: sceneIndex, to: sceneIndex - 1 }, sceneIndex === 0);
  command('Move Scene Down', 'move-scene', { from: sceneIndex, to: sceneIndex + 1 }, sceneIndex === story.states.length - 1);
  scenesHost.hidden = false;
  scenesHost.replaceChildren(scenesHeading, sceneList, commands);

  updateHistoryButtons();
  return Object.freeze({ sceneIndex, selectedOverlayId, selectedOverlayIds: Object.freeze([...selectedOverlayIds]), history: activeHistory?.status?.() });
}

export function resetStudioAuthoringSession() {
  activeStudio = null;
  activeHistory = null;
  activeHistoryKey = null;
  selectedOverlayId = null;
  selectedOverlayIds = [];
  authoringMode = 'select';
}
