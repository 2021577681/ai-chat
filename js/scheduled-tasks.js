// ============ ⏰ 定时发送 ============
// 用户消息立即进入主对话并显示倒计时；到点后解除 _hiddenFromAI，复用普通/计划/大纲等发送流程。

const SCHEDULED_TASK_STATUS = {
  WAITING: 'waiting',
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error'
};

const ScheduledTasksStateModule = window.AgentApp.require('state');
const scheduledTasksState = ScheduledTasksStateModule.state;
const scheduledTasksSaveData = ScheduledTasksStateModule.saveData;
const scheduledTasksCurrentChat = ScheduledTasksStateModule.currentChat;
const scheduledTasksIsCurrentChat = ScheduledTasksStateModule.isCurrentChat;
const scheduledTasksIsChatGenerating = ScheduledTasksStateModule.isChatGenerating;
const ScheduledTasksOrchestrationService = window.AgentApp.require('orchestrationService');
const ScheduledTasksUiService = window.AgentApp.require('uiService');

let _scheduledSendActive = false;
const _scheduledProcessing = new Set();

function scheduledTasksRefreshMessage(idx, chat) {
  if (!chat || !scheduledTasksIsCurrentChat(chat.id)) return;
  if (ScheduledTasksUiService.has('refreshMsgNode')) ScheduledTasksUiService.refreshMsgNode(idx, chat);
  else ScheduledTasksUiService.renderMessages();
}

function scheduledPad(n) {
  return String(n).padStart(2, '0');
}

function toDatetimeLocalValue(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return [
    d.getFullYear(), '-', scheduledPad(d.getMonth() + 1), '-', scheduledPad(d.getDate()),
    'T', scheduledPad(d.getHours()), ':', scheduledPad(d.getMinutes())
  ].join('');
}

