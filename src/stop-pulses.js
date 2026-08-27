import { haversineMeters } from './comparison.js';

export function createStopPulseTracker({ radiusMeters }) {
  const triggeredByBus = new Map();

  return {
    collect(busStates, stopFeatures) {
      const triggered = [];
      busStates.forEach((busState) => {
        let loopState = triggeredByBus.get(busState.key);
        if (!loopState || loopState.loop !== busState.loop) {
          loopState = { loop: busState.loop, stopIds: new Set() };
          triggeredByBus.set(busState.key, loopState);
        }
        stopFeatures.forEach((feature) => {
          const stopId = feature.properties.stopId;
          if (loopState.stopIds.has(stopId)) return;
          if (haversineMeters(busState.position, feature.geometry.coordinates) > radiusMeters) return;
          loopState.stopIds.add(stopId);
          triggered.push(feature);
        });
      });
      return triggered;
    }
  };
}
