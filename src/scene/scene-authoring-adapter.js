import {
  applySceneOverlayFrame,
  findSceneOverlay,
  readSceneOverlayFrame,
  readSceneRootBounds
} from './scene-compositor.js';

export const SNAP_TOLERANCE_PX = 8;
export const DRAG_THRESHOLD_PX = 4;
export const MIN_OBJECT_SIZE_PX = 24;

const SNAP_EPSILON_PX = 1e-9;
const NUDGE_PX = 1;
const LARGE_NUDGE_PX = 10;
const HANDLE_DIRECTIONS = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
const HANDLE_CURSORS = Object.freeze({ nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize' });

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clean(value) {
  const rounded = Number(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function validBounds(bounds) {
  return Number.isFinite(bounds?.width) && Number.isFinite(bounds?.height) && bounds.width > 0 && bounds.height > 0;
}

function boundedFrame(frame, minimumWidth = 0.01, minimumHeight = 0.01) {
  const width = clamp(frame.width, minimumWidth, 1);
  const height = clamp(frame.height, minimumHeight, 1);
  return {
    x: clean(clamp(frame.x, 0, 1 - width)),
    y: clean(clamp(frame.y, 0, 1 - height)),
    width: clean(width),
    height: clean(height),
    z: frame.z
  };
}

function axisAnchors(frame, axis) {
  if (axis === 'x') return [{ position: frame.x }, { position: frame.x + frame.width / 2 }, { position: frame.x + frame.width }];
  return [{ position: frame.y }, { position: frame.y + frame.height / 2 }, { position: frame.y + frame.height }];
}

function targetPositions(otherFrames, axis) {
  const targets = [0, 0.5, 1];
  for (const frame of otherFrames) for (const anchor of axisAnchors(frame, axis)) targets.push(anchor.position);
  return targets;
}

function bestTarget(position, targets, pixels, tolerancePx) {
  let best = null;
  for (const target of targets) {
    const distancePx = Math.abs((target - position) * pixels);
    if (distancePx > tolerancePx) continue;
    if (!best || distancePx + SNAP_EPSILON_PX < best.distancePx) best = { target, distancePx };
  }
  return best;
}

function bestCorrection(frame, otherFrames, axis, pixels, tolerancePx) {
  let best = null;
  for (const anchor of axisAnchors(frame, axis)) {
    const candidate = bestTarget(anchor.position, targetPositions(otherFrames, axis), pixels, tolerancePx);
    if (candidate && (!best || candidate.distancePx + SNAP_EPSILON_PX < best.distancePx)) {
      best = { delta: candidate.target - anchor.position, ...candidate };
    }
  }
  return best;
}

export function snapSceneFrame({ frame, bounds, otherFrames = [], tolerancePx = SNAP_TOLERANCE_PX } = {}) {
  if (!frame || !validBounds(bounds)) throw new TypeError('Scene snapping requires a frame and positive rendered bounds.');
  if (!Number.isFinite(tolerancePx) || tolerancePx < 0) throw new TypeError('Snap tolerance must be a non-negative pixel value.');
  const next = boundedFrame(frame);
  const guides = [];
  const x = bestCorrection(next, otherFrames, 'x', bounds.width, tolerancePx);
  if (x) { next.x = clean(clamp(next.x + x.delta, 0, 1 - next.width)); guides.push({ axis: 'x', position: clean(x.target) }); }
  const y = bestCorrection(next, otherFrames, 'y', bounds.height, tolerancePx);
  if (y) { next.y = clean(clamp(next.y + y.delta, 0, 1 - next.height)); guides.push({ axis: 'y', position: clean(y.target) }); }
  return { frame: next, guides };
}

function resizeAxis({ startMin, startSize, delta, movesMin, movesMax, fromCenter, minimumSize }) {
  const startMax = startMin + startSize;
  if (!movesMin && !movesMax) return { minimum: startMin, size: startSize };
  if (fromCenter) {
    const center = startMin + startSize / 2;
    const signedDelta = movesMax ? delta : -delta;
    const maximumSize = 2 * Math.min(center, 1 - center);
    const size = clamp(startSize + 2 * signedDelta, minimumSize, maximumSize);
    return { minimum: center - size / 2, size };
  }
  if (movesMin) {
    const minimum = clamp(startMin + delta, 0, startMax - minimumSize);
    return { minimum, size: startMax - minimum };
  }
  const maximum = clamp(startMax + delta, startMin + minimumSize, 1);
  return { minimum: startMin, size: maximum - startMin };
}

function ratioResize({ start, direction, dx, dy, bounds, fromCenter, minimumWidth, minimumHeight }) {
  const ratio = start.width / start.height;
  const movesWest = direction.includes('w');
  const movesNorth = direction.includes('n');
  const horizontalSign = movesWest ? -1 : 1;
  const verticalSign = movesNorth ? -1 : 1;
  const multiplier = fromCenter ? 2 : 1;
  const requestedWidth = start.width + horizontalSign * dx / bounds.width * multiplier;
  const requestedHeight = start.height + verticalSign * dy / bounds.height * multiplier;
  const relativeWidthChange = Math.abs(requestedWidth - start.width) / start.width;
  const relativeHeightChange = Math.abs(requestedHeight - start.height) / start.height;
  let width = relativeWidthChange >= relativeHeightChange ? requestedWidth : requestedHeight * ratio;
  let height = width / ratio;

  let minimumRatioWidth = Math.max(minimumWidth, minimumHeight * ratio);
  const centerX = start.x + start.width / 2;
  const centerY = start.y + start.height / 2;
  const maximumWidth = Math.min(
    fromCenter ? 2 * Math.min(centerX, 1 - centerX) : movesWest ? start.x + start.width : 1 - start.x,
    (fromCenter ? 2 * Math.min(centerY, 1 - centerY) : movesNorth ? start.y + start.height : 1 - start.y) * ratio
  );
  minimumRatioWidth = Math.min(minimumRatioWidth, maximumWidth);
  width = clamp(width, minimumRatioWidth, maximumWidth);
  height = width / ratio;

  if (fromCenter) return { x: centerX - width / 2, y: centerY - height / 2, width, height, z: start.z };
  return {
    x: movesWest ? start.x + start.width - width : start.x,
    y: movesNorth ? start.y + start.height - height : start.y,
    width,
    height,
    z: start.z
  };
}

function rawResizeFrame({ start, direction, dx, dy, bounds, shiftKey, altKey, minSizePx }) {
  const minimumWidth = Math.min(1, minSizePx / bounds.width);
  const minimumHeight = Math.min(1, minSizePx / bounds.height);
  const corner = direction.length === 2;
  if (shiftKey && corner) return ratioResize({ start, direction, dx, dy, bounds, fromCenter: altKey, minimumWidth, minimumHeight });
  const horizontal = resizeAxis({
    startMin: start.x, startSize: start.width, delta: dx / bounds.width,
    movesMin: direction.includes('w'), movesMax: direction.includes('e'), fromCenter: altKey, minimumSize: minimumWidth
  });
  const vertical = resizeAxis({
    startMin: start.y, startSize: start.height, delta: dy / bounds.height,
    movesMin: direction.includes('n'), movesMax: direction.includes('s'), fromCenter: altKey, minimumSize: minimumHeight
  });
  return { x: horizontal.minimum, y: vertical.minimum, width: horizontal.size, height: vertical.size, z: start.z };
}

function primaryEdge(frame, direction, axis) {
  if (axis === 'x') return direction.includes('w') ? frame.x : frame.x + frame.width;
  return direction.includes('n') ? frame.y : frame.y + frame.height;
}

/** Pure normalized-frame resize used by every authoring handle. */
export function resizeSceneFrame({
  start,
  direction,
  dx = 0,
  dy = 0,
  bounds,
  shiftKey = false,
  altKey = false,
  minSizePx = MIN_OBJECT_SIZE_PX,
  otherFrames = [],
  tolerancePx = SNAP_TOLERANCE_PX
} = {}) {
  if (!start || !HANDLE_DIRECTIONS.includes(direction) || !validBounds(bounds)) throw new TypeError('Scene resize requires a frame, direction, and positive rendered bounds.');
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(minSizePx) || minSizePx <= 0) throw new TypeError('Scene resize deltas and minimum size must be finite.');
  if (!Number.isFinite(tolerancePx) || tolerancePx < 0) throw new TypeError('Snap tolerance must be a non-negative pixel value.');

  let adjustedDx = dx;
  let adjustedDy = dy;
  let frame = rawResizeFrame({ start, direction, dx, dy, bounds, shiftKey, altKey, minSizePx });
  const candidates = [];
  if (direction.includes('w') || direction.includes('e')) {
    const target = bestTarget(primaryEdge(frame, direction, 'x'), targetPositions(otherFrames, 'x'), bounds.width, tolerancePx);
    if (target) { adjustedDx += (target.target - primaryEdge(frame, direction, 'x')) * bounds.width; candidates.push({ axis: 'x', position: clean(target.target) }); }
  }
  if (direction.includes('n') || direction.includes('s')) {
    const target = bestTarget(primaryEdge(frame, direction, 'y'), targetPositions(otherFrames, 'y'), bounds.height, tolerancePx);
    if (target) { adjustedDy += (target.target - primaryEdge(frame, direction, 'y')) * bounds.height; candidates.push({ axis: 'y', position: clean(target.target) }); }
  }
  if (adjustedDx !== dx || adjustedDy !== dy) frame = rawResizeFrame({ start, direction, dx: adjustedDx, dy: adjustedDy, bounds, shiftKey, altKey, minSizePx });
  const guides = candidates.filter(({ axis, position }) => Math.abs(primaryEdge(frame, direction, axis) - position) * (axis === 'x' ? bounds.width : bounds.height) <= SNAP_EPSILON_PX);
  return { frame: boundedFrame(frame, Math.min(1, minSizePx / bounds.width), Math.min(1, minSizePx / bounds.height)), guides };
}

function frameForMove(start, dx, dy, bounds) {
  return boundedFrame({ ...start, x: start.x + dx / bounds.width, y: start.y + dy / bounds.height });
}

function overlayFromTarget(root, target) {
  let node = target;
  while (node && node !== root) {
    if (node.dataset?.sceneOverlayId) return node;
    node = node.parentNode;
  }
  return null;
}

function targetWithin(target, ancestor) {
  let node = target;
  while (node) { if (node === ancestor) return true; node = node.parentNode; }
  return false;
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

export function createSceneAuthoringAdapter({ root, documentRef = document, emit = () => {}, snapTolerancePx = SNAP_TOLERANCE_PX } = {}) {
  if (!root?.addEventListener || !root?.removeEventListener) throw new TypeError('Scene authoring adapter requires a compositor root.');
  if (!documentRef?.createElement) throw new TypeError('Scene authoring adapter requires a document.');
  if (typeof emit !== 'function') throw new TypeError('Scene authoring adapter emit must be a function.');
  if (!Number.isFinite(snapTolerancePx) || snapTolerancePx < 0) throw new TypeError('Scene authoring snap tolerance must be non-negative pixels.');

  let mode = 'select';
  let selectedId = null;
  let chrome = null;
  let feedback = null;
  let interaction = null;
  let editing = null;
  let guideNodes = [];

  root.setAttribute?.('tabindex', '0');

  function clearGuides() { for (const guide of guideNodes) guide.remove?.(); guideNodes = []; }

  function showGuides(guides) {
    clearGuides();
    for (const guide of guides) {
      const node = documentRef.createElement('div');
      node.className = 'scene-snap-guide'; node.dataset.sceneSnapGuide = guide.axis; node.dataset.sceneSnapPosition = String(guide.position);
      node.style.position = 'absolute'; node.style.pointerEvents = 'none';
      if (guide.axis === 'x') { node.style.left = `${guide.position * 100}%`; node.style.top = '0'; node.style.bottom = '0'; }
      else { node.style.top = `${guide.position * 100}%`; node.style.left = '0'; node.style.right = '0'; }
      root.append(node); guideNodes.push(node);
    }
  }

  function syncChrome(frame = selectedId ? readSceneOverlayFrame(root, selectedId) : null) {
    if (!chrome || !frame) return;
    chrome.style.left = `${frame.x * 100}%`; chrome.style.top = `${frame.y * 100}%`;
    chrome.style.width = `${frame.width * 100}%`; chrome.style.height = `${frame.height * 100}%`;
    chrome.style.zIndex = String(Math.max(10002, frame.z + 1));
  }

  function hideFeedback() { feedback?.setAttribute?.('hidden', ''); }

  function showFeedback(frame, bounds) {
    if (!feedback) return;
    feedback.textContent = `${Math.round(frame.width * bounds.width)} × ${Math.round(frame.height * bounds.height)}`;
    feedback.removeAttribute?.('hidden');
  }

  function removeChrome() { chrome?.remove?.(); chrome = null; feedback = null; }

  function buildChrome(id) {
    chrome = documentRef.createElement('div');
    chrome.className = 'scene-selection-chrome'; chrome.dataset.sceneSelectionChrome = id;
    for (const direction of HANDLE_DIRECTIONS) {
      const handle = documentRef.createElement('button');
      handle.className = 'scene-resize-handle'; handle.dataset.sceneResizeHandle = direction;
      handle.setAttribute?.('type', 'button'); handle.setAttribute?.('aria-label', `Resize ${id} from ${direction}`);
      handle.style.cursor = HANDLE_CURSORS[direction]; chrome.append(handle);
    }
    feedback = documentRef.createElement('div'); feedback.className = 'scene-resize-feedback'; feedback.dataset.sceneResizeFeedback = '';
    feedback.setAttribute?.('aria-hidden', 'true'); feedback.setAttribute?.('hidden', ''); chrome.append(feedback);
    root.append(chrome); syncChrome();
  }

  function finishTextEdit(commit) {
    if (!editing) return;
    const current = editing; editing = null;
    current.target.removeEventListener?.('blur', current.onBlur); current.target.removeEventListener?.('keydown', current.onKeyDown);
    current.target.removeAttribute?.('contenteditable'); current.target.removeAttribute?.('role');
    if (commit) emit('commit-text', { id: current.id, text: current.target.textContent ?? '' });
  }

  function releaseCapture(current) {
    if (current?.pointerId !== undefined && root.hasPointerCapture?.(current.pointerId)) root.releasePointerCapture?.(current.pointerId);
  }

  function cancelInteraction() {
    if (!interaction) return;
    const current = interaction; interaction = null;
    applySceneOverlayFrame(root, current.id, current.frame); syncChrome(current.frame);
    clearGuides(); hideFeedback(); releaseCapture(current);
  }

  function clearSelection() {
    cancelInteraction(); clearGuides(); hideFeedback(); finishTextEdit(false); removeChrome(); selectedId = null;
  }

  function selectOverlay(id, { emitSelection = true, focus = true } = {}) {
    const overlay = findSceneOverlay(root, id);
    if (!overlay) return null;
    const selectionChanged = selectedId !== id;
    if (selectionChanged) { cancelInteraction(); finishTextEdit(false); removeChrome(); selectedId = id; }
    if (!chrome) buildChrome(id);
    syncChrome();
    if (emitSelection && selectionChanged) emit('select-overlay', { id });
    if (focus) root.focus?.();
    return overlay;
  }

  function samePointer(event) {
    return interaction && (interaction.pointerId === undefined || event.pointerId === undefined || event.pointerId === interaction.pointerId);
  }

  function pointerResult(event) {
    if (!interaction) return null;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    if (interaction.kind === 'resize') return resizeSceneFrame({
      start: interaction.frame, direction: interaction.direction, dx, dy, bounds: interaction.bounds,
      shiftKey: Boolean(event.shiftKey), altKey: Boolean(event.altKey), otherFrames: otherFrames(root, interaction.id), tolerancePx: snapTolerancePx
    });
    return snapSceneFrame({ frame: frameForMove(interaction.frame, dx, dy, interaction.bounds), bounds: interaction.bounds, otherFrames: otherFrames(root, interaction.id), tolerancePx: snapTolerancePx });
  }

  function onPointerDown(event) {
    if (mode !== 'select' || (editing && targetWithin(event.target, editing.target))) return;
    const direction = event.target?.dataset?.sceneResizeHandle;
    const overlay = direction && selectedId ? findSceneOverlay(root, selectedId) : overlayFromTarget(root, event.target);
    if (!overlay) return;
    const id = overlay.dataset.sceneOverlayId; selectOverlay(id);
    const frame = readSceneOverlayFrame(root, id); const bounds = readSceneRootBounds(root);
    if (!frame || !bounds) return;
    interaction = { id, pointerId: event.pointerId, kind: direction ? 'resize' : 'move', direction, active: Boolean(direction), changed: false, startX: event.clientX, startY: event.clientY, frame, bounds };
    if (event.pointerId !== undefined) root.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  }

  function onPointerMove(event) {
    if (!samePointer(event)) return;
    const dx = event.clientX - interaction.startX; const dy = event.clientY - interaction.startY;
    if (interaction.kind === 'move' && !interaction.active && Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
    interaction.active = true;
    const result = pointerResult(event); if (!result) return;
    applySceneOverlayFrame(root, interaction.id, result.frame); syncChrome(result.frame); showGuides(result.guides);
    if (interaction.kind === 'resize') showFeedback(result.frame, interaction.bounds);
    interaction.changed = JSON.stringify(result.frame) !== JSON.stringify(interaction.frame);
    event.preventDefault?.();
  }

  function onPointerUp(event) {
    if (!samePointer(event)) return;
    const current = interaction;
    let result = null;
    if (current.active) result = pointerResult(event);
    interaction = null; clearGuides(); hideFeedback();
    if (result) { applySceneOverlayFrame(root, current.id, result.frame); syncChrome(result.frame); }
    releaseCapture(current);
    if (result && current.changed) emit('commit-frame', { id: current.id, frame: result.frame });
    event.preventDefault?.();
  }

  function onPointerCancel(event) { if (samePointer(event)) cancelInteraction(); }
  function onLostPointerCapture(event) { if (samePointer(event)) cancelInteraction(); }

  function onDoubleClick(event) {
    if (mode !== 'select') return;
    const overlay = overlayFromTarget(root, event.target);
    if (!overlay || !['heading', 'paragraph'].includes(overlay.dataset.semanticType)) return;
    selectOverlay(overlay.dataset.sceneOverlayId);
    const target = overlay.children?.[0]; if (!target) return;
    finishTextEdit(false);
    const id = overlay.dataset.sceneOverlayId;
    const onBlur = () => finishTextEdit(true);
    const onKeyDown = (keyboardEvent) => {
      if (keyboardEvent.key === 'Escape') finishTextEdit(false);
      else if (keyboardEvent.key === 'Enter' && (keyboardEvent.ctrlKey || keyboardEvent.metaKey)) finishTextEdit(true);
    };
    editing = { id, target, onBlur, onKeyDown };
    target.setAttribute?.('contenteditable', 'plaintext-only'); target.setAttribute?.('role', 'textbox');
    target.addEventListener?.('blur', onBlur); target.addEventListener?.('keydown', onKeyDown); target.focus?.(); event.preventDefault?.();
  }

  function onKeyDown(event) {
    if (mode !== 'select' || editing) return;
    if (event.key === 'Escape' && interaction) { cancelInteraction(); event.preventDefault?.(); return; }
    if (!selectedId || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const frame = readSceneOverlayFrame(root, selectedId); const bounds = readSceneRootBounds(root); if (!frame || !bounds) return;
    const pixels = event.shiftKey ? LARGE_NUDGE_PX : NUDGE_PX;
    const dx = event.key === 'ArrowLeft' ? -pixels : event.key === 'ArrowRight' ? pixels : 0;
    const dy = event.key === 'ArrowUp' ? -pixels : event.key === 'ArrowDown' ? pixels : 0;
    const next = boundedFrame({ ...frame, x: frame.x + dx / bounds.width, y: frame.y + dy / bounds.height });
    applySceneOverlayFrame(root, selectedId, next); syncChrome(next); clearGuides(); emit('commit-frame', { id: selectedId, frame: next }); event.preventDefault?.();
  }

  root.addEventListener('pointerdown', onPointerDown); root.addEventListener('pointermove', onPointerMove); root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel); root.addEventListener('lostpointercapture', onLostPointerCapture);
  root.addEventListener('dblclick', onDoubleClick); root.addEventListener('keydown', onKeyDown);

  function setMode(nextMode) {
    if (!['select', 'map'].includes(nextMode)) throw new TypeError(`Unsupported Scene authoring mode: ${nextMode}.`);
    mode = nextMode; if (mode !== 'select') clearSelection(); return mode;
  }

  function destroy() {
    clearSelection();
    root.removeEventListener('pointerdown', onPointerDown); root.removeEventListener('pointermove', onPointerMove); root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerCancel); root.removeEventListener('lostpointercapture', onLostPointerCapture);
    root.removeEventListener('dblclick', onDoubleClick); root.removeEventListener('keydown', onKeyDown);
  }

  return Object.freeze({ setMode, selectOverlay, clearSelection, destroy, get mode() { return mode; }, get selectedId() { return selectedId; } });
}
