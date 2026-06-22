# 🧠 Snake Chat / AI Chat Local Agent Workbench

一个**本地优先、可观察、可授权、能真正执行任务**的大模型 Agent 工作台。

它不是只有聊天框的网页，也不是把 AI 接进终端后就放手乱跑的脚本。这个项目把 **AI 对话、多模型 API、工具调用、文件读写、终端执行、Git 快照、网页检索、截图观察、MCP、Skill、项目记忆、任务规划、费用统计和请求调试** 放进同一个浏览器工作台里，让 AI 能落地做事，同时让用户始终看得见、管得住。

前端是单页 HTML + 原生 JavaScript，**零构建、零 Node、零 Docker**；后端是本地 Python 服务，负责受控执行文件、终端、Git、截图、网页和代理请求等能力。

---

## 🌟 项目亮点

### 🧩 1. 前端零构建，打开就能用

- 主页面是 `AI-Chat-大模型对话助手.html`，可以直接双击打开。
- 不需要前端打包器，不需要数据库，不需要云部署。
- 启动本地后端后，也可以直接访问 `http://127.0.0.1:8765/`，由 Python 后端托管页面。

### 🛠️ 2. AI 不只会聊天，还能操作本地项目

配合 `local_terminal_server.py` 后端，AI 可以在指定工作区沙箱内：

- 📄 读取、写入、追加、编辑、删除文件
- 🔎 搜索目录和文件内容
- 💻 执行 shell 命令
- 🧷 使用 patch 修改代码
- 🖼️ 截取屏幕或指定窗口
- 🌐 搜索网页、抓取网页正文
- 🧬 查看 Git 状态、diff、历史、提交和恢复
- 🧰 调用自定义工具、MCP 工具和本地 Skill

所有高风险动作都会经过权限确认，不会静默写文件或执行命令。

### 🛡️ 3. 可控权限，不把电脑完全交给 AI

项目的核心创意不是“让 AI 无限自动化”，而是让 AI 能做事，同时保持本地控制权：

- 命令执行、文件写入、删除、截图、Git 写入、MCP 调用等操作会弹窗确认。
- 支持“仅本次允许”“本任务允许”“永久允许”和撤销。
- 后端文件和命令默认锁定在 `--workspace` 指定的沙箱目录里。
- 本地后端使用 Token 鉴权，浏览器需要授权后才能调用敏感接口。
- 支持隐私模式、Shell 审核、安全记录和敏感信息清理。

### 🧾 4. 请求透明，适合调 API 和排错

内置 JSON 查看器，可以看到模型调用到底发了什么：

- 请求 URL、Headers、Body
- 原始响应内容
- 请求历史
- 一键复制请求体
- 一键复制 cURL
- 自定义请求模板和自定义请求头

这对调试 OpenAI 兼容接口、中转网关、本地模型服务、自定义 API Path、CORS 和非标准响应特别有用。

### 🧠 5. 多种工作模式，适合真实长任务

项目内置多种 Agent 工作流，不只是一次问答：

- 📋 **计划模式**：先规划、评审、执行、验证，适合代码修改和复杂任务。
- 📑 **大纲模式**：边做边维护任务大纲，支持暂停、继续、追加意见和强制收尾。
- 👨‍🏫 **师生讨论**：学生回答、老师评审、多轮改进，适合写作、推理、翻译和代码审阅。
- ⚔️ **辩论模式**：正反方和评委模型自动讨论，适合观点碰撞。
- 🧵 **并发请求**：多个独立 AI 同时处理同一条指令，再汇总结果。
- 🧱 **任务队列**：管理自动任务、依赖关系和队列执行。

### 🧰 6. 工具生态可扩展

- 支持自定义 JavaScript 工具，把个人脚本封装成 AI 可调用工具。
- 支持 MCP stdio server，把外部工具生态接入工作台。
- 支持本地 Skill，让 AI 按需读取专业说明、流程规范和项目能力。
- 支持项目指令 `AGENTS.md` 和项目记忆 `.agent/memory.md` 分层注入。

### 📊 7. 使用成本和上下文可观察

- Token 估算和全局使用账本
- 模型价格管理和费用估算
- 上下文长度规则配置
- 自动/手动压缩上下文
- 长工具输出归档，避免对话被超长日志污染
- Trace 面板记录 API、工具、计划、反思等过程

### 🎓 8. 内置一些很个人化的创意功能

