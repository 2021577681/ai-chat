const GoalCoreConfig = window.AgentApp.require('config');
const GoalCoreStateModule = window.AgentApp.require('state');
const GoalCoreUiService = window.AgentApp.require('uiService');
const GoalCoreOrchestrationService = window.AgentApp.require('orchestrationService');

const goalState = GoalCoreStateModule.state;
const goalSaveData = GoalCoreStateModule.saveData;
const goalPersistSettings = GoalCoreStateModule.persistSettings;
const goalPersistTools = GoalCoreStateModule.persistTools;
const goalChatById = GoalCoreStateModule.chatById;
const goalCurrentChat = GoalCoreStateModule.currentChat;
const goalBeginChatTask = GoalCoreStateModule.beginChatTask;
const goalRequestStopChatTask = GoalCoreStateModule.requestStopChatTask;
const goalClearChatTask = GoalCoreStateModule.clearChatTask;
const goalSetChatTaskMode = GoalCoreStateModule.setChatTaskMode;
const goalChatTaskById = GoalCoreStateModule.chatTaskById;
const goalSetChatTaskGuidance = GoalCoreStateModule.setChatTaskGuidance;
const goalTakeChatTaskGuidance = GoalCoreStateModule.takeChatTaskGuidance;
const GOAL_STORAGE_KEY = 'aichat_goals_v1';
const GOAL_RUNTIME_TOOL_NAMES = new Set(['get_goal', 'update_goal']);

const GOAL_TERMINAL_STATUSES = new Set(['complete', 'blocked', 'cancelled']);
const GOAL_RUNNERS = new Map();
const SCHEDULED_GOAL_STATUS = { WAITING: 'waiting', RUNNING: 'running', DONE: 'done', ERROR: 'error' };
let goalElapsedTimer = null;

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
    'Never mark a goal complete because token budget, turn budget, or time is running out.',
    'Do not use update_goal to pause or cancel the goal; pausing and cancellation are user/system controls only.'
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
    scheduled: goal.scheduled && typeof goal.scheduled === 'object' ? {
      id: String(goal.scheduled.id || ('goal_sch_' + Date.now())),
      runAt: Math.max(0, Number(goal.scheduled.runAt || 0) || 0),
      createdAt: Math.max(0, Number(goal.scheduled.createdAt || Date.now()) || Date.now()),
      status: Object.values(SCHEDULED_GOAL_STATUS).includes(goal.scheduled.status) ? goal.scheduled.status : SCHEDULED_GOAL_STATUS.WAITING,
      error: String(goal.scheduled.error || '')
    } : null,
    pendingGuidance: String(goal.pendingGuidance || ''),
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
  const chat = options.chat || (options.chatId ? goalChatById(options.chatId) : null);
  const goal = normalizeGoalRecord({
    id: makeGoalId(),
    chatId: chat && chat.id || options.chatId || '',
    objective,
    status: 'active',
    scheduled: options.scheduled || null,
    tokenBudget: Math.max(0, Number(options.token_budget || options.tokenBudget || 0) || 0),
    tokenUsed: 0,
    turnCount: 0,
    maxTurns: Math.max(1, Number(options.max_turns || options.maxTurns || settings.goalMaxTurns || 20) || 20),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    events: []
  });
  if (goal.scheduled && goal.scheduled.status === SCHEDULED_GOAL_STATUS.WAITING) {
    goal.status = 'paused';
  }
  if (chat) bindGoalToChat(goal, chat);
  pushGoalEvent(goal, 'created', { progress: 'Goal created.' });
  goalStore.goals.unshift(goal);
  goalStore.activeGoalId = goal.id;
  goalStore.selectedGoalId = goal.id;
  saveGoals();
  if (chat) goalSaveData();
  return goal;
}

