// ============ 📊 PPT 独立模式 ============
// 顶栏按钮开启后，下一条用户消息会直接走 PPT Pipeline：
// User Request → Planner → Renderer → Validator/Preview，而不是普通聊天回答。

const DEFAULT_PPT_OUTLINE_PROMPT = [
  '你是资深演示文稿策划专家。请根据用户需求规划 PPT 大纲。',
  '必须只输出 JSON 对象，不要输出解释。',
  '大纲要贴合主题、用途和受众；标题要具体，避免泛泛而谈。'
].join('\n');

const DEFAULT_PPT_SLIDE_PROMPT = [
  '你是资深 PPT 内容策划专家。请把大纲扩展成可直接渲染的结构化页面内容。',
  '必须只输出 JSON 对象，不要输出解释。',
  '内容要自然、具体、可落地；每页信息密度适中，避免长句。'
].join('\n');

function normalizePptSlideCount(value) {
  const count = parseInt(value, 10);
  return Number.isFinite(count) ? Math.max(3, Math.min(30, count)) : 8;
}

function normalizePptRepairAllowedMaxCycles(value) {
  const count = parseInt(value, 10);
  return Number.isFinite(count) ? Math.max(1, Math.min(100, count)) : 20;
}

function normalizePptRepairMaxCycles(value, allowedMax) {
  const allowed = normalizePptRepairAllowedMaxCycles(allowedMax);
  const count = parseInt(value, 10);
  return Number.isFinite(count) ? Math.max(1, Math.min(allowed, count)) : Math.min(8, allowed);
}

function normalizePptTheme(value) {
  const theme = String(value || '').trim();
  if (theme === 'vibrant_orange') return 'vivid_orange';
  return ['business_blue', 'tech_dark', 'minimal_white', 'vivid_orange'].includes(theme)
    ? theme
    : 'business_blue';
}

function pptThemeLabel(theme) {
  return {
    business_blue: '商务蓝',
    tech_dark: '科技黑',
    minimal_white: '极简白',
    vivid_orange: '活力橙'
  }[normalizePptTheme(theme)] || '商务蓝';
}

function sanitizePptPayloadForUi(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  return {
    user_request: String(p.user_request || '').slice(0, 240),
    slide_count: p.slide_count,
    theme: p.theme,
    filename: p.filename,
    llm_model: p.llm_model || '当前模型',
    llm_temperature: p.llm_temperature,
    auto_preview: state.settings && state.settings.pptAutoPreview !== false
  };
}

function classifyPptIntent(text) {
  const raw = String(text || '').trim();
  const compact = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!compact) {
    return { isLikely: false, reason: '消息为空，无法识别为 PPT 需求。' };
  }
  const strongPatterns = [
    /\bpptx?\b/i,
    /\bpower\s*point\b/i,
    /\bslides?\b/i,
    /\bslide\s*deck\b/i,
    /\bpresentation\b/i,
    /\bkeynote\b/i,
    /幻灯片|演示文稿|演示稿|演示材料|汇报材料|路演材料|课件|投影片|简报/
  ];
  if (strongPatterns.some(re => re.test(raw))) {
    return { isLikely: true, reason: '检测到 PPT / 幻灯片 / 演示文稿相关关键词。' };
  }

  const actionLike = /(生成|制作|做一份|做个|做一个|创建|设计|整理|输出|准备|写一份|转成|转换成|改成|扩展成|生成一份|帮我做|帮我生成|帮我设计)/.test(raw);
  const presentationLike = /(汇报|展示|演示|路演|答辩|宣讲|培训|课程|课堂|讲座|方案介绍|项目介绍|产品介绍|商业计划书|bp\b|pitch\b)/i.test(raw);
  if (actionLike && presentationLike) {
    return { isLikely: true, reason: '检测到“制作/生成”等动作和“汇报/演示/答辩”等展示场景。' };
  }

  const slideCountLike = /(\d+|[一二三四五六七八九十]+)\s*(页|p|page|slides?)/i.test(raw);
  const layoutLike = /(封面|目录|结尾页|总结页|版式|模板|母版|讲稿|演讲稿|备注|页面|配色|主题色)/.test(raw);
  if (slideCountLike && (actionLike || layoutLike || presentationLike)) {
    return { isLikely: true, reason: '检测到页数或页面结构要求，符合 PPT 生成场景。' };
  }

  return { isLikely: false, reason: '未检测到 PPT、幻灯片、演示、课件、汇报材料等明显信号。' };
}

