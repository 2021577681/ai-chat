// ============ 🎮 微信文件传输助手遥控 Agent ============
// 隐私边界：本模块只调用 wechat_filehelper_poll / wechat_filehelper_send，底层工具硬编码为“文件传输助手”。

const REMOTE_CONTROL_DEFAULTS = {
  enabled: false,
  pollIntervalSec: 5,
  pollLimit: 20,
  inputPrefix: '/',
  inputSeparator: '：',
  outputTemplate: '[Agent][{id}][No{no}]:\n{answer}',
  agentPrefix: '[Agent]',
  shortReplyPrompt: '你正通过微信文件传输助手被遥控。请只输出最终答案，不展示工具调用过程或大纲过程；回答要简短，适合微信阅读。',
  autoSendErrors: true,
  ignoreAgentMessages: true,
  maxReplyChars: 3000
};

let remoteControlTimer = null;
let remoteControlPolling = false;
let remoteControlBridgeStartPromise = null;
const remoteControlKnownChats = new Map(); // remoteId -> chatId
let remoteControlRuntimeGeneration = 0;
let remoteControlActiveCommands = 0;
let remoteControlPendingSends = 0;
const remoteControlInFlightMessages = new Set();
const remoteControlProcessedMessages = new Map();
const remoteControlRemoteLocks = new Set();

function remoteControlNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function remoteControlLogTiming(label, startedAt, extra = '') {
  const elapsed = Math.round(remoteControlNow() - startedAt);
  console.info(`[remote-control] ${label} ${elapsed}ms${extra ? ' ' + extra : ''}`);
}

async function remoteControlStartBridge() {
  if (remoteControlBridgeStartPromise) return remoteControlBridgeStartPromise;
  remoteControlBridgeStartPromise = (async () => {
    if (typeof callAgentBackend !== 'function') {
      throw new Error('local backend is not available');
    }
    const startedAt = remoteControlNow();
    const r = await callAgentBackend('wechat_bridge', {
      op: 'start',
      requestTimeoutMs: 120000
    }, undefined, undefined, { skipConfirm: true });
    remoteControlLogTiming('wechat bridge start', startedAt, r && r.pid ? `pid=${r.pid}` : '');
    if (!r || !r.ok) throw new Error((r && r.error) || 'failed to start WeChat bridge');
    return r;
  })();
  try {
    return await remoteControlBridgeStartPromise;
  } finally {
    remoteControlBridgeStartPromise = null;
  }
}

async function remoteControlStopBridge() {
  if (typeof callAgentBackend !== 'function') return null;
  const startedAt = remoteControlNow();
  const r = await callAgentBackend('wechat_bridge', {
    op: 'stop',
    requestTimeoutMs: 15000
  }, undefined, undefined, { skipConfirm: true });
  remoteControlLogTiming('wechat bridge stop', startedAt);
  if (!r || !r.ok) console.warn('[remote-control] stop bridge failed:', r);
  return r;
}

function remoteControlClearTimer() {
  if (remoteControlTimer) clearTimeout(remoteControlTimer);
  remoteControlTimer = null;
}

async function remoteControlStartRuntime() {
  try {
    const generation = ++remoteControlRuntimeGeneration;
    await remoteControlStartBridge();
    if (generation !== remoteControlRuntimeGeneration || !remoteControlSettings().enabled) return;
    remoteControlPollOnce();
    if (generation === remoteControlRuntimeGeneration && remoteControlSettings().enabled && typeof toast === 'function') toast('微信遥控 bridge 已启动');
  } catch (e) {
    if (!remoteControlSettings().enabled) return;
    console.error('[remote-control] bridge start failed:', e);
    const cfg = remoteControlSettings();
    cfg.enabled = false;
    remoteControlClearTimer();
    persistSettings();
    syncRemoteControlButton();
    if (typeof toast === 'function') toast('微信遥控 bridge 启动失败：' + (e.message || e), 4000);
  }
}

