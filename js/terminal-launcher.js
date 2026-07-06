// ============ Sidebar terminal launcher ============

const TerminalLauncherUiService = window.AgentApp.require('uiService');

async function openRemoteWorkspaceTerminal() {
  if (typeof isRemoteAgentActive !== 'function' || !isRemoteAgentActive()) return false;
  if (typeof loadRemoteConnectionConfig !== 'function') throw new Error('远程连接配置不可用');
  if (typeof REMOTE_CONTROLLER === 'undefined' || !REMOTE_CONTROLLER.serverUrl) throw new Error('本地控制端地址不可用');

  const cfg = loadRemoteConnectionConfig();
  const sshCommand = String(cfg.sshCommand || '').trim();
  const remoteWorkspace = String(cfg.remoteWorkspace || '~').trim() || '~';
  if (!sshCommand) throw new Error('请先在远程连接里配置 SSH 命令');

  const resp = await fetch(REMOTE_CONTROLLER.serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'open_remote_terminal',
      ssh_command: sshCommand,
      remote_workspace: remoteWorkspace,
      session_id: (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.sessionId) || 'remote-terminal-ui'
    })
  });
  const r = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(r.error || `HTTP ${resp.status}`);
  if (!r || !r.ok) throw new Error((r && r.error) || '打开远程终端失败');
  TerminalLauncherUiService.toast(`已打开本机终端并连接到远程目录：${remoteWorkspace}`);
  return true;
}

async function openWorkspaceTerminal() {
  try {
    if (await openRemoteWorkspaceTerminal()) return;
    if (typeof callAgentBackend !== 'function') throw new Error('本地服务接口未加载');
    const r = await callAgentBackend('open_terminal', {}, null, null, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '打开终端失败');
    TerminalLauncherUiService.toast('已打开终端');
  } catch (e) {
    TerminalLauncherUiService.toast(e.message || String(e));
  }
}

window.openRemoteWorkspaceTerminal = openRemoteWorkspaceTerminal;
window.openWorkspaceTerminal = openWorkspaceTerminal;

window.AgentApp.define('terminalLauncher', {
  openRemoteWorkspaceTerminal,
  openWorkspaceTerminal
});
