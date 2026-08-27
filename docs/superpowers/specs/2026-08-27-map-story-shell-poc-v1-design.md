# Map Story Shell POC V1 Design

## Purpose

Build a scroll-first, responsive story shell as a second consumer of Generic Story Runtime V1. The shell must keep one MapLibre instance persistent, use the existing Route 61-2 story JSON and content renderer unchanged, and preserve the existing Explore and legacy presentation experiences while the POC is reviewed.

The POC is available only when the URL contains `?storyShell=poc`. Without that parameter, the current application behaves exactly as it does on `main`.

## Architectural boundaries

The data flow remains:

```text
route-61-2.story.json
        -> Generic Story Runtime
        -> Map Story Shell
             -> existing structured content renderer
             -> existing Route 61-2 action adapter
             -> existing MapLibre instance
```

The shell treats state IDs, counts, order, content blocks, and map actions as opaque configuration. It does not contain Route 61-2 state names, a fixed state count, content copies, or map-action semantics. Generic Story Runtime V1 and Story Schema V1 remain unchanged.

The legacy presentation and POC shell share the same runtime instance, definition, action runner, metric bindings, structured renderer, and map. Only one shell is active at a time.

## Module design

### `src/story-shell.js`

This generic DOM controller owns the POC lifecycle. Its factory receives the runtime, content renderer callback, metrics, root elements, observer factory, document/window references, an interaction-policy callback, and an optional activation callback for application rendering/status updates.

On `enter()` it:

1. generates one semantic `<section>` per `runtime.definition.states` entry;
2. assigns `data-story-state-id` and `data-story-state-index`;
3. renders each section through the existing renderer;
4. installs one `IntersectionObserver` and one keyboard listener;
5. enables the guided-map interaction policy;
6. activates the initial state through `activateStoryState(0)`.

On `exit()` it disconnects the observer, removes listeners, restores normal map interactions, deactivates the runtime, hides the shell, and clears lifecycle-owned state. Repeated entry and exit is idempotent and cannot accumulate observers or handlers.

All navigation converges on `activateStoryState(index, options)`. That operation clamps the index, calls `runtime.goTo(index)`, updates active/current semantics and progress, and optionally scrolls the matching section into view. Observer callbacks never directly execute map actions. Keyboard and buttons call the same operation and request section scrolling.

Observer selection is discrete. Among intersecting sections, the shell chooses the most strongly visible candidate, with distance to the configured activation line as the deterministic tie-breaker. Only a changed selected index activates the runtime. There is no raw `scroll` listener, continuous scroll mathematics, scroll-progress animation, or per-frame shell work.

### `src/story-map-interactions.js`

This small generic policy records and restores the enabled state of MapLibre handlers. Guided mode disables `scrollZoom`, `dragPan`, `touchZoomRotate`, `boxZoom`, and `doubleClickZoom`, preventing wheel/touch gestures from capturing page navigation. Exit restores each handler to its prior enabled or disabled state rather than assuming defaults.

### `src/presentation.js`

The existing camera option builder gains a generic layout-padding input. The application calculates padding from the actual story card/map geometry: left-biased on wide layouts and bottom-biased on stacked mobile layouts. Configured `map.focus.camera` hints still override semantic camera defaults, but cannot define device-specific cameras. Existing legacy behavior remains the default when no shell layout padding is supplied.

### `src/app.js`

The application remains the composition root. It detects `?storyShell=poc`, binds either the POC launcher or the existing legacy presentation launcher, constructs the shell after the story runtime and MapLibre map exist, and supplies the existing renderer/action adapter.

The POC launch button enters the shell. `Khám phá bản đồ`, `Escape`, or the shell exit action returns to Explore, deactivates the story lifecycle, restores the normal comparison mode and map gestures, and fits the normal overview. No second map or application bootstrap is created.

The application rendering callback synchronizes state-dependent status and any shell-independent UI after every successful runtime activation. Delayed `route.reveal` work continues to be cancelled by the existing runtime exit/action-adapter lifecycle; rapid selection therefore leaves the newest state active.

### `index.html` and `styles.css`

The HTML adds one hidden POC shell containing a sticky map-stage overlay, a scroll-step container, restrained progress, Previous/Next buttons, and a visible Explore exit button. Generated steps are semantic sections; controls are real buttons.

