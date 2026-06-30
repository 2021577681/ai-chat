# ============================================================
# server/handler.py - HTTP Handler 主类
# ============================================================
# 通过 mixin 组合所有功能：ExecMixin / FilesMixin / WebMixin / GitMixin / ProxyMixin。
# 自身负责：
#   - HTTP 基础（_send_json / _write_cors_headers）
#   - OPTIONS 预检
#   - GET 路由分发（/workspace / /health / /lms-proxy / 静态文件）
#   - POST 路由分发（/llm-proxy / 鉴权 + action 分发）
# ============================================================

import copy
import json
import time

from http.server import BaseHTTPRequestHandler

from . import config
from .exec import ExecMixin
from .files import FilesMixin
from .git_ops import GitMixin
from .mcp_skills import McpSkillsMixin
from .music import MusicMixin
from .preview import PreviewMixin
from .remote import RemoteMixin
from .ppt_core import PptMixin
from .proxy import ProxyMixin
from .screenshot import ScreenshotMixin
from .web import WebMixin
from .workspace import WorkspaceMixin


_LOG_SECRET_KEY_PARTS = (
    'api_key',
    'apikey',
    'authorization',
    'bearer',
    'cookie',
    'password',
    'secret',
    'token',
)


def _redact_log_secrets(value):
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            key_text = str(key).lower()
            if any(part in key_text for part in _LOG_SECRET_KEY_PARTS):
                out[key] = '***'
            else:
                out[key] = _redact_log_secrets(item)
        return out
    if isinstance(value, list):
        return [_redact_log_secrets(item) for item in value]
    return value


