# Map Story Studio V1.2 — Overture PMTiles C1 Plan Amendment 01

**Status:** Approved amendment

**Date:** 2026-09-02

**Applies to plan:** `docs/superpowers/plans/2026-09-02-map-story-studio-v1-2-overture-pmtiles-c1.md`

**Reason:** The canonical npm tarball `https://registry.npmjs.org/pmtiles/-/pmtiles-4.5.0.tgz` does not contain `package/LICENSE`. Task 1 correctly stopped rather than inventing a license source.

## Authoritative license source

Use the upstream PMTiles repository at exact commit:

```text
182d5b3cfdc2f5a6adbc54630c612da2f6086bdd
```

That exact repository state is authoritative for PMTiles JavaScript 4.5.0 because:

- `js/package.json` at that commit declares:

```json
{
  "name": "pmtiles",
  "version": "4.5.0",
  "license": "BSD-3-Clause"
}
```

- repository-root `LICENSE` at that same commit is the canonical BSD-3-Clause license text applying to the PMTiles reference implementations.

Pinned upstream license URL:

```text
https://raw.githubusercontent.com/protomaps/PMTiles/182d5b3cfdc2f5a6adbc54630c612da2f6086bdd/LICENSE
```

The npm tarball remains the authoritative source for the executable browser bundle. The upstream commit-pinned repository license is the authoritative source for the license text.

This split is intentional and does not change PMTiles version or implementation scope.

## Task 1 amendment

Replace the original Task 1 assumption that `package/LICENSE` exists with the following procedure.

### Browser bundle

Continue to use only the canonical npm artifact:

```text
https://registry.npmjs.org/pmtiles/-/pmtiles-4.5.0.tgz
```

The tarball SHA-256 already observed at the stop gate is:

```text
23ae7c575578ad24cd579377d69c46550631da219e6f179997ec2cf3b8c937e5
```

Re-download only if needed to continue; verify the downloaded tarball has this same SHA-256 before using it.

Extract only:

```text
package/dist/pmtiles.js
```

and vendor it as:

```text
vendor/pmtiles/4.5.0/pmtiles.js
```

Do not copy unrelated package files.

### License

Download the exact upstream license from:

```text
https://raw.githubusercontent.com/protomaps/PMTiles/182d5b3cfdc2f5a6adbc54630c612da2f6086bdd/LICENSE
```

Vendor the exact downloaded bytes as:

```text
vendor/pmtiles/4.5.0/LICENSE
```

Do not substitute a generated BSD-3-Clause template or license text copied from another package/version.

Compute and record the actual SHA-256 of the downloaded license file after download. Do not invent or pre-assume the SHA-256.

### Provenance record

`vendor/pmtiles/THIRD-PARTY.md` must record all of:

```text
Package: pmtiles
Version: 4.5.0
License: BSD-3-Clause
Executable artifact: https://registry.npmjs.org/pmtiles/-/pmtiles-4.5.0.tgz
Executable tarball SHA-256: 23ae7c575578ad24cd579377d69c46550631da219e6f179997ec2cf3b8c937e5
Browser file: vendor/pmtiles/4.5.0/pmtiles.js
Browser file SHA-256: <actual computed value>
License source repository: https://github.com/protomaps/PMTiles
License source commit: 182d5b3cfdc2f5a6adbc54630c612da2f6086bdd
License source path: LICENSE
License source URL: https://raw.githubusercontent.com/protomaps/PMTiles/182d5b3cfdc2f5a6adbc54630c612da2f6086bdd/LICENSE
License file: vendor/pmtiles/4.5.0/LICENSE
License file SHA-256: <actual computed value>
```

### Verification

Before completing Task 1, verify the vendored license contains the upstream PMTiles license preamble and BSD-3-Clause grant, and verify the browser bundle comes from the npm 4.5.0 tarball.

The focused vendor test should assert:

```js
assert.match(provenance, /Version:\s*4\.5\.0/);
assert.match(provenance, /License:\s*BSD-3-Clause/);
assert.match(provenance, /23ae7c575578ad24cd579377d69c46550631da219e6f179997ec2cf3b8c937e5/);
assert.match(provenance, /182d5b3cfdc2f5a6adbc54630c612da2f6086bdd/);
assert.match(license, /The below license \(BSD-3\) applies to the reference implementations/);
assert.match(license, /Redistribution and use in source and binary forms/);
```

Also preserve the existing no-CDN/local-vendor assertions.

## Stop behavior after amendment

The missing `package/LICENSE` condition is now resolved and is no longer a stop gate.

Stop instead if any of the following occur:

- the npm tarball SHA-256 differs from `23ae7c575578ad24cd579377d69c46550631da219e6f179997ec2cf3b8c937e5`;
- `package/dist/pmtiles.js` is missing from that tarball;
- the commit-pinned upstream `LICENSE` cannot be retrieved byte-for-byte;
- `js/package.json` at commit `182d5b3cfdc2f5a6adbc54630c612da2f6086bdd` no longer resolves to PMTiles `4.5.0` / `BSD-3-Clause` through the authoritative source being used;
- any other original C1 hard stop fires.

All other requirements, task ordering, migration gates, testing policy, and C1/C2 scope remain unchanged.
