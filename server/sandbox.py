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
import shlex

from . import config


# ============ L3：危险命令黑名单 ============
# 采用"去空格 + 小写"后的子串匹配 + 正则匹配
_RM_DANGEROUS_TARGET_RE = re.compile(r'\brm\s+(-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)+(/|~|\$home|\*|\.)', re.IGNORECASE)
_RM_RECURSIVE_FORCE_RE = re.compile(r'\brm\s+-[a-zA-Z]*[rRfF]', re.IGNORECASE)

DANGEROUS_PATTERNS = [
    # 大规模删除
    (_RM_DANGEROUS_TARGET_RE,
        'rm -rf 对根/家目录/通配符'),
    (_RM_RECURSIVE_FORCE_RE,
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


_SHELL_SEGMENT_RE = re.compile(r'&&|\|\||[;&|]')
_GLOB_OR_EXPANSION_RE = re.compile(r'[*?\[\]{}]')


def _split_shell_tokens(segment):
    try:
        return shlex.split(segment, posix=True)
    except ValueError:
        return []


def _is_rm_command_token(token):
    name = os.path.basename(str(token or '').strip().strip('"').strip("'")).lower()
    return name in ('rm', 'rm.exe')


def _rm_option_requests_recursive_or_force(option):
    if not isinstance(option, str) or not option.startswith('-') or option == '--':
        return False
    if option.startswith('--'):
        return option in ('--recursive', '--force')
    return bool(re.search(r'[rRfF]', option))


def _resolve_rm_target(target, cwd):
    base = resolve_path(cwd) if cwd else config.get_current_cwd()
    raw = os.path.expanduser(str(target or ''))
    if os.path.isabs(raw):
        return os.path.realpath(raw)
    return os.path.realpath(os.path.join(base, raw))


def _is_safe_rm_target(target, cwd=None):
    raw = str(target or '').strip()
    if not raw or raw.startswith('-'):
        return False
    normalized = raw.replace('\\', '/').rstrip('/')
    if normalized in ('', '.', './', '..') or normalized.startswith('../') or '/../' in normalized:
        return False
    if raw.startswith('~') or '$' in raw or '`' in raw or '\n' in raw or '\r' in raw:
        return False
    if _GLOB_OR_EXPANSION_RE.search(raw):
        return False
    target_abs = _resolve_rm_target(raw, cwd)
    workspace_abs = os.path.realpath(config.WORKSPACE_ROOT)
    if target_abs == workspace_abs:
        return False
    return is_inside_workspace(target_abs)


def _all_rm_delete_targets_are_safe(cmd, cwd=None):
    found = False
    for segment in _SHELL_SEGMENT_RE.split(str(cmd or '')):
        tokens = _split_shell_tokens(segment)
        if not tokens or not _is_rm_command_token(tokens[0]):
            continue
        delete_mode = False
        targets = []
        end_options = False
        for token in tokens[1:]:
            if not end_options and token == '--':
                end_options = True
                continue
            if not end_options and token.startswith('-') and token != '-':
                if _rm_option_requests_recursive_or_force(token):
                    delete_mode = True
                continue
            targets.append(token)
        if not delete_mode:
            continue
        found = True
        if not targets:
            return False
        if not all(_is_safe_rm_target(target, cwd) for target in targets):
            return False
    return found


def is_dangerous_command(cmd, cwd=None):
    """返回 (是否危险, 原因)"""
    for pattern, reason in DANGEROUS_PATTERNS:
        if pattern.search(cmd):
            if pattern in (_RM_DANGEROUS_TARGET_RE, _RM_RECURSIVE_FORCE_RE) and _all_rm_delete_targets_are_safe(cmd, cwd=cwd):
                continue
            return True, reason
    return False, ''


# ============ L4：命令文本中的路径越界检测 ============
# 这层不是完整 shell 解析器，目标是拦住常见绕过：
#   type C:\outside\secret.txt
#   powershell -Command "Get-Content C:\outside\secret.txt"
#   python -c "open(r'C:\outside\secret.txt').read()"
#   cmd /c "cd /d C:\outside && dir"
#   copy C:\outside\secret.txt .
#   ../ / ..\ 父目录跳转
_WINDOWS_ABS_PATH_RE = re.compile(r'(?i)([a-z]:[\\/][^"\'<>\r\n&|]*)')
_UNC_PATH_RE = re.compile(r'(\\\\[^\\/\s"\'<>|&]+[\\/][^"\'<>|&]+)')
_PARENT_TRAVERSAL_RE = re.compile(r'(^|[\s"\'=])\.\.[\\/]')
_CD_PARENT_RE = re.compile(
    r'(?i)(^|[&|;]\s*|\b)'
    r'(cd|chdir|pushd|set-location|sl|dir|ls|type|cat|more|get-content)\s+'
    r'(?:/d\s+)?["\']?\.\.(?=$|[\s"\'&|;\\/])'
)
_USER_HOME_REF_RE = re.compile(
    r'(?i)(~[\\/]|'
    r'%\s*(userprofile|homepath|homedrive|appdata|localappdata|temp|tmp)\s*%|'
    r'\$(home|env:userprofile|env:homepath)|'
    r'\$\{home\})'
)


def _trim_shell_path(p: str) -> str:
    """清理从命令文本里粗略抓出的路径片段。"""
    if not p:
        return ''
    p = p.strip().strip('"').strip("'")
    # 去掉常见结尾标点/重定向残留
    p = p.rstrip('.,;')
    return p


def _masked_urls(cmd: str) -> str:
    """URL 里的 / 不应被当成本地绝对路径。"""
    return re.sub(r'https?://\S+', ' ', cmd, flags=re.IGNORECASE)


def _masked_shell_variable_paths(cmd: str) -> str:
    """Shell variable path joins like "$dir"/file are not absolute paths."""
    if not cmd:
        return ''
    var = r'(?:\$\w+|\$\{[^}]+\})'
    quoted_var = r'(?:"' + var + r'"|\'' + var + r'\')'
    pattern = re.compile(r'(?:' + quoted_var + r'|' + var + r')(?:/[^\s"\'<>|&;)]*)+')
    return pattern.sub(' ', cmd)


def _contains_parent_ref(token: str) -> bool:
    normalized = str(token or '').replace('\\', '/')
    return normalized == '..' or normalized.startswith('../') or '/../' in normalized or normalized.endswith('/..')


def _is_plain_shell_path_token(token: str) -> bool:
    return bool(re.match(r'^[A-Za-z0-9_./\\:+@%=-]+$', str(token or '')))


def _resolve_shell_path(token: str, base_dir: str) -> str:
    raw = os.path.expanduser(str(token or ''))
    if os.path.isabs(raw):
        return os.path.realpath(raw)
    return os.path.realpath(os.path.join(base_dir, raw))


def _command_parent_traversal_escapes_workspace(cmd: str, cwd=None) -> bool:
    try:
        current_dir = os.path.realpath(resolve_path(cwd) if cwd else config.get_current_cwd())
    except Exception:
        current_dir = os.path.realpath(config.WORKSPACE_ROOT)

    # Track simple shell sequencing so "cd subdir && ../tool" resolves from subdir.
    for segment in re.split(r'&&|\|\||[;\n]', str(cmd or '')):
        tokens = _split_shell_tokens(segment)
        if not tokens:
            continue
        command_name = os.path.basename(tokens[0]).lower()
        if command_name in ('cd', 'chdir', 'pushd', 'set-location', 'sl'):
            target = ''
            for token in tokens[1:]:
                if token.startswith('-'):
                    continue
                target = token
                break
            if not target:
                continue
            if _contains_parent_ref(target) and not _is_plain_shell_path_token(target):
                return True
            next_dir = _resolve_shell_path(target, current_dir)
            if not is_inside_workspace(next_dir):
                return True
            current_dir = next_dir
            continue

        for token in tokens:
            if not _contains_parent_ref(token):
                continue
            if not _is_plain_shell_path_token(token):
                return True
            if not is_inside_workspace(_resolve_shell_path(token, current_dir)):
                return True
    return False


def _is_allowed_shell_device_path(path: str) -> bool:
    """Allow harmless shell pseudo-files that do not expose real filesystem data."""
    normalized = (path or '').replace('\\', '/').rstrip('/')
    return normalized == '/dev/null'


def command_workspace_violation(cmd: str, cwd=None):
    """返回 (是否越界, 原因)。用于 shell 命令执行前的保守拦截。

    注意：这是防御层，不是为了证明命令绝对安全。命令里只要出现
    明显外部路径/家目录引用/父目录遍历，就直接拒绝。
    """
    if config.is_full_access_enabled():
        return False, ''
    if not cmd:
        return False, ''

    masked = _masked_shell_variable_paths(_masked_urls(cmd))

    if _USER_HOME_REF_RE.search(masked):
        return True, '命令引用了用户目录/环境变量（如 ~、%USERPROFILE%、$HOME），可能越出沙箱'

    if _PARENT_TRAVERSAL_RE.search(masked) and _command_parent_traversal_escapes_workspace(masked, cwd=cwd):
        return True, '命令包含 ../ 或 ..\\ 父目录跳转，可能越出沙箱'

    if _CD_PARENT_RE.search(masked) and _command_parent_traversal_escapes_workspace(masked, cwd=cwd):
        return True, '命令把 .. 作为目录参数，可能越出沙箱'

    for m in _UNC_PATH_RE.finditer(masked):
        p = _trim_shell_path(m.group(1))
        return True, f'命令引用了 UNC/网络绝对路径：{p}'

    for m in _WINDOWS_ABS_PATH_RE.finditer(masked):
        p = _trim_shell_path(m.group(1))
        if not p:
            continue
        # 允许明确指向沙箱内的绝对路径；拒绝其他盘符/目录。
        if not is_inside_workspace(p):
            return True, f'命令引用了沙箱外绝对路径：{p}'

    # Unix/macOS/Linux 绝对路径。Windows 下跳过，避免把 cmd 参数 /c /d 误判。
    if os.name != 'nt':
        unix_abs_re = re.compile(r'(?<![:\w.-])(/[^\s"\'<>|&;)]+)')
        for m in unix_abs_re.finditer(masked):
            p = _trim_shell_path(m.group(1))
            if _is_allowed_shell_device_path(p):
                continue
            if p and not is_inside_workspace(p):
                return True, f'命令引用了沙箱外绝对路径：{p}'

    return False, ''


# ============ L1：路径校验 ============
def is_inside_workspace(abs_path):
    """检查 abs_path 是否在沙箱根目录内（含 realpath 解析以防 symlink 越狱）"""
    if config.is_full_access_enabled():
        return True
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
        return config.get_current_cwd()
    path = os.path.expanduser(path)
    if not os.path.isabs(path):
        path = os.path.abspath(os.path.join(config.get_current_cwd(), path))
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
