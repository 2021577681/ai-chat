"""Keep slide content within safe text-density limits."""


def _shorten(text, limit):
    text = str(text or "").strip()
    return text if len(text) <= limit else text[: max(0, limit - 1)].rstrip() + "…"


def _compress_items(items, max_items=5, text_limit=26):
    out = []
    for item in list(items or [])[:max_items]:
        if isinstance(item, dict):
            x = dict(item)
            for key in ("text", "title", "desc", "name", "method"):
                if key in x:
                    x[key] = _shorten(x[key], text_limit)
            out.append(x)
        else:
            out.append(_shorten(item, text_limit))
    return out


def compress_content(slides):
    """Return slides with conservative text lengths to reduce overflow risk."""
    out = []
    for slide in slides:
        item = dict(slide)
        item["title"] = _shorten(item.get("title"), 20)
        if "subtitle" in item:
            item["subtitle"] = _shorten(item.get("subtitle"), 36)
        for key in ("bullets", "items", "steps", "events", "cards", "layers", "groups", "stages", "quadrants"):
            if key in item:
                item[key] = _compress_items(item.get(key), 5, 30 if key == "cards" else 26)
        if isinstance(item.get("left"), dict):
            item["left"] = dict(item["left"])
            item["left"]["items"] = _compress_items(item["left"].get("items"), 5, 24)
        if isinstance(item.get("right"), dict):
            item["right"] = dict(item["right"])
            item["right"]["items"] = _compress_items(item["right"].get("items"), 5, 24)
        if "headers" in item:
            item["headers"] = [_shorten(x, 12) for x in list(item.get("headers") or [])[:6]]
        if "rows" in item:
            item["rows"] = [[_shorten(cell, 18) for cell in list(row)[:6]] for row in list(item.get("rows") or [])[:8]]
        out.append(item)
    return out
