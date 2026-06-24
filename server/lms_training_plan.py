from __future__ import annotations

from typing import Any

import requests

from .lms_credentials import CredentialError
from .lms_login import LmsLoginError
from .lms_scores import ScoreQueryError, _login_to_service, _norm_text, _to_float


# grpyfacx.do 需要先访问 eHall 带 amp 安全上下文的应用入口，否则接口返回 403。
TRAINING_PLAN_INDEX_URL = (
    "https://ehall.xjtu.edu.cn/jwapp/sys/xsfacx/*default/index.do?"
    "amp_sec_version_=1&"
    "gid_=QlVjYkRQS2JiaDVWYXMxYmwxSGlTeHEwVC9oKys4WXFteXlmSmxxV3lVRnB5dzREeXg3MmNONnJBNXdaZ1ZWQ3Jwa3U4L056R0Zadk9zcmVHNTd0K3c9PQ&"
    "EMAP_LANG=zh&THEME=millennium#/ckgrpyfa"
)
TRAINING_PLAN_REFERER = TRAINING_PLAN_INDEX_URL
XSFACX_MODULE_BASE = "https://ehall.xjtu.edu.cn/jwapp/sys/xsfacx/modules/pyfacxepg"
JWPUB_PYFA_MODULE_BASE = "https://ehall.xjtu.edu.cn/jwapp/sys/jwpubapp/modules/pyfa"


def _to_int(value: Any) -> int | None:
    number = _to_float(value)
    if number is None:
        return None
    return int(number)


def _post_json_rows(
    session: requests.Session,
    url: str,
    table_key: str,
    data: dict[str, Any] | None = None,
    message_name: str = "培养方案",
) -> list[dict[str, Any]]:
    response = session.post(
        url,
        data=data or {},
        headers={
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Origin": "https://ehall.xjtu.edu.cn",
            "Referer": TRAINING_PLAN_REFERER,
            "X-Requested-With": "XMLHttpRequest",
        },
        timeout=30,
    )
    if response.status_code in (401, 403):
        raise ScoreQueryError(
            "JWXT_TRAINING_PLAN_ACCESS_DENIED",
            "培养方案入口安全上下文初始化失败，请确认仍能在浏览器打开个人培养方案页面。",
        )
    response.raise_for_status()
    try:
        payload = response.json()
    except ValueError as exc:
        raise ScoreQueryError("JWXT_BAD_RESPONSE", f"教务系统没有返回可解析的{message_name}数据。") from exc

    code = str((payload or {}).get("code", "0"))
    if code not in ("0", ""):
        msg = _norm_text((payload or {}).get("msg")) or f"教务系统返回错误码 {code}。"
        raise ScoreQueryError("JWXT_TRAINING_PLAN_FAILED", msg)

    rows = (((payload or {}).get("datas") or {}).get(table_key) or {}).get("rows")
    if not isinstance(rows, list):
        raise ScoreQueryError("JWXT_TRAINING_PLAN_PARSE_FAILED", f"{message_name}接口返回格式无法识别。")
    return [row for row in rows if isinstance(row, dict)]


def _login_to_training_plan() -> tuple[requests.Session, str]:
    try:
        session, username = _login_to_service(TRAINING_PLAN_INDEX_URL, "undergraduate")
    except ScoreQueryError as exc:
        message = exc.message.replace("成绩查询", "培养方案查询")
        raise ScoreQueryError(exc.code, message, exc.http_status) from exc

    response = session.get(
        TRAINING_PLAN_INDEX_URL,
        headers={"Referer": TRAINING_PLAN_REFERER},
        timeout=30,
    )
    if response.status_code in (401, 403):
        raise ScoreQueryError(
            "JWXT_TRAINING_PLAN_ACCESS_DENIED",
            "培养方案入口安全上下文初始化失败，请先在浏览器确认可以打开个人培养方案页面。",
        )
    response.raise_for_status()
    return session, username


