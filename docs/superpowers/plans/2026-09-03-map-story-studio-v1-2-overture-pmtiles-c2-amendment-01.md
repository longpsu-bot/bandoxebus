# Map Story Studio V1.2 — Overture PMTiles C2 Plan Amendment 01

**Date:** 2026-09-03

**Applies to:** `docs/superpowers/plans/2026-09-03-map-story-studio-v1-2-overture-pmtiles-c2.md`

**Status:** Normative. This amendment is part of the implementation plan and overrides the conflicting lines identified below.

## Reason

Post-plan self-review found four implementation ambiguities that must not reach execution:

1. The approved design supports an identity-verified exact retained Overture `buildings.pmtiles` archive as fallback extraction input, while the first plan draft only wired the official remote archive.
2. The hosted content-addressed resolver existed as a utility but the default static Pages application had no bounded deployment-owned configuration hook to select it.
3. The PMTiles extracted-header bounds check was written too loosely even though pinned `go-pmtiles extract --bbox` writes the requested bbox into the output header to 1e-7 coordinate precision.
4. The base plan referred conditionally to a reference-validation test file even though the existing repository file is known: `tests/project-references.test.mjs`.

No approved architecture changes. No implementation is authorized outside the combined base plan + this amendment.

---

## A. Existing test file is exact

Every occurrence in the base plan of:

```text
the existing reference-validation test file
reference-validator.test.mjs if present
```

means exactly:

```text
tests/project-references.test.mjs
```

Task 1 must modify `tests/project-references.test.mjs`. `tests/data-binding-references.test.mjs` is changed only if a resolved-resource assertion genuinely belongs there; do not create `tests/reference-validator.test.mjs`.

Task 1 commit command must explicitly stage:

```bash
git add data/schemas/project-manifest-v1.schema.json src/project/project-schema.js src/project/reference-validator.js src/capabilities/urban-context-v1.js editor/editor.js tests/project-schema.test.mjs tests/project-references.test.mjs tests/capability-descriptors.test.mjs tests/editor-capability-authoring.test.mjs
```

Do not use broad `git add tests`.

---

## B. Task 7 supports the approved exact-retained-source fallback

### B.1 CLI syntax

The C2 V1 CLI accepts the required three options plus one optional **paired** local-source override:

```text
--project=PATH
--plan=PATH
--output=PATH
--source-archive=PATH        optional; local filesystem path only
--source-sha256=HEX64        required whenever --source-archive is present
```

Rules:

- With neither optional source argument, use the official trusted URL derived from `overtureRelease` exactly as described in the base plan.
- Supplying only one of `--source-archive` or `--source-sha256` is invalid.
- `--source-archive` must resolve to a regular local file. URL schemes, UNC/network URLs expressed as schemes, query strings, and fragments are not accepted by this option.
- `--source-sha256` must match `/^[0-9a-f]{64}$/`.
- Before invoking `pmtiles`, compute SHA-256 over the complete retained archive and require exact equality with `--source-sha256`.
- The retained archive is extraction input only. Its path and hash are not authored into `project.json` and do not become a new runtime source mode.
- `overtureRelease` still comes only from the validated project/Freeze plan. The local override cannot change release semantics.

### B.2 `freezeProject()` interface

Extend the base-plan interface to:

```js
freezeProject({
  projectDir,
  planPath,
  outputDir,
  sourceArchive = null,
  sourceSha256 = null,
  ...injected
})
```

`FrozenResult` additionally contains:

```js
sourceKind: 'official' | 'retained-local',
sourceArchiveSha256: null | string
```

This evidence is returned/logged and may be recorded in `C2.md`; it is not required in the frozen manifest snapshot object.

### B.3 RED tests to add in Task 7 Step 2

Add exact rejection/pass cases:

```text
--source-archive without --source-sha256 => reject before pmtiles call
--source-sha256 without --source-archive => reject before pmtiles call
local source hash mismatch => reject before pmtiles call
matching local source hash => pmtiles extract/show receives the local path, not the official URL
overtureRelease in frozen manifest remains the project/plan release
```

Use a small fake local archive in unit tests; do not hash a real global Overture archive in unit tests.

### B.4 Source metadata verification

For official mode:

```text
pmtiles show <trusted-official-url> --metadata
```

For retained-local mode:

```text
pmtiles show <verified-local-source-path> --metadata
```

Deep-compare that source metadata with the extracted snapshot metadata in both modes.

### B.5 CLI parsing Step 11 override

The CLI must accept exactly the five option names listed in B.1, with the last two optional only as a pair. Unknown or duplicate options still fail.

### B.6 Certification evidence

Task 9 `C2.md` must record:

```text
sourceKind
sourceArchiveSha256 when retained-local mode was used
```

The canonical Route 61-2 certification should use the official source while release `2026-08-19.0` remains available. The retained-local path is unit/integration-tested and may be exercised separately if an exact source archive is available.

---

