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
import json
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
    print(f"🔧 [remote] run: {shlex.join(cmd)}", flush=True)
    try:
        p = subprocess.run(
            cmd,
            input=input_text,
            text=True,
            encoding='utf-8',
            errors='replace',
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            env=env,
            stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL,
            shell=False,
        )
        out = (p.stdout or '') + (('\n' + p.stderr) if p.stderr else '')
        if p.returncode != 0:
            print(f"❌ [remote] command failed exit={p.returncode}: {out[-2000:]}", flush=True)
            raise RuntimeError(f'命令失败（exit {p.returncode}）：{shlex.join(cmd)}\n{out[-4000:]}')
        if out.strip():
            print(f"✅ [remote] output: {out.strip()[-2000:]}", flush=True)
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


def _read_remote_workspace_info(server_url, timeout=10):
    """Read /workspace through the local SSH tunnel so the controller can fail with details."""
    url = server_url.rstrip('/') + '/workspace'
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            raw = resp.read(65536).decode('utf-8', errors='replace')
            data = json.loads(raw or '{}')
            if not isinstance(data, dict):
                raise RuntimeError('workspace response is not a JSON object')
            return data
    except Exception as e:
        print(f"❌ [remote] read /workspace failed: {e}", flush=True)
        raise RuntimeError(f'无法读取远程工作区信息：{e}')


def _tail_remote_agent_log(ssh_parts, password='', lines=120):
    """Fetch the tail of the remote Agent log for diagnostics."""
    try:
        n = max(20, min(500, int(lines or 120)))
        cmd = f'test -f ~/.snake-agent/logs/remote-agent.log && tail -n {n} ~/.snake-agent/logs/remote-agent.log || true'
        return _run(ssh_parts + [cmd], password=password, timeout=20).strip()
    except Exception as e:
        return f'读取远程日志失败：{e}'


def _diagnose_remote_workspace(ssh_parts, remote_workspace, password=''):
    """Validate the workspace on the remote host and return human-readable diagnostics."""
    q = _remote_q(remote_workspace)
    cmd = textwrap.dedent(f'''
        set +e
        P={q}
        python3 - <<'PY' "$P"
import os, sys, json
p = os.path.expanduser(sys.argv[1])
rp = os.path.realpath(p)
info = {{
    'input': sys.argv[1],
    'expanded': p,
    'realpath': rp,
    'exists': os.path.exists(rp),
    'isdir': os.path.isdir(rp),
    'readable': os.access(rp, os.R_OK),
    'executable': os.access(rp, os.X_OK),
}}
print(json.dumps(info, ensure_ascii=False))
if not (info['exists'] and info['isdir'] and info['readable'] and info['executable']):
    sys.exit(2)
PY
    ''').strip()
    return _run(ssh_parts + [cmd], password=password, timeout=30).strip()


def _pick_remote_port(ssh_parts, preferred_port, password='', span=100):
    """Pick an available port on the remote host by attempting to bind 127.0.0.1."""
    start = int(preferred_port or 8765)
    count = max(1, min(1000, int(span or 100)))
    cmd = textwrap.dedent(f'''
        python3 - <<'PY'
import socket, sys
start = {start}
count = {count}
for port in range(start, start + count):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(('127.0.0.1', port))
        print(port)
        sys.exit(0)
    except OSError:
        pass
    finally:
        s.close()
print('')
sys.exit(2)
PY
    ''').strip()
    out = _run(ssh_parts + [cmd], password=password, timeout=30).strip()
    if not out:
        raise RuntimeError(f'远程没有可用端口：{start}-{start + count - 1}')
    return int(out.splitlines()[-1].strip())


def _list_remote_dirs(ssh_parts, path='~', password='', show_hidden=False, limit=500):
    """List child directories on the remote host before the remote Agent is started."""
    q_path = _remote_q(path or '~')
    show_hidden_flag = '1' if show_hidden else '0'
    max_items = max(10, min(2000, int(limit or 500)))
    cmd = textwrap.dedent(f'''
        python3 - <<'PY' {q_path} {show_hidden_flag} {max_items}
import json, os, sys

raw = sys.argv[1] if len(sys.argv) > 1 else '~'
show_hidden = (sys.argv[2] if len(sys.argv) > 2 else '0') == '1'
limit = int(sys.argv[3] if len(sys.argv) > 3 else '500')

expanded = os.path.expanduser(raw or '~')
real = os.path.realpath(expanded)

def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))

if not os.path.exists(real):
    emit({{'ok': False, 'error': '目录不存在', 'input': raw, 'path': real}})
    sys.exit(0)
if not os.path.isdir(real):
    emit({{'ok': False, 'error': '不是目录', 'input': raw, 'path': real}})
    sys.exit(0)
if not os.access(real, os.R_OK | os.X_OK):
    emit({{'ok': False, 'error': '没有读取或进入该目录的权限', 'input': raw, 'path': real}})
    sys.exit(0)

entries = []
try:
    names = os.listdir(real)
except Exception as e:
    emit({{'ok': False, 'error': str(e), 'input': raw, 'path': real}})
    sys.exit(0)

for name in names:
    if not show_hidden and name.startswith('.'):
        continue
    p = os.path.join(real, name)
    try:
        is_dir = os.path.isdir(p)
    except Exception:
        continue
    if not is_dir:
        continue
    entries.append({{
        'name': name,
        'path': p,
        'readable': os.access(p, os.R_OK),
        'executable': os.access(p, os.X_OK),
    }})
entries.sort(key=lambda x: x['name'].lower())
emit({{'ok': True, 'input': raw, 'path': real, 'parent': os.path.dirname(real) or real, 'entries': entries[:limit], 'truncated': len(entries) > limit}})
PY
    ''').strip()
    out = _run(ssh_parts + [cmd], password=password, timeout=45).strip()
    try:
        data = json.loads(out.splitlines()[-1] if out else '{}')
    except Exception as e:
        raise RuntimeError(f'远程目录列表返回非 JSON：{e}\n{out[-2000:]}')
    return data


