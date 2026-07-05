// ============ Security Records ============
// Local-only audit trail for privacy redaction and shell command review.

const SECURITY_RECORDS_STORAGE_KEY = 'aichat_security_records_v1';
const SECURITY_RECORDS_MAX = 500;
const SECURITY_RECORDS_FILTERS = [
  { value: 'all', label: '全部记录' },
  { value: 'privacy', label: '隐私脱敏' },
  { value: 'shell_audit', label: 'Shell 审核' }
];
const SecurityRecordsUiService = window.AgentApp.require('uiService');

function securityRecordsNowId() {
  return 'sec_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function securityRecordsEscape(value) {
  return typeof escapeHtml === 'function'
    ? escapeHtml(value == null ? '' : value)
    : String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function securityRecordsText(value, max = 600) {
  let text = value == null ? '' : String(value);
  text = text
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s"'`,;]+/ig, '$1[REDACTED]')
    .replace(/(api[-_]?key|access[-_]?token|refresh[-_]?token|cookie|password|passwd|secret)\s*[:=]\s*[^\s"'`,;]+/ig, '$1=[REDACTED]')
    .replace(/https?:\/\/[^\s"'`<>]+/gi, match => {
      try {
        const url = new URL(match);
        return url.origin + url.pathname + (url.search || url.hash ? '?[REDACTED]' : '');
      } catch (e) {
        return '[REDACTED_URL]';
      }
    })
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b1[3-9]\d{9}\b/g, '[REDACTED_PHONE]')
    .replace(/\b(?:\+?\d[\s-]?){10,16}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{17}[\dXx]\b/g, '[REDACTED_ID]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED_CARD]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s"'`]+/g, '$1[USER]')
    .replace(/(\/Users\/|\/home\/)[^\/\s"'`]+/g, '$1[USER]')
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED_KEY]')
    .replace(/([A-Za-z0-9+/_-]{32,}={0,2})/g, '[REDACTED_TOKEN]');
  if (text.length > max) text = text.slice(0, max) + '...';
  return text;
}

function securityRecordsArray(value, maxItems = 8) {
  if (!Array.isArray(value)) return [];
  return value.filter(v => v != null && String(v).trim()).slice(0, maxItems).map(v => securityRecordsText(v, 220));
}

function loadSecurityRecords() {
  try {
    const raw = localStorage.getItem(SECURITY_RECORDS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[security-records] load failed', error);
    return [];
  }
}

function saveSecurityRecords(records) {
  try {
    const list = Array.isArray(records) ? records.slice(-SECURITY_RECORDS_MAX) : [];
    localStorage.setItem(SECURITY_RECORDS_STORAGE_KEY, JSON.stringify(list));
  } catch (error) {
    console.warn('[security-records] save failed', error);
  }
}

function addSecurityRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const normalized = normalizeSecurityRecord(record);
  const list = loadSecurityRecords();
  list.push(normalized);
  saveSecurityRecords(list);
  refreshSecurityRecordsIfOpen();
  return normalized;
}

function normalizeSecurityRecord(record) {
  const type = record.type === 'shell_audit' ? 'shell_audit' : 'privacy';
  const detail = record.detail && typeof record.detail === 'object' ? record.detail : {};
  return {
    id: record.id || securityRecordsNowId(),
    ts: Number(record.ts || Date.now()),
    type,
    chatId: securityRecordsText(record.chatId || detail.chatId || '', 80),
    result: securityRecordsText(record.result || '', 80),
    risk: securityRecordsText(record.risk || detail.risk || '', 40),
    summary: securityRecordsText(record.summary || '', 240),
    detail: sanitizeSecurityRecordDetail(type, detail)
  };
}

