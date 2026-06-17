// ============ Shell Command AI Audit ============
// Reviews only execute_action shell commands before they reach the local backend.

const SHELL_AUDIT_CURRENT_PROFILE = '__current';
const SHELL_AUDIT_DEFAULT_PROMPT = [
  '你是本地 Shell 命令安全审核员。你只能根据用户当前轮消息和待执行的 Shell 命令做判断，不要假设你看过完整上下文。',
  '目标：判断该命令是否是完成当前用户请求所必要，以及是否存在读取无关文件、窃取密钥/Token/Cookie/私钥、破坏文件、绕过权限、联网外传、安装或执行不明代码等风险。',
  '如果命令只读取或修改与用户当前请求直接相关的工作区文件，且没有明显外传或破坏风险，可以放行。',
  '如果命令访问用户未要求的敏感路径或凭证文件、枚举大量无关文件、上传/发送数据到外部、执行远程脚本、删除/覆盖大范围文件、提升权限、修改系统设置，必须拦截。',
  '只输出严格 JSON，不要输出 Markdown，不要解释 JSON 外的内容。格式：{"allow":true|false,"risk":"low|medium|high","necessary":true|false,"reason":"一句话理由","concerns":["风险点1"]}'
].join('\n');

function cloneShellAuditDefaults() {
  return {
    enabled: false,
    profileId: SHELL_AUDIT_CURRENT_PROFILE,
    model: '',
    prompt: SHELL_AUDIT_DEFAULT_PROMPT
  };
}

function ensureShellAuditSettings() {
  if (typeof state === 'undefined') return cloneShellAuditDefaults();
  const existing = state.settings.shellAudit || {};
  state.settings.shellAudit = {
    ...cloneShellAuditDefaults(),
    ...existing
  };
  if (!state.settings.shellAudit.profileId) state.settings.shellAudit.profileId = SHELL_AUDIT_CURRENT_PROFILE;
  if (!state.settings.shellAudit.prompt) state.settings.shellAudit.prompt = SHELL_AUDIT_DEFAULT_PROMPT;
  return state.settings.shellAudit;
}

function getShellAuditSettings() {
  return ensureShellAuditSettings();
}

function normalizeShellAuditRisk(value) {
  const risk = String(value || '').toLowerCase().trim();
  return ['low', 'medium', 'high'].includes(risk) ? risk : 'high';
}

function shellAuditEscape(value) {
  return typeof escapeHtml === 'function'
    ? escapeHtml(value == null ? '' : value)
    : String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shellAuditFindProfile(profileId) {
  if (!profileId || profileId === SHELL_AUDIT_CURRENT_PROFILE) return null;
  const profiles = typeof loadApiProfiles === 'function' ? loadApiProfiles() : [];
  return profiles.find(p => p && p.id === profileId) || null;
}

function shellAuditGetApiSettings(profileId) {
  const prof = shellAuditFindProfile(profileId);
  const out = prof && prof.settings
    ? { ...(prof.settings || {}) }
    : { ...((typeof state !== 'undefined' && state.settings) || {}) };
  if (out.useLocalProxy === undefined) out.useLocalProxy = true;
  return out;
}

function shellAuditModelList(profileId) {
  const s = shellAuditGetApiSettings(profileId);
  const list = String(s.modelName || '')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);
  if (s.currentModel && !list.includes(s.currentModel)) list.unshift(s.currentModel);
  return list;
}

function shellAuditResolveModel(cfg) {
  const s = shellAuditGetApiSettings(cfg.profileId);
  return (cfg.model || '').trim()
    || s.currentModel
    || String(s.modelName || '').split(',').map(m => m.trim()).filter(Boolean)[0]
    || '';
}

function shellAuditBuildHeaders(apiSettings) {
  const s = apiSettings || {};
  const h = { 'Content-Type': 'application/json' };
  if (s.apiFormat === 'anthropic') {
    h['x-api-key'] = s.apiKey || '';
    h['anthropic-version'] = '2023-06-01';
  } else {
    h['Authorization'] = 'Bearer ' + (s.apiKey || '');
  }
  if (s.jsonHeaders && String(s.jsonHeaders).trim()) {
    try {
      Object.assign(h, JSON.parse(s.jsonHeaders));
    } catch (e) {}
  }
  return h;
}

function shellAuditRedactHeaders(headers) {
  const out = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    if (/authorization|api[-_]?key|token|target-headers/i.test(key)) out[key] = '[REDACTED]';
    else out[key] = value;
  });
  return out;
}