def _normalize_plan(row: dict[str, Any], detail: dict[str, Any] | None = None) -> dict[str, Any]:
    source = {**row, **(detail or {})}
    required = _to_float(source.get("ZSYQXF") or source.get("ZSYQXFXSZ"))
    completed = _to_float(row.get("YWCXF"))
    remaining = None
    if required is not None and completed is not None:
        remaining = max(round(required - completed, 2), 0)
    progress = None
    if required and completed is not None:
        progress = max(0.0, min(round(completed / required * 100, 1), 100.0))

    return {
        "code": _norm_text(source.get("PYFADM")),
        "name": _norm_text(source.get("PYFAMC")),
        "routeCode": _norm_text(source.get("XDLXDM")),
        "routeName": _norm_text(source.get("XDLXDM_DISPLAY")),
        "majorCode": _norm_text(source.get("ZYDM")),
        "majorName": _norm_text(source.get("ZYDM_DISPLAY")),
        "departmentCode": _norm_text(source.get("YXDM") or source.get("DWDM")),
        "departmentName": _norm_text(source.get("YXDM_DISPLAY") or source.get("DWDM_DISPLAY")),
        "grade": _norm_text(source.get("XZNJ_DISPLAY") or source.get("NJDM_DISPLAY") or source.get("XZNJ")),
        "className": _norm_text(source.get("BJDM_DISPLAY")),
        "requiredCredits": required,
        "requiredCreditsText": _norm_text(source.get("ZSYQXFXSZ")),
        "completedCredits": completed,
        "remainingCredits": remaining,
        "progressPercent": progress,
        "durationYears": _to_float(source.get("XZNX")),
        "degreeName": _norm_text(source.get("XWDM_DISPLAY")),
        "levelName": _norm_text(source.get("PYCCDM_DISPLAY") or source.get("XLCCDM_DISPLAY")),
        "status": _norm_text(source.get("XSFAZT") or source.get("FAZTDM_DISPLAY")),
        "note": _norm_text(source.get("BZ")),
    }


def _normalize_course(row: dict[str, Any], group_name: str) -> dict[str, Any]:
    year = _norm_text(row.get("JHXNDM_DISPLAY") or row.get("JHXNDM"))
    term = _norm_text(row.get("JHXQDM_DISPLAY") or row.get("JHXQDM"))
    xnxq = _norm_text(row.get("XNXQ_DISPLAY") or row.get("XNXQ"))
    semester = _to_int(row.get("XDXNXQ"))
    if year and term:
        planned_term = f"{year} {term}"
    else:
        planned_term = xnxq or (f"第{semester}学期" if semester else "")

    return {
        "id": _norm_text(row.get("WID")),
        "groupId": _norm_text(row.get("KZH")),
        "groupName": group_name or _norm_text(row.get("KZM")),
        "courseCode": _norm_text(row.get("KCH")),
        "courseName": _norm_text(row.get("KCM")),
        "credits": _to_float(row.get("XF")),
        "hours": _to_float(row.get("XS")),
        "lectureHours": _to_float(row.get("KTJSXS")),
        "experimentHours": _to_float(row.get("SYXS")),
        "practiceHours": _to_float(row.get("KCSJXS")),
        "nature": _norm_text(row.get("KCXZDM_DISPLAY")),
        "examType": _norm_text(row.get("KSLXDM_DISPLAY")),
        "departmentName": _norm_text(row.get("KKDWDM_DISPLAY")),
        "plannedYear": year,
        "plannedTerm": term,
        "plannedTermText": planned_term,
        "plannedSemester": semester,
        "requiredFlag": _norm_text(row.get("SFZGKC_DISPLAY")),
        "remark": _norm_text(row.get("BZ")),
    }