function sanitizeSecurityRecordDetail(type, detail) {
  if (type === 'shell_audit') {
    return {
      command: securityRecordsText(detail.command || '', 900),
      cwd: securityRecordsText(detail.cwd || '', 240),
      workspace: securityRecordsText(detail.workspace || '', 240),
      allow: !!detail.allow,
      necessary: !!detail.necessary,
      autoAllow: !!detail.autoAllow,
      localBlock: !!detail.localBlock,
      finalAction: securityRecordsText(detail.finalAction || '', 60),
      reason: securityRecordsText(detail.reason || '', 500),
      concerns: securityRecordsArray(detail.concerns, 10)
    };
  }
  const counters = {};
  Object.entries(detail.counters || {}).forEach(([key, value]) => {
    const n = Number(value || 0);
    if (n > 0) counters[securityRecordsText(key, 40)] = n;
  });
  return {
    source: securityRecordsText(detail.source || '', 80),
    counters,
    strippedAttachments: Number(detail.strippedAttachments || 0),
    textAttachments: Number(detail.textAttachments || 0),
    highRiskCount: Number(detail.highRiskCount || 0),
    localRestoreEnabled: !!detail.localRestoreEnabled,
    localRestoreRetention: securityRecordsText(detail.localRestoreRetention || '', 40),
    restoreCount: Number(detail.restoreCount || 0),
    warnings: securityRecordsArray(detail.warnings, 10),
    responseGuard: sanitizeSecurityRecordResponseGuard(detail.responseGuard)
  };
}

function sanitizeSecurityRecordResponseGuard(value) {
  if (!value || typeof value !== 'object') return null;
  const status = String(value.status || '').toLowerCase() === 'missing' ? 'missing' : 'ok';
  return {
    status,
    marker: securityRecordsText(value.marker || '', 120),
    action: securityRecordsText(value.action || '', 40),
    source: securityRecordsText(value.source || '', 80),
    trimmedTail: !!value.trimmedTail
  };
}

function recordPrivacySecurityEvent(report, options = {}) {
  if (!report) return null;
  const total = securityRecordsCounterTotal(report.counters);
  const stripped = Number(report.strippedAttachments || 0);
  const warnings = Array.isArray(report.warnings) ? report.warnings.length : 0;
  const responseGuard = report.responseGuard && typeof report.responseGuard === 'object' ? report.responseGuard : null;
  if (!total && !stripped && !warnings && !report.highRiskCount && !responseGuard) return null;
  const types = securityRecordsCounterSummary(report.counters);
  const guardText = responseGuard
    ? `responseGuard:${responseGuard.status === 'missing' ? 'missing' : 'ok'}${responseGuard.trimmedTail ? ':trimmed-tail' : ''}`
    : '';
  return addSecurityRecord({
    type: 'privacy',
    ts: report.ts || Date.now(),
    result: responseGuard?.status === 'missing' ? 'response_guard_missing' : 'processed',
    summary: `${total} 处文本脱敏 · ${stripped} 个附件剥离${types ? ' · ' + types : ''}${guardText ? ' · ' + guardText : ''}`,
    detail: {
      source: options.source || '',
      counters: report.counters || {},
      strippedAttachments: report.strippedAttachments || 0,
      textAttachments: report.textAttachments || 0,
      highRiskCount: report.highRiskCount || 0,
      localRestoreEnabled: !!report.localRestoreEnabled,
      localRestoreRetention: report.localRestoreRetention || '',
      restoreCount: report.restoreCount || 0,
      warnings: report.warnings || [],
      responseGuard
    }
  });
}

function recordShellAuditSecurityEvent(decision, meta = {}) {
  if (!decision || decision.skipped) return null;
  const risk = String(decision.risk || 'high').toLowerCase();
  const finalAction = meta.finalAction || (decision.autoAllow ? 'auto_allow' : 'manual_required');
  return addSecurityRecord({
    type: 'shell_audit',
    ts: Date.now(),
    chatId: meta.chatId || meta.context?.chatId || '',
    result: finalAction,
    risk,
    summary: shellAuditRecordSummary(decision, finalAction),
    detail: {
      command: meta.command || '',
      cwd: meta.cwd || '',
      workspace: meta.workspace || meta.context?.workspace || '',
      allow: !!decision.allow,
      necessary: !!decision.necessary,
      autoAllow: !!decision.autoAllow,
      localBlock: !!decision.localBlock,
      finalAction,
      risk,
      reason: decision.reason || '',
      concerns: decision.concerns || []
    }
  });
}

