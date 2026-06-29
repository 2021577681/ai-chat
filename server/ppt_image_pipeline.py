"""HTML-to-image PPT generation pipeline.

This is the new high-level PPT mode:
user request -> outline -> page types -> HTML pages -> browser screenshots ->
one full-slide image per PPT page.
"""

import base64
import html as html_lib
import json
import mimetypes
import os
import re
import shutil
import subprocess
import time
import zipfile
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
_PROJECT_TEMPLATE_ROOT = Path(__file__).resolve().parent / "ppt_templates" / "project"
_PROJECT_TEMPLATE_SYSTEM = "project"
_PROJECT_SKILL_PROMPT_CACHE = None
_SLIDE_SECTION_RE = re.compile(r"<section\b[^>]*>.*?</section\s*>", re.IGNORECASE | re.DOTALL)


DEFAULT_UNDERSTAND_PROMPT = """你是 项目 PPT 工作流 的演示策划总监。请理解用户要做的 PPT 主题、内容、用途、受众和语气，并为 PPT 自动命名。
只输出 JSON，不要解释。输出结构：
{
  "title": "PPT 标题",
  "subtitle": "可选副标题",
  "purpose": "用途",
  "audience": "受众",
  "language": "主要语言",
  "tone": "叙事语气",
  "visual_direction": "整体视觉方向",
  "filename": "AI 自动命名的 pptx 文件名",
  "needs_clarification": false,
  "clarifying_question": "",
  "clarifying_questions": []
}
要求：
1. 默认使用项目 PPT 工作流，不再走旧的通用 PPT 生成逻辑。
2. visual_direction 必须明确推荐 style_a_magazine 或 style_b_swiss，并说明推荐理由：人文/行业观察/故事/照片优先 style_a_magazine；AI/技术/工程/数据/KPI/产品发布优先 style_b_swiss。
3. 如果用户明确指定“杂志风/电子墨水/Monocle”，选择 style_a_magazine；如果指定“瑞士风/Swiss/Helvetica/网格/数据驱动”，选择 style_b_swiss。
4. filename 必须贴合主题，使用安全文件名，并以 .pptx 结尾。
5. 只有当缺少会实质影响内容或素材使用的关键信息时，才把 needs_clarification 设为 true，并给出最多 3 个具体问题；不要为了普通偏好反复打断流程。"""


DEFAULT_OUTLINE_PROMPT = """你是 项目 PPT 工作流 的内容策划专家。请根据用户需求和理解结果生成 PPT 大纲。
只输出 JSON，不要解释。输出结构：
{"outline":[{"page":1,"title":"页面标题","goal":"本页沟通目标","key_points":["要点1","要点2"]}]}
要求：
1. 页数必须等于 target_slide_count。
2. 每页标题具体，避免泛泛而谈。
3. 使用 项目演示叙事弧组织内容：Hook -> Context -> Core -> Shift -> Takeaway。
4. 大纲阶段只决定叙事顺序和每页沟通目标，不写 HTML 坐标，但要为后续 layout 选择保留足够明确的内容形状。
5. 避免每页都是“标题 + 三要点”；至少安排封面、1 个强视觉/数据/问题页、1 个转折页和结尾页。"""


DEFAULT_PAGE_TYPE_PROMPT = """你是 项目 PPT 工作流 的信息架构设计师。请为大纲中的每一页确定页面类型、内容结构和模板版式。
只输出 JSON，不要解释。输出结构：
{"pages":[{"page":1,"title":"页面标题","page_type":"cover|agenda|section|concept|comparison|data_story|process|timeline|case|quote|summary|closing|freeform","visual_role":"本页视觉承担的任务","template_style":"magazine|swiss","layout_id":"A01|A02|A03|A04|A05|A06|A07|A08|A09|A10|SWISS-COVER-ASCII|SWISS-CLOSING-ASCII|S01|...|S22","theme_class":"hero dark|hero light|light|dark|grey|accent|split","image_slots":[{"slot":"s22-hero-21x9","ratio":"21:9","purpose":"图片用途"}],"content_blocks":[{"title":"模块名","text":"模块内容"}]}]}
要求：
1. pages 数量必须和大纲一致。
2. template_style 必须跟随输入的 template_style，不要一份 deck 混用 magazine 和 swiss。
3. magazine 只能使用 A01-A10；swiss 正文页只能使用 S01-S22，首页/尾页可用 SWISS-COVER-ASCII / SWISS-CLOSING-ASCII。
4. 版式要多样：不要连续 3 页使用同一主体结构；10 页以上至少 8 个不同 layout_id。
5. magazine 每页 theme_class 必须是 hero dark / hero light / light / dark 之一，并规划明暗节奏；swiss 使用 grey / dark / accent / split 等模板已有 class。
6. 只有 ppt_interaction_context.source_materials.image_assets 存在真实图片时，才允许选择 S22 或填写 image_slots；没有真实图片时 image_slots 必须为空，不要规划“建议配图”或虚构图片路径。
7. swiss 的 split 只允许用于 SWISS-CLOSING-ASCII、S03、S10 这类半屏结构；S22、S04、S06、S11 等普通网格页禁止 theme_class=split。"""


DEFAULT_HTML_PROMPT = """你是 项目 PPT 工作流 的 HTML slide section 生成器。请为单页 PPT 生成可插入模板的 <section class="slide ...">。
只输出 JSON，不要解释。输出结构：{"html":"<section class=\\"slide ...\\">...</section>"}
硬性要求：
1. 不要输出 <!doctype>、<html>、<head>、<body>、<style> 或 <script>；后端会把 section 填入已复制的 项目 HTML 模板。
2. 必须使用输入中的 template_context、layout_id、theme_class 和 allowed_classes；不要发明模板里不存在的 class，必要时只用 inline style 微调。
3. magazine 风格使用 template.html 的衬线标题、chrome、foot、h-hero/h-xl/lead/stat-card/pipeline/frame-img/grid-* 等类；section class 必须包含 light/dark/hero light/hero dark。
4. swiss 风格使用 template-swiss.html 的无衬线、12 栏、canvas-card、chrome-min、t-*、card-*、grid-12、span-N 等类；每个 section 必须带 data-layout，且只用登记版式。
5. swiss 禁止渐变、阴影、圆角、多 accent 色和 SVG 文字；magazine 避免普通网页卡片感，依靠大字号、留白、衬线/非衬线对比和图片/数据节奏。
6. 内容必须完整但不拥挤，投屏可读：中文正文不小于 16px，重要说明不小于 18px。
7. 不要使用 emoji；图标只用模板支持的 Lucide 写法或用文字/线条表达。
8. 如果本页没有真实图片，不要凭空引用 images/*.jpg/png/webp；只能使用 ppt_interaction_context.source_materials.image_assets 中已有的 html_src。没有真实图片时，用模板图形、数据、文字和占位结构完成页面。
9. swiss 的 split 只适用于 split-half 半屏结构；如果不是 SWISS-CLOSING-ASCII/S03/S10，不要在 section class 中写 split。"""


_PROJECT_MAGAZINE_LAYOUTS = [
    {"id": "A01", "name": "Hero Cover", "use": "开场封面 / 强钩子"},
    {"id": "A02", "name": "Section Divider", "use": "章节幕封 / 叙事转场"},
    {"id": "A03", "name": "Data Hero", "use": "单个大数据 / 关键事实"},
    {"id": "A04", "name": "Quote + Image", "use": "左文右图 / 人物故事"},
    {"id": "A05", "name": "Image Grid", "use": "多图证据 / 截图对照"},
    {"id": "A06", "name": "Pipeline", "use": "流程 / 方法 / 步骤"},
    {"id": "A07", "name": "Question", "use": "问题页 / 悬念 / 转折"},
    {"id": "A08", "name": "Big Quote", "use": "金句 / 核心 takeaway"},
    {"id": "A09", "name": "Before After", "use": "并列对比"},
    {"id": "A10", "name": "Lead Image + Side Text", "use": "图文混排 / 案例解释"},
]

_PROJECT_SWISS_LAYOUTS = [
    {"id": "SWISS-COVER-ASCII", "name": "ASCII Cover", "use": "新增首页"},
    {"id": "S01", "name": "Index Cover", "use": "原始索引封面 / 目录"},
    {"id": "S02", "name": "Vertical Timeline + KPI", "use": "演化 / 年代 / 阶段对比"},
    {"id": "S03", "name": "Split Statement", "use": "核心论点 / 左右分屏"},
    {"id": "S04", "name": "Six Cells", "use": "六项概念定义"},
    {"id": "S05", "name": "Three Layers", "use": "三层架构"},
    {"id": "S06", "name": "KPI Tower", "use": "四项数据高度差"},
    {"id": "S07", "name": "Horizontal Bar", "use": "排名 / 横向条形图"},
    {"id": "S08", "name": "Duo Compare", "use": "Before/After 对照"},
    {"id": "S09", "name": "Dot Matrix Statement", "use": "大引述 / statement"},
    {"id": "S11", "name": "Horizontal Timeline", "use": "4-7 步流程"},
    {"id": "S12", "name": "Manifesto + Ink Banner", "use": "阶段性结论"},
    {"id": "S13", "name": "Three Forces", "use": "三个对等概念"},
    {"id": "S14", "name": "Loop Form", "use": "闭环 / 自动化"},
    {"id": "S15", "name": "Matrix + Hero Stat", "use": "矩阵 + 总数据 / 多图格"},
    {"id": "S16", "name": "Multi-card Brief", "use": "6 项快讯 / 多图卡"},
    {"id": "S17", "name": "System Diagram", "use": "系统图 / 生态图"},
    {"id": "S18", "name": "Why Now", "use": "三论点 + 底部巨数"},
    {"id": "S19", "name": "Four Cards", "use": "四项等权特性"},
    {"id": "S20", "name": "Stacked KPI Ledger", "use": "账单式纵向数据"},
    {"id": "S21", "name": "Tech Spec Sheet", "use": "规格 / benchmark"},
    {"id": "S22", "name": "Image Hero", "use": "21:9 主图 + KPI"},
    {"id": "SWISS-CLOSING-ASCII", "name": "ASCII Closing", "use": "新增尾页"},
]

_PROJECT_MAGAZINE_THEME_VARS = {
    "ink_classic": {
        "label": "墨水经典",
        "palette": ["#0a0a0b", "#f1efea", "#e8e5de", "#18181a"],
        "vars": {
            "ink": "#0a0a0b", "ink-rgb": "10,10,11", "paper": "#f1efea", "paper-rgb": "241,239,234",
            "paper-tint": "#e8e5de", "ink-tint": "#18181a",
        },
    },
    "indigo_porcelain": {
        "label": "靛蓝瓷",
        "palette": ["#0a1f3d", "#f1f3f5", "#e4e8ec", "#152a4a"],
        "vars": {
            "ink": "#0a1f3d", "ink-rgb": "10,31,61", "paper": "#f1f3f5", "paper-rgb": "241,243,245",
            "paper-tint": "#e4e8ec", "ink-tint": "#152a4a",
        },
    },
    "forest_ink": {
        "label": "森林墨",
        "palette": ["#1a2e1f", "#f5f1e8", "#ece7da", "#253d2c"],
        "vars": {
            "ink": "#1a2e1f", "ink-rgb": "26,46,31", "paper": "#f5f1e8", "paper-rgb": "245,241,232",
            "paper-tint": "#ece7da", "ink-tint": "#253d2c",
        },
    },
    "kraft_paper": {
        "label": "牛皮纸",
        "palette": ["#2a1e13", "#eedfc7", "#e0d0b6", "#3a2a1d"],
        "vars": {
            "ink": "#2a1e13", "ink-rgb": "42,30,19", "paper": "#eedfc7", "paper-rgb": "238,223,199",
            "paper-tint": "#e0d0b6", "ink-tint": "#3a2a1d",
        },
    },
    "dune": {
        "label": "沙丘",
        "palette": ["#1f1a14", "#f0e6d2", "#e3d7bf", "#2d2620"],
        "vars": {
            "ink": "#1f1a14", "ink-rgb": "31,26,20", "paper": "#f0e6d2", "paper-rgb": "240,230,210",
            "paper-tint": "#e3d7bf", "ink-tint": "#2d2620",
        },
    },
}

