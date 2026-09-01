export const COMPACT_ATTRIBUTION_OPTIONS = Object.freeze({ compact: true });

export function startCompactAttributionCollapsed(map) {
  const collapse = () => {
    const control = map?.getContainer?.().querySelector?.(
      '.maplibregl-ctrl-attrib.maplibregl-compact.maplibregl-compact-show'
    );
    control?.querySelector?.('summary.maplibregl-ctrl-attrib-button')?.click?.();
  };
  if (map?.loaded?.()) collapse();
  else map?.once?.('load', collapse);
  return map;
}
