# Map Story Studio V1.1 — Desktop Architectural Design

Status: approved for implementation planning

Date: 2026-08-30

Authoritative repository base: `main` at `119ed58d5d57e38474fee192effe9028e6a0c2d7`

Locked production authority: `docs/baseline-authoring-contract-v1.md`

GUI Editor V1 certification: `review/gui-editor-v1/REPORT.md`

Human approval: 2026-08-30, with the four contract-hardening rules incorporated below.

## 1. Decision summary

Map Story Studio V1.1 changes the product from a schema-oriented project editor into a desktop-first visual Scene authoring environment while preserving the certified production architecture underneath it.

The product model is:

> PowerPoint-like authoring + Mapbox/MapLibre-style storytelling output.

A Scene is still a Story state. There is no second slide runtime and no GUI-only document model. Story Schema 1.2 additively extends the production Story format so a Scene can declaratively own its camera, interaction policy, transition, project-layer visibility, and constrained freeform 16:9 overlay composition.

The editor remains a client of the existing package store, draft store, production validators, production project loader, trusted capability registry, storage adapters, and shared production preview. V1.1 changes the authoring surface and adds a shared Scene state/composition layer; it does not replace the certified V1 persistence or project-loading spine.

The generic production shell becomes neutral. Route 61-2 remains a reference project and compatibility fixture, but route comparison, POI emphasis, urban context, simulation, and other route-specific behavior must live in trusted capabilities or Route 61-2 project data rather than generic shell markup or generic application logic.

V1.1 is desktop/projector first. Mobile authoring and Story 1.2 mobile-specific authored layouts are deferred. Existing Story 1.0/1.1 mobile production compatibility remains protected by regression smoke coverage.

## 2. Repository evidence and current boundary

At the authoritative base:

- `BASELINE_AUTHORING_CONTRACT_V1` is locked.
- `PROJECT_MANIFEST_V1` remains the project manifest authority.
- Story Schema 1.0 and 1.1 are supported production Story versions.
- `CORE_CONTENT_PACK_V1` owns semantic content descriptors and production renderers.
- `COMMON_MAP_ACTIONS_V1` owns the existing semantic map actions.
- `DATA_METRIC_BINDING_V1` owns table/static/computed metric binding and locale formatting.
- `CAPABILITY_EXTENSION_BOUNDARY_V1` owns trusted domain-specific extensions.
- GUI Editor V1 has certified folder/ZIP persistence, production validation, last-valid preview behavior, package export/reopen, and no GUI-only schema.
- `src/application.js` and `src/project/bootstrap.js` already provide a generic load/bootstrap seam.
- `src/story-schema.js` already versions Story validation.
- `src/content/content-descriptors.js` already provides reusable semantic descriptors for heading/paragraph, metrics, chart, table, image, legend, and the other existing content types.

The present production entry path is not neutral. `src/app.js` still constructs Route 61-2 route/stops/POI data, comparison state, transport metrics, industrial context, reveal behavior, simulation behavior, and project-specific control state. V1.1 removes those assumptions from the neutral shell without changing the canonical Route 61-2 Story 1.0 artifact.

## 3. Product goals

V1.1 succeeds when a desktop user can build an ordinary map story primarily by manipulating visible objects on a live 16:9 map Scene rather than navigating engine vocabulary.

The primary authoring concepts are:

- **Layers** — project-level map resources;
- **Scenes** — ordered Story states;
- **Canvas** — the live 16:9 MapLibre Scene surface;
- **Properties** — contextual controls for the selected Scene, layer, or overlay object.

The normal user should not have to understand metrics namespaces, focus-target registries, capability internals, action arrays, block arrays, Story version mechanics, attribution wiring, validator paths, or raw schema vocabulary in order to create an ordinary Story 1.2 project.

Those concepts remain available only where required by imported legacy projects, trusted capability configuration, or Problems/Advanced surfaces.

The authoritative composition is 16:9 and targets:

- desktop authoring around 1440×900 or larger;
- 1920×1080 projector/presentation output;
- 1366×768 laptop output.

## 4. Explicit non-goals

V1.1 does not become a general presentation/design application.

Out of scope:

- mobile editor UI;
- Story 1.2 mobile-specific authored Scene layouts;
- arbitrary vector drawing or shapes;
- freehand drawing;
- overlay rotation;
- grouping;
- master slides;
- SmartArt;
- Figma-style constraint systems;
- arbitrary CSS;
- arbitrary JavaScript or executable authored configuration;
- raw MapLibre style expressions or private source/layer IDs;
- visual capability programming;
- arbitrary plugin installation from project content;
- GIS geometry editing, route snapping, spatial analysis, or QGIS replacement;
- automatic Story 1.0/1.1 migration;
- a general 1.0/1.1-to-1.2 conversion engine;
- a second presentation runtime;
- a second editor-only content renderer;
- backend/cloud project persistence or multi-user collaboration.

Image cropping/focal-point editing is deferred. V1.1 image objects use bounded declared assets and deterministic `contain` fit inside the authored frame.

Mobile deferral does **not** authorize regressions to the existing Story 1.0/1.1 mobile production experience. The previously certified 390×844 path remains a compatibility smoke gate.

## 5. Locked invariants and compatibility policy

### 5.1 Existing contracts remain authoritative

V1.1 preserves:

