from __future__ import annotations

import os
from pathlib import Path

import folder_paths

PACKAGE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = PACKAGE_DIR / "data"
STATIC_TAGS_DIR = DATA_DIR / "tags"

SYSTEM_DIR = Path(folder_paths.get_system_user_directory("tagcomplete"))
CACHE_DIR = SYSTEM_DIR / "cache"
MODEL_KEYWORD_DIR = SYSTEM_DIR / "model_keywords"
CONFIG_PATH = SYSTEM_DIR / "config.json"
INDEX_PATH = CACHE_DIR / "dynamic_index.json"
FREQUENCY_DB_PATH = SYSTEM_DIR / "frequency.sqlite3"

BASE_DIR = Path(folder_paths.models_dir).resolve().parent
CUSTOM_NODES_DIR = BASE_DIR / "custom_nodes"
MODELS_DIR = Path(folder_paths.models_dir)

PREVIEW_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
MODEL_EXTENSIONS = tuple(sorted(folder_paths.supported_pt_extensions))


def ensure_directories() -> None:
    for path in (SYSTEM_DIR, CACHE_DIR, MODEL_KEYWORD_DIR, STATIC_TAGS_DIR):
        path.mkdir(parents=True, exist_ok=True)


def static_file_path(name: str) -> Path:
    path = (STATIC_TAGS_DIR / name).resolve()
    if os.path.commonpath([str(STATIC_TAGS_DIR.resolve()), str(path)]) != str(STATIC_TAGS_DIR.resolve()):
        raise ValueError(f"Path escapes static directory: {name}")
    return path
