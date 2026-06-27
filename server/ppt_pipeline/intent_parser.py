"""Parse a user request into normalized PPT generation intent."""

import re

from .schemas import DEFAULT_SLIDE_COUNT, DEFAULT_THEME_NAME


def _first_match(patterns, text, default=""):
    for pattern in patterns:
        m = re.search(pattern, text, flags=re.IGNORECASE)
        if m:
            return (m.group(1) or "").strip()
    return default


def parse_intent(user_request, options=None):
    """Return normalized intent from free text plus optional explicit fields."""
    options = options or {}
    text = str(user_request or options.get("request") or "").strip()

    slide_count = options.get("slide_count") or options.get("pages")
    if not slide_count:
        m = re.search(r"(\d{1,2})\s*(页|张|slides?|pages?)", text, flags=re.IGNORECASE)
        slide_count = int(m.group(1)) if m else DEFAULT_SLIDE_COUNT
    try:
        slide_count = max(3, min(30, int(slide_count)))
    except Exception:
        slide_count = DEFAULT_SLIDE_COUNT

    topic = options.get("topic") or _first_match([
        r"关于(.+?)(?:的|，|,|。|\s)*(?:PPT|演示|汇报|方案)",
        r"(?:生成|制作|做)(?:一个|一份)?(.+?)(?:PPT|演示|汇报|方案)",
        r"主题[:：]\s*(.+)",
    ], text)
    if not topic:
        topic = text[:40] or "未命名主题"
    topic = re.sub(r"^(一个|一份|的)\s*", "", topic).strip(" ：:，,。") or "未命名主题"

    purpose = options.get("purpose") or _first_match([
        r"用于(.+?)(?:，|,|。|$)",
        r"用途[:：]\s*(.+?)(?:，|,|。|$)",
    ], text, "汇报展示")
    audience = options.get("audience") or _first_match([
        r"给(.+?)(?:看|汇报|展示|，|,|。|$)",
        r"面向(.+?)(?:，|,|。|$)",
        r"受众[:：]\s*(.+?)(?:，|,|。|$)",
    ], text, "通用受众")

    style = options.get("style") or options.get("theme") or DEFAULT_THEME_NAME
    for keyword, theme in (("科技黑", "tech_dark"), ("极简", "minimal_white"), ("橙", "vivid_orange"), ("商务", "business_blue"), ("蓝", "business_blue")):
        if keyword in text:
            style = theme
            break

    return {
        "raw_request": text,
        "topic": topic,
        "title": options.get("title") or topic,
        "subtitle": options.get("subtitle") or purpose,
        "purpose": purpose,
        "audience": audience,
        "slide_count": slide_count,
        "style": style,
        "template_path": options.get("template_path") or options.get("template") or "",
        "filename": options.get("filename") or options.get("file_name") or "generated_pipeline.pptx",
        "path": options.get("path") or options.get("output_path") or "",
    }
