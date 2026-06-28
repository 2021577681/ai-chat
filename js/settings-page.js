// ============ Unified settings page ============

const SETTINGS_PAGE_SECTIONS = {
  main: { open: 'openSettings', close: 'closeSettings', modalId: 'settingsModal' },
  plan: { open: 'openPlanSettings', close: 'closePlanSettings', modalId: 'planModal' },
  outline: { open: 'openOutlineSettings', close: 'closeOutlineSettings', modalId: 'outlineModal' },
  ppt: { open: 'openPptSettings', close: 'closePptSettings', modalId: 'pptSettingsModal' },
  reflection: { open: 'openReflectionSettings', close: 'closeReflectionSettings', modalId: 'reflectionModal' },
  tools: { open: 'openTools', close: 'closeTools', modalId: 'toolsModal' },
  privacy: { open: 'openPrivacySettings', close: 'closePrivacySettings', modalId: 'privacyModal' },
  securityRecords: { open: 'openSecurityRecords', close: 'closeSecurityRecords', modalId: 'securityRecordsModal' },
  taskQueue: { open: 'openTaskQueue', close: 'closeTaskQueue', modalId: 'taskQueueModal' },
  concurrentRequests: { open: 'openConcurrentRequests', close: 'closeConcurrentRequests', modalId: 'concurrentRequestsModal' },
  debateMode: { open: 'openDebateMode', close: 'closeDebateMode', modalId: 'debateModeModal' },
  music: { open: 'openMusicPlayer', close: 'closeMusicPlayer', modalId: 'musicModal' },
  mcpSkill: { open: 'openMcpSkillSettings', close: 'closeMcpSkillSettings', modalId: 'mcpSkillModal' },
  projectInstructions: { open: 'openProjectInstructionsSettings', close: 'closeProjectInstructionsSettings', modalId: 'projectInstructionsModal' },
  projectMemory: { open: 'openProjectMemorySettings', close: 'closeProjectMemorySettings', modalId: 'projectMemoryModal' },
  jsonEditor: { open: 'openJsonEditor', close: 'closeJsonEditor', modalId: 'jsonEditorModal' },
  dialogManager: { open: 'openDialogManager', close: 'closeDialogManager', modalId: 'dialogManagerModal' },
  backup: { open: 'openBackup', close: 'closeBackup', modalId: 'backupModal' },
  permissions: { open: 'openPermissions', close: 'closePermissions', modalId: 'permissionsModal' },
  pricing: { open: 'openPricingManager', close: 'closePricingManager', modalId: 'pricingModal' },
  tokenUsage: { open: 'openTokenUsageStats', close: 'closeTokenUsageStats', modalId: 'tokenUsageModal' },
  contextLimit: { open: 'openContextLimitSettings', close: 'closeContextLimitSettings', modalId: 'contextLimitModal' },
  git: { open: 'openGitPanel', close: 'closeGitPanel', modalId: 'gitModal' }
};

const SETTINGS_PAGE_STATE = {
  ready: false,
  activeSection: null,
  dockedModal: null,
  dockedMask: null,
  dockedSectionClass: null,
  originalParent: null,
  originalNext: null,
  originalMask: null,
  originalCloseHandlers: new Map(),
  dockingDepth: 0,
  openRequestId: 0,
  originals: {}
};

