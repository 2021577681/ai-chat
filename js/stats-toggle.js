// ============ Token / Rate stats bar toggle ============

const STATS_BAR_COLLAPSED_KEY = 'aichat_stats_bar_collapsed_v1';

function applyStatsBarCollapsed(collapsed) {
  const bar = document.getElementById('statsBar');
  const btn = document.getElementById('statsToggleBtn');
  if (bar) bar.classList.toggle('collapsed', !!collapsed);
  if (btn) {
    btn.classList.toggle('collapsed', !!collapsed);
    btn.textContent = collapsed ? '统计' : '统计';
    btn.title = collapsed ? '展开 Token / 请求速度统计栏' : '收起 Token / 请求速度统计栏';
    btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
  }
}

function loadStatsBarCollapsed() {
  try {
    if (typeof storage !== 'undefined' && storage.get) {
      return storage.get(STATS_BAR_COLLAPSED_KEY) === '1';
    }
    return localStorage.getItem(STATS_BAR_COLLAPSED_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function saveStatsBarCollapsed(collapsed) {
  try {
    if (typeof storage !== 'undefined' && storage.set) storage.set(STATS_BAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    else localStorage.setItem(STATS_BAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch (_) {}
}

function initStatsBarToggle() {
  applyStatsBarCollapsed(loadStatsBarCollapsed());
}

function toggleStatsBar() {
  const bar = document.getElementById('statsBar');
  const collapsed = !(bar && bar.classList.contains('collapsed'));
  applyStatsBarCollapsed(collapsed);
  saveStatsBarCollapsed(collapsed);
}

window.initStatsBarToggle = initStatsBarToggle;
window.toggleStatsBar = toggleStatsBar;