function confirmPptIntentIfNeeded(userRequest) {
  const intent = classifyPptIntent(userRequest);
  if (intent.isLikely) return { proceed: true, intent };
  const msg = [
    '这条消息看起来不像 PPT 生成需求。',
    '',
    `识别原因：${intent.reason}`,
    '',
    '点击“确定”：仍按 PPT 模式生成。',
    '点击“取消”：关闭 PPT 模式，退回普通聊天回答。'
  ].join('\n');
  const confirmed = typeof confirm === 'function' ? confirm(msg) : false;
  if (confirmed) {
    return {
      proceed: true,
      intent: {
        isLikely: true,
        confirmed: true,
        reason: '文本未明显指向 PPT，但用户已确认继续按 PPT 模式生成。'
      }
    };
  }
  return { proceed: false, intent };
}

function disablePptModeUi(options = {}) {
  const s = state.settings || {};
  s.usePpt = false;
  if (typeof syncPptToolsWithMode === 'function') syncPptToolsWithMode(false, { render: false });
  const btn = document.getElementById('pptModeBtn');
  if (btn) btn.classList.remove('ppt-active');
  syncPptComposerHint();
  if (options.persist !== false && typeof persistSettings === 'function') persistSettings();
  if (options.renderTools !== false && typeof renderToolList === 'function') renderToolList();
  if (options.updateSend !== false && typeof updateSendBtn === 'function') updateSendBtn();
}

async function fallbackToNormalChatFromPptMode(options = {}) {
  disablePptModeUi();
  if (typeof toast === 'function') toast('已关闭 PPT 模式，改用普通聊天回答', 2200);
  await callAPI(undefined, { contextChecked: !!options.contextChecked });
}

function createPptModeState(payload, intent) {
  const clean = sanitizePptPayloadForUi(payload);
  return {
    status: 'running',
    expanded: true,
    progressText: '准备生成参数...',
    startedAt: Date.now(),
    config: clean,
    steps: [
      {
        id: 'intent',
        title: '识别 PPT 意图',
        status: 'done',
        note: intent && intent.reason ? intent.reason : '已确认本轮按 PPT 模式生成。'
      },
      {
        id: 'prepare',
        title: '准备生成参数',
        status: 'active',
        note: `页数 ${clean.slide_count} · ${pptThemeLabel(clean.theme)} · ${clean.filename || 'generated.pptx'}`
      },
      {
        id: 'generate',
        title: '规划 PPT 大纲',
        status: 'pending',
        note: '根据主题、用途和受众规划演示结构。'
      },
      {
        id: 'slides',
        title: '扩展页面内容',
        status: 'pending',
        note: '把大纲扩展成每页标题、要点、版式和可渲染内容。'
      },
      {
        id: 'render',
        title: '渲染 PPTX 文件',
        status: 'pending',
        note: '调用后端生成可编辑的 .pptx 文件。'
      },
      {
        id: 'repair',
        title: '验证并自动修复',
        status: 'pending',
        note: '检测文字重叠、文字溢出、文字/图形冲突和图形重叠；失败时循环修复直到通过或达到上限。'
      },
      {
        id: 'preview',
        title: '预览与质量检查',
        status: state.settings && state.settings.pptAutoPreview === false ? 'skipped' : 'pending',
        note: state.settings && state.settings.pptAutoPreview === false
          ? '已在 PPT 设置中关闭自动预览。'
          : '生成预览，并检查页数、中文、空页和基础版式质量。'
      },
      {
        id: 'finish',
        title: '整理结果',
        status: 'pending',
        note: '返回 PPT 文件路径、页数和预览入口。'
      }
    ],
    events: []
  };
}

function pptStep(ppt, id) {
  return ppt && Array.isArray(ppt.steps) ? ppt.steps.find(step => step.id === id) : null;
}

function setPptStep(ppt, id, status, note, meta) {
  const step = pptStep(ppt, id);
  if (!step) return;
  step.status = status;
  if (note !== undefined) step.note = note;
  if (meta !== undefined) step.meta = meta;
  step.updatedAt = Date.now();
}

function applyPptPipelineDetails(ppt, generated) {
  if (!ppt || !generated || typeof generated !== 'object') return;
  const pipeline = generated.pipeline && typeof generated.pipeline === 'object' ? generated.pipeline : {};
  const outline = Array.isArray(pipeline.outline) ? pipeline.outline : [];
  const validationRules = pipeline.validation_rules && typeof pipeline.validation_rules === 'object' ? pipeline.validation_rules : {};
  if (outline.length) {
    setPptStep(
      ppt,
      'generate',
      'done',
      `已规划 ${outline.length} 页大纲：${outline.slice(0, 4).map(x => x.title).filter(Boolean).join(' / ')}${outline.length > 4 ? '...' : ''}`,
      { outline }
    );
    setPptStep(
      ppt,
      'slides',
      'done',
      `已扩展 ${generated.slides || outline.length} 页内容并匹配版式。`,
      { outline }
    );
  }
  if (validationRules && Object.keys(validationRules).length) {
    const ruleBits = [];
    if (validationRules.min_slides) ruleBits.push(`最少 ${validationRules.min_slides} 页`);
    if (validationRules.require_chinese) ruleBits.push('要求中文正常显示');
    if (validationRules.max_question_marks !== undefined) ruleBits.push(`问号≤${validationRules.max_question_marks}`);
    const repairStep = pptStep(ppt, 'repair');
    if (repairStep && repairStep.status === 'pending') {
      repairStep.note = `已生成质检规则：${ruleBits.join('，') || '基础结构和文本质量检查'}。`;
      repairStep.meta = { validation_rules: validationRules };
    }
  }
}

