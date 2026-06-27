"""Automatic DeckSpec adjustments based on validation results."""


def auto_fix(deck_spec, validation_report=None):
    """Return a lightly adjusted DeckSpec for common validation warnings.

    The first version keeps fixes conservative: switch to a robust Chinese font,
    reduce body font size, and ensure every non-cover slide has text content.
    """
    fixed = dict(deck_spec)
    style = dict(fixed.get("style") or {})
    style.setdefault("font_family", "Microsoft YaHei")
    style["body_font_size"] = min(int(style.get("body_font_size") or 16), 15)
    fixed["style"] = style

    slides = []
    for slide in fixed.get("slides") or []:
        item = dict(slide)
        if item.get("type") not in ("cover", "agenda") and not any(item.get(k) for k in ("bullets", "items", "cards", "steps", "events", "layers", "rows", "left", "right", "categories")):
            item["type"] = "bullets"
            item["bullets"] = ["补充核心观点", "明确执行动作", "跟踪关键指标"]
        slides.append(item)
    fixed["slides"] = slides
    return fixed


def should_auto_fix(validation_report):
    if not isinstance(validation_report, dict):
        return False
    return not validation_report.get("passed", False)
