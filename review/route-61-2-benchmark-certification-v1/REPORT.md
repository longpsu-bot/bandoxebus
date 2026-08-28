# ROUTE_61_2_BENCHMARK_CERTIFICATION_V1

## Baseline

- main SHA: `1ad6428a9c05988e1ffc547dd0732006220d3040`
- certification branch: `cert/route-61-2-benchmark-v1`, created directly from `origin/main`
- baseline tests: 138/138
- certification tests: 143/143, including 5/5 certification-only benchmark evidence tests
- source syntax: 22/22
- post-merge CI authority: run `33060944693` — PASS
- Story Shell status: default guided experience; initial application mode remains Explore; `?storyShell=legacy` retains the legacy presentation
- map composition: one persistent MapLibre instance
- performance authority: Story Shell Promotion V1 at 1920×1080, 59.9 typical / 59.5 sustained-low / 60.0 average FPS over 4.001 seconds, with zero MapLibre renders, `triggerRepaint()` calls, or GeoJSON `setData()` mutations after settling
- certification branch performance rerun: not required because this branch changes only report/test evidence and no executable runtime or production data

## Contract inventory

### Story

| Contract item | Classification | Evidence |
| --- | --- | --- |
| `schemaVersion`, story `id`, `title`, ordered non-empty `states` | GENERIC | `data/stories/story.schema.json`; `src/story-schema.js` |
| Stable arbitrary state IDs and array-defined order | GENERIC | `src/story-runtime.js`; `tests/story-runtime.test.mjs` |
| Structured `content` plus `map.enter` / `map.exit` per state | GENERIC | schema and runtime |
| Project action-contract injection during validation | PROJECT ADAPTER | `validateStoryDefinition(..., { actionContracts })` in `src/story-schema.js` |
| Route 61-2 story content | PROJECT ADAPTER | `data/stories/route-61-2.story.json` |
| Fixed production story fetch path | HARDCODED PROJECT ASSUMPTION | `initialize()` in `src/app.js:960` |
| Future schema versions and registry additions | DEFERRED EXTENSION | V1 explicitly accepts only `1.0` |

### Content

| Contract item | Classification | Evidence |
| --- | --- | --- |
| Ordered blocks and four layouts: `hero`, `metrics`, `narrative`, `map-focus` | GENERIC | schema, validator, and renderer |
| Six blocks: `eyebrow`, `heading`, `paragraph`, `stat-group`, `callout`, `disclosure` | GENERIC | schema, validator, and `BLOCK_RENDERERS` |
| Numeric metric lookup supplied separately from story JSON | PROJECT ADAPTER | `buildPresentationMetrics(...)` in `src/app.js:60`; `resolvePresentationMetric(...)` in the renderer path |
| Vietnamese uppercase locale in the otherwise generic renderer | HARDCODED PROJECT ASSUMPTION | `toLocaleUpperCase('vi-VN')` in `src/presentation-renderer.js:17`; not Route 61-2 semantics, but not project-configurable |
| Charts, tables, story legends, and media blocks | DEFERRED EXTENSION | no V1 schema or renderer registry entry |

### Actions

| Contract item | Classification | Evidence |
| --- | --- | --- |
| Ordered dispatch by action `type`, transition context, exit-before-enter lifecycle | GENERIC | `src/story-action-runner.js`; `src/story-runtime.js` |
| Route 61-2 action types and validators | PROJECT ADAPTER | `src/route-61-2-story-actions.js` |
| Route modes, semantic focus values, urban-context values | PROJECT ADAPTER | private enum sets in `src/route-61-2-story-actions.js:1-10` |
| Semantic focus resolution to project geometry | HARDCODED PROJECT ASSUMPTION | `targetCoordinates()` in `src/app.js:688-705` |
| New action types and parameter schemas | DEFERRED EXTENSION | generic runner accepts injected registries without runtime changes |

### Project/data

| Contract item | Classification | Evidence |
| --- | --- | --- |
| Route, stop, and POI values exported from one route data module | PROJECT ADAPTER | `src/route-data.js` |
| Comparison and presentation metrics derived from supplied values | GENERIC | comparison/metrics modules and fixture-driven tests |
| Industrial-context controller | GENERIC capability with PROJECT ADAPTER inputs | `createUrbanContextController({ zone, overtureBuildings, routeCoordinates, pois })` |
| Industrial polygon URL, Overture URL/AOI identity, fallback seed | HARDCODED PROJECT ASSUMPTION | `src/app.js:964`; `src/overture-buildings.js:3,49`; `src/urban-context.js:15` |
| Project manifest, dataset declarations, focus registry, metadata/attribution registry | DEFERRED EXTENSION and current portability blocker | no serialized project contract exists |