function shellAuditRedactedRecordBody(body) {
  return {
    model: body && body.model ? body.model : '',
    stream: false,
    _redacted: 'Shell 审核请求正文包含当前用户消息和待执行命令，已避免写入本地 JSON 历史。'
  };
}

function shellAuditBuildBody(apiSettings, model, userPrompt, command) {
  const s = apiSettings || {};
  let prompt = getShellAuditSettings().prompt || SHELL_AUDIT_DEFAULT_PROMPT;
  let payload = [
    '请审核下面这一次 Shell 命令调用。',
    '',
    '<current_user_message>',
    userPrompt || '(未能提取当前用户消息)',
    '</current_user_message>',
    '',
    '<shell_command>',
    command || '',
    '</shell_command>'
  ].join('\n');
  if (typeof privacyGuardSanitizeSystemText === 'function') {
    prompt = privacyGuardSanitizeSystemText(prompt, { includeResponseGuard: false });
  }
  if (typeof privacyGuardPrepareHistory === 'function') {
    const prepared = privacyGuardPrepareHistory([{ role: 'user', content: payload }], { format: 'shell-audit' });
    payload = prepared && prepared[0] && typeof prepared[0].content === 'string'
      ? prepared[0].content
      : payload;
  }
  const maxTokens = Math.max(128, Math.min(parseInt(s.maxTokens) || 2048, 1024));
  const temperature = 0;
  let body;

  if (s.apiFormat === 'anthropic') {
    body = {
      model,
      messages: [{ role: 'user', content: payload }],
      max_tokens: maxTokens,
      temperature,
      stream: false,
      system: prompt
    };
  } else if (s.apiFormat === 'responses') {
    body = {
      model,
      input: [{ role: 'user', content: payload }],
      instructions: prompt,
      temperature,
      max_output_tokens: maxTokens,
      stream: false
    };
  } else {
    body = {
      model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: payload }
      ],
      temperature,
      max_tokens: maxTokens,
      stream: false
    };
  }

  body = shellAuditApplyCustomJsonTemplate(body, s, { model, prompt, payload, temperature, maxTokens });
  return shellAuditApplyReasoningEffort(body, s);
}

function shellAuditApplyCustomJsonTemplate(defaultBody, apiSettings, values) {
  const s = apiSettings || {};
  if (!s.useCustomJson || !s.jsonTemplate || !String(s.jsonTemplate).trim()) return defaultBody;
  try {
    let tpl = String(s.jsonTemplate);
    tpl = tpl
      .replace(/"\{\{messages\}\}"/g, 'null')
      .replace(/\{\{messages\}\}/g, 'null')
      .replace(/"\{\{model\}\}"/g, JSON.stringify(values.model))
      .replace(/\{\{model\}\}/g, JSON.stringify(values.model))
      .replace(/"\{\{system\}\}"/g, JSON.stringify(values.prompt))
      .replace(/\{\{system\}\}/g, JSON.stringify(values.prompt))
      .replace(/"\{\{temperature\}\}"/g, JSON.stringify(values.temperature))
      .replace(/\{\{temperature\}\}/g, JSON.stringify(values.temperature))
      .replace(/"\{\{max_tokens\}\}"/g, JSON.stringify(values.maxTokens))
      .replace(/\{\{max_tokens\}\}/g, JSON.stringify(values.maxTokens))
      .replace(/"\{\{stream\}\}"/g, 'false')
      .replace(/\{\{stream\}\}/g, 'false')
      .replace(/"\{\{tools\}\}"/g, 'null')
      .replace(/\{\{tools\}\}/g, 'null');
    const body = JSON.parse(tpl);
    if (!body.model) body.model = values.model;
    if (s.apiFormat === 'responses') {
      body.input = [{ role: 'user', content: values.payload }];
      body.instructions = values.prompt;
      body.max_output_tokens = body.max_output_tokens || values.maxTokens;
      delete body.messages;
      delete body.system;
    } else if (s.apiFormat === 'anthropic') {
      body.messages = [{ role: 'user', content: values.payload }];
      body.system = values.prompt;
      body.max_tokens = body.max_tokens || values.maxTokens;
    } else {
      body.messages = [
        { role: 'system', content: values.prompt },
        { role: 'user', content: values.payload }
      ];
      body.max_tokens = body.max_tokens || values.maxTokens;
      delete body.system;
    }
    body.temperature = values.temperature;
    body.stream = false;
    delete body.tools;
    Object.keys(body).forEach(k => {
      if (body[k] === null) delete body[k];
    });
    return body;
  } catch (error) {
    console.warn('[shell-audit] 自定义 JSON 模板解析失败，已回退默认请求体:', error);
    return defaultBody;
  }
}

