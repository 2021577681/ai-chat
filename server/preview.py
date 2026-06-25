# ============================================================
# server/preview.py - 安全文件预览接口
# ============================================================
# GET /preview-file?path=...
# - 沙箱路径校验
# - 分块输出，避免一次性读入内存
# - 支持 Range 请求，适合大视频/音频/PDF
# ============================================================

import mimetypes
import os
from urllib.parse import parse_qs, quote, urlparse

from .sandbox import check_path_or_error


class PreviewMixin:
    def _send_preview_cors(self):
        origin = self.headers.get('Origin', '')
        self.send_header('Access-Control-Allow-Origin', origin or '*')
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type')

    def _send_preview_error(self, code, message):
        body = str(message or '').encode('utf-8', errors='replace')
        self.send_response(code)
        self._send_preview_cors()
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def handle_preview_file_get(self):
        qs = parse_qs(urlparse(self.path).query)

        rel = (qs.get('path') or [''])[0]
        path, err = check_path_or_error(rel, must_exist=True)
        if err:
            self._send_preview_error(403, err)
            return
        if not os.path.isfile(path):
            self._send_preview_error(404, f'不是文件: {rel}')
            return

        try:
            size = os.path.getsize(path)
        except Exception as e:
            self._send_preview_error(500, f'读取文件信息失败: {e}')
            return

        if size <= 0:
            self.send_response(200)
            self._send_preview_cors()
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', '0')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            return

        ctype, _ = mimetypes.guess_type(path)
        if not ctype:
            ext = os.path.splitext(path)[1].lower()
            ctype = {
                '.pdf': 'application/pdf',
                '.svg': 'image/svg+xml',
                '.md': 'text/markdown',
                '.markdown': 'text/markdown',
                '.json': 'application/json',
                '.js': 'application/javascript',
                '.mjs': 'application/javascript',
                '.css': 'text/css',
                '.csv': 'text/csv',
                '.log': 'text/plain',
            }.get(ext, 'application/octet-stream')
        if ctype.startswith('text/') or ctype in ('application/json', 'application/javascript', 'application/xml', 'image/svg+xml'):
            if 'charset=' not in ctype.lower():
                ctype += '; charset=utf-8'

        start, end = 0, size - 1
        status = 200
        range_header = self.headers.get('Range', '')
        if range_header.startswith('bytes='):
            try:
                spec = range_header.split('=', 1)[1].split(',', 1)[0].strip()
                left, _, right = spec.partition('-')
                if left:
                    start = max(0, int(left))
                    if right:
                        end = min(size - 1, int(right))
                elif right:
                    suffix = max(0, int(right))
                    start = max(0, size - suffix)
                if start >= size or start > end:
                    raise ValueError()
                status = 206
            except Exception:
                self.send_response(416)
                self._send_preview_cors()
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return

        length = end - start + 1
        filename = os.path.basename(path)
        quoted_name = quote(filename)

        print(f'👁️ [预览文件] {path}')
        print(f'   📦 Range: {start}-{end}/{size} | MIME: {ctype}')

        self.send_response(status)
        self._send_preview_cors()
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(length))
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Disposition', f"inline; filename*=UTF-8''{quoted_name}")
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()

        try:
            with open(path, 'rb') as f:
                f.seek(start)
                remaining = length
                chunk_size = 1024 * 1024
                while remaining > 0:
                    chunk = f.read(min(chunk_size, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print(f'   ❌ 预览输出失败: {e}')
