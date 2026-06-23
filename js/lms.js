// ============ 🎓 LMS Helper - 核心库 ============
// 西安交大 LMS (lms.xjtu.edu.cn) 数据访问层
// - Cookie 管理（localStorage 持久化）
// - LMS API 调用（走 local_terminal_server.py 代理避免 CORS）
// - Markdown 渲染辅助
// - 工具实现函数（lmsToolXxx），由 config.js 中的 BUILTIN_TOOLS 直接 code 调用

const LMS_COOKIE_KEY = 'lms_cookie_v1';
const LMS_CACHE_KEY  = 'lms_cache_v1';
const LMS_UPLOAD_CACHE = new Map();
const LMS_URL_KEY_HINTS = ['url', 'href', 'link', 'path'];

// ============ Cookie 管理 ============

function lmsGetCookie() {
  return storage.get(LMS_COOKIE_KEY) || '';
}

function lmsSetCookie(cookie) {
  cookie = (cookie || '').trim();
  if (cookie) {
    storage.set(LMS_COOKIE_KEY, cookie);
  } else {
    storage.remove(LMS_COOKIE_KEY);
  }
}

/**
 * 解析 session cookie，返回 {uid, expireAt:Date, remainMs}
 * 解析失败返回 null
 */
function lmsParseSession(cookieStr) {
  cookieStr = cookieStr || lmsGetCookie();
  if (!cookieStr) return null;
  let sessionVal = '';
  cookieStr.split(';').forEach(kv => {
    kv = kv.trim();
    if (kv.startsWith('session=')) sessionVal = kv.slice(8);
  });
  if (!sessionVal) return null;
  try {
    const parts = sessionVal.split('.');
    if (parts.length < 3) return null;
    let uid = '';
    try {
      // base64 url-safe decode
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      uid = atob(b64 + '=='.slice(0, (4 - b64.length % 4) % 4));
    } catch (e) {}
    const expireTs = parseInt(parts[2], 10);
    if (!expireTs) return null;
    const expireAt = new Date(expireTs);
    return {
      uid,
      expireAt,
      remainMs: expireAt.getTime() - Date.now()
    };
  } catch (e) {
    return null;
  }
}

// ============ HTTP 调用 ============

/**
 * 通过本地代理服务调用 LMS API
 * @param {string} path - LMS 路径，如 /api/todos
 * @param {object} params - 查询参数（可选）
 * @returns {Promise<{ok:boolean, status?:number, data?:any, error?:string}>}
 */
async function lmsApiGet(path, params = {}) {
  const cookie = lmsGetCookie();
  if (!cookie) {
    return { ok: false, error: 'NO_COOKIE', message: '⚠️ 尚未登录 LMS，请打开 🎓 学习面板使用统一认证登录或手动填写 Cookie。' };
  }

  // 确保本地代理可用 + token 有效
  if (typeof TERMINAL_CONFIG === 'undefined' || !TERMINAL_CONFIG.token) {
    // 借用 terminal.js 的 fetchTerminalToken
    if (typeof fetchTerminalToken === 'function') {
      const tk = await fetchTerminalToken(false);
      if (!tk) return { ok: false, error: '❌ 本地代理服务未就绪，请先启动 local_terminal_server.py' };
    } else {
      return { ok: false, error: '❌ 本地代理未连接' };
    }
  }

  const serverUrl = (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.serverUrl)
    ? TERMINAL_CONFIG.serverUrl : 'http://localhost:8765';

  const qs = new URLSearchParams({ path, ...params }).toString();
  const url = `${serverUrl}/lms-proxy?${qs}`;

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Token': TERMINAL_CONFIG.token,
        'X-LMS-Cookie': cookie,
      }
    });
    if (resp.status === 403) {
      return { ok: false, error: '❌ 本地代理 Token 失效，请到 ⚙️ 设置 重新获取。' };
    }
    const json = await resp.json();
    // 后端把 LMS 的 200 response 包成 { ok:true, status, data }
    if (json && json.ok && json.data !== undefined) {
      return { ok: true, status: json.status || 200, data: json.data };
    }
    if (json && json.status === 401) {
      return { ok: false, error: 'COOKIE_EXPIRED', message: '🔒 LMS Cookie 已失效，请重新登录获取。' };
    }
    if (json && json.status === 403) {
      return { ok: false, error: 'COOKIE_EXPIRED', message: '🔒 LMS Cookie 已失效或无权限，请重新登录。' };
    }
    return { ok: false, error: (json && json.error) || '请求失败', body: json && json.body };
  } catch (e) {
    return { ok: false, error: `网络错误: ${e.message}` };
  }
}

