from __future__ import annotations

import re
from html import unescape
from typing import Any

import requests

from .lms_credentials import CredentialError
from .lms_login import LmsLoginError
from .lms_scores import (
    GMIS_LOGIN_URL,
    JWXT_LOGIN_URL,
    ScoreQueryError,
    _login_to_service,
    _norm_text,
    _to_float,
)


JWXT_CURRENT_TERM_URL = "https://jwxt.xjtu.edu.cn/jwapp/sys/wdkb/modules/jshkcb/dqxnxq.do"
JWXT_SCHEDULE_URL = "https://jwxt.xjtu.edu.cn/jwapp/sys/wdkb/modules/xskcb/xskcb.do"
JWXT_TERM_START_URL = "https://jwxt.xjtu.edu.cn/jwapp/sys/wdkb/modules/jshkcb/cxjcs.do"
GMIS_SCHEDULE_URL = "https://gmis.xjtu.edu.cn/pyxx/pygl/xskbcx"


def _to_int(value: Any) -> int | None:
    number = _to_float(value)
    if number is None:
        return None
    return int(number)


def _weeks_from_bitmap(bitmap: Any) -> list[int]:
    text = str(bitmap or "")
    return [idx + 1 for idx, value in enumerate(text) if value == "1"]


def _parse_weeks_string(weeks_str: str) -> list[int]:
    if not weeks_str:
        return []
    text = str(weeks_str).strip().replace("第", "").replace("周", "")
    for sep in ("，", "、", ";", "；", " "):
        text = text.replace(sep, ",")
    weeks: set[int] = set()
    for part in [p.strip() for p in text.split(",") if p.strip()]:
        if "-" in part:
            try:
                start, end = [int(x.strip()) for x in part.split("-", 1)]
            except ValueError:
                continue
            if start > end:
                start, end = end, start
            weeks.update(range(start, end + 1))
        else:
            try:
                weeks.add(int(part))
            except ValueError:
                continue
    return sorted(weeks)


def _format_weeks(weeks: list[int]) -> str:
    if not weeks:
        return ""
    ranges: list[str] = []
    start = prev = weeks[0]
    for week in weeks[1:]:
        if week == prev + 1:
            prev = week
            continue
        ranges.append(str(start) if start == prev else f"{start}-{prev}")
        start = prev = week
    ranges.append(str(start) if start == prev else f"{start}-{prev}")
    return "第" + "、".join(ranges) + "周"


def _query_jwxt_current_term(session: requests.Session) -> str:
    response = session.post(
        JWXT_CURRENT_TERM_URL,
        headers={"Accept": "application/json, text/javascript, */*; q=0.01"},
        timeout=20,
    )
    response.raise_for_status()
    data = response.json()
    rows = (((data or {}).get("datas") or {}).get("dqxnxq") or {}).get("rows") or []
    if not rows:
        raise ScoreQueryError("JWXT_TERM_FAILED", "本科教务系统没有返回当前学期。")
    return _norm_text(rows[0].get("DM"))


def _query_jwxt_term_start(session: requests.Session, term: str) -> str | None:
    parts = term.split("-")
    if len(parts) != 3:
        return None
    response = session.post(
        JWXT_TERM_START_URL,
        data={"XN": f"{parts[0]}-{parts[1]}", "XQ": parts[2]},
        timeout=20,
    )
    response.raise_for_status()
    try:
        data = response.json()
        rows = (((data or {}).get("datas") or {}).get("cxjcs") or {}).get("rows") or []
        if not rows:
            return None
        return _norm_text(rows[0].get("XQKSRQ")).split(" ")[0]
    except Exception:
        return None


def _normalize_jwxt_lesson(row: dict[str, Any], term: str) -> dict[str, Any] | None:
    name = _norm_text(row.get("KCM"))
    day = _to_int(row.get("SKXQ"))
    start = _to_int(row.get("KSJC"))
    end = _to_int(row.get("JSJC"))
    if not name or day is None or start is None or end is None:
        return None
    weeks = _weeks_from_bitmap(row.get("SKZC"))
    return {
        "source": "jwxt",
        "accountType": "undergraduate",
        "term": _norm_text(row.get("XNXQDM")) or term,
        "name": name,
        "courseCode": _norm_text(row.get("KCH")),
        "teacher": _norm_text(row.get("SKJS")),
        "classroom": _norm_text(row.get("JASMC")),
        "dayOfWeek": day,
        "periodStart": start,
        "periodEnd": end,
        "weeks": weeks,
        "weeksText": _format_weeks(weeks),
        "rawTime": _norm_text(row.get("SKSJ")),
    }