async function remoteControlStopRuntime() {
  remoteControlRuntimeGeneration++;
  remoteControlClearTimer();
  try {
    remoteControlActiveCommands = 0;
    remoteControlPendingSends = 0;
    remoteControlPolling = false;
    await remoteControlStopBridge();
  } catch (e) {
    console.warn('[remote-control] bridge stop failed:', e);
  }
}

function remoteControlSettings() {
  if (!state.settings.remoteControl || typeof state.settings.remoteControl !== 'object') {
    state.settings.remoteControl = {};
  }
  state.settings.remoteControl = { ...REMOTE_CONTROL_DEFAULTS, ...state.settings.remoteControl };
  return state.settings.remoteControl;
}

function remoteControlNormalizeText(text) {
  return String(text || '').replace(/／/g, '/').replace(/：/g, ':').trim();
}

function remoteControlSplitCommand(text) {
  const normalized = remoteControlNormalizeText(text);
  const idx = normalized.indexOf(':');
  if (idx < 0) return { opPart: normalized, body: '' };
  return { opPart: normalized.slice(0, idx).trim(), body: normalized.slice(idx + 1).trim() };
}

function remoteControlNormalizeCommandTokens(tokens) {
  const normalized = [];
  for (const rawToken of tokens || []) {
    const token = String(rawToken || '').trim();
    if (!token) continue;
    const glued = token.match(/^(新建对话|新建|临时对话|临时|大纲|计划|工具|普通|状态|停止|帮助)(\d+)$/);
    if (glued) {
      normalized.push(glued[1], glued[2]);
    } else {
      normalized.push(token);
    }
  }
  return normalized;
}

function remoteControlParseMessage(text) {
  const { opPart, body } = remoteControlSplitCommand(text);
  if (!opPart.startsWith('/')) return { ok: false, error: '消息不是遥控指令：需要以 / 开头' };
  const tokens = remoteControlNormalizeCommandTokens(opPart.split('/').map(s => s.trim()).filter(Boolean));
  if (!tokens.length) return { ok: false, error: '缺少遥控操作符' };

  const aliases = {
    '新建对话': 'new', '新建': 'new', 'new': 'new', '临时对话': 'temporary', '临时': 'temporary', 'tmp': 'temporary',
    '大纲': 'outline', 'outline': 'outline', '计划': 'plan', 'plan': 'plan',
    '工具': 'tools', 'tool': 'tools', 'tools': 'tools',
    '普通': 'normal', 'normal': 'normal', '帮助': 'help', 'help': 'help',
    '状态': 'status', 'status': 'status', '停止': 'stop', 'stop': 'stop'
  };

  const result = {
    ok: true,
    raw: text,
    body,
    create: false,
    temporary: false,
    outline: false,
    plan: false,
    tools: false,
    normal: false,
    help: false,
    status: false,
    stop: false,
    id: ''
  };

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      result.id = token;
      continue;
    }
    const op = aliases[token] || token;
    if (op === 'new') result.create = true;
    else if (op === 'temporary') result.temporary = true;
    else if (op === 'outline') result.outline = true;
    else if (op === 'plan') result.plan = true;
    else if (op === 'tools') result.tools = true;
    else if (op === 'normal') result.normal = true;
    else if (op === 'help') result.help = true;
    else if (op === 'status') result.status = true;
    else if (op === 'stop') result.stop = true;
  }

  if (result.help || result.status) return result;
  if (!result.id) return { ok: false, error: '缺少对话编号，例如 /新建对话/1：你好 或 /1：继续' };
  if (result.create && tokens[0] !== '新建对话' && tokens[0] !== '新建' && tokens[0] !== 'new') {
    return { ok: false, error: '/新建对话/序号 必须放在开头，例如 /新建对话/1：你好；也支持 /新建对话1：你好' };
  }
  if (!result.body && !result.stop) return { ok: false, error: '缺少正文，请用冒号分隔，例如 /1：帮我总结' };
  return result;
}

