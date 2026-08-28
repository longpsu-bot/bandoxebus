# Well-Rounded Map Story Template V1 — Design

Status: proposed for review

Date: 2026-08-28

Baseline: `main` at `33a85ff7fc789ca3d0da9e78e7369b570320cf75`

Post-merge baseline CI: `33131626739` — PASS

## 1. Goal and scope

Well-Rounded Map Story Template V1 defines the stable, serializable authoring contract that GUI Editor V1 will write and the production runtime will consume directly. It targets the common 80–90% of transport-planning and map-storytelling projects: mapped lines, points, polygons and context; narrative and KPI content; simple evidence tables, charts, images and legends; semantic camera and visibility actions; declared metrics; and reusable transport comparison behavior.

The result is five coordinated contracts:

1. `PROJECT_MANIFEST_V1`
2. `CORE_CONTENT_PACK_V1`
3. `COMMON_MAP_ACTIONS_V1`
4. `DATA_METRIC_BINDING_V1`
5. `CAPABILITY_EXTENSION_BOUNDARY_V1`

Together they are `BASELINE_AUTHORING_CONTRACT_V1`.

This document is architecture only. It does not implement the contracts, start GUI Editor work, alter production behavior, or redesign the certified Generic Story Runtime V1, Story Shell V1, one-map lifecycle, responsive layout, Story ↔ Explore lifecycle, legacy fallback, Route 61-2 benchmark, or performance architecture.

Success means that, after implementation, an ordinary project can be created, deployed and edited without changing JavaScript or HTML. Unusual behavior remains a trusted developer-built capability.

## 2. Current architecture

The certified baseline establishes:

- one persistent MapLibre instance shared by Explore, Story Shell and legacy presentation;
- a generic runtime whose state IDs are opaque and whose state order, content, and enter/exit action arrays come from Story JSON;
- a generic action runner with injected project action validators and handlers;
- four layouts and six safe structured content blocks;
- a responsive Story Shell with deterministic Story ↔ Explore lifecycle;
- a Route 61-2 project adapter that demonstrates route modes, semantic focus, POI emphasis, urban context and route reveal;
- stable performance with no settled-state map churn.

The Route 61-2 certification concluded `READY_TO_LOCK_STORY_SCHEMA_V1` and `PROJECT_MANIFEST_REQUIRED`. Its portability audit identifies the exact remaining blockers: fixed Story path, project metadata, initial camera, dataset URLs, focus resolution, attribution, locale, and GUI-invisible action/metric catalogs. These are project-composition concerns, not reasons to alter Story state semantics.

## 3. Design principles

1. **Common cases are declarative.** Ordinary content, map resources, focus, formatting and actions belong in the baseline contracts.
2. **Special cases are capabilities.** A special concept is not promoted into the baseline until repeated use proves it general.
3. **Configuration contains data, never executable code.** No functions, expressions, callbacks, HTML, module paths, `eval`, or user-authored JavaScript appear in project or Story files.
4. **The application is the trust boundary.** The deployed application owns the capability registry and library versions.
5. **One source of authoring truth.** Production runtime validation and GUI discovery use the same JSON Schemas/descriptors.
6. **Stable semantic IDs replace code switches.** Stories refer to focus, datasets, assets and metrics by manifest-declared IDs.
7. **References stay small and composable.** `project.json` points to Story, spatial data, normalized tables and assets rather than embedding a whole project.
8. **Integration first.** Native HTML renders tables, legends and image semantics; MapLibre renders maps; Chart.js renders the deliberately small chart vocabulary.
9. **Fail before partial launch.** Structural and reference errors are reported before the interactive experience starts.
10. **Preserve the benchmark.** Route 61-2 migrates incrementally and its existing Story JSON remains valid unchanged.

## 4. Compared approaches

| Approach | Advantages | Costs and risks | Decision |
| --- | --- | --- | --- |
| **A — Giant project JSON** | One file to copy; trivial first fetch; atomic in a narrow sense | Large diffs; awkward binary/media handling; duplicated data; poor cacheability; difficult asset replacement; merge conflicts; encourages unrelated concerns and large GUI saves | Reject. It optimizes file count at the expense of maintainability and authoring safety. |
| **B — Manifest + referenced resources + trusted capability registry** | Small identity/composition root; reusable Story and datasets; deterministic validation; safe known behaviors; direct GUI/runtime parity; incremental Route 61-2 migration; static hosting remains sufficient | Requires reference resolution and coordinated validation; capability registry is part of the application build | Recommend. It matches current injected adapters while making their inputs serializable. |
| **C — Manifest with arbitrary plugin/module paths** | Maximum per-project flexibility; a deployment can load project code without rebuilding the app | Remote-code and supply-chain risk; non-reproducible behavior; CORS/version failures; GUI cannot understand arbitrary code; validation and lifecycle become unknowable; configuration stops being portable data | Reject. Developer extensions are allowed only when compiled/installed in the trusted application registry and selected by ID. |

Option B is the only approach that is both broad enough for GUI-authored projects and narrow enough to keep the generic runtime safe and comprehensible.

## 5. Recommended architecture

```text
./project.json (default deployment entry)
        │
        ├── identity and locale
        ├── primary Story reference
        ├── map defaults
        ├── datasets and assets
        ├── focus targets
        ├── static metric catalog
        ├── capability declarations
        └── attribution/provenance
        │
        ▼
Project loader + validator + reference resolver
        │
        ▼
Trusted capability registry
        ├── core-content-v1 (implicit baseline)
        ├── core-map-v1 (implicit baseline)
        ├── route-comparison-v1 (optional)
        ├── urban-context-v1 (optional)
        └── application-installed extensions (optional)
        │
        ▼
Validated project definition
        ├── merged action descriptors/handlers
        ├── resource and focus registries
        ├── resolved metrics/data bindings
        └── Story 1.0 or 1.1 definition
        │
        ▼
Generic Story Runtime → Story Shell → persistent MapLibre map
```

