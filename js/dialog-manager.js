// ============ Dialog manager ============

const DialogManagerStateModule = window.AgentApp.require('state');
const dialogManagerState = DialogManagerStateModule.state;
const dialogManagerSaveData = DialogManagerStateModule.saveData;
const dialogManagerPersistSettings = DialogManagerStateModule.persistSettings;
const dialogManagerCurrentChat = DialogManagerStateModule.currentChat;
const dialogManagerChatById = DialogManagerStateModule.chatById;
const dialogManagerIsChatGenerating = DialogManagerStateModule.isChatGenerating;
const dialogManagerSyncGlobalTaskState = DialogManagerStateModule.syncGlobalTaskState;
const DialogManagerUiService = window.AgentApp.require('uiService');

function dialogManagerToast(message, ms) {
  DialogManagerUiService.toast(message, ms);
}

function dialogManagerRenderChatList() {
  DialogManagerUiService.renderChatList();
}

function dialogManagerRenderMessages() {
  DialogManagerUiService.renderMessages();
}

function dialogManagerUpdateSendBtn() {
  DialogManagerUiService.updateSendBtn();
}

const DIALOG_MANAGER_ROOT_ID = '__root';
let dialogManagerSelectedChatId = '';

function ensureDialogManagerSettings() {
  if (!dialogManagerState.settings.dialogManager || typeof dialogManagerState.settings.dialogManager !== 'object') {
    dialogManagerState.settings.dialogManager = {};
  }
  const dm = dialogManagerState.settings.dialogManager;
  if (dm.timelineEnabled === undefined) dm.timelineEnabled = true;
  if (!dm.explorerViewMode || !['icons','list'].includes(dm.explorerViewMode)) dm.explorerViewMode = 'icons';
  if (!dm.explorerSortMode || !['created','name','recent'].includes(dm.explorerSortMode)) dm.explorerSortMode = 'created';
  if (!Array.isArray(dm.folders)) dm.folders = [];
  if (!Array.isArray(dm.prompts)) dm.prompts = [];
  dm.folders = dm.folders
    .filter(folder => folder && typeof folder === 'object')
    .map(folder => ({
      id: folder.id || ('folder_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)),
      name: (String(folder.name || '未命名文件夹').trim() || '未命名文件夹').slice(0, DIALOG_EXPLORER_MAX_NAME_LEN),
      parentId: folder.parentId || '',
      createdAt: Number(folder.createdAt) || Date.now(),
      _modifiedAt: Number(folder._modifiedAt) || Number(folder.createdAt) || Date.now()
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
  if (msg && msg._timelineLabel) return msg._timelineLabel;
  return dialogManagerUserQuestionText(msg, index).slice(0, 44);
}

function dialogManagerUserQuestionText(msg, index) {
  if (msg && msg._timelineLabel) return msg._timelineLabel;
  const text = dialogManagerPlainText(msg && msg.content).replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 500);
  if (msg && msg.attachments && msg.attachments.length) return `带附件的提问 ${index + 1}`;
  if (msg && msg.tool_calls && msg.tool_calls.length) return '工具调用';
  if (msg && msg.plan) return '计划模式回答';
  if (msg && msg.outline) return '大纲模式回答';
  if (msg && msg.reflection) return '师生讨论回答';
  return `用户发言 ${index + 1}`;
}

function renameTimelineNode(index) {
  const chat = dialogManagerCurrentChat();
  if (!chat || !Array.isArray(chat.messages)) return;
  const msg = chat.messages[index];
  if (!msg || msg.role !== 'user') return;
  const currentLabel = msg._timelineLabel || dialogManagerUserQuestionText(msg, index);
  const newLabel = prompt('重命名节点：', currentLabel);
  if (newLabel === null || newLabel === currentLabel) return;
  if (newLabel.trim()) {
    msg._timelineLabel = newLabel.trim();
  } else {
    delete msg._timelineLabel;
  }
  dialogManagerSaveData();
  renderDialogManagerTimelinePanel();
  if (typeof updateDialogTimeline === 'function') updateDialogTimeline();
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
  if (!dialogManagerSelectedChatId || !dialogManagerChatById(dialogManagerSelectedChatId)) {
    dialogManagerSelectedChatId = dialogManagerState.currentId || ((dialogManagerState.chats || [])[0] && dialogManagerState.chats[0].id) || '';
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
  dialogManagerPersistSettings();
  if (typeof updateDialogTimeline === 'function') updateDialogTimeline();
  dialogManagerToast('已保存对话管理设置');
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
  const chat = dialogManagerCurrentChat();
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
    <button class="dialog-timeline-row" type="button" data-action="valueClick" data-handler="jumpToDialogMessage" data-value="${anchor.index}" data-value-type="number">
      <span class="dialog-timeline-dot"></span>
      <span class="dialog-timeline-text">
        <strong>${escapeHtml(anchor.title)}</strong>
        <em>${escapeHtml(anchor.time)}</em>
      </span>
      <span class="dialog-timeline-rename" title="重命名" data-action="valueClick" data-handler="renameTimelineNode" data-value="${anchor.index}" data-value-type="number" data-stop-propagation="true">✎</span>
    </button>
  `).join('');
}

function updateDialogTimeline() {
  ensureDialogManagerSettings();
  const main = document.querySelector('.main');
  const timeline = document.getElementById('dialogTimeline');
  const list = document.getElementById('dialogTimelineList');
  if (!main || !timeline || !list) return;
  const enabled = !!dialogManagerState.settings.dialogManager.timelineEnabled;
  const chat = dialogManagerCurrentChat();
  const anchors = enabled ? dialogManagerUserAnchors(chat) : [];
  main.classList.toggle('dialog-timeline-visible', enabled && anchors.length > 0);
  timeline.hidden = !(enabled && anchors.length > 0);
  if (!enabled || !anchors.length) {
    list.innerHTML = '';
    return;
  }
  const activeIdx = getNearestDialogTimelineIndex(anchors);
  list.innerHTML = anchors.map((anchor, i) => `
    <button class="dialog-timeline-point ${i === activeIdx ? 'active' : ''}" type="button" data-action="valueClick" data-handler="jumpToDialogMessage" data-value="${anchor.index}" data-value-type="number" data-tip="${escapeHtml(anchor.tip)}" aria-label="${escapeHtml('跳转到 ' + anchor.title)}">
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

let dialogManagerCurrentFolderId = '';

function chatLatestMessageTime(chat) {
  if (!chat || !Array.isArray(chat.messages)) return 0;
  let latest = 0;
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (!m || m._hiddenFromUI) continue;
    const t = Number(m._startTime || m.createdAt || m._endTime || 0);
    if (t > latest) latest = t;
  }
  return latest || Number(chat.createdAt) || 0;
}

function dialogManagerChatsByFolder() {
  const dm = ensureDialogManagerSettings();
  const folderIds = new Set(dm.folders.map(folder => folder.id));
  const groups = new Map();
  (dialogManagerState.chats || []).forEach(chat => {
    const folderId = chat.dialogFolderId && folderIds.has(chat.dialogFolderId) ? chat.dialogFolderId : '';
    if (!groups.has(folderId)) groups.set(folderId, []);
    groups.get(folderId).push(chat);
  });
  return groups;
}

const DIALOG_EXPLORER_MAX_DEPTH = 6;
const DIALOG_EXPLORER_MAX_NAME_LEN = 15;

const ICON_FOLDER = '<img src="icon/文件夹-开_folder-open.png" alt="">';
const ICON_TASK_GROUP = '<img src="icon/流水线_assembly-line.png" alt="">';
const ICON_CHAT = '<img src="icon/评论_comment.png" alt="">';
const ICON_EXPORT_MD = '<img src="icon/井号文件_file-hash.png" alt="">';
const ICON_EXPORT_TXT = '<img src="icon/文本文件_file-text.png" alt="">';
const ICON_EXPORT_JSON = '<img src="icon/代码文件_file-code.png" alt="">';
const ICON_EXPORT_DOC = '<img src="icon/文件-word_file-word.png" alt="">';
const ICON_EXPORT_PDF = '<img src="icon/pdf文件_file-pdf-one.png" alt="">';
const ICON_RENAME = '<img src="icon/铅笔_pencil.png" alt="">';
const ICON_DELETE = '<img src="icon/删除_delete.png" alt="">';
const ICON_HIDE_CHAT = '<img src="icon/预览-关闭_preview-close-one.png" alt="">';
const ICON_SHOW_CHAT = '<img src="icon/预览-打开_preview-open.png" alt="">';
const ICON_BREADCRUMB = '<img src="icon/文件夹-开_folder-open.png" alt="">';
const ICON_VIEW_ICONS = '<img src="icon/全部_all-application.png" alt="">';
const ICON_VIEW_LIST = '<img src="icon/汉堡图标_hamburger-button.png" alt="">';

function dialogExplorerFolderDepth(folderId) {
  const dm = ensureDialogManagerSettings();
  const byId = new Map(dm.folders.map(f => [f.id, f]));
  let depth = 0;
  let cur = folderId;
  const seen = new Set();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    depth++;
    const f = byId.get(cur);
    cur = f ? (f.parentId || '') : '';
  }
  return depth;
}

function touchFolder(folderId) {
  if (!folderId) return;
  const dm = ensureDialogManagerSettings();
  const folder = dm.folders.find(f => f.id === folderId);
  if (folder) folder._modifiedAt = Date.now();
}

function dialogExplorerResolveFolderTarget(targetFolderId, dm = ensureDialogManagerSettings()) {
  const id = targetFolderId || '';
  if (!id) return '';
  if (id.startsWith('__group_')) return null;
  return dm.folders.some(folder => folder.id === id) ? id : null;
}

function dialogExplorerIsTaskGroupChat(chat) {
  if (!chat || !chat.taskQueue) return false;
  if (typeof isTaskQueueSidebarGroupedChat === 'function') {
    return isTaskQueueSidebarGroupedChat(chat);
  }
  return chat.taskQueue.type === 'task_queue_item'
    && !!chat.taskQueue.groupId
    && !!chat.taskQueue.groupFinalized;
}

function dialogManagerCleanupTaskQueueDeletedChats(deletedChats) {
  const ids = new Set((deletedChats || []).map(chat => chat && chat.id).filter(Boolean));
  if (!ids.size || !dialogManagerState.taskQueue || !Array.isArray(dialogManagerState.taskQueue.items)) return;

  const deletedGroupIds = new Set(
    (deletedChats || [])
      .map(chat => chat && chat.taskQueue && chat.taskQueue.groupId)
      .filter(Boolean)
  );
  let changed = false;

  for (const item of dialogManagerState.taskQueue.items) {
    if (!item || !ids.has(item.chatId)) continue;
    item.chatId = null;
    item.sidebarGroupId = '';
    item.promptHash = '';
    changed = true;
  }

  if (dialogManagerState.taskQueue.sidebarGroupId && deletedGroupIds.has(dialogManagerState.taskQueue.sidebarGroupId)) {
    const hasRemainingGroupChat = (dialogManagerState.chats || []).some(chat =>
      chat && chat.taskQueue && chat.taskQueue.groupId === dialogManagerState.taskQueue.sidebarGroupId
    );
    if (!hasRemainingGroupChat) {
      dialogManagerState.taskQueue.sidebarGroupId = null;
      dialogManagerState.taskQueue.sidebarGroupStartedAt = null;
      dialogManagerState.taskQueue.sidebarGroupFinalizedAt = null;
      changed = true;
    }
  }

  if (!changed) return;
  if (typeof saveTaskQueue === 'function') saveTaskQueue();
  if (typeof renderTaskQueueModal === 'function') renderTaskQueueModal();
}

function dialogExplorerMaxChildDepth(folderId) {
  const dm = ensureDialogManagerSettings();
  let maxDepth = 0;
  function walk(pid, depth) {
    dm.folders.forEach(f => {
      if ((f.parentId || '') === pid) {
        if (depth > maxDepth) maxDepth = depth;
        walk(f.id, depth + 1);
      }
    });
  }
  walk(folderId, 1);
  return maxDepth;
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

function renderDialogManagerFolders() {
  const dm = ensureDialogManagerSettings();
  renderDialogExplorerNav(dm);
  renderDialogExplorerItems(dm);
}

function renderDialogExplorerNav(dm) {
  const nav = document.getElementById('dialogExplorerNav');
  if (!nav) return;
  const currentId = dialogManagerCurrentFolderId;
  const mode = dm.explorerViewMode || 'icons';
  const isGroupView = currentId.startsWith('__group_');
  const groupId = isGroupView ? currentId.slice(8) : '';

  let canGoUp, segments;

  if (isGroupView) {
    canGoUp = true;
    const groupChats = (dialogManagerState.chats || []).filter(c =>
      dialogExplorerIsTaskGroupChat(c) && c.taskQueue.groupId === groupId
    );
    const groupName = (typeof taskQueueGroupTitle === 'function')
      ? taskQueueGroupTitle(groupChats)
      : ('任务组 ' + groupId.slice(0, 6));
    segments = [
      { id: '', name: '根目录' },
      { id: currentId, name: groupName }
    ];
  } else {
    canGoUp = !!currentId;
    const folder = canGoUp ? dm.folders.find(f => f.id === currentId) : null;
    segments = [{ id: '', name: '根目录' }];
    const chain = [];
    let cur = currentId;
    while (cur) {
      const f = dm.folders.find(f => f.id === cur);
      if (!f) break;
      chain.unshift({ id: f.id, name: f.name });
      cur = f.parentId || '';
    }
    segments.push(...chain);
  }

  const isRoot = segments.length <= 1;

  let html = `<button class="dialog-explorer-nav-btn" type="button" data-action="dialogExplorerGoUp"${canGoUp ? '' : ' disabled'}>⬅ 返回</button>`;
  html += `<span class="dialog-explorer-nav-sep">›</span>`;

  segments.forEach((seg, i) => {
    if (i > 0) html += `<span class="dialog-explorer-nav-sep">›</span>`;
    const isLast = i === segments.length - 1;
    html += `<button class="dialog-explorer-nav-btn dialog-explorer-breadcrumb${isLast && !isRoot ? ' active' : ''}"
             type="button"
             data-action="valueClick"
             data-handler="dialogExplorerEnterFolder"
             data-value="${escapeHtml(seg.id)}"
             data-dragover-action="dialogExplorerBreadcrumbDragOver"
             data-dragleave-action="dialogExplorerBreadcrumbDragLeave"
             data-drop-action="dialogExplorerItemDrop"
             data-drop-value="${escapeHtml(seg.id)}"
             >${ICON_BREADCRUMB} ${escapeHtml(seg.name)}</button>`;
  });

  html += `<span class="dialog-explorer-nav-spacer"></span>`;
  const sortMode = dm.explorerSortMode || 'created';
  const sortOptions = [
    { value: 'created', label: '创建时间' },
    { value: 'name', label: '名称' },
    { value: 'recent', label: '最近修改' }
  ];
  html += `<select class="dialog-explorer-sort" data-change-action="valueChange" data-handler="dialogExplorerToggleSort">`;
  sortOptions.forEach(opt => {
    html += `<option value="${opt.value}"${sortMode === opt.value ? ' selected' : ''}>${opt.label}</option>`;
  });
  html += `</select>`;
  html += `<button class="dialog-explorer-nav-btn${mode === 'icons' ? ' active' : ''}" type="button" data-action="valueClick" data-handler="dialogExplorerToggleView" data-value="icons">${ICON_VIEW_ICONS} 图标</button>`;
  html += `<button class="dialog-explorer-nav-btn${mode === 'list' ? ' active' : ''}" type="button" data-action="valueClick" data-handler="dialogExplorerToggleView" data-value="list">${ICON_VIEW_LIST} 列表</button>`;
  nav.innerHTML = html;
}

function dialogExplorerBreadcrumbDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('breadcrumb-drag-over');
}

function dialogExplorerBreadcrumbDragLeave(e) {
  e.currentTarget.classList.remove('breadcrumb-drag-over');
}

function renderDialogExplorerItems(dm) {
  const area = document.getElementById('dialogExplorerArea');
  if (!area) return;
  const currentId = dialogManagerCurrentFolderId;
  const mode = dm.explorerViewMode || 'icons';

  area.className = 'dialog-explorer-area ' + mode;

  const sortMode = dm.explorerSortMode || 'created';
  const isGroupView = currentId.startsWith('__group_');
  const groupId = isGroupView ? currentId.slice(8) : '';

  if (isGroupView) {
    // Virtual task queue group view - read-only, show only group chats
    const groupChats = (dialogManagerState.chats || []).filter(c =>
      dialogExplorerIsTaskGroupChat(c) && !c._hiddenFromUI && c.taskQueue.groupId === groupId
    );
    const sorted = (typeof sortTaskQueueGroupChats === 'function')
      ? sortTaskQueueGroupChats(groupChats)
      : groupChats;

    if (!sorted.length) {
      area.innerHTML = '<div class="dialog-explorer-empty">该任务组中没有对话</div>';
    } else {
      let html = '';
      sorted.forEach(chat => {
        const title = dialogManagerChatTitle(chat);
        const count = dialogManagerVisibleMessages(chat).length;
        html += `
          <div class="dialog-explorer-item ${chat.id === dialogManagerState.currentId ? 'selected' : ''}"
               data-explorer-type="chat" data-explorer-id="${escapeHtml(chat.id)}"
               data-action="valueClick" data-handler="switchDialogManagerChat" data-value="${escapeHtml(chat.id)}"
               data-contextmenu-action="dialogExplorerContextMenu" data-contextmenu-value="chat" data-contextmenu-extra-value="${escapeHtml(chat.id)}">
            <span class="dialog-explorer-item-icon">${ICON_CHAT}</span>
            <span class="dialog-explorer-item-label">${escapeHtml(title)}</span>
            <span class="dialog-explorer-item-meta">${count} 条</span>
          </div>`;
      });
      area.innerHTML = html;
    }
    // Read-only: no drag, no context menu
    area.oncontextmenu = null;
    area.ondragover = null;
    area.ondragleave = null;
    area.ondrop = null;
    return;
  } else {
    // Normal view - regular folders first
    const folders = dm.folders.filter(f => (f.parentId || '') === currentId)
      .sort((a, b) => {
        if (sortMode === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN');
        if (sortMode === 'recent') return (Number(b._modifiedAt) || 0) - (Number(a._modifiedAt) || 0);
        return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
      });

    // Chats in current directory, split into task groups and standalone
    const chatsByFolder = dialogManagerChatsByFolder();
    const allChats = (chatsByFolder.get(currentId) || []).slice();

    // Detect task queue groups
    const groupMap = new Map();
    const standaloneChats = [];
    allChats.forEach(chat => {
      const gid = dialogExplorerIsTaskGroupChat(chat) && chat.taskQueue && chat.taskQueue.groupId;
      if (gid) {
        if (!groupMap.has(gid)) groupMap.set(gid, []);
        groupMap.get(gid).push(chat);
      } else {
        standaloneChats.push(chat);
      }
    });

    // Build virtual folder entries for task groups
    const virtualFolders = [];
    groupMap.forEach((chats, gid) => {
      const title = (typeof taskQueueGroupTitle === 'function')
        ? taskQueueGroupTitle(chats)
        : ('任务组 ' + gid.slice(0, 6));
      virtualFolders.push({ id: '__group_' + gid, name: title, count: chats.length, chats });
    });

    // Sort standalone chats
    standaloneChats.sort((a, b) => {
      const pa = Number(a.pinnedAt) || 0;
      const pb = Number(b.pinnedAt) || 0;
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      if (pa && pb) return pb - pa;
      if (sortMode === 'name') {
        return dialogManagerChatTitle(a).localeCompare(dialogManagerChatTitle(b), 'zh-Hans-CN');
      }
      if (sortMode === 'recent') {
        return chatLatestMessageTime(b) - chatLatestMessageTime(a);
      }
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });

    // Merge virtual folders and standalone chats, sorted together
    const mixedItems = [
      ...virtualFolders.map(vf => ({ type: 'taskGroup', data: vf })),
      ...standaloneChats.map(chat => ({ type: 'chat', data: chat }))
    ];

    mixedItems.sort((a, b) => {
      // Pinned chats always first
      const pa = a.type === 'chat' ? (Number(a.data.pinnedAt) || 0) : 0;
      const pb = b.type === 'chat' ? (Number(b.data.pinnedAt) || 0) : 0;
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      if (pa && pb) return pb - pa;
      // Sort by mode
      if (sortMode === 'name') {
        const na = a.type === 'taskGroup' ? a.data.name : dialogManagerChatTitle(a.data);
        const nb = b.type === 'taskGroup' ? b.data.name : dialogManagerChatTitle(b.data);
        return na.localeCompare(nb, 'zh-Hans-CN');
      }
      if (sortMode === 'recent') {
        const ta = a.type === 'taskGroup' ? Math.max(...a.data.chats.map(c => chatLatestMessageTime(c))) : chatLatestMessageTime(a.data);
        const tb = b.type === 'taskGroup' ? Math.max(...b.data.chats.map(c => chatLatestMessageTime(c))) : chatLatestMessageTime(b.data);
        return tb - ta;
      }
      // created
      const ca = a.type === 'taskGroup' ? Math.min(...a.data.chats.map(c => Number(c.createdAt) || 0)) : (Number(a.data.createdAt) || 0);
      const cb = b.type === 'taskGroup' ? Math.min(...b.data.chats.map(c => Number(c.createdAt) || 0)) : (Number(b.data.createdAt) || 0);
      return cb - ca;
    });

    if (!folders.length && !mixedItems.length) {
      area.innerHTML = '<div class="dialog-explorer-empty">右键此处新建文件夹，或拖动对话到此</div>';
    } else {
      let html = '';
      // Regular folders first
      folders.forEach(folder => {
        html += `
          <div class="dialog-explorer-item" draggable="true"
               data-explorer-type="folder" data-explorer-id="${escapeHtml(folder.id)}"
               data-action="valueClick" data-handler="dialogExplorerEnterFolder" data-value="${escapeHtml(folder.id)}"
               data-contextmenu-action="dialogExplorerContextMenu" data-contextmenu-value="folder" data-contextmenu-extra-value="${escapeHtml(folder.id)}"
               data-dragstart-action="dialogExplorerDragStart" data-dragstart-value="folder" data-dragstart-extra-value="${escapeHtml(folder.id)}"
               data-dragend-action="dialogExplorerDragEnd"
               data-dragover-action="dialogExplorerItemDragOver"
               data-dragleave-action="dialogExplorerItemDragLeave"
               data-drop-action="dialogExplorerItemDrop" data-drop-value="${escapeHtml(folder.id)}">
            <span class="dialog-explorer-item-icon">${ICON_FOLDER}</span>
            <span class="dialog-explorer-item-label">${escapeHtml(folder.name)}</span>
            ${mode === 'list' ? '<span class="dialog-explorer-item-meta">文件夹</span>' : ''}
          </div>`;
      });
      // Mixed: virtual task groups + standalone chats
      mixedItems.forEach(item => {
        if (item.type === 'taskGroup') {
          const vf = item.data;
          html += `
            <div class="dialog-explorer-item"
                 data-explorer-type="taskGroup" data-explorer-id="${escapeHtml(vf.id)}"
                 data-action="valueClick" data-handler="dialogExplorerEnterFolder" data-value="${escapeHtml(vf.id)}"
                 data-contextmenu-action="dialogExplorerContextMenu" data-contextmenu-value="taskGroup" data-contextmenu-extra-value="${escapeHtml(vf.id)}">
              <span class="dialog-explorer-item-icon">${ICON_TASK_GROUP}</span>
              <span class="dialog-explorer-item-label">${escapeHtml(vf.name)}</span>
              <span class="dialog-explorer-item-meta">${vf.count} 个对话</span>
            </div>`;
        } else {
          const chat = item.data;
          const title = dialogManagerChatTitle(chat);
          const count = dialogManagerVisibleMessages(chat).length;
          html += `
            <div class="dialog-explorer-item ${chat.id === dialogManagerState.currentId ? 'selected' : ''}" draggable="true"
                 data-explorer-type="chat" data-explorer-id="${escapeHtml(chat.id)}"
                 data-action="valueClick" data-handler="switchDialogManagerChat" data-value="${escapeHtml(chat.id)}"
                 data-contextmenu-action="dialogExplorerContextMenu" data-contextmenu-value="chat" data-contextmenu-extra-value="${escapeHtml(chat.id)}"
                 data-dragstart-action="dialogExplorerDragStart" data-dragstart-value="chat" data-dragstart-extra-value="${escapeHtml(chat.id)}"
                 data-dragend-action="dialogExplorerDragEnd">
              <span class="dialog-explorer-item-icon">${ICON_CHAT}</span>
              <span class="dialog-explorer-item-label">${escapeHtml(title)}</span>
              <span class="dialog-explorer-item-meta">${count} 条</span>
            </div>`;
        }
      });
      area.innerHTML = html;
    }
  }

  // Bind area-level events
  area.oncontextmenu = function(e) {
    if (e.target === area || e.target.classList.contains('dialog-explorer-empty')) {
      return dialogExplorerContextMenu(e, 'area', '');
    }
  };
  area.ondragover = function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    area.classList.add('drag-over');
  };
  area.ondragleave = function(e) {
    if (!area.contains(e.relatedTarget)) area.classList.remove('drag-over');
  };
  area.ondrop = function(e) {
    e.preventDefault();
    area.classList.remove('drag-over');
    const type = e.dataTransfer.getData('text/type');
    const id = e.dataTransfer.getData('text/id');
    if (type && id) dialogExplorerDrop(id, type, currentId);
  };
}

function dialogExplorerToggleView(mode) {
  const dm = ensureDialogManagerSettings();
  dm.explorerViewMode = mode;
  dialogManagerPersistSettings();
  renderDialogManagerFolders();
}

function dialogExplorerToggleSort(mode) {
  const dm = ensureDialogManagerSettings();
  dm.explorerSortMode = mode;
  dialogManagerPersistSettings();
  renderDialogManagerFolders();
}

// --- Drag & Drop ---

function dialogExplorerDragStart(e, type, id) {
  e.dataTransfer.setData('text/type', type);
  e.dataTransfer.setData('text/id', id);
  e.dataTransfer.effectAllowed = 'move';
  e.target.classList.add('dragging');
}

function dialogExplorerDragEnd(e) {
  e.target.classList.remove('dragging');
}

function dialogExplorerItemDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function dialogExplorerItemDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function dialogExplorerItemDrop(e, targetFolderId) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
  const type = e.dataTransfer.getData('text/type');
  const id = e.dataTransfer.getData('text/id');
  if (type && id) dialogExplorerDrop(id, type, targetFolderId);
}

function dialogExplorerDrop(id, type, targetFolderId) {
  if (type === 'chat') {
    const targetId = dialogExplorerResolveFolderTarget(targetFolderId);
    if (targetId === null) {
      dialogManagerToast('目标文件夹不存在', 2000);
      renderDialogManagerFolders();
      return;
    }
    const chat = dialogManagerChatById(id);
    if (!chat) return;
    const oldFolderId = chat.dialogFolderId || '';
    if (targetId) chat.dialogFolderId = targetId;
    else delete chat.dialogFolderId;
    touchFolder(oldFolderId);
    touchFolder(targetId);
    dialogManagerSaveData();
    dialogManagerRenderChatList();
    renderDialogManagerFolders();
  } else if (type === 'folder') {
    const dm = ensureDialogManagerSettings();
    const folder = dm.folders.find(f => f.id === id);
    if (!folder) return;
    const targetId = dialogExplorerResolveFolderTarget(targetFolderId, dm);
    if (targetId === null) {
      dialogManagerToast('目标文件夹不存在', 2000);
      renderDialogManagerFolders();
      return;
    }
    // Prevent moving into self or descendant (would create cycle)
    if (id === targetId) return;
    let cur = targetId;
    while (cur) {
      if (cur === id) return;
      const parent = dm.folders.find(f => f.id === cur);
      cur = parent ? (parent.parentId || '') : '';
    }
    // Check max depth - need to know depth of this folder's subtree
    const targetDepth = targetId ? dialogExplorerFolderDepth(targetId) : 0;
    const maxChildDepth = dialogExplorerMaxChildDepth(id);
    if (targetDepth + maxChildDepth + 1 > DIALOG_EXPLORER_MAX_DEPTH) {
      dialogManagerToast(`移动后将超过 ${DIALOG_EXPLORER_MAX_DEPTH} 层嵌套限制`, 2000);
      return;
    }
    const oldParentId = folder.parentId || '';
    folder.parentId = targetId || '';
    folder._modifiedAt = Date.now();
    touchFolder(oldParentId);
    touchFolder(targetId);
    dialogManagerPersistSettings();
    renderDialogManagerFolders();
  }
}

// --- Navigation ---

function dialogExplorerEnterFolder(folderId) {
  if (folderId && folderId.startsWith('__group_')) {
    dialogManagerCurrentFolderId = folderId;
    renderDialogManagerFolders();
    return;
  }
  const dm = ensureDialogManagerSettings();
  if (folderId && !dm.folders.some(f => f.id === folderId)) return;
  dialogManagerCurrentFolderId = folderId || '';
  renderDialogManagerFolders();
}

function dialogExplorerGoUp() {
  if (!dialogManagerCurrentFolderId) return;
  if (dialogManagerCurrentFolderId.startsWith('__group_')) {
    dialogManagerCurrentFolderId = '';
    renderDialogManagerFolders();
    return;
  }
  const dm = ensureDialogManagerSettings();
  const folder = dm.folders.find(f => f.id === dialogManagerCurrentFolderId);
  dialogManagerCurrentFolderId = folder ? (folder.parentId || '') : '';
  renderDialogManagerFolders();
}

// --- Context Menu ---

let _dialogExplorerContextTarget = null;

function dialogExplorerContextMenu(e, type, id) {
  e.preventDefault();
  e.stopPropagation();
  _dialogExplorerContextTarget = { type, id };
  const menu = document.getElementById('dialogExplorerContextMenu');
  if (!menu) return false;

  // Show/hide actions based on type
  const isChat = type === 'chat';
  const isTaskGroup = type === 'taskGroup';
  const inGroupView = dialogManagerCurrentFolderId.startsWith('__group_');
  const renameBtn = menu.querySelector('[data-explorer-action="rename"]');
  const deleteBtn = menu.querySelector('[data-explorer-action="delete"]');
  const hideBtn = menu.querySelector('[data-explorer-action="hideChat"]');
  if (renameBtn) renameBtn.hidden = (type === 'area' || inGroupView);
  if (deleteBtn) deleteBtn.hidden = (type === 'area' || inGroupView);
  if (hideBtn) {
    const canToggleHidden = type === 'chat' || type === 'folder';
    hideBtn.hidden = !canToggleHidden;
    if (canToggleHidden) {
      const isHidden = dialogExplorerTargetHidden(type, id);
      hideBtn.innerHTML = '<span class="dialog-explorer-context-icon">' + (isHidden ? ICON_SHOW_CHAT : ICON_HIDE_CHAT) + '</span>' + (isHidden ? '取消隐藏' : '隐藏对话');
      hideBtn.title = isHidden ? '取消隐藏对话，让它重新显示在主侧栏' : '隐藏对话，不在主侧栏显示';
    }
  }

  // Export buttons only for standalone chat (not for taskGroup)
  ['exportMd','exportTxt','exportJson','exportDoc','exportPdf'].forEach(action => {
    const btn = menu.querySelector(`[data-explorer-action="${action}"]`);
    if (btn) btn.hidden = !(isChat && !isTaskGroup);
  });

  // Add "new folder" for area
  let newFolderBtn = menu.querySelector('[data-explorer-action="newFolder"]');
  if (type === 'area') {
    if (!newFolderBtn) {
      newFolderBtn = document.createElement('button');
      newFolderBtn.type = 'button';
      newFolderBtn.dataset.explorerAction = 'newFolder';
      newFolderBtn.innerHTML = '<span class="dialog-explorer-context-icon">' + ICON_FOLDER + '</span>新建文件夹';
      menu.insertBefore(newFolderBtn, menu.firstChild);
    }
    newFolderBtn.hidden = false;
  } else if (newFolderBtn) {
    newFolderBtn.hidden = true;
  }

  // Adjust danger styling
  if (deleteBtn) {
    deleteBtn.classList.toggle('danger', type === 'chat' || type === 'folder');
  }

  menu.hidden = false;
  const menuWidth = menu.offsetWidth || 130;
  const menuHeight = menu.offsetHeight || 80;
  let left = e.clientX;
  let top = e.clientY;
  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
  if (top + menuHeight > window.innerHeight - 8) top = window.innerHeight - menuHeight - 8;
  menu.style.left = Math.max(4, left) + 'px';
  menu.style.top = Math.max(4, top) + 'px';

  // Close on outside click or scroll
  setTimeout(() => {
    document.addEventListener('click', dialogExplorerHideContext, { once: true });
    document.addEventListener('contextmenu', dialogExplorerHideContext, { once: true });
    document.addEventListener('scroll', dialogExplorerHideContext, { once: true, capture: true });
  }, 0);

  return false;
}

function dialogExplorerHideContext() {
  const menu = document.getElementById('dialogExplorerContextMenu');
  if (menu) menu.hidden = true;
  _dialogExplorerContextTarget = null;
}

function dialogExplorerHandleContextAction(e) {
  const btn = e.target.closest('[data-explorer-action]');
  if (!btn) return;
  e.stopPropagation();
  const action = btn.dataset.explorerAction;
  const target = _dialogExplorerContextTarget;
  dialogExplorerHideContext();

  if (action === 'newFolder') {
    dialogExplorerNewFolder();
  } else if (action.startsWith('export')) {
    if (target && target.type === 'chat') {
      const formatMap = { exportMd: 'md', exportTxt: 'txt', exportJson: 'json', exportDoc: 'doc', exportPdf: 'pdf' };
      dialogExplorerExportChat(target.id, formatMap[action] || 'md');
    }
  } else if (!target) {
    return;
  } else if (target.type === 'taskGroup') {
    const realGroupId = target.id.startsWith('__group_') ? target.id.slice(8) : target.id;
    if (action === 'rename') dialogExplorerRenameTaskGroup(realGroupId);
    else if (action === 'delete') dialogExplorerDeleteTaskGroup(realGroupId);
  } else if (target.type === 'folder') {
    if (action === 'rename') dialogExplorerRenameFolder(target.id);
    else if (action === 'hideChat') {
      if (dialogExplorerTargetHidden('folder', target.id)) dialogExplorerUnhideFolderChats(target.id);
      else dialogExplorerHideFolderChats(target.id);
    }
    else if (action === 'delete') dialogExplorerDeleteFolder(target.id);
  } else if (target.type === 'chat') {
    if (action === 'rename') dialogExplorerRenameChat(target.id);
    else if (action === 'hideChat') {
      if (dialogExplorerTargetHidden('chat', target.id)) dialogExplorerUnhideChat(target.id);
      else dialogExplorerHideChat(target.id);
    }
    else if (action === 'delete') dialogExplorerDeleteChat(target.id);
  }
}

function dialogExplorerNewFolder() {
  if (dialogManagerCurrentFolderId.startsWith('__group_')) {
    dialogManagerToast('任务组视图不能新建文件夹', 2000);
    return;
  }
  const dm = ensureDialogManagerSettings();
  const newDepth = (dialogManagerCurrentFolderId ? dialogExplorerFolderDepth(dialogManagerCurrentFolderId) : 0) + 1;
  if (newDepth > DIALOG_EXPLORER_MAX_DEPTH) {
    dialogManagerToast(`文件夹嵌套最多 ${DIALOG_EXPLORER_MAX_DEPTH} 层`, 2000);
    return;
  }
  const id = 'folder_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const now = Date.now();
  dm.folders.push({
    id,
    name: '新建文件夹',
    parentId: dialogManagerCurrentFolderId || '',
    createdAt: now,
    _modifiedAt: now
  });
  touchFolder(dialogManagerCurrentFolderId);
  dialogManagerPersistSettings();
  renderDialogManagerFolders();
  // Immediately trigger rename
  setTimeout(() => dialogExplorerRenameFolder(id), 50);
}

// --- Folder CRUD ---

function dialogExplorerRenameFolder(folderId) {
  const dm = ensureDialogManagerSettings();
  const folder = dm.folders.find(f => f.id === folderId);
  if (!folder) return;
  const raw = prompt('重命名文件夹（最多' + DIALOG_EXPLORER_MAX_NAME_LEN + '字）', folder.name);
  if (raw === null) return;
  const name = raw.trim();
  if (!name) { dialogManagerToast('名称不能为空'); return; }
  if (name.length > DIALOG_EXPLORER_MAX_NAME_LEN) {
    dialogManagerToast(`文件夹名称最多 ${DIALOG_EXPLORER_MAX_NAME_LEN} 个字`, 2000);
    return;
  }
  folder.name = name;
  folder._modifiedAt = Date.now();
  dialogManagerPersistSettings();
  renderDialogManagerFolders();
}

function dialogExplorerDeleteFolder(folderId) {
  const dm = ensureDialogManagerSettings();
  const folder = dm.folders.find(f => f.id === folderId);
  if (!folder) return;

  // Collect all descendant folder IDs
  const descendantIds = new Set();
  function collectDescendants(pid) {
    dm.folders.forEach(f => {
      if (f.parentId === pid && !descendantIds.has(f.id)) {
        descendantIds.add(f.id);
        collectDescendants(f.id);
      }
    });
  }
  collectDescendants(folderId);
  descendantIds.add(folderId);
  const allIds = Array.from(descendantIds);
  const childFolderCount = Math.max(0, allIds.length - 1);

  // Count chats to be deleted
  const affectedChats = (dialogManagerState.chats || []).filter(c => allIds.includes(c.dialogFolderId || ''));
  const totalChats = affectedChats.length;

  if (!confirm(`删除文件夹"${folder.name}"？\n将级联删除 ${childFolderCount} 个子文件夹和 ${totalChats} 个对话，不可恢复。`)) return;

  // Abort generating chats before deletion
  affectedChats.forEach(c => {
    if (dialogManagerIsChatGenerating(c.id) && typeof _abortCurrentTaskIfAny === 'function') {
      _abortCurrentTaskIfAny(c.id);
    }
  });

  // Delete chats in all affected folders (manual, no per-chat confirm)
  const deleteIds = new Set(affectedChats.map(c => c.id));
  if (typeof remoteControlForgetChat === 'function') {
    for (const chat of affectedChats) remoteControlForgetChat(chat);
  }
  dialogManagerState.chats = (dialogManagerState.chats || []).filter(c => !deleteIds.has(c.id));
  if (deleteIds.has(dialogManagerState.currentId)) {
    dialogManagerState.currentId = ((dialogManagerState.chats || []).find(c => c && !c._hiddenFromUI) || {}).id || null;
  }
  dialogManagerCleanupTaskQueueDeletedChats(affectedChats);
  dialogManagerSyncGlobalTaskState(dialogManagerState.currentId);

  // Delete all descendant folders
  const parentId = folder.parentId || '';
  dm.folders = dm.folders.filter(f => !allIds.includes(f.id));

  touchFolder(parentId);
  dialogManagerPersistSettings();
  dialogManagerSaveData();
  dialogManagerRenderChatList();
  dialogManagerRenderMessages();
  dialogManagerUpdateSendBtn();
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
  renderDialogManagerFolders();
}

// --- Chat CRUD (syncs with sidebar) ---

function dialogExplorerRenameChat(chatId) {
  const chat = dialogManagerChatById(chatId);
  if (!chat) return;
  const raw = prompt('重命名对话', chat.title || '新对话');
  if (raw === null) return;
  const title = raw.trim();
  if (!title) { dialogManagerToast('名称不能为空'); return; }
  chat.title = title.slice(0, 80);
  touchFolder(chat.dialogFolderId || '');
  dialogManagerSaveData();
  dialogManagerRenderChatList();
  renderDialogManagerFolders();
  dialogManagerToast('已重命名');
}

function dialogExplorerExportChat(chatId, format) {
  const chat = dialogManagerChatById(chatId);
  if (!chat) return;
  dialogManagerSelectedChatId = chatId;
  exportDialogManagedChat(format);
}

function dialogExplorerRenameTaskGroup(groupId) {
  if (typeof renameTaskQueueGroup === 'function') {
    renameTaskQueueGroup(groupId);
  }
  renderDialogManagerFolders();
}

function dialogExplorerDeleteTaskGroup(groupId) {
  if (typeof deleteTaskQueueGroup === 'function') {
    deleteTaskQueueGroup(groupId);
  }
  if (dialogManagerCurrentFolderId === '__group_' + groupId) {
    dialogManagerCurrentFolderId = '';
  }
  renderDialogManagerFolders();
}

function dialogExplorerFolderAndDescendantIds(folderId) {
  const dm = ensureDialogManagerSettings();
  const ids = new Set();
  if (!folderId) return ids;
  function collect(pid) {
    dm.folders.forEach(folder => {
      if ((folder.parentId || '') === pid && !ids.has(folder.id)) {
        ids.add(folder.id);
        collect(folder.id);
      }
    });
  }
  ids.add(folderId);
  collect(folderId);
  return ids;
}

function dialogExplorerChatsInFolderTree(folderId) {
  const folderIds = dialogExplorerFolderAndDescendantIds(folderId);
  return (dialogManagerState.chats || []).filter(chat => chat && folderIds.has(chat.dialogFolderId || ''));
}

function dialogExplorerTargetHidden(type, id) {
  if (type === 'chat') {
    const chat = dialogManagerChatById(id);
    return !!(chat && chat._hiddenFromUI);
  }
  if (type === 'folder') {
    const chats = dialogExplorerChatsInFolderTree(id);
    return !!(chats.length && chats.every(chat => chat && chat._hiddenFromUI));
  }
  return false;
}

function dialogExplorerRefreshAfterVisibilityChange(folderId) {
  if (folderId) touchFolder(folderId);
  dialogManagerSaveData();
  dialogManagerRenderChatList();
  dialogManagerRenderMessages();
  dialogManagerUpdateSendBtn();
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
  dialogManagerSyncGlobalTaskState(dialogManagerState.currentId);
  renderDialogManagerFolders();
}

function dialogExplorerAfterHideChats(hiddenIds, folderId) {
  if (!hiddenIds || !hiddenIds.size) return;
  if (dialogManagerState.currentId && hiddenIds.has(dialogManagerState.currentId)) {
    dialogManagerState.currentId = (typeof sidebarChats === 'function' ? sidebarChats() : (dialogManagerState.chats || []).filter(c => c && !c._hiddenFromUI))[0]?.id || null;
  }
  dialogExplorerRefreshAfterVisibilityChange(folderId);
}

function dialogExplorerHideChat(chatId) {
  const chat = dialogManagerChatById(chatId);
  if (!chat) return;
  if (chat._hiddenFromUI) {
    dialogManagerToast('该对话已隐藏');
    return;
  }
  chat._hiddenFromUI = true;
  dialogExplorerAfterHideChats(new Set([chatId]), chat.dialogFolderId || '');
  dialogManagerToast('已隐藏对话');
}

function dialogExplorerHideFolderChats(folderId) {
  const dm = ensureDialogManagerSettings();
  const folder = dm.folders.find(f => f.id === folderId);
  if (!folder) return;
  const affectedChats = dialogExplorerChatsInFolderTree(folderId);
  const visibleChats = affectedChats.filter(chat => !chat._hiddenFromUI);
  if (!visibleChats.length) {
    dialogManagerToast('该文件夹中没有可隐藏的对话');
    return;
  }
  visibleChats.forEach(chat => { chat._hiddenFromUI = true; });
  dialogExplorerAfterHideChats(new Set(visibleChats.map(chat => chat.id)), folderId);
  dialogManagerToast(`已隐藏 ${visibleChats.length} 个对话`);
}

function dialogExplorerUnhideChat(chatId) {
  const chat = dialogManagerChatById(chatId);
  if (!chat) return;
  if (!chat._hiddenFromUI) {
    dialogManagerToast('该对话未隐藏');
    return;
  }
  delete chat._hiddenFromUI;
  dialogExplorerRefreshAfterVisibilityChange(chat.dialogFolderId || '');
  dialogManagerToast('已取消隐藏对话');
}

function dialogExplorerUnhideFolderChats(folderId) {
  const dm = ensureDialogManagerSettings();
  const folder = dm.folders.find(f => f.id === folderId);
  if (!folder) return;
  const affectedChats = dialogExplorerChatsInFolderTree(folderId);
  const hiddenChats = affectedChats.filter(chat => chat._hiddenFromUI);
  if (!hiddenChats.length) {
    dialogManagerToast('该文件夹中没有隐藏的对话');
    return;
  }
  hiddenChats.forEach(chat => { delete chat._hiddenFromUI; });
  dialogExplorerRefreshAfterVisibilityChange(folderId);
  dialogManagerToast(`已取消隐藏 ${hiddenChats.length} 个对话`);
}

function dialogExplorerDeleteChat(chatId) {
  const chat = dialogManagerChatById(chatId);
  if (!chat) return;
  const folderId = chat.dialogFolderId || '';
  if (typeof deleteChat === 'function') {
    deleteChat(chatId);
  } else {
    if (!confirm(`删除对话"${chat.title || '新对话'}"？`)) return;
    dialogManagerState.chats = (dialogManagerState.chats || []).filter(c => c.id !== chatId);
    if (dialogManagerState.currentId === chatId) dialogManagerState.currentId = ((dialogManagerState.chats || [])[0] && dialogManagerState.chats[0].id) || '';
    dialogManagerSaveData();
    dialogManagerRenderChatList();
    dialogManagerToast('已删除');
  }
  touchFolder(folderId);
  renderDialogManagerFolders();
}

function switchDialogManagerChat(chatId) {
  if (!dialogManagerChatById(chatId)) return;
  dialogManagerSelectedChatId = chatId;
  switchChat(chatId);
  closeDialogManagerSurface();
}

function renderDialogManagerExport() {
  const select = document.getElementById('dialogExportChatSelect');
  if (!select) return;
  const chats = dialogManagerState.chats || [];
  if (!chats.length) {
    select.innerHTML = '<option value="">暂无对话</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  if (!dialogManagerSelectedChatId || !dialogManagerChatById(dialogManagerSelectedChatId)) {
    dialogManagerSelectedChatId = dialogManagerState.currentId || chats[0].id;
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
  return dialogManagerChatById(id);
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
  dialogManagerToast(`对话 ${format.toUpperCase()} 已导出`);
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
      dialogManagerToast(`请选择"另存为 PDF"：${filename}`, 3500);
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
        <button class="btn btn-primary" type="button" data-action="valueClick" data-handler="applyPromptToChat" data-value="${escapeHtml(prompt.id)}">应用</button>
        <button class="btn" type="button" data-action="valueClick" data-handler="editPrompt" data-value="${escapeHtml(prompt.id)}">编辑</button>
        <button class="btn" type="button" data-action="valueClick" data-handler="deletePrompt" data-value="${escapeHtml(prompt.id)}">删除</button>
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
    dialogManagerToast('提示词标题和内容都不能为空');
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
  dialogManagerPersistSettings();
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
  if (!confirm(`删除提示词"${prompt.title}"？`)) return;
  dm.prompts = dm.prompts.filter(item => item.id !== promptId);
  dialogManagerPersistSettings();
  renderPromptLibrary();
}

function applyPromptToChat(promptId) {
  const dm = ensureDialogManagerSettings();
  const prompt = dm.prompts.find(item => item.id === promptId);
  if (!prompt) return;
  if (!dialogManagerCurrentChat()) newChat();
  if (typeof closeSettingsPage === 'function') closeSettingsPage();
  else closeDialogManager();
  const input = document.getElementById('input');
  if (!input) return;
  input.value = prompt.content || '';
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 100) + 'px';
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

  // Context menu click handler
  const ctxMenu = document.getElementById('dialogExplorerContextMenu');
  if (ctxMenu && !ctxMenu._explorerBound) {
    ctxMenu._explorerBound = true;
    ctxMenu.addEventListener('click', dialogExplorerHandleContextAction);
  }
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
window.renameTimelineNode = renameTimelineNode;
window.switchDialogManagerChat = switchDialogManagerChat;
window.setDialogExportChat = setDialogExportChat;
window.exportDialogManagedChat = exportDialogManagedChat;
window.savePromptFromUi = savePromptFromUi;
window.clearPromptEditor = clearPromptEditor;
window.editPrompt = editPrompt;
window.deletePrompt = deletePrompt;
window.applyPromptToChat = applyPromptToChat;
window.initDialogManager = initDialogManager;

// Explorer functions
window.dialogExplorerEnterFolder = dialogExplorerEnterFolder;
window.dialogExplorerGoUp = dialogExplorerGoUp;
window.dialogExplorerContextMenu = dialogExplorerContextMenu;
window.dialogExplorerDragStart = dialogExplorerDragStart;
window.dialogExplorerDragEnd = dialogExplorerDragEnd;
window.dialogExplorerItemDragOver = dialogExplorerItemDragOver;
window.dialogExplorerItemDragLeave = dialogExplorerItemDragLeave;
window.dialogExplorerItemDrop = dialogExplorerItemDrop;
window.dialogExplorerBreadcrumbDragOver = dialogExplorerBreadcrumbDragOver;
window.dialogExplorerBreadcrumbDragLeave = dialogExplorerBreadcrumbDragLeave;
window.dialogExplorerHandleContextAction = dialogExplorerHandleContextAction;
window.dialogExplorerToggleView = dialogExplorerToggleView;
window.dialogExplorerToggleSort = dialogExplorerToggleSort;

window.AgentApp.define('dialogManager', {
  DIALOG_MANAGER_ROOT_ID,
  ensureDialogManagerSettings,
  dialogManagerChatTitle,
  dialogManagerVisibleMessages,
  dialogManagerPlainText,
  openDialogManager,
  closeDialogManager,
  renderDialogManager,
  saveDialogManagerSettings,
  updateDialogTimeline,
  jumpToDialogMessage,
  renameTimelineNode,
  switchDialogManagerChat,
  setDialogExportChat,
  selectedDialogExportChat,
  exportDialogManagedChat,
  savePromptFromUi,
  clearPromptEditor,
  editPrompt,
  deletePrompt,
  applyPromptToChat,
  initDialogManager,
  dialogExplorerEnterFolder,
  dialogExplorerGoUp,
  dialogExplorerContextMenu,
  dialogExplorerDragStart,
  dialogExplorerDragEnd,
  dialogExplorerItemDragOver,
  dialogExplorerItemDragLeave,
  dialogExplorerItemDrop,
  dialogExplorerBreadcrumbDragOver,
  dialogExplorerBreadcrumbDragLeave,
  dialogExplorerHandleContextAction,
  dialogExplorerToggleView,
  dialogExplorerToggleSort
});
