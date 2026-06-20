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
    stopAllRequested: false,
    sidebarGroupId: null,
    sidebarGroupStartedAt: null,
    sidebarGroupFinalizedAt: null
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
  q.sidebarGroupId = q.sidebarGroupId || null;
  q.sidebarGroupStartedAt = q.sidebarGroupStartedAt || null;
  q.sidebarGroupFinalizedAt = q.sidebarGroupFinalizedAt || null;
  return q;
}

function _taskQueueNormalizeItem(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const mode = ['normal', 'outline', 'reflection'].includes(item.mode) ? item.mode : 'normal';
  let status = TASK_QUEUE_ITEM_STATUSES.includes(item.status) ? item.status : 'pending';
  if (status === 'running') status = 'pending';
  if (status === 'canceled') status = 'stopped';
  const dependsText = typeof item.dependsOnTasksText === 'string'
    ? item.dependsOnTasksText
    : (typeof item.dependsOnOrdersText === 'string'
      ? item.dependsOnOrdersText
      : _taskQueueFormatIndexList(item.dependsOnTaskIndexes || item.dependsOnOrders || item.dependsOn || []));
  return {
    id: item.id || _taskQueueNewId(),
    text: String(item.text || '').trim(),
    order: _taskQueuePositiveInt(item.order, 1),
    mode,
    useTools: !!item.useTools,
    exposeOutput: !!item.exposeOutput,
    dependsOnTaskIds: Array.isArray(item.dependsOnTaskIds) ? item.dependsOnTaskIds.filter(Boolean) : [],
    dependsOnTaskIndexes: [],
    dependsOnTasksText: dependsText,
    outputPackage: _taskQueueNormalizeOutputPackage(item.outputPackage),
    outputUpdatedAt: item.outputUpdatedAt || null,
    outputWarning: item.outputWarning || '',
    promptHash: item.promptHash || '',
    sidebarGroupId: item.sidebarGroupId || '',
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
      q.sidebarGroupId = parsed.sidebarGroupId || null;
      q.sidebarGroupStartedAt = parsed.sidebarGroupStartedAt || null;
      q.sidebarGroupFinalizedAt = parsed.sidebarGroupFinalizedAt || null;
      _taskQueueNormalizeDependencyRefs(q);
    }
  } catch (e) {
    console.warn('[task-queue] 加载失败:', e);
  }
  q.running = false;
  q.paused = false;
  q.activeOrder = null;
  q.stopAllRequested = false;
  q.loaded = true;
  _taskQueueRecoverFinishedSidebarGroup(q);
  saveTaskQueue();
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
        exposeOutput: !!it.exposeOutput,
        dependsOnTaskIds: Array.isArray(it.dependsOnTaskIds) ? it.dependsOnTaskIds.filter(Boolean) : [],
        dependsOnTaskIndexes: Array.isArray(it.dependsOnTaskIndexes) ? it.dependsOnTaskIndexes : [],
        dependsOnTasksText: typeof it.dependsOnTasksText === 'string'
          ? it.dependsOnTasksText
          : _taskQueueFormatIndexList(it.dependsOnTaskIndexes || []),
        outputPackage: _taskQueueNormalizeOutputPackage(it.outputPackage),
        outputUpdatedAt: it.outputUpdatedAt || null,
        outputWarning: it.outputWarning || '',
        promptHash: it.promptHash || '',
        sidebarGroupId: it.sidebarGroupId || '',
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
      defaultUseTools: !!q.defaultUseTools,
      sidebarGroupId: q.sidebarGroupId || null,
      sidebarGroupStartedAt: q.sidebarGroupStartedAt || null,
      sidebarGroupFinalizedAt: q.sidebarGroupFinalizedAt || null
    }));
  } catch (e) {
    console.warn('[task-queue] 保存失败:', e);
  }
  renderTaskQueueBadge();
}

