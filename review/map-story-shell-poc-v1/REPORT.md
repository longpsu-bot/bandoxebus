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
- typical FPS: unavailable — the permitted Chrome control surface cannot inject main-world instrumentation
- sustained low: unavailable — the permitted Chrome control surface cannot inject main-world instrumentation
- recurring MapLibre renders: unavailable — exact render counting could not be instrumented
- recurring triggerRepaint: unavailable — exact call counting could not be instrumented
- recurring source mutations: unavailable — exact call counting could not be instrumented

1366×768 settled:
- typical FPS: unavailable — the permitted Chrome control surface cannot inject main-world instrumentation
- sustained low: unavailable — the permitted Chrome control surface cannot inject main-world instrumentation

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
- PR #2 head SHA: pending push
- GitHub Actions: pending
- CI run URL: pending

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

Frozen contract changes:
- story JSON: none
- Story Schema V1: none
- Generic Story Runtime V1: none
- project action contracts: none

Legacy presentation retained:
- yes

Recommendation:

The shell behavior and responsive browser checks pass, but the required settled FPS and exact render/repaint/source-mutation measurements could not be collected through the permitted browser control surface. Certification therefore remains conservative.

MAP_STORY_SHELL_POC_V1_RESULT:
REVISE
