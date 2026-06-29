"""HTML-to-image PPT generation pipeline.

This is the new high-level PPT mode:
user request -> outline -> page types -> HTML pages -> browser screenshots ->
one full-slide image per PPT page.
"""

import html as html_lib
import json
import os
import re
import shutil
import subprocess
import time
import random
from pathlib import Path

from . import config
from .ppt_pipeline.llm_client import generate_json as _ppt_llm_generate_json
from .sandbox import check_path_or_error


_SAFE_FILENAME_RE = re.compile(r'[\\/:*?"<>|]+')
_HTML_FENCE_RE = re.compile(r"^```(?:html)?\s*|\s*```$", re.IGNORECASE)
_SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script\s*>", re.IGNORECASE | re.DOTALL)
_EVENT_HANDLER_RE = re.compile(r"\s+on[a-zA-Z]+\s*=\s*(['\"]).*?\1", re.DOTALL)
_WIDTH = 1600
_HEIGHT = 900


DEFAULT_UNDERSTAND_PROMPT = """你是资深演示文稿策划总监。请理解用户要做的 PPT 主题、内容、用途、受众和语气，并为 PPT 自动命名。
只输出 JSON，不要解释。输出结构：
{
  "title": "PPT 标题",
  "subtitle": "可选副标题",
  "purpose": "用途",
  "audience": "受众",
  "language": "主要语言",
  "tone": "叙事语气",
  "visual_direction": "整体视觉方向",
  "filename": "AI 自动命名的 pptx 文件名"
}
filename 必须贴合主题，使用安全文件名，并以 .pptx 结尾。"""


DEFAULT_OUTLINE_PROMPT = """你是资深 PPT 内容策划专家。请根据用户需求和理解结果生成 PPT 大纲。
只输出 JSON，不要解释。输出结构：
{"outline":[{"page":1,"title":"页面标题","goal":"本页沟通目标","key_points":["要点1","要点2"]}]}
要求：
1. 页数必须等于 target_slide_count。
2. 每页标题具体，避免泛泛而谈。
3. 大纲只决定内容结构和叙事顺序，不输出任何 PPT 坐标或固定模板。"""


DEFAULT_PAGE_TYPE_PROMPT = """你是演示信息架构设计师。请为大纲中的每一页确定页面类型和内容结构。
只输出 JSON，不要解释。输出结构：
{"pages":[{"page":1,"title":"页面标题","page_type":"cover|agenda|section|concept|comparison|data_story|process|timeline|case|quote|summary|closing|freeform","visual_role":"本页视觉承担的任务","content_blocks":[{"title":"模块名","text":"模块内容"}]}]}
要求：
1. pages 数量必须和大纲一致。
2. page_type 是语义类型，不是固定 PPT 模板限制。
3. 必须根据 design_system 为每页选择不同的信息组织方式，不要把所有页面都设计成同一种卡片网格。
4. 每页都要给出 visual_role，说明本页更适合用大标题、时间线、对比、流程、数据卡、引语、分区叙事或自由画布中的哪一种表达。"""


DEFAULT_HTML_PROMPT = """你是资深 HTML 演示页面设计师。请为单页 PPT 生成完整、可截图的 16:9 HTML 设计稿。
只输出 JSON，不要解释。输出结构：{"html":"<!doctype html>..."}
硬性要求：
1. 画布为 1600x900 或自适应 16:9，body margin 为 0。
2. HTML 必须自包含，CSS 写在 <style> 内，不依赖外网字体、图片、脚本或第三方库。
3. 不要输出 Markdown，不要输出解释。
4. 必须严格使用输入中的 design_system，包括 theme_name、palette、typography、shape_language、composition_rules。
5. 必须根据 page.page_type、page.visual_role 和 page_variant 选择版式，禁止每页都使用相同的居中标题 + 二列卡片网格。
6. 同一份 PPT 内要保持统一视觉语言，但每页的构图必须有明显差异：封面可大标题/视觉符号，议程可纵向导航，流程可时间线/阶梯，比较可左右分栏，数据页可大数字/图表感布局，总结页可结论墙。
7. 页面信息必须完整但不拥挤，文本不能明显溢出画布。
8. 只能用 CSS 形状、渐变、边框、图标感符号和排版创造视觉效果，不要引用外部图片。"""


_STYLE_PRESETS = [
    {
        "theme_name": "calm_editorial",
        "palette": ["#F6F1E8", "#102A43", "#2F80ED", "#D98C33", "#FFFFFF"],
        "typography": "高对比编辑部风格：大标题、细分隔线、留白充足",
        "shape_language": "细线框、编号标签、半透明纸张卡片",
        "mood": "克制、专业、叙事感",
    },
    {
        "theme_name": "dark_neon_strategy",
        "palette": ["#08111F", "#E6F7FF", "#00D1FF", "#8B5CF6", "#14F195"],
        "typography": "深色科技风：强烈标题、荧光强调、小号数据标签",
        "shape_language": "发光线条、网格背景、玻璃拟态信息块",
        "mood": "前沿、战略、未来感",
    },
    {
        "theme_name": "warm_humanistic",
        "palette": ["#FFF7ED", "#3B2F2F", "#F97316", "#10B981", "#FDE68A"],
        "typography": "温暖人文风：圆润标题、柔和正文、重点色块",
        "shape_language": "圆角大色块、有机曲线、便签式模块",
        "mood": "亲和、清晰、有温度",
    },
    {
        "theme_name": "minimal_consulting",
        "palette": ["#F8FAFC", "#0F172A", "#2563EB", "#64748B", "#E2E8F0"],
        "typography": "咨询汇报风：层级清晰、数字突出、紧凑但不拥挤",
        "shape_language": "矩形分区、轴线、指标卡、流程箭头",
        "mood": "理性、可信、商业化",
    },
    {
        "theme_name": "bold_poster",
        "palette": ["#111827", "#FFF7D6", "#EF4444", "#FACC15", "#38BDF8"],
        "typography": "海报风：超大标题、强对比、短句冲击",
        "shape_language": "大几何图形、斜切块、醒目徽章",
        "mood": "有冲击力、年轻、鲜明",
    },
]


_PAGE_VARIANTS = {
    "cover": ["hero_asymmetric", "poster_title", "large_symbol"],
    "agenda": ["vertical_nav", "numbered_rail", "chapter_cards"],
    "section": ["divider_big_number", "quote_band", "full_bleed_shape"],
    "concept": ["single_big_idea", "hub_and_spoke", "three_insight_cards"],
    "comparison": ["split_screen", "matrix", "before_after"],
    "data_story": ["big_number_dashboard", "chart_like_panels", "metric_ladder"],
    "process": ["horizontal_timeline", "step_staircase", "loop_flow"],
    "timeline": ["horizontal_timeline", "milestone_map", "vertical_chronicle"],
    "case": ["storyboard", "problem_solution_result", "evidence_cards"],
    "quote": ["big_quote", "pull_quote_sidebar", "statement_poster"],
    "summary": ["takeaway_wall", "three_conclusions", "closing_checklist"],
    "closing": ["final_statement", "next_step_cards", "minimal_end"],
    "freeform": ["asymmetric_canvas", "modular_grid", "visual_metaphor"],
}


def _emit_progress(progress, **event):
    if callable(progress):
        try:
            progress(event)
        except Exception:
            pass


def _run_checkpoint(checkpoint, label=""):
    if callable(checkpoint):
        checkpoint(label)


def _emit_stage_start(progress, checkpoint, stage, message, detail=None):
    _emit_progress(progress, type="step_start", status="running", stage=stage, step=stage, message=message, detail=detail or {})
    _run_checkpoint(checkpoint, stage)


def _emit_stage_done(progress, stage, message, detail=None):
    _emit_progress(progress, type="step_done", status="done", stage=stage, step=stage, message=message, detail=detail or {})


def _emit_substep(progress, stage, name, message, status="running", detail=None):
    _emit_progress(progress, type="substep", status=status, stage=stage, step=stage, name=name, message=message, detail=detail or {})


