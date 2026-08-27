# PERFORMANCE_ROOT_CAUSE_V1

## Environment

- viewport: 1920×1080 primary; 1366×768 control
- browser: headed Microsoft Edge 151.0.4129.107, page brought to foreground and focused
- map runtime: MapLibre GL JS 5.24.0
- benchmark duration: 15 seconds per stationary sample
- repetitions: 3 per incremental state where practical
- camera state: certified settled Slide 05 camera (`service-area`, pitch 52°, bearing -10°, max zoom 13.6)
- measurement method: deterministic `requestAnimationFrame` frame-time recorder after camera settle and warm-up; typical FPS is the median frame-time reciprocal; sustained low is the 95th-percentile frame-time reciprocal. CDP counters recorded MapLibre renders, repaint requests, marker updates, GeoJSON source updates, script time, and task time.

## Incremental stationary benchmark

These figures describe the pre-fix isolation run. States A–E were deliberately frozen and visually stationary. State F retained the production 30 Hz bus simulation.

### A — stripped basemap

- median/typical FPS: 59.9
- sustained low: 59.5 FPS
- observed average range: 60.0–60.0 FPS
- static MapLibre renders after settle: 0 in two runs; 1 one-time render in the first run

### B — + route/static geographic layers

- FPS: 59.9 typical; 59.5 sustained low
- delta: approximately 0 FPS
- observed average range: 60.1–60.1 FPS

### C — + 1,299 Overture buildings

- FPS: 59.9 typical; 59.5 sustained low
- delta: approximately 0 FPS while settled because the static map did not repaint
- observed average range: 60.1–60.1 FPS

### D — + POIs/labels/context

- FPS: 59.9 typical; 59.5 sustained low
- delta: approximately 0 FPS while settled
- observed average range: 60.1–60.1 FPS

### E — + stationary buses

- FPS: 59.9 typical; 59.5 sustained low
- delta: approximately 0 FPS
- observed average range: 60.1–60.1 FPS
- MapLibre renders: 0 in all three runs

### F — + animated buses (pre-fix)

- FPS: 30.2–59.9 typical across runs
- sustained low: 20.0–59.5 FPS
- observed average range: 36.6–58.8 FPS
- delta from E: -23.4 to -1.2 average FPS depending on stop-pulse activity
- frame spikes: up to 83.4 ms; worst run contained 190 frames over 33 ms and 28 frames over 50 ms
- correlation: 13–152 `stop-pulses.setData()` calls and 51–487 MapLibre renders per 15-second run. More pulse source updates produced proportionally more script/task time and lower FPS.

### G — custom rendering

- active: no
- FPS impact: not applicable. The Three.js layer is only constructed for the Morphology V2 fallback and was absent from the production Overture style/layer inventory.

## Lifecycle

- fresh Slide 05 FPS before fix: 33.3 average; 30.1 typical; 20.0 sustained low
- after repeated re-entry FPS before fix: 43.2 average; 59.9 typical; 19.9 sustained low
- fresh Slide 05 FPS after fix: 59.4 average; 59.9 typical; 59.5 sustained low
- after repeated re-entry FPS after fix: 60.0 average; 59.9 typical; 59.5 sustained low
- duplicated loops/listeners/sources/layers: no
- notes: the required `05 → 06 → 05 → 04 → 05` sequence retained one bus RAF loop, 11 sources, 69 layers, and stable listener counts after the fix. The pre-fix fresh/re-entry difference tracked 153 versus 68 pulse-source updates, not accumulated lifecycle work.

## Continuous rendering

- static scene continuously repainting: no
- repaint requester(s): none when Slide 05 is settled and buses are frozen; measured MapLibre renders were 0 over 15 seconds
- pre-fix conditional requester: while a stop pulse was active, `startBusSimulation()` → `animate()` → `updatePulses()` → `map.getSource('stop-pulses').setData(...)` invalidated the map and entered MapLibre `_update()` / `_render()` repeatedly
- post-fix production animation: the bus RAF loop continues and the DOM bus marker moves, but the settled map recorded 0 MapLibre renders and 0 source mutations in three 15-second 1920×1080 samples

## Camera transition

- before transition FPS: 59.4 average; 59.9 typical; 59.5 sustained low
- during transition FPS: 19.2 average; 20.0 typical; 12.0 sustained low over the 1.6-second transition sample
- after transition FPS: 60.0 average; 59.9 typical; 59.5 sustained low
- time until FPS stabilizes: within 1 second after the 1.05-second camera transition ended
- 23 FPS condition occurs during: multiple pre-fix states (stationary and transition), specifically when stop pulses forced map repaint; it was not re-entry-specific. Post-fix sub-30 behavior is confined to the brief camera transition.

