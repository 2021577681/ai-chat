const StateConfig = (typeof window !== 'undefined' && window.AgentApp)
  ? window.AgentApp.require('config')
  : null;
const StateUiService = (typeof window !== 'undefined' && window.AgentApp)
  ? window.AgentApp.require('uiService')
  : null;
const STATE_REFLECTION_PRESETS = StateConfig ? StateConfig.REFLECTION_PRESETS : REFLECTION_PRESETS;
const STATE_PLAN_PRESETS = StateConfig ? StateConfig.PLAN_PRESETS : PLAN_PRESETS;
const STATE_BUILTIN_TOOLS = StateConfig ? StateConfig.BUILTIN_TOOLS : BUILTIN_TOOLS;
const STORAGE_KEYS = StateConfig
  ? {
      store: StateConfig.STORE_KEY,
      settings: StateConfig.SETTINGS_KEY,
      tools: StateConfig.TOOLS_KEY,
      builtinToolsLoaded: StateConfig.BUILTIN_TOOLS_LOADED_KEY
    }
  : {
      store: STORE_KEY,
      settings: SETTINGS_KEY,
      tools: TOOLS_KEY,
      builtinToolsLoaded: BUILTIN_TOOLS_LOADED_KEY
    };

function stateToast(message, ms) {
  if (StateUiService && typeof StateUiService.toast === 'function') {
    StateUiService.toast(message, ms);
  }
}

