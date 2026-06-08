// ============ 任务队列 ============
// 逐条新建主界面对话并复用 onSend() 执行，避免绕开现有模式/工具/渲染逻辑。

const TASK_QUEUE_KEY = 'aichat_task_queue_v1';

function _taskQueueDefaults() {
  return {
    items: [],
    defaultMode: 'normal',
    defaultUseTools: false,
    running: false,
    stopAfterCurrent: false,
    waiting: false,
    loaded: false
  };
}

function ensureTaskQueue() {
  if (!state.taskQueue || typeof state.taskQueue !== 'object') {
    state.taskQueue = _taskQueueDefaults();
  }
  const q = state.taskQueue;
  if (!Array.isArray(q.items)) q.items = [];
  if (!['normal', 'outline', 'reflection'].includes(q.defaultMode)) q.defaultMode = 'normal';
  q.defaultUseTools = !!q.defaultUseTools;
  q.running = !!q.running;
  q.stopAfterCurrent = !!q.stopAfterCurrent;
  q.waiting = !!q.waiting;
  return q;
}

function _taskQueueNormalizeItem(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const mode = ['normal', 'outline', 'reflection'].includes(item.mode) ? item.mode : 'normal';
  let status = ['pending', 'running', 'done', 'error', 'canceled'].includes(item.status) ? item.status : 'pending';
  if (status === 'running') status = 'pending';
  return {
    id: item.id || _taskQueueNewId(),
    text: String(item.text || '').trim(),
    mode,
    useTools: !!item.useTools,
    status,
    chatId: item.chatId || null,
    error: item.error || '',
    createdAt: item.createdAt || Date.now(),
    startedAt: item.startedAt || null,
    finishedAt: item.finishedAt || null
  };
}

function loadTaskQueue() {
  const q = ensureTaskQueue();
  try {
    const raw = storage.get(TASK_QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      q.items = Array.isArray(parsed.items) ? parsed.items.map(_taskQueueNormalizeItem).filter(it => it.text) : [];
      q.defaultMode = ['normal', 'outline', 'reflection'].includes(parsed.defaultMode) ? parsed.defaultMode : 'normal';
      q.defaultUseTools = !!parsed.defaultUseTools;
    }
  } catch (e) {
    console.warn('[task-queue] 加载失败:', e);
  }
  q.running = false;
  q.stopAfterCurrent = false;
  q.waiting = false;
  q.loaded = true;
  renderTaskQueueBadge();
}

function saveTaskQueue() {
  const q = ensureTaskQueue();
  try {
    storage.set(TASK_QUEUE_KEY, JSON.stringify({
      items: q.items.map(it => ({
        id: it.id,
        text: it.text,
        mode: it.mode,
        useTools: !!it.useTools,
        status: it.status,
        chatId: it.chatId || null,
        error: it.error || '',
        createdAt: it.createdAt || Date.now(),
        startedAt: it.startedAt || null,
        finishedAt: it.finishedAt || null
      })),
      defaultMode: q.defaultMode,
      defaultUseTools: !!q.defaultUseTools
    }));
  } catch (e) {
    console.warn('[task-queue] 保存失败:', e);
  }
  renderTaskQueueBadge();
}

