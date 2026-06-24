from __future__ import annotations

import base64
import hashlib
import json
import platform
import re
import secrets
import threading
import time
import uuid
from dataclasses import dataclass
from html import unescape
from typing import Any

import requests

from .lms_credentials import (
    CredentialError,
    clear_lms_credential,
    credential_status,
    load_lms_credential,
    save_lms_credential,
)


LMS_LOGIN_URL = "https://lms.xjtu.edu.cn"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/148.0.0.0 Safari/537.36"
)
FLOW_TTL_SECONDS = 10 * 60


class LoginState:
    REQUIRE_MFA = "require_mfa"
    REQUIRE_CAPTCHA = "require_captcha"
    SUCCESS = "success"
    FAIL = "fail"
    REQUIRE_ACCOUNT_CHOICE = "require_account_choice"


class LmsLoginError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 200):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


def _get_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    return session


def _strip_tags(value: str) -> str:
    return unescape(re.sub(r"<[^>]+>", "", value or "")).strip()


def _extract_input_value(html_content: str, name: str) -> str | None:
    pattern = re.compile(
        rf"<input\b(?=[^>]*\bname\s*=\s*(['\"]){re.escape(name)}\1)[^>]*>",
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(html_content or "")
    if not match:
        return None
    tag = match.group(0)
    value_match = re.search(r"\bvalue\s*=\s*(['\"])(.*?)\1", tag, re.IGNORECASE | re.DOTALL)
    if not value_match:
        return None
    return unescape(value_match.group(2))


def _extract_alert_message(html_content: str) -> str | None:
    match = re.search(
        r"<el-alert\b[^>]*\btitle\s*=\s*(['\"])(.*?)\1",
        html_content or "",
        re.IGNORECASE | re.DOTALL,
    )
    if match:
        return unescape(match.group(2)).strip()
    return None


def _extract_global_config_bool(html_content: str, key: str, default: bool = True) -> bool:
    match = re.search(
        r"globalConfig\s*=\s*eval\(\'\(\'\s*\+\s*\"(.*?)\"\s*\+\s*\'\)\'\s*\);",
        html_content or "",
        re.DOTALL,
    )
    if not match:
        return default
    try:
        json_text = match.group(1).encode("utf-8").decode("unicode_escape")
        config = json.loads(json_text)
    except Exception:
        return default
    value = config.get(key, default) if isinstance(config, dict) else default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() == "true"
    return default


def _is_safety_verify_page(html_content: str) -> bool:
    page = html_content or ""
    return (
        'id="fm1"' in page
        and 'name="secState"' in page
        and 'name="execution"' in page
        and (
            "Safety Verify" in page
            or "/cas/sec/initByType" in page
            or "二次认证" in page
            or "选择安全认证" in page
        )
    )


def _extract_account_choices(html_content: str) -> list[dict[str, str]] | None:
    page = html_content or ""
    names = [
        _strip_tags(match.group(2))
        for match in re.finditer(
            r"<div\b[^>]*\bclass\s*=\s*(['\"])name\1[^>]*>(.*?)</div>",
            page,
            re.IGNORECASE | re.DOTALL,
        )
    ]
    labels = [
        unescape(match.group(3)).strip()
        for match in re.finditer(
            r"<el-radio\b(?=[^>]*\bclass\s*=\s*(['\"])checkbox-radio\1)[^>]*\blabel\s*=\s*(['\"])(.*?)\2",
            page,
            re.IGNORECASE | re.DOTALL,
        )
    ]
    if not names or not labels:
        return None
    count = min(len(names), len(labels))
    choices = [{"name": names[i], "label": labels[i]} for i in range(count) if labels[i]]
    return choices or None


def _generate_fp_visitor_id() -> str:
    system_info = {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "python_version": platform.python_version(),
        "mac_address": ":".join(
            f"{(uuid.getnode() >> offset) & 0xff:02x}"
            for offset in range(0, 8 * 6, 8)
        ),
    }
    fingerprint = "|".join(f"{k}:{v}" for k, v in sorted(system_info.items()))
    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:32]


def _export_cookie_header(session: requests.Session) -> str:
    cookies: dict[str, str] = {}
    for cookie in session.cookies:
        try:
            if cookie.is_expired():
                continue
        except Exception:
            pass
        cookies[cookie.name] = cookie.value
    return "; ".join(f"{name}={value}" for name, value in cookies.items())


