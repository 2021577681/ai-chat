# ============================================================
# server/music.py - local music library endpoints
# ============================================================

import base64
import mimetypes
import os
import re
from urllib.parse import parse_qs, quote, urlparse

from . import config


MUSIC_EXTS = {
    '.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.webm', '.opus'
}


def _music_root():
    return os.path.join(config.WORKSPACE_ROOT, 'music')


def _music_rel(path):
    rel = str(path or '').replace('\\', '/').strip().lstrip('/')
    rel = re.sub(r'/+', '/', rel)
    return rel


def _safe_music_name(name):
    base = os.path.basename(str(name or '').strip()) or 'track'
    base = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', '_', base).strip(' .')
    return base or 'track'


def _music_path(rel):
    root = os.path.realpath(_music_root())
    target = os.path.realpath(os.path.join(root, _music_rel(rel)))
    try:
        inside = os.path.commonpath([target, root]) == root
    except ValueError:
        inside = False
    if not inside:
        return None
    return target


def _is_audio(path):
    return os.path.splitext(path)[1].lower() in MUSIC_EXTS


def _unique_path(parent, filename):
    name, ext = os.path.splitext(filename)
    candidate = os.path.join(parent, filename)
    i = 2
    while os.path.exists(candidate):
        candidate = os.path.join(parent, f'{name} ({i}){ext}')
        i += 1
    return candidate


def _track_payload(path):
    rel = os.path.relpath(path, _music_root()).replace(os.sep, '/')
    stat = os.stat(path)
    mime, _ = mimetypes.guess_type(path)
    return {
        'name': os.path.basename(path),
        'path': rel,
        'size': stat.st_size,
        'mtime': int(stat.st_mtime * 1000),
        'mime': mime or 'audio/mpeg',
        'url': '/music-file?path=' + quote(rel)
    }


class MusicMixin:
    def _send_music_cors(self):
        origin = self.headers.get('Origin', '')
        self.send_header('Access-Control-Allow-Origin', origin or '*')
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')

    def handle_music_file_get(self):
        qs = parse_qs(urlparse(self.path).query)
        token = (qs.get('token') or [''])[0] or self.headers.get('X-Token', '')
        if token != config.TOKEN:
            self._send_json(403, {'ok': False, 'error': 'Token 错误'})
            return
        rel = (qs.get('path') or [''])[0]
        path = _music_path(rel)
        if not path or not os.path.isfile(path) or not _is_audio(path):
            self._send_json(404, {'ok': False, 'error': '音乐文件不存在'})
            return

        size = os.path.getsize(path)
        if size <= 0:
            self.send_response(416)
            self._send_music_cors()
            self.send_header('Content-Range', 'bytes */0')
            self.end_headers()
            return
        ctype, _ = mimetypes.guess_type(path)
        ctype = ctype or 'audio/mpeg'
        range_header = self.headers.get('Range', '')
        start, end = 0, size - 1
        status = 200

        if range_header.startswith('bytes='):
            try:
                spec = range_header.split('=', 1)[1].split(',', 1)[0].strip()
                left, _, right = spec.partition('-')
                if left:
                    start = max(0, int(left))
                elif right:
                    suffix = max(0, int(right))
                    start = max(0, size - suffix)
                if right and left:
                    end = min(size - 1, int(right))
                if start >= size or start > end:
                    raise ValueError()
                status = 206
            except Exception:
                self.send_response(416)
                self._send_music_cors()
                self.send_header('Content-Range', f'bytes */{size}')
                self.end_headers()
                return

        length = end - start + 1
        self.send_response(status)
        self._send_music_cors()
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(length))
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()

        try:
            with open(path, 'rb') as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(1024 * 512, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except Exception:
            pass

    def handle_music_action(self, body):
        op = body.get('op') or 'list'
        if op == 'list':
            return self._music_list()
        if op == 'import':
            return self._music_import(body)
        self._send_json(400, {'ok': False, 'error': f'未知音乐操作: {op}'})

    def _music_list(self):
        root = _music_root()
        os.makedirs(root, exist_ok=True)
        tracks = []
        for parent, _, files in os.walk(root):
            for name in files:
                path = os.path.join(parent, name)
                if _is_audio(path):
                    try:
                        tracks.append(_track_payload(path))
                    except Exception:
                        pass
        tracks.sort(key=lambda item: item.get('name', '').lower())
        self._send_json(200, {
            'ok': True,
            'musicDir': root,
            'tracks': tracks,
            'exts': sorted(MUSIC_EXTS)
        })

    def _music_import(self, body):
        root = _music_root()
        os.makedirs(root, exist_ok=True)
        filename = _safe_music_name(body.get('name') or 'track')
        if not _is_audio(filename):
            self._send_json(200, {'ok': False, 'error': '只支持常见音频格式'})
            return

        target = _unique_path(root, filename)
        data = body.get('data') or ''
        try:
            if data:
                if ',' in data and data.split(',', 1)[0].startswith('data:'):
                    data = data.split(',', 1)[1]
                with open(target, 'wb') as f:
                    f.write(base64.b64decode(data))
            else:
                self._send_json(200, {'ok': False, 'error': '缺少导入数据'})
                return
            self._send_json(200, {'ok': True, 'track': _track_payload(target), 'musicDir': root})
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': str(e)})
