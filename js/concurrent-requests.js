// ============ 并发请求 ============

const ConcurrentRequestsStateModule = window.AgentApp.require('state');
const concurrentRequestsState = ConcurrentRequestsStateModule.state;
const concurrentRequestsSaveData = ConcurrentRequestsStateModule.saveData;
const concurrentRequestsCurrentChat = ConcurrentRequestsStateModule.currentChat;
const concurrentRequestsChatById = ConcurrentRequestsStateModule.chatById;
const concurrentRequestsIsCurrentChat = ConcurrentRequestsStateModule.isCurrentChat;
const ConcurrentRequestsUiService = window.AgentApp.require('uiService');

const CONCURRENT_REQUESTS_SETTINGS_KEY = 'aichat_concurrent_requests_settings_v1';
const CONCURRENT_RUNTIME = {};

function _concurrentDefaultSettings() {
  return {
    agentCount: 3,
    useTools: !!(concurrentRequestsState.settings && concurrentRequestsState.settings.useTools),
    targetChatId: 'new'
  };
}

function loadConcurrentRequestSettings() {
  try {
    const raw = storage.get(CONCURRENT_REQUESTS_SETTINGS_KEY);
    if (!raw) return _concurrentDefaultSettings();
    const parsed = JSON.parse(raw);
    return {
      ..._concurrentDefaultSettings(),
      ...(parsed && typeof parsed === 'object' ? parsed : {})
    };
  } catch (e) {
    console.warn('[concurrent] settings load failed:', e);
    return _concurrentDefaultSettings();
  }
}

function saveConcurrentRequestSettings(next) {
  try {
    storage.set(CONCURRENT_REQUESTS_SETTINGS_KEY, JSON.stringify({
      ..._concurrentDefaultSettings(),
      ...(next || {})
    }));
  } catch (e) {
    console.warn('[concurrent] settings save failed:', e);
  }
}

function _concurrentId(prefix = 'cr') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function _concurrentClampAgentCount(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(20, n);
}

function _concurrentChineseNumber(n) {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n <= 9) return digits[n] || String(n);
  if (n === 10) return '十';
  if (n < 20) return '十' + digits[n - 10];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return digits[tens] + '十' + (ones ? digits[ones] : '');
  }
  return String(n);
}

function concurrentAgentName(index) {
  return `AI助手${_concurrentChineseNumber(index)}号`;
}

function _concurrentCloneAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.map(a => ({ ...(a || {}) }));
}

function _concurrentGetChats() {
  return (concurrentRequestsState.chats || []).filter(c => c && c.concurrent && c.concurrent.type === 'concurrent_requests');
}

function _concurrentEnsureAgents(meta, count) {
  const agentCount = _concurrentClampAgentCount(count || meta.agentCount || 1);
  meta.agentCount = agentCount;
  if (!Array.isArray(meta.agents)) meta.agents = [];
  for (let i = 1; i <= agentCount; i++) {
    const existing = meta.agents[i - 1] || {};
    meta.agents[i - 1] = {
      id: existing.id || `ai_${i}`,
      index: i,
      name: existing.name || concurrentAgentName(i),
      messages: Array.isArray(existing.messages) ? existing.messages : []
    };
  }
  meta.agents = meta.agents.slice(0, agentCount);
  return meta.agents;
}

