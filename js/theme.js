// ============ Theme switching ============

function toggleTheme() {
  state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
  if (state.settings.theme !== 'dark') state.settings.coolMode = false;
  if (state.settings.securityMode && state.settings.theme !== 'dark') disableSecurityMode({ restore: true, persist: false });
  applyTheme();
  persistSettings();
}

function toggleCoolMode() {
  const enabled = !state.settings.coolMode;
  state.settings.coolMode = enabled;
  if (enabled) state.settings.theme = 'dark';
  if (enabled && state.settings.securityMode) disableSecurityMode({ restore: true, persist: false });
  applyTheme();
  persistSettings();
}

function toggleSecurityMode() {
  ensureSecurityModeSettings();
  if (state.settings.securityMode) disableSecurityMode({ restore: true, persist: true });
  else enableSecurityMode();
}

function enableSecurityMode() {
  ensureSecurityModeSettings();
  const privacy = typeof getPrivacyGuardSettings === 'function'
    ? getPrivacyGuardSettings()
    : (state.settings.privacyGuard || (state.settings.privacyGuard = {}));
  const shellAudit = typeof getShellAuditSettings === 'function'
    ? getShellAuditSettings()
    : (state.settings.shellAudit || (state.settings.shellAudit = {}));

  state.settings.securityModeSnapshot = {
    theme: state.settings.theme || 'light',
    coolMode: !!state.settings.coolMode,
    privacyEnabled: !!privacy.enabled,
    shellAuditEnabled: !!shellAudit.enabled
  };

  state.settings.securityMode = true;
  state.settings.theme = 'dark';
  state.settings.coolMode = false;
  enforceSecurityModeProtections();
  applyTheme();
  refreshSecurityModeDependentUi();
  persistSettings();
  if (typeof toast === 'function') toast('安全模式已开启：隐私模式和 Shell 审核已启用', 2200);
}

function disableSecurityMode(options = {}) {
  ensureSecurityModeSettings();
  const restore = options.restore !== false;
  const snap = state.settings.securityModeSnapshot || {};
  const privacy = typeof getPrivacyGuardSettings === 'function'
    ? getPrivacyGuardSettings()
    : (state.settings.privacyGuard || (state.settings.privacyGuard = {}));
  const shellAudit = typeof getShellAuditSettings === 'function'
    ? getShellAuditSettings()
    : (state.settings.shellAudit || (state.settings.shellAudit = {}));

  state.settings.securityMode = false;
  state.settings.securityModeSnapshot = null;
  if (restore) {
    state.settings.theme = snap.theme || 'light';
    state.settings.coolMode = !!snap.coolMode && state.settings.theme === 'dark';
    privacy.enabled = !!snap.privacyEnabled;
    shellAudit.enabled = !!snap.shellAuditEnabled;
  }
  applyTheme();
  refreshSecurityModeDependentUi();
  if (options.persist !== false) persistSettings();
  if (options.persist !== false && typeof toast === 'function') toast('安全模式已关闭，已恢复原设置', 1800);
}

function ensureSecurityModeSettings() {
  if (!state.settings) return;
  if (typeof state.settings.securityMode !== 'boolean') state.settings.securityMode = false;
  if (!state.settings.securityMode && state.settings.securityModeSnapshot) state.settings.securityModeSnapshot = null;
}

function enforceSecurityModeProtections() {
  if (!state.settings || !state.settings.securityMode) return;
  const privacy = typeof getPrivacyGuardSettings === 'function'
    ? getPrivacyGuardSettings()
    : (state.settings.privacyGuard || (state.settings.privacyGuard = {}));
  const shellAudit = typeof getShellAuditSettings === 'function'
    ? getShellAuditSettings()
    : (state.settings.shellAudit || (state.settings.shellAudit = {}));
  privacy.enabled = true;
  shellAudit.enabled = true;
}

function refreshSecurityModeDependentUi() {
  if (typeof updatePrivacyGuardButton === 'function') updatePrivacyGuardButton();
  if (typeof renderShellAuditSettings === 'function' && document.getElementById('shellAuditSettings')) renderShellAuditSettings();
  if (typeof updateSendBtn === 'function') updateSendBtn();
}

function applyTheme() {
  if (!state.settings) return;
  ensureSecurityModeSettings();
  if (state.settings.securityMode) {
    state.settings.theme = 'dark';
    state.settings.coolMode = false;
    enforceSecurityModeProtections();
  }
  const coolMode = !!state.settings.coolMode && state.settings.theme === 'dark';
  state.settings.coolMode = coolMode;
  const securityMode = !!state.settings.securityMode && state.settings.theme === 'dark';

  document.documentElement.setAttribute('data-theme', state.settings.theme);
  document.documentElement.toggleAttribute('data-cool-mode', coolMode);
  document.documentElement.toggleAttribute('data-security-mode', securityMode);

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

  const securityBtn = document.getElementById('securityModeBtn');
  if (securityBtn) {
    securityBtn.textContent = securityMode ? '◆' : '◇';
    securityBtn.classList.toggle('active', securityMode);
    securityBtn.setAttribute('aria-pressed', securityMode ? 'true' : 'false');
  }
}

window.toggleSecurityMode = toggleSecurityMode;
window.enforceSecurityModeProtections = enforceSecurityModeProtections;