function _taskQueueNewId() {
  return 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function openTaskQueue() {
  const q = ensureTaskQueue();
  if (!q.loaded) loadTaskQueue();
  const wrap = document.querySelector('.more-menu-wrap');
  if (wrap) wrap.classList.remove('open');
  _taskQueueEnsureModal();
  _taskQueueFillControls();
  renderTaskQueueModal();
  document.getElementById('taskQueueModal').classList.add('show');
}

function closeTaskQueue() {
  const modal = document.getElementById('taskQueueModal');
  if (modal) modal.classList.remove('show');
}

function _taskQueueEnsureModal() {
  if (document.getElementById('taskQueueModal')) return;
  const modal = document.createElement('div');
  modal.id = 'taskQueueModal';
  modal.className = 'modal-mask task-queue-modal';
  modal.innerHTML = `
    <div class="modal wide">
      <h2>🧾 任务队列 <button class="modal-close" onclick="closeTaskQueue()">×</button></h2>
      <div class="task-queue-compose">
        <div class="form-group" style="margin-bottom:0;">
          <label>输入任务</label>
          <textarea id="taskQueueInput" placeholder="每行一个任务。需要多行任务时，把拆分方式改成「空行分隔任务」。"></textarea>
        </div>
        <div class="task-queue-controls">
          <label class="task-queue-check">拆分
            <select id="taskQueueSplitMode">
              <option value="line">每行一个任务</option>
              <option value="blank">空行分隔任务</option>
            </select>
          </label>
          <label class="task-queue-check">执行方式
            <select id="taskQueueDefaultMode" onchange="taskQueueSaveDefaults()">
              <option value="normal">普通对话</option>
              <option value="outline">大纲模式</option>
              <option value="reflection">师生讨论</option>
            </select>
          </label>
          <label class="task-queue-check">
            <input type="checkbox" id="taskQueueDefaultTools" onchange="taskQueueSaveDefaults()"> 启用工具
          </label>
          <label class="task-queue-check">
            <input type="checkbox" id="taskQueueAutoStart" checked> 添加后自动开始
          </label>
          <button class="btn btn-primary" onclick="taskQueueAddTasks()">加入队列</button>
        </div>
      </div>
      <div class="task-queue-toolbar">
        <div class="task-queue-stats" id="taskQueueStats">暂无任务</div>
        <button class="btn btn-primary" id="taskQueueStartBtn" onclick="startTaskQueue()">开始/继续</button>
        <button class="btn" id="taskQueuePauseBtn" onclick="pauseTaskQueue()">跑完当前后暂停</button>
        <button class="btn btn-warning" id="taskQueueStopBtn" onclick="stopCurrentTaskAndPauseQueue()">停止当前并暂停</button>
        <button class="btn" onclick="taskQueueClearSettled()">清除已结束</button>
        <button class="btn" onclick="taskQueueClearAll()">清空队列</button>
      </div>
      <div class="task-queue-list" id="taskQueueList"></div>
      <div class="form-hint" style="margin-top:12px;">
        队列会逐条新建主界面对话并发送任务。计划模式需要人工审批，所以不会出现在队列执行方式中。
      </div>
    </div>
  `;
  modal.addEventListener('click', e => {
    if (e.target === modal) closeTaskQueue();
  });
  document.body.appendChild(modal);
}

function _taskQueueFillControls() {
  const q = ensureTaskQueue();
  const modeEl = document.getElementById('taskQueueDefaultMode');
  const toolsEl = document.getElementById('taskQueueDefaultTools');
  if (modeEl) modeEl.value = q.defaultMode;
  if (toolsEl) toolsEl.checked = !!q.defaultUseTools;
}

function taskQueueSaveDefaults() {
  const q = ensureTaskQueue();
  const modeEl = document.getElementById('taskQueueDefaultMode');
  const toolsEl = document.getElementById('taskQueueDefaultTools');
  if (modeEl && ['normal', 'outline', 'reflection'].includes(modeEl.value)) q.defaultMode = modeEl.value;
  if (toolsEl) q.defaultUseTools = !!toolsEl.checked;
  saveTaskQueue();
}

function renderTaskQueueBadge() {
  const badge = document.getElementById('taskQueueMenuBadge');
  if (!badge || !state.taskQueue) return;
  const q = ensureTaskQueue();
  const pending = q.items.filter(it => it.status === 'pending').length;
  const running = q.running || q.items.some(it => it.status === 'running');
  if (running) {
    badge.textContent = '跑';
    badge.style.display = 'inline-block';
  } else if (pending) {
    badge.textContent = String(pending);
    badge.style.display = 'inline-block';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}

function renderTaskQueueModal() {
  const q = ensureTaskQueue();
  renderTaskQueueBadge();
  const statsEl = document.getElementById('taskQueueStats');
  const listEl = document.getElementById('taskQueueList');
  if (!statsEl || !listEl) return;
  
  const counts = q.items.reduce((acc, it) => {
    acc[it.status] = (acc[it.status] || 0) + 1;
    return acc;
  }, {});
  const pending = counts.pending || 0;
  const running = counts.running || 0;
  const done = counts.done || 0;
  const error = counts.error || 0;
  const canceled = counts.canceled || 0;
  const waitingText = q.waiting ? ' · 等待当前生成结束' : '';
  statsEl.textContent = `共 ${q.items.length} 条 · 待运行 ${pending} · 运行中 ${running} · 完成 ${done} · 失败 ${error} · 停止 ${canceled}${waitingText}`;
  
  const startBtn = document.getElementById('taskQueueStartBtn');
  const pauseBtn = document.getElementById('taskQueuePauseBtn');
  const stopBtn = document.getElementById('taskQueueStopBtn');
  if (startBtn) startBtn.disabled = q.running || pending === 0;
  if (pauseBtn) pauseBtn.disabled = !q.running || q.stopAfterCurrent;
  if (stopBtn) stopBtn.disabled = !q.running;
  
  if (!q.items.length) {
    listEl.innerHTML = '<div class="task-queue-empty">还没有任务。输入任务后可自动开始，也可以先加入队列再逐条调整模式。</div>';
    return;
  }
  
  listEl.innerHTML = q.items.map((item, idx) => _taskQueueRenderItem(item, idx)).join('');
}

function _taskQueueRenderItem(item, idx) {
  const locked = item.status === 'running';
  const editable = item.status === 'pending';
  const chatBtn = item.chatId
    ? `<button class="btn" onclick="taskQueueOpenChat('${item.id}')">打开对话</button>`
    : '';
  const retryBtn = (item.status === 'error' || item.status === 'canceled')
    ? `<button class="btn" onclick="taskQueueRetryItem('${item.id}')">重跑</button>`
    : '';
  const removeBtn = locked
    ? ''
    : `<button class="btn" onclick="taskQueueRemoveItem('${item.id}')">删除</button>`;
  return `
    <div class="task-queue-item ${escapeHtml(item.status)}">
      <div class="task-queue-item-head">
        <span class="task-queue-status ${escapeHtml(item.status)}">${_taskQueueStatusText(item.status)}</span>
        <span class="task-queue-title">#${idx + 1} ${escapeHtml(_taskQueueItemTitle(item))}</span>
        <span class="task-queue-meta">${_taskQueueModeText(item)}${item.chatId ? ' · 已建对话' : ''}</span>
      </div>
      <textarea ${editable ? '' : 'disabled'} oninput="taskQueueUpdateItemText('${item.id}', this.value)">${escapeHtml(item.text)}</textarea>
      <div class="task-queue-item-options">
        <label class="task-queue-check">执行方式
          <select ${editable ? '' : 'disabled'} onchange="taskQueueUpdateItemMode('${item.id}', this.value)">
            <option value="normal" ${item.mode === 'normal' ? 'selected' : ''}>普通对话</option>
            <option value="outline" ${item.mode === 'outline' ? 'selected' : ''}>大纲模式</option>
            <option value="reflection" ${item.mode === 'reflection' ? 'selected' : ''}>师生讨论</option>
          </select>
        </label>
        <label class="task-queue-check">
          <input type="checkbox" ${item.useTools ? 'checked' : ''} ${editable ? '' : 'disabled'} onchange="taskQueueUpdateItemTools('${item.id}', this.checked)"> 启用工具
        </label>
        ${chatBtn}${retryBtn}${removeBtn}
      </div>
      ${item.error ? `<div class="task-queue-error">${escapeHtml(item.error)}</div>` : ''}
    </div>
  `;
}

function _taskQueueStatusText(status) {
  return {
    pending: '待运行',
    running: '运行中',
    done: '已完成',
    error: '失败',
    canceled: '已停止'
  }[status] || '待运行';
}

function _taskQueueModeText(item) {
  const mode = {
    normal: '普通',
    outline: '大纲',
    reflection: '师生'
  }[item.mode] || '普通';
  return item.useTools ? `${mode} + 工具` : mode;
}

function _taskQueueItemTitle(item) {
  const text = (item.text || '').replace(/\s+/g, ' ').trim();
  return text.length > 48 ? text.slice(0, 48) + '...' : text || '空任务';
}

function taskQueueAddTasks() {
  const q = ensureTaskQueue();
  taskQueueSaveDefaults();
  const input = document.getElementById('taskQueueInput');
  const splitEl = document.getElementById('taskQueueSplitMode');
  const autoStartEl = document.getElementById('taskQueueAutoStart');
  const raw = input ? input.value : '';
  const splitMode = splitEl ? splitEl.value : 'line';
  const tasks = _taskQueueParseInput(raw, splitMode);
  if (!tasks.length) {
    if (typeof toast === 'function') toast('请输入至少一个任务');
    return;
  }
  
  for (const text of tasks) {
    q.items.push({
      id: _taskQueueNewId(),
      text,
      mode: q.defaultMode,
      useTools: !!q.defaultUseTools,
      status: 'pending',
      chatId: null,
      error: '',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null
    });
  }
  if (input) input.value = '';
  saveTaskQueue();
  renderTaskQueueModal();
  if (typeof toast === 'function') toast(`已加入 ${tasks.length} 个任务`);
  if (autoStartEl && autoStartEl.checked && !q.running) {
    setTimeout(() => startTaskQueue(), 0);
  }
}

function _taskQueueParseInput(raw, splitMode) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const parts = splitMode === 'blank'
    ? text.split(/\n\s*\n/g)
    : text.split(/\r?\n/g);
  return parts.map(s => s.trim()).filter(Boolean);
}

function taskQueueUpdateItemText(id, value) {
  const item = _taskQueueFindItem(id);
  if (!item || item.status !== 'pending') return;
  item.text = String(value || '').trim();
  saveTaskQueue();
  renderTaskQueueBadge();
}

function taskQueueUpdateItemMode(id, value) {
  const item = _taskQueueFindItem(id);
  if (!item || item.status !== 'pending') return;
  if (['normal', 'outline', 'reflection'].includes(value)) item.mode = value;
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueUpdateItemTools(id, checked) {
  const item = _taskQueueFindItem(id);
  if (!item || item.status !== 'pending') return;
  item.useTools = !!checked;
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueRemoveItem(id) {
  const q = ensureTaskQueue();
  const item = _taskQueueFindItem(id);
  if (!item || item.status === 'running') return;
  q.items = q.items.filter(it => it.id !== id);
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueRetryItem(id) {
  const item = _taskQueueFindItem(id);
  if (!item || item.status === 'running') return;
  item.status = 'pending';
  item.error = '';
  item.startedAt = null;
  item.finishedAt = null;
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueOpenChat(id) {
  const item = _taskQueueFindItem(id);
  if (!item || !item.chatId) return;
  if (typeof switchChat === 'function') switchChat(item.chatId);
  closeTaskQueue();
}

function taskQueueClearSettled() {
  const q = ensureTaskQueue();
  q.items = q.items.filter(it => it.status === 'pending' || it.status === 'running');
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueClearAll() {
  const q = ensureTaskQueue();
  if (q.running) {
    if (typeof toast === 'function') toast('队列运行中，请先暂停或停止当前任务');
    return;
  }
  if (q.items.length && !confirm('清空整个任务队列？')) return;
  q.items = [];
  saveTaskQueue();
  renderTaskQueueModal();
}

async function startTaskQueue() {
  const q = ensureTaskQueue();
  if (q.running) return;
  if (!q.items.some(it => it.status === 'pending')) {
    if (typeof toast === 'function') toast('没有待运行任务');
    renderTaskQueueModal();
    return;
  }
  if (!state.settings.apiKey) {
    if (typeof toast === 'function') toast('请先配置 API Key');
    if (typeof openSettings === 'function') openSettings();
    return;
  }
  
  q.running = true;
  q.stopAfterCurrent = false;
  q.waiting = false;
  q._modeSnapshot = _taskQueueSnapshotModeSettings();
  saveTaskQueue();
  renderTaskQueueModal();
  
  try {
    while (q.running && !q.stopAfterCurrent) {
      await _taskQueueWaitUntilIdle(q);
      if (!q.running || q.stopAfterCurrent) break;
      const item = q.items.find(it => it.status === 'pending');
      if (!item) break;
      await _taskQueueRunItem(item);
      saveTaskQueue();
      renderTaskQueueModal();
    }
  } finally {
    const stoppedByRequest = q.stopAfterCurrent;
    q.running = false;
    q.stopAfterCurrent = false;
    q.waiting = false;
    _taskQueueRestoreModeSettings(q._modeSnapshot);
    q._modeSnapshot = null;
    saveTaskQueue();
    renderTaskQueueModal();
    if (typeof toast === 'function') {
      const hasPending = q.items.some(it => it.status === 'pending');
      toast(hasPending ? (stoppedByRequest ? '任务队列已暂停' : '任务队列已停止') : '任务队列已完成');
    }
  }
}

function pauseTaskQueue() {
  const q = ensureTaskQueue();
  if (!q.running) return;
  q.stopAfterCurrent = true;
  saveTaskQueue();
  renderTaskQueueModal();
  if (typeof toast === 'function') toast('当前任务结束后暂停队列');
}

function stopCurrentTaskAndPauseQueue() {
  const q = ensureTaskQueue();
  if (!q.running) return;
  q.stopAfterCurrent = true;
  const runningItem = q.items.find(it => it.status === 'running' && it.chatId);
  if (runningItem && typeof requestStopChatTask === 'function') {
    requestStopChatTask(runningItem.chatId);
  } else if (typeof stopGenerate === 'function' && ((typeof isCurrentChatGenerating === 'function') ? isCurrentChatGenerating() : state.isGenerating)) {
    stopGenerate();
  }
  saveTaskQueue();
  renderTaskQueueModal();
  if (typeof toast === 'function') toast('已请求停止当前任务，队列随后暂停');
}

async function _taskQueueWaitUntilIdle(q) {
  const anyGenerating = () => (typeof isAnyChatGenerating === 'function')
    ? isAnyChatGenerating()
    : !!(state.isGenerating || state.abortCtrl);
  if (!anyGenerating()) {
    q.waiting = false;
    return;
  }
  q.waiting = true;
  saveTaskQueue();
  renderTaskQueueModal();
  while (q.running && !q.stopAfterCurrent && anyGenerating()) {
    await new Promise(r => setTimeout(r, 800));
  }
  q.waiting = false;
  saveTaskQueue();
  renderTaskQueueModal();
}

async function _taskQueueRunItem(item) {
  item.text = String(item.text || '').trim();
  if (!item.text) {
    item.status = 'error';
    item.error = '任务内容为空';
    item.finishedAt = Date.now();
    return;
  }
  
  item.status = 'running';
  item.error = '';
  item.startedAt = Date.now();
  item.finishedAt = null;
  saveTaskQueue();
  renderTaskQueueModal();
  
  try {
    _taskQueueApplyItemMode(item);
    if (typeof newChat !== 'function' || typeof onSend !== 'function') {
      throw new Error('聊天发送函数尚未加载');
    }
    
    newChat();
    const c = typeof currentChat === 'function' ? currentChat() : null;
    if (!c) throw new Error('无法创建新对话');
    item.chatId = c.id;
    saveTaskQueue();
    renderTaskQueueModal();
    
    state.pendingAttachments = [];
    state.pendingAIAttachments = [];
    if (typeof clearPendingAIAttachments === 'function') clearPendingAIAttachments(c.id);
    if (typeof renderPendingAtts === 'function') renderPendingAtts();
    
    const input = document.getElementById('input');
    if (!input) throw new Error('找不到主输入框');
    input.value = item.text;
    input.style.height = 'auto';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    
    await onSend();
    
    const result = _taskQueueInspectResult(item.chatId);
    item.status = result.status;
    item.error = result.error || '';
    item.finishedAt = Date.now();
  } catch (e) {
    item.status = 'error';
    item.error = e && e.message ? e.message : String(e);
    item.finishedAt = Date.now();
  }
}

function _taskQueueInspectResult(chatId) {
  const c = typeof chatById === 'function' ? chatById(chatId) : null;
  if (!c || !Array.isArray(c.messages)) return { status: 'error', error: '找不到任务对话' };
  const assistant = c.messages.slice().reverse().find(m => m.role === 'assistant');
  const content = assistant ? String(assistant.content || '') : '';
  if (content.includes('[已停止]')) return { status: 'canceled', error: '' };
  if (content.trim().startsWith('❌')) {
    return { status: 'error', error: content.trim().split('\n')[0].slice(0, 220) };
  }
  return { status: 'done', error: '' };
}

function _taskQueueApplyItemMode(item) {
  const s = state.settings;
  s.usePlan = false;
  s.useOutline = item.mode === 'outline';
  s.useReflection = item.mode === 'reflection';
  s.useTools = !!item.useTools && !!(state.tools && state.tools.length);
  _taskQueueRefreshModeButtons();
}

function _taskQueueSnapshotModeSettings() {
  const s = state.settings || {};
  return {
    usePlan: !!s.usePlan,
    useOutline: !!s.useOutline,
    useReflection: !!s.useReflection,
    useTools: !!s.useTools
  };
}

function _taskQueueRestoreModeSettings(snapshot) {
  if (!snapshot || !state.settings) return;
  state.settings.usePlan = !!snapshot.usePlan;
  state.settings.useOutline = !!snapshot.useOutline;
  state.settings.useReflection = !!snapshot.useReflection;
  state.settings.useTools = !!snapshot.useTools;
  _taskQueueRefreshModeButtons();
  if (typeof persistSettings === 'function') persistSettings();
}

function _taskQueueRefreshModeButtons() {
  const s = state.settings || {};
  const planBtn = document.getElementById('planBtn');
  const outlineBtn = document.getElementById('outlineBtn');
  const reflectBtn = document.getElementById('reflectBtn');
  const toolsBtn = document.getElementById('toolsBtn');
  if (planBtn) planBtn.classList.toggle('plan-active', !!s.usePlan);
  if (outlineBtn) outlineBtn.classList.toggle('outline-active', !!s.useOutline);
  if (reflectBtn) reflectBtn.classList.toggle('reflect-active', !!s.useReflection);
  if (toolsBtn) toolsBtn.classList.toggle('tool-active', !!s.useTools);
  if (typeof updateSendBtn === 'function') updateSendBtn();
}

function _taskQueueFindItem(id) {
  const q = ensureTaskQueue();
  return q.items.find(it => it.id === id) || null;
}
