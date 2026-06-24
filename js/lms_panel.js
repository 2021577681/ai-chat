// ============ 🎓 LMS 学习面板 UI ============
// 顶部 🎓 学习 按钮 → 打开抽屉面板
// 4 个标签页：📊 概览 / 📝 待办 / 📚 课程 / 📂 课件

const LMS_PANEL_STATE = {
  page: 'home',              // home | lms | scores | schedule | emptyRooms | attendance | judge
  tab: 'overview',           // overview | todos | courses | materials
  loading: false,
  authMode: 'login',
  loginFlowId: '',
  loginUsesSavedCredential: false,
  cache: {                    // 缓存上次拉取结果
    todos: null,
    courses: null,
    materialsByCid: {},
    scores: null,
    scoreSummary: null,
    scheduleLessons: null,
    scheduleSummary: null,
    emptyRooms: null,
    emptyRoomSummary: null,
    attendanceFlows: null,
    attendanceSubjects: null,
    attendanceStatistics: null,
    attendancePagination: null,
    judgeQuestionnaires: null,
    judgeResults: null,
  },
  selectedCid: null,         // 当前 materials 页选中的课程 id
  scoreAccountType: 'auto',
  scoreResolvedAccountType: '',
  scoreTerm: '',
  scoreSelectedKeys: null,
  scoreError: '',
  scheduleAccountType: 'auto',
  scheduleResolvedAccountType: '',
  scheduleResultTerm: '',
  scheduleTerm: '',
  scheduleError: '',
  emptyRoomCampus: '兴庆校区',
  emptyRoomBuilding: '主楼D',
  emptyRoomDate: '',
  emptyRoomStartPeriod: 1,
  emptyRoomEndPeriod: 11,
  emptyRoomError: '',
  attendanceAccountType: 'auto',
  attendanceAccessMode: 'auto',
  attendanceResolvedAccountType: '',
  attendanceResolvedAccessMode: '',
  attendanceStartDate: '',
  attendanceEndDate: '',
  attendancePage: 1,
  attendancePageSize: 20,
  attendanceError: '',
  judgeAccountType: 'auto',
  judgeResolvedAccountType: '',
  judgeScore: '100',
  judgeGraduateScore: '3',
  judgeComment: '无',
  judgeError: '',
};

const LMS_EMPTY_ROOM_OPTIONS = {
  '兴庆校区': [
    '主楼A', '主楼B', '主楼C', '主楼D', '中2', '中3', '西2东', '西2西',
    '外文楼A', '外文楼B', '东1东', '东2', '仲英楼', '东1西', '教2西',
    '教2楼', '中1', '主楼E座', '工程馆', '工程坊A区', '文管', '计教中心', '田家炳',
  ],
  '雁塔校区': [
    '东配楼', '微免楼', '综合楼', '教学楼', '药学楼', '解剖楼', '生化楼',
    '病理楼', '西配楼', '一附院科教楼', '二院教学楼', '护理楼', '卫法楼',
  ],
  '曲江校区': ['西一楼', '西五楼', '西四楼', '西六楼'],
  '创新港校区': [
    '1号巨构', '2号巨构', '3号巨构', '4号巨构', '5号巨构', '9号巨构',
    '18号巨构', '19号巨构', '20号巨构', '21号巨构', '图书馆', '2号绿楔',
    '3号绿楔', '主楼运动场', '工程博物馆-创新港',
  ],
  '苏州校区': ['公共学院5号楼'],
};

function lmsPanelEmptyCache() {
  return {
    todos: null,
    courses: null,
    materialsByCid: {},
    scores: null,
    scoreSummary: null,
    scheduleLessons: null,
    scheduleSummary: null,
    emptyRooms: null,
    emptyRoomSummary: null,
    attendanceFlows: null,
    attendanceSubjects: null,
    attendanceStatistics: null,
    attendancePagination: null,
    judgeQuestionnaires: null,
    judgeResults: null,
  };
}

function openLmsPanel() {
  LMS_PANEL_STATE.page = 'home';
  document.getElementById('lmsPanel').classList.add('show');
  lmsPanelRefreshStatus();
  lmsPanelRender();
}

function closeLmsPanel() {
  document.getElementById('lmsPanel').classList.remove('show');
}

function lmsPanelSetPage(page) {
  LMS_PANEL_STATE.page = page || 'home';
  lmsPanelRender();
  if (LMS_PANEL_STATE.page === 'lms' && lmsGetCookie() && !LMS_PANEL_STATE.cache.todos) {
    lmsPanelFetchAll();
  }
}

function lmsPanelSetTab(tab) {
  LMS_PANEL_STATE.page = 'lms';
  LMS_PANEL_STATE.tab = tab;
  lmsPanelRender();
}

/**
 * 刷新顶部状态栏（Cookie 状态徽章）
 */
function lmsPanelRefreshStatus() {
  const el = document.getElementById('lmsStatusBar');
  if (!el) return;
  const cookie = lmsGetCookie();
  if (!cookie) {
    el.innerHTML = `
      <span class="lms-badge lms-badge-warn">⚠️ 未配置 Cookie</span>
      <span class="lms-status-hint">可直接使用统一认证登录</span>
      <button class="lms-mini-btn" onclick="lmsPanelOpenCookieEditor('login')">登录</button>
      <button class="lms-mini-btn" onclick="lmsPanelOpenCookieEditor('cookie')">手动 Cookie</button>
    `;
    return;
  }
  const info = lmsParseSession(cookie);
  if (!info) {
    // ⚠️ Cookie 已保存但解析失败（粘错了 / 缺 session 字段 / 格式有误）
    // 必须给出「修改」和「清空」入口，否则用户会被困死无法纠错。
    el.innerHTML = `
      <span class="lms-badge lms-badge-warn">⚠️ Cookie 格式异常</span>
      <span class="lms-status-hint">未找到 session 字段</span>
      <button class="lms-mini-btn" onclick="lmsPanelOpenCookieEditor('login')">重新登录</button>
      <button class="lms-mini-btn" onclick="lmsPanelOpenCookieEditor('cookie')">✏️ 修改</button>
      <button class="lms-mini-btn" onclick="lmsPanelClearCookie()">🗑 清空</button>
    `;
    return;
  }
  const h = info.remainMs / 3600000;
  const uidSafe = escapeHtml(String(info.uid || '-'));
  if (h < 0) {
    el.innerHTML = `
      <span class="lms-badge lms-badge-err">⛔ 已过期 ${(-h).toFixed(1)} 小时</span>
      <button class="lms-mini-btn" onclick="lmsPanelOpenCookieEditor('login')">重新登录</button>
      <button class="lms-mini-btn" onclick="lmsPanelOpenCookieEditor('cookie')">手动更新</button>
    `;
  } else if (h < 2) {
    el.innerHTML = `
      <span class="lms-badge lms-badge-warn">⏰ 即将过期 ${h.toFixed(1)}h</span>
      <span class="lms-status-hint">👤 ${uidSafe}</span>
      <button class="lms-mini-btn" onclick="lmsPanelOpenCookieEditor('login')">重新登录</button>
    `;
  } else {
    el.innerHTML = `
      <span class="lms-badge lms-badge-ok">✅ Cookie 有效</span>
      <span class="lms-status-hint">👤 ${uidSafe} · 还有 ${h.toFixed(1)}h</span>
      <button class="lms-mini-btn" onclick="lmsPanelOpenCookieEditor('login')">重新登录</button>
      <button class="lms-mini-btn" onclick="lmsPanelOpenCookieEditor('cookie')">✏️ Cookie</button>
    `;
  }
}

/**
 * 顶层渲染：根据 tab 渲染对应内容
 */
function lmsPanelRender() {
  // 标签按钮选中态
  ['overview', 'todos', 'courses', 'materials'].forEach(t => {
    const b = document.getElementById('lmsTab_' + t);
    if (b) b.classList.toggle('active', LMS_PANEL_STATE.tab === t);
  });

  const tabs = document.getElementById('lmsPanelTabs');
  if (tabs) tabs.style.display = LMS_PANEL_STATE.page === 'lms' ? '' : 'none';

  const body = document.getElementById('lmsPanelBody');
  if (!body) return;

  if (LMS_PANEL_STATE.page === 'home') {
    body.innerHTML = lmsPanelRenderHome();
    return;
  }

  if (LMS_PANEL_STATE.page === 'scores') {
    body.innerHTML = lmsPanelRenderScoresPage();
    return;
  }

  if (LMS_PANEL_STATE.page === 'schedule') {
    body.innerHTML = lmsPanelRenderSchedulePage();
    return;
  }

  if (LMS_PANEL_STATE.page === 'emptyRooms') {
    body.innerHTML = lmsPanelRenderEmptyRoomsPage();
    return;
  }

  if (LMS_PANEL_STATE.page === 'attendance') {
    body.innerHTML = lmsPanelRenderAttendancePage();
    return;
  }

  if (LMS_PANEL_STATE.page === 'judge') {
    body.innerHTML = lmsPanelRenderJudgePage();
    return;
  }

  const _cookie = lmsGetCookie();
  if (!_cookie) {
    body.innerHTML = lmsPanelRenderSubHeader('思源学堂') + lmsPanelRenderNoCookie();
    return;
  }
  // 🛠 Cookie 已保存但解析失败 → 直接进入"修复模式"，避免用户被困
  if (!lmsParseSession(_cookie)) {
    body.innerHTML = lmsPanelRenderSubHeader('思源学堂') + lmsPanelRenderBadCookie();
    return;
  }

  let content = '';
  switch (LMS_PANEL_STATE.tab) {
    case 'overview':  content = lmsPanelRenderOverview(); break;
    case 'todos':     content = lmsPanelRenderTodos();    break;
    case 'courses':   content = lmsPanelRenderCourses();  break;
    case 'materials': content = lmsPanelRenderMaterials();break;
    default:          content = lmsPanelRenderOverview(); break;
  }
  body.innerHTML = lmsPanelRenderSubHeader('思源学堂') + content;
}

// ============ 各个标签页内容 ============

function lmsPanelRenderSubHeader(title) {
  return `
    <div class="lms-subpage-head">
      <button class="lms-mini-btn" onclick="lmsPanelSetPage('home')">返回</button>
      <div class="lms-subpage-title">${escapeHtml(title || '')}</div>
    </div>
  `;
}

function lmsPanelRenderHome() {
  return `
    <div class="lms-nav-page">
      <div class="lms-nav-list">
        <button class="lms-nav-btn" onclick="lmsPanelSetPage('lms')">
          <span class="lms-nav-title">思源学堂</span>
          <span class="lms-nav-desc">课程、待办、作业详情和课件下载</span>
        </button>
        <button class="lms-nav-btn" onclick="lmsPanelSetPage('scores')">
          <span class="lms-nav-title">成绩查询</span>
          <span class="lms-nav-desc">查询本科教务或研究生系统成绩</span>
        </button>
        <button class="lms-nav-btn" onclick="lmsPanelSetPage('schedule')">
          <span class="lms-nav-title">课表查询</span>
          <span class="lms-nav-desc">查询当前或指定学期课表</span>
        </button>
        <button class="lms-nav-btn" onclick="lmsPanelSetPage('emptyRooms')">
          <span class="lms-nav-title">空闲教室</span>
          <span class="lms-nav-desc">按校区、教学楼、日期和节次查询空教室</span>
        </button>
        <button class="lms-nav-btn" onclick="lmsPanelSetPage('attendance')">
          <span class="lms-nav-title">考勤查询</span>
          <span class="lms-nav-desc">查询刷卡流水、课程考勤和出勤统计</span>
        </button>
        <button class="lms-nav-btn" onclick="lmsPanelSetPage('judge')">
          <span class="lms-nav-title">一键评教</span>
          <span class="lms-nav-desc">查看未评教问卷，并批量提交评教</span>
        </button>
      </div>
    </div>
  `;
}

