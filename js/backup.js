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

function backupJsonClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
}

function backupReadChecked(id, fallback = false) {
  const el = document.getElementById(id);
  return el ? !!el.checked : fallback;
}

function backupSettingsKeysByPrefixFrom(source, prefixes) {
  const s = source && typeof source === 'object' ? source : {};
  return Object.keys(s).filter(k => prefixes.some(prefix => k === prefix || k.startsWith(prefix)));
}

function backupSettingsKeysByPrefix(prefixes) {
  return backupSettingsKeysByPrefixFrom(state && state.settings ? state.settings : {}, prefixes);
}

function backupOutlineSettingKeys() {
  return backupSettingsKeysByPrefix(['useOutline', 'outline']);
}

function backupReflectionSettingKeys() {
  return backupSettingsKeysByPrefix(['useReflection', 'ref']);
}

function backupPlanSettingKeys() {
  return backupSettingsKeysByPrefix(['usePlan', 'plan']);
}

function backupApplySettingsSubset(target, source, keys) {
  if (!target || !source || !Array.isArray(keys)) return;
  keys.forEach(k => {
    if (source[k] !== undefined) target[k] = backupJsonClone(source[k]);
  });
}

function backupDeleteSettingKeys(target, keys) {
  if (!target || !Array.isArray(keys)) return;
  keys.forEach(k => {
    delete target[k];
  });
}

const BACKUP_SETTING_STORAGE_ITEMS = [
  { id: 'pricingList', key: 'aichat_custom_pricing_v1', label: '定价列表' },
  { id: 'pricingConfig', key: 'aichat_pricing_config_v1', label: '定价配置' },
  { id: 'terminalPerms', key: 'aichat_terminal_perms_v1', label: '权限管理' },
  { id: 'concurrentRequests', key: 'aichat_concurrent_requests_settings_v1', label: '并发请求设置' },
  { id: 'debateSettings', key: 'aichat_debate_settings_v1', label: '辩论模式设置' },
  { id: 'musicPlayer', key: 'aichat_music_player_v1', label: '音乐播放器设置' }
];

function backupStorageGet(key) {
  try {
    if (typeof storage !== 'undefined' && storage && typeof storage.get === 'function') return storage.get(key);
  } catch (e) {}
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function backupStorageSet(key, value) {
  try {
    if (typeof storage !== 'undefined' && storage && typeof storage.set === 'function') {
      storage.set(key, value);
      return true;
    }
  } catch (e) {}
  try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
}

function backupParseStoredJson(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  try { return JSON.parse(raw); } catch (e) { return raw; }
}

function backupBuildExtraSettings() {
  const out = {};
  BACKUP_SETTING_STORAGE_ITEMS.forEach(item => {
    const raw = backupStorageGet(item.key);
    if (raw !== undefined && raw !== null) out[item.id] = backupParseStoredJson(raw);
  });
  return out;
}

function backupApplyExtraSettings(extra) {
  if (!extra || typeof extra !== 'object') return [];
  const imported = [];
  BACKUP_SETTING_STORAGE_ITEMS.forEach(item => {
    if (!Object.prototype.hasOwnProperty.call(extra, item.id)) return;
    const value = extra[item.id];
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    if (backupStorageSet(item.key, raw)) {
      imported.push(item.label);
      if (item.id === 'terminalPerms' && typeof TERMINAL_CONFIG !== 'undefined') {
        TERMINAL_CONFIG.permanentAllow = (value && typeof value === 'object' && !Array.isArray(value)) ? backupJsonClone(value) : {};
      }
    }
  });
  return imported;
}

function backupPlainText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
}