function initSettingsPage() {
  if (SETTINGS_PAGE_STATE.ready) return;
  SETTINGS_PAGE_STATE.ready = true;

  [
    'openSettings',
    'openPlanSettings',
    'openOutlineSettings',
    'openPptSettings',
    'openReflectionSettings',
    'openTools',
    'openPrivacySettings',
    'openSecurityRecords',
    'openTaskQueue',
    'openConcurrentRequests',
    'openDebateMode',
    'openMusicPlayer',
    'openMcpSkillSettings',
    'openProjectInstructionsSettings',
    'openProjectMemorySettings',
    'openJsonEditor',
    'openDialogManager',
    'openBackup',
    'openPermissions',
    'openPricingManager',
    'openTokenUsageStats',
    'openContextLimitSettings',
    'openGitPanel',
    'closeSettings',
    'closePlanSettings',
    'closeOutlineSettings',
    'closePptSettings',
    'closeReflectionSettings',
    'closeTools',
    'closePrivacySettings',
    'closeSecurityRecords',
    'closeTaskQueue',
    'closeConcurrentRequests',
    'closeDebateMode',
    'closeMusicPlayer',
    'closeMcpSkillSettings',
    'closeProjectInstructionsSettings',
    'closeProjectMemorySettings',
    'closeJsonEditor',
    'closeDialogManager',
    'closeBackup',
    'closePermissions',
    'closePricingManager',
    'closeTokenUsageStats',
    'closeContextLimitSettings',
    'closeGitPanel'
  ].forEach(name => {
    if (typeof window[name] === 'function') SETTINGS_PAGE_STATE.originals[name] = window[name];
  });

  window.openSettings = function() { openSettingsPage('main'); };
  window.openPlanSettings = function() { openSettingsPage('plan'); };
  window.openOutlineSettings = function() { openSettingsPage('outline'); };
  window.openPptSettings = function() { openSettingsPage('ppt'); };
  window.openReflectionSettings = function() { openSettingsPage('reflection'); };
  window.openTools = function() { openSettingsPage('tools'); };
  window.openPrivacySettings = function() { openSettingsPage('privacy'); };
  window.openSecurityRecords = function() { openSettingsPage('securityRecords'); };
  window.openTaskQueue = function() { openSettingsPage('taskQueue'); };
  window.openConcurrentRequests = function() { openSettingsPage('concurrentRequests'); };
  window.openDebateMode = function() { openSettingsPage('debateMode'); };
  window.openMusicPlayer = function() { openSettingsPage('music'); };
  window.openMcpSkillSettings = function() { openSettingsPage('mcpSkill'); };
  window.openProjectInstructionsSettings = function() { openSettingsPage('projectInstructions'); };
  window.openProjectMemorySettings = function() { openSettingsPage('projectMemory'); };
  window.openJsonEditor = function() { openSettingsPage('jsonEditor'); };
  window.openDialogManager = function() { openSettingsPage('dialogManager'); };
  window.openBackup = function() { openSettingsPage('backup'); };
  window.openPermissions = function() { openSettingsPage('permissions'); };
  window.openPricingManager = function() { openSettingsPage('pricing'); };
  window.openTokenUsageStats = function() { openSettingsPage('tokenUsage'); };
  window.openContextLimitSettings = function() { openSettingsPage('contextLimit'); };
  window.openGitPanel = function() { openSettingsPage('git'); };

  window.closeSettings = function() { closeSettingsProxy('main'); };
  window.closePlanSettings = function() { closeSettingsProxy('plan'); };
  window.closeOutlineSettings = function() { closeSettingsProxy('outline'); };
  window.closePptSettings = function() { closeSettingsProxy('ppt'); };
  window.closeReflectionSettings = function() { closeSettingsProxy('reflection'); };
  window.closeTools = function() { closeSettingsProxy('tools'); };
  window.closePrivacySettings = function() { closeSettingsProxy('privacy'); };
  window.closeSecurityRecords = function() { closeSettingsProxy('securityRecords'); };
  window.closeTaskQueue = function() { closeSettingsProxy('taskQueue'); };
  window.closeConcurrentRequests = function() { closeSettingsProxy('concurrentRequests'); };
  window.closeDebateMode = function() { closeSettingsProxy('debateMode'); };
  window.closeMusicPlayer = function() { closeSettingsProxy('music'); };
  window.closeMcpSkillSettings = function() { closeSettingsProxy('mcpSkill'); };
  window.closeProjectInstructionsSettings = function() { closeSettingsProxy('projectInstructions'); };
  window.closeProjectMemorySettings = function() { closeSettingsProxy('projectMemory'); };
  window.closeJsonEditor = function() { closeSettingsProxy('jsonEditor'); };
  window.closeDialogManager = function() { closeSettingsProxy('dialogManager'); };
  window.closeBackup = function() { closeSettingsProxy('backup'); };
  window.closePermissions = function() { closeSettingsProxy('permissions'); };
  window.closePricingManager = function() { closeSettingsProxy('pricing'); };
  window.closeTokenUsageStats = function() { closeSettingsProxy('tokenUsage'); };
  window.closeContextLimitSettings = function() { closeSettingsProxy('contextLimit'); };
  window.closeGitPanel = function() { closeSettingsProxy('git'); };

  window.openSettingsPage = openSettingsPage;
  window.openSettingsSection = openSettingsSection;
  window.closeSettingsPage = closeSettingsPage;

  const page = document.getElementById('settingsPage');
  if (page) {
    page.addEventListener('click', event => {
      if (event.target === page) closeSettingsPage();
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const shownModal = document.querySelector('.modal-mask.show,.img-preview-mask.show,.term-confirm-mask.show');
    if (shownModal) return;
    const pageEl = document.getElementById('settingsPage');
    if (pageEl && pageEl.classList.contains('show')) closeSettingsPage();
  });

  sortSettingsNav();
}

function recordSettingsNavAccess(section) {
  if (!state.settings) state.settings = {};
  if (!state.settings.settingsNavAccessTimes) state.settings.settingsNavAccessTimes = {};
  state.settings.settingsNavAccessTimes[section] = Date.now();
  if (typeof persistSettings === 'function') persistSettings();
}

function sortSettingsNav() {
  const nav = document.querySelector('.settings-page-nav');
  if (!nav) return;
  const items = Array.from(nav.querySelectorAll('.settings-nav-item'));
  if (!items.length) return;

  const accessTimes = (state.settings && state.settings.settingsNavAccessTimes) || {};

  // Remember original HTML order for items never accessed
  const defaultOrder = new Map();
  items.forEach((item, i) => {
    defaultOrder.set(item.dataset.settingsSection, i);
  });

  items.sort((a, b) => {
    const aSection = a.dataset.settingsSection;
    const bSection = b.dataset.settingsSection;
    const aTime = accessTimes[aSection];
    const bTime = accessTimes[bSection];

    if (aSection === 'main') return -1;                  // 主设置永远在第一位
    if (bSection === 'main') return 1;
    if (aTime && bTime) return bTime - aTime;            // both accessed → most recent first
    if (aTime && !bTime) return -1;                       // a accessed, b not → a first
    if (!aTime && bTime) return 1;                        // b accessed, a not → b first
    return (defaultOrder.get(aSection) || 0) - (defaultOrder.get(bSection) || 0); // neither → original order
  });

  items.forEach(item => nav.appendChild(item));
}

async function openSettingsPage(section = 'main') {
  initSettingsPage();
  const page = document.getElementById('settingsPage');
  if (!page) return;
  document.body.classList.add('settings-page-open');
  page.classList.add('show');
  page.setAttribute('aria-hidden', 'false');
  await openSettingsSection(section);
}

async function openSettingsSection(section = 'main') {
  initSettingsPage();
  const requestId = ++SETTINGS_PAGE_STATE.openRequestId;
  const config = SETTINGS_PAGE_SECTIONS[section] || SETTINGS_PAGE_SECTIONS.main;
  const page = document.getElementById('settingsPage');
  const content = document.getElementById('settingsPageContent');
  const heading = document.getElementById('settingsPageHeading');
  const desc = document.getElementById('settingsPageDesc');
  if (!page || !content) return;

  page.classList.add('show');
  page.setAttribute('aria-hidden', 'false');
  closeDockedSection();
  SETTINGS_PAGE_STATE.activeSection = section;
  recordSettingsNavAccess(section);
  sortSettingsNav();

  let activeItem = null;
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    const isActive = item.dataset.settingsSection === section;
    item.classList.toggle('active', isActive);
    if (isActive) activeItem = item;
  });

  if (heading) heading.textContent = getSettingsNavTitle(activeItem, section);
  if (desc) desc.textContent = activeItem?.dataset.desc || '';

  content.innerHTML = '<div class="settings-page-loading">Loading...</div>';
  pruneBrokenSettingsModal(config.modalId);

  const openFn = SETTINGS_PAGE_STATE.originals[config.open];
  if (typeof openFn !== 'function') {
    content.innerHTML = '<div class="settings-page-empty">This settings section is unavailable.</div>';
    return;
  }

  try {
    beginSettingsDocking();
    await openFn();
  } catch (error) {
    if (isSettingsOpenRequestCurrent(requestId, section)) {
      content.innerHTML = '<div class="settings-page-empty">Failed to open this settings section.</div>';
    }
    console.warn('[settings-page] open failed', error);
    return;
  } finally {
    endSettingsDocking();
  }

  if (!isSettingsOpenRequestCurrent(requestId, section)) return;

  const mask = document.getElementById(config.modalId);
  const modal = mask ? mask.querySelector('.modal') : null;
  if (!mask || !modal) {
    content.innerHTML = '<div class="settings-page-empty">No settings content was found.</div>';
    return;
  }

  dockSettingsPanel(mask, modal, section, config);
}

