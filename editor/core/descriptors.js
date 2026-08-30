const IMPLICIT_CORE_IDS = new Set(['core-content-v1', 'core-map-v1']);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function unsupported(path, message) {
  throw Object.assign(new Error(message), { code: 'GUI_SCHEMA_UNSUPPORTED', path });
}

function catalogOptions(source, path) {
  if (!Array.isArray(source)) unsupported(path, 'The trusted semantic option catalog is unavailable.');
  return source.map((option, index) => {
    if (typeof option === 'string') return { value: option, label: option };
    const value = option?.value ?? option?.id;
    if (typeof value !== 'string') unsupported(`${path}[${index}]`, 'Semantic options require a public string ID.');
    return { value, label: option.label ?? value };
  });
}

function scalarKind(schema, path) {
  if (Object.hasOwn(schema, 'const')) return 'const';
  if (Array.isArray(schema.enum) && schema.enum.length) return 'select';
  if (schema.type === 'string') return 'text';
  if (schema.type === 'number') return 'number';
  if (schema.type === 'integer') return 'integer';
  if (schema.type === 'boolean') return 'checkbox';
  unsupported(path, 'The descriptor schema shape is not supported by GUI V1.');
}

function buildControls(schema, value, path, catalogs, onChange, required, controls) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) unsupported(path, 'A descriptor schema must be an object.');
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false || !schema.properties || typeof schema.properties !== 'object') {
      unsupported(path, 'Only closed object descriptor schemas are supported.');
    }
    const requiredKeys = new Set(schema.required ?? []);
    for (const [key, child] of Object.entries(schema.properties)) {
      buildControls(child, value?.[key], `${path}.${key}`, catalogs, onChange, requiredKeys.has(key), controls);
    }
    return;
  }
  if (schema.type === 'array') {
    const itemSchema = schema.items;
    if (!itemSchema || itemSchema.type === 'object' || itemSchema.type === 'array') {
      unsupported(path, 'Only simple scalar arrays are supported by GUI V1.');
    }
    const itemKind = scalarKind(itemSchema, `${path}[]`);
    controls.push(freeze({
      path,
      kind: 'array',
      itemKind,
      required,
      value: clone(value ?? []),
      minItems: schema.minItems,
      maxItems: schema.maxItems,
      options: itemKind === 'select'
        ? itemSchema.enum.map((option) => ({ value: option, label: String(option) }))
        : undefined,
      set(next) { onChange(path, clone(next)); }
    }));
    return;
  }

  const kind = scalarKind(schema, path);
  let options;
  if (schema.gui?.optionsFrom !== undefined) {
    options = catalogOptions(catalogs[schema.gui.optionsFrom], `${path}.gui.optionsFrom`);
  } else if (kind === 'select') {
    options = schema.enum.map((option) => ({ value: option, label: String(option) }));
  }
  controls.push(freeze({
    path,
    kind: options ? 'select' : kind,
    required,
    readOnly: kind === 'const',
    value: clone(value ?? schema.const),
    options,
    minimum: schema.minimum,
    maximum: schema.maximum,
    pattern: schema.pattern,
    set(next) { onChange(path, clone(next)); }
  }));
}

export function isGuiAddable(descriptor) {
  return descriptor?.gui?.addable === true;
}

export function createEditorDescriptorCatalog({ registry, declarations = [], composedCatalog = {} }) {
  const installed = registry.catalog();
  const byId = new Map(installed.map((descriptor) => [descriptor.id, descriptor]));
  const declaredIds = new Set(declarations.map(({ id }) => id));
  const existing = declarations.map((declaration) => {
    const descriptor = byId.get(declaration.id);
    return freeze({
      ...(descriptor ? clone(descriptor) : { id: declaration.id, unavailable: true }),
      declaration: clone(declaration)
    });
  });
  const addable = installed
    .filter((descriptor) => !IMPLICIT_CORE_IDS.has(descriptor.id))
    .filter((descriptor) => !declaredIds.has(descriptor.id) && isGuiAddable(descriptor))
    .map(clone);
  return freeze({
    installed: installed.map(clone),
    implicit: installed.filter(({ id }) => IMPLICIT_CORE_IDS.has(id)).map(clone),
    existing,
    addable,
    actions: clone(composedCatalog.actions ?? []),
    content: clone(composedCatalog.content ?? []),
    metrics: clone(composedCatalog.metrics ?? []),
    targets: clone(composedCatalog.targets ?? [])
  });
}

export function renderSchemaControls(schema, {
  value = {},
  path = '$',
  catalogs = {},
  onChange = () => {}
} = {}) {
  const controls = [];
  try {
    buildControls(schema, value, path, catalogs, onChange, false, controls);
    return freeze({ supported: true, controls });
  } catch (error) {
    if (error?.code !== 'GUI_SCHEMA_UNSUPPORTED') throw error;
    return freeze({
      supported: false,
      code: error.code,
      path: error.path,
      message: error.message,
      controls: []
    });
  }
}
