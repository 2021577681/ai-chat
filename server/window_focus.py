# ============================================================
# server/window_focus.py - best-effort Win32 window activation
# ============================================================

import ctypes
import os
import sys
import threading
import time
from ctypes import wintypes


SW_SHOW = 5
SW_RESTORE = 9


def _hwnd_to_int(hwnd):
    value = getattr(hwnd, 'value', hwnd)
    return int(value or 0)


def _normalize_keywords(title_keywords):
    out = []
    for item in title_keywords or []:
        text = str(item or '').strip()
        if text:
            out.append(text.lower())
    return out


def _enum_windows():
    if sys.platform != 'win32':
        return []

    user32 = ctypes.windll.user32
    windows = []

    enum_proc_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def callback(hwnd, _):
        try:
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = (buf.value or '').strip()
            if not title:
                return True
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            windows.append({
                'hwnd': _hwnd_to_int(hwnd),
                'title': title,
                'pid': int(pid.value),
            })
        except Exception:
            pass
        return True

    user32.EnumWindows(enum_proc_type(callback), 0)
    return windows


def _score_window(window, pid=None, title_keywords=None):
    score = 0
    if pid and int(window.get('pid') or 0) == int(pid):
        score += 100

    title_l = (window.get('title') or '').lower()
    for keyword in title_keywords or []:
        if title_l == keyword:
            score += 50
        elif keyword in title_l:
            score += 20

    return score


def _activate_hwnd(hwnd):
    user32 = ctypes.windll.user32
    hwnd = wintypes.HWND(hwnd)
    try:
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)
        else:
            user32.ShowWindow(hwnd, SW_SHOW)
        user32.BringWindowToTop(hwnd)
        return bool(user32.SetForegroundWindow(hwnd))
    except Exception:
        return False


def focus_window(pid=None, title_keywords=None, timeout=3.0, interval=0.12):
    """Try to bring a matching Windows window to the foreground."""
    if sys.platform != 'win32':
        return {'ok': False, 'reason': 'not_windows'}

    keywords = _normalize_keywords(title_keywords)
    if not pid and not keywords:
        return {'ok': False, 'reason': 'missing_matcher'}

    deadline = time.time() + max(float(timeout or 0), 0)
    while True:
        candidates = []
        for window in _enum_windows():
            score = _score_window(window, pid=pid, title_keywords=keywords)
            if score > 0:
                candidates.append((score, window))

        if candidates:
            candidates.sort(key=lambda item: item[0], reverse=True)
            window = candidates[0][1]
            focused = _activate_hwnd(window['hwnd'])
            return {'ok': focused, 'window': window}

        if time.time() >= deadline:
            break
        time.sleep(max(float(interval or 0.1), 0.03))

    return {'ok': False, 'reason': 'not_found'}


def focus_window_soon(pid=None, title_keywords=None, timeout=3.0):
    """Start a daemon thread for non-blocking best-effort activation."""
    if sys.platform != 'win32':
        return False

    def worker():
        try:
            focus_window(pid=pid, title_keywords=title_keywords, timeout=timeout)
        except Exception:
            pass

    thread = threading.Thread(target=worker, name='window-focus', daemon=True)
    thread.start()
    return True


def focus_window_for_path(path, timeout=4.0):
    base = os.path.basename(str(path or '').strip())
    if not base:
        return False
    stem, _ = os.path.splitext(base)
    keywords = [base]
    if stem and stem != base:
        keywords.append(stem)
    return focus_window_soon(title_keywords=keywords, timeout=timeout)
