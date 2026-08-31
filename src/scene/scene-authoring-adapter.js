import {
  applySceneOverlayFrame,
  findSceneOverlay,
  readSceneOverlayFrame,
  readSceneRootBounds
} from './scene-compositor.js';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function frameForMove(start, dx, dy, bounds) {
  return {
    ...start,
    x: clamp(start.x + dx / bounds.width, 0, 1 - start.width),
    y: clamp(start.y + dy / bounds.height, 0, 1 - start.height)
  };
}

function frameForResize(start, dx, dy, bounds) {
  return {
    ...start,
    width: clamp(start.width + dx / bounds.width, 0.01, 1 - start.x),
    height: clamp(start.height + dy / bounds.height, 0.01, 1 - start.y)
  };
}

function overlayFromTarget(root, target) {
  let node = target;
  while (node && node !== root) {
    if (node.dataset?.sceneOverlayId) return node;
    node = node.parentNode;
  }
  return null;
}

function contentTarget(overlay) {
  for (const child of overlay?.children ?? []) {
    if (!child?.dataset?.sceneResizeHandle) return child;
  }
  return null;
}

export function createSceneAuthoringAdapter({
  root,
  documentRef = document,
  emit = () => {}
} = {}) {
  if (!root?.addEventListener || !root?.removeEventListener) throw new TypeError('Scene authoring adapter requires a compositor root.');
  if (!documentRef?.createElement) throw new TypeError('Scene authoring adapter requires a document.');
  if (typeof emit !== 'function') throw new TypeError('Scene authoring adapter emit must be a function.');

  let mode = 'select';
  let selectedId = null;
  let handle = null;
  let interaction = null;
  let editing = null;

  function removeHandle() {
    handle?.remove?.();
    handle = null;
  }

  function finishTextEdit(commit) {
    if (!editing) return;
    const current = editing;
    editing = null;
    current.target.removeEventListener?.('blur', current.onBlur);
    current.target.removeEventListener?.('keydown', current.onKeyDown);
    current.target.removeAttribute?.('contenteditable');
    current.target.removeAttribute?.('role');
    if (commit) emit('commit-text', { id: current.id, text: current.target.textContent ?? '' });
  }

  function clearSelection() {
    interaction = null;
    finishTextEdit(false);
    removeHandle();
    selectedId = null;
  }

  function selectOverlay(id) {
    const overlay = findSceneOverlay(root, id);
    if (!overlay) return null;
    if (selectedId !== id) {
      finishTextEdit(false);
      removeHandle();
      selectedId = id;
    }
    if (!handle) {
      handle = documentRef.createElement('button');
      handle.className = 'scene-resize-handle';
      handle.dataset.sceneResizeHandle = 'se';
      handle.setAttribute?.('type', 'button');
      handle.setAttribute?.('aria-label', `Resize ${id}`);
      overlay.append(handle);
    }
    emit('select-overlay', { id });
    return overlay;
  }

  function pointerFrame(event) {
    if (!interaction) return null;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    return interaction.kind === 'resize'
      ? frameForResize(interaction.frame, dx, dy, interaction.bounds)
      : frameForMove(interaction.frame, dx, dy, interaction.bounds);
  }

  function onPointerDown(event) {
    if (mode !== 'select' || editing?.target === event.target) return;
    const overlay = overlayFromTarget(root, event.target);
    if (!overlay) return;
    const id = overlay.dataset.sceneOverlayId;
    selectOverlay(id);
    const frame = readSceneOverlayFrame(root, id);
    const bounds = readSceneRootBounds(root);
    if (!frame || !bounds) return;
    interaction = {
      id,
      pointerId: event.pointerId,
      kind: event.target?.dataset?.sceneResizeHandle ? 'resize' : 'move',
      startX: event.clientX,
      startY: event.clientY,
      frame,
      bounds
    };
    event.preventDefault?.();
  }

  function samePointer(event) {
    return interaction && (interaction.pointerId === undefined || event.pointerId === undefined || event.pointerId === interaction.pointerId);
  }

  function onPointerMove(event) {
    if (!samePointer(event)) return;
    const frame = pointerFrame(event);
    if (!frame) return;
    applySceneOverlayFrame(root, interaction.id, frame);
    event.preventDefault?.();
  }

  function onPointerUp(event) {
    if (!samePointer(event)) return;
    const frame = pointerFrame(event);
    const id = interaction.id;
    interaction = null;
    if (!frame) return;
    applySceneOverlayFrame(root, id, frame);
    emit('commit-frame', { id, frame });
    event.preventDefault?.();
  }

  function onDoubleClick(event) {
    if (mode !== 'select') return;
    const overlay = overlayFromTarget(root, event.target);
    if (!overlay || !['heading', 'paragraph'].includes(overlay.dataset.semanticType)) return;
    selectOverlay(overlay.dataset.sceneOverlayId);
    const target = contentTarget(overlay);
    if (!target) return;
    finishTextEdit(false);
    const id = overlay.dataset.sceneOverlayId;
    const onBlur = () => finishTextEdit(true);
    const onKeyDown = (keyboardEvent) => {
      if (keyboardEvent.key === 'Escape') finishTextEdit(false);
      else if (keyboardEvent.key === 'Enter' && (keyboardEvent.ctrlKey || keyboardEvent.metaKey)) finishTextEdit(true);
    };
    editing = { id, target, onBlur, onKeyDown };
    target.setAttribute?.('contenteditable', 'plaintext-only');
    target.setAttribute?.('role', 'textbox');
    target.addEventListener?.('blur', onBlur);
    target.addEventListener?.('keydown', onKeyDown);
    target.focus?.();
    event.preventDefault?.();
  }

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('dblclick', onDoubleClick);

  function setMode(nextMode) {
    if (!['select', 'map'].includes(nextMode)) throw new TypeError(`Unsupported Scene authoring mode: ${nextMode}.`);
    mode = nextMode;
    if (mode !== 'select') clearSelection();
    return mode;
  }

  function destroy() {
    clearSelection();
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerUp);
    root.removeEventListener('dblclick', onDoubleClick);
  }

  return Object.freeze({ setMode, clearSelection, destroy, get mode() { return mode; }, get selectedId() { return selectedId; } });
}
