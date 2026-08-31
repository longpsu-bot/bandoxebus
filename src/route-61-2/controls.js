export function createRoute612Controls({
  host,
  documentRef = globalThis.document,
  onMode = () => {},
  onReveal = () => {},
  onPoi = () => {},
  onUrban = () => {},
  onSimulation = () => {}
} = {}) {
  if (!host?.replaceChildren || !documentRef?.createElement) throw new TypeError('Route 61-2 controls require a neutral host.');
  const root = documentRef.createElement('section');
  root.setAttribute('aria-label', 'Route comparison controls');
  for (const [label, mode] of [['Difference', 'difference'], ['Existing', 'existing'], ['Proposed', 'proposed'], ['Compare', 'compare']]) {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.mode = mode;
    button.addEventListener('click', () => onMode(mode));
    root.append(button);
  }
  const toggle = (labelText, onChange, checked = false) => {
    const label = documentRef.createElement('label');
    label.textContent = labelText;
    const input = documentRef.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    label.append(input);
    root.append(label);
    return input;
  };
  toggle('Route reveal', onReveal, true);
  toggle('POI emphasis', onPoi);
  toggle('Urban context', onUrban);
  let speed = 1;
  const simulation = toggle('Simulation', (active) => onSimulation(active, speed));
  const speedLabel = documentRef.createElement('label');
  speedLabel.textContent = 'Simulation speed';
  const speedInput = documentRef.createElement('input');
  speedInput.type = 'range';
  speedInput.min = '0.25'; speedInput.max = '3'; speedInput.step = '0.25'; speedInput.value = '1';
  speedInput.addEventListener('change', () => { speed = Number(speedInput.value); onSimulation(simulation.checked, speed); });
  speedLabel.append(speedInput);
  root.append(speedLabel);
  host.replaceChildren(root);
  return Object.freeze({ destroy() { host.replaceChildren(); } });
}
