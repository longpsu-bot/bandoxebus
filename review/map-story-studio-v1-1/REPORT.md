# Map Story Studio V1.1 desktop certification

## Certification identity

- Branch: `feat/map-story-studio-v1-1-outputs-certification`
- PR-D base SHA: `9695c07b85dcf1e5e0d46e182edcfc0793695da2`
- Evidence HEAD when this report was started: `d5f2abb3e6e193e508ec5d22381fb3145faf5d24`
- D4 browser evidence commit: `0484c13516a018cde2b478bb8cf227c6dd502008`
- Exact HEAD at D5 report finalization time, before the report/docs commit: `0484c13516a018cde2b478bb8cf227c6dd502008`
- Final PR head: recorded in the Draft PR metadata/body after the documentation commit
- Story 1.2 schema freeze: PASS — diff from the required base is empty
- Canonical Route Story diff: EMPTY
- Canonical Route Story SHA-256: `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`

## Certified evidence

### D1 — Scroll Story

Session-1 evidence carried into this final session:

- shared production Story runtime/controller/compositor: PASS
- native document scrolling: PASS
- forward/backward Scene activation: PASS
- full-bleed map with centered 16:9 composition: PASS
- pointer-transparent activation sections and map/overlay pointer access: PASS
- cooperative gestures for interactive Scenes: PASS
- one active map and no duplicate Scene execution: PASS

### D2 — Presentation

Session-1 evidence carried into this final session:

- shared production Story runtime/controller/compositor: PASS
- map and compositor use the same 16:9 rectangle: PASS
- resize and `map.resize()` lifecycle: PASS
- Next/Previous and keyboard navigation: PASS
- Escape exit: PASS
- existing MapLibre instance reused: PASS
- one active map: PASS

### D3 — Story 1.2 persistence

Fixture: `tests/story-1.2-persistence.test.mjs`

The fixture is an ordinary production-valid Story 1.2 package with two Scenes, distinct exact cameras, complete layer-visibility snapshots, different interaction/transition policies, Text, Metric, Chart, Table, Image, Legend, a normalized table resource, declared image and metric resources, and two ordinary GeoJSON project layers.

- unchanged `loadProject(...)` before persistence: PASS
- Folder save/reopen through production loader: PASS
- ZIP export/import through production loader: PASS
- authored Story deep equality: PASS
- cameras, layers, frame geometry/z, appearance, nested semantic data, transitions/interactions: PASS
- asset/resource/metric declarations: PASS
- no selection, handles, guides, history, output mode, or uncaptured working camera persisted: PASS
- production persistence change required: NO — storage was already schema-agnostic; D3 is a test lock only
- focused D3 command: `node --test tests/story-1.2-persistence.test.mjs tests/editor-folder-storage.test.mjs tests/editor-zip-storage.test.mjs tests/editor-certification.test.mjs tests/project-loader.test.mjs`
- focused D3 result: 33 tests, 33 pass, 0 fail

### D4 — final browser/performance certification

Final composite gate exited `0` and emitted both the inherited PR-C marker and the PR-D marker.

- Blank neutral root: PASS; `blankRouteModules: []`, capability controls empty/hidden, one map
- 1920×1080 composition: PASS; map/stage `left=0`, `top=0`, `width=1920`, `height=1080`; all six representative overlay families had nonzero geometry
- 1366×768 Scroll composition: PASS; layout viewport `1351×768` after the native 15 px scrollbar, map `1351×768`, centered 16:9 stage `1365.328125×768`, document scroll height `2304`, three pointer-transparent steps
- actual camera transitions: PASS; `flyTo` beta at `160 ms`, `easeTo` gamma at `120 ms`, `jumpTo` alpha with no duration; reduced-motion Scroll used `jumpTo`
- complete layer restoration: PASS across beta → alpha → beta → gamma → beta → alpha; both project layers received the exact authored visibility value on every activation
- rich rendering/accessibility: PASS; nonempty image alt, empty decorative alt, two table headings, chart `role=img` with `Ridership` label, two fallback rows, visible configured heading, nonzero Metric/Chart/Table/Image/Legend geometry
- Scroll navigation: PASS; forward `0→768`, backward `848→0`, forward `0→768`; map-wheel cooperative scroll moved `768→848` without duplicate Scene execution
- Presentation exact stage: PASS at 1920×1080; map and compositor rectangles identical
- Presentation navigation: PASS for Next, Previous, ArrowRight, PageDown, and PageUp with one camera activation per Scene
- Presentation letterbox: PASS at 1200×900; map/stage both `left=0`, `top=112.5`, `width=1200`, `height=675`
- Presentation Escape: PASS; same active canvas survived navigation/exit and active map count remained one
- valid-unsaved output: PASS; Scroll and Presentation both launched current revision `1` without Save
- invalid-last-valid output: PASS; current locale `x` stayed invalid while Scroll and Presentation launched previous valid revision `1` with locale `en-US`
- Folder browser reopen: PASS; one map and representative configured heading present
- ZIP browser reopen: PASS; exported `3093` bytes, imported through the production editor path, one map and representative configured heading present
- Route 61-2 compatibility: PASS for Difference/Existing/Proposed/Compare, reveal, POI emphasis, industrial context via Overture, simulation, dynamic trusted adapter, neutral generic root
- Story 1.0/1.1 at 390×844: PASS; navigation worked, one map each, representative semantic geometry nonzero, horizontal overflow `0`
- one-map principle: PASS across every active output checked
- browser console: CLEAN
- certification-exposed fixes: cooperative MapLibre constructor policy now reaches the neutral generic map factory; Presentation writes CSS `inset` before centered offsets so the shorthand cannot erase letterbox/pillarbox positioning

