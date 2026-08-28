# WELL_ROUNDED_MAP_STORY_TEMPLATE_V1 — Final Certification

## Authority

- Authoritative main: `b504d8008550c030c2b72e2a1bc324d2a1455f7a`.
- Post-merge CI: [run 33152413569](https://github.com/longpsu-bot/bandoxebus/actions/runs/33152413569) — PASS on the authoritative main SHA.
- Reused merged evidence: PRs [#6](https://github.com/longpsu-bot/bandoxebus/pull/6), [#7](https://github.com/longpsu-bot/bandoxebus/pull/7), [#8](https://github.com/longpsu-bot/bandoxebus/pull/8), and [#9](https://github.com/longpsu-bot/bandoxebus/pull/9).
- Route Story SHA-256: `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`; its diff from authoritative main is empty.

## No-JavaScript / no-HTML project proof

`NEW_PROJECT_NO_JS_HTML_RESULT: PASS`

A temporary copy of `tests/fixtures/well-rounded-template-v1/` was changed only through `project.json`, Story JSON, normalized table/metric JSON, GeoJSON point data, and the declared SVG image asset. The variation changed project chrome, initial camera, narrative and legend text, table/metric values, stop labels/coordinates, and image content. It loaded through `scripts/serve-project-fixture.mjs` and the unchanged production loader with six states, all four common map actions, and no `.js`, `.mjs`, or `.html` project files.

The aggregate SHA-256 of `src/**`, `index.html`, and root CSS was identical before and after the authoring experiment: `f184fbf629b9e429f8d7be2585688867c4b2d8d831ee4df3efdce2f9e21e2e2a`. A later certification-only responsive defect fix is listed below and is not part of the authoring variation.

## Contract baseline

- `PROJECT_MANIFEST_V1`: PASS — metadata, resources, focus, metrics, capabilities, provenance, implicit `core-content-v1`/`core-map-v1`, and executable-config rejection remain covered by merged contract tests and authoritative CI.
- `CORE_CONTENT_PACK_V1`: PASS — Story 1.0 keeps eyebrow, heading, paragraph, stat-group, callout, and disclosure; Story 1.1 adds table, chart, image, and legend through the production descriptor/renderer registry.
- `COMMON_MAP_ACTIONS_V1`: PASS — `map.focus`, `map.set-visibility`, `map.set-emphasis`, and `map.clear-emphasis` loaded and executed in the synthetic project.
- `DATA_METRIC_BINDING_V1`: PASS — line/point/polygon GeoJSON, bounded feature labels, normalized tables, static/computed metrics, and locale formatting remain covered by merged tests and the live project.
- `CAPABILITY_EXTENSION_BOUNDARY_V1`: PASS — the trusted special-capability fixture adds actions, targets, metrics, validation, and lifecycle without modifying Generic Story Runtime or Story Shell.
- Story Schema 1.0 compatibility: PASS; Route 61-2 remains byte-identical 1.0.
- Story Schema 1.1 authoring vocabulary: PASS.
- Chart.js `4.5.1`: PASS; the exact vendored runtime remains pinned under `vendor/chart.js/4.5.1/`.
- GUI/runtime parity: PASS — future GUI discovery uses the same manifest, content, action, capability, metric, and dataset-role descriptors accepted by production runtime validation.

## Browser certification

- Synthetic desktop `1920×1080`: PASS — table `354×123`, chart `274×220`, responsive image `364/364`, readable legend, visible point labels, keyboard navigation, and one MapLibre canvas.
- Synthetic mobile `390×844`: PASS — scroll-safe table `299×123`, chart `219×220` with accessible name, image `309/309`, readable legend/labels, and one MapLibre canvas.
- Story lifecycle: PASS — Explore → Story → Explore → Story returned to state 1 with one MapLibre canvas.
- Reduced motion: PASS — emulated `prefers-reduced-motion: reduce` reached `service-area` with no camera movement, active urban context, and a clean console. Story 1.1 chart/controller reduced-motion paths remain covered by authoritative tests.
- Compatibility: PASS — `?storyShell=legacy` opened seven legacy chapters with one map; `?storyShell=poc` opened Story Shell with one map; both consoles were clean.
- Evidence: [synthetic desktop labels](screenshots/synthetic-desktop-1920x1080.png), [synthetic desktop image](screenshots/synthetic-desktop-image-1920x1080.png), [synthetic mobile](screenshots/synthetic-mobile-390x844.png), [Route 61-2 connections](screenshots/route-connections-1920x1080.png).

## Route 61-2 regression

- Initial Explore, seven-state Story navigation, service-area context, proposed-route mode/reveal, exit, and re-entry: PASS.
- Service-area context: PASS — Overture provider active, 1,299 buildings loaded, ground visible, route layer order preserved.
- Transport POIs: PASS — three visible emphasized beacons remained absolutely positioned at geographic anchors, pillars were bottom-grounded at `0px`, and PR #9's map-plane ground-layer tests remain authoritative.
- Proposed route: PASS — final state selected only `proposed` mode, kept one visible proposed bus, and retained one MapLibre canvas.
- Console: PASS on the permitted settled rerun and on performance/compatibility runs. One transient OpenFreeMap `circle-11` sprite warning appeared once and did not reproduce on the fresh settled rerun.

## Performance

Existing CDP instrumentation, normal production Story Shell (`/?certPerf=1`; the inert query selected only the CDP target), `1920×1080`, settled `service-area`, one 15.009-second sample:

- Typical FPS: `59.9`.
- Sustained-low FPS: `59.5`.
- Average FPS: `60.0`.
- Settled MapLibre renders: `0`.
- Settled `triggerRepaint`: `0`.
- Settled source `setData`: `0`.
- MapLibre instances: `1`.
- Frames over 33/50 ms: `0 / 0`.

## Certification defect

The first mobile run exposed a Chart.js responsive parent/canvas feedback loop that expanded the chart canvas beyond 26,000 px. The bounded fix sets a `220px` canvas maximum in `src/content/chart-renderer.js`; one focused regression test proved RED then GREEN. The post-fix mobile and desktop measurements above are bounded and readable.

## Final verification

- `npm test`: `254/254` PASS.
- Source syntax: `24/24` PASS.
- `git diff --check`: PASS.
- Route 61-2 Story diff from authoritative main: empty.

`BASELINE_AUTHORING_CONTRACT_V1: LOCKED`

Lock meaning: GUI Editor V1 must read and write these production contracts, must not introduce a parallel GUI-only schema, and must version future compatible or breaking baseline additions explicitly. Trusted special capabilities remain extensible and do not mutate the baseline Story contract.

`FINAL_CERTIFICATION_RESULT: PASS`

`NEXT: GUI_EDITOR_V1_DESIGN`
