# 🤖 AI Chat - 大模型对话助手

一个**零构建、纯前端**的大模型对话工具，配套本地工具执行服务、Git 可视化面板与可扩展的工具组机制。

> 单文件 HTML 打开即用，支持函数调用、动态规划、多轮反思、版本快照等多种工作流。

---

## ✨ 特性

### 对话与生成
- 💬 **多 Provider**：OpenAI / Anthropic 兼容格式，一键切换模型
- 🗂️ **配置档案**：保存多套 API 配置（Provider/Key/模型/参数），秒切环境
- 🌐 **流式响应** + 📐 **KaTeX 公式** + 🎨 **代码高亮** + 🌙 **暗色主题**
- 📊 **完整 Token 统计**：估算 + 精确计数 + 自定义定价 + 缓存命中显示
- 🗜️ **自动压缩**：上下文超阈值自动摘要旧消息，支持增量叠加
- 🚦 **请求限流**：每分钟上限、节流、随机延迟，避开服务端 429

### 工作流模式
- 📋 **Plan 模式**：规划 → 审查 → 人工审批 → 分步执行 → 整合（瀑布式）
- 📑 **大纲模式**：模型自维护任务大纲，边做边改（敏捷式，支持暂停/继续/收尾）
- 🎭 **多角色讨论**：双模型互评打分，提升回答质量

### 工具与集成
- 🛠 **函数调用**：通过本地后端在指定目录内执行命令、读写文件、检索网页
- 💾 **Git 可视化面板**：状态/历史/diff/暂存/提交/撤销，纯前端 UI
- 📸 **版本快照工具组**：模型可主动调用 `note_snapshot` / `note_restore` 等做检查点（可选开关）
- 🎓 **教务系统示例工具**：内置一组对接学校 LMS 的查询/下载工具（可选开关，可按需替换为你自己学校的接口）

### 存储与运维
- 💽 **IndexedDB 存储**：突破 localStorage 5MB 上限，支持大附件/长对话
- 💾 **备份/恢复**：JSON 一键导出全量数据
- 🧾 **Trace 日志**：git log 风格记录每次请求/工具调用
- 🔒 **细粒度权限**：多类操作（执行/读/写/追加/改/删/附件/Git 读写）独立授权

---

## 🚀 快速开始

### 1. 启动本地工具后端（可选，需要函数调用才用）

```bash
pip install -r requirements.txt
python local_terminal_server.py
```

默认监听 `127.0.0.1:8765`，Token 自动生成到 `~/.aichat_terminal_token`。
启动时所在目录会作为模型可访问的**根目录**，所有文件操作限制在内。

### 2. 打开主界面

直接用浏览器打开 `AI-Chat-大模型对话助手.html` 即可。
首次使用请点击右上角 **⚙ 设置** 填入 API Key、模型名等。

### 3. 启用可选工具组（按需）

默认只暴露一组通用工具给模型。如需让模型使用其它能力：

- 工具面板底部 → **💾 启用快照工具**（+5 个，需要当前目录是 Git 仓库）
- 工具面板底部 → **🎓 启用教务工具**（需要先配好对应 Cookie，详见 [`lms_tool/README.md`](lms_tool/README.md)）

---

## 📁 目录结构

```
.
├── AI-Chat-大模型对话助手.html   # 主入口（单文件 HTML）
│
├── base.css                      # 通用样式
├── lms.css                       # 教务面板样式
├── git-panel.css                 # Git 面板样式
│
├── main.js                       # 启动入口（init 钩子）
├── state.js                      # 全局 state + 内置工具注入 + 兼容迁移
├── config.js                     # 常量、Provider 预设、预设 Prompt、内置工具定义
├── utils.js                      # toast / 转义 / 信息栏刷新等通用
├── theme.js                      # 亮/暗主题切换
│
├── idb-store.js                  # IndexedDB 存储层（同步代理 + 异步持久化）
├── api-profiles.js               # API 配置档案（多套 Key/Provider 切换）
│
├── chat.js                       # 对话列表 + 消息渲染 + onSend 入口
├── markdown.js                   # Markdown / 数学 / 代码高亮渲染
│
├── api-adapters.js               # OpenAI / Anthropic 消息格式适配
├── api-core.js                   # buildRequestBody + callAPI + 流式/非流式处理
├── api-stream.js                 # 流式 RAF 节流 + stopGenerate
│
├── plan-core.js                  # Plan 模式核心逻辑（规划 / 审查 / 执行）
├── plan-ui.js                    # Plan 模式 UI 渲染 + 设置面板
│
├── outline-prompts.js            # 大纲模式提示词 + 隐藏工具定义
├── outline-core.js               # 大纲模式主循环 + 工具处理 + 保底收尾
├── outline-render.js             # 大纲模式 UI 渲染 + 用户介入操作
│
├── reflection.js                 # 多角色讨论模式
│
├── tools.js                      # 工具管理（增删改查、一键启停可选工具组）
├── terminal.js                   # 本地服务调用 + 权限弹窗 + Token 自取
├── permissions.js                # 工具权限管理面板
│
├── git-panel.js                  # Git 可视化管理面板（状态/历史/diff/提交/回退）
│
├── settings.js                   # 设置面板逻辑
├── backup.js                     # 备份 / 导入 / 恢复
├── json-editor.js                # 请求 JSON 查看器 + 自定义模板 + 历史
│
├── pricing.js                    # 模型定价管理（输入/输出/缓存/汇率）
├── tokens.js                     # Token 估算 + 精确计数 + 自动压缩
├── rate-limiter.js               # 请求频率限制（每分钟上限、节流、随机延迟）
├── trace.js                      # Trace 日志（git log 风格）
│
├── lms.js                        # 教务系统数据层（Cookie / API / 渲染 / 工具实现）
├── lms_panel.js                  # 教务系统面板抽屉 UI
│
├── local_terminal_server.py      # 本地工具执行后端（标准库为主）
├── lms_tool/
│   ├── lms.py                    # 教务系统命令行助手
│   ├── README.md
│   ├── .lms_cookie.example       # Cookie 模板
│   ├── data/                     # 缓存（.gitignore）
│   └── downloads/                # 下载文件（.gitignore）
├── requirements.txt
└── .gitignore
```

