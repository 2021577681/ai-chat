// ============ 师生讨论模式 ============

async function callAPIWithReflection() {
  const c = currentChat();
  const s = state.settings;
  state.isGenerating = true;
  // ⭐ 创建 abortCtrl，让用户按"停止"按钮能中断学生答 / 老师评的任意一轮
  // 没有这个，callOnceWithRole 会自动新建独立 controller，导致循环停不下来
  state.abortCtrl = new AbortController();
  updateSendBtn();
  
  const aiMsg = {
    role: 'assistant',
    content: '',
    _startTime: Date.now(),
    reflection: {
      turns: [],
      finalScore: null,
      expanded: false,
      inProgress: true,
      progressText: '🎭 准备...'
    }
  };
  c.messages.push(aiMsg);
  renderMessages();
  
  const historyForUse = c.messages.slice(0, -1);
  const studentModel = s.refStudentModel.trim() || s.currentModel;
  const teacherModel = s.refTeacherModel.trim() || s.currentModel;
  const userQuestion = extractUserQuestion(historyForUse);
  
  try {
    let currentAnswer = '';
    let teacherFeedback = null;
    
    for (let round = 1; round <= s.refRounds; round++) {
      // ===== 1. 学生回答 =====
      aiMsg.reflection.progressText = `🎓 学生${round === 1 ? '思考' : '改进'}中（第 ${round} 轮）...`;
      renderMessages();
      
      let studentHistory;
      if (round === 1) {
        studentHistory = historyForUse;
      } else {
        studentHistory = [
          ...historyForUse,
          { role: 'assistant', content: currentAnswer },
          { role: 'user', content: buildRefineRequest(teacherFeedback) }
        ];
      }
      
      currentAnswer = await callOnceWithRole(studentHistory, studentModel, s.refStudentPrompt);
      aiMsg.reflection.turns.push({ role: 'student', round, content: currentAnswer });
      renderMessages();
      
      // ===== 2. 老师评审 =====
      aiMsg.reflection.progressText = `👨‍🏫 老师评审中（第 ${round} 轮）...`;
      renderMessages();
      
      const teacherHistory = [{
        role: 'user',
        content: `【原始问题】\n${userQuestion}\n\n【学生的回答】\n${currentAnswer}\n\n请按 JSON 格式输出评审结果。`
      }];
      const critiqueRaw = await callOnceWithRole(teacherHistory, teacherModel, s.refTeacherPrompt);
      const critique = parseCritique(critiqueRaw);
      
      aiMsg.reflection.turns.push({
        role: 'teacher',
        round,
        score: critique.score,
        issues: critique.issues,
        suggestions: critique.suggestions,
        satisfied: critique.satisfied
      });
      aiMsg.reflection.finalScore = critique.score;
      renderMessages();
      
      teacherFeedback = critique;
      
      // ===== 3. 终止条件 =====
      // ⭐ 分数阈值优先：必须达到 refMinScore 才能结束
      // 老师自评 satisfied=true 也必须配合分数达标，避免老师"心软"提前放行
      if (critique.score >= s.refMinScore) {
        aiMsg.reflection.progressText = `✅ 已达目标分 ${critique.score}/${s.refMinScore}`;
        break;
      }
      if (round === s.refRounds) {
        aiMsg.reflection.progressText = `⏱ 已达最大轮数`;
        break;
      }
    }
    
    aiMsg.content = currentAnswer;
    aiMsg.reflection.inProgress = false;
    if (!aiMsg._endTime) aiMsg._endTime = Date.now();
    delete aiMsg.reflection.progressText;
    renderMessages();
    saveData();
  } catch (e) {
    if (e.name === 'AbortError') aiMsg.content = (aiMsg.content || '') + '\n\n*[已停止]*';
    else aiMsg.content = `❌ 师生模式出错：${e.message}`;
    aiMsg.reflection.inProgress = false;
    if (!aiMsg._endTime) aiMsg._endTime = Date.now();
    delete aiMsg.reflection.progressText;
    renderMessages();
    saveData();
  } finally {
    state.isGenerating = false;
    state.abortCtrl = null;
    updateSendBtn();
  }
}

function buildRefineRequest(c) {
  const issues = (c.issues || []).map((x, i) => `${i + 1}. ${x}`).join('\n') || '（无）';
  const suggestions = (c.suggestions || []).map((x, i) => `${i + 1}. ${x}`).join('\n') || '（无）';
  return `老师评分 ${c.score}/10。\n\n【问题】\n${issues}\n\n【建议】\n${suggestions}\n\n请根据反馈重新给出更好的回答。直接输出新答案。`;
}

function parseCritique(raw) {
  try {
    let txt = raw.trim();
    txt = txt.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '');
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      return {
        score: typeof j.score === 'number' ? j.score : parseInt(j.score) || 5,
        issues: Array.isArray(j.issues) ? j.issues : [],
        suggestions: Array.isArray(j.suggestions) ? j.suggestions : [],
        satisfied: !!j.satisfied
      };
    }
  } catch (e) {}
  return { score: 6, issues: ['解析失败：' + raw.slice(0, 100)], suggestions: [], satisfied: false };
}

