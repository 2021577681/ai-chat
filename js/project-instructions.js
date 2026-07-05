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

const ProjectInstructionsStateModule = window.AgentApp.require('state');
const ProjectInstructionsUiService = window.AgentApp.require('uiService');
const projectInstructionsState = ProjectInstructionsStateModule.state;
const projectInstructionsPersistSettings = ProjectInstructionsStateModule.persistSettings;

function projectInstructionsApiCore() {
  return window.AgentApp.require('apiCore');
}

function defaultProjectInstructionsContent() {
  return `# AGENTS.md

## 项目定位

待确认：简要说明这个项目是什么、主要面向谁、最重要的目标是什么。

## 启动与验证

- 启动命令：待确认。
- 测试命令：待确认。
- 构建命令：待确认。
- 修改后至少验证：待确认。

## 架构地图

- 核心入口：待确认。
- 主要模块：待确认。
- 数据存储：待确认。
- 外部服务：待确认。

## 修改约定

- 保持改动小而聚焦。
- 优先遵循项目已有模式和命名。
- 新增依赖前先确认必要性。
- 不要把临时日志、调试输出或大段生成内容写进长期文件。

## 代码风格

- 待确认。

## 已知坑

- 待确认。

## 注意事项

- 不要记录 API Key、Cookie、Token、私钥、账号等敏感信息。
- 如果不确定项目事实，写“待确认”，不要编造。
- \`AGENTS.md\` 是人工维护的项目规则；自动总结和临时任务记录应放到项目自己的记忆文件或任务记录中。
`;
}