On desktop, laptop, and projector widths the persistent map fills the viewport and story cards occupy a restrained left column over the map. Each step supplies enough vertical space for natural scroll activation without resizing or recreating the map.

On narrow or short viewports, the same DOM becomes a stacked composition: the map remains fixed in the upper portion and the active/readable card occupies the lower portion. CSS uses viewport/container dimensions and pointer capabilities, never user-agent detection. At 320 px there is no horizontal overflow and tap targets remain at least 44 CSS pixels.

Reduced-motion media queries remove content transition motion and smooth scrolling. Runtime/action-adapter reduced-motion behavior remains authoritative for camera and route reveal actions.

## Navigation and synchronization

The supported keys while the POC is active are:

- `ArrowRight`, `ArrowDown`, and `Space`: next state;
- `ArrowLeft` and `ArrowUp`: previous state;
- `Escape`: exit to Explore.

Keyboard handling ignores inputs, textareas, selects, buttons, links, and editable elements. Boundary navigation stays on the first or final state. Previous/Next controls use the same activation method, update scroll position, and remain disabled at boundaries.

Each activation marks exactly one section with `aria-current="step"` and the active CSS class. Progress is derived from `runtime.currentIndex + 1` and `runtime.definition.states.length`. Runtime state, progress, visible card, and scroll target are updated together.

Fast scrolling is latest-selection-wins. Intersection callbacks perform synchronous state selection and runtime activation; no shell timers or queued state transitions can later reactivate an older state. Existing action cancellation handles delayed project actions when a newer state exits the prior one.

## Accessibility

The story container has an accessible label, generated steps use `<section>`, the current step uses `aria-current`, and progress uses a restrained live status. Buttons have visible text or specific accessible labels. Focus is not forcibly moved on scroll activation; keyboard-triggered navigation scrolls the selected section without creating a focus trap. Essential content remains rendered text and never depends on hover.

## Performance model

MapLibre is created once during normal application bootstrap and remains mounted across Story and Explore modes. The shell performs DOM and runtime work only on discrete state changes. It never calls `setData`, `triggerRepaint`, or map actions directly and never attaches work to raw scroll progress.

Certification distinguishes state transitions from the settled state. At 1920×1080 and 1366×768, settled performance targets approximately 60 FPS with a hard minimum of 30 sustained FPS, no recurring source mutations, and no runaway MapLibre render loop. Mobile certification focuses on responsive swiping, prompt state activation, absence of long shell-induced stalls, and absence of runaway repainting.

## Testing strategy

Strict red-green-refactor applies to reusable behavior.

Pure/unit tests cover:

- 3-state and 5-state definitions generate 3 and 5 ordered steps;
- reordered fixtures render and navigate in configuration order;
- observer, keyboard, buttons, and programmatic navigation call the same runtime path;
- Arrow/Space mappings and editable-target exclusions;
- first/last boundaries;
- rapid A -> B -> C -> D selection leaves D active;
- active/current/progress/scroll synchronization;
- layout padding policy for wide and stacked layouts;
- story exit restores interaction state;
- repeated enter/exit does not duplicate observers, handlers, or interactions.

The full Node suite and source syntax checks remain required. Browser certification runs at 1920×1080, 1366×768, 390×844, and 320×568 using the same representative state plus a multi-state navigation sequence. It verifies layout, horizontal overflow, keyboard/controls, scrolling, MapLibre persistence, Explore restoration, console output, existing map features, reduced motion, settled render/source-mutation behavior, and observed FPS.

## Review artifacts

The implementation creates `review/map-story-shell-poc-v1/REPORT.md` and screenshots at all four required viewports. The report follows the requested `MAP_STORY_SHELL_POC_V1` template, records exact automated and browser evidence, lists files, and ends with `PASS`, `REVISE`, or `REJECT`. A passing result recommends exactly `PROMOTE_STORY_SHELL` unless the evidence demonstrates a significant UX problem, in which case it recommends `REVISE_STORY_SHELL`.

## Non-goals and invariants

This work does not change story content/order, schema, runtime semantics, the action adapter contract, the basemap, buildings, route data, comparison modes, bus simulation, or exploration features. It adds no editor, CMS, content block types, alternate story definitions, device-specific content/cameras, second map, bundler, Scrollama dependency, general feature-flag framework, or browser automation in CI.

The legacy presentation remains available throughout the POC and is not removed or promoted automatically.