def _normalize_groups(
    rows: list[dict[str, Any]],
    courses_by_group: dict[str, list[dict[str, Any]]],
    plan_code: str,
) -> list[dict[str, Any]]:
    base: dict[str, dict[str, Any]] = {}
    children: dict[str, list[str]] = {}
    root_ids: list[str] = []

    for row in rows:
        group_id = _norm_text(row.get("KZH"))
        if not group_id:
            continue
        parent_id = _norm_text(row.get("FKZH"))
        is_root = parent_id in ("", "-1", "null", "None") or parent_id == plan_code
        group = {
            "id": group_id,
            "parentId": "" if is_root else parent_id,
            "name": _norm_text(row.get("KZM")),
            "typeCode": _norm_text(row.get("KZLXDM")),
            "typeName": _norm_text(row.get("KZLXDM_DISPLAY")),
            "requiredCredits": _to_float(row.get("ZSXDXF")),
            "maxCredits": _to_float(row.get("ZDXDXF")),
            "requiredCourseCount": _to_int(row.get("ZSWCKZS")),
            "courseCategory": _norm_text(row.get("KCLBDM_DISPLAY")),
            "courseNature": _norm_text(row.get("KCXZDM_DISPLAY")),
            "directionName": _norm_text(row.get("ZYFXMC") or row.get("ZYFXDM_DISPLAY")),
            "requirement": _norm_text(row.get("XDYQ")),
            "order": _to_float(row.get("PX")) or 0,
            "directCourseCount": len(courses_by_group.get(group_id, [])),
            "directCourseCredits": round(sum(_to_float(course.get("credits")) or 0 for course in courses_by_group.get(group_id, [])), 2),
            "courseCount": 0,
            "plannedCredits": 0.0,
            "remainingPlannedCredits": None,
            "depth": 0,
            "path": [],
        }
        base[group_id] = group
        if is_root:
            root_ids.append(group_id)
        else:
            children.setdefault(parent_id, []).append(group_id)

    for group_id, group in base.items():
        if group_id not in root_ids and group["parentId"] and group["parentId"] not in base:
            root_ids.append(group_id)

    def child_sort(group_id: str) -> tuple[float, str]:
        group = base.get(group_id) or {}
        return (float(group.get("order") or 0), _norm_text(group.get("name")))

    ordered: list[dict[str, Any]] = []
    visiting: set[str] = set()
    visited: set[str] = set()

    def dfs(group_id: str, depth: int, path: list[str]) -> tuple[int, float]:
        if group_id in visiting:
            return 0, 0.0
        group = base.get(group_id)
        if not group:
            return 0, 0.0
        visiting.add(group_id)
        group["depth"] = depth
        group["path"] = path + [group["name"] or group_id]
        ordered.append(group)

        total_count = int(group["directCourseCount"])
        total_credits = float(group["directCourseCredits"])
        for child_id in sorted(children.get(group_id, []), key=child_sort):
            child_count, child_credits = dfs(child_id, depth + 1, group["path"])
            total_count += child_count
            total_credits += child_credits

        group["courseCount"] = total_count
        group["plannedCredits"] = round(total_credits, 2)
        required = _to_float(group.get("requiredCredits"))
        if required is not None:
            group["remainingPlannedCredits"] = max(round(required - total_credits, 2), 0)
        visiting.remove(group_id)
        visited.add(group_id)
        return total_count, total_credits

    for root_id in sorted(set(root_ids), key=child_sort):
        dfs(root_id, 0, [])
    for group_id in sorted(set(base) - visited, key=child_sort):
        dfs(group_id, 0, [])
    return ordered