// ============ 全局状态 ============
let state = {
  chats: [],
  temporaryChat: null,
  currentId: null,
  tools: [],
  settings: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiPath: '/chat/completions',
    apiFormat: 'openai',
    apiKey: '',
    modelName: 'gpt-4o-mini, gpt-4o',
    currentModel: 'gpt-4o-mini',
    systemPrompt: '你是一个友好的助手。回答时使用 Markdown 格式让内容更易读，代码用```语法块，数学公式用 $...$。请简洁、准确地回答用户的问题。',
    temperature: 0.7,
    maxTokens: 2048,
    stream: true,
    completionSoundEnabled: false,
    completionSoundVolume: 80,
    maxToolRounds: 15,
    theme: 'light',
    coolMode: false,
    securityMode: false,
    securityModeSnapshot: null,
    useTools: false,
    useReflection: false,
    refRounds: 3,
    refMinScore: 9,
    refStudentModel: '',
    refTeacherModel: '',
    refStudentPrompt: STATE_REFLECTION_PRESETS.general.student,
    refTeacherPrompt: STATE_REFLECTION_PRESETS.general.teacher,
    // 🔧 师生模式工具调用支持
    refStudentUseTools: true,           // 学生是否允许调用工具（多轮完成任务）
    refTeacherUseTools: true,           // 老师是否允许调用工具（独立验证答案）
    refStudentMaxToolRounds: 15,        // 学生单轮最多工具调用循环次数
    refTeacherMaxToolRounds: 5,         // 老师单轮最多工具调用循环次数
    usePlan: false,
    planReview: true,
    planSynthesize: true,
    planMaxSteps: 5,
    planReviewRounds: 2,
    planPlannerModel: '',
    planExecutorModel: '',
    planVerify: true,
    planVerifyRounds: 2,
    planVerifierModel: '',
    planPlannerPrompt: STATE_PLAN_PRESETS.general.planner,
    planExecutorPrompt: STATE_PLAN_PRESETS.general.executor,
    // 📑 大纲模式（动态规划）
    useOutline: false,
    outlineMaxRounds: 30,
    outlineMaxItems: 8,
    outlineModel: '',
    outlineSystemPrompt: '',  // 留空则使用 outline.js 中的 DEFAULT_OUTLINE_SYSTEM_PROMPT
    outlinePermissionAutoAllow: false, // 大纲模式权限弹窗 3 分钟无人响应时默认允许本次调用
    outlineCodeTaskPrompt: '',
    outlineClassifierPrompt: '',
    outlineBudgetHalfPrompt: '',
    outlineBudgetLowPrompt: '',
    outlineBudgetCriticalPrompt: '',
    outlineGateNoVerifyPrompt: '',
    outlineGateStaleVerifyPrompt: '',
    outlineGateFailedVerifyPrompt: '',
    outlineForceFinalSystemPrompt: '',
    outlineForceFinalUserPrompt: '',
    outlineUserInjectionPrompt: '',
    outlineFreshTaskPrompt: '',
    outlineRequireStartPrompt: '',
    outlineToolRejectStopPrompt: '',
    outlineToolRejectOncePrompt: '',
    outlineStalledPrompt: '',
    // 📊 PPT 独立模式
    usePpt: false,
    pptSlideCount: 8,
    pptRenderStyle: '',
    pptUnderstandPrompt: '',
    pptOutlinePrompt: '',
    pptPageTypePrompt: '',
    pptHtmlPrompt: '',
    pptModel: '',
    pptTemperature: 0.6,
    pptEditableText: false,
    contextLimitMode: 'auto',
    contextLimitOverride: 0,
    compressAutoEnabled: false,
    compressAutoThreshold: 75,
    compressKeepLast: 4,
    rateMaxPerMinute: 20,
    rateMinIntervalMs: 0,
    rateRandomMinMs: 0,
    rateRandomMaxMs: 0,
    useCustomJson: false,
    jsonTemplate: '',
    jsonHeaders: '{}',
    reasoningEffort: '',
    // ⭐ 跨域代理：通过本地服务（local_terminal_server.py）转发 LLM 请求
    // 默认开启 —— 大部分用户用本地项目时都会遇到 CORS 问题
    useLocalProxy: true,
    // 🌐 搜索工具代理：让 web_search / fetch_url 后端请求走本机 HTTP/SOCKS 代理，解决 Google 等网络问题
    searchProxyEnabled: false,
    searchProxyUrl: 'http://127.0.0.1:7890',
    // ⭐ 自动重试：网络抖动 / HTTP 5xx / 429 / 流中途断开时自动重发
    retryMaxAttempts: -1,       // 最多重试次数；-1 表示无限重试
    retryPolicyVersion: 2,      // v2 默认使用无限重试 + 5 次后固定 2s
    retryBaseDelayMs: 1000,     // 前 5 次退避基数（毫秒），之后固定 2s
    // 🧪 自动信标系统：每隔 N 条用户消息塞入一条隐藏的"记代号"消息，
    //    供"体检"功能测试 AI 是否还记得上下文（中段消息最易丢）
    beaconEnabled: false,       // 默认关闭，避免增加不必要 token
    beaconInterval: 5,          // 每 N 条用户消息埋一个（1 表示每条都埋，5 表示每 5 条）
    privacyGuard: {
      enabled: false,
      replacementMode: 'mask',
      localRestoreEnabled: false,
      localRestoreRetention: 'request',
      fakeTemplates: {
        EMAIL: 'user{seq}@example.com',
        PHONE: '1380000{n4}',
        ID: '11010119900101{id3}X',
        BANK_CARD: '622202000000{bank4}',
        IP: '10.0.0.{ip}',
        URL: 'https://example.com/resource-{seq}',
        FILE_PATH: '/tmp/masked/path-{seq}',
        NAME: '用户{seq}',
        CUSTOM: '[FAKE_CUSTOM_{seq}]',
        CUSTOM_REGEX: '[FAKE_CUSTOM_REGEX_{seq}]',
        SECRET: '[FAKE_SECRET_{seq}]',
        PASSWORD: '[FAKE_PASSWORD_{seq}]',
        COOKIE: '[FAKE_COOKIE_{seq}]',
        PRIVATE_KEY: '[FAKE_PRIVATE_KEY_{seq}]'
      },
      stripHighRisk: true,
      includeSystemPrompt: true,
      includeToolResults: true,
      includeAssistantHistory: true,
      includeTextAttachments: true,
      binaryAttachmentPolicy: 'strip',
      addSafetyInstruction: true,
      safetyInstructionText: '隐私模式已启用：输入中的 [MASK_*] 或 [REDACTED_*] 是本地脱敏占位符。不要猜测、补全、还原或输出任何被脱敏的真实隐私值。',
      localRestoreInstructionText: '隐私本地还原模式已启用：输入中的 [MASK_*] 是真实隐私数据的稳定占位符。你可以像使用真实值一样引用、比较、传递这些占位符，尤其是在工具调用参数中必须原样使用占位符；本地客户端会在必要时还原。不要声称因为数据被隐藏或脱敏而无法继续；不要猜测、补全或输出真实隐私值。',
      responseGuardInstructionText: '回答结束时必须单独输出完整结束标记 {marker}，标记后不要再输出任何内容。',
      detector: {
        secrets: true,
        email: true,
        phone: true,
        idCard: true,
        bankCard: true,
        ipv4: false,
        url: false,
        filePath: false,
        personName: false,
        customTerms: true,
        customRegex: false
      },
      customTerms: '',
      customRegex: '',
      responseGuardEnabled: true,
      responseGuardMarker: '[[END_PRIVACY_SAFE_RESPONSE]]',
      responseGuardAction: 'trim'
    },
    shellAudit: {
      enabled: false,
      profileId: '__current',
      model: '',
      prompt: [
        '你是本地 Shell 命令安全审核员。你只能根据用户当前轮消息和待执行的 Shell 命令做判断，不要假设你看过完整上下文。',
        '目标：判断该命令是否是完成当前用户请求所必要，以及是否存在读取无关文件、窃取密钥/Token/Cookie/私钥、破坏文件、绕过权限、联网外传、安装或执行不明代码等风险。',
        '工作区根目录是用户允许当前任务访问的主要范围。如果命令尝试读取、枚举、写入或删除工作区外的本地文件，除非用户当前消息明确要求，否则必须拦截。',
        '如果命令只读取或修改与用户当前请求直接相关的工作区文件，且没有明显外传或破坏风险，可以放行。',
        '如果命令访问用户未要求的敏感路径或凭证文件、枚举大量无关文件、上传/发送数据到外部、执行远程脚本、删除/覆盖大范围文件、提升权限、修改系统设置，必须拦截。',
        '只输出严格 JSON，不要输出 Markdown，不要解释 JSON 外的内容。格式：{"allow":true|false,"risk":"low|medium|high","necessary":true|false,"reason":"一句话理由","concerns":["风险点1"]}'
      ].join('\n')
    },
    mcpSkill: {
      mcpServers: [],
      skillRoots: ['skill'],
      skills: [],
      useSkills: true
    },
    projectMemory: {
      enabled: false,
      path: '.agent/memory.md',
      maxChars: 12000,
      declinedWorkspaces: []
    },
    projectInstructions: {
      enabled: true,
      path: 'AGENTS.md',
      maxChars: 16000,
      autoCreate: false
    },
    musicPlayer: {
      volume: 70,
      muted: false,
      loopMode: 'list',
      shuffle: false,
      autoplayNext: true,
      playbackRate: 1,
      rememberPosition: true,
      completionSoundMode: 'default',
      completionTrackPath: '',
      generationBgmEnabled: false,
      generationBgmTrackPath: '',
      generationBgmVolume: 35,
      generationBgmLoop: true,
      listCollapsed: false,
      lastSource: '',
      lastPath: '',
      lastTime: 0
    },
    dialogManager: {
      timelineEnabled: true,
      folders: [],
      prompts: []
    },
    remoteControl: {
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
    }
  },
  pendingAttachments: [],
  abortCtrl: null,
  activeTaskChatId: null,
  isGenerating: false,
  chatTasks: {},
  editingToolIdx: -1
};

