# ComfyUI-TagComplete

Independent TagComplete port for ComfyUI.

## Features

- Prompt autocomplete for normal tags, extra tags, translations, wildcards, embeddings, LoRAs, LyCORIS, hypernetworks, and chants
- Dedicated `TagComplete Prompt` node with positive and negative prompt inputs
- Frequency-based ranking and usage tracking
- Model keyword completion for LoRA and LyCORIS entries
- Local static tag files under `data/tags`

## Install

1. Copy this folder into `ComfyUI/custom_nodes/`
2. Restart ComfyUI
3. Open ComfyUI settings and search for `TagComplete`

## Files

- `web/tagcomplete.js`: frontend autocomplete logic
- `py/routes.py`: API routes
- `py/config.py`: config defaults and file selection
- `py/indexer.py`: dynamic model and wildcard indexing
- `data/tags/`: bundled tag and translation files

## Development

This package includes a small backend test file in `tests/test_tagcomplete_backend.py`.