- `PROJECT_MANIFEST_V1`;
- `CORE_CONTENT_PACK_V1`;
- `COMMON_MAP_ACTIONS_V1`;
- `DATA_METRIC_BINDING_V1`;
- `CAPABILITY_EXTENSION_BOUNDARY_V1`;
- the production project loader;
- the installed trusted capability registry;
- existing folder/ZIP persistence semantics;
- production validation as the only validity authority.

Story 1.2 is an additive Story minor version. It does not redefine Story 1.0 or 1.1.

### 5.2 No silent migration

Opening, previewing, editing an unrelated resource, saving, or exporting a Story 1.0 or 1.1 project must not change its Story `schemaVersion` or rewrite it as Story 1.2.

The canonical Route 61-2 Story 1.0 file remains byte-identical unless a later explicitly approved change says otherwise.

Story 1.0 and 1.1 continue to render through their existing structured presentation layouts. V1.1 preserves the certified structured/legacy inspector for those versions. Freeform Scene manipulation is enabled only for Story 1.2 `freeform-16x9` content.

A future explicit migration tool is a separate product decision.

### 5.3 No GUI-only schema

Every saved V1.1 authoring change is production Story 1.2, existing project-manifest data, an existing bounded resource descriptor, or trusted capability settings.

Selection, hover, handles, uncaptured working camera, alignment guides, panel widths, current editor mode, preview state, history stacks, and storage handles remain editor-only memory and never enter project JSON.

### 5.4 One runtime and one semantic renderer set

Editor authoring, Scroll Story, and Presentation mode share the production Scene-state controller, compositor, and semantic content renderers.

The editor may add authoring affordances around the production Scene surface, but it must not simulate or independently reimplement the rendered result.

## 6. Terminology mapping

| Product term | Production/runtime meaning |
| --- | --- |
| Project | Existing `PROJECT_MANIFEST_V1` package plus declared resources |
| Scene | Story `state` |
| Layers panel | Scene-controllable project map datasets/resources exposed through stable project IDs |
| Overlay object | Story 1.2 composed semantic block envelope |
| Canvas | Shared live MapLibre Scene surface with 16:9 overlay coordinate space |
| Properties | Contextual authoring controls that write production values |
| Preview Story | Scroll-story experience using the current last-valid package snapshot |
| Present | Projector/presentation experience using the same Scene sequence |
| Problems | Production validation diagnostics plus non-fatal authoring/layout warnings |
| Advanced | Legacy Story/action/capability details not needed for routine V1.1 authoring |

The GUI term **Scene** must not create a second data model. Scene ordering is `story.states` array order and Scene IDs are existing Story state IDs.

## 7. Desktop workspace

Target shell:

```text
┌───────────────────────────────────────────────────────────────┐
│ Project       Undo Redo      Preview Story  Present  Save    │
├────────────┬───────────────────────────────────┬──────────────┤
│ LAYERS     │                                   │ PROPERTIES   │
│            │         16:9 LIVE MAP             │              │
│ Route      │                                   │ contextual   │
│ Stops      │      freeform overlays            │ inspector    │
│ Zones      │                                   │              │
│ + Add      │                                   │              │
├────────────┴───────────────────────────────────┴──────────────┤
│ SCENES  [01] [02] [03] [04] [+]                            │
└───────────────────────────────────────────────────────────────┘
```

The canvas is the primary work surface.

### 7.1 Top bar

The normal top bar contains project open/create commands, Undo, Redo, Preview Story, Present, Save/Export as appropriate, and compact validation/dirty status.

Fatal errors and warnings surface through a Problems affordance/drawer that reuses the certified production-diagnostic navigation infrastructure. Validation internals are not the normal authoring destination.

### 7.2 Layers panel

The Layers panel shows human labels for project-level Scene-controllable map resources. Stable dataset IDs are exposed only in Advanced/details UI.

A visibility checkbox edits the active Scene's declarative layer-visibility snapshot immediately.

Selecting a layer changes Properties to global project-layer properties such as label and bounded render style. Global style edits affect that layer in every Scene; visibility remains Scene-specific.

### 7.3 Scene filmstrip

The bottom filmstrip shows ordered Scenes with ordinal and a concise label derived from visible content where possible. Empty Scenes fall back to `Scene N`.

The filmstrip supports selection, add, duplicate, delete, and reorder. Reordering writes `story.states` array order. Accessible Move Previous/Move Next remains available as a keyboard-safe fallback if drag reordering is added.

**Add Scene** creates an empty overlay composition and copies the active Scene's saved camera, interaction policy, and layer-visibility snapshot. Its transition defaults to `ease` at `900ms`. If there is no active Scene, camera comes from `project.map.initialView`, interaction defaults to `locked`, and existing project layers start hidden unless a selected template explicitly seeds another valid state.

**Duplicate Scene** copies the entire active Scene, then generates a new stable Scene ID. Deleting the only remaining Scene is disallowed because Stories remain non-empty.

### 7.4 Properties panel

Properties is contextual:

- no overlay/layer selection: Scene properties;
- selected overlay: semantic content + frame/appearance controls;
- selected layer: project layer properties + active-Scene visibility;
- Map mode with camera divergence: camera status + Capture/Restore controls.

Engine-oriented fields remain demoted.

## 8. Shared production/editor architecture

The certified GUI Editor V1 package, draft, validation, storage, and preview boundaries remain and are extended rather than replaced.