- 🎵 AI 完成提示音和本地音乐播放
- 📚 论文检索工具：arXiv、Semantic Scholar、DBLP、OpenAlex、Crossref、PDF 文本提取
- 🎓 西安交大 LMS 面板和 LMS 工具
- 🧪 对话健康检查、信标检测和请求追踪
- 🗂️ 对话管理、文件夹、导出、提示词库
- 💾 配置、工具、模式设置和归档数据的备份恢复

---

## 🧭 功能速览

| 模块 | 能力 |
| --- | --- |
| 💬 对话工作台 | 多模型对话、流式输出、停止生成、附件、Markdown、代码高亮、KaTeX |
| 🔌 API 配置 | 多 Provider、多配置档案、OpenAI/Anthropic/Responses 适配、自定义 Base URL/API Path |
| 🧾 JSON 查看器 | 请求预览、响应查看、请求历史、自定义模板、自定义 Headers、复制 cURL |
| 🛠️ 本地工具 | 命令执行、文件读写、目录搜索、网页搜索、网页抓取、截图、窗口列表 |
| 🧬 Git 管理 | 状态、历史、diff、暂存、提交、分支、远端、reflog、恢复与回退确认 |
| 🧠 Agent 模式 | 计划模式、大纲模式、师生讨论、辩论模式、并发请求、任务队列 |
| 🛡️ 安全控制 | Token 鉴权、权限弹窗、沙箱路径限制、Shell 审核、隐私模式、安全记录 |
| 📊 统计管理 | Token 统计、费用估算、上下文长度、自动压缩、Trace 追踪 |
| 🧩 扩展能力 | 自定义 JS 工具、MCP、Skill、项目指令、项目记忆 |
| 💾 数据管理 | IndexedDB 本地持久化、配置导入导出、备份恢复 |

---

## 📁 项目结构

```text
.
├── AI-Chat-大模型对话助手.html   # 主页面入口，可直接双击打开
├── README.md                     # 项目说明
├── requirements.txt              # Python 后端依赖
├── local_terminal_server.py      # 本地后端启动入口
├── start_agent.bat               # Windows 启动器
├── start_agent.sh                # Linux / macOS 启动器
├── css/                          # 样式
│   ├── base.css
│   ├── gemini-theme.css
│   ├── git-panel.css
│   └── lms.css
├── js/                           # 前端模块
│   ├── state.js                  # 全局状态和设置持久化
│   ├── api-core.js               # 请求构造、代理、Agent loop
│   ├── api-adapters.js           # 模型消息格式适配
│   ├── terminal.js               # 本地后端调用
│   ├── permissions.js            # 权限管理
│   ├── json-editor.js            # JSON 请求查看器
│   ├── plan-core.js / plan-ui.js # 计划模式
│   ├── outline-core.js           # 大纲模式
│   ├── reflection.js             # 师生讨论
│   ├── mcp-skills.js             # MCP / Skill
│   ├── git-panel.js              # Git 面板
│   └── settings-page.js          # 统一设置页
├── server/                       # Python 后端模块
│   ├── handler.py                # HTTP 路由
│   ├── exec.py                   # 命令执行
│   ├── files.py                  # 文件读写
│   ├── git_ops.py                # Git 操作
│   ├── proxy.py                  # LLM / LMS 代理和静态文件服务
│   ├── sandbox.py                # 工作区沙箱和危险命令限制
│   ├── screenshot.py             # 截图
│   ├── web.py                    # 搜索和网页读取
│   └── mcp_skills.py             # MCP / Skill 后端支持
├── skill/                        # 本地 Skill 目录
├── lms_tool/                     # LMS 辅助工具
├── icon/                         # 图标资源
└── music/                        # 提示音和音乐文件
```

---

## 🚀 快速开始

### 1. 安装 Python

需要 Python 3.10 或更高版本。

Windows 安装 Python 时建议勾选：

```text
Add python.exe to PATH
```

检查是否安装成功：

```powershell
python --version
```

如果 Windows 上 `python --version` 没反应，可以尝试：

```powershell
py --version
```

或关闭系统里的 Python 应用执行别名：

```text
设置 -> 应用 -> 高级应用设置 -> 应用执行别名
```

### 2. 安装后端依赖

进入项目目录：

```powershell
cd "D:\path\to\agent"
```

安装依赖：

```powershell
python -m pip install -r requirements.txt
```

可选：使用虚拟环境隔离依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

