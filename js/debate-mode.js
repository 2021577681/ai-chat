// ============ 辩论模式 ============

const DEBATE_SETTINGS_KEY = 'aichat_debate_settings_v1';
const DEBATE_RUNTIME = {};
const DEBATE_REVIEW_TIMEOUT_SLIDER_MAX = 120;
const DEBATE_FINAL_JUDGE_TIMEOUT_SLIDER_MAX = 300;
const DEBATE_TIMEOUT_SAFE_MAX_SECONDS = 2147483;

function _debateDefaultSettings() {
  return {
    topic: '',
    totalRounds: 3,
    answerThreshold: 6,
    maxExchanges: 10,
    reviewTimeoutSec: 120,
    finalJudgeTimeoutSec: 300,
    pro: {
      profileId: '__current',
      model: state.settings.currentModel || '',
      systemPrompt: '你是辩论赛中的正方辩手。\n辩题：{{topic}}\n你必须坚持正方立场。\n默认不使用工具，不要提及工具、计划模式、大纲模式或系统实现。\n本次你负责{{task}}：{{taskDesc}}\n如果你确实无法反驳，可以明确承认无法反驳或主动认输，不要强行狡辩。\n输出只写你的辩论发言，不要附加 JSON、评审、分数或角色说明。'
    },
    con: {
      profileId: '__current',
      model: state.settings.currentModel || '',
      systemPrompt: '你是辩论赛中的反方辩手。\n辩题：{{topic}}\n你必须坚持反方立场。\n默认不使用工具，不要提及工具、计划模式、大纲模式或系统实现。\n本次你负责{{task}}：{{taskDesc}}\n如果你确实无法反驳，可以明确承认无法反驳或主动认输，不要强行狡辩。\n输出只写你的辩论发言，不要附加 JSON、评审、分数或角色说明。'
    },
    judge: {
      profileId: '__current',
      model: state.settings.currentModel || '',
      systemPrompt: '你是辩论赛评委，只负责审核当前发言是否可以通过。\n审核标准要宽松：只要发言整体合理、回应了任务，即使有瑕疵也通过。\n不需要打分。\n如果当前发言明显无关、没有完成立论/反驳、反驳没有道理、无法回应对方，或主动认输，则不通过。\n只输出 JSON，格式为 {"pass":true|false,"reason":"简短说明"}。'
    }
  };
}

function loadDebateSettings() {
  try {
    const raw = storage.get(DEBATE_SETTINGS_KEY);
    if (!raw) return _debateDefaultSettings();
    const parsed = JSON.parse(raw);
    const defaults = _debateDefaultSettings();
    return {
      ...defaults,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      pro: { ...defaults.pro, ...(parsed && parsed.pro ? parsed.pro : {}) },
      con: { ...defaults.con, ...(parsed && parsed.con ? parsed.con : {}) },
      judge: { ...defaults.judge, ...(parsed && parsed.judge ? parsed.judge : {}) }
    };
  } catch (e) {
    console.warn('[debate] settings load failed:', e);
    return _debateDefaultSettings();
  }
}

function saveDebateSettings(next) {
  try {
    const defaults = _debateDefaultSettings();
    storage.set(DEBATE_SETTINGS_KEY, JSON.stringify({
      ...defaults,
      ...(next || {}),
      pro: { ...defaults.pro, ...((next && next.pro) || {}) },
      con: { ...defaults.con, ...((next && next.con) || {}) },
      judge: { ...defaults.judge, ...((next && next.judge) || {}) }
    }));
  } catch (e) {
    console.warn('[debate] settings save failed:', e);
  }
}

function _debateId(prefix = 'deb') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function _debateClampRounds(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 3) return 3;
  return Math.min(99, n);
}

function _debateClampThreshold(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(99, n);
}

function _debateClampMaxExchanges(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 2) return 2;
  return Math.min(99, n);
}

function _debateClampTimeoutSeconds(value, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(DEBATE_TIMEOUT_SAFE_MAX_SECONDS, n);
}

function _debateSliderTimeoutValue(value, sliderMax) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(sliderMax, n);
}

function debateTimeoutInputChanged(kind) {
  const input = document.getElementById(`debate${kind}Timeout`);
  const slider = document.getElementById(`debate${kind}TimeoutSlider`);
  if (!input || !slider) return;
  slider.value = _debateSliderTimeoutValue(input.value, parseInt(slider.max, 10) || 1);
}

function debateTimeoutSliderChanged(kind) {
  const input = document.getElementById(`debate${kind}Timeout`);
  const slider = document.getElementById(`debate${kind}TimeoutSlider`);
  if (!input || !slider) return;
  input.value = slider.value;
}

function _debateCurrentRound(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(99, n);
}

function _debateChineseNumber(n) {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n <= 9) return digits[n] || String(n);
  if (n === 10) return '十';
  if (n < 20) return '十' + digits[n - 10];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return digits[tens] + '十' + (ones ? digits[ones] : '');
  }
  return String(n);
}

function _debateSideName(side) {
  return side === 'pro' ? '正方' : '反方';
}

function _debateOtherSide(side) {
  return side === 'pro' ? 'con' : 'pro';
}

function _debateRoleLabel(role) {
  if (role === 'pro') return '正方';
  if (role === 'con') return '反方';
  if (role === 'judge') return '评委';
  return role || '';
}

function _debateGetProfiles() {
  return typeof loadApiProfiles === 'function' ? loadApiProfiles() : [];
}

function _debateProfileById(profileId) {
  if (!profileId || profileId === '__current') return null;
  return _debateGetProfiles().find(p => p && p.id === profileId) || null;
}

function _debateProfileSettings(profileId) {
  const profile = _debateProfileById(profileId);
  return profile && profile.settings ? profile.settings : state.settings;
}

function _debateProfileName(profileId) {
  if (!profileId || profileId === '__current') return '当前主设置';
  const profile = _debateProfileById(profileId);
  return profile ? profile.name : '已删除配置';
}

function _debateModelsForProfile(profileId) {
  const s = _debateProfileSettings(profileId);
  // 优先从 profile 的 modelName 取，为空时回退到当前主设置的 modelName
  let modelNameStr = s.modelName || '';
  if (!modelNameStr && profileId !== '__current') {
    modelNameStr = state.settings.modelName || '';
  }
  const list = String(modelNameStr)
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  // 确保 currentModel 也在列表中
  const currentModel = s.currentModel || state.settings.currentModel || '';
  if (currentModel && !list.includes(currentModel)) list.unshift(currentModel);
  // 如果仍然为空，尝试从 PROVIDERS 配置中获取默认模型
  if (!list.length && typeof PROVIDERS !== 'undefined') {
    const provider = s.provider || state.settings.provider || '';
    const prov = PROVIDERS[provider];
    if (prov && prov.models) {
      const defaults = String(prov.models).split(',').map(x => x.trim()).filter(Boolean);
      for (const m of defaults) { if (!list.includes(m)) list.push(m); }
    }
  }
  return [...new Set(list)];
}

function _debateNormalizeRoleConfig(roleConfig) {
  const cfg = roleConfig && typeof roleConfig === 'object' ? roleConfig : {};
  const profileId = cfg.profileId || '__current';
  const models = _debateModelsForProfile(profileId);
  const defaults = _debateDefaultSettings();
  // 查默认提示词（按角色名找，pro/con/judge）
  let defaultPrompt = '';
  if (cfg._roleKey && defaults[cfg._roleKey]) {
    defaultPrompt = defaults[cfg._roleKey].systemPrompt || '';
  }
  return {
    profileId,
    model: String(cfg.model || models[0] || state.settings.currentModel || '').trim(),
    systemPrompt: String(cfg.systemPrompt !== undefined ? cfg.systemPrompt : defaultPrompt).trim()
  };
}

function _debateProfileOptions(selected) {
  const profiles = _debateGetProfiles();
  return [
    `<option value="__current"${selected === '__current' || !selected ? ' selected' : ''}>当前主设置</option>`,
    ...profiles.map(p => `<option value="${escapeHtml(p.id)}"${p.id === selected ? ' selected' : ''}>${escapeHtml(p.name)}</option>`)
  ].join('');
}

function _debateModelOptions(role, selectedProfileId, selectedModel) {
  const models = _debateModelsForProfile(selectedProfileId);
  const cleanSelected = String(selectedModel || models[0] || '').trim();
  const options = [...new Set([cleanSelected, ...models].filter(Boolean))];
  if (!options.length) {
    return `<select id="debate${role}Model"><option value="">该 API 配置没有模型</option></select>`;
  }
  return `
    <select id="debate${role}Model">
      ${options.map(model => `<option value="${escapeHtml(model)}"${model === cleanSelected ? ' selected' : ''}>${escapeHtml(model)}</option>`).join('')}
    </select>`;
}

function debateProfileChanged(role) {
  const profileEl = document.getElementById(`debate${role}Profile`);
  const wrap = document.getElementById(`debate${role}ModelWrap`);
  if (!profileEl || !wrap) return;
  const models = _debateModelsForProfile(profileEl.value || '__current');
  wrap.innerHTML = _debateModelOptions(role, profileEl.value || '__current', models[0] || '');
}

function _debateCollectSettingsFromUi() {
  const getRole = role => _debateNormalizeRoleConfig({
    profileId: document.getElementById(`debate${role}Profile`)?.value || '__current',
    model: document.getElementById(`debate${role}Model`)?.value || '',
    systemPrompt: document.getElementById(`debate${role}SystemPrompt`)?.value || ''
  });
  return {
    topic: String(document.getElementById('debateTopicInput')?.value || '').trim(),
    totalRounds: _debateClampRounds(document.getElementById('debateTotalRounds')?.value),
    maxExchanges: _debateClampMaxExchanges(document.getElementById('debateMaxExchanges')?.value),
    answerThreshold: _debateClampThreshold(document.getElementById('debateAnswerThreshold')?.value),
    reviewTimeoutSec: _debateClampTimeoutSeconds(document.getElementById('debateReviewTimeout')?.value, 120),
    finalJudgeTimeoutSec: _debateClampTimeoutSeconds(document.getElementById('debateFinalJudgeTimeout')?.value, 300),
    pro: getRole('pro'),
    con: getRole('con'),
    judge: getRole('judge')
  };
}

function _debatePersistSettingsFromUi() {
  if (!document.getElementById('debateTopicInput')) return false;
  try {
    saveDebateSettings(_debateCollectSettingsFromUi());
    return true;
  } catch (e) {
    console.warn('[debate] settings autosave failed:', e);
    return false;
  }
}

function _debateTimeoutField(kind, label, value, sliderMax, hint) {
  const clean = _debateClampTimeoutSeconds(value, sliderMax);
  return `
    <label class="debate-field debate-timeout-field">${escapeHtml(label)}
      <div class="debate-timeout-control">
        <input type="range" id="debate${kind}TimeoutSlider" min="1" max="${sliderMax}" step="1" value="${_debateSliderTimeoutValue(clean, sliderMax)}" oninput="debateTimeoutSliderChanged('${kind}')">
        <input type="number" id="debate${kind}Timeout" min="1" step="1" value="${clean}" oninput="debateTimeoutInputChanged('${kind}')">
        <span>秒</span>
      </div>
      <span class="form-hint">${escapeHtml(hint)}</span>
    </label>`;
}

function _debateRoleField(role, title, cfg) {
  const normalized = _debateNormalizeRoleConfig(cfg);
  return `
    <div class="debate-role-card">
      <div class="debate-role-title">${escapeHtml(title)}</div>
      <label class="debate-field">API 配置
        <select id="debate${role}Profile" onchange="debateProfileChanged('${role}')">
          ${_debateProfileOptions(normalized.profileId)}
        </select>
      </label>
      <label class="debate-field">模型
        <span id="debate${role}ModelWrap">${_debateModelOptions(role, normalized.profileId, normalized.model)}</span>
      </label>
      <label class="debate-field">系统提示词
        <textarea id="debate${role}SystemPrompt" rows="6" class="debate-prompt-input" placeholder="自定义系统提示词，支持 {{topic}} {{task}} {{taskDesc}} 占位符">${escapeHtml(normalized.systemPrompt || '')}</textarea>
      </label>
    </div>`;
}

