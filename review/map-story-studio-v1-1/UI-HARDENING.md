# Map Story Studio V1.1 — UI hardening

This bounded pass makes the existing desktop authoring surface read as one visual product while preserving the established runtime, Story, persistence, capability, and output architecture.

## Revision

- Starting head: `8cdbc6de0f27c87945df4a2f3ce79f550ec07a9c`
- Ending implementation head: `500d94e4c9af01ad01f2b48068bb9833922bb242`
- Draft PR: #29

## Changes

- Simplified the top-level hierarchy into Project, history, global output, and Save actions.
- Separated the left panel into Layers, Insert, and Objects; layer selection is UI-only and visibility remains Scene-specific.
- Reused the production dataset descriptor inspector for selected-layer properties.
- Grouped Scene, Text, rich-object, Appearance, Camera, and Arrange properties and mapped stored enums to readable labels.
- Reworked Scenes into compact semantic cards with secondary ordering commands.
- Replaced the permanent Validation area with compact status and the existing diagnostics presented as Problems.
- Kept Preview Story and Present global; kept Select and Map local to the canvas.

Implementation and behavior files changed from the starting head:

- `editor/index.html`
- `editor/editor.css`
- `editor/editor.js`
- `editor/ui/studio-shell.js`
- `tests/editor-composition-helpers.test.mjs`
- `tests/editor-repair-integration.test.mjs`
- `tests/editor-rich-content-authoring.test.mjs`
- `tests/editor-shell-preview.test.mjs`
- `tests/editor-text-authoring.test.mjs`
- `tests/editor-validation.test.mjs`

## Visual review

Screenshots:

- `review/map-story-studio-v1-1/ui-hardening/view-a-scene-1440x900.png`
- `review/map-story-studio-v1-1/ui-hardening/view-b-text-1440x900.png`
- `review/map-story-studio-v1-1/ui-hardening/view-c-layer-1440x900.png`
- `review/map-story-studio-v1-1/ui-hardening/view-d-problems-1440x900.png`

Observed in real Chromium/Edge renders:

- 1440×900: one Preview Story and one Present action; Project menu closes after project creation; canvas is dominant; Scene strip and status remain fully visible; Text properties scroll internally; no page overflow.
- 1920×1080: center workspace expands to about 1416×898 while sidebars remain about 216/288 px; controls do not stretch; semantic Scene labels are fully visible.
- 1366×768: center workspace remains about 863×597; the 804 px Text inspector scrolls inside its 597 px panel; Scene strip and status stay accessible; no page overflow or collisions.
- Problems fixture: one production diagnostic opens the existing Problems drawer, reports `Unsaved · Invalid`, and visibly preserves revision 1 with previous-valid warnings.
- Branch-preview console: no warnings or errors.

Visual-review corrections made during the pass: constrained the desktop shell to the viewport so expanded inspectors cannot push Scenes/status off-screen; connected the Project menu close behavior to real markup; stacked Scene card ordinals above labels so “Recommendation” is not clipped.

## Verification

- Focused editor/UI command: 60/60 passed.
- Retained Scroll Story, Presentation, special-capability, and generic-shell command: 44/44 passed.
- `git diff --check origin/main...HEAD`: passed.
- No `innerHTML`, `eval(`, or `new Function` sink exists under `editor/`.
- `data/schemas/story-1.2.schema.json`: unchanged from base.
- `data/stories/route-61-2.story.json`: unchanged from base.
- Route Story SHA-256: `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`.
- No GUI-only schema or serialized selection, panel, menu, label, or output-mode state was added.

## Remaining

D4 settled performance recertification remains open. It was not started in this pass. Map Story Studio V1.1 is not declared finally locked or certified here.
