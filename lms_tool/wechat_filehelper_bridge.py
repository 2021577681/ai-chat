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
    LISTEN_CACHE_LIMIT = 200

    def __init__(self) -> None:
        self.backend_name: str | None = None
        self.wx: Any = None
        self.started_at: str | None = None
        self.filehelper_chat: Any = None
        self.filehelper_ready: bool = False
        self.listen_enabled: bool = False
        self.listen_error: str | None = None
        self.message_cache: list[dict[str, Any]] = []

    def reset(self) -> None:
        self.backend_name = None
        self.wx = None
        self.started_at = None
        self.filehelper_chat = None
        self.filehelper_ready = False
        self.listen_enabled = False
        self.listen_error = None
        self.message_cache = []

    @staticmethod
    def _is_cacheable_chat(candidate: Any, wx: Any) -> bool:
        """Return whether candidate looks like a dedicated chat/session object."""
        if candidate is None or candidate is wx or isinstance(candidate, bool):
            return False
        return hasattr(candidate, "GetAllMessage") or hasattr(candidate, "SendMsg")

    def _listen_chat(self) -> Any | None:
        listen = getattr(self.wx, "listen", None)
        if not isinstance(listen, dict):
            return None
        candidate = listen.get(core.SAFE_CHAT_NAME)
        if not self._is_cacheable_chat(candidate, self.wx):
            return None
        self.filehelper_chat = candidate
        self.filehelper_ready = True
        return candidate

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
        listen_chat = self._listen_chat()
        if listen_chat is not None:
            return backend_name, wx, listen_chat
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

    @staticmethod
    def _flatten_listen_messages(payload: Any) -> list[Any]:
        """Normalize wxauto GetListenMessage return shapes into message objects.

        wxauto 3.9 may return a list of messages for one chat, or a mapping from
        chat/window identifiers to lists of messages when multiple chats are
        listened. Keep tuple message records intact so core.normalize_message can
        still interpret them as a single message.
        """
        if payload is None:
            return []
        if isinstance(payload, dict):
            items: list[Any] = []
            for value in payload.values():
                items.extend(FileHelperBridge._flatten_listen_messages(value))
            return items
        if isinstance(payload, list):
            return payload
        if isinstance(payload, tuple):
            if len(payload) == 2 and isinstance(payload[1], (list, tuple, dict)):
                return FileHelperBridge._flatten_listen_messages(payload[1])
            return [payload]
        return [payload]

    def _append_to_message_cache(self, raw_messages: list[Any]) -> None:
        if not raw_messages:
            return
        normalized = [core.normalize_message(m) for m in raw_messages]
        core.annotate_context_times(normalized)
        existing_backend_keys = set()
        for item in self.message_cache:
            key = core.message_sequence_key(item)
            if key.startswith("backend:"):
                existing_backend_keys.add(key)

        unique: list[dict[str, Any]] = []
        for item in normalized:
            key = core.message_sequence_key(item)
            if key.startswith("backend:"):
                if key in existing_backend_keys:
                    continue
                existing_backend_keys.add(key)
            unique.append(item)
        if not unique:
            return
        self.message_cache.extend(unique)
        if len(self.message_cache) > self.LISTEN_CACHE_LIMIT:
            self.message_cache = self.message_cache[-self.LISTEN_CACHE_LIMIT :]

    def _seed_message_cache_from_all_messages(self, limit: int) -> None:
        """Populate the listen cache once so the first read still has context."""
        _backend_name, wx = self.ensure_open()
        chat = self._listen_chat() or self.filehelper_chat
        if chat is None:
            _backend_name, wx, chat = self.ensure_filehelper_chat(force_switch=self.filehelper_chat is None)
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
        self.message_cache = []
        self._append_to_message_cache(raw_messages)

    def ensure_listening(self, initial_limit: int) -> bool:
        """Enable wxauto 3.9 incremental listening for 文件传输助手 when possible."""
        backend_name, wx = self.ensure_open()
        if backend_name != "wxauto":
            return False
        if not hasattr(wx, "AddListenChat") or not hasattr(wx, "GetListenMessage"):
            return False
        if self.listen_enabled:
            return True
        try:
            with core.redirect_backend_stdout():
                wx.AddListenChat(core.SAFE_CHAT_NAME)
            self._listen_chat()
            self.listen_enabled = True
            self.listen_error = None
            # wxauto initializes its GetNewMessage baseline on the first listen
            # read and returns no messages. Do that before the full seed so
            # messages arriving during startup are still picked up by the next
            # incremental poll instead of being swallowed as baseline history.
            if not self._poll_listen_cache():
                return False
            # Keep existing behavior for the first read by seeding from the
            # current window once; subsequent reads only poll the listen cache.
            self._seed_message_cache_from_all_messages(max(initial_limit, 50))
            return True
        except Exception as exc:  # noqa: BLE001
            self.listen_enabled = False
            self.listen_error = str(exc)
            return False

    def _poll_listen_cache(self) -> bool:
        if not self.listen_enabled or self.wx is None:
            return False
        try:
            with core.redirect_backend_stdout():
                try:
                    payload = self.wx.GetListenMessage(core.SAFE_CHAT_NAME)
                except TypeError:
                    payload = self.wx.GetListenMessage()
            self._append_to_message_cache(self._flatten_listen_messages(payload))
            self.listen_error = None
            return True
        except Exception as exc:  # noqa: BLE001
            self.listen_enabled = False
            self.listen_error = str(exc)
            return False

    def start(self) -> dict[str, Any]:
        backend_name, wx = self.ensure_open()
        listen_available = backend_name == "wxauto" and hasattr(wx, "AddListenChat") and hasattr(wx, "GetListenMessage")
        if listen_available:
            self.ensure_listening(initial_limit=50)
        if not self.listen_enabled:
            backend_name, wx, _chat = self.ensure_filehelper_chat(force_switch=True)
        return {
            "ok": True,
            "action": "start",
            "backend": backend_name,
            "who": core.SAFE_CHAT_NAME,
            "started_at": self.started_at,
            "listen_available": listen_available,
            "listen_enabled": self.listen_enabled,
            "listen_error": self.listen_error,
            "cache_size": len(self.message_cache),
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
            "listen_enabled": self.listen_enabled,
            "listen_error": self.listen_error,
            "cache_size": len(self.message_cache),
        }

    def read_messages(self, limit: int) -> dict[str, Any]:
        limit = max(1, min(50, int(limit or 20)))
        if self.ensure_listening(initial_limit=limit):
            if self._poll_listen_cache() and self.listen_enabled:
                normalized = [dict(m) for m in self.message_cache[-limit:]]
                core.annotate_context_times(normalized)
                core.assign_message_ids(normalized)
                return {
                    "ok": True,
                    "action": "read",
                    "backend": self.backend_name,
                    "who": core.SAFE_CHAT_NAME,
                    "count": len(normalized),
                    "messages": normalized,
                    "read_at": datetime.now().isoformat(timespec="seconds"),
                    "read_source": "listen_cache",
                    "listen_enabled": self.listen_enabled,
                    "listen_error": self.listen_error,
                    "cache_size": len(self.message_cache),
                }

        backend_name, wx, chat = self.ensure_filehelper_chat(force_switch=self.filehelper_chat is None)
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
            "read_source": "get_all_message",
            "listen_enabled": False,
            "listen_error": self.listen_error,
        }

    @staticmethod
    def _has_agent_prefix(text: str) -> bool:
        stripped = str(text or "").lstrip()
        return stripped.startswith("[Agent]")

    def send_message(self, text: str, prefix: str = "[Agent] ") -> dict[str, Any]:
        backend_name, wx = self.ensure_open()
        chat = self._listen_chat() or self.filehelper_chat
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
                    if sender is wx:
                        result = wx.SendMsg(text, who=core.SAFE_CHAT_NAME)
                    else:
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
