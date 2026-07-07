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

test.describe('extra settings prompts and safety controls without real services', () => {
  test('mode prompt presets and reset buttons update plan, outline, reflection, and PPT settings', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await page.locator('[data-action="togglePlan"]').click();
    await expect(page.locator('#planBtn')).toHaveClass(/plan-active/);
    await page.locator('[data-action="toggleOutline"]').click();
    await expect(page.locator('#outlineBtn')).toHaveClass(/outline-active/);
    await expect(page.locator('#planBtn')).not.toHaveClass(/plan-active/);

    await openSettingsSection(page, 'plan');
    await page.locator('[data-action="applyPlanPreset"][data-value="code"]').click();
    await expect(page.locator('#plan_plannerPrompt')).not.toHaveValue('');
    await page.fill('#plan_plannerPrompt', 'temporary e2e plan prompt');
    await page.locator('[data-action="resetPlanPrompts"]').click();
    await expect(page.locator('#plan_plannerPrompt')).not.toHaveValue('temporary e2e plan prompt');

    await openSettingsSection(page, 'outline');
    await page.fill('#outline_systemPrompt', 'temporary e2e outline prompt');
    await page.locator('[data-action="resetOutlinePrompt"]').click();
    await expect(page.locator('#outline_systemPrompt')).not.toHaveValue('temporary e2e outline prompt');
    await page.locator('details').filter({ has: page.locator('#outline_codeTaskPrompt') }).locator('summary').click();
    await page.fill('#outline_codeTaskPrompt', 'temporary e2e code task prompt');
    await page.locator('[data-action="resetAllOutlinePrompts"]').click();
    await expect(page.locator('#outline_codeTaskPrompt')).not.toHaveValue('temporary e2e code task prompt');

    await openSettingsSection(page, 'reflection');
    await page.locator('[data-action="applyPreset"][data-value="code"]').click();
    await expect(page.locator('#ref_studentPrompt')).not.toHaveValue('');
    await setCheckbox(page, '#ref_enabled', true);
    await page.locator('[data-action="saveReflectionSettings"]').click();
    await expect.poll(() => page.evaluate(() => !!state.settings.useReflection)).toBe(true);

    await openSettingsSection(page, 'ppt');
    await page.fill('#pptUnderstandPrompt', 'temporary e2e ppt prompt');
    await page.locator('[data-action="resetPptPromptsToDefault"]').click();
    await expect(page.locator('#pptUnderstandPrompt')).not.toHaveValue('temporary e2e ppt prompt');
    await setCheckbox(page, '#pptEnabled', true);
    await page.fill('#pptSlideCount', '6');
    await page.locator('[data-action="savePptSettings"]').click();
    await expect.poll(() => page.evaluate(() => ({
      usePpt: !!state.settings.usePpt,
      slideCount: state.settings.pptSlideCount
    }))).toEqual({ usePpt: true, slideCount: 6 });

    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('MCP/Skill settings, JSON tabs, pricing currency, and permission cleanup controls persist expected state', async ({ page }) => {
    const { clientErrors } = await gotoApp(page, { dialogResponses: ['initial-e2e-profile', 'renamed-e2e-profile'] });
    await configureMockProvider(page, { modelName: 'mock-model, mock-model-fast' });

    await openSettingsSection(page, 'main');
    await page.locator('[data-action="onSaveAsNewProfile"]').click();
    await expect(page.locator('[data-action="onRenameActiveProfile"]')).toBeEnabled();
    await page.locator('[data-action="onRenameActiveProfile"]').click();
    await expect(page.locator('#apiProfileTriggerText')).toContainText('renamed-e2e-profile');

    await openSettingsSection(page, 'mcpSkill');
    await page.fill('#mcpServerName', 'temporary-mcp');
    await page.fill('#mcpServerCommand', 'node');
    await page.fill('#mcpServerArgs', 'server.js');
    await page.locator('[data-action="clearMcpServerForm"]').click();
    await expect(page.locator('#mcpServerName')).toHaveValue('');
    await expect(page.locator('#mcpServerCommand')).toHaveValue('');

    await page.locator('[data-action="switchMcpSkillTab"][data-value="skills"]').click();
    await page.fill('#skillRootsText', 'skill\n.codex/skills');
    await setCheckbox(page, '#skillUseEnabled', false);
    await page.locator('[data-action="saveSkillRootsFromUi"]').click();
    await expect.poll(() => page.evaluate(() => {
      const cfg = ensureMcpSkillSettings();
      return { roots: cfg.skillRoots, useSkills: cfg.useSkills };
    })).toEqual({ roots: ['skill', '.codex/skills'], useSkills: false });

    await closeSettingsPageIfOpen(page);
    await sendMessage(page, 'json tab setup message');
    await waitForAssistantReply(page, 'Mock reply #1: json tab setup message');
    await openSettingsSection(page, 'jsonEditor');
    await page.locator('[data-action="switchJsonTab"][data-jsontab="headers"]').click();
    await expect(page.locator('#jsonTab-headers')).toBeVisible();
    await page.fill('#jsonHeaders', '{}');
    await page.locator('[data-action="setCodexUserAgentHeader"]').click();
    await expect(page.locator('#jsonHeaders')).toHaveValue(/codex-tui/);
    await page.locator('[data-action="switchJsonTab"][data-jsontab="history"]').click();
    await expect(page.locator('#jsonTab-history')).toBeVisible();

    await openSettingsSection(page, 'pricing');
    await page.locator('[data-action="addPricingRow"]').click();
    const pricingRow = page.locator('#pricingTableBody tr[data-idx]').last();
    await pricingRow.locator('.pricing-key').fill('currency-e2e-model');
    await pricingRow.locator('[data-action="setPricingCurrency"][data-value="CNY"]').click();
    await expect(pricingRow.locator('.pricing-currency')).toHaveValue('CNY');

    await openSettingsSection(page, 'permissions');
    await page.evaluate(() => {
      getTaskAllowForChat(state.currentId).execute = true;
      renderTaskPermissionsList();
    });
    await expect(page.locator('#taskPermissionsList [data-action="onClearTaskPerms"]')).toBeVisible();
    await page.locator('[data-action="onClearTaskPerms"]').click();
    await expect.poll(() => page.evaluate(() => Object.keys(getTaskAllowForChat(state.currentId)).length)).toBe(0);
    await page.locator('[data-action="onClearAllSecrets"]').click();
    await expect.poll(() => page.evaluate(() => state.settings.apiKey || '')).toBe('');

    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('LMS saved credential login and fetch-all controls run through the mocked LMS service', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, {
      lmsHasSavedCredential: true
    });

    await page.locator('[data-action="openLmsPanel"]').click();
    await expect(page.locator('#lmsPanel')).toHaveClass(/show/);
    await page.locator('#lmsStatusBar [data-handler="lmsPanelOpenCookieEditor"][data-value="login"]').first().click();
    await expect(page.locator('#lmsCookieModal')).toHaveClass(/show/);
    await expect(page.locator('#lmsSavedCredentialBox')).toContainText('e2e-student');
    await page.locator('[data-action="lmsPanelLoginWithSavedCredential"]').click();
    await expect(page.locator('#lmsCookieModal')).not.toHaveClass(/show/);
    await expect.poll(() => backend.lmsServiceCalls.some(call =>
      call.path === '/lms-login' && call.body.action === 'start_saved'
    )).toBe(true);

    await page.evaluate(() => {
      const lms = window.AgentApp.require('lmsPanel');
      lms.LMS_PANEL_STATE.cache = lms.lmsPanelEmptyCache();
      lms.LMS_PANEL_STATE.page = 'lms';
      lms.LMS_PANEL_STATE.tab = 'overview';
      lms.lmsPanelRender();
    });
    await page.locator('[data-action="lmsPanelFetchAll"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('E2E Homework');
    await expect.poll(() => backend.lmsProxyCalls.length).toBeGreaterThan(0);

    await page.locator('#lmsStatusBar [data-handler="lmsPanelOpenCookieEditor"][data-value="cookie"]').first().click();
    await expect(page.locator('#lmsCookieModal')).toHaveClass(/show/);
    await page.locator('[data-action="lmsPanelCloseCookieEditor"]').first().click();
    await expect(page.locator('#lmsCookieModal')).not.toHaveClass(/show/);
    await page.locator('[data-action="closeLmsPanel"]').click();
    clientErrors.expectNoErrors();
  });

  test('manual context compression uses a structured mocked summary and keeps the composer usable', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    for (const text of ['compress seed one', 'compress seed two', 'compress seed three']) {
      await sendMessage(page, text);
      await waitForAssistantReply(page, 'Mock reply');
    }
    expect(backend.llmCalls).toHaveLength(3);

    await page.locator('[data-action="manualCompress"]').click();
    await expect.poll(() => backend.llmCalls.length, { timeout: 15_000 }).toBeGreaterThan(3);
    await expect.poll(() => page.evaluate(() => currentChat().messages.some(m => !!m._isSummary)), { timeout: 15_000 }).toBe(true);
    await expect(page.locator('#sendBtn')).not.toHaveClass(/stop/);
    await sendMessage(page, 'after manual compression');
    await waitForAssistantReply(page, 'Mock reply');
    clientErrors.expectNoErrors();
  });

  test('context compression times out and restores composer state when helper request hangs', async ({ page }) => {
    const { clientErrors } = await gotoApp(page, {
      delayForLlm(body) {
        return JSON.stringify(body).includes('上下文压缩') ? 1500 : 0;
      }
    });
    await configureMockProvider(page);

    for (const text of ['timeout seed one', 'timeout seed two', 'timeout seed three']) {
      await sendMessage(page, text);
      await waitForAssistantReply(page, 'Mock reply');
    }

    const result = await page.evaluate(async () => {
      const chat = currentChat();
      return await window.compressChat(chat, {
        reason: 'manual',
        touchGlobalGenerating: true,
        timeoutMs: 1000,
        retryMaxAttempts: 0
      });
    });
    expect(result).toBe(false);
    await expect(page.locator('#sendBtn')).not.toHaveClass(/stop/);
    await expect.poll(() => page.evaluate(() =>
      currentChat().messages.some(m => m && m._isCompressing)
    )).toBe(false);
    await expect.poll(() => page.evaluate(() =>
      window.AgentApp.require('state').state.isGenerating
    )).toBe(false);

    clientErrors.expectNoErrors();
  });
});
