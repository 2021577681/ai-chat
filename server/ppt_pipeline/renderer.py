"""Render DeckSpec through the existing PptMixin implementation."""


def render_payload(deck_spec):
    """Convert a DeckSpec into the JSON payload accepted by handle_generate_ppt."""
    payload = {
        "title": deck_spec.get("title"),
        "subtitle": deck_spec.get("subtitle"),
        "filename": deck_spec.get("filename"),
        "style": deck_spec.get("style") or {},
        "slides": deck_spec.get("slides") or [],
    }
    for key in ("path", "template_path", "template_mode", "template_profile_path"):
        if deck_spec.get(key):
            payload[key] = deck_spec.get(key)
    return payload


def render_with_handler(handler, deck_spec):
    """Render a DeckSpec using a live HTTP handler instance."""
    return handler.handle_generate_ppt({"data": render_payload(deck_spec)})
