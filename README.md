# 🧠 AI Chat Local Agent Workbench

一个本地优先、可观察、可控、可执行的大模型 Agent 工作台。

它不是只负责聊天的 Web UI，也不是把模型接进终端后直接放手运行的自动化脚本。这个项目把大模型对话、工具调用、文件读写、命令执行、Git 快照、网页检索、截图观察、MCP、Skill、计划模式、大纲模式、师生反思、Token/费用统计和请求调试整合在同一个浏览器工作台里，让模型能真正落地做事，同时把关键权限和执行过程留在用户手里。

前端零构建，主界面可以直接打开 HTML；配合本地 Python 后端后，Agent 可以在受控工作区内读取和修改文件、运行命令、查看屏幕、搜索网页、管理 Git 快照，并调用扩展工具。

## ✨ 项目亮点：更友好的个人 Agent 工作台

很多 Agent 工具能“自动做事”，但真实使用时经常卡在部署重、终端黑盒、请求不可查、权限粗糙、长任务无反馈这些体验问题上。这个项目更关注个人日常使用的顺手程度：能落地执行，也能看清过程；能自动推进，也能随时接管。

| 常见 Agent 工具的不便 | 本项目的体验优化 |
| --- | --- |
| 需要部署服务、数据库、Docker 或复杂环境 | 前端零构建，HTML 可直接打开；后端一个 Python 脚本即可启动 |
| 主要靠终端交互，状态不直观 | 浏览器 UI 工作台集中管理对话、设置、工具、权限、Git、Token 和请求调试 |
| 模型到底发了什么请求看不见 | 内置 JSON 查看器，可看 URL、Headers、Body、原始响应、请求历史和 cURL |
| 长回答或长任务结束没有反馈 | 支持 AI 完成提示音，并可在设置里开关和调节音量 |
| Agent 一旦开始执行就像黑盒 | 命令、写入、删除、截图、MCP、Git 等操作按类别弹窗确认 |
| 只能聊天，不能真正处理本地项目 | 本地后端可在工作区沙箱内读写文件、执行命令、截图、搜索网页和管理 Git |
| 绑定单一模型或平台 | 支持多 Provider、多 API 配置档案和自定义兼容接口 |

### 🚪 无需部署，打开就能用

- 不需要前端构建流程，不依赖 Node、Docker、数据库或云端部署。
- 主界面可以直接双击 HTML 打开，也可以由本地 Python 后端托管访问。
- 后端入口就是 `local_terminal_server.py`，安装依赖后运行一条命令即可启动。

### 🖥️ 有完整 UI，不是终端黑盒

- 对话、模型配置、工具开关、权限管理、Git 面板、Token 统计和 JSON 调试都在浏览器里完成。
- 常用能力都有可视化入口，不需要记一堆命令或配置文件位置。
- 计划模式、大纲模式、任务队列和权限弹窗让长任务更容易跟踪和接管。

### 🔔 AI 完成提示音

- 普通对话、计划模式、大纲模式等完成后可以播放提示音。
- 适合长回答、长任务或后台等待场景，不用一直盯着页面。
- 提示音支持在设置里开关，并可单独调节音量，不影响系统音量。

### 🧾 JSON 请求查看器

- 可以预览实际请求体，查看模型调用的 URL、Headers、Body 和响应内容。
- 支持请求历史、响应详情、请求体复制和 cURL 复制。
- 适合调试 OpenAI 兼容接口、中转网关、自定义模型服务和非标准响应问题。

### 🛡️ 更细的权限控制

- 命令执行、文件写入、删除、截图、MCP、Git 写入和 Git 恢复等高风险能力都会确认。
- 支持“仅本次允许”“本任务允许”“永久允许”和撤销，避免每一步都重复确认，也避免完全放开。
- 文件和命令默认被限制在指定 `WORKSPACE` 内，适合处理私有项目。

### 🧭 更适合真实长任务

- 计划模式适合先拆解、再审批、再逐步执行。
- 大纲模式适合边做边调整，支持暂停、继续、追加意见和强制收尾。
- 师生反思模式适合写作、代码、推理、翻译等需要自我评审和改进的任务。

