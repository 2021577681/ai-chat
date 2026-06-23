from __future__ import annotations

import math
import re
from binascii import hexlify
from datetime import date, timedelta
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import requests

from .lms_credentials import CredentialError, load_lms_credential
from .lms_login import LoginState, LmsLoginError, XjtCasLogin
from .lms_scores import ScoreQueryError, _norm_text, _to_float


ATTENDANCE_LOGIN_URL = (
    "https://org.xjtu.edu.cn/openplatform/oauth/authorize?"
    "appId=1372&redirectUri=https://bkkq.xjtu.edu.cn/berserker-auth/auth/attendance-pc/casReturn"
    "&responseType=code&scope=user_info&state=1234"
)
POSTGRADUATE_ATTENDANCE_LOGIN_URL = (
    "https://org.xjtu.edu.cn/openplatform/oauth/authorize?"
    "appId=1245&redirectUri=https://yjskq.xjtu.edu.cn/berserker-auth/auth/attendance-pc/casReturn"
    "&responseType=code&scope=user_info&state=1234"
)
WEBVPN_LOGIN_URL = "https://webvpn.xjtu.edu.cn/login?cas_login=true"
ATTENDANCE_WEBVPN_URL = "http://bkkq.xjtu.edu.cn"
POSTGRADUATE_ATTENDANCE_WEBVPN_URL = "http://yjskq.xjtu.edu.cn"
WEBVPN_HOST = "webvpn.xjtu.edu.cn"
WEBVPN_AES_KEY = b"wrdvpnisthebest!"
WEBVPN_AES_IV = b"wrdvpnisthebest!"

FLOW_TYPE_LABELS = {
    0: "无效",
    1: "有效",
    2: "重复",
    9: "未知",
}

ATTENDANCE_STATUS_LABELS = {
    1: "正常",
    2: "迟到",
    3: "缺勤",
    4: "早退",
    5: "请假",
}


def _to_int(value: Any) -> int | None:
    number = _to_float(value)
    if number is None:
        return None
    return int(number)


def _default_date_range() -> tuple[str, str]:
    end = date.today()
    start = end - timedelta(days=30)
    return start.isoformat(), end.isoformat()


def _validate_date(value: Any, default: str, name: str) -> str:
    text = _norm_text(value) or default
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise ScoreQueryError("BAD_REQUEST", f"{name} 格式应为 YYYY-MM-DD。", http_status=400)
    try:
        date.fromisoformat(text)
    except ValueError as exc:
        raise ScoreQueryError("BAD_REQUEST", f"{name} 不是有效日历日期。", http_status=400) from exc
    return text


def _validate_positive_int(value: Any, default: int, name: str, min_value: int, max_value: int) -> int:
    if value is None or value == "":
        return default
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ScoreQueryError("BAD_REQUEST", f"{name} 必须是整数。", http_status=400) from exc
    if number < min_value or number > max_value:
        raise ScoreQueryError("BAD_REQUEST", f"{name} 必须在 {min_value}-{max_value} 之间。", http_status=400)
    return number


def _validate_query(body: dict[str, Any]) -> tuple[str, str, str, int, int, str]:
    account_type = str(body.get("account_type") or "auto").strip().lower()
    if account_type not in ("auto", "undergraduate", "postgraduate"):
        raise ScoreQueryError("BAD_REQUEST", "account_type 只能是 auto、undergraduate 或 postgraduate。", http_status=400)

    default_start, default_end = _default_date_range()
    start_date = _validate_date(body.get("start_date"), default_start, "start_date")
    end_date = _validate_date(body.get("end_date"), default_end, "end_date")
    if date.fromisoformat(start_date) > date.fromisoformat(end_date):
        raise ScoreQueryError("BAD_REQUEST", "start_date 不能晚于 end_date。", http_status=400)
    if (date.fromisoformat(end_date) - date.fromisoformat(start_date)).days > 370:
        raise ScoreQueryError("BAD_REQUEST", "考勤查询日期范围不能超过 370 天。", http_status=400)

    page = _validate_positive_int(body.get("page"), 1, "page", 1, 1000)
    page_size = _validate_positive_int(body.get("page_size"), 20, "page_size", 1, 100)
    access_mode = str(body.get("access_mode") or "auto").strip().lower()
    if access_mode not in ("auto", "normal", "webvpn"):
        raise ScoreQueryError("BAD_REQUEST", "access_mode 只能是 auto、normal 或 webvpn。", http_status=400)
    return account_type, start_date, end_date, page, page_size, access_mode


