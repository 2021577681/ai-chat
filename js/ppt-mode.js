// ============ 📊 PPT 独立模式 ============
// 顶栏按钮开启后，下一条用户消息会直接走 PPT Pipeline：
// 项目 PPT 工作流：需求理解/澄清 → 叙事弧大纲 → 选择风格/主题 → 登记版式 → HTML 模板页 → 浏览器截图 → PPT 图片页 → 导出。

const DEFAULT_PPT_UNDERSTAND_PROMPT = [
  '你是 项目 PPT 工作流 的演示策划总监。请理解用户要做的 PPT 主题、内容、用途、受众和语气，并为 PPT 自动命名。',
  '必须只输出 JSON 对象，不要输出解释。',
  '输出字段：title、subtitle、purpose、audience、language、tone、visual_direction、filename、needs_clarification、clarifying_question、clarifying_questions。',
  'visual_direction 要明确建议使用电子杂志风或瑞士国际主义风；filename 必须贴合主题，使用安全文件名，并以 .pptx 结尾。',
  '默认使用已迁移到本项目内的 项目 PPT PPT 工作流，模板资源来自 server/ppt_templates/project。',
  '只有当缺少会实质影响内容或素材使用的关键信息时，才把 needs_clarification 设为 true，并给出最多 3 个具体问题；不要为了普通偏好反复打断流程。'
].join('\n');

const DEFAULT_PPT_OUTLINE_PROMPT = [
  '你是 项目 PPT 工作流 的内容策划专家。请根据用户需求和理解结果生成 PPT 大纲。',
  '必须只输出 JSON 对象，不要输出解释。',
  '输出结构：{"outline":[{"page":1,"title":"页面标题","goal":"本页沟通目标","key_points":["要点1","要点2"]}]}',
  '页数必须等于 target_slide_count；每页标题要具体，避免泛泛而谈。',
  '使用 项目演示叙事弧组织内容：Hook → Context → Core → Shift → Takeaway。',
  '大纲只决定叙事顺序和每页沟通目标，不输出 HTML 坐标；但要为后续 layout 选择保留足够明确的内容形状。'
].join('\n');

const DEFAULT_PPT_PAGE_TYPE_PROMPT = [
  '你是 项目 PPT 工作流 的信息架构设计师。请为大纲中的每一页确定页面类型、内容结构和模板版式。',
  '必须只输出 JSON 对象，不要输出解释。',
  '输出结构：{"pages":[{"page":1,"title":"页面标题","page_type":"cover|agenda|section|concept|comparison|data_story|process|timeline|case|quote|summary|closing|freeform","visual_role":"本页视觉承担的任务","template_style":"magazine|swiss","layout_id":"A01|A02|A03|A04|A05|A06|A07|A08|A09|A10|SWISS-COVER-ASCII|SWISS-CLOSING-ASCII|S01|...|S22","theme_class":"hero dark|hero light|light|dark|grey|accent|split","image_slots":[],"content_blocks":[{"title":"模块名","text":"模块内容"}]}]}',
  'template_style 必须跟随输入的 template_style，不要一份 deck 混用 magazine 和 swiss。',
  'magazine 只能使用 A01-A10；swiss 正文页只能使用 S01-S22，首页/尾页可用 SWISS-COVER-ASCII / SWISS-CLOSING-ASCII。',
  '版式要多样：不要连续 3 页使用同一主体结构；10 页以上至少 8 个不同 layout_id。',
  '有图片或截图时必须写 image_slots，并绑定标准比例；没有图片时 image_slots 为空数组。'
].join('\n');

const DEFAULT_PPT_HTML_PROMPT = [
  '你是 项目 PPT 工作流 的 HTML slide section 生成器。请为单页 PPT 生成可插入模板的 <section class="slide ...">。',
  '必须只输出 JSON 对象，不要输出解释。',
  '输出结构：{"html":"<section class=\\"slide ...\\">...</section>"}',
  '硬性要求：',
  '1. 不要输出 <!doctype>、<html>、<head>、<body>、<style> 或 <script>；后端会把 section 填入已复制到项目内的 项目 HTML 模板。',
  '2. 必须使用输入中的 template_context、layout_id、theme_class 和 allowed_classes；不要发明模板里不存在的 class，必要时只用 inline style 微调。',
  '3. magazine 风格使用 template.html 的衬线标题、chrome、foot、h-*、display-zh、stat-card、grid-*、pipeline 等类。',
  '4. swiss 风格使用 template-swiss.html 的无衬线、12 栏、canvas-card、chrome-min、t-*、card-*、grid-12、span-N 等类；每个 section 必须带 data-layout，且只用登记版式。',
  '5. 图片必须放在 images/ 并按 {页号}-{语义}.{ext} 命名；没有真实图片时不要伪造图片路径。',
  '6. 页面信息必须完整但不拥挤，文本不能明显溢出画布。',
  '7. 返回的 section 要贴合 项目 PPT 的版式节奏，不要退回通用网页卡片。'
].join('\n');

