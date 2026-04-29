from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path


PACKAGE_DIR = Path(__file__).resolve().parents[1]
PACKAGE_NAME = "tagcomplete_test"


def load_module(module_name: str, relative_path: str):
    module_path = PACKAGE_DIR / relative_path
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


package_module = types.ModuleType(PACKAGE_NAME)
package_module.__path__ = [str(PACKAGE_DIR / "py")]
sys.modules[PACKAGE_NAME] = package_module

load_module(f"{PACKAGE_NAME}.paths", "py/paths.py")
config_module = load_module(f"{PACKAGE_NAME}.config", "py/config.py")
frequency_module = load_module(f"{PACKAGE_NAME}.frequency_db", "py/frequency_db.py")


def test_normalize_config_keeps_defaults():
    config = config_module.normalize_config(
        {"enabled": False, "tagFile": "missing.csv", "tagEditorEnabled": True}
    )
    assert config["enabled"] is False
    assert config["tagFile"].endswith(".csv")
    assert isinstance(config["globalBlacklist"], list)
    assert "tagEditorEnabled" not in config
    choices = config_module.get_static_choices()
    assert "danbooru.zh_CN_SFW.csv" not in choices["tagFiles"]


def test_frequency_db_roundtrip(tmp_path: Path):
    db = frequency_module.FrequencyDb(tmp_path / "freq.sqlite3")
    db.increase("1girl", "tag", amount=2)
    db.increase("1girl", "tag", negative=True, amount=1)
    data = db.bulk_get([{"name": "1girl", "type": "tag"}], max_age_days=30)
    assert data["tag::1girl"]["count"] == 2
    data_neg = db.bulk_get([{"name": "1girl", "type": "tag"}], negative=True, max_age_days=30)
    assert data_neg["tag::1girl"]["count"] == 1
