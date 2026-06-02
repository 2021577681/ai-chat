# ============================================================
# server/sandbox.py - 沙箱安全：路径校验 + 危险命令黑名单
# ============================================================
# 三层防护：
#   L1 路径越界检测 - 所有文件操作必须在 WORKSPACE_ROOT 内
#   L2 cd 越界拦截  - 不允许 cd 出沙箱（在 exec.py 调用本模块的工具）
#   L3 危险命令黑名单 - rm -rf / format / fork bomb / sudo 等（DANGEROUS_PATTERNS）
# ============================================================

import os
import re

from . import config


# ============ L3：危险命令黑名单 ============
# 采用"去空格 + 小写"后的子串匹配 + 正则匹配
DANGEROUS_PATTERNS = [
    # 大规模删除
    (re.compile(r'\brm\s+(-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)+(/|~|\$home|\*|\.)', re.IGNORECASE),
        'rm -rf 对根/家目录/通配符'),
    (re.compile(r'\brm\s+-[a-zA-Z]*[rRfF]', re.IGNORECASE),
        'rm -rf （强制递归删除，需特别确认）'),
    # Windows 删除
    (re.compile(r'\b(del|rmdir|rd)\s+/[sSqQ]', re.IGNORECASE),
        'del/rmdir 强制递归'),
    (re.compile(r'\bformat\s+[a-zA-Z]:', re.IGNORECASE),
        'format 磁盘格式化'),
    # 磁盘/系统破坏
    (re.compile(r'\bmkfs(\.|\s)', re.IGNORECASE),
        'mkfs 格式化文件系统'),
    (re.compile(r'\bdd\s+if=.+of=/dev/', re.IGNORECASE),
        'dd 写入设备文件'),
    (re.compile(r'>\s*/dev/[shn]d[a-z]', re.IGNORECASE),
        '重定向写入磁盘设备'),
    # 关机/重启
    (re.compile(r'\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b', re.IGNORECASE),
        '关机/重启命令'),
    # Fork 炸弹
    (re.compile(r':\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:'),
        'fork bomb（:(){ :|:& };:）'),
    # 危险下载执行
    (re.compile(r'\bcurl\b.*\|\s*(sudo\s+)?(bash|sh|zsh|python|perl)', re.IGNORECASE),
        'curl | sh（从网络直接执行脚本）'),
    (re.compile(r'\bwget\b.*\|\s*(sudo\s+)?(bash|sh|zsh|python|perl)', re.IGNORECASE),
        'wget | sh（从网络直接执行脚本）'),
    # 权限放飞
    (re.compile(r'\bchmod\s+-?R?\s*777\b', re.IGNORECASE),
        'chmod 777（开放全权限）'),
    # sudo 整体拦截（个人开发场景一般不该用）
    (re.compile(r'(^|\s|;|&&|\|\|)\bsudo\b', re.IGNORECASE),
        'sudo 提权'),
    # ⭐ 防绕过：命令替换 / eval / 间接执行
    (re.compile(r'\$\([^)]*\b(rm|del|format|mkfs|dd|shutdown|reboot|sudo|chmod\s+777)\b', re.IGNORECASE),
        '$(...) 命令替换包裹危险命令'),
    (re.compile(r'`[^`]*\b(rm|del|format|mkfs|dd|shutdown|reboot|sudo)\b', re.IGNORECASE),
        '反引号命令替换包裹危险命令'),
    (re.compile(r'\beval\b', re.IGNORECASE),
        'eval 间接执行（容易绕过黑名单）'),
    (re.compile(r'\bexec\s+[^\s]', re.IGNORECASE),
        'exec 替换当前进程'),
    # base64 / hex 解码后管道执行
    (re.compile(r'\bbase64\s+(-d|--decode|-D)\b.*\|\s*(bash|sh|zsh|python|perl)', re.IGNORECASE),
        'base64 解码后管道执行'),
    (re.compile(r'\bxxd\s+-r\b.*\|\s*(bash|sh|zsh)', re.IGNORECASE),
        'xxd 反向解码后管道执行'),
    # xargs / find -exec 调起 shell
    (re.compile(r'\bxargs\b[^|;]*\b(bash|sh|zsh|rm)\b', re.IGNORECASE),
        'xargs 调起 shell/rm'),
    (re.compile(r'\bfind\b[^;|]*-exec\s+(rm|sh|bash|zsh)\b', re.IGNORECASE),
        'find -exec 调起 rm/shell'),
    # /dev/tcp 反弹 shell
    (re.compile(r'/dev/(tcp|udp)/', re.IGNORECASE),
        '/dev/tcp 反弹 shell'),
    (re.compile(r'\bnc\b\s+(-[eE]|.*-[eE])', re.IGNORECASE),
        'nc -e 反弹 shell'),
    # 写入启动项 / cron / authorized_keys
    (re.compile(r'(authorized_keys|/etc/cron|/etc/passwd|/etc/shadow|/etc/sudoers)', re.IGNORECASE),
        '写入敏感系统文件（密钥/cron/passwd 等）'),
    (re.compile(r'(>>?\s*~?/?\.(bashrc|zshrc|profile|bash_profile))', re.IGNORECASE),
        '写入 shell 启动脚本'),
    # PowerShell 绕过
    (re.compile(r'\bpowershell\b.*(-enc|-encodedcommand|-nop|-noprofile)', re.IGNORECASE),
        'powershell 编码命令 / 绕过策略'),
    (re.compile(r'\b(iex|invoke-expression)\b', re.IGNORECASE),
        'PowerShell IEX 间接执行'),
]


def is_dangerous_command(cmd):
    """返回 (是否危险, 原因)"""
    for pattern, reason in DANGEROUS_PATTERNS:
        if pattern.search(cmd):
            return True, reason
    return False, ''


# ============ L1：路径校验 ============
def is_inside_workspace(abs_path):
    """检查 abs_path 是否在沙箱根目录内（含 realpath 解析以防 symlink 越狱）"""
    try:
        real = os.path.realpath(abs_path)
    except Exception:
        return False
    try:
        # commonpath 在 Windows 上跨盘符会抛 ValueError
        common = os.path.commonpath([real, config.WORKSPACE_ROOT])
    except ValueError:
        return False
    return common == config.WORKSPACE_ROOT


def resolve_path(path):
    """解析路径：相对路径基于 current_cwd，并展开 ~"""
    if not path:
        return config.current_cwd
    path = os.path.expanduser(path)
    if not os.path.isabs(path):
        path = os.path.abspath(os.path.join(config.current_cwd, path))
    return path


def check_path_or_error(path_str, must_exist=False):
    """
    解析路径 → 校验在沙箱内 → 返回 (绝对路径, 错误字符串或 None)
    """
    abs_path = resolve_path(path_str)
    if not is_inside_workspace(abs_path):
        return abs_path, (
            f'🚫 路径越界：{abs_path}\n'
            f'   沙箱根目录: {config.WORKSPACE_ROOT}\n'
            f'   AI 只能在沙箱内操作文件。请使用相对路径或沙箱内的绝对路径。'
        )
    if must_exist and not os.path.exists(abs_path):
        return abs_path, f'路径不存在: {abs_path}'
    return abs_path, None