> 💡 **加载顺序很重要**：所有 JS 在 HTML 末尾按依赖顺序串行 `<script>` 加载，
> 大致是 `config → state → utils → idb-store → adapter → core → 上层模式 → UI → chat → main`。

---

## 🧰 内置工具一览

工具分三组，**默认只注入基础组**给模型，其它需手动启用：

### 📝 基础组（13 个，默认开启）

| 工具 | 用途 |
|------|------|
| `execute_action` | 在本地文件夹中执行任务指令（命令行） |
| `read_note` / `save_note` / `append_note` / `edit_note` / `delete_note` | 文档增删改查 |
| `list_notes` / `find_in_notes` | 目录浏览与全文搜索 |
| `get_current_time` | 当前时间 |
| `calculator` | 数学表达式计算 |
| `attach_file` | 把图片/PDF 加入对话供多模态查看 |
| `web_search` / `fetch_url` | 联网搜索与网页正文加载 |

### 💾 快照组（5 个，可选）—— Git 工具的模型接口

| 工具 | 用途 |
|------|------|
| `note_status` | 查看仓库状态 |
| `note_history` | 提交历史 |
| `note_diff` | 文件 diff |
| `note_snapshot` | 主动打快照（commit） |
| `note_restore` | 回退到指定快照 |

### 🎓 教务组（8 个，可选）—— 学校教务系统示例

> 内置示例对接的是某高校的 LMS，使用前请阅读 [`lms_tool/README.md`](lms_tool/README.md)。
> 如果你的学校用的是别的系统，可以参考 `lms.js` 替换为对应接口。

| 工具 | 用途 |
|------|------|
| `lms_status` | 检查 Cookie 是否有效 |
| `lms_courses` / `lms_assignments` / `lms_assignment_detail` | 课程与作业查询 |
| `lms_resources` / `lms_download_resource` | 课件浏览与下载 |
| `lms_notifications` / `lms_grades` | 通知和成绩 |

---

## 🛡️ 安全说明

### ✅ 已做

- 后端运行目录在启动时锁定（基于 `realpath`，防 symlink 越狱）
- 危险命令黑名单（`rm -rf` / `format` / `shutdown` / fork bomb / `eval` / `base64|sh` 等）
- **Token 鉴权**（自动写到 `~/.aichat_terminal_token`，权限 600）
- **CORS Origin 白名单**（仅 localhost / 127.0.0.1 / file:// 可访问）
- **多类操作权限**（执行/读/写/追加/改/删/附件/Git 读/Git 写/Git 回退）每次弹窗确认，可勾选「永久允许」
- 自定义工具代码导入时**二次确认**（含代码预览）
- 一键**清除所有凭证**（设置 → 工具权限管理 → 危险区）

### ⚠️ 你需要注意

- **永远不要**把 `lms_tool/.lms_cookie`、`~/.aichat_terminal_token`、API Key 提交到 Git
- **永远不要**导入来路不明的备份文件（自定义工具是 JS 代码，等同于让对方在你浏览器里执行任意脚本）
- API Key / Cookie 默认存在 IndexedDB，**和你浏览器登录态在一个安全域**，请勿在公共电脑使用
- `note_restore` 工具会强制回退文件，**未提交的改动会丢失**，调用时务必看清提示再确认

---

## ⚡ 性能与缓存

### Prompt Caching 优化

- `system` 字段保持稳定（不混入动态摘要），最大化各家 API 的 prefix cache 命中率
- 摘要由适配器自行注入到 messages 数组中（Anthropic: prepend 到首条 user；OpenAI: 作为 system message）
- 多轮对话采用追加式历史，工具结果原样保留，前缀越积越长越省钱

### 存储层

- 默认使用 **IndexedDB**（异步落盘 + 同步代理 API，业务层无感知）
- 大附件（>100KB 的图片/二进制）序列化时自动剥离 `data` 字段，防撑爆存储
- 旧用户从 localStorage 自动迁移，无需手动操作

---

## 🧰 开发约定

- **纯前端零构建**：所有 JS 用 `<script>` 顺序加载，全局函数互调；不用 ESM、不打包
- **持久化**：IndexedDB（保留同步 API 风格，内部异步落盘）
- **后端**：仅依赖 Python 标准库 + `requests`（教务助手用）
- **工具命名风格**：基础笔记类工具统一使用 `xxx_note` 命名
- **可选工具组**：通过 `OPTIONAL_TOOL_NAMES` 白名单首次跳过自动注入，需用户手动启用

---

## 📜 License

仅供个人学习与研究使用。请遵守相关服务的使用条款。
