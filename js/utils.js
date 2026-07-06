// ============ 通用工具函数 ============

const UtilsStateModule = window.AgentApp.require('state');
const utilsState = UtilsStateModule.state;

function toast(msg, ms = 1800) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}

function scrollBottom() {
  const el = document.getElementById('messages');
  if (el) el.scrollTop = el.scrollHeight;
}

let _completionSoundAudioCtx = null;

function ensureCompletionSoundReady() {
  try {
    if (!utilsState.settings || !utilsState.settings.completionSoundEnabled) return;
    if (utilsState.settings.musicPlayer && utilsState.settings.musicPlayer.completionSoundMode === 'music') return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!_completionSoundAudioCtx) _completionSoundAudioCtx = new AudioCtx();
    if (_completionSoundAudioCtx.state === 'suspended') {
      _completionSoundAudioCtx.resume().catch(() => {});
    }
  } catch (e) {}
}

function playCompletionSound(options = {}) {
  try {
    if (!utilsState.settings || !utilsState.settings.completionSoundEnabled) return;
    if (options && options.suppress) return;
    if (utilsState.settings.musicPlayer
      && utilsState.settings.musicPlayer.completionSoundMode === 'music'
      && typeof playMusicCompletionSound === 'function'
      && playMusicCompletionSound()) {
      return;
    }
    playDefaultCompletionSound();
  } catch (e) {}
}

