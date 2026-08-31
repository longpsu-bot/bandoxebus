export function createRoute612Controls({ host, documentRef = globalThis.document, onMode = () => {} } = {}) {
  if (!host?.replaceChildren || !documentRef?.createElement) throw new TypeError('Route 61-2 controls require a neutral host.');
  const root = documentRef.createElement('section');
  root.setAttribute('aria-label', 'Route comparison controls');
  for (const [label, mode] of [['Existing', 'existing'], ['Proposed', 'proposed'], ['Difference', 'difference']]) {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.mode = mode;
    button.addEventListener('click', () => onMode(mode));
    root.append(button);
  }
  host.replaceChildren(root);
  return Object.freeze({ destroy() { host.replaceChildren(); } });
}
