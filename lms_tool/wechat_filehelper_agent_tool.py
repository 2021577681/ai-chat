"""Restricted WeChat File Transfer Assistant bridge for Agent control.

This tool is intentionally scoped to WeChat's "文件传输助手" only.
It does not expose a --who argument, and every read/send operation first switches
WeChat to the File Transfer Assistant chat before accessing messages.

Usage:
  python lms_tool/wechat_filehelper_agent_tool.py read --limit 10
  python lms_tool/wechat_filehelper_agent_tool.py send --text "Agent task finished"
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import io
import hashlib
import json
import sys
import traceback
from datetime import datetime
from typing import Any

# Hard privacy boundary: do not make this configurable from CLI/env.
SAFE_CHAT_NAME = "文件传输助手"


def _json_default(obj: Any) -> Any:
    """Best-effort JSON serializer for wxauto message/control objects."""
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    if isinstance(obj, (list, tuple)):
        return [_json_default(item) for item in obj]
    if isinstance(obj, dict):
        return {str(k): _json_default(v) for k, v in obj.items()}

    result: dict[str, Any] = {"type": type(obj).__name__, "repr": repr(obj)}
    for attr in ("sender", "content", "time", "type", "name", "text", "id"):
        if hasattr(obj, attr):
            try:
                result[attr] = _json_default(getattr(obj, attr))
            except Exception:
                pass
    return result


def emit(payload: dict[str, Any], code: int = 0) -> int:
    payload.setdefault("privacy_scope", SAFE_CHAT_NAME)
    payload.setdefault("privacy_note", "This restricted tool only reads/sends WeChat 文件传输助手.")
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default))
    return code


def import_backend():
    """Import wxauto if present, otherwise wxauto4."""
    try:
        import wxauto  # type: ignore

        return "wxauto", wxauto
    except ModuleNotFoundError:
        import wxauto4  # type: ignore

        return "wxauto4", wxauto4


def open_wechat(debug: bool = False, no_resize: bool = False):
    backend_name, backend = import_backend()
    if backend_name == "wxauto4":
        with redirect_backend_stdout():
            kwargs = {"debug": debug, "resize": not no_resize}
            try:
                wx = backend.WeChat(**kwargs, ads=False)
            except TypeError:
                wx = backend.WeChat(**kwargs)
    else:
        with redirect_backend_stdout():
            try:
                wx = backend.WeChat(debug=debug)
            except TypeError:
                wx = backend.WeChat()
    return backend_name, wx


@contextlib.contextmanager
def redirect_backend_stdout():
    """Keep stdout as machine-readable JSON by forwarding backend prints to stderr."""
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        yield
    noise = buffer.getvalue()
    if noise:
        print(noise, file=sys.stderr, end="")


def switch_to_safe_chat(wx: Any, backend_name: str) -> None:
    """Always switch to File Transfer Assistant before any read/send operation."""
    chat_with = getattr(wx, "ChatWith", None)
    if chat_with is not None:
        return chat_with(SAFE_CHAT_NAME)

    switch = getattr(wx, "SwitchToChat", None)
    if switch is not None:
        try:
            switch(SAFE_CHAT_NAME)
        except TypeError:
            # Some backends expose SwitchToChat() without a name. This is not a
            # safe substitute, because it would not guarantee the target chat.
            raise RuntimeError(
                f"{backend_name}.SwitchToChat does not accept a chat name; cannot enforce {SAFE_CHAT_NAME} scope"
            )
        return None

    raise RuntimeError(f"{backend_name} has no ChatWith/SwitchToChat method; cannot enforce {SAFE_CHAT_NAME} scope")


def normalize_message(msg: Any) -> dict[str, Any]:
    data = _json_default(msg)
    backend_id = None
    if isinstance(data, dict):
        sender = data.get("sender") or data.get("name") or ""
        content = data.get("content") or data.get("text") or data.get("repr") or ""
        msg_time = data.get("time")
        msg_type = data.get("type")
        backend_id = data.get("id") or data.get("message_id") or data.get("msg_id")
    elif isinstance(data, (list, tuple)):
        sender = str(data[0]) if len(data) > 0 else ""
        content = str(data[1]) if len(data) > 1 else str(data)
        msg_time = None
        msg_type = None
        backend_id = data[2] if len(data) > 2 else None
    else:
        sender = ""
        content = str(data)
        msg_time = None
        msg_type = None

    normalized = {
        "sender": str(sender),
        "content": str(content),
        "time": msg_time,
        "type": msg_type,
        "raw": data,
    }
    backend_id_text = str(backend_id or "").strip()
    if backend_id_text and backend_id_text.lower() not in {"none", "null"}:
        normalized["backend_id"] = backend_id_text
    return normalized


def message_id(msg: dict[str, Any]) -> str:
    stable_id = str(msg.get("stable_id") or "")
    basis_obj = {
        "stable_id": stable_id or message_sequence_key(msg),
        "sender": msg.get("sender"),
        "type": msg.get("type"),
    }
    basis = json.dumps(
        basis_obj,
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]


def message_time_key(msg: dict[str, Any]) -> str:
    """Return the backend-provided per-message timestamp when available."""
    value = msg.get("time")
    if value is None:
        return ""
    text = str(value).strip()
    return text if text and text.lower() not in {"none", "null"} else ""


def annotate_context_times(messages: list[dict[str, Any]]) -> None:
    """Attach the latest WeChat UI time-separator text to following messages.

    wxauto may expose chat time separators as normal-looking ``SYS`` rows such
    as ``昨天 10:16`` or ``2026年4月25日 11:19`` while individual messages have no
    ``time`` field.  This separator is only minute-granularity context, not a
    reliable per-message timestamp, so it must not be treated as a global unique
    id.  Keep it in the payload for diagnostics, not as part of message identity.
    """
    current_context = ""
    for item in messages:
        if str(item.get("sender") or "") == "SYS":
            current_context = str(item.get("content") or "").strip()
        elif current_context and not message_time_key(item):
            item["context_time"] = current_context


def message_sequence_key(msg: dict[str, Any]) -> str:
    """Stable key used to compare consecutive read windows.

    Prefer a backend-provided per-message id when present. Fall back to the
    backend timestamp, then content hashing for backends that expose neither.
    """
    backend_id = str(msg.get("backend_id") or "").strip()
    if backend_id:
        return f"backend:{backend_id}"
    content_hash = hashlib.sha256(str(msg.get("content") or "").encode("utf-8")).hexdigest()[:12]
    time_key = message_time_key(msg)
    if time_key:
        return f"time:{time_key}:content:{content_hash}"
    basis = json.dumps(
        {
            "sender": msg.get("sender"),
            "content": msg.get("content"),
            "type": msg.get("type"),
        },
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )
    return f"hash:{hashlib.sha256(basis.encode('utf-8')).hexdigest()[:16]}"


def message_id_with_position(msg: dict[str, Any], index: int, total: int) -> str:
    """Return an id for read de-duplication.

    Some WeChat automation backends do not expose a reliable per-message time/id.
    In that case, hashing only sender/content/time/type makes two separate equal
    commands (for example sending "/新建对话/1：你好" again after deleting the chat)
    collide forever. Add the occurrence number among equal stable keys in the
    current window so equal commands can still be distinguished while avoiding
    index/total churn caused by Agent replies.
    """
    stable = str(msg.get("stable_id") or message_sequence_key(msg))
    basis = json.dumps(
        {
            "stable": stable,
        },
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]


def assign_message_ids(normalized: list[dict[str, Any]]) -> None:
    counts: dict[str, int] = {}
    for idx, item in enumerate(normalized):
        base_stable = message_sequence_key(item)
        if base_stable.startswith("backend:"):
            item["stable_id"] = base_stable
        else:
            occurrence = counts.get(base_stable, 0)
            counts[base_stable] = occurrence + 1
            item["stable_id"] = f"{base_stable}#{occurrence}"
        item["id"] = message_id_with_position(item, idx, len(normalized))


def read_safe_messages(limit: int, debug: bool = False, no_resize: bool = False) -> dict[str, Any]:
    backend_name, wx = open_wechat(debug=debug, no_resize=no_resize)
    switch_to_safe_chat(wx, backend_name)
    messages = wx.GetAllMessage()
    if isinstance(messages, list):
        messages = messages[-limit:]
    normalized = [normalize_message(m) for m in messages]
    annotate_context_times(normalized)
    assign_message_ids(normalized)
    return {
        "ok": True,
        "action": "read",
        "backend": backend_name,
        "who": SAFE_CHAT_NAME,
        "count": len(normalized),
        "messages": normalized,
        "read_at": datetime.now().isoformat(timespec="seconds"),
    }


def has_agent_prefix(text: str, agent_prefix: str = "[Agent]") -> bool:
    stripped = str(text or "").lstrip()
    return bool(
        stripped.startswith("[Agent]")
        or (agent_prefix and stripped.startswith(agent_prefix))
        or stripped.startswith("[System]")
    )


def is_likely_agent_own_message(msg: dict[str, Any], agent_prefix: str) -> bool:
    content = msg.get("content", "")
    if has_agent_prefix(content, agent_prefix):
        return True
    # wxauto often marks non-user system/time separators as SYS.
    if msg.get("sender") == "SYS":
        return True
    return False


def has_own_reply(messages: list[dict[str, Any]], agent_prefix: str) -> bool:
    return any(is_likely_agent_own_message(msg, agent_prefix) for msg in (messages or []))


def cmd_read(args: argparse.Namespace) -> int:
    return emit(read_safe_messages(args.limit, debug=args.debug, no_resize=args.no_resize))


def cmd_send(args: argparse.Namespace) -> int:
    backend_name, wx = open_wechat(debug=args.debug, no_resize=args.no_resize)
    switch_to_safe_chat(wx, backend_name)
    if args.text_base64:
        try:
            text = base64.b64decode(args.text_base64.encode("ascii"), validate=True).decode("utf-8")
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"invalid --text-base64: {exc}") from exc
    else:
        text = args.text or ""
    if args.prefix and not text.startswith(args.prefix) and not has_agent_prefix(text):
        text = args.prefix + text
    result = wx.SendMsg(text, who=SAFE_CHAT_NAME)
    return emit(
        {
            "ok": True,
            "action": "send",
            "backend": backend_name,
            "who": SAFE_CHAT_NAME,
            "result": result,
            "sent_text": text,
            "sent_at": datetime.now().isoformat(timespec="seconds"),
        }
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Restricted WeChat 文件传输助手 Agent bridge")
    parser.add_argument("--debug", action="store_true", help="enable wxauto debug mode")
    parser.add_argument("--no-resize", action="store_true", help="do not resize WeChat window")

    sub = parser.add_subparsers(dest="command", required=True)

    read = sub.add_parser("read", help="read only 文件传输助手 messages")
    read.add_argument("--limit", type=int, default=20, help="return only last N messages")
    read.set_defaults(func=cmd_read)

    send = sub.add_parser("send", help="send a text message only to 文件传输助手")
    send.add_argument("--text", default="", help="text to send")
    send.add_argument("--text-base64", default="", help="UTF-8 base64 encoded text to send; safer for tool calls")
    send.add_argument("--prefix", default="[Agent] ", help="prefix added to sent messages; use empty string to disable")
    send.set_defaults(func=cmd_send)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except Exception as exc:  # noqa: BLE001
        return emit(
            {
                "ok": False,
                "error": str(exc),
                "traceback": traceback.format_exc(),
                "hint": f"请确认 Windows 微信已登录且可访问，并且可切换到 {SAFE_CHAT_NAME}。本工具不会读取/发送其他聊天。",
            },
            1,
        )


if __name__ == "__main__":
    sys.exit(main())
