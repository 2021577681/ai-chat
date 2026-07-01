"""Small wxauto/wxauto4 bridge for reading and sending WeChat PC messages.

Usage examples:
  python lms_tool/wechat_wxauto_tool.py read
  python lms_tool/wechat_wxauto_tool.py read --who 文件传输助手
  python lms_tool/wechat_wxauto_tool.py send --who 文件传输助手 --text "hello"

This is intended for local, already logged-in Windows WeChat clients.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime
from typing import Any


def _json_default(obj: Any) -> Any:
    """Best-effort JSON serializer for wxauto message/control objects."""
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    if isinstance(obj, (list, tuple)):
        return [_json_default(item) for item in obj]
    if isinstance(obj, dict):
        return {str(k): _json_default(v) for k, v in obj.items()}

    result: dict[str, Any] = {"type": type(obj).__name__, "repr": repr(obj)}
    for attr in ("sender", "content", "time", "type", "name", "text"):
        if hasattr(obj, attr):
            try:
                result[attr] = _json_default(getattr(obj, attr))
            except Exception:
                pass
    return result


def emit(payload: dict[str, Any], code: int = 0) -> int:
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
        kwargs = {"debug": debug, "resize": not no_resize}
        # wxauto4 prints an advertisement banner by default; ads=False is supported
        # by current wxauto4. If a future backend rejects it, retry without the
        # optional flag.
        try:
            wx = backend.WeChat(**kwargs, ads=False)
        except TypeError:
            wx = backend.WeChat(**kwargs)
    else:
        # Classic wxauto 3.9.x accepts only language/debug. It is installed by
        # the `weixin-auto` PyPI package and is the right backend for WeChat 3.9.x.
        try:
            wx = backend.WeChat(debug=debug)
        except TypeError:
            wx = backend.WeChat()
    return backend_name, wx


def read_messages(args: argparse.Namespace) -> int:
    backend_name, wx = open_wechat(debug=args.debug, no_resize=args.no_resize)

    if args.who:
        # wxauto4: ChatWith(who); older wxauto often also has ChatWith.
        # SwitchToChat() only switches to the chat tab and does not accept a name.
        chat_with = getattr(wx, "ChatWith", None)
        if chat_with is not None:
            chat_with(args.who)
        else:
            switch = getattr(wx, "SwitchToChat", None)
            if switch is not None:
                switch(args.who)
            else:
                return emit(
                    {
                        "ok": False,
                        "error": "backend has no ChatWith/SwitchToChat method",
                        "backend": backend_name,
                    },
                    2,
                )

    is_online = None
    if hasattr(wx, "IsOnline"):
        try:
            is_online = wx.IsOnline()
        except Exception as exc:  # noqa: BLE001
            is_online = f"unknown: {exc}"

    messages = wx.GetAllMessage()
    if args.limit and isinstance(messages, list):
        messages = messages[-args.limit :]

    return emit(
        {
            "ok": True,
            "action": "read",
            "backend": backend_name,
            "who": args.who,
            "is_online": is_online,
            "count": len(messages) if hasattr(messages, "__len__") else None,
            "messages": messages,
            "read_at": datetime.now().isoformat(timespec="seconds"),
        }
    )


def send_message(args: argparse.Namespace) -> int:
    backend_name, wx = open_wechat(debug=args.debug, no_resize=args.no_resize)
    result = wx.SendMsg(args.text, who=args.who)
    return emit(
        {
            "ok": True,
            "action": "send",
            "backend": backend_name,
            "who": args.who,
            "result": result,
            "sent_at": datetime.now().isoformat(timespec="seconds"),
        }
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local WeChat PC wxauto tool")
    parser.add_argument("--debug", action="store_true", help="enable wxauto debug mode")
    parser.add_argument("--no-resize", action="store_true", help="do not resize WeChat window")

    sub = parser.add_subparsers(dest="command", required=True)

    read = sub.add_parser("read", help="read messages from current or specified chat")
    read.add_argument("--who", help="chat/contact/group name to switch to before reading")
    read.add_argument("--limit", type=int, default=20, help="return only last N list messages")
    read.set_defaults(func=read_messages)

    send = sub.add_parser("send", help="send a text message")
    send.add_argument("--who", required=True, help="chat/contact/group name")
    send.add_argument("--text", required=True, help="text to send")
    send.set_defaults(func=send_message)

    args = parser.parse_args(argv)

    try:
        return args.func(args)
    except Exception as exc:  # noqa: BLE001
        return emit(
            {
                "ok": False,
                "error": str(exc),
                "traceback": traceback.format_exc(),
                "hint": "请确认 Windows 微信已登录且主窗口可访问；微信 3.9.x 用 wxauto/weixin-auto，微信 4.x 用 wxauto4。",
            },
            1,
        )


if __name__ == "__main__":
    sys.exit(main())
