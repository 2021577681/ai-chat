"""Restricted WeChat File Transfer Assistant bridge for Agent control.

This tool is intentionally scoped to WeChat's "文件传输助手" only.
It does not expose a --who argument, and every read/send operation first switches
WeChat to the File Transfer Assistant chat before accessing messages.

Usage:
  python lms_tool/wechat_filehelper_agent_tool.py read --limit 10
  python lms_tool/wechat_filehelper_agent_tool.py send --text "Agent task finished"
  python lms_tool/wechat_filehelper_agent_tool.py poll --limit 20 --state-file .agent/wechat_filehelper_state.json

Typical Agent flow:
  1. User sends a command to 文件传输助手 from phone/PC.
  2. Agent calls this tool's `poll` command.
  3. Agent executes only the returned new inbound command(s).
  4. Agent calls this tool's `send` command to send the result back.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import io
import hashlib
import json
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

# Hard privacy boundary: do not make this configurable from CLI/env.
SAFE_CHAT_NAME = "文件传输助手"
DEFAULT_STATE_FILE = Path(".agent/wechat_filehelper_state.json")


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
    if isinstance(data, dict):
        sender = data.get("sender") or data.get("name") or ""
        content = data.get("content") or data.get("text") or data.get("repr") or ""
        msg_time = data.get("time")
        msg_type = data.get("type")
    elif isinstance(data, (list, tuple)):
        sender = str(data[0]) if len(data) > 0 else ""
        content = str(data[1]) if len(data) > 1 else str(data)
        msg_time = None
        msg_type = None
    else:
        sender = ""
        content = str(data)
        msg_time = None
        msg_type = None

    return {
        "sender": str(sender),
        "content": str(content),
        "time": msg_time,
        "type": msg_type,
        "raw": data,
    }


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
    """Stable key used to compare consecutive polling windows.

    Prefer the backend-provided message timestamp when present: if the timestamp
    is identical, it is the same WeChat message and must not execute again.  Only
    fall back to content-based hashing for backends that expose no usable time.
    """
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
    """Return an id for polling de-duplication.

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


def assign_polling_ids(normalized: list[dict[str, Any]]) -> None:
    counts: dict[str, int] = {}
    for idx, item in enumerate(normalized):
        base_stable = message_sequence_key(item)
        occurrence = counts.get(base_stable, 0)
        counts[base_stable] = occurrence + 1
        item["stable_id"] = f"{base_stable}#{occurrence}"
        item["id"] = message_id_with_position(item, idx, len(normalized))


def message_overlap_key(value: Any) -> str:
    """Return a stable key for rolling-window overlap detection.

    ``stable_id`` contains an occurrence suffix (``#0``, ``#1``...) so repeated
    equal messages can be distinguished in a single read window.  That suffix is
    intentionally *not* stable across sliding windows: when older equal messages
    fall out of the poll limit, later occurrences are renumbered.  Using it for
    overlap can make the bridge think every poll has drifted, swallowing fresh
    commands as a re-baseline.  Strip only the final numeric occurrence suffix
    for overlap matching; the full ``stable_id`` is still persisted and used for
    per-window ids.
    """
    text = str(value or "")
    head, sep, tail = text.rpartition("#")
    if sep and tail.isdigit():
        return head
    return text


def rolling_window_overlap_count(previous_keys: list[Any], messages: list[dict[str, Any]]) -> int:
    """Return how many current-window leading messages overlap previous tail."""
    previous = [message_overlap_key(x) for x in previous_keys if str(x)]
    current = [message_overlap_key(m.get("stable_id") or message_sequence_key(m)) for m in messages]
    if not previous or not current:
        return 0
    max_overlap = min(len(previous), len(current))
    for n in range(max_overlap, 0, -1):
        if previous[-n:] == current[:n]:
            return n
    return 0


def rolling_window_reverse_overlap_count(previous_keys: list[Any], messages: list[dict[str, Any]]) -> int:
    """Return overlap for backends that expose newest messages first."""
    previous = [message_overlap_key(x) for x in previous_keys if str(x)]
    current = [message_overlap_key(m.get("stable_id") or message_sequence_key(m)) for m in messages]
    if not previous or not current:
        return 0
    max_overlap = min(len(previous), len(current))
    for n in range(max_overlap, 0, -1):
        if previous[:n] == current[-n:]:
            return n
    return 0


def rolling_window_any_overlap_count(previous_keys: list[Any], messages: list[dict[str, Any]]) -> int:
    return max(
        rolling_window_overlap_count(previous_keys, messages),
        rolling_window_reverse_overlap_count(previous_keys, messages),
    )