function lmsPanelRenderScoresPage() {
  const accountType = LMS_PANEL_STATE.scoreAccountType || 'auto';
  const term = LMS_PANEL_STATE.scoreTerm || '';
  const scores = LMS_PANEL_STATE.cache.scores;
  const summary = LMS_PANEL_STATE.cache.scoreSummary || {};
  const selectedScores = Array.isArray(scores) ? lmsPanelGetSelectedScores(scores) : [];
  const selectedSummary = Array.isArray(scores) ? lmsPanelSummarizeScores(selectedScores) : summary;
  const resolvedType = LMS_PANEL_STATE.scoreResolvedAccountType || accountType;

  let html = lmsPanelRenderSubHeader('成绩查询');
  html += `
    <div class="lms-score-controls">
      <label class="lms-score-field">
        <span>身份</span>
        <select id="lmsScoreAccountType" class="lms-login-input" onchange="lmsPanelSetScoreAccountType(this.value)">
          <option value="auto" ${accountType === 'auto' ? 'selected' : ''}>自动识别</option>
          <option value="undergraduate" ${accountType === 'undergraduate' ? 'selected' : ''}>本科生</option>
          <option value="postgraduate" ${accountType === 'postgraduate' ? 'selected' : ''}>研究生</option>
        </select>
      </label>
      <label class="lms-score-field">
        <span>学期</span>
        <input id="lmsScoreTerm" class="lms-login-input" value="${escapeHtml(term)}" placeholder="留空/填 all 查询全部；或如 2024-2025-1" oninput="lmsPanelSetScoreTerm(this.value)">
      </label>
      <button class="lms-big-btn lms-score-query-btn" onclick="lmsPanelFetchScores()">查询成绩</button>
    </div>
  `;

  if (LMS_PANEL_STATE.scoreError) {
    html += `
      <div class="lms-score-error">
        <div>${escapeHtml(LMS_PANEL_STATE.scoreError)}</div>
        <button class="lms-mini-btn" onclick="lmsPanelOpenCredentialLogin()">打开登录并保存凭据</button>
      </div>
    `;
  }

  if (!scores) {
    html += `
      <div class="lms-empty-mini">
        成绩查询使用本机加密保存的统一认证账号密码。
      </div>
    `;
    return html;
  }

  const allSelected = selectedScores.length === scores.length;

  if (!scores.length) {
    html += '<div class="lms-empty"><h3>未查询到成绩</h3><p>可以切换身份后重试。</p></div>';
    return html;
  }

  html += `
    <div class="lms-score-selection-bar">
      <div>
        已选择 <b>${selectedScores.length}</b> / ${scores.length} 门课程用于统计
        ${term ? '' : '<span class="lms-score-tip">当前为全部学期结果</span>'}
      </div>
      <div class="lms-score-selection-actions">
        <button class="lms-mini-btn" onclick="lmsPanelSelectAllScores(true)" ${allSelected ? 'disabled' : ''}>全选</button>
        <button class="lms-mini-btn" onclick="lmsPanelSelectAllScores(false)" ${selectedScores.length ? '' : 'disabled'}>清空</button>
      </div>
    </div>
    <div class="lms-score-summary">
      <div class="lms-stat-card">
        <div class="lms-stat-num">${selectedSummary.count ?? selectedScores.length}</div>
        <div class="lms-stat-lbl">已选课程数</div>
      </div>
      <div class="lms-stat-card">
        <div class="lms-stat-num">${lmsFmtScoreValue(selectedSummary.totalCredits)}</div>
        <div class="lms-stat-lbl">已选总学分</div>
      </div>
      <div class="lms-stat-card">
        <div class="lms-stat-num">${lmsFmtScoreValue(selectedSummary.weightedAverageScore)}</div>
        <div class="lms-stat-lbl">已选加权平均分</div>
      </div>
      <div class="lms-stat-card">
        <div class="lms-stat-num">${lmsFmtScoreValue(selectedSummary.weightedGpa)}</div>
        <div class="lms-stat-lbl">已选加权 GPA</div>
      </div>
    </div>
    <div class="lms-score-table-wrap">
      <table class="lms-score-table">
        <thead>
          <tr>
            <th><input type="checkbox" ${allSelected ? 'checked' : ''} onchange="lmsPanelSelectAllScores(this.checked)"></th>
            <th>学期/类型</th>
            <th>课程</th>
            <th>学分</th>
            <th>成绩</th>
            <th>GPA</th>
          </tr>
        </thead>
        <tbody>
          ${scores.map((item, idx) => lmsPanelRenderScoreRow(item, idx)).join('')}
        </tbody>
      </table>
    </div>
  `;
  return html;
}

function lmsPanelScoreKey(item, idx) {
  return [
    item && (item.term || item.type || ''),
    item && (item.courseCode || ''),
    item && (item.courseName || ''),
    item && (item.coursePoint ?? ''),
    item && (item.score ?? ''),
    idx,
  ].map(v => String(v).replace(/\|/g, '/')).join('|');
}

function lmsPanelGetScoreSelectedMap(scores) {
  if (!LMS_PANEL_STATE.scoreSelectedKeys || typeof LMS_PANEL_STATE.scoreSelectedKeys !== 'object') {
    const map = {};
    (scores || []).forEach((item, idx) => { map[lmsPanelScoreKey(item, idx)] = true; });
    LMS_PANEL_STATE.scoreSelectedKeys = map;
  }
  return LMS_PANEL_STATE.scoreSelectedKeys;
}

function lmsPanelIsScoreSelected(item, idx) {
  const scores = LMS_PANEL_STATE.cache.scores || [];
  const map = lmsPanelGetScoreSelectedMap(scores);
  return !!map[lmsPanelScoreKey(item, idx)];
}

function lmsPanelGetSelectedScores(scores) {
  const map = lmsPanelGetScoreSelectedMap(scores || []);
  return (scores || []).filter((item, idx) => !!map[lmsPanelScoreKey(item, idx)]);
}

function lmsPanelToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function lmsPanelSummarizeScores(scores) {
  let totalCredits = 0;
  let weightedScoreSum = 0;
  let weightedScoreCredits = 0;
  let weightedGpaSum = 0;
  let weightedGpaCredits = 0;
  let passed = 0;
  let failed = 0;

  (scores || []).forEach(item => {
    const credit = lmsPanelToNumber(item.coursePoint) || 0;
    const score = lmsPanelToNumber(item.score);
    const gpa = lmsPanelToNumber(item.gpa);
    if (credit > 0) totalCredits += credit;
    if (score !== null && credit > 0) {
      weightedScoreSum += score * credit;
      weightedScoreCredits += credit;
    }
    if (gpa !== null && credit > 0) {
      weightedGpaSum += gpa * credit;
      weightedGpaCredits += credit;
    }
    if (item.passFlag === true) passed += 1;
    else if (item.passFlag === false) failed += 1;
  });

  return {
    count: (scores || []).length,
    totalCredits: Math.round(totalCredits * 100) / 100,
    weightedAverageScore: weightedScoreCredits ? Math.round((weightedScoreSum / weightedScoreCredits) * 100) / 100 : null,
    weightedGpa: weightedGpaCredits ? Math.round((weightedGpaSum / weightedGpaCredits) * 1000) / 1000 : null,
    passed,
    failed,
  };
}

function lmsPanelRenderScoreRow(item, idx) {
  const group = item.term || item.type || '-';
  const failed = item.passFlag === false ? ' failed' : '';
  const key = lmsPanelScoreKey(item, idx);
  const checked = lmsPanelIsScoreSelected(item, idx) ? 'checked' : '';
  return `
    <tr class="${failed}">
      <td><input type="checkbox" ${checked} onchange="lmsPanelToggleScoreSelection('${escapeHtml(key)}', this.checked)"></td>
      <td>${escapeHtml(group)}</td>
      <td>${escapeHtml(item.courseName || '-')}</td>
      <td>${escapeHtml(lmsFmtScoreValue(item.coursePoint))}</td>
      <td>${escapeHtml(lmsFmtScoreValue(item.score))}</td>
      <td>${escapeHtml(lmsFmtScoreValue(item.gpa))}</td>
    </tr>
  `;
}

function lmsPanelToggleScoreSelection(key, checked) {
  const scores = LMS_PANEL_STATE.cache.scores || [];
  const map = lmsPanelGetScoreSelectedMap(scores);
  map[key] = !!checked;
  lmsPanelRender();
}

function lmsPanelSelectAllScores(checked) {
  const scores = LMS_PANEL_STATE.cache.scores || [];
  const map = {};
  scores.forEach((item, idx) => {
    map[lmsPanelScoreKey(item, idx)] = !!checked;
  });
  LMS_PANEL_STATE.scoreSelectedKeys = map;
  lmsPanelRender();
}

function lmsPanelSetScoreAccountType(value) {
  LMS_PANEL_STATE.scoreAccountType = value || 'auto';
}

function lmsPanelSetScoreTerm(value) {
  LMS_PANEL_STATE.scoreTerm = value || '';
}

function lmsPanelOpenCredentialLogin() {
  lmsPanelOpenCookieEditor('login');
  const remember = document.getElementById('lmsLoginRemember');
  if (remember) remember.checked = true;
}

function lmsPanelRenderSchedulePage() {
  const accountType = LMS_PANEL_STATE.scheduleAccountType || 'auto';
  const term = LMS_PANEL_STATE.scheduleTerm || '';
  const lessons = LMS_PANEL_STATE.cache.scheduleLessons;
  const summary = LMS_PANEL_STATE.cache.scheduleSummary || {};
  const resolvedType = LMS_PANEL_STATE.scheduleResolvedAccountType || accountType;

  let html = lmsPanelRenderSubHeader('课表查询');
  html += `
    <div class="lms-score-controls">
      <label class="lms-score-field">
        <span>身份</span>
        <select id="lmsScheduleAccountType" class="lms-login-input" onchange="lmsPanelSetScheduleAccountType(this.value)">
          <option value="auto" ${accountType === 'auto' ? 'selected' : ''}>自动识别</option>
          <option value="undergraduate" ${accountType === 'undergraduate' ? 'selected' : ''}>本科生</option>
          <option value="postgraduate" ${accountType === 'postgraduate' ? 'selected' : ''}>研究生</option>
        </select>
      </label>
      <label class="lms-score-field">
        <span>学期</span>
        <input id="lmsScheduleTerm" class="lms-login-input" value="${escapeHtml(term)}" placeholder="留空查当前学期，如 2024-2025-1" oninput="lmsPanelSetScheduleTerm(this.value)">
      </label>
      <button class="lms-big-btn lms-score-query-btn" onclick="lmsPanelFetchSchedule()">查询课表</button>
    </div>
  `;

  if (LMS_PANEL_STATE.scheduleError) {
    html += `
      <div class="lms-score-error">
        <div>${escapeHtml(LMS_PANEL_STATE.scheduleError)}</div>
        <button class="lms-mini-btn" onclick="lmsPanelOpenCredentialLogin()">打开登录并保存凭据</button>
      </div>
    `;
  }

  if (!lessons) {
    html += `
      <div class="lms-empty-mini">
        课表查询使用本机加密保存的统一认证账号密码。
      </div>
    `;
    return html;
  }

  if (!lessons.length) {
    html += '<div class="lms-empty"><h3>未查询到课表</h3><p>可以切换身份或学期后重试。</p></div>';
    return html;
  }

  html += `
    <div class="lms-schedule-summary">
      <span>${escapeHtml(lmsScoreAccountLabel(resolvedType))}</span>
      <span>${escapeHtml(LMS_PANEL_STATE.scheduleResultTerm || '')}</span>
      <span>共 ${summary.count ?? lessons.length} 条课程安排</span>
    </div>
    <div class="lms-score-table-wrap">
      <table class="lms-score-table lms-schedule-table">
        <thead>
          <tr>
            <th>星期</th>
            <th>节次</th>
            <th>课程</th>
            <th>地点</th>
            <th>教师</th>
            <th>周次</th>
          </tr>
        </thead>
        <tbody>
          ${lessons.map(lmsPanelRenderScheduleRow).join('')}
        </tbody>
      </table>
    </div>
  `;
  return html;
}

