const GoalCoreConfig = window.AgentApp.require('config');
const GoalCoreStateModule = window.AgentApp.require('state');
const GoalCoreUiService = window.AgentApp.require('uiService');
const GoalCoreOrchestrationService = window.AgentApp.require('orchestrationService');

const goalState = GoalCoreStateModule.state;
const goalSaveData = GoalCoreStateModule.saveData;
const goalPersistSettings = GoalCoreStateModule.persistSettings;
const goalPersistTools = GoalCoreStateModule.persistTools;
const goalChatById = GoalCoreStateModule.chatById;
const goalBeginChatTask = GoalCoreStateModule.beginChatTask;
const goalRequestStopChatTask = GoalCoreStateModule.requestStopChatTask;
const goalClearChatTask = GoalCoreStateModule.clearChatTask;
const goalSetChatTaskMode = GoalCoreStateModule.setChatTaskMode;
const GOAL_STORAGE_KEY = 'aichat_goals_v1';
const GOAL_TOOL_NAMES = new Set(['create_goal', 'get_goal', 'update_goal']);

const GOAL_TERMINAL_STATUSES = new Set(['complete', 'blocked', 'cancelled']);
const GOAL_RUNNERS = new Map();

let goalStore = normalizeGoalStore(null);

function nowIso() {
  return new Date().toISOString();
}

function goalDefaultSystemPrompt() {
  return GoalCoreConfig.DEFAULT_GOAL_SYSTEM_PROMPT || [
    'You are running a durable long-task goal.',
    'Always call get_goal first in each turn.',
    'Do one minimal verifiable step per turn, use tools when needed, and record progress with update_goal.',
    'Only call update_goal with status complete when the whole objective is actually satisfied and evidence is available.',
    'If blocked, report the same concrete blocker through update_goal; the runner will only mark blocked after repeated matching blockers.',
    'Never mark a goal complete because token budget, turn budget, or time is running out.'
  ].join('\n');
}

function goalDefaultTurnPrompt() {
  return GoalCoreConfig.DEFAULT_GOAL_TURN_PROMPT || [
    'Goal objective: {{objective}}',
    'Goal status: {{status}}',
    'Turn: {{turn}} / {{maxTurns}}',
    'Token budget: {{tokenUsed}} / {{tokenBudget}}',
    '',
    'Protocol:',
    '1. First call get_goal.',
    '2. Choose one minimal verifiable next step.',
    '3. Use available tools only when they materially advance or verify that step.',
    '4. Before your final reply, call update_goal with progress, evidence, next_step, and status when appropriate.',
    '5. Stop after that step and summarize the result briefly.'
  ].join('\n');
}

function normalizeGoalStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (['active', 'paused', 'complete', 'blocked', 'cancelled'].includes(value)) return value;
  return 'active';
}

function normalizeGoalStore(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const goals = Array.isArray(source.goals) ? source.goals : [];
  const normalized = goals.map(normalizeGoalRecord).filter(Boolean);
  const activeGoalId = source.activeGoalId && normalized.some(g => g.id === source.activeGoalId)
    ? source.activeGoalId
    : (normalized[0] ? normalized[0].id : '');
  return {
    activeGoalId,
    selectedGoalId: source.selectedGoalId && normalized.some(g => g.id === source.selectedGoalId)
      ? source.selectedGoalId
      : (normalized[0] ? normalized[0].id : ''),
    goals: normalized
  };
}

function normalizeGoalRecord(goal) {
  if (!goal || typeof goal !== 'object') return null;
  const createdAt = goal.createdAt || nowIso();
  const events = Array.isArray(goal.events) ? goal.events.slice(-80) : [];
  return {
    id: String(goal.id || ('goal_' + Date.now())),
    chatId: String(goal.chatId || ''),
    objective: String(goal.objective || '').trim(),
    status: normalizeGoalStatus(goal.status),
    tokenBudget: Math.max(0, Number(goal.tokenBudget || 0) || 0),
    tokenUsed: Math.max(0, Number(goal.tokenUsed || 0) || 0),
    turnCount: Math.max(0, Number(goal.turnCount || 0) || 0),
    maxTurns: Math.max(1, Number(goal.maxTurns || goalSettings().goalMaxTurns || 20) || 20),
    summary: String(goal.summary || ''),
    lastResult: String(goal.lastResult || ''),
    lastError: String(goal.lastError || ''),
    nextStep: String(goal.nextStep || ''),
    events,
    blockerAudit: normalizeBlockerAudit(goal.blockerAudit),
    createdAt,
    updatedAt: goal.updatedAt || createdAt,
    completedAt: goal.completedAt || '',
    blockedAt: goal.blockedAt || '',
    cancelledAt: goal.cancelledAt || ''
  };
}

function normalizeBlockerAudit(audit) {
  if (!audit || typeof audit !== 'object') return { fingerprint: '', count: 0 };
  return {
    fingerprint: String(audit.fingerprint || ''),
    count: Math.max(0, Number(audit.count || 0) || 0)
  };
}

function goalSettings() {
  if (!goalState.settings) goalState.settings = {};
  const settings = goalState.settings;
  if (settings.goalMaxTurns === undefined) settings.goalMaxTurns = 20;
  if (settings.goalMaxToolRounds === undefined) settings.goalMaxToolRounds = 15;
  if (settings.goalAutoContinue === undefined) settings.goalAutoContinue = true;
  if (settings.goalRequireVerification === undefined) settings.goalRequireVerification = true;
  if (settings.goalBlockedRepeatThreshold === undefined) settings.goalBlockedRepeatThreshold = 3;
  if (settings.goalModel === undefined) settings.goalModel = '';
  if (settings.goalSystemPrompt === undefined) settings.goalSystemPrompt = goalDefaultSystemPrompt();
  if (settings.goalTurnPrompt === undefined) settings.goalTurnPrompt = goalDefaultTurnPrompt();
  return settings;
}

function goalToast(message, ms) {
  GoalCoreUiService.toast(message, ms);
}

function persistGoals() {
  goalStore = normalizeGoalStore(goalStore);
  try {
    storage.set(GOAL_STORAGE_KEY, JSON.stringify(goalStore));
  } catch (e) {
    console.warn('[goal] persist failed:', e);
    goalToast('目标保存失败：' + e.message, 4000);
  }
}