class RemoteMixin:
    def handle_remote_list_dirs(self, body):
        ssh_command = (body.get('ssh_command') or '').strip()
        password = body.get('password') or ''
        path = (body.get('path') or '~').strip() or '~'
        show_hidden = bool(body.get('show_hidden'))
        try:
            ssh_parts = _split_cmd(ssh_command)
            data = _list_remote_dirs(ssh_parts, path=path, password=password, show_hidden=show_hidden)
            self.response.json(200, data)
        except Exception as e:
            self.response.json(200, {'ok': False, 'error': str(e), 'path': path})

    def handle_remote_status(self, body):
        proc = _REMOTE_STATE.get('tunnel_process')
        connected = bool(proc and proc.poll() is None and _REMOTE_STATE.get('server_url'))
        _REMOTE_STATE['connected'] = connected
        hidden = {'tunnel_process', 'heartbeat_thread', 'heartbeat_stop'}
        self.response.json(200, {k: v for k, v in _REMOTE_STATE.items() if k not in hidden})

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
        self.response.json(200, {'ok': True, 'message': '已断开远程隧道'})

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

            logs.append('检查远程工作区目录...')
            try:
                logs.append('远程工作区检查：' + _diagnose_remote_workspace(ssh_parts, remote_workspace, password=password))
                print(f"✅ [remote] workspace check ok: {remote_workspace}", flush=True)
            except Exception as e:
                raise RuntimeError(f'远程工作区不可用：{remote_workspace}\n{e}')

            original_remote_port = remote_port
            remote_port = _pick_remote_port(ssh_parts, remote_port, password=password, span=100)
            if remote_port != original_remote_port:
                logs.append(f'远程端口 {original_remote_port} 被占用或不可用，自动改用 {remote_port}')
                print(f'⚠️ [remote] remote port {original_remote_port} unavailable, use {remote_port}', flush=True)

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
                # 先停掉旧 Agent。只 kill pidfile 可能不够：pidfile 可能丢失/过期，或旧进程不是当前 pid。
                if [ -f ~/.snake-agent/run/agent.pid ]; then
                    oldpid=$(cat ~/.snake-agent/run/agent.pid 2>/dev/null || true)
                    if [ -n "$oldpid" ]; then
                        kill "$oldpid" 2>/dev/null || true
                    fi
                fi

                # 再清理占用目标端口的进程，避免新 Agent 启动后报 Address already in use。
                # 远程 Agent 只监听 127.0.0.1:{remote_port}，这里等价于释放本次连接使用的 Agent 端口。
                if command -v fuser >/dev/null 2>&1; then
                    fuser -k {remote_port}/tcp >/dev/null 2>&1 || true
                elif command -v lsof >/dev/null 2>&1; then
                    pids=$(lsof -ti tcp:{remote_port} 2>/dev/null || true)
                    if [ -n "$pids" ]; then kill $pids 2>/dev/null || true; fi
                fi
                sleep 0.8

                if command -v fuser >/dev/null 2>&1; then
                    if fuser {remote_port}/tcp >/dev/null 2>&1; then
                        fuser -k -9 {remote_port}/tcp >/dev/null 2>&1 || true
                        sleep 0.3
                    fi
                fi
                cd ~/.snake-agent/current
                nohup python3 local_terminal_server.py --workspace {_remote_q(remote_workspace)} --host 127.0.0.1 --port {remote_port} --remote-heartbeat-timeout {heartbeat_timeout} > ~/.snake-agent/logs/remote-agent.log 2>&1 &
                newpid=$!
                echo $newpid > ~/.snake-agent/run/agent.pid
                sleep 1.5
                if ! kill -0 "$newpid" 2>/dev/null; then
                    echo "远程 Agent 启动后立即退出，日志如下：" >&2
                    tail -n 120 ~/.snake-agent/logs/remote-agent.log >&2 || true
                    exit 1
                fi
                echo "$newpid"
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

            try:
                workspace_info = _read_remote_workspace_info(server_url, timeout=10)
                logs.append(f"远程工作区：{workspace_info.get('workspace') or workspace_info.get('cwd') or remote_workspace}")
                print(f"✅ [remote] /workspace: {workspace_info}", flush=True)
            except Exception as e:
                diag = ''
                try:
                    diag = _diagnose_remote_workspace(ssh_parts, remote_workspace, password=password)
                except Exception as de:
                    diag = f'远程工作区复查失败：{de}'
                log_tail = _tail_remote_agent_log(ssh_parts, password=password, lines=160)
                detail = f'{e}\n远程工作区诊断：{diag}\n远程日志尾部：\n{log_tail}'
                workspace_info = {'ok': False, 'error': detail}
                logs.append('读取远程工作区失败：' + detail[-3000:])
                print(f"❌ [remote] workspace detail: {detail[-4000:]}", flush=True)
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
            self.response.json(200, {
                'ok': True,
                'server_url': server_url,
                'local_port': local_port,
                'remote_agent_port': remote_port,
                'remote_workspace': remote_workspace,
                'tunnel_pid': tunnel.pid,
                'heartbeat_timeout': heartbeat_timeout,
                'workspace_info': workspace_info,
                'logs': logs,
            })
        except Exception as e:
            _REMOTE_STATE['last_error'] = str(e)
            self.response.json(200, {'ok': False, 'error': str(e), 'logs': logs})
        finally:
            if tmp_dir:
                shutil.rmtree(tmp_dir, ignore_errors=True)