function addPptEvent(ppt, event) {
  if (!ppt) return null;
  if (!Array.isArray(ppt.events)) ppt.events = [];
  const next = {
    id: event.id || `ppt_evt_${Date.now()}_${ppt.events.length}`,
    name: event.name || 'ppt_step',
    status: event.status || 'done',
    args: event.args || {},
    result: event.result || '',
    ok: event.ok !== false,
    ts: Date.now()
  };
  ppt.events.push(next);
  return next;
}

function finishPptEvent(event, patch = {}) {
  if (!event) return;
  Object.assign(event, patch);
  if (!event.finishedAt) event.finishedAt = Date.now();
}

function refreshPptModeMessage(msgIdx, chat) {
  if (typeof refreshMsgNode === 'function') refreshMsgNode(msgIdx, chat);
  else if (typeof renderMessages === 'function') renderMessages();
  if (typeof saveData === 'function') saveData();
}

function syncPptComposerHint() {
  const input = document.getElementById('input');
  if (!input) return;
  if (!input.dataset.defaultPlaceholder) {
    input.dataset.defaultPlaceholder = input.getAttribute('placeholder') || '输入消息，Enter 发送 / Shift+Enter 换行 / 可拖拽或粘贴图片...';
  }
  input.setAttribute('placeholder', state.settings && state.settings.usePpt ? 'PPT' : input.dataset.defaultPlaceholder);
}