### 🧩 工具扩展不锁死

- 支持自定义 JS 工具，把个人脚本或业务能力变成模型可调用工具。
- 支持 MCP stdio server，可接入更大的外部工具生态。
- 支持本地 Skill，把项目规范、工作流或专业说明按需注入给模型。

## 🗺️ 功能概览

| 能力 | 说明 |
| --- | --- |
| 本地后端 | `local_terminal_server.py` 提供文件、命令、Git、截图、网页和代理能力 |
| 静态前端 | `AI-Chat-大模型对话助手.html` 可直接打开，也可由后端托管访问 |
| 工作区沙箱 | 后端启动时指定 `--workspace`，文件和命令默认限制在该目录内 |
| 权限确认 | 命令、写入、删除、附件、截图、MCP、Git 写入和恢复等高风险操作会弹窗确认 |
| 请求调试 | 查看请求 JSON、Headers、原始响应、请求历史和 cURL |
| Token 统计 | 对话级 token 条、全局 usage 账本、模型价格和费用估算 |
| Git 快照 | 查看状态、历史、diff，保存阶段性改动，必要时恢复指定文件 |
| MCP/Skill | 接入外部工具和本地技能说明，让 Agent 按需扩展能力 |

## 🚀 快速开始

### 1. 🐍 准备 Python

需要 Python 3.10 或更高版本。Windows 上安装 Python 时建议勾选：

```text
Add python.exe to PATH
```

安装完成后重新打开 PowerShell，检查：

```powershell
python --version
```

如果 `python --version` 没有输出，通常是 Windows 的应用执行别名干扰。可以在：

```text
设置 -> 应用 -> 高级应用设置 -> 应用执行别名
```

关闭 `python.exe` 和 `python3.exe`，然后重新安装或重新打开终端再试。

### 2. 📦 安装依赖

进入项目目录：

```powershell
cd "D:\path\to\agent"
```

安装依赖：

```powershell
python -m pip install -r requirements.txt
```

如果你想隔离环境，也可以使用虚拟环境：

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

### 3. ▶️ 启动后端

最简单的启动方式：

```powershell
python local_terminal_server.py
```

启动成功后，终端会打印服务地址、Token 和工作区信息，并保持运行。默认地址是：

```text
http://127.0.0.1:8765/
```

默认工作区是启动命令所在目录。也可以显式指定工作区：

```powershell
python local_terminal_server.py --workspace "D:\your-project"
```

如果使用虚拟环境但没有激活环境，可以这样启动：

```powershell
.\.venv\Scripts\python .\local_terminal_server.py --workspace "D:\your-project"
```

### 4. 🌐 打开前端

推荐在后端启动后访问：

```text
http://127.0.0.1:8765/
```

也可以直接双击打开：

```text
AI-Chat-大模型对话助手.html
```

首次使用时进入设置页，配置：

- API Key
- Base URL
- API Path
- 模型名
- 接口格式
- 是否使用本地代理
- 本地服务 URL

如果页面需要调用本地后端，点击获取本地 Token。非本机来源访问时，Python 终端可能会提示授权，输入 `y` 即可。

## 💻 在其他电脑上使用

### 🖥️ 本机单独使用

把整个项目文件夹复制到另一台电脑，例如：

```text
D:\path\to\agent
```

确认至少包含：

```text
local_terminal_server.py
server/
js/
AI-Chat-大模型对话助手.html
requirements.txt
start_agent.bat
```

然后运行：

```powershell
cd "D:\path\to\agent"
python -m pip install -r requirements.txt
python local_terminal_server.py
```

浏览器打开：

```text
http://127.0.0.1:8765/
```

### 🌍 局域网其他电脑访问

在运行后端的电脑上启动：

```powershell
python local_terminal_server.py --host 0.0.0.0 --port 8765 --workspace "D:\path\to\agent"
```

在另一台电脑浏览器访问：

```text
http://后端电脑的局域网IP:8765/
```

例如：

```text
http://192.168.1.23:8765/
```

注意事项：

- Windows 防火墙可能需要放行 Python 或端口 `8765`。
- 前端的“本地服务 URL”要改成 `http://后端电脑IP:8765`。
- 非本机浏览器获取 Token 时，后端终端会请求授权，输入 `y`。

