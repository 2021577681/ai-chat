// ============ 📑 大纲模式 - 核心执行逻辑 ============
// 【模块定位】主流程 + 工具处理（无 DOM 操作）
// 依赖：outline-prompts.js（OUTLINE_TOOLS / OUTLINE_TOOL_NAMES / DEFAULT_OUTLINE_SYSTEM_PROMPT）
//       state.js / api.js / tools.js / chat.js
// 加载顺序：在 outline-prompts.js 之后，outline-render.js 之前

// ⭐ 单轮 fetch 硬超时（毫秒）。即使外部 abort 信号失灵，到点也会强行抛错
// 5 分钟够长（推理模型也能跑完），但能兜住"网络层死锁"导致的永久挂起
const OUTLINE_FETCH_TIMEOUT_MS = 5 * 60 * 1000;
const OUTLINE_TOOL_TIMEOUT_MS = 90 * 1000;

function outlineToolTimeoutMs(name, args) {
  if (name === 'execute_action') {
    const commandTimeoutSec = Math.max(1, parseInt(args && args.timeout, 10) || 60);
    return Math.min(315 * 1000, (commandTimeoutSec * 1000) + 30 * 1000);
  }
  if (name === 'web_search' || name === 'fetch_url') return 150 * 1000;
  if (name === 'attach_file' || name === 'ai_screenshot') return 120 * 1000;
  return OUTLINE_TOOL_TIMEOUT_MS;
}

function outlineAbortError() {
  let err;
  try {
    err = new DOMException('用户中断', 'AbortError');
  } catch (e) {
    err = new Error('用户中断');
    err.name = 'AbortError';
  }
  return err;
}

function outlineToolTimeoutResult(name, timeoutMs) {
  const seconds = Math.round(timeoutMs / 1000);
  return {
    ok: false,
    value: {
      ok: false,
      error: `⏱️ 工具 ${name || 'unknown'} 超过 ${seconds} 秒没有返回，前端已停止等待。本次工具调用按失败处理，请换用更小的命令、new_window，或用 update_outline 记录阻塞原因。`,
      _toolTimeout: true,
      timeoutMs
    }
  };
}

async function executeOutlineToolWithTimeout(name, args, context, timeoutMs) {
  const parentSignal = context && context.signal;
  if (parentSignal && parentSignal.aborted) throw outlineAbortError();

  const ctrl = new AbortController();
  let timedOut = false;
  let timer = null;
  let parentAbortHandler = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (parentSignal && parentAbortHandler) {
      try { parentSignal.removeEventListener('abort', parentAbortHandler); } catch (e) {}
    }
    parentAbortHandler = null;
  };

  const runContext = {
    ...(context && typeof context === 'object' ? context : {}),
    signal: ctrl.signal
  };

  try {
    let abortPromise = null;
    if (parentSignal) {
      abortPromise = new Promise((resolve, reject) => {
        parentAbortHandler = () => {
          try { ctrl.abort(); } catch (e) {}
          reject(outlineAbortError());
        };
        parentSignal.addEventListener('abort', parentAbortHandler, { once: true });
      });
    }

    const timeoutPromise = new Promise(resolve => {
      timer = setTimeout(() => {
        timedOut = true;
        try { ctrl.abort(); } catch (e) {}
        resolve(outlineToolTimeoutResult(name, timeoutMs));
      }, timeoutMs);
    });

    const toolPromise = Promise.resolve()
      .then(() => executeTool(name, args, runContext))
      .catch(e => {
        if (timedOut) return outlineToolTimeoutResult(name, timeoutMs);
        if (e && e.name === 'AbortError') throw e;
        return { ok: false, value: `工具出错：${e.message || e}` };
      });

    return await Promise.race([
      toolPromise,
      timeoutPromise,
      ...(abortPromise ? [abortPromise] : [])
    ]);
  } catch (e) {
    if (timedOut) return outlineToolTimeoutResult(name, timeoutMs);
    if (e && e.name === 'AbortError') throw e;
    return { ok: false, value: `工具出错：${e.message || e}` };
  } finally {
    clear();
  }
}

function outlineExtractTaskText(history) {
  return (history || [])
    .filter(m => m && m.role === 'user')
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      try { return JSON.stringify(m.content); } catch (e) { return ''; }
    })
    .join('\n\n')
    .slice(-12000);
}

function outlineLooksLikeCodeTask(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  return /(?:代码|项目|仓库|文件|脚本|函数|类|接口|组件|页面|测试|单测|构建|编译|运行|报错|错误|异常|修复|bug|实现|重构|依赖|配置|启动|调试|code|repo|project|file|script|function|class|component|test|pytest|unittest|jest|vitest|npm|pnpm|yarn|mvn|gradle|cargo|go test|build|compile|run|error|exception|traceback|fix|bug|implement|refactor|dependency|config|debug)/i.test(t);
}

function buildOutlineSystemPrompt(basePrompt, history) {
  return buildOutlineSystemPromptForProfile(basePrompt, history, outlineFallbackTaskProfile(history));
}

function outlineFallbackTaskProfile(history, reason) {
  const taskText = outlineExtractTaskText(history);
  const looksCode = outlineLooksLikeCodeTask(taskText);
  return {
    domain: looksCode ? 'coding' : 'general',
    intent: looksCode ? 'code_change' : 'other',
    requiresCodeChange: looksCode,
    requiresVerification: looksCode,
    verificationPolicy: looksCode ? 'if_code_changed' : 'none',
    suggestedCommands: [],
    confidence: looksCode ? 0.55 : 0.45,
    reason: reason || (looksCode ? '关键词规则判断为代码相关任务。' : '关键词规则未判断为代码任务。'),
    source: 'heuristic'
  };
}

function normalizeOutlineTaskProfile(raw, history) {
  const fallback = outlineFallbackTaskProfile(history);
  const allowedDomains = new Set(['coding', 'research', 'writing', 'file_ops', 'general']);
  const allowedIntents = new Set(['read_only', 'code_change', 'debug', 'test_only', 'explain', 'other']);
  const allowedPolicies = new Set(['none', 'if_code_changed', 'after_each_code_change']);
  const profile = raw && typeof raw === 'object' ? raw : {};
  const domain = allowedDomains.has(profile.domain) ? profile.domain : fallback.domain;
  const intent = allowedIntents.has(profile.intent) ? profile.intent : fallback.intent;
  const requiresCodeChange = typeof profile.requiresCodeChange === 'boolean'
    ? profile.requiresCodeChange
    : (typeof profile.requires_code_change === 'boolean' ? profile.requires_code_change : fallback.requiresCodeChange);
  let requiresVerification = typeof profile.requiresVerification === 'boolean'
    ? profile.requiresVerification
    : (typeof profile.requires_verification === 'boolean' ? profile.requires_verification : fallback.requiresVerification);
  let verificationPolicy = allowedPolicies.has(profile.verificationPolicy)
    ? profile.verificationPolicy
    : (allowedPolicies.has(profile.verification_policy) ? profile.verification_policy : fallback.verificationPolicy);
  const confidence = Math.max(0, Math.min(1, Number(profile.confidence)));
  const suggestedRaw = Array.isArray(profile.suggestedCommands)
    ? profile.suggestedCommands
    : (Array.isArray(profile.suggested_commands) ? profile.suggested_commands : []);

  // 运行时门禁只在实际发生代码修改后触发；这里的 true 表示任务策略需要验证。
  if (verificationPolicy === 'none') requiresVerification = false;
  if (requiresVerification && verificationPolicy === 'none') verificationPolicy = 'if_code_changed';

  return {
    domain,
    intent,
    requiresCodeChange: !!requiresCodeChange,
    requiresVerification: !!requiresVerification,
    verificationPolicy,
    suggestedCommands: suggestedRaw.map(x => String(x || '').trim()).filter(Boolean).slice(0, 6),
    confidence: Number.isFinite(confidence) ? confidence : fallback.confidence,
    reason: String(profile.reason || fallback.reason || '').slice(0, 500),
    source: profile.source || 'ai'
  };
}

function parseOutlineTaskProfileJson(raw, history) {
  try {
    let txt = String(raw || '').trim();
    txt = txt.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '');
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('missing json');
    return normalizeOutlineTaskProfile(JSON.parse(m[0]), history);
  } catch (e) {
    return outlineFallbackTaskProfile(history, `AI 分类结果不可解析，回退关键词规则：${e.message || e}`);
  }
}

async function classifyOutlineTaskProfile(history, model, options = {}) {
  const taskText = outlineExtractTaskText(history);
  const prompt = outlinePromptSetting('outlineClassifierPrompt', DEFAULT_OUTLINE_CLASSIFIER_PROMPT);
  try {
    const raw = await callOnceWithRole(
      [{ role: 'user', content: `【用户任务】\n${taskText || '(空)'}` }],
      model,
      prompt,
      {
        ...options,
        sourceLabel: '大纲模式 · 任务分类'
      }
    );
    return parseOutlineTaskProfileJson(raw, history);
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    return outlineFallbackTaskProfile(history, `AI 分类调用失败，回退关键词规则：${e.message || e}`);
  }
}

function outlineShouldUseCodeProfile(taskProfile, history) {
  if (!taskProfile) return outlineLooksLikeCodeTask(outlineExtractTaskText(history));
  return taskProfile.domain === 'coding'
    || taskProfile.requiresCodeChange
    || taskProfile.requiresVerification
    || ['code_change', 'debug', 'test_only'].includes(taskProfile.intent);
}

function buildOutlineSystemPromptForProfile(basePrompt, history, taskProfile) {
  const prompt = basePrompt || DEFAULT_OUTLINE_SYSTEM_PROMPT;
  if (!outlineShouldUseCodeProfile(taskProfile, history)) return prompt;
  let extra = outlinePromptSetting('outlineCodeTaskPrompt', CODE_TASK_OUTLINE_PROFILE_PROMPT);
  if (taskProfile && taskProfile.suggestedCommands && taskProfile.suggestedCommands.length) {
    extra += `\n\n【建议验证命令】\n${taskProfile.suggestedCommands.map(x => `- ${x}`).join('\n')}`;
  }
  return prompt + extra;
}

function outlineToolCallEntries(outlineObj) {
  const entries = [];
  const collect = arr => {
    if (Array.isArray(arr)) {
      for (const x of arr) if (x && typeof x === 'object') entries.push(x);
    }
  };
  collect(outlineObj && outlineObj.globalToolCalls);
  for (const item of ((outlineObj && outlineObj.items) || [])) collect(item.toolCalls);
  return entries;
}

