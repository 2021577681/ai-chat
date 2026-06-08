// ============ Token 估算 & 精确计数 & 上下文管理 ============

const MODEL_CONTEXT_LIMITS = {
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000,
  'gpt-4': 8192, 'gpt-3.5-turbo': 16385,
  'claude-3-5-sonnet': 200000, 'claude-3-5-sonnet-20241022': 200000,
  'claude-3-opus': 200000, 'claude-3-haiku': 200000,
  'claude-3-haiku-20240307': 200000, 'claude-opus-4': 200000,
  'claude-opus-4-6': 200000, 'claude-sonnet-4': 200000,
  'deepseek-chat': 64000, 'deepseek-reasoner': 64000,
  'qwen-plus': 128000, 'qwen-max': 32000, 'qwen-turbo': 8000,
  'glm-4-flash': 128000, 'glm-4-plus': 128000,
  '_default': 200000
};

function getContextLimit(modelName) {
  if (!modelName) return MODEL_CONTEXT_LIMITS._default;
  if (MODEL_CONTEXT_LIMITS[modelName]) return MODEL_CONTEXT_LIMITS[modelName];
  for (const key of Object.keys(MODEL_CONTEXT_LIMITS)) {
    if (key !== '_default' && modelName.toLowerCase().includes(key.toLowerCase())) {
      return MODEL_CONTEXT_LIMITS[key];
    }
  }
  return MODEL_CONTEXT_LIMITS._default;
}

// ============ 估算 Token ============
function estimateTokens(text) {
  if (!text) return 0;
  if (typeof text !== 'string') {
    try { text = JSON.stringify(text); } catch (e) { return 0; }
  }
  let tokens = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code > 0x4e00 && code < 0x9fff) tokens += 0.6;
    else if (code > 0x3000 && code < 0x303f) tokens += 0.6;
    else tokens += 0.25;
  }
  return Math.ceil(tokens);
}

function estimateMessageTokens(msg) {
  let total = 4;
  if (msg.role) total += estimateTokens(msg.role);
  if (typeof msg.content === 'string') total += estimateTokens(msg.content);
  else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === 'text') total += estimateTokens(part.text);
      else if (part.type === 'image_url' || part.type === 'image') total += 850;
    }
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      total += estimateTokens(tc.function?.name || '');
      total += estimateTokens(tc.function?.arguments || '');
      total += 10;
    }
  }
  if (msg.attachments) {
    for (const a of msg.attachments) {
      if (a.type === 'image') total += 850;
      if (a.text) total += estimateTokens(a.text);
    }
  }
  return total;
}

function estimateChatTokens(chat) {
  if (!chat || !chat.messages) return 0;
  const systemPrompt = typeof getEffectiveSystemPrompt === 'function'
    ? getEffectiveSystemPrompt()
    : (state.settings.systemPrompt || '');
  let total = estimateTokens(systemPrompt);
  for (const m of chat.messages) total += estimateMessageTokens(m);
  return total;
}

// ============ 精确 Token 统计（多源）============
// ⭐ 统计数据按对话独立持久化，存放在 chat.tokenStats 上
//   - 切换对话时各自保留（修复"切换对话清零"的 bug）
//   - 跟随 saveData() 写入 localStorage，刷新后仍存在

function _emptyTokenStats() {
  return {
    msgCount: 0,
    inputTokens: 0,           // 累计输入 token
    outputTokens: 0,          // 累计输出 token
    lastInputTokens: 0,       // 上次请求的输入
    lastOutputTokens: 0,      // 上次请求的输出
    cacheReadTokens: 0,       // 缓存命中（节省成本）
    cacheCreateTokens: 0,     // 缓存创建
    thinkingTokens: 0,        // extended thinking
    totalRequests: 0,         // 累计请求次数
    source: null,
    time: 0,
    // ⭐ 全局 Token 统计用：逐次记录每次 API usage，来源与对话栏统计一致
    //   旧数据没有 events 时，统计页会用累计值做一次性兼容汇总。
    events: []
  };
}