## 🪟 bat 启动器用法

Windows 可以使用 `start_agent.bat` 启动后端。它有两个核心路径：

```text
AGENT_HOME = 后端代码所在目录
WORKSPACE  = Agent 允许操作的工作区目录
```

项目自带的默认逻辑是：

```bat
if not defined AGENT_HOME set "AGENT_HOME=%~dp0"
set "WORKSPACE=%~dp0"
```

含义是：

- `AGENT_HOME` 默认等于 bat 文件所在目录。
- `WORKSPACE` 也等于 bat 文件所在目录。
- 所以当 bat 放在项目根目录时，双击即可启动。

### 📁 把 bat 放到其他文件夹使用

如果你想把 bat 复制到任意工作文件夹，并让 Agent 操作那个文件夹，需要把 `AGENT_HOME` 固定为项目代码目录，保留 `WORKSPACE=%~dp0`。

示例：

```bat
set "AGENT_HOME=D:\path\to\agent"
set "WORKSPACE=%~dp0"
```

这样配置后：

- 后端代码始终从 `AGENT_HOME` 指向的项目目录加载。
- bat 放在哪个文件夹，哪个文件夹就是 Agent 的工作区。

如果还想让局域网访问，可以把最后启动行改成：

```bat
python "%AGENT_HOME%\local_terminal_server.py" --host 0.0.0.0 --port 8765 --workspace "%WORKSPACE%" %*
```

## 🧭 三类路径速查

| 名称 | 在哪里配置 | 作用 |
| --- | --- | --- |
| `AGENT_HOME` | `start_agent.bat` / `start_agent.sh` | 后端代码所在目录，里面要有 `local_terminal_server.py` |
| `WORKSPACE` / `--workspace` | 启动命令或 bat | Agent 可以读写和执行命令的沙箱目录 |
| `serverUrl` | 页面设置或 `js/terminal.js` | 前端连接后端的地址，例如 `http://127.0.0.1:8765` |

默认前端地址在 `js/terminal.js`：

```js
serverUrl: 'http://localhost:8765'
```

跨电脑访问时，需要改成：

```text
http://后端电脑IP:8765
```

## 🧯 常见问题

### 🐍 `python --version` 没反应

优先检查：

```powershell
where python
where py
```

如果路径指向 `WindowsApps\python.exe`，关闭 Windows 的 Python 应用执行别名，然后重新安装 Python，并勾选 `Add python.exe to PATH`。

也可以尝试：

```powershell
py --version
py -3 local_terminal_server.py
```

### ⚠️ `python local_terminal_server.py` 执行后马上退出

正常启动后，终端应该一直停留在后端服务运行状态。如果马上回到 PowerShell 提示符，通常说明：

- `local_terminal_server.py` 文件不完整或复制错了。
- 当前目录不是项目根目录。
- 缺少 `server/` 目录。
- Python 环境异常。

检查入口文件末尾是否有：

```python
if __name__ == '__main__':
    main()
```

### 📁 bat 提示找不到 `local_terminal_server.py`

说明 `AGENT_HOME` 没有指向后端项目目录。把 bat 里的路径改成：

```bat
set "AGENT_HOME=D:\path\to\agent"
```

### 🔌 浏览器连接不上后端

检查：

- 后端终端是否仍在运行。
- 地址是否正确：本机通常是 `http://127.0.0.1:8765/`。
- 跨电脑访问时是否用了后端电脑的局域网 IP。
- Windows 防火墙是否放行。
- 前端设置里的本地服务 URL 是否正确。

### 🔁 端口被占用

换一个端口启动：

```powershell
python local_terminal_server.py --port 9000
```

然后前端本地服务 URL 改成：

```text
http://127.0.0.1:9000
```

## 🔐 安全设计

已经实现的防护：