def _attendance_domain(account_type: str) -> str:
    return "yjskq.xjtu.edu.cn" if account_type == "postgraduate" else "bkkq.xjtu.edu.cn"


def _attendance_login_url(account_type: str) -> str:
    return POSTGRADUATE_ATTENDANCE_LOGIN_URL if account_type == "postgraduate" else ATTENDANCE_LOGIN_URL


def _attendance_webvpn_login_url(account_type: str) -> str:
    return POSTGRADUATE_ATTENDANCE_WEBVPN_URL if account_type == "postgraduate" else ATTENDANCE_WEBVPN_URL


def _webvpn_ciphertext(hostname: str) -> str:
    try:
        from Crypto.Cipher import AES
    except ImportError as exc:
        raise ScoreQueryError(
            "MISSING_DEPENDENCY",
            "后端缺少 pycryptodome 依赖，无法按 Toolbox 方式生成 WebVPN URL。请运行 pip install pycryptodome 后重启本地服务。",
            http_status=500,
        ) from exc

    cipher = AES.new(WEBVPN_AES_KEY, AES.MODE_CFB, WEBVPN_AES_IV, segment_size=128)
    return hexlify(cipher.encrypt(hostname.encode("utf-8"))).decode("utf-8")


def _get_vpn_url(url: str) -> str:
    raw_url = str(url or "")
    if raw_url.startswith(f"https://{WEBVPN_HOST}"):
        return raw_url
    parts = raw_url.split("://", maxsplit=1)
    if len(parts) != 2:
        return raw_url

    protocol, address = parts
    hosts = address.split("/")
    host = hosts[0]
    hostname = host.split(":", maxsplit=1)[0]
    port = "-" + host.split(":", maxsplit=1)[1] if ":" in host else ""
    key = hexlify(WEBVPN_AES_IV).decode("utf-8")
    path = "/".join(hosts[1:])
    return f"https://{WEBVPN_HOST}/{protocol}{port}/{key}{_webvpn_ciphertext(hostname)}/{path}"


def _attendance_request_url(account_type: str, path: str, access_mode: str) -> str:
    url = f"https://{_attendance_domain(account_type)}{path}"
    if access_mode == "webvpn":
        return _get_vpn_url(url)
    return url


def _token_from_url(raw_url: str) -> str:
    text = raw_url or ""
    if "token=" in text:
        token = text.split("token=", maxsplit=1)[1]
        token = re.split(r"[&#\s\"'<]", token, maxsplit=1)[0]
        if token:
            return unquote(token)

    parsed = urlparse(text)
    for part in (parsed.query, parsed.fragment):
        token = (parse_qs(part).get("token") or [""])[0]
        if token:
            return token
    return ""