function ensureConcurrentChatMeta(chat, agentCount, useTools) {
  if (!chat) return null;
  if (!chat.concurrent || typeof chat.concurrent !== 'object') {
    chat.concurrent = {
      type: 'concurrent_requests',
      id: _concurrentId('conv'),
      agentCount: _concurrentClampAgentCount(agentCount || 3),
      useTools: !!useTools,
      agents: [],
      fileOwners: {},
      checkpoints: {},
      rounds: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }
  const meta = chat.concurrent;
  meta.type = 'concurrent_requests';
  meta.id = meta.id || _concurrentId('conv');
  if (!meta.createdAt) meta.createdAt = chat.createdAt || Date.now();
  if (!meta.updatedAt) meta.updatedAt = Date.now();
  if (!meta.fileOwners || typeof meta.fileOwners !== 'object') meta.fileOwners = {};
  if (!meta.checkpoints || typeof meta.checkpoints !== 'object') meta.checkpoints = {};
  if (!Array.isArray(meta.rounds)) meta.rounds = [];
  if (typeof useTools !== 'undefined') meta.useTools = !!useTools;
  _concurrentEnsureAgents(meta, agentCount || meta.agentCount || 3);
  return meta;
}

function _concurrentCreateChat(agentCount, useTools, prompt) {
  const count = _concurrentClampAgentCount(agentCount);
  const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const title = `并发请求：${String(prompt || '').trim().slice(0, 24) || '新任务'}`;
  const chat = {
    id,
    title,
    messages: [],
    createdAt: Date.now(),
    concurrent: {
      type: 'concurrent_requests',
      id: _concurrentId('conv'),
      agentCount: count,
      useTools: !!useTools,
      agents: [],
      fileOwners: {},
      checkpoints: {},
      rounds: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  };
  ensureConcurrentChatMeta(chat, count, useTools);
  concurrentRequestsState.chats.unshift(chat);
  return chat;
}

function _concurrentFindGroup(chat, roundId) {
  if (!chat || !Array.isArray(chat.messages)) return null;
  return chat.messages.find(m => m && m._concurrentGroup && m.concurrent && m.concurrent.roundId === roundId) || null;
}

function _concurrentFindTurn(groupMsg, agentId) {
  const turns = groupMsg && groupMsg.concurrent && Array.isArray(groupMsg.concurrent.turns)
    ? groupMsg.concurrent.turns
    : [];
  return turns.find(t => t.agentId === agentId) || null;
}

function _concurrentTranscriptRounds(chat) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : [];
  const rounds = [];
  for (let i = 0; i < messages.length; i++) {
    const user = messages[i];
    if (!user || !user._concurrentUser || !user.concurrentRoundId) continue;
    const group = messages.find(m => m && m._concurrentGroup && m.concurrent && m.concurrent.roundId === user.concurrentRoundId);
    if (group) rounds.push({ user, group });
  }
  return rounds;
}

function _concurrentCountUserTurns(messages) {
  return (Array.isArray(messages) ? messages : []).filter(m =>
    m && m.role === 'user' && !m._concurrentAttachment && !m._isTransientSummary
  ).length;
}

function _concurrentCountAssistantTurns(messages) {
  return (Array.isArray(messages) ? messages : []).filter(m =>
    m && m.role === 'assistant' && String(m.content || '').trim()
  ).length;
}

function _concurrentTurnHasFinalText(round, agentId) {
  const turn = _concurrentFindTurn(round && round.group, agentId);
  return !!(turn && Array.isArray(turn.items) && turn.items.some(item =>
    item && (item.type === 'final' || item.type === 'error' || item.type === 'stopped') && String(item.content || '').trim()
  ));
}

function _concurrentRebuildAgentMessagesFromTranscript(chat, agentId, rounds = null) {
  const rebuilt = [];
  for (const round of (Array.isArray(rounds) ? rounds : _concurrentTranscriptRounds(chat))) {
    const user = round.user || {};
    const userMsg = {
      role: 'user',
      content: user.content || ''
    };
    if (Array.isArray(user.attachments) && user.attachments.length) {
      userMsg.attachments = _concurrentCloneAttachments(user.attachments);
    }
    rebuilt.push(userMsg);

    const turn = _concurrentFindTurn(round.group, agentId);
    if (!turn || !Array.isArray(turn.items)) continue;
    const finalItem = [...turn.items].reverse().find(item =>
      item && (item.type === 'final' || item.type === 'error' || item.type === 'stopped') && String(item.content || '').trim()
    );
    if (finalItem) {
      rebuilt.push({
        role: 'assistant',
        content: finalItem.type === 'final'
          ? String(finalItem.content || '')
          : `【${finalItem.type === 'error' ? '失败' : '已停止'}】${String(finalItem.content || '')}`
      });
    }
  }
  return rebuilt;
}

function _concurrentRepairAgentPrivateContext(chat, agent) {
  if (!agent) return [];
  const currentMessages = Array.isArray(agent.messages) ? agent.messages : [];
  if (currentMessages.some(m => m && m._isTransientSummary)) return currentMessages;
  const completedRounds = _concurrentTranscriptRounds(chat).filter(round => {
    const group = round.group && round.group.concurrent;
    return group && group.status && group.status !== 'running' && group.status !== 'stopping';
  });
  if (!completedRounds.length) return currentMessages;
  const userTurnCount = _concurrentCountUserTurns(currentMessages);
  const assistantTurnCount = _concurrentCountAssistantTurns(currentMessages);
  const finalTurnCount = completedRounds.filter(round => _concurrentTurnHasFinalText(round, agent.id)).length;
  if (userTurnCount >= completedRounds.length && assistantTurnCount >= finalTurnCount) return currentMessages;

  const rebuilt = _concurrentRebuildAgentMessagesFromTranscript(chat, agent.id, completedRounds);
  if (rebuilt.length) {
    agent.messages = rebuilt;
    console.warn(`[concurrent] 已从主转录修复 ${agent.name || agent.id} 的私有上下文：user ${userTurnCount} -> ${_concurrentCountUserTurns(rebuilt)}，assistant ${assistantTurnCount} -> ${_concurrentCountAssistantTurns(rebuilt)}`);
    return agent.messages;
  }
  return currentMessages;
}

function _concurrentRenderCurrent(chat) {
  if (concurrentRequestsIsCurrentChat(chat && chat.id)) {
    ConcurrentRequestsUiService.renderMessages();
  }
  ConcurrentRequestsUiService.renderChatList();
  ConcurrentRequestsUiService.updateSendBtn();
  if (document.getElementById('concurrentRequestsModal')) renderConcurrentRequestsModal();
}

function _concurrentFormatTime(ts) {
  if (!ts) return '-';
  try { return new Date(ts).toLocaleString('zh-CN'); } catch (e) { return '-'; }
}

function _concurrentElapsed(start, end) {
  if (!start) return '';
  const ms = Math.max(0, (end || Date.now()) - start);
  return (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + 's';
}

function _concurrentStatusText(status) {
  const map = {
    pending: '等待中',
    running: '运行中',
    done: '已完成',
    error: '失败',
    stopped: '已停止',
    stopping: '停止中'
  };
  return map[status] || status || '未知';
}

function isConcurrentChatRunning(chatId) {
  return !!(chatId && CONCURRENT_RUNTIME[chatId]);
}

function isAnyConcurrentChatRunning() {
  return Object.keys(CONCURRENT_RUNTIME).some(id => !!CONCURRENT_RUNTIME[id]);
}

function requestStopConcurrentChat(chatId) {
  const runtime = chatId ? CONCURRENT_RUNTIME[chatId] : null;
  if (!runtime) return false;
  runtime.stopRequested = true;
  Object.values(runtime.controllers || {}).forEach(ctrl => {
    try { ctrl.abort(); } catch (e) {}
  });
  const chat = concurrentRequestsChatById(chatId);
  const groupMsg = chat ? _concurrentFindGroup(chat, runtime.roundId) : null;
  if (groupMsg && groupMsg.concurrent) {
    groupMsg.concurrent.status = 'stopping';
    (groupMsg.concurrent.turns || []).forEach(turn => {
      if (turn.status === 'pending' || turn.status === 'running') turn.status = 'stopping';
    });
  }
  if (typeof window !== 'undefined' && typeof window.cancelAutoResend === 'function') {
    try { window.cancelAutoResend(chatId); } catch (e) {}
  }
  if (chat) _concurrentRenderCurrent(chat);
  return true;
}

function recoverInterruptedConcurrentRequests() {
  if (!Array.isArray(concurrentRequestsState.chats)) return false;
  const now = Date.now();
  let changed = false;
  concurrentRequestsState.chats.forEach(chat => {
    if (!chat || !chat.concurrent || chat.concurrent.type !== 'concurrent_requests') return;
    if (isConcurrentChatRunning(chat.id)) return;
    const meta = ensureConcurrentChatMeta(chat);
    (chat.messages || []).forEach(msg => {
      const group = msg && msg._concurrentGroup && msg.concurrent ? msg.concurrent : null;
      if (!group || (group.status !== 'running' && group.status !== 'stopping')) return;
      group.status = 'stopped';
      group.finishedAt = group.finishedAt || now;
      group.collapsedAll = true;
      msg._endTime = msg._endTime || group.finishedAt;
      (group.turns || []).forEach(turn => {
        if (!turn) return;
        const wasOpen = turn.status === 'pending' || turn.status === 'running' || turn.status === 'stopping';
        if (wasOpen) {
          turn.status = 'stopped';
          turn.finishedAt = turn.finishedAt || now;
          if (!Array.isArray(turn.items)) turn.items = [];
          const hasTerminalItem = turn.items.some(item => item && ['final', 'error', 'stopped'].includes(item.type));
          if (!hasTerminalItem) {
            turn.items.push({
              id: _concurrentId('item'),
              at: now,
              type: 'stopped',
              content: '页面刷新或应用重启，已停止'
            });
          }
        }
        turn.collapsed = true;
      });
      const roundMeta = meta && Array.isArray(meta.rounds)
        ? meta.rounds.find(r => r && r.id === group.roundId)
        : null;
      if (roundMeta && (roundMeta.status === 'running' || roundMeta.status === 'stopping')) {
        roundMeta.status = 'stopped';
        roundMeta.finishedAt = roundMeta.finishedAt || group.finishedAt;
      }
      if (meta) meta.updatedAt = now;
      changed = true;
    });
  });
  return changed;
}

function stopSelectedConcurrentRequest() {
  const select = document.getElementById('concurrentTargetSelect');
  const chatId = select && select.value !== 'new' ? select.value : concurrentRequestsState.currentId;
  if (!requestStopConcurrentChat(chatId)) {
    ConcurrentRequestsUiService.toast('当前没有正在运行的并发请求');
  } else {
    ConcurrentRequestsUiService.toast('已请求停止该并发对话');
  }
}

function stopAllConcurrentRequests() {
  const ids = Object.keys(CONCURRENT_RUNTIME);
  if (!ids.length) {
    ConcurrentRequestsUiService.toast('没有正在运行的并发请求');
    return;
  }
  ids.forEach(id => requestStopConcurrentChat(id));
  ConcurrentRequestsUiService.toast(`已请求停止 ${ids.length} 个并发对话`);
}

async function startConcurrentRound(chat, prompt, useTools, attachments = []) {
  const cleanPrompt = String(prompt || '').trim();
  const roundAttachments = _concurrentCloneAttachments(attachments);
  if (!chat || (!cleanPrompt && !roundAttachments.length)) return false;
  if (!concurrentRequestsState.settings.apiKey) {
    alert('请先在「设置」中填写 API Key');
    if (typeof openSettings === 'function') openSettings();
    return false;
  }
  if (isConcurrentChatRunning(chat.id)) {
    ConcurrentRequestsUiService.toast('该并发对话正在运行，请先等待完成或停止');
    return false;
  }

  const meta = ensureConcurrentChatMeta(chat, chat.concurrent && chat.concurrent.agentCount, useTools);
  const agents = _concurrentEnsureAgents(meta, meta.agentCount);
  const roundId = _concurrentId('round');
  const startedAt = Date.now();
  const userMsg = {
    role: 'user',
    content: cleanPrompt,
    _concurrentUser: true,
    concurrentRoundId: roundId
  };
  if (roundAttachments.length) userMsg.attachments = _concurrentCloneAttachments(roundAttachments);
  const groupMsg = {
    role: 'assistant',
    content: '',
    _concurrentGroup: true,
    concurrent: {
      roundId,
      prompt: cleanPrompt,
      agentCount: meta.agentCount,
      useTools: !!useTools,
      status: 'running',
      startedAt,
      finishedAt: null,
      collapsedAll: false,
      turns: agents.map(agent => ({
        agentId: agent.id,
        agentName: agent.name,
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        collapsed: false,
        items: []
      }))
    },
    _startTime: startedAt
  };

  chat.messages.push(userMsg, groupMsg);
  meta.rounds.push({
    id: roundId,
    prompt: cleanPrompt,
    useTools: !!useTools,
    startedAt,
    finishedAt: null,
    status: 'running'
  });
  meta.updatedAt = startedAt;
  concurrentRequestsState.currentId = chat.id;
  concurrentRequestsSaveData();
  ConcurrentRequestsUiService.renderChatList();
  ConcurrentRequestsUiService.renderMessages();
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();

  const runtime = {
    chatId: chat.id,
    roundId,
    stopRequested: false,
    controllers: {}
  };
  CONCURRENT_RUNTIME[chat.id] = runtime;
  if (typeof updateGenerationBgmForTasks === 'function') updateGenerationBgmForTasks();
  _concurrentRenderCurrent(chat);

  const maxRoundsRaw = parseInt(concurrentRequestsState.settings.maxToolRounds, 10);
  const maxRounds = (Number.isFinite(maxRoundsRaw) && maxRoundsRaw >= 0) ? maxRoundsRaw : 15;
  const systemPrompt = concurrentRequestsState.settings.systemPrompt || '';
  const model = concurrentRequestsState.settings.currentModel;

  const runOne = async (agent, turn) => {
    if (!agent || !turn) return;
    const ctrl = new AbortController();
    runtime.controllers[agent.id] = ctrl;
    turn.status = 'running';
    turn.startedAt = Date.now();
    concurrentRequestsSaveData();
    _concurrentRenderCurrent(chat);

    const addItem = (item) => {
      turn.items.push({ id: _concurrentId('item'), at: Date.now(), ...item });
      concurrentRequestsSaveData();
      _concurrentRenderCurrent(chat);
    };

    try {
      const privateHistory = _concurrentRepairAgentPrivateContext(chat, agent);
      const initialMessages = [
        ...(Array.isArray(privateHistory) ? privateHistory : []),
        {
          role: 'user',
          content: cleanPrompt,
          ...(roundAttachments.length ? { attachments: _concurrentCloneAttachments(roundAttachments) } : {})
        }
      ];
      const result = await runAgentLoop({
        initialMessages,
        systemPrompt,
        model,
        maxRounds,
        signal: ctrl.signal,
        useTools: !!useTools,
        stream: false,
        chatId: chat.id,
        chat,
        toolContext: {
          concurrentChatId: chat.id,
          concurrentRoundId: roundId,
          concurrentAgentId: agent.id,
          concurrentAgentName: agent.name
        },
        isStopped: () => runtime.stopRequested || ctrl.signal.aborted,
        onProgress: ev => {
          if (!ev || runtime.stopRequested) return;
          if (ev.type === 'tool_call') {
            addItem({ type: 'tool_call', name: ev.name || 'tool', args: ev.args || {}, toolCallId: ev.id || '' });
          } else if (ev.type === 'tool_result') {
            addItem({ type: 'tool_result', name: ev.name || 'tool', content: ev.content || '', ok: ev.ok !== false, toolCallId: ev.id || '' });
          } else if (ev.type === 'round_end' && ev.hasToolCalls && String(ev.text || '').trim()) {
            addItem({ type: 'assistant_step', content: String(ev.text || '').trim() });
          }
        }
      });
      agent.messages = Array.isArray(result && result.messages) ? result.messages : initialMessages;
      const finalText = String((result && result.finalText) || '').trim();
      if (finalText) addItem({ type: 'final', content: finalText });
      else addItem({ type: 'final', content: '(无最终回答)' });
      turn.status = runtime.stopRequested ? 'stopped' : 'done';
    } catch (e) {
      const stopped = runtime.stopRequested || ctrl.signal.aborted || (e && e.name === 'AbortError');
      turn.status = stopped ? 'stopped' : 'error';
      addItem({
        type: stopped ? 'stopped' : 'error',
        content: stopped ? '已停止' : (e && e.message ? e.message : String(e))
      });
    } finally {
      turn.finishedAt = Date.now();
      delete runtime.controllers[agent.id];
      concurrentRequestsSaveData();
      _concurrentRenderCurrent(chat);
    }
  };

  try {
    await Promise.allSettled(agents.map(agent => runOne(agent, _concurrentFindTurn(groupMsg, agent.id))));
  } finally {
    const turns = groupMsg.concurrent.turns || [];
    const anyError = turns.some(t => t.status === 'error');
    const anyDone = turns.some(t => t.status === 'done');
    const allStopped = turns.length > 0 && turns.every(t => t.status === 'stopped');
    const finishedAt = Date.now();
    groupMsg.concurrent.status = allStopped ? 'stopped' : (anyError ? 'error' : (anyDone ? 'done' : 'stopped'));
    groupMsg.concurrent.finishedAt = finishedAt;
    groupMsg.concurrent.collapsedAll = true;
    groupMsg._endTime = finishedAt;
    turns.forEach(t => { t.collapsed = true; });
    const roundMeta = meta.rounds.find(r => r.id === roundId);
    if (roundMeta) {
      roundMeta.status = groupMsg.concurrent.status;
      roundMeta.finishedAt = finishedAt;
    }
    meta.updatedAt = finishedAt;
    delete CONCURRENT_RUNTIME[chat.id];
    if (typeof updateGenerationBgmForTasks === 'function') updateGenerationBgmForTasks();
    concurrentRequestsSaveData();
    _concurrentRenderCurrent(chat);
    if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
  }
  return true;
}

async function startConcurrentRequestFromUi() {
  const input = document.getElementById('concurrentPromptInput');
  const countEl = document.getElementById('concurrentAgentCount');
  const toolsEl = document.getElementById('concurrentUseTools');
  const select = document.getElementById('concurrentTargetSelect');
  const prompt = input ? input.value.trim() : '';
  if (!prompt) {
    ConcurrentRequestsUiService.toast('请输入并发请求指令');
    return;
  }
  if (!concurrentRequestsState.settings.apiKey) {
    alert('请先在「设置」中填写 API Key');
    if (typeof openSettings === 'function') openSettings();
    return;
  }
  const target = select ? select.value : 'new';
  let useTools = !!(toolsEl && toolsEl.checked);
  let chat = null;
  let agentCount = _concurrentClampAgentCount(countEl ? countEl.value : 3);

  if (target && target !== 'new') {
    chat = concurrentRequestsChatById(target);
    if (!chat || !chat.concurrent) {
      ConcurrentRequestsUiService.toast('找不到选中的并发对话');
      return;
    }
    agentCount = _concurrentClampAgentCount(chat.concurrent.agentCount);
    useTools = !!chat.concurrent.useTools;
  } else {
    chat = _concurrentCreateChat(agentCount, useTools, prompt);
  }
  if (chat && isConcurrentChatRunning(chat.id)) {
    ConcurrentRequestsUiService.toast('该并发对话正在运行，请先等待完成或停止');
    return;
  }

  saveConcurrentRequestSettings({
    agentCount,
    useTools,
    targetChatId: target || 'new'
  });
  if (input) input.value = '';
  renderConcurrentRequestsModal();
  startConcurrentRound(chat, prompt, useTools).catch(e => {
    console.error('[concurrent] start failed:', e);
    ConcurrentRequestsUiService.toast('并发请求启动失败：' + (e.message || e), 4000);
  });
}

async function continueConcurrentChatFromMainInput(prompt, chat, attachments = []) {
  const targetChat = chat || concurrentRequestsCurrentChat();
  if (!targetChat || !targetChat.concurrent || targetChat.concurrent.type !== 'concurrent_requests') return false;
  const cleanPrompt = String(prompt || '').trim();
  const roundAttachments = _concurrentCloneAttachments(attachments);
  if (!cleanPrompt && !roundAttachments.length) return false;
  const meta = ensureConcurrentChatMeta(targetChat, targetChat.concurrent.agentCount);
  return await startConcurrentRound(targetChat, cleanPrompt, !!(meta && meta.useTools), roundAttachments) === true;
}

function concurrentSelectTargetChanged() {
  const select = document.getElementById('concurrentTargetSelect');
  const countEl = document.getElementById('concurrentAgentCount');
  const toolsEl = document.getElementById('concurrentUseTools');
  if (!select || !countEl) return;
  const chat = select.value && select.value !== 'new' ? concurrentRequestsChatById(select.value) : null;
  if (chat && chat.concurrent) {
    countEl.value = _concurrentClampAgentCount(chat.concurrent.agentCount);
    countEl.disabled = true;
    if (toolsEl) {
      toolsEl.checked = !!chat.concurrent.useTools;
      toolsEl.disabled = true;
    }
  } else {
    countEl.disabled = false;
    if (toolsEl) toolsEl.disabled = false;
  }
}

function openConcurrentChat(chatId) {
  if (typeof switchChat === 'function') switchChat(chatId);
  if (typeof closeSettingsPage === 'function') closeSettingsPage();
}

function chooseConcurrentChat(chatId) {
  const select = document.getElementById('concurrentTargetSelect');
  if (select) {
    select.value = chatId || 'new';
    concurrentSelectTargetChanged();
  }
  const input = document.getElementById('concurrentPromptInput');
  if (input) input.focus();
}

function openConcurrentRequests() {
  _concurrentEnsureModal();
  renderConcurrentRequestsModal();
  document.getElementById('concurrentRequestsModal').classList.add('show');
}

function closeConcurrentRequests() {
  const modal = document.getElementById('concurrentRequestsModal');
  if (modal) modal.classList.remove('show');
}

function _concurrentEnsureModal() {
  if (document.getElementById('concurrentRequestsModal')) return;
  const modal = document.createElement('div');
  modal.id = 'concurrentRequestsModal';
  modal.className = 'modal-mask concurrent-requests-modal';
  modal.innerHTML = `
    <div class="modal wide">
      <h2>并发请求 <button class="modal-close" data-action="closeConcurrentRequests">×</button></h2>
      <div class="concurrent-compose">
        <div class="form-group" style="margin-bottom:0;">
          <label>指令</label>
          <textarea id="concurrentPromptInput" placeholder="输入一条指令，多个 AI 会同时独立执行。"></textarea>
        </div>
        <div class="concurrent-controls">
          <label class="concurrent-field">目标对话
            <select id="concurrentTargetSelect" data-change-action="concurrentSelectTargetChanged"></select>
          </label>
          <label class="concurrent-field">并发数
            <input type="number" id="concurrentAgentCount" min="1" max="20" step="1">
          </label>
          <label class="concurrent-check">
            <input type="checkbox" id="concurrentUseTools"> 允许调用工具
          </label>
          <button class="btn btn-primary" id="concurrentStartBtn" data-action="startConcurrentRequestFromUi">开始执行</button>
          <button class="btn btn-warning" data-action="stopSelectedConcurrentRequest">停止当前对话</button>
          <button class="btn" data-action="stopAllConcurrentRequests">停止全部</button>
        </div>
      </div>
      <div class="concurrent-summary" id="concurrentSummary"></div>
      <div class="concurrent-history" id="concurrentHistoryList"></div>
    </div>
  `;
  modal.addEventListener('click', e => {
    if (e.target === modal) closeConcurrentRequests();
  });
  document.body.appendChild(modal);
}

function renderConcurrentRequestsModal() {
  const modal = document.getElementById('concurrentRequestsModal');
  if (!modal) return;
  const settings = loadConcurrentRequestSettings();
  const chats = _concurrentGetChats();
  const select = document.getElementById('concurrentTargetSelect');
  const countEl = document.getElementById('concurrentAgentCount');
  const toolsEl = document.getElementById('concurrentUseTools');
  const summary = document.getElementById('concurrentSummary');
  const history = document.getElementById('concurrentHistoryList');

  if (select) {
    const previous = select.value || settings.targetChatId || 'new';
    select.innerHTML = [
      '<option value="new">新建并发对话</option>',
      ...chats.map(chat => `<option value="${escapeHtml(chat.id)}">${escapeHtml(chat.title || '并发对话')} · ${_concurrentClampAgentCount(chat.concurrent.agentCount)} AI</option>`)
    ].join('');
    select.value = chats.some(c => c.id === previous) ? previous : 'new';
  }
  if (countEl && !countEl.value) countEl.value = _concurrentClampAgentCount(settings.agentCount);
  if (toolsEl) toolsEl.checked = !!settings.useTools;
  concurrentSelectTargetChanged();

  const runningCount = Object.keys(CONCURRENT_RUNTIME).length;
  const totalRounds = chats.reduce((sum, chat) => sum + (chat.messages || []).filter(m => m && m._concurrentGroup).length, 0);
  if (summary) {
    summary.innerHTML = `
      <span>历史对话 ${chats.length}</span>
      <span>并发轮次 ${totalRounds}</span>
      <span>运行中 ${runningCount}</span>
      <span>当前模型 ${escapeHtml(concurrentRequestsState.settings.currentModel || '-')}</span>
    `;
  }
  if (!history) return;
  if (!chats.length) {
    history.innerHTML = '<div class="concurrent-empty">还没有并发对话。输入指令后点击开始执行会自动创建。</div>';
    return;
  }
  history.innerHTML = chats.map(chat => {
    const meta = ensureConcurrentChatMeta(chat);
    const running = isConcurrentChatRunning(chat.id);
    const rounds = (chat.messages || []).filter(m => m && m._concurrentGroup).length;
    const stats = typeof getChatTokenStats === 'function' ? getChatTokenStats(chat) : null;
    const recordedTokens = stats ? ((stats.inputTokens || 0) + (stats.outputTokens || 0)) : 0;
    const tokens = recordedTokens || (typeof estimateChatTokens === 'function' ? estimateChatTokens(chat) : 0);
    const ownerCount = meta.fileOwners ? Object.keys(meta.fileOwners).length : 0;
    return `
      <div class="concurrent-history-card ${running ? 'running' : ''}">
        <div class="concurrent-history-head">
          <span class="concurrent-history-title">${escapeHtml(chat.title || '并发对话')}</span>
          <span class="concurrent-status ${running ? 'running' : 'done'}">${running ? '运行中' : '空闲'}</span>
        </div>
        <div class="concurrent-history-meta">
          <span>${meta.agentCount} 个 AI</span>
          <span>${rounds} 轮</span>
          <span>${formatNumber(tokens)} tokens</span>
          <span>${ownerCount} 个文件归属</span>
          <span>${_concurrentFormatTime(meta.updatedAt)}</span>
        </div>
        <div class="concurrent-history-actions">
          <button class="btn" data-action="valueClick" data-handler="openConcurrentChat" data-value="${escapeHtml(chat.id)}">打开</button>
          <button class="btn" data-action="valueClick" data-handler="chooseConcurrentChat" data-value="${escapeHtml(chat.id)}">继续发指令</button>
          <button class="btn btn-warning" ${running ? '' : 'disabled'} data-action="valueClick" data-handler="requestStopConcurrentChat" data-value="${escapeHtml(chat.id)}">停止</button>
        </div>
      </div>
    `;
  }).join('');
}

function toggleConcurrentAgent(roundId, agentId) {
  const chat = concurrentRequestsCurrentChat();
  const group = _concurrentFindGroup(chat, roundId);
  const turn = _concurrentFindTurn(group, agentId);
  if (!turn) return;
  turn.collapsed = !turn.collapsed;
  concurrentRequestsSaveData();
  ConcurrentRequestsUiService.renderMessages();
}

function _renderConcurrentToolCall(item) {
  return `
    <div class="tool-call">
      <div class="tool-call-header" data-action="toggleParentCollapsed">
        <span>🔧 调用工具：${escapeHtml(item.name || 'tool')}</span>
      </div>
      <div class="tool-call-body">
        <div class="tool-call-label">参数</div>
        <pre>${escapeHtml(JSON.stringify(item.args || {}, null, 2))}</pre>
      </div>
    </div>`;
}

function _renderConcurrentToolResult(item) {
  return `
    <div class="tool-call">
      <div class="tool-call-header" data-action="toggleParentCollapsed">
        <span>📤 ${escapeHtml(item.name || 'tool')} 执行结果</span>
        <span class="tool-status ${item.ok === false ? 'error' : 'success'}">${item.ok === false ? '失败' : '成功'}</span>
      </div>
      <div class="tool-call-body">
        <pre>${escapeHtml(item.content || '')}</pre>
      </div>
    </div>`;
}

function _renderConcurrentEventMessage(ev, idx) {
  const item = ev && ev.item ? ev.item : ev;
  if (!item) return '';
  if (item.type === 'tool_call') {
    return `
      <div class="message concurrent-event-message" data-idx="${idx}" data-agent-id="${escapeHtml(ev.agentId || '')}" data-item-id="${escapeHtml(item.id || '')}">
        <div class="avatar assistant">AI</div>
        <div class="msg-body">
          <div class="msg-role">${escapeHtml(ev.agentName || 'AI助手')}</div>
          ${_renderConcurrentToolCall(item)}
        </div>
      </div>`;
  }
  if (item.type === 'tool_result') {
    return `
      <div class="message concurrent-event-message" data-idx="${idx}" data-agent-id="${escapeHtml(ev.agentId || '')}" data-item-id="${escapeHtml(item.id || '')}">
        <div class="avatar tool">🛠</div>
        <div class="msg-body">
          <div class="msg-role">${escapeHtml(ev.agentName || 'AI助手')} · 工具返回：${escapeHtml(item.name || 'tool')}</div>
          ${_renderConcurrentToolResult(item)}
        </div>
      </div>`;
  }
  if (item.type === 'assistant_step') {
    return `
      <div class="message concurrent-event-message" data-idx="${idx}" data-agent-id="${escapeHtml(ev.agentId || '')}" data-item-id="${escapeHtml(item.id || '')}">
        <div class="avatar assistant">AI</div>
        <div class="msg-body">
          <div class="msg-role">${escapeHtml(ev.agentName || 'AI助手')}</div>
          <div class="msg-content">${renderMarkdown(item.content || '')}</div>
        </div>
      </div>`;
  }
  if (item.type === 'final') {
    return `
      <div class="message concurrent-event-message" data-idx="${idx}" data-agent-id="${escapeHtml(ev.agentId || '')}" data-item-id="${escapeHtml(item.id || '')}">
        <div class="avatar assistant">AI</div>
        <div class="msg-body">
          <div class="msg-role">${escapeHtml(ev.agentName || 'AI助手')}
            <span class="msg-timer">${_concurrentElapsed(ev.startedAt, ev.finishedAt)}</span>
          </div>
          <div class="msg-content">${renderMarkdown(item.content || '')}</div>
        </div>
      </div>`;
  }
  if (item.type === 'stopped') {
    return `
      <div class="message concurrent-event-message" data-idx="${idx}" data-agent-id="${escapeHtml(ev.agentId || '')}" data-item-id="${escapeHtml(item.id || '')}">
        <div class="avatar assistant">AI</div>
        <div class="msg-body">
          <div class="msg-role">${escapeHtml(ev.agentName || 'AI助手')}</div>
          <div class="msg-content concurrent-agent-text stopped">已停止</div>
        </div>
      </div>`;
  }
  if (item.type === 'error') {
    return `
      <div class="message concurrent-event-message" data-idx="${idx}" data-agent-id="${escapeHtml(ev.agentId || '')}" data-item-id="${escapeHtml(item.id || '')}">
        <div class="avatar assistant">AI</div>
        <div class="msg-body">
          <div class="msg-role">${escapeHtml(ev.agentName || 'AI助手')}</div>
          <div class="msg-content concurrent-agent-text error">错误：${escapeHtml(item.content || '')}</div>
        </div>
      </div>`;
  }
  return `
    <div class="message concurrent-event-message" data-idx="${idx}" data-agent-id="${escapeHtml(ev.agentId || '')}" data-item-id="${escapeHtml(item.id || '')}">
      <div class="avatar assistant">AI</div>
      <div class="msg-body">
        <div class="msg-role">${escapeHtml(ev.agentName || 'AI助手')}</div>
        <div class="msg-content">${escapeHtml(item.content || '')}</div>
      </div>
    </div>`;
}

function _concurrentTimeline(turns) {
  const events = [];
  (turns || []).forEach((turn, turnIndex) => {
    (turn.items || []).forEach((item, itemIndex) => {
      events.push({
        turnIndex,
        itemIndex,
        agentId: turn.agentId,
        agentName: turn.agentName,
        status: turn.status,
        startedAt: turn.startedAt,
        finishedAt: turn.finishedAt,
        at: item.at || turn.startedAt || 0,
        item
      });
    });
  });
  return events.sort((a, b) => (a.at - b.at) || (a.turnIndex - b.turnIndex) || (a.itemIndex - b.itemIndex));
}

function _concurrentIsToolFlowEvent(ev) {
  const type = ev && ev.item && ev.item.type;
  return type === 'tool_call' || type === 'tool_result' || type === 'assistant_step';
}

function _concurrentCollapsedBlockKind(ev) {
  if (_concurrentIsToolFlowEvent(ev)) return 'tool';
  if (ev && ev.item && ['final', 'error', 'stopped'].includes(ev.item.type)) return 'answer';
  return 'misc';
}

function _concurrentBuildCollapsedBlocks(events) {
  const blocks = [];
  for (let i = 0; i < events.length;) {
    const ev = events[i];
    const kind = _concurrentCollapsedBlockKind(ev);
    const block = {
      kind,
      seq: blocks.length,
      firstAt: ev && typeof ev.at === 'number' ? ev.at : 0,
      events: []
    };
    while (i < events.length && _concurrentCollapsedBlockKind(events[i]) === kind) {
      const item = events[i];
      block.events.push(item);
      if (item && typeof item.at === 'number' && (block.firstAt == null || item.at < block.firstAt)) {
        block.firstAt = item.at;
      }
      i++;
    }
    blocks.push(block);
  }
  return blocks.sort((a, b) => {
    const rank = { tool: 0, answer: 1, misc: 2 };
    return (rank[a.kind] - rank[b.kind]) || (a.firstAt - b.firstAt) || (a.seq - b.seq);
  });
}

function _renderConcurrentToolFlowGroup(events, idx) {
  const toolResultCount = events.filter(ev => ev.item && ev.item.type === 'tool_result').length;
  const first = events[0];
  const last = events[events.length - 1];
  const elapsed = first && last ? _concurrentElapsed(first.at, last.at) : '';
  return `
    <div class="tool-flow-group concurrent-tool-flow collapsed" data-flow-key="concurrent_${idx}_${escapeHtml(first && first.item ? first.item.id || first.at : Date.now())}">
      <button class="tool-flow-toggle" type="button" data-action="toggleParentCollapsed">
        <span class="tool-flow-icon">🛠</span>
        <span class="tool-flow-title">工具调用过程</span>
        <span class="tool-flow-meta">
          <span class="tool-flow-chip">${toolResultCount} 次调用</span>
          ${elapsed ? `<span class="tool-flow-chip tool-flow-chip-time">⏱ ${elapsed}</span>` : ''}
        </span>
        <span class="tool-flow-arrow">▼</span>
      </button>
      <div class="tool-flow-body">
        ${events.map(ev => _renderConcurrentEventMessage(ev, idx)).join('')}
      </div>
    </div>`;
}

function _renderConcurrentAnswerFlowGroup(ev, idx) {
  const item = ev && ev.item ? ev.item : null;
  if (!item) return '';
  const status = item.type === 'final' ? '已完成' : (item.type === 'error' ? '失败' : (item.type === 'stopped' ? '已停止' : '回答'));
  const elapsed = _concurrentElapsed(ev.startedAt, ev.finishedAt);
  return `
    <div class="tool-flow-group concurrent-answer-flow collapsed" data-flow-key="concurrent_answer_${idx}_${escapeHtml(ev.agentId || '')}_${escapeHtml(item.id || ev.at || '')}">
      <button class="tool-flow-toggle" type="button" data-action="toggleParentCollapsed">
        <span class="tool-flow-icon">💬</span>
        <span class="tool-flow-title">${escapeHtml(ev.agentName || 'AI助手')} 的回答</span>
        <span class="tool-flow-meta">
          <span class="tool-flow-chip">${status}</span>
          ${elapsed ? `<span class="tool-flow-chip tool-flow-chip-time">⏱ ${elapsed}</span>` : ''}
        </span>
        <span class="tool-flow-arrow">▼</span>
      </button>
      <div class="tool-flow-body">
        ${_renderConcurrentEventMessage(ev, idx)}
      </div>
    </div>`;
}

function renderConcurrentMsg(m, idx) {
  const group = m.concurrent || {};
  const turns = Array.isArray(group.turns) ? group.turns : [];
  const status = group.status || 'running';
  const events = _concurrentTimeline(turns);
  if (status === 'running' || status === 'stopping') {
    return events.map(ev => _renderConcurrentEventMessage(ev, idx)).join('');
  }

  const html = [];
  const blocks = _concurrentBuildCollapsedBlocks(events);
  for (const block of blocks) {
    if (block.kind === 'tool') {
      html.push(_renderConcurrentToolFlowGroup(block.events, idx));
    } else if (block.kind === 'answer') {
      for (const ev of block.events) {
        html.push(_renderConcurrentAnswerFlowGroup(ev, idx));
      }
    } else {
      html.push(block.events.map(ev => _renderConcurrentEventMessage(ev, idx)).join(''));
    }
  }
  return html.join('');
}

function _concurrentWorkspaceRoot() {
  const tc = typeof TERMINAL_CONFIG !== 'undefined' ? TERMINAL_CONFIG : null;
  const root = (tc && (tc.workspace || tc.cwd)) || '';
  return String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _concurrentNormalizeSegments(path) {
  let p = String(path || '').replace(/\\/g, '/').trim();
  if (!p) return '';
  let prefix = '';
  const drive = p.match(/^[a-zA-Z]:\//);
  if (drive) {
    prefix = drive[0];
    p = p.slice(prefix.length);
  } else if (p.startsWith('//')) {
    prefix = '//';
    p = p.slice(2);
  } else if (p.startsWith('/')) {
    prefix = '/';
    p = p.slice(1);
  }
  const out = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return (prefix + out.join('/')).replace(/\/+$/, '');
}

function normalizeConcurrentPath(path) {
  let raw = String(path || '').trim();
  if (!raw || raw === '/dev/null') return '';
  raw = raw.replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  if (raw.startsWith('a/') || raw.startsWith('b/')) raw = raw.slice(2);
  const isAbs = /^[a-zA-Z]:\//.test(raw) || raw.startsWith('/');
  const root = _concurrentWorkspaceRoot();
  const full = isAbs || !root ? raw : `${root}/${raw}`;
  const normalized = _concurrentNormalizeSegments(full);
  return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function _concurrentPatchPaths(patch) {
  const lines = String(patch || '').split(/\r?\n/);
  const paths = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('--- ')) continue;
    const next = lines[i + 1] || '';
    if (!next.startsWith('+++ ')) continue;
    const oldPath = line.slice(4).split('\t')[0].trim();
    const newPath = next.slice(4).split('\t')[0].trim();
    const target = newPath && newPath !== '/dev/null' ? newPath : oldPath;
    if (target && target !== '/dev/null') paths.push(target);
  }
  return paths;
}

function _concurrentContext(context) {
  if (!context || typeof context !== 'object') return null;
  const chatId = context.concurrentChatId || context.chatId || (context.chat && context.chat.id);
  const agentId = context.concurrentAgentId || '';
  if (!chatId || !agentId) return null;
  const chat = concurrentRequestsChatById(chatId);
  if (!chat || !chat.concurrent || chat.concurrent.type !== 'concurrent_requests') return null;
  return {
    chat,
    meta: ensureConcurrentChatMeta(chat),
    agentId,
    agentName: context.concurrentAgentName || agentId
  };
}

function _concurrentMutationPaths(action, params, context) {
  const p = params || {};
  if (['write_file', 'append_file', 'edit_file', 'delete_file'].includes(action)) return [p.path].filter(Boolean);
  if (action === 'copy_file') return [p.new_path || p.newPath || p.target_path || p.targetPath || p.target_dir || p.targetDir || p.dest_dir || p.destDir].filter(Boolean);
  if (action === 'move_file') return [
    p.path,
    p.new_path || p.newPath || p.target_path || p.targetPath || p.target_dir || p.targetDir || p.dest_dir || p.destDir
  ].filter(Boolean);
  if (action === 'apply_patch') return p.dry_run ? [] : _concurrentPatchPaths(p.patch);
  if (action === 'restore_checkpoint') {
    const ctx = _concurrentContext(context);
    const id = p.checkpoint_id || p.checkpointId || '';
    const checkpoint = ctx && ctx.meta.checkpoints ? ctx.meta.checkpoints[id] : null;
    return checkpoint && Array.isArray(checkpoint.files) ? checkpoint.files : [];
  }
  if (action === 'git_restore') return [p.path, ...(Array.isArray(p.files) ? p.files : [])].filter(Boolean);
  return [];
}

function _concurrentIsMutationAction(action, params) {
  return ['write_file', 'copy_file', 'move_file', 'append_file', 'edit_file', 'delete_file', 'apply_patch', 'restore_checkpoint', 'git_restore'].includes(action)
    && !(action === 'apply_patch' && params && params.dry_run);
}

function _concurrentLooksLikeMutatingExecute(command) {
  const s = String(command || '').trim();
  if (!s) return false;
  if (/(^|[^<])>>?[^&]/.test(s)) return true;
  if (/\b(tee|sed\s+-i|perl\s+-pi)\b/i.test(s)) return true;
  if (/(^|[;&|]\s*)(rm|del|erase|rmdir|rd|mkdir|md|touch|move|mv|copy|cp|ren|rename)\b/i.test(s)) return true;
  if (/\b(new-item|set-content|add-content|out-file|remove-item|move-item|copy-item|rename-item)\b/i.test(s)) return true;
  return false;
}

function guardConcurrentFileOwnership(action, params, context) {
  const ctx = _concurrentContext(context);
  if (!ctx) return null;
  if (action === 'execute' && _concurrentLooksLikeMutatingExecute(params && params.command)) {
    return {
      ok: false,
      error: '并发请求中 execute_action 不允许执行明显会写入、删除或移动文件的命令。请改用 save_note、append_note、edit_note、apply_patch 或 delete_note 等显式文件工具，以便后台检查文件所有权；只读命令和测试命令仍可执行。'
    };
  }
  if (!_concurrentIsMutationAction(action, params)) return null;
  const rawPaths = _concurrentMutationPaths(action, params, context);
  if (!rawPaths.length) return null;
  const owners = ctx.meta.fileOwners || {};
  for (const rawPath of rawPaths) {
    const key = normalizeConcurrentPath(rawPath);
    if (!key) continue;
    const owner = owners[key];
    if (owner && owner.agentId && owner.agentId !== ctx.agentId) {
      return {
        ok: false,
        error: `并发请求文件所有权冲突：${owner.path || rawPath} 已归 ${owner.agentName || owner.agentId} 所有，当前 ${ctx.agentName} 不能修改。读操作不受影响。`
      };
    }
  }
  let changed = false;
  const now = Date.now();
  for (const rawPath of rawPaths) {
    const key = normalizeConcurrentPath(rawPath);
    if (!key || owners[key]) continue;
    owners[key] = {
      agentId: ctx.agentId,
      agentName: ctx.agentName,
      path: String(rawPath || ''),
      action,
      at: now,
      pending: true
    };
    changed = true;
  }
  if (changed) {
    ctx.meta.fileOwners = owners;
    ctx.meta.updatedAt = now;
    concurrentRequestsSaveData();
  }
  return null;
}

function _concurrentResultPaths(action, params, result, context) {
  const r = result || {};
  if (Array.isArray(r.files) && r.files.length) {
    return r.files.map(f => f && (f.path || f.rel_path)).filter(Boolean);
  }
  if (action === 'restore_checkpoint') {
    return [
      ...(Array.isArray(r.restored) ? r.restored.map(x => x.path) : []),
      ...(Array.isArray(r.deleted) ? r.deleted.map(x => x.path) : [])
    ].filter(Boolean);
  }
  if (['write_file', 'append_file', 'edit_file', 'delete_file', 'git_restore'].includes(action) && r.path) return [r.path];
  if (action === 'copy_file' && (r.new_path || r.path)) return [r.new_path || r.path];
  if (action === 'move_file') return [r.path, r.new_path].filter(Boolean);
  return _concurrentMutationPaths(action, params, context);
}

function _concurrentRememberCheckpoint(meta, checkpoint) {
  if (!checkpoint || !checkpoint.id) return;
  if (!meta.checkpoints || typeof meta.checkpoints !== 'object') meta.checkpoints = {};
  const files = Array.isArray(checkpoint.files)
    ? checkpoint.files.map(f => f && (f.path || f.absPath)).filter(Boolean)
    : [];
  meta.checkpoints[checkpoint.id] = {
    id: checkpoint.id,
    files,
    createdAt: checkpoint.createdAt || Date.now()
  };
}

function rememberConcurrentCheckpoints(result, context) {
  const ctx = _concurrentContext(context);
  if (!ctx || !result) return;
  const checkpoints = Array.isArray(result.checkpoints)
    ? result.checkpoints
    : (result.checkpoint ? [result.checkpoint] : []);
  if (!checkpoints.length) return;
  checkpoints.forEach(checkpoint => _concurrentRememberCheckpoint(ctx.meta, checkpoint));
  ctx.meta.updatedAt = Date.now();
  concurrentRequestsSaveData();
}

function _concurrentReleasePendingOwnership(ctx, action, params) {
  if (!ctx || !ctx.meta || !ctx.meta.fileOwners) return;
  const releaseContext = {
    chat: ctx.chat,
    chatId: ctx.chat && ctx.chat.id,
    concurrentChatId: ctx.chat && ctx.chat.id,
    concurrentAgentId: ctx.agentId,
    concurrentAgentName: ctx.agentName
  };
  const paths = _concurrentMutationPaths(action, params, releaseContext);
  let changed = false;
  for (const rawPath of paths) {
    const key = normalizeConcurrentPath(rawPath);
    const owner = key ? ctx.meta.fileOwners[key] : null;
    if (owner && owner.pending && owner.agentId === ctx.agentId) {
      delete ctx.meta.fileOwners[key];
      changed = true;
    }
  }
  if (changed) {
    ctx.meta.updatedAt = Date.now();
    concurrentRequestsSaveData();
  }
}

function claimConcurrentFileOwnership(action, params, result, context) {
  const ctx = _concurrentContext(context);
  if (!ctx || !result) return;
  if (!_concurrentIsMutationAction(action, params)) return;
  if (result.ok === false) {
    _concurrentReleasePendingOwnership(ctx, action, params);
    return;
  }
  _concurrentRememberCheckpoint(ctx.meta, result.checkpoint);
  const paths = _concurrentResultPaths(action, params, result, context);
  if (!paths.length) return;
  _concurrentReleasePendingOwnership(ctx, action, params);
  if (!ctx.meta.fileOwners || typeof ctx.meta.fileOwners !== 'object') ctx.meta.fileOwners = {};
  for (const rawPath of paths) {
    const key = normalizeConcurrentPath(rawPath);
    if (!key) continue;
    const existing = ctx.meta.fileOwners[key];
    if (existing && existing.agentId && existing.agentId !== ctx.agentId) continue;
    ctx.meta.fileOwners[key] = {
      agentId: ctx.agentId,
      agentName: ctx.agentName,
      path: String(rawPath || ''),
      action,
      at: Date.now()
    };
  }
  ctx.meta.updatedAt = Date.now();
  concurrentRequestsSaveData();
}

window.openConcurrentRequests = openConcurrentRequests;
window.closeConcurrentRequests = closeConcurrentRequests;
window.startConcurrentRequestFromUi = startConcurrentRequestFromUi;
window.continueConcurrentChatFromMainInput = continueConcurrentChatFromMainInput;
window.concurrentSelectTargetChanged = concurrentSelectTargetChanged;
window.stopSelectedConcurrentRequest = stopSelectedConcurrentRequest;
window.stopAllConcurrentRequests = stopAllConcurrentRequests;
window.requestStopConcurrentChat = requestStopConcurrentChat;
window.recoverInterruptedConcurrentRequests = recoverInterruptedConcurrentRequests;
window.isConcurrentChatRunning = isConcurrentChatRunning;
window.isAnyConcurrentChatRunning = isAnyConcurrentChatRunning;
window.renderConcurrentMsg = renderConcurrentMsg;
window.toggleConcurrentAgent = toggleConcurrentAgent;
window.openConcurrentChat = openConcurrentChat;
window.chooseConcurrentChat = chooseConcurrentChat;
window.guardConcurrentFileOwnership = guardConcurrentFileOwnership;
window.claimConcurrentFileOwnership = claimConcurrentFileOwnership;
window.rememberConcurrentCheckpoints = rememberConcurrentCheckpoints;
window.normalizeConcurrentPath = normalizeConcurrentPath;

window.AgentApp.define('concurrentRequests', {
  CONCURRENT_REQUESTS_SETTINGS_KEY,
  CONCURRENT_RUNTIME,
  loadConcurrentRequestSettings,
  saveConcurrentRequestSettings,
  concurrentAgentName,
  ensureConcurrentChatMeta,
  isConcurrentChatRunning,
  isAnyConcurrentChatRunning,
  requestStopConcurrentChat,
  recoverInterruptedConcurrentRequests,
  stopSelectedConcurrentRequest,
  stopAllConcurrentRequests,
  startConcurrentRound,
  startConcurrentRequestFromUi,
  continueConcurrentChatFromMainInput,
  concurrentSelectTargetChanged,
  openConcurrentChat,
  chooseConcurrentChat,
  openConcurrentRequests,
  closeConcurrentRequests,
  renderConcurrentRequestsModal,
  toggleConcurrentAgent,
  renderConcurrentMsg,
  normalizeConcurrentPath,
  guardConcurrentFileOwnership,
  claimConcurrentFileOwnership,
  rememberConcurrentCheckpoints
});