function openDebateMode() {
  _debateEnsureModal();
  renderDebateModeModal();
  document.getElementById('debateModeModal').classList.add('show');
}

function closeDebateMode() {
  _debatePersistSettingsFromUi();
  const modal = document.getElementById('debateModeModal');
  if (modal) modal.classList.remove('show');
}

function _debateEnsureModal() {
  if (document.getElementById('debateModeModal')) return;
  const modal = document.createElement('div');
  modal.id = 'debateModeModal';
  modal.className = 'modal-mask debate-mode-modal';
  modal.innerHTML = `
    <div class="modal wide">
      <h2>辩论模式 <button class="modal-close" onclick="closeDebateMode()">×</button></h2>
      <div id="debateModeContent"></div>
    </div>`;
  modal.addEventListener('click', e => {
    if (e.target === modal) closeDebateMode();
  });
  modal.addEventListener('input', e => {
    if (e.target && e.target.closest && e.target.closest('#debateModeContent')) _debatePersistSettingsFromUi();
  });
  modal.addEventListener('change', e => {
    if (e.target && e.target.closest && e.target.closest('#debateModeContent')) _debatePersistSettingsFromUi();
  });
  document.body.appendChild(modal);
}

function renderDebateModeModal() {
  const content = document.getElementById('debateModeContent');
  if (!content) return;
  const settings = loadDebateSettings();
  const debateChats = (state.chats || []).filter(c => c && c.debate && c.debate.type === 'debate_mode');
  const runningCount = Object.keys(DEBATE_RUNTIME).length;
  content.innerHTML = `
    <div class="debate-compose">
      <div class="form-group">
        <label>辩题</label>
        <textarea id="debateTopicInput" rows="4" placeholder="输入辩题，例如：人工智能的发展利大于弊">${escapeHtml(settings.topic || '')}</textarea>
      </div>
      <div class="debate-controls">
        <label class="debate-field">局数
          <input type="number" id="debateTotalRounds" min="3" max="99" step="1" value="${_debateClampRounds(settings.totalRounds)}">
        </label>
        <label class="debate-field">每局轮数上限
          <input type="number" id="debateMaxExchanges" min="2" max="99" step="1" value="${_debateClampMaxExchanges(settings.maxExchanges)}">
        </label>
        <label class="debate-field">人工审核阈值
          <input type="number" id="debateAnswerThreshold" min="1" max="99" step="1" value="${_debateClampThreshold(settings.answerThreshold)}">
        </label>
      </div>
      <div class="debate-timeout-grid">
        ${_debateTimeoutField('Review', '普通评审倒计时', settings.reviewTimeoutSec, DEBATE_REVIEW_TIMEOUT_SLIDER_MAX, '滑动条上限 120 秒，输入框可填写更大值。')}
        ${_debateTimeoutField('FinalJudge', '终审倒计时', settings.finalJudgeTimeoutSec, DEBATE_FINAL_JUDGE_TIMEOUT_SLIDER_MAX, '滑动条上限 300 秒，输入框可填写更大值。')}
      </div>
      <div class="debate-role-grid">
        ${_debateRoleField('pro', '正方辩手', settings.pro)}
        ${_debateRoleField('con', '反方辩手', settings.con)}
        ${_debateRoleField('judge', '评委', settings.judge)}
      </div>
      <div class="debate-actions">
        <button class="btn btn-primary" onclick="startDebateFromUi()">开始辩论</button>
        <button class="btn btn-warning" onclick="stopCurrentDebate()">停止当前辩论</button>
        <button class="btn" onclick="continueCurrentDebate()">继续当前辩论</button>
      </div>
    </div>
    <div class="debate-summary">
      <span>历史辩论 ${debateChats.length}</span>
      <span>运行中 ${runningCount}</span>
      <span>默认禁用工具和其它模式</span>
    </div>
    <div class="debate-history">
      ${debateChats.length ? debateChats.map(chat => {
        const meta = chat.debate || {};
        const score = meta.score || {};
        const running = isDebateRunning(chat.id);
        const canContinue = !running && ['idle', 'stopped', 'error'].includes(meta.status || 'idle');
        return `
          <div class="debate-history-card ${running ? 'running' : ''}">
            <div class="debate-history-head">
              <span class="debate-history-title">${escapeHtml(chat.title || '辩论')}</span>
              <span class="debate-status ${running ? 'running' : (meta.status || 'idle')}">${running ? '运行中' : _debateStatusText(meta.status)}</span>
            </div>
            <div class="debate-history-meta">
              <span>${_debateClampRounds(meta.totalRounds || 3)} 局</span>
              <span>正方 ${score.pro || 0}</span>
              <span>反方 ${score.con || 0}</span>
              <span>${new Date(meta.updatedAt || chat.createdAt || Date.now()).toLocaleString('zh-CN')}</span>
            </div>
            <div class="debate-history-actions">
              <button class="btn" onclick="openDebateChat('${escapeHtml(chat.id)}')">打开</button>
              <button class="btn btn-primary" ${canContinue ? '' : 'disabled'} onclick="continueDebate('${escapeHtml(chat.id)}')">继续</button>
              <button class="btn btn-warning" ${running ? '' : 'disabled'} onclick="requestStopDebate('${escapeHtml(chat.id)}')">停止</button>
            </div>
          </div>`;
      }).join('') : '<div class="debate-empty">还没有辩论。配置辩题和模型后点击开始辩论会自动创建新对话。</div>'}
    </div>`;
}

function _debateStatusText(status) {
  const map = {
    running: '运行中',
    waiting_manual: '待人工审核',
    completed: '已完成',
    stopped: '已停止',
    error: '失败',
    idle: '空闲'
  };
  return map[status] || status || '空闲';
}

function _debateValidateRole(role, cfg) {
  if (!cfg.model) return `${_debateRoleLabel(role)}模型不能为空`;
  const ps = _debateProfileSettings(cfg.profileId);
  if (!ps || !ps.apiKey) return `${_debateRoleLabel(role)}所选 API 配置没有 API Key`;
  if (!ps.baseUrl) return `${_debateRoleLabel(role)}所选 API 配置没有 Base URL`;
  return '';
}

async function startDebateFromUi() {
  const settings = _debateCollectSettingsFromUi();
  if (!settings.topic) {
    if (typeof toast === 'function') toast('请先填写辩题');
    return;
  }
  for (const role of ['pro', 'con', 'judge']) {
    const err = _debateValidateRole(role, settings[role]);
    if (err) {
      if (typeof toast === 'function') toast(err, 4000);
      return;
    }
  }
  if (settings.maxExchanges < settings.answerThreshold) {
    const ok = confirm(
      `每局轮数上限（${settings.maxExchanges}）小于人工审核阈值（${settings.answerThreshold}）。\n\n` +
      '这意味着本局会先达到轮数上限并进入终审裁决，人工审核阈值不会触发。\n\n仍然开始辩论吗？'
    );
    if (!ok) return;
  }
  saveDebateSettings(settings);
  const chat = _debateCreateChat(settings);
  closeDebateMode();
  if (typeof switchChat === 'function') switchChat(chat.id);
  startDebate(chat.id).catch(e => {
    console.error('[debate] start failed:', e);
    if (typeof toast === 'function') toast('辩论启动失败：' + (e.message || e), 5000);
  });
}

function _debateCreateChat(settings) {
  const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const now = Date.now();
  const topic = String(settings.topic || '').trim();
  const chat = {
    id,
    title: `辩论：${topic.slice(0, 24) || '新辩题'}`,
    messages: [],
    createdAt: now,
    debate: {
      type: 'debate_mode',
      id: _debateId('debate'),
      topic,
      totalRounds: _debateClampRounds(settings.totalRounds),
      maxExchanges: _debateClampMaxExchanges(settings.maxExchanges),
      answerThreshold: _debateClampThreshold(settings.answerThreshold),
      reviewTimeoutSec: _debateClampTimeoutSeconds(settings.reviewTimeoutSec, 120),
      finalJudgeTimeoutSec: _debateClampTimeoutSeconds(settings.finalJudgeTimeoutSec, 300),
      status: 'idle',
      currentRound: 1,
      score: { pro: 0, con: 0 },
      roles: {
        pro: _debateNormalizeRoleConfig({ ...settings.pro, _roleKey: 'pro' }),
        con: _debateNormalizeRoleConfig({ ...settings.con, _roleKey: 'con' }),
        judge: _debateNormalizeRoleConfig({ ...settings.judge, _roleKey: 'judge' })
      },
      rounds: [],
      createdAt: now,
      updatedAt: now
    }
  };
  state.chats.unshift(chat);
  state.currentId = id;
  saveData();
  if (typeof renderChatList === 'function') renderChatList();
  if (typeof renderMessages === 'function') renderMessages();
  return chat;
}

function _debateEnsureRound(meta, roundNo) {
  if (!Array.isArray(meta.rounds)) meta.rounds = [];
  let round = meta.rounds.find(r => r && r.index === roundNo);
  if (!round) {
    const opener = roundNo % 2 === 1 ? 'pro' : 'con';
    round = {
      index: roundNo,
      opener,
      status: 'running',
      answerCount: 0,
      startedAt: Date.now(),
      finishedAt: null,
      winner: ''
    };
    meta.rounds.push(round);
  }
  return round;
}

function _debateRenderRefresh(chat) {
  if (typeof isCurrentChat === 'function' && isCurrentChat(chat)) renderMessages();
  if (typeof renderChatList === 'function') renderChatList();
  if (typeof updateSendBtn === 'function') updateSendBtn();
  if (document.getElementById('debateModeModal')) renderDebateModeModal();
}

function isDebateRunning(chatId) {
  return !!(chatId && DEBATE_RUNTIME[chatId]);
}

function isAnyDebateRunning() {
  return Object.keys(DEBATE_RUNTIME).some(id => !!DEBATE_RUNTIME[id]);
}

function isDebateWaitingManual(chatId) {
  const chat = chatId ? chatById(chatId) : null;
  return !!(chat && chat.debate && chat.debate.type === 'debate_mode'
    && chat.debate.status === 'waiting_manual' && chat.debate.waitingManual);
}

function isDebateWaitingManualTimed(chatId) {
  const chat = chatId ? chatById(chatId) : null;
  return !!(chat && isDebateWaitingManual(chatId)
    && _debateManualWaitDurationForChat(chat, chat.debate.waitingManual.reason) > 0);
}

function isDebateCompressing(chatId) {
  const chat = chatId ? chatById(chatId) : null;
  return !!(chat && chat.debate && chat.debate.type === 'debate_mode'
    && chat.debate._compression && chat.debate._compression.running);
}

function isDebatePausable(chatId) {
  return isDebateRunning(chatId) || isDebateWaitingManualTimed(chatId);
}

function isAnyDebatePausable() {
  return isAnyDebateRunning()
    || (state && Array.isArray(state.chats) && state.chats.some(chat =>
      chat && chat.debate && chat.debate.type === 'debate_mode'
      && chat.debate.status === 'waiting_manual' && chat.debate.waitingManual
      && _debateManualWaitDurationForChat(chat, chat.debate.waitingManual.reason) > 0
    ));
}

