// ============ Privacy Guard ============
// Local-only outbound redaction for untrusted relay usage.

const PRIVACY_GUARD_DEFAULTS = {
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
};

const PRIVACY_GUARD_HIGH_RISK_TYPES = new Set(['SECRET', 'PASSWORD', 'COOKIE', 'PRIVATE_KEY']);
const PRIVACY_GUARD_CONTEXT_PROP = '__privacyGuardContext';
const PRIVACY_GUARD_SESSION_MAP_KEY = 'aichat_privacy_restore_session_v1';
const PRIVACY_GUARD_LOCAL_MAP_KEY = 'aichat_privacy_restore_local_v1';
const PRIVACY_GUARD_RESTORE_MAP_LIMIT = 2000;

const PrivacyGuardStateModule = window.AgentApp.require('state');
const PrivacyGuardUiService = window.AgentApp.require('uiService');
const privacyGuardState = PrivacyGuardStateModule.state;
const privacyGuardPersistSettings = PrivacyGuardStateModule.persistSettings;

const PRIVACY_GUARD_DETECTORS = [
  {
    key: 'secrets',
    type: 'PRIVATE_KEY',
    highRisk: true,
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
  },
  {
    key: 'secrets',
    type: 'SECRET',
    highRisk: true,
    re: /\b(?:sk-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/g
  },
  {
    key: 'secrets',
    type: 'COOKIE',
    highRisk: true,
    re: /\b(?:cookie|set-cookie|authorization|bearer|token|api[_-]?key|secret|session(?:id)?|jwt)\s*[:=]\s*["']?[^"'\s;,\]}]{8,}/gi
  },
  {
    key: 'secrets',
    type: 'PASSWORD',
    highRisk: true,
    re: /\b(?:password|passwd|pwd|passphrase)\s*[:=]\s*["']?[^"'\s;,\]}]{4,}/gi
  },
  {
    key: 'email',
    type: 'EMAIL',
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  },
  {
    key: 'phone',
    type: 'PHONE',
    re: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)|(?<!\d)(?:\+?1[-.\s]?)?(?:\(?[2-9]\d{2}\)?[-.\s]?)?[2-9]\d{2}[-.\s]?\d{4}(?!\d)/g
  },
  {
    key: 'idCard',
    type: 'ID',
    re: /\b\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g
  },
  {
    key: 'bankCard',
    type: 'BANK_CARD',
    re: /\b(?:\d[ -]?){13,19}\b/g,
    validate: value => {
      const digits = String(value).replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhnCheck(digits);
    }
  },
  {
    key: 'ipv4',
    type: 'IP',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g
  },
  {
    key: 'url',
    type: 'URL',
    re: /\bhttps?:\/\/[^\s<>"'`]+/gi
  },
  {
    key: 'filePath',
    type: 'FILE_PATH',
    re: /(?:[A-Za-z]:\\[^\s<>"'`|]+|\/(?:Users|home|var|tmp|etc|opt|mnt|Volumes)\/[^\s<>"'`]+)/g
  },
  {
    key: 'personName',
    type: 'NAME',
    re: /(?:姓名|联系人|收件人|客户|用户|负责人)\s*[:：]\s*[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s.·-]{1,24}/g
  }
];

let PRIVACY_GUARD_REQUEST_STATE = null;
let PRIVACY_GUARD_LAST_REPORT = null;
let PRIVACY_GUARD_CONTEXT_SEQ = 0;

function createPrivacyGuardRequestState(cfg, options = {}) {
  const retention = normalizePrivacyRestoreRetention(cfg.localRestoreRetention);
  const restoreMap = cfg.localRestoreEnabled ? loadPrivacyGuardRestoreMap(retention) : {};
  return {
    id: ++PRIVACY_GUARD_CONTEXT_SEQ,
    cfg,
    options,
    restoreRetention: retention,
    restoreScope: createPrivacyRestoreScope(),
    counters: {},
    strippedAttachments: 0,
    textAttachments: 0,
    highRiskCount: 0,
    replacementCounters: {},
    restoreMap,
    restoreNewCount: 0,
    lastByType: {},
    warnings: []
  };
}

function clonePrivacyGuardDefaults() {
  return JSON.parse(JSON.stringify(PRIVACY_GUARD_DEFAULTS));
}

function ensurePrivacyGuardSettings() {
  if (!privacyGuardState.settings) privacyGuardState.settings = {};
  const existing = privacyGuardState.settings.privacyGuard || {};
  const defaults = clonePrivacyGuardDefaults();
  privacyGuardState.settings.privacyGuard = {
    ...defaults,
    ...existing,
    fakeTemplates: {
      ...defaults.fakeTemplates,
      ...(existing.fakeTemplates || {})
    },
    detector: {
      ...defaults.detector,
      ...(existing.detector || {})
    }
  };
  return privacyGuardState.settings.privacyGuard;
}

function getPrivacyGuardSettings() {
  return ensurePrivacyGuardSettings();
}

function isPrivacyGuardEnabled() {
  const cfg = getPrivacyGuardSettings();
  return !!cfg.enabled;
}

function beginPrivacyGuardRequest(options = {}) {
  const cfg = normalizePrivacyGuardRuntimeConfig(getPrivacyGuardSettings());
  if (!cfg.enabled) {
    PRIVACY_GUARD_REQUEST_STATE = null;
    return null;
  }
  PRIVACY_GUARD_REQUEST_STATE = createPrivacyGuardRequestState(cfg, options);
  return PRIVACY_GUARD_REQUEST_STATE;
}

function endPrivacyGuardRequest(reportOptions = {}) {
  const req = PRIVACY_GUARD_REQUEST_STATE;
  PRIVACY_GUARD_REQUEST_STATE = null;
  if (!req) return null;
  const report = {
    counters: { ...req.counters },
    strippedAttachments: req.strippedAttachments,
    textAttachments: req.textAttachments,
    highRiskCount: req.highRiskCount,
    restoreCount: req.restoreNewCount || 0,
    localRestoreEnabled: !!req.cfg.localRestoreEnabled,
    localRestoreRetention: req.restoreRetention || 'request',
    warnings: req.warnings.slice(),
    ts: Date.now()
  };
  PRIVACY_GUARD_LAST_REPORT = report;
  if (typeof recordPrivacySecurityEvent === 'function') {
    recordPrivacySecurityEvent(report, { source: req.options?.source || reportOptions.source || '' });
  }
  return report;
}

function withPrivacyGuardRequest(fn, options = {}) {
  const req = beginPrivacyGuardRequest(options);
  let result;
  try {
    result = fn();
  } finally {
    if (req) {
      endPrivacyGuardRequest({ silent: options.silentReport });
      attachPrivacyGuardContext(result, req);
    }
  }
  return result;
}

function normalizePrivacyGuardRuntimeConfig(cfg) {
  const out = clonePrivacyValue(cfg || {});
  if (out.localRestoreEnabled) out.replacementMode = 'mask';
  out.localRestoreRetention = normalizePrivacyRestoreRetention(out.localRestoreRetention);
  return out;
}

function buildPrivacyGuardContext(req) {
  if (!req) return null;
  return {
    id: req.id || 0,
    enabled: !!req.cfg?.enabled,
    localRestoreEnabled: !!req.cfg?.localRestoreEnabled,
    localRestoreRetention: req.restoreRetention || 'request',
    responseGuardEnabled: !!req.cfg?.responseGuardEnabled,
    responseGuardMarker: normalizePrivacyMarker(req.cfg?.responseGuardMarker),
    responseGuardAction: req.cfg?.responseGuardAction || 'trim',
    restoreMap: { ...(req.restoreMap || {}) }
  };
}

function attachPrivacyGuardContext(target, req) {
  if (!target || !req) return target;
  const ctx = buildPrivacyGuardContext(req);
  if (!ctx) return target;
  try {
    Object.defineProperty(target, PRIVACY_GUARD_CONTEXT_PROP, {
      value: ctx,
      enumerable: false,
      configurable: true
    });
  } catch (e) {
    try { target[PRIVACY_GUARD_CONTEXT_PROP] = ctx; } catch (err) {}
  }
  return target;
}

function getPrivacyGuardContext(source) {
  if (source && typeof source === 'object') {
    if (source[PRIVACY_GUARD_CONTEXT_PROP]) return source[PRIVACY_GUARD_CONTEXT_PROP];
    if (source.body && typeof source.body === 'object' && source.body[PRIVACY_GUARD_CONTEXT_PROP]) {
      return source.body[PRIVACY_GUARD_CONTEXT_PROP];
    }
  }
  return null;
}

function recordPrivacyGuardRestore(req, placeholder, original) {
  if (!req || !req.cfg?.localRestoreEnabled) return;
  if (placeholder == null || original == null) return;
  const key = String(placeholder);
  if (!key) return;
  if (Object.prototype.hasOwnProperty.call(req.restoreMap, key)) return;
  req.restoreMap[key] = String(original);
  req.restoreNewCount = (req.restoreNewCount || 0) + 1;
  savePrivacyGuardRestoreEntry(req.restoreRetention || req.cfg.localRestoreRetention, key, original);
}

function normalizePrivacyRestoreRetention(value) {
  const v = String(value || 'request').trim();
  return ['request', 'session', 'local'].includes(v) ? v : 'request';
}

function createPrivacyRestoreScope() {
  try {
    const bytes = new Uint8Array(4);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
  } catch (e) {}
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function privacyRestoreStorageKey(retention) {
  const normalized = normalizePrivacyRestoreRetention(retention);
  if (normalized === 'session') return PRIVACY_GUARD_SESSION_MAP_KEY;
  if (normalized === 'local') return PRIVACY_GUARD_LOCAL_MAP_KEY;
  return '';
}

function loadPrivacyGuardRestoreMap(retention) {
  const key = privacyRestoreStorageKey(retention);
  if (!key) return {};
  try {
    const raw = retention === 'session'
      ? (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : '')
      : (typeof storage !== 'undefined' ? storage.get(key) : '');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function savePrivacyGuardRestoreEntry(retention, placeholder, original) {
  const normalized = normalizePrivacyRestoreRetention(retention);
  if (normalized === 'request') return;
  const key = privacyRestoreStorageKey(normalized);
  if (!key) return;
  const map = loadPrivacyGuardRestoreMap(normalized);
  map[String(placeholder)] = String(original);
  prunePrivacyRestoreMap(map);
  try {
    const payload = JSON.stringify(map);
    if (normalized === 'session') {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, payload);
    } else if (typeof storage !== 'undefined') {
      storage.set(key, payload);
    }
  } catch (e) {
    console.warn('[privacy] 保存本地还原映射失败:', e.message);
  }
}

function prunePrivacyRestoreMap(map) {
  const keys = Object.keys(map || {});
  if (keys.length <= PRIVACY_GUARD_RESTORE_MAP_LIMIT) return map;
  const removeCount = keys.length - PRIVACY_GUARD_RESTORE_MAP_LIMIT;
  for (const key of keys.slice(0, removeCount)) delete map[key];
  return map;
}

function clearPrivacyGuardRestoreStore(retention) {
  const normalized = normalizePrivacyRestoreRetention(retention);
  const key = privacyRestoreStorageKey(normalized);
  if (!key) return;
  try {
    if (normalized === 'session') {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key);
    } else if (typeof storage !== 'undefined') {
      storage.remove(key);
    }
  } catch (e) {}
}

function clearAllPrivacyGuardRestoreStores() {
  clearPrivacyGuardRestoreStore('session');
  clearPrivacyGuardRestoreStore('local');
}

function showPrivacyGuardReport(report) {
  if (!report) return;
  const total = Object.values(report.counters || {}).reduce((sum, n) => sum + n, 0);
  const stripped = report.strippedAttachments || 0;
  if (!total && !stripped) return;
  const parts = [];
  if (total) parts.push(`脱敏 ${total} 处`);
  if (stripped) parts.push(`剥离 ${stripped} 个附件`);
  PrivacyGuardUiService.toast('隐私模式：' + parts.join('，'), 2400);
}

function privacyGuardPrepareHistory(history, options = {}) {
  const cfg = normalizePrivacyGuardRuntimeConfig(getPrivacyGuardSettings());
  if (!cfg.enabled) return history;
  const req = PRIVACY_GUARD_REQUEST_STATE || createPrivacyGuardRequestState(cfg, options);
  const list = Array.isArray(history) ? history : [];
  return list.map(m => sanitizePrivacyMessage(m, req, options)).filter(Boolean);
}

function sanitizePrivacyMessage(message, req, options = {}) {
  if (!message || typeof message !== 'object') return message;
  const m = clonePrivacyValue(message);
  if (m.role === 'assistant' && !req.cfg.includeAssistantHistory) return m;

  if (typeof m.content === 'string' && shouldSanitizeMessageContent(m, req.cfg)) {
    m.content = sanitizePrivacyText(m.content, req);
  } else if (Array.isArray(m.content) && shouldSanitizeMessageContent(m, req.cfg)) {
    m.content = sanitizePrivacyContentParts(m.content, req);
  } else if (m.content && typeof m.content === 'object' && shouldSanitizeMessageContent(m, req.cfg)) {
    m.content = sanitizePrivacyStructuredValue(m.content, req);
  }

  if (Array.isArray(m.attachments)) {
    m.attachments = sanitizePrivacyAttachments(m.attachments, req);
  }

  if (Array.isArray(m.tool_calls)) {
    m.tool_calls = m.tool_calls.map(tc => sanitizePrivacyToolCall(tc, req));
  }

  if (Array.isArray(m._responsesOutput)) {
    m._responsesOutput = m._responsesOutput.map(item => sanitizePrivacyResponsesOutput(item, req));
  }

  return m;
}

function shouldSanitizeMessageContent(message, cfg) {
  if (!message || !cfg.enabled) return false;
  if (message.role === 'tool') return !!cfg.includeToolResults;
  if (message.role === 'assistant') return !!cfg.includeAssistantHistory;
  return true;
}

function sanitizePrivacyContentParts(parts, req) {
  return parts.map(part => {
    if (!part || typeof part !== 'object') return part;
    const next = clonePrivacyValue(part);
    if (typeof next.text === 'string') next.text = sanitizePrivacyText(next.text, req);
    if (typeof next.content === 'string') next.content = sanitizePrivacyText(next.content, req);
    if (typeof next.output === 'string') next.output = sanitizePrivacyText(next.output, req);
    if (next.input && typeof next.input === 'object') next.input = sanitizePrivacyStructuredValue(next.input, req);
    if (typeof next.arguments === 'string') next.arguments = sanitizePrivacyText(next.arguments, req);
    return next;
  });
}

function sanitizePrivacyStructuredValue(value, req) {
  if (typeof value === 'string') return sanitizePrivacyText(value, req);
  if (Array.isArray(value)) return value.map(v => sanitizePrivacyStructuredValue(v, req));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).forEach(key => {
    out[key] = sanitizePrivacyStructuredValue(value[key], req);
  });
  return out;
}

function sanitizePrivacyToolCall(tc, req) {
  const next = clonePrivacyValue(tc);
  if (next.function && typeof next.function.arguments === 'string') {
    next.function.arguments = sanitizePrivacyText(next.function.arguments, req);
  }
  if (typeof next.arguments === 'string') next.arguments = sanitizePrivacyText(next.arguments, req);
  return next;
}

function sanitizePrivacyResponsesOutput(item, req) {
  const next = clonePrivacyValue(item);
  if (typeof next.arguments === 'string') next.arguments = sanitizePrivacyText(next.arguments, req);
  if (Array.isArray(next.content)) next.content = sanitizePrivacyContentParts(next.content, req);
  return next;
}

function sanitizePrivacyAttachments(attachments, req) {
  return (attachments || []).map(att => {
    if (!att || typeof att !== 'object') return att;
    const a = clonePrivacyValue(att);
    if (a._stripped) return a;
    const shouldStripBinary = !!a.data && req.cfg.binaryAttachmentPolicy === 'strip';

    if (a.type === 'file' && typeof a.text === 'string') {
      if (req.cfg.includeTextAttachments) {
        a.text = sanitizePrivacyText(a.text, req);
        req.textAttachments += 1;
      }
      if (shouldStripBinary) {
        delete a.data;
        req.strippedAttachments += 1;
        if (a.mime === 'application/pdf') {
          a._stripped = true;
          a._strippedReason = '隐私模式已剥离 PDF 原始数据；可在隐私设置中改为继续发送。';
        }
      }
      return a;
    }

    if (shouldStripBinary) {
      delete a.data;
      delete a.text;
      a._stripped = true;
      a._strippedReason = '隐私模式已剥离二进制附件；可在隐私设置中改为继续发送。';
      req.strippedAttachments += 1;
    }
    return a;
  });
}

function sanitizePrivacyText(text, req) {
  if (!req || !req.cfg || !req.cfg.enabled || typeof text !== 'string' || !text) return text;
  let output = text;
  for (const detector of PRIVACY_GUARD_DETECTORS) {
    if (!req.cfg.detector || !req.cfg.detector[detector.key]) continue;
    output = output.replace(detector.re, match => {
      if (detector.validate && !detector.validate(match)) return match;
      return makePrivacyReplacement(match, detector.type, !!detector.highRisk, req);
    });
  }

  output = sanitizeCustomTerms(output, req);
  output = sanitizeCustomRegex(output, req);
  return output;
}

function sanitizeCustomTerms(text, req) {
  if (!req.cfg.detector?.customTerms || !req.cfg.customTerms) return text;
  const terms = String(req.cfg.customTerms)
    .split(/\r?\n|,/)
    .map(s => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  let output = text;
  for (const term of terms) {
    const re = new RegExp(escapePrivacyRegExp(term), 'g');
    output = output.replace(re, match => makePrivacyReplacement(match, 'CUSTOM', false, req));
  }
  return output;
}

function sanitizeCustomRegex(text, req) {
  if (!req.cfg.detector?.customRegex || !req.cfg.customRegex) return text;
  let output = text;
  const lines = String(req.cfg.customRegex).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (const pattern of lines) {
    try {
      const parsed = parsePrivacyRegex(pattern);
      output = output.replace(parsed, match => makePrivacyReplacement(match, 'CUSTOM_REGEX', false, req));
    } catch (e) {
      if (!req.warnings.includes('customRegex')) req.warnings.push('customRegex');
    }
  }
  return output;
}

function makePrivacyReplacement(match, type, highRisk, req) {
  const safeType = String(type || 'VALUE').toUpperCase();
  if (highRisk || PRIVACY_GUARD_HIGH_RISK_TYPES.has(safeType)) req.highRiskCount += 1;
  req.counters[safeType] = (req.counters[safeType] || 0) + 1;
  if (highRisk && req.cfg.stripHighRisk) return `[REDACTED_${safeType}]`;
  if (req.cfg.replacementMode === 'fake') return fakePrivacyValue(safeType, req);
  req.replacementCounters[safeType] = (req.replacementCounters[safeType] || 0) + 1;
  const seq = String(req.replacementCounters[safeType]).padStart(2, '0');
  const placeholder = req.restoreRetention === 'request'
    ? `[MASK_${safeType}_${seq}]`
    : `[MASK_${req.restoreScope}_${safeType}_${seq}]`;
  recordPrivacyGuardRestore(req, placeholder, match);
  return placeholder;
}

function fakePrivacyValue(type, req) {
  req.replacementCounters[type] = (req.replacementCounters[type] || 0) + 1;
  const n = req.replacementCounters[type];
  const seq = String(n).padStart(2, '0');
  const template = req.cfg.fakeTemplates?.[type] || PRIVACY_GUARD_DEFAULTS.fakeTemplates[type] || `[FAKE_${type}_{seq}]`;
  return formatPrivacyFakeTemplate(template, type, n, seq);
}

function formatPrivacyFakeTemplate(template, type, n, seq) {
  const replacements = {
    type,
    n: String(n),
    seq,
    n3: String(n).padStart(3, '0'),
    n4: String(n).padStart(4, '0'),
    ip: String(Math.min(n, 254)),
    id3: String(100 + n).slice(-3),
    bank4: String(1000 + n).slice(-4)
  };
  return String(template || `[FAKE_${type}_{seq}]`).replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match;
  });
}

function privacyGuardSanitizeSystemText(text, options = {}) {
  const cfg = normalizePrivacyGuardRuntimeConfig(getPrivacyGuardSettings());
  let out = String(text || '');
  if (cfg.enabled && cfg.includeSystemPrompt) {
    const tempReq = PRIVACY_GUARD_REQUEST_STATE || createPrivacyGuardRequestState(cfg, { systemOnly: true });
    out = sanitizePrivacyText(out, tempReq);
  }
  const suffix = privacyGuardSystemSuffix(options);
  if (suffix && !out.includes(suffix)) {
    out = out ? `${out}\n\n${suffix}` : suffix;
  }
  return out;
}

function privacyGuardSystemSuffix(options = {}) {
  return buildPrivacyGuardSystemSuffix(getPrivacyGuardSettings(), options);
}

function buildPrivacyGuardSystemSuffix(inputCfg, options = {}) {
  const cfg = normalizePrivacyGuardRuntimeConfig(inputCfg || {});
  if (!cfg.enabled) return '';
  const lines = [];
  if (cfg.addSafetyInstruction) {
    const instruction = cfg.localRestoreEnabled
      ? cfg.localRestoreInstructionText
      : cfg.safetyInstructionText;
    const text = String(instruction || '').trim();
    if (text) lines.push(text);
  }
  if (cfg.responseGuardEnabled && options.includeResponseGuard !== false) {
    const marker = normalizePrivacyMarker(cfg.responseGuardMarker);
    lines.push(formatPrivacyInstructionTemplate(cfg.responseGuardInstructionText, {
      marker
    }));
  }
  return lines.join('\n');
}

function formatPrivacyInstructionTemplate(template, values = {}) {
  const fallback = PRIVACY_GUARD_DEFAULTS.responseGuardInstructionText;
  return String(template || fallback).replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}

function privacyGuardFinalizeAssistantMessage(msg, options = {}) {
  const cfg = getPrivacyGuardSettings();
  const ctx = getPrivacyGuardContext(options && (options.context || options.request || options));
  const active = !!cfg.enabled || !!ctx?.enabled;
  if (!active || !msg || typeof msg.content !== 'string') return msg;
  const responseGuardEnabled = ctx ? !!ctx.responseGuardEnabled : !!cfg.responseGuardEnabled;
  const responseGuardMarker = ctx?.responseGuardMarker || cfg.responseGuardMarker;
  const responseGuardAction = ctx?.responseGuardAction || cfg.responseGuardAction;
  const shouldCheckResponseGuard = responseGuardEnabled
    && options.includeResponseGuard !== false
    && options.skipResponseGuard !== true;
  if (shouldCheckResponseGuard) {
    const marker = normalizePrivacyMarker(responseGuardMarker);
    if (marker) {
      const idx = findPrivacyResponseGuardMarkerIndex(msg.content, marker);
      if (idx >= 0) {
        const tail = msg.content.slice(idx + marker.length).trim();
        msg.content = msg.content.slice(0, idx).trimEnd();
        if (Array.isArray(msg._responsesOutput)) {
          syncPrivacyResponsesOutputText(msg._responsesOutput, msg.content);
        }
        msg._privacyGuardMarkerOk = true;
        msg._privacyGuardMarkerTrimmedTail = !!tail;
        recordPrivacyResponseGuardEvent({
          status: 'ok',
          marker,
          action: responseGuardAction,
          source: options.source || '',
          trimmedTail: !!tail,
          ctx,
          cfg
        });
      } else {
        msg._privacyGuardMarkerMissing = true;
        recordPrivacyResponseGuardEvent({
          status: 'missing',
          marker,
          action: responseGuardAction,
          source: options.source || '',
          trimmedTail: false,
          ctx,
          cfg
        });
        if (responseGuardAction === 'warn') {
          msg.content = `${msg.content.trimEnd()}\n\n*[隐私防尾注提醒：未检测到结束标记，返回内容可能被中转站追加或模型未遵循标记要求。]*`;
        }
      }
    }
  }
  if (ctx?.localRestoreEnabled || cfg.localRestoreEnabled) {
    msg.content = privacyGuardRestoreText(msg.content, options);
    if (Array.isArray(msg._responsesOutput)) {
      syncPrivacyResponsesOutputText(msg._responsesOutput, msg.content);
    }
  }
  return msg;
}

function findPrivacyResponseGuardMarkerIndex(content, marker) {
  const text = String(content || '');
  const safeMarker = String(marker || '');
  if (!text || !safeMarker) return -1;
  const escaped = escapePrivacyRegExp(safeMarker);
  const re = new RegExp(`(^|\\r?\\n)[ \\t]*${escaped}[ \\t]*(?=\\r?\\n|$)`, 'g');
  let match;
  let idx = -1;
  while ((match = re.exec(text)) !== null) {
    const full = match[0] || '';
    const prefix = match[1] || '';
    const leading = (full.slice(prefix.length).match(/^[ \t]*/) || [''])[0].length;
    idx = match.index + prefix.length + leading;
    if (re.lastIndex === match.index) re.lastIndex += 1;
  }
  return idx;
}

function recordPrivacyResponseGuardEvent({ status, marker, action, source, trimmedTail, ctx, cfg } = {}) {
  if (typeof recordPrivacySecurityEvent !== 'function') return;
  const normalizedStatus = status === 'missing' ? 'missing' : 'ok';
  recordPrivacySecurityEvent({
    counters: {},
    strippedAttachments: 0,
    textAttachments: 0,
    highRiskCount: 0,
    restoreCount: 0,
    localRestoreEnabled: !!(ctx?.localRestoreEnabled || cfg?.localRestoreEnabled),
    localRestoreRetention: ctx?.localRestoreRetention || cfg?.localRestoreRetention || '',
    warnings: normalizedStatus === 'missing' ? ['responseGuardMissing'] : [],
    responseGuard: {
      status: normalizedStatus,
      marker: normalizePrivacyMarker(marker),
      action: action || 'trim',
      source: source || '',
      trimmedTail: !!trimmedTail
    },
    ts: Date.now()
  }, { source: source || '' });
}

function syncPrivacyResponsesOutputText(output, cleanText) {
  let replaced = false;
  for (const item of output || []) {
    if (!item || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!part || (part.type !== 'output_text' && part.type !== 'text')) continue;
      part.text = replaced ? '' : cleanText;
      replaced = true;
    }
  }
}

function privacyGuardFinalizeText(text, options = {}) {
  const holder = { content: String(text || '') };
  privacyGuardFinalizeAssistantMessage(holder, options);
  return holder.content;
}

function privacyGuardRestoreText(text, options = {}) {
  if (typeof text !== 'string' || !text) return text;
  const ctx = getPrivacyGuardContext(options && (options.context || options.request || options));
  const cfg = getPrivacyGuardSettings();
  const retention = ctx?.localRestoreRetention || cfg.localRestoreRetention;
  const map = ctx && ctx.localRestoreEnabled
    ? (ctx.restoreMap || {})
    : (cfg.enabled && cfg.localRestoreEnabled ? loadPrivacyGuardRestoreMap(retention) : {});
  const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  if (!entries.length) return text;
  let out = text;
  for (const [placeholder, original] of entries) {
    out = out.split(placeholder).join(original);
  }
  return out;
}

function privacyGuardRestoreValue(value, options = {}) {
  const ctx = getPrivacyGuardContext(options && (options.context || options.request || options));
  const cfg = getPrivacyGuardSettings();
  if (!ctx?.localRestoreEnabled && !(cfg.enabled && cfg.localRestoreEnabled && normalizePrivacyRestoreRetention(cfg.localRestoreRetention) !== 'request')) return value;
  if (typeof value === 'string') return privacyGuardRestoreText(value, options);
  if (Array.isArray(value)) return value.map(v => privacyGuardRestoreValue(v, options));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).forEach(key => {
    out[key] = privacyGuardRestoreValue(value[key], options);
  });
  return out;
}

function privacyGuardRestoreToolCallArguments(args, options = {}) {
  return privacyGuardRestoreValue(args, options);
}

function privacyGuardSanitizeAuxiliarySystemText(text) {
  return typeof privacyGuardSanitizeSystemText === 'function'
    ? privacyGuardSanitizeSystemText(text || '', { includeResponseGuard: false })
    : (text || '');
}

function normalizePrivacyMarker(marker) {
  const value = String(marker || '').trim();
  return value || PRIVACY_GUARD_DEFAULTS.responseGuardMarker;
}

function clonePrivacyValue(value) {
  if (value === null || value === undefined) return value;
  try { return JSON.parse(JSON.stringify(value)); }
  catch (e) {
    if (Array.isArray(value)) return value.map(clonePrivacyValue);
    if (typeof value === 'object') return { ...value };
    return value;
  }
}

function luhnCheck(digits) {
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (doubleIt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleIt = !doubleIt;
  }
  return sum % 10 === 0;
}

function escapePrivacyRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePrivacyRegex(pattern) {
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    const idx = pattern.lastIndexOf('/');
    const body = pattern.slice(1, idx);
    const flags = pattern.slice(idx + 1) || 'g';
    return new RegExp(body, flags.includes('g') ? flags : flags + 'g');
  }
  return new RegExp(pattern, 'g');
}

function togglePrivacyGuard() {
  const cfg = getPrivacyGuardSettings();
  if (privacyGuardState.settings?.securityMode && cfg.enabled) {
    cfg.enabled = true;
    updatePrivacyGuardButton();
    PrivacyGuardUiService.toast('安全模式已开启，隐私模式会保持启用');
    return;
  }
  cfg.enabled = !cfg.enabled;
  privacyGuardPersistSettings();
  updatePrivacyGuardButton();
  PrivacyGuardUiService.updateSendBtn();
  PrivacyGuardUiService.toast(cfg.enabled ? '隐私模式已开启' : '隐私模式已关闭');
}

function updatePrivacyGuardButton() {
  const btn = document.getElementById('privacyBtn');
  if (!btn) return;
  const cfg = getPrivacyGuardSettings();
  btn.classList.toggle('privacy-active', !!cfg.enabled);
  btn.setAttribute('aria-pressed', cfg.enabled ? 'true' : 'false');
  btn.title = cfg.enabled
    ? '隐私模式已开启，点击关闭；右键打开设置'
    : '隐私模式已关闭，点击开启；右键打开设置';
}

function buildPrivacySettingsModal() {
  let mask = document.getElementById('privacyModal');
  if (mask) return mask;
  mask = document.createElement('div');
  mask.className = 'modal-mask privacy-modal';
  mask.id = 'privacyModal';
  document.body.appendChild(mask);
  return mask;
}

function openPrivacySettings() {
  const mask = buildPrivacySettingsModal();
  renderPrivacySettings();
  mask.classList.add('show');
}

function closePrivacySettings() {
  const mask = document.getElementById('privacyModal');
  if (mask) mask.classList.remove('show');
}

function renderPrivacySettings() {
  const mask = buildPrivacySettingsModal();
  const cfg = getPrivacyGuardSettings();
  const replacementMode = cfg.localRestoreEnabled ? 'mask' : cfg.replacementMode;
  mask.innerHTML = `
    <div class="modal wide privacy-settings-panel">
      <h2>隐私模式 <button class="modal-close" data-action="closePrivacySettings">×</button></h2>

      <div class="json-help privacy-help">
        此功能在本地构造请求体前替换敏感文本，尽量降低不可信中转站看到真实数据的概率。它不能保护上游鉴权 Key，也不能对已发送到中转站的内容做加密；图片/PDF 默认会被剥离。
      </div>

      <section class="privacy-section">
        <div class="privacy-section-head">
          <div>
            <div class="privacy-section-title">一键模式</div>
            <div class="form-hint">顶栏“隐私”按钮控制同一个开关。</div>
          </div>
          ${privacySwitch('pgEnabled', cfg.enabled)}
        </div>
      </section>

      <section class="privacy-section">
        <div class="privacy-section-title">检测与替换</div>
        <div class="privacy-grid">
          ${privacyCheck('pgDetectSecrets', '密钥 / Token / Cookie / 密码', cfg.detector.secrets)}
          ${privacyCheck('pgDetectEmail', '邮箱', cfg.detector.email)}
          ${privacyCheck('pgDetectPhone', '手机号 / 电话', cfg.detector.phone)}
          ${privacyCheck('pgDetectIdCard', '身份证号', cfg.detector.idCard)}
          ${privacyCheck('pgDetectBankCard', '银行卡号', cfg.detector.bankCard)}
          ${privacyCheck('pgDetectIpv4', 'IPv4 地址', cfg.detector.ipv4)}
          ${privacyCheck('pgDetectUrl', 'URL', cfg.detector.url)}
          ${privacyCheck('pgDetectFilePath', '本地文件路径', cfg.detector.filePath)}
          ${privacyCheck('pgDetectPersonName', '姓名字段', cfg.detector.personName)}
          ${privacyCheck('pgDetectCustomTerms', '自定义词表', cfg.detector.customTerms)}
          ${privacyCheck('pgDetectCustomRegex', '自定义正则', cfg.detector.customRegex)}
        </div>
        <div class="privacy-section-head privacy-restore-row">
          <div>
            <div class="privacy-section-title">本地还原</div>
            <div class="form-hint">仅占位符模式，回复与工具参数可在本地还原。开启后会强制使用占位符，不再允许假数据模式。</div>
          </div>
          ${privacySwitch('pgLocalRestoreEnabled', cfg.localRestoreEnabled)}
        </div>
        <div class="form-row two-cols privacy-retention-row">
          <div>
            <label>本地还原映射保存期限</label>
            <select id="pgLocalRestoreRetention">
              <option value="request"${cfg.localRestoreRetention === 'request' ? ' selected' : ''}>仅本次请求</option>
              <option value="session"${cfg.localRestoreRetention === 'session' ? ' selected' : ''}>当前页面会话，刷新保留</option>
              <option value="local"${cfg.localRestoreRetention === 'local' ? ' selected' : ''}>永久保存到本地</option>
            </select>
            <div class="form-hint">保存期限越长，可恢复历史上下文的能力越强，但真实隐私值在本地保留得越久。</div>
          </div>
          <div>
            <label>映射管理</label>
            <button type="button" class="btn" data-action="clearPrivacyRestoreMappings">清空已保存映射</button>
            <div class="form-hint">清空当前页面会话和永久本地映射，不影响已显示的聊天文本。</div>
          </div>
        </div>
        <div class="form-row two-cols">
          <div>
            <label>替换方式</label>
            <select id="pgReplacementMode"${cfg.localRestoreEnabled ? ' disabled' : ''}>
              <option value="mask"${replacementMode === 'mask' ? ' selected' : ''}>类型占位符：[MASK_EMAIL_01]</option>
              <option value="fake"${replacementMode === 'fake' ? ' selected' : ''}>假数据：user01@example.com</option>
            </select>
            <div class="form-hint">选择“假数据”后会使用下面的模板；高风险内容仍受“高风险内容”策略控制。</div>
          </div>
          <div>
            <label>高风险内容</label>
            <select id="pgStripHighRisk">
              <option value="true"${cfg.stripHighRisk ? ' selected' : ''}>直接替换为 [REDACTED_*]</option>
              <option value="false"${!cfg.stripHighRisk ? ' selected' : ''}>按普通占位符处理</option>
            </select>
            <div class="form-hint">密钥、Token、Cookie、密码、私钥默认仍按高风险处理。</div>
          </div>
        </div>
        <div class="form-hint privacy-restore-note">高风险内容仍按上方策略处理：选择 [REDACTED_*] 时不会存入还原映射。</div>
        <div class="privacy-subsection-title">假数据模板</div>
        <div class="form-hint privacy-template-help">可使用 {seq}、{n}、{n3}、{n4}、{ip}、{id3}、{bank4}、{type} 作为序号占位。留空会恢复该类型默认模板。</div>
        <div class="privacy-template-grid">
          ${renderPrivacyFakeTemplateInputs(cfg.fakeTemplates)}
        </div>
      </section>

      <section class="privacy-section">
        <div class="privacy-section-title">应用范围</div>
        <div class="privacy-grid">
          ${privacyCheck('pgIncludeSystemPrompt', '系统上下文', cfg.includeSystemPrompt)}
          ${privacyCheck('pgIncludeToolResults', '工具结果', cfg.includeToolResults)}
          ${privacyCheck('pgIncludeAssistantHistory', '历史 assistant 消息', cfg.includeAssistantHistory)}
          ${privacyCheck('pgIncludeTextAttachments', '文本附件内容', cfg.includeTextAttachments)}
          ${privacyCheck('pgAddSafetyInstruction', '追加隐私占位符说明', cfg.addSafetyInstruction)}
        </div>
        <div class="form-row">
          <div>
            <label>图片 / PDF / 二进制附件</label>
            <select id="pgBinaryAttachmentPolicy">
              <option value="strip"${cfg.binaryAttachmentPolicy === 'strip' ? ' selected' : ''}>隐私模式下剥离</option>
              <option value="send"${cfg.binaryAttachmentPolicy === 'send' ? ' selected' : ''}>继续发送</option>
            </select>
            <div class="form-hint">浏览器端不能可靠替换图片或 PDF 里的隐私文字，默认剥离更稳妥。</div>
          </div>
        </div>
      </section>

      <section class="privacy-section">
        <div class="privacy-section-head">
          <div>
            <div class="privacy-section-title">注入给 AI 的提示</div>
            <div class="form-hint">这些文本会追加到 system prompt 中。开启本地还原后会使用“本地还原提示”，让模型把占位符当作可操作的真实参数引用。</div>
          </div>
        </div>
        <div class="form-row two-cols">
          <div>
            <label>普通脱敏提示</label>
            <textarea id="pgSafetyInstructionText" rows="5">${privacyEscape(cfg.safetyInstructionText)}</textarea>
            <div class="form-hint">用于未开启本地还原时，强调不要猜测或还原隐私值。</div>
          </div>
          <div>
            <label>本地还原提示</label>
            <textarea id="pgLocalRestoreInstructionText" rows="5">${privacyEscape(cfg.localRestoreInstructionText)}</textarea>
            <div class="form-hint">用于开启本地还原时，提示模型可以原样使用占位符完成推理和工具调用。</div>
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>响应结束标记提示</label>
            <textarea id="pgResponseGuardInstructionText" rows="3">${privacyEscape(cfg.responseGuardInstructionText)}</textarea>
            <div class="form-hint">可用 {marker} 表示上方设置的结束标记。</div>
          </div>
        </div>
        <div class="privacy-prompt-preview">
          <div class="privacy-subsection-title">当前注入预览</div>
          <pre id="pgInstructionPreview">${privacyEscape(buildPrivacyInstructionPreviewFromConfig(cfg))}</pre>
        </div>
      </section>

      <section class="privacy-section">
        <div class="privacy-section-title">自定义脱敏</div>
        <div class="form-row two-cols">
          <div>
            <label>自定义词表</label>
            <textarea id="pgCustomTerms" rows="7" placeholder="每行一个词，或用逗号分隔">${privacyEscape(cfg.customTerms)}</textarea>
            <div class="form-hint">适合公司名、姓名、项目代号、内部域名等固定文本。</div>
          </div>
          <div>
            <label>自定义正则</label>
            <textarea id="pgCustomRegex" rows="7" placeholder="/pattern/g 或普通正则，每行一个">${privacyEscape(cfg.customRegex)}</textarea>
            <div class="form-hint">正则错误会被跳过，不会阻断请求。</div>
          </div>
        </div>
      </section>

      <section class="privacy-section">
        <div class="privacy-section-head">
          <div>
            <div class="privacy-section-title">响应防尾注</div>
            <div class="form-hint">要求模型在回答末尾输出结束标记，并在本地切掉标记后的内容。用于尽量屏蔽中转站末尾追加的广告或尾巴。</div>
          </div>
          ${privacySwitch('pgResponseGuardEnabled', cfg.responseGuardEnabled)}
        </div>
        <div class="form-row two-cols">
          <div>
            <label>结束标记</label>
            <input id="pgResponseGuardMarker" value="${privacyEscape(cfg.responseGuardMarker)}">
          </div>
          <div>
            <label>未检测到标记时</label>
            <select id="pgResponseGuardAction">
              <option value="trim"${cfg.responseGuardAction === 'trim' ? ' selected' : ''}>仅记录状态，不改内容</option>
              <option value="warn"${cfg.responseGuardAction === 'warn' ? ' selected' : ''}>在回答末尾追加提醒</option>
            </select>
          </div>
        </div>
      </section>

      <section class="privacy-section">
        <div class="privacy-section-title">Shell 命令 AI 审核</div>
        <div class="form-hint">只审核 AI 发起的 execute_action 命令。原有 Shell 权限确认通过后，再由审核模型判断命令是否必要和安全。</div>
        <div id="shellAuditSettings"></div>
      </section>

      <div class="privacy-status" id="privacyLastReport">${renderPrivacyLastReport()}</div>

      <div class="modal-footer">
        <button class="btn" data-action="closePrivacySettings">取消</button>
        <button class="btn" data-action="resetPrivacyGuardDefaults">恢复默认</button>
        <button class="btn btn-primary" data-action="savePrivacySettingsFromUi">保存</button>
      </div>
    </div>
  `;
  updatePrivacyLocalRestoreUi();
  if (typeof renderShellAuditSettings === 'function') renderShellAuditSettings();
  const restoreToggle = document.getElementById('pgLocalRestoreEnabled');
  if (restoreToggle) restoreToggle.addEventListener('change', updatePrivacyLocalRestoreUi);
  ['pgSafetyInstructionText', 'pgLocalRestoreInstructionText', 'pgResponseGuardInstructionText', 'pgResponseGuardMarker', 'pgResponseGuardEnabled', 'pgAddSafetyInstruction', 'pgLocalRestoreRetention']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updatePrivacyInstructionPreview);
      if (el) el.addEventListener('change', updatePrivacyInstructionPreview);
    });
  updatePrivacyInstructionPreview();
}

