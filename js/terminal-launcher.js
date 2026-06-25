// ============ Sidebar terminal launcher ============

async function openWorkspaceTerminal() {
  try {
    if (typeof callAgentBackend !== 'function') throw new Error('本地服务接口未加载');
    const r = await callAgentBackend('open_terminal', {}, null, null, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '打开终端失败');
    if (typeof toast === 'function') toast('已打开终端');
  } catch (e) {
    if (typeof toast === 'function') toast(e.message || String(e));
  }
}

window.openWorkspaceTerminal = openWorkspaceTerminal;
