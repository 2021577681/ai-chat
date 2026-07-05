const { test, expect } = require('@playwright/test');
const {
  configureMockProvider,
  gotoApp,
  sendMessage,
  waitForAssistantReply
} = require('./helpers');

async function setCheckbox(page, selector, checked) {
  await page.locator(selector).evaluate((el, value) => {
    el.checked = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, checked);
}

test.describe('web tools and local proxy settings', () => {
  test('web_search and fetch_url tool calls use the saved local proxy settings', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, { webToolsScenario: true });
    await configureMockProvider(page);

    await page.locator('button[data-action="openSettings"]').first().click();
    await expect(page.locator('#settingsPage')).toHaveClass(/show/);
    await setCheckbox(page, '#searchProxyEnabled', true);
    await page.fill('#searchProxyUrl', 'socks5h://127.0.0.1:7890');
    await page.locator('button[data-action="saveAndClose"]').click();
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);
    await expect.poll(() => page.evaluate(() => ({
      enabled: state.settings.searchProxyEnabled,
      url: state.settings.searchProxyUrl
    }))).toEqual({
      enabled: true,
      url: 'socks5h://127.0.0.1:7890'
    });

    await expect.poll(() => page.evaluate(() => state.tools.some(tool => tool.name === 'web_search'))).toBe(true);
    await expect.poll(() => page.evaluate(() => state.tools.some(tool => tool.name === 'fetch_url'))).toBe(true);
    await page.locator('#toolsBtn').click();
    await expect.poll(() => page.evaluate(() => state.settings.useTools)).toBe(true);

    await sendMessage(page, 'use web tools through local proxy');
    await waitForAssistantReply(
      page,
      'Tool-assisted final: web_search and fetch_url completed through the mocked local backend.',
      20_000
    );

    const webSearchCall = backend.backendCalls.find(call => call.action === 'web_search');
    const fetchUrlCall = backend.backendCalls.find(call => call.action === 'fetch_url');
    expect(webSearchCall).toBeTruthy();
    expect(fetchUrlCall).toBeTruthy();
    expect(webSearchCall.body).toMatchObject({
      query: 'e2e search proxy verification',
      max_results: 2,
      region: 'global',
      proxy_enabled: true,
      proxy_url: 'socks5h://127.0.0.1:7890'
    });
    expect(fetchUrlCall.body).toMatchObject({
      url: 'https://example.test/e2e-search-result',
      extract_text: true,
      max_chars: 1200,
      proxy_enabled: true,
      proxy_url: 'socks5h://127.0.0.1:7890'
    });

    expect(backend.llmCalls).toHaveLength(3);
    expect(JSON.stringify(backend.llmCalls[1].body)).toContain('Mock E2E Search Result');
    expect(JSON.stringify(backend.llmCalls[2].body)).toContain('Fetched page text returned by the mocked local backend');
    clientErrors.expectNoErrors();
  });
});