`app.js` becomes a small composition root. Loading, schema validation, resource resolution, capability composition and project-specific adapters remain separate modules with focused contracts.

`core-content-v1` and `core-map-v1` are mandatory baseline capabilities composed automatically by the application for every valid project. They are not manifest options and cannot be removed, replaced or repeated in `capabilities`. The manifest array declares only optional installed packs. This makes baseline Story rendering and generic map behavior deterministic while keeping route, urban-context and special behavior opt-in.

### V1 deployment decision

A deployment has exactly one primary `./project.json`, loaded by default. It can contain a primary Story plus a collection shape that does not prevent multiple Story references later, but V1 launches only the declared primary Story. V1 does not require a project database, CMS, registry service, or `?project=` selection. A future selector can choose a different manifest URL without changing the manifest contract.

Package resource paths are relative to `project.json`. Runtime resource `src` values are same-origin package-relative paths in V1; external provenance URLs are allowed in attribution. This keeps an exported project reproducible and avoids runtime CORS dependence for authored data.

## 6. Project Manifest V1

`PROJECT_MANIFEST_V1` is a JSON document with `schemaVersion: "1.0"`. All objects reject unknown properties unless a capability-owned `settings` schema explicitly allows them.

An illustrative complete shape is:

```json
{
  "schemaVersion": "1.0",
  "id": "route-61-2",
  "title": "Route 61-2 realignment",
  "subtitle": "Existing and proposed service",
  "description": "Planning evidence and route comparison.",
  "locale": "vi-VN",
  "organization": "Example transport authority",
  "author": "Planning team",
  "projectDate": "2026-08-28",
  "projectVersion": "1.0",
  "stories": {
    "primary": "main",
    "items": [
      { "id": "main", "src": "./stories/main.story.json" }
    ]
  },
  "map": {
    "basemap": "openfreemap-dark",
    "initialView": {
      "center": [106.63, 11.06],
      "zoom": 10.7,
      "pitch": 46,
      "bearing": -18
    },
    "minZoom": 8,
    "maxZoom": 18
  },
  "datasets": {
    "existing-route": {
      "type": "geojson",
      "geometry": "line",
      "src": "./data/existing-route.geojson",
      "role": "route.existing",
      "label": "Existing route",
      "render": {
        "type": "line",
        "color": "#e7a84b",
        "width": 4,
        "lineStyle": "solid"
      },
      "attribution": ["transport-authority"]
    },
    "proposed-route": {
      "type": "geojson",
      "geometry": "line",
      "src": "./data/proposed-route.geojson",
      "role": "route.proposed",
      "label": "Proposed route",
      "render": {
        "type": "line",
        "color": "#2bb7ff",
        "width": 4,
        "lineStyle": "solid"
      },
      "attribution": ["transport-authority"]
    },
    "stops": {
      "type": "geojson",
      "geometry": "point",
      "src": "./data/stops.geojson",
      "label": "Stops",
      "render": {
        "type": "point",
        "color": "#ffffff",
        "radius": 5,
        "label": {
          "field": "name",
          "minZoom": 12,
          "placement": "point"
        }
      },
      "attribution": ["transport-authority"]
    },
    "demand-by-year": {
      "type": "table-json",
      "src": "./data/demand-by-year.json",
      "label": "Annual demand",
      "attribution": ["survey-2026"]
    }
  },
  "assets": {
    "site-photo": {
      "type": "image",
      "src": "./assets/site-photo.webp",
      "mediaType": "image/webp",
      "attribution": ["planning-team-photo"]
    }
  },
  "focusTargets": {
    "overview": {
      "type": "datasets",
      "datasets": ["existing-route", "proposed-route", "stops"],
      "camera": { "maxZoom": 12, "pitch": 30, "bearing": 0 }
    },
    "connections": {
      "type": "datasets",
      "datasets": ["proposed-route", "stops"],
      "camera": { "maxZoom": 14 }
    }
  },
  "metrics": {
    "src": "./data/metrics.json"
  },
  "capabilities": [
    { "id": "route-comparison-v1" }
  ],
  "attribution": {
    "transport-authority": {
      "name": "Example transport authority",
      "url": "https://example.org/data",
      "license": "Used with permission",
      "updated": "2026-08-20",
      "notes": "Route survey geometry."
    },
    "survey-2026": {
      "name": "Passenger survey 2026",
      "url": "https://example.org/survey",
      "updated": "2026-07-31"
    },
    "planning-team-photo": {
      "name": "Planning team field survey",
      "updated": "2026-08-10"
    }
  }
}
```

Identity requires `schemaVersion`, `id`, `title`, `locale`, `stories`, `map`, `datasets`, `assets`, `focusTargets`, `capabilities`, and `attribution`; the contained registries may be empty when the project does not need them. `capabilities` contains only optional capability declarations and may therefore be `[]`; declaring reserved `core-content-v1` or `core-map-v1` is a validation error because the application already composes them. Subtitle/description, organization/author, date and project version are optional display metadata. Dates use ISO `YYYY-MM-DD` strings and are not interpreted as executable schedules.

`basemap` is a trusted application-owned basemap ID, not a style URL or module path. The initial camera uses `[longitude, latitude]`, finite numbers, zoom 0–24, pitch 0–72, and bearing -360–360. `minZoom` and `maxZoom` are optional and must contain the initial zoom.

The runtime selects `stories.primary` from `stories.items`. V1 requires at least one item and unique IDs. Additional items may be stored/exported, but no V1 navigation UI is implied.

## 7. Dataset/resource model

### Dataset kinds

V1 supports:

- `geojson` with declared `geometry`: `line`, `point`, `polygon`, or `mixed`;
- `table-json` using the normalized tabular contract below.