function requestStopDebate(chatId) {
  const chat = chatId ? chatById(chatId) : null;
  const runtime = chatId ? DEBATE_RUNTIME[chatId] : null;
  if (!runtime) {
    if (chat && chat.debate && chat.debate.status === 'waiting_manual') {
      return _debatePauseWaitingManual(chat);
    }
    return false;
  }
  runtime.stopRequested = true;
  if (runtime.ctrl) {
    try { runtime.ctrl.abort(); } catch (e) {}
  }
  if (chat && chat.debate) {
    _debateClearFinalJudgeTimeout(chat);
    _debateClearManualPassTimeout(chat);
    chat.debate.status = 'stopped';
    chat.debate.updatedAt = Date.now();
    saveData();
    _debateRenderRefresh(chat);
  }
  if (typeof clearChatTask === 'function') clearChatTask(chatId);
  return true;
}

function stopCurrentDebate() {
  const chatId = state.currentId;
  if (!requestStopDebate(chatId)) {
    if (typeof toast === 'function') toast('当前没有正在运行的辩论');
  }
}

function continueCurrentDebate() {
  const chatId = state.currentId;
  if (!continueDebate(chatId) && typeof toast === 'function') {
    toast('当前没有可继续的辩论');
  }
}

function continueDebate(chatId) {
  const chat = chatId ? chatById(chatId) : null;
  if (!chat || !chat.debate || chat.debate.type !== 'debate_mode') return false;
  if (isDebateRunning(chat.id)) {
    if (typeof switchChat === 'function') switchChat(chat.id);
    return true;
  }
  if (chat.debate.status === 'completed') return false;
  if (chat.debate.waitingManual && (chat.debate.status === 'stopped' || chat.debate.waitingManual.paused)) {
    return _debateResumeWaitingManual(chat);
  }
  if (chat.debate.status === 'waiting_manual') {
    if (typeof switchChat === 'function') switchChat(chat.id);
    if (typeof toast === 'function') toast('该辩论正在等待人工审核，请使用评委卡片按钮');
    return true;
  }
  chat.debate.status = 'running';
  chat.debate.error = '';
  chat.debate.updatedAt = Date.now();
  saveData();
  if (typeof switchChat === 'function') switchChat(chat.id);
  startDebate(chat.id).catch(e => {
    console.error('[debate] continue failed:', e);
    if (typeof toast === 'function') toast('继续辩论失败：' + (e.message || e), 5000);
  });
  return true;
}

function _debateTimeoutMs(meta, key, fallbackSeconds) {
  const seconds = _debateClampTimeoutSeconds(meta && meta[key], fallbackSeconds);
  return seconds * 1000;
}

function _debateManualWaitDurationForChat(chat, reason) {
  const meta = chat && chat.debate;
  if (reason === 'threshold') return _debateTimeoutMs(meta, 'reviewTimeoutSec', 120);
  if (reason === 'max_exchanges') return _debateTimeoutMs(meta, 'finalJudgeTimeoutSec', 300);
  return 0;
}

function _debateManualWaitTimeoutAt(chat, reason) {
  if (!chat || !chat.debate) return 0;
  if (reason === 'threshold') return Number(chat.debate._manualPassTimeoutAt) || 0;
  if (reason === 'max_exchanges') return Number(chat.debate._finalJudgeTimeoutAt) || 0;
  return 0;
}

function _debateManualWaitRemainingMs(chat, waiting) {
  const reason = waiting && waiting.reason;
  const duration = _debateManualWaitDurationForChat(chat, reason);
  if (!duration) return 0;
  const timeoutAt = _debateManualWaitTimeoutAt(chat, reason);
  if (timeoutAt) return Math.max(1000, timeoutAt - Date.now());
  const stored = Number(waiting.remainingMs) || 0;
  if (stored > 0) return Math.max(1000, stored);
  const startedAt = Number(waiting.at) || Date.now();
  return Math.max(1000, startedAt + duration - Date.now());
}

function _debateArmManualWaitTimer(chat, waiting, remainingMs) {
  if (!chat || !chat.debate || !waiting) return;
  const reason = waiting.reason;
  const duration = _debateManualWaitDurationForChat(chat, reason);
  if (!duration) return;
  const remaining = Math.max(1000, Number(remainingMs) || _debateManualWaitRemainingMs(chat, waiting));
  waiting.at = Date.now() - Math.max(0, duration - remaining);
  delete waiting.remainingMs;
  delete waiting.paused;
  delete waiting.pausedAt;
  if (reason === 'threshold') {
    _debateClearManualPassTimeout(chat);
    chat.debate._manualPassTimeoutId = setTimeout(() => _debateManualPassTimeout(chat.id), remaining);
    chat.debate._manualPassTimeoutAt = Date.now() + remaining;
    _debateStartManualPassCountdown(chat);
  } else if (reason === 'max_exchanges') {
    _debateClearFinalJudgeTimeout(chat);
    chat.debate._finalJudgeTimeoutId = setTimeout(() => _debateFinalJudgeTimeout(chat.id), remaining);
    chat.debate._finalJudgeTimeoutAt = Date.now() + remaining;
    _debateStartFinalJudgeCountdown(chat);
  }
}

function _debatePauseWaitingManual(chat) {
  if (!chat || !chat.debate || chat.debate.status !== 'waiting_manual' || !chat.debate.waitingManual) return false;
  const waiting = chat.debate.waitingManual;
  const remaining = _debateManualWaitRemainingMs(chat, waiting);
  _debateClearFinalJudgeTimeout(chat);
  _debateClearManualPassTimeout(chat);
  waiting.paused = true;
  waiting.pausedAt = Date.now();
  if (_debateManualWaitDurationForChat(chat, waiting.reason)) waiting.remainingMs = remaining;
  chat.debate.status = 'stopped';
  chat.debate.error = 'paused';
  chat.debate.updatedAt = Date.now();
  if (typeof clearChatTask === 'function') clearChatTask(chat.id);
  saveData();
  _debateRenderRefresh(chat);
  if (typeof toast === 'function') toast('已暂停辩论审核倒计时');
  return true;
}

function _debatePauseManualWaitForCompression(chat) {
  if (!chat || !chat.debate || chat.debate.status !== 'waiting_manual' || !chat.debate.waitingManual) return null;
  const waiting = chat.debate.waitingManual;
  const reason = waiting.reason;
  const duration = _debateManualWaitDurationForChat(chat, reason);
  if (!duration) return null;
  const remainingMs = _debateManualWaitRemainingMs(chat, waiting);
  _debateClearFinalJudgeTimeout(chat);
  _debateClearManualPassTimeout(chat);
  waiting.remainingMs = remainingMs;
  waiting.pausedForCompression = true;
  waiting.pausedForCompressionAt = Date.now();
  chat.debate.updatedAt = Date.now();
  saveData();
  _debateRenderRefresh(chat);
  return { reason, remainingMs };
}

function _debateResumeManualWaitAfterCompression(chat, paused) {
  if (!paused || !chat || !chat.debate || chat.debate.status !== 'waiting_manual' || !chat.debate.waitingManual) return;
  const waiting = chat.debate.waitingManual;
  if (waiting.reason !== paused.reason) return;
  delete waiting.pausedForCompression;
  delete waiting.pausedForCompressionAt;
  _debateArmManualWaitTimer(chat, waiting, paused.remainingMs);
  chat.debate.updatedAt = Date.now();
  saveData();
  _debateRenderRefresh(chat);
}

function _debateResumeWaitingManual(chat) {
  if (!chat || !chat.debate || !chat.debate.waitingManual) return false;
  const waiting = chat.debate.waitingManual;
  const remaining = _debateManualWaitRemainingMs(chat, waiting);
  chat.debate.status = 'waiting_manual';
  chat.debate.error = '';
  chat.debate.updatedAt = Date.now();
  if (_debateManualWaitDurationForChat(chat, waiting.reason)) {
    _debateArmManualWaitTimer(chat, waiting, remaining);
  } else {
    delete waiting.remainingMs;
    delete waiting.paused;
    delete waiting.pausedAt;
  }
  saveData();
  if (typeof switchChat === 'function') switchChat(chat.id);
  _debateRenderRefresh(chat);
  if (typeof toast === 'function') toast('已恢复辩论人工审核');
  return true;
}

async function startDebate(chatId) {
  const chat = chatById(chatId);
  if (!chat || !chat.debate) return false;
  if (isDebateRunning(chat.id)) return false;

  const ctrl = new AbortController();
  const runtime = { chatId: chat.id, ctrl, stopRequested: false };
  DEBATE_RUNTIME[chat.id] = runtime;
  if (typeof beginChatTask === 'function') beginChatTask(chat.id, ctrl, { resetStop: true });
  if (typeof setChatTaskMode === 'function') setChatTaskMode(chat.id, 'debate');
  chat.debate.status = 'running';
  chat.debate.updatedAt = Date.now();
  saveData();
  _debateRenderRefresh(chat);

  try {
    await _debateRunLoop(chat, runtime);
  } catch (e) {
    const stopped = runtime.stopRequested || ctrl.signal.aborted || e.name === 'AbortError';
    if (chat.debate.status !== 'waiting_manual' && chat.debate.status !== 'completed') {
      chat.debate.status = stopped ? 'stopped' : 'error';
      chat.debate.error = stopped ? '已停止' : (e.message || String(e));
      chat.debate.updatedAt = Date.now();
    }
    if (!stopped) console.error('[debate] run failed:', e);
  } finally {
    if (chat.debate.status !== 'waiting_manual') {
      delete DEBATE_RUNTIME[chat.id];
      if (typeof clearChatTask === 'function') clearChatTask(chat.id);
    }
    saveData();
    _debateRenderRefresh(chat);
  }
  return true;
}

async function _debateRunLoop(chat, runtime) {
  const meta = chat.debate;
  while (!runtime.stopRequested && !runtime.ctrl.signal.aborted) {
    if (meta.status === 'waiting_manual' || meta.status === 'completed') return;
    const roundNo = _debateCurrentRound(meta.currentRound || 1);
    if (roundNo > _debateClampRounds(meta.totalRounds)) {
      _debateFinish(chat);
      return;
    }
    const round = _debateEnsureRound(meta, roundNo);
    _debateSyncRoundAnswerCount(chat, round);
    if (round.winner) {
      _debateAdvanceRound(chat);
      continue;
    }

    let speechMsg = _debateLastUnreviewedSpeech(chat, roundNo);
    if (!speechMsg && round.answerCount >= _debateClampMaxExchangesGet(chat)) {
      await _debateHandleMaxExchanges(chat, round, runtime);
      return;
    }
    if (!speechMsg) {
      const lastSpeech = _debateLastCompletedSpeech(chat, roundNo);
      const side = lastSpeech ? _debateOtherSide(lastSpeech.debate.side) : round.opener;
      const speechType = lastSpeech ? 'rebuttal' : 'opening';
      const compressResult = await autoCompressDebateCheck(chat, {
        signal: runtime.ctrl.signal,
        isStopped: () => runtime.stopRequested || runtime.ctrl.signal.aborted
      });
      if (compressResult === 'failed') {
        throw new Error('辩论自动压缩失败，已停止本轮请求');
      }
      speechMsg = _debateStartSpeech(chat, round, side, speechType);
      saveData();
      _debateRenderRefresh(chat);
      await _debateCallSpeakerStream(chat, round, side, speechType, speechMsg, runtime);
      _debateSyncRoundAnswerCount(chat, round);
      saveData();
      _debateRenderRefresh(chat);
    }

    const review = await _debateCallJudge(chat, round, speechMsg, runtime);
    _debateAddJudgeCard(chat, round, speechMsg, review);
    _debateSyncRoundAnswerCount(chat, round);
    saveData();
    _debateRenderRefresh(chat);

    // 检查是否达到每局轮数上限
    if (round.answerCount >= _debateClampMaxExchangesGet(chat)) {
      await _debateHandleMaxExchanges(chat, round, runtime);
      return;
    }

    const needsManual = !review.pass || round.answerCount >= _debateClampThreshold(meta.answerThreshold);
    if (needsManual) {
      _debatePauseForManual(chat, round, speechMsg, review, !review.pass ? 'judge_rejected' : 'threshold');
      return;
    }
  }
  const err = new Error('用户中断');
  err.name = 'AbortError';
  throw err;
}

