// ============ Sidebar terminal launcher ============

const TerminalLauncherUiService = window.AgentApp.require('uiService');

async function openWorkspaceTerminal() {
  try {
    if (typeof callAgentBackend !== 'function') throw new Error('本地服务接口未加载');
    const r = await callAgentBackend('open_terminal', {}, null, null, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '打开终端失败');
    TerminalLauncherUiService.toast('已打开终端');
  } catch (e) {
    TerminalLauncherUiService.toast(e.message || String(e));
  }
}

window.openWorkspaceTerminal = openWorkspaceTerminal;

window.AgentApp.define('terminalLauncher', {
  openWorkspaceTerminal
});