_PROJECT_SWISS_THEME_VARS = {
    "ikb": {
        "label": "克莱因蓝",
        "palette": ["#fafaf8", "#0a0a0a", "#f0f0ee", "#d4d4d2", "#002FA7"],
        "vars": {
            "paper": "#fafaf8", "paper-rgb": "250,250,248", "ink": "#0a0a0a", "ink-rgb": "10,10,10",
            "grey-1": "#f0f0ee", "grey-2": "#d4d4d2", "grey-3": "#737373",
            "accent": "#002FA7", "accent-rgb": "0,47,167", "accent-on": "#ffffff",
        },
    },
    "lemon": {
        "label": "柠檬黄",
        "palette": ["#fafaf8", "#0a0a0a", "#f0f0ee", "#d4d4d2", "#FFD500"],
        "vars": {
            "paper": "#fafaf8", "paper-rgb": "250,250,248", "ink": "#0a0a0a", "ink-rgb": "10,10,10",
            "grey-1": "#f0f0ee", "grey-2": "#d4d4d2", "grey-3": "#737373",
            "accent": "#FFD500", "accent-rgb": "255,213,0", "accent-on": "#0a0a0a",
        },
    },
    "lemon_green": {
        "label": "柠檬绿",
        "palette": ["#fafaf8", "#0a0a0a", "#f0f0ee", "#d4d4d2", "#C5E803"],
        "vars": {
            "paper": "#fafaf8", "paper-rgb": "250,250,248", "ink": "#0a0a0a", "ink-rgb": "10,10,10",
            "grey-1": "#f0f0ee", "grey-2": "#d4d4d2", "grey-3": "#737373",
            "accent": "#C5E803", "accent-rgb": "197,232,3", "accent-on": "#0a0a0a",
        },
    },
    "safety_orange": {
        "label": "安全橙",
        "palette": ["#fafaf8", "#0a0a0a", "#f0f0ee", "#d4d4d2", "#FF6B35"],
        "vars": {
            "paper": "#fafaf8", "paper-rgb": "250,250,248", "ink": "#0a0a0a", "ink-rgb": "10,10,10",
            "grey-1": "#f0f0ee", "grey-2": "#d4d4d2", "grey-3": "#737373",
            "accent": "#FF6B35", "accent-rgb": "255,107,53", "accent-on": "#ffffff",
        },
    },
}

_PROJECT_MAGAZINE_ALLOWED_CLASSES = [
    "slide", "hero", "light", "dark", "chrome", "foot", "kicker", "display", "display-zh", "h-hero",
    "h-xl", "h-sub", "h-md", "lead", "meta-row", "stat-card", "stat-label", "stat-nb", "stat-unit",
    "stat-note", "pipeline-section", "pipeline-label", "pipeline", "step", "step-nb", "step-title",
    "step-desc", "grid-2-7-5", "grid-2-6-6", "grid-2-8-4", "grid-3-3", "grid-6", "grid-3",
    "grid-4", "frame", "frame-img", "fit-contain", "r-16x10", "r-4x3", "r-16x9", "r-3x2",
    "r-1x1", "h-22", "h-26", "img-cap", "callout", "callout-src", "tag", "rule",
]

_PROJECT_SWISS_ALLOWED_CLASSES = [
    "slide", "accent", "dark", "grey", "split", "canvas-card", "chrome-min", "ascii-bg", "grid-12",
    "span-2", "span-3", "span-4", "span-5", "span-6", "span-7", "span-8", "span-9", "span-10",
    "t-cat", "t-meta", "t-helper", "t-body", "t-body-sm", "lead", "h-hero", "h-statement", "h-xl",
    "h-md", "num-mega", "mono", "card-ink", "card-accent", "card-fill", "card-outlined",
    "accent-block", "dot-mat", "ring-mat", "cross-mat", "hr-hairline", "timeline-v", "timeline-h",
    "tl-node", "tl-axis", "duo-compare", "vrule", "manifesto-top", "ink-banner-full", "three-forces",
    "loop-diagram", "matrix-fill", "matrix-cell", "brief-grid", "brief-card", "system-diagram",
    "why-now-grid", "four-cards", "stacked-ledger", "ledger-row", "tech-spec", "image-hero",
    "hero-img-wrap", "hero-overlay-block", "hero-stats", "frame-img", "fit-contain", "r-21x9",
    "r-16x9", "r-16x10", "swiss-img-caption", "swiss-keyline", "swiss-lined",
]


def _emit_progress(progress, **event):
    if callable(progress):
        try:
            progress(event)
        except Exception:
            pass


def _run_checkpoint(checkpoint, label="", request_input=None):
    if callable(checkpoint):
        try:
            return checkpoint(label, request_input=request_input)
        except TypeError:
            return checkpoint(label)
    return None


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

        options = data if isinstance(data, dict) else dict(data or {})
        editable_text = _truthy(options.get("ppt_editable_text", options.get("editable_text_overlay", False)))
        request_text = _as_text(options.get("user_request") or options.get("request") or options.get("prompt")).strip()
        if not request_text:
            return {"ok": False, "error": "user_request 不能为空"}

        target_count = _normalize_slide_count(options.get("slide_count") or options.get("pages"), request_text)
        run_slug = f"{time.strftime('%Y%m%d_%H%M%S')}_{time.time_ns() % 1000000:06d}"
        work_base, err = check_path_or_error(os.path.join("output", "ppt_image_pipeline", run_slug), must_exist=False)
        if err:
            return {"ok": False, "error": err}
        html_dir = os.path.join(work_base, "html")
        image_dir = os.path.join(work_base, "images")
        os.makedirs(html_dir, exist_ok=True)
        os.makedirs(image_dir, exist_ok=True)
        _refresh_ppt_source_materials(options, html_dir, request_text)

        input_request = _initial_ppt_input_request(request_text, options)
        if input_request:
            _run_checkpoint(checkpoint, "clarify", request_input=input_request)
            _refresh_ppt_source_materials(options, html_dir, request_text)

        _emit_stage_start(progress, checkpoint, "understand", "正在理解 PPT 主题、用途、受众与文件名。", {"target_slide_count": target_count})
        _refresh_ppt_source_materials(options, html_dir, request_text)
        intent = _understand_request(request_text, target_count, options)
        if intent.get("needs_clarification") and not _ppt_guidance_items(options):
            questions = [q for q in (intent.get("clarifying_questions") or []) if q][:3]
            question = intent.get("clarifying_question") or (questions[0] if questions else "")
            _run_checkpoint(checkpoint, "clarify", request_input={
                "stage": "clarify",
                "message": question or "PPT 生成需要你补充关键信息后再继续。",
                "questions": questions or [question or "请补充 PPT 的受众、用途、关键素材或必须遵守的风格要求。"],
            })
            _refresh_ppt_source_materials(options, html_dir, request_text)
            intent = _understand_request(request_text, target_count, options)
        _emit_stage_done(progress, "understand", f"已理解主题：{intent.get('title') or '未命名'}。", {"title": intent.get("title"), "filename": intent.get("filename")})

        _emit_stage_start(progress, checkpoint, "outline", "正在确认内容大纲与叙事顺序。", {"target_slide_count": target_count})
        _refresh_ppt_source_materials(options, html_dir, request_text)
        outline = _plan_outline(request_text, intent, target_count, options)
        _emit_stage_done(progress, "outline", f"已确认 {len(outline)} 页内容大纲。", {"pages": len(outline)})

        _emit_stage_start(progress, checkpoint, "page_types", "正在逐页确定页面类型：封面页、目录页、内容页。", {"outline_pages": len(outline)})
        _refresh_ppt_source_materials(options, html_dir, request_text)
        pages = _plan_page_types(request_text, intent, outline, options)
        pages = _enforce_page_categories(pages, target_count)
        _emit_stage_done(progress, "page_types", f"已为 {len(pages)} 页逐页确定页面类型。", {"pages": len(pages), "categories": _count_page_categories(pages)})

        _emit_stage_start(progress, checkpoint, "design_recipe", "正在选择 模板风格与主题色。", {"pages": len(pages)})
        _refresh_ppt_source_materials(options, html_dir, request_text)
        design_system = _build_design_system(request_text, intent, pages, options)
        _emit_stage_done(progress, "design_recipe", f"已选择 模板风格：{design_system.get('style_label') or 'custom'} / {design_system.get('theme_label') or design_system.get('theme_name') or ''}。", {"design_system": design_system})

        _emit_stage_start(progress, checkpoint, "layout_blueprint", "正在为每页绑定 项目 PPT 登记版式与主题节奏。", {"pages": len(pages)})
        _refresh_ppt_source_materials(options, html_dir, request_text)
        if design_system.get("guidance_version") != options.get("_ppt_guidance_version"):
            design_system = _build_design_system(request_text, intent, pages, options)
        blueprints = _build_layout_blueprints(pages, design_system)
        _emit_stage_done(progress, "layout_blueprint", f"已完成 {len(blueprints)} 页 项目版式蓝图。", {"pages": len(blueprints), "template_style": design_system.get("template_style")})

        _emit_stage_start(progress, checkpoint, "html", "正在根据布局蓝图生成每页 HTML 设计稿。", {"pages": len(pages)})
        _refresh_ppt_source_materials(options, html_dir, request_text)
        if design_system.get("guidance_version") != options.get("_ppt_guidance_version"):
            design_system = _build_design_system(request_text, intent, pages, options)
        html_pages = _generate_html_pages(request_text, intent, pages, html_dir, options, design_system, progress=progress, checkpoint=checkpoint)
        _emit_stage_done(progress, "html", f"已生成 {len(html_pages)} 页 HTML 设计稿。", {"pages": len(html_pages), "html_dir": _rel_path(html_dir)})

        _emit_stage_start(progress, checkpoint, "quality_review", "正在按 项目模板规则进行静态检查。", {"pages": len(html_pages)})
        quality_report = _validate_project_html_pages(html_pages, design_system, progress, checkpoint=checkpoint)
        _emit_stage_done(progress, "quality_review", _quality_summary_text(quality_report), {"quality_report": quality_report})

        render_message = "正在截图无文字背景并提取可编辑文本。" if editable_text else "正在将 HTML 页面截图为 16:9 图片。"
        _emit_stage_start(progress, checkpoint, "render", render_message, {"pages": len(html_pages), "editable_text": editable_text})
        images, renderer, renderer_note = _render_html_pages(html_pages, image_dir, checkpoint=checkpoint, editable_text=editable_text)
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
            if editable_text:
                _add_editable_text_overlays(slide, image.get("text_items") or [], prs.slide_width, prs.slide_height)

        parent = os.path.dirname(out_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        _emit_stage_start(progress, checkpoint, "saved", "正在保存 PPTX 文件。", {"filename": os.path.basename(out_path)})
        prs.save(out_path)
        _emit_stage_done(progress, "saved", "PPTX 文件已保存。", {"path": _rel_path(out_path), "filename": os.path.basename(out_path)})

        rel_path = _rel_path(out_path)
        pipeline = _pipeline_summary(intent, outline, pages, html_pages, images, renderer, renderer_note, design_system, quality_report, options)
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
            "editable_text": editable_text,
            "pipeline": pipeline,
            "message": f"PPT 已按图片页流程生成：{rel_path}",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _as_text(value, default=""):
    if value is None:
        return default
    return str(value)


def _truthy(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value or "").strip().lower() in ("1", "true", "yes", "y", "on", "enabled")


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


_PPT_MATERIAL_EXTS = (
    "png", "jpg", "jpeg", "webp", "gif", "svg",
    "txt", "md", "csv", "json", "log", "xml", "html", "htm",
    "docx", "pptx", "xlsx", "pdf",
)
_PPT_IMAGE_EXTS = {"png", "jpg", "jpeg", "webp", "gif", "svg"}
_PPT_TEXT_EXTS = {"txt", "md", "csv", "json", "log", "xml", "html", "htm"}
_PPT_OFFICE_EXTS = {"docx", "pptx", "xlsx"}
_PPT_PATH_RE = re.compile(
    r'["“”\']([^"“”\']+\.(' + "|".join(_PPT_MATERIAL_EXTS) + r'))["“”\']'
    r'|([A-Za-z]:[\\/][^\s,;，。；]+?\.(' + "|".join(_PPT_MATERIAL_EXTS) + r'))'
    r'|((?:\.{1,2}[\\/])?[^\s,;，。；]+[\\/][^\s,;，。；]+?\.(' + "|".join(_PPT_MATERIAL_EXTS) + r'))',
    re.IGNORECASE,
)
_DATA_URL_RE = re.compile(r"^data:([^;,]+)?(;base64)?,(.*)$", re.IGNORECASE | re.DOTALL)


def _clip_text(text, max_chars=4000):
    text = _as_text(text).strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n...[truncated]"


def _safe_asset_name(name, fallback):
    stem = _SAFE_FILENAME_RE.sub("_", _as_text(name or fallback, fallback)).strip(" ._")
    return stem or fallback


def _ext_from_name(name):
    return os.path.splitext(_as_text(name))[1].lower().lstrip(".")


def _ext_from_mime(mime, default="bin"):
    mime = _as_text(mime).split(";")[0].strip().lower()
    mapped = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/svg+xml": "svg",
        "text/plain": "txt",
        "text/markdown": "md",
        "text/csv": "csv",
        "application/json": "json",
        "application/pdf": "pdf",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    }
    if mime in mapped:
        return mapped[mime]
    guessed = mimetypes.guess_extension(mime or "") or ""
    return guessed.lstrip(".") or default


