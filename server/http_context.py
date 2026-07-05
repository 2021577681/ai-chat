import json
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

from . import config


@dataclass(frozen=True)
class RequestContext:
    method: str
    path: str
    headers: object
    body_reader: object = None
    session_id: str = ''
    cwd: str = ''
    workspace: str = ''

    @property
    def origin(self):
        return self.headers.get('Origin', '') if self.headers else ''

    @property
    def parsed_url(self):
        return urlparse(self.path)

    @property
    def query(self):
        return parse_qs(self.parsed_url.query)

    def header(self, name, default=''):
        return self.headers.get(name, default) if self.headers else default

    @property
    def content_length(self):
        try:
            return max(0, int(self.header('Content-Length', 0) or 0))
        except (TypeError, ValueError):
            return 0

    def read_body(self):
        if not self.body_reader:
            return b''
        length = self.content_length
        if length <= 0:
            return b''
        return self.body_reader.read(length)

    def read_text(self, encoding='utf-8'):
        return self.read_body().decode(encoding)

    def read_json(self, default=None):
        raw = self.read_text('utf-8')
        if not raw and default is not None:
            return default
        data = json.loads(raw or '{}')
        if not isinstance(data, dict):
            raise ValueError('request body must be a JSON object')
        return data


class ResponseWriter:
    def __init__(self, handler, context=None):
        self._handler = handler
        self._context = context

    def json(self, code, data):
        if isinstance(data, dict):
            data.setdefault('workspace', self._workspace())
            data.setdefault('cwd', self._cwd())
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self._handler.send_response(code)
        self._handler.send_header('Content-Type', 'application/json; charset=utf-8')
        self.cors_headers()
        self._handler.send_header('Content-Length', str(len(body)))
        self._handler.end_headers()
        self._handler.wfile.write(body)

    def status(self, code):
        self._handler.send_response(code)

    def header(self, name, value):
        self._handler.send_header(name, str(value))

    def end(self):
        self._handler.end_headers()

    def write(self, data):
        self._handler.wfile.write(data)

    def flush(self):
        self._handler.wfile.flush()

    def send_bytes(self, code, data, content_type='application/octet-stream',
                   headers=None, cors=False, origin=None, expose_headers=None):
        body = data if isinstance(data, bytes) else bytes(data or b'')
        header_items = dict(headers or {})
        self.status(code)
        self.header('Content-Type', content_type)
        if cors:
            self.cors_headers(origin=origin, expose_headers=expose_headers)
        if not any(str(k).lower() == 'content-length' for k in header_items):
            header_items['Content-Length'] = str(len(body))
        for name, value in header_items.items():
            self.header(name, value)
        self.end()
        if body:
            self.write(body)

    def text(self, code, message, content_type='text/plain; charset=utf-8',
             headers=None, cors=True, origin=None, expose_headers=None):
        body = str(message or '').encode('utf-8', errors='replace')
        self.send_bytes(
            code,
            body,
            content_type=content_type,
            headers=headers,
            cors=cors,
            origin=origin,
            expose_headers=expose_headers,
        )

    def cors_headers(self, origin=None, expose_headers=None):
        origin = origin if origin is not None else self._origin()
        self._handler.send_header('Access-Control-Allow-Origin', origin or '*')
        self._handler.send_header('Vary', 'Origin')
        self._handler.send_header('Access-Control-Allow-Headers', '*')
        self._handler.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        if expose_headers:
            self._handler.send_header('Access-Control-Expose-Headers', expose_headers)

    def _origin(self):
        if self._context:
            return self._context.origin
        return self._handler.headers.get('Origin', '')

    def _workspace(self):
        return (self._context.workspace if self._context else '') or config.WORKSPACE_ROOT

    def _cwd(self):
        return (self._context.cwd if self._context else '') or config.get_current_cwd()
