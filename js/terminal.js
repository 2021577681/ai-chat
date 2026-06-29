// ============ 本地 Agent 工具集 ============
const TERMINAL_PERMS_KEY = 'aichat_terminal_perms_v1';

// ⭐ 操作类别定义（共 9 类需弹窗的操作）
const PERMISSION_CATEGORIES = {
  execute: { icon: '🖥️',  label: '执行命令',       desc: 'execute_action：在终端执行任意 shell 指令' },
  write:   { icon: '✍️',  label: '写入/覆盖文档', desc: 'save_note：创建或完全覆盖文档' },
  append:  { icon: '📝',  label: '追加内容',       desc: 'append_note：向已存在文档末尾追加' },
  edit:    { icon: '✏️',  label: '修改文档',       desc: 'edit_note：查找替换' },
  delete:  { icon: '🗑️',  label: '删除文档/目录', desc: 'delete_note：删除文件或空目录' },
  attach:  { icon: '📎',  label: '加载附件',       desc: 'attach_file：把二进制文件塞入对话上下文' },
  screenshot: { icon: '📸', label: '屏幕截图',       desc: 'ai_screenshot：截取指定窗口/全屏/区域，可能包含屏幕隐私信息' },
  mcp: { icon: '🔌', label: 'MCP 服务器', desc: '连接或调用本地 MCP stdio 服务器。服务器代码可能访问文件、网络或外部服务。' },
  // ⭐ AI Git 操作（3 个独立类别，权限粒度分级）
  git_read:    { icon: '🔍',  label: 'Git 查看',     desc: 'note_history / note_status / note_diff：只读查看版本历史' },
  git_write:   { icon: '💾',  label: 'Git 保存快照', desc: 'note_snapshot：将当前工作区改动提交为一个版本快照（不会覆盖文件）' },
  git_restore: { icon: '⏪',  label: 'Git 恢复历史', desc: 'note_restore：将某个文件恢复到历史快照版本（⚠️ 会覆盖当前工作区文件）' },
  checkpoint_restore: { icon: '⏪', label: '恢复修改前快照', desc: 'restore_checkpoint：把文件恢复到 AI 修改前 checkpoint（会覆盖或删除当前文件）' }
};

// action → 类别 映射
const ACTION_TO_CATEGORY = {
  execute: 'execute',
  write_file: 'write',
  append_file: 'append',
  edit_file: 'edit',
  apply_patch: 'edit',
  delete_file: 'delete',
  restore_checkpoint: 'checkpoint_restore',
  read_file_binary: 'attach',
  screenshot: 'screenshot',
  list_windows: 'screenshot',
  mcp_list_tools: 'mcp',
  mcp_call_tool: 'mcp',
};

// 持久化的"永久允许"集合（{execute:true, ...}）
function loadPermanentPerms() {
  try {
    const raw = storage.get(TERMINAL_PERMS_KEY);
    if (raw) return JSON.parse(raw) || {};
  } catch (e) {}
  return {};
}
function savePermanentPerms(p) {
  try { storage.set(TERMINAL_PERMS_KEY, JSON.stringify(p || {})); }
  catch (e) { console.warn('[perm] 保存失败:', e); }
}

const TERMINAL_CONFIG = {
  serverUrl: 'http://localhost:8765',
  sessionId: 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
  // ⭐ 本次任务级允许（按类别），任务结束自动清空
  taskAllow: {},
  taskAllowByChat: {},
  // ⭐ 永久允许（按类别），存 localStorage，可在 UI 撤销
  permanentAllow: loadPermanentPerms(),
  autoAnalyzeAfterAttach: true
};

const AGENT_BACKEND_DEFAULT_TIMEOUT_MS = 75 * 1000;
const AGENT_BACKEND_TOKEN_TIMEOUT_MS = 15 * 1000;
const AGENT_BACKEND_EXECUTE_GRACE_MS = 15 * 1000;

function agentBackendRequestTimeoutMs(action, params) {
  const explicit = params && Number(params.requestTimeoutMs || params._requestTimeoutMs);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1000, explicit);
  }
  if (action === 'execute') {
    const commandTimeoutSec = Math.max(1, parseInt(params && params.timeout, 10) || 60);
    return Math.min(315 * 1000, (commandTimeoutSec * 1000) + AGENT_BACKEND_EXECUTE_GRACE_MS);
  }
  if (action === 'generate_ppt') return 300 * 1000;
  if (action === 'web_search' || action === 'fetch_url') return 120 * 1000;
  if (action === 'read_file_binary' || action === 'screenshot' || action === 'list_windows') return 90 * 1000;
  return AGENT_BACKEND_DEFAULT_TIMEOUT_MS;
}

function makeAgentAbortError(message) {
  let err;
  try {
    err = new DOMException(message || 'aborted', 'AbortError');
  } catch (e) {
    err = new Error(message || 'aborted');
    err.name = 'AbortError';
  }
  return err;
}

function makeAgentBackendTimeoutError(timeoutMs) {
  const err = new Error(`工具请求超时（${Math.round(timeoutMs / 1000)}秒无响应）。本次工具调用已停止等待，请改用更小的命令、new_window，或标记为阻塞。`);
  err.name = 'AgentBackendTimeoutError';
  err.timeoutMs = timeoutMs;
  return err;
}

async function fetchAgentBackendWithTimeout(url, init, externalSignal, timeoutMs) {
  const finalTimeoutMs = Math.max(1000, parseInt(timeoutMs, 10) || AGENT_BACKEND_DEFAULT_TIMEOUT_MS);
  const ctrl = new AbortController();
  let timedOut = false;
  let settled = false;
  let externalAbortHandler = null;
  const timer = setTimeout(() => {
    timedOut = true;
    try { ctrl.abort(); } catch (e) {}
  }, finalTimeoutMs);

  const cleanup = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (externalSignal && externalAbortHandler) {
      try { externalSignal.removeEventListener('abort', externalAbortHandler); } catch (e) {}
    }
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      cleanup();
      throw makeAgentAbortError('aborted');
    }
    externalAbortHandler = () => {
      try { ctrl.abort(); } catch (e) {}
    };
    externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
  }

  try {
    return await fetch(url, { ...(init || {}), signal: ctrl.signal });
  } catch (e) {
    if (e && e.name === 'AbortError' && timedOut && !(externalSignal && externalSignal.aborted)) {
      throw makeAgentBackendTimeoutError(finalTimeoutMs);
    }
    throw e;
  } finally {
    cleanup();
  }
}

