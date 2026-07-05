const { test, expect } = require('@playwright/test');
const {
  configureMockProvider,
  gotoApp,
  sendMessage,
  waitForAssistantReply,
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

async function ensureStatsBarOpen(page) {
  const collapsed = await page.locator('#statsBar').evaluate(el => el.classList.contains('collapsed'));
  if (collapsed) await page.locator('#statsToggleBtn').click();
  await expect(page.locator('#statsBar')).not.toHaveClass(/collapsed/);
}

async function rateState(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(storage.get('aichat_rate_v1') || '{}');
    } catch (e) {
      return {};
    }
  });
}

test.describe('settings reset and destructive controls without real services', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__e2eClipboardText = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async text => {
            window.__e2eClipboardText = String(text);
          },
          readText: async () => window.__e2eClipboardText || ''
        }
      });
    });
  });

  test('reset buttons for pricing, context, privacy, security, rate, and token stats update local state safely', async ({ page }) => {
    const { clientErrors } = await gotoApp(page, { dialogResponses: ['mock-model'] });
    await configureMockProvider(page, { modelName: 'reset-e2e-model, mock-model' });

    await openSettingsSection(page, 'pricing');
    await page.locator('[data-action="addPricingRow"]').click();
    await page.locator('#pricingTableBody tr[data-idx]').last().locator('.pricing-key').fill('reset-e2e-model');
    await page.locator('[data-action="savePricingListFromUI"]').click();
    await expect.poll(() => page.evaluate(() => loadPricingList().some(row => row.key === 'reset-e2e-model'))).toBe(true);
    await page.locator('[data-action="resetPricingToDefault"]').click();
    await expect.poll(() => page.evaluate(() => loadPricingList().some(row => row.key === 'reset-e2e-model'))).toBe(false);

    await page.locator('.settings-nav-item[data-settings-section="contextLimit"]').click();
    await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
    await page.locator('[data-action="addContextLimitRow"]').click();
    await page.locator('#contextLimitTableBody tr[data-idx]').last().locator('.context-limit-key').fill('reset-e2e-model');
    await page.locator('[data-action="saveContextLimitRulesFromUI"]').click();
    await expect.poll(() => page.evaluate(() => loadContextLimitRules().some(row => row.key === 'reset-e2e-model'))).toBe(true);
    await page.locator('[data-action="resetContextLimitRulesToDefault"]').click();
    await expect.poll(() => page.evaluate(() => loadContextLimitRules().some(row => row.key === 'reset-e2e-model'))).toBe(false);

    await page.locator('.settings-nav-item[data-settings-section="privacy"]').click();
    await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
    await setCheckbox(page, '#pgEnabled', true);
    await setCheckbox(page, '#pgDetectEmail', true);
    await setCheckbox(page, '#pgLocalRestoreEnabled', true);
    await page.locator('[data-action="savePrivacySettingsFromUi"]').click();
    await closeSettingsPageIfOpen(page);

    await sendMessage(page, 'reset privacy mapping user bob.reset@example.test');
    await waitForAssistantReply(page, 'Mock reply #1: reset privacy mapping user');
    await openSettingsSection(page, 'privacy');
    await page.locator('[data-action="clearPrivacyRestoreMappings"]').click();
    await page.locator('[data-action="resetPrivacyGuardDefaults"]').click();
    await expect.poll(() => page.evaluate(() => getPrivacyGuardSettings().enabled)).toBe(false);

    await page.locator('.settings-nav-item[data-settings-section="securityRecords"]').click();
    await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
    await expect.poll(() => page.evaluate(() => loadSecurityRecords().length)).toBeGreaterThan(0);
    await page.locator('[data-action="renderSecurityRecords"]').click();
    await page.locator('[data-action="clearSecurityRecords"]').click();
    await expect.poll(() => page.evaluate(() => loadSecurityRecords().length)).toBe(0);

    await closeSettingsPageIfOpen(page);
    await sendMessage(page, 'reset token and rate stats seed');
    await waitForAssistantReply(page, 'Mock reply #2: reset token and rate stats seed');

    await ensureStatsBarOpen(page);
    await page.locator('#rateStats [data-action="openRateSettings"]').click();
    await expect(page.locator('#rateSettingsModal')).toHaveClass(/show/);
    await expect.poll(() => rateState(page).then(state => state.totalRequests || 0)).toBeGreaterThan(0);
    await page.locator('[data-action="resetRateStats"]').click();
    await expect.poll(() => rateState(page).then(state => state.totalRequests || 0)).toBe(0);
    await page.locator('#rateSettingsModal .modal-footer [data-action="closeRateSettings"]').click();
    await expect(page.locator('#rateSettingsModal')).not.toHaveClass(/show/);

    await page.locator('[data-action="showTokenDetails"]').click();
    await expect(page.locator('#tokenDetailModal')).toHaveClass(/show/);
    await page.locator('[data-action="resetTokenStats"]').click();
    await expect(page.locator('#tokenDetailModal')).not.toHaveClass(/show/);
    await expect.poll(() => page.evaluate(() => {
      const stats = currentChat().tokenStats || {};
      return (stats.inputTokens || 0) + (stats.outputTokens || 0);
    })).toBe(0);

    await openSettingsSection(page, 'tokenUsage');
    await page.locator('[data-action="renderTokenUsageStats"]').click();
    await page.locator('[data-action="resetTokenUsageLedger"]').click();
    await expect.poll(() => page.evaluate(() => loadTokenUsageLedger().length)).toBe(0);
    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('backup copy and full data reset are isolated and do not require real APIs', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await openSettingsSection(page, 'backup');
    await page.locator('[data-action="copyConfigToClipboard"]').click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copied)._meta.app).toBe('AI Chat');

    await page.locator('[data-action="resetAllData"]').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#input')).toBeVisible();
    await expect.poll(() => page.evaluate(() => state.settings.apiKey || '')).toBe('');
    clientErrors.expectNoErrors();
  });
});
