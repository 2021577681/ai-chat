// ============ Theme switching ============

const ThemeStateModule = window.AgentApp.require('state');
const ThemeUiService = window.AgentApp.require('uiService');
const themeState = ThemeStateModule.state;
const themePersistSettings = ThemeStateModule.persistSettings;

function toggleTheme() {
  themeState.settings.theme = themeState.settings.theme === 'dark' ? 'light' : 'dark';
  if (themeState.settings.theme !== 'dark') themeState.settings.coolMode = false;
  if (themeState.settings.securityMode && themeState.settings.theme !== 'dark') disableSecurityMode({ restore: true, persist: false });
  applyTheme();
  themePersistSettings();
}

function toggleCoolMode() {
  const enabled = !themeState.settings.coolMode;
  themeState.settings.coolMode = enabled;
  if (enabled) themeState.settings.theme = 'dark';
  if (enabled && themeState.settings.securityMode) disableSecurityMode({ restore: true, persist: false });
  applyTheme();
  themePersistSettings();
}

function toggleSecurityMode() {
  ensureSecurityModeSettings();
  if (themeState.settings.securityMode) disableSecurityMode({ restore: true, persist: true });
  else enableSecurityMode();
}

function enableSecurityMode() {
  ensureSecurityModeSettings();
  const privacy = typeof getPrivacyGuardSettings === 'function'
    ? getPrivacyGuardSettings()
    : (themeState.settings.privacyGuard || (themeState.settings.privacyGuard = {}));
  const shellAudit = typeof getShellAuditSettings === 'function'
    ? getShellAuditSettings()
    : (themeState.settings.shellAudit || (themeState.settings.shellAudit = {}));

  themeState.settings.securityModeSnapshot = {
    theme: themeState.settings.theme || 'light',
    coolMode: !!themeState.settings.coolMode,
    privacyEnabled: !!privacy.enabled,
    shellAuditEnabled: !!shellAudit.enabled
  };

  themeState.settings.securityMode = true;
  themeState.settings.theme = 'dark';
  themeState.settings.coolMode = false;
  enforceSecurityModeProtections();
  applyTheme();
  refreshSecurityModeDependentUi();
  themePersistSettings();
  ThemeUiService.toast('安全模式已开启：隐私模式和 Shell 审核已启用', 2200);
}

function disableSecurityMode(options = {}) {
  ensureSecurityModeSettings();
  const restore = options.restore !== false;
  const snap = themeState.settings.securityModeSnapshot || {};
  const privacy = typeof getPrivacyGuardSettings === 'function'
    ? getPrivacyGuardSettings()
    : (themeState.settings.privacyGuard || (themeState.settings.privacyGuard = {}));
  const shellAudit = typeof getShellAuditSettings === 'function'
    ? getShellAuditSettings()
    : (themeState.settings.shellAudit || (themeState.settings.shellAudit = {}));

  themeState.settings.securityMode = false;
  themeState.settings.securityModeSnapshot = null;
  if (restore) {
    themeState.settings.theme = snap.theme || 'light';
    themeState.settings.coolMode = !!snap.coolMode && themeState.settings.theme === 'dark';
    privacy.enabled = !!snap.privacyEnabled;
    shellAudit.enabled = !!snap.shellAuditEnabled;
  }
  applyTheme();
  refreshSecurityModeDependentUi();
  if (options.persist !== false) themePersistSettings();
  if (options.persist !== false) ThemeUiService.toast('安全模式已关闭，已恢复原设置', 1800);
}

function ensureSecurityModeSettings() {
  if (!themeState.settings) return;
  if (typeof themeState.settings.securityMode !== 'boolean') themeState.settings.securityMode = false;
  if (!themeState.settings.securityMode && themeState.settings.securityModeSnapshot) themeState.settings.securityModeSnapshot = null;
}

function enforceSecurityModeProtections() {
  if (!themeState.settings || !themeState.settings.securityMode) return;
  const privacy = typeof getPrivacyGuardSettings === 'function'
    ? getPrivacyGuardSettings()
    : (themeState.settings.privacyGuard || (themeState.settings.privacyGuard = {}));
  const shellAudit = typeof getShellAuditSettings === 'function'
    ? getShellAuditSettings()
    : (themeState.settings.shellAudit || (themeState.settings.shellAudit = {}));
  privacy.enabled = true;
  shellAudit.enabled = true;
}

function refreshSecurityModeDependentUi() {
  if (typeof updatePrivacyGuardButton === 'function') updatePrivacyGuardButton();
  if (typeof renderShellAuditSettings === 'function' && document.getElementById('shellAuditSettings')) renderShellAuditSettings();
  ThemeUiService.updateSendBtn();
}

function applyTheme() {
  if (!themeState.settings) return;
  ensureSecurityModeSettings();
  if (themeState.settings.securityMode) {
    themeState.settings.theme = 'dark';
    themeState.settings.coolMode = false;
    enforceSecurityModeProtections();
  }
  const coolMode = !!themeState.settings.coolMode && themeState.settings.theme === 'dark';
  themeState.settings.coolMode = coolMode;
  const securityMode = !!themeState.settings.securityMode && themeState.settings.theme === 'dark';

  document.documentElement.setAttribute('data-theme', themeState.settings.theme);
  document.documentElement.toggleAttribute('data-cool-mode', coolMode);
  document.documentElement.toggleAttribute('data-security-mode', securityMode);

  const btn = document.getElementById('themeBtn');
  if (btn) {
    btn.classList.toggle('active', themeState.settings.theme === 'dark');
    btn.setAttribute('aria-pressed', themeState.settings.theme === 'dark' ? 'true' : 'false');
    btn.title = themeState.settings.theme === 'dark' ? '黑暗模式已开启，点击切换到浅色' : '浅色模式已开启，点击切换到黑暗';
  }

  const coolBtn = document.getElementById('coolModeBtn');
  if (coolBtn) {
    coolBtn.classList.toggle('active', coolMode);
    coolBtn.setAttribute('aria-pressed', coolMode ? 'true' : 'false');
    coolBtn.title = coolMode ? '酷炫模式已开启，点击关闭' : '酷炫模式已关闭，点击开启';
  }

  const securityBtn = document.getElementById('securityModeBtn');
  if (securityBtn) {
    securityBtn.classList.toggle('active', securityMode);
    securityBtn.setAttribute('aria-pressed', securityMode ? 'true' : 'false');
    securityBtn.title = securityMode ? '安全模式已开启，点击关闭' : '安全模式已关闭，点击开启';
  }
}

window.toggleSecurityMode = toggleSecurityMode;
window.enforceSecurityModeProtections = enforceSecurityModeProtections;

window.AgentApp.define('theme', {
  toggleTheme,
  toggleCoolMode,
  toggleSecurityMode,
  enableSecurityMode,
  disableSecurityMode,
  ensureSecurityModeSettings,
  enforceSecurityModeProtections,
  refreshSecurityModeDependentUi,
  applyTheme
});
