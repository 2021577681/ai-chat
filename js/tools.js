// ============ 工具管理 ============

function openTools() {
  document.getElementById('toolsModal').classList.add('show');
  renderToolList();
}

function closeTools() {
  document.getElementById('toolsModal').classList.remove('show');
  persistTools();
  updateSendBtn();
}

function renderToolList() {
  const el = document.getElementById('toolList');
  if (!state.tools.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:13px;">还没有工具<br><button class="btn btn-primary" style="margin-top:10px;" onclick="resetBuiltinTools()">🔄 加载内置工具</button></div>';
    updateLmsToggleBtn();
    updateGitToggleBtn();
    updatePaperToggleBtn();
    return;
  }
  
  const builtinNames = new Set((typeof BUILTIN_TOOLS !== 'undefined' ? BUILTIN_TOOLS : []).map(t => t.name));
  
  el.innerHTML = state.tools.map((t, i) => {
    const isBuiltin = builtinNames.has(t.name);
    const isLms = isLmsTool(t.name);
    const isGit = isGitTool(t.name);
    const isPaper = isPaperTool(t.name);
    const isMcp = (typeof isMcpTool === 'function') && isMcpTool(t);
    const badge = isLms
      ? '<span style="background:#9c27b0;color:white;padding:1px 6px;border-radius:8px;font-size:10px;margin-left:4px;">🎓 LMS</span>'
      : (isGit
        ? '<span style="background:#2e7d32;color:white;padding:1px 6px;border-radius:8px;font-size:10px;margin-left:4px;">💾 快照</span>'
        : (isPaper
          ? '<span style="background:#0277bd;color:white;padding:1px 6px;border-radius:8px;font-size:10px;margin-left:4px;">📚 论文</span>'
          : (isMcp
            ? '<span style="background:#455a64;color:white;padding:1px 6px;border-radius:8px;font-size:10px;margin-left:4px;">MCP</span>'
            : (isBuiltin ? '<span style="background:var(--primary);color:white;padding:1px 6px;border-radius:8px;font-size:10px;margin-left:4px;">内置</span>' : ''))));
    return `
    <div class="tool-item">
      <div class="tool-item-header" onclick="this.parentElement.classList.toggle('expanded')">
        <span style="font-size:18px;">🔧</span>
        <span class="tool-item-name">${escapeHtml(t.name)}${badge}</span>
        <span class="tool-item-desc">${escapeHtml(t.description || '')}</span>
        <button class="tool-toggle-btn" onclick="event.stopPropagation();editTool(${i})">✏️</button>
        <button class="tool-toggle-btn" onclick="event.stopPropagation();deleteTool(${i})">×</button>
      </div>
      <div class="tool-item-body">
        <pre style="background:var(--bg-input);padding:8px;border-radius:6px;font-size:12px;overflow-x:auto;">${escapeHtml(JSON.stringify(t.parameters, null, 2))}</pre>
      </div>
    </div>`;
  }).join('');
  updateLmsToggleBtn();
  updateGitToggleBtn();
  updatePaperToggleBtn();
}

// ============ 🎓 LMS 工具批量启停 ============
function isLmsTool(name) {
  return typeof name === 'string' && name.startsWith('lms_');
}

function lmsToolsEnabled() {
  return state.tools.some(t => isLmsTool(t.name));
}

function lmsToolCount() {
  // BUILTIN_TOOLS 中总共有多少个 LMS 工具
  if (typeof BUILTIN_TOOLS === 'undefined') return 0;
  return BUILTIN_TOOLS.filter(t => isLmsTool(t.name)).length;
}

function toggleLmsTools() {
  if (lmsToolsEnabled()) {
    // 禁用：从 state.tools 移除所有 lms_* 工具
    const removed = state.tools.filter(t => isLmsTool(t.name)).length;
    state.tools = state.tools.filter(t => !isLmsTool(t.name));
    persistTools();
    renderToolList();
    toast(`🔕 已禁用 ${removed} 个 LMS 工具`);
  } else {
    // 启用：从 BUILTIN_TOOLS 中把 lms_* 工具加回来
    if (typeof BUILTIN_TOOLS === 'undefined') {
      toast('未找到内置工具定义');
      return;
    }
    const lmsTools = BUILTIN_TOOLS.filter(t => isLmsTool(t.name));
    let added = 0;
    for (const tool of lmsTools) {
      if (!state.tools.some(t => t.name === tool.name)) {
        state.tools.push(JSON.parse(JSON.stringify(tool)));
        added++;
      }
    }
    persistTools();
    renderToolList();
    toast(`🎓 已启用 ${added} 个 LMS 工具`);
  }
}

function updateLmsToggleBtn() {
  const btn = document.getElementById('lmsToggleBtn');
  if (!btn) return;
  const enabled = lmsToolsEnabled();
  const total = lmsToolCount();
  if (enabled) {
    const cur = state.tools.filter(t => isLmsTool(t.name)).length;
    btn.textContent = `🔕 禁用 LMS 工具 (${cur})`;
    btn.classList.remove('btn-primary');
    btn.title = '当前 LMS 工具已启用，点击全部移除';
  } else {
    btn.textContent = `🎓 启用 LMS 工具 (${total})`;
    btn.classList.add('btn-primary');
    btn.title = '当前未启用，点击一键加入全部 LMS 工具';
  }
}

