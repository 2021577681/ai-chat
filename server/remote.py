# ============================================================
# server/remote.py - 远程 Agent 自动部署与 SSH 隧道
# ============================================================
# 使用系统 ssh/scp：
#   1) 打包最小后端 local_terminal_server.py + requirements.txt + server/
#   2) scp 上传到 ~/.snake-agent/current
#   3) 远程 nohup 启动 Agent，仅监听 127.0.0.1
#   4) 本地 ssh -N -L 建立隧道
# ============================================================

import os
import shlex
import shutil
import socket
import subprocess
import tarfile
import tempfile
import textwrap
import threading
import time
import urllib.request
from pathlib import Path

from . import config

_REMOTE_STATE = {
    'connected': False,
    'ssh_command': '',
    'remote_workspace': '',
    'remote_agent_port': 8765,
    'local_port': 0,
    'server_url': '',
    'tunnel_pid': None,
    'started_at': '',
    'last_error': '',
    'tunnel_process': None,
    'heartbeat_thread': None,
    'heartbeat_stop': None,
    'heartbeat_timeout': 75,
}


def _now_stamp():
    return time.strftime('%Y-%m-%d %H:%M:%S')


def _project_root():
    return Path(__file__).resolve().parent.parent


def _split_cmd(command):
    command = (command or '').strip()
    if not command:
        raise ValueError('SSH 命令不能为空，例如：ssh user@example.com')
    parts = shlex.split(command, posix=(os.name != 'nt'))
    if not parts or Path(parts[0]).name.lower() not in ('ssh', 'ssh.exe'):
        raise ValueError('SSH 命令必须以 ssh 开头，例如：ssh -p 22 user@example.com')
    if len(parts) < 2:
        raise ValueError('SSH 命令缺少远程主机，例如：ssh user@example.com')
    return parts


def _scp_parts_from_ssh(parts):
    """把常见 ssh 参数转换成 scp 参数。约定远程目标在最后一个参数。"""
    target = parts[-1]
    opts = list(parts[1:-1])
    out = ['scp']
    i = 0
    while i < len(opts):
        p = opts[i]
        if p == '-p':
            out.append('-P')
            if i + 1 < len(opts):
                out.append(opts[i + 1]); i += 2; continue
        out.append(p)
        i += 1
    return out, target


def _remote_q(s):
    return shlex.quote(str(s or ''))


def _local_port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(('127.0.0.1', int(port)))
            return True
        except OSError:
            return False


def _pick_local_port(preferred=18765):
    p = int(preferred or 18765)
    for port in range(p, p + 100):
        if _local_port_free(port):
            return port
    raise RuntimeError('没有可用的本地隧道端口')


def _make_bundle():
    root = _project_root()
    tmp_dir = Path(tempfile.mkdtemp(prefix='snake_remote_bundle_'))
    bundle = tmp_dir / 'snake-agent-backend.tar.gz'
    include_files = [
        root / 'local_terminal_server.py',
        root / 'requirements.txt',
    ]
    with tarfile.open(bundle, 'w:gz') as tar:
        for f in include_files:
            if f.exists():
                tar.add(f, arcname=f.name)
        server_dir = root / 'server'
        for p in server_dir.rglob('*'):
            if not p.is_file():
                continue
            rel = p.relative_to(root)
            parts = set(rel.parts)
            if '__pycache__' in parts or p.suffix in ('.pyc', '.pyo'):
                continue
            tar.add(p, arcname=str(rel).replace(os.sep, '/'))
    return str(bundle), str(tmp_dir)


def _write_askpass(password):
    if not password:
        return None
    d = Path(tempfile.mkdtemp(prefix='snake_askpass_'))
    script = d / ('askpass.bat' if os.name == 'nt' else 'askpass.sh')
    if os.name == 'nt':
        script.write_text('@echo off\r\necho %SNAKE_REMOTE_PASSWORD%\r\n', encoding='utf-8')
    else:
        script.write_text('#!/bin/sh\nprintf "%s\\n" "$SNAKE_REMOTE_PASSWORD"\n', encoding='utf-8')
        script.chmod(0o700)
    return str(script)


