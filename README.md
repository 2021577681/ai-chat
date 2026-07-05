# 🐍 Snake Agent / AI Chat Local Agent Workbench

> 一个**本地优先、可观察、可授权、带超多实用小功能、能真正执行任务**的大模型 Agent 工作台。

Snake Agent 不是一个只能聊天的网页壳，也不是只能在终端里改代码的单一 Coding Agent。它更像一个「个人 AI 操作系统」：聊天、写代码、跑命令、读写文件、Git、PPT、网页搜索、LMS 学习系统、远程服务器、截图、音乐、任务队列、权限审计、成本统计……全部集成在一个本地工作台里。✨

---

## 🚀 一句话启动

### Windows

双击：

```text
start_agent.bat
```

脚本会自动：

1. 打开前端页面 `AI-Chat-大模型对话助手.html`
2. 启动本地后端 `local_terminal_server.py`
3. 使用当前项目目录作为默认沙箱目录

### Linux / macOS

```bash
AGENT_HOME=/path/to/agent bash start_agent.sh
```

或先编辑 `start_agent.sh` 顶部的：

```bash
AGENT_HOME="$HOME/agent"
```

再运行：

```bash
bash start_agent.sh
```

---

## 🧩 这个项目是什么？

Snake Agent 是一个浏览器前端 + Python 本地后端组成的本地 Agent Workbench：

- 🌐 前端：单页 HTML + CSS + JavaScript，无需复杂前端构建
- 🐍 后端：Python 标准库 HTTP Server + 模块化 Mixin
- 🧰 能力：本地命令、文件系统、Git、网页、PPT、截图、LMS、远程部署等
- 🔒 边界：所有危险操作都围绕本地沙箱、权限、审计、确认机制展开
- 🧠 模型：适配 OpenAI / Anthropic / Responses API 以及兼容格式中转服务

---

## ✨ 核心优势：为什么它比 Codex / Claude Code / Kimi Code 更「个人全能」？

Codex、Claude Code、Kimi Code 等工具很强，但它们大多聚焦在**代码生成、终端任务、工程修改**。Snake Agent 的定位更宽：它是一个为个人日常学习、开发、汇报、远程控制和自动化而做的本地 Agent 工作台。

| 能力维度 | 常见 Coding Agent | Snake Agent |
|---|---|---|
| 代码修改 | ✅ 强 | ✅ 支持文件读写、patch、checkpoint、终端验证 |
| 本地图形化工作台 | 部分支持 | ✅ 完整 Web UI、侧栏、面板、状态栏 |
| 沙箱目录可视化 | 较少 | ✅ 可选工作区、文件树、路径状态 |
| 任务授权与审计 | 有但偏工程 | ✅ 权限弹窗、Shell 审计、安全记录 |
| 多模型配置 | 有限或绑定平台 | ✅ API Profile、多格式适配、自定义请求模板 |
| 成本/Token 统计 | 部分有 | ✅ Token、价格、缓存、思考消耗、会话统计 |
| LMS/校园系统 | ❌ 基本没有 | ✅ 成绩、课表、考勤、空教室、评教、培养方案 |
| PPT 生成流水线 | ❌ 通常没有 | ✅ HTML 图片式 PPT、任务控制、模板技能 |
| 本地音乐播放器 | ❌ 没有 | ✅ 导入、列表、播放本地音乐 |
| 截图/窗口理解 | 部分依赖外部 | ✅ 全屏/窗口截图，多显示器，后台窗口策略 |
| 远程服务器部署 | 一般要手配 | ✅ SSH 自动上传后端、启动远程 Agent、建隧道 |
| 微信/远程控制桥接 | ❌ 通常没有 | ✅ 微信桥接与远程控制模块 |
| 辩论/并发请求 | 较少 | ✅ Debate Mode、并发请求、队列化任务 |
| 项目记忆/指令 | 有 | ✅ Project Instructions + Project Memory + Skills |

> 简单说：别人更像「AI 程序员」，Snake Agent 更像「带生活技能、学习技能、远程技能和安全审计的个人 Agent 控制台」。🐍

---