- 本地服务使用 Token 鉴权，浏览器需要授权后才能调用敏感接口。
- 文件操作限制在工作区根目录内，使用 `realpath` / `commonpath` 防止路径越界和 symlink 越界。
- 命令执行前检查危险命令和明显的工作区外路径。
- 多标签/多任务使用独立会话目录状态，避免一个任务切换目录后影响另一个任务。
- 工具权限按类别弹窗确认，并支持本任务允许、永久允许和撤销。
- Git 恢复文件属于高风险操作，执行前需要额外确认。
- API Key、LMS Cookie、本地 Token、永久授权可以一键清除。

仍需注意：

- 不要把 API Key、`~/.aichat_terminal_token`、`lms_tool/.lms_cookie` 提交到 Git。
- `.agent/` 默认被 `.gitignore` 排除，项目记忆可能包含个人偏好、内部路径或待办，不建议直接提交。
- 不要导入不可信备份；自定义工具本质上是在浏览器中执行的 JS 代码。
- 浏览器 IndexedDB 是本地存储，不适合在公共电脑长期保存密钥。

## 🧱 项目结构

```text
.
├── AI-Chat-大模型对话助手.html   # 主入口，可直接打开
├── base.css                      # 通用样式
├── gemini-theme.css              # Gemini 风格主题
├── git-panel.css                 # Git 面板样式
├── lms.css                       # LMS 面板样式
├── local_terminal_server.py      # 本地后端入口
├── requirements.txt              # Python 依赖
├── start_agent.bat               # Windows 启动器
├── start_agent.sh                # Linux / macOS 启动器
├── js/
│   ├── api-adapters.js           # OpenAI / Anthropic / Responses 消息适配
│   ├── api-core.js               # 请求构造、重试、代理、非流式处理
│   ├── api-stream.js             # 流式响应处理
│   ├── api-profiles.js           # 多套 API 配置档案
│   ├── json-editor.js            # 请求预览、模板、Headers、响应、历史
│   ├── terminal.js               # 本地后端调用和权限交互
│   ├── permissions.js            # 权限管理
│   ├── tokens.js                 # Token 估算、统计和压缩
│   ├── token-usage.js            # 全局 Token 使用统计
│   ├── pricing.js                # 模型定价和费用估算
│   ├── project-memory.js         # 项目级记忆
│   ├── plan-core.js / plan-ui.js # 计划模式
│   ├── outline-core.js           # 大纲模式
│   ├── reflection.js             # 师生反思模式
│   ├── mcp-skills.js             # MCP 和本地 Skill 前端集成
│   ├── git-panel.js              # Git 可视化面板
│   └── paper_tools.js            # 论文工具
├── server/
│   ├── handler.py                # HTTP 路由
│   ├── exec.py                   # 命令执行
│   ├── files.py                  # 文件读写
│   ├── git_ops.py                # Git 操作
│   ├── mcp_skills.py             # MCP stdio client + Skill loader
│   ├── proxy.py                  # LLM / LMS 代理和静态文件服务
│   ├── sandbox.py                # 工作区和危险命令限制
│   ├── screenshot.py             # 窗口/屏幕截图
│   └── web.py                    # 搜索与网页读取
├── skill/
│   └── README.md                 # 本地 Skill 目录说明
└── lms_tool/
    ├── lms.py
    ├── README.md
    └── .lms_cookie.example
```

## 🧪 开发特点

- 纯前端零构建：JS 通过 HTML 中的 `<script>` 顺序加载，不依赖打包器。
- 后端轻依赖：主体使用 Python 标准库，按需使用 `requests`、`Pillow`、`pywin32` 和 `psutil`。
- 工具用 JSON schema 描述参数，由模型通过 function calling 调用。
- 可选工具组默认不全部注入，避免工具列表过长；需要时在 UI 中手动启用。
- 状态持久化使用 IndexedDB，支持配置、工具、对话和统计数据的备份恢复。

## 🎯 适合场景

- 本地项目调试和代码修改。
- 长任务规划、执行和验证。
- 论文检索、PDF 阅读和资料总结。
- 多模型 API 调试和网关适配。
- 私有工具、课程系统或内部系统接入。
- 希望 Agent 能做事，但仍需要保留本地控制权的个人工作流。

## 📄 License

仅供个人学习与研究使用。使用第三方模型、搜索、论文、LMS、MCP 或代理服务时，请遵守对应服务条款。
