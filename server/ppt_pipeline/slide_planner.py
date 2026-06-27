"""Expand outline items into renderer-ready slide content."""

from .llm_client import generate_json
from .schemas import normalize_layout



def _cards(title):
    return [
        {"icon": "①", "title": "关键判断", "desc": f"围绕{title}形成清晰判断"},
        {"icon": "②", "title": "核心抓手", "desc": "聚焦高影响、可落地的动作"},
        {"icon": "③", "title": "预期收益", "desc": "用结果指标衡量推进成效"},
    ]


def _bullets(title):
    return [f"明确{title}的核心目标", "识别关键约束与依赖", "形成可执行的推进方案", "建立指标与复盘机制"]


def plan_slides(outline, intent, options=None):
    """Return slides with semantic content, before layout normalization."""
    llm_slides = _plan_slides_with_llm(outline, intent, options)
    if llm_slides:
        return llm_slides
    return _rule_based_slides(outline, intent)


def _plan_slides_with_llm(outline, intent, options=None):
    options = options or {}
    system_prompt = options.get("slide_prompt") or options.get("ppt_slide_prompt") or (
        "你是资深 PPT 内容策划专家。请把大纲扩展成可直接渲染的结构化页面内容。"
        "必须只输出 JSON 对象，不要输出解释。"
    )
    user_prompt = f"""
请根据 PPT 需求和大纲，为每一页生成自然、具体、可落地的页面内容。

需求：{intent.get('raw_request', '')}
主题：{intent.get('topic', '')}
用途：{intent.get('purpose', '')}
受众：{intent.get('audience', '')}
大纲：{outline}

输出 JSON 格式：
{{"slides": [页面对象...]}}

页面对象通用字段：title、intent、content_type。
按 content_type 输出对应字段：
- cover: subtitle
- agenda/summary: items，3-6 条
- three_cards: cards，每项含 title、desc，可含 icon
- process/method_pipeline: steps，每项含 title、desc
- timeline: events，每项含 time、title、desc
- comparison: left/right，各含 title、items
- architecture: layers，每项含 title、items
- chart: chart_type、categories、values
- table: headers、rows
- bullets: bullets

要求：
1. slides 数量必须与大纲一致。
2. 内容要贴合主题，不要使用泛化套话。
3. 每页信息密度适中，避免长句。
4. 输出字段必须是 renderer 可消费的 JSON。
""".strip()
    data = generate_json(system_prompt, user_prompt, options=options)
    slides = data.get("slides") if isinstance(data, dict) else None
    return _normalize_slides(slides, outline, intent)


def _normalize_slides(slides, outline, intent):
    if not isinstance(slides, list) or len(slides) < max(3, len(outline) // 2):
        return None
    out = []
    for idx, raw in enumerate(slides[:len(outline)]):
        if not isinstance(raw, dict):
            continue
        base = outline[idx] if idx < len(outline) else {}
        item = dict(raw)
        item["title"] = str(item.get("title") or base.get("title") or intent.get("topic") or "").strip()
        item["intent"] = str(item.get("intent") or base.get("intent") or "").strip()
        item["content_type"] = normalize_layout(item.get("content_type") or item.get("layout") or item.get("type") or base.get("content_type"))
        if not item["title"]:
            return None
        out.append(item)
    return out if len(out) == len(outline) else None


def _rule_based_slides(outline, intent):
    """Fallback planner used when no LLM is configured or LLM output is invalid."""
    topic = intent.get("topic") or intent.get("title") or "主题"
    slides = []
    agenda_items = [x.get("title") for x in outline if x.get("content_type") not in ("cover", "agenda")]

    for item in outline:
        title = item.get("title") or topic
        content_type = item.get("content_type") or "bullets"
        slide = {"title": title, "intent": item.get("intent", ""), "content_type": content_type}

        if content_type == "cover":
            slide.update({"type": "cover", "subtitle": intent.get("subtitle") or intent.get("purpose") or ""})
        elif content_type == "agenda":
            slide.update({"type": "agenda", "items": agenda_items[:8]})
        elif content_type == "three_cards":
            slide.update({"cards": _cards(title)})
        elif content_type == "process":
            slide.update({"steps": [
                {"title": "识别问题", "desc": "明确目标与约束"},
                {"title": "设计方案", "desc": "拆解模块与路径"},
                {"title": "试点验证", "desc": "小范围快速验证"},
                {"title": "规模推广", "desc": "沉淀机制并复制"},
            ]})
        elif content_type == "architecture":
            slide.update({"layers": [
                {"title": "数据层", "items": ["业务数据", "用户反馈", "外部资料"]},
                {"title": "能力层", "items": ["分析建模", "流程编排", "质量评估"]},
                {"title": "应用层", "items": ["管理看板", "执行工具", "决策支持"]},
            ]})
        elif content_type == "timeline":
            slide.update({"events": [
                {"time": "阶段1", "title": "调研规划", "desc": "明确需求和范围"},
                {"time": "阶段2", "title": "试点建设", "desc": "完成最小闭环"},
                {"time": "阶段3", "title": "上线推广", "desc": "扩大使用范围"},
                {"time": "阶段4", "title": "持续优化", "desc": "基于指标迭代"},
            ]})
        elif content_type == "comparison":
            slide.update({
                "left": {"title": "主要风险", "items": ["目标不清", "资源不足", "协同复杂"]},
                "right": {"title": "应对策略", "items": ["定义边界", "分阶段投入", "建立机制"]},
            })
        elif content_type == "chart":
            slide.update({"chart_type": "bar", "categories": ["效率", "质量", "成本", "体验"], "values": [80, 75, 60, 85]})
        elif content_type == "table":
            slide.update({"headers": ["资源", "投入", "说明"], "rows": [["人力", "3-5人", "产品、技术、运营协同"], ["周期", "8-12周", "分阶段交付"], ["预算", "按需评估", "优先保障关键能力"]]})
        elif content_type == "summary":
            slide.update({"items": [f"围绕{topic}形成统一目标", "先做最小闭环，再逐步扩展", "用指标驱动复盘和优化"]})
        else:
            slide.update({"bullets": _bullets(title)})

        slides.append(slide)
    return slides