function outlineHasExecuteAction(outlineObj) {
  return outlineToolCallEntries(outlineObj).some(tc => tc.name === 'execute_action');
}

function outlineRecordAssistantSpeech(outlineObj, assistantMsg, round, hasToolCalls) {
  if (!outlineObj || !assistantMsg) return;
  const text = String(assistantMsg.content || '').trim();
  if (!text) return;
  const maxLen = 12000;
  const entry = {
    type: 'assistant_speech',
    round,
    text: text.length > maxLen ? text.slice(0, maxLen) + '\n\n...' : text,
    hasToolCalls: !!hasToolCalls,
    ts: Date.now()
  };
  const activeItem = ((outlineObj.items || [])).find(it => it && it.status === 'active');
  if (!activeItem && !Array.isArray(outlineObj.globalToolCalls)) outlineObj.globalToolCalls = [];
  const target = activeItem || { toolCalls: outlineObj.globalToolCalls };
  if (!Array.isArray(target.toolCalls)) target.toolCalls = [];
  target.toolCalls.push(entry);
  if (target.toolCalls.length > 120) {
    target.toolCalls = target.toolCalls.slice(-120);
  }
  if (!activeItem) outlineObj.globalToolCalls = target.toolCalls;
}

function outlineIsCodeMutationCall(tc) {
    if (!tc || !tc.name) return false;
    if (['apply_patch', 'save_note', 'edit_note', 'append_note', 'delete_note'].includes(tc.name)) {
      if (tc.name === 'apply_patch' && tc.args && tc.args.dry_run === true) return false;
      return true;
    }
    if (tc.name !== 'execute_action') return false;
    const cmd = String((tc.args && tc.args.command) || '');
    return /\b(npm|pnpm|yarn|pip)\b.*\b(add|install|remove|uninstall)\b/i.test(cmd)
      || /\b(eslint|ruff)\b.*\b--fix\b/i.test(cmd)
      || /\b(prettier)\b.*\b--write\b/i.test(cmd)
      || /\b(gofmt|rustfmt)\b.*\b-w\b/i.test(cmd)
      || /\b(npm|pnpm|yarn)\b.*\b(format|fix)\b/i.test(cmd)
      || /\b(sed|perl|powershell|python)\b.*\b(-i|set-content|out-file|writealltext|replace)\b/i.test(cmd);
}

function outlineHasCodeMutation(outlineObj) {
  return outlineToolCallEntries(outlineObj).some(outlineIsCodeMutationCall);
}