const PPT_DECK_STYLE_OPTIONS = ['auto', 'magazine', 'swiss'];
const PPT_DECK_THEME_OPTIONS = {
  auto: '自动选择',
  ink_classic: '杂志风 · 墨水经典',
  indigo_porcelain: '杂志风 · 靛蓝瓷',
  forest_ink: '杂志风 · 森林墨',
  kraft_paper: '杂志风 · 牛皮纸',
  dune: '杂志风 · 沙丘',
  ikb: '瑞士风 · 克莱因蓝 IKB',
  lemon: '瑞士风 · 柠檬黄',
  lemon_green: '瑞士风 · 柠檬绿',
  safety_orange: '瑞士风 · 安全橙'
};

function normalizePptPromptText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePptPromptOverride(value, defaultPrompt, legacyMarkers = []) {
  const text = String(value || '').trim();
  if (!text) return '';
  const compact = normalizePptPromptText(text);
  if (compact === normalizePptPromptText(defaultPrompt)) return '';
  if (legacyMarkers.length && legacyMarkers.every(marker => compact.includes(normalizePptPromptText(marker)))) return '';
  return text;
}

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
  return style || '按 项目 PPT 工作流自动匹配';
}


function pptRenderStyleLabel(style) {
  return normalizePptRenderStyle(style);
}

function normalizePptDeckStyle(value) {
  const v = String(value || '').trim().toLowerCase();
  return PPT_DECK_STYLE_OPTIONS.includes(v) ? v : 'auto';
}

function normalizePptDeckTheme(value) {
  const v = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PPT_DECK_THEME_OPTIONS, v) ? v : 'auto';
}

function pptDeckStyleLabel(value) {
  const v = normalizePptDeckStyle(value);
  return v === 'swiss' ? '瑞士国际主义' : (v === 'magazine' ? '电子杂志 × 电子墨水' : '自动选择');
}

