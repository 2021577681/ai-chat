"""Deterministic layout guard and reflow helpers for PPT DeckSpec slides.

The LLM is allowed to decide *what* a slide should say, but this module decides
whether the requested structure is safe for the native PPT renderer.  It applies
capacity limits before rendering so validation/repair is a fallback rather than
the primary layout strategy.
"""

from copy import deepcopy

from .schemas import normalize_layout


LAYOUT_CAPACITY = {
    "agenda": {"items": 7, "item_chars": 24},
    "summary": {"items": 5, "item_chars": 30},
    "bullets": {"items": 6, "item_chars": 34},
    "three_cards": {"items": 3, "title_chars": 14, "desc_chars": 36},
    "process": {"items": 4, "title_chars": 12, "desc_chars": 30},
    "method_pipeline": {"items": 4, "title_chars": 12, "desc_chars": 30},
    "timeline": {"items": 4, "title_chars": 12, "desc_chars": 26},
    "comparison": {"items": 5, "item_chars": 24},
    "architecture": {"items": 4, "item_chars": 18},
    "table": {"rows": 6, "cols": 5, "cell_chars": 16},
}


def _shorten(text, limit):
    text = str(text or "").strip()
    if limit <= 0:
        return ""
    return text if len(text) <= limit else text[: max(0, limit - 1)].rstrip() + "…"


def _chunk(seq, size):
    seq = list(seq or [])
    size = max(1, int(size or 1))
    return [seq[i : i + size] for i in range(0, len(seq), size)] or [[]]


def _with_title_suffix(slide, index, total):
    item = deepcopy(slide)
    if total > 1:
        base_title = str(item.get("title") or "").strip()
        item["title"] = _shorten(f"{base_title}（{index}/{total}）", 22)
    return item


def _text_pressure(values, limit):
    if not values:
        return 0.0
    limit = max(1, int(limit or 1))
    return max(len(str(v or "")) / limit for v in values)


def _mark(slide, action, reason):
    contract = slide.get("layout_contract") if isinstance(slide.get("layout_contract"), dict) else {}
    history = contract.get("reflow_history") if isinstance(contract.get("reflow_history"), list) else []
    history.append({"action": action, "reason": reason})
    contract["reflow_history"] = history
    contract.setdefault("layout_engine", "deterministic_capacity_guard")
    contract.setdefault("ai_controls", "content_structure_only")
    slide["layout_contract"] = contract
    return slide


def _compact_cards(cards, cap):
    out = []
    for card in list(cards or []):
        if isinstance(card, dict):
            x = dict(card)
            x["title"] = _shorten(x.get("title"), cap.get("title_chars", 14))
            x["desc"] = _shorten(x.get("desc") or x.get("text"), cap.get("desc_chars", 36))
            out.append(x)
        else:
            out.append({"title": _shorten(card, cap.get("title_chars", 14)), "desc": ""})
    return out


def _compact_steps(steps, cap):
    out = []
    for step in list(steps or []):
        if isinstance(step, dict):
            x = dict(step)
            x["title"] = _shorten(x.get("title"), cap.get("title_chars", 12))
            x["desc"] = _shorten(x.get("desc") or x.get("text"), cap.get("desc_chars", 30))
            out.append(x)
        else:
            out.append({"title": _shorten(step, cap.get("title_chars", 12)), "desc": ""})
    return out


def _compact_events(events, cap):
    out = []
    for event in list(events or []):
        if isinstance(event, dict):
            x = dict(event)
            x["time"] = _shorten(x.get("time") or x.get("date"), 10)
            x["title"] = _shorten(x.get("title"), cap.get("title_chars", 12))
            x["desc"] = _shorten(x.get("desc") or x.get("text"), cap.get("desc_chars", 26))
            out.append(x)
        else:
            out.append({"time": "", "title": _shorten(event, cap.get("title_chars", 12)), "desc": ""})
    return out


def _compact_text_items(items, limit):
    return [_shorten(x.get("title") or x.get("text") or x.get("desc") if isinstance(x, dict) else x, limit) for x in list(items or [])]


def _split_slide(slide, key, chunks, report, reason):
    total = len(chunks)
    out = []
    for idx, part in enumerate(chunks, 1):
        item = _with_title_suffix(slide, idx, total)
        item[key] = part
        out.append(_mark(item, "split_slide", reason))
    report["actions"].append({
        "slide": slide.get("title"),
        "action": "split_slide",
        "key": key,
        "parts": total,
        "reason": reason,
    })
    return out


