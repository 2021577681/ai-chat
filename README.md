# 🤖 AI Chat - 大模型对话助手

一个**零构建、纯前端**的大模型对话工具，配套本地工具执行服务和西交大 LMS 助手。

> 单文件 HTML 打开即用，支持工具调用、动态规划、师生互评等多种工作流。

---

## ✨ 特性

- 💬 **多 Provider**：OpenAI / Anthropic 兼容格式，自由切换模型
- 📋 **Plan 模式**：规划 → 审查 → 人工审批 → 分步执行 → 整合（瀑布式）
- 📑 **大纲模式**：AI 自维护工作大纲，边做边改（敏捷式，支持暂停/继续/收尾）
- 🎭 **师生讨论**：双模型互评打分，提升回答质量
- 🛠 **工具调用**：通过本地后端在**沙箱目录**内执行 Shell / 读写文件
- 🎓 **LMS 集成**：西安交大学习管理系统作业、课件查询与下载
- 🌐 **流式响应** + 📐 **KaTeX 公式** + 🎨 **代码高亮** + 🌙 **暗色主题**
- 📊 完整的 Token 统计 / 请求频率限制 / Trace 日志 / 备份恢复

---

## 🚀 快速开始

### 1. 启动本地工具后端（可选，需要工具调用才用）

```bash
pip install -r requirements.txt
python local_terminal_server.py
```

默认监听 `127.0.0.1:8765`，Token 自动生成到 `~/.aichat_terminal_token`。
**沙箱根目录**为启动时的工作目录，所有文件操作被限制在内。

### 2. 打开主界面

直接用浏览器打开 `AI-Chat-大模型对话助手.html` 即可。
首次使用请点击右上角 **⚙ 设置** 填入 API Key、模型名等。

### 3. 配置 LMS 助手（可选）

详见 [`lms_tool/README.md`](lms_tool/README.md)。简而言之：

```bash
# 二选一保存 Cookie
export LMS_COOKIE="..."                        # Linux/Mac
setx   LMS_COOKIE "..."                        # Windows
# 或写入 lms_tool/.lms_cookie 文件

cd lms_tool && python lms.py login             # 验证
```

---

## 📁 目录结构

```
.
├── AI-Chat-大模型对话助手.html   # 主入口（单文件 HTML）
│
├── base.css                      # 通用样式（按钮、卡片、模态框…）
├── lms.css                       # LMS 学习面板专属样式
│
├── main.js                       # 启动入口（init 钩子）
├── state.js                      # 全局 state + 持久化 + 存储兜底
├── config.js                     # 常量、Provider 预设、预设 Prompt、内置工具定义
├── utils.js                      # toast / 转义 / 沙箱信息栏刷新等通用
├── theme.js                      # 亮/暗主题切换
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
├── reflection.js                 # 师生讨论模式
│
├── tools.js                      # 工具管理（增删改查、启停）
├── terminal.js                   # 本地终端调用 + 权限弹窗 + Token 自取
├── permissions.js                # 工具权限管理面板
│
├── settings.js                   # 设置面板逻辑
├── backup.js                     # 备份 / 导入 / 恢复
├── json-editor.js                # 请求 JSON 查看器 + 自定义模板 + 历史
│
├── tokens.js                     # Token 估算 + 精确计数 + 自动压缩
├── rate-limiter.js               # 请求频率限制（每分钟上限、节流、随机延迟）
├── trace.js                      # Trace 日志（git log 风格）
│
├── lms.js                        # LMS 数据层（Cookie / API / 渲染 / 工具实现）
├── lms_panel.js                  # LMS 学习面板抽屉 UI
│
├── local_terminal_server.py      # 本地工具执行后端（标准库 + 沙箱）
├── lms_tool/
│   ├── lms.py                    # LMS 命令行助手
│   ├── README.md
│   ├── .lms_cookie.example       # Cookie 模板
│   ├── data/                     # 缓存（.gitignore）
│   └── downloads/                # 下载文件（.gitignore）
├── requirements.txt
└── .gitignore
```

> 💡 **加载顺序很重要**：所有 JS 在 HTML 末尾按依赖顺序串行 `<script>` 加载，
> 大致是 `config → state → utils → adapter → core → 上层模式（plan/outline/reflection）→ UI → chat → main`。

---

## 🛡️ 安全说明（重要！）

### ✅ 已做

- 后端 **沙箱根目录** 锁定（基于 `realpath`，防 symlink 越狱）
- 危险命令黑名单（`rm -rf` / `format` / `shutdown` / fork bomb / `eval` / `base64|sh` 等）
- **Token 鉴权**（自动写到 `~/.aichat_terminal_token`，权限 600）
- **CORS Origin 白名单**（仅 localhost / 127.0.0.1 / file:// 可访问）
- 6 类操作（执行 / 写 / 追加 / 改 / 删 / 加载附件）每次弹窗确认，可勾选「永久允许」
- 自定义工具代码导入时 **二次确认**（含代码预览）
- 一键 **清除所有凭证**（设置 → 工具权限管理 → 危险区）

### ⚠️ 你需要注意

- **永远不要**把 `lms_tool/.lms_cookie`、`~/.aichat_terminal_token`、API Key 提交到 Git
- **永远不要**导入来路不明的备份文件（自定义工具是 JS 代码，等同于让对方在你浏览器里执行任意脚本）
- API Key / Cookie 默认存在 `localStorage`，**和你浏览器登录态在一个安全域**，请勿在公共电脑使用

---

## 🧰 开发约定

- **纯前端零构建**：所有 JS 用 `<script>` 顺序加载，全局函数互调；不用 ESM、不打包
- **持久化**：`localStorage`（未来计划迁移 IndexedDB）
- **后端**：仅依赖 Python 标准库 + `requests`（LMS 助手用）
- **大附件保护**：图片/二进制 > 100KB 序列化时自动剥离 `data` 字段，避免撑爆 localStorage

---

## 📜 License

仅供个人学习与研究使用。请遵守相关服务的使用条款。
