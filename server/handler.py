import copy
import json
import time
from http.server import BaseHTTPRequestHandler

from . import config
from .exec import ExecMixin
from .files import FilesMixin
from .git_ops import GitMixin
from .http_context import RequestContext, ResponseWriter
from .mcp_skills import McpSkillsMixin
from .music import MusicMixin
from .preview import PreviewMixin
from .remote import RemoteMixin
from .ppt_core import PptMixin
from .proxy import ProxyMixin
from .routes import (
    ACTION_ROUTE_BY_NAME,
    GET_EXACT_ROUTES,
    GET_PREFIX_ROUTES,
    POST_PREFIX_ROUTES,
)
from .screenshot import ScreenshotMixin
from .web import WebMixin
from .wechat_bridge import WechatBridgeMixin
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


def _compact_large_write_payload(action, body):
    if action != 'write_file' or not isinstance(body, dict):
        return body
    encoding = str(body.get('encoding') or body.get('content_encoding') or '').lower()
    if encoding != 'base64' or not isinstance(body.get('content'), str):
        return body
    body = dict(body)
    body['content'] = f'<base64 {len(body["content"])} chars>'
    return body


class Handler(BaseHTTPRequestHandler,
              ExecMixin, FilesMixin, WebMixin, GitMixin, ProxyMixin, ScreenshotMixin,
              McpSkillsMixin, MusicMixin, PreviewMixin, RemoteMixin, WorkspaceMixin,
              WechatBridgeMixin, PptMixin):
    """HTTP entry point.

    Concrete features live in mixins. This class owns only HTTP concerns:
    response formatting, CORS, request parsing, request-scoped cwd binding,
    and data-driven dispatch through server.routes.
    """

    def log_message(self, format, *args):
        print(f'[{self.log_date_time_string()}] {format % args}')

    def _bind_http_context(self, session_id=''):
        self.request_context = RequestContext(
            method=getattr(self, 'command', ''),
            path=self.path,
            headers=self.headers,
            body_reader=self.rfile,
            session_id=session_id,
            cwd=config.get_current_cwd(),
            workspace=config.WORKSPACE_ROOT,
        )
        self.response = ResponseWriter(self, self.request_context)
        return self.request_context

    def do_OPTIONS(self):
        self._bind_http_context()
        self.response.status(204)
        self.response.cors_headers()
        self.response.header('Access-Control-Max-Age', '600')
        self.response.end()

    def _invoke_route_handler(self, handler_name, *args):
        handler = getattr(self, handler_name)
        return handler(*args)

    def _dispatch_exact_route(self, routes):
        path = self.request_context.path
        for route in routes:
            if path == route.path:
                self._invoke_route_handler(route.handler)
                return True
        return False

    def _dispatch_prefix_route(self, routes):
        path = self.request_context.path
        for route in routes:
            if path.startswith(route.path):
                self._invoke_route_handler(route.handler)
                return True
        return False

    def _dispatch_action(self, action, body):
        route = ACTION_ROUTE_BY_NAME.get(action)
        if not route:
            self.response.json(400, {'ok': False, 'error': f'未知操作: {action}'})
            return
        if route.pass_body:
            self._invoke_route_handler(route.handler, body)
        else:
            self._invoke_route_handler(route.handler)

    def _read_json_body(self):
        return self.request_context.read_json()

    def _log_action_request(self, action, body):
        print(f'\n{"=" * 60}')
        print(f'收到请求: action="{action}", session="{self.request_context.session_id}"')
        if action != 'read_file_binary':
            log_body = _compact_large_write_payload(action, _redact_log_secrets(copy.deepcopy(body)))
            if action in ('mcp_list_tools', 'mcp_call_tool'):
                if isinstance(log_body.get('server'), dict) and log_body['server'].get('env'):
                    log_body['server']['env'] = '***'
            print(f'请求体: {json.dumps(log_body, ensure_ascii=False)[:500]}')
        else:
            print(f'请求体: action=read_file_binary, path={body.get("path", "")}')
        print(f'{"=" * 60}')

    def handle_health_get(self):
        self.response.json(200, {
            'ok': True,
            'cwd': config.get_current_cwd(),
            'workspace': config.WORKSPACE_ROOT,
        })

    def handle_remote_heartbeat_get(self):
        config.REMOTE_HEARTBEAT_LAST = time.time()
        self.response.json(200, {
            'ok': True,
            'heartbeat_enabled': bool(config.REMOTE_HEARTBEAT_TIMEOUT),
            'timeout': config.REMOTE_HEARTBEAT_TIMEOUT,
            'last': config.REMOTE_HEARTBEAT_LAST,
        })

    def do_GET(self):
        self._bind_http_context()
        if self._dispatch_exact_route(GET_EXACT_ROUTES):
            return
        if self._dispatch_prefix_route(GET_PREFIX_ROUTES):
            return
        return self.handle_static_file()

    def do_POST(self):
        self._bind_http_context()
        if self._dispatch_prefix_route(POST_PREFIX_ROUTES):
            return

        try:
            body = self._read_json_body()
        except Exception as e:
            self.response.json(400, {'ok': False, 'error': f'请求格式错误: {e}'})
            return

        action = body.get('action', 'execute')
        session_id = body.get('session_id') or self.headers.get('X-Session-Id', '')
        session_id = config.normalize_session_id(session_id)
        cwd_token = config.bind_request_cwd(config.get_session_cwd(session_id))
        self._bind_http_context(session_id)
        self._log_action_request(action, body)

        try:
            self._dispatch_action(action, body)
        except Exception as e:
            self.response.json(500, {'ok': False, 'error': f'内部错误: {e}'})
        finally:
            config.reset_request_cwd(cwd_token)