function ensureGoalToolsEnabled() {
  if (!Array.isArray(goalState.tools)) goalState.tools = [];
  const builtins = Array.isArray(GoalCoreConfig.BUILTIN_TOOLS) ? GoalCoreConfig.BUILTIN_TOOLS : [];
  let added = 0;
  for (const tool of builtins) {
    if (!tool || !GOAL_RUNTIME_TOOL_NAMES.has(tool.name)) continue;
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

function goalCardTitle(goal, max = 120) {
  const objective = String((goal && goal.objective) || '');
  const lines = objective
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  let title = lines.find(line => !/^(prompt|system|user|assistant|目标|任务|需求|要求|说明)\s*[:：]?\s*$/i.test(line))
    || lines[0]
    || '未命名目标';
  title = title
    .replace(/^#{1,6}\s*/, '')
    .replace(/^(目标|任务|需求|要求|说明|prompt|objective)\s*[:：]\s*/i, '')
    .trim() || title;
  return clipGoalText(title, max);
}

function goalEndTime(goal) {
  if (!goal || !GOAL_TERMINAL_STATUSES.has(goal.status)) return 0;
  const value = goal.completedAt || goal.blockedAt || goal.cancelledAt || goal.updatedAt;
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function goalElapsedMs(goal, now = Date.now()) {
  const start = Date.parse((goal && goal.createdAt) || '');
  if (!Number.isFinite(start)) return 0;
  const end = goalEndTime(goal) || now;
  return Math.max(0, end - start);
}

function formatGoalElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}时${String(minutes).padStart(2, '0')}分`;
  if (minutes) return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  return `${seconds}秒`;
}

function goalElapsedText(goal, now = Date.now()) {
  return formatGoalElapsed(goalElapsedMs(goal, now));
}

function parseGoalScheduleTimeInput() {
  const input = document.getElementById('scheduleTimeInput');
  if (!input || !input.value) return 0;
  const t = new Date(input.value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function formatGoalScheduleDateTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  const pad = value => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function scheduledGoalLabel(goal) {
  const info = goal && goal.scheduled;
  if (!info) return '';
  const runAtText = formatGoalScheduleDateTime(info.runAt);
  if (info.status === SCHEDULED_GOAL_STATUS.RUNNING) return ` · 定时触发中 ${runAtText}`;
  if (info.status === SCHEDULED_GOAL_STATUS.DONE) return ` · 已定时触发 ${runAtText}`;
  if (info.status === SCHEDULED_GOAL_STATUS.ERROR) return ` · 定时触发失败 ${runAtText}`;
  const left = Math.max(0, (Number(info.runAt) || 0) - Date.now());
  const seconds = Math.ceil(left / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return ` · 等待定时 ${runAtText}${left > 0 ? ` · ${mins}:${String(secs).padStart(2, '0')}` : ' · 即将触发'}`;
}

function isScheduledGoalWaiting(goal) {
  return !!(goal && goal.scheduled && goal.scheduled.status === SCHEDULED_GOAL_STATUS.WAITING);
}

function refreshGoalElapsedStat() {
  const statEl = document.getElementById('goalElapsedStat');
  if (!statEl) return;
  const goal = selectedGoal();
  if (!goal) return;
  statEl.textContent = goalElapsedText(goal);
}

function startGoalElapsedTimer() {
  if (goalElapsedTimer) return;
  refreshGoalElapsedStat();
  goalElapsedTimer = setInterval(refreshGoalElapsedStat, 1000);
}

function stopGoalElapsedTimer() {
  if (!goalElapsedTimer) return;
  clearInterval(goalElapsedTimer);
  goalElapsedTimer = null;
}

const goalChatNodeUpdateQueue = new Map();
let goalChatNodeUpdateScheduled = false;

function mergeGoalChatNodeUpdateMode(current, next) {
  if (!current) return next || 'refresh';
  if (!next) return current;
  const a = current;
  const b = next || 'refresh';
  if (a === 'append' || b === 'append') return 'append';
  if (a === 'refresh' || b === 'refresh') return 'refresh';
  return 'content';
}

function scheduleGoalChatNodeUpdate(chat, idx, mode = 'refresh') {
  if (!chat || !GoalCoreStateModule.isCurrentChat(chat.id)) return;
  if (!Number.isInteger(idx) || idx < 0) return;
  const key = `${chat.id}:${idx}`;
  const existing = goalChatNodeUpdateQueue.get(key);
  goalChatNodeUpdateQueue.set(key, {
    chat,
    idx,
    mode: mergeGoalChatNodeUpdateMode(existing && existing.mode, mode)
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
      if (item.mode === 'append' && GoalCoreUiService.has('appendMsgNode')) {
        ok = GoalCoreUiService.appendMsgNode(item.idx, item.chat) !== false;
      } else if (item.mode === 'content' && GoalCoreUiService.has('updateMsgContentNode')) {
        ok = GoalCoreUiService.updateMsgContentNode(item.idx, item.chat, { streaming: true }) !== false;
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
    hasToolCalls: false,
    finalized: false
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
    if (!content || recorder.finalized) return null;
    if (hasFinalAssistant()) {
      recorder.finalized = true;
      return null;
    }
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
    recorder.finalized = true;
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
        scheduleGoalChatNodeUpdate(chat, recorder.assistantIdx, 'content');
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
    finish(options = {}) {
      finishAssistant();
      const appended = options.appendFinal === false ? null : appendGoalTurnFinalAssistant();
      goalSaveData();
      if (!appended && !recorder.finalized && recorder.assistantIdx >= 0) {
        scheduleGoalChatNodeUpdate(chat, recorder.assistantIdx, 'refresh');
      }
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
        const cardTitle = goalCardTitle(goal);
        return `
          <div class="goal-item ${selected ? 'selected' : ''} ${escapeGoalHtml(goal.status)}" role="button" tabindex="0" data-action="valueClick" data-keydown-action="goalCardSelect" data-handler="selectGoalById" data-value="${escapeGoalHtml(goal.id)}">
            <div class="goal-item-main">
              <span class="goal-item-title" title="${escapeGoalHtml(cardTitle)}">${escapeGoalHtml(cardTitle)}</span>
              <span class="goal-item-meta">${statusLabel(goal.status)} · ${goal.turnCount}/${goal.maxTurns} 轮${running ? ' · 运行中' : ''}${escapeGoalHtml(scheduledGoalLabel(goal))}</span>
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
            <div class="goal-detail-meta">${statusLabel(goal.status)}${running ? ' · 正在运行' : ''}${escapeGoalHtml(scheduledGoalLabel(goal))} · 更新 ${escapeGoalHtml(new Date(goal.updatedAt).toLocaleString())}</div>
          </div>
          <span class="goal-status-pill ${escapeGoalHtml(goal.status)}">${statusLabel(goal.status)}</span>
        </div>
        <div class="goal-stat-grid">
          <div><strong>${goal.turnCount}</strong><span>已用轮次</span></div>
          <div><strong id="goalElapsedStat">${escapeGoalHtml(goalElapsedText(goal))}</strong><span>任务耗时</span></div>
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
  refreshGoalElapsedStat();
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
  startGoalElapsedTimer();
}

function closeGoalPanel() {
  const modal = document.getElementById('goalModal');
  if (modal) modal.classList.remove('show');
  stopGoalElapsedTimer();
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
    form.chat = goalCurrentChat();
    const scheduledActive = typeof isScheduledSendActive === 'function' && isScheduledSendActive();
    if (scheduledActive) {
      const runAt = parseGoalScheduleTimeInput();
      if (!runAt) return goalToast('请选择定时发送时间', 2500);
      form.scheduled = {
        id: 'goal_sch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        runAt,
        createdAt: Date.now(),
        status: SCHEDULED_GOAL_STATUS.WAITING,
        error: ''
      };
    }
    const goal = createGoalRecord(form);
    if (scheduledActive) {
      if (typeof toggleScheduledSend === 'function') toggleScheduledSend(false);
      pushGoalEvent(goal, 'scheduled', { progress: 'Goal scheduled for ' + formatGoalScheduleDateTime(goal.scheduled.runAt) + '.' });
      saveGoals();
      renderGoalPanel();
      goalToast('⏰ 已创建定时目标：' + formatGoalScheduleDateTime(goal.scheduled.runAt), 2200);
    } else {
      goalToast('目标已创建');
      continueGoal(goal.id);
    }
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
  const queuedGuidance = isGoalRunning(goal.id)
    ? queueGoalGuidance(goal, '目标已修改，请按新的目标继续：\n' + goal.objective)
    : false;
  saveGoals();
  goalToast(queuedGuidance ? '目标已保存，将按新目标继续' : '目标已保存');
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

function bindGoalToChat(goal, chat) {
  if (!goal || !chat) return chat;
  if (!Array.isArray(chat.messages)) chat.messages = [];
  if (!Array.isArray(chat.goalIds)) chat.goalIds = [];
  if (!chat.goalIds.includes(goal.id)) chat.goalIds.push(goal.id);
  if (!chat.goalId) chat.goalId = goal.id;
  goal.chatId = chat.id;
  return chat;
}

function createFallbackGoalChat(goal) {
  const id = 'c_' + Date.now();
  const chat = {
    id,
    title: '新对话',
    messages: [],
    createdAt: Date.now()
  };
  goalState.chats.unshift(chat);
  goalState.currentId = id;
  return bindGoalToChat(goal, chat);
}

function ensureGoalChat(goal) {
  let chat = goal.chatId ? goalChatById(goal.chatId) : null;
  if (!chat) chat = goalCurrentChat();
  if (!chat) chat = createFallbackGoalChat(goal);
  bindGoalToChat(goal, chat);
  goalState.currentId = chat.id;
  persistGoals();
  goalSaveData();
  GoalCoreUiService.renderChatList();
  GoalCoreUiService.renderMessages();
  GoalCoreUiService.updateSendBtn();
  return chat;
}

function goalToolContextChat(toolContext = {}) {
  if (toolContext && toolContext.chat) return toolContext.chat;
  if (toolContext && toolContext.chatId) return goalChatById(toolContext.chatId);
  return null;
}

function syncGoalToolContextChat(goal, toolContext = {}) {
  const chat = goalToolContextChat(toolContext);
  if (!goal || !chat) return false;
  const previousGoalChatId = goal.chatId || '';
  const hadGoalId = Array.isArray(chat.goalIds) && chat.goalIds.includes(goal.id);
  bindGoalToChat(goal, chat);
  return goal.chatId !== previousGoalChatId || !hadGoalId;
}

function goalGuidanceTextFromMessage(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content
      .filter(part => part && (part.type === 'text' || part.type === 'input_text'))
      .map(part => part.text || '')
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function hasPendingGoalGuidance(chatId) {
  const task = goalChatTaskById(chatId);
  return !!(task && task.pendingGuidance);
}

function appendGoalGuidanceMessage(chat, goal, guidance) {
  if (!chat || !goal || !guidance) return '';
  const message = {
    ...guidance,
    role: guidance.role || 'user',
    createdAt: guidance.createdAt || Date.now(),
    goalId: goal.id,
    _midrunGuidance: true,
    _goalGuidance: true
  };
  const text = goalGuidanceTextFromMessage(message);
  chat.messages.push(message);
  const idx = chat.messages.length - 1;
  goal.pendingGuidance = text;
  pushGoalEvent(goal, 'guidance', { progress: clipGoalText(text || 'User guidance received.', 500) });
  goalSaveData();
  GoalCoreUiService.renderChatList();
  scheduleGoalChatNodeUpdate(chat, idx, 'append');
  GoalCoreUiService.updateSendBtn();
  return text;
}

function consumePendingGoalGuidance(chat, goal) {
  if (!chat || !goal) return '';
  const guidance = goalTakeChatTaskGuidance(chat.id);
  if (!guidance) return '';
  const task = goalChatTaskById(chat.id);
  if (task) {
    task.stopRequested = false;
    task.guidanceRequested = false;
  }
  goalState.stopRequested = false;
  return appendGoalGuidanceMessage(chat, goal, guidance);
}

function takeGoalPendingGuidance(goal) {
  const text = String((goal && goal.pendingGuidance) || '').trim();
  if (goal && text) goal.pendingGuidance = '';
  return text;
}

function normalizeGoalContextMessage(message) {
  if (!message || message._hiddenFromUI) return null;
  const role = message.role;
  if (!['user', 'assistant', 'tool', 'system'].includes(role)) return null;
  const out = { role };
  if (typeof message.content === 'string') out.content = message.content;
  else if (Array.isArray(message.content)) out.content = message.content.map(part => ({ ...part }));
  else out.content = '';
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    out.tool_calls = message.tool_calls.map(tc => JSON.parse(JSON.stringify(tc)));
  }
  if (Array.isArray(message.attachments) && message.attachments.length) {
    out.attachments = message.attachments.map(att => ({ ...att }));
  }
  if (message.tool_call_id) out.tool_call_id = message.tool_call_id;
  if (message.name) out.name = message.name;
  if (!String(out.content || '').trim() && !out.tool_calls && !out.tool_call_id && !out.attachments) return null;
  return out;
}

function buildGoalConversationContext(chat, beforeIdx, limit = 30) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : [];
  const end = Math.max(0, Math.min(Number(beforeIdx || 0), messages.length));
  const context = messages
    .slice(0, end)
    .map(normalizeGoalContextMessage)
    .filter(Boolean)
    .slice(-Math.max(0, Number(limit || 30) || 30));
  while (context.length && context[0].role === 'tool') context.shift();
  return context;
}

function queueGoalGuidance(goal, text) {
  if (!goal || !goal.chatId || !text) return false;
  const chat = goalChatById(goal.chatId);
  if (!chat) return false;
  const message = {
    role: 'user',
    content: String(text || ''),
    createdAt: Date.now(),
    goalId: goal.id,
    _midrunGuidance: true,
    _goalGuidance: true,
    _queuedAt: Date.now()
  };
  const task = goalChatTaskById(chat.id);
  if (task && task.pendingGuidance) {
    task.pendingGuidance.content = [task.pendingGuidance.content || '', message.content || ''].filter(Boolean).join('\n\n');
    task.pendingGuidance._queuedAt = Date.now();
    task.guidanceRequested = true;
  } else if (goalSetChatTaskGuidance) {
    goalSetChatTaskGuidance(chat.id, message);
  } else if (task) {
    task.pendingGuidance = message;
    task.guidanceRequested = true;
  }
  const runner = GOAL_RUNNERS.get(goal.id);
  if (task) task.stopRequested = true;
  goalState.stopRequested = true;
  if (runner && runner.controller) {
    try { runner.controller.abort(); } catch (e) {}
  }
  return true;
}

function buildGoalTurnPrompt(goal, guidanceText = '') {
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
  const base = template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] !== undefined ? values[key] : '');
  const guidance = String(guidanceText || '').trim();
  return guidance
    ? base + '\n\n用户中途引导：\n' + guidance
    : base;
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
  if (isScheduledGoalWaiting(goal)) {
    const runAt = Number(goal.scheduled.runAt) || 0;
    if (runAt > Date.now()) {
      return goalToast('目标已定时，将在 ' + formatGoalScheduleDateTime(runAt) + ' 自动执行');
    }
    goal.scheduled.status = SCHEDULED_GOAL_STATUS.RUNNING;
  }
  if (isGoalRunning(goal.id)) return goalToast('目标正在运行');

  goal.status = 'active';
  goalStore.activeGoalId = goal.id;
  pushGoalEvent(goal, 'continued', { progress: 'Goal runner continued.' });
  saveGoals();
  ensureGoalToolsEnabled();

  const chat = ensureGoalChat(goal);
  const controller = new AbortController();
  const runner = { controller, done: false };
  let restartAfterGuidance = false;
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
      const turnGuidance = takeGoalPendingGuidance(freshGoal);
      if (turnGuidance) persistGoals();
      const contextMessages = buildGoalConversationContext(chat, userMsgIdx);
      const tokenStatsBefore = goalChatRecordedTokenTotal(chat);
      const messageCountBeforeRun = chat.messages.length;
      const turnPrompt = buildGoalTurnPrompt(freshGoal, turnGuidance);
      const systemPrompt = goalSettings().goalSystemPrompt || goalDefaultSystemPrompt();
      let result;
      let suppressFinalAssistant = false;
      try {
        result = await GoalCoreOrchestrationService.runAgentLoop({
          initialMessages: [...contextMessages, { role: 'user', content: turnPrompt }],
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
      } catch (e) {
        suppressFinalAssistant = !!(e && e.name === 'AbortError' && hasPendingGoalGuidance(chat.id));
        throw e;
      } finally {
        chatRecorder.finish({ appendFinal: !suppressFinalAssistant });
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
      const guidanceAbort = !!(e && e.name === 'AbortError' && hasPendingGoalGuidance(chat.id));
      stoppedByGoalStatus = !!(e && e.name === 'AbortError' && latestGoal.status && latestGoal.status !== 'active');
      if (guidanceAbort) {
        consumePendingGoalGuidance(chat, latestGoal);
        latestGoal.status = 'active';
        latestGoal.lastError = '';
        restartAfterGuidance = true;
      } else {
        if (controller.signal.aborted && latestGoal.status === 'active') latestGoal.status = 'paused';
        latestGoal.lastError = e && e.message ? e.message : String(e);
        if (!stoppedByGoalStatus) pushGoalEvent(latestGoal, controller.signal.aborted ? 'paused' : 'error', { reason: latestGoal.lastError });
      }
      saveGoals();
    }
    if (!restartAfterGuidance && !controller.signal.aborted && !stoppedByGoalStatus) goalToast('Goal run failed: ' + (e && e.message ? e.message : e), 5000);
  } finally {
    runner.done = true;
    GOAL_RUNNERS.delete(goal.id);
    goalClearChatTask(chat.id);
    updateGoalButton();
    const latestAfterRun = goalById(goal.id);
    if (latestAfterRun && latestAfterRun.scheduled && latestAfterRun.scheduled.status === SCHEDULED_GOAL_STATUS.RUNNING) {
      latestAfterRun.scheduled.status = GOAL_TERMINAL_STATUSES.has(latestAfterRun.status)
        ? SCHEDULED_GOAL_STATUS.DONE
        : SCHEDULED_GOAL_STATUS.ERROR;
      if (latestAfterRun.scheduled.status === SCHEDULED_GOAL_STATUS.ERROR) {
        latestAfterRun.scheduled.error = latestAfterRun.lastError || '目标未完成';
      }
      saveGoals();
    }
    renderGoalPanel();
    GoalCoreUiService.updateSendBtn();
    const latestGoal = goalById(goal.id);
    if (restartAfterGuidance && latestGoal && latestGoal.status === 'active') {
      setTimeout(() => continueGoal(latestGoal.id), 0);
    }
  }
}

function findDueScheduledGoals(now = Date.now()) {
  return listGoals().filter(goal => isScheduledGoalWaiting(goal) && (Number(goal.scheduled.runAt) || 0) <= now);
}

function processScheduledGoals() {
  const due = findDueScheduledGoals();
  for (const goal of due) {
    if (!goal || isGoalRunning(goal.id)) continue;
    if (goal.chatId && goalChatTaskById(goal.chatId)) continue;
    goal.scheduled.status = SCHEDULED_GOAL_STATUS.RUNNING;
    pushGoalEvent(goal, 'scheduled_trigger', { progress: 'Scheduled goal time reached; starting runner.' });
    saveGoals();
    renderGoalPanel();
    Promise.resolve(continueGoal(goal.id)).catch(e => {
      const latest = goalById(goal.id);
      if (!latest || !latest.scheduled) return;
      latest.scheduled.status = SCHEDULED_GOAL_STATUS.ERROR;
      latest.scheduled.error = e && e.message ? e.message : String(e || '未知错误');
      latest.lastError = latest.scheduled.error;
      pushGoalEvent(latest, 'scheduled_error', { reason: latest.lastError });
      saveGoals();
      renderGoalPanel();
    });
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
  const chat = goalToolContextChat(toolContext);
  const goal = createGoalRecord({ ...(args || {}), chat, chatId: chat && chat.id || (toolContext && toolContext.chatId) || '' });
  if (chat) {
    bindGoalToChat(goal, chat);
    saveGoals();
    goalSaveData();
  }
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
  if (syncGoalToolContextChat(goal, toolContext)) goalSaveData();
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
  if (syncGoalToolContextChat(goal, toolContext)) goalSaveData();

  const requestedStatus = String(args.status || '').trim().toLowerCase();
  const status = requestedStatus ? normalizeGoalStatus(requestedStatus) : 'active';
  const progress = String(args.progress || '').trim();
  const evidence = String(args.evidence || '').trim();
  const nextStep = String(args.next_step || args.nextStep || '').trim();
  const finalSummary = String(args.final_summary || args.finalSummary || '').trim();
  const blockerReason = String(args.blocker_reason || args.blockerReason || args.reason || '').trim();
  const toolForbiddenStatus = requestedStatus === 'paused' || requestedStatus === 'cancelled';

  if (GOAL_TERMINAL_STATUSES.has(goal.status)) {
    pushGoalEvent(goal, 'update_rejected', {
      reason: `update_goal cannot modify terminal goal status=${goal.status}.`
    });
    saveGoals();
    return {
      ok: false,
      status: goal.status,
      error: `update_goal cannot modify a terminal goal (${goal.status}). Create or select an active goal instead.`,
      goal: summarizeGoalForTool(goal)
    };
  }

  if (progress || evidence || nextStep) {
    pushGoalEvent(goal, 'progress', { progress, evidence, next_step: nextStep });
  }
  if (progress) goal.summary = progress;
  if (evidence) goal.lastResult = evidence;
  if (nextStep) goal.nextStep = nextStep;

  if (toolForbiddenStatus) {
    const rejectedStatus = requestedStatus;
    pushGoalEvent(goal, 'status_rejected', {
      reason: `update_goal cannot set status=${rejectedStatus}; pause/cancel are user or system controls.`
    });
    saveGoals();
    return {
      ok: false,
      status: goal.status,
      error: `update_goal cannot set status=${rejectedStatus}. Use status="blocked" with blocker_reason when user input is required; pause/cancel must come from user or system controls.`,
      goal: summarizeGoalForTool(goal)
    };
  }

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
window.findDueScheduledGoals = findDueScheduledGoals;
window.processScheduledGoals = processScheduledGoals;
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
  SCHEDULED_GOAL_STATUS,
  findDueScheduledGoals,
  processScheduledGoals,
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