// ============ 💾 Git 快照工具批量启停 ============
// ⚠️ 注意：基础工具里有 read_note / save_note / append_note / edit_note / find_in_notes / list_notes / delete_note 
// 这些都是 note_ 或 _notes 但不是 Git 工具，所以必须用精确白名单识别
const GIT_TOOL_NAMES = ['note_status', 'note_history', 'note_diff', 'note_snapshot', 'note_restore'];

function isGitTool(name) {
  return typeof name === 'string' && GIT_TOOL_NAMES.includes(name);
}

function gitToolsEnabled() {
  return state.tools.some(t => isGitTool(t.name));
}

function gitToolCount() {
  if (typeof BUILTIN_TOOLS === 'undefined') return 0;
  return BUILTIN_TOOLS.filter(t => isGitTool(t.name)).length;
}

function toggleGitTools() {
  if (gitToolsEnabled()) {
    // 禁用：从 state.tools 移除所有 Git 工具
    const removed = state.tools.filter(t => isGitTool(t.name)).length;
    state.tools = state.tools.filter(t => !isGitTool(t.name));
    persistTools();
    renderToolList();
    toast(`🔕 已禁用 ${removed} 个版本快照工具`);
  } else {
    // 启用：从 BUILTIN_TOOLS 中把 Git 工具加回来
    if (typeof BUILTIN_TOOLS === 'undefined') {
      toast('未找到内置工具定义');
      return;
    }
    const gitTools = BUILTIN_TOOLS.filter(t => isGitTool(t.name));
    let added = 0;
    for (const tool of gitTools) {
      if (!state.tools.some(t => t.name === tool.name)) {
        state.tools.push(JSON.parse(JSON.stringify(tool)));
        added++;
      }
    }
    persistTools();
    renderToolList();
    toast(`💾 已启用 ${added} 个版本快照工具`);
  }
}

function updateGitToggleBtn() {
  const btn = document.getElementById('gitToggleBtn');
  if (!btn) return;
  const enabled = gitToolsEnabled();
  const total = gitToolCount();
  if (enabled) {
    const cur = state.tools.filter(t => isGitTool(t.name)).length;
    btn.textContent = `🔕 禁用快照工具 (${cur})`;
    btn.classList.remove('btn-primary');
    btn.title = '当前版本快照工具已启用，点击全部移除';
  } else {
    btn.textContent = `💾 启用快照工具 (${total})`;
    btn.classList.add('btn-primary');
    btn.title = '当前未启用，点击一键加入全部版本快照工具';
  }
}

// ============ 📚 论文工具批量启停 ============
const PAPER_TOOL_NAMES = ['arxiv_search', 'semantic_scholar_search', 'fetch_pdf_text'];

function isPaperTool(name) {
  return typeof name === 'string' && PAPER_TOOL_NAMES.includes(name);
}

function paperToolsEnabled() {
  return state.tools.some(t => isPaperTool(t.name));
}

function paperToolCount() {
  if (typeof BUILTIN_TOOLS === 'undefined') return 0;
  return BUILTIN_TOOLS.filter(t => isPaperTool(t.name)).length;
}

function togglePaperTools() {
  if (paperToolsEnabled()) {
    // 禁用：从 state.tools 移除所有论文工具
    const removed = state.tools.filter(t => isPaperTool(t.name)).length;
    state.tools = state.tools.filter(t => !isPaperTool(t.name));
    persistTools();
    renderToolList();
    toast(`🔕 已禁用 ${removed} 个论文工具`);
  } else {
    // 启用：从 BUILTIN_TOOLS 中把论文工具加回来
    if (typeof BUILTIN_TOOLS === 'undefined') {
      toast('未找到内置工具定义');
      return;
    }
    const paperTools = BUILTIN_TOOLS.filter(t => isPaperTool(t.name));
    let added = 0;
    for (const tool of paperTools) {
      if (!state.tools.some(t => t.name === tool.name)) {
        state.tools.push(JSON.parse(JSON.stringify(tool)));
        added++;
      }
    }
    persistTools();
    renderToolList();
    toast(`📚 已启用 ${added} 个论文工具`);
  }
}

function updatePaperToggleBtn() {
  const btn = document.getElementById('paperToggleBtn');
  if (!btn) return;
  const enabled = paperToolsEnabled();
  const total = paperToolCount();
  if (enabled) {
    const cur = state.tools.filter(t => isPaperTool(t.name)).length;
    btn.textContent = `🔕 禁用论文工具 (${cur})`;
    btn.classList.remove('btn-primary');
    btn.title = '当前论文工具已启用，点击全部移除';
  } else {
    btn.textContent = `📚 启用论文工具 (${total})`;
    btn.classList.add('btn-primary');
    btn.title = '当前未启用，点击一键加入 arXiv + Semantic Scholar + PDF 全文工具';
  }
}

