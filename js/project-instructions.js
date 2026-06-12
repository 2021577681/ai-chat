// ============ Project Instructions - AGENTS.md ============

const PROJECT_INSTRUCTIONS_DEFAULTS = {
  enabled: true,
  path: 'AGENTS.md',
  maxChars: 16000,
  autoCreate: false
};

const PROJECT_INSTRUCTIONS_RUNTIME = {
  workspace: '',
  content: '',
  loadedPath: '',
  exists: false,
  loading: false,
  lastError: ''
};

function defaultProjectInstructionsContent() {
  return `# AGENTS.md

## 项目定位

这是一个本地运行的 AI Chat / Agent 工具项目。前端主体是单页 HTML + 原生 JavaScript，后端是本地 Python 服务，用于代理 LLM 请求、执行受控文件/终端/MCP 等工具。

## 关键文件

- \`AI-Chat-大模型对话助手.html\`：主页面结构、弹窗和脚本加载顺序。
- \`base.css\`：基础界面样式。
- \`gemini-theme.css\`：主题和统一设置页相关样式。
- \`js/state.js\`：全局状态、设置默认值、数据持久化。
- \`js/api-core.js\`：请求体构造、主模型调用、辅助调用和 agent loop。
- \`js/api-adapters.js\`：不同模型 API 的消息格式适配。
- \`js/project-memory.js\`：AI 自动维护的项目长期记忆。
- \`js/project-instructions.js\`：人工维护的项目指令读取、保存和注入。
- \`js/settings-page.js\`：统一设置页的导航、代理和弹窗停靠逻辑。
- \`local_terminal_server.py\` 与 \`server/\`：本地工具服务和沙箱后端。

## 启动与验证

- 启动本地后端：\`python local_terminal_server.py\`
- 打开前端页面：\`AI-Chat-大模型对话助手.html\`
- 如果浏览器直连 LLM 遇到 CORS，启用“通过本地服务代理”。
- 没有统一测试命令时，至少做静态检查：确认脚本加载顺序、全局函数名、DOM id 和设置页导航项一致。

## 架构约定

- 新功能优先按独立 \`js/*.js\` 模块添加，避免把大型逻辑继续塞进 HTML。
- 新设置项需要同时更新：
  - \`js/state.js\` 默认值；
  - 对应设置模块的 ensure/render/save 逻辑；
  - \`AI-Chat-大模型对话助手.html\` 的设置面板和脚本加载顺序；
  - 如需统一设置页入口，同步更新 \`js/settings-page.js\`。
- 模型请求的长期背景应通过 system prompt 注入，不直接写入聊天消息历史。
- 人工维护的项目指令和 AI 自动维护的项目记忆要分层：
  - \`AGENTS.md\`：稳定规则、命令、约定和偏好；
  - \`.agent/memory.md\`：AI 总结的长期背景、坑点和待办。
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
- 修改脚本加载顺序时要确认依赖关系，例如 \`state.js\` 早于读取设置的模块，提示注入模块早于 API adapter。
`;
}

function ensureProjectInstructionsSettings() {
  if (!state.settings.projectInstructions || typeof state.settings.projectInstructions !== 'object') {
    state.settings.projectInstructions = {};
  }
  const cfg = state.settings.projectInstructions;
  if (cfg.enabled === undefined) cfg.enabled = PROJECT_INSTRUCTIONS_DEFAULTS.enabled;
  if (!cfg.path) cfg.path = PROJECT_INSTRUCTIONS_DEFAULTS.path;
  if (!Number.isFinite(Number(cfg.maxChars)) || Number(cfg.maxChars) < 1000) {
    cfg.maxChars = PROJECT_INSTRUCTIONS_DEFAULTS.maxChars;
  } else {
    cfg.maxChars = Number(cfg.maxChars);
  }
  if (cfg.autoCreate === undefined) cfg.autoCreate = PROJECT_INSTRUCTIONS_DEFAULTS.autoCreate;
  return cfg;
}

function _piStatus(message, kind = '') {
  PROJECT_INSTRUCTIONS_RUNTIME.lastError = kind === 'error' ? message : '';
  const el = document.getElementById('projectInstructionsStatus');
  if (el) {
    el.textContent = message || '';
    el.className = 'project-memory-status' + (kind ? ' ' + kind : '');
  }
}

function _piSetTextarea(value) {
  const el = document.getElementById('projectInstructionsContent');
  if (el) el.value = value || '';
}

