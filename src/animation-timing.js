export function shouldUpdateAnimationFrame(timestamp, lastUpdate, intervalMs) {
  return lastUpdate === null || timestamp < lastUpdate || timestamp - lastUpdate >= intervalMs;
}
