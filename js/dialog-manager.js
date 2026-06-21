// ============ Dialog manager ============

const DIALOG_MANAGER_ROOT_ID = '__root';
let dialogManagerSelectedChatId = '';

function ensureDialogManagerSettings() {
  if (!state.settings.dialogManager || typeof state.settings.dialogManager !== 'object') {
    state.settings.dialogManager = {};
  }
  const dm = state.settings.dialogManager;
  if (dm.timelineEnabled === undefined) dm.timelineEnabled = true;
  if (!Array.isArray(dm.folders)) dm.folders = [];
  if (!Array.isArray(dm.prompts)) dm.prompts = [];
  dm.folders = dm.folders
    .filter(folder => folder && typeof folder === 'object')
    .map(folder => ({
      id: folder.id || ('folder_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)),
      name: String(folder.name || '未命名文件夹').trim() || '未命名文件夹',
      parentId: folder.parentId || ''
    }));
  const folderIds = new Set(dm.folders.map(folder => folder.id));
  dm.folders.forEach(folder => {
    if (folder.parentId && !folderIds.has(folder.parentId)) folder.parentId = '';
    if (folder.parentId === folder.id) folder.parentId = '';
  });
  dm.prompts = dm.prompts
    .filter(prompt => prompt && typeof prompt === 'object')
    .map(prompt => ({
      id: prompt.id || ('prompt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)),
      title: String(prompt.title || '未命名提示词').trim() || '未命名提示词',
      content: String(prompt.content || ''),
      createdAt: Number(prompt.createdAt) || Date.now(),
      updatedAt: Number(prompt.updatedAt) || Date.now()
    }));
  return dm;
}

function dialogManagerChatTitle(chat) {
  if (!chat) return '未命名对话';
  if (typeof _chatDisplayTitle === 'function') return _chatDisplayTitle(chat) || chat.title || '未命名对话';
  return chat.title || '未命名对话';
}

function dialogManagerVisibleMessages(chat) {
  return Array.isArray(chat && chat.messages) ? chat.messages.filter(m => m && !m._hiddenFromUI) : [];
}

function dialogManagerPlainText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(part => {
      if (!part) return '';
      if (typeof part === 'string') return part;
      return part.text || part.content || '';
    }).filter(Boolean).join('\n');
  }
  try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
}

function dialogManagerMessageTitle(msg, index) {
  return dialogManagerUserQuestionText(msg, index).slice(0, 44);
}

function dialogManagerUserQuestionText(msg, index) {
  const text = dialogManagerPlainText(msg && msg.content).replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 500);
  if (msg && msg.attachments && msg.attachments.length) return `带附件的提问 ${index + 1}`;
  if (msg && msg.tool_calls && msg.tool_calls.length) return '工具调用';
  if (msg && msg.plan) return '计划模式回答';
  if (msg && msg.outline) return '大纲模式回答';
  if (msg && msg.reflection) return '师生讨论回答';
  return `用户发言 ${index + 1}`;
}

function dialogManagerMessageTime(msg, index) {
  const ts = Number((msg && (msg._startTime || msg.createdAt || msg._endTime)) || 0);
  if (!ts) return `#${index + 1}`;
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return `#${index + 1}`;
  }
}

function openDialogManager() {
  ensureDialogManagerSettings();
  const modal = document.getElementById('dialogManagerModal');
  if (!modal) return;
  modal.classList.add('show');
  if (!dialogManagerSelectedChatId || !chatById(dialogManagerSelectedChatId)) {
    dialogManagerSelectedChatId = state.currentId || ((state.chats || [])[0] && state.chats[0].id) || '';
  }
  renderDialogManager();
}

function closeDialogManager() {
  const modal = document.getElementById('dialogManagerModal');
  if (modal) modal.classList.remove('show');
}

function renderDialogManager() {
  const dm = ensureDialogManagerSettings();
  renderDialogManagerSettings(dm);
  renderDialogManagerTimelinePanel();
  renderDialogManagerFolders();
  renderDialogManagerExport();
  renderPromptLibrary();
}

function renderDialogManagerSettings(dm) {
  const checkbox = document.getElementById('dialogTimelineEnabled');
  if (checkbox) checkbox.checked = !!dm.timelineEnabled;
}

function saveDialogManagerSettings() {
  const dm = ensureDialogManagerSettings();
  const checkbox = document.getElementById('dialogTimelineEnabled');
  if (checkbox) dm.timelineEnabled = !!checkbox.checked;
  if (typeof persistSettings === 'function') persistSettings();
  if (typeof updateDialogTimeline === 'function') updateDialogTimeline();
  if (typeof toast === 'function') toast('已保存对话管理设置');
}

