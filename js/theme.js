// ============ Theme switching ============

function toggleTheme() {
  state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
  if (state.settings.theme !== 'dark') state.settings.coolMode = false;
  applyTheme();
  persistSettings();
}

function toggleCoolMode() {
  const enabled = !state.settings.coolMode;
  state.settings.coolMode = enabled;
  if (enabled) state.settings.theme = 'dark';
  applyTheme();
  persistSettings();
}

function applyTheme() {
  if (!state.settings) return;
  const coolMode = !!state.settings.coolMode && state.settings.theme === 'dark';
  state.settings.coolMode = coolMode;

  document.documentElement.setAttribute('data-theme', state.settings.theme);
  document.documentElement.toggleAttribute('data-cool-mode', coolMode);

  const btn = document.getElementById('themeBtn');
  if (btn) {
    btn.textContent = state.settings.theme === 'dark' ? '☀' : '🌙';
    btn.setAttribute('aria-pressed', state.settings.theme === 'dark' ? 'true' : 'false');
  }

  const coolBtn = document.getElementById('coolModeBtn');
  if (coolBtn) {
    coolBtn.textContent = coolMode ? '◉' : '◎';
    coolBtn.classList.toggle('active', coolMode);
    coolBtn.setAttribute('aria-pressed', coolMode ? 'true' : 'false');
  }
}
