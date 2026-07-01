import json
import os
import queue
import subprocess
import sys
import threading
import time
import uuid

from . import config


class _WechatBridgeManager:
    def __init__(self):
        self._lock = threading.RLock()
        self._proc = None
        self._pending = {}
        self._reader = None
        self._log_handle = None
        self._started_at = 0.0
        self._initialized = False

    def _script_path(self):
        return os.path.join(config.AGENT_HOME, 'lms_tool', 'wechat_filehelper_bridge.py')

    def _is_running_locked(self):
        return bool(self._proc and self._proc.poll() is None)

    def _status_locked(self):
        return {
            'ok': True,
            'action': 'status',
            'running': self._is_running_locked(),
            'pid': getattr(self._proc, 'pid', None) if self._proc else None,
            'started_at': self._started_at or None,
        }

    def _fail_pending_locked(self, message):
        pending = list(self._pending.values())
        self._pending.clear()
        for q in pending:
            try:
                q.put_nowait({'ok': False, 'error': message})
            except Exception:
                pass

    def _reader_loop(self, proc):
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except Exception:
                    continue
                req_id = str(payload.get('id') or '')
                with self._lock:
                    q = self._pending.pop(req_id, None)
                if q is not None:
                    try:
                        q.put_nowait(payload)
                    except Exception:
                        pass
        finally:
            with self._lock:
                if self._proc is proc:
                    self._fail_pending_locked('WeChat bridge process stopped')

    def _start_process_locked(self):
        if self._is_running_locked():
            return

        script = self._script_path()
        if not os.path.isfile(script):
            raise FileNotFoundError(f'WeChat bridge script not found: {script}')

        os.makedirs(os.path.join(config.WORKSPACE_ROOT, '.agent'), exist_ok=True)
        log_path = os.path.join(config.WORKSPACE_ROOT, '.agent', 'wechat_bridge.log')
        self._close_log_locked()
        self._log_handle = open(log_path, 'a', encoding='utf-8', errors='replace')

        env = os.environ.copy()
        env['PYTHONIOENCODING'] = 'utf-8'
        creationflags = 0
        if os.name == 'nt' and hasattr(subprocess, 'CREATE_NO_WINDOW'):
            creationflags = subprocess.CREATE_NO_WINDOW

        self._proc = subprocess.Popen(
            [sys.executable, '-u', script],
            cwd=config.WORKSPACE_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._log_handle,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1,
            env=env,
            creationflags=creationflags,
        )
        self._started_at = time.time()
        self._reader = threading.Thread(
            target=self._reader_loop,
            args=(self._proc,),
            name='wechat-filehelper-bridge-reader',
            daemon=True,
        )
        self._reader.start()
        self._initialized = False

    def _close_log_locked(self):
        if self._log_handle:
            try:
                self._log_handle.close()
            except Exception:
                pass
        self._log_handle = None

    def _stop_process_locked(self, force=False):
        proc = self._proc
        self._proc = None
        self._started_at = 0.0
        self._initialized = False
        self._fail_pending_locked('WeChat bridge process stopped')
        if not proc:
            self._close_log_locked()
            return
        try:
            if proc.poll() is None:
                if force:
                    proc.kill()
                else:
                    proc.terminate()
        except Exception:
            pass
        try:
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        self._close_log_locked()

    def request(self, op, params=None, timeout=90, start_if_needed=True):
        params = dict(params or {})
        req_id = uuid.uuid4().hex
        response_q = queue.Queue(maxsize=1)
        payload = {'id': req_id, 'op': op, **params}

        with self._lock:
            if start_if_needed:
                self._start_process_locked()
            elif not self._is_running_locked():
                return {'ok': True, 'action': op, 'running': False}
            assert self._proc is not None
            if self._proc.stdin is None:
                raise RuntimeError('WeChat bridge stdin is unavailable')
            self._pending[req_id] = response_q
            try:
                self._proc.stdin.write(json.dumps(payload, ensure_ascii=False) + '\n')
                self._proc.stdin.flush()
            except Exception:
                self._pending.pop(req_id, None)
                self._stop_process_locked(force=True)
                raise

        try:
            return response_q.get(timeout=max(1, float(timeout or 90)))
        except queue.Empty:
            with self._lock:
                self._pending.pop(req_id, None)
                self._stop_process_locked(force=True)
            raise TimeoutError(f'WeChat bridge timed out while handling {op}')

    def start(self, timeout=120):
        with self._lock:
            if self._is_running_locked() and self._initialized:
                payload = self._status_locked()
                payload['action'] = 'start'
                payload['initialized'] = True
                return payload
        payload = self.request('start', timeout=timeout, start_if_needed=True)
        with self._lock:
            if isinstance(payload, dict) and payload.get('ok'):
                self._initialized = True
            payload.setdefault('pid', getattr(self._proc, 'pid', None) if self._proc else None)
            payload.setdefault('running', self._is_running_locked())
        return payload

    def stop(self):
        with self._lock:
            if not self._is_running_locked():
                self._close_log_locked()
                return {'ok': True, 'action': 'stop', 'running': False}
        try:
            self.request('shutdown', timeout=5, start_if_needed=False)
        except Exception:
            pass
        with self._lock:
            if self._is_running_locked():
                self._stop_process_locked(force=False)
            else:
                self._proc = None
                self._started_at = 0.0
                self._close_log_locked()
        return {'ok': True, 'action': 'stop', 'running': False}

    def status(self):
        with self._lock:
            return self._status_locked()


_BRIDGE = _WechatBridgeManager()


class WechatBridgeMixin:
    def handle_wechat_bridge(self, body):
        try:
            op = str(body.get('op') or '').strip().lower()
            if not op:
                return self._send_json(200, {'ok': False, 'error': 'missing op'})
            if op == 'start':
                timeout = float(body.get('timeout') or body.get('bridge_timeout') or 120)
                payload = _BRIDGE.start(timeout=timeout)
            elif op == 'stop':
                payload = _BRIDGE.stop()
            elif op == 'status':
                payload = _BRIDGE.status()
            elif op in ('read', 'poll', 'send'):
                if op == 'poll':
                    op_timeout = float(body.get('timeout') or 0)
                    bridge_timeout = max(30.0, min(360.0, op_timeout + 60.0))
                else:
                    bridge_timeout = float(body.get('bridge_timeout') or 90)
                payload = _BRIDGE.request(op, params=body, timeout=bridge_timeout, start_if_needed=True)
                with _BRIDGE._lock:
                    if isinstance(payload, dict) and payload.get('ok'):
                        _BRIDGE._initialized = True
                    payload.setdefault('pid', getattr(_BRIDGE._proc, 'pid', None) if _BRIDGE._proc else None)
            else:
                payload = {'ok': False, 'error': f'unknown wechat bridge op: {op}'}

            if isinstance(payload, dict) and 'text' not in payload:
                payload['text'] = json.dumps(payload, ensure_ascii=False, indent=2)
            return self._send_json(200, payload)
        except Exception as e:
            return self._send_json(200, {'ok': False, 'error': str(e)})
