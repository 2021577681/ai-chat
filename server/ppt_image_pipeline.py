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
3. 让 AI 后续 HTML 设计可以自由发挥视觉表现。"""


DEFAULT_HTML_PROMPT = """你是资深 HTML 演示页面设计师。请为单页 PPT 生成完整、可截图的 16:9 HTML 设计稿。
只输出 JSON，不要解释。输出结构：{"html":"<!doctype html>..."}
硬性要求：
1. 画布为 1600x900 或自适应 16:9，body margin 为 0。
2. HTML 必须自包含，CSS 写在 <style> 内，不依赖外网字体、图片、脚本或第三方库。
3. 不要输出 Markdown，不要输出解释。
4. 设计应根据主题自由发挥，不受固定 PPT 模板限制。
5. 页面信息必须完整但不拥挤，文本不能明显溢出画布。"""


def generate_html_image_ppt(data):
    """Generate a PPTX where every slide is one rendered image."""
    try:
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

        intent = _understand_request(request_text, target_count, options)
        outline = _plan_outline(request_text, intent, target_count, options)
        pages = _plan_page_types(request_text, intent, outline, options)
        html_pages = _generate_html_pages(request_text, intent, pages, html_dir, options)
        images, renderer, renderer_note = _render_html_pages(html_pages, image_dir)

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
        prs.save(out_path)

        rel_path = _rel_path(out_path)
        pipeline = _pipeline_summary(intent, outline, pages, html_pages, images, renderer, renderer_note)
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
    user = json.dumps({
        "user_request": request_text,
        "intent": intent,
        "outline": outline,
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


def _generate_html_pages(request_text, intent, pages, html_dir, options):
    html_prompt = (
        _as_text(options.get("ppt_html_prompt") or "").strip()
        or _as_text(options.get("ppt_slide_prompt") or "").strip()
        or DEFAULT_HTML_PROMPT
    )
    html_pages = []
    for page in pages:
        user = json.dumps({
            "user_request": request_text,
            "intent": intent,
            "page": page,
            "canvas": {"width": _WIDTH, "height": _HEIGHT, "ratio": "16:9"},
            "style_preference": options.get("render_style") or intent.get("visual_direction") or "",
        }, ensure_ascii=False)
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
        filename = f"slide_{int(page.get('page') or len(html_pages) + 1):02d}.html"
        abs_path = os.path.join(html_dir, filename)
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(html_doc)
        item = dict(page)
        item.update({"abs_path": abs_path, "path": _rel_path(abs_path)})
        html_pages.append(item)
    return html_pages


def _sanitize_html(html_doc):
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
        "path": item.get("path"),
    }


def _public_image(item):
    return {
        "slide": item.get("page"),
        "title": item.get("title"),
        "page_type": item.get("page_type"),
        "path": item.get("path"),
    }


def _pipeline_summary(intent, outline, pages, html_pages, images, renderer, renderer_note):
    page_types = [
        {
            "page": page.get("page"),
            "title": page.get("title"),
            "page_type": page.get("page_type"),
            "visual_role": page.get("visual_role"),
        }
        for page in pages
    ]
    return {
        "mode": "html_image_v2",
        "intent": intent,
        "outline": outline,
        "page_types": page_types,
        "html_pages": [_public_html_page(item) for item in html_pages],
        "images": [_public_image(item) for item in images],
        "renderer": renderer,
        "renderer_note": renderer_note,
        "stages": [
            {"step": 1, "id": "understand", "title": "理解用户主题和内容", "status": "done"},
            {"step": 2, "id": "outline", "title": "生成 PPT 大纲", "status": "done", "count": len(outline)},
            {"step": 3, "id": "page_types", "title": "为每一页确定页面类型", "status": "done", "count": len(page_types)},
            {"step": 5, "id": "html_design", "title": "为每页生成 HTML 设计稿", "status": "done", "count": len(html_pages)},
            {
                "step": 6,
                "id": "browser_render",
                "title": "使用浏览器渲染为 16:9 图片",
                "status": "done" if renderer == "browser" else "warning",
                "count": len(images),
                "renderer": renderer,
            },
            {"step": 7, "id": "ppt_background", "title": "插入图片作为 PPT 背景", "status": "done", "count": len(images)},
            {"step": 9, "id": "export", "title": "导出 PPT", "status": "done"},
        ],
    }