Building/context data is ordinary GeoJSON, and image/media files are assets rather than datasets. `role` is optional for datasets rendered or bound only by the implicit core capabilities. An optional capability descriptor may require semantic roles such as `route.existing`, `route.proposed`, `context.buildings`, or `context.area`; when that capability is declared, the required roles must be present, unique where its descriptor says so, and compatible with the declared resource/geometry types. Roles do not change a dataset's storage type.

Each dataset has a stable manifest key, required `type`, `src`, and `label`, plus optional `role`, `render`, `attribution`, and `required` (default `true`). IDs are unique within their registry and follow `^[a-z][a-z0-9-]*$`.

### Safe generic rendering

`core-map-v1` can render ordinary GeoJSON without project code when the dataset has a `render` descriptor:

- `line`: color, width, opacity and `solid|dashed` line style;
- `point`: fill color, radius, stroke color and stroke width;
- `fill`: fill color, opacity, outline color and outline width;
- `fill-extrusion`: excluded from the generic V1 renderer; a trusted context capability owns it.

Values are bounded primitives, not MapLibre expressions, raw layer objects, filters, event callbacks or shader configuration. Authored colors are restricted to `#RRGGBB` or `#RRGGBBAA` values; arbitrary CSS strings are not accepted. A capability may claim a role and render it itself; the validator rejects two capabilities claiming the same render responsibility.

Any `line`, `point`, or `fill` render descriptor may include one optional read-only feature label:

```json
{
  "label": {
    "field": "name",
    "minZoom": 12,
    "placement": "point"
  }
}
```

`field` is a required top-level GeoJSON property name. `minZoom` is optional and bounded to 0–24. `placement` is one of `auto`, `point`, `line`, or `centroid`; it must be compatible with the dataset geometry, while `auto` selects `point` for points, `line` for lines and `centroid` for polygons. Mixed-geometry datasets may use only `auto`. The renderer owns collision handling, typography, contrast halo and safe conversion of scalar string/number/boolean values. Null or missing values omit that feature's label, while a field absent from every feature is a load-time validation error. There are no templates, concatenation, nested property paths, raw MapLibre expressions, per-feature styles or authored font URLs.

Baseline V1 feature labels are non-interactive. Generic click inspection and author-configured popups are explicitly deferred: their field selection, value formatting, links, mobile interaction and accessibility contract require a separate evidenced design. Trusted optional capabilities may continue to provide bounded read-only inspection, including the existing Route 61-2 popups, without making popup configuration part of `core-map-v1`.

The public authored target is a dataset ID or capability-declared logical target ID, never a private MapLibre source/layer ID. Capabilities may create several internal layers for one target without changing Story data.

### Assets

V1 assets support `type: "image"`, package-relative `src`, declared image MIME type, and attribution references. The runtime verifies that Story blocks reference declared assets. Gallery, audio and video behavior is deferred.

### Normalized tabular JSON

Runtime V1 consumes deterministic JSON rather than office files:

```json
{
  "schemaVersion": "1.0",
  "columns": [
    { "id": "year", "label": "Year", "type": "integer" },
    { "id": "boardings", "label": "Boardings", "type": "number", "unit": "passengers" }
  ],
  "rows": [
    { "year": 2024, "boardings": 840000 },
    { "year": 2025, "boardings": 910000 }
  ]
}
```

Column types are `text`, `integer`, `number`, `boolean`, and `date`. Every row is an object keyed by declared column IDs; missing values are `null`. Unknown row keys and duplicate column IDs are errors. Importing Excel, CSV or pasted tables and converting them to this format is a GUI concern.

CSV runtime support is deferred. A CSV parser, delimiter/encoding rules, type inference and locale ambiguity add failure modes without increasing the production contract's expressive power. GUI export to normalized JSON is simpler and reproducible.

## 8. Focus target model

`focusTargets` is a manifest registry of stable semantic IDs. `map.focus` resolves only through this registry. V1 has three mutually exclusive target forms:

```json
{
  "route-corridor": {
    "type": "datasets",
    "datasets": ["existing-route", "proposed-route"],
    "camera": { "maxZoom": 13, "pitch": 35, "bearing": -10, "padding": 32 }
  },
  "town-center": {
    "type": "coordinate",
    "center": [106.64, 11.05],
    "zoom": 15,
    "camera": { "pitch": 25, "bearing": 0 }
  },
  "study-area": {
    "type": "bounds",
    "bounds": [[106.55, 10.98], [106.72, 11.14]],
    "camera": { "maxZoom": 14, "padding": 40 }
  }
}
```

`datasets` fits the combined validated geometries. `coordinate` uses explicit center and zoom. `bounds` uses southwest/northeast coordinates. Camera hints are finite and bounded; `padding` is 0–256 CSS pixels, `maxZoom` is 0–24, pitch is 0–72, and bearing is -360–360. Story-level `map.focus.camera` may narrow presentation-specific pitch, bearing or max zoom but cannot exceed manifest/application bounds. Story Shell layout padding is still added by the existing shell integration.

This removes `targetCoordinates()` project switches. Derived focus such as “changed route sections” is exposed by `route-comparison-v1` as a capability-provided focus target descriptor; the generic runtime still receives only the semantic ID.

## 9. Core Content Pack V1

Existing layouts remain unchanged: `hero`, `metrics`, `narrative`, and `map-focus`.

Existing blocks remain unchanged: `eyebrow`, `heading`, `paragraph`, `stat-group`, `callout`, and `disclosure`.

Story Schema 1.1 adds four small blocks.

### Table V1

```json
{
  "type": "table",
  "title": "Affected stops",
  "caption": "Changes in the proposed alignment",
  "data": {
    "dataset": "affected-stops",
    "columns": [
      { "field": "name", "header": "Stop", "align": "start", "format": { "type": "text" } },
      { "field": "status", "header": "Status", "align": "start", "format": { "type": "text" } },
      { "field": "daily_boardings", "header": "Daily boardings", "align": "end", "format": { "type": "integer" } }
    ]
  },
  "source": "survey-2026"
}
```

