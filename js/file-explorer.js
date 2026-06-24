// ============ Sidebar File Explorer ============

const FILE_EXPLORER_STATE = {
  visible: false,
  path: '.',
  loading: false,
  entries: [],
  editorPath: '',
  editorOriginal: '',
  editorLoading: false
};

const FILE_EXPLORER_TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'xml', 'svg',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php',
  'rb', 'swift', 'kt', 'kts', 'sql', 'sh', 'bash', 'zsh', 'ps1',
  'bat', 'cmd', 'gitignore', 'dockerfile', 'env', 'log', 'csv',
  'tsv', 'properties'
]);

function normalizeExplorerPath(path) {
  let p = String(path || '.').replace(/\\/g, '/').trim();
  if (!p || p === '/') return '.';
  p = p.replace(/^\/+/, '').replace(/\/+$/g, '');
  return p || '.';
}

function joinExplorerPath(base, name) {
  const root = normalizeExplorerPath(base);
  const cleanName = String(name || '').replace(/[\\/]+/g, '/').replace(/^\/+/, '').replace(/\/+$/g, '');
  if (!cleanName) return root;
  return root === '.' ? cleanName : `${root}/${cleanName}`;
}

function parentExplorerPath(path) {
  const p = normalizeExplorerPath(path);
  if (p === '.') return '.';
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? parts.join('/') : '.';
}

function fileExplorerIcon(entry) {
  if (!entry || entry.type === 'dir') return '📁';
  const name = String(entry.name || '').toLowerCase();
  if (/\.(html?|css|js|ts|tsx|jsx|py|json|md|txt|bat|cmd|sh|yml|yaml)$/.test(name)) return '📄';
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/.test(name)) return '🖼️';
  if (/\.pdf$/.test(name)) return '📕';
  return '📄';
}

function fileExplorerExtension(path) {
  const name = String(path || '').split('/').pop().toLowerCase();
  if (!name) return '';
  if (name === 'dockerfile' || name === 'makefile' || name === 'license') return name;
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1) : '';
}

function isFileExplorerTextFile(path) {
  return FILE_EXPLORER_TEXT_EXTENSIONS.has(fileExplorerExtension(path));
}

function setFileEditorStatus(message, kind = '') {
  const el = document.getElementById('fileEditorStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = kind ? `file-editor-status ${kind}` : 'file-editor-status';
}

function fileEditorTextarea() {
  return document.getElementById('fileEditorContent');
}

function fileExplorerSort(entries) {
  return (entries || []).slice().sort((a, b) => {
    const ad = a.type === 'dir' ? 0 : 1;
    const bd = b.type === 'dir' ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });
}

function renderFileExplorerLoading() {
  const list = document.getElementById('fileExplorerList');
  if (list) {
    list.innerHTML = '<div class="file-explorer-empty">正在读取沙箱目录...</div>';
  }
}

function renderFileExplorer() {
  const list = document.getElementById('fileExplorerList');
  const pathEl = document.getElementById('fileExplorerPath');
  const upBtn = document.getElementById('fileExplorerUpBtn');
  if (pathEl) pathEl.textContent = FILE_EXPLORER_STATE.path;
  if (upBtn) upBtn.disabled = FILE_EXPLORER_STATE.path === '.';
  if (!list) return;

  const entries = fileExplorerSort(FILE_EXPLORER_STATE.entries);
  if (!entries.length) {
    list.innerHTML = '<div class="file-explorer-empty">这个目录是空的。</div>';
    return;
  }

  list.innerHTML = entries.map(entry => {
    const name = entry.name || '';
    const isDir = entry.type === 'dir';
    const path = joinExplorerPath(FILE_EXPLORER_STATE.path, name);
    const meta = isDir ? '文件夹' : formatSize(Number(entry.size || 0));
    return `
      <button class="file-explorer-item ${isDir ? 'is-dir' : 'is-file'}" type="button" data-path="${escapeHtml(path)}" data-type="${escapeHtml(entry.type || '')}" title="${escapeHtml(path)}">
        <span class="file-explorer-icon">${fileExplorerIcon(entry)}</span>
        <span class="file-explorer-name">${escapeHtml(name)}</span>
        <span class="file-explorer-meta">${escapeHtml(meta)}</span>
      </button>
    `;
  }).join('');
}

async function loadFileExplorer(path = FILE_EXPLORER_STATE.path) {
  if (FILE_EXPLORER_STATE.loading) return;
  FILE_EXPLORER_STATE.loading = true;
  FILE_EXPLORER_STATE.path = normalizeExplorerPath(path);
  renderFileExplorerLoading();
  const pathEl = document.getElementById('fileExplorerPath');
  if (pathEl) pathEl.textContent = FILE_EXPLORER_STATE.path;
  try {
    if (typeof callAgentBackend !== 'function') throw new Error('本地工具接口未加载');
    const r = await callAgentBackend('list_dir', { path: FILE_EXPLORER_STATE.path });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '读取目录失败');
    FILE_EXPLORER_STATE.entries = Array.isArray(r.entries) ? r.entries : [];
    renderFileExplorer();
  } catch (e) {
    const list = document.getElementById('fileExplorerList');
    if (list) {
      list.innerHTML = `<div class="file-explorer-empty error">${escapeHtml(e.message || String(e))}</div>`;
    }
  } finally {
    FILE_EXPLORER_STATE.loading = false;
  }
}

