// ============ Music Player Settings Module ============

const MUSIC_SETTINGS_KEY = 'aichat_music_player_v1';
const MUSIC_AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.webm', '.opus'];
const MUSIC_COMPLETION_MAX_SECONDS = 3;

let musicPlayerState = {
  tracks: [],
  currentIndex: -1,
  source: 'library',
  objectUrls: [],
  lastPersistSecond: -1,
  completionAudio: null,
  completionTimer: null,
  bgmAudio: null,
  bgmTrackPath: '',
  tokenPending: false,
  tokenWaiters: [],
  listSearch: '',
  previewBgmRequested: false,
  libraryLoaded: false,
  settings: {
    volume: 70,
    muted: false,
    loopMode: 'list',
    shuffle: false,
    autoplayNext: true,
    playbackRate: 1,
    rememberPosition: true,
    completionSoundMode: 'default',
    completionTrackPath: '',
    generationBgmEnabled: false,
    generationBgmTrackPath: '',
    generationBgmVolume: 35,
    generationBgmLoop: true,
    listCollapsed: false,
    lastSource: '',
    lastPath: '',
    lastTime: 0
  }
};

function musicDefaultSettings() {
  return {
    volume: 70,
    muted: false,
    loopMode: 'list',
    shuffle: false,
    autoplayNext: true,
    playbackRate: 1,
    rememberPosition: true,
    completionSoundMode: 'default',
    completionTrackPath: '',
    generationBgmEnabled: false,
    generationBgmTrackPath: '',
    generationBgmVolume: 35,
    generationBgmLoop: true,
    listCollapsed: false,
    lastSource: '',
    lastPath: '',
    lastTime: 0
  };
}

function loadMusicSettings() {
  const stateSettings = state && state.settings && state.settings.musicPlayer
    ? state.settings.musicPlayer
    : {};
  try {
    const raw = storage.get(MUSIC_SETTINGS_KEY);
    const legacy = raw ? JSON.parse(raw) : {};
    musicPlayerState.settings = { ...musicDefaultSettings(), ...stateSettings, ...legacy };
  } catch (e) {
    musicPlayerState.settings = { ...musicDefaultSettings(), ...stateSettings };
  }
}

function saveMusicSettings() {
  if (state && state.settings) {
    state.settings.musicPlayer = { ...musicPlayerState.settings };
    if (typeof persistSettings === 'function') persistSettings();
  }
  try { storage.set(MUSIC_SETTINGS_KEY, JSON.stringify(musicPlayerState.settings)); } catch (e) {}
}