function privacySwitch(id, checked) {
  return `<label class="switch"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}><span class="switch-slider"></span></label>`;
}

function privacyCheck(id, label, checked) {
  return `
    <label class="privacy-check">
      <input type="checkbox" id="${id}"${checked ? ' checked' : ''}>
      <span>${privacyEscape(label)}</span>
    </label>
  `;
}

function renderPrivacyFakeTemplateInputs(templates = {}) {
  const fields = [
    ['EMAIL', '邮箱'],
    ['PHONE', '手机号'],
    ['ID', '身份证'],
    ['BANK_CARD', '银行卡'],
    ['IP', 'IPv4'],
    ['URL', 'URL'],
    ['FILE_PATH', '文件路径'],
    ['NAME', '姓名'],
    ['CUSTOM', '自定义词'],
    ['CUSTOM_REGEX', '自定义正则'],
    ['SECRET', '密钥'],
    ['PASSWORD', '密码'],
    ['COOKIE', 'Cookie'],
    ['PRIVATE_KEY', '私钥']
  ];
  const cfg = getPrivacyGuardSettings();
  const disabled = cfg.localRestoreEnabled ? ' disabled' : '';
  return fields.map(([type, label]) => {
    const value = templates[type] || PRIVACY_GUARD_DEFAULTS.fakeTemplates[type] || '';
    return `
      <div class="privacy-template-field">
        <label for="pgFakeTpl${type}">${privacyEscape(label)}</label>
        <input id="pgFakeTpl${type}" data-fake-template="${type}" value="${privacyEscape(value)}"${disabled}>
      </div>
    `;
  }).join('');
}

