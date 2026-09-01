# Map Story Studio V1.2 — Canvas Manipulation Certification

## Certification identity

- Certified baseline: `f54c1a604551e4a6aacd80243e099715dc578f26`
- Executable feature commit: `976b24a`
- Branch: `feat/map-story-studio-v1-2-canvas-manipulation`
- Scope: professional single-object move and eight-direction resize in Select mode

## Design decisions

- Selection chrome is owned by the Scene authoring adapter and rendered as a sibling of semantic content. It never becomes Story content.
- Normalized Scene frames remain the only persisted geometry. Pixel measurements are transient inputs and feedback only.
- `resizeSceneFrame` is a pure exported geometry function covering `nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, and `w` from one directional model.
- Shift preserves the starting aspect ratio; Alt resizes around the starting center; Shift+Alt composes both behaviors.
- Bounds and the 24 px minimum rendered size are applied in the pure geometry layer.
- Snapping considers only moved edges, so an anchored edge cannot compete with the pointer. Scene bounds, Scene centers, and sibling edges/centers use the same 8 px tolerance.
- A 4 px pointer threshold separates click from move. Pointer capture owns an active gesture.
- Pointer-up emits exactly one normalized frame commit. Escape, `pointercancel`, lost capture, mode switch, and adapter destruction restore the exact starting frame and emit no commit.
- Studio selection is synchronized through a bounded `authoring-selection` preview command and restored silently across same-host preview refreshes.

## Preserved behavior

- Semantic block data, z-order, Story 1.2 persistence, runtime map behavior, crop, rotation, and multi-selection transforms are unchanged.
- Existing plaintext text editing, Escape cancellation, blur commit, and keyboard nudging remain in the established adapter path.
- Map mode removes authoring chrome and returning to Select mode does not invent a selection.

## Automated evidence

- Focused authoring/preview suite: 31/31 passing.
- Bounded regression suite: 80/80 passing.
- Rich-content compatibility regression: 11/11 passing.
- Full repository suite: 545/545 passing.
- Protected Story 1.2 schema and Route 61-2 story have no diff from the certified baseline.
- Route 61-2 SHA-256 remains `29597EE58773B13FF9DB6EAF3C328240F6BFA85F9BF7161CDCA7B20AD55B373A`.
- `git diff --check` passes and added lines contain no `innerHTML`, `eval`, or `new Function` usage.

## Browser QA

QA used the production Studio preview at 1440×900 and 1366×768.

- Selected image displays eight distinct, accessible directional handles with approximately 22 px hit targets.
- NW, N, W, and SE image resize paths were exercised; normalized frames remained bounded and z-order remained unchanged.
- Shift, Alt, and Shift+Alt behavior was verified against aspect-ratio and center invariants.
- Click, sub-threshold motion, normal drag, Scene-center snapping, and sibling-edge snapping were exercised.
- Escape rollback restored the exact starting frame without a commit; one undo restored a completed gesture in one step.
- Heading, paragraph, legend, metric, chart, table, and image content remained selectable; representative image, text, metric, chart, and table resize paths were exercised.
- Direct heading editing and Select → Map → Select chrome lifecycle remained functional.
- Compact viewport showed no Studio overflow and retained the handle hit targets.
- No new application-origin console errors were introduced. The test harness still reports its pre-existing detached `MutationObserver.observe` diagnostic, and MapLibre reports its pre-existing external `circle-11` sprite warning from unpkg.

## Screenshots

- `canvas-manipulation/01-image-selected-8-handles.png` — image selection and all eight handles
- `canvas-manipulation/02-image-nw-resize-feedback.png` — live NW resize and pixel size badge
- `canvas-manipulation/03-chart-selected.png` — representative rich-content selection
- `canvas-manipulation/04-compact-1366x768.png` — compact viewport verification

## Intentional exclusions

- No crop or rotation controls were added.
- No multi-selection transform behavior was added.
- No schema, semantic content model, Story fixture, runtime map, or z-order behavior was changed.