```mermaid
flowchart LR
    U[Author] --> E[Studio chrome]
    E --> D[Existing authored draft store]
    D --> V[Existing production validation coordinator]
    V --> LV[Last-valid package snapshot]
    LV --> PB[Existing preview bridge]
    PB --> S[Shared Scene surface]
    S --> M[One MapLibre map]
    S --> C[Scene compositor]
    S --> SC[Scene-state controller]
    SC --> LR[Project layer runtime]
    SC --> CR[Trusted capability instances]
    C --> R[Existing semantic content renderers]
    E <--> AI[Thin authoring interaction adapter]
    AI <--> S
    D --> P[Existing folder/ZIP persistence]
```

The editor parent remains package/draft authority. The shared Scene surface remains rendering authority.

### 8.1 Authoring interaction adapter

The editor may not create a parallel renderer to support drag/resize.

A thin authoring adapter is active only in editor-preview mode. It may:

- draw selection outlines and resize handles around production overlay wrappers;
- perform transient drag/resize visuals;
- expose direct text editing for supported Text objects;
- report a camera working snapshot;
- emit bounded authoring intents such as `commit-frame`, `commit-text`, or `capture-camera` to the parent editor.

The parent editor commits those intents as Story 1.2 production-data mutations, revalidates, and advances the last-valid preview normally.

Transient pointer movement is not authored state. A drag/resize becomes one authored mutation at interaction end rather than hundreds of package revisions.

The existing strict preview origin/source/envelope checks remain in force. No raw DOM, MapLibre object, function, or file handle crosses the bridge.

## 9. Story Schema 1.2 contract

Story 1.2 is the only new production authoring schema required for V1.1.

The Story root keeps the existing required concepts: `schemaVersion`, `id`, `title`, and a non-empty ordered `states` array. Story 1.2 changes only the versioned vocabulary required by Scene state/composition; it does not add a parallel root document model.

Story 1.2 states continue to use `id`, `content`, and `map` structural concepts. New fields are version-gated and do not change Story 1.0/1.1 validation.

**Approval hardening:** the complete Story 1.2 production contract is introduced in PR A, including the composition-envelope schema and the minimal read-only production compositor required to render every schema-valid envelope through existing semantic renderers. PR B adds visual authoring/direct manipulation over this already-valid contract and must not revise Story 1.2 schema semantics.

### 9.1 Story 1.2 Scene shape

```json
{
  "id": "context",
  "content": {
    "layout": "freeform-16x9",
    "blocks": [],
    "presenterNote": "Optional, not rendered"
  },
  "map": {
    "camera": {
      "center": [106.67, 10.98],
      "zoom": 12.5,
      "pitch": 35,
      "bearing": 0
    },
    "interaction": "locked",
    "transition": {
      "type": "ease",
      "durationMs": 900
    },
    "layerVisibility": {
      "existing-route": true,
      "proposed-route": false,
      "stops": false
    },
    "enter": [],
    "exit": []
  }
}
```

`map.enter` and `map.exit` remain the trusted action lifecycle for special behavior. New Story 1.2 projects may legitimately use empty arrays.

Unlike Story 1.0/1.1, `freeform-16x9` permits `content.blocks` to be empty so a genuinely blank map Scene is valid.

### 9.2 Declarative camera

`map.camera` is required for a Story 1.2 freeform Scene:

- `center`: exactly `[lng, lat]`;
- longitude: finite number in `[-180, 180]`;
- latitude: finite number in `[-90, 90]`;
- `zoom`: finite number in `[0, 24]`;
- `pitch`: finite number in `[0, 72]`;
- `bearing`: finite number in `[-360, 360]`.

Captured bearing is normalized to a canonical equivalent before writing so repeated capture does not create meaningless numeric drift.

The project manifest `map.initialView` remains the initial/fallback map view and source for the first blank Scene. Once a Story 1.2 Scene is active, the Scene camera is authoritative.

### 9.3 Interaction policy

`map.interaction` is required and is one of:

- `locked`;
- `zoom-only`;
- `explore`.

`locked` disables user map navigation.

`zoom-only` allows bounded zoom but no free pan, pitch, or rotation. In Scroll Story, normal wheel scrolling remains available for page/Scene navigation; zoom uses cooperative gestures or explicit controls rather than trapping ordinary scroll.

`explore` allows normal MapLibre exploration appropriate to the active output while retaining cooperative scrolling in Scroll Story.

Editor Select/Map authoring mode is not this property and is never serialized.

### 9.4 Transition

`map.transition` is required:

- `type`: `fly`, `ease`, or `instant`;
- `durationMs`: integer in `[0, 10000]`;
- `instant` requires `durationMs: 0`.

New Scenes default to `ease` with `durationMs: 900`; templates may explicitly author another valid value.

When reduced motion is requested by the platform, runtime renders authored `fly`/`ease` transitions as instant while leaving authored data unchanged.

### 9.5 Layer visibility snapshot

`map.layerVisibility` maps stable project dataset IDs to booleans. It never contains private MapLibre source IDs or layer IDs.

For each Story 1.2 Scene it is a complete snapshot of Scene-controllable project map resources. This produces deterministic back/forward navigation and prevents state leakage.

The Scene-controllable set consists of project GeoJSON resources rendered by core map or explicitly claimed as renderable project resources by a trusted installed capability.

Cross-resource production validation rejects:

- unknown dataset IDs;
- table-dataset IDs or other IDs that are not Scene-controllable map resources;
- missing visibility entries for Scene-controllable project layers.

When a new map layer is added through V1.1, the editor updates every Story 1.2 Scene atomically. The new layer is visible in the active Scene and hidden in other existing Story 1.2 Scenes unless a template-specific creation operation explicitly authors another valid snapshot. Legacy Story 1.0/1.1 data is untouched.

### 9.6 Special actions remain actions

Routine camera, layer visibility, interaction, and transition are not authored as action arrays in normal V1.1 UI.

Trusted actions remain for special/domain behavior such as:

- route reveal;
- route comparison/difference effects;
- POI emphasis;
- industrial/urban context;
- vehicle simulation;
- future specialized effects.

`COMMON_MAP_ACTIONS_V1` remains valid and supported, especially for Story 1.0/1.1 compatibility. If an advanced Story 1.2 author deliberately uses an action overlapping declarative Scene state, declarative baseline is applied first and `map.enter` runs afterward, allowing a trusted action to intentionally refine/override that baseline. Normal V1.1 GUI does not author overlapping routine actions.

## 10. Composed semantic blocks

Story 1.2 does not add a replacement content system. Each `content.blocks` item is a composition envelope around an existing semantic block.

```json
{
  "id": "title",
  "frame": {
    "x": 0.05,
    "y": 0.08,
    "width": 0.40,
    "height": 0.17,
    "z": 20
  },
  "appearance": {
    "box": {
      "fill": "#07101CCC",
      "opacity": 1,
      "borderColor": "#FFFFFF22",
      "borderWidth": 1,
      "radius": 16,
      "padding": 24
    },
    "text": {
      "fontFamily": "sans",
      "fontSize": 50,
      "bold": true,
      "italic": false,
      "color": "#F6F8FC",
      "align": "left",
      "lineHeight": 1.1
    }
  },
  "block": {
    "type": "heading",
    "text": "Existing route context"
  }
}
```

The nested `block` is validated by the existing semantic descriptor for its `type`. The envelope is validated by Story 1.2 composition rules.

This separation ensures:

- Story 1.0/1.1 block descriptors do not gain GUI-only fields;
- table/chart/image/legend/metric renderers remain reusable;
- freeform position/appearance is a compositor concern;
- semantic data remains semantic data.

### 10.1 Stable composed-block ID

Each envelope requires a stable lowercase ID unique within its Scene. It is production data for deterministic DOM identity and editor selection; normal UI does not require manual ID editing.

### 10.2 Frame contract

`frame` is required:

- `x`: normalized horizontal origin `[0, 1]`;
- `y`: normalized vertical origin `[0, 1]`;
- `width`: normalized `(0, 1]`;
- `height`: normalized `(0, 1]`;
- `z`: integer `[0, 9999]`.

Production validation also enforces `x + width <= 1` and `y + height <= 1`. V1.1 does not author off-canvas objects. Equal `z` values use Story array order as deterministic tie-breaker.

Users manipulate these values visually; normal UI never requires typing normalized coordinates.

### 10.3 16:9 design coordinate system

Frame geometry is normalized against the 16:9 Scene.

Appearance measurements such as font size, border width, radius, and padding use design pixels referenced to a 1920×1080 logical Scene. The compositor scales them uniformly with rendered 16:9 Scene width.

The map renders natively at actual MapLibre viewport size. Camera values remain standard MapLibre camera values.

### 10.4 Appearance contract and frozen defaults

`appearance` is optional, but omission must be deterministic.

Story 1.2 owns a frozen/versioned compositor-default token set. It is production runtime authority, not ambient editor CSS. A compatible Story 1.2 implementation may refactor CSS internally but must preserve the token output. Changing default visual semantics requires an explicit compatible-contract decision rather than an incidental stylesheet change.

The default token set includes, at minimum:

- transparent box fill;
- object opacity `1`;
- transparent border with width `0`;
- radius `0`;
- padding `0` unless the semantic renderer's Story 1.2 token explicitly requires bounded internal spacing;
- font family token `sans`;
- non-italic text;
- left alignment;
- line height `1.2` unless a semantic-type token explicitly overrides it;
- semantic-type font-size/weight tokens pinned by Story 1.2 compositor tests.

This allows semantic renderers to retain type-appropriate heading/body/table/legend treatment without depending on unrelated page CSS.

`appearance.box` may contain only bounded values for:

- `fill`: bounded hex color, including alpha;
- `opacity`: `[0, 1]`;
- `borderColor`: bounded hex color, including alpha;
- `borderWidth`: `[0, 16]` design px;
- `radius`: `[0, 128]` design px;
- `padding`: `[0, 160]` design px.

`appearance.text` may contain only:

- `fontFamily`: approved application token;
- `fontSize`: `[8, 256]` design px;
- `bold`: boolean;
- `italic`: boolean;
- `color`: bounded hex color, including alpha;
- `align`: `left`, `center`, or `right`;
- `lineHeight`: `[0.8, 2.5]`.

Initial font tokens:

- `sans` — current Inter/system sans stack;
- `arial` — Arial/Helvetica-style sans stack;
- `times-new-roman` — Times New Roman/Times-style serif stack;
- `georgia` — Georgia-style serif stack.

No authored font URL, `@font-face`, arbitrary family string, CSS URL, or remote stylesheet is permitted.

