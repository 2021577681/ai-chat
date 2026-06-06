# AI Chat - 本地 Agent 工作台

一个零构建、纯前端的大模型 Agent 工作台。前端可以直接用浏览器打开，配合本地 Python 服务后，模型可以在受控目录内读写文件、执行命令、检索网页、调用 Git、连接 MCP 工具，并通过计划模式 / 大纲 / 多角色反思等模式完成复杂任务。

它不是单纯的聊天页面，而是一个可改请求、可看成本、可接工具、可落地执行的个人 AI 控制台。

## 核心优势

- **多模型多接口**：支持 OpenAI、OpenAI Responses、Anthropic、DeepSeek、Qwen、智谱和自定义兼容接口，适合在多个模型和代理网关之间切换。
- **请求完全可观察**：内置 JSON 请求查看器，可以预览实际发送的 URL、Headers、Body，查看原始响应、复制 cURL、保存请求历史。
- **请求可定制**：支持自定义请求体模板和额外请求头，适合兼容非标准 API、代理服务、特殊网关、需要定制 User-Agent 的场景。
- **Token 和费用透明**：对话顶部实时显示 Token 占用，支持 API usage 精确统计、Anthropic count_tokens、缓存命中、thinking/reasoning token、全局按模型汇总和费用估算。
- **本地可执行**：通过本地后端把模型接到真实工作目录，可以执行命令、读写文件、搜索文件、截图、调用 Git，而不是只停留在建议层面。
- **人可控的 Agent 流程**：计划模式先规划再审批，大纲模式边做边维护任务状态，多角色讨论模式可互评打分。
- **可扩展工具生态**：支持自定义 JS 工具、本地 Skill、MCP stdio 工具、论文工具、LMS 示例工具和 Git 快照工具组。
- **项目级记忆**：可在更多菜单显式开启。开启后才会检测当前 workspace 的 `.agent/memory.md`，不存在时询问是否生成草稿，确认保存后后续自动注入项目背景。
- **数据在本地**：对话、配置、工具、统计数据默认存放在浏览器 IndexedDB 中，支持备份和恢复。

## 功能总览

### 对话与模型

- 多 Provider 配置：OpenAI、OpenAI Responses、Anthropic、DeepSeek、Qwen、智谱、自定义。
- 多套 API 配置档案：Provider、Base URL、Path、API Key、模型名、温度、最大输出、上下文上限等可以保存并快速切换。
- 流式输出、停止生成、自动重试、请求超时、频率限制、随机延迟。
- Markdown、代码高亮、KaTeX 公式、图片/PDF/文本附件。
- OpenAI / Anthropic 消息格式适配，自动修复部分 tool call / tool result 序列问题。

### 请求调试与接口适配

- 请求 JSON 预览：展示 `_meta`、脱敏后的 `_headers` 和实际 `_body`。
- 自定义 JSON 模板：可改请求体结构，支持 `{{model}}`、`{{messages}}`、`{{system}}`、`{{temperature}}`、`{{max_tokens}}`、`{{stream}}`、`{{tools}}` 占位符。
- 自定义请求头：可追加额外 Headers，用于代理网关、兼容接口、特殊鉴权或 User-Agent 伪装。
- 原始响应查看：保留最近若干次响应，支持查看非流式 JSON 和原始 SSE 流。
- 请求历史：保存 URL、Headers、Body、响应摘要或错误信息，便于复现问题。
- 一键复制请求体和 cURL，方便拿到终端或 Postman 中调试。

### Token、价格与成本统计

- 当前对话 Token 条：输入占用、输出累计、上下文比例、消息数、缓存命中、thinking/reasoning token。
- 精确统计：优先使用 API 返回的 `usage`，Anthropic 可额外调用 `count_tokens` 获取当前上下文精确输入。
- 全局 Token 使用统计：独立账本记录每次请求，删除对话后也能保留历史统计。
- 按模型聚合：请求数、输入 token、输出 token、缓存读、思考 token、费用。
- 请求趋势曲线：按日期查看请求次数随时间变化。
- 定价管理：自定义不同模型的输入、输出、缓存读取单价和汇率，用于估算美元/人民币成本。
- 自动压缩：上下文超过阈值后自动摘要旧消息，也支持手动压缩。

### Agent 工作流

- **计划模式**：模型先生成执行计划，工具开启时可先侦察项目；老师审查后由规划者根据意见自主修订，用户审批后再逐步执行，最后整合答案。
- **大纲模式**：模型在执行过程中维护任务大纲，支持暂停、继续、中途注入用户意见、达到轮数上限后强制收尾。
- **多角色讨论**：使用学生/老师式互评提示词，让另一个角色对答案评分并提出修改意见。
- **项目记忆**：默认关闭；开启后读取/生成 `.agent/memory.md`，用于保存项目定位、启动方式、架构约定、关键文件、已知坑点和长期待办。
- 工具调用循环：在计划模式和大纲模式中，模型可以连续调用文件、终端、网页、MCP 等工具推进任务。

### 本地工具能力

基础工具默认可用：

| 工具 | 能力 |
| --- | --- |
| `execute_action` | 在工作区内执行命令，可选择新终端窗口运行长任务 |
| `read_note` / `save_note` / `append_note` / `edit_note` / `delete_note` | 文本文件读写、追加、精确替换、删除 |
| `list_notes` / `find_in_notes` | 目录浏览和全文搜索 |
| `attach_file` | 把本地图片、PDF、文本附件加入对话 |
| `web_search` / `fetch_url` | 联网搜索和网页正文提取 |
| `ai_screenshot` / `list_windows` | 截取全屏或指定窗口，辅助模型观察界面 |
| `get_current_time` / `calculator` | 当前时间和数学表达式计算 |
| `read_skill` | 按需读取已扫描的本地 Skill |