function remoteControlFindChat(remoteId) {
  const cached = remoteControlKnownChats.get(String(remoteId));
  if (cached) {
    const c = chatById(cached);
    if (c) return c;
    remoteControlKnownChats.delete(String(remoteId));
  }
  const c = (state.chats || []).find(chat => chat && chat.remoteControl && String(chat.remoteControl.id) === String(remoteId));
  if (c) remoteControlKnownChats.set(String(remoteId), c.id);
  return c || null;
}

function remoteControlForgetChat(chatOrId) {
  const chat = (chatOrId && typeof chatOrId === 'object')
    ? chatOrId
    : (typeof chatById === 'function' ? chatById(chatOrId) : null);
  if (!chat || !chat.remoteControl || !chat.remoteControl.id) return false;
  const remoteId = String(chat.remoteControl.id);
  const cachedChatId = remoteControlKnownChats.get(remoteId);
  if (!cachedChatId || cachedChatId === chat.id) {
    remoteControlKnownChats.delete(remoteId);
  }
  return true;
}

function remoteControlPruneKnownChats() {
  for (const [remoteId, chatId] of remoteControlKnownChats.entries()) {
    const c = typeof chatById === 'function' ? chatById(chatId) : null;
    if (!c || !c.remoteControl || String(c.remoteControl.id) !== String(remoteId)) {
      remoteControlKnownChats.delete(remoteId);
    }
  }
}