class AttendanceCasLogin(XjtCasLogin):
    def __init__(self, login_url: str, session: requests.Session | None = None):
        self.attendance_login_url = login_url
        self.attendance_token = ""
        super().__init__(login_url, session=session)

    def post_login(self, response: requests.Response) -> None:
        self._capture_token(response)

    def _capture_token(self, response: requests.Response) -> str:
        urls = [item.url for item in getattr(response, "history", []) or []]
        urls.append(response.url)
        for raw_url in urls:
            token = _token_from_url(raw_url)
            if token:
                self.attendance_token = token
                self.session.headers.update({"Synjones-Auth": "bearer " + token})
                return token

        match = re.search(r"token=([^\"'&<\s#]+)", response.text or "")
        if match:
            token = match.group(1)
            self.attendance_token = token
            self.session.headers.update({"Synjones-Auth": "bearer " + token})
            return token
        return ""

    def ensure_attendance_token(self) -> None:
        if self.attendance_token:
            return
        response = self._get(self.attendance_login_url, allow_redirects=True, timeout=30)
        response.raise_for_status()
        if self._capture_token(response):
            return
        raise ScoreQueryError("ATTENDANCE_TOKEN_NOT_FOUND", "考勤系统登录成功，但没有返回 Synjones-Auth token。")


class AttendanceWebVpnCasLogin(AttendanceCasLogin):
    def _get(self, url: str, **kwargs: Any) -> requests.Response:
        return self.session.get(_get_vpn_url(url), **kwargs)

    def _post(self, url: str, **kwargs: Any) -> requests.Response:
        return self.session.post(_get_vpn_url(url), **kwargs)


def _perform_saved_cas_login(
    login: XjtCasLogin,
    credential: Any,
    account_type: str,
    label: str,
) -> None:
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
            return
        if state == LoginState.REQUIRE_ACCOUNT_CHOICE:
            continue
        if state == LoginState.REQUIRE_MFA:
            raise ScoreQueryError(
                "INTERACTIVE_LOGIN_REQUIRED",
                f"{label}需要短信验证。请先在学习面板登录并信任当前设备，或稍后重试。",
            )
        if state == LoginState.REQUIRE_CAPTCHA:
            raise ScoreQueryError("INTERACTIVE_LOGIN_REQUIRED", f"{label}需要图片验证码，请先在登录弹窗完成一次登录。")
        if state == LoginState.FAIL:
            raise ScoreQueryError("LOGIN_FAILED", str(info or "统一认证登录失败。"))

    raise ScoreQueryError("LOGIN_STATE_UNRESOLVED", "统一认证登录流程没有完成。")


def _login_to_attendance_for_mode(account_type: str, access_mode: str) -> tuple[requests.Session, str]:
    credential = load_lms_credential()
    if access_mode == "webvpn":
        webvpn_login = XjtCasLogin(WEBVPN_LOGIN_URL)
        _perform_saved_cas_login(webvpn_login, credential, account_type, "WebVPN 登录")
        login = AttendanceWebVpnCasLogin(
            _attendance_webvpn_login_url(account_type),
            session=webvpn_login.session,
        )
        _perform_saved_cas_login(login, credential, account_type, "WebVPN 考勤登录")
        login.ensure_attendance_token()
        return login.session, credential.username

    login = AttendanceCasLogin(_attendance_login_url(account_type))
    _perform_saved_cas_login(login, credential, account_type, "考勤查询登录")
    login.ensure_attendance_token()
    return login.session, credential.username


def _should_try_webvpn(error: Exception) -> bool:
    if isinstance(error, ScoreQueryError):
        return error.code not in {
            "BAD_REQUEST",
            "LOGIN_FAILED",
            "INTERACTIVE_LOGIN_REQUIRED",
            "MISSING_DEPENDENCY",
            "LOGIN_STATE_UNRESOLVED",
        }
    return isinstance(error, (LmsLoginError, requests.RequestException))


def _post_attendance(
    session: requests.Session,
    account_type: str,
    access_mode: str,
    path: str,
    payload: dict[str, Any],
) -> Any:
    response = session.post(
        _attendance_request_url(account_type, path, access_mode),
        json=payload,
        timeout=45,
    )
    response.raise_for_status()
    try:
        data = response.json()
    except ValueError as exc:
        raise ScoreQueryError("ATTENDANCE_BAD_RESPONSE", "考勤系统没有返回可解析的数据。") from exc
    if not isinstance(data, dict) or not data.get("success"):
        code = _norm_text((data or {}).get("code"))
        msg = _norm_text((data or {}).get("msg")) or "考勤系统返回失败。"
        raise ScoreQueryError("ATTENDANCE_SERVER_ERROR", f"{msg}{f' ({code})' if code else ''}")
    return data.get("data")