// ============ 工具函数 ============

function lmsFmtSize(b) {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function lmsParseTime(s) {
  if (!s) return null;
  // LMS 返回 UTC: 2026-05-31T15:59:00Z
  return new Date(s);
}

function lmsFmtTime(dt) {
  if (!dt) return '—';
  // 转北京时间显示
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit',
                 hour: '2-digit', minute: '2-digit', hour12: false,
                 timeZone: 'Asia/Shanghai' };
  return dt.toLocaleString('zh-CN', opts).replace(/\//g, '-');
}

function lmsFmtRemain(endDt) {
  if (!endDt) return '⏳ 无截止';
  const now = Date.now();
  const delta = endDt.getTime() - now;
  if (delta < 0) {
    const days = Math.ceil(-delta / 86400000);
    return `⛔ 已逾期 ${days} 天`;
  }
  const days  = Math.floor(delta / 86400000);
  const hours = Math.floor((delta % 86400000) / 3600000);
  if (days >= 30) return `📅 还有 ${days} 天`;
  if (days >= 7)  return `📌 还有 ${days} 天`;
  if (days >= 3)  return `⚠️ 还有 ${days} 天 ${hours} 小时`;
  if (days >= 1)  return `🔥 仅剩 ${days} 天 ${hours} 小时`;
  return `🚨 仅剩 ${hours} 小时！`;
}

function lmsStripHtml(html) {
  if (!html) return '';
  let text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
                 .replace(/<[^>]+>/g, '');
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
             .replace(/\n{3,}/g, '\n\n').trim();
}

function lmsNormalizeUrl(raw) {
  raw = String(raw || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return 'https:' + raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) {
    try { return new URL(raw, 'https://lms.xjtu.edu.cn').href; } catch (e) { return ''; }
  }
  return '';
}

function lmsExtractUrlCandidates(value) {
  const urls = [];
  const add = raw => {
    const url = lmsNormalizeUrl(raw);
    if (url && !urls.includes(url)) urls.push(url);
  };
  const walk = v => {
    if (!v) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v !== 'object') return;
    Object.keys(v).forEach(k => {
      const child = v[k];
      const key = String(k).toLowerCase();
      if (typeof child === 'string' && LMS_URL_KEY_HINTS.some(h => key.includes(h))) {
        add(child);
      } else if (child && typeof child === 'object') {
        walk(child);
      }
    });
  };
  walk(value);
  return urls;
}

function lmsLooksLikeUpload(value) {
  return value && typeof value === 'object'
    && value.id != null
    && ('name' in value || 'size' in value || 'allow_download' in value);
}

function lmsRegisterUpload(upload) {
  if (!lmsLooksLikeUpload(upload)) return;
  const id = Number(upload.id);
  if (!Number.isFinite(id)) return;
  const prev = LMS_UPLOAD_CACHE.get(id) || {};
  const urls = [...(prev.urlCandidates || [])];
  lmsExtractUrlCandidates(upload).forEach(url => {
    if (!urls.includes(url)) urls.push(url);
  });
  LMS_UPLOAD_CACHE.set(id, {
    id,
    name: upload.name || prev.name || '',
    size: upload.size || prev.size || 0,
    allowDownload: Boolean(upload.allow_download || prev.allowDownload),
    urlCandidates: urls,
    cachedAt: Date.now()
  });
}

