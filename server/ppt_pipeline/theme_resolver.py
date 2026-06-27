"""Resolve theme/template settings for the deck spec."""

from .schemas import theme_by_name


def resolve_theme(intent, options=None):
    """Return style dict and template metadata for rendering."""
    options = options or {}
    theme = theme_by_name(intent.get("style") or options.get("style") or options.get("theme"))

    explicit_theme = options.get("theme") if isinstance(options.get("theme"), dict) else {}
    explicit_style = options.get("style") if isinstance(options.get("style"), dict) else {}
    theme.update(explicit_theme)
    theme.update(explicit_style)

    return {
        "style": theme,
        "template_path": intent.get("template_path") or options.get("template_path") or options.get("template") or "",
        "template_mode": options.get("template_mode") or "style",
        "template_profile_path": options.get("template_profile_path") or "",
    }