function _debateLastSpeech(chat, roundNo) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.debate && msg.debate.round === roundNo && msg.debate.kind === 'speech') return msg;
  }
  return null;
}

function _debateLastCompletedSpeech(chat, roundNo) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || !msg.debate || msg.debate.round !== roundNo || msg.debate.kind !== 'speech') continue;
    if (msg.debate.completed !== false && !msg.debate.stopped) return msg;
  }
  return null;
}

function _debateHasJudgeForSpeech(chat, speechMsg) {
  const d = speechMsg && speechMsg.debate;
  if (!d) return false;
  return (chat.messages || []).some(msg => msg && msg.debate && msg.debate.kind === 'judge'
    && msg.debate.round === d.round
    && msg.debate.side === d.side
    && msg.debate.speechSeq === d.seq);
}

function _debateLastUnreviewedSpeech(chat, roundNo) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || !msg.debate || msg.debate.round !== roundNo || msg.debate.kind !== 'speech') continue;
    if (msg.debate.completed === false || msg.debate.stopped) continue;
    if (!_debateHasJudgeForSpeech(chat, msg)) return msg;
    return null;
  }
  return null;
}

function _debateCompletedSpeechCount(chat, roundNo) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : [];
  return messages.filter(msg => msg && msg.debate
    && msg.debate.kind === 'speech'
    && msg.debate.round === roundNo
    && msg.debate.completed !== false
    && !msg.debate.stopped
  ).length;
}

function _debateMaxSpeechSeq(chat, roundNo) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : [];
  let maxSeq = 0;
  for (const msg of messages) {
    if (!msg || !msg.debate || msg.debate.kind !== 'speech' || msg.debate.round !== roundNo) continue;
    const seq = parseInt(msg.debate.seq, 10);
    if (Number.isFinite(seq)) maxSeq = Math.max(maxSeq, seq);
  }
  return maxSeq;
}

function _debateSyncRoundAnswerCount(chat, round) {
  if (!chat || !round) return;
  round.answerCount = _debateCompletedSpeechCount(chat, round.index);
}

function _debateStartSpeech(chat, round, side, speechType) {
  const now = Date.now();
  const seq = _debateMaxSpeechSeq(chat, round.index) + 1;
  const msg = {
    role: side === 'pro' ? 'user' : 'assistant',
    content: '',
    debate: {
      kind: 'speech',
      side,
      speechType,
      round: round.index,
      seq,
      completed: false
    },
    _startTime: now,
    _firstTokenAt: null,
    _endTime: null
  };
  chat.messages.push(msg);
  chat.debate.updatedAt = now;
  return msg;
}

function _debateAddJudgeCard(chat, round, speechMsg, review) {
  const now = Date.now();
  chat.messages.push({
    role: 'assistant',
    content: review.reason || '',
    _debateJudge: true,
    debate: {
      kind: 'judge',
      side: speechMsg.debate.side,
      round: round.index,
      speechSeq: speechMsg.debate.seq,
      pass: !!review.pass,
      reason: review.reason || '',
      raw: review.raw || ''
    },
    _startTime: now,
    _firstTokenAt: now,
    _endTime: now
  });
  chat.debate.updatedAt = now;
}

function _debatePauseForManual(chat, round, speechMsg, review, reason) {
  const meta = chat.debate;
  _debateClearManualPassTimeout(chat);
  meta.status = 'waiting_manual';
  meta.waitingManual = {
    round: round.index,
    side: speechMsg.debate.side,
    speechSeq: speechMsg.debate.seq,
    reason,
    judgePass: !!review.pass,
    at: Date.now()
  };
  meta.updatedAt = Date.now();
  delete DEBATE_RUNTIME[chat.id];
  if (typeof clearChatTask === 'function') clearChatTask(chat.id);
  if (reason === 'threshold') {
    _debateArmManualWaitTimer(chat, meta.waitingManual);
  }
  saveData();
  _debateRenderRefresh(chat);
}

function debateManualPass(chatId) {
  const chat = chatById(chatId);
  if (!chat || !chat.debate || chat.debate.status !== 'waiting_manual') return;
  if (isDebateCompressing(chat.id)) {
    if (typeof toast === 'function') toast('辩论历史正在压缩，完成后再操作评委卡片', 3000);
    return;
  }
  _debateClearFinalJudgeTimeout(chat);
  _debateClearManualPassTimeout(chat);
  delete chat.debate.waitingManual;
  chat.debate.status = 'running';
  chat.debate.updatedAt = Date.now();
  saveData();
  _debateRenderRefresh(chat);
  startDebate(chat.id).catch(e => {
    console.error('[debate] manual continue failed:', e);
    if (typeof toast === 'function') toast('继续辩论失败：' + (e.message || e), 5000);
  });
}

function debateManualWin(chatId, side) {
  const chat = chatById(chatId);
  if (!chat || !chat.debate || chat.debate.status !== 'waiting_manual') return;
  if (isDebateCompressing(chat.id)) {
    if (typeof toast === 'function') toast('辩论历史正在压缩，完成后再操作评委卡片', 3000);
    return;
  }
  _debateClearFinalJudgeTimeout(chat);
  _debateClearManualPassTimeout(chat);
  const waiting = chat.debate.waitingManual || {};
  const round = _debateEnsureRound(chat.debate, waiting.round || chat.debate.currentRound || 1);
  _debateSetRoundWinner(chat, round, side, 'manual');
  delete chat.debate.waitingManual;
  _debateAdvanceRound(chat);
  saveData();
  _debateRenderRefresh(chat);
  if (chat.debate.status !== 'completed') {
    startDebate(chat.id).catch(e => {
      console.error('[debate] manual win continue failed:', e);
      if (typeof toast === 'function') toast('继续辩论失败：' + (e.message || e), 5000);
    });
  }
}

function _debateSetRoundWinner(chat, round, side, source) {
  if (!side || (side !== 'pro' && side !== 'con') || round.winner) return;
  round.winner = side;
  round.status = 'done';
  round.finishedAt = Date.now();
  round.winSource = source || 'judge';
  if (!chat.debate.score) chat.debate.score = { pro: 0, con: 0 };
  chat.debate.score[side] = (chat.debate.score[side] || 0) + 1;
  chat.debate.updatedAt = Date.now();
}

function _debateAdvanceRound(chat) {
  const meta = chat.debate;
  const total = _debateClampRounds(meta.totalRounds);
  const nextRound = (meta.currentRound || 1) + 1;
  if (nextRound > total) {
    _debateFinish(chat);
  } else {
    meta.currentRound = nextRound;
    meta.status = 'running';
    meta.updatedAt = Date.now();
  }
}

function _debateFinish(chat) {
  const meta = chat.debate;
  if (meta.status === 'completed') return;
  meta.status = 'completed';
  meta.completedAt = Date.now();
  meta.updatedAt = meta.completedAt;
  delete meta.waitingManual;
  const score = meta.score || { pro: 0, con: 0 };
  const finalWinner = score.pro === score.con ? 'draw' : (score.pro > score.con ? 'pro' : 'con');
  meta.finalWinner = finalWinner;
  chat.messages.push({
    role: 'assistant',
    content: _debateSummaryText(meta),
    _debateSummary: true,
    debate: { kind: 'summary' }
  });
}

function _debateSummaryText(meta) {
  const score = meta.score || { pro: 0, con: 0 };
  const winner = meta.finalWinner === 'draw' ? '平局' : `${_debateSideName(meta.finalWinner)}胜利`;
  const roundLines = (meta.rounds || [])
    .sort((a, b) => a.index - b.index)
    .map(r => `- 第 ${r.index} 局：${r.winner ? _debateSideName(r.winner) + '胜利' : '未决'}（先立论：${_debateSideName(r.opener)}）`)
    .join('\n');
  return `最终结果：${winner}\n\n比分：正方 ${score.pro || 0} : ${score.con || 0} 反方\n\n${roundLines}`;
}

function _debateRoundTranscriptLines(chat, roundNo) {
  const lines = [];
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  for (const msg of messages) {
    if (!msg || !msg.debate) continue;
    if (msg.debate.round !== roundNo) continue;
    if (msg.debate.kind === 'speech') {
      if (msg.debate.completed === false || msg.debate.stopped) continue;
      const type = msg.debate.speechType === 'opening' ? '立论' : '反驳';
      lines.push(`第${msg.debate.round}局 ${_debateSideName(msg.debate.side)}${type}：\n${msg.content || ''}`);
    } else if (msg.debate.kind === 'judge') {
      if (msg._debateFinalJudge || msg.debate.finalJudgePick) {
        const pick = msg.debate.finalJudgePick;
        const winnerReason = msg.debate.winnerReason || '';
        const loserReason = msg.debate.loserReason || '';
        lines.push(`第${msg.debate.round}局 终审裁决（${_debateSideName(pick)}胜利）：\n胜方理由：${winnerReason}\n败方理由：${loserReason}`);
      } else {
        lines.push(`第${msg.debate.round}局 评委审核（${msg.debate.pass ? '通过' : '不通过'}）：\n${msg.debate.reason || msg.content || ''}`);
      }
    }
  }
  return lines;
}

function _debateRoundMessageCount(chat, roundNo) {
  return _debateRoundTranscriptLines(chat, roundNo).length;
}

function _debateRoundSummaryFresh(chat, round) {
  if (!round || !round.summary) return false;
  return Number(round.summaryMessageCount || 0) === _debateRoundMessageCount(chat, round.index);
}