function outlineCommandSegments(command) {
  return String(command || '')
    .toLowerCase()
    .replace(/\s+\d?>&\d+\b/g, '')
    .replace(/\s+\d?>\s*(?:"[^"]*"|'[^']*'|\S+)/g, '')
    .replace(/\s+/g, ' ')
    .split(/\s*(?:&&|\|\||;|\r?\n)\s*/)
    .map(x => x.trim())
    .filter(Boolean);
}

function outlineIsWeakVerificationProbeSegment(cmd) {
  if (!cmd) return true;
  if (/^(?:where|which|command\s+-v|get-command)\b/i.test(cmd)) return true;
  if (/\b(?:--help|-h|help|--print-config|--show-config|--showconfig|--init|--env-info|--collect-only|doctor)\b/i.test(cmd)) return true;
  if (/\b(?:--version|version)\b/i.test(cmd)) return true;
  if (/^\s*(?:npm|pnpm|yarn|node|python|python3|go|cargo|mvn|gradle|eslint|tsc|vue-tsc)\s+-v\b/i.test(cmd)) return true;
  if (/^\s*(?:npm|pnpm|yarn)\s+(?:info|view|config|list|why|outdated)\b/i.test(cmd)) return true;
  return false;
}

function outlineLooksLikeVerificationSegment(cmd) {
  if (outlineIsWeakVerificationProbeSegment(cmd)) return false;
  if (/\b(?:npm|pnpm|yarn)\s+(?:test|build|lint|check|typecheck|compile)\b/i.test(cmd)) return true;
  if (/\b(?:npm|pnpm|yarn)\s+run\s+[-\w:]*?(?:test|build|lint|check|typecheck|compile)[-\w:]*\b/i.test(cmd)) return true;
  if (/\b(?:pytest|unittest|jest|vitest|mocha|ava|phpunit|rspec)\b/i.test(cmd)) return true;
  if (/\b(?:python|python3|py)\s+-m\s+(?:pytest|unittest|doctest|mypy|ruff|flake8|py_compile|compileall)\b/i.test(cmd)) return true;
  if (/\b(?:python|python3|py)\s+(?:-c\b|-\s*<<)\b/i.test(cmd)) return true;
  if (/\b(?:python|python3|py)\s+(?!(?:-m|-c|-v|--version|--help)\b)(?:"[^"]+\.py"|'[^']+\.py'|[^\s;&|]+\.py)(?=$|\s|[;&|])/i.test(cmd)) return true;
  if (/\bnode\s+--check\b/i.test(cmd)) return true;
  if (/\bnode\s+(?!(?:--check|-v|--version|--help)\b)(?:"[^"]+\.m?js"|'[^']+\.m?js'|[^\s;&|]+\.m?js)\b/i.test(cmd)) return true;
  if (/\bgo\s+test\b/i.test(cmd)) return true;
  if (/\bgo\s+run\b/i.test(cmd)) return true;
  if (/\bcargo\s+(?:test|check|build|clippy)\b/i.test(cmd)) return true;
  if (/\bcargo\s+run\b/i.test(cmd)) return true;
  if (/\b(?:mvn|gradle)\b.*\b(?:test|check|build|compile)\b/i.test(cmd)) return true;
  if (/\b(?:tsc|vue-tsc)\b/i.test(cmd)) return true;
  if (/\b(?:eslint|ruff|flake8|mypy|pyright|biome|stylelint)\b/i.test(cmd)) return true;
  if (/\b(?:make|cmake)\b.*\b(?:test|check|build|compile)\b/i.test(cmd)) return true;
  return /\b(?:test|build|lint|typecheck|check|compile)\b/i.test(cmd)
    && /\b(?:npm|pnpm|yarn|python|python3|node|go|cargo|mvn|gradle|make|cmake|pytest|jest|vitest|tsc|eslint|ruff|flake8|mypy|pyright|biome)\b/i.test(cmd);
}

function outlineLooksLikeVerificationCommand(command) {
  return outlineCommandSegments(command).some(outlineLooksLikeVerificationSegment);
}

function outlineExecuteIntent(tc) {
  return String((tc && tc.args && tc.args.intent) || '').trim().toLowerCase();
}

function outlineIsVerifyIntentToolCall(tc) {
  if (!tc || tc.name !== 'execute_action') return false;
  if (outlineExecuteIntent(tc) !== 'verify') return false;
  if (outlineCommandSegments(tc.args && tc.args.command).some(outlineIsWeakVerificationProbeSegment)) return false;
  const result = tc.rawResult;
  return !!(result && Number(result.returncode) === 0);
}

function outlineLooksLikePassedVerificationOutput(tc) {
  const result = tc && tc.rawResult;
  if (!result || Number(result.returncode) !== 0) return false;
  const text = String(result.stdout || result.stderr || result.value || result.text || '').toLowerCase();
  if (!text) return false;
  return /\b(pass|passed|success|successful|ok|all tests passed|tests? passed)\b/i.test(text)
    || /(?:通过|成功|全部通过|测试通过|验证通过)/i.test(text);
}

function outlineVerificationState(outlineObj) {
  const entries = outlineToolCallEntries(outlineObj)
    .map((tc, idx) => ({ tc, idx, ts: Number(tc && tc._ts) || idx }));
  const mutationEntries = entries.filter(x => outlineIsCodeMutationCall(x.tc));
  const lastMutation = mutationEntries.length ? mutationEntries[mutationEntries.length - 1] : null;
  const executeEntries = entries.filter(x => x.tc && x.tc.name === 'execute_action');
  const verificationEntries = executeEntries.filter(x =>
    outlineIsVerifyIntentToolCall(x.tc)
    || outlineLooksLikeVerificationCommand(x.tc.args && x.tc.args.command)
    || outlineLooksLikePassedVerificationOutput(x.tc)
  );
  const afterMutation = lastMutation
    ? verificationEntries.filter(x => x.ts > lastMutation.ts || (x.ts === lastMutation.ts && x.idx > lastMutation.idx))
    : verificationEntries;
  const passedAfterMutation = afterMutation.filter(x => {
    const rc = x.tc.rawResult && Number.isFinite(Number(x.tc.rawResult.returncode))
      ? Number(x.tc.rawResult.returncode)
      : null;
    return rc === 0;
  });
  const lastVerification = verificationEntries.length ? verificationEntries[verificationEntries.length - 1].tc : null;
  const lastAfterMutation = afterMutation.length ? afterMutation[afterMutation.length - 1].tc : null;
  return {
    hasMutation: !!lastMutation,
    lastMutation: lastMutation ? lastMutation.tc : null,
    hasExecute: executeEntries.length > 0,
    hasVerification: verificationEntries.length > 0,
    hasVerificationAfterMutation: afterMutation.length > 0,
    hasPassedVerificationAfterMutation: passedAfterMutation.length > 0,
    lastVerification,
    lastVerificationAfterMutation: lastAfterMutation,
    lastVerificationReturncode: lastAfterMutation && lastAfterMutation.rawResult ? lastAfterMutation.rawResult.returncode : null
  };
}

function outlineHasVerificationBlocker(outlineObj) {
  const text = ((outlineObj && outlineObj.items) || [])
    .map(it => `${it.title || ''}\n${it.note || ''}`)
    .join('\n')
    .toLowerCase();
  return /(?:无法运行|不能运行|未能运行|无法执行|不能执行|缺少依赖|缺依赖|缺少配置|缺配置|权限不足|环境限制|没有测试|无测试|阻塞|blocked|cannot run|can't run|unable to run|missing dependency|missing config|permission denied|environment limitation|no test)/i.test(text);
}

function outlineCodeGateNeedsVerification(outlineObj, taskProfile) {
  if (!taskProfile || !taskProfile.requiresVerification || outlineHasVerificationBlocker(outlineObj)) return false;
  const state = outlineVerificationState(outlineObj);
  return state.hasMutation && !state.hasPassedVerificationAfterMutation;
}

function outlineCodeGateMessage(outlineObj) {
  const st = outlineVerificationState(outlineObj);
  if (!st.hasMutation) return '';
  if (!st.hasVerification) {
    return outlinePromptText('outlineGateNoVerifyPrompt', DEFAULT_OUTLINE_GATE_NO_VERIFY_PROMPT);
  }
  if (!st.hasVerificationAfterMutation) {
    return outlinePromptText('outlineGateStaleVerifyPrompt', DEFAULT_OUTLINE_GATE_STALE_VERIFY_PROMPT);
  }
  return outlinePromptText('outlineGateFailedVerifyPrompt', DEFAULT_OUTLINE_GATE_FAILED_VERIFY_PROMPT, {
    returncode: st.lastVerificationReturncode ?? '?'
  });
}

function outlineNormalizePatchPath(path) {
  let p = String(path || '').replace(/\\/g, '/');
  const root = (typeof window !== 'undefined' && window.TERMINAL_CONFIG && window.TERMINAL_CONFIG.workspace) || '';
  if (root) {
    const normRoot = String(root).replace(/\\/g, '/').replace(/\/+$/, '');
    if (p.toLowerCase().startsWith(normRoot.toLowerCase() + '/')) {
      p = p.slice(normRoot.length + 1);
    }
  }
  p = p.replace(/^[a-z]:\//i, '').replace(/^\/+/, '');
  const idx = p.lastIndexOf('/agent/');
  if (idx >= 0) p = p.slice(idx + '/agent/'.length);
  return p || String(path || '');
}

function outlineBuildDiffSummary(outlineObj) {
  const map = new Map();
  const addFile = (path, added, removed, source, action) => {
    if (!path) return;
    const key = outlineNormalizePatchPath(path);
    const cur = map.get(key) || { path: key, added: 0, removed: 0, sources: new Set(), actions: [] };
    cur.added += Math.max(0, parseInt(added) || 0);
    cur.removed += Math.max(0, parseInt(removed) || 0);
    if (source) cur.sources.add(source);
    if (action) cur.actions.push(String(action));
    map.set(key, cur);
  };

  for (const tc of outlineToolCallEntries(outlineObj)) {
    if (!tc || tc.ok === false || tc._running) continue;
    if (tc.name === 'apply_patch' && tc.args && tc.args.dry_run === true) continue;
    const files = (tc.rawResult && Array.isArray(tc.rawResult.files)) ? tc.rawResult.files : [];
    if (files.length) {
      for (const f of files) addFile(f.path, f.added, f.removed, tc.name, f.action);
    } else if (['save_note', 'edit_note', 'append_note', 'delete_note'].includes(tc.name)) {
      const path = (tc.args && tc.args.path) || '';
      addFile(path, 0, 0, tc.name, tc.name === 'delete_note' ? 'deleted' : 'modified');
    }
  }

  const files = Array.from(map.values()).map(x => ({
    path: x.path,
    added: x.added,
    removed: x.removed,
    net: x.added - x.removed,
    sources: Array.from(x.sources),
    actions: x.actions
  })).filter(f => {
    const hasCreate = f.actions.some(a => /create|创建/i.test(a));
    const hasDelete = f.actions.some(a => /delete|deleted|删除/i.test(a));
    if (hasCreate && hasDelete) return false;
    return true;
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (!files.length) return null;
  return {
    files,
    totalFiles: files.length,
    totalAdded: files.reduce((sum, f) => sum + f.added, 0),
    totalRemoved: files.reduce((sum, f) => sum + f.removed, 0)
  };
}

function outlineResponsesUserContentParts(content) {
  const parts = [];
  const addText = (text) => {
    const value = String(text || '');
    if (value) parts.push({ type: 'input_text', text: value });
  };
  for (const part of (Array.isArray(content) ? content : [])) {
    if (!part) continue;
    if (typeof part === 'string') {
      addText(part);
    } else if (part.type === 'input_text') {
      addText(part.text);
    } else if (part.type === 'text') {
      addText(part.text);
    } else if (part.type === 'image_url') {
      const url = part.image_url && (part.image_url.url || part.image_url);
      if (url) parts.push({ type: 'input_image', image_url: url });
    } else if (part.type === 'input_image' || part.type === 'input_file') {
      parts.push(part);
    } else if (part.type === 'image' && part.source && part.source.type === 'base64') {
      const mediaType = part.source.media_type || 'image/png';
      const data = part.source.data || '';
      if (data) parts.push({ type: 'input_image', image_url: `data:${mediaType};base64,${data}` });
    } else if (part.text) {
      addText(part.text);
    } else {
      try { addText(JSON.stringify(part)); } catch (e) {}
    }
  }
  return parts;
}

function outlineBuildResponsesInput(history, conversationMessages) {
  const out = [];
  const appendViaAdapter = (msg) => {
    if (!msg) return;
    if (typeof buildOpenAIResponsesInput === 'function') {
      out.push(...buildOpenAIResponsesInput([msg], { includeResponseGuard: false }));
    } else {
      out.push(msg);
    }
  };
  const all = [...(history || []), ...(conversationMessages || [])];
  for (const msg of all) {
    if (!msg || typeof msg !== 'object' || msg._isCompressing) continue;
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const parts = outlineResponsesUserContentParts(msg.content);
      out.push({ role: 'user', content: parts.length ? parts : '' });
    } else {
      appendViaAdapter(msg);
    }
  }
  return out;
}

function outlineNormalizeUsage(usage) {
  return state.settings.apiFormat === 'responses' && typeof normalizeResponsesUsage === 'function'
    ? normalizeResponsesUsage(usage)
    : usage;
}

function outlineToolResultText(result) {
  const value = result && result.value;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.error === 'string') return value.error;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }
  return value === undefined ? '' : String(value);
}

function outlineToolResultOutcome(result, content) {
  const value = result && result.value;
  const isObject = value && typeof value === 'object';
  const text = String(content || '');
  const stopAll = !!(isObject && value._stopAll)
    || /(?:🛑|用户拒绝).*?(?:停止|后续|所有)/.test(text);
  const userRejected = !!(isObject && value._userRejected)
    || /(?:⏭️|用户拒绝此次|用户拒绝此操作|用户拒绝了此操作)/.test(text);
  const valueFailed = !!(isObject && value.ok === false);
  return {
    ok: !!(result && result.ok) && !stopAll && !userRejected && !valueFailed,
    stopAll,
    userRejected
  };
}

// ⭐ 直接复用 api-core.js 的 _apiFetchWithTimeout —— 这样大纲模式自动享受：
//    ① 本地代理（绕过 CORS）
//    ② TypeError → 人话错误的翻译
//    ③ 与对话模式完全一致的网络层行为
// 之前自己实现的版本因为没经过代理，会直连第三方 → file:// 下 100% CORS 失败
function _outlineFetchWithTimeout(url, init, externalSignal, timeoutMs) {
  if (typeof _apiFetchWithTimeout === 'function') {
    return _apiFetchWithTimeout(url, init, externalSignal, timeoutMs || OUTLINE_FETCH_TIMEOUT_MS);
  }
  // 兜底：万一 api-core.js 没加载（不该发生），退回最朴素的直连版本
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs || OUTLINE_FETCH_TIMEOUT_MS);
  let externalAbortHandler = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      timeoutCtrl.abort();
    } else {
      externalAbortHandler = () => timeoutCtrl.abort();
      externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }
  }
  const merged = { ...(init || {}), signal: timeoutCtrl.signal };
  return fetch(url, merged).finally(() => {
    clearTimeout(timer);
    if (externalSignal && externalAbortHandler) {
      externalSignal.removeEventListener('abort', externalAbortHandler);
    }
  }).catch(e => {
    if (e.name === 'AbortError' && externalSignal && !externalSignal.aborted) {
      const err = new Error(`⏱ 请求超时（${Math.round((timeoutMs || OUTLINE_FETCH_TIMEOUT_MS) / 1000)}s 无响应）。可能是网络问题或模型卡死，已自动中断。`);
      err.name = 'TimeoutError';
      throw err;
    }
    throw e;
  });
}

// ⭐ 大纲模式的"带重试 fetch+解析" helper
// 直接复用 api-core.js 的 _isRetryableError / _retryDelay / _sleepAbortable
// 失败时把"正在重试"信息通过 onProgress 回写给 UI
async function _outlineFetchJsonWithRetry(url, init, abortSignal, onProgress) {
  const s = state.settings;
  const maxAttempts = retryMaxAttemptsToTotalAttempts(s.retryMaxAttempts);
  const maxAttemptsLabel = retryTotalAttemptsLabel(maxAttempts);
  const baseDelay = Math.max(100, parseInt(s.retryBaseDelayMs) || 1000);
  let lastErr = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let httpStatus = 0;
    let retryAfter = null;
    try {
      const resp = await _outlineFetchWithTimeout(url, init, abortSignal, OUTLINE_FETCH_TIMEOUT_MS);
      if (typeof recordRequest === 'function') recordRequest();
      if (!resp.ok) {
        httpStatus = resp.status;
        retryAfter = resp.headers.get('retry-after');
        const t = await resp.text();
        const err = new Error(`HTTP ${resp.status}: ${t.slice(0, 300)}`);
        err.httpStatus = resp.status;
        err.retryAfter = retryAfter;
        throw err;
      }
      const _rawText = await resp.text();
      let j;
      try { j = JSON.parse(_rawText); }
      catch (e) { throw new Error('JSON 解析失败：' + _rawText.slice(0, 300)); }
      if (j.error) throw new Error(`API 错误：${j.error.message || JSON.stringify(j.error)}`);
      return { resp, rawText: _rawText, json: j };
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError' || (abortSignal && abortSignal.aborted)) throw e;
      const retryable = (typeof _isRetryableError === 'function')
        ? _isRetryableError(e, httpStatus || e.httpStatus, abortSignal)
        : false;
      const remaining = maxAttempts - attempt;
      if (!retryable || remaining <= 0) throw e;
      const wait = (typeof _retryDelay === 'function')
        ? _retryDelay(attempt, retryAfter || e.retryAfter, baseDelay)
        : (baseDelay * Math.pow(2, attempt - 1));
      console.warn(`[outline] 第 ${attempt}/${maxAttemptsLabel} 次失败：${e.message}\n  → ${wait}ms 后重试`);
      if (typeof onProgress === 'function') {
        onProgress(`🔁 第 ${attempt} 次失败，${Math.round(wait / 1000) || 1}s 后重试…（${e.message.split('\n')[0].slice(0, 80)}）`);
      }
      if (typeof _sleepAbortable === 'function') {
        await _sleepAbortable(wait, abortSignal);
      } else {
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr || new Error('未知错误');
}

// ============ 主流程 ============
// options:
//   - resumeFromMsgIdx: number  从该消息的 outline._snap 恢复执行
//   - userInjection: string     恢复时注入的用户留言

async function callAPIWithOutline(options = {}) {
  const requestedChatId = options && options.chatId;
  const c = requestedChatId ? chatById(requestedChatId) : currentChat();
  if (!c) return;
  const taskChatId = c.id;
  const s = state.settings;
  const taskUseTools = options.useTools !== undefined ? !!options.useTools : !!s.useTools;
  const suppressCompletionSound = !!options.suppressCompletionSound;
  if (((typeof isChatGenerating === 'function') ? isChatGenerating(taskChatId) : !!state.isGenerating)) {
    if (typeof toast === 'function' && isCurrentChat(taskChatId)) toast('此对话已有任务正在执行，请稍等');
    return;
  }
  
  let abortCtrl = new AbortController();
  const task = (typeof beginChatTask === 'function')
    ? beginChatTask(taskChatId, abortCtrl, { resetStop: true })
    : null;
  if (task && typeof setChatTaskMode === 'function') {
    setChatTaskMode(taskChatId, 'outline', { outlineForceFinish: false });
    if (typeof updateChatTaskController === 'function') updateChatTaskController(taskChatId, abortCtrl);
  } else {
    state.isGenerating = true;
    state.activeTaskChatId = taskChatId;
    state.abortCtrl = abortCtrl;
    state._outlineExecuting = true;
  }
  // ⭐ 清零软停止标志：本次任务是新的开始，不要被上次残留的停止意图误杀
  state.stopRequested = false;
  if (typeof updateSendBtn === 'function') updateSendBtn();
  if (typeof renderChatList === 'function') renderChatList();
  
  let aiMsg, msgIdx;
  let conversationMessages, finalAnswer, completedNaturally, taskProfile;
  let startLoop, model, systemPrompt, maxRounds, history;
  let stoppedByToolPolicy = false;

  // 实时把状态写入 outline._snap，方便暂停/异常/强制中断后恢复。
  const saveSnap = (nextLoop) => {
    if (!aiMsg || !aiMsg.outline) return;
    aiMsg.outline._snap = {
      conversationMessages: (conversationMessages || []).slice(),
      finalAnswer: finalAnswer || '',
      nextLoop,
      model,
      systemPrompt,
      maxRounds,
      history,
      taskProfile
    };
  };

  if (options.resumeFromMsgIdx !== undefined) {
    // ===== 恢复模式 =====
    msgIdx = options.resumeFromMsgIdx;
    aiMsg = c.messages[msgIdx];
    if (!aiMsg || !aiMsg.outline || !aiMsg.outline._snap) {
      if (typeof clearChatTask === 'function') clearChatTask(taskChatId);
      else {
        state.isGenerating = false;
        state.abortCtrl = null;
        if (state.activeTaskChatId === taskChatId) state.activeTaskChatId = null;
        state._outlineExecuting = false;
      }
      if (typeof updateSendBtn === 'function') updateSendBtn();
      if (typeof toast === 'function') toast('❌ 该任务无法恢复（状态已丢失，请重新提问）', 4000);
      return;
    }
    const snap = aiMsg.outline._snap;
    conversationMessages = snap.conversationMessages.slice();
    finalAnswer = snap.finalAnswer || '';
    startLoop = snap.nextLoop || 0;
    model = snap.model;
    systemPrompt = snap.systemPrompt;
    maxRounds = snap.maxRounds;
    history = snap.history;
    taskProfile = snap.taskProfile || outlineFallbackTaskProfile(snap.history || history || [], '旧任务快照缺少 taskProfile，已回退关键词规则。');
    aiMsg.outline.taskProfile = taskProfile;
    completedNaturally = false;
    
    // 注入用户留言
    if (options.userInjection && options.userInjection.trim()) {
      const injectMsg = outlinePromptText('outlineUserInjectionPrompt', DEFAULT_OUTLINE_USER_INJECTION_PROMPT, {
        message: options.userInjection.trim()
      });
      conversationMessages.push({ role: 'user', content: injectMsg });
      if (!Array.isArray(aiMsg.outline.injections)) aiMsg.outline.injections = [];
      aiMsg.outline.injections.push({
        round: aiMsg.outline.rounds || 0,
        text: options.userInjection.trim(),
        ts: Date.now()
      });
    }
    
    // 切回 running 状态
    aiMsg.outline.status = 'running';
    aiMsg.outline.inProgress = true;
    aiMsg.outline.progressText = '🔄 恢复执行中...';
    aiMsg.outline.expanded = true;
    // 清掉之前 paused 时追加的 "[已停止]" 尾巴
    if (aiMsg.content && aiMsg.content.endsWith('*[已停止]*')) {
      aiMsg.content = aiMsg.content.replace(/\n*\*\[已停止\]\*$/, '');
    }
    if (typeof resumeMsgTimer === 'function') resumeMsgTimer(aiMsg);
    else delete aiMsg._endTime;
    if (typeof refreshMsgNode === 'function') refreshMsgNode(msgIdx, c);
    
  } else {
    // ===== 新建模式 =====
    aiMsg = {
      role: 'assistant',
      content: '',
      _startTime: Date.now(),
      outline: {
        status: 'running',
        items: [],
        globalToolCalls: [],
        rounds: 0,
        maxRounds: parseInt(s.outlineMaxRounds) || 30,
        inProgress: true,
        progressText: '🧠 思考中...',
        expanded: true,
        stalledRounds: 0,
        injections: [],
        _userQuestion: extractUserQuestion(c.messages)
      }
    };
    c.messages.push(aiMsg);
    msgIdx = c.messages.length - 1;
    
    if (typeof appendMsgNode === 'function') {
      appendMsgNode(msgIdx, c);
    } else if (typeof renderMessages === 'function') {
      if (isCurrentChat(c)) renderMessages();
    }
    
    history = c.messages.slice(0, -1);
    model = (s.outlineModel || '').trim() || s.currentModel;
    maxRounds = aiMsg.outline.maxRounds;
    conversationMessages = [];
    finalAnswer = '';
    completedNaturally = false;
    startLoop = 0;
    taskProfile = outlineFallbackTaskProfile(history, '任务分类尚未完成，已建立初始恢复点。');
    systemPrompt = buildOutlineSystemPromptForProfile(s.outlineSystemPrompt || DEFAULT_OUTLINE_SYSTEM_PROMPT, history, taskProfile);
    saveSnap(0);
    aiMsg.outline.progressText = '🧭 识别任务类型...';
    if (typeof refreshMsgNode === 'function') refreshMsgNode(msgIdx, c);
    try {
      taskProfile = await classifyOutlineTaskProfile(history, model, {
        chatId: taskChatId,
        chat: c,
        signal: abortCtrl.signal,
        isStopped: () => task ? !!task.stopRequested : !!state.stopRequested
      });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        if (aiMsg.outline.status === 'error') {
          aiMsg.outline.inProgress = false;
          delete aiMsg.outline.progressText;
          if (!aiMsg._endTime) aiMsg._endTime = Date.now();
          if (typeof clearChatTask === 'function') clearChatTask(taskChatId);
          if (typeof updateSendBtn === 'function') updateSendBtn();
          if (typeof renderChatList === 'function') renderChatList();
          if (typeof refreshMsgNode === 'function') refreshMsgNode(msgIdx, c);
          saveData();
          return;
        }
        aiMsg.content = (aiMsg.content || '') + '\n\n*[任务分类已停止]*';
        aiMsg.outline.status = 'cancelled';
        aiMsg.outline.inProgress = false;
        delete aiMsg.outline.progressText;
        if (!aiMsg._endTime) aiMsg._endTime = Date.now();
        if (typeof clearChatTask === 'function') clearChatTask(taskChatId);
        if (typeof updateSendBtn === 'function') updateSendBtn();
        if (typeof renderChatList === 'function') renderChatList();
        if (typeof refreshMsgNode === 'function') refreshMsgNode(msgIdx, c);
        saveData();
        return;
      }
      taskProfile = outlineFallbackTaskProfile(history, `AI 分类调用失败，回退关键词规则：${e.message || e}`);
    }
    aiMsg.outline.taskProfile = taskProfile;
    systemPrompt = buildOutlineSystemPromptForProfile(s.outlineSystemPrompt || DEFAULT_OUTLINE_SYSTEM_PROMPT, history, taskProfile);
    saveSnap(startLoop);
  }
  
  const onUpdate = () => {
    if (typeof updateOutlinePanel === 'function') updateOutlinePanel(msgIdx, c);
  };
  
  let abortSignal = abortCtrl.signal;
  const throwIfAborted = () => {
    // ⭐ 同时检查两种停止信号：
    //   - abortSignal.aborted：fetch / sleep 等异步操作的标准中断
    //   - state.stopRequested：跨 abortCtrl 重建边界的"软停止"，
    //     用户点暂停后即使本轮 fetch 已经结束，下一轮也能立刻退出
    const stopRequested = task ? task.stopRequested : state.stopRequested;
    if (abortSignal.aborted || stopRequested) {
      const err = new Error('用户中断');
      err.name = 'AbortError';
      throw err;
    }
  };
  
  try {
    for (let loop = startLoop; loop < maxRounds; loop++) {
      throwIfAborted();
      saveSnap(loop);
      
      aiMsg.outline.rounds = loop + 1;
      const remaining = maxRounds - loop;  // 包含本轮的剩余轮数
      aiMsg.outline.progressText = `🧠 第 ${loop + 1}/${maxRounds} 轮 · 思考中...`;
      onUpdate();
      
      // 🛡️ 第一层 + 第二层：根据剩余轮数注入分级提醒
      // 仅在剩余 ≤ 一半时开始提示，避免前期占用上下文
      // 注意：每轮只注入一次，且不重复历史提醒（用 _lastBudgetWarn 记录最后一次警告等级）
      const halfPoint = Math.ceil(maxRounds / 2);
      let warnLevel = 0;  // 0=无 1=温和 2=警告 3=紧急
      if (remaining <= 2) warnLevel = 3;
      else if (remaining <= 5) warnLevel = 2;
      else if (remaining <= halfPoint) warnLevel = 1;
      
      if (warnLevel > 0 && warnLevel !== aiMsg.outline._lastBudgetWarn) {
        let warnMsg = '';
        if (warnLevel === 1) {
          warnMsg = outlinePromptText('outlineBudgetHalfPrompt', DEFAULT_OUTLINE_BUDGET_HALF_PROMPT, { remaining, maxRounds, round: loop + 1 });
        } else if (warnLevel === 2) {
          warnMsg = outlinePromptText('outlineBudgetLowPrompt', DEFAULT_OUTLINE_BUDGET_LOW_PROMPT, { remaining, maxRounds, round: loop + 1 });
        } else if (warnLevel === 3) {
          warnMsg = outlinePromptText('outlineBudgetCriticalPrompt', DEFAULT_OUTLINE_BUDGET_CRITICAL_PROMPT, { remaining, maxRounds, round: loop + 1 });
        }
        conversationMessages.push({ role: 'user', content: warnMsg });
        aiMsg.outline._lastBudgetWarn = warnLevel;
      }
      
      // 🛡️ 第二层加强：最后 1 轮强制禁用工具；代码验证门禁未满足时仍允许工具。
      const verificationGateOpen = outlineCodeGateNeedsVerification(aiMsg.outline, taskProfile);
      const forceNoTools = (remaining <= 1 && !verificationGateOpen);
      
      // ----- 构造请求 -----
      const tools = forceNoTools ? [] : buildOutlineTools({ useTools: taskUseTools });
      let body;
      const buildOutlineRoundBody = () => {
        const safeHistory = typeof privacyGuardPrepareHistory === 'function'
          ? privacyGuardPrepareHistory(history, { format: s.apiFormat || 'openai' })
          : history;
        const safeConversationMessages = typeof privacyGuardPrepareHistory === 'function'
          ? privacyGuardPrepareHistory(conversationMessages, { format: s.apiFormat || 'openai' })
          : conversationMessages;
        const safeSystemPrompt = typeof privacyGuardSanitizeAuxiliarySystemText === 'function'
          ? privacyGuardSanitizeAuxiliarySystemText(typeof withActiveSkillPrompt === 'function' ? withActiveSkillPrompt(systemPrompt) : systemPrompt)
          : (typeof withActiveSkillPrompt === 'function' ? withActiveSkillPrompt(systemPrompt) : systemPrompt);
      
      if (s.apiFormat === 'anthropic') {
        const baseMsgs = (typeof buildAnthropicMessages === 'function') 
          ? buildAnthropicMessages(safeHistory, { includeResponseGuard: false }) : [];
        const allMsgs = [...baseMsgs];
        
        for (const m of safeConversationMessages) {
          if (m.role === 'assistant') {
            const parts = [];
            if (m.content && m.content.trim()) parts.push({ type: 'text', text: m.content });
            if (m.tool_calls) {
              for (const tc of m.tool_calls) {
                let input = {};
                try { input = JSON.parse(tc.function?.arguments || '{}'); } catch (e) {}
                parts.push({ type: 'tool_use', id: tc.id, name: tc.function?.name || '', input });
              }
            }
            allMsgs.push({ role: 'assistant', content: parts });
          } else if (m.role === 'tool') {
            const part = {
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
            };
            const last = allMsgs[allMsgs.length - 1];
            if (last && last.role === 'user' && Array.isArray(last.content)) {
              last.content.push(part);
            } else {
              allMsgs.push({ role: 'user', content: [part] });
            }
          } else if (m.role === 'user') {
            // 系统插入的提示 / 用户中途留言 / 附件注入（可能是字符串或数组）
            // Anthropic 要求 user/assistant 交替，若上一条也是 user 数组则合并
            const last = allMsgs[allMsgs.length - 1];
            const contentParts = Array.isArray(m.content) 
              ? m.content 
              : [{ type: 'text', text: String(m.content || '') }];
            if (last && last.role === 'user' && Array.isArray(last.content)) {
              last.content.push(...contentParts);
            } else if (last && last.role === 'user' && typeof last.content === 'string') {
              // 转成数组合并
              last.content = [{ type: 'text', text: last.content }, ...contentParts];
            } else {
              allMsgs.push({ role: 'user', content: contentParts });
            }
          }
        }
        
        const fixedMsgs = (typeof fixAnthropicMessageSequence === 'function')
          ? fixAnthropicMessageSequence(allMsgs)
          : allMsgs;
        body = {
          model,
          messages: fixedMsgs,
          max_tokens: parseInt(s.maxTokens),
          temperature: parseFloat(s.temperature),
          stream: false,
          system: safeSystemPrompt
        };
        if (tools.length) body.tools = tools;
      } else if (s.apiFormat === 'responses') {
        body = {
          model,
          input: outlineBuildResponsesInput(safeHistory, safeConversationMessages),
          instructions: safeSystemPrompt,
          temperature: parseFloat(s.temperature),
          max_output_tokens: parseInt(s.maxTokens),
          stream: false
        };
        if (tools.length) body.tools = tools;
      } else {
        const baseMsgs = (typeof buildOpenAIMessages === 'function')
          ? buildOpenAIMessages(safeHistory, { includeResponseGuard: false }).filter(m => m.role !== 'system') : [];
        const allMsgs = [
          { role: 'system', content: safeSystemPrompt },
          ...baseMsgs,
          ...safeConversationMessages
        ];
        const fixedMsgs = (typeof fixOpenAIMessageSequence === 'function')
          ? fixOpenAIMessageSequence(allMsgs)
          : allMsgs;
        body = {
          model,
          messages: fixedMsgs,
          temperature: parseFloat(s.temperature),
          max_tokens: parseInt(s.maxTokens),
          stream: false
        };
        if (tools.length) body.tools = tools;
      }
      return body;
      };
      body = typeof withPrivacyGuardRequest === 'function'
        ? withPrivacyGuardRequest(buildOutlineRoundBody, { source: 'outline', silentReport: true })
        : buildOutlineRoundBody();
      
      if (typeof ensureContextBeforeAgentRun === 'function') {
        aiMsg.outline.progressText = `🗜️ 第 ${loop + 1}/${maxRounds} 轮 · 检查上下文...`;
        onUpdate();
        const ok = await ensureContextBeforeAgentRun(c, {
          label: '大纲模式',
          extraMessages: conversationMessages,
          mutableMessages: conversationMessages,
          chat: c,
          chatId: taskChatId,
          signal: abortSignal,
          isStopped: () => task ? !!task.stopRequested : !!state.stopRequested
        });
        if (!ok) throw new Error('自动压缩失败，已暂停大纲模式请求');
      }
      
      // ----- 限速 -----
      if (typeof applyRateLimit === 'function') {
        aiMsg.outline.progressText = `⏳ 第 ${loop + 1}/${maxRounds} 轮 · 等待 API 配额...`;
        onUpdate();
        await applyRateLimit(abortSignal);
      }
      
      throwIfAborted();
      
      aiMsg.outline.progressText = `🌐 第 ${loop + 1}/${maxRounds} 轮 · 等待响应...`;
      onUpdate();
      
      const url = buildFullUrl(s.baseUrl, s.apiPath);
      const { resp, rawText: _rawText, json: j } = await _outlineFetchJsonWithRetry(url, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(body)
      }, abortSignal, (msg) => {
        aiMsg.outline.progressText = `第 ${loop + 1}/${maxRounds} 轮 · ${msg}`;
        onUpdate();
      });
      
      // ⭐ 记录原始响应（供 JSON 查看器使用）
      if (typeof recordRawResponse === 'function') {
        recordRawResponse({
          ts: Date.now(),
          isStream: false,
          contentType: resp.headers.get('content-type') || '',
          raw: _rawText,
          parsedJson: j,
          usage: j.usage || null,
          request: { url, method: 'POST', headers: buildHeaders(), body },
          _source: `大纲模式 · 第 ${loop + 1} 轮`
        });
      }
      
      // ⭐ 把大纲模式每轮 usage 计入当前对话统计（之前漏算）
      const usageForRecord = outlineNormalizeUsage(j.usage);
      if (usageForRecord && typeof recordUsageFromResponse === 'function') {
        recordUsageFromResponse(c, usageForRecord, { model });
      }
      
      // ----- 解析返回 -----
      let assistantMsg;
      let toolCalls = null;
      
      if (s.apiFormat === 'anthropic') {
        const contents = j.content || [];
        const text = contents.filter(p => p.type === 'text').map(p => p.text).join('');
        const toolUses = contents.filter(p => p.type === 'tool_use');
        assistantMsg = { role: 'assistant', content: text };
        if (toolUses.length) {
          toolCalls = toolUses.map(tu => ({
            id: tu.id, type: 'function',
            function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) }
          }));
          assistantMsg.tool_calls = toolCalls;
        }
      } else if (s.apiFormat === 'responses') {
        const text = (typeof extractResponsesText === 'function') ? extractResponsesText(j) : '';
        const responseToolCalls = (typeof extractResponsesToolCalls === 'function')
          ? extractResponsesToolCalls(j.output)
          : [];
        assistantMsg = { role: 'assistant', content: text };
        if (Array.isArray(j.output)) assistantMsg._responsesOutput = j.output;
        if (responseToolCalls.length) {
          toolCalls = responseToolCalls.map(tc => ({
            id: tc.id, type: 'function',
            function: { name: tc.name, arguments: tc.arguments || '{}' }
          }));
          assistantMsg.tool_calls = toolCalls;
        }
      } else {
        const msg = j.choices?.[0]?.message;
        if (msg) {
          assistantMsg = { role: 'assistant', content: msg.content || '' };
          if (msg.tool_calls?.length) {
            toolCalls = msg.tool_calls;
            assistantMsg.tool_calls = toolCalls;
          }
        } else {
          assistantMsg = { role: 'assistant', content: '(无响应)' };
        }
      }
      
      if (typeof privacyGuardFinalizeAssistantMessage === 'function') {
        privacyGuardFinalizeAssistantMessage(assistantMsg, { source: 'outline', context: body, includeResponseGuard: false });
      }
      conversationMessages.push(assistantMsg);
      if (assistantMsg.content) finalAnswer = assistantMsg.content;
      if (toolCalls && toolCalls.length) {
        outlineRecordAssistantSpeech(aiMsg.outline, assistantMsg, loop + 1, true);
      }
      
      // ----- 没工具调用：完成 -----
      if (!toolCalls || !toolCalls.length) {
        if (outlineCodeGateNeedsVerification(aiMsg.outline, taskProfile)) {
          conversationMessages.push({
            role: 'user',
            content: outlineCodeGateMessage(aiMsg.outline)
          });
          aiMsg.outline.status = 'running';
          aiMsg.outline.progressText = '🧪 代码任务需要执行验证命令...';
          onUpdate();
          saveSnap(loop + 1);
          saveData();
          continue;
        }
        completedNaturally = true;
        break;
      }
      
      // ----- 执行工具 -----
      let anyOutlineChanged = false;
      let anyExternalToolCalled = false;
      const executedToolCallIds = [];
      let userStoppedAll = false;
      
      for (const tc of toolCalls) {
        throwIfAborted();
        
        const fname = tc.function?.name || '';
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (e) {}
        if (typeof privacyGuardRestoreToolCallArguments === 'function') {
          args = privacyGuardRestoreToolCallArguments(args, { context: body });
        }
        
        const isOutlineTool = OUTLINE_TOOL_NAMES.has(fname);
        let result;
        let preparedExternalToolResult = null;
        
        if (isOutlineTool) {
          result = handleOutlineTool(fname, args, aiMsg.outline);
          anyOutlineChanged = true;
          onUpdate();
        } else {
          // 外部工具：实时插入"运行中"卡片
          const activeItem = aiMsg.outline.items.find(it => it.status === 'active');
          const liveEntry = {
            name: fname,
            args: args,
            result: '',
            ok: null,
            _running: true,
            _ts: Date.now()
          };
          
          if (activeItem) {
            if (!Array.isArray(activeItem.toolCalls)) activeItem.toolCalls = [];
            activeItem.toolCalls.push(liveEntry);
          } else {
            aiMsg.outline.globalToolCalls.push(liveEntry);
          }
          onUpdate();
          
          anyExternalToolCalled = true;
          try {
            const toolTimeoutMs = outlineToolTimeoutMs(fname, args);
            result = await executeOutlineToolWithTimeout(fname, args, {
              chatId: taskChatId,
              chat: c,
              outline: aiMsg.outline,
              signal: abortSignal,
              isStopped: () => task ? !!task.stopRequested : !!state.stopRequested
            }, toolTimeoutMs);
          } catch (e) {
            liveEntry._running = false;
            liveEntry.ok = false;
            liveEntry.result = e && e.name === 'AbortError'
              ? '⏸️ 工具请求已被用户中断。'
              : `工具出错：${e.message || e}`;
            onUpdate();
            throw e;
          }
          
          const rawContent = outlineToolResultText(result);
          const preparedToolResult = typeof prepareToolResultForContext === 'function'
            ? prepareToolResultForContext({
                content: rawContent,
                toolName: fname,
                toolCallId: tc.id,
                chatId: taskChatId,
                chat: c,
                status: result.ok ? 'success' : 'error',
                args
              })
            : { content: rawContent, archived: false };
          const content = preparedToolResult.content;
          const outcome = outlineToolResultOutcome(result, content);
          preparedExternalToolResult = preparedToolResult;
          liveEntry.result = content.slice(0, 500);
          liveEntry.ok = outcome.ok;
          liveEntry.artifactId = preparedToolResult.artifactId;
          liveEntry.rawResult = result.value && typeof result.value === 'object' ? result.value : null;
          if (liveEntry.rawResult && liveEntry.rawResult.checkpoint_id) {
            liveEntry.checkpointId = liveEntry.rawResult.checkpoint_id;
            if (!aiMsg.outline.checkpointId) aiMsg.outline.checkpointId = liveEntry.rawResult.checkpoint_id;
            if (liveEntry.rawResult.checkpoint) aiMsg.outline.checkpoint = liveEntry.rawResult.checkpoint;
          }
          if (fname === 'restore_checkpoint' && result.ok && liveEntry.rawResult && liveEntry.rawResult.checkpoint_id) {
            aiMsg.outline.restoreState = {
              restored: true,
              restoredAt: new Date().toISOString(),
              checkpointId: liveEntry.rawResult.checkpoint_id,
              restoredCount: Array.isArray(liveEntry.rawResult.restored) ? liveEntry.rawResult.restored.length : 0,
              deletedCount: Array.isArray(liveEntry.rawResult.deleted) ? liveEntry.rawResult.deleted.length : 0,
              skippedCount: Array.isArray(liveEntry.rawResult.skipped) ? liveEntry.rawResult.skipped.length : 0,
              safetyCheckpointId: liveEntry.rawResult.safetyCheckpoint && liveEntry.rawResult.safetyCheckpoint.id
            };
          }
          liveEntry._running = false;
          onUpdate();
        }
        
        let content = outlineToolResultText(result);
        let preparedToolResult = preparedExternalToolResult || { content, archived: false };
        if (preparedExternalToolResult) content = preparedExternalToolResult.content;
        const outcome = outlineToolResultOutcome(result, content);
        conversationMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: fname,
          content: content,
          status: outcome.ok ? 'success' : 'error',
          _artifactId: preparedToolResult.artifactId,
          _artifactMeta: preparedToolResult.artifactMeta
        });
        executedToolCallIds.push(tc.id);
        
        if (outcome.stopAll || outcome.userRejected) {
          if (outcome.stopAll) userStoppedAll = true;
          assistantMsg.tool_calls = assistantMsg.tool_calls.filter(t => executedToolCallIds.includes(t.id));
          toolCalls = assistantMsg.tool_calls;
          conversationMessages.push({
            role: 'user',
            content: outcome.stopAll
              ? outlinePromptText('outlineToolRejectStopPrompt', DEFAULT_OUTLINE_TOOL_REJECT_STOP_PROMPT)
              : outlinePromptText('outlineToolRejectOncePrompt', DEFAULT_OUTLINE_TOOL_REJECT_ONCE_PROMPT)
          });
          break;
        }
      }
      
      if (userStoppedAll) {
        stoppedByToolPolicy = true;
        completedNaturally = false;
        break;
      }
      
      // ----- 检测卡住（连续 3 轮无任何变化）-----
      if (!anyOutlineChanged && !anyExternalToolCalled) {
        aiMsg.outline.stalledRounds++;
        if (aiMsg.outline.stalledRounds >= 3) {
          conversationMessages.push({
            role: 'user',
            content: outlinePromptText('outlineStalledPrompt', DEFAULT_OUTLINE_STALLED_PROMPT)
          });
          aiMsg.outline.stalledRounds = 0;
        }
      } else {
        aiMsg.outline.stalledRounds = 0;
      }
      
      // ⭐ 消化由 attach_file 等工具产生的待处理附件
      // 把它们转成 user 消息注入到 conversationMessages，下一轮 LLM 就能直接"看到"
      // 否则 terminal.js 的 autoResend 会在大纲结束后另起一段新 AI 回复
      consumePendingAttachments(conversationMessages, aiMsg.outline, taskChatId);
      
      // 保存快照（方便暂停后恢复）
      saveSnap(loop + 1);
      
      saveData();
    }
    
    // ----- 循环结束 -----
    if (completedNaturally) {
      // ✅ 正常情况：AI 主动停止调用工具
      aiMsg.outline.status = 'completed';
      aiMsg.content = finalAnswer || '(任务已完成，但未生成文本回复)';
      aiMsg.outline.diffSummary = outlineBuildDiffSummary(aiMsg.outline);
    } else {
      // 🛡️ 第三层保护：达到轮数上限或用户拒绝继续工具 → 强制收尾调用
      aiMsg.outline.status = 'truncated';
      aiMsg.outline.progressText = stoppedByToolPolicy
        ? '🏁 用户拒绝继续工具调用，正在整理最终回答...'
        : '🏁 已达轮数上限，正在整理最终回答...';
      onUpdate();
      
      let fallbackAnswer = '';
      try {
        fallbackAnswer = await doFinalSummaryCall(
          conversationMessages, history, systemPrompt, model, aiMsg.outline, abortSignal, c
        );
      } catch (fe) {
        if (fe.name === 'AbortError') throw fe;
        console.warn('[outline] 保底收尾调用失败:', fe);
        fallbackAnswer = '';
      }
      
      const truncatedNote = stoppedByToolPolicy
        ? `\n\n---\n\n> 🛑 **用户拒绝继续工具调用，任务已基于当前信息收尾。**`
        : `\n\n---\n\n> ⚠️ **执行已达轮数上限（${maxRounds} 轮），任务被强制收尾。** 如需更深入的结果，请提高"最大执行轮数"设置后重试。`;
      
      if (fallbackAnswer) {
        aiMsg.content = fallbackAnswer + truncatedNote;
      } else if (finalAnswer) {
        aiMsg.content = finalAnswer + truncatedNote;
      } else {
        // 真的什么都没拿到，做一份摘要兜底
        const doneItems = aiMsg.outline.items.filter(it => it.status === 'done');
        const pendingItems = aiMsg.outline.items.filter(it => it.status === 'pending' || it.status === 'active');
        let summary = `任务执行已达 ${maxRounds} 轮上限但未能生成最终回答。\n\n`;
        if (doneItems.length) summary += `**已完成：**\n${doneItems.map(it => `- ${it.title}${it.note ? '：' + it.note : ''}`).join('\n')}\n\n`;
        if (pendingItems.length) summary += `**未完成：**\n${pendingItems.map(it => `- ${it.title}`).join('\n')}\n`;
        aiMsg.content = summary + truncatedNote;
      }
      aiMsg.outline.diffSummary = outlineBuildDiffSummary(aiMsg.outline);
    }
    
    aiMsg.outline.inProgress = false;
    delete aiMsg.outline.progressText;
    delete aiMsg.outline._snap;  // 完成后清除快照
    aiMsg.outline.expanded = false; // 完成后默认折叠大纲，突出最终答案
    aiMsg._endTime = Date.now();
    
    if (typeof refreshMsgNode === 'function') refreshMsgNode(msgIdx, c);
    else if (typeof renderMessages === 'function' && isCurrentChat(c)) renderMessages();
    saveData();
    if (typeof toast === 'function') {
      if (completedNaturally) toast('✅ 大纲任务完成', 3000);
      else toast('⚠️ 已达轮数上限，已强制收尾', 4000);
    }
    if (!suppressCompletionSound && typeof playCompletionSound === 'function') playCompletionSound();
    
  } catch (e) {
    // ⭐ TimeoutError 视同 AbortError 处理：把任务挂起为 paused 并保留 _snap，让用户能继续
    const isAbortLike = (e.name === 'AbortError' || e.name === 'TimeoutError');
    let completedByForceFinish = false;
    
    if (isAbortLike) {
      // 检查是否是"立即收尾"信号
      const forceFinish = task ? !!task.outlineForceFinish : !!state._outlineForceFinish;
        if (forceFinish) {
          completedByForceFinish = true;
          if (task) task.outlineForceFinish = false;
          state._outlineForceFinish = false;
          // 走保底收尾流程
          aiMsg.outline.status = 'truncated';
          aiMsg.outline.finishRequested = true;
          aiMsg.outline.progressText = '🏁 用户请求立即收尾，正在整理最终回答...';
          onUpdate();
        
        // 重建 abortCtrl（因为已经被 abort 了）
        abortCtrl = new AbortController();
        if (typeof updateChatTaskController === 'function') updateChatTaskController(taskChatId, abortCtrl);
        else state.abortCtrl = abortCtrl;
        const newSignal = abortCtrl.signal;
        
        let fallbackAnswer = '';
        try {
          fallbackAnswer = await doFinalSummaryCall(
            conversationMessages, history, systemPrompt, model, aiMsg.outline, newSignal, c
          );
        } catch (fe) {
          console.warn('[outline] 立即收尾失败:', fe);
        }
        
        const finishNote = `\n\n---\n\n> 🏁 **用户请求立即收尾，AI 基于已有信息给出本回答。**`;
        
        if (fallbackAnswer) {
          aiMsg.content = fallbackAnswer + finishNote;
        } else if (finalAnswer) {
          aiMsg.content = finalAnswer + finishNote;
        } else {
          const doneItems = aiMsg.outline.items.filter(it => it.status === 'done');
          let summary = `任务被用户提前收尾。\n\n`;
          if (doneItems.length) summary += `**已完成的部分：**\n${doneItems.map(it => `- ${it.title}${it.note ? '：' + it.note : ''}`).join('\n')}\n`;
          aiMsg.content = summary + finishNote;
        }
        aiMsg.outline.diffSummary = outlineBuildDiffSummary(aiMsg.outline);
        
        if (typeof toast === 'function') toast('🏁 已收尾', 3000);
        delete aiMsg.outline.finishRequested;
      } else {
        aiMsg.outline.status = 'paused';
        delete aiMsg.outline.finishRequested;
        // 保留 _snap，让"继续执行"可以恢复
        // ⭐ 超时情况：在 content 加一行提示，让用户知道原因
        if (e.name === 'TimeoutError') {
          aiMsg.content = (aiMsg.content || '') + 
            `\n\n> ⏱ **请求超时**：${e.message}。任务已暂停，可点击下方「继续执行」重试。`;
        }
      }
    } else {
      aiMsg.outline.status = 'error';
      delete aiMsg.outline.finishRequested;
      aiMsg.content = `❌ 出错：${e.message}` + (finalAnswer ? '\n\n**部分输出：**\n' + finalAnswer : '');
      if (!aiMsg.outline._snap) saveSnap(startLoop || 0);
    }
    aiMsg.outline.inProgress = false;
    delete aiMsg.outline.progressText;
    aiMsg._endTime = Date.now();
    if (typeof refreshMsgNode === 'function') refreshMsgNode(msgIdx, c);
    else if (typeof renderMessages === 'function' && isCurrentChat(c)) renderMessages();
    saveData();
    if (completedByForceFinish && !suppressCompletionSound && typeof playCompletionSound === 'function') playCompletionSound();
  } finally {
    if (typeof clearChatTask === 'function') clearChatTask(taskChatId);
    else {
      state.isGenerating = false;
      state.abortCtrl = null;
      if (state.activeTaskChatId === taskChatId) state.activeTaskChatId = null;
      state._outlineExecuting = false;
      state._outlineForceFinish = false;
    }
    if (typeof updateSendBtn === 'function') updateSendBtn();
    if (typeof renderChatList === 'function') renderChatList();
  }
}