function dialogManagerUserAnchors(chat) {
  const anchors = [];
  if (!chat || !Array.isArray(chat.messages)) return anchors;
  chat.messages.forEach((msg, index) => {
    if (!msg || msg._hiddenFromUI || msg.role !== 'user') return;
    const anchorIndex = anchors.length;
    anchors.push({
      msg,
      index,
      title: dialogManagerMessageTitle(msg, anchorIndex),
      tip: dialogManagerUserQuestionText(msg, anchorIndex),
      time: dialogManagerMessageTime(msg, anchorIndex)
    });
  });
  return anchors;
}

function renderDialogManagerTimelinePanel() {
  const wrap = document.getElementById('dialogManagerTimelineList');
  if (!wrap) return;
  const chat = currentChat();
  const anchors = dialogManagerUserAnchors(chat);
  if (!chat) {
    wrap.innerHTML = '<div class="dialog-empty">暂无当前对话</div>';
    return;
  }
  if (!anchors.length) {
    wrap.innerHTML = '<div class="dialog-empty">当前对话还没有用户发言</div>';
    return;
  }
  wrap.innerHTML = anchors.map(anchor => `
    <button class="dialog-timeline-row" type="button" onclick="jumpToDialogMessage(${anchor.index})">
      <span class="dialog-timeline-dot"></span>
      <span class="dialog-timeline-text">
        <strong>${escapeHtml(anchor.title)}</strong>
        <em>${escapeHtml(anchor.time)}</em>
      </span>
    </button>
  `).join('');
}

function updateDialogTimeline() {
  ensureDialogManagerSettings();
  const main = document.querySelector('.main');
  const timeline = document.getElementById('dialogTimeline');
  const list = document.getElementById('dialogTimelineList');
  if (!main || !timeline || !list) return;
  const enabled = !!state.settings.dialogManager.timelineEnabled;
  const chat = currentChat();
  const anchors = enabled ? dialogManagerUserAnchors(chat) : [];
  main.classList.toggle('dialog-timeline-visible', enabled && anchors.length > 0);
  timeline.hidden = !(enabled && anchors.length > 0);
  if (!enabled || !anchors.length) {
    list.innerHTML = '';
    return;
  }
  const activeIdx = getNearestDialogTimelineIndex(anchors);
  list.innerHTML = anchors.map((anchor, i) => `
    <button class="dialog-timeline-point ${i === activeIdx ? 'active' : ''}" type="button" onclick="jumpToDialogMessage(${anchor.index})" data-tip="${escapeHtml(anchor.tip)}" aria-label="${escapeHtml('跳转到 ' + anchor.title)}">
      <span class="dialog-timeline-point-dot"></span>
    </button>
  `).join('');
}

