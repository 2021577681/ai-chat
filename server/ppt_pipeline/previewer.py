"""Preview helpers for generated PPT files."""


def preview_with_handler(handler, ppt_path, rules=None):
    """Generate preview through the existing handler endpoint."""
    payload = {"path": ppt_path}
    if isinstance(rules, dict):
        payload["rules"] = rules
    return handler.handle_preview_ppt(payload)
