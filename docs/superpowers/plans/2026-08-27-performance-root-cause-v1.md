# Performance Root Cause V1 Implementation Plan

> **For agentic workers:** Execute inline in this session. Subagents and parallel agents are explicitly disabled by the task specification.

**Goal:** Reproduce, isolate, explain, and—only after confirmation—minimally correct unstable settled Slide 05 performance at 1920×1080.

**Architecture:** Keep the production stack intact. Add only temporary browser-side measurement/control hooks needed to toggle existing rendering components at the certified camera, then remove or retain only narrowly useful diagnostics. Any production fix follows a single confirmed hypothesis and a red-green regression test.

**Tech Stack:** Static ES modules, MapLibre GL JS, Three.js fallback, Node test runner, local static HTTP server, Chromium-family browser.

**Spec:** `C:/Users/HOME/.codex/attachments/e445ce1c-083b-41e1-ae70-6124997d70dc/pasted-text.txt`

## Global Constraints

- Do not redesign the application or begin Map Storytelling work.
- Do not remove required visual content or alter the accepted basemap/building decisions.
- No performance fix before a documented and minimally confirmed root cause.
- Primary certification: settled Slide 05 at 1920×1080, sustained at least 30 FPS.
- Measure camera transitions separately from settled scenes.
- One agent; no subagents; no parallel agents.

---

### Task 1: Map the production render lifecycle

**Files:**
- Read: `review/visual-stack-hardening-v1/REPORT.md`
- Read: `src/app.js`
- Read: `src/urban-context.js`
- Read: `src/overture-buildings.js`
- Read conditionally: `src/three-urban-layer.js`

- [ ] Identify Slide 05 camera, active layers, bus loop, repaint requests, timers, and cleanup behavior.
- [ ] Confirm whether Three.js is active on the production Overture path.

### Task 2: Establish diagnostic benchmark controls

**Files:**
- Modify only if needed: `src/app.js`
- Test only if retained production behavior is introduced: `tests/*.test.mjs`

- [ ] Expose or inject temporary toggles for states A–G without rewriting rendering.
- [ ] Record requestAnimationFrame frame times after warm-up for 15–20 seconds, three runs per practical state.
- [ ] Capture median/typical FPS, a meaningful sustained low, spikes, and stability.

### Task 3: Isolate lifecycle and transition behavior

- [ ] Compare fresh Slide 05 with the specified 05→06→05→04→05 sequence.
- [ ] Compare sources, layers, timers/RAF loops/listeners where observable.
- [ ] Measure before, during, and after the normal Slide 05 camera transition.
- [ ] Determine whether a frozen static scene continues repainting and trace the requester.

### Task 4: Prove one root-cause hypothesis

- [ ] Write `ROOT_CAUSE_HYPOTHESIS` from measured evidence.
- [ ] Change one variable only and rerun the smallest confirming benchmark.
- [ ] If disproved, discard the test change and form a new hypothesis.

### Task 5: Implement the bounded fix with TDD

**Files:**
- Test: exact target selected after root-cause proof.
- Modify: exact production file selected after root-cause proof.

- [ ] Write one failing regression test for the confirmed behavior and verify the expected failure.
- [ ] Implement the smallest production change that passes it.
- [ ] Run the targeted test and full `npm test` suite.

### Task 6: Certify and report

**Files:**
- Create: `review/performance-root-cause-v1/REPORT.md`

- [ ] Repeat settled 1920×1080 measurements and verify the hard floor.
- [ ] Verify 1366×768 as the control.
- [ ] Run seven-slide, lifecycle, cached re-entry, keyboard/Escape, reduced-motion, bus, POI, building, basemap, disclosure, attribution, console checks.
- [ ] Write the exact `PERFORMANCE_ROOT_CAUSE_V1` review-gate evidence and stop.
