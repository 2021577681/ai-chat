# ============================================================
# server/screenshot.py - 屏幕/窗口截图 mixin
# ============================================================
# 提供 ScreenshotMixin，给 Handler 用。
# action: screenshot
# 参数：
#   mode 可选：auto/window/fullscreen/crop
#   window_title/process_name/hwnd 可选：用于指定窗口截图。
#   x, y, width, height 可选：用于全屏截图后裁剪，或对窗口截图结果裁剪。
#   all_screens 可选，默认 True，尽量覆盖多显示器。
# 返回：PNG base64 data URL + 尺寸信息 + 分级截图策略信息。
# ============================================================

import base64
import os
import sys
import time
from io import BytesIO


class ScreenshotMixin:
    """Handler mixin：屏幕/窗口截图。"""

    def _encode_png_response(self, img, *, source, full_size=None, cropped=False,
                             crop_box=None, window_info=None, strategy=None,
                             warnings=None):
        out = BytesIO()
        img.save(out, format='PNG')
        raw = out.getvalue()
        b64 = base64.b64encode(raw).decode('ascii')
        ts = time.strftime('%Y%m%d_%H%M%S')
        name = f'screenshot_{ts}_{source}{"_crop" if cropped else ""}.png'
        full_w, full_h = full_size or img.size
        payload = {
            'ok': True,
            'name': name,
            'mime': 'image/png',
            'size': len(raw),
            'width': img.size[0],
            'height': img.size[1],
            'full_width': full_w,
            'full_height': full_h,
            'cropped': cropped,
            'crop_box': crop_box,
            'source': source,
            'strategy': strategy or source,
            'window': window_info,
            'warnings': warnings or [],
            'is_image': True,
            'data': 'data:image/png;base64,' + b64
        }
        self._send_json(200, payload)

    def _crop_if_needed(self, img, body):
        full_w, full_h = img.size
        x = body.get('x', None)
        y = body.get('y', None)
        w = body.get('width', None)
        h = body.get('height', None)
        if x is None and y is None and w is None and h is None:
            return img, False, None, (full_w, full_h)
        try:
            x = int(x or 0)
            y = int(y or 0)
            w = int(w or 0)
            h = int(h or 0)
        except Exception:
            raise ValueError('截图区域参数必须是整数：x, y, width, height')
        if w <= 0 or h <= 0:
            raise ValueError('截图区域 width/height 必须大于 0')
        left = max(0, x)
        top = max(0, y)
        right = min(full_w, x + w)
        bottom = min(full_h, y + h)
        if right <= left or bottom <= top:
            raise ValueError(f'截图区域超出图像范围。图像尺寸：{full_w}×{full_h}')
        return img.crop((left, top, right, bottom)), True, [left, top, right, bottom], (full_w, full_h)

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
                # 如果要求 process_name 但没有 psutil，无法核验，则不过滤，交给标题过滤兜底
                matches.append({'hwnd': h, 'title': text, 'pid': pid, 'process_name': pname})
            except Exception:
                pass

        win32gui.EnumWindows(enum_cb, None)
        return matches

    def _capture_window_win32(self, body):
        if sys.platform != 'win32':
            raise RuntimeError('当前系统暂不支持后台窗口截图，仅 Windows 支持 window 模式；请改用 fullscreen。')
        try:
            import win32con
            import win32gui
            import win32ui
            from PIL import Image
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
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        width = right - left
        height = bottom - top
        if width <= 0 or height <= 0:
            raise RuntimeError('目标窗口尺寸无效，可能已最小化')

        hwnd_dc = win32gui.GetWindowDC(hwnd)
        mfc_dc = win32ui.CreateDCFromHandle(hwnd_dc)
        save_dc = mfc_dc.CreateCompatibleDC()
        bitmap = win32ui.CreateBitmap()
        bitmap.CreateCompatibleBitmap(mfc_dc, width, height)
        save_dc.SelectObject(bitmap)
        warnings = []
        try:
            flags = int(body.get('printwindow_flags', 2))  # PW_RENDERFULLCONTENT on newer Windows
            result = win32gui.PrintWindow(hwnd, save_dc.GetSafeHdc(), flags)
            if not result:
                warnings.append('PrintWindow 返回失败，已尝试 BitBlt 可见区域兜底；被遮挡部分可能不完整。')
                save_dc.BitBlt((0, 0), (width, height), mfc_dc, (0, 0), win32con.SRCCOPY)
            bmpinfo = bitmap.GetInfo()
            bmpstr = bitmap.GetBitmapBits(True)
            img = Image.frombuffer(
                'RGB',
                (bmpinfo['bmWidth'], bmpinfo['bmHeight']),
                bmpstr,
                'raw',
                'BGRX',
                0,
                1
            )
        finally:
            win32gui.DeleteObject(bitmap.GetHandle())
            save_dc.DeleteDC()
            mfc_dc.DeleteDC()
            win32gui.ReleaseDC(hwnd, hwnd_dc)

        info.update({'rect': [left, top, right, bottom]})
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

            img, cropped, crop_box, full_size = self._crop_if_needed(img, body)
            self._encode_png_response(
                img,
                source=source,
                full_size=full_size,
                cropped=cropped,
                crop_box=crop_box,
                window_info=window_info,
                strategy=' -> '.join(strategy) if strategy else source,
                warnings=warnings
            )
        except Exception as e:
            self._send_json(200, {
                'ok': False,
                'error': f'截图失败：{e}',
                'fallback': '请将目标窗口置于前台后重试，或改用全屏截图再裁剪。'
            })

    def handle_list_windows(self, body):
        try:
            title = body.get('window_title') or body.get('title')
            process_name = body.get('process_name')
            wins = self._find_windows_win32(title=title, process_name=process_name)
            self._send_json(200, {'ok': True, 'windows': wins, 'count': len(wins), 'platform': sys.platform})
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': f'列出窗口失败：{e}', 'platform': sys.platform})
