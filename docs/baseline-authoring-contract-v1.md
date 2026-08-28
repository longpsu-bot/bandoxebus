# Baseline Authoring Contract V1

`BASELINE_AUTHORING_CONTRACT_V1: LOCKED`

An ordinary planning or map-storytelling project is authored and launched through the production application using only:

- `project.json` conforming to `PROJECT_MANIFEST_V1`;
- Story JSON using compatible Story Schema 1.0 or the Story Schema 1.1 authoring vocabulary;
- GeoJSON line, point, and polygon resources with bounded render/label descriptors;
- normalized table JSON and static metric JSON;
- declared image assets; and
- data-only settings for trusted installed capabilities.

The locked baseline comprises:

- `PROJECT_MANIFEST_V1` — `data/schemas/project-manifest-v1.schema.json` and the production project loader;
- `CORE_CONTENT_PACK_V1` — the shared content descriptors and renderers, including the six Story 1.0 blocks plus Story 1.1 table, chart, image, and legend;
- `COMMON_MAP_ACTIONS_V1` — `map.focus`, `map.set-visibility`, `map.set-emphasis`, and `map.clear-emphasis`;
- `DATA_METRIC_BINDING_V1` — normalized table/static/computed metric registries and locale formatting;
- `CAPABILITY_EXTENSION_BOUNDARY_V1` — trusted application capabilities may add validated actions, targets, metrics, roles, settings, and lifecycle without changing Generic Story Runtime or Story Shell; and
- vendored Chart.js `4.5.1` under `vendor/chart.js/4.5.1/`.

## Version and GUI policy

Story 1.0 compatibility remains supported and Route 61-2 stays byte-identical Story 1.0. New ordinary authoring uses Story 1.1. GUI Editor V1 reads, validates, previews, and writes these same production schemas and descriptors; it must not create a GUI-only schema or translation layer.

Compatible baseline additions require an explicit additive minor revision. Breaking changes require a new major contract. Capability-specific evolution remains allowed behind the trusted capability registry and does not mean the baseline is closed to future capabilities.

Certification authority: `review/well-rounded-map-story-template-v1/REPORT.md`, based on main `b504d8008550c030c2b72e2a1bc324d2a1455f7a` and post-merge CI run `33152413569`.