function lmsRegisterUploads(value) {
  if (!value) return;
  if (lmsLooksLikeUpload(value)) {
    lmsRegisterUpload(value);
  }
  if (Array.isArray(value)) {
    value.forEach(lmsRegisterUploads);
  } else if (typeof value === 'object') {
    Object.values(value).forEach(lmsRegisterUploads);
  }
}

function lmsGetCachedUpload(uploadId) {
  return LMS_UPLOAD_CACHE.get(Number(uploadId)) || null;
}

function lmsFilenameFromUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url, 'https://lms.xjtu.edu.cn');
    const byName = u.searchParams.get('name');
    if (byName) return byName;
    const last = decodeURIComponent((u.pathname || '').split('/').filter(Boolean).pop() || '');
    return last || '';
  } catch (e) {
    return '';
  }
}

function lmsGetProxyServerUrl() {
  return (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.serverUrl)
    ? TERMINAL_CONFIG.serverUrl : 'http://localhost:8765';
}

async function lmsEnsureProxyToken() {
  if (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.token) return true;
  if (typeof fetchTerminalToken === 'function') {
    return Boolean(await fetchTerminalToken(false));
  }
  return false;
}

function lmsCanProxyDownload(url) {
  try {
    const u = new URL(url, 'https://lms.xjtu.edu.cn');
    return u.origin === 'https://lms.xjtu.edu.cn';
  } catch (e) {
    return false;
  }
}

async function lmsLoginRequest(payload) {
  if (!(await lmsEnsureProxyToken())) {
    return { ok: false, error: 'LOCAL_SERVER_NOT_READY', message: '本地代理服务未就绪，请先启动 local_terminal_server.py' };
  }

  try {
    const resp = await fetch(`${lmsGetProxyServerUrl()}/lms-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': TERMINAL_CONFIG.token,
      },
      body: JSON.stringify(payload || {}),
    });
    const data = await resp.json().catch(() => null);
    if (resp.status === 403) {
      return { ok: false, error: 'TOKEN_INVALID', message: '本地代理 Token 失效，请到设置重新获取。' };
    }
    if (!data) {
      return { ok: false, error: 'BAD_RESPONSE', message: `本地服务返回了无法解析的响应 (${resp.status})` };
    }
    return data;
  } catch (e) {
    return { ok: false, error: 'NETWORK_ERROR', message: `连接本地登录服务失败：${e.message}` };
  }
}

function lmsApplyLoginCookie(cookie) {
  lmsSetCookie(cookie || '');
  if (typeof lmsPanelRefreshStatus === 'function') lmsPanelRefreshStatus();
}

async function lmsScoreQuery(options = {}) {
  if (!(await lmsEnsureProxyToken())) {
    return { ok: false, error: 'LOCAL_SERVER_NOT_READY', message: '本地代理服务未就绪，请先启动 local_terminal_server.py' };
  }

  try {
    const resp = await fetch(`${lmsGetProxyServerUrl()}/lms-scores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': TERMINAL_CONFIG.token,
      },
      body: JSON.stringify(options || {}),
    });
    const data = await resp.json().catch(() => null);
    if (resp.status === 403) {
      return { ok: false, error: 'TOKEN_INVALID', message: '本地代理 Token 失效，请到设置重新获取。' };
    }
    if (!data) {
      return { ok: false, error: 'BAD_RESPONSE', message: `本地服务返回了无法解析的响应 (${resp.status})` };
    }
    return data;
  } catch (e) {
    return { ok: false, error: 'NETWORK_ERROR', message: `连接本地成绩查询服务失败：${e.message}` };
  }
}