function _taskQueueNewId() {
  return 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function _taskQueueCreateItem(options = {}) {
  const mode = ['normal', 'outline', 'reflection'].includes(options.mode) ? options.mode : 'normal';
  return {
    id: options.id || _taskQueueNewId(),
    text: String(options.text || '').trim(),
    order: _taskQueuePositiveInt(options.order, 1),
    mode,
    useTools: !!options.useTools,
    exposeOutput: !!options.exposeOutput,
    dependsOnTaskIds: Array.isArray(options.dependsOnTaskIds) ? options.dependsOnTaskIds.filter(Boolean) : [],
    dependsOnTaskIndexes: Array.isArray(options.dependsOnTaskIndexes) ? options.dependsOnTaskIndexes : [],
    dependsOnTasksText: typeof options.dependsOnTasksText === 'string' ? options.dependsOnTasksText : '',
    outputPackage: null,
    outputUpdatedAt: null,
    outputWarning: '',
    promptHash: '',
    sidebarGroupId: options.sidebarGroupId || '',
    status: 'pending',
    chatId: null,
    error: '',
    createdAt: options.createdAt || Date.now(),
    startedAt: null,
    finishedAt: null,
    pausedAt: null,
    skippedAt: null
  };
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
          <textarea id="taskQueueInput" placeholder="手动加入：每行一个任务。AI 自动调度：输入一个总任务。"></textarea>
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
          <button class="btn" id="taskQueueScheduleBtn" onclick="taskQueueAutoSchedule()">AI 自动调度</button>
        </div>
        <div class="task-queue-scheduler-status" id="taskQueueSchedulerStatus"></div>
      </div>
      <div class="task-queue-toolbar">
        <div class="task-queue-stats" id="taskQueueStats">暂无任务</div>
        <div class="task-queue-toolbar-actions">
          <button class="btn btn-primary" id="taskQueueStartBtn" onclick="startTaskQueue()">按顺序开始执行</button>
          <button class="btn" id="taskQueuePauseAllBtn" onclick="taskQueueTogglePauseAll()">暂停所有任务</button>
          <button class="btn btn-warning" id="taskQueueStopAllBtn" onclick="taskQueueStopAll()">停止所有任务</button>
          <button class="btn" onclick="openTaskQueueTree()">生成树形图</button>
          <button class="btn" onclick="taskQueueClearSettled()">清除已结束</button>
          <button class="btn" onclick="taskQueueClearAll()">清空队列</button>
        </div>
      </div>
      <div class="task-queue-list" id="taskQueueList"></div>
      <div class="form-hint" style="margin-top:12px;">
        执行规则：先执行全部序号 1，序号 1 全部完成或跳过后才执行序号 2。勾选“供后续引用”的任务会保存结构化输出包；后续任务可在“依赖任务”中填写 #1、#2 这类任务卡片编号读取输出。
      </div>
    </div>
  `;
  modal.addEventListener('click', e => {
    if (e.target === modal) closeTaskQueue();
  });
  document.body.appendChild(modal);
}

function _taskQueueEnsureTreeModal() {
  if (document.getElementById('taskQueueTreeModal')) return;
  const modal = document.createElement('div');
  modal.id = 'taskQueueTreeModal';
  modal.className = 'modal-mask task-queue-tree-modal';
  modal.innerHTML = `
    <div class="modal wide">
      <h2>任务树形图 <button class="modal-close" onclick="closeTaskQueueTree()">×</button></h2>
      <div class="task-queue-tree-toolbar">
        <div class="task-queue-tree-hint">从左到右按序号展开；同一列内为并行任务。</div>
        <button class="btn" onclick="renderTaskQueueTree()">刷新</button>
      </div>
      <div class="task-queue-tree-wrap" id="taskQueueTreeWrap"></div>
    </div>
  `;
  modal.addEventListener('click', e => {
    if (e.target === modal) closeTaskQueueTree();
  });
  document.body.appendChild(modal);
  const wrap = modal.querySelector('#taskQueueTreeWrap');
  if (wrap) wrap.addEventListener('scroll', () => _taskQueueDrawTreeEdges(wrap), { passive: true });
  if (typeof window !== 'undefined' && !window._taskQueueTreeResizeBound) {
    window._taskQueueTreeResizeBound = true;
    window.addEventListener('resize', () => {
      const currentWrap = document.getElementById('taskQueueTreeWrap');
      const treeModal = document.getElementById('taskQueueTreeModal');
      if (currentWrap && treeModal && treeModal.classList.contains('show')) _taskQueueDrawTreeEdges(currentWrap);
    });
  }
}

function openTaskQueueTree() {
  const q = ensureTaskQueue();
  if (!q.loaded) loadTaskQueue();
  _taskQueueEnsureTreeModal();
  renderTaskQueueTree();
  document.getElementById('taskQueueTreeModal').classList.add('show');
}

function closeTaskQueueTree() {
  const modal = document.getElementById('taskQueueTreeModal');
  if (modal) modal.classList.remove('show');
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
  _taskQueueNormalizeDependencyRefs(q);
  renderTaskQueueBadge();
  const statsEl = document.getElementById('taskQueueStats');
  const listEl = document.getElementById('taskQueueList');
  if (!statsEl || !listEl) return;

  const counts = q.items.reduce((acc, it) => {
    acc[it.status] = (acc[it.status] || 0) + 1;
    return acc;
  }, {});
  const outputCount = q.items.filter(it => it.outputPackage).length;
  const activeText = q.activeOrder ? ` · 当前序号 ${q.activeOrder}` : '';
  const pausedText = q.paused ? ' · 已暂停' : '';
  statsEl.textContent = `共 ${q.items.length} 条 · 待运行 ${counts.pending || 0} · 运行中 ${counts.running || 0} · 暂停 ${counts.paused || 0} · 停止 ${counts.stopped || 0} · 跳过 ${counts.skipped || 0} · 完成 ${counts.done || 0} · 失败 ${counts.error || 0} · 输出包 ${outputCount}${activeText}${pausedText}`;

  const startBtn = document.getElementById('taskQueueStartBtn');
  const pauseAllBtn = document.getElementById('taskQueuePauseAllBtn');
  const stopAllBtn = document.getElementById('taskQueueStopAllBtn');
  const hasRunnable = q.items.some(it => it.status === 'pending' || it.status === 'paused');
  const hasRunning = q.items.some(it => it.status === 'running');
  const hasPending = q.items.some(it => it.status === 'pending');
  const hasStoppable = q.items.some(it => it.status === 'pending' || it.status === 'running' || it.status === 'paused' || it.outputBuilding);
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
  const itemBusy = _taskQueueItemBusy(item);
  const editable = ['pending', 'paused', 'stopped', 'error'].includes(item.status) && !itemBusy;
  const configEditable = !itemBusy;
  const canPause = item.status === 'running' || item.status === 'pending';
  const canStop = item.status === 'running' || item.status === 'pending' || item.status === 'paused' || item.outputBuilding;
  const canSkip = !TASK_QUEUE_DONE_STATUSES.has(item.status);
  const exposeChecked = item.exposeOutput ? 'checked' : '';
  const dependsValue = _taskQueueDisplayDependencyIndexes(item);
  const outputBadge = item.outputPackage
    ? `<span class="task-queue-output-badge" title="已保存结构化输出包">输出包</span>`
    : (item.outputBuilding ? `<span class="task-queue-output-badge building" title="正在生成结构化输出包">生成输出包...</span>` : '');
  const chatBtn = item.chatId
    ? `<button class="btn" onclick="taskQueueOpenChat('${item.id}')">打开对话</button>`
    : '';
  const retryBtn = (item.status === 'error' || item.status === 'stopped')
    ? `<button class="btn" onclick="taskQueueRetryItem('${item.id}')">重跑</button>`
    : '';
  const removeBtn = itemBusy
    ? ''
    : `<button class="btn" onclick="taskQueueRemoveItem('${item.id}')">删除</button>`;
  return `
    <div class="task-queue-item ${escapeHtml(item.status)}" data-task-id="${escapeHtml(item.id)}">
      <div class="task-queue-item-head">
        <span class="task-queue-status ${escapeHtml(item.status)}">${_taskQueueStatusText(item.status)}</span>
        <label class="task-queue-order">序号
          <input type="number" min="1" step="1" value="${_taskQueuePositiveInt(item.order, 1)}" ${itemBusy ? 'disabled' : ''} onchange="taskQueueUpdateItemOrder('${item.id}', this.value)">
        </label>
        <label class="task-queue-check task-queue-expose" title="完成后保存结构化输出包，供后续任务按 #编号 引用">
          <input type="checkbox" ${exposeChecked} ${configEditable ? '' : 'disabled'} onchange="taskQueueUpdateItemExpose('${item.id}', this.checked)"> 供后续引用
        </label>
        <span class="task-queue-title">#${idx + 1} ${escapeHtml(_taskQueueItemTitle(item))}</span>
        <span class="task-queue-meta">${_taskQueueModeText(item)}${item.chatId ? ' · 已建对话' : ''}${dependsValue ? ` · 依赖 #${escapeHtml(dependsValue.replace(/,/g, ',#'))}` : ''}</span>
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
        <label class="task-queue-depends">依赖任务
          <input type="text" value="${escapeHtml(dependsValue)}" placeholder="如 1,2" ${configEditable ? '' : 'disabled'} onchange="taskQueueUpdateItemDepends('${item.id}', this.value)">
        </label>
        ${outputBadge}
        <button class="btn" ${canPause ? '' : 'disabled'} onclick="taskQueuePauseItem('${item.id}')">暂停</button>
        <button class="btn btn-warning" ${canStop ? '' : 'disabled'} onclick="taskQueueStopItem('${item.id}')">停止</button>
        <button class="btn" ${canSkip ? '' : 'disabled'} onclick="taskQueueSkipItem('${item.id}')">跳过</button>
        ${chatBtn}${retryBtn}${removeBtn}
      </div>
      ${item.error ? `<div class="task-queue-error">${escapeHtml(item.error)}</div>` : ''}
      ${item.outputWarning ? `<div class="task-queue-output-warning">${escapeHtml(item.outputWarning)}</div>` : ''}
    </div>
  `;
}

function renderTaskQueueTree() {
  const q = ensureTaskQueue();
  const wrap = document.getElementById('taskQueueTreeWrap');
  if (!wrap) return;
  const validation = _taskQueueValidateOrders(q);
  if (!validation.ok) {
    wrap.innerHTML = `<div class="task-queue-tree-empty">${escapeHtml(validation.error)}</div>`;
    return;
  }
  if (!q.items.length) {
    wrap.innerHTML = '<div class="task-queue-tree-empty">还没有任务。</div>';
    return;
  }
  wrap.innerHTML = _taskQueueBuildTreeHtml(q);
  requestAnimationFrame(() => _taskQueueDrawTreeEdges(wrap));
}

function _taskQueueBuildTreeHtml(q) {
  const items = q.items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => (_taskQueuePositiveInt(a.item.order, 1) - _taskQueuePositiveInt(b.item.order, 1))
      || ((a.item.createdAt || 0) - (b.item.createdAt || 0))
      || (a.idx - b.idx));
  const orders = Array.from(new Set(items.map(({ item }) => _taskQueuePositiveInt(item.order, 1)))).sort((a, b) => a - b);
  const columns = orders.map(order => {
    const nodes = items.filter(({ item }) => _taskQueuePositiveInt(item.order, 1) === order);
    return `
      <div class="task-queue-tree-col" data-order="${order}">
        <div class="task-queue-tree-col-title">序号 ${order}</div>
        <div class="task-queue-tree-nodes">
          ${nodes.map(({ item, idx }) => _taskQueueRenderTreeNode(item, idx)).join('')}
        </div>
      </div>
    `;
  }).join('');
  return `
    <div class="task-queue-tree-canvas" id="taskQueueTreeCanvas">
      <svg class="task-queue-tree-edges" id="taskQueueTreeEdges" aria-hidden="true"></svg>
      <div class="task-queue-tree-cols">${columns}</div>
    </div>
  `;
}

function _taskQueueRenderTreeNode(item, idx) {
  const depText = _taskQueueDisplayDependencyIndexes(item);
  const expose = item.exposeOutput ? '<span class="task-queue-tree-chip output">输出</span>' : '';
  const blocked = ['paused', 'stopped', 'error'].includes(item.status) ? '<span class="task-queue-tree-chip blocked">阻塞</span>' : '';
  return `
    <div class="task-queue-tree-node ${escapeHtml(item.status)}" data-task-id="${escapeHtml(item.id)}" data-order="${_taskQueuePositiveInt(item.order, 1)}">
      <div class="task-queue-tree-node-head">
        <span class="task-queue-tree-status">${_taskQueueStatusText(item.status)}</span>
        <span class="task-queue-tree-order">序号 ${_taskQueuePositiveInt(item.order, 1)}</span>
      </div>
      <div class="task-queue-tree-text">${escapeHtml(_taskQueueTreeNodeText(item, idx))}</div>
      <div class="task-queue-tree-foot">
        ${expose}${blocked}${depText ? `<span class="task-queue-tree-chip">依赖 #${escapeHtml(depText.replace(/,/g, ',#'))}</span>` : ''}
      </div>
    </div>
  `;
}

function _taskQueueTreeNodeText(item, idx) {
  const text = String(item.text || '').replace(/\s+/g, ' ').trim();
  const prefix = `#${idx + 1} `;
  const max = 120;
  return prefix + (text.length > max ? text.slice(0, max) + '...' : text || '空任务');
}

function _taskQueueDrawTreeEdges(wrap) {
  const canvas = wrap.querySelector('#taskQueueTreeCanvas');
  const svg = wrap.querySelector('#taskQueueTreeEdges');
  if (!canvas || !svg) return;
  const q = ensureTaskQueue();
  const canvasRect = canvas.getBoundingClientRect();
  const width = Math.max(canvas.scrollWidth, canvasRect.width);
  const height = Math.max(canvas.scrollHeight, canvasRect.height);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = '';
  const edges = _taskQueueTreeEdges(q);
  const frag = document.createDocumentFragment();
  for (const edge of edges) {
    const from = canvas.querySelector(`[data-task-id="${_taskQueueCssEscape(edge.from)}"]`);
    const to = canvas.querySelector(`[data-task-id="${_taskQueueCssEscape(edge.to)}"]`);
    if (!from || !to) continue;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const x1 = a.right - canvasRect.left + canvas.scrollLeft;
    const y1 = a.top - canvasRect.top + canvas.scrollTop + a.height / 2;
    const x2 = b.left - canvasRect.left + canvas.scrollLeft;
    const y2 = b.top - canvasRect.top + canvas.scrollTop + b.height / 2;
    const dx = Math.max(48, (x2 - x1) / 2);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    path.setAttribute('class', edge.type === 'dependency' ? 'dependency' : 'sequence');
    frag.appendChild(path);
  }
  svg.appendChild(frag);
}

function _taskQueueTreeEdges(q) {
  const items = (q.items || []).filter(Boolean);
  _taskQueueNormalizeDependencyRefs(q);
  const byOrder = new Map();
  for (const item of items) {
    const order = _taskQueuePositiveInt(item.order, 1);
    if (!byOrder.has(order)) byOrder.set(order, []);
    byOrder.get(order).push(item);
  }
  const orders = Array.from(byOrder.keys()).sort((a, b) => a - b);
  const edges = [];
  const seen = new Set();
  const addEdge = (from, to, type) => {
    if (!from || !to || from.id === to.id) return;
    const key = `${from.id}->${to.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from: from.id, to: to.id, type });
  };
  for (const item of items) {
    const deps = item.dependsOnTaskIds || [];
    if (deps.length) {
      for (const depId of deps) {
        const source = items.find(it => it.id === depId);
        if (source) addEdge(source, item, 'dependency');
      }
    }
  }
  for (let i = 1; i < orders.length; i++) {
    const prev = byOrder.get(orders[i - 1]) || [];
    const curr = byOrder.get(orders[i]) || [];
    for (const target of curr) {
      if (target.dependsOnTaskIds && target.dependsOnTaskIds.length) continue;
      for (const source of prev) addEdge(source, target, 'sequence');
    }
  }
  return edges;
}

function _taskQueueCssEscape(value) {
  const s = String(value || '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/["\\]/g, '\\$&');
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

function _taskQueueNewSidebarGroupId() {
  return 'tq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function _taskQueuePrepareSidebarGroup(q = ensureTaskQueue()) {
  if (!q.sidebarGroupId || q.sidebarGroupFinalizedAt) {
    q.sidebarGroupId = _taskQueueNewSidebarGroupId();
    q.sidebarGroupStartedAt = Date.now();
    q.sidebarGroupFinalizedAt = null;
  }
  return q.sidebarGroupId;
}

function _taskQueueApplyChatSidebarMeta(chat, item, q = ensureTaskQueue()) {
  if (!chat || !item) return;
  const groupId = _taskQueuePrepareSidebarGroup(q);
  const indexMap = _taskQueueTaskIndexMap(q);
  const taskIndex = indexMap.get(item.id) || 0;
  const prev = chat.taskQueue && chat.taskQueue.groupId === groupId ? chat.taskQueue : {};
  chat.taskQueue = {
    ...prev,
    type: 'task_queue_item',
    groupId,
    groupStartedAt: q.sidebarGroupStartedAt || Date.now(),
    groupFinalized: !!prev.groupFinalized,
    groupExpanded: !!prev.groupExpanded,
    taskId: item.id,
    taskIndex,
    order: _taskQueuePositiveInt(item.order, 1),
    status: item.status || 'pending',
    updatedAt: Date.now()
  };
  item.sidebarGroupId = groupId;
}

function _taskQueueAllItemsFinished(q = ensureTaskQueue()) {
  return !!(q.items && q.items.length && q.items.every(it => TASK_QUEUE_DONE_STATUSES.has(it.status)));
}

function _taskQueueFinalizeSidebarGroupIfFinished(q = ensureTaskQueue()) {
  if (!_taskQueueAllItemsFinished(q) || !q.sidebarGroupId || q.sidebarGroupFinalizedAt) return false;
  const groupId = q.sidebarGroupId;
  const finishedAt = Date.now();
  const indexMap = _taskQueueTaskIndexMap(q);
  let changed = false;
  for (const item of q.items || []) {
    if (!item || item.sidebarGroupId !== groupId || !item.chatId) continue;
    const chat = typeof chatById === 'function' ? chatById(item.chatId) : null;
    if (!chat) continue;
    chat.taskQueue = {
      ...(chat.taskQueue || {}),
      type: 'task_queue_item',
      groupId,
      groupStartedAt: q.sidebarGroupStartedAt || finishedAt,
      groupFinalized: true,
      groupExpanded: false,
      groupFinalizedAt: finishedAt,
      taskId: item.id,
      taskIndex: indexMap.get(item.id) || 0,
      order: _taskQueuePositiveInt(item.order, 1),
      status: item.status,
      updatedAt: finishedAt
    };
    changed = true;
  }
  if (!changed) return false;
  q.sidebarGroupFinalizedAt = finishedAt;
  if (typeof saveData === 'function') saveData();
  if (typeof renderChatList === 'function') renderChatList();
  return true;
}

function _taskQueueSyncFinalizedSidebarMeta(q = ensureTaskQueue()) {
  const indexMap = _taskQueueTaskIndexMap(q);
  let changed = false;
  for (const item of q.items || []) {
    if (!item || !item.chatId || !item.sidebarGroupId) continue;
    const chat = typeof chatById === 'function' ? chatById(item.chatId) : null;
    const prev = chat && chat.taskQueue;
    if (!prev || prev.type !== 'task_queue_item' || prev.groupId !== item.sidebarGroupId || !prev.groupFinalized) continue;
    const nextIndex = indexMap.get(item.id) || 0;
    const nextOrder = _taskQueuePositiveInt(item.order, 1);
    if (prev.taskIndex === nextIndex && prev.order === nextOrder && prev.status === item.status) continue;
    chat.taskQueue = {
      ...prev,
      taskIndex: nextIndex,
      order: nextOrder,
      status: item.status,
      updatedAt: Date.now()
    };
    changed = true;
  }
  if (changed && typeof saveData === 'function') saveData();
  if (changed && typeof renderChatList === 'function') renderChatList();
  return changed;
}

function _taskQueueRecoverFinishedSidebarGroup(q = ensureTaskQueue()) {
  if (!_taskQueueAllItemsFinished(q)) return false;
  const itemsWithChats = (q.items || []).filter(item => item && item.chatId);
  if (!itemsWithChats.length) return false;
  const finalizedChatsReady = q.sidebarGroupFinalizedAt && itemsWithChats.every(item => {
    if (!item.sidebarGroupId) return false;
    const chat = typeof chatById === 'function' ? chatById(item.chatId) : null;
    return !!(chat
      && chat.taskQueue
      && chat.taskQueue.type === 'task_queue_item'
      && chat.taskQueue.groupId === item.sidebarGroupId
      && chat.taskQueue.groupFinalized);
  });
  if (finalizedChatsReady) return false;
  const existingGroupId = itemsWithChats.find(item => item.sidebarGroupId)?.sidebarGroupId || q.sidebarGroupId;
  q.sidebarGroupId = existingGroupId || _taskQueueNewSidebarGroupId();
  q.sidebarGroupStartedAt = q.sidebarGroupStartedAt || Math.min(...itemsWithChats.map(item => item.startedAt || item.createdAt || Date.now()));
  const hadFinalizedAt = q.sidebarGroupFinalizedAt;
  q.sidebarGroupFinalizedAt = null;
  for (const item of itemsWithChats) item.sidebarGroupId = q.sidebarGroupId;
  const changed = _taskQueueFinalizeSidebarGroupIfFinished(q);
  if (!changed && hadFinalizedAt) q.sidebarGroupFinalizedAt = hadFinalizedAt;
  return changed;
}

function _taskQueueParseIndexList(value) {
  if (Array.isArray(value)) {
    const indexes = [];
    for (const raw of value) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        return { ok: false, indexes: [], error: '依赖任务编号必须是正整数' };
      }
      indexes.push(n);
    }
    return { ok: true, indexes: Array.from(new Set(indexes)).sort((a, b) => a - b), error: '' };
  }
  const text = String(value || '').trim();
  if (!text) return { ok: true, indexes: [], error: '' };
  const parts = text.split(/[,，;；、\s]+/).map(s => s.trim()).filter(Boolean);
  const indexes = [];
  for (const part of parts) {
    const clean = part.replace(/^#/g, '');
    if (!/^\d+$/.test(clean)) {
      return { ok: false, indexes: [], error: `无法识别依赖任务编号「${part}」` };
    }
    const n = Number(clean);
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, indexes: [], error: '依赖任务编号必须是正整数' };
    }
    indexes.push(n);
  }
  return { ok: true, indexes: Array.from(new Set(indexes)).sort((a, b) => a - b), error: '' };
}

function _taskQueueFormatIndexList(value) {
  const parsed = _taskQueueParseIndexList(value);
  return parsed.ok ? parsed.indexes.join(',') : String(value || '');
}

function _taskQueuePruneMissingDepends(q) {
  const existing = new Set((q.items || []).map(it => it.id));
  for (const item of q.items || []) {
    item.dependsOnTaskIds = (item.dependsOnTaskIds || []).filter(id => existing.has(id));
    item.dependsOnTaskIndexes = _taskQueueTaskIdsToIndexes(q, item.dependsOnTaskIds);
    item.dependsOnTasksText = _taskQueueFormatIndexList(item.dependsOnTaskIndexes);
  }
}

function _taskQueueOrderedItems(q = ensureTaskQueue()) {
  return (q.items || [])
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => (_taskQueuePositiveInt(a.item.order, 1) - _taskQueuePositiveInt(b.item.order, 1))
      || ((a.item.createdAt || 0) - (b.item.createdAt || 0))
      || (a.idx - b.idx));
}

function _taskQueueTaskIndexMap(q = ensureTaskQueue()) {
  const map = new Map();
  _taskQueueOrderedItems(q).forEach(({ item }, idx) => map.set(item.id, idx + 1));
  return map;
}

function _taskQueueTaskAtIndex(q, index) {
  const entry = _taskQueueOrderedItems(q)[index - 1];
  return entry ? entry.item : null;
}

function _taskQueueTaskIdsToIndexes(q, ids) {
  const map = _taskQueueTaskIndexMap(q);
  return (ids || []).map(id => map.get(id)).filter(n => Number.isInteger(n));
}

function _taskQueueDisplayDependencyIndexes(item) {
  const q = ensureTaskQueue();
  if (Array.isArray(item.dependsOnTaskIds) && item.dependsOnTaskIds.length) {
    return _taskQueueFormatIndexList(_taskQueueTaskIdsToIndexes(q, item.dependsOnTaskIds));
  }
  if (item.dependsOnTasksText) return _taskQueueFormatIndexList(item.dependsOnTasksText);
  if (Array.isArray(item.dependsOnTaskIndexes) && item.dependsOnTaskIndexes.length) {
    return _taskQueueFormatIndexList(item.dependsOnTaskIndexes);
  }
  return '';
}

function _taskQueueDependentItems(q, depId, unfinishedOnly = false) {
  return (q.items || []).filter(item => {
    if (!item || item.id === depId) return false;
    if (!Array.isArray(item.dependsOnTaskIds) || !item.dependsOnTaskIds.includes(depId)) return false;
    return !unfinishedOnly || !TASK_QUEUE_DONE_STATUSES.has(item.status);
  });
}

function _taskQueueDependentLabel(q, items) {
  const indexMap = _taskQueueTaskIndexMap(q);
  const labels = (items || []).slice(0, 3).map(item => '#' + (indexMap.get(item.id) || '?'));
  const more = (items || []).length > labels.length ? ` 等 ${items.length} 个任务` : '';
  return labels.join('、') + more;
}

function _taskQueueNormalizeDependencyRefs(q) {
  const items = q.items || [];
  const existingIds = new Set(items.map(it => it.id));
  for (const item of items) {
    const ids = Array.isArray(item.dependsOnTaskIds) ? item.dependsOnTaskIds.filter(id => existingIds.has(id)) : [];
    if (!ids.length && item.dependsOnTasksText) {
      const parsed = _taskQueueParseIndexList(item.dependsOnTasksText);
      if (parsed.ok) {
        for (const index of parsed.indexes) {
          const dep = _taskQueueTaskAtIndex(q, index);
          if (dep && dep.id !== item.id) ids.push(dep.id);
        }
      }
    }
    item.dependsOnTaskIds = Array.from(new Set(ids));
    item.dependsOnTaskIndexes = _taskQueueTaskIdsToIndexes(q, item.dependsOnTaskIds);
    if (item.dependsOnTaskIds.length || !item.dependsOnTasksText) {
      item.dependsOnTasksText = _taskQueueFormatIndexList(item.dependsOnTaskIndexes);
    } else {
      const parsed = _taskQueueParseIndexList(item.dependsOnTasksText);
      item.dependsOnTaskIndexes = parsed.ok ? parsed.indexes : [];
    }
  }
  _taskQueueSyncOutputPackageRefs(q);
}

function _taskQueueSyncOutputPackageRefs(q = ensureTaskQueue()) {
  const indexMap = _taskQueueTaskIndexMap(q);
  for (const item of q.items || []) {
    if (!item.outputPackage) continue;
    item.outputPackage.taskId = item.id;
    item.outputPackage.taskNo = '#' + (indexMap.get(item.id) || '?');
    if (!item.outputPackage.title) item.outputPackage.title = _taskQueueItemTitle(item);
  }
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
    q.items.push(_taskQueueCreateItem({
      text,
      order: 1,
      mode: q.defaultMode,
      useTools: !!q.defaultUseTools
    }));
  }
  if (input) input.value = '';
  saveTaskQueue();
  renderTaskQueueModal();
  if (typeof toast === 'function') toast(`已加入 ${tasks.length} 个任务`);
  if (autoStartEl && autoStartEl.checked && !q.running) {
    setTimeout(() => startTaskQueue(), 0);
  }
}

async function taskQueueAutoSchedule() {
  const q = ensureTaskQueue();
  taskQueueSaveDefaults();
  const input = document.getElementById('taskQueueInput');
  const raw = input ? input.value.trim() : '';
  if (!raw) {
    if (typeof toast === 'function') toast('请输入要调度的总任务');
    return;
  }
  if (!state.settings.apiKey) {
    alert('请先在「设置」中填写 API Key');
    if (typeof openSettings === 'function') openSettings();
    return;
  }
  if (q.running || q.items.some(_taskQueueItemBusy)) {
    if (typeof toast === 'function') toast('任务队列正在运行，请停止或等待完成后再自动调度', 4000);
    return;
  }
  if (typeof callOnceWithRole !== 'function') {
    if (typeof toast === 'function') toast('辅助 API 函数尚未加载，无法自动调度', 4000);
    return;
  }

  _taskQueueSetSchedulerBusy(true);
  _taskQueueSetSchedulerStatus('正在生成任务队列...');
  try {
    const plan = await _taskQueueGenerateSchedule(raw, q);
    const drafts = _taskQueueCoerceSchedulePlan(plan, q);
    if (!drafts.length) throw new Error('AI 没有返回可用任务');
    const added = _taskQueueAppendScheduledTasks(q, drafts);
    if (input) input.value = '';
    saveTaskQueue();
    renderTaskQueueModal();
    _taskQueueSetSchedulerStatus(`已生成 ${added} 个任务，可修改后执行`);
    if (typeof toast === 'function') toast(`已自动生成 ${added} 个任务，可修改后执行`);
  } catch (e) {
    console.warn('[task-queue] 自动调度失败:', e);
    _taskQueueSetSchedulerStatus('自动调度失败：' + (e.message || e), 'error');
    if (typeof toast === 'function') toast('自动调度失败：' + (e.message || e), 5000);
  } finally {
    _taskQueueSetSchedulerBusy(false);
  }
}

async function _taskQueueGenerateSchedule(userTask, q) {
  const rolePrompt = [
    '你是任务队列自动调度器。你只负责把用户的总任务拆成可执行的任务队列。',
    '必须只输出一个 JSON 对象，不要输出 Markdown、解释或代码块。',
    'JSON 固定格式：{"tasks":[{"text":"任务指令","order":1,"dependsOn":[],"mode":"normal","useTools":true,"exposeOutput":false}]}',
    '调度目标：优先提高整体执行效率。没有真实依赖关系的任务必须放在同一个 order 中并行执行；只有必须等待前置任务结果才能继续的任务，才放到更晚 order。',
    '不要把可以独立完成的任务串行化。不要为了看起来有步骤而拆出“先分析、再实现、再总结”这种低价值流水线，除非这些步骤确实需要由不同任务独立交付。',
    '每个任务都必须是可独立执行的完整指令，包含必要背景、范围、产物和验收标准。不要写“继续上一步”“参考前面结果”这类不自包含描述，除非同时用 dependsOn 明确依赖。',
    '任务数量规则：简单任务 1-3 个；中等任务 3-6 个；复杂任务 6-10 个；默认保持 3-8 个。除非用户明确要求，不要超过 10 个任务。',
    '字段规则：',
    '- text：给执行 AI 的完整任务指令，必须自包含、明确验收标准。',
    '- order：正整数。同一 order 的任务可并行；后一个 order 会等前一个 order 完成。',
    '- dependsOn：数组，填写本 JSON tasks 数组中的 1-based 任务编号；只能依赖更早 order 的任务。只有后续任务必须读取前置任务输出时才写 dependsOn；只是执行顺序不同但不需要读取输出，不要写 dependsOn。',
    '- mode：只能是 normal、outline、reflection。normal 适合明确、短平快、单轮或少量工具调用的任务，默认优先使用；outline 仅用于复杂长流程、多阶段探索、需要持续规划推进的任务；reflection 仅用于代码审查、方案评审、质量改进、需要多个视角反复评估的任务。不要滥用 outline 或 reflection。',
    '- useTools：是否允许工具。任务需要读取/修改文件、联网、运行命令、检查项目状态时为 true；纯文本分析、拆解、写作且不需要外部上下文时为 false。',
    '- exposeOutput：若后续任务需要引用此任务结果则为 true。凡是被 dependsOn 引用的任务必须 exposeOutput=true；不被后续引用的终点任务通常为 false。',
    '拆分原则：优先按可并行的独立工作包拆分，而不是按微步骤拆分；不要创建“总结/汇报”这种无实际执行价值的尾任务，除非用户明确要求。'
  ].join('\n');

  const history = [{
    role: 'user',
    content: [
      `默认执行方式：${q.defaultMode}`,
      `默认工具开关：${q.defaultUseTools ? 'true' : 'false'}`,
      '用户总任务：',
      userTask,
      '',
      '请输出固定 JSON。'
    ].join('\n')
  }];

  const raw = await callOnceWithRole(history, state.settings.currentModel, rolePrompt, {
    useGlobalAbortFallback: false,
    sourceLabel: '任务队列自动调度'
  });
  return _taskQueueParseScheduleJson(raw);
}

function _taskQueueParseScheduleJson(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('AI 返回为空');
  const unwrapped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(unwrapped);
  } catch (e) {
    const match = unwrapped.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    const arrayMatch = unwrapped.match(/\[[\s\S]*\]/);
    if (arrayMatch) return JSON.parse(arrayMatch[0]);
    throw new Error('AI 返回不是有效 JSON');
  }
}

function _taskQueueCoerceSchedulePlan(plan, q) {
  const list = Array.isArray(plan) ? plan : (Array.isArray(plan && plan.tasks) ? plan.tasks : []);
  const drafts = [];
  list.forEach((raw, idx) => {
    const item = raw && typeof raw === 'object' ? raw : { text: raw };
    const text = _taskQueueScheduleTaskText(item);
    if (!text) return;
    drafts.push({
      text,
      order: _taskQueuePositiveInt(item.order ?? item.stage ?? item.group, idx + 1),
      mode: _taskQueueScheduleMode(item.mode, q.defaultMode),
      useTools: _taskQueueScheduleBool(item.useTools ?? item.use_tools ?? item.tools, !!q.defaultUseTools),
      exposeOutput: _taskQueueScheduleBool(item.exposeOutput ?? item.expose_output ?? item.output, false),
      dependsOnIndexes: _taskQueueScheduleDependencyIndexes(item)
    });
  });
  _taskQueueNormalizeScheduledDraftOrders(drafts);
  return drafts;
}

function _taskQueueScheduleTaskText(item) {
  const title = String(item.title || item.name || '').trim();
  const text = String(item.text || item.task || item.instruction || item.prompt || item.description || '').trim();
  if (title && text && !text.includes(title)) return `${title}\n${text}`.trim();
  return text || title;
}

function _taskQueueScheduleMode(value, fallback) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('outline') || raw.includes('大纲')) return 'outline';
  if (raw.includes('reflection') || raw.includes('reflect') || raw.includes('师生') || raw.includes('评审')) return 'reflection';
  if (raw.includes('normal') || raw.includes('普通')) return 'normal';
  return ['normal', 'outline', 'reflection'].includes(fallback) ? fallback : 'normal';
}

function _taskQueueScheduleBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', '需要', '启用', '是'].includes(raw)) return true;
    if (['false', 'no', 'n', '0', '不需要', '禁用', '否'].includes(raw)) return false;
  }
  return !!fallback;
}

function _taskQueueScheduleDependencyIndexes(item) {
  const raw = item.dependsOn ?? item.depends_on ?? item.dependencies ?? item.depends ?? item.dependsOnTasks;
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map(x => {
      if (typeof x === 'number') return x;
      if (typeof x === 'string') return parseInt(x.replace(/^#/, ''), 10);
      if (x && typeof x === 'object') return parseInt(x.index || x.task || x.taskNo || x.id, 10);
      return NaN;
    }).filter(n => Number.isInteger(n) && n > 0)));
  }
  if (typeof raw === 'string') {
    const parsed = _taskQueueParseIndexList(raw.replace(/#/g, ''));
    return parsed.ok ? parsed.indexes : [];
  }
  return [];
}

function _taskQueueNormalizeScheduledDraftOrders(drafts) {
  if (!drafts.length) return;
  const remapOrders = () => {
    const orders = Array.from(new Set(drafts.map(d => _taskQueuePositiveInt(d.order, 1)))).sort((a, b) => a - b);
    const map = new Map(orders.map((order, idx) => [order, idx + 1]));
    drafts.forEach(d => { d.order = map.get(_taskQueuePositiveInt(d.order, 1)) || 1; });
  };
  remapOrders();
  for (let pass = 0; pass < drafts.length; pass++) {
    let changed = false;
    drafts.forEach((draft, idx) => {
      draft.dependsOnIndexes = (draft.dependsOnIndexes || []).filter(n => n !== idx + 1 && drafts[n - 1]);
      for (const depIndex of draft.dependsOnIndexes) {
        const dep = drafts[depIndex - 1];
        if (dep && dep.order >= draft.order) {
          draft.order = dep.order + 1;
          changed = true;
        }
      }
    });
    if (!changed) break;
  }
  remapOrders();
}

function _taskQueueAppendScheduledTasks(q, drafts) {
  const existingMaxOrder = (q.items || []).reduce((max, item) => Math.max(max, _taskQueuePositiveInt(item.order, 1)), 0);
  const baseOrder = existingMaxOrder + 1;
  const now = Date.now();
  const items = drafts.map((draft, idx) => _taskQueueCreateItem({
    text: draft.text,
    order: baseOrder + _taskQueuePositiveInt(draft.order, 1) - 1,
    mode: draft.mode,
    useTools: draft.useTools,
    exposeOutput: draft.exposeOutput,
    createdAt: now + idx
  }));

  drafts.forEach((draft, idx) => {
    const ids = (draft.dependsOnIndexes || [])
      .map(depIndex => items[depIndex - 1])
      .filter(Boolean)
      .map(dep => dep.id);
    items[idx].dependsOnTaskIds = Array.from(new Set(ids));
    for (const id of ids) {
      const dep = items.find(it => it.id === id);
      if (dep) dep.exposeOutput = true;
    }
  });

  q.items.push(...items);
  _taskQueueNormalizeDependencyRefs(q);
  return items.length;
}

function _taskQueueSetSchedulerBusy(busy) {
  const btn = document.getElementById('taskQueueScheduleBtn');
  if (!btn) return;
  btn.disabled = !!busy;
  btn.textContent = busy ? 'AI 调度中...' : 'AI 自动调度';
}

function _taskQueueSetSchedulerStatus(text, type = '') {
  const el = document.getElementById('taskQueueSchedulerStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'task-queue-scheduler-status' + (type ? ` ${type}` : '');
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
  const nextText = String(value || '').trim();
  if (item.text !== nextText) {
    item.text = nextText;
    _taskQueueResetForFreshRun(item);
  }
  saveTaskQueue();
  renderTaskQueueModal();
}

async function taskQueueUpdateItemOrder(id, value) {
  const item = _taskQueueFindItem(id);
  if (!item || _taskQueueItemBusy(item)) return;
  const nextOrder = _taskQueuePositiveInt(value, 1);
  if (item.order === nextOrder) return;
  item.order = nextOrder;
  if (item.exposeOutput && item.status === 'done' && item.chatId) {
    item.outputPackage = null;
    item.outputUpdatedAt = null;
    item.outputWarning = '';
    _taskQueueNormalizeDependencyRefs(ensureTaskQueue());
    saveTaskQueue();
    renderTaskQueueModal();
    await _taskQueueRefreshOutputPackage(item);
  } else {
    item.outputPackage = null;
    item.outputUpdatedAt = null;
    item.outputWarning = '';
  }
  _taskQueueNormalizeDependencyRefs(ensureTaskQueue());
  _taskQueueSyncFinalizedSidebarMeta(ensureTaskQueue());
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueUpdateItemMode(id, value) {
  const item = _taskQueueFindItem(id);
  if (!item || !['pending', 'paused', 'stopped', 'error'].includes(item.status)) return;
  if (['normal', 'outline', 'reflection'].includes(value) && item.mode !== value) {
    item.mode = value;
    _taskQueueResetForFreshRun(item);
  }
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueUpdateItemTools(id, checked) {
  const item = _taskQueueFindItem(id);
  if (!item || !['pending', 'paused', 'stopped', 'error'].includes(item.status)) return;
  if (item.useTools !== !!checked) {
    item.useTools = !!checked;
    _taskQueueResetForFreshRun(item);
  }
  saveTaskQueue();
  renderTaskQueueModal();
}

async function taskQueueUpdateItemExpose(id, checked) {
  const item = _taskQueueFindItem(id);
  if (!item || _taskQueueItemBusy(item)) return;
  const nextExposeOutput = !!checked;
  if (item.exposeOutput === nextExposeOutput) return;
  if (!nextExposeOutput) {
    const q = ensureTaskQueue();
    const dependents = _taskQueueDependentItems(q, item.id, true);
    if (dependents.length) {
      renderTaskQueueModal();
      if (typeof toast === 'function') toast(`该任务仍被 ${_taskQueueDependentLabel(q, dependents)} 依赖，请先修改依赖任务`, 4000);
      return;
    }
  }
  item.exposeOutput = nextExposeOutput;
  if (!item.exposeOutput) {
    item.outputPackage = null;
    item.outputUpdatedAt = null;
    item.outputWarning = '';
  } else if (item.status === 'done' && item.chatId) {
    saveTaskQueue();
    renderTaskQueueModal();
    await _taskQueueRefreshOutputPackage(item);
  }
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueUpdateItemDepends(id, value) {
  const item = _taskQueueFindItem(id);
  if (!item || _taskQueueItemBusy(item)) return;
  const prevDepends = item.dependsOnTasksText || '';
  const raw = String(value || '').trim();
  item.dependsOnTasksText = raw;
  const parsed = _taskQueueParseIndexList(raw);
  if (parsed.ok) {
    const q = ensureTaskQueue();
    const ids = [];
    for (const index of parsed.indexes) {
      const dep = _taskQueueTaskAtIndex(q, index);
      if (dep && dep.id !== item.id) ids.push(dep.id);
    }
    if (ids.length === parsed.indexes.length) {
      item.dependsOnTaskIds = Array.from(new Set(ids));
      item.dependsOnTaskIndexes = _taskQueueTaskIdsToIndexes(q, item.dependsOnTaskIds);
      item.dependsOnTasksText = _taskQueueFormatIndexList(item.dependsOnTaskIndexes);
    } else {
      item.dependsOnTaskIds = [];
      item.dependsOnTaskIndexes = parsed.indexes;
    }
  } else {
    item.dependsOnTaskIds = [];
    item.dependsOnTaskIndexes = [];
  }
  if (prevDepends !== item.dependsOnTasksText) _taskQueueResetForFreshRun(item);
  saveTaskQueue();
  renderTaskQueueModal();
  if (!parsed.ok && typeof toast === 'function') toast(parsed.error, 3000);
}

function taskQueueRemoveItem(id) {
  const q = ensureTaskQueue();
  const item = _taskQueueFindItem(id);
  if (!item || _taskQueueItemBusy(item)) return;
  const dependents = _taskQueueDependentItems(q, item.id, true);
  if (dependents.length) {
    if (typeof toast === 'function') toast(`该任务仍被 ${_taskQueueDependentLabel(q, dependents)} 依赖，请先修改依赖任务`, 4000);
    renderTaskQueueModal();
    return;
  }
  q.items = q.items.filter(it => it.id !== id);
  _taskQueuePruneMissingDepends(q);
  saveTaskQueue();
  renderTaskQueueModal();
}

function taskQueueRetryItem(id) {
  const item = _taskQueueFindItem(id);
  if (!item || item.status === 'running' || item.outputBuilding) return;
  _taskQueueResetForFreshRun(item);
  saveTaskQueue();
  renderTaskQueueModal();
}

function _taskQueueResetForFreshRun(item) {
  if (!item) return;
  item.status = 'pending';
  item.error = '';
  item.outputPackage = null;
  item.outputUpdatedAt = null;
  item.outputWarning = '';
  item.outputBuilding = false;
  item.promptHash = '';
  item.sidebarGroupId = '';
  item.chatId = null;
  item.startedAt = null;
  item.finishedAt = null;
  item.pausedAt = null;
  item.skippedAt = null;
  delete item._requestedStatus;
  delete item._outputStopRequested;
}

function taskQueueOpenChat(id) {
  const item = _taskQueueFindItem(id);
  if (!item || !item.chatId) return;
  if (typeof switchChat === 'function') switchChat(item.chatId);
  closeTaskQueue();
}

function taskQueueClearSettled() {
  const q = ensureTaskQueue();
  _taskQueueNormalizeDependencyRefs(q);
  const isSettled = it => TASK_QUEUE_DONE_STATUSES.has(it.status) || it.status === 'error' || it.status === 'stopped';
  const settledIds = new Set(q.items.filter(isSettled).map(it => it.id));
  const referencedSettledIds = new Set();
  for (const item of q.items) {
    if (isSettled(item)) continue;
    for (const depId of item.dependsOnTaskIds || []) {
      if (settledIds.has(depId)) referencedSettledIds.add(depId);
    }
  }
  const protectedSettledIds = new Set(referencedSettledIds);
  for (const item of q.items) {
    if (isSettled(item) && item.outputBuilding) protectedSettledIds.add(item.id);
  }
  const before = q.items.length;
  q.items = q.items.filter(it => !isSettled(it) || protectedSettledIds.has(it.id));
  const cleared = before - q.items.length;
  const kept = protectedSettledIds.size;
  _taskQueuePruneMissingDepends(q);
  saveTaskQueue();
  renderTaskQueueModal();
  if (typeof toast === 'function') {
    if (kept) toast(`已清除 ${cleared} 条；${kept} 条被后续任务依赖或仍在生成输出包，已保留`, 4000);
    else toast(`已清除 ${cleared} 条已结束任务`, 2500);
  }
}

function taskQueueClearAll() {
  const q = ensureTaskQueue();
  if (q.running || q.items.some(_taskQueueItemBusy)) {
    if (typeof toast === 'function') toast('存在运行中任务或输出包生成中，请先停止所有任务');
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

async function _taskQueueRunRunnableGroup(runnable) {
  const lanes = new Map();
  for (const item of runnable || []) {
    const key = item.chatId || item.id;
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key).push(item);
  }
  await Promise.allSettled(Array.from(lanes.values()).map(async lane => {
    for (const item of lane) {
      const q = ensureTaskQueue();
      if (!q.running || q.stopAllRequested || q.paused) break;
      if (item.status !== 'pending') continue;
      await _taskQueueRunItem(item);
    }
  }));
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
  _taskQueuePrepareSidebarGroup(q);
  q.items.forEach(it => {
    if (it.status === 'paused') {
      _taskQueueResetForFreshRun(it);
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
      await _taskQueueRunRunnableGroup(runnable);
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
    const finalizedSidebarGroup = _taskQueueFinalizeSidebarGroupIfFinished(q);
    saveTaskQueue();
    renderTaskQueueModal();
    if (finalizedSidebarGroup && typeof toast === 'function') toast('任务队列对话已折叠到侧栏');
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
    if (item.outputBuilding) _taskQueueStopOutputPackage(item);
    else if (item.status === 'running') _taskQueueAbortItem(item, 'stopped');
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
  if (!item) return;
  if (item.outputBuilding) {
    _taskQueueStopOutputPackage(item);
    saveTaskQueue();
    renderTaskQueueModal();
    return;
  }
  if (TASK_QUEUE_DONE_STATUSES.has(item.status)) return;
  if (item.status === 'running') _taskQueueAbortItem(item, 'stopped');
  else {
    item.status = 'stopped';
    item.error = '已停止';
    item.finishedAt = Date.now();
  }
  saveTaskQueue();
  renderTaskQueueModal();
}

function _taskQueueStopOutputPackage(item) {
  if (!item || !item.outputBuilding) return;
  item._outputStopRequested = true;
  item.outputWarning = '正在停止输出包生成...';
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
  item.outputPackage = null;
  item.outputUpdatedAt = null;
  item.outputWarning = '';
  item.startedAt = Date.now();
  item.finishedAt = null;
  item.pausedAt = null;
  item.skippedAt = null;
  saveTaskQueue();
  renderTaskQueueModal();

  try {
    if (typeof callAPI !== 'function') throw new Error('API 函数尚未加载');
    const dependencyContext = await _taskQueueBuildDependencyContext(item);
    const c = _taskQueueEnsureChatForItem(item, dependencyContext);
    item.chatId = c.id;
    saveTaskQueue();
    renderTaskQueueModal();

    if (typeof clearPendingAIAttachments === 'function') clearPendingAIAttachments(c.id);
    const beforeMessageCount = Array.isArray(c.messages) ? c.messages.length : 0;
    if (item.mode === 'outline') {
      await callAPIWithOutline({ chatId: c.id, useTools: item.useTools, suppressCompletionSound: true });
    } else if (item.mode === 'reflection') {
      await callAPIWithReflection({ chatId: c.id, useTools: item.useTools, suppressCompletionSound: true });
    } else {
      await callAPI(undefined, { chatId: c.id, useTools: item.useTools, suppressCompletionSound: true });
    }
    if (item.status === 'running'
        && (((typeof isChatGenerating === 'function') ? isChatGenerating(c.id) : false)
        || (Array.isArray(c.messages)
          && c.messages.length === beforeMessageCount
          && !c.messages.slice(beforeMessageCount).some(m => m && m.role === 'assistant')))) {
      item.status = 'paused';
      item.error = '该对话已有任务正在执行，已暂停等待重试';
      item.pausedAt = Date.now();
      return;
    }

    if (item.status === 'running') {
      const result = _taskQueueInspectResult(item.chatId);
      _taskQueueApplyRequestedOrResult(item, result);
      item.finishedAt = Date.now();
      await _taskQueueRefreshOutputPackage(item);
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
    item.outputPackage = null;
    item.outputUpdatedAt = null;
    item.finishedAt = Date.now();
  } finally {
    if (item.status === 'running') {
      const result = _taskQueueInspectResult(item.chatId);
      _taskQueueApplyRequestedOrResult(item, result);
      item.finishedAt = Date.now();
      await _taskQueueRefreshOutputPackage(item);
    }
    saveTaskQueue();
    renderTaskQueueModal();
  }
}

function _taskQueueEnsureChatForItem(item, dependencyContext = '') {
  let c = item.chatId && typeof chatById === 'function' ? chatById(item.chatId) : null;
  const userContent = _taskQueueComposeTaskPrompt(item, dependencyContext);
  const promptHash = _taskQueueStringHash(userContent);
  if (c) {
    _taskQueueApplyChatSidebarMeta(c, item);
    const lastUser = (Array.isArray(c.messages) ? c.messages.slice().reverse().find(m => m.role === 'user') : null);
    const lastUserSame = lastUser && String(lastUser.content || '') === userContent;
    if (item.promptHash !== promptHash && !lastUserSame) {
      c.messages.push({ role: 'user', content: userContent });
      saveData();
    }
    item.promptHash = promptHash;
    return c;
  }
  c = {
    id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    title: _taskQueueItemTitle(item).slice(0, 30) || '队列任务',
    messages: [{ role: 'user', content: userContent }],
    createdAt: Date.now()
  };
  state.chats.unshift(c);
  item.chatId = c.id;
  item.promptHash = promptHash;
  _taskQueueApplyChatSidebarMeta(c, item);
  saveData();
  if (typeof renderChatList === 'function') renderChatList();
  return c;
}

function _taskQueueInspectResult(itemOrChatId) {
  const chatId = typeof itemOrChatId === 'object' ? itemOrChatId.chatId : itemOrChatId;
  const c = typeof chatById === 'function' ? chatById(chatId) : null;
  if (!c || !Array.isArray(c.messages)) return { status: 'error', error: '找不到任务对话' };
  const assistant = c.messages.slice().reverse().find(m => m.role === 'assistant');
  if (!assistant) return { status: 'error', error: '任务没有生成模型回答' };
  if (assistant.outline) {
    const outlineStatus = assistant.outline.status || '';
    if (outlineStatus === 'paused') return { status: 'paused', error: '大纲任务已暂停' };
    if (outlineStatus === 'error') return { status: 'error', error: '大纲任务出错' };
    if (outlineStatus === 'cancelled') return { status: 'stopped', error: '大纲任务已停止' };
    if (assistant.outline.inProgress || outlineStatus === 'running') return { status: 'paused', error: '大纲任务仍在运行，已暂停等待重试' };
  }
  if (assistant.reflection && assistant.reflection.inProgress) {
    return { status: 'paused', error: '师生任务仍在运行，已暂停等待重试' };
  }
  const content = assistant ? String(assistant.content || '') : '';
  if (content.includes('[已停止]') || content.includes('[任务分类已停止]')) return { status: 'stopped', error: '已停止' };
  if (content.trim().startsWith('❌')) {
    return { status: 'error', error: content.trim().split('\n')[0].slice(0, 220) };
  }
  return { status: 'done', error: '' };
}

function _taskQueueNormalizeOutputPackage(pkg) {
  if (!pkg || typeof pkg !== 'object') return null;
  return {
    taskId: pkg.taskId || '',
    taskNo: pkg.taskNo || '',
    title: String(pkg.title || '').slice(0, 120),
    status: pkg.status || '',
    summary: _taskQueueClipText(pkg.summary || '', 1200),
    result: _taskQueueClipText(pkg.result || '', 3000),
    evidence: Array.isArray(pkg.evidence) ? pkg.evidence.slice(0, 5).map(x => _taskQueueClipText(x, 500)) : [],
    warnings: Array.isArray(pkg.warnings) ? pkg.warnings.slice(0, 5).map(x => _taskQueueClipText(x, 500)) : []
  };
}

async function _taskQueueRefreshOutputPackage(item) {
  if (!item.exposeOutput) {
    item.outputPackage = null;
    item.outputUpdatedAt = null;
    item.outputBuilding = false;
    return;
  }
  if (item.status !== 'done') {
    item.outputPackage = null;
    item.outputUpdatedAt = null;
    item.outputBuilding = false;
    return;
  }
  try {
    item._outputStopRequested = false;
    item.outputBuilding = true;
    saveTaskQueue();
    renderTaskQueueModal();
    item.outputPackage = await _taskQueueGenerateOutputPackage(item);
    item.outputWarning = '';
  } catch (e) {
    if (item._outputStopRequested || (e && e.name === 'AbortError')) {
      item.outputPackage = null;
      item.outputWarning = '输出包生成已停止';
    } else {
      console.warn('[task-queue] 输出包生成失败，使用 fallback:', e);
      item.outputPackage = _taskQueueBuildFallbackOutputPackage(item, e);
      item.outputWarning = '输出包生成失败，已使用简化输出包';
    }
  } finally {
    item.outputBuilding = false;
    delete item._outputStopRequested;
  }
  if (item.outputPackage) _taskQueueSyncOutputPackageRefs(ensureTaskQueue());
  item.outputUpdatedAt = item.outputPackage ? Date.now() : null;
}

async function _taskQueueGenerateOutputPackage(item, options = {}) {
  if (typeof callOnceWithRole !== 'function') throw new Error('辅助 API 函数尚未加载');
  const c = item.chatId && typeof chatById === 'function' ? chatById(item.chatId) : null;
  if (!c || !Array.isArray(c.messages)) throw new Error('找不到任务对话');
  const finalAnswer = _taskQueueFinalAssistantText(c);
  if (!finalAnswer) throw new Error('没有可用于生成输出包的最终回答');
  const q = ensureTaskQueue();
  const taskNo = '#' + (_taskQueueTaskIndexMap(q).get(item.id) || '?');
  const rolePrompt = [
    '你是任务队列的结果打包器。你只负责把一个已完成 Agent 任务的结果压缩成固定 JSON。',
    '必须只输出合法 JSON，不要输出 Markdown、解释、代码块或额外文本。',
    'JSON schema:',
    '{',
    '  "taskNo": "string，任务卡片编号，例如 #1",',
    '  "taskId": "string",',
    '  "title": "string，任务内容短标题",',
    '  "status": "done",',
    '  "summary": "string，核心结果摘要，尽量 200-500 字",',
    '  "result": "string，最终可复用结论/答案，尽量 300-1200 字",',
    '  "evidence": ["string，关键依据，最多 5 条"],',
    '  "warnings": ["string，失败、限制、未完成事项，最多 5 条"]',
    '}',
    '字段必须完整存在。evidence 或 warnings 没有内容时返回空数组。'
  ].join('\n');
  const history = [{
    role: 'user',
    content: [
      `任务编号: ${taskNo}`,
      `taskId: ${item.id}`,
      `任务标题: ${_taskQueueItemTitle(item)}`,
      `任务状态: ${item.status}`,
      '',
      '任务最终回答:',
      _taskQueueClipText(finalAnswer, 20000)
    ].join('\n')
  }];
  const raw = await callOnceWithRole(history, state.settings.currentModel, rolePrompt, {
    chat: c,
    chatId: item.chatId,
    sourceLabel: '任务队列输出包生成',
    isStopped: () => {
      const task = typeof chatTaskById === 'function' ? chatTaskById(item.chatId) : null;
      const outerStopped = typeof options.isStopped === 'function' ? options.isStopped() : false;
      return outerStopped || !!item._outputStopRequested || !!(task && task.stopRequested) || item.status === 'paused' || item.status === 'stopped';
    }
  });
  const parsed = _taskQueueParseOutputPackageJson(raw);
  const currentTaskNo = '#' + (_taskQueueTaskIndexMap(ensureTaskQueue()).get(item.id) || '?');
  parsed.taskNo = currentTaskNo;
  parsed.taskId = item.id;
  parsed.title = parsed.title || _taskQueueItemTitle(item);
  parsed.status = parsed.status || item.status;
  return _taskQueueNormalizeOutputPackage(parsed);
}

function _taskQueueBuildFallbackOutputPackage(item, cause) {
  const c = item.chatId && typeof chatById === 'function' ? chatById(item.chatId) : null;
  const finalAnswer = c ? _taskQueueFinalAssistantText(c) : '';
  const q = ensureTaskQueue();
  const taskNo = '#' + (_taskQueueTaskIndexMap(q).get(item.id) || '?');
  const warning = cause && cause.message ? `模型输出包生成失败：${cause.message}` : '模型输出包生成失败，使用简化输出包';
  return _taskQueueNormalizeOutputPackage({
    taskId: item.id,
    taskNo,
    title: _taskQueueItemTitle(item),
    status: item.status,
    summary: _taskQueueMakeSummary(finalAnswer),
    result: _taskQueueClipText(finalAnswer, 3000),
    evidence: _taskQueueExtractKeyFindings(finalAnswer).slice(0, 5),
    warnings: [warning]
  });
}

function _taskQueueFinalAssistantText(chat) {
  const messages = chat && Array.isArray(chat.messages) ? chat.messages : [];
  const finalMsg = messages.slice().reverse().find(m =>
    m.role === 'assistant' &&
    !m._hiddenFromUI &&
    String(m.content || '').trim() &&
    !String(m.content || '').includes('[已停止]')
  );
  return finalMsg ? String(finalMsg.content || '').trim() : '';
}

function _taskQueueParseOutputPackageJson(raw) {
  const text = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(text);
    return _taskQueueCoerceOutputPackage(parsed);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return _taskQueueCoerceOutputPackage(JSON.parse(match[0]));
    throw new Error('输出包不是合法 JSON');
  }
}

function _taskQueueCoerceOutputPackage(value) {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    taskNo: String(obj.taskNo || ''),
    taskId: String(obj.taskId || ''),
    title: String(obj.title || ''),
    status: String(obj.status || ''),
    summary: String(obj.summary || ''),
    result: String(obj.result || ''),
    evidence: Array.isArray(obj.evidence) ? obj.evidence.map(String) : [],
    warnings: Array.isArray(obj.warnings) ? obj.warnings.map(String) : []
  };
}

function _taskQueueMakeSummary(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return _taskQueueClipText(clean, 900);
}

function _taskQueueExtractKeyFindings(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(s => s.replace(/^[-*+•\d.、\s]+/, '').trim())
    .filter(s => s.length >= 8 && s.length <= 260);
  const picked = [];
  for (const line of lines) {
    if (picked.includes(line)) continue;
    if (/^(#{1,6}|```|---)$/.test(line)) continue;
    picked.push(line);
    if (picked.length >= 8) break;
  }
  return picked;
}

