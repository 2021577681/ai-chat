# ============================================================
# server/files.py - 文件操作 mixin
# ============================================================
# 提供 FilesMixin，给 Handler 用。包含：
#   handle_read_file / handle_read_file_binary
#   handle_write_file / handle_append_file / handle_edit_file
#   handle_delete_file
#   handle_list_dir
#   handle_search
#   handle_file_info
# ============================================================

import base64
import fnmatch
import mimetypes
import os
import re

from .sandbox import check_path_or_error


def _strip_patch_path(path):
    path = (path or '').strip()
    if not path or path == '/dev/null':
        return path
    if path.startswith('"') and path.endswith('"'):
        path = path[1:-1]
    if path.startswith('a/') or path.startswith('b/'):
        path = path[2:]
    return path


def _parse_hunk_header(line):
    m = re.match(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', line)
    if not m:
        raise ValueError(f'无效 hunk 头: {line}')
    return {
        'old_start': int(m.group(1)),
        'old_count': int(m.group(2) or '1'),
        'new_start': int(m.group(3)),
        'new_count': int(m.group(4) or '1'),
        'lines': []
    }


def _parse_unified_patch(patch_text):
    lines = patch_text.splitlines()
    files = []
    current = None
    hunk = None
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith('diff --git '):
            i += 1
            continue
        if line.startswith('--- '):
            old_path = _strip_patch_path(line[4:].split('\t', 1)[0].strip())
            if i + 1 >= len(lines) or not lines[i + 1].startswith('+++ '):
                raise ValueError(f'缺少 +++ 文件头: {line}')
            new_path = _strip_patch_path(lines[i + 1][4:].split('\t', 1)[0].strip())
            current = {
                'old_path': old_path,
                'new_path': new_path,
                'hunks': []
            }
            files.append(current)
            hunk = None
            i += 2
            continue
        if line.startswith('@@ '):
            if current is None:
                raise ValueError('hunk 出现在文件头之前')
            hunk = _parse_hunk_header(line)
            current['hunks'].append(hunk)
            i += 1
            continue
        if hunk is not None:
            if line.startswith((' ', '+', '-')):
                hunk['lines'].append(line)
            elif line.startswith('\\ No newline at end of file'):
                pass
            elif line.startswith(('index ', 'new file mode ', 'deleted file mode ', 'similarity index ')):
                pass
            else:
                raise ValueError(f'无法解析 patch 行: {line}')
        i += 1
    if not files:
        raise ValueError('未找到 unified diff 文件头（需要 --- / +++ / @@）')
    return files


def _find_hunk_position(content_lines, expected_old, expected_idx):
    if content_lines[expected_idx:expected_idx + len(expected_old)] == expected_old:
        return expected_idx
    matches = []
    max_start = len(content_lines) - len(expected_old)
    for start in range(max_start + 1):
        if content_lines[start:start + len(expected_old)] == expected_old:
            matches.append(start)
            if len(matches) > 1:
                break
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ValueError('hunk 上下文不匹配，文件可能已变化')
    raise ValueError('hunk 上下文在文件中匹配多处，请提供更多上下文')


def _apply_file_patch(abs_path, file_patch):
    if file_patch['old_path'] == '/dev/null':
        content_lines = []
        existed = False
    else:
        if not os.path.exists(abs_path):
            raise ValueError(f'文件不存在: {abs_path}')
        with open(abs_path, 'r', encoding='utf-8', errors='replace') as f:
            content_lines = f.read().splitlines(keepends=True)
        existed = True

    out = list(content_lines)
    offset = 0
    added = 0
    removed = 0
    for hunk in file_patch['hunks']:
        old_lines = [(ln[1:] + '\n') for ln in hunk['lines'] if ln.startswith((' ', '-'))]
        new_lines = [(ln[1:] + '\n') for ln in hunk['lines'] if ln.startswith((' ', '+'))]
        expected_idx = max(0, hunk['old_start'] - 1 + offset)
        pos = _find_hunk_position(out, old_lines, expected_idx)
        out[pos:pos + len(old_lines)] = new_lines
        offset += len(new_lines) - len(old_lines)
        added += sum(1 for ln in hunk['lines'] if ln.startswith('+'))
        removed += sum(1 for ln in hunk['lines'] if ln.startswith('-'))

    return ''.join(out), {'existed': existed, 'added': added, 'removed': removed, 'hunks': len(file_patch['hunks'])}


class FilesMixin:
    """Handler mixin：所有文件 CRUD 和搜索"""

    # ============ 读文件（文本） ============
    def handle_read_file(self, body):
        path, err = check_path_or_error(body.get('path', ''))
        if err: return self._send_json(200, {'ok': False, 'error': err})
        print(f'📖 [读文件] {path}')
        if not os.path.exists(path):
            return self._send_json(200, {'ok': False, 'error': f'文件不存在: {path}'})
        if not os.path.isfile(path):
            return self._send_json(200, {'ok': False, 'error': f'不是文件: {path}'})
        try:
            start_line = body.get('start_line')
            end_line = body.get('end_line')
            has_range = start_line is not None or end_line is not None
            if has_range:
                try:
                    start = max(1, int(start_line or 1))
                    end = int(end_line) if end_line is not None else None
                except (TypeError, ValueError):
                    return self._send_json(200, {'ok': False, 'error': 'start_line/end_line 必须是数字'})
                if end is not None and end < start:
                    return self._send_json(200, {'ok': False, 'error': 'end_line 不能小于 start_line'})
            else:
                start, end = 1, None

            size = os.path.getsize(path)
            max_read_chars = 1024 * 1024
            if size > max_read_chars and not has_range:
                return self._send_json(200, {
                    'ok': False,
                    'error': f'文件过大（{size}字节）。请指定 start_line/end_line 分段读取；如果是图片/PDF，请用 attach_file 工具。'
                })

            if has_range and size > max_read_chars:
                parts = []
                total = 0
                truncated = False
                with open(path, 'r', encoding='utf-8', errors='replace') as f:
                    for line_no, line in enumerate(f, 1):
                        if line_no < start:
                            continue
                        if end is not None and line_no > end:
                            break
                        remaining = max_read_chars - total
                        if remaining <= 0:
                            truncated = True
                            break
                        if len(line) > remaining:
                            parts.append(line[:remaining])
                            total += remaining
                            truncated = True
                            break
                        parts.append(line)
                        total += len(line)
                content = ''.join(parts)
                if truncated:
                    content += '\n\n[内容已截断：单次 read_note 最多返回约 1MB。请缩小 start_line/end_line 范围继续读取。]'
                return self._send_json(200, {
                    'ok': True,
                    'path': path,
                    'content': content,
                    'size': size,
                    'start_line': start,
                    'end_line': end,
                    'truncated': truncated
                })

            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
            if has_range:
                lines = content.split('\n')
                s = start - 1
                e = min(len(lines), end or len(lines))
                content = '\n'.join(lines[s:e])
            self._send_json(200, {'ok': True, 'path': path, 'content': content, 'size': size})
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': str(e)})

    # ============ 读文件（二进制 → base64） ============
    def handle_read_file_binary(self, body):
        """读取任意文件并返回 base64（用于图片/PDF 等二进制文件）"""
        path, err = check_path_or_error(body.get('path', ''))
        if err: return self._send_json(200, {'ok': False, 'error': err})
        if not os.path.exists(path):
            return self._send_json(200, {'ok': False, 'error': f'文件不存在: {path}'})
        if not os.path.isfile(path):
            return self._send_json(200, {'ok': False, 'error': f'不是文件: {path}'})

        try:
            size = os.path.getsize(path)
            max_size = 20 * 1024 * 1024
            if size > max_size:
                return self._send_json(200, {
                    'ok': False,
                    'error': f'文件过大（{size / 1024 / 1024:.1f}MB），上限 {max_size / 1024 / 1024:.0f}MB'
                })

            with open(path, 'rb') as f:
                content = f.read()
            b64 = base64.b64encode(content).decode('ascii')

            # 猜测 MIME 类型
            mime, _ = mimetypes.guess_type(path)
            if not mime:
                ext = os.path.splitext(path)[1].lower()
                mime_map = {
                    '.pdf': 'application/pdf',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp',
                    '.bmp': 'image/bmp',
                    '.svg': 'image/svg+xml',
                    '.tiff': 'image/tiff', '.tif': 'image/tiff',
                    '.ico': 'image/x-icon',
                    '.mp3': 'audio/mpeg',
                    '.wav': 'audio/wav',
                    '.ogg': 'audio/ogg',
                    '.m4a': 'audio/mp4',
                    '.mp4': 'video/mp4',
                    '.avi': 'video/x-msvideo',
                    '.mov': 'video/quicktime',
                    '.webm': 'video/webm',
                    '.zip': 'application/zip',
                    '.rar': 'application/x-rar-compressed',
                    '.7z': 'application/x-7z-compressed',
                    '.tar': 'application/x-tar',
                    '.gz': 'application/gzip',
                    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    '.doc': 'application/msword',
                    '.xls': 'application/vnd.ms-excel',
                    '.ppt': 'application/vnd.ms-powerpoint',
                }
                mime = mime_map.get(ext, 'application/octet-stream')

            name = os.path.basename(path)
            is_image = mime.startswith('image/')

            print(f'📎 [读取二进制] {path}')
            print(f'   📦 大小: {size} 字节 ({size / 1024:.1f} KB)')
            print(f'   🏷️  MIME: {mime}')
            print(f'   🖼️  是图片: {is_image}')

            self._send_json(200, {
                'ok': True,
                'path': path,
                'name': name,
                'size': size,
                'mime': mime,
                'is_image': is_image,
                'data': f'data:{mime};base64,{b64}'
            })
        except Exception as e:
            print(f'   ❌ 失败: {e}')
            self._send_json(200, {'ok': False, 'error': str(e)})

    # ============ 写文件 ============
    def handle_write_file(self, body):
        path, err = check_path_or_error(body.get('path', ''))
        if err: return self._send_json(200, {'ok': False, 'error': err})
        content = body.get('content', '')
        print(f'✍️  [写文件] {path} ({len(content)} 字符)')
        try:
            parent = os.path.dirname(path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            existed = os.path.exists(path)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f'   ✅ 成功！')
            self._send_json(200, {
                'ok': True, 'path': path,
                'action': '覆盖' if existed else '创建',
                'bytes_written': len(content.encode('utf-8'))
            })
        except Exception as e:
            print(f'   ❌ 失败: {e}')
            self._send_json(200, {'ok': False, 'error': str(e)})

    # ============ 追加文件 ============
    def handle_append_file(self, body):
        path, err = check_path_or_error(body.get('path', ''))
        if err: return self._send_json(200, {'ok': False, 'error': err})
        content = body.get('content', '')
        print(f'📝 [追加] {path} (+{len(content)} 字符)')
        try:
            parent = os.path.dirname(path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(path, 'a', encoding='utf-8') as f:
                f.write(content)
            self._send_json(200, {
                'ok': True, 'path': path,
                'bytes_appended': len(content.encode('utf-8'))
            })
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': str(e)})

    # ============ 精确编辑 ============
    def handle_edit_file(self, body):
        path, err = check_path_or_error(body.get('path', ''))
        if err: return self._send_json(200, {'ok': False, 'error': err})
        old_text = body.get('old_text', '')
        new_text = body.get('new_text', '')
        print(f'✏️  [编辑] {path}')
        if not os.path.exists(path):
            return self._send_json(200, {'ok': False, 'error': f'文件不存在: {path}'})
        if not old_text:
            return self._send_json(200, {'ok': False, 'error': 'old_text 不能为空'})
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            count = content.count(old_text)
            if count == 0:
                return self._send_json(200, {'ok': False, 'error': f'未找到要替换的文本'})
            if count > 1:
                return self._send_json(200, {
                    'ok': False,
                    'error': f'找到 {count} 处匹配，请提供更具体的上下文'
                })
            new_content = content.replace(old_text, new_text, 1)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            self._send_json(200, {'ok': True, 'path': path})
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': str(e)})

    # ============ Patch 编辑 ============
    def handle_apply_patch(self, body):
        patch_text = body.get('patch', '')
        dry_run = bool(body.get('dry_run', False))
        if not patch_text.strip():
            return self._send_json(200, {'ok': False, 'error': 'patch 不能为空'})
        print(f'🧩 [Apply Patch] dry_run={dry_run}, {len(patch_text)} 字符')
        try:
            file_patches = _parse_unified_patch(patch_text)
            prepared = []
            for fp in file_patches:
                target_rel = fp['new_path'] if fp['new_path'] != '/dev/null' else fp['old_path']
                target, err = check_path_or_error(target_rel, must_exist=False)
                if err:
                    return self._send_json(200, {'ok': False, 'error': err})
                if fp['new_path'] == '/dev/null':
                    return self._send_json(200, {'ok': False, 'error': '当前 apply_patch 暂不支持删除文件，请使用 delete_note'})
                new_content, stats = _apply_file_patch(target, fp)
                prepared.append({
                    'path': target,
                    'rel_path': target_rel,
                    'content': new_content,
                    'stats': stats
                })

            if not dry_run:
                for item in prepared:
                    parent = os.path.dirname(item['path'])
                    if parent:
                        os.makedirs(parent, exist_ok=True)
                    with open(item['path'], 'w', encoding='utf-8') as f:
                        f.write(item['content'])

            files = [{
                'path': item['path'],
                'added': item['stats']['added'],
                'removed': item['stats']['removed'],
                'hunks': item['stats']['hunks'],
                'action': '修改' if item['stats']['existed'] else '创建'
            } for item in prepared]
            return self._send_json(200, {
                'ok': True,
                'dry_run': dry_run,
                'files': files,
                'message': ('Patch 预检通过' if dry_run else 'Patch 已应用')
            })
        except Exception as e:
            return self._send_json(200, {'ok': False, 'error': str(e)})

    # ============ 删除 ============
    def handle_delete_file(self, body):
        path, err = check_path_or_error(body.get('path', ''))
        if err: return self._send_json(200, {'ok': False, 'error': err})
        print(f'🗑️  [删除] {path}')
        if not os.path.exists(path):
            return self._send_json(200, {'ok': False, 'error': '路径不存在'})
        try:
            if os.path.isfile(path):
                os.remove(path)
                self._send_json(200, {'ok': True, 'path': path, 'type': 'file'})
            elif os.path.isdir(path):
                if os.listdir(path):
                    return self._send_json(200, {'ok': False, 'error': '目录非空'})
                os.rmdir(path)
                self._send_json(200, {'ok': True, 'path': path, 'type': 'dir'})
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': str(e)})

    # ============ 列目录 ============
    def handle_list_dir(self, body):
        path, err = check_path_or_error(body.get('path', '') or '.')
        if err: return self._send_json(200, {'ok': False, 'error': err})
        print(f'📁 [列目录] {path}')
        if not os.path.isdir(path):
            return self._send_json(200, {'ok': False, 'error': f'不是目录: {path}'})
        try:
            entries = []
            for name in sorted(os.listdir(path)):
                full = os.path.join(path, name)
                try:
                    is_dir = os.path.isdir(full)
                    size = 0 if is_dir else os.path.getsize(full)
                    entries.append({
                        'name': name,
                        'type': 'dir' if is_dir else 'file',
                        'size': size
                    })
                except:
                    pass
            self._send_json(200, {'ok': True, 'path': path, 'entries': entries})
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': str(e)})

    # ============ 搜索 ============
    def handle_search(self, body):
        path, err = check_path_or_error(body.get('path', '') or '.')
        if err: return self._send_json(200, {'ok': False, 'error': err})
        pattern = body.get('pattern', '')
        file_glob = body.get('file_glob', '*')
        max_results = min(int(body.get('max_results', 50)), 200)
        print(f'🔍 [搜索] "{pattern}" in {path}')
        if not pattern:
            return self._send_json(200, {'ok': False, 'error': 'pattern 不能为空'})
        try:
            regex = re.compile(pattern, re.IGNORECASE)
        except:
            regex = None
        results = []
        try:
            for root, dirs, files in os.walk(path):
                dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', '__pycache__', '.venv', 'venv')]
                for fname in files:
                    if not fnmatch.fnmatch(fname, file_glob):
                        continue
                    fpath = os.path.join(root, fname)
                    try:
                        if os.path.getsize(fpath) > 512 * 1024:
                            continue
                        with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
                            for line_no, line in enumerate(f, 1):
                                if (regex and regex.search(line)) or (not regex and pattern.lower() in line.lower()):
                                    results.append({
                                        'file': fpath,
                                        'line': line_no,
                                        'content': line.rstrip()[:200]
                                    })
                                    if len(results) >= max_results:
                                        break
                    except:
                        pass
                    if len(results) >= max_results:
                        break
                if len(results) >= max_results:
                    break
            self._send_json(200, {'ok': True, 'pattern': pattern, 'results': results})
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': str(e)})

    # ============ 文件信息 ============
    def handle_file_info(self, body):
        path, err = check_path_or_error(body.get('path', ''))
        if err: return self._send_json(200, {'ok': False, 'error': err})
        if not os.path.exists(path):
            return self._send_json(200, {'ok': False, 'error': '路径不存在'})
        try:
            st = os.stat(path)
            self._send_json(200, {
                'ok': True,
                'path': path,
                'type': 'dir' if os.path.isdir(path) else 'file',
                'size': st.st_size,
                'modified': st.st_mtime
            })
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': str(e)})