// 取/建当前对话的统计对象（按需创建并补齐缺失字段，兼容旧数据）
function getChatTokenStats(chat) {
  if (!chat) return null;
  if (!chat.tokenStats || typeof chat.tokenStats !== 'object') {
    chat.tokenStats = _emptyTokenStats();
  } else {
    const def = _emptyTokenStats();
    for (const k of Object.keys(def)) {
      if (typeof chat.tokenStats[k] === 'undefined') chat.tokenStats[k] = def[k];
    }
  }
  return chat.tokenStats;
}

let _tokenFetchTimer = null;
let _tokenFetchTimersByChat = {};
let _tokenFetchInflight = false;
let _tokenFetchInflightByChat = {};

// ============ 独立 Token 使用账本 ============
// 与对话数据分开保存：删除对话不会影响这里的历史统计。
const TOKEN_USAGE_LEDGER_KEY = 'aichat_token_usage_ledger_v1';

function loadTokenUsageLedger() {
  try {
    const raw = storage.get(TOKEN_USAGE_LEDGER_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[token-ledger] 加载失败:', e);
    return [];
  }
}

function saveTokenUsageLedger(list) {
  try {
    storage.set(TOKEN_USAGE_LEDGER_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  } catch (e) {
    console.warn('[token-ledger] 保存失败:', e);
  }
}

function appendTokenUsageLedger(event) {
  if (!event) return;
  const list = loadTokenUsageLedger();
  list.push(event);
  saveTokenUsageLedger(list);
}

function migrateChatTokenStatsToLedger() {
  const ledger = loadTokenUsageLedger();
  const seen = new Set(ledger.map(e => e && e.id).filter(Boolean));
  let added = 0;
  const chats = Array.isArray(state.chats) ? state.chats : [];
  for (const chat of chats) {
    const stats = chat && chat.tokenStats;
    if (!stats || typeof stats !== 'object') continue;
    if (Array.isArray(stats.events) && stats.events.length) {
      stats.events.forEach((ev, i) => {
        const id = ev.id || `${chat.id || 'chat'}_${ev.ts || stats.time || 0}_${ev.model || 'model'}_${ev.inputTokens || 0}_${ev.outputTokens || 0}_${i}`;
        if (seen.has(id)) return;
        seen.add(id);
        ledger.push({
          id,
          chatId: chat.id || '',
          chatTitle: chat.title || '未命名对话',
          ts: ev.ts || stats.time || chat.createdAt || Date.now(),
          model: ev.model || '未知模型',
          provider: ev.provider || '',
          format: ev.format || '',
          inputTokens: Number(ev.inputTokens || 0),
          outputTokens: Number(ev.outputTokens || 0),
          cacheReadTokens: Number(ev.cacheReadTokens || 0),
          cacheCreateTokens: Number(ev.cacheCreateTokens || 0),
          thinkingTokens: Number(ev.thinkingTokens || 0),
          source: ev.source || stats.source || 'usage',
          migratedFromChat: true
        });
        added++;
      });
    } else if (stats.totalRequests > 0) {
      const id = `${chat.id || 'chat'}_legacy_${stats.time || chat.createdAt || 0}`;
      if (seen.has(id)) continue;
      seen.add(id);
      ledger.push({
        id,
        chatId: chat.id || '',
        chatTitle: chat.title || '未命名对话',
        ts: stats.time || chat.createdAt || Date.now(),
        model: '历史累计（未记录模型）',
        provider: '',
        format: '',
        inputTokens: Number(stats.inputTokens || 0),
        outputTokens: Number(stats.outputTokens || 0),
        cacheReadTokens: Number(stats.cacheReadTokens || 0),
        cacheCreateTokens: Number(stats.cacheCreateTokens || 0),
        thinkingTokens: Number(stats.thinkingTokens || 0),
        source: stats.source || 'legacy',
        _legacy: true,
        _requests: Number(stats.totalRequests || 1),
        migratedFromChat: true
      });
      added++;
    }
  }
  if (added > 0) saveTokenUsageLedger(ledger);
  return added;
}

/**
 * 从响应的 usage 字段记录详细 token 信息
 * 支持 OpenAI 和 Anthropic 两种格式
 */
function recordUsageFromResponse(chat, usage, meta = {}) {
  if (!chat || !usage) return;
  const stats = getChatTokenStats(chat);
  
  // 兼容两种格式的字段
  // Anthropic: input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens
  // OpenAI:    prompt_tokens, completion_tokens, prompt_tokens_details.cached_tokens
  
  const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  
  // 缓存（Anthropic 直接给字段；OpenAI 在 prompt_tokens_details.cached_tokens）
  const cacheRead = usage.cache_read_input_tokens 
    || usage.prompt_tokens_details?.cached_tokens 
    || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  
  // 思考 token（Anthropic extended thinking / OpenAI o1 reasoning）
  const thinking = usage.output_tokens_details?.thinking_tokens 
    || usage.completion_tokens_details?.reasoning_tokens 
    || 0;
  
  const now = Date.now();
  const model = meta.model || state.settings.currentModel || 'unknown';
  
  // 累计统计（注意：累加，不是覆盖）
  stats.msgCount = chat.messages.length;
  stats.inputTokens += inputTokens;
  stats.outputTokens += outputTokens;
  stats.lastInputTokens = inputTokens;
  stats.lastOutputTokens = outputTokens;
  stats.cacheReadTokens += cacheRead;
  stats.cacheCreateTokens += cacheCreate;
  stats.thinkingTokens += thinking;
  stats.totalRequests += 1;
  stats.source = meta.source || (state.settings.apiFormat === 'anthropic' ? 'anthropic' : 'openai');
  stats.time = now;
  const usageEvent = {
    id: `usage_${now}_${Math.random().toString(36).slice(2, 10)}`,
    chatId: chat.id || '',
    chatTitle: chat.title || '未命名对话',
    ts: now,
    model,
    provider: meta.provider || state.settings.provider || '',
    format: meta.format || state.settings.apiFormat || '',
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheRead,
    cacheCreateTokens: cacheCreate,
    thinkingTokens: thinking,
    source: stats.source
  };
  if (!Array.isArray(stats.events)) stats.events = [];
  stats.events.push(usageEvent);
  appendTokenUsageLedger(usageEvent);
  
  // 持久化（让累计数字跟着对话一起存到 localStorage）
  if (typeof saveData === 'function') {
    try { saveData(); } catch (e) {}
  }
  updateTokenDisplay();
}

/**
 * 通过 Anthropic count_tokens API 获取当前上下文精确大小
 */
async function fetchAnthropicTokenCount(chat) {
  const s = state.settings;
  if (s.apiFormat !== 'anthropic') return null;
  if (!s.apiKey) return null;
  
  try {
    const messages = buildAnthropicMessages(chat.messages);
    if (!messages.length) return null;
    
    const body = { model: s.currentModel, messages: messages };
    const systemPrompt = typeof getEffectiveSystemPrompt === 'function'
      ? getEffectiveSystemPrompt()
      : (s.systemPrompt || '');
    if (systemPrompt) body.system = systemPrompt;
    const tools = buildToolsArray();
    if (tools) body.tools = tools;
    
    const baseUrl = s.baseUrl.replace(/\/+$/, '');
    let path = s.apiPath;
    if (/\/messages\/?$/.test(path)) {
      path = path.replace(/\/messages\/?$/, '/messages/count_tokens');
    } else {
      path = path.replace(/\/+$/, '') + '/count_tokens';
    }
    const url = baseUrl + (path.startsWith('/') ? path : '/' + path);
    
    const resp = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body)
    });
    
    if (!resp.ok) {
      console.warn(`[count_tokens] HTTP ${resp.status}`);
      return null;
    }
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    const j = await resp.json();
    return j.input_tokens || null;
  } catch (e) {
    console.warn('[count_tokens] 失败:', e.message);
    return null;
  }
}

