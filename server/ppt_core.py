# ============================================================
# server/ppt_core.py - PPT image pipeline facade
# ============================================================
# The old native/structured PPT implementation has been removed.
# This mixin only exposes the current project HTML-image PPT workflow.

from .ppt_image_pipeline import generate_html_image_ppt
from .ppt_tasks import control_ppt_task, get_ppt_task, start_ppt_task


def _as_text(value, default=""):
    if value is None:
        return default
    if isinstance(value, str):
        return value
    return str(value)


class PptMixin:
    """Handler mixin for the current project PPT image workflow."""

    def handle_ppt_task(self, body):
        data = body.get("data") or {}
        if not isinstance(data, dict):
            data = {}

        command = _as_text(body.get("command") or data.get("command") or "status", "status").strip().lower()
        task_id = _as_text(body.get("task_id") or data.get("task_id") or "", "")

        if command == "start":
            return self._send_json(200, start_ppt_task(data.get("payload") or data.get("data") or data))

        if command in ("status", "poll", "get"):
            since = body.get("since") if body.get("since") is not None else data.get("since")
            return self._send_json(200, get_ppt_task(task_id, since or 0))

        if command in (
            "pause",
            "stop",
            "resume",
            "cancel",
            "abort",
            "guide",
            "guidance",
            "feedback",
            "comment",
            "resume_with_guidance",
        ):
            control_payload = {}
            control_payload.update(data)
            for key, value in body.items():
                if key != "data":
                    control_payload[key] = value
            return self._send_json(200, control_ppt_task(task_id, command, control_payload))

        return self._send_json(200, {"ok": False, "error": f"未知 PPT 任务命令: {command}"})

    def handle_generate_ppt(self, body):
        data = body.get("data") or {}
        if not isinstance(data, dict):
            return self._send_json(200, {"ok": False, "error": "data 必须是对象"})

        if data.get("slides") is not None:
            return self._send_json(200, {
                "ok": False,
                "error": "旧版 slides 结构化 PPT 流程已移除，请改用 user_request/request/prompt 走当前 html_image PPT 模式。",
            })

        legacy_template_keys = [
            key for key in (
                "template",
                "template_path",
                "template_mode",
                "template_strategy",
                "template_profile",
                "template_profile_path",
            )
            if data.get(key)
        ]
        if legacy_template_keys:
            return self._send_json(200, {
                "ok": False,
                "error": "旧版 PPT 模板填充/结构化模板流程已移除，请使用当前 project HTML 图片页模板流程。",
                "unsupported_keys": legacy_template_keys,
            })

        render_mode = _as_text(data.get("render_mode") or "html_image", "html_image").strip().lower()
        if render_mode and render_mode != "html_image":
            return self._send_json(200, {
                "ok": False,
                "error": "旧版 native/vector/structured 渲染模式已移除，当前仅支持 html_image。",
            })

        return self._send_json(200, generate_html_image_ppt(data))