function addPresetTool(key) {
  const p = PRESET_TOOLS[key];
  if (!p) return;
  if (state.tools.some(t => t.name === p.name)) {
    toast('已存在');
    return;
  }
  state.tools.push(JSON.parse(JSON.stringify(p)));
  persistTools();
  renderToolList();
  toast('✓ 已添加');
}

function addCustomTool() {
  state.editingToolIdx = -1;
  document.getElementById('te_name').value = '';
  document.getElementById('te_desc').value = '';
  document.getElementById('te_params').value = JSON.stringify({ type: 'object', properties: { input: { type: 'string' } }, required: ['input'] }, null, 2);
  document.getElementById('te_code').value = `return '收到：' + args.input;`;
  document.getElementById('toolEditModal').classList.add('show');
}

function editTool(i) {
  state.editingToolIdx = i;
  const t = state.tools[i];
  document.getElementById('te_name').value = t.name;
  document.getElementById('te_desc').value = t.description;
  document.getElementById('te_params').value = JSON.stringify(t.parameters, null, 2);
  document.getElementById('te_code').value = t.code;
  document.getElementById('toolEditModal').classList.add('show');
}

function saveToolEdit() {
  const name = document.getElementById('te_name').value.trim();
  const desc = document.getElementById('te_desc').value.trim();
  let params;
  try {
    params = JSON.parse(document.getElementById('te_params').value);
  } catch (e) {
    alert('参数 JSON 错误：' + e.message);
    return;
  }
  const code = document.getElementById('te_code').value;
  if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    alert('名称需为合法英文标识符');
    return;
  }
  const tool = { name, description: desc, parameters: params, code };
  if (state.editingToolIdx >= 0) state.tools[state.editingToolIdx] = tool;
  else {
    if (state.tools.some(t => t.name === name)) {
      alert('已存在');
      return;
    }
    state.tools.push(tool);
  }
  persistTools();
  renderToolList();
  document.getElementById('toolEditModal').classList.remove('show');
  toast('✓ 已保存');
}

function deleteTool(i) {
  if (!confirm('删除？')) return;
  state.tools.splice(i, 1);
  persistTools();
  renderToolList();
}

function clearAllTools() {
  if (!state.tools.length) return;
  if (!confirm('清空所有工具？')) return;
  state.tools = [];
  persistTools();
  renderToolList();
}

function toggleTools() {
  if (!state.tools.length) {
    toast('请先添加工具');
    openTools();
    return;
  }
  state.settings.useTools = !state.settings.useTools;
  const btn = document.getElementById('toolsBtn');
  if (state.settings.useTools) btn.classList.add('tool-active');
  else btn.classList.remove('tool-active');
  persistSettings();
  updateSendBtn();
}

function buildToolsArray() {
  if (!state.settings.useTools || !state.tools.length) return null;
  
  if (state.settings.apiFormat === 'anthropic') {
    return state.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));
  } else if (state.settings.apiFormat === 'responses') {
    return state.tools.map(t => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
  } else {
    return state.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }
}

function _toolContextChatId(context = {}) {
  if (typeof context === 'string') return context;
  if (context && context.chatId) return context.chatId;
  if (context && context.chat && context.chat.id) return context.chat.id;
  return (state && (state.activeTaskChatId || state.currentId)) || '';
}

function _ctxToolFn(name, context) {
  return (...fnArgs) => {
    const root = typeof window !== 'undefined' ? window : globalThis;
    const fn = root && root[name];
    if (typeof fn !== 'function') throw new Error(`tool function not loaded: ${name}`);
    return fn(...fnArgs, context);
  };
}

async function executeTool(name, args, context = {}) {
  const tool = state.tools.find(t => t.name === name);
  if (!tool) return { ok: false, value: `未找到工具：${name}` };
  try {
    const toolContext = {
      ...(context && typeof context === 'object' ? context : {}),
      chatId: _toolContextChatId(context)
    };
    if (typeof window !== 'undefined') window.__currentToolContext = toolContext;
    const scopedNames = [
      'callAgentBackend',
      'executeTerminalCommand', 'readFile', 'writeFile', 'appendFile', 'editFile', 'deleteFile',
      'listDir', 'searchInFiles', 'webSearch', 'fetchUrl', 'aiScreenshot', 'attachFileForAI',
      'callGit', 'aiGitStatus', 'aiGitHistory', 'aiGitDiff', 'aiGitSnapshot', 'aiGitRestore'
    ];
    const scopedFns = scopedNames.map(n => _ctxToolFn(n, toolContext));
    const fn = new Function('args', 'toolContext', ...scopedNames, `return (async () => { ${tool.code} })();`);
    const value = await fn(args, toolContext, ...scopedFns);
    if (typeof window !== 'undefined' && window.__currentToolContext === toolContext) delete window.__currentToolContext;
    return { ok: true, value };
  } catch (e) {
    if (typeof window !== 'undefined') delete window.__currentToolContext;
    return { ok: false, value: `工具出错：${e.message}` };
  }
}
