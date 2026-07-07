// ============ 远程连接：SSH 隧道 + 远程 Agent 后端 ============
const REMOTE_CONNECTION_KEY = 'snake_remote_connection_v1';
const RemoteConnectionUiService = window.AgentApp.require('uiService');
const REMOTE_CONTROLLER = {
  serverUrl: (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.serverUrl) ? TERMINAL_CONFIG.serverUrl : 'http://localhost:8765'
};
const REMOTE_DIR_PICKER = {
  currentPath: '~',
  parentPath: '~'
};
const REMOTE_HEARTBEAT_DEFAULT_SECONDS = 300;
let remoteAutoReconnectAttempted = false;

function remoteDefaultConfig() {
  return {
    sshCommand: 'ssh user@example.com',
    remoteWorkspace: '~/',
    remoteAgentPort: 8765,
    localPort: 18765,
    heartbeatTimeout: REMOTE_HEARTBEAT_DEFAULT_SECONDS,
    installDeps: true,
    encryptedPassword: '',
    autoReconnect: false,
    lastConnectedAt: 0,
    lastServerUrl: ''
  };
}

async function remoteCryptoKey() {
  const raw = `${location.origin || 'file://snake'}::snake-remote-connection`;
  const bytes = new TextEncoder().encode(raw.padEnd(32, '#').slice(0, 32));
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function remoteEncryptPassword(password) {
  if (!password) return '';
  if (!window.crypto || !crypto.subtle) return btoa(unescape(encodeURIComponent(password)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await remoteCryptoKey();
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(password));
  const all = new Uint8Array(iv.length + enc.byteLength);
  all.set(iv, 0);
  all.set(new Uint8Array(enc), iv.length);
  return 'aesgcm:' + btoa(String.fromCharCode(...all));
}

async function remoteDecryptPassword(cipher) {
  if (!cipher) return '';
  try {
    if (!cipher.startsWith('aesgcm:')) return decodeURIComponent(escape(atob(cipher)));
    const bin = atob(cipher.slice(7));
    const all = Uint8Array.from(bin, c => c.charCodeAt(0));
    const iv = all.slice(0, 12);
    const data = all.slice(12);
    const key = await remoteCryptoKey();
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(dec);
  } catch (e) {
    console.warn('[remote] 密码解密失败:', e);
    return '';
  }
}

function loadRemoteConnectionConfig() {
  try {
    const raw = storage.get(REMOTE_CONNECTION_KEY);
    return { ...remoteDefaultConfig(), ...(raw ? JSON.parse(raw) : {}) };
  } catch (e) {
    return remoteDefaultConfig();
  }
}

function saveRemoteConnectionConfig(cfg) {
  storage.set(REMOTE_CONNECTION_KEY, JSON.stringify({ ...remoteDefaultConfig(), ...(cfg || {}) }));
}

function updateRemoteConnectionConfig(patch = {}) {
  const cfg = loadRemoteConnectionConfig();
  const next = { ...cfg, ...(patch || {}) };
  saveRemoteConnectionConfig(next);
  return next;
}

function isRemoteAgentActive() {
  return !!(
    typeof TERMINAL_CONFIG !== 'undefined' &&
    TERMINAL_CONFIG.serverUrl &&
    REMOTE_CONTROLLER.serverUrl &&
    TERMINAL_CONFIG.serverUrl !== REMOTE_CONTROLLER.serverUrl
  );
}

function persistActiveRemoteConnection(info = {}) {
  const workspace = (info && (info.workspace || info.cwd || info.remoteWorkspace)) || '';
  const patch = {
    autoReconnect: true,
    lastConnectedAt: Date.now(),
    lastServerUrl: (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.serverUrl) || ''
  };
  if (workspace) patch.remoteWorkspace = workspace;
  return updateRemoteConnectionConfig(patch);
}

function clearRemoteAutoReconnectFlag() {
  return updateRemoteConnectionConfig({
    autoReconnect: false,
    lastServerUrl: '',
    lastConnectedAt: 0
  });
}

function noteRemoteWorkspaceChanged(path) {
  const workspace = String(path || '').trim();
  if (!workspace || !isRemoteAgentActive()) return;
  updateRemoteConnectionConfig({
    remoteWorkspace: workspace,
    autoReconnect: true,
    lastConnectedAt: Date.now(),
    lastServerUrl: TERMINAL_CONFIG.serverUrl || ''
  });
}

function setRemoteStatus(message, kind = '') {
  const el = document.getElementById('remoteConnectionStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = kind ? `remote-connection-status ${kind}` : 'remote-connection-status';
}

function remoteEscapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function applyRemoteConfigToForm(cfg, password = '') {
  const config = { ...remoteDefaultConfig(), ...(cfg || {}) };
  document.getElementById('remoteSshCommand').value = config.sshCommand || '';
  document.getElementById('remotePassword').value = password || '';
  document.getElementById('remoteWorkspace').value = config.remoteWorkspace || '';
  document.getElementById('remoteAgentPort').value = config.remoteAgentPort || 8765;
  document.getElementById('remoteLocalPort').value = config.localPort || 18765;
  document.getElementById('remoteHeartbeatTimeout').value = Math.max(120, parseInt(config.heartbeatTimeout, 10) || REMOTE_HEARTBEAT_DEFAULT_SECONDS);
  document.getElementById('remoteInstallDeps').checked = config.installDeps !== false;
}

async function openRemoteConnection() {
  const modal = document.getElementById('remoteConnectionModal');
  if (!modal) return;
  const cfg = loadRemoteConnectionConfig();
  const password = await remoteDecryptPassword(cfg.encryptedPassword || '');
  applyRemoteConfigToForm(cfg, password);
  setRemoteStatus('填写 SSH 命令后点击连接；远程工作区留空时默认使用远程用户主目录 ~。');
  modal.classList.add('show');
}

function closeRemoteConnection() {
  const modal = document.getElementById('remoteConnectionModal');
  if (modal) modal.classList.remove('show');
}

function remoteFormValues() {
  return {
    sshCommand: document.getElementById('remoteSshCommand').value.trim(),
    password: document.getElementById('remotePassword').value,
    remoteWorkspace: document.getElementById('remoteWorkspace').value.trim() || '~/',
    remoteAgentPort: parseInt(document.getElementById('remoteAgentPort').value, 10) || 8765,
    localPort: parseInt(document.getElementById('remoteLocalPort').value, 10) || 18765,
    heartbeatTimeout: Math.max(120, parseInt(document.getElementById('remoteHeartbeatTimeout').value, 10) || REMOTE_HEARTBEAT_DEFAULT_SECONDS),
    installDeps: !!document.getElementById('remoteInstallDeps').checked
  };
}

async function saveRemoteConnectionFromUi(options = {}) {
  const v = remoteFormValues();
  const encryptedPassword = await remoteEncryptPassword(v.password || '');
  const existing = loadRemoteConnectionConfig();
  saveRemoteConnectionConfig({
    ...existing,
    sshCommand: v.sshCommand,
    remoteWorkspace: v.remoteWorkspace,
    remoteAgentPort: v.remoteAgentPort,
    localPort: v.localPort,
    heartbeatTimeout: v.heartbeatTimeout,
    installDeps: v.installDeps,
    encryptedPassword
  });
  if (!options.silent) {
    setRemoteStatus('Remote connection config saved locally.', 'ok');
    RemoteConnectionUiService.toast('Remote connection config saved');
  }
}
async function remoteBackend(action, params = {}) {
  const requestTimeoutMs = Math.max(1000, parseInt(params.requestTimeoutMs, 10) || 75000);
  const payload = { ...params };
  delete payload.requestTimeoutMs;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), requestTimeoutMs);
  try {
    const resp = await fetch(REMOTE_CONTROLLER.serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload, session_id: TERMINAL_CONFIG.sessionId || 'remote-ui' }),
      signal: ctrl.signal
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error(`远程控制请求超时（${Math.round(requestTimeoutMs / 1000)}s）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function loadRemoteDir(path) {
  const v = remoteFormValues();
  if (!v.sshCommand) {
    setRemoteStatus('请先填写 SSH 命令，再浏览远程目录。', 'error');
    return;
  }
  const picker = document.getElementById('remoteDirPicker');
  const currentEl = document.getElementById('remoteDirCurrent');
  const listEl = document.getElementById('remoteDirList');
  if (picker) picker.classList.add('show');
  if (currentEl) currentEl.textContent = '正在读取：' + (path || '~');
  if (listEl) listEl.innerHTML = '<div class="remote-dir-empty">正在通过 SSH 读取远程目录...</div>';
  setRemoteStatus('正在读取远程目录：' + (path || '~'), 'loading');
  try {
    const r = await remoteBackend('remote_list_dirs', {
      ssh_command: v.sshCommand,
      password: v.password,
      path: path || '~',
      requestTimeoutMs: 60000
    });
    if (!r.ok) throw new Error(r.error || '远程目录读取失败');
    REMOTE_DIR_PICKER.currentPath = r.path || path || '~';
    REMOTE_DIR_PICKER.parentPath = r.parent || REMOTE_DIR_PICKER.currentPath;
    if (currentEl) {
      currentEl.textContent = REMOTE_DIR_PICKER.currentPath;
      currentEl.title = REMOTE_DIR_PICKER.currentPath;
    }
    renderRemoteDirList(r.entries || [], !!r.truncated);
    setRemoteStatus('已读取远程目录，点击文件夹进入，或选择当前目录作为工作区。', 'ok');
  } catch (e) {
    if (currentEl) currentEl.textContent = '读取失败：' + e.message;
    if (listEl) listEl.innerHTML = `<div class="remote-dir-empty">读取失败：${remoteEscapeHtml(e.message)}</div>`;
    setRemoteStatus('远程目录读取失败：' + e.message, 'error');
  }
}

function renderRemoteDirList(entries, truncated) {
  const listEl = document.getElementById('remoteDirList');
  if (!listEl) return;
  if (!entries.length) {
    listEl.innerHTML = '<div class="remote-dir-empty">当前目录下没有可显示的子目录</div>';
    return;
  }
  const rows = entries.map(item => {
    const path = item.path || item.name;
    const disabledHint = (!item.readable || !item.executable) ? '（权限可能不足）' : '';
    return `<button class="remote-dir-item" type="button" data-path="${remoteEscapeHtml(path)}" title="${remoteEscapeHtml(path)}">
      <span>📁</span><span>${remoteEscapeHtml(item.name)} ${remoteEscapeHtml(disabledHint)}</span>
    </button>`;
  });
  if (truncated) rows.push('<div class="remote-dir-empty">目录过多，仅显示前部分结果</div>');
  listEl.innerHTML = rows.join('');
  listEl.querySelectorAll('.remote-dir-item').forEach(btn => {
    btn.addEventListener('click', () => loadRemoteDir(btn.dataset.path));
  });
}

async function openRemoteDirPicker() {
  const input = document.getElementById('remoteWorkspace');
  const start = (input && input.value.trim()) || REMOTE_DIR_PICKER.currentPath || '~';
  await loadRemoteDir(start);
}

async function refreshRemoteDirPicker() {
  await loadRemoteDir(REMOTE_DIR_PICKER.currentPath || '~');
}

async function remoteDirGoHome() {
  await loadRemoteDir('~');
}

async function remoteDirGoParent() {
  await loadRemoteDir(REMOTE_DIR_PICKER.parentPath || '~');
}

async function selectRemoteDirCurrent() {
  const input = document.getElementById('remoteWorkspace');
  const selected = REMOTE_DIR_PICKER.currentPath || '~';
  if (input) input.value = selected;
  const picker = document.getElementById('remoteDirPicker');
  if (picker) picker.classList.remove('show');

  // 这里的“选择当前目录”默认只是写入远程连接表单，用于下一次连接。
  // 如果当前已经连上远程 Agent，则进一步调用远程 Agent 的 set_workspace，真正切换当前沙箱。
  if (typeof saveRemoteConnectionFromUi === 'function') {
    try { await saveRemoteConnectionFromUi(); } catch (e) { console.warn('[remote] save selected dir failed:', e); }
  }

  const remoteActive = !!(
    typeof TERMINAL_CONFIG !== 'undefined' &&
    TERMINAL_CONFIG.serverUrl &&
    REMOTE_CONTROLLER.serverUrl &&
    TERMINAL_CONFIG.serverUrl !== REMOTE_CONTROLLER.serverUrl
  );

  if (!remoteActive) {
    setRemoteStatus('已选择远程工作区：' + selected + '。点击“连接远程”后生效。', 'ok');
    return;
  }

  try {
    setRemoteStatus('正在切换远程沙箱目录：' + selected, 'loading');
    const r = await workspaceBackendAction('set_workspace', { path: selected });
    if (!r.ok) throw new Error(r.error || '切换远程沙箱目录失败');
    updateWorkspaceDisplay(r);
    refreshWorkspaceDependentContext();
    noteRemoteWorkspaceChanged(r.workspace || r.cwd || selected);
    if (typeof resetFileExplorerToRoot === 'function') resetFileExplorerToRoot();
    setRemoteStatus('远程沙箱目录已切换：' + (r.workspace || selected), 'ok');
    RemoteConnectionUiService.toast('✓ 远程沙箱目录已切换');
  } catch (e) {
    setRemoteStatus('远程目录已填入，但切换当前沙箱失败：' + e.message, 'error');
  }
}

async function connectRemoteAgent(options = {}) {
  const opts = (options && typeof options === 'object' && !('target' in options)) ? options : {};
  const autoReconnect = !!opts.autoReconnect;
  const skipConfirm = !!opts.skipConfirm || autoReconnect;
  const btn = document.getElementById('remoteConnectBtn');
  const oldServerUrl = TERMINAL_CONFIG.serverUrl;
  const oldRemoteGitProxyUrl = TERMINAL_CONFIG.remoteGitProxyUrl || '';
  let remoteStarted = false;
  const v = remoteFormValues();
  if (!v.sshCommand) return setRemoteStatus('请填写 SSH 命令，例如 ssh user@example.com', 'error');
  if (!skipConfirm && !confirm('将通过 SSH 上传并在远程服务器启动 Agent 后端，继续？')) return;
  if (btn) btn.disabled = true;
  setRemoteStatus(autoReconnect ? '正在恢复上次远程连接...' : '正在保存配置...', 'loading');
  if (!autoReconnect) {
    await saveRemoteConnectionFromUi({ silent: !!opts.silentSave });
  }
  try {
    setRemoteStatus(autoReconnect ? '正在自动连接上次远程工作区，可能需要几十秒...' : '正在打包、上传、启动远程 Agent 并建立隧道，可能需要几十秒...', 'loading');
    const r = await remoteBackend('remote_connect', {
      ssh_command: v.sshCommand,
      password: v.password,
      remote_workspace: v.remoteWorkspace,
      remote_agent_port: v.remoteAgentPort,
      local_port: v.localPort,
      heartbeat_timeout: v.heartbeatTimeout,
      install_deps: v.installDeps,
      git_proxy: (typeof gitProxyConfigForBackend === 'function') ? gitProxyConfigForBackend() : undefined,
      requestTimeoutMs: 240000
    });
    if (!r.ok) throw new Error(r.error || '远程连接失败');
    remoteStarted = true;
    TERMINAL_CONFIG.remoteGitProxyUrl = r.reverse_git_proxy_url || '';
    TERMINAL_CONFIG.serverUrl = r.server_url;

    let workspaceInfo = r.workspace_info;
    if (!workspaceInfo) {
      workspaceInfo = await refreshWorkspaceInfo();
    }
    if (!workspaceInfo || workspaceInfo.ok === false) {
      const detail = (workspaceInfo && workspaceInfo.error)
        || r.workspace_error
        || (Array.isArray(r.logs) && r.logs.length ? r.logs.join('\n') : '')
        || '请检查远程工作区目录是否存在且有权限访问';
      console.error('[remote] workspace read failed', { response: r, workspaceInfo });
      throw new Error('远程 Agent 已启动，但无法读取远程工作区：' + detail);
    }
    if (typeof updateWorkspaceDisplay === 'function') {
      updateWorkspaceDisplay(workspaceInfo);
    }
    persistActiveRemoteConnection({
      workspace: workspaceInfo.workspace || workspaceInfo.cwd || v.remoteWorkspace,
      cwd: workspaceInfo.cwd,
      remoteWorkspace: v.remoteWorkspace
    });
    if (typeof resetFileExplorerToRoot === 'function') resetFileExplorerToRoot();
    setRemoteStatus(`已连接：${r.server_url} → ${workspaceInfo.workspace || v.remoteWorkspace}`, 'ok');
    RemoteConnectionUiService.toast('远程 Agent 已连接');
  } catch (e) {
    TERMINAL_CONFIG.serverUrl = oldServerUrl;
    TERMINAL_CONFIG.remoteGitProxyUrl = oldRemoteGitProxyUrl;
    if (remoteStarted) {
      try {
        await remoteBackend('remote_disconnect', { requestTimeoutMs: 60000 });
      } catch (disconnectError) {
        console.warn('[remote] cleanup after failed connect failed:', disconnectError);
      }
    }
    console.error('[remote] connect failed:', e);
    setRemoteStatus('连接失败：' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function disconnectRemoteAgent(options = {}) {
  const opts = (options && typeof options === 'object' && !('target' in options)) ? options : {};
  if (!opts.skipConfirm && !confirm('断开本地 SSH 隧道？如勾选停止远程 Agent，会尝试 kill 远程进程。')) return;
  const v = remoteFormValues();
  const stopRemoteEl = document.getElementById('remoteStopRemote');
  const stopRemote = Object.prototype.hasOwnProperty.call(opts, 'stopRemote')
    ? !!opts.stopRemote
    : !!(stopRemoteEl && stopRemoteEl.checked);
  try {
    if (!opts.silent) setRemoteStatus('正在断开...', 'loading');
    await remoteBackend('remote_disconnect', { password: v.password, stop_remote: stopRemote, requestTimeoutMs: 60000 });
  } catch (e) {
    console.warn('[remote] disconnect failed:', e);
  }
  clearRemoteAutoReconnectFlag();
  TERMINAL_CONFIG.serverUrl = REMOTE_CONTROLLER.serverUrl || 'http://localhost:8765';
  TERMINAL_CONFIG.remoteGitProxyUrl = '';
  if (opts.refreshWorkspace !== false) await refreshWorkspaceInfo();
  if (!opts.silent) setRemoteStatus(`已切回控制端 ${TERMINAL_CONFIG.serverUrl}`, 'ok');
}

async function initRemoteConnection() {
  if (remoteAutoReconnectAttempted) return;
  remoteAutoReconnectAttempted = true;
  const cfg = loadRemoteConnectionConfig();
  if (!cfg.autoReconnect || !cfg.sshCommand || !cfg.remoteWorkspace) return;
  if (isRemoteAgentActive()) return;

  const password = await remoteDecryptPassword(cfg.encryptedPassword || '');
  applyRemoteConfigToForm(cfg, password);
  setRemoteStatus('正在恢复上次远程连接：' + cfg.remoteWorkspace, 'loading');
  await connectRemoteAgent({ autoReconnect: true, skipConfirm: true, silentSave: true });
}

async function checkRemoteStatus() {
  try {
    const r = await remoteBackend('remote_status', { requestTimeoutMs: 30000 });
    if (r.connected && r.reverse_git_proxy_url) {
      TERMINAL_CONFIG.remoteGitProxyUrl = r.reverse_git_proxy_url;
    } else if (!r.connected) {
      TERMINAL_CONFIG.remoteGitProxyUrl = '';
    }
    setRemoteStatus(
      r.connected ? `隧道在线：${r.server_url}，PID ${r.tunnel_pid}，心跳超时 ${r.heartbeat_timeout || REMOTE_HEARTBEAT_DEFAULT_SECONDS}s` : '当前没有活动远程隧道。', r.connected ? 'ok' : ''
    );
  } catch (e) {
    setRemoteStatus('状态检查失败：' + e.message, 'error');
  }
}

window.openRemoteConnection = openRemoteConnection;
window.closeRemoteConnection = closeRemoteConnection;
window.saveRemoteConnectionFromUi = saveRemoteConnectionFromUi;
window.connectRemoteAgent = connectRemoteAgent;
window.disconnectRemoteAgent = disconnectRemoteAgent;
window.initRemoteConnection = initRemoteConnection;
window.noteRemoteWorkspaceChanged = noteRemoteWorkspaceChanged;
window.checkRemoteStatus = checkRemoteStatus;
window.openRemoteDirPicker = openRemoteDirPicker;
window.refreshRemoteDirPicker = refreshRemoteDirPicker;
window.remoteDirGoHome = remoteDirGoHome;
window.remoteDirGoParent = remoteDirGoParent;
window.selectRemoteDirCurrent = selectRemoteDirCurrent;

window.AgentApp.define('remoteConnection', {
  openRemoteConnection,
  closeRemoteConnection,
  saveRemoteConnectionFromUi,
  connectRemoteAgent,
  disconnectRemoteAgent,
  initRemoteConnection,
  noteRemoteWorkspaceChanged,
  checkRemoteStatus,
  openRemoteDirPicker,
  refreshRemoteDirPicker,
  remoteDirGoHome,
  remoteDirGoParent,
  selectRemoteDirCurrent
});
