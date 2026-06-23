from __future__ import annotations

import re
from datetime import date
from typing import Any

import requests

from .lms_credentials import CredentialError
from .lms_login import LmsLoginError
from .lms_scores import JWXT_LOGIN_URL, ScoreQueryError, _login_to_service, _norm_text, _to_float


JWXT_HOME_REFERER = "https://jwxt.xjtu.edu.cn/jwapp/sys/homeapp/home/index.html?av=&contextPath=/jwapp"
JWXT_USER_ROLE_URL = "https://jwxt.xjtu.edu.cn/jwapp/sys/homeapp/api/home/currentUser.do"
JWXT_CHANGE_ROLE_URL = "https://jwxt.xjtu.edu.cn/jwapp/sys/homeapp/api/home/changeAppRole.do"
JWXT_EMPTY_ROOM_REFERER = "https://jwxt.xjtu.edu.cn/jwapp/sys/kxjas/*default/index.do"
JWXT_CAMPUS_CODE_URL = "https://jwxt.xjtu.edu.cn/jwapp/code/83a986fc-e677-400e-99a4-c7bb39c2ca35.do"
JWXT_BUILDING_CODE_URL = "https://jwxt.xjtu.edu.cn/jwapp/code/551fbcc3-cf07-4566-af1e-fc7ce272ddc1.do"
JWXT_EMPTY_ROOM_URL = "https://jwxt.xjtu.edu.cn/jwapp/sys/kxjas/modules/kxjscx/cxkxjs.do"


CAMPUS_BUILDING_OPTIONS: dict[str, list[str]] = {
    "兴庆校区": [
        "主楼A", "主楼B", "主楼C", "主楼D", "中2", "中3", "西2东", "西2西",
        "外文楼A", "外文楼B", "东1东", "东2", "仲英楼", "东1西", "教2西",
        "教2楼", "中1", "主楼E座", "工程馆", "工程坊A区", "文管", "计教中心", "田家炳",
    ],
    "雁塔校区": [
        "东配楼", "微免楼", "综合楼", "教学楼", "药学楼", "解剖楼", "生化楼",
        "病理楼", "西配楼", "一附院科教楼", "二院教学楼", "护理楼", "卫法楼",
    ],
    "曲江校区": ["西一楼", "西五楼", "西四楼", "西六楼"],
    "创新港校区": [
        "1号巨构", "2号巨构", "3号巨构", "4号巨构", "5号巨构", "9号巨构",
        "18号巨构", "19号巨构", "20号巨构", "21号巨构", "图书馆", "2号绿楔",
        "3号绿楔", "主楼运动场", "工程博物馆-创新港",
    ],
    "苏州校区": ["公共学院5号楼"],
}


def _to_int(value: Any) -> int | None:
    number = _to_float(value)
    if number is None:
        return None
    return int(number)


def _default_building(campus: str) -> str:
    if campus == "兴庆校区":
        return "主楼D"
    buildings = CAMPUS_BUILDING_OPTIONS.get(campus) or []
    return buildings[0] if buildings else ""


def _validate_date(value: Any) -> str:
    text = _norm_text(value) or date.today().isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise ScoreQueryError("BAD_REQUEST", "日期格式应为 YYYY-MM-DD。", http_status=400)
    try:
        date.fromisoformat(text)
    except ValueError as exc:
        raise ScoreQueryError("BAD_REQUEST", "日期不是有效日历日期。", http_status=400) from exc
    return text


def _validate_period(value: Any, default: int, name: str) -> int:
    if value is None or value == "":
        return default
    try:
        period = int(value)
    except (TypeError, ValueError) as exc:
        raise ScoreQueryError("BAD_REQUEST", f"{name} 必须是 1-11 的整数。", http_status=400) from exc
    if period < 1 or period > 11:
        raise ScoreQueryError("BAD_REQUEST", f"{name} 必须在 1-11 之间。", http_status=400)
    return period