function isSettingsOpenRequestCurrent(requestId, section) {
  const page = document.getElementById('settingsPage');
  return SETTINGS_PAGE_STATE.openRequestId === requestId
    && SETTINGS_PAGE_STATE.activeSection === section
    && !!page
    && page.classList.contains('show');
}

function pruneBrokenSettingsModal(modalId) {
  if (!modalId) return;
  const mask = document.getElementById(modalId);
  if (mask && !mask.querySelector('.modal')) {
    mask.remove();
  }
}

function getSettingsNavTitle(item, fallback) {
  if (!item) return fallback;
  const spans = item.querySelectorAll('span');
  return (spans[1]?.textContent || item.textContent || fallback).trim();
}

function dockSettingsPanel(mask, modal, section, config) {
  const content = document.getElementById('settingsPageContent');
  if (!content) return;

  SETTINGS_PAGE_STATE.dockedMask = mask;
  SETTINGS_PAGE_STATE.dockedModal = modal;
  SETTINGS_PAGE_STATE.originalParent = modal.parentNode;
  SETTINGS_PAGE_STATE.originalNext = modal.nextSibling;
  SETTINGS_PAGE_STATE.originalMask = mask;

  mask.classList.remove('show');
  mask.classList.add('settings-docked-mask');
  const sectionClass = 'settings-section-' + section;
  SETTINGS_PAGE_STATE.dockedSectionClass = sectionClass;
  modal.classList.add('settings-docked-panel', sectionClass);

  const closeBtn = modal.querySelector(':scope > h2 .modal-close');
  if (closeBtn && !SETTINGS_PAGE_STATE.originalCloseHandlers.has(closeBtn)) {
    SETTINGS_PAGE_STATE.originalCloseHandlers.set(closeBtn, closeBtn.getAttribute('onclick'));
  }
  if (closeBtn) closeBtn.setAttribute('onclick', 'closeSettingsPage()');

  content.innerHTML = '';
  ensureSettingsFooterSpacer(modal);
  content.appendChild(modal);
  if (typeof initSettingsSelectSkins === 'function') initSettingsSelectSkins(modal);
  content.scrollTop = 0;

  if (config.focusId) focusSettingsTarget(config.focusId);
}

