"""
本地 Agent 服务 - 主入口
启动: python local_terminal_server.py

⭐ 业务实现已拆分到 server/ 包下：
    server/config.py    全局配置 & Token
    server/sandbox.py   沙箱路径校验 + 危险命令黑名单
    server/handler.py   HTTP Handler 主类（路由 + CORS）
    server/exec.py      命令执行
    server/files.py     文件 CRUD / 搜索
    server/web.py       网络搜索 + 抓取
    server/git_ops.py   Git 集成 + 敏感扫描
    server/proxy.py     LLM/LMS 代理 + 静态文件

本文件只负责：启动 banner + 起 HTTP 服务。
"""
from http.server import ThreadingHTTPServer

from server import Handler, config


def _print_banner():
    print('=' * 60)
    print('🚀 本地 Agent 服务（终端 + 文件系统 + 静态托管 + LLM 代理）')
    print('=' * 60)
    print(f'服务地址    : http://{config.HOST}:{config.PORT}')
    print()
    print('🌐 在浏览器打开：')
    print(f'   👉  http://{config.HOST}:{config.PORT}/')
    print('   （从这里打开页面，不再有任何 CORS 问题）')
    print()
    print(f'🏠 沙箱根目录: {config.WORKSPACE_ROOT}')
    print(f'   工作目录 : {config.current_cwd}')
    print(f'Token 文件  : {config.TOKEN_FILE}')
    print(f'\n🔑 Token: {config.TOKEN}\n')
    print('🛡️  沙箱防护:')
    print('   L1 路径越界检测  - 所有文件操作必须在沙箱内')
    print('   L2 cd 越界拦截   - 不允许 cd 出沙箱')
    print('   L3 危险命令黑名单 - rm -rf / format / fork bomb / sudo 等')
    print('\n📦 支持的操作:')
    print('   - GET  /token      浏览器自动拉取 Token（本机自动授权）')
    print('   - GET  /workspace  查询当前沙箱目录（公开，无需鉴权）')
    print('   - GET  /lms-proxy  代理 LMS API 请求（需 X-Token + X-LMS-Cookie）')
    print('   - POST /llm-proxy  代理 LLM 请求（绕过浏览器 CORS）')
    print('   - execute          执行 shell 命令')
    print('   - read_file        读取文本文件')
    print('   - read_file_binary 读取二进制文件（图片/PDF）')
    print('   - write_file       写/覆盖文件')
    print('   - append_file      追加内容')
    print('   - edit_file        精确替换')
    print('   - delete_file      删除文件/空目录')
    print('   - list_dir         列目录')
    print('   - search           搜索文件内容')
    print('   - web_search       🌐 网络搜索（多引擎自动回退）')
    print('   - fetch_url        🌐 抓取网页正文')
    print('   - file_info        查看文件信息')
    print('   - git              🌿 Git 集成（status/log/diff/add/commit/checkout/branch...）')
    print('\n⚠️ 修改 server/*.py 后必须 Ctrl+C 重启服务！')
    print('=' * 60)


if __name__ == '__main__':
    _print_banner()
    try:
        ThreadingHTTPServer((config.HOST, config.PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print('\n👋 服务已停止')
