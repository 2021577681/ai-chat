// ============ 🎮 微信文件传输助手遥控 Agent ============
// 隐私边界：本模块只调用 wechat_filehelper_poll / wechat_filehelper_send，底层工具硬编码为“文件传输助手”。

const REMOTE_CONTROL_LEGACY_SHORT_REPLY_PROMPT = '你正通过微信文件传输助手被遥控。请只输出最终答案，不展示工具调用过程或大纲过程；回答要简短，适合微信阅读。';

const REMOTE_CONTROL_DEFAULTS = {
  enabled: false,
  pollIntervalSec: 5,
  pollLimit: 20,
  inputPrefix: '/',
  inputSeparator: '：',
  outputTemplate: '[Agent][{id}][No{no}]:\n{answer}',
  agentPrefix: '[Agent]',
  shortReplyPrompt: '你正通过微信文件传输助手被遥控。请回答简短、直接，适合微信阅读。',
  autoSendErrors: true,
  ignoreAgentMessages: true,
  maxReplyChars: 3000
};

const REMOTE_CONTROL_SLEEP_STEP_MS = 5 * 60 * 1000;
const REMOTE_CONTROL_SLEEP_INTERVALS_SEC = [0, 15, 30, 60];

const REMOTE_CONTROL_COMMANDS = [
  {
    name: '权限确认',
    example: '/允许、/永久允许、/后续允许、/拒绝',
    desc: '当工具调用弹出权限确认时，用微信处理当前排队中的权限请求。',
    aliases: 'allow、deny'
  },
  {
    name: '帮助',
    example: '/帮助',
    desc: '返回遥控指令用法。',
    aliases: 'help'
  },
  {
    name: '状态',
    example: '/状态',
    desc: '查看运行中对话数量和已绑定遥控序号。',
    aliases: 'status'
  },
  {
    name: '停止',
    example: '/停止 或 /停止/1',
    desc: '停止全部正在生成的对话，或停止指定序号对话。',
    aliases: 'stop'
  },
  {
    name: '新建对话',
    example: '/新建对话/1：你好',
    desc: '创建并绑定一个遥控序号。',
    aliases: '新建、new；也支持 /新建对话1'
  },
  {
    name: '临时对话',
    example: '/临时：你好',
    desc: '创建或继续无序号临时会话；切换或新建其它对话后自动清除。',
    aliases: '临时对话、tmp'
  },
  {
    name: '继续 / 引导',
    example: '/1：补充一下',
    desc: '继续指定对话；若该对话正在生成，则作为中途引导。',
    aliases: '数字序号'
  },
  {
    name: '工具模式',
    example: '/1/工具：查资料后回答',
    desc: '本次对话启用工具，并记为该遥控序号默认工具偏好。',
    aliases: 'tool、tools'
  },
  {
    name: '大纲模式',
    example: '/新建对话/1/大纲：整理方案',
    desc: '用动态大纲模式执行任务。',
    aliases: 'outline'
  },
  {
    name: '普通模式',
    example: '/1/普通：直接回答',
    desc: '关闭该序号默认工具偏好，按普通对话路径处理。',
    aliases: 'normal'
  },
  {
    name: '统计',
    example: '/统计/1',
    desc: '查看指定遥控对话的 token 使用统计。',
    aliases: 'stats、token、tokens；也支持 /统计1'
  },
  {
    name: '重新生成',
    example: '/重新生成/1',
    desc: '删除最近一条助手回复并重新生成。',
    aliases: '重生成、regen、regenerate；也支持 /重新生成1'
  }
];

let remoteControlTimer = null;
let remoteControlPolling = false;
let remoteControlBridgeStartPromise = null;
const remoteControlKnownChats = new Map(); // remoteId -> chatId
let remoteControlRuntimeGeneration = 0;
let remoteControlActiveCommands = 0;
let remoteControlPendingSends = 0;
let remoteControlLastActivityAt = 0;
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

function remoteControlMarkActivity() {
  remoteControlLastActivityAt = remoteControlNow();
}

function remoteControlBasePollIntervalSec(cfg = remoteControlSettings()) {
  return Math.max(1, parseFloat(cfg.pollIntervalSec || 5) || 5);
}

