# Story Shell Promotion V1

- Date: 2026-08-27
- Base main SHA: `5c29a6597dc1c6c59824caae383d6b686addfa57`
- Branch: `feat/promote-story-shell-v1`

## Routing

- `/`: Story Shell launcher; application initially remains in Explore.
- `/?storyShell=poc`: Story Shell compatibility alias.
- `/?storyShell=legacy`: legacy presentation launcher.
- Missing, unrelated, and unknown query values: Story Shell.
- Story auto-entry during bootstrap: no.

## Browser smoke

- Normal URL at 1920×1080: initial Explore, launcher entry, scroll/state progression, Previous/Next, Escape exit, and Story re-entry pass.
- Mobile at 390×844: initial Explore, Story entry, vertical gesture progressed state 1 → 2, and horizontal overflow was absent.
- Legacy fallback: legacy presentation selected, opened, and closed; Story Shell remained hidden.
- Compatibility alias: Story Shell opened normally.
- Browser console: clean for normal desktop, normal mobile, legacy, and compatibility runs.

## Verification

- Baseline tests: 137/137.
- Final tests: 138/138.
- Source syntax: 22/22.
- `git diff --check`: pass.
- MapLibre instances: 1.
- Story JSON, Story Schema V1, Generic Story Runtime V1, action runner, and Route 61-2 action contracts: unchanged from base.
- Story content duplication: none.

## Performance sanity

- URL: `/`.
- Viewport: 1920×1080.
- State: `service-area`, settled with Overture loaded and camera stopped.
- Duration: 4.001 seconds.
- FPS: 59.9 typical, 59.5 sustained-low, 60.0 average.
- MapLibre renders: 0.
- `triggerRepaint()` calls: 0.
- GeoJSON `setData()` mutations: 0.
- MapLibre instances: 1.
- Console: clean.

## GitHub

- Implementation commit: `0a91c68`.
- Draft PR: [#3](https://github.com/longpsu-bot/bandoxebus/pull/3).
- PR head at certification: `e89ff8af826739721d0b37dfeeb47577baa46120`.
- GitHub Actions: PASS.
- GitHub Actions run: [33060659759](https://github.com/longpsu-bot/bandoxebus/actions/runs/33060659759).

The immutable final PR head and its CI URL will also be recorded in the PR because a tracked report cannot contain the SHA of its own commit.

## Decision

`PROMOTE_STORY_SHELL_V1_RESULT: PASS`

Next recommended gate: `ROUTE_61_2_BENCHMARK_CERTIFICATION_V1`.
