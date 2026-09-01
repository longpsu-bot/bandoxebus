# Studio Completeness Correction

This evidence covers the bounded Studio correction on Draft PR #29. It does not start or claim performance recertification.

## Identity

- Starting SHA: `de024f986a27de633320d3761a6998cc5955752c`
- Ending executable SHA: `a8a5c170be1c3b3982d587ac1084bd217de27c93`
- Base: `9695c07b85dcf1e5e0d46e182edcfc0793695da2`

## Insert workflows

- Heading, Body text, and Legend insert immediately in a Blank Story 1.2 project.
- Metric, Chart, Table, and Image use an editor-level, resource-aware insert coordinator. Existing resources are chosen explicitly when choice is meaningful; missing resources route into the existing metric, normalized-table, and asset authoring flows.
- The pending insert intent and chooser selection are UI-only. Cancel and invalid/incompatible creation leave Story/package data unchanged.
- Rich factories accept explicit `metricId`, `datasetId`, `assetId`, and `chartType` inputs while emitting the unchanged production descriptors.
- Browser flow at 1440×900: inserted Heading, Body text, and Legend; created static metric `daily-ridership` (`Daily ridership`, value `1250`) and inserted Metric; imported `tests/fixtures/well-rounded-template-v1/data/demand.json`, then inserted Chart and Table; imported `tests/fixtures/well-rounded-template-v1/assets/site-photo.svg` and inserted Image. The resulting object list showed all seven production object families.

## Layer Select + Locate

- The checkbox changed only active-Scene visibility and sent no locate command.
- Clicking `Existing route` selected the stable project dataset and sent exactly one `locate-project-layer` command; clicking the already-selected name sent it again.
- The preview protocol validates exact source, origin, envelope, revision, command keys, and stable dataset ID. The host resolves only validated GeoJSON project resources; private MapLibre IDs never cross the protocol.
- Line, polygon, Multi* geometry, and multiple points use collective bounds with `fitBounds` (`padding: 48`, `maxZoom: 16`, short nonessential motion; zero duration for reduced motion). A single point uses `easeTo` at a bounded zoom no greater than 15. Empty GeoJSON keeps selection and camera intact and reports that there are no features to locate.
- Browser flow used a non-empty GeoJSON route: checkbox visibility-only, layer-name select and locate, real Map-mode drag away, repeat layer-name click, and visual re-centering. Locate created no Story mutation/history entry. The working-camera divergence and Capture Camera controls remained visible in selected-layer Properties; only an explicit Capture Camera authored the Scene camera.

## Attribution

- Both generic and fallback map constructors pass native MapLibre attribution options `{ compact: true }`; attribution is never disabled.
- The native compact control is collapsed after its first load and remains the stock expandable MapLibre control. No custom attribution, CSS hiding, or serialized state was added.
- At 1440×900 the initial control was the compact `ⓘ` state with one active MapLibre canvas. Activating it exposed the preserved OpenFreeMap, OpenMapTiles, and OpenStreetMap links.

## Verification

- Focused Studio/runtime set: 72 passed, 0 failed.
- Scroll Story / Presentation / capability / neutral-shell regression set: 44 passed, 0 failed.
- Final full suite: 527 passed, 0 failed.
- Story 1.2 schema diff: empty.
- Canonical Route Story diff: empty.
- Canonical Route Story SHA-256: `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`.
- `git diff --check origin/main...HEAD`: passed at the executable boundary.
- Unsafe-sink grep found no `innerHTML`, `eval(`, or `new Function` matches in `editor` or `src/runtime`.
- Application console: clean in a fresh isolated Chromium CDP reload (zero console error/warning calls and zero uncaught runtime exceptions). Chromium separately reported its pre-existing sandbox advisory and missing optional favicon; neither came from application console calls. The in-app control session also produced one control-instrumentation `MutationObserver` exception with no matching repository source.

## Remaining gate

Performance recertification remains paused and is the outstanding review blocker. No FPS sample, base/head performance comparison, Gate D resolution, Ready transition, or merge was performed.