function _debateAllRoundNumbers(chat) {
  const nums = new Set();
  const meta = chat && chat.debate ? chat.debate : {};
  for (const r of meta.rounds || []) {
    const n = parseInt(r && r.index, 10);
    if (Number.isFinite(n) && n > 0) nums.add(n);
  }
  for (const msg of chat.messages || []) {
    const n = parseInt(msg && msg.debate && msg.debate.round, 10);
    if (Number.isFinite(n) && n > 0) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

function _debateTranscript(chat, roundNo = null) {
  const meta = chat.debate || {};
  const lines = [`辩题：${meta.topic}`];
  if (roundNo) {
    lines.push(..._debateRoundTranscriptLines(chat, roundNo));
    return lines.join('\n\n');
  }
  const currentRound = _debateCurrentRound(meta.currentRound || 1);
  const roundNumbers = _debateAllRoundNumbers(chat);
  for (const n of roundNumbers) {
    const round = (meta.rounds || []).find(r => r && r.index === n) || null;
    if (n < currentRound && _debateRoundSummaryFresh(chat, round)) {
      const winner = round.winner ? `；本局结果：${_debateSideName(round.winner)}胜利` : '';
      lines.push(`第${n}局摘要${winner}：\n${round.summary}`);
    } else {
      lines.push(..._debateRoundTranscriptLines(chat, n));
    }
  }
  return lines.join('\n\n');
}

function _debateCompressibleRounds(chat) {
  const meta = chat && chat.debate ? chat.debate : null;
  if (!meta) return [];
  const currentRound = _debateCurrentRound(meta.currentRound || 1);
  return _debateAllRoundNumbers(chat)
    .filter(n => n > 0 && n < currentRound && _debateRoundMessageCount(chat, n) > 0)
    .map(n => _debateEnsureRound(meta, n))
    .sort((a, b) => a.index - b.index);
}

function _debateStaleCompressibleRounds(chat) {
  return _debateCompressibleRounds(chat).filter(round => !_debateRoundSummaryFresh(chat, round));
}

function _debateCheckStopped(options = {}) {
  if ((options.signal && options.signal.aborted) || (typeof options.isStopped === 'function' && options.isStopped())) {
    const err = new Error('用户中断');
    err.name = 'AbortError';
    throw err;
  }
}

function _debateContextLimit(chat) {
  const meta = chat && chat.debate ? chat.debate : {};
  const models = ['pro', 'con']
    .map(role => meta.roles && meta.roles[role] && meta.roles[role].model)
    .filter(Boolean);
  const limits = models.map(model => typeof getContextLimit === 'function' ? getContextLimit(model) : 200000);
  return Math.min(...(limits.length ? limits : [typeof getContextLimit === 'function' ? getContextLimit(state.settings.currentModel) : 200000]));
}

function _debateEstimateSpeakerContextTokens(chat) {
  if (!chat || !chat.debate) return 0;
  const meta = chat.debate;
  const transcript = _debateTranscript(chat);
  let maxTokens = estimateTokens(transcript);
  for (const side of ['pro', 'con']) {
    const role = meta.roles && meta.roles[side];
    const prompt = _debateResolvePrompt(role && role.systemPrompt, {
      topic: meta.topic,
      sideName: _debateSideName(side),
      task: '发言',
      taskDesc: '根据辩论进程进行立论或反驳'
    });
    maxTokens = Math.max(maxTokens, estimateTokens(transcript) + estimateTokens(prompt || ''));
  }
  return maxTokens + 800;
}

async function _debateCompressRound(chat, round, options = {}) {
  const meta = chat.debate;
  const transcript = _debateTranscript(chat, round.index);
  const clippedTranscript = typeof middleTrimText === 'function'
    ? middleTrimText(transcript, 70000)
    : transcript;
  const systemPrompt = [
    '你是辩论赛单局历史压缩器。',
    '你只总结指定的一局辩论，不要混入其它局。',
    '摘要要保留正反方核心论点、关键反驳、承认无法反驳/认输、评委审核、终审裁决和胜负理由。',
    '输出简洁但足够让后续辩手理解这一局发生了什么。'
  ].join('\n');
  const prompt = [
    `辩题：${meta.topic}`,
    `请只压缩第 ${round.index} 局的辩论上下文。`,
    '输出建议结构：',
    '## 本局进程',
    '## 正方核心观点',
    '## 反方核心观点',
    '## 关键交锋',
    '## 评委/终审结果',
    '## 后续辩论应记住的信息',
    '---',
    clippedTranscript
  ].join('\n\n');
  const role = (meta.roles && meta.roles.judge) || (meta.roles && meta.roles.pro) || {};
  const summary = await _debateCallWithRoleConfig(role, [{ role: 'user', content: prompt }], systemPrompt, {
    chat,
    chatId: chat.id,
    signal: options.signal,
    isStopped: options.isStopped,
    sourceLabel: `辩论模式 · 第${round.index}局压缩`
  });
  const text = String(summary || '').trim();
  if (!text) throw new Error(`第 ${round.index} 局压缩返回空摘要`);
  round.summary = text;
  round.summaryCompressedAt = Date.now();
  round.summaryMessageCount = _debateRoundMessageCount(chat, round.index);
  round.summaryReason = options.reason || 'manual';
  chat.debate.updatedAt = Date.now();
  return true;
}

async function compressDebateChat(chat, options = {}) {
  if (!chat || !chat.debate || chat.debate.type !== 'debate_mode') return false;
  if (isDebateCompressing(chat.id)) {
    if (options.reason === 'manual' && typeof toast === 'function') toast('辩论历史正在压缩，请稍等', 3000);
    return false;
  }
  const rounds = _debateStaleCompressibleRounds(chat);
  if (!rounds.length) {
    if (options.reason === 'manual' && typeof toast === 'function') toast('当前没有可压缩的已完成旧局');
    return false;
  }

  const shouldTouchGlobalGenerating = options.touchGlobalGenerating === true;
  const foregroundCtrl = shouldTouchGlobalGenerating && !options.signal ? new AbortController() : null;
  let foregroundTaskCreated = false;
  const signal = options.signal || (foregroundCtrl ? foregroundCtrl.signal : undefined);
  const taskOptions = {
    ...options,
    signal,
    isStopped: options.isStopped || (shouldTouchGlobalGenerating ? () => !!state.stopRequested : undefined)
  };
  const pausedManualWait = _debatePauseManualWaitForCompression(chat);
  chat.debate._compression = {
    running: true,
    reason: options.reason || 'manual',
    startedAt: Date.now()
  };
  chat.debate.updatedAt = Date.now();

  try {
    if (shouldTouchGlobalGenerating) {
      state.stopRequested = false;
      if (foregroundCtrl && typeof beginChatTask === 'function') {
        beginChatTask(chat.id, foregroundCtrl, { resetStop: true });
        foregroundTaskCreated = true;
        if (typeof setChatTaskMode === 'function') setChatTaskMode(chat.id, 'debate_compress');
      } else {
        state.isGenerating = true;
        if (foregroundCtrl) state.abortCtrl = foregroundCtrl;
      }
      if (typeof updateSendBtn === 'function') updateSendBtn();
    }

    let compressed = 0;
    for (const round of rounds) {
      _debateCheckStopped(taskOptions);
      await _debateCompressRound(chat, round, taskOptions);
      compressed += 1;
      saveData();
      _debateRenderRefresh(chat);
    }
    if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
    if (typeof toast === 'function') {
      toast(`✓ 已逐局压缩 ${compressed} 局辩论历史`, 3000);
    }
    return compressed > 0;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      if (typeof toast === 'function' && options.reason === 'manual') toast('已停止辩论压缩', 2000);
      throw e;
    }
    console.error('[debate] compression failed:', e);
    if (typeof toast === 'function') toast('辩论压缩失败：' + (e.message || e), 4000);
    return false;
  } finally {
    if (chat && chat.debate) {
      delete chat.debate._compression;
      chat.debate.updatedAt = Date.now();
      saveData();
    }
    if (shouldTouchGlobalGenerating) {
      if (foregroundTaskCreated && typeof clearChatTask === 'function') {
        clearChatTask(chat.id);
      } else {
        state.isGenerating = false;
        state.abortCtrl = null;
        state.stopRequested = false;
      }
      if (typeof updateSendBtn === 'function') updateSendBtn();
    }
    _debateResumeManualWaitAfterCompression(chat, pausedManualWait);
  }
}

async function manualCompressDebate(chat) {
  if (!chat || !chat.debate || chat.debate.type !== 'debate_mode') return false;
  if (isDebateCompressing(chat.id)) {
    if (typeof toast === 'function') toast('辩论历史正在压缩，请稍等', 3000);
    return false;
  }
  const roleErr = _debateValidateRole('judge', _debateNormalizeRoleConfig((chat.debate.roles && chat.debate.roles.judge) || {}));
  if (roleErr) {
    if (typeof toast === 'function') toast(roleErr, 4000);
    return false;
  }
  const rounds = _debateStaleCompressibleRounds(chat);
  if (!rounds.length) {
    if (typeof toast === 'function') toast('当前没有可压缩的已完成旧局');
    return false;
  }
  const ok = confirm(
    `确定要压缩辩论历史吗？\n\n` +
    `将逐局压缩当前局之前的 ${rounds.length} 局；不同局不会混在一起压缩，当前局不会参与压缩。`
  );
  if (!ok) return false;
  try {
    return await compressDebateChat(chat, { reason: 'manual', touchGlobalGenerating: true });
  } catch (e) {
    if (e && e.name !== 'AbortError') throw e;
    return false;
  }
}

async function autoCompressDebateCheck(chat, options = {}) {
  if (!state.settings.compressAutoEnabled) return false;
  if (!chat || !chat.debate || chat.debate.type !== 'debate_mode') return false;
  if (isDebateCompressing(chat.id)) return false;
  const limit = _debateContextLimit(chat);
  const tokens = _debateEstimateSpeakerContextTokens(chat);
  const pct = tokens / limit * 100;
  const threshold = state.settings.compressAutoThreshold || 75;
  const maxOutput = Math.max(0, parseInt(state.settings.maxTokens) || 0);
  const safetyBuffer = Math.max(1024, Math.min(8192, Math.round(limit * 0.03)));
  const reserve = maxOutput + safetyBuffer;
  const remaining = limit - tokens;
  if (pct < threshold && remaining >= reserve) return false;

  const rounds = _debateStaleCompressibleRounds(chat);
  if (!rounds.length) {
    if (typeof toast === 'function') toast('辩论上下文接近上限，但没有可压缩的已完成旧局（当前局不会压缩）', 4000);
    return false;
  }
  if (typeof toast === 'function') {
    const reason = pct >= threshold ? `辩论上下文已达 ${Math.round(pct)}%` : `辩论剩余上下文不足 ${formatNumber(reserve)} token`;
    toast(`📦 ${reason}，正在按局压缩旧局...`, 3000);
  }
  const ok = await compressDebateChat(chat, {
    reason: 'auto',
    signal: options.signal,
    isStopped: options.isStopped
  });
  return ok ? true : 'failed';
}

// ⭐ 占位符替换：{{key}} → 对应值，用于用户自定义提示词
function _debateResolvePrompt(template, vars) {
  if (!template || typeof template !== 'string') return '';
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), String(value ?? ''));
  }
  return result.trim();
}

function _debateRefreshMessage(chat, msg, forceSave = false) {
  if (!chat || !msg) return;
  const idx = chat.messages.indexOf(msg);
  // ⭐ 如果消息已结束且不是 forceSave → 静默跳过（避免无效 DOM 操作）
  if (msg._endTime && !forceSave) return;
  // ⭐ 非当前对话 → 全量渲染（用户切走了）
  if (!isCurrentChat(chat)) {
    _debateRenderRefresh(chat);
    return;
  }
  // ⭐ forceSave 表示流式已结束：完整替换节点（清光标 + 跑 KaTeX），跟 refreshMsgNode 行为一致
  if (forceSave && typeof refreshMsgNode === 'function') {
    refreshMsgNode(idx, chat);
    return;
  }
  // ⭐ 当前对话流式刷新：只改 .msg-content 的 innerHTML（与 _flushLastMsg 一致），不重建整条消息
  const wrap = document.querySelector(`.message[data-idx="${idx}"] .msg-content`);
  if (wrap) {
    const shouldFollow = (typeof isNearBottom !== 'function' || isNearBottom());
    const renderFn = (typeof renderMarkdownStreaming === 'function')
      ? renderMarkdownStreaming
      : renderMarkdown;
    wrap.innerHTML = renderFn(msg.content || '') + '<span class="cursor"></span>';
    const msgNode = wrap.closest('.message');
    if (msgNode) postRender(msgNode, { skipMath: true });
    if (shouldFollow && typeof scrollBottom === 'function') scrollBottom();
  } else {
    // 节点还不存在（消息刚 push），全量渲染
    _debateRenderRefresh(chat);
  }
}