function shellAuditApplyReasoningEffort(body, apiSettings) {
  const effort = String(apiSettings?.reasoningEffort || '').trim();
  const allowed = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
  if (!allowed.has(effort) || !body || typeof body !== 'object') return body;
  body.output_config = {
    ...(body.output_config && typeof body.output_config === 'object' && !Array.isArray(body.output_config) ? body.output_config : {}),
    effort
  };
  return body;
}

function shellAuditExtractResponseText(parsed, apiFormat) {
  if (!parsed) return '';
  if (apiFormat === 'anthropic') {
    return (parsed.content || [])
      .filter(p => p && p.type === 'text')
      .map(p => p.text || '')
      .join('');
  }
  if (apiFormat === 'responses') {
    if (typeof extractResponsesText === 'function') return extractResponsesText(parsed) || '';
    return parsed.output_text || '';
  }
  return parsed.choices?.[0]?.message?.content || '';
}

function shellAuditExtractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('审核 AI 返回为空');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch (firstErr) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw firstErr;
  }
}

function normalizeShellAuditDecision(parsed, rawText) {
  const allow = parsed && parsed.allow === true;
  const necessary = parsed && parsed.necessary !== false;
  let risk = normalizeShellAuditRisk(parsed && parsed.risk);
  if ((!allow || !necessary) && risk === 'low') risk = 'medium';
  const reason = String(parsed?.reason || '').trim() || '审核 AI 未提供理由。';
  const concerns = Array.isArray(parsed?.concerns)
    ? parsed.concerns.map(x => String(x || '').trim()).filter(Boolean)
    : [];
  const autoAllow = allow && necessary && risk === 'low';
  return {
    ok: true,
    allow,
    necessary,
    risk,
    reason,
    concerns,
    rawText: String(rawText || ''),
    autoAllow
  };
}

function normalizeShellAuditError(error) {
  const aborted = error && (error.name === 'AbortError' || /aborted|用户中断/.test(error.message || ''));
  return {
    ok: false,
    allow: false,
    necessary: false,
    risk: 'high',
    reason: aborted ? '审核已被中断。' : `审核失败：${error && error.message ? error.message : String(error)}`,
    concerns: aborted ? ['当前任务已中断'] : ['无法确认命令安全性'],
    autoAllow: false,
    aborted
  };
}

function shellAuditUserMessageToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (!part) return '';
      if (typeof part === 'string') return part;
      return part.text || part.content || part.input || '';
    }).filter(Boolean).join('\n');
  }
  if (content && typeof content === 'object') {
    try { return JSON.stringify(content); } catch (e) { return String(content); }
  }
  return '';
}

function getCurrentUserPromptForShellAudit(context) {
  if (context && typeof context === 'object') {
    if (typeof context.currentUserPrompt === 'string' && context.currentUserPrompt.trim()) return context.currentUserPrompt;
    if (typeof context.userPrompt === 'string' && context.userPrompt.trim()) return context.userPrompt;
  }
  const chat = (context && context.chat)
    || (context && context.chatId && typeof chatById === 'function' ? chatById(context.chatId) : null)
    || (typeof currentChat === 'function' ? currentChat() : null);
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    if (m._hiddenFromUI || m._isSummary || m._concurrentAttachment) continue;
    const text = shellAuditUserMessageToText(m.content).trim();
    if (text) return text;
  }
  return '';
}