async function lmsScheduleQuery(options = {}) {
  if (!(await lmsEnsureProxyToken())) {
    return { ok: false, error: 'LOCAL_SERVER_NOT_READY', message: '本地代理服务未就绪，请先启动 local_terminal_server.py' };
  }

  try {
    const resp = await fetch(`${lmsGetProxyServerUrl()}/lms-schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': TERMINAL_CONFIG.token,
      },
      body: JSON.stringify(options || {}),
    });
    const data = await resp.json().catch(() => null);
    if (resp.status === 403) {
      return { ok: false, error: 'TOKEN_INVALID', message: '本地代理 Token 失效，请到设置重新获取。' };
    }
    if (!data) {
      return { ok: false, error: 'BAD_RESPONSE', message: `本地服务返回了无法解析的响应 (${resp.status})` };
    }
    return data;
  } catch (e) {
    return { ok: false, error: 'NETWORK_ERROR', message: `连接本地课表查询服务失败：${e.message}` };
  }
}

async function lmsEmptyRoomsQuery(options = {}) {
  if (!(await lmsEnsureProxyToken())) {
    return { ok: false, error: 'LOCAL_SERVER_NOT_READY', message: '本地代理服务未就绪，请先启动 local_terminal_server.py' };
  }

  try {
    const resp = await fetch(`${lmsGetProxyServerUrl()}/lms-empty-rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': TERMINAL_CONFIG.token,
      },
      body: JSON.stringify(options || {}),
    });
    const data = await resp.json().catch(() => null);
    if (resp.status === 403) {
      return { ok: false, error: 'TOKEN_INVALID', message: '本地代理 Token 失效，请到设置重新获取。' };
    }
    if (!data) {
      return { ok: false, error: 'BAD_RESPONSE', message: `本地服务返回了无法解析的响应 (${resp.status})` };
    }
    return data;
  } catch (e) {
    return { ok: false, error: 'NETWORK_ERROR', message: `连接本地空闲教室查询服务失败：${e.message}` };
  }
}

function lmsScoreAccountLabel(accountType) {
  if (accountType === 'undergraduate') return '本科';
  if (accountType === 'postgraduate') return '研究生';
  return '自动识别';
}

function lmsFmtScoreValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
  return String(value);
}

// ============ 工具：把 LMS 返回数据格式化为 Markdown ============

function lmsRenderCourses(courses) {
  if (!courses || !courses.length) return '📚 暂无课程。';
  // 按学年分组
  const groups = {};
  courses.forEach(c => {
    const year = (c.academic_year && c.academic_year.name) || '其他';
    (groups[year] = groups[year] || []).push(c);
  });
  const out = [`## 📚 共 ${courses.length} 门课程\n`];
  Object.keys(groups).sort().reverse().forEach(year => {
    const lst = groups[year];
    out.push(`### 📅 ${year}（${lst.length} 门）\n`);
    out.push('| 课程 ID | 课程名 | 学分 |');
    out.push('|--------:|--------|-----:|');
    lst.forEach(c => {
      out.push(`| \`${c.id}\` | ${c.name || '?'} | ${c.credit || '-'} |`);
    });
    out.push('');
  });
  return out.join('\n');
}

function lmsRenderTodos(todos) {
  if (!todos || !todos.length) return '🎉 暂无未完成作业~';
  const items = todos.map(t => ({
    id: t.id, title: t.title, course: t.course_name,
    cid: t.course_id, type: t.type,
    end: lmsParseTime(t.end_time), start: lmsParseTime(t.start_time),
  }));
  items.sort((a, b) => {
    if (!a.end) return 1;
    if (!b.end) return -1;
    return a.end - b.end;
  });
  const out = [`## 📝 未完成作业（${items.length} 项）\n`];
  out.push('| # | 状态 | 作业 | 课程 | 截止时间 |');
  out.push('|---|------|------|------|----------|');
  items.forEach((x, i) => {
    const link = `[${x.title}](https://lms.xjtu.edu.cn/course/${x.cid}/homework/${x.id})`;
    out.push(`| ${i + 1} | ${lmsFmtRemain(x.end)} | ${link} | ${x.course || '-'} | ${lmsFmtTime(x.end)} |`);
  });
  // 紧急汇总
  const now = Date.now();
  const urgent = items.filter(x => x.end && (x.end - now) < 7 * 86400000 && (x.end - now) > 0).length;
  const overdue = items.filter(x => x.end && (x.end - now) < 0).length;
  out.push('');
  out.push(`📊 共 **${items.length}** 项 · 🚨 一周内截止 **${urgent}** 项 · ⛔ 已逾期 **${overdue}** 项`);
  return out.join('\n');
}