def _validate_query(body: dict[str, Any]) -> tuple[str, str, str, int, int]:
    campus = _norm_text(body.get("campus")) or "兴庆校区"
    if campus not in CAMPUS_BUILDING_OPTIONS:
        allowed = "、".join(CAMPUS_BUILDING_OPTIONS.keys())
        raise ScoreQueryError("BAD_REQUEST", f"未知校区：{campus}。可选校区：{allowed}。", http_status=400)

    building = _norm_text(body.get("building")) or _default_building(campus)
    if building not in CAMPUS_BUILDING_OPTIONS[campus]:
        allowed = "、".join(CAMPUS_BUILDING_OPTIONS[campus])
        raise ScoreQueryError("BAD_REQUEST", f"{campus} 不包含教学楼：{building}。可选教学楼：{allowed}。", http_status=400)

    query_date = _validate_date(body.get("date"))
    start_period = _validate_period(body.get("start_period"), 1, "start_period")
    end_period = _validate_period(body.get("end_period"), 11, "end_period")
    if start_period > end_period:
        raise ScoreQueryError("BAD_REQUEST", "start_period 不能大于 end_period。", http_status=400)
    return campus, building, query_date, start_period, end_period


def _ensure_student_role(session: requests.Session) -> None:
    response = session.get(
        JWXT_USER_ROLE_URL,
        headers={"Referer": JWXT_HOME_REFERER},
        timeout=20,
    )
    response.raise_for_status()
    data = response.json()
    if str((data or {}).get("code")) != "0":
        raise ScoreQueryError(
            "JWXT_ROLE_FAILED",
            _norm_text((data or {}).get("msg")) or "教务系统没有返回可用身份信息。",
        )

    roles = (((data or {}).get("datas") or {}).get("userGroups") or [])
    if not isinstance(roles, list):
        raise ScoreQueryError("JWXT_ROLE_PARSE_FAILED", "教务系统身份信息格式无法识别。")

    current = None
    student_role = None
    for role in roles:
        if not isinstance(role, dict):
            continue
        role_name = _norm_text(role.get("roleName"))
        if role.get("currentRole"):
            current = role
        if role_name == "学生":
            student_role = role

    if current and _norm_text(current.get("roleName")) == "学生":
        return
    if not student_role or not student_role.get("roleId"):
        raise ScoreQueryError("JWXT_ROLE_UNAVAILABLE", "当前账号不包含“学生”身份，无法查询空闲教室。")

    change = session.post(
        JWXT_CHANGE_ROLE_URL,
        data={"appRole": student_role["roleId"]},
        headers={"Referer": JWXT_HOME_REFERER},
        timeout=20,
    )
    change.raise_for_status()


def _fetch_code_map(session: requests.Session, url: str) -> dict[str, str]:
    response = session.post(
        url,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Referer": JWXT_EMPTY_ROOM_REFERER,
            "X-Requested-With": "XMLHttpRequest",
        },
        timeout=20,
    )
    response.raise_for_status()
    try:
        data = response.json()
    except ValueError as exc:
        raise ScoreQueryError("JWXT_BAD_RESPONSE", "教务系统没有返回可解析的校区/教学楼代码。") from exc

    rows = (((data or {}).get("datas") or {}).get("code") or {}).get("rows")
    if not isinstance(rows, list):
        raise ScoreQueryError("JWXT_CODE_PARSE_FAILED", "教务系统校区/教学楼代码格式无法识别。")
    result: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = _norm_text(row.get("name"))
        code = _norm_text(row.get("id"))
        if name and code:
            result[name] = code
    return result


def _normalize_empty_room(row: dict[str, Any]) -> dict[str, Any] | None:
    if row.get("JASLXDM") is None:
        return None
    name = _norm_text(row.get("JASMC"))
    if not name or "测试专用" in name:
        return None
    return {
        "name": name,
        "buildingName": _norm_text(row.get("JXLDM_DISPLAY")),
        "type": _norm_text(row.get("JASLXDM_DISPLAY")),
        "capacity": _to_int(row.get("SKZWS")),
        "examCapacity": _to_int(row.get("KSZWS")),
        "campusName": _norm_text(row.get("XXXQDM_DISPLAY")),
    }


