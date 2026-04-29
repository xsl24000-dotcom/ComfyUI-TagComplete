from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
import re

from .paths import CONFIG_PATH, STATIC_TAGS_DIR, ensure_directories


DEFAULT_CONFIG = {
    "enabled": True,
    "globalHook": True,
    "tagFile": "danbooru.csv",
    "translationFile": "danbooru.zh_CN_SFW.csv",
    "extraFile": "extra-quality-tags.csv",
    "chantFile": "demo-chants.json",
    "searchByAlias": True,
    "onlyShowAlias": False,
    "replaceUnderscores": True,
    "escapeParentheses": True,
    "maxResults": 20,
    "showAllResults": False,
    "delayTime": 80,
    "resultStepLength": 50,
    "wcWrap": "__",
    "useTranslations": True,
    "useWildcards": True,
    "useEmbeddings": True,
    "useLoras": True,
    "useHypernetworks": True,
    "useLycos": True,
    "useChants": True,
    "extraNetworksDefaultMultiplier": 1.0,
    "frequencySort": True,
    "frequencyFunction": "Logarithmic (weak)",
    "frequencyMinCount": 3,
    "frequencyMaxAge": 30,
    "frequencyRecommendCap": 10,
    "modelKeywordCompletion": True,
    "modelKeywordLocation": "Start of prompt",
    "globalBlacklist": [
        "MathExpression.expression",
    ],
}


def _list_files(*suffixes: str) -> list[str]:
    items = []
    for path in sorted(STATIC_TAGS_DIR.glob("*")):
        if not path.is_file():
            continue
        if suffixes and path.suffix.lower() not in suffixes:
            continue
        if path.name.startswith("."):
            continue
        items.append(path.name)
    return items


def _is_translation_like(name: str) -> bool:
    lower = name.lower()
    return (
        ".zh_" in lower
        or ".zh-" in lower
        or "translate" in lower
        or "_translated" in lower
        or "translation" in lower
        or lower.endswith(".cn.csv")
        or lower.endswith(".zh.csv")
        or lower.endswith(".translation.csv")
        or lower.endswith(".translations.csv")
    )


def _looks_like_non_tag_file(path: Path) -> bool:
    lower = path.name.lower()
    if _is_translation_like(lower):
        return True
    if "dictionary" in lower:
        return False
    try:
        sample_lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()[:20]
    except Exception:
        return False
    if not sample_lines:
        return False

    cjk_first_column = 0
    numeric_first_column = 0
    checked = 0
    for line in sample_lines:
        line = line.strip()
        if not line:
            continue
        first = line.split(",", 1)[0].strip().strip('"')
        if not first:
            continue
        checked += 1
        if first.isdigit():
            numeric_first_column += 1
        if re.search(r"[\u3400-\u9FFF\uF900-\uFAFF]", first):
            cjk_first_column += 1
    if checked == 0:
        return False
    if cjk_first_column / checked >= 0.5:
        return True
    if numeric_first_column / checked >= 0.8 and "translated" in lower:
        return True
    return False


def get_static_choices() -> dict[str, list[str]]:
    csv_files = _list_files(".csv")
    tag_files = [
        name for name in csv_files
        if not _looks_like_non_tag_file(STATIC_TAGS_DIR / name)
    ]
    json_files = _list_files(".json")
    return {
        "tagFiles": tag_files,
        "translationFiles": ["None", *csv_files],
        "extraFiles": ["None", *csv_files],
        "chantFiles": ["None", *json_files],
    }


def _resolve_choice(value: str | None, choices: list[str], fallback: str) -> str:
    if value in choices:
        return value
    if fallback in choices:
        return fallback
    return choices[0]


def normalize_config(config: dict | None) -> dict:
    ensure_directories()
    normalized = deepcopy(DEFAULT_CONFIG)
    if isinstance(config, dict):
        for key in DEFAULT_CONFIG:
            if key in config:
                normalized[key] = config[key]

    choices = get_static_choices()
    normalized["tagFile"] = _resolve_choice(
        normalized.get("tagFile"),
        choices["tagFiles"],
        DEFAULT_CONFIG["tagFile"],
    )
    normalized["translationFile"] = _resolve_choice(
        normalized.get("translationFile"),
        choices["translationFiles"],
        DEFAULT_CONFIG["translationFile"],
    )
    normalized["extraFile"] = _resolve_choice(
        normalized.get("extraFile"),
        choices["extraFiles"],
        DEFAULT_CONFIG["extraFile"],
    )
    normalized["chantFile"] = _resolve_choice(
        normalized.get("chantFile"),
        choices["chantFiles"],
        DEFAULT_CONFIG["chantFile"],
    )
    normalized["globalBlacklist"] = sorted(set(normalized.get("globalBlacklist") or []))
    return normalized


def load_config() -> dict:
    ensure_directories()
    if not CONFIG_PATH.exists():
        config = normalize_config({})
        save_config(config)
        return config

    try:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        config = {}

    config = normalize_config(config)
    save_config(config)
    return config


def save_config(config: dict) -> dict:
    normalized = normalize_config(config)
    CONFIG_PATH.write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return normalized


def config_payload() -> dict:
    config = load_config()
    return {
        "config": config,
        "choices": get_static_choices(),
    }
