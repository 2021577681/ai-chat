// ============ 🎮 微信文件传输助手遥控 Agent ============
// Privacy boundary: remote control uses only the private wechat_bridge read/send path for File Transfer Assistant.

const REMOTE_CONTROL_LEGACY_SHORT_REPLY_PROMPT = '你正通过微信文件传输助手被遥控。请只输出最终答案，不展示工具调用过程或大纲过程；回答要简短，适合微信阅读。';

const REMOTE_CONTROL_DEFAULTS = {
  enabled: false,
  pollIntervalSec: 5,
  pollLimit: 20,
  maxConsecutiveSendsBeforePoll: 5,
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
    example: '/停止、/停止/1 或 /停止/对话名前五字',
    desc: '停止全部正在生成的对话，或停止指定序号/名前五字对话。',
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
    name: '列举遥控对话',
    example: '/列举对话',
    desc: '列出当前已有的遥控对话及其序号。'
  },
  {
    name: '列举侧栏对话',
    example: '/列举/10',
    desc: '按侧栏排序列出前 N 条原本存在于侧栏里的非遥控对话；隐藏对话不计入。',
    aliases: 'list/N'
  },
  {
    name: '继续 / 名称寻址 / 引导',
    example: '/1：补充一下 或 /对话名前五字：补充一下',
    desc: '继续指定对话；可用遥控序号，或用侧栏对话名称前五个字指代某个非遥控侧栏对话；多个名称匹配时按侧栏排序选择最新/最靠前的对话；若该对话正在生成，则作为中途引导。',
    aliases: '数字序号、对话名称前五字'
  },
  {
    name: '终端',
    example: '/终端：dir',
    desc: '在当前沙箱目录直接执行冒号后的终端命令并返回 stdout/stderr；这是用户主动行为，不走 AI 工具权限确认，命令本身可访问沙箱外路径；空输出返回 NULL。',
    aliases: 'terminal、shell'
  },
  {
    name: '沙箱目录',
    example: '/沙箱目录',
    desc: '列出当前沙箱根目录和当前工作目录。',
    aliases: 'pwd、workspace'
  },
  {
    name: '切换目录',
    example: '/切换目录：D:\\Projects',
    desc: '把当前沙箱目录切换到冒号后的路径；成功和失败都会通过微信反馈。',
    aliases: 'cd'
  },
  {
    name: '工具模式',
    example: '/1/工具：查资料后回答 或 /对话名前五字/工具：查资料后回答',
    desc: '本次对话启用工具，并记为该目标对话默认工具偏好。',
    aliases: 'tool、tools'
  },
  {
    name: '大纲模式',
    example: '/新建对话/1/大纲：整理方案 或 /对话名前五字/大纲：整理方案',
    desc: '用动态大纲模式执行任务；新建对话必须用数字序号，已有侧栏对话可用名前五字。',
    aliases: 'outline'
  },
  {
    name: '普通模式',
    example: '/1/普通：直接回答 或 /对话名前五字/普通：直接回答',
    desc: '关闭该目标对话默认工具偏好，按普通对话路径处理。',
    aliases: 'normal'
  },
  {
    name: '统计',
    example: '/统计/1 或 /统计/对话名前五字',
    desc: '查看指定序号/名前五字对话的 token 使用统计。',
    aliases: 'stats、token、tokens；也支持 /统计1'
  },
  {
    name: '重新生成',
    example: '/重新生成/1 或 /重新生成/对话名前五字',
    desc: '删除最近一条助手回复并重新生成。',
    aliases: '重生成、regen、regenerate；也支持 /重新生成1'
  },
  {
    name: '压缩',
    example: '/压缩/1 或 /压缩/对话名前五字',
    desc: '手动压缩指定对话历史；对话运行中或无法压缩时通过微信返回 [System] 错误。'
  },
  {
    name: '关闭遥控',
    example: '/关闭遥控',
    desc: '发送关闭成功消息后关闭远程遥控功能。'
  },
  {
    name: '重启遥控',
    example: '/重启遥控',
    desc: '不发送消息，直接重启远程遥控。'
  },
  {
    name: '大纲补充',
    example: '/补充/1：新的要求 或 /补充/对话名前五字：新的要求',
    desc: '大纲任务运行中暂停并插入用户留言后继续；非大纲模式返回错误。'
  },
  {
    name: '大纲收尾',
    example: '/收尾/1 或 /收尾/对话名前五字',
    desc: '大纲模式任务直接收尾；非大纲模式返回错误。'
  },
  {
    name: '大纲继续',
    example: '/继续/1 或 /继续/对话名前五字',
    desc: '大纲任务暂停或出错后继续执行；非大纲模式或正在运行中返回错误。'
  },
  {
    name: '大纲状态',
    example: '/大纲状态/1 或 /大纲状态/对话名前五字',
    desc: '查看当前大纲任务轮次、状态和步骤完成情况；非大纲或已结束返回错误。'
  }
];

function remoteControlFormatHelpExamples() {
  const examples = REMOTE_CONTROL_COMMANDS.map(cmd => String(cmd.example || '').trim()).filter(Boolean);
  return examples.join('\n');
}

let remoteControlTimer = null;
let remoteControlPolling = false;
let remoteControlBridgeStartPromise = null;
const remoteControlKnownChats = new Map(); // remoteId -> chatId
let remoteControlRuntimeGeneration = 0;
let remoteControlActiveCommands = 0;
let remoteControlPendingSends = 0;
let remoteControlLastActivityAt = 0;
let remoteControlStartupMarker = '';
let remoteControlStartupMarkerFound = false;
let remoteControlStartupMarkerPollAttempts = 0;
let remoteControlLastUserWindowKeys = [];
let remoteControlNewestFirstWindow = false;
let remoteControlDeliverySeq = 0;
const remoteControlInFlightMessages = new Set();
const remoteControlProcessedMessages = new Map();
const remoteControlRemoteLocks = new Set();
const remoteControlSessionNameRefs = new Set();

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
  remoteControlStartupMarker = '';
  remoteControlStartupMarkerFound = false;
  remoteControlStartupMarkerPollAttempts = 0;
  remoteControlLastUserWindowKeys = [];
  remoteControlNewestFirstWindow = false;
  remoteControlDeliverySeq = 0;
}

function remoteControlStartupId() {
  try {
    const bytes = new Uint8Array(3);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  } catch (e) {
    return Math.random().toString(16).slice(2, 8).toUpperCase();
  }
}

function remoteControlStartupText() {
  const time = new Date().toLocaleString('zh-CN', { hour12: false });
  return remoteControlFormatSystem(`${time} 远程遥控已启动 #${remoteControlStartupId()}`);
}

async function remoteControlStartRuntime() {
  try {
    const generation = ++remoteControlRuntimeGeneration;
    remoteControlResetMessageDedupe();
    remoteControlMarkActivity();
    await remoteControlStartBridge();
    if (generation !== remoteControlRuntimeGeneration || !remoteControlSettings().enabled) return;
    remoteControlStartupMarker = remoteControlStartupText();
    await remoteControlSendWechat(remoteControlStartupMarker);
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
    const glued = token.match(/^(新建对话|新建|临时对话|临时|列举对话|列举|沙箱目录|切换目录|终端|大纲状态|大纲|计划|plan|师生模式|师生|反思|reflection|工具|普通|状态|停止|帮助|统计|重新生成|重生成|regen|regenerate|压缩|关闭遥控|重启遥控|补充|收尾|继续)(\d+)$/);
    if (glued) {
      normalized.push(glued[1], glued[2]);
    } else {
      normalized.push(token);
    }
  }
  return normalized;
}

