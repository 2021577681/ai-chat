// ============ 📊 PPT 独立模式 ============
// 顶栏按钮开启后，下一条用户消息会直接走 PPT Pipeline：
// 理解主题 → 大纲 → 页面类型 → HTML 设计稿 → 浏览器截图 → PPT 图片页 → 导出，而不是普通聊天回答。

const DEFAULT_PPT_UNDERSTAND_PROMPT = [
  '你是资深演示文稿策划总监。请理解用户要做的 PPT 主题、内容、用途、受众和语气，并为 PPT 自动命名。',
  '必须只输出 JSON 对象，不要输出解释。',
  '输出字段：title、subtitle、purpose、audience、language、tone、visual_direction、filename。',
  'filename 必须贴合主题，使用安全文件名，并以 .pptx 结尾。'
].join('\n');

const DEFAULT_PPT_OUTLINE_PROMPT = [
  '你是资深演示文稿策划专家。请根据用户需求规划 PPT 大纲。',
  '必须只输出 JSON 对象，不要输出解释。',
  '大纲要贴合主题、用途和受众；标题要具体，避免泛泛而谈。',
  '页数必须等于 target_slide_count；只规划内容结构和页面意图，不要输出任何元素坐标。'
].join('\n');

const DEFAULT_PPT_PAGE_TYPE_PROMPT = [
  '你是演示信息架构设计师。请为 PPT 大纲中的每一页确定页面类型和内容结构。',
  '必须只输出 JSON 对象，不要输出解释。',
  '页面类型是语义类型，不是固定模板限制；可使用 cover、agenda、section、concept、comparison、data_story、process、timeline、case、quote、summary、closing、freeform。',
  '输出 pages，每页包含 page、title、page_type、visual_role、content_blocks。'
].join('\n');

const DEFAULT_PPT_HTML_PROMPT = [
  '你是资深 HTML 演示页面设计师。请把大纲扩展成适合 16:9 HTML 视觉渲染的页面内容。',
  '必须只输出 JSON 对象，不要输出解释。',
  '输出字段：html，值为完整 HTML 文档。',
  'HTML 必须自包含，CSS 写在 <style> 内，不依赖外网字体、图片、脚本或第三方库。',
  '画布为 1600x900 或自适应 16:9；页面信息完整但不拥挤，文本不能明显溢出画布。',
  '视觉设计根据主题自由发挥，不要受固定 PPT 模板限制。'
].join('\n');

function normalizePptSlideCount(value) {
  const count = parseInt(value, 10);
  return Number.isFinite(count) ? Math.max(1, Math.min(50, count)) : 8;
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

function normalizePptRenderStyle(value) {
  const style = String(value || '').trim();
  return style || '由 AI 根据主题自由设计';
}

function normalizePptAestheticScoreThreshold(value) {
  const count = parseInt(value, 10);
  return Number.isFinite(count) ? Math.max(40, Math.min(95, count)) : 82;
}

function normalizePptAestheticRewriteLimit(value) {
  const count = parseInt(value, 10);
  return Number.isFinite(count) ? Math.max(0, Math.min(3, count)) : 2;
}

function pptRenderStyleLabel(style) {
  return normalizePptRenderStyle(style);
}

function sanitizePptPayloadForUi(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const apiKeyConfigured = !!String(p.llm_api_key || '').trim();
  const baseUrl = String(p.llm_base_url || '').trim();
  const apiFormat = String(p.llm_api_format || '').trim();
  const apiPath = String(p.llm_api_path || '').trim();
  const visionInterface = inferPptVisionInterface({ apiFormat, apiPath, baseUrl });
  return {
    user_request: String(p.user_request || '').slice(0, 240),
    slide_count: p.slide_count,
    render_mode: p.render_mode || 'html_image',
    render_style: p.render_style || '',
    filename: p.filename || 'AI 自动命名',
    llm_model: p.llm_model || '当前模型',
    llm_base_url: baseUrl || '未配置',
    llm_api_key_configured: apiKeyConfigured,
    llm_api_format: apiFormat || '未知',
    llm_api_path: apiPath || '',
    llm_vision_interface: visionInterface,
    llm_temperature: p.llm_temperature,
    aesthetic_score_threshold: p.aesthetic_score_threshold,
    aesthetic_rewrite_limit: p.aesthetic_rewrite_limit
  };
}

function inferPptVisionInterface(info = {}) {
  const fmt = String(info.apiFormat || '').toLowerCase();
  const path = String(info.apiPath || '').toLowerCase();
  const base = String(info.baseUrl || '').toLowerCase();
  if (fmt === 'anthropic' || path.includes('/messages') || base.includes('anthropic.com')) return 'Anthropic Messages';
  if (fmt === 'responses' || path.includes('/responses')) return 'OpenAI Responses';
  if (fmt === 'openai' || path.includes('/chat/completions')) return 'OpenAI Chat Completions';
  return '跟随当前对话格式';
}

function pptVisionInterfaceLabel(value) {
  return value || '跟随当前对话格式';
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
    progressText: 'Step 1：理解用户主题和内容...',
    startedAt: Date.now(),
    config: clean,
    steps: [
      {
        id: 'understand',
        step: 1,
        title: '主题理解',
        status: 'active',
        note: intent && intent.reason ? `${intent.reason} 正在抽取主题、用途、受众和 AI 文件名。` : '正在抽取主题、用途、受众和 AI 文件名。'
      },
      {
        id: 'outline',
        step: 2,
        title: '确认内容大纲',
        status: 'pending',
        note: `目标页数 ${clean.slide_count || '自动'} 页，确认叙事结构和每页沟通目标。`
      },
      {
        id: 'page_types',
        step: 3,
        title: '逐页确定页面类型',
        status: 'pending',
        note: '每一页都确定类型；页数较多时包含封面页、目录页和内容页。'
      },
      {
        id: 'design_recipe',
        step: 4,
        title: '选择设计配方',
        status: 'pending',
        note: '选择整套 PPT 的配色、背景、字体气质和视觉组件配方。'
      },
      {
        id: 'layout_blueprint',
        step: 5,
        title: '为每页生成布局蓝图',
        status: 'pending',
        note: '封面页和目录页背景独特；同一种类型页面背景保持一致。'
      },
      {
        id: 'html_design',
        step: 6,
        title: '生成 HTML',
        status: 'pending',
        note: '根据设计配方和布局蓝图生成自包含 16:9 HTML/CSS 页面。'
      },
      {
        id: 'aesthetic_review',
        step: 7,
        title: '审美评分与低分重写',
        status: 'pending',
        note: '检查背景层次、构图张力、色彩搭配和页面差异，低分页面自动重写。'
      },
      {
        id: 'browser_render',
        step: 8,
        title: '截图',
        status: 'pending',
        note: '用本机浏览器按 16:9 渲染 HTML 并截图为页面图片。'
      },
      {
        id: 'ppt_background',
        step: 9,
        title: '生成 PPT',
        status: 'pending',
        note: '每张截图铺满一页 PPT，因此你看到的每页就是一张图片。'
      },
      {
        id: 'export',
        step: 10,
        title: '保存 PPT',
        status: 'pending',
        note: '保存并返回 AI 自动命名的 PPT 文件路径。'
      }
    ],
    events: []
  };
}

