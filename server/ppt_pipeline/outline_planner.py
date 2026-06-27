"""Create a deck-level outline from parsed intent."""

from .llm_client import generate_json
from .schemas import normalize_layout


def plan_outline(intent, options=None):
    """Return slide outline items with title and communicative intent."""
    llm_outline = _plan_outline_with_llm(intent, options)
    if llm_outline:
        return llm_outline
    return _rule_based_outline(intent)


def _plan_outline_with_llm(intent, options=None):
    options = options or {}
    count = int(intent.get("slide_count") or 8)
    system_prompt = options.get("outline_prompt") or options.get("ppt_outline_prompt") or (
        "你是资深演示文稿策划专家。请根据用户需求规划 PPT 大纲。"
        "必须只输出 JSON 对象，不要输出解释。"
    )
    user_prompt = f"""
请为以下 PPT 需求生成贴合主题和受众的大纲。

需求：{intent.get('raw_request', '')}
主题：{intent.get('topic', '')}
用途：{intent.get('purpose', '')}
受众：{intent.get('audience', '')}
页数：{count}

输出 JSON 格式：
{{
  "slides": [
    {{"title": "页标题", "intent": "本页沟通目标", "content_type": "cover|agenda|three_cards|process|timeline|comparison|architecture|method_pipeline|table|chart|summary|bullets"}}
  ]
}}

要求：
1. slides 数量必须等于 {count}。
2. 第一页 content_type 必须是 cover。
3. 如果页数 >= 5，第二页建议是 agenda。
4. 最后一页必须是 summary。
5. 标题要具体，避免“背景/方案/总结”这类过泛标题。
6. content_type 要与页面内容匹配。
""".strip()
    data = generate_json(system_prompt, user_prompt, options=options)
    slides = data.get("slides") if isinstance(data, dict) else None
    return _normalize_outline(slides, intent, count)


def _normalize_outline(slides, intent, count):
    if not isinstance(slides, list):
        return None
    out = []
    for raw in slides:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "").strip()
        if not title:
            continue
        content_type = normalize_layout(raw.get("content_type") or raw.get("layout") or raw.get("type"))
        out.append({
            "title": title[:40],
            "intent": str(raw.get("intent") or raw.get("goal") or "").strip()[:120],
            "content_type": content_type,
        })

    if len(out) < max(3, count // 2):
        return None
    out = out[:count]
    if out:
        out[0]["content_type"] = "cover"
        out[0]["title"] = out[0].get("title") or intent.get("topic") or "封面"
    while len(out) < count:
        out.insert(-1 if out else 0, {"title": "关键内容", "intent": "补充核心信息", "content_type": "three_cards"})
    out[-1]["content_type"] = "summary"
    return out[:count]


def _rule_based_outline(intent):
    topic = intent.get("topic") or intent.get("title") or "主题"
    count = int(intent.get("slide_count") or 8)

    core = [
        ("项目背景", "说明为什么要关注该主题", "three_cards"),
        ("目标与价值", "说明希望达成的结果", "three_cards"),
        ("现状痛点", "归纳当前主要问题", "three_cards"),
        ("解决方案", "说明总体方案和关键抓手", "process"),
        ("整体架构", "说明系统或方案组成", "architecture"),
        ("实施路径", "说明推进节奏和里程碑", "timeline"),
        ("风险与应对", "说明主要风险和缓解措施", "comparison"),
        ("关键指标", "说明衡量效果的指标", "chart"),
        ("资源投入", "说明人力、时间和预算安排", "table"),
    ]

    slides = [{"title": topic, "intent": "建立主题和汇报语境", "content_type": "cover"}]
    if count >= 5:
        slides.append({"title": "目录", "intent": "展示汇报结构", "content_type": "agenda"})

    remaining = max(1, count - len(slides) - 1)
    for title, intent_text, content_type in core[:remaining]:
        slides.append({"title": title, "intent": intent_text, "content_type": content_type})

    slides.append({"title": "总结与下一步", "intent": "收束核心结论并给出行动建议", "content_type": "summary"})
    return slides[:count]