function ensureProjectInstructionsSettings() {
  if (!projectInstructionsState.settings.projectInstructions || typeof projectInstructionsState.settings.projectInstructions !== 'object') {
    projectInstructionsState.settings.projectInstructions = {};
  }
  const cfg = projectInstructionsState.settings.projectInstructions;
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

async function _piFileInfo(path) {
  return await _piBackend('file_info', { path });
}

function _piIsMissingFileInfo(info) {
  return !!(info && info.ok === false && /路径不存在|not found|does not exist/i.test(String(info.error || '')));
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
  if (projectInstructionsState.settings.projectInstructions.enabled) {
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
  projectInstructionsPersistSettings();

  if (!cfg.enabled) {
    PROJECT_INSTRUCTIONS_RUNTIME.content = '';
    PROJECT_INSTRUCTIONS_RUNTIME.exists = false;
    PROJECT_INSTRUCTIONS_RUNTIME.loadedPath = '';
    _piSetTextarea('');
    _piStatus('项目指令已关闭。AI 不会读取或注入 AGENTS.md。');
    if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
    ProjectInstructionsUiService.toast('项目指令已关闭');
    return;
  }

  ProjectInstructionsUiService.toast('项目指令已开启');
  initProjectInstructions(false);
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
      await createDefaultProjectInstructions(false);
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
    const info = await _piFileInfo(cfg.path);
    if (!info.ok) {
      PROJECT_INSTRUCTIONS_RUNTIME.content = '';
      PROJECT_INSTRUCTIONS_RUNTIME.exists = false;
      PROJECT_INSTRUCTIONS_RUNTIME.loadedPath = '';
      _piSetTextarea('');
      if (!_piIsMissingFileInfo(info)) throw new Error(info.error || '文件信息读取失败');
      return false;
    }
    const r = await _piBackend('read_file', { path: cfg.path });
    if (!r.ok) throw new Error(r.error || '读取失败');
    PROJECT_INSTRUCTIONS_RUNTIME.content = r.content || '';
    PROJECT_INSTRUCTIONS_RUNTIME.exists = true;
    PROJECT_INSTRUCTIONS_RUNTIME.loadedPath = cfg.path;
    _piSetTextarea(PROJECT_INSTRUCTIONS_RUNTIME.content);
    if (showToast) ProjectInstructionsUiService.toast('已读取项目指令');
    if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
    return true;
  } catch (e) {
    _piStatus('读取项目指令失败：' + e.message, 'error');
    if (showToast) ProjectInstructionsUiService.toast('读取项目指令失败：' + e.message, 3500);
    return false;
  }
}

async function createDefaultProjectInstructions(showToast = true) {
  const cfg = ensureProjectInstructionsSettings();
  if (!cfg.enabled) {
    ProjectInstructionsUiService.toast('请先开启项目指令');
    return false;
  }
  try {
    const info = await _piFileInfo(cfg.path);
    if (info.ok) {
      const loaded = await loadProjectInstructionsFile(false);
      if (!loaded) throw new Error('文件存在，但读取失败');
      _piStatus(`文件已存在，已读取而未覆盖：${cfg.path}`);
      if (showToast) ProjectInstructionsUiService.toast('AGENTS.md 已存在，未覆盖');
      return false;
    }
    if (!_piIsMissingFileInfo(info)) throw new Error(info.error || '文件信息读取失败');
  } catch (e) {
    _piStatus('检查项目指令失败：' + e.message, 'error');
    if (showToast) ProjectInstructionsUiService.toast('检查项目指令失败：' + e.message, 5000);
    return false;
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
    if (showToast) ProjectInstructionsUiService.toast('已创建默认 AGENTS.md');
    if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
    return true;
  } catch (e) {
    _piStatus('创建项目指令失败：' + e.message, 'error');
    if (showToast) ProjectInstructionsUiService.toast('创建项目指令失败：' + e.message, 5000);
    return false;
  }
}

function _piEntryLines(title, entries) {
  if (!entries || !entries.length) return `${title}: (empty)`;
  const rows = entries.slice(0, 120).map(e => {
    const suffix = e.type === 'dir' ? '/' : ` (${formatSize(e.size || 0)})`;
    return `- ${e.name}${suffix}`;
  });
  if (entries.length > rows.length) rows.push(`- ... ${entries.length - rows.length} more`);
  return `${title}:\n${rows.join('\n')}`;
}

async function _piSafeList(path) {
  try {
    const r = await _piBackend('list_dir', { path });
    if (r.ok) return r.entries || [];
  } catch (e) {}
  return [];
}

async function _piSafeRead(path, maxChars = 12000) {
  try {
    const r = await _piBackend('read_file', { path });
    if (!r.ok || !r.content) return '';
    const content = r.content.slice(0, maxChars);
    return `\n--- ${path} ---\n${content}${r.content.length > maxChars ? '\n...[truncated]' : ''}\n`;
  } catch (e) {
    return '';
  }
}

async function collectProjectInstructionsContext() {
  _piStatus('正在扫描项目目录...');
  const root = await _piSafeList('.');
  const skipDirs = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'env', 'dist', 'build', '.agent']);
  const preferredDirs = ['src', 'app', 'pages', 'components', 'lib', 'server', 'js', 'docs', 'tests', 'test', 'skill', 'lms_tool'];
  const dirs = root
    .filter(e => e.type === 'dir' && !skipDirs.has(e.name))
    .map(e => e.name);
  const dirsToList = [...new Set([
    ...preferredDirs.filter(d => dirs.includes(d)),
    ...dirs.slice(0, 8)
  ])].slice(0, 14);

  const sections = [];
  sections.push(_piEntryLines('Root directory', root));
  for (const dir of dirsToList) {
    sections.push(_piEntryLines(`${dir}/`, await _piSafeList(dir)));
  }

  const rootFiles = new Set(root.filter(e => e.type === 'file').map(e => e.name));
  const candidates = [
    'AGENTS.md', 'CLAUDE.md', 'README.md',
    'package.json', 'pnpm-lock.yaml', 'yarn.lock',
    'requirements.txt', 'pyproject.toml', 'setup.py',
    'Cargo.toml', 'go.mod', 'pom.xml',
    'Dockerfile', 'docker-compose.yml',
    '.gitignore'
  ].filter(f => rootFiles.has(f));

  const fileParts = [];
  for (const f of candidates) {
    fileParts.push(await _piSafeRead(f, f === 'README.md' ? 20000 : 12000));
  }

  return [
    `Workspace: ${PROJECT_INSTRUCTIONS_RUNTIME.workspace || '(unknown)'}`,
    '',
    '# Directory Summary',
    sections.join('\n\n'),
    '',
    '# Key Files',
    fileParts.join('\n').trim() || '(no key files read)'
  ].join('\n');
}