function remoteControlUsedIdEntries() {
  const rows = [];
  const seen = new Set();
  for (const chat of state.chats || []) {
    if (!chat || !chat.remoteControl || !chat.remoteControl.id) continue;
    const remoteId = String(chat.remoteControl.id);
    if (seen.has(remoteId)) continue;
    seen.add(remoteId);
    remoteControlKnownChats.set(remoteId, chat.id);
    rows.push({
      remoteId,
      chatId: chat.id,
      title: chat.title || `遥控 ${remoteId}`,
      replyNo: chat.remoteControl.replyNo || 0,
      temporary: !!chat.temporary || !!chat.remoteControl.temporary
    });
  }
  rows.sort((a, b) => {
    const an = Number(a.remoteId);
    const bn = Number(b.remoteId);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return String(a.remoteId).localeCompare(String(b.remoteId), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
  return rows;
}

function remoteControlRenderUsedIdsList() {
  remoteControlPruneKnownChats();
  const el = document.getElementById('remoteControlUsedIdsList');
  if (!el) return;
  const rows = remoteControlUsedIdEntries();
  if (!rows.length) {
    el.textContent = '暂无已绑定的遥控对话。';
    return;
  }
  el.innerHTML = rows.map(row => {
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const safeId = esc(String(row.remoteId));
    const meta = `对话：${String(row.title || `遥控 ${row.remoteId}`)}；AI回复 ${row.replyNo || 0} 条${row.temporary ? '；临时对话' : ''}`;
    return `<div><strong>#${safeId}</strong> <span>${esc(meta)}</span></div>`;
  }).join('');
}

function remoteControlCreateChat(remoteId, opts = {}) {
  const id = (opts.temporary ? 'tmp_remote_' : 'c_remote_') + String(remoteId).replace(/[^\w-]/g, '_') + '_' + Date.now();
  const chat = {
    id,
    title: `遥控 ${remoteId}`,
    messages: [],
    createdAt: Date.now(),
    temporary: !!opts.temporary,
    remoteControl: {
      id: String(remoteId),
      replyNo: 0,
      useToolsDefault: !!opts.tools,
      temporary: !!opts.temporary
    }
  };
  state.chats.unshift(chat);
  state.currentId = id;
  remoteControlKnownChats.set(String(remoteId), id);
  if (typeof syncGlobalTaskState === 'function') syncGlobalTaskState(id);
  return chat;
}

function remoteControlDeduplicateRemoteChats(remoteId) {
  const matches = (state.chats || []).filter(chat => chat && chat.remoteControl && String(chat.remoteControl.id) === String(remoteId));
  if (!matches.length) return null;
  matches.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const keeper = matches[0];
  remoteControlKnownChats.set(String(remoteId), keeper.id);
  return keeper;
}

function remoteControlEnsureChat(parsed) {
  let chat = remoteControlFindChat(parsed.id) || remoteControlDeduplicateRemoteChats(parsed.id);
  if (!chat) {
    chat = remoteControlCreateChat(parsed.id, { tools: parsed.tools, temporary: parsed.temporary });
  } else if (parsed.tools) {
    chat.remoteControl = chat.remoteControl || { id: String(parsed.id), replyNo: 0 };
    chat.remoteControl.useToolsDefault = true;
  }
  chat.remoteControl = chat.remoteControl || { id: String(parsed.id), replyNo: 0 };
  return chat;
}

function remoteControlUserContent(parsed) {
  const cfg = remoteControlSettings();
  const prompt = String(cfg.shortReplyPrompt || '').trim();
  return prompt ? `${prompt}\n\n用户微信指令：${parsed.body}` : parsed.body;
}

function remoteControlAppendUser(chat, content) {
  const userMsg = { role: 'user', content };
  chat.messages.push(userMsg);
  if (!chat.title || chat.title === '新对话' || chat.title.startsWith('遥控 ')) {
    const clean = content.replace(/^.*?用户微信指令：/s, '').trim();
    chat.title = `遥控 ${chat.remoteControl && chat.remoteControl.id ? chat.remoteControl.id : ''} · ${clean.slice(0, 18) || '新指令'}`;
  }
  if (typeof maybeInsertBeacon === 'function') {
    try { maybeInsertBeacon(chat); } catch (e) { console.warn('[remote-control] beacon failed:', e); }
  }
  saveData();
  renderChatList();
  if (isCurrentChat(chat)) renderMessages();
}

function remoteControlLatestAssistantText(chat, fromIndex) {
  for (let i = (chat.messages || []).length - 1; i >= Math.max(0, fromIndex || 0); i--) {
    const m = chat.messages[i];
    if (m && m.role === 'assistant' && !m._hiddenFromUI) {
      if (m.outline && m.outline.finalAnswer) return String(m.outline.finalAnswer || '').trim();
      if (m.plan && m.plan.finalAnswer) return String(m.plan.finalAnswer || '').trim();
      if (m.content) return String(m.content || '').trim();
    }
  }
  return '';
}

function remoteControlFormatReply(remoteId, replyNo, answer) {
  const cfg = remoteControlSettings();
  const maxChars = Math.max(200, parseInt(cfg.maxReplyChars || 3000, 10) || 3000);
  let text = String(answer || '').trim() || '（无文本回复）';
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…（已截断）';
  const tpl = cfg.outputTemplate || REMOTE_CONTROL_DEFAULTS.outputTemplate;
  return tpl.replaceAll('{id}', String(remoteId)).replaceAll('{no}', String(replyNo)).replaceAll('{answer}', text);
}

function remoteControlFormatSystem(message) {
  return `[System]\n${String(message || '').trim()}`;
}

async function remoteControlSendWechat(text) {
  const startedAt = remoteControlNow();
  remoteControlPendingSends++;
  remoteControlClearTimer();
  try {
    if (typeof callAgentBackend === 'function') {
      const b64 = btoa(unescape(encodeURIComponent(String(text || ''))));
      const r = await callAgentBackend('wechat_bridge', {
        op: 'send',
        text_base64: b64,
        prefix: '',
        requestTimeoutMs: 90000,
        bridge_timeout: 90
      }, undefined, undefined, { skipConfirm: true });
      remoteControlLogTiming('wechat send', startedAt, `chars=${String(text || '').length}`);
      if (!r || !r.ok) throw new Error((r && r.error) || JSON.stringify(r));
      return r;
    }

    const result = await executeTool('wechat_filehelper_send', { text }, { skipConfirm: true });
    remoteControlLogTiming('wechat send', startedAt, `chars=${String(text || '').length}`);
    if (!result.ok) throw new Error(typeof result.value === 'string' ? result.value : JSON.stringify(result.value));
    return result.value;
  } finally {
    remoteControlPendingSends = Math.max(0, remoteControlPendingSends - 1);
    if (remoteControlSettings().enabled && remoteControlActiveCommands <= 0 && remoteControlPendingSends <= 0) {
      remoteControlScheduleNext();
    }
  }
}

function remoteControlCanSchedulePoll() {
  return remoteControlSettings().enabled && remoteControlActiveCommands <= 0 && remoteControlPendingSends <= 0;
}

function remoteControlMessageKey(msg) {
  if (msg && msg.id) return `id:${String(msg.id)}`;
  const content = String((msg && msg.content) || '').trim();
  const stable = msg && (msg.stable_id || msg.stableId);
  return `fallback:${stable || ''}:${content}`;
}

function remoteControlRememberProcessed(key) {
  const now = Date.now();
  remoteControlProcessedMessages.set(key, now);
  const max = 300;
  if (remoteControlProcessedMessages.size > max) {
    const entries = Array.from(remoteControlProcessedMessages.entries()).sort((a, b) => a[1] - b[1]);
    for (const [oldKey] of entries.slice(0, remoteControlProcessedMessages.size - max)) {
      remoteControlProcessedMessages.delete(oldKey);
    }
  }
}

function remoteControlAcquireRemoteLock(remoteId) {
  const key = String(remoteId || '');
  if (!key) return true;
  if (remoteControlRemoteLocks.has(key)) return false;
  remoteControlRemoteLocks.add(key);
  return true;
}

async function remoteControlRunChat(chat, parsed) {
  const remoteId = String(parsed.id);
  if (typeof isChatGenerating === 'function' && isChatGenerating(chat.id)) {
    await remoteControlSendWechat(remoteControlFormatReply(remoteId, (chat.remoteControl.replyNo || 0) + 1, '该对话正在生成中，请稍后再发。你也可以用其他编号新建并行对话。'));
    return;
  }

  const before = chat.messages.length;
  remoteControlAppendUser(chat, remoteControlUserContent(parsed));
  const useTools = !!(parsed.tools || (chat.remoteControl && chat.remoteControl.useToolsDefault));
  try {
    const apiStartedAt = remoteControlNow();
    if (parsed.outline) await callAPIWithOutline({ chatId: chat.id, useTools, suppressCompletionSound: true, contextChecked: true });
    else if (parsed.plan) await callAPIWithPlan({ chatId: chat.id, useTools, suppressCompletionSound: true, contextChecked: true });
    else await callAPI(undefined, { chatId: chat.id, useTools, suppressCompletionSound: true, contextChecked: true, extraSystemPrompt: (remoteControlSettings().shortReplyPrompt || '') });
    remoteControlLogTiming('api complete', apiStartedAt, `chat=${chat.id}`);
  } catch (e) {
    console.error('[remote-control] run failed:', e);
    if (remoteControlSettings().autoSendErrors) {
      chat.remoteControl.replyNo = (chat.remoteControl.replyNo || 0) + 1;
      await remoteControlSendWechat(remoteControlFormatReply(remoteId, chat.remoteControl.replyNo, '执行失败：' + (e.message || e)));
    }
    return;
  }
  chat.remoteControl.replyNo = (chat.remoteControl.replyNo || 0) + 1;
  const answer = remoteControlLatestAssistantText(chat, before);
  await remoteControlSendWechat(remoteControlFormatReply(remoteId, chat.remoteControl.replyNo, answer));
  saveData();
}

async function remoteControlHandleParsed(parsed) {
  if (parsed.help) {
    await remoteControlSendWechat('[Agent][Help]:\n用法：/新建对话/1/大纲/工具：任务；继续：/1：追加指令。支持 /工具、/大纲、/计划、/临时对话、/状态、/停止。');
    return;
  }
  if (parsed.status) {
    const tasks = (typeof ensureChatTasks === 'function') ? ensureChatTasks() : {};
    const running = Object.values(tasks).filter(t => t && t.isGenerating).map(t => t.chatId).length;
    remoteControlPruneKnownChats();
    await remoteControlSendWechat(`[Agent][Status]:\n遥控已开启；运行中任务 ${running} 个；已绑定对话 ${remoteControlKnownChats.size} 个。`);
    return;
  }
  const lockId = parsed.id ? String(parsed.id) : '';
  if (lockId && !remoteControlAcquireRemoteLock(lockId)) {
    console.warn('[remote-control] duplicate/in-flight remote id ignored:', lockId);
    return;
  }
  try {
    const existingChat = remoteControlFindChat(parsed.id) || remoteControlDeduplicateRemoteChats(parsed.id);
    if (parsed.create && existingChat) {
      await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${parsed.id} 已存在，不能重复创建。请直接发送 /${parsed.id}：继续对话，或删除该对话后再新建。`));
      return;
    }
    if (!parsed.create && !existingChat) {
      await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${parsed.id} 不存在，请先发送 /新建对话/${parsed.id}：你的问题 来新建对话。`));
      return;
    }

    const chat = existingChat || remoteControlEnsureChat(parsed);
    if (parsed.tools && chat) {
      chat.remoteControl = chat.remoteControl || { id: String(parsed.id), replyNo: 0 };
      chat.remoteControl.useToolsDefault = true;
    }
    if (parsed.stop) {
      if (typeof requestStopChatTask === 'function') requestStopChatTask(chat.id);
      await remoteControlSendWechat(remoteControlFormatReply(parsed.id, (chat.remoteControl.replyNo || 0) + 1, '已请求停止该对话任务。'));
      return;
    }
    await remoteControlRunChat(chat, parsed);
  } finally {
    if (lockId) remoteControlRemoteLocks.delete(lockId);
  }
}

function remoteControlDispatchParsed(parsed, msg) {
  const messageKey = remoteControlMessageKey(msg || parsed);
  if (remoteControlInFlightMessages.has(messageKey) || remoteControlProcessedMessages.has(messageKey)) {
    console.warn('[remote-control] duplicate message ignored:', messageKey);
    return;
  }
  remoteControlInFlightMessages.add(messageKey);
  remoteControlActiveCommands++;
  remoteControlClearTimer();
  Promise.resolve()
    .then(() => remoteControlHandleParsed(parsed))
    .catch(e => {
      console.error('[remote-control] async command failed:', e);
      if (typeof toast === 'function') toast('遥控指令执行失败：' + (e.message || e), 3000);
    })
    .finally(() => {
      remoteControlInFlightMessages.delete(messageKey);
      remoteControlRememberProcessed(messageKey);
      remoteControlActiveCommands = Math.max(0, remoteControlActiveCommands - 1);
      if (remoteControlCanSchedulePoll()) remoteControlScheduleNext();
    });
}

async function remoteControlPollOnce() {
  if (remoteControlPolling) return;
  if (!remoteControlSettings().enabled) return;
  remoteControlPolling = true;
  try {
    const cfg = remoteControlSettings();
    const limit = Math.max(1, Math.min(50, parseInt(cfg.pollLimit || 20, 10) || 20));
    const pollStartedAt = remoteControlNow();
    const result = await executeTool('wechat_filehelper_poll', { limit, timeout: 0, interval: 1 }, { skipConfirm: true });
    remoteControlLogTiming('wechat poll', pollStartedAt, `limit=${limit}`);
    if (!result.ok) throw new Error(typeof result.value === 'string' ? result.value : JSON.stringify(result.value));
    const payload = result.value && result.value.stdout ? JSON.parse(result.value.stdout) : (typeof result.value === 'string' ? JSON.parse(result.value) : result.value);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    for (const msg of messages) {
      const content = String(msg.content || '').trim();
      if (!content) continue;
      if (cfg.ignoreAgentMessages && content.startsWith(cfg.agentPrefix || '[Agent]')) continue;
      const parsed = remoteControlParseMessage(content);
      if (!parsed.ok) {
        if (cfg.autoSendErrors && content.startsWith('/')) await remoteControlSendWechat('[Agent][Error]:\n' + parsed.error);
        continue;
      }
      remoteControlDispatchParsed(parsed, msg);
    }
  } catch (e) {
    console.error('[remote-control] poll failed:', e);
    if (typeof toast === 'function') toast('遥控轮询失败：' + (e.message || e), 3000);
  } finally {
    remoteControlPolling = false;
    if (remoteControlCanSchedulePoll()) remoteControlScheduleNext();
  }
}

function remoteControlScheduleNext() {
  if (remoteControlTimer) {
    clearTimeout(remoteControlTimer);
    remoteControlTimer = null;
  }
  const cfg = remoteControlSettings();
  if (!cfg.enabled) return;
  if (remoteControlActiveCommands > 0 || remoteControlPendingSends > 0) return;
  const ms = Math.max(1, parseFloat(cfg.pollIntervalSec || 5) || 5) * 1000;
  remoteControlTimer = setTimeout(remoteControlPollOnce, ms);
}

function syncRemoteControlButton() {
  const btn = document.getElementById('remoteControlBtn');
  if (!btn) return;
  const enabled = !!remoteControlSettings().enabled;
  btn.classList.toggle('remote-control-active', enabled);
  btn.title = enabled ? '遥控已开启：正在轮询微信文件传输助手' : '遥控：轮询微信文件传输助手指令';
}

async function toggleRemoteControl(force) {
  const cfg = remoteControlSettings();
  cfg.enabled = typeof force === 'boolean' ? force : !cfg.enabled;
  persistSettings();
  syncRemoteControlButton();
  if (cfg.enabled) {
    if (typeof toast === 'function') toast('✓ 已开启微信遥控');
    await remoteControlStartRuntime();
  } else {
    await remoteControlStopRuntime();
    if (typeof toast === 'function') toast('✓ 已关闭微信遥控');
  }
}

function initRemoteControl() {
  const cfg = remoteControlSettings();
  for (const c of state.chats || []) {
    if (c && c.remoteControl && c.remoteControl.id) remoteControlKnownChats.set(String(c.remoteControl.id), c.id);
  }
  remoteControlPruneKnownChats();
  syncRemoteControlButton();
  if (cfg.enabled) remoteControlStartRuntime();
}

function _rcSetValue(id, value, prop = 'value') {
  const el = document.getElementById(id);
  if (el) el[prop] = value;
}

function loadRemoteControlSettingsToModal() {
  const cfg = remoteControlSettings();
  _rcSetValue('remoteControlEnabled', !!cfg.enabled, 'checked');
  _rcSetValue('remoteControlPollInterval', cfg.pollIntervalSec || 5);
  _rcSetValue('remoteControlPollLimit', cfg.pollLimit || 20);
  _rcSetValue('remoteControlInputPrefix', cfg.inputPrefix || '/');
  _rcSetValue('remoteControlInputSeparator', cfg.inputSeparator || '：');
  _rcSetValue('remoteControlOutputTemplate', cfg.outputTemplate || REMOTE_CONTROL_DEFAULTS.outputTemplate);
  _rcSetValue('remoteControlShortReplyPrompt', cfg.shortReplyPrompt || REMOTE_CONTROL_DEFAULTS.shortReplyPrompt);
  _rcSetValue('remoteControlMaxReplyChars', cfg.maxReplyChars || 3000);
  remoteControlRenderUsedIdsList();
}

async function saveRemoteControlSettingsFromModal() {
  const cfg = remoteControlSettings();
  const wasEnabled = !!cfg.enabled;
  const boolEl = document.getElementById('remoteControlEnabled');
  if (boolEl) cfg.enabled = !!boolEl.checked;
  const intervalEl = document.getElementById('remoteControlPollInterval');
  if (intervalEl) cfg.pollIntervalSec = Math.max(1, Math.min(300, parseInt(intervalEl.value || '5', 10) || 5));
  const limitEl = document.getElementById('remoteControlPollLimit');
  if (limitEl) cfg.pollLimit = Math.max(1, Math.min(50, parseInt(limitEl.value || '20', 10) || 20));
  const prefixEl = document.getElementById('remoteControlInputPrefix');
  if (prefixEl) cfg.inputPrefix = prefixEl.value || '/';
  const sepEl = document.getElementById('remoteControlInputSeparator');
  if (sepEl) cfg.inputSeparator = sepEl.value || '：';
  const outEl = document.getElementById('remoteControlOutputTemplate');
  if (outEl) cfg.outputTemplate = outEl.value || REMOTE_CONTROL_DEFAULTS.outputTemplate;
  const promptEl = document.getElementById('remoteControlShortReplyPrompt');
  if (promptEl) cfg.shortReplyPrompt = promptEl.value || REMOTE_CONTROL_DEFAULTS.shortReplyPrompt;
  const maxEl = document.getElementById('remoteControlMaxReplyChars');
  if (maxEl) cfg.maxReplyChars = Math.max(200, Math.min(10000, parseInt(maxEl.value || '3000', 10) || 3000));
  syncRemoteControlButton();
  if (cfg.enabled) {
    if (!wasEnabled) await remoteControlStartRuntime();
    else remoteControlScheduleNext();
  } else if (wasEnabled) {
    await remoteControlStopRuntime();
  } else {
    remoteControlClearTimer();
  }
  remoteControlRenderUsedIdsList();
}

function openRemoteControlSettings() {
  const modal = document.getElementById('remoteControlSettingsModal');
  if (!modal) return;
  if (typeof loadRemoteControlSettingsToModal === 'function') loadRemoteControlSettingsToModal();
  modal.classList.add('show');
  if (typeof initMainSettingsSelectSkins === 'function') initMainSettingsSelectSkins(modal);
}

function closeRemoteControlSettings() {
  const modal = document.getElementById('remoteControlSettingsModal');
  if (modal) modal.classList.remove('show');
}

async function saveAndCloseRemoteControlSettings() {
  await saveRemoteControlSettingsFromModal();
  if (typeof persistSettings === 'function') persistSettings();
  if (typeof window !== 'undefined' && typeof window.closeRemoteControlSettings === 'function' && window.closeRemoteControlSettings !== closeRemoteControlSettings) {
    window.closeRemoteControlSettings();
  } else {
    closeRemoteControlSettings();
  }
  if (typeof toast === 'function') toast('✓ 已保存远程遥控设置');
  return true;
}

if (typeof window !== 'undefined') {
  window.toggleRemoteControl = toggleRemoteControl;
  window.initRemoteControl = initRemoteControl;
  window.openRemoteControlSettings = openRemoteControlSettings;
  window.closeRemoteControlSettings = closeRemoteControlSettings;
  window.saveAndCloseRemoteControlSettings = saveAndCloseRemoteControlSettings;
  window.loadRemoteControlSettingsToModal = loadRemoteControlSettingsToModal;
  window.saveRemoteControlSettingsFromModal = saveRemoteControlSettingsFromModal;
  window.remoteControlParseMessage = remoteControlParseMessage;
  window.remoteControlForgetChat = remoteControlForgetChat;
  window.remoteControlPruneKnownChats = remoteControlPruneKnownChats;
  window.remoteControlUsedIdEntries = remoteControlUsedIdEntries;
  window.remoteControlRenderUsedIdsList = remoteControlRenderUsedIdsList;
}
