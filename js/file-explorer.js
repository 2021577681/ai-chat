// ============ Sidebar File Explorer ============

const FILE_EXPLORER_STATE = {
  visible: false,
  path: '.',
  loading: false,
  entries: [],
  editorPath: '',
  editorOriginal: '',
  editorLoading: false,
  pdfPath: '',
  pdfObjectUrl: '',
  imagePath: '',
  imageObjectUrl: '',
  mediaPath: '',
  mediaObjectUrl: '',
  contextPath: '',
  contextType: '',
  mediaKind: '',
  contextScope: '',
  inlineFilePath: '',
  inlineFileKind: '',
  inlineFileSide: 'right',
  inlineChatWidth: 50
};

const INLINE_FILE_MIN_WINDOW_WIDTH = 1100;
const INLINE_FILE_MIN_MAIN_WIDTH = 920;
const INLINE_FILE_MIN_CHAT_WIDTH = 460;
const INLINE_FILE_MIN_FILE_WIDTH = 360;

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
  if (/\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|avif)$/.test(name)) return '🖼️';
  if (/\.pdf$/.test(name)) return '📕';
  if (/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/.test(name)) return '🎵';
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(name)) return '🎬';
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

function isFileExplorerPdfFile(path) {
  return fileExplorerExtension(path) === 'pdf';
}

function isFileExplorerImageFile(path) {
  return /^(png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif)$/i.test(fileExplorerExtension(path));
}