async function _debateCallSpeakerStream(chat, round, side, speechType, speechMsg, runtime) {
  const meta = chat.debate;
  const role = meta.roles[side];
  const isOpening = speechType === 'opening';
  const task = isOpening ? '立论' : '反驳';
  const taskDesc = isOpening
    ? '提出清晰论点和关键理由'
    : '直接回应上一位辩手：指出漏洞并给出自己的反驳';
  // ⭐ 使用用户自定义提示词，支持 {{topic}} {{task}} {{taskDesc}} 占位符
  const systemPrompt = _debateResolvePrompt(role.systemPrompt, {
    topic: meta.topic,
    sideName: _debateSideName(side),
    task,
    taskDesc
  }) || [
    `你是辩论赛中的${_debateSideName(side)}辩手。`,
    `辩题：${meta.topic}`,
    `你必须坚持${_debateSideName(side)}立场。`,
    '默认不使用工具，不要提及工具、计划模式、大纲模式或系统实现。',
    isOpening
      ? '本次你负责本局立论：提出清晰论点和关键理由。'
      : '本次你负责反驳上一位辩手：直接回应对方最近观点，指出漏洞并给出自己的反驳。',
    '如果你确实无法反驳，可以明确承认无法反驳或主动认输，不要强行狡辩。',
    '输出只写你的辩论发言，不要附加 JSON、评审、分数或角色说明。'
  ].join('\n');
  const prompt = [
    `当前是第 ${round.index}/${meta.totalRounds} 局，先立论方是${_debateSideName(round.opener)}。`,
    `你现在代表${_debateSideName(side)}进行${isOpening ? '立论' : '反驳'}。`,
    '共享上下文如下：',
    _debateTranscript(chat)
  ].join('\n\n');

  let renderTimer = null;
  let lastRenderAt = 0;
  const flush = (force = false) => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    lastRenderAt = Date.now();
    _debateRefreshMessage(chat, speechMsg, force);
  };
  const scheduleFlush = () => {
    const now = Date.now();
    if (now - lastRenderAt >= 80) {
      flush(false);
      return;
    }
    if (!renderTimer) renderTimer = setTimeout(() => flush(false), 80);
  };

  try {
    const result = await _debateRunAgentWithRoleConfig(role, {
      initialMessages: [{ role: 'user', content: prompt }],
      systemPrompt,
      maxRounds: 0,
      signal: runtime.ctrl.signal,
      useTools: false,
      stream: true,
      chatId: chat.id,
      chat,
      isStopped: () => runtime.stopRequested || runtime.ctrl.signal.aborted,
      onProgress: ev => {
        if (!ev || runtime.stopRequested) return;
        if (ev.type === 'text_delta' && ev.text) {
          if (!speechMsg._firstTokenAt) speechMsg._firstTokenAt = Date.now();
          speechMsg.content += ev.text;
          chat.debate.updatedAt = Date.now();
          scheduleFlush();
        }
      },
      sourceLabel: `辩论模式 · ${_debateSideName(side)}`
    });
    const finalText = String((result && result.finalText) || speechMsg.content || '').trim();
    speechMsg.content = finalText || speechMsg.content || '（无发言）';
    speechMsg.debate.completed = true;
    delete speechMsg.debate.stopped;
    speechMsg._firstTokenAt = speechMsg._firstTokenAt || Date.now();
    speechMsg._endTime = Date.now();
    chat.debate.updatedAt = speechMsg._endTime;
    flush(true);
    return speechMsg.content;
  } catch (e) {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    const stopped = runtime.stopRequested || runtime.ctrl.signal.aborted || e.name === 'AbortError';
    if (stopped) {
      speechMsg.debate.completed = false;
      speechMsg.debate.stopped = true;
      if (!String(speechMsg.content || '').trim()) speechMsg.content = '（已停止，尚未完成发言）';
      speechMsg._endTime = Date.now();
      chat.debate.updatedAt = speechMsg._endTime;
      _debateRefreshMessage(chat, speechMsg, true);
    }
    throw e;
  }
}

async function _debateCallJudge(chat, round, speechMsg, runtime) {
  const meta = chat.debate;
  const role = meta.roles.judge;
  const side = speechMsg.debate.side;
  // ⭐ 使用用户自定义提示词，支持 {{topic}} {{sideName}} {{speechType}} {{speechContent}} 占位符
  const systemPrompt = _debateResolvePrompt(role.systemPrompt, {
    topic: meta.topic,
    sideName: _debateSideName(side),
    speechType: speechMsg.debate.speechType === 'opening' ? '立论' : '反驳',
    speechContent: speechMsg.content || ''
  }) || [
    '你是辩论赛评委，只负责审核当前发言是否可以通过。',
    '审核标准要宽松：只要发言整体合理、回应了任务，即使有瑕疵也通过。',
    '不需要打分。',
    '如果当前发言明显无关、没有完成立论/反驳、反驳没有道理、无法回应对方，或主动认输，则不通过。',
    '只输出 JSON，格式为 {"pass":true|false,"reason":"简短说明"}。'
  ].join('\n');
  const speechType = speechMsg.debate.speechType === 'opening' ? '立论' : '反驳';
  const prompt = [
    `辩题：${meta.topic}`,
    `当前第 ${round.index}/${meta.totalRounds} 局。`,
    `当前发言方：${_debateSideName(side)}。`,
    `当前发言类型：${speechType}。`,
    `当前发言：\n${speechMsg.content || ''}`,
    '共享上下文如下：',
    _debateTranscript(chat, round.index),
    '请审核当前发言是否通过。'
  ].join('\n\n');
  const raw = await _debateCallWithRoleConfig(role, [{ role: 'user', content: prompt }], systemPrompt, {
    chat,
    chatId: chat.id,
    signal: runtime.ctrl.signal,
    isStopped: () => runtime.stopRequested || runtime.ctrl.signal.aborted,
    sourceLabel: '辩论模式 · 评委'
  });
  return _debateParseJudge(raw);
}

async function _debateCallWithRoleConfig(roleConfig, history, rolePrompt, options = {}) {
  const cfg = _debateNormalizeRoleConfig(roleConfig);
  if (!cfg.model) throw new Error('辩论角色模型不能为空');
  const originalSettings = JSON.parse(JSON.stringify(state.settings || {}));
  const profileSettings = _debateProfileSettings(cfg.profileId);
  const keys = (typeof PROFILE_SETTINGS_KEYS !== 'undefined' && Array.isArray(PROFILE_SETTINGS_KEYS))
    ? PROFILE_SETTINGS_KEYS
    : ['provider', 'baseUrl', 'apiPath', 'apiFormat', 'apiKey', 'modelName', 'currentModel', 'temperature', 'maxTokens', 'useLocalProxy', 'systemPrompt', 'useCustomJson', 'jsonTemplate', 'jsonHeaders'];
  try {
    for (const k of keys) {
      if (profileSettings[k] !== undefined) state.settings[k] = profileSettings[k];
    }
    state.settings.currentModel = cfg.model;
    return await callOnceWithRole(history, cfg.model, rolePrompt, {
      ...options,
      useGlobalAbortFallback: false
    });
  } finally {
    state.settings = { ...state.settings, ...originalSettings };
  }
}