Typography controls are fully supported for Text. Box appearance applies to all overlays. Metric/table/legend text may inherit safe wrapper typography where existing semantic rendering permits it. V1.1 does not add arbitrary chart-internal or table-cell styling; chart series styling remains the existing bounded chart descriptor.

### 10.5 Product-level object families

V1.1 Add menu exposes:

- **Text** — existing `heading` or `paragraph`, with Heading and Body text subtypes;
- **Metric** — existing `stat-group`;
- **Chart** — existing Chart.js-backed `chart`;
- **Table** — existing normalized `table`;
- **Image** — existing declared-asset `image`;
- **Legend** — existing `legend`.

Story 1.2 accepts every existing `CORE_CONTENT_PACK_V1` semantic block type inside a composition envelope so descriptor/renderer compatibility remains complete. Only the six product families above are primary V1.1 Add-menu choices.

PR A provides read-only production envelope rendering. PR B proves visual composition/authoring with Text. PR C enables rich-object authoring workflows without changing Story 1.2 schema.

## 11. Camera authoring — explicit capture only

Camera authoring is first-class and never uses implicit save-on-map-move.

### 11.1 Editor interaction modes

**Select mode** — default:

- select overlays;
- drag/resize;
- direct text editing;
- alignment commands;
- map pan/rotate/pitch disabled to prevent accidental map movement.

**Map mode**:

- overlay manipulation suspended;
- pan/zoom/pitch/rotate enabled for authoring exploration;
- saved Scene camera unchanged until explicit capture.

These modes are editor state only.

### 11.2 Working camera lifecycle

1. Compare live map camera with active Scene saved camera.
2. If different, show `Camera changed · not captured`.
3. **Capture Camera** reads live camera, normalizes/clamps it to Story 1.2 contract, and commits one Scene mutation.
4. **Restore Saved Camera** returns live map to authored Scene camera with zero Story mutation.
5. Switching Scenes discards uncaptured working camera and restores the target Scene saved camera.

No MapLibre `move`, `moveend`, zoom, rotate, or pitch event may directly mutate authored camera data.

Capture Camera is one undoable authoring command.

### 11.3 Authoring Scene switching

Normal editor Scene switching restores saved camera, layer visibility, overlay composition, and Scene properties immediately. It does not force the author to wait through presentation transitions.

Preview Story and Present honor authored transitions.

## 12. Project Layers and Scene visibility

Layers remain project resources rather than Scene-local duplicated data.

### 12.1 Project-layer runtime boundary

Generic runtime needs a small semantic layer-control boundary keyed by project dataset ID.

Core map rendering registers each ordinary project GeoJSON layer with operations equivalent to:

- `setVisible(datasetId, boolean)`;
- `reset()`;
- lifecycle `destroy()`.

A trusted capability claiming rendering responsibility for a project dataset must register the same stable project dataset ID with Scene layer control. It may internally control multiple MapLibre sources/layers, but private IDs never leave trusted code.

Capability-generated visuals not corresponding to an ordinary project dataset are not automatically promoted into Layers. They remain special capability behavior unless the capability intentionally publishes a stable authorable project-layer target.

### 12.2 Layer authoring behavior

A Layer visibility toggle:

- changes only active Scene `map.layerVisibility`;
- updates the live production Scene immediately;
- creates one undoable mutation;
- never writes `map.set-visibility` actions.

Changing line color/width, fill, point radius, label descriptor, or another existing bounded render property remains project-level and affects every Scene in which the layer is visible.

Deleting a layer uses reference-safety/validation behavior and surfaces broken Scene/action/capability references rather than silently repairing them.

## 13. Freeform composition behavior

V1.1 uses constrained PowerPoint-like composition.

### 13.1 Direct manipulation

Selected overlays support:

- drag within 16:9 bounds;
- bounded resize handles;
- duplicate;
- delete;
- bring forward;
- send backward;
- basic alignment commands;
- basic snapping/alignment guides.

Initial snapping targets:

- Scene edges;
- Scene horizontal/vertical centers;
- other object edges;
- other object horizontal/vertical centers.

Guides are transient and never persisted. V1.1 does not add user-created guides, distribution algorithms, grouping, or constraint graphs.

### 13.2 Direct text editing

Text supports direct canvas editing. Stored semantic content is bounded plain text: no HTML, executable Markdown, inline CSS, or rich-text DOM fragments.

### 13.3 Overflow

The compositor does not silently resize/reflow frames to hide authoring mistakes.

If content exceeds its frame, editor shows a non-fatal layout warning. Production remains deterministic and clips/contains according to the renderer rather than inventing another layout.

Charts resize to their authored frame through existing responsive chart lifecycle. Images use `contain`. Tables that cannot fit surface overflow warning rather than becoming spreadsheet viewports.

## 14. Undo and Redo

Undo/Redo covers authored production-data mutations in the current editor session.

One undoable command includes:

- Capture Camera;
- layer visibility toggle;
- drag commit;
- resize commit;
- direct text commit;
- appearance change;
- add/delete/duplicate/reorder Scene;
- add/delete/duplicate overlay.

Undo/Redo excludes selection, hover, Select/Map mode, uncaptured map exploration, preview navigation, Problems state, permission prompts, and Save/Export.

Save marks package bytes clean but does not erase authoring history. Undo after Save creates a normal new dirty mutation.

