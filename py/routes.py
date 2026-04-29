from __future__ import annotations

from aiohttp import web
from server import PromptServer

from .config import config_payload, save_config
from .frequency_db import FREQUENCY_DB
from .indexer import (
    ensure_dynamic_index,
    get_dynamic_entries,
    get_wildcard_contents,
    load_model_keywords,
)
from .paths import static_file_path

routes = PromptServer.instance.routes


def _json_response(payload: dict, status: int = 200):
    return web.json_response(payload, status=status)


@routes.get("/tagcomplete/api/bootstrap")
async def tagcomplete_bootstrap(request):
    index = ensure_dynamic_index()
    payload = config_payload()
    payload["dynamicCounts"] = {
        key: len(index.get(key, []))
        for key in ("embeddings", "loras", "hypernetworks", "lycos", "wildcards", "chants")
    }
    payload["assetPrefix"] = "/tagcomplete/api/assets/"
    return _json_response(payload)


@routes.get("/tagcomplete/api/config")
async def tagcomplete_get_config(request):
    return _json_response(config_payload())


@routes.post("/tagcomplete/api/config")
async def tagcomplete_post_config(request):
    body = await request.json()
    config = save_config(body or {})
    ensure_dynamic_index(force=True)
    return _json_response({"config": config})


@routes.post("/tagcomplete/api/reindex")
async def tagcomplete_reindex(request):
    index = ensure_dynamic_index(force=True)
    return _json_response(
        {
            "status": "ok",
            "counts": {
                key: len(index.get(key, []))
                for key in ("embeddings", "loras", "hypernetworks", "lycos", "wildcards", "chants")
            },
        }
    )


@routes.get("/tagcomplete/api/dynamic/{kind}")
async def tagcomplete_dynamic(request):
    kind = request.match_info["kind"]
    if kind not in {"embeddings", "loras", "lycos", "hypernetworks", "wildcards", "chants"}:
        return _json_response({"error": f"Unsupported kind: {kind}"}, status=404)

    if kind == "chants":
        index = ensure_dynamic_index(force=True)
        return _json_response({"items": index.get("chants", [])})

    return _json_response({"items": get_dynamic_entries(kind)})


@routes.get("/tagcomplete/api/wildcard-contents")
async def tagcomplete_wildcard_contents(request):
    source_id = request.query.get("source_id", "")
    file_name = request.query.get("file", "")
    mode = request.query.get("mode", "txt")
    key_path = request.query.get("key_path")
    return _json_response(
        {
            "items": get_wildcard_contents(source_id, file_name, mode, key_path),
        }
    )


@routes.get("/tagcomplete/api/model-keywords")
async def tagcomplete_model_keywords(request):
    name = request.query.get("name")
    mapping = load_model_keywords()
    if name:
        return _json_response({"name": name, "keywords": mapping.get(name, "")})
    return _json_response({"items": mapping})


@routes.post("/tagcomplete/api/frequency/bulk")
async def tagcomplete_frequency_bulk(request):
    body = await request.json()
    items = body.get("items", [])
    negative = bool(body.get("negative", False))
    max_age = body.get("maxAgeDays")
    results = FREQUENCY_DB.bulk_get(items, negative=negative, max_age_days=max_age)
    return _json_response({"items": results})


@routes.post("/tagcomplete/api/frequency/increase")
async def tagcomplete_frequency_increase(request):
    body = await request.json()
    FREQUENCY_DB.increase(
        body.get("name", ""),
        body.get("type", "tag"),
        negative=bool(body.get("negative", False)),
        amount=int(body.get("amount", 1)),
    )
    return _json_response({"status": "ok"})


@routes.post("/tagcomplete/api/frequency/reset")
async def tagcomplete_frequency_reset(request):
    body = await request.json()
    FREQUENCY_DB.reset(
        body.get("name", ""),
        body.get("type", "tag"),
        reset_pos=bool(body.get("positive", True)),
        reset_neg=bool(body.get("negative", True)),
    )
    return _json_response({"status": "ok"})


@routes.get("/tagcomplete/api/preview")
async def tagcomplete_preview(request):
    kind = request.query.get("kind", "")
    name = request.query.get("name", "")
    if not kind or not name:
        return _json_response({"url": None})
    items = get_dynamic_entries(kind)
    match = next((item for item in items if item.get("name") == name and item.get("preview")), None)
    if not match:
        return _json_response({"url": None})
    return _json_response(
        {
            "url": f"/tagcomplete/api/preview/blob?kind={kind}&name={name}",
        }
    )


@routes.get("/tagcomplete/api/preview/blob")
async def tagcomplete_preview_blob(request):
    kind = request.query.get("kind", "")
    name = request.query.get("name", "")
    items = get_dynamic_entries(kind)
    match = next((item for item in items if item.get("name") == name and item.get("preview")), None)
    if not match:
        return web.Response(status=204)
    return web.FileResponse(match["preview"])


@routes.get(r"/tagcomplete/api/assets/{filename:.*}")
async def tagcomplete_assets(request):
    filename = request.match_info["filename"]
    try:
        path = static_file_path(filename)
    except ValueError:
        return web.Response(status=404)
    if not path.exists() or not path.is_file():
        return web.Response(status=404)
    return web.FileResponse(path)