def _normalize_counts(row: dict[str, Any] | None) -> dict[str, Any]:
    row = row or {}
    return {
        "normalCount": _to_int(row.get("normalCount")) or 0,
        "lateCount": _to_int(row.get("lateCount")) or 0,
        "absenceCount": _to_int(row.get("absenceCount")) or 0,
        "leaveEarlyCount": _to_int(row.get("leaveEarlyCount")) or 0,
        "leaveCount": _to_int(row.get("leaveCount")) or 0,
        "actualCount": _to_int(row.get("actualCount")) or 0,
        "total": _to_int(row.get("total")) or 0,
    }


def _normalize_flow(row: dict[str, Any]) -> dict[str, Any]:
    type_value = _to_int(row.get("isdone"))
    if type_value not in FLOW_TYPE_LABELS:
        type_value = 9
    return {
        "id": _norm_text(row.get("sBh")),
        "place": _norm_text(row.get("eqno")),
        "time": _norm_text(row.get("watertime")),
        "type": type_value,
        "typeLabel": FLOW_TYPE_LABELS[type_value],
    }


def _normalize_subject(row: dict[str, Any]) -> dict[str, Any]:
    counts = _normalize_counts(row)
    return {
        "subjectCode": _norm_text(row.get("subjectCode")),
        "subjectName": _norm_text(row.get("subjectname")),
        "teacher": _norm_text(row.get("teachNameList")),
        "week": _norm_text(row.get("week")),
        **counts,
    }


def _query_flow_page(
    session: requests.Session,
    account_type: str,
    access_mode: str,
    start_date: str,
    end_date: str,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    data = _post_attendance(session, account_type, access_mode, "/attendance-student/waterList/page", {
        "calendarBh": "",
        "startdate": start_date,
        "enddate": end_date,
        "pageSize": page_size,
        "current": page,
    }) or {}
    rows = data.get("list") if isinstance(data, dict) else []
    if not isinstance(rows, list):
        rows = []
    total_count = _to_int(data.get("totalCount")) if isinstance(data, dict) else None
    total_count = total_count if total_count is not None else len(rows)
    return {
        "flows": [_normalize_flow(row) for row in rows if isinstance(row, dict)],
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "totalCount": total_count,
            "totalPages": max(1, math.ceil(total_count / page_size)) if page_size else 1,
        },
    }


