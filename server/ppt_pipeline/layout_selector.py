"""Choose native PPT layouts for planned slides."""

from .schemas import normalize_layout


KEYWORD_LAYOUTS = [
    (("架构", "系统", "分层", "模块"), "architecture"),
    (("流程", "步骤", "路径", "方案"), "process"),
    (("计划", "时间", "阶段", "里程碑", "实施"), "timeline"),
    (("对比", "差异", "风险", "应对"), "comparison"),
    (("指标", "数据", "结果", "趋势"), "chart"),
    (("资源", "预算", "清单", "明细"), "table"),
    (("总结", "下一步", "结论"), "summary"),
]


def choose_layout(slide):
    explicit = slide.get("type") or slide.get("layout") or slide.get("content_type")
    normalized = normalize_layout(explicit)
    if normalized != "bullets" or explicit in ("bullets", "cover", "agenda"):
        return normalized

    text = f"{slide.get('title', '')} {slide.get('intent', '')}"
    for keywords, layout in KEYWORD_LAYOUTS:
        if any(k in text for k in keywords):
            return layout
    if slide.get("cards"):
        return "three_cards"
    if slide.get("steps"):
        return "process"
    if slide.get("events"):
        return "timeline"
    return "three_cards"


def select_layouts(slides):
    out = []
    for slide in slides:
        item = dict(slide)
        item["type"] = choose_layout(item)
        item["layout"] = item["type"]
        out.append(item)
    return out
