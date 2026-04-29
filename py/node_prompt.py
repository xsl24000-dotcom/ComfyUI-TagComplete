from __future__ import annotations


class TagCompletePrompt:
    NAME = "TagComplete Prompt"
    CATEGORY = "utils/text"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("POSITIVE_TEXT", "NEGATIVE_TEXT")
    FUNCTION = "run"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive": (
                    "STRING",
                    {
                        "multiline": True,
                        "dynamicPrompts": True,
                        "tagcomplete": {"role": "positive"},
                    },
                ),
                "negative": (
                    "STRING",
                    {
                        "multiline": True,
                        "dynamicPrompts": True,
                        "tagcomplete": {"role": "negative"},
                    },
                ),
            }
        }

    def run(self, positive: str, negative: str):
        return (positive, negative)
