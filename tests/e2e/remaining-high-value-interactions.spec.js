const { test, expect } = require('@playwright/test');
const {
  configureMockProvider,
  gotoApp,
  sendMessage,
  waitForAssistantReply,
  waitForGenerating,
  closeSettingsPageIfOpen
} = require('./helpers');

async function openSettingsSection(page, section) {
  const settingsPage = page.locator('#settingsPage');
  if (!(await settingsPage.evaluate(el => el.classList.contains('show')).catch(() => false))) {
    await page.locator('button[data-action="openSettings"]').first().click();
    await expect(settingsPage).toHaveClass(/show/);
  }
  await page.locator(`.settings-nav-item[data-settings-section="${section}"]`).click();
  await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
}

async function setCheckbox(page, selector, checked) {
  await page.locator(selector).evaluate((el, value) => {
    el.checked = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, checked);
}

async function allowTerminalActionIfShown(page) {
  const mask = page.locator('#termConfirmMask');
  await expect(mask).toHaveClass(/show/, { timeout: 2000 }).catch(() => {});
  if (await mask.evaluate(el => el.classList.contains('show')).catch(() => false)) {
    await page.locator('[data-action="termConfirmAccept"]').evaluate(btn => {
      btn.disabled = false;
      const countdown = document.getElementById('termCountdown');
      if (countdown) countdown.textContent = '';
    });
    await page.locator('[data-action="termConfirmAccept"]').click();
  }
}

async function terminalConfirmResult(page, clickAction) {
  const resultPromise = page.evaluate(() => window.termAskConfirm(
    'E2E terminal confirmation',
    'C:\\e2e-workspace',
    'echo e2e',
    'execute',
    {}
  ));
  await expect(page.locator('#termConfirmMask')).toHaveClass(/show/);
  if (clickAction === 'termConfirmAccept') {
    await page.locator('[data-action="termConfirmAccept"]').evaluate(btn => {
      btn.disabled = false;
      const countdown = document.getElementById('termCountdown');
      if (countdown) countdown.textContent = '';
    });
  }
  await page.locator(`[data-action="${clickAction}"]`).click();
  await expect(page.locator('#termConfirmMask')).not.toHaveClass(/show/);
  return resultPromise;
}

test.describe('remaining high-value interactions without real services', () => {
  test('remote connection, directory picker, workspace refresh, and terminal launcher use the mocked backend', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await page.locator('[data-action="refreshWorkspaceInfo"]').click();
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'workspace_info')).toBe(false);
    await expect(page.locator('#workspacePath')).not.toHaveText('');

    await page.locator('[data-action="openWorkspaceTerminal"]').click();
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'open_terminal')).toBe(true);

    await page.locator('[data-action="openRemoteConnection"]').click();
    await expect(page.locator('#remoteConnectionModal')).toHaveClass(/show/);
    await page.fill('#remoteSshCommand', 'ssh e2e@example.test');
    await page.fill('#remotePassword', 'not-a-real-password');
    await page.fill('#remoteWorkspace', '~/project');
    await page.fill('#remoteLocalPort', '18765');

    await page.locator('[data-action="saveRemoteConnectionFromUi"]').click();
    await expect.poll(() => page.evaluate(() => {
      const raw = storage.get('snake_remote_connection_v1') || '{}';
      return JSON.parse(raw).remoteWorkspace;
    })).toBe('~/project');

    await page.locator('[data-action="openRemoteDirPicker"]').click();
    await expect(page.locator('#remoteDirPicker')).toHaveClass(/show/);
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'remote_list_dirs')).toBe(true);
    await expect(page.locator('#remoteDirList .remote-dir-item')).toHaveCount(2);

    await page.locator('[data-action="remoteDirGoHome"]').click();
    await expect(page.locator('#remoteDirPicker')).toHaveClass(/show/);
    await page.locator('[data-action="remoteDirGoParent"]').click();
    await page.locator('[data-action="refreshRemoteDirPicker"]').click();
    await page.locator('[data-action="selectRemoteDirCurrent"]').click();
    await expect(page.locator('#remoteDirPicker')).not.toHaveClass(/show/);
    await expect(page.locator('#remoteWorkspace')).not.toHaveValue('');

    await page.locator('[data-action="connectRemoteAgent"]').click();
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'remote_connect'), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => TERMINAL_CONFIG.serverUrl)).toContain('18765');

    await page.locator('[data-action="disconnectRemoteAgent"]').click();
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'remote_disconnect')).toBe(true);
    await expect.poll(() => page.evaluate(() => TERMINAL_CONFIG.serverUrl)).toContain('8765');

    await page.locator('[data-action="closeRemoteConnection"]').click();
    await expect(page.locator('#remoteConnectionModal')).not.toHaveClass(/show/);
    clientErrors.expectNoErrors();
  });

  test('terminal and shell audit confirmation buttons resolve every manual decision path', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await expect(await terminalConfirmResult(page, 'termConfirmReject')).toMatchObject({
      allowed: false,
      rejectAll: false
    });
    await expect(await terminalConfirmResult(page, 'termConfirmRejectAll')).toMatchObject({
      allowed: false,
      rejectAll: true
    });
    await expect(await terminalConfirmResult(page, 'termConfirmAcceptAll')).toMatchObject({
      allowed: true,
      rejectAll: false
    });
    await expect(await terminalConfirmResult(page, 'termConfirmAccept')).toMatchObject({
      allowed: true,
      rejectAll: false
    });

    const acceptAuditPromise = page.evaluate(() => window.shellAuditConfirmRisk(
      { risk: 'high', necessary: false, reason: 'e2e risk', concerns: ['mock concern'] },
      { command: 'rm -rf tmp/e2e', cwd: 'C:\\e2e-workspace', context: {} }
    ));
    await expect(page.locator('#shellAuditConfirmMask')).toHaveClass(/show/);
    await page.locator('[data-action="shellAuditConfirmAccept"]').click();
    await expect(await acceptAuditPromise).toMatchObject({ allowed: true, aborted: false });

    const rejectAuditPromise = page.evaluate(() => window.shellAuditConfirmRisk(
      { risk: 'medium', necessary: true, reason: 'e2e reject', concerns: [] },
      { command: 'echo e2e', cwd: 'C:\\e2e-workspace', context: {} }
    ));
    await expect(page.locator('#shellAuditConfirmMask')).toHaveClass(/show/);
    await page.locator('[data-action="shellAuditConfirmReject"]').click();
    await expect(await rejectAuditPromise).toMatchObject({ allowed: false, aborted: false });
    clientErrors.expectNoErrors();
  });

  test('model fetch, pickers, toolbar toggles, and theme modes update local state by action selectors', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page, { modelName: 'mock-model' });

    await openSettingsSection(page, 'main');
    await page.fill('#modelName', 'mock-model');
    await page.locator('[data-action="onFetchModels"]').click();
    await expect(page.locator('#fetchModelsModal')).toHaveClass(/show/);
    await expect(page.locator('#fetchModelsList')).toContainText('mock-model-fast');
    await page.locator('[data-action="toggleSelectAllFetchModels"]').click();
    await page.locator('[data-action="confirmAddFetchedModels"]').click();
    await expect(page.locator('#fetchModelsModal')).not.toHaveClass(/show/);
    await expect(page.locator('#modelName')).toHaveValue(/mock-model-fast/);

    await page.locator('[data-action="toggleApiProfileMenu"]').click();
    await expect(page.locator('#apiProfileMenu')).not.toHaveAttribute('hidden', '');
    await page.mouse.click(20, 20);
    await expect(page.locator('#apiProfileMenu')).toHaveAttribute('hidden', '');

    await page.locator('[data-action="saveAndClose"]').click();
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);

    await page.locator('[data-action="toggleModelMenu"]').click();
    await expect(page.locator('#modelMenu')).not.toHaveAttribute('hidden', '');
    await page.locator('[data-action="setCurrentModelFromPicker"][data-model="mock-model-fast"]').click();
    await expect.poll(() => page.evaluate(() => state.settings.currentModel)).toBe('mock-model-fast');

    await page.locator('[data-action="toggleReasoningEffortMenu"]').click();
    await expect(page.locator('#effortMenu')).not.toHaveAttribute('hidden', '');
    await page.locator('[data-action="setReasoningEffort"][data-effort="high"]').click();
    await expect.poll(() => page.evaluate(() => state.settings.reasoningEffort)).toBe('high');

    await page.locator('[data-action="collapseSidebar"]').click();
    await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
    await page.locator('[data-action="toggleSidebar"]').click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/collapsed/);

    await page.locator('[data-action="toggleSidebarExplorer"]').click();
    await expect(page.locator('#sidebarExplorerPanel')).not.toHaveAttribute('hidden', '');

    await page.locator('[data-action="toggleStatsBar"]').click();
    await expect(page.locator('#statsBar')).toHaveClass(/collapsed/);
    await page.locator('[data-action="toggleStatsBar"]').click();
    await expect(page.locator('#statsBar')).not.toHaveClass(/collapsed/);

    await page.locator('[data-action="toggleScheduledSend"]').first().click();
    await expect(page.locator('#schedulePicker')).not.toHaveAttribute('hidden', '');
    await page.locator('[data-action="toggleScheduledSend"][data-value="false"]').click();
    await expect(page.locator('#schedulePicker')).toHaveAttribute('hidden', '');

    await page.locator('[data-action="toggleTracePanel"]').click();
    await expect(page.locator('#tracePanel')).toHaveClass(/show/);
    await page.locator('[data-action="closeTracePanel"]').click();
    await expect(page.locator('#tracePanel')).not.toHaveClass(/show/);

    await page.locator('[data-action="startTemporaryChat"]').click();
    await expect.poll(() => page.evaluate(() => !!(currentChat() && currentChat().temporary))).toBe(true);
    await expect(page.locator('#temporaryChatBtn')).toHaveClass(/temporary-active/);

    await page.locator('button[data-action="openSettings"]').first().click();
    await expect(page.locator('#settingsPage')).toHaveClass(/show/);
    await page.locator('[data-action="toggleTheme"]').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    await page.locator('[data-action="toggleCoolMode"]').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-cool-mode'))).toBe(true);
    await page.locator('[data-action="toggleSecurityMode"]').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-security-mode'))).toBe(true);
    await expect.poll(() => page.evaluate(() => getPrivacyGuardSettings().enabled)).toBe(true);
    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('project instructions, project memory, prompt library, and tool categories cover editable settings paths', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await openSettingsSection(page, 'projectInstructions');
    await page.locator('[data-action="fillDefaultProjectInstructionsDraft"]').click();
    await expect(page.locator('#projectInstructionsContent')).toHaveValue(/# AGENTS\.md/);
    await page.locator('[data-action="clearLoadedProjectInstructions"]').click();
    await expect(page.locator('#projectInstructionsContent')).toHaveValue('');
    await page.locator('[data-action="generateProjectInstructionsDraft"]').click();
    await expect(page.locator('#projectInstructionsContent')).toHaveValue(/# AGENTS\.md/, { timeout: 15_000 });
    await page.locator('[data-action="saveProjectInstructionsFromUi"]').click();
    await allowTerminalActionIfShown(page);
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'write_file')).toBe(true);

    await openSettingsSection(page, 'projectMemory');
    await setCheckbox(page, '#projectMemoryEnabled', true);
    await page.locator('[data-action="saveProjectMemorySettingsFromUi"]').click();
    await expect.poll(() => page.evaluate(() => ensureProjectMemorySettings().enabled)).toBe(true);
    await page.locator('[data-action="clearLoadedProjectMemory"]').click();
    await expect(page.locator('#projectMemoryContent')).toHaveValue('');
    await page.locator('[data-action="generateProjectMemoryDraft"]').click();
    await expect(page.locator('#projectMemoryContent')).not.toHaveValue('', { timeout: 15_000 });

    await openSettingsSection(page, 'dialogManager');
    await page.fill('#promptTitleInput', 'E2E saved prompt');
    await page.fill('#promptContentInput', 'E2E prompt content for the composer');
    await page.locator('[data-action="savePromptFromUi"]').click();
    await expect(page.locator('#promptLibraryList')).toContainText('E2E saved prompt');
    await page.fill('#promptTitleInput', 'temporary prompt title');
    await page.fill('#promptContentInput', 'temporary prompt body');
    await page.locator('[data-action="clearPromptEditor"]').click();
    await expect(page.locator('#promptTitleInput')).toHaveValue('');
    await expect(page.locator('#promptContentInput')).toHaveValue('');

    await openSettingsSection(page, 'tools');
    await page.locator('[data-action="resetBuiltinTools"]').click();
    await expect.poll(() => page.evaluate(() => state.tools.length)).toBeGreaterThan(0);
    const before = await page.evaluate(() => ({
      lms: state.tools.filter(t => t.name.startsWith('lms_')).length,
      git: state.tools.filter(t => ['note_status', 'note_history', 'note_diff', 'note_snapshot', 'note_restore'].includes(t.name)).length,
      paper: state.tools.filter(t => ['arxiv_search', 'semantic_scholar_search', 'dblp_search', 'openalex_search', 'crossref_search', 'fetch_pdf_text'].includes(t.name)).length
    }));
    await page.locator('[data-action="toggleLmsTools"]').click();
    await expect.poll(() => page.evaluate(() => state.tools.filter(t => t.name.startsWith('lms_')).length)).not.toBe(before.lms);
    await page.locator('[data-action="toggleGitTools"]').click();
    await expect.poll(() => page.evaluate(() => state.tools.filter(t => ['note_status', 'note_history', 'note_diff', 'note_snapshot', 'note_restore'].includes(t.name)).length)).not.toBe(before.git);
    await page.locator('[data-action="togglePaperTools"]').click();
    await expect.poll(() => page.evaluate(() => state.tools.filter(t => ['arxiv_search', 'semantic_scholar_search', 'dblp_search', 'openalex_search', 'crossref_search', 'fetch_pdf_text'].includes(t.name)).length)).not.toBe(before.paper);
    await page.locator('[data-action="closeTools"]').last().click();
    await closeSettingsPageIfOpen(page);

    await sendMessage(page, 'post settings workflow still sends');
    await waitForAssistantReply(page, 'Mock reply');
    expect(backend.llmCalls.length).toBeGreaterThanOrEqual(3);
    clientErrors.expectNoErrors();
  });

  test('changing model controls while a response is generating does not break the active or next request', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, { delayMs: 900, replyPrefix: 'Slow mock' });
    await configureMockProvider(page, { modelName: 'mock-model, mock-model-fast' });

    await sendMessage(page, 'slow request before setting changes');
    await waitForGenerating(page);

    await page.locator('[data-action="toggleStatsBar"]').click();
    await page.locator('[data-action="toggleTracePanel"]').click();
    await expect(page.locator('#tracePanel')).toHaveClass(/show/);
    await page.locator('[data-action="closeTracePanel"]').click();
    await expect(page.locator('#tracePanel')).not.toHaveClass(/show/);

    await page.locator('[data-action="toggleModelMenu"]').click();
    await page.locator('[data-action="setCurrentModelFromPicker"][data-model="mock-model-fast"]').click();
    await page.locator('[data-action="toggleReasoningEffortMenu"]').click();
    await page.locator('[data-action="setReasoningEffort"][data-effort="max"]').click();
    await page.locator('[data-action="toggleScheduledSend"]').first().click();
    await page.locator('[data-action="toggleScheduledSend"][data-value="false"]').click();
    await page.locator('[data-action="collapseSidebar"]').click();
    await page.locator('[data-action="toggleSidebar"]').click();

    await waitForAssistantReply(page, 'Slow mock #1: slow request before setting changes');
    await expect(page.locator('#sendBtn')).not.toHaveClass(/stop/);

    await sendMessage(page, 'request after setting changes');
    await waitForAssistantReply(page, 'Slow mock #2: request after setting changes');

    expect(backend.llmCalls[0].body.model).toBe('mock-model');
    expect(backend.llmCalls[1].body.model).toBe('mock-model-fast');
    expect(backend.llmCalls[1].body.output_config.effort).toBe('max');
    clientErrors.expectNoErrors();
  });
});
