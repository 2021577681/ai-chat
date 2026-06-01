// ============ 📋 Plan 模式 - 核心执行逻辑 ============
// 【模块定位】Plan 主流程 + 步骤执行 + 规划辅助（无 DOM 操作）
// 依赖：state.js / api.js / tools.js / chat.js
// 加载顺序：在 plan-ui.js 之前

// ============ Plan 模式（人在回路 + 完整 Agent 执行）============

async function callAPIWithPlan() {
  const c = currentChat();
  const s = state.settings;
  state.isGenerating = true;
  // ⭐ 创建 abortCtrl，让用户能中断规划/审批阶段
  state.abortCtrl = new AbortController();
  updateSendBtn();
  
  const aiMsg = {
    role: 'assistant',
    content: '',
    _startTime: Date.now(),
    plan: {
      stage: 'planning',
      status: 'pending_approval',
      analysis: '',
      steps: [],
      reviewTurns: [],
      planScore: null,
      progressText: '📋 规划中...',
      expanded: true,
      inProgress: true,
      _userQuestion: '',
      _executionResults: []
    }
  };
  c.messages.push(aiMsg);
  renderMessages();
  
  const historyForUse = c.messages.slice(0, -1);
  const userQuestion = extractUserQuestion(historyForUse);
  aiMsg.plan._userQuestion = userQuestion;
  
  const plannerModel = s.planPlannerModel.trim() || s.currentModel;
  
  try {
    aiMsg.plan.stage = 'planning';
    aiMsg.plan.progressText = '📋 规划者分析任务...';
    renderMessages();
    
    let plan = await generatePlan(historyForUse, plannerModel, s.planPlannerPrompt, s.planMaxSteps);
    aiMsg.plan.analysis = plan.analysis;
    aiMsg.plan.steps = plan.steps.map(st => ({ ...st, status: 'pending', result: '' }));
    renderMessages();
    
    if (s.planReview) {
      aiMsg.plan.stage = 'reviewing';
      for (let r = 1; r <= s.planReviewRounds; r++) {
        aiMsg.plan.progressText = `🎭 老师审查计划（第 ${r} 轮）...`;
        renderMessages();
        const rr = await reviewPlan(userQuestion, plan, plannerModel);
        aiMsg.plan.reviewTurns.push({ round: r, ...rr });
        aiMsg.plan.planScore = rr.score;
        renderMessages();
        if (rr.satisfied || rr.score >= 9) break;
        if (rr.revised_steps && rr.revised_steps.length) {
          plan = { analysis: plan.analysis, steps: rr.revised_steps };
          aiMsg.plan.steps = plan.steps.map(st => ({ ...st, status: 'pending', result: '' }));
          renderMessages();
        }
        if (r === s.planReviewRounds) break;
      }
    }
    
    // 暂停，等待用户审批
    aiMsg.plan.stage = 'awaiting_approval';
    aiMsg.plan.status = 'pending_approval';
    aiMsg.plan.inProgress = false;
    aiMsg.plan.progressText = '⏸ 计划已生成，等待您审批';
    
    aiMsg.content = `📋 **任务计划已生成**（共 ${plan.steps.length} 步）${aiMsg.plan.planScore !== null ? `· 评分 ${aiMsg.plan.planScore}/10` : ''}\n\n` +
                    `请审查下方的执行计划。如果满意，点击「▶️ 执行计划」按钮开始；\n` +
                    `如果不满意，点击「🔄 重新规划」或「❌ 取消」。\n\n` +
                    `**分析**：${plan.analysis}\n\n` +
                    `**步骤概览**：\n` +
                    plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
    
    saveData();
    renderMessages();
    toast('📋 计划已生成，请审批后执行', 3000);
    
  } catch (e) {
    if (e.name === 'AbortError') {
      aiMsg.content = (aiMsg.content || '') + '\n\n*[规划已被用户停止]*';
      aiMsg.plan.status = 'cancelled';
    } else {
      aiMsg.content = `❌ Plan 规划出错：${e.message}`;
      aiMsg.plan.status = 'error';
    }
    aiMsg.plan.inProgress = false;
    aiMsg.plan.stage = 'done';
    // ⭐ 规划阶段失败/取消，任务已终结，固定计时
    if (!aiMsg._endTime) aiMsg._endTime = Date.now();
    delete aiMsg.plan.progressText;
    renderMessages();
    saveData();
  } finally {
    state.isGenerating = false;
    state.abortCtrl = null;
    updateSendBtn();
  }
}