function privacyEscape(value) {
  return typeof escapeHtml === 'function'
    ? escapeHtml(value == null ? '' : value)
    : String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function savePrivacySettingsFromUi() {
  const cfg = getPrivacyGuardSettings();
  const checked = id => !!document.getElementById(id)?.checked;
  const value = id => document.getElementById(id)?.value || '';

  cfg.enabled = checked('pgEnabled');
  if (privacyGuardState.settings?.securityMode) cfg.enabled = true;
  cfg.localRestoreEnabled = checked('pgLocalRestoreEnabled');
  cfg.localRestoreRetention = normalizePrivacyRestoreRetention(value('pgLocalRestoreRetention'));
  cfg.replacementMode = cfg.localRestoreEnabled ? 'mask' : (value('pgReplacementMode') || 'mask');
  cfg.stripHighRisk = value('pgStripHighRisk') !== 'false';
  cfg.includeSystemPrompt = checked('pgIncludeSystemPrompt');
  cfg.includeToolResults = checked('pgIncludeToolResults');
  cfg.includeAssistantHistory = checked('pgIncludeAssistantHistory');
  cfg.includeTextAttachments = checked('pgIncludeTextAttachments');
  cfg.binaryAttachmentPolicy = value('pgBinaryAttachmentPolicy') || 'strip';
  cfg.addSafetyInstruction = checked('pgAddSafetyInstruction');
  cfg.safetyInstructionText = value('pgSafetyInstructionText') || PRIVACY_GUARD_DEFAULTS.safetyInstructionText;
  cfg.localRestoreInstructionText = value('pgLocalRestoreInstructionText') || PRIVACY_GUARD_DEFAULTS.localRestoreInstructionText;
  cfg.responseGuardInstructionText = value('pgResponseGuardInstructionText') || PRIVACY_GUARD_DEFAULTS.responseGuardInstructionText;
  cfg.detector = {
    secrets: checked('pgDetectSecrets'),
    email: checked('pgDetectEmail'),
    phone: checked('pgDetectPhone'),
    idCard: checked('pgDetectIdCard'),
    bankCard: checked('pgDetectBankCard'),
    ipv4: checked('pgDetectIpv4'),
    url: checked('pgDetectUrl'),
    filePath: checked('pgDetectFilePath'),
    personName: checked('pgDetectPersonName'),
    customTerms: checked('pgDetectCustomTerms'),
    customRegex: checked('pgDetectCustomRegex')
  };
  cfg.customTerms = value('pgCustomTerms');
  cfg.customRegex = value('pgCustomRegex');
  cfg.fakeTemplates = collectPrivacyFakeTemplates();
  cfg.responseGuardEnabled = checked('pgResponseGuardEnabled');
  cfg.responseGuardMarker = normalizePrivacyMarker(value('pgResponseGuardMarker'));
  cfg.responseGuardAction = value('pgResponseGuardAction') || 'trim';

  privacyGuardPersistSettings();
  updatePrivacyGuardButton();
  PrivacyGuardUiService.updateSendBtn();
  PrivacyGuardUiService.toast('隐私设置已保存');
}

function collectPrivacyFakeTemplates() {
  const out = { ...PRIVACY_GUARD_DEFAULTS.fakeTemplates };
  document.querySelectorAll('[data-fake-template]').forEach(input => {
    const key = input.dataset.fakeTemplate;
    if (!key) return;
    const value = input.value.trim();
    out[key] = value || PRIVACY_GUARD_DEFAULTS.fakeTemplates[key] || `[FAKE_${key}_{seq}]`;
  });
  return out;
}

function updatePrivacyLocalRestoreUi() {
  const enabled = !!document.getElementById('pgLocalRestoreEnabled')?.checked;
  const replacementMode = document.getElementById('pgReplacementMode');
  const retention = document.getElementById('pgLocalRestoreRetention');
  if (replacementMode) {
    if (enabled) replacementMode.value = 'mask';
    replacementMode.disabled = enabled;
  }
  if (retention) retention.disabled = !enabled;
  document.querySelectorAll('[data-fake-template]').forEach(input => {
    input.disabled = enabled;
  });
  updatePrivacyInstructionPreview();
}

function clearPrivacyRestoreMappings() {
  clearAllPrivacyGuardRestoreStores();
  PrivacyGuardUiService.toast('已清空本地还原映射');
  const status = document.getElementById('privacyLastReport');
  if (status) status.textContent = renderPrivacyLastReport();
}

function buildPrivacyInstructionPreviewFromConfig(cfg) {
  return buildPrivacyGuardSystemSuffix({
    ...cfg,
    enabled: true
  }, { includeResponseGuard: true }) || '（当前不会注入额外提示）';
}

function getPrivacyInstructionPreviewConfig() {
  const cfg = getPrivacyGuardSettings();
  const checked = id => !!document.getElementById(id)?.checked;
  const value = id => document.getElementById(id)?.value || '';
  return {
    ...cfg,
    enabled: true,
    localRestoreEnabled: checked('pgLocalRestoreEnabled'),
    localRestoreRetention: normalizePrivacyRestoreRetention(value('pgLocalRestoreRetention') || cfg.localRestoreRetention),
    addSafetyInstruction: checked('pgAddSafetyInstruction'),
    safetyInstructionText: value('pgSafetyInstructionText') || cfg.safetyInstructionText,
    localRestoreInstructionText: value('pgLocalRestoreInstructionText') || cfg.localRestoreInstructionText,
    responseGuardEnabled: checked('pgResponseGuardEnabled'),
    responseGuardMarker: normalizePrivacyMarker(value('pgResponseGuardMarker') || cfg.responseGuardMarker),
    responseGuardInstructionText: value('pgResponseGuardInstructionText') || cfg.responseGuardInstructionText
  };
}

function updatePrivacyInstructionPreview() {
  const el = document.getElementById('pgInstructionPreview');
  if (!el) return;
  el.textContent = buildPrivacyInstructionPreviewFromConfig(getPrivacyInstructionPreviewConfig());
}

function resetPrivacyGuardDefaults() {
  privacyGuardState.settings.privacyGuard = clonePrivacyGuardDefaults();
  if (privacyGuardState.settings?.securityMode && typeof enforceSecurityModeProtections === 'function') {
    enforceSecurityModeProtections();
  }
  privacyGuardPersistSettings();
  renderPrivacySettings();
  updatePrivacyGuardButton();
  PrivacyGuardUiService.updateSendBtn();
  PrivacyGuardUiService.toast('隐私设置已恢复默认');
}

function renderPrivacyLastReport() {
  const report = PRIVACY_GUARD_LAST_REPORT;
  if (!report) return '最近请求：暂无脱敏记录';
  const total = Object.values(report.counters || {}).reduce((sum, n) => sum + n, 0);
  const types = Object.entries(report.counters || {})
    .map(([k, v]) => `${k}:${v}`)
    .join(' · ') || '无文本命中';
  const restore = report.localRestoreEnabled ? ` · 本地还原映射 ${report.restoreCount || 0} 项` : '';
  return `最近请求：${total} 处文本脱敏 · ${report.strippedAttachments || 0} 个附件剥离${restore} · ${types}`;
}

function getPrivacyGuardInputInfoSuffix() {
  return isPrivacyGuardEnabled() ? ' · 隐私模式' : '';
}

window.ensurePrivacyGuardSettings = ensurePrivacyGuardSettings;
window.getPrivacyGuardSettings = getPrivacyGuardSettings;
window.isPrivacyGuardEnabled = isPrivacyGuardEnabled;
window.beginPrivacyGuardRequest = beginPrivacyGuardRequest;
window.endPrivacyGuardRequest = endPrivacyGuardRequest;
window.withPrivacyGuardRequest = withPrivacyGuardRequest;
window.privacyGuardPrepareHistory = privacyGuardPrepareHistory;
window.privacyGuardSanitizeSystemText = privacyGuardSanitizeSystemText;
window.privacyGuardSanitizeAuxiliarySystemText = privacyGuardSanitizeAuxiliarySystemText;
window.privacyGuardFinalizeAssistantMessage = privacyGuardFinalizeAssistantMessage;
window.privacyGuardFinalizeText = privacyGuardFinalizeText;
window.privacyGuardRestoreText = privacyGuardRestoreText;
window.privacyGuardRestoreValue = privacyGuardRestoreValue;
window.privacyGuardRestoreToolCallArguments = privacyGuardRestoreToolCallArguments;
window.togglePrivacyGuard = togglePrivacyGuard;
window.updatePrivacyGuardButton = updatePrivacyGuardButton;
window.openPrivacySettings = openPrivacySettings;
window.closePrivacySettings = closePrivacySettings;
window.renderPrivacySettings = renderPrivacySettings;
window.savePrivacySettingsFromUi = savePrivacySettingsFromUi;
window.resetPrivacyGuardDefaults = resetPrivacyGuardDefaults;
window.clearPrivacyRestoreMappings = clearPrivacyRestoreMappings;
window.getPrivacyGuardInputInfoSuffix = getPrivacyGuardInputInfoSuffix;

window.AgentApp.define('privacyGuard', {
  ensurePrivacyGuardSettings,
  getPrivacyGuardSettings,
  isPrivacyGuardEnabled,
  beginPrivacyGuardRequest,
  endPrivacyGuardRequest,
  withPrivacyGuardRequest,
  privacyGuardPrepareHistory,
  privacyGuardSanitizeSystemText,
  privacyGuardSanitizeAuxiliarySystemText,
  privacyGuardFinalizeAssistantMessage,
  privacyGuardFinalizeText,
  privacyGuardRestoreText,
  privacyGuardRestoreValue,
  privacyGuardRestoreToolCallArguments,
  togglePrivacyGuard,
  updatePrivacyGuardButton,
  openPrivacySettings,
  closePrivacySettings,
  renderPrivacySettings,
  savePrivacySettingsFromUi,
  resetPrivacyGuardDefaults,
  clearPrivacyRestoreMappings,
  getPrivacyGuardInputInfoSuffix
});

ensurePrivacyGuardSettings();
