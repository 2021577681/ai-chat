const fs = require('fs');
const { test, expect } = require('@playwright/test');
const {
  configureMockProvider,
  gotoApp,
  sendMessage,
  waitForAssistantReply,
  closeSettingsPageIfOpen
} = require('./helpers');

async function openSettingsSection(page, section) {
  await page.locator('button[data-action="openSettings"]').first().click();
  await expect(page.locator('#settingsPage')).toHaveClass(/show/);
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
  if (await mask.evaluate(el => el.classList.contains('show')).catch(() => false)) {
    await page.locator('#termAllowBtn').click();
  }
}

test.describe('admin and safety workflows without real API keys', () => {
  test('privacy guard sanitizes sensitive text before the mocked provider sees it', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await openSettingsSection(page, 'privacy');
    await setCheckbox(page, '#pgEnabled', true);
    await setCheckbox(page, '#pgDetectEmail', true);
    await setCheckbox(page, '#pgDetectCustomTerms', true);
    await page.fill('#pgCustomTerms', 'ProjectCodenameE2E');
    await page.locator('[data-action="savePrivacySettingsFromUi"]').click();
    await closeSettingsPageIfOpen(page);

    await sendMessage(page, 'contact alice.sensitive@example.com about ProjectCodenameE2E');
    await expect(page.locator('#messagesInner')).toContainText('Mock reply #1:', { timeout: 15_000 });
    await expect(page.locator('#sendBtn')).not.toHaveClass(/stop/);

    const bodyText = JSON.stringify(backend.llmCalls[0].body);
    expect(bodyText).not.toContain('alice.sensitive@example.com');
    expect(bodyText).not.toContain('ProjectCodenameE2E');
    expect(bodyText).toMatch(/MASK|REDACTED|EMAIL|CUSTOM/i);

    await openSettingsSection(page, 'securityRecords');
    await expect.poll(() => page.evaluate(() => loadSecurityRecords().filter(r => r.type === 'privacy').length)).toBeGreaterThan(0);
    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('pricing, context limits, and token usage settings can be edited and verified', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page, { modelName: 'e2e-value, mock-model' });

    await sendMessage(page, 'token usage source message');
    await waitForAssistantReply(page, 'Mock reply #1: token usage source message');

    await openSettingsSection(page, 'pricing');
    await page.fill('#pricingRate', '7.30');
    await setCheckbox(page, '#pricingShowCny', true);
    await page.locator('[data-action="savePricingConfigFromUI"]').click();
    await page.locator('[data-action="addPricingRow"]').click();
    const pricingRow = page.locator('#pricingTableBody tr[data-idx]').last();
    await pricingRow.locator('.pricing-key').fill('e2e-value');
    await pricingRow.locator('.pricing-currency-option[data-value="CNY"]').click();
    await pricingRow.locator('.pricing-in').fill('1.5');
    await pricingRow.locator('.pricing-out').fill('3.5');
    await pricingRow.locator('.pricing-cache').fill('0.2');
    await pricingRow.locator('.pricing-note').fill('e2e pricing rule');
    await page.locator('[data-action="savePricingListFromUI"]').click();
    await page.locator('[data-action="testPricingMatch"]').click();
    await expect(page.locator('#pricingTestResult')).toHaveClass(/show/);
    await expect(page.locator('#pricingTestResult')).toContainText('e2e-value');

    await page.locator('.settings-nav-item[data-settings-section="contextLimit"]').click();
    await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
    await page.locator('[data-action="addContextLimitRow"]').click();
    const contextRow = page.locator('#contextLimitTableBody tr[data-idx]').last();
    await contextRow.locator('.context-limit-key').fill('e2e-value');
    await contextRow.locator('.context-limit-value').fill('123000');
    await contextRow.locator('.context-limit-note').fill('e2e context rule');
    await page.locator('[data-action="saveContextLimitRulesFromUI"]').click();
    await page.locator('[data-action="testContextLimitMatch"]').click();
    await expect(page.locator('#contextLimitTestResult')).toHaveClass(/show/);
    await expect(page.locator('#contextLimitTestResult')).toContainText('e2e-value');

    await page.locator('.settings-nav-item[data-settings-section="tokenUsage"]').click();
    await expect(page.locator('#tokenUsageContent')).toContainText('e2e-value');
    await page.locator('[data-handler="setTokenUsageQuickRange"][data-value="7d"]').click();
    await page.locator('[data-action="renderTokenUsageStats"]').click();
    await expect(page.locator('#tokenUsageContent')).toBeVisible();

    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('permissions and backup export/import controls work in an isolated browser context', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await openSettingsSection(page, 'permissions');
    const firstPermission = page.locator('#permissionsList input[type="checkbox"]').first();
    const firstPermissionKey = await firstPermission.getAttribute('data-value');
    await firstPermission.check();
    await expect.poll(() => page.evaluate(key => !!(TERMINAL_CONFIG.permanentAllow || {})[key], firstPermissionKey)).toBe(true);
    await page.locator('[data-action="onClearAllPerms"]').click();
    await expect.poll(() => page.evaluate(() => Object.keys(TERMINAL_CONFIG.permanentAllow || {}).length)).toBe(0);

    await page.locator('.settings-nav-item[data-settings-section="backup"]').click();
    await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
    await setCheckbox(page, '#exp_apiKey', false);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action="exportConfig"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/aichat-backup-.*\.json$/);
    const downloadPath = await download.path();
    const exported = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
    expect(exported.settings.apiKey).toBe('');

    await page.fill('#importText', JSON.stringify({
      _meta: { app: 'AI Chat', exportedAt: new Date().toISOString() },
      settings: { baseUrl: 'http://imported.local/v1', temperature: 1.1 }
    }));
    await expect(page.locator('#importPreview')).toHaveClass(/success/);
    await page.locator('[data-action="applyImport"]').click();
    await expect.poll(() => page.evaluate(() => state.settings.baseUrl)).toBe('http://imported.local/v1');
    await expect.poll(() => page.evaluate(() => Number(state.settings.temperature))).toBe(1.1);

    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('task queue can add, visualize, run, and clear mocked tasks', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, { replyPrefix: 'Task queue mock' });
    await configureMockProvider(page);

    await openSettingsSection(page, 'taskQueue');
    await page.fill('#taskQueueInput', 'task queue e2e item');
    await page.locator('[data-action="taskQueueAddTasks"]').click();
    await expect(page.locator('#taskQueueList .task-queue-item')).toHaveCount(1);

    await page.locator('[data-action="openTaskQueueTree"]').click();
    await expect(page.locator('#taskQueueTreeModal')).toHaveClass(/show/);
    await page.locator('[data-action="closeTaskQueueTree"]').click();
    await expect(page.locator('#taskQueueTreeModal')).not.toHaveClass(/show/);

    await page.locator('#taskQueueStartBtn').click();
    await expect.poll(() => backend.llmCalls.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => ensureTaskQueue().items.map(item => item.status)), { timeout: 20_000 }).toEqual(['done']);
    await expect(page.locator('#taskQueueList .task-queue-item.done')).toHaveCount(1);

    await page.locator('[data-action="taskQueueClearSettled"]').click();
    await expect(page.locator('#taskQueueList .task-queue-item')).toHaveCount(0);
    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('project instructions, project memory, and MCP/Skill panels use the mocked local backend', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await openSettingsSection(page, 'projectInstructions');
    await expect(page.locator('#projectInstructionsContent')).toHaveValue(/Sample file content|AGENTS|#/);
    await page.fill('#projectInstructionsPath', 'AGENTS.e2e.md');
    await page.locator('[data-action="saveProjectInstructionsSettingsFromUi"]').click();
    await expect.poll(() => page.evaluate(() => ensureProjectInstructionsSettings().path)).toBe('AGENTS.e2e.md');
    await page.fill('#projectInstructionsContent', '# E2E project instructions\n');
    await page.locator('[data-action="saveProjectInstructionsFromUi"]').click();
    await allowTerminalActionIfShown(page);
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'write_file' && call.body.path === 'AGENTS.e2e.md')).toBe(true);

    await page.locator('.settings-nav-item[data-settings-section="projectMemory"]').click();
    await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
    await setCheckbox(page, '#projectMemoryEnabled', true);
    await page.fill('#projectMemoryPath', '.agent/e2e-memory.md');
    await page.locator('[data-action="saveProjectMemorySettingsFromUi"]').click();
    await expect.poll(() => page.evaluate(() => ensureProjectMemorySettings().path)).toBe('.agent/e2e-memory.md');
    await expect(page.locator('#projectMemoryContent')).toHaveValue(/Sample file content|memory|e2e/i);
    await page.fill('#projectMemoryContent', '# E2E project memory\n');
    await page.locator('[data-action="saveProjectMemoryFromUi"]').click();
    await allowTerminalActionIfShown(page);
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'write_file' && call.body.path === '.agent/e2e-memory.md')).toBe(true);

    await page.locator('.settings-nav-item[data-settings-section="mcpSkill"]').click();
    await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
    await page.fill('#mcpServerName', 'mock-mcp');
    await page.fill('#mcpServerCommand', 'node');
    await page.fill('#mcpServerArgs', 'server.js');
    await page.locator('[data-action="saveMcpServer"]').click();
    await expect(page.locator('#mcpServerList')).toContainText('mock-mcp');
    await page.locator('[data-action="syncMcpTools"]').click();
    await allowTerminalActionIfShown(page);
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'mcp_list_tools')).toBe(true);
    await expect(page.locator('#mcpSyncResult')).not.toHaveText('');

    await page.locator('[data-action="switchMcpSkillTab"][data-value="skills"]').click();
    await page.fill('#skillRootsText', 'skill');
    await page.locator('[data-action="scanSkills"]').click();
    await allowTerminalActionIfShown(page);
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'skill_list')).toBe(true);
    await expect(page.locator('#skillList')).toContainText('mock-skill');

    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });
});