function setSidebarExplorerMode(visible) {
  FILE_EXPLORER_STATE.visible = !!visible;
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebarExplorerBtn');
  const chatPanel = document.getElementById('sidebarChatPanel');
  const explorerPanel = document.getElementById('sidebarExplorerPanel');
  if (sidebar) sidebar.classList.toggle('explorer-open', FILE_EXPLORER_STATE.visible);
  if (btn) {
    btn.classList.toggle('active', FILE_EXPLORER_STATE.visible);
    btn.setAttribute('aria-pressed', FILE_EXPLORER_STATE.visible ? 'true' : 'false');
  }
  if (chatPanel) chatPanel.hidden = FILE_EXPLORER_STATE.visible;
  if (explorerPanel) explorerPanel.hidden = !FILE_EXPLORER_STATE.visible;
  if (FILE_EXPLORER_STATE.visible) loadFileExplorer(FILE_EXPLORER_STATE.path);
}

function toggleSidebarExplorer() {
  setSidebarExplorerMode(!FILE_EXPLORER_STATE.visible);
}

function refreshFileExplorer() {
  loadFileExplorer(FILE_EXPLORER_STATE.path);
}

function resetFileExplorerToRoot() {
  FILE_EXPLORER_STATE.path = '.';
  FILE_EXPLORER_STATE.entries = [];
  if (FILE_EXPLORER_STATE.visible) loadFileExplorer('.');
  else renderFileExplorer();
}

function closeFileEditor(force = false) {
  const modal = document.getElementById('fileEditorModal');
  const textarea = fileEditorTextarea();
  if (!force && textarea && FILE_EXPLORER_STATE.editorPath && textarea.value !== FILE_EXPLORER_STATE.editorOriginal) {
    if (!confirm('文件有未保存修改，确定关闭？')) return;
  }
  if (modal) modal.classList.remove('show');
}

