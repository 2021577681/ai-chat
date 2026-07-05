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

function pastDatetimeLocal() {
  const d = new Date(Date.now() - 60_000);
  const pad = value => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

test.describe('advanced UI workflows without real API keys', () => {
  test('uploads, removes, and sends a text attachment through the mocked provider', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await page.setInputFiles('#fileInput', {
      name: 'e2e-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('attachment text used by the e2e mock')
    });
    await expect(page.locator('#pendingAtts')).toContainText('e2e-note.txt');

    await page.locator('#pendingAtts .remove').click();
    await expect(page.locator('#pendingAtts')).not.toContainText('e2e-note.txt');

    await page.setInputFiles('#fileInput', {
      name: 'e2e-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('attachment text used by the e2e mock')
    });
    await expect(page.locator('#pendingAtts')).toContainText('e2e-note.txt');

    await sendMessage(page, 'use the uploaded note');
    await waitForAssistantReply(page, 'Mock reply #1: use the uploaded note');
    await expect(page.locator('#messagesInner')).toContainText('e2e-note.txt');
    expect(JSON.stringify(backend.llmCalls[0].body)).toContain('attachment text used by the e2e mock');
    clientErrors.expectNoErrors();
  });

  test('shows generated request, raw response, and request history in the JSON viewer', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await sendMessage(page, 'json viewer request');
    await waitForAssistantReply(page, 'Mock reply #1: json viewer request');

    await openSettingsSection(page, 'jsonEditor');
    await expect(page.locator('#jsonPreview')).toHaveValue(/json viewer request/);
    await expect(page.locator('#jsonPreview')).toHaveValue(new RegExp(MOCK_API_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    await page.locator('[data-jsontab="response"]').click();
    await expect(page.locator('#jsonResponseDetail')).toHaveValue(/Mock reply #1: json viewer request/);

    await page.locator('[data-jsontab="history"]').click();
    await expect(page.locator('#jsonHistory')).toContainText(MOCK_API_BASE);

    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('creates an immediate scheduled send and triggers it through the mock API', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await page.locator('#scheduleBtn').click();
    await expect(page.locator('#schedulePicker')).not.toHaveAttribute('hidden', '');
    await page.fill('#scheduleTimeInput', pastDatetimeLocal());

    await sendMessage(page, 'scheduled immediate mock');
    await expect(page.locator('#schedulePicker')).toHaveAttribute('hidden', '');
    await waitForAssistantReply(page, 'Mock reply #1: scheduled immediate mock');

    expect(backend.llmCalls).toHaveLength(1);
    clientErrors.expectNoErrors();
  });

  test('starts a concurrent request round and keeps its generated chat isolated', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, { replyPrefix: 'Concurrent mock' });
    await configureMockProvider(page);

    await openSettingsSection(page, 'concurrentRequests');
    await page.fill('#concurrentPromptInput', 'parallel panel mock');
    await page.fill('#concurrentAgentCount', '2');
    await page.locator('#concurrentUseTools').evaluate(el => {
      el.checked = false;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#concurrentStartBtn').click();

    await expect.poll(() => backend.llmCalls.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => page.evaluate(() => {
      const c = currentChat();
      const group = c && Array.isArray(c.messages) ? c.messages.find(m => m && m._concurrentGroup) : null;
      return {
        type: c && c.concurrent && c.concurrent.type,
        status: group && group.concurrent && group.concurrent.status,
        turns: group && group.concurrent && group.concurrent.turns ? group.concurrent.turns.length : 0
      };
    }), { timeout: 15_000 }).toEqual({
      type: 'concurrent_requests',
      status: 'done',
      turns: 2
    });

    await closeSettingsPageIfOpen(page);
    await expect(page.locator('#messagesInner')).toContainText('parallel panel mock');
    await expect(page.locator('#messagesInner')).toContainText('Concurrent mock');
    clientErrors.expectNoErrors();
  });

  test('opens health check results for a conversation that has no beacons yet', async ({ page }) => {
    const { clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await sendMessage(page, 'health check no beacon');
    await waitForAssistantReply(page, 'Mock reply #1: health check no beacon');

    await page.locator('button[data-action="runHealthCheck"]').first().click();
    await expect(page.locator('#healthCheckModal')).toHaveClass(/show/);
    await page.locator('#healthCheckModal [data-action="closeHealthCheckModal"]').click();
    await expect(page.locator('#healthCheckModal')).not.toHaveClass(/show/);
    clientErrors.expectNoErrors();
  });
});
