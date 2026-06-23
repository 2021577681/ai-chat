from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass
from typing import Any

from . import config


class CredentialError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 200):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


@dataclass(frozen=True)
class LmsCredential:
    username: str
    password: str
    saved_at: float


def _credential_path() -> str:
    return os.path.join(config.WORKSPACE_ROOT, ".agent", "lms_credentials.json")


def _protect_password(password: str) -> str:
    try:
        import win32crypt
    except ImportError as exc:
        raise CredentialError(
            "CREDENTIAL_BACKEND_UNAVAILABLE",
            "当前环境缺少 Windows 凭据加密组件 pywin32，无法安全保存密码。",
            http_status=500,
        ) from exc
    protected = win32crypt.CryptProtectData(
        password.encode("utf-8"),
        "AI Chat LMS credential",
        None,
        None,
        None,
        0,
    )
    return base64.b64encode(protected).decode("ascii")


def _unprotect_password(payload: str) -> str:
    try:
        import win32crypt
    except ImportError as exc:
        raise CredentialError(
            "CREDENTIAL_BACKEND_UNAVAILABLE",
            "当前环境缺少 Windows 凭据加密组件 pywin32，无法读取保存的密码。",
            http_status=500,
        ) from exc
    try:
        raw = base64.b64decode(payload.encode("ascii"))
        _, password_bytes = win32crypt.CryptUnprotectData(raw, None, None, None, 0)
        return password_bytes.decode("utf-8")
    except Exception as exc:
        raise CredentialError("CREDENTIAL_DECRYPT_FAILED", "保存的 LMS 密码无法解密，请清除后重新保存。") from exc


def save_lms_credential(username: str, password: str) -> dict[str, Any]:
    username = (username or "").strip()
    if not username or not password:
        raise CredentialError("BAD_REQUEST", "保存账号密码前必须先填写账号和密码。", http_status=400)

    path = _credential_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    saved_at = time.time()
    payload = {
        "version": 1,
        "backend": "windows-dpapi",
        "username": username,
        "password": _protect_password(password),
        "saved_at": saved_at,
    }
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    return credential_status()


def load_lms_credential() -> LmsCredential:
    path = _credential_path()
    if not os.path.exists(path):
        raise CredentialError("NO_SAVED_CREDENTIAL", "尚未保存 LMS 账号密码。", http_status=404)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        raise CredentialError("CREDENTIAL_READ_FAILED", "读取保存的 LMS 账号密码失败。") from exc

    if data.get("backend") != "windows-dpapi":
        raise CredentialError("UNSUPPORTED_CREDENTIAL_BACKEND", "保存的 LMS 凭据格式不受当前版本支持。")
    username = str(data.get("username") or "").strip()
    if not username or not data.get("password"):
        raise CredentialError("CREDENTIAL_INVALID", "保存的 LMS 凭据不完整，请清除后重新保存。")
    return LmsCredential(
        username=username,
        password=_unprotect_password(str(data["password"])),
        saved_at=float(data.get("saved_at") or 0),
    )


def credential_status() -> dict[str, Any]:
    path = _credential_path()
    if not os.path.exists(path):
        return {
            "ok": True,
            "status": "credential_status",
            "has_credential": False,
            "backend": "windows-dpapi",
        }
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {
            "ok": True,
            "status": "credential_status",
            "has_credential": True,
            "broken": True,
            "backend": "windows-dpapi",
        }
    return {
        "ok": True,
        "status": "credential_status",
        "has_credential": True,
        "username": str(data.get("username") or ""),
        "saved_at": float(data.get("saved_at") or 0),
        "backend": str(data.get("backend") or "windows-dpapi"),
    }


def clear_lms_credential() -> dict[str, Any]:
    path = _credential_path()
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as exc:
        raise CredentialError("CREDENTIAL_CLEAR_FAILED", "清除保存的 LMS 账号密码失败。") from exc
    return credential_status()