let pendingImportData = null;

// ============ 自动重试设置工具 ============
const RETRY_UNLIMITED = -1;
const RETRY_POLICY_VERSION = 2;
const RETRY_UI_INFINITY_VALUE = 9;
const RETRY_FIXED_DELAY_AFTER_FAILURES = 5;
const RETRY_FIXED_DELAY_MS = 2000;

function normalizeRetryMaxAttempts(value, fallback = RETRY_UNLIMITED) {
  const n = parseInt(value, 10);
  if (n === RETRY_UNLIMITED) return RETRY_UNLIMITED;
  if (isNaN(n)) return fallback;
  return Math.max(0, n);
}

function retryMaxAttemptsToTotalAttempts(value) {
  const maxRetries = normalizeRetryMaxAttempts(value);
  return maxRetries === RETRY_UNLIMITED ? Infinity : Math.max(1, maxRetries + 1);
}

function retryTotalAttemptsLabel(totalAttempts) {
  return Number.isFinite(totalAttempts) ? String(totalAttempts) : '∞';
}

function retrySettingToSliderValue(value) {
  const maxRetries = normalizeRetryMaxAttempts(value);
  if (maxRetries === RETRY_UNLIMITED || maxRetries >= RETRY_UI_INFINITY_VALUE) return RETRY_UI_INFINITY_VALUE;
  return Math.max(0, maxRetries);
}

function retrySliderValueToSetting(value) {
  const n = parseInt(value, 10);
  if (isNaN(n)) return RETRY_UNLIMITED;
  return n >= RETRY_UI_INFINITY_VALUE ? RETRY_UNLIMITED : Math.max(0, n);
}

function retrySliderDisplay(value) {
  const n = parseInt(value, 10);
  return !isNaN(n) && n >= RETRY_UI_INFINITY_VALUE ? '∞' : String(Math.max(0, isNaN(n) ? 0 : n));
}

function setRetryMaxAttemptsLabel(value) {
  const el = document.getElementById('retryMaxAttemptsVal');
  if (el) el.textContent = retrySliderDisplay(value);
}

function migrateRetrySettings() {
  if (!state.settings || state.settings.retryPolicyVersion === RETRY_POLICY_VERSION) return;
  state.settings.retryMaxAttempts = RETRY_UNLIMITED;
  state.settings.retryPolicyVersion = RETRY_POLICY_VERSION;
}

function loadData() {
  try {
    const d = storage.get(STORAGE_KEYS.store);
    if (d) {
      const p = JSON.parse(d);
      state.chats = p.chats || [];
      state.temporaryChat = normalizeTemporaryChat(p.temporaryChat || null);
      state.currentId = p.currentId;
      if (state.temporaryChat && state.currentId !== state.temporaryChat.id) {
        state.temporaryChat = null;
      }
      if (isTemporaryChatId(state.currentId) && (!state.temporaryChat || state.temporaryChat.id !== state.currentId)) {
        state.currentId = null;
      }
      state._lastSavedAt = p.savedAt || null;
    }
  } catch (e) {}
  try { const s = storage.get(STORAGE_KEYS.settings); if (s) state.settings = { ...state.settings, ...JSON.parse(s) }; } catch (e) {}
  migrateRetrySettings();
  try { const t = storage.get(STORAGE_KEYS.tools); if (t) state.tools = JSON.parse(t); } catch (e) {}
  injectBuiltinTools();
}

const MSG_TIMER_ORPHAN_FALLBACK_MS = 10 * 60 * 1000;
let _msgTimerExitRecoveryRegistered = false;

