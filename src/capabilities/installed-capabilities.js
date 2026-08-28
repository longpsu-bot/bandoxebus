import { createCapabilityRegistry } from './capability-registry.js';
import { CORE_CONTENT_V1_DESCRIPTOR, createCoreContentCapability } from './core-content-v1.js';
import {
  CORE_MAP_V1_DESCRIPTOR,
  CORE_MAP_V1_NORMALIZERS,
  createCoreMapCapability
} from './core-map-v1.js';
import {
  ROUTE_COMPARISON_V1_DESCRIPTOR,
  ROUTE_COMPARISON_V1_NORMALIZERS,
  createRouteComparisonCapability
} from './route-comparison-v1.js';
import {
  URBAN_CONTEXT_V1_DESCRIPTOR,
  URBAN_CONTEXT_V1_NORMALIZERS,
  createUrbanContextCapability
} from './urban-context-v1.js';

export const INSTALLED_CAPABILITY_REGISTRY = createCapabilityRegistry([
  {
    descriptor: CORE_CONTENT_V1_DESCRIPTOR,
    createCapability: createCoreContentCapability
  },
  {
    descriptor: CORE_MAP_V1_DESCRIPTOR,
    createCapability: createCoreMapCapability,
    story10Normalizers: CORE_MAP_V1_NORMALIZERS
  },
  {
    descriptor: ROUTE_COMPARISON_V1_DESCRIPTOR,
    createCapability: createRouteComparisonCapability,
    story10Normalizers: ROUTE_COMPARISON_V1_NORMALIZERS
  },
  {
    descriptor: URBAN_CONTEXT_V1_DESCRIPTOR,
    createCapability: createUrbanContextCapability,
    story10Normalizers: URBAN_CONTEXT_V1_NORMALIZERS
  }
]);