def _decode_text_bytes(raw):
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return raw.decode(enc)
        except Exception:
            pass
    return raw.decode("utf-8", errors="ignore")


def _read_text_file_excerpt(path, max_chars=8000):
    with open(path, "rb") as f:
        raw = f.read(max_chars * 4)
    return _clip_text(_decode_text_bytes(raw), max_chars)


def _strip_xml_text(xml_text):
    text = re.sub(r"<[^>]+>", " ", _as_text(xml_text))
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _extract_office_text(path, ext, max_chars=8000):
    if not zipfile.is_zipfile(path):
        return ""
    wanted = []
    with zipfile.ZipFile(path) as zf:
        for name in zf.namelist():
            lower = name.lower()
            if ext == "docx" and lower.startswith("word/") and lower.endswith(".xml"):
                wanted.append(name)
            elif ext == "pptx" and lower.startswith("ppt/slides/") and lower.endswith(".xml"):
                wanted.append(name)
            elif ext == "xlsx" and (
                lower == "xl/sharedstrings.xml"
                or (lower.startswith("xl/worksheets/") and lower.endswith(".xml"))
            ):
                wanted.append(name)
        parts = []
        total = 0
        for name in wanted[:80]:
            try:
                text = _strip_xml_text(_decode_text_bytes(zf.read(name)))
            except Exception:
                continue
            if not text:
                continue
            parts.append(text)
            total += len(text)
            if total >= max_chars:
                break
    return _clip_text("\n".join(parts), max_chars)


def _parse_data_url(data_url):
    m = _DATA_URL_RE.match(_as_text(data_url).strip())
    if not m:
        return None
    mime = (m.group(1) or "").strip() or "application/octet-stream"
    payload = m.group(3) or ""
    try:
        raw = base64.b64decode(payload, validate=False) if m.group(2) else payload.encode("utf-8")
    except Exception:
        return None
    return {"mime": mime, "raw": raw}


def _unique_asset_path(asset_dir, base_name):
    os.makedirs(asset_dir, exist_ok=True)
    name = _safe_asset_name(base_name, "asset")
    stem, ext = os.path.splitext(name)
    if not ext:
        ext = ".bin"
    candidate = os.path.join(asset_dir, stem + ext)
    idx = 2
    while os.path.exists(candidate):
        candidate = os.path.join(asset_dir, f"{stem}_{idx}{ext}")
        idx += 1
    return candidate


def _material_item_from_path(path_value, asset_dir, source="path"):
    path_text = _as_text(path_value).strip().strip('"').strip("'")
    if not path_text:
        return None, None
    abs_path, err = check_path_or_error(path_text, must_exist=True)
    if err:
        return None, err
    if os.path.isdir(abs_path):
        return None, f"path is a directory: {path_text}"
    ext = _ext_from_name(abs_path)
    name = os.path.basename(abs_path)
    item = {"source": source, "name": name, "workspace_path": _rel_path(abs_path), "ext": ext}
    try:
        if ext in _PPT_IMAGE_EXTS:
            dst = _unique_asset_path(asset_dir, name)
            shutil.copy2(abs_path, dst)
            item.update({"kind": "image", "asset_path": _rel_path(dst), "html_src": "images/" + os.path.basename(dst)})
        elif ext in _PPT_TEXT_EXTS:
            item.update({"kind": "text", "text_excerpt": _read_text_file_excerpt(abs_path)})
        elif ext in _PPT_OFFICE_EXTS:
            item.update({"kind": "office", "text_excerpt": _extract_office_text(abs_path, ext)})
        else:
            item.update({"kind": "file", "note": "File is available by path, but text extraction is not supported for this type."})
    except Exception as exc:
        item.update({"kind": "file", "warning": str(exc)})
    return item, None


def _material_item_from_attachment(att, asset_dir, index=0):
    if not isinstance(att, dict):
        return None
    name = _as_text(att.get("name") or att.get("filename") or f"attachment_{index}")
    mime = _as_text(att.get("mime") or "")
    path_value = att.get("path") or att.get("workspace_path")
    if path_value:
        item, err = _material_item_from_path(path_value, asset_dir, source="attachment_path")
        if item:
            item["name"] = name or item.get("name")
            return item
        return {"source": "attachment_path", "name": name, "kind": "unreadable", "warning": err}
    if att.get("text"):
        return {"source": "attachment", "name": name, "kind": "text", "mime": mime, "text_excerpt": _clip_text(att.get("text"), 8000)}
    parsed = _parse_data_url(att.get("data"))
    if not parsed:
        return {"source": "attachment", "name": name, "kind": "file", "mime": mime, "note": "Attachment has no readable text payload."}
    mime = parsed.get("mime") or mime
    ext = _ext_from_name(name) or _ext_from_mime(mime)
    safe_name = name if _ext_from_name(name) else f"{name}.{ext}"
    raw = parsed["raw"]
    if ext in _PPT_IMAGE_EXTS or mime.startswith("image/"):
        dst = _unique_asset_path(asset_dir, safe_name)
        with open(dst, "wb") as f:
            f.write(raw)
        return {"source": "attachment", "name": name, "kind": "image", "mime": mime, "asset_path": _rel_path(dst), "html_src": "images/" + os.path.basename(dst)}
    if ext in _PPT_TEXT_EXTS or mime.startswith("text/") or mime == "application/json":
        return {"source": "attachment", "name": name, "kind": "text", "mime": mime, "text_excerpt": _clip_text(_decode_text_bytes(raw), 8000)}
    if ext in _PPT_OFFICE_EXTS:
        dst = _unique_asset_path(asset_dir, safe_name)
        with open(dst, "wb") as f:
            f.write(raw)
        return {"source": "attachment", "name": name, "kind": "office", "mime": mime, "asset_path": _rel_path(dst), "text_excerpt": _extract_office_text(dst, ext)}
    return {"source": "attachment", "name": name, "kind": "file", "mime": mime, "note": "Attachment was received, but this file type is not text-extracted."}


def _material_cache_key_for_attachment(att, index=0):
    if not isinstance(att, dict):
        return ""
    if att.get("id"):
        return "attachment_id:" + _as_text(att.get("id"))
    path_value = att.get("path") or att.get("workspace_path")
    if path_value:
        return "attachment_path:" + _as_text(path_value).strip()
    name = _as_text(att.get("name") or att.get("filename") or f"attachment_{index}")
    size = _as_text(att.get("size") or "")
    mime = _as_text(att.get("mime") or "")
    data = _as_text(att.get("data") or "")
    if data:
        return f"attachment_data:{name}:{size}:{mime}:{len(data)}"
    text = _as_text(att.get("text") or "")
    if text:
        return f"attachment_text:{name}:{size}:{mime}:{len(text)}"
    return f"attachment:{index}:{name}:{size}:{mime}"


def _cached_material(options, key, factory):
    cache = options.setdefault("_ppt_material_cache", {}) if isinstance(options, dict) else {}
    if key and isinstance(cache.get(key), dict):
        return dict(cache[key])
    material = factory()
    if key and isinstance(material, dict) and material.get("kind") != "unreadable":
        cache[key] = dict(material)
    return material


def _ppt_guidance_items(options):
    raw = (options or {}).get("_ppt_user_guidance") or (options or {}).get("ppt_user_guidance") or []
    if isinstance(raw, dict):
        raw = [raw]
    return [item for item in raw if isinstance(item, dict)]


def _ppt_guidance_text(options, max_chars=6000):
    parts = []
    for item in _ppt_guidance_items(options):
        msg = _as_text(item.get("message") or item.get("text") or item.get("guidance")).strip()
        if msg:
            parts.append(msg)
    return _clip_text("\n\n".join(parts), max_chars)


def _extract_material_paths(text):
    paths = []
    seen = set()
    for m in _PPT_PATH_RE.finditer(_as_text(text)):
        value = next((g for g in m.groups() if g and "." in g), "")
        value = value.strip()
        if value and value not in seen:
            seen.add(value)
            paths.append(value)
    return paths


def _refresh_ppt_source_materials(options, html_dir, request_text):
    options = options if isinstance(options, dict) else {}
    asset_dir = os.path.join(html_dir, "images")
    items = []
    warnings = []
    seen_paths = set()
    attachments = [att for att in (options.get("attachments") or []) if isinstance(att, dict)]
    for item in _ppt_guidance_items(options):
        attachments.extend(att for att in (item.get("attachments") or []) if isinstance(att, dict))
    for idx, att in enumerate(attachments[:30], start=1):
        key = _material_cache_key_for_attachment(att, idx)
        material = _cached_material(options, key, lambda att=att, idx=idx: _material_item_from_attachment(att, asset_dir, idx))
        if material:
            items.append(material)
    path_sources = [_as_text(request_text)]
    path_sources.extend(_as_text(item.get("message") or "") for item in _ppt_guidance_items(options))
    for source_text in path_sources:
        for path_value in _extract_material_paths(source_text):
            if path_value in seen_paths:
                continue
            seen_paths.add(path_value)
            key = "user_path:" + path_value
            cached = _cached_material(options, key, lambda path_value=path_value: (_material_item_from_path(path_value, asset_dir, source="user_path")[0]))
            item, err = cached, None
            if not item:
                item, err = _material_item_from_path(path_value, asset_dir, source="user_path")
            if item:
                items.append(item)
            elif err:
                warnings.append({"path": path_value, "warning": err})
    materials = {
        "items": items[:40],
        "warnings": warnings[:20],
        "image_assets": [x for x in items if x.get("kind") == "image"][:20],
        "text_items": [x for x in items if x.get("text_excerpt")][:20],
    }
    options["_ppt_source_materials"] = materials
    return materials


