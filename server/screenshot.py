# ============================================================
# server/screenshot.py - 屏幕/窗口截图 mixin
# ============================================================
# 提供 ScreenshotMixin，给 Handler 用。
# action: screenshot
# 参数：
#   mode 可选：auto/window/fullscreen
#   window_title/process_name/hwnd 可选：用于指定窗口截图。
#   all_screens 可选，默认 True，尽量覆盖多显示器。
# 截图自动保存到当前工作目录，返回本地文件路径。
# ============================================================

import base64
import os
import sys
import time
from io import BytesIO


class ScreenshotMixin:
    """Handler mixin：屏幕/窗口截图。"""

    def _save_and_encode_response(self, img, *, source, window_info=None,
                                   strategy=None, warnings=None):
        """保存截图到当前工作目录并返回路径信息。"""
        from . import config

        ts = time.strftime('%Y%m%d_%H%M%S')
        name = f'screenshot_{ts}_{source}.png'
        # ⭐ 兜底：若 current_cwd 不是有效目录，回退到 os.getcwd()
        save_dir = config.current_cwd
        if not os.path.isdir(save_dir):
            save_dir = os.getcwd()
        save_path = os.path.join(save_dir, name)
        abs_path = os.path.abspath(save_path)

        # 保存 PNG 到文件
        img.save(abs_path, format='PNG')

        # 读取并编码 base64（前端预览用）
        with open(abs_path, 'rb') as f:
            raw = f.read()
        b64 = base64.b64encode(raw).decode('ascii')

        payload = {
            'ok': True,
            'name': name,
            'path': abs_path,
            'dir': save_dir,
            'mime': 'image/png',
            'size': len(raw),
            'width': img.size[0],
            'height': img.size[1],
            'source': source,
            'strategy': strategy or source,
            'window': window_info,
            'warnings': warnings or [],
            'is_image': True,
            'data': 'data:image/png;base64,' + b64
        }
        self._send_json(200, payload)

    def _grab_fullscreen(self, body):
        try:
            from PIL import ImageGrab
        except Exception as e:
            raise RuntimeError('截图依赖 Pillow 未安装或不可用。请先运行：pip install pillow\n' + str(e))
        all_screens = body.get('all_screens', True)
        try:
            return ImageGrab.grab(all_screens=bool(all_screens))
        except TypeError:
            return ImageGrab.grab()

    def _find_windows_win32(self, title=None, process_name=None, hwnd=None):
        if sys.platform != 'win32':
            return []
        import win32gui
        import win32process
        matches = []
        title_l = (title or '').lower().strip()
        proc_l = (process_name or '').lower().strip()

        def get_proc_name(pid):
            if not proc_l:
                return ''
            try:
                import psutil
                p = psutil.Process(pid)
                return (p.name() or '').lower()
            except Exception:
                return ''

        if hwnd:
            try:
                hwnd_i = int(hwnd)
                if win32gui.IsWindow(hwnd_i):
                    text = win32gui.GetWindowText(hwnd_i)
                    _, pid = win32process.GetWindowThreadProcessId(hwnd_i)
                    return [{'hwnd': hwnd_i, 'title': text, 'pid': pid, 'process_name': get_proc_name(pid)}]
            except Exception:
                return []

        def enum_cb(h, _):
            try:
                if not win32gui.IsWindow(h):
                    return
                text = win32gui.GetWindowText(h) or ''
                if not text.strip():
                    return
                if not win32gui.IsWindowVisible(h):
                    return
                if title_l and title_l not in text.lower():
                    return
                _, pid = win32process.GetWindowThreadProcessId(h)
                pname = get_proc_name(pid)
                if proc_l and pname and proc_l not in pname:
                    return
                matches.append({'hwnd': h, 'title': text, 'pid': pid, 'process_name': pname})
            except Exception:
                pass

        win32gui.EnumWindows(enum_cb, None)
        return matches

    def _capture_window_win32(self, body):
        """窗口截图：全屏截图 + 裁剪到窗口坐标。
        
        原理（参考微信/QQ 截图等主流工具）：
        - 不碰窗口 DC（GPU 加速窗口的 DC 是黑的）
        - 从屏幕 DC 直接读像素（ImageGrab 内部用 BitBlt from GetDC(0)）
        - 用 GetWindowRect 获取窗口在屏幕上的坐标，裁剪即可
        """
        if sys.platform != 'win32':
            raise RuntimeError('当前系统暂不支持后台窗口截图，仅 Windows 支持 window 模式；请改用 fullscreen。')
        try:
            import win32gui
            from PIL import ImageGrab
        except Exception as e:
            raise RuntimeError('窗口截图依赖 pywin32/Pillow。请先运行：pip install pywin32 pillow\n' + str(e))

        wins = self._find_windows_win32(
            title=body.get('window_title'),
            process_name=body.get('process_name'),
            hwnd=body.get('hwnd')
        )
        if not wins:
            raise RuntimeError('未找到匹配的目标窗口')
        info = wins[0]
        hwnd = int(info['hwnd'])
        
        # 获取窗口在屏幕上的坐标
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        width = right - left
        height = bottom - top
        if width <= 0 or height <= 0:
            raise RuntimeError('目标窗口尺寸无效，可能已最小化')

        warnings = []
        
        # ⭐ 核心：用 ImageGrab 从屏幕 DC 截取窗口区域
        #   ImageGrab.grab(bbox=...) 内部调用 BitBlt from GetDC(0)，
        #   直接读屏幕像素，不经过窗口 DC，对 GPU 加速窗口完全兼容
        try:
            img = ImageGrab.grab(bbox=(left, top, right, bottom), all_screens=True)
        except TypeError:
            # 旧版 Pillow 可能不支持 all_screens 参数
            img = ImageGrab.grab(bbox=(left, top, right, bottom))

        if img is None:
            raise RuntimeError('ImageGrab 返回空图像')

        info.update({'rect': [left, top, right, bottom], 'method': 'screengrab_crop'})
        return img, info, warnings

    def handle_screenshot(self, body):
        try:
            mode = (body.get('mode') or 'auto').lower().strip()
            has_window_hint = any(body.get(k) for k in ('window_title', 'process_name', 'hwnd'))
            strategy = []
            warnings = []
            source = 'fullscreen'
            window_info = None

            img = None
            if mode in ('auto', 'window') and has_window_hint:
                strategy.append('priority_1_window')
                try:
                    img, window_info, win_warnings = self._capture_window_win32(body)
                    warnings.extend(win_warnings or [])
                    source = 'window'
                except Exception as e:
                    if mode == 'window':
                        return self._send_json(200, {'ok': False, 'error': f'指定窗口截图失败：{e}', 'source': 'window'})
                    warnings.append(f'优先级 1 指定窗口截图失败：{e}；已进入优先级 2 全屏截图。')

            if img is None:
                strategy.append('priority_2_fullscreen')
                img = self._grab_fullscreen(body)
                source = 'fullscreen'

            self._save_and_encode_response(
                img,
                source=source,
                window_info=window_info,
                strategy=' -> '.join(strategy) if strategy else source,
                warnings=warnings
            )
        except Exception as e:
            self._send_json(200, {
                'ok': False,
                'error': f'截图失败：{e}',
                'fallback': '请将目标窗口置于前台后重试，或改用全屏截图。'
            })

    def handle_list_windows(self, body):
        try:
            title = body.get('window_title') or body.get('title')
            process_name = body.get('process_name')
            wins = self._find_windows_win32(title=title, process_name=process_name)
            self._send_json(200, {'ok': True, 'windows': wins, 'count': len(wins), 'platform': sys.platform})
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': f'列出窗口失败：{e}', 'platform': sys.platform})
