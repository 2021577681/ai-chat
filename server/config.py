# ============================================================
# server/config.py - 全局配置 & 启动时初始化
# ============================================================
# 这里持有所有"进程级单例"：监听端口、Token、沙箱根目录、当前 cwd。
# 其他模块通过 from server import config 然后 config.TOKEN / config.WORKSPACE_ROOT 访问。
#
# 注意 current_cwd 是会被 cd 命令修改的可变状态，必须通过模块属性访问
# （直接 from .config import current_cwd 会拿到导入瞬间的快照，会读到旧值）。
# ============================================================

import os
import secrets
import threading

# ---------- 网络配置 ----------
PORT = 8765
HOST = '127.0.0.1'

# ---------- Token 自动生成/加载 ----------
# 放在用户主目录，所有工作区共享一个 token
TOKEN_FILE = os.path.join(os.path.expanduser('~'), '.aichat_terminal_token')


def _load_or_create_token():
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
        try:
            os.chmod(TOKEN_FILE, 0o600)  # Unix 设为仅用户可读
        except Exception:
            pass
    except Exception as e:
        print(f'⚠️  无法写入 token 文件: {e}')
    return tk


TOKEN = _load_or_create_token()

# ---------- 沙箱根目录（启动后锁定） ----------
# WORKSPACE_ROOT 在启动后不再变化，所有文件操作必须在此目录内。
# 用 realpath 解析以防 symlink 越狱。
WORKSPACE_ROOT = os.path.realpath(os.getcwd())

# ---------- 可变状态 ----------
# current_cwd 会被 cd 命令修改。访问时务必用 config.current_cwd，不要 from import
current_cwd = os.getcwd()

# input() 锁（避免多个并发请求同时弹终端确认）
INPUT_LOCK = threading.Lock()


# ---------- CORS 策略 ----------
def is_allowed_origin(origin: str) -> bool:
    """本地项目，所有 Origin 都放行（含 'null' 对应 file:// 双击）。"""
    return True
