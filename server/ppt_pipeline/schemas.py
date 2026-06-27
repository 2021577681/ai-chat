"""Shared schemas and defaults for the PPT generation pipeline."""

from copy import deepcopy

DEFAULT_SLIDE_COUNT = 8
DEFAULT_THEME_NAME = "business_blue"

THEMES = {
    "business_blue": {
        "font_family": "Microsoft YaHei",
        "primary_color": "#2563eb",
        "accent_color": "#f97316",
        "background_color": "#f8fafc",
        "color": "#0f172a",
        "muted_color": "#64748b",
        "title_font_size": 30,
        "body_font_size": 16,
    },
    "tech_dark": {
        "font_family": "Microsoft YaHei",
        "primary_color": "#38bdf8",
        "accent_color": "#a78bfa",
        "background_color": "#020617",
        "color": "#f8fafc",
        "muted_color": "#94a3b8",
        "title_font_size": 30,
        "body_font_size": 16,
    },
    "minimal_white": {
        "font_family": "Microsoft YaHei",
        "primary_color": "#111827",
        "accent_color": "#6b7280",
        "background_color": "#ffffff",
        "color": "#111827",
        "muted_color": "#6b7280",
        "title_font_size": 30,
        "body_font_size": 16,
    },
    "vivid_orange": {
        "font_family": "Microsoft YaHei",
        "primary_color": "#f97316",
        "accent_color": "#0ea5e9",
        "background_color": "#fff7ed",
        "color": "#1f2937",
        "muted_color": "#78716c",
        "title_font_size": 30,
        "body_font_size": 16,
    },
}

LAYOUT_ALIASES = {
    "cards": "three_cards",
    "flow": "process",
    "workflow": "process",
    "compare": "comparison",
    "vs": "comparison",
    "columns": "two_column",
    "quadrant": "matrix",
    "system_architecture": "architecture",
    "research_pipeline": "method_pipeline",
    "bar_chart": "chart",
    "line_chart": "chart",
}

SUPPORTED_LAYOUTS = {
    "cover", "agenda", "bullets", "section", "summary", "three_cards",
    "process", "timeline", "comparison", "two_column", "matrix", "pyramid",
    "cycle", "funnel", "quote", "architecture", "method_pipeline",
    "table", "chart", "experiment_design", "ablation",
}


def theme_by_name(name):
    """Return a copy of an internal theme by name."""
    key = (name or DEFAULT_THEME_NAME).strip().lower().replace("-", "_")
    aliases = {
        "商务蓝": "business_blue",
        "business": "business_blue",
        "blue": "business_blue",
        "科技黑": "tech_dark",
        "dark": "tech_dark",
        "极简白": "minimal_white",
        "minimal": "minimal_white",
        "white": "minimal_white",
        "活力橙": "vivid_orange",
        "orange": "vivid_orange",
    }
    key = aliases.get(key, key)
    return deepcopy(THEMES.get(key, THEMES[DEFAULT_THEME_NAME]))


def normalize_layout(layout):
    key = (layout or "bullets").strip().lower().replace("-", "_")
    key = LAYOUT_ALIASES.get(key, key)
    return key if key in SUPPORTED_LAYOUTS else "bullets"