## C. Hosted R2 resolver gets an explicit static-Pages deployment hook

The base plan correctly adds `src/project/hosted-asset-resolver.js`, but a static Pages deployment also needs a trusted, non-project configuration seam.

### C.1 Additional files in Task 8

Add:

- Modify: root `index.html`
- Modify: `src/runtime/generic-app.js`
- Modify: `tests/application-composition.test.mjs`

This is root production `index.html`, not `editor/index.html`.

### C.2 Deployment-owned metadata

Add exactly one optional meta element to root `index.html`:

```html
<meta name="map-story-pmtiles-origin" content="">
```

An empty value means no hosted PMTiles remapping is configured. This meta is application/deployment configuration, not authored project data and not exported in Folder/ZIP project packages.

Do not put an example R2 URL into the default source tree.

### C.3 Generic application default resolution

In `src/runtime/generic-app.js`, import `createContentAddressedPmtilesResolver` and add:

```js
export function resolveHostedPmtilesOrigin(documentRef = globalThis.document) {
  const value = documentRef?.querySelector?.('meta[name="map-story-pmtiles-origin"]')?.content?.trim() ?? '';
  return value || null;
}
```

Inside `createGenericApplicationOptions()`:

```js
const hostedPmtilesOrigin = resolveHostedPmtilesOrigin(documentRef);
const effectiveResolveAssetUrl = resolveAssetUrl
  ?? (hostedPmtilesOrigin
    ? createContentAddressedPmtilesResolver({ pmtilesOrigin: hostedPmtilesOrigin })
    : undefined);
```

Return `resolveAssetUrl: effectiveResolveAssetUrl`.

Rules:

- An explicitly supplied `resolveAssetUrl` transport always wins; this preserves Studio preview and certification injection.
- Empty meta leaves current identity/default loading behavior unchanged.
- Non-empty meta must be validated as absolute HTTPS by `createContentAddressedPmtilesResolver`; malformed deployment config fails loudly rather than falling back to Pages for a frozen PMTiles asset.
- The resolver still remaps only declared `pmtiles` assets; images and ordinary resources remain on Pages/package-relative URLs.

### C.4 RED/GREEN tests

Extend Task 8 tests with:

```text
empty meta => generic options do not install hosted resolver
HTTPS meta => generic options install content-addressed PMTiles resolver
explicit resolveAssetUrl overrides meta-derived resolver
HTTP/malformed meta => resolver construction rejects
non-PMTiles asset URL remains unchanged
```

`tests/application-composition.test.mjs` must continue proving Preview and normal output use the same `startApplication(createGenericApplicationOptions(...))` composition.

### C.5 Deployment gate

For the real Cloudflare Pages/R2 certification, the deployment owner must set the root meta `content` to the actual stable R2 custom-domain origin in the deployed Pages artifact. If this repository branch is the canonical Pages artifact and that R2 origin is stable/non-secret, commit that real origin as deployment configuration before claiming hosted PASS. If no R2 custom domain exists yet, leave the meta empty and classify the hosted gate `PENDING_EXTERNAL_ENDPOINT`.

No project manifest is rewritten with the R2 origin.

---

## D. Task 7 PMTiles header bounds check is exact

Replace the base-plan Step 6 wording:

```text
bounds that contain/intersect the requested final bounds according to the pinned extractor's bbox header semantics
```

with this exact requirement:

```text
The output PMTiles header minLon/minLat/maxLon/maxLat must equal plan.finalBounds component-wise within absolute tolerance 1e-7 degrees.
```

Reason: pinned `go-pmtiles v1.31.2` `extract --bbox` assigns the bbox bound directly to the PMTiles header using E7 integer coordinates. Do not accept a merely intersecting or larger header as equivalent.

Keep the other Step 6 requirements unchanged:

```text
tileType === 1 (MVT)
clustered === true
minZoom <= 11
maxZoom >= 14
source and extracted JSON metadata deep-equal
```

---

## E. Task 9 real hosted probe command has no fake URL

Do not use the `.example` command shown in the base plan.

The execution step is instead:

```bash
node scripts/r2-pmtiles-range-probe.mjs --url="$R2_PMTILES_URL"
```

`R2_PMTILES_URL` is an execution-time environment input supplied by the deployment owner and must be the actual public immutable object URL already uploaded under:

```text
projects/<project-id>/<snapshot-sha256>/overture-buildings.pmtiles
```

The script itself rejects an empty/non-HTTPS URL. The plan does not invent a URL.

---

## F. Plan self-review correction

Replace the final checklist item:

```text
C2 source-generation approach A is implemented; B remains compatible as an exact retained input path only if later wired explicitly; C is not implemented.
```

with:

```text
C2 source-generation approach A is the default; B is implemented as the paired, hash-verified local `--source-archive` fallback; C is not implemented.
```

With this amendment, every approved C2 source-generation path and hosting path has an executable, non-arbitrary boundary.