The renderer creates semantic `<table>`, `<caption>`, `<thead>`, `<tbody>`, `<th scope="col">` and `<td>` elements. `title`, `caption`, and `source` are optional; at least one selected column is required. Alignment is `start|center|end`. V1 has no pivoting, sorting UI, formulas, merged cells, pagination or HTML cells.

### Chart V1

```json
{
  "type": "chart",
  "chartType": "bar",
  "title": "Annual passenger demand",
  "description": "Demand increased in each observed year.",
  "data": {
    "dataset": "demand-by-year",
    "x": "year",
    "series": [
      { "y": "boardings", "label": "Boardings", "format": { "type": "integer" } }
    ]
  },
  "xLabel": "Year",
  "yLabel": "Passengers",
  "stacking": "none",
  "source": "survey-2026"
}
```

`chartType` is `bar`, `line`, or `area`. `area` maps to a line dataset with fill. Multiple bar series are grouped by default; `stacking: "stacked"` is allowed only for bar charts and is inexpensive in Chart.js. V1 does not expose raw Chart.js options, plugins, callbacks, mixed types, secondary axes, scatter plots or arbitrary color expressions. The renderer chooses a tested accessible palette and may accept only bounded semantic tone tokens in a later compatible descriptor revision.

Chart.js is recommended. Its built distribution works with a static browser deployment, its ordinary data shape directly supports labels and multiple datasets, it supports responsive bar/line charts, and area is a documented line fill mode. The application should vendor and pin the selected Chart.js distribution rather than depend on a mutable CDN at runtime. The renderer owns the narrow translation from the Story block to Chart.js options and disables unnecessary animation when reduced motion is requested.

Apache ECharts is mature and supports direct script inclusion plus richer built-in ARIA/decal behavior, but its much broader option surface encourages a dashboard-grade grammar beyond V1. uPlot is smaller and exceptionally strong for large time series, but categorical/grouped bars are not its simplest core use case. The template's small planning-report charts favor Chart.js familiarity and directness over those advantages. Official references: [Chart.js installation](https://www.chartjs.org/docs/latest/getting-started/installation), [Chart.js usage](https://www.chartjs.org/docs/latest/getting-started/usage.html), [Chart.js area charts](https://www.chartjs.org/docs/latest/charts/area.html), [Chart.js accessibility](https://www.chartjs.org/docs/latest/general/accessibility.html), [Apache ECharts browser setup](https://echarts.apache.org/handbook/en/get-started/), [Apache ECharts ARIA](https://echarts.apache.org/handbook/en/best-practices/aria/), and [uPlot](https://github.com/leeoniya/uPlot).

Because canvas pixels are not screen-reader content, every chart requires `title` and either `description` or a generated textual summary. The canvas receives `role="img"` and an accessible name, and the source data is available as fallback text or an adjacent visually hidden table. This requirement belongs to the core renderer, not individual projects.

### Image V1

```json
{
  "type": "image",
  "asset": "site-photo",
  "alt": "Bus stop beside the proposed interchange",
  "caption": "Existing passenger waiting area",
  "source": "planning-team-photo"
}
```

`asset` must resolve to a manifest image. `alt` is required; it may be an empty string only when the author explicitly marks the image decorative with `decorative: true`. Caption and source are optional. The renderer uses `<figure>`, `<img>` and `<figcaption>`. No gallery, lightbox, video player or arbitrary embed exists in V1.

### Legend V1

```json
{
  "type": "legend",
  "title": "Route changes",
  "items": [
    { "sample": { "type": "line", "color": "#2bb7ff", "lineStyle": "solid" }, "label": "Added", "description": "New alignment" },
    { "sample": { "type": "line", "color": "#e7a84b", "lineStyle": "dashed" }, "label": "Removed" },
    { "sample": { "type": "swatch", "color": "#7393a7" }, "label": "Retained" }
  ]
}
```

Samples are `swatch`, `line`, or `icon`. A swatch/line accepts a validated hex color and `solid|dashed`; an icon references a declared image asset. Label is required and description is optional. V1 legends are author-specified. Automatic introspection of MapLibre styles is deferred.

## 10. Common Map Actions V1

Action availability is capability-driven. Actions from implicit `core-map-v1` are always available; actions from optional packs are available only when the manifest declares the pack and its inputs validate. The Story Runtime continues to dispatch ordered `enter` and `exit` arrays by opaque action `type`.

### Generic actions from `core-map-v1`

| Action | Parameters | Meaning |
| --- | --- | --- |
| `map.focus` | `target`; optional bounded `camera` | Focus a manifest or capability-provided semantic target. |
| `map.set-visibility` | `target`; `visible` boolean | Show/hide a declared dataset or capability logical target. |
| `map.set-emphasis` | `target`; `active` boolean | Apply/remove the standard emphasis treatment without changing base visibility. |
| `map.clear-emphasis` | none | Remove all emphasis owned by generic and cooperative capability targets. |

`target` values come from the composed descriptor catalog. Actions never accept raw MapLibre layer IDs.

### Reusable actions from `route-comparison-v1`

| Action | Parameters | Meaning |
| --- | --- | --- |
| `route.set-mode` | `mode`: `existing|proposed|difference|compare` | Select a route comparison presentation. |
| `route.reveal` | `target`; `active`; optional non-negative `delayMs` | Reveal/cancel a declared route target, respecting reduced motion. |
| `transport.set-poi-emphasis` | `target`; `active` | Emphasize a declared point/transport-node target. |

The capability requires appropriate semantic dataset roles and advertises only the modes supported by the resolved project inputs. A project without `route-comparison-v1` cannot author these actions.

Ordinary building/context visibility uses `map.set-visibility`. `urban-context-v1` may additionally expose a small `context.set-mode` action when it manages coordinated 3D/fallback rendering. It must describe its own modes. Generic Story semantics do not mention industrial areas, buildings, hospitals, entrances, terminal bays or Route 61-2.

### Route 61-2 compatibility

