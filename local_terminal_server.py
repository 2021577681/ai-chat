"""
本地 Agent 服务 - 增强版（带详细日志 + 二进制读取）
启动: python local_terminal_server.py
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import subprocess
import json
import os
import re
import secrets
import base64
import mimetypes
import threading

PORT = 8765
HOST = '127.0.0.1'

# Token 自动生成/加载 —— 放在用户主目录，所有工作区共享
TOKEN_FILE = os.path.join(os.path.expanduser('~'), '.aichat_terminal_token')

def load_or_create_token():
    if os.path.exists(TOKEN_FILE):
        try:
            with open(TOKEN_FILE) as f:
                tk = f.read().strip()
                if tk:
                    return tk
        except Exception:
            pass
    tk = secrets.token_urlsafe(24)
    try:
        with open(TOKEN_FILE, 'w') as f:
            f.write(tk)
        # Unix 上设为仅用户可读
        try:
            os.chmod(TOKEN_FILE, 0o600)
        except Exception:
            pass
    except Exception as e:
        print(f'⚠️  无法写入 token 文件: {e}')
    return tk

TOKEN = load_or_create_token()

# input() 锁（避免多个并发请求同时弹确认）
_INPUT_LOCK = threading.Lock()

current_cwd = os.getcwd()

# ============ 🌐 CORS 策略（已放开）============
# 本项目是纯本地运行，浏览器双击 HTML（Origin=null）也要能用，
# 所以这里直接放行所有 Origin。如果未来要部署成多用户服务，再收紧。
def _is_allowed_origin(origin: str) -> bool:
    return True  # 全部放行

# ============ 🔒 沙箱配置（启动时锁定根目录） ============
# WORKSPACE_ROOT 在启动后不再变化，所有文件操作必须在此目录内
WORKSPACE_ROOT = os.path.realpath(os.getcwd())

# 危险命令黑名单（即使在沙箱内也直接拒绝）
# 采用 "去空格 + 小写" 后的子串匹配 + 正则匹配
import re as _re

DANGEROUS_PATTERNS = [
    # 大规模删除
    (_re.compile(r'\brm\s+(-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)+(/|~|\$home|\*|\.)', _re.IGNORECASE),
        'rm -rf 对根/家目录/通配符'),
    (_re.compile(r'\brm\s+-[a-zA-Z]*[rRfF]', _re.IGNORECASE),
        'rm -rf （强制递归删除，需特别确认）'),
    # Windows 删除
    (_re.compile(r'\b(del|rmdir|rd)\s+/[sSqQ]', _re.IGNORECASE),
        'del/rmdir 强制递归'),
    (_re.compile(r'\bformat\s+[a-zA-Z]:', _re.IGNORECASE),
        'format 磁盘格式化'),
    # 磁盘/系统破坏
    (_re.compile(r'\bmkfs(\.|\s)', _re.IGNORECASE),
        'mkfs 格式化文件系统'),
    (_re.compile(r'\bdd\s+if=.+of=/dev/', _re.IGNORECASE),
        'dd 写入设备文件'),
    (_re.compile(r'>\s*/dev/[shn]d[a-z]', _re.IGNORECASE),
        '重定向写入磁盘设备'),
    # 关机/重启
    (_re.compile(r'\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b', _re.IGNORECASE),
        '关机/重启命令'),
    # Fork 炸弹
    (_re.compile(r':\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:'),
        'fork bomb（:(){ :|:& };:）'),
    # 危险下载执行
    (_re.compile(r'\bcurl\b.*\|\s*(sudo\s+)?(bash|sh|zsh|python|perl)', _re.IGNORECASE),
        'curl | sh（从网络直接执行脚本）'),
    (_re.compile(r'\bwget\b.*\|\s*(sudo\s+)?(bash|sh|zsh|python|perl)', _re.IGNORECASE),
        'wget | sh（从网络直接执行脚本）'),
    # 权限放飞
    (_re.compile(r'\bchmod\s+-?R?\s*777\b', _re.IGNORECASE),
        'chmod 777（开放全权限）'),
    # sudo 整体拦截（个人开发场景一般不该用）
    (_re.compile(r'(^|\s|;|&&|\|\|)\bsudo\b', _re.IGNORECASE),
        'sudo 提权'),
    # ⭐ 防绕过：命令替换 / eval / 间接执行
    (_re.compile(r'\$\([^)]*\b(rm|del|format|mkfs|dd|shutdown|reboot|sudo|chmod\s+777)\b', _re.IGNORECASE),
        '$(...) 命令替换包裹危险命令'),
    (_re.compile(r'`[^`]*\b(rm|del|format|mkfs|dd|shutdown|reboot|sudo)\b', _re.IGNORECASE),
        '反引号命令替换包裹危险命令'),
    (_re.compile(r'\beval\b', _re.IGNORECASE),
        'eval 间接执行（容易绕过黑名单）'),
    (_re.compile(r'\bexec\s+[^\s]', _re.IGNORECASE),
        'exec 替换当前进程'),
    # base64 / hex 解码后管道执行
    (_re.compile(r'\bbase64\s+(-d|--decode|-D)\b.*\|\s*(bash|sh|zsh|python|perl)', _re.IGNORECASE),
        'base64 解码后管道执行'),
    (_re.compile(r'\bxxd\s+-r\b.*\|\s*(bash|sh|zsh)', _re.IGNORECASE),
        'xxd 反向解码后管道执行'),
    # xargs / find -exec 调起 shell
    (_re.compile(r'\bxargs\b[^|;]*\b(bash|sh|zsh|rm)\b', _re.IGNORECASE),
        'xargs 调起 shell/rm'),
    (_re.compile(r'\bfind\b[^;|]*-exec\s+(rm|sh|bash|zsh)\b', _re.IGNORECASE),
        'find -exec 调起 rm/shell'),
    # /dev/tcp 反弹 shell
    (_re.compile(r'/dev/(tcp|udp)/', _re.IGNORECASE),
        '/dev/tcp 反弹 shell'),
    (_re.compile(r'\bnc\b\s+(-[eE]|.*-[eE])', _re.IGNORECASE),
        'nc -e 反弹 shell'),
    # 写入启动项 / cron / authorized_keys
    (_re.compile(r'(authorized_keys|/etc/cron|/etc/passwd|/etc/shadow|/etc/sudoers)', _re.IGNORECASE),
        '写入敏感系统文件（密钥/cron/passwd 等）'),
    (_re.compile(r'(>>?\s*~?/?\.(bashrc|zshrc|profile|bash_profile))', _re.IGNORECASE),
        '写入 shell 启动脚本'),
    # PowerShell 绕过
    (_re.compile(r'\bpowershell\b.*(-enc|-encodedcommand|-nop|-noprofile)', _re.IGNORECASE),
        'powershell 编码命令 / 绕过策略'),
    (_re.compile(r'\b(iex|invoke-expression)\b', _re.IGNORECASE),
        'PowerShell IEX 间接执行'),
]


def is_dangerous_command(cmd):
    """返回 (是否危险, 原因)"""
    for pattern, reason in DANGEROUS_PATTERNS:
        if pattern.search(cmd):
            return True, reason
    return False, ''


def is_inside_workspace(abs_path):
    """检查 abs_path 是否在沙箱根目录内（含 realpath 解析以防 symlink 越狱）"""
    try:
        real = os.path.realpath(abs_path)
    except Exception:
        return False
    try:
        # commonpath 在 Windows 上跨盘符会抛 ValueError
        common = os.path.commonpath([real, WORKSPACE_ROOT])
    except ValueError:
        return False
    return common == WORKSPACE_ROOT


def check_path_or_error(path_str, must_exist=False):
    """
    解析路径 → 校验在沙箱内 → 返回 (绝对路径, 错误字符串或 None)
    """
    abs_path = resolve_path(path_str)
    if not is_inside_workspace(abs_path):
        return abs_path, (
            f'🚫 路径越界：{abs_path}\n'
            f'   沙箱根目录: {WORKSPACE_ROOT}\n'
            f'   AI 只能在沙箱内操作文件。请使用相对路径或沙箱内的绝对路径。'
        )
    if must_exist and not os.path.exists(abs_path):
        return abs_path, f'路径不存在: {abs_path}'
    return abs_path, None


def resolve_path(path):
    """解析路径：相对路径基于 current_cwd，并展开 ~"""
    if not path:
        return current_cwd
    path = os.path.expanduser(path)
    if not os.path.isabs(path):
        path = os.path.abspath(os.path.join(current_cwd, path))
    return path


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f'[{self.log_date_time_string()}] {format % args}')

    def _send_json(self, code, data):
        # 统一在响应里附加沙箱信息，前端可实时显示
        if isinstance(data, dict):
            data.setdefault('workspace', WORKSPACE_ROOT)
            data.setdefault('cwd', current_cwd)
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        # 🌐 CORS 全开：回显请求方 Origin（含 'null'，对应 file:// 双击打开）
        origin = self.headers.get('Origin', '')
        self.send_header('Access-Control-Allow-Origin', origin or '*')
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _write_cors_headers(self, origin):
        """供流式响应等场景手动写 CORS 头"""
        self.send_header('Access-Control-Allow-Origin', origin or '*')
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Expose-Headers', '*')

    def do_OPTIONS(self):
        # 🌐 预检全部放行
        origin = self.headers.get('Origin', '')
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', origin or '*')
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Max-Age', '600')
        self.end_headers()

    def do_GET(self):
        # ⭐ LMS 代理（GET）：把 https://lms.xjtu.edu.cn 的内容透传给前端
        # 用法：GET /lms-proxy?path=/api/todos  Header: X-Token, X-LMS-Cookie
        if self.path.startswith('/lms-proxy'):
            return self.handle_lms_proxy_get()

        # ⭐ /token 路由 —— 浏览器自动拉取 token
        # 本地项目：file:// 双击打开 / localhost 访问，直接发 Token，不再要求终端按 y
        # 其它来源（理论上不会发生在本地项目）才弹终端二次确认
        if self.path == '/token':
            origin = self.headers.get('Origin', '')
            is_local_origin = (
                not origin
                or origin == 'null'  # file:// 双击
                or origin.startswith('http://localhost')
                or origin.startswith('http://127.0.0.1')
                or origin.startswith('https://localhost')
                or origin.startswith('https://127.0.0.1')
            )
            if is_local_origin:
                print(f'🔑 [Token] 自动授权（来源={origin or "file://"}）')
                self._send_json(200, {'ok': True, 'token': TOKEN, 'cwd': current_cwd, 'workspace': WORKSPACE_ROOT})
                return

            # 非本机来源：保留终端确认
            ua = self.headers.get('User-Agent', '(unknown)')
            with _INPUT_LOCK:
                print('\n' + '=' * 60)
                print('🔔 非本机来源在请求 Token')
                print(f'   Origin    : {origin}')
                print(f'   User-Agent: {ua[:80]}')
                print(f'   Client IP : {self.client_address[0]}')
                print('=' * 60)
                try:
                    ans = input('是否授权？输入 y 同意 > ').strip().lower()
                except EOFError:
                    ans = ''
            if ans != 'y':
                self._send_json(403, {'ok': False, 'error': '用户在终端拒绝授权'})
                return
            self._send_json(200, {'ok': True, 'token': TOKEN, 'cwd': current_cwd, 'workspace': WORKSPACE_ROOT})
            return

        # ⭐ /workspace 路由 —— 返回沙箱信息（不含 token），公开可访问
        if self.path == '/workspace':
            self._send_json(200, {
                'ok': True,
                'workspace': WORKSPACE_ROOT,
                'cwd': current_cwd
            })
            return

        # /health 显式健康检查
        if self.path == '/health':
            self._send_json(200, {'ok': True, 'cwd': current_cwd, 'workspace': WORKSPACE_ROOT})
            return

        # 静态文件（http://localhost:8765/ 可直接打开 HTML）
        return self.handle_static_file()

    def handle_static_file(self):
        """安全的静态文件服务（只允许放出白名单扩展名，禁止越权）"""
        from urllib.parse import urlparse, unquote
        path = urlparse(self.path).path
        # 默认首页：找当前目录下唯一的 HTML（或固定文件名）
        if path == '/' or path == '':
            # 优先精确匹配，否则取目录里第一个 .html
            preferred = 'AI-Chat-大模型对话助手.html'
            script_dir = os.path.dirname(os.path.abspath(__file__))
            target = os.path.join(script_dir, preferred)
            if not os.path.isfile(target):
                htmls = [f for f in os.listdir(script_dir) if f.lower().endswith('.html')]
                if not htmls:
                    self._send_json(404, {'ok': False, 'error': '未找到任何 HTML 文件'})
                    return
                target = os.path.join(script_dir, htmls[0])
        else:
            # 去掉前导斜杠，做 URL 解码（中文文件名）
            rel = unquote(path.lstrip('/'))
            script_dir = os.path.dirname(os.path.abspath(__file__))
            target = os.path.realpath(os.path.join(script_dir, rel))
            # 不能跳出脚本所在目录
            if not target.startswith(os.path.realpath(script_dir)):
                self._send_json(403, {'ok': False, 'error': '路径越界'})
                return

        # 白名单扩展名（只放出网页相关的，避免无意中暴露 .py / .token 等敏感文件）
        ALLOWED_EXTS = {
            '.html', '.htm', '.js', '.css', '.json', '.svg',
            '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
            '.woff', '.woff2', '.ttf', '.map', '.txt', '.md'
        }
        ext = os.path.splitext(target)[1].lower()
        if ext not in ALLOWED_EXTS:
            self._send_json(403, {'ok': False, 'error': f'不允许的文件类型: {ext}'})
            return

        if not os.path.isfile(target):
            self._send_json(404, {'ok': False, 'error': f'文件不存在: {path}'})
            return

        # 推断 Content-Type
        ctype, _ = mimetypes.guess_type(target)
        if not ctype:
            ctype = 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/javascript', 'application/json'):
            ctype = ctype + '; charset=utf-8'

        try:
            with open(target, 'rb') as f:
                data = f.read()
        except Exception as e:
            self._send_json(500, {'ok': False, 'error': f'读取失败: {e}'})
            return

        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        # 同源时 CORS 不强制，但带上无害
        origin = self.headers.get('Origin', '')
        if _is_allowed_origin(origin) and origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        # 开发体验：禁缓存，避免改完 JS 浏览器吃旧版
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.end_headers()
        try: self.wfile.write(data)
        except Exception: pass

    def do_POST(self):
        # ⭐ LLM 代理（POST）：把浏览器无法直连的 LLM 中转商请求服务端透传
        # 用法：POST /llm-proxy
        #   Header: X-Token（本地服务鉴权）, X-Target-Url（目标 URL）,
        #           X-Target-Headers（JSON 字符串，会作为 headers 转发给目标）
        #   Body  : 原样转发
        # 之所以单独走这条路：浏览器对 file:// 打开的 HTML 跨域到 https://xxx 时，
        # 若服务商没返回 Access-Control-Allow-Origin 就会被浏览器拦截（你遇到的就是这个）。
        # 通过本地服务转发，浏览器只跨域到 localhost（白名单已放行），服务器到服务器没有 CORS 限制。
        if self.path.startswith('/llm-proxy'):
            return self.handle_llm_proxy_post()

        # 鉴权
        token = self.headers.get('X-Token', '')
        if token != TOKEN:
            self._send_json(403, {'ok': False, 'error': 'Token 错误'})
            return

        # 读请求
        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length).decode('utf-8')
            body = json.loads(raw)
        except Exception as e:
            self._send_json(400, {'ok': False, 'error': f'请求格式错误: {e}'})
            return

        # 调试日志
        action = body.get('action', 'execute')
        print(f'\n{"="*60}')
        print(f'📥 收到请求: action="{action}"')
        # 二进制读取请求不打印 base64 内容
        if action != 'read_file_binary':
            print(f'📦 完整请求体: {json.dumps(body, ensure_ascii=False)[:500]}')
        else:
            print(f'📦 请求体: action=read_file_binary, path={body.get("path", "")}')
        print(f'{"="*60}')

        try:
            if action == 'execute':
                self.handle_execute(body)
            elif action == 'read_file':
                self.handle_read_file(body)
            elif action == 'read_file_binary':
                self.handle_read_file_binary(body)
            elif action == 'write_file':
                self.handle_write_file(body)
            elif action == 'append_file':
                self.handle_append_file(body)
            elif action == 'edit_file':
                self.handle_edit_file(body)
            elif action == 'delete_file':
                self.handle_delete_file(body)
            elif action == 'list_dir':
                self.handle_list_dir(body)
            elif action == 'search':
                self.handle_search(body)
            elif action == 'web_search':
                self.handle_web_search(body)
            elif action == 'fetch_url':
                self.handle_fetch_url(body)
            elif action == 'file_info':
                self.handle_file_info(body)
            elif action == 'git':
                self.handle_git(body)
            else:
                self._send_json(400, {'ok': False, 'error': f'❌ 未知操作: {action}'})
        except Exception as e:
            self._send_json(500, {'ok': False, 'error': f'内部错误: {e}'})

    # ============ 执行命令 ============
    def handle_execute(self, body):
        global current_cwd
        command = body.get('command', '').strip()
        cwd = body.get('cwd') or current_cwd
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
                'error': f'🚫 工作目录越界：{cwd_abs}\n沙箱根: {WORKSPACE_ROOT}'
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
                        f'   沙箱根: {WORKSPACE_ROOT}\n'
                        f'   你只能在沙箱内切换目录。'
                    )
                })
            current_cwd = new_cwd
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
            size = os.path.getsize(path)
            if size > 1024 * 1024:
                return self._send_json(200, {
                    'ok': False,
                    'error': f'文件过大（{size}字节）。如果是图片/PDF，请用 attach_file 工具。'
                })
            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
            start_line = body.get('start_line')
            end_line = body.get('end_line')
            if start_line or end_line:
                lines = content.split('\n')
                s = max(1, int(start_line or 1)) - 1
                e = min(len(lines), int(end_line or len(lines)))
                content = '\n'.join(lines[s:e])
            self._send_json(200, {'ok': True, 'path': path, 'content': content, 'size': size})
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': str(e)})

    # ⭐ 新增：读文件（二进制 → base64）
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
            # 限制大小
            max_size = 20 * 1024 * 1024
            if size > max_size:
                return self._send_json(200, {
                    'ok': False,
                    'error': f'文件过大（{size / 1024 / 1024:.1f}MB），上限 {max_size / 1024 / 1024:.0f}MB'
                })
            
            # 读取并 base64 编码
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
                'data': f'data:{mime};base64,{b64}'  # 完整的 data URL
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
        import fnmatch
        import re
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

    # ============ 🌐 网络搜索（多引擎五级回退）============
    def handle_web_search(self, body):
        """网页搜索，返回标题 + URL + 摘要列表。不需要任何 API Key。

        引擎按可用性排序（自动回退）：
          1. Bing 国内 (cn.bing.com)   — 默认主力
          2. 搜狗 (sogou.com)          — 裸访问，结构稳定
          3. 360 (so.com)              — 裸访问，有 data-mdurl 直接拿真实 URL
          4. 百度 (baidu.com)          — 需先访问首页拿 Cookie
          5. Bing 国际 (www.bing.com)  — 兜底，海外内容更全

        region:
          - 'cn' / 'cn-zh' / 'zh-cn' / 缺省 → 国内引擎优先
          - 'global' / 'us-en' / 'wt-wt' / 'en' → Bing 国际优先
        """
        import re
        from html import unescape
        from urllib.parse import quote_plus

        query = (body.get('query') or '').strip()
        max_results = min(int(body.get('max_results', 8)), 20)
        region = (body.get('region') or 'cn').lower()

        if not query:
            return self._send_json(200, {'ok': False, 'error': 'query 不能为空'})

        print(f'🌐 [网络搜索] "{query}" (max={max_results}, region={region})')

        try:
            import requests
        except ImportError:
            return self._send_json(200, {'ok': False, 'error': '后端缺少 requests 模块，请运行：pip install requests'})

        UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
        BASE_HEADERS = {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            # ⭐ 不要写 br！requests 默认不支持 Brotli 解压，会拿到二进制乱码
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }

        # 通用工具：去 HTML 标签 + HTML 实体解码 + 折叠空白
        def _clean(s):
            if not s:
                return ''
            s = re.sub(r'<[^>]+>', '', s)
            s = unescape(s)
            s = re.sub(r'\s+', ' ', s).strip()
            return s

        # ===== Bing 国内 / 国际版 =====
        def search_bing(base_url, mkt='zh-CN'):
            url = f'{base_url}/search?q={quote_plus(query)}&mkt={mkt}&count={max_results}'
            resp = requests.get(url, headers=BASE_HEADERS, timeout=10)
            html = resp.text
            out = []
            # 找每个 <li class="b_algo ...">...</li> 块（注意多了 data-id iid=SERP.xxx 等属性）
            for m in re.finditer(
                r'<li[^>]*\bclass="[^"]*b_algo[^"]*"[^>]*>(.*?)</li>',
                html, flags=re.S
            ):
                block = m.group(1)
                # 标题块：<h2 ...><a ... href="URL" ...>Title</a></h2>
                tm = re.search(r'<h2[^>]*>\s*<a[^>]*\shref="([^"]+)"[^>]*>(.*?)</a>',
                               block, flags=re.S)
                if not tm:
                    continue
                raw_url, raw_title = tm.group(1), tm.group(2)
                if not raw_url.startswith('http'):
                    continue
                # 摘要：<p ... class="b_lineclamp...">snippet</p>  或 <div class="b_caption">...<p>snippet</p>
                sm = re.search(r'<p[^>]*\bclass="[^"]*b_lineclamp[^"]*"[^>]*>(.*?)</p>',
                               block, flags=re.S)
                if not sm:
                    sm = re.search(r'<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>.*?<p[^>]*>(.*?)</p>',
                                   block, flags=re.S)
                snippet = _clean(sm.group(1)) if sm else ''
                title = _clean(raw_title)
                if title:
                    out.append({'title': title, 'url': raw_url, 'snippet': snippet})
                if len(out) >= max_results:
                    break
            return out

        # ===== 搜狗 =====
        def search_sogou():
            url = f'https://www.sogou.com/web?query={quote_plus(query)}'
            resp = requests.get(url, headers=BASE_HEADERS, timeout=10)
            html = resp.text
            out = []
            # 标题 class 兼容：pt（中文 query）/ vr-title（英文 query）
            # 共同特征：<a name="dttl" ... href="/link?url=xxx" ...>title</a>
            for tm in re.finditer(
                r'<h3[^>]*\bclass="(?:pt|vr-title)"[^>]*>\s*(?:<!--[^>]*-->)?\s*<a[^>]*\sname="dttl"[^>]*\shref="([^"]+)"[^>]*>(.*?)</a>',
                html, flags=re.S
            ):
                raw_url, raw_title = tm.group(1), tm.group(2)
                if raw_url.startswith('/'):
                    raw_url = 'https://www.sogou.com' + raw_url
                elif not raw_url.startswith('http'):
                    continue
                # 摘要兼容多种 class：ft / fz-mid / text-layout
                tail = html[tm.end():tm.end() + 3500]
                sm = re.search(r'<div[^>]*\bclass="[^"]*\b(?:ft|fz-mid|space-txt|str_info|str-text-info)[^"]*"[^>]*>(.*?)</div>',
                               tail, flags=re.S)
                if not sm:
                    sm = re.search(r'<div[^>]*\bclass="text-layout"[^>]*>.*?<p[^>]*>(.*?)</p>',
                                   tail, flags=re.S)
                snippet = _clean(sm.group(1)) if sm else ''
                title = _clean(raw_title)
                if title:
                    out.append({'title': title, 'url': raw_url, 'snippet': snippet})
                if len(out) >= max_results:
                    break
            return out

        # ===== 360 =====
        def search_360():
            url = f'https://www.so.com/s?q={quote_plus(query)}'
            resp = requests.get(url, headers=BASE_HEADERS, timeout=10)
            html = resp.text
            out = []
            # 标题：<h3 class="res-title ..."><a href="跳转URL" data-mdurl="真实URL" ...>title</a></h3>
            # 360 的 data-mdurl 直接给真实 URL，最方便
            for tm in re.finditer(
                r'<h3[^>]*\bclass="[^"]*res-title[^"]*"[^>]*>\s*<a([^>]+)>(.*?)</a>',
                html, flags=re.S
            ):
                a_attrs, raw_title = tm.group(1), tm.group(2)
                # 优先 data-mdurl，没有再退 href
                mu = re.search(r'\bdata-mdurl="([^"]+)"', a_attrs)
                if mu:
                    real_url = mu.group(1)
                else:
                    hm = re.search(r'\shref="([^"]+)"', a_attrs)
                    if not hm:
                        continue
                    real_url = hm.group(1)
                if not real_url.startswith('http'):
                    continue
                # 摘要：标题后 ~3000 字内的 <p class="res-desc"> 或 <div class="res-rich-desc">
                tail = html[tm.end():tm.end() + 3000]
                sm = re.search(r'<p[^>]*\bclass="[^"]*res-desc[^"]*"[^>]*>(.*?)</p>',
                               tail, flags=re.S)
                if not sm:
                    sm = re.search(r'<div[^>]*\bclass="[^"]*res-rich-desc[^"]*"[^>]*>(.*?)</div>',
                                   tail, flags=re.S)
                if not sm:
                    sm = re.search(r'<p[^>]*\bclass="[^"]*res-comm-con[^"]*"[^>]*>(.*?)</p>',
                                   tail, flags=re.S)
                snippet = _clean(sm.group(1)) if sm else ''
                title = _clean(raw_title)
                if title:
                    out.append({'title': title, 'url': real_url, 'snippet': snippet})
                if len(out) >= max_results:
                    break
            return out

        # ===== 百度（必须先拿 Cookie）=====
        def search_baidu():
            sess = requests.Session()
            sess.headers.update(BASE_HEADERS)
            # 先访问首页种 Cookie（BAIDUID 等），否则只返回 1.4KB 反爬页
            try:
                sess.get('https://www.baidu.com/', timeout=5)
            except Exception:
                pass  # 首页失败也继续试，反正坏不到哪去
            url = f'https://www.baidu.com/s?wd={quote_plus(query)}&rn={max_results}'
            resp = sess.get(url, timeout=10, headers={'Referer': 'https://www.baidu.com/'})
            html = resp.text
            out = []
            # 百度新结构：<h3 class="t ... title_xxx ..."><a ... href="http://www.baidu.com/link?url=xxx" ...>
            # 标题文本可能在 <!--s-text-->...<!--/s-text--> 里
            for tm in re.finditer(
                r'<h3[^>]*\bclass="[^"]*\bt\b[^"]*"[^>]*>\s*<a[^>]*\shref="(https?://[^"]*baidu\.com/link\?[^"]+)"[^>]*>(.*?)</a>\s*</h3>',
                html, flags=re.S
            ):
                raw_url, raw_title = tm.group(1), tm.group(2)
                # 摘要找 <span class="content-right_..."> 或 <span ... data-module="abstract">
                tail = html[tm.end():tm.end() + 4000]
                sm = re.search(r'<span[^>]*\bclass="[^"]*content-right[^"]*"[^>]*>(.*?)</span>',
                               tail, flags=re.S)
                if not sm:
                    sm = re.search(r'<div[^>]*\bclass="[^"]*c-abstract[^"]*"[^>]*>(.*?)</div>',
                                   tail, flags=re.S)
                if not sm:
                    sm = re.search(r'<span[^>]*\bdata-module="abstract"[^>]*>(.*?)</span>',
                                   tail, flags=re.S)
                snippet = _clean(sm.group(1)) if sm else ''
                title = _clean(raw_title)
                if title:
                    out.append({'title': title, 'url': raw_url, 'snippet': snippet})
                if len(out) >= max_results:
                    break
            return out

        # ===== 按 region 决定回退顺序 =====
        # 顺序按可靠性：bing-cn 最稳 → 360 次之 → sogou → 百度（易风控放最后）→ bing-global 兜底
        if region in ('global', 'us-en', 'wt-wt', 'en'):
            engines = [
                ('bing-global', lambda: search_bing('https://www.bing.com', 'en-US')),
                ('bing-cn',     lambda: search_bing('https://cn.bing.com',  'zh-CN')),
                ('360',         search_360),
                ('sogou',       search_sogou),
            ]
        else:  # cn / 缺省
            engines = [
                ('bing-cn',     lambda: search_bing('https://cn.bing.com',  'zh-CN')),
                ('360',         search_360),
                ('sogou',       search_sogou),
                ('bing-global', lambda: search_bing('https://www.bing.com', 'zh-CN')),
                ('baidu',       search_baidu),  # 易触发"百度安全验证"，放最后兜底
            ]

        # ===== 逐个尝试 =====
        errors = []
        for name, fn in engines:
            try:
                results = fn()
                if results:
                    print(f'✅ [网络搜索] {name} 命中 {len(results)} 条')
                    return self._send_json(200, {
                        'ok': True,
                        'query': query,
                        'engine': name,
                        'count': len(results),
                        'results': results
                    })
                else:
                    errors.append(f'{name}: 0 条结果')
                    print(f'⚠️ [网络搜索] {name} 无结果')
            except Exception as e:
                errors.append(f'{name}: {type(e).__name__}')
                print(f'⚠️ [网络搜索] {name} 失败: {e}')

        return self._send_json(200, {
            'ok': False,
            'error': f'所有搜索引擎都未返回结果。{" | ".join(errors)}'
        })

    # ============ 🌐 抓取网页正文 ============
    def handle_fetch_url(self, body):
        """抓取指定 URL 的文本/HTML，可选择提取正文（去除 script/style/导航）。
        """
        import re
        from html import unescape

        url = (body.get('url') or '').strip()
        extract_text = body.get('extract_text', True)  # 默认提取纯文本
        max_chars = min(int(body.get('max_chars', 8000)), 50000)

        if not url:
            return self._send_json(200, {'ok': False, 'error': 'url 不能为空'})
        if not (url.startswith('http://') or url.startswith('https://')):
            return self._send_json(200, {'ok': False, 'error': 'URL 必须以 http:// 或 https:// 开头'})

        print(f'🌐 [抓取] {url}  extract={extract_text}')

        try:
            import requests
        except ImportError:
            return self._send_json(200, {'ok': False, 'error': '后端缺少 requests 模块，请运行：pip install requests'})

        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                              '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            }
            resp = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
            content_type = resp.headers.get('content-type', '')
            # requests 通常能自动识别编码，但中文站点偶尔不准 → 用 apparent_encoding 兜底
            if not resp.encoding or resp.encoding.lower() == 'iso-8859-1':
                resp.encoding = resp.apparent_encoding or 'utf-8'
            raw = resp.text

            if not extract_text or 'text/html' not in content_type.lower():
                # 非 HTML 或用户明确不提取：直接返回原文（截断）
                truncated = raw[:max_chars]
                self._send_json(200, {
                    'ok': True,
                    'url': resp.url,
                    'status': resp.status_code,
                    'content_type': content_type,
                    'length': len(raw),
                    'content': truncated,
                    'truncated': len(raw) > max_chars
                })
                return

            # —— 提取 HTML 正文 ——
            text = raw
            # 1) 干掉 script/style/noscript
            text = re.sub(r'<script\b[^>]*>.*?</script>', ' ', text, flags=re.S | re.I)
            text = re.sub(r'<style\b[^>]*>.*?</style>', ' ', text, flags=re.S | re.I)
            text = re.sub(r'<noscript\b[^>]*>.*?</noscript>', ' ', text, flags=re.S | re.I)
            # 2) 提取标题
            title_m = re.search(r'<title[^>]*>(.*?)</title>', text, flags=re.S | re.I)
            title = unescape(re.sub(r'\s+', ' ', title_m.group(1)).strip()) if title_m else ''
            # 3) 块级标签换行，便于段落分隔
            text = re.sub(r'</?(p|div|li|tr|h[1-6]|br|hr|article|section)[^>]*>', '\n', text, flags=re.I)
            # 4) 去掉所有剩余标签
            text = re.sub(r'<[^>]+>', '', text)
            # 5) 解码 HTML 实体
            text = unescape(text)
            # 6) 合并空白
            text = re.sub(r'[ \t\r\f\v]+', ' ', text)
            text = re.sub(r'\n\s*\n+', '\n\n', text).strip()

            truncated_text = text[:max_chars]
            self._send_json(200, {
                'ok': True,
                'url': resp.url,
                'status': resp.status_code,
                'title': title,
                'length': len(text),
                'content': truncated_text,
                'truncated': len(text) > max_chars
            })
        except Exception as e:
            self._send_json(200, {'ok': False, 'error': f'抓取失败：{e}'})

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

    # ============ 🌿 Git 集成（Phase 1+2：含回退/分支/远程/敏感扫描）============
    def handle_git(self, body):
        """统一的 Git 入口，子命令分发。
        所有 git 命令强制在沙箱根目录或其子目录执行。

        body = {
          subcommand: 'status' | 'log' | 'diff' | 'add' | 'unstage' | 'commit' |
                      'checkout_file' | 'init' | 'config_get' | 'config_set' | 'check',
          ... 子命令各自的参数
        }
        """
        sub = body.get('subcommand') or body.get('sub') or ''
        # 白名单（防止任意 git 命令注入）
        ALLOWED = {
            'check', 'status', 'log', 'diff', 'add', 'unstage', 'commit',
            'checkout_file', 'init', 'config_get', 'config_set',
            'branch_list', 'branch_create', 'branch_switch',
            # —— Phase 2 ——
            'revert', 'reset_mixed', 'reset_hard',
            'branch_delete', 'branch_rename',
            'remote_list', 'remote_add', 'remote_remove', 'remote_set_url',
            'push', 'pull', 'fetch',
            'scan_diff',  # 推送前敏感信息扫描
        }
        if sub not in ALLOWED:
            return self._send_json(200, {'ok': False, 'error': f'未知 git 子命令: {sub}'})

        # 工作目录：默认沙箱根
        cwd_param = body.get('cwd') or WORKSPACE_ROOT
        cwd_abs = resolve_path(cwd_param) if not os.path.isabs(cwd_param) else os.path.expanduser(cwd_param)
        if not is_inside_workspace(cwd_abs):
            return self._send_json(200, {'ok': False, 'error': f'🚫 cwd 越界：{cwd_abs}\n沙箱根: {WORKSPACE_ROOT}'})
        if not os.path.isdir(cwd_abs):
            return self._send_json(200, {'ok': False, 'error': f'目录不存在: {cwd_abs}'})

        try:
            # ===== check: 仅探测 git 是否可用 + 是否在仓库内 =====
            if sub == 'check':
                git_ver = self._git_run(['git', '--version'], cwd_abs, timeout=5)
                if not git_ver['ok']:
                    return self._send_json(200, {
                        'ok': False,
                        'gitInstalled': False,
                        'error': '系统未安装 Git，或不在 PATH 中。请先安装 Git：https://git-scm.com/'
                    })
                in_repo = self._git_run(['git', 'rev-parse', '--is-inside-work-tree'], cwd_abs, timeout=5)
                if in_repo['ok'] and in_repo['stdout'].strip() == 'true':
                    top = self._git_run(['git', 'rev-parse', '--show-toplevel'], cwd_abs, timeout=5)
                    branch = self._git_run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd_abs, timeout=5)
                    user_name = self._git_run(['git', 'config', '--get', 'user.name'], cwd_abs, timeout=5)
                    user_email = self._git_run(['git', 'config', '--get', 'user.email'], cwd_abs, timeout=5)
                    return self._send_json(200, {
                        'ok': True,
                        'gitInstalled': True,
                        'inRepo': True,
                        'version': git_ver['stdout'].strip(),
                        'topLevel': top['stdout'].strip(),
                        'branch': branch['stdout'].strip() if branch['ok'] else '',
                        'userName': user_name['stdout'].strip() if user_name['ok'] else '',
                        'userEmail': user_email['stdout'].strip() if user_email['ok'] else '',
                    })
                return self._send_json(200, {
                    'ok': True,
                    'gitInstalled': True,
                    'inRepo': False,
                    'version': git_ver['stdout'].strip(),
                })

            # ===== init: 初始化仓库 =====
            if sub == 'init':
                if os.path.isdir(os.path.join(cwd_abs, '.git')):
                    return self._send_json(200, {'ok': False, 'error': '此目录已是 Git 仓库'})
                r = self._git_run(['git', 'init'], cwd_abs, timeout=15)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                # 顺便配 user.name / user.email（如果传了）
                uname = (body.get('userName') or '').strip()
                uemail = (body.get('userEmail') or '').strip()
                if uname:
                    self._git_run(['git', 'config', 'user.name', uname], cwd_abs, timeout=5)
                if uemail:
                    self._git_run(['git', 'config', 'user.email', uemail], cwd_abs, timeout=5)
                # 可选：写 .gitignore
                if body.get('createGitignore'):
                    gi_path = os.path.join(cwd_abs, '.gitignore')
                    if not os.path.exists(gi_path):
                        try:
                            with open(gi_path, 'w', encoding='utf-8') as f:
                                f.write(self._default_gitignore())
                        except Exception:
                            pass
                # 可选：初始提交
                if body.get('createInitialCommit'):
                    self._git_run(['git', 'add', '.'], cwd_abs, timeout=30)
                    self._git_run(['git', 'commit', '-m', body.get('initialCommitMessage') or 'Initial commit'], cwd_abs, timeout=15)
                return self._send_json(200, {'ok': True, 'message': '✅ Git 仓库已初始化'})

            # ===== config_get / config_set =====
            if sub == 'config_get':
                key = body.get('key', '')
                if not key:
                    return self._send_json(200, {'ok': False, 'error': '缺少 key'})
                r = self._git_run(['git', 'config', '--get', key], cwd_abs, timeout=5)
                return self._send_json(200, {'ok': True, 'value': r['stdout'].strip() if r['ok'] else ''})
            if sub == 'config_set':
                key = body.get('key', '')
                value = body.get('value', '')
                if not key:
                    return self._send_json(200, {'ok': False, 'error': '缺少 key'})
                r = self._git_run(['git', 'config', key, value], cwd_abs, timeout=5)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True})

            # —— 以下子命令都要求已在仓库内 ——
            in_repo = self._git_run(['git', 'rev-parse', '--is-inside-work-tree'], cwd_abs, timeout=5)
            if not (in_repo['ok'] and in_repo['stdout'].strip() == 'true'):
                return self._send_json(200, {'ok': False, 'error': '当前目录不是 Git 仓库（请先初始化）'})

            # ===== status =====
            if sub == 'status':
                # --porcelain=v1 -b 给出分支信息 + 文件状态
                r = self._git_run(['git', 'status', '--porcelain=v1', '-b', '--untracked-files=all'], cwd_abs, timeout=10)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                lines = r['stdout'].splitlines()
                branch = ''
                ahead = behind = 0
                staged = []      # 已暂存
                unstaged = []    # 未暂存
                untracked = []   # 未跟踪
                for line in lines:
                    if line.startswith('##'):
                        # ## main...origin/main [ahead 1, behind 2]
                        rest = line[3:].strip()
                        m = re.match(r'^([^.]+?)(?:\.\.\.([^\s]+))?(?:\s+\[(.+)\])?$', rest)
                        if m:
                            branch = m.group(1)
                            extras = m.group(3) or ''
                            am = re.search(r'ahead\s+(\d+)', extras)
                            bm = re.search(r'behind\s+(\d+)', extras)
                            ahead = int(am.group(1)) if am else 0
                            behind = int(bm.group(1)) if bm else 0
                        continue
                    if len(line) < 3:
                        continue
                    x, y, path = line[0], line[1], line[3:]
                    # 处理 rename: "R  old -> new"
                    if ' -> ' in path:
                        path = path.split(' -> ', 1)[1]
                    # 去引号
                    if path.startswith('"') and path.endswith('"'):
                        path = path[1:-1]
                    if x == '?' and y == '?':
                        untracked.append({'path': path, 'status': '?'})
                    else:
                        if x != ' ' and x != '?':
                            staged.append({'path': path, 'status': x})
                        if y != ' ' and y != '?':
                            unstaged.append({'path': path, 'status': y})
                return self._send_json(200, {
                    'ok': True,
                    'branch': branch, 'ahead': ahead, 'behind': behind,
                    'staged': staged, 'unstaged': unstaged, 'untracked': untracked,
                    'clean': not (staged or unstaged or untracked),
                })

            # ===== log =====
            if sub == 'log':
                limit = max(1, min(int(body.get('limit', 50)), 500))
                # 用 \x1f 作字段分隔，\x1e 作记录分隔（避免和提交信息冲突）
                fmt = '%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1e'
                cmd = ['git', 'log', f'--max-count={limit}', f'--format={fmt}']
                if body.get('file'):
                    cmd += ['--', body.get('file')]
                r = self._git_run(cmd, cwd_abs, timeout=15)
                if not r['ok']:
                    # 没有任何提交时 git log 会报错
                    if 'does not have any commits' in (r['stderr'] or '') or 'bad default revision' in (r['stderr'] or ''):
                        return self._send_json(200, {'ok': True, 'commits': []})
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                commits = []
                for rec in r['stdout'].split('\x1e'):
                    rec = rec.strip('\n\r')
                    if not rec:
                        continue
                    parts = rec.split('\x1f')
                    if len(parts) < 6:
                        continue
                    commits.append({
                        'hash': parts[0],
                        'shortHash': parts[1],
                        'author': parts[2],
                        'email': parts[3],
                        'ts': int(parts[4]) if parts[4].isdigit() else 0,
                        'subject': parts[5],
                    })
                return self._send_json(200, {'ok': True, 'commits': commits})

            # ===== diff =====
            if sub == 'diff':
                mode = body.get('mode', 'working')   # working / staged / commit
                file = body.get('file')              # 可选：限制单文件
                if mode == 'commit':
                    commit = body.get('commit', '')
                    if not commit or not re.match(r'^[0-9a-f]{4,40}$', commit):
                        return self._send_json(200, {'ok': False, 'error': '无效的 commit hash'})
                    cmd = ['git', 'show', '--format=fuller', commit]
                    if file:
                        cmd += ['--', file]
                elif mode == 'staged':
                    cmd = ['git', 'diff', '--cached']
                    if file: cmd += ['--', file]
                else:  # working
                    cmd = ['git', 'diff']
                    if file: cmd += ['--', file]
                # 对未跟踪文件，git diff 拿不到内容；前端会单独处理
                r = self._git_run(cmd, cwd_abs, timeout=15, max_output=2 * 1024 * 1024)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True, 'diff': r['stdout'], 'mode': mode, 'file': file})

            # ===== add / unstage =====
            if sub == 'add':
                files = body.get('files') or []
                if not isinstance(files, list) or not files:
                    return self._send_json(200, {'ok': False, 'error': '需要 files 数组'})
                # 用 -- 防止路径被当 flag
                cmd = ['git', 'add', '--'] + files
                r = self._git_run(cmd, cwd_abs, timeout=30)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True})
            if sub == 'unstage':
                files = body.get('files') or []
                if not isinstance(files, list) or not files:
                    return self._send_json(200, {'ok': False, 'error': '需要 files 数组'})
                cmd = ['git', 'reset', 'HEAD', '--'] + files
                r = self._git_run(cmd, cwd_abs, timeout=15)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True})

            # ===== commit =====
            if sub == 'commit':
                msg = (body.get('message') or '').strip()
                if not msg:
                    return self._send_json(200, {'ok': False, 'error': '提交信息不能为空'})
                cmd = ['git', 'commit', '-m', msg]
                # 允许传 all=true 等价于 git commit -a
                if body.get('all'):
                    cmd.insert(2, '-a')
                r = self._git_run(cmd, cwd_abs, timeout=20)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True, 'output': r['stdout']})

            # ===== checkout_file: 把单个文件回退到 HEAD（或指定 commit）的版本 =====
            if sub == 'checkout_file':
                files = body.get('files') or []
                if not isinstance(files, list) or not files:
                    return self._send_json(200, {'ok': False, 'error': '需要 files 数组'})
                commit = body.get('commit') or 'HEAD'
                if commit != 'HEAD' and not re.match(r'^[0-9a-f]{4,40}$', commit):
                    return self._send_json(200, {'ok': False, 'error': '无效的 commit hash'})
                cmd = ['git', 'checkout', commit, '--'] + files
                r = self._git_run(cmd, cwd_abs, timeout=15)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True})

            # ===== show_file: 校验某 commit 中存在某文件（只读探测，用于 AI 工具的 restore 前置校验）=====
            if sub == 'show_file':
                commit = body.get('commit') or 'HEAD'
                path = body.get('path') or ''
                if commit != 'HEAD' and not re.match(r'^[0-9a-f]{4,40}$', commit):
                    return self._send_json(200, {'ok': False, 'error': '无效的 commit hash'})
                if not path or '..' in path.split('/') or path.startswith('/'):
                    return self._send_json(200, {'ok': False, 'error': '无效的文件路径'})
                # 用 git cat-file -e <commit>:<path> 探测是否存在（不读内容，省内存）
                r = self._git_run(['git', 'cat-file', '-e', f'{commit}:{path}'], cwd_abs, timeout=5)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': '在指定快照中找不到该文件'})
                return self._send_json(200, {'ok': True, 'exists': True})

            # ===== 分支 =====
            if sub == 'branch_list':
                r = self._git_run(['git', 'branch', '--list', '--format=%(refname:short)|%(HEAD)|%(upstream:short)'], cwd_abs, timeout=10)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                branches = []
                for line in r['stdout'].splitlines():
                    parts = line.split('|')
                    if not parts[0]: continue
                    branches.append({
                        'name': parts[0],
                        'current': len(parts) > 1 and parts[1].strip() == '*',
                        'upstream': parts[2] if len(parts) > 2 else '',
                    })
                return self._send_json(200, {'ok': True, 'branches': branches})

            if sub == 'branch_create':
                name = (body.get('name') or '').strip()
                if not name or not re.match(r'^[A-Za-z0-9_\-./]+$', name):
                    return self._send_json(200, {'ok': False, 'error': '分支名只能包含字母数字 _ - . /'})
                # 用 checkout -b 创建并切换
                r = self._git_run(['git', 'checkout', '-b', name], cwd_abs, timeout=10)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True})

            if sub == 'branch_switch':
                name = (body.get('name') or '').strip()
                if not name or not re.match(r'^[A-Za-z0-9_\-./]+$', name):
                    return self._send_json(200, {'ok': False, 'error': '无效的分支名'})
                r = self._git_run(['git', 'checkout', name], cwd_abs, timeout=10)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True})

            # ========== Phase 2：版本回退 ==========
            if sub == 'revert':
                commit = (body.get('commit') or '').strip()
                if not re.match(r'^[0-9a-f]{4,40}$', commit):
                    return self._send_json(200, {'ok': False, 'error': '无效的 commit hash'})
                # --no-edit 避免打开编辑器；--no-commit=False 直接生成反向 commit
                r = self._git_run(['git', 'revert', '--no-edit', commit], cwd_abs, timeout=20)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True, 'output': r['stdout']})

            if sub == 'reset_mixed':
                commit = (body.get('commit') or '').strip()
                if not re.match(r'^[0-9a-f]{4,40}$', commit):
                    return self._send_json(200, {'ok': False, 'error': '无效的 commit hash'})
                r = self._git_run(['git', 'reset', '--mixed', commit], cwd_abs, timeout=20)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True, 'output': r['stdout']})

            if sub == 'reset_hard':
                commit = (body.get('commit') or '').strip()
                if not re.match(r'^[0-9a-f]{4,40}$', commit):
                    return self._send_json(200, {'ok': False, 'error': '无效的 commit hash'})
                # 危险操作 —— 服务器端再强制要求 confirm 标志
                if body.get('confirm') != '我确定':
                    return self._send_json(200, {'ok': False, 'error': '需要确认（confirm="我确定"）'})
                r = self._git_run(['git', 'reset', '--hard', commit], cwd_abs, timeout=20)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True, 'output': r['stdout']})

            # ========== Phase 2：分支删除/重命名 ==========
            if sub == 'branch_delete':
                name = (body.get('name') or '').strip()
                if not name or not re.match(r'^[A-Za-z0-9_\-./]+$', name):
                    return self._send_json(200, {'ok': False, 'error': '无效的分支名'})
                force = bool(body.get('force'))
                # 强制删除时要求确认
                if force and body.get('confirm') != '我确定':
                    return self._send_json(200, {'ok': False, 'error': '强制删除需要确认（confirm="我确定"）'})
                flag = '-D' if force else '-d'
                r = self._git_run(['git', 'branch', flag, name], cwd_abs, timeout=10)
                if not r['ok']:
                    err = r['stderr'] or r['stdout']
                    # 未合并的友好提示
                    not_merged = 'not fully merged' in err.lower() or 'is not fully merged' in err.lower()
                    return self._send_json(200, {'ok': False, 'error': err, 'notMerged': not_merged})
                return self._send_json(200, {'ok': True})

            if sub == 'branch_rename':
                old = (body.get('old') or '').strip()
                new = (body.get('new') or '').strip()
                if not new or not re.match(r'^[A-Za-z0-9_\-./]+$', new):
                    return self._send_json(200, {'ok': False, 'error': '新分支名只能包含字母数字 _ - . /'})
                if old and not re.match(r'^[A-Za-z0-9_\-./]+$', old):
                    return self._send_json(200, {'ok': False, 'error': '无效的旧分支名'})
                cmd = ['git', 'branch', '-m']
                if old:
                    cmd += [old, new]
                else:
                    cmd += [new]  # 重命名当前分支
                r = self._git_run(cmd, cwd_abs, timeout=10)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True})

            # ========== Phase 2：远程仓库管理 ==========
            if sub == 'remote_list':
                # 输出 verbose 形式：origin  https://...  (fetch)
                r = self._git_run(['git', 'remote', '-v'], cwd_abs, timeout=5)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                seen = {}
                for line in r['stdout'].splitlines():
                    parts = line.split()
                    if len(parts) < 2: continue
                    nm, url = parts[0], parts[1]
                    if nm not in seen:
                        seen[nm] = url
                remotes = [{'name': k, 'url': v} for k, v in seen.items()]
                return self._send_json(200, {'ok': True, 'remotes': remotes})

            if sub == 'remote_add':
                name = (body.get('name') or '').strip()
                url = (body.get('url') or '').strip()
                if not name or not re.match(r'^[A-Za-z0-9_\-]+$', name):
                    return self._send_json(200, {'ok': False, 'error': '远程名只能包含字母数字 _ -'})
                if not self._is_safe_remote_url(url):
                    return self._send_json(200, {'ok': False, 'error': '只支持 https:// 或 git@host:path 形式的 URL'})
                r = self._git_run(['git', 'remote', 'add', name, url], cwd_abs, timeout=10)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True})

            if sub == 'remote_remove':
                name = (body.get('name') or '').strip()
                if not name or not re.match(r'^[A-Za-z0-9_\-]+$', name):
                    return self._send_json(200, {'ok': False, 'error': '无效的远程名'})
                r = self._git_run(['git', 'remote', 'remove', name], cwd_abs, timeout=10)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True})

            if sub == 'remote_set_url':
                name = (body.get('name') or '').strip()
                url = (body.get('url') or '').strip()
                if not name or not re.match(r'^[A-Za-z0-9_\-]+$', name):
                    return self._send_json(200, {'ok': False, 'error': '无效的远程名'})
                if not self._is_safe_remote_url(url):
                    return self._send_json(200, {'ok': False, 'error': '只支持 https:// 或 git@host:path 形式的 URL'})
                r = self._git_run(['git', 'remote', 'set-url', name, url], cwd_abs, timeout=10)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True})

            # ========== Phase 2：推送 / 拉取 / 抓取 ==========
            if sub == 'fetch':
                remote = (body.get('remote') or 'origin').strip()
                if not re.match(r'^[A-Za-z0-9_\-]+$', remote):
                    return self._send_json(200, {'ok': False, 'error': '无效的远程名'})
                r = self._git_run(['git', 'fetch', remote], cwd_abs, timeout=60)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True, 'output': r['stdout'] + r['stderr']})

            if sub == 'pull':
                remote = (body.get('remote') or 'origin').strip()
                branch = (body.get('branch') or '').strip()
                if not re.match(r'^[A-Za-z0-9_\-]+$', remote):
                    return self._send_json(200, {'ok': False, 'error': '无效的远程名'})
                if branch and not re.match(r'^[A-Za-z0-9_\-./]+$', branch):
                    return self._send_json(200, {'ok': False, 'error': '无效的分支名'})
                cmd = ['git', 'pull', remote]
                if branch: cmd.append(branch)
                r = self._git_run(cmd, cwd_abs, timeout=60)
                if not r['ok']:
                    return self._send_json(200, {'ok': False, 'error': r['stderr'] or r['stdout']})
                return self._send_json(200, {'ok': True, 'output': r['stdout'] + r['stderr']})

            if sub == 'push':
                remote = (body.get('remote') or 'origin').strip()
                branch = (body.get('branch') or '').strip()
                force_lease = bool(body.get('forceWithLease'))
                if not re.match(r'^[A-Za-z0-9_\-]+$', remote):
                    return self._send_json(200, {'ok': False, 'error': '无效的远程名'})
                if branch and not re.match(r'^[A-Za-z0-9_\-./]+$', branch):
                    return self._send_json(200, {'ok': False, 'error': '无效的分支名'})
                # force-with-lease 需要确认
                if force_lease and body.get('confirm') != '我确定':
                    return self._send_json(200, {'ok': False, 'error': '强制推送需要确认（confirm="我确定"）'})
                cmd = ['git', 'push']
                if force_lease:
                    cmd.append('--force-with-lease')
                cmd.append(remote)
                if branch: cmd.append(branch)
                r = self._git_run(cmd, cwd_abs, timeout=120)
                if not r['ok']:
                    err = r['stderr'] or r['stdout']
                    auth_fail = ('authentication failed' in err.lower()
                                 or 'could not read username' in err.lower()
                                 or 'permission denied' in err.lower())
                    return self._send_json(200, {'ok': False, 'error': err, 'authFailed': auth_fail})
                return self._send_json(200, {'ok': True, 'output': r['stdout'] + r['stderr']})

            # ========== Phase 2：敏感信息扫描（推送前调用） ==========
            if sub == 'scan_diff':
                # 扫描"本地领先于远程"的所有改动
                remote = (body.get('remote') or 'origin').strip()
                branch = (body.get('branch') or '').strip()
                if not re.match(r'^[A-Za-z0-9_\-]+$', remote):
                    return self._send_json(200, {'ok': False, 'error': '无效的远程名'})
                if branch and not re.match(r'^[A-Za-z0-9_\-./]+$', branch):
                    return self._send_json(200, {'ok': False, 'error': '无效的分支名'})
                # 先 fetch 一下，确保远程引用是最新的（失败不致命）
                self._git_run(['git', 'fetch', remote], cwd_abs, timeout=30)
                # 找出范围：origin/branch..HEAD
                range_ref = f'{remote}/{branch}..HEAD' if branch else f'{remote}/HEAD..HEAD'
                # 拿"将要推送的 diff"
                r = self._git_run(['git', 'diff', range_ref], cwd_abs, timeout=20, max_output=4 * 1024 * 1024)
                if not r['ok']:
                    # 远程分支不存在（第一次 push）→ 用全部历史
                    r2 = self._git_run(['git', 'diff', '--root', 'HEAD'], cwd_abs, timeout=20, max_output=4 * 1024 * 1024)
                    if not r2['ok']:
                        # 实在拿不到 diff（如新仓库无 commit）→ 用 ls-files + 内容
                        return self._send_json(200, {'ok': True, 'findings': [], 'note': '无法获取 diff，跳过扫描'})
                    diff_text = r2['stdout']
                else:
                    diff_text = r['stdout']
                # 也扫一遍"将要推送的提交涉及的文件名"是否包含 .env 类
                file_list_cmd = ['git', 'diff', '--name-only', range_ref]
                fr = self._git_run(file_list_cmd, cwd_abs, timeout=10)
                file_names = [ln.strip() for ln in (fr['stdout'].splitlines() if fr['ok'] else []) if ln.strip()]
                findings = self._scan_sensitive_in_diff(diff_text, file_names)
                return self._send_json(200, {'ok': True, 'findings': findings})

        except Exception as e:
            return self._send_json(200, {'ok': False, 'error': f'git 内部错误: {e}'})

    def _git_run(self, cmd, cwd, timeout=10, max_output=512 * 1024):
        """运行 git 命令，返回 dict(ok, stdout, stderr)。强制不走交互、强制 UTF-8。"""
        env = os.environ.copy()
        # 禁交互（如 SSH ask-pass）；让输出更可解析
        env['GIT_TERMINAL_PROMPT'] = '0'
        env['LC_ALL'] = 'C.UTF-8'
        env['LANG'] = 'C.UTF-8'
        try:
            proc = subprocess.run(
                cmd, cwd=cwd, timeout=timeout,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                env=env,
            )
            stdout = proc.stdout.decode('utf-8', errors='replace')
            stderr = proc.stderr.decode('utf-8', errors='replace')
            if max_output and len(stdout) > max_output:
                stdout = stdout[:max_output] + f'\n\n... (输出已截断，原长度 {len(stdout)} 字节)'
            return {'ok': proc.returncode == 0, 'stdout': stdout, 'stderr': stderr, 'returncode': proc.returncode}
        except subprocess.TimeoutExpired:
            return {'ok': False, 'stdout': '', 'stderr': f'命令超时（{timeout}s）'}
        except FileNotFoundError:
            return {'ok': False, 'stdout': '', 'stderr': 'git 命令未找到（请安装 Git 并确保在 PATH 中）'}
        except Exception as e:
            return {'ok': False, 'stdout': '', 'stderr': str(e)}

    def _default_gitignore(self):
        return (
            "# Python\n"
            "__pycache__/\n*.py[cod]\n*.egg-info/\n.venv/\nvenv/\n\n"
            "# Node\nnode_modules/\nnpm-debug.log\n\n"
            "# IDE\n.vscode/\n.idea/\n*.swp\n\n"
            "# OS\n.DS_Store\nThumbs.db\n\n"
            "# Secrets / local config\n.env\n.lms_cookie\n*.local.json\n\n"
            "# Build artifacts\ndist/\nbuild/\n*.log\n"
        )

    # ============ Phase 2 辅助 ============
    def _is_safe_remote_url(self, url):
        """只允许 https:// 或 git@host:path 形式的 URL，防止 file:// / ssh:// 等被滥用。"""
        if not url or len(url) > 500:
            return False
        # https://github.com/xxx/xxx.git
        if re.match(r'^https://[A-Za-z0-9\.\-]+(:\d+)?(/[A-Za-z0-9_\-./~%]*)?$', url):
            return True
        # git@github.com:user/repo.git
        if re.match(r'^git@[A-Za-z0-9\.\-]+:[A-Za-z0-9_\-./~]+$', url):
            return True
        # ssh://git@host/path
        if re.match(r'^ssh://[A-Za-z0-9_\-.@]+(:\d+)?/[A-Za-z0-9_\-./~]+$', url):
            return True
        return False

    # 敏感信息扫描模式（高置信度，低误报）
    _SENSITIVE_PATTERNS = [
        # (类别名, 正则, 简短描述)
        ('OpenAI Key',          re.compile(r'sk-(?:proj-)?[A-Za-z0-9_\-]{20,}'),                  'OpenAI API Key'),
        ('Anthropic Key',       re.compile(r'sk-ant-(?:api|admin)\d*-[A-Za-z0-9_\-]{20,}'),       'Anthropic API Key'),
        ('GitHub Classic Token',re.compile(r'\bgh[pousr]_[A-Za-z0-9]{36}\b'),                     'GitHub Personal Access Token'),
        ('GitHub Fine PAT',     re.compile(r'\bgithub_pat_[A-Za-z0-9_]{82}\b'),                   'GitHub Fine-grained PAT'),
        ('AWS Access Key',      re.compile(r'\bAKIA[0-9A-Z]{16}\b'),                              'AWS Access Key ID'),
        ('AWS Secret',          re.compile(r'aws_secret_access_key\s*=\s*["\']?[A-Za-z0-9/+=]{40}["\']?', re.I), 'AWS Secret Access Key'),
        ('Google API Key',      re.compile(r'\bAIza[0-9A-Za-z_\-]{35}\b'),                        'Google API Key'),
        ('Slack Token',         re.compile(r'\bxox[baprs]-[0-9A-Za-z\-]{10,}\b'),                 'Slack Token'),
        ('JWT',                 re.compile(r'\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b'), 'JSON Web Token'),
        ('Private Key',         re.compile(r'-----BEGIN (?:RSA |DSA |EC |OPENSSH |)PRIVATE KEY-----'), '私钥块'),
        ('Password 字段',       re.compile(r'''(?:password|passwd|pwd)\s*[:=]\s*["'][^"'\s]{6,}["']''', re.I), '密码字段'),
        ('数据库 URI',          re.compile(r'(?:mysql|postgres|postgresql|mongodb(?:\+srv)?|redis)://[^\s:"\'<>]+:[^@\s]+@'), '带密码的连接串'),
    ]

    def _scan_sensitive_in_diff(self, diff_text, file_names):
        """扫描 diff 文本和文件名，返回潜在敏感信息清单。
        只看 + 开头的新增行（避免误报已存在的内容）。
        """
        findings = []
        # ① 文件名命中（.env 等）
        for fn in (file_names or []):
            base = os.path.basename(fn).lower()
            if base == '.env' or base.startswith('.env.') or fn.lower().endswith('.pem') or fn.lower().endswith('.key'):
                findings.append({
                    'type': '敏感文件',
                    'file': fn,
                    'line': 0,
                    'desc': f'文件 {fn} 看起来包含凭证（建议加入 .gitignore）',
                    'snippet': fn,
                })
        # ② diff 内容扫描
        if not diff_text:
            return findings
        current_file = ''
        line_no = 0  # 新文件中的行号（跟随 @@ 信息推进）
        for raw in diff_text.split('\n'):
            # 跟踪当前文件
            if raw.startswith('+++ b/'):
                current_file = raw[6:].strip()
                line_no = 0
                continue
            if raw.startswith('+++ '):
                current_file = raw[4:].strip().lstrip('b/')
                line_no = 0
                continue
            if raw.startswith('@@'):
                # @@ -a,b +c,d @@
                m = re.search(r'\+(\d+)', raw)
                if m:
                    line_no = int(m.group(1)) - 1
                continue
            # 只看新增行（+）和上下文（空格），其他不管
            if raw.startswith('+') and not raw.startswith('+++'):
                line_no += 1
                content = raw[1:]  # 去掉前导 +
                for cat_name, pattern, desc in self._SENSITIVE_PATTERNS:
                    m = pattern.search(content)
                    if m:
                        matched = m.group(0)
                        # 脱敏显示（保留前后各 4 字符）
                        if len(matched) > 12:
                            masked = matched[:6] + '***' + matched[-4:]
                        else:
                            masked = matched[:2] + '***'
                        findings.append({
                            'type': cat_name,
                            'file': current_file,
                            'line': line_no,
                            'desc': desc,
                            'snippet': content.strip()[:200],
                            'matched': masked,
                        })
                        break  # 一行命中一次就够
            elif raw.startswith(' '):
                line_no += 1
            elif raw.startswith('-'):
                pass  # 删除行不计数到新文件
        return findings

    # ============ LLM 代理（POST，支持流式） ============
    # 作用：浏览器在 file:// / 跨域场景下无法直连第三方 LLM 中转商（如
    #       dxb.huifei.net 没返回 CORS 头时会被浏览器拦截）。
    #       这里在服务器端用 socket 透传，浏览器只需跨域到 localhost（已白名单）。
    #
    # 请求 Header（来自浏览器）:
    #   X-Token          : 本地服务的鉴权 token
    #   X-Target-Url     : 目标完整 URL，如 https://dxb.huifei.net/v1/chat/completions
    #   X-Target-Headers : JSON 字符串，里面装着要透传给目标的请求头（Authorization 等）
    # 请求 Body : 原样转发给目标
    # 响应       : 完整原样回传（包括状态码、Content-Type、流式 chunk 等）
    def handle_llm_proxy_post(self):
        import urllib.request
        import urllib.error

        origin = self.headers.get('Origin', '')

        # 鉴权
        token = self.headers.get('X-Token', '')
        if token != TOKEN:
            self._send_json(403, {'ok': False, 'error': 'Token 错误'})
            return

        target_url = self.headers.get('X-Target-Url', '').strip()
        if not target_url or not (target_url.startswith('http://') or target_url.startswith('https://')):
            self._send_json(400, {'ok': False, 'error': '缺少或非法的 X-Target-Url 头'})
            return

        # 解析要透传的 headers
        target_headers_raw = self.headers.get('X-Target-Headers', '')
        try:
            target_headers = json.loads(target_headers_raw) if target_headers_raw else {}
            if not isinstance(target_headers, dict):
                raise ValueError('X-Target-Headers 必须是 JSON 对象')
        except Exception as e:
            self._send_json(400, {'ok': False, 'error': f'X-Target-Headers 解析失败: {e}'})
            return

        # 读请求体（原样转发）
        try:
            length = int(self.headers.get('Content-Length', 0))
            req_body = self.rfile.read(length) if length > 0 else b''
        except Exception as e:
            self._send_json(400, {'ok': False, 'error': f'读取请求体失败: {e}'})
            return

        # 确保必要头存在
        if not any(k.lower() == 'content-type' for k in target_headers):
            target_headers['Content-Type'] = 'application/json'
        # 隐藏代理痕迹 / 不暴露用户 UA
        target_headers.setdefault('User-Agent', 'Mozilla/5.0 LLM-Proxy/1.0')

        # ⭐ 支持自定义 HTTP 方法（默认 POST 保持向后兼容；GET 用于拉取 /models 列表）
        target_method = (self.headers.get('X-Target-Method', 'POST') or 'POST').strip().upper()
        if target_method not in ('GET', 'POST', 'PUT', 'DELETE', 'PATCH'):
            target_method = 'POST'
        # GET 类请求不应带 body，避免某些服务端报 400
        if target_method == 'GET':
            req_body = b''
            target_headers.pop('Content-Type', None)

        print(f'\n🤖 [LLM 代理] {target_method} {target_url}')
        if req_body:
            print(f'   请求体大小: {len(req_body)} 字节')

        # urllib 的 Request 在 data 为 None 时自动 GET；为 bytes 时自动 POST
        # 这里显式传 method 覆盖
        req = urllib.request.Request(
            target_url,
            data=(req_body if req_body else None),
            method=target_method,
            headers=target_headers,
        )

        try:
            # 注意：流式响应也是 urlopen 返回的同一个 response 对象，read 一次拿一块
            upstream = urllib.request.urlopen(req, timeout=600)
        except urllib.error.HTTPError as e:
            # HTTP 错误（4xx/5xx）也要把上游响应体回传给前端，方便看到真实错误
            err_body = b''
            try: err_body = e.read()
            except Exception: pass
            up_ct = e.headers.get('Content-Type', 'text/plain; charset=utf-8') if e.headers else 'text/plain'
            print(f'   ⚠️ 上游 HTTP {e.code}: {err_body[:300]}')
            self.send_response(e.code)
            self.send_header('Content-Type', up_ct)
            self.send_header('X-Upstream-Status', str(e.code))
            self._write_cors_headers(origin)
            self.send_header('Content-Length', str(len(err_body)))
            self.end_headers()
            try: self.wfile.write(err_body)
            except Exception: pass
            return
        except Exception as e:
            print(f'   ❌ 连接上游失败: {e}')
            self._send_json(502, {'ok': False, 'error': f'代理失败：{e}'})
            return

        status = upstream.status
        up_ct = upstream.headers.get('Content-Type', 'application/octet-stream')
        is_stream = ('event-stream' in up_ct.lower()) or ('stream' in up_ct.lower() and 'json' not in up_ct.lower())

        print(f'   ✅ 上游 {status} | Content-Type: {up_ct} | 流式: {is_stream}')

        # 回送响应头
        self.send_response(status)
        self.send_header('Content-Type', up_ct)
        self.send_header('X-Upstream-Status', str(status))
        # 流式不能带 Content-Length，要用 chunked-like（HTTP/1.1 connection close 即可让浏览器读到尾）
        self._write_cors_headers(origin)
        if is_stream:
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'close')
            self.end_headers()
            # 逐块转发，让前端能实时收到 SSE
            try:
                while True:
                    chunk = upstream.read(1024)
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        print('   ⚠️ 浏览器断开了流式连接')
                        break
            except Exception as e:
                print(f'   ⚠️ 流式转发中断: {e}')
            finally:
                try: upstream.close()
                except Exception: pass
        else:
            # 非流式：一次读完再发
            try:
                body = upstream.read()
            except Exception as e:
                self._send_json(502, {'ok': False, 'error': f'读取上游响应失败: {e}'})
                return
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            try: self.wfile.write(body)
            except Exception: pass

    # ============ LMS 代理（GET） ============
    # Header:
    #   X-Token       : 后端鉴权 token（同其他接口）
    #   X-LMS-Cookie  : 用户的 LMS 会话 cookie 字符串（前端从 localStorage 读出）
    # Query:
    #   path  : LMS API 路径，如 /api/todos
    #   raw   : =1 时不解析 JSON，直接透传响应体（用于下载场景，但下载推荐前端直接处理签名 URL）
    def handle_lms_proxy_get(self):
        from urllib.parse import urlparse, parse_qs
        import urllib.request
        import urllib.error

        # 鉴权
        token = self.headers.get('X-Token', '')
        if token != TOKEN:
            self._send_json(403, {'ok': False, 'error': 'Token 错误'})
            return

        cookie = self.headers.get('X-LMS-Cookie', '').strip()
        if not cookie:
            self._send_json(400, {'ok': False, 'error': '缺少 X-LMS-Cookie 头'})
            return

        # 解析查询参数
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        lms_path = (qs.get('path', [''])[0] or '').strip()
        raw_mode = qs.get('raw', ['0'])[0] == '1'

        if not lms_path.startswith('/'):
            self._send_json(400, {'ok': False, 'error': 'path 必须以 / 开头'})
            return

        # 把代理请求里除 path/raw 之外的参数透传到 LMS
        passthrough = {k: v for k, v in qs.items() if k not in ('path', 'raw')}
        from urllib.parse import urlencode
        extra = ('&' + urlencode(passthrough, doseq=True)) if passthrough else ''
        target_url = f'https://lms.xjtu.edu.cn{lms_path}'
        if '?' in lms_path:
            target_url = target_url + extra
        elif extra:
            target_url = target_url + '?' + extra[1:]

        print(f'🎓 [LMS 代理] GET {target_url}')

        req = urllib.request.Request(target_url, headers={
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/148.0.0.0 Safari/537.36'
            ),
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Referer': 'https://lms.xjtu.edu.cn/user/index',
            'X-Requested-With': 'XMLHttpRequest',
            'Cookie': cookie,
        })

        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = resp.read()
                status = resp.status
                ct = resp.headers.get('Content-Type', '')
        except urllib.error.HTTPError as e:
            try:
                body_text = e.read().decode('utf-8', errors='replace')
            except Exception:
                body_text = str(e)
            print(f'  ⚠️ HTTP {e.code}: {body_text[:200]}')
            self._send_json(200, {
                'ok': False,
                'status': e.code,
                'error': f'LMS 返回 {e.code}',
                'body': body_text[:2000]
            })
            return
        except Exception as e:
            print(f'  ❌ 请求失败: {e}')
            self._send_json(200, {'ok': False, 'error': f'请求失败: {e}'})
            return

        # 尝试以 JSON 返回（绝大多数 LMS API 都是 JSON）
        if not raw_mode and 'json' in ct.lower():
            try:
                data = json.loads(body.decode('utf-8'))
                self._send_json(200, {'ok': True, 'status': status, 'data': data})
                return
            except Exception:
                pass

        # 否则按文本返回
        try:
            text = body.decode('utf-8', errors='replace')
        except Exception:
            text = ''
        self._send_json(200, {
            'ok': True, 'status': status,
            'content_type': ct,
            'text': text[:200000]
        })


