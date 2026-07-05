const { test, expect } = require('@playwright/test');
const {
  configureMockProvider,
  gotoApp,
  sendMessage,
  waitForAssistantReply
} = require('./helpers');

async function openSettingsSection(page, section) {
  await page.locator('button[data-action="openSettings"]').first().click();
  await expect(page.locator('#settingsPage')).toHaveClass(/show/);
  await page.locator(`.settings-nav-item[data-settings-section="${section}"]`).click();
  await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
}

async function gotoAppWithClipboard(page, options = {}) {
  await page.addInitScript(() => {
    window.__e2eClipboard = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => {
          window.__e2eClipboard = String(text);
        }
      }
    });
  });
  return gotoApp(page, options);
}

async function setHiddenSelect(page, selector, value) {
  await page.locator(selector).evaluate((el, nextValue) => {
    el.value = nextValue;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test.describe('tooling, dialog, JSON, and music workflows without real services', () => {
  test('tool manager adds presets, creates and edits a custom tool, clears and restores tools', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);

    await openSettingsSection(page, 'tools');
    await page.locator('[data-action="addPresetTool"][data-value="calc"]').click();
    await expect(page.locator('#toolList')).toContainText('calc');

    await page.locator('[data-action="addCustomTool"]').click();
    await expect(page.locator('#toolEditModal')).toHaveClass(/show/);
    await page.fill('#te_name', 'e2e_custom');
    await page.fill('#te_desc', 'E2E custom tool');
    await page.fill('#te_params', '{"type":"object","properties":{"input":{"type":"string"}},"required":["input"]}');
    await page.fill('#te_code', "return 'e2e:' + args.input;");
    await page.locator('[data-action="saveToolEdit"]').click();
    await expect(page.locator('#toolEditModal')).not.toHaveClass(/show/);
    await expect(page.locator('#toolList')).toContainText('e2e_custom');

    await page.locator('#toolList [data-handler="editTool"]').last().click();
    await expect(page.locator('#te_name')).toHaveValue('e2e_custom');
    await page.fill('#te_desc', 'Updated E2E custom tool');
    await page.locator('[data-action="saveToolEdit"]').click();
    await expect(page.locator('#toolList')).toContainText('Updated E2E custom tool');

    await page.locator('#toolList [data-handler="deleteTool"]').last().click();
    await expect(page.locator('#toolList')).not.toContainText('e2e_custom');

    await page.locator('[data-action="clearAllTools"]').click();
    await expect.poll(() => page.evaluate(() => state.tools.length)).toBe(0);
    await page.locator('[data-action="resetBuiltinTools"]').first().click();
    await expect.poll(() => page.evaluate(() => state.tools.length)).toBeGreaterThan(0);
    await page.locator('[data-action="closeTools"]').last().click();
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);

    clientErrors.expectNoErrors();
  });

  test('dialog manager saves timeline settings and exports the current mocked conversation', async ({ page }) => {
    const { clientErrors } = await gotoAppWithClipboard(page);
    await configureMockProvider(page);
    await sendMessage(page, 'dialog manager export seed');
    await waitForAssistantReply(page, 'Mock reply #1: dialog manager export seed');

    await openSettingsSection(page, 'dialogManager');
    await expect(page.locator('#dialogManagerTimelineList')).toContainText('dialog manager export seed');
    await page.locator('#dialogTimelineEnabled').check();
    await page.locator('[data-action="saveDialogManagerSettings"]').click();
    await expect.poll(() => page.evaluate(() => !!state.settings.dialogManager.timelineEnabled)).toBe(true);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action="exportDialogManagedChat"][data-value="md"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.md$/);

    await page.locator('[data-action="closeSettingsPage"]').click();
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);
    clientErrors.expectNoErrors();
  });

  test('JSON viewer copy, reset, clear-response, and clear-history actions work with a fake provider', async ({ page }) => {
    const { clientErrors } = await gotoAppWithClipboard(page);
    await configureMockProvider(page);
    await sendMessage(page, 'json utility seed');
    await waitForAssistantReply(page, 'Mock reply #1: json utility seed');

    await openSettingsSection(page, 'jsonEditor');
    await page.locator('[data-jsontab="preview"]').click();
    await page.locator('[data-action="refreshJsonPreview"]').click();
    await page.locator('[data-action="copyJsonPreview"]').click();
    await expect.poll(() => page.evaluate(() => window.__e2eClipboard)).toContain('_body');
    await page.locator('[data-action="copyJsonBodyOnly"]').click();
    await expect.poll(() => page.evaluate(() => window.__e2eClipboard)).toContain('json utility seed');
    await page.locator('[data-action="copyAsCurl"]').click();
    await expect.poll(() => page.evaluate(() => window.__e2eClipboard)).toContain('curl -X POST');

    await page.locator('[data-jsontab="response"]').click();
    await page.locator('[data-action="refreshJsonResponse"]').click();
    await page.locator('[data-action="copyJsonResponse"]').click();
    await expect.poll(() => page.evaluate(() => window.__e2eClipboard)).toContain('Mock reply #1');
    await page.locator('[data-action="clearJsonResponses"]').click();
    await expect.poll(() => page.evaluate(() => _rawResponses.length)).toBe(0);

    await page.locator('[data-jsontab="template"]').click();
    await page.fill('#jsonTemplate', '{"broken": true}');
    await page.locator('[data-action="resetJsonTemplate"]').click();
    await expect(page.locator('#jsonTemplate')).toHaveValue(/{{messages}}/);

    await page.locator('[data-jsontab="history"]').click();
    await page.locator('[data-action="refreshJsonHistory"]').click();
    await page.locator('[data-action="clearJsonHistory"]').click();
    await expect.poll(() => page.evaluate(() => storage.get('aichat_request_history_v1') || '')).toBe('');

    clientErrors.expectNoErrors();
  });

  test('music player uses mocked library tracks, local file picker, playback controls, and preview buttons', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);

    await openSettingsSection(page, 'music');
    await expect(page.locator('#musicPlayerRoot')).toContainText('track-one.mp3');
    await expect(page.locator('#musicPlayerRoot')).toContainText('track-two.mp3');
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'music' && call.body.op === 'list')).toBe(true);

    await page.locator('#musicTrackList [data-handler="musicPlayIndex"]').filter({ hasText: 'track-two.mp3' }).click();
    await expect(page.locator('#musicNowTitle')).toHaveText('track-two.mp3');
    await page.locator('[data-action="musicPrevTrack"]').click();
    await expect(page.locator('#musicNowTitle')).toHaveText('track-one.mp3');
    await page.locator('[data-action="musicNextTrack"]').click();
    await expect(page.locator('#musicNowTitle')).toHaveText('track-two.mp3');
    await page.locator('[data-action="musicTogglePlay"]').click();

    await page.locator('[data-action="musicToggleTrackList"]').click();
    await expect(page.locator('#musicTrackList')).toHaveClass(/collapsed/);
    await page.locator('[data-action="musicToggleTrackList"]').click();
    await expect(page.locator('#musicTrackList')).not.toHaveClass(/collapsed/);
    await page.fill('#musicTrackSearch', 'track-two');
    await expect(page.locator('#musicTrackList')).toContainText('track-two.mp3');

    await setHiddenSelect(page, '#musicCompletionTrackSelect', 'track-one.mp3');
    await page.locator('[data-action="musicPreviewCompletionSound"]').click();
    await setHiddenSelect(page, '#musicBgmTrackSelect', 'track-two.mp3');
    await page.locator('[data-action="musicPreviewGenerationBgm"]').click();

    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#musicPlayerRoot [data-target="musicOpenInput"]').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'local-e2e.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('mock local audio')
    });
    await expect(page.locator('#musicPlayerRoot')).toContainText('local-e2e.mp3');

    await page.locator('[data-action="closeSettingsPage"]').click();
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);
    clientErrors.expectNoErrors();
  });
});