### Shell/responsive

| Contract item | Classification | Evidence |
| --- | --- | --- |
| Step generation, total/progress, Previous/Next boundaries, keyboard, observer selection, enter/exit | GENERIC | `src/story-shell.js` |
| Same runtime definition across viewport sizes | GENERIC | shell receives `runtime.definition.states`; CSS supplies responsive layout |
| Story/Explore interaction restoration | GENERIC | `src/story-map-interactions.js` and shell lifecycle |
| Legacy presentation fallback selection | GENERIC application composition | `resolveStoryExperience()` and `initialize()` |

### Application composition

| Contract item | Classification | Evidence |
| --- | --- | --- |
| One MapLibre instance shared by Explore, Story Shell, and legacy presentation | GENERIC composition property | one `new maplibregl.Map(...)` in `src/app.js:995` |
| Source/layer construction for the Route 61-2 comparison | PROJECT ADAPTER currently embedded in application | `addMapSources()`, `addRouteLayers()`, `addStopLayers()`, `addPoiLayers()` |
| Project title, labels, controls, popups, initial extent | HARDCODED PROJECT ASSUMPTION | `index.html`; `src/app.js:62-131,484-536,897-950,998-1001` |
| Serialized project selection and application bootstrap | DEFERRED EXTENSION and current portability blocker | no manifest loader or project registry |

## Config-only authoring proof

Evidence is in `review/route-61-2-benchmark-certification-v1/benchmark-evidence.test.mjs`. All changes are parsed clones/in-memory fixtures; the checked-in story was never rewritten.

- reorder: changed the sequence to `connections → intro → editor-authored-interchange → route-changes → service-area → final-proposal`; DOM, runtime, content, enter actions, and exit actions followed that order
- remove: omitted `existing` and `adjustment-context` from the altered fixture; the resulting six-state shell reported total 6
- add: inserted arbitrary ID `editor-authored-interchange` using only supported V1 blocks and actions; schema validation, shell rendering, direct navigation, enter lifecycle, and exit lifecycle passed
- content rewrite: changed story title, a heading, layout, paragraphs, stat composition, callout, and disclosure entirely in serialized data
- action rewrite: reordered focus/mode/POI/reveal/context actions and changed mode, focus target, POI emphasis, context, reveal, pitch, bearing, and max zoom within existing contracts; recorded execution order matched the descriptor array
- responsive reuse: the identical altered definition produced identical state IDs and headings for simulated 1920×1080 and 390×844 consumers; production live smoke also traversed the identical seven state IDs at both viewport sizes
- application/runtime source changes: none
- canonical production story after experiment: exact seven-state order and original title/heading confirmed by test and Git diff

## Benchmark coverage matrix

| # | Transport-planning pattern | Classification | Evidence / rationale |
| ---: | --- | --- | --- |
| 1 | map + heading | SUPPORTED_AND_EXERCISED | every production state |
| 2 | map + narrative | SUPPORTED_AND_EXERCISED | all states; multi-paragraph text in `adjustment-context` |
| 3 | map + KPI/stat group | SUPPORTED_AND_EXERCISED | `existing`, `route-changes` |
| 4 | map + contextual callouts | SUPPORTED_AND_EXERCISED | `adjustment-context`, `connections` |
| 5 | map + disclosure/source note | SUPPORTED_AND_EXERCISED | `existing`, `route-changes`, `service-area` |
| 6 | layer/mode change | SUPPORTED_AND_EXERCISED | difference, existing, and proposed modes |
| 7 | route reveal | SUPPORTED_AND_EXERCISED | `final-proposal` |
| 8 | POI emphasis | SUPPORTED_AND_EXERCISED | `connections` |
| 9 | contextual 3D buildings | SUPPORTED_AND_EXERCISED | `service-area` |
| 10 | semantic camera/focus change | SUPPORTED_AND_EXERCISED | all production states |
| 11 | before/after or difference comparison | SUPPORTED_AND_EXERCISED | difference mode plus separate existing/proposed states; compare mode is also supported |
| 12 | minimal/map-dominant state | SUPPORTED_AND_EXERCISED | `map-focus` layout in `service-area` and `connections`; a heading-only state is valid for a still more minimal case |
| 13 | chart-supported evidence | NOT_SUPPORTED_DEFERABLE | clean future block-registry addition; not needed by the current credible benchmark or GUI V1 core |
| 14 | table-supported evidence | NOT_SUPPORTED_DEFERABLE | clean future block-registry addition |
| 15 | legend | NOT_SUPPORTED_DEFERABLE | Explore has a fixed difference legend, but Story V1 has no legend block; current prose/callouts keep the benchmark credible |
| 16 | image/media evidence | NOT_SUPPORTED_DEFERABLE | clean future block-registry addition |
| 17 | explicit feature highlight/filter | NOT_SUPPORTED_DEFERABLE | POI emphasis exists, but arbitrary feature filters do not; add later as a project action contract if a real story requires it |
| 18 | project dataset/layer selection | NOT_SUPPORTED_BLOCKING_BEFORE_GUI | a new-project GUI would otherwise require JavaScript edits |

