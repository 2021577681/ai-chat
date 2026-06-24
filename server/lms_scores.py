from __future__ import annotations

import json
import re
from html import unescape
from html.parser import HTMLParser
from typing import Any

import requests

from .lms_credentials import CredentialError, load_lms_credential
from .lms_login import LoginState, LmsLoginError, XjtCasLogin


JWXT_LOGIN_URL = "https://jwxt.xjtu.edu.cn/jwapp/sys/homeapp/index.do"
GMIS_LOGIN_URL = (
    "https://org.xjtu.edu.cn/openplatform/oauth/authorize?"
    "appId=1036&state=abcd1234&redirectUri=http://gmis.xjtu.edu.cn/pyxx/sso/login"
    "&responseType=code&scope=user_info"
)
JWXT_SCORE_URL = "https://jwxt.xjtu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do"
GMIS_SCORE_URL = "https://gmis.xjtu.edu.cn/pyxx/pygl/xscjcx/index"


class ScoreQueryError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 200):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


def _norm_text(value: Any) -> str:
    text = unescape(str(value or ""))
    text = text.replace("\xa0", " ").replace("\u3000", " ")
    return " ".join(text.split()).strip()


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        text = str(value).strip()
        if not text:
            return None
        return float(text)
    except (TypeError, ValueError):
        return None


def _to_score(value: Any) -> float | str | None:
    text = _norm_text(value)
    if not text:
        return None
    number = _to_float(text)
    return number if number is not None else text


def _score_to_gpa(score: float | int | str | None) -> float | None:
    number = _to_float(score)
    if number is None:
        return None
    rules = [
        (95, 101, 4.3),
        (90, 95, 4.0),
        (85, 90, 3.7),
        (81, 85, 3.3),
        (78, 81, 3.0),
        (75, 78, 2.7),
        (72, 75, 2.3),
        (68, 72, 2.0),
        (64, 68, 1.7),
        (60, 64, 1.0),
        (0, 60, 0.0),
    ]
    for low, high, gpa in rules:
        if low <= number < high:
            return gpa
    return None


def _query_setting(term: str | None) -> str:
    settings: list[Any] = [{
        "name": "SFYX",
        "caption": "是否有效",
        "linkOpt": "AND",
        "builderList": "cbl_m_List",
        "builder": "m_value_equal",
        "value": "1",
        "value_display": "是",
    }]
    if term:
        settings.append([{
            "name": "XNXQDM",
            "value": term,
            "builder": "equal",
            "linkOpt": "and",
        }])
    return json.dumps(settings, ensure_ascii=False)


