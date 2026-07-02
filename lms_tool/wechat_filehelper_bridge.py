"""Persistent stdin/stdout bridge for the restricted WeChat filehelper tool.

The line protocol is one JSON object per line:
  {"id":"...","op":"start|status|read|send|shutdown", ...}

Responses are also one JSON object per line and always include the same id.
"""

from __future__ import annotations

import base64
import json
import sys
import traceback
from datetime import datetime
from typing import Any

import wechat_filehelper_agent_tool as core


class FileHelperBridge:
    def __init__(self) -> None:
        self.backend_name: str | None = None
        self.wx: Any = None
        self.started_at: str | None = None
        self.filehelper_chat: Any = None
        self.filehelper_ready: bool = False

    def reset(self) -> None:
        self.backend_name = None
        self.wx = None
        self.started_at = None
        self.filehelper_chat = None
        self.filehelper_ready = False

    @staticmethod
    def _is_cacheable_chat(candidate: Any, wx: Any) -> bool:
        """Return whether candidate looks like a dedicated chat/session object."""
        if candidate is None or candidate is wx or isinstance(candidate, bool):
            return False
        return hasattr(candidate, "GetAllMessage") or hasattr(candidate, "SendMsg")

    def ensure_open(self) -> tuple[str, Any]:
        if self.wx is None or not self.backend_name:
            self.backend_name, self.wx = core.open_wechat()
            self.started_at = datetime.now().isoformat(timespec="seconds")
        return self.backend_name, self.wx

    def ensure_filehelper_chat(self, force_switch: bool = False) -> tuple[str, Any, Any | None]:
        """Open WeChat and return a safe 文件传输助手 chat/session when available.

        Cache only a dedicated chat/session object. If the backend only switches
        the active WeChat window and returns None/bool/wx, callers must not treat
        wx as permanently bound to 文件传输助手.
        """
        backend_name, wx = self.ensure_open()
        if self.filehelper_chat is not None:
            return backend_name, wx, self.filehelper_chat
        if force_switch or not self.filehelper_ready:
            with core.redirect_backend_stdout():
                candidate = core.switch_to_safe_chat(wx, backend_name)
            if self._is_cacheable_chat(candidate, wx):
                self.filehelper_chat = candidate
                self.filehelper_ready = True
            else:
                self.filehelper_chat = None
                self.filehelper_ready = False
        return backend_name, wx, self.filehelper_chat

    def start(self) -> dict[str, Any]:
        backend_name, wx, _chat = self.ensure_filehelper_chat(force_switch=True)
        return {
            "ok": True,
            "action": "start",
            "backend": backend_name,
            "who": core.SAFE_CHAT_NAME,
            "started_at": self.started_at,
        }

    def status(self) -> dict[str, Any]:
        return {
            "ok": True,
            "action": "status",
            "running": True,
            "initialized": self.wx is not None,
            "backend": self.backend_name,
            "who": core.SAFE_CHAT_NAME,
            "started_at": self.started_at,
        }

    def read_messages(self, limit: int) -> dict[str, Any]:
        backend_name, wx, chat = self.ensure_filehelper_chat(force_switch=self.filehelper_chat is None)
        limit = max(1, min(50, int(limit or 20)))
        with core.redirect_backend_stdout():
            reader = chat if chat is not None and hasattr(chat, "GetAllMessage") else wx
            messages = reader.GetAllMessage()
        if isinstance(messages, list):
            raw_messages = messages[-limit:]
        elif messages is None:
            raw_messages = []
        else:
            try:
                raw_messages = list(messages)[-limit:]
            except TypeError:
                raw_messages = [messages]

        normalized = [core.normalize_message(m) for m in raw_messages]
        core.annotate_context_times(normalized)
        core.assign_message_ids(normalized)
        return {
            "ok": True,
            "action": "read",
            "backend": backend_name,
            "who": core.SAFE_CHAT_NAME,
            "count": len(normalized),
            "messages": normalized,
            "read_at": datetime.now().isoformat(timespec="seconds"),
        }

    @staticmethod
    def _has_agent_prefix(text: str) -> bool:
        stripped = str(text or "").lstrip()
        return stripped.startswith("[Agent]")

    def send_message(self, text: str, prefix: str = "[Agent] ") -> dict[str, Any]:
        backend_name, wx = self.ensure_open()
        chat = self.filehelper_chat
        text = str(text or "")
        # The remote-control UI already formats replies as "[Agent][id]...".
        # Treat any leading "[Agent]" marker as already prefixed; otherwise the
        # default bridge prefix "[Agent] " would produce "[Agent] [Agent]...".
        if prefix and not text.startswith(prefix) and not self._has_agent_prefix(text):
            text = prefix + text
        with core.redirect_backend_stdout():
            if chat is not None and hasattr(chat, "SendMsg"):
                try:
                    result = chat.SendMsg(text)
                except TypeError:
                    result = chat.SendMsg(text, who=core.SAFE_CHAT_NAME)
            else:
                try:
                    result = wx.SendMsg(text, who=core.SAFE_CHAT_NAME)
                except Exception:
                    backend_name, wx, chat = self.ensure_filehelper_chat(force_switch=True)
                    sender = chat if chat is not None and hasattr(chat, "SendMsg") else wx
                    result = sender.SendMsg(text)
        return {
            "ok": True,
            "action": "send",
            "backend": backend_name,
            "who": core.SAFE_CHAT_NAME,
            "result": result,
            "sent_text": text,
            "sent_at": datetime.now().isoformat(timespec="seconds"),
        }

def _decode_text(req: dict[str, Any]) -> str:
    if req.get("text_base64"):
        return base64.b64decode(str(req["text_base64"]).encode("ascii"), validate=True).decode("utf-8")
    return str(req.get("text") or "")


def _handle(bridge: FileHelperBridge, req: dict[str, Any]) -> dict[str, Any]:
    op = str(req.get("op") or "").strip().lower()
    if op == "start":
        return bridge.start()
    if op == "status":
        return bridge.status()
    if op == "read":
        return bridge.read_messages(int(req.get("limit") or 20))
    if op == "send":
        return bridge.send_message(_decode_text(req), prefix=str(req.get("prefix", "[Agent] ")))
    if op == "shutdown":
        return {"ok": True, "action": "shutdown"}
    raise ValueError(f"unknown op: {op}")


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, default=core._json_default), flush=True)


def main() -> int:
    bridge = FileHelperBridge()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = ""
        try:
            req = json.loads(line)
            if not isinstance(req, dict):
                raise ValueError("request must be a JSON object")
            req_id = str(req.get("id") or "")
            payload = _handle(bridge, req)
            payload["id"] = req_id
            _emit(payload)
            if str(req.get("op") or "").strip().lower() == "shutdown":
                return 0
        except Exception as exc:  # noqa: BLE001
            bridge.reset()
            _emit(
                {
                    "id": req_id,
                    "ok": False,
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                }
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