## Project portability matrix

The temporary alternate-project object was valid pure JSON, but no current bootstrap consumes it. `PROJECT_ADAPTER_ONLY` means the boundary is reasonably isolated but still requires a developer to edit JavaScript; it is not GUI-authorable today.

| Item | Classification | Exact current boundary / required edit |
| --- | --- | --- |
| project/story title | APPLICATION_CODE_CHANGE_REQUIRED | story `title` is configurable, but application title, panel heading/subtitle, ARIA labels, and route naming remain in `index.html:7,17,19,24-25,96`; story title is not the project shell title source |
| route geometry | PROJECT_ADAPTER_ONLY | replace JS arrays in `src/route-data.js`; `src/app.js:1-7,52-58` imports and converts them |
| existing/proposed route datasets | PROJECT_ADAPTER_ONLY | the two arrays are encoded as JS exports, not declared dataset resources; `routeData` is constructed in `src/app.js:62-76` |
| stop datasets | PROJECT_ADAPTER_ONLY | replace JS arrays in `src/route-data.js`; collections are constructed in `src/app.js:55-56,78-101` |
| POIs / landmarks | PROJECT_ADAPTER_ONLY | replace `landmarks` in `src/route-data.js`; `poiData` is constructed in `src/app.js:118-131` |
| industrial/context polygon | APPLICATION_CODE_CHANGE_REQUIRED | fixed fetch `./data/industrial-zone-poc.geojson` and one-Polygon assumption in `src/app.js:964,968-975` |
| Overture building source | APPLICATION_CODE_CHANGE_REQUIRED | fixed URL in `src/overture-buildings.js:3`, fixed AOI ID in `inspectOvertureCollection()` at line 49, and route-specific fallback seed in `src/urban-context.js:15` |
| route-specific labels | APPLICATION_CODE_CHANGE_REQUIRED | route/endpoint labels in `src/app.js:62-76,103-116,908-929`, mode/status strings in `applyMode()` / `renderMetrics()`, and project chrome in `index.html` |
| story definition path | APPLICATION_CODE_CHANGE_REQUIRED | literal fetch path in `initialize()` at `src/app.js:960` |
| map focus targets | APPLICATION_CODE_CHANGE_REQUIRED | enum in `src/route-61-2-story-actions.js:2-9`, geometry switch in `targetCoordinates()` at `src/app.js:688-705`, and target-specific defaults in `src/presentation.js:24-26` |
| available action values | PROJECT_ADAPTER_ONLY | private enum sets and validator functions in `src/route-61-2-story-actions.js`; no serializable catalog for a GUI |
| initial/default geographic extent | APPLICATION_CODE_CHANGE_REQUIRED | `center`, `zoom`, `pitch`, and `bearing` in `src/app.js:998-1001`; Explore reset also calls fixed `overview` focus |
| attribution/provenance metadata | APPLICATION_CODE_CHANGE_REQUIRED | Overture attribution in `src/overture-buildings.js:68`; POI URLs in JS data; basemap attribution in style; no project metadata collection |

Answer to the portability question: a developer can adapt a second route by replacing project modules and editing application wiring, but a future author cannot supply only serialized project data/configuration today. Route 61-2 therefore certifies the story runtime, not project portability.

## Story Editor readiness

| Capability | Readiness | Rationale |
| --- | --- | --- |
| reorder states | READY | ordered array is authoritative |
| add/remove states | READY | arbitrary IDs, dynamic count/progress/boundaries proven |
| edit structured text/content | READY | renderer consumes ordered blocks from JSON |
| choose supported block types | READY | canonical JSON Schema enumerates blocks/layouts |
| choose map actions | PARTIAL | executable validation/dispatch is mature, but the project action vocabulary is a JS registry rather than GUI-readable metadata |
| choose valid action parameters | PARTIAL | deterministic validators exist, but enum sets and parameter descriptions are private JS constants/functions |
| choose semantic focus | PARTIAL | existing targets are selectable; target discovery and geometry binding are not serialized |
| bind data/metrics | PARTIAL | metric IDs are serializable, but there is no declared metric catalog, label/provenance metadata, or binding schema beyond a non-empty string |
| preview Story Shell output | READY | shell consumes the same definition as production |
| save serializable configuration | READY | JSON round-trip purity proven; no authored callbacks or runtime objects |