History remains editor memory and never changes production schema.

## 15. Scene activation and runtime precedence

Story Runtime remains responsible for ordered state lifecycle. V1.1 adds a shared Scene-state application layer around that lifecycle rather than replacing it.

Transition A → B order:

1. run Scene A `map.exit` trusted actions;
2. cancel in-flight camera transition owned by Scene A;
3. apply Scene B complete declarative layer-visibility baseline;
4. apply Scene B interaction policy;
5. render/activate Scene B overlay composition;
6. initiate Scene B camera transition toward saved camera;
7. run Scene B `map.enter` trusted actions.

Steps 3–6 establish ordinary presentation baseline. Step 7 lets trusted special behavior intentionally refine it.

Re-entering a Scene re-applies the complete declarative baseline so back/forward navigation cannot inherit stray layer state.

Camera animation may continue after `map.enter` begins; Scene activation must not block Story navigation for transition duration.

## 16. Generic production shell

Neutral shell contains only:

- MapLibre map container;
- Scene compositor root;
- Scroll Story navigation/activation host;
- Presentation navigation host;
- generic loading/error/status affordances;
- trusted capability-control host slots.

It contains no Route 61-2 labels, Existing/Proposed/Difference tabs, transport metrics, bus simulation controls, or industrial/urban controls.

A blank project loaded through the neutral shell shows its basemap/blank Scene and generic Story navigation only.

### 16.1 Trusted capability control slots

Trusted capabilities may legitimately need project-specific runtime controls. Generic shell may expose neutral named host elements. A capability implementation may mount trusted controls through lifecycle context supplied by production bootstrap.

Control markup/behavior lives in trusted application code, not project JSON. Empty hosts remain hidden.

## 17. Route 61-2 reference-project boundary

Target composition:

```text
Generic Runtime / Generic Shell
+ Core Content
+ Core Map
+ Route Comparison capability
+ Transport/POI capability behavior where required
+ Urban Context capability where required
+ Route 61-2 project datasets/settings
+ Route 61-2 Story
```

The canonical Route 61-2 Story 1.0 continues to validate and execute through legacy action normalization and trusted capabilities.

Route-specific compatibility adapters may remain trusted code, but generic shell must not import or assume them.

By V1.1 lock:

- neutral shell source contains no Route 61-2 data constants/labels;
- blank-project certification uses the same shell;
- Route 61-2 still runs as a project loaded by that shell;
- route-specific controls, simulation, POI emphasis, urban context, and derived comparison rendering are capability-owned;
- canonical Route 61-2 Story 1.0 bytes remain unchanged.

If a Story 1.2 Route 61-2 Studio demonstration is needed, it is a separate explicitly authored reference/template artifact rather than a rewrite of the canonical Story 1.0 file.

## 18. Templates

A template creates ordinary project content once. It has no runtime role afterward. No `templateId`, template-engine metadata, or template-specific runtime branch is persisted.

Every new V1.1 Studio project defaults to Story 1.2. Story 1.1 remains supported for imported/existing projects but is no longer the new-project default.

Creation choices:

1. Blank map story
2. Route proposal
3. Network / service plan
4. Import existing project

Import reuses certified Open Folder / Import ZIP; it is not a special package format.

### 18.1 Immediate-validity rule

Every template output must be accepted immediately by unchanged production `loadProject(...)` and all production validators. There is no allowed invalid transitional starter project.

If a template wants a capability whose descriptor requires dataset roles, the template must either:

- create valid bounded placeholder resources and matching role descriptors that satisfy those requirements; or
- defer the capability declaration until the required resources exist.

The template must never install a capability declaration that makes its freshly created project invalid.

### 18.2 Blank map story

Creates:

- ordinary `PROJECT_MANIFEST_V1`;
- one Story 1.2 file;
- one empty `freeform-16x9` Scene;
- no project map layers;
- no route-specific capabilities;
- no sample transport metrics/controls.

### 18.3 Route proposal

Creates neutral starter project data. Starter Scenes:

- Context;
- Existing route;
- Proposed change;
- Key connection;
- Recommendation.

Scenes are ordinary editable/deletable Story 1.2 states. Capability declarations and any placeholder route/stops resources must obey the immediate-validity rule.

### 18.4 Network / service plan

Creates neutral starter Scenes/layers suitable for network/service planning using the same Story 1.2 format. It creates no new runtime mode and obeys the immediate-validity rule.

Templates may seed layer visibility, camera, overlays, and relevant trusted capability declarations only when the resulting project is immediately production-valid.

## 19. Desktop outputs from the same Scene sequence

There is one Story 1.2 Scene sequence and two desktop experiences.

### 19.1 Scroll Story

- immersive live MapLibre background;
- Scene activation driven by scroll position;
- camera/layer/interaction/transition applied on activation;
- authored overlay composition;
- optional trusted capability effects;
- no editor chrome.

On non-16:9 desktop viewport, map remains full-bleed while overlay geometry resolves against the largest centered 16:9 composition-safe rectangle.

Map interaction must not trap ordinary page scrolling; cooperative gestures remain mandatory.

### 19.2 Presentation mode

- exact 16:9 Scene stage;
- MapLibre fills the stage;
- authored overlays in the same positions as editor canvas;
- Next/Previous;
- keyboard navigation;
- authored transitions/layer state/interaction policy;
- trusted capability effects;
- no editor chrome.

