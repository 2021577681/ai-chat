# ============================================================
# server/ppt_core.py - PPT image pipeline facade
# ============================================================
# This mixin exposes the current project HTML-image PPT workflow.

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
            return self.response.json(200, start_ppt_task(data.get("payload") or data.get("data") or data))

        if command in ("status", "poll", "get"):
            since = body.get("since") if body.get("since") is not None else data.get("since")
            return self.response.json(200, get_ppt_task(task_id, since or 0))

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
            return self.response.json(200, control_ppt_task(task_id, command, control_payload))

        return self.response.json(200, {"ok": False, "error": f"未知 PPT 任务命令: {command}"})

    def handle_generate_ppt(self, body):
        data = body.get("data") or {}
        if not isinstance(data, dict):
            return self.response.json(200, {"ok": False, "error": "data 必须是对象"})

        return self.response.json(200, generate_html_image_ppt(data))