async function openFileEditor(path) {
  const normalizedPath = normalizeExplorerPath(path);
  if (!isFileExplorerTextFile(normalizedPath)) {
    if (typeof toast === 'function') toast('暂只支持文本类文件');
    return;
  }
  const modal = document.getElementById('fileEditorModal');
  const pathEl = document.getElementById('fileEditorPath');
  const textarea = fileEditorTextarea();
  if (!modal || !textarea) return;
  FILE_EXPLORER_STATE.editorPath = normalizedPath;
  FILE_EXPLORER_STATE.editorOriginal = '';
  if (pathEl) pathEl.textContent = normalizedPath;
  textarea.value = '';
  textarea.disabled = true;
  modal.classList.add('show');
  setFileEditorStatus('正在读取...', 'loading');
  try {
    if (typeof callAgentBackend !== 'function') throw new Error('本地工具接口未加载');
    const r = await callAgentBackend('read_file', { path: normalizedPath });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '读取文件失败');
    textarea.value = r.content || '';
    textarea.disabled = false;
    FILE_EXPLORER_STATE.editorOriginal = textarea.value;
    setFileEditorStatus(`${formatSize(Number(r.size || 0))} / 已读取`, 'ok');
    textarea.focus();
  } catch (e) {
    textarea.disabled = true;
    setFileEditorStatus(e.message || String(e), 'error');
  }
}

async function reloadFileEditor() {
  if (!FILE_EXPLORER_STATE.editorPath) return;
  const textarea = fileEditorTextarea();
  if (textarea && textarea.value !== FILE_EXPLORER_STATE.editorOriginal) {
    if (!confirm('重新读取会丢弃未保存修改，继续？')) return;
  }
  await openFileEditor(FILE_EXPLORER_STATE.editorPath);
}

async function saveFileEditor() {
  const path = FILE_EXPLORER_STATE.editorPath;
  const textarea = fileEditorTextarea();
  if (!path || !textarea) return;
  const content = textarea.value;
  setFileEditorStatus('等待保存确认...', 'loading');
  const preview = content.slice(0, 500) + (content.length > 500 ? '\n...' : '');
  try {
    const r = await callAgentBackend(
      'write_file',
      { path, content },
      '保存文本文件修改',
      `[保存文件] ${path}\n\n字符数：${content.length}\n\n${preview}`
    );
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '保存失败');
    FILE_EXPLORER_STATE.editorOriginal = content;
    setFileEditorStatus(`已保存 ${formatSize(Number(r.bytes_written || 0))}`, 'ok');
    if (typeof toast === 'function') toast('文件已保存');
    if (FILE_EXPLORER_STATE.visible) refreshFileExplorer();
  } catch (e) {
    setFileEditorStatus(e.message || String(e), 'error');
  }
}

function copyFileEditorContent() {
  const textarea = fileEditorTextarea();
  if (!textarea) return;
  navigator.clipboard.writeText(textarea.value).then(() => {
    if (typeof toast === 'function') toast('内容已复制');
  });
}

function fileExplorerGoUp() {
  const parent = parentExplorerPath(FILE_EXPLORER_STATE.path);
  if (parent !== FILE_EXPLORER_STATE.path) loadFileExplorer(parent);
}

function handleFileExplorerClick(event) {
  const item = event.target.closest('.file-explorer-item');
  if (!item) return;
  const path = item.dataset.path || '.';
  const type = item.dataset.type || '';
  if (type === 'dir') {
    loadFileExplorer(path);
    return;
  }
  if (isFileExplorerTextFile(path)) openFileEditor(path);
  else if (typeof toast === 'function') toast('暂只支持文本类文件');
}

document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('fileExplorerList');
  if (list) list.addEventListener('click', handleFileExplorerClick);
  setSidebarExplorerMode(false);
});

window.toggleSidebarExplorer = toggleSidebarExplorer;
window.setSidebarExplorerMode = setSidebarExplorerMode;
window.refreshFileExplorer = refreshFileExplorer;
window.fileExplorerGoUp = fileExplorerGoUp;
window.resetFileExplorerToRoot = resetFileExplorerToRoot;
window.openFileEditor = openFileEditor;
window.closeFileEditor = closeFileEditor;
window.reloadFileEditor = reloadFileEditor;
window.saveFileEditor = saveFileEditor;
window.copyFileEditorContent = copyFileEditorContent;
