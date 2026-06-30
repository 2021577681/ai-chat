# ============================================================
# server/exec.py - execute_action（命令执行 + cd 拦截）
# ============================================================
# 提供 ExecMixin，给 Handler 用。
# 三层防护已在 sandbox.py 实现，这里负责调用 + cd 命令的特殊处理。
# ============================================================

import os
import platform
import re
import locale
import subprocess
import tempfile

from . import config
from .sandbox import command_workspace_violation, is_dangerous_command, is_inside_workspace, resolve_path
from .window_focus import focus_window_soon


def _unique_encodings(names):
    seen = set()
    out = []
    for name in names:
        if not name:
            continue
        key = str(name).lower().replace('_', '-')
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def _looks_like_utf16(raw):
    if len(raw) < 4:
        return False
    even_nuls = raw[0::2].count(0)
    odd_nuls = raw[1::2].count(0)
    pairs = max(len(raw) // 2, 1)
    return even_nuls / pairs > 0.25 or odd_nuls / pairs > 0.25


def _decode_process_output(raw):
    if not raw:
        return ''
    if isinstance(raw, str):
        return raw

    if raw.startswith((b'\xff\xfe', b'\xfe\xff')):
        try:
            return raw.decode('utf-16')
        except UnicodeDecodeError:
            pass
    if raw.startswith(b'\xef\xbb\xbf'):
        try:
            return raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            pass
    if _looks_like_utf16(raw):
        for enc in ('utf-16-le', 'utf-16-be'):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                pass

    encodings = ['utf-8']
    if os.name == 'nt':
        encodings.extend([
            locale.getpreferredencoding(False),
            'oem',
            'mbcs',
            'gb18030',
            'cp936',
        ])
    else:
        encodings.append(locale.getpreferredencoding(False))

    for enc in _unique_encodings(encodings):
        try:
            return raw.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue

    return raw.decode('utf-8', errors='replace')


class ExecMixin:
    """Handler mixin：handle_execute"""

    def handle_open_terminal(self, body):
        """打开系统终端窗口，工作目录为当前沙箱目录。"""
        try:
            cwd_abs = os.path.realpath(config.WORKSPACE_ROOT)
            if not os.path.isdir(cwd_abs):
                return self._send_json(200, {'ok': False, 'error': f'沙箱目录不存在: {cwd_abs}'})
            if not is_inside_workspace(cwd_abs):
                return self._send_json(200, {'ok': False, 'error': f'工作目录越界: {cwd_abs}'})

            system = platform.system().lower()
            proc = None

            if system == 'windows':
                terminal_title = 'AI Terminal'
                commands = [
                    ['wt.exe', 'new-tab', '--title', terminal_title, '-d', cwd_abs],
                    ['wt.exe', '-d', cwd_abs],
                    ['cmd.exe', '/k', f'title {terminal_title}'],
                ]
                last_error = None
                for cmd in commands:
                    try:
                        proc = subprocess.Popen(
                            cmd,
                            cwd=cwd_abs,
                            creationflags=subprocess.CREATE_NEW_CONSOLE
                        )
                        break
                    except Exception as e:
                        last_error = e
                if proc is None:
                    raise last_error or RuntimeError('无法启动 Windows 终端')
                focus_window_soon(
                    pid=getattr(proc, 'pid', None),
                    title_keywords=[terminal_title, 'Windows Terminal'],
                    timeout=3.0
                )
            elif system == 'darwin':
                safe_cwd = cwd_abs.replace('\\', '/').replace('"', '\\"')
                script = f'tell application "Terminal" to do script "cd {safe_cwd}"'
                proc = subprocess.Popen(['osascript', '-e', script], cwd=cwd_abs)
            else:
                commands = [
                    ['x-terminal-emulator'],
                    ['gnome-terminal'],
                    ['konsole'],
                    ['xfce4-terminal'],
                    ['xterm'],
                ]
                last_error = None
                for cmd in commands:
                    try:
                        proc = subprocess.Popen(cmd, cwd=cwd_abs)
                        break
                    except Exception as e:
                        last_error = e
                if proc is None:
                    raise last_error or RuntimeError('无法启动系统终端')

            return self._send_json(200, {
                'ok': True,
                'stdout': f'✅ 已打开终端: {cwd_abs}',
                'pid': getattr(proc, 'pid', None),
                'cwd': cwd_abs,
            })
        except Exception as e:
            return self._send_json(200, {'ok': False, 'error': f'无法打开终端: {e}'})

    def handle_execute(self, body):
        command = body.get('command', '').strip()
        cwd = body.get('cwd') or config.get_current_cwd()
        timeout = min(int(body.get('timeout', 30)), 300)
        if not command:
            return self._send_json(400, {'ok': False, 'error': '命令为空'})
        print(f'💻 [执行] cwd={cwd}\n   $ {command}')

        # ⭐ L3: 危险命令黑名单
        is_danger, reason = is_dangerous_command(command)
        if is_danger:
            print(f'🚫 [拦截] 危险命令：{reason}')
            return self._send_json(200, {
                'ok': False,
                'error': f'🚫 命令被沙箱黑名单拒绝：{reason}\n命令：{command}'
            })

        # ⭐ L4: 命令文本中的路径越界检测
        violates_workspace, workspace_reason = command_workspace_violation(command)
        if violates_workspace:
            print(f'🚫 [拦截] 命令路径越界：{workspace_reason}')
            return self._send_json(200, {
                'ok': False,
                'error': f'🚫 命令被沙箱路径规则拒绝：{workspace_reason}\n命令：{command}'
            })

        # ⭐ L1: cwd 必须在沙箱内
        cwd_abs = resolve_path(cwd) if not os.path.isabs(cwd) else os.path.expanduser(cwd)
        if not is_inside_workspace(cwd_abs):
            return self._send_json(200, {
                'ok': False,
                'error': f'🚫 工作目录越界：{cwd_abs}\n沙箱根: {config.WORKSPACE_ROOT}'
            })

        # ⭐ 新终端窗口模式：弹出独立 cmd 窗口运行命令，用户可看到实时输出
        #  适合长时间任务（安装依赖、训练、启动服务等），不受 timeout 限制
        if body.get('new_window'):
            print(f'🪟 [新窗口] cwd={cwd_abs}\n   $ {command}')
            try:
                # 构建 bat 文件：
                #   - chcp 65001 解决中文乱码
                #   - @echo off 隐藏辅助步骤，@echo on 开启命令回显
                #   - echo 类命令加 @ 前缀：只显示输出，不显示命令本身
                #   - 普通命令（cd、dir 等）：完整回显命令 + 输出
                bat_lines = [
                    '@echo off',
                    'chcp 65001 >nul',
                    f'cd /d "{cwd_abs}"',
                    'timeout /t 1 /nobreak >nul',
                ]
                for part in re.split(r'&&', command):
                    part = part.strip()
                    if not part:
                        continue
                    if part.startswith('echo'):
                        # echo 命令：@ 前缀 → 命令本身不回显，只显示输出
                        bat_lines.append('@echo on')
                        bat_lines.append('@' + part)
                        bat_lines.append('@echo off')
                        bat_lines.append('timeout /t 1 /nobreak >nul')
                    else:
                        # 普通命令（cd, dir, python 等）：完整回显
                        bat_lines.append('@echo on')
                        bat_lines.append(part)
                        bat_lines.append('@echo off')
                        bat_lines.append('timeout /t 1 /nobreak >nul')
                # 去掉末尾多余的 timeout
                while bat_lines and bat_lines[-1].startswith('timeout'):
                    bat_lines.pop()

                with tempfile.NamedTemporaryFile(
                    mode='w', suffix='.bat', delete=False, encoding='utf-8'
                ) as f:
                    bat_path = f.name
                    f.write('\n'.join(bat_lines))

                proc = subprocess.Popen(
                    f'cmd /k "title AI 终端 & "{bat_path}" & del "{bat_path}""',
                    creationflags=subprocess.CREATE_NEW_CONSOLE,
                    cwd=cwd_abs
                )
                return self._send_json(200, {
                    'ok': True,
                    'stdout': f'✅ 已在新终端窗口启动命令 (PID: {proc.pid})',
                    'stderr': '',
                    'returncode': 0,
                    'cwd': cwd_abs,
                    'new_window': True
                })
            except Exception as e:
                return self._send_json(200, {
                    'ok': False,
                    'error': f'无法创建新终端窗口: {e}'
                })

        # ⭐ L2: cd 拦截
        cd_match = None
        if not re.search(r'&&|\|\||[;&|]', command):
            cd_match = re.fullmatch(
                r'(?is)\s*(?:cd|chdir)(?:\s+/d)?(?:\s+(.+?))?\s*',
                command
            )
        if cd_match:
            target = (cd_match.group(1) or '').strip().strip('"').strip("'")
            if not target:
                return self._send_json(200, {
                    'ok': True,
                    'stdout': config.get_current_cwd(),
                    'stderr': '',
                    'returncode': 0,
                    'cwd': config.get_current_cwd()
                })
            new_cwd = resolve_path(target) if not os.path.isabs(target) else target
            new_cwd = os.path.expanduser(new_cwd)
            if not os.path.isdir(new_cwd):
                return self._send_json(200, {'ok': False, 'error': f'目录不存在: {new_cwd}'})
            if not is_inside_workspace(new_cwd):
                print(f'🚫 [拦截] cd 越界: {new_cwd}')
                return self._send_json(200, {
                    'ok': False,
                    'error': (
                        f'🚫 cd 越界被拒绝：{new_cwd}\n'
                        f'   沙箱根: {config.WORKSPACE_ROOT}\n'
                        f'   你只能在沙箱内切换目录。'
                    )
                })
            # 修改当前浏览器会话的 cwd，避免多标签/多任务互相影响。
            new_cwd = os.path.realpath(new_cwd)
            config.set_session_cwd(getattr(self, 'session_id', ''), new_cwd)
            config.bind_request_cwd(new_cwd)
            return self._send_json(200, {
                'ok': True,
                'stdout': f'已切换到: {new_cwd}',
                'stderr': '',
                'returncode': 0,
                'cwd': new_cwd
            })

        try:
            proc = subprocess.run(
                command, shell=True, capture_output=True,
                timeout=timeout, cwd=cwd_abs
            )
            stdout = _decode_process_output(proc.stdout)
            stderr = _decode_process_output(proc.stderr)
            self._send_json(200, {
                'ok': True,
                'stdout': stdout[-8000:],
                'stderr': stderr[-3000:],
                'returncode': proc.returncode,
                'cwd': cwd_abs
            })
        except subprocess.TimeoutExpired:
            self._send_json(200, {'ok': False, 'error': f'命令超时（{timeout}秒）'})
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': str(e)})