function _piCleanDraft(text) {
  let out = (text || '').trim();
  out = out.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim();
  if (!out.startsWith('#')) out = '# AGENTS.md\n\n' + out;
  if (!/^#\s+AGENTS\.md\b/i.test(out.split('\n')[0] || '')) {
    out = out.replace(/^# .*\n?/, '# AGENTS.md\n');
  }
  return out.trim();
}

async function generateProjectInstructionsDraft() {
  const cfg = ensureProjectInstructionsSettings();
  if (!cfg.enabled) {
    ProjectInstructionsUiService.toast('请先开启项目指令');
    return;
  }
  if (!projectInstructionsState.settings.apiKey) {
    ProjectInstructionsUiService.toast('请先配置 API Key，才能让 AI 生成 AGENTS.md 草稿', 4500);
    return;
  }
  try {
    if (!PROJECT_INSTRUCTIONS_RUNTIME.workspace) {
      const info = await _piWorkspaceInfo();
      PROJECT_INSTRUCTIONS_RUNTIME.workspace = info.workspace || '';
    }
    const context = await collectProjectInstructionsContext();
    _piStatus('正在调用模型生成 AGENTS.md 草稿...');
    const rolePrompt = [
      '你是项目级 AGENTS.md 规则整理助手。请基于用户提供的项目目录摘要和关键文件内容，生成一份给 coding agent 使用的 AGENTS.md。',
      '这份文件应该像 Claude Code 的 CLAUDE.md / Codex 的 AGENTS.md：记录稳定、每次改代码都应该遵守的项目规则。',
      '要求：',
      '1. 只输出 Markdown，不要解释。',
      '2. 内容要具体、短小、可长期维护；不要写流水账或临时任务。',
      '3. 必须包含这些小节：项目定位、启动与验证、架构地图、修改约定、代码风格、已知坑、注意事项。',
      '4. 优先记录可执行命令、关键文件、加载顺序、模块边界、测试要求和不要做的事。',
      '5. 不要记录 API Key、Cookie、Token、私钥、个人账号、真实密钥、会话值等敏感信息。',
      '6. 对不确定的信息明确写“待确认”，不要编造。',
      '7. 如果已有 AGENTS.md 或 CLAUDE.md，请保留其中仍然正确的规则，修正明显过时或与当前项目不符的内容。'
    ].join('\n');
    const raw = await projectInstructionsApiCore().callOnceWithRole([
      { role: 'user', content: `请为这个工作区生成 AGENTS.md 项目指令草稿。\n\n${context}` }
    ], projectInstructionsState.settings.currentModel, rolePrompt, {
      sourceLabel: '项目指令 · 生成草稿'
    });
    const draft = _piCleanDraft(raw);
    _piSetTextarea(draft);
    _piStatus('AGENTS.md 草稿已生成。请检查内容，确认后点击“保存到项目”。');
    const modal = document.getElementById('projectInstructionsModal');
    if (modal) modal.classList.add('show');
  } catch (e) {
    _piStatus('生成 AGENTS.md 草稿失败：' + e.message, 'error');
    ProjectInstructionsUiService.toast('生成 AGENTS.md 草稿失败：' + e.message, 5000);
  }
}

function fillDefaultProjectInstructionsDraft() {
  const content = defaultProjectInstructionsContent();
  _piSetTextarea(content);
  _piStatus('默认内容已填入编辑框，点击“保存到项目”写入文件。');
}

async function saveProjectInstructionsFromUi() {
  const cfg = ensureProjectInstructionsSettings();
  if (!cfg.enabled) {
    ProjectInstructionsUiService.toast('请先开启项目指令');
    return;
  }
  const content = _piGetTextarea().trim();
  if (!content) {
    ProjectInstructionsUiService.toast('项目指令内容为空');
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
    ProjectInstructionsUiService.toast('项目指令已保存');
    if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
  } catch (e) {
    _piStatus('保存项目指令失败：' + e.message, 'error');
    ProjectInstructionsUiService.toast('保存项目指令失败：' + e.message, 5000);
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
window.generateProjectInstructionsDraft = generateProjectInstructionsDraft;
window.fillDefaultProjectInstructionsDraft = fillDefaultProjectInstructionsDraft;
window.saveProjectInstructionsFromUi = saveProjectInstructionsFromUi;
window.clearLoadedProjectInstructions = clearLoadedProjectInstructions;
window.withProjectInstructionsPrompt = withProjectInstructionsPrompt;

window.AgentApp.define('projectInstructions', {
  defaultProjectInstructionsContent,
  ensureProjectInstructionsSettings,
  openProjectInstructionsSettings,
  closeProjectInstructionsSettings,
  renderProjectInstructionsSettings,
  saveProjectInstructionsSettingsFromUi,
  initProjectInstructions,
  loadProjectInstructionsFile,
  createDefaultProjectInstructions,
  generateProjectInstructionsDraft,
  fillDefaultProjectInstructionsDraft,
  saveProjectInstructionsFromUi,
  clearLoadedProjectInstructions,
  withProjectInstructionsPrompt
});