function remoteControlEffectivePollIntervalSec(cfg = remoteControlSettings()) {
  const baseSec = remoteControlBasePollIntervalSec(cfg);
  const lastActive = remoteControlLastActivityAt || remoteControlNow();
  const idleMs = Math.max(0, remoteControlNow() - lastActive);
  const step = Math.min(
    REMOTE_CONTROL_SLEEP_INTERVALS_SEC.length - 1,
    Math.floor(idleMs / REMOTE_CONTROL_SLEEP_STEP_MS)
  );
  const sleepSec = REMOTE_CONTROL_SLEEP_INTERVALS_SEC[step] || 0;
  return Math.max(baseSec, sleepSec);
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

function remoteControlResetMessageDedupe() {
  remoteControlInFlightMessages.clear();
  remoteControlProcessedMessages.clear();
}

async function remoteControlStartRuntime() {
  try {
    const generation = ++remoteControlRuntimeGeneration;
    remoteControlResetMessageDedupe();
    remoteControlMarkActivity();
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
    remoteControlLastActivityAt = 0;
    remoteControlResetMessageDedupe();
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
  if (state.settings.remoteControl.shortReplyPrompt === REMOTE_CONTROL_LEGACY_SHORT_REPLY_PROMPT) {
    state.settings.remoteControl.shortReplyPrompt = REMOTE_CONTROL_DEFAULTS.shortReplyPrompt;
  }
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
    const glued = token.match(/^(新建对话|新建|临时对话|临时|大纲|计划|plan|师生模式|师生|反思|reflection|工具|普通|状态|停止|帮助|统计|重新生成|重生成|regen|regenerate)(\d+)$/);
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

  const unsupported = {
    '计划': '计划模式需要前端审核，远程遥控暂不支持。请改用普通、工具或大纲模式。',
    'plan': '计划模式需要前端审核，远程遥控暂不支持。请改用普通、工具或大纲模式。',
    '师生': '师生模式暂不支持远程遥控。请改用普通、工具或大纲模式。',
    '师生模式': '师生模式暂不支持远程遥控。请改用普通、工具或大纲模式。',
    '反思': '师生模式暂不支持远程遥控。请改用普通、工具或大纲模式。',
    'reflection': '师生模式暂不支持远程遥控。请改用普通、工具或大纲模式。'
  };

  const aliases = {
    '新建对话': 'new', '新建': 'new', 'new': 'new', '临时对话': 'temporary', '临时': 'temporary', 'tmp': 'temporary',
    '大纲': 'outline', 'outline': 'outline',
    '工具': 'tools', 'tool': 'tools', 'tools': 'tools',
    '普通': 'normal', 'normal': 'normal', '帮助': 'help', 'help': 'help',
    '状态': 'status', 'status': 'status', '停止': 'stop', 'stop': 'stop',
    '统计': 'stats', 'stats': 'stats', 'token': 'stats', 'tokens': 'stats',
    '重新生成': 'regenerate', '重生成': 'regenerate', 'regen': 'regenerate', 'regenerate': 'regenerate'
  };

  const result = {
    ok: true,
    raw: text,
    body,
    create: false,
    temporary: false,
    outline: false,
    tools: false,
    normal: false,
    help: false,
    status: false,
    stop: false,
    stats: false,
    regenerate: false,
    id: ''
  };

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      result.id = token;
      continue;
    }
    if (unsupported[token]) return { ok: false, error: unsupported[token] };
    const op = aliases[token] || token;
    if (op === 'new') result.create = true;
    else if (op === 'temporary') result.temporary = true;
    else if (op === 'outline') result.outline = true;
    else if (op === 'tools') result.tools = true;
    else if (op === 'normal') result.normal = true;
    else if (op === 'help') result.help = true;
    else if (op === 'status') result.status = true;
    else if (op === 'stop') result.stop = true;
    else if (op === 'stats') result.stats = true;
    else if (op === 'regenerate') result.regenerate = true;
  }

  if (result.help || result.status || (result.stop && !result.id)) return result;
  if (result.temporary) {
    if (result.id) return { ok: false, error: '临时对话不使用序号，请发送 /临时：你的问题' };
    if (result.create) return { ok: false, error: '临时对话请直接发送 /临时：你的问题，不需要 /新建对话。' };
    if (!result.body) return { ok: false, error: '缺少正文，请发送 /临时：你的问题' };
    return result;
  }
  if (!result.id) return { ok: false, error: '缺少对话编号，例如 /新建对话/1：你好 或 /1：继续' };
  if (result.create && tokens[0] !== '新建对话' && tokens[0] !== '新建' && tokens[0] !== 'new') {
    return { ok: false, error: '/新建对话/序号 必须放在开头，例如 /新建对话/1：你好；也支持 /新建对话1：你好' };
  }
  if (!result.body && !result.stop && !result.stats && !result.regenerate) return { ok: false, error: '缺少正文，请用冒号分隔，例如 /1：帮我总结' };
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

function remoteControlEscapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function remoteControlRenderCommandList() {
  const countEl = document.getElementById('remoteControlCommandCount');
  const listEl = document.getElementById('remoteControlCommandList');
  if (countEl) countEl.textContent = `共 ${REMOTE_CONTROL_COMMANDS.length} 类`;
  if (!listEl) return;
  listEl.innerHTML = REMOTE_CONTROL_COMMANDS.map(cmd => {
    const name = remoteControlEscapeHtml(cmd.name);
    const example = remoteControlEscapeHtml(cmd.example);
    const desc = remoteControlEscapeHtml(cmd.desc);
    const aliases = remoteControlEscapeHtml(cmd.aliases || '无');
    return `
      <div class="remote-control-command-item">
        <div class="remote-control-command-title">
          <strong>${name}</strong>
          <code>${example}</code>
        </div>
        <div class="remote-control-command-desc">${desc}</div>
        <div class="remote-control-command-alias">别名：${aliases}</div>
      </div>`;
  }).join('');
}

function remoteControlCreateChat(remoteId, opts = {}) {
  if (!opts.temporary && typeof discardTemporaryChat === 'function') {
    try { discardTemporaryChat({ nextCurrentId: null }); } catch (e) {}
  }
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

function remoteControlEnsureTemporaryChat(parsed) {
  let chat = state.temporaryChat && state.temporaryChat.temporary ? state.temporaryChat : null;
  if (!chat) {
    chat = typeof createTemporaryChat === 'function'
      ? createTemporaryChat()
      : { id: 'tmp_' + Date.now(), title: '临时会话', messages: [], createdAt: Date.now(), temporary: true };
    state.temporaryChat = chat;
  }
  state.currentId = chat.id;
  chat.remoteControl = chat.remoteControl || { id: '临时', replyNo: 0 };
  chat.remoteControl.id = '临时';
  chat.remoteControl.temporary = true;
  chat.remoteControl.ephemeral = true;
  if (parsed && parsed.tools) chat.remoteControl.useToolsDefault = true;
  if (parsed && parsed.normal && !parsed.tools) chat.remoteControl.useToolsDefault = false;
  if (typeof syncGlobalTaskState === 'function') syncGlobalTaskState(chat.id);
  if (typeof updateTemporaryChatButton === 'function') updateTemporaryChatButton();
  saveData();
  renderChatList();
  if (isCurrentChat(chat)) renderMessages();
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
      remoteControlMarkActivity();
      return r;
    }

    const result = await executeTool('wechat_filehelper_send', { text }, { skipConfirm: true });
    remoteControlLogTiming('wechat send', startedAt, `chars=${String(text || '').length}`);
    if (!result.ok) throw new Error(typeof result.value === 'string' ? result.value : JSON.stringify(result.value));
    remoteControlMarkActivity();
    return result.value;
  } finally {
    remoteControlPendingSends = Math.max(0, remoteControlPendingSends - 1);
    if (remoteControlCanSchedulePoll()) {
      remoteControlScheduleNext();
    }
  }
}