## 🧠 功能点总览

下面按产品模块列举本项目的主要功能点。

### 1. 💬 AI 对话与会话管理

- 新建、切换、保存多轮对话
- Markdown 渲染与代码块展示
- 流式输出与中断控制
- 图片、PDF、文本附件输入适配
- 会话摘要与长上下文压缩
- 对话历史本地持久化
- 对话列表侧栏管理
- 反思模式与回答质量增强

### 2. 🔌 多模型 API 与配置系统

- OpenAI Chat Completions 格式适配
- OpenAI Responses API 格式适配
- Anthropic / Claude Messages 格式适配
- DeepSeek、Kimi、兼容 OpenAI 的中转服务支持
- API Key、Base URL、模型名配置
- API Profile 多配置档保存、复制、重命名、删除
- 自定义请求模板
- 流式/非流式请求切换
- Tool Call 消息序列自动修复
- Anthropic Tool Use / Tool Result 序列修复
- 请求速率限制与并发控制

### 3. 🛠 Agent 工具调用系统

- 本地命令执行 `execute_action`
- 终端窗口打开与命令运行
- 文件读取、写入、追加、编辑
- Unified Diff / Patch 应用
- 删除、重命名、创建文件/目录
- 文件搜索与目录浏览
- 二进制文件读取与附件预览
- LaTeX 编译
- 默认应用打开文件
- 工具调用结果追踪
- 任务队列与工具执行状态展示

### 4. 📁 工作区与文件资源管理器

- 沙箱工作区选择
- 当前工作区状态显示
- 文件树浏览
- 上级目录、刷新、文件信息查看
- 防越界路径保护
- 多会话独立 cwd 管理
- 最近工作区恢复

### 5. 🧯 安全、权限与审计

- 工具调用授权机制
- Shell 命令审计
- 敏感信息日志脱敏
- Git diff 敏感信息扫描
- API Key / Token / 密码 / 私钥规则检测
- 写文件前自动 checkpoint
- checkpoint 列表查看与恢复
- 沙箱目录边界限制
- 安全记录面板
- 隐私保护与附件裁剪策略

### 6. 🌐 网络搜索与网页读取

- 无需 API Key 的网页搜索
- Bing / Google / DuckDuckGo / 搜狗 / 360 / 百度多引擎回退
- 国内 / 全球区域偏好
- 代理搜索配置
- URL 正文抓取
- HTML 清洗与正文提取
- 搜索结果去重

### 7. 🧬 Git 工程面板

- Git 仓库检查与初始化
- status / log / diff 查看
- add / unstage / commit
- checkout 单文件
- show file
- branch 创建、切换、删除、重命名
- revert
- reset mixed / hard
- reflog 与 reset 到引用
- remote 添加、删除、改 URL
- fetch / pull / push
- push 前敏感信息扫描
- 默认 `.gitignore` 模板

### 8. 🖥 本地终端与命令执行

- 后端执行命令并返回 stdout / stderr
- Windows 编码自动处理
- `cd` 拦截与 cwd 维护
- 打开系统终端窗口
- 远程执行入口
- 命令超时与错误显示

### 9. 📊 Token、价格与可观察性

- 输入 / 输出 Token 估算
- 缓存 Token、思考 Token 统计
- 模型价格配置
- 单次请求成本估算
- 会话级统计
- 状态栏开关
- Trace 调试面板
- 请求、工具、任务过程可视化

### 10. 🧭 计划、大纲与任务闭环

- Plan 模式
- Outline 模式
- 大纲渲染与状态管理
- 任务队列
- 定时任务
- 并发请求管理
- Debate Mode 多模型/多观点辩论
- 目标、验证、总结式工程闭环支持

### 11. 🎓 LMS / 校园学习系统工具

- LMS 登录
- Cookie / 账号密码凭据管理
- 课程列表查询
- 作业 Todo 查询
- 作业详情查看
- 课件资料列表
- 附件下载
- upload_id 诊断
- 课程关键词搜索
- 成绩查询
- 课表查询
- 空闲教室查询
- 考勤查询
- 一键评教
- 个人培养方案查询
- LMS 代理请求