function lmsRenderHomeworkDetail(data) {
  const title = data.title || '?';
  const start = lmsParseTime(data.start_time);
  const end   = lmsParseTime(data.end_time);
  const d     = data.data || {};
  const desc  = lmsStripHtml(d.description || '');
  const uploads = data.uploads || [];
  lmsRegisterUploads(uploads);

  const out = [`## 📝 ${title}\n`];
  out.push('| 字段 | 内容 |');
  out.push('|------|------|');
  out.push(`| 🟢 开始 | ${lmsFmtTime(start)} |`);
  out.push(`| 🔴 截止 | ${lmsFmtTime(end)}  ·  **${lmsFmtRemain(end)}** |`);
  out.push(`| 📤 提交方式 | \`${d.homework_type || '-'}\` |`);
  out.push(`| 🔄 允许重交 | ${d.allow_retract ? '✅' : '❌'} |`);
  out.push('');

  out.push('### 📜 作业要求\n');
  out.push(desc ? '> ' + desc.split('\n').join('\n> ') : '> _（老师未填写说明）_');
  out.push('');

  if (uploads.length) {
    out.push(`### 📎 附件 (${uploads.length})\n`);
    out.push('| 文件名 | 大小 | 下载 |');
    out.push('|--------|-----:|------|');
    uploads.forEach(u => {
      const ok = u.allow_download;
      const cell = ok
        ? `✅ \`upload_id=${u.id}\``
        : `🔒 \`upload_id=${u.id}\`（可尝试）`;
      out.push(`| ${u.name} | ${lmsFmtSize(u.size)} | ${cell} |`);
    });
    out.push('');
    out.push('> 💡 用 `lms_download` 工具下载；标记为“仅在线”的文件会在服务器返回可用地址时下载。');
  }
  return out.join('\n');
}

function lmsRenderMaterials(activities, modules, cid) {
  lmsRegisterUploads(activities);
  const modName = {};
  (modules || []).forEach(m => { modName[m.id] = m.name || '未分组'; });
  const materials = (activities || []).filter(a => a.type === 'material');
  if (!materials.length) return `📚 课程 ${cid} 暂无课件。`;

  const groups = {};
  materials.forEach(m => {
    const mid = m.module_id || 0;
    (groups[mid] = groups[mid] || []).push(m);
  });

  const out = [`## 📚 课程 ${cid} 课件（${materials.length} 项）\n`];
  let totalFiles = 0, totalSize = 0;

  Object.keys(groups).forEach(mid => {
    out.push(`### 📁 ${modName[mid] || '未分组'}\n`);
    out.push('| 标题 | 文件 | 大小 | 下载 |');
    out.push('|------|------|-----:|------|');
    groups[mid].forEach(m => {
      const ups = m.uploads || [];
      if (!ups.length) {
        out.push(`| ${m.title || '?'} | _(无附件)_ | - | - |`);
        return;
      }
      ups.forEach(u => {
        totalFiles++;
        totalSize += u.size || 0;
        const cell = u.allow_download
          ? `✅ \`upload_id=${u.id}\``
          : `🔒 \`upload_id=${u.id}\`（可尝试）`;
        out.push(`| ${m.title || '?'} | ${u.name} | ${lmsFmtSize(u.size)} | ${cell} |`);
      });
    });
    out.push('');
  });
  out.push(`📊 共 **${totalFiles}** 个文件，总大小 **${lmsFmtSize(totalSize)}**`);
  return out.join('\n');
}