Non-16:9 screens center the stage with neutral letterbox/pillarbox space rather than stretching composition.

### 19.3 Shared implementation rule

Both outputs use the same:

- Story definition;
- Scene-state controller;
- layer runtime;
- MapLibre map creation path;
- overlay compositor;
- semantic content renderers;
- capability instances/action contracts.

Only navigation/activation shell differs.

## 20. Editor Preview Story and Present

Preview Story and Present use the current last-valid in-memory package snapshot. Save is not required first.

A fatal validation error preserves existing last-valid-preview behavior and clearly indicates when the previous valid revision is being shown.

Routine authoring Scene switching is immediate. Preview Story/Present are the places where transitions, scroll activation, keyboard navigation, and runtime interaction policy are tested.

## 21. Persistence and validation

GUI Editor V1 persistence remains:

- Folder Open reads `project.json` and declared resources only;
- Folder Save writes only changed managed entries deterministically with `project.json` last;
- ZIP import/export preserves existing safety/pass-through behavior;
- Export is blocked by fatal production errors;
- Save may persist an invalid repairable draft only through existing explicit confirmation;
- Story 1.0/1.1 files not mutated preserve original bytes;
- no hidden project database or IndexedDB project authority.

Story 1.2 validation extends the production validation coordinator. Problems may add non-fatal layout warnings such as overflow, clearly distinguished from production schema/reference errors.

Resolved-reference validation for Story 1.2 must traverse into each composition envelope's nested semantic `block`, so metric/table/chart/image/legend references receive the same production checks as Story 1.1 semantic blocks.

## 22. Security and trust boundary

Story 1.2 contains bounded serializable data only. It may not contain:

- JavaScript;
- functions/callbacks;
- HTML fragments;
- arbitrary CSS;
- CSS URLs;
- MapLibre expressions;
- private MapLibre source/layer IDs;
- DOM selectors;
- module URLs;
- remote plugins;
- filesystem handles;
- editor history/selection state.

Trusted executable behavior remains installed application code selected through the existing capability registry.

Preview bridge remains origin/source checked and revision correlated. Authoring interaction messages are bounded semantic intents, not arbitrary method invocation.

## 23. Accessibility and desktop usability

Minimum requirements:

- keyboard Scene selection and reorder fallback;
- keyboard Select/Map mode access;
- keyboard Capture Camera / Restore Saved Camera;
- keyboard overlay select/delete/duplicate/z-order/alignment;
- arrow-key nudge so drag is not the only positioning mechanism;
- visible focus;
- Problems diagnostics navigate to Scene/object/property where possible;
- existing semantic table/chart/image accessibility remains intact;
- Presentation Next/Previous keyboard navigation;
- predictable Escape behavior.

Authors never need to type normalized coordinates.

## 24. Performance and rendering constraints

V1.1 preserves the one-map principle.

For any single active editor Scene surface or production output:

- exactly one MapLibre instance is mounted;
- Scene switching reuses it;
- overlays are DOM/content-renderer objects above map;
- drag/resize uses transient transforms and one commit at interaction end;
- production validation/package replacement does not run per pointer-move;
- chart instances follow existing create/destroy lifecycle.

Desktop certification covers 1920×1080 and 1366×768 with no material regression from settled interactive performance. Intended steady-state remains smooth 60 FPS-class presentation on the existing Route 61-2 benchmark hardware/content when browser/GPU sustain it.

No mobile editor certification is added. Existing Story 1.0/1.1 production runtime must retain a targeted 390×844 regression smoke because mobile compatibility is locked even though Story 1.2 mobile authoring/layout work is deferred.

## 25. Delivery slices

Each PR is reviewable and preserves certified V1 engine/persistence boundaries.

### PR A — Neutral shell + complete Story 1.2 Scene contract

Scope:

- introduce neutral generic production shell path and prove it with blank Story 1.2 project;
- keep still-required Route 61-2 legacy entry/adapter isolated until PR C;
- introduce complete Story 1.2 production validation contract, including composition-envelope schema;
- add minimal shared read-only Story 1.2 compositor sufficient to render schema-valid envelopes through existing semantic renderers;
- declarative camera with explicit coordinate bounds;
- explicit Capture Camera / Restore Saved Camera authoring behavior;
- declarative per-Scene project-layer visibility;
- authored interaction policy;
- authored transition;
- Scene switching/restoration;
- minimal desktop Scene filmstrip;
- trusted capability host/layer-control seam;
- frozen/versioned Story 1.2 compositor-default token contract;
- preserve Story 1.0/1.1 behavior including targeted 390×844 mobile smoke.

Do not add PowerPoint drag/resize/direct-edit authoring or perform full Route 61-2 conversion in PR A.

### PR B — Desktop PowerPoint Text authoring

Scope:

- authoring interaction layer over the already-valid shared 16:9 compositor;
- Text object first;
- direct text editing;
- drag/resize;
- normalized frame persistence;
- typography and box appearance;
- z-order;
- basic snapping/alignment;
- bounded undo/redo.

PR B must not change Story 1.2 schema semantics. Text composition is the proof gate before rich authoring.

### PR C — Rich authoring + templates + Route 61-2 conversion

Scope:

- Metric authoring;
- Image authoring;
- Chart authoring;
- Table authoring;
- Legend authoring;
- Blank template;
- Route proposal template;
- Network/service plan template;
- Import existing project entry point;
- immediate-validity template certification;
- move Route 61-2 fully onto neutral shell through trusted capabilities/project data;
- optional separate Story 1.2 Route 61-2 reference artifact without modifying canonical Story 1.0.

### PR D — Desktop outputs + certification

Scope:

- Scroll Story;
- Presentation mode;
- output navigation/keyboard;
- transition/interaction-policy verification;
- persistence/export/reopen of Story 1.2 composition;
- 1920×1080 certification;
- 1366×768 certification;
- performance/lifecycle checks;
- neutral blank-project check;
- Route 61-2 compatibility check;
- existing Story 1.0/1.1 390×844 mobile regression smoke;
- final V1.1 desktop lock/certification report.

Story 1.2 mobile-specific authored layout remains a later separately designed phase.

## 26. Acceptance and certification gates

### 26.1 Compatibility

- Story 1.0 production tests pass unchanged.
- Story 1.1 production tests pass unchanged.
- Canonical Route 61-2 Story 1.0 bytes unchanged.
- Unrelated Save/Export does not migrate 1.0/1.1.
- `PROJECT_MANIFEST_V1` remains accepted unchanged.
- GUI Editor V1 folder/ZIP package tests remain passing.
- No GUI-only serialized fields.
- Existing Story 1.0/1.1 mobile production path passes targeted 390×844 smoke.

### 26.2 Story 1.2 contract

- Story 1.2 root/state/envelope validation is complete in PR A.
- Every schema-valid Story 1.2 envelope has a deterministic production rendering path in PR A.
- PR B/C do not revise Story 1.2 schema semantics to enable their UI features.
- nested semantic block references receive production cross-resource validation.
- omitted appearance uses frozen/versioned Story 1.2 defaults, not ambient CSS.

### 26.3 Generic shell

Blank Story 1.2 project through neutral shell has:

- one MapLibre map;
- no Existing/Proposed/Difference tabs;
- no transport metrics;
- no simulation controls;
- no industrial/urban controls;
- no Route 61-2 labels;
- no Route 61-2 modules required by neutral shell path.

By PR C/D, Route 61-2 through same shell retains trusted domain behavior.

### 26.4 Camera

- map movement alone produces zero Story mutations;
- Camera changed status appears after divergence;
- Capture Camera = exactly one authored mutation;
- Restore Saved Camera = zero authored mutations;
- Scene switch restores saved camera;
- uncaptured camera never leaks across Scene changes;
- Preview Story/Present honor Fly/Ease/Instant + duration;
- longitude/latitude bounds are exact;
- reduced-motion fallback does not mutate authored data.

### 26.5 Layers

- visibility stored per Scene;
- Scene switch restores complete snapshot;
- ordinary visibility does not write action arrays;
- styling remains project-global;
- capability renderers honor stable project dataset IDs;
- no raw MapLibre ID enters project/Story JSON.

### 26.6 Composition

- editor canvas is true 16:9 Scene surface;
- read-only production compositor renders all valid envelopes in PR A;
- Text can be added, selected, directly edited, dragged, resized, duplicated, deleted, aligned, and z-ordered in PR B;
- frame data normalized/bounded;
- appearance constrained/deterministic;
- editor uses same production semantic renderers;
- no arbitrary CSS/HTML/JS serialized;
- Metric/Image/Chart/Table/Legend reuse existing descriptors/renderers;
- chart/table/image/legend accessibility remains intact;
- overflow surfaced rather than silently changing layout.

### 26.7 Templates

Each template result immediately passes unchanged `loadProject(...)` and production validators. Capability role requirements are either satisfied by valid bounded starter resources or the capability is not yet declared. No template relies on an invalid intermediate project.

### 26.8 Outputs

The same Story 1.2 file produces Scroll Story and Presentation mode.

At 1920×1080 and 1366×768:

- camera correct;
- layer state correct;
- overlay geometry matches 16:9 composition;
- navigation correct;
- interaction policy honored;
- trusted effects re-enter cleanly;
- one MapLibre instance per output;
- browser console clean;
- no editor chrome.

### 26.9 Persistence

A Story 1.2 project survives:

```text
Create/Open
→ compose Scenes
→ Capture Camera
→ change layer visibility
→ add/move/style overlays
→ Save or Export ZIP
→ close/reopen/import
→ production loadProject(...)
→ Scroll Story
→ Presentation mode
```

with no editor translation step and no loss of authored values.

## 27. Design closure

This design chooses extension over rewrite.

V1.1 substantially changes product UX while preserving:

- one production project package;
- one versioned Story system;
- one production loader/validator authority;
- one semantic content system;
- one trusted capability boundary;
- one MapLibre Scene runtime;
- shared production/editor composition;
- existing bounded folder/ZIP persistence.

The additive Story 1.2 contract owns routine Scene presentation state. Special domain behavior remains trusted capability actions.

The four approval-hardening rules are now part of this specification:

1. complete Story 1.2 + read-only production compositor in PR A;
2. explicit camera bounds + frozen/versioned compositor defaults;
3. immediately production-valid templates;
4. legacy Story 1.0/1.1 mobile runtime regression protection despite mobile V1.1 deferral.

Human design approval is recorded. The next Superpowers step is `writing-plans`; implementation must follow the reviewed plan rather than beginning ad hoc.