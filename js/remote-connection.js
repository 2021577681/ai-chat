// ============ 远程连接：SSH 隧道 + 远程 Agent 后端 ============
const REMOTE_CONNECTION_KEY = 'snake_remote_connection_v1';
const REMOTE_CONTROLLER = {
  serverUrl: (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.serverUrl) ? TERMINAL_CONFIG.serverUrl : 'http://localhost:8765'
};

function remoteDefaultConfig() {
  return {
    sshCommand: 'ssh user@example.com',
    remoteWorkspace: '~/project',
    remoteAgentPort: 8765,
    localPort: 18765,
    heartbeatTimeout: 75,
    installDeps: true,
    encryptedPassword: ''
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

function setRemoteStatus(message, kind = '') {
  const el = document.getElementById('remoteConnectionStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = kind ? `remote-connection-status ${kind}` : 'remote-connection-status';
}

async function openRemoteConnection() {
  const modal = document.getElementById('remoteConnectionModal');
  if (!modal) return;
  const cfg = loadRemoteConnectionConfig();
  const password = await remoteDecryptPassword(cfg.encryptedPassword || '');
  document.getElementById('remoteSshCommand').value = cfg.sshCommand || '';
  document.getElementById('remotePassword').value = password || '';
  document.getElementById('remoteWorkspace').value = cfg.remoteWorkspace || '';
  document.getElementById('remoteAgentPort').value = cfg.remoteAgentPort || 8765;
  document.getElementById('remoteLocalPort').value = cfg.localPort || 18765;
  document.getElementById('remoteHeartbeatTimeout').value = cfg.heartbeatTimeout || 75;
  document.getElementById('remoteInstallDeps').checked = cfg.installDeps !== false;
  setRemoteStatus('填写 SSH 命令和远程工作区后点击连接。');
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
    heartbeatTimeout: parseInt(document.getElementById('remoteHeartbeatTimeout').value, 10) || 75,
    installDeps: !!document.getElementById('remoteInstallDeps').checked
  };
}

async function saveRemoteConnectionFromUi() {
  const v = remoteFormValues();
  const encryptedPassword = await remoteEncryptPassword(v.password || '');
  saveRemoteConnectionConfig({
    sshCommand: v.sshCommand,
    remoteWorkspace: v.remoteWorkspace,
    remoteAgentPort: v.remoteAgentPort,
    localPort: v.localPort,
    heartbeatTimeout: v.heartbeatTimeout,
    installDeps: v.installDeps,
    encryptedPassword
  });
  setRemoteStatus('配置已加密保存到本地。', 'ok');
  if (typeof toast === 'function') toast('远程连接配置已保存');
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

async function connectRemoteAgent() {
  const btn = document.getElementById('remoteConnectBtn');
  const oldServerUrl = TERMINAL_CONFIG.serverUrl;
  let remoteStarted = false;
  const v = remoteFormValues();
  if (!v.sshCommand) return setRemoteStatus('请填写 SSH 命令，例如 ssh user@example.com', 'error');
  if (!v.remoteWorkspace) return setRemoteStatus('请填写远程工作区目录。', 'error');
  if (!confirm('将通过 SSH 上传并在远程服务器启动 Agent 后端，继续？')) return;
  if (btn) btn.disabled = true;
  setRemoteStatus('正在保存配置...', 'loading');
  await saveRemoteConnectionFromUi();
  try {
    setRemoteStatus('正在打包、上传、启动远程 Agent 并建立隧道，可能需要几十秒...', 'loading');
    const r = await remoteBackend('remote_connect', {
      ssh_command: v.sshCommand,
      password: v.password,
      remote_workspace: v.remoteWorkspace,
      remote_agent_port: v.remoteAgentPort,
      local_port: v.localPort,
      heartbeat_timeout: v.heartbeatTimeout,
      install_deps: v.installDeps,
      requestTimeoutMs: 240000
    });
    if (!r.ok) throw new Error(r.error || '远程连接失败');
    remoteStarted = true;
    TERMINAL_CONFIG.serverUrl = r.server_url;
    const workspaceInfo = await refreshWorkspaceInfo();
    if (!workspaceInfo || workspaceInfo.ok === false) throw new Error('远程 Agent 已启动，但无法读取远程工作区。');
    if (typeof resetFileExplorerToRoot === 'function') resetFileExplorerToRoot();
    setRemoteStatus(`已连接：${r.server_url} → ${v.remoteWorkspace}`, 'ok');
    if (typeof toast === 'function') toast('远程 Agent 已连接');
  } catch (e) {
    TERMINAL_CONFIG.serverUrl = oldServerUrl;
    if (remoteStarted) {
      try {
        await remoteBackend('remote_disconnect', { requestTimeoutMs: 60000 });
      } catch (disconnectError) {
        console.warn('[remote] cleanup after failed connect failed:', disconnectError);
      }
    }
    setRemoteStatus('连接失败：' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function disconnectRemoteAgent() {
  if (!confirm('断开本地 SSH 隧道？如勾选停止远程 Agent，会尝试 kill 远程进程。')) return;
  const v = remoteFormValues();
  try {
    setRemoteStatus('正在断开...', 'loading');
    await remoteBackend('remote_disconnect', { password: v.password, stop_remote: !!document.getElementById('remoteStopRemote').checked, requestTimeoutMs: 60000 });
  } catch (e) {
    console.warn('[remote] disconnect failed:', e);
  }
  TERMINAL_CONFIG.serverUrl = REMOTE_CONTROLLER.serverUrl || 'http://localhost:8765';
  await refreshWorkspaceInfo();
  setRemoteStatus(`已切回控制端 ${TERMINAL_CONFIG.serverUrl}`, 'ok');
}

async function checkRemoteStatus() {
  try {
    const r = await remoteBackend('remote_status', { requestTimeoutMs: 30000 });
    setRemoteStatus(
      r.connected ? `隧道在线：${r.server_url}，PID ${r.tunnel_pid}，心跳超时 ${r.heartbeat_timeout || 75}s` : '当前没有活动远程隧道。', r.connected ? 'ok' : ''
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
window.checkRemoteStatus = checkRemoteStatus;
