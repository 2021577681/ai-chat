# ============================================================
# server/exec.py - execute_action（命令执行 + cd 拦截）
# ============================================================
# 提供 ExecMixin，给 Handler 用。
# 三层防护已在 sandbox.py 实现，这里负责调用 + cd 命令的特殊处理。
# ============================================================

import os
import re
import subprocess
import tempfile

from . import config
from .sandbox import is_dangerous_command, is_inside_workspace, resolve_path


class ExecMixin:
    """Handler mixin：handle_execute"""

    def handle_execute(self, body):
        command = body.get('command', '').strip()
        cwd = body.get('cwd') or config.current_cwd
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
        if command.strip().startswith('cd '):
            target = command.strip()[3:].strip().strip('"').strip("'")
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
            # 修改全局 cwd（注意走 config 模块属性，不要 from config import current_cwd）
            config.current_cwd = new_cwd
            return self._send_json(200, {
                'ok': True,
                'stdout': f'已切换到: {new_cwd}',
                'stderr': '',
                'returncode': 0,
                'cwd': new_cwd
            })

        try:
            proc = subprocess.run(
                command, shell=True, capture_output=True, text=True,
                timeout=timeout, cwd=cwd_abs, encoding='utf-8', errors='replace'
            )
            self._send_json(200, {
                'ok': True,
                'stdout': (proc.stdout or '')[-8000:],
                'stderr': (proc.stderr or '')[-3000:],
                'returncode': proc.returncode,
                'cwd': cwd_abs
            })
        except subprocess.TimeoutExpired:
            self._send_json(200, {'ok': False, 'error': f'命令超时（{timeout}秒）'})
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': str(e)})