// ⭐ 流式版本的辩论角色调用 —— 支持 onProgress 回调实时输出
async function _debateRunAgentWithRoleConfig(roleConfig, options = {}) {
  const cfg = _debateNormalizeRoleConfig(roleConfig);
  if (!cfg.model) throw new Error('辩论角色模型不能为空');
  const originalSettings = JSON.parse(JSON.stringify(state.settings || {}));
  const profileSettings = _debateProfileSettings(cfg.profileId);
  const keys = (typeof PROFILE_SETTINGS_KEYS !== 'undefined' && Array.isArray(PROFILE_SETTINGS_KEYS))
    ? PROFILE_SETTINGS_KEYS
    : ['provider', 'baseUrl', 'apiPath', 'apiFormat', 'apiKey', 'modelName', 'currentModel', 'temperature', 'maxTokens', 'useLocalProxy', 'systemPrompt', 'useCustomJson', 'jsonTemplate', 'jsonHeaders'];

  try {
    for (const k of keys) {
      if (profileSettings[k] !== undefined) state.settings[k] = profileSettings[k];
    }
    state.settings.currentModel = cfg.model;

    const s = state.settings;
    const stream = options.stream !== undefined ? !!options.stream : true;
    const signal = options.signal || null;
    const isStopped = options.isStopped || (() => false);
    const onProgress = options.onProgress || (() => {});
    const initialMessages = options.initialMessages || [];
    const systemPrompt = options.systemPrompt || '';

    // 构造初始消息列表
    const messages = [];
    if (systemPrompt && s.apiFormat !== 'anthropic') {
      messages.push({ role: 'system', content: systemPrompt });
    }
    for (const m of initialMessages) {
      if (m.role !== 'system') messages.push(m);
    }

    // 构造请求体
    const apiMessages = s.apiFormat === 'anthropic'
      ? (typeof buildAnthropicMessages === 'function' ? buildAnthropicMessages(messages) : messages)
      : (s.apiFormat === 'responses' ? (typeof buildOpenAIResponsesInput === 'function' ? buildOpenAIResponsesInput(messages) : messages) : (typeof buildOpenAIMessages === 'function' ? buildOpenAIMessages(messages) : messages));

    let body;
    if (s.apiFormat === 'anthropic') {
      body = {
        model: cfg.model,
        messages: apiMessages,
        max_tokens: parseInt(s.maxTokens) || 4096,
        temperature: parseFloat(s.temperature) || 0.7,
        stream
      };
      if (systemPrompt) body.system = systemPrompt;
    } else if (s.apiFormat === 'responses') {
      body = {
        model: cfg.model,
        input: apiMessages,
        max_output_tokens: parseInt(s.maxTokens) || 4096,
        temperature: parseFloat(s.temperature) || 0.7,
        stream
      };
      if (systemPrompt) body.instructions = systemPrompt;
    } else {
      const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];
      for (const m of apiMessages) {
        if (m.role !== 'system') msgs.push(m);
      }
      body = {
        model: cfg.model,
        messages: msgs,
        max_tokens: parseInt(s.maxTokens) || 4096,
        temperature: parseFloat(s.temperature) || 0.7,
        stream
      };
      if (stream) body.stream_options = { include_usage: true };
    }

    // 构造 URL 和 headers
    const url = typeof buildFullUrl === 'function'
      ? buildFullUrl(s.baseUrl, s.apiPath)
      : (s.baseUrl.replace(/\/+$/, '') + (s.apiPath || '/chat/completions'));
    const headers = typeof buildHeaders === 'function' ? buildHeaders() : {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (s.apiKey || '')
    };

    // 检查中止条件
    if (isStopped() || (signal && signal.aborted)) {
      const err = new Error('用户中断');
      err.name = 'AbortError';
      throw err;
    }

    // 限速检查
    if (typeof applyRateLimit === 'function') {
      await applyRateLimit(signal);
    }

    // 发送请求
    const fetchFn = typeof _apiFetchWithTimeout === 'function' ? _apiFetchWithTimeout : fetch;
    const API_FETCH_TIMEOUT_MS = 5 * 60 * 1000;
    const resp = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }, signal, API_FETCH_TIMEOUT_MS);

    if (typeof recordRequest === 'function') recordRequest();

    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${t.slice(0, 500)}`);
    }

    const ct = resp.headers.get('content-type') || '';
    const ctLower = ct.toLowerCase();
    const looksLikeStream = ctLower.includes('event-stream')
      || ctLower.includes('stream+json')
      || (stream && !ctLower.includes('json') && !ctLower.includes('html'));

    let finalText = '';
    let usage = null;

    if (stream && looksLikeStream && resp.body && typeof resp.body.getReader === 'function') {
      // === 流式解析 ===
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        if (isStopped() || (signal && signal.aborted)) {
          try { reader.cancel(); } catch (_) {}
          const err = new Error('用户中断');
          err.name = 'AbortError';
          throw err;
        }
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t || !t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            if (s.apiFormat === 'anthropic') {
              if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
                const delta = j.delta.text || '';
                finalText += delta;
                onProgress({ type: 'text_delta', text: delta });
              }
              if (j.type === 'message_start' && j.message?.usage) {
                usage = { ...(usage || {}), ...j.message.usage };
              }
              if (j.type === 'message_delta' && j.usage) {
                usage = { ...(usage || {}), ...j.usage };
              }
            } else if (s.apiFormat === 'responses') {
              if (j.type === 'response.output_text.delta') {
                const delta = j.delta || '';
                finalText += delta;
                onProgress({ type: 'text_delta', text: delta });
              }
              if (j.type === 'response.completed' && j.response) {
                const normalized = typeof normalizeResponsesUsage === 'function'
                  ? normalizeResponsesUsage(j.response.usage)
                  : j.response.usage;
                usage = normalized || usage;
                if (!finalText && typeof extractResponsesText === 'function') {
                  finalText = extractResponsesText(j.response) || '';
                  if (finalText) onProgress({ type: 'text_delta', text: finalText });
                }
              }
            } else {
              const delta = j.choices?.[0]?.delta;
              if (delta && delta.content) {
                finalText += delta.content;
                onProgress({ type: 'text_delta', text: delta.content });
              }
              if (j.usage) usage = j.usage;
            }
          } catch (e) {}
        }
      }
    } else {
      // === 非流式解析 ===
      const txt = await resp.text();
      let j;
      try { j = JSON.parse(txt); } catch (e) { throw new Error('JSON 解析失败：' + txt.slice(0, 200)); }
      if (j.error) throw new Error(`API 错误：${j.error.message || JSON.stringify(j.error)}`);

      if (s.apiFormat === 'anthropic') {
        finalText = (j.content || []).filter(p => p.type === 'text').map(p => p.text).join('');
        usage = j.usage || null;
      } else if (s.apiFormat === 'responses') {
        finalText = typeof extractResponsesText === 'function' ? extractResponsesText(j) : '';
        usage = typeof normalizeResponsesUsage === 'function' ? normalizeResponsesUsage(j.usage) : j.usage;
      } else {
        finalText = j.choices?.[0]?.message?.content || '';
        usage = j.usage || null;
      }
      onProgress({ type: 'text_delta', text: finalText });
    }

    // 记录 usage
    if (usage && typeof recordUsageFromResponse === 'function') {
      const chat = options.chat || null;
      if (chat) recordUsageFromResponse(chat, usage, { model: cfg.model });
    }

    return { finalText, messages };
  } finally {
    state.settings = { ...state.settings, ...originalSettings };
  }
}

function _debateParseJudge(raw) {
  const text = String(raw || '').trim();
  let obj = null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    obj = JSON.parse(candidate);
  } catch (e) {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (match) {
      try { obj = JSON.parse(match[0]); } catch (_) {}
    }
  }
  if (obj && typeof obj === 'object') {
    return {
      pass: obj.pass === true || String(obj.result || '').includes('通过'),
      reason: String(obj.reason || obj.message || obj.comment || '').trim() || (obj.pass ? '评委判定通过。' : '评委判定不通过。'),
      raw: text
    };
  }
  const pass = /通过|合理|pass/i.test(text) && !/不通过|不合理|fail/i.test(text);
  return {
    pass,
    reason: text || (pass ? '评委判定通过。' : '评委判定不通过。'),
    raw: text
  };
}

// === 终审裁决：当一轮达到 maxExchanges 上限时调用 ===
function _debateClampMaxExchangesGet(chat) {
  const meta = chat && chat.debate;
  return _debateClampMaxExchanges(meta ? meta.maxExchanges : 10);
}

async function _debateCallFinalJudge(chat, round, runtime) {
  const meta = chat.debate;
  const role = meta.roles.judge;
  const systemPrompt = [
    '你是辩论赛的终审仲裁官。',
    '当前一局辩论已经结束，你需要根据该局双方的全部发言，评出获胜一方。',
    '判决标准：论点质量、逻辑严密性、反驳力度、语言表达。',
    '注意：你只能判一方胜利，不能平局。',
    '输出 JSON 格式：{"winner":"pro"|"con","winnerReason":"正方/反方胜利的详细理由","loserReason":"正方/反方失败的详细理由"}。',
    '理由必须详实具体，引用双方发言中的论点和反驳作为佐证。'
  ].join('\n');

  const prompt = [
    `辩题：${meta.topic}`,
    `当前是第 ${round.index}/${meta.totalRounds} 局。`,
    '本局已到达发言上限，以下为双方全部发言：',
    '---',
    _debateTranscript(chat, round.index),
    '---',
    '请根据本局双方的全部发言进行终审裁决，输出 JSON。'
  ].join('\n\n');

  const raw = await _debateCallWithRoleConfig(role, [{ role: 'user', content: prompt }], systemPrompt, {
    chat,
    chatId: chat.id,
    signal: runtime.ctrl.signal,
    isStopped: () => runtime.stopRequested || runtime.ctrl.signal.aborted,
    sourceLabel: '辩论模式 · 终审裁决'
  });
  return _debateParseFinalJudge(raw);
}

function _debateParseFinalJudge(raw) {
  const text = String(raw || '').trim();
  let obj = null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    obj = JSON.parse(candidate);
  } catch (e) {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (match) {
      try { obj = JSON.parse(match[0]); } catch (_) {}
    }
  }
  if (obj && typeof obj === 'object') {
    const winner = (obj.winner === 'pro' || obj.winner === 'con') ? obj.winner : null;
    return {
      winner: winner || (String(obj.pick || obj.result || '').includes('反') ? 'con' : 'pro'),
      winnerReason: String(obj.winnerReason || obj.winReason || '').trim() || '评委未提供详细理由。',
      loserReason: String(obj.loserReason || obj.loseReason || '').trim() || '评委未提供详细理由。',
      raw: text
    };
  }
  // fallback: keyword matching
  const isCon = /反方[胜赢]|反方更|判反|winner.*con/i.test(text) && !/正方[胜赢]|正方更/i.test(text);
  const isPro = /正方[胜赢]|正方更|判正|winner.*pro/i.test(text) && !/反方[胜赢]|反方更/i.test(text);
  const winner = isCon ? 'con' : (isPro ? 'pro' : 'pro'); // 默认判正方
  return {
    winner,
    winnerReason: '评委裁决：' + text.slice(0, 500),
    loserReason: '评委裁决：见上方理由。',
    raw: text
  };
}

async function _debateHandleMaxExchanges(chat, round, runtime) {
  const meta = chat.debate;
  try {
    const finalResult = await _debateCallFinalJudge(chat, round, runtime);
    _debateAddFinalJudgeCard(chat, round, finalResult);
    _debatePauseForFinalJudge(chat, round, finalResult);
    return;
  } catch (e) {
    const stopped = runtime.stopRequested || runtime.ctrl.signal.aborted || (e && e.name === 'AbortError');
    if (stopped) throw e;
    console.error('[debate] final judge call failed:', e);
    meta.status = 'error';
    meta.error = '终审裁决调用失败：' + (e.message || String(e));
    meta.updatedAt = Date.now();
    delete DEBATE_RUNTIME[chat.id];
    if (typeof clearChatTask === 'function') clearChatTask(chat.id);
    saveData();
    _debateRenderRefresh(chat);
    if (typeof toast === 'function') toast('终审裁决调用失败：' + (e.message || String(e)), 5000);
    return;
  }
}

function _debateAddFinalJudgeCard(chat, round, finalResult) {
  const now = Date.now();
  chat.messages.push({
    role: 'assistant',
    content: '',
    _debateJudge: true,
    _debateFinalJudge: true,
    debate: {
      kind: 'judge',
      round: round.index,
      finalJudgePick: finalResult.winner,
      winnerReason: finalResult.winnerReason,
      loserReason: finalResult.loserReason,
      raw: finalResult.raw || ''
    },
    _startTime: now,
    _firstTokenAt: now,
    _endTime: now
  });
  chat.debate.updatedAt = now;
}

function _debatePauseForFinalJudge(chat, round, finalResult) {
  const meta = chat.debate;
  _debateClearFinalJudgeTimeout(chat);
  meta.status = 'waiting_manual';
  meta.waitingManual = {
    round: round.index,
    side: '',
    speechSeq: 0,
    reason: 'max_exchanges',
    judgePass: false,
    finalJudgePick: finalResult.winner,
    winnerReason: finalResult.winnerReason,
    loserReason: finalResult.loserReason,
    at: Date.now()
  };
  meta.updatedAt = Date.now();
  delete DEBATE_RUNTIME[chat.id];
  if (typeof clearChatTask === 'function') clearChatTask(chat.id);
  saveData();
  _debateRenderRefresh(chat);
  _debateArmManualWaitTimer(chat, meta.waitingManual);
}

function _debateFinalJudgeTimeout(chatId) {
  const chat = chatById(chatId);
  if (!chat || !chat.debate || chat.debate.status !== 'waiting_manual') return;
  if (isDebateCompressing(chat.id)) return;
  const waiting = chat.debate.waitingManual || {};
  if (waiting.reason !== 'max_exchanges') return;
  const pick = waiting.finalJudgePick;
  if (pick !== 'pro' && pick !== 'con') return;
  const round = _debateEnsureRound(chat.debate, waiting.round || chat.debate.currentRound || 1);
  _debateClearFinalJudgeTimeout(chat);
  _debateSetRoundWinner(chat, round, pick, 'judge');
  chat.debate.waitingManual = null;
  delete chat.debate.waitingManual;
  chat.debate.status = 'running';
  _debateAdvanceRound(chat);
  saveData();
  _debateRenderRefresh(chat);
  if (typeof toast === 'function') toast(`超时未响应，已按评委裁决自动判${_debateSideName(pick)}胜利`, 4000);
  if (chat.debate.status !== 'completed') {
    startDebate(chat.id).catch(e => {
      console.error('[debate] final judge timeout continue failed:', e);
    });
  }
}

function _debateManualPassTimeout(chatId) {
  const chat = chatById(chatId);
  if (!chat || !chat.debate || chat.debate.status !== 'waiting_manual') return;
  if (isDebateCompressing(chat.id)) return;
  const waiting = chat.debate.waitingManual || {};
  if (waiting.reason !== 'threshold') return;
  _debateClearManualPassTimeout(chat);
  delete chat.debate.waitingManual;
  chat.debate.status = 'running';
  chat.debate.updatedAt = Date.now();
  saveData();
  _debateRenderRefresh(chat);
  if (typeof toast === 'function') toast('人工审核超时未操作，已默认通过', 3000);
  startDebate(chat.id).catch(e => {
    console.error('[debate] manual threshold timeout continue failed:', e);
  });
}

function _debateClearFinalJudgeTimeout(chat) {
  if (!chat || !chat.debate) return;
  if (chat.debate._finalJudgeTimeoutId) {
    clearTimeout(chat.debate._finalJudgeTimeoutId);
    chat.debate._finalJudgeTimeoutId = null;
  }
  if (chat.debate._finalJudgeCountdownId) {
    clearInterval(chat.debate._finalJudgeCountdownId);
    chat.debate._finalJudgeCountdownId = null;
  }
  chat.debate._finalJudgeTimeoutAt = null;
}

function _debateClearManualPassTimeout(chat) {
  if (!chat || !chat.debate) return;
  if (chat.debate._manualPassTimeoutId) {
    clearTimeout(chat.debate._manualPassTimeoutId);
    chat.debate._manualPassTimeoutId = null;
  }
  if (chat.debate._manualPassCountdownId) {
    clearInterval(chat.debate._manualPassCountdownId);
    chat.debate._manualPassCountdownId = null;
  }
  chat.debate._manualPassTimeoutAt = null;
}

function _debateStartFinalJudgeCountdown(chat) {
  if (!chat || !chat.debate) return;
  if (chat.debate._finalJudgeCountdownId) clearInterval(chat.debate._finalJudgeCountdownId);
  chat.debate._finalJudgeCountdownId = setInterval(() => {
    if (!chat.debate._finalJudgeTimeoutAt) {
      clearInterval(chat.debate._finalJudgeCountdownId);
      chat.debate._finalJudgeCountdownId = null;
      return;
    }
    const remaining = Math.max(0, Math.ceil((chat.debate._finalJudgeTimeoutAt - Date.now()) / 1000));
    const el = document.getElementById('debateFinalJudgeTimer');
    if (el) {
      el.textContent = `⏱ ${remaining}秒后自动按评委裁决`;
      if (remaining <= 30) el.style.color = 'var(--warning)';
    }
    if (remaining <= 0) {
      clearInterval(chat.debate._finalJudgeCountdownId);
      chat.debate._finalJudgeCountdownId = null;
    }
    if (chat.debate.status !== 'waiting_manual') {
      clearInterval(chat.debate._finalJudgeCountdownId);
      chat.debate._finalJudgeCountdownId = null;
    }
  }, 1000);
}

function _debateStartManualPassCountdown(chat) {
  if (!chat || !chat.debate) return;
  if (chat.debate._manualPassCountdownId) clearInterval(chat.debate._manualPassCountdownId);
  chat.debate._manualPassCountdownId = setInterval(() => {
    if (!chat.debate._manualPassTimeoutAt) {
      clearInterval(chat.debate._manualPassCountdownId);
      chat.debate._manualPassCountdownId = null;
      return;
    }
    const remaining = Math.max(0, Math.ceil((chat.debate._manualPassTimeoutAt - Date.now()) / 1000));
    const el = document.getElementById('debateManualPassTimer');
    if (el) {
      el.textContent = `⏱ ${remaining}秒后默认通过`;
      if (remaining <= 10) el.style.color = 'var(--warning)';
    }
    if (remaining <= 0) {
      clearInterval(chat.debate._manualPassCountdownId);
      chat.debate._manualPassCountdownId = null;
    }
    if (chat.debate.status !== 'waiting_manual') {
      clearInterval(chat.debate._manualPassCountdownId);
      chat.debate._manualPassCountdownId = null;
    }
  }, 1000);
}

function renderDebateJudgeMsg(m, idx) {
  if (m._debateFinalJudge && typeof renderDebateFinalJudgeMsg === 'function') {
    return renderDebateFinalJudgeMsg(m, idx);
  }
  const d = m.debate || {};
  const pass = !!d.pass;
  const chat = currentChat();
  const waiting = chat && chat.debate && chat.debate.status === 'waiting_manual' && chat.debate.waitingManual;
  const showActions = waiting && waiting.round === d.round && waiting.side === d.side && waiting.speechSeq === d.speechSeq;
  const reason = d.reason || m.content || '';
  let countdownHtml = '';
  if (showActions && waiting.reason === 'threshold' && chat.debate._manualPassTimeoutAt) {
    const remaining = Math.max(0, Math.ceil((chat.debate._manualPassTimeoutAt - Date.now()) / 1000));
    countdownHtml = `<div class="debate-timeout-timer" id="debateManualPassTimer">⏱ ${remaining}秒后默认通过</div>`;
  }
  return `
    <div class="message debate-judge-message" data-idx="${idx}">
      <div class="avatar assistant">评</div>
      <div class="msg-body">
        <div class="debate-judge-card ${pass ? 'pass' : 'fail'}">
          <div class="debate-judge-head">
            <span>第 ${d.round || '-'} 局评委审核</span>
            <span class="debate-judge-result">${pass ? '通过' : '不通过'}</span>
          </div>
          <div class="debate-judge-reason">${renderMarkdown(reason)}</div>
          ${showActions ? `
            <div class="debate-manual-actions">
              <button class="btn btn-primary" onclick="debateManualPass('${escapeHtml(chat.id)}')">通过</button>
              <button class="btn" onclick="debateManualWin('${escapeHtml(chat.id)}','pro')">判正方胜利</button>
              <button class="btn" onclick="debateManualWin('${escapeHtml(chat.id)}','con')">判反方胜利</button>
            </div>
            ${countdownHtml}` : ''}
        </div>
      </div>
    </div>`;
}

function renderDebateFinalJudgeMsg(m, idx) {
  const d = m.debate || {};
  const chat = currentChat();
  const waiting = chat && chat.debate && chat.debate.status === 'waiting_manual' && chat.debate.waitingManual;
  const showActions = waiting && waiting.reason === 'max_exchanges' && waiting.round === d.round;
  const pick = d.finalJudgePick || (waiting && waiting.finalJudgePick) || '';
  const winnerIsPro = pick === 'pro';
  const winnerName = winnerIsPro ? '正方' : '反方';
  const loserName = winnerIsPro ? '反方' : '正方';
  const winnerReason = d.winnerReason || (waiting && waiting.winnerReason) || '';
  const loserReason = d.loserReason || (waiting && waiting.loserReason) || '';

  // 倒计时
  let countdownHtml = '';
  if (showActions && chat.debate._finalJudgeTimeoutAt) {
    const remaining = Math.max(0, Math.ceil((chat.debate._finalJudgeTimeoutAt - Date.now()) / 1000));
    countdownHtml = `<div class="debate-timeout-timer" id="debateFinalJudgeTimer">⏱ ${remaining}秒后自动按评委裁决</div>`;
  }

  return `
    <div class="message debate-judge-message" data-idx="${idx}">
      <div class="avatar assistant">裁</div>
      <div class="msg-body">
        <div class="debate-judge-card final">
          <div class="debate-judge-head">
            <span>第 ${d.round || '-'} 局终审裁决</span>
            <span class="debate-judge-result final">${winnerIsPro ? '判正方胜利' : '判反方胜利'}</span>
          </div>
          <div class="debate-final-result">
            <div class="debate-final-section winner">
              <div class="debate-final-label">🏆 ${winnerName}胜利理由</div>
              <div class="debate-final-reason">${renderMarkdown(winnerReason)}</div>
            </div>
            <div class="debate-final-section loser">
              <div class="debate-final-label">💔 ${loserName}失败理由</div>
              <div class="debate-final-reason">${renderMarkdown(loserReason)}</div>
            </div>
          </div>
          ${showActions ? `
            <div class="debate-final-actions">
              <button class="btn btn-primary" onclick="debateManualWin('${escapeHtml(chat.id)}','pro')">判正方胜利</button>
              <button class="btn btn-primary" onclick="debateManualWin('${escapeHtml(chat.id)}','con')">判反方胜利</button>
            </div>
            ${countdownHtml}
          ` : ''}
        </div>
      </div>
    </div>`;
}

function renderDebateSpeechMsg(m, idx) {
  const d = m.debate || {};
  const isPro = d.side === 'pro';
  const type = d.speechType === 'opening' ? '立论' : '反驳';
  return `
    <div class="message debate-speech-message ${isPro ? 'debate-pro' : 'debate-con'}" data-idx="${idx}">
      <div class="avatar ${isPro ? 'user' : 'assistant'}">${isPro ? '正' : '反'}</div>
      <div class="msg-body">
        <div class="msg-role">${_debateSideName(d.side)}
          <span class="msg-badge debate-speech-badge">第 ${d.round || '-'} 局 · ${type}</span>
        </div>
        <div class="msg-content">${renderMarkdown(m.content || '')}</div>
        <div class="msg-actions">
          <button class="msg-action" onclick="copyMsg(${idx})">📋 复制</button>
        </div>
      </div>
    </div>`;
}

function renderDebateSummaryMsg(m, idx) {
  const chat = currentChat();
  const meta = chat && chat.debate ? chat.debate : {};
  const score = meta.score || {};
  const winner = meta.finalWinner === 'draw' ? '平局' : `${_debateSideName(meta.finalWinner)}胜利`;
  return `
    <div class="message debate-summary-message" data-idx="${idx}">
      <div class="avatar assistant">结</div>
      <div class="msg-body">
        <div class="debate-result-card">
          <div class="debate-result-head">
            <span>最终结果</span>
            <strong>${escapeHtml(winner)}</strong>
          </div>
          <div class="debate-scoreline">
            <span>正方 <strong>${score.pro || 0}</strong></span>
            <span>:</span>
            <span><strong>${score.con || 0}</strong> 反方</span>
          </div>
          <div class="msg-content">${renderMarkdown(m.content || '')}</div>
        </div>
      </div>
    </div>`;
}

function renderDebateCompletedChat(chat) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : [];
  const summary = messages.find(m => m && m._debateSummary);
  const grouped = new Map();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg._hiddenFromUI || msg._debateSummary) continue;
    const round = msg.debate && msg.debate.round ? msg.debate.round : 0;
    if (!grouped.has(round)) grouped.set(round, []);
    grouped.get(round).push({ msg, idx: i });
  }
  const rounds = [...grouped.entries()].filter(([round]) => round > 0).sort((a, b) => a[0] - b[0]);
  const html = rounds.map(([round, items]) => {
    const roundMeta = (chat.debate.rounds || []).find(r => r.index === round) || {};
    const winner = roundMeta.winner ? `${_debateSideName(roundMeta.winner)}胜利` : '未决';
    return `
      <details class="debate-round-fold">
        <summary>
          <span>第${_debateChineseNumber(round)}轮辩论</span>
          <em>${escapeHtml(winner)}</em>
        </summary>
        <div class="debate-round-body">
          ${items.map(item => renderMsg(item.msg, item.idx)).join('')}
        </div>
      </details>`;
  }).join('');
  const summaryHtml = summary ? renderDebateSummaryMsg(summary, messages.indexOf(summary)) : '';
  return html + summaryHtml;
}

function openDebateChat(chatId) {
  if (typeof switchChat === 'function') switchChat(chatId);
  if (typeof closeSettingsPage === 'function') closeSettingsPage();
}

function recoverInterruptedDebates() {
  if (!state || !Array.isArray(state.chats)) return false;
  let changed = false;
  for (const chat of state.chats) {
    if (!chat || !chat.debate || chat.debate.type !== 'debate_mode') continue;
    if (chat.debate.status === 'running') {
      chat.debate.status = 'stopped';
      chat.debate.error = chat.debate.error || '页面刷新或应用重启，辩论已暂停';
      chat.debate.updatedAt = Date.now();
      changed = true;
    }
    // 恢复 max_exchanges 的倒计时
    if (chat.debate.status === 'waiting_manual' && chat.debate.waitingManual && chat.debate.waitingManual.reason === 'max_exchanges') {
      const remaining = _debateManualWaitRemainingMs(chat, chat.debate.waitingManual);
      _debateArmManualWaitTimer(chat, chat.debate.waitingManual, remaining);
    }
    if (chat.debate.status === 'waiting_manual' && chat.debate.waitingManual && chat.debate.waitingManual.reason === 'threshold') {
      const remaining = _debateManualWaitRemainingMs(chat, chat.debate.waitingManual);
      _debateArmManualWaitTimer(chat, chat.debate.waitingManual, remaining);
    }
  }
  return changed;
}

window.openDebateMode = openDebateMode;
window.closeDebateMode = closeDebateMode;
window.renderDebateModeModal = renderDebateModeModal;
window.startDebateFromUi = startDebateFromUi;
window.debateProfileChanged = debateProfileChanged;
window.debateTimeoutInputChanged = debateTimeoutInputChanged;
window.debateTimeoutSliderChanged = debateTimeoutSliderChanged;
window.debateManualPass = debateManualPass;
window.debateManualWin = debateManualWin;
window.openDebateChat = openDebateChat;
window.requestStopDebate = requestStopDebate;
window.stopCurrentDebate = stopCurrentDebate;
window.isDebateRunning = isDebateRunning;
window.isAnyDebateRunning = isAnyDebateRunning;
window.isDebateWaitingManual = isDebateWaitingManual;
window.isDebateWaitingManualTimed = isDebateWaitingManualTimed;
window.isDebateCompressing = isDebateCompressing;
window.isDebatePausable = isDebatePausable;
window.isAnyDebatePausable = isAnyDebatePausable;
window.renderDebateSpeechMsg = renderDebateSpeechMsg;
window.renderDebateJudgeMsg = renderDebateJudgeMsg;
window.renderDebateFinalJudgeMsg = renderDebateFinalJudgeMsg;
window.renderDebateSummaryMsg = renderDebateSummaryMsg;
window.renderDebateCompletedChat = renderDebateCompletedChat;
window.recoverInterruptedDebates = recoverInterruptedDebates;
