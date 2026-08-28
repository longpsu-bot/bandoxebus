import { validateSchema } from '../contracts/schema-validator.js';
import { ProjectLoadError } from '../project/project-error.js';
import { deepFreeze } from './descriptor-schema.js';

function fail(code, path, message) {
  throw new ProjectLoadError(code, path, message);
}

function friendlyIssue(issue) {
  let message = issue.message;
  if (issue.code === 'REQUIRED') message = `${issue.path} is required.`;
  else if (issue.code === 'ADDITIONAL_PROPERTY') {
    const property = issue.path.slice(issue.path.lastIndexOf('.') + 1);
    const parent = issue.path.slice(0, issue.path.lastIndexOf('.'));
    message = `${parent} has unsupported property "${property}".`;
  } else if (issue.code === 'ENUM') message = `${issue.path} has an unsupported value.`;
  else if (issue.code === 'TYPE' && /Expected number/.test(issue.message)) message = `${issue.path} must be a finite number.`;
  else if (issue.code === 'TYPE' && /Expected boolean/.test(issue.message)) message = `${issue.path} must be a boolean.`;
  else if (issue.code === 'TYPE' && /Expected integer/.test(issue.message)) message = `${issue.path} must be a non-negative integer.`;
  else if (['MINIMUM', 'MAXIMUM'].includes(issue.code) && issue.path.endsWith('.delayMs')) {
    message = `${issue.path} must be a non-negative integer.`;
  } else if (['MINIMUM', 'MAXIMUM'].includes(issue.code)) {
    message = `${issue.path} must be between the configured bounds.`;
  }
  return Object.freeze({ path: issue.path, message });
}

export function createLegacyActionNormalizer({ legacyType, schema, normalize }) {
  return Object.freeze({
    legacyType,
    validate(action, path) {
      const issues = validateSchema(action, schema, { path });
      return issues.length ? friendlyIssue(issues[0]) : null;
    },
    normalize
  });
}

function descriptorMap(actionDescriptors) {
  if (Array.isArray(actionDescriptors)) {
    return Object.fromEntries(actionDescriptors.map((descriptor) => [descriptor.type, descriptor]));
  }
  return actionDescriptors ?? {};
}

function normalizerMap(normalizers) {
  const result = new Map();
  for (const normalizer of normalizers ?? []) {
    if (result.has(normalizer.legacyType)) {
      fail(
        'STORY_10_NORMALIZER_DUPLICATE',
        '$.normalizers',
        `Duplicate Story 1.0 normalizer ownership: ${normalizer.legacyType}.`
      );
    }
    result.set(normalizer.legacyType, normalizer);
  }
  return result;
}

function normalizeAction(action, path, normalizers, actionDescriptors, bindings) {
  const normalizer = normalizers.get(action?.type);
  let canonical;
  if (normalizer) {
    const issue = normalizer.validate(action, path);
    if (issue) {
      const issuePath = typeof issue === 'string' ? path : issue.path;
      const message = typeof issue === 'string' ? issue : issue.message;
      fail('STORY_10_ACTION_INVALID', issuePath, message);
    }
    canonical = normalizer.normalize(action, bindings);
  } else if (actionDescriptors[action?.type]) {
    canonical = structuredClone(action);
  } else {
    fail('STORY_10_ACTION_UNKNOWN', `${path}.type`, `Unknown Story 1.0 action type: ${action?.type ?? ''}.`);
  }

  const descriptor = actionDescriptors[canonical?.type];
  if (!descriptor) fail('STORY_10_ACTION_UNKNOWN', `${path}.type`, `Unknown canonical action type: ${canonical?.type ?? ''}.`);
  const issues = validateSchema(canonical, descriptor.parameters, { path });
  if (issues.length) fail('STORY_10_ACTION_INVALID', issues[0].path, issues[0].message);
  return canonical;
}

export function normalizeStory10(definition, { normalizers, actionDescriptors, bindings = {} }) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    fail('STORY_10_INVALID', '$', 'Story 1.0 definition must be an object.');
  }
  if (definition.schemaVersion !== '1.0') fail('STORY_10_INVALID', '$.schemaVersion', 'Expected Story schemaVersion 1.0.');
  if (!Array.isArray(definition.states)) fail('STORY_10_INVALID', '$.states', 'Story states must be an array.');

  const byLegacyType = normalizerMap(normalizers);
  const byCanonicalType = descriptorMap(actionDescriptors);
  const copy = structuredClone(definition);
  for (const state of copy.states) {
    for (const phase of ['enter', 'exit']) {
      if (!Array.isArray(state.map?.[phase])) fail('STORY_10_INVALID', `$.states.${state.id}.map.${phase}`, 'Story action phase must be an array.');
      state.map[phase] = state.map[phase].map((action, index) => normalizeAction(
        action,
        `$.states.${state.id}.map.${phase}[${index}]`,
        byLegacyType,
        byCanonicalType,
        bindings
      ));
    }
  }
  return deepFreeze(copy);
}