def _run(cmd, password='', timeout=120, input_text=None):
    env = os.environ.copy()
    askpass = _write_askpass(password)
    if askpass:
        env['SNAKE_REMOTE_PASSWORD'] = password
        env['SSH_ASKPASS'] = askpass
        env['SSH_ASKPASS_REQUIRE'] = 'prefer'
        env.setdefault('DISPLAY', 'snake-agent:0')
    try:
        p = subprocess.run(
            cmd,
            input=input_text,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            env=env,
            stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL,
            shell=False,
        )
        out = (p.stdout or '') + (('\n' + p.stderr) if p.stderr else '')
        if p.returncode != 0:
            raise RuntimeError(f'命令失败（exit {p.returncode}）：{shlex.join(cmd)}\n{out[-4000:]}')
        return out
    finally:
        if askpass:
            try:
                shutil.rmtree(str(Path(askpass).parent), ignore_errors=True)
            except Exception:
                pass


def _start_tunnel(ssh_parts, local_port, remote_port, password=''):
    old = _REMOTE_STATE.get('tunnel_process')
    if old and old.poll() is None:
        try:
            old.terminate()
        except Exception:
            pass
    cmd = list(ssh_parts[:-1]) + [
        '-N',
        '-L', f'127.0.0.1:{int(local_port)}:127.0.0.1:{int(remote_port)}',
        ssh_parts[-1]
    ]
    env = os.environ.copy()
    askpass = _write_askpass(password)
    if askpass:
        env['SNAKE_REMOTE_PASSWORD'] = password
        env['SSH_ASKPASS'] = askpass
        env['SSH_ASKPASS_REQUIRE'] = 'prefer'
        env.setdefault('DISPLAY', 'snake-agent:0')
    p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, env=env)
    time.sleep(1.2)
    if p.poll() is not None:
        raise RuntimeError('SSH 隧道启动失败，请检查 SSH 命令、密码/密钥和端口占用')
    return p


def _stop_heartbeat():
    ev = _REMOTE_STATE.get('heartbeat_stop')
    if ev:
        try:
            ev.set()
        except Exception:
            pass
    _REMOTE_STATE['heartbeat_thread'] = None
    _REMOTE_STATE['heartbeat_stop'] = None


def _start_heartbeat(server_url, interval=15):
    _stop_heartbeat()
    stop_event = threading.Event()

    def _loop():
        url = server_url.rstrip('/') + '/remote-heartbeat'
        while not stop_event.is_set():
            try:
                with urllib.request.urlopen(url, timeout=5) as resp:
                    resp.read(200)
            except Exception as e:
                _REMOTE_STATE['last_error'] = f'远程心跳失败: {e}'
            stop_event.wait(interval)

    t = threading.Thread(target=_loop, name='remote-agent-heartbeat', daemon=True)
    t.start()
    _REMOTE_STATE['heartbeat_thread'] = t
    _REMOTE_STATE['heartbeat_stop'] = stop_event
    return t


def _wait_for_remote_agent(server_url, timeout=30):
    url = server_url.rstrip('/') + '/remote-heartbeat'
    deadline = time.time() + max(1, int(timeout or 30))
    last_error = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                resp.read(200)
                if 200 <= getattr(resp, 'status', 200) < 300:
                    return
        except Exception as e:
            last_error = e
        time.sleep(1)
    detail = f'最后错误：{last_error}' if last_error else '无响应'
    raise RuntimeError(
        '远程 Agent 未在超时时间内响应心跳；'
        '请检查远程日志 ~/.snake-agent/logs/remote-agent.log。' + detail
    )