function shellAuditRecordSummary(decision, finalAction) {
  const actionMap = {
    auto_allow: '自动放行',
    manual_allow: '用户放行',
    manual_reject: '用户拒绝',
    aborted: '中断',
    local_block: '本地路径拦截',
    error: '审核异常'
  };
  const action = actionMap[finalAction] || '需要用户确认';
  const riskMap = { low: '低风险', medium: '中风险', high: '高风险' };
  const risk = riskMap[String(decision.risk || 'high').toLowerCase()] || '高风险';
  return `${action} · ${risk} · ${decision.necessary ? '必要' : '必要性存疑'}`;
}

function securityRecordsCounterTotal(counters) {
  return Object.values(counters || {}).reduce((sum, n) => sum + Number(n || 0), 0);
}

function securityRecordsCounterSummary(counters) {
  return Object.entries(counters || {})
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([key, value]) => `${key}:${value}`)
    .join(' · ');
}

function clearSecurityRecords() {
  if (!confirm('确定清空安全记录吗？\n\n这只会删除本地安全事件账本，不会影响聊天记录、隐私设置或本地还原映射。')) return;
  saveSecurityRecords([]);
  renderSecurityRecords();
  SecurityRecordsUiService.toast('安全记录已清空', 1800);
}

function openSecurityRecords() {
  let modal = document.getElementById('securityRecordsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'securityRecordsModal';
    modal.className = 'modal-mask security-records-modal';
    modal.innerHTML = `
      <div class="modal wide" style="max-width:1120px;">
        <h2>安全记录 <button class="modal-close" data-action="closeSecurityRecords">×</button></h2>
        <div class="security-records-toolbar">
          <div class="security-records-note">仅保存在本地浏览器中。隐私记录只保存命中类型和数量；本地还原映射不会列举。</div>
          <div class="security-records-actions">
            <div class="security-records-filter form-group">
              <label for="securityRecordsFilter">记录类型</label>
              <select id="securityRecordsFilter" data-change-action="renderSecurityRecords">
                ${SECURITY_RECORDS_FILTERS.map(item => `<option value="${item.value}">${securityRecordsEscape(item.label)}</option>`).join('')}
              </select>
            </div>
            <button class="btn" type="button" data-action="renderSecurityRecords">刷新</button>
            <button class="btn btn-warning" type="button" data-action="clearSecurityRecords">清空</button>
          </div>
        </div>
        <div id="securityRecordsContent"></div>
        <div class="modal-footer">
          <button class="btn" data-action="closeSecurityRecords">关闭</button>
        </div>
      </div>`;
    modal.addEventListener('click', event => {
      if (event.target === modal) closeSecurityRecords();
    });
    document.body.appendChild(modal);
  }
  renderSecurityRecords();
  modal.classList.add('show');
}

function closeSecurityRecords() {
  const modal = document.getElementById('securityRecordsModal');
  if (modal) modal.classList.remove('show');
}

function refreshSecurityRecordsIfOpen() {
  const modal = document.getElementById('securityRecordsModal');
  if (modal && modal.classList.contains('show')) renderSecurityRecords();
}