Canonical capabilities are the only action-handler owners. Story 1.0 compatibility is a separate versioned validation/normalization registry that runs once during project loading, before the Generic Story Runtime receives the definition. It does not register legacy handlers, does not claim canonical action ownership and is not exposed in the Story 1.1 GUI catalog. Duplicate ownership of a legacy normalizer is also rejected.

For the declared Route 61-2 capability set, the composed Story 1.0 normalizers validate the existing descriptors with their exact current parameter shapes and produce canonical descriptors:

| Existing Story 1.0 descriptor | Canonical result |
| --- | --- |
| `map.mode { mode }` | `route.set-mode { mode }` |
| `map.focus { target, camera? }` | unchanged `map.focus { target, camera? }`, dispatched to the sole `core-map-v1` handler |
| `map.poi-emphasis { active }` | `transport.set-poi-emphasis { target: <Route 61-2 POI target>, active }` |
| `map.urban-context { mode }` | `context.set-mode { mode }` |
| `route.reveal { active, delayMs? }` | `route.reveal { target: <Route 61-2 proposed-route target>, active, delayMs? }` |

`core-map-v1` supplies the pass-through `map.focus` normalizer. The optional route/transport/context capabilities supply normalizers only for the legacy descriptors they understand. The Route 61-2 manifest binds the normalizers' default targets through semantic roles/settings: its `route.proposed` dataset is the reveal target and its declared connection-POI target is the POI-emphasis target. These resolve to the same proposed route and POI collection used today; they are project bindings, not new Story fields or global assumptions. Normalization preserves array order, enter/exit phase, camera values, delay and lifecycle. Each normalized action is then validated against the canonical capability descriptor before launch. Thus `core-map-v1` owns exactly one `map.focus` handler, `route-comparison-v1` owns exactly one `route.reveal` handler, and duplicate action ownership remains an error.

New Story 1.1 content uses only canonical action descriptors. The Story 1.0 normalizer registry exists solely for certified backward compatibility, beginning with the checked-in Route 61-2 Story; it is not a general alias system.

## 11. Metric/Data Binding V1

The runtime builds one read-only metric registry from static/precomputed metrics and capability-computed metrics. Stories bind by stable metric ID and never know how a value was produced.

### Static metrics

`metrics.src` points to:

```json
{
  "schemaVersion": "1.0",
  "metrics": {
    "annual-passengers": {
      "label": "Annual passengers",
      "value": 910000,
      "format": { "type": "integer" },
      "attribution": ["survey-2026"]
    },
    "service-area-share": {
      "label": "Population served",
      "value": 0.64,
      "format": { "type": "percentage", "decimals": 0 }
    }
  }
}
```

Values are string, finite number, boolean or `null`. There are no expressions, cross-metric references or formulas.

### Capability-computed metrics

A capability descriptor declares the metric IDs it can produce, their labels, value types, default formats and required inputs. Its trusted implementation computes them after resources resolve. `route-comparison-v1`, for example, can expose existing/proposed length, length delta and stop counts. The manifest does not duplicate those computations.

Static and computed metric IDs share one namespace. Duplicate IDs are a project validation error unless the capability explicitly declares a documented override policy; the baseline capabilities declare none. A Story reference to an unknown metric is invalid before launch.

### Formatting

The common formatting descriptor is:

```json
{ "type": "decimal", "decimals": 1, "unit": "passengers" }
```

Supported types are:

- `integer`: locale-aware integer;
- `decimal`: locale-aware number with `decimals` 0–3;
- `percentage`: stored as a fraction and rendered as a locale-aware percentage, `decimals` 0–2;
- `distance`: stored in meters, rendered in `m` or `km` using deterministic thresholds, `decimals` 0–2;
- `currency`: finite number plus required ISO 4217 `currency` code, formatted in project locale;
- `text`: string output with no HTML interpretation.

Project locale supplies separators and language conventions through `Intl.NumberFormat`. The application does not embed `vi-VN`. Formatting is shared by stat groups, tables, chart axes/tooltips and accessible chart summaries.

### Table and chart bindings

Tables and charts bind directly to declared normalized table columns. The validator verifies dataset type, column existence, compatible column types, and formatting. A block may select/relabel columns but cannot filter, aggregate, join or calculate. Such transformations happen during GUI import/preparation or inside a trusted capability and are saved as deterministic output.

## 12. Capability Extension Boundary V1

The application owns a registry keyed by exact capability ID:

```text
capabilityRegistry[id] = {
  descriptor,       // serializable, safe for GUI/runtime validation
  createCapability // trusted application code, never project data
}
```

A capability may register:

- required/optional dataset roles and supported resource types;
- a schema for its manifest `settings` object;
- action descriptors and handlers;
- optional Story 1.0-only validation/normalization descriptors for certified legacy actions, kept separate from handler ownership;
- logical map targets and focus targets;
- MapLibre sources/layers/renderers it owns;
- map-load, project-activate, Story action, reset and destroy lifecycle behavior;
- computed metric descriptors and providers;
- GUI labels, descriptions, groups, defaults and control hints.

It may not replace Generic Story Runtime state semantics, create a second map, inject executable values into authored data, access undeclared resources silently, or add action types without descriptors.

Manifest declarations contain IDs and optional data-only settings:

```json
{
  "id": "facility-access-analysis-v1",
  "settings": {
    "facilityDataset": "hospital-building",
    "entranceDataset": "entrances",
    "accessPathDataset": "access-paths"
  }
}
```

The registry decides whether that ID exists and which trusted code implements it. The descriptor validates settings and any roles that optional capability requires; ordinary core-map datasets need no role. No `src`, `module`, `script`, URL or import path is permitted in a capability declaration.

Composition is deterministic: the application first installs exactly one `core-content-v1` and one `core-map-v1`, then resolves the optional manifest declarations. Manifest order is not execution authority. The project loader sorts optional capabilities by dependency order, rejects reserved core IDs in the manifest, rejects cycles and duplicate action ownership, and creates every capability once around the persistent map. Cleanup runs in reverse creation order. Core capabilities cannot be shadowed.