async function refreshAccurateTokenCount(force = false, chatId) {
  const c = chatId && typeof chatById === 'function' ? chatById(chatId) : currentChat();
  if (!c || !c.messages.length) return;
  const targetChatId = c.id || chatId || state.currentId || 'default';
  const stats = getChatTokenStats(c);
  if (!force && stats.msgCount === c.messages.length
      && Date.now() - stats.time < 30000) return;
  if (_tokenFetchInflightByChat[targetChatId]) return;
  if (state.settings.apiFormat !== 'anthropic') return;
  
  _tokenFetchInflightByChat[targetChatId] = true;
  try {
    const tokens = await fetchAnthropicTokenCount(c);
    if (tokens !== null) {
      // 只更新输入快照，不动累计输出
      stats.lastInputTokens = tokens;
      stats.msgCount = c.messages.length;
      stats.time = Date.now();
      if (!stats.source) stats.source = 'anthropic_count_api';
      if (typeof isCurrentChat === 'function' ? isCurrentChat(c) : c === currentChat()) {
        updateTokenDisplay();
      }
    }
  } finally {
    delete _tokenFetchInflightByChat[targetChatId];
  }
}

function scheduleAccurateTokenCount(chatId) {
  if (state.settings.apiFormat !== 'anthropic') return;
  const targetChatId = chatId || state.currentId;
  if (!targetChatId) return;
  if (_tokenFetchTimersByChat[targetChatId]) clearTimeout(_tokenFetchTimersByChat[targetChatId]);
  _tokenFetchTimersByChat[targetChatId] = setTimeout(() => {
    delete _tokenFetchTimersByChat[targetChatId];
    refreshAccurateTokenCount(false, targetChatId);
  }, 1500);
}