class XjtCasLogin:
    class MFAFlow:
        MFA_DETECT = "mfa"
        SAFETY_VERIFY = "sec"

    class MFAContext:
        def __init__(self, login: "XjtCasLogin", state: str, required: bool = True, flow: str = "mfa"):
            self._login = login
            self.state = state
            self.required = required
            self.flow = flow
            self.gid: str | None = None
            self._phone_number: str | None = None

        def get_phone_number(self) -> str:
            if self._phone_number is not None:
                return self._phone_number
            response = self._login._get(
                f"https://login.xjtu.edu.cn/cas/{self.flow}/initByType/securephone",
                params={"state": self.state},
                timeout=20,
            )
            response.raise_for_status()
            data = response.json()
            if data.get("code") != 0:
                raise LmsLoginError("MFA_PHONE_FAILED", data.get("message") or "获得绑定手机信息失败")
            self.gid = str(data["data"]["gid"])
            self._phone_number = str(data["data"]["securePhone"])
            return self._phone_number

        def send_verify_code(self) -> str:
            phone = self.get_phone_number()
            response = self._login._post(
                "https://login.xjtu.edu.cn/attest/api/guard/securephone/send",
                json={"gid": self.gid},
                timeout=20,
            )
            response.raise_for_status()
            data = response.json()
            if data.get("code") != 0:
                raise LmsLoginError("MFA_SEND_FAILED", data.get("message") or "发送验证码失败")
            return phone

        def verify_phone_code(self, code: str) -> None:
            if not self.gid:
                raise LmsLoginError("MFA_NOT_READY", "请先发送短信验证码。")
            response = self._login._post(
                "https://login.xjtu.edu.cn/attest/api/guard/securephone/valid",
                json={"gid": self.gid, "code": code},
                timeout=20,
            )
            response.raise_for_status()
            data = response.json()
            if data.get("code") != 0:
                raise LmsLoginError("MFA_VERIFY_FAILED", data.get("message") or "验证码验证失败")
            result = data.get("data")
            if isinstance(result, dict):
                status = result.get("status")
                if status is not None and status not in (2, "2"):
                    raise LmsLoginError("MFA_VERIFY_FAILED", data.get("message") or "验证码验证失败")

    def __init__(
            self,
            login_url: str = LMS_LOGIN_URL,
            visitor_id: str | None = None,
            session: requests.Session | None = None):
        self.session = session or _get_session()
        response = self._get(login_url, allow_redirects=True, timeout=30)
        response.raise_for_status()
        self.initial_login_page_html = response.text
        self.post_url = response.url
        self.execution_input = _extract_input_value(response.text, "execution")
        self._already_authenticated_response: requests.Response | None = None
        self._choose_account_response: requests.Response | None = None
        self._safety_verify_response: requests.Response | None = None
        self._safety_verify_mfa_requested = False
        self.mfa_context: XjtCasLogin.MFAContext | None = None
        self.mfa_enabled = _extract_global_config_bool(response.text, "mfaEnabled", default=True)
        self.fp_visitor_id = visitor_id or _generate_fp_visitor_id()
        self.fail_count = 0
        self.rsa_public_key: str | None = None
        self.has_login = False
        self._username: str | None = None
        self._password: str | None = None
        self._jcaptcha = ""

        initial_safety_verify = _is_safety_verify_page(response.text)
        if initial_safety_verify:
            self._safety_verify_response = response
        elif self.execution_input is None and "/cas/login" not in response.url:
            self._already_authenticated_response = response

    def is_show_jcaptcha_code(self) -> bool:
        return self.fail_count >= 3

    def get_jcaptcha_code(self) -> bytes:
        response = self._get("https://login.xjtu.edu.cn/cas/captcha.jpg", timeout=20)
        response.raise_for_status()
        return response.content

    def login(
            self,
            username: str | None = None,
            password: str | None = None,
            jcaptcha: str = "",
            account_type: str = "postgraduate",
            trust_agent: bool = True) -> tuple[str, Any]:
        if self._already_authenticated_response is not None:
            authenticated_response = self._already_authenticated_response
            self._already_authenticated_response = None
            self.has_login = True
            self.post_login(authenticated_response)
            return LoginState.SUCCESS, self.session

        if self._choose_account_response is not None:
            return self._finish_account_choice(account_type, trust_agent=trust_agent)

        if self._safety_verify_response is not None:
            if not self._safety_verify_mfa_requested:
                return self._require_safety_verify_mfa(self._safety_verify_response)
            return self._finish_safety_verify()

        if self.has_login:
            raise LmsLoginError("ALREADY_LOGIN", "当前登录流程已经完成，请重新开始。")

        if username and password:
            self._username = username
            self._password = self.encrypt_password(password)
            self._jcaptcha = jcaptcha or ""
        elif not (self._username and self._password):
            raise LmsLoginError("BAD_REQUEST", "首次登录必须填写账号和密码。", http_status=400)
        elif jcaptcha:
            self._jcaptcha = jcaptcha

        if self.is_show_jcaptcha_code() and not self._jcaptcha:
            return LoginState.REQUIRE_CAPTCHA, None

        if self.execution_input is None:
            raise LmsLoginError("LOGIN_PAGE_CHANGED", "服务器登录页缺少 execution 字段，可能已改版。")

        if self.mfa_enabled and not self.has_login and (self.mfa_context is None or not self.mfa_context.required):
            response = self._post(
                "https://login.xjtu.edu.cn/cas/mfa/detect",
                data={
                    "username": self._username,
                    "password": self._password,
                    "fpVisitorId": self.fp_visitor_id,
                    "loginType": "passwordLogin",
                },
                headers={"Referer": self.post_url},
                timeout=20,
            )
            try:
                data = response.json()
            except ValueError as exc:
                raise LmsLoginError("MFA_DETECT_FAILED", "服务器在 MFA 检测时返回了无法解析的信息。") from exc
            result = data.get("data") if isinstance(data, dict) else None
            if not isinstance(result, dict):
                raise LmsLoginError("MFA_DETECT_FAILED", data.get("message") or "服务器在 MFA 检测时返回了异常信息。")
            state = str(result.get("state") or "")
            need = result.get("need") is True
            self.mfa_context = self.MFAContext(self, state, required=need, flow=self.MFAFlow.MFA_DETECT)
            if need:
                return LoginState.REQUIRE_MFA, self.mfa_context

        mfa_state = self.mfa_context.state if self.mfa_context else ""
        current_trust_agent = "true" if self.mfa_context is not None and self.mfa_context.required and trust_agent else ""

        response = self._post(
            self.post_url,
            data={
                "username": self._username,
                "password": self._password,
                "execution": self.execution_input,
                "_eventId": "submit",
                "submit1": "Login1",
                "fpVisitorId": self.fp_visitor_id,
                "captcha": self._jcaptcha,
                "currentMenu": "1",
                "failN": str(self.fail_count),
                "mfaState": mfa_state,
                "geolocation": "",
                "trustAgent": current_trust_agent,
            },
            allow_redirects=True,
            timeout=30,
        )
        return self._process_login_response(response)

    def _process_login_response(self, response: requests.Response) -> tuple[str, Any]:
        if response.status_code == 401:
            self.fail_count += 1
            return LoginState.FAIL, "用户名或密码错误。"
        response.raise_for_status()

        message = _extract_alert_message(response.text)
        if message:
            self.fail_count += 1
            return LoginState.FAIL, message

        if _is_safety_verify_page(response.text):
            return self._require_safety_verify_mfa(response)

        choices = _extract_account_choices(response.text)
        if choices:
            self._choose_account_response = response
            self.has_login = False
            return LoginState.REQUIRE_ACCOUNT_CHOICE, choices

        self.fail_count = 0
        self.has_login = True
        self.post_login(response)
        return LoginState.SUCCESS, self.session

    def _require_safety_verify_mfa(self, response: requests.Response) -> tuple[str, Any]:
        sec_state = _extract_input_value(response.text, "secState")
        if sec_state is None:
            raise LmsLoginError("SAFETY_VERIFY_FAILED", "服务器返回了二次认证页面，但页面缺少 secState 字段。")
        self._safety_verify_response = response
        self._safety_verify_mfa_requested = True
        self.has_login = False
        self.fail_count = 0
        self.mfa_context = self.MFAContext(self, sec_state, required=True, flow=self.MFAFlow.SAFETY_VERIFY)
        return LoginState.REQUIRE_MFA, self.mfa_context

    def _finish_safety_verify(self) -> tuple[str, Any]:
        if self._safety_verify_response is None:
            raise LmsLoginError("BAD_STATE", "当前没有等待完成的二次认证。")

        response = self._safety_verify_response
        sec_state = _extract_input_value(response.text, "secState")
        execution = _extract_input_value(response.text, "execution")
        event_id = _extract_input_value(response.text, "_eventId") or "submit"
        submit = _extract_input_value(response.text, "submit") or "Login1"
        if sec_state is None or execution is None:
            raise LmsLoginError("SAFETY_VERIFY_FAILED", "二次认证页面缺少必要字段。")

        verify_response = self._post(
            response.url,
            data={
                "secState": sec_state,
                "execution": execution,
                "_eventId": event_id,
                "geolocation": "",
                "fpVisitorId": self.fp_visitor_id,
                "submit": submit,
            },
            allow_redirects=True,
            timeout=30,
        )
        self._safety_verify_response = None
        self._safety_verify_mfa_requested = False
        return self._process_login_response(verify_response)

    def _finish_account_choice(self, account_type: str, trust_agent: bool = True) -> tuple[str, Any]:
        if self._choose_account_response is None:
            raise LmsLoginError("BAD_STATE", "当前没有等待选择的账户身份。")

        choices = _extract_account_choices(self._choose_account_response.text)
        if not choices:
            raise LmsLoginError("BAD_STATE", "服务器返回的账户选择信息无法识别。")

        selected_label = ""
        if account_type == "undergraduate":
            selected_label = next((c["label"] for c in choices if "本科" in c["name"]), "")
        else:
            selected_label = next((c["label"] for c in choices if "研究" in c["name"]), "")
        if not selected_label:
            selected_label = choices[0]["label"]

        current_trust_agent = "true" if self.mfa_context is not None and self.mfa_context.required and trust_agent else ""
        choice_response = self._post(
            "https://login.xjtu.edu.cn/cas/login",
            data={
                "execution": _extract_input_value(self._choose_account_response.text, "execution"),
                "_eventId": "submit",
                "geolocation": "",
                "fpVisitorId": self.fp_visitor_id,
                "trustAgent": current_trust_agent,
                "username": selected_label,
                "useDefault": "false",
            },
            allow_redirects=True,
            timeout=30,
        )
        choice_response.raise_for_status()
        self._choose_account_response = None
        self.has_login = True
        self.post_login(choice_response)
        return LoginState.SUCCESS, self.session

    def encrypt_password(self, password: str) -> str:
        try:
            from Crypto.Cipher import PKCS1_v1_5
            from Crypto.PublicKey import RSA
        except ImportError as exc:
            raise LmsLoginError(
                "MISSING_DEPENDENCY",
                "后端缺少 pycryptodome 依赖，请运行 pip install pycryptodome 后重启本地服务。",
                http_status=500,
            ) from exc

        if self.rsa_public_key is None:
            response = self._get(
                "https://login.xjtu.edu.cn/cas/jwt/publicKey",
                headers={"Referer": self.post_url},
                timeout=20,
            )
            response.raise_for_status()
            self.rsa_public_key = response.text
        public_key = RSA.import_key(self.rsa_public_key.encode("utf-8"))
        cipher = PKCS1_v1_5.new(public_key)
        encrypted = cipher.encrypt(password.encode("utf-8"))
        return "__RSA__" + base64.b64encode(encrypted).decode("utf-8")

    def post_login(self, response: requests.Response) -> None:
        return None

    def _get(self, url: str, **kwargs: Any) -> requests.Response:
        return self.session.get(url, **kwargs)

    def _post(self, url: str, **kwargs: Any) -> requests.Response:
        return self.session.post(url, **kwargs)