function remoteControlCanSchedulePoll() {
  // AI generation should not block polling anymore. The backend bridge now
  // serializes WeChat UI access and gives send higher priority than poll/read.
  // Locally pause only while a send request is being submitted, so the reply can
  // enter the backend priority queue immediately.
  return remoteControlSettings().enabled && remoteControlPendingSends <= 0;
}

function remoteControlMessageKey(msg) {
  const delivery = msg && (msg.delivery_id || msg.deliveryId);
  if (delivery) return `delivery:${String(delivery)}`;
  const stable = String((msg && (msg.stable_id || msg.stableId)) || '');
  const id = msg && msg.id ? String(msg.id) : '';
  const resetWindow = !!(msg && (msg._rcWindowReset || msg.window_reset));
  const resetPart = resetWindow ? `reset:${String((msg && (msg._rcPollKey || msg.polled_at)) || Date.now())}:` : '';
  if (id && stable.startsWith('time:')) return `id:${id}`;
  if (id) return `${resetPart}id:${id}`;
  const content = String((msg && msg.content) || '').trim();
  return `${resetPart}fallback:${stable}:${content}`;
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

function remoteControlIsGuidanceCandidate(parsed) {
  return !!(parsed && (parsed.id || parsed.temporary) && parsed.body && !parsed.create && !parsed.stop && !parsed.stats && !parsed.regenerate && !parsed.help && !parsed.status);
}

function remoteControlCanGuideChat(chat) {
  if (!chat || typeof chatTaskById !== 'function') return false;
  const task = chatTaskById(chat.id);
  if (!task || !task.isGenerating) return false;
  if (task.mode && task.mode !== 'chat') return false;
  return true;
}

function remoteControlQueueGuidance(chat, parsed) {
  if (!remoteControlIsGuidanceCandidate(parsed) || !remoteControlCanGuideChat(chat)) return false;
  const userMsg = {
    role: 'user',
    content: remoteControlUserContent(parsed),
    _midrunGuidance: true,
    _queuedAt: Date.now()
  };
  const task = chatTaskById(chat.id);
  if (task && task.pendingGuidance) {
    task.pendingGuidance.content = [task.pendingGuidance.content || '', userMsg.content || ''].filter(Boolean).join('\n\n');
    task.pendingGuidance._queuedAt = Date.now();
    task.guidanceRequested = true;
    if (typeof syncGlobalTaskState === 'function') syncGlobalTaskState(chat.id);
  } else if (typeof setChatTaskGuidance === 'function') {
    setChatTaskGuidance(chat.id, userMsg);
  } else if (task) {
    task.pendingGuidance = userMsg;
    task.guidanceRequested = true;
    if (typeof syncGlobalTaskState === 'function') syncGlobalTaskState(chat.id);
  }

  const runningTask = (typeof chatTaskById === 'function') ? chatTaskById(chat.id) : null;
  const ctrl = runningTask ? (runningTask.abortCtrl || state.abortCtrl) : state.abortCtrl;
  if (runningTask) {
    runningTask.stopRequested = true;
    runningTask.guidanceRequested = true;
  }
  state.stopRequested = true;
  if (ctrl) {
    try { ctrl.abort(); } catch (e) { console.error('[remote-control] guidance abort failed:', e); }
  }
  if (typeof window !== 'undefined' && window._rateWaitAbort) {
    try { window._rateWaitAbort(ctrl && ctrl.signal); } catch (e) {}
  }
  if (typeof window !== 'undefined' && typeof window.cancelAutoResend === 'function') {
    try { window.cancelAutoResend(chat.id, false); } catch (e) {}
  }
  if (typeof cancelPendingStreamFlush === 'function') cancelPendingStreamFlush();
  if (typeof traceUserMessage === 'function') traceUserMessage(parsed.body || userMsg.content);
  if (typeof syncGlobalTaskState === 'function') syncGlobalTaskState(chat.id);
  if (typeof updateSendBtn === 'function') updateSendBtn();
  return true;
}

function remoteControlGuidanceAck(parsed) {
  if (parsed && parsed.temporary && !parsed.id) return '[System]已引导临时对话';
  return '[System]已引导对话' + (parsed && parsed.id ? parsed.id : '');
}

function remoteControlReplyId(parsed) {
  if (parsed && parsed.id) return String(parsed.id);
  if (parsed && parsed.temporary) return '临时';
  return '';
}

function remoteControlFormatTokenStats(chat) {
  if (!chat) return '对话不存在。';
  const stats = (typeof getChatTokenStats === 'function') ? getChatTokenStats(chat) : (chat.tokenStats || null);
  const remoteId = chat.remoteControl && chat.remoteControl.id ? chat.remoteControl.id : '';
  if (!stats || Number(stats.totalRequests || 0) <= 0) return `对话 ${remoteId} 还没有发送过请求，暂无 token 统计。`;
  const fmt = (typeof formatNumber === 'function')
    ? formatNumber
    : (n) => {
        n = Number(n || 0);
        if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return String(n);
      };
  const lines = [
    '本对话累计',
    `总请求次数：${Number(stats.totalRequests || 0)}`,
    `累计输入 token：${fmt(stats.inputTokens || 0)}`,
    `累计输出 token：${fmt(stats.outputTokens || 0)}`
  ];
  if (Number(stats.cacheReadTokens || 0) > 0) lines.push(`缓存命中（节省）：${fmt(stats.cacheReadTokens || 0)}`);
  if (Number(stats.cacheCreateTokens || 0) > 0) lines.push(`缓存创建：${fmt(stats.cacheCreateTokens || 0)}`);
  if (Number(stats.thinkingTokens || 0) > 0) lines.push(`思考 token：${fmt(stats.thinkingTokens || 0)}`);
  lines.push(`总计：${fmt(Number(stats.inputTokens || 0) + Number(stats.outputTokens || 0))}`);
  if (Number(stats.lastInputTokens || 0) > 0 || Number(stats.lastOutputTokens || 0) > 0) {
    lines.push('', '最近一次请求', `输入：${fmt(stats.lastInputTokens || 0)} tokens`, `输出：${fmt(stats.lastOutputTokens || 0)} tokens`);
  }
  return lines.join('\n');
}

function remoteControlStopAllGeneratingChats() {
  const tasks = (typeof ensureChatTasks === 'function') ? ensureChatTasks() : {};
  const ids = Object.values(tasks).filter(t => t && t.isGenerating && t.chatId).map(t => t.chatId);
  let stopped = 0;
  for (const chatId of ids) {
    if (typeof requestStopChatTask === 'function') {
      if (requestStopChatTask(chatId)) stopped++;
    } else {
      stopped++;
    }
  }
  return stopped;
}

async function remoteControlRegenerateChat(chat, parsed) {
  const remoteId = String(parsed.id);
  if (!chat || !Array.isArray(chat.messages)) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${remoteId} 不存在。`));
    return;
  }
  if (typeof isChatGenerating === 'function' && isChatGenerating(chat.id)) {
    if (typeof requestStopChatTask === 'function') requestStopChatTask(chat.id);
    await new Promise(r => setTimeout(r, 200));
  }
  let idx = -1;
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m && m.role === 'assistant' && !m._hiddenFromUI) { idx = i; break; }
  }
  if (idx < 0) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${remoteId} 没有可重新生成的助手消息。`));
    return;
  }
  const reply = chat.messages[idx] || {};
  const mode = reply.pptMode ? 'ppt' : (reply.outline ? 'outline' : (reply.plan ? 'plan' : (reply.reflection ? 'reflection' : 'normal')));
  if (mode === 'plan' || mode === 'reflection') {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${remoteId} 的上一条回复属于${mode === 'plan' ? '计划模式' : '师生模式'}，远程遥控不支持重新生成，请在前端操作。`));
    return;
  }
  chat.messages = chat.messages.slice(0, idx);
  while (chat.messages.length && chat.messages[chat.messages.length - 1].role === 'tool') chat.messages.pop();
  saveData();
  if (isCurrentChat(chat)) renderMessages();
  const before = chat.messages.length;
  try {
    const useTools = !!(chat.remoteControl && chat.remoteControl.useToolsDefault);
    if (mode === 'outline') await callAPIWithOutline({ chatId: chat.id, useTools, suppressCompletionSound: true, contextChecked: true });
    else if (mode === 'ppt' && typeof callAPIWithPptMode === 'function') await callAPIWithPptMode({ chatId: chat.id, useTools, suppressCompletionSound: true, contextChecked: true });
    else await callAPI(undefined, { chatId: chat.id, useTools, suppressCompletionSound: true, contextChecked: true, extraSystemPrompt: (remoteControlSettings().shortReplyPrompt || '') });
  } catch (e) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${remoteId} 重新生成失败：${e.message || e}`));
    return;
  }
  const answer = remoteControlLatestAssistantText(chat, before);
  await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${remoteId} 已重新生成。\n${answer || '（无文本回复）'}`));
  saveData();
}

async function remoteControlRunChat(chat, parsed) {
  const remoteId = remoteControlReplyId(parsed);
  if (typeof isChatGenerating === 'function' && isChatGenerating(chat.id) && remoteControlQueueGuidance(chat, parsed)) {
    await remoteControlSendWechat(remoteControlGuidanceAck(parsed));
    return;
  }
  if (typeof isChatGenerating === 'function' && isChatGenerating(chat.id)) {
    await remoteControlSendWechat(remoteControlFormatReply(remoteId, (chat.remoteControl.replyNo || 0) + 1, '该对话正在生成中，请稍后再发。你也可以用其他编号新建并行对话。'));
    return;
  }

  const before = chat.messages.length;
  remoteControlAppendUser(chat, remoteControlUserContent(parsed));
  const useTools = parsed.normal && !parsed.tools ? false : !!(parsed.tools || (chat.remoteControl && chat.remoteControl.useToolsDefault));
  try {
    const apiStartedAt = remoteControlNow();
    if (parsed.outline) await callAPIWithOutline({ chatId: chat.id, useTools, suppressCompletionSound: true, contextChecked: true });
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
    await remoteControlSendWechat('[Agent][Help]:\n用法：/新建对话/1/大纲/工具：任务；继续：/1：追加指令；临时：/临时：任务。支持 /工具、/大纲、/状态、/统计/1、/停止/1、/重新生成/1、/停止。计划模式和师生模式需要前端交互审核，远程遥控不支持。');
    return;
  }
  if (parsed.status) {
    const tasks = (typeof ensureChatTasks === 'function') ? ensureChatTasks() : {};
    const running = Object.values(tasks).filter(t => t && t.isGenerating).map(t => t.chatId).length;
    remoteControlPruneKnownChats();
    await remoteControlSendWechat(remoteControlFormatSystem(`当前状态：运行中对话 ${running} 个；已绑定对话 ${remoteControlKnownChats.size} 个。`));
    return;
  }
  if (parsed.stop && !parsed.id) {
    const stopped = remoteControlStopAllGeneratingChats();
    await remoteControlSendWechat(remoteControlFormatSystem(`已请求停止所有正在生成的对话（${stopped} 个）。`));
    return;
  }
  if (parsed.temporary && !parsed.id) {
    const chat = remoteControlEnsureTemporaryChat(parsed);
    await remoteControlRunChat(chat, parsed);
    return;
  }

  // Control/read-only commands must remain available while the target remote id
  // is running. In particular, /停止/N is the mechanism used to interrupt the
  // in-flight task, and /统计/N is a read-only query. Do these before acquiring
  // the per-remote-id execution lock, otherwise they would be rejected as
  // "正在执行" exactly when they are most needed.
  if (parsed.id && !parsed.create && (parsed.stats || parsed.stop)) {
    const existingChat = remoteControlFindChat(parsed.id) || remoteControlDeduplicateRemoteChats(parsed.id);
    if (!existingChat) {
      await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${parsed.id} 不存在，请先发送 /新建对话/${parsed.id}：你的问题 来新建对话。`));
    } else if (parsed.stats) {
      await remoteControlSendWechat(remoteControlFormatSystem(remoteControlFormatTokenStats(existingChat)));
    } else if (parsed.stop) {
      if (typeof requestStopChatTask === 'function') requestStopChatTask(existingChat.id);
      await remoteControlSendWechat(remoteControlFormatSystem(`已请求停止对话 ${parsed.id} 的生成。`));
    }
    return;
  }
  const lockId = parsed.id ? String(parsed.id) : '';
  if (lockId && !remoteControlAcquireRemoteLock(lockId)) {
    const existingChat = remoteControlFindChat(parsed.id) || remoteControlDeduplicateRemoteChats(parsed.id);
    if (remoteControlQueueGuidance(existingChat, parsed)) {
      await remoteControlSendWechat(remoteControlGuidanceAck(parsed));
    } else {
      await remoteControlSendWechat(remoteControlFormatSystem('对话' + parsed.id + '正在执行，当前指令暂未执行。'));
    }
    console.warn('[remote-control] duplicate/in-flight remote id handled:', lockId);
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
    if (parsed.normal && !parsed.tools && chat) {
      chat.remoteControl = chat.remoteControl || { id: String(parsed.id), replyNo: 0 };
      chat.remoteControl.useToolsDefault = false;
    }
    if (parsed.stats) {
      await remoteControlSendWechat(remoteControlFormatSystem(remoteControlFormatTokenStats(chat)));
      return;
    }
    if (parsed.regenerate) {
      await remoteControlRegenerateChat(chat, parsed);
      return;
    }
    if (parsed.stop) {
      if (typeof requestStopChatTask === 'function') requestStopChatTask(chat.id);
      await remoteControlSendWechat(remoteControlFormatSystem(`已请求停止对话 ${parsed.id} 的生成。`));
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

function remoteControlHandlePermissionReply(content) {
  if (typeof window !== 'undefined' && typeof window.handleRemotePermissionCommand === 'function') {
    return !!window.handleRemotePermissionCommand(content);
  }
  if (typeof handleRemotePermissionCommand === 'function') {
    return !!handleRemotePermissionCommand(content);
  }
  return false;
}

async function remoteControlPollOnce() {
  if (remoteControlPolling) return;
  if (!remoteControlSettings().enabled) return;
  if (remoteControlPendingSends > 0) return;
  remoteControlPolling = true;
  try {
    const cfg = remoteControlSettings();
    const userLimit = Math.max(1, Math.min(50, parseInt(cfg.pollLimit || 20, 10) || 20));
    // The WeChat backend needs a rolling window with enough overlap to decide
    // what is new. Treat the user setting as preference, but never let the
    // internal de-duplication window become too small (limit=1 would otherwise
    // make every newly sent message look like a no-overlap re-baseline).
    const limit = Math.max(userLimit, 20);
    const pollStartedAt = remoteControlNow();
    let payload;
    if (typeof callAgentBackend === 'function') {
      payload = await callAgentBackend('wechat_bridge', {
        op: 'poll',
        limit,
        timeout: 0,
        interval: 1,
        requestTimeoutMs: 90000,
        bridge_timeout: 90
      }, undefined, undefined, { skipConfirm: true });
      remoteControlLogTiming('wechat poll', pollStartedAt, `limit=${limit}${payload && payload.busy ? ' busy' : ''}`);
      if (!payload || !payload.ok) throw new Error((payload && payload.error) || JSON.stringify(payload));
    } else {
      const result = await executeTool('wechat_filehelper_poll', { limit, timeout: 0, interval: 1 }, { skipConfirm: true });
      remoteControlLogTiming('wechat poll', pollStartedAt, `limit=${limit}`);
      if (!result.ok) throw new Error(typeof result.value === 'string' ? result.value : JSON.stringify(result.value));
      payload = result.value && result.value.stdout ? JSON.parse(result.value.stdout) : (typeof result.value === 'string' ? JSON.parse(result.value) : result.value);
    }
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const pollKey = payload.polled_at || String(Date.now());
    const windowReset = !!(payload.window_reset || payload.no_overlap_reset);
    for (const msg of messages) {
      if (msg && typeof msg === 'object') msg._rcPollKey = pollKey;
      if (msg && typeof msg === 'object' && windowReset) msg._rcWindowReset = true;
      const content = String(msg.content || '').trim();
      if (!content) continue;
      if (cfg.ignoreAgentMessages && (content.startsWith(cfg.agentPrefix || '[Agent]') || content.startsWith('[System]'))) continue;
      remoteControlMarkActivity();
      if (remoteControlHandlePermissionReply(content)) continue;
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
  if (remoteControlPendingSends > 0) return;
  const ms = remoteControlEffectivePollIntervalSec(cfg) * 1000;
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
  remoteControlRenderCommandList();
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
  window.remoteControlRenderCommandList = remoteControlRenderCommandList;
}