// ============ 🛡️ 第三层保护：保底收尾调用 ============
// 当达到轮数上限但 AI 还在调工具时，额外发一次"无工具"请求逼出最终文字答案
async function doFinalSummaryCall(conversationMessages, history, systemPrompt, model, outlineObj, abortSignal, recordChat) {
  const s = state.settings;
  
  const finalSystemPrompt = (typeof withActiveSkillPrompt === 'function' ? withActiveSkillPrompt(systemPrompt) : systemPrompt) + 
    '\n\n' + outlinePromptText('outlineForceFinalSystemPrompt', DEFAULT_OUTLINE_FORCE_FINAL_SYSTEM_PROMPT);
  
  // 给当前 outline 状态做个文字快照，便于模型理解进展
  let outlineSnapshot = '';
  if (outlineObj.items && outlineObj.items.length) {
    outlineSnapshot = '\n\n【当前工作大纲快照】\n' + outlineObj.items.map(it => {
      const icon = it.status === 'done' ? '✓' : it.status === 'skipped' ? '~' : it.status === 'active' ? '▶' : '○';
      return `${icon} [${it.id}] ${it.title}${it.note ? '：' + it.note : ''}`;
    }).join('\n');
  }
  
  const finalUserMsg = outlinePromptText('outlineForceFinalUserPrompt', DEFAULT_OUTLINE_FORCE_FINAL_USER_PROMPT) + outlineSnapshot;
  
  // ----- 构造请求（不带 tools 字段）-----
  let body;
  const buildOutlineFinalBody = () => {
  const safeHistory = typeof privacyGuardPrepareHistory === 'function'
    ? privacyGuardPrepareHistory(history, { format: s.apiFormat || 'openai' })
    : history;
  const safeConversationMessages = typeof privacyGuardPrepareHistory === 'function'
    ? privacyGuardPrepareHistory(conversationMessages, { format: s.apiFormat || 'openai' })
    : conversationMessages;
  const safeFinalSystemPrompt = typeof privacyGuardSanitizeAuxiliarySystemText === 'function'
    ? privacyGuardSanitizeAuxiliarySystemText(finalSystemPrompt)
    : finalSystemPrompt;
  const safeFinalUserMsg = typeof privacyGuardPrepareHistory === 'function'
    ? (privacyGuardPrepareHistory([{ role: 'user', content: finalUserMsg }], { format: s.apiFormat || 'openai' })[0]?.content || finalUserMsg)
    : finalUserMsg;

  if (s.apiFormat === 'anthropic') {
    const baseMsgs = (typeof buildAnthropicMessages === 'function') ? buildAnthropicMessages(safeHistory, { includeResponseGuard: false }) : [];
    const allMsgs = [...baseMsgs];
    
    for (const m of safeConversationMessages) {
      if (m.role === 'assistant') {
        const parts = [];
        if (m.content && m.content.trim()) parts.push({ type: 'text', text: m.content });
        if (m.tool_calls) {
          for (const tc of m.tool_calls) {
            let input = {};
            try { input = JSON.parse(tc.function?.arguments || '{}'); } catch (e) {}
            parts.push({ type: 'tool_use', id: tc.id, name: tc.function?.name || '', input });
          }
        }
        allMsgs.push({ role: 'assistant', content: parts });
      } else if (m.role === 'tool') {
        const part = {
          type: 'tool_result',
          tool_use_id: m.tool_call_id,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        };
        const last = allMsgs[allMsgs.length - 1];
        if (last && last.role === 'user' && Array.isArray(last.content)) {
          last.content.push(part);
        } else {
          allMsgs.push({ role: 'user', content: [part] });
        }
      } else if (m.role === 'user') {
        // 系统插入的提示 / 用户中途留言 / 附件注入（可能是字符串或数组）
        const last = allMsgs[allMsgs.length - 1];
        const contentParts = Array.isArray(m.content) 
          ? m.content 
          : [{ type: 'text', text: String(m.content || '') }];
        if (last && last.role === 'user' && Array.isArray(last.content)) {
          last.content.push(...contentParts);
        } else if (last && last.role === 'user' && typeof last.content === 'string') {
          last.content = [{ type: 'text', text: last.content }, ...contentParts];
        } else {
          allMsgs.push({ role: 'user', content: contentParts });
        }
      }
    }
    
    // 追加最终强制收尾的 user 消息（同样要注意 user 合并）
    {
      const last = allMsgs[allMsgs.length - 1];
      const finalParts = [{ type: 'text', text: safeFinalUserMsg }];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(...finalParts);
      } else if (last && last.role === 'user' && typeof last.content === 'string') {
        last.content = [{ type: 'text', text: last.content }, ...finalParts];
      } else {
        allMsgs.push({ role: 'user', content: finalParts });
      }
    }
    
    const fixedMsgs = (typeof fixAnthropicMessageSequence === 'function')
      ? fixAnthropicMessageSequence(allMsgs)
      : allMsgs;
    body = {
      model,
      messages: fixedMsgs,
      max_tokens: parseInt(s.maxTokens),
      temperature: parseFloat(s.temperature),
      stream: false,
      system: safeFinalSystemPrompt
      // 🔑 关键：不传 tools 字段
    };
  } else if (s.apiFormat === 'responses') {
    const allMessages = [
      ...(safeHistory || []),
      ...(safeConversationMessages || []),
      { role: 'user', content: safeFinalUserMsg }
    ];
    body = {
      model,
      input: outlineBuildResponsesInput(allMessages, []),
      instructions: safeFinalSystemPrompt,
      temperature: parseFloat(s.temperature),
      max_output_tokens: parseInt(s.maxTokens),
      stream: false
      // 🔑 关键：不传 tools 字段
    };
  } else {
    const baseMsgs = (typeof buildOpenAIMessages === 'function')
      ? buildOpenAIMessages(safeHistory, { includeResponseGuard: false }).filter(m => m.role !== 'system') : [];
    const allMsgs = [
      { role: 'system', content: safeFinalSystemPrompt },
      ...baseMsgs,
      ...safeConversationMessages,
      { role: 'user', content: safeFinalUserMsg }
    ];
    const fixedMsgs = (typeof fixOpenAIMessageSequence === 'function')
      ? fixOpenAIMessageSequence(allMsgs)
      : allMsgs;
    body = {
      model,
      messages: fixedMsgs,
      temperature: parseFloat(s.temperature),
      max_tokens: parseInt(s.maxTokens),
      stream: false
      // 🔑 关键：不传 tools 字段
    };
  }
  return body;
  };
  body = typeof withPrivacyGuardRequest === 'function'
    ? withPrivacyGuardRequest(buildOutlineFinalBody, { source: 'outline-final', silentReport: true })
    : buildOutlineFinalBody();
  
  // ----- 限速 -----
  if (typeof applyRateLimit === 'function') await applyRateLimit(abortSignal);
  
  if (abortSignal && abortSignal.aborted) {
    const err = new Error('用户中断');
    err.name = 'AbortError';
    throw err;
  }
  
  // ----- 发送 -----
  const url = buildFullUrl(s.baseUrl, s.apiPath);
  const { resp, rawText: _rawText, json: j } = await _outlineFetchJsonWithRetry(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body)
  }, abortSignal, null);
  
  // ⭐ 记录原始响应
  if (typeof recordRawResponse === 'function') {
    recordRawResponse({
      ts: Date.now(),
      isStream: false,
      contentType: resp.headers.get('content-type') || '',
      raw: _rawText,
      parsedJson: j,
      usage: j.usage || null,
      request: { url, method: 'POST', headers: buildHeaders(), body },
      _source: '大纲模式 · 保底收尾调用'
    });
  }
  
  // ⭐ 保底收尾调用的 usage 也计入统计
  const usageForRecord = outlineNormalizeUsage(j.usage);
  if (usageForRecord && typeof recordUsageFromResponse === 'function') {
    const _c = recordChat || (typeof activeTaskChat === 'function' ? activeTaskChat() : (typeof currentChat === 'function' ? currentChat() : null));
    if (_c) recordUsageFromResponse(_c, usageForRecord, { model });
  }
  
  // ----- 解析 -----
  let finalText = '';
  if (s.apiFormat === 'anthropic') {
    const contents = j.content || [];
    finalText = contents.filter(p => p.type === 'text').map(p => p.text).join('') || '';
  } else if (s.apiFormat === 'responses') {
    finalText = (typeof extractResponsesText === 'function' ? extractResponsesText(j) : '') || '';
  } else {
    finalText = j.choices?.[0]?.message?.content || '';
  }
  return typeof privacyGuardFinalizeText === 'function'
    ? privacyGuardFinalizeText(finalText, { source: 'outline-final', context: body, includeResponseGuard: false })
    : finalText;
}