## 13. Capability authoring metadata

Each trusted capability exports a serializable descriptor. An illustrative descriptor is:

```json
{
  "schemaVersion": "1.0",
  "id": "route-comparison-v1",
  "label": "Route comparison",
  "description": "Compare existing and proposed routes.",
  "requires": ["core-map-v1"],
  "datasetRoles": [
    { "role": "route.existing", "types": ["geojson"], "geometry": ["line"], "required": true },
    { "role": "route.proposed", "types": ["geojson"], "geometry": ["line"], "required": true },
    { "role": "stops.existing", "types": ["geojson"], "geometry": ["point"], "required": false }
  ],
  "actions": [
    {
      "type": "route.set-mode",
      "label": "Set route mode",
      "description": "Choose the visible route comparison.",
      "parameters": {
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "mode"],
        "properties": {
          "type": { "const": "route.set-mode" },
          "mode": {
            "type": "string",
            "enum": ["existing", "proposed", "difference", "compare"],
            "description": "Comparison mode"
          }
        }
      }
    }
  ],
  "metrics": [
    { "id": "route-length-delta", "label": "Length change", "valueType": "number", "format": { "type": "distance" } }
  ]
}
```

The `parameters` object is the canonical JSON Schema fragment for both runtime action validation and GUI form generation. GUI hints may add `control: "select"|"toggle"|"number"|"target-picker"`, grouping and help text, but never weaken the schema. Dynamic options such as project target IDs are resolved by a named catalog reference in the descriptor (for example `optionsFrom: "focusTargets"`), not by executing code in the GUI.

Implementation handlers remain separate and are checked at application startup against descriptor action types. Tests assert descriptor/handler parity, so validation and dispatch cannot drift into duplicated private vocabularies.

The core content pack uses the same pattern: a serializable registry of block type, label, JSON Schema and GUI hints, paired with trusted renderers. GUI Editor therefore discovers blocks without reverse-engineering `BLOCK_RENDERERS` or hand-written validators.

## 14. Story Schema versioning

Recommend **Story Schema 1.1** for the final additive content/action authoring expansion.

Reasons:

- table, chart, image and legend are meaningful new authoring capabilities and deserve a discoverable minor version;
- `1.0` can remain immutable, making the Route 61-2 certification claim literal;
- the runtime can accept both `1.0` and `1.1` without migrating existing files;
- GUI Editor V1 has one explicit target (`1.1`) rather than relying on an evolving document labeled `1.0`;
- this follows compatible minor-version semantics: the state/content/action model does not break, but the accepted vocabulary expands.

The current `route-61-2.story.json` stays `schemaVersion: "1.0"` and remains valid byte-for-byte. The loader selects the matching Story schema, composes capability action descriptors, and normalizes both versions to the same internal runtime definition. New GUI-authored stories write `1.1`.

After implementation and certification, record:

```text
BASELINE_AUTHORING_CONTRACT_V1: LOCKED
```

Any later baseline change requires an explicit compatible minor revision or breaking major revision; capability-specific evolution does not mutate the baseline Story schema.

## 15. Static project package layout

Recommended for new exports:

```text
project.json
stories/
  main.story.json
data/
  existing-route.geojson
  proposed-route.geojson
  stops.geojson
  service-area.geojson
  metrics.json
  demand-by-year.json
  affected-stops.json
assets/
  site-photo.webp
```

This is a convention, not a semantic requirement. References are resolved relative to the manifest. Route 61-2 is not required to move existing files in the first migration; its manifest can point to current `data/stories/`, context files and existing data adapters while those are converted in bounded slices.

## 16. Generic bootstrap flow

`app.js` should orchestrate rather than own project behavior:

1. Load fixed `./project.json`.
2. Validate `PROJECT_MANIFEST_V1` and normalize resource URLs relative to the manifest.
3. Compose the mandatory `core-content-v1` and `core-map-v1`, then resolve every optional manifest capability ID from the trusted registry; reject explicit core declarations and validate dependencies, settings, required roles, action ownership and descriptor/handler parity.
4. Load the primary Story, required datasets, table data, static metrics and required assets in parallel where dependencies permit.
5. Validate resource payloads, provenance references, focus targets, metric namespace and all cross-file references.
6. Validate Story against its versioned schema; for Story 1.0 only, apply the composed compatibility normalizers from the implicit and declared capabilities, then validate the normalized output against the canonical composed action descriptors.
7. Create the persistent MapLibre instance from trusted basemap and validated manifest camera defaults.
8. Initialize capabilities in dependency order and let them register owned sources/layers/targets/metrics.
9. Compose action handlers, metric registry, content renderer registry and localized shell metadata.
10. Create the existing Generic Story Runtime and Story Shell around those registries; preserve explicit legacy fallback selection.

Recommended module boundaries are `project-loader`, `project-schema`, `resource-loader`, `capability-registry`, `capability-composer`, `metric-registry`, and the existing Story/runtime/shell modules. Exact filenames can follow repository conventions during implementation. `app.js` should contain startup wiring and application-level error presentation, not schemas, per-project switches or rendering engines.

The HTML shell uses manifest metadata after bootstrap for document title, visible title/subtitle and accessible labels. A minimal static loading label remains in HTML for pre-bootstrap and failure states.

## 17. Route 61-2 migration

Migration preserves appearance, interaction, data and performance:

1. Add a Route 61-2 `project.json` at the deployment root with current metadata, Story path, camera, provenance, capabilities and semantic targets.
2. Initially adapt existing `route-data.js`, comparison, urban context and map-layer functions behind trusted Route 61-2/known capability implementations. Do not rewrite all spatial files solely to match the recommended package layout.
3. Compose Route 61-2 Story 1.0 normalizers from the core/route/context capabilities, bind the existing POI and proposed-route targets through manifest roles/settings, and map legacy descriptors to canonical actions without registering a second handler.
4. Move hardcoded project title/subtitle/locale, initial extent, focus registry, dataset URLs and attribution into the manifest one concern at a time.
5. Convert embedded route/stops/POI values to manifest resources in a later bounded slice only when parity fixtures prove exact output.
6. Keep the same Generic Runtime, Story Shell, persistent map and legacy fallback. Re-run the certified desktop/mobile lifecycle and settled-performance envelopes after executable migration slices.

The target composition is:

```text
Route 61-2 manifest
+ unchanged Route 61-2 Story JSON
+ implicit core-content-v1 / core-map-v1
+ declared route-comparison-v1 / urban-context-v1
+ Story 1.0 compatibility normalizer
+ same Generic Story Runtime and Story Shell
```

No visual regression is required or accepted as a consequence of the template design.

## 18. Synthetic certification fixture

Create a small non-production project, for example `tests/fixtures/well-rounded-template-v1/`, using tiny deterministic data. It contains two line datasets, a point dataset, a polygon, one table dataset, static metrics and one image. Its Story 1.1 states exercise:

- a chart bound to table columns;
- a semantic HTML table bound to selected columns;
- an image with alt/caption/source;
- an authored legend with line/swatch samples;
- generic point labels bound to a GeoJSON `name` property;
- generic dataset show/hide and emphasis/reset;
- semantic focus for combined datasets, coordinate and explicit bounds;
- static and capability-computed metric binding with locale formatting.

The fixture is deliberately generic and must not alter Route 61-2's real narrative to demonstrate unused blocks.

Acceptance cases map to the contracts as follows:

| Use case | Baseline support |
| --- | --- |
| Route realignment | route roles, comparison modes, reveal, KPIs, narrative |
| Service area/context | polygon/point/building roles, focus, generic visibility, metrics, attribution |
| Route/stop rationalization | multiple line/point datasets, difference capability, affected-stops table |
| Demand/evidence | table JSON, bar/line/area chart, KPI, source |
| Network connectivity | route and transport nodes, multi-dataset focus/emphasis, legend |
| Image-supported evidence | image asset block, caption/source, map and narrative |

## 19. GUI Editor contract

After implementation, GUI Editor V1 is primarily:

```text
project manifest editor
+ Story state editor
+ content block editor
+ map action editor
+ dataset/asset manager
+ metric binding editor
+ production-runtime preview
```

The GUI reads the manifest schema, Story 1.1 schema, the two implicit core descriptors and descriptors for optional capabilities declared by the project. It always offers core content, core map actions and the bounded GeoJSON label fields; it offers optional actions only for declared capabilities and resolved project options. It validates references before save and writes the same `project.json`, Story JSON, normalized table JSON, metric JSON and assets consumed in production. Preview loads those files through the production project loader. There is no GUI-only schema or translation layer.

Capability authoring metadata can make an installed special capability editable, but GUI V1 need not create capability code or expose capabilities absent from the trusted build.

## 20. Error handling and validation

Validation occurs in layers and reports a stable code, JSON-style path and human-readable message:

1. **Manifest structure:** schema version, required fields, bounds and unknown properties.
2. **Capability composition:** implicit core installation, rejection of explicit core declarations, optional installed IDs, dependencies, cycles, settings, required roles/actions and handler parity.
3. **Resource loading:** same-origin path resolution, HTTP status, JSON parse, MIME/type expectations and required resources.
4. **Resource semantics:** GeoJSON collection/geometry/label-field compatibility, normalized table columns/rows and asset types.
5. **Cross references:** primary Story, dataset/asset/attribution IDs, capability roles, focus targets, metric IDs and table columns.
6. **Story:** versioned block schema and composed capability action parameter schemas.

The application does not initialize the interactive Story on fatal errors. It shows a safe project-load error panel and logs structured detail for developers; it never renders error text as HTML. Unknown capability IDs, action types, metric IDs and required resources are fatal.

An optional resource (`required: false`) may fail only when no Story block/action/focus target or required capability input references it. The loader records a warning and the owning capability may use a declared fallback. A capability metric computation failure does not invent a value: the affected metric renders `—`, exposes an accessible “unavailable” label, and records an error; validation still catches any unknown metric ID before launch.

Resource loaders use cancellation so a failed project load does not leave late map mutations. Capability `destroy` is idempotent. Story exit/reset actions must leave capability-owned emphasis, visibility overrides, timers and animation in their declared Explore defaults.

## 21. Testing/certification strategy

### Contract tests

- JSON Schema valid/invalid fixtures for Manifest 1.0, Story 1.0 and Story 1.1.
- Dependency-free/runtime validator parity with canonical JSON Schemas.
- Reject unknown properties, unsafe paths, arbitrary module/script fields, callbacks and expressions.
- Reference graph tests for missing/duplicate IDs, roles, columns, metrics, attribution and focus targets.
- Implicit-core composition, reserved-core declaration rejection, optional-role requirements, capability descriptor/handler parity, dependency sorting, cycle rejection and ownership collision tests.
- Story 1.0 compatibility tests proving validation and normalization into canonical actions without duplicate handlers, including insertion of the Route 61-2 reveal and POI targets.

### Rendering and accessibility tests

- DOM semantics for tables, captions, figures, alt text, legends and sources.
- Generic point/line/polygon label translation, geometry-placement validation, missing values and all-missing-field failure.
- Chart.js translation snapshots for bar, grouped/stacked bar, line and area.
- Chart accessible name, description/summary and fallback table.
- Locale formatting for every common format type and unavailable values.
- Reduced-motion chart and route reveal behavior.

### Integration tests

- Load the synthetic package through `./project.json` without JavaScript/HTML edits.
- Traverse every synthetic state and verify ordered enter/exit actions, focus, visibility, emphasis, reset and declarative labels.
- Verify one MapLibre canvas through Explore → Story → Explore and responsive reuse on desktop/mobile.
- Verify GUI-readable catalogs exactly match runtime-accepted content/action options.

