import { resolveStory12Appearance } from './scene-contract.js';

const FONT_STACKS = Object.freeze({
  sans: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  'times-new-roman': '"Times New Roman", Times, serif',
  georgia: 'Georgia, serif'
});

function percent(value) {
  return `${value * 100}%`;
}

function designLength(value) {
  return `${value / 19.2}cqw`;
}

function applyFrame(node, frame) {
  node.style.position = 'absolute';
  node.style.boxSizing = 'border-box';
  node.style.left = percent(frame.x);
  node.style.top = percent(frame.y);
  node.style.width = percent(frame.width);
  node.style.height = percent(frame.height);
  node.style.zIndex = String(frame.z);
}

function applyAppearance(node, envelope) {
  const appearance = resolveStory12Appearance(envelope);
  const { box, text } = appearance;
  node.style.backgroundColor = box.fill;
  node.style.opacity = String(box.opacity);
  node.style.borderColor = box.borderColor;
  node.style.borderStyle = box.borderWidth > 0 ? 'solid' : 'none';
  node.style.borderWidth = designLength(box.borderWidth);
  node.style.borderRadius = designLength(box.radius);
  node.style.padding = designLength(box.padding);
  node.style.fontFamily = FONT_STACKS[text.fontFamily];
  node.style.fontSize = designLength(text.fontSize);
  node.style.fontWeight = text.bold ? '700' : '400';
  node.style.fontStyle = text.italic ? 'italic' : 'normal';
  node.style.color = text.color;
  node.style.textAlign = text.align;
  node.style.lineHeight = String(text.lineHeight);
  node.dataset.fontFamily = text.fontFamily;
  node.dataset.designFontSize = String(text.fontSize);
  node.dataset.designPadding = String(box.padding);
}

function createOverlay(envelope, renderBlock, documentRef) {
  const wrapper = documentRef.createElement('section');
  wrapper.className = 'scene-overlay';
  wrapper.dataset.sceneOverlayId = envelope.id;
  wrapper.dataset.semanticType = envelope.block.type;
  applyFrame(wrapper, envelope.frame);
  applyAppearance(wrapper, envelope);
  wrapper.append(renderBlock(envelope.block));
  return wrapper;
}

export function createSceneCompositor({ root, renderBlock, documentRef = document } = {}) {
  if (!root?.replaceChildren) throw new TypeError('Scene compositor root is required.');
  if (typeof renderBlock !== 'function') throw new TypeError('Scene compositor renderBlock must be a function.');
  if (!documentRef?.createElement) throw new TypeError('Scene compositor document is required.');

  root.style ??= {};
  root.style.position = root.style.position || 'relative';
  root.style.containerType = 'inline-size';

  function clear() {
    root.replaceChildren();
    if (root.dataset) delete root.dataset.sceneId;
  }

  function render(state) {
    if (state?.content?.layout !== 'freeform-16x9') {
      throw new TypeError('Scene compositor requires a Story 1.2 freeform-16x9 state.');
    }
    const overlays = state.content.blocks.map((envelope) => createOverlay(envelope, renderBlock, documentRef));
    root.replaceChildren(...overlays);
    root.dataset ??= {};
    root.dataset.sceneId = state.id;
    return overlays;
  }

  return Object.freeze({
    render,
    clear,
    destroy: clear
  });
}
