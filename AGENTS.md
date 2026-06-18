# AGENTS.md

## 项目定位

这是一个本地运行的 AI Chat / Agent 工具项目。前端主体是单页 HTML + 原生 JavaScript，后端是本地 Python 服务，用于代理 LLM 请求、执行受控文件/终端/MCP 等工具。

## 关键文件

- `AI-Chat-大模型对话助手.html`：主页面结构、弹窗和脚本加载顺序。
- `css/base.css`：基础界面样式。
- `css/gemini-theme.css`：主题和统一设置页相关样式。
- `js/state.js`：全局状态、设置默认值、数据持久化。
- `js/api-core.js`：请求体构造、主模型调用、辅助调用和 agent loop。
- `js/api-adapters.js`：不同模型 API 的消息格式适配。
- `js/project-memory.js`：AI 自动维护的项目长期记忆。
- `js/project-instructions.js`：人工维护的项目指令读取、保存和注入。
- `js/settings-page.js`：统一设置页的导航、代理和弹窗停靠逻辑。
- `local_terminal_server.py` 与 `server/`：本地工具服务和沙箱后端。

## 启动与验证

- 启动本地后端：`python local_terminal_server.py`
- 打开前端页面：`AI-Chat-大模型对话助手.html`
- 如果浏览器直连 LLM 遇到 CORS，启用“通过本地服务代理”。
- 没有统一测试命令时，至少做静态检查：确认脚本加载顺序、全局函数名、DOM id 和设置页导航项一致。

## 架构约定

- 新功能优先按独立 `js/*.js` 模块添加，避免把大型逻辑继续塞进 HTML。
- 新设置项需要同时更新：
  - `js/state.js` 默认值；
  - 对应设置模块的 ensure/render/save 逻辑；
  - `AI-Chat-大模型对话助手.html` 的设置面板和脚本加载顺序；
  - 如需统一设置页入口，同步更新 `js/settings-page.js`。
- 模型请求的长期背景应通过 system prompt 注入，不直接写入聊天消息历史。
- 人工维护的项目指令和 AI 自动维护的项目记忆要分层：
  - `AGENTS.md`：稳定规则、命令、约定和偏好；
  - `.agent/memory.md`：AI 总结的长期背景、坑点和待办。
- 本地工具读写必须走沙箱后端，避免绕过已有权限和路径检查。

## 编辑偏好

- 保持改动小而聚焦，不做无关重构。
- 代码默认使用 ASCII；现有中文 UI 文案可以继续使用中文。
- DOM id、全局函数名、设置项 key 要保持语义清晰，避免隐式耦合。
- 修改 UI 时保持现有设置页风格：紧凑、工具型、信息密度适中。

## 注意事项

- 不要记录 API Key、Cookie、Token、私钥、账号等敏感信息。
- 不要把大段工具输出、日志或临时调试内容写进长期指令。
- 如果不确定项目事实，写“待确认”，不要编造。
- 修改脚本加载顺序时要确认依赖关系，例如 `state.js` 早于读取设置的模块，提示注入模块早于 API adapter。