async function readAgentBackendJsonWithTimeout(resp, externalSignal, timeoutMs) {
  const finalTimeoutMs = Math.max(1000, parseInt(timeoutMs, 10) || 15000);
  let timer = null;
  let externalAbortHandler = null;
  try {
    return await Promise.race([
      resp.json(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(makeAgentBackendTimeoutError(finalTimeoutMs)), finalTimeoutMs);
        if (externalSignal) {
          if (externalSignal.aborted) {
            reject(makeAgentAbortError('aborted'));
            return;
          }
          externalAbortHandler = () => reject(makeAgentAbortError('aborted'));
          externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
        }
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal && externalAbortHandler) {
      try { externalSignal.removeEventListener('abort', externalAbortHandler); } catch (e) {}
    }
  }
}

// ⭐ 永久权限的增删
function setPermanentPermission(category, allow) {
  if (!PERMISSION_CATEGORIES[category]) return;
  if (allow) {
    TERMINAL_CONFIG.permanentAllow[category] = true;
  } else {
    delete TERMINAL_CONFIG.permanentAllow[category];
  }
  savePermanentPerms(TERMINAL_CONFIG.permanentAllow);
}
function clearAllPermanentPermissions() {
  TERMINAL_CONFIG.permanentAllow = {};
  savePermanentPerms({});
}
function clearTaskPermissions(chatId) {
  const id = chatId || (typeof state !== 'undefined' ? state.currentId : '');
  if (id && TERMINAL_CONFIG.taskAllowByChat) delete TERMINAL_CONFIG.taskAllowByChat[id];
  else TERMINAL_CONFIG.taskAllowByChat = {};
  TERMINAL_CONFIG.taskAllow = {};
}
window.setPermanentPermission = setPermanentPermission;
window.clearAllPermanentPermissions = clearAllPermanentPermissions;
window.PERMISSION_CATEGORIES = PERMISSION_CATEGORIES;

function resolveToolChatId(context) {
  if (typeof context === 'string') return context;
  if (context && context.chatId) return context.chatId;
  if (context && context.chat && context.chat.id) return context.chat.id;
  if (typeof window !== 'undefined' && window.__currentToolContext) {
    const ctx = window.__currentToolContext;
    if (ctx.chatId) return ctx.chatId;
    if (ctx.chat && ctx.chat.id) return ctx.chat.id;
  }
  return (state && (state.currentId || state.activeTaskChatId)) || '';
}

function getTaskAllowForChat(chatId) {
  const id = chatId || 'default';
  if (!TERMINAL_CONFIG.taskAllowByChat || typeof TERMINAL_CONFIG.taskAllowByChat !== 'object') {
    TERMINAL_CONFIG.taskAllowByChat = {};
  }
  if (!TERMINAL_CONFIG.taskAllowByChat[id]) TERMINAL_CONFIG.taskAllowByChat[id] = {};
  return TERMINAL_CONFIG.taskAllowByChat[id];
}

function getAgentSessionId(context) {
  const chatId = resolveToolChatId(context) || 'default';
  return `${TERMINAL_CONFIG.sessionId}:${chatId}`;
}

function ensurePendingAIAttachmentBuckets() {
  if (!state.pendingAIAttachmentsByChat || typeof state.pendingAIAttachmentsByChat !== 'object') {
    state.pendingAIAttachmentsByChat = {};
  }
  return state.pendingAIAttachmentsByChat;
}

function pendingAIAttachmentsForChat(chatId, create = true) {
  const id = chatId || resolveToolChatId() || 'default';
  const buckets = ensurePendingAIAttachmentBuckets();
  if (!buckets[id] && create) buckets[id] = [];
  return buckets[id] || [];
}

function pushPendingAIAttachment(chatId, attachment) {
  pendingAIAttachmentsForChat(chatId, true).push(attachment);
}

function takePendingAIAttachments(chatId) {
  const id = chatId || resolveToolChatId() || 'default';
  const buckets = ensurePendingAIAttachmentBuckets();
  const scoped = Array.isArray(buckets[id]) ? buckets[id].splice(0) : [];
  if (buckets[id] && buckets[id].length === 0) delete buckets[id];
  if (id === (state.currentId || '') && Array.isArray(state.pendingAIAttachments) && state.pendingAIAttachments.length) {
    const legacy = state.pendingAIAttachments.splice(0);
    return scoped.concat(legacy);
  }
  return scoped;
}

function clearPendingAIAttachments(chatId) {
  const buckets = ensurePendingAIAttachmentBuckets();
  if (chatId) {
    delete buckets[chatId];
    if (chatId === state.currentId) state.pendingAIAttachments = [];
  } else {
    state.pendingAIAttachmentsByChat = {};
    state.pendingAIAttachments = [];
  }
}

function cancelAutoResendForChat(chatId, clearAttachments = true) {
  const id = chatId || resolveToolChatId() || 'default';
  _autoResendCancelSeqByChat[id] = (_autoResendCancelSeqByChat[id] || 0) + 1;
  if (_autoResendTimersByChat[id]) {
    try { clearTimeout(_autoResendTimersByChat[id]); } catch (e) {}
    delete _autoResendTimersByChat[id];
  }
  delete _pendingAutoResendByChat[id];
  delete _autoResendInProgressByChat[id];
  if (clearAttachments) clearPendingAIAttachments(id);
}

// ⭐ Token 持久化辅助
let _termConfirmResolve = null;
let _currentConfirmCategory = '';
let _currentConfirmChatId = '';
let _termConfirmAbortSignal = null;
let _termConfirmAbortHandler = null;
let _pendingAutoResend = null;
let _pendingAutoResendByChat = {};
let _autoResendTimer = null;
let _autoResendTimersByChat = {};
let _autoResendInProgress = false;
let _autoResendInProgressByChat = {};
// ⭐ 自动重发取消版本号：每次取消/重置时递增。
// 已经进入 tryAutoResend 等待循环的旧任务醒来后会发现版本不一致并退出，
// 防止"暂停后下一次正常对话结束才冒出幽灵等待"。
let _autoResendCancelSeq = 0;
let _autoResendCancelSeqByChat = {};
const OUTLINE_PERMISSION_AUTO_ALLOW_MS = 3 * 60 * 1000;
let _termConfirmAutoAllowTimer = null;
let _termConfirmAutoAllowTick = null;

function isOutlinePermissionAutoAllowContext(context) {
  if (typeof state === 'undefined' || !state.settings || !state.settings.outlinePermissionAutoAllow) return false;
  const chatId = resolveToolChatId(context);
  const hasOutlineContext = !!(context && typeof context === 'object' && context.outline);
  const isOutlineTask = !!(chatId && typeof isChatTaskMode === 'function' && isChatTaskMode(chatId, 'outline'));
  return hasOutlineContext || isOutlineTask;
}

function formatAutoAllowRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function cleanupTermConfirmAutoAllowTimer() {
  if (_termConfirmAutoAllowTimer) clearTimeout(_termConfirmAutoAllowTimer);
  if (_termConfirmAutoAllowTick) clearInterval(_termConfirmAutoAllowTick);
  _termConfirmAutoAllowTimer = null;
  _termConfirmAutoAllowTick = null;
  const hint = document.getElementById('termConfirmAutoAllowHint');
  if (hint) {
    hint.style.display = 'none';
    hint.textContent = '';
  }
}

function startTermConfirmAutoAllowTimer(context) {
  cleanupTermConfirmAutoAllowTimer();
  if (!isOutlinePermissionAutoAllowContext(context)) return;
  const hint = document.getElementById('termConfirmAutoAllowHint');
  const deadline = Date.now() + OUTLINE_PERMISSION_AUTO_ALLOW_MS;
  const updateHint = () => {
    if (!hint) return;
    hint.style.display = 'block';
    hint.textContent = `大纲模式：${formatAutoAllowRemaining(deadline - Date.now())} 内未选择允许或阻止，将默认允许本次调用。`;
  };
  updateHint();
  _termConfirmAutoAllowTick = setInterval(updateHint, 1000);
  _termConfirmAutoAllowTimer = setTimeout(() => {
    _termConfirmAutoAllowTimer = null;
    if (!_termConfirmResolve) return;
    if (typeof toast === 'function') toast('大纲模式权限等待超时，已自动允许本次调用', 3500);
    termConfirmAccept({ autoAllowed: true });
  }, OUTLINE_PERMISSION_AUTO_ALLOW_MS);
}

function termAskConfirm(title, detail, command, category, context) {
  return new Promise(resolve => {
    if (_termConfirmAbortSignal && _termConfirmAbortHandler) {
      try { _termConfirmAbortSignal.removeEventListener('abort', _termConfirmAbortHandler); } catch (_) {}
    }
    cleanupTermConfirmAutoAllowTimer();
    _termConfirmAbortSignal = null;
    _termConfirmAbortHandler = null;
    _termConfirmResolve = resolve;
    _currentConfirmCategory = category || '';
    _currentConfirmChatId = resolveToolChatId(context);
    
    document.getElementById('termConfirmCmd').textContent = command;
    document.getElementById('termConfirmCwd').textContent = detail || '(默认目录)';
    const headerSpan = document.querySelector('.term-confirm-header span:last-child');
    if (headerSpan) headerSpan.textContent = title;
    document.getElementById('termAllowSession').checked = false;
    
    // ⭐ 动态显示类别名（弹窗里和"任务允许"按钮文字）
    const catInfo = PERMISSION_CATEGORIES[category];
    const catLabel = catInfo ? `${catInfo.icon} ${catInfo.label}` : '此类操作';
    const catLabelEl = document.getElementById('termConfirmCategoryLabel');
    if (catLabelEl) catLabelEl.textContent = catLabel;
    const taskBtnEl = document.getElementById('termAllowTaskBtn');
    if (taskBtnEl) taskBtnEl.textContent = `本任务后续允许「${catInfo ? catInfo.label : '此类'}」`;

    const danger = /\b(rm|del|format|shutdown|reboot|sudo|chmod\s+777|curl.*\|.*sh|delete)\b/i;
    const warnEl = document.getElementById('termConfirmWarn');
    const warnText = document.getElementById('termConfirmWarnText');
    if (danger.test(command)) {
      warnEl.style.display = 'flex';
      warnText.textContent = '⚠️ 此操作可能修改或删除文件，请仔细确认！';
    } else {
      warnEl.style.display = 'none';
    }

    document.getElementById('termConfirmMask').classList.add('show');
    startTermConfirmAutoAllowTimer(context);

    let secs = 3;
    const countEl = document.getElementById('termCountdown');
    const btn = document.getElementById('termAllowBtn');
    btn.disabled = true;
    btn.style.opacity = '0.5';
    countEl.textContent = `(${secs}s)`;
    const timer = setInterval(() => {
      secs--;
      if (secs <= 0) {
        clearInterval(timer);
        countEl.textContent = '';
        btn.disabled = false;
        btn.style.opacity = '1';
      } else countEl.textContent = `(${secs}s)`;
    }, 1000);
    btn._timer = timer;
    const signal = context && context.signal;
    if (signal) {
      const abortConfirm = () => {
        document.getElementById('termConfirmMask').classList.remove('show');
        if (btn._timer) clearInterval(btn._timer);
        cleanupTermConfirmAutoAllowTimer();
        if (_termConfirmResolve) {
          _termConfirmResolve({ allowed: false, rejectAll: false, aborted: true });
          _termConfirmResolve = null;
        }
        _currentConfirmChatId = '';
        _termConfirmAbortSignal = null;
        _termConfirmAbortHandler = null;
      };
      _termConfirmAbortSignal = signal;
      _termConfirmAbortHandler = abortConfirm;
      if (signal.aborted) abortConfirm();
      else signal.addEventListener('abort', abortConfirm, { once: true });
    }
  });
}

function cleanupTermConfirmAbortListener() {
  if (_termConfirmAbortSignal && _termConfirmAbortHandler) {
    try { _termConfirmAbortSignal.removeEventListener('abort', _termConfirmAbortHandler); } catch (_) {}
  }
  _termConfirmAbortSignal = null;
  _termConfirmAbortHandler = null;
}

function termConfirmAccept(options = {}) {
  document.getElementById('termConfirmMask').classList.remove('show');
  // ⭐ "永久允许此类"复选框
  const cat = _currentConfirmCategory;
  const autoAllowed = !!(options && options.autoAllowed);
  if (!autoAllowed && document.getElementById('termAllowSession').checked && cat) {
    setPermanentPermission(cat, true);
    const info = PERMISSION_CATEGORIES[cat];
    toast(`✓ 已永久允许「${info ? info.label : cat}」（可在 ⋯ 更多 → 权限管理 撤销）`, 3500);
  }
  const btn = document.getElementById('termAllowBtn');
  if (btn._timer) clearInterval(btn._timer);
  cleanupTermConfirmAutoAllowTimer();
  cleanupTermConfirmAbortListener();
  if (_termConfirmResolve) {
    _termConfirmResolve({ allowed: true, rejectAll: false, autoAllowed });
    _termConfirmResolve = null;
  }
  _currentConfirmChatId = '';
}

function termConfirmAcceptAll() {
  document.getElementById('termConfirmMask').classList.remove('show');
  // ⭐ 改为"本任务后续允许此类操作"（按类别）
  const cat = _currentConfirmCategory;
  if (cat) {
    getTaskAllowForChat(_currentConfirmChatId)[cat] = true;
    const info = PERMISSION_CATEGORIES[cat];
    toast(`⚡ 本任务后续将自动允许「${info ? info.label : cat}」`, 2500);
  }
  const btn = document.getElementById('termAllowBtn');
  if (btn._timer) clearInterval(btn._timer);
  cleanupTermConfirmAutoAllowTimer();
  cleanupTermConfirmAbortListener();
  if (_termConfirmResolve) {
    _termConfirmResolve({ allowed: true, rejectAll: false });
    _termConfirmResolve = null;
  }
  _currentConfirmChatId = '';
}

function termConfirmReject() {
  document.getElementById('termConfirmMask').classList.remove('show');
  const btn = document.getElementById('termAllowBtn');
  if (btn._timer) clearInterval(btn._timer);
  cleanupTermConfirmAutoAllowTimer();
  cleanupTermConfirmAbortListener();
  if (_termConfirmResolve) {
    _termConfirmResolve({ allowed: false, rejectAll: false });
    _termConfirmResolve = null;
  }
  _currentConfirmChatId = '';
}

function termConfirmRejectAll() {
  document.getElementById('termConfirmMask').classList.remove('show');
  const btn = document.getElementById('termAllowBtn');
  if (btn._timer) clearInterval(btn._timer);
  cleanupTermConfirmAutoAllowTimer();
  cleanupTermConfirmAbortListener();
  if (_termConfirmResolve) {
    _termConfirmResolve({ allowed: false, rejectAll: true });
    _termConfirmResolve = null;
  }
  _currentConfirmChatId = '';
}

async function callAgentBackend(action, params, confirmTitle, confirmCommand, context) {
  if (!context && confirmTitle && typeof confirmTitle === 'object' && (confirmTitle.chatId || confirmTitle.chat)) {
    context = confirmTitle;
    confirmTitle = undefined;
  }
  if (!context && confirmCommand && typeof confirmCommand === 'object' && (confirmCommand.chatId || confirmCommand.chat)) {
    context = confirmCommand;
    confirmCommand = undefined;
  }
  const chatId = resolveToolChatId(context);
  const forceConfirm = !!(context && typeof context === 'object' && context.forceConfirm);
  const skipConfirm = !!(context && typeof context === 'object' && context.skipConfirm);
  const category = ACTION_TO_CATEGORY[action] || '';
  const requestParams = withCheckpointParam(params, context);
  if (typeof guardConcurrentFileOwnership === 'function') {
    const conflict = guardConcurrentFileOwnership(action, requestParams, context);
    if (conflict) return conflict;
  }
  const needConfirm = !!category && !skipConfirm;  // 有类别即需要确认；没类别（read_file/list_dir/search/file_info）放行；UI 预览可显式跳过
  
  if (needConfirm) {
    const taskAllow = getTaskAllowForChat(chatId);
    const taskAllowed = !!taskAllow[category];
    const permanentlyAllowed = !!TERMINAL_CONFIG.permanentAllow[category];
    const alreadyAllowed = permanentlyAllowed || taskAllowed;
    
    // forceConfirm 用于 Git 命令在快照工具未启用时绕过“永久允许执行命令”，
    // 避免旧的永久 execute 权限静默放行 Git 写入/恢复类命令。
    // 但用户点击“本任务后续允许执行命令”后，应在当前任务内继续生效。
    if ((forceConfirm && !taskAllowed) || !alreadyAllowed) {
      const result = await termAskConfirm(confirmTitle, params.path || params.cwd, confirmCommand, category, {
        ...(context && typeof context === 'object' ? context : {}),
        chatId
      });
      
      if (!result.allowed) {
        if (typeof claimConcurrentFileOwnership === 'function') {
          claimConcurrentFileOwnership(action, requestParams, { ok: false }, context);
        }
        if (result.aborted) {
          return {
            ok: false,
            error: '⏸️ 工具确认已被中途引导中断。'
          };
        }
        if (result.rejectAll) {
          return {
            ok: false,
            error: '🛑 用户拒绝了此操作并要求停止所有后续操作。',
            _stopAll: true
          };
        } else {
          return {
            ok: false,
            error: '⏭️ 用户拒绝了此操作（仅此一次）。请继续完成其他后续步骤或工具调用。',
            _userRejected: true
          };
        }
      }
    }
  }

  if (action === 'execute' && typeof reviewShellCommandWithAI === 'function') {
    const auditCommand = requestParams.command || params.command || confirmCommand || '';
    const auditCwd = requestParams.cwd || params.cwd || '';
    const auditContext = {
      ...(context && typeof context === 'object' ? context : {}),
      chatId,
      workspace: TERMINAL_CONFIG.workspace || ''
    };
    const audit = await reviewShellCommandWithAI({
      command: auditCommand,
      cwd: auditCwd,
      context: auditContext
    });
    if (audit && audit.aborted) {
      if (typeof recordShellAuditSecurityEvent === 'function') {
        recordShellAuditSecurityEvent(audit, {
          command: auditCommand,
          cwd: auditCwd,
          context: auditContext,
          chatId,
          workspace: TERMINAL_CONFIG.workspace || '',
          finalAction: 'aborted'
        });
      }
      if (typeof claimConcurrentFileOwnership === 'function') {
        claimConcurrentFileOwnership(action, requestParams, { ok: false }, context);
      }
      return {
        ok: false,
        error: '⏸️ Shell 命令审核已被中途引导中断。'
      };
    }
    if (audit && !audit.autoAllow) {
      const confirmAudit = typeof shellAuditConfirmRisk === 'function'
        ? await shellAuditConfirmRisk(audit, {
            command: auditCommand,
            cwd: auditCwd,
            context: auditContext
          })
        : { allowed: false };
      if (typeof recordShellAuditSecurityEvent === 'function') {
        recordShellAuditSecurityEvent(audit, {
          command: auditCommand,
          cwd: auditCwd,
          context: auditContext,
          chatId,
          workspace: TERMINAL_CONFIG.workspace || '',
          finalAction: confirmAudit.allowed ? 'manual_allow' : (confirmAudit.aborted ? 'aborted' : (audit.localBlock ? 'local_block' : 'manual_reject'))
        });
      }
      if (!confirmAudit.allowed) {
        if (typeof claimConcurrentFileOwnership === 'function') {
          claimConcurrentFileOwnership(action, requestParams, { ok: false }, context);
        }
        return {
          ok: false,
          error: confirmAudit.aborted
            ? '⏸️ Shell 命令风险确认已被中途引导中断。'
            : `🛡️ Shell 命令未通过 AI 安全审核：${audit.reason || '需要用户确认'}`,
          _userRejected: !confirmAudit.aborted
        };
      }
    } else if (audit && typeof recordShellAuditSecurityEvent === 'function') {
      recordShellAuditSecurityEvent(audit, {
        command: auditCommand,
        cwd: auditCwd,
        context: auditContext,
        chatId,
        workspace: TERMINAL_CONFIG.workspace || '',
        finalAction: 'auto_allow'
      });
    }
  }
  
  // ⭐ 实际请求，封装为函数以便 403 后自动重试一次
  const requestTimeoutMs = agentBackendRequestTimeoutMs(action, requestParams);
  const doFetch = async () => {
    const backendParams = { ...requestParams };
    delete backendParams.requestTimeoutMs;
    delete backendParams._requestTimeoutMs;
    return await fetchAgentBackendWithTimeout(TERMINAL_CONFIG.serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...backendParams, session_id: getAgentSessionId({ chatId }) })
    }, context && context.signal ? context.signal : undefined, requestTimeoutMs);
  };
  
  try {
    let resp = await doFetch();
    
    const r = await readAgentBackendJsonWithTimeout(
      resp,
      context && context.signal ? context.signal : undefined,
      Math.max(15000, Math.min(requestTimeoutMs, 60000))
    );
    bindCheckpointToToolContext(r, context);
    if (typeof rememberConcurrentCheckpoints === 'function') {
      rememberConcurrentCheckpoints(r, context);
    }
    if (typeof claimConcurrentFileOwnership === 'function') {
      claimConcurrentFileOwnership(action, requestParams, r, context);
    }
    // ⭐ 如果响应里带了 workspace/cwd，顺手刷新顶部沙箱栏显示
    if (r && (r.workspace || r.cwd)) {
      if (r.workspace) TERMINAL_CONFIG.workspace = r.workspace;
      if (r.cwd) TERMINAL_CONFIG.cwd = r.cwd;
      const pathEl = document.getElementById('workspacePath');
      const statusEl = document.getElementById('workspaceStatus');
      if (pathEl && r.workspace) {
        pathEl.textContent = r.workspace;
        pathEl.title = `沙箱根：${r.workspace}\n当前 cwd：${r.cwd || r.workspace}`;
      }
      if (statusEl) {
        statusEl.className = 'workspace-status online';
        statusEl.title = '本地服务在线';
      }
    }
    return r;
  } catch (e) {
    if (typeof claimConcurrentFileOwnership === 'function') {
      claimConcurrentFileOwnership(action, requestParams, { ok: false }, context);
    }
    if (e && e.name === 'AbortError') {
      return { ok: false, error: '⏸️ 工具请求已被中断，准备按新的引导继续。' };
    }
    if (e && e.name === 'AgentBackendTimeoutError') {
      return {
        ok: false,
        error: `⏱️ ${e.message}`,
        _toolTimeout: true,
        timeoutMs: e.timeoutMs || requestTimeoutMs
      };
    }
    return { ok: false, error: `无法连接后端服务：${e.message}` };
  }
}

