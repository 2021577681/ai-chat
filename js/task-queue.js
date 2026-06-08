// ============ 任务队列 ============
// 按手动序号分组执行：同一序号内并行，当前序号全部完成/跳过后才进入下一序号。
const TASK_QUEUE_KEY = 'aichat_task_queue_v1';

const TASK_QUEUE_DONE_STATUSES = new Set(['done', 'skipped']);
const TASK_QUEUE_BLOCKING_STATUSES = new Set(['pending', 'running', 'paused', 'stopped', 'error']);
const TASK_QUEUE_ITEM_STATUSES = ['pending', 'running', 'paused', 'stopped', 'skipped', 'done', 'error'];

function _taskQueueDefaults() {
  return {
    items: [],
    defaultMode: 'normal',
    defaultUseTools: false,
    running: false,
    paused: false,
    loaded: false,
    activeOrder: null,
    stopAllRequested: false
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
  q.paused = !!q.paused;
  q.loaded = !!q.loaded;
  q.stopAllRequested = !!q.stopAllRequested;
  q.activeOrder = _taskQueuePositiveInt(q.activeOrder, null);
  return q;
}

function _taskQueueNormalizeItem(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const mode = ['normal', 'outline', 'reflection'].includes(item.mode) ? item.mode : 'normal';
  let status = TASK_QUEUE_ITEM_STATUSES.includes(item.status) ? item.status : 'pending';
  if (status === 'running') status = 'pending';
  if (status === 'canceled') status = 'stopped';
  return {
    id: item.id || _taskQueueNewId(),
    text: String(item.text || '').trim(),
    order: _taskQueuePositiveInt(item.order, 1),
    mode,
    useTools: !!item.useTools,
    status,
    chatId: item.chatId || null,
    error: item.error || '',
    createdAt: item.createdAt || Date.now(),
    startedAt: item.startedAt || null,
    finishedAt: item.finishedAt || null,
    pausedAt: item.pausedAt || null,
    skippedAt: item.skippedAt || null
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
  q.paused = false;
  q.activeOrder = null;
  q.stopAllRequested = false;
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
        order: _taskQueuePositiveInt(it.order, 1),
        mode: it.mode,
        useTools: !!it.useTools,
        status: it.status,
        chatId: it.chatId || null,
        error: it.error || '',
        createdAt: it.createdAt || Date.now(),
        startedAt: it.startedAt || null,
        finishedAt: it.finishedAt || null,
        pausedAt: it.pausedAt || null,
        skippedAt: it.skippedAt || null
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
          <textarea id="taskQueueInput" placeholder="每行一个任务。新增任务默认序号为 1。"></textarea>
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
            <input type="checkbox" id="taskQueueAutoStart"> 添加后按顺序开始
          </label>
          <button class="btn btn-primary" onclick="taskQueueAddTasks()">加入队列</button>
        </div>
      </div>
      <div class="task-queue-toolbar">
        <div class="task-queue-stats" id="taskQueueStats">暂无任务</div>
        <button class="btn btn-primary" id="taskQueueStartBtn" onclick="startTaskQueue()">按顺序开始执行</button>
        <button class="btn" id="taskQueuePauseAllBtn" onclick="taskQueueTogglePauseAll()">暂停所有任务</button>
        <button class="btn btn-warning" id="taskQueueStopAllBtn" onclick="taskQueueStopAll()">停止所有任务</button>
        <button class="btn" onclick="taskQueueClearSettled()">清除已结束</button>
        <button class="btn" onclick="taskQueueClearAll()">清空队列</button>
      </div>
      <div class="task-queue-list" id="taskQueueList"></div>
      <div class="form-hint" style="margin-top:12px;">
        执行规则：先执行全部序号 1，序号 1 全部完成或跳过后才执行序号 2。若某序号存在暂停、停止、失败或待处理任务，后续序号不会执行。
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
  const pendingLike = q.items.filter(it => it.status === 'pending' || it.status === 'paused').length;
  const running = q.running || q.items.some(it => it.status === 'running');
  if (running) {
    badge.textContent = '跑';
    badge.style.display = 'inline-block';
  } else if (pendingLike) {
    badge.textContent = String(pendingLike);
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
  const activeText = q.activeOrder ? ` · 当前序号 ${q.activeOrder}` : '';
  const pausedText = q.paused ? ' · 已暂停' : '';
  statsEl.textContent = `共 ${q.items.length} 条 · 待运行 ${counts.pending || 0} · 运行中 ${counts.running || 0} · 暂停 ${counts.paused || 0} · 停止 ${counts.stopped || 0} · 跳过 ${counts.skipped || 0} · 完成 ${counts.done || 0} · 失败 ${counts.error || 0}${activeText}${pausedText}`;

  const startBtn = document.getElementById('taskQueueStartBtn');
  const pauseAllBtn = document.getElementById('taskQueuePauseAllBtn');
  const stopAllBtn = document.getElementById('taskQueueStopAllBtn');
  const hasRunnable = q.items.some(it => it.status === 'pending' || it.status === 'paused');
  const hasRunning = q.items.some(it => it.status === 'running');
  const hasPending = q.items.some(it => it.status === 'pending');
  const hasStoppable = q.items.some(it => it.status === 'pending' || it.status === 'running' || it.status === 'paused');
  if (startBtn) {
    startBtn.disabled = q.running || !hasRunnable;
    startBtn.textContent = '按顺序开始执行';
  }
  if (pauseAllBtn) {
    pauseAllBtn.disabled = !q.running && !q.paused && !hasRunning && !hasPending;
    pauseAllBtn.textContent = q.paused ? '继续所有任务' : '暂停所有任务';
  }
  if (stopAllBtn) stopAllBtn.disabled = !hasStoppable;

  if (!q.items.length) {
    listEl.innerHTML = '<div class="task-queue-empty">还没有任务。新增任务默认序号为 1，可在任务卡片中手动修改序号。</div>';
    return;
  }

  const ordered = q.items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => (a.item.order - b.item.order) || (a.item.createdAt - b.item.createdAt) || (a.idx - b.idx));
  listEl.innerHTML = ordered.map(({ item, idx }) => _taskQueueRenderItem(item, idx)).join('');
}

function _taskQueueRenderItem(item, idx) {
  const editable = ['pending', 'paused', 'stopped', 'error'].includes(item.status);
  const canPause = item.status === 'running' || item.status === 'pending';
  const canStop = item.status === 'running' || item.status === 'pending' || item.status === 'paused';
  const canSkip = !TASK_QUEUE_DONE_STATUSES.has(item.status);
  const chatBtn = item.chatId
    ? `<button class="btn" onclick="taskQueueOpenChat('${item.id}')">打开对话</button>`
    : '';
  const retryBtn = (item.status === 'error' || item.status === 'stopped')
    ? `<button class="btn" onclick="taskQueueRetryItem('${item.id}')">重跑</button>`
    : '';
  const removeBtn = item.status === 'running'
    ? ''
    : `<button class="btn" onclick="taskQueueRemoveItem('${item.id}')">删除</button>`;
  return `
    <div class="task-queue-item ${escapeHtml(item.status)}" data-task-id="${escapeHtml(item.id)}">
      <div class="task-queue-item-head">
        <span class="task-queue-status ${escapeHtml(item.status)}">${_taskQueueStatusText(item.status)}</span>
        <label class="task-queue-order">序号
          <input type="number" min="1" step="1" value="${_taskQueuePositiveInt(item.order, 1)}" ${item.status === 'running' ? 'disabled' : ''} onchange="taskQueueUpdateItemOrder('${item.id}', this.value)">
        </label>
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
        <button class="btn" ${canPause ? '' : 'disabled'} onclick="taskQueuePauseItem('${item.id}')">暂停</button>
        <button class="btn btn-warning" ${canStop ? '' : 'disabled'} onclick="taskQueueStopItem('${item.id}')">停止</button>
        <button class="btn" ${canSkip ? '' : 'disabled'} onclick="taskQueueSkipItem('${item.id}')">跳过</button>
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
    paused: '已暂停',
    stopped: '已停止',
    skipped: '已跳过',
    done: '已完成',
    error: '失败'
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
      order: 1,
      mode: q.defaultMode,
      useTools: !!q.defaultUseTools,
      status: 'pending',
      chatId: null,
      error: '',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      pausedAt: null,
      skippedAt: null
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
  if (!item || !['pending', 'paused', 'stopped', 'error'].includes(item.status)) return;
  item.text = String(value || '').trim();
  saveTaskQueue();
  renderTaskQueueBadge();
}

function taskQueueUpdateItemOrder(id, value) {
  const item = _taskQueueFindItem(id);
  if (!item || item.status === 'running') return;
  item.order = _taskQueuePositiveInt(value, 1);
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueUpdateItemMode(id, value) {
  const item = _taskQueueFindItem(id);
  if (!item || !['pending', 'paused', 'stopped', 'error'].includes(item.status)) return;
  if (['normal', 'outline', 'reflection'].includes(value)) item.mode = value;
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueUpdateItemTools(id, checked) {
  const item = _taskQueueFindItem(id);
  if (!item || !['pending', 'paused', 'stopped', 'error'].includes(item.status)) return;
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
  item.pausedAt = null;
  item.skippedAt = null;
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
  q.items = q.items.filter(it => !TASK_QUEUE_DONE_STATUSES.has(it.status) && it.status !== 'error' && it.status !== 'stopped');
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueClearAll() {
  const q = ensureTaskQueue();
  if (q.items.some(it => it.status === 'running')) {
    if (typeof toast === 'function') toast('存在运行中任务，请先停止所有任务');
    return;
  }
  if (q.items.length && !confirm('清空整个任务队列？')) return;
  q.items = [];
  q.running = false;
  q.paused = false;
  q.activeOrder = null;
  q.stopAllRequested = false;
  saveTaskQueue();
  renderTaskQueueModal();
}

async function startTaskQueue() {
  const q = ensureTaskQueue();
  if (q.running) return;
  const validation = _taskQueueValidateOrders(q);
  if (!validation.ok) {
    if (typeof toast === 'function') toast(validation.error, 5000);
    renderTaskQueueModal();
    return;
  }
  if (!q.items.some(it => it.status === 'pending' || it.status === 'paused')) {
    if (typeof toast === 'function') toast('没有可执行任务');
    renderTaskQueueModal();
    return;
  }
  if (!state.settings.apiKey) {
    if (typeof toast === 'function') toast('请先配置 API Key');
    if (typeof openSettings === 'function') openSettings();
    return;
  }

  q.running = true;
  q.paused = false;
  q.stopAllRequested = false;
  q.items.forEach(it => {
    if (it.status === 'paused') {
      it.status = 'pending';
      it.error = '';
    }
  });
  saveTaskQueue();
  renderTaskQueueModal();

  try {
    while (q.running && !q.stopAllRequested) {
      if (q.paused) {
        await _taskQueueSleep(500);
        continue;
      }
      const nextOrder = _taskQueueNextRunnableOrder(q);
      if (!nextOrder) break;
      q.activeOrder = nextOrder;
      const group = q.items.filter(it => it.order === nextOrder);
      const blockers = group.filter(it => TASK_QUEUE_BLOCKING_STATUSES.has(it.status) && it.status !== 'pending' && it.status !== 'running');
      if (blockers.length) break;
      const runnable = group.filter(it => it.status === 'pending');
      if (!runnable.length) {
        if (group.every(it => TASK_QUEUE_DONE_STATUSES.has(it.status))) continue;
        break;
      }
      saveTaskQueue();
      renderTaskQueueModal();
      await Promise.allSettled(runnable.map(item => _taskQueueRunItem(item)));
      saveTaskQueue();
      renderTaskQueueModal();
      if (group.some(it => !TASK_QUEUE_DONE_STATUSES.has(it.status))) break;
    }
  } finally {
    const keepPaused = q.paused && q.items.some(it => it.status === 'paused');
    q.running = false;
    q.paused = keepPaused;
    q.activeOrder = null;
    q.stopAllRequested = false;
    saveTaskQueue();
    renderTaskQueueModal();
    if (typeof toast === 'function') {
      const next = _taskQueueNextRunnableOrder(q);
      const blocked = _taskQueueFirstBlockedOrder(q);
      if (next) toast(blocked ? `任务队列停在序号 ${blocked}` : '任务队列已暂停');
      else toast('任务队列已完成可执行部分');
    }
  }
}

function taskQueueTogglePauseAll() {
  const q = ensureTaskQueue();
  if (q.paused) {
    q.paused = false;
    saveTaskQueue();
    renderTaskQueueModal();
    if (!q.running) setTimeout(() => startTaskQueue(), 0);
    if (typeof toast === 'function') toast('已继续所有任务');
    return;
  }
  q.paused = true;
  const running = q.items.filter(it => it.status === 'running');
  running.forEach(it => _taskQueueAbortItem(it, 'paused'));
  q.items.filter(it => it.status === 'pending').forEach(it => {
    it.status = 'paused';
    it.error = '已暂停';
    it.pausedAt = Date.now();
  });
  saveTaskQueue();
  renderTaskQueueModal();
  if (typeof toast === 'function') toast(running.length ? '已请求暂停所有任务' : '队列已暂停');
}

function taskQueueStopAll() {
  const q = ensureTaskQueue();
  if (!q.items.length) return;
  if (!confirm('停止所有未完成任务？')) return;
  q.stopAllRequested = true;
  q.running = false;
  q.paused = false;
  for (const item of q.items) {
    if (item.status === 'running') _taskQueueAbortItem(item, 'stopped');
    else if (item.status === 'pending' || item.status === 'paused') {
      item.status = 'stopped';
      item.error = '已停止';
      item.finishedAt = Date.now();
    }
  }
  saveTaskQueue();
  renderTaskQueueModal();
  if (typeof toast === 'function') toast('已停止所有未完成任务');
}

function taskQueuePauseItem(id) {
  const item = _taskQueueFindItem(id);
  if (!item || (item.status !== 'running' && item.status !== 'pending')) return;
  if (item.status === 'running') _taskQueueAbortItem(item, 'paused');
  else {
    item.status = 'paused';
    item.error = '已暂停';
    item.pausedAt = Date.now();
  }
  saveTaskQueue();
  renderTaskQueueModal();
  if (typeof toast === 'function') toast('已请求暂停该任务');
}

function taskQueueStopItem(id) {
  const item = _taskQueueFindItem(id);
  if (!item || TASK_QUEUE_DONE_STATUSES.has(item.status)) return;
  if (item.status === 'running') _taskQueueAbortItem(item, 'stopped');
  else {
    item.status = 'stopped';
    item.error = '已停止';
    item.finishedAt = Date.now();
  }
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueSkipItem(id) {
  const item = _taskQueueFindItem(id);
  if (!item || TASK_QUEUE_DONE_STATUSES.has(item.status)) return;
  if (item.status === 'running') _taskQueueAbortItem(item, 'skipped');
  else _taskQueueMarkSkipped(item);
  saveTaskQueue();
  renderTaskQueueModal();
  if (ensureTaskQueue().running === false) {
    const q = ensureTaskQueue();
    if (q.items.some(it => it.status === 'pending')) renderTaskQueueModal();
  }
}

async function _taskQueueRunItem(item) {
  item.text = String(item.text || '').trim();
  if (!item.text) {
    item.status = 'error';
    item.error = '任务内容为空';
    item.finishedAt = Date.now();
    return;
  }

  if (item.status !== 'pending') return;
  item.status = 'running';
  item.error = '';
  item.startedAt = Date.now();
  item.finishedAt = null;
  item.pausedAt = null;
  item.skippedAt = null;
  saveTaskQueue();
  renderTaskQueueModal();

  try {
    if (typeof callAPI !== 'function') throw new Error('API 函数尚未加载');
    const c = _taskQueueEnsureChatForItem(item);
    item.chatId = c.id;
    saveTaskQueue();
    renderTaskQueueModal();

    if (typeof clearPendingAIAttachments === 'function') clearPendingAIAttachments(c.id);
    if (item.mode === 'outline') {
      await callAPIWithOutline({ chatId: c.id, useTools: item.useTools });
    } else if (item.mode === 'reflection') {
      await callAPIWithReflection({ chatId: c.id, useTools: item.useTools });
    } else {
      await callAPI(undefined, { chatId: c.id, useTools: item.useTools });
    }

    if (item.status === 'running') {
      const result = _taskQueueInspectResult(item.chatId);
      _taskQueueApplyRequestedOrResult(item, result);
      item.finishedAt = Date.now();
    }
  } catch (e) {
    if (item._requestedStatus) {
      _taskQueueApplyRequestedOrResult(item, null);
      return;
    }
    if (item.status === 'paused' || item.status === 'stopped' || item.status === 'skipped') return;
    if (e && e.name === 'AbortError') {
      item.status = 'stopped';
      item.error = '已停止';
    } else {
      item.status = 'error';
      item.error = e && e.message ? e.message : String(e);
    }
    item.finishedAt = Date.now();
  } finally {
    if (item.status === 'running') {
      const result = _taskQueueInspectResult(item.chatId);
      _taskQueueApplyRequestedOrResult(item, result);
      item.finishedAt = Date.now();
    }
    saveTaskQueue();
    renderTaskQueueModal();
  }
}

function _taskQueueEnsureChatForItem(item) {
  let c = item.chatId && typeof chatById === 'function' ? chatById(item.chatId) : null;
  if (c) return c;
  c = {
    id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    title: _taskQueueItemTitle(item).slice(0, 30) || '队列任务',
    messages: [{ role: 'user', content: item.text }],
    createdAt: Date.now()
  };
  state.chats.unshift(c);
  item.chatId = c.id;
  saveData();
  if (typeof renderChatList === 'function') renderChatList();
  return c;
}

function _taskQueueInspectResult(chatId) {
  const c = typeof chatById === 'function' ? chatById(chatId) : null;
  if (!c || !Array.isArray(c.messages)) return { status: 'error', error: '找不到任务对话' };
  const assistant = c.messages.slice().reverse().find(m => m.role === 'assistant');
  const content = assistant ? String(assistant.content || '') : '';
  if (content.includes('[已停止]')) return { status: 'stopped', error: '已停止' };
  if (content.trim().startsWith('❌')) {
    return { status: 'error', error: content.trim().split('\n')[0].slice(0, 220) };
  }
  return { status: 'done', error: '' };
}

function _taskQueueAbortItem(item, nextStatus) {
  item._requestedStatus = nextStatus;
  if (item.chatId && typeof requestStopChatTask === 'function') requestStopChatTask(item.chatId);
  if (typeof window !== 'undefined' && typeof window.cancelAutoResend === 'function') {
    try { window.cancelAutoResend(item.chatId); } catch (e) {}
  }
  if (nextStatus === 'paused') {
    item.status = 'paused';
    item.error = '已暂停';
    item.pausedAt = Date.now();
  } else if (nextStatus === 'skipped') {
    _taskQueueMarkSkipped(item);
  } else {
    item.status = 'stopped';
    item.error = '已停止';
    item.finishedAt = Date.now();
  }
}

function _taskQueueApplyRequestedOrResult(item, result) {
  if (item._requestedStatus === 'paused') {
    item.status = 'paused';
    item.error = '已暂停';
    item.pausedAt = item.pausedAt || Date.now();
  } else if (item._requestedStatus === 'skipped') {
    _taskQueueMarkSkipped(item);
  } else if (item._requestedStatus === 'stopped') {
    item.status = 'stopped';
    item.error = '已停止';
    item.finishedAt = item.finishedAt || Date.now();
  } else if (result) {
    item.status = result.status;
    item.error = result.error || '';
  }
  delete item._requestedStatus;
}

function _taskQueueMarkSkipped(item) {
  item.status = 'skipped';
  item.error = '';
  item.skippedAt = Date.now();
  item.finishedAt = Date.now();
}

function _taskQueueValidateOrders(q) {
  for (const item of q.items) {
    const order = Number(item.order);
    if (!Number.isInteger(order) || order < 1) {
      return { ok: false, error: '任务序号必须是从 1 开始的正整数' };
    }
  }
  if (!q.items.length) return { ok: true };
  const orders = Array.from(new Set(q.items.map(it => _taskQueuePositiveInt(it.order, 1)))).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    const expected = i + 1;
    if (orders[i] !== expected) {
      return { ok: false, error: `任务序号不连续：缺少序号 ${expected}` };
    }
  }
  return { ok: true };
}

function _taskQueueNextRunnableOrder(q) {
  const orders = Array.from(new Set(q.items.map(it => _taskQueuePositiveInt(it.order, 1)))).sort((a, b) => a - b);
  for (const order of orders) {
    const group = q.items.filter(it => it.order === order);
    if (group.every(it => TASK_QUEUE_DONE_STATUSES.has(it.status))) continue;
    if (group.some(it => it.status === 'pending')) return order;
    return null;
  }
  return null;
}

function _taskQueueFirstBlockedOrder(q) {
  const orders = Array.from(new Set(q.items.map(it => _taskQueuePositiveInt(it.order, 1)))).sort((a, b) => a - b);
  for (const order of orders) {
    const group = q.items.filter(it => it.order === order);
    if (group.every(it => TASK_QUEUE_DONE_STATUSES.has(it.status))) continue;
    if (group.some(it => TASK_QUEUE_BLOCKING_STATUSES.has(it.status))) return order;
  }
  return null;
}

function _taskQueuePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function _taskQueueSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _taskQueueFindItem(id) {
  const q = ensureTaskQueue();
  return q.items.find(it => it.id === id) || null;
}

// 兼容旧按钮名；新 UI 不再使用。
function pauseTaskQueue() {
  taskQueueTogglePauseAll();
}

function stopCurrentTaskAndPauseQueue() {
  taskQueueStopAll();
}
