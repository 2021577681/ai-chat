const { test, expect } = require('@playwright/test');
const {
  configureMockProvider,
  gotoApp,
  closeSettingsPageIfOpen
} = require('./helpers');

test.describe('application shell and settings', () => {
  test('loads the app and configures a fake provider without a real API key', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);

    await expect(page.locator('#chatList')).toBeVisible();
    await expect(page.locator('#messagesInner')).toBeVisible();
    await expect(page.locator('#input')).toBeVisible();
    await expect(page.locator('#sendBtn')).toBeVisible();

    await configureMockProvider(page);

    await page.locator('button[data-action="openSettings"]').first().click();
    await expect(page.locator('#settingsPage')).toHaveClass(/show/);
    await expect(page.locator('#baseUrl')).toHaveValue('http://127.0.0.1:4173/mock-api');
    await expect(page.locator('#apiKey')).toHaveValue('fake-e2e-key');

    await page.locator('button[data-action="testConnection"]').click();
    await expect(page.locator('#testResult')).toHaveClass(/success/);

    await page.locator('button[data-action="onFetchModels"]').click();
    await expect(page.locator('#fetchModelsModal')).toHaveClass(/show/);
    await expect(page.locator('#fetchModelsList')).toContainText('mock-model');
    await page.locator('#fetchModelsModal button[data-action="closeFetchModelsModal"]').first().click();
    await expect(page.locator('#fetchModelsModal')).not.toHaveClass(/show/);

    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('exercises primary toolbar controls and mutually exclusive mode toggles', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await page.locator('#modelTrigger').click();
    await expect(page.locator('#modelMenu')).not.toHaveAttribute('hidden', '');
    await page.keyboard.press('Escape');

    await page.locator('#effortTrigger').click();
    await expect(page.locator('#effortMenu')).not.toHaveAttribute('hidden', '');
    await page.locator('.effort-option[data-effort="high"]').click();
    await expect(page.locator('#effortMenu')).toHaveAttribute('hidden', '');

    await page.locator('#statsToggleBtn').click();
    await page.locator('#statsToggleBtn').click();

    await page.locator('#scheduleBtn').click();
    await expect(page.locator('#schedulePicker')).not.toHaveAttribute('hidden', '');
    await page.locator('.schedule-clear').click();
    await expect(page.locator('#schedulePicker')).toHaveAttribute('hidden', '');

    await page.locator('#planBtn').click();
    await expect(page.locator('#planBtn')).toHaveClass(/plan-active/);
    await page.locator('#outlineBtn').click();
    await expect(page.locator('#outlineBtn')).toHaveClass(/outline-active/);
    await expect(page.locator('#planBtn')).not.toHaveClass(/plan-active/);

    await page.locator('[data-action="openLmsPanel"]').click();
    await expect(page.locator('#lmsPanel')).toHaveClass(/show/);
    await page.locator('[data-action="closeLmsPanel"]').click();
    await expect(page.locator('#lmsPanel')).not.toHaveClass(/show/);

    await page.locator('#traceToggleBtn').click();
    await expect(page.locator('#tracePanel')).toHaveClass(/show/);
    await page.locator('[data-action="closeTracePanel"]').click();
    await expect(page.locator('#tracePanel')).not.toHaveClass(/show/);

    await page.locator('#remoteControlBtn').click();
    await expect(page.locator('#remoteControlBtn')).toHaveClass(/remote-control-active/);
    await page.locator('#remoteControlBtn').click();
    await expect(page.locator('#remoteControlBtn')).not.toHaveClass(/remote-control-active/);

    await page.locator('[data-action="newChat"]').first().click();
    await page.locator('#temporaryChatBtn').click();
    await expect(page.locator('#chatList')).toBeVisible();

    clientErrors.expectNoErrors();
  });
});
