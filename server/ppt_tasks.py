"""Runtime task manager for PPT image pipeline progress/pause/resume/cancel."""

import threading
import time
import traceback
import uuid

from .ppt_image_pipeline import generate_html_image_ppt


_TASKS = {}
_TASKS_LOCK = threading.RLock()
_MAX_TASK_AGE_SECONDS = 6 * 60 * 60
_FINAL_STATUSES = ("done", "error", "cancelled")


class PptTaskCancelled(RuntimeError):
    pass


class PptTask:
    def __init__(self, data):
        self.id = "ppt_" + time.strftime("%Y%m%d_%H%M%S_") + uuid.uuid4().hex[:8]
        self.data = dict(data or {})
        self.data.setdefault("_ppt_user_guidance", [])
        self.data.setdefault("_ppt_guidance_version", 0)
        self.status = "queued"
        self.created_at = time.time()
        self.updated_at = self.created_at
        self.started_at = None
        self.finished_at = None
        self.progress = []
        self.guidance = []
        self._guidance_version = 0
        self.result = None
        self.error = ""
        self.pause_requested = False
        self.cancel_requested = False
        self._cond = threading.Condition()
        self._thread = threading.Thread(target=self._run, name=f"ppt-task-{self.id}", daemon=True)

    def start(self):
        self._thread.start()

    def emit(self, event):
        if not isinstance(event, dict):
            event = {"type": "message", "message": str(event)}
        ev = dict(event)
        ev.setdefault("ts", time.time())
        with self._cond:
            self.progress.append(ev)
            if len(self.progress) > 1000:
                self.progress = self.progress[-1000:]
            if ev.get("status") == "running" and self.status not in ("cancelling", "cancelled"):
                self.status = "running"
            self.updated_at = time.time()
            self._cond.notify_all()

    def _sync_guidance_into_data_locked(self):
        self.data["_ppt_user_guidance"] = list(self.guidance)
        self.data["_ppt_guidance_version"] = self._guidance_version
        return {
            "version": self._guidance_version,
            "items": list(self.guidance),
        }

    def _public_guidance_item(self, item):
        attachments = []
        for att in item.get("attachments") or []:
            if not isinstance(att, dict):
                continue
            public = {
                "id": att.get("id"),
                "name": att.get("name"),
                "type": att.get("type"),
                "mime": att.get("mime"),
                "size": att.get("size"),
                "path": att.get("path"),
            }
            if att.get("text"):
                public["text_chars"] = len(str(att.get("text") or ""))
            if att.get("data"):
                public["has_data"] = True
            attachments.append({k: v for k, v in public.items() if v not in (None, "")})
        return {
            "id": item.get("id"),
            "message": item.get("message") or "",
            "source": item.get("source") or "user",
            "created_at": item.get("created_at"),
            "attachments": attachments,
        }

    def _public_guidance(self):
        return [self._public_guidance_item(item) for item in self.guidance]

    def _guidance_from_payload(self, command, payload):
        if not isinstance(payload, dict):
            payload = {}
        message = payload.get("message")
        if message is None:
            message = payload.get("text")
        if message is None:
            message = payload.get("guidance")
        message = str(message or "").strip()
        attachments = payload.get("attachments") or payload.get("files") or []
        if not isinstance(attachments, list):
            attachments = [attachments]
        clean_attachments = [a for a in attachments if isinstance(a, dict)]
        if not message and not clean_attachments:
            return None
        return {
            "id": "guidance_" + uuid.uuid4().hex[:10],
            "command": command,
            "source": str(payload.get("source") or "user"),
            "message": message,
            "attachments": clean_attachments,
            "created_at": time.time(),
        }

    def _append_guidance_locked(self, command, payload):
        item = self._guidance_from_payload(command, payload)
        if not item:
            return None
        self.guidance.append(item)
        if len(self.guidance) > 50:
            self.guidance = self.guidance[-50:]
        self._guidance_version += 1
        self._sync_guidance_into_data_locked()
        self.emit({
            "type": "guidance",
            "status": "done",
            "stage": "user_guidance",
            "message": "已收到用户补充，后续 PPT 步骤会优先遵循。",
            "detail": {
                "count": len(self.guidance),
                "version": self._guidance_version,
                "guidance": self._public_guidance_item(item),
            },
        })
        return item

    def checkpoint(self, label="", request_input=None):
        with self._cond:
            if self.cancel_requested:
                raise PptTaskCancelled("PPT 任务已取消")
            if request_input and self.status not in _FINAL_STATUSES:
                detail = request_input if isinstance(request_input, dict) else {"message": str(request_input)}
                self.pause_requested = True
                self.status = "paused"
                self.emit({
                    "type": "input_required",
                    "status": "paused",
                    "stage": detail.get("stage") or label or "clarify",
                    "message": detail.get("message") or "PPT 生成需要你补充信息。",
                    "detail": detail,
                })
            self._sync_guidance_into_data_locked()
            while self.pause_requested and not self.cancel_requested:
                self.status = "paused"
                self.updated_at = time.time()
                self._cond.notify_all()
                self._cond.wait(timeout=1.0)
            if self.cancel_requested:
                raise PptTaskCancelled("PPT 任务已取消")
            guidance = self._sync_guidance_into_data_locked()
            if self.status == "paused":
                self.status = "running"
                self.updated_at = time.time()
                self._cond.notify_all()
            return guidance

    def control(self, command, payload=None):
        cmd = str(command or "").lower().strip()
        with self._cond:
            if cmd in ("guide", "guidance", "feedback", "comment", "resume_with_guidance"):
                self._append_guidance_locked(cmd, payload)
                if self.status not in _FINAL_STATUSES:
                    self.pause_requested = False
                    self.status = "running"
                    self.emit({"type": "task_control", "status": "running", "stage": "resume", "message": "已带着用户补充继续执行。"})
                    self._cond.notify_all()
            elif cmd in ("pause", "stop"):
                self._append_guidance_locked(cmd, payload)
                if self.status not in _FINAL_STATUSES:
                    self.pause_requested = True
                    self.status = "paused"
                    self.emit({"type": "task_control", "status": "paused", "stage": "pause", "message": "已请求暂停，当前小步结束后会停住。"})
            elif cmd == "resume":
                self._append_guidance_locked(cmd, payload)
                if self.status not in _FINAL_STATUSES:
                    self.pause_requested = False
                    self.status = "running"
                    self.emit({"type": "task_control", "status": "running", "stage": "resume", "message": "已恢复执行。"})
                    self._cond.notify_all()
            elif cmd in ("cancel", "abort"):
                if self.status not in _FINAL_STATUSES:
                    self.cancel_requested = True
                    self.pause_requested = False
                    self.status = "cancelling"
                    self.emit({"type": "task_control", "status": "cancelling", "stage": "cancel", "message": "已请求取消，当前阻塞调用结束后会终止。"})
                    self._cond.notify_all()
            since = 0
            if isinstance(payload, dict):
                since = payload.get("since") or 0
            return self.snapshot(since)

    def snapshot(self, since=0):
        try:
            idx = max(0, int(since or 0))
        except Exception:
            idx = 0
        with self._cond:
            return {
                "ok": True,
                "task_id": self.id,
                "status": self.status,
                "created_at": self.created_at,
                "started_at": self.started_at,
                "updated_at": self.updated_at,
                "finished_at": self.finished_at,
                "progress_index": len(self.progress),
                "events": self.progress[idx:],
                "result": self.result,
                "error": self.error,
                "pause_requested": self.pause_requested,
                "cancel_requested": self.cancel_requested,
                "guidance_count": len(self.guidance),
                "guidance_version": self._guidance_version,
                "guidance": self._public_guidance(),
            }

    def _run(self):
        with self._cond:
            self.status = "running"
            self.started_at = time.time()
            self.updated_at = self.started_at
        try:
            self.emit({"type": "task", "status": "running", "stage": "start", "message": "PPT 图片页流程已启动。"})
            result = generate_html_image_ppt(
                self.data,
                progress=self.emit,
                checkpoint=self.checkpoint,
            )
            with self._cond:
                self.result = result
                self.status = "done" if result and result.get("ok") else "error"
                self.error = "" if self.status == "done" else (result or {}).get("error", "PPT 生成失败")
                self.finished_at = time.time()
                self.updated_at = self.finished_at
                self._cond.notify_all()
            self.emit({"type": "task", "status": self.status, "stage": "finish", "message": "PPT 任务已完成。" if self.status == "done" else self.error})
        except PptTaskCancelled as exc:
            with self._cond:
                self.status = "cancelled"
                self.error = str(exc)
                self.result = {"ok": False, "error": str(exc), "cancelled": True}
                self.finished_at = time.time()
                self.updated_at = self.finished_at
                self._cond.notify_all()
            self.emit({"type": "task", "status": "cancelled", "stage": "cancel", "message": str(exc)})
        except Exception as exc:
            with self._cond:
                self.status = "error"
                self.error = str(exc)
                self.result = {"ok": False, "error": str(exc), "traceback": traceback.format_exc()}
                self.finished_at = time.time()
                self.updated_at = self.finished_at
                self._cond.notify_all()
            self.emit({"type": "task", "status": "error", "stage": "error", "message": str(exc)})


def _cleanup_old_tasks():
    now = time.time()
    with _TASKS_LOCK:
        for task_id, task in list(_TASKS.items()):
            if task.status in _FINAL_STATUSES and now - (task.finished_at or task.updated_at or task.created_at) > _MAX_TASK_AGE_SECONDS:
                _TASKS.pop(task_id, None)


def start_ppt_task(data):
    _cleanup_old_tasks()
    task = PptTask(data)
    with _TASKS_LOCK:
        _TASKS[task.id] = task
    task.start()
    return task.snapshot()


def get_ppt_task(task_id, since=0):
    with _TASKS_LOCK:
        task = _TASKS.get(str(task_id or ""))
    if not task:
        return {"ok": False, "error": "PPT 任务不存在或已过期", "task_id": task_id}
    return task.snapshot(since)


def control_ppt_task(task_id, command, payload=None):
    with _TASKS_LOCK:
        task = _TASKS.get(str(task_id or ""))
    if not task:
        return {"ok": False, "error": "PPT 任务不存在或已过期", "task_id": task_id}
    return task.control(command, payload)
