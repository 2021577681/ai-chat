const fs = require('fs');
const { test, expect } = require('@playwright/test');
const {
  MOCK_API_BASE,
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

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((el, nextValue) => {
    el.value = nextValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}

async function ensureStatsBarOpen(page) {
  const collapsed = await page.locator('#statsBar').evaluate(el => el.classList.contains('collapsed'));
  if (collapsed) {
    await page.locator('#statsToggleBtn').click();
  }
  await expect(page.locator('#statsBar')).not.toHaveClass(/collapsed/);
}

test.describe('configuration and observability workflows without real API keys', () => {
  test('API profiles, model picker, and reasoning effort update the outgoing mock request', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await openSettingsSection(page, 'main');
    await page.fill('#baseUrl', `${MOCK_API_BASE}/profile`);
    await page.fill('#modelName', 'profile-a, profile-b');
    await page.locator('[data-action="onSaveAsNewProfile"]').click();
    await expect(page.locator('#apiProfileTriggerText')).toContainText('e2e-value');
    await expect(page.locator('[data-action="onOverwriteActiveProfile"]')).toBeEnabled();

    await page.locator('[data-action="onDuplicateActiveProfile"]').click();
    await expect.poll(() => page.evaluate(() => loadApiProfiles().length)).toBe(2);

    await page.fill('#baseUrl', `${MOCK_API_BASE}/profile-overwrite`);
    await page.locator('[data-action="onOverwriteActiveProfile"]').click();
    await expect.poll(() => page.evaluate(() => {
      const id = storage.get('aichat_active_profile_id_v1');
      const profile = loadApiProfiles().find(item => item.id === id);
      return profile && profile.settings && profile.settings.baseUrl;
    })).toBe(`${MOCK_API_BASE}/profile-overwrite`);

    await page.locator('[data-action="onDeleteActiveProfile"]').click();
    await expect.poll(() => page.evaluate(() => loadApiProfiles().length)).toBe(1);

    await page.locator('[data-action="saveAndClose"]').click();
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);

    await page.locator('#modelTrigger').click();
    await page.locator('.model-option[data-model="profile-b"]').click();
    await page.locator('#effortTrigger').click();
    await page.locator('.effort-option[data-effort="max"]').click();

    await sendMessage(page, 'profile model picker request');
    await waitForAssistantReply(page, 'Mock reply #1: profile model picker request');

    expect(backend.llmCalls).toHaveLength(1);
    expect(backend.llmCalls[0].url).toContain('/mock-api/profile-overwrite/chat/completions');
    expect(backend.llmCalls[0].body.model).toBe('profile-b');
    expect(backend.llmCalls[0].body.output_config.effort).toBe('max');
    clientErrors.expectNoErrors();
  });

  test('JSON editor custom body and headers are used by the mocked provider', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await sendMessage(page, 'json custom template seed');
    await waitForAssistantReply(page, 'Mock reply #1: json custom template seed');

    await openSettingsSection(page, 'jsonEditor');
    await page.locator('[data-jsontab="template"]').click();
    await setCheckbox(page, '#jsonUseCustom', true);
    await page.fill('#jsonTemplate', [
      '{',
      '  "model": "{{model}}",',
      '  "messages": {{messages}},',
      '  "temperature": {{temperature}},',
      '  "max_tokens": {{max_tokens}},',
      '  "stream": {{stream}},',
      '  "tools": {{tools}},',
      '  "custom_e2e": "enabled"',
      '}'
    ].join('\n'));
    await page.locator('[data-action="formatJsonTemplate"]').click();
    await page.locator('[data-jsontab="headers"]').click();
    await page.fill('#jsonHeaders', '{ "X-E2E-Header": "ok" }');
    await page.locator('#jsonTab-headers [data-action="saveJsonTemplate"]').click();
    await closeSettingsPageIfOpen(page);

    await sendMessage(page, 'json custom template request');
    await waitForAssistantReply(page, 'Mock reply #2: json custom template request');

    expect(backend.llmCalls).toHaveLength(2);
    expect(backend.llmCalls[1].body.custom_e2e).toBe('enabled');
    expect(backend.llmCalls[1].headers['x-e2e-header']).toBe('ok');
    clientErrors.expectNoErrors();
  });

  test('Trace panel can search, expand, export, delete, and clear current-session traces', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await sendMessage(page, 'trace searchable request');
    await waitForAssistantReply(page, 'Mock reply #1: trace searchable request');
    await expect.poll(() => page.evaluate(() => state.traces.length)).toBeGreaterThanOrEqual(2);

    await page.locator('#traceToggleBtn').click();
    await expect(page.locator('#tracePanel')).toHaveClass(/show/);
    await expect(page.locator('#traceBody')).toContainText('trace searchable request');

    await page.fill('#traceSearchInput', 'trace searchable');
    await expect(page.locator('#traceBody')).toContainText('trace searchable request');
    await page.locator('#traceTabAll').click();
    await expect(page.locator('#traceTabAll')).toHaveClass(/active/);
    await page.fill('#traceSearchInput', '');

    await page.locator('#traceBody .tr-body').first().click();
    await expect(page.locator('#traceBody .tr-detail')).toBeVisible();
    const countBeforeDelete = await page.evaluate(() => state.traces.length);
    await page.locator('#traceBody [data-handler="deleteTrace"]').first().click();
    await expect.poll(() => page.evaluate(() => state.traces.length)).toBe(countBeforeDelete - 1);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action="exportTraces"]').click();
    const download = await downloadPromise;
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.count).toBeGreaterThan(0);

    await page.locator('#traceTabSession').click();
    await page.locator('[data-action="clearSessionTraces"]').click();
    await expect.poll(() => page.evaluate(() => {
      const chatId = state.currentId;
      return state.traces.filter(trace => trace.chatId === chatId).length;
    })).toBe(0);
    await page.locator('[data-action="clearAllTraces"]').click();
    await expect.poll(() => page.evaluate(() => state.traces.length)).toBe(0);

    await page.locator('[data-action="closeTracePanel"]').click();
    await expect(page.locator('#tracePanel')).not.toHaveClass(/show/);
    clientErrors.expectNoErrors();
  });

  test('rate limiter settings and pause state block then resume generation without real API calls', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await sendMessage(page, 'rate limiter setup seed');
    await waitForAssistantReply(page, 'Mock reply #1: rate limiter setup seed');
    expect(backend.llmCalls).toHaveLength(1);

    await ensureStatsBarOpen(page);
    await page.locator('#rateStats [data-action="openRateSettings"]').scrollIntoViewIfNeeded();
    await page.locator('#rateStats [data-action="openRateSettings"]').click();
    await expect(page.locator('#rateSettingsModal')).toHaveClass(/show/);
    await page.locator('[data-handler="applyRatePreset"][data-value="agent"]').click();
    await expect(page.locator('#rate_maxPerMinute')).toHaveValue('30');
    await setRange(page, '#rate_randomMax', 0);
    await page.locator('[data-action="saveRateSettings"]').click();
    await expect(page.locator('#rateSettingsModal')).not.toHaveClass(/show/);

    await page.locator('#rateStats [data-action="toggleRatePause"]').click();
    await sendMessage(page, 'blocked while rate paused');
    await expect(page.locator('#sendBtn')).not.toHaveClass(/stop/);
    expect(backend.llmCalls).toHaveLength(1);

    await page.locator('#rateStats [data-action="toggleRatePause"]').click();
    await sendMessage(page, 'after rate resume');
    await waitForAssistantReply(page, 'Mock reply #2: after rate resume');
    expect(backend.llmCalls).toHaveLength(2);
    clientErrors.expectNoErrors();
  });

  test('remote control settings start and stop the mocked local WeChat bridge', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await openSettingsSection(page, 'remoteControl');
    await setCheckbox(page, '#remoteControlEnabled', true);
    await page.fill('#remoteControlPollInterval', '1');
    await page.fill('#remoteControlPollLimit', '2');
    await page.fill('#remoteControlMaxConsecutiveSendsBeforePoll', '1');
    await page.fill('#remoteControlOutputTemplate', '[e2e] {{content}}');
    await page.fill('#remoteControlShortReplyPrompt', 'short e2e replies only');
    await page.fill('#remoteControlMaxReplyChars', '400');
    await expect(page.locator('#remoteControlCommandList')).not.toHaveText('');
    await page.locator('[data-action="saveAndCloseRemoteControlSettings"]').click();

    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);
    await expect(page.locator('#remoteControlBtn')).toHaveClass(/remote-control-active/);
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'wechat_bridge' && call.body.op === 'start')).toBe(true);
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'wechat_bridge' && call.body.op === 'send')).toBe(true);

    await page.locator('#remoteControlBtn').click();
    await expect(page.locator('#remoteControlBtn')).not.toHaveClass(/remote-control-active/);
    await expect.poll(() => backend.backendCalls.some(call => call.action === 'wechat_bridge' && call.body.op === 'stop')).toBe(true);
    clientErrors.expectNoErrors();
  });

  test('file explorer opens inline text plus PDF, image, and media previewers from mocked workspace files', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await page.locator('#sidebarExplorerBtn').click();
    await expect(page.locator('#sidebarExplorerPanel')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('#fileExplorerList')).toContainText('sample.txt');
    await expect(page.locator('#fileExplorerList')).toContainText('sample.pdf');
    await expect(page.locator('#fileExplorerList')).toContainText('sample.png');
    await expect(page.locator('#fileExplorerList')).toContainText('sample.mp3');

    await page.locator('.file-explorer-item').filter({ hasText: 'sample.txt' }).click();
    await expect(page.locator('#fileEditorModal')).toHaveClass(/show/);
    await page.locator('[data-action="openCurrentFileInMainPanel"][data-kind="text"]').click();
    await expect(page.locator('#inlineFilePanel')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('#inlineFilePath')).toContainText('sample.txt');
    await page.locator('[data-action="toggleInlineFileSide"]').click();
    await page.locator('[data-action="reloadInlineFilePanel"]').click();
    await page.locator('[data-action="closeInlineFilePanel"]').click();
    await expect(page.locator('#inlineFilePanel')).toHaveAttribute('hidden', '');

    await page.locator('.file-explorer-item').filter({ hasText: 'sample.pdf' }).click();
    await expect(page.locator('#pdfViewerModal')).toHaveClass(/show/);
    await expect(page.locator('#pdfViewerPath')).toContainText('sample.pdf');
    await page.locator('[data-action="reloadPdfViewer"]').click();
    await page.locator('[data-action="openCurrentFileInMainPanel"][data-kind="pdf"]').click();
    await expect(page.locator('#inlineFilePanel')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('#inlineFilePath')).toContainText('sample.pdf');
    await page.locator('[data-action="closeInlineFilePanel"]').click();

    await page.locator('.file-explorer-item').filter({ hasText: 'sample.png' }).click();
    await expect(page.locator('#imageViewerModal')).toHaveClass(/show/);
    await expect(page.locator('#imageViewerPath')).toContainText('sample.png');
    await page.locator('[data-action="reloadImageViewer"]').click();
    await page.locator('#imageViewerModal .modal-footer [data-action="closeImageViewer"]').click();
    await expect(page.locator('#imageViewerModal')).not.toHaveClass(/show/);

    await page.locator('.file-explorer-item').filter({ hasText: 'sample.mp3' }).click();
    await expect(page.locator('#mediaViewerModal')).toHaveClass(/show/);
    await expect(page.locator('#mediaViewerPath')).toContainText('sample.mp3');
    await page.locator('[data-action="reloadMediaViewer"]').click();
    await page.locator('#mediaViewerModal .modal-footer [data-action="closeMediaViewer"]').click();
    await expect(page.locator('#mediaViewerModal')).not.toHaveClass(/show/);

    expect(backend.backendCalls.some(call => call.action === 'list_dir')).toBe(true);
    expect(backend.backendCalls.some(call => call.action === 'read_file')).toBe(true);
    clientErrors.expectNoErrors();
  });
});
