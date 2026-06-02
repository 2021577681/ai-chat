// ============ 备份与恢复 ============

function openBackup() {
  document.getElementById('backupModal').classList.add('show');
  document.getElementById('importText').value = '';
  document.getElementById('importFile').value = '';
  document.getElementById('importPreview').className = 'test-result';
  document.getElementById('importPreview').textContent = '';
  pendingImportData = null;
}

function closeBackup() {
  document.getElementById('backupModal').classList.remove('show');
}

function buildExportData() {
  const OUTLINE_KEYS = ['useOutline', 'outlineMaxRounds', 'outlineModel', 'outlineSystemPrompt'];
  const REFLECTION_KEYS = ['useReflection', 'refRounds', 'refMinScore', 'refStudentModel', 'refTeacherModel', 'refStudentPrompt', 'refTeacherPrompt', 'refStudentUseTools', 'refTeacherUseTools', 'refStudentMaxToolRounds', 'refTeacherMaxToolRounds'];
  const PLAN_KEYS = ['usePlan', 'planReview', 'planSynthesize', 'planMaxSteps', 'planReviewRounds', 'planPlannerModel', 'planExecutorModel', 'planPlannerPrompt', 'planExecutorPrompt'];

  const inc = {
    settings: document.getElementById('exp_settings').checked,
    apiKey: document.getElementById('exp_apiKey').checked,
    plan: document.getElementById('exp_plan').checked,
    reflection: document.getElementById('exp_reflection').checked,
    outline: document.getElementById('exp_outline') ? document.getElementById('exp_outline').checked : false,
    tools: document.getElementById('exp_tools').checked,
    chats: document.getElementById('exp_chats').checked
  };
  
  const data = {
    _meta: {
      app: 'AI Chat',
      version: 'v6',
      exportedAt: new Date().toISOString(),
      includes: inc
    }
  };
  
  if (inc.settings) {
    const settings = JSON.parse(JSON.stringify(state.settings));
    if (!inc.apiKey) settings.apiKey = '';
    if (!inc.reflection) REFLECTION_KEYS.forEach(k => delete settings[k]);
    if (!inc.plan) PLAN_KEYS.forEach(k => delete settings[k]);
    if (!inc.outline) OUTLINE_KEYS.forEach(k => delete settings[k]);
    data.settings = settings;
  } else {
    const ds = {};
    if (inc.reflection) REFLECTION_KEYS.forEach(k => ds[k] = state.settings[k]);
    if (inc.plan) PLAN_KEYS.forEach(k => ds[k] = state.settings[k]);
    if (inc.outline) OUTLINE_KEYS.forEach(k => ds[k] = state.settings[k]);
    if (Object.keys(ds).length) data.settings = ds;
  }
  
  if (inc.tools) data.tools = state.tools;
  if (inc.chats) data.chats = state.chats;
  
  return data;
}