class RemoteMixin:
    def handle_remote_status(self, body):
        proc = _REMOTE_STATE.get('tunnel_process')
        connected = bool(proc and proc.poll() is None and _REMOTE_STATE.get('server_url'))
        _REMOTE_STATE['connected'] = connected
        hidden = {'tunnel_process', 'heartbeat_thread', 'heartbeat_stop'}
        self._send_json(200, {k: v for k, v in _REMOTE_STATE.items() if k not in hidden})

    def handle_remote_disconnect(self, body):
        stop_remote = bool(body.get('stop_remote'))
        password = body.get('password') or ''
        proc = _REMOTE_STATE.get('tunnel_process')
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
        _stop_heartbeat()
        if stop_remote and _REMOTE_STATE.get('ssh_command'):
            try:
                parts = _split_cmd(_REMOTE_STATE['ssh_command'])
                cmd = 'if [ -f ~/.snake-agent/run/agent.pid ]; then kill $(cat ~/.snake-agent/run/agent.pid) 2>/dev/null || true; rm -f ~/.snake-agent/run/agent.pid; fi'
                _run(parts + [cmd], password=password, timeout=20)
            except Exception as e:
                _REMOTE_STATE['last_error'] = str(e)
        _REMOTE_STATE.update({'connected': False, 'server_url': '', 'tunnel_pid': None, 'tunnel_process': None})
        self._send_json(200, {'ok': True, 'message': '已断开远程隧道'})

    def handle_remote_connect(self, body):
        ssh_command = (body.get('ssh_command') or '').strip()
        password = body.get('password') or ''
        remote_workspace = (body.get('remote_workspace') or '~/').strip()
        remote_port = int(body.get('remote_agent_port') or 8765)
        local_port = _pick_local_port(int(body.get('local_port') or 18765))
        heartbeat_timeout = int(body.get('heartbeat_timeout') or 75)
        install_deps = body.get('install_deps', True) is not False
        logs = []
        bundle = tmp_dir = ''
        try:
            ssh_parts = _split_cmd(ssh_command)
            scp_base, target = _scp_parts_from_ssh(ssh_parts)

            logs.append('1/5 打包最小后端...')
            bundle, tmp_dir = _make_bundle()

            logs.append('2/5 创建远程目录...')
            _run(ssh_parts + ['mkdir -p ~/.snake-agent/current ~/.snake-agent/logs ~/.snake-agent/run'], password=password, timeout=60)

            logs.append('3/5 上传后端包...')
            _run(scp_base + [bundle, f'{target}:~/.snake-agent/agent_bundle.tar.gz'], password=password, timeout=180)

            logs.append('4/5 解包并启动远程 Agent...')
            install_cmd = 'python3 -m pip install --user -r ~/.snake-agent/current/requirements.txt >/tmp/snake-agent-pip.log 2>&1 || true' if install_deps else 'true'
            start_cmd = textwrap.dedent(f'''
                set -e
                tar -xzf ~/.snake-agent/agent_bundle.tar.gz -C ~/.snake-agent/current
                {install_cmd}
                if [ -f ~/.snake-agent/run/agent.pid ]; then kill $(cat ~/.snake-agent/run/agent.pid) 2>/dev/null || true; fi
                cd ~/.snake-agent/current
                nohup python3 local_terminal_server.py --workspace {_remote_q(remote_workspace)} --host 127.0.0.1 --port {remote_port} --remote-heartbeat-timeout {heartbeat_timeout} > ~/.snake-agent/logs/remote-agent.log 2>&1 &
                echo $! > ~/.snake-agent/run/agent.pid
                sleep 1
                cat ~/.snake-agent/run/agent.pid
            ''').strip()
            remote_out = _run(ssh_parts + [start_cmd], password=password, timeout=180)
            logs.append(remote_out.strip()[-1000:])

            logs.append('5/5 建立本地 SSH 隧道...')
            tunnel = _start_tunnel(ssh_parts, local_port, remote_port, password=password)
            server_url = f'http://127.0.0.1:{local_port}'
            try:
                _wait_for_remote_agent(server_url, timeout=30)
                logs.append('远程 Agent 已响应心跳。')
            except Exception:
                try:
                    tunnel.terminate()
                except Exception:
                    pass
                raise
            _start_heartbeat(server_url, interval=max(5, min(20, heartbeat_timeout // 4 or 15)))
            _REMOTE_STATE.update({
                'connected': True,
                'ssh_command': ssh_command,
                'remote_workspace': remote_workspace,
                'remote_agent_port': remote_port,
                'local_port': local_port,
                'server_url': server_url,
                'heartbeat_timeout': heartbeat_timeout,
                'tunnel_pid': tunnel.pid,
                'tunnel_process': tunnel,
                'started_at': _now_stamp(),
                'last_error': '',
            })
            self._send_json(200, {
                'ok': True,
                'server_url': server_url,
                'local_port': local_port,
                'remote_agent_port': remote_port,
                'remote_workspace': remote_workspace,
                'tunnel_pid': tunnel.pid,
                'heartbeat_timeout': heartbeat_timeout,
                'logs': logs,
            })
        except Exception as e:
            _REMOTE_STATE['last_error'] = str(e)
            self._send_json(200, {'ok': False, 'error': str(e), 'logs': logs})
        finally:
            if tmp_dir:
                shutil.rmtree(tmp_dir, ignore_errors=True)
