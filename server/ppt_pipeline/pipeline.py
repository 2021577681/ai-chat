"""End-to-end orchestration for the PPT generation pipeline."""

from .auto_fixer import auto_fix
from .content_compressor import compress_content
from .intent_parser import parse_intent
from .layout_selector import select_layouts
from .outline_planner import plan_outline
from .renderer import render_payload
from .reflow import enforce_layout_constraints
from .slide_planner import plan_slides
from .theme_resolver import resolve_theme
from .validator import default_validation_rules


def build_deck_spec(user_request, options=None):
    """Build a renderer-ready DeckSpec without writing files."""
    options = options or {}
    intent = parse_intent(user_request, options)
    outline = plan_outline(intent, options)
    slides = plan_slides(outline, intent, options)
    slides = select_layouts(slides)
    slides = compress_content(slides)
    slides, layout_report = enforce_layout_constraints(slides, options)
    theme = resolve_theme(intent, options)

    deck = {
        "title": intent.get("title"),
        "subtitle": intent.get("subtitle"),
        "purpose": intent.get("purpose"),
        "audience": intent.get("audience"),
        "filename": intent.get("filename"),
        "path": intent.get("path"),
        "style": theme.get("style") or {},
        "template_path": theme.get("template_path") or "",
        "template_mode": theme.get("template_mode") or "style",
        "template_profile_path": theme.get("template_profile_path") or "",
        "slides": slides,
        "pipeline": {
            "intent": intent,
            "outline": outline,
            "layout_report": layout_report,
            "validation_rules": default_validation_rules({"title": intent.get("title"), "slides": slides}),
        },
    }
    return deck


def run_pipeline(user_request, options=None, render=False, handler=None):
    """Build DeckSpec and optionally render through an existing handler.

    The return shape is intentionally plain JSON so it can be exposed later as a
    tool or reused by tests/CLI.
    """
    deck = build_deck_spec(user_request, options)
    result = {"ok": True, "deck": deck, "payload": render_payload(deck)}
    if render:
        if handler is None:
            raise ValueError("handler is required when render=True")
        handler.handle_generate_ppt({"data": result["payload"]})
    return result


__all__ = ["build_deck_spec", "run_pipeline", "auto_fix"]
