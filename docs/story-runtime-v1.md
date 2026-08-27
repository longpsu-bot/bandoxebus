# Generic Story Runtime V1

## Purpose

The story runtime separates Route 61-2 narrative data from navigation and application logic. A future editor can reorder states, edit structured content, and select supported map actions by writing the same JSON document the runtime consumes.

## Story definition

`data/stories/route-61-2.story.json` is the Route 61-2 story. `data/stories/story.schema.json` is the canonical machine-readable contract. Every story has `schemaVersion`, a stable project `id`, a `title`, and a non-empty ordered `states` array. Version 1 accepts only `schemaVersion: "1.0"`; later versions require an explicit runtime change.

Each state has a stable `id`, structured `content`, and declarative `map.enter` and `map.exit` action arrays. IDs identify states but have no semantic meaning to the runtime. Array order is story order.

## Content blocks

State content declares one presentation `layout` and an ordered `blocks` array. V1 supports:

- `eyebrow`: section label and optional authored step label;
- `heading`: primary heading plus optional subtitle and status;
- `paragraph`: prose without raw HTML;
- `stat-group`: metric bindings resolved from application-provided values;
- `callout`: one or more labeled contextual notes;
- `disclosure`: source or qualification text.

`presenterNote` remains optional authoring metadata and is never rendered. The registry is deliberately limited to blocks needed by the certified seven-state story.

## Actions and project boundary

The generic runtime dispatches actions strictly by their declared `type`. It knows nothing about Route 61-2, MapLibre layers, POIs, industrial context, or route geometry. Unknown action types fail clearly.

Validation has two deliberately separate layers. `data/stories/story.schema.json` is the generic structural Story V1 schema. At load time, `src/story-schema.js` delegates each action descriptor to an injected project action-contract registry. The Route 61-2 contracts live beside its handlers in `src/route-61-2-story-actions.js`, where required fields, supported values, primitive types, camera bounds, and unexpected properties are checked before the runtime can execute an action. A future project can supply different contracts without editing the generic validator.

The Route 61-2 adapter registers the V1 action vocabulary:

- `map.mode`
- `map.focus`
- `map.poi-emphasis`
- `map.urban-context`
- `route.reveal`

Handlers call existing project capabilities. The JSON contains data only: no functions, callbacks, DOM nodes, MapLibre objects, expressions, or runtime instances.

## Runtime lifecycle

The runtime validates a definition, exposes the current state/content, and supports activation, deactivation, next, previous, and direct navigation by index or ID. A transition runs the old state's exit actions before the new state's enter actions. Re-activating the current active state is a no-op; leaving and later re-entering a state runs one clean lifecycle each time.

The existing presentation shell remains responsible for buttons, dots, keyboard/Escape behavior, animation classes, and responsive layout. Its count, labels, order, content, and map behavior come from the runtime and story definition.

## Verification boundary

GitHub Actions runs the authoritative dependency-free source/runtime/unit/config gate with `npm test`. Browser rendering, MapLibre/OpenFreeMap integration, Overture context, and visual/performance certification remain a targeted local browser gate; they are intentionally not reproduced in CI V1.

## Responsive and future-editor rules

There is one story definition for all viewport sizes. Responsive rendering and camera padding remain renderer concerns; an optional semantic focus target plus bounded camera overrides avoids separate desktop/mobile stories. Editor-only UI state does not belong in the schema. The future GUI may manipulate the serializable document but is not a runtime dependency.