function lmsRenderScores(data) {
  if (!data || !data.ok) {
    return `错误：${(data && (data.message || data.error)) || '成绩查询失败'}`;
  }
  const scores = data.scores || [];
  const summary = data.summary || {};
  const accountLabel = lmsScoreAccountLabel(data.account_type);
  if (!scores.length) return `## 成绩查询\n\n${accountLabel}成绩系统暂未查询到成绩。`;

  const parts = [`## 成绩查询（${accountLabel}）\n`];
  const stats = [`共 ${summary.count ?? scores.length} 门`];
  if (summary.totalCredits != null) stats.push(`总学分 ${summary.totalCredits}`);
  if (summary.weightedAverageScore != null) stats.push(`加权平均分 ${summary.weightedAverageScore}`);
  if (summary.weightedGpa != null) stats.push(`加权 GPA ${summary.weightedGpa}`);
  if (summary.failed) stats.push(`未通过 ${summary.failed} 门`);
  parts.push(stats.join(' · '));
  parts.push('');
  parts.push('| 学期/类型 | 课程 | 学分 | 成绩 | GPA |');
  parts.push('|---|---|---:|---:|---:|');
  scores.forEach(item => {
    const group = item.term || item.type || '-';
    parts.push(`| ${group} | ${item.courseName || '-'} | ${lmsFmtScoreValue(item.coursePoint)} | ${lmsFmtScoreValue(item.score)} | ${lmsFmtScoreValue(item.gpa)} |`);
  });
  return parts.join('\n');
}

function lmsWeekdayName(day) {
  return ['-', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][Number(day)] || '-';
}

function lmsRenderSchedule(data) {
  if (!data || !data.ok) {
    return `错误：${(data && (data.message || data.error)) || '课表查询失败'}`;
  }
  const lessons = data.lessons || [];
  const accountLabel = lmsScoreAccountLabel(data.account_type);
  const titleTerm = data.term ? ` ${data.term}` : '';
  if (!lessons.length) return `## 课表查询${titleTerm}\n\n${accountLabel}课表系统暂未查询到课程。`;

  const parts = [`## 课表查询（${accountLabel}${titleTerm}）\n`];
  parts.push(`共 ${lessons.length} 条课程安排`);
  parts.push('');
  parts.push('| 星期 | 节次 | 课程 | 教师 | 教室 | 周次 |');
  parts.push('|---|---:|---|---|---|---|');
  lessons.forEach(item => {
    const periods = `${lmsFmtScoreValue(item.periodStart)}-${lmsFmtScoreValue(item.periodEnd)}`;
    parts.push(`| ${lmsWeekdayName(item.dayOfWeek)} | ${periods} | ${item.name || '-'} | ${item.teacher || '-'} | ${item.classroom || '-'} | ${item.weeksText || '-'} |`);
  });
  return parts.join('\n');
}

function lmsRenderEmptyRooms(data) {
  if (!data || !data.ok) {
    return `错误：${(data && (data.message || data.error)) || '空闲教室查询失败'}`;
  }
  const rooms = data.rooms || [];
  const campus = data.campus || '-';
  const building = data.building || '-';
  const periods = `${lmsFmtScoreValue(data.start_period)}-${lmsFmtScoreValue(data.end_period)}`;
  if (!rooms.length) {
    return `## 空闲教室\n\n${campus} ${building} 在 ${data.date || '-'} 第 ${periods} 节暂未查询到空闲教室。`;
  }

  const parts = [`## 空闲教室（${campus} ${building}）\n`];
  parts.push(`日期 ${data.date || '-'} · 节次 ${periods} · 共 ${rooms.length} 间`);
  parts.push('');
  parts.push('| 教室 | 教学楼 | 类型 | 座位 | 考试座位 | 校区 |');
  parts.push('|---|---|---|---:|---:|---|');
  rooms.forEach(item => {
    parts.push(`| ${item.name || '-'} | ${item.buildingName || '-'} | ${item.type || '-'} | ${lmsFmtScoreValue(item.capacity)} | ${lmsFmtScoreValue(item.examCapacity)} | ${item.campusName || '-'} |`);
  });
  return parts.join('\n');
}

// ============ 工具实现函数（被 config.js 中 BUILTIN_TOOLS 的 code 调用） ============

