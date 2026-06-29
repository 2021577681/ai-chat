"""Runtime task manager for PPT image pipeline progress/pause/resume/cancel."""

import threading
import time
import traceback
import uuid

from .ppt_image_pipeline import generate_html_image_ppt


_TASKS = {}
_TASKS_LOCK = threading.RLock()
_MAX_TASK_AGE_SECONDS = 6 * 60 * 60


class PptTaskCancelled(RuntimeError):
    pass


class PptTask:
    def __init__(self, data):
        self.id = "ppt_" + time.strftime("%Y%m%d_%H%M%S_") + uuid.uuid4().hex[:8]
        self.data = dict(data or {})
        self.status = "queued"
        self.created_at = time.time()
        self.updated_at = self.created_at
        self.started_at = None
        self.finished_at = None
        self.progress = []
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

    def checkpoint(self, label=""):
        with self._cond:
            if self.cancel_requested:
                raise PptTaskCancelled("PPT 任务已取消")
            while self.pause_requested and not self.cancel_requested:
                self.status = "paused"
                self.updated_at = time.time()
                self._cond.notify_all()
                self._cond.wait(timeout=1.0)
            if self.cancel_requested:
                raise PptTaskCancelled("PPT 任务已取消")
            if self.status == "paused":
                self.status = "running"
                self.updated_at = time.time()
                self._cond.notify_all()

    def control(self, command):
        cmd = str(command or "").lower().strip()
        with self._cond:
            if cmd in ("pause", "stop"):
                if self.status not in ("done", "error", "cancelled"):
                    self.pause_requested = True
                    self.status = "paused"
                    self.emit({"type": "task_control", "status": "paused", "message": "已请求暂停，当前小步结束后会停住。"})
            elif cmd == "resume":
                if self.status not in ("done", "error", "cancelled"):
                    self.pause_requested = False
                    self.status = "running"
                    self.emit({"type": "task_control", "status": "running", "message": "已恢复执行。"})
                    self._cond.notify_all()
            elif cmd in ("cancel", "abort"):
                if self.status not in ("done", "error", "cancelled"):
                    self.cancel_requested = True
                    self.pause_requested = False
                    self.status = "cancelling"
                    self.emit({"type": "task_control", "status": "cancelling", "message": "已请求取消，当前阻塞调用结束后会终止。"})
                    self._cond.notify_all()
            return self.snapshot()

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
            if task.status in ("done", "error", "cancelled") and now - (task.finished_at or task.updated_at or task.created_at) > _MAX_TASK_AGE_SECONDS:
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


def control_ppt_task(task_id, command):
    with _TASKS_LOCK:
        task = _TASKS.get(str(task_id or ""))
    if not task:
        return {"ok": False, "error": "PPT 任务不存在或已过期", "task_id": task_id}
    return task.control(command)