function getToolCheckpointId(context) {
  const ctx = context || (typeof window !== 'undefined' ? window.__currentToolContext : null) || {};
  if (ctx.checkpointId) return ctx.checkpointId;
  if (ctx.outline && ctx.outline.checkpointId) return ctx.outline.checkpointId;
  if (ctx.chat && ctx.chat.outline && ctx.chat.outline.checkpointId) return ctx.chat.outline.checkpointId;
  return '';
}

function withCheckpointParam(params, context) {
  const checkpointId = getToolCheckpointId(context);
  if (!checkpointId) return params || {};
  return { ...(params || {}), checkpoint_id: checkpointId };
}

function checkpointMetaFromResponse(r) {
  if (!r || typeof r !== 'object') return {};
  return {
    checkpoint_id: r.checkpoint_id || (r.checkpoint && r.checkpoint.id) || '',
    checkpoint: r.checkpoint || null
  };
}

function countTextLinesForDiff(text) {
  const value = String(text || '');
  if (!value) return 0;
  const lines = value.split(/\r\n|\r|\n/).length;
  return value.endsWith('\n') || value.endsWith('\r') ? Math.max(0, lines - 1) : lines;
}

function bindCheckpointToToolContext(response, context) {
  const checkpointId = response && (response.checkpoint_id || (response.checkpoint && response.checkpoint.id));
  if (!checkpointId) return;
  const ctx = context || (typeof window !== 'undefined' ? window.__currentToolContext : null) || {};
  ctx.checkpointId = checkpointId;
  if (ctx.outline && typeof ctx.outline === 'object') {
    if (!ctx.outline.checkpointId) ctx.outline.checkpointId = checkpointId;
    ctx.outline.checkpoint = response.checkpoint || ctx.outline.checkpoint || null;
  }
}