function ensureSettingsFooterSpacer(modal) {
  if (!modal) return;
  modal.querySelectorAll(':scope > .settings-footer-spacer').forEach(el => el.remove());
  const footers = Array.from(modal.querySelectorAll(':scope > .modal-footer:not(.backup-export-actions)'));
  const footer = footers[footers.length - 1];
  if (!footer) return;
  const spacer = document.createElement('div');
  spacer.className = 'settings-footer-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  modal.insertBefore(spacer, footer);
}

function beginSettingsDocking() {
  SETTINGS_PAGE_STATE.dockingDepth += 1;
  window.__SETTINGS_PAGE_DOCKING__ = true;
}

function endSettingsDocking() {
  SETTINGS_PAGE_STATE.dockingDepth = Math.max(0, SETTINGS_PAGE_STATE.dockingDepth - 1);
  if (SETTINGS_PAGE_STATE.dockingDepth === 0) window.__SETTINGS_PAGE_DOCKING__ = false;
}

function focusSettingsTarget(focusId) {
  const content = document.getElementById('settingsPageContent');
  if (!content) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = document.getElementById(focusId);
      if (!target || !content.contains(target)) return;

      const contentRect = content.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetTop = targetRect.top - contentRect.top + content.scrollTop;
      const centeredTop = targetTop - Math.max(24, (content.clientHeight - target.offsetHeight) / 2);

      content.scrollTo({ top: Math.max(0, centeredTop), behavior: 'smooth' });
      target.classList.add('settings-focus');
      setTimeout(() => target.classList.remove('settings-focus'), 1800);
    });
  });
}