def new_messages_from_sequence(
    state: dict[str, Any],
    messages: list[dict[str, Any]],
    *,
    no_overlap_behavior: str = "baseline",
) -> list[dict[str, Any]]:
    previous = [message_overlap_key(x) for x in state.get("last_message_keys", []) if str(x)]
    current = [message_overlap_key(m.get("stable_id") or message_sequence_key(m)) for m in messages]
    if not previous:
        return []
    if not current:
        return []
    forward_overlap = rolling_window_overlap_count(state.get("last_message_keys", []), messages)
    reverse_overlap = rolling_window_reverse_overlap_count(state.get("last_message_keys", []), messages)
    if forward_overlap <= 0 and reverse_overlap <= 0:
        # The persisted rolling window no longer matches the current WeChat
        # window.  On a cold start this must be treated as a re-baseline,
        # otherwise old remote-control commands visible in File Transfer
        # Assistant may be replayed.  However, after the persistent bridge has
        # already established its startup baseline, a no-overlap window can also
        # mean the user cleared File Transfer Assistant history and then sent a
        # fresh command.  In that runtime-reset case, returning [] would swallow
        # the first command after the clear forever (each new one would again be
        # the whole window).  Let the persistent bridge opt into accepting the
        # current window as fresh after its first safe baseline.
        if no_overlap_behavior == "current":
            return messages
        return []
    if forward_overlap >= reverse_overlap:
        if forward_overlap == len(current):
            return []
        return messages[forward_overlap:]
    if reverse_overlap == len(current):
        return []
    return list(reversed(messages[:len(current) - reverse_overlap]))


def assign_delivery_ids(state: dict[str, Any], messages: list[dict[str, Any]]) -> None:
    counter = int(state.get("delivery_counter") or 0)
    for msg in messages:
        counter += 1
        msg["delivery_id"] = f"d{counter}"
    state["delivery_counter"] = counter


def read_safe_messages(limit: int, debug: bool = False, no_resize: bool = False) -> dict[str, Any]:
    backend_name, wx = open_wechat(debug=debug, no_resize=no_resize)
    switch_to_safe_chat(wx, backend_name)
    messages = wx.GetAllMessage()
    if isinstance(messages, list):
        messages = messages[-limit:]
    normalized = [normalize_message(m) for m in messages]
    annotate_context_times(normalized)
    assign_polling_ids(normalized)
    return {
        "ok": True,
        "action": "read",
        "backend": backend_name,
        "who": SAFE_CHAT_NAME,
        "count": len(normalized),
        "messages": normalized,
        "read_at": datetime.now().isoformat(timespec="seconds"),
    }


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"seen_ids": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"seen_ids": []}
    if not isinstance(data, dict):
        return {"seen_ids": []}
    seen = data.get("seen_ids")
    if not isinstance(seen, list):
        data["seen_ids"] = []
    return data


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


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


def cmd_poll(args: argparse.Namespace) -> int:
    state_path = Path(args.state_file)
    state = load_state(state_path)
    seen_ids = set(str(x) for x in state.get("seen_ids", []))

    deadline = time.time() + max(0, args.timeout)
    last_payload: dict[str, Any] | None = None
    new_messages: list[dict[str, Any]] = []
    window_reset = False

    while True:
        payload = read_safe_messages(args.limit, debug=args.debug, no_resize=args.no_resize)
        last_payload = payload
        messages = payload.get("messages", [])
        new_messages = []
        window_reset = False
        overlap = rolling_window_any_overlap_count(state.get("last_message_keys", []), messages)
        has_previous = bool(state.get("last_message_keys"))
        has_current = bool(messages)
        if has_previous and has_current and overlap <= 0 and not has_own_reply(messages, args.agent_prefix):
            candidates = messages
            window_reset = True
        else:
            candidates = new_messages_from_sequence(state, messages)
        for msg in candidates:
            msg_id = str(msg.get("id") or "")
            stable_id = str(msg.get("stable_id") or "")
            # Only globally de-duplicate messages when the backend exposes a
            # real per-message time.  Without a backend time/id, repeated
            # identical commands hash to the same id; relying on the rolling
            # last_message_keys overlap lets a later identical command run again.
            if stable_id.startswith("time:") and msg_id in seen_ids:
                continue
            if is_likely_agent_own_message(msg, args.agent_prefix):
                if stable_id.startswith("time:"):
                    seen_ids.add(msg_id)
                continue
            new_messages.append(msg)
        assign_delivery_ids(state, new_messages)

        if new_messages or time.time() >= deadline:
            break
        time.sleep(max(0.2, args.interval))

    all_current_ids = [m["id"] for m in (last_payload or {}).get("messages", [])]
    state["seen_ids"] = list(dict.fromkeys([*state.get("seen_ids", []), *all_current_ids]))[-args.max_seen :]
    state["last_message_keys"] = [str(m.get("stable_id") or "") for m in (last_payload or {}).get("messages", []) if str(m.get("stable_id") or "")][-args.limit :]
    state["updated_at"] = datetime.now().isoformat(timespec="seconds")
    save_state(state_path, state)

    return emit(
        {
            "ok": True,
            "action": "poll",
            "backend": (last_payload or {}).get("backend"),
            "who": SAFE_CHAT_NAME,
            "count": len(new_messages),
            "messages": new_messages,
            "state_file": str(state_path),
            "polled_at": datetime.now().isoformat(timespec="seconds"),
            "window_reset": window_reset,
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

    poll = sub.add_parser("poll", help="read new, unseen 文件传输助手 messages")
    poll.add_argument("--limit", type=int, default=20, help="scan last N messages")
    poll.add_argument("--state-file", default=str(DEFAULT_STATE_FILE), help="JSON state file for seen message ids")
    poll.add_argument("--timeout", type=float, default=0, help="seconds to wait for a new message")
    poll.add_argument("--interval", type=float, default=1, help="polling interval when timeout > 0")
    poll.add_argument("--max-seen", type=int, default=500, help="maximum seen message ids to keep")
    poll.add_argument("--agent-prefix", default="[Agent] ", help="ignore messages starting with this prefix")
    poll.set_defaults(func=cmd_poll)

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