function exportConfig() {
  const data = buildExportData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `aichat-backup-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('✓ 配置已下载');
}

function copyConfigToClipboard() {
  const data = buildExportData();
  navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    .then(() => toast('✓ 已复制到剪贴板'))
    .catch(e => alert('复制失败：' + e.message));
}

function importFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('importText').value = e.target.result;
    parseAndPreviewImport();
  };
  reader.readAsText(file);
}

function parseAndPreviewImport() {
  const text = document.getElementById('importText').value.trim();
  const preview = document.getElementById('importPreview');
  if (!text) {
    preview.className = 'test-result';
    preview.textContent = '';
    pendingImportData = null;
    return;
  }
  try {
    const data = JSON.parse(text);
    pendingImportData = data;
    let summary = '<strong>📦 待导入：</strong><br>';
    if (data._meta) summary += `- 导出时间：${data._meta.exportedAt || '未知'}<br>`;
    if (data.settings) {
      const keys = Object.keys(data.settings);
      summary += `- ⚙️ 设置 ${keys.length} 项`;
      if (data.settings.apiKey) summary += '（含 API Key）';
      summary += '<br>';
      if (data.settings.baseUrl) summary += `&nbsp;&nbsp;Base URL: <code>${escapeHtml(data.settings.baseUrl)}</code><br>`;
      if (data.settings.currentModel) summary += `&nbsp;&nbsp;模型: <code>${escapeHtml(data.settings.currentModel)}</code><br>`;
    }
    if (data.tools && Array.isArray(data.tools)) {
      const newTools = data.tools.filter(t => !state.tools.some(et => et.name === t.name));
      summary += `- 🛠 工具 ${data.tools.length} 个`;
      if (newTools.length) summary += `（其中 ${newTools.length} 个为新增）`;
      summary += '<br>';
      // ⚠️ 工具代码会被 new Function 直接执行 —— 明确警示
      if (newTools.length) {
        summary += '<div style="margin-top:8px;padding:8px;border-left:3px solid #d9534f;background:rgba(217,83,79,.08);font-size:12px;line-height:1.5">'
          + '<strong style="color:#d9534f">⚠️ 安全提示：</strong>导入的工具代码会以页面权限执行 JS（可访问 localStorage / 调用 fetch）。'
          + '<br>仅在你<strong>完全信任来源</strong>时勾选"导入工具"。'
          + '<br>新增工具名：<code>' + newTools.map(t => escapeHtml(t.name || '(未命名)')).join('</code> <code>') + '</code>'
          + '</div>';
      }
    }
    if (data.chats && Array.isArray(data.chats)) summary += `- 💬 对话 ${data.chats.length} 个<br>`;
    preview.className = 'test-result success';
    preview.innerHTML = summary;
  } catch (e) {
    preview.className = 'test-result error';
    preview.textContent = '❌ JSON 格式错误：' + e.message;
    pendingImportData = null;
  }
}

function applyImport() {
  const text = document.getElementById('importText').value.trim();
  if (text && !pendingImportData) parseAndPreviewImport();
  if (!pendingImportData) { alert('请先选择文件或粘贴 JSON'); return; }
  
  const OUTLINE_KEYS = ['useOutline', 'outlineMaxRounds', 'outlineModel', 'outlineSystemPrompt'];
  const REFLECTION_KEYS = ['useReflection', 'refRounds', 'refMinScore', 'refStudentModel', 'refTeacherModel', 'refStudentPrompt', 'refTeacherPrompt', 'refStudentUseTools', 'refTeacherUseTools', 'refStudentMaxToolRounds', 'refTeacherMaxToolRounds'];
  const PLAN_KEYS = ['usePlan', 'planReview', 'planSynthesize', 'planMaxSteps', 'planReviewRounds', 'planPlannerModel', 'planExecutorModel', 'planPlannerPrompt', 'planExecutorPrompt'];

  const data = pendingImportData;
  const opts = {
    settings: document.getElementById('imp_settings').checked,
    plan: document.getElementById('imp_plan').checked,
    reflection: document.getElementById('imp_reflection').checked,
    outline: document.getElementById('imp_outline') ? document.getElementById('imp_outline').checked : false,
    tools: document.getElementById('imp_tools').checked,
    chats: document.getElementById('imp_chats').checked
  };
  
  let imported = [];
  
  if (data.settings) {
    if (opts.settings) {
      const oldTheme = state.settings.theme;
      const incoming = { ...data.settings };
      if (!opts.reflection) REFLECTION_KEYS.forEach(k => delete incoming[k]);
      if (!opts.plan) PLAN_KEYS.forEach(k => delete incoming[k]);
      if (!opts.outline) OUTLINE_KEYS.forEach(k => delete incoming[k]);
      state.settings = { ...state.settings, ...incoming, theme: oldTheme };
      imported.push('设置');
    } else {
      if (opts.reflection) {
        REFLECTION_KEYS.forEach(k => {
          if (data.settings[k] !== undefined) state.settings[k] = data.settings[k];
        });
        imported.push('师生');
      }
      if (opts.plan) {
        PLAN_KEYS.forEach(k => {
          if (data.settings[k] !== undefined) state.settings[k] = data.settings[k];
        });
        imported.push('Plan');
      }
      if (opts.outline) {
        OUTLINE_KEYS.forEach(k => {
          if (data.settings[k] !== undefined) state.settings[k] = data.settings[k];
        });
        imported.push('大纲');
      }
    }
  }
  
  if (opts.tools && Array.isArray(data.tools)) {
    const existing = new Set(state.tools.map(t => t.name));
    const incoming = data.tools.filter(t => !existing.has(t.name));
    const conflicting = data.tools.filter(t => existing.has(t.name));

    // 先处理新增工具（无名称冲突）
    if (incoming.length > 0) {
      // 🛡️ 二次确认：把即将执行的工具名 + 代码摘要列出来，避免恶意备份偷渡 JS
      const preview = incoming.slice(0, 5).map(t => {
        const code = (t.code || '').trim();
        const head = code.length > 200 ? code.slice(0, 200) + '…（已截断）' : code;
        return `▸ ${t.name || '(未命名)'}\n${head || '(无代码)'}`;
      }).join('\n\n');
      const more = incoming.length > 5 ? `\n\n…还有 ${incoming.length - 5} 个未显示` : '';
      const ok = confirm(
        `⚠️ 即将导入 ${incoming.length} 个新工具。\n\n` +
        `这些工具的 JS 代码将以页面权限执行（可读取 localStorage、调用 fetch、` +
        `操作 DOM）。如果备份文件来源不明，请取消。\n\n` +
        `——— 前 ${Math.min(5, incoming.length)} 个工具代码预览 ———\n${preview}${more}\n\n` +
        `确认导入？`
      );
      if (ok) {
        for (const t of incoming) state.tools.push(t);
        imported.push(`${incoming.length} 新工具`);
      } else {
        imported.push('0 新工具(已取消)');
      }
    } else if (conflicting.length === 0) {
      imported.push('0 工具(无新增)');
    }

    // 再处理同名冲突：让用户决定是覆盖、跳过还是逐个询问
    if (conflicting.length > 0) {
      const names = conflicting.slice(0, 8).map(t => `• ${t.name}`).join('\n');
      const more2 = conflicting.length > 8 ? `\n…还有 ${conflicting.length - 8} 个` : '';
      const choice = prompt(
        `🔁 备份里有 ${conflicting.length} 个工具与现有工具同名：\n\n${names}${more2}\n\n` +
        `请输入处理方式：\n` +
        `  1 = 全部覆盖（用备份版本替换当前版本）\n` +
        `  2 = 全部跳过（保留当前版本）\n` +
        `  3 = 逐个询问\n` +
        `留空 / 取消 = 全部跳过`,
        '2'
      );
      let overwriteCount = 0;
      let skipCount = 0;
      if (choice === '1') {
        for (const t of conflicting) {
          const idx = state.tools.findIndex(x => x.name === t.name);
          if (idx >= 0) state.tools[idx] = t;
          overwriteCount++;
        }
      } else if (choice === '3') {
        for (const t of conflicting) {
          const code = (t.code || '').trim();
          const head = code.length > 200 ? code.slice(0, 200) + '…' : code;
          const yes = confirm(
            `覆盖工具 "${t.name}"？\n\n` +
            `——— 备份版本代码预览 ———\n${head || '(无代码)'}\n\n` +
            `[确定] = 覆盖     [取消] = 跳过`
          );
          if (yes) {
            const idx = state.tools.findIndex(x => x.name === t.name);
            if (idx >= 0) state.tools[idx] = t;
            overwriteCount++;
          } else {
            skipCount++;
          }
        }
      } else {
        // choice === '2' 或留空 / 取消
        skipCount = conflicting.length;
      }
      if (overwriteCount > 0) imported.push(`${overwriteCount} 覆盖`);
      if (skipCount > 0) imported.push(`${skipCount} 跳过`);
    }
  }
  
  if (opts.chats && Array.isArray(data.chats)) {
    state.chats = [...data.chats, ...state.chats];
    imported.push(`${data.chats.length} 对话`);
  }
  
  persistSettings();
  persistTools();
  saveData();
  refreshModelSelect();
  applyTheme();
  updateTopUrlPreview();
  renderChatList();
  renderMessages();
  updateSendBtn();
  
  const reflectBtn = document.getElementById('reflectBtn');
  if (state.settings.useReflection) reflectBtn.classList.add('reflect-active');
  else reflectBtn.classList.remove('reflect-active');
  const toolsBtn = document.getElementById('toolsBtn');
  if (state.settings.useTools) toolsBtn.classList.add('tool-active');
  else toolsBtn.classList.remove('tool-active');
  const planBtn = document.getElementById('planBtn');
  if (state.settings.usePlan) planBtn.classList.add('plan-active');
  else planBtn.classList.remove('plan-active');
  const outlineBtn = document.getElementById('outlineBtn');
  if (outlineBtn) {
    if (state.settings.useOutline) outlineBtn.classList.add('outline-active');
    else outlineBtn.classList.remove('outline-active');
  }
  
  toast(`✓ 已导入：${imported.join('、') || '（无）'}`);
  closeBackup();
}

function resetAllData() {
  if (!confirm('⚠️ 清空所有数据？建议先备份！')) return;
  if (!confirm('再次确认：不可恢复！')) return;
  // ⭐ 一键清空：storage.clearAll() 会把 IndexedDB 和 localStorage 一起清掉
  if (typeof storage !== 'undefined' && storage.clearAll) {
    storage.clearAll();
  } else {
    // 兜底
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(TOOLS_KEY);
    localStorage.removeItem(BUILTIN_TOOLS_LOADED_KEY);
    if (typeof REQUEST_HISTORY_KEY !== 'undefined') localStorage.removeItem(REQUEST_HISTORY_KEY);
  }
  location.reload();
}