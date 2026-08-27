"""Prepare the production Route 61-2 Overture Buildings context dataset."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform, unary_union

OVERTURE_RELEASE = "2026-08-19.0"
OVERTUREMAPS_VERSION = "0.20.0"
EXPECTED_AOI_BBOX = (106.5877666, 11.1174356, 106.6037689, 11.1414241)
AOI_FEATURE_ID = "osm-industrial-759187612"
HEIGHT_POLICY_VERSION = "route61-2-overture-height-v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--aoi", type=Path, default=Path("data/industrial-zone-poc.geojson"))
    parser.add_argument("--output", type=Path, default=Path("data/context/my-phuoc-1-buildings.geojson"))
    parser.add_argument("--metadata-output", type=Path)
    parser.add_argument("--raw-input", type=Path, help="Reuse a previously downloaded Overture GeoJSON file.")
    return parser.parse_args()


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def repository_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def derived_bbox(aoi_geometry) -> tuple[float, float, float, float]:
    bbox = tuple(aoi_geometry.bounds)
    if any(abs(actual - expected) > 1e-7 for actual, expected in zip(bbox, EXPECTED_AOI_BBOX)):
        raise ValueError(f"AOI-derived bbox {bbox} differs from certified bbox {EXPECTED_AOI_BBOX}")
    return bbox


def download_raw(bbox: tuple[float, float, float, float], output: Path) -> None:
    try:
        from overturemaps.cli import GeoJSONWriter, copy
        from overturemaps.core import record_batch_reader
    except ImportError as error:
        raise RuntimeError("Install scripts/requirements-overture.txt before downloading.") from error

    reader = record_batch_reader("building", list(bbox), OVERTURE_RELEASE, None, None, True)
    if reader is None:
        raise RuntimeError("Overture returned no record reader for the certified AOI.")
    writer = GeoJSONWriter(str(output))
    try:
        copy(reader, writer)
    finally:
        writer.close()


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def positive_number(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def derive_height(properties: dict, area_m2: float, thresholds: dict[str, float]) -> tuple[float, float, str]:
    source_height = positive_number(properties.get("height"))
    min_height = positive_number(properties.get("min_height")) or 0
    if source_height and source_height <= 300 and min_height < source_height:
        return source_height, min_height, "source-height"
    floors = positive_number(properties.get("num_floors"))
    if floors and floors <= 80:
        height = round(floors * 3.5, 1)
        return height, min_height if min_height < height else 0, "floors-derived"
    if area_m2 <= thresholds["smallMaxM2"]:
        height = 6.5
    elif area_m2 <= thresholds["mediumMaxM2"]:
        height = 8.5
    elif area_m2 <= thresholds["largeMaxM2"]:
        height = 11
    else:
        height = 14
    return height, 0, "illustrative-height"


def main() -> None:
    args = parse_args()
    aoi_collection = load_json(args.aoi)
    if len(aoi_collection.get("features", [])) != 1:
        raise ValueError("Industrial AOI must contain exactly one feature.")
    aoi_feature = aoi_collection["features"][0]
    if aoi_feature.get("id") != AOI_FEATURE_ID:
        raise ValueError(f"Unexpected AOI feature id: {aoi_feature.get('id')}")
    aoi_wgs84 = shape(aoi_feature["geometry"])
    if aoi_wgs84.geom_type != "Polygon" or not aoi_wgs84.is_valid:
        raise ValueError("Industrial AOI must be one valid Polygon.")
    bbox = derived_bbox(aoi_wgs84)

    temporary_path = None
    raw_path = args.raw_input
    if raw_path is None:
        temporary_path = tempfile.NamedTemporaryFile(suffix=".geojson", delete=False)
        temporary_path.close()
        raw_path = Path(temporary_path.name)
        download_raw(bbox, raw_path)

    raw_collection = load_json(raw_path)
    to_metric = Transformer.from_crs("EPSG:4326", "EPSG:32648", always_xy=True).transform
    aoi_metric = transform(to_metric, aoi_wgs84)
    selected = []
    rejected = {"malformed": 0, "degenerate": 0, "underground": 0, "outsideAoi": 0}

    for feature in raw_collection.get("features", []):
        properties = feature.get("properties") or {}
        if properties.get("is_underground") is True:
            rejected["underground"] += 1
            continue
        try:
            footprint_wgs84 = shape(feature.get("geometry"))
        except Exception:
            rejected["malformed"] += 1
            continue
        if footprint_wgs84.geom_type not in {"Polygon", "MultiPolygon"} or not footprint_wgs84.is_valid:
            rejected["malformed"] += 1
            continue
        footprint_metric = transform(to_metric, footprint_wgs84)
        if footprint_metric.area <= 1:
            rejected["degenerate"] += 1
            continue
        intersection = footprint_metric.intersection(aoi_metric)
        if intersection.is_empty or intersection.area <= 0:
            rejected["outsideAoi"] += 1
            continue
        selected.append((feature, footprint_metric.area, intersection))

    if not selected:
        raise RuntimeError("No valid Overture buildings intersect the industrial AOI.")

    footprint_areas = [area for _, area, _ in selected]
    thresholds = {
        "smallMaxM2": round(percentile(footprint_areas, 0.25), 2),
        "mediumMaxM2": round(percentile(footprint_areas, 0.60), 2),
        "largeMaxM2": round(percentile(footprint_areas, 0.85), 2),
    }
    height_counts = {"source-height": 0, "floors-derived": 0, "illustrative-height": 0}
    geometry_counts: dict[str, int] = {}
    output_features = []
    for feature, footprint_area, intersection in selected:
        original = feature.get("properties") or {}
        height, min_height, height_source = derive_height(original, footprint_area, thresholds)
        height_counts[height_source] += 1
        geometry_type = feature["geometry"]["type"]
        geometry_counts[geometry_type] = geometry_counts.get(geometry_type, 0) + 1
        output_features.append({
            "type": "Feature",
            "id": original.get("id") or feature.get("id"),
            "properties": {
                **original,
                "render_height_m": height,
                "render_min_height_m": min_height,
                "height_source": height_source,
                "footprint_area_m2": round(footprint_area, 2),
                "aoi_intersection_area_m2": round(intersection.area, 2),
            },
            # Selection uses the AOI intersection, but rendering retains the complete source geometry.
            "geometry": feature["geometry"],
        })

    covered_area = unary_union([intersection for _, _, intersection in selected]).area
    count = len(output_features)
    statistics = {
        "featureCount": count,
        "aoiAreaM2": round(aoi_metric.area, 2),
        "aoiCoveredAreaM2": round(covered_area, 2),
        "aoiCoverageRatio": round(covered_area / aoi_metric.area, 6),
        "heightSourceCounts": height_counts,
        "heightSourcePercentages": {key: round(value / count * 100, 2) for key, value in height_counts.items()},
        "geometryTypeCounts": geometry_counts,
        "footprintAreaM2": {
            "min": round(min(footprint_areas), 2),
            "median": round(percentile(footprint_areas, 0.5), 2),
            "max": round(max(footprint_areas), 2),
        },
        "rejected": rejected,
    }
    generated_at = datetime.now(timezone.utc).isoformat()
    output = {
        "type": "FeatureCollection",
        "name": "Route 61-2 Overture Buildings — My Phuoc 1",
        "metadata": {
            "provider": "Overture Maps Foundation",
            "overtureRelease": OVERTURE_RELEASE,
            "overturemapsPackageVersion": OVERTUREMAPS_VERSION,
            "acquiredAtUtc": generated_at,
            "sourceType": "building",
            "crs": "EPSG:4326",
            "aoiFeatureId": AOI_FEATURE_ID,
            "aoiAuthoritative": True,
            "derivedBbox": list(bbox),
            "selectionRule": "building intersects AOI; complete source footprint retained",
            "coverageRule": "area(union(building intersection AOI)) / area(AOI)",
            "heightRule": "source height; else num_floors × 3.5 m; else deterministic footprint-area quantile class",
            "illustrativeHeightThresholdsM2": thresholds,
            "statistics": statistics,
        },
        "features": output_features,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False, separators=(",", ":"))
    provenance_counts: dict[str, int] = {}
    for feature in output_features:
        datasets = {source.get("dataset") for source in feature["properties"].get("sources", []) if source.get("dataset")}
        for dataset in datasets:
            provenance_counts[dataset] = provenance_counts.get(dataset, 0) + 1
    metadata_path = args.metadata_output or args.output.with_suffix(".meta.json")
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    reproducibility = {
        "schemaVersion": 1,
        "generatedAtUtc": generated_at,
        "dataset": {
            "path": repository_path(args.output),
            "sha256": sha256(args.output),
            "featureCount": count,
            "bytes": args.output.stat().st_size,
        },
        "overture": {
            "theme": "buildings",
            "type": "building",
            "release": OVERTURE_RELEASE,
            "package": "overturemaps",
            "packageVersion": OVERTUREMAPS_VERSION,
        },
        "aoi": {
            "authoritativePath": repository_path(args.aoi),
            "sha256": sha256(args.aoi),
            "featureId": AOI_FEATURE_ID,
            "industrialPolygonAuthoritative": True,
            "derivedBbox": list(bbox),
        },
        "statistics": statistics,
        "heightDerivation": {
            "policyVersion": HEIGHT_POLICY_VERSION,
            "policy": output["metadata"]["heightRule"],
            "illustrativeThresholdsM2": thresholds,
        },
        "provenance": {"featureCounts": dict(sorted(provenance_counts.items()))},
        "preprocessing": {
            "script": "scripts/prepare-overture-buildings.py",
            "scriptSha256": sha256(Path(__file__)),
            "heightPolicyVersion": HEIGHT_POLICY_VERSION,
            "selectionRule": output["metadata"]["selectionRule"],
            "coverageRule": output["metadata"]["coverageRule"],
        },
    }
    with metadata_path.open("w", encoding="utf-8") as handle:
        json.dump(reproducibility, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps(output["metadata"], ensure_ascii=False, indent=2))
    print(f"outputBytes: {args.output.stat().st_size}")
    print(f"metadata: {metadata_path}")

    if temporary_path is not None:
        raw_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
