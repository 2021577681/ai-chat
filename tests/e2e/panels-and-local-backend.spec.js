const { test, expect } = require('@playwright/test');
const {
  configureMockProvider,
  gotoApp,
  closeSettingsPageIfOpen
} = require('./helpers');

test.describe('feature panels and mocked local backend', () => {
  test('opens major settings sections through the unified settings page', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await page.locator('button[data-action="openSettings"]').first().click();
    await expect(page.locator('#settingsPage')).toHaveClass(/show/);

    const sections = [
      'main',
      'remoteControl',
      'plan',
      'outline',
      'ppt',
      'reflection',
      'tools',
      'privacy',
      'securityRecords',
      'taskQueue',
      'concurrentRequests',
      'debateMode',
      'music',
      'mcpSkill',
      'projectInstructions',
      'projectMemory',
      'jsonEditor',
      'dialogManager',
      'backup',
      'permissions',
      'pricing',
      'tokenUsage',
      'contextLimit',
      'git'
    ];

    for (const section of sections) {
      await page.locator(`.settings-nav-item[data-settings-section="${section}"]`).click();
      await expect(page.locator('#settingsPage')).toHaveClass(/show/);
      await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
      await expect(page.locator('#settingsPageContent')).not.toContainText('unavailable');
      await expect(page.locator('#settingsPageContent')).not.toContainText('Failed to open');
    }

    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('edits mode settings and verifies mutual exclusion through saved settings', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await page.locator('button[data-action="openSettings"]').first().click();
    await page.locator('.settings-nav-item[data-settings-section="plan"]').click();
    await page.locator('#plan_enabled').evaluate(el => {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.fill('#plan_maxStepsInput', '3');
    await page.locator('button[data-action="savePlanSettings"]').click();
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);
    await expect(page.locator('#planBtn')).toHaveClass(/plan-active/);

    await page.locator('button[data-action="openSettings"]').first().click();
    await page.locator('.settings-nav-item[data-settings-section="outline"]').click();
    await page.locator('#outline_enabled').evaluate(el => {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.fill('#outline_maxRounds', '4');
    await page.locator('button[data-action="saveOutlineSettings"]').click();
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);
    await expect(page.locator('#outlineBtn')).toHaveClass(/outline-active/);
    await expect(page.locator('#planBtn')).not.toHaveClass(/plan-active/);

    clientErrors.expectNoErrors();
  });

  test('manages tools through settings and toggles tool mode from the toolbar', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await page.locator('button[data-action="openSettings"]').first().click();
    await page.locator('.settings-nav-item[data-settings-section="tools"]').click();
    await page.locator('.tool-preset[data-value="time"]').click();
    await expect(page.locator('#toolList')).toContainText('time');
    await closeSettingsPageIfOpen(page);

    await page.locator('#toolsBtn').click();
    await expect(page.locator('#toolsBtn')).toHaveClass(/tool-active/);
    await page.locator('#toolsBtn').click();
    await expect(page.locator('#toolsBtn')).not.toHaveClass(/tool-active/);

    clientErrors.expectNoErrors();
  });

  test('uses the file explorer and text file editor against a mocked workspace backend', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await page.locator('#sidebarExplorerBtn').click();
    await expect(page.locator('#sidebarExplorerPanel')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('#fileExplorerList')).toContainText('sample.txt');

    await page.locator('.file-explorer-item').filter({ hasText: 'sample.txt' }).click();
    await expect(page.locator('#fileEditorModal')).toHaveClass(/show/);
    await expect(page.locator('#fileEditorContent')).toHaveValue(/Sample file content/);
    await page.fill('#fileEditorContent', 'Changed by e2e test\n');
    await page.locator('#fileEditorSaveBtn').click();
    await expect(page.locator('#termConfirmMask')).toHaveClass(/show/);
    await page.locator('#termAllowBtn').click();

    expect(backend.backendCalls.some(call => call.action === 'list_dir')).toBe(true);
    expect(backend.backendCalls.some(call => call.action === 'read_file')).toBe(true);
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'write_file')).toBe(true);
    await page.locator('[data-action="closeFileEditor"]').first().click();
    await expect(page.locator('#fileEditorModal')).not.toHaveClass(/show/);

    clientErrors.expectNoErrors();
  });

  test('opens remote connection and LMS login flows without real credentials', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await page.locator('[data-action="openRemoteConnection"]').click();
    await expect(page.locator('#remoteConnectionModal')).toHaveClass(/show/);
    await page.fill('#remoteSshCommand', 'ssh e2e@example.test');
    await page.fill('#remoteWorkspace', '~/workspace');
    await page.locator('[data-action="checkRemoteStatus"]').click();
    await expect(page.locator('#remoteConnectionStatus')).not.toHaveText('');
    await page.locator('[data-action="closeRemoteConnection"]').click();
    await expect(page.locator('#remoteConnectionModal')).not.toHaveClass(/show/);

    await page.locator('[data-action="openLmsPanel"]').click();
    await expect(page.locator('#lmsPanel')).toHaveClass(/show/);
    await page.locator('[data-handler="lmsPanelOpenCookieEditor"]').first().click();
    await expect(page.locator('#lmsCookieModal')).toHaveClass(/show/);
    await page.locator('#lmsAuthTabCookie').click();
    await page.fill('#lmsCookieInput', 'session=mock.eyJ1aWQiOiJlMmUifQ.4102444800000;');
    await page.locator('[data-action="lmsPanelSaveCookie"]').click();
    await expect(page.locator('#lmsCookieModal')).not.toHaveClass(/show/);
    await page.locator('[data-action="closeLmsPanel"]').click();
    await expect(page.locator('#lmsPanel')).not.toHaveClass(/show/);

    clientErrors.expectNoErrors();
  });
});
