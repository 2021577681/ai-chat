// ============ 设置面板 ============

function openSettings() {
  document.getElementById('settingsModal').classList.add('show');
  // ⭐ 刷新配置档案下拉（API Profile）
  if (typeof renderApiProfileSelect === 'function') renderApiProfileSelect();
  const s = state.settings;
  document.getElementById('provider').value = s.provider;
  document.getElementById('baseUrl').value = s.baseUrl;
  document.getElementById('apiPath').value = s.apiPath;
  document.getElementById('apiFormat').value = s.apiFormat;
  document.getElementById('apiKey').value = s.apiKey;
  document.getElementById('modelName').value = s.modelName;
  document.getElementById('systemPrompt').value = s.systemPrompt;
  document.getElementById('temperature').value = s.temperature;
  document.getElementById('tempVal').textContent = s.temperature;
  document.getElementById('maxTokens').value = s.maxTokens;
  document.getElementById('streamMode').checked = s.stream;
  // ⭐ 本地代理开关
  const proxyEl = document.getElementById('useLocalProxy');
  if (proxyEl) proxyEl.checked = !!s.useLocalProxy;
  // ⭐ 自动重试次数
  const retryEl = document.getElementById('retryMaxAttempts');
  const retryValEl = document.getElementById('retryMaxAttemptsVal');
  if (retryEl) {
    const v = (s.retryMaxAttempts === undefined || s.retryMaxAttempts === null) ? 3 : s.retryMaxAttempts;
    retryEl.value = v;
    if (retryValEl) retryValEl.textContent = v;
  }
  
  // 工具调用轮数
  const maxToolRoundsEl = document.getElementById('maxToolRounds');
  const maxToolRoundsValEl = document.getElementById('maxToolRoundsVal');
  if (maxToolRoundsEl) {
    maxToolRoundsEl.value = s.maxToolRounds || 15;
    if (maxToolRoundsValEl) maxToolRoundsValEl.textContent = s.maxToolRounds || 15;
  }
  
  // ⭐ 终端 Token 显示
  refreshTerminalTokenView();
  
  document.getElementById('testResult').className = 'test-result';
  document.getElementById('testResult').textContent = '';
  
  // 压缩设置
  const compEnabled = document.getElementById('compressAutoEnabled');
  const compThreshold = document.getElementById('compressAutoThreshold');
  const compThresholdVal = document.getElementById('compressThresholdVal');
  const compKeep = document.getElementById('compressKeepLast');
  const compKeepVal = document.getElementById('compressKeepLastVal');
  if (compEnabled) compEnabled.checked = !!s.compressAutoEnabled;
  if (compThreshold) compThreshold.value = s.compressAutoThreshold || 75;
  if (compThresholdVal) compThresholdVal.textContent = (s.compressAutoThreshold || 75) + '%';
  if (compKeep) compKeep.value = s.compressKeepLast || 4;
  if (compKeepVal) compKeepVal.textContent = s.compressKeepLast || 4;
  
  updateUrlPreview();
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('show');
}

