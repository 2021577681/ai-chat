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
  mediaKind: ''
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
  else if (isFileExplorerPdfFile(path)) openPdfViewer(path);
  else if (isFileExplorerImageFile(path)) openImageViewer(path);
  else if (isFileExplorerMediaFile(path)) openMediaViewer(path);
  else if (typeof toast === 'function') toast('暂只支持文本类文件、PDF、图片、音频和视频');
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