// ============ 大纲工具处理（本地虚拟工具，不发请求）============

// ⭐ 消化由 attach_file 等工具产生的待处理附件
// 把 state.pendingAIAttachments 中的项目转换为 user 消息注入到对话上下文，
// 然后清空 pendingAIAttachments（防止 autoResend 在大纲结束后再触发新对话）
function consumePendingAttachments(conversationMessages, outlineObj, chatId) {
  const targetChatId = chatId || (typeof resolveToolChatId === 'function' ? resolveToolChatId() : state.currentId);
  const atts = typeof takePendingAIAttachments === 'function'
    ? takePendingAIAttachments(targetChatId)
    : ((state.pendingAIAttachments || []).splice(0));
  if (!atts.length) return;
  const s = state.settings;
  
  // 同时取消任何待执行的 autoResend 定时器（双重保险）
  if (typeof window !== 'undefined') {
    if (window._autoResendTimer) {
      try { clearTimeout(window._autoResendTimer); } catch (e) {}
    }
    if (typeof window.cancelAutoResend === 'function') {
      try { window.cancelAutoResend(targetChatId); } catch (e) {}
    }
  }
  
  // 分类
  const images = atts.filter(a => a.type === 'image' && a.data);
  const textFiles = atts.filter(a => a.type === 'file' && a.text);
  const otherFiles = atts.filter(a => 
    !(a.type === 'image' && a.data) && !(a.type === 'file' && a.text)
  );
  
  // 文本文件 → 拼到 textPart
  let textPart = '【系统：以下附件已加载到对话上下文】';
  if (atts.length) {
    textPart += '\n\n' + atts.map(a => `- ${a.name}（${formatSize(a.size || 0)}）`).join('\n');
  }
  for (const a of textFiles) {
    const content = (a.text || '').slice(0, 50000); // 单文件最多 50k 字符防爆 token
    const truncated = (a.text || '').length > 50000 ? '\n\n...（已截断）' : '';
    textPart += `\n\n--- 附件内容：${a.name} ---\n\`\`\`\n${content}${truncated}\n\`\`\``;
  }
  for (const a of otherFiles) {
    textPart += `\n\n--- 附件：${a.name} ---\n（二进制文件，请通过工具读取或描述）`;
  }
  textPart += '\n\n请基于以上内容继续推进任务。';
  
  // 构造消息：图片用 multimodal 格式
  if (images.length > 0) {
    if (s.apiFormat === 'anthropic') {
      // Anthropic 在 outline.js 的 anthropic 分支里会重新组装；这里用通用 OpenAI 兼容格式
      // 但 outline 主循环中 anthropic 分支把 m.content 是字符串/数组都接管了，所以这里用数组也行
      const parts = [{ type: 'text', text: textPart }];
      for (const img of images) {
        // Anthropic 格式：image 类型用 source.data
        const dataUrl = img.data || '';
        const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (m) {
          parts.push({
            type: 'image',
            source: { type: 'base64', media_type: m[1], data: m[2] }
          });
        }
      }
      conversationMessages.push({ role: 'user', content: parts, _hasMultimodal: true });
    } else {
      const parts = [{ type: 'text', text: textPart }];
      for (const img of images) {
        parts.push({ type: 'image_url', image_url: { url: img.data } });
      }
      conversationMessages.push({ role: 'user', content: parts, _hasMultimodal: true });
    }
  } else {
    conversationMessages.push({ role: 'user', content: textPart });
  }
  
  // 记录到 outline.injections 让 UI 可见
  if (!Array.isArray(outlineObj.injections)) outlineObj.injections = [];
  outlineObj.injections.push({
    round: outlineObj.rounds || 0,
    text: `📎 附件已注入：${atts.map(a => a.name).join('、')}`,
    ts: Date.now(),
    _isAttachment: true
  });
}

