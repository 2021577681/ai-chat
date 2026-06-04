# ============================================================
# server/handler.py - HTTP Handler 主类
# ============================================================
# 通过 mixin 组合所有功能：ExecMixin / FilesMixin / WebMixin / GitMixin / ProxyMixin。
# 自身负责：
#   - HTTP 基础（_send_json / _write_cors_headers）
#   - OPTIONS 预检
#   - GET 路由分发（/token / /workspace / /health / /lms-proxy / 静态文件）
#   - POST 路由分发（/llm-proxy / 鉴权 + action 分发）
# ============================================================

import json

from http.server import BaseHTTPRequestHandler

from . import config
from .exec import ExecMixin
from .files import FilesMixin
from .git_ops import GitMixin
from .proxy import ProxyMixin
from .screenshot import ScreenshotMixin
from .web import WebMixin


class Handler(BaseHTTPRequestHandler,
              ExecMixin, FilesMixin, WebMixin, GitMixin, ProxyMixin, ScreenshotMixin):
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
            data.setdefault('cwd', config.current_cwd)
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
        """供流式响应等场景手动写 CORS 头"""
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

        # ⭐ /token 路由
        if self.path == '/token':
            return self.handle_token_request()

        # ⭐ /workspace 路由（公开，无需 Token）
        if self.path == '/workspace':
            return self.handle_workspace_info()

        # /health 显式健康检查
        if self.path == '/health':
            self._send_json(200, {'ok': True,
                                  'cwd': config.current_cwd,
                                  'workspace': config.WORKSPACE_ROOT})
            return

        # 静态文件（http://localhost:8765/ 可直接打开 HTML）
        return self.handle_static_file()

    # ============ POST 路由 ============
    def do_POST(self):
        # ⭐ LLM 代理（POST）
        if self.path.startswith('/llm-proxy'):
            return self.handle_llm_proxy_post()

        # 鉴权（除 llm-proxy 外，POST 都要求 X-Token）
        token = self.headers.get('X-Token', '')
        if token != config.TOKEN:
            self._send_json(403, {'ok': False, 'error': 'Token 错误'})
            return

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
        print(f'\n{"="*60}')
        print(f'📥 收到请求: action="{action}"')
        if action != 'read_file_binary':
            print(f'📦 完整请求体: {json.dumps(body, ensure_ascii=False)[:500]}')
        else:
            print(f'📦 请求体: action=read_file_binary, path={body.get("path", "")}')
        print(f'{"="*60}')

        # 分发到各 mixin
        try:
            if action == 'execute':
                self.handle_execute(body)
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
            elif action == 'delete_file':
                self.handle_delete_file(body)
            elif action == 'list_dir':
                self.handle_list_dir(body)
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
            elif action == 'screenshot':
                self.handle_screenshot(body)
            elif action == 'list_windows':
                self.handle_list_windows(body)
            else:
                self._send_json(400, {'ok': False, 'error': f'❌ 未知操作: {action}'})
        except Exception as e:
            self._send_json(500, {'ok': False, 'error': f'内部错误: {e}'})
