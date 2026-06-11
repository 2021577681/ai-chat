// ============ 辩论模式 ============

const DEBATE_SETTINGS_KEY = 'aichat_debate_settings_v1';
const DEBATE_RUNTIME = {};

function _debateDefaultSettings() {
  return {
    topic: '',
    totalRounds: 3,
    answerThreshold: 6,
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
    answerThreshold: _debateClampThreshold(document.getElementById('debateAnswerThreshold')?.value),
    pro: getRole('pro'),
    con: getRole('con'),
    judge: getRole('judge')
  };
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
        <label class="debate-field">人工审核阈值
          <input type="number" id="debateAnswerThreshold" min="1" max="99" step="1" value="${_debateClampThreshold(settings.answerThreshold)}">
        </label>
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
      answerThreshold: _debateClampThreshold(settings.answerThreshold),
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

function requestStopDebate(chatId) {
  const runtime = chatId ? DEBATE_RUNTIME[chatId] : null;
  if (!runtime) return false;
  runtime.stopRequested = true;
  if (runtime.ctrl) {
    try { runtime.ctrl.abort(); } catch (e) {}
  }
  const chat = chatById(chatId);
  if (chat && chat.debate) {
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
    if (round.winner) {
      _debateAdvanceRound(chat);
      continue;
    }

    let speechMsg = _debateLastUnreviewedSpeech(chat, roundNo);
    if (!speechMsg) {
      const lastSpeech = _debateLastCompletedSpeech(chat, roundNo);
      const side = lastSpeech ? _debateOtherSide(lastSpeech.debate.side) : round.opener;
      const speechType = lastSpeech ? 'rebuttal' : 'opening';
      speechMsg = _debateStartSpeech(chat, round, side, speechType);
      saveData();
      _debateRenderRefresh(chat);
      await _debateCallSpeakerStream(chat, round, side, speechType, speechMsg, runtime);
      saveData();
      _debateRenderRefresh(chat);
    }

    const review = await _debateCallJudge(chat, round, speechMsg, runtime);
    _debateAddJudgeCard(chat, round, speechMsg, review);
    saveData();
    _debateRenderRefresh(chat);

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

function _debateStartSpeech(chat, round, side, speechType) {
  const now = Date.now();
  round.answerCount = (round.answerCount || 0) + 1;
  const msg = {
    role: side === 'pro' ? 'user' : 'assistant',
    content: '',
    debate: {
      kind: 'speech',
      side,
      speechType,
      round: round.index,
      seq: round.answerCount,
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
  saveData();
  _debateRenderRefresh(chat);
}

function debateManualPass(chatId) {
  const chat = chatById(chatId);
  if (!chat || !chat.debate || chat.debate.status !== 'waiting_manual') return;
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

function _debateTranscript(chat, roundNo = null) {
  const lines = [`辩题：${chat.debate.topic}`];
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  for (const msg of messages) {
    if (!msg || !msg.debate) continue;
    if (roundNo && msg.debate.round !== roundNo) continue;
    if (msg.debate.kind === 'speech') {
      const type = msg.debate.speechType === 'opening' ? '立论' : '反驳';
      const status = msg.debate.completed === false || msg.debate.stopped ? '（中断未审核）' : '';
      lines.push(`第${msg.debate.round}局 ${_debateSideName(msg.debate.side)}${type}${status}：\n${msg.content || ''}`);
    } else if (msg.debate.kind === 'judge') {
      lines.push(`第${msg.debate.round}局 评委审核（${msg.debate.pass ? '通过' : '不通过'}）：\n${msg.debate.reason || msg.content || ''}`);
    }
  }
  return lines.join('\n\n');
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
            } else if (s.apiFormat === 'responses') {
              if (j.type === 'response.output_text.delta') {
                const delta = j.delta || '';
                finalText += delta;
                onProgress({ type: 'text_delta', text: delta });
              }
            } else {
              const delta = j.choices?.[0]?.delta;
              if (delta && delta.content) {
                finalText += delta.content;
                onProgress({ type: 'text_delta', text: delta.content });
              }
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
      } else if (s.apiFormat === 'responses') {
        finalText = typeof extractResponsesText === 'function' ? extractResponsesText(j) : '';
      } else {
        finalText = j.choices?.[0]?.message?.content || '';
      }
      onProgress({ type: 'text_delta', text: finalText });
    }

    // 记录 usage
    if (typeof recordUsageFromResponse === 'function') {
      const chat = options.chat || null;
      if (chat) recordUsageFromResponse(chat, null, { model: cfg.model });
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

function renderDebateJudgeMsg(m, idx) {
  const d = m.debate || {};
  const pass = !!d.pass;
  const chat = currentChat();
  const waiting = chat && chat.debate && chat.debate.status === 'waiting_manual' && chat.debate.waitingManual;
  const showActions = waiting && waiting.round === d.round && waiting.side === d.side && waiting.speechSeq === d.speechSeq;
  const reason = d.reason || m.content || '';
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
            </div>` : ''}
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
  }
  return changed;
}

window.openDebateMode = openDebateMode;
window.closeDebateMode = closeDebateMode;
window.renderDebateModeModal = renderDebateModeModal;
window.startDebateFromUi = startDebateFromUi;
window.debateProfileChanged = debateProfileChanged;
window.debateManualPass = debateManualPass;
window.debateManualWin = debateManualWin;
window.openDebateChat = openDebateChat;
window.requestStopDebate = requestStopDebate;
window.stopCurrentDebate = stopCurrentDebate;
window.isDebateRunning = isDebateRunning;
window.isAnyDebateRunning = isAnyDebateRunning;
window.renderDebateSpeechMsg = renderDebateSpeechMsg;
window.renderDebateJudgeMsg = renderDebateJudgeMsg;
window.renderDebateSummaryMsg = renderDebateSummaryMsg;
window.renderDebateCompletedChat = renderDebateCompletedChat;
window.recoverInterruptedDebates = recoverInterruptedDebates;