function pptDeckThemeLabel(value) {
  return PPT_DECK_THEME_OPTIONS[normalizePptDeckTheme(value)] || PPT_DECK_THEME_OPTIONS.auto;
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
    ppt_template_system: p.ppt_template_system || 'project',
    ppt_template_style: p.ppt_template_style || 'auto',
    ppt_template_theme: p.ppt_template_theme || 'auto',
    render_style: p.render_style || '',
    attachment_count: Array.isArray(p.attachments) ? p.attachments.length : 0,
    filename: p.filename || 'AI 自动命名',
    llm_model: p.llm_model || '当前模型',
    llm_base_url: baseUrl || '未配置',
    llm_api_key_configured: apiKeyConfigured,
    llm_api_format: apiFormat || '未知',
    llm_api_path: apiPath || '',
    llm_vision_interface: visionInterface,
    ppt_editable_text: !!(p.ppt_editable_text || p.editable_text_overlay),
    editable_text_overlay: !!(p.editable_text_overlay || p.ppt_editable_text),
    llm_temperature: p.llm_temperature
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
        title: '选择 模板风格与主题',
        status: 'pending',
        note: '在电子杂志风 / 瑞士国际主义中选择一种，并绑定预设主题色。'
      },
      {
        id: 'layout_blueprint',
        step: 5,
        title: '绑定登记版式',
        status: 'pending',
        note: '杂志风使用 A01-A10；瑞士风正文页使用 S01-S22，不自造版式。'
      },
      {
        id: 'html_design',
        step: 6,
        title: '生成 项目 HTML',
        status: 'pending',
        note: '逐页生成 slide section，并套入项目内复制的 项目 HTML 模板。'
      },
      {
        id: 'quality_review',
        step: 7,
        title: '项目模板规则检查',
        status: 'pending',
        note: '检查版式约束、主题色、Swiss 禁忌、图片槽位和页面完整度。'
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
  if (pipeline.interaction && typeof pipeline.interaction === 'object') {
    const understandStep = pptStep(ppt, 'understand');
    if (understandStep) {
      understandStep.meta = {
        ...(understandStep.meta || {}),
        guidance_count: pipeline.interaction.guidance_count || 0,
        source_material_count: pipeline.interaction.source_material_count || 0
      };
    }
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
    setPptStep(ppt, 'design_recipe', 'done', `已选择 模板风格：${pipeline.design_system.style_label || pipeline.design_system.theme_name || 'custom'}。`, pipeline.design_system);
  }
  const blueprints = Array.isArray(pipeline.layout_blueprints) ? pipeline.layout_blueprints : [];
  if (blueprints.length) {
    setPptStep(ppt, 'layout_blueprint', 'done', `已绑定 ${blueprints.length} 页 项目 PPT 登记版式与主题节奏。`, { pages: blueprints.length });
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
      setPptStep(ppt, 'quality_review', q.passed === false ? 'warning' : 'done', `项目模板规则检查完成${Array.isArray(q.pages) ? `，共 ${q.pages.length} 页` : ''}。`, q);
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
    quality_review: 'quality_review',
    review: 'quality_review',
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
  if (ev.type === 'guidance') {
    if (!Array.isArray(ppt.guidance)) ppt.guidance = [];
    const item = detail.guidance || {};
    ppt.guidance.push(item);
    ppt.progressText = ev.message || '已收到用户补充。';
    ensurePptStepCall(ppt, 'understand', 'user_guidance', `guidance:${detail.version || Date.now()}`, {
      status: 'done',
      args: item,
      result: ev.message || '已收到用户补充。'
    });
    return;
  }
  if (ev.type === 'input_required') {
    ppt.status = 'paused';
    ppt.progressText = ev.message || 'PPT 生成需要补充信息。';
    ensurePptStepCall(ppt, pptStageToStepId(ev.stage || 'understand'), ev.stage || 'input_required', `input_required:${ev.stage || Date.now()}`, {
      status: 'warning',
      args: detail,
      result: ev.message || 'PPT 生成需要补充信息。'
    });
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
  if (snap.progress_index !== undefined) ppt.progressIndex = snap.progress_index || 0;
  if (Array.isArray(snap.guidance)) ppt.guidance = snap.guidance.map(x => ({ ...(x || {}) }));
  if (snap.guidance_count !== undefined) ppt.guidanceCount = snap.guidance_count;
  if (snap.guidance_version !== undefined) ppt.guidanceVersion = snap.guidance_version;
  if (snap.status === 'paused') ppt.status = 'paused';
  else if (snap.status === 'running') ppt.status = 'running';
  else if (snap.status === 'done') ppt.status = 'done';
  else if (snap.status === 'error' || snap.status === 'cancelled') ppt.status = snap.status;
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
        在此启用 PPT 模式后，下一条消息会按项目 PPT 工作流生成：需求理解/澄清 → 叙事弧大纲 → 选择电子杂志或瑞士国际主义风格 → 绑定登记版式和主题色 → 生成模板 HTML 页面 → 浏览器截图 → 图片铺入 PPT → 导出。所有模板和校验资源都使用项目内 <code>server/ppt_templates/project</code>。
      </div>

      <div class="form-group" style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <label style="margin:0;">启用 PPT 模式</label>
          <div class="form-hint" style="margin-top:2px;">启用后下一条消息将直接生成演示文稿，并自动关闭计划 / 大纲 / 师生模式。</div>
        </div>
        <label class="switch"><input type="checkbox" id="pptEnabled"><span class="switch-slider"></span></label>
      </div>

      <div class="form-group">
        <label>默认页数</label>
        <input type="number" id="pptSlideCount" min="1" max="50" step="1">
        <div class="form-hint">只控制目标页数；内容按 Hook → Context → Core → Shift → Takeaway 叙事弧组织。</div>
      </div>

      <div class="form-group">
        <label>模板风格</label>
        <select id="pptDeckStyle">
          <option value="auto">自动选择（按主题判断）</option>
          <option value="magazine">电子杂志 × 电子墨水</option>
          <option value="swiss">瑞士国际主义 / Swiss Style</option>
        </select>
        <div class="form-hint">一份 deck 只能使用一种风格；瑞士风会严格使用 S01-S22 登记版式。</div>
      </div>

      <div class="form-group">
        <label>主题色</label>
        <select id="pptDeckTheme">
          <option value="auto">自动选择</option>
          <option value="ink_classic">杂志风 · 墨水经典</option>
          <option value="indigo_porcelain">杂志风 · 靛蓝瓷</option>
          <option value="forest_ink">杂志风 · 森林墨</option>
          <option value="kraft_paper">杂志风 · 牛皮纸</option>
          <option value="dune">杂志风 · 沙丘</option>
          <option value="ikb">瑞士风 · 克莱因蓝 IKB</option>
          <option value="lemon">瑞士风 · 柠檬黄</option>
          <option value="lemon_green">瑞士风 · 柠檬绿</option>
          <option value="safety_orange">瑞士风 · 安全橙</option>
        </select>
        <div class="form-hint">仅使用项目预设主题色，避免任意 hex 混搭导致视觉失控。</div>
      </div>

      <div class="form-group">
        <label>补充风格/素材说明（可选）</label>
        <input type="text" id="pptRenderStyle" placeholder="例如：受众、分享场景、截图处理、必须包含的数据或禁忌">
        <div class="form-hint">用于补充 7 问澄清信息；不会切回旧的通用生成逻辑。</div>
      </div>

      <div class="form-group" style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <label style="margin:0;">PPT 文本可编辑模式</label>
          <div class="form-hint" style="margin-top:2px;">开启后后端会截图无文字背景，并把 HTML 文本提取为 PPT 可编辑文本框；关闭则保持纯截图模式。</div>
        </div>
        <label class="switch"><input type="checkbox" id="pptEditableText"><span class="switch-slider"></span></label>
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
        <label>Step 3：页面类型与 项目版式 Prompt</label>
        <textarea id="pptPageTypePrompt" rows="5" placeholder="留空使用默认页面类型提示词"></textarea>
        <div class="form-hint">控制“大纲 → 每页语义类型、layout_id、theme_class、图片槽位”的生成方式。</div>
      </div>

      <div class="form-group">
        <label>Step 6：项目 HTML Section Prompt</label>
        <textarea id="pptHtmlPrompt" rows="6" placeholder="留空使用默认 HTML 页面设计提示词"></textarea>
        <div class="form-hint">控制“页面类型 → 单个 &lt;section class=&quot;slide&quot;&gt;”，后端会套入项目内 项目模板。</div>
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
  document.getElementById('pptEnabled').checked = !!s.usePpt;
  document.getElementById('pptSlideCount').value = normalizePptSlideCount(s.pptSlideCount || 8);
  document.getElementById('pptDeckStyle').value = normalizePptDeckStyle(s.pptDeckStyle || s.pptTemplateStyle || 'auto');
  document.getElementById('pptDeckTheme').value = normalizePptDeckTheme(s.pptDeckTheme || s.pptTemplateTheme || 'auto');
  document.getElementById('pptRenderStyle').value = s.pptRenderStyle || '';
  document.getElementById('pptEditableText').checked = !!s.pptEditableText;
  document.getElementById('pptModel').value = s.pptModel || '';
  const temp = s.pptTemperature === undefined ? 0.6 : Number(s.pptTemperature);
  document.getElementById('pptTemperature').value = Number.isFinite(temp) ? temp : 0.6;
  document.getElementById('pptTemperatureVal').textContent = document.getElementById('pptTemperature').value;
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
  s.usePpt = !!document.getElementById('pptEnabled').checked;
  if (s.usePpt) {
    s.usePlan = false;
    s.useOutline = false;
    s.useReflection = false;
    const planBtn = document.getElementById('planBtn');
    const outlineBtn = document.getElementById('outlineBtn');
    if (planBtn) planBtn.classList.remove('plan-active');
    if (outlineBtn) outlineBtn.classList.remove('outline-active');
  }
  s.pptSlideCount = normalizePptSlideCount(document.getElementById('pptSlideCount').value);
  s.pptDeckStyle = normalizePptDeckStyle(document.getElementById('pptDeckStyle').value);
  s.pptDeckTheme = normalizePptDeckTheme(document.getElementById('pptDeckTheme').value);
  s.pptTemplateSystem = 'project';
  s.pptTemplateStyle = s.pptDeckStyle;
  s.pptTemplateTheme = s.pptDeckTheme;
  s.pptRenderStyle = document.getElementById('pptRenderStyle').value.trim();
  s.pptEditableText = !!document.getElementById('pptEditableText').checked;
  s.pptModel = document.getElementById('pptModel').value.trim();
  const temp = parseFloat(document.getElementById('pptTemperature').value);
  s.pptTemperature = Number.isFinite(temp) ? temp : 0.6;
  s.pptUnderstandPrompt = normalizePptPromptOverride(document.getElementById('pptUnderstandPrompt').value, DEFAULT_PPT_UNDERSTAND_PROMPT);
  s.pptOutlinePrompt = normalizePptPromptOverride(document.getElementById('pptOutlinePrompt').value, DEFAULT_PPT_OUTLINE_PROMPT);
  s.pptPageTypePrompt = normalizePptPromptOverride(document.getElementById('pptPageTypePrompt').value, DEFAULT_PPT_PAGE_TYPE_PROMPT);
  s.pptHtmlPrompt = normalizePptPromptOverride(document.getElementById('pptHtmlPrompt').value, DEFAULT_PPT_HTML_PROMPT);
  s.pptSlidePrompt = s.pptHtmlPrompt;
  if (typeof syncPptToolsWithMode === 'function') syncPptToolsWithMode(!!s.usePpt, { render: false });
  syncPptComposerHint();
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

function buildPptModePayload(userRequest, attachments = []) {
  const s = state.settings || {};
  const model = (s.pptModel || s.currentModel || '').trim();
  const htmlPrompt = normalizePptPromptOverride(
    s.pptHtmlPrompt || s.pptSlidePrompt || '',
    DEFAULT_PPT_HTML_PROMPT,
    ['请把大纲扩展成适合 16:9 HTML 视觉渲染的页面内容']
  );
  return {
    user_request: userRequest,
    attachments: Array.isArray(attachments) ? attachments.map(a => ({ ...(a || {}) })) : [],
    slide_count: normalizePptSlideCount(s.pptSlideCount),
    render_mode: 'html_image',
    ppt_template_system: 'project',
    template_system: 'project',
    ppt_template_style: normalizePptDeckStyle(s.pptDeckStyle || s.pptTemplateStyle || 'auto'),
    ppt_template_theme: normalizePptDeckTheme(s.pptDeckTheme || s.pptTemplateTheme || 'auto'),
    render_style: s.pptRenderStyle || '',
    ppt_editable_text: !!s.pptEditableText,
    editable_text_overlay: !!s.pptEditableText,
    llm_api_key: s.apiKey || '',
    llm_base_url: s.baseUrl || '',
    llm_api_format: s.apiFormat || '',
    llm_api_path: s.apiPath || '',
    llm_json_headers: s.jsonHeaders || '{}',
    llm_max_tokens: Math.max(parseInt(s.maxTokens || 0, 10) || 0, 4096),
    llm_model: model,
    llm_temperature: s.pptTemperature === undefined ? 0.6 : s.pptTemperature,
    ppt_understand_prompt: normalizePptPromptOverride(s.pptUnderstandPrompt, DEFAULT_PPT_UNDERSTAND_PROMPT),
    ppt_outline_prompt: normalizePptPromptOverride(s.pptOutlinePrompt, DEFAULT_PPT_OUTLINE_PROMPT, ['你是资深演示文稿策划专家。请根据用户需求规划 PPT 大纲。']),
    ppt_page_type_prompt: normalizePptPromptOverride(
      s.pptPageTypePrompt,
      DEFAULT_PPT_PAGE_TYPE_PROMPT,
      ['页面类型是语义类型，不是固定模板限制', '输出 pages，每页包含 page、title、page_type、visual_role、content_blocks。']
    ),
    ppt_html_prompt: htmlPrompt,
    ppt_slide_prompt: htmlPrompt
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

function currentLastUserAttachments(chat) {
  const msgs = (chat && chat.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === 'user') return Array.isArray(m.attachments) ? m.attachments.map(a => ({ ...(a || {}) })) : [];
  }
  return [];
}

function clonePptAttachments(attachments) {
  return Array.isArray(attachments) ? attachments.map(a => ({ ...(a || {}) })) : [];
}

function takePptGuidanceAttachments(chat) {
  const out = clonePptAttachments(state.pendingAttachments || []);
  const pendingAI = (typeof takePendingAIAttachments === 'function')
    ? takePendingAIAttachments(chat && chat.id)
    : (state.pendingAIAttachments || []).splice(0);
  for (const att of pendingAI || []) {
    if (att && !out.some(ex => ex && ex.id === att.id)) out.push({ ...att });
  }
  state.pendingAttachments = [];
  if (typeof renderPendingAtts === 'function') renderPendingAtts();
  if (typeof updateSendBtn === 'function') updateSendBtn();
  return out;
}

function clearPptGuidanceInput(idx) {
  const ta = document.getElementById(`pptGuide_${idx}`);
  if (ta) ta.value = '';
}

function handlePptGuidancePaste(e) {
  if (!e || !e.clipboardData || typeof addAttachment !== 'function') return;
  let added = 0;
  for (const item of e.clipboardData.items || []) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) {
        addAttachment(f, f.type && f.type.startsWith('image/') ? 'image' : 'file');
        added += 1;
      }
    }
  }
  if (added && typeof toast === 'function') toast(`已加入 ${added} 个附件，点击继续后会发送给 PPT 流程`, 1800);
}

function handlePptGuidanceDragOver(e) {
  if (e) e.preventDefault();
}

function handlePptGuidanceDrop(e) {
  if (!e || !e.dataTransfer || typeof addAttachment !== 'function') return;
  e.preventDefault();
  let added = 0;
  for (const f of e.dataTransfer.files || []) {
    addAttachment(f, f.type && f.type.startsWith('image/') ? 'image' : 'file');
    added += 1;
  }
  if (added && typeof toast === 'function') toast(`已加入 ${added} 个附件，点击继续后会发送给 PPT 流程`, 1800);
}

function renderPptStepMeta(metaObj) {
  if (!metaObj || typeof metaObj !== 'object') return '';
  const labelMap = {
    path: '文件',
    slides: '页数',
    pages: '页数',
    titles: '标题',
    detail_chars: '结构大小',
    html: 'HTML',
    html_dir: 'HTML目录',
    image_dir: '图片目录',
    mode: '模式',
    renderer: '渲染器',
    model: '模型',
    title: '标题',
    purpose: '用途',
    audience: '受众',
    filename: '文件名',
    request_chars: '请求长度',
    target_slides: '目标页数',
    guidance_count: '用户补充',
    source_material_count: '素材'
  };
  const allowedKeys = new Set(Object.keys(labelMap));
  return Object.entries(metaObj).filter(([key, value]) => {
    if (!allowedKeys.has(key)) return false;
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value) || typeof value === 'object') return false;
    return true;
  }).map(([key, value]) => {
    const shown = value === true ? '是' : (value === false ? '否' : String(value));
    return `<span>${escapeHtml(labelMap[key])}：${escapeHtml(shown)}</span>`;
  }).join('');
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

  const controlHtml = ppt.taskId && (ppt.status === 'paused' || ppt.status === 'running') ? (ppt.status === 'paused' ? `
    <div class="outline-actions paused ppt-task-controls">
      <div class="outline-actions-hint">PPT 已暂停。可以补充风格、素材、页数、路径或修改意见；不填写也可以直接继续。</div>
      <textarea class="outline-inject-input" id="pptGuide_${idx}" rows="3"
        onpaste="handlePptGuidancePaste(event)"
        ondragover="handlePptGuidanceDragOver(event)"
        ondrop="handlePptGuidanceDrop(event)"
        placeholder="给 PPT 流程留言：例如「改成瑞士风」「第 4 页必须用 output/data.csv」「这张截图放在封面」。可在这里粘贴/拖入图片和文件。"></textarea>
      <div class="outline-actions-btns">
        <button class="outline-btn resume" onclick="resumePptTaskFromPanel(${idx})">继续执行</button>
        <button class="outline-btn finish" onclick="resumePptTaskFromPanel(${idx}, true)">仅继续</button>
        <button class="outline-btn cancel" onclick="cancelPptTaskFromPanel(${idx})">放弃生成</button>
      </div>
      <div class="form-hint">任务ID：${escapeHtml(ppt.taskId || '')}</div>
    </div>` : `
    <div class="ppt-task-controls" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;">
      <button class="btn mini" onclick="pausePptTaskFromPanel(${idx})">暂停并留言</button>
      <button class="btn mini danger" onclick="cancelPptTaskFromPanel(${idx})">放弃生成</button>
      <span class="form-hint">任务ID：${escapeHtml(ppt.taskId || '')}</span>
    </div>`) : '';

  const stats = [
    `${doneCount}/${total} 步`,
    ppt.slides ? `${ppt.slides} 页` : '',
    ppt.path ? ppt.path : ''
  ].filter(Boolean).join(' · ');

  const stepHtml = `<ol class="outline-item-list ppt-step-list">${steps.map((step, i) => {
    const status = step.status || 'pending';
    const itemClass = status === 'active' || status === 'running' ? 'active' : status;
    const displayStep = step.step || i + 1;
    const meta = renderPptStepMeta(step.meta);
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
      <span>工作流：项目模板</span>
      <span>风格：${escapeHtml(pptDeckStyleLabel(config.ppt_template_style))}</span>
      <span>主题：${escapeHtml(pptDeckThemeLabel(config.ppt_template_theme))}</span>
      <span>渲染：HTML → 16:9 图片</span>
      <span>检查：项目模板规则</span>
      <span>模型：${escapeHtml(config.llm_model || '当前模型')}</span>
      <span>命名：${escapeHtml(config.filename || 'AI 自动命名')}</span>
      ${config.render_style ? `<span>补充说明：${escapeHtml(pptRenderStyleLabel(config.render_style))}</span>` : ''}
      ${config.attachment_count ? `<span>初始附件：${escapeHtml(String(config.attachment_count))} 个</span>` : ''}
    </div>`;

  const progressHtml = ppt.status === 'running' || ppt.inProgress
    ? `<div class="ref-progress"><span class="ref-spinner"></span><span>${escapeHtml(ppt.progressText || '正在生成 PPT...')}</span></div>`
    : '';

  return `
    <div class="outline-panel ppt-panel ${ppt.expanded === false ? 'collapsed' : ''}" data-msg-idx="${idx}">
      <button class="outline-toggle ppt-toggle" onclick="togglePptPanel(${idx})">
        <span>PPT 项目 PPT 工作流</span>
        <span class="outline-stats">${escapeHtml(stats || '准备中')}</span>
      </button>
      <div class="outline-body">
        <div class="outline-section main">
          <div class="outline-section-header">PPT 项目 PPT 图片页流程 ${statusBadge}</div>
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

async function resumePptTaskFromPanel(idx, skipGuidance = false) {
  const c = currentChat();
  const msg = c && c.messages && c.messages[idx];
  if (!msg || !msg.pptMode || !msg.pptMode.taskId) return;
  const taskId = msg.pptMode.taskId;
  const ta = document.getElementById(`pptGuide_${idx}`);
  const guidanceText = skipGuidance ? '' : (ta ? ta.value.trim() : '');
  const attachments = skipGuidance ? [] : takePptGuidanceAttachments(c);
  const hasGuidance = !!guidanceText || attachments.length > 0;
  msg.pptMode.status = 'running';
  msg.pptMode.inProgress = true;
  msg.pptMode.progressText = hasGuidance ? '正在带着用户补充继续 PPT 任务...' : '正在恢复 PPT 任务...';
  refreshPptModeMessage(idx, c);
  const ctrl = new AbortController();
  if (typeof beginChatTask === 'function') beginChatTask(c.id, ctrl, { resetStop: true });
  else state.abortCtrl = ctrl;
  if (typeof setChatTaskMode === 'function') setChatTaskMode(c.id, 'ppt');
  if (typeof syncGlobalTaskState === 'function') syncGlobalTaskState(c.id);
  if (typeof updateSendBtn === 'function') updateSendBtn();
  let since = msg.pptMode.progressIndex || 0;
  try {
    if (hasGuidance) {
      const snap = await controlPptTask(taskId, 'guide', {
        message: guidanceText,
        attachments,
        source: 'ppt-card',
        since
      }, { skipConfirm: true });
      if (snap && snap.ok) applyPptTaskSnapshot(msg.pptMode, snap);
      clearPptGuidanceInput(idx);
    } else {
      const snap = await controlPptTask(taskId, 'resume', { since }, { skipConfirm: true });
      if (snap && snap.ok) applyPptTaskSnapshot(msg.pptMode, snap);
    }
    since = msg.pptMode.progressIndex || since;
    while (true) {
      const task = typeof chatTaskById === 'function' ? chatTaskById(c.id) : null;
      if (ctrl.signal.aborted || !!(task && task.stopRequested) || !!state.stopRequested) {
        const pauseSnap = await controlPptTask(taskId, 'pause', { since }, { skipConfirm: true });
        if (pauseSnap && pauseSnap.ok) applyPptTaskSnapshot(msg.pptMode, pauseSnap);
        msg.pptMode.status = 'paused';
        msg.pptMode.inProgress = false;
        msg.pptMode.progressText = '已请求暂停，当前小步结束后会停住。';
        refreshPptModeMessage(idx, c);
        return;
      }
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
      if (snap.status === 'paused') {
        msg.pptMode.inProgress = false;
        refreshPptModeMessage(idx, c);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 900));
    }
  } catch (e) {
    msg.pptMode.status = 'error';
    msg.pptMode.error = e.message || String(e);
    msg.pptMode.inProgress = false;
    refreshPptModeMessage(idx, c);
  } finally {
    const task = typeof chatTaskById === 'function' ? chatTaskById(c.id) : null;
    if (!task || task.abortCtrl === ctrl) {
      if (typeof clearChatTask === 'function') clearChatTask(c.id);
      else {
        state.isGenerating = false;
        state.abortCtrl = null;
      }
    }
    if (typeof syncGlobalTaskState === 'function') syncGlobalTaskState(c.id);
    if (typeof updateSendBtn === 'function') updateSendBtn();
  }
}

async function pausePptTaskFromPanel(idx) {
  const c = currentChat(); const msg = c && c.messages && c.messages[idx];
  if (msg && msg.pptMode && msg.pptMode.taskId) {
    msg.pptMode.status = 'paused';
    msg.pptMode.progressText = '已请求暂停，当前小步结束后会停住。';
    refreshPptModeMessage(idx, c);
    const snap = await controlPptTask(msg.pptMode.taskId, 'pause', { since: msg.pptMode.progressIndex || 0 }, { skipConfirm: true });
    if (snap && snap.ok) applyPptTaskSnapshot(msg.pptMode, snap);
    refreshPptModeMessage(idx, c);
  }
}

async function cancelPptTaskFromPanel(idx) {
  const c = currentChat(); const msg = c && c.messages && c.messages[idx];
  if (msg && msg.pptMode && msg.pptMode.taskId && confirm('确定取消这个 PPT 后端任务吗？取消后不能恢复。')) {
    const snap = await controlPptTask(msg.pptMode.taskId, 'cancel', { since: msg.pptMode.progressIndex || 0 }, { skipConfirm: true });
    if (snap && snap.ok) applyPptTaskSnapshot(msg.pptMode, snap);
    msg.pptMode.status = 'cancelled';
    msg.pptMode.inProgress = false;
    msg.content = 'PPT 生成已放弃。';
    refreshPptModeMessage(idx, c);
  }
}

function latestActivePptMessageIndex(chat) {
  const msgs = (chat && chat.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const ppt = msgs[i] && msgs[i].pptMode;
    if (ppt && ppt.taskId && (ppt.status === 'running' || ppt.status === 'paused')) return i;
  }
  return -1;
}

function queuePptMidrunGuidanceFromComposer(chat, input, text) {
  if (!chat || (!text && !(state.pendingAttachments || []).length)) return false;
  const idx = latestActivePptMessageIndex(chat);
  if (idx < 0) return false;
  const msg = chat.messages[idx];
  const attachments = takePptGuidanceAttachments(chat);
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }
  if (typeof traceUserMessage === 'function') traceUserMessage(text || '');
  if (!Array.isArray(msg.pptMode.guidance)) msg.pptMode.guidance = [];
  msg.pptMode.guidance.push({
    message: text || '',
    source: 'composer',
    attachments: attachments.map(a => ({ name: a.name, type: a.type, mime: a.mime, size: a.size }))
  });
  msg.pptMode.progressText = '已收到中途补充，后续 PPT 步骤会优先遵循。';
  refreshPptModeMessage(idx, chat);
  controlPptTask(msg.pptMode.taskId, 'guide', {
    message: text || '',
    attachments,
    source: 'composer',
    since: msg.pptMode.progressIndex || 0
  }, { skipConfirm: true }).then(snap => {
    if (snap && snap.ok) {
      applyPptTaskSnapshot(msg.pptMode, snap);
      refreshPptModeMessage(idx, chat);
    }
  }).catch(err => {
    if (typeof toast === 'function') toast(`PPT 留言发送失败：${err && err.message ? err.message : err}`, 3000);
  });
  if (typeof updateSendBtn === 'function') updateSendBtn();
  if (typeof toast === 'function') toast('已发送到 PPT 流程，后续步骤会读取这条补充', 1800);
  return true;
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
  const payload = buildPptModePayload(userRequest, currentLastUserAttachments(c));

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
      name: 'step_6_html_design',
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