async function shellAuditFetch(url, init, apiSettings, signal) {
  const timeoutCtrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutCtrl.abort();
  }, 120000);
  let externalAbortHandler = null;
  if (signal) {
    if (signal.aborted) timeoutCtrl.abort();
    else {
      externalAbortHandler = () => timeoutCtrl.abort();
      signal.addEventListener('abort', externalAbortHandler, { once: true });
    }
  }
  let realUrl = url;
  let realInit = { ...(init || {}), signal: timeoutCtrl.signal };
  try {
    const tc = typeof TERMINAL_CONFIG !== 'undefined' ? TERMINAL_CONFIG : null;
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
    if (apiSettings && apiSettings.useLocalProxy !== false && tc && tc.serverUrl && !isLocal) {
      if (!tc.token && typeof fetchTerminalToken === 'function') {
        try { await fetchTerminalToken(true); } catch (e) {}
      }
      realUrl = tc.serverUrl.replace(/\/+$/, '') + '/llm-proxy';
      realInit = {
        ...realInit,
        method: (init && init.method) || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Token': tc.token || '',
          'X-Target-Url': url,
          'X-Target-Headers': JSON.stringify(init && init.headers ? init.headers : {})
        },
        body: init && init.body,
        signal: timeoutCtrl.signal
      };
    }
  } catch (e) {}
  try {
    return await fetch(realUrl, realInit);
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error('审核请求超时');
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal && externalAbortHandler) {
      try { signal.removeEventListener('abort', externalAbortHandler); } catch (e) {}
    }
  }
}