async function lmsToolScores(accountType = 'auto', term = '') {
  const result = await lmsScoreQuery({
    account_type: accountType || 'auto',
    term: term || '',
  });
  return lmsRenderScores(result);
}

async function lmsToolSchedule(accountType = 'auto', term = '') {
  const result = await lmsScheduleQuery({
    account_type: accountType || 'auto',
    term: term || '',
  });
  return lmsRenderSchedule(result);
}

async function lmsToolEmptyRooms(campus = '兴庆校区', building = '主楼D', date = '', startPeriod = 1, endPeriod = 11) {
  const result = await lmsEmptyRoomsQuery({
    campus: campus || '兴庆校区',
    building: building || '主楼D',
    date: date || '',
    start_period: Number(startPeriod) || 1,
    end_period: Number(endPeriod) || 11,
  });
  return lmsRenderEmptyRooms(result);
}

async function lmsToolStatus() {
  const cookie = lmsGetCookie();
  if (!cookie) {
    return '⚠️ **尚未登录 LMS**\n\n请打开 🎓 学习面板，使用统一身份认证登录；如果自动登录不可用，也可以手动填写 Cookie。';
  }
  const info = lmsParseSession(cookie);
  // 实测
  const r = await lmsApiGet('/api/todos');
  const parts = ['## 🔐 LMS Cookie 状态\n'];
  if (info) {
    parts.push(`- 👤 用户 ID：\`${info.uid || '?'}\``);
    parts.push(`- ⏰ 过期时间：${lmsFmtTime(info.expireAt)}`);
    const h = info.remainMs / 3600000;
    if (info.remainMs > 0) {
      parts.push(`- 📊 剩余有效：约 **${h.toFixed(1)} 小时** (${(h / 24).toFixed(2)} 天)`);
    } else {
      parts.push(`- ⛔ **已过期 ${(-h).toFixed(1)} 小时**`);
    }
  }
  parts.push('');
  if (r.ok) {
    const n = (r.data.todo_list || []).length;
    parts.push(`✅ Cookie 有效，API 调用正常（当前 **${n}** 项未完成作业）`);
  } else {
    parts.push(`❌ ${r.message || r.error}`);
  }
  return parts.join('\n');
}

async function lmsToolCourses() {
  const r = await lmsApiGet('/api/my-courses');
  if (!r.ok) return `❌ ${r.message || r.error}`;
  return lmsRenderCourses(r.data.courses || []);
}

async function lmsToolTodos() {
  const r = await lmsApiGet('/api/todos');
  if (!r.ok) return `❌ ${r.message || r.error}`;
  return lmsRenderTodos(r.data.todo_list || []);
}

async function lmsToolHomework(hwId) {
  const r = await lmsApiGet(`/api/homework-activities/${hwId}`);
  if (!r.ok) return `❌ ${r.message || r.error}`;
  return lmsRenderHomeworkDetail(r.data);
}

async function lmsToolMaterials(cid) {
  const [ra, rm] = await Promise.all([
    lmsApiGet(`/api/courses/${cid}/activities`),
    lmsApiGet(`/api/courses/${cid}/modules`),
  ]);
  if (!ra.ok) return `❌ ${ra.message || ra.error}`;
  return lmsRenderMaterials(
    (ra.data.activities) || [],
    ((rm.data && rm.data.modules) || []),
    cid
  );
}

async function lmsToolFindCourse(keyword) {
  const r = await lmsApiGet('/api/my-courses');
  if (!r.ok) return `❌ ${r.message || r.error}`;
  const kw = (keyword || '').toLowerCase();
  const hits = (r.data.courses || []).filter(c => (c.name || '').toLowerCase().includes(kw));
  if (!hits.length) return `🔍 没找到包含 "${keyword}" 的课程。`;
  const out = [`## 🔍 找到 ${hits.length} 门相关课程\n`];
  out.push('| 课程 ID | 课程名 | 学年 |');
  out.push('|--------:|--------|------|');
  hits.forEach(c => {
    out.push(`| \`${c.id}\` | ${c.name} | ${(c.academic_year && c.academic_year.name) || '?'} |`);
  });
  return out.join('\n');
}