def _ppt_prompt_context(options):
    guidance = []
    for item in _ppt_guidance_items(options):
        attachments = []
        for att in item.get("attachments") or []:
            if isinstance(att, dict):
                attachments.append({
                    "name": att.get("name"),
                    "type": att.get("type"),
                    "mime": att.get("mime"),
                    "size": att.get("size"),
                    "path": att.get("path"),
                    "has_text": bool(att.get("text")),
                    "has_data": bool(att.get("data")),
                })
        guidance.append({"message": item.get("message") or "", "source": item.get("source") or "user", "attachments": attachments})
    return {
        "user_guidance": guidance,
        "source_materials": options.get("_ppt_source_materials") or {},
        "guidance_rule": "Treat the latest user guidance as authoritative for all unfinished PPT stages. If it conflicts with earlier planning, prefer the latest guidance.",
        "image_rule": "When source_materials contains image items with html_src, use that exact images/... path for real user-provided images instead of inventing image paths.",
    }


def _initial_ppt_input_request(request_text, options):
    if _ppt_guidance_items(options):
        return None
    materials = (options or {}).get("_ppt_source_materials") or {}
    if materials.get("items"):
        return None
    raw = _as_text(request_text)
    lower = raw.lower()
    material_terms = [
        "附件", "文件", "图片", "截图", "照片", "图表", "数据", "表格", "csv", "excel",
        "xlsx", "pdf", "pptx", "报告", "论文", "素材", "根据这个", "按这个",
    ]
    if not any(term in lower or term in raw for term in material_terms):
        return None
    if _extract_material_paths(raw):
        return None
    return {
        "stage": "clarify",
        "message": "检测到这份 PPT 可能依赖图片、数据或文件素材，但当前没有收到可读取的素材。请补充附件、workspace 内路径或说明；如果不需要素材，直接继续即可。",
        "questions": [
            "是否有必须插入的图片、截图、表格或旧 PPT？",
            "是否有指定受众、演讲时长、页数或禁用风格？",
            "如果素材在本地，请给 workspace 内路径，或直接粘贴/拖入文件。",
        ],
    }


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
        "ppt_interaction_context": _ppt_prompt_context(options),
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
    raw_questions = data.get("clarifying_questions") or data.get("questions") or []
    if not isinstance(raw_questions, list):
        raw_questions = [raw_questions]
    clarifying_questions = []
    for q in raw_questions:
        text = _clean_text(q if not isinstance(q, dict) else q.get("question") or q.get("text"))[:180]
        if text and not _is_garbled_text(text):
            clarifying_questions.append(text)
    clarifying_question = _clean_text(data.get("clarifying_question") or data.get("question"))[:180]
    needs_raw = data.get("needs_clarification")
    if isinstance(needs_raw, str):
        needs_clarification = needs_raw.strip().lower() in ("1", "true", "yes", "y", "需要", "是")
    else:
        needs_clarification = bool(needs_raw)
    intent = {
        "title": title,
        "subtitle": _clean_text(data.get("subtitle")),
        "purpose": _clean_text(data.get("purpose")) or "演示汇报",
        "audience": _clean_text(data.get("audience")) or "目标受众",
        "language": _clean_text(data.get("language")) or "中文",
        "tone": _clean_text(data.get("tone")) or "清晰、专业",
        "visual_direction": _clean_text(data.get("visual_direction") or options.get("render_style")) or "按 项目 PPT 工作流自动匹配",
        "filename": _safe_filename(filename_source),
        "target_slide_count": target_count,
        "needs_clarification": needs_clarification,
        "clarifying_question": clarifying_question,
        "clarifying_questions": clarifying_questions[:3],
    }
    return intent