async function callShellAuditModel({ command, userPrompt, context }) {
  const cfg = getShellAuditSettings();
  const apiSettings = shellAuditGetApiSettings(cfg.profileId);
  const model = shellAuditResolveModel(cfg);
  if (!model) throw new Error('未配置审核模型');
  if (!apiSettings.baseUrl || !apiSettings.apiPath) throw new Error('审核 API Profile 未配置接口地址');
  const bodyBuilder = () => shellAuditBuildBody(apiSettings, model, userPrompt, command);
  const body = typeof withPrivacyGuardRequest === 'function'
    ? withPrivacyGuardRequest(bodyBuilder, { source: 'shell-audit', silentReport: true })
    : bodyBuilder();
  const url = typeof buildFullUrl === 'function'
    ? buildFullUrl(apiSettings.baseUrl, apiSettings.apiPath)
    : String(apiSettings.baseUrl || '').replace(/\/+$/, '') + '/' + String(apiSettings.apiPath || '').replace(/^\/+/, '');
  const headers = shellAuditBuildHeaders(apiSettings);
  const signal = context && context.signal ? context.signal : undefined;
  const resp = await shellAuditFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }, apiSettings, signal);
  if (typeof recordRequest === 'function') recordRequest();
  const contentType = resp.headers.get('content-type') || '';
  const raw = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${raw.slice(0, 300)}`);
  const trimmed = raw.trim();
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!contentType.toLowerCase().includes('json') && !looksLikeJson) {
    throw new Error(`非 JSON 响应 (${contentType})`);
  }
  const parsedResponse = JSON.parse(trimmed);
  if (parsedResponse.error) throw new Error(parsedResponse.error.message || JSON.stringify(parsedResponse.error));
  if (typeof recordRawResponse === 'function') {
    recordRawResponse({
      ts: Date.now(),
      isStream: false,
      contentType,
      raw: '[shell audit response redacted]',
      parsedJson: null,
      usage: parsedResponse.usage || null,
      request: { url, method: 'POST', headers: shellAuditRedactHeaders(headers), body: shellAuditRedactedRecordBody(body) },
      _source: 'Shell 命令审核'
    });
  }
  if (parsedResponse.usage && typeof recordUsageFromResponse === 'function') {
    const chat = context?.chat || (context?.chatId && typeof chatById === 'function' ? chatById(context.chatId) : null);
    if (chat) recordUsageFromResponse(chat, parsedResponse.usage, { model });
  }
  let text = shellAuditExtractResponseText(parsedResponse, apiSettings.apiFormat);
  if (typeof privacyGuardFinalizeText === 'function') {
    text = privacyGuardFinalizeText(text, { source: 'shell-audit', context: body, includeResponseGuard: false });
  }
  const decisionJson = shellAuditExtractJson(text);
  return normalizeShellAuditDecision(decisionJson, text);
}

async function reviewShellCommandWithAI({ command, cwd, context } = {}) {
  const cfg = getShellAuditSettings();
  if (!cfg.enabled) {
    return { ok: true, allow: true, necessary: true, risk: 'low', reason: 'Shell 审核未启用。', concerns: [], autoAllow: true, skipped: true };
  }
  try {
    return await callShellAuditModel({
      command: String(command || ''),
      userPrompt: getCurrentUserPromptForShellAudit(context),
      context: context || {}
    });
  } catch (error) {
    return normalizeShellAuditError(error);
  }
}

let _shellAuditConfirmResolve = null;
let _shellAuditConfirmQueue = Promise.resolve();

function shellAuditConfirmRisk(decision, { command, cwd, context } = {}) {
  const run = () => {
    if (context && context.signal && context.signal.aborted) {
      return { allowed: false, aborted: true };
    }
    return shellAuditConfirmRiskNow(decision, { command, cwd, context });
  };
  const next = _shellAuditConfirmQueue.catch(() => {}).then(run);
  _shellAuditConfirmQueue = next.catch(() => {});
  return next;
}

function shellAuditConfirmRiskNow(decision, { command, cwd, context } = {}) {
  const info = decision || {};
  return new Promise(resolve => {
    _shellAuditConfirmResolve = resolve;
    const riskEl = document.getElementById('shellAuditRisk');
    const necEl = document.getElementById('shellAuditNecessary');
    const reasonEl = document.getElementById('shellAuditReason');
    const concernsEl = document.getElementById('shellAuditConcerns');
    const cwdEl = document.getElementById('shellAuditCwd');
    const cmdEl = document.getElementById('shellAuditCmd');
    const mask = document.getElementById('shellAuditConfirmMask');
    const risk = normalizeShellAuditRisk(info.risk);
    if (!mask) {
      _shellAuditConfirmResolve = null;
      resolve({ allowed: false, aborted: false });
      return;
    }

    if (riskEl) {
      riskEl.textContent = risk === 'low' ? '低风险' : (risk === 'medium' ? '中风险' : '高风险');
      riskEl.className = `shell-audit-risk ${risk}`;
    }
    if (necEl) necEl.textContent = info.necessary ? '必要性：通过' : '必要性：存疑';
    if (reasonEl) reasonEl.textContent = info.reason || '审核 AI 未提供理由。';
    if (cwdEl) cwdEl.textContent = cwd || '(默认工作目录)';
    if (cmdEl) cmdEl.textContent = command || '';
    if (concernsEl) {
      const concerns = Array.isArray(info.concerns) ? info.concerns.filter(Boolean) : [];
      concernsEl.innerHTML = concerns.length
        ? concerns.map(c => `<li>${shellAuditEscape(c)}</li>`).join('')
        : '<li>审核结果未列出具体风险点。</li>';
    }
    mask.classList.add('show');

    const signal = context && context.signal;
    if (signal) {
      const abort = () => shellAuditConfirmReject(true);
      if (signal.aborted) abort();
      else {
        signal.addEventListener('abort', abort, { once: true });
        mask._shellAuditAbort = abort;
        mask._shellAuditAbortSignal = signal;
      }
    }
  });
}

function cleanupShellAuditConfirmAbort() {
  const mask = document.getElementById('shellAuditConfirmMask');
  if (mask && mask._shellAuditAbortSignal && mask._shellAuditAbort) {
    try { mask._shellAuditAbortSignal.removeEventListener('abort', mask._shellAuditAbort); } catch (e) {}
  }
  if (mask) {
    mask._shellAuditAbortSignal = null;
    mask._shellAuditAbort = null;
  }
}

function shellAuditConfirmAccept() {
  const mask = document.getElementById('shellAuditConfirmMask');
  if (mask) mask.classList.remove('show');
  cleanupShellAuditConfirmAbort();
  if (_shellAuditConfirmResolve) {
    _shellAuditConfirmResolve({ allowed: true, aborted: false });
    _shellAuditConfirmResolve = null;
  }
}

function shellAuditConfirmReject(aborted) {
  const mask = document.getElementById('shellAuditConfirmMask');
  if (mask) mask.classList.remove('show');
  cleanupShellAuditConfirmAbort();
  if (_shellAuditConfirmResolve) {
    _shellAuditConfirmResolve({ allowed: false, aborted: !!aborted });
    _shellAuditConfirmResolve = null;
  }
}

function renderShellAuditSettings() {
  const container = document.getElementById('shellAuditSettings');
  if (!container) return;
  const cfg = getShellAuditSettings();
  const profiles = typeof loadApiProfiles === 'function' ? loadApiProfiles() : [];
  const models = shellAuditModelList(cfg.profileId);
  const selectedModel = shellAuditResolveModel(cfg);
  if (selectedModel && !models.includes(selectedModel)) models.unshift(selectedModel);
  const profileOptions = [
    `<option value="${SHELL_AUDIT_CURRENT_PROFILE}"${cfg.profileId === SHELL_AUDIT_CURRENT_PROFILE ? ' selected' : ''}>使用当前主 API 设置</option>`,
    ...profiles.map(p => `<option value="${shellAuditEscape(p.id)}"${cfg.profileId === p.id ? ' selected' : ''}>${shellAuditEscape(p.name || p.id)}</option>`)
  ].join('');
  const modelOptions = models.length
    ? models.map(m => `<option value="${shellAuditEscape(m)}"${selectedModel === m ? ' selected' : ''}>${shellAuditEscape(m)}</option>`).join('')
    : `<option value="">暂无模型，请在 API Profile 中配置</option>`;

  container.innerHTML = `
    <div class="shell-audit-panel">
      <label class="shell-audit-toggle">
        <input type="checkbox" id="shellAuditEnabled" ${cfg.enabled ? 'checked' : ''} onchange="saveShellAuditSettingsFromUi()">
        <span>
          <strong>Shell 命令 AI 审核</strong>
          <em>只审核 execute_action。权限放行后仍会检查当前用户请求与命令是否匹配。</em>
        </span>
      </label>

      <div class="shell-audit-grid">
        <div class="form-group">
          <label for="shellAuditProfile">审核 API Profile</label>
          <select id="shellAuditProfile" onchange="onShellAuditProfileChange()">${profileOptions}</select>
        </div>
        <div class="form-group">
          <label for="shellAuditModel">审核模型</label>
          <select id="shellAuditModel" onchange="saveShellAuditSettingsFromUi()">${modelOptions}</select>
        </div>
      </div>

      <div class="form-group">
        <label for="shellAuditPrompt">注入给审核 AI 的 Prompt</label>
        <textarea id="shellAuditPrompt" rows="8" oninput="saveShellAuditSettingsFromUi()">${shellAuditEscape(cfg.prompt || SHELL_AUDIT_DEFAULT_PROMPT)}</textarea>
        <div class="form-hint shell-audit-hint">审核 AI 只会收到当前轮用户消息和待执行命令，不会收到完整上下文、工具结果或工作目录。</div>
      </div>

      <div class="shell-audit-actions">
        <button class="btn" type="button" onclick="resetShellAuditPrompt()">恢复默认 Prompt</button>
      </div>
    </div>
  `;
}

function saveShellAuditSettingsFromUi() {
  const cfg = getShellAuditSettings();
  const enabled = document.getElementById('shellAuditEnabled');
  const profile = document.getElementById('shellAuditProfile');
  const model = document.getElementById('shellAuditModel');
  const prompt = document.getElementById('shellAuditPrompt');
  if (enabled) cfg.enabled = !!enabled.checked;
  if (profile) cfg.profileId = profile.value || SHELL_AUDIT_CURRENT_PROFILE;
  if (model) cfg.model = model.value || '';
  if (prompt) cfg.prompt = prompt.value || SHELL_AUDIT_DEFAULT_PROMPT;
  if (typeof persistSettings === 'function') persistSettings();
}

function onShellAuditProfileChange() {
  const cfg = getShellAuditSettings();
  const profile = document.getElementById('shellAuditProfile');
  if (profile) cfg.profileId = profile.value || SHELL_AUDIT_CURRENT_PROFILE;
  const models = shellAuditModelList(cfg.profileId);
  cfg.model = models[0] || '';
  if (typeof persistSettings === 'function') persistSettings();
  renderShellAuditSettings();
}

function resetShellAuditPrompt() {
  const cfg = getShellAuditSettings();
  cfg.prompt = SHELL_AUDIT_DEFAULT_PROMPT;
  if (typeof persistSettings === 'function') persistSettings();
  renderShellAuditSettings();
  if (typeof toast === 'function') toast('已恢复 Shell 审核默认 Prompt', 1800);
}

window.ensureShellAuditSettings = ensureShellAuditSettings;
window.getShellAuditSettings = getShellAuditSettings;
window.reviewShellCommandWithAI = reviewShellCommandWithAI;
window.shellAuditConfirmRisk = shellAuditConfirmRisk;
window.shellAuditConfirmAccept = shellAuditConfirmAccept;
window.shellAuditConfirmReject = shellAuditConfirmReject;
window.renderShellAuditSettings = renderShellAuditSettings;
window.saveShellAuditSettingsFromUi = saveShellAuditSettingsFromUi;
window.onShellAuditProfileChange = onShellAuditProfileChange;
window.resetShellAuditPrompt = resetShellAuditPrompt;

if (typeof state !== 'undefined') ensureShellAuditSettings();