@dataclass
class LoginFlow:
    login: XjtCasLogin
    mfa_context: XjtCasLogin.MFAContext | None = None
    remember_credentials: bool = False
    username: str = ""
    password: str = ""
    updated_at: float = 0.0


_FLOW_LOCK = threading.RLock()
_FLOWS: dict[str, LoginFlow] = {}


def _cleanup_flows(now: float | None = None) -> None:
    now = now or time.time()
    expired = [flow_id for flow_id, flow in _FLOWS.items() if now - flow.updated_at > FLOW_TTL_SECONDS]
    for flow_id in expired:
        _FLOWS.pop(flow_id, None)


def _store_flow(
        login: XjtCasLogin,
        mfa_context: XjtCasLogin.MFAContext | None = None,
        *,
        remember_credentials: bool = False,
        username: str = "",
        password: str = "") -> str:
    with _FLOW_LOCK:
        _cleanup_flows()
        flow_id = secrets.token_urlsafe(18)
        _FLOWS[flow_id] = LoginFlow(
            login=login,
            mfa_context=mfa_context,
            remember_credentials=remember_credentials,
            username=username,
            password=password,
            updated_at=time.time(),
        )
        return flow_id


def _get_flow(flow_id: str) -> LoginFlow:
    with _FLOW_LOCK:
        _cleanup_flows()
        flow = _FLOWS.get(flow_id)
        if flow is None:
            raise LmsLoginError("FLOW_EXPIRED", "登录流程已过期，请重新输入账号密码登录。", http_status=400)
        flow.updated_at = time.time()
        return flow


