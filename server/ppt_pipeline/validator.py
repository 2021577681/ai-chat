"""Validation helpers for generated DeckSpec/PPT output."""


def default_validation_rules(deck_spec):
    slides = deck_spec.get("slides") or []
    expected = [deck_spec.get("title") or ""]
    for slide in slides[:3]:
        title = slide.get("title")
        if title:
            expected.append(title)
    return {
        "min_slides": max(1, len(slides)),
        "expected_text": [x for x in expected if x],
        "require_chinese": any("\u4e00" <= ch <= "\u9fff" for ch in "\n".join(expected)),
        "max_question_marks": 0,
        "fail_on_warnings": False,
        "auto_repair_min_font_size": 10,
        "auto_repair_allow_font_shrink": False,
        "auto_repair_font_shrink_after_passes": 3,
        "detect_graphic_overlaps": True,
    }


def validate_with_handler(handler, ppt_path, deck_spec, rules=None):
    """Validate a generated pptx through PptMixin internals."""
    merged = default_validation_rules(deck_spec)
    if isinstance(rules, dict):
        merged.update(rules)
    return handler._validate_pptx_file(ppt_path, merged)
