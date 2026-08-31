import {
  addProjectLayerToStory12,
  addScene12,
  captureSceneCamera,
  deleteScene12,
  duplicateScene12,
  moveScene12,
  setSceneInteraction,
  setSceneLayerVisibility,
  setSceneTransition
} from '../core/scene-commands.js';

function element(documentRef, tag, text, attributes = {}) {
  const node = documentRef.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else if (key === 'checked') node.checked = value;
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

export function applyStudioStoryCommand(story, name, payload = {}) {
  if (name === 'add-scene') return addScene12(story, { activeSceneIndex: payload.sceneIndex });
  if (name === 'duplicate-scene') return duplicateScene12(story, payload.sceneIndex);
  if (name === 'delete-scene') return deleteScene12(story, payload.sceneIndex);
  if (name === 'move-scene') return moveScene12(story, payload.from, payload.to);
  if (name === 'set-layer-visibility') return setSceneLayerVisibility(story, payload);
  if (name === 'capture-camera') return captureSceneCamera(story, payload);
  if (name === 'set-interaction') return setSceneInteraction(story, payload);
  if (name === 'set-transition') return setSceneTransition(story, payload);
  if (name === 'add-project-layer') return addProjectLayerToStory12(story, payload.datasetId, { activeSceneIndex: payload.sceneIndex });
  throw new TypeError(`Unknown Studio Story command: ${name}.`);
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
  onSelectScene = () => {},
  onStoryCommand = () => {},
  onPreviewCommand = () => {}
} = {}) {
  if (!navigation?.replaceChildren || !inspector?.replaceChildren || !scenesHost?.replaceChildren) {
    throw new TypeError('Studio shell requires Layers, Properties, and Scenes hosts.');
  }
  const active = story.states[sceneIndex];
  if (!active) throw new RangeError(`Unknown active Scene index: ${sceneIndex}.`);

  const layersHeading = element(documentRef, 'h2', 'Layers');
  const layers = element(documentRef, 'div', undefined, { className: 'studio-layers' });
  const sceneLayerIds = Object.keys(active.map.layerVisibility);
  for (const datasetId of sceneLayerIds) {
    const label = element(documentRef, 'label', undefined, { className: 'studio-layer' });
    const input = element(documentRef, 'input', undefined, { type: 'checkbox', checked: active.map.layerVisibility[datasetId] });
    input.addEventListener('change', () => onStoryCommand('set-layer-visibility', {
      sceneIndex, datasetId, visible: input.checked
    }));
    label.append(input, element(documentRef, 'span', manifest.datasets?.[datasetId]?.label ?? datasetId));
    layers.append(label);
  }
  if (!sceneLayerIds.length) layers.append(element(documentRef, 'p', 'No map layers yet.'));
  navigation.replaceChildren(layersHeading, layers);

  const propertiesHeading = element(documentRef, 'h2', 'Properties');
  const interactionLabel = element(documentRef, 'label', 'Interaction');
  const interaction = element(documentRef, 'select', undefined, { id: 'studio-scene-interaction' });
  for (const value of ['locked', 'zoom-only', 'explore']) {
    const option = element(documentRef, 'option', value, { value });
    option.value = value;
    option.selected = active.map.interaction === value;
    interaction.append(option);
  }
  interaction.addEventListener('change', () => onStoryCommand('set-interaction', { sceneIndex, interaction: interaction.value }));
  interactionLabel.append(interaction);

  const transitionLabel = element(documentRef, 'label', 'Transition');
  const transition = element(documentRef, 'select', undefined, { id: 'studio-scene-transition' });
  for (const value of ['fly', 'ease', 'instant']) {
    const option = element(documentRef, 'option', value, { value });
    option.value = value;
    option.selected = active.map.transition.type === value;
    transition.append(option);
  }
  transition.addEventListener('change', () => onStoryCommand('set-transition', {
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
  capture.addEventListener('click', () => onStoryCommand('capture-camera', { sceneIndex, camera: workingCamera }));
  const restore = element(documentRef, 'button', 'Restore Saved Camera', { type: 'button', id: 'studio-camera-restore' });
  restore.disabled = !cameraChanged;
  restore.addEventListener('click', () => onPreviewCommand('restore-scene-camera', { index: sceneIndex }));
  inspector.replaceChildren(propertiesHeading, interactionLabel, transitionLabel, cameraStatus, capture, restore);

  if (previewToolbar?.replaceChildren) {
    const canvasLabel = element(documentRef, 'strong', 'Canvas · 16:9 live map');
    const select = element(documentRef, 'button', 'Select', { type: 'button', id: 'studio-mode-select', 'aria-pressed': 'true' });
    const map = element(documentRef, 'button', 'Map', { type: 'button', id: 'studio-mode-map', 'aria-pressed': 'false' });
    const chooseMode = (mode) => {
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
    button.addEventListener('click', () => onSelectScene(index));
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' && index > 0) onSelectScene(index - 1);
      if (event.key === 'ArrowRight' && index < story.states.length - 1) onSelectScene(index + 1);
    });
    sceneList.append(button);
  });
  const commands = element(documentRef, 'div', undefined, { className: 'studio-scene-commands' });
  const command = (label, name, payload, disabled = false) => {
    const button = element(documentRef, 'button', label, { type: 'button' });
    button.disabled = disabled;
    button.addEventListener('click', () => onStoryCommand(name, payload));
    commands.append(button);
  };
  command('Add Scene', 'add-scene', { sceneIndex });
  command('Duplicate Scene', 'duplicate-scene', { sceneIndex });
  command('Delete Scene', 'delete-scene', { sceneIndex }, story.states.length === 1);
  command('Move Scene Up', 'move-scene', { from: sceneIndex, to: sceneIndex - 1 }, sceneIndex === 0);
  command('Move Scene Down', 'move-scene', { from: sceneIndex, to: sceneIndex + 1 }, sceneIndex === story.states.length - 1);
  scenesHost.hidden = false;
  scenesHost.replaceChildren(scenesHeading, sceneList, commands);

  return Object.freeze({ sceneIndex });
}