function lmsPanelRenderScheduleRow(item) {
  return `
    <tr>
      <td>${escapeHtml(lmsWeekdayName(item.dayOfWeek))}</td>
      <td>${escapeHtml(lmsFmtScoreValue(item.periodStart))}-${escapeHtml(lmsFmtScoreValue(item.periodEnd))}</td>
      <td>${escapeHtml(item.name || '-')}</td>
      <td>${escapeHtml(item.classroom || '-')}</td>
      <td>${escapeHtml(item.teacher || '-')}</td>
      <td>${escapeHtml(item.weeksText || '-')}</td>
    </tr>
  `;
}

function lmsPanelSetScheduleAccountType(value) {
  LMS_PANEL_STATE.scheduleAccountType = value || 'auto';
}

function lmsPanelSetScheduleTerm(value) {
  LMS_PANEL_STATE.scheduleTerm = value || '';
}

function lmsPanelTodayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lmsPanelRenderEmptyRoomCampusOptions(selected) {
  return Object.keys(LMS_EMPTY_ROOM_OPTIONS).map(campus =>
    `<option value="${escapeHtml(campus)}" ${campus === selected ? 'selected' : ''}>${escapeHtml(campus)}</option>`
  ).join('');
}

function lmsPanelRenderEmptyRoomBuildingOptions(campus, selected) {
  const buildings = LMS_EMPTY_ROOM_OPTIONS[campus] || [];
  return buildings.map(building =>
    `<option value="${escapeHtml(building)}" ${building === selected ? 'selected' : ''}>${escapeHtml(building)}</option>`
  ).join('');
}

function lmsPanelRenderPeriodOptions(selected) {
  const current = Number(selected) || 1;
  return Array.from({ length: 11 }, (_, idx) => idx + 1)
    .map(period => `<option value="${period}" ${period === current ? 'selected' : ''}>第 ${period} 节</option>`)
    .join('');
}

function lmsPanelRenderEmptyRoomsPage() {
  const campus = LMS_PANEL_STATE.emptyRoomCampus || '兴庆校区';
  const buildings = LMS_EMPTY_ROOM_OPTIONS[campus] || [];
  const building = buildings.includes(LMS_PANEL_STATE.emptyRoomBuilding)
    ? LMS_PANEL_STATE.emptyRoomBuilding
    : (buildings[0] || '');
  LMS_PANEL_STATE.emptyRoomBuilding = building;

  const queryDate = LMS_PANEL_STATE.emptyRoomDate || lmsPanelTodayString();
  const startPeriod = Number(LMS_PANEL_STATE.emptyRoomStartPeriod) || 1;
  const endPeriod = Number(LMS_PANEL_STATE.emptyRoomEndPeriod) || 11;
  const rooms = LMS_PANEL_STATE.cache.emptyRooms;
  const summary = LMS_PANEL_STATE.cache.emptyRoomSummary || {};

  let html = lmsPanelRenderSubHeader('空闲教室');
  html += `
    <div class="lms-score-controls">
      <label class="lms-score-field">
        <span>校区</span>
        <select id="lmsEmptyRoomCampus" class="lms-login-input" onchange="lmsPanelSetEmptyRoomCampus(this.value)">
          ${lmsPanelRenderEmptyRoomCampusOptions(campus)}
        </select>
      </label>
      <label class="lms-score-field">
        <span>教学楼</span>
        <select id="lmsEmptyRoomBuilding" class="lms-login-input" onchange="lmsPanelSetEmptyRoomBuilding(this.value)">
          ${lmsPanelRenderEmptyRoomBuildingOptions(campus, building)}
        </select>
      </label>
      <label class="lms-score-field">
        <span>日期</span>
        <input id="lmsEmptyRoomDate" class="lms-login-input" type="date" value="${escapeHtml(queryDate)}" onchange="lmsPanelSetEmptyRoomDate(this.value)">
      </label>
      <div class="lms-period-grid">
        <label class="lms-score-field">
          <span>开始节次</span>
          <select id="lmsEmptyRoomStartPeriod" class="lms-login-input" onchange="lmsPanelSetEmptyRoomStartPeriod(this.value)">
            ${lmsPanelRenderPeriodOptions(startPeriod)}
          </select>
        </label>
        <label class="lms-score-field">
          <span>结束节次</span>
          <select id="lmsEmptyRoomEndPeriod" class="lms-login-input" onchange="lmsPanelSetEmptyRoomEndPeriod(this.value)">
            ${lmsPanelRenderPeriodOptions(endPeriod)}
          </select>
        </label>
      </div>
      <button class="lms-big-btn lms-score-query-btn" onclick="lmsPanelFetchEmptyRooms()">查询空闲教室</button>
    </div>
  `;

  if (LMS_PANEL_STATE.emptyRoomError) {
    html += `
      <div class="lms-score-error">
        <div>${escapeHtml(LMS_PANEL_STATE.emptyRoomError)}</div>
        <button class="lms-mini-btn" onclick="lmsPanelOpenCredentialLogin()">打开登录并保存凭据</button>
      </div>
    `;
  }

  if (!rooms) {
    html += `
      <div class="lms-empty-mini">
        空闲教室查询使用本机加密保存的统一认证账号密码，并访问本科教务系统。
      </div>
    `;
    return html;
  }

  if (!rooms.length) {
    html += '<div class="lms-empty"><h3>未查询到空闲教室</h3><p>可以切换教学楼、日期或节次后重试。</p></div>';
    return html;
  }

  html += `
    <div class="lms-schedule-summary">
      <span>${escapeHtml(campus)}</span>
      <span>${escapeHtml(building)}</span>
      <span>${escapeHtml(queryDate)}</span>
      <span>第 ${startPeriod}-${endPeriod} 节</span>
      <span>共 ${summary.count ?? rooms.length} 间</span>
    </div>
    <div class="lms-score-table-wrap">
      <table class="lms-score-table lms-empty-room-table">
        <thead>
          <tr>
            <th>教室</th>
            <th>教学楼</th>
            <th>类型</th>
            <th>座位</th>
            <th>考试座位</th>
            <th>校区</th>
          </tr>
        </thead>
        <tbody>
          ${rooms.map(lmsPanelRenderEmptyRoomRow).join('')}
        </tbody>
      </table>
    </div>
  `;
  return html;
}

function lmsPanelRenderEmptyRoomRow(item) {
  return `
    <tr>
      <td>${escapeHtml(item.name || '-')}</td>
      <td>${escapeHtml(item.buildingName || '-')}</td>
      <td>${escapeHtml(item.type || '-')}</td>
      <td>${escapeHtml(lmsFmtScoreValue(item.capacity))}</td>
      <td>${escapeHtml(lmsFmtScoreValue(item.examCapacity))}</td>
      <td>${escapeHtml(item.campusName || '-')}</td>
    </tr>
  `;
}

function lmsPanelSetEmptyRoomCampus(value) {
  LMS_PANEL_STATE.emptyRoomCampus = value || '兴庆校区';
  const buildings = LMS_EMPTY_ROOM_OPTIONS[LMS_PANEL_STATE.emptyRoomCampus] || [];
  if (!buildings.includes(LMS_PANEL_STATE.emptyRoomBuilding)) {
    LMS_PANEL_STATE.emptyRoomBuilding = buildings[0] || '';
  }
  LMS_PANEL_STATE.cache.emptyRooms = null;
  LMS_PANEL_STATE.cache.emptyRoomSummary = null;
  LMS_PANEL_STATE.emptyRoomError = '';
  lmsPanelRender();
}

function lmsPanelSetEmptyRoomBuilding(value) {
  LMS_PANEL_STATE.emptyRoomBuilding = value || '';
}

function lmsPanelSetEmptyRoomDate(value) {
  LMS_PANEL_STATE.emptyRoomDate = value || '';
}

function lmsPanelSetEmptyRoomStartPeriod(value) {
  LMS_PANEL_STATE.emptyRoomStartPeriod = Number(value) || 1;
}

function lmsPanelSetEmptyRoomEndPeriod(value) {
  LMS_PANEL_STATE.emptyRoomEndPeriod = Number(value) || 11;
}