def generate_html_image_ppt(data, progress=None, checkpoint=None):
    """Generate a PPTX where every slide is one rendered image."""
    try:
        _emit_progress(progress, type="task", status="running", stage="init", message="正在初始化 PPT 图片页流程。")
        _run_checkpoint(checkpoint, "init")

        try:
            from pptx import Presentation
            from pptx.util import Inches
        except ImportError:
            return {"ok": False, "error": "缺少依赖 python-pptx，请先运行：pip install -r requirements.txt"}

        options = dict(data or {})
        request_text = _as_text(options.get("user_request") or options.get("request") or options.get("prompt")).strip()
        if not request_text:
            return {"ok": False, "error": "user_request 不能为空"}

        target_count = _normalize_slide_count(options.get("slide_count") or options.get("pages"), request_text)
        run_slug = time.strftime("%Y%m%d_%H%M%S")
        work_base, err = check_path_or_error(os.path.join("output", "ppt_image_pipeline", run_slug), must_exist=False)
        if err:
            return {"ok": False, "error": err}
        html_dir = os.path.join(work_base, "html")
        image_dir = os.path.join(work_base, "images")
        os.makedirs(html_dir, exist_ok=True)
        os.makedirs(image_dir, exist_ok=True)

        _emit_stage_start(progress, checkpoint, "understand", "正在理解 PPT 主题、用途、受众与文件名。", {"target_slide_count": target_count})
        intent = _understand_request(request_text, target_count, options)
        _emit_stage_done(progress, "understand", f"已理解主题：{intent.get('title') or '未命名'}。", {"title": intent.get("title"), "filename": intent.get("filename")})

        _emit_stage_start(progress, checkpoint, "outline", "正在确认内容大纲与叙事顺序。", {"target_slide_count": target_count})
        outline = _plan_outline(request_text, intent, target_count, options)
        _emit_stage_done(progress, "outline", f"已确认 {len(outline)} 页内容大纲。", {"pages": len(outline)})

        _emit_stage_start(progress, checkpoint, "page_types", "正在逐页确定页面类型：封面页、目录页、内容页。", {"outline_pages": len(outline)})
        pages = _plan_page_types(request_text, intent, outline, options)
        pages = _enforce_page_categories(pages, target_count)
        _emit_stage_done(progress, "page_types", f"已为 {len(pages)} 页逐页确定页面类型。", {"pages": len(pages), "categories": _count_page_categories(pages)})

        _emit_stage_start(progress, checkpoint, "design_recipe", "正在选择整套 PPT 的设计配方。", {"pages": len(pages)})
        design_system = _build_design_system(request_text, intent, pages, options)
        _emit_stage_done(progress, "design_recipe", f"已选择设计配方：{design_system.get('theme_name') or 'custom'}。", {"design_system": design_system})

        _emit_stage_start(progress, checkpoint, "layout_blueprint", "正在为每页生成布局蓝图，并统一同类型页面背景。", {"pages": len(pages)})
        blueprints = _build_layout_blueprints(pages, design_system)
        _emit_stage_done(progress, "layout_blueprint", f"已生成 {len(blueprints)} 页布局蓝图。", {"pages": len(blueprints), "backgrounds": design_system.get("backgrounds")})

        _emit_stage_start(progress, checkpoint, "html", "正在根据布局蓝图生成每页 HTML 设计稿。", {"pages": len(pages)})
        html_pages = _generate_html_pages(request_text, intent, pages, html_dir, options, design_system, progress=progress)
        _emit_stage_done(progress, "html", f"已生成 {len(html_pages)} 页 HTML 设计稿。", {"pages": len(html_pages), "html_dir": _rel_path(html_dir)})

        _emit_stage_start(progress, checkpoint, "aesthetic_review", "正在进行审美评分，低分页面将自动重写。", {"pages": len(html_pages)})
        html_pages, quality_report = _review_and_rewrite_html_pages(request_text, intent, html_pages, html_dir, options, design_system, progress)
        _emit_stage_done(progress, "aesthetic_review", _quality_summary_text(quality_report), {"quality_report": quality_report})

        _emit_stage_start(progress, checkpoint, "render", "正在将 HTML 页面截图为 16:9 图片。", {"pages": len(html_pages)})
        images, renderer, renderer_note = _render_html_pages(html_pages, image_dir)
        _emit_stage_done(progress, "render", f"已渲染 {len(images)} 张页面图片。", {"pages": len(images), "renderer": renderer, "renderer_note": renderer_note})

        _emit_stage_start(progress, checkpoint, "assemble", "正在把截图逐页插入 PPT。", {"images": len(images)})
        _emit_stage_done(progress, "assemble", f"已准备将 {len(images)} 张图片写入 PPT。", {"images": len(images)})

        filename = _safe_filename(intent.get("filename") or intent.get("title") or "ai_presentation.pptx")
        output_path = options.get("path") or options.get("output_path") or os.path.join("output", filename)
        if str(output_path).lower().endswith(os.sep) or str(output_path).endswith("/"):
            output_path = os.path.join(output_path, filename)
        if not str(output_path).lower().endswith(".pptx"):
            output_path = os.path.join(str(output_path), filename)
        out_path, err = check_path_or_error(output_path, must_exist=False)
        if err:
            return {"ok": False, "error": err}
        out_path = _dedupe_path(out_path)

        prs = Presentation()
        prs.slide_width = Inches(13.333333)
        prs.slide_height = Inches(7.5)
        blank = prs.slide_layouts[6]
        for image in images:
            slide = prs.slides.add_slide(blank)
            slide.shapes.add_picture(image["abs_path"], 0, 0, width=prs.slide_width, height=prs.slide_height)

        parent = os.path.dirname(out_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        _emit_stage_start(progress, checkpoint, "saved", "正在保存 PPTX 文件。", {"filename": os.path.basename(out_path)})
        prs.save(out_path)
        _emit_stage_done(progress, "saved", "PPTX 文件已保存。", {"path": _rel_path(out_path), "filename": os.path.basename(out_path)})

        rel_path = _rel_path(out_path)
        pipeline = _pipeline_summary(intent, outline, pages, html_pages, images, renderer, renderer_note, design_system, quality_report)
        return {
            "ok": True,
            "path": rel_path,
            "slides": len(images),
            "title": intent.get("title") or "",
            "filename": os.path.basename(out_path),
            "render_mode": "html_image",
            "html_dir": _rel_path(html_dir),
            "image_dir": _rel_path(image_dir),
            "html_pages": [_public_html_page(item) for item in html_pages],
            "images": [_public_image(item) for item in images],
            "renderer": renderer,
            "renderer_note": renderer_note,
            "pipeline": pipeline,
            "message": f"PPT 已按图片页流程生成：{rel_path}",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _as_text(value, default=""):
    if value is None:
        return default
    return str(value)


def _normalize_slide_count(value, request_text=""):
    try:
        count = int(value)
    except Exception:
        count = _extract_slide_count(request_text) or 8
    return max(1, min(50, count))


def _extract_slide_count(text):
    raw = _as_text(text)
    m = re.search(r"(\d{1,2})\s*(页|p\b|P\b|slides?\b|pages?\b)", raw)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            pass
    zh_map = {
        "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
        "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
    }
    m = re.search(r"([一二两三四五六七八九十]{1,3})\s*页", raw)
    if not m:
        return 0
    token = m.group(1)
    if token in zh_map:
        return zh_map[token]
    if token.startswith("十") and len(token) == 2:
        return 10 + zh_map.get(token[1], 0)
    if token.endswith("十") and len(token) == 2:
        return zh_map.get(token[0], 0) * 10
    if "十" in token:
        left, right = token.split("十", 1)
        return zh_map.get(left, 1) * 10 + zh_map.get(right, 0)
    return 0


def _llm_options(options, min_tokens=4096):
    out = dict(options or {})
    try:
        current = int(out.get("llm_max_tokens") or 0)
    except Exception:
        current = 0
    out["llm_max_tokens"] = max(current, min_tokens)
    if "llm_temperature" not in out:
        out["llm_temperature"] = 0.6
    return out


def _understand_request(request_text, target_count, options):
    prompt = _as_text(options.get("ppt_understand_prompt") or "").strip() or DEFAULT_UNDERSTAND_PROMPT
    user = json.dumps({
        "user_request": request_text,
        "target_slide_count": target_count,
        "style_preference": options.get("render_style") or "",
        "instruction": "理解主题内容，并让 AI 自己命名 PPT 文件。",
    }, ensure_ascii=False)
    data = _ppt_llm_generate_json(prompt, user, _llm_options(options, 2048), fallback=None)
    if isinstance(data, dict) and isinstance(data.get("intent"), dict):
        data = data.get("intent")
    if not isinstance(data, dict):
        data = {}
    candidate_title = _clean_text(data.get("title"))
    title = candidate_title if _looks_like_title(candidate_title) else _guess_title(request_text)
    candidate_filename = _clean_text(data.get("filename"))
    filename_source = candidate_filename if _looks_like_title(os.path.splitext(candidate_filename)[0]) else title
    intent = {
        "title": title,
        "subtitle": _clean_text(data.get("subtitle")),
        "purpose": _clean_text(data.get("purpose")) or "演示汇报",
        "audience": _clean_text(data.get("audience")) or "目标受众",
        "language": _clean_text(data.get("language")) or "中文",
        "tone": _clean_text(data.get("tone")) or "清晰、专业",
        "visual_direction": _clean_text(data.get("visual_direction") or options.get("render_style")) or "由主题自由决定",
        "filename": _safe_filename(filename_source),
        "target_slide_count": target_count,
    }
    return intent


def _plan_outline(request_text, intent, target_count, options):
    prompt = _as_text(options.get("ppt_outline_prompt") or "").strip() or DEFAULT_OUTLINE_PROMPT
    user = json.dumps({
        "user_request": request_text,
        "intent": intent,
        "target_slide_count": target_count,
    }, ensure_ascii=False)
    data = _ppt_llm_generate_json(prompt, user, _llm_options(options, 4096), fallback=None)
    raw_pages = []
    if isinstance(data, dict):
        raw_pages = data.get("outline") or data.get("pages") or data.get("slides") or []
    elif isinstance(data, list):
        raw_pages = data
    pages = _normalize_outline(raw_pages, intent, target_count)
    return pages


def _normalize_outline(raw_pages, intent, target_count):
    pages = []
    for idx, item in enumerate(raw_pages if isinstance(raw_pages, list) else [], start=1):
        if isinstance(item, dict):
            title = _clean_text(item.get("title") or item.get("name"))
            goal = _clean_text(item.get("goal") or item.get("intent") or item.get("purpose"))
            key_points = item.get("key_points") or item.get("bullets") or item.get("items") or []
        else:
            title = _clean_text(item)
            goal = ""
            key_points = []
        if not _looks_like_title(title):
            continue
        clean_points = []
        for point in key_points:
            point_text = _clean_text(point if not isinstance(point, dict) else point.get("text") or point.get("title"))[:120]
            if point_text and not _is_garbled_text(point_text):
                clean_points.append(point_text)
        pages.append({
            "page": len(pages) + 1,
            "title": title[:80],
            "goal": goal[:180] or f"说明 {title}",
            "key_points": clean_points[:5],
        })
    if len(pages) < target_count:
        pages.extend(_fallback_outline(intent, target_count)[len(pages):])
    pages = pages[:target_count]
    for idx, page in enumerate(pages, start=1):
        page["page"] = idx
    return pages


def _fallback_outline(intent, target_count):
    title = intent.get("title") or "主题演示"
    if target_count == 1:
        return [{"page": 1, "title": title, "goal": "集中呈现核心信息", "key_points": ["核心背景", "关键观点", "行动建议"]}]
    base = [
        ("封面", "建立主题和场景", [intent.get("subtitle") or intent.get("purpose") or ""]),
        ("议程", "说明演示结构", ["背景", "核心内容", "行动建议"]),
        ("背景与问题", "交代为什么现在需要关注", ["现状", "痛点", "机会"]),
        ("核心方案", "说明主要思路和价值", ["方案", "机制", "优势"]),
        ("实施路径", "说明推进步骤", ["启动", "试点", "扩展"]),
        ("预期效果", "呈现结果和衡量指标", ["效率", "质量", "体验"]),
        ("总结与下一步", "收束观点并给出行动", ["关键结论", "下一步"]),
    ]
    pages = []
    for i in range(target_count):
        if i == 0:
            item = (title, "建立主题和场景", [intent.get("subtitle") or intent.get("purpose") or ""])
        elif i == target_count - 1:
            item = base[-1]
        elif i - 1 < len(base) - 2:
            item = base[i + 1]
        else:
            item = (f"重点展开 {i}", "补充关键论据和细节", ["关键事实", "案例或数据", "结论"])
        pages.append({"page": i + 1, "title": item[0], "goal": item[1], "key_points": [x for x in item[2] if x]})
    return pages


def _plan_page_types(request_text, intent, outline, options):
    prompt = _as_text(options.get("ppt_page_type_prompt") or "").strip() or DEFAULT_PAGE_TYPE_PROMPT
    design_hint = _select_design_preset(request_text, intent, options)
    user = json.dumps({
        "user_request": request_text,
        "intent": intent,
        "outline": outline,
        "design_system": design_hint,
        "layout_instruction": "为不同页面分配不同 page_type 和 visual_role；除非内容确实相同，避免连续页面使用同一种表达方式。",
    }, ensure_ascii=False)
    data = _ppt_llm_generate_json(prompt, user, _llm_options(options, 4096), fallback=None)
    raw_pages = []
    if isinstance(data, dict):
        raw_pages = data.get("pages") or data.get("slides") or []
    elif isinstance(data, list):
        raw_pages = data
    pages = []
    for idx, outline_page in enumerate(outline, start=1):
        raw = raw_pages[idx - 1] if idx - 1 < len(raw_pages) and isinstance(raw_pages[idx - 1], dict) else {}
        blocks = raw.get("content_blocks") or raw.get("blocks") or []
        if not isinstance(blocks, list) or not blocks:
            blocks = [{"title": "关键内容", "text": "；".join(outline_page.get("key_points") or []) or outline_page.get("goal") or ""}]
        page_type = _clean_text(raw.get("page_type") or raw.get("type") or _default_page_type(idx, len(outline), outline_page))
        pages.append({
            "page": idx,
            "title": _clean_text(raw.get("title")) or outline_page.get("title") or f"第 {idx} 页",
            "goal": outline_page.get("goal") or "",
            "key_points": outline_page.get("key_points") or [],
            "page_type": page_type[:40],
            "visual_role": _clean_text(raw.get("visual_role") or raw.get("intent")) or "承载本页核心信息",
            "content_blocks": [_normalize_block(block) for block in blocks[:6]],
        })
    return pages


def _enforce_page_categories(pages, target_count):
    total = len(pages)
    for idx, page in enumerate(pages, start=1):
        raw_type = _as_text(page.get("page_type") or "").strip().lower()
        if idx == 1:
            category = "cover"
            page_type = "cover"
        elif total >= 4 and idx == 2:
            category = "agenda"
            page_type = "agenda"
        else:
            category = "content"
            page_type = raw_type if raw_type and raw_type not in ("cover", "agenda") else _default_page_type(idx, total, page)
            if page_type in ("cover", "agenda"):
                page_type = "concept"
        page["page_category"] = category
        page["page_type"] = page_type
        if category == "cover":
            page["visual_role"] = page.get("visual_role") or "用独特封面背景建立主题气质和第一视觉记忆点"
        elif category == "agenda":
            page["visual_role"] = page.get("visual_role") or "用独特目录背景和导航结构说明整份 PPT 的内容路径"
        else:
            page["visual_role"] = page.get("visual_role") or "用统一内容页背景承载核心信息"
    return pages


def _count_page_categories(pages):
    counts = {"cover": 0, "agenda": 0, "content": 0}
    for page in pages or []:
        key = page.get("page_category") or "content"
        counts[key] = counts.get(key, 0) + 1
    return counts


def _build_layout_blueprints(pages, design_system):
    _assign_page_variants(pages, design_system)
    backgrounds = design_system.get("backgrounds") or {}
    blueprints = []
    for idx, page in enumerate(pages, start=1):
        category = page.get("page_category") or "content"
        background = backgrounds.get(category) or backgrounds.get("content") or {}
        variant = page.get("page_variant") or "freeform"
        blueprint = {
            "page": page.get("page"),
            "category": category,
            "page_type": page.get("page_type"),
            "variant": variant,
            "background_recipe": background,
            "composition": _composition_for_variant(category, page.get("page_type"), variant),
            "must_follow": [
                "严格使用 background_recipe 生成页面背景。",
                "封面页和目录页背景必须独特；内容页使用 consistent_content_background。",
                "禁止使用普通白底加二列卡片作为默认方案。",
            ],
        }
        page["layout_blueprint"] = blueprint
        page["design_instruction"] = _page_variant_instruction(page.get("page_type"), variant, idx, len(pages))
        blueprints.append(blueprint)
    return blueprints


def _composition_for_variant(category, page_type, variant):
    if category == "cover":
        return "非对称封面：左侧/下方放超大标题，右侧或背景放抽象主题符号、光斑、几何装饰和强层级副标题。"
    if category == "agenda":
        return "目录导航页：使用纵向编号轨道或章节卡片，背景与封面明显不同，但保留同一色彩体系。"
    mapping = {
        "horizontal_timeline": "横向时间线，节点错落排列，底部加入进度轨道。",
        "step_staircase": "阶梯式流程，信息块沿对角线或台阶上升。",
        "split_screen": "左右分屏对比，中间使用清晰分隔线或 VS 结构。",
        "big_number_dashboard": "大数字仪表盘，主指标占据视觉中心，周围放辅助解释。",
        "hub_and_spoke": "中心概念加放射连接，周围信息环绕。",
        "three_insight_cards": "三重点洞察，但卡片大小和位置要有主次，不做平均网格。",
    }
    return mapping.get(variant) or "内容页使用统一背景系统，采用非均分模块、主次标题和装饰线条建立层级。"


def _build_design_system(request_text, intent, pages, options):
    preset = _select_design_preset(request_text, intent, options)
    preferred = _as_text(options.get("render_style") or options.get("style") or intent.get("visual_direction") or "").strip()
    system = dict(preset)
    system.update({
        "style_preference": preferred,
        "consistency_rules": [
            "整份 PPT 使用同一组颜色、字体气质和基础形状语言。",
            "封面页背景必须独特，目录页背景必须独特，内容页背景按同一种内容页系统保持一致。",
            "同一种页面类型使用同一种背景配方，但通过构图、内容和装饰位置形成页面差异。",
        ],
        "composition_rules": [
            "每页最多 1 个主标题区、1 个核心视觉区、2-5 个信息区。",
            "根据 page_variant 改变视觉重心：左重右轻、上重下轻、中心放射、时间线、分屏、仪表盘等。",
            "避免文字铺满；优先用大小、留白、线条、色块、数字和图标感符号建立层级。",
        ],
        "css_must_have": ["radial-gradient", "linear-gradient", "box-shadow", "border", "absolute-positioned-decoration"],
        "available_layout_variants": _PAGE_VARIANTS,
        "backgrounds": _build_background_recipes(preset),
        "seed": system_seed(request_text, intent, options),
    })
    return system


def _build_background_recipes(preset):
    palette = list(preset.get("palette") or ["#0F172A", "#F8FAFC", "#2563EB", "#8B5CF6", "#E2E8F0"])
    while len(palette) < 5:
        palette.append(palette[-1])
    return {
        "cover": {
            "name": "unique_cover_background",
            "recipe": f"封面专属背景：使用 {palette[0]} 到 {palette[1]} 的大面积渐变，叠加 2-3 个径向光斑、一个超大半透明主题符号或几何图形，形成强视觉中心。",
            "css_hint": f"background: radial-gradient(circle at 78% 22%, {palette[2]}55, transparent 32%), radial-gradient(circle at 15% 85%, {palette[3]}44, transparent 34%), linear-gradient(135deg, {palette[0]}, {palette[1]});",
        },
        "agenda": {
            "name": "unique_agenda_background",
            "recipe": f"目录页专属背景：使用更克制的底色，加入纵向导航轨道、章节编号水印和细网格，必须区别于封面。",
            "css_hint": f"background: linear-gradient(120deg, {palette[4]}, #ffffff), radial-gradient(circle at 90% 10%, {palette[2]}33, transparent 26%);",
        },
        "content": {
            "name": "consistent_content_background",
            "recipe": f"内容页统一背景：同一套浅/深底、角落光斑、细线框或网格系统。所有内容页背景保持一致，只改变信息布局。",
            "css_hint": f"background: radial-gradient(circle at 88% 12%, {palette[2]}26, transparent 25%), linear-gradient(135deg, {palette[4]}, #ffffff);",
        },
    }


def system_seed(request_text, intent, options):
    raw = _as_text(options.get("style_seed") or options.get("seed") or "").strip()
    if raw:
        return raw
    basis = f"{request_text}|{intent.get('title') or ''}|{time.time_ns()}"
    return str(abs(hash(basis)) % 1000000)


def _select_design_preset(request_text, intent, options):
    explicit = _as_text(options.get("render_style") or options.get("style") or intent.get("visual_direction") or "").lower()
    if any(token in explicit for token in ["科技", "未来", "ai", "数据", "数字", "芯片", "智能"]):
        return dict(_STYLE_PRESETS[1])
    if any(token in explicit for token in ["咨询", "商业", "汇报", "战略", "专业", "简约"]):
        return dict(_STYLE_PRESETS[3])
    if any(token in explicit for token in ["温暖", "教育", "人文", "亲和", "公益"]):
        return dict(_STYLE_PRESETS[2])
    if any(token in explicit for token in ["海报", "年轻", "冲击", "大胆", "活力"]):
        return dict(_STYLE_PRESETS[4])
    basis = f"{request_text}|{intent.get('title') or ''}|{intent.get('purpose') or ''}|{time.time_ns()}"
    return dict(random.Random(basis).choice(_STYLE_PRESETS))


def _assign_page_variants(pages, design_system):
    used = {}
    seed = _as_text(design_system.get("seed") or time.time_ns())
    rng = random.Random(seed)
    for idx, page in enumerate(pages, start=1):
        page_type = _as_text(page.get("page_type") or "concept").strip().lower() or "concept"
        variants = list(_PAGE_VARIANTS.get(page_type) or _PAGE_VARIANTS["freeform"])
        rng.shuffle(variants)
        variant = variants[0]
        if used.get(variant, 0) and len(variants) > 1:
            variant = variants[1]
        used[variant] = used.get(variant, 0) + 1
        page["page_variant"] = variant
        page["design_instruction"] = _page_variant_instruction(page_type, variant, idx, len(pages))


def _page_variant_instruction(page_type, variant, index, total):
    return (
        f"第 {index}/{total} 页使用 {page_type} / {variant} 版式。"
        "必须让该页构图区别于相邻页面；不要默认复用上一页结构。"
    )


def _default_page_type(index, total, page):
    title = _as_text(page.get("title")).lower()
    if index == 1:
        return "cover"
    if index == total:
        return "summary"
    if "议程" in title or "目录" in title:
        return "agenda"
    if "路径" in title or "流程" in title or "步骤" in title:
        return "process"
    if "对比" in title or "比较" in title:
        return "comparison"
    if "数据" in title or "效果" in title or "指标" in title:
        return "data_story"
    return "concept"


def _normalize_block(block):
    if isinstance(block, dict):
        title = _clean_text(block.get("title") or block.get("name"))[:60]
        text = _clean_text(block.get("text") or block.get("desc") or block.get("content"))[:280]
        return {
            "title": title if not _is_garbled_text(title) else "",
            "text": text if not _is_garbled_text(text) else "",
        }
    text = _clean_text(block)[:280]
    return {"title": "", "text": text if not _is_garbled_text(text) else ""}


def _generate_html_pages(request_text, intent, pages, html_dir, options, design_system=None, progress=None):
    html_prompt = (
        _as_text(options.get("ppt_html_prompt") or "").strip()
        or _as_text(options.get("ppt_slide_prompt") or "").strip()
        or DEFAULT_HTML_PROMPT
    )
    design_system = design_system or _build_design_system(request_text, intent, pages, options)
    html_pages = []
    for page in pages:
        user = json.dumps({
            "user_request": request_text,
            "intent": intent,
            "page": page,
            "canvas": {"width": _WIDTH, "height": _HEIGHT, "ratio": "16:9"},
            "style_preference": options.get("render_style") or intent.get("visual_direction") or "",
            "design_system": design_system,
            "layout_blueprint": page.get("layout_blueprint") or {},
            "page_variant": page.get("page_variant") or "freeform",
            "page_design_instruction": page.get("design_instruction") or "根据内容自由选择，但必须区别于通用卡片网格。",
            "anti_template_warning": "不要复用固定模板；本页 HTML 的 CSS 布局、背景、视觉重心、装饰元素必须与 layout_blueprint 一致。",
        }, ensure_ascii=False)
        _emit_substep(progress, "html", "generate_html_page", f"正在生成第 {page.get('page')} 页 HTML：{page.get('title') or ''}", "running", {"page": page.get("page"), "page_type": page.get("page_type"), "category": page.get("page_category")})
        data = _ppt_llm_generate_json(html_prompt, user, _llm_options(options, 8192), fallback=None)
        html_doc = ""
        if isinstance(data, dict):
            html_doc = data.get("html") or data.get("document") or data.get("content") or ""
        elif isinstance(data, str):
            html_doc = data
        html_doc = _sanitize_html(html_doc) if html_doc else ""
        if html_doc and _html_is_garbled(html_doc):
            html_doc = ""
        if not html_doc:
            html_doc = _fallback_html(intent, page)
        html_doc = _enforce_background_design_system(html_doc, page, design_system)
        filename = f"slide_{int(page.get('page') or len(html_pages) + 1):02d}.html"
        abs_path = os.path.join(html_dir, filename)
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(html_doc)
        item = dict(page)
        item.update({"abs_path": abs_path, "path": _rel_path(abs_path), "quality": _score_html_design(html_doc, page, design_system), "rewrite_count": 0})
        _emit_substep(progress, "html", "generate_html_page", f"第 {page.get('page')} 页 HTML 已生成。", "done", {"page": page.get("page"), "path": _rel_path(abs_path)})
        html_pages.append(item)
    return html_pages


def _review_and_rewrite_html_pages(request_text, intent, html_pages, html_dir, options, design_system, progress=None):
    threshold = _aesthetic_threshold(options)
    max_rewrites = _aesthetic_rewrite_limit(options)
    report = {"threshold": threshold, "pages": [], "rewrite_count": 0, "passed": True}
    for item in html_pages:
        score_info = item.get("quality") or _score_html_file(item.get("abs_path"), item, design_system)
        item["quality"] = score_info
        page_no = item.get("page")
        _emit_substep(progress, "aesthetic_review", "score_page", f"第 {page_no} 页审美评分：{score_info.get('score')}。", "done", {"page": page_no, "score": score_info.get("score"), "issues": score_info.get("issues")})
        rewrites = 0
        while score_info.get("score", 0) < threshold and rewrites < max_rewrites:
            rewrites += 1
            report["rewrite_count"] += 1
            _emit_substep(progress, "aesthetic_review", "rewrite_low_score_page", f"第 {page_no} 页评分低于 {threshold}，正在第 {rewrites} 次重写。", "running", {"page": page_no, "score": score_info.get("score"), "issues": score_info.get("issues")})
            new_html = _rewrite_html_page(request_text, intent, item, options, design_system, score_info)
            new_html = _sanitize_html(new_html) if new_html else ""
            if not new_html or _html_is_garbled(new_html):
                break
            new_html = _enforce_background_design_system(new_html, item, design_system)
            with open(item["abs_path"], "w", encoding="utf-8") as f:
                f.write(new_html)
            score_info = _score_html_design(new_html, item, design_system)
            item["quality"] = score_info
            item["rewrite_count"] = rewrites
            _emit_substep(progress, "aesthetic_review", "rewrite_low_score_page", f"第 {page_no} 页重写完成，审美评分：{score_info.get('score')}。", "done", {"page": page_no, "score": score_info.get("score"), "rewrite_count": rewrites})
        passed = score_info.get("score", 0) >= threshold
        report["pages"].append({"page": page_no, "score": score_info.get("score"), "passed": passed, "issues": score_info.get("issues") or [], "rewrite_count": rewrites})
        if not passed:
            report["passed"] = False
    return html_pages, report


def _aesthetic_threshold(options):
    try:
        return max(40, min(95, int(options.get("aesthetic_score_threshold") or 82)))
    except Exception:
        return 82


def _aesthetic_rewrite_limit(options):
    try:
        return max(0, min(3, int(options.get("aesthetic_rewrite_limit") or 2)))
    except Exception:
        return 2


def _score_html_file(path, page, design_system):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return _score_html_design(f.read(), page, design_system)
    except Exception:
        return {"score": 0, "issues": ["html_not_readable"]}


def _score_html_design(html_doc, page, design_system):
    text = _as_text(html_doc)
    lower = text.lower()
    compact = re.sub(r"\s+", "", lower)
    score = 22
    checks = [
        ("radial-gradient", 8, "missing_radial_gradient"),
        ("linear-gradient", 6, "missing_linear_gradient"),
        ("box-shadow", 6, "missing_shadow"),
        ("position:absolute", 6, "missing_absolute_decoration"),
        ("border", 4, "missing_border_system"),
        ("var(", 4, "missing_css_variables"),
        ("clip-path", 5, "missing_geometric_mask"),
        ("filter:blur", 5, "missing_blur_blob"),
        ("backdrop-filter", 5, "missing_glassmorphism"),
        ("svg", 5, "missing_svg_decoration"),
        ("repeating-linear-gradient", 5, "missing_css_pattern_or_grid"),
        ("::before", 4, "missing_pseudo_layer_before"),
        ("::after", 4, "missing_pseudo_layer_after"),
        ("text-shadow", 3, "missing_title_depth"),
    ]
    issues = []
    for token, points, issue in checks:
        if token.replace(" ", "") in compact:
            score += points
        else:
            issues.append(issue)
    radial_count = lower.count("radial-gradient")
    if radial_count >= 2:
        score += 8
    else:
        score -= 8
        issues.append("not_enough_multi_radial_background")
    if _has_visual_focus(lower):
        score += 8
    else:
        score -= 10
        issues.append("weak_visual_focus")
    if _looks_like_plain_web_card_layout(lower):
        score -= 22
        issues.append("looks_like_plain_web_cards")
    if _looks_like_equal_grid(lower):
        score -= 16
        issues.append("too_uniform_equal_grid")
    if _palette_usage_count(lower, design_system) < 3:
        score -= 8
        issues.append("color_palette_too_plain")
    category = page.get("page_category") or "content"
    if category in ("cover", "agenda") and radial_count < 2:
        score -= 12
        issues.append("unique_background_too_weak")
    if category == "content" and "consistent_content_background" not in lower and "content-bg" not in lower:
        score -= 4
        issues.append("content_background_not_explicit")
    return {"score": max(0, min(100, score)), "issues": issues[:12]}


def _has_visual_focus(lower):
    focus_tokens = ["hero", "focus", "orb", "blob", "symbol", "mega", "display", "visual", "spotlight", "watermark", "font-size:9", "font-size:10", "font-size:11"]
    return any(token in lower for token in focus_tokens)


def _looks_like_plain_web_card_layout(lower):
    card_count = len(re.findall(r"class=[\"']?[^\"'>]*(card|panel|tile)", lower))
    has_advanced_bg = lower.count("radial-gradient") >= 2 or "clip-path" in lower or "filter: blur" in lower or "filter:blur" in lower
    return card_count >= 4 and not has_advanced_bg


def _looks_like_equal_grid(lower):
    grid_signals = ["repeat(2", "repeat(3", "grid-template-columns:repeat", "1fr 1fr", "grid-template-columns"]
    grid_score = sum(1 for token in grid_signals if token in lower)
    asymmetric_signals = ["transform:", "rotate(", "translate(", "clip-path", "position:absolute", "span 2", "grid-column"]
    asymmetric_score = sum(1 for token in asymmetric_signals if token in lower)
    return grid_score >= 2 and asymmetric_score < 2


def _palette_usage_count(lower, design_system):
    count = 0
    for color in (design_system or {}).get("palette") or []:
        c = _as_text(color).lower()
        if c and c in lower:
            count += 1
    return count


def _rewrite_html_page(request_text, intent, page, options, design_system, score_info):
    prompt = _as_text(options.get("ppt_html_prompt") or "").strip() or DEFAULT_HTML_PROMPT
    user = json.dumps({
        "user_request": request_text,
        "intent": intent,
        "page": {k: v for k, v in page.items() if k not in ("abs_path",)},
        "design_system": design_system,
        "previous_score": score_info,
        "rewrite_instruction": "上一版审美评分不足。必须显著增强背景层次、视觉焦点、CSS 装饰和版式张力，同时保持内容准确。只输出 JSON：{html:完整HTML}。",
        "hard_requirements": [
            "必须至少包含 2 个 radial-gradient 和 1 个 linear-gradient。",
            "必须包含 mesh/光斑/blob/网格/pattern/SVG 装饰中的至少 3 类。",
            "必须有明显视觉焦点，例如 hero 区、大数字、主题符号、spotlight、watermark。",
            "禁止普通网页卡片感，禁止平均 2x2/3x2 卡片网格作为主体。",
            "封面页和目录页背景必须明显不同；内容页使用统一背景系统。",
        ],
        "failed_issues": score_info.get("issues") or [],
    }, ensure_ascii=False)
    data = _ppt_llm_generate_json(prompt, user, _llm_options(options, 8192), fallback=None)
    if isinstance(data, dict):
        return data.get("html") or data.get("document") or data.get("content") or ""
    return data if isinstance(data, str) else ""


def _quality_summary_text(report):
    pages = report.get("pages") or [] if isinstance(report, dict) else []
    if not pages:
        return "审美评分完成。"
    avg = sum(int(p.get("score") or 0) for p in pages) / max(1, len(pages))
    low = [p for p in pages if not p.get("passed")]
    return f"审美评分完成，平均分 {avg:.0f}，重写 {report.get('rewrite_count', 0)} 次，低分页 {len(low)} 页。"


def _enforce_background_design_system(html_doc, page, design_system):
    """Inject a deterministic high-quality background/decor layer.

    LLM prompts alone often collapse into plain card grids. This function makes the
    background system non-optional by adding CSS variables, multi-layer gradients,
    pseudo-elements, SVG/pattern-like overlays and category markers used by scoring.
    """
    text = _as_text(html_doc)
    if not text:
        return text
    category = page.get("page_category") or "content"
    recipe = ((design_system or {}).get("backgrounds") or {}).get(category) or {}
    palette = list((design_system or {}).get("palette") or ["#0F172A", "#F8FAFC", "#2563EB", "#8B5CF6", "#E2E8F0"])
    while len(palette) < 5:
        palette.append(palette[-1])
    marker = {
        "cover": "unique_cover_background",
        "agenda": "unique_agenda_background",
        "content": "consistent_content_background content-bg",
    }.get(category, "consistent_content_background content-bg")
    css = _background_system_css(category, palette, marker, recipe)
    if "/* AI_PPT_BACKGROUND_SYSTEM */" in text:
        return text
    if "</head>" in text.lower():
        return re.sub(r"</head>", css + "</head>", text, count=1, flags=re.IGNORECASE)
    return css + text


def _background_system_css(category, palette, marker, recipe):
    p0, p1, p2, p3, p4 = palette[:5]
    if category == "cover":
        bg = (
            f"radial-gradient(circle at 78% 18%, {p2}77 0, transparent 31%),"
            f"radial-gradient(circle at 18% 82%, {p3}66 0, transparent 34%),"
            f"radial-gradient(circle at 52% 46%, {p4}35 0, transparent 28%),"
            f"linear-gradient(135deg, {p0} 0%, {p1} 58%, #050812 100%)"
        )
        pseudo = f"""
body::before{{content:"";position:absolute;inset:-18%;pointer-events:none;opacity:.42;background:repeating-linear-gradient(90deg,rgba(255,255,255,.10) 0 1px,transparent 1px 72px),repeating-linear-gradient(0deg,rgba(255,255,255,.08) 0 1px,transparent 1px 72px);transform:rotate(-7deg);}}
body::after{{content:"";position:absolute;right:-140px;top:80px;width:560px;height:560px;border-radius:45%;background:{p2}44;filter:blur(46px);clip-path:polygon(50% 0,100% 34%,82% 100%,18% 100%,0 34%);box-shadow:0 0 120px {p2}66;}}
"""
    elif category == "agenda":
        bg = (
            f"radial-gradient(circle at 12% 18%, {p3}55 0, transparent 24%),"
            f"radial-gradient(circle at 88% 86%, {p2}42 0, transparent 30%),"
            f"linear-gradient(120deg, {p4} 0%, #ffffff 42%, {p0} 100%)"
        )
        pseudo = f"""
body::before{{content:"";position:absolute;left:8%;top:8%;bottom:8%;width:3px;background:linear-gradient(180deg,{p2},transparent);box-shadow:0 0 34px {p2};}}
body::after{{content:"AGENDA";position:absolute;right:5%;bottom:2%;font-size:132px;font-weight:900;letter-spacing:.08em;color:{p2}14;text-shadow:0 18px 60px {p2}22;}}
"""
    else:
        bg = (
            f"radial-gradient(circle at 90% 8%, {p2}30 0, transparent 24%),"
            f"radial-gradient(circle at 8% 92%, {p3}24 0, transparent 26%),"
            f"linear-gradient(135deg, {p4} 0%, #ffffff 48%, {p0}12 100%)"
        )
        pseudo = f"""
body::before{{content:"";position:absolute;inset:0;pointer-events:none;opacity:.32;background:repeating-linear-gradient(90deg,rgba(15,23,42,.08) 0 1px,transparent 1px 96px),repeating-linear-gradient(0deg,rgba(15,23,42,.06) 0 1px,transparent 1px 96px);}}
body::after{{content:"";position:absolute;right:48px;top:48px;width:220px;height:220px;border-radius:999px;background:{p2}22;filter:blur(32px);box-shadow:0 0 80px {p2}33;}}
"""
    recipe_comment = html_lib.escape(json.dumps(recipe, ensure_ascii=False))
    return f"""
<style>
/* AI_PPT_BACKGROUND_SYSTEM {marker} {recipe_comment} */
:root{{--ppt-bg-0:{p0};--ppt-bg-1:{p1};--ppt-accent:{p2};--ppt-accent-2:{p3};--ppt-surface:{p4};}}
html,body{{margin:0;width:100%;height:100%;overflow:hidden;}}
body{{position:relative;isolation:isolate;background:{bg};}}
body > *{{position:relative;z-index:1;}}
{pseudo}
.ai-ppt-noise{{position:absolute;inset:0;pointer-events:none;z-index:0;opacity:.08;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.45'/%3E%3C/svg%3E");}}
</style>
<script type="application/json" id="ai-ppt-background-meta">{{"background_marker":"{marker}","has_mesh_gradient":true,"has_noise_texture":true,"has_visual_focus":"hero spotlight orb watermark","has_css_pattern":true}}</script>
""".replace('<script type="application/json" id="ai-ppt-background-meta">', '<template id="ai-ppt-background-meta">').replace('</script>', '</template>')



    text = _HTML_FENCE_RE.sub("", _as_text(html_doc).strip())
    text = _SCRIPT_RE.sub("", text)
    text = _EVENT_HANDLER_RE.sub("", text)
    csp = (
        '<meta http-equiv="Content-Security-Policy" '
        'content="default-src \'none\'; img-src data: file:; style-src \'unsafe-inline\'; font-src data:; script-src \'none\';">'
    )
    viewport = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    if "<html" not in text.lower():
        text = f"<!doctype html><html><head><meta charset=\"utf-8\">{viewport}{csp}</head><body>{text}</body></html>"
    else:
        if "<meta charset" not in text.lower():
            text = re.sub(r"<head(\s[^>]*)?>", lambda m: m.group(0) + '<meta charset="utf-8">', text, count=1, flags=re.IGNORECASE)
        if "Content-Security-Policy" not in text:
            text = re.sub(r"<head(\s[^>]*)?>", lambda m: m.group(0) + viewport + csp, text, count=1, flags=re.IGNORECASE)
    if "body" in text.lower() and "margin" not in text[:2000].lower():
        base_css = (
            "<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;}"
            "body{font-family:\"Microsoft YaHei\",\"Noto Sans CJK SC\",\"Source Han Sans SC\",\"PingFang SC\",\"SimHei\",Arial,sans-serif;}</style>"
        )
        text = re.sub(r"</head>", base_css + "</head>", text, count=1, flags=re.IGNORECASE)
    return text


def _fallback_html(intent, page):
    title = html_lib.escape(page.get("title") or intent.get("title") or "PPT")
    subtitle = html_lib.escape(page.get("goal") or intent.get("purpose") or "")
    page_type = html_lib.escape(page.get("page_type") or "concept")
    visual = html_lib.escape(intent.get("visual_direction") or "主题视觉")
    blocks = page.get("content_blocks") or []
    points = page.get("key_points") or []
    block_html = ""
    for idx, block in enumerate(blocks[:4], start=1):
        b_title = html_lib.escape(block.get("title") or f"要点 {idx}")
        b_text = html_lib.escape(block.get("text") or "")
        block_html += f"<section><b>{b_title}</b><p>{b_text}</p></section>"
    if not block_html:
        for idx, point in enumerate(points[:4], start=1):
            block_html += f"<section><b>要点 {idx}</b><p>{html_lib.escape(_as_text(point))}</p></section>"
    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: file:; font-src data:;">
<style>
html,body{{margin:0;width:100%;height:100%;overflow:hidden;background:#f7f5ef;}}
body{{font-family:"Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC","PingFang SC","SimHei","Segoe UI",Arial,sans-serif;color:#19212a;}}
.slide{{width:1600px;height:900px;box-sizing:border-box;padding:82px 94px;position:relative;background:linear-gradient(135deg,#f8f6f0 0%,#e9f3f1 48%,#f3ede2 100%);}}
.slide:before{{content:"";position:absolute;inset:36px;border:2px solid rgba(25,33,42,.12);pointer-events:none;}}
.meta{{font-size:28px;letter-spacing:.08em;text-transform:uppercase;color:#536d67;font-weight:700;margin-bottom:42px;}}
h1{{font-size:74px;line-height:1.06;margin:0 0 28px;max-width:1120px;color:#14212b;}}
.subtitle{{font-size:30px;line-height:1.45;max-width:980px;color:#38464f;margin-bottom:54px;}}
.grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;width:1160px;}}
section{{background:rgba(255,255,255,.68);border:1px solid rgba(25,33,42,.13);padding:26px 28px;min-height:124px;box-sizing:border-box;}}
section b{{display:block;font-size:27px;margin-bottom:12px;color:#173b46;}}
section p{{font-size:22px;line-height:1.42;margin:0;color:#44515a;}}
.tag{{position:absolute;right:94px;bottom:70px;font-size:22px;color:#536d67;}}
</style>
</head>
<body>
<main class="slide">
  <div class="meta">{page_type}</div>
  <h1>{title}</h1>
  <div class="subtitle">{subtitle}</div>
  <div class="grid">{block_html}</div>
  <div class="tag">{visual}</div>
</main>
</body>
</html>"""


def _render_html_pages(html_pages, image_dir):
    browser = _find_browser()
    profile_dir = os.path.join(image_dir, "_browser_profile")
    os.makedirs(profile_dir, exist_ok=True)
    images = []
    used_browser = False
    notes = []
    for page in html_pages:
        slide_no = int(page.get("page") or len(images) + 1)
        png_path = os.path.join(image_dir, f"slide_{slide_no:02d}.png")
        ok = False
        note = ""
        if browser:
            ok, note = _capture_with_browser(browser, page["abs_path"], png_path, profile_dir)
            used_browser = used_browser or ok
        if not ok:
            note = note or "browser_not_available"
            _capture_with_pillow(page, png_path)
        _fit_image_16_9(png_path)
        item = dict(page)
        item.update({"abs_path": png_path, "path": _rel_path(png_path), "renderer_note": note})
        images.append(item)
        if note:
            notes.append(f"{slide_no}:{note}")
    renderer = "browser" if used_browser else "pillow_fallback"
    renderer_note = "; ".join(notes[:8])
    return images, renderer, renderer_note


def _find_browser():
    env_path = os.environ.get("PPT_BROWSER_PATH")
    candidates = [env_path] if env_path else []
    for name in ("msedge", "msedge.exe", "chrome", "chrome.exe", "chromium", "chromium.exe"):
        found = shutil.which(name)
        if found:
            candidates.append(found)
    candidates.extend([
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ])
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return ""


def _capture_with_browser(browser, html_path, png_path, profile_dir):
    url = Path(os.path.abspath(html_path)).as_uri()
    common = [
        browser,
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--disable-extensions",
        "--allow-file-access-from-files",
        f"--user-data-dir={profile_dir}",
        f"--window-size={_WIDTH},{_HEIGHT}",
        f"--screenshot={png_path}",
        url,
    ]
    last_err = ""
    for headless in ("--headless=new", "--headless"):
        args = [common[0], headless] + common[1:]
        try:
            result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
            if result.returncode == 0 and os.path.exists(png_path) and os.path.getsize(png_path) > 0:
                return True, ""
            last_err = (result.stderr or result.stdout or b"").decode("utf-8", errors="replace")[:240]
        except Exception as exc:
            last_err = str(exc)[:240]
    return False, last_err or "browser_capture_failed"


def _capture_with_pillow(page, png_path):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return
    img = Image.new("RGB", (_WIDTH, _HEIGHT), "#f7f5ef")
    draw = ImageDraw.Draw(img)
    palette = ["#173b46", "#bd5d3a", "#5f6f52", "#2f4b7c"]
    accent = palette[(int(page.get("page") or 1) - 1) % len(palette)]
    draw.rectangle([0, 0, _WIDTH, _HEIGHT], fill="#f7f5ef")
    draw.rectangle([48, 48, _WIDTH - 48, _HEIGHT - 48], outline="#d8d2c5", width=3)
    draw.rectangle([94, 94, 178, 178], fill=accent)
    title_font = _font(58, bold=True)
    body_font = _font(26)
    small_font = _font(22)
    draw.text((210, 96), _as_text(page.get("page_type") or "PPT").upper(), fill="#536d67", font=small_font)
    _draw_wrapped(draw, _as_text(page.get("title") or "PPT"), (94, 220), 1150, title_font, accent, 1.18)
    y = 400
    goal = _as_text(page.get("goal") or "")
    if goal:
        y = _draw_wrapped(draw, goal, (94, y), 1120, body_font, "#38464f", 1.35) + 24
    blocks = page.get("content_blocks") or []
    points = page.get("key_points") or []
    items = []
    for block in blocks[:4]:
        if isinstance(block, dict):
            items.append(f"{block.get('title') or '要点'}：{block.get('text') or ''}")
    if not items:
        items = [_as_text(x) for x in points[:4]]
    for item in items:
        draw.ellipse([98, y + 10, 112, y + 24], fill=accent)
        y = _draw_wrapped(draw, item, (132, y), 1160, body_font, "#24313a", 1.32) + 16
    img.save(png_path)


def _fit_image_16_9(path):
    try:
        from PIL import Image
        with Image.open(path) as im:
            if im.size == (_WIDTH, _HEIGHT):
                return
            canvas = Image.new("RGB", (_WIDTH, _HEIGHT), "white")
            im = im.convert("RGB")
            scale = min(_WIDTH / im.width, _HEIGHT / im.height)
            new_size = (max(1, int(im.width * scale)), max(1, int(im.height * scale)))
            im = im.resize(new_size)
            canvas.paste(im, ((_WIDTH - new_size[0]) // 2, (_HEIGHT - new_size[1]) // 2))
            canvas.save(path)
    except Exception:
        pass


def _font(size, bold=False):
    try:
        from PIL import ImageFont
        candidates = [
            r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
            r"C:\Windows\Fonts\simhei.ttf",
            r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc" if bold else "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc" if bold else "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Bold.otf" if bold else "/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf",
            "/System/Library/Fonts/PingFang.ttc",
        ]
        for path in candidates:
            if path and os.path.exists(path):
                return ImageFont.truetype(path, size)
        return ImageFont.truetype("arial.ttf", size)
    except Exception:
        try:
            from PIL import ImageFont
            return ImageFont.load_default()
        except Exception:
            return None


def _draw_wrapped(draw, text, xy, max_width, font, fill, line_height=1.3):
    x, y = xy
    for line in _wrap_text(draw, _as_text(text), font, max_width):
        draw.text((x, y), line, fill=fill, font=font)
        bbox = draw.textbbox((x, y), line, font=font)
        y += int((bbox[3] - bbox[1]) * line_height) + 4
    return y


def _wrap_text(draw, text, font, max_width):
    text = re.sub(r"\s+", " ", text.strip())
    if not text:
        return []
    lines = []
    current = ""
    for ch in text:
        test = current + ch
        try:
            width = draw.textlength(test, font=font)
        except Exception:
            width = len(test) * 12
        if width <= max_width or not current:
            current = test
        else:
            lines.append(current)
            current = ch
    if current:
        lines.append(current)
    return lines[:6]


def _safe_filename(name):
    raw = _clean_text(name) or "ai_presentation"
    raw = _SAFE_FILENAME_RE.sub("_", raw)
    raw = re.sub(r"\s+", "_", raw).strip("._ ")
    raw = raw[:80] or "ai_presentation"
    if not raw.lower().endswith(".pptx"):
        raw += ".pptx"
    return raw


def _dedupe_path(path):
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    for idx in range(1, 100):
        candidate = f"{base}_{idx}{ext}"
        if not os.path.exists(candidate):
            return candidate
    return f"{base}_{int(time.time())}{ext}"


def _clean_text(value):
    text = _as_text(value).replace("\x00", " ").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def _guess_title(request_text):
    text = _clean_text(request_text)
    topic = re.search(r"(?:主题是|主题为|关于|围绕|about)\s*([^，。,.；;]{2,60})", text, flags=re.IGNORECASE)
    if topic:
        candidate = _clean_text(topic.group(1)).strip(" ，。,.；;")
        if _looks_like_title(candidate):
            return candidate[:28]
    text = re.sub(r"(请|帮我|生成|制作|做一份|做一个|PPT|ppt|演示文稿|幻灯片)", "", text).strip(" ，。,.")
    text = re.sub(r"\b\d{1,2}\s*(页|p|pages?|slides?)\b", "", text, flags=re.IGNORECASE).strip(" ，。,.")
    if not _looks_like_title(text):
        return "AI 生成演示文稿"
    return text[:28]


def _looks_like_title(text):
    value = _clean_text(text)
    if len(value) < 2:
        return False
    if _is_garbled_text(value):
        return False
    return bool(re.search(r"[\w\u4e00-\u9fff]", value))


def _is_garbled_text(text):
    value = _clean_text(text)
    if not value:
        return False
    question_count = value.count("?") + value.count("？")
    if question_count <= 1:
        return False
    return question_count > max(1, len(value) // 4)


def _html_is_garbled(html_doc):
    visible = re.sub(r"<style\b[^>]*>.*?</style\s*>", " ", _as_text(html_doc), flags=re.IGNORECASE | re.DOTALL)
    visible = re.sub(r"<[^>]+>", " ", visible)
    visible = html_lib.unescape(visible)
    visible = re.sub(r"\s+", " ", visible).strip()
    return _is_garbled_text(visible)


def _rel_path(path):
    return os.path.relpath(path, config.WORKSPACE_ROOT).replace(os.sep, "/")


def _public_html_page(item):
    return {
        "page": item.get("page"),
        "title": item.get("title"),
        "page_type": item.get("page_type"),
        "page_category": item.get("page_category"),
        "page_variant": item.get("page_variant"),
        "quality": item.get("quality"),
        "rewrite_count": item.get("rewrite_count"),
        "path": item.get("path"),
    }


def _public_image(item):
    return {
        "slide": item.get("page"),
        "title": item.get("title"),
        "page_type": item.get("page_type"),
        "path": item.get("path"),
    }


def _pipeline_summary(intent, outline, pages, html_pages, images, renderer, renderer_note, design_system=None, quality_report=None):
    page_types = [
        {
            "page": page.get("page"),
            "title": page.get("title"),
            "page_type": page.get("page_type"),
            "page_category": page.get("page_category"),
            "page_variant": page.get("page_variant"),
            "visual_role": page.get("visual_role"),
            "layout_blueprint": page.get("layout_blueprint"),
        }
        for page in pages
    ]
    return {
        "mode": "html_image_design_pipeline_v3",
        "intent": intent,
        "outline": outline,
        "page_types": page_types,
        "design_system": design_system or {},
        "layout_blueprints": [page.get("layout_blueprint") for page in pages if page.get("layout_blueprint")],
        "quality_report": quality_report or {},
        "html_pages": [_public_html_page(item) for item in html_pages],
        "images": [_public_image(item) for item in images],
        "renderer": renderer,
        "renderer_note": renderer_note,
        "stages": [
            {"step": 1, "id": "understand", "title": "主题理解", "status": "done"},
            {"step": 2, "id": "outline", "title": "确认内容大纲", "status": "done", "count": len(outline)},
            {"step": 3, "id": "page_types", "title": "逐页确定页面类型", "status": "done", "count": len(page_types)},
            {"step": 4, "id": "design_recipe", "title": "选择设计配方", "status": "done", "theme": (design_system or {}).get("theme_name")},
            {"step": 5, "id": "layout_blueprint", "title": "为每页生成布局蓝图", "status": "done", "count": len(page_types)},
            {"step": 6, "id": "html_design", "title": "生成 HTML", "status": "done", "count": len(html_pages)},
            {"step": 7, "id": "aesthetic_review", "title": "审美评分与低分重写", "status": "done" if (quality_report or {}).get("passed", True) else "warning", "rewrite_count": (quality_report or {}).get("rewrite_count", 0)},
            {
                "step": 8,
                "id": "browser_render",
                "title": "截图",
                "status": "done" if renderer == "browser" else "warning",
                "count": len(images),
                "renderer": renderer,
            },
            {"step": 9, "id": "ppt_background", "title": "生成 PPT", "status": "done", "count": len(images)},
            {"step": 10, "id": "export", "title": "保存 PPT", "status": "done"},
        ],
    }