Overall: PARTIAL but sufficient to begin a Route 61-2 story-editor design after the blocking project contract is defined. A GUI can safely edit stories against the existing six-block/five-action vocabulary; it cannot discover all project capabilities from serialized metadata yet.

## Project Editor readiness

| Capability | Readiness | Rationale |
| --- | --- | --- |
| create/select a project | NOT_READY | no project manifest, registry, or bootstrap selection |
| edit project metadata/title | NOT_READY | application chrome is hardcoded HTML |
| declare datasets and roles | NOT_READY | route/stops/POIs are JS exports; context URLs are constants/literals |
| declare reusable sources/layers | NOT_READY | source/layer construction is embedded in `app.js` |
| register semantic focus targets | NOT_READY | action enum plus `targetCoordinates()` code edit required |
| expose actions/values/metrics to a GUI | NOT_READY | current registries are executable JS, not serializable project metadata |
| configure default extent and attribution | NOT_READY | application/module code edits required |
| bind an alternate story path | NOT_READY | fixed literal in application bootstrap |

Overall: NOT_READY. The missing unit is one coherent Project Manifest V1 contract, not a rewrite of the Story Schema.

## Generic-runtime purity

- `src/story-schema.js`: no Route 61-2 names, geometry, layers, MapLibre objects, or project values; action validation is injected
- `src/story-runtime.js`: state IDs are opaque; order/count come only from `definition.states`; no map or transport semantics
- `src/story-action-runner.js`: generic type-to-handler registry; no project semantics
- `src/story-shell.js`: generic state count/order, DOM generation, navigation, observer, and lifecycle; no Route 61-2 semantics
- `src/presentation-renderer.js`: generic blocks only; the one non-generic assumption is Vietnamese case conversion (`vi-VN`), which is a locale/configuration concern rather than Route 61-2 logic
- generic-module scan found no `61-2`, bus, stop, POI, industrial, Overture, route geometry, or project focus values

## Route-specific application assumptions

| Assumption | Exact file/function | Boundary assessment |
| --- | --- | --- |
| route/stops/landmarks source module | `src/route-data.js`; imports at `src/app.js:1-7` | acceptable current PROJECT ADAPTER; portability blocker only because it is JS rather than manifest data |
| comparison source/layer IDs and rendering | `addMapSources()`, `addRouteLayers()`, `addStopLayers()`, `addDirectionLayers()`, `addEndpointLayers()`, `addPoiLayers()` | legitimate Route 61-2 application adapter; must become manifest-driven only for new-project GUI authoring |
| route names, endpoint labels, popup strings | `src/app.js:62-76,103-116,908-929`; `index.html` | acceptable for current artifact; blocks serialized project creation |
| focus geometry registry | `targetCoordinates()` in `src/app.js:688-705` | cleanly identifiable but still an application code-change boundary |
| action enum values | `src/route-61-2-story-actions.js` | appropriate PROJECT ADAPTER; GUI discovery metadata missing |
| industrial polygon and Overture source/identity | `initialize()`; `src/overture-buildings.js`; `src/urban-context.js` | legitimate certified dataset assumptions; block alternate-project data declaration |
| story path | `initialize()` in `src/app.js:960` | portability blocker |
| initial view/reset focus | map constructor and `fitTarget('overview', false)` call sites | portability blocker |
| project title/metadata/locale | `index.html`; `src/presentation-renderer.js:17` | portability/localization blocker, not a story-order problem |

None of these assumptions contaminate the generic Story Runtime or Story Shell. They accurately describe the missing project configuration boundary.

## Serialization audit

- current Route 61-2 story round-trips through `JSON.stringify`/`JSON.parse` with deep equality
- schema-facing authored values are objects, arrays, strings, numbers, and booleans only
- no functions, callbacks, DOM references, MapLibre instances, class instances, arbitrary expressions, `eval`, or `Function` constructors occur in story JSON
- action handler functions remain behind the project adapter and are not authored data
- presenter notes are plain string metadata and remain non-rendered
- no HTML block or executable content escape hatch exists
- the canonical JSON Schema is stricter about additional properties than the dependency-free runtime validator in some structural locations; this is a non-blocking validator-hardening concern because the saved-data contract remains the canonical schema and no executable values are admitted
- there is no current serialized project-facing boundary to audit as a complete unit; authoring a new project would require JS/HTML edits, which is the blocking finding

