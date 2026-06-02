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
# 默认值 = 启动时的 cwd，可通过 set_workspace() 在启动早期覆盖（CLI --workspace 参数）。
WORKSPACE_ROOT = os.path.realpath(os.getcwd())

# ---------- 可变状态 ----------
# current_cwd 会被 cd 命令修改。访问时务必用 config.current_cwd，不要 from import
current_cwd = os.getcwd()

# input() 锁（避免多个并发请求同时弹终端确认）
INPUT_LOCK = threading.Lock()


def set_workspace(path: str) -> None:
    """启动早期调用，把沙箱根目录覆盖为指定路径。
    用 realpath 防 symlink 越狱；目录不存在会抛 FileNotFoundError。
    会同步：WORKSPACE_ROOT / current_cwd / 进程 cwd（让相对路径命令也正确）。
    """
    global WORKSPACE_ROOT, current_cwd
    p = os.path.realpath(os.path.expanduser(path))
    if not os.path.isdir(p):
        raise FileNotFoundError(f'workspace 目录不存在: {p}')
    WORKSPACE_ROOT = p
    current_cwd = p
    try:
        os.chdir(p)  # 让 subprocess 默认继承此 cwd
    except Exception:
        pass


# ---------- CORS 策略 ----------
def is_allowed_origin(origin: str) -> bool:
    """本地项目，所有 Origin 都放行（含 'null' 对应 file:// 双击）。"""
    return True