def _delete_flow(flow_id: str) -> None:
    with _FLOW_LOCK:
        _FLOWS.pop(flow_id, None)


def _clear_stale_credential(username: str) -> dict[str, Any] | None:
    username = (username or "").strip()
    if not username:
        return None
    status = credential_status()
    if not status.get("ok") or not status.get("has_credential") or status.get("broken"):
        return None
    saved_username = str(status.get("username") or "").strip()
    if saved_username and saved_username != username:
        return clear_lms_credential()
    return None


def _sync_login_credentials(
        flow_id: str | None,
        *,
        remember_credentials: bool = False,
        username: str = "",
        password: str = "") -> dict[str, Any] | None:
    if flow_id:
        flow = _get_flow(flow_id)
        if flow.remember_credentials and flow.username and flow.password:
            return save_lms_credential(flow.username, flow.password)
        return _clear_stale_credential(flow.username)
    if remember_credentials and username and password:
        return save_lms_credential(username, password)
    return _clear_stale_credential(username)


def _format_login_result(
        login: XjtCasLogin,
        state: str,
        info: Any,
        flow_id: str | None = None,
        *,
        remember_credentials: bool = False,
        username: str = "",
        password: str = "") -> dict[str, Any]:
    if state == LoginState.SUCCESS:
        credential = _sync_login_credentials(
            flow_id,
            remember_credentials=remember_credentials,
            username=username,
            password=password,
        )
        if flow_id:
            _delete_flow(flow_id)
        cookie = _export_cookie_header(login.session)
        return {
            "ok": True,
            "status": LoginState.SUCCESS,
            "cookie": cookie,
            "has_session_cookie": "session=" in cookie,
            "credential": credential,
            "message": "LMS 登录成功。",
        }

    if state == LoginState.FAIL:
        if login.is_show_jcaptcha_code():
            image = base64.b64encode(login.get_jcaptcha_code()).decode("ascii")
            new_flow_id = flow_id or _store_flow(
                login,
                remember_credentials=remember_credentials,
                username=username,
                password=password,
            )
            return {
                "ok": True,
                "status": LoginState.REQUIRE_CAPTCHA,
                "flow_id": new_flow_id,
                "captcha_image": f"data:image/jpeg;base64,{image}",
                "message": str(info) if info else "需要输入验证码。",
            }
        return {"ok": False, "error": "LOGIN_FAILED", "message": str(info or "登录失败。")}

    if state == LoginState.REQUIRE_CAPTCHA:
        image = base64.b64encode(login.get_jcaptcha_code()).decode("ascii")
        new_flow_id = flow_id or _store_flow(
            login,
            remember_credentials=remember_credentials,
            username=username,
            password=password,
        )
        return {
            "ok": True,
            "status": LoginState.REQUIRE_CAPTCHA,
            "flow_id": new_flow_id,
            "captcha_image": f"data:image/jpeg;base64,{image}",
            "message": "请输入验证码后继续登录。",
        }

    if state == LoginState.REQUIRE_MFA:
        if not isinstance(info, XjtCasLogin.MFAContext):
            raise LmsLoginError("BAD_MFA_STATE", "服务器返回了无法识别的 MFA 状态。")
        phone = info.get_phone_number()
        new_flow_id = flow_id or _store_flow(
            login,
            info,
            remember_credentials=remember_credentials,
            username=username,
            password=password,
        )
        if flow_id:
            _get_flow(flow_id).mfa_context = info
        return {
            "ok": True,
            "status": LoginState.REQUIRE_MFA,
            "flow_id": new_flow_id,
            "phone": phone,
            "message": "需要短信二次验证。",
        }

    if state == LoginState.REQUIRE_ACCOUNT_CHOICE:
        new_flow_id = flow_id or _store_flow(
            login,
            remember_credentials=remember_credentials,
            username=username,
            password=password,
        )
        return {
            "ok": True,
            "status": LoginState.REQUIRE_ACCOUNT_CHOICE,
            "flow_id": new_flow_id,
            "choices": info or [],
            "message": "请选择要登录的账户身份。",
        }

    raise LmsLoginError("UNKNOWN_STATE", f"未知登录状态: {state}")