async function _taskQueueBuildDependencyContext(item) {
  const depIds = item.dependsOnTaskIds || [];
  if (!depIds.length) return '';
  const q = ensureTaskQueue();
  _taskQueueNormalizeDependencyRefs(q);
  const packages = [];
  const indexMap = _taskQueueTaskIndexMap(q);
  const throwIfStopped = () => {
    if (_taskQueueItemStopRequested(item)) {
      const err = new Error('任务已停止');
      err.name = 'AbortError';
      throw err;
    }
  };
  for (const depId of depIds) {
    throwIfStopped();
    const dep = q.items.find(it => it.id === depId);
    const index = indexMap.get(depId) || '?';
    if (!dep) throw new Error(`依赖任务 #${index} 不存在`);
    if (!dep.exposeOutput) throw new Error(`依赖任务 #${index}「${_taskQueueItemTitle(dep)}」没有勾选“供后续引用”`);
    if (dep.status === 'skipped') throw new Error(`依赖任务 #${index}「${_taskQueueItemTitle(dep)}」已跳过，没有输出包`);
    if (dep.status !== 'done') throw new Error(`依赖任务 #${index}「${_taskQueueItemTitle(dep)}」还没有完成输出包`);
    if (!dep.outputPackage && dep.chatId) {
      try {
        dep.outputPackage = await _taskQueueGenerateOutputPackage(dep, {
          isStopped: () => _taskQueueItemStopRequested(item)
        });
        dep.outputWarning = '';
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        dep.outputPackage = _taskQueueBuildFallbackOutputPackage(dep, e);
        dep.outputWarning = '输出包生成失败，已使用简化输出包';
      }
      dep.outputUpdatedAt = Date.now();
      _taskQueueSyncOutputPackageRefs(q);
    }
    if (!dep.outputPackage) throw new Error(`依赖任务 #${index}「${_taskQueueItemTitle(dep)}」缺少输出包`);
    packages.push(dep.outputPackage);
  }
  if (!packages.length) return '';
  return _taskQueueFormatDependencyContext(packages);
}