function renderSecurityRecords() {
  const content = document.getElementById('securityRecordsContent');
  if (!content) return;
  const filter = getSecurityRecordsFilterValue();
  let records = loadSecurityRecords().slice().sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
  if (filter !== 'all') records = records.filter(record => record.type === filter);
  if (!records.length) {
    content.innerHTML = '<div class="security-records-empty">暂无安全记录。</div>';
    return;
  }
  content.innerHTML = `
    <div class="security-records-table-wrap">
      <table class="security-records-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>结果</th>
            <th>风险/命中</th>
            <th>摘要</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          ${records.map(renderSecurityRecordRow).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function getSecurityRecordsFilterValue() {
  const value = document.getElementById('securityRecordsFilter')?.value || 'all';
  return SECURITY_RECORDS_FILTERS.some(item => item.value === value) ? value : 'all';
}

function renderSecurityRecordRow(record) {
  const typeLabel = record.type === 'shell_audit' ? 'Shell 审核' : '隐私脱敏';
  const result = securityRecordResultLabel(record);
  const metric = record.type === 'shell_audit'
    ? securityRecordRiskBadge(record.risk)
    : securityRecordsCounterSummary(record.detail?.counters || {}) || '无文本命中';
  return `
    <tr>
      <td class="security-records-time">${securityRecordsEscape(formatSecurityRecordTime(record.ts))}</td>
      <td><span class="security-records-type ${record.type}">${typeLabel}</span></td>
      <td>${result}</td>
      <td>${metric}</td>
      <td>${securityRecordsEscape(record.summary || '')}</td>
      <td>${renderSecurityRecordDetail(record)}</td>
    </tr>
  `;
}

function securityRecordResultLabel(record) {
  const result = record.result || '';
  const labels = {
    processed: '已处理',
    auto_allow: '自动放行',
    manual_required: '需确认',
    manual_allow: '用户放行',
    manual_reject: '用户拒绝',
    aborted: '已中断',
    local_block: '本地拦截',
    error: '审核异常',
    response_guard_missing: '标记缺失'
  };
  const danger = ['manual_reject', 'local_block', 'error', 'response_guard_missing'].includes(result);
  const warn = ['manual_required', 'aborted'].includes(result);
  return `<span class="security-records-result ${danger ? 'danger' : (warn ? 'warn' : 'ok')}">${securityRecordsEscape(labels[result] || result || '-')}</span>`;
}

function securityRecordRiskBadge(risk) {
  const normalized = ['low', 'medium', 'high'].includes(String(risk || '').toLowerCase()) ? String(risk).toLowerCase() : '';
  const labels = { low: '低风险', medium: '中风险', high: '高风险' };
  if (!normalized) return '-';
  return `<span class="security-records-risk ${normalized}">${labels[normalized]}</span>`;
}

function renderSecurityRecordDetail(record) {
  const d = record.detail || {};
  if (record.type === 'shell_audit') {
    const concerns = (d.concerns || []).map(c => `<li>${securityRecordsEscape(c)}</li>`).join('');
    const flagPills = [
      securityRecordDetailPill(d.autoAllow ? '自动放行' : '人工确认', d.autoAllow ? 'ok' : 'warn'),
      securityRecordDetailPill(d.necessary ? '必要' : '必要性存疑', d.necessary ? 'ok' : 'warn'),
      securityRecordDetailPill(d.allow ? '审核允许' : '审核拦截', d.allow ? 'ok' : 'danger'),
      d.localBlock ? securityRecordDetailPill('本地路径拦截', 'danger') : ''
    ].filter(Boolean).join('');
    return `
      <details class="security-records-detail">
        <summary><span>详情</span><em>${securityRecordsEscape(securityRecordActionText(d.finalAction))}</em></summary>
        <div class="security-records-detail-panel">
          <div class="security-records-detail-strip">${flagPills}</div>
          <div class="security-records-detail-grid">
            ${securityRecordDetailItem('工作目录', d.cwd || '(默认)')}
            ${securityRecordDetailItem('工作区', d.workspace || '(未知)')}
          </div>
          <div class="security-records-detail-block">
            <div class="security-records-detail-label">命令预览</div>
            <pre>${securityRecordsEscape(d.command || '')}</pre>
          </div>
          <div class="security-records-detail-block">
            <div class="security-records-detail-label">审核理由</div>
            <p>${securityRecordsEscape(d.reason || '-')}</p>
          </div>
          ${concerns ? `
            <div class="security-records-detail-block danger">
              <div class="security-records-detail-label">风险点</div>
              <ul>${concerns}</ul>
            </div>` : ''}
        </div>
      </details>
    `;
  }
  const warnings = (d.warnings || []).map(w => `<li>${securityRecordsEscape(w)}</li>`).join('');
  const counterChips = Object.entries(d.counters || {})
    .map(([key, value]) => securityRecordDetailPill(`${key}:${value}`, 'neutral'))
    .join('') || securityRecordDetailPill('无文本命中', 'neutral');
  const restoreText = d.localRestoreEnabled ? `开启，仅记录 ${Number(d.restoreCount || 0)} 个映射数量` : '未开启';
  const responseGuardBlock = renderPrivacyResponseGuardDetail(d.responseGuard);
  return `
    <details class="security-records-detail">
      <summary><span>详情</span><em>${Number(d.highRiskCount || 0)} 个高风险命中</em></summary>
      <div class="security-records-detail-panel">
        <div class="security-records-detail-strip">${counterChips}</div>
        <div class="security-records-detail-grid">
          ${securityRecordDetailItem('来源', d.source || '-')}
          ${securityRecordDetailItem('附件处理', `${Number(d.strippedAttachments || 0)} 个剥离，${Number(d.textAttachments || 0)} 个纯文本附件处理`)}
          ${securityRecordDetailItem('本地还原', restoreText)}
          ${securityRecordDetailItem('高风险命中', `${Number(d.highRiskCount || 0)} 个`)}
        </div>
        ${warnings ? `
          <div class="security-records-detail-block warn">
            <div class="security-records-detail-label">警告</div>
            <ul>${warnings}</ul>
          </div>` : ''}
        ${responseGuardBlock}
      </div>
    </details>
  `;
}

function renderPrivacyResponseGuardDetail(responseGuard) {
  if (!responseGuard) return '';
  const statusText = responseGuard.status === 'missing' ? '未检测到结束标记' : '已检测到结束标记';
  const tone = responseGuard.status === 'missing' ? 'danger' : (responseGuard.trimmedTail ? 'warn' : 'ok');
  const tailText = responseGuard.trimmedTail ? '已切除标记后的尾部内容' : '未发现标记后尾部内容';
  return `
    <div class="security-records-detail-block ${tone === 'danger' ? 'danger' : (tone === 'warn' ? 'warn' : '')}">
      <div class="security-records-detail-label">响应防尾注</div>
      <p>${securityRecordsEscape(statusText)}；${securityRecordsEscape(tailText)}；动作：${securityRecordsEscape(responseGuard.action || '-')}；标记：${securityRecordsEscape(responseGuard.marker || '-')}</p>
    </div>
  `;
}

function securityRecordDetailPill(text, tone = 'neutral') {
  return `<span class="security-records-detail-pill ${tone}">${securityRecordsEscape(text)}</span>`;
}

function securityRecordDetailItem(label, value) {
  return `
    <div class="security-records-detail-item">
      <span>${securityRecordsEscape(label)}</span>
      <code>${securityRecordsEscape(value)}</code>
    </div>
  `;
}

function securityRecordActionText(action) {
  const labels = {
    auto_allow: '自动放行',
    manual_allow: '用户放行',
    manual_reject: '用户拒绝',
    aborted: '已中断',
    local_block: '本地拦截',
    error: '审核异常'
  };
  return labels[action] || '查看明细';
}

function formatSecurityRecordTime(ts) {
  const d = new Date(Number(ts || Date.now()));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

window.loadSecurityRecords = loadSecurityRecords;
window.saveSecurityRecords = saveSecurityRecords;
window.addSecurityRecord = addSecurityRecord;
window.recordPrivacySecurityEvent = recordPrivacySecurityEvent;
window.recordShellAuditSecurityEvent = recordShellAuditSecurityEvent;
window.clearSecurityRecords = clearSecurityRecords;
window.openSecurityRecords = openSecurityRecords;
window.closeSecurityRecords = closeSecurityRecords;
window.renderSecurityRecords = renderSecurityRecords;
