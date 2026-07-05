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

test.describe('outline mode high-value regressions', () => {
  test('initial outline item limit caps an oversized save_outline tool call', async ({ page }) => {
    const { clientErrors } = await gotoApp(page, { outlineMaxItemsScenario: true });
    await configureMockProvider(page);

    await page.locator('button[data-action="openSettings"]').first().click();
    await expect(page.locator('#settingsPage')).toHaveClass(/show/);
    await page.locator('.settings-nav-item[data-settings-section="outline"]').click();
    await setCheckbox(page, '#outline_enabled', true);
    await page.fill('#outline_maxRounds', '4');
    await page.fill('#outline_maxItems', '3');
    await page.locator('button[data-action="saveOutlineSettings"]').click();
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);
    await expect(page.locator('#outlineBtn')).toHaveClass(/outline-active/);
    await expect.poll(() => page.evaluate(() => state.settings.outlineMaxItems)).toBe(3);

    await sendMessage(page, 'outline item cap e2e task');
    await waitForAssistantReply(
      page,
      'Outline final: initial outline was capped by the configured item limit.',
      30_000
    );

    const outlineState = await page.evaluate(() => {
      const chat = currentChat();
      const msg = (chat.messages || []).find(item => item && item.outline);
      return {
        status: msg && msg.outline && msg.outline.status,
        itemIds: msg && msg.outline && Array.isArray(msg.outline.items)
          ? msg.outline.items.map(item => item.id)
          : [],
        itemTitles: msg && msg.outline && Array.isArray(msg.outline.items)
          ? msg.outline.items.map(item => item.title)
          : []
      };
    });

    expect(outlineState.status).toBe('completed');
    expect(outlineState.itemIds).toEqual(['a1', 'a2', 'a3']);
    expect(outlineState.itemTitles).toEqual([
      'Define acceptance criteria',
      'Inspect relevant files',
      'Implement focused change'
    ]);
    expect(outlineState.itemIds).not.toContain('a4');
    clientErrors.expectNoErrors();
  });
});
