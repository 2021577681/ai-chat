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
  const completionSoundEl = document.getElementById('completionSoundEnabled');
  if (completionSoundEl) completionSoundEl.checked = !!s.completionSoundEnabled;
  const completionVolumeEl = document.getElementById('completionSoundVolume');
  const completionVolumeValEl = document.getElementById('completionSoundVolumeVal');
  if (completionVolumeEl) {
    const rawVolume = parseInt(s.completionSoundVolume);
    const v = isNaN(rawVolume) ? 80 : Math.max(0, Math.min(100, rawVolume));
    completionVolumeEl.value = v;
    if (completionVolumeValEl) completionVolumeValEl.textContent = v + '%';
  }
  // ⭐ 本地代理开关
  const proxyEl = document.getElementById('useLocalProxy');
  if (proxyEl) proxyEl.checked = !!s.useLocalProxy;
  // ⭐ 自动重试次数
  const retryEl = document.getElementById('retryMaxAttempts');
  const retryValEl = document.getElementById('retryMaxAttemptsVal');
  if (retryEl) {
    const v = retrySettingToSliderValue(s.retryMaxAttempts);
    retryEl.value = v;
    if (retryValEl) retryValEl.textContent = retrySliderDisplay(v);
  }
  
  // 工具调用轮数
  const maxToolRoundsEl = document.getElementById('maxToolRounds');
  const maxToolRoundsValEl = document.getElementById('maxToolRoundsVal');
  const maxToolRoundsInputEl = document.getElementById('maxToolRoundsInput');
  if (maxToolRoundsEl) {
    const v = s.maxToolRounds || 15;
    maxToolRoundsEl.value = Math.max(1, Math.min(100, v));
    if (maxToolRoundsInputEl) maxToolRoundsInputEl.value = v;
    if (maxToolRoundsValEl) maxToolRoundsValEl.textContent = v;
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
  // 🧪 自动信标
  const bEnabled = document.getElementById('beaconEnabled');
  const bInterval = document.getElementById('beaconInterval');
  const bIntervalVal = document.getElementById('beaconIntervalVal');
  if (bEnabled) bEnabled.checked = !!s.beaconEnabled;
  if (bInterval) bInterval.value = s.beaconInterval || 5;
  if (bIntervalVal) bIntervalVal.textContent = s.beaconInterval || 5;
  
  updateUrlPreview();
}

function currentSettingsModelName() {
  const current = state.settings.currentModel || '';
  const modelInput = document.getElementById('modelName');
  const list = (modelInput?.value || state.settings.modelName || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (current && (!list.length || list.includes(current))) return current;
  return list[0] || current || 'unknown';
}

function updateContextLimitModeUI() {
  renderContextLimitStatus();
}

function readContextLimitSettingsFromModal() {
  return true;
}

function openContextLimitSettings() {
  const wrap = document.querySelector('.more-menu-wrap');
  if (wrap) wrap.classList.remove('open');
  let modal = document.getElementById('contextLimitModal');
  if (modal && !modal.querySelector('.modal')) {
    modal.remove();
    modal = null;
  }
  if (!modal) {
    modal = buildContextLimitModal();
    document.body.appendChild(modal);
  }
  renderContextLimitTable();
  renderContextLimitStatus();
  modal.classList.add('show');
}

function closeContextLimitSettings() {
  const modal = document.getElementById('contextLimitModal');
  if (modal) modal.classList.remove('show');
}

function buildContextLimitModal() {
  const wrap = document.createElement('div');
  wrap.className = 'modal-mask context-limit-modal';
  wrap.id = 'contextLimitModal';
  wrap.innerHTML = `
    <div class="modal wide">
      <h2>📐 上下文长度 <button class="modal-close" onclick="closeContextLimitSettings()">×</button></h2>

      <div class="json-help">
        💡 模型名只要 <strong>包含</strong> 关键词（不区分大小写），就按对应上下文长度计算 token 条、自动压缩和长流程上下文检查。<br>
        多条命中时优先使用关键词更长的规则；未命中时使用内置自动识别，未知模型默认按 200k tokens。
      </div>

      <div class="pricing-section-title">
        <span>📌 当前模型</span>
        <span class="pricing-section-hint">保存规则后会立即刷新 token 条</span>
      </div>
      <div id="contextLimitStatus" class="context-limit-status"></div>

      <div class="pricing-section-title">
        <span>📋 匹配规则</span>
        <span class="pricing-section-hint">越具体的关键词越优先</span>
      </div>

      <div class="pricing-table-wrap">
        <table class="pricing-table context-limit-table" id="contextLimitTable">
          <thead>
            <tr>
              <th style="width:38%;">模型关键词</th>
              <th class="num" style="width:24%;">上下文长度 tokens</th>
              <th style="width:28%;">备注</th>
              <th class="act" style="width:10%;">操作</th>
            </tr>
          </thead>
          <tbody id="contextLimitTableBody"></tbody>
        </table>
      </div>

      <div class="pricing-toolbar">
        <button class="pricing-btn pricing-btn-primary" onclick="addContextLimitRow()">
          <span>➕</span><span>添加规则</span>
        </button>
        <button class="pricing-btn pricing-btn-success" onclick="saveContextLimitRulesFromUI()">
          <span>💾</span><span>保存规则</span>
        </button>
        <button class="pricing-btn" onclick="testContextLimitMatch()">
          <span>🔍</span><span>测试匹配</span>
        </button>
        <div class="pricing-btn-spacer"></div>
        <button class="pricing-btn pricing-btn-warning" onclick="resetContextLimitRulesToDefault()">
          <span>↩</span><span>恢复默认</span>
        </button>
      </div>

      <div id="contextLimitTestResult" class="pricing-test-result"></div>

      <div class="modal-footer">
        <button class="btn" onclick="closeContextLimitSettings()">关闭</button>
      </div>
    </div>
  `;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) closeContextLimitSettings();
  });
  return wrap;
}