### Route 61-2 regression

- Load the unchanged Story 1.0 JSON through the Route 61-2 manifest.
- Preserve seven states, content, action order, map modes, context fallback, reveal and legacy selection.
- Repeat certified desktop/mobile lifecycle checks.
- Run visual comparison at certified viewports and the existing settled performance envelope after executable changes.
- Require `npm test`, source syntax checks and `git diff --check` on each bounded implementation PR.

### Certification gates

Certification passes only if all six target use cases work without project JavaScript edits, the special facility-access acceptance test registers without runtime/shell edits, and the audit finds no arbitrary code path in authored files. Then record `BASELINE_AUTHORING_CONTRACT_V1: LOCKED`.

## 22. Backward compatibility

- Existing Story 1.0 JSON remains valid and uses the unchanged six-block/four-layout contract.
- The loader accepts Story 1.0 and 1.1; only new stories default to 1.1.
- Existing Route 61-2 action descriptors retain identical saved parameters and lifecycle; a trusted Story 1.0 normalizer maps them to the sole canonical handlers before runtime dispatch.
- The generic runtime still consumes ordered states and dispatches opaque action descriptors; no state or shell semantic changes.
- Legacy presentation fallback stays explicitly selectable.
- Manifest migration is additive around Route 61-2 and can temporarily wrap existing JS data behind trusted adapters.
- No initial file move or geometry rewrite is required.
- One persistent MapLibre instance and current performance constraints remain certification invariants.

## 23. Deferred features

- Runtime CSV/Excel import and type inference.
- Multiple-project selection and `?project=` routing.
- Multi-Story navigation UI despite the future-compatible reference collection.
- Automatic MapLibre style-to-legend introspection.
- Generic feature inspection and author-configured popups; trusted capabilities may provide bounded inspection.
- Galleries, audio, video and arbitrary embeds.
- Advanced chart types, mixed axes, arbitrary Chart.js options and dashboard composition.
- Generic feature filters, joins, aggregations and formula language.
- Capability marketplace or runtime module download.
- Generalized 3D scenes and custom WebGL behavior.

These can be added only behind an evidenced compatible contract or a trusted special capability.

## 24. Explicit non-goals

V1 is not an architectural BIM system, glTF scene editor, pedestrian or traffic simulator, terminal-bay optimizer, GIS desktop replacement, custom shader editor, user-script host, spreadsheet engine, BI dashboard builder, CMS, backend/database, multiplayer editor, plugin marketplace, branching story graph, or free-canvas editor.

Hospital entrances, terminal bays and similar domain nouns are not baseline Story Schema concepts.

### Special-case acceptance

**Question:** Can a future project add a hospital/building entrance analysis without changing Generic Story Runtime or Story Shell?

**Answer: YES.** The trusted application adds `facility-access-analysis-v1` to its capability registry. Its descriptor declares required building/entrance/access-path roles, actions, validation, metrics and GUI metadata; its implementation owns specialized layers, animation and lifecycle. The manifest selects that known ID and supplies data-only settings. The runtime continues to dispatch opaque actions and the shell continues to present ordinary states/blocks.

## 25. Implementation decomposition

This is a low-risk sequence of bounded, reviewable implementation PRs, not an implementation plan:

1. **Contract foundations:** Manifest 1.0 JSON Schema/validator, normalized table and metric schemas, safe reference resolver, and invalid/valid fixtures.
2. **Capability descriptors:** serializable core content/action descriptor format, implicit baseline composition, trusted optional registry, composition validation and descriptor/handler parity tests; add the Route 61-2 Story 1.0 validation/normalization profile without duplicate action handlers.
3. **Generic bootstrap:** project loader and small composition root consuming `./project.json`, with metadata/locale/camera/focus/attribution wiring and structured load errors.
4. **Route 61-2 manifest migration:** add the manifest around current resources/adapters and prove unchanged Story 1.0, visual behavior, lifecycle and performance.
5. **Data/metric binding:** normalized table loader, static/computed metric registry and shared locale formatter; expose existing comparison metrics through the capability boundary.
6. **Common map capability:** generic GeoJSON render and bounded label descriptors, visibility, emphasis, reset and declarative focus; then route-comparison/context capability descriptors.
7. **Core content expansion:** Story 1.1 plus table, image, legend and pinned Chart.js-backed chart renderers with accessibility tests.
8. **Synthetic fixture:** one complete static package exercising all baseline contracts and six target use cases without source edits.
9. **Template certification:** schema/runtime/GUI-catalog parity, special-extension test, Route 61-2 regression, responsive lifecycle, accessibility and performance evidence.
10. **Contract lock:** record `BASELINE_AUTHORING_CONTRACT_V1: LOCKED`; only after review and approval begin GUI Editor V1 design.

No slice should combine the entire migration and content expansion. Each PR must leave Route 61-2 deployable and preserve the certified runtime/shell boundaries.

## Design self-review

- No incomplete design marker, executable project configuration or arbitrary module path is present.
- Existing Route 61-2 Story 1.0 remains valid unchanged.
- Story 1.0 compatibility normalizes into canonical handlers without duplicate action ownership.
- Core content/map capabilities are implicit; the manifest contains optional packs only, and ordinary core datasets do not require roles.
- Basic GeoJSON property labels are declarative, while generic inspection/popups are explicitly deferred.
- Special facility/entrance behavior remains a trusted extension.
- A new basic project can launch from static files without JavaScript or HTML edits.
- GUI discovery comes from the same content/action/capability schemas used for runtime validation.
- All authoring data is JSON-serializable; image files are referenced assets.
- The common baseline covers all six acceptance cases without becoming a universal GIS, spreadsheet or dashboard platform.
- The package and migration strategy avoid unnecessary Route 61-2 file moves.

`DESIGN_RESULT: READY_FOR_REVIEW`