function remoteControlCanAcceptNameRefToken(result) {
  return !!(result &&
    !result.id &&
    !result.nameRef &&
    !result.create &&
    !result.temporary &&
    !result.listRemoteChats &&
    !result.listSidebarChats &&
    !result.help &&
    !result.status &&
    !result.terminal &&
    !result.sandboxDir &&
    !result.switchDir &&
    !result.shutdownRemote &&
    !result.restartRemote);
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
    '列举对话': 'listRemoteChats', '列举': 'listSidebarChats', 'list': 'listSidebarChats',
    '终端': 'terminal', 'terminal': 'terminal', 'shell': 'terminal',
    '沙箱目录': 'sandboxDir', 'pwd': 'sandboxDir', 'workspace': 'sandboxDir',
    '切换目录': 'switchDir', 'cd': 'switchDir',
    '状态': 'status', 'status': 'status', '停止': 'stop', 'stop': 'stop',
    '统计': 'stats', 'stats': 'stats', 'token': 'stats', 'tokens': 'stats',
    '重新生成': 'regenerate', '重生成': 'regenerate', 'regen': 'regenerate', 'regenerate': 'regenerate',
    '压缩': 'compress', '关闭遥控': 'shutdownRemote', '重启遥控': 'restartRemote',
    '补充': 'outlineInject', '收尾': 'outlineFinish', '继续': 'outlineContinue',
    '大纲状态': 'outlineStatus'
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
    listRemoteChats: false,
    listSidebarChats: false,
    terminal: false,
    sandboxDir: false,
    switchDir: false,
    stats: false,
    regenerate: false,
    compress: false,
    shutdownRemote: false,
    restartRemote: false,
    outlineInject: false,
    outlineFinish: false,
    outlineContinue: false,
    outlineStatus: false,
    nameRef: '',
    id: ''
  };

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      if (result.nameRef) return { ok: false, error: '不能同时使用对话编号和对话名前五字。' };
      if (result.id) return { ok: false, error: '只能指定一个对话编号。' };
      result.id = token;
      continue;
    }
    if (unsupported[token]) return { ok: false, error: unsupported[token] };
    const op = aliases[token];
    if (op === 'new') result.create = true;
    else if (op === 'temporary') result.temporary = true;
    else if (op === 'outline') result.outline = true;
    else if (op === 'tools') result.tools = true;
    else if (op === 'normal') result.normal = true;
    else if (op === 'help') result.help = true;
    else if (op === 'status') result.status = true;
    else if (op === 'stop') result.stop = true;
    else if (op === 'listRemoteChats') result.listRemoteChats = true;
    else if (op === 'listSidebarChats') result.listSidebarChats = true;
    else if (op === 'terminal') result.terminal = true;
    else if (op === 'sandboxDir') result.sandboxDir = true;
    else if (op === 'switchDir') result.switchDir = true;
    else if (op === 'stats') result.stats = true;
    else if (op === 'regenerate') result.regenerate = true;
    else if (op === 'compress') result.compress = true;
    else if (op === 'shutdownRemote') result.shutdownRemote = true;
    else if (op === 'restartRemote') result.restartRemote = true;
    else if (op === 'outlineInject') result.outlineInject = true;
    else if (op === 'outlineFinish') result.outlineFinish = true;
    else if (op === 'outlineContinue') result.outlineContinue = true;
    else if (op === 'outlineStatus') result.outlineStatus = true;
    else if (remoteControlCanAcceptNameRefToken(result)) result.nameRef = token;
    else return { ok: false, error: `无法识别的遥控指令片段：/${token}。请发送 /帮助 查看支持的指令。` };
  }

  const targetlessCommand = result.help ? '帮助'
    : result.status ? '状态'
      : result.terminal ? '终端'
        : result.sandboxDir ? '沙箱目录'
          : result.switchDir ? '切换目录'
            : result.shutdownRemote ? '关闭遥控'
              : result.restartRemote ? '重启遥控'
                : result.listRemoteChats ? '列举对话'
                  : '';
  if (targetlessCommand && (result.id || result.nameRef)) {
    return { ok: false, error: `/${targetlessCommand} 指令不支持对话编号或对话名前五字。` };
  }
  if (result.listSidebarChats && result.nameRef) return { ok: false, error: '/列举 只接受数量，例如 /列举/10' };
  if (result.listRemoteChats) return result;
  if (result.listSidebarChats) {
    if (!result.id) return { ok: false, error: '缺少列举数量，例如 /列举/10' };
    return result;
  }
  if (result.terminal) {
    if (!result.body) return { ok: false, error: '缺少终端指令，请发送 /终端：你的命令' };
    return result;
  }
  if (result.sandboxDir) {
    return result;
  }
  if (result.switchDir) {
    if (!result.body) return { ok: false, error: '缺少目录路径，请发送 /切换目录：目标路径' };
    return result;
  }
  if (result.shutdownRemote || result.restartRemote) return result;
  if (result.help || result.status || (result.stop && !result.id && !result.nameRef)) return result;
  if (result.compress || result.outlineInject || result.outlineFinish || result.outlineContinue || result.outlineStatus) {
    if (!result.id && !result.nameRef) {
      const opName = result.compress ? '压缩' : (result.outlineInject ? '补充' : (result.outlineFinish ? '收尾' : (result.outlineContinue ? '继续' : '大纲状态')));
      return { ok: false, error: `缺少对话编号或对话名前五字，例如 /${opName}/1${result.outlineInject ? '：新的要求' : ''} 或 /${opName}/对话名前五字${result.outlineInject ? '：新的要求' : ''}` };
    }
    if (result.outlineInject && !result.body) return { ok: false, error: '缺少补充内容，请发送 /补充/1：新的要求' };
    if (!result.body && result.outlineInject) return { ok: false, error: '缺少补充内容，请发送 /补充/1：新的要求' };
    if (result.body && !result.outlineInject) return result;
    return result;
  }
  if (result.temporary) {
    if (result.id) return { ok: false, error: '临时对话不使用序号，请发送 /临时：你的问题' };
    if (result.create) return { ok: false, error: '临时对话请直接发送 /临时：你的问题，不需要 /新建对话。' };
    if (!result.body) return { ok: false, error: '缺少正文，请发送 /临时：你的问题' };
    return result;
  }
  if (!result.id && !result.nameRef) return { ok: false, error: '缺少对话编号或对话名前五字，例如 /新建对话/1：你好、/1：继续 或 /对话名前五字：继续' };
  if (result.create && !result.id) return { ok: false, error: '新建遥控对话必须使用数字序号，例如 /新建对话/1：你好；对话名前五字仅用于指代已有侧栏对话。' };
  if (result.create && tokens[0] !== '新建对话' && tokens[0] !== '新建' && tokens[0] !== 'new') {
    return { ok: false, error: '/新建对话/序号 必须放在开头，例如 /新建对话/1：你好；也支持 /新建对话1：你好' };
  }
  if (!result.body && !result.stop && !result.stats && !result.regenerate && !result.compress && !result.outlineFinish && !result.outlineContinue && !result.outlineStatus) return { ok: false, error: '缺少正文，请用冒号分隔，例如 /1：帮我总结' };
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