可选工具组：

| 工具组 | 能力 |
| --- | --- |
| Git 快照工具 | `note_status`、`note_history`、`note_diff`、`note_snapshot`、`note_restore` |
| 论文工具 | `arxiv_search`、`semantic_scholar_search`、`fetch_pdf_text` |
| LMS 工具 | 课程、待办、作业详情、课件、下载、Cookie 状态等示例接口 |
| MCP 工具 | 配置 stdio MCP server，拉取工具列表并映射为模型可调用工具 |
| 自定义工具 | 在工具面板中写 JS 工具，定义参数 schema 后让模型调用 |

## 快速开始

### 1. 安装依赖并启动本地后端

如果只想聊天，可以直接打开 HTML；如果需要文件、命令、Git、网页代理、MCP、截图等能力，需要启动本地服务。

```bash
pip install -r requirements.txt
python local_terminal_server.py
```

默认监听 `127.0.0.1:8765`。服务启动目录会作为模型可访问的工作区根目录，文件操作会被限制在这个目录内。

### 2. 打开主界面

用浏览器打开：

```text
AI-Chat-大模型对话助手.html
```

首次使用进入设置，填入 API Key、Base URL、模型名和接口格式。需要经过本地代理访问 API 时，先在设置里拉取本地终端 Token。

### 3. 按需开启工具

- 在工具面板启用 Git 快照工具、论文工具、LMS 工具。
- 在 MCP / Skill 面板添加 MCP server 或扫描 `skill/` 目录。
- 在更多菜单开启项目记忆后，agent 才会检测或生成 `.agent/memory.md`。
- 在 JSON 请求编辑器中调整请求体模板和额外请求头。
- 在定价管理中配置模型价格，用于费用估算。

## 目录结构

```text
.
├── AI-Chat-大模型对话助手.html   # 主入口，浏览器直接打开
├── base.css                      # 通用样式
├── git-panel.css                 # Git 面板样式
├── lms.css                       # LMS 面板样式
├── local_terminal_server.py      # 本地工具后端入口
├── requirements.txt              # Python 依赖
├── start_agent.bat / start_agent.sh
├── js/
│   ├── api-adapters.js           # OpenAI / Anthropic / Responses 消息适配
│   ├── api-core.js               # 请求体构造、重试、代理、非流式处理
│   ├── api-stream.js             # 流式响应处理
│   ├── api-profiles.js           # 多套 API 配置档案
│   ├── json-editor.js            # 请求预览、模板、Headers、响应、历史
│   ├── tokens.js                 # Token 估算、精确统计、压缩
│   ├── token-usage.js            # 全局 Token 使用统计
│   ├── pricing.js                # 模型定价和费用估算
│   ├── project-memory.js         # 项目级记忆读取、生成和注入
│   ├── plan-core.js / plan-ui.js
│   ├── outline-core.js / outline-render.js / outline-prompts.js
│   ├── tools.js / terminal.js / permissions.js
│   ├── mcp-skills.js             # MCP 和本地 Skill 前端集成
│   ├── git-panel.js              # Git 可视化面板
│   ├── paper_tools.js            # arXiv / Semantic Scholar / PDF 文本
│   └── ...
├── server/
│   ├── handler.py                # HTTP 路由
│   ├── exec.py                   # 命令执行
│   ├── files.py                  # 文件读写
│   ├── git_ops.py                # Git 操作
│   ├── mcp_skills.py             # MCP stdio client + Skill loader
│   ├── proxy.py                  # LLM 代理
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

## 安全设计

已实现的防护：

- 本地服务使用 Token 鉴权，浏览器端需要授权后才能调用。
- 文件操作和 MCP server cwd 限制在工作区根目录内。
- 使用 `realpath` / `commonpath` 防止路径越界和 symlink 越狱。
- 命令执行前检查危险命令和明显的工作区外路径。
- 工具权限按类别弹窗确认，包括执行、读、写、删除、附件、MCP、Git 读写、Git 回退。
- 自定义工具导入有二次确认和代码预览。
- API Key、LMS Cookie、本地 Token 等可以一键清除。

仍需注意：

- 不要把 API Key、`~/.aichat_terminal_token`、`lms_tool/.lms_cookie` 提交到 Git。
- `.agent/` 默认被 `.gitignore` 排除，项目记忆可能包含个人偏好、内部路径或待办，不建议直接提交。
- 不要导入不可信备份，自定义工具本质上是浏览器里执行的 JS 代码。
- `note_restore` 会覆盖工作区文件，执行前要确认目标 commit 和 path。
- 浏览器 IndexedDB 是本地存储，不适合在公共电脑长期保存密钥。

## 开发约定

- 纯前端零构建：JS 通过 HTML 中的 `<script>` 顺序加载，不使用打包器。
- 状态持久化使用 IndexedDB，并保留类似同步存取的业务接口。
- 后端尽量保持轻依赖，主要使用 Python 标准库，部分网络功能依赖 `requests`。
- 内置工具以 JSON schema 描述参数，由模型通过 function calling 调用。
- 可选工具组默认不全部注入，避免工具列表过长；需要时在 UI 中手动启用。

## License

仅供个人学习与研究使用。使用第三方模型、搜索、论文、LMS 或代理服务时，请遵守对应服务条款。