function musicExt(name) {
  return String(name || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
}

function musicIsAudioFile(fileOrName) {
  const name = typeof fileOrName === 'string' ? fileOrName : (fileOrName && fileOrName.name);
  return MUSIC_AUDIO_EXTS.includes(musicExt(name));
}

function musicFormatSize(bytes) {
  return typeof formatSize === 'function' ? formatSize(bytes || 0) : `${bytes || 0} B`;
}

function musicFormatTime(seconds) {
  const n = Number(seconds || 0);
  if (!Number.isFinite(n) || n <= 0) return '0:00';
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function musicAudio() {
  return document.getElementById('musicAudio');
}

function musicCurrentTrack() {
  return musicPlayerState.tracks[musicPlayerState.currentIndex] || null;
}

function musicTrackPath(track) {
  return track ? (track.path || track.name || '') : '';
}

function musicTrackKey(track) {
  if (!track) return '';
  return `${track.source || ''}\n${musicTrackPath(track)}`;
}

function musicTrackMatchesSaved(track, source, path) {
  if (!track || !path) return false;
  if (source && track.source !== source) return false;
  return musicTrackPath(track) === path;
}

function musicTrackUrl(track) {
  if (!track) return '';
  if (track.objectUrl) return track.objectUrl;
  const base = (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.serverUrl) ? TERMINAL_CONFIG.serverUrl : 'http://localhost:8765';
  const token = (typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.token) ? TERMINAL_CONFIG.token : '';
  const sep = String(track.url || '').includes('?') ? '&' : '?';
  return base.replace(/\/+$/, '') + (track.url || '') + sep + 'token=' + encodeURIComponent(token);
}

function musicHasBackendToken() {
  return !!(typeof TERMINAL_CONFIG !== 'undefined' && TERMINAL_CONFIG.token);
}

function musicEnsureTokenThen(fn) {
  if (musicHasBackendToken() || typeof fetchTerminalToken !== 'function') return false;
  if (typeof fn === 'function') musicPlayerState.tokenWaiters.push(fn);
  if (musicPlayerState.tokenPending) return true;
  musicPlayerState.tokenPending = true;
  fetchTerminalToken(true)
    .then(() => {
      const waiters = musicPlayerState.tokenWaiters.splice(0);
      waiters.forEach(cb => {
        try { cb(); } catch (e) { console.warn('[music] token waiter failed', e); }
      });
    })
    .catch(error => console.warn('[music] token fetch failed', error))
    .finally(() => {
      musicPlayerState.tokenPending = false;
      musicPlayerState.tokenWaiters = [];
    });
  return true;
}

function musicLibraryTracks() {
  return musicPlayerState.tracks.filter(t => t && t.source === 'library');
}

function musicTrackByPath(path) {
  const target = String(path || '');
  if (!target) return null;
  const existing = musicLibraryTracks().find(t => musicTrackPath(t) === target);
  if (existing) return existing;
  if (musicPlayerState.libraryLoaded) return null;
  return {
    name: target.split(/[\\/]/).pop() || target,
    path: target,
    size: 0,
    source: 'library',
    sourceLabel: 'music 文件夹',
    url: '/music-file?path=' + encodeURIComponent(target)
  };
}

function musicTrackOptions(selectedPath, emptyLabel = '未选择') {
  const selected = String(selectedPath || '');
  const tracks = musicLibraryTracks();
  const options = [`<option value="" ${selected ? '' : 'selected'}>${escapeHtml(emptyLabel)}</option>`];
  tracks.forEach(track => {
    const path = musicTrackPath(track);
    options.push(`<option value="${escapeHtml(path)}" ${path === selected ? 'selected' : ''}>${escapeHtml(musicTrackDisplayName(track) || path)}</option>`);
  });
  if (selected && !tracks.some(t => musicTrackPath(t) === selected)) {
    options.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}（未找到）</option>`);
  }
  return options.join('');
}

function musicTrackDisplayName(track) {
  if (!track) return '';
  return track.name || musicTrackPath(track).split('/').pop() || musicTrackPath(track);
}

function musicPersistPosition(force = false) {
  const audio = musicAudio();
  const track = musicCurrentTrack();
  if (!audio || !track || !musicPlayerState.settings.rememberPosition) return;
  const second = Math.floor(audio.currentTime || 0);
  if (!force && second === musicPlayerState.lastPersistSecond) return;
  musicPlayerState.lastPersistSecond = second;
  musicPlayerState.settings.lastSource = track.source || '';
  musicPlayerState.settings.lastPath = musicTrackPath(track);
  musicPlayerState.settings.lastTime = second;
  saveMusicSettings();
}

async function musicBackend(op, params = {}) {
  if (typeof callAgentBackend !== 'function') {
    return { ok: false, error: '本地后端不可用，请从 local_terminal_server.py 打开页面' };
  }
  const result = await callAgentBackend('music', { op, ...params });
  if (typeof result === 'string') return { ok: false, error: result };
  return result;
}

function openMusicPlayer() {
  loadMusicSettings();
  ensureMusicModal();
  const modal = document.getElementById('musicModal');
  if (modal && !window.__SETTINGS_PAGE_DOCKING__) modal.classList.add('show');
  const root = document.getElementById('musicPlayerRoot');
  if (!root || !root.children.length) {
    renderMusicPlayer();
  } else {
    updateMusicNowDisplay();
    renderMusicTrackList();
    updateMusicTimeText();
    applyMusicAudioSettings();
  }
  refreshMusicLibrary(false).catch(error => {
    console.warn('[music] refresh failed', error);
    updateMusicStatus(error && error.message ? error.message : '读取 music 文件夹失败');
  });
}

function closeMusicPlayer() {
  musicPersistPosition(true);
  const modal = document.getElementById('musicModal');
  if (modal) modal.classList.remove('show');
}

function ensureMusicModal() {
  if (document.getElementById('musicModal')) return;
  const mask = document.createElement('div');
  mask.className = 'modal-mask music-modal';
  mask.id = 'musicModal';
  mask.innerHTML = `
    <div class="modal wide">
      <h2>🎵 音乐播放 <button class="modal-close" onclick="closeMusicPlayer()">×</button></h2>
      <div class="music-player" id="musicPlayerRoot"></div>
    </div>`;
  document.body.appendChild(mask);
}

function renderMusicPlayer() {
  const root = document.getElementById('musicPlayerRoot');
  if (!root) return;
  const s = musicPlayerState.settings;
  const current = musicCurrentTrack();
  root.innerHTML = `
    <div class="music-layout">
      <section class="music-now">
        <div class="music-cover">${current ? '♪' : '♫'}</div>
        <div class="music-now-main">
          <div class="music-title" id="musicNowTitle">${escapeHtml(current ? current.name : '未选择音乐')}</div>
          <div class="music-sub" id="musicNowSub">${escapeHtml(current ? (current.sourceLabel || 'music 文件夹') : '从 music 文件夹或本机文件选择音频')}</div>
          <audio id="musicAudio" controls preload="metadata"></audio>
          <div class="music-progress-meta">
            <span id="musicTimeText">0:00 / 0:00</span>
            <span id="musicStatusText">${musicPlayerState.tracks.length} 首</span>
          </div>
          <div class="music-controls">
            <button class="btn" onclick="musicPrevTrack()">⏮ 上一首</button>
            <button class="btn btn-primary" onclick="musicTogglePlay()">▶/⏸ 播放</button>
            <button class="btn" onclick="musicNextTrack()">⏭ 下一首</button>
            <button class="btn" onclick="refreshMusicLibrary(true)">刷新 music</button>
          </div>
        </div>
      </section>

      <section class="music-toolbar">
        <input type="file" id="musicImportInput" accept="audio/*" multiple hidden onchange="musicImportFiles(event)">
        <input type="file" id="musicOpenInput" accept="audio/*" multiple hidden onchange="musicOpenLocalFiles(event)">
        <input type="file" id="musicFolderInput" accept="audio/*" multiple webkitdirectory hidden onchange="musicOpenLocalFiles(event)">
        <button class="btn btn-primary" onclick="document.getElementById('musicImportInput').click()">导入到 music 文件夹</button>
        <button class="btn" onclick="document.getElementById('musicOpenInput').click()">打开本机音乐</button>
        <button class="btn" onclick="document.getElementById('musicFolderInput').click()">打开本机文件夹</button>
        <span class="music-dir" id="musicDirText">music/</span>
      </section>

      <section class="music-settings-grid">
        <label class="music-setting">音量
          <input type="range" min="0" max="100" value="${Number(s.volume || 0)}" oninput="musicSetVolume(this.value)">
        </label>
        <label class="music-setting">倍速
          <select onchange="musicSetPlaybackRate(this.value)">
            ${[0.75, 1, 1.25, 1.5, 2].map(v => `<option value="${v}" ${Number(s.playbackRate) === v ? 'selected' : ''}>${v}x</option>`).join('')}
          </select>
        </label>
        <label class="music-setting">循环
          <select onchange="musicSetLoopMode(this.value)">
            <option value="list" ${s.loopMode === 'list' ? 'selected' : ''}>列表循环</option>
            <option value="one" ${s.loopMode === 'one' ? 'selected' : ''}>单曲循环</option>
            <option value="none" ${s.loopMode === 'none' ? 'selected' : ''}>不循环</option>
          </select>
        </label>
        <label class="music-check"><input type="checkbox" ${s.shuffle ? 'checked' : ''} onchange="musicSetShuffle(this.checked)"> 随机播放</label>
        <label class="music-check"><input type="checkbox" ${s.muted ? 'checked' : ''} onchange="musicSetMuted(this.checked)"> 静音</label>
        <label class="music-check"><input type="checkbox" ${s.autoplayNext ? 'checked' : ''} onchange="musicSetAutoplayNext(this.checked)"> 自动下一首</label>
        <label class="music-check"><input type="checkbox" ${s.rememberPosition ? 'checked' : ''} onchange="musicSetRememberPosition(this.checked)"> 记住播放位置</label>
      </section>

      <section class="music-extra-settings">
        <div class="music-extra-head">
          <div class="music-extra-title">AI 音频提示</div>
          <button class="btn" onclick="refreshMusicLibrary(true)">刷新曲库</button>
        </div>
        <div class="music-extra-grid">
          <label class="music-check"><input type="checkbox" ${state.settings.completionSoundEnabled ? 'checked' : ''} onchange="musicSetCompletionEnabled(this.checked)"> AI 完成提示音</label>
          <label class="music-setting">提示音来源
            <select onchange="musicSetCompletionMode(this.value)">
              <option value="default" ${s.completionSoundMode !== 'music' ? 'selected' : ''}>默认提示音</option>
              <option value="music" ${s.completionSoundMode === 'music' ? 'selected' : ''}>music 文件夹曲目</option>
            </select>
          </label>
          <label class="music-setting">提示音曲目
            <select id="musicCompletionTrackSelect" onchange="musicSetCompletionTrack(this.value)">
              ${musicTrackOptions(s.completionTrackPath, '使用默认提示音')}
            </select>
          </label>
          <label class="music-check"><input type="checkbox" ${s.generationBgmEnabled ? 'checked' : ''} onchange="musicSetGenerationBgmEnabled(this.checked)"> AI 生成过程 BGM</label>
          <label class="music-setting">BGM 曲目
            <select id="musicBgmTrackSelect" onchange="musicSetGenerationBgmTrack(this.value)">
              ${musicTrackOptions(s.generationBgmTrackPath, '未选择 BGM')}
            </select>
          </label>
          <label class="music-setting">BGM 音量
            <input type="range" min="0" max="100" value="${Number(s.generationBgmVolume || 0)}" oninput="musicSetGenerationBgmVolume(this.value)">
          </label>
          <label class="music-check"><input type="checkbox" ${s.generationBgmLoop ? 'checked' : ''} onchange="musicSetGenerationBgmLoop(this.checked)"> BGM 循环播放</label>
          <button class="btn" onclick="musicPreviewCompletionSound()">试听提示音</button>
          <button class="btn" onclick="musicPreviewGenerationBgm()">试听 BGM</button>
        </div>
        <div class="form-hint">自定义完成提示音最多播放 3 秒；AI 生成开始时播放 BGM，完成、停止或报错后自动停止。</div>
      </section>

      <section class="music-library-panel">
        <div class="music-library-head">
          <div class="music-library-title-wrap">
            <div class="music-extra-title">music 文件夹音乐</div>
            <div class="music-library-summary" id="musicLibrarySummary">0 首</div>
          </div>
          <div class="music-library-tools">
            <input type="search" id="musicTrackSearch" value="${escapeHtml(musicPlayerState.listSearch)}" placeholder="搜索音乐" oninput="musicSetTrackSearch(this.value)">
            <button class="btn" id="musicCollapseBtn" onclick="musicToggleTrackList()">${s.listCollapsed ? '展开' : '折叠'}</button>
          </div>
        </div>
        <section class="music-list ${s.listCollapsed ? 'collapsed' : ''}" id="musicTrackList"></section>
      </section>
    </div>`;
  bindMusicAudio();
  renderMusicTrackList();
  applyMusicAudioSettings();
  if (current) loadMusicCurrent(false);
}

function bindMusicAudio() {
  const audio = musicAudio();
  if (!audio || audio._musicBound) return;
  audio._musicBound = true;
  audio.addEventListener('timeupdate', updateMusicTimeText);
  audio.addEventListener('loadedmetadata', updateMusicTimeText);
  audio.addEventListener('play', () => updateMusicStatus('播放中'));
  audio.addEventListener('pause', () => {
    musicPersistPosition(true);
    updateMusicStatus('已暂停');
  });
  audio.addEventListener('ended', () => {
    musicPersistPosition(true);
    if (musicPlayerState.settings.loopMode === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else if (musicPlayerState.settings.autoplayNext) {
      musicNextTrack(true);
    }
  });
}

function applyMusicAudioSettings() {
  const audio = musicAudio();
  if (!audio) return;
  const s = musicPlayerState.settings;
  audio.volume = Math.max(0, Math.min(1, Number(s.volume || 0) / 100));
  audio.muted = !!s.muted;
  audio.playbackRate = Number(s.playbackRate || 1);
}

async function refreshMusicLibrary(showToast) {
  const previousKey = musicTrackKey(musicCurrentTrack());
  const result = await musicBackend('list');
  if (!result || !result.ok) {
    updateMusicStatus(result && result.error ? result.error : '读取 music 文件夹失败');
    return;
  }
  const localTracks = musicPlayerState.tracks.filter(t => t.source === 'local');
  const libraryTracks = (result.tracks || []).map(t => ({
    ...t,
    source: 'library',
    sourceLabel: 'music 文件夹'
  }));
  musicPlayerState.libraryLoaded = true;
  musicPlayerState.tracks = [...libraryTracks, ...localTracks];
  const dir = document.getElementById('musicDirText');
  if (dir) dir.textContent = result.musicDir || 'music/';
  restoreMusicSelection(previousKey);
  renderMusicTrackList();
  const audio = musicAudio();
  const track = musicCurrentTrack();
  if (track) {
    const nextSrc = musicTrackUrl(track);
    if (!audio || audio.src !== nextSrc) loadMusicCurrent(false);
    else updateMusicNowDisplay();
  }
  if (showToast && typeof toast === 'function') toast('音乐库已刷新');
}

function restoreMusicSelection(preferredKey = '') {
  let idx = preferredKey
    ? musicPlayerState.tracks.findIndex(t => musicTrackKey(t) === preferredKey)
    : -1;
  const lastSource = musicPlayerState.settings.lastSource || '';
  const lastPath = musicPlayerState.settings.lastPath || '';
  if (idx < 0 && lastPath) {
    idx = musicPlayerState.tracks.findIndex(t => musicTrackMatchesSaved(t, lastSource, lastPath));
  }
  if (idx < 0 && lastPath && lastSource) {
    idx = musicPlayerState.tracks.findIndex(t => musicTrackMatchesSaved(t, '', lastPath));
  }
  if (idx < 0 && musicPlayerState.tracks.length) idx = 0;
  musicPlayerState.currentIndex = idx;
}

function musicVisibleTrackEntries() {
  const query = String(musicPlayerState.listSearch || '').trim().toLowerCase();
  return musicPlayerState.tracks
    .map((track, idx) => ({ track, idx }))
    .filter(item => {
      if (!query) return true;
      const haystack = [
        item.track.name,
        item.track.path,
        item.track.sourceLabel
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
}

function renderMusicTrackList() {
  const list = document.getElementById('musicTrackList');
  if (!list) return;
  const summary = document.getElementById('musicLibrarySummary');
  const collapseBtn = document.getElementById('musicCollapseBtn');
  const searchInput = document.getElementById('musicTrackSearch');
  const collapsed = !!musicPlayerState.settings.listCollapsed;
  const query = String(musicPlayerState.listSearch || '').trim().toLowerCase();
  const libraryCount = musicLibraryTracks().length;
  list.classList.toggle('collapsed', collapsed);
  if (collapseBtn) collapseBtn.textContent = collapsed ? '展开' : '折叠';
  if (searchInput && searchInput.value !== musicPlayerState.listSearch) searchInput.value = musicPlayerState.listSearch;
  if (!musicPlayerState.tracks.length) {
    if (summary) summary.textContent = '0 首';
    list.innerHTML = '<div class="music-empty">music 文件夹中还没有音乐。可以导入到 music 文件夹，或直接打开本机音乐。</div>';
    updateMusicStatus('0 首');
    updateMusicAudioOptionSelects();
    return;
  }
  const visibleTracks = musicVisibleTrackEntries();
  if (summary) {
    const localCount = musicPlayerState.tracks.length - libraryCount;
    const totalText = localCount > 0 ? `${libraryCount} 首 music · ${localCount} 首本机` : `${libraryCount} 首`;
    summary.textContent = query
      ? `${visibleTracks.length}/${musicPlayerState.tracks.length} 首匹配`
      : totalText;
  }
  if (!visibleTracks.length) {
    list.innerHTML = '<div class="music-empty">没有匹配的音乐</div>';
    updateMusicStatus(`0/${musicPlayerState.tracks.length} 首`);
    updateMusicAudioOptionSelects();
    return;
  }
  list.innerHTML = visibleTracks.map(({ track, idx }) => `
    <button class="music-track ${idx === musicPlayerState.currentIndex ? 'active' : ''}" onclick="musicPlayIndex(${idx})">
      <span class="music-track-name">${escapeHtml(musicTrackDisplayName(track) || '未知曲目')}</span>
      <span class="music-track-meta">${escapeHtml(track.sourceLabel || '')} · ${musicFormatSize(track.size)}</span>
    </button>
  `).join('');
  updateMusicStatus(`${musicPlayerState.tracks.length} 首`);
  updateMusicAudioOptionSelects();
}

function updateMusicAudioOptionSelects() {
  const completionSelect = document.getElementById('musicCompletionTrackSelect');
  if (completionSelect) completionSelect.innerHTML = musicTrackOptions(musicPlayerState.settings.completionTrackPath, '使用默认提示音');
  const bgmSelect = document.getElementById('musicBgmTrackSelect');
  if (bgmSelect) bgmSelect.innerHTML = musicTrackOptions(musicPlayerState.settings.generationBgmTrackPath, '未选择 BGM');
}

function loadMusicCurrent(autoplay) {
  const track = musicCurrentTrack();
  const audio = musicAudio();
  if (!track || !audio) return;
  const restoreSource = musicPlayerState.settings.lastSource || '';
  const restorePath = musicPlayerState.settings.lastPath || '';
  const restoreTime = Number(musicPlayerState.settings.lastTime || 0);
  const shouldRestoreTrack = musicTrackMatchesSaved(track, restoreSource, restorePath);
  updateMusicNowDisplay();
  audio.onloadedmetadata = () => {
    const shouldRestore = musicPlayerState.settings.rememberPosition
      && shouldRestoreTrack
      && restoreTime > 0
      && restoreTime < (audio.duration || 0) - 2;
    if (shouldRestore) audio.currentTime = restoreTime;
    updateMusicTimeText();
  };
  const nextSrc = musicTrackUrl(track);
  musicPlayerState.lastPersistSecond = -1;
  if (audio.src !== nextSrc) audio.src = nextSrc;
  else updateMusicTimeText();
  applyMusicAudioSettings();
  musicPlayerState.settings.lastSource = track.source || '';
  musicPlayerState.settings.lastPath = musicTrackPath(track);
  if (!shouldRestoreTrack) musicPlayerState.settings.lastTime = 0;
  saveMusicSettings();
  renderMusicTrackList();
  if (autoplay) audio.play().catch(() => updateMusicStatus('等待手动播放'));
}

function updateMusicNowDisplay() {
  const track = musicCurrentTrack();
  const title = document.getElementById('musicNowTitle');
  const sub = document.getElementById('musicNowSub');
  if (title) title.textContent = track ? (track.name || '未知曲目') : '未选择音乐';
  if (sub) sub.textContent = track ? (track.sourceLabel || '') : '从 music 文件夹或本机文件选择音频';
}

function musicPlayIndex(index) {
  if (!musicPlayerState.tracks[index]) return;
  musicPersistPosition(true);
  musicPlayerState.currentIndex = index;
  loadMusicCurrent(true);
}

function musicTogglePlay() {
  const audio = musicAudio();
  if (!audio) return;
  if (!audio.src) loadMusicCurrent(false);
  if (audio.paused) audio.play().catch(() => updateMusicStatus('浏览器阻止自动播放，请再点一次'));
  else audio.pause();
}

function musicNextTrack(auto = false) {
  if (!musicPlayerState.tracks.length) return;
  musicPersistPosition(true);
  if (musicPlayerState.settings.shuffle && musicPlayerState.tracks.length > 1) {
    let next = musicPlayerState.currentIndex;
    while (next === musicPlayerState.currentIndex) next = Math.floor(Math.random() * musicPlayerState.tracks.length);
    musicPlayerState.currentIndex = next;
  } else {
    const next = musicPlayerState.currentIndex + 1;
    if (next >= musicPlayerState.tracks.length) {
      if (musicPlayerState.settings.loopMode === 'none') {
        if (!auto) musicPlayerState.currentIndex = 0;
        else return;
      } else {
        musicPlayerState.currentIndex = 0;
      }
    } else {
      musicPlayerState.currentIndex = next;
    }
  }
  loadMusicCurrent(true);
}

function musicPrevTrack() {
  if (!musicPlayerState.tracks.length) return;
  musicPersistPosition(true);
  musicPlayerState.currentIndex = musicPlayerState.currentIndex <= 0
    ? musicPlayerState.tracks.length - 1
    : musicPlayerState.currentIndex - 1;
  loadMusicCurrent(true);
}

function updateMusicTimeText() {
  const audio = musicAudio();
  const el = document.getElementById('musicTimeText');
  if (!audio || !el) return;
  el.textContent = `${musicFormatTime(audio.currentTime)} / ${musicFormatTime(audio.duration)}`;
  const second = Math.floor(audio.currentTime || 0);
  if (second > 0 && second % 5 === 0) musicPersistPosition();
}

function updateMusicStatus(text) {
  const el = document.getElementById('musicStatusText');
  if (el) el.textContent = text || '';
}

function musicSetVolume(value) {
  musicPlayerState.settings.volume = Math.max(0, Math.min(100, Number(value || 0)));
  saveMusicSettings();
  applyMusicAudioSettings();
}

function musicSetPlaybackRate(value) {
  musicPlayerState.settings.playbackRate = Number(value || 1);
  saveMusicSettings();
  applyMusicAudioSettings();
}

function musicSetLoopMode(value) {
  musicPlayerState.settings.loopMode = ['list', 'one', 'none'].includes(value) ? value : 'list';
  saveMusicSettings();
}

function musicSetShuffle(value) {
  musicPlayerState.settings.shuffle = !!value;
  saveMusicSettings();
}

function musicSetMuted(value) {
  musicPlayerState.settings.muted = !!value;
  saveMusicSettings();
  applyMusicAudioSettings();
}

function musicSetAutoplayNext(value) {
  musicPlayerState.settings.autoplayNext = !!value;
  saveMusicSettings();
}

function musicSetRememberPosition(value) {
  musicPlayerState.settings.rememberPosition = !!value;
  saveMusicSettings();
}

function musicSetTrackSearch(value) {
  musicPlayerState.listSearch = String(value || '');
  renderMusicTrackList();
}

function musicToggleTrackList() {
  musicPlayerState.settings.listCollapsed = !musicPlayerState.settings.listCollapsed;
  saveMusicSettings();
  renderMusicTrackList();
}

function musicSetCompletionEnabled(value) {
  if (state && state.settings) {
    state.settings.completionSoundEnabled = !!value;
    if (typeof persistSettings === 'function') persistSettings();
  }
  if (value && typeof ensureCompletionSoundReady === 'function') ensureCompletionSoundReady();
}

function musicSetCompletionMode(value) {
  musicPlayerState.settings.completionSoundMode = value === 'music' ? 'music' : 'default';
  saveMusicSettings();
}

function musicSetCompletionTrack(value) {
  musicPlayerState.settings.completionTrackPath = String(value || '');
  if (musicPlayerState.settings.completionTrackPath) musicPlayerState.settings.completionSoundMode = 'music';
  saveMusicSettings();
  const modeSelect = document.querySelector('.music-extra-settings select[onchange="musicSetCompletionMode(this.value)"]');
  if (modeSelect) modeSelect.value = musicPlayerState.settings.completionSoundMode;
}

function musicSetGenerationBgmEnabled(value) {
  musicPlayerState.settings.generationBgmEnabled = !!value;
  saveMusicSettings();
  if (value && musicAnyGenerating()) startMusicGenerationBgm();
  else if (!value) stopMusicGenerationBgm();
}

function musicSetGenerationBgmTrack(value) {
  musicPlayerState.settings.generationBgmTrackPath = String(value || '');
  saveMusicSettings();
  if (musicPlayerState.bgmAudio || (musicPlayerState.settings.generationBgmEnabled && musicAnyGenerating())) {
    stopMusicGenerationBgm();
    startMusicGenerationBgm();
  }
}

function musicSetGenerationBgmVolume(value) {
  musicPlayerState.settings.generationBgmVolume = Math.max(0, Math.min(100, Number(value || 0)));
  saveMusicSettings();
  if (musicPlayerState.bgmAudio) {
    musicPlayerState.bgmAudio.volume = musicPlayerState.settings.generationBgmVolume / 100;
  }
}

function musicSetGenerationBgmLoop(value) {
  musicPlayerState.settings.generationBgmLoop = !!value;
  saveMusicSettings();
  if (musicPlayerState.bgmAudio) musicPlayerState.bgmAudio.loop = !!value;
}

function musicStopManagedAudio(audio, timerKey) {
  if (timerKey && musicPlayerState[timerKey]) {
    clearTimeout(musicPlayerState[timerKey]);
    musicPlayerState[timerKey] = null;
  }
  if (!audio) return;
  try { audio.pause(); } catch (e) {}
  try { audio.currentTime = 0; } catch (e) {}
}

function musicAnyGenerating() {
  if (typeof isAnyChatGenerating === 'function') return isAnyChatGenerating();
  return !!(state && state.isGenerating);
}

function playMusicCompletionSound() {
  loadMusicSettings();
  const s = musicPlayerState.settings;
  if (s.completionSoundMode !== 'music' || !s.completionTrackPath) return false;
  const track = musicTrackByPath(s.completionTrackPath);
  if (!track) return false;
  if (!musicHasBackendToken() && musicEnsureTokenThen(() => playMusicCompletionSound())) return true;
  musicStopManagedAudio(musicPlayerState.completionAudio, 'completionTimer');
  const audio = new Audio(musicTrackUrl(track));
  const rawVolume = parseInt(state.settings.completionSoundVolume);
  const volumePct = isNaN(rawVolume) ? 80 : Math.max(0, Math.min(100, rawVolume));
  audio.volume = volumePct / 100;
  audio.preload = 'auto';
  musicPlayerState.completionAudio = audio;
  musicPlayerState.completionTimer = setTimeout(() => {
    musicStopManagedAudio(musicPlayerState.completionAudio, 'completionTimer');
  }, MUSIC_COMPLETION_MAX_SECONDS * 1000);
  audio.play().catch(() => {});
  return true;
}

function startMusicGenerationBgm() {
  loadMusicSettings();
  const s = musicPlayerState.settings;
  if (!s.generationBgmEnabled || !s.generationBgmTrackPath) return false;
  const track = musicTrackByPath(s.generationBgmTrackPath);
  if (!track) return false;
  if (!musicHasBackendToken() && musicEnsureTokenThen(() => {
    const stillGenerating = typeof isAnyChatGenerating === 'function' ? isAnyChatGenerating() : !!(state && state.isGenerating);
    if (stillGenerating) startMusicGenerationBgm();
  })) return true;
  if (musicPlayerState.bgmAudio && musicPlayerState.bgmTrackPath === s.generationBgmTrackPath) {
    musicPlayerState.bgmAudio.loop = !!s.generationBgmLoop;
    musicPlayerState.bgmAudio.volume = Math.max(0, Math.min(1, Number(s.generationBgmVolume || 0) / 100));
    if (musicPlayerState.bgmAudio.paused) musicPlayerState.bgmAudio.play().catch(() => {});
    return true;
  }
  stopMusicGenerationBgm();
  const audio = new Audio(musicTrackUrl(track));
  audio.loop = !!s.generationBgmLoop;
  audio.volume = Math.max(0, Math.min(1, Number(s.generationBgmVolume || 0) / 100));
  audio.preload = 'auto';
  musicPlayerState.bgmAudio = audio;
  musicPlayerState.bgmTrackPath = s.generationBgmTrackPath;
  audio.play().catch(() => {});
  return true;
}

function playMusicGenerationBgmPreview() {
  loadMusicSettings();
  const s = musicPlayerState.settings;
  if (!s.generationBgmTrackPath) return false;
  const track = musicTrackByPath(s.generationBgmTrackPath);
  if (!track) return false;
  if (!musicHasBackendToken() && musicEnsureTokenThen(() => {
    if (musicPlayerState.previewBgmRequested) playMusicGenerationBgmPreview();
  })) return true;
  stopMusicGenerationBgm();
  const audio = new Audio(musicTrackUrl(track));
  audio.loop = !!s.generationBgmLoop;
  audio.volume = Math.max(0, Math.min(1, Number(s.generationBgmVolume || 0) / 100));
  audio.preload = 'auto';
  musicPlayerState.bgmAudio = audio;
  musicPlayerState.bgmTrackPath = s.generationBgmTrackPath;
  audio.play().catch(() => {});
  return true;
}

function stopMusicGenerationBgm() {
  musicStopManagedAudio(musicPlayerState.bgmAudio);
  musicPlayerState.bgmAudio = null;
  musicPlayerState.bgmTrackPath = '';
  musicPlayerState.previewBgmRequested = false;
}

function musicPreviewCompletionSound() {
  if (!playMusicCompletionSound() && typeof playDefaultCompletionSound === 'function') playDefaultCompletionSound();
}

function musicPreviewGenerationBgm() {
  if (musicPlayerState.bgmAudio && !musicPlayerState.bgmAudio.paused) {
    stopMusicGenerationBgm();
    return;
  }
  musicPlayerState.previewBgmRequested = true;
  if (!playMusicGenerationBgmPreview() && typeof toast === 'function') {
    musicPlayerState.previewBgmRequested = false;
    toast('请先从 music 文件夹选择 BGM 曲目');
  }
}

async function musicImportFiles(event) {
  const files = Array.from(event.target.files || []).filter(musicIsAudioFile);
  event.target.value = '';
  if (!files.length) {
    if (typeof toast === 'function') toast('没有可导入的音频文件');
    return;
  }
  updateMusicStatus(`正在导入 ${files.length} 首...`);
  let okCount = 0;
  for (const file of files) {
    const data = await musicReadFileAsDataUrl(file);
    const result = await musicBackend('import', { name: file.name, data });
    if (result && result.ok) okCount++;
    else console.warn('[music] import failed:', file.name, result && result.error);
  }
  await refreshMusicLibrary(false);
  if (typeof toast === 'function') toast(`已导入 ${okCount}/${files.length} 首到 music 文件夹`);
}

function musicReadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result || '');
    reader.onerror = () => reject(reader.error || new Error('读取失败'));
    reader.readAsDataURL(file);
  });
}

function musicOpenLocalFiles(event) {
  const files = Array.from(event.target.files || []).filter(musicIsAudioFile);
  const fromFolder = event.target && event.target.id === 'musicFolderInput';
  event.target.value = '';
  if (!files.length) {
    if (typeof toast === 'function') toast('没有可播放的音频文件');
    return;
  }
  musicPlayerState.objectUrls.forEach(url => URL.revokeObjectURL(url));
  musicPlayerState.objectUrls = [];
  const tracks = files.map(file => {
    const objectUrl = URL.createObjectURL(file);
    musicPlayerState.objectUrls.push(objectUrl);
    return {
      name: file.webkitRelativePath || file.name,
      path: file.webkitRelativePath || file.name,
      size: file.size,
      source: 'local',
      sourceLabel: fromFolder ? '本机文件夹' : '本机文件',
      objectUrl
    };
  });
  const libraryTracks = musicPlayerState.tracks.filter(t => t.source !== 'local');
  musicPlayerState.tracks = [...libraryTracks, ...tracks];
  musicPlayerState.currentIndex = libraryTracks.length;
  renderMusicTrackList();
  loadMusicCurrent(true);
}

window.openMusicPlayer = openMusicPlayer;
window.closeMusicPlayer = closeMusicPlayer;
window.refreshMusicLibrary = refreshMusicLibrary;
window.musicImportFiles = musicImportFiles;
window.musicOpenLocalFiles = musicOpenLocalFiles;
window.musicPlayIndex = musicPlayIndex;
window.musicTogglePlay = musicTogglePlay;
window.musicNextTrack = musicNextTrack;
window.musicPrevTrack = musicPrevTrack;
window.musicSetVolume = musicSetVolume;
window.musicSetPlaybackRate = musicSetPlaybackRate;
window.musicSetLoopMode = musicSetLoopMode;
window.musicSetShuffle = musicSetShuffle;
window.musicSetMuted = musicSetMuted;
window.musicSetAutoplayNext = musicSetAutoplayNext;
window.musicSetRememberPosition = musicSetRememberPosition;
window.musicSetTrackSearch = musicSetTrackSearch;
window.musicToggleTrackList = musicToggleTrackList;
window.musicSetCompletionEnabled = musicSetCompletionEnabled;
window.musicSetCompletionMode = musicSetCompletionMode;
window.musicSetCompletionTrack = musicSetCompletionTrack;
window.musicSetGenerationBgmEnabled = musicSetGenerationBgmEnabled;
window.musicSetGenerationBgmTrack = musicSetGenerationBgmTrack;
window.musicSetGenerationBgmVolume = musicSetGenerationBgmVolume;
window.musicSetGenerationBgmLoop = musicSetGenerationBgmLoop;
window.playMusicCompletionSound = playMusicCompletionSound;
window.startMusicGenerationBgm = startMusicGenerationBgm;
window.stopMusicGenerationBgm = stopMusicGenerationBgm;
window.musicPreviewCompletionSound = musicPreviewCompletionSound;
window.musicPreviewGenerationBgm = musicPreviewGenerationBgm;