def _query_empty_rooms(
    session: requests.Session,
    campus_code: str,
    building_code: str,
    query_date: str,
    start_period: int,
    end_period: int,
) -> list[dict[str, Any]]:
    response = session.post(
        JWXT_EMPTY_ROOM_URL,
        data={
            "XXXQDM": campus_code,
            "JXLDM": building_code,
            "KXRQ": query_date,
            "KSJC": start_period,
            "JSJC": end_period,
            "pageSize": 500,
            "pageNumber": 1,
        },
        headers={
            "Referer": JWXT_EMPTY_ROOM_REFERER,
            "X-Requested-With": "XMLHttpRequest",
        },
        timeout=30,
    )
    response.raise_for_status()
    try:
        data = response.json()
    except ValueError as exc:
        raise ScoreQueryError("JWXT_BAD_RESPONSE", "教务系统没有返回可解析的空闲教室数据。") from exc

    rows = (((data or {}).get("datas") or {}).get("cxkxjs") or {}).get("rows")
    if not isinstance(rows, list):
        raise ScoreQueryError("JWXT_EMPTY_ROOM_PARSE_FAILED", "空闲教室接口返回格式无法识别。")

    rooms: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        room = _normalize_empty_room(row)
        if not room:
            continue
        key = f"{room.get('campusName')}|{room.get('buildingName')}|{room.get('name')}"
        if key in seen:
            continue
        seen.add(key)
        rooms.append(room)
    return sorted(rooms, key=lambda item: (item.get("buildingName") or "", item.get("name") or ""))


def _login_to_jwxt_for_empty_rooms() -> tuple[requests.Session, str]:
    try:
        return _login_to_service(JWXT_LOGIN_URL, "undergraduate")
    except ScoreQueryError as exc:
        message = exc.message.replace("成绩查询", "空闲教室查询")
        raise ScoreQueryError(exc.code, message, exc.http_status) from exc


def handle_lms_empty_rooms_request(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    try:
        action = str(body.get("action") or "query").strip().lower()
        if action == "options":
            return 200, {"ok": True, "campuses": CAMPUS_BUILDING_OPTIONS}
        if action != "query":
            raise ScoreQueryError("BAD_REQUEST", "action 只能是 query 或 options。", http_status=400)

        campus, building, query_date, start_period, end_period = _validate_query(body)

        session, username = _login_to_jwxt_for_empty_rooms()
        _ensure_student_role(session)

        campus_codes = _fetch_code_map(session, JWXT_CAMPUS_CODE_URL)
        building_codes = _fetch_code_map(session, JWXT_BUILDING_CODE_URL)
        campus_code = campus_codes.get(campus)
        building_code = building_codes.get(building)
        if not campus_code:
            raise ScoreQueryError("JWXT_CAMPUS_NOT_FOUND", f"教务系统未返回校区代码：{campus}。")
        if not building_code:
            raise ScoreQueryError("JWXT_BUILDING_NOT_FOUND", f"教务系统未返回教学楼代码：{building}。")

        rooms = _query_empty_rooms(session, campus_code, building_code, query_date, start_period, end_period)
        return 200, {
            "ok": True,
            "account_type": "undergraduate",
            "username": username,
            "campus": campus,
            "building": building,
            "date": query_date,
            "start_period": start_period,
            "end_period": end_period,
            "rooms": rooms,
            "summary": {"count": len(rooms)},
        }

    except CredentialError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except ScoreQueryError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except LmsLoginError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except requests.RequestException as exc:
        return 200, {"ok": False, "error": "NETWORK_ERROR", "message": f"连接教务空闲教室系统失败：{exc}"}
    except Exception as exc:
        return 500, {"ok": False, "error": "INTERNAL_ERROR", "message": f"空闲教室查询内部错误：{exc}"}