### 12. 📽 PPT / 汇报生成流水线

- 一键生成 PPT
- HTML 图片式 PPT 工作流
- PPT 后台任务启动 / 暂停 / 恢复 / 取消
- 任务状态轮询
- 用户反馈继续生成
- 项目汇报模板 Skill
- 图片生成/插图流水线接口
- `python-pptx` 支持

### 13. 🧩 Skills / MCP 扩展机制

- 本地 Skill 目录扫描
- Skill Catalog 注入提示词
- 按需读取完整 `SKILL.md`
- MCP 工具列表读取
- MCP 工具调用
- 本地 references / scripts / templates 结构支持

### 14. 🖼 截图与窗口辅助

- 全屏截图
- 指定窗口截图
- 多显示器截图
- Windows 窗口查找
- PrintWindow 后台截图策略
- 浏览器 / Electron / Win32 不同截图策略
- 截图自动保存到当前工作目录
- Base64 预览返回

### 15. 🛰 远程 Agent 与 SSH 隧道

- SSH 命令解析
- 自动打包最小后端
- scp 上传到远程服务器
- 远程 `nohup` 启动 Agent
- 远程仅监听 `127.0.0.1`
- 本地端口转发隧道
- 远程心跳检测
- 远程工作区配置
- 远程命令执行

### 16. 📱 远程控制与微信桥接

- 远程控制模块
- 远程连接状态维护
- 微信桥接后端
- 心跳与状态同步
- 移动端/外部入口控制 Agent 的能力基础

### 17. 🎵 本地音乐播放器

- 本地 `music/` 目录扫描
- mp3 / wav / ogg / m4a / flac 等格式支持
- 音频文件导入
- Range 流式播放
- 曲目列表排序
- 音乐文件安全路径限制

### 18. 🧰 文档、论文与辅助工具

- Paper tools 辅助模块
- JSON 编辑器
- 备份与恢复
- 设置页统一管理
- 主题切换
- 项目指令管理
- 项目记忆管理
- Beacon / 状态提示
- 文件预览服务

---

## 🏗 项目结构

```text
agent/
├── AI-Chat-大模型对话助手.html   # 前端入口
├── start_agent.bat               # Windows 一键启动
├── start_agent.sh                # Linux/macOS 启动脚本
├── local_terminal_server.py      # 本地后端入口
├── requirements.txt              # Python 依赖
├── css/                          # UI 样式
├── js/                           # 前端功能模块
├── server/                       # 后端功能模块
├── skill/                        # 本地 Skills 目录
├── lms_tool/                     # LMS 命令行助手
├── music/                        # 本地音乐目录
├── icon/                         # 图标资源
└── vendor/                       # 第三方前端资源
```

---

## 📦 部署与安装

### 1. 环境要求

- Python 3.10+ 推荐
- Node.js 18+，用于 JavaScript 语法检查和 E2E 测试
- npm，用于安装 Playwright 测试依赖
- Windows / Linux / macOS 均可运行基础能力
- Windows 下截图窗口模式需要 `pywin32`
- PPT 能力需要 `python-pptx`
- Web 搜索、LMS 等能力需要 `requests`
- LMS 评教中的部分页面解析需要 `lxml`

### 2. 安装依赖

Python 依赖：

```bash
pip install -r requirements.txt
```

E2E 测试依赖：

```bash
cd test-harness
npm install
npm run install:browser
cd ..
```

如果只想体验基础聊天 + 本地后端，主体后端大量能力使用 Python 标准库；但建议完整安装依赖以启用搜索、LMS、截图、PPT、E2E 测试等能力。

### 3. 质量检查

```bash
quality-check.bat -SkipE2E
```

完整检查含 E2E：

```bash
quality-check.bat
```

### 4. 打包 Release

默认打包会先执行快速质量检查，再生成 release zip 和 SHA256 校验文件：

```bash
build-release.bat
```

常用参数：

```bash
build-release.bat -Version v0.1.0
build-release.bat -FullE2E
build-release.bat -Force
```

