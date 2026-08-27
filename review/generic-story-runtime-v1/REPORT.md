# GENERIC_STORY_RUNTIME_V1

## Architecture

- story definition path: `data/stories/route-61-2.story.json`
- schema path/version: `data/stories/story.schema.json`, `1.0`
- runtime modules: `src/story-schema.js`, `src/story-action-runner.js`, `src/story-runtime.js`, `src/presentation-renderer.js`
- action-dispatch boundary: `src/route-61-2-story-actions.js`
- existing presentation shell retained: yes

## Route 61-2 migration

- states migrated: 7/7
- story order now config-driven: yes
- text/content now config-driven: yes
- map enter/exit behavior config-driven: yes
- route-specific logic remaining in generic runtime: none

## Content blocks implemented

- `eyebrow`
- `heading`
- `paragraph`
- `stat-group`
- `callout`
- `disclosure`

## Map action types implemented

- `map.mode`
- `map.focus`
- `map.poi-emphasis`
- `map.urban-context`
- `route.reveal`

## Validation

- unsupported schema version rejected: yes
- duplicate IDs rejected: yes
- unknown actions rejected: yes
- malformed blocks rejected: yes
- malformed actions rejected: yes

## Config-only proof

- reordered states without runtime-code change: pass; production-config test swaps states 2/3 and observes content, navigation position, and map actions moving together
- changed content without runtime-code change: pass; production-config test changes the first heading and observes the runtime value
- certified original config restored: yes; experiments operate on parsed clones and the checked-in JSON retains canonical order/text

## Regression

- tests before: 75/75
- tests after: 95/95
- console errors: 0
- console warnings introduced: 0
- seven-state smoke: pass; `intro → existing → adjustment-context → route-changes → service-area → connections → final-proposal`
- lifecycle: pass; `off → active → off → active`, 11 sources and 69 layers remain stable
- keyboard/back/Escape: pass
- comparison modes: pass; existing, proposed, compare, and difference controls announce and render normally
- bus simulation: pass; moving marker and DOM stop pulse observed
- Overture context: pass; provider `overture`, 1,299 buildings loaded, extrusion visible, cached re-entry visible
- reduced motion: pass; Slide 05 camera is immediately settled
- disclosure/attribution: pass/visible

## Performance

- 1920×1080 settled: 59.9 FPS typical, 59.5 FPS sustained-low, 60.0 FPS average over 10 seconds
- 1366×768 settled: 59.9 FPS typical, 59.2 FPS sustained-low, 60.0 FPS average over 10 seconds
- continuous settled source mutations: 0 at both viewports; MapLibre renders/repaint requests also 0
- regression vs certified baseline: no
- note: the first post-load sample can contain one asynchronous `route-road-labels.setData()` cache application; subsequent settled samples are mutation-free and this is not continuous rendering

## Files added

- `data/stories/route-61-2.story.json`
- `data/stories/story.schema.json`
- `docs/story-runtime-v1.md`
- `docs/superpowers/plans/2026-08-27-generic-story-runtime-v1.md`
- `src/story-schema.js`
- `src/story-action-runner.js`
- `src/story-runtime.js`
- `src/route-61-2-story-actions.js`
- `tests/story-schema.test.mjs`
- `tests/story-runtime.test.mjs`
- `tests/story-config-proof.test.mjs`
- `tests/route-61-2-story-actions.test.mjs`
- `review/generic-story-runtime-v1/REPORT.md`

## Files changed

- `README.md`
- `src/app.js`
- `src/presentation.js`
- `src/presentation-renderer.js`
- `tests/presentation.test.mjs`
- `tests/presentation-content.test.mjs`
- `tests/presentation-renderer.test.mjs`

## Files removed

- `src/presentation-content.js`

## Known limitations

- V1 supports only the six structured block types required by the benchmark.
- Camera focus accepts a semantic project target plus bounded camera overrides; feature-ID focus resolution is deferred.
- JSON Schema is canonical while the dependency-free browser validator enforces required V1 runtime checks.

## Recommendation

The contract is serializable, configuration-controlled, lifecycle-safe, and preserves the certified presentation and performance baseline.

`GENERIC_STORY_RUNTIME_V1_RESULT: PASS`

If PASS, next recommended gate: `MAP_STORY_SHELL_POC_V1`