function tokenizeShellLikeCommand(command) {
  const tokens = [];
  let cur = '';
  let quote = '';
  let escaped = false;
  for (const ch of String(command || '')) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function commandHasShellOperators(command) {
  return /(?:&&|\|\||[|;<>`])/.test(String(command || ''));
}

function splitGitPathspec(tokens) {
  const idx = tokens.indexOf('--');
  return idx >= 0 ? tokens.slice(idx + 1).filter(Boolean) : [];
}

function gitCommitFromTokens(tokens) {
  return tokens.find(t => /^[0-9a-fA-F]{4,40}$/.test(t)) || '';
}

function gitCommitMessageFromTokens(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if ((tokens[i] === '-m' || tokens[i] === '--message') && tokens[i + 1]) return tokens[i + 1];
    if (tokens[i].startsWith('-m') && tokens[i].length > 2) return tokens[i].slice(2);
    if (tokens[i].startsWith('--message=')) return tokens[i].slice('--message='.length);
  }
  return '';
}

function aiGitToolsAvailable() {
  if (typeof gitToolsEnabled === 'function') return gitToolsEnabled();
  if (!state || !Array.isArray(state.tools)) return false;
  const names = new Set(['note_status', 'note_history', 'note_diff', 'note_snapshot', 'note_restore']);
  return state.tools.some(t => t && names.has(t.name));
}

async function routeGitExecuteCommand(command, context) {
  const tokens = tokenizeShellLikeCommand(command);
  if (!tokens.length || String(tokens[0]).toLowerCase() !== 'git') return null;
  if (!aiGitToolsAvailable()) return { passthrough: true, forceConfirm: true };
  if (commandHasShellOperators(command)) {
    return '❌ 检测到包含 shell 控制符的 git 命令。为避免绕过 Git/回滚权限，请改用 note_status、note_history、note_diff、note_snapshot、note_restore 或 restore_checkpoint。';
  }
  const sub = String(tokens[1] || '').toLowerCase();
  const rest = tokens.slice(2);
  
  if (!sub || ['status', 'st'].includes(sub)) {
    return await aiGitStatus(context);
  }
  if (['log', 'history'].includes(sub)) {
    const nIdx = rest.findIndex(t => /^-\d+$/.test(t));
    const limit = nIdx >= 0 ? Math.abs(parseInt(rest[nIdx])) : 20;
    return await aiGitHistory(limit, context);
  }
  if (sub === 'diff') {
    const paths = splitGitPathspec(rest);
    const file = paths.length === 1 ? paths[0] : '';
    return await aiGitDiff('', file, context);
  }
  if (sub === 'show') {
    const commit = gitCommitFromTokens(rest);
    const paths = splitGitPathspec(rest);
    if (commit) return await aiGitDiff(commit, paths.length === 1 ? paths[0] : '', context);
    return '❌ git show 无法安全映射。请改用 note_diff，并提供 commit 参数。';
  }
  if (sub === 'commit') {
    return await aiGitSnapshot(gitCommitMessageFromTokens(rest), context);
  }
  if (sub === 'add') {
    return '❌ git add 不允许通过 execute_action 执行。请改用 note_snapshot，它会在用户确认后保存当前工作区快照。';
  }
  if (['restore', 'reset', 'clean', 'checkout', 'switch', 'revert'].includes(sub)) {
    const commit = gitCommitFromTokens(rest);
    const paths = splitGitPathspec(rest);
    if ((sub === 'checkout' || sub === 'restore') && commit && paths.length === 1) {
      return await aiGitRestore(commit, paths[0], context);
    }
    return '❌ 检测到 Git 恢复/重置类命令。为避免绕过权限，请改用 note_restore（历史文件恢复）或 restore_checkpoint（大纲修改前 checkpoint 回滚）。';
  }
  
  return '❌ git 命令不允许通过 execute_action 执行。请改用专用 Git 工具：note_status、note_history、note_diff、note_snapshot、note_restore。';
}

async function executeTerminalCommand(command, cwd, newWindow, context) {
  let gitRouted = await routeGitExecuteCommand(command, context);
  const forceConfirm = gitRouted && typeof gitRouted === 'object' && gitRouted.forceConfirm;
  if (gitRouted && typeof gitRouted === 'object' && gitRouted.passthrough) gitRouted = null;
  if (gitRouted !== null) return gitRouted;
  const r = await callAgentBackend('execute', { command, cwd, timeout: 60, new_window: !!newWindow },
    forceConfirm ? 'AI 想执行 Git 命令（快照工具未启用）' : 'AI 想执行任务指令',
    command,
    { ...(context && typeof context === 'object' ? context : {}), forceConfirm });
  if (typeof r === 'string') return r;
  if (!r.ok && (r._stopAll || r._userRejected)) return r;
  if (!r.ok) return `❌ ${r.error}`;
  let output = `📂 目录：${r.cwd}\n💻 指令：${command}\n📤 退出码：${r.returncode}\n`;
  if (r.stdout) output += `\n[STDOUT]\n${r.stdout}`;
  if (r.stderr) output += `\n[STDERR]\n${r.stderr}`;
  if (!r.stdout && !r.stderr) output += '\n(无输出)';
  return {
    ok: true,
    command,
    cwd: r.cwd,
    returncode: r.returncode,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    new_window: !!r.new_window,
    text: output
  };
}

async function readFile(path, startLine, endLine, context) {
  const r = await callAgentBackend('read_file', { path, start_line: startLine, end_line: endLine }, undefined, undefined, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}`;
  return `📖 文档：${r.path}\n大小：${r.size} 字节\n\n--- 内容 ---\n${r.content}`;
}

async function writeFile(path, content, context) {
  const r = await callAgentBackend('write_file', { path, content },
    'AI 想保存文档', `[写入文档] ${path}\n\n内容预览（${content.length} 字符）:\n${content.slice(0, 300)}${content.length > 300 ? '\n...(已截断)' : ''}`, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}`;
  return {
    ok: true,
    files: [{
      path: r.path || path,
      added: countTextLinesForDiff(content),
      removed: parseInt(r.old_lines) || 0,
      action: r.action === '创建' ? 'created' : 'modified'
    }],
    ...checkpointMetaFromResponse(r),
    text: `✅ ${r.action}文档：${r.path}（写入 ${r.bytes_written} 字节）`
  };
}

async function appendFile(path, content, context) {
  const r = await callAgentBackend('append_file', { path, content },
    'AI 想追加内容到文档', `[追加到] ${path}\n\n追加内容（${content.length} 字符）:\n${content.slice(0, 300)}${content.length > 300 ? '\n...' : ''}`, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}`;
  return {
    ok: true,
    files: [{
      path: r.path || path,
      added: countTextLinesForDiff(content),
      removed: 0,
      action: 'modified'
    }],
    ...checkpointMetaFromResponse(r),
    text: `✅ 已追加 ${r.bytes_appended} 字节到 ${r.path}`
  };
}

async function editFile(path, oldText, newText, context) {
  const r = await callAgentBackend('edit_file', { path, old_text: oldText, new_text: newText },
    'AI 想更新文档', `[更新文档] ${path}\n\n[替换前]\n${oldText.slice(0, 200)}\n\n[替换后]\n${newText.slice(0, 200)}`, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}`;
  return {
    ok: true,
    files: [{
      path: r.path || path,
      added: countTextLinesForDiff(newText),
      removed: countTextLinesForDiff(oldText),
      action: 'modified'
    }],
    ...checkpointMetaFromResponse(r),
    text: `✅ 已更新文档：${r.path}`
  };
}

async function applyPatch(patch, dryRun, context) {
  const preview = String(patch || '').slice(0, 1200);
  const r = await callAgentBackend('apply_patch', withCheckpointParam({ patch, dry_run: !!dryRun }, context),
    dryRun ? 'AI 想预检代码补丁' : 'AI 想应用代码补丁',
    `[apply_patch ${dryRun ? 'dry-run' : 'apply'}]\n\n${preview}${String(patch || '').length > 1200 ? '\n...(已截断)' : ''}`,
    context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}`;
  const files = (r.files || []).map(f =>
    `- ${f.action || '修改'} ${f.path}（+${f.added || 0}/-${f.removed || 0}，${f.hunks || 0} hunks）`
  ).join('\n') || '- （无文件）';
  return {
    ok: true,
    dry_run: !!r.dry_run,
    files: r.files || [],
    ...checkpointMetaFromResponse(r),
    text: `${r.dry_run ? '✅ Patch 预检通过' : '✅ Patch 已应用'}\n${files}`
  };
}

async function deleteFile(path, context) {
  const r = await callAgentBackend('delete_file', { path },
    'AI 想移除文档', `[移除] ${path}`, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}`;
  return {
    ok: true,
    files: [{
      path: r.path || path,
      added: 0,
      removed: parseInt(r.removed_lines) || 0,
      action: r.type === 'dir' ? 'deleted_dir' : 'deleted'
    }],
    ...checkpointMetaFromResponse(r),
    text: `✅ 已移除${r.type === 'dir' ? '目录' : '文档'}：${r.path}`
  };
}

async function listCheckpoints(limit, context) {
  const r = await callAgentBackend('list_checkpoints', { limit: limit || 20 }, undefined, undefined, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}`;
  const rows = r.checkpoints || [];
  if (!rows.length) return '暂无 checkpoint。';
  let out = `checkpoint 列表（${rows.length} 个）\n\n`;
  for (const ck of rows) {
    const files = (ck.files || []).slice(0, 6).map(f => `  - ${f.path}${f.existed ? '' : '（创建前不存在）'}`).join('\n');
    const more = (ck.files || []).length > 6 ? `\n  ... 还有 ${(ck.files || []).length - 6} 个文件` : '';
    out += `- ${ck.id}\n  时间：${ck.createdAt || ck.updatedAt || ''}\n  原因：${ck.reason || ''}\n  文件数：${ck.fileCount || 0}\n${files}${more}\n\n`;
  }
  return {
    ok: true,
    checkpoints: rows,
    text: out.trim()
  };
}

async function restoreCheckpoint(checkpointId, force, context) {
  const id = checkpointId || getToolCheckpointId(context);
  if (!id) return '❌ 缺少 checkpoint_id。请先使用 list_checkpoints，或在大纲任务里使用当前 outline.checkpointId。';
  const r = await callAgentBackend('restore_checkpoint', { checkpoint_id: id, force: !!force },
    'AI 想恢复到修改前 checkpoint',
    `[restore_checkpoint]\n\ncheckpoint：${id}\nforce：${!!force}\n\n此操作会按 checkpoint 恢复文件，可能覆盖或删除当前工作区文件。`,
    context);
  if (typeof r === 'string') return r;
  if (!r.ok) {
    if (r.needs_force && Array.isArray(r.conflicts)) {
      const conflicts = r.conflicts.map(x => `- ${x.path}: ${x.reason}`).join('\n');
      return {
        ok: false,
        checkpoint_id: id,
        needs_force: true,
        conflicts: r.conflicts,
        text: `checkpoint 存在冲突，未恢复。若确认要覆盖当前状态，请在用户确认后传 force=true。\n\n${conflicts}`
      };
    }
    return `❌ ${r.error || 'restore_checkpoint 失败'}`;
  }
  const restored = r.restored || [];
  const deleted = r.deleted || [];
  const skipped = r.skipped || [];
  const safetyId = r.safetyCheckpoint && r.safetyCheckpoint.id;
  const text = [
    `已恢复 checkpoint：${id}`,
    `恢复文件：${restored.length}`,
    `删除新文件：${deleted.length}`,
    `跳过：${skipped.length}`,
    skipped.length ? `跳过原因：${skipped.slice(0, 5).map(x => `${x.path || '?'}:${x.reason || '?'}`).join('；')}${skipped.length > 5 ? '；...' : ''}` : '',
    safetyId ? `恢复前安全 checkpoint：${safetyId}` : ''
  ].filter(Boolean).join('\n');
  return {
    ok: true,
    checkpoint_id: id,
    restored,
    deleted,
    skipped,
    conflicts: r.conflicts || [],
    safetyCheckpoint: r.safetyCheckpoint || null,
    text
  };
}

async function listDir(path, context) {
  const r = await callAgentBackend('list_dir', { path }, undefined, undefined, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}`;
  let output = `📁 目录：${r.path}\n共 ${r.entries.length} 项\n\n`;
  for (const e of r.entries) {
    const icon = e.type === 'dir' ? '📁' : '📄';
    const size = e.type === 'dir' ? '' : ` (${formatFileSize(e.size)})`;
    output += `${icon} ${e.name}${size}\n`;
  }
  return output;
}

async function searchInFiles(path, pattern, fileGlob, context) {
  const r = await callAgentBackend('search', { path, pattern, file_glob: fileGlob || '*' }, undefined, undefined, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}`;
  if (!r.results.length) return `🔍 在 "${path}" 中未找到 "${pattern}"`;
  let output = `🔍 找到 ${r.results.length} 处匹配：\n\n`;
  for (const m of r.results) {
    output += `${m.file}:${m.line}\n  ${m.content}\n\n`;
  }
  return output;
}

async function generatePpt(data, context) {
  const payload = data && typeof data === 'object' ? data : {};
  const title = payload.title || payload.user_request || payload.request || payload.prompt || (Array.isArray(payload.slides) && payload.slides[0] && payload.slides[0].title) || '未命名 PPT';
  const slideCount = Array.isArray(payload.slides) ? payload.slides.length : 0;
  const r = await callAgentBackend('generate_ppt', { data: payload },
    'AI 想生成 PPT 文件',
    `[生成 PPT]\n标题：${title}\n页数：${slideCount || payload.slide_count || payload.pages || '自动规划'}\n文件名：AI 自动命名\n渲染：每页一张 16:9 图片`,
    context);
  if (typeof r === 'string') return r;
  if (!r.ok) {
    return {
      ok: false,
      path: r.path,
      slides: r.slides || slideCount,
      pipeline: r.pipeline || {},
      text: `❌ ${r.error || r.message || 'PPT 生成失败'}${r.path ? `：${r.path}` : ''}`
    };
  }
  return {
    ok: true,
    path: r.path,
    slides: r.slides || slideCount,
    title: r.title || '',
    filename: r.filename || '',
    render_mode: r.render_mode || 'html_image',
    html_dir: r.html_dir || '',
    image_dir: r.image_dir || '',
    html_pages: r.html_pages || [],
    images: r.images || [],
    renderer: r.renderer || '',
    renderer_note: r.renderer_note || '',
    pipeline: r.pipeline || {},
    text: `✅ PPT 已生成：${r.path}（${r.slides || slideCount} 页，每页一张图片）`
  };
}

async function pptTaskRequest(command, data, context) {
  const payload = data && typeof data === 'object' ? data : {};
  const params = { command, ...payload };
  return await callAgentBackend('ppt_task', params, undefined, undefined, {
    ...(context && typeof context === 'object' ? context : {}),
    skipConfirm: true
  });
}

async function startPptTask(data, context) {
  return await pptTaskRequest('start', { data }, context);
}

async function pollPptTask(taskId, since, context) {
  return await pptTaskRequest('poll', { task_id: taskId, since: since || 0 }, context);
}

async function controlPptTask(taskId, command, context) {
  return await pptTaskRequest(command, { task_id: taskId }, context);
}

async function generatePptWithProgress(data, context = {}) {
  const onProgress = typeof context.onProgress === 'function' ? context.onProgress : null;
  const signal = context.signal;
  const started = await startPptTask(data, context);
  if (!started || !started.ok) return started || { ok: false, error: 'PPT 任务启动失败' };
  const taskId = started.task_id;
  if (onProgress) onProgress({ type: 'task_started', task_id: taskId, snapshot: started });
  let since = 0;
  let sentPause = false;
  const isStopped = typeof context.isStopped === 'function' ? context.isStopped : () => false;
  while (true) {
    if (signal && signal.aborted && !sentPause) {
      sentPause = true;
      try { await controlPptTask(taskId, 'pause', context); } catch (_) {}
    } else if (isStopped() && !sentPause) {
      sentPause = true;
      try { await controlPptTask(taskId, 'pause', context); } catch (_) {}
    }
    const snap = await pollPptTask(taskId, since, context);
    if (!snap || !snap.ok) return snap || { ok: false, error: 'PPT 任务轮询失败' };
    since = snap.progress_index || since;
    if (onProgress) onProgress({ type: 'task_poll', task_id: taskId, snapshot: snap });
    if (snap.status === 'done') return { ...(snap.result || {}), task_id: taskId };
    if (snap.status === 'error') return { ok: false, error: snap.error || 'PPT 任务失败', task_id: taskId, result: snap.result };
    if (snap.status === 'cancelled') return { ok: false, cancelled: true, error: snap.error || 'PPT 任务已取消', task_id: taskId };
    if (sentPause && snap.status === 'paused') {
      return { ok: false, paused: true, task_id: taskId, error: 'PPT 任务已暂停，可点击恢复继续。', snapshot: snap };
    }
    await new Promise(resolve => setTimeout(resolve, 900));
  }
}

async function analyzePptTemplate(data, context) {
  const payload = data && typeof data === 'object' ? { ...data } : {};
  const templatePath = payload.path || payload.template_path || payload.pptx || payload.file || '';
  const r = await callAgentBackend('analyze_ppt_template', payload,
    'AI 想分析 PPT 模板',
    `[分析 PPT 模板]\n路径：${templatePath}\n保存 profile：${payload.save_profile !== false}`,
    context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ PPT 模板分析失败：${r.error}`;
  const profile = r.profile || {};
  const size = profile.size || {};
  const theme = profile.theme || {};
  const font = profile.font || {};
  return {
    ok: true,
    profile,
    profile_path: r.profile_path,
    text: [
      `✅ PPT 模板分析完成${r.profile_path ? `：${r.profile_path}` : ''}`,
      `尺寸：${size.width_in || '-'} x ${size.height_in || '-'} in，比例：${size.aspect_ratio || '-'}`,
      `主题色：primary=${theme.primary_color || '-'}，accent=${theme.accent_color || '-'}，background=${theme.background_color || '-'}`,
      `字体：${font.font_family || '-'}，标题 ${font.title_font_size || '-'}，正文 ${font.body_font_size || '-'}`,
      `固定元素：${Array.isArray(profile.decorations) ? profile.decorations.length : 0} 个`,
      profile.warnings && profile.warnings.length ? `警告：${profile.warnings.join('；')}` : '警告：无'
    ].join('\n')
  };
}

function formatPptValidationSummary(r) {
  const issues = Array.isArray(r.issues) ? r.issues : [];
  const warnings = Array.isArray(r.warnings) ? r.warnings : [];
  const stats = r.stats || {};
  const issueText = issues.slice(0, 5).map(x => `- ${x.message || x}`).join('\n');
  const warningText = warnings.slice(0, 5).map(x => `- ${x.slide ? `第 ${x.slide} 页：` : ''}${x.message || x}`).join('\n');
  return [
    `${r.passed ? '✅' : '❌'} PPT 校验${r.passed ? '通过' : '未通过'}：${r.path}`,
    `页数：${r.slide_count || 0}，评分：${r.score ?? '-'}`,
    `文字：${stats.text_char_count || 0} 字符，问号：${stats.visible_question_marks || 0}，中文字符：${stats.cjk_char_count || 0}`,
    issues.length ? `问题：\n${issueText}` : '问题：无',
    warnings.length ? `警告：\n${warningText}` : '警告：无'
  ].join('\n');
}

async function validatePpt(data, context) {
  const payload = data && typeof data === 'object' ? data : {};
  const r = await callAgentBackend('validate_ppt', payload, undefined, undefined, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ PPT 校验失败：${r.error}`;
  return {
    ok: true,
    passed: !!r.passed,
    path: r.path,
    report: r,
    text: formatPptValidationSummary(r)
  };
}

async function previewPpt(data, context) {
  const payload = data && typeof data === 'object' ? { ...data } : {};
  if (!payload._requestTimeoutMs && !payload.requestTimeoutMs) payload._requestTimeoutMs = 180000;
  const r = await callAgentBackend('preview_ppt', payload, undefined, undefined, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ PPT 预览失败：${r.error}`;
  const images = Array.isArray(r.images) ? r.images : [];
  const imageText = images.slice(0, 8).map(x => `- 第 ${x.slide} 页：${x.path}`).join('\n');
  return {
    ok: true,
    passed: !!r.passed,
    path: r.path,
    html: r.html,
    preview_url: r.preview_url,
    images,
    renderer: r.renderer,
    validation: r.validation,
    text: [
      `✅ PPT 预览已生成：${r.html}`,
      `预览入口：${r.preview_url}`,
      `渲染器：${r.renderer || 'none'}`,
      `校验：${r.passed ? '通过' : '未通过'}`,
      imageText ? `图片：\n${imageText}` : '图片：未生成'
    ].join('\n')
  };
}

// ⭐ 网络搜索（通过本地后端 → DuckDuckGo/Bing）
async function webSearch(query, maxResults, region, context) {
  const r = await callAgentBackend('web_search', {
    query,
    max_results: maxResults || 8,
    region: region || 'wt-wt'
  }, undefined, undefined, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ 搜索失败：${r.error}`;
  let output = `🌐 搜索 "${r.query}"（来源：${r.engine}，共 ${r.count} 条）：\n\n`;
  r.results.forEach((m, i) => {
    output += `${i + 1}. **${m.title}**\n   ${m.url}\n   ${m.snippet}\n\n`;
  });
  return output;
}

// ⭐ 抓取网页正文（通过本地后端，自动识别编码 + 去除 HTML）
async function fetchUrl(url, extractText, maxChars, context) {
  const r = await callAgentBackend('fetch_url', {
    url,
    extract_text: extractText !== false,
    max_chars: maxChars || 8000
  }, undefined, undefined, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ 抓取失败：${r.error}`;
  let output = '';
  if (r.title) output += `📄 标题：${r.title}\n`;
  output += `🔗 URL：${r.url}\n`;
  output += `📊 状态：${r.status}，正文长度 ${r.length} 字`;
  if (r.truncated) output += `（已截断）`;
  output += `\n\n${r.content}`;
  return output;
}

// 📸 AI 截图工具：指定窗口优先 → 全屏兜底 → 用户置前提示
async function aiScreenshot(args, context) {
  args = args || {};
  const mode = args.mode || 'auto';
  const params = {
    mode,
    window_title: args.window_title || args.title || '',
    process_name: args.process_name || '',
    hwnd: args.hwnd || null,
    all_screens: args.all_screens !== false,
    use_printwindow: !!args.use_printwindow
  };
  const summary = [
    `[ai_screenshot] ${mode}`,
    params.window_title ? `窗口标题：${params.window_title}` : '',
    params.process_name ? `进程：${params.process_name}` : '',
    params.hwnd ? `HWND：${params.hwnd}` : '',
    '截图范围：' + (params.window_title || params.process_name || params.hwnd ? '指定窗口' : '全屏')
  ].filter(Boolean).join('\n');
  const r = await callAgentBackend('screenshot', params, 'AI 想截取屏幕/窗口图像', summary, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}${r.fallback ? '\n💡 ' + r.fallback : ''}`;

  let out = `📸 截图完成：${r.name || 'screenshot.png'}\n`;
  out += `已保存至：${r.path || r.dir || '(未知路径)'}\n`;
  out += `来源：${r.source || 'unknown'}；策略：${r.strategy || ''}\n`;
  out += `尺寸：${r.width}×${r.height}`;
  if (r.window && r.window.title) out += `\n窗口：${r.window.title}`;
  if (r.warnings && r.warnings.length) out += `\n⚠️ ${r.warnings.join('\n⚠️ ')}`;
  return out;
}


async function aiListWindows(windowTitle, processName, context) {
  const r = await callAgentBackend('list_windows', {
    window_title: windowTitle || '',
    process_name: processName || ''
  }, 'AI 想查看当前窗口列表', `[list_windows]\n标题过滤：${windowTitle || '(无)'}\n进程过滤：${processName || '(无)'}`, context);
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}`;
  if (!r.windows || !r.windows.length) return `🪟 未找到匹配窗口（平台：${r.platform}）。可改用 ai_screenshot mode=fullscreen 获取全屏预览。`;
  let out = `🪟 找到 ${r.count} 个窗口：\n\n`;
  for (const w of r.windows.slice(0, 30)) {
    out += `- hwnd=${w.hwnd} pid=${w.pid || ''} ${w.process_name || ''}\n  ${w.title}\n`;
  }
  return out;
}

function formatFileSize(b) {
  if (b < 1024) return b + 'B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + 'KB';
  return (b / 1024 / 1024).toFixed(2) + 'MB';
}

// ============ 🌿 Git 调用（绕过工具权限，仅前端 UI 使用）============
// 与 callAgentBackend 不同：
//   - 不弹"工具权限确认"（用户主动点 UI 触发，自己就是权限）
//   - 直接返回后端 JSON（不做字符串包装）
async function callGit(subcommand, params) {
  const doFetch = async () => fetch(TERMINAL_CONFIG.serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'git', subcommand, ...(params || {}) })
  });
  try {
    let resp = await doFetch();
    return await resp.json();
  } catch (e) {
    return { ok: false, error: `无法连接后端：${e.message}` };
  }
}
window.callGit = callGit;

// ============ 🤖 AI Git 工具（笔记快照风格） ============
// 与人工 Git 面板共享 callGit 后端，但走自己的权限类别（git_read/git_write/git_restore）
// 复用 termAskConfirm 弹窗机制 → 用户可以"永久允许"/"本任务允许"

// 公共权限检查（与 callAgentBackend 同款，仅类别不同）
async function _aiGitCheckPermission(category, title, summary, context) {
  const chatId = resolveToolChatId(context);
  const taskAllow = getTaskAllowForChat(chatId);
  const alreadyAllowed =
    TERMINAL_CONFIG.permanentAllow[category] ||
    taskAllow[category];
  if (alreadyAllowed) return { ok: true };
  const result = await termAskConfirm(title, '工作区', summary, category, { chatId });
  if (!result.allowed) {
    if (result.rejectAll) {
      return { ok: false, error: '🛑 用户拒绝并停止后续 Git 操作。', _stopAll: true };
    }
    return { ok: false, error: '⏭️ 用户拒绝此次 Git 操作。', _userRejected: true };
  }
  return { ok: true };
}

// 检查 Git 仓库是否就绪
async function _aiGitEnsureRepo() {
  const r = await callGit('check', {});
  if (!r || !r.ok) {
    return { ok: false, error: '❌ 未能连接 Git 后端：' + (r && r.error ? r.error : '未知错误') };
  }
  if (!r.gitInstalled) {
    return { ok: false, error: '❌ 系统未安装 Git，AI 无法保存快照。请先安装 Git。' };
  }
  if (!r.inRepo) {
    return { ok: false, error: '❌ 当前工作区不是 Git 仓库。请先在 🌿 Git 管理面板里初始化。' };
  }
  return { ok: true, info: r };
}

// 🔍 note_status — 查看当前工作区改动概览
async function aiGitStatus(context) {
  const repo = await _aiGitEnsureRepo();
  if (!repo.ok) return repo.error;
  const perm = await _aiGitCheckPermission('git_read', 'AI 想查看版本状态', '[note_status] 列出当前未提交的改动文件', context);
  if (!perm.ok) return perm.error;
  const r = await callGit('status', {});
  if (!r.ok) return `❌ ${r.error}`;
  const branch = r.branch || '(无分支)';
  // 后端字段：staged / unstaged / untracked（数组），ahead/behind
  const staged = r.staged || [];
  const unstaged = r.unstaged || [];
  const untracked = r.untracked || [];
  const total = staged.length + unstaged.length + untracked.length;
  let out = `📊 版本状态\n分支：${branch}\n`;
  if (r.ahead) out += `领先远程 ${r.ahead} 个提交\n`;
  if (r.behind) out += `落后远程 ${r.behind} 个提交\n`;
  out += `\n已暂存：${staged.length}　未暂存：${unstaged.length}　未跟踪：${untracked.length}　共 ${total}\n`;
  if (total === 0) {
    out += '\n✅ 工作区干净，没有未保存的改动。';
    return out;
  }
  const fmt = (arr, label) => {
    if (!arr.length) return '';
    let s = `\n--- ${label} ---\n`;
    for (const f of arr.slice(0, 30)) s += `${f.status || '?'}  ${f.path}\n`;
    if (arr.length > 30) s += `... 还有 ${arr.length - 30} 个\n`;
    return s;
  };
  out += fmt(staged, '已暂存');
  out += fmt(unstaged, '未暂存改动');
  out += fmt(untracked, '未跟踪文件');
  return out;
}

// 📜 note_history — 查看历史快照
async function aiGitHistory(limit, context) {
  const repo = await _aiGitEnsureRepo();
  if (!repo.ok) return repo.error;
  const perm = await _aiGitCheckPermission('git_read', 'AI 想查看历史快照', `[note_history] 列出最近 ${limit || 20} 个版本`, context);
  if (!perm.ok) return perm.error;
  const r = await callGit('log', { limit: Math.min(Math.max(limit || 20, 1), 100) });
  if (!r.ok) return `❌ ${r.error}`;
  const commits = r.commits || [];
  if (commits.length === 0) return '📜 暂无历史快照（仓库还没有任何提交）。';
  let out = `📜 历史快照（共 ${commits.length} 个）\n\n`;
  for (const c of commits) {
    const hash = c.shortHash || (c.hash || '').slice(0, 7);
    const time = c.ts ? new Date(c.ts * 1000).toLocaleString('zh-CN') : '';
    const author = c.author || '';
    const subject = c.subject || '';
    out += `● ${hash}  ${time}  ${author}\n   ${subject}\n\n`;
  }
  out += '💡 如需查看某个快照的具体改动，调用 note_diff 并传 commit 参数（7 位短 hash 即可）。';
  return out;
}

// 🔬 note_diff — 查看某次快照或当前工作区的具体改动
async function aiGitDiff(commit, path, context) {
  const repo = await _aiGitEnsureRepo();
  if (!repo.ok) return repo.error;
  const perm = await _aiGitCheckPermission('git_read', 'AI 想查看版本差异',
    `[note_diff] ${commit ? '快照 ' + commit.slice(0, 7) : '当前工作区改动'}${path ? '  文件：' + path : ''}`, context);
  if (!perm.ok) return perm.error;
  const params = {};
  if (commit) {
    params.mode = 'commit';
    params.commit = commit;
  } else {
    params.mode = 'working';
  }
  if (path) params.file = path;
  const r = await callGit('diff', params);
  if (!r.ok) return `❌ ${r.error}`;
  const diff = r.diff || '';
  if (!diff.trim()) return '（没有差异内容 —— 工作区干净，或指定文件没改动）';
  const MAX = 40000;
  if (diff.length > MAX) {
    return `🔬 差异内容（已截断，原始 ${diff.length} 字符）\n\n` + diff.slice(0, MAX) + '\n\n... [已截断]';
  }
  return `🔬 差异内容\n\n${diff}`;
}

// 💾 note_snapshot — 保存当前工作区为一个新快照（git add . + git commit）
async function aiGitSnapshot(message, context) {
  const repo = await _aiGitEnsureRepo();
  if (!repo.ok) return repo.error;
  // 先看有没有改动可提交
  const st = await callGit('status', {});
  if (!st.ok) return `❌ 无法读取状态：${st.error}`;
  const staged = st.staged || [];
  const unstaged = st.unstaged || [];
  const untracked = st.untracked || [];
  const totalCount = staged.length + unstaged.length + untracked.length;
  if (totalCount === 0) return '✅ 工作区干净，没有需要保存的改动。';
  
  const msg = (message && message.trim()) || `AI 自动快照 ${new Date().toLocaleString('zh-CN')}`;
  const all = [...staged, ...unstaged, ...untracked];
  const fileSummary = all.slice(0, 8).map(f => `${f.status || '?'} ${f.path}`).join('\n');
  const more = all.length > 8 ? `\n... 共 ${all.length} 个文件` : '';
  
  const perm = await _aiGitCheckPermission('git_write', 'AI 想保存当前进度为版本快照',
    `[note_snapshot]\n📝 信息：${msg}\n\n📋 包含改动：\n${fileSummary}${more}`, context);
  if (!perm.ok) return perm.error;
  
  // 后端 add 接受 files 数组；用 ['.'] 等价 git add .
  const addR = await callGit('add', { files: ['.'] });
  if (!addR.ok) return `❌ 暂存失败：${addR.error}`;
  const cmR = await callGit('commit', { message: msg });
  if (!cmR.ok) return `❌ 提交失败：${cmR.error}`;
  return `✅ 已保存快照\n📝 信息：${msg}\n📋 包含 ${all.length} 个文件改动\n\n💡 如需查看可调用 note_history，如需回退可调用 note_restore。`;
}

// ⏪ note_restore — 将某个文件恢复到历史版本（高危：覆盖工作区）
async function aiGitRestore(commit, path, context) {
  if (!commit || !path) return '❌ 必须同时提供 commit（快照 hash）和 path（要恢复的文件）。';
  if (!/^[0-9a-fA-F]{4,40}$/.test(commit)) return '❌ commit 必须是 4-40 位的十六进制 hash。';
  const repo = await _aiGitEnsureRepo();
  if (!repo.ok) return repo.error;
  
  // 先确认这个 commit/path 存在
  const showR = await callGit('show_file', { commit, path });
  if (!showR.ok) {
    return `❌ 在快照 ${commit.slice(0, 7)} 中找不到文件 ${path}：${showR.error}`;
  }
  const restoreOwnershipParams = { commit, path, files: [path] };
  if (typeof guardConcurrentFileOwnership === 'function') {
    const conflict = guardConcurrentFileOwnership('git_restore', restoreOwnershipParams, context);
    if (conflict) return `❌ ${conflict.error || '并发请求文件所有权冲突'}`;
  }
  
  // ⭐ note_restore 是危险操作（覆盖工作区文件），优先使用 _confirmDangerous（输入"我确定"）
  // 如果用户已永久授权 git_restore 类别，则跳过弹窗
  const taskAllow = getTaskAllowForChat(resolveToolChatId(context));
  const preauthed = TERMINAL_CONFIG.permanentAllow['git_restore'] || taskAllow['git_restore'];
  if (!preauthed) {
    if (typeof _confirmDangerous === 'function') {
      const ok = await _confirmDangerous({
        title: `AI 想恢复文件 ${path} 到快照 ${commit.slice(0, 7)}`,
        intro: '此操作会用历史快照中的版本覆盖当前工作区的文件。',
        lossList: [
          `${path} 中当前所有尚未提交的改动将丢失`,
          '（已提交的快照不受影响，仍可在 note_history 中找回）'
        ],
        confirmWord: '我确定',
        danger: true
      });
      if (!ok) {
        if (typeof claimConcurrentFileOwnership === 'function') {
          claimConcurrentFileOwnership('git_restore', restoreOwnershipParams, { ok: false }, context);
        }
        return '⏭️ 用户拒绝了恢复操作。';
      }
    } else {
      // fallback：普通确认弹窗
      const perm = await _aiGitCheckPermission('git_restore', '⚠️ AI 想恢复文件到历史版本',
        `[note_restore]\n🔴 这将覆盖工作区文件！\n\n文件：${path}\n恢复到快照：${commit.slice(0, 7)}\n\n注意：当前文件中尚未提交的改动会丢失。`, context);
      if (!perm.ok) {
        if (typeof claimConcurrentFileOwnership === 'function') {
          claimConcurrentFileOwnership('git_restore', restoreOwnershipParams, { ok: false }, context);
        }
        return perm.error;
      }
    }
  }
  
  // 后端 checkout_file 接受 files 数组 + commit
  const r = await callGit('checkout_file', { commit, files: [path] });
  if (!r.ok) {
    if (typeof claimConcurrentFileOwnership === 'function') {
      claimConcurrentFileOwnership('git_restore', restoreOwnershipParams, { ok: false }, context);
    }
    return `❌ 恢复失败：${r.error}`;
  }
  if (typeof claimConcurrentFileOwnership === 'function') {
    claimConcurrentFileOwnership('git_restore', restoreOwnershipParams, { ok: true, path, files: [{ path }] }, context);
  }
  return `✅ 已将 ${path} 恢复到快照 ${commit.slice(0, 7)}\n\n💡 现在该文件已与快照一致。如需保留这个回退，可调用 note_snapshot 提交。`;
}

window.aiGitStatus = aiGitStatus;
window.aiGitHistory = aiGitHistory;
window.aiGitDiff = aiGitDiff;
window.aiGitSnapshot = aiGitSnapshot;
window.aiGitRestore = aiGitRestore;

async function attachFileForAI(path, description, context) {
  const chatId = resolveToolChatId(context);
  const r = await callAgentBackend('read_file_binary', { path },
    'AI 想加载文档作为附件',
    `[加载文档] ${path}\n\n${description ? '说明：' + description + '\n\n' : ''}加载后 AI 将立即查看内容。`,
    context);
  
  if (typeof r === 'string') return r;
  if (!r.ok) return `❌ ${r.error}`;
  
  if (r.size > 20 * 1024 * 1024) {
    return `❌ 文档过大（${(r.size / 1024 / 1024).toFixed(1)} MB），超过 20MB 上限`;
  }
  
  const attachment = {
    id: 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: r.name,
    mime: r.mime,
    size: r.size,
    type: r.is_image ? 'image' : 'file',
    data: r.data,
    _fromAI: true,
    _hidden: true,
    _aiDescription: description || ''
  };

  if (context && context.concurrentChatId && context.concurrentAgentId) {
    if (r.is_image) {
      toast(`✓ 已加载图片 ${r.name}`, 1500);
    } else {
      toast(`✓ 已加载文档 ${r.name}（${(r.size / 1024).toFixed(1)} KB）`, 1500);
    }
    const agentName = context.concurrentAgentName || '当前 AI';
    return {
      ok: true,
      _concurrentAttachment: true,
      attachment,
      message: `✅ 已加载 ${r.name}（${(r.size / 1024).toFixed(1)} KB）\n\n📌 系统：附件已加入 ${agentName} 的私有上下文，下一轮可直接查看。`,
      contextText: `系统：以下附件由 attach_file 工具加载，仅供 ${agentName} 查看。${description ? '\n说明：' + description : ''}\n请结合该附件继续完成用户任务。`
    };
  }
  
  pushPendingAIAttachment(chatId, attachment);
  
  if (r.is_image) {
    toast(`✓ 已加载图片 ${r.name}`, 1500);
  } else {
    toast(`✓ 已加载文档 ${r.name}（${(r.size / 1024).toFixed(1)} KB）`, 1500);
  }
  
  if (TERMINAL_CONFIG.autoAnalyzeAfterAttach) {
    // ⭐ 大纲模式：附件由大纲循环内部消化，跳过 autoResend
    // 否则 autoResend 会在大纲结束后另起一段新 AI 回复
    const outlineTask = typeof isChatTaskMode === 'function' ? isChatTaskMode(chatId, 'outline') : state._outlineExecuting;
    if (outlineTask) {
      // 附件已存到 state.pendingAIAttachments，大纲循环下一轮会读取并注入到上下文
      return `✅ 已加载 ${r.name}（${(r.size / 1024).toFixed(1)} KB）\n\n` +
             `📌 系统：附件已加入对话上下文。如还需加载其他文件请继续调用 attach_file，否则继续推进任务。`;
    }
    scheduleAutoResend(r, description, { chatId });
    return `✅ 已加载 ${r.name}（${(r.size / 1024).toFixed(1)} KB）\n\n` +
           `📌 系统：附件已加入。如果还要加载其他文件，请继续调用 attach_file；否则简短回复完成。前端会自动重发让你看到附件。`;
  } else {
    attachment._hidden = false;
    if (chatId === state.currentId) {
      state.pendingAttachments.push(attachment);
      renderPendingAtts();
    }
    return `✅ 已加载 ${r.name}\n请告诉用户："已加载 ${r.name}，请再发一句话我就能看到了。"`;
  }
}

function scheduleAutoResend(fileInfo, description, context) {
  const chatId = resolveToolChatId(context) || 'default';
  if (!_pendingAutoResendByChat[chatId]) {
    _pendingAutoResendByChat[chatId] = {
      chatId,
      files: [],
      descriptions: []
    };
  }
  const pending = _pendingAutoResendByChat[chatId];
  pending.files.push(fileInfo);
  if (description) pending.descriptions.push(description);
  
  if (_autoResendTimersByChat[chatId]) {
    clearTimeout(_autoResendTimersByChat[chatId]);
    delete _autoResendTimersByChat[chatId];
  }
  
  _autoResendTimersByChat[chatId] = setTimeout(() => {
    delete _autoResendTimersByChat[chatId];
    tryAutoResend(chatId);
  }, 3000);
}

async function tryAutoResend(chatId) {
  chatId = chatId || resolveToolChatId() || 'default';
  const mySeq = _autoResendCancelSeqByChat[chatId] || 0;
  const isCancelled = () => mySeq !== (_autoResendCancelSeqByChat[chatId] || 0)
    || !!(typeof chatTaskById === 'function' && chatTaskById(chatId)?.stopRequested);
  const isGenerating = () => (typeof isChatGenerating === 'function')
    ? isChatGenerating(chatId)
    : (state.currentId === chatId && state.isGenerating);

  if (_autoResendInProgressByChat[chatId]) {
    console.log('[auto-resend] already running for chat:', chatId);
    return;
  }
  if (isCancelled()) return;
  if (!_pendingAutoResendByChat[chatId]) return;

  let waitCount = 0;
  const MAX_WAIT = 240;
  while (isGenerating() && waitCount < MAX_WAIT) {
    if (isCancelled()) return;
    await new Promise(r => setTimeout(r, 500));
    waitCount++;
  }
  if (isCancelled()) return;
  if (isGenerating()) return;
  if (!_pendingAutoResendByChat[chatId]) return;
  if (!pendingAIAttachmentsForChat(chatId, false).length) {
    delete _pendingAutoResendByChat[chatId];
    return;
  }

  const pending = _pendingAutoResendByChat[chatId];
  delete _pendingAutoResendByChat[chatId];
  const fileCount = pending.files.length;
  const fileNames = pending.files.map(f => f.name).join('、');
  const description = pending.descriptions.join('；');
  const internalPrompt = description
    ? `[系统：${fileCount} 个附件已加载：${fileNames}] ${description}`
    : `[系统：${fileCount} 个附件已加载：${fileNames}] 请基于已加载的附件继续完成用户的任务。`;

  _autoResendInProgressByChat[chatId] = true;
  try {
    await sendHiddenMessage(internalPrompt, pending.chatId);
  } catch (e) {
    console.error('[auto-resend] failed:', e);
    if (!(e.name === 'QuotaExceededError' || (e.message && e.message.includes('quota')))) {
      toast('自动重发失败：' + e.message, 3000);
    }
  } finally {
    delete _autoResendInProgressByChat[chatId];
    if (typeof syncGlobalTaskState === 'function') syncGlobalTaskState(chatId);
    if (typeof updateSendBtn === 'function') updateSendBtn();
  }
}
async function sendHiddenMessage(text, chatId) {
  console.log('[隐藏发送] === 开始 ===');
  console.log('[隐藏发送] 文本:', text);
  
  const c = chatId ? chatById(chatId) : currentChat();
  if (!c) {
    console.error('[隐藏发送] 没有当前对话');
    return;
  }
  
  if (!state.settings.apiKey) {
    console.error('[隐藏发送] 没有 API Key');
    toast('请先配置 API Key');
    return;
  }
  
  const attachments = takePendingAIAttachments(c.id).map(a => ({ ...a }));
  
  console.log('[隐藏发送] 待发送附件数:', attachments.length);
  
  if (attachments.length === 0) {
    console.warn('[隐藏发送] 没有附件可发送');
    return;
  }
  
  const hiddenUserMsg = {
    role: 'user',
    content: text,
    attachments: attachments,
    _hiddenFromUI: true,
    _autoResend: true
  };
  c.messages.push(hiddenUserMsg);
  
  try {
    saveData();
  } catch (e) {
    console.warn('[隐藏发送] saveData 失败（继续发送）:', e.message);
  }
  
  try {
    console.log('[隐藏发送] 调用普通 API（避免触发新 Plan/师生）...');
    // ⭐ 关键修复：永远用普通 callAPI，不要触发 Plan 或师生模式
    await callAPI(undefined, { chatId: c.id, suppressCompletionSound: true });
    console.log('[隐藏发送] ✓ API 调用完成');
  } catch (e) {
    console.error('[隐藏发送] API 出错:', e);
    throw e;
  } finally {
    state.isGenerating = false;
    state.abortCtrl = null;
    if (typeof updateSendBtn === 'function') updateSendBtn();
  }
}

function toggleAutoAnalyze() {
  TERMINAL_CONFIG.autoAnalyzeAfterAttach = !TERMINAL_CONFIG.autoAnalyzeAfterAttach;
  toast(TERMINAL_CONFIG.autoAnalyzeAfterAttach 
    ? '✓ 自动分析模式已开启' 
    : '✓ 自动分析模式已关闭', 3000);
}

function resetTaskPermission(chatId) {
  chatId = chatId || (typeof state !== 'undefined' ? state.currentId : '') || resolveToolChatId();
  // ⭐ 任务级权限按类别清空（永久权限不动）
  if (chatId) delete TERMINAL_CONFIG.taskAllowByChat[chatId];
  else {
    TERMINAL_CONFIG.taskAllow = {};
    TERMINAL_CONFIG.taskAllowByChat = {};
  }
  // ⭐ 递增取消版本，让已经启动但正在等待的 tryAutoResend 失效
  if (chatId) cancelAutoResendForChat(chatId, false);
  else _autoResendCancelSeq++;
  
  if (_autoResendTimer) {
    clearTimeout(_autoResendTimer);
    _autoResendTimer = null;
  }
  _pendingAutoResend = null;
  _autoResendInProgress = false;
}

// ⭐ 取消任何待执行的"自动重发"链路
// 暴露给 stopGenerate() / 用户手动中止流程调用，防止 attach_file 触发的
// 3 秒定时器在用户暂停后继续把附件以隐藏消息形式重新发出去（幽灵对话 bug）。
// 同时清掉 pendingAIAttachments，避免下一次正常对话被脏附件污染。
function cancelAutoResend(chatId) {
  chatId = chatId || resolveToolChatId();
  if (chatId) {
    cancelAutoResendForChat(chatId, true);
    return;
  }
  // ⭐ 递增取消版本，让已经启动但正在等待 state.isGenerating=false 的 tryAutoResend 失效
  _autoResendCancelSeq++;
  if (_autoResendTimer) {
    try { clearTimeout(_autoResendTimer); } catch (e) {}
    _autoResendTimer = null;
  }
  _pendingAutoResend = null;
  _autoResendInProgress = false;
  // 清掉 AI 准备好但尚未"自动重发"出去的隐藏附件
  if (typeof state !== 'undefined' && Array.isArray(state.pendingAIAttachments)) {
    state.pendingAIAttachments = [];
  }
  if (typeof state !== 'undefined') state.pendingAIAttachmentsByChat = {};
}
window.cancelAutoResend = cancelAutoResend;

function forceUnstuck() {
  console.log('[紧急恢复] 强制重置所有状态');
  // ⭐ 让任何已经启动的自动重发等待循环立即失效
  _autoResendCancelSeq++;
  _autoResendCancelSeqByChat = {};
  
  state.isGenerating = false;
  state.abortCtrl = null;
  state.pendingAIAttachments = [];
  state.pendingAIAttachmentsByChat = {};
  // ⭐ 之前漏了这俩，导致 forceUnstuck 后大纲/Plan 仍然卡住 onSend
  state._outlineExecuting = false;
  state._planExecuting = false;
  state._outlineForceFinish = false;
  
  if (_autoResendTimer) {
    clearTimeout(_autoResendTimer);
    _autoResendTimer = null;
  }
  _pendingAutoResend = null;
  _pendingAutoResendByChat = {};
  _autoResendInProgress = false;
  _autoResendInProgressByChat = {};
  Object.values(_autoResendTimersByChat).forEach(t => { try { clearTimeout(t); } catch (e) {} });
  _autoResendTimersByChat = {};
  
  if (typeof updateSendBtn === 'function') updateSendBtn();
  if (typeof renderPendingAtts === 'function') renderPendingAtts();
  
  toast('🔄 已强制恢复对话状态');
}

window.forceUnstuck = forceUnstuck;