// ⭐ 用户审批后执行计划
async function approveAndExecutePlan(msgIdx) {
  const c = currentChat();
  if (!c || !c.messages[msgIdx] || !c.messages[msgIdx].plan) return;
  
  const aiMsg = c.messages[msgIdx];
  const plan = aiMsg.plan;
  
  if (plan.status !== 'pending_approval' && plan.status !== 'paused' && plan.status !== 'error') {
    toast('此计划不在可执行状态');
    return;
  }
  
  if (state.isGenerating) {
    toast('当前有任务正在执行，请稍等');
    return;
  }
  
  state.isGenerating = true;
  // ⭐ 关键：标记 Plan 正在执行，防止 onSend 触发新 Plan
  state._planExecuting = true;
  // ⭐ 创建 abortCtrl，让用户能中断执行
  state.abortCtrl = new AbortController();
  updateSendBtn();
  
  // ⭐ 计时：清除之前(pending_approval/paused/error)留下的 _endTime，让计时继续
  delete aiMsg._endTime;
  if (!aiMsg._startTime) aiMsg._startTime = Date.now();
  
  plan.status = 'executing';
  plan.stage = 'executing';
  plan.inProgress = true;
  plan.progressText = '🚀 开始执行计划...';
  renderMessages();
  
  const s = state.settings;
  const executorModel = s.planExecutorModel.trim() || s.currentModel;
  const userQuestion = plan._userQuestion;
  
  const stepResults = plan._executionResults || [];
  // ⭐ 记录当前正在跑的步骤索引，用于中断时回滚状态
  let currentRunningIdx = -1;
  
  try {
    let startIdx = 0;
    for (let i = 0; i < plan.steps.length; i++) {
      if (plan.steps[i].status === 'done') {
        startIdx = i + 1;
      } else {
        // ⭐ 把残留的 running 状态重置为 pending（上次中断遗留）
        if (plan.steps[i].status === 'running') {
          plan.steps[i].status = 'pending';
        }
        break;
      }
    }
    
    for (let i = startIdx; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      step.status = 'running';
      currentRunningIdx = i;
      plan.progressText = `🔨 执行第 ${i + 1}/${plan.steps.length} 步：${step.title}`;
      updatePlanPanel(c.messages.indexOf(aiMsg));
      saveData();
      
      const result = await executeStepWithTools(
        userQuestion, plan, i, stepResults, executorModel, s.planExecutorPrompt
      );
      
      step.result = result;
      step.status = 'done';
      currentRunningIdx = -1;
      stepResults.push({ title: step.title, result });
      plan._executionResults = stepResults;
      updatePlanPanel(c.messages.indexOf(aiMsg));
      saveData();
    }
    
    // 整合输出
    let finalAnswer;
    if (s.planSynthesize) {
      plan.stage = 'synthesizing';
      plan.progressText = '✨ 整合结果...';
      renderMessages();
      finalAnswer = await synthesizeResults(userQuestion, plan, stepResults, executorModel);
    } else {
      finalAnswer = stepResults.map((r, i) => `## ${i + 1}. ${r.title}\n\n${r.result}`).join('\n\n');
    }
    
    aiMsg.content = finalAnswer;
    plan.stage = 'done';
    plan.status = 'completed';
    plan.inProgress = false;
    if (!aiMsg._endTime) aiMsg._endTime = Date.now();
    delete plan.progressText;
    renderMessages();
    saveData();
    toast('✅ 计划执行完成', 3000);
    
  } catch (e) {
    // ⭐ 中断时把"running"状态的步骤回滚为 pending，下次能从这一步继续
    if (currentRunningIdx >= 0 && plan.steps[currentRunningIdx]) {
      if (plan.steps[currentRunningIdx].status === 'running') {
        plan.steps[currentRunningIdx].status = 'pending';
      }
    }
    if (e.name === 'AbortError') {
      aiMsg.content = (aiMsg.content || '') + '\n\n*[执行已停止，可以再次点击执行继续]*';
      plan.status = 'paused';
    } else {
      aiMsg.content = `❌ 执行出错：${e.message}\n\n（已完成的步骤会保留，您可以再次点击执行继续）`;
      plan.status = 'error';
    }
    plan.inProgress = false;
    // ⭐ 暂停/出错时固定计时；下次 approve 继续执行会清除 _endTime
    if (!aiMsg._endTime) aiMsg._endTime = Date.now();
    delete plan.progressText;
    renderMessages();
    saveData();
  } finally {
    state.isGenerating = false;
    state.abortCtrl = null;
    // ⭐ 关键：无论成功失败都清除执行标记
    state._planExecuting = false;
    updateSendBtn();
  }
}