function parseScheduleTimeInput() {
  const input = document.getElementById('scheduleTimeInput');
  if (!input || !input.value) return 0;
  const t = new Date(input.value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function formatScheduleDateTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  return `${d.getFullYear()}-${scheduledPad(d.getMonth() + 1)}-${scheduledPad(d.getDate())} ${scheduledPad(d.getHours())}:${scheduledPad(d.getMinutes())}`;
}

function formatDurationCompact(ms) {
  ms = Math.max(0, Number(ms) || 0);
  const total = Math.ceil(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}天 ${scheduledPad(hours)}:${scheduledPad(mins)}:${scheduledPad(secs)}`;
  if (hours > 0) return `${hours}:${scheduledPad(mins)}:${scheduledPad(secs)}`;
  return `${mins}:${scheduledPad(secs)}`;
}

function isScheduledSendActive() {
  return !!_scheduledSendActive;
}

function getScheduledSendInfoText() {
  const runAt = parseScheduleTimeInput();
  if (!runAt) return '⏰ 定时发送 · 请选择时间';
  const delta = runAt - Date.now();
  if (delta <= 0) return '⏰ 定时发送 · 时间已到，发送后立即响应';
  return `⏰ 定时发送 · ${formatScheduleDateTime(runAt)} · 倒计时 ${formatDurationCompact(delta)}`;
}

function syncScheduledSendUI() {
  const btn = document.getElementById('scheduleBtn');
  const picker = document.getElementById('schedulePicker');
  const input = document.getElementById('scheduleTimeInput');
  if (btn) btn.classList.toggle('schedule-active', !!_scheduledSendActive);
  if (picker) picker.hidden = !_scheduledSendActive;
  if (_scheduledSendActive && input && !input.value) {
    input.value = toDatetimeLocalValue(Date.now() + 10 * 60 * 1000);
  }
  ScheduledTasksUiService.updateSendBtn();
}

function toggleScheduledSend(force) {
  _scheduledSendActive = typeof force === 'boolean' ? force : !_scheduledSendActive;
  syncScheduledSendUI();
  if (_scheduledSendActive) {
    const input = document.getElementById('scheduleTimeInput');
    if (input) setTimeout(() => input.focus(), 0);
  }
}

function scheduledModeLabel(mode) {
  return mode === 'outline' ? '大纲模式'
    : mode === 'plan' ? '计划模式'
    : mode === 'reflection' ? '师生模式'
    : mode === 'ppt' ? 'PPT 模式'
    : '普通对话';
}

function createScheduledMessageFromComposer(chat, input, text) {
  if (!chat) return null;
  const runAt = parseScheduleTimeInput();
  if (!runAt) {
    ScheduledTasksUiService.toast('请选择定时发送时间', 2500);
    return null;
  }
  if (!text && !(scheduledTasksState.pendingAttachments && scheduledTasksState.pendingAttachments.length)) return null;
  if (!scheduledTasksState.settings.apiKey) {
    alert('请先在「设置」中填写 API Key');
    if (typeof openSettings === 'function') openSettings();
    return null;
  }
  if (typeof ensureCompletionSoundReady === 'function') ensureCompletionSoundReady();
  if (typeof resetTaskPermission === 'function') resetTaskPermission();

  const mode = (typeof _consumeOneShotMode === 'function') ? _consumeOneShotMode() : 'normal';
  const userMsg = _buildUserMessageFromInput(chat, text);
  userMsg._hiddenFromAI = true;
  userMsg._scheduled = {
    id: 'sch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    runAt,
    createdAt: Date.now(),
    status: SCHEDULED_TASK_STATUS.WAITING,
    mode
  };
  chat.messages.push(userMsg);
  if (typeof traceUserMessage === 'function') traceUserMessage(text);
  if (typeof _clearComposerAfterSend === 'function') _clearComposerAfterSend(input);
  _scheduledSendActive = false;
  syncScheduledSendUI();
  ScheduledTasksUiService.toast(`⏰ 已创建定时任务：${formatScheduleDateTime(runAt)}`, 2200);
  return userMsg;
}

function scheduledInfoForMessage(m) {
  return m && m._scheduled && typeof m._scheduled === 'object' ? m._scheduled : null;
}

function scheduledCountdownText(info) {
  if (!info) return '';
  const status = info.status || SCHEDULED_TASK_STATUS.WAITING;
  if (status === SCHEDULED_TASK_STATUS.RUNNING) return '⏰ 正在响应';
  if (status === SCHEDULED_TASK_STATUS.DONE) return '⏰ 已触发';
  if (status === SCHEDULED_TASK_STATUS.ERROR) return '⏰ 触发失败';
  const left = (Number(info.runAt) || 0) - Date.now();
  return left <= 0 ? '⏰ 即将响应' : `⏰ ${formatDurationCompact(left)}`;
}

function formatScheduledCountdown(m, idx) {
  const info = scheduledInfoForMessage(m);
  if (!info) return '';
  const status = info.status || SCHEDULED_TASK_STATUS.WAITING;
  const due = status !== SCHEDULED_TASK_STATUS.WAITING || (Number(info.runAt) || 0) <= Date.now();
  return `<span class="scheduled-countdown ${due ? 'due' : ''}" data-msg-idx="${idx}" data-run-at="${Number(info.runAt) || 0}">${escapeHtml(scheduledCountdownText(info))}</span>`;
}

function renderScheduledMeta(m) {
  const info = scheduledInfoForMessage(m);
  if (!info) return '';
  const mode = scheduledModeLabel(info.mode || 'normal');
  const status = info.status === SCHEDULED_TASK_STATUS.DONE ? '已触发'
    : info.status === SCHEDULED_TASK_STATUS.RUNNING ? '正在响应'
    : info.status === SCHEDULED_TASK_STATUS.ERROR ? `触发失败：${info.error || '未知错误'}`
    : '等待触发';
  return `<div class="scheduled-meta">定时任务 · ${escapeHtml(mode)} · ${escapeHtml(formatScheduleDateTime(info.runAt))} · ${escapeHtml(status)}</div>`;
}

function updateScheduledCountdownNodes(chat) {
  const c = chat || scheduledTasksCurrentChat();
  if (!c) return;
  document.querySelectorAll('.scheduled-countdown[data-msg-idx]').forEach(el => {
    const idx = parseInt(el.dataset.msgIdx, 10);
    const m = c.messages && c.messages[idx];
    const info = scheduledInfoForMessage(m);
    if (!info) return;
    el.textContent = scheduledCountdownText(info);
    const due = (info.status || SCHEDULED_TASK_STATUS.WAITING) !== SCHEDULED_TASK_STATUS.WAITING || (Number(info.runAt) || 0) <= Date.now();
    el.classList.toggle('due', due);
  });
}

function findDueScheduledMessages(now = Date.now()) {
  const out = [];
  const chats = [...(scheduledTasksState.chats || []), scheduledTasksState.temporaryChat].filter(Boolean);
  for (const chat of chats) {
    if (!chat || !Array.isArray(chat.messages)) continue;
    chat.messages.forEach((m, idx) => {
      const info = scheduledInfoForMessage(m);
      if (!info || (info.status || SCHEDULED_TASK_STATUS.WAITING) !== SCHEDULED_TASK_STATUS.WAITING) return;
      if ((Number(info.runAt) || 0) <= now) out.push({ chat, idx, msg: m, info });
    });
  }
  return out;
}

async function runScheduledMessage(chat, idx, msg, info) {
  if (!chat || !msg || !info) return;
  const key = `${chat.id}:${info.id || idx}`;
  if (_scheduledProcessing.has(key)) return;
  if (scheduledTasksIsChatGenerating(chat.id)) return;
  _scheduledProcessing.add(key);
  info.status = SCHEDULED_TASK_STATUS.RUNNING;
  delete msg._hiddenFromAI;
  scheduledTasksRefreshMessage(idx, chat);
  scheduledTasksSaveData();

  try {
    if (typeof resetTaskPermission === 'function') resetTaskPermission();
    if (typeof autoCompressCheck === 'function') {
      let compressResult;
      msg._hiddenFromAI = true;
      try {
        compressResult = await autoCompressCheck(chat, { touchGlobalGenerating: true });
      } finally {
        delete msg._hiddenFromAI;
      }
      if (compressResult === 'failed') throw new Error('自动压缩失败，本轮请求已取消，避免发送超长上下文');
    }

    const mode = info.mode || 'normal';
    if (mode === 'outline') await ScheduledTasksOrchestrationService.callAPIWithOutline({ chatId: chat.id });
    else if (mode === 'plan') await ScheduledTasksOrchestrationService.callAPIWithPlan({ chatId: chat.id });
    else if (mode === 'ppt') await ScheduledTasksOrchestrationService.callAPIWithPptMode({ chatId: chat.id, contextChecked: true });
    else if (mode === 'reflection') await ScheduledTasksOrchestrationService.callAPIWithReflection({ chatId: chat.id });
    else await ScheduledTasksOrchestrationService.callAPI(undefined, { chatId: chat.id, contextChecked: true });

    info.status = SCHEDULED_TASK_STATUS.DONE;
    info.triggeredAt = Date.now();
  } catch (e) {
    console.error('[scheduled] 定时任务触发失败:', e);
    info.status = SCHEDULED_TASK_STATUS.ERROR;
    info.error = e && e.message ? e.message : String(e || '未知错误');
    if (scheduledTasksIsCurrentChat(chat.id)) ScheduledTasksUiService.toast('❌ 定时任务触发失败：' + info.error, 3500);
  } finally {
    _scheduledProcessing.delete(key);
    scheduledTasksRefreshMessage(idx, chat);
    ScheduledTasksUiService.renderChatList();
    ScheduledTasksUiService.updateSendBtn();
    scheduledTasksSaveData();
  }
}

function processScheduledTasks() {
  const due = findDueScheduledMessages();
  for (const item of due) {
    runScheduledMessage(item.chat, item.idx, item.msg, item.info);
  }
}

function initScheduledSend() {
  const input = document.getElementById('scheduleTimeInput');
  if (input && !input.dataset.boundScheduledChange) {
    input.dataset.boundScheduledChange = '1';
    input.addEventListener('input', () => {
      ScheduledTasksUiService.updateSendBtn();
    });
  }
  syncScheduledSendUI();
  processScheduledTasks();
}

window.isScheduledSendActive = isScheduledSendActive;
window.getScheduledSendInfoText = getScheduledSendInfoText;
window.syncScheduledSendUI = syncScheduledSendUI;
window.toggleScheduledSend = toggleScheduledSend;
window.createScheduledMessageFromComposer = createScheduledMessageFromComposer;
window.scheduledInfoForMessage = scheduledInfoForMessage;
window.formatScheduledCountdown = formatScheduledCountdown;
window.renderScheduledMeta = renderScheduledMeta;
window.updateScheduledCountdownNodes = updateScheduledCountdownNodes;
window.findDueScheduledMessages = findDueScheduledMessages;
window.runScheduledMessage = runScheduledMessage;
window.processScheduledTasks = processScheduledTasks;
window.initScheduledSend = initScheduledSend;

window.AgentApp.define('scheduledTasks', {
  SCHEDULED_TASK_STATUS,
  isScheduledSendActive,
  getScheduledSendInfoText,
  syncScheduledSendUI,
  toggleScheduledSend,
  createScheduledMessageFromComposer,
  scheduledInfoForMessage,
  formatScheduledCountdown,
  renderScheduledMeta,
  updateScheduledCountdownNodes,
  findDueScheduledMessages,
  runScheduledMessage,
  processScheduledTasks,
  initScheduledSend
});