// ============ 显示 Token 统计 ============

function updateTokenDisplay() {
  const el = document.getElementById('tokenStats');
  if (!el) return;
  const c = currentChat();
  if (!c || !c.messages.length) {
    el.innerHTML = '<span class="token-empty">📊 暂无对话</span>';
    return;
  }
  
  const stats = getChatTokenStats(c);
  // 看是否有当前对话的精确统计
  const hasAccurate = stats.totalRequests > 0;
  
  let inputTokens, outputTokens, cacheRead, thinking, totalRequests;
  let isAccurate, sourceLabel;
  
  if (hasAccurate) {
    inputTokens = stats.lastInputTokens;     // 当前输入
    outputTokens = stats.outputTokens;        // 累计输出
    cacheRead = stats.cacheReadTokens;
    thinking = stats.thinkingTokens;
    totalRequests = stats.totalRequests;
    isAccurate = true;
    sourceLabel = '精确值（来自 API usage）';
  } else if (stats.lastInputTokens > 0) {
    // count_tokens 拿到的输入值（但还没有真实 usage）
    inputTokens = stats.lastInputTokens;
    outputTokens = 0;
    cacheRead = 0;
    thinking = 0;
    totalRequests = 0;
    isAccurate = true;
    sourceLabel = '精确值（来自 count_tokens API）';
  } else {
    inputTokens = estimateChatTokens(c);
    outputTokens = 0;
    cacheRead = 0;
    thinking = 0;
    totalRequests = 0;
    isAccurate = false;
    sourceLabel = '估算值（可能误差 ±20%）';
  }
  
  const limit = getContextLimit(state.settings.currentModel);
  const pct = Math.min(100, Math.round(inputTokens / limit * 100));
  const msgCount = c.messages.filter(m => m.role !== 'tool').length;
  
  let pctClass = 'safe';
  if (pct >= 80) pctClass = 'danger';
  else if (pct >= 60) pctClass = 'warning';
  
  const accuracyIcon = isAccurate ? '✓' : '~';
  
  // 构建详细信息
  let extras = '';
  if (outputTokens > 0) {
    extras += `<span class="token-count token-output" title="累计输出 token（${totalRequests} 次请求）">📤 ${formatNumber(outputTokens)}</span>`;
  }
  if (cacheRead > 0) {
    extras += `<span class="token-count token-cache" title="缓存命中（节省成本）">💾 ${formatNumber(cacheRead)}</span>`;
  }
  if (thinking > 0) {
    extras += `<span class="token-count token-thinking" title="思考 token（extended thinking）">💭 ${formatNumber(thinking)}</span>`;
  }
  
  const showRefreshBtn = state.settings.apiFormat === 'anthropic';
  
  el.innerHTML = `
    <span class="token-msgs" title="消息数">💬 ${msgCount}</span>
    <span class="token-count token-input" title="输入 token · ${sourceLabel}">${accuracyIcon} 📥 ${formatNumber(inputTokens)} / ${formatNumber(limit)}</span>
    ${extras}
    <div class="token-bar" title="输入 token 占上下文 ${pct}%">
      <div class="token-bar-fill ${pctClass}" style="width:${pct}%"></div>
    </div>
    <span class="token-pct ${pctClass}">${pct}%</span>
    <button class="token-compress-btn" onclick="manualCompress()" title="压缩对话历史">🗜️</button>
    <button class="token-compress-btn" onclick="showTokenDetails()" title="查看详细统计">📊</button>
    ${showRefreshBtn ? `<button class="token-compress-btn" onclick="refreshAccurateTokenCount(true)" title="从 API 获取精确值">🎯</button>` : ''}
  `;
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

// ============ Token 详细统计弹窗 ============

function showTokenDetails() {
  const c = currentChat();
  if (!c || !c.messages.length) {
    toast('当前没有对话');
    return;
  }
  
  const stats = getChatTokenStats(c);
  const limit = getContextLimit(state.settings.currentModel);
  const model = state.settings.currentModel;
  
  // ⭐ 从可配置定价表查价（来源：pricing.js）
  //   用户可在 ⋯ 更多 → 定价管理 中自定义。pricing.js 没加载时走简单内置 fallback。
  let pricing;
  if (typeof getPricing === 'function') {
    pricing = getPricing(model);
  } else {
    pricing = { input: 1.0, output: 3.0, cacheRead: 0.1, matched: null };
  }
  const exchangeRate = (typeof getExchangeRate === 'function') ? getExchangeRate() : 7.2;
  const showCny = (typeof shouldShowCny === 'function') ? shouldShowCny() : true;
  
  let html = `<div style="font-size:13px;line-height:1.8;">`;
  html += `<h3 style="margin:0 0 12px;font-size:15px;">📊 Token 详细统计</h3>`;
  html += `<div style="background:var(--bg-input);padding:12px;border-radius:8px;margin-bottom:12px;">`;
  html += `<div><strong>模型：</strong>${escapeHtml(model)}</div>`;
  html += `<div><strong>上下文限制：</strong>${formatNumber(limit)} tokens</div>`;
  html += `<div><strong>消息数：</strong>${c.messages.length}</div>`;
  html += `</div>`;
  
  if (stats && stats.totalRequests > 0) {
    html += `<h4 style="margin:12px 0 8px;font-size:14px;">📈 本对话累计</h4>`;
    html += `<div style="background:var(--bg-input);padding:12px;border-radius:8px;">`;
    html += `<table style="width:100%;font-size:13px;">`;
    html += `<tr><td>📊 总请求次数</td><td style="text-align:right;font-family:monospace;">${stats.totalRequests}</td></tr>`;
    html += `<tr><td>📥 累计输入 token</td><td style="text-align:right;font-family:monospace;">${formatNumber(stats.inputTokens)}</td></tr>`;
    html += `<tr><td>📤 累计输出 token</td><td style="text-align:right;font-family:monospace;">${formatNumber(stats.outputTokens)}</td></tr>`;
    if (stats.cacheReadTokens > 0) {
      html += `<tr><td>💾 缓存命中（节省）</td><td style="text-align:right;font-family:monospace;color:var(--success);">${formatNumber(stats.cacheReadTokens)}</td></tr>`;
    }
    if (stats.cacheCreateTokens > 0) {
      html += `<tr><td>💾 缓存创建</td><td style="text-align:right;font-family:monospace;">${formatNumber(stats.cacheCreateTokens)}</td></tr>`;
    }
    if (stats.thinkingTokens > 0) {
      html += `<tr><td>💭 思考 token</td><td style="text-align:right;font-family:monospace;">${formatNumber(stats.thinkingTokens)}</td></tr>`;
    }
    html += `<tr style="border-top:1px solid var(--border);"><td><strong>总计</strong></td><td style="text-align:right;font-family:monospace;"><strong>${formatNumber(stats.inputTokens + stats.outputTokens)}</strong></td></tr>`;
    html += `</table></div>`;
    
    html += `<h4 style="margin:12px 0 8px;font-size:14px;display:flex;align-items:center;gap:8px;">💰 估算费用（参考） <span style="font-size:11px;font-weight:normal;color:var(--text-secondary);">${pricing.matched ? '匹配关键词：<code>' + escapeHtml(pricing.matched) + '</code>' : '⚠️ 未匹配，使用默认价'}<a href="javascript:void(0)" onclick="document.getElementById('tokenDetailModal') && document.getElementById('tokenDetailModal').classList.remove('show'); openPricingManager && openPricingManager();" style="margin-left:6px;">编辑</a></span></h4>`;
    html += `<div style="background:var(--bg-input);padding:12px;border-radius:8px;font-size:12px;">`;
    
    const costInput = (stats.inputTokens - stats.cacheReadTokens) * pricing.input / 1000000;
    const costOutput = stats.outputTokens * pricing.output / 1000000;
    const costCache = stats.cacheReadTokens * pricing.cacheRead / 1000000;
    const total = costInput + costOutput + costCache;
    const saved = stats.cacheReadTokens * (pricing.input - pricing.cacheRead) / 1000000;
    
    html += `<div>输入费用：$${costInput.toFixed(6)} (${formatNumber(stats.inputTokens - stats.cacheReadTokens)} × $${pricing.input}/M)</div>`;
    if (costCache > 0) {
      html += `<div>缓存费用：$${costCache.toFixed(6)} (${formatNumber(stats.cacheReadTokens)} × $${pricing.cacheRead}/M)</div>`;
    }
    html += `<div>输出费用：$${costOutput.toFixed(6)} (${formatNumber(stats.outputTokens)} × $${pricing.output}/M)</div>`;
    html += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;"><strong>总计：$${total.toFixed(6)}</strong>${showCny ? ` ≈ ¥${(total * exchangeRate).toFixed(4)}` : ''}</div>`;
    if (saved > 0) {
      html += `<div style="color:var(--success);margin-top:4px;">💚 缓存节省：$${saved.toFixed(6)}</div>`;
    }
    html += `<div style="margin-top:6px;font-size:11px;color:var(--text-secondary);">⚠️ 价格仅供参考，以服务商实际计费为准</div>`;
    html += `</div>`;
    
    if (stats.lastInputTokens > 0) {
      html += `<h4 style="margin:12px 0 8px;font-size:14px;">⏱ 最近一次请求</h4>`;
      html += `<div style="background:var(--bg-input);padding:12px;border-radius:8px;">`;
      html += `<div>📥 输入：${formatNumber(stats.lastInputTokens)} tokens</div>`;
      html += `<div>📤 输出：${formatNumber(stats.lastOutputTokens)} tokens</div>`;
      html += `</div>`;
    }
  } else {
    html += `<div style="padding:20px;text-align:center;color:var(--text-secondary);">还没有发送过请求</div>`;
  }
  
  html += `<div style="margin-top:16px;font-size:12px;color:var(--text-secondary);">`;
  html += `💡 提示：缓存命中能大幅降低成本（Anthropic 缓存读取约为正常输入价的 1/10）`;
  html += `</div></div>`;
  
  // 显示在一个简单的模态框里
  showTokenModal(html);
}

function showTokenModal(html) {
  let modal = document.getElementById('tokenDetailModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'tokenDetailModal';
    modal.className = 'modal-mask';
    modal.innerHTML = `
      <div class="modal" style="width:480px;">
        <div id="tokenDetailContent"></div>
        <div class="modal-footer">
          <button class="btn" onclick="document.getElementById('tokenDetailModal').classList.remove('show')">关闭</button>
          <button class="btn" onclick="resetTokenStats()">🔄 重置统计</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('tokenDetailContent').innerHTML = html;
  modal.classList.add('show');
}

function resetTokenStats() {
  if (!confirm('重置当前对话的 token 统计？\n（不影响实际对话内容，其它对话的统计不动）')) return;
  const c = currentChat();
  if (c) {
    c.tokenStats = _emptyTokenStats();
    if (typeof saveData === 'function') saveData();
  }
  updateTokenDisplay();
  document.getElementById('tokenDetailModal').classList.remove('show');
  toast('✓ 已重置');
}

// ============ 压缩对话 ============

async function manualCompress() {
  const c = currentChat();
  if (!c || c.messages.length < 4) { toast('对话太短，无需压缩'); return; }
  if (!state.settings.apiKey) { toast('请先配置 API Key'); return; }
  if (!confirm(`确定要压缩当前对话历史吗？\n\n会保留最近 ${state.settings.compressKeepLast || 4} 条消息，前面的对话会被 AI 总结成摘要。\n\n建议先用「💾 备份」保存原始数据。`)) return;
  await compressChat(c);
}

async function autoCompressCheck() {
  if (!state.settings.compressAutoEnabled) return false;
  const c = currentChat();
  if (!c || c.messages.length < 6) return false;
  
  let tokens;
  const stats = getChatTokenStats(c);
  if (stats.lastInputTokens > 0) {
    tokens = stats.lastInputTokens;
  } else {
    tokens = estimateChatTokens(c);
  }
  
  const limit = getContextLimit(state.settings.currentModel);
  const pct = tokens / limit * 100;
  const threshold = state.settings.compressAutoThreshold || 75;
  if (pct >= threshold) {
    toast(`📦 上下文已达 ${Math.round(pct)}%，自动压缩中...`, 3000);
    await compressChat(c);
    return true;
  }
  return false;
}

async function compressChat(chat) {
  const keepLast = state.settings.compressKeepLast || 4;
  
  // ⭐ 切点策略：toKeep 必须以 user 消息开头（且不能是摘要消息）
  //   否则压缩后会出现 assistant(tool_calls) 紧跟摘要的情况，
  //   导致摘要 text 块被 prepend 到 tool_result 前面 → Anthropic 报
  //   "tool_use ids were found without tool_result blocks immediately after"
  //
  // 算法（双向查找，避免末尾全是 tool/assistant 时找不到切点）：
  //   1) 先尝试在 [length-keepLast, end) 范围内向后找第一条真实 user 消息
  //      —— 命中：正好保留约 keepLast 条
  //   2) 找不到（末尾全是工具循环 / assistant 收尾）→ 从末尾向前找最近一条真实 user
  //      —— 这种情况会"多保留几条"，但能保证压缩成功而不是直接报错
  const initialCutIdx = Math.max(0, chat.messages.length - keepLast);
  const isRealUser = (m) => m && m.role === 'user' && !m._isSummary;
  
  let cutIdx = -1;
  // 第 1 步：向后找
  for (let i = initialCutIdx; i < chat.messages.length; i++) {
    if (isRealUser(chat.messages[i])) { cutIdx = i; break; }
  }
  // 第 2 步：向后没找到 → 向前找（兜底，保留更多消息但能成功压缩）
  if (cutIdx < 0) {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (isRealUser(chat.messages[i])) { cutIdx = i; break; }
    }
  }
  
  if (cutIdx < 0) {
    toast('对话里没有任何 user 消息，无法压缩');
    return;
  }
  if (cutIdx <= 0) {
    toast('对话太短，无需压缩');
    return;
  }
  
  const toCompress = chat.messages.slice(0, cutIdx);
  const toKeep = chat.messages.slice(cutIdx);
  let previousSummary = '';
  const firstMsg = toCompress[0];
  if (firstMsg && firstMsg._isSummary) previousSummary = firstMsg.content;
  
  const conversationText = toCompress.filter(m => !m._isSummary).map(m => {
    const role = m.role === 'user' ? '用户' : (m.role === 'assistant' ? 'AI' : '工具');
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    let line = `【${role}】${content.slice(0, 1500)}`;
    if (m.tool_calls?.length) line += `\n[调用工具: ${m.tool_calls.map(t => t.function?.name).join(', ')}]`;
    return line;
  }).join('\n\n');
  
  const compressPrompt = `${previousSummary ? '【已有摘要】\n' + previousSummary + '\n\n' : ''}以下是一段对话历史，请提炼成简洁的摘要，保留：
1. 用户的核心问题和需求
2. AI 给出的关键答案、决定和事实
3. 涉及的重要文件、命令、数据
4. 已完成的任务和未完成的事项
5. 任何对继续对话至关重要的上下文

要求：
- 用第三人称叙述
- 简洁紧凑，不超过原文 1/4 长度
- 用清晰的分点结构
- 保留具体的技术细节、文件名、关键代码片段

【需要总结的对话】
${conversationText}

请输出摘要：`;

  chat.messages.push({ role: 'assistant', content: '🗜️ 正在压缩对话历史...', _isCompressing: true });
  renderMessages();
  
  // ⭐ 用闭包函数代替 pop()，避免误删用户消息
  const removeCompressingPlaceholder = () => {
    const idx = chat.messages.findIndex(m => m._isCompressing);
    if (idx >= 0) chat.messages.splice(idx, 1);
  };
  
  try {
    state.isGenerating = true;
    updateSendBtn();
    const summary = await callOnceWithRole(
      [{ role: 'user', content: compressPrompt }],
      state.settings.currentModel,
      '你是一个专业的对话摘要专家，擅长提炼对话核心信息。'
    );
    removeCompressingPlaceholder();
    
    const summaryMsg = {
      role: 'system',
      content: `【对话历史摘要】（由 AI 自动压缩，原 ${toCompress.length} 条消息）\n\n${summary}`,
      _isSummary: true,
      _originalCount: toCompress.length,
      _compressTime: Date.now()
    };
    chat.messages = [summaryMsg, ...toKeep];
    
    // 清除精确统计缓存（消息变了）
    const compStats = getChatTokenStats(chat);
    compStats.lastInputTokens = 0;
    compStats.msgCount = chat.messages.length;
    
    saveData();
    renderMessages();
    updateTokenDisplay();
    scheduleAccurateTokenCount(chat.id);
    toast(`✓ 已压缩 ${toCompress.length} 条消息为摘要`);
  } catch (e) {
    removeCompressingPlaceholder();
    renderMessages();
    toast(`❌ 压缩失败：${e.message}`, 3000);
  } finally {
    state.isGenerating = false;
    state.abortCtrl = null;
    updateSendBtn();
  }
}