def _query_undergraduate_schedule(session: requests.Session, term: str | None) -> dict[str, Any]:
    current_term = term or _query_jwxt_current_term(session)
    response = session.post(JWXT_SCHEDULE_URL, data={"XNXQDM": current_term}, timeout=30)
    response.raise_for_status()
    data = response.json()
    rows = (((data or {}).get("datas") or {}).get("xskcb") or {}).get("rows")
    if not isinstance(rows, list):
        raise ScoreQueryError("JWXT_SCHEDULE_PARSE_FAILED", "本科课表接口返回格式无法识别。")
    lessons = [_normalize_jwxt_lesson(row, current_term) for row in rows if isinstance(row, dict)]
    lessons = [lesson for lesson in lessons if lesson]
    return {
        "account_type": "undergraduate",
        "term": current_term,
        "start_date": _query_jwxt_term_start(session, current_term),
        "lessons": _sort_lessons(lessons),
    }


def _gmis_timestamp_to_term(timestamp: str) -> str:
    parts = timestamp.split("-")
    if len(parts) != 3 or parts[2] not in ("1", "2"):
        raise ScoreQueryError("BAD_REQUEST", "研究生课表学期格式应为 2024-2025-1 或 2024-2025-2。", http_status=400)
    start_year = int(parts[0])
    return f"{start_year}秋" if parts[2] == "1" else f"{start_year + 1}春"


def _gmis_term_to_timestamp(term: str) -> str:
    term = _norm_text(term)
    if len(term) < 5:
        return ""
    year = term[:-1]
    season = term[-1]
    if not year.isdigit():
        return ""
    year_no = int(year)
    if season == "秋":
        return f"{year_no}-{year_no + 1}-1"
    if season == "春":
        return f"{year_no - 1}-{year_no}-2"
    return ""


def _extract_gmis_options(html: str) -> dict[str, str]:
    select_match = re.search(
        r"<select\b(?=[^>]*\bid\s*=\s*['\"]drpxq['\"])[^>]*>(?P<body>.*?)</select>",
        html or "",
        re.IGNORECASE | re.DOTALL,
    )
    if not select_match:
        return {}
    options: dict[str, str] = {}
    for match in re.finditer(r"<option\b(?P<attrs>[^>]*)>(?P<text>.*?)</option>", select_match.group("body"), re.I | re.S):
        attrs = match.group("attrs") or ""
        value_match = re.search(r"\bvalue\s*=\s*['\"](?P<value>[^'\"]+)['\"]", attrs, re.I)
        text = _norm_text(re.sub(r"<[^>]+>", "", match.group("text") or ""))
        if value_match and text:
            options[text] = unescape(value_match.group("value")).strip()
    return options


def _extract_gmis_current_term(html: str) -> str:
    select_match = re.search(
        r"<select\b(?=[^>]*\bid\s*=\s*['\"]drpxq['\"])[^>]*>(?P<body>.*?)</select>",
        html or "",
        re.IGNORECASE | re.DOTALL,
    )
    if not select_match:
        return ""
    for match in re.finditer(r"<option\b(?P<attrs>[^>]*)>(?P<text>.*?)</option>", select_match.group("body"), re.I | re.S):
        attrs = match.group("attrs") or ""
        if "selected" not in attrs.lower():
            continue
        return _norm_text(re.sub(r"<[^>]+>", "", match.group("text") or ""))
    return ""


def _extract_gmis_lessons(html: str, term: str) -> list[dict[str, Any]]:
    lessons: list[dict[str, Any]] = []
    pattern = (
        r'document\.getElementById\("td_(\d+)_(\d+)"\);\s*'
        r'if\s*\(td\.innerHTML!=""\)\s*td\.innerHTML\+="<br><br>";\s*'
        r'td\.innerHTML\+="([^"]+)";'
    )
    for match in re.finditer(pattern, html or "", re.MULTILINE | re.DOTALL):
        day = int(match.group(1))
        text = unescape(match.group(3))
        name_match = re.search(r"课程：([^<]+)", text)
        teacher_match = re.search(r"教师：([^<]+)", text)
        classroom_match = re.search(r"教室：([^<]+)", text)
        periods_match = re.search(r"节次：([^<]+)", text)
        weeks_match = re.search(r"周次：([^<]+)", text)
        if not (name_match and periods_match and weeks_match):
            continue
        period_start, period_end = _parse_periods(periods_match.group(1))
        weeks_text = _norm_text(weeks_match.group(1))
        weeks = _parse_weeks_string(weeks_text)
        lesson = {
            "source": "gmis",
            "accountType": "postgraduate",
            "term": term,
            "name": _norm_text(name_match.group(1)),
            "courseCode": "",
            "teacher": _norm_text(teacher_match.group(1) if teacher_match else ""),
            "classroom": _norm_text(classroom_match.group(1) if classroom_match else ""),
            "dayOfWeek": day,
            "periodStart": period_start,
            "periodEnd": period_end,
            "weeks": weeks,
            "weeksText": weeks_text,
            "rawTime": "",
        }
        if lesson not in lessons:
            lessons.append(lesson)
    return _sort_lessons(lessons)


