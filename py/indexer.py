from __future__ import annotations

import csv
import json
import os
from pathlib import Path

import folder_paths

from .config import load_config
from .paths import (
    BASE_DIR,
    CACHE_DIR,
    CUSTOM_NODES_DIR,
    INDEX_PATH,
    MODEL_EXTENSIONS,
    MODEL_KEYWORD_DIR,
    PREVIEW_EXTENSIONS,
    STATIC_TAGS_DIR,
    ensure_directories,
)

try:
    import yaml
except Exception:  # pragma: no cover
    yaml = None


def _sort_key(filename: str, full_path: str) -> str:
    try:
        return str(Path(full_path).stat().st_mtime)
    except Exception:
        return filename.lower()


def _make_model_entries(folder_name: str) -> list[dict]:
    entries = []
    try:
        names = folder_paths.get_filename_list(folder_name)
    except Exception:
        return entries

    for name in names:
        full_path = folder_paths.get_full_path(folder_name, name)
        if not full_path:
            continue
        display_name = Path(name).stem
        entries.append(
            {
                "name": display_name,
                "filename": name,
                "path": full_path,
                "sort_key": _sort_key(name, full_path),
                "preview": _find_preview(full_path),
            }
        )
    return entries


def _find_preview(model_path: str | Path | None) -> str | None:
    if not model_path:
        return None
    path = Path(model_path)
    stem = path.with_suffix("")
    for ext in PREVIEW_EXTENSIONS:
        preview = Path(f"{stem}{ext}")
        if preview.exists():
            return str(preview)
    return None


def _scan_lycos() -> list[dict]:
    candidates = [
        BASE_DIR / "models" / "lycoris",
        BASE_DIR / "models" / "lycos",
        BASE_DIR / "models" / "lycoris_models",
    ]
    entries = []
    for base in candidates:
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in MODEL_EXTENSIONS:
                continue
            entries.append(
                {
                    "name": path.stem,
                    "filename": str(path.relative_to(base)).replace("\\", "/"),
                    "path": str(path),
                    "sort_key": _sort_key(path.name, str(path)),
                    "preview": _find_preview(path),
                }
            )
    deduped = {}
    for item in entries:
        deduped[item["name"]] = item
    return list(deduped.values())


def _wildcard_sources() -> list[Path]:
    sources = []
    for candidate in (BASE_DIR / "wildcards", BASE_DIR / "scripts" / "wildcards"):
        if candidate.exists():
            sources.append(candidate)

    if CUSTOM_NODES_DIR.exists():
        for path in CUSTOM_NODES_DIR.rglob("wildcards"):
            if path.is_dir():
                sources.append(path)
    unique = []
    seen = set()
    for path in sources:
        normalized = str(path.resolve())
        if normalized not in seen:
            seen.add(normalized)
            unique.append(path)
    return unique


def _flatten_yaml_branch(node, prefix=""):
    results = {}
    if isinstance(node, dict):
        for key, value in node.items():
            new_prefix = f"{prefix}/{key}" if prefix else key
            results.update(_flatten_yaml_branch(value, new_prefix))
    elif isinstance(node, list) and all(isinstance(item, str) for item in node):
        results[prefix] = node
    return results


def _scan_wildcards() -> tuple[list[dict], dict[str, str], dict[str, dict]]:
    entries = []
    source_map = {}
    yaml_cache: dict[str, dict] = {}
    for index, source in enumerate(_wildcard_sources(), start=1):
        source_id = f"wc{index}"
        source_map[source_id] = str(source)

        for txt_path in sorted(source.rglob("*.txt")):
            if txt_path.name.lower() == "put wildcards here.txt":
                continue
            rel = txt_path.relative_to(source).with_suffix("")
            entries.append(
                {
                    "name": rel.as_posix(),
                    "source_id": source_id,
                    "mode": "txt",
                    "file": txt_path.relative_to(source).as_posix(),
                    "preview": None,
                }
            )

        if yaml is None:
            continue

        for yaml_path in sorted(list(source.rglob("*.yaml")) + list(source.rglob("*.yml"))):
            try:
                loaded = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not loaded:
                continue
            flattened = _flatten_yaml_branch(loaded)
            if not flattened:
                continue
            cache_key = f"{source_id}:{yaml_path.relative_to(source).as_posix()}"
            yaml_cache[cache_key] = flattened
            file_prefix = yaml_path.relative_to(source).with_suffix("").as_posix()
            for key in flattened:
                entries.append(
                    {
                        "name": f"{file_prefix}/{key}" if key else file_prefix,
                        "source_id": source_id,
                        "mode": "yaml",
                        "file": yaml_path.relative_to(source).as_posix(),
                        "key_path": key,
                        "preview": None,
                    }
                )
    return entries, source_map, yaml_cache


def _load_chants_file(name: str | None) -> list[dict]:
    if not name or name == "None":
        return []
    path = STATIC_TAGS_DIR / name
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return [item for item in data if isinstance(item, dict) and item.get("content")]


def _parse_keyword_csv(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    mapping = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        for row in reader:
            if not row:
                continue
            row = [col.strip() for col in row]
            if not row[0] or row[0].startswith("#"):
                continue
            if len(row) >= 3:
                name = Path(row[2]).stem or row[0]
                mapping[name] = row[1].replace("| ", ", ").replace("|", ", ")
            elif len(row) >= 2:
                mapping[Path(row[0]).stem] = row[1]
            else:
                mapping[Path(row[0]).stem] = row[0]
    return mapping


def load_model_keywords() -> dict[str, str]:
    mapping = {}
    for name in ("lora-keyword.txt", "lora-keyword-user.txt"):
        mapping.update(_parse_keyword_csv(MODEL_KEYWORD_DIR / name))
    return mapping


def build_dynamic_index() -> dict:
    ensure_directories()
    wildcards, wildcard_sources, yaml_cache = _scan_wildcards()
    config = load_config()
    index = {
        "built_at": int(Path.cwd().stat().st_mtime) if Path.cwd().exists() else 0,
        "embeddings": _make_model_entries("embeddings"),
        "loras": _make_model_entries("loras"),
        "hypernetworks": _make_model_entries("hypernetworks"),
        "lycos": _scan_lycos(),
        "wildcards": wildcards,
        "wildcard_sources": wildcard_sources,
        "wildcard_yaml": yaml_cache,
        "chants": _load_chants_file(config.get("chantFile")),
        "model_keywords": load_model_keywords(),
    }
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    return index


def ensure_dynamic_index(force: bool = False) -> dict:
    ensure_directories()
    if force or not INDEX_PATH.exists():
        return build_dynamic_index()
    try:
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except Exception:
        return build_dynamic_index()


def get_dynamic_entries(kind: str) -> list[dict]:
    index = ensure_dynamic_index()
    return list(index.get(kind, []))


def get_wildcard_contents(source_id: str, file_name: str, mode: str, key_path: str | None = None) -> list[str]:
    index = ensure_dynamic_index()
    base = index.get("wildcard_sources", {}).get(source_id)
    if not base:
        return []

    if mode == "txt":
        path = (Path(base) / file_name).resolve()
        try:
            if os.path.commonpath([base, str(path)]) != base:
                return []
        except Exception:
            return []
        if not path.exists():
            return []
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        return [line.strip() for line in lines if line.strip() and not line.strip().startswith("#")]

    cache_key = f"{source_id}:{file_name}"
    values = index.get("wildcard_yaml", {}).get(cache_key, {})
    return list(values.get(key_path or "", []))