function _taskQueueFormatDependencyContext(packages) {
  const blocks = packages.map((pkg, idx) => {
    const evidence = pkg.evidence && pkg.evidence.length
      ? `\n依据:\n${pkg.evidence.map(x => `- ${x}`).join('\n')}`
      : '';
    const warnings = pkg.warnings && pkg.warnings.length
      ? `\n注意:\n${pkg.warnings.map(x => `- ${x}`).join('\n')}`
      : '';
    return [
      `## 依赖输出 ${idx + 1}: ${pkg.taskNo || '#' + (idx + 1)} / ${pkg.title || pkg.taskId}`,
      `状态: ${pkg.status || 'done'}`,
      pkg.summary ? `摘要:\n${pkg.summary}` : '',
      pkg.result ? `结果:\n${pkg.result}` : '',
      evidence,
      warnings
    ].filter(Boolean).join('\n');
  });
  return [
    '以下是任务队列中前序 Agent 的结构化输出包。它们只作为当前任务的背景资料；不要继承前序任务的工具权限、暂停状态、大纲状态或运行状态。',
    '',
    blocks.join('\n\n')
  ].join('\n');
}

function _taskQueueComposeTaskPrompt(item, dependencyContext) {
  const taskText = String(item.text || '').trim();
  if (!dependencyContext) return taskText;
  return `${dependencyContext}\n\n---\n\n当前任务：\n${taskText}`;
}