def _plan_outline(request_text, intent, target_count, options):
    prompt = _as_text(options.get("ppt_outline_prompt") or "").strip() or DEFAULT_OUTLINE_PROMPT
    user = json.dumps({
        "user_request": request_text,
        "intent": intent,
        "target_slide_count": target_count,
        "ppt_interaction_context": _ppt_prompt_context(options),
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
    design_hint = _build_project_design_system(request_text, intent, [], options)
    user = json.dumps({
        "user_request": request_text,
        "intent": intent,
        "outline": outline,
        "ppt_interaction_context": _ppt_prompt_context(options),
        "design_system": design_hint,
        "skill_prompt": _project_skill_prompt_excerpt(),
        "template_style": design_hint.get("template_style") if isinstance(design_hint, dict) else "",
        "layout_catalog": design_hint.get("layout_catalog") if isinstance(design_hint, dict) else [],
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
            "template_style": _clean_text(raw.get("template_style") or ""),
            "layout_id": _clean_text(raw.get("layout_id") or raw.get("layout") or ""),
            "theme_class": _clean_text(raw.get("theme_class") or raw.get("theme") or ""),
            "data_animate": _clean_text(raw.get("data_animate") or raw.get("animation") or ""),
            "image_slots": raw.get("image_slots") if isinstance(raw.get("image_slots"), list) else [],
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
            page["visual_role"] = page.get("visual_role") or "用 项目 PPT 封面版式建立主题气质和第一视觉记忆点"
        elif category == "agenda":
            page["visual_role"] = page.get("visual_role") or "用 项目 PPT 目录/索引版式说明整份 PPT 的内容路径"
        else:
            page["visual_role"] = page.get("visual_role") or "用已登记的 项目 PPT 正文版式承载核心信息"
    return pages


def _count_page_categories(pages):
    counts = {"cover": 0, "agenda": 0, "content": 0}
    for page in pages or []:
        key = page.get("page_category") or "content"
        counts[key] = counts.get(key, 0) + 1
    return counts


def _build_layout_blueprints(pages, design_system):
    _assign_project_layouts(pages, design_system)
    blueprints = []
    for idx, page in enumerate(pages, start=1):
        category = page.get("page_category") or "content"
        blueprint = {
            "page": page.get("page"),
            "category": category,
            "page_type": page.get("page_type"),
            "template_system": _PROJECT_TEMPLATE_SYSTEM,
            "template_style": design_system.get("template_style"),
            "template_file": design_system.get("template_file"),
            "layout_id": page.get("layout_id"),
            "layout_name": page.get("layout_name"),
            "theme_class": page.get("theme_class"),
            "data_animate": page.get("data_animate"),
            "image_slots": page.get("image_slots") or [],
            "composition": _project_composition_for_layout(page, design_system),
            "must_follow": [
                "只生成一个 <section class=\"slide ...\">，后端会填入 项目 HTML 模板。",
                "不要写 doctype/head/body/style/script，不要复制模板源码。",
                "严格使用 layout_id 对应的模板骨架和 allowed_classes；不要发明新 class。",
                "不要把所有页面都写成标题加卡片网格；必须保持 项目 PPT 的版式节奏。",
            ],
        }
        page["layout_blueprint"] = blueprint
        page["design_instruction"] = _project_page_instruction(page, design_system, idx, len(pages))
        blueprints.append(blueprint)
    return blueprints


def _build_design_system(request_text, intent, pages, options):
    return _build_project_design_system(request_text, intent, pages, options)


def system_seed(request_text, intent, options):
    raw = _as_text(options.get("style_seed") or options.get("seed") or "").strip()
    if raw:
        return raw
    basis = f"{request_text}|{intent.get('title') or ''}|{time.time_ns()}"
    return str(abs(hash(basis)) % 1000000)


def _is_project_design_system(design_system):
    return (design_system or {}).get("template_system") == _PROJECT_TEMPLATE_SYSTEM


def _project_skill_prompt_excerpt():
    global _PROJECT_SKILL_PROMPT_CACHE
    if _PROJECT_SKILL_PROMPT_CACHE is not None:
        return _PROJECT_SKILL_PROMPT_CACHE
    path = _PROJECT_TEMPLATE_ROOT / "SKILL.md"
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        _PROJECT_SKILL_PROMPT_CACHE = ""
        return _PROJECT_SKILL_PROMPT_CACHE
    sections = []
    for start, end in [
        ("## 这个 Skill 做什么", "## 何时使用"),
        ("## 工作流", "### Step 4"),
        ("## 资源文件导览", "## 核心设计原则"),
        ("## 核心设计原则", "## 参考作品"),
    ]:
        part = _slice_between(text, start, end)
        if part:
            sections.append(part.strip())
    excerpt = "\n\n".join(sections)
    _PROJECT_SKILL_PROMPT_CACHE = excerpt[:18000]
    return _PROJECT_SKILL_PROMPT_CACHE


def _slice_between(text, start_marker, end_marker):
    start = text.find(start_marker)
    if start < 0:
        return ""
    end = text.find(end_marker, start + len(start_marker))
    return text[start:end if end >= 0 else len(text)]


def _select_template_style(request_text, intent, options):
    explicit = _as_text((options or {}).get("ppt_template_style") or "").strip().lower()
    basis = " ".join([
        explicit,
        _as_text((options or {}).get("render_style") or ""),
        _ppt_guidance_text(options or {}),
        _as_text((intent or {}).get("visual_direction") or ""),
        _as_text(request_text or ""),
        _as_text((intent or {}).get("purpose") or ""),
    ]).lower()
    if any(token in basis for token in ["swiss", "瑞士", "helvetica", "网格", "international typographic", "vignelli"]):
        return "swiss"
    if any(token in basis for token in ["杂志", "电子墨水", "电子杂志", "monocle", "人文", "故事", "纪实"]):
        return "magazine"
    if any(token in basis for token in ["ai", "人工智能", "技术", "工程", "数据", "kpi", "指标", "产品发布", "系统", "架构", "benchmark"]):
        return "swiss"
    return "magazine"


def _select_project_theme(style, request_text, intent, options):
    explicit = _as_text((options or {}).get("ppt_template_theme") or "").strip().lower()
    basis = " ".join([
        explicit,
        _as_text((options or {}).get("render_style") or ""),
        _ppt_guidance_text(options or {}),
        _as_text((intent or {}).get("visual_direction") or ""),
        _as_text(request_text or ""),
    ]).lower()
    if style == "swiss":
        if any(token in basis for token in ["lemon green", "柠檬绿", "绿色", "生态", "可持续", "健康"]):
            return "lemon_green"
        if any(token in basis for token in ["lemon", "柠檬黄", "黄色", "活力", "消费", "零售", "年轻"]):
            return "lemon"
        if any(token in basis for token in ["orange", "橙", "工业", "警示", "紧迫", "汽车"]):
            return "safety_orange"
        return "ikb"
    if any(token in basis for token in ["靛蓝", "indigo", "技术", "ai", "数据", "研究", "工程"]):
        return "indigo_porcelain"
    if any(token in basis for token in ["森林", "绿色", "自然", "可持续", "文化"]):
        return "forest_ink"
    if any(token in basis for token in ["牛皮纸", "怀旧", "历史", "文学", "阅读"]):
        return "kraft_paper"
    if any(token in basis for token in ["沙丘", "艺术", "设计", "时尚", "画廊"]):
        return "dune"
    return "ink_classic"


def _build_project_design_system(request_text, intent, pages, options):
    style = _select_template_style(request_text, intent, options)
    theme_key = _select_project_theme(style, request_text, intent, options)
    themes = _PROJECT_SWISS_THEME_VARS if style == "swiss" else _PROJECT_MAGAZINE_THEME_VARS
    theme = themes.get(theme_key) or next(iter(themes.values()))
    template_file = "template-swiss.html" if style == "swiss" else "template.html"
    allowed_classes = _PROJECT_SWISS_ALLOWED_CLASSES if style == "swiss" else _PROJECT_MAGAZINE_ALLOWED_CLASSES
    layout_catalog = _PROJECT_SWISS_LAYOUTS if style == "swiss" else _PROJECT_MAGAZINE_LAYOUTS
    system = {
        "template_system": _PROJECT_TEMPLATE_SYSTEM,
        "template_style": style,
        "style_label": "瑞士国际主义" if style == "swiss" else "电子杂志 x 电子墨水",
        "theme_key": theme_key,
        "theme_name": f"project_{style}_{theme_key}",
        "theme_label": theme.get("label"),
        "theme_vars": theme.get("vars") or {},
        "palette": list(theme.get("palette") or []),
        "template_root": str(_PROJECT_TEMPLATE_ROOT),
        "template_file": f"assets/{template_file}",
        "references": _project_reference_list(style),
        "layout_catalog": layout_catalog,
        "allowed_classes": allowed_classes,
        "consistency_rules": [
            "一份 deck 只使用一种 模板风格，不混用 magazine/swiss class。",
            "一份 deck 只使用一套预设主题色，不接受任意 hex 混搭。",
            "版式来自登记 layout；通过 layout_id 和 theme_class 控制节奏。",
        ],
        "composition_rules": _project_composition_rules(style),
        "seed": system_seed(request_text, intent, options),
        "guidance_version": (options or {}).get("_ppt_guidance_version", 0),
        "source_material_count": len(((options or {}).get("_ppt_source_materials") or {}).get("items") or []),
    }
    _assign_project_layouts(pages, system)
    return system


def _project_reference_list(style):
    if style == "swiss":
        return [
            "SKILL.md",
            "assets/template-swiss.html",
            "references/themes-swiss.md",
            "references/swiss-layout-lock.md",
            "references/layouts-swiss.md",
            "references/checklist.md",
        ]
    return [
        "SKILL.md",
        "assets/template.html",
        "references/themes.md",
        "references/layouts.md",
        "references/components.md",
        "references/checklist.md",
    ]


def _project_composition_rules(style):
    if style == "swiss":
        return [
            "全程无衬线；大字号极细，小字较粗。",
            "直角、纯色、hairline、12 栏网格；禁止渐变、阴影、圆角。",
            "每个正文页必须有 data-layout=Sxx，SVG 不写文字。",
            "10 页以上至少使用 8 个不同 S 编号版式。",
        ]
    return [
        "衬线标题 + 非衬线正文 + 等宽 meta。",
        "hero light/dark 与正文 light/dark 形成节奏，禁止连续 3 页同主题。",
        "图片只用标准比例；没有真实图片时不要伪造图片路径。",
        "优先用大字号、留白、线条、图片和引语建立杂志感。",
    ]


def _assign_project_layouts(pages, design_system):
    style = (design_system or {}).get("template_style") or "magazine"
    total = len(pages or [])
    used = {}
    for idx, page in enumerate(pages or [], start=1):
        layout_id = _clean_text(page.get("layout_id") or "")
        if not _is_valid_project_layout(layout_id, style):
            layout_id = _default_project_layout_id(page, idx, total, style, used)
        used[layout_id] = used.get(layout_id, 0) + 1
        page["template_system"] = _PROJECT_TEMPLATE_SYSTEM
        page["template_style"] = style
        page["layout_id"] = layout_id
        page["layout_name"] = _project_layout_name(layout_id, style)
        page["page_variant"] = layout_id
        page["theme_class"] = _clean_text(page.get("theme_class") or "") or _default_project_theme_class(page, idx, total, style, layout_id)
        page["data_animate"] = _clean_text(page.get("data_animate") or "") or _default_project_animation(style, layout_id, page)
        image_slots = page.get("image_slots") or []
        page["image_slots"] = image_slots if isinstance(image_slots, list) else []


def _is_valid_project_layout(layout_id, style):
    if not layout_id:
        return False
    catalog = _PROJECT_SWISS_LAYOUTS if style == "swiss" else _PROJECT_MAGAZINE_LAYOUTS
    return layout_id in {item["id"] for item in catalog}


def _project_layout_name(layout_id, style):
    catalog = _PROJECT_SWISS_LAYOUTS if style == "swiss" else _PROJECT_MAGAZINE_LAYOUTS
    for item in catalog:
        if item.get("id") == layout_id:
            return item.get("name") or layout_id
    return layout_id


def _default_project_layout_id(page, index, total, style, used):
    page_type = _as_text(page.get("page_type") or "").lower()
    category = page.get("page_category") or "content"
    if style == "swiss":
        if index == 1 or category == "cover":
            return "SWISS-COVER-ASCII"
        if index == total or page_type in ("closing", "summary"):
            return "SWISS-CLOSING-ASCII"
        mapping = {
            "agenda": "S01",
            "section": "S09",
            "comparison": "S08",
            "data_story": "S06",
            "process": "S11",
            "timeline": "S02",
            "case": "S16",
            "quote": "S09",
            "concept": "S04",
            "freeform": "S19",
        }
        primary = mapping.get(page_type) or "S04"
        rotation = ["S04", "S05", "S08", "S11", "S13", "S14", "S15", "S16", "S17", "S18", "S19", "S21"]
        if used.get(primary, 0) >= 1:
            primary = rotation[(index + len(used)) % len(rotation)]
        return primary
    if index == 1 or category == "cover":
        return "A01"
    if index == total or page_type in ("closing", "summary"):
        return "A07"
    mapping = {
        "agenda": "A06",
        "section": "A02",
        "comparison": "A09",
        "data_story": "A03",
        "process": "A06",
        "timeline": "A06",
        "case": "A10",
        "quote": "A08",
        "concept": "A04",
        "freeform": "A10",
    }
    primary = mapping.get(page_type) or "A04"
    rotation = ["A03", "A04", "A05", "A06", "A08", "A09", "A10"]
    if used.get(primary, 0) >= 1:
        primary = rotation[(index + len(used)) % len(rotation)]
    return primary


def _default_project_theme_class(page, index, total, style, layout_id):
    if style == "swiss":
        if layout_id == "SWISS-COVER-ASCII":
            return "accent"
        if layout_id == "SWISS-CLOSING-ASCII" or layout_id in ("S03", "S10"):
            return "split"
        if layout_id in ("S09", "S12"):
            return "dark"
        return "grey"
    if layout_id == "A01":
        return "hero dark"
    if layout_id == "A02":
        return "hero light" if index % 2 else "hero dark"
    if layout_id in ("A07", "A08"):
        return "hero dark" if index < total else "light"
    sequence = ["light", "dark", "light", "hero light", "dark", "light"]
    return sequence[(index - 2) % len(sequence)]


def _default_project_animation(style, layout_id, page):
    if style == "swiss":
        mapping = {
            "SWISS-COVER-ASCII": "hero",
            "SWISS-CLOSING-ASCII": "split-statement",
            "S02": "progression",
            "S03": "split-statement",
            "S04": "grid-reveal",
            "S05": "stack-build",
            "S06": "measure-up",
            "S07": "bar-grow",
            "S08": "duo-mirror",
            "S09": "statement",
            "S10": "split-statement",
            "S11": "timeline-walk",
            "S12": "manifesto",
            "S13": "three-forces",
            "S14": "loop-form",
            "S15": "matrix-fill",
            "S16": "field-notes",
            "S17": "system-diagram",
            "S18": "why-now",
            "S19": "four-cards",
            "S20": "stacked-ledger",
            "S21": "tech-spec",
            "S22": "image-hero",
        }
        return mapping.get(layout_id) or "grid-reveal"
    if layout_id in ("A01", "A02", "A07"):
        return "hero"
    if layout_id == "A06":
        return "pipeline"
    if layout_id == "A08":
        return "quote"
    if layout_id == "A09":
        return "directional"
    return "cascade"


def _project_composition_for_layout(page, design_system):
    style = (design_system or {}).get("template_style") or "magazine"
    layout_id = page.get("layout_id") or page.get("page_variant") or ""
    if style == "swiss":
        return f"瑞士国际主义 {layout_id} / {page.get('layout_name')}: 使用登记骨架、左上标题轴、12 栏网格、单一 accent。"
    return f"电子杂志 {layout_id} / {page.get('layout_name')}: 使用模板衬线标题、chrome/foot、明暗节奏和杂志留白。"


def _project_page_instruction(page, design_system, index, total):
    style = (design_system or {}).get("template_style") or "magazine"
    layout_id = page.get("layout_id") or ""
    theme_class = page.get("theme_class") or ""
    return (
        f"第 {index}/{total} 页使用 项目 PPT {style} 模板，layout_id={layout_id}，theme_class={theme_class}。"
        "只返回一个 section；内容要贴合该 layout 的信息形状，不要退回通用卡片网格。"
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


def _generate_html_pages(request_text, intent, pages, html_dir, options, design_system=None, progress=None, checkpoint=None):
    html_prompt = (
        _as_text(options.get("ppt_html_prompt") or "").strip()
        or _as_text(options.get("ppt_slide_prompt") or "").strip()
        or DEFAULT_HTML_PROMPT
    )
    design_system = design_system or _build_design_system(request_text, intent, pages, options)
    _ensure_project_runtime_assets(html_dir)
    project_context = _template_context(design_system)
    html_pages = []
    for page in pages:
        _run_checkpoint(checkpoint, f"html:{page.get('page')}")
        _refresh_ppt_source_materials(options, html_dir, request_text)
        user = json.dumps({
            "user_request": request_text,
            "intent": intent,
            "page": page,
            "canvas": {"width": _WIDTH, "height": _HEIGHT, "ratio": "16:9"},
            "style_preference": options.get("render_style") or intent.get("visual_direction") or "",
            "design_system": design_system,
            "layout_blueprint": page.get("layout_blueprint") or {},
            "page_variant": page.get("page_variant") or "freeform",
            "page_design_instruction": page.get("design_instruction") or "根据 layout_id 和 theme_class 生成 项目 slide section，避免通用卡片网格。",
            "template_system": _PROJECT_TEMPLATE_SYSTEM,
            "template_context": project_context,
            "skill_prompt": _project_skill_prompt_excerpt(),
            "ppt_interaction_context": _ppt_prompt_context(options),
            "anti_template_warning": "",
        }, ensure_ascii=False)
        _emit_substep(progress, "html", "generate_html_page", f"正在生成第 {page.get('page')} 页 HTML：{page.get('title') or ''}", "running", {"page": page.get("page"), "page_type": page.get("page_type"), "category": page.get("page_category")})
        data = _ppt_llm_generate_json(html_prompt, user, _llm_options(options, 8192), fallback=None)
        html_doc = ""
        if isinstance(data, dict):
            html_doc = data.get("html") or data.get("document") or data.get("content") or ""
        elif isinstance(data, str):
            html_doc = data
        html_doc = _prepare_project_html_document(html_doc, intent, page, design_system, html_dir)
        filename = f"slide_{int(page.get('page') or len(html_pages) + 1):02d}.html"
        abs_path = os.path.join(html_dir, filename)
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(html_doc)
        item = dict(page)
        item.update({"abs_path": abs_path, "path": _rel_path(abs_path), "quality": _score_html_design(html_doc, page, design_system)})
        _emit_substep(progress, "html", "generate_html_page", f"第 {page.get('page')} 页 HTML 已生成。", "done", {"page": page.get("page"), "path": _rel_path(abs_path)})
        html_pages.append(item)
    return html_pages


def _validate_project_html_pages(html_pages, design_system, progress=None, checkpoint=None):
    report = {"pages": [], "passed": True}
    for item in html_pages:
        page_no = item.get("page")
        _run_checkpoint(checkpoint, f"quality_review:{page_no}")
        score_info = item.get("quality") or _score_html_file(item.get("abs_path"), item, design_system)
        item["quality"] = score_info
        passed = not score_info.get("issues")
        if not passed:
            report["passed"] = False
        report["pages"].append({
            "page": page_no,
            "passed": passed,
            "issues": score_info.get("issues") or [],
        })
        status = "done" if passed else "warning"
        msg = f"第 {page_no} 页规则检查通过。" if passed else f"第 {page_no} 页规则检查发现 {len(score_info.get('issues') or [])} 个问题。"
        _emit_substep(progress, "quality_review", "check_page", msg, status, {"page": page_no, "issues": score_info.get("issues")})
    return report


def _score_html_file(path, page, design_system):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return _score_html_design(f.read(), page, design_system)
    except Exception:
        return {"score": 0, "issues": ["html_not_readable"]}


def _score_html_design(html_doc, page, design_system):
    return _score_project_html_design(html_doc, page, design_system)


def _quality_summary_text(report):
    pages = report.get("pages") or [] if isinstance(report, dict) else []
    if not pages:
        return "项目模板规则检查完成。"
    failed = [p for p in pages if not p.get("passed")]
    if failed:
        return f"项目模板规则检查完成，发现问题页 {len(failed)} 页。"
    return f"项目模板规则检查完成，{len(pages)} 页通过。"


def _ensure_project_runtime_assets(html_dir):
    src_assets = _PROJECT_TEMPLATE_ROOT / "assets"
    dst_assets = Path(html_dir) / "assets"
    try:
        os.makedirs(dst_assets, exist_ok=True)
        motion_src = src_assets / "motion.min.js"
        if motion_src.exists():
            shutil.copy2(motion_src, dst_assets / "motion.min.js")
        bg_src = src_assets / "screenshot-backgrounds"
        if bg_src.exists():
            shutil.copytree(bg_src, dst_assets / "screenshot-backgrounds", dirs_exist_ok=True)
    except Exception:
        pass


def _template_context(design_system):
    style = (design_system or {}).get("template_style") or "magazine"
    return {
        "template_system": _PROJECT_TEMPLATE_SYSTEM,
        "style": style,
        "style_label": (design_system or {}).get("style_label"),
        "template_root": (design_system or {}).get("template_root"),
        "template_file": (design_system or {}).get("template_file"),
        "references": (design_system or {}).get("references") or [],
        "theme": {
            "key": (design_system or {}).get("theme_key"),
            "label": (design_system or {}).get("theme_label"),
            "vars": (design_system or {}).get("theme_vars") or {},
            "palette": (design_system or {}).get("palette") or [],
        },
        "layout_catalog": (design_system or {}).get("layout_catalog") or [],
        "allowed_classes": (design_system or {}).get("allowed_classes") or [],
        "rules": _project_composition_rules(style),
        "output_contract": "Return one <section class=\"slide ...\"> only. Backend wraps it with the copied 项目 PPT template.",
    }


def _prepare_project_html_document(raw_html, intent, page, design_system, html_dir):
    fragment = _sanitize_project_fragment(raw_html)
    if not fragment or _html_is_garbled(fragment) or "[必填]" in fragment:
        fragment = _fallback_project_section(intent, page, design_system)
    fragment = _patch_project_section(fragment, page, design_system)
    if not fragment or _html_is_garbled(fragment):
        fragment = _fallback_project_section(intent, page, design_system)
        fragment = _patch_project_section(fragment, page, design_system)
    fragment = _remove_missing_local_images(fragment, html_dir)
    return _wrap_project_template(fragment, intent, page, design_system)


def _remove_missing_local_images(fragment, html_dir):
    """Drop LLM-invented local <img> tags before rendering.

    The prompt tells the model to use only real source_materials image html_src
    values (normally images/<file>). In practice the model can still invent
    paths like images/route-map.png. Browser screenshots reserve layout space
    for those broken images, which makes the resulting PPT look misaligned.
    Keep remote/data/blob URLs untouched, but remove file-relative images that
    do not exist under the generated HTML directory.
    """
    text = _as_text(fragment)
    if not text:
        return text

    def repl(match):
        tag = match.group(0)
        src = html_lib.unescape(_get_html_attr(tag, "src")).strip()
        if not src or _html_image_src_exists(src, html_dir):
            return tag
        alt = html_lib.escape(_clean_text(_get_html_attr(tag, "alt"))[:80])
        note = alt or "图片素材未提供"
        return f'<div class="ppt-missing-image" aria-label="{note}"></div>'

    return re.sub(r"<img\b[^>]*>", repl, text, flags=re.IGNORECASE | re.DOTALL)


def _html_image_src_exists(src, html_dir):
    raw = _as_text(src).strip()
    if not raw:
        return False
    lower = raw.lower()
    if lower.startswith(("http://", "https://", "data:", "blob:", "about:")):
        return True
    if lower.startswith("file://"):
        try:
            from urllib.parse import unquote, urlparse
            path = unquote(urlparse(raw).path or "")
            if os.name == "nt" and re.match(r"^/[a-zA-Z]:/", path):
                path = path[1:]
            return bool(path and os.path.isfile(path))
        except Exception:
            return False

    # Ignore anchors/query strings used for cache busting.
    path_part = re.split(r"[?#]", raw, 1)[0].replace("\\", "/")
    if not path_part:
        return False

    # CSS/HTML-relative paths should stay inside the generated html_dir.
    candidate = os.path.normpath(os.path.join(html_dir, path_part))
    base = os.path.abspath(html_dir)
    abs_candidate = os.path.abspath(candidate)
    try:
        common = os.path.commonpath([base, abs_candidate])
    except Exception:
        return False
    if common != base:
        return False
    return os.path.isfile(abs_candidate)


def _sanitize_project_fragment(raw_html):
    text = _HTML_FENCE_RE.sub("", _as_text(raw_html).strip())
    if not text:
        return ""
    text = _SCRIPT_RE.sub("", text)
    text = _EVENT_HANDLER_RE.sub("", text)
    section = _extract_first_slide_section(text)
    return section.strip() if section else ""


def _extract_first_slide_section(html_doc):
    for match in _SLIDE_SECTION_RE.finditer(_as_text(html_doc)):
        section = match.group(0)
        tag = re.match(r"<section\b[^>]*>", section, flags=re.IGNORECASE | re.DOTALL)
        if tag and re.search(r"\bclass\s*=\s*(['\"]).*?\bslide\b.*?\1", tag.group(0), flags=re.IGNORECASE | re.DOTALL):
            return section
    return ""


def _patch_project_section(section, page, design_system):
    text = _as_text(section).strip()
    tag_match = re.match(r"<section\b[^>]*>", text, flags=re.IGNORECASE | re.DOTALL)
    if not tag_match:
        return ""
    tag = tag_match.group(0)
    style = (design_system or {}).get("template_style") or "magazine"
    classes = _split_classes(_get_html_attr(tag, "class"))
    classes.append("slide")
    theme_tokens = _split_classes(page.get("theme_class") or _default_project_theme_class(page, int(page.get("page") or 1), int(page.get("target_slide_count") or 1), style, page.get("layout_id") or ""))
    for token in theme_tokens:
        classes.append(token)
    if style == "magazine" and not any(token in classes for token in ("light", "dark")):
        classes.append("light")
    if style == "swiss" and not any(token in classes for token in ("grey", "dark", "accent", "split")):
        classes.append("grey")
    class_value = " ".join(dict.fromkeys([c for c in classes if c]))
    tag = _set_html_attr(tag, "class", class_value)
    animate = page.get("data_animate") or _default_project_animation(style, page.get("layout_id") or "", page)
    if animate:
        tag = _set_html_attr(tag, "data-animate", animate)
    if style == "swiss":
        layout_id = page.get("layout_id") or "S04"
        tag = _set_html_attr(tag, "data-layout", layout_id)
    else:
        tag = _set_html_attr(tag, "data-layout", page.get("layout_id") or "A04")
    tag = _set_html_attr(tag, "data-template", _PROJECT_TEMPLATE_SYSTEM)
    return tag + text[tag_match.end():]


def _split_classes(value):
    return [part for part in re.split(r"\s+", _as_text(value).strip()) if part]


def _get_html_attr(tag, name):
    m = re.search(rf"\b{re.escape(name)}\s*=\s*(['\"])(.*?)\1", _as_text(tag), flags=re.IGNORECASE | re.DOTALL)
    return m.group(2) if m else ""


def _set_html_attr(tag, name, value):
    text = _as_text(tag)
    safe = html_lib.escape(_as_text(value), quote=True)
    pattern = rf"\b{re.escape(name)}\s*=\s*(['\"]).*?\1"
    if re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL):
        return re.sub(pattern, f'{name}="{safe}"', text, count=1, flags=re.IGNORECASE | re.DOTALL)
    return re.sub(r">\s*$", f' {name}="{safe}">', text, count=1)


def _wrap_project_template(slide_section, intent, page, design_system):
    style = (design_system or {}).get("template_style") or "magazine"
    template_name = "template-swiss.html" if style == "swiss" else "template.html"
    template_path = _PROJECT_TEMPLATE_ROOT / "assets" / template_name
    try:
        template = template_path.read_text(encoding="utf-8")
    except Exception:
        return _minimal_html_document(slide_section)
    template = _apply_project_theme_vars(template, (design_system or {}).get("theme_vars") or {})
    title = html_lib.escape(_clean_text((intent or {}).get("title") or (page or {}).get("title") or "PPT"))
    template = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", template, count=1, flags=re.IGNORECASE | re.DOTALL)
    template = re.sub(
        r'(<div\s+id=["\']deck["\']\s*>\s*)[\s\S]*?(\s*</div>\s*<div\s+id=["\']nav["\']\s*>)',
        lambda m: f"{m.group(1)}\n{slide_section}\n{m.group(2)}",
        template,
        count=1,
        flags=re.IGNORECASE,
    )
    return _inject_project_overflow_guard(template)


def _inject_project_overflow_guard(html_doc):
    """Inject a last-mile text fitting guard for browser-rendered PPT pages."""
    text = _as_text(html_doc)
    if not text or "ppt-overflow-guard" in text:
        return text
    style = r"""
<style id="ppt-overflow-guard-style">
  .slide{contain:layout paint;}
  .slide h1,.slide h2,.slide h3,.slide p,.slide .display,.slide .display-zh,.slide .h-hero,.slide .h-hero-zh,.slide .h-xl,.slide .h-xl-zh,.slide .h1-zh,.slide .h2-zh,.slide .lead,.slide .body,.slide .body-zh,.slide .body-serif,.slide .callout{
    overflow-wrap:anywhere;
    word-break:break-word;
    max-width:100%;
  }
  .slide [data-ppt-fit="shrunk"]{text-wrap:balance;}
</style>"""
    script = r"""
<script id="ppt-overflow-guard">
(function(){
  function px(value){var n=parseFloat(value||'0');return isFinite(n)?n:0;}
  function candidates(slide){
    return Array.prototype.slice.call(slide.querySelectorAll('h1,h2,h3,p,.display,.display-zh,.h-hero,.h-hero-zh,.h-xl,.h-xl-zh,.h1-zh,.h2-zh,.h3-zh,.lead,.body,.body-zh,.body-serif,.callout,.q-big,.big-num,.mid-num,.stat .n,.plat .name,.plat .fill,.rowline .k,.pillar .t'));
  }
  function overflows(el, safe){
    var r=el.getBoundingClientRect();
    if(!r.width||!r.height) return false;
    var outside = r.left < safe.left || r.top < safe.top || r.right > safe.right || r.bottom > safe.bottom;
    var clipped = el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
    var tooTall = r.height > (safe.bottom-safe.top) * 0.92;
    return outside || clipped || tooTall;
  }
  function fitOne(el, safe){
    var cs=getComputedStyle(el);
    var size=px(cs.fontSize);
    if(!size || size < 10) return;
    var min=Math.max(10, Math.min(size, size*0.52));
    var guard=0;
    el.style.maxWidth='100%';
    el.style.overflowWrap='anywhere';
    el.style.wordBreak='break-word';
    while(overflows(el, safe) && size > min && guard < 36){
      size = Math.max(min, size * 0.92);
      el.style.fontSize = size.toFixed(2) + 'px';
      el.dataset.pptFit = 'shrunk';
      guard++;
    }
  }
  function run(){
    document.querySelectorAll('.slide').forEach(function(slide){
      var r=slide.getBoundingClientRect();
      if(!r.width||!r.height) return;
      var safe={left:r.left+r.width*0.025, top:r.top+r.height*0.025, right:r.right-r.width*0.025, bottom:r.bottom-r.height*0.055};
      candidates(slide).sort(function(a,b){return b.getBoundingClientRect().height-a.getBoundingClientRect().height;}).forEach(function(el){fitOne(el,safe);});
      candidates(slide).forEach(function(el){fitOne(el,safe);});
    });
  }
  if(document.fonts && document.fonts.ready){document.fonts.ready.then(run).catch(run);} else {setTimeout(run,0);}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',run,{once:true}); else run();
  window.addEventListener('load',run,{once:true});
})();
</script>"""
    if re.search(r"</head\s*>", text, flags=re.IGNORECASE):
        text = _inject_before_head_end(text, style)
    else:
        text = style + text
    if re.search(r"</body\s*>", text, flags=re.IGNORECASE):
        text = _inject_before_body_end(text, script)
    else:
        text = text + script
    return text


def _apply_project_theme_vars(template, theme_vars):
    text = _as_text(template)
    for name, value in (theme_vars or {}).items():
        pattern = rf"(--{re.escape(name)}\s*:\s*)[^;]+;"
        text = re.sub(pattern, lambda m, val=_as_text(value): f"{m.group(1)}{val};", text, count=1)
    return text


def _minimal_html_document(body_html):
    return _inject_project_overflow_guard(f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>html,body{{margin:0;width:100%;height:100%;overflow:hidden;background:#f7f5ef;}}</style>
</head>
<body>{body_html}</body>
</html>"""
)

def _fallback_project_section(intent, page, design_system):
    style = (design_system or {}).get("template_style") or "magazine"
    return _fallback_project_swiss_section(intent, page, design_system) if style == "swiss" else _fallback_project_magazine_section(intent, page, design_system)


def _fallback_project_magazine_section(intent, page, design_system):
    title = html_lib.escape(page.get("title") or intent.get("title") or "PPT")
    subtitle = html_lib.escape(page.get("goal") or intent.get("subtitle") or intent.get("purpose") or "")
    page_no = int(page.get("page") or 1)
    theme_class = html_lib.escape(page.get("theme_class") or "light")
    layout_id = html_lib.escape(page.get("layout_id") or "A04")
    animate = html_lib.escape(page.get("data_animate") or "cascade")
    blocks = _fallback_block_items(page)
    cards = "".join(
        f"""<div class="stat-card" data-anim>
  <div class="stat-label">{html_lib.escape(item.get('title') or f'Point {idx}')}</div>
  <div class="stat-note">{html_lib.escape(item.get('text') or '')}</div>
</div>"""
        for idx, item in enumerate(blocks[:4], start=1)
    )
    return f"""<section class="slide {theme_class}" data-layout="{layout_id}" data-animate="{animate}">
  <div class="chrome">
    <div>{html_lib.escape(intent.get('title') or 'Deck')} · 项目 PPT</div>
    <div>{page_no:02d}</div>
  </div>
  <div class="frame" style="display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:5vw;align-items:center;min-height:70vh">
    <div>
      <div class="kicker" data-anim>{html_lib.escape(page.get('page_type') or 'Field Note')}</div>
      <h1 class="h-xl" data-anim>{title}</h1>
      <p class="lead" style="margin-top:3vh;max-width:54vw" data-anim>{subtitle}</p>
    </div>
    <div class="grid-3" style="display:grid;gap:2vh">{cards}</div>
  </div>
  <div class="foot">
    <div>{html_lib.escape(page.get('visual_role') or 'Key message')}</div>
    <div>{layout_id}</div>
  </div>
</section>"""


def _fallback_project_swiss_section(intent, page, design_system):
    title = html_lib.escape(page.get("title") or intent.get("title") or "PPT")
    subtitle = html_lib.escape(page.get("goal") or intent.get("subtitle") or intent.get("purpose") or "")
    page_no = int(page.get("page") or 1)
    total = int(intent.get("target_slide_count") or page_no)
    layout_id = page.get("layout_id") or "S04"
    theme_class = page.get("theme_class") or ("accent" if layout_id == "SWISS-COVER-ASCII" else "grey")
    animate = page.get("data_animate") or _default_project_animation("swiss", layout_id, page)
    blocks = _fallback_block_items(page)
    if layout_id == "SWISS-COVER-ASCII":
        return f"""<section class="slide accent" data-layout="SWISS-COVER-ASCII" data-animate="hero">
  <div class="canvas-card">
    <canvas class="ascii-bg" aria-hidden="true"></canvas>
    <div class="chrome-min"><div class="l">{html_lib.escape(intent.get('purpose') or 'FIELD NOTE')}</div><div class="r">{page_no:02d} / {total:02d}</div></div>
    <div style="flex:1;display:grid;grid-template-rows:auto 1fr auto;gap:2.6vh">
      <div data-anim="kicker" class="t-meta" style="color:rgba(255,255,255,.78);letter-spacing:.22em">PROJECT · SWISS</div>
      <h1 data-anim="title" style="align-self:center;font-family:var(--sans),var(--sans-zh);font-weight:200;font-size:min(9.4vw,16vh);line-height:.96;letter-spacing:-.025em;color:#fff">{title}</h1>
      <div data-anim="bottom" style="border-top:1px solid rgba(255,255,255,.22);padding-top:2vh">
        <div class="lead" style="max-width:58ch;color:rgba(255,255,255,.86)">{subtitle}</div>
      </div>
    </div>
  </div>
</section>"""
    if layout_id == "SWISS-CLOSING-ASCII":
        theme_class = "split"
        animate = "split-statement"
    cards = "".join(
        f"""<div class="card-fill span-4" data-anim="up" style="padding:var(--sp-7);min-height:24vh">
  <div class="t-meta" style="margin-bottom:2vh">{idx:02d}</div>
  <h3 class="t-h-prod" style="font-size:max(18px,1.7vw);font-weight:400;line-height:1.18;margin-bottom:1.4vh">{html_lib.escape(item.get('title') or f'Point {idx}')}</h3>
  <p class="t-body-sm">{html_lib.escape(item.get('text') or '')}</p>
</div>"""
        for idx, item in enumerate(blocks[:3], start=1)
    )
    return f"""<section class="slide {html_lib.escape(theme_class)}" data-layout="{html_lib.escape(layout_id)}" data-animate="{html_lib.escape(animate)}">
  <div class="canvas-card">
    <div class="chrome-min"><div class="l">{html_lib.escape(intent.get('title') or 'Deck')}</div><div class="r">{page_no:02d} / {total:02d}</div></div>
    <div class="grid-12" style="flex:1;align-items:start;gap:var(--sp-8)">
      <div class="span-7" data-anim="line">
        <div class="t-meta" style="margin-bottom:var(--sp-6)">{html_lib.escape(page.get('page_type') or 'SECTION')}</div>
        <h1 class="h-xl" style="font-size:min(5.8vw,10.2vh);font-weight:200;line-height:1.02">{title}</h1>
        <p class="lead" style="margin-top:var(--sp-7);max-width:46ch">{subtitle}</p>
      </div>
      <div class="span-5 grid-12" style="gap:var(--sp-5)">{cards}</div>
    </div>
    <div class="t-meta" style="text-align:right;color:var(--text-helper)">{html_lib.escape(layout_id)}</div>
  </div>
</section>"""


def _fallback_block_items(page):
    items = []
    for block in page.get("content_blocks") or []:
        if isinstance(block, dict):
            items.append({"title": _clean_text(block.get("title") or ""), "text": _clean_text(block.get("text") or "")})
    if not items:
        for idx, point in enumerate(page.get("key_points") or [], start=1):
            items.append({"title": f"要点 {idx}", "text": _clean_text(point)})
    if not items:
        items.append({"title": "核心信息", "text": _clean_text(page.get("goal") or "")})
    return items


def _score_project_html_design(html_doc, page, design_system):
    text = _as_text(html_doc)
    slide = _extract_first_slide_section(text)
    lower = slide.lower()
    style = (design_system or {}).get("template_style") or "magazine"
    score = 50
    issues = []
    if slide:
        score += 15
    else:
        issues.append("missing_slide_section")
        return {"score": 20, "issues": issues}
    if "[必填]" in slide:
        score -= 25
        issues.append("required_placeholder_not_replaced")
    if _clean_text(page.get("title") or "").lower()[:12] and _clean_text(page.get("title") or "").lower()[:12] in lower:
        score += 5
    if style == "swiss":
        layout_id = page.get("layout_id") or ""
        data_layout = _get_html_attr(re.match(r"<section\b[^>]*>", slide, flags=re.IGNORECASE | re.DOTALL).group(0), "data-layout")
        if data_layout:
            score += 14
        else:
            score -= 25
            issues.append("missing_swiss_data_layout")
        if data_layout == layout_id or _is_valid_project_layout(data_layout, "swiss"):
            score += 10
        else:
            score -= 14
            issues.append("invalid_swiss_layout")
        if "canvas-card" in lower:
            score += 10
        else:
            issues.append("missing_canvas_card")
        if any(token in lower for token in ("t-meta", "t-body", "h-xl", "card-fill", "grid-12", "span-")):
            score += 8
        else:
            issues.append("missing_swiss_template_classes")
        if re.search(r"linear-gradient|radial-gradient|box-shadow|border-radius\s*:\s*(?!0)", lower):
            score -= 14
            issues.append("swiss_forbidden_gradient_shadow_or_radius")
        if re.search(r"<svg\b[\s\S]*?<text\b", slide, flags=re.IGNORECASE):
            score -= 18
            issues.append("swiss_svg_text")
    else:
        tag = re.match(r"<section\b[^>]*>", slide, flags=re.IGNORECASE | re.DOTALL).group(0)
        class_value = _get_html_attr(tag, "class")
        if any(token in class_value.split() for token in ("light", "dark")):
            score += 10
        else:
            score -= 16
            issues.append("missing_magazine_theme_class")
        if "chrome" in lower:
            score += 8
        else:
            issues.append("missing_chrome")
        if "foot" in lower:
            score += 7
        else:
            issues.append("missing_foot")
        if any(token in lower for token in ("h-hero", "h-xl", "lead", "kicker", "stat-card", "frame-img", "pipeline")):
            score += 12
        else:
            issues.append("missing_magazine_template_classes")
        if len(re.findall(r"\b(card|panel|tile)\b", lower)) >= 6 and not any(token in lower for token in ("h-hero", "frame-img", "pipeline", "stat-nb")):
            score -= 12
            issues.append("looks_like_generic_card_grid")
    return {"score": max(0, min(100, score)), "issues": issues[:12]}


def _render_html_pages(html_pages, image_dir, checkpoint=None, editable_text=False):
    browser = _find_browser()
    profile_dir = os.path.join(image_dir, "_browser_profile")
    os.makedirs(profile_dir, exist_ok=True)
    images = []
    used_browser = False
    notes = []
    for page in html_pages:
        slide_no = int(page.get("page") or len(images) + 1)
        _run_checkpoint(checkpoint, f"render:{slide_no}")
        png_path = os.path.join(image_dir, f"slide_{slide_no:02d}.png")
        ok = False
        note = ""
        text_items = []
        if browser:
            if editable_text:
                ok, note, text_items = _capture_editable_background_with_browser(browser, page["abs_path"], png_path, profile_dir)
            else:
                ok, note = _capture_with_browser(browser, page["abs_path"], png_path, profile_dir)
            used_browser = used_browser or ok
        if not ok:
            note = note or "browser_not_available"
            _capture_with_pillow(page, png_path)
        _fit_image_16_9(png_path)
        item = dict(page)
        item.update({"abs_path": png_path, "path": _rel_path(png_path), "renderer_note": note, "text_items": text_items if ok and editable_text else []})
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


def _capture_editable_background_with_browser(browser, html_path, png_path, profile_dir):
    text_items = []
    try:
        text_items, extract_note = _extract_html_text_items_with_browser(browser, html_path, profile_dir)
    except Exception as exc:
        extract_note = f"text_extract_failed:{str(exc)[:160]}"
    try:
        bg_html = _make_no_text_html_copy(html_path)
        ok, shot_note = _capture_with_browser(browser, bg_html, png_path, profile_dir)
    except Exception as exc:
        ok, shot_note = False, f"editable_background_failed:{str(exc)[:160]}"
    notes = "; ".join([x for x in (extract_note, shot_note) if x])
    return ok, notes, text_items if ok else []


def _read_text_file(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _write_text_file(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def _inject_before_body_end(html_doc, snippet):
    if re.search(r"</body\s*>", html_doc, flags=re.IGNORECASE):
        return re.sub(
            r"</body\s*>",
            lambda m: snippet + "\n" + m.group(0),
            html_doc,
            count=1,
            flags=re.IGNORECASE,
        )
    return html_doc + "\n" + snippet


def _inject_before_head_end(html_doc, snippet):
    if re.search(r"</head\s*>", html_doc, flags=re.IGNORECASE):
        return re.sub(
            r"</head\s*>",
            lambda m: snippet + "\n" + m.group(0),
            html_doc,
            count=1,
            flags=re.IGNORECASE,
        )
    return snippet + "\n" + html_doc


def _make_no_text_html_copy(html_path):
    html_doc = _read_text_file(html_path)
    css = """
<style id="ppt-editable-hide-text">
body, body * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }
svg text, svg tspan { opacity: 0 !important; }
input, textarea { color: transparent !important; -webkit-text-fill-color: transparent !important; }
</style>
"""
    if re.search(r"</head\s*>", html_doc, flags=re.IGNORECASE):
        out = _inject_before_head_end(html_doc, css)
    else:
        out = css + "\n" + html_doc
    target = os.path.join(os.path.dirname(html_path), Path(html_path).stem + "__notext.html")
    _write_text_file(target, out)
    return target


def _make_text_extract_html_copy(html_path):
    html_doc = _read_text_file(html_path)
    script = r'''
<script>
(function(){
  function visible(el, cs) {
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity || 1) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
  }
  function directText(el) {
    var out = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === Node.TEXT_NODE) {
        var t = String(n.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
      }
    }
    return out.join(' ').trim();
  }
  function isLeafText(el) {
    var own = directText(el);
    if (own) return own;
    var children = Array.prototype.slice.call(el.children || []);
    var textChildren = children.filter(function(c){ return String(c.innerText || c.textContent || '').trim(); });
    if (textChildren.length) return '';
    return String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function itemFor(el, text) {
    var r = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    return {
      text: text,
      x: r.left, y: r.top, w: r.width, h: r.height,
      fontFamily: cs.fontFamily || '', fontSize: cs.fontSize || '', fontWeight: cs.fontWeight || '', fontStyle: cs.fontStyle || '',
      color: cs.color || '', lineHeight: cs.lineHeight || '', textAlign: cs.textAlign || '', opacity: cs.opacity || '1'
    };
  }
  window.addEventListener('load', function(){
    setTimeout(function(){
      var items = [];
      Array.prototype.slice.call(document.body.querySelectorAll('*')).forEach(function(el){
        if (el.closest('#ppt-text-extract-json')) return;
        var tag = String(el.tagName || '').toLowerCase();
        if (['script','style','noscript','template','svg'].indexOf(tag) >= 0) return;
        var cs = window.getComputedStyle(el);
        if (!visible(el, cs)) return;
        var text = isLeafText(el);
        if (!text) return;
        items.push(itemFor(el, text));
      });
      var s = document.createElement('script');
      s.type = 'application/json';
      s.id = 'ppt-text-extract-json';
      s.textContent = JSON.stringify(items);
      document.body.appendChild(s);
    }, 300);
  });
})();
</script>
'''
    out = _inject_before_body_end(html_doc, script)
    target = os.path.join(os.path.dirname(html_path), Path(html_path).stem + "__extract.html")
    _write_text_file(target, out)
    return target


def _extract_html_text_items_with_browser(browser, html_path, profile_dir):
    extract_html = _make_text_extract_html_copy(html_path)
    url = Path(os.path.abspath(extract_html)).as_uri()
    common = [
        browser, "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-extensions",
        "--allow-file-access-from-files", f"--user-data-dir={profile_dir}", f"--window-size={_WIDTH},{_HEIGHT}",
        "--virtual-time-budget=1500", "--dump-dom", url,
    ]
    last_err = ""
    for headless in ("--headless=new", "--headless"):
        args = [common[0], headless] + common[1:]
        try:
            result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
            dom = (result.stdout or b"").decode("utf-8", errors="replace")
            m = re.search(r'<script\b[^>]*id=["\']ppt-text-extract-json["\'][^>]*>(.*?)</script>', dom, flags=re.IGNORECASE | re.DOTALL)
            if m:
                raw = html_lib.unescape(m.group(1))
                items = json.loads(raw)
                return _normalize_text_items(items), f"editable_text_items:{len(items)}"
            last_err = (result.stderr or b"").decode("utf-8", errors="replace")[:180] or "text_json_not_found"
        except Exception as exc:
            last_err = str(exc)[:180]
    return [], last_err or "text_extract_failed"


def _normalize_text_items(items):
    out = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        text = _as_text(item.get("text")).strip()
        if not text:
            continue
        try:
            x, y, w, h = float(item.get("x") or 0), float(item.get("y") or 0), float(item.get("w") or 0), float(item.get("h") or 0)
        except Exception:
            continue
        if w < 2 or h < 2:
            continue
        item = dict(item)
        item.update({"text": text[:2000], "x": max(0, x), "y": max(0, y), "w": min(_WIDTH, w), "h": min(_HEIGHT, h)})
        out.append(item)
    return out[:160]


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


def _css_px(value, default=0.0):
    m = re.search(r"-?\d+(?:\.\d+)?", _as_text(value))
    if not m:
        return float(default)
    try:
        return float(m.group(0))
    except Exception:
        return float(default)


def _css_rgb(value):
    text = _as_text(value).strip()
    m = re.match(r"rgba?\(([^)]+)\)", text, flags=re.IGNORECASE)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        try:
            return tuple(max(0, min(255, int(float(parts[i])))) for i in range(3))
        except Exception:
            return (10, 10, 10)
    m = re.match(r"#([0-9a-f]{6})$", text, flags=re.IGNORECASE)
    if m:
        s = m.group(1)
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    m = re.match(r"#([0-9a-f]{3})$", text, flags=re.IGNORECASE)
    if m:
        s = m.group(1)
        return (int(s[0] * 2, 16), int(s[1] * 2, 16), int(s[2] * 2, 16))
    return (10, 10, 10)


def _font_family_name(value):
    raw = _as_text(value).split(",")[0].strip().strip('"\'')
    if not raw or raw.lower() in ("system-ui", "sans-serif", "-apple-system", "blinkmacsystemfont"):
        return "Arial"
    return raw


def _font_weight_bold(value):
    v = _as_text(value).strip().lower()
    if v in ("bold", "bolder"):
        return True
    try:
        return int(float(v)) >= 600
    except Exception:
        return False


def _ppt_alignment(value):
    try:
        from pptx.enum.text import PP_ALIGN
    except Exception:
        return None
    v = _as_text(value).strip().lower()
    if v in ("center", "middle"):
        return PP_ALIGN.CENTER
    if v in ("right", "end"):
        return PP_ALIGN.RIGHT
    if v in ("justify", "justify-all"):
        return PP_ALIGN.JUSTIFY
    return PP_ALIGN.LEFT


def _add_editable_text_overlays(slide, text_items, slide_width, slide_height):
    try:
        from pptx.util import Pt
        from pptx.dml.color import RGBColor
    except Exception:
        return
    sx = float(slide_width) / float(_WIDTH)
    sy = float(slide_height) / float(_HEIGHT)
    for item in text_items if isinstance(text_items, list) else []:
        text = _as_text(item.get("text")).strip()
        if not text:
            continue
        x = max(0, float(item.get("x") or 0)) * sx
        y = max(0, float(item.get("y") or 0)) * sy
        w = max(1, float(item.get("w") or 1)) * sx
        h = max(1, float(item.get("h") or 1)) * sy
        box = slide.shapes.add_textbox(int(x), int(y), int(w), int(h))
        tf = box.text_frame
        tf.clear()
        tf.margin_left = 0
        tf.margin_right = 0
        tf.margin_top = 0
        tf.margin_bottom = 0
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.alignment = _ppt_alignment(item.get("textAlign"))
        run = p.add_run()
        run.text = text
        font = run.font
        font.name = _font_family_name(item.get("fontFamily"))
        px = _css_px(item.get("fontSize"), 16)
        font.size = Pt(max(4, min(96, px * 0.75)))
        font.bold = _font_weight_bold(item.get("fontWeight"))
        font.italic = _as_text(item.get("fontStyle")).strip().lower() == "italic"
        r, g, b = _css_rgb(item.get("color"))
        font.color.rgb = RGBColor(r, g, b)


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
        "path": item.get("path"),
    }


def _public_image(item):
    return {
        "slide": item.get("page"),
        "title": item.get("title"),
        "page_type": item.get("page_type"),
        "path": item.get("path"),
    }


def _public_ppt_interaction(options):
    options = options or {}
    guidance = []
    for item in _ppt_guidance_items(options):
        guidance.append({
            "message": _clip_text(item.get("message") or "", 600),
            "source": item.get("source") or "user",
            "attachment_count": len(item.get("attachments") or []),
        })
    materials = options.get("_ppt_source_materials") or {}
    public_items = []
    for item in materials.get("items") or []:
        if not isinstance(item, dict):
            continue
        public_items.append({
            "kind": item.get("kind"),
            "source": item.get("source"),
            "name": item.get("name"),
            "workspace_path": item.get("workspace_path"),
            "asset_path": item.get("asset_path"),
            "html_src": item.get("html_src"),
            "text_chars": len(item.get("text_excerpt") or ""),
            "warning": item.get("warning"),
            "note": item.get("note"),
        })
    return {
        "guidance_count": len(guidance),
        "guidance_version": options.get("_ppt_guidance_version", 0),
        "guidance": guidance,
        "source_material_count": len(public_items),
        "source_materials": public_items,
        "warnings": (materials.get("warnings") or [])[:10],
    }


def _pipeline_summary(intent, outline, pages, html_pages, images, renderer, renderer_note, design_system=None, quality_report=None, options=None):
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
        "mode": "project_html_image_pipeline",
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
        "interaction": _public_ppt_interaction(options),
        "stages": [
            {"step": 1, "id": "understand", "title": "主题理解", "status": "done"},
            {"step": 2, "id": "outline", "title": "确认内容大纲", "status": "done", "count": len(outline)},
            {"step": 3, "id": "page_types", "title": "逐页确定页面类型", "status": "done", "count": len(page_types)},
            {"step": 4, "id": "design_recipe", "title": "选择 模板风格与主题", "status": "done", "theme": (design_system or {}).get("theme_name")},
            {"step": 5, "id": "layout_blueprint", "title": "为每页生成布局蓝图", "status": "done", "count": len(page_types)},
            {"step": 6, "id": "html_design", "title": "生成 HTML", "status": "done", "count": len(html_pages)},
            {"step": 7, "id": "quality_review", "title": "项目模板规则检查", "status": "done" if (quality_report or {}).get("passed", True) else "warning"},
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
