#!/usr/bin/env python3
"""Update Obsidian release metadata in manifest.json and versions.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable, Tuple


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Update manifest.json version/minAppVersion and maintain versions.json "
            "with Obsidian-compatible rules."
        )
    )
    parser.add_argument("--manifest", type=Path, required=True, help="Path to manifest.json")
    parser.add_argument("--versions", type=Path, required=True, help="Path to versions.json")
    parser.add_argument("--version", required=True, help="Plugin release version (x.y.z)")
    parser.add_argument(
        "--min-app-version",
        help="Optional minAppVersion override. If omitted, keep manifest value.",
    )
    parser.add_argument(
        "--record-every-release",
        action="store_true",
        help=(
            "Always add an entry for --version in versions.json. "
            "By default, an entry is added only if minAppVersion changed "
            "compared with the highest recorded version."
        ),
    )
    return parser.parse_args()


def load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def parse_semver_core(version: str) -> Tuple[int, ...] | None:
    core = version.split("-", maxsplit=1)[0]
    parts = core.split(".")
    if not parts:
        return None
    values = []
    for part in parts:
        if not part.isdigit():
            return None
        values.append(int(part))
    return tuple(values)


def version_sort_key(version: str) -> Tuple[int, Tuple[int, ...], str]:
    parsed = parse_semver_core(version)
    if parsed is None:
        return (1, (0,), version)
    return (0, parsed, version)


def latest_recorded_version(versions: Iterable[str]) -> str | None:
    ordered = sorted(versions, key=version_sort_key)
    return ordered[-1] if ordered else None


def ordered_versions(versions: Dict[str, str]) -> Dict[str, str]:
    return {k: versions[k] for k in sorted(versions, key=version_sort_key)}


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    manifest = load_json(args.manifest)
    versions = load_json(args.versions)

    for key in ("version", "minAppVersion"):
        if key not in manifest:
            raise KeyError(f"Missing required field in {args.manifest}: {key}")

    manifest["version"] = args.version
    if args.min_app_version:
        manifest["minAppVersion"] = args.min_app_version
    min_app_version = str(manifest["minAppVersion"])

    previous_latest_key = latest_recorded_version(versions.keys())
    previous_latest_min = versions.get(previous_latest_key, None) if previous_latest_key else None

    should_record = (
        args.record_every_release
        or str(args.version) in versions
        or previous_latest_key is None
        or previous_latest_min != min_app_version
    )

    if should_record:
        versions[str(args.version)] = min_app_version
        versions = ordered_versions({str(k): str(v) for k, v in versions.items()})
        record_note = "added/updated"
    else:
        record_note = "skipped (minAppVersion unchanged from latest recorded version)"

    write_json(args.manifest, manifest)
    write_json(args.versions, {str(k): str(v) for k, v in versions.items()})

    print(f"manifest.version -> {manifest['version']}")
    print(f"manifest.minAppVersion -> {manifest['minAppVersion']}")
    print(f"versions.json entry for {args.version}: {record_note}")


if __name__ == "__main__":
    main()