function _taskQueueClipText(value, maxLen) {
  const text = String(value || '').trim();
  if (!maxLen || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n\n...[已截断，原长度 ${text.length} 字符]`;
}

function _taskQueueStringHash(value) {
  const s = String(value || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return `${s.length}:${hash}`;
}

function _taskQueueAbortItem(item, nextStatus) {
  item._requestedStatus = nextStatus;
  if (item.outputBuilding) item._outputStopRequested = true;
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
    item.outputPackage = null;
    item.outputUpdatedAt = null;
    item.outputWarning = '';
    item.finishedAt = Date.now();
  }
}

function _taskQueueItemStopRequested(item) {
  if (!item) return true;
  return !!item._requestedStatus
    || !!item._outputStopRequested
    || item.status === 'paused'
    || item.status === 'stopped'
    || item.status === 'skipped';
}

function _taskQueueItemBusy(item) {
  return !!item && (item.status === 'running' || !!item.outputBuilding);
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
    item.outputPackage = null;
    item.outputUpdatedAt = null;
    item.outputWarning = '';
    item.finishedAt = item.finishedAt || Date.now();
  } else if (result) {
    item.status = result.status;
    item.error = result.error || '';
    if (result.status !== 'done') {
      item.outputPackage = null;
      item.outputUpdatedAt = null;
      item.outputWarning = '';
    }
  }
  delete item._requestedStatus;
}

function _taskQueueMarkSkipped(item) {
  item.status = 'skipped';
  item.error = '';
  item.outputPackage = null;
  item.outputUpdatedAt = null;
  item.outputWarning = '';
  item.skippedAt = Date.now();
  item.finishedAt = Date.now();
}

function _taskQueueValidateOrders(q) {
  _taskQueueNormalizeDependencyRefs(q);
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
  for (const item of q.items) {
    const parsed = _taskQueueParseIndexList(item.dependsOnTasksText || item.dependsOnTaskIndexes || []);
    if (!parsed.ok) return { ok: false, error: `任务「${_taskQueueItemTitle(item)}」依赖任务错误：${parsed.error}` };
    const ids = [];
    for (const index of parsed.indexes) {
      const dep = _taskQueueTaskAtIndex(q, index);
      if (!dep) return { ok: false, error: `任务「${_taskQueueItemTitle(item)}」依赖了不存在的任务 #${index}` };
      if (dep.id === item.id) return { ok: false, error: `任务「${_taskQueueItemTitle(item)}」不能依赖自己 #${index}` };
      if (_taskQueuePositiveInt(dep.order, 1) >= _taskQueuePositiveInt(item.order, 1)) {
        return { ok: false, error: `任务「${_taskQueueItemTitle(item)}」只能依赖更早执行顺序里的任务，不能依赖 #${index}` };
      }
      if (!dep.exposeOutput) {
        return { ok: false, error: `任务「${_taskQueueItemTitle(item)}」依赖 #${index}，但该任务没有勾选“供后续引用”` };
      }
      ids.push(dep.id);
    }
    item.dependsOnTaskIds = Array.from(new Set(ids));
    item.dependsOnTaskIndexes = _taskQueueTaskIdsToIndexes(q, item.dependsOnTaskIds);
    item.dependsOnTasksText = _taskQueueFormatIndexList(item.dependsOnTaskIndexes);
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