function lmsPanelDateOffsetString(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lmsPanelAttendanceAccessModeLabel(mode) {
  if (mode === 'webvpn') return 'WebVPN';
  if (mode === 'normal') return '普通直连';
  return '自动';
}

function lmsPanelRenderAttendancePage() {
  const accountType = LMS_PANEL_STATE.attendanceAccountType || 'auto';
  const accessMode = LMS_PANEL_STATE.attendanceAccessMode || 'auto';
  const startDate = LMS_PANEL_STATE.attendanceStartDate || lmsPanelDateOffsetString(-30);
  const endDate = LMS_PANEL_STATE.attendanceEndDate || lmsPanelTodayString();
  const page = Number(LMS_PANEL_STATE.attendancePage) || 1;
  const pageSize = Number(LMS_PANEL_STATE.attendancePageSize) || 20;
  const flows = LMS_PANEL_STATE.cache.attendanceFlows;
  const subjects = LMS_PANEL_STATE.cache.attendanceSubjects || [];
  const stats = LMS_PANEL_STATE.cache.attendanceStatistics || {};
  const pagination = LMS_PANEL_STATE.cache.attendancePagination || {};
  const resolvedType = LMS_PANEL_STATE.attendanceResolvedAccountType || accountType;
  const resolvedAccessMode = LMS_PANEL_STATE.attendanceResolvedAccessMode || accessMode;

  let html = lmsPanelRenderSubHeader('考勤查询');
  html += `
    <div class="lms-score-controls">
      <label class="lms-score-field">
        <span>身份</span>
        <select id="lmsAttendanceAccountType" class="lms-login-input" onchange="lmsPanelSetAttendanceAccountType(this.value)">
          <option value="auto" ${accountType === 'auto' ? 'selected' : ''}>自动识别</option>
          <option value="undergraduate" ${accountType === 'undergraduate' ? 'selected' : ''}>本科生</option>
          <option value="postgraduate" ${accountType === 'postgraduate' ? 'selected' : ''}>研究生</option>
        </select>
      </label>
      <label class="lms-score-field">
        <span>访问方式</span>
        <select id="lmsAttendanceAccessMode" class="lms-login-input" onchange="lmsPanelSetAttendanceAccessMode(this.value)">
          <option value="auto" ${accessMode === 'auto' ? 'selected' : ''}>自动</option>
          <option value="normal" ${accessMode === 'normal' ? 'selected' : ''}>普通直连</option>
          <option value="webvpn" ${accessMode === 'webvpn' ? 'selected' : ''}>WebVPN</option>
        </select>
      </label>
      <div class="lms-period-grid">
        <label class="lms-score-field">
          <span>开始日期</span>
          <input id="lmsAttendanceStartDate" class="lms-login-input" type="date" value="${escapeHtml(startDate)}" onchange="lmsPanelSetAttendanceStartDate(this.value)">
        </label>
        <label class="lms-score-field">
          <span>结束日期</span>
          <input id="lmsAttendanceEndDate" class="lms-login-input" type="date" value="${escapeHtml(endDate)}" onchange="lmsPanelSetAttendanceEndDate(this.value)">
        </label>
      </div>
      <div class="lms-period-grid">
        <label class="lms-score-field">
          <span>流水页码</span>
          <input id="lmsAttendancePage" class="lms-login-input" type="number" min="1" max="1000" value="${page}" onchange="lmsPanelSetAttendancePage(this.value)">
        </label>
        <label class="lms-score-field">
          <span>每页数量</span>
          <select id="lmsAttendancePageSize" class="lms-login-input" onchange="lmsPanelSetAttendancePageSize(this.value)">
            ${[10, 20, 50, 100].map(size => `<option value="${size}" ${size === pageSize ? 'selected' : ''}>${size} 条</option>`).join('')}
          </select>
        </label>
      </div>
      <button class="lms-big-btn lms-score-query-btn" onclick="lmsPanelFetchAttendance()">查询考勤</button>
    </div>
  `;

  if (LMS_PANEL_STATE.attendanceError) {
    html += `
      <div class="lms-score-error">
        <div>${escapeHtml(LMS_PANEL_STATE.attendanceError)}</div>
        <button class="lms-mini-btn" onclick="lmsPanelOpenCredentialLogin()">打开登录并保存凭据</button>
      </div>
    `;
  }

  if (!flows) {
    html += `
      <div class="lms-empty-mini">
        考勤查询使用本机加密保存的统一认证账号密码，并访问本科/研究生考勤系统。
      </div>
    `;
    return html;
  }

  html += `
    <div class="lms-score-summary">
      <div class="lms-stat-card">
        <div class="lms-stat-num">${lmsFmtScoreValue(stats.total)}</div>
        <div class="lms-stat-lbl">${escapeHtml(lmsScoreAccountLabel(resolvedType))}总课次</div>
      </div>
      <div class="lms-stat-card">
        <div class="lms-stat-num">${lmsFmtScoreValue(stats.normalCount)}</div>
        <div class="lms-stat-lbl">正常</div>
      </div>
      <div class="lms-stat-card ${stats.lateCount ? 'urgent' : ''}">
        <div class="lms-stat-num">${lmsFmtScoreValue(stats.lateCount)}</div>
        <div class="lms-stat-lbl">迟到</div>
      </div>
      <div class="lms-stat-card ${stats.absenceCount ? 'overdue' : ''}">
        <div class="lms-stat-num">${lmsFmtScoreValue(stats.absenceCount)}</div>
        <div class="lms-stat-lbl">缺勤</div>
      </div>
    </div>
    <div class="lms-schedule-summary">
      <span>${escapeHtml(startDate)} 至 ${escapeHtml(endDate)}</span>
      <span>${escapeHtml(lmsPanelAttendanceAccessModeLabel(resolvedAccessMode))}</span>
      <span>流水 ${pagination.totalCount ?? flows.length} 条</span>
      <span>第 ${pagination.page || page}/${pagination.totalPages || 1} 页</span>
      <span>请假 ${lmsFmtScoreValue(stats.leaveCount)}</span>
      <span>早退 ${lmsFmtScoreValue(stats.leaveEarlyCount)}</span>
    </div>
  `;

  if (!flows.length) {
    html += '<div class="lms-empty"><h3>未查询到刷卡流水</h3><p>可以调整日期范围或身份后重试。</p></div>';
  } else {
    html += `
      <div class="lms-score-table-wrap">
        <table class="lms-score-table lms-attendance-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>地点</th>
              <th>状态</th>
              <th>编号</th>
            </tr>
          </thead>
          <tbody>
            ${flows.map(lmsPanelRenderAttendanceFlowRow).join('')}
          </tbody>
        </table>
      </div>
      <div class="lms-attendance-pager">
        <button class="lms-mini-btn" onclick="lmsPanelAttendancePrevPage()" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="lms-mini-btn" onclick="lmsPanelAttendanceNextPage()" ${pagination.totalPages && page >= pagination.totalPages ? 'disabled' : ''}>下一页</button>
      </div>
    `;
  }

  if (subjects.length) {
    html += `
      <h3 class="lms-section-title">课程统计</h3>
      <div class="lms-score-table-wrap">
        <table class="lms-score-table lms-attendance-subject-table">
          <thead>
            <tr>
              <th>课程</th>
              <th>总课次</th>
              <th>正常</th>
              <th>迟到</th>
              <th>缺勤</th>
              <th>请假</th>
            </tr>
          </thead>
          <tbody>
            ${subjects.map(lmsPanelRenderAttendanceSubjectRow).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  return html;
}

function lmsPanelRenderAttendanceFlowRow(item) {
  const type = Number(item.type);
  const level = type === 1 ? 'ok' : (type === 0 ? 'bad' : (type === 2 ? 'warn' : ''));
  return `
    <tr>
      <td>${escapeHtml(item.time || '-')}</td>
      <td>${escapeHtml(item.place || '-')}</td>
      <td><span class="lms-attendance-status ${level}">${escapeHtml(item.typeLabel || '-')}</span></td>
      <td>${escapeHtml(item.id || '-')}</td>
    </tr>
  `;
}

function lmsPanelRenderAttendanceSubjectRow(item) {
  return `
    <tr>
      <td>${escapeHtml(item.subjectName || item.subjectCode || '-')}</td>
      <td>${escapeHtml(lmsFmtScoreValue(item.total))}</td>
      <td>${escapeHtml(lmsFmtScoreValue(item.normalCount))}</td>
      <td>${escapeHtml(lmsFmtScoreValue(item.lateCount))}</td>
      <td>${escapeHtml(lmsFmtScoreValue(item.absenceCount))}</td>
      <td>${escapeHtml(lmsFmtScoreValue(item.leaveCount))}</td>
    </tr>
  `;
}

function lmsPanelSetAttendanceAccountType(value) {
  LMS_PANEL_STATE.attendanceAccountType = value || 'auto';
}

function lmsPanelSetAttendanceAccessMode(value) {
  LMS_PANEL_STATE.attendanceAccessMode = value || 'auto';
}

function lmsPanelSetAttendanceStartDate(value) {
  LMS_PANEL_STATE.attendanceStartDate = value || '';
}

function lmsPanelSetAttendanceEndDate(value) {
  LMS_PANEL_STATE.attendanceEndDate = value || '';
}

function lmsPanelSetAttendancePage(value) {
  LMS_PANEL_STATE.attendancePage = Number(value) || 1;
}

function lmsPanelSetAttendancePageSize(value) {
  LMS_PANEL_STATE.attendancePageSize = Number(value) || 20;
}

function lmsPanelAttendancePrevPage() {
  LMS_PANEL_STATE.attendancePage = Math.max(1, (Number(LMS_PANEL_STATE.attendancePage) || 1) - 1);
  lmsPanelFetchAttendance();
}

function lmsPanelAttendanceNextPage() {
  LMS_PANEL_STATE.attendancePage = (Number(LMS_PANEL_STATE.attendancePage) || 1) + 1;
  lmsPanelFetchAttendance();
}

function lmsPanelRenderJudgePage() {
  const accountType = LMS_PANEL_STATE.judgeAccountType || 'auto';
  const ugScore = LMS_PANEL_STATE.judgeScore || '100';
  const pgScore = LMS_PANEL_STATE.judgeGraduateScore || '3';
  const comment = LMS_PANEL_STATE.judgeComment || '';
  const questionnaires = LMS_PANEL_STATE.cache.judgeQuestionnaires;
  const results = LMS_PANEL_STATE.cache.judgeResults;
  const resolvedType = LMS_PANEL_STATE.judgeResolvedAccountType || accountType;

  let html = lmsPanelRenderSubHeader('一键评教');
  html += `
    <div class="lms-score-controls">
      <label class="lms-score-field">
        <span>身份</span>
        <select id="lmsJudgeAccountType" class="lms-login-input" onchange="lmsPanelSetJudgeAccountType(this.value)">
          <option value="auto" ${accountType === 'auto' ? 'selected' : ''}>自动识别</option>
          <option value="undergraduate" ${accountType === 'undergraduate' ? 'selected' : ''}>本科生</option>
          <option value="postgraduate" ${accountType === 'postgraduate' ? 'selected' : ''}>研究生</option>
        </select>
      </label>
      <label class="lms-score-field">
        <span>本科评分</span>
        <select id="lmsJudgeScore" class="lms-login-input" onchange="lmsPanelSetJudgeScore(this.value)">
          ${[100, 80, 60, 40].map(score => `<option value="${score}" ${String(score) === String(ugScore) ? 'selected' : ''}>${score} 分</option>`).join('')}
        </select>
      </label>
      <label class="lms-score-field">
        <span>研究生评分</span>
        <select id="lmsJudgeGraduateScore" class="lms-login-input" onchange="lmsPanelSetJudgeGraduateScore(this.value)">
          <option value="3" ${String(pgScore) === '3' ? 'selected' : ''}>优秀</option>
          <option value="2" ${String(pgScore) === '2' ? 'selected' : ''}>良好</option>
          <option value="1" ${String(pgScore) === '1' ? 'selected' : ''}>合格</option>
          <option value="0" ${String(pgScore) === '0' ? 'selected' : ''}>不合格</option>
        </select>
      </label>
      <label class="lms-score-field lms-score-field-wide">
        <span>统一评语</span>
        <textarea id="lmsJudgeComment" class="lms-login-input" rows="3" placeholder="主观题统一填写内容，可留空" oninput="lmsPanelSetJudgeComment(this.value)">${escapeHtml(comment)}</textarea>
      </label>
      <div class="lms-period-grid">
        <button class="lms-big-btn lms-score-query-btn" onclick="lmsPanelFetchJudgeStatus()">刷新待评教</button>
        <button class="lms-big-btn lms-score-query-btn" style="background:var(--danger,#e74c3c);" onclick="lmsPanelSubmitJudgeAll()">提交全部评教</button>
      </div>
    </div>
  `;

  if (LMS_PANEL_STATE.judgeError) {
    html += `
      <div class="lms-score-error">
        <div>${escapeHtml(LMS_PANEL_STATE.judgeError)}</div>
        <button class="lms-mini-btn" onclick="lmsPanelOpenCredentialLogin()">打开登录并保存凭据</button>
      </div>
    `;
  }

  if (!questionnaires && !results) {
    html += `
      <div class="lms-empty-mini">
        一键评教使用本机加密保存的统一认证账号密码，只在学习面板内使用，不会暴露为 AI 工具。请先点击“刷新待评教”确认列表，再提交。
      </div>
    `;
    return html;
  }

  if (questionnaires) {
    html += `
      <div class="lms-score-summary">
        <div class="lms-stat-card">
          <div class="lms-stat-num">${escapeHtml(questionnaires.length)}</div>
          <div class="lms-stat-lbl">${escapeHtml(lmsScoreAccountLabel(resolvedType))}待评教</div>
        </div>
      </div>
    `;
    if (!questionnaires.length) {
      html += '<div class="lms-empty"><h3>暂无待评教问卷</h3><p>当前身份下没有需要评教的课程。</p></div>';
    } else {
      html += `
        <div class="lms-score-table-wrap">
          <table class="lms-score-table">
            <thead><tr><th>课程</th><th>教师</th><th>问卷</th><th>学期</th></tr></thead>
            <tbody>${questionnaires.map(lmsPanelRenderJudgeQuestionnaireRow).join('')}</tbody>
          </table>
        </div>
      `;
    }
  }

  if (results) {
    const okCount = results.filter(item => item && item.ok).length;
    html += `
      <h3 class="lms-section-title">提交结果</h3>
      <div class="lms-schedule-summary">
        <span>成功 ${okCount}/${results.length}</span>
        <span>${escapeHtml(lmsScoreAccountLabel(resolvedType))}</span>
      </div>
      <div class="lms-score-table-wrap">
        <table class="lms-score-table">
          <thead><tr><th>状态</th><th>课程</th><th>教师</th><th>消息</th></tr></thead>
          <tbody>${results.map(lmsPanelRenderJudgeResultRow).join('')}</tbody>
        </table>
      </div>
    `;
  }

  return html;
}

function lmsPanelRenderJudgeQuestionnaireRow(item) {
  return `
    <tr>
      <td>${escapeHtml(item.courseName || '-')}</td>
      <td>${escapeHtml(item.teacher || '-')}</td>
      <td>${escapeHtml(item.questionnaireName || '-')}</td>
      <td>${escapeHtml(item.term || '-')}</td>
    </tr>
  `;
}

function lmsPanelRenderJudgeResultRow(item) {
  const ok = item && item.ok;
  return `
    <tr class="${ok ? '' : 'failed'}">
      <td>${ok ? '✅ 成功' : '❌ 失败'}</td>
      <td>${escapeHtml(item.courseName || '-')}</td>
      <td>${escapeHtml(item.teacher || '-')}</td>
      <td>${escapeHtml(item.message || '-')}</td>
    </tr>
  `;
}

function lmsPanelSetJudgeAccountType(value) { LMS_PANEL_STATE.judgeAccountType = value || 'auto'; }
function lmsPanelSetJudgeScore(value) { LMS_PANEL_STATE.judgeScore = value || '100'; }
function lmsPanelSetJudgeGraduateScore(value) { LMS_PANEL_STATE.judgeGraduateScore = value || '3'; }
function lmsPanelSetJudgeComment(value) { LMS_PANEL_STATE.judgeComment = value || ''; }

function lmsPanelRenderBadCookie() {
  // 当 Cookie 已保存但 lmsParseSession 失败时调用，提供醒目的修复入口
  const raw = lmsGetCookie();
  const preview = raw.length > 80 ? raw.slice(0, 80) + '…' : raw;
  return `
    <div class="lms-empty">
      <div class="lms-empty-icon">⚠️</div>
      <h3>Cookie 格式异常</h3>
      <p>已保存的 Cookie 字符串中找不到 <code>session=...</code> 字段，或格式不对。</p>
      <p style="font-family:Consolas,monospace;font-size:12px;background:var(--bg-input,#f5f5f5);padding:8px 12px;border-radius:6px;word-break:break-all;max-width:560px;margin:12px auto;">
        ${escapeHtml(preview) || '<em>（空）</em>'}
      </p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="lms-big-btn" onclick="lmsPanelOpenCookieEditor('login')">🔑 重新登录</button>
        <button class="lms-big-btn" onclick="lmsPanelOpenCookieEditor('cookie')">✏️ 重新填写 Cookie</button>
        <button class="lms-big-btn" style="background:var(--danger,#e74c3c);" onclick="lmsPanelClearCookie()">🗑 清空重来</button>
      </div>
      <div class="lms-guide">
        <h4>📝 正确的 Cookie 长这样</h4>
        <p style="font-family:Consolas,monospace;font-size:12px;">_ga=GA1.x.xxx; <strong>session=V2-1-xxxxx.yyyyy.1700000000000</strong>; ...</p>
        <p>必须包含 <code>session=</code> 开头的那一段（用 <code>copy(document.cookie)</code> 复制即可获得完整字符串）。</p>
      </div>
    </div>
  `;
}

function lmsPanelRenderNoCookie() {
  return `
    <div class="lms-empty">
      <div class="lms-empty-icon">🔐</div>
      <h3>欢迎使用学习面板</h3>
      <p>这是西安交大 LMS (lms.xjtu.edu.cn) 的可视化助手</p>
      <p>第一步：使用统一身份认证登录</p>
      <button class="lms-big-btn" onclick="lmsPanelOpenCookieEditor('login')">🔑 账号密码登录</button>
      <button class="lms-big-btn" style="background:var(--bg-card,#fff);color:var(--text,#1f2328);border:1px solid var(--border,#d0d7de);" onclick="lmsPanelOpenCookieEditor('cookie')">手动填写 Cookie</button>

      <div class="lms-guide">
        <h4>📝 手动 Cookie 兜底方式</h4>
        <ol>
          <li>浏览器打开并登录 <a href="https://lms.xjtu.edu.cn" target="_blank">https://lms.xjtu.edu.cn</a></li>
          <li>按 <kbd>F12</kbd> 打开开发者工具</li>
          <li>切到 <strong>Console（控制台）</strong></li>
          <li>输入 <code>copy(document.cookie)</code> 回车</li>
          <li>Cookie 已复制到剪贴板，回来粘贴即可</li>
        </ol>
      </div>
    </div>
  `;
}

function lmsPanelRenderOverview() {
  const todos = LMS_PANEL_STATE.cache.todos;
  const courses = LMS_PANEL_STATE.cache.courses;
  let html = '<div class="lms-overview">';

  // 统计卡片
  html += '<div class="lms-stat-grid">';
  html += `
    <div class="lms-stat-card">
      <div class="lms-stat-num">${courses ? courses.length : '—'}</div>
      <div class="lms-stat-lbl">📚 课程</div>
    </div>
    <div class="lms-stat-card">
      <div class="lms-stat-num">${todos ? todos.length : '—'}</div>
      <div class="lms-stat-lbl">📝 待办</div>
    </div>
  `;
  if (todos) {
    const now = Date.now();
    const urgent = todos.filter(t => {
      const end = t.end_time ? new Date(t.end_time).getTime() : 0;
      return end && end > now && end - now < 7 * 86400000;
    }).length;
    const overdue = todos.filter(t => {
      const end = t.end_time ? new Date(t.end_time).getTime() : 0;
      return end && end < now;
    }).length;
    html += `
      <div class="lms-stat-card ${urgent ? 'urgent' : ''}">
        <div class="lms-stat-num">${urgent}</div>
        <div class="lms-stat-lbl">🚨 一周内截止</div>
      </div>
      <div class="lms-stat-card ${overdue ? 'overdue' : ''}">
        <div class="lms-stat-num">${overdue}</div>
        <div class="lms-stat-lbl">⛔ 已逾期</div>
      </div>
    `;
  }
  html += '</div>';

  // 最紧急的 3 项
  if (todos && todos.length) {
    const sorted = [...todos].sort((a, b) => {
      const ea = a.end_time ? new Date(a.end_time).getTime() : Infinity;
      const eb = b.end_time ? new Date(b.end_time).getTime() : Infinity;
      return ea - eb;
    }).slice(0, 5);
    html += '<h3 class="lms-section-title">🔥 最紧急的 5 项</h3>';
    html += '<div class="lms-todo-list">';
    sorted.forEach(t => html += lmsRenderTodoCard(t));
    html += '</div>';
    html += '<div style="text-align:center;margin-top:12px;">';
    html += '<button class="lms-mini-btn" onclick="lmsPanelSetTab(\'todos\')">查看全部待办 →</button>';
    html += '</div>';
  } else {
    html += '<div class="lms-empty-mini">';
    html += '<button class="lms-big-btn" onclick="lmsPanelFetchAll()">📡 拉取最新数据</button>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function lmsPanelRenderTodos() {
  const todos = LMS_PANEL_STATE.cache.todos;
  if (!todos) {
    return `<div class="lms-empty-mini">
      <button class="lms-big-btn" onclick="lmsPanelFetchTodos()">📡 拉取待办列表</button>
    </div>`;
  }
  if (!todos.length) {
    return `<div class="lms-empty"><div class="lms-empty-icon">🎉</div><h3>暂无未完成作业</h3></div>`;
  }
  const sorted = [...todos].sort((a, b) => {
    const ea = a.end_time ? new Date(a.end_time).getTime() : Infinity;
    const eb = b.end_time ? new Date(b.end_time).getTime() : Infinity;
    return ea - eb;
  });
  let html = `<div class="lms-toolbar">
    <span>共 <strong>${sorted.length}</strong> 项</span>
    <button class="lms-mini-btn" onclick="lmsPanelFetchTodos()">🔄 刷新</button>
  </div>`;
  html += '<div class="lms-todo-list">';
  sorted.forEach(t => html += lmsRenderTodoCard(t));
  html += '</div>';
  return html;
}

function lmsRenderTodoCard(t) {
  const end = t.end_time ? new Date(t.end_time) : null;
  const remain = lmsFmtRemain(end);
  const level = (() => {
    if (!end) return '';
    const d = end.getTime() - Date.now();
    if (d < 0) return 'overdue';
    if (d < 86400000) return 'critical';
    if (d < 3 * 86400000) return 'urgent';
    if (d < 7 * 86400000) return 'soon';
    return '';
  })();
  return `
    <div class="lms-todo-card ${level}">
      <div class="lms-todo-head">
        <span class="lms-todo-title">${escapeHtml(t.title || '?')}</span>
        <span class="lms-todo-badge">${remain}</span>
      </div>
      <div class="lms-todo-meta">
        📚 ${escapeHtml(t.course_name || '?')}
      </div>
      <div class="lms-todo-meta">
        🔴 截止：${lmsFmtTime(end)}
      </div>
      <div class="lms-todo-actions">
        <button class="lms-mini-btn" onclick="lmsPanelShowHomework(${t.id})">📖 查看详情</button>
        <a class="lms-mini-btn" href="https://lms.xjtu.edu.cn/course/${t.course_id}/homework/${t.id}" target="_blank">🔗 打开网页</a>
      </div>
    </div>
  `;
}

function lmsPanelRenderCourses() {
  const courses = LMS_PANEL_STATE.cache.courses;
  if (!courses) {
    return `<div class="lms-empty-mini">
      <button class="lms-big-btn" onclick="lmsPanelFetchCourses()">📡 拉取课程列表</button>
    </div>`;
  }
  if (!courses.length) return '<div class="lms-empty"><div class="lms-empty-icon">📚</div><h3>暂无课程</h3></div>';

  // 按学年分组
  const groups = {};
  courses.forEach(c => {
    const year = (c.academic_year && c.academic_year.name) || '其他';
    (groups[year] = groups[year] || []).push(c);
  });
  let html = `<div class="lms-toolbar">
    <span>共 <strong>${courses.length}</strong> 门</span>
    <button class="lms-mini-btn" onclick="lmsPanelFetchCourses()">🔄 刷新</button>
  </div>`;
  Object.keys(groups).sort().reverse().forEach(year => {
    html += `<h3 class="lms-section-title">📅 ${escapeHtml(year)}（${groups[year].length} 门）</h3>`;
    html += '<div class="lms-course-grid">';
    groups[year].forEach(c => {
      html += `
        <div class="lms-course-card" onclick="lmsPanelShowMaterials(${c.id})">
          <div class="lms-course-name">${escapeHtml(c.name || '?')}</div>
          <div class="lms-course-meta">
            <span>🆔 ${c.id}</span>
            ${c.credit ? `<span>💯 ${c.credit} 学分</span>` : ''}
          </div>
          <button class="lms-mini-btn" onclick="event.stopPropagation();lmsPanelShowMaterials(${c.id})">📂 查看课件</button>
        </div>
      `;
    });
    html += '</div>';
  });
  return html;
}

function lmsPanelRenderMaterials() {
  const cid = LMS_PANEL_STATE.selectedCid;
  if (!cid) {
    return `<div class="lms-empty">
      <div class="lms-empty-icon">📂</div>
      <h3>请先选择一门课程</h3>
      <p>切到「📚 课程」标签，点击任意课程查看课件</p>
      <button class="lms-big-btn" onclick="lmsPanelSetTab('courses')">前往课程列表</button>
    </div>`;
  }
  const data = LMS_PANEL_STATE.cache.materialsByCid[cid];
  if (!data) {
    return `<div class="lms-empty-mini">
      <button class="lms-big-btn" onclick="lmsPanelFetchMaterials(${cid})">📡 拉取课程 ${cid} 的课件</button>
    </div>`;
  }
  const { activities, modules } = data;
  const modName = {};
  (modules || []).forEach(m => { modName[m.id] = m.name || '未分组'; });
  const materials = (activities || []).filter(a => a.type === 'material');

  let html = `<div class="lms-toolbar">
    <span>📚 课程 <strong>${cid}</strong> · ${materials.length} 项课件</span>
    <button class="lms-mini-btn" onclick="lmsPanelFetchMaterials(${cid})">🔄 刷新</button>
    <button class="lms-mini-btn" onclick="lmsPanelSetTab('courses')">← 返回课程</button>
  </div>`;
  if (!materials.length) {
    html += '<div class="lms-empty-mini">本课程暂无课件</div>';
    return html;
  }

  const groups = {};
  materials.forEach(m => {
    const mid = m.module_id || 0;
    (groups[mid] = groups[mid] || []).push(m);
  });

  Object.keys(groups).forEach(mid => {
    html += `<h3 class="lms-section-title">📁 ${escapeHtml(modName[mid] || '未分组')}</h3>`;
    html += '<div class="lms-material-list">';
    groups[mid].forEach(m => {
      const ups = m.uploads || [];
      ups.forEach(u => {
        if (typeof lmsRegisterUpload === 'function') lmsRegisterUpload(u);
        const dl = u.allow_download;
        // 🛡️ 把文件名作为合法 JS 字符串字面量嵌入 onclick：先 JSON.stringify 再 HTML escape
        // 避免 "escapeHtml 再当 JS 字符串" 的层级混乱
        const nameForJs = escapeHtml(JSON.stringify(u.name || ''));
        html += `
          <div class="lms-material-item">
            <div class="lms-material-icon">${dl ? '📄' : '🔒'}</div>
            <div class="lms-material-info">
              <div class="lms-material-name">${escapeHtml(m.title || '?')}</div>
              <div class="lms-material-sub">${escapeHtml(u.name || '?')} · ${lmsFmtSize(u.size)}</div>
            </div>
            <div class="lms-material-actions">
              ${dl
                ? `<button class="lms-mini-btn lms-btn-primary" onclick="lmsPanelDownload(${u.id}, ${nameForJs})">⬇️ 下载</button>`
                : `<button class="lms-mini-btn" title="服务器返回可用地址时可下载" onclick="lmsPanelDownload(${u.id}, ${nameForJs})">🔒 尝试</button>`}
            </div>
          </div>
        `;
      });
      if (!ups.length) {
        html += `<div class="lms-material-item"><div class="lms-material-icon">📄</div>
          <div class="lms-material-info">
            <div class="lms-material-name">${escapeHtml(m.title || '?')}</div>
            <div class="lms-material-sub">_(无附件)_</div>
          </div></div>`;
      }
    });
    html += '</div>';
  });
  return html;
}

// ============ 数据拉取 ============

async function lmsPanelFetchAll() {
  await Promise.all([lmsPanelFetchTodos(), lmsPanelFetchCourses()]);
}

async function lmsPanelFetchTodos() {
  lmsPanelShowLoading('正在拉取待办列表...');
  const r = await lmsApiGet('/api/todos');
  if (r.ok) {
    LMS_PANEL_STATE.cache.todos = r.data.todo_list || [];
    toast(`✅ 已加载 ${LMS_PANEL_STATE.cache.todos.length} 项待办`);
  } else {
    toast('❌ ' + (r.message || r.error));
    if (r.error === 'COOKIE_EXPIRED') lmsPanelOpenCookieEditor('login');
  }
  lmsPanelRender();
  lmsPanelRefreshStatus();
}

async function lmsPanelFetchCourses() {
  lmsPanelShowLoading('正在拉取课程列表...');
  const r = await lmsApiGet('/api/my-courses');
  if (r.ok) {
    LMS_PANEL_STATE.cache.courses = r.data.courses || [];
    toast(`✅ 已加载 ${LMS_PANEL_STATE.cache.courses.length} 门课程`);
  } else {
    toast('❌ ' + (r.message || r.error));
    if (r.error === 'COOKIE_EXPIRED') lmsPanelOpenCookieEditor('login');
  }
  lmsPanelRender();
}

async function lmsPanelFetchMaterials(cid) {
  lmsPanelShowLoading(`正在拉取课程 ${cid} 的课件...`);
  const [ra, rm] = await Promise.all([
    lmsApiGet(`/api/courses/${cid}/activities`),
    lmsApiGet(`/api/courses/${cid}/modules`),
  ]);
  if (ra.ok) {
    if (typeof lmsRegisterUploads === 'function') lmsRegisterUploads(ra.data.activities || []);
    LMS_PANEL_STATE.cache.materialsByCid[cid] = {
      activities: ra.data.activities || [],
      modules: (rm.ok && rm.data && rm.data.modules) || [],
    };
    toast(`✅ 课件加载完成`);
  } else {
    toast('❌ ' + (ra.message || ra.error));
  }
  lmsPanelRender();
}

async function lmsPanelFetchScores() {
  const accountType = document.getElementById('lmsScoreAccountType')?.value || LMS_PANEL_STATE.scoreAccountType || 'auto';
  const term = document.getElementById('lmsScoreTerm')?.value.trim() || '';
  LMS_PANEL_STATE.scoreAccountType = accountType;
  LMS_PANEL_STATE.scoreTerm = term;
  LMS_PANEL_STATE.scoreError = '';
  lmsPanelShowLoading('正在查询成绩...');

  const result = await lmsScoreQuery({
    account_type: accountType,
    term,
  });
  if (result && result.ok) {
    LMS_PANEL_STATE.cache.scores = result.scores || [];
    LMS_PANEL_STATE.cache.scoreSummary = result.summary || {};
    LMS_PANEL_STATE.scoreResolvedAccountType = result.account_type || accountType;
    LMS_PANEL_STATE.scoreSelectedKeys = null;
    toast(`成绩已加载：${LMS_PANEL_STATE.cache.scores.length} 门课程`);
  } else {
    LMS_PANEL_STATE.cache.scores = null;
    LMS_PANEL_STATE.cache.scoreSummary = null;
    LMS_PANEL_STATE.scoreResolvedAccountType = '';
    LMS_PANEL_STATE.scoreError = (result && (result.message || result.error)) || '成绩查询失败。';
    LMS_PANEL_STATE.scoreSelectedKeys = null;
    toast(LMS_PANEL_STATE.scoreError);
  }
  lmsPanelRender();
}

async function lmsPanelFetchSchedule() {
  const accountType = document.getElementById('lmsScheduleAccountType')?.value || LMS_PANEL_STATE.scheduleAccountType || 'auto';
  const term = document.getElementById('lmsScheduleTerm')?.value.trim() || '';
  LMS_PANEL_STATE.scheduleAccountType = accountType;
  LMS_PANEL_STATE.scheduleTerm = term;
  LMS_PANEL_STATE.scheduleError = '';
  lmsPanelShowLoading('正在查询课表...');

  const result = await lmsScheduleQuery({
    account_type: accountType,
    term,
  });
  if (result && result.ok) {
    LMS_PANEL_STATE.cache.scheduleLessons = result.lessons || [];
    LMS_PANEL_STATE.cache.scheduleSummary = result.summary || {};
    LMS_PANEL_STATE.scheduleResolvedAccountType = result.account_type || accountType;
    LMS_PANEL_STATE.scheduleResultTerm = result.term || '';
    toast(`课表已加载：${LMS_PANEL_STATE.cache.scheduleLessons.length} 条课程安排`);
  } else {
    LMS_PANEL_STATE.cache.scheduleLessons = null;
    LMS_PANEL_STATE.cache.scheduleSummary = null;
    LMS_PANEL_STATE.scheduleResolvedAccountType = '';
    LMS_PANEL_STATE.scheduleResultTerm = '';
    LMS_PANEL_STATE.scheduleError = (result && (result.message || result.error)) || '课表查询失败。';
    toast(LMS_PANEL_STATE.scheduleError);
  }
  lmsPanelRender();
}

async function lmsPanelFetchEmptyRooms() {
  const campus = document.getElementById('lmsEmptyRoomCampus')?.value || LMS_PANEL_STATE.emptyRoomCampus || '兴庆校区';
  const building = document.getElementById('lmsEmptyRoomBuilding')?.value || LMS_PANEL_STATE.emptyRoomBuilding || '主楼D';
  const queryDate = document.getElementById('lmsEmptyRoomDate')?.value || LMS_PANEL_STATE.emptyRoomDate || lmsPanelTodayString();
  const startPeriod = Number(document.getElementById('lmsEmptyRoomStartPeriod')?.value || LMS_PANEL_STATE.emptyRoomStartPeriod || 1);
  const endPeriod = Number(document.getElementById('lmsEmptyRoomEndPeriod')?.value || LMS_PANEL_STATE.emptyRoomEndPeriod || 11);

  LMS_PANEL_STATE.emptyRoomCampus = campus;
  LMS_PANEL_STATE.emptyRoomBuilding = building;
  LMS_PANEL_STATE.emptyRoomDate = queryDate;
  LMS_PANEL_STATE.emptyRoomStartPeriod = startPeriod;
  LMS_PANEL_STATE.emptyRoomEndPeriod = endPeriod;
  LMS_PANEL_STATE.emptyRoomError = '';
  lmsPanelShowLoading('正在查询空闲教室...');

  const result = await lmsEmptyRoomsQuery({
    campus,
    building,
    date: queryDate,
    start_period: startPeriod,
    end_period: endPeriod,
  });
  if (result && result.ok) {
    LMS_PANEL_STATE.cache.emptyRooms = result.rooms || [];
    LMS_PANEL_STATE.cache.emptyRoomSummary = result.summary || {};
    toast(`空闲教室已加载：${LMS_PANEL_STATE.cache.emptyRooms.length} 间`);
  } else {
    LMS_PANEL_STATE.cache.emptyRooms = null;
    LMS_PANEL_STATE.cache.emptyRoomSummary = null;
    LMS_PANEL_STATE.emptyRoomError = (result && (result.message || result.error)) || '空闲教室查询失败。';
    toast(LMS_PANEL_STATE.emptyRoomError);
  }
  lmsPanelRender();
}

async function lmsPanelFetchAttendance() {
  const accountType = document.getElementById('lmsAttendanceAccountType')?.value || LMS_PANEL_STATE.attendanceAccountType || 'auto';
  const accessMode = document.getElementById('lmsAttendanceAccessMode')?.value || LMS_PANEL_STATE.attendanceAccessMode || 'auto';
  const startDate = document.getElementById('lmsAttendanceStartDate')?.value || LMS_PANEL_STATE.attendanceStartDate || lmsPanelDateOffsetString(-30);
  const endDate = document.getElementById('lmsAttendanceEndDate')?.value || LMS_PANEL_STATE.attendanceEndDate || lmsPanelTodayString();
  const page = Number(document.getElementById('lmsAttendancePage')?.value || LMS_PANEL_STATE.attendancePage || 1);
  const pageSize = Number(document.getElementById('lmsAttendancePageSize')?.value || LMS_PANEL_STATE.attendancePageSize || 20);

  LMS_PANEL_STATE.attendanceAccountType = accountType;
  LMS_PANEL_STATE.attendanceAccessMode = accessMode;
  LMS_PANEL_STATE.attendanceStartDate = startDate;
  LMS_PANEL_STATE.attendanceEndDate = endDate;
  LMS_PANEL_STATE.attendancePage = page;
  LMS_PANEL_STATE.attendancePageSize = pageSize;
  LMS_PANEL_STATE.attendanceError = '';
  lmsPanelShowLoading('正在查询考勤...');

  const result = await lmsAttendanceQuery({
    account_type: accountType,
    start_date: startDate,
    end_date: endDate,
    page,
    page_size: pageSize,
    access_mode: accessMode,
  });
  if (result && result.ok) {
    LMS_PANEL_STATE.cache.attendanceFlows = result.flows || [];
    LMS_PANEL_STATE.cache.attendanceSubjects = result.subjects || [];
    LMS_PANEL_STATE.cache.attendanceStatistics = result.statistics || {};
    LMS_PANEL_STATE.cache.attendancePagination = result.pagination || {};
    LMS_PANEL_STATE.attendanceResolvedAccountType = result.account_type || accountType;
    LMS_PANEL_STATE.attendanceResolvedAccessMode = result.access_mode || accessMode;
    LMS_PANEL_STATE.attendancePage = (result.pagination && result.pagination.page) || page;
    toast(`考勤已加载：${LMS_PANEL_STATE.cache.attendanceFlows.length} 条流水`);
  } else {
    LMS_PANEL_STATE.cache.attendanceFlows = null;
    LMS_PANEL_STATE.cache.attendanceSubjects = null;
    LMS_PANEL_STATE.cache.attendanceStatistics = null;
    LMS_PANEL_STATE.cache.attendancePagination = null;
    LMS_PANEL_STATE.attendanceResolvedAccountType = '';
    LMS_PANEL_STATE.attendanceResolvedAccessMode = '';
    LMS_PANEL_STATE.attendanceError = (result && (result.message || result.error)) || '考勤查询失败。';
    toast(LMS_PANEL_STATE.attendanceError);
  }
  lmsPanelRender();
}

function lmsPanelJudgePayload(action) {
  const accountType = document.getElementById('lmsJudgeAccountType')?.value || LMS_PANEL_STATE.judgeAccountType || 'auto';
  const score = document.getElementById('lmsJudgeScore')?.value || LMS_PANEL_STATE.judgeScore || '100';
  const graduateScore = document.getElementById('lmsJudgeGraduateScore')?.value || LMS_PANEL_STATE.judgeGraduateScore || '3';
  const comment = document.getElementById('lmsJudgeComment')?.value || LMS_PANEL_STATE.judgeComment || '无';
  LMS_PANEL_STATE.judgeAccountType = accountType;
  LMS_PANEL_STATE.judgeScore = score;
  LMS_PANEL_STATE.judgeGraduateScore = graduateScore;
  LMS_PANEL_STATE.judgeComment = comment;
  return {
    action,
    account_type: accountType,
    score: accountType === 'postgraduate' ? graduateScore : score,
    graduate_score: graduateScore,
    comment,
  };
}

async function lmsPanelFetchJudgeStatus() {
  LMS_PANEL_STATE.judgeError = '';
  LMS_PANEL_STATE.cache.judgeResults = null;
  lmsPanelShowLoading('正在获取待评教问卷...');

  const result = await lmsJudgeQuery(lmsPanelJudgePayload('status'));
  if (result && result.ok) {
    LMS_PANEL_STATE.cache.judgeQuestionnaires = result.questionnaires || [];
    LMS_PANEL_STATE.judgeResolvedAccountType = result.account_type || LMS_PANEL_STATE.judgeAccountType;
    toast(`待评教问卷：${LMS_PANEL_STATE.cache.judgeQuestionnaires.length} 份`);
  } else {
    LMS_PANEL_STATE.cache.judgeQuestionnaires = null;
    LMS_PANEL_STATE.judgeResolvedAccountType = '';
    LMS_PANEL_STATE.judgeError = (result && (result.message || result.error)) || '获取待评教问卷失败。';
    toast(LMS_PANEL_STATE.judgeError);
  }
  lmsPanelRender();
}

async function lmsPanelSubmitJudgeAll() {
  const payload = lmsPanelJudgePayload('submit_all');
  const scoreLabel = payload.account_type === 'postgraduate'
    ? ({3: '优秀', 2: '良好', 1: '合格', 0: '不合格'}[String(payload.graduate_score)] || payload.graduate_score)
    : `${payload.score} 分`;
  const ok = confirm(`确定提交全部待评教问卷吗？\n身份：${lmsScoreAccountLabel(payload.account_type)}\n评分：${scoreLabel}\n评语：${payload.comment || '无'}`);
  if (!ok) return;

  LMS_PANEL_STATE.judgeError = '';
  lmsPanelShowLoading('正在提交全部评教，请勿关闭页面...');

  const result = await lmsJudgeQuery(payload);
  if (result && (result.ok || result.partial_ok)) {
    const results = result.results || [];
    if (!results.length && Number(result.count || 0) === 0) {
      LMS_PANEL_STATE.cache.judgeResults = null;
      LMS_PANEL_STATE.cache.judgeQuestionnaires = [];
      LMS_PANEL_STATE.judgeResolvedAccountType = result.account_type || LMS_PANEL_STATE.judgeAccountType;
      toast('暂无待评教问卷');
      lmsPanelRender();
      return;
    }
    LMS_PANEL_STATE.cache.judgeResults = results;
    LMS_PANEL_STATE.cache.judgeQuestionnaires = null;
    LMS_PANEL_STATE.judgeResolvedAccountType = result.account_type || LMS_PANEL_STATE.judgeAccountType;
    toast(`评教完成：成功 ${result.success_count || 0}/${results.length}`);
  } else {
    LMS_PANEL_STATE.cache.judgeResults = null;
    LMS_PANEL_STATE.judgeError = (result && (result.message || result.error)) || '一键评教失败。';
    toast(LMS_PANEL_STATE.judgeError);
  }
  lmsPanelRender();
}

async function lmsPanelShowMaterials(cid) {
  LMS_PANEL_STATE.page = 'lms';
  LMS_PANEL_STATE.selectedCid = cid;
  LMS_PANEL_STATE.tab = 'materials';
  lmsPanelRender();
  if (!LMS_PANEL_STATE.cache.materialsByCid[cid]) {
    await lmsPanelFetchMaterials(cid);
  }
}

async function lmsPanelShowHomework(hwId) {
  const r = await lmsApiGet(`/api/homework-activities/${hwId}`);
  if (!r.ok) {
    toast('❌ ' + (r.message || r.error));
    return;
  }
  // 渲染到模态弹窗
  const html = renderMarkdown(lmsRenderHomeworkDetail(r.data));
  document.getElementById('lmsModalContent').innerHTML = html;
  document.getElementById('lmsModal').classList.add('show');
}

function lmsPanelCloseModal() {
  document.getElementById('lmsModal').classList.remove('show');
}

async function lmsPanelDownload(uploadId, filename) {
  const msg = await lmsToolDownload(uploadId, filename);
  toast(msg.startsWith('✅') ? '✅ 下载已开始' : msg);
}

function lmsPanelShowLoading(text) {
  const body = document.getElementById('lmsPanelBody');
  if (body) {
    const header = LMS_PANEL_STATE.page === 'scores'
      ? lmsPanelRenderSubHeader('成绩查询')
      : (LMS_PANEL_STATE.page === 'schedule'
        ? lmsPanelRenderSubHeader('课表查询')
        : (LMS_PANEL_STATE.page === 'emptyRooms'
          ? lmsPanelRenderSubHeader('空闲教室')
          : (LMS_PANEL_STATE.page === 'judge'
            ? lmsPanelRenderSubHeader('一键评教')
          : (LMS_PANEL_STATE.page === 'attendance'
            ? lmsPanelRenderSubHeader('考勤查询')
            : (LMS_PANEL_STATE.page === 'lms' ? lmsPanelRenderSubHeader('思源学堂') : '')))));
    body.innerHTML = `${header}<div class="lms-loading">
      <div class="lms-spinner"></div>
      <div>${escapeHtml(text || '加载中...')}</div>
    </div>`;
  }
}

// ============ 登录 / Cookie 编辑器 ============

function lmsPanelOpenCookieEditor(mode = 'login') {
  const cur = lmsGetCookie();
  const input = document.getElementById('lmsCookieInput');
  if (input) input.value = cur;
  lmsPanelResetLoginFlow(false);
  lmsPanelSetAuthMode(mode);
  document.getElementById('lmsCookieModal').classList.add('show');
  lmsPanelCookieParse();
  lmsPanelLoadCredentialStatus();
}

function lmsPanelCloseCookieEditor() {
  lmsPanelResetLoginFlow(true);
  document.getElementById('lmsCookieModal').classList.remove('show');
}

function lmsPanelSetAuthMode(mode) {
  LMS_PANEL_STATE.authMode = mode === 'cookie' ? 'cookie' : 'login';
  const isLogin = LMS_PANEL_STATE.authMode === 'login';
  const loginPane = document.getElementById('lmsPasswordLoginPane');
  const cookiePane = document.getElementById('lmsCookiePane');
  const loginTab = document.getElementById('lmsAuthTabLogin');
  const cookieTab = document.getElementById('lmsAuthTabCookie');
  if (loginPane) loginPane.style.display = isLogin ? '' : 'none';
  if (cookiePane) cookiePane.style.display = isLogin ? 'none' : '';
  if (loginTab) loginTab.classList.toggle('active', isLogin);
  if (cookieTab) cookieTab.classList.toggle('active', !isLogin);
}

function lmsPanelCookieParse() {
  const input = document.getElementById('lmsCookieInput');
  const el = document.getElementById('lmsCookieParseResult');
  if (!input || !el) return;
  const val = input.value.trim();
  const info = lmsParseSession(val);
  if (!val) {
    el.innerHTML = '<span style="color:var(--text-secondary)">在上方粘贴 Cookie 字符串</span>';
    return;
  }
  if (!info) {
    el.innerHTML = '<span style="color:var(--danger,#e74c3c)">⚠️ 解析失败，缺少 session=... 字段或格式错误</span>';
    return;
  }
  const h = info.remainMs / 3600000;
  const status = h < 0
    ? `<span style="color:var(--danger,#e74c3c)">⛔ 已过期 ${(-h).toFixed(1)} 小时</span>`
    : `<span style="color:var(--success,#27ae60)">✅ 有效，还有 ${h.toFixed(1)} 小时</span>`;
  el.innerHTML = `
    <div>👤 用户 ID：<code>${escapeHtml(info.uid || '?')}</code></div>
    <div>⏰ 过期时间：${lmsFmtTime(info.expireAt)}</div>
    <div>${status}</div>
  `;
}

function lmsPanelResetLoginFlow(clearFields = true) {
  LMS_PANEL_STATE.loginFlowId = '';
  LMS_PANEL_STATE.loginUsesSavedCredential = false;
  ['lmsLoginCaptchaBox', 'lmsLoginMfaBox', 'lmsLoginAccountBox'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const verifyBtn = document.getElementById('lmsLoginVerifyMfaBtn');
  const submitBtn = document.getElementById('lmsLoginSubmitBtn');
  if (verifyBtn) verifyBtn.style.display = 'none';
  if (submitBtn) {
    submitBtn.style.display = '';
    submitBtn.textContent = '登录';
  }
  if (clearFields) {
    ['lmsLoginPassword', 'lmsLoginCaptcha', 'lmsLoginMfaCode'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }
  lmsPanelSetLoginStatus('', 'info');
}

async function lmsPanelLoadCredentialStatus() {
  const box = document.getElementById('lmsSavedCredentialBox');
  if (!box) return;
  box.style.display = 'none';
  const result = await lmsLoginRequest({ action: 'credential_status' });
  if (!result || !result.ok || !result.has_credential) return;

  const username = result.username || '';
  const savedAt = result.saved_at ? lmsFmtTime(new Date(result.saved_at * 1000)) : '未知时间';
  const usernameInput = document.getElementById('lmsLoginUsername');
  if (usernameInput && !usernameInput.value && username) usernameInput.value = username;
  const remember = document.getElementById('lmsLoginRemember');
  if (remember) remember.checked = true;
  box.innerHTML = `
    <div class="lms-saved-main">
      <div>
        <div class="lms-saved-title">已保存账号</div>
        <div class="lms-saved-sub">${escapeHtml(username || '未知账号')} · ${escapeHtml(savedAt)}</div>
      </div>
      <div class="lms-saved-actions">
        <button class="btn btn-primary" onclick="lmsPanelLoginWithSavedCredential()">使用保存账号登录</button>
        <button class="btn" onclick="lmsPanelClearSavedCredential()">忘记</button>
      </div>
    </div>
  `;
  box.style.display = '';
}

async function lmsPanelLoginWithSavedCredential() {
  LMS_PANEL_STATE.loginUsesSavedCredential = true;
  lmsPanelSetLoginBusy(true);
  lmsPanelSetLoginStatus('正在使用保存的账号登录...', 'info');
  const result = await lmsLoginRequest({
    ...lmsPanelLoginPayloadBase('start_saved'),
  });
  lmsPanelSetLoginBusy(false);
  lmsPanelHandleLoginResponse(result);
}

async function lmsPanelClearSavedCredential() {
  if (!confirm('确定忘记已保存的 LMS 账号密码吗？')) return;
  lmsPanelSetLoginStatus('正在清除保存的账号密码...', 'info');
  const result = await lmsLoginRequest({ action: 'clear_credentials' });
  if (result && result.ok) {
    lmsPanelSetLoginStatus('已忘记保存的账号密码。', 'success');
    const box = document.getElementById('lmsSavedCredentialBox');
    if (box) box.style.display = 'none';
  } else {
    lmsPanelSetLoginStatus((result && (result.message || result.error)) || '清除失败。', 'error');
  }
}

function lmsPanelSetLoginBusy(busy) {
  ['lmsLoginSubmitBtn', 'lmsLoginVerifyMfaBtn', 'lmsLoginSendMfaBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = Boolean(busy);
  });
}

function lmsPanelSetLoginStatus(message, type = 'info') {
  const el = document.getElementById('lmsLoginStatus');
  if (!el) return;
  el.className = `lms-login-status ${type}`;
  el.innerHTML = message ? escapeHtml(message) : '';
}

function lmsPanelLoginPayloadBase(action) {
  return {
    action,
    flow_id: LMS_PANEL_STATE.loginFlowId,
    account_type: 'postgraduate',
    trust_agent: document.getElementById('lmsLoginTrustAgent')?.checked !== false,
  };
}

async function lmsPanelLoginWithPassword() {
  const username = document.getElementById('lmsLoginUsername')?.value.trim() || '';
  const password = document.getElementById('lmsLoginPassword')?.value || '';
  const captchaVisible = document.getElementById('lmsLoginCaptchaBox')?.style.display !== 'none';
  const captcha = document.getElementById('lmsLoginCaptcha')?.value.trim() || '';
  const continuingCaptcha = captchaVisible && LMS_PANEL_STATE.loginFlowId;

  if (!continuingCaptcha && (!username || !password)) {
    lmsPanelSetLoginStatus('请填写账号和密码。', 'error');
    return;
  }
  if (captchaVisible && !captcha) {
    lmsPanelSetLoginStatus('请填写图片验证码。', 'error');
    return;
  }

  lmsPanelSetLoginBusy(true);
  lmsPanelSetLoginStatus(captchaVisible ? '正在提交验证码...' : '正在登录统一身份认证...', 'info');
  const payload = continuingCaptcha
    ? { ...lmsPanelLoginPayloadBase('submit_captcha'), captcha }
    : {
        ...lmsPanelLoginPayloadBase('start'),
        username,
        password,
        captcha,
        remember: document.getElementById('lmsLoginRemember')?.checked === true,
      };
  const result = await lmsLoginRequest(payload);
  lmsPanelSetLoginBusy(false);
  lmsPanelHandleLoginResponse(result);
}

async function lmsPanelSendMfaCode() {
  if (!LMS_PANEL_STATE.loginFlowId) {
    lmsPanelSetLoginStatus('登录流程已失效，请重新登录。', 'error');
    return;
  }
  lmsPanelSetLoginBusy(true);
  lmsPanelSetLoginStatus('正在发送短信验证码...', 'info');
  const result = await lmsLoginRequest({
    action: 'send_mfa',
    flow_id: LMS_PANEL_STATE.loginFlowId,
  });
  lmsPanelSetLoginBusy(false);
  if (result.ok) {
    lmsPanelSetLoginStatus(result.message || '短信验证码已发送。', 'success');
  } else {
    lmsPanelSetLoginStatus(result.message || result.error || '发送失败。', 'error');
  }
}

async function lmsPanelVerifyMfaCode() {
  const code = document.getElementById('lmsLoginMfaCode')?.value.trim() || '';
  if (!LMS_PANEL_STATE.loginFlowId) {
    lmsPanelSetLoginStatus('登录流程已失效，请重新登录。', 'error');
    return;
  }
  if (!code) {
    lmsPanelSetLoginStatus('请填写短信验证码。', 'error');
    return;
  }
  lmsPanelSetLoginBusy(true);
  lmsPanelSetLoginStatus('正在验证短信验证码...', 'info');
  const result = await lmsLoginRequest({
    ...lmsPanelLoginPayloadBase('verify_mfa'),
    code,
  });
  lmsPanelSetLoginBusy(false);
  lmsPanelHandleLoginResponse(result);
}

async function lmsPanelFinishAccountChoice(accountType) {
  if (!LMS_PANEL_STATE.loginFlowId) {
    lmsPanelSetLoginStatus('登录流程已失效，请重新登录。', 'error');
    return;
  }
  lmsPanelSetLoginBusy(true);
  lmsPanelSetLoginStatus('正在确认身份...', 'info');
  const result = await lmsLoginRequest({
    ...lmsPanelLoginPayloadBase('finish_account_choice'),
    account_type: accountType,
  });
  lmsPanelSetLoginBusy(false);
  lmsPanelHandleLoginResponse(result);
}

function lmsPanelHandleLoginResponse(result) {
  if (!result || !result.ok) {
    lmsPanelSetLoginStatus((result && (result.message || result.error)) || '登录失败。', 'error');
    return;
  }

  if (result.status === 'success') {
    if (!result.cookie) {
      lmsPanelSetLoginStatus('登录成功，但本地服务没有返回 Cookie。', 'error');
      return;
    }
    lmsApplyLoginCookie(result.cookie);
    LMS_PANEL_STATE.cache = lmsPanelEmptyCache();
    lmsPanelCloseCookieEditor();
    lmsPanelRefreshStatus();
    lmsPanelRender();
    toast(result.has_session_cookie ? '✅ LMS 登录成功' : '✅ 登录成功，已保存 Cookie');
    if (LMS_PANEL_STATE.page === 'lms' && LMS_PANEL_STATE.tab === 'overview') lmsPanelFetchAll();
    return;
  }

  if (result.status === 'require_captcha') {
    LMS_PANEL_STATE.loginFlowId = result.flow_id || '';
    const box = document.getElementById('lmsLoginCaptchaBox');
    const img = document.getElementById('lmsLoginCaptchaImg');
    const submitBtn = document.getElementById('lmsLoginSubmitBtn');
    if (box) box.style.display = '';
    if (img && result.captcha_image) img.src = result.captcha_image;
    if (submitBtn) submitBtn.textContent = '继续登录';
    lmsPanelSetLoginStatus(result.message || '请输入验证码后继续登录。', 'error');
    return;
  }

  if (result.status === 'require_mfa') {
    LMS_PANEL_STATE.loginFlowId = result.flow_id || '';
    const box = document.getElementById('lmsLoginMfaBox');
    const phone = document.getElementById('lmsLoginMfaPhone');
    const submitBtn = document.getElementById('lmsLoginSubmitBtn');
    const verifyBtn = document.getElementById('lmsLoginVerifyMfaBtn');
    if (box) box.style.display = '';
    if (phone) phone.textContent = `绑定手机：${result.phone || '未知'}`;
    if (submitBtn) submitBtn.style.display = 'none';
    if (verifyBtn) verifyBtn.style.display = '';
    lmsPanelSetLoginStatus(result.message || '需要短信二次验证。', 'info');
    return;
  }

  if (result.status === 'require_account_choice') {
    LMS_PANEL_STATE.loginFlowId = result.flow_id || '';
    const box = document.getElementById('lmsLoginAccountBox');
    const choices = document.getElementById('lmsLoginAccountChoices');
    if (box) box.style.display = '';
    if (choices) {
      choices.innerHTML = (result.choices || [])
        .map(c => `<div>${escapeHtml(c.name || c.label || '')}</div>`)
        .join('') || '服务器要求选择登录身份。';
    }
    lmsPanelSetLoginStatus(result.message || '请选择要登录的账户身份。', 'info');
    return;
  }

  lmsPanelSetLoginStatus(result.message || `需要继续处理：${result.status || '未知状态'}`, 'info');
}

function lmsPanelSaveCookie() {
  const val = document.getElementById('lmsCookieInput').value.trim();
  lmsSetCookie(val);
  LMS_PANEL_STATE.cache = lmsPanelEmptyCache();
  lmsPanelCloseCookieEditor();
  lmsPanelRefreshStatus();
  lmsPanelRender();
  toast(val ? '✅ Cookie 已保存' : '🗑 Cookie 已清空');
  if (val && LMS_PANEL_STATE.page === 'lms' && LMS_PANEL_STATE.tab === 'overview') {
    lmsPanelFetchAll();
  }
}

function lmsPanelClearCookie() {
  if (!confirm('确定清空 LMS Cookie 吗？')) return;
  lmsSetCookie('');
  LMS_PANEL_STATE.cache = lmsPanelEmptyCache();
  lmsPanelCloseCookieEditor();
  lmsPanelRefreshStatus();
  lmsPanelRender();
  toast('🗑 已清空');
}