## No-app-logic experiment

Exact temporary/in-memory changes:

- changed story title
- reordered multiple production states
- omitted two production states
- added `editor-authored-interchange`
- changed heading, layout, paragraphs, stat composition, callout, and disclosure
- reordered action descriptors
- changed mode to `compare` / `existing`
- changed focus target and camera pitch/bearing/maxZoom
- toggled POI emphasis, urban context, and route reveal

Runtime/application files changed: none.

Production story file changed: none.

Result: PASS for story authoring freedom. The same runtime, renderer, action runner, Story Shell, and application navigation executed the altered configuration successfully. This does not prove new-project portability because the altered story still targets Route 61-2's existing project actions, metrics, focus values, and datasets.

## Deferred capabilities

- charts: add only when a sourced analytical story requires a chart block
- tables: add as a new content registry entry when needed
- story-specific legend: defer; the current benchmark is understandable through route styling, modes, prose, and callouts
- image/media evidence: defer as an additive content block
- arbitrary feature highlight/filter: defer as an additive project action contract
- richer comparisons such as swipe or synchronized before/after panes: defer; difference/existing/proposed/compare modes already cover GUI V1
- generalized GIS import, data importer, database, CMS, and backend: outside this gate and unnecessary for the saved-data contract decision
- validator/schema exact-parity hardening and configurable locale: useful follow-up hardening, but not the one blocking architecture boundary

## Blocking gaps

One architecture gap blocks the critical product goal:

- Project Manifest V1 is absent. A future GUI cannot declare project metadata, dataset roles/URLs, route/stops/POIs/context/Overture inputs, semantic focus registrations, action/metric catalogs, story path, default extent, or attribution without editing JavaScript/HTML. These are facets of one missing project contract, not independent implementation tracks.

## Schema decision

`READY_TO_LOCK_STORY_SCHEMA_V1`

Rationale:

- state order, identity, lifecycle, structured content, action sequences, and pure serialization are mature and proven
- Route 61-2 exercises the core transport-planning narrative shapes needed by a useful GUI V1
- missing charts/tables/legends/media/highlights are additive registry extensions and do not require changing the fundamental state/content/action saved-data model
- action-value, metric, focus, dataset, and metadata discoverability belong at the project contract boundary; disguising them as a Story Schema defect would couple story authoring to one project

Lock means stabilizing the V1 core document shape and semantics. It does not prohibit additive, explicitly versioned content/action registry entries later.

## Project-contract decision

`PROJECT_MANIFEST_REQUIRED`

Rationale:

- the code has useful project adapters, but no serializable project unit consumes them
- an alternate route can be built by a developer, not by a GUI author
- the missing manifest must define the writable boundary before GUI project authoring begins, or saved GUI data would otherwise depend on application-source edits

## Regression

- `npm test`: 143/143 PASS (138 baseline plus 5 certification evidence tests)
- source syntax: 22/22 PASS
- `git diff --check`: PASS
- production executable/data invariant: no changes under `src/`, `data/`, `index.html`, or `styles.css`
- desktop browser, 1920×1080: initial Explore PASS; Story entry PASS; sequence `intro → existing → adjustment-context → route-changes → service-area → connections → final-proposal` PASS; final boundary PASS; Explore exit PASS; re-entry at `intro` PASS; one MapLibre canvas throughout; Overture loaded and industrial context active only at `service-area`; console warnings/errors 0
- mobile browser, 390×844: initial Explore PASS; same seven-state sequence PASS; total 7 and final boundary PASS; horizontal overflow false; one MapLibre canvas; console warnings/errors 0
- performance: existing Story Shell Promotion V1 4.001-second authority referenced; no rerun because no executable branch change
- certification branch CI: final immutable draft-PR head/run is recorded in the PR after the tracked report commit

## Recommendation

Route 61-2 is a credible benchmark for Story Config and Story Shell behavior. It proves that an author can substantially rewrite a transport-planning narrative without touching generic runtime/application navigation code. It does not yet prove the full future-product claim for creating a second project from serialized data.

Freeze Story Schema V1, then address exactly one boundary: define Project Manifest V1. Do not add new content types, GUI code, GIS importers, or other parallel capability work in that task.

`ROUTE_61_2_BENCHMARK_CERTIFICATION_V1_RESULT: REVISE`

`NEXT_GATE: PROJECT_MANIFEST_V1`