def _query_attendance_statistics(
    session: requests.Session,
    account_type: str,
    access_mode: str,
    start_date: str,
    end_date: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    total_data = _post_attendance(session, account_type, access_mode, "/attendance-student/kqtj/getKqtjNumByTime", {
        "startDate": start_date,
        "endDate": end_date,
    })
    subjects_data = _post_attendance(session, account_type, access_mode, "/attendance-student/kqtj/getKqtjByTime", {
        "startDate": start_date,
        "endDate": end_date,
    })
    subjects = subjects_data if isinstance(subjects_data, list) else []
    return _normalize_counts(total_data if isinstance(total_data, dict) else {}), [
        _normalize_subject(row) for row in subjects if isinstance(row, dict)
    ]


def _summarize(flows: list[dict[str, Any]], statistics: dict[str, Any], total_flow_count: int) -> dict[str, Any]:
    by_flow_type: dict[str, int] = {}
    for flow in flows:
        label = flow.get("typeLabel") or "未知"
        by_flow_type[label] = by_flow_type.get(label, 0) + 1
    return {
        "pageFlowCount": len(flows),
        "totalFlowCount": total_flow_count,
        "byFlowTypeOnPage": by_flow_type,
        "attendanceTotal": statistics.get("total", 0),
        "normalCount": statistics.get("normalCount", 0),
        "lateCount": statistics.get("lateCount", 0),
        "absenceCount": statistics.get("absenceCount", 0),
        "leaveEarlyCount": statistics.get("leaveEarlyCount", 0),
        "leaveCount": statistics.get("leaveCount", 0),
        "actualCount": statistics.get("actualCount", 0),
    }


def _query_attendance_for_type(
    account_type: str,
    start_date: str,
    end_date: str,
    page: int,
    page_size: int,
    access_mode: str,
) -> dict[str, Any]:
    modes = ("normal", "webvpn") if access_mode == "auto" else (access_mode,)
    mode_errors: list[dict[str, str]] = []

    for mode in modes:
        try:
            session, username = _login_to_attendance_for_mode(account_type, mode)
            flow_result = _query_flow_page(session, account_type, mode, start_date, end_date, page, page_size)
            statistics, subjects = _query_attendance_statistics(session, account_type, mode, start_date, end_date)
            pagination = flow_result["pagination"]
            flows = flow_result["flows"]
            result = {
                "account_type": account_type,
                "username": username,
                "access_mode": mode,
                "start_date": start_date,
                "end_date": end_date,
                "flows": flows,
                "subjects": subjects,
                "statistics": statistics,
                "pagination": pagination,
                "summary": _summarize(flows, statistics, pagination.get("totalCount") or len(flows)),
            }
            if mode_errors:
                result["access_mode_warnings"] = mode_errors
            return result
        except CredentialError:
            raise
        except (ScoreQueryError, LmsLoginError, requests.RequestException) as exc:
            detail = _error_payload(exc)
            detail["access_mode"] = mode
            mode_errors.append(detail)
            if access_mode == "auto":
                if mode == "normal" and _should_try_webvpn(exc):
                    continue
                if mode == "webvpn":
                    break
            raise

    detail_text = "；".join(f"{err.get('access_mode')}：{err.get('message')}" for err in mode_errors)
    raise ScoreQueryError(
        "ATTENDANCE_ACCESS_MODE_FAILED",
        f"考勤普通直连和 WebVPN 均未成功。{detail_text}",
    )


def _error_payload(error: Exception) -> dict[str, str]:
    if isinstance(error, ScoreQueryError):
        return {"error": error.code, "message": error.message}
    if isinstance(error, LmsLoginError):
        return {"error": error.code, "message": error.message}
    if isinstance(error, requests.RequestException):
        return {"error": "NETWORK_ERROR", "message": f"连接考勤系统失败：{error}"}
    return {"error": "UNKNOWN_ERROR", "message": str(error)}


def handle_lms_attendance_request(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    try:
        account_type, start_date, end_date, page, page_size, access_mode = _validate_query(body)

        if account_type == "auto":
            successes: list[dict[str, Any]] = []
            errors: list[dict[str, str]] = []
            for candidate in ("undergraduate", "postgraduate"):
                try:
                    result = _query_attendance_for_type(candidate, start_date, end_date, page, page_size, access_mode)
                    if result["flows"] or result["subjects"] or result["statistics"].get("total"):
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
                "error": "ATTENDANCE_QUERY_FAILED",
                "message": "自动识别本科/研究生考勤系统均未成功，请手动选择身份后重试。",
                "errors": errors,
            }

        result = _query_attendance_for_type(account_type, start_date, end_date, page, page_size, access_mode)
        return 200, {"ok": True, **result, "mode": "manual"}

    except CredentialError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except ScoreQueryError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except LmsLoginError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except requests.RequestException as exc:
        return 200, {"ok": False, "error": "NETWORK_ERROR", "message": f"连接考勤系统失败：{exc}"}
    except Exception as exc:
        return 500, {"ok": False, "error": "INTERNAL_ERROR", "message": f"考勤查询内部错误：{exc}"}