// ⚠️ formatBytes 已合并到 utils.js 的 formatSize（统一格式：带空格 + MB 用 .toFixed(2)）

// ============ 大纲工具处理（本地虚拟工具，不发请求）============

function handleOutlineTool(name, args, outline) {
  if (name === 'save_outline') {
    const items = Array.isArray(args.items) ? args.items : [];
    // 保留旧条目的 toolCalls（按 id 匹配）
    const oldMap = {};
    for (const it of (outline.items || [])) oldMap[it.id] = it;
    
    outline.items = items.map(it => {
      const id = String(it.id || ('a' + Math.random().toString(36).slice(2, 6)));
      const status = ['pending', 'active', 'done', 'skipped'].includes(it.status) ? it.status : 'pending';
      const old = oldMap[id];
      return {
        id,
        title: String(it.title || '未命名'),
        status,
        note: it.note ? String(it.note) : '',
        toolCalls: old ? (old.toolCalls || []) : []
      };
    });
    return { ok: true, value: `✓ 已保存大纲（${outline.items.length} 项）` };
  }
  
  if (name === 'append_outline') {
    const id = String(args.id || ('a' + Math.random().toString(36).slice(2, 6)));
    if (outline.items.some(it => it.id === id)) {
      return { ok: false, value: `条目 id "${id}" 已存在，请换一个 id 或用 update_outline` };
    }
    outline.items.push({
      id,
      title: String(args.title || '未命名'),
      status: 'pending',
      note: args.note ? String(args.note) : '',
      toolCalls: []
    });
    return { ok: true, value: `✓ 已追加条目 "${id}"（当前共 ${outline.items.length} 项）` };
  }
  
  if (name === 'update_outline') {
    const id = String(args.id || '');
    const item = outline.items.find(it => it.id === id);
    if (!item) {
      return { ok: false, value: `未找到条目 "${id}"。当前条目：${outline.items.map(it => it.id).join(', ') || '(空)'}` };
    }
    if (args.status && ['pending', 'active', 'done', 'skipped'].includes(args.status)) {
      // 若改为 active，自动把其他 active 改回 pending
      if (args.status === 'active') {
        outline.items.forEach(it => {
          if (it.id !== id && it.status === 'active') it.status = 'pending';
        });
      }
      item.status = args.status;
    }
    if (args.title) item.title = String(args.title);
    if (args.note !== undefined) item.note = String(args.note);
    return { ok: true, value: `✓ 已更新条目 "${id}"（${item.status}）` };
  }
  
  return { ok: false, value: '未知的大纲操作' };
}

