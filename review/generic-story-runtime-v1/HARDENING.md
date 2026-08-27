# Generic Story Runtime V1 — Contract Hardening

## Boundary

The generic Story V1 JSON Schema remains structural and project-agnostic. The dependency-free runtime validator resolves an injected action contract by action `type`; Route 61-2 owns its field, enum, type, bounds, and extra-property rules in `src/route-61-2-story-actions.js`.

The runtime rejects malformed action descriptors before action execution. It does not coerce boolean-like values.

## Coverage

The negative suite covers missing required fields, invalid supported values, wrong primitive types, typo and extra fields, malformed and out-of-bounds camera values, unsupported camera properties, and invalid reveal delays. The checked-in seven-state production story is also validated against the same project contracts.

The focused contract suite passes 13/13 tests. The complete repository suite passes 108/108 tests, up from the accepted 95/95 baseline.

## CI boundary

`.github/workflows/ci.yml` runs `npm test` on Node.js 24 for pull requests and pushes to `main`. The repository has no dependencies or lockfile, so CI performs no meaningless install step.

GitHub Actions certifies source/runtime/unit/config behavior. The existing targeted local browser gate continues to certify seven-state navigation, MapLibre/OpenFreeMap behavior, Overture context, buses, console health, and a short settled performance sanity sample.

The targeted local smoke traversed `intro → existing → adjustment-context → route-changes → service-area → connections → final-proposal`. The Overture dataset reported `loaded` with 1,299 buildings; industrial context was active only for `service-area`; two bus markers moved; and the browser console had no warnings or errors. A three-second settled sample measured 59.9 FPS typical and 60.0 FPS average with zero MapLibre renders, repaint requests, and source mutations.
