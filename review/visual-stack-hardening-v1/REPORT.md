# VISUAL_STACK_HARDENING_V1

## Production promotion

- Production building dataset: `data/context/my-phuoc-1-buildings.geojson`
- Metadata: `data/context/my-phuoc-1-buildings.meta.json`
- Overture release: `2026-08-19.0`
- Feature count: 1,299
- AOI coverage: 41.7409%
- Runtime default: Overture
- Fallback: Morphology V2 only after Overture validation/load failure
- Hybrid filling: none
- POC-only runtime cruft removed: experiment query routing, render-envelope source updates, synthetic debug overlay/flag, POC runtime naming
- Historical POC provenance: preserved in the authoritative AOI filename, preprocessing history, and this review record

## Render-envelope benchmark

All modes initially transferred and parsed the same 1,014,641-byte production GeoJSON. Modes B/C used a smaller `setData` collection only after the Slide 05 camera settled, so they did not reduce initial transfer or initial parsing.

| Mode | Active features | Active serialized source | 1366×768 FPS | 1920×1080 FPS | Source update | Visual result |
|---|---:|---:|---:|---:|---:|---|
| Full | 1,299 | 1,014,579 B runtime serialization | 40 | 37 | none | Complete context |
| Buffered (+20% view bounds) | 1,299 | 1,014,579 B | 42 | 38 | 821–4,204 ms | Identical; no culling benefit |
| Tight (theoretical 49% inset per side) | 0 | 1,259 B | 32 | 42 | 2,080–4,610 ms | All Overture buildings missing |

Decision: **REJECT**. The fitted Slide 05 camera includes the complete authoritative AOI. A conservative envelope retains every feature and adds expensive source reconstruction. A tight envelope improves one high-resolution sample only by removing all required building context. All envelope runtime code was removed after measurement.

## Basemap comparison

One map tab was active for each clean comparison run. Resource Timing was not exposed by the browser harness, so request count was not captured. All three candidates use the same OpenFreeMap/OpenMapTiles vector source; stripping style layers must not be interpreted as proof that unused tile geometry was not downloaded or decoded.

| Candidate | 1366×768 FPS | 1920×1080 FPS | Route prominence | Geographic readability | Clutter / warnings |
|---|---:|---:|---|---|---|
| Current Liberty | 48 | 28 | Strong | Best road/land contrast | More visual weight; no warnings |
| Official OpenFreeMap Dark | 49 | 30 | Very strong | Adequate but subdued | Missing `wood-pattern` warning |
| Stripped Dark | 46 | 43 | Strongest | Adequate roads, water and boundaries | Lowest clutter; no warnings; no basemap buildings |

Selected production basemap: **STRIPPED_DARK**.

Reason: It gives Route 61-2 and Overture buildings the clearest hierarchy, removes the redundant building fabric and noisy categories, eliminates the official candidate's missing-pattern warning, and produced the strongest clean 1920×1080 comparison. The 1366×768 difference from Liberty was not meaningful. Subsequent high-resolution samples remained volatile, so the performance gate is reported separately below rather than overstated.

## Performance profile

- Overture `fill-extrusion`: visible contributor at 1,299 footprints, but envelope results show the Slide 05 composition cannot cull them without losing context.
- Basemap: style composition materially affects the 1920×1080 clean comparison; unused vector-tile geometry may still be transferred/decoded.
- Three.js: not active on the production Overture path; retained only for Morphology V2 fallback.
- Bus simulation: its per-frame DOM marker update was the clearest cheap contributor. Disabling it produced a 60 FPS diagnostic sample at 1366×768 versus 41–42 with it active. Production now retains the simulation but caps marker updates at 30 Hz; the bus was visually verified to keep moving.
- Labels: route-adjacent road label computation remains worker-backed and cached; two labels were active in the final Slide 05 smoke run.
- Source/layer lifecycle: no source reconstruction remains in production; no duplicate warnings or lifecycle leaks observed.
- Camera transitions and transparent route/AOI layers still contribute transient work.
- Final active-bus sample: 44 FPS at 1366×768.
- High-resolution behavior: volatile 23–43 FPS across clean stripped-Dark runs; the last 1920×1080 sample was 23 FPS. This fails the hard minimum in the worst observed case and requires a follow-up profiling pass rather than a claim of success.

## Visual validation

- Route 61-2 strongest element: yes
- Roads readable: yes, deliberately subdued
- Overture buildings appropriate: yes
- Illustrative heights appropriate: yes; no canyon effect or route occlusion observed
- General labels appropriate: yes
- Industrial AOI appropriate: yes
- Disclosure correct: yes
- Attribution visible: Overture, OpenFreeMap, OpenMapTiles, OpenStreetMap, MapLibre
- Overture buildings are not classified as industrial facilities; AOI shading remains a separate contextual fact

## Regression

- Automated tests: 72/72 passing
- Console errors: 0
- Console warnings on selected production stack: 0
- Seven-slide smoke: pass; canonical order observed
- Slide 04/05/06 lifecycle: pass (hidden → visible → hidden)
- Cached Slide 05 re-entry: pass; Overture remained loaded and became visible
- Keyboard navigation: pass (`ArrowRight` traversed all seven slides; `ArrowLeft` back navigation passed)
- Escape: pass; presentation closed and urban context returned to `off`
- Bus simulation: pass; marker position changed after the 30 Hz cap

## Review result

`VISUAL_STACK_HARDENING_V1_RESULT: REVISE`

Production promotion, fallback semantics, visual hierarchy, basemap selection, screenshots, lifecycle, console, and tests meet the review criteria. Revision is required only because 1920×1080 frame rate remained unstable and the last clean sample fell below 30 FPS. No Protomaps/PMTiles, residential context, hybrid filling, or broader engine work was started.

## Files

Changed:

- `README.md`
- `styles.css`
- `src/app.js`
- `src/industrial-infill.js`
- `src/overture-buildings.js`
- `src/presentation-content.js`
- `src/urban-context.js`
- `scripts/prepare-overture-buildings.py`
- `tests/overture-buildings-data.test.mjs`
- `tests/overture-buildings.test.mjs`
- `tests/presentation-content.test.mjs`

Added:

- `src/animation-timing.js`
- `src/basemap-style.js`
- `tests/animation-timing.test.mjs`
- `tests/basemap-style.test.mjs`
- `style-openfreemap-dark.json`
- `data/context/my-phuoc-1-buildings.meta.json`
- this report and four benchmark screenshots

Renamed:

- `data/overture-buildings-poc.geojson` → `data/context/my-phuoc-1-buildings.geojson`