function remoteControlSidebarChats() {
  if (typeof sidebarChats === 'function') return sidebarChats().filter(chat => chat && !chat._hiddenFromUI);
  return (state.chats || [])
    .filter(chat => chat && !chat._hiddenFromUI)
    .map((chat, index) => ({ chat, index }))
    .sort((a, b) => {
      const ap = Number(a.chat && a.chat.pinnedAt) || 0;
      const bp = Number(b.chat && b.chat.pinnedAt) || 0;
      if (ap || bp) {
        if (ap !== bp) return bp - ap;
        if (ap && bp) return a.index - b.index;
      }
      return a.index - b.index;
    })
    .map(item => item.chat);
}

function remoteControlChatTitle(chat) {
  if (typeof _chatDisplayTitle === 'function') return _chatDisplayTitle(chat) || '';
  if (!chat) return '';
  const explicit = String(chat.title || '').trim();
  if (explicit) return explicit;
  const first = Array.isArray(chat.messages) ? chat.messages.find(m => m && m.role === 'user') : null;
  return String((first && first.content) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function remoteControlVisibleNonRemoteChats() {
  return remoteControlSidebarChats().filter(chat => chat && (!chat.remoteControl || chat.remoteControl.nameRef) && !chat.temporary);
}

function remoteControlFindChatByNameRef(nameRef) {
  const ref = String(nameRef || '').trim().slice(0, 5);
  if (!ref) return null;
  const matches = remoteControlVisibleNonRemoteChats().filter(chat => remoteControlChatTitle(chat).slice(0, 5) === ref);
  return matches[0] || null;
}

function remoteControlResolveParsedChat(parsed) {
  if (!parsed) return null;
  if (parsed.id) return remoteControlFindChat(parsed.id) || remoteControlDeduplicateRemoteChats(parsed.id);
  if (parsed.nameRef) return remoteControlFindChatByNameRef(parsed.nameRef);
  return null;
}

function remoteControlParsedLabel(parsed) {
  if (parsed && parsed.id) return String(parsed.id);
  if (parsed && parsed.nameRef) return `“${parsed.nameRef}”`;
  return '';
}

function remoteControlUsedIdEntries() {
  const rows = [];
  const seen = new Set();
  for (const chat of state.chats || []) {
    if (!chat || !chat.remoteControl || !chat.remoteControl.id) continue;
    if (chat.remoteControl.nameRef) continue;
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

function remoteControlBoundChatStatusEntries() {
  remoteControlPruneKnownChats();
  const rows = [];
  const seen = new Set();
  for (const chat of state.chats || []) {
    if (!chat || !chat.remoteControl) continue;
    const rc = chat.remoteControl || {};
    const nameRef = String(rc.nameRef || '').trim();
    const remoteId = String(rc.id || '').trim();
    if (nameRef && !remoteControlSessionNameRefs.has(nameRef)) continue;
    if (!remoteId && !nameRef) continue;
    const key = nameRef ? `name:${nameRef}:${chat.id}` : `id:${remoteId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (remoteId && !nameRef) remoteControlKnownChats.set(remoteId, chat.id);
    rows.push({
      kind: nameRef ? 'name' : 'id',
      remoteId,
      nameRef,
      chatId: chat.id,
      title: remoteControlChatTitle(chat) || chat.title || (remoteId ? `遥控 ${remoteId}` : '未命名对话'),
      replyNo: rc.replyNo || 0,
      temporary: !!chat.temporary || !!rc.temporary,
      chat
    });
  }
  rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'id' ? -1 : 1;
    if (a.kind === 'id') {
      const an = Number(a.remoteId);
      const bn = Number(b.remoteId);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
      return String(a.remoteId).localeCompare(String(b.remoteId), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    }
    return String(a.nameRef).localeCompare(String(b.nameRef), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
  return rows;
}

function remoteControlFormatSingleChatStatus(row) {
  const chat = row && row.chat;
  const task = (chat && typeof chatTaskById === 'function') ? chatTaskById(chat.id) : null;
  const running = !!(task && task.isGenerating) || !!(chat && typeof isChatGenerating === 'function' && isChatGenerating(chat.id));
  const latestOutlineIdx = remoteControlLatestOutlineIndex(chat);
  const latestOutlineMsg = latestOutlineIdx >= 0 ? chat.messages[latestOutlineIdx] : null;
  const outline = latestOutlineMsg && latestOutlineMsg.outline;
  const mode = running && task && task.mode ? task.mode : (outline ? 'outline' : 'chat');
  const outlineStatus = outline && outline.status ? String(outline.status) : '';
  const title = String((row && row.title) || '未命名对话').replace(/\s+/g, ' ').trim();
  const label = row.kind === 'name' ? `“${row.nameRef}”` : `#${row.remoteId}`;
  const parts = [running ? '运行中' : '空闲', `模式：${mode}`];
  if (outlineStatus) parts.push(`大纲：${outlineStatus}`);
  parts.push(`消息：${Array.isArray(chat && chat.messages) ? chat.messages.length : 0}`);
  parts.push(`AI回复：${row.replyNo || 0}`);
  if (row.temporary) parts.push('临时');
  return `${label} ${title}；${parts.join('；')}`;
}

function remoteControlFormatStatusOverview(running) {
  const rows = remoteControlBoundChatStatusEntries();
  const lines = [`当前状态：运行中对话 ${running} 个；已绑定对话 ${rows.length} 个。`];
  if (rows.length) {
    lines.push('', '已绑定对话状态：');
    for (const row of rows) lines.push(remoteControlFormatSingleChatStatus(row));
  }
  return lines.join('\n');
}

function remoteControlFormatRemoteChatList() {
  remoteControlPruneKnownChats();
  const rows = remoteControlUsedIdEntries();
  if (!rows.length) return '当前没有已绑定的遥控对话。';
  return ['当前遥控对话：'].concat(rows.map(row => {
    const title = String(row.title || `遥控 ${row.remoteId}`).replace(/\s+/g, ' ').trim();
    return `#${row.remoteId} ${title}${row.temporary ? '（临时）' : ''}；AI回复 ${row.replyNo || 0} 条`;
  })).join('\n');
}

function remoteControlFormatSidebarChatList(limit) {
  const n = Math.max(1, Math.min(50, parseInt(limit || 0, 10) || 0));
  const chats = remoteControlVisibleNonRemoteChats().slice(0, n);
  if (!chats.length) return '当前没有可列举的非遥控侧栏对话。';
  return [`当前侧栏前 ${chats.length} 条非遥控对话：`].concat(chats.map((chat, idx) => {
    const title = remoteControlChatTitle(chat) || '未命名对话';
    const key = title.slice(0, 5);
    return `${idx + 1}. ${title}${key ? `（可用 /${key}：... 指代）` : ''}`;
  })).join('\n');
}

function remoteControlEnsureNameRefBinding(chat, parsed) {
  if (!chat || !parsed || !parsed.nameRef) return;
  const nameRef = String(parsed.nameRef).trim();
  if (!nameRef) return;
  remoteControlSessionNameRefs.add(nameRef);
  chat.remoteControl = chat.remoteControl || { id: nameRef, replyNo: 0 };
  if (!chat.remoteControl.id) chat.remoteControl.id = nameRef;
  chat.remoteControl.nameRef = nameRef;
  if (parsed.tools) chat.remoteControl.useToolsDefault = true;
  if (parsed.normal && !parsed.tools) chat.remoteControl.useToolsDefault = false;
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
    return `
      <div class="remote-control-command-item">
        <div class="remote-control-command-title">
          <strong>${name}</strong>
          <code>${example}</code>
        </div>
        <div class="remote-control-command-desc">${desc}</div>
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

function remoteControlStripInternalPromptText(text) {
  let s = String(text || '').trim();
  if (!s) return '';

  const internalMarkers = [
    '【系统提示·全新大纲任务】',
    '【系统提示】',
    '【系统门禁】',
    '【System】',
    '[System]',
    '[Developer]',
    '[Tool]'
  ];

  for (const marker of internalMarkers) {
    const idx = s.indexOf(marker);
    if (idx >= 0) s = s.slice(0, idx).trim();
  }

  s = s
    .split('\n')
    .filter(line => {
      const t = String(line || '').trim();
      if (!t) return true;
      if (/^【系统提示/.test(t)) return false;
      if (/^【系统门禁/.test(t)) return false;
      if (/^请不要继承、继续或复用本对话/.test(t)) return false;
      if (/^本次任务必须重新从\s*save_outline\s*开始/.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();

  return s;
}

function remoteControlAssistantTextFromMessage(m) {
  if (!m || m._hiddenFromUI) return '';
  const candidates = [];
  if (m.outline && m.outline.finalAnswer) candidates.push(m.outline.finalAnswer);
  if (m.plan && m.plan.finalAnswer) candidates.push(m.plan.finalAnswer);
  if (m.content) candidates.push(m.content);

  for (const candidate of candidates) {
    const clean = remoteControlStripInternalPromptText(candidate);
    if (clean) return clean;
  }
  return '';
}

function remoteControlLatestAssistantText(chat, fromIndex) {
  for (let i = (chat.messages || []).length - 1; i >= Math.max(0, fromIndex || 0); i--) {
    const m = chat.messages[i];
    if (m && m.role === 'assistant' && !m._hiddenFromUI) {
      const text = remoteControlAssistantTextFromMessage(m);
      if (text) return text;
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
  return `[System]\n${remoteControlStripInternalPromptText(message) || '（无文本回复）'}`;
}

function remoteControlIsOwnMessageContent(content, cfg = remoteControlSettings()) {
  const text = String(content || '').trim();
  return !!(text && (text.startsWith(cfg.agentPrefix || '[Agent]') || text.startsWith('[System]')));
}

function remoteControlFormatTerminalResult(result, command) {
  if (typeof result === 'string') return result.trim() || 'NULL';
  if (!result || typeof result !== 'object') return 'NULL';
  if (!result.ok) return `执行失败：${result.error || '未知错误'}`;
  const stdout = String(result.stdout || '').trimEnd();
  const stderr = String(result.stderr || '').trimEnd();
  const chunks = [];
  chunks.push(`目录：${result.cwd || ''}`);
  chunks.push(`指令：${command}`);
  if (typeof result.returncode !== 'undefined') chunks.push(`退出码：${result.returncode}`);
  if (stdout) chunks.push(`[STDOUT]\n${stdout}`);
  if (stderr) chunks.push(`[STDERR]\n${stderr}`);
  if (!stdout && !stderr) chunks.push('NULL');
  return chunks.join('\n');
}

async function remoteControlRunTerminalCommand(command) {
  if (typeof callAgentBackend !== 'function') {
    throw new Error('local backend is not available');
  }
  const result = await callAgentBackend('remote_execute', {
    command,
    timeout: 60,
    requestTimeoutMs: 75000
  }, undefined, undefined, { skipConfirm: true });
  await remoteControlSendWechat(remoteControlFormatSystem(remoteControlFormatTerminalResult(result, command)));
}

async function remoteControlSendSandboxDirectory() {
  if (typeof callAgentBackend !== 'function') {
    throw new Error('local backend is not available');
  }
  const result = await callAgentBackend('workspace_info', {
    requestTimeoutMs: 15000
  }, undefined, undefined, { skipConfirm: true });
  if (!result || !result.ok) {
    await remoteControlSendWechat(remoteControlFormatSystem(`获取沙箱目录失败：${(result && result.error) || '未知错误'}`));
    return;
  }
  await remoteControlSendWechat(remoteControlFormatSystem(`沙箱根目录：${result.workspace || ''}\n当前工作目录：${result.cwd || result.workspace || ''}`));
}

async function remoteControlSwitchSandboxDirectory(path) {
  if (typeof callAgentBackend !== 'function') {
    throw new Error('local backend is not available');
  }
  const result = await callAgentBackend('set_workspace', {
    path,
    requestTimeoutMs: 15000
  }, undefined, undefined, { skipConfirm: true });
  if (result && result.ok) await remoteControlSendWechat(remoteControlFormatSystem(`切换沙箱目录成功：${result.workspace || path}`));
  else await remoteControlSendWechat(remoteControlFormatSystem(`切换沙箱目录失败：${(result && result.error) || '未知错误'}`));
}

async function remoteControlShutdownFromCommand() {
  await remoteControlSendWechat(remoteControlFormatSystem('远程遥控已关闭。'));
  const cfg = remoteControlSettings();
  cfg.enabled = false;
  remoteControlClearTimer();
  persistSettings();
  syncRemoteControlButton();
  await remoteControlStopRuntime();
}

async function remoteControlRestartFromCommand() {
  const cfg = remoteControlSettings();
  cfg.enabled = true;
  remoteControlRuntimeGeneration++;
  remoteControlClearTimer();
  try { await remoteControlStopBridge(); } catch (e) { console.warn('[remote-control] restart stop bridge failed:', e); }
  remoteControlResetMessageDedupe();
  remoteControlMarkActivity();
  persistSettings();
  syncRemoteControlButton();
  try {
    await remoteControlStartBridge();
    const userLimit = Math.max(2, Math.min(50, parseInt(cfg.pollLimit || 20, 10) || 20));
    const payload = await remoteControlReadWechat(Math.max(2, Math.min(50, userLimit * 2)));
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const userMessages = remoteControlUserMessagesFromRaw(messages, userLimit, cfg);
    remoteControlLastUserWindowKeys = userMessages.map((msg, idx) => remoteControlMessageWindowKey(msg, idx));
    remoteControlStartupMarker = '';
    remoteControlStartupMarkerFound = true;
    remoteControlScheduleNext();
  } catch (e) {
    console.error('[remote-control] restart failed:', e);
    if (typeof toast === 'function') toast('微信遥控重启失败：' + (e.message || e), 4000);
  }
}

async function remoteControlSendWechat(text) {
  const startedAt = remoteControlNow();
  remoteControlPendingSends++;
  remoteControlClearTimer();
  try {
    if (typeof callAgentBackend !== 'function') {
      throw new Error('local backend is not available');
    }
    const b64 = btoa(unescape(encodeURIComponent(String(text || ''))));
    const result = await callAgentBackend('wechat_bridge', {
      op: 'send',
      text_base64: b64,
      prefix: '',
      requestTimeoutMs: 90000,
      bridge_timeout: 90
    }, undefined, undefined, { skipConfirm: true });
    remoteControlLogTiming('wechat send', startedAt, `chars=${String(text || '').length}`);
    if (!result || !result.ok) throw new Error((result && result.error) || JSON.stringify(result));
    remoteControlMarkActivity();
    return result;
  } finally {
    remoteControlPendingSends = Math.max(0, remoteControlPendingSends - 1);
    if (remoteControlCanSchedulePoll()) {
      remoteControlScheduleNext();
    }
  }
}

function remoteControlCanSchedulePoll() {
  // The backend bridge serializes WeChat UI access. Keep scheduling reads
  // even while sends are queued so the backend can force one read after the
  // configured number of consecutive sends.
  return remoteControlSettings().enabled;
}

function remoteControlMessageWindowKey(msg, index = 0) {
  if (!msg || typeof msg !== 'object') return `empty:${index}`;
  const stable = String(msg.stable_id || msg.stableId || msg.id || '').trim();
  if (stable) return stable;
  const content = String(msg.content || '').trim();
  const sender = String(msg.sender || '').trim();
  const time = String(msg.time || msg.context_time || '').trim();
  const type = String(msg.type || '').trim();
  return `${index}:${sender}:${time}:${type}:${content}`;
}

function remoteControlMessageOverlapKey(key) {
  const text = String(key || '');
  const hashPos = text.lastIndexOf('#');
  if (hashPos > 0 && /^\d+$/.test(text.slice(hashPos + 1))) {
    return text.slice(0, hashPos);
  }
  return text;
}

function remoteControlForwardOverlapCount(previousKeys, currentKeys) {
  const maxOverlap = Math.min(previousKeys.length, currentKeys.length);
  for (let n = maxOverlap; n > 0; n--) {
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (previousKeys[previousKeys.length - n + i] !== currentKeys[i]) { ok = false; break; }
    }
    if (ok) return n;
  }
  return 0;
}

function remoteControlReverseOverlapCount(previousKeys, currentKeys) {
  const maxOverlap = Math.min(previousKeys.length, currentKeys.length);
  for (let n = maxOverlap; n > 0; n--) {
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (previousKeys[i] !== currentKeys[currentKeys.length - n + i]) { ok = false; break; }
    }
    if (ok) return n;
  }
  return 0;
}

function remoteControlNewItemsBySlidingWindow(previousKeys, currentItems, keyFn) {
  const prev = Array.isArray(previousKeys) ? previousKeys.map(remoteControlMessageOverlapKey) : [];
  const currKeys = (currentItems || []).map((item, idx) => String(keyFn(item, idx)));
  const curr = currKeys.map(remoteControlMessageOverlapKey);
  if (!prev.length) return { overlap: 0, keys: currKeys, items: currentItems || [] };
  if (!curr.length) return { overlap: 0, keys: currKeys, items: [] };
  const forwardOverlap = remoteControlForwardOverlapCount(prev, curr);
  const reverseOverlap = remoteControlReverseOverlapCount(prev, curr);
  if (forwardOverlap <= 0 && reverseOverlap <= 0) return { overlap: 0, keys: currKeys, items: currentItems || [] };
  if (forwardOverlap >= reverseOverlap) {
    return { overlap: forwardOverlap, keys: currKeys, items: (currentItems || []).slice(forwardOverlap) };
  }
  const newestFirstItems = (currentItems || []).slice(0, Math.max(0, currentItems.length - reverseOverlap));
  return { overlap: reverseOverlap, keys: currKeys, items: newestFirstItems.reverse() };
}

function remoteControlFindStartupMarkerIndex(messages) {
  const marker = String(remoteControlStartupMarker || '').trim();
  if (!marker) return -1;
  return (messages || []).findIndex(msg => String((msg && msg.content) || '').trim() === marker);
}

function remoteControlUpdateWindowDirectionFromMarker(markerIndex, messages) {
  if (markerIndex === 0 && (messages || []).length > 1) remoteControlNewestFirstWindow = true;
  else if (markerIndex === (messages || []).length - 1) remoteControlNewestFirstWindow = false;
}

function remoteControlRawMessagesAfterStartupMarker(messages, markerIndex) {
  if (markerIndex < 0) return null;
  return remoteControlNewestFirstWindow ? (messages || []).slice(0, markerIndex) : (messages || []).slice(markerIndex + 1);
}

async function remoteControlReadWechat(limit) {
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit || 20, 10) || 20));
  const startedAt = remoteControlNow();
  if (typeof callAgentBackend !== 'function') {
    throw new Error('local backend is not available');
  }
  const payload = await callAgentBackend('wechat_bridge', {
    op: 'read',
    limit: safeLimit,
    requestTimeoutMs: 90000,
    bridge_timeout: 90,
    max_consecutive_sends_before_read: Math.max(1, parseInt(remoteControlSettings().maxConsecutiveSendsBeforePoll || 5, 10) || 5)
  }, undefined, undefined, { skipConfirm: true });
  remoteControlLogTiming('wechat read', startedAt, `limit=${safeLimit}`);
  if (!payload || !payload.ok) throw new Error((payload && payload.error) || JSON.stringify(payload));
  return payload;
}

async function remoteControlDisableAfterStartupMarkerError() {
  const message = remoteControlFormatSystem('远程遥控启动失败：连续两次轮询未找到本次启动标识，无法可靠区分历史消息，已自动退出。');
  try { await remoteControlSendWechat(message); } catch (e) { console.error('[remote-control] startup marker error send failed:', e); }
  const cfg = remoteControlSettings();
  cfg.enabled = false;
  remoteControlClearTimer();
  persistSettings();
  syncRemoteControlButton();
  await remoteControlStopRuntime();
}

function remoteControlUserMessagesFromRaw(messages, maxUserMessages, cfg = remoteControlSettings()) {
  const users = [];
  for (const msg of messages || []) {
    const content = String((msg && msg.content) || '').trim();
    if (!content) continue;
    if (remoteControlIsOwnMessageContent(content, cfg)) continue;
    users.push(msg);
  }
  const limit = Math.max(2, Math.min(50, parseInt(maxUserMessages || 20, 10) || 20));
  return remoteControlNewestFirstWindow ? users.slice(0, limit).reverse() : users.slice(-limit);
}

function remoteControlEnsureRuntimeDeliveryId(msg) {
  if (!msg || typeof msg !== 'object') return '';
  const existing = String(msg.delivery_id || msg.deliveryId || '').trim();
  if (existing) return existing;
  const runtimeId = `runtime:${remoteControlRuntimeGeneration}:${++remoteControlDeliverySeq}`;
  msg.delivery_id = runtimeId;
  return runtimeId;
}

function remoteControlDispatchMessages(messages, cfg = remoteControlSettings()) {
  for (const msg of messages || []) {
    const content = String((msg && msg.content) || '').trim();
    if (!content) continue;
    remoteControlMarkActivity();
    if (remoteControlHandlePermissionReply(content)) continue;
    const parsed = remoteControlParseMessage(content);
    if (!parsed.ok) {
      if (cfg.autoSendErrors && content.startsWith('/')) remoteControlSendWechat(remoteControlFormatSystem(parsed.error)).catch(e => console.error('[remote-control] error reply failed:', e));
      continue;
    }
    remoteControlDispatchParsed(parsed, msg);
  }
}

function remoteControlMessageKey(msg) {
  const delivery = String((msg && (msg.delivery_id || msg.deliveryId)) || '').trim();
  const runtimeDelivery = /^runtime:\d+:\d+$/.test(delivery);
  const stable = String((msg && (msg.stable_id || msg.stableId)) || '').trim();
  const id = msg && msg.id ? String(msg.id) : '';
  const resetWindow = !!(msg && (msg._rcWindowReset || msg.window_reset));
  const resetPart = resetWindow ? `reset:${String((msg && (msg._rcPollKey || msg.polled_at)) || Date.now())}:` : '';
  if (stable) return `${resetPart}stable:${stable}`;
  if (id) return `${resetPart}id:${id}`;
  if (delivery && !runtimeDelivery) return `${resetPart}delivery:${delivery}`;
  const content = String((msg && msg.content) || '').trim();
  const sender = String((msg && msg.sender) || '').trim();
  const time = String((msg && (msg.time || msg.context_time)) || '').trim();
  const type = String((msg && msg.type) || '').trim();
  if (content || sender || time || type) return `${resetPart}fallback:${sender}:${time}:${type}:${content}`;
  const runtimeId = runtimeDelivery ? delivery : remoteControlEnsureRuntimeDeliveryId(msg);
  if (runtimeId) return `${resetPart}delivery:${String(runtimeId)}`;
  return `${resetPart}runtime:${remoteControlRuntimeGeneration}:${++remoteControlDeliverySeq}`;
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
  return !!(parsed && (parsed.id || parsed.nameRef || parsed.temporary) && parsed.body && !parsed.create && !parsed.stop && !parsed.stats && !parsed.regenerate && !parsed.compress && !parsed.outlineInject && !parsed.outlineFinish && !parsed.outlineContinue && !parsed.outlineStatus && !parsed.help && !parsed.status);
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
  if (parsed && parsed.temporary && !parsed.id) return remoteControlFormatSystem('已引导临时对话');
  const label = remoteControlParsedLabel(parsed);
  return remoteControlFormatSystem('已引导对话' + (label ? ` ${label}` : ''));
}

function remoteControlReplyId(parsed) {
  if (parsed && parsed.id) return String(parsed.id);
  if (parsed && parsed.nameRef) return String(parsed.nameRef);
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

function remoteControlLatestOutlineIndex(chat) {
  if (!chat || !Array.isArray(chat.messages)) return -1;
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m && m.outline) return i;
  }
  return -1;
}

function remoteControlLatestAssistantIndex(chat) {
  if (!chat || !Array.isArray(chat.messages)) return -1;
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m && m.role === 'assistant' && !m._hiddenFromUI) return i;
  }
  return -1;
}

function remoteControlEnsureOutlineTarget(chat, label) {
  const idx = remoteControlLatestOutlineIndex(chat);
  if (idx < 0) throw new Error(`对话 ${label} 当前不是大纲模式。`);
  const msg = chat.messages[idx];
  if (!msg || !msg.outline) throw new Error(`对话 ${label} 当前不是大纲模式。`);
  return { msgIdx: idx, aiMsg: msg };
}

function remoteControlIsOutlineRunning(chat) {
  if (!chat) return false;
  const task = (typeof chatTaskById === 'function') ? chatTaskById(chat.id) : null;
  return !!((task && task.isGenerating && task.mode === 'outline') || (typeof isChatTaskMode === 'function' && isChatTaskMode(chat.id, 'outline')));
}

function remoteControlOutlineStatusLabel(status, outline) {
  const s = String(status || '').trim();
  if (s === 'running') return outline && outline.finishRequested ? '运行中（收尾中）' : '运行中';
  if (s === 'paused') return '暂停';
  if (s === 'error') return '中止';
  if (s === 'cancelled') return '中止';
  return s || '未知';
}

function remoteControlOutlineItemStatusLabel(status) {
  const s = String(status || 'pending').trim();
  if (s === 'done') return '已完成';
  if (s === 'active') return '执行中';
  if (s === 'skipped') return '已跳过';
  return '未完成';
}

function remoteControlFormatOutlineStatus(chat, parsed) {
  const label = remoteControlParsedLabel(parsed);
  if (!chat || !Array.isArray(chat.messages)) throw new Error(`对话 ${label} 不存在或无法唯一定位。`);
  const idx = remoteControlLatestAssistantIndex(chat);
  if (idx < 0) throw new Error(`对话 ${label} 当前不是大纲模式。`);
  const aiMsg = chat.messages[idx];
  if (!aiMsg || !aiMsg.outline) throw new Error(`对话 ${label} 当前不是大纲模式。`);
  const outline = aiMsg.outline || {};
  const status = String(outline.status || '').trim();
  if (['completed', 'truncated'].includes(status)) {
    throw new Error(`对话 ${label} 大纲模式已结束。`);
  }
  if (status === 'cancelled' && !outline.inProgress && !outline._snap) {
    throw new Error(`对话 ${label} 大纲模式已结束。`);
  }

  const lines = [
    `对话 ${label} 大纲状态`,
    `当前轮次：第 ${Number(outline.rounds || 0)} 轮`,
    `状态：${remoteControlOutlineStatusLabel(status, outline)}`
  ];
  if (outline.maxRounds) lines.push(`最大轮数：${Number(outline.maxRounds || 0)} 轮`);

  const items = Array.isArray(outline.items) ? outline.items : [];
  if (!items.length) {
    lines.push('', '大纲尚未规划');
  } else {
    lines.push('', '大纲步骤：');
    for (const it of items) {
      const id = it && it.id ? String(it.id) : '-';
      const title = it && it.title ? String(it.title) : '(未命名步骤)';
      const itemStatus = remoteControlOutlineItemStatusLabel(it && it.status);
      lines.push(`${id}. [${itemStatus}] ${title}`);
    }
  }
  return lines.join('\n');
}

async function remoteControlSendOutlineStatus(chat, parsed) {
  try {
    await remoteControlSendWechat(remoteControlFormatSystem(remoteControlFormatOutlineStatus(chat, parsed)));
  } catch (e) {
    await remoteControlSendWechat(remoteControlFormatSystem(e.message || e));
  }
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
  const remoteId = remoteControlParsedLabel(parsed) || String(parsed && (parsed.id || parsed.nameRef) || '');
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

async function remoteControlCompressChat(chat, parsed) {
  const label = remoteControlParsedLabel(parsed);
  if (!chat || !Array.isArray(chat.messages)) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 不存在。`));
    return;
  }
  if (typeof isChatGenerating === 'function' && isChatGenerating(chat.id)) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 正在运行中，无法压缩。`));
    return;
  }
  if (chat.messages.length < 4) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 太短，无需压缩。`));
    return;
  }
  if (chat.debate && chat.debate.type === 'debate_mode') {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 是辩论模式，远程遥控暂不支持压缩。`));
    return;
  }
  if (!state.settings.apiKey) {
    await remoteControlSendWechat(remoteControlFormatSystem('压缩失败：请先配置 API Key。'));
    return;
  }
  if (typeof compressChat !== 'function') {
    await remoteControlSendWechat(remoteControlFormatSystem('压缩失败：当前页面未加载压缩功能。'));
    return;
  }
  try {
    const beforeCount = chat.messages.length;
    const ok = await compressChat(chat, { reason: 'manual', touchGlobalGenerating: true, chat, chatId: chat.id });
    if (!ok) {
      await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 无法压缩。`));
      return;
    }
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 已压缩。原 ${beforeCount} 条，现 ${chat.messages.length} 条。`));
  } catch (e) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 压缩失败：${e.message || e}`));
  }
}