def handle_lms_login_request(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    action = str(body.get("action") or "start")
    try:
        if action == "credential_status":
            return 200, credential_status()

        if action == "clear_credentials":
            return 200, clear_lms_credential()

        if action == "start":
            username = str(body.get("username") or "").strip()
            password = str(body.get("password") or "")
            captcha = str(body.get("captcha") or "").strip()
            account_type = str(body.get("account_type") or "postgraduate")
            trust_agent = body.get("trust_agent") is not False
            remember_credentials = body.get("remember") is True
            if not username or not password:
                raise LmsLoginError("BAD_REQUEST", "请填写账号和密码。", http_status=400)
            login = XjtCasLogin(LMS_LOGIN_URL)
            state, info = login.login(username, password, captcha, account_type=account_type, trust_agent=trust_agent)
            return 200, _format_login_result(
                login,
                state,
                info,
                remember_credentials=remember_credentials,
                username=username,
                password=password,
            )

        if action == "start_saved":
            credential = load_lms_credential()
            captcha = str(body.get("captcha") or "").strip()
            account_type = str(body.get("account_type") or "postgraduate")
            trust_agent = body.get("trust_agent") is not False
            login = XjtCasLogin(LMS_LOGIN_URL)
            state, info = login.login(
                credential.username,
                credential.password,
                captcha,
                account_type=account_type,
                trust_agent=trust_agent,
            )
            return 200, _format_login_result(
                login,
                state,
                info,
                remember_credentials=True,
                username=credential.username,
                password=credential.password,
            )

        if action == "submit_captcha":
            flow_id = str(body.get("flow_id") or "")
            captcha = str(body.get("captcha") or "").strip()
            if not flow_id or not captcha:
                raise LmsLoginError("BAD_REQUEST", "请填写验证码。", http_status=400)
            flow = _get_flow(flow_id)
            state, info = flow.login.login(
                jcaptcha=captcha,
                account_type=str(body.get("account_type") or "postgraduate"),
                trust_agent=body.get("trust_agent") is not False,
            )
            return 200, _format_login_result(flow.login, state, info, flow_id=flow_id)

        if action == "send_mfa":
            flow_id = str(body.get("flow_id") or "")
            flow = _get_flow(flow_id)
            if flow.mfa_context is None:
                raise LmsLoginError("BAD_STATE", "当前登录流程不需要 MFA。", http_status=400)
            phone = flow.mfa_context.send_verify_code()
            return 200, {"ok": True, "status": "mfa_code_sent", "phone": phone, "message": "短信验证码已发送。"}

        if action == "verify_mfa":
            flow_id = str(body.get("flow_id") or "")
            code = str(body.get("code") or "").strip()
            if not flow_id or not code:
                raise LmsLoginError("BAD_REQUEST", "请填写短信验证码。", http_status=400)
            flow = _get_flow(flow_id)
            if flow.mfa_context is None:
                raise LmsLoginError("BAD_STATE", "当前登录流程不需要 MFA。", http_status=400)
            flow.mfa_context.verify_phone_code(code)
            state, info = flow.login.login(
                account_type=str(body.get("account_type") or "postgraduate"),
                trust_agent=body.get("trust_agent") is not False,
            )
            return 200, _format_login_result(flow.login, state, info, flow_id=flow_id)

        if action == "finish_account_choice":
            flow_id = str(body.get("flow_id") or "")
            flow = _get_flow(flow_id)
            state, info = flow.login.login(
                account_type=str(body.get("account_type") or "postgraduate"),
                trust_agent=body.get("trust_agent") is not False,
            )
            return 200, _format_login_result(flow.login, state, info, flow_id=flow_id)

        if action == "cancel":
            flow_id = str(body.get("flow_id") or "")
            if flow_id:
                _delete_flow(flow_id)
            return 200, {"ok": True, "status": "cancelled"}

        raise LmsLoginError("BAD_REQUEST", f"未知 LMS 登录动作: {action}", http_status=400)

    except LmsLoginError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except CredentialError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except requests.RequestException as exc:
        return 200, {"ok": False, "error": "NETWORK_ERROR", "message": f"连接西交登录服务失败：{exc}"}
    except Exception as exc:
        return 500, {"ok": False, "error": "INTERNAL_ERROR", "message": f"LMS 登录内部错误：{exc}"}