function ensurePptSettingsModal() {
  let modal = document.getElementById('pptSettingsModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'modal-mask';
  modal.id = 'pptSettingsModal';
  modal.innerHTML = `
    <div class="modal wide">
      <h2>📊 PPT 模式 <button class="modal-close" onclick="closePptSettings()">×</button></h2>
      <div class="json-help">
        开启顶栏 <strong>PPT</strong> 后，下一条消息会直接生成 .pptx。这里可以调整默认页数、主题、文件名，以及 LLM 规划用 Prompt。
      </div>

      <div class="form-group" style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <label style="margin:0;">生成后自动预览</label>
          <div class="form-hint" style="margin-top:2px;">生成 PPT 后自动调用 preview_ppt，方便检查页面效果。</div>
        </div>
        <label class="switch"><input type="checkbox" id="pptAutoPreview"><span class="switch-slider"></span></label>
      </div>

      <div class="form-group">
        <label>默认页数</label>
        <input type="number" id="pptSlideCount" min="3" max="30" step="1">
      </div>

      <div class="form-group">
        <label>默认主题</label>
        <select id="pptTheme">
          <option value="business_blue">商务蓝</option>
          <option value="tech_dark">科技黑</option>
          <option value="minimal_white">极简白</option>
          <option value="vivid_orange">活力橙</option>
        </select>
      </div>

      <div class="form-group">
        <label>默认文件名</label>
        <input type="text" id="pptFilename" placeholder="generated.pptx">
        <div class="form-hint">如果不以 .pptx 结尾，后端会自动补齐。</div>
      </div>

      <div class="form-group">
        <label>默认最大修复轮数</label>
        <input type="number" id="pptAutoRepairMaxCycles" min="1" max="100" step="1">
        <div class="form-hint">生成后验证不通过时，默认最多执行多少轮“验证-修复”闭环。</div>
      </div>

      <div class="form-group">
        <label>允许最大修复轮数</label>
        <input type="number" id="pptAutoRepairMaxAllowedCycles" min="1" max="100" step="1">
        <div class="form-hint">作为硬性上限：默认最大修复轮数和请求参数都不能超过这个值。</div>
      </div>

      <div class="form-group">
        <label>PPT 规划模型（可选）</label>
        <input type="text" id="pptModel" placeholder="留空则使用当前模型">
      </div>

      <div class="form-group">
        <label>PPT 规划温度</label>
        <div class="slider-row">
          <input type="range" id="pptTemperature" min="0" max="1" step="0.1" oninput="document.getElementById('pptTemperatureVal').textContent=this.value">
          <span class="slider-val" id="pptTemperatureVal">0.3</span>
        </div>
      </div>

      <hr style="margin:14px 0;border:none;border-top:1px solid var(--border);">
      <h3 style="font-size:14px;margin:0 0 12px;display:flex;align-items:center;gap:6px;">可编辑 Prompt</h3>

      <div class="form-group">
        <label>Outline Planner Prompt</label>
        <textarea id="pptOutlinePrompt" rows="5" placeholder="留空使用默认大纲规划提示词"></textarea>
        <div class="form-hint">控制“用户需求 → PPT 大纲”的规划方式。</div>
      </div>

      <div class="form-group">
        <label>Slide Planner Prompt</label>
        <textarea id="pptSlidePrompt" rows="6" placeholder="留空使用默认页面内容提示词"></textarea>
        <div class="form-hint">控制“大纲 → 每页具体内容”的生成方式。</div>
      </div>

      <div class="modal-footer">
        <button class="btn" onclick="resetPptPromptsToDefault()">恢复默认 Prompt</button>
        <button class="btn" onclick="closePptSettings()">取消</button>
        <button class="btn btn-primary" onclick="savePptSettings()">保存</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

function openPptSettings() {
  const modal = ensurePptSettingsModal();
  const s = state.settings || {};
  document.getElementById('pptAutoPreview').checked = s.pptAutoPreview !== false;
  document.getElementById('pptSlideCount').value = normalizePptSlideCount(s.pptSlideCount || 8);
  document.getElementById('pptTheme').value = normalizePptTheme(s.pptTheme);
  document.getElementById('pptFilename').value = s.pptFilename || 'generated.pptx';
  const allowedMaxCycles = normalizePptRepairAllowedMaxCycles(s.pptAutoRepairMaxAllowedCycles);
  const defaultMaxCycles = normalizePptRepairMaxCycles(s.pptAutoRepairMaxCycles, allowedMaxCycles);
  document.getElementById('pptAutoRepairMaxCycles').value = defaultMaxCycles;
  document.getElementById('pptAutoRepairMaxAllowedCycles').value = allowedMaxCycles;
  document.getElementById('pptModel').value = s.pptModel || '';
  const temp = s.pptTemperature === undefined ? 0.3 : Number(s.pptTemperature);
  document.getElementById('pptTemperature').value = Number.isFinite(temp) ? temp : 0.3;
  document.getElementById('pptTemperatureVal').textContent = document.getElementById('pptTemperature').value;
  document.getElementById('pptOutlinePrompt').value = s.pptOutlinePrompt || DEFAULT_PPT_OUTLINE_PROMPT;
  document.getElementById('pptSlidePrompt').value = s.pptSlidePrompt || DEFAULT_PPT_SLIDE_PROMPT;
  modal.classList.add('show');
  if (typeof initMainSettingsSelectSkins === 'function') initMainSettingsSelectSkins(modal);
}

function closePptSettings() {
  const modal = document.getElementById('pptSettingsModal');
  if (modal) modal.classList.remove('show');
}

function savePptSettings() {
  const s = state.settings;
  s.pptSlideCount = normalizePptSlideCount(document.getElementById('pptSlideCount').value);
  s.pptTheme = normalizePptTheme(document.getElementById('pptTheme').value);
  s.pptFilename = document.getElementById('pptFilename').value.trim() || 'generated.pptx';
  s.pptAutoPreview = !!document.getElementById('pptAutoPreview').checked;
  const allowedMaxCycles = normalizePptRepairAllowedMaxCycles(document.getElementById('pptAutoRepairMaxAllowedCycles').value);
  const defaultMaxCycles = normalizePptRepairMaxCycles(document.getElementById('pptAutoRepairMaxCycles').value, allowedMaxCycles);
  s.pptAutoRepairMaxAllowedCycles = allowedMaxCycles;
  s.pptAutoRepairMaxCycles = defaultMaxCycles;
  document.getElementById('pptAutoRepairMaxCycles').value = defaultMaxCycles;
  s.pptModel = document.getElementById('pptModel').value.trim();
  const temp = parseFloat(document.getElementById('pptTemperature').value);
  s.pptTemperature = Number.isFinite(temp) ? temp : 0.3;
  s.pptOutlinePrompt = document.getElementById('pptOutlinePrompt').value.trim();
  s.pptSlidePrompt = document.getElementById('pptSlidePrompt').value.trim();
  if (typeof persistSettings === 'function') persistSettings();
  closePptSettings();
  if (typeof toast === 'function') toast('✓ PPT 设置已保存');
}

function resetPptPromptsToDefault() {
  const outline = document.getElementById('pptOutlinePrompt');
  const slide = document.getElementById('pptSlidePrompt');
  if (outline) outline.value = DEFAULT_PPT_OUTLINE_PROMPT;
  if (slide) slide.value = DEFAULT_PPT_SLIDE_PROMPT;
}

function togglePptMode() {
  const s = state.settings;
  s.usePpt = !s.usePpt;
  if (s.usePpt) {
    s.usePlan = false;
    s.useOutline = false;
    s.useReflection = false;
    const planBtn = document.getElementById('planBtn');
    const outlineBtn = document.getElementById('outlineBtn');
    const reflectBtn = document.getElementById('reflectBtn');
    if (planBtn) planBtn.classList.remove('plan-active');
    if (outlineBtn) outlineBtn.classList.remove('outline-active');
    if (reflectBtn) reflectBtn.classList.remove('reflect-active');
  }
  if (typeof syncPptToolsWithMode === 'function') syncPptToolsWithMode(!!s.usePpt, { render: false });
  const btn = document.getElementById('pptModeBtn');
  if (btn) btn.classList.toggle('ppt-active', !!s.usePpt);
  syncPptComposerHint();
  if (typeof persistSettings === 'function') persistSettings();
  if (typeof renderToolList === 'function') renderToolList();
  if (typeof updateSendBtn === 'function') updateSendBtn();
  if (typeof toast === 'function') toast(s.usePpt ? '✓ 已启用 PPT 模式：下一条消息将生成 PPT' : '✓ 已关闭 PPT 模式');
}

function buildPptModePayload(userRequest) {
  const s = state.settings || {};
  const model = (s.pptModel || s.currentModel || '').trim();
  const allowedMaxCycles = normalizePptRepairAllowedMaxCycles(s.pptAutoRepairMaxAllowedCycles);
  const defaultMaxCycles = normalizePptRepairMaxCycles(s.pptAutoRepairMaxCycles, allowedMaxCycles);
  return {
    user_request: userRequest,
    slide_count: normalizePptSlideCount(s.pptSlideCount),
    theme: normalizePptTheme(s.pptTheme),
    filename: s.pptFilename || 'generated.pptx',
    llm_api_key: s.apiKey || '',
    llm_base_url: s.baseUrl || '',
    llm_model: model,
    llm_temperature: s.pptTemperature === undefined ? 0.3 : s.pptTemperature,
    auto_repair_max_cycles: defaultMaxCycles,
    auto_repair_max_allowed_cycles: allowedMaxCycles,
    ppt_outline_prompt: s.pptOutlinePrompt || '',
    ppt_slide_prompt: s.pptSlidePrompt || ''
  };
}

function currentLastUserText(chat) {
  const msgs = (chat && chat.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === 'user') return typeof _messageTextForEdit === 'function' ? _messageTextForEdit(m) : String(m.content || '');
  }
  return '';
}

function renderPptPanel(m, idx) {
  const ppt = m && m.pptMode;
  if (!ppt) return '';
  const steps = Array.isArray(ppt.steps) && ppt.steps.length ? ppt.steps : [
    { id: 'legacy', title: 'PPT 生成', status: ppt.status === 'done' ? 'done' : (ppt.status === 'error' ? 'error' : 'active'), note: ppt.path || ppt.error || '正在处理...' }
  ];
  const doneCount = steps.filter(step => step.status === 'done' || step.status === 'skipped' || step.status === 'warning').length;
  const total = steps.length;
  const pct = total ? Math.round(doneCount / total * 100) : 0;

  let statusBadge = '';
  if (ppt.status === 'running') statusBadge = '<span class="outline-status-badge running">进行中</span>';
  else if (ppt.status === 'done') statusBadge = '<span class="outline-status-badge done">已完成</span>';
  else if (ppt.status === 'error') statusBadge = '<span class="outline-status-badge error">出错</span>';
  else statusBadge = '<span class="outline-status-badge paused">待处理</span>';

  const stats = [
    `${doneCount}/${total} 步`,
    ppt.slides ? `${ppt.slides} 页` : '',
    ppt.path ? ppt.path : ''
  ].filter(Boolean).join(' · ');

  const stepHtml = `<ol class="outline-item-list ppt-step-list">${steps.map((step, i) => {
    const status = step.status || 'pending';
    const itemClass = status === 'active' || status === 'running' ? 'active' : status;
    const meta = step.meta && typeof step.meta === 'object'
      ? Object.entries(step.meta).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => {
          const label = { path: '文件', slides: '页数', html: '预览', preview_url: '入口', renderer: '渲染器', passed: '校验', cycles: '修复轮次', score: '评分', stopped: '停止原因' }[key] || key;
          const shown = value === true ? '是' : (value === false ? '否' : String(value));
          return `<span>${escapeHtml(label)}：${escapeHtml(shown)}</span>`;
        }).join('')
      : '';
    return `
      <li class="outline-item ppt-step ${itemClass}" data-step-id="${escapeHtml(step.id || String(i + 1))}">
        <div class="outline-item-main">
          <div class="outline-item-header">
            <span class="outline-item-id">${escapeHtml(String(i + 1))}</span>
            <span class="outline-item-title">${escapeHtml(step.title || 'PPT 步骤')}</span>
          </div>
          ${step.note ? `<div class="outline-item-note">${escapeHtml(step.note)}</div>` : ''}
          ${meta ? `<div class="ppt-step-meta">${meta}</div>` : ''}
        </div>
      </li>`;
  }).join('')}</ol>`;

  const config = ppt.config || {};
  const configHtml = `
    <div class="ppt-config-grid">
      <span>页数：${escapeHtml(String(config.slide_count || ppt.slides || '-'))}</span>
      <span>主题：${escapeHtml(pptThemeLabel(config.theme))}</span>
      <span>模型：${escapeHtml(config.llm_model || '当前模型')}</span>
      <span>文件：${escapeHtml(config.filename || ppt.path || 'generated.pptx')}</span>
    </div>`;

  let eventsHtml = '';
  if (Array.isArray(ppt.events) && ppt.events.length) {
    eventsHtml = `
      <div class="outline-section sub ppt-events-section">
        <div class="outline-section-header">后台调用</div>
        <div class="outline-section-body">
          <div class="outline-tool-calls">
            ${ppt.events.map(ev => {
              const argsStr = JSON.stringify(ev.args || {});
              const argsShort = argsStr.length > 120 ? argsStr.slice(0, 120) + '...' : argsStr;
              const result = String(ev.result || '');
              const resultShort = result.length > 420 ? result.slice(0, 420) + '...' : result;
              const cls = ev.status === 'running' ? 'running' : (ev.status === 'error' ? 'error' : (ev.status === 'warning' ? 'warning' : 'success'));
              const icon = ev.status === 'running' ? '<span class="outline-tool-spin"></span>' : (ev.status === 'error' ? '!' : (ev.status === 'warning' ? '!' : 'OK'));
              return `
                <div class="outline-tool-call ppt-event ${cls}">
                  <div class="outline-tool-head">
                    <span class="outline-tool-icon">${icon}</span>
                    <span class="outline-tool-name">${escapeHtml(ev.name || 'PPT 调用')}</span>
                    <span class="outline-tool-args" title="${escapeHtml(argsStr)}">${escapeHtml(argsShort)}</span>
                  </div>
                  ${result ? `<div class="outline-tool-result">${escapeHtml(resultShort)}</div>` : ''}
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  }

  const progressHtml = ppt.status === 'running' || ppt.inProgress
    ? `<div class="ref-progress"><span class="ref-spinner"></span><span>${escapeHtml(ppt.progressText || '正在生成 PPT...')}</span></div>`
    : '';

  return `
    <div class="outline-panel ppt-panel ${ppt.expanded === false ? 'collapsed' : ''}" data-msg-idx="${idx}">
      <button class="outline-toggle ppt-toggle" onclick="togglePptPanel(${idx})">
        <span>PPT 生成流程</span>
        <span class="outline-stats">${escapeHtml(stats || '准备中')}</span>
      </button>
      <div class="outline-body">
        <div class="outline-section main">
          <div class="outline-section-header">PPT Pipeline ${statusBadge}</div>
          <div class="outline-section-body">
            ${total ? `<div class="outline-progress-bar"><div class="outline-progress-fill" style="width:${pct}%;"></div></div>` : ''}
            ${configHtml}
            ${stepHtml}
          </div>
        </div>
        ${eventsHtml}
        ${progressHtml}
      </div>
    </div>`;
}

function togglePptPanel(idx) {
  const c = currentChat();
  const msg = c && c.messages && c.messages[idx];
  if (!msg || !msg.pptMode) return;
  msg.pptMode.expanded = msg.pptMode.expanded === false;
  if (typeof refreshMsgNode === 'function') refreshMsgNode(idx, c);
  else if (typeof renderMessages === 'function') renderMessages();
  if (typeof saveData === 'function') saveData();
}

async function callAPIWithPptMode(options = {}) {
  const c = currentChat();
  if (!c) return;
  const userRequest = currentLastUserText(c).trim();
  if (!userRequest) return;
  const intentDecision = confirmPptIntentIfNeeded(userRequest);
  if (!intentDecision.proceed) {
    await fallbackToNormalChatFromPptMode(options);
    return;
  }
  const payload = buildPptModePayload(userRequest);

  const aiMsg = {
    role: 'assistant',
    content: '',
    _startTime: Date.now(),
    pptMode: createPptModeState(payload, intentDecision.intent)
  };
  c.messages.push(aiMsg);
  const msgIdx = c.messages.length - 1;
  renderMessages();
  saveData();

  const ctrl = new AbortController();
  if (typeof beginChatTask === 'function') beginChatTask(c.id, ctrl, { resetStop: true });
  else state.abortCtrl = ctrl;
  if (typeof setChatTaskMode === 'function') setChatTaskMode(c.id, 'ppt');
  if (typeof syncGlobalTaskState === 'function') syncGlobalTaskState(c.id);
  if (typeof updateSendBtn === 'function') updateSendBtn();

  try {
    setPptStep(aiMsg.pptMode, 'prepare', 'done', `已读取配置：${payload.slide_count} 页 · ${pptThemeLabel(payload.theme)} · ${payload.filename}`);
    setPptStep(aiMsg.pptMode, 'generate', 'active', '正在调用 generate_ppt：后端会连续完成大纲规划、页面内容扩展和 PPTX 渲染。');
    aiMsg.pptMode.progressText = '正在规划并生成 PPTX...';
    const generateEvent = addPptEvent(aiMsg.pptMode, {
      name: 'generate_ppt',
      status: 'running',
      args: sanitizePptPayloadForUi(payload),
      result: '等待后端生成 PPTX...'
    });
    refreshPptModeMessage(msgIdx, c);

    const generated = await generatePpt(payload, { signal: ctrl.signal, source: 'ppt-mode', chatId: c.id });
    if (typeof generated === 'string') throw new Error(generated);
    applyPptPipelineDetails(aiMsg.pptMode, generated);
    if (!generated || !generated.ok) {
      const repair = (generated && generated.auto_repair) || {};
      const validation = (generated && generated.validation) || {};
      const repairCycles = Array.isArray(repair.cycles) ? repair.cycles.length : 0;
      const hasGeneratedFile = !!(generated && generated.path);
      finishPptEvent(generateEvent, {
        status: hasGeneratedFile ? 'warning' : 'error',
        ok: hasGeneratedFile,
        result: (generated && generated.text) || 'PPT 生成失败'
      });
      if (hasGeneratedFile) {
        setPptStep(aiMsg.pptMode, 'render', 'done', `已生成文件但验证未通过：${generated.path}`, { path: generated.path, slides: generated.slides });
      }
      setPptStep(
        aiMsg.pptMode,
        'repair',
        hasGeneratedFile ? 'warning' : 'error',
        repairCycles
          ? `已执行 ${repairCycles}/${repair.max_cycles || repairCycles} 轮验证-修复闭环，仍未通过。`
          : '验证未通过，未执行有效修复。',
        {
          cycles: repairCycles || '',
          score: validation.score ?? '',
          stopped: repair.stopped_reason || ''
        }
      );
      if (hasGeneratedFile) {
        setPptStep(aiMsg.pptMode, 'preview', 'skipped', '生成文件未通过质量验证，已跳过自动预览；可手动打开文件或调整内容后重试。');
        aiMsg.content = `${generated.text || `⚠️ PPT 已生成但验证未通过：${generated.path}`}`;
        setPptStep(aiMsg.pptMode, 'finish', 'warning', '已返回可用 PPT 文件路径，但建议根据验证问题继续调整。');
        aiMsg.pptMode.status = 'warning';
        aiMsg.pptMode.path = generated.path;
        aiMsg.pptMode.slides = generated.slides;
        aiMsg.pptMode.expanded = false;
        return;
      }
      throw new Error((generated && generated.text) || 'PPT 生成失败');
    }
    finishPptEvent(generateEvent, {
      status: 'done',
      ok: true,
      result: generated.text || `PPT 已生成：${generated.path || '-'}`
    });
    if (pptStep(aiMsg.pptMode, 'generate') && pptStep(aiMsg.pptMode, 'generate').status !== 'done') {
      setPptStep(
        aiMsg.pptMode,
        'generate',
        'done',
        `已完成 PPT 大纲规划，目标页数 ${generated.slides || payload.slide_count || '-'} 页。`
      );
    }
    if (pptStep(aiMsg.pptMode, 'slides') && pptStep(aiMsg.pptMode, 'slides').status !== 'done') {
      setPptStep(
        aiMsg.pptMode,
        'slides',
        'done',
        '已生成每页标题、正文要点和版式数据。'
      );
    }
    setPptStep(
      aiMsg.pptMode,
      'render',
      'done',
      `已渲染 PPTX：${generated.path || '-'}${generated.slides ? `（${generated.slides} 页）` : ''}`,
      { path: generated.path, slides: generated.slides }
    );
    const repair = generated.auto_repair || {};
    const validation = generated.validation || {};
    const repairCycles = Array.isArray(repair.cycles) ? repair.cycles.length : 0;
    setPptStep(
      aiMsg.pptMode,
      'repair',
      validation.passed === false ? 'warning' : 'done',
      repairCycles
        ? `已执行 ${repairCycles}/${repair.max_cycles || repairCycles} 轮验证-修复闭环，${validation.passed === false ? '仍未通过' : '验证通过'}。`
        : (validation.passed === false ? '验证未通过，未执行有效修复。' : '验证通过，无需继续修复。'),
      {
        cycles: repairCycles || '',
        score: validation.score ?? '',
        stopped: repair.stopped_reason || ''
      }
    );
    refreshPptModeMessage(msgIdx, c);

    let previewText = '';
    if (state.settings.pptAutoPreview !== false && generated.path && typeof previewPpt === 'function') {
      setPptStep(aiMsg.pptMode, 'preview', 'active', '正在调用 preview_ppt：生成预览并执行质量检查。');
      aiMsg.pptMode.progressText = '正在生成预览并检查质量...';
      const previewEvent = addPptEvent(aiMsg.pptMode, {
        name: 'preview_ppt',
        status: 'running',
        args: {
          path: generated.path,
          rules: { min_slides: 1, require_chinese: true, max_question_marks: 0 }
        },
        result: '等待预览和校验结果...'
      });
      refreshPptModeMessage(msgIdx, c);
      try {
        const prev = await previewPpt({
          path: generated.path,
          rules: { min_slides: 1, require_chinese: true, max_question_marks: 0 }
        }, { signal: ctrl.signal, source: 'ppt-mode', chatId: c.id });
        if (prev && typeof prev !== 'string') {
          previewText = `\n\n🖼️ 预览：${prev.preview || prev.preview_path || prev.html || '已生成'}`;
          finishPptEvent(previewEvent, {
            status: prev.passed === false ? 'warning' : 'done',
            ok: prev.passed !== false,
            result: prev.text || `预览已生成：${prev.preview_url || prev.html || '-'}`
          });
          setPptStep(
            aiMsg.pptMode,
            'preview',
            prev.passed === false ? 'warning' : 'done',
            `预览入口：${prev.preview_url || prev.html || '已生成'}；校验：${prev.passed === false ? '未通过' : '通过'}`,
            { html: prev.html, preview_url: prev.preview_url, renderer: prev.renderer, passed: prev.passed }
          );
        }
      } catch (e) {
        previewText = `\n\n⚠️ PPT 已生成，但自动预览失败：${e.message}`;
        finishPptEvent(previewEvent, {
          status: 'error',
          ok: false,
          result: e.message || String(e)
        });
        setPptStep(aiMsg.pptMode, 'preview', 'error', `自动预览失败：${e.message || e}`);
      }
    } else {
      setPptStep(aiMsg.pptMode, 'preview', 'skipped', '自动预览未启用，或本次未返回可预览路径。');
    }

    aiMsg.content = `${generated.text || `✅ PPT 已生成：${generated.path}`}${previewText}`;
    setPptStep(aiMsg.pptMode, 'finish', 'done', '已整理 PPT 文件路径和预览信息。');
    aiMsg.pptMode.status = 'done';
    aiMsg.pptMode.path = generated.path;
    aiMsg.pptMode.slides = generated.slides;
    aiMsg.pptMode.expanded = false;
  } catch (e) {
    aiMsg.content = `❌ PPT 模式生成失败：${e.message || e}`;
    (aiMsg.pptMode.events || [])
      .filter(ev => ev && ev.status === 'running')
      .forEach(ev => finishPptEvent(ev, { status: 'error', ok: false, result: e.message || String(e) }));
    const runningStep = (aiMsg.pptMode.steps || []).find(step => step.status === 'active');
    if (runningStep) setPptStep(aiMsg.pptMode, runningStep.id, 'error', e.message || String(e));
    setPptStep(aiMsg.pptMode, 'finish', 'error', 'PPT 生成流程已中断。');
    aiMsg.pptMode.status = 'error';
    aiMsg.pptMode.error = e.message || String(e);
  } finally {
    aiMsg._endTime = Date.now();
    aiMsg.pptMode.inProgress = false;
    delete aiMsg.pptMode.progressText;
    const s = state.settings || {};
    s.usePpt = false;
    if (typeof syncPptToolsWithMode === 'function') syncPptToolsWithMode(false, { render: false });
    const btn = document.getElementById('pptModeBtn');
    if (btn) btn.classList.remove('ppt-active');
    syncPptComposerHint();
    if (typeof persistSettings === 'function') persistSettings();
    if (typeof renderToolList === 'function') renderToolList();
    if (typeof clearChatTask === 'function') clearChatTask(c.id);
    else {
      state.isGenerating = false;
      state.abortCtrl = null;
    }
    saveData();
    if (typeof refreshMsgNode === 'function') refreshMsgNode(msgIdx);
    else renderMessages();
    if (typeof updateSendBtn === 'function') updateSendBtn();
  }
}
