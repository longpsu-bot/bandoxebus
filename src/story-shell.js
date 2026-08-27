export const STORY_ACTIVATION_LINE_RATIO = 0.45;
export const STORY_RATIO_TIE_EPSILON = 0.01;

export function isStoryShellPocEnabled(search = '') {
  return new URLSearchParams(search).get('storyShell') === 'poc';
}

export function normalizeStoryIndex(index, stateCount) {
  if (!Number.isInteger(stateCount) || stateCount < 1) {
    throw new RangeError('Story state count must be a positive integer.');
  }
  const numericIndex = Number(index);
  if (!Number.isFinite(numericIndex)) throw new TypeError('Story index must be finite.');
  return Math.max(0, Math.min(stateCount - 1, Math.trunc(numericIndex)));
}

export function adjacentStoryIndex(index, direction, stateCount) {
  return normalizeStoryIndex(normalizeStoryIndex(index, stateCount) + Math.sign(direction), stateCount);
}

export function selectActiveStoryStep(entries, {
  viewportHeight,
  activationLineRatio = STORY_ACTIVATION_LINE_RATIO,
  ratioTieEpsilon = STORY_RATIO_TIE_EPSILON
} = {}) {
  const activationLine = viewportHeight * activationLineRatio;
  const candidates = entries
    .filter(({ isIntersecting, intersectionRatio, target }) => (
      isIntersecting && intersectionRatio > 0
      && Number.isFinite(Number(target?.dataset?.storyStateIndex))
    ))
    .map((entry) => ({
      entry,
      index: Number(entry.target.dataset.storyStateIndex),
      distance: Math.abs(
        ((entry.boundingClientRect.top + entry.boundingClientRect.bottom) / 2) - activationLine
      )
    }))
    .sort((a, b) => {
      const ratioDelta = b.entry.intersectionRatio - a.entry.intersectionRatio;
      if (Math.abs(ratioDelta) > ratioTieEpsilon) return ratioDelta;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.index - b.index;
    });
  return candidates[0]?.index ?? null;
}