function playDefaultCompletionSound() {
  try {
    const rawVolume = parseInt(utilsState.settings.completionSoundVolume);
    const volumePct = isNaN(rawVolume) ? 80 : Math.max(0, Math.min(100, rawVolume));
    if (volumePct <= 0) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = _completionSoundAudioCtx || (_completionSoundAudioCtx = new AudioCtx());
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const volume = volumePct / 100;
    const peak = 0.08 + 0.67 * volume;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    master.connect(ctx.destination);

    [880, 1175].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.07;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(idx ? 0.55 : 0.65, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  } catch (e) {}
}

// ⭐ 判断用户是否在消息列表底部附近（默认 120px 容差）
// 用于实现"用户在底部时自动跟随；用户翻看历史时不打扰"
function isNearBottom(threshold = 120) {
  const el = document.getElementById('messages');
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function buildFullUrl(baseUrl, path) {
  if (!baseUrl) return '';
  const b = baseUrl.replace(/\/+$/, '');
  const p = (path || '').startsWith('/') ? path : '/' + (path || '');
  // ⭐ 智能去重：如果 baseUrl 末尾已经包含 path（如用户把完整端点填进了 baseUrl），
  // 不再重复追加，避免出现 .../chat/completions/chat/completions 这种 404 陷阱
  if (p && p !== '/' && b.toLowerCase().endsWith(p.toLowerCase())) {
    return b;
  }
  return b + p;
}

function updateTopUrlPreview() {
  // 旧 URL 预览栏已移除，此函数保留为空（被其他模块调用）
  // 改为刷新沙箱信息栏
  if (typeof refreshWorkspaceInfo === 'function') refreshWorkspaceInfo();
}

// ⭐ 刷新顶部沙箱信息栏（从本地服务读取 workspace）
let _wsRefreshTimer = null;
let _workspaceSelectInFlight = false;

function updateWorkspaceDisplay(info) {
  const pathEl = document.getElementById('workspacePath');
  const statusEl = document.getElementById('workspaceStatus');
  if (!pathEl || !statusEl) return;
  const ws = (info && (info.workspace || info.cwd)) || '(未知)';
  const cwd = (info && (info.cwd || info.workspace)) || ws;
  if (typeof TERMINAL_CONFIG !== 'undefined') {
    TERMINAL_CONFIG.workspace = ws;
    TERMINAL_CONFIG.cwd = cwd;
  }
  pathEl.textContent = ws;
  pathEl.title = `点击复制\n沙箱根：${ws}\n当前 cwd：${cwd}`;
  pathEl.onclick = () => {
    navigator.clipboard.writeText(ws).then(() => toast('✓ 路径已复制'));
  };
  statusEl.className = 'workspace-status online';
  statusEl.title = '本地服务在线';
}

async function workspaceBackendAction(action, params = {}) {
  const url = (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.serverUrl)
    ? TERMINAL_CONFIG.serverUrl : 'http://localhost:8765';

  const body = {
    action,
    ...params,
    session_id: (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.sessionId)
      ? TERMINAL_CONFIG.sessionId
      : 'workspace-ui'
  };
  const doPost = () => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  let resp = await doPost();
  let data = null;
  try {
    data = await resp.json();
  } catch (e) {}
  if (!resp.ok) throw new Error((data && data.error) || ('HTTP ' + resp.status));
  return data || {};
}

function refreshWorkspaceDependentContext() {
  try {
    if (typeof initProjectInstructions === 'function') initProjectInstructions(false);
  } catch (e) {
    console.warn('[workspace] refresh project instructions failed:', e);
  }
  try {
    if (typeof clearLoadedProjectMemory === 'function') clearLoadedProjectMemory();
  } catch (e) {
    console.warn('[workspace] clear project memory failed:', e);
  }
}

async function selectWorkspaceFromUi() {
  if (_workspaceSelectInFlight) return;
  _workspaceSelectInFlight = true;
  const pathEl = document.getElementById('workspacePath');
  const statusEl = document.getElementById('workspaceStatus');
  const previousText = pathEl ? pathEl.textContent : '';
  try {
    if (statusEl) {
      statusEl.className = 'workspace-status checking';
      statusEl.title = '正在选择沙箱目录...';
    }
    if (pathEl) {
      pathEl.textContent = '等待选择文件夹...';
      pathEl.title = '请在弹出的系统窗口里选择新的沙箱目录';
    }
    const initial = (typeof TERMINAL_CONFIG !== 'undefined' && (TERMINAL_CONFIG.workspace || TERMINAL_CONFIG.cwd)) || '';
    const r = await workspaceBackendAction('select_workspace', { initial_dir: initial });
    if (r.cancelled) {
      toast('已取消选择沙箱目录');
      await refreshWorkspaceInfo();
      return;
    }
    if (!r.ok) throw new Error(r.error || '切换沙箱目录失败');
    updateWorkspaceDisplay(r);
    if (typeof noteRemoteWorkspaceChanged === 'function') noteRemoteWorkspaceChanged(r.workspace || r.cwd);
    refreshWorkspaceDependentContext();
    if (typeof resetFileExplorerToRoot === 'function') resetFileExplorerToRoot();
    toast('✓ 沙箱目录已切换');
  } catch (e) {
    if (pathEl && previousText) pathEl.textContent = previousText;
    toast('切换沙箱目录失败：' + e.message, 4500);
    await refreshWorkspaceInfo();
  } finally {
    _workspaceSelectInFlight = false;
  }
}

async function refreshWorkspaceInfo() {
  const pathEl = document.getElementById('workspacePath');
  const statusEl = document.getElementById('workspaceStatus');
  
  if (statusEl) {
    statusEl.className = 'workspace-status checking';
    statusEl.title = '正在连接 Agent 服务…';
  }
  
  try {
    const url = (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.serverUrl)
      ? TERMINAL_CONFIG.serverUrl : 'http://localhost:8765';
    const resp = await fetch(url + '/workspace', { method: 'GET' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();
    if (pathEl && statusEl) updateWorkspaceDisplay(j);
    return j;
  } catch (e) {
    console.warn('[workspace] failed to read workspace:', e);
    if (!pathEl || !statusEl) {
      return { ok: false, error: e.message };
    }
    pathEl.textContent = '⚠️ 未连接到本地服务（python local_terminal_server.py）';
    pathEl.title = e.message;
    pathEl.onclick = null;
    statusEl.className = 'workspace-status offline';
    statusEl.title = '本地服务离线：' + e.message;
    return { ok: false, error: e.message };
  }
}
window.refreshWorkspaceInfo = refreshWorkspaceInfo;
window.selectWorkspaceFromUi = selectWorkspaceFromUi;

function updateUrlPreview() {
  const baseUrl = document.getElementById('baseUrl').value.trim();
  const apiPath = document.getElementById('apiPath').value.trim();
  document.getElementById('finalUrlPreview').textContent = buildFullUrl(baseUrl, apiPath) || '（请填写）';
}

function extractUserQuestion(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const m = messages[i];
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) return m.content.filter(p => p.type === 'text').map(p => p.text).join('\n') || '(图片输入)';
    }
  }
  return '';
}

function showImagePreview(src) {
  document.getElementById('imgPreviewSrc').src = src;
  document.getElementById('imgPreview').classList.add('show');
}

function copyCode(id) {
  const el = document.getElementById(id);
  if (el) navigator.clipboard.writeText(el.textContent).then(() => toast('✓ 代码已复制'));
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  // 移动端用 .open（fixed 滑出/滑入），PC 端用 .collapsed
  if (window.matchMedia('(max-width: 768px)').matches) {
    sb.classList.toggle('open');
  } else {
    sb.classList.toggle('collapsed');
    try { storage.set('aichat_sidebar_collapsed', sb.classList.contains('collapsed') ? '1' : '0'); } catch (e) {}
  }
}

function collapseSidebar() {
  const sb = document.getElementById('sidebar');
  if (window.matchMedia('(max-width: 768px)').matches) {
    sb.classList.remove('open');
  } else {
    sb.classList.add('collapsed');
    try { storage.set('aichat_sidebar_collapsed', '1'); } catch (e) {}
  }
}

// 启动时恢复折叠状态（PC 端）
// ⚠️ 这段代码会在 idb-store.js 还没异步初始化完成前执行 → 优先用 storage（缓存可能为空，
//     此时回退读 localStorage），保证首屏不闪烁。
(function restoreSidebarState() {
  try {
    const flag = (typeof storage !== 'undefined' && storage.get)
      ? storage.get('aichat_sidebar_collapsed')
      : localStorage.getItem('aichat_sidebar_collapsed');
    if (flag === '1' && !window.matchMedia('(max-width: 768px)').matches) {
      // DOM 还没渲染好时延迟应用
      document.addEventListener('DOMContentLoaded', () => {
        const sb = document.getElementById('sidebar');
        if (sb) sb.classList.add('collapsed');
      });
    }
  } catch (e) {}
})();

function useSuggestion(text) {
  document.getElementById('input').value = text;
  document.getElementById('input').focus();
}

window.AgentApp.define('utils', {
  toast,
  escapeHtml,
  formatSize,
  scrollBottom,
  ensureCompletionSoundReady,
  playCompletionSound,
  playDefaultCompletionSound,
  isNearBottom,
  buildFullUrl,
  updateTopUrlPreview,
  updateWorkspaceDisplay,
  workspaceBackendAction,
  refreshWorkspaceDependentContext,
  selectWorkspaceFromUi,
  refreshWorkspaceInfo,
  updateUrlPreview,
  extractUserQuestion,
  showImagePreview,
  copyCode,
  toggleSidebar,
  collapseSidebar,
  useSuggestion
});