async function remoteControlOutlineInject(chat, parsed) {
  const label = remoteControlParsedLabel(parsed);
  try {
    remoteControlEnsureOutlineTarget(chat, label);
  } catch (e) {
    await remoteControlSendWechat(remoteControlFormatSystem(e.message || e));
    return;
  }
  if (!remoteControlIsOutlineRunning(chat)) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 当前大纲任务不在运行中，无法补充。`));
    return;
  }
  const target = remoteControlEnsureOutlineTarget(chat, label);
  const waitUntilIdle = async (timeoutMs = 15000) => {
    const start = Date.now();
    while (typeof isChatGenerating === 'function' && isChatGenerating(chat.id)) {
      if (Date.now() - start > timeoutMs) throw new Error('等待大纲任务暂停超时');
      await new Promise(r => setTimeout(r, 150));
    }
  };
  const userMsg = {
    role: 'user',
    content: String(parsed.body || '').trim(),
    _midrunGuidance: true,
    _queuedAt: Date.now()
  };
  const task = (typeof chatTaskById === 'function') ? chatTaskById(chat.id) : null;
  if (task && task.pendingGuidance) {
    task.pendingGuidance.content = [task.pendingGuidance.content || '', userMsg.content || ''].filter(Boolean).join('\n\n');
    task.pendingGuidance._queuedAt = Date.now();
    task.guidanceRequested = true;
  } else if (typeof setChatTaskGuidance === 'function') {
    setChatTaskGuidance(chat.id, userMsg);
  } else if (task) {
    task.pendingGuidance = userMsg;
    task.guidanceRequested = true;
  }
  const runningTask = (typeof chatTaskById === 'function') ? chatTaskById(chat.id) : null;
  const ctrl = runningTask ? (runningTask.abortCtrl || state.abortCtrl) : state.abortCtrl;
  if (runningTask) {
    runningTask.stopRequested = true;
    runningTask.guidanceRequested = true;
  }
  state.stopRequested = true;
  if (ctrl) {
    try { ctrl.abort(); } catch (e) { console.error('[remote-control] outline inject abort failed:', e); }
  }
  if (typeof window !== 'undefined' && window._rateWaitAbort) {
    try { window._rateWaitAbort(ctrl && ctrl.signal); } catch (e) {}
  }
  try {
    await waitUntilIdle();
    const latest = remoteControlEnsureOutlineTarget(chat, label);
    const status = String((latest.aiMsg.outline && latest.aiMsg.outline.status) || '');
    if ((status !== 'paused' && status !== 'error') || !latest.aiMsg.outline._snap) {
      await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 已暂停，但当前状态无法继续补充执行。`));
      return;
    }
    await callAPIWithOutline({ chatId: chat.id, resumeFromMsgIdx: latest.msgIdx, userInjection: String(parsed.body || '').trim(), suppressCompletionSound: true });
    const answer = remoteControlLatestAssistantText(chat, target.msgIdx);
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 已补充并继续执行。\n${answer || '（无文本回复）'}`));
  } catch (e) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 补充失败：${e.message || e}`));
  }
}

