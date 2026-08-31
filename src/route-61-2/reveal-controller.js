export function createRouteRevealController({
  start,
  cancel,
  schedule,
  clear,
  reducedMotion
}) {
  let timerId = null;

  return Object.freeze({
    setActive(active, delayMs = 0) {
      if (timerId !== null) {
        clear(timerId);
        timerId = null;
      }
      if (!active) {
        cancel();
        return;
      }
      timerId = schedule(() => {
        timerId = null;
        start();
      }, reducedMotion ? 0 : delayMs);
    }
  });
}
