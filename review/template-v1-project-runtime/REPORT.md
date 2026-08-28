# Template V1 Project Runtime — Gate B

- Base/main SHA: `00885d80ed8b333aef85ab2426e77c9569da5556`
- Branch: `feat/template-v1-project-runtime`
- Manifest bootstrap: PASS — normal `/` loads `./project.json`, validates resources and Story, then enters `bootstrapProject`.
- Story 1.0 byte-identical: PASS — `git diff origin/main -- data/stories/route-61-2.story.json` is empty.
- Seven states unchanged: PASS — `intro → existing → adjustment-context → route-changes → service-area → connections → final-proposal`.
- Route/context/reveal parity: PASS — all states traversed; `service-area` loaded 1,299 Overture buildings; canonical route reveal and context handlers remained active.
- Desktop/mobile lifecycle: PASS — 1920×1080 and 390×844 both preserved initial Explore, launcher entry, seven-state traversal, Story → Explore, and re-entry at `intro`.
- Legacy fallback: PASS — `?storyShell=legacy` opened and closed the legacy presentation with a clean console. `?storyShell=poc` retained the Story Shell alias.
- One MapLibre instance: PASS — one canvas throughout Explore, Story, exit, and re-entry; CDP reported `mapInstances: 1`.
- Console clean: PASS — no warnings or errors in desktop, mobile, legacy, alias, or CDP runs.
- Manifest-owned chrome: PASS — `vi-VN`, document title, project title/subtitle, and accessible map/panel labels came from the manifest.

## Performance

Existing CDP `story-shell-benchmark` methodology, 1920×1080, settled `service-area`, three 15-second samples:

- Typical FPS: 59.9
- Settled sustained-low FPS: 59.5
- Average FPS: 59.97
- Frames over 33/50 ms: 0 / 0
- Settled MapLibre renders: 0
- Settled `triggerRepaint`: 0
- Settled source `setData`: 0
- Map instances: 1

## Tests

- Focused loader/bootstrap/startup/manifest/composition suites: PASS
- Static GeoJSON parity: PASS for both routes and both stop collections, including coordinate values, order, and feature counts
- Tests: 214/214 PASS
- Source syntax checks: PASS
- `git diff --check`: PASS

## Compatibility adapters remaining

- `src/route-data.js` remains the production geometry/comparison authority while the exact static GeoJSON copies satisfy Manifest V1 during migration.
- Route layers, stops, POIs, popups, road labels, bus simulation, and reveal implementation remain trusted application-owned code in `src/app.js`.
- `src/urban-context.js` and the existing Overture-building load remain trusted application-owned inputs.
- These adapters can be retired when the later generic map capability consumes validated manifest datasets directly.

`TEMPLATE_V1_PROJECT_BOOTSTRAP_RESULT: PASS`