function cancelPlan(msgIdx) {
  const c = currentChat();
  if (!c || !c.messages[msgIdx]) return;
  if (!confirm('取消此计划？\n（消息会保留，但状态变为已取消）')) return;
  
  const aiMsg = c.messages[msgIdx];
  if (aiMsg.plan) {
    aiMsg.plan.status = 'cancelled';
    aiMsg.plan.stage = 'done';
    aiMsg.plan.inProgress = false;
    if (!aiMsg._endTime) aiMsg._endTime = Date.now();
    delete aiMsg.plan.progressText;
    aiMsg.content = '❌ 计划已被用户取消。';
  }
  renderMessages();
  saveData();
  toast('计划已取消');
}

async function regeneratePlan(msgIdx) {
  const c = currentChat();
  if (!c || !c.messages[msgIdx]) return;
  if (state.isGenerating) { toast('请等当前任务完成'); return; }
  
  c.messages = c.messages.slice(0, msgIdx);
  renderMessages();
  saveData();
  await callAPIWithPlan();
}

function editPlanStep(msgIdx, stepIdx) {
  const c = currentChat();
  if (!c || !c.messages[msgIdx] || !c.messages[msgIdx].plan) return;
  const step = c.messages[msgIdx].plan.steps[stepIdx];
  if (!step) return;
  
  const newTitle = prompt('修改步骤标题：', step.title);
  if (newTitle === null) return;
  const newDesc = prompt('修改步骤描述：', step.description);
  if (newDesc === null) return;
  
  step.title = newTitle.trim() || step.title;
  step.description = newDesc.trim() || step.description;
  saveData();
  renderMessages();
  toast('✓ 步骤已修改');
}

function deletePlanStep(msgIdx, stepIdx) {
  const c = currentChat();
  if (!c || !c.messages[msgIdx] || !c.messages[msgIdx].plan) return;
  if (!confirm('删除这一步？')) return;
  c.messages[msgIdx].plan.steps.splice(stepIdx, 1);
  saveData();
  renderMessages();
  toast('已删除步骤');
}

// ============ 规划辅助 ============