发布产物会写入 `release/`，该目录是可再生成的构建产物，已被 `.gitignore` 排除。上传 GitHub Release 后可以删除本地 `release/` 目录。

### 5. 启动后端与前端

#### Windows 推荐方式

```text
双击 start_agent.bat
```

#### 手动启动

```bash
python local_terminal_server.py
```

然后用浏览器打开：

```text
AI-Chat-大模型对话助手.html
```

也可以访问本地服务提供的静态入口：

```text
http://localhost:8765/
```

### 6. 配置模型

打开前端后进入设置页，配置：

- API Key
- Base URL
- Model
- API Format：OpenAI / Anthropic / Responses 等
- 是否流式输出
- 价格与 Token 统计参数

建议把不同供应商保存为不同 API Profile，例如：

- `OpenAI GPT-4.1`
- `Claude Sonnet`
- `DeepSeek Chat`
- `Kimi K2`
- `本地中转服务`

### 7. 配置工作区沙箱

前端左侧「沙箱目录」卡片可以选择 Agent 能访问的工作目录。文件操作、命令执行、Git 操作都会围绕该目录进行，避免误操作系统其他路径。🔒

---

## 🌍 远程服务器部署

Snake Agent 支持把后端自动部署到远程服务器，并通过 SSH 隧道连接。

基本思路：

1. 本地打包 `local_terminal_server.py`、`requirements.txt`、`server/`
2. 通过 `scp` 上传到远程 `~/.snake-agent/current`
3. 远程使用 `nohup` 启动后端
4. 本地建立 `ssh -N -L` 端口转发
5. 前端通过本地隧道访问远程 Agent

你只需要准备可用 SSH：

```bash
ssh user@example.com
```

然后在远程连接面板里填写 SSH 命令即可。远程 Agent 默认仅监听远程机器的 `127.0.0.1`，再通过 SSH 隧道暴露到本地，更安全。🛰

---

## 🎓 LMS 工具使用提示

`lms_tool/` 里还有一个独立命令行助手，可用于查询课程、作业、资料下载等：

```bash
cd lms_tool
pip install requests
python lms.py login
python lms.py courses
python lms.py todos
```

Cookie 可通过环境变量或 `lms_tool/.lms_cookie` 配置。详见：

```text
lms_tool/README.md
```

---

## 🔐 安全建议

- 不要把 API Key、Cookie、Token 提交到 Git
- 推送前使用内置 Git 敏感信息扫描
- 谨慎授权高风险 Shell 命令
- 重要文件修改前保留 checkpoint
- 远程部署优先使用 SSH Key，避免明文密码
- LMS 功能仅用于查询和管理自己的账号数据

---

## 🧪 推荐工作流

### 写代码

1. 选择项目沙箱目录
2. 让 Agent 阅读相关文件
3. 使用 Plan / Outline 拆解任务
4. 使用 patch 修改代码
5. 运行最小验证命令
6. Git 面板查看 diff 并提交

### 做汇报

1. 输入主题和资料
2. 开启 PPT 模式
3. 选择模板 Skill
4. 生成 HTML 图片式 PPT
5. 根据反馈继续修订

### 查学习信息

1. 登录 LMS
2. 查课表 / 成绩 / 作业 / 考勤
3. 下载课件
4. 需要时一键评教或查询培养方案

---

## 🗺 Roadmap 想法

- 更完善的插件市场
- 更强的多 Agent 编排
- 更细粒度的权限策略
- 更漂亮的移动端控制台
- 更多学校 LMS 适配
- 自动生成项目报告 / 周报 / 学习计划

---

## 📜 License

目前主要用于个人学习、开发与本地自动化实验。请遵守第三方模型服务条款、学校/企业系统使用规范，以及你所在地区的法律法规。

---

## 🐍 最后

如果你觉得 Codex、Claude Code、Kimi Code 都很强，但还差一点「我的电脑我做主」的个人工作台味道，那么 Snake Agent 就是为这个方向做的：

> 会写代码，也会管文件；会跑命令，也会查课表；会生成 PPT，也会放音乐；会连服务器，也会保护你的密钥。🎉