async function remoteControlOutlineFinish(chat, parsed) {
  const label = remoteControlParsedLabel(parsed);
  let target;
  try { target = remoteControlEnsureOutlineTarget(chat, label); }
  catch (e) { await remoteControlSendWechat(remoteControlFormatSystem(e.message || e)); return; }
  if (typeof finishOutlineNow !== 'function') {
    await remoteControlSendWechat(remoteControlFormatSystem('收尾失败：当前页面未加载大纲收尾功能。'));
    return;
  }
  const previousCurrentId = state.currentId;
  state.currentId = chat.id;
  try {
    await finishOutlineNow(target.msgIdx, { skipConfirm: true });
    await remoteControlSendWechat(remoteControlFormatSystem(`已请求对话 ${label} 收尾。`));
  } catch (e) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 收尾失败：${e.message || e}`));
  } finally {
    state.currentId = previousCurrentId;
  }
}

async function remoteControlOutlineContinue(chat, parsed) {
  const label = remoteControlParsedLabel(parsed);
  let target;
  try { target = remoteControlEnsureOutlineTarget(chat, label); }
  catch (e) { await remoteControlSendWechat(remoteControlFormatSystem(e.message || e)); return; }
  if (remoteControlIsOutlineRunning(chat) || (typeof isChatGenerating === 'function' && isChatGenerating(chat.id))) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 当前正在运行中，无法继续。`));
    return;
  }
  const status = String((target.aiMsg.outline && target.aiMsg.outline.status) || '');
  if ((status !== 'paused' && status !== 'error') || !target.aiMsg.outline._snap) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 当前不处于可继续的大纲暂停/错误状态。`));
    return;
  }
  try {
    await callAPIWithOutline({ chatId: chat.id, resumeFromMsgIdx: target.msgIdx, suppressCompletionSound: true });
    const answer = remoteControlLatestAssistantText(chat, target.msgIdx);
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 已继续执行。\n${answer || '（无文本回复）'}`));
  } catch (e) {
    await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 继续失败：${e.message || e}`));
  }
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
  remoteControlSendWechat(remoteControlFormatSystem('已收到消息并执行。')).catch(e => {
    console.error('[remote-control] chat ack send failed:', e);
  });
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
    await remoteControlSendWechat(remoteControlFormatSystem(remoteControlFormatHelpExamples()));
    return;
  }
  if (parsed.shutdownRemote) {
    await remoteControlShutdownFromCommand();
    return;
  }
  if (parsed.restartRemote) {
    await remoteControlRestartFromCommand();
    return;
  }
  if (parsed.status) {
    const tasks = (typeof ensureChatTasks === 'function') ? ensureChatTasks() : {};
    const running = Object.values(tasks).filter(t => t && t.isGenerating).map(t => t.chatId).length;
    await remoteControlSendWechat(remoteControlFormatSystem(remoteControlFormatStatusOverview(running)));
    return;
  }
  if (parsed.listRemoteChats) {
    await remoteControlSendWechat(remoteControlFormatSystem(remoteControlFormatRemoteChatList()));
    return;
  }
  if (parsed.listSidebarChats) {
    await remoteControlSendWechat(remoteControlFormatSystem(remoteControlFormatSidebarChatList(parsed.id)));
    return;
  }
  if (parsed.terminal) {
    await remoteControlRunTerminalCommand(parsed.body);
    return;
  }
  if (parsed.sandboxDir) {
    await remoteControlSendSandboxDirectory();
    return;
  }
  if (parsed.switchDir) {
    await remoteControlSwitchSandboxDirectory(parsed.body);
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
  // is running. /停止/N interrupts the in-flight task; /补充/N and /收尾/N are
  // designed for a running outline task. Do these before acquiring the
  // per-remote-id execution lock, otherwise they would be rejected as "正在执行"
  // exactly when they are most needed.
  if ((parsed.id || parsed.nameRef) && !parsed.create && (
    parsed.stats || parsed.stop || parsed.outlineStatus ||
    parsed.compress || parsed.outlineInject || parsed.outlineFinish || parsed.outlineContinue
  )) {
    const existingChat = remoteControlResolveParsedChat(parsed);
    const label = remoteControlParsedLabel(parsed);
    if (!existingChat) {
      await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 不存在或无法唯一定位。`));
    } else if (parsed.stats) {
      await remoteControlSendWechat(remoteControlFormatSystem(remoteControlFormatTokenStats(existingChat)));
    } else if (parsed.outlineStatus) {
      await remoteControlSendOutlineStatus(existingChat, parsed);
    } else if (parsed.compress) {
      await remoteControlCompressChat(existingChat, parsed);
    } else if (parsed.outlineInject) {
      await remoteControlOutlineInject(existingChat, parsed);
    } else if (parsed.outlineFinish) {
      await remoteControlOutlineFinish(existingChat, parsed);
    } else if (parsed.outlineContinue) {
      await remoteControlOutlineContinue(existingChat, parsed);
    } else if (parsed.stop) {
      if (typeof requestStopChatTask === 'function') requestStopChatTask(existingChat.id);
      await remoteControlSendWechat(remoteControlFormatSystem(`已请求停止对话 ${label} 的生成。`));
    }
    return;
  }
  const lockId = parsed.id ? String(parsed.id) : (parsed.nameRef ? `name:${parsed.nameRef}` : '');
  if (lockId && !remoteControlAcquireRemoteLock(lockId)) {
    const existingChat = remoteControlResolveParsedChat(parsed);
    if (remoteControlQueueGuidance(existingChat, parsed)) {
      await remoteControlSendWechat(remoteControlGuidanceAck(parsed));
    } else {
      await remoteControlSendWechat(remoteControlFormatSystem('对话' + remoteControlParsedLabel(parsed) + '正在执行，当前指令暂未执行。'));
    }
    console.warn('[remote-control] duplicate/in-flight remote id handled:', lockId);
    return;
  }
  try {
    const existingChat = remoteControlResolveParsedChat(parsed);
    const label = remoteControlParsedLabel(parsed);
    if (parsed.create && existingChat) {
      await remoteControlSendWechat(remoteControlFormatSystem(`对话 ${label} 已存在，不能重复创建。请直接发送 /${parsed.id || parsed.nameRef}：继续对话，或删除该对话后再新建。`));
      return;
    }
    if (!parsed.create && !existingChat) {
      await remoteControlSendWechat(remoteControlFormatSystem(parsed.nameRef ? `未找到名称前五字为“${parsed.nameRef}”的非遥控侧栏对话。请发送 /列举/N 查看可用名称。` : `对话 ${parsed.id} 不存在，请先发送 /新建对话/${parsed.id}：你的问题 来新建对话。`));
      return;
    }

    const chat = existingChat || remoteControlEnsureChat(parsed);
    remoteControlEnsureNameRefBinding(chat, parsed);
    if (parsed.tools && chat) {
      chat.remoteControl = chat.remoteControl || { id: String(parsed.id || parsed.nameRef), replyNo: 0 };
      chat.remoteControl.useToolsDefault = true;
    }
    if (parsed.normal && !parsed.tools && chat) {
      chat.remoteControl = chat.remoteControl || { id: String(parsed.id || parsed.nameRef), replyNo: 0 };
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
    if (parsed.compress) {
      await remoteControlCompressChat(chat, parsed);
      return;
    }
    if (parsed.outlineInject) {
      await remoteControlOutlineInject(chat, parsed);
      return;
    }
    if (parsed.outlineFinish) {
      await remoteControlOutlineFinish(chat, parsed);
      return;
    }
    if (parsed.outlineContinue) {
      await remoteControlOutlineContinue(chat, parsed);
      return;
    }
    if (parsed.outlineStatus) {
      await remoteControlSendOutlineStatus(chat, parsed);
      return;
    }
    if (parsed.stop) {
      if (typeof requestStopChatTask === 'function') requestStopChatTask(chat.id);
      await remoteControlSendWechat(remoteControlFormatSystem(`已请求停止对话 ${remoteControlParsedLabel(parsed)} 的生成。`));
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
  remoteControlPolling = true;
  try {
    const cfg = remoteControlSettings();
    const userLimit = Math.max(2, Math.min(50, parseInt(cfg.pollLimit || 20, 10) || 20));
    const limit = remoteControlStartupMarkerFound ? Math.max(2, Math.min(50, userLimit * 2)) : 20;
    cfg.pollLimit = userLimit;
    const payload = await remoteControlReadWechat(limit);
    if (payload && (payload.busy || payload.coalesced)) {
      console.debug('[remote-control] read coalesced; keeping previous message window.');
      return;
    }
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const markerIndex = remoteControlFindStartupMarkerIndex(messages);
    if (markerIndex >= 0) {
      remoteControlUpdateWindowDirectionFromMarker(markerIndex, messages);
      remoteControlStartupMarkerFound = true;
      const afterMarkerRaw = remoteControlRawMessagesAfterStartupMarker(messages, markerIndex);
      const afterMarkerUsers = remoteControlUserMessagesFromRaw(afterMarkerRaw, userLimit, cfg);
      const diff = remoteControlNewItemsBySlidingWindow(remoteControlLastUserWindowKeys, afterMarkerUsers, remoteControlMessageWindowKey);
      remoteControlLastUserWindowKeys = diff.keys;
      remoteControlDispatchMessages(diff.items, cfg);
      return;
    }
    if (!remoteControlStartupMarkerFound) {
      remoteControlStartupMarkerPollAttempts++;
      if (remoteControlStartupMarkerPollAttempts >= 2) await remoteControlDisableAfterStartupMarkerError();
      return;
    }
    if (!remoteControlLastUserWindowKeys.length) {
      const userMessages = remoteControlUserMessagesFromRaw(messages, userLimit, cfg);
      remoteControlLastUserWindowKeys = userMessages.map((msg, idx) => remoteControlMessageWindowKey(msg, idx));
      console.warn('[remote-control] startup marker fell out of read window before any post-marker user message; current window baselined without dispatch.');
      return;
    }
    const userMessages = remoteControlUserMessagesFromRaw(messages, userLimit, cfg);
    const diff = remoteControlNewItemsBySlidingWindow(remoteControlLastUserWindowKeys, userMessages, remoteControlMessageWindowKey);
    remoteControlLastUserWindowKeys = diff.keys;
    remoteControlDispatchMessages(diff.items, cfg);
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
  _rcSetValue('remoteControlMaxConsecutiveSendsBeforePoll', cfg.maxConsecutiveSendsBeforePoll || 5);
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
  if (limitEl) cfg.pollLimit = Math.max(2, Math.min(50, parseInt(limitEl.value || '20', 10) || 20));
  const maxSendsEl = document.getElementById('remoteControlMaxConsecutiveSendsBeforePoll');
  if (maxSendsEl) cfg.maxConsecutiveSendsBeforePoll = Math.max(1, Math.min(100, parseInt(maxSendsEl.value || '5', 10) || 5));
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