Linux / macOS：

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
```

### 3. 启动本地后端

在项目目录启动：

```powershell
python local_terminal_server.py
```

默认服务地址：

```text
http://127.0.0.1:8765/
```

默认工作区是你启动命令时所在的目录。也可以显式指定工作区：

```powershell
python local_terminal_server.py --workspace "D:\your-project"
```

如果使用虚拟环境但没有激活：

```powershell
.\.venv\Scripts\python .\local_terminal_server.py --workspace "D:\your-project"
```

### 4. 打开前端

推荐方式：启动后端后，在浏览器打开：

```text
http://127.0.0.1:8765/
```

也可以直接双击：

```text
AI-Chat-大模型对话助手.html
```

首次使用建议进入设置页，配置：

- API Key
- Base URL
- API Path
- 模型名
- 接口格式
- 是否通过本地服务代理
- 本地服务 URL
- 本地后端 Token

如果浏览器直连 LLM 出现 CORS，打开“通过本地服务代理”。

---

## 💻 在其他电脑上使用后端功能

这里分两种情况：**把项目复制到另一台电脑本机使用**，以及 **一台电脑运行后端，另一台电脑通过局域网访问**。

### ✅ 方案 A：复制到另一台电脑，本机使用

适合你想在另一台电脑上完整运行这个工具。

1. 把整个项目文件夹复制到另一台电脑，例如：

```text
D:\tools\agent
```

至少要包含这些文件和目录：

```text
AI-Chat-大模型对话助手.html
local_terminal_server.py
server/
js/
css/
icon/
requirements.txt
start_agent.bat
```

2. 在新电脑安装 Python 3.10+。

3. 安装依赖：

```powershell
cd "D:\tools\agent"
python -m pip install -r requirements.txt
```

4. 启动后端：

```powershell
python local_terminal_server.py
```

5. 浏览器打开：

```text
http://127.0.0.1:8765/
```

这时 AI 的文件读写、命令执行、Git、截图等后端功能，操作的是**新电脑上的工作区**。

### 🌐 方案 B：一台电脑跑后端，其他电脑访问

适合你想把一台电脑作为 Agent 后端主机，另一台电脑只打开浏览器使用。

> ⚠️ 注意：远程浏览器访问的是后端电脑的文件和终端能力，不是访问浏览器所在电脑的文件。
>
> 也就是说，AI 操作的是运行 `local_terminal_server.py` 的那台电脑。

#### 1. 在后端电脑上启动服务

```powershell
python local_terminal_server.py --host 0.0.0.0 --port 8765 --workspace "D:\your-workspace"
```

参数说明：

| 参数 | 含义 |
| --- | --- |
| `--host 0.0.0.0` | 允许局域网内其他电脑访问 |
| `--port 8765` | 后端端口，可以改成其他未占用端口 |
| `--workspace` | AI 允许操作的沙箱目录 |

#### 2. 查后端电脑的局域网 IP

Windows：

```powershell
ipconfig
```

找到类似这样的 IPv4 地址：

```text
192.168.1.23
```

#### 3. 在另一台电脑浏览器访问

```text
http://后端电脑IP:8765/
```

例如：

```text
http://192.168.1.23:8765/
```

#### 4. 修改前端本地服务 URL

如果页面不是从后端地址打开，而是直接打开 HTML，需要在设置页把“本地服务 URL”改成：

```text
http://后端电脑IP:8765
```

例如：

```text
http://192.168.1.23:8765
```

然后点击获取本地 Token。非本机来源获取 Token 时，后端终端可能会要求授权，输入：

```text
y
```

#### 5. 放行防火墙

如果另一台电脑打不开页面，检查：

- 后端终端是否还在运行
- 两台电脑是否在同一个局域网
- 地址是否使用了后端电脑的 IPv4
- Windows 防火墙是否放行 Python
- 路由器/AP 是否开启了客户端隔离
- 端口 `8765` 是否被占用或被拦截

如果端口被占用，换一个端口：

```powershell
python local_terminal_server.py --host 0.0.0.0 --port 9000 --workspace "D:\your-workspace"
```

浏览器改成：

```text
http://后端电脑IP:9000/
```

---

## 🪟 Windows 启动器 start_agent.bat

`start_agent.bat` 适合双击启动后端。它有两个关键路径：

```text
AGENT_HOME = Agent 项目代码目录
WORKSPACE  = AI 允许操作的工作区目录
```

打开 `start_agent.bat`，找到 `AGENT_HOME` 和 `WORKSPACE`：

```bat
set "AGENT_HOME=..."
set "WORKSPACE=%~dp0"
```

含义：

- `AGENT_HOME` 指向这个 Agent 工具本身所在目录。
- `WORKSPACE=%~dp0` 表示 bat 文件放在哪个文件夹，哪个文件夹就是 AI 的沙箱工作区。

### 📦 复制到其他电脑后要改哪里？

如果你把项目复制到另一台电脑，例如：

```text
D:\tools\agent
```

请把 `start_agent.bat` 里的 `AGENT_HOME` 改成：

```bat
set "AGENT_HOME=D:\tools\agent"
```

然后双击 `start_agent.bat` 即可启动。

### 📁 把 bat 放到任意工作文件夹

你可以把 `start_agent.bat` 复制到任何你想让 AI 操作的文件夹里，例如：

```text
D:\my-project\start_agent.bat
```

只要 bat 里的 `AGENT_HOME` 指向 Agent 项目目录：

```bat
set "AGENT_HOME=D:\tools\agent"
set "WORKSPACE=%~dp0"
```

那么：

- 后端代码从 `D:\tools\agent` 加载
- AI 工作区锁定为 `D:\my-project`

如果想让局域网其他电脑访问，把最后一行启动命令改成：

```bat
python "%AGENT_HOME%\local_terminal_server.py" --host 0.0.0.0 --port 8765 --workspace "%WORKSPACE%" %*
```

---

## 🐧 Linux / macOS 启动器 start_agent.sh

给脚本执行权限：

```bash
chmod +x start_agent.sh
```

编辑或指定 `AGENT_HOME`：

```bash
AGENT_HOME=/path/to/agent ./start_agent.sh
```

也可以先导出环境变量：

```bash
export AGENT_HOME=/path/to/agent
./start_agent.sh
```

脚本所在目录会作为 `WORKSPACE`，也就是 AI 的沙箱工作区。

---

## 🔐 安全提醒

这个项目是本地工具，但它具备文件、终端和网络能力，所以建议认真配置边界：

- 不要把服务暴露到公网，只建议在可信局域网使用。
- `--workspace` 尽量指向具体项目目录，不要直接指向整个磁盘。
- 不要提交 API Key、Cookie、Token、私钥等敏感信息。
- 不要把 `~/.aichat_terminal_token` 提交到 Git。
- 不要把 `lms_tool/.lms_cookie` 提交到 Git。
- 公共电脑上不要长期保存 API Key 或本地 Token。
- 导入备份前确认来源可信，自定义 JS 工具本质上会在浏览器里执行代码。

后端已有的防护包括：

- Token 鉴权
- 工作区路径限制
- symlink 越界防护
- 危险命令检查
- 多会话 cwd 隔离
- 高风险工具权限确认
- Git 恢复/回退额外确认
- 隐私模式和 Shell 审核记录

---

## 🧯 常见问题

### `python local_terminal_server.py` 启动后马上退出

正常情况下，后端启动后终端会一直保持运行。如果马上退出，检查：

- 当前目录是否是项目目录
- 是否缺少 `server/`
- Python 版本是否过低
- 依赖是否安装完整
- 端口是否被占用

可以换端口：

```powershell
python local_terminal_server.py --port 9000
```

### 浏览器连不上本地后端

检查设置页里的“本地服务 URL”：

```text
http://127.0.0.1:8765
```

如果是局域网访问，应改成：

```text
http://后端电脑IP:8765
```

### 直连模型 API 报 CORS

在设置里开启：

```text
通过本地服务代理
```

然后确保后端正在运行。

### bat 提示找不到 `local_terminal_server.py`

说明 `AGENT_HOME` 不对。把 `start_agent.bat` 里的路径改成 Agent 项目目录：

```bat
set "AGENT_HOME=D:\tools\agent"
```

### 另一台电脑能打开页面，但工具不能用

通常是 Token 或本地服务 URL 问题：

- 设置页里的本地服务 URL 要填后端电脑 IP。
- 点击获取本地 Token。
- 后端终端提示授权时输入 `y`。
- 检查防火墙是否放行端口。

---

## 🎯 适合场景

- 本地项目开发、调试、重构和文档维护
- 多模型 API 调试和兼容接口测试
- 长任务规划、执行、验证和复盘
- 论文检索、PDF 阅读、资料整理
- 课程 LMS 待办和资料查询
- 私有工具、脚本和工作流接入
- 想让 AI 真正做事，但又不想失去控制权的个人工作台

---

## 📌 项目定位

这是一个面向个人使用的本地 AI Agent 工具。它追求的不是“全自动接管电脑”，而是：

> 让 AI 有能力动手，让用户有能力监督。

如果你需要的是一个能聊天、能调 API、能读写项目、能执行命令、能记录过程、能控制权限的本地工作台，这就是它的核心价值。

---

## 📄 License

仅供个人学习与研究使用。使用第三方模型、搜索、论文、LMS、MCP 或代理服务时，请遵守对应服务条款。
