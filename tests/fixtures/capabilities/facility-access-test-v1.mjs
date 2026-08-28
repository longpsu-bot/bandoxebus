import { deepFreeze } from '../../../src/capabilities/descriptor-schema.js';

export const FACILITY_ACCESS_TEST_DESCRIPTOR = deepFreeze({
  schemaVersion: '1.0',
  id: 'facility-access-test-v1',
  label: 'Facility access test',
  description: 'Test-only proof of the trusted special capability boundary.',
  requires: ['core-map-v1'],
  datasetRoles: [{ role: 'facility.access-paths', types: ['geojson'], geometry: ['line'], required: true, render: false }],
  actions: [{
    type: 'facility.show-access', label: 'Show access', description: 'Toggle test access paths.',
    parameters: { type: 'object', additionalProperties: false, required: ['type', 'active'], properties: { type: { const: 'facility.show-access' }, active: { type: 'boolean' } } }
  }],
  content: [],
  targets: [{ id: 'facility-access-paths', label: 'Facility access paths', kind: 'map' }],
  metrics: [{ id: 'facility-access-count', label: 'Facility access count', valueType: 'number', format: { type: 'integer' } }],
  legacyActions: [],
  lifecycle: ['reset', 'destroy'],
  settingsSchema: { type: 'object', additionalProperties: false, required: ['enabled'], properties: { enabled: { type: 'boolean' } } },
  gui: { group: 'Test extensions', icon: 'proof', summary: 'Trusted extension boundary fixture' }
});

export function facilityAccessTestEntry(events = []) {
  return {
    descriptor: FACILITY_ACCESS_TEST_DESCRIPTOR,
    createCapability({ resources } = {}) {
      let destroyed = false;
      const resource = [...(resources ?? [])].find(([, value]) => value.descriptor?.role === 'facility.access-paths')?.[1];
      return Object.freeze({
        handlers: Object.freeze({ 'facility.show-access': ({ active }) => events.push(active) }),
        metricProviders: Object.freeze({ 'facility-access-count': () => 2 }),
        datasetRoles: Object.freeze({ 'facility.access-paths': true }),
        targets: Object.freeze({ 'facility-access-paths': Object.freeze({ owner: 'facility-access-test-v1', resource }) }),
        reset() { events.push(false); },
        destroy() { if (destroyed) return; destroyed = true; events.push('destroy'); }
      });
    }
  };
}
