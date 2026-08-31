import {
  applySceneOverlayFrame,
  findSceneOverlay,
  readSceneOverlayFrame,
  readSceneRootBounds
} from './scene-compositor.js';

export const SNAP_TOLERANCE_PX = 8;
const NUDGE_PX = 1;
const LARGE_NUDGE_PX = 10;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clean(value) {
  const rounded = Number(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function boundedFrame(frame) {
  const width = clamp(frame.width, 0.01, 1);
  const height = clamp(frame.height, 0.01, 1);
  return {
    x: clean(clamp(frame.x, 0, 1 - width)),
    y: clean(clamp(frame.y, 0, 1 - height)),
    width: clean(width),
    height: clean(height),
    z: frame.z
  };
}

function axisAnchors(frame, axis) {
  if (axis === 'x') return [
    { position: frame.x },
    { position: frame.x + frame.width / 2 },
    { position: frame.x + frame.width }
  ];
  return [
    { position: frame.y },
    { position: frame.y + frame.height / 2 },
    { position: frame.y + frame.height }
  ];
}

function targetPositions(otherFrames, axis) {
  const targets = [0, 0.5, 1];
  for (const frame of otherFrames) {
    for (const anchor of axisAnchors(frame, axis)) targets.push(anchor.position);
  }
  return targets;
}

function bestCorrection(frame, otherFrames, axis, pixels, tolerancePx) {
  let best = null;
  for (const anchor of axisAnchors(frame, axis)) {
    for (const target of targetPositions(otherFrames, axis)) {
      const delta = target - anchor.position;
      const distancePx = Math.abs(delta * pixels);
      if (distancePx > tolerancePx) continue;
      if (!best || distancePx < best.distancePx) best = { delta, target, distancePx };
    }
  }
  return best;
}

export function snapSceneFrame({
  frame,
  bounds,
  otherFrames = [],
  tolerancePx = SNAP_TOLERANCE_PX
} = {}) {
  if (!frame || !Number.isFinite(bounds?.width) || !Number.isFinite(bounds?.height)
    || bounds.width <= 0 || bounds.height <= 0) {
    throw new TypeError('Scene snapping requires a frame and positive rendered bounds.');
  }
  if (!Number.isFinite(tolerancePx) || tolerancePx < 0) throw new TypeError('Snap tolerance must be a non-negative pixel value.');
  const next = boundedFrame(frame);
  const guides = [];
  const x = bestCorrection(next, otherFrames, 'x', bounds.width, tolerancePx);
  if (x) {
    next.x = clean(clamp(next.x + x.delta, 0, 1 - next.width));
    guides.push({ axis: 'x', position: clean(x.target) });
  }
  const y = bestCorrection(next, otherFrames, 'y', bounds.height, tolerancePx);
  if (y) {
    next.y = clean(clamp(next.y + y.delta, 0, 1 - next.height));
    guides.push({ axis: 'y', position: clean(y.target) });
  }
  return { frame: next, guides };
}

function snapResizeFrame(frame, otherFrames, bounds, tolerancePx) {
  const next = boundedFrame(frame);
  const guides = [];
  const right = next.x + next.width;
  const bottom = next.y + next.height;
  let bestRight = null;
  for (const target of targetPositions(otherFrames, 'x')) {
    const distancePx = Math.abs((target - right) * bounds.width);
    if (distancePx <= tolerancePx && (!bestRight || distancePx < bestRight.distancePx)) {
      bestRight = { target, distancePx };
    }
  }
  if (bestRight) {
    next.width = clean(clamp(bestRight.target - next.x, 0.01, 1 - next.x));
    guides.push({ axis: 'x', position: clean(bestRight.target) });
  }
  let bestBottom = null;
  for (const target of targetPositions(otherFrames, 'y')) {
    const distancePx = Math.abs((target - bottom) * bounds.height);
    if (distancePx <= tolerancePx && (!bestBottom || distancePx < bestBottom.distancePx)) {
      bestBottom = { target, distancePx };
    }
  }
  if (bestBottom) {
    next.height = clean(clamp(bestBottom.target - next.y, 0.01, 1 - next.y));
    guides.push({ axis: 'y', position: clean(bestBottom.target) });
  }
  return { frame: next, guides };
}

function frameForMove(start, dx, dy, bounds) {
  return boundedFrame({
    ...start,
    x: start.x + dx / bounds.width,
    y: start.y + dy / bounds.height
  });
}

function frameForResize(start, dx, dy, bounds) {
  return boundedFrame({
    ...start,
    width: start.width + dx / bounds.width,
    height: start.height + dy / bounds.height
  });
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

function otherFrames(root, selectedId) {
  const result = [];
  for (const child of root.children ?? []) {
    const id = child?.dataset?.sceneOverlayId;
    if (!id || id === selectedId) continue;
    const frame = readSceneOverlayFrame(root, id);
    if (frame) result.push(frame);
  }
  return result;
}

export function createSceneAuthoringAdapter({
  root,
  documentRef = document,
  emit = () => {},
  snapTolerancePx = SNAP_TOLERANCE_PX
} = {}) {
  if (!root?.addEventListener || !root?.removeEventListener) throw new TypeError('Scene authoring adapter requires a compositor root.');
  if (!documentRef?.createElement) throw new TypeError('Scene authoring adapter requires a document.');
  if (typeof emit !== 'function') throw new TypeError('Scene authoring adapter emit must be a function.');
  if (!Number.isFinite(snapTolerancePx) || snapTolerancePx < 0) throw new TypeError('Scene authoring snap tolerance must be non-negative pixels.');

  let mode = 'select';
  let selectedId = null;
  let handle = null;
  let interaction = null;
  let editing = null;
  let guideNodes = [];

  root.setAttribute?.('tabindex', '0');

  function clearGuides() {
    for (const guide of guideNodes) guide.remove?.();
    guideNodes = [];
  }

  function showGuides(guides) {
    clearGuides();
    for (const guide of guides) {
      const node = documentRef.createElement('div');
      node.className = 'scene-snap-guide';
      node.dataset.sceneSnapGuide = guide.axis;
      node.dataset.sceneSnapPosition = String(guide.position);
      node.style.position = 'absolute';
      node.style.pointerEvents = 'none';
      if (guide.axis === 'x') {
        node.style.left = `${guide.position * 100}%`;
        node.style.top = '0';
        node.style.bottom = '0';
      } else {
        node.style.top = `${guide.position * 100}%`;
        node.style.left = '0';
        node.style.right = '0';
      }
      root.append(node);
      guideNodes.push(node);
    }
  }

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
    clearGuides();
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
    root.focus?.();
    return overlay;
  }

  function snappedPointerFrame(event) {
    if (!interaction) return null;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    const raw = interaction.kind === 'resize'
      ? frameForResize(interaction.frame, dx, dy, interaction.bounds)
      : frameForMove(interaction.frame, dx, dy, interaction.bounds);
    const others = otherFrames(root, interaction.id);
    return interaction.kind === 'resize'
      ? snapResizeFrame(raw, others, interaction.bounds, snapTolerancePx)
      : snapSceneFrame({ frame: raw, bounds: interaction.bounds, otherFrames: others, tolerancePx: snapTolerancePx });
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
    const result = snappedPointerFrame(event);
    if (!result) return;
    applySceneOverlayFrame(root, interaction.id, result.frame);
    showGuides(result.guides);
    event.preventDefault?.();
  }

  function onPointerUp(event) {
    if (!samePointer(event)) return;
    const result = snappedPointerFrame(event);
    const id = interaction.id;
    interaction = null;
    clearGuides();
    if (!result) return;
    applySceneOverlayFrame(root, id, result.frame);
    emit('commit-frame', { id, frame: result.frame });
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

  function onKeyDown(event) {
    if (mode !== 'select' || !selectedId || editing) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const frame = readSceneOverlayFrame(root, selectedId);
    const bounds = readSceneRootBounds(root);
    if (!frame || !bounds) return;
    const pixels = event.shiftKey ? LARGE_NUDGE_PX : NUDGE_PX;
    const dx = event.key === 'ArrowLeft' ? -pixels : event.key === 'ArrowRight' ? pixels : 0;
    const dy = event.key === 'ArrowUp' ? -pixels : event.key === 'ArrowDown' ? pixels : 0;
    const next = boundedFrame({
      ...frame,
      x: frame.x + dx / bounds.width,
      y: frame.y + dy / bounds.height
    });
    applySceneOverlayFrame(root, selectedId, next);
    clearGuides();
    emit('commit-frame', { id: selectedId, frame: next });
    event.preventDefault?.();
  }

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('dblclick', onDoubleClick);
  root.addEventListener('keydown', onKeyDown);

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
    root.removeEventListener('keydown', onKeyDown);
  }

  return Object.freeze({ setMode, selectOverlay, clearSelection, destroy, get mode() { return mode; }, get selectedId() { return selectedId; } });
}