function renderContextLimitStatus() {
  const el = document.getElementById('contextLimitStatus');
  if (!el) return;
  const model = state.settings.currentModel || currentSettingsModelName();
  const info = typeof getContextLimitInfo === 'function'
    ? getContextLimitInfo(model)
    : { limit: 200000, autoLimit: 200000, mode: 'auto', label: '自动识别' };
  const fmt = typeof formatNumber === 'function' ? formatNumber : n => String(n);
  const matchText = info.mode === 'matched'
    ? `命中关键词：<code>${escapeHtml(info.matchedKey || '')}</code>`
    : `未命中自定义规则，${info.label}`;
  el.innerHTML = `
    <div><strong>模型：</strong><code>${escapeHtml(model || 'unknown')}</code></div>
    <div><strong>当前上下文：</strong>${fmt(info.limit)} tokens <span style="color:var(--text-secondary);">（${matchText}；内置识别 ${fmt(info.autoLimit)}）</span></div>
  `;
}

function renderContextLimitTable() {
  const tbody = document.getElementById('contextLimitTableBody');
  if (!tbody) return;
  const list = typeof loadContextLimitRules === 'function' ? loadContextLimitRules() : [];
  if (!list.length) {
    tbody.innerHTML = `<tr class="pricing-empty"><td colspan="4">暂无规则，点击 <strong>➕ 添加规则</strong> 或 <strong>↩ 恢复默认</strong> 开始</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((rule, i) => renderContextLimitRow(rule, i)).join('');
}

function renderContextLimitRow(rule, i) {
  return `
    <tr data-idx="${i}">
      <td><input type="text" class="pricing-input context-limit-key" value="${escapeHtml(rule.key || '')}" placeholder="如 gpt-4o" /></td>
      <td><input type="number" class="pricing-input context-limit-value" value="${rule.limit || 0}" min="1024" max="4000000" step="1000" /></td>
      <td><input type="text" class="pricing-input context-limit-note" value="${escapeHtml(rule.note || '')}" placeholder="可选" /></td>
      <td style="text-align:center;">
        <button class="pricing-row-del" onclick="removeContextLimitRow(${i})" title="删除此规则">×</button>
      </td>
    </tr>
  `;
}

function collectContextLimitRulesFromUI(options = {}) {
  const tbody = document.getElementById('contextLimitTableBody');
  if (!tbody) return [];
  const includeEmpty = options.includeEmpty === true;
  const rows = tbody.querySelectorAll('tr[data-idx]');
  const out = [];
  rows.forEach(tr => {
    const key = tr.querySelector('.context-limit-key')?.value.trim() || '';
    const rawLimit = tr.querySelector('.context-limit-value')?.value;
    const note = tr.querySelector('.context-limit-note')?.value.trim() || '';
    const limit = typeof normalizeContextLimitOverride === 'function'
      ? normalizeContextLimitOverride(rawLimit)
      : Math.max(1024, Math.min(4000000, parseInt(rawLimit) || 0));
    if (!key && !includeEmpty) return;
    out.push({ key, limit, note: note || undefined });
  });
  return out;
}

function renderContextLimitListInMemory(list) {
  const tbody = document.getElementById('contextLimitTableBody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr class="pricing-empty"><td colspan="4">暂无规则</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((rule, i) => renderContextLimitRow(rule, i)).join('');
}

function addContextLimitRow() {
  const current = collectContextLimitRulesFromUI();
  current.push({ key: '', limit: 200000, note: '' });
  renderContextLimitListInMemory(current);
}

function removeContextLimitRow(idx) {
  const tbody = document.getElementById('contextLimitTableBody');
  if (!tbody) return;
  const tr = tbody.querySelector(`tr[data-idx="${idx}"]`);
  if (tr) tr.remove();
  renderContextLimitListInMemory(collectContextLimitRulesFromUI({ includeEmpty: true }));
}

function saveContextLimitRulesFromUI() {
  const list = collectContextLimitRulesFromUI();
  if (typeof saveContextLimitRules === 'function') saveContextLimitRules(list);
  if (typeof toast === 'function') toast(`✓ 已保存 ${list.length} 条上下文规则`);
  renderContextLimitTable();
  renderContextLimitStatus();
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
  if (typeof scheduleAccurateTokenCount === 'function') scheduleAccurateTokenCount();
}

function resetContextLimitRulesToDefault() {
  if (!confirm('确定恢复为默认上下文长度规则？\n\n你当前的自定义规则会被覆盖。')) return;
  const defaults = typeof DEFAULT_CONTEXT_LIMIT_RULES !== 'undefined'
    ? DEFAULT_CONTEXT_LIMIT_RULES.map(x => ({ ...x }))
    : [];
  if (typeof saveContextLimitRules === 'function') saveContextLimitRules(defaults);
  renderContextLimitTable();
  renderContextLimitStatus();
  if (typeof toast === 'function') toast('↩ 已恢复默认上下文规则');
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
}

function testContextLimitMatch() {
  const model = prompt('输入一个模型名测试匹配结果：', state.settings.currentModel || 'gpt-4o-mini');
  if (model === null) return;
  const result = typeof getContextLimitInfo === 'function'
    ? getContextLimitInfo(model.trim())
    : { limit: 200000, autoLimit: 200000, mode: 'auto', label: '自动识别' };
  const el = document.getElementById('contextLimitTestResult');
  if (!el) return;
  const fmt = typeof formatNumber === 'function' ? formatNumber : n => String(n);
  if (result.mode === 'matched') {
    el.className = 'pricing-test-result show ok';
    el.innerHTML = `✅ 模型 <code>${escapeHtml(model)}</code> 匹配到关键词 <code>${escapeHtml(result.matchedKey || '')}</code><br><span style="color:var(--text-secondary);">上下文长度 <strong>${fmt(result.limit)}</strong> tokens</span>`;
  } else {
    el.className = 'pricing-test-result show warn';
    el.innerHTML = `⚠️ 模型 <code>${escapeHtml(model)}</code> 未匹配自定义规则，使用内置识别<br><span style="color:var(--text-secondary);">上下文长度 <strong>${fmt(result.limit)}</strong> tokens</span>`;
  }
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('show');
}

function saveAndClose() {
  const s = state.settings;
  s.provider = document.getElementById('provider').value;
  s.baseUrl = document.getElementById('baseUrl').value.trim();
  s.apiFormat = document.getElementById('apiFormat').value;
  s.apiPath = document.getElementById('apiPath').value.trim()
    || (s.apiFormat === 'responses' ? '/responses' : (s.apiFormat === 'anthropic' ? '/messages' : '/chat/completions'));
  s.apiKey = document.getElementById('apiKey').value.trim();
  s.modelName = document.getElementById('modelName').value.trim();
  s.systemPrompt = document.getElementById('systemPrompt').value;
  s.temperature = parseFloat(document.getElementById('temperature').value);
  s.maxTokens = parseInt(document.getElementById('maxTokens').value);
  s.stream = document.getElementById('streamMode').checked;
  const completionSoundEl = document.getElementById('completionSoundEnabled');
  if (completionSoundEl) s.completionSoundEnabled = completionSoundEl.checked;
  const completionVolumeEl = document.getElementById('completionSoundVolume');
  if (completionVolumeEl) {
    const v = parseInt(completionVolumeEl.value);
    s.completionSoundVolume = isNaN(v) ? 80 : Math.max(0, Math.min(100, v));
  }
  if (s.completionSoundEnabled && typeof ensureCompletionSoundReady === 'function') ensureCompletionSoundReady();
  // ⭐ 本地代理开关
  const proxyEl = document.getElementById('useLocalProxy');
  if (proxyEl) s.useLocalProxy = proxyEl.checked;
  // ⭐ 自动重试次数
  const retryEl = document.getElementById('retryMaxAttempts');
  if (retryEl) {
    s.retryMaxAttempts = retrySliderValueToSetting(retryEl.value);
  }
  
  // 工具调用轮数
  const maxToolRoundsEl = document.getElementById('maxToolRounds');
  const maxToolRoundsInputEl = document.getElementById('maxToolRoundsInput');
  if (maxToolRoundsInputEl || maxToolRoundsEl) {
    const raw = maxToolRoundsInputEl ? maxToolRoundsInputEl.value : maxToolRoundsEl.value;
    const v = parseInt(raw);
    s.maxToolRounds = (isNaN(v) || v < 1) ? 15 : v;
  }
  
  // 压缩设置
  const compEnabled = document.getElementById('compressAutoEnabled');
  const compThreshold = document.getElementById('compressAutoThreshold');
  const compKeep = document.getElementById('compressKeepLast');
  if (compEnabled) s.compressAutoEnabled = compEnabled.checked;
  if (compThreshold) s.compressAutoThreshold = parseInt(compThreshold.value);
  if (compKeep) s.compressKeepLast = parseInt(compKeep.value);
  
  // 🧪 自动信标
  const bEnabled = document.getElementById('beaconEnabled');
  const bInterval = document.getElementById('beaconInterval');
  if (bEnabled) s.beaconEnabled = bEnabled.checked;
  if (bInterval) {
    const v = parseInt(bInterval.value);
    s.beaconInterval = (isNaN(v) || v < 1) ? 5 : v;
  }
  
  refreshModelSelect();
  persistSettings();
  closeSettings();
  updateTopUrlPreview();
  updateSendBtn();
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
  // ⭐ 切换 apiFormat（OpenAI ↔ Anthropic）会让 count_tokens 的可用性变化，
  // 且不同模型的上下文限制不同 → 立即重新拉一次精确 token 数
  if (typeof scheduleAccurateTokenCount === 'function') scheduleAccurateTokenCount();
  return true;
}

function saveSettings() {
  const modelSelect = document.getElementById('modelSelect');
  if (modelSelect) state.settings.currentModel = modelSelect.value;
  const effortSelect = document.getElementById('effortSelect');
  if (effortSelect) state.settings.reasoningEffort = effortSelect.value;
  refreshModelPickerState();
  persistSettings();
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
  if (document.getElementById('settingsModal')?.classList.contains('show')) {
    updateContextLimitModeUI();
  }
}

function onProviderChange() {
  const p = document.getElementById('provider').value;
  if (PROVIDERS[p]) {
    document.getElementById('baseUrl').value = PROVIDERS[p].url;
    document.getElementById('apiPath').value = PROVIDERS[p].path;
    document.getElementById('apiFormat').value = PROVIDERS[p].format;
    document.getElementById('modelName').value = PROVIDERS[p].models;
    updateUrlPreview();
    updateContextLimitModeUI();
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
  renderModelPickerMenu(list);
  refreshModelPickerState();
  refreshReasoningEffortSelect();
}

function renderModelPickerMenu(list) {
  const menu = document.getElementById('modelMenu');
  if (!menu) return;
  const items = (list || []).filter(Boolean);
  if (!items.length) {
    menu.innerHTML = '<div class="model-option-empty">暂无模型</div>';
    return;
  }
  menu.innerHTML = items.map(m => `
    <button type="button" class="model-option" data-model="${escapeHtml(m)}" onclick="setCurrentModelFromPicker(this.dataset.model, event)" role="option" title="${escapeHtml(m)}">
      <span class="model-option-name">${escapeHtml(m)}</span>
      <span class="model-option-check">✓</span>
    </button>
  `).join('');
}

function refreshModelPickerState() {
  const sel = document.getElementById('modelSelect');
  const value = sel ? (sel.value || state.settings.currentModel || '') : (state.settings.currentModel || '');
  const label = document.getElementById('modelTriggerLabel');
  if (label) label.textContent = value || '选择模型';
  document.querySelectorAll('.model-option').forEach(btn => {
    const active = btn.dataset.model === value;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function toggleModelMenu(event) {
  if (event) event.stopPropagation();
  const picker = document.getElementById('modelPicker');
  const menu = document.getElementById('modelMenu');
  const trigger = document.getElementById('modelTrigger');
  if (!picker || !menu) return;
  const nextOpen = menu.hidden;
  menu.hidden = !nextOpen;
  picker.classList.toggle('open', nextOpen);
  if (trigger) trigger.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  if (nextOpen) refreshModelPickerState();
}

function closeModelMenu() {
  const picker = document.getElementById('modelPicker');
  const menu = document.getElementById('modelMenu');
  const trigger = document.getElementById('modelTrigger');
  if (menu) menu.hidden = true;
  if (picker) picker.classList.remove('open');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function setCurrentModelFromPicker(value, event) {
  if (event) event.stopPropagation();
  const sel = document.getElementById('modelSelect');
  if (sel) sel.value = value;
  state.settings.currentModel = value;
  refreshModelPickerState();
  saveSettings();
  closeModelMenu();
}

function refreshReasoningEffortSelect() {
  const sel = document.getElementById('effortSelect');
  if (!sel) return;
  const allowed = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
  const value = allowed.includes(state.settings.reasoningEffort) ? state.settings.reasoningEffort : '';
  sel.value = value;
  state.settings.reasoningEffort = value;
  const label = document.getElementById('effortTriggerLabel');
  if (label) label.textContent = value || '不设置';
  document.querySelectorAll('.effort-option').forEach(btn => {
    const active = btn.dataset.effort === value;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function toggleReasoningEffortMenu(event) {
  if (event) event.stopPropagation();
  const picker = document.getElementById('effortPicker');
  const menu = document.getElementById('effortMenu');
  const trigger = document.getElementById('effortTrigger');
  if (!picker || !menu) return;
  const nextOpen = menu.hidden;
  menu.hidden = !nextOpen;
  picker.classList.toggle('open', nextOpen);
  if (trigger) trigger.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  if (nextOpen) refreshReasoningEffortSelect();
}

function closeReasoningEffortMenu() {
  const picker = document.getElementById('effortPicker');
  const menu = document.getElementById('effortMenu');
  const trigger = document.getElementById('effortTrigger');
  if (menu) menu.hidden = true;
  if (picker) picker.classList.remove('open');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function setReasoningEffort(value, event) {
  if (event) event.stopPropagation();
  const sel = document.getElementById('effortSelect');
  if (sel) sel.value = value;
  state.settings.reasoningEffort = value;
  refreshReasoningEffortSelect();
  saveSettings();
  closeReasoningEffortMenu();
}

document.addEventListener('click', e => {
  if (!e.target.closest('.model-picker')) closeModelMenu();
  if (!e.target.closest('.effort-picker')) closeReasoningEffortMenu();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModelMenu();
    closeReasoningEffortMenu();
  }
});

async function testConnection() {
  const r = document.getElementById('testResult');
  r.className = 'test-result';
  r.textContent = '测试中...';
  r.style.display = 'block';
  const baseUrl = document.getElementById('baseUrl').value.trim();
  const apiFormat = document.getElementById('apiFormat').value;
  const apiPath = document.getElementById('apiPath').value.trim()
    || (apiFormat === 'responses' ? '/responses' : (apiFormat === 'anthropic' ? '/messages' : '/chat/completions'));
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
  } else if (apiFormat === 'responses') {
    body = { model, input: 'hi', max_output_tokens: 10 };
    headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
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
    else if (apiFormat === 'responses') content = extractResponsesText(j);
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

// ============================================================
// 📡 拉取模型列表（OpenAI / Anthropic 兼容）
// ============================================================
//
// 行为：
//   1. 读取设置弹窗当前填写的 Base URL / API Key / API 格式
//   2. 调用 GET {baseUrl}/models（如已开启本地代理则走 /llm-proxy）
//   3. 解析返回，弹出复选框选择窗口
//   4. 用户勾选后追加到模型名称输入框（已存在的自动跳过）
//
// 注意：
//   - Anthropic 的 /v1/models 自 2024-10 起官方支持，需要 anthropic-version
//   - 部分代理商不实现 /models（如某些转发服务），会优雅降级
//

let _fetchModelsBuffer = [];   // 当前拉取到的模型列表（用于过滤/全选）
let _fetchModelsExisting = new Set();  // 当前输入框已有的模型
let _fetchModelsSelected = new Set();  // 当前已勾选的模型，过滤列表时保持选择状态

async function onFetchModels() {
  const baseUrl = (document.getElementById('baseUrl').value || '').trim();
  const apiKey = (document.getElementById('apiKey').value || '').trim();
  const apiFormat = document.getElementById('apiFormat').value;
  
  if (!baseUrl) { toast('❌ 请先填写 Base URL', 2500); return; }
  if (!apiKey) { toast('❌ 请先填写 API Key', 2500); return; }
  
  // 立即打开弹窗，显示加载中
  openFetchModelsModal();
  const listEl = document.getElementById('fetchModelsList');
  const countEl = document.getElementById('fetchModelsCount');
  const hintEl = document.getElementById('fetchModelsHint');
  if (hintEl) hintEl.style.display = 'none';
  _fetchModelsBuffer = [];
  _fetchModelsExisting = new Set();
  _fetchModelsSelected = new Set();
  updateFetchModelsSelectAllButton();
  listEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">📡 正在拉取模型列表…</div>';
  if (countEl) countEl.textContent = '加载中…';
  
  // 构造 GET /models 请求
  const url = buildModelsUrl(baseUrl);
  const headers = buildModelsHeaders(apiKey, apiFormat);
  
  let models = [];
  let errorMsg = '';
  try {
    const resp = await fetchModelsViaCorrectChannel(url, headers);
    if (!resp.ok) {
      errorMsg = `HTTP ${resp.status}：${(resp.text || '').slice(0, 200)}`;
    } else {
      models = parseModelsResponse(resp.text, apiFormat);
      if (!models.length) {
        errorMsg = '响应解析后为空。原始响应预览：\n' + (resp.text || '').slice(0, 300);
      }
    }
  } catch (e) {
    errorMsg = '网络错误：' + (e.message || e);
  }
  
  if (errorMsg) {
    listEl.innerHTML = `
      <div style="padding:16px;color:var(--danger,#dc2626);">
        <strong>❌ 拉取失败</strong>
        <pre style="margin-top:8px;white-space:pre-wrap;font-size:12px;background:rgba(220,38,38,0.08);padding:8px;border-radius:6px;">${escapeHtml(errorMsg)}</pre>
        <div style="margin-top:10px;font-size:12.5px;color:var(--text-secondary);line-height:1.6;">
          可能原因：<br>
          • 服务商不支持 <code>/models</code> 端点（如某些第三方转发）<br>
          • Base URL 填错（应为根地址，不含 <code>/chat/completions</code> 或 <code>/responses</code>）<br>
          • 跨域：可在上方勾选「通过本地服务代理」<br>
          • API Key 无效或权限不足
        </div>
      </div>`;
    if (countEl) countEl.textContent = '0 个';
    updateFetchModelsSelectAllButton();
    return;
  }
  
  // 排序：含 deepseek / claude / gpt / qwen / glm / o1 / gemini 之类的优先
  models = sortModelsByRelevance(models);
  _fetchModelsBuffer = models;
  
  // 记录已存在的（去重提示）
  const currentText = (document.getElementById('modelName').value || '').trim();
  _fetchModelsExisting = new Set(currentText.split(',').map(s => s.trim()).filter(Boolean));
  
  renderFetchModelsList(models);
  
  if (hintEl) {
    hintEl.style.display = 'block';
    hintEl.innerHTML = `✅ 从 <code>${escapeHtml(url)}</code> 拉取到 <strong>${models.length}</strong> 个模型。已自动跳过已添加的 ${_fetchModelsExisting.size} 个。`;
  }
}

function buildModelsUrl(baseUrl) {
  // baseUrl 末尾去 /，并去掉常见的子路径（兼容用户把完整端点填进去的场景）
  let b = baseUrl.replace(/\/+$/, '');
  // 去掉常见结尾路径
  b = b.replace(/\/(chat\/completions|responses|messages|completions)$/i, '');
  return b + '/models';
}

function buildModelsHeaders(apiKey, apiFormat) {
  if (apiFormat === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };
  }
  return { 'Authorization': 'Bearer ' + apiKey };
}

// 真正发请求：可选择走本地代理（解决 CORS）
async function fetchModelsViaCorrectChannel(url, headers) {
  const useProxy = document.getElementById('useLocalProxy');
  // 1) 不走代理：直接 fetch
  if (!useProxy || !useProxy.checked) {
    const resp = await fetch(url, { method: 'GET', headers });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, text };
  }
  
  // 2) 走代理：用 /llm-proxy
  const tc = (typeof TERMINAL_CONFIG !== 'undefined') ? TERMINAL_CONFIG : null;
  if (!tc || !tc.serverUrl) {
    throw new Error('本地代理未加载，请确认 terminal.js 已加载');
  }
  if (!tc.token && typeof fetchTerminalToken === 'function') {
    await fetchTerminalToken(true);
  }
  if (!tc.token) {
    throw new Error('本地代理 Token 获取失败，请确认 local_terminal_server.py 已启动');
  }
  const proxyUrl = tc.serverUrl.replace(/\/+$/, '') + '/llm-proxy';
  const resp = await fetch(proxyUrl, {
    method: 'POST',  // /llm-proxy 始终用 POST，靠 header 传目标
    headers: {
      'Content-Type': 'application/json',
      'X-Token': tc.token,
      'X-Target-Url': url,
      'X-Target-Method': 'GET',
      'X-Target-Headers': JSON.stringify(headers)
    },
    // /llm-proxy 期望有 body，给空对象避免有的实现报错
    body: '{}'
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, text };
}

function parseModelsResponse(text, apiFormat) {
  if (!text) return [];
  let j;
  try { j = JSON.parse(text); } catch (e) { return []; }
  
  // OpenAI / 兼容：{ data: [{ id: "gpt-4o", ... }, ...] }
  if (Array.isArray(j.data)) {
    return j.data
      .map(m => (m && (m.id || m.name)) || '')
      .filter(Boolean);
  }
  // Anthropic v1/models：{ data: [{ id: "claude-...", display_name, type:"model" }] }
  // 已被上面覆盖
  
  // 兜底：有些代理直接返回数组
  if (Array.isArray(j)) {
    return j.map(m => (typeof m === 'string') ? m : (m.id || m.name || '')).filter(Boolean);
  }
  // 有些返回 { models: [...] }
  if (Array.isArray(j.models)) {
    return j.models.map(m => (typeof m === 'string') ? m : (m.id || m.name || '')).filter(Boolean);
  }
  return [];
}

function sortModelsByRelevance(models) {
  // 把"主流命名"排到前面，便于用户选择
  const PRIORITY_KEYWORDS = [
    'gpt-4o', 'gpt-4', 'o1', 'o3',
    'claude-3-5-sonnet', 'claude-3-7', 'claude-opus', 'claude-sonnet', 'claude-haiku',
    'deepseek-chat', 'deepseek-reasoner', 'deepseek-v3',
    'qwen-max', 'qwen-plus', 'qwen2.5',
    'glm-4', 'gemini-2', 'gemini-1.5',
  ];
  function score(name) {
    const lower = name.toLowerCase();
    for (let i = 0; i < PRIORITY_KEYWORDS.length; i++) {
      if (lower.includes(PRIORITY_KEYWORDS[i])) return i;
    }
    return 999;
  }
  return models.slice().sort((a, b) => {
    const sa = score(a), sb = score(b);
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b);
  });
}

function renderFetchModelsList(models) {
  const listEl = document.getElementById('fetchModelsList');
  const countEl = document.getElementById('fetchModelsCount');
  if (!models.length) {
    listEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">无匹配模型</div>';
    if (countEl) {
      const selectedCount = Array.from(_fetchModelsSelected).filter(m => !_fetchModelsExisting.has(m)).length;
      countEl.textContent = selectedCount ? `0 个匹配（已选 ${selectedCount} 个）` : '0 个';
    }
    updateFetchModelsSelectAllButton();
    return;
  }
  const html = models.map(m => {
    const exists = _fetchModelsExisting.has(m);
    const checked = exists || _fetchModelsSelected.has(m);
    const safe = escapeHtml(m);
    return `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;border-radius:6px;${exists ? 'opacity:.55;' : ''}"
             onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
        <input type="checkbox" class="fetchModelItem" value="${safe}" ${checked ? 'checked' : ''} ${exists ? 'disabled' : ''} onchange="onFetchModelItemToggle(this)">
        <span style="flex:1;font-family:monospace;font-size:13px;">${safe}</span>
        ${exists ? '<span style="font-size:11px;color:var(--text-secondary);">✓ 已添加</span>' : ''}
      </label>`;
  }).join('');
  listEl.innerHTML = html;
  if (countEl) {
    const newCount = models.filter(m => !_fetchModelsExisting.has(m)).length;
    const selectedCount = Array.from(_fetchModelsSelected).filter(m => !_fetchModelsExisting.has(m)).length;
    countEl.textContent = `共 ${models.length} 个（${newCount} 个未添加，已选 ${selectedCount} 个）`;
  }
  updateFetchModelsSelectAllButton();
}

function filterFetchModels() {
  renderFetchModelsList(getCurrentFetchModelsView());
}

function getCurrentFetchModelsView() {
  const kw = (document.getElementById('fetchModelsFilter')?.value || '').trim().toLowerCase();
  return kw
    ? _fetchModelsBuffer.filter(m => m.toLowerCase().includes(kw))
    : _fetchModelsBuffer;
}

function getSelectableFetchedModels() {
  return _fetchModelsBuffer.filter(m => !_fetchModelsExisting.has(m));
}

function onFetchModelItemToggle(box) {
  if (!box || box.disabled) return;
  if (box.checked) _fetchModelsSelected.add(box.value);
  else _fetchModelsSelected.delete(box.value);
  renderFetchModelsList(getCurrentFetchModelsView());
}

function updateFetchModelsSelectAllButton() {
  const btn = document.getElementById('fetchModelsSelAllBtn');
  if (!btn) return;
  const selectable = getSelectableFetchedModels();
  const selectedCount = selectable.filter(m => _fetchModelsSelected.has(m)).length;
  btn.disabled = selectable.length === 0;
  btn.textContent = selectedCount === selectable.length && selectable.length ? '全不选' : '全选';
  btn.title = selectable.length ? `选择本次拉取到的 ${selectable.length} 个未添加模型` : '没有可选择的新模型';
}

function toggleSelectAllFetchModels() {
  const selectable = getSelectableFetchedModels();
  if (!selectable.length) return;
  const shouldSelectAll = selectable.some(m => !_fetchModelsSelected.has(m));
  if (shouldSelectAll) {
    selectable.forEach(m => _fetchModelsSelected.add(m));
  } else {
    selectable.forEach(m => _fetchModelsSelected.delete(m));
  }
  renderFetchModelsList(getCurrentFetchModelsView());
}

function confirmAddFetchedModels() {
  const picked = _fetchModelsBuffer.filter(m => _fetchModelsSelected.has(m) && !_fetchModelsExisting.has(m));
  if (!picked.length) { toast('未选择任何模型', 2000); return; }
  
  const input = document.getElementById('modelName');
  const existing = (input.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const existingSet = new Set(existing);
  let added = 0;
  picked.forEach(m => {
    if (!existingSet.has(m)) { existing.push(m); existingSet.add(m); added++; }
  });
  input.value = existing.join(', ');
  updateContextLimitModeUI();
  
  toast(`✅ 已添加 ${added} 个模型（共 ${existing.length} 个）`, 2500);
  closeFetchModelsModal();
}

function openFetchModelsModal() {
  document.getElementById('fetchModelsModal').classList.add('show');
}

function closeFetchModelsModal() {
  document.getElementById('fetchModelsModal').classList.remove('show');
  _fetchModelsBuffer = [];
  _fetchModelsExisting = new Set();
  _fetchModelsSelected = new Set();
  updateFetchModelsSelectAllButton();
  const f = document.getElementById('fetchModelsFilter');
  if (f) f.value = '';
}

// 暴露到全局
window.onFetchModels = onFetchModels;
window.filterFetchModels = filterFetchModels;
window.onFetchModelItemToggle = onFetchModelItemToggle;
window.toggleSelectAllFetchModels = toggleSelectAllFetchModels;
window.confirmAddFetchedModels = confirmAddFetchedModels;
window.openFetchModelsModal = openFetchModelsModal;
window.closeFetchModelsModal = closeFetchModelsModal;
window.openContextLimitSettings = openContextLimitSettings;
window.closeContextLimitSettings = closeContextLimitSettings;
window.updateContextLimitModeUI = updateContextLimitModeUI;
window.addContextLimitRow = addContextLimitRow;
window.removeContextLimitRow = removeContextLimitRow;
window.saveContextLimitRulesFromUI = saveContextLimitRulesFromUI;
window.resetContextLimitRulesToDefault = resetContextLimitRulesToDefault;
window.testContextLimitMatch = testContextLimitMatch;