function backupNormalizeTxt(text) {
  return backupPlainText(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function backupDownloadText(filename, text) {
  backupDownloadBlob(filename, new Blob([text], { type: 'text/plain;charset=utf-8' }));
}

function backupDownloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function backupSafeFilename(name) {
  const cleaned = String(name || 'chat')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'chat';
}

function backupFormatDateTime(ts) {
  const n = Number(ts || 0);
  if (!n) return '';
  try { return new Date(n).toLocaleString(); } catch (e) { return ''; }
}

function backupChatTitle(chat) {
  if (!chat) return '未命名对话';
  if (typeof _chatDisplayTitle === 'function') return _chatDisplayTitle(chat) || chat.title || '未命名对话';
  return chat.title || '未命名对话';
}

function backupChatOptionLabel(chat, index) {
  const title = backupChatTitle(chat);
  const count = Array.isArray(chat && chat.messages) ? chat.messages.filter(m => m && !m._hiddenFromUI).length : 0;
  const created = backupFormatDateTime(chat && chat.createdAt);
  return `${index + 1}. ${title}${count ? ` · ${count} 条` : ''}${created ? ` · ${created}` : ''}`;
}

function renderExportTxtChatSelect() {
  const select = document.getElementById('exportTxtChatSelect');
  if (!select) return;
  const chats = Array.isArray(state && state.chats) ? state.chats : [];
  if (!chats.length) {
    select.innerHTML = '<option value="">暂无对话</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const previousIndex = select.value !== '' ? Number(select.value) : NaN;
  const currentIndex = chats.findIndex(chat => chat && chat.id === state.currentId);
  const selectedIndex = Number.isInteger(previousIndex) && chats[previousIndex]
    ? previousIndex
    : (currentIndex >= 0 ? currentIndex : 0);
  select.innerHTML = chats.map((chat, index) => {
    return `<option value="${index}">${escapeHtml(backupChatOptionLabel(chat, index))}</option>`;
  }).join('');
  select.value = String(selectedIndex);
}

function backupDomTextLines(root, extraIgnored = []) {
  if (!root) return [];
  const ignoredSelector = [
    '.avatar',
    '.msg-actions',
    '.plan-step-actions',
    '.plan-approval-btns',
    '.outline-actions-btns',
    '.debate-manual-actions',
    '.debate-final-actions',
    '.msg-timer',
    '.timer-done',
    '.timer-waiting',
    '.timer-streaming',
    '.tool-flow-chip-time',
    '.debate-timeout-timer',
    '.tool-flow-arrow',
    '.modal-footer',
    ...extraIgnored
  ].join(',');
  if (root.matches && root.matches(ignoredSelector)) return [];
  const clone = root.cloneNode(true);
  clone.querySelectorAll(ignoredSelector).forEach(el => el.remove());
  if (clone.classList) clone.classList.remove('collapsed');
  clone.querySelectorAll('.collapsed').forEach(el => el.classList.remove('collapsed'));
  clone.querySelectorAll('details').forEach(el => { el.open = true; });
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '-10000px';
  wrap.style.top = '-10000px';
  wrap.style.width = '900px';
  wrap.style.opacity = '0';
  wrap.style.pointerEvents = 'none';
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  let text = '';
  try {
    text = clone.innerText || clone.textContent || '';
  } finally {
    wrap.remove();
  }
  const normalized = backupNormalizeTxt(text);
  return normalized ? normalized.split('\n').map(line => line.replace(/[ \t]+$/g, '')) : [];
}

function backupMsgRoleText(msg, chat) {
  if (!msg) return '消息';
  if (msg.role === 'user') return '你';
  if (msg.role === 'tool') return `工具返回：${msg.name || 'tool'}`;
  if (msg.debate && msg.debate.kind === 'speech' && typeof _debateSideName === 'function') {
    return _debateSideName(msg.debate.side);
  }
  if (msg._debateJudge || (msg.debate && msg.debate.kind === 'judge')) return '评委';
  if (msg._debateFinalJudge) return '终审裁决';
  if (msg._debateSummary) return '辩论总结';
  if (msg._isSummary) return '对话摘要';
  if (msg._isCompressing) return '系统';
  return chat && chat.taskQueue && chat.taskQueue.type === 'task_queue_item' ? 'AI 助手' : 'Snake';
}

function backupSectionFromMessageNode(node, msg, chat) {
  const lines = backupDomTextLines(node, ['.msg-role']);
  if (!lines.length) return '';
  const role = backupMsgRoleText(msg, chat);
  const first = lines[0] || '';
  if (first === role || first.startsWith(role + ' ') || first.startsWith(role + '\t')) {
    lines.shift();
    while (lines.length && !lines[0]) lines.shift();
  }
  return [`【${role}】`, ...lines].join('\n').trim();
}

function backupRenderChatForTxt(chat) {
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-10000px';
  holder.style.top = '-10000px';
  holder.style.width = '900px';
  holder.style.visibility = 'hidden';
  document.body.appendChild(holder);
  const oldCurrentId = state.currentId;
  try {
    if (chat && chat.id) state.currentId = chat.id;
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : [];
    if (chat && chat.debate && chat.debate.type === 'debate_mode' && chat.debate.status === 'completed' && typeof renderDebateCompletedChat === 'function') {
      holder.innerHTML = renderDebateCompletedChat(chat);
    } else {
      const visible = [];
      messages.forEach((m, i) => {
        if (m && !m._hiddenFromUI) visible.push(i);
      });
      holder.innerHTML = visible.map(i => renderMsg(messages[i], i)).join('');
      if (typeof groupToolFlows === 'function') groupToolFlows(holder, chat);
    }
    return holder;
  } catch (e) {
    console.warn('[backup] render chat txt failed:', e);
    holder.remove();
    throw e;
  } finally {
    state.currentId = oldCurrentId;
  }
}

function backupPrepareExportDom(root) {
  const ignoredSelector = [
    '.avatar',
    '.msg-actions',
    '.plan-step-actions',
    '.plan-approval-btns',
    '.outline-actions-btns',
    '.debate-manual-actions',
    '.debate-final-actions',
    '.msg-timer',
    '.timer-done',
    '.timer-waiting',
    '.timer-streaming',
    '.tool-flow-chip-time',
    '.debate-timeout-timer',
    '.tool-flow-arrow',
    '.modal-footer'
  ].join(',');
  const clone = root.cloneNode(true);
  clone.querySelectorAll(ignoredSelector).forEach(el => el.remove());
  clone.querySelectorAll('.collapsed').forEach(el => el.classList.remove('collapsed'));
  clone.querySelectorAll('details').forEach(el => { el.open = true; });
  return clone;
}

function backupFallbackMessageTxt(msg, chat) {
  const lines = [`【${backupMsgRoleText(msg, chat)}】`];
  if (msg && msg.attachments && msg.attachments.length) {
    lines.push('附件：');
    msg.attachments.forEach(att => {
      const size = typeof formatSize === 'function' ? formatSize(att.size || 0) : `${att.size || 0} bytes`;
      lines.push(`- ${att.name || '附件'} · ${size}${att._stripped ? ' · 数据已丢失' : ''}`);
    });
  }
  if (msg && msg.tool_calls && msg.tool_calls.length) {
    msg.tool_calls.forEach(tc => {
      lines.push(`调用工具：${tc.function?.name || tc.name || 'tool'}`);
      lines.push(backupPlainText(tc.function?.arguments || tc.args || {}));
    });
  }
  if (msg && msg.content) lines.push(backupPlainText(msg.content));
  return lines.join('\n').trim();
}

function backupFallbackChatTxt(chat) {
  return (chat.messages || [])
    .filter(m => m && !m._hiddenFromUI)
    .map(m => backupFallbackMessageTxt(m, chat))
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function buildChatTxtExport(chat) {
  if (!chat) throw new Error('找不到要导出的对话');
  const title = backupChatTitle(chat);
  const created = backupFormatDateTime(chat.createdAt);
  const exportedAt = new Date().toLocaleString();
  let body = '';
  let holder = null;
  try {
    holder = backupRenderChatForTxt(chat);
    const sections = [];
    const directChildren = Array.from(holder.children || []);
    directChildren.forEach(node => {
      if (node.classList && node.classList.contains('tool-flow-group')) {
        const lines = backupDomTextLines(node);
        if (lines.length) sections.push(lines.join('\n').trim());
        return;
      }
      if (node.classList && node.classList.contains('debate-round-fold')) {
        const lines = backupDomTextLines(node);
        if (lines.length) sections.push(lines.join('\n').trim());
        return;
      }
      if (node.classList && node.classList.contains('message')) {
        const idx = parseInt(node.dataset.idx, 10);
        sections.push(backupSectionFromMessageNode(node, chat.messages && chat.messages[idx], chat));
      }
    });
    body = sections.filter(Boolean).join('\n\n---\n\n');
  } catch (e) {
    body = backupFallbackChatTxt(chat);
  } finally {
    if (holder) holder.remove();
  }
  return backupNormalizeTxt([
    `标题：${title}`,
    chat.id ? `对话 ID：${chat.id}` : '',
    created ? `创建时间：${created}` : '',
    `导出时间：${exportedAt}`,
    '',
    '==============================',
    '',
    body || '（无可见消息）'
  ].filter(line => line !== null && line !== undefined).join('\n'));
}

function selectedExportChat() {
  renderExportTxtChatSelect();
  const select = document.getElementById('exportTxtChatSelect');
  const chatIndex = select ? parseInt(select.value, 10) : -1;
  return Array.isArray(state && state.chats) ? state.chats[chatIndex] : null;
}

function buildChatDocExport(chat) {
  if (!chat) throw new Error('找不到要导出的对话');
  const title = backupChatTitle(chat);
  const created = backupFormatDateTime(chat.createdAt);
  const exportedAt = new Date().toLocaleString();
  let contentHtml = '';
  let holder = null;
  try {
    holder = backupRenderChatForTxt(chat);
    const docRoot = backupPrepareExportDom(holder);
    contentHtml = docRoot.innerHTML || '';
  } finally {
    if (holder) holder.remove();
  }
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:"Microsoft YaHei",Arial,sans-serif;font-size:12pt;line-height:1.55;color:#111;margin:28px;}
h1{font-size:20pt;margin:0 0 8px;}
.meta{font-size:10pt;color:#666;margin-bottom:18px;}
.message,.tool-flow-group,.debate-round-fold{border-top:1px solid #ddd;padding:12px 0;}
.msg-role,.tool-flow-title{font-weight:bold;margin-bottom:6px;}
.msg-content,.tool-call-body,.plan-section-body,.outline-section-body,.ref-turn-body{margin:6px 0;}
pre,code{font-family:Consolas,"Courier New",monospace;background:#f5f5f5;white-space:pre-wrap;}
pre{padding:8px;border:1px solid #ddd;}
table{border-collapse:collapse;width:100%;}
td,th{border:1px solid #ddd;padding:4px 6px;}
ul,ol{margin-top:4px;}
.tool-status,.msg-badge,.plan-step-status,.plan-status-badge,.outline-status-badge,.ref-score{font-size:10pt;color:#555;}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">
${chat.id ? `对话 ID：${escapeHtml(chat.id)}<br>` : ''}
${created ? `创建时间：${escapeHtml(created)}<br>` : ''}
导出时间：${escapeHtml(exportedAt)}
</div>
${contentHtml || '<p>（无可见消息）</p>'}
</body>
</html>`;
}

function exportSelectedChatTxt() {
  const chat = selectedExportChat();
  if (!chat) { alert('请选择要导出的对话'); return; }
  const text = buildChatTxtExport(chat);
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  backupDownloadText(`aichat-${backupSafeFilename(backupChatTitle(chat))}-${ts}.txt`, text + '\n');
  toast('✓ 对话 TXT 已下载');
}

function exportSelectedChatDoc() {
  const chat = selectedExportChat();
  if (!chat) { alert('请选择要导出的对话'); return; }
  const html = buildChatDocExport(chat);
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
  backupDownloadBlob(`aichat-${backupSafeFilename(backupChatTitle(chat))}-${ts}.doc`, blob);
  toast('✓ 对话 DOC 已下载');
}

function buildApiProfilesBackup(includeApiKey) {
  if (typeof loadApiProfiles !== 'function') {
    return { version: 1, activeProfileId: '', profiles: [] };
  }
  const profiles = backupJsonClone(loadApiProfiles()) || [];
  for (const p of profiles) {
    if (!includeApiKey && p && p.settings) p.settings.apiKey = '';
  }
  return {
    version: 1,
    activeProfileId: typeof getActiveProfileId === 'function' ? getActiveProfileId() : '',
    profiles
  };
}

function uniqueImportedProfileName(baseName, usedNames) {
  const base = String(baseName || '导入配置').trim() || '导入配置';
  if (!usedNames.has(base)) return base;
  let i = 2;
  while (usedNames.has(`${base}（导入 ${i}）`)) i++;
  return `${base}（导入 ${i}）`;
}

function importApiProfilesFromBackup(payload) {
  const incoming = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.profiles) ? payload.profiles : []);
  if (typeof loadApiProfiles !== 'function' || typeof saveApiProfiles !== 'function') {
    return { imported: 0, skipped: 0, renamed: 0, invalid: incoming.length, activated: false };
  }
  
  const profiles = loadApiProfiles();
  const existingIds = new Set(profiles.map(p => p && p.id).filter(Boolean));
  const usedNames = new Set(profiles.map(p => p && p.name).filter(Boolean));
  let imported = 0;
  let skipped = 0;
  let renamed = 0;
  let invalid = 0;
  
  for (const raw of incoming) {
    const p = backupJsonClone(raw);
    if (!p || typeof p !== 'object' || !p.settings || typeof p.settings !== 'object') {
      invalid++;
      continue;
    }
    if (!p.id) p.id = 'prof_import_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    if (!p.name) p.name = '导入配置';
    if (existingIds.has(p.id)) {
      skipped++;
      continue;
    }
    const finalName = uniqueImportedProfileName(p.name, usedNames);
    if (finalName !== p.name) renamed++;
    p.name = finalName;
    p.createdAt = p.createdAt || Date.now();
    p.updatedAt = Date.now();
    profiles.push(p);
    existingIds.add(p.id);
    usedNames.add(p.name);
    imported++;
  }
  
  saveApiProfiles(profiles);
  
  let activated = false;
  const activeId = payload && !Array.isArray(payload) ? payload.activeProfileId : '';
  if (activeId && typeof setActiveProfileId === 'function' && profiles.some(p => p && p.id === activeId)) {
    setActiveProfileId(activeId);
    activated = true;
  }
  if (typeof renderApiProfileSelect === 'function') renderApiProfileSelect();
  return { imported, skipped, renamed, invalid, activated };
}

function buildExportData() {
  const inc = {
    settings: backupReadChecked('exp_settings', true),
    apiKey: backupReadChecked('exp_apiKey', true),
    apiProfiles: backupReadChecked('exp_apiProfiles', true),
    plan: backupReadChecked('exp_plan', true),
    reflection: backupReadChecked('exp_reflection', true),
    outline: backupReadChecked('exp_outline', true),
    tools: backupReadChecked('exp_tools', true),
    toolArtifacts: backupReadChecked('exp_toolArtifacts', true),
    chats: backupReadChecked('exp_chats', false)
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
    data.settings = settings;
    const extraSettings = backupBuildExtraSettings();
    if (Object.keys(extraSettings).length) data.extraSettings = extraSettings;
  } else {
    const ds = {};
    if (inc.reflection) backupApplySettingsSubset(ds, state.settings, backupReflectionSettingKeys());
    if (inc.plan) backupApplySettingsSubset(ds, state.settings, backupPlanSettingKeys());
    if (inc.outline) backupApplySettingsSubset(ds, state.settings, backupOutlineSettingKeys());
    if (Object.keys(ds).length) data.settings = ds;
  }
  
  if (inc.tools) data.tools = state.tools;
  if (inc.apiProfiles) data.apiProfiles = buildApiProfilesBackup(inc.apiKey);
  if (inc.toolArtifacts && typeof exportToolArtifactsForBackup === 'function') {
    data.toolArtifacts = exportToolArtifactsForBackup();
  }
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
    if (data.extraSettings && typeof data.extraSettings === 'object') {
      const names = BACKUP_SETTING_STORAGE_ITEMS
        .filter(item => Object.prototype.hasOwnProperty.call(data.extraSettings, item.id))
        .map(item => item.label);
      if (names.length) summary += `- ⚙️ 独立设置 ${names.length} 项：${names.map(escapeHtml).join('、')}<br>`;
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
    if (data.apiProfiles) {
      const profiles = Array.isArray(data.apiProfiles)
        ? data.apiProfiles
        : (Array.isArray(data.apiProfiles.profiles) ? data.apiProfiles.profiles : []);
      const existingIds = typeof loadApiProfiles === 'function'
        ? new Set(loadApiProfiles().map(p => p && p.id).filter(Boolean))
        : new Set();
      const newCount = profiles.filter(p => p && p.id && !existingIds.has(p.id)).length;
      summary += `- 🗂️ API 配置档案 ${profiles.length} 个`;
      if (newCount) summary += `（其中 ${newCount} 个为新增）`;
      summary += '<br>';
    }
    if (data.toolArtifacts) {
      const items = Array.isArray(data.toolArtifacts)
        ? data.toolArtifacts
        : (Array.isArray(data.toolArtifacts.items) ? data.toolArtifacts.items : []);
      const totalChars = data.toolArtifacts.totalChars || items.reduce((sum, item) => sum + String(item?.content || '').length, 0);
      summary += `- 🗄️ 工具输出归档 ${items.length} 个`;
      if (typeof formatSize === 'function') summary += `（约 ${formatSize(totalChars)}）`;
      summary += '<br>';
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

  const data = pendingImportData;
  const opts = {
    settings: backupReadChecked('imp_settings', true),
    apiProfiles: backupReadChecked('imp_apiProfiles', true),
    plan: backupReadChecked('imp_plan', true),
    reflection: backupReadChecked('imp_reflection', true),
    outline: backupReadChecked('imp_outline', true),
    tools: backupReadChecked('imp_tools', true),
    toolArtifacts: backupReadChecked('imp_toolArtifacts', true),
    chats: backupReadChecked('imp_chats', false)
  };
  
  let imported = [];
  
  if (data.settings) {
    if (opts.settings) {
      const incoming = { ...data.settings };
      state.settings = { ...state.settings, ...backupJsonClone(incoming) };
      imported.push('设置');
    } else {
      if (opts.reflection) {
        backupApplySettingsSubset(state.settings, data.settings, backupSettingsKeysByPrefixFrom(data.settings, ['useReflection', 'ref']));
        imported.push('师生');
      }
      if (opts.plan) {
        backupApplySettingsSubset(state.settings, data.settings, backupSettingsKeysByPrefixFrom(data.settings, ['usePlan', 'plan']));
        imported.push('计划模式');
      }
      if (opts.outline) {
        backupApplySettingsSubset(state.settings, data.settings, backupSettingsKeysByPrefixFrom(data.settings, ['useOutline', 'outline']));
        imported.push('大纲');
      }
    }
  }
  
  if (opts.settings && data.extraSettings) {
    const extraImported = backupApplyExtraSettings(data.extraSettings);
    if (extraImported.length) imported.push(`独立设置：${extraImported.join('、')}`);
  }
  
  if (opts.apiProfiles && data.apiProfiles) {
    const result = importApiProfilesFromBackup(data.apiProfiles);
    imported.push(`API档案 ${result.imported} 新增${result.skipped ? `/${result.skipped} 已存在` : ''}${result.renamed ? `/${result.renamed} 重命名` : ''}`);
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
  
  if (opts.toolArtifacts && data.toolArtifacts) {
    if (typeof importToolArtifactsFromBackup === 'function') {
      const result = importToolArtifactsFromBackup(data.toolArtifacts);
      imported.push(`归档 ${result.imported} 新增${result.skipped ? `/${result.skipped} 已存在` : ''}${result.invalid ? `/${result.invalid} 无效` : ''}`);
    } else {
      imported.push('归档未导入(模块不可用)');
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
  if (typeof renderApiProfileSelect === 'function') renderApiProfileSelect();
  renderChatList();
  renderMessages();
  updateSendBtn();
  
  const reflectBtn = document.getElementById('reflectBtn');
  if (reflectBtn) {
    if (state.settings.useReflection) reflectBtn.classList.add('reflect-active');
    else reflectBtn.classList.remove('reflect-active');
  }
  const toolsBtn = document.getElementById('toolsBtn');
  if (toolsBtn) {
    if (state.settings.useTools) toolsBtn.classList.add('tool-active');
    else toolsBtn.classList.remove('tool-active');
  }
  const planBtn = document.getElementById('planBtn');
  if (planBtn) {
    if (state.settings.usePlan) planBtn.classList.add('plan-active');
    else planBtn.classList.remove('plan-active');
  }
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