function isFileExplorerAudioFile(path) {
  return /^(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(fileExplorerExtension(path));
}

function isFileExplorerVideoFile(path) {
  return /^(mp4|webm|mov|m4v|ogv)$/i.test(fileExplorerExtension(path));
}

function isFileExplorerMediaFile(path) {
  return isFileExplorerAudioFile(path) || isFileExplorerVideoFile(path);
}

async function fileExplorerPreviewUrl(path) {
  if (typeof TERMINAL_CONFIG === 'undefined') throw new Error('本地服务配置未加载');
  const base = (TERMINAL_CONFIG.serverUrl || 'http://localhost:8765').replace(/\/+$/, '');
  return `${base}/preview-file?path=${encodeURIComponent(normalizeExplorerPath(path))}`;
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

function ensureFileExplorerContextMenu() {
  let menu = document.getElementById('fileExplorerContextMenu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'fileExplorerContextMenu';
  menu.className = 'file-explorer-context-menu';
  menu.hidden = true;
  menu.innerHTML = `
    <div data-menu-section="item">
      <button type="button" data-action="open">打开</button>
      <button type="button" data-action="rename">重命名</button>
      <button type="button" data-action="copy-path">复制路径</button>
      <button type="button" data-action="delete">删除</button>
    </div>
    <div data-menu-section="blank">
      <button type="button" data-action="new-file">新建文件</button>
      <button type="button" data-action="new-folder">新建文件夹</button>
      <button type="button" data-action="copy-path">复制路径</button>
      <button type="button" data-action="switch-workspace">切换工作区</button>
    </div>
  `;
  document.body.appendChild(menu);
  return menu;
}

function hideFileExplorerContextMenu() {
  const menu = document.getElementById('fileExplorerContextMenu');
  if (menu) menu.hidden = true;
  FILE_EXPLORER_STATE.contextPath = '';
  FILE_EXPLORER_STATE.contextType = '';
  FILE_EXPLORER_STATE.contextScope = '';
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

function setInlineFileStatus(message, kind = '') {
  const el = document.getElementById('inlineFileStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = kind ? `inline-file-status ${kind}` : 'inline-file-status';
}

function setInlineFileChrome(path, title) {
  const titleEl = document.getElementById('inlineFileTitle');
  const pathEl = document.getElementById('inlineFilePath');
  const name = fileExplorerBasename(path) || title || '文件内容';
  if (titleEl) titleEl.textContent = name;
  if (pathEl) pathEl.textContent = path || '-';
}

function clearInlineFileContent() {
  const body = document.getElementById('inlineFileBody');
  const footer = document.getElementById('inlineFileFooter');
  if (body) {
    body.querySelectorAll('iframe').forEach(frame => frame.removeAttribute('src'));
    body.innerHTML = '';
  }
  if (footer) footer.innerHTML = '';
}

function inlineFileCanStayOpen() {
  return inlineFileLayoutFits(Number(FILE_EXPLORER_STATE.inlineChatWidth || 50));
}

function inlineFileLayoutFits(chatPercent = 50) {
  const mainContent = document.getElementById('mainContent');
  const mainWidth = mainContent ? mainContent.getBoundingClientRect().width : window.innerWidth;
  const safeChatPercent = Math.min(75, Math.max(35, Number(chatPercent) || 50));
  const chatWidth = mainWidth * safeChatPercent / 100;
  const fileWidth = mainWidth - chatWidth;
  return window.innerWidth >= INLINE_FILE_MIN_WINDOW_WIDTH &&
    mainWidth >= INLINE_FILE_MIN_MAIN_WIDTH &&
    chatWidth >= INLINE_FILE_MIN_CHAT_WIDTH &&
    fileWidth >= INLINE_FILE_MIN_FILE_WIDTH;
}

function inlineFileOpenBlockedMessage() {
  return '窗口较窄，无法在主页面显示文件内容，请放大浏览器窗口后再试';
}

function enforceInlineFileResponsive() {
  const panel = document.getElementById('inlineFilePanel');
  if (!panel || panel.hidden) return;
  if (!inlineFileCanStayOpen()) {
    closeInlineFilePanel();
    if (typeof toast === 'function') toast('窗口较窄，已关闭文件内容列');
  }
}

function applyInlineFileLayout() {
  const mainContent = document.getElementById('mainContent');
  const toggle = document.getElementById('inlineFileSideToggle');
  if (!mainContent) return;
  const side = FILE_EXPLORER_STATE.inlineFileSide === 'left' ? 'left' : 'right';
  const width = Math.min(75, Math.max(35, Number(FILE_EXPLORER_STATE.inlineChatWidth || 50)));
  mainContent.classList.toggle('inline-file-left', side === 'left');
  mainContent.classList.toggle('inline-file-right', side !== 'left');
  mainContent.style.setProperty('--chat-column-width', `${width}%`);
  if (toggle) toggle.textContent = side === 'left' ? '右列' : '左列';
}

function toggleInlineFileSide() {
  FILE_EXPLORER_STATE.inlineFileSide = FILE_EXPLORER_STATE.inlineFileSide === 'left' ? 'right' : 'left';
  applyInlineFileLayout();
}

function setInlineChatWidth(percent) {
  FILE_EXPLORER_STATE.inlineChatWidth = Math.min(75, Math.max(35, Number(percent) || 50));
  applyInlineFileLayout();
}

function showInlineFilePanel(kind, path) {
  if (!inlineFileLayoutFits(FILE_EXPLORER_STATE.inlineChatWidth) && inlineFileLayoutFits(50)) {
    FILE_EXPLORER_STATE.inlineChatWidth = 50;
  }
  if (!inlineFileCanStayOpen()) {
    if (typeof toast === 'function') toast(inlineFileOpenBlockedMessage());
    return false;
  }
  const mainContent = document.getElementById('mainContent');
  const panel = document.getElementById('inlineFilePanel');
  if (!mainContent || !panel) return false;
  FILE_EXPLORER_STATE.inlineFileKind = kind || '';
  FILE_EXPLORER_STATE.inlineFilePath = normalizeExplorerPath(path);
  panel.hidden = false;
  mainContent.classList.add('has-inline-file');
  applyInlineFileLayout();
  setInlineFileChrome(FILE_EXPLORER_STATE.inlineFilePath, kind === 'pdf' ? 'PDF 阅读器' : '文本内容');
  return true;
}

function closeInlineFilePanel() {
  const mainContent = document.getElementById('mainContent');
  const panel = document.getElementById('inlineFilePanel');
  if (mainContent) {
    mainContent.classList.remove('has-inline-file', 'inline-file-left', 'inline-file-right', 'is-resizing');
    mainContent.style.removeProperty('--chat-column-width');
  }
  if (panel) panel.hidden = true;
  clearInlineFileContent();
  FILE_EXPLORER_STATE.inlineFilePath = '';
  FILE_EXPLORER_STATE.inlineFileKind = '';
}

async function openTextInMainPanel(path, initialContent = null, initialSize = null) {
  const normalizedPath = normalizeExplorerPath(path);
  if (!isFileExplorerTextFile(normalizedPath)) {
    if (typeof toast === 'function') toast('暂只支持文本类文件');
    return false;
  }
  if (!showInlineFilePanel('text', normalizedPath)) return false;
  const body = document.getElementById('inlineFileBody');
  const footer = document.getElementById('inlineFileFooter');
  if (!body || !footer) return false;
  clearInlineFileContent();
  const textarea = document.createElement('textarea');
  textarea.spellcheck = false;
  textarea.placeholder = '文件内容...';
  body.appendChild(textarea);
  footer.innerHTML = `
    <button class="btn" type="button" onclick="copyInlineFileContent()">复制内容</button>
    <button class="btn" type="button" onclick="reloadInlineFilePanel()">重新读取</button>
  `;
  if (initialContent !== null && initialContent !== undefined) {
    textarea.value = String(initialContent);
    setInlineFileStatus(`${initialSize !== null && initialSize !== undefined ? formatSize(Number(initialSize || 0)) : `${textarea.value.length} 字符`} / 已显示`, 'ok');
    textarea.focus();
    return true;
  }
  textarea.disabled = true;
  setInlineFileStatus('正在读取...', 'loading');
  try {
    if (typeof callAgentBackend !== 'function') throw new Error('本地工具接口未加载');
    const r = await callAgentBackend('read_file', { path: normalizedPath });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '读取文件失败');
    textarea.value = r.content || '';
    textarea.disabled = false;
    setInlineFileStatus(`${formatSize(Number(r.size || 0))} / 已读取`, 'ok');
    textarea.focus();
    return true;
  } catch (e) {
    textarea.disabled = true;
    setInlineFileStatus(e.message || String(e), 'error');
  }
  return true;
}

async function openPdfInMainPanel(path, existingUrl = '') {
  const normalizedPath = normalizeExplorerPath(path);
  if (!isFileExplorerPdfFile(normalizedPath)) {
    if (typeof toast === 'function') toast('仅支持 PDF 文件');
    return false;
  }
  if (!showInlineFilePanel('pdf', normalizedPath)) return false;
  const body = document.getElementById('inlineFileBody');
  const footer = document.getElementById('inlineFileFooter');
  if (!body || !footer) return false;
  clearInlineFileContent();
  const frame = document.createElement('iframe');
  frame.title = 'PDF 阅读器';
  body.appendChild(frame);
  footer.innerHTML = `
    <button class="btn" type="button" onclick="reloadInlineFilePanel()">重新读取</button>
    <button class="btn" type="button" onclick="openInlineFileInNewTab()">新标签打开</button>
  `;
  setInlineFileStatus('正在读取...', 'loading');
  try {
    const url = existingUrl || await fileExplorerPreviewUrl(normalizedPath);
    frame.src = url;
    setInlineFileStatus('直接预览 / 支持大文件', 'ok');
  } catch (e) {
    frame.removeAttribute('src');
    setInlineFileStatus(e.message || String(e), 'error');
  }
  return true;
}

async function openCurrentFileInMainPanel(kind) {
  if (kind === 'pdf') {
    const path = FILE_EXPLORER_STATE.pdfPath;
    const url = FILE_EXPLORER_STATE.pdfObjectUrl;
    if (!path) return;
    const opened = await openPdfInMainPanel(path, url);
    if (opened) closePdfViewer();
    return;
  }
  const path = FILE_EXPLORER_STATE.editorPath;
  const textarea = fileEditorTextarea();
  if (!path) return;
  const opened = await openTextInMainPanel(path, textarea ? textarea.value : null);
  if (opened) closeFileEditor(true);
}

function copyInlineFileContent() {
  const textarea = document.querySelector('#inlineFileBody textarea');
  if (!textarea) return;
  navigator.clipboard.writeText(textarea.value).then(() => {
    if (typeof toast === 'function') toast('内容已复制');
  });
}

async function reloadInlineFilePanel() {
  const path = FILE_EXPLORER_STATE.inlineFilePath;
  const kind = FILE_EXPLORER_STATE.inlineFileKind;
  if (!path) return;
  if (kind === 'pdf') await openPdfInMainPanel(path);
  else if (kind === 'text') await openTextInMainPanel(path);
}

function openInlineFileInNewTab() {
  const frame = document.querySelector('#inlineFileBody iframe');
  const src = frame ? frame.getAttribute('src') : '';
  if (src) window.open(src, '_blank', 'noopener');
}

function startInlineFileResize(event) {
  const mainContent = document.getElementById('mainContent');
  if (!mainContent || !mainContent.classList.contains('has-inline-file')) return;
  event.preventDefault();
  mainContent.classList.add('is-resizing');
  const onMove = e => {
    const rect = mainContent.getBoundingClientRect();
    if (!rect.width) return;
    const x = Math.min(rect.right, Math.max(rect.left, e.clientX));
    let chatPercent;
    if (FILE_EXPLORER_STATE.inlineFileSide === 'left') {
      const filePercent = ((x - rect.left) / rect.width) * 100;
      chatPercent = 100 - filePercent;
    } else {
      chatPercent = ((x - rect.left) / rect.width) * 100;
    }
    setInlineChatWidth(chatPercent);
  };
  const onUp = () => {
    mainContent.classList.remove('is-resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function bindInlineFileResizer() {
  const resizer = document.getElementById('inlineFileResizer');
  if (!resizer || resizer.dataset.bound === '1') return;
  resizer.dataset.bound = '1';
  resizer.addEventListener('mousedown', startInlineFileResize);
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
    if (/文件过大/.test(e.message || String(e))) {
      try {
        const url = await fileExplorerPreviewUrl(normalizedPath);
        textarea.value = `文件较大，已改用浏览器只读预览：\n${url}\n\n如果没有自动打开，请复制上面的链接到浏览器。`;
        window.open(url, '_blank', 'noopener');
        setFileEditorStatus('文件较大 / 已打开只读预览', 'ok');
        return;
      } catch (_) {}
    }
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

function openFileExplorerPath(path, type = '') {
  const normalizedPath = normalizeExplorerPath(path);
  if (type === 'dir') {
    loadFileExplorer(normalizedPath);
    return;
  }
  if (isFileExplorerTextFile(normalizedPath)) openFileEditor(normalizedPath);
  else if (isFileExplorerPdfFile(normalizedPath)) openPdfViewer(normalizedPath);
  else if (isFileExplorerImageFile(normalizedPath)) openImageViewer(normalizedPath);
  else if (isFileExplorerMediaFile(normalizedPath)) openMediaViewer(normalizedPath);
  else if (typeof toast === 'function') toast('暂只支持文本类文件、PDF、图片、音频和视频');
}

function siblingExplorerPath(path, newName) {
  const parent = parentExplorerPath(path);
  const cleanName = String(newName || '').replace(/[\\/]+/g, '').trim();
  if (!cleanName) return '';
  return parent === '.' ? cleanName : `${parent}/${cleanName}`;
}

function fileExplorerBasename(path) {
  return String(path || '').split('/').filter(Boolean).pop() || '';
}

function setPdfViewerStatus(message, kind = '') {
  const el = document.getElementById('pdfViewerStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = kind ? `file-editor-status ${kind}` : 'file-editor-status';
}

function clearPdfViewerObjectUrl() {
  if (FILE_EXPLORER_STATE.pdfObjectUrl) {
    URL.revokeObjectURL(FILE_EXPLORER_STATE.pdfObjectUrl);
    FILE_EXPLORER_STATE.pdfObjectUrl = '';
  }
}

function dataUrlToBlob(dataUrl) {
  const text = String(dataUrl || '');
  const match = text.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error('PDF 数据格式无效');
  const mime = match[1] || 'application/pdf';
  const isBase64 = !!match[2];
  const raw = isBase64 ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function openPdfViewer(path) {
  const normalizedPath = normalizeExplorerPath(path);
  if (!isFileExplorerPdfFile(normalizedPath)) {
    if (typeof toast === 'function') toast('仅支持 PDF 文件');
    return;
  }
  const modal = document.getElementById('pdfViewerModal');
  const pathEl = document.getElementById('pdfViewerPath');
  const frame = document.getElementById('pdfViewerFrame');
  if (!modal || !frame) return;

  FILE_EXPLORER_STATE.pdfPath = normalizedPath;
  if (pathEl) pathEl.textContent = normalizedPath;
  frame.removeAttribute('src');
  clearPdfViewerObjectUrl();
  modal.classList.add('show');
  setPdfViewerStatus('正在读取...', 'loading');

  try {
    const url = await fileExplorerPreviewUrl(normalizedPath);
    FILE_EXPLORER_STATE.pdfObjectUrl = url;
    frame.src = url;
    setPdfViewerStatus('直接预览 / 支持大文件', 'ok');
  } catch (e) {
    frame.removeAttribute('src');
    clearPdfViewerObjectUrl();
    setPdfViewerStatus(e.message || String(e), 'error');
  }
}

function closePdfViewer() {
  const modal = document.getElementById('pdfViewerModal');
  const frame = document.getElementById('pdfViewerFrame');
  if (frame) frame.removeAttribute('src');
  clearPdfViewerObjectUrl();
  if (modal) modal.classList.remove('show');
}

async function reloadPdfViewer() {
  if (!FILE_EXPLORER_STATE.pdfPath) return;
  await openPdfViewer(FILE_EXPLORER_STATE.pdfPath);
}

function openPdfViewerInNewTab() {
  if (!FILE_EXPLORER_STATE.pdfObjectUrl) return;
  window.open(FILE_EXPLORER_STATE.pdfObjectUrl, '_blank', 'noopener');
}

function setImageViewerStatus(message, kind = '') {
  const el = document.getElementById('imageViewerStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = kind ? `file-editor-status ${kind}` : 'file-editor-status';
}

function clearImageViewerObjectUrl() {
  if (FILE_EXPLORER_STATE.imageObjectUrl) {
    URL.revokeObjectURL(FILE_EXPLORER_STATE.imageObjectUrl);
    FILE_EXPLORER_STATE.imageObjectUrl = '';
  }
}

async function openImageViewer(path) {
  const normalizedPath = normalizeExplorerPath(path);
  if (!isFileExplorerImageFile(normalizedPath)) {
    if (typeof toast === 'function') toast('仅支持图片文件');
    return;
  }
  const modal = document.getElementById('imageViewerModal');
  const pathEl = document.getElementById('imageViewerPath');
  const img = document.getElementById('imageViewerImg');
  if (!modal || !img) return;

  FILE_EXPLORER_STATE.imagePath = normalizedPath;
  if (pathEl) pathEl.textContent = normalizedPath;
  img.removeAttribute('src');
  clearImageViewerObjectUrl();
  modal.classList.add('show');
  setImageViewerStatus('正在读取...', 'loading');

  try {
    const src = await fileExplorerPreviewUrl(normalizedPath);
    FILE_EXPLORER_STATE.imageObjectUrl = src;

    img.onload = () => {
      const sizeText = `${img.naturalWidth || '?'}×${img.naturalHeight || '?'}`;
      setImageViewerStatus(`${sizeText} / 直接预览`, 'ok');
    };
    img.onerror = () => {
      setImageViewerStatus('浏览器无法预览该图片格式', 'error');
    };
    img.src = src;
  } catch (e) {
    img.removeAttribute('src');
    clearImageViewerObjectUrl();
    setImageViewerStatus(e.message || String(e), 'error');
  }
}

function closeImageViewer() {
  const modal = document.getElementById('imageViewerModal');
  const img = document.getElementById('imageViewerImg');
  if (img) img.removeAttribute('src');
  clearImageViewerObjectUrl();
  if (modal) modal.classList.remove('show');
}

async function reloadImageViewer() {
  if (!FILE_EXPLORER_STATE.imagePath) return;
  await openImageViewer(FILE_EXPLORER_STATE.imagePath);
}

function openImageViewerInNewTab() {
  if (!FILE_EXPLORER_STATE.imageObjectUrl) return;
  window.open(FILE_EXPLORER_STATE.imageObjectUrl, '_blank', 'noopener');
}

function setMediaViewerStatus(message, kind = '') {
  const el = document.getElementById('mediaViewerStatus');
  if (!el) return;
  el.textContent = message || '';
  el.className = kind ? `file-editor-status ${kind}` : 'file-editor-status';
}

function clearMediaViewerObjectUrl() {
  if (FILE_EXPLORER_STATE.mediaObjectUrl) {
    URL.revokeObjectURL(FILE_EXPLORER_STATE.mediaObjectUrl);
    FILE_EXPLORER_STATE.mediaObjectUrl = '';
  }
}

function resetMediaPlayers() {
  const audio = document.getElementById('audioViewerPlayer');
  const video = document.getElementById('videoViewerPlayer');
  [audio, video].forEach(player => {
    if (!player) return;
    try { player.pause(); } catch (_) {}
    player.removeAttribute('src');
    player.hidden = true;
    try { player.load(); } catch (_) {}
  });
}

function activeMediaPlayer(kind) {
  return document.getElementById(kind === 'video' ? 'videoViewerPlayer' : 'audioViewerPlayer');
}

async function openMediaViewer(path) {
  const normalizedPath = normalizeExplorerPath(path);
  const kind = isFileExplorerVideoFile(normalizedPath) ? 'video' : (isFileExplorerAudioFile(normalizedPath) ? 'audio' : '');
  if (!kind) {
    if (typeof toast === 'function') toast('仅支持音频/视频文件');
    return;
  }

  const modal = document.getElementById('mediaViewerModal');
  const title = document.getElementById('mediaViewerTitle');
  const pathEl = document.getElementById('mediaViewerPath');
  if (!modal) return;

  FILE_EXPLORER_STATE.mediaPath = normalizedPath;
  FILE_EXPLORER_STATE.mediaKind = kind;
  if (title) title.textContent = kind === 'video' ? '视频预览器' : '音频预览器';
  if (pathEl) pathEl.textContent = normalizedPath;
  resetMediaPlayers();
  clearMediaViewerObjectUrl();
  modal.classList.add('show');
  setMediaViewerStatus('正在读取...', 'loading');

  try {
    const src = await fileExplorerPreviewUrl(normalizedPath);
    FILE_EXPLORER_STATE.mediaObjectUrl = src;

    const player = activeMediaPlayer(kind);
    if (!player) return;
    player.hidden = false;
    player.onloadedmetadata = () => {
      const duration = Number.isFinite(player.duration) ? ` / ${formatMediaDuration(player.duration)}` : '';
      const resolution = kind === 'video' && player.videoWidth ? ` / ${player.videoWidth}×${player.videoHeight}` : '';
      setMediaViewerStatus(`直接预览${duration}${resolution} / 支持大文件`, 'ok');
    };
    player.onerror = () => setMediaViewerStatus('浏览器无法预览该媒体格式', 'error');
    player.src = src;
    player.load();
  } catch (e) {
    resetMediaPlayers();
    clearMediaViewerObjectUrl();
    setMediaViewerStatus(e.message || String(e), 'error');
  }
}

function formatMediaDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function closeMediaViewer() {
  const modal = document.getElementById('mediaViewerModal');
  resetMediaPlayers();
  clearMediaViewerObjectUrl();
  if (modal) modal.classList.remove('show');
}

async function reloadMediaViewer() {
  if (!FILE_EXPLORER_STATE.mediaPath) return;
  await openMediaViewer(FILE_EXPLORER_STATE.mediaPath);
}

function openMediaViewerInNewTab() {
  if (!FILE_EXPLORER_STATE.mediaObjectUrl) return;
  window.open(FILE_EXPLORER_STATE.mediaObjectUrl, '_blank', 'noopener');
}

function fileExplorerGoUp() {
  const parent = parentExplorerPath(FILE_EXPLORER_STATE.path);
  if (parent !== FILE_EXPLORER_STATE.path) loadFileExplorer(parent);
}

function showFileExplorerContextMenu(event, item) {
  event.preventDefault();
  const isItem = !!item;
  const path = isItem ? (item.dataset.path || '.') : FILE_EXPLORER_STATE.path;
  const type = isItem ? (item.dataset.type || '') : 'dir';
  FILE_EXPLORER_STATE.contextPath = path;
  FILE_EXPLORER_STATE.contextType = type;
  FILE_EXPLORER_STATE.contextScope = isItem ? 'item' : 'blank';

  const menu = ensureFileExplorerContextMenu();
  menu.querySelectorAll('[data-menu-section]').forEach(section => {
    section.hidden = section.dataset.menuSection !== FILE_EXPLORER_STATE.contextScope;
  });
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const padding = 8;
  const left = Math.min(event.clientX, window.innerWidth - rect.width - padding);
  const top = Math.min(event.clientY, window.innerHeight - rect.height - padding);
  menu.style.left = `${Math.max(padding, left)}px`;
  menu.style.top = `${Math.max(padding, top)}px`;
}

function handleFileExplorerClick(event) {
  const item = event.target.closest('.file-explorer-item');
  if (!item) return;
  const path = item.dataset.path || '.';
  const type = item.dataset.type || '';
  openFileExplorerPath(path, type);
}

function handleFileExplorerContextMenu(event) {
  const item = event.target.closest('.file-explorer-item');
  const list = event.currentTarget;
  if (!item && list && !list.contains(event.target)) return;
  showFileExplorerContextMenu(event, item || null);
}

function uniqueExplorerChildPath(basePath, name) {
  const normalizedBase = normalizeExplorerPath(basePath || FILE_EXPLORER_STATE.path);
  const cleanName = String(name || '').replace(/[\\/]+/g, '').trim();
  if (!cleanName) return '';
  return joinExplorerPath(normalizedBase, cleanName);
}

async function createFileExplorerFile(basePath = FILE_EXPLORER_STATE.contextPath) {
  const name = prompt('输入新文件名称', '新建文件.txt');
  if (name === null) return;
  const path = uniqueExplorerChildPath(basePath, name);
  if (!path) {
    if (typeof toast === 'function') toast('文件名不能为空，且不能包含路径分隔符');
    return;
  }
  try {
    const r = await callAgentBackend('create_file', { path, content: '' }, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '新建文件失败');
    if (typeof toast === 'function') toast('已新建文件');
    await loadFileExplorer(basePath || FILE_EXPLORER_STATE.path);
    openFileEditor(path);
  } catch (e) {
    if (typeof toast === 'function') toast(e.message || String(e));
  }
}

async function createFileExplorerFolder(basePath = FILE_EXPLORER_STATE.contextPath) {
  const name = prompt('输入新文件夹名称', '新建文件夹');
  if (name === null) return;
  const path = uniqueExplorerChildPath(basePath, name);
  if (!path) {
    if (typeof toast === 'function') toast('文件夹名不能为空，且不能包含路径分隔符');
    return;
  }
  try {
    const r = await callAgentBackend('create_dir', { path }, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '新建文件夹失败');
    if (typeof toast === 'function') toast('已新建文件夹');
    refreshFileExplorer();
  } catch (e) {
    if (typeof toast === 'function') toast(e.message || String(e));
  }
}

async function switchFileExplorerWorkspace(path = FILE_EXPLORER_STATE.contextPath) {
  const normalizedPath = normalizeExplorerPath(path || FILE_EXPLORER_STATE.path);
  try {
    const r = await callAgentBackend('set_workspace', { path: normalizedPath }, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '切换工作区失败');
    FILE_EXPLORER_STATE.path = '.';
    FILE_EXPLORER_STATE.entries = [];
    if (typeof toast === 'function') toast('已切换工作区');
    await loadFileExplorer('.');
  } catch (e) {
    if (typeof toast === 'function') toast(e.message || String(e));
  }
}

async function copyFileExplorerPath(path = FILE_EXPLORER_STATE.contextPath) {
  const normalizedPath = normalizeExplorerPath(path);
  try {
    await navigator.clipboard.writeText(normalizedPath);
    if (typeof toast === 'function') toast('路径已复制');
  } catch (e) {
    if (typeof toast === 'function') toast('复制失败：' + (e.message || String(e)));
  }
}

async function renameFileExplorerPath(path = FILE_EXPLORER_STATE.contextPath) {
  const normalizedPath = normalizeExplorerPath(path);
  const currentName = fileExplorerBasename(normalizedPath);
  const nextName = prompt('输入新名称', currentName);
  if (nextName === null) return;
  const newPath = siblingExplorerPath(normalizedPath, nextName);
  if (!newPath) {
    if (typeof toast === 'function') toast('名称不能为空，且不能包含路径分隔符');
    return;
  }
  if (newPath === normalizedPath) return;
  try {
    const r = await callAgentBackend('rename_file', { path: normalizedPath, new_path: newPath }, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '重命名失败');
    if (FILE_EXPLORER_STATE.editorPath === normalizedPath) FILE_EXPLORER_STATE.editorPath = newPath;
    if (FILE_EXPLORER_STATE.pdfPath === normalizedPath) FILE_EXPLORER_STATE.pdfPath = newPath;
    if (FILE_EXPLORER_STATE.imagePath === normalizedPath) FILE_EXPLORER_STATE.imagePath = newPath;
    if (FILE_EXPLORER_STATE.mediaPath === normalizedPath) FILE_EXPLORER_STATE.mediaPath = newPath;
    if (typeof toast === 'function') toast('已重命名');
    refreshFileExplorer();
  } catch (e) {
    if (typeof toast === 'function') toast(e.message || String(e));
  }
}

async function deleteFileExplorerPath(path = FILE_EXPLORER_STATE.contextPath) {
  const normalizedPath = normalizeExplorerPath(path);
  try {
    const r = await callAgentBackend('delete_file', { path: normalizedPath }, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '删除失败');
    if (FILE_EXPLORER_STATE.editorPath === normalizedPath) closeFileEditor(true);
    if (FILE_EXPLORER_STATE.pdfPath === normalizedPath) closePdfViewer();
    if (FILE_EXPLORER_STATE.imagePath === normalizedPath) closeImageViewer();
    if (FILE_EXPLORER_STATE.mediaPath === normalizedPath) closeMediaViewer();
    if (typeof toast === 'function') toast('已删除');
    refreshFileExplorer();
  } catch (e) {
    if (typeof toast === 'function') toast(e.message || String(e));
  }
}

function handleFileExplorerContextMenuAction(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const path = FILE_EXPLORER_STATE.contextPath;
  const type = FILE_EXPLORER_STATE.contextType;
  hideFileExplorerContextMenu();
  if (!path) return;
  const action = btn.dataset.action;
  if (action === 'open') openFileExplorerPath(path, type);
  else if (action === 'rename') renameFileExplorerPath(path);
  else if (action === 'copy-path') copyFileExplorerPath(path);
  else if (action === 'delete') deleteFileExplorerPath(path);
  else if (action === 'new-file') createFileExplorerFile(path);
  else if (action === 'new-folder') createFileExplorerFolder(path);
  else if (action === 'switch-workspace') switchFileExplorerWorkspace(path);
}

document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('fileExplorerList');
  if (list) {
    list.addEventListener('click', handleFileExplorerClick);
    list.addEventListener('contextmenu', handleFileExplorerContextMenu);
  }
  const menu = ensureFileExplorerContextMenu();
  menu.addEventListener('click', handleFileExplorerContextMenuAction);
  document.addEventListener('click', event => {
    if (!event.target.closest('#fileExplorerContextMenu')) hideFileExplorerContextMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideFileExplorerContextMenu();
  });
  window.addEventListener('resize', enforceInlineFileResponsive);
  bindInlineFileResizer();
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
window.openPdfViewer = openPdfViewer;
window.closePdfViewer = closePdfViewer;
window.reloadPdfViewer = reloadPdfViewer;
window.openPdfViewerInNewTab = openPdfViewerInNewTab;
window.openImageViewer = openImageViewer;
window.closeImageViewer = closeImageViewer;
window.reloadImageViewer = reloadImageViewer;
window.openImageViewerInNewTab = openImageViewerInNewTab;
window.openMediaViewer = openMediaViewer;
window.closeMediaViewer = closeMediaViewer;
window.reloadMediaViewer = reloadMediaViewer;
window.openMediaViewerInNewTab = openMediaViewerInNewTab;
window.copyFileExplorerPath = copyFileExplorerPath;
window.renameFileExplorerPath = renameFileExplorerPath;
window.deleteFileExplorerPath = deleteFileExplorerPath;
window.openFileExplorerPath = openFileExplorerPath;
window.createFileExplorerFile = createFileExplorerFile;
window.createFileExplorerFolder = createFileExplorerFolder;
window.switchFileExplorerWorkspace = switchFileExplorerWorkspace;
window.openCurrentFileInMainPanel = openCurrentFileInMainPanel;
window.openTextInMainPanel = openTextInMainPanel;
window.openPdfInMainPanel = openPdfInMainPanel;
window.closeInlineFilePanel = closeInlineFilePanel;
window.reloadInlineFilePanel = reloadInlineFilePanel;
window.copyInlineFileContent = copyInlineFileContent;
window.openInlineFileInNewTab = openInlineFileInNewTab;
window.toggleInlineFileSide = toggleInlineFileSide;