function saveAndClose() {
  const s = state.settings;
  s.provider = document.getElementById('provider').value;
  s.baseUrl = document.getElementById('baseUrl').value.trim();
  s.apiPath = document.getElementById('apiPath').value.trim() || '/chat/completions';
  s.apiFormat = document.getElementById('apiFormat').value;
  s.apiKey = document.getElementById('apiKey').value.trim();
  s.modelName = document.getElementById('modelName').value.trim();
  s.systemPrompt = document.getElementById('systemPrompt').value;
  s.temperature = parseFloat(document.getElementById('temperature').value);
  s.maxTokens = parseInt(document.getElementById('maxTokens').value);
  s.stream = document.getElementById('streamMode').checked;
  // ⭐ 本地代理开关
  const proxyEl = document.getElementById('useLocalProxy');
  if (proxyEl) s.useLocalProxy = proxyEl.checked;
  // ⭐ 自动重试次数
  const retryEl = document.getElementById('retryMaxAttempts');
  if (retryEl) {
    const v = parseInt(retryEl.value);
    s.retryMaxAttempts = (isNaN(v) || v < 0) ? 3 : v;
  }
  
  // 工具调用轮数
  const maxToolRoundsEl = document.getElementById('maxToolRounds');
  if (maxToolRoundsEl) {
    const v = parseInt(maxToolRoundsEl.value);
    s.maxToolRounds = (isNaN(v) || v < 1) ? 15 : v;
  }
  
  // 压缩设置
  const compEnabled = document.getElementById('compressAutoEnabled');
  const compThreshold = document.getElementById('compressAutoThreshold');
  const compKeep = document.getElementById('compressKeepLast');
  if (compEnabled) s.compressAutoEnabled = compEnabled.checked;
  if (compThreshold) s.compressAutoThreshold = parseInt(compThreshold.value);
  if (compKeep) s.compressKeepLast = parseInt(compKeep.value);
  
  refreshModelSelect();
  persistSettings();
  closeSettings();
  updateTopUrlPreview();
  updateSendBtn();
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
  // ⭐ 切换 apiFormat（OpenAI ↔ Anthropic）会让 count_tokens 的可用性变化，
  // 且不同模型的上下文限制不同 → 立即重新拉一次精确 token 数
  if (typeof scheduleAccurateTokenCount === 'function') scheduleAccurateTokenCount();
}

function saveSettings() {
  state.settings.currentModel = document.getElementById('modelSelect').value;
  persistSettings();
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
}

function onProviderChange() {
  const p = document.getElementById('provider').value;
  if (PROVIDERS[p]) {
    document.getElementById('baseUrl').value = PROVIDERS[p].url;
    document.getElementById('apiPath').value = PROVIDERS[p].path;
    document.getElementById('apiFormat').value = PROVIDERS[p].format;
    document.getElementById('modelName').value = PROVIDERS[p].models;
    updateUrlPreview();
  }
}

function toggleKey() {
  const inp = document.getElementById('apiKey');
  const btn = document.getElementById('keyToggle');
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = '隐藏';
  } else {
    inp.type = 'password';
    btn.textContent = '显示';
  }
}

function refreshModelSelect() {
  const sel = document.getElementById('modelSelect');
  const list = state.settings.modelName.split(',').map(s => s.trim()).filter(Boolean);
  sel.innerHTML = list.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  if (list.includes(state.settings.currentModel)) sel.value = state.settings.currentModel;
  else if (list[0]) {
    sel.value = list[0];
    state.settings.currentModel = list[0];
  }
}