def _normalize_guidance_terms(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    terms: list[dict[str, Any]] = []
    for row in rows:
        semester = _to_int(row.get("XDXNXQ"))
        terms.append({
            "id": _norm_text(row.get("WID")),
            "academicYear": _norm_text(row.get("JHXNDM_DISPLAY") or row.get("JHXNDM")),
            "term": _norm_text(row.get("JHXQDM_DISPLAY") or row.get("JHXQDM")),
            "semester": semester,
            "requiredCredits": _to_float(row.get("ZSXDXF")),
            "requirement": _norm_text(row.get("XDYQ")),
        })
    return sorted(terms, key=lambda item: (item.get("semester") or 999999, item.get("academicYear") or "", item.get("term") or ""))


def _query_training_plan(session: requests.Session, plan_code: str | None) -> dict[str, Any]:
    plan_rows = _post_json_rows(
        session,
        f"{XSFACX_MODULE_BASE}/grpyfacx.do",
        "grpyfacx",
        message_name="个人培养方案列表",
    )
    plans = [_normalize_plan(row) for row in plan_rows if _norm_text(row.get("PYFADM"))]
    if not plans:
        return {
            "plans": [],
            "selected_plan": None,
            "selected_plan_code": "",
            "groups": [],
            "courses": [],
            "guidance_terms": [],
            "summary": {"planCount": 0, "groupCount": 0, "courseCount": 0},
        }

    selected_code = _norm_text(plan_code)
    if selected_code and not any(plan["code"] == selected_code for plan in plans):
        raise ScoreQueryError("BAD_REQUEST", "指定的培养方案不存在于当前账号。", http_status=400)
    if not selected_code:
        selected_code = plans[0]["code"]

    detail_rows = _post_json_rows(
        session,
        f"{JWPUB_PYFA_MODULE_BASE}/qxpyfacx.do",
        "qxpyfacx",
        {"PYFADM": selected_code},
        "培养方案详情",
    )
    detail = detail_rows[0] if detail_rows else {}
    selected_plan = _normalize_plan(
        next((row for row in plan_rows if _norm_text(row.get("PYFADM")) == selected_code), {}),
        detail,
    )

    group_rows = _post_json_rows(
        session,
        f"{JWPUB_PYFA_MODULE_BASE}/kzcx.do",
        "kzcx",
        {"PYFADM": selected_code},
        "培养方案课程组",
    )
    course_rows = _post_json_rows(
        session,
        f"{JWPUB_PYFA_MODULE_BASE}/kzkccx.do",
        "kzkccx",
        {"PYFADM": selected_code},
        "培养方案课程",
    )
    guidance_rows = _post_json_rows(
        session,
        f"{JWPUB_PYFA_MODULE_BASE}/faxqcx.do",
        "faxqcx",
        {"PYFADM": selected_code, "*order": "+JHXNDM,+JHXQDM"},
        "指导计划",
    )

    group_names = {_norm_text(row.get("KZH")): _norm_text(row.get("KZM")) for row in group_rows}
    courses = [_normalize_course(row, group_names.get(_norm_text(row.get("KZH")), "")) for row in course_rows]
    courses = [course for course in courses if course["courseName"] or course["courseCode"]]
    courses.sort(key=lambda item: (
        item.get("plannedSemester") or 999999,
        item.get("groupName") or "",
        item.get("courseCode") or "",
        item.get("courseName") or "",
    ))

    courses_by_group: dict[str, list[dict[str, Any]]] = {}
    for course in courses:
        courses_by_group.setdefault(course["groupId"], []).append(course)
    groups = _normalize_groups(group_rows, courses_by_group, selected_code)
    guidance_terms = _normalize_guidance_terms(guidance_rows)

    total_course_credits = round(sum(_to_float(course.get("credits")) or 0 for course in courses), 2)
    selected_plan["totalCourseCredits"] = total_course_credits
    summary = {
        "planCount": len(plans),
        "groupCount": len(groups),
        "courseCount": len(courses),
        "guidanceTermCount": len(guidance_terms),
        "requiredCredits": selected_plan.get("requiredCredits"),
        "completedCredits": selected_plan.get("completedCredits"),
        "remainingCredits": selected_plan.get("remainingCredits"),
        "progressPercent": selected_plan.get("progressPercent"),
        "totalCourseCredits": total_course_credits,
    }
    return {
        "plans": plans,
        "selected_plan": selected_plan,
        "selected_plan_code": selected_code,
        "groups": groups,
        "courses": courses,
        "guidance_terms": guidance_terms,
        "summary": summary,
    }


def handle_lms_training_plan_request(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    try:
        account_type = str(body.get("account_type") or "auto").strip().lower()
        if account_type not in ("auto", "undergraduate", "postgraduate"):
            raise ScoreQueryError("BAD_REQUEST", "account_type 只能是 auto、undergraduate 或 postgraduate。", http_status=400)
        if account_type == "postgraduate":
            raise ScoreQueryError("UNSUPPORTED_ACCOUNT_TYPE", "当前培养方案入口来自本科教务系统，暂不支持研究生培养方案。", http_status=400)

        plan_code = _norm_text(body.get("plan_code"))
        session, username = _login_to_training_plan()
        result = _query_training_plan(session, plan_code)
        return 200, {
            "ok": True,
            "account_type": "undergraduate",
            "mode": "auto" if account_type == "auto" else "manual",
            "username": username,
            **result,
        }

    except CredentialError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except ScoreQueryError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except LmsLoginError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except requests.RequestException as exc:
        return 200, {"ok": False, "error": "NETWORK_ERROR", "message": f"连接教务培养方案系统失败：{exc}"}
    except Exception as exc:
        return 500, {"ok": False, "error": "INTERNAL_ERROR", "message": f"培养方案查询内部错误：{exc}"}
