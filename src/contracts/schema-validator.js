function issue(code, path, message) {
  return Object.freeze({ code, path, message });
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value, type) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function isIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function visit(value, schema, path, issues) {
  if (schema.type && !matchesType(value, schema.type)) {
    issues.push(issue('TYPE', path, `Expected ${schema.type}, received ${valueType(value)}.`));
    return;
  }

  if (Object.hasOwn(schema, 'const') && !Object.is(value, schema.const)) {
    issues.push(issue('CONST', path, 'Value does not match the required constant.'));
  }

  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    issues.push(issue('ENUM', path, 'Value is not one of the allowed values.'));
  }

  if (schema.required && matchesType(value, 'object')) {
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) {
        issues.push(issue('REQUIRED', `${path}.${key}`, 'Required property is missing.'));
      }
    }
  }

  if (schema.properties && matchesType(value, 'object')) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, key)) visit(value[key], childSchema, `${path}.${key}`, issues);
    }
  }

  if (matchesType(value, 'object')) {
    const properties = schema.properties ?? {};
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(properties, key)) continue;
      const childPath = `${path}.${key}`;
      if (schema.additionalProperties === false) {
        issues.push(issue('ADDITIONAL_PROPERTY', childPath, 'Unknown property is not allowed.'));
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        visit(value[key], schema.additionalProperties, childPath, issues);
      }
    }
  }

  if (schema.items && Array.isArray(value)) {
    value.forEach((item, index) => visit(item, schema.items, `${path}[${index}]`, issues));
  }

  if (schema.minItems !== undefined && Array.isArray(value) && value.length < schema.minItems) {
    issues.push(issue('MIN_ITEMS', path, `Expected at least ${schema.minItems} item(s).`));
  }

  if (schema.pattern && typeof value === 'string' && !(new RegExp(schema.pattern)).test(value)) {
    issues.push(issue('PATTERN', path, `Value does not match pattern ${schema.pattern}.`));
  }

  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) {
    issues.push(issue('MINIMUM', path, `Value must be at least ${schema.minimum}.`));
  }

  if (schema.maximum !== undefined && typeof value === 'number' && value > schema.maximum) {
    issues.push(issue('MAXIMUM', path, `Value must be at most ${schema.maximum}.`));
  }

  if (schema.format === 'date' && typeof value === 'string' && !isIsoDate(value)) {
    issues.push(issue('FORMAT_DATE', path, 'Value must be a valid ISO date (YYYY-MM-DD).'));
  }
}

export function validateSchema(value, schema, { path = '$' } = {}) {
  const issues = [];
  visit(value, schema, path, issues);
  return Object.freeze(issues);
}