async function testConnection() {
  const r = document.getElementById('testResult');
  r.className = 'test-result';
  r.textContent = '测试中...';
  r.style.display = 'block';
  const baseUrl = document.getElementById('baseUrl').value.trim();
  const apiPath = document.getElementById('apiPath').value.trim() || '/chat/completions';
  const apiFormat = document.getElementById('apiFormat').value;
  const key = document.getElementById('apiKey').value.trim();
  const model = (document.getElementById('modelName').value.split(',')[0] || '').trim();
  
  if (!baseUrl || !key || !model) {
    r.className = 'test-result error';
    r.textContent = '❌ 请先填写 Base URL、API Key、模型';
    return;
  }
  
  const url = buildFullUrl(baseUrl, apiPath);
  let body, headers;
  if (apiFormat === 'anthropic') {
    body = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 };
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Authorization': 'Bearer ' + key
    };
  } else {
    body = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 };
    headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
  }
  
  try {
    // ⭐ 与正式请求保持一致：如果开启了本地代理，测试也走代理
    let realUrl = url;
    let realInit = { method: 'POST', headers, body: JSON.stringify(body) };
    const useProxy = document.getElementById('useLocalProxy');
    if (useProxy && useProxy.checked) {
      const tc = (typeof TERMINAL_CONFIG !== 'undefined') ? TERMINAL_CONFIG : null;
      if (!tc || !tc.token) {
        r.className = 'test-result error';
        r.innerHTML = '❌ 已勾选「本地代理」，但还没获取本地服务 Token。<br>请到「本地终端 Token」一栏点【拉取 Token】并在 Python 终端按 y 授权。';
        return;
      }
      realUrl = tc.serverUrl.replace(/\/+$/, '') + '/llm-proxy';
      realInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Token': tc.token,
          'X-Target-Url': url,
          'X-Target-Headers': JSON.stringify(headers)
        },
        body: JSON.stringify(body)
      };
    }
    const resp = await fetch(realUrl, realInit);
    const ct = resp.headers.get('content-type') || '';
    const txt = await resp.text();
    
    if (!resp.ok) {
      r.className = 'test-result error';
      r.innerHTML = `❌ HTTP ${resp.status}<br>URL: <code>${escapeHtml(url)}</code><pre>${escapeHtml(txt.slice(0, 400))}</pre>`;
      return;
    }
    if (!ct.includes('json')) {
      r.className = 'test-result error';
      r.innerHTML = `❌ 非 JSON 响应<br>URL: <code>${escapeHtml(url)}</code><br>Content-Type: <code>${escapeHtml(ct)}</code><pre>${escapeHtml(txt.slice(0, 400))}</pre>`;
      return;
    }
    let j;
    try { j = JSON.parse(txt); }
    catch (e) {
      r.className = 'test-result error';
      r.innerHTML = `❌ JSON 解析失败<pre>${escapeHtml(txt.slice(0, 400))}</pre>`;
      return;
    }
    let content = '';
    if (apiFormat === 'anthropic') content = (j.content || []).filter(p => p.type === 'text').map(p => p.text).join('');
    else content = j.choices?.[0]?.message?.content || '';
    
    r.className = 'test-result success';
    r.innerHTML = `✅ 连接成功！<br>URL: <code>${escapeHtml(url)}</code><br>回复: <code>${escapeHtml(content.slice(0, 100) || '(空)')}</code>`;
  } catch (e) {
    r.className = 'test-result error';
    r.innerHTML = `❌ 网络错误: ${escapeHtml(e.message)}<br>URL: <code>${escapeHtml(url)}</code>`;
  }
}

// ============ 本地终端 Token 管理 ============

function refreshTerminalTokenView() {
  const input = document.getElementById('terminalTokenView');
  const status = document.getElementById('terminalTokenStatus');
  const toggle = document.getElementById('termTokenToggle');
  if (!input) return;
  
  const tk = (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.token) || '';
  input.value = tk;
  input.type = 'password';  // 每次打开默认隐藏
  if (toggle) toggle.textContent = '显示';
  
  if (status) {
    if (tk) {
      status.textContent = `状态：✅ 已授权（${tk.length} 字符）`;
      status.style.color = 'var(--success, #16a34a)';
    } else {
      status.textContent = '状态：⚠️ 未授权（首次调用工具时会自动请求）';
      status.style.color = 'var(--warning, #d97706)';
    }
  }
}

function toggleTerminalTokenView() {
  const input = document.getElementById('terminalTokenView');
  const btn = document.getElementById('termTokenToggle');
  if (!input || !btn) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '隐藏';
  } else {
    input.type = 'password';
    btn.textContent = '显示';
  }
}

async function onFetchTerminalToken() {
  if (typeof fetchTerminalToken !== 'function') {
    toast('❌ terminal.js 未加载', 3000);
    return;
  }
  // 先清掉旧的，确保拿到的是新 token
  if (typeof saveTerminalToken === 'function') saveTerminalToken('');
  refreshTerminalTokenView();
  
  const tk = await fetchTerminalToken(false);
  refreshTerminalTokenView();
  if (tk) {
    toast('✅ 新 Token 已保存到浏览器', 2500);
  }
}

function onClearTerminalToken() {
  if (!confirm('确定要使当前 Token 失效吗？\n（只清除浏览器端，下次调用工具时会自动重新申请）')) return;
  if (typeof saveTerminalToken === 'function') saveTerminalToken('');
  refreshTerminalTokenView();
  toast('🗑️ Token 已清除', 2000);
}
