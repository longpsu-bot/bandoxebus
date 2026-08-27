# MAP_STORY_SHELL_POC_V1

Base:
- main SHA: `4cc2a159a71e6464a8b80fb9a7f4a8355254507f`
- implementation branch: `feat/map-story-shell-poc-v1`
- baseline tests: 108/108

Architecture:
- shell modules: `src/story-shell.js`, `src/story-map-interactions.js`
- IntersectionObserver: yes
- visibleEntries cache: yes
- story definition reused unchanged: yes
- generic runtime reused unchanged: yes
- story schema reused unchanged: yes
- content renderer reused: yes
- Route 61-2 action adapter reused unchanged: yes
- MapLibre instances: 1
- separate mobile content: no
- separate projector content: no

Navigation:
- scroll/swipe → runtime: pass
- buttons → runtime: pass
- arrows → runtime: pass
- Space → runtime: pass
- programmatic navigation → runtime: pass
- observer cache across callback batches: pass
- latest-state-wins: pass
- active state/progress synchronization: pass
- boundaries: pass
- editable targets ignored: pass

Responsive:
- 1920×1080: pass
- 1366×768: pass
- 390×844: pass
- 320×568: pass
- horizontal overflow: no
- duplicated story authoring: no

Story / Explore lifecycle:
- enter: pass
- exit: pass
- repeated re-entry: pass
- observer duplication: no
- listener duplication: no
- exact MapLibre interaction restoration: pass

Map regression:
- stripped Dark basemap: pass
- Overture: pass
- route: pass
- stops: pass
- POIs: pass
- industrial context: pass
- buses: pass
- comparison modes after Explore return: pass
- reduced motion: pass (automated behavior and CSS contract; browser media emulation unavailable)
- attribution/disclosure: pass
- console: clean

Performance:

1920×1080 settled:
- run 1: 59.9 typical FPS; 59.5 sustained-low FPS; 60.0 average FPS; 16.80 ms p95; 16.90 ms maximum; 0 frames >33 ms; 0 frames >50 ms; 0 MapLibre renders; 0 `triggerRepaint()` calls; `sourceSetData: {}`
- run 2: 59.9 typical FPS; 59.5 sustained-low FPS; 60.0 average FPS; 16.80 ms p95; 16.90 ms maximum; 0 frames >33 ms; 0 frames >50 ms; 0 MapLibre renders; 0 `triggerRepaint()` calls; `sourceSetData: {}`
- run 3: 59.9 typical FPS; 59.5 sustained-low FPS; 60.0 average FPS; 16.80 ms p95; 17.00 ms maximum; 0 frames >33 ms; 0 frames >50 ms; 0 MapLibre renders; 0 `triggerRepaint()` calls; `sourceSetData: {}`
- typical FPS range: 59.9–59.9
- sustained-low FPS range: 59.5–59.5
- average FPS range: 60.0–60.0
- moving-bus marker updates: 359–361 per 15-second run

1366×768 settled:
- run 1: 59.9 typical FPS; 59.5 sustained-low FPS; 60.0 average FPS; 16.80 ms p95; 16.90 ms maximum; 0 frames >33 ms; 0 frames >50 ms; 0 MapLibre renders; 0 `triggerRepaint()` calls; `sourceSetData: {}`
- run 2: 59.9 typical FPS; 59.5 sustained-low FPS; 60.0 average FPS; 16.80 ms p95; 16.90 ms maximum; 0 frames >33 ms; 0 frames >50 ms; 0 MapLibre renders; 0 `triggerRepaint()` calls; `sourceSetData: {}`
- run 3: 59.9 typical FPS; 59.5 sustained-low FPS; 60.0 average FPS; 16.80 ms p95; 17.30 ms maximum; 0 frames >33 ms; 0 frames >50 ms; 0 MapLibre renders; 0 `triggerRepaint()` calls; `sourceSetData: {}`
- typical FPS range: 59.9–59.9
- sustained-low FPS range: 59.5–59.5
- average FPS range: 60.0–60.0
- moving-bus marker updates: 354–365 per 15-second run

Lifecycle control:
- sequence: Story state 4 → Explore → Story → state 4 → settle → 15-second sample
- result: 59.9 typical FPS; 59.5 sustained-low FPS; 60.0 average FPS; 16.80 ms p95; 18.20 ms maximum; 0 frames >33 ms; 0 frames >50 ms
- counters: 0 MapLibre renders; 0 `triggerRepaint()` calls; `sourceSetData: {}`
- map instances: 1
- rendered Story steps after re-entry: 7
- duplicated rendering work observed: no

Method and settled-state evidence:
- browser: headed Microsoft Edge 151.0.4129.107 with a dedicated temporary CDP profile on port 9222
- URL: `http://127.0.0.1:8080/?storyShell=poc`
- sampling: `requestAnimationFrame` frame intervals; typical FPS = reciprocal median; sustained-low FPS = reciprocal p95; average FPS = frame count / elapsed time
- duration and repetitions: 15 seconds × 3 per viewport
- entry path: real Story launcher and successive Story Shell Next controls to state index 4 / `service-area`
- settle gate: camera stopped, shell scroll stable, urban context active, Overture loaded with 1,299 buildings, then 1.5 seconds with no source mutation before counter reset
- warm-up behavior: one-time `route-road-labels` cache application occurred before samples (12 calls at 1920×1080; 9 calls at 1366×768); all measured windows had `sourceSetData: {}`
- runtime state: one MapLibre instance, one visible moving production bus, Overture buildings visible, Story Shell DOM active, clean console
- diagnostic harness: `scripts/performance-root-cause-v1.mjs story-shell-benchmark`; historical commands remain available
- sustained >=30 FPS: yes
- recurring settled source mutation: no
- runaway MapLibre render/repaint loop: no
- regression versus certified baseline: no

Mobile:
- scroll responsiveness: pass at 390×844; swipe changed state 4 → 5 and advanced document scroll
- activation responsiveness: pass
- runaway repaint loop: not observed; exact instrumentation unavailable

Tests:
- baseline: 108/108
- final: 137/137
- syntax: 22/22
- git diff --check: pass

CI:
- final certification metadata is recorded after the diagnostic/report commit is pushed and its GitHub Actions run completes

Files added:
- `src/story-shell.js`
- `src/story-map-interactions.js`
- `tests/story-shell-selection.test.mjs`
- `tests/story-shell-dom.test.mjs`
- `tests/story-shell-controller.test.mjs`
- `tests/story-map-interactions.test.mjs`
- `tests/story-shell-markup.test.mjs`
- `tests/story-shell-integration.test.mjs`
- `review/map-story-shell-poc-v1/REPORT.md`
- responsive and sequence screenshots under `review/map-story-shell-poc-v1/`

Files changed:
- `index.html`
- `styles.css`
- `src/app.js`
- `src/presentation.js`
- `tests/presentation.test.mjs`
- `scripts/performance-root-cause-v1.mjs` (CDP Story Shell certification command only)

Frozen contract changes:
- story JSON: none
- Story Schema V1: none
- Generic Story Runtime V1: none
- project action contracts: none

Legacy presentation retained:
- yes

Recommendation:

The Story Shell matches the certified stationary baseline at both required viewports. Buses remain active while the settled MapLibre canvas performs no recurring render, repaint, or GeoJSON source-mutation work. The re-entry control produces the same result with one MapLibre instance and no duplicated rendering work.

MAP_STORY_SHELL_POC_V1_RESULT:
PASS

PROMOTE_STORY_SHELL
