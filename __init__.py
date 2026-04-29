"""
Independent TagComplete port for ComfyUI.
"""

try:
    from .py.config import load_config
    from .py.indexer import ensure_dynamic_index
    from .py.node_prompt import TagCompletePrompt
    from .py.paths import ensure_directories
    from .py import routes as _routes  # noqa: F401
except Exception:
    import importlib.util
    import sys
    import types
    from pathlib import Path

    PACKAGE_DIR = Path(__file__).resolve().parent
    COMFY_DIR = PACKAGE_DIR.parent.parent
    PACKAGE_NAME = "_tagcomplete_runtime"

    if str(COMFY_DIR) not in sys.path:
        sys.path.insert(0, str(COMFY_DIR))

    def _load(module_name: str, relative_path: str):
        spec = importlib.util.spec_from_file_location(module_name, PACKAGE_DIR / relative_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module

    pkg = types.ModuleType(PACKAGE_NAME)
    pkg.__path__ = [str(PACKAGE_DIR / "py")]
    sys.modules[PACKAGE_NAME] = pkg

    _load(f"{PACKAGE_NAME}.paths", "py/paths.py")
    _load(f"{PACKAGE_NAME}.config", "py/config.py")
    _load(f"{PACKAGE_NAME}.indexer", "py/indexer.py")
    _load(f"{PACKAGE_NAME}.node_prompt", "py/node_prompt.py")
    try:
        _load(f"{PACKAGE_NAME}.routes", "py/routes.py")
    except Exception:
        pass

    from _tagcomplete_runtime.config import load_config  # type: ignore
    from _tagcomplete_runtime.indexer import ensure_dynamic_index  # type: ignore
    from _tagcomplete_runtime.node_prompt import TagCompletePrompt  # type: ignore
    from _tagcomplete_runtime.paths import ensure_directories  # type: ignore

ensure_directories()
load_config()
ensure_dynamic_index()

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {
    TagCompletePrompt.NAME: TagCompletePrompt,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    TagCompletePrompt.NAME: "TagComplete Prompt",
}

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]