class Handler(BaseHTTPRequestHandler,
              ExecMixin, FilesMixin, WebMixin, GitMixin, ProxyMixin, ScreenshotMixin,
              McpSkillsMixin, MusicMixin, PreviewMixin, RemoteMixin, WorkspaceMixin, PptMixin):
    """主 HTTP Handler，通过 mixin 组合所有功能。
    各 mixin 都依赖本类提供的 _send_json / _write_cors_headers / self.headers / self.rfile / self.wfile。
    """

    # ============ 日志 ============
    def log_message(self, format, *args):
        print(f'[{self.log_date_time_string()}] {format % args}')

    # ============ HTTP 基础工具 ============
    def _send_json(self, code, data):
        """统一在响应里附加沙箱信息，前端可实时显示"""
        if isinstance(data, dict):
            data.setdefault('workspace', config.WORKSPACE_ROOT)
            data.setdefault('cwd', config.get_current_cwd())
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        # 🌐 CORS 全开：回显请求方 Origin（含 'null'，对应 file:// 双击打开）
        origin = self.headers.get('Origin', '')
        self.send_header('Access-Control-Allow-Origin', origin or '*')
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _write_cors_headers(self, origin):
        """流式响应等场景手动写 CORS 头"""
        self.send_header('Access-Control-Allow-Origin', origin or '*')
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Expose-Headers', '*')

    # ============ OPTIONS ============
    def do_OPTIONS(self):
        # 🌐 预检全部放行
        origin = self.headers.get('Origin', '')
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', origin or '*')
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Max-Age', '600')
        self.end_headers()

    # ============ GET 路由 ============
    def do_GET(self):
        # ⭐ LMS 代理（GET）
        if self.path.startswith('/lms-proxy'):
            return self.handle_lms_proxy_get()

        # /workspace 路由（公开，无需 Token）
        if self.path == '/workspace':
            return self.handle_workspace_info()

        # /health 显式健康检查
        if self.path == '/health':
            self._send_json(200, {'ok': True,
                                  'cwd': config.get_current_cwd(),
                                  'workspace': config.WORKSPACE_ROOT})
            return

        if self.path.startswith('/music-file'):
            return self.handle_music_file_get()

        if self.path.startswith('/preview-file'):
            return self.handle_preview_file_get()

        if self.path.startswith('/remote-heartbeat'):
            config.REMOTE_HEARTBEAT_LAST = time.time()
            self._send_json(200, {
                'ok': True,
                'heartbeat_enabled': bool(config.REMOTE_HEARTBEAT_TIMEOUT),
                'timeout': config.REMOTE_HEARTBEAT_TIMEOUT,
                'last': config.REMOTE_HEARTBEAT_LAST,
            })
            return

        # 静态文件（http://localhost:8765/ 可直接打开 HTML）
        return self.handle_static_file()

    # ============ POST 路由 ============
    def do_POST(self):
        # ⭐ LLM 代理（POST）
        if self.path.startswith('/llm-proxy'):
            return self.handle_llm_proxy_post()

        # ⭐ LMS 账号密码登录（POST）
        if self.path.startswith('/lms-login'):
            return self.handle_lms_login_post()

        # ⭐ LMS 成绩查询（POST）
        if self.path.startswith('/lms-scores'):
            return self.handle_lms_scores_post()

        # ⭐ LMS 课表查询（POST）
        if self.path.startswith('/lms-schedule'):
            return self.handle_lms_schedule_post()

        # ⭐ LMS 空闲教室查询（POST）
        if self.path.startswith('/lms-empty-rooms'):
            return self.handle_lms_empty_rooms_post()

        # ⭐ LMS 考勤查询（POST）
        if self.path.startswith('/lms-attendance'):
            return self.handle_lms_attendance_post()

        # ⭐ LMS 一键评教（POST）
        if self.path.startswith('/lms-judge'):
            return self.handle_lms_judge_post()

        # ⭐ LMS 个人培养方案（POST）
        if self.path.startswith('/lms-training-plan'):
            return self.handle_lms_training_plan_post()

        # 读请求体
        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length).decode('utf-8')
            body = json.loads(raw)
        except Exception as e:
            self._send_json(400, {'ok': False, 'error': f'请求格式错误: {e}'})
            return

        # 调试日志
        action = body.get('action', 'execute')
        session_id = body.get('session_id') or self.headers.get('X-Session-Id', '')
        self.session_id = config.normalize_session_id(session_id)
        _cwd_token = config.bind_request_cwd(config.get_session_cwd(self.session_id))
        print(f'\n{"="*60}')
        print(f'📥 收到请求: action="{action}", session="{self.session_id}"')
        if action != 'read_file_binary':
            log_body = _redact_log_secrets(copy.deepcopy(body))
            if action in ('mcp_list_tools', 'mcp_call_tool'):
                if isinstance(log_body.get('server'), dict) and log_body['server'].get('env'):
                    log_body['server']['env'] = '***'
            print(f'📦 完整请求体: {json.dumps(log_body, ensure_ascii=False)[:500]}')
        else:
            print(f'📦 请求体: action=read_file_binary, path={body.get("path", "")}')
        print(f'{"="*60}')

        # 分发到各 mixin
        try:
            if action == 'execute':
                self.handle_execute(body)
            elif action == 'open_terminal':
                self.handle_open_terminal(body)
            elif action == 'read_file':
                self.handle_read_file(body)
            elif action == 'read_file_binary':
                self.handle_read_file_binary(body)
            elif action == 'write_file':
                self.handle_write_file(body)
            elif action == 'append_file':
                self.handle_append_file(body)
            elif action == 'edit_file':
                self.handle_edit_file(body)
            elif action == 'apply_patch':
                self.handle_apply_patch(body)
            elif action == 'list_checkpoints':
                self.handle_list_checkpoints(body)
            elif action == 'restore_checkpoint':
                self.handle_restore_checkpoint(body)
            elif action == 'delete_file':
                self.handle_delete_file(body)
            elif action == 'rename_file':
                self.handle_rename_file(body)
            elif action == 'list_dir':
                self.handle_list_dir(body)
            elif action == 'create_file':
                self.handle_create_file(body)
            elif action == 'create_dir':
                self.handle_create_dir(body)
            elif action == 'search':
                self.handle_search(body)
            elif action == 'web_search':
                self.handle_web_search(body)
            elif action == 'fetch_url':
                self.handle_fetch_url(body)
            elif action == 'file_info':
                self.handle_file_info(body)
            elif action == 'git':
                self.handle_git(body)
            elif action == 'generate_ppt':
                self.handle_generate_ppt(body)
            elif action == 'ppt_task':
                self.handle_ppt_task(body)
            elif action == 'screenshot':
                self.handle_screenshot(body)
            elif action == 'list_windows':
                self.handle_list_windows(body)
            elif action == 'mcp_list_tools':
                self.handle_mcp_list_tools(body)
            elif action == 'mcp_call_tool':
                self.handle_mcp_call_tool(body)
            elif action == 'skill_list':
                self.handle_skill_list(body)
            elif action == 'skill_read':
                self.handle_skill_read(body)
            elif action == 'music':
                self.handle_music_action(body)
            elif action == 'select_workspace':
                self.handle_select_workspace(body)
            elif action == 'set_workspace':
                self.handle_set_workspace(body)
            elif action == 'remote_connect':
                self.handle_remote_connect(body)
            elif action == 'remote_status':
                self.handle_remote_status(body)
            elif action == 'remote_list_dirs':
                self.handle_remote_list_dirs(body)
            elif action == 'remote_disconnect':
                self.handle_remote_disconnect(body)
            else:
                self._send_json(400, {'ok': False, 'error': f'❌ 未知操作: {action}'})
        except Exception as e:
            self._send_json(500, {'ok': False, 'error': f'内部错误: {e}'})
        finally:
            config.reset_request_cwd(_cwd_token)
            self.session_id = ''