/**
 * 下载文件：先拿授权 URL，必要时使用已加载的附件直链兜底。
 */
function lmsTriggerBrowserDownload(url, fname) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

async function lmsDownloadViaProxy(url, fname) {
  const cookie = lmsGetCookie();
  if (!cookie) return { ok: false, error: '尚未配置 LMS Cookie' };
  if (!(await lmsEnsureProxyToken())) {
    return { ok: false, error: '本地代理服务未就绪，请先启动 local_terminal_server.py' };
  }

  let parsed;
  try {
    parsed = new URL(url, 'https://lms.xjtu.edu.cn');
  } catch (e) {
    return { ok: false, error: '下载 URL 格式无效' };
  }

  const qs = new URLSearchParams({
    path: parsed.pathname + parsed.search,
    download: '1'
  }).toString();
  const resp = await fetch(`${lmsGetProxyServerUrl()}/lms-proxy?${qs}`, {
    method: 'GET',
    headers: {
      'X-Token': TERMINAL_CONFIG.token,
      'X-LMS-Cookie': cookie,
    }
  });
  if (!resp.ok) {
    let text = '';
    try { text = (await resp.text()).slice(0, 200); } catch (e) {}
    return { ok: false, error: `下载失败 (${resp.status})${text ? ': ' + text : ''}` };
  }

  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);
  try {
    lmsTriggerBrowserDownload(blobUrl, fname);
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  }
  return { ok: true };
}

async function lmsToolDownload(uploadId, filename) {
  const r = await lmsApiGet(`/api/uploads/${uploadId}/url`);
  const cached = lmsGetCachedUpload(uploadId);
  let realUrl = (r.ok && r.data && r.data.url) ? r.data.url : '';
  let source = realUrl ? '授权接口' : '';
  if (!realUrl && cached && cached.urlCandidates && cached.urlCandidates.length) {
    realUrl = cached.urlCandidates[0];
    source = 'LMS 返回的直链';
  }
  if (!realUrl) {
    const extra = r.ok ? '' : `\n\n接口返回：${r.message || r.error || '未知错误'}`;
    return '❌ 服务器没有返回可用下载地址。请先打开课件/作业详情刷新附件信息后再试；如果仍失败，说明当前账号未获得服务端可下载地址。' + extra;
  }
  // 解析默认文件名
  const fname = filename || (cached && cached.name) || lmsFilenameFromUrl(realUrl) || `upload_${uploadId}`;

  if (lmsCanProxyDownload(realUrl)) {
    const viaProxy = await lmsDownloadViaProxy(realUrl, fname);
    if (!viaProxy.ok) return `❌ ${viaProxy.error}`;
  } else {
    lmsTriggerBrowserDownload(realUrl, fname);
  }
  return `✅ 已触发下载：**${fname}**\n\n链接来源：${source}。浏览器应该弹出了保存窗口（或直接下到了默认下载目录）。`;
}

async function lmsToolSetCookie(cookie) {
  lmsSetCookie(cookie);
  if (!cookie) return '🗑 已清空 LMS Cookie。';
  const info = lmsParseSession(cookie);
  const parts = ['✅ Cookie 已保存到浏览器 localStorage。'];
  if (info) {
    parts.push(`\n- 👤 用户 ID：\`${info.uid || '?'}\``);
    parts.push(`- ⏰ 过期时间：${lmsFmtTime(info.expireAt)}`);
  }
  // 触发面板刷新（如果面板打开）
  if (typeof lmsPanelRefreshStatus === 'function') lmsPanelRefreshStatus();
  return parts.join('\n');
}

// ============ 工具注册说明 ============
// LMS 工具的元信息已迁移到 config.js 的 BUILTIN_TOOLS 数组中
// （与 execute_action / read_note 等其他内置工具地位相同）
// 本文件只负责提供 lmsToolXxx 系列实现函数，由 BUILTIN_TOOLS 的 code 字段调用。