if __name__ == '__main__':
    print('=' * 60)
    print('🚀 本地 Agent 服务（终端 + 文件系统 + 静态托管 + LLM 代理）')
    print('=' * 60)
    print(f'服务地址    : http://{HOST}:{PORT}')
    print()
    print('🌐 在浏览器打开：')
    print(f'   👉  http://{HOST}:{PORT}/')
    print('   （从这里打开页面，不再有任何 CORS 问题）')
    print()
    print(f'🏠 沙箱根目录: {WORKSPACE_ROOT}')
    print(f'   工作目录 : {current_cwd}')
    print(f'Token 文件  : {TOKEN_FILE}')
    print(f'\n🔑 Token: {TOKEN}\n')
    print('🛡️  沙箱防护:')
    print('   L1 路径越界检测  - 所有文件操作必须在沙箱内')
    print('   L2 cd 越界拦截   - 不允许 cd 出沙箱')
    print('   L3 危险命令黑名单 - rm -rf / format / fork bomb / sudo 等')
    print('\n📦 支持的操作:')
    print('   - GET  /token      浏览器自动拉取 Token（需在终端按 y 授权）')
    print('   - GET  /workspace  查询当前沙箱目录（公开，无需鉴权）')
    print('   - GET  /lms-proxy  代理 LMS API 请求（需 X-Token + X-LMS-Cookie）')
    print('   - POST /llm-proxy  代理 LLM 请求（绕过浏览器 CORS，需 X-Token + X-Target-Url + X-Target-Headers；可选 X-Target-Method=GET 用于拉模型列表）')
    print('   - execute          执行 shell 命令')
    print('   - read_file        读取文本文件')
    print('   - read_file_binary 读取二进制文件（图片/PDF）')
    print('   - write_file       写/覆盖文件')
    print('   - append_file      追加内容')
    print('   - edit_file        精确替换')
    print('   - delete_file      删除文件/空目录')
    print('   - list_dir         列目录')
    print('   - search           搜索文件内容')
    print('   - web_search       🌐 网络搜索（Bing 国内 / 百度 / Bing 国际 三级回退）')
    print('   - fetch_url        🌐 抓取网页正文')
    print('   - file_info        查看文件信息')
    print('   - git              🌿 Git 集成（status/log/diff/add/commit/checkout/branch...）')
    print('\n⚠️ 修改 .py 后必须 Ctrl+C 重启服务！')
    print('=' * 60)
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print('\n👋 服务已停止')