function _timerMs(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function markMsgTimerActivity(msg, at = Date.now()) {
  if (!msg || msg.role === 'user') return;
  msg._lastActivityAt = at;
}

function pauseMsgTimer(msg, endAt = Date.now()) {
  if (!msg || msg.role === 'user') return false;
  const start = _timerMs(msg._startTime);
  if (!start || msg._endTime) return false;
  const safeEnd = Math.max(start, _timerMs(endAt) || Date.now());
  msg._endTime = safeEnd;
  msg._lastActivityAt = safeEnd;
  return true;
}

function resumeMsgTimer(msg) {
  if (!msg || msg.role === 'user') return;
  const now = Date.now();
  const start = _timerMs(msg._startTime) || now;
  const end = _timerMs(msg._endTime);
  if (end) {
    const elapsed = Math.max(0, end - start);
    const firstOffset = msg._firstTokenAt ? Math.max(0, _timerMs(msg._firstTokenAt) - start) : 0;
    msg._startTime = now - elapsed;
    if (msg._firstTokenAt) msg._firstTokenAt = Math.min(now, msg._startTime + firstOffset);
    delete msg._endTime;
  } else if (!msg._startTime) {
    msg._startTime = now;
  }
  msg._lastActivityAt = now;
}

function _fallbackTimerEndForRestore(msg, now) {
  const start = _timerMs(msg && msg._startTime);
  if (!start) return now;
  const savedAt = _timerMs(state._lastSavedAt);
  const candidates = [
    _timerMs(msg._lastActivityAt),
    savedAt && savedAt >= start ? savedAt : 0,
    _timerMs(msg._firstTokenAt)
  ].filter(t => t && t >= start && t <= now);
  if (candidates.length) return Math.max(...candidates);
  return Math.min(now, start + MSG_TIMER_ORPHAN_FALLBACK_MS);
}

function _cleanupRecoveredMessageProgress(msg) {
  if (!msg || msg.role !== 'assistant') return;
  let changed = false;
  if (msg.plan && msg.plan.inProgress) {
    msg.plan.inProgress = false;
    changed = true;
    if (['planning', 'reviewing', 'executing', 'verifying'].includes(msg.plan.stage)) {
      msg.plan.status = msg.plan.status === 'completed' ? msg.plan.status : 'paused';
    }
    if (Array.isArray(msg.plan.steps)) {
      msg.plan.steps.forEach(step => {
        if (step && step.status === 'running') {
          step.status = 'failed';
          step.error = step.error || '页面关闭，任务已中断';
          step.endedAt = step.endedAt || msg._endTime || Date.now();
        }
      });
    }
    delete msg.plan.progressText;
  }
  if (msg.outline && msg.outline.inProgress) {
    msg.outline.inProgress = false;
    changed = true;
    if (msg.outline.status === 'running') msg.outline.status = 'paused';
    delete msg.outline.progressText;
  }
  if (msg.reflection && msg.reflection.inProgress) {
    msg.reflection.inProgress = false;
    changed = true;
    if (Array.isArray(msg.reflection.turns)) {
      msg.reflection.turns.forEach(turn => {
        if (turn) turn._running = false;
        if (turn && Array.isArray(turn.toolCalls)) {
          turn.toolCalls.forEach(tc => { if (tc) tc._running = false; });
        }
      });
    }
    delete msg.reflection.progressText;
  }
  return changed;
}

function recoverInterruptedMsgTimers() {
  const now = Date.now();
  let changed = false;
  for (const chat of [...(state.chats || []), state.temporaryChat].filter(Boolean)) {
    for (const msg of chat.messages || []) {
      if (!msg || msg.role !== 'assistant') continue;
      if (msg._startTime && !msg._endTime) {
        pauseMsgTimer(msg, _fallbackTimerEndForRestore(msg, now));
        msg._timerRecovered = true;
        changed = true;
      }
      if (_cleanupRecoveredMessageProgress(msg)) changed = true;
    }
  }
  return changed;
}

function sealOpenMsgTimersForPageExit() {
  let changed = false;
  for (const chat of [...(state.chats || []), state.temporaryChat].filter(Boolean)) {
    for (const msg of chat.messages || []) {
      if (pauseMsgTimer(msg, Date.now())) changed = true;
      if (_cleanupRecoveredMessageProgress(msg)) changed = true;
    }
  }
  if (changed && typeof saveData === 'function') {
    saveData();
    if (typeof storage !== 'undefined' && typeof storage.flush === 'function') {
      try { storage.flush(); } catch (e) {}
    }
  }
}

function registerMsgTimerExitRecovery() {
  if (_msgTimerExitRecoveryRegistered || typeof window === 'undefined') return;
  _msgTimerExitRecoveryRegistered = true;
  window.addEventListener('pagehide', event => {
    if (event && event.persisted) return;
    sealOpenMsgTimersForPageExit();
  });
  window.addEventListener('beforeunload', sealOpenMsgTimersForPageExit);
}

function injectBuiltinTools() {
  if (!Array.isArray(STATE_BUILTIN_TOOLS)) return;
  let loadedSignatures = [];
  try {
    const raw = storage.get(STORAGE_KEYS.builtinToolsLoaded);
    if (raw) loadedSignatures = JSON.parse(raw);
  } catch (e) {}
  const DEPRECATED_BUILTIN_TOOL_NAMES = new Set([
    'wechat_filehelper_read',
    'wechat_filehelper_poll',
    'wechat_filehelper_send'
  ]);
  const beforeDeprecated = state.tools.length;
  state.tools = state.tools.filter(tool =>
    !DEPRECATED_BUILTIN_TOOL_NAMES.has(String((tool && tool.name) || ''))
  );
  const removedDeprecated = beforeDeprecated - state.tools.length;

  const existingNames = new Set(state.tools.map(t => t.name));
  const currentSignatures = STATE_BUILTIN_TOOLS.map(t => t.name);
  const builtinByName = new Map(STATE_BUILTIN_TOOLS.map(t => [t.name, t]));
  
  // ⭐ 可选工具组：首次安装默认不注入（用户在工具面板手动一键启用）
  // 既减少给模型的工具数量，也降低对外暴露的工具特征
  const OPTIONAL_TOOL_PREFIXES = ['lms_'];
  const OPTIONAL_TOOL_NAMES = new Set([
    // 💾 Git 快照工具（5 个）
    'note_status', 'note_history', 'note_diff', 'note_snapshot', 'note_restore',
    'restore_checkpoint',
    // 📊 PPT 工具（仅由顶栏 PPT 模式临时启用）
    'generate_ppt',
    // 📚 论文工具（6 个）
    'arxiv_search', 'semantic_scholar_search', 'dblp_search', 'openalex_search', 'crossref_search', 'fetch_pdf_text'
  ]);
  const isOptional = (name) => 
    OPTIONAL_TOOL_NAMES.has(name) || OPTIONAL_TOOL_PREFIXES.some(p => name.startsWith(p));
  const hasEnabledOptionalPrefix = (prefix) =>
    state.tools.some(t => String((t && t.name) || '').startsWith(prefix));

  let refreshed = 0;

  state.tools = state.tools.map(tool => {
    if (!tool || (
      !OPTIONAL_TOOL_PREFIXES.some(p => String(tool.name || '').startsWith(p))
    )) return tool;
    const builtin = builtinByName.get(tool.name);
    if (!builtin) return tool;
    const next = JSON.parse(JSON.stringify(builtin));
    if (JSON.stringify(tool) !== JSON.stringify(next)) refreshed++;
    return next;
  });
  
  let added = 0;
  for (const tool of STATE_BUILTIN_TOOLS) {
    if (!existingNames.has(tool.name)) {
      if (!loadedSignatures.includes(tool.name)) {
        // 可选工具组：首次见到时跳过自动注入
        if (isOptional(tool.name)) {
          const enabledOptionalPrefix = OPTIONAL_TOOL_PREFIXES.some(prefix =>
            tool.name.startsWith(prefix) && hasEnabledOptionalPrefix(prefix)
          );
          if (!enabledOptionalPrefix) continue;
        }
        state.tools.push(JSON.parse(JSON.stringify(tool)));
        existingNames.add(tool.name);
        added++;
      }
    }
  }
  if (added > 0 || refreshed > 0 || removedDeprecated > 0) {
    persistTools();
    if (removedDeprecated > 0) console.log(`[builtin tools] removed ${removedDeprecated} deprecated WeChat tool(s)`);
    if (added > 0) console.log(`[内置工具] 自动加载了 ${added} 个工具`);
    if (refreshed > 0) console.log(`[内置工具] 刷新了 ${refreshed} 个 LMS 工具`);
  }
  storage.set(STORAGE_KEYS.builtinToolsLoaded, JSON.stringify(currentSignatures));
}

function sanitizeMessageAttachmentsForSave(msg) {
  if (!msg || !msg.attachments || msg.attachments.length === 0) return msg;

  const cleanAttachments = msg.attachments.map(att => {
    if (att.text && !att.data) return att;
    const dataSize = att.data ? att.data.length : 0;
    if (dataSize < 5 * 1024 * 1024) return att;
    return {
      id: att.id,
      name: att.name,
      mime: att.mime,
      size: att.size,
      type: att.type,
      _fromAI: att._fromAI,
      _hidden: att._hidden,
      _aiDescription: att._aiDescription,
      _stripped: true,
      _strippedReason: `附件超大（${(dataSize / 1024 / 1024).toFixed(1)}MB），刷新后将丢失。要保留请重新加载。`
    };
  });

  return { ...msg, attachments: cleanAttachments };
}

function sanitizeMessagesForSave(messages) {
  return (Array.isArray(messages) ? messages : []).map(msg => sanitizeMessageAttachmentsForSave(msg));
}

function sanitizeConcurrentForSave(concurrent) {
  if (!concurrent || typeof concurrent !== 'object') return concurrent;
  return {
    ...concurrent,
    agents: Array.isArray(concurrent.agents)
      ? concurrent.agents.map(agent => ({
          ...agent,
          messages: sanitizeMessagesForSave(agent && agent.messages)
        }))
      : concurrent.agents
  };
}

// ⭐ 完整修复版 saveData：迁移 IndexedDB 后基本不会再爆容量，
//     仍保留剥离 + quota 兜底逻辑，以防极端情况下 IDB 配额也满
//
// 【quota 兜底链路】因为 IDB 写入是异步的，QuotaExceededError 不会在 storage.set
// 当场抛出。所以我们在 idb-store.js 注册了 onQuotaError 回调，由它在异步落盘失败
// 时反向触发 handleStorageQuotaExceeded()。这样旧逻辑（清请求历史 → 删旧对话
// → 剥附件 → 放弃保存）保持有效。
function sanitizeChatForSave(chat) {
  if (!chat || typeof chat !== 'object') return chat;
  return {
    ...chat,
    messages: sanitizeMessagesForSave(chat.messages),
    concurrent: sanitizeConcurrentForSave(chat.concurrent)
  };
}

function activeTemporaryChatForSave() {
  return state.temporaryChat && state.currentId === state.temporaryChat.id ? state.temporaryChat : null;
}

function saveData() {
  try {
    // 深拷贝并剥离大附件的 data 字段
    const chatsForSave = state.chats.map(chat => sanitizeChatForSave(chat));
    const temporaryChatForSave = activeTemporaryChatForSave() ? sanitizeChatForSave(state.temporaryChat) : null;
    
    const savedAt = Date.now();
    state._lastSavedAt = savedAt;
    const payload = JSON.stringify({ chats: chatsForSave, temporaryChat: temporaryChatForSave, currentId: state.currentId, savedAt });
    
    try {
      storage.set(STORAGE_KEYS.store, payload);
      // ⭐ 注：storage.set 是同步写内存 + 异步落盘，这里不会抛 quota 错误。
      //    真正的配额错误在 idb-store 的 flushNow 中捕获，并通过
      //    storage.onQuotaError 回调反向调用 handleStorageQuotaExceeded()。
    } catch (storageErr) {
      // 极端：IDB 未就绪走 localStorage 回退路径才可能在此同步抛错
      console.warn('[saveData] 存储仍超限，开始紧急清理:', storageErr.message);
      handleStorageQuotaExceeded();
    }
  } catch (e) {
    console.error('[saveData] 严重错误:', e);
    stateToast('⚠️ 保存失败：' + e.message, 5000);
  }
}

// ⭐ 注册 IDB 异步配额错误回调（在模块加载即注册一次）
//   注意：storage 对象在 idb-store.js 中已经创建，但 idbInit 可能还没跑完。
//   这里同步注册即可，回调只在真正发生 quota 错误时被调用。
if (typeof storage !== 'undefined' && typeof storage.onQuotaError === 'function') {
  storage.onQuotaError(() => {
    try {
      console.warn('[state] IDB 配额超限回调被触发，执行 handleStorageQuotaExceeded');
      handleStorageQuotaExceeded();
    } catch (e) {
      console.error('[state] quota 回调执行失败:', e);
    }
  });
}

// ⭐ 处理存储超限的多级回退（IndexedDB 配额极端满时才会触发）
function handleStorageQuotaExceeded() {
  // 策略 1：清理 request_history（请求历史一般不重要）
  try {
    storage.remove('aichat_request_history_v1');
    console.log('[紧急清理] 已删除请求历史');
  } catch (e) {}
  
  // 策略 2：删除旧对话（保留最新 10 个）
  if (state.chats.length > 10) {
    const oldCount = state.chats.length;
    state.chats = state.chats.slice(0, 10);
    console.log(`[紧急清理] 删除 ${oldCount - 10} 个旧对话`);
    
    try {
      const payload = serializeChatsWithStrippedAttachments();
      storage.set(STORAGE_KEYS.store, payload);
      stateToast(`⚠️ 存储已满，已自动删除 ${oldCount - 10} 个旧对话`, 5000);
      return;
    } catch (e) {
      console.warn('[紧急清理] 删除旧对话后仍超限');
    }
  }
  
  // 策略 3：清空当前对话的所有附件元数据
  console.log('[紧急清理] 移除所有附件元数据');
  const stripAttachmentMeta = msg => {
    if (!msg || !msg.attachments) return;
    msg.attachments = msg.attachments.map(a => ({
      id: a.id,
      name: a.name,
      mime: a.mime,
      size: a.size,
      type: a.type,
      _stripped: true,
      _strippedReason: '存储空间不足，附件已被自动清理'
    }));
  };
  for (const chat of [...state.chats, state.temporaryChat].filter(Boolean)) {
    for (const msg of chat.messages) {
      stripAttachmentMeta(msg);
    }
    const agents = chat.concurrent && Array.isArray(chat.concurrent.agents) ? chat.concurrent.agents : [];
    for (const agent of agents) {
      for (const msg of (agent && Array.isArray(agent.messages) ? agent.messages : [])) {
        stripAttachmentMeta(msg);
      }
    }
  }
  
  try {
    const payload = JSON.stringify({
      chats: state.chats.map(chat => sanitizeChatForSave(chat)),
      temporaryChat: activeTemporaryChatForSave() ? sanitizeChatForSave(state.temporaryChat) : null,
      currentId: state.currentId
    });
    storage.set(STORAGE_KEYS.store, payload);
    stateToast('⚠️ 存储空间不足，已清理所有附件', 5000);
  } catch (e) {
    // 策略 4：放弃保存对话历史，但保证设置不丢
    console.error('[紧急清理] 完全无法保存对话:', e);
    stateToast('❌ 存储已满，本次对话无法保存。建议清空旧对话。', 8000);
  }
}

// 辅助：序列化对话（带附件剥离）
function serializeChatsWithStrippedAttachments() {
  const chatsForSave = state.chats.map(chat => sanitizeChatForSave(chat));
  const temporaryChatForSave = activeTemporaryChatForSave() ? sanitizeChatForSave(state.temporaryChat) : null;
  return JSON.stringify({ chats: chatsForSave, temporaryChat: temporaryChatForSave, currentId: state.currentId });
}

function persistSettings() {
  try {
    storage.set(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  } catch (e) {
    console.warn('[persistSettings] 失败:', e.message);
  }
}

function persistTools() {
  try {
    storage.set(STORAGE_KEYS.tools, JSON.stringify(state.tools));
  } catch (e) {
    console.warn('[persistTools] 失败:', e.message);
  }
}

const TEMPORARY_CHAT_PREFIX = 'tmp_';

function isTemporaryChatId(id) {
  return typeof id === 'string' && id.startsWith(TEMPORARY_CHAT_PREFIX);
}

function normalizeTemporaryChat(chat) {
  if (!chat || typeof chat !== 'object') return null;
  const id = chat.id && isTemporaryChatId(chat.id) ? chat.id : TEMPORARY_CHAT_PREFIX + Date.now();
  return {
    ...chat,
    id,
    title: chat.title || '临时会话',
    messages: Array.isArray(chat.messages) ? chat.messages : [],
    createdAt: chat.createdAt || Date.now(),
    temporary: true
  };
}

function createTemporaryChat() {
  return normalizeTemporaryChat({
    id: TEMPORARY_CHAT_PREFIX + Date.now(),
    title: '临时会话',
    messages: [],
    createdAt: Date.now(),
    temporary: true
  });
}

function isTemporaryChat(chatOrId) {
  const id = typeof chatOrId === 'string' ? chatOrId : (chatOrId && chatOrId.id);
  return !!(id && state.temporaryChat && state.temporaryChat.id === id);
}

function discardTemporaryChat(options = {}) {
  const temp = state.temporaryChat;
  if (!temp) return false;
  const tempId = temp.id;
  const wasCurrent = state.currentId === tempId;
  if (options.abort !== false) {
    try {
      if (typeof _abortCurrentTaskIfAny === 'function') _abortCurrentTaskIfAny(tempId);
      else if (typeof requestStopChatTask === 'function') requestStopChatTask(tempId);
    } catch (e) {}
  }
  if (typeof clearChatTask === 'function') {
    try { clearChatTask(tempId); } catch (e) {}
  }
  if (state.pendingAIAttachmentsByChat && state.pendingAIAttachmentsByChat[tempId]) {
    delete state.pendingAIAttachmentsByChat[tempId];
  }
  if (wasCurrent) state.currentId = options.nextCurrentId || null;
  state.temporaryChat = null;
  if (typeof updateTemporaryChatButton === 'function') updateTemporaryChatButton();
  return true;
}

function chatById(id) {
  if (!id) return null;
  if (state.temporaryChat && state.temporaryChat.id === id) return state.temporaryChat;
  return state.chats.find(c => c && c.id === id);
}

function currentChat() { return chatById(state.currentId); }

function isCurrentChat(chatOrId) {
  const id = typeof chatOrId === 'string' ? chatOrId : (chatOrId && chatOrId.id);
  return !!id && id === state.currentId;
}

function ensureChatTasks() {
  if (!state.chatTasks || typeof state.chatTasks !== 'object') state.chatTasks = {};
  return state.chatTasks;
}

function chatTaskById(chatId) {
  if (!chatId) return null;
  return ensureChatTasks()[chatId] || null;
}

function isChatGenerating(chatOrId) {
  const id = typeof chatOrId === 'string' ? chatOrId : (chatOrId && chatOrId.id);
  if (typeof isConcurrentChatRunning === 'function' && isConcurrentChatRunning(id)) return true;
  // ⭐ 辩论模式：检查是否正在运行
  if (id && typeof isDebatePausable === 'function' && isDebatePausable(id)) return true;
  const task = chatTaskById(id);
  return !!(task && task.isGenerating);
}

function isCurrentChatGenerating() {
  return isChatGenerating(state.currentId);
}

function isAnyChatGenerating() {
  return Object.values(ensureChatTasks()).some(t => t && t.isGenerating)
    || (typeof isAnyConcurrentChatRunning === 'function' && isAnyConcurrentChatRunning())
    || (typeof isAnyDebatePausable === 'function' && isAnyDebatePausable());
}

function beginChatTask(chatId, abortCtrl, opts = {}) {
  if (!chatId) return null;
  const tasks = ensureChatTasks();
  const existing = tasks[chatId] || {};
  const task = {
    chatId,
    isGenerating: true,
    abortCtrl: abortCtrl || existing.abortCtrl || null,
    stopRequested: opts.resetStop ? false : !!existing.stopRequested,
    pendingGuidance: existing.pendingGuidance || null,
    guidanceRequested: !!existing.guidanceRequested,
    startedAt: existing.startedAt || Date.now()
  };
  tasks[chatId] = task;
  syncGlobalTaskState(chatId);
  updateGenerationBgmForTasks();
  return task;
}

function updateChatTaskController(chatId, abortCtrl) {
  if (!chatId) return null;
  const tasks = ensureChatTasks();
  const task = tasks[chatId] || beginChatTask(chatId, null);
  if (!task) return null;
  task.isGenerating = true;
  task.abortCtrl = abortCtrl || null;
  tasks[chatId] = task;
  syncGlobalTaskState(chatId);
  updateGenerationBgmForTasks();
  return task;
}

function requestStopChatTask(chatId) {
  const task = chatTaskById(chatId);
  if (!task) return false;
  task.stopRequested = true;
  if (task.abortCtrl) {
    try { task.abortCtrl.abort(); } catch (e) {}
  }
  syncGlobalTaskState(chatId);
  return true;
}

function setChatTaskGuidance(chatId, message) {
  if (!chatId || !message) return null;
  const tasks = ensureChatTasks();
  const task = tasks[chatId] || beginChatTask(chatId, null);
  if (!task) return null;
  task.pendingGuidance = message;
  task.guidanceRequested = true;
  syncGlobalTaskState(chatId);
  return task;
}

function chatTaskHasGuidance(chatId) {
  const task = chatTaskById(chatId);
  return !!(task && task.pendingGuidance);
}

function takeChatTaskGuidance(chatId) {
  const task = chatTaskById(chatId);
  if (!task || !task.pendingGuidance) return null;
  const guidance = task.pendingGuidance;
  task.pendingGuidance = null;
  task.guidanceRequested = false;
  syncGlobalTaskState(chatId);
  return guidance;
}

function clearChatTask(chatId) {
  if (!chatId) return;
  const tasks = ensureChatTasks();
  delete tasks[chatId];
  syncGlobalTaskState();
  updateGenerationBgmForTasks();
}

function updateGenerationBgmForTasks() {
  const running = typeof isAnyChatGenerating === 'function'
    ? isAnyChatGenerating()
    : Object.values(ensureChatTasks()).some(t => t && t.isGenerating);
  if (running) {
    if (typeof startMusicGenerationBgm === 'function') startMusicGenerationBgm();
  } else if (typeof stopMusicGenerationBgm === 'function') {
    stopMusicGenerationBgm();
  }
}

function setChatTaskMode(chatId, mode, props = {}) {
  const task = chatTaskById(chatId);
  if (!task) return null;
  task.mode = mode || task.mode || 'chat';
  Object.assign(task, props);
  syncGlobalTaskState(chatId);
  refreshLegacyModeFlags();
  return task;
}

function isChatTaskMode(chatId, mode) {
  const task = chatTaskById(chatId);
  return !!(task && task.isGenerating && task.mode === mode);
}

function isAnyChatTaskMode(mode) {
  return Object.values(ensureChatTasks()).some(t => t && t.isGenerating && t.mode === mode);
}

function refreshLegacyModeFlags() {
  state._outlineExecuting = isAnyChatTaskMode('outline');
  state._planExecuting = isAnyChatTaskMode('plan');
  state._outlineForceFinish = Object.values(ensureChatTasks()).some(t => t && t.isGenerating && t.mode === 'outline' && t.outlineForceFinish);
}

function syncGlobalTaskState(preferredChatId) {
  const tasks = ensureChatTasks();
  const currentTask = tasks[state.currentId] || null;
  const preferredTask = preferredChatId ? (tasks[preferredChatId] || null) : null;
  const fallbackTask = preferredTask || currentTask || Object.values(tasks).find(t => t && t.isGenerating) || null;

  // 兼容旧模块：全局字段镜像当前对话任务；当前对话空闲时镜像任意后台任务。
  const mirrorTask = currentTask || fallbackTask;
  state.isGenerating = !!(currentTask && currentTask.isGenerating);
  state.activeTaskChatId = mirrorTask ? mirrorTask.chatId : null;
  // Only the current chat owns the legacy global abort/stop mirrors.
  // Background tasks remain addressable by chatTasks/activeTaskChatId.
  state.abortCtrl = currentTask ? currentTask.abortCtrl : null;
  state.stopRequested = currentTask ? !!currentTask.stopRequested : false;
  refreshLegacyModeFlags();
}

function activeTaskChat() {
  return (state.activeTaskChatId && chatById(state.activeTaskChatId)) || currentChat();
}

function resetBuiltinTools() {
  if (!confirm('重新加载所有内置工具？\n已有同名工具不会被覆盖，已被删除的内置工具会被重新加回。\n\n注意：LMS、版本快照、论文工具不会自动加回，需要在工具面板里点专用按钮启用。')) return;
  storage.remove(STORAGE_KEYS.builtinToolsLoaded);
  // ⭐ 与 injectBuiltinTools 保持一致：可选工具组（LMS / Git 快照 / 论文）不自动恢复
  const OPTIONAL_TOOL_NAMES = new Set([
    'note_status', 'note_history', 'note_diff', 'note_snapshot', 'note_restore',
    'restore_checkpoint',
    'generate_ppt',
    'arxiv_search', 'semantic_scholar_search', 'dblp_search', 'openalex_search', 'crossref_search', 'fetch_pdf_text'
  ]);
  const isOptional = (name) => 
    OPTIONAL_TOOL_NAMES.has(name) || name.startsWith('lms_');
  
  for (const tool of STATE_BUILTIN_TOOLS) {
    if (isOptional(tool.name)) continue;
    if (!state.tools.some(t => t.name === tool.name)) {
      state.tools.push(JSON.parse(JSON.stringify(tool)));
    }
  }
  persistTools();
  storage.set(STORAGE_KEYS.builtinToolsLoaded, JSON.stringify(STATE_BUILTIN_TOOLS.map(t => t.name)));
  if (typeof renderToolList === 'function') renderToolList();
  stateToast('✓ 内置工具已重置');
}

// ⭐ 工具：手动清理大附件（控制台可调用）
function cleanupStorage() {
  if (!confirm('清理对话历史中的所有大附件？\n（文字保留，附件 data 会被清空）')) return;
  
  let cleared = 0;
  let savedMB = 0;
  for (const chat of [...state.chats, state.temporaryChat].filter(Boolean)) {
    for (const msg of chat.messages) {
      if (msg.attachments) {
        msg.attachments.forEach(att => {
          if (att.data && att.data.length > 100 * 1024) {
            savedMB += att.data.length / 1024 / 1024;
            att._stripped = true;
            att._strippedReason = '已被手动清理';
            delete att.data;
            delete att.text;
            cleared++;
          }
        });
      }
    }
  }
  
  saveData();
  stateToast(`✓ 已清理 ${cleared} 个附件，释放 ${savedMB.toFixed(1)} MB`, 4000);
  console.log(`[清理] 共清理 ${cleared} 个附件，约 ${savedMB.toFixed(1)} MB`);
}

// 暴露到全局
window.cleanupStorage = cleanupStorage;

if (typeof window !== 'undefined' && window.AgentApp) {
  window.AgentApp.define('state', {
    get state() { return state; },
    get pendingImportData() { return pendingImportData; },
    set pendingImportData(value) { pendingImportData = value; },
    loadData,
    saveData,
    persistSettings,
    persistTools,
    currentChat,
    chatById,
    isCurrentChat,
    createTemporaryChat,
    isTemporaryChat,
    discardTemporaryChat,
    ensureChatTasks,
    chatTaskById,
    isChatGenerating,
    isCurrentChatGenerating,
    isAnyChatGenerating,
    beginChatTask,
    updateChatTaskController,
    requestStopChatTask,
    setChatTaskGuidance,
    chatTaskHasGuidance,
    takeChatTaskGuidance,
    clearChatTask,
    setChatTaskMode,
    isChatTaskMode,
    isAnyChatTaskMode,
    syncGlobalTaskState,
    activeTaskChat,
    cleanupStorage
  });
}