## ROOT_CAUSE_HYPOTHESIS

Observed:

The 1920×1080 production scene alternated between stable display cadence and sustained 20–30 FPS lows. Slow windows coincided with active stop-pulse animation, not with lifecycle re-entry or a continuously dirty static map.

Isolation evidence:

- Stationary full Slide 05 with visible frozen bus: 59.9 typical / 59.5 sustained-low FPS; 0 map renders.
- Production animation: as low as 36.6 average / 20.0 sustained-low FPS; 487 map renders and 152 full `stop-pulses` source updates in 15 seconds.
- Suppress bus marker movement only: slowdown remained (47.5 average / 29.9 sustained-low FPS in the short isolation run).
- Suppress only `stop-pulses.setData()` while leaving the bus loop and marker movement active: 60.0 average / 59.5 sustained-low FPS and 0 map renders.
- Incremental `GeoJSONSource.updateData()` test: rejected; it still forced 547 map renders in 15 seconds and reached only 38.8 average / 29.8 sustained-low FPS.

Component responsible:

`updatePulses()` in `src/app.js`, specifically repeated mutation of the MapLibre GeoJSON source for an animation that did not need to redraw the map canvas.

Why it explains 23–43 FPS instability:

Pulse updates existed only during the approximately 1.05-second window after a bus entered a stop radius. Benchmark runs therefore varied with the bus position and number of active pulses. Each source mutation forced the full Slide 05 map to render, including the Overture extrusion layer when visible.

Minimal test to prove/disprove:

Suppress only the native `stop-pulses.setData()` call while retaining the bus RAF loop, stop-distance checks, and DOM marker movement. The scene immediately returned to stable display cadence with no map renders.

- confirmed by minimal test: yes

## Fix

- bounded fix implemented: replace the continuously mutated MapLibre stop-pulse source/layer with a short-lived CSS-animated DOM marker created once per newly triggered stop. The existing 30 Hz bus movement, stop trigger radius, once-per-loop semantics, and 1.05-second pulse duration remain.
- files changed:
  - `src/app.js`
  - `src/stop-pulses.js`
  - `styles.css`
  - `tests/stop-pulses.test.mjs`
  - `scripts/performance-root-cause-v1.mjs` (diagnostic harness)
  - `docs/superpowers/plans/2026-08-27-performance-root-cause-v1.md`
  - `review/performance-root-cause-v1/REPORT.md`
- visual compromise introduced: no; the transient amber expanding/fading stop pulse remains visible, while its rendering moves from MapLibre source mutation to CSS compositing

## Post-fix certification

### 1920×1080

- stationary median/typical FPS: 59.9
- sustained low: 59.5 FPS
- observed range: 59.9–60.0 average FPS across three 15-second production-state runs
- frame-time range: 16.8–17.1 ms
- MapLibre renders while settled: 0 in all three production-state runs
- source mutations while settled: 0 in all three production-state runs
- bus movement: 359–363 marker position updates per run; visually moving

### 1366×768

- stationary FPS: 59.9 typical; 59.5 sustained low
- observed range: 59.9–60.0 average FPS across three 15-second runs
- frame-time range: 16.8–17.1 ms

## Regression

- tests: 75/75
- console errors: 0
- new warnings: 0
- seven-slide smoke: pass; canonical order `intro → existing → adjustment-context → route-changes → service-area → connections → final-proposal`
- Slide 04/05/06 lifecycle: pass; urban context `off → active → off`
- cached re-entry: pass; Overture remained loaded and returned visible
- keyboard/back/Escape: pass
- reduced motion: pass; Slide 05 camera was settled immediately and no console diagnostics occurred
- bus movement: pass
- stop pulse: pass; a DOM pulse was observed during live simulation
- POIs: pass; all three Slide 05 POI layers visible
- Overture buildings: pass; 1,299 loaded and extrusion layer visible
- stripped dark basemap: pass
- disclosure: visible
- attribution: visible

## Decision

`PERFORMANCE_ROOT_CAUSE_V1_RESULT: PASS`

- stationary 1920×1080 sustained >=30 FPS: yes (59.5 FPS sustained low)
- root cause understood: yes
- regression clean: yes

Next recommended gate:

`MAP_STORYTELLING_POC_V1`