function summarizePptValidationBrief(brief) {
  if (!brief || typeof brief !== 'object') return '';
  const bits = [];
  bits.push(brief.passed ? '通过' : '未通过');
  if (brief.score !== undefined && brief.score !== null) bits.push(`评分 ${brief.score}`);
  if (brief.issue_count) bits.push(`错误 ${brief.issue_count}`);
  if (brief.warning_count) bits.push(`警告 ${brief.warning_count}`);
  if (brief.text_overlap_count) bits.push(`文字重叠 ${brief.text_overlap_count}`);
  if (brief.text_overflow_count) bits.push(`文字溢出 ${brief.text_overflow_count}`);
  if (brief.text_graphic_overlap_count) bits.push(`图文冲突 ${brief.text_graphic_overlap_count}`);
  if (brief.visual_checked) {
    if (brief.visual_available) bits.push(`视觉${brief.visual_passed === false ? '未通过' : '通过'}`);
    else bits.push(`视觉未执行：${brief.visual_summary || '不可用'}`);
    if (brief.visual_issue_count) bits.push(`视觉问题 ${brief.visual_issue_count}`);
  }
  return bits.join(' · ');
}

function summarizePptIssues(items, max = 3) {
  if (!Array.isArray(items) || !items.length) return '';
  return items.slice(0, max).map((item, i) => {
    if (!item || typeof item !== 'object') return `${i + 1}. ${String(item)}`;
    const slide = item.slide || item.page ? `第${item.slide || item.page}页` : '全局';
    const kind = item.kind || item.type || item.severity || '问题';
    const msg = item.message || item.description || item.summary || '';
    return `${i + 1}. ${slide} ${kind}：${msg}`;
  }).join('；');
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

function isPptDoneLikeStatus(status) {
  return status === 'done' || status === 'warning' || status === 'skipped' || status === 'error';
}

function finishPptRunningCalls(step, status = 'done', result) {
  if (!step || !Array.isArray(step.calls)) return;
  step.calls.forEach(call => {
    if (!call || call.status !== 'running') return;
    call.status = status;
    if (result !== undefined && !call.result) call.result = result;
    if (!call.finishedAt) call.finishedAt = Date.now();
  });
}

function finishPptPreviousActiveSteps(ppt, activeId) {
  if (!ppt || !Array.isArray(ppt.steps)) return;
  const activeStep = pptStep(ppt, activeId);
  const activeOrder = activeStep && Number(activeStep.step || 0);
  ppt.steps.forEach(step => {
    if (!step || step.id === activeId) return;
    if (step.status !== 'active' && step.status !== 'running') return;
    const stepOrder = Number(step.step || 0);
    if (!activeOrder || !stepOrder || stepOrder < activeOrder) {
      step.status = 'done';
      step.updatedAt = Date.now();
      finishPptRunningCalls(step, 'done', step.note || '已完成。');
    }
  });
}

function setPptOnlyActive(ppt, id, note, meta) {
  if (!ppt || !Array.isArray(ppt.steps)) return;
  finishPptPreviousActiveSteps(ppt, id);
  setPptStep(ppt, id, 'active', note, meta);
}

function summarizePptTitles(items, max = 4) {
  if (!Array.isArray(items) || !items.length) return '';
  return items.slice(0, max).map(x => x && x.title).filter(Boolean).join(' / ') + (items.length > max ? '...' : '');
}

function estimatePptTextLength(items) {
  try { return JSON.stringify(items || []).length; }
  catch (_) { return 0; }
}

function applyPptPipelineDetails(ppt, generated) {
  if (!ppt || !generated || typeof generated !== 'object') return;
  const pipeline = generated.pipeline && typeof generated.pipeline === 'object' ? generated.pipeline : {};
  if (pipeline.intent && typeof pipeline.intent === 'object') {
    const intent = pipeline.intent;
    setPptStep(ppt, 'understand', 'done', `已理解主题“${intent.title || generated.title || '未命名'}”，用途：${intent.purpose || '未指定'}，受众：${intent.audience || '未指定'}；PPT 文件名由 AI 命名。`, {
      title: intent.title || generated.title || '',
      purpose: intent.purpose || '',
      audience: intent.audience || '',
      filename: intent.filename || generated.filename || ''
    });
  }
  const outline = Array.isArray(pipeline.outline) ? pipeline.outline : [];
  if (outline.length) {
    setPptStep(ppt, 'outline', 'done', `已确认 ${outline.length} 页内容大纲：${outline.slice(0, 4).map(x => x.title).filter(Boolean).join(' / ')}${outline.length > 4 ? '...' : ''}。`, {
      pages: outline.length,
      titles: summarizePptTitles(outline),
      detail_chars: estimatePptTextLength(outline),
      outline
    });
    const outlineStep = pptStep(ppt, 'outline');
    if (outlineStep) outlineStep.calls = [{ name: 'confirm_outline', status: 'done', args: { pages: outline.length }, result: `已确认 ${outline.length} 页：${summarizePptTitles(outline)}` }];
  }
  const pageTypes = Array.isArray(pipeline.page_types) ? pipeline.page_types : [];
  if (pageTypes.length) {
    const categories = pageTypes.reduce((acc, x) => { const k = x.page_category || 'content'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    setPptStep(ppt, 'page_types', 'done', `已逐页确定 ${pageTypes.length} 页类型：封面 ${categories.cover || 0} 页，目录 ${categories.agenda || 0} 页，内容 ${categories.content || 0} 页。`, {
      pages: pageTypes.length,
      categories,
      page_types: pageTypes.map(x => x.page_type || x.type || '').filter(Boolean).join(' / ')
    });
  }
  if (pipeline.design_system && typeof pipeline.design_system === 'object') {
    setPptStep(ppt, 'design_recipe', 'done', `已选择设计配方：${pipeline.design_system.theme_name || 'custom'}。`, pipeline.design_system);
  }
  const blueprints = Array.isArray(pipeline.layout_blueprints) ? pipeline.layout_blueprints : [];
  if (blueprints.length) {
    setPptStep(ppt, 'layout_blueprint', 'done', `已生成 ${blueprints.length} 页布局蓝图，封面/目录使用独特背景，内容页背景保持一致。`, { pages: blueprints.length });
  }
  const htmlPages = Array.isArray(generated.html_pages) ? generated.html_pages : [];
  const images = Array.isArray(generated.images) ? generated.images : [];
  if (htmlPages.length || images.length || generated.render_mode === 'html_image') {
    setPptStep(ppt, 'html_design', 'done', `已生成 ${htmlPages.length || generated.slides || outline.length || ''} 页 HTML/CSS 设计稿。`, {
      pages: htmlPages.length || generated.slides || outline.length || '',
      mode: generated.render_mode || 'html_image',
      html_dir: generated.html_dir || ''
    });
    const q = pipeline.quality_report && typeof pipeline.quality_report === 'object' ? pipeline.quality_report : null;
    if (q) {
      setPptStep(ppt, 'aesthetic_review', q.passed === false ? 'warning' : 'done', `审美评分完成，重写 ${q.rewrite_count || 0} 次${Array.isArray(q.pages) ? `，共 ${q.pages.length} 页` : ''}。`, q);
    }
    setPptStep(ppt, 'browser_render', images.length ? (generated.renderer === 'pillow_fallback' ? 'warning' : 'done') : 'warning', images.length
      ? `已按 16:9 渲染并截图 ${images.length} 页${generated.renderer === 'pillow_fallback' ? '（浏览器不可用，已用图片兜底跑通）' : ''}。`
      : '未返回截图明细，但后端已进入 HTML 图片渲染流程。', { pages: images.length || '', image_dir: generated.image_dir || '', renderer: generated.renderer || '' });
    if (images.length) {
      setPptStep(ppt, 'ppt_background', 'done', `已将 ${images.length} 张图片逐页铺满插入 PPT。`, { pages: images.length });
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

function pptStageToStepId(stage) {
  const key = String(stage || '').trim();
  const map = {
    init: 'understand',
    understand: 'understand',
    outline: 'outline',
    page_types: 'page_types',
    page_type: 'page_types',
    design_recipe: 'design_recipe',
    recipe: 'design_recipe',
    layout_blueprint: 'layout_blueprint',
    blueprint: 'layout_blueprint',
    html: 'html_design',
    html_design: 'html_design',
    aesthetic_review: 'aesthetic_review',
    quality_review: 'aesthetic_review',
    review: 'aesthetic_review',
    render: 'browser_render',
    browser_render: 'browser_render',
    assemble: 'ppt_background',
    ppt_background: 'ppt_background',
    saved: 'export',
    export: 'export'
  };
  return map[key] || key;
}

function addPptStepCall(ppt, stepId, event) {
  return ensurePptStepCall(ppt, pptStageToStepId(stepId), event && event.name, event && (event.key || event.id || event.name), event || {});
}

function finishPptEvent(event, patch = {}) {
  if (!event) return;
  Object.assign(event, patch);
  if (!event.finishedAt) event.finishedAt = Date.now();
}

function ensurePptStepCall(ppt, stepId, name, key, patch = {}) {
  const step = pptStep(ppt, stepId);
  if (!step) return null;
  if (!Array.isArray(step.calls)) step.calls = [];
  const callKey = key || name;
  let call = step.calls.find(x => x && x._key === callKey);
  if (!call) {
    call = { _key: callKey, name: name || callKey, status: patch.status || 'running', args: {}, result: '' };
    step.calls.push(call);
  }
  Object.assign(call, patch);
  return call;
}

function isPptSavedProgressEvent(ev, mappedStepId) {
  const stage = String((ev && ev.stage) || '').trim();
  const message = String((ev && ev.message) || '').trim();
  return mappedStepId === 'export' && (stage === 'saved' || message.includes('PPTX 文件已保存'));
}

function applyPptProgressEvent(ppt, ev) {
  if (!ppt || !ev || typeof ev !== 'object') return;
  const stepId = ev.step || ev.stage || '';
  const detail = ev.detail && typeof ev.detail === 'object' ? ev.detail : {};
  if (ev.type === 'task_started') {
    ppt.taskId = ev.task_id || (ev.snapshot && ev.snapshot.task_id) || ppt.taskId;
    return;
  }
  if (ev.type === 'task' || ev.type === 'task_control') {
    const mappedStepId = pptStageToStepId(stepId || ev.stage || ev.type);
    if (ev.status === 'paused') {
      ppt.status = 'paused';
      ppt.progressText = ev.message || 'PPT 任务已暂停，可恢复执行。';
    } else if (ev.status === 'running') {
      ppt.status = 'running';
      ppt.progressText = ev.message || ppt.progressText;
    }
    const savedDone = isPptSavedProgressEvent(ev, mappedStepId);
    const status = ev.status === 'paused' ? 'warning' : (ev.status === 'error' ? 'error' : (ev.status === 'running' && !savedDone ? 'running' : 'done'));
    ensurePptStepCall(ppt, mappedStepId, ev.stage || ev.type, `${mappedStepId}:${ev.stage || ev.type}:task`, { status, args: detail, result: ev.message || '' });
    const step = pptStep(ppt, mappedStepId);
    if (step && savedDone) {
      setPptStep(ppt, mappedStepId, 'done', ev.message || 'PPTX 文件已保存。', detail);
      finishPptRunningCalls(step, 'done', ev.message || 'PPTX 文件已保存。');
      ppt.progressText = ev.message || ppt.progressText;
    } else if (step && ev.status === 'running') {
      setPptOnlyActive(ppt, mappedStepId, ev.message || step.note, detail);
    }
    return;
  }
  if (!stepId) return;
  if (ev.type === 'step_start') {
    const mappedStepId = pptStageToStepId(stepId);
    setPptOnlyActive(ppt, mappedStepId, ev.message || '正在执行...', detail);
    ppt.progressText = ev.message || ppt.progressText;
    ensurePptStepCall(ppt, mappedStepId, stepId, `${mappedStepId}:${stepId}:main`, { status: 'running', args: detail, result: ev.message || '' });
    return;
  }
  if (ev.type === 'step_done') {
    const mappedStepId = pptStageToStepId(stepId);
    const status = mappedStepId === 'browser_render' && detail.renderer === 'pillow_fallback' ? 'warning' : 'done';
    setPptStep(ppt, mappedStepId, status, ev.message || '已完成。', detail);
    ensurePptStepCall(ppt, mappedStepId, stepId, `${mappedStepId}:${stepId}:main`, { status, args: detail, result: ev.message || '已完成。' });
    finishPptRunningCalls(pptStep(ppt, mappedStepId), status, ev.message || '已完成。');
    ppt.progressText = ev.message || ppt.progressText;
    if (mappedStepId === 'export' && detail.path) ppt.path = detail.path;
    return;
  }
  if (ev.type === 'substep') {
    const page = detail.page || '';
    const name = ev.name || 'substep';
    const mappedStepId = pptStageToStepId(stepId);
    const key = `${mappedStepId}:${name}:${page || Date.now()}`;
    const status = ev.status || 'running';
    ensurePptStepCall(ppt, mappedStepId, name, key, { status, args: detail, result: ev.message || '' });
    const step = pptStep(ppt, mappedStepId);
    if (step && status === 'running') {
      step.status = 'active';
      step.note = ev.message || step.note;
      step.updatedAt = Date.now();
    }
    ppt.progressText = ev.message || ppt.progressText;
  }
}

function applyPptTaskSnapshot(ppt, snap) {
  if (!ppt || !snap) return;
  ppt.taskId = snap.task_id || ppt.taskId;
  (snap.events || []).forEach(ev => applyPptProgressEvent(ppt, ev));
  if (snap.status === 'paused') ppt.status = 'paused';
}

function refreshPptModeMessage(msgIdx, chat, options = {}) {
  const c = chat || currentChat();
  const msg = c && c.messages && c.messages[msgIdx];
  const full = !!options.full;
  const inner = document.getElementById('messagesInner');
  const existingPanel = inner && inner.querySelector(`.message[data-idx="${msgIdx}"] .ppt-panel`);
  if (!full && msg && msg.pptMode && existingPanel) {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderPptPanel(msg, msgIdx);
    const newPanel = tmp.firstElementChild;
    if (newPanel) {
      existingPanel.replaceWith(newPanel);
      if (typeof postRender === 'function') postRender(newPanel);
    }
  } else if (typeof refreshMsgNode === 'function') refreshMsgNode(msgIdx, chat);
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
        开启顶栏 <strong>PPT</strong> 后，下一条消息会按“Step 1 理解主题 → Step 2 生成大纲 → Step 3 确定页面类型 → Step 5 生成 HTML → Step 6 浏览器截图 → Step 7 图片铺入 PPT → Step 9 导出”的流程生成 .pptx。当前阶段不限制模板，让 AI 根据主题自由设计；PPT 文件名由 AI 自动命名。
      </div>

      <div class="form-group">
        <label>默认页数</label>
        <input type="number" id="pptSlideCount" min="1" max="50" step="1">
        <div class="form-hint">只控制目标页数，不限制模板；AI 会根据主题安排叙事和视觉形式。</div>
      </div>

      <div class="form-group">
        <label>视觉风格偏好（可选）</label>
        <input type="text" id="pptRenderStyle" placeholder="留空则由 AI 根据主题自由设计，例如：科技感、极简商务、活泼教育风">
        <div class="form-hint">不是模板限制，只是给 HTML/CSS 设计稿的风格参考。</div>
      </div>

      <div class="form-group">
        <label>PPT 规划模型（可选）</label>
        <input type="text" id="pptModel" placeholder="留空则使用当前模型">
      </div>

      <div class="form-group">
        <label>PPT 规划温度</label>
        <div class="slider-row">
          <input type="range" id="pptTemperature" min="0" max="1" step="0.1" oninput="document.getElementById('pptTemperatureVal').textContent=this.value">
          <span class="slider-val" id="pptTemperatureVal">0.6</span>
        </div>
      </div>

      <div class="form-group">
        <label>审美评分阈值</label>
        <input type="number" id="pptAestheticScoreThreshold" min="40" max="95" step="1">
        <div class="form-hint">默认 82。生成 HTML 后低于该分数会进入低分重写；值越高越严格，但耗时和重写概率也会增加。</div>
      </div>

      <div class="form-group">
        <label>低分重写次数</label>
        <input type="number" id="pptAestheticRewriteLimit" min="0" max="3" step="1">
        <div class="form-hint">默认 2。每页最多自动重写次数；0 表示只评分不重写，最大 3。</div>
      </div>

      <hr style="margin:14px 0;border:none;border-top:1px solid var(--border);">
      <h3 style="font-size:14px;margin:0 0 12px;display:flex;align-items:center;gap:6px;">可编辑 Prompt</h3>

      <div class="form-group">
        <label>Step 1：理解主题 Prompt</label>
        <textarea id="pptUnderstandPrompt" rows="5" placeholder="留空使用默认理解提示词"></textarea>
        <div class="form-hint">控制“用户需求 → 主题、用途、受众、视觉方向、AI 文件名”的理解方式。</div>
      </div>

      <div class="form-group">
        <label>Step 2：PPT 大纲 Prompt</label>
        <textarea id="pptOutlinePrompt" rows="5" placeholder="留空使用默认大纲规划提示词"></textarea>
        <div class="form-hint">控制“用户需求 → PPT 大纲”的规划方式。</div>
      </div>

      <div class="form-group">
        <label>Step 3：页面类型 Prompt</label>
        <textarea id="pptPageTypePrompt" rows="5" placeholder="留空使用默认页面类型提示词"></textarea>
        <div class="form-hint">控制“大纲 → 每页语义类型和内容模块”的生成方式。</div>
      </div>

      <div class="form-group">
        <label>Step 5：HTML 设计 Prompt</label>
        <textarea id="pptHtmlPrompt" rows="6" placeholder="留空使用默认 HTML 页面设计提示词"></textarea>
        <div class="form-hint">控制“页面类型 → 16:9 HTML/CSS 设计稿”的生成方式。</div>
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
  document.getElementById('pptSlideCount').value = normalizePptSlideCount(s.pptSlideCount || 8);
  document.getElementById('pptRenderStyle').value = s.pptRenderStyle || '';
  document.getElementById('pptModel').value = s.pptModel || '';
  const temp = s.pptTemperature === undefined ? 0.6 : Number(s.pptTemperature);
  document.getElementById('pptTemperature').value = Number.isFinite(temp) ? temp : 0.6;
  document.getElementById('pptTemperatureVal').textContent = document.getElementById('pptTemperature').value;
  document.getElementById('pptAestheticScoreThreshold').value = normalizePptAestheticScoreThreshold(s.pptAestheticScoreThreshold);
  document.getElementById('pptAestheticRewriteLimit').value = normalizePptAestheticRewriteLimit(s.pptAestheticRewriteLimit);
  document.getElementById('pptUnderstandPrompt').value = s.pptUnderstandPrompt || DEFAULT_PPT_UNDERSTAND_PROMPT;
  document.getElementById('pptOutlinePrompt').value = s.pptOutlinePrompt || DEFAULT_PPT_OUTLINE_PROMPT;
  document.getElementById('pptPageTypePrompt').value = s.pptPageTypePrompt || DEFAULT_PPT_PAGE_TYPE_PROMPT;
  document.getElementById('pptHtmlPrompt').value = s.pptHtmlPrompt || s.pptSlidePrompt || DEFAULT_PPT_HTML_PROMPT;
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
  s.pptRenderStyle = document.getElementById('pptRenderStyle').value.trim();
  s.pptModel = document.getElementById('pptModel').value.trim();
  const temp = parseFloat(document.getElementById('pptTemperature').value);
  s.pptTemperature = Number.isFinite(temp) ? temp : 0.6;
  s.pptAestheticScoreThreshold = normalizePptAestheticScoreThreshold(document.getElementById('pptAestheticScoreThreshold').value);
  s.pptAestheticRewriteLimit = normalizePptAestheticRewriteLimit(document.getElementById('pptAestheticRewriteLimit').value);
  s.pptUnderstandPrompt = document.getElementById('pptUnderstandPrompt').value.trim();
  s.pptOutlinePrompt = document.getElementById('pptOutlinePrompt').value.trim();
  s.pptPageTypePrompt = document.getElementById('pptPageTypePrompt').value.trim();
  s.pptHtmlPrompt = document.getElementById('pptHtmlPrompt').value.trim();
  s.pptSlidePrompt = s.pptHtmlPrompt;
  if (typeof persistSettings === 'function') persistSettings();
  closePptSettings();
  if (typeof toast === 'function') toast('✓ PPT 设置已保存');
}

function resetPptPromptsToDefault() {
  const understand = document.getElementById('pptUnderstandPrompt');
  const outline = document.getElementById('pptOutlinePrompt');
  const pageType = document.getElementById('pptPageTypePrompt');
  const html = document.getElementById('pptHtmlPrompt');
  if (understand) understand.value = DEFAULT_PPT_UNDERSTAND_PROMPT;
  if (outline) outline.value = DEFAULT_PPT_OUTLINE_PROMPT;
  if (pageType) pageType.value = DEFAULT_PPT_PAGE_TYPE_PROMPT;
  if (html) html.value = DEFAULT_PPT_HTML_PROMPT;
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
  return {
    user_request: userRequest,
    slide_count: normalizePptSlideCount(s.pptSlideCount),
    render_mode: 'html_image',
    render_style: s.pptRenderStyle || '',
    llm_api_key: s.apiKey || '',
    llm_base_url: s.baseUrl || '',
    llm_api_format: s.apiFormat || '',
    llm_api_path: s.apiPath || '',
    llm_json_headers: s.jsonHeaders || '{}',
    llm_max_tokens: Math.max(parseInt(s.maxTokens || 0, 10) || 0, 4096),
    llm_model: model,
    llm_temperature: s.pptTemperature === undefined ? 0.6 : s.pptTemperature,
    aesthetic_score_threshold: normalizePptAestheticScoreThreshold(s.pptAestheticScoreThreshold),
    aesthetic_rewrite_limit: normalizePptAestheticRewriteLimit(s.pptAestheticRewriteLimit),
    ppt_understand_prompt: s.pptUnderstandPrompt || '',
    ppt_outline_prompt: s.pptOutlinePrompt || '',
    ppt_page_type_prompt: s.pptPageTypePrompt || '',
    ppt_html_prompt: s.pptHtmlPrompt || s.pptSlidePrompt || '',
    ppt_slide_prompt: s.pptHtmlPrompt || s.pptSlidePrompt || ''
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
  else if (ppt.status === 'paused') statusBadge = '<span class="outline-status-badge paused">已暂停</span>';
  else statusBadge = '<span class="outline-status-badge paused">待处理</span>';

  const controlHtml = ppt.taskId && (ppt.status === 'paused' || ppt.status === 'running') ? `
    <div class="ppt-task-controls" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;">
      ${ppt.status === 'paused' ? `<button class="btn mini" onclick="resumePptTaskFromPanel(${idx})">继续执行</button>` : `<button class="btn mini" onclick="pausePptTaskFromPanel(${idx})">暂停</button>`}
      <button class="btn mini danger" onclick="cancelPptTaskFromPanel(${idx})">取消任务</button>
      <span class="form-hint">任务ID：${escapeHtml(ppt.taskId || '')}</span>
    </div>` : '';

  const stats = [
    `${doneCount}/${total} 步`,
    ppt.slides ? `${ppt.slides} 页` : '',
    ppt.path ? ppt.path : ''
  ].filter(Boolean).join(' · ');

  const stepHtml = `<ol class="outline-item-list ppt-step-list">${steps.map((step, i) => {
    const status = step.status || 'pending';
    const itemClass = status === 'active' || status === 'running' ? 'active' : status;
    const displayStep = step.step || i + 1;
    const meta = step.meta && typeof step.meta === 'object'
      ? Object.entries(step.meta).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => {
          const label = { path: '文件', slides: '页数', pages: '页数', titles: '标题', detail_chars: '结构大小', html: 'HTML', html_dir: 'HTML目录', image_dir: '图片目录', mode: '模式', renderer: '渲染器', model: '模型', base_url: 'Base URL', api_key: 'API Key', api_format: '接口格式', api_path: '接口路径', title: '标题', purpose: '用途', audience: '受众', filename: '文件名', page_types: '页面类型', request_chars: '请求长度', target_slides: '目标页数' }[key] || key;
          if (key === 'outline') return '';
          const shown = Array.isArray(value) ? value.join(' ｜ ') : (value === true ? '是' : (value === false ? '否' : String(value)));
          return `<span>${escapeHtml(label)}：${escapeHtml(shown)}</span>`;
        }).filter(Boolean).join('')
      : '';
    const calls = Array.isArray(step.calls) ? step.calls : [];
    return `
      <li class="outline-item ppt-step ${itemClass}" data-step-id="${escapeHtml(step.id || String(i + 1))}">
        <div class="outline-item-main">
          <div class="outline-item-header">
            <span class="outline-item-id">${escapeHtml(String(displayStep))}</span>
            <span class="outline-item-title">${escapeHtml(step.title || 'PPT 步骤')}</span>
          </div>
          ${step.note ? `<div class="outline-item-note">${escapeHtml(step.note)}</div>` : ''}
          ${meta ? `<div class="ppt-step-meta">${meta}</div>` : ''}
          ${calls.length ? `<div class="outline-tool-calls ppt-step-calls">${calls.map(call => {
            const callArgsStr = JSON.stringify(call.args || {});
            const callArgsShort = callArgsStr.length > 100 ? callArgsStr.slice(0, 100) + '...' : callArgsStr;
            const callResult = String(call.result || '');
            const callResultShort = callResult.length > 260 ? callResult.slice(0, 260) + '...' : callResult;
            const callStatus = call.status || 'done';
            const callCls = callStatus === 'running' ? 'running' : (callStatus === 'error' ? 'error' : (callStatus === 'warning' ? 'warning' : (callStatus === 'pending' ? 'pending' : 'success')));
            const callIcon = callStatus === 'running' ? '<span class="outline-tool-spin"></span>' : (callStatus === 'error' ? '!' : (callStatus === 'warning' ? '!' : (callStatus === 'pending' ? '…' : 'OK')));
            return `<div class="outline-tool-call ppt-step-call ${callCls}">
              <div class="outline-tool-head">
                <span class="outline-tool-icon">${callIcon}</span>
                <span class="outline-tool-name">${escapeHtml(call.name || 'PPT 子步骤')}</span>
                <span class="outline-tool-args" title="${escapeHtml(callArgsStr)}">${escapeHtml(callArgsShort)}</span>
              </div>
              ${callResult ? `<div class="outline-tool-result">${escapeHtml(callResultShort)}</div>` : ''}
            </div>`;
          }).join('')}</div>` : ''}
        </div>
      </li>`;
  }).join('')}</ol>`;

  const config = ppt.config || {};
  const llmConfigHtml = `<div class="outline-tool-call ppt-llm-config ${config.llm_api_key_configured ? 'success' : 'warning'}">
    <div class="outline-tool-head"><span class="outline-tool-icon">${config.llm_api_key_configured ? 'OK' : '!'}</span><span class="outline-tool-name">LLM 配置</span><span class="outline-tool-args">已读取当前对话模型</span></div>
    <div class="outline-tool-result">模型：${escapeHtml(config.llm_model || '当前模型')}\nBase URL：${escapeHtml(config.llm_base_url || '未配置')}\nAPI Key：${escapeHtml(config.llm_api_key_configured ? '已配置' : '未配置')}\n接口格式：${escapeHtml(config.llm_api_format || '未知')}\n视觉接口：${escapeHtml(pptVisionInterfaceLabel(config.llm_vision_interface))}</div>
  </div>`;
  const configHtml = `
    <div class="ppt-config-grid">
      <span>渲染：HTML → 16:9 图片</span>
      <span>风格：${escapeHtml(pptRenderStyleLabel(config.render_style))}</span>
      <span>审美阈值：${escapeHtml(String(config.aesthetic_score_threshold || 82))}</span>
      <span>低分重写：${escapeHtml(String(config.aesthetic_rewrite_limit ?? 2))} 次</span>
      <span>模型：${escapeHtml(config.llm_model || '当前模型')}</span>
      <span>命名：${escapeHtml(config.filename || 'AI 自动命名')}</span>
    </div>`;

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
          <div class="outline-section-header">PPT 图片页流程 ${statusBadge}</div>
          <div class="outline-section-body">
            ${total ? `<div class="outline-progress-bar"><div class="outline-progress-fill" style="width:${pct}%;"></div></div>` : ''}
            ${configHtml}
            ${controlHtml}
            ${llmConfigHtml}
            ${stepHtml}
          </div>
        </div>
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

async function resumePptTaskFromPanel(idx) {
  const c = currentChat();
  const msg = c && c.messages && c.messages[idx];
  if (!msg || !msg.pptMode || !msg.pptMode.taskId) return;
  const taskId = msg.pptMode.taskId;
  msg.pptMode.status = 'running';
  msg.pptMode.inProgress = true;
  msg.pptMode.progressText = '正在恢复 PPT 任务...';
  refreshPptModeMessage(idx, c);
  await controlPptTask(taskId, 'resume', { skipConfirm: true });
  let since = 0;
  try {
    while (true) {
      const snap = await pollPptTask(taskId, since, { skipConfirm: true });
      if (!snap || !snap.ok) throw new Error((snap && snap.error) || 'PPT 任务轮询失败');
      since = snap.progress_index || since;
      applyPptTaskSnapshot(msg.pptMode, snap);
      refreshPptModeMessage(idx, c);
      if (snap.status === 'done') {
        const generated = snap.result || {};
        applyPptPipelineDetails(msg.pptMode, generated);
        msg.content = generated.message || generated.text || `✅ PPT 已生成：${generated.path || ''}`;
        msg.pptMode.status = 'done';
        msg.pptMode.inProgress = false;
        refreshPptModeMessage(idx, c);
        return;
      }
      if (snap.status === 'error' || snap.status === 'cancelled') throw new Error(snap.error || 'PPT 任务已结束');
      if (snap.status === 'paused') return;
      await new Promise(resolve => setTimeout(resolve, 900));
    }
  } catch (e) {
    msg.pptMode.status = 'error';
    msg.pptMode.error = e.message || String(e);
    msg.pptMode.inProgress = false;
    refreshPptModeMessage(idx, c);
  }
}

async function pausePptTaskFromPanel(idx) {
  const c = currentChat(); const msg = c && c.messages && c.messages[idx];
  if (msg && msg.pptMode && msg.pptMode.taskId) await controlPptTask(msg.pptMode.taskId, 'pause', { skipConfirm: true });
}

async function cancelPptTaskFromPanel(idx) {
  const c = currentChat(); const msg = c && c.messages && c.messages[idx];
  if (msg && msg.pptMode && msg.pptMode.taskId && confirm('确定取消这个 PPT 后端任务吗？取消后不能恢复。')) await controlPptTask(msg.pptMode.taskId, 'cancel', { skipConfirm: true });
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
    setPptOnlyActive(aiMsg.pptMode, 'understand', '正在理解用户主题、内容、用途、受众和页数，并由 AI 命名 PPT。', {
      request_chars: userRequest.length,
      target_slides: payload.slide_count,
      model: payload.llm_model || '当前模型',
      base_url: payload.llm_base_url || '未配置',
      api_key: payload.llm_api_key ? '已配置' : '未配置'
    });
    aiMsg.pptMode.progressText = 'Step 1：理解用户主题和内容...';
    const generateEvent = addPptStepCall(aiMsg.pptMode, 'understand', {
      key: 'pipeline:start',
      name: 'run_image_ppt_pipeline',
      status: 'running',
      args: sanitizePptPayloadForUi(payload),
      result: '等待后端完成：理解主题 / 大纲 / 页面类型 / HTML / 浏览器截图 / 图片铺入 PPT / 导出。'
    });
    const intentEvent = addPptStepCall(aiMsg.pptMode, 'understand', {
      key: 'understand:intent',
      name: 'step_1_understand',
      status: 'running',
      args: { request_chars: userRequest.length, target_slides: payload.slide_count, render_mode: payload.render_mode },
      result: '等待 generate_ppt 返回后回填理解结果...'
    });
    const outlineEvent = addPptStepCall(aiMsg.pptMode, 'outline', {
      key: 'outline:plan',
      name: 'step_2_outline',
      status: 'pending',
      args: { target_slides: payload.slide_count, prompt: payload.ppt_outline_prompt ? '自定义' : '默认' },
      result: '等待大纲规划结果...'
    });
    const pageTypeEvent = addPptStepCall(aiMsg.pptMode, 'page_types', {
      key: 'page_types:plan',
      name: 'step_3_page_types',
      status: 'pending',
      args: { target_slides: payload.slide_count, prompt: payload.ppt_page_type_prompt ? '自定义' : '默认' },
      result: '等待每页页面类型规划结果...'
    });
    const htmlEvent = addPptStepCall(aiMsg.pptMode, 'html_design', {
      key: 'html_design:generate',
      name: 'step_5_html_design',
      status: 'pending',
      args: { target_slides: payload.slide_count, prompt: payload.ppt_html_prompt ? '自定义' : '默认' },
      result: '等待 HTML 设计稿、截图和 PPT 导出结果...'
    });
    setPptStep(aiMsg.pptMode, 'understand', 'active', '后端 generate_ppt 请求已发出：正在执行 Step 1，并会继续完成后续图片页流程。', {
      request_chars: userRequest.length,
      target_slides: payload.slide_count
    });
    setPptStep(aiMsg.pptMode, 'outline', 'pending', '等待 Step 1 完成后生成 PPT 大纲。');
    setPptStep(aiMsg.pptMode, 'page_types', 'pending', '等待 Step 2 完成后确定每页页面类型。');
    refreshPptModeMessage(msgIdx, c);

    const generated = await generatePptWithProgress(payload, {
      signal: ctrl.signal,
      source: 'ppt-mode',
      chatId: c.id,
      skipConfirm: true,
      isStopped: () => {
        const t = typeof chatTaskById === 'function' ? chatTaskById(c.id) : null;
        return !!(t && t.stopRequested) || !!state.stopRequested;
      },
      onProgress: ev => {
        applyPptTaskSnapshot(aiMsg.pptMode, ev.snapshot || { events: [ev], task_id: ev.task_id });
        refreshPptModeMessage(msgIdx, c);
      }
    });
    if (typeof generated === 'string') throw new Error(generated);
    if (generated && generated.paused) {
      aiMsg.pptMode.status = 'paused';
      aiMsg.pptMode.inProgress = false;
      aiMsg.content = '⏸️ PPT 任务已暂停，可在卡片中点击“继续执行”。';
      refreshPptModeMessage(msgIdx, c);
      return;
    }
    if (!generated || !generated.ok) {
      finishPptEvent(generateEvent, {
        status: 'error',
        ok: false,
        result: (generated && (generated.text || generated.error || generated.message)) || 'PPT 生成失败'
      });
      throw new Error((generated && (generated.text || generated.error || generated.message)) || 'PPT 生成失败');
    }
    applyPptPipelineDetails(aiMsg.pptMode, generated);
    const pipeline = generated.pipeline || {};
    const outlineForEvents = Array.isArray(pipeline.outline) ? pipeline.outline : [];
    const pageTypesForEvents = Array.isArray(pipeline.page_types) ? pipeline.page_types : [];
    const htmlPagesForEvents = Array.isArray(generated.html_pages) ? generated.html_pages : [];
    const imagesForEvents = Array.isArray(generated.images) ? generated.images : [];
    if (outlineEvent && outlineEvent.status === 'pending') outlineEvent.status = 'running';
    if (pageTypeEvent && pageTypeEvent.status === 'pending') pageTypeEvent.status = 'running';
    if (htmlEvent && htmlEvent.status === 'pending') htmlEvent.status = 'running';
    finishPptEvent(intentEvent, { status: 'done', ok: true, result: pipeline.intent ? `已理解：${pipeline.intent.title || '未命名'}；用途 ${pipeline.intent.purpose || '-'}；受众 ${pipeline.intent.audience || '-'}；文件名 ${generated.filename || pipeline.intent.filename || 'AI 自动命名'}` : '已完成主题和内容理解。' });
    finishPptEvent(outlineEvent, { status: outlineForEvents.length ? 'done' : 'warning', ok: !!outlineForEvents.length, result: outlineForEvents.length ? `已规划 ${outlineForEvents.length} 页：${summarizePptTitles(outlineForEvents)}` : '未返回可展示的大纲明细。' });
    finishPptEvent(pageTypeEvent, { status: pageTypesForEvents.length ? 'done' : 'warning', ok: !!pageTypesForEvents.length, result: pageTypesForEvents.length ? `已确定 ${pageTypesForEvents.length} 页页面类型。` : '未返回页面类型明细。' });
    finishPptEvent(htmlEvent, { status: htmlPagesForEvents.length ? 'done' : 'warning', ok: !!htmlPagesForEvents.length, result: htmlPagesForEvents.length ? `已生成 ${htmlPagesForEvents.length} 页 HTML 设计稿，并进入截图/PPT 导出。` : '未返回 HTML 设计稿明细。' });
    finishPptEvent(generateEvent, {
      status: 'done',
      ok: true,
      result: generated.text || generated.message || `PPT 已生成：${generated.path || '-'}`
    });
    if (pptStep(aiMsg.pptMode, 'outline') && pptStep(aiMsg.pptMode, 'outline').status !== 'done') {
      setPptStep(aiMsg.pptMode, 'outline', 'done', `已完成 PPT 大纲规划，目标页数 ${generated.slides || payload.slide_count || '-'} 页。`);
    }
    if (pptStep(aiMsg.pptMode, 'page_types') && pptStep(aiMsg.pptMode, 'page_types').status !== 'done') {
      setPptStep(aiMsg.pptMode, 'page_types', 'done', '已确定每页页面类型和内容结构。');
    }
    if (pptStep(aiMsg.pptMode, 'html_design') && pptStep(aiMsg.pptMode, 'html_design').status === 'pending') {
      setPptStep(aiMsg.pptMode, 'html_design', 'done', `已生成 HTML 设计稿：${generated.html_dir || '-'}`, { html_dir: generated.html_dir || '', pages: htmlPagesForEvents.length || generated.slides || '' });
    }
    if (pptStep(aiMsg.pptMode, 'browser_render') && pptStep(aiMsg.pptMode, 'browser_render').status === 'pending') {
      setPptStep(aiMsg.pptMode, 'browser_render', generated.renderer === 'pillow_fallback' ? 'warning' : 'done', `已渲染 16:9 页面图片：${generated.image_dir || '-'}`, { image_dir: generated.image_dir || '', pages: imagesForEvents.length || generated.slides || '', renderer: generated.renderer || '' });
    }
    setPptStep(
      aiMsg.pptMode,
      'ppt_background',
      'done',
      `已将 ${generated.slides || imagesForEvents.length || '-'} 张图片插入 PPT，每页铺满一张图。`,
      { path: generated.path, slides: generated.slides }
    );
    refreshPptModeMessage(msgIdx, c);

    aiMsg.content = `${generated.text || generated.message || `✅ PPT 已按图片页流程生成：${generated.path}`}`;
    setPptStep(aiMsg.pptMode, 'export', 'done', `已导出 PPT 文件：${generated.path || '-'}`, { path: generated.path, slides: generated.slides, filename: generated.filename || '' });
    finishPptRunningCalls(pptStep(aiMsg.pptMode, 'export'), 'done', `已导出 PPT 文件：${generated.path || '-'}`);
    aiMsg.pptMode.status = 'done';
    aiMsg.pptMode.path = generated.path;
    aiMsg.pptMode.slides = generated.slides;
    aiMsg.pptMode.expanded = false;
  } catch (e) {
    aiMsg.content = `❌ PPT 模式生成失败：${e.message || e}`;
    (aiMsg.pptMode.events || [])
      .filter(ev => ev && ev.status === 'running')
      .forEach(ev => finishPptEvent(ev, { status: 'error', ok: false, result: e.message || String(e) }));
    (aiMsg.pptMode.steps || []).forEach(step => finishPptRunningCalls(step, 'error', e.message || String(e)));
    const runningStep = (aiMsg.pptMode.steps || []).find(step => step.status === 'active');
    if (runningStep) setPptStep(aiMsg.pptMode, runningStep.id, 'error', e.message || String(e));
    setPptStep(aiMsg.pptMode, 'export', 'error', 'PPT 生成流程已中断。');
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
    if (typeof refreshMsgNode === 'function') refreshMsgNode(msgIdx, c);
    else renderMessages();
    if (typeof updateSendBtn === 'function') updateSendBtn();
  }
}