Raw performance evidence, sampled once per viewport by the final successful gate:

| Viewport | Requested sample | Observed duration | Frames | Raw approximate FPS | Maps | Mode | Environment |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1920×1080 | 1000 ms | 1070.40000000149 ms | 14 | 13.079222720460118 | 1 | explore | Headless Edge/Chrome 151, Windows Win32, DPR 1, WebKit WebGL |
| 1366×768 | 1000 ms | 1004.5000000044702 ms | 59 | 58.73568939744892 | 1 | explore | Headless Edge/Chrome 151, Windows Win32, DPR 1, WebKit WebGL |

## Verification commands

- Output/persistence-focused command: `node --test tests/story-1.2-persistence.test.mjs tests/scroll-story.test.mjs tests/presentation-mode.test.mjs tests/presentation.test.mjs tests/story-runtime.test.mjs tests/story-map-interactions.test.mjs tests/scene-state-controller.test.mjs tests/project-bootstrap.test.mjs tests/generic-runtime-shell.test.mjs tests/generic-shell-neutrality.test.mjs tests/special-capability-boundary.test.mjs tests/editor-shell-preview.test.mjs tests/editor-validation.test.mjs tests/editor-folder-storage.test.mjs tests/editor-zip-storage.test.mjs tests/editor-certification.test.mjs tests/route-61-2-project.test.mjs`
- Output/persistence-focused result: 133 tests, 133 pass, 0 fail
- Final directly affected focused command: `node --test tests/presentation-mode.test.mjs tests/editor-certification.test.mjs tests/generic-runtime-shell.test.mjs tests/project-bootstrap.test.mjs tests/story-map-interactions.test.mjs`
- Final directly affected focused result: 46 tests, 46 pass, 0 fail
- Full suite command: `npm test`
- Full suite result: 509 tests, 509 pass, 0 fail
- Browser command: `node scripts/map-story-studio-browser-smoke.mjs --gate=pr-d --url=http://127.0.0.1:8080/editor/`
- Browser result: exit `0`; `MAP_STORY_STUDIO_PR_C_RESULT: PASS`; `MAP_STORY_STUDIO_PR_D_RESULT: PASS`

## Known non-blocking limitations

The single 1920×1080 headless sample was about 13.08 FPS and was not consistent with smooth 60-FPS-class settled behavior in this environment; the single 1366×768 sample was about 58.74 FPS and was consistent with that class. Hardware/headless scheduling variance was not used as an unrelated correctness threshold. The raw durations, frame counts, map counts, modes, and environment are authoritative; no performance PASS threshold was fabricated.

## D5 architecture audit

- Story/schema freeze command: `git diff --exit-code 9695c07b85dcf1e5e0d46e182edcfc0793695da2 -- data/schemas/story-1.2.schema.json data/stories/route-61-2.story.json`
- Story/schema freeze result: PASS, empty diff
- canonical Route hash: PASS, exact expected SHA-256
- neutrality command: `node --test tests/special-capability-boundary.test.mjs tests/generic-shell-neutrality.test.mjs`
- neutrality result: 7 tests, 7 pass, 0 fail
- direct Route dependency search over `index.html`, `src/runtime`, `src/scene`, and `src/app.js`: no matches
- Layer authoring search: one match in `editor/editor.js` registering the existing `map.set-visibility` advanced/legacy action target catalog; the Story 1.2 Layers UI writes complete `layerVisibility` snapshots and does not create those actions
- unsafe sink search over `editor`, `src/scene`, and `src/runtime`: no `innerHTML`, `eval(`, or `new Function` matches
- branch diff cleanliness against `origin/main...HEAD`: PASS
- generic Blank Route-module loads: NONE
- GUI-only schema: NONE
