// ============ Sidebar File Explorer ============

const FileExplorerUiService = window.AgentApp.require('uiService');

function fileExplorerToast(message, ms) {
  FileExplorerUiService.toast(message, ms);
}

const FILE_EXPLORER_STATE = {
  visible: false,
  path: '.',
  loading: false,
  autoRefreshTimer: null,
  autoRefreshInFlight: false,
  autoRefreshSignature: '',
  autoRefreshPath: '.',
  uploading: false,
  clipboard: null,
  entries: [],
  editorPath: '',
  editorOriginal: '',
  editorMarkdownPreview: false,
  editorCodePreview: false,
  editorLoading: false,
  editorPythonMode: false,
  editorCodeMirror: null,
  inlineCodeMirror: null,
  editorFoldedLines: new Set(),
  editorBracketMatch: null,
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
const FILE_EXPLORER_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

const FILE_EXPLORER_TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'xml', 'svg',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php',
  'rb', 'swift', 'kt', 'kts', 'sql', 'sh', 'bash', 'zsh', 'ps1',
  'bat', 'cmd', 'tex', 'gitignore', 'dockerfile', 'env', 'log', 'csv',
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

function setFileExplorerPathDisplay(path) {
  const pathEl = document.getElementById('fileExplorerPath');
  if (!pathEl) return;
  const normalized = normalizeExplorerPath(path);
  pathEl.textContent = normalized;
  pathEl.title = normalized;
  pathEl.setAttribute('aria-label', normalized);
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

function isFileExplorerMarkdownFile(path) {
  return /^(md|markdown)$/i.test(fileExplorerExtension(path));
}

function isFileExplorerPythonFile(path) {
  return /^py$/i.test(fileExplorerExtension(path));
}

function isFileExplorerTexFile(path) {
  return /^tex$/i.test(fileExplorerExtension(path));
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

function fileEditorCodeShell() {
  return document.getElementById('fileEditorCodeShell');
}

function fileEditorCodeGutter() {
  return document.getElementById('fileEditorCodeGutter');
}

function fileEditorCodeHighlight() {
  return document.querySelector('#fileEditorCodeHighlight code');
}

function hasFileEditorCodeMirror() {
  return typeof window !== 'undefined' && typeof window.CodeMirror === 'function';
}

function defineFileExplorerSimpleMode(name, options = {}) {
  if (!hasFileEditorCodeMirror()) return false;
  const CodeMirror = window.CodeMirror;
  if (CodeMirror.modes && CodeMirror.modes[name]) return true;
  const keywords = new Set(options.keywords || []);
  const atoms = new Set(options.atoms || ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
  const builtin = new Set(options.builtin || []);
  const lineComment = Object.prototype.hasOwnProperty.call(options, 'lineComment') ? options.lineComment : '//';
  const blockCommentStart = Object.prototype.hasOwnProperty.call(options, 'blockCommentStart') ? options.blockCommentStart : '/*';
  const blockCommentEnd = Object.prototype.hasOwnProperty.call(options, 'blockCommentEnd') ? options.blockCommentEnd : '*/';
  const numberPattern = options.numberPattern || /^(?:0x[\da-f]+|0b[01]+|\d+(?:\.\d+)?(?:e[+\-]?\d+)?)/i;
  const variablePattern = options.variablePattern || /^[A-Za-z_$][\w$-]*/;

  CodeMirror.defineMode(name, function() {
    return {
      startState() {
        return { inBlockComment: false };
      },
      token(stream, state) {
        if (state.inBlockComment) {
          if (stream.skipTo(blockCommentEnd)) {
            stream.match(blockCommentEnd);
            state.inBlockComment = false;
          } else {
            stream.skipToEnd();
          }
          return 'comment';
        }
        if (stream.eatSpace()) return null;
        if (lineComment && stream.match(lineComment)) {
          stream.skipToEnd();
          return 'comment';
        }
        if (blockCommentStart && stream.match(blockCommentStart)) {
          state.inBlockComment = true;
          return 'comment';
        }
        if (stream.match(/"(?:[^"\\]|\\.)*"?|`(?:[^`\\]|\\.)*`?|'(?:[^'\\]|\\.)*'?/)) return 'string';
        if (stream.match(numberPattern)) return 'number';
        if (stream.match(/[{}\[\]();,.]/)) return 'bracket';
        if (stream.match(/[+\-*\/%=&|!<>?:~^]+/)) return 'operator';
        const word = stream.match(variablePattern);
        if (word) {
          const value = word[0];
          if (keywords.has(value)) return 'keyword';
          if (atoms.has(value)) return 'atom';
          if (builtin.has(value)) return 'builtin';
          return 'variable';
        }
        stream.next();
        return null;
      },
      lineComment
    };
  });
  return true;
}

function registerFileExplorerCommonCodeMirrorModes() {
  if (!hasFileEditorCodeMirror()) return false;
  defineFileExplorerSimpleMode('file-explorer-javascript', {
    keywords: ['as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'from', 'function', 'get', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return', 'set', 'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'interface', 'type', 'enum', 'implements', 'namespace', 'private', 'protected', 'public', 'readonly'],
    builtin: ['Array', 'Boolean', 'Date', 'Error', 'JSON', 'Map', 'Math', 'Number', 'Object', 'Promise', 'RegExp', 'Set', 'String', 'Symbol', 'console', 'document', 'window']
  });
  defineFileExplorerSimpleMode('file-explorer-clike', {
    keywords: ['alignas', 'alignof', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'constexpr', 'continue', 'default', 'delete', 'do', 'double', 'else', 'enum', 'extern', 'false', 'final', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'namespace', 'new', 'noexcept', 'nullptr', 'operator', 'private', 'protected', 'public', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'template', 'this', 'throw', 'true', 'try', 'typedef', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'while', 'include', 'define', 'ifdef', 'ifndef', 'endif', 'pragma'],
    atoms: ['true', 'false', 'NULL', 'nullptr']
  });
  defineFileExplorerSimpleMode('file-explorer-css', {
    keywords: ['align-items', 'animation', 'background', 'border', 'box-shadow', 'color', 'display', 'flex', 'font', 'gap', 'grid', 'height', 'justify-content', 'margin', 'padding', 'position', 'transform', 'transition', 'width', 'z-index'],
    atoms: ['auto', 'block', 'bold', 'center', 'flex', 'grid', 'hidden', 'inline', 'none', 'relative', 'absolute', 'fixed', 'solid', 'transparent'],
    lineComment: '',
    variablePattern: /^-?[_a-zA-Z][\w-]*/
  });
  defineFileExplorerSimpleMode('file-explorer-shell', {
    keywords: ['case', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in', 'then', 'until', 'while', 'echo', 'exit', 'export', 'local', 'read', 'set'],
    atoms: ['true', 'false'],
    lineComment: '#',
    blockCommentStart: '',
    blockCommentEnd: ''
  });
  defineFileExplorerSimpleMode('file-explorer-sql', {
    keywords: ['ADD', 'ALTER', 'AND', 'AS', 'ASC', 'BETWEEN', 'BY', 'CREATE', 'DELETE', 'DESC', 'DISTINCT', 'DROP', 'FROM', 'GROUP', 'HAVING', 'IN', 'INSERT', 'INTO', 'JOIN', 'LEFT', 'LIKE', 'LIMIT', 'NOT', 'NULL', 'ON', 'OR', 'ORDER', 'OUTER', 'PRIMARY', 'RIGHT', 'SELECT', 'SET', 'TABLE', 'UPDATE', 'VALUES', 'WHERE'],
    atoms: ['NULL', 'TRUE', 'FALSE'],
    lineComment: '--'
  });
  return true;
}

function registerFileExplorerConfigCodeMirrorMode() {
  if (!hasFileEditorCodeMirror()) return false;
  const CodeMirror = window.CodeMirror;
  if (CodeMirror.modes && CodeMirror.modes['file-explorer-config']) return true;
  CodeMirror.defineMode('file-explorer-config', function() {
    return {
      token(stream) {
        if (stream.eatSpace()) return null;
        if (stream.match(/<!--/)) {
          if (!stream.skipTo('-->')) stream.skipToEnd();
          else stream.match('-->');
          return 'comment';
        }
        if (stream.match(/[#;].*$/)) return 'comment';
        if (stream.match(/"(?:[^"\\]|\\.)*"?|`(?:[^`\\]|\\.)*`?|'(?:[^'\\]|\\.)*'?/)) return 'string';
        if (stream.match(/<\/?[A-Za-z][\w:-]*/)) return 'tag';
        if (stream.match(/[{}\[\]<>]/)) return 'bracket';
        if (stream.match(/[-+]?\d+(?:\.\d+)?/)) return 'number';
        if (stream.match(/\b(?:true|false|null|yes|no|on|off)\b/i)) return 'atom';
        if (stream.match(/[A-Za-z_][\w.-]*(?=\s*[:=])/)) return 'property';
        if (stream.match(/[=:,]/)) return 'operator';
        stream.next();
        return null;
      }
    };
  });
  return true;
}

function registerFileExplorerTexCodeMirrorMode() {
  if (!hasFileEditorCodeMirror()) return false;
  const CodeMirror = window.CodeMirror;
  if (CodeMirror.modes && CodeMirror.modes.stex) return true;
  CodeMirror.defineMode('stex', function() {
    return {
      startState() {
        return { inMath: false };
      },
      token(stream, state) {
        if (stream.eatSpace()) return null;
        if (stream.match('%')) {
          stream.skipToEnd();
          return 'comment';
        }
        if (stream.match(/\\(?:begin|end)(?=\s*\{)/)) return 'keyword';
        if (stream.match(/\\[a-zA-Z@]+\*?|\\./)) return 'tag';
        if (stream.match(/\$\$?|\\\(|\\\)|\\\[|\\\]/)) {
          state.inMath = !state.inMath;
          return 'operator';
        }
        if (stream.match(/[{}\[\](),;]/)) return 'bracket';
        if (stream.match(/#[0-9]+/)) return 'atom';
        if (state.inMath && stream.match(/[=+\-*\/^_<>'|:]+/)) return 'operator';
        if (state.inMath && stream.match(/\d+(?:\.\d+)?/)) return 'number';
        stream.next();
        return state.inMath ? 'variable-2' : null;
      },
      lineComment: '%'
    };
  });
  CodeMirror.defineMIME && CodeMirror.defineMIME('text/x-stex', 'stex');
  return true;
}

function fileExplorerCodeMirrorMode(path) {
  const ext = fileExplorerExtension(path);
  if (isFileExplorerPythonFile(path)) return 'python';
  if (isFileExplorerTexFile(path) && registerFileExplorerTexCodeMirrorMode()) return 'stex';
  if (/^(json|jsonl|yaml|yml|toml|ini|cfg|conf|properties|xml|svg|html|htm)$/i.test(ext)) {
    return registerFileExplorerConfigCodeMirrorMode() ? 'file-explorer-config' : null;
  }
  if (!registerFileExplorerCommonCodeMirrorModes()) return null;
  if (/^(js|mjs|cjs|jsx|ts|tsx)$/i.test(ext)) return 'file-explorer-javascript';
  if (/^(c|h|cpp|cc|cxx|hpp|hh|hxx|java|cs|go|rs|kt|kts|swift|php)$/i.test(ext)) return 'file-explorer-clike';
  if (/^(css|scss|sass|less)$/i.test(ext)) return 'file-explorer-css';
  if (/^(sh|bash|zsh|ps1|bat|cmd)$/i.test(ext)) return 'file-explorer-shell';
  if (/^sql$/i.test(ext)) return 'file-explorer-sql';
  return null;
}

function fileEditorCurrentValue() {
  const cm = FILE_EXPLORER_STATE.editorCodeMirror;
  if (cm) return cm.getValue();
  const textarea = fileEditorTextarea();
  return textarea ? textarea.value : '';
}

function syncFileEditorTextareaFromCodeMirror() {
  const cm = FILE_EXPLORER_STATE.editorCodeMirror;
  const textarea = fileEditorTextarea();
  if (cm && textarea) textarea.value = cm.getValue();
}

function refreshFileEditorCodeMirror() {
  const cm = FILE_EXPLORER_STATE.editorCodeMirror;
  if (!cm) return false;
  syncFileEditorTextareaFromCodeMirror();
  setTimeout(() => cm.refresh(), 0);
  return true;
}

function ensureFileEditorCodeMirror(path = FILE_EXPLORER_STATE.editorPath) {
  if (!hasFileEditorCodeMirror()) return null;
  const textarea = fileEditorTextarea();
  const shell = fileEditorCodeShell();
  if (!textarea || !shell) return null;
  const mode = fileExplorerCodeMirrorMode(path);
  const isPython = isFileExplorerPythonFile(path);
  if (FILE_EXPLORER_STATE.editorCodeMirror) {
    FILE_EXPLORER_STATE.editorCodeMirror.setOption('mode', mode);
    return FILE_EXPLORER_STATE.editorCodeMirror;
  }
  const cm = window.CodeMirror.fromTextArea(textarea, {
    mode,
    theme: 'material-darker',
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: false,
    autoCloseBrackets: !!mode,
    foldGutter: isPython,
    gutters: isPython ? ['CodeMirror-foldgutter', 'CodeMirror-linenumbers'] : ['CodeMirror-linenumbers'],
    foldOptions: isPython ? {
      rangeFinder: window.CodeMirror.fold && window.CodeMirror.fold.indent
    } : undefined,
    extraKeys: isPython ? {
      Tab(editor) {
        if (editor.somethingSelected()) editor.indentSelection('add');
        else editor.replaceSelection('    ', 'end');
      },
      'Ctrl-Q'(editor) { editor.foldCode(editor.getCursor()); }
    } : undefined
  });
  cm.on('change', () => {
    syncFileEditorTextareaFromCodeMirror();
    if (FILE_EXPLORER_STATE.editorMarkdownPreview) updateFileEditorMarkdownPreview();
    if (FILE_EXPLORER_STATE.editorCodePreview) updateFileEditorCodePreview();
  });
  FILE_EXPLORER_STATE.editorCodeMirror = cm;
  shell.classList.add('cm-active');
  return cm;
}

function destroyFileEditorCodeMirror() {
  const cm = FILE_EXPLORER_STATE.editorCodeMirror;
  if (!cm) return;
  syncFileEditorTextareaFromCodeMirror();
  cm.toTextArea();
  FILE_EXPLORER_STATE.editorCodeMirror = null;
  const shell = fileEditorCodeShell();
  if (shell) shell.classList.remove('cm-active');
}

function currentEditorLineIndex(textarea) {
  return String(textarea.value || '').slice(0, textarea.selectionStart || 0).split('\n').length - 1;
}

function editorLineStartOffsets(text) {
  const source = String(text || '');
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

function editorLineAtOffset(offsets, offset) {
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid] <= offset && (mid === offsets.length - 1 || offsets[mid + 1] > offset)) return mid;
    if (offsets[mid] > offset) high = mid - 1;
    else low = mid + 1;
  }
  return 0;
}

function findPythonFoldRanges(lines) {
  const ranges = new Map();
  const indentOf = line => {
    const m = String(line || '').match(/^[ \t]*/);
    return m ? m[0].replace(/\t/g, '    ').length : 0;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !/:\s*(?:#.*)?$/.test(line)) continue;
    const baseIndent = indentOf(line);
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const t = (lines[j] || '').trim();
      if (!t) { end = j; continue; }
      const ind = indentOf(lines[j]);
      if (ind <= baseIndent) break;
      end = j;
    }
    if (end > i) ranges.set(i, end);
  }
  return ranges;
}

function foldedLineSetFromRanges(ranges) {
  const hidden = new Set();
  FILE_EXPLORER_STATE.editorFoldedLines.forEach(start => {
    const end = ranges.get(start);
    if (!Number.isInteger(end)) return;
    for (let i = start + 1; i <= end; i++) hidden.add(i);
  });
  return hidden;
}

function findBracketMatch(source, caret) {
  const pairs = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' };
  const opens = new Set(['(', '[', '{']);
  const closes = new Set([')', ']', '}']);
  let pos = -1;
  if (caret > 0 && pairs[source[caret - 1]]) pos = caret - 1;
  else if (pairs[source[caret]]) pos = caret;
  if (pos < 0) return null;
  const ch = source[pos];
  const target = pairs[ch];
  const forward = opens.has(ch);
  let depth = 0;
  if (forward) {
    for (let i = pos; i < source.length; i++) {
      if (source[i] === ch) depth++;
      else if (source[i] === target) {
        depth--;
        if (depth === 0) return { a: pos, b: i };
      }
    }
  } else if (closes.has(ch)) {
    for (let i = pos; i >= 0; i--) {
      if (source[i] === ch) depth++;
      else if (source[i] === target) {
        depth--;
        if (depth === 0) return { a: i, b: pos };
      }
    }
  }
  return null;
}

function highlightPythonLineWithBrackets(line, absoluteStart, match) {
  const source = String(line || '');
  const marked = new Set();
  if (match) {
    if (match.a >= absoluteStart && match.a < absoluteStart + source.length) marked.add(match.a - absoluteStart);
    if (match.b >= absoluteStart && match.b < absoluteStart + source.length) marked.add(match.b - absoluteStart);
  }
  let html = highlightPythonCode(source);
  if (!marked.size) return html || ' ';
  let out = '';
  let plainIndex = 0;
  let inTag = false;
  for (let i = 0; i < html.length; i++) {
    const c = html[i];
    if (c === '<') inTag = true;
    if (!inTag && marked.has(plainIndex)) out += '<span class="code-bracket-match">';
    out += c;
    if (c === '>') { inTag = false; continue; }
    if (!inTag) {
      if (marked.has(plainIndex)) out += '</span>';
      plainIndex++;
    }
  }
  return out || ' ';
}

function renderPythonEditor() {
  const textarea = fileEditorTextarea();
  const gutter = fileEditorCodeGutter();
  const highlight = fileEditorCodeHighlight();
  if (!textarea || !gutter || !highlight || !FILE_EXPLORER_STATE.editorPythonMode) return;
  const value = textarea.value || '';
  const lines = value.split('\n');
  const offsets = editorLineStartOffsets(value);
  const currentLine = currentEditorLineIndex(textarea);
  const foldRanges = findPythonFoldRanges(lines);
  const hiddenLines = foldedLineSetFromRanges(foldRanges);
  FILE_EXPLORER_STATE.editorBracketMatch = findBracketMatch(value, textarea.selectionStart || 0);
  gutter.innerHTML = lines.map((_, i) => {
    if (hiddenLines.has(i)) return '';
    const folded = FILE_EXPLORER_STATE.editorFoldedLines.has(i) && foldRanges.has(i);
    const fold = foldRanges.has(i) ? `<span class="code-fold-toggle" data-line="${i}" title="${folded ? '展开代码' : '折叠代码'}">${folded ? '›' : '⌄'}</span>` : '<span class="code-fold-toggle"></span>';
    return `<div class="code-gutter-line${i === currentLine ? ' current' : ''}">${fold}${i + 1}</div>`;
  }).join('');
  highlight.innerHTML = lines.map((line, i) => {
    if (hiddenLines.has(i)) return '';
    const cls = ['code-line'];
    if (i === currentLine) cls.push('current-line');
    const match = FILE_EXPLORER_STATE.editorBracketMatch;
    if (match && (editorLineAtOffset(offsets, match.a) === i || editorLineAtOffset(offsets, match.b) === i)) cls.push('bracket-line');
    const code = highlightPythonLineWithBrackets(line, offsets[i] || 0, match);
    const folded = FILE_EXPLORER_STATE.editorFoldedLines.has(i) && foldRanges.has(i);
    return `<span class="${cls.join(' ')}">${code}${folded ? ' <span class="code-fold-placeholder">⋯</span>' : ''}</span>`;
  }).join('') || '<span class="code-line"> </span>';
}

function syncPythonEditorScroll() {
  const textarea = fileEditorTextarea();
  const gutter = fileEditorCodeGutter();
  const pre = document.getElementById('fileEditorCodeHighlight');
  if (!textarea) return;
  if (gutter) gutter.style.transform = `translateY(${-textarea.scrollTop}px)`;
  if (pre) {
    pre.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
  }
}

function setPythonEditorMode(enabled) {
  const shell = fileEditorCodeShell();
  FILE_EXPLORER_STATE.editorPythonMode = !!enabled;
  if (shell) shell.classList.toggle('python-editor', !!enabled);
  if (enabled && hasFileEditorCodeMirror()) {
    const cm = ensureFileEditorCodeMirror(FILE_EXPLORER_STATE.editorPath);
    if (cm) {
      cm.setOption('readOnly', !!(fileEditorTextarea() && fileEditorTextarea().disabled));
      refreshFileEditorCodeMirror();
      cm.focus();
      return;
    }
  }
  if (!enabled) destroyFileEditorCodeMirror();
  if (enabled) {
    renderPythonEditor();
    syncPythonEditorScroll();
  }
}

function setFileEditorSyntaxMode(path) {
  const normalizedPath = normalizeExplorerPath(path || FILE_EXPLORER_STATE.editorPath);
  if (isFileExplorerPythonFile(normalizedPath)) {
    setPythonEditorMode(true);
    return;
  }
  setPythonEditorMode(false);
  const mode = fileExplorerCodeMirrorMode(normalizedPath);
  if (!mode || !hasFileEditorCodeMirror()) return;
  const cm = ensureFileEditorCodeMirror(normalizedPath);
  if (!cm) return;
  cm.setOption('mode', mode);
  cm.setOption('readOnly', !!(fileEditorTextarea() && fileEditorTextarea().disabled));
  refreshFileEditorCodeMirror();
}

function replaceEditorSelection(textarea, text, selectStart = null, selectEnd = null) {
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  const nextStart = selectStart === null ? start + text.length : start + selectStart;
  const nextEnd = selectEnd === null ? nextStart : start + selectEnd;
  textarea.setSelectionRange(nextStart, nextEnd);
  renderPythonEditor();
}

function handlePythonEditorKeydown(event) {
  const textarea = event.currentTarget;
  if (!FILE_EXPLORER_STATE.editorPythonMode || !isFileExplorerPythonFile(FILE_EXPLORER_STATE.editorPath)) return;
  if (event.key === 'Tab') {
    event.preventDefault();
    replaceEditorSelection(textarea, '    ');
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const value = textarea.value || '';
    const before = value.slice(0, textarea.selectionStart || 0);
    const line = before.slice(before.lastIndexOf('\n') + 1);
    const indent = (line.match(/^[ \t]*/) || [''])[0];
    const extra = /:\s*(?:#.*)?$/.test(line) ? '    ' : '';
    replaceEditorSelection(textarea, `\n${indent}${extra}`);
    return;
  }
  const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
  if (pairs[event.key] && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    replaceEditorSelection(textarea, event.key + pairs[event.key], 1, 1);
  }
}

function bindPythonFileEditor() {
  const textarea = fileEditorTextarea();
  const gutter = fileEditorCodeGutter();
  if (textarea && textarea.dataset.pythonEditorBound !== '1') {
    textarea.dataset.pythonEditorBound = '1';
    textarea.addEventListener('input', () => {
      if (FILE_EXPLORER_STATE.editorPythonMode) renderPythonEditor();
    });
    textarea.addEventListener('scroll', () => {
      if (FILE_EXPLORER_STATE.editorPythonMode) syncPythonEditorScroll();
    });
    textarea.addEventListener('keydown', handlePythonEditorKeydown);
    textarea.addEventListener('keyup', () => {
      if (FILE_EXPLORER_STATE.editorPythonMode) renderPythonEditor();
    });
    textarea.addEventListener('click', () => {
      if (FILE_EXPLORER_STATE.editorPythonMode) renderPythonEditor();
    });
    textarea.addEventListener('select', () => {
      if (FILE_EXPLORER_STATE.editorPythonMode) renderPythonEditor();
    });
  }
  if (gutter && gutter.dataset.pythonEditorBound !== '1') {
    gutter.dataset.pythonEditorBound = '1';
    gutter.addEventListener('click', event => {
      const toggle = event.target.closest('.code-fold-toggle[data-line]');
      if (!toggle) return;
      event.preventDefault();
      const line = Number(toggle.dataset.line);
      if (FILE_EXPLORER_STATE.editorFoldedLines.has(line)) FILE_EXPLORER_STATE.editorFoldedLines.delete(line);
      else FILE_EXPLORER_STATE.editorFoldedLines.add(line);
      renderPythonEditor();
      syncPythonEditorScroll();
    });
  }
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

function fileExplorerEntriesSignature(entries) {
  return (Array.isArray(entries) ? entries : []).map(entry => [
    entry && entry.name ? String(entry.name) : '',
    entry && entry.type ? String(entry.type) : '',
    Number(entry && entry.size || 0),
    Number(entry && entry.mtime || 0)
  ].join('\u0001')).sort().join('\u0002');
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
      <button type="button" data-action="compile-tex" data-tex-only="true" hidden>编译</button>
      <button type="button" data-action="copy-item">复制</button>
      <button type="button" data-action="cut-item">剪切</button>
      <button type="button" data-action="paste" data-paste-only="true" data-dir-only="true" hidden>粘贴到此文件夹</button>
      <button type="button" data-action="download">下载</button>
      <button type="button" data-action="rename">重命名</button>
      <button type="button" data-action="copy-path">复制路径</button>
      <button type="button" data-action="delete">删除</button>
    </div>
    <div data-menu-section="blank">
      <button type="button" data-action="upload-files">上传文件</button>
      <button type="button" data-action="upload-folder">上传文件夹</button>
      <button type="button" data-action="paste" data-paste-only="true" hidden>粘贴</button>
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
  const upBtn = document.getElementById('fileExplorerUpBtn');
  setFileExplorerPathDisplay(FILE_EXPLORER_STATE.path);
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

async function loadFileExplorer(path = FILE_EXPLORER_STATE.path, options = {}) {
  if (FILE_EXPLORER_STATE.loading) return;
  FILE_EXPLORER_STATE.loading = true;
  FILE_EXPLORER_STATE.path = normalizeExplorerPath(path);
  if (!options.silent) renderFileExplorerLoading();
  setFileExplorerPathDisplay(FILE_EXPLORER_STATE.path);
  try {
    if (typeof callAgentBackend !== 'function') throw new Error('本地工具接口未加载');
    const r = await callAgentBackend('list_dir', { path: FILE_EXPLORER_STATE.path });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '读取目录失败');
    FILE_EXPLORER_STATE.entries = Array.isArray(r.entries) ? r.entries : [];
    FILE_EXPLORER_STATE.autoRefreshSignature = fileExplorerEntriesSignature(FILE_EXPLORER_STATE.entries);
    FILE_EXPLORER_STATE.autoRefreshPath = FILE_EXPLORER_STATE.path;
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

function startFileExplorerAutoRefresh() {
  stopFileExplorerAutoRefresh();
  FILE_EXPLORER_STATE.autoRefreshTimer = setInterval(pollFileExplorerChanges, 2500);
}

function stopFileExplorerAutoRefresh() {
  if (FILE_EXPLORER_STATE.autoRefreshTimer) {
    clearInterval(FILE_EXPLORER_STATE.autoRefreshTimer);
    FILE_EXPLORER_STATE.autoRefreshTimer = null;
  }
  FILE_EXPLORER_STATE.autoRefreshInFlight = false;
}

async function pollFileExplorerChanges() {
  if (!FILE_EXPLORER_STATE.visible || FILE_EXPLORER_STATE.loading || FILE_EXPLORER_STATE.autoRefreshInFlight) return;
  FILE_EXPLORER_STATE.autoRefreshInFlight = true;
  const path = normalizeExplorerPath(FILE_EXPLORER_STATE.path);
  try {
    if (typeof callAgentBackend !== 'function') return;
    const r = await callAgentBackend('list_dir', { path });
    if (typeof r === 'string' || !r || !r.ok) return;
    if (path !== normalizeExplorerPath(FILE_EXPLORER_STATE.path) || !FILE_EXPLORER_STATE.visible) return;
    const entries = Array.isArray(r.entries) ? r.entries : [];
    const signature = fileExplorerEntriesSignature(entries);
    if (FILE_EXPLORER_STATE.autoRefreshPath !== path || FILE_EXPLORER_STATE.autoRefreshSignature !== signature) {
      FILE_EXPLORER_STATE.entries = entries;
      FILE_EXPLORER_STATE.autoRefreshPath = path;
      FILE_EXPLORER_STATE.autoRefreshSignature = signature;
      renderFileExplorer();
    }
  } catch (e) {
    // 自动刷新失败时保持当前列表，避免后台轮询打断用户操作。
  } finally {
    FILE_EXPLORER_STATE.autoRefreshInFlight = false;
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
  if (FILE_EXPLORER_STATE.visible) {
    loadFileExplorer(FILE_EXPLORER_STATE.path);
    startFileExplorerAutoRefresh();
  } else {
    stopFileExplorerAutoRefresh();
  }
}

function toggleSidebarExplorer() {
  setSidebarExplorerMode(!FILE_EXPLORER_STATE.visible);
}

function refreshFileExplorer() {
  loadFileExplorer(FILE_EXPLORER_STATE.path, { silent: true });
}

function resetFileExplorerToRoot() {
  FILE_EXPLORER_STATE.path = '.';
  FILE_EXPLORER_STATE.entries = [];
  if (FILE_EXPLORER_STATE.visible) loadFileExplorer('.');
  else renderFileExplorer();
}

function sanitizeUploadRelativePath(path, fallbackName = 'upload.bin') {
  const source = String(path || fallbackName || 'upload.bin').replace(/\\/g, '/');
  const parts = source
    .split('/')
    .map(part => part.replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .filter(part => part && part !== '.' && part !== '..');
  if (parts.length) return parts.join('/');
  const fallback = String(fallbackName || 'upload.bin').replace(/[\\/]+/g, '').trim();
  return fallback || 'upload.bin';
}

function fileExplorerArrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer || 0);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fileExplorerReadFileAsArrayBuffer(file) {
  if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(event && event.target ? event.target.result : new ArrayBuffer(0));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsArrayBuffer(file);
  });
}

async function readUploadFileAsBase64(file) {
  return fileExplorerArrayBufferToBase64(await fileExplorerReadFileAsArrayBuffer(file));
}

function fileExplorerItemsFromFileList(files) {
  return Array.from(files || []).filter(Boolean).map(file => ({
    file,
    relativePath: file.webkitRelativePath || file.name
  }));
}

async function uploadSelectedFilesToExplorer(files, targetPath = FILE_EXPLORER_STATE.path) {
  const items = Array.isArray(files) ? files.filter(item => item && item.file) : fileExplorerItemsFromFileList(files);
  if (!items.length) {
    fileExplorerToast('没有可上传的文件');
    return;
  }
  if (FILE_EXPLORER_STATE.uploading) {
    fileExplorerToast('已有文件正在上传');
    return;
  }
  const oversized = items.filter(item => Number(item.file.size || 0) > FILE_EXPLORER_UPLOAD_MAX_BYTES);
  if (oversized.length) {
    const names = oversized.slice(0, 3).map(item => item.file.name || '未命名').join('、');
    fileExplorerToast(`${names}${oversized.length > 3 ? ' 等文件' : ''} 超过 20MB，未上传`);
    return;
  }

  FILE_EXPLORER_STATE.uploading = true;
  const normalizedTarget = normalizeExplorerPath(targetPath || FILE_EXPLORER_STATE.path);
  let uploaded = 0;
  const failed = [];
  try {
    if (typeof callAgentBackend !== 'function') throw new Error('本地工具接口未加载');
    fileExplorerToast(`正在上传 ${items.length} 个文件到 ${normalizedTarget}`);
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const file = item.file;
      const relativePath = sanitizeUploadRelativePath(item.relativePath, file.name);
      const targetFilePath = joinExplorerPath(normalizedTarget, relativePath);
      try {
        const content = await readUploadFileAsBase64(file);
        const r = await callAgentBackend(
          'write_file',
          {
            path: targetFilePath,
            content,
            encoding: 'base64',
            mime: file.type || 'application/octet-stream'
          },
          undefined,
          undefined,
          { skipConfirm: true }
        );
        if (typeof r === 'string') throw new Error(r);
        if (!r || !r.ok) throw new Error((r && r.error) || '上传失败');
        uploaded += 1;
      } catch (e) {
        failed.push({ path: targetFilePath, error: e.message || String(e) });
      }
    }
    if (failed.length) {
      console.warn('[file-explorer] upload failed:', failed);
      fileExplorerToast(`已上传 ${uploaded} 个，失败 ${failed.length} 个`);
    } else {
      fileExplorerToast(`已上传 ${uploaded} 个文件`);
    }
    if (FILE_EXPLORER_STATE.visible) await loadFileExplorer(FILE_EXPLORER_STATE.path, { silent: true });
  } catch (e) {
    fileExplorerToast(e.message || String(e));
  } finally {
    FILE_EXPLORER_STATE.uploading = false;
  }
}

function ensureFileExplorerUploadInput(kind) {
  const id = kind === 'folder' ? 'fileExplorerFolderUploadInput' : 'fileExplorerFileUploadInput';
  let input = document.getElementById(id);
  if (input) return input;
  input = document.createElement('input');
  input.id = id;
  input.type = 'file';
  input.hidden = true;
  input.multiple = true;
  if (kind === 'folder') {
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }
  document.body.appendChild(input);
  return input;
}

function openFileExplorerUploadPicker(kind = 'files', targetPath = FILE_EXPLORER_STATE.path) {
  const normalizedKind = kind === 'folder' ? 'folder' : 'files';
  const input = ensureFileExplorerUploadInput(normalizedKind);
  input.onchange = event => handleFileExplorerUploadInputChange(event, normalizedKind, targetPath);
  input.value = '';
  input.click();
}

async function handleFileExplorerUploadInputChange(event, kind, targetPath) {
  const input = event && event.target;
  const files = input && input.files ? input.files : [];
  try {
    const items = fileExplorerItemsFromFileList(files);
    await uploadSelectedFilesToExplorer(items, targetPath);
  } finally {
    if (input) input.value = '';
  }
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
  destroyInlineCodeMirror();
  if (body) {
    body.querySelectorAll('iframe').forEach(frame => frame.removeAttribute('src'));
    body.innerHTML = '';
  }
  if (footer) footer.innerHTML = '';
}

function inlineFileTextarea() {
  return document.getElementById('inlineFileTextContent');
}

function inlineFileCodeShell() {
  return document.getElementById('inlineFileCodeShell');
}

function inlineFileCurrentValue() {
  const cm = FILE_EXPLORER_STATE.inlineCodeMirror;
  if (cm) return cm.getValue();
  const textarea = inlineFileTextarea();
  return textarea ? textarea.value : '';
}

function syncInlineTextareaFromCodeMirror() {
  const cm = FILE_EXPLORER_STATE.inlineCodeMirror;
  const textarea = inlineFileTextarea();
  if (cm && textarea) textarea.value = cm.getValue();
}

function refreshInlineCodeMirror() {
  const cm = FILE_EXPLORER_STATE.inlineCodeMirror;
  if (!cm) return false;
  syncInlineTextareaFromCodeMirror();
  setTimeout(() => cm.refresh(), 0);
  return true;
}

function ensureInlineCodeMirror(path) {
  if (!hasFileEditorCodeMirror()) return null;
  const textarea = inlineFileTextarea();
  const shell = inlineFileCodeShell();
  if (!textarea || !shell) return null;
  if (FILE_EXPLORER_STATE.inlineCodeMirror) return FILE_EXPLORER_STATE.inlineCodeMirror;
  const targetPath = path || FILE_EXPLORER_STATE.inlineFilePath;
  const isPython = isFileExplorerPythonFile(targetPath);
  const mode = fileExplorerCodeMirrorMode(targetPath);
  const cm = window.CodeMirror.fromTextArea(textarea, {
    mode,
    theme: 'material-darker',
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: false,
    readOnly: !!textarea.disabled,
    autoCloseBrackets: !!mode,
    foldGutter: isPython,
    gutters: isPython ? ['CodeMirror-foldgutter', 'CodeMirror-linenumbers'] : ['CodeMirror-linenumbers'],
    foldOptions: isPython ? {
      rangeFinder: window.CodeMirror.fold && window.CodeMirror.fold.indent
    } : undefined,
    extraKeys: isPython ? {
      Tab(editor) {
        if (editor.somethingSelected()) editor.indentSelection('add');
        else editor.replaceSelection('    ', 'end');
      },
      'Ctrl-Q'(editor) { editor.foldCode(editor.getCursor()); }
    } : undefined
  });
  cm.on('change', () => {
    syncInlineTextareaFromCodeMirror();
    const preview = document.querySelector('#inlineFileBody .inline-markdown-preview, #inlineFileBody .inline-code-preview');
    if (preview && !preview.hidden && isFileExplorerMarkdownFile(FILE_EXPLORER_STATE.inlineFilePath)) renderMarkdownPreviewInto(preview, inlineFileCurrentValue());
    if (preview && !preview.hidden && isFileExplorerPythonFile(FILE_EXPLORER_STATE.inlineFilePath)) renderPythonPreviewInto(preview, inlineFileCurrentValue());
  });
  FILE_EXPLORER_STATE.inlineCodeMirror = cm;
  shell.classList.add('cm-active');
  refreshInlineCodeMirror();
  return cm;
}

function destroyInlineCodeMirror() {
  const cm = FILE_EXPLORER_STATE.inlineCodeMirror;
  if (!cm) return;
  syncInlineTextareaFromCodeMirror();
  cm.toTextArea();
  FILE_EXPLORER_STATE.inlineCodeMirror = null;
  const shell = inlineFileCodeShell();
  if (shell) shell.classList.remove('cm-active');
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
    fileExplorerToast('窗口较窄，已关闭文件内容列');
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
    fileExplorerToast(inlineFileOpenBlockedMessage());
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

function highlightPythonCode(code) {
  const source = String(code || '');
  const keywords = new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
    'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
    'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
    'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
  ]);
  const builtins = new Set([
    'abs', 'all', 'any', 'bool', 'bytes', 'callable', 'chr', 'dict', 'dir',
    'enumerate', 'Exception', 'filter', 'float', 'format', 'frozenset', 'getattr',
    'hasattr', 'help', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter',
    'len', 'list', 'map', 'max', 'min', 'next', 'object', 'open', 'ord', 'print',
    'property', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'slice',
    'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip'
  ]);
  const tokenRe = /(#[^\n]*)|((?:[rRuUbBfF]{0,2})(?:'''[\s\S]*?'''|\"\"\"[\s\S]*?\"\"\"|'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"))|(@[A-Za-z_]\w*)|(\b(?:0[xX][0-9A-Fa-f_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?j?)\b)|(\b[A-Za-z_]\w*\b)/g;
  let out = '';
  let last = 0;
  const wrap = (cls, text) => `<span class="py-${cls}">${escapeHtml(text)}</span>`;
  source.replace(tokenRe, (match, comment, string, decorator, number, word, offset) => {
    out += escapeHtml(source.slice(last, offset));
    if (comment) out += wrap('comment', comment);
    else if (string) out += wrap('string', string);
    else if (decorator) out += wrap('decorator', decorator);
    else if (number) out += wrap('number', number);
    else if (keywords.has(word)) out += wrap('keyword', word);
    else if (builtins.has(word)) out += wrap('builtin', word);
    else out += escapeHtml(word);
    last = offset + match.length;
    return match;
  });
  out += escapeHtml(source.slice(last));
  return out;
}

function renderPythonPreviewInto(container, code) {
  if (!container) return;
  container.innerHTML = `<pre class="python-code-preview"><code>${highlightPythonCode(code)}</code></pre>`;
}

function renderMarkdownPreviewInto(container, markdown) {
  if (!container) return;
  if (typeof renderMarkdown === 'function') {
    container.innerHTML = renderMarkdown(String(markdown || ''));
    if (typeof postRender === 'function') postRender(container);
  } else {
    container.innerHTML = `<pre>${escapeHtml(String(markdown || ''))}</pre>`;
  }
}

function updateFileEditorMarkdownPreview() {
  const textarea = fileEditorTextarea();
  const preview = document.getElementById('fileEditorMarkdownPreview');
  if (!textarea || !preview) return;
  renderMarkdownPreviewInto(preview, fileEditorCurrentValue());
}

function setFileEditorMarkdownPreview(enabled) {
  const path = FILE_EXPLORER_STATE.editorPath;
  const isMarkdown = isFileExplorerMarkdownFile(path);
  const textarea = fileEditorTextarea();
  const shell = fileEditorCodeShell();
  const preview = document.getElementById('fileEditorMarkdownPreview');
  const toggle = document.getElementById('fileEditorMarkdownToggle');
  const saveBtn = document.getElementById('fileEditorSaveBtn');
  const nextEnabled = !!enabled && isMarkdown;
  FILE_EXPLORER_STATE.editorCodePreview = false;
  FILE_EXPLORER_STATE.editorMarkdownPreview = nextEnabled;
  setPythonEditorMode(isFileExplorerPythonFile(path) && !nextEnabled);
  if (textarea) textarea.hidden = false;
  if (shell) shell.hidden = nextEnabled;
  if (preview) {
    preview.classList.remove('file-editor-code-preview');
    preview.classList.add('markdown-preview', 'file-editor-markdown-preview', 'msg-content');
    preview.hidden = !nextEnabled;
    if (nextEnabled) updateFileEditorMarkdownPreview();
  }
  if (toggle) {
    toggle.hidden = !isMarkdown;
    toggle.textContent = nextEnabled ? '编辑源码' : 'Markdown 预览';
    toggle.classList.toggle('active', nextEnabled);
  }
  const codeToggle = document.getElementById('fileEditorCodeToggle');
  if (codeToggle) {
    codeToggle.hidden = !isFileExplorerPythonFile(path);
    codeToggle.textContent = 'Python 高亮预览';
    codeToggle.classList.remove('active');
  }
  if (saveBtn) saveBtn.hidden = nextEnabled;
  if (!nextEnabled && textarea && !textarea.disabled) textarea.focus();
}

function updateFileEditorCodePreview() {
  const textarea = fileEditorTextarea();
  const preview = document.getElementById('fileEditorMarkdownPreview');
  if (!textarea || !preview) return;
  renderPythonPreviewInto(preview, fileEditorCurrentValue());
}

function setFileEditorCodePreview(enabled) {
  const path = FILE_EXPLORER_STATE.editorPath;
  const isPython = isFileExplorerPythonFile(path);
  const textarea = fileEditorTextarea();
  const shell = fileEditorCodeShell();
  const preview = document.getElementById('fileEditorMarkdownPreview');
  const toggle = document.getElementById('fileEditorCodeToggle');
  const markdownToggle = document.getElementById('fileEditorMarkdownToggle');
  const saveBtn = document.getElementById('fileEditorSaveBtn');
  const nextEnabled = !!enabled && isPython;
  FILE_EXPLORER_STATE.editorMarkdownPreview = false;
  FILE_EXPLORER_STATE.editorCodePreview = nextEnabled;
  if (shell) shell.hidden = nextEnabled;
  if (preview) {
    preview.classList.remove('markdown-preview', 'file-editor-markdown-preview', 'msg-content');
    preview.classList.add('file-editor-code-preview');
    preview.hidden = !nextEnabled;
    if (nextEnabled) updateFileEditorCodePreview();
  }
  if (toggle) {
    toggle.hidden = !isPython;
    toggle.textContent = nextEnabled ? '编辑器' : 'Python 高亮预览';
    toggle.classList.toggle('active', nextEnabled);
  }
  if (markdownToggle) markdownToggle.hidden = !isFileExplorerMarkdownFile(path);
  if (saveBtn) saveBtn.hidden = nextEnabled;
  if (nextEnabled) syncFileEditorTextareaFromCodeMirror();
  if (textarea) textarea.hidden = false;
  setPythonEditorMode(isPython && !nextEnabled);
  if (!nextEnabled && textarea && !textarea.disabled) textarea.focus();
}

function toggleFileEditorMarkdownPreview() {
  setFileEditorMarkdownPreview(!FILE_EXPLORER_STATE.editorMarkdownPreview);
}

function toggleFileEditorCodePreview() {
  setFileEditorCodePreview(!FILE_EXPLORER_STATE.editorCodePreview);
}

async function openTextInMainPanel(path, initialContent = null, initialSize = null) {
  const normalizedPath = normalizeExplorerPath(path);
  if (!isFileExplorerTextFile(normalizedPath)) {
    fileExplorerToast('暂只支持文本类文件');
    return false;
  }
  if (!showInlineFilePanel('text', normalizedPath)) return false;
  const body = document.getElementById('inlineFileBody');
  const footer = document.getElementById('inlineFileFooter');
  if (!body || !footer) return false;
  clearInlineFileContent();
  const shell = document.createElement('div');
  const textarea = document.createElement('textarea');
  const preview = document.createElement('div');
  const isMarkdown = isFileExplorerMarkdownFile(normalizedPath);
  const isPython = isFileExplorerPythonFile(normalizedPath);
  shell.id = 'inlineFileCodeShell';
  shell.className = `file-editor-code-shell inline-file-code-shell${isPython ? ' python-editor' : ''}`;
  textarea.spellcheck = false;
  textarea.placeholder = '文件内容...';
  textarea.id = 'inlineFileTextContent';
  preview.className = 'markdown-preview inline-markdown-preview msg-content';
  preview.hidden = true;
  shell.appendChild(textarea);
  body.appendChild(shell);
  body.appendChild(preview);
  footer.innerHTML = `
    <button class="btn" type="button" data-action="copyInlineFileContent">复制内容</button>
    ${isMarkdown ? '<button class="btn" type="button" id="inlineMarkdownToggle" data-action="toggleInlineMarkdownPreview">Markdown 预览</button>' : ''}
    ${isPython ? '<button class="btn" type="button" id="inlinePythonToggle" data-action="toggleInlinePythonPreview">Python 高亮预览</button>' : ''}
    <button class="btn" type="button" data-action="reloadInlineFilePanel">重新读取</button>
  `;
  const setContent = (content, disabled = false) => {
    const cm = FILE_EXPLORER_STATE.inlineCodeMirror;
    textarea.value = String(content || '');
    textarea.disabled = !!disabled;
    if (cm) {
      cm.setValue(textarea.value);
      cm.setOption('readOnly', !!disabled);
      refreshInlineCodeMirror();
    }
    if (isMarkdown && FILE_EXPLORER_STATE.inlineFileKind === 'markdown') renderMarkdownPreviewInto(preview, inlineFileCurrentValue());
    if (isPython && FILE_EXPLORER_STATE.inlineFileKind === 'python') renderPythonPreviewInto(preview, inlineFileCurrentValue());
  };
  ensureInlineCodeMirror(normalizedPath);
  if (initialContent !== null && initialContent !== undefined) {
    setContent(initialContent, false);
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
    setContent(r.content || '', false);
    setInlineFileStatus(`${formatSize(Number(r.size || 0))} / 已读取`, 'ok');
    textarea.focus();
    return true;
  } catch (e) {
    textarea.disabled = true;
    setInlineFileStatus(e.message || String(e), 'error');
  }
  return true;
}

function toggleInlineMarkdownPreview(force) {
  const path = FILE_EXPLORER_STATE.inlineFilePath;
  if (!isFileExplorerMarkdownFile(path)) return;
  const shell = inlineFileCodeShell();
  const preview = document.querySelector('#inlineFileBody .inline-markdown-preview');
  const toggle = document.getElementById('inlineMarkdownToggle');
  if (!shell || !preview) return;
  const showPreview = typeof force === 'boolean' ? force : preview.hidden;
  if (showPreview) renderMarkdownPreviewInto(preview, inlineFileCurrentValue());
  preview.hidden = !showPreview;
  shell.hidden = showPreview;
  FILE_EXPLORER_STATE.inlineFileKind = showPreview ? 'markdown' : 'text';
  if (toggle) {
    toggle.textContent = showPreview ? '查看源码' : 'Markdown 预览';
    toggle.classList.toggle('active', showPreview);
  }
  if (!showPreview && !refreshInlineCodeMirror()) inlineFileTextarea()?.focus();
}

function toggleInlinePythonPreview(force) {
  const path = FILE_EXPLORER_STATE.inlineFilePath;
  if (!isFileExplorerPythonFile(path)) return;
  const shell = inlineFileCodeShell();
  const preview = document.querySelector('#inlineFileBody .inline-markdown-preview, #inlineFileBody .inline-code-preview');
  const toggle = document.getElementById('inlinePythonToggle');
  if (!shell || !preview) return;
  const showPreview = typeof force === 'boolean' ? force : preview.hidden;
  if (showPreview) {
    preview.className = 'inline-code-preview';
    renderPythonPreviewInto(preview, inlineFileCurrentValue());
  }
  preview.hidden = !showPreview;
  shell.hidden = showPreview;
  FILE_EXPLORER_STATE.inlineFileKind = showPreview ? 'python' : 'text';
  if (toggle) {
    toggle.textContent = showPreview ? '编辑器' : 'Python 高亮预览';
    toggle.classList.toggle('active', showPreview);
  }
  if (!showPreview && !refreshInlineCodeMirror()) inlineFileTextarea()?.focus();
}

async function openPdfInMainPanel(path, existingUrl = '') {
  const normalizedPath = normalizeExplorerPath(path);
  if (!isFileExplorerPdfFile(normalizedPath)) {
    fileExplorerToast('仅支持 PDF 文件');
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
    <button class="btn" type="button" data-action="reloadInlineFilePanel">重新读取</button>
    <button class="btn" type="button" data-action="openInlineFileInNewTab">新标签打开</button>
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
  const opened = await openTextInMainPanel(path, textarea ? fileEditorCurrentValue() : null);
  if (opened) closeFileEditor(true);
}

function copyInlineFileContent() {
  const value = inlineFileCurrentValue();
  if (value === null || value === undefined) return;
  navigator.clipboard.writeText(value).then(() => {
    fileExplorerToast('内容已复制');
  });
}

async function reloadInlineFilePanel() {
  const path = FILE_EXPLORER_STATE.inlineFilePath;
  const kind = FILE_EXPLORER_STATE.inlineFileKind;
  if (!path) return;
  if (kind === 'pdf') await openPdfInMainPanel(path);
  else if (kind === 'text' || kind === 'markdown') await openTextInMainPanel(path);
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
  syncFileEditorTextareaFromCodeMirror();
  if (!force && textarea && FILE_EXPLORER_STATE.editorPath && textarea.value !== FILE_EXPLORER_STATE.editorOriginal) {
    refreshFileEditorCodeMirror();
    if (!confirm('文件有未保存修改，确定关闭？')) return;
  }
  setPythonEditorMode(false);
  if (modal) modal.classList.remove('show');
}

async function openFileEditor(path) {
  const normalizedPath = normalizeExplorerPath(path);
  if (!isFileExplorerTextFile(normalizedPath)) {
    fileExplorerToast('暂只支持文本类文件');
    return;
  }
  const modal = document.getElementById('fileEditorModal');
  const pathEl = document.getElementById('fileEditorPath');
  const textarea = fileEditorTextarea();
  if (!modal || !textarea) return;
  FILE_EXPLORER_STATE.editorPath = normalizedPath;
  FILE_EXPLORER_STATE.editorOriginal = '';
  FILE_EXPLORER_STATE.editorFoldedLines = new Set();
  if (pathEl) pathEl.textContent = normalizedPath;
  textarea.value = '';
  textarea.disabled = true;
  textarea.hidden = false;
  setFileEditorMarkdownPreview(false);
  setFileEditorCodePreview(false);
  setFileEditorSyntaxMode(normalizedPath);
  modal.classList.add('show');
  setFileEditorStatus('正在读取...', 'loading');
  try {
    if (typeof callAgentBackend !== 'function') throw new Error('本地工具接口未加载');
    const r = await callAgentBackend('read_file', { path: normalizedPath });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '读取文件失败');
    textarea.value = r.content || '';
    textarea.disabled = false;
    if (FILE_EXPLORER_STATE.editorCodeMirror) {
      FILE_EXPLORER_STATE.editorCodeMirror.setValue(textarea.value);
    }
    FILE_EXPLORER_STATE.editorOriginal = textarea.value;
    setFileEditorMarkdownPreview(false);
    setFileEditorCodePreview(false);
    setFileEditorSyntaxMode(normalizedPath);
    if (FILE_EXPLORER_STATE.editorCodeMirror) {
      FILE_EXPLORER_STATE.editorCodeMirror.setOption('readOnly', false);
    }
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
  syncFileEditorTextareaFromCodeMirror();
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
    if (FILE_EXPLORER_STATE.editorMarkdownPreview) updateFileEditorMarkdownPreview();
    if (FILE_EXPLORER_STATE.editorCodePreview) updateFileEditorCodePreview();
    if (FILE_EXPLORER_STATE.editorPythonMode) refreshFileEditorCodeMirror() || renderPythonEditor();
    setFileEditorStatus(`已保存 ${formatSize(Number(r.bytes_written || 0))}`, 'ok');
    fileExplorerToast('文件已保存');
    if (FILE_EXPLORER_STATE.visible) refreshFileExplorer();
  } catch (e) {
    setFileEditorStatus(e.message || String(e), 'error');
  }
}

function copyFileEditorContent() {
  syncFileEditorTextareaFromCodeMirror();
  const textarea = fileEditorTextarea();
  if (!textarea) return;
  navigator.clipboard.writeText(textarea.value).then(() => {
    fileExplorerToast('内容已复制');
  });
}

async function openFileWithSystemDefault(path) {
  const normalizedPath = normalizeExplorerPath(path);
  try {
    if (typeof callAgentBackend !== 'function') throw new Error('本地工具接口未加载');
    const r = await callAgentBackend('open_file_default', { path: normalizedPath });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '系统默认应用打开失败');
    fileExplorerToast(`已使用系统默认应用打开：${fileExplorerBasename(normalizedPath)}`);
  } catch (e) {
    fileExplorerToast(`无法使用系统默认应用打开：${e.message || String(e)}`);
  }
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
  else openFileWithSystemDefault(normalizedPath);
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

async function compileTexFile(path = FILE_EXPLORER_STATE.contextPath) {
  const normalizedPath = normalizeExplorerPath(path);
  if (!isFileExplorerTexFile(normalizedPath)) {
    fileExplorerToast('仅支持编译 .tex 文件');
    return;
  }
  try {
    fileExplorerToast('正在调用 xelatex 编译...');
    if (typeof callAgentBackend !== 'function') throw new Error('本地工具接口未加载');
    const r = await callAgentBackend('compile_tex', { path: normalizedPath }, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) {
      const installHint = r && r.install_hint ? `\n${r.install_hint}` : '';
      throw new Error(((r && r.error) || 'TeX 编译失败') + installHint);
    }
    const pdfPath = normalizeExplorerPath(r.pdf_path || normalizedPath.replace(/\.tex$/i, '.pdf'));
    fileExplorerToast('编译完成，正在打开 PDF...');
    if (FILE_EXPLORER_STATE.visible) refreshFileExplorer();
    await openPdfViewer(pdfPath);
  } catch (e) {
    const message = e.message || String(e);
    if (FileExplorerUiService.has('toast')) fileExplorerToast(message, 6000);
    else alert(message);
  }
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
    fileExplorerToast('仅支持 PDF 文件');
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
    fileExplorerToast('仅支持图片文件');
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
    fileExplorerToast('仅支持音频/视频文件');
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
  menu.querySelectorAll('[data-tex-only]').forEach(btn => {
    btn.hidden = !(isItem && type !== 'dir' && isFileExplorerTexFile(path));
  });
  menu.querySelectorAll('[data-paste-only]').forEach(btn => {
    const needsDir = btn.dataset.dirOnly === 'true';
    btn.hidden = !FILE_EXPLORER_STATE.clipboard || (needsDir && type !== 'dir');
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
    fileExplorerToast('文件名不能为空，且不能包含路径分隔符');
    return;
  }
  try {
    const r = await callAgentBackend('create_file', { path, content: '' }, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '新建文件失败');
    fileExplorerToast('已新建文件');
    await loadFileExplorer(basePath || FILE_EXPLORER_STATE.path);
    openFileEditor(path);
  } catch (e) {
    fileExplorerToast(e.message || String(e));
  }
}

async function createFileExplorerFolder(basePath = FILE_EXPLORER_STATE.contextPath) {
  const name = prompt('输入新文件夹名称', '新建文件夹');
  if (name === null) return;
  const path = uniqueExplorerChildPath(basePath, name);
  if (!path) {
    fileExplorerToast('文件夹名不能为空，且不能包含路径分隔符');
    return;
  }
  try {
    const r = await callAgentBackend('create_dir', { path }, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '新建文件夹失败');
    fileExplorerToast('已新建文件夹');
    refreshFileExplorer();
  } catch (e) {
    fileExplorerToast(e.message || String(e));
  }
}

async function switchFileExplorerWorkspace(path = FILE_EXPLORER_STATE.contextPath) {
  const normalizedPath = normalizeExplorerPath(path || FILE_EXPLORER_STATE.path);
  try {
    const r = await callAgentBackend('set_workspace', { path: normalizedPath }, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '切换工作区失败');
    if (typeof noteRemoteWorkspaceChanged === 'function') noteRemoteWorkspaceChanged(r.workspace || r.cwd || normalizedPath);
    FILE_EXPLORER_STATE.path = '.';
    FILE_EXPLORER_STATE.entries = [];
    fileExplorerToast('已切换工作区');
    await loadFileExplorer('.');
  } catch (e) {
    fileExplorerToast(e.message || String(e));
  }
}

async function copyFileExplorerPath(path = FILE_EXPLORER_STATE.contextPath) {
  const normalizedPath = normalizeExplorerPath(path);
  try {
    await navigator.clipboard.writeText(normalizedPath);
    fileExplorerToast('路径已复制');
  } catch (e) {
    fileExplorerToast('复制失败：' + (e.message || String(e)));
  }
}

function setFileExplorerClipboard(path, type, mode = 'copy') {
  const normalizedPath = normalizeExplorerPath(path);
  if (!normalizedPath) return false;
  FILE_EXPLORER_STATE.clipboard = {
    path: normalizedPath,
    type: type === 'dir' ? 'dir' : 'file',
    mode: mode === 'cut' ? 'cut' : 'copy',
    name: fileExplorerBasename(normalizedPath),
    copiedAt: Date.now()
  };
  return true;
}

function copyFileExplorerItem(path = FILE_EXPLORER_STATE.contextPath, type = FILE_EXPLORER_STATE.contextType) {
  if (!setFileExplorerClipboard(path, type, 'copy')) return;
  fileExplorerToast(`已复制 ${FILE_EXPLORER_STATE.clipboard.name || FILE_EXPLORER_STATE.clipboard.path}`);
}

function cutFileExplorerItem(path = FILE_EXPLORER_STATE.contextPath, type = FILE_EXPLORER_STATE.contextType) {
  if (!setFileExplorerClipboard(path, type, 'cut')) return;
  fileExplorerToast(`已剪切 ${FILE_EXPLORER_STATE.clipboard.name || FILE_EXPLORER_STATE.clipboard.path}`);
}

function rebaseMovedExplorerPath(current, sourcePath, targetPath) {
  const currentPath = normalizeExplorerPath(current);
  const source = normalizeExplorerPath(sourcePath);
  const target = normalizeExplorerPath(targetPath);
  if (currentPath === source) return target;
  if (currentPath.startsWith(source + '/')) return target + currentPath.slice(source.length);
  return current;
}

function updateMovedExplorerReferences(sourcePath, targetPath) {
  FILE_EXPLORER_STATE.editorPath = rebaseMovedExplorerPath(FILE_EXPLORER_STATE.editorPath, sourcePath, targetPath);
  FILE_EXPLORER_STATE.pdfPath = rebaseMovedExplorerPath(FILE_EXPLORER_STATE.pdfPath, sourcePath, targetPath);
  FILE_EXPLORER_STATE.imagePath = rebaseMovedExplorerPath(FILE_EXPLORER_STATE.imagePath, sourcePath, targetPath);
  FILE_EXPLORER_STATE.mediaPath = rebaseMovedExplorerPath(FILE_EXPLORER_STATE.mediaPath, sourcePath, targetPath);
  FILE_EXPLORER_STATE.inlineFilePath = rebaseMovedExplorerPath(FILE_EXPLORER_STATE.inlineFilePath, sourcePath, targetPath);
}

async function pasteFileExplorerItem(targetDir = FILE_EXPLORER_STATE.contextPath) {
  const clip = FILE_EXPLORER_STATE.clipboard;
  if (!clip || !clip.path) {
    fileExplorerToast('没有可粘贴的文件');
    return;
  }
  const normalizedTargetDir = normalizeExplorerPath(targetDir || FILE_EXPLORER_STATE.path);
  const isCut = clip.mode === 'cut';
  if (isCut && normalizeExplorerPath(parentExplorerPath(clip.path)) === normalizedTargetDir) {
    FILE_EXPLORER_STATE.clipboard = null;
    fileExplorerToast('文件已在当前目录');
    return;
  }
  try {
    if (typeof callAgentBackend !== 'function') throw new Error('本地工具接口未加载');
    const action = isCut ? 'move_file' : 'copy_file';
    const r = await callAgentBackend(
      action,
      { path: clip.path, target_dir: normalizedTargetDir, dedupe: true },
      undefined,
      undefined,
      { skipConfirm: true }
    );
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '粘贴失败');
    const pastedName = fileExplorerBasename(r.new_path || r.path || clip.name);
    if (isCut) {
      updateMovedExplorerReferences(clip.path, r.new_path || clip.path);
      FILE_EXPLORER_STATE.clipboard = null;
    }
    fileExplorerToast(isCut ? `已移动 ${pastedName || clip.name}` : `已粘贴 ${pastedName || clip.name}`);
    await loadFileExplorer(FILE_EXPLORER_STATE.path, { silent: true });
  } catch (e) {
    fileExplorerToast(e.message || String(e));
  }
}

function downloadFileExplorerPath(path = FILE_EXPLORER_STATE.contextPath, type = FILE_EXPLORER_STATE.contextType) {
  const normalizedPath = normalizeExplorerPath(path);
  if (!normalizedPath) {
    fileExplorerToast('没有可下载的路径');
    return;
  }
  if (typeof TERMINAL_CONFIG === 'undefined') {
    fileExplorerToast('本地工具接口未加载');
    return;
  }
  const base = (TERMINAL_CONFIG.serverUrl || 'http://localhost:8765').replace(/\/+$/, '');
  const archive = type === 'dir' ? '&archive=zip' : '';
  const url = `${base}/preview-file?path=${encodeURIComponent(normalizedPath)}&download=1${archive}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = type === 'dir' ? `${fileExplorerBasename(normalizedPath) || 'folder'}.zip` : fileExplorerBasename(normalizedPath);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  fileExplorerToast(type === 'dir' ? '已开始打包下载文件夹' : '已开始下载');
}

async function renameFileExplorerPath(path = FILE_EXPLORER_STATE.contextPath) {
  const normalizedPath = normalizeExplorerPath(path);
  const currentName = fileExplorerBasename(normalizedPath);
  const nextName = prompt('输入新名称', currentName);
  if (nextName === null) return;
  const newPath = siblingExplorerPath(normalizedPath, nextName);
  if (!newPath) {
    fileExplorerToast('名称不能为空，且不能包含路径分隔符');
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
    fileExplorerToast('已重命名');
    refreshFileExplorer();
  } catch (e) {
    fileExplorerToast(e.message || String(e));
  }
}

async function deleteFileExplorerPath(path = FILE_EXPLORER_STATE.contextPath) {
  const normalizedPath = normalizeExplorerPath(path);
  try {
    const r = await callAgentBackend('delete_file', { path: normalizedPath, recursive: true }, { skipConfirm: true });
    if (typeof r === 'string') throw new Error(r);
    if (!r || !r.ok) throw new Error((r && r.error) || '删除失败');
    if (FILE_EXPLORER_STATE.editorPath === normalizedPath) closeFileEditor(true);
    if (FILE_EXPLORER_STATE.pdfPath === normalizedPath) closePdfViewer();
    if (FILE_EXPLORER_STATE.imagePath === normalizedPath) closeImageViewer();
    if (FILE_EXPLORER_STATE.mediaPath === normalizedPath) closeMediaViewer();
    fileExplorerToast('已删除');
    refreshFileExplorer();
  } catch (e) {
    fileExplorerToast(e.message || String(e));
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
  else if (action === 'compile-tex') compileTexFile(path);
  else if (action === 'copy-item') copyFileExplorerItem(path, type);
  else if (action === 'cut-item') cutFileExplorerItem(path, type);
  else if (action === 'paste') pasteFileExplorerItem(path);
  else if (action === 'download') downloadFileExplorerPath(path, type);
  else if (action === 'upload-files') openFileExplorerUploadPicker('files', path);
  else if (action === 'upload-folder') openFileExplorerUploadPicker('folder', path);
  else if (action === 'rename') renameFileExplorerPath(path);
  else if (action === 'copy-path') copyFileExplorerPath(path);
  else if (action === 'delete') deleteFileExplorerPath(path);
  else if (action === 'new-file') createFileExplorerFile(path);
  else if (action === 'new-folder') createFileExplorerFolder(path);
  else if (action === 'switch-workspace') switchFileExplorerWorkspace(path);
}

document.addEventListener('DOMContentLoaded', () => {
  bindPythonFileEditor();
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
window.copyFileExplorerItem = copyFileExplorerItem;
window.cutFileExplorerItem = cutFileExplorerItem;
window.pasteFileExplorerItem = pasteFileExplorerItem;
window.downloadFileExplorerPath = downloadFileExplorerPath;
window.renameFileExplorerPath = renameFileExplorerPath;
window.deleteFileExplorerPath = deleteFileExplorerPath;
window.openFileExplorerPath = openFileExplorerPath;
window.createFileExplorerFile = createFileExplorerFile;
window.createFileExplorerFolder = createFileExplorerFolder;
window.switchFileExplorerWorkspace = switchFileExplorerWorkspace;
window.uploadSelectedFilesToExplorer = uploadSelectedFilesToExplorer;
window.openFileExplorerUploadPicker = openFileExplorerUploadPicker;
window.openCurrentFileInMainPanel = openCurrentFileInMainPanel;
window.openTextInMainPanel = openTextInMainPanel;
window.openPdfInMainPanel = openPdfInMainPanel;
window.closeInlineFilePanel = closeInlineFilePanel;
window.setFileEditorMarkdownPreview = setFileEditorMarkdownPreview;
window.setFileEditorCodePreview = setFileEditorCodePreview;
window.toggleFileEditorMarkdownPreview = toggleFileEditorMarkdownPreview;
window.toggleFileEditorCodePreview = toggleFileEditorCodePreview;
window.reloadInlineFilePanel = reloadInlineFilePanel;
window.copyInlineFileContent = copyInlineFileContent;
window.openInlineFileInNewTab = openInlineFileInNewTab;
window.toggleInlineMarkdownPreview = toggleInlineMarkdownPreview;
window.toggleInlineFileSide = toggleInlineFileSide;

window.AgentApp.define('fileExplorer', {
  FILE_EXPLORER_STATE,
  normalizeExplorerPath,
  joinExplorerPath,
  parentExplorerPath,
  renderFileExplorer,
  loadFileExplorer,
  refreshFileExplorer,
  resetFileExplorerToRoot,
  toggleSidebarExplorer,
  setSidebarExplorerMode,
  openFileExplorerPath,
  openFileEditor,
  closeFileEditor,
  saveFileEditor,
  openPdfViewer,
  openImageViewer,
  openMediaViewer,
  openCurrentFileInMainPanel,
  openTextInMainPanel,
  openPdfInMainPanel,
  closeInlineFilePanel,
  createFileExplorerFile,
  createFileExplorerFolder,
  copyFileExplorerItem,
  cutFileExplorerItem,
  pasteFileExplorerItem,
  downloadFileExplorerPath,
  renameFileExplorerPath,
  deleteFileExplorerPath,
  switchFileExplorerWorkspace,
  uploadSelectedFilesToExplorer,
  openFileExplorerUploadPicker
});
