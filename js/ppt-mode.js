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
        <input type="number" id="pptSlideCount" min="1" max="60" step="1">
      </div>

      <div class="form-group">
        <label>默认主题</label>
        <select id="pptTheme">
          <option value="business_blue">商务蓝</option>
          <option value="tech_dark">科技黑</option>
          <option value="minimal_white">极简白</option>
          <option value="vibrant_orange">活力橙</option>
        </select>
      </div>

      <div class="form-group">
        <label>默认文件名</label>
        <input type="text" id="pptFilename" placeholder="generated.pptx">
        <div class="form-hint">如果不以 .pptx 结尾，后端会自动补齐。</div>
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
  document.getElementById('pptSlideCount').value = s.pptSlideCount || 8;
  document.getElementById('pptTheme').value = s.pptTheme || 'business_blue';
  document.getElementById('pptFilename').value = s.pptFilename || 'generated.pptx';
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
  const count = parseInt(document.getElementById('pptSlideCount').value, 10);
  s.pptSlideCount = Number.isFinite(count) ? Math.max(1, Math.min(60, count)) : 8;
  s.pptTheme = document.getElementById('pptTheme').value || 'business_blue';
  s.pptFilename = document.getElementById('pptFilename').value.trim() || 'generated.pptx';
  s.pptAutoPreview = !!document.getElementById('pptAutoPreview').checked;
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
  if (typeof persistSettings === 'function') persistSettings();
  if (typeof renderToolList === 'function') renderToolList();
  if (typeof updateSendBtn === 'function') updateSendBtn();
  if (typeof toast === 'function') toast(s.usePpt ? '✓ 已启用 PPT 模式：下一条消息将生成 PPT' : '✓ 已关闭 PPT 模式');
}

function buildPptModePayload(userRequest) {
  const s = state.settings || {};
  const model = (s.pptModel || s.currentModel || '').trim();
  return {
    user_request: userRequest,
    slide_count: parseInt(s.pptSlideCount, 10) || 8,
    theme: s.pptTheme || 'business_blue',
    filename: s.pptFilename || 'generated.pptx',
    llm_api_key: s.apiKey || '',
    llm_base_url: s.baseUrl || '',
    llm_model: model,
    llm_temperature: s.pptTemperature === undefined ? 0.3 : s.pptTemperature,
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

async function callAPIWithPptMode(options = {}) {
  const c = currentChat();
  if (!c) return;
  const userRequest = currentLastUserText(c).trim();
  if (!userRequest) return;

  const aiMsg = {
    role: 'assistant',
    content: '📊 正在生成 PPT…',
    _startTime: Date.now(),
    pptMode: { status: 'running' }
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
    const payload = buildPptModePayload(userRequest);
    const generated = await generatePpt(payload, { signal: ctrl.signal, source: 'ppt-mode', chatId: c.id });
    if (typeof generated === 'string') throw new Error(generated);
    if (!generated || !generated.ok) throw new Error((generated && generated.text) || 'PPT 生成失败');

    let previewText = '';
    if (state.settings.pptAutoPreview !== false && generated.path && typeof previewPpt === 'function') {
      try {
        const prev = await previewPpt({
          path: generated.path,
          rules: { min_slides: 1, require_chinese: true, max_question_marks: 0 }
        }, { signal: ctrl.signal, source: 'ppt-mode', chatId: c.id });
        if (prev && typeof prev !== 'string') {
          previewText = `\n\n🖼️ 预览：${prev.preview || prev.preview_path || prev.html || '已生成'}`;
        }
      } catch (e) {
        previewText = `\n\n⚠️ PPT 已生成，但自动预览失败：${e.message}`;
      }
    }

    aiMsg.content = `${generated.text || `✅ PPT 已生成：${generated.path}`}${previewText}`;
    aiMsg.pptMode = { status: 'done', path: generated.path, slides: generated.slides };
  } catch (e) {
    aiMsg.content = `❌ PPT 模式生成失败：${e.message || e}`;
    aiMsg.pptMode = { status: 'error', error: e.message || String(e) };
  } finally {
    aiMsg._endTime = Date.now();
    const s = state.settings || {};
    s.usePpt = false;
    if (typeof syncPptToolsWithMode === 'function') syncPptToolsWithMode(false, { render: false });
    const btn = document.getElementById('pptModeBtn');
    if (btn) btn.classList.remove('ppt-active');
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