async function generatePlan(history, model, prompt, maxSteps) {
  const userQuestion = extractUserQuestion(history);
  const fullPrompt = prompt + `\n\n注意：步骤数量不超过 ${maxSteps} 个。`;
  const msgs = [{ role: 'user', content: `请为以下任务生成执行计划：\n\n${userQuestion}` }];
  const raw = await callOnceWithRole(msgs, model, fullPrompt);
  try {
    let txt = raw.trim();
    txt = txt.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '');
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error();
    const j = JSON.parse(m[0]);
    if (!j.steps || !Array.isArray(j.steps) || !j.steps.length) throw new Error();
    return {
      analysis: j.analysis || '',
      steps: j.steps.slice(0, maxSteps).map(s => ({
        title: s.title || s.name || '未命名',
        description: s.description || s.desc || ''
      }))
    };
  } catch (e) {
    return { analysis: '（计划解析失败，按单步执行）', steps: [{ title: '完成任务', description: userQuestion }] };
  }
}

async function reviewPlan(userQuestion, plan, model) {
  const planJson = JSON.stringify({ analysis: plan.analysis, steps: plan.steps }, null, 2);
  const msgs = [{
    role: 'user',
    content: `【原始任务】\n${userQuestion}\n\n【待评审计划】\n${planJson}\n\n请按 JSON 格式输出评审结果。`
  }];
  const raw = await callOnceWithRole(msgs, model, PLAN_REVIEWER_PROMPT);
  try {
    let txt = raw.trim();
    txt = txt.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '');
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error();
    const j = JSON.parse(m[0]);
    return {
      score: typeof j.score === 'number' ? j.score : 7,
      satisfied: !!j.satisfied,
      issues: Array.isArray(j.issues) ? j.issues : [],
      revised_steps: Array.isArray(j.revised_steps) && j.revised_steps.length
        ? j.revised_steps.map(s => ({ title: s.title || '未命名', description: s.description || '' }))
        : null
    };
  } catch (e) {
    return { score: 8, satisfied: true, issues: [], revised_steps: null };
  }
}

// ⭐ 执行单步：带工具循环（mini Agent）
async function executeStepWithTools(userQuestion, plan, stepIdx, prevResults, model, executorPrompt) {
  const step = plan.steps[stepIdx];
  // ⭐ 每次开始执行此步骤前清空该步骤的工具调用日志（避免上次中断的残留）
  step.toolCalls = [];
  
  let ctx = `【整体任务】\n${userQuestion}\n\n【完整计划】\n`;
  plan.steps.forEach((s, i) => {
    const marker = i < stepIdx ? '[已完成]' : (i === stepIdx ? '[当前]' : '[待办]');
    ctx += `${i + 1}. ${marker} ${s.title}：${s.description}\n`;
  });
  
  if (prevResults.length) {
    ctx += '\n【前面步骤的执行结果】\n';
    prevResults.forEach((r, i) => {
      const t = r.result.length > 2000 ? r.result.slice(0, 2000) + '\n...(已截断)' : r.result;
      ctx += `\n--- 步骤 ${i + 1}: ${r.title} ---\n${t}\n`;
    });
  }
  
  ctx += `\n【当前需要执行的步骤】\n第 ${stepIdx + 1} 步：${step.title}\n${step.description}\n\n` +
         `请使用可用的工具真正完成这一步骤。如果需要调用工具，请直接调用；不需要工具则直接回答。\n` +
         `完成后简洁汇报本步骤的结果。`;
  
  // ⭐ 把 step 传进去，runMiniAgent 实时写入 step.toolCalls
  // ⭐ 同时传入 onUpdate 回调，触发"只更新当前 plan 面板"的局部渲染
  const c = currentChat();
  const msgIdx = c ? c.messages.findIndex(m => m.plan === plan) : -1;
  const onUpdate = () => {
    if (msgIdx >= 0) updatePlanPanel(msgIdx);
  };
  return await runMiniAgent(ctx, model, executorPrompt, step, onUpdate);
}