function undockSettingsPanel() {
  const state = SETTINGS_PAGE_STATE;
  if (!state.dockedModal || !state.originalParent) return;

  const closeBtn = state.dockedModal.querySelector(':scope > h2 .modal-close');
  if (closeBtn && state.originalCloseHandlers.has(closeBtn)) {
    const old = state.originalCloseHandlers.get(closeBtn);
    if (old === null) closeBtn.removeAttribute('onclick');
    else closeBtn.setAttribute('onclick', old);
  }

  state.dockedModal.classList.remove('settings-docked-panel');
  if (state.dockedSectionClass) state.dockedModal.classList.remove(state.dockedSectionClass);
  state.dockedModal.querySelectorAll(':scope > .settings-footer-spacer').forEach(el => el.remove());

  if (state.originalNext && state.originalNext.parentNode === state.originalParent) {
    state.originalParent.insertBefore(state.dockedModal, state.originalNext);
  } else {
    state.originalParent.appendChild(state.dockedModal);
  }

  if (state.originalMask) state.originalMask.classList.remove('settings-docked-mask');

  state.dockedModal = null;
  state.dockedMask = null;
  state.originalParent = null;
  state.originalNext = null;
  state.originalMask = null;
  state.dockedSectionClass = null;
}

function closeDockedSection() {
  const active = SETTINGS_PAGE_STATE.activeSection;
  const config = SETTINGS_PAGE_SECTIONS[active];
  const closeFn = config ? SETTINGS_PAGE_STATE.originals[config.close] : null;
  undockSettingsPanel();
  if (typeof closeFn === 'function') {
    try { closeFn(); } catch (error) { console.warn('[settings-page] close failed', error); }
  }
}

function closeSettingsProxy(section) {
  const page = document.getElementById('settingsPage');
  const isPageOpen = !!page && page.classList.contains('show');
  const active = SETTINGS_PAGE_STATE.activeSection;
  if (isPageOpen && (!section || active === section)) {
    closeSettingsPage();
    return;
  }
  const config = SETTINGS_PAGE_SECTIONS[section];
  const closeFn = config ? SETTINGS_PAGE_STATE.originals[config.close] : null;
  if (typeof closeFn === 'function') closeFn();
}

function closeSettingsPage() {
  SETTINGS_PAGE_STATE.openRequestId += 1;
  closeDockedSection();

  const content = document.getElementById('settingsPageContent');
  if (content) content.innerHTML = '';
  const page = document.getElementById('settingsPage');
  if (page) {
    page.classList.remove('show');
    page.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('settings-page-open');
  SETTINGS_PAGE_STATE.activeSection = null;
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initSettingsPage);
} else {
  initSettingsPage();
}