function loadGoals() {
  goalSettings();
  try {
    const raw = storage.get(GOAL_STORAGE_KEY);
    goalStore = normalizeGoalStore(raw ? JSON.parse(raw) : null);
  } catch (e) {
    console.warn('[goal] load failed:', e);
    goalStore = normalizeGoalStore(null);
  }
  renderGoalPanel();
  updateGoalButton();
  return goalStore;
}

function saveGoals() {
  persistGoals();
  renderGoalPanel();
  updateGoalButton();
}

function listGoals() {
  return goalStore.goals.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function goalById(goalId) {
  const id = goalId || goalStore.activeGoalId || goalStore.selectedGoalId;
  return goalStore.goals.find(g => g.id === id) || null;
}

function activeGoal() {
  return goalById(goalStore.activeGoalId);
}

function selectedGoal() {
  return goalById(goalStore.selectedGoalId) || goalStore.goals[0] || null;
}

function setSelectedGoal(goalId) {
  if (!goalId || !goalById(goalId)) return null;
  goalStore.selectedGoalId = goalId;
  saveGoals();
  return goalById(goalId);
}

function makeGoalId() {
  return 'goal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function pushGoalEvent(goal, type, data = {}) {
  if (!goal) return;
  if (!Array.isArray(goal.events)) goal.events = [];
  goal.events.push({
    type,
    at: nowIso(),
    ...data
  });
  if (goal.events.length > 80) goal.events = goal.events.slice(-80);
  goal.updatedAt = nowIso();
}

function createGoalRecord(options = {}) {
  const objective = String(options.objective || '').trim();
  if (!objective) throw new Error('目标不能为空');
  const settings = goalSettings();
  const goal = normalizeGoalRecord({
    id: makeGoalId(),
    objective,
    status: 'active',
    tokenBudget: Math.max(0, Number(options.token_budget || options.tokenBudget || 0) || 0),
    tokenUsed: 0,
    turnCount: 0,
    maxTurns: Math.max(1, Number(options.max_turns || options.maxTurns || settings.goalMaxTurns || 20) || 20),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    events: []
  });
  pushGoalEvent(goal, 'created', { progress: 'Goal created.' });
  goalStore.goals.unshift(goal);
  goalStore.activeGoalId = goal.id;
  goalStore.selectedGoalId = goal.id;
  saveGoals();
  return goal;
}

function ensureGoalToolsEnabled() {
  if (!Array.isArray(goalState.tools)) goalState.tools = [];
  const builtins = Array.isArray(GoalCoreConfig.BUILTIN_TOOLS) ? GoalCoreConfig.BUILTIN_TOOLS : [];
  let added = 0;
  for (const tool of builtins) {
    if (!tool || !GOAL_TOOL_NAMES.has(tool.name)) continue;
    if (goalState.tools.some(t => t && t.name === tool.name)) continue;
    goalState.tools.push(JSON.parse(JSON.stringify(tool)));
    added++;
  }
  if (added > 0) {
    goalPersistTools();
    if (typeof renderToolList === 'function') renderToolList();
  }
  return added;
}

function statusLabel(status) {
  return {
    active: '进行中',
    paused: '已暂停',
    complete: '已完成',
    blocked: '已阻塞',
    cancelled: '已取消'
  }[status] || status;
}

function isGoalRunning(goalId) {
  const runner = GOAL_RUNNERS.get(goalId);
  return !!(runner && !runner.done);
}

function escapeGoalHtml(value) {
  if (typeof escapeHtml === 'function') return escapeHtml(value);
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clipGoalText(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

const goalChatNodeUpdateQueue = new Map();
let goalChatNodeUpdateScheduled = false;

function scheduleGoalChatNodeUpdate(chat, idx, mode = 'refresh') {
  if (!chat || !GoalCoreStateModule.isCurrentChat(chat.id)) return;
  if (!Number.isInteger(idx) || idx < 0) return;
  const key = `${chat.id}:${idx}`;
  const existing = goalChatNodeUpdateQueue.get(key);
  goalChatNodeUpdateQueue.set(key, {
    chat,
    idx,
    append: mode === 'append' || !!(existing && existing.append)
  });
  if (goalChatNodeUpdateScheduled) return;
  goalChatNodeUpdateScheduled = true;
  const flush = () => {
    goalChatNodeUpdateScheduled = false;
    const updates = Array.from(goalChatNodeUpdateQueue.values()).sort((a, b) => a.idx - b.idx);
    goalChatNodeUpdateQueue.clear();
    for (const item of updates) {
      if (!item.chat || !GoalCoreStateModule.isCurrentChat(item.chat.id)) continue;
      let ok = false;
      if (item.append && GoalCoreUiService.has('appendMsgNode')) {
        ok = GoalCoreUiService.appendMsgNode(item.idx, item.chat) !== false;
      } else if (GoalCoreUiService.has('refreshMsgNode')) {
        ok = GoalCoreUiService.refreshMsgNode(item.idx, item.chat) !== false;
      }
      if (!ok) GoalCoreUiService.renderMessages();
    }
    GoalCoreUiService.updateSendBtn();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
  else setTimeout(flush, 0);
}

function normalizeGoalToolArguments(args) {
  if (typeof args === 'string') return args || '{}';
  try { return JSON.stringify(args || {}, null, 2); }
  catch (e) { return '{}'; }
}

function goalObjectFromMaybeJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function goalFinalTextFromUpdateGoalArgs(args) {
  const obj = goalObjectFromMaybeJson(args);
  const finalSummary = String(obj.final_summary || obj.finalSummary || '').trim();
  const progress = String(obj.progress || '').trim();
  const evidence = String(obj.evidence || '').trim();
  const nextStep = String(obj.next_step || obj.nextStep || '').trim();
  if (normalizeGoalStatus(obj.status) === 'complete') {
    return finalSummary || evidence || progress;
  }
  return [progress, evidence ? '证据：' + evidence : '', nextStep ? '下一步：' + nextStep : '']
    .filter(Boolean)
    .join('\n\n');
}

function goalFinalTextFromUpdateGoalResult(content) {
  const obj = goalObjectFromMaybeJson(content);
  const goal = obj && obj.goal && typeof obj.goal === 'object' ? obj.goal : null;
  if (!goal) return '';
  return goalTerminalFinalText(goal) || String(goal.summary || goal.lastResult || goal.nextStep || '').trim();
}

function goalTerminalFinalText(goal) {
  if (!goal) return '';
  if (goal.status !== 'complete') {
    return String(goal.summary || goal.lastResult || goal.nextStep || '').trim();
  }
  return String(goal.summary || goal.lastResult || '').trim();
}

function createGoalChatRecorder(chat, goalId, turnNo) {
  const recorder = {
    assistant: null,
    assistantIdx: -1,
    finalTextCandidate: '',
    finalAssistantIdx: -1,
    hasToolCalls: false
  };

  const appendMessage = (message) => {
    const now = Date.now();
    const msg = {
      ...message,
      createdAt: message.createdAt || now,
      goalId,
      _goalTurn: turnNo
    };
    chat.messages.push(msg);
    const idx = chat.messages.length - 1;
    goalSaveData();
    scheduleGoalChatNodeUpdate(chat, idx, 'append');
    return msg;
  };

  const rememberFinalText = (text) => {
    const value = String(text || '').trim();
    if (value) recorder.finalTextCandidate = value;
  };

  const hasFinalAssistant = () => {
    const assistant = recorder.assistant;
    return !!(assistant
      && assistant.role === 'assistant'
      && !(assistant.tool_calls && assistant.tool_calls.length)
      && String(assistant.content || '').trim());
  };

  const appendFinalAssistant = (text) => {
    const content = String(text || '').trim();
    if (!content || hasFinalAssistant()) return null;
    const now = Date.now();
    const msg = appendMessage({
      role: 'assistant',
      content,
      _startTime: now,
      _firstTokenAt: now,
      _endTime: now,
      _goalFinal: true
    });
    recorder.assistant = msg;
    recorder.assistantIdx = chat.messages.length - 1;
    recorder.finalAssistantIdx = recorder.assistantIdx;
    return msg;
  };

  const appendGoalTerminalFinalAssistant = () => {
    const goal = goalById(goalId);
    if (!goal || goal.status !== 'complete') return null;
    return appendFinalAssistant(recorder.finalTextCandidate || goalTerminalFinalText(goal));
  };

  const appendGoalTurnFinalAssistant = () => {
    const goal = goalById(goalId);
    return appendFinalAssistant(recorder.finalTextCandidate || goalTerminalFinalText(goal));
  };

  const ensureAssistant = () => {
    if (recorder.assistant) return recorder.assistant;
    const now = Date.now();
    recorder.assistant = appendMessage({
      role: 'assistant',
      content: '',
      _startTime: now
    });
    recorder.assistantIdx = chat.messages.length - 1;
    return recorder.assistant;
  };

  const finishAssistant = () => {
    if (!recorder.assistant || recorder.assistant._endTime) return;
    recorder.assistant._endTime = Date.now();
    scheduleGoalChatNodeUpdate(chat, recorder.assistantIdx, 'refresh');
  };

  const startRound = () => {
    finishAssistant();
    recorder.assistant = null;
    recorder.assistantIdx = -1;
    recorder.hasToolCalls = false;
  };

  return {
    handle(event) {
      if (!event || !chat || !Array.isArray(chat.messages)) return;
      if (event.type === 'round_start') {
        startRound();
        return;
      }
      if (event.type === 'text_delta' && event.text) {
        const assistant = ensureAssistant();
        if (!assistant._firstTokenAt) assistant._firstTokenAt = Date.now();
        assistant.content = String(assistant.content || '') + String(event.text || '');
        scheduleGoalChatNodeUpdate(chat, recorder.assistantIdx, 'refresh');
        return;
      }
      if (event.type === 'tool_call') {
        const assistant = ensureAssistant();
        if (event.name === 'update_goal') {
          rememberFinalText(goalFinalTextFromUpdateGoalArgs(event.args));
        }
        if (!Array.isArray(assistant.tool_calls)) assistant.tool_calls = [];
        if (!assistant.tool_calls.some(tc => tc && tc.id === event.id)) {
          assistant.tool_calls.push({
            id: event.id,
            type: 'function',
            function: {
              name: event.name || '',
              arguments: normalizeGoalToolArguments(event.args)
            }
          });
        }
        recorder.hasToolCalls = true;
        finishAssistant();
        return;
      }
      if (event.type === 'tool_result') {
        const now = Date.now();
        appendMessage({
          role: 'tool',
          tool_call_id: event.id,
          name: event.name || '',
          content: event.content || '',
          status: event.ok === false ? 'error' : 'success',
          _startTime: now,
          _endTime: now
        });
        if (event.name === 'update_goal') {
          rememberFinalText(goalFinalTextFromUpdateGoalResult(event.content));
          appendGoalTerminalFinalAssistant();
        }
        return;
      }
      if (event.type === 'round_end') {
        const assistant = recorder.assistant;
        if (assistant && event.text && !String(assistant.content || '').trim()) {
          assistant.content = String(event.text || '');
          scheduleGoalChatNodeUpdate(chat, recorder.assistantIdx, 'refresh');
        }
        finishAssistant();
        return;
      }
      if (event.type === 'done') {
        rememberFinalText(event.finalText);
        finishAssistant();
        if (!appendFinalAssistant(event.finalText)) appendGoalTurnFinalAssistant();
      }
    },
    finish() {
      finishAssistant();
      appendGoalTurnFinalAssistant();
      goalSaveData();
      if (recorder.assistantIdx >= 0) scheduleGoalChatNodeUpdate(chat, recorder.assistantIdx, 'refresh');
    }
  };
}

function renderGoalPanel() {
  const listEl = document.getElementById('goalList');
  const detailEl = document.getElementById('goalDetail');
  if (!listEl && !detailEl) return;
  const goals = listGoals();
  if (listEl) {
    if (!goals.length) {
      listEl.innerHTML = '<div class="goal-empty">还没有目标。写下目标后点击“创建并继续”。</div>';
    } else {
      listEl.innerHTML = goals.map(goal => {
        const selected = goal.id === goalStore.selectedGoalId;
        const running = isGoalRunning(goal.id);
        return `
          <div class="goal-item ${selected ? 'selected' : ''} ${escapeGoalHtml(goal.status)}" role="button" tabindex="0" data-action="valueClick" data-keydown-action="goalCardSelect" data-handler="selectGoalById" data-value="${escapeGoalHtml(goal.id)}">
            <div class="goal-item-main">
              <span class="goal-item-title">${escapeGoalHtml(clipGoalText(goal.objective, 76))}</span>
              <span class="goal-item-meta">${statusLabel(goal.status)} · ${goal.turnCount}/${goal.maxTurns} 轮${running ? ' · 运行中' : ''}</span>
            </div>
            <div class="goal-item-actions">
              <button class="btn" type="button" data-action="valueClick" data-handler="continueGoalById" data-value="${escapeGoalHtml(goal.id)}">继续</button>
              <button class="btn" type="button" data-action="valueClick" data-handler="pauseGoalById" data-value="${escapeGoalHtml(goal.id)}">暂停</button>
              <button class="btn btn-warning" type="button" data-action="valueClick" data-handler="cancelGoalById" data-value="${escapeGoalHtml(goal.id)}">取消</button>
              <button class="btn goal-danger-btn" type="button" data-action="valueClick" data-handler="deleteGoalById" data-value="${escapeGoalHtml(goal.id)}">删除</button>
            </div>
          </div>`;
      }).join('');
    }
  }
  if (detailEl) {
    const goal = selectedGoal();
    if (!goal) {
      detailEl.innerHTML = '<div class="goal-empty">选择一个目标查看进度。</div>';
    } else {
      const running = isGoalRunning(goal.id);
      const recentEvents = (goal.events || []).slice(-6).reverse();
      detailEl.innerHTML = `
        <div class="goal-detail-head">
          <div>
            <div class="goal-detail-title">${escapeGoalHtml(goal.objective)}</div>
            <div class="goal-detail-meta">${statusLabel(goal.status)}${running ? ' · 正在运行' : ''} · 更新 ${escapeGoalHtml(new Date(goal.updatedAt).toLocaleString())}</div>
          </div>
          <span class="goal-status-pill ${escapeGoalHtml(goal.status)}">${statusLabel(goal.status)}</span>
        </div>
        <div class="goal-stat-grid">
          <div><strong>${goal.turnCount}</strong><span>已用轮次</span></div>
          <div><strong>${goal.maxTurns}</strong><span>轮次上限</span></div>
          <div><strong>${goalRecordedTokenUsed(goal)}</strong><span>已记 token</span></div>
          <div><strong>${goal.tokenBudget || '不限'}</strong><span>token 预算</span></div>
        </div>
        <div class="goal-detail-block">
          <label>最近结果</label>
          <p>${escapeGoalHtml(goal.lastResult || goal.summary || '暂无结果。')}</p>
        </div>
        <div class="goal-detail-block">
          <label>下一步</label>
          <p>${escapeGoalHtml(goal.nextStep || '等待下一轮决定。')}</p>
        </div>
        <div class="goal-detail-block">
          <label>进度账本</label>
          <div class="goal-events">
            ${recentEvents.length ? recentEvents.map(ev => `
              <div class="goal-event">
                <span>${escapeGoalHtml(new Date(ev.at).toLocaleTimeString())}</span>
                <b>${escapeGoalHtml(ev.type)}</b>
                <p>${escapeGoalHtml(ev.progress || ev.evidence || ev.reason || ev.result || '')}</p>
              </div>`).join('') : '<div class="goal-empty compact">还没有进度事件。</div>'}
          </div>
        </div>`;
    }
  }
  const objectiveInput = document.getElementById('goalObjectiveInput');
  const budgetInput = document.getElementById('goalBudgetInput');
  const maxTurnsInput = document.getElementById('goalMaxTurnsInput');
  const current = selectedGoal();
  if (objectiveInput && current && document.activeElement !== objectiveInput) objectiveInput.value = current.objective || '';
  if (budgetInput && current && document.activeElement !== budgetInput) budgetInput.value = current.tokenBudget || '';
  if (maxTurnsInput && current && document.activeElement !== maxTurnsInput) maxTurnsInput.value = current.maxTurns || goalSettings().goalMaxTurns || 20;
}

function updateGoalButton() {
  const btn = document.getElementById('goalBtn');
  if (!btn) return;
  btn.classList.remove('goal-active');
  btn.title = '目标管理';
}

function openGoalPanel() {
  loadGoals();
  const modal = document.getElementById('goalModal');
  if (modal) modal.classList.add('show');
  renderGoalPanel();
}

function closeGoalPanel() {
  const modal = document.getElementById('goalModal');
  if (modal) modal.classList.remove('show');
}

function readGoalForm() {
  const objective = (document.getElementById('goalObjectiveInput') || {}).value || '';
  const tokenBudget = Number((document.getElementById('goalBudgetInput') || {}).value || 0) || 0;
  const maxTurns = Number((document.getElementById('goalMaxTurnsInput') || {}).value || goalSettings().goalMaxTurns || 20) || 20;
  return { objective: objective.trim(), tokenBudget, maxTurns };
}

function createGoalFromUi() {
  try {
    const form = readGoalForm();
    const goal = createGoalRecord(form);
    goalToast('目标已创建');
    continueGoal(goal.id);
  } catch (e) {
    goalToast('创建目标失败：' + e.message, 4000);
  }
}

function saveGoalEditFromUi() {
  const goal = selectedGoal();
  if (!goal) return goalToast('请先选择目标');
  const form = readGoalForm();
  if (!form.objective) return goalToast('目标不能为空');
  goal.objective = form.objective;
  goal.tokenBudget = Math.max(0, form.tokenBudget || 0);
  goal.maxTurns = Math.max(1, form.maxTurns || goalSettings().goalMaxTurns || 20);
  pushGoalEvent(goal, 'edited', { progress: 'Goal objective/settings edited.' });
  saveGoals();
  goalToast('目标已保存');
}

function selectGoalById(goalId) {
  setSelectedGoal(goalId);
}

function continueActiveGoal() {
  const goal = selectedGoal() || activeGoal();
  if (!goal) return createGoalFromUi();
  return continueGoal(goal.id);
}

function pauseActiveGoal() {
  const goal = selectedGoal() || activeGoal();
  if (!goal) return;
  pauseGoal(goal.id);
}

function cancelActiveGoal() {
  const goal = selectedGoal() || activeGoal();
  if (!goal) return;
  cancelGoal(goal.id);
}

function deleteActiveGoal() {
  const goal = selectedGoal() || activeGoal();
  if (!goal) return goalToast('请先选择目标');
  deleteGoal(goal.id);
}

function continueGoalById(goalId) {
  return continueGoal(goalId);
}

function pauseGoalById(goalId) {
  pauseGoal(goalId);
}

function cancelGoalById(goalId) {
  cancelGoal(goalId);
}

function deleteGoalById(goalId) {
  deleteGoal(goalId);
}

function ensureGoalChat(goal) {
  let chat = goal.chatId ? goalChatById(goal.chatId) : null;
  if (chat) {
    goalState.currentId = chat.id;
    goalSaveData();
    GoalCoreUiService.renderChatList();
    GoalCoreUiService.renderMessages();
    GoalCoreUiService.updateSendBtn();
    return chat;
  }
  const id = 'goal_' + Date.now();
  chat = {
    id,
    title: '目标：' + clipGoalText(goal.objective, 28),
    messages: [
      {
        role: 'user',
        content: '目标：' + goal.objective,
        createdAt: Date.now()
      }
    ],
    createdAt: Date.now(),
    goalId: goal.id
  };
  goalState.chats.unshift(chat);
  goal.chatId = id;
  goalState.currentId = id;
  goalSaveData();
  GoalCoreUiService.renderChatList();
  GoalCoreUiService.renderMessages();
  GoalCoreUiService.updateSendBtn();
  return chat;
}

function buildGoalTurnPrompt(goal) {
  const settings = goalSettings();
  const template = settings.goalTurnPrompt || goalDefaultTurnPrompt();
  const values = {
    objective: goal.objective,
    status: goal.status,
    turn: String(goal.turnCount + 1),
    maxTurns: String(goal.maxTurns),
    tokenUsed: String(goalRecordedTokenUsed(goal)),
    tokenBudget: goal.tokenBudget ? String(goal.tokenBudget) : 'unlimited',
    summary: goal.summary || '',
    lastResult: goal.lastResult || '',
    nextStep: goal.nextStep || '',
    blockerCount: String(goal.blockerAudit && goal.blockerAudit.count || 0)
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] !== undefined ? values[key] : '');
}

function goalUsageNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function usageTokenCount(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const src = usage.usageMetadata || usage.usage || usage;
  const inputTokens = goalUsageNumber(
    src.input_tokens,
    src.prompt_tokens,
    src.inputTokens,
    src.promptTokens,
    src.promptTokenCount
  );
  const outputTokens = goalUsageNumber(
    src.output_tokens,
    src.completion_tokens,
    src.outputTokens,
    src.completionTokens,
    src.candidatesTokenCount
  );
  return goalUsageNumber(
    src.total_tokens,
    src.totalTokens,
    src.totalTokenCount,
    inputTokens + outputTokens
  );
}

function goalChatRecordedTokenTotal(chat) {
  const stats = chat && chat.tokenStats;
  if (!stats || typeof stats !== 'object') return 0;
  return goalUsageNumber(Number(stats.inputTokens || 0) + Number(stats.outputTokens || 0));
}

function goalRecordedTokenUsed(goal) {
  if (!goal) return 0;
  return Math.max(Number(goal.tokenUsed || 0) || 0, goalChatRecordedTokenTotal(goalChatById(goal.chatId)));
}

function syncGoalTokenUsageFromChat(goal) {
  if (!goal) return 0;
  const recorded = goalRecordedTokenUsed(goal);
  if (recorded > (Number(goal.tokenUsed || 0) || 0)) goal.tokenUsed = recorded;
  return recorded;
}

function goalEstimateTextTokens(text) {
  if (typeof estimateTokens === 'function') return Math.max(0, Number(estimateTokens(text)) || 0);
  let value = '';
  if (typeof text === 'string') value = text;
  else {
    try { value = JSON.stringify(text || ''); }
    catch (e) { value = String(text || ''); }
  }
  return Math.ceil(value.length / 3);
}

function goalEstimateMessageTokens(message) {
  if (typeof estimateMessageTokens === 'function') return Math.max(0, Number(estimateMessageTokens(message)) || 0);
  if (!message || typeof message !== 'object') return 0;
  return 4
    + goalEstimateTextTokens(message.role || '')
    + goalEstimateTextTokens(message.content || '')
    + goalEstimateTextTokens(message.name || '')
    + goalEstimateTextTokens(message.tool_call_id || '')
    + goalEstimateTextTokens(message.tool_calls || '');
}

function goalEstimateTurnTokens(systemPrompt, turnPrompt, chat, messageStartIdx) {
  let total = goalEstimateTextTokens(systemPrompt) + goalEstimateTextTokens(turnPrompt);
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : [];
  for (let i = Math.max(0, Number(messageStartIdx || 0)); i < messages.length; i++) {
    total += goalEstimateMessageTokens(messages[i]);
  }
  return Math.max(0, Math.ceil(total));
}

function goalToolCallName(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') return '';
  return String((toolCall.function && toolCall.function.name) || toolCall.name || '').trim();
}

function inspectGoalProtocol(messages, progressProtocol) {
  const calls = [];
  for (const msg of Array.isArray(messages) ? messages : []) {
    const toolCalls = Array.isArray(msg && msg.tool_calls) ? msg.tool_calls : [];
    for (const toolCall of toolCalls) {
      const name = goalToolCallName(toolCall);
      if (name) calls.push(name);
    }
  }
  if (!calls.length && progressProtocol && Array.isArray(progressProtocol.toolCalls)) {
    calls.push(...progressProtocol.toolCalls);
  }
  return {
    calls,
    firstTool: calls[0] || '',
    gotGoalFirst: calls[0] === 'get_goal',
    gotGoal: calls.includes('get_goal'),
    updateGoalCalled: calls.includes('update_goal')
  };
}

function recordGoalProtocolEvent(protocol, event) {
  if (!protocol || !event || event.type !== 'tool_call') return;
  if (!Array.isArray(protocol.toolCalls)) protocol.toolCalls = [];
  if (event.name) protocol.toolCalls.push(String(event.name));
}

function applyGoalProtocolAudit(goal, report, finalText) {
  if (!goal || goal.status !== 'active') return false;
  const issues = [];
  if (!report.gotGoalFirst) {
    issues.push(report.firstTool
      ? 'First tool call was ' + report.firstTool + ', expected get_goal.'
      : 'No tool call was made; expected get_goal first.');
  }
  if (!report.updateGoalCalled) {
    issues.push('update_goal was not called before the turn ended.');
  }
  if (!issues.length) return false;

  goal.status = 'paused';
  goal.lastError = 'Goal protocol violation: ' + issues.join(' ');
  if (finalText && !goal.summary) goal.summary = clipGoalText(finalText, 500);
  goal.nextStep = 'Resume and follow the goal protocol: call get_goal first, do one verifiable step, then call update_goal.';
  pushGoalEvent(goal, 'protocol_pause', { reason: goal.lastError, result: clipGoalText(finalText || '', 500) });
  return true;
}

async function continueGoal(goalId) {
  const goal = goalById(goalId);
  if (!goal) return goalToast('未找到目标');
  if (GOAL_TERMINAL_STATUSES.has(goal.status)) return goalToast('目标已结束，不能继续');
  if (isGoalRunning(goal.id)) return goalToast('目标正在运行');

  goal.status = 'active';
  goalStore.activeGoalId = goal.id;
  pushGoalEvent(goal, 'continued', { progress: 'Goal runner continued.' });
  saveGoals();
  ensureGoalToolsEnabled();

  const chat = ensureGoalChat(goal);
  const controller = new AbortController();
  const runner = { controller, done: false };
  GOAL_RUNNERS.set(goal.id, runner);
  goalBeginChatTask(chat.id, controller, { resetStop: true });
  goalSetChatTaskMode(chat.id, 'goal', { goalId: goal.id });
  updateGoalButton();

  try {
    let keepGoing = true;
    while (keepGoing) {
      if (controller.signal.aborted) break;
      const freshGoal = goalById(goal.id);
      if (!freshGoal || freshGoal.status !== 'active') break;
      if (freshGoal.turnCount >= freshGoal.maxTurns) {
        freshGoal.status = 'paused';
        freshGoal.lastError = 'Reached goal turn limit.';
        pushGoalEvent(freshGoal, 'paused', { reason: freshGoal.lastError });
        saveGoals();
        break;
      }

      const turnNo = freshGoal.turnCount + 1;
      freshGoal.turnCount = turnNo;
      pushGoalEvent(freshGoal, 'turn_start', { progress: 'Starting goal turn ' + turnNo + '.' });
      saveGoals();

      chat.messages.push({
        role: 'user',
        content: '目标第 ' + turnNo + ' 轮：继续推进「' + freshGoal.objective + '」',
        createdAt: Date.now(),
        goalId: freshGoal.id,
        _goalTurn: turnNo
      });
      const userMsgIdx = chat.messages.length - 1;
      goalSaveData();
      GoalCoreUiService.renderChatList();
      scheduleGoalChatNodeUpdate(chat, userMsgIdx, 'append');
      GoalCoreUiService.updateSendBtn();

      const protocol = { toolCalls: [] };
      const chatRecorder = createGoalChatRecorder(chat, freshGoal.id, turnNo);
      const tokenStatsBefore = goalChatRecordedTokenTotal(chat);
      const messageCountBeforeRun = chat.messages.length;
      const turnPrompt = buildGoalTurnPrompt(freshGoal);
      const systemPrompt = goalSettings().goalSystemPrompt || goalDefaultSystemPrompt();
      let result;
      try {
        result = await GoalCoreOrchestrationService.runAgentLoop({
          initialMessages: [{ role: 'user', content: turnPrompt }],
          systemPrompt,
          model: goalSettings().goalModel || goalState.settings.currentModel,
          maxRounds: Math.max(0, Number(goalSettings().goalMaxToolRounds || goalState.settings.maxToolRounds || 15) || 15),
          signal: controller.signal,
          useTools: true,
          stream: goalState.settings.stream !== false,
          chatId: chat.id,
          chat,
          toolContext: { goalId: freshGoal.id, chatId: chat.id, chat },
          isStopped: () => {
            const task = GoalCoreStateModule.chatTaskById(chat.id);
            const latest = goalById(freshGoal.id);
            return controller.signal.aborted || !!(task && task.stopRequested) || !latest || latest.status !== 'active';
          },
          onProgress: event => {
            recordGoalProtocolEvent(protocol, event);
            recordGoalLoopProgress(freshGoal.id, event);
            chatRecorder.handle(event);
          }
        });
      } finally {
        chatRecorder.finish();
      }

      const latestGoal = goalById(goal.id);
      if (!latestGoal) break;
      const finalText = String((result && result.finalText) || '').trim();
      const tokenUsed = usageTokenCount(result && result.usage)
        || Math.max(0, goalChatRecordedTokenTotal(chat) - tokenStatsBefore)
        || goalEstimateTurnTokens(systemPrompt, turnPrompt, chat, messageCountBeforeRun);
      if (tokenUsed) latestGoal.tokenUsed += tokenUsed;
      syncGoalTokenUsageFromChat(latestGoal);
      latestGoal.lastResult = finalText || latestGoal.lastResult;
      pushGoalEvent(latestGoal, 'turn_result', { result: clipGoalText(finalText || 'No final text.', 500) });
      const protocolViolation = applyGoalProtocolAudit(latestGoal, inspectGoalProtocol(result && result.messages, protocol), finalText);

      if (!protocolViolation && latestGoal.tokenBudget && latestGoal.tokenUsed >= latestGoal.tokenBudget && latestGoal.status === 'active') {
        latestGoal.status = 'paused';
        latestGoal.lastError = 'Token budget reached; goal paused without marking complete.';
        pushGoalEvent(latestGoal, 'budget_pause', { reason: latestGoal.lastError });
      }

      saveGoals();
      goalSaveData();
      GoalCoreUiService.renderChatList();
      GoalCoreUiService.updateSendBtn();

      keepGoing = !!goalSettings().goalAutoContinue
        && latestGoal.status === 'active'
        && latestGoal.turnCount < latestGoal.maxTurns
        && !controller.signal.aborted;
    }
  } catch (e) {
    const latestGoal = goalById(goal.id);
    let stoppedByGoalStatus = false;
    if (latestGoal) {
      stoppedByGoalStatus = !!(e && e.name === 'AbortError' && latestGoal.status && latestGoal.status !== 'active');
      if (controller.signal.aborted && latestGoal.status === 'active') latestGoal.status = 'paused';
      latestGoal.lastError = e && e.message ? e.message : String(e);
      if (!stoppedByGoalStatus) pushGoalEvent(latestGoal, controller.signal.aborted ? 'paused' : 'error', { reason: latestGoal.lastError });
      saveGoals();
    }
    if (!controller.signal.aborted && !stoppedByGoalStatus) goalToast('Goal run failed: ' + (e && e.message ? e.message : e), 5000);
  } finally {
    runner.done = true;
    GOAL_RUNNERS.delete(goal.id);
    goalClearChatTask(chat.id);
    updateGoalButton();
    renderGoalPanel();
    GoalCoreUiService.updateSendBtn();
  }
}

function recordGoalLoopProgress(goalId, event) {
  if (!event || !goalId) return;
  if (event.type !== 'tool_call' && event.type !== 'tool_result') return;
  const goal = goalById(goalId);
  if (!goal) return;
  if (event.name === 'get_goal' || event.name === 'update_goal' || event.name === 'create_goal') {
    pushGoalEvent(goal, event.type, {
      progress: event.name,
      evidence: event.type === 'tool_result' ? clipGoalText(event.content || '', 220) : ''
    });
    persistGoals();
  }
}

function pauseGoal(goalId) {
  const goal = goalById(goalId);
  if (!goal || GOAL_TERMINAL_STATUSES.has(goal.status)) return;
  const runner = GOAL_RUNNERS.get(goal.id);
  if (runner && runner.controller) {
    try { runner.controller.abort(); } catch (e) {}
  }
  if (goal.chatId) goalRequestStopChatTask(goal.chatId);
  goal.status = 'paused';
  pushGoalEvent(goal, 'paused', { reason: 'Paused by user.' });
  saveGoals();
}

function cancelGoal(goalId) {
  const goal = goalById(goalId);
  if (!goal || goal.status === 'cancelled') return;
  const runner = GOAL_RUNNERS.get(goal.id);
  if (runner && runner.controller) {
    try { runner.controller.abort(); } catch (e) {}
  }
  if (goal.chatId) goalRequestStopChatTask(goal.chatId);
  goal.status = 'cancelled';
  goal.cancelledAt = nowIso();
  pushGoalEvent(goal, 'cancelled', { reason: 'Cancelled by user.' });
  saveGoals();
}

function deleteGoal(goalId) {
  const goal = goalById(goalId);
  if (!goal) return;
  const label = clipGoalText(goal.objective, 90);
  if (typeof confirm === 'function' && !confirm('删除这个目标？\n\n' + label + '\n\n关联对话会保留，只有目标记录会被移除。')) return;

  const runner = GOAL_RUNNERS.get(goal.id);
  if (runner && runner.controller) {
    try { runner.controller.abort(); } catch (e) {}
  }
  GOAL_RUNNERS.delete(goal.id);
  if (goal.chatId) goalRequestStopChatTask(goal.chatId);

  goalStore.goals = goalStore.goals.filter(item => item && item.id !== goal.id);
  const nextActive = goalStore.goals.find(item => item && !GOAL_TERMINAL_STATUSES.has(item.status))
    || goalStore.goals[0]
    || null;
  if (goalStore.activeGoalId === goal.id) goalStore.activeGoalId = nextActive ? nextActive.id : '';
  if (goalStore.selectedGoalId === goal.id) goalStore.selectedGoalId = nextActive ? nextActive.id : goalStore.activeGoalId;
  saveGoals();
  goalToast('目标已删除');
}

function normalizeBlockerReason(reason) {
  return String(reason || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
}

function createGoal(args = {}, toolContext = {}) {
  const goal = createGoalRecord(args || {});
  return {
    ok: true,
    goal: summarizeGoalForTool(goal),
    contextChatId: toolContext && toolContext.chatId || ''
  };
}

function getGoal(args = {}, toolContext = {}) {
  loadGoals();
  const id = args.goal_id || args.goalId || (toolContext && toolContext.goalId) || goalStore.activeGoalId || goalStore.selectedGoalId;
  const goal = goalById(id);
  if (!goal) return { ok: false, error: 'No active goal.' };
  pushGoalEvent(goal, 'get_goal', { progress: 'Goal context read.' });
  saveGoals();
  return {
    ok: true,
    goal: summarizeGoalForTool(goal),
    settings: {
      blockedRepeatThreshold: Math.max(1, Number(goalSettings().goalBlockedRepeatThreshold || 3) || 3),
      requireVerification: goalSettings().goalRequireVerification !== false,
      instruction: 'Do one minimal verifiable step. Do not mark complete unless the full objective is satisfied.'
    }
  };
}

function updateGoal(args = {}, toolContext = {}) {
  loadGoals();
  const id = args.goal_id || args.goalId || (toolContext && toolContext.goalId) || goalStore.activeGoalId || goalStore.selectedGoalId;
  const goal = goalById(id);
  if (!goal) return { ok: false, error: 'No active goal.' };

  const status = normalizeGoalStatus(args.status || goal.status);
  const progress = String(args.progress || '').trim();
  const evidence = String(args.evidence || '').trim();
  const nextStep = String(args.next_step || args.nextStep || '').trim();
  const finalSummary = String(args.final_summary || args.finalSummary || '').trim();
  const blockerReason = String(args.blocker_reason || args.blockerReason || args.reason || '').trim();

  if (progress || evidence || nextStep) {
    pushGoalEvent(goal, 'progress', { progress, evidence, next_step: nextStep });
  }
  if (progress) goal.summary = progress;
  if (evidence) goal.lastResult = evidence;
  if (nextStep) goal.nextStep = nextStep;

  if (status === 'complete') {
    if (goalSettings().goalRequireVerification !== false && !evidence && !finalSummary) {
      pushGoalEvent(goal, 'complete_rejected', { reason: 'Missing evidence or final_summary.' });
      saveGoals();
      return {
        ok: false,
        status: goal.status,
        error: 'complete requires evidence or final_summary; token/turn budget is not completion evidence.',
        goal: summarizeGoalForTool(goal)
      };
    }
    goal.status = 'complete';
    goal.completedAt = nowIso();
    goal.summary = finalSummary || progress || goal.summary;
    goal.lastResult = evidence || finalSummary || goal.lastResult;
    pushGoalEvent(goal, 'complete', { progress: goal.summary, evidence: goal.lastResult });
  } else if (status === 'blocked') {
    const fingerprint = normalizeBlockerReason(blockerReason || progress || evidence || 'blocked');
    const threshold = Math.max(1, Number(goalSettings().goalBlockedRepeatThreshold || 3) || 3);
    if (goal.blockerAudit.fingerprint === fingerprint) goal.blockerAudit.count += 1;
    else goal.blockerAudit = { fingerprint, count: 1 };
    pushGoalEvent(goal, 'blocked_audit', {
      reason: blockerReason || progress || 'Blocked.',
      count: goal.blockerAudit.count
    });
    if (goal.blockerAudit.count >= threshold) {
      goal.status = 'blocked';
      goal.blockedAt = nowIso();
      goal.lastError = blockerReason || progress || 'Blocked.';
      pushGoalEvent(goal, 'blocked', { reason: goal.lastError });
    } else {
      goal.status = 'active';
    }
  } else if (status === 'paused') {
    goal.status = 'paused';
    pushGoalEvent(goal, 'paused', { reason: progress || 'Paused by tool.' });
  } else if (status === 'cancelled') {
    goal.status = 'cancelled';
    goal.cancelledAt = nowIso();
    pushGoalEvent(goal, 'cancelled', { reason: progress || 'Cancelled by tool.' });
  } else if (!GOAL_TERMINAL_STATUSES.has(goal.status)) {
    goal.status = 'active';
  }

  saveGoals();
  return {
    ok: true,
    goal: summarizeGoalForTool(goal),
    blockedAudit: goal.blockerAudit
  };
}

function summarizeGoalForTool(goal) {
  return {
    id: goal.id,
    objective: goal.objective,
    status: goal.status,
    turnCount: goal.turnCount,
    maxTurns: goal.maxTurns,
    tokenBudget: goal.tokenBudget,
    tokenUsed: goalRecordedTokenUsed(goal),
    summary: goal.summary,
    lastResult: goal.lastResult,
    nextStep: goal.nextStep,
    lastError: goal.lastError,
    blockerAudit: goal.blockerAudit,
    recentEvents: (goal.events || []).slice(-8)
  };
}

function openGoalSettings() {
  goalSettings();
  const s = goalState.settings;
  setGoalField('goalSettingAutoContinue', !!s.goalAutoContinue, 'checked');
  setGoalField('goalSettingRequireVerification', s.goalRequireVerification !== false, 'checked');
  setGoalField('goalSettingMaxTurns', s.goalMaxTurns || 20);
  setGoalField('goalSettingMaxToolRounds', s.goalMaxToolRounds || 15);
  setGoalField('goalSettingBlockedThreshold', s.goalBlockedRepeatThreshold || 3);
  setGoalField('goalSettingModel', s.goalModel || '');
  setGoalField('goalSettingSystemPrompt', s.goalSystemPrompt || goalDefaultSystemPrompt());
  setGoalField('goalSettingTurnPrompt', s.goalTurnPrompt || goalDefaultTurnPrompt());
  const modal = document.getElementById('goalSettingsModal');
  if (modal) modal.classList.add('show');
}

function closeGoalSettings() {
  const modal = document.getElementById('goalSettingsModal');
  if (modal) modal.classList.remove('show');
}

function setGoalField(id, value, prop = 'value') {
  const el = document.getElementById(id);
  if (!el) return;
  el[prop] = value;
}

function readGoalField(id, fallback = '') {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
}

function saveGoalSettings() {
  const s = goalSettings();
  const autoEl = document.getElementById('goalSettingAutoContinue');
  const verifyEl = document.getElementById('goalSettingRequireVerification');
  s.goalAutoContinue = autoEl ? !!autoEl.checked : !!s.goalAutoContinue;
  s.goalRequireVerification = verifyEl ? !!verifyEl.checked : s.goalRequireVerification !== false;
  s.goalMaxTurns = Math.max(1, Number(readGoalField('goalSettingMaxTurns', s.goalMaxTurns)) || 20);
  s.goalMaxToolRounds = Math.max(0, Number(readGoalField('goalSettingMaxToolRounds', s.goalMaxToolRounds)) || 15);
  s.goalBlockedRepeatThreshold = Math.max(1, Number(readGoalField('goalSettingBlockedThreshold', s.goalBlockedRepeatThreshold)) || 3);
  s.goalModel = String(readGoalField('goalSettingModel', s.goalModel || '') || '').trim();
  s.goalSystemPrompt = String(readGoalField('goalSettingSystemPrompt', s.goalSystemPrompt || goalDefaultSystemPrompt()) || '').trim() || goalDefaultSystemPrompt();
  s.goalTurnPrompt = String(readGoalField('goalSettingTurnPrompt', s.goalTurnPrompt || goalDefaultTurnPrompt()) || '').trim() || goalDefaultTurnPrompt();
  goalPersistSettings();
  closeGoalSettings();
  goalToast('目标模式设置已保存');
}

function resetGoalPrompts() {
  setGoalField('goalSettingSystemPrompt', goalDefaultSystemPrompt());
  setGoalField('goalSettingTurnPrompt', goalDefaultTurnPrompt());
}

window.loadGoals = loadGoals;
window.openGoalPanel = openGoalPanel;
window.closeGoalPanel = closeGoalPanel;
window.createGoalFromUi = createGoalFromUi;
window.continueActiveGoal = continueActiveGoal;
window.pauseActiveGoal = pauseActiveGoal;
window.cancelActiveGoal = cancelActiveGoal;
window.deleteActiveGoal = deleteActiveGoal;
window.saveGoalEditFromUi = saveGoalEditFromUi;
window.selectGoalById = selectGoalById;
window.continueGoalById = continueGoalById;
window.pauseGoalById = pauseGoalById;
window.cancelGoalById = cancelGoalById;
window.deleteGoalById = deleteGoalById;
window.openGoalSettings = openGoalSettings;
window.closeGoalSettings = closeGoalSettings;
window.saveGoalSettings = saveGoalSettings;
window.resetGoalPrompts = resetGoalPrompts;
window.createGoal = createGoal;
window.getGoal = getGoal;
window.updateGoal = updateGoal;

window.AgentApp.define('goalCore', {
  loadGoals,
  saveGoals,
  listGoals,
  activeGoal,
  selectedGoal,
  openGoalPanel,
  closeGoalPanel,
  createGoalFromUi,
  continueGoal,
  continueActiveGoal,
  pauseGoal,
  pauseActiveGoal,
  cancelGoal,
  cancelActiveGoal,
  deleteGoal,
  deleteActiveGoal,
  deleteGoalById,
  saveGoalEditFromUi,
  openGoalSettings,
  closeGoalSettings,
  saveGoalSettings,
  resetGoalPrompts,
  createGoal,
  getGoal,
  updateGoal
});