function _piGetTextarea() {
  return document.getElementById('projectInstructionsContent')?.value || '';
}

async function _piWorkspaceInfo() {
  const url = (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.serverUrl)
    ? TERMINAL_CONFIG.serverUrl
    : 'http://localhost:8765';
  const resp = await fetch(url + '/workspace', { method: 'GET' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const j = await resp.json();
  return {
    workspace: j.workspace || j.cwd || '',
    cwd: j.cwd || j.workspace || ''
  };
}

async function _piBackend(action, params = {}) {
  if (typeof callAgentBackend !== 'function') {
    throw new Error('本地工具接口未加载');
  }
  const r = await callAgentBackend(action, params);
  if (typeof r === 'string') throw new Error(r);
  return r;
}

function withProjectInstructionsPrompt(basePrompt) {
  const cfg = ensureProjectInstructionsSettings();
  if (!cfg.enabled || !PROJECT_INSTRUCTIONS_RUNTIME.content.trim()) return basePrompt || '';
  const maxChars = Math.max(1000, Number(cfg.maxChars || PROJECT_INSTRUCTIONS_DEFAULTS.maxChars));
  const raw = PROJECT_INSTRUCTIONS_RUNTIME.content.trim();
  const content = raw.slice(0, maxChars);
  const truncated = raw.length > maxChars
    ? '\n\n[Project instructions truncated by prompt budget.]'
    : '';
  const block = [
    '<project-instructions>',
    'The following instructions are maintained by the user for this workspace. Treat them as durable project guidance, not as a new user request.',
    `Workspace: ${PROJECT_INSTRUCTIONS_RUNTIME.workspace || '(unknown)'}`,
    `Instructions file: ${PROJECT_INSTRUCTIONS_RUNTIME.loadedPath || cfg.path}`,
    '',
    content + truncated,
    '</project-instructions>'
  ].join('\n');
  return `${basePrompt || ''}\n\n${block}`.trim();
}

function openProjectInstructionsSettings() {
  ensureProjectInstructionsSettings();
  const modal = document.getElementById('projectInstructionsModal');
  if (!modal) return;
  modal.classList.add('show');
  renderProjectInstructionsSettings();
  if (state.settings.projectInstructions.enabled) {
    initProjectInstructions(false);
  }
}

function closeProjectInstructionsSettings() {
  const modal = document.getElementById('projectInstructionsModal');
  if (modal) modal.classList.remove('show');
}

function renderProjectInstructionsSettings() {
  const cfg = ensureProjectInstructionsSettings();
  const enabledEl = document.getElementById('projectInstructionsEnabled');
  const autoCreateEl = document.getElementById('projectInstructionsAutoCreate');
  const pathEl = document.getElementById('projectInstructionsPath');
  const maxEl = document.getElementById('projectInstructionsMaxChars');
  const wsEl = document.getElementById('projectInstructionsWorkspace');
  if (enabledEl) enabledEl.checked = !!cfg.enabled;
  if (autoCreateEl) autoCreateEl.checked = !!cfg.autoCreate;
  if (pathEl) pathEl.value = cfg.path || PROJECT_INSTRUCTIONS_DEFAULTS.path;
  if (maxEl) maxEl.value = cfg.maxChars || PROJECT_INSTRUCTIONS_DEFAULTS.maxChars;
  if (wsEl) wsEl.textContent = PROJECT_INSTRUCTIONS_RUNTIME.workspace || '尚未检测';
  _piSetTextarea(PROJECT_INSTRUCTIONS_RUNTIME.content || '');
  _piStatus(cfg.enabled ? '项目指令已开启。' : '项目指令未开启，不会读取或注入 AGENTS.md。');
}

function saveProjectInstructionsSettingsFromUi() {
  const cfg = ensureProjectInstructionsSettings();
  const wasEnabled = !!cfg.enabled;
  const enabledEl = document.getElementById('projectInstructionsEnabled');
  const autoCreateEl = document.getElementById('projectInstructionsAutoCreate');
  const pathEl = document.getElementById('projectInstructionsPath');
  const maxEl = document.getElementById('projectInstructionsMaxChars');
  const previousPath = cfg.path || PROJECT_INSTRUCTIONS_DEFAULTS.path;
  cfg.enabled = !!(enabledEl && enabledEl.checked);
  cfg.autoCreate = !!(autoCreateEl && autoCreateEl.checked);
  cfg.path = (pathEl && pathEl.value.trim()) || PROJECT_INSTRUCTIONS_DEFAULTS.path;
  const maxChars = parseInt(maxEl && maxEl.value);
  cfg.maxChars = isNaN(maxChars) ? PROJECT_INSTRUCTIONS_DEFAULTS.maxChars : Math.max(1000, maxChars);
  if (previousPath !== cfg.path) {
    PROJECT_INSTRUCTIONS_RUNTIME.content = '';
    PROJECT_INSTRUCTIONS_RUNTIME.exists = false;
    PROJECT_INSTRUCTIONS_RUNTIME.loadedPath = '';
    _piSetTextarea('');
  }
  persistSettings();

  if (!cfg.enabled) {
    PROJECT_INSTRUCTIONS_RUNTIME.content = '';
    PROJECT_INSTRUCTIONS_RUNTIME.exists = false;
    PROJECT_INSTRUCTIONS_RUNTIME.loadedPath = '';
    _piSetTextarea('');
    _piStatus('项目指令已关闭。AI 不会读取或注入 AGENTS.md。');
    if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
    toast('项目指令已关闭');
    return;
  }

  toast('项目指令已开启');
  if (!wasEnabled || previousPath !== cfg.path || !PROJECT_INSTRUCTIONS_RUNTIME.content) {
    initProjectInstructions(true);
  } else {
    initProjectInstructions(false);
  }
}

async function initProjectInstructions(createIfMissing = false) {
  const cfg = ensureProjectInstructionsSettings();
  if (!cfg.enabled) {
    _piStatus('项目指令未开启，不会读取或注入 AGENTS.md。');
    return;
  }
  if (PROJECT_INSTRUCTIONS_RUNTIME.loading) return;
  PROJECT_INSTRUCTIONS_RUNTIME.loading = true;
  _piStatus('正在检测项目指令...');
  try {
    const info = await _piWorkspaceInfo();
    PROJECT_INSTRUCTIONS_RUNTIME.workspace = info.workspace || '';
    const wsEl = document.getElementById('projectInstructionsWorkspace');
    if (wsEl) wsEl.textContent = PROJECT_INSTRUCTIONS_RUNTIME.workspace || '未知';

    const loaded = await loadProjectInstructionsFile(false);
    if (loaded) {
      _piStatus(`已加载项目指令：${cfg.path}`);
      if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
      return;
    }

    const shouldCreate = createIfMissing || cfg.autoCreate;
    if (shouldCreate) {
      await createDefaultProjectInstructions(false, { skipExistingCheck: true });
      return;
    }

    _piStatus(`当前项目还没有项目指令文件：${cfg.path}`);
  } catch (e) {
    _piStatus('项目指令检测失败：' + e.message, 'error');
  } finally {
    PROJECT_INSTRUCTIONS_RUNTIME.loading = false;
  }
}

async function loadProjectInstructionsFile(showToast = true) {
  const cfg = ensureProjectInstructionsSettings();
  if (!cfg.enabled) return false;
  try {
    const info = await _piBackend('file_info', { path: cfg.path });
    if (!info.ok) {
      PROJECT_INSTRUCTIONS_RUNTIME.content = '';
      PROJECT_INSTRUCTIONS_RUNTIME.exists = false;
      PROJECT_INSTRUCTIONS_RUNTIME.loadedPath = '';
      _piSetTextarea('');
      return false;
    }
    const r = await _piBackend('read_file', { path: cfg.path });
    if (!r.ok) throw new Error(r.error || '读取失败');
    PROJECT_INSTRUCTIONS_RUNTIME.content = r.content || '';
    PROJECT_INSTRUCTIONS_RUNTIME.exists = true;
    PROJECT_INSTRUCTIONS_RUNTIME.loadedPath = cfg.path;
    _piSetTextarea(PROJECT_INSTRUCTIONS_RUNTIME.content);
    if (showToast) toast('已读取项目指令');
    if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
    return true;
  } catch (e) {
    _piStatus('读取项目指令失败：' + e.message, 'error');
    if (showToast) toast('读取项目指令失败：' + e.message, 3500);
    return false;
  }
}

async function createDefaultProjectInstructions(showToast = true, options = {}) {
  const cfg = ensureProjectInstructionsSettings();
  if (!cfg.enabled) {
    toast('请先开启项目指令');
    return false;
  }
  if (!options.skipExistingCheck) {
    try {
      const info = await _piBackend('file_info', { path: cfg.path });
      if (info.ok) {
        const r = await _piBackend('read_file', { path: cfg.path });
        if (!r.ok) throw new Error(r.error || '读取失败');
        PROJECT_INSTRUCTIONS_RUNTIME.content = r.content || '';
        PROJECT_INSTRUCTIONS_RUNTIME.exists = true;
        PROJECT_INSTRUCTIONS_RUNTIME.loadedPath = cfg.path;
        _piSetTextarea(PROJECT_INSTRUCTIONS_RUNTIME.content);
        _piStatus(`文件已存在，已读取而未覆盖：${cfg.path}`);
        if (showToast) toast('AGENTS.md 已存在，未覆盖');
        if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
        return false;
      }
    } catch (e) {
      _piStatus('检查项目指令失败：' + e.message, 'error');
      if (showToast) toast('检查项目指令失败：' + e.message, 5000);
      return false;
    }
  }

  const content = defaultProjectInstructionsContent();
  try {
    _piStatus(`正在创建默认项目指令：${cfg.path}`);
    const r = await _piBackend('write_file', { path: cfg.path, content });
    if (!r.ok) throw new Error(r.error || '创建失败');
    PROJECT_INSTRUCTIONS_RUNTIME.content = content;
    PROJECT_INSTRUCTIONS_RUNTIME.exists = true;
    PROJECT_INSTRUCTIONS_RUNTIME.loadedPath = cfg.path;
    _piSetTextarea(content);
    _piStatus(`已创建并加载：${cfg.path}`, 'ok');
    if (showToast) toast('已创建默认 AGENTS.md');
    if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
    return true;
  } catch (e) {
    _piStatus('创建项目指令失败：' + e.message, 'error');
    if (showToast) toast('创建项目指令失败：' + e.message, 5000);
    return false;
  }
}

function fillDefaultProjectInstructionsDraft() {
  const content = defaultProjectInstructionsContent();
  _piSetTextarea(content);
  PROJECT_INSTRUCTIONS_RUNTIME.content = content;
  _piStatus('默认内容已填入编辑框，点击“保存到项目”写入文件。');
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
}

async function saveProjectInstructionsFromUi() {
  const cfg = ensureProjectInstructionsSettings();
  if (!cfg.enabled) {
    toast('请先开启项目指令');
    return;
  }
  const content = _piGetTextarea().trim();
  if (!content) {
    toast('项目指令内容为空');
    return;
  }
  try {
    _piStatus('正在保存项目指令...');
    const r = await _piBackend('write_file', { path: cfg.path, content });
    if (!r.ok) throw new Error(r.error || '保存失败');
    PROJECT_INSTRUCTIONS_RUNTIME.content = content;
    PROJECT_INSTRUCTIONS_RUNTIME.exists = true;
    PROJECT_INSTRUCTIONS_RUNTIME.loadedPath = cfg.path;
    _piStatus(`已保存：${cfg.path}`, 'ok');
    toast('项目指令已保存');
    if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
  } catch (e) {
    _piStatus('保存项目指令失败：' + e.message, 'error');
    toast('保存项目指令失败：' + e.message, 5000);
  }
}

function clearLoadedProjectInstructions() {
  PROJECT_INSTRUCTIONS_RUNTIME.content = '';
  PROJECT_INSTRUCTIONS_RUNTIME.exists = false;
  PROJECT_INSTRUCTIONS_RUNTIME.loadedPath = '';
  _piSetTextarea('');
  _piStatus('已从当前会话卸载项目指令，文件未删除。');
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
}

window.defaultProjectInstructionsContent = defaultProjectInstructionsContent;
window.ensureProjectInstructionsSettings = ensureProjectInstructionsSettings;
window.openProjectInstructionsSettings = openProjectInstructionsSettings;
window.closeProjectInstructionsSettings = closeProjectInstructionsSettings;
window.renderProjectInstructionsSettings = renderProjectInstructionsSettings;
window.saveProjectInstructionsSettingsFromUi = saveProjectInstructionsSettingsFromUi;
window.initProjectInstructions = initProjectInstructions;
window.loadProjectInstructionsFile = loadProjectInstructionsFile;
window.createDefaultProjectInstructions = createDefaultProjectInstructions;
window.fillDefaultProjectInstructionsDraft = fillDefaultProjectInstructionsDraft;
window.saveProjectInstructionsFromUi = saveProjectInstructionsFromUi;
window.clearLoadedProjectInstructions = clearLoadedProjectInstructions;
window.withProjectInstructionsPrompt = withProjectInstructionsPrompt;