def _parse_periods(text: str) -> tuple[int, int]:
    text = _norm_text(text)
    if "-" in text:
        try:
            start, end = [int(x.strip()) for x in text.split("-", 1)]
            return start, end
        except ValueError:
            return 0, 0
    try:
        period = int(text)
        return period, period
    except ValueError:
        return 0, 0


def _query_graduate_schedule(session: requests.Session, term: str | None) -> dict[str, Any]:
    response = session.get(GMIS_SCHEDULE_URL, timeout=30)
    response.raise_for_status()
    html = response.text
    options = _extract_gmis_options(html)
    if term:
        term_display = _gmis_timestamp_to_term(term)
        value = options.get(term_display)
        if not value:
            raise ScoreQueryError("GMIS_TERM_NOT_FOUND", f"研究生系统没有找到学期 {term_display}。")
        response = session.get(f"{GMIS_SCHEDULE_URL}/index/{value}", timeout=30)
        response.raise_for_status()
        html = response.text
        term_number = term
    else:
        term_display = _extract_gmis_current_term(html)
        term_number = _gmis_term_to_timestamp(term_display)
    return {
        "account_type": "postgraduate",
        "term": term_number,
        "start_date": None,
        "lessons": _extract_gmis_lessons(html, term_number),
    }


def _sort_lessons(lessons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        lessons,
        key=lambda item: (
            item.get("dayOfWeek") or 99,
            item.get("periodStart") or 99,
            item.get("periodEnd") or 99,
            item.get("name") or "",
        ),
    )


def _summarize_lessons(lessons: list[dict[str, Any]]) -> dict[str, Any]:
    by_day: dict[str, int] = {}
    for lesson in lessons:
        key = str(lesson.get("dayOfWeek") or "")
        if not key:
            continue
        by_day[key] = by_day.get(key, 0) + 1
    return {
        "count": len(lessons),
        "byDay": by_day,
    }


def _query_schedule_for_type(account_type: str, term: str | None) -> dict[str, Any]:
    if account_type == "undergraduate":
        session, username = _login_to_service(JWXT_LOGIN_URL, "undergraduate")
        result = _query_undergraduate_schedule(session, term)
    elif account_type == "postgraduate":
        session, username = _login_to_service(GMIS_LOGIN_URL, "postgraduate")
        result = _query_graduate_schedule(session, term)
    else:
        raise ScoreQueryError("BAD_REQUEST", "account_type 只能是 auto、undergraduate 或 postgraduate。", http_status=400)

    lessons = result.get("lessons") or []
    return {
        **result,
        "username": username,
        "summary": _summarize_lessons(lessons),
    }


def _error_payload(error: Exception) -> dict[str, str]:
    if isinstance(error, ScoreQueryError):
        return {"error": error.code, "message": error.message}
    if isinstance(error, LmsLoginError):
        return {"error": error.code, "message": error.message}
    if isinstance(error, requests.RequestException):
        return {"error": "NETWORK_ERROR", "message": f"连接学校课表系统失败：{error}"}
    return {"error": "UNKNOWN_ERROR", "message": str(error)}


def handle_lms_schedule_request(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    try:
        account_type = str(body.get("account_type") or "auto").strip().lower()
        term = _norm_text(body.get("term")) or None
        if term and not re.fullmatch(r"\d{4}-\d{4}-[1-3]", term):
            raise ScoreQueryError("BAD_REQUEST", "学期格式应为 2024-2025-1。", http_status=400)

        if account_type == "auto":
            successes: list[dict[str, Any]] = []
            errors: list[dict[str, str]] = []
            for candidate in ("undergraduate", "postgraduate"):
                try:
                    result = _query_schedule_for_type(candidate, term)
                    if result["lessons"]:
                        return 200, {"ok": True, **result, "mode": "auto"}
                    successes.append(result)
                except CredentialError:
                    raise
                except (ScoreQueryError, LmsLoginError, requests.RequestException) as exc:
                    detail = _error_payload(exc)
                    detail["account_type"] = candidate
                    errors.append(detail)
            if successes:
                return 200, {"ok": True, **successes[0], "mode": "auto", "warnings": errors}
            return 200, {
                "ok": False,
                "error": "SCHEDULE_QUERY_FAILED",
                "message": "自动识别本科/研究生课表均未成功，请手动选择身份后重试。",
                "errors": errors,
            }

        result = _query_schedule_for_type(account_type, term)
        return 200, {"ok": True, **result, "mode": "manual"}

    except CredentialError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except ScoreQueryError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except LmsLoginError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except requests.RequestException as exc:
        return 200, {"ok": False, "error": "NETWORK_ERROR", "message": f"连接学校课表系统失败：{exc}"}
    except Exception as exc:
        return 500, {"ok": False, "error": "INTERNAL_ERROR", "message": f"课表查询内部错误：{exc}"}