// ⭐ Mini Agent：单步骤的工具循环（独立于主对话）
async function runMiniAgent(userPrompt, model, systemPrompt, step, onUpdate) {
  const s = state.settings;
  const tools = buildToolsArray();
  // ⭐ 读用户设置，与主对话共用同一个上限
  const cfgRounds = parseInt(s.maxToolRounds);
  const MAX_LOOPS = (isNaN(cfgRounds) || cfgRounds < 1) ? 15 : cfgRounds;
  
  // ⭐ 抓取当前 abortCtrl 的 signal 引用并保存
  // 即使 stopGenerate 把 state.abortCtrl 置 null，本函数仍能感知到中止
  const abortSignal = state.abortCtrl ? state.abortCtrl.signal : null;
  const isAborted = () => abortSignal && abortSignal.aborted;
  const throwIfAborted = () => {
    if (isAborted()) {
      const err = new Error('用户中断');
      err.name = 'AbortError';
      throw err;
    }
  };
  
  let conversationMessages = [];
  let collectedTexts = [];
  let toolLogs = [];
  
  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    // ⭐ 循环开始前主动检查中止信号
    throwIfAborted();
    
    let body;
    if (s.apiFormat === 'anthropic') {
      const anthMsgs = [{ role: 'user', content: userPrompt }];
      for (const m of conversationMessages) {
        if (m.role === 'assistant') {
          const parts = [];
          if (m.content && m.content.trim()) parts.push({ type: 'text', text: m.content });
          if (m.tool_calls) {
            for (const tc of m.tool_calls) {
              let input = {};
              try { input = JSON.parse(tc.function?.arguments || '{}'); } catch (e) {}
              parts.push({ type: 'tool_use', id: tc.id, name: tc.function?.name || '', input });
            }
          }
          anthMsgs.push({ role: 'assistant', content: parts });
        } else if (m.role === 'tool') {
          const part = {
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          };
          const last = anthMsgs[anthMsgs.length - 1];
          if (last && last.role === 'user' && Array.isArray(last.content)) {
            last.content.push(part);
          } else {
            anthMsgs.push({ role: 'user', content: [part] });
          }
        }
      }
      
      body = {
        model, messages: anthMsgs,
        max_tokens: parseInt(s.maxTokens),
        temperature: parseFloat(s.temperature),
        stream: false,
        system: systemPrompt
      };
      if (tools) body.tools = tools;
    } else {
      const oaiMsgs = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
        ...conversationMessages
      ];
      body = {
        model, messages: oaiMsgs,
        temperature: parseFloat(s.temperature),
        max_tokens: parseInt(s.maxTokens),
        stream: false
      };
      if (tools) body.tools = tools;
    }
    
    // 应用频率限制（超限自动等待，等待期间可被 abortCtrl 中断）
    if (typeof applyRateLimit === 'function') {
      await applyRateLimit();
    }
    
    const url = buildFullUrl(s.baseUrl, s.apiPath);
    // ⭐ 用带超时的 fetch（api-core.js 中定义），防止网络层卡死时无法 abort
    const resp = await (typeof _apiFetchWithTimeout === 'function'
      ? _apiFetchWithTimeout(url, {
          method: 'POST',
          headers: buildHeaders(),
          body: JSON.stringify(body)
        }, abortSignal, 5 * 60 * 1000)
      : fetch(url, {
          method: 'POST',
          headers: buildHeaders(),
          body: JSON.stringify(body),
          signal: abortSignal || undefined
        })
    );
    
    if (typeof recordRequest === 'function') {
      recordRequest();
    }
    
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${t.slice(0, 300)}`);
    }
    
    const _rawText = await resp.text();
    let j;
    try { j = JSON.parse(_rawText); } catch (e) { throw new Error('JSON 解析失败：' + _rawText.slice(0, 300)); }
    if (j.error) throw new Error(`API 错误：${j.error.message || JSON.stringify(j.error)}`);
    
    // ⭐ 记录原始响应
    if (typeof recordRawResponse === 'function') {
      recordRawResponse({
        ts: Date.now(),
        isStream: false,
        contentType: resp.headers.get('content-type') || '',
        raw: _rawText,
        parsedJson: j,
        usage: j.usage || null,
        request: { url, method: 'POST', headers: buildHeaders(), body },
        _source: `Plan 模式 · 执行步骤`
      });
    }
    
    // ⭐ 把 Plan 执行步骤的 usage 计入当前对话统计（之前漏算）
    if (j.usage && typeof recordUsageFromResponse === 'function') {
      const _c = typeof currentChat === 'function' ? currentChat() : null;
      if (_c) recordUsageFromResponse(_c, j.usage);
    }
    
    let assistantMsg;
    let toolCalls = null;
    
    if (s.apiFormat === 'anthropic') {
      const contents = j.content || [];
      const text = contents.filter(p => p.type === 'text').map(p => p.text).join('');
      const toolUses = contents.filter(p => p.type === 'tool_use');
      assistantMsg = { role: 'assistant', content: text };
      if (toolUses.length) {
        toolCalls = toolUses.map(tu => ({
          id: tu.id, type: 'function',
          function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) }
        }));
        assistantMsg.tool_calls = toolCalls;
      }
    } else {
      const msg = j.choices?.[0]?.message;
      if (msg) {
        assistantMsg = { role: 'assistant', content: msg.content || '' };
        if (msg.tool_calls?.length) {
          toolCalls = msg.tool_calls;
          assistantMsg.tool_calls = toolCalls;
        }
      } else {
        assistantMsg = { role: 'assistant', content: '(无响应)' };
      }
    }
    
    conversationMessages.push(assistantMsg);
    if (assistantMsg.content) collectedTexts.push(assistantMsg.content);
    
    // 没工具调用 → 完成
    if (!toolCalls || !toolCalls.length) break;
    
    // 执行工具
    for (const tc of toolCalls) {
      // ⭐ 每个工具执行前检查中止
      throwIfAborted();
      
      const fname = tc.function?.name || '';
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (e) {}
      
      // ⭐ 实时插入"调用中"占位卡片
      let liveEntry = null;
      if (step) {
        liveEntry = { name: fname, args: args, result: '', ok: null, _running: true };
        step.toolCalls.push(liveEntry);
        if (onUpdate) onUpdate(); else renderMessages();
      }
      
      const result = await executeTool(fname, args);
      const content = typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
      
      // ⭐ 更新该卡片为完成状态
      if (liveEntry) {
        liveEntry.result = content.slice(0, 500);
        liveEntry.ok = result.ok;
        liveEntry._running = false;
        if (onUpdate) onUpdate(); else renderMessages();
        saveData();
      }
      
      conversationMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: fname,
        content: content,
        status: result.ok ? 'success' : 'error'
      });
      toolLogs.push({
        name: fname,
        args: args,
        result: content.slice(0, 500),
        ok: result.ok
      });
    }
  }
  
  // ⭐ 汇总：只把"文本输出"留作 step.result（工具调用已经实时显示在 step.toolCalls 里，不再重复）
  const summary = collectedTexts.join('\n\n').trim();
  return summary || '(本步骤无文本输出)';
}

async function synthesizeResults(userQuestion, plan, stepResults, model) {
  let summary = `【原始任务】\n${userQuestion}\n\n【执行计划】\n${plan.analysis}\n\n【各步骤结果】\n`;
  stepResults.forEach((r, i) => {
    summary += `\n## 步骤 ${i + 1}：${r.title}\n${r.result}\n`;
  });
  summary += `\n请基于上面所有结果，整合成一个连贯、完整、流畅的最终答案。要求：1.不要简单堆砌 2.保留所有重要信息 3.结构清晰用 Markdown 4.直接输出最终答案。`;
  return await callOnceWithRole(
    [{ role: 'user', content: summary }],
    model,
    '你是擅长归纳整合的专家。请把多个片段融合成连贯的整体答案。'
  );
}

