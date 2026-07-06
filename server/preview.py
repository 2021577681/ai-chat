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
import zipfile
from urllib.parse import quote

from .sandbox import check_path_or_error


class _ResponseZipWriter:
    def __init__(self, response):
        self.response = response

    def write(self, data):
        self.response.write(data)
        return len(data)

    def flush(self):
        if hasattr(self.response, 'flush'):
            self.response.flush()


class PreviewMixin:
    def _send_preview_cors(self):
        self.response.cors_headers(
            origin=self.request_context.origin,
            expose_headers='Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition',
        )

    def _send_preview_error(self, code, message):
        self.response.text(
            code,
            message,
            headers={'Cache-Control': 'no-cache, no-store, must-revalidate'},
            expose_headers='Content-Length, Content-Range, Accept-Ranges, Content-Type',
        )

    def _safe_zip_arcname(self, root, path):
        rel = os.path.relpath(path, root).replace(os.sep, '/')
        parts = [part for part in rel.split('/') if part and part not in ('.', '..')]
        return '/'.join(parts)

    def _send_directory_zip(self, path, rel):
        filename = os.path.basename(os.path.normpath(path)) or 'folder'
        quoted_name = quote(f'{filename}.zip')

        self.response.status(200)
        self._send_preview_cors()
        self.response.header('Content-Type', 'application/zip')
        self.response.header('Content-Disposition', f"attachment; filename*=UTF-8''{quoted_name}")
        self.response.header('Cache-Control', 'no-cache')
        self.response.header('X-Content-Type-Options', 'nosniff')
        self.response.end()

        print(f'[download folder] {path}')
        try:
            with zipfile.ZipFile(_ResponseZipWriter(self.response), 'w', compression=zipfile.ZIP_DEFLATED) as zf:
                wrote = False
                for current_root, dirs, files in os.walk(path):
                    dirs[:] = [name for name in dirs if not os.path.islink(os.path.join(current_root, name))]
                    safe_dir = self._safe_zip_arcname(path, current_root)
                    if safe_dir:
                        zf.writestr(f'{safe_dir}/', b'')
                    for name in files:
                        file_path = os.path.join(current_root, name)
                        if os.path.islink(file_path):
                            continue
                        arcname = self._safe_zip_arcname(path, file_path)
                        if not arcname:
                            continue
                        zf.write(file_path, arcname)
                        wrote = True
                if not wrote:
                    zf.writestr('.empty', b'')
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print(f'[download folder failed] {rel}: {e}')

    def handle_preview_file_get(self):
        qs = self.request_context.query

        rel = (qs.get('path') or [''])[0]
        download_mode = (qs.get('download') or ['0'])[0] == '1'
        archive_mode = (qs.get('archive') or [''])[0].lower()
        path, err = check_path_or_error(rel, must_exist=True)
        if err:
            self._send_preview_error(403, err)
            return
        if os.path.isdir(path):
            if download_mode and archive_mode == 'zip':
                self._send_directory_zip(path, rel)
                return
            self._send_preview_error(404, f'not a file: {rel}')
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
            filename = os.path.basename(path)
            quoted_name = quote(filename)
            self.response.status(200)
            self._send_preview_cors()
            self.response.header('Content-Type', 'application/octet-stream')
            self.response.header('Accept-Ranges', 'bytes')
            self.response.header('Content-Length', '0')
            disposition = 'attachment' if download_mode else 'inline'
            self.response.header('Content-Disposition', f"{disposition}; filename*=UTF-8''{quoted_name}")
            self.response.header('Cache-Control', 'no-cache')
            self.response.end()
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
        range_header = self.request_context.header('Range', '')
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
                self.response.status(416)
                self._send_preview_cors()
                self.response.header('Content-Range', f'bytes */{size}')
                self.response.header('Content-Length', '0')
                self.response.end()
                return

        length = end - start + 1
        filename = os.path.basename(path)
        quoted_name = quote(filename)

        print(f'👁️ [预览文件] {path}')
        print(f'   📦 Range: {start}-{end}/{size} | MIME: {ctype}')

        self.response.status(status)
        self._send_preview_cors()
        self.response.header('Content-Type', ctype)
        self.response.header('Accept-Ranges', 'bytes')
        self.response.header('Content-Length', str(length))
        if status == 206:
            self.response.header('Content-Range', f'bytes {start}-{end}/{size}')
        disposition = 'attachment' if download_mode else 'inline'
        self.response.header('Content-Disposition', f"{disposition}; filename*=UTF-8''{quoted_name}")
        self.response.header('Cache-Control', 'no-cache')
        self.response.header('X-Content-Type-Options', 'nosniff')
        self.response.end()

        try:
            with open(path, 'rb') as f:
                f.seek(start)
                remaining = length
                chunk_size = 1024 * 1024
                while remaining > 0:
                    chunk = f.read(min(chunk_size, remaining))
                    if not chunk:
                        break
                    self.response.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print(f'   ❌ 预览输出失败: {e}')