def _undergraduate_items(row: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    specs = [
        ("平时成绩", "PSCJ", "PSCJXS"),
        ("实验成绩", "SYCJ", None),
        ("期末成绩", "QMCJ", "QMCJXS"),
        ("期中成绩", "QZCJ", "QZCJXS"),
    ]
    for name, score_key, percent_key in specs:
        score = _to_float(row.get(score_key))
        if score is None:
            continue
        percent = 0.0
        if percent_key:
            percent_raw = _to_float(row.get(percent_key))
            if percent_raw is not None:
                percent = percent_raw / 100
        items.append({"itemName": name, "itemPercent": percent, "itemScore": score})

    for idx in range(1, 11):
        score = _to_float(row.get(f"QTCJ{idx}"))
        if score is not None:
            items.append({"itemName": f"其他{idx}", "itemPercent": 0.0, "itemScore": score})

    missing = [item for item in items if item["itemPercent"] == 0]
    if len(missing) == 1:
        missing[0]["itemPercent"] = max(0.0, 1 - sum(item["itemPercent"] for item in items))
    return items


def _normalize_undergraduate_score(row: dict[str, Any]) -> dict[str, Any]:
    score = _to_score(row.get("ZCJ"))
    gpa = _to_float(row.get("XFJD"))
    pass_flag_raw = str(row.get("SFJG") if row.get("SFJG") is not None else "").strip()
    pass_flag = pass_flag_raw in ("1", "true", "True", "是")
    if pass_flag_raw == "" and isinstance(score, (int, float)):
        pass_flag = score >= 60

    return {
        "source": "jwxt",
        "accountType": "undergraduate",
        "term": _norm_text(row.get("XNXQDM") or row.get("XNXQDM_DISPLAY")),
        "courseName": _norm_text(row.get("KCM")),
        "courseCode": _norm_text(row.get("KCH")),
        "coursePoint": _to_float(row.get("XF")),
        "score": score,
        "gpa": gpa,
        "passFlag": pass_flag,
        "examType": _norm_text(row.get("KSLXDM_DISPLAY")),
        "majorFlag": _norm_text(row.get("KCXZDM_DISPLAY")),
        "examProp": _norm_text(row.get("CXCKDM_DISPLAY")),
        "specificReason": _norm_text(row.get("TSYYDM_DISPLAY")),
        "itemList": _undergraduate_items(row),
    }


def _extract_undergraduate_score_rows(data: dict[str, Any]) -> tuple[list[Any], int | None]:
    table = (((data or {}).get("datas") or {}).get("xscjcx") or {})
    rows = table.get("rows")
    if not isinstance(rows, list):
        raise ScoreQueryError("JWXT_PARSE_FAILED", "本科成绩接口返回格式无法识别。")
    total = (
        _to_float(table.get("totalSize"))
        or _to_float(table.get("total"))
        or _to_float((data or {}).get("totalSize"))
        or _to_float((data or {}).get("total"))
    )
    return rows, int(total) if total is not None else None


def _query_undergraduate_scores(session: requests.Session, term: str | None) -> list[dict[str, Any]]:
    page_size = 1000
    page_number = 1
    rows: list[Any] = []
    total: int | None = None

    while True:
        response = session.post(
            JWXT_SCORE_URL,
            data={
                "pageSize": page_size,
                "pageNumber": page_number,
                "querySetting": _query_setting(term),
            },
            headers={
                "Referer": "https://jwxt.xjtu.edu.cn/jwapp/sys/cjcx/*default/index.do",
                "X-Requested-With": "XMLHttpRequest",
            },
            timeout=30,
        )
        response.raise_for_status()
        try:
            data = response.json()
        except ValueError as exc:
            raise ScoreQueryError("JWXT_BAD_RESPONSE", "本科教务系统没有返回可解析的成绩数据，可能登录态已失效。") from exc

        page_rows, page_total = _extract_undergraduate_score_rows(data)
        rows.extend(page_rows)
        total = page_total if page_total is not None else total
        if not page_rows or len(page_rows) < page_size or (total is not None and len(rows) >= total):
            break
        page_number += 1
        if page_number > 20:
            break

    return [_normalize_undergraduate_score(row) for row in rows if isinstance(row, dict)]


class _GmisScoreTableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._capturing = False
        self._table_depth = 0
        self._current_table: list[list[str]] | None = None
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        if tag == "table":
            if self._capturing:
                self._table_depth += 1
            elif attr_map.get("id") == "sample-table-1":
                self._capturing = True
                self._table_depth = 1
                self._current_table = []
            return

        if not self._capturing:
            return
        if tag == "tr":
            self._current_row = []
        elif tag in ("td", "th") and self._current_row is not None:
            self._current_cell = []

    def handle_data(self, data: str) -> None:
        if self._capturing and self._current_cell is not None:
            self._current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if not self._capturing:
            return
        if tag in ("td", "th") and self._current_cell is not None and self._current_row is not None:
            self._current_row.append(_norm_text("".join(self._current_cell)))
            self._current_cell = None
        elif tag == "tr" and self._current_row is not None and self._current_table is not None:
            if any(cell for cell in self._current_row):
                self._current_table.append(self._current_row)
            self._current_row = None
        elif tag == "table":
            self._table_depth -= 1
            if self._table_depth <= 0:
                if self._current_table is not None:
                    self.tables.append(self._current_table)
                self._capturing = False
                self._current_table = None
                self._current_row = None
                self._current_cell = None


def _query_graduate_scores(session: requests.Session) -> list[dict[str, Any]]:
    response = session.get(GMIS_SCORE_URL, timeout=30)
    response.raise_for_status()
    parser = _GmisScoreTableParser()
    parser.feed(response.text)
    if not parser.tables:
        raise ScoreQueryError("GMIS_PARSE_FAILED", "研究生成绩页面中没有找到成绩表格。")

    type_names = ["学位课程", "选修课程", "必修环节"]
    scores: list[dict[str, Any]] = []
    for table_index, table in enumerate(parser.tables):
        type_name = type_names[table_index] if table_index < len(type_names) else "未知类型"
        for row in table[1:]:
            if not row or "课程" in (row[0] or ""):
                continue
            if type_name == "必修环节":
                if len(row) < 3:
                    continue
                course_name, credit_text, score_text = row[0], row[1], row[2]
                exam_date = row[3] if len(row) > 3 else ""
            else:
                if len(row) < 4:
                    continue
                course_name, credit_text, score_text = row[0], row[1], row[3]
                exam_date = row[4] if len(row) > 4 else ""
            if not course_name or not score_text:
                continue
            score = _to_score(score_text)
            gpa = _score_to_gpa(score)
            scores.append({
                "source": "gmis",
                "accountType": "postgraduate",
                "term": "",
                "courseName": course_name,
                "courseCode": "",
                "coursePoint": _to_float(credit_text),
                "score": score,
                "gpa": gpa,
                "passFlag": (score >= 60) if isinstance(score, (int, float)) else None,
                "type": type_name,
                "examDate": exam_date,
                "itemList": [],
            })
    return scores


def _login_to_service(login_url: str, account_type: str) -> tuple[requests.Session, str]:
    credential = load_lms_credential()
    login = XjtCasLogin(login_url)
    first = True
    for _ in range(4):
        if first:
            first = False
            state, info = login.login(
                credential.username,
                credential.password,
                account_type=account_type,
                trust_agent=True,
            )
        else:
            state, info = login.login(account_type=account_type, trust_agent=True)

        if state == LoginState.SUCCESS:
            return login.session, credential.username
        if state == LoginState.REQUIRE_ACCOUNT_CHOICE:
            continue
        if state == LoginState.REQUIRE_MFA:
            raise ScoreQueryError(
                "INTERACTIVE_LOGIN_REQUIRED",
                "成绩查询登录需要短信验证。请先在学习面板登录并信任当前设备，或稍后重试。",
            )
        if state == LoginState.REQUIRE_CAPTCHA:
            raise ScoreQueryError("INTERACTIVE_LOGIN_REQUIRED", "成绩查询登录需要图片验证码，请先在登录弹窗完成一次登录。")
        if state == LoginState.FAIL:
            raise ScoreQueryError("LOGIN_FAILED", str(info or "统一认证登录失败。"))

    raise ScoreQueryError("LOGIN_STATE_UNRESOLVED", "统一认证登录流程没有完成。")


def _summarize_scores(scores: list[dict[str, Any]]) -> dict[str, Any]:
    total_credits = 0.0
    weighted_score_sum = 0.0
    weighted_score_credits = 0.0
    weighted_gpa_sum = 0.0
    weighted_gpa_credits = 0.0
    passed = 0
    failed = 0
    terms: set[str] = set()

    for item in scores:
        credit = _to_float(item.get("coursePoint")) or 0.0
        score = item.get("score")
        gpa = _to_float(item.get("gpa"))
        term = _norm_text(item.get("term"))
        if term:
            terms.add(term)
        if credit > 0:
            total_credits += credit
        if isinstance(score, (int, float)) and credit > 0:
            weighted_score_sum += float(score) * credit
            weighted_score_credits += credit
        if gpa is not None and credit > 0:
            weighted_gpa_sum += gpa * credit
            weighted_gpa_credits += credit
        pass_flag = item.get("passFlag")
        if pass_flag is True:
            passed += 1
        elif pass_flag is False:
            failed += 1

    return {
        "count": len(scores),
        "totalCredits": round(total_credits, 2),
        "weightedAverageScore": round(weighted_score_sum / weighted_score_credits, 2) if weighted_score_credits else None,
        "weightedGpa": round(weighted_gpa_sum / weighted_gpa_credits, 3) if weighted_gpa_credits else None,
        "passed": passed,
        "failed": failed,
        "terms": sorted(terms, reverse=True),
    }


def _query_scores_for_type(account_type: str, term: str | None) -> dict[str, Any]:
    if account_type == "undergraduate":
        session, username = _login_to_service(JWXT_LOGIN_URL, "undergraduate")
        scores = _query_undergraduate_scores(session, term)
    elif account_type == "postgraduate":
        session, username = _login_to_service(GMIS_LOGIN_URL, "postgraduate")
        scores = _query_graduate_scores(session)
    else:
        raise ScoreQueryError("BAD_REQUEST", "account_type 只能是 auto、undergraduate 或 postgraduate。", http_status=400)

    return {
        "account_type": account_type,
        "username": username,
        "scores": scores,
        "summary": _summarize_scores(scores),
    }


def _error_payload(error: Exception) -> dict[str, str]:
    if isinstance(error, ScoreQueryError):
        return {"error": error.code, "message": error.message}
    if isinstance(error, LmsLoginError):
        return {"error": error.code, "message": error.message}
    if isinstance(error, requests.RequestException):
        return {"error": "NETWORK_ERROR", "message": f"连接学校成绩系统失败：{error}"}
    return {"error": "UNKNOWN_ERROR", "message": str(error)}


def handle_lms_scores_request(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    try:
        account_type = str(body.get("account_type") or "auto").strip().lower()
        raw_term = _norm_text(body.get("term"))
        term = None if raw_term.lower() in ("", "all", "*") else raw_term
        if term and not re.fullmatch(r"\d{4}-\d{4}-[1-3]", term):
            raise ScoreQueryError("BAD_REQUEST", "学期格式应为 2024-2025-1。", http_status=400)

        if account_type == "auto":
            successes: list[dict[str, Any]] = []
            errors: list[dict[str, str]] = []
            for candidate in ("undergraduate", "postgraduate"):
                try:
                    result = _query_scores_for_type(candidate, term if candidate == "undergraduate" else None)
                    if result["scores"]:
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
                "error": "SCORE_QUERY_FAILED",
                "message": "自动识别本科/研究生成绩均未成功，请手动选择身份后重试。",
                "errors": errors,
            }

        result = _query_scores_for_type(account_type, term)
        return 200, {"ok": True, **result, "mode": "manual"}

    except CredentialError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except ScoreQueryError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except LmsLoginError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except requests.RequestException as exc:
        return 200, {"ok": False, "error": "NETWORK_ERROR", "message": f"连接学校成绩系统失败：{exc}"}
    except Exception as exc:
        return 500, {"ok": False, "error": "INTERNAL_ERROR", "message": f"成绩查询内部错误：{exc}"}