// ============ 构建合并的 tools 数组（隐藏工具 + 用户工具）============

function outlineCloneTool(tool) {
  return JSON.parse(JSON.stringify(tool));
}

function outlineToolName(tool) {
  return tool && (tool.name || (tool.function && tool.function.name) || '');
}

function outlineToolSchema(tool) {
  if (!tool || typeof tool !== 'object') return null;
  if (tool.input_schema) return tool.input_schema;
  if (tool.parameters) return tool.parameters;
  if (tool.function && tool.function.parameters) return tool.function.parameters;
  return null;
}

function outlineSetToolDescription(tool, description) {
  if (!tool || typeof tool !== 'object') return;
  if (tool.function) tool.function.description = description;
  else tool.description = description;
}

function outlineEnhanceExecuteActionToolForVerification(tool) {
  const next = outlineCloneTool(tool);
  if (outlineToolName(next) !== 'execute_action') return next;
  const schema = outlineToolSchema(next);
  if (!schema || !schema.properties) return next;
  const props = schema.properties;
  props.intent = {
    type: 'string',
    enum: ['inspect', 'verify', 'run', 'install', 'other'],
    description: '大纲模式必填：声明本次命令意图。验证最后一次代码修改时必须填 verify；只读探测/查看填 inspect；运行普通程序填 run；安装依赖填 install；其他填 other。'
  };
  props.verifyTarget = {
    type: 'string',
    description: '当 intent=verify 时填写：本次验证覆盖的文件、模块、功能或 Done when。'
  };
  props.verifyReason = {
    type: 'string',
    description: '当 intent=verify 时填写：为什么这个命令是最小且相关的验证，以及通过后可停止继续验证的理由。'
  };
  const required = Array.isArray(schema.required) ? schema.required.slice() : [];
  if (!required.includes('intent')) required.push('intent');
  schema.required = required;
  const desc = (next.function ? next.function.description : next.description) || '';
  outlineSetToolDescription(next, desc + '\n\n【大纲模式额外要求】调用 execute_action 时必须声明 intent。只有用于验证最后一次代码修改的命令才设置 intent="verify"，并填写 verifyTarget 与 verifyReason。版本、帮助、配置打印、where/which/get-command 等环境探测命令必须使用 intent="inspect"，不能声明为 verify。');
  return next;
}

function buildOutlineTools(options = {}) {
  const s = state.settings;
  const useUserTools = options.useTools !== undefined ? !!options.useTools : !!s.useTools;
  
  // 用户工具按本次任务配置合并；大纲内置工具始终存在。
  const userToolsFinal = (useUserTools && typeof buildToolsArray === 'function')
    ? (buildToolsArray({ force: true }) || []).map(outlineEnhanceExecuteActionToolForVerification)
    : [];
  
  // OUTLINE_TOOLS 转换为对应格式
  let outlineToolsConverted;
  if (s.apiFormat === 'anthropic') {
    outlineToolsConverted = OUTLINE_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));
  } else if (s.apiFormat === 'responses') {
    outlineToolsConverted = OUTLINE_TOOLS.map(t => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
  } else {
    outlineToolsConverted = OUTLINE_TOOLS.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }
  
  return [...outlineToolsConverted, ...userToolsFinal];
}