function getNearestDialogTimelineIndex(anchors) {
  const scroller = document.getElementById('messages');
  if (!scroller || !anchors.length) return -1;
  const top = scroller.getBoundingClientRect().top;
  let best = 0;
  let bestDistance = Infinity;
  anchors.forEach((anchor, i) => {
    const node = document.querySelector(`.message[data-idx="${anchor.index}"]`);
    if (!node) return;
    const distance = Math.abs(node.getBoundingClientRect().top - top - 20);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  return best;
}

function jumpToDialogMessage(idx) {
  hideDialogTimelineTip();
  closeDialogManagerSurface();
  setTimeout(() => requestAnimationFrame(() => {
    const node = document.querySelector(`.message[data-idx="${idx}"]`);
    if (!node) return;
    const scroller = document.getElementById('messages');
    if (scroller) {
      const nodeRect = node.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const centeredTop = nodeRect.top - scrollerRect.top + scroller.scrollTop - Math.max(20, (scroller.clientHeight - node.offsetHeight) / 2);
      scroller.scrollTo({ top: Math.max(0, centeredTop), behavior: 'smooth' });
    } else {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    node.classList.add('dialog-jump-highlight');
    setTimeout(() => node.classList.remove('dialog-jump-highlight'), 1600);
  }), 60);
}

function closeDialogManagerSurface() {
  const page = document.getElementById('settingsPage');
  if (page && page.classList.contains('show') && typeof closeSettingsPage === 'function') {
    closeSettingsPage();
    return;
  }
  const modal = document.getElementById('dialogManagerModal');
  if (modal && modal.classList.contains('show')) closeDialogManager();
}

function dialogManagerChatsByFolder() {
  const dm = ensureDialogManagerSettings();
  const folderIds = new Set(dm.folders.map(folder => folder.id));
  const groups = new Map();
  (state.chats || []).forEach(chat => {
    const folderId = chat.dialogFolderId && folderIds.has(chat.dialogFolderId) ? chat.dialogFolderId : '';
    if (!groups.has(folderId)) groups.set(folderId, []);
    groups.get(folderId).push(chat);
  });
  return groups;
}

function renderDialogManagerFolders() {
  const dm = ensureDialogManagerSettings();
  const tree = document.getElementById('dialogFolderTree');
  if (!tree) return;
  const byParent = new Map();
  dm.folders.forEach(folder => {
    const parent = folder.parentId || '';
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(folder);
  });
  for (const folders of byParent.values()) folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  const chatsByFolder = dialogManagerChatsByFolder();
  tree.innerHTML = renderDialogFolderBranch('', byParent, chatsByFolder, 0);
  renderDialogFolderControls(dm);
}

function renderDialogFolderBranch(parentId, byParent, chatsByFolder, depth) {
  const folders = byParent.get(parentId) || [];
  const chats = (chatsByFolder.get(parentId) || []).slice()
    .sort((a, b) => (Number(b.pinnedAt) || 0) - (Number(a.pinnedAt) || 0) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  const folderHtml = folders.map(folder => {
    const childHtml = renderDialogFolderBranch(folder.id, byParent, chatsByFolder, depth + 1);
    return `
      <details class="dialog-folder-node" open>
        <summary>
          <span class="dialog-folder-name">📁 ${escapeHtml(folder.name)}</span>
          <span class="dialog-folder-actions">
            <button type="button" onclick="event.stopPropagation();renameDialogFolder('${escapeHtml(folder.id)}')">重命名</button>
            <button type="button" onclick="event.stopPropagation();deleteDialogFolder('${escapeHtml(folder.id)}')">删除</button>
          </span>
        </summary>
        <div class="dialog-folder-children">${childHtml || '<div class="dialog-empty small">空文件夹</div>'}</div>
      </details>`;
  }).join('');
  const chatHtml = chats.map(chat => `
    <div class="dialog-folder-chat ${chat.id === state.currentId ? 'active' : ''}">
      <button type="button" onclick="switchDialogManagerChat('${escapeHtml(chat.id)}')">
        <span>💬 ${escapeHtml(dialogManagerChatTitle(chat))}</span>
        <em>${dialogManagerVisibleMessages(chat).length} 条</em>
      </button>
    </div>
  `).join('');
  if (!folderHtml && !chatHtml && depth === 0) return '<div class="dialog-empty">暂无对话</div>';
  return folderHtml + chatHtml;
}

function renderDialogFolderControls(dm) {
  const folderSelect = document.getElementById('dialogMoveFolderSelect');
  const chatSelect = document.getElementById('dialogMoveChatSelect');
  const parentSelect = document.getElementById('dialogFolderParentSelect');
  if (chatSelect) {
    chatSelect.innerHTML = (state.chats || []).map(chat => {
      const selected = chat.id === (dialogManagerSelectedChatId || state.currentId) ? ' selected' : '';
      return `<option value="${escapeHtml(chat.id)}"${selected}>${escapeHtml(dialogManagerChatTitle(chat))}</option>`;
    }).join('');
  }
  const folderOptions = [
    '<option value="">根目录</option>',
    ...dm.folders.map(folder => `<option value="${escapeHtml(folder.id)}">${escapeHtml(dialogFolderPath(folder.id))}</option>`)
  ].join('');
  if (folderSelect) folderSelect.innerHTML = folderOptions;
  if (parentSelect) parentSelect.innerHTML = folderOptions;
}

function dialogFolderPath(folderId) {
  const dm = ensureDialogManagerSettings();
  const byId = new Map(dm.folders.map(folder => [folder.id, folder]));
  const parts = [];
  let cur = byId.get(folderId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return parts.join(' / ') || '根目录';
}

function addDialogFolder() {
  const nameInput = document.getElementById('dialogFolderName');
  const parentSelect = document.getElementById('dialogFolderParentSelect');
  const name = (nameInput && nameInput.value.trim()) || '';
  if (!name) {
    if (typeof toast === 'function') toast('请输入文件夹名称');
    return;
  }
  const dm = ensureDialogManagerSettings();
  dm.folders.push({
    id: 'folder_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    name: name.slice(0, 60),
    parentId: parentSelect ? parentSelect.value : ''
  });
  if (nameInput) nameInput.value = '';
  persistSettings();
  renderDialogManagerFolders();
}

function renameDialogFolder(folderId) {
  const dm = ensureDialogManagerSettings();
  const folder = dm.folders.find(item => item.id === folderId);
  if (!folder) return;
  const raw = prompt('重命名文件夹', folder.name);
  if (raw === null) return;
  const name = raw.trim();
  if (!name) {
    if (typeof toast === 'function') toast('名称不能为空');
    return;
  }
  folder.name = name.slice(0, 60);
  persistSettings();
  renderDialogManagerFolders();
}

function deleteDialogFolder(folderId) {
  const dm = ensureDialogManagerSettings();
  const folder = dm.folders.find(item => item.id === folderId);
  if (!folder) return;
  if (!confirm(`删除文件夹“${folder.name}”？\n子文件夹和对话会移动到根目录。`)) return;
  dm.folders.forEach(item => {
    if (item.parentId === folderId) item.parentId = '';
  });
  (state.chats || []).forEach(chat => {
    if (chat.dialogFolderId === folderId) delete chat.dialogFolderId;
  });
  dm.folders = dm.folders.filter(item => item.id !== folderId);
  persistSettings();
  saveData();
  renderDialogManagerFolders();
}

function moveDialogChatToFolder() {
  const chatSelect = document.getElementById('dialogMoveChatSelect');
  const folderSelect = document.getElementById('dialogMoveFolderSelect');
  const chat = chatSelect ? chatById(chatSelect.value) : null;
  if (!chat) {
    if (typeof toast === 'function') toast('请选择对话');
    return;
  }
  const folderId = folderSelect ? folderSelect.value : '';
  if (folderId) chat.dialogFolderId = folderId;
  else delete chat.dialogFolderId;
  saveData();
  renderChatList();
  renderDialogManagerFolders();
}

function switchDialogManagerChat(chatId) {
  if (!chatById(chatId)) return;
  dialogManagerSelectedChatId = chatId;
  switchChat(chatId);
  closeDialogManagerSurface();
}

function renderDialogManagerExport() {
  const select = document.getElementById('dialogExportChatSelect');
  if (!select) return;
  const chats = state.chats || [];
  if (!chats.length) {
    select.innerHTML = '<option value="">暂无对话</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  if (!dialogManagerSelectedChatId || !chatById(dialogManagerSelectedChatId)) {
    dialogManagerSelectedChatId = state.currentId || chats[0].id;
  }
  select.innerHTML = chats.map(chat => {
    const selected = chat.id === dialogManagerSelectedChatId ? ' selected' : '';
    return `<option value="${escapeHtml(chat.id)}"${selected}>${escapeHtml(dialogManagerChatTitle(chat))}</option>`;
  }).join('');
}

function setDialogExportChat(chatId) {
  dialogManagerSelectedChatId = chatId || '';
}

function selectedDialogExportChat() {
  const select = document.getElementById('dialogExportChatSelect');
  const id = select ? select.value : dialogManagerSelectedChatId;
  return chatById(id);
}

function exportDialogManagedChat(format) {
  const chat = selectedDialogExportChat();
  if (!chat) {
    alert('请选择要导出的对话');
    return;
  }
  dialogManagerSelectedChatId = chat.id;
  const title = dialogManagerChatTitle(chat);
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const safeTitle = typeof backupSafeFilename === 'function'
    ? backupSafeFilename(title)
    : title.replace(/[\\/:*?"<>|]+/g, '_');
  const base = `aichat-${safeTitle}-${ts}`;
  if (format === 'txt') {
    backupDownloadText(`${base}.txt`, buildChatTxtExport(chat) + '\n');
  } else if (format === 'doc') {
    backupDownloadBlob(`${base}.doc`, new Blob(['\ufeff', buildChatDocExport(chat)], { type: 'application/msword;charset=utf-8' }));
  } else if (format === 'json') {
    const payload = {
      _meta: { app: 'AI Chat', type: 'single-chat', exportedAt: new Date().toISOString() },
      chat
    };
    backupDownloadBlob(`${base}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
  } else if (format === 'md') {
    backupDownloadText(`${base}.md`, buildDialogMarkdownExport(chat) + '\n');
  } else if (format === 'pdf') {
    exportDialogPdf(chat, `${base}.pdf`);
  }
  if (typeof toast === 'function') toast(`对话 ${format.toUpperCase()} 已导出`);
}

function buildDialogMarkdownExport(chat) {
  const title = dialogManagerChatTitle(chat);
  const created = typeof backupFormatDateTime === 'function' ? backupFormatDateTime(chat.createdAt) : '';
  const lines = [`# ${title}`, ''];
  if (chat.id) lines.push(`- 对话 ID：${chat.id}`);
  if (created) lines.push(`- 创建时间：${created}`);
  lines.push(`- 导出时间：${new Date().toLocaleString()}`, '');
  dialogManagerVisibleMessages(chat).forEach(msg => {
    const role = typeof backupMsgRoleText === 'function' ? backupMsgRoleText(msg, chat) : (msg.role || 'message');
    lines.push(`## ${role}`, '');
    if (msg.attachments && msg.attachments.length) {
      lines.push('附件：');
      msg.attachments.forEach(att => {
        const size = att.size
          ? (typeof formatSize === 'function' ? formatSize(att.size) : `${att.size} bytes`)
          : '';
        lines.push(`- ${att.name || '附件'}${size ? ` (${size})` : ''}`);
      });
      lines.push('');
    }
    const text = dialogManagerPlainText(msg.content).trim();
    lines.push(text || '（无文本内容）', '');
    if (msg.tool_calls && msg.tool_calls.length) {
      lines.push('工具调用：', '');
      msg.tool_calls.forEach(tc => {
        lines.push(`- ${tc.function?.name || tc.name || 'tool'}`);
        lines.push('```json');
        lines.push(dialogManagerPlainText(tc.function?.arguments || tc.args || {}));
        lines.push('```', '');
      });
    }
  });
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

function exportDialogPdf(chat, filename) {
  const html = buildChatDocExport(chat);
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      if (typeof toast === 'function') toast(`请选择“另存为 PDF”：${filename}`, 3500);
    } finally {
      setTimeout(() => frame.remove(), 1200);
    }
  }, 250);
}

function renderPromptLibrary() {
  const dm = ensureDialogManagerSettings();
  const list = document.getElementById('promptLibraryList');
  if (!list) return;
  if (!dm.prompts.length) {
    list.innerHTML = '<div class="dialog-empty">暂无提示词，先保存一个常用模板。</div>';
    return;
  }
  const sorted = dm.prompts.slice().sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  list.innerHTML = sorted.map(prompt => `
    <div class="prompt-card" data-prompt-id="${escapeHtml(prompt.id)}">
      <div class="prompt-card-head">
        <strong>${escapeHtml(prompt.title)}</strong>
        <span>${escapeHtml(new Date(prompt.updatedAt || prompt.createdAt).toLocaleDateString())}</span>
      </div>
      <div class="prompt-card-content">${escapeHtml((prompt.content || '').slice(0, 220))}</div>
      <div class="prompt-card-actions">
        <button class="btn btn-primary" type="button" onclick="applyPromptToChat('${escapeHtml(prompt.id)}')">应用</button>
        <button class="btn" type="button" onclick="editPrompt('${escapeHtml(prompt.id)}')">编辑</button>
        <button class="btn" type="button" onclick="deletePrompt('${escapeHtml(prompt.id)}')">删除</button>
      </div>
    </div>
  `).join('');
}

function clearPromptEditor() {
  const title = document.getElementById('promptTitleInput');
  const content = document.getElementById('promptContentInput');
  const id = document.getElementById('promptEditingId');
  if (title) title.value = '';
  if (content) content.value = '';
  if (id) id.value = '';
}

function savePromptFromUi() {
  const dm = ensureDialogManagerSettings();
  const titleInput = document.getElementById('promptTitleInput');
  const contentInput = document.getElementById('promptContentInput');
  const idInput = document.getElementById('promptEditingId');
  const title = (titleInput && titleInput.value.trim()) || '';
  const content = (contentInput && contentInput.value.trim()) || '';
  if (!title || !content) {
    if (typeof toast === 'function') toast('提示词标题和内容都不能为空');
    return;
  }
  const now = Date.now();
  const editId = idInput ? idInput.value : '';
  const existing = editId ? dm.prompts.find(prompt => prompt.id === editId) : null;
  if (existing) {
    existing.title = title.slice(0, 80);
    existing.content = content;
    existing.updatedAt = now;
  } else {
    dm.prompts.push({
      id: 'prompt_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      title: title.slice(0, 80),
      content,
      createdAt: now,
      updatedAt: now
    });
  }
  persistSettings();
  clearPromptEditor();
  renderPromptLibrary();
}

function editPrompt(promptId) {
  const dm = ensureDialogManagerSettings();
  const prompt = dm.prompts.find(item => item.id === promptId);
  if (!prompt) return;
  const title = document.getElementById('promptTitleInput');
  const content = document.getElementById('promptContentInput');
  const id = document.getElementById('promptEditingId');
  if (title) title.value = prompt.title || '';
  if (content) content.value = prompt.content || '';
  if (id) id.value = prompt.id;
  if (title) title.focus();
}

function deletePrompt(promptId) {
  const dm = ensureDialogManagerSettings();
  const prompt = dm.prompts.find(item => item.id === promptId);
  if (!prompt) return;
  if (!confirm(`删除提示词“${prompt.title}”？`)) return;
  dm.prompts = dm.prompts.filter(item => item.id !== promptId);
  persistSettings();
  renderPromptLibrary();
}

function applyPromptToChat(promptId) {
  const dm = ensureDialogManagerSettings();
  const prompt = dm.prompts.find(item => item.id === promptId);
  if (!prompt) return;
  if (!currentChat()) newChat();
  if (typeof closeSettingsPage === 'function') closeSettingsPage();
  else closeDialogManager();
  const input = document.getElementById('input');
  if (!input) return;
  input.value = prompt.content || '';
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

function initDialogManager() {
  ensureDialogManagerSettings();
  const messages = document.getElementById('messages');
  if (messages && !messages._dialogTimelineBound) {
    messages._dialogTimelineBound = true;
    messages.addEventListener('scroll', () => {
      clearTimeout(messages._dialogTimelineTimer);
      messages._dialogTimelineTimer = setTimeout(updateDialogTimeline, 80);
    });
  }
  bindDialogTimelineHover();
  updateDialogTimeline();
}

function bindDialogTimelineHover() {
  const list = document.getElementById('dialogTimelineList');
  if (!list || list._dialogTimelineHoverBound) return;
  list._dialogTimelineHoverBound = true;
  list.addEventListener('mouseover', event => {
    const point = event.target.closest('.dialog-timeline-point');
    if (!point || !list.contains(point)) return;
    showDialogTimelineTip(point);
  });
  list.addEventListener('mouseout', event => {
    const point = event.target.closest('.dialog-timeline-point');
    if (!point || (event.relatedTarget && point.contains(event.relatedTarget))) return;
    hideDialogTimelineTip();
  });
}

function ensureDialogTimelineTip() {
  let tip = document.getElementById('dialogTimelineTip');
  if (tip) return tip;
  tip = document.createElement('div');
  tip.id = 'dialogTimelineTip';
  tip.className = 'dialog-timeline-tip';
  document.body.appendChild(tip);
  return tip;
}

function showDialogTimelineTip(point) {
  const text = point && point.dataset ? point.dataset.tip : '';
  if (!text) return;
  const tip = ensureDialogTimelineTip();
  const rect = point.getBoundingClientRect();
  tip.textContent = text;
  tip.style.left = `${Math.max(8, rect.left - 10)}px`;
  tip.style.top = `${Math.min(window.innerHeight - 20, Math.max(20, rect.top + rect.height / 2))}px`;
  tip.classList.add('show');
}

function hideDialogTimelineTip() {
  const tip = document.getElementById('dialogTimelineTip');
  if (tip) tip.classList.remove('show');
}

window.openDialogManager = openDialogManager;
window.closeDialogManager = closeDialogManager;
window.renderDialogManager = renderDialogManager;
window.saveDialogManagerSettings = saveDialogManagerSettings;
window.updateDialogTimeline = updateDialogTimeline;
window.jumpToDialogMessage = jumpToDialogMessage;
window.addDialogFolder = addDialogFolder;
window.renameDialogFolder = renameDialogFolder;
window.deleteDialogFolder = deleteDialogFolder;
window.moveDialogChatToFolder = moveDialogChatToFolder;
window.switchDialogManagerChat = switchDialogManagerChat;
window.setDialogExportChat = setDialogExportChat;
window.exportDialogManagedChat = exportDialogManagedChat;
window.savePromptFromUi = savePromptFromUi;
window.clearPromptEditor = clearPromptEditor;
window.editPrompt = editPrompt;
window.deletePrompt = deletePrompt;
window.applyPromptToChat = applyPromptToChat;
window.initDialogManager = initDialogManager;