// ============ 渲染师生讨论面板 ============

function renderReflectionTurn(t) {
  if (t.role === 'student') {
    return `
      <div class="ref-turn student">
        <div class="ref-turn-header">
          <span class="ref-avatar">学</span>
          <span>学生 · 第 ${t.round} 轮回答</span>
        </div>
        <div class="ref-turn-body">${renderMarkdown(t.content || '')}</div>
      </div>`;
  } else {
    const sc = t.score ?? 0;
    const scClass = sc >= 8 ? 'good' : sc >= 5 ? 'mid' : 'bad';
    const issues = (t.issues || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
    const suggestions = (t.suggestions || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
    return `
      <div class="ref-turn teacher">
        <div class="ref-turn-header">
          <span class="ref-avatar">师</span>
          <span>老师 · 第 ${t.round} 轮评审</span>
          <span class="ref-score ${scClass}">评分 ${sc}/10</span>
        </div>
        <div class="ref-turn-body">
          ${t.satisfied ? '<div class="ref-pass">✅ 评审通过</div>' : ''}
          ${issues ? `<div class="ref-section-title">❌ 问题</div><ul class="ref-list">${issues}</ul>` : ''}
          ${suggestions ? `<div class="ref-section-title">💡 建议</div><ul class="ref-list">${suggestions}</ul>` : ''}
        </div>
      </div>`;
  }
}

function toggleReflectionPanel(idx) {
  const c = currentChat();
  if (!c || !c.messages[idx] || !c.messages[idx].reflection) return;
  c.messages[idx].reflection.expanded = !c.messages[idx].reflection.expanded;
  const panel = document.querySelector(`.reflection-panel[data-msg-idx="${idx}"]`);
  if (panel) panel.classList.toggle('collapsed');
  saveData();
}

// ============ 设置面板 ============

function openReflectionSettings() {
  document.getElementById('reflectionModal').classList.add('show');
  const s = state.settings;
  document.getElementById('ref_enabled').checked = s.useReflection;
  document.getElementById('ref_rounds').value = s.refRounds;
  document.getElementById('refRoundsVal').textContent = s.refRounds;
  document.getElementById('ref_minScore').value = s.refMinScore;
  document.getElementById('refScoreVal').textContent = s.refMinScore;
  document.getElementById('ref_studentModel').value = s.refStudentModel;
  document.getElementById('ref_teacherModel').value = s.refTeacherModel;
  document.getElementById('ref_studentPrompt').value = s.refStudentPrompt;
  document.getElementById('ref_teacherPrompt').value = s.refTeacherPrompt;
}

function closeReflectionSettings() {
  document.getElementById('reflectionModal').classList.remove('show');
}

function applyPreset(key) {
  const p = REFLECTION_PRESETS[key];
  if (!p) return;
  document.getElementById('ref_studentPrompt').value = p.student;
  document.getElementById('ref_teacherPrompt').value = p.teacher;
  toast('✓ 已应用预设');
}

function saveReflectionSettings() {
  const s = state.settings;
  s.useReflection = document.getElementById('ref_enabled').checked;
  s.refRounds = parseInt(document.getElementById('ref_rounds').value);
  s.refMinScore = parseInt(document.getElementById('ref_minScore').value);
  s.refStudentModel = document.getElementById('ref_studentModel').value.trim();
  s.refTeacherModel = document.getElementById('ref_teacherModel').value.trim();
  s.refStudentPrompt = document.getElementById('ref_studentPrompt').value;
  s.refTeacherPrompt = document.getElementById('ref_teacherPrompt').value;
  // 互斥：保存时若启用师生，关闭 Plan / 大纲
  if (s.useReflection) {
    s.usePlan = false;
    s.useOutline = false;
    const planBtn = document.getElementById('planBtn');
    const outlineBtn = document.getElementById('outlineBtn');
    if (planBtn) planBtn.classList.remove('plan-active');
    if (outlineBtn) outlineBtn.classList.remove('outline-active');
  }
  persistSettings();
  const btn = document.getElementById('reflectBtn');
  if (s.useReflection) btn.classList.add('reflect-active');
  else btn.classList.remove('reflect-active');
  updateSendBtn();
  closeReflectionSettings();
  toast('✓ 已保存');
}

function toggleReflection() {
  const s = state.settings;
  s.useReflection = !s.useReflection;
  // 互斥：开启师生时关闭 Plan / 大纲
  if (s.useReflection) {
    s.usePlan = false;
    s.useOutline = false;
    const planBtn = document.getElementById('planBtn');
    const outlineBtn = document.getElementById('outlineBtn');
    if (planBtn) planBtn.classList.remove('plan-active');
    if (outlineBtn) outlineBtn.classList.remove('outline-active');
  }
  const btn = document.getElementById('reflectBtn');
  if (s.useReflection) btn.classList.add('reflect-active');
  else btn.classList.remove('reflect-active');
  persistSettings();
  updateSendBtn();
  toast(s.useReflection ? '✓ 已启用师生' : '✓ 已关闭师生');
}