def _reflow_cards(slide, report):
    cap = LAYOUT_CAPACITY["three_cards"]
    cards = _compact_cards(slide.get("cards") or slide.get("items"), cap)
    if len(cards) > cap["items"]:
        chunks = [_compact_cards(c, cap) for c in _chunk(cards, cap["items"])]
        return _split_slide(slide, "cards", chunks, report, "卡片数量超过安全槽位，自动拆页")
    item = deepcopy(slide)
    item["type"] = item["layout"] = "three_cards"
    item["cards"] = cards
    return [_mark(item, "capacity_check", "卡片内容已压缩到模板容量内")]


def _reflow_steps(slide, report, layout):
    cap = LAYOUT_CAPACITY[layout]
    steps = _compact_steps(slide.get("steps") or slide.get("items"), cap)
    if len(steps) > cap["items"]:
        chunks = [_compact_steps(c, cap) for c in _chunk(steps, cap["items"])]
        return _split_slide(slide, "steps", chunks, report, "步骤数量超过安全槽位，自动拆页")
    item = deepcopy(slide)
    item["type"] = item["layout"] = layout
    item["steps"] = steps
    return [_mark(item, "capacity_check", "流程内容已压缩到模板容量内")]


def _reflow_timeline(slide, report):
    cap = LAYOUT_CAPACITY["timeline"]
    events = _compact_events(slide.get("events") or slide.get("items"), cap)
    if len(events) > cap["items"]:
        chunks = [_compact_events(c, cap) for c in _chunk(events, cap["items"])]
        return _split_slide(slide, "events", chunks, report, "时间轴节点超过横向安全容量，自动拆页")
    item = deepcopy(slide)
    item["type"] = item["layout"] = "timeline"
    item["events"] = events
    return [_mark(item, "capacity_check", "时间轴内容已压缩到模板容量内")]


def _reflow_bullets(slide, report, layout="bullets"):
    cap = LAYOUT_CAPACITY.get(layout, LAYOUT_CAPACITY["bullets"])
    raw = slide.get("bullets") or slide.get("items") or []
    items = _compact_text_items(raw, cap.get("item_chars", 34))
    max_items = cap.get("items", 6)
    key = "items" if layout in ("agenda", "summary") else "bullets"
    if len(items) > max_items:
        chunks = [_compact_text_items(c, cap.get("item_chars", 34)) for c in _chunk(items, max_items)]
        return _split_slide(slide, key, chunks, report, "列表项超过安全容量，自动拆页")
    item = deepcopy(slide)
    item["type"] = item["layout"] = layout
    item[key] = items
    return [_mark(item, "capacity_check", "列表内容已压缩到模板容量内")]


def _reflow_comparison(slide, report):
    cap = LAYOUT_CAPACITY["comparison"]
    item = deepcopy(slide)
    for side in ("left", "right"):
        box = item.get(side) if isinstance(item.get(side), dict) else {}
        values = _compact_text_items(box.get("items"), cap["item_chars"])
        if len(values) > cap["items"]:
            values = values[: cap["items"]]
            report["actions"].append({"slide": slide.get("title"), "action": "trim_items", "side": side, "reason": "对比栏内容超过容量"})
        item[side] = {"title": _shorten(box.get("title") or side, 12), "items": values}
    item["type"] = item["layout"] = "comparison"
    return [_mark(item, "capacity_check", "对比内容已压缩到双栏容量内")]


def enforce_layout_constraints(slides, options=None):
    """Apply template capacity limits, text compaction and safe pagination."""
    report = {
        "strategy": "ai_content_structure_plus_deterministic_layout",
        "ai_controls": "content_structure_only",
        "layout_engine": "template_slots_capacity_guard",
        "actions": [],
    }
    out = []
    for raw in list(slides or []):
        if not isinstance(raw, dict):
            continue
        slide = deepcopy(raw)
        layout = normalize_layout(slide.get("type") or slide.get("layout") or slide.get("content_type"))
        slide["type"] = slide["layout"] = layout
        slide["title"] = _shorten(slide.get("title"), 22)

        if layout == "three_cards":
            out.extend(_reflow_cards(slide, report))
        elif layout in ("process", "method_pipeline"):
            out.extend(_reflow_steps(slide, report, layout))
        elif layout == "timeline":
            out.extend(_reflow_timeline(slide, report))
        elif layout in ("agenda", "summary", "bullets"):
            out.extend(_reflow_bullets(slide, report, layout))
        elif layout == "comparison":
            out.extend(_reflow_comparison(slide, report))
        else:
            out.append(_mark(slide, "capacity_check", "该版式使用确定性模板槽位渲染"))

    report["input_slides"] = len(slides or [])
    report["output_slides"] = len(out)
    report["reflowed"] = report["output_slides"] != report["input_slides"] or bool(report["actions"])
    return out, report
