const { test, expect } = require('@playwright/test');
const {
  configureMockProvider,
  gotoApp,
  sendMessage,
  waitForAssistantReply,
  waitForGenerating
} = require('./helpers');

test.describe('chat generation without real API keys', () => {
  test('sends a normal message through the mocked OpenAI-compatible endpoint', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await sendMessage(page, 'hello normal mock');
    await waitForAssistantReply(page, 'Mock reply #1: hello normal mock');

    expect(backend.llmCalls).toHaveLength(1);
    expect(backend.llmCalls[0].body.model).toBe('mock-model');
    expect(backend.llmCalls[0].body.stream).toBe(false);
    clientErrors.expectNoErrors();
  });

  test('renders streamed model output from a mocked SSE response', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, { stream: true });
    await configureMockProvider(page, { stream: true });

    await sendMessage(page, 'hello stream mock');
    await waitForAssistantReply(page, 'Mock stream #1: hello stream mock');

    expect(backend.llmCalls).toHaveLength(1);
    expect(backend.llmCalls[0].body.stream).toBe(true);
    clientErrors.expectNoErrors();
  });

  test('shows API errors from the mocked provider without crashing the page', async ({ page }) => {
    const { clientErrors } = await gotoApp(page, { failNextLlmCall: true });
    await configureMockProvider(page);

    await sendMessage(page, 'force provider error');
    await expect(page.locator('#messagesInner')).toContainText('mock failure');
    await expect(page.locator('#sendBtn')).not.toHaveClass(/stop/);
    clientErrors.expectNoErrors();
  });

  test('allows settings edits while a generation is in flight', async ({ page }) => {
    const { clientErrors } = await gotoApp(page, { delayMs: 800 });
    await configureMockProvider(page);

    await sendMessage(page, 'slow settings conflict');
    await waitForGenerating(page);

    await page.locator('button[data-action="openSettings"]').first().click();
    await expect(page.locator('#settingsPage')).toHaveClass(/show/);
    await page.locator('#temperature').evaluate(el => {
      el.value = '0.9';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('button[data-action="saveAndClose"]').click();
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);

    await waitForAssistantReply(page, 'Mock reply #1: slow settings conflict');
    clientErrors.expectNoErrors();
  });

  test('stops an in-flight generation and leaves the composer usable', async ({ page }) => {
    const { clientErrors } = await gotoApp(page, { delayMs: 2_000 });
    await configureMockProvider(page);

    await sendMessage(page, 'stop this slow request');
    await waitForGenerating(page);
    await page.locator('#sendBtn').click();
    await expect(page.locator('#sendBtn')).not.toHaveClass(/stop/);

    await page.fill('#input', 'after stop still works');
    await expect(page.locator('#input')).toHaveValue('after stop still works');
    clientErrors.expectNoErrors();
  });

  test('deletes an assistant turn with its user prompt before the next request', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await sendMessage(page, 'delete-me-turn original prompt');
    await waitForAssistantReply(page, 'Mock reply #1: delete-me-turn original prompt');

    await page.locator('[data-handler="deleteMessageTurn"]').last().click();
    await expect(page.locator('#messagesInner')).not.toContainText('delete-me-turn original prompt');

    await sendMessage(page, 'after deletion request');
    await waitForAssistantReply(page, 'Mock reply #2: after deletion request');

    expect(backend.llmCalls).toHaveLength(2);
    const nextRequest = JSON.stringify(backend.llmCalls[1].body);
    expect(nextRequest).toContain('after deletion request');
    expect(nextRequest).not.toContain('delete-me-turn original prompt');
    clientErrors.expectNoErrors();
  });

  test('keeps parallel conversations isolated while background generation continues', async ({ page }) => {
    const { clientErrors } = await gotoApp(page, {
      delayForLlm(body) {
        const serialized = JSON.stringify(body);
        if (serialized.includes('slow-A')) return 1_000;
        return 80;
      }
    });
    await configureMockProvider(page);

    await sendMessage(page, 'slow-A parallel conversation');
    await waitForGenerating(page);

    await page.locator('[data-action="newChat"]').first().click();
    await expect(page.locator('#messagesInner')).not.toContainText('slow-A parallel conversation');

    await sendMessage(page, 'fast-B parallel conversation');
    await waitForAssistantReply(page, 'Mock reply #2: fast-B parallel conversation');
    await expect(page.locator('#messagesInner')).not.toContainText('slow-A parallel conversation');

    await page.locator('.chat-item').filter({ hasText: 'slow-A parallel conversation' }).first().click();
    await waitForAssistantReply(page, 'Mock reply #1: slow-A parallel conversation');
    await expect(page.locator('#messagesInner')).not.toContainText('fast-B parallel conversation');

    clientErrors.expectNoErrors();
  });

  test('temporary chat can be opened while the original conversation keeps generating', async ({ page }) => {
    const { clientErrors } = await gotoApp(page, {
      delayForLlm(body) {
        const serialized = JSON.stringify(body);
        if (serialized.includes('slow original before temporary chat')) return 1_200;
        return 50;
      }
    });
    await configureMockProvider(page);

    await sendMessage(page, 'slow original before temporary chat');
    await waitForGenerating(page);
    const originalChatId = await page.evaluate(() => state.currentId);

    await page.locator('#temporaryChatBtn').click();
    await expect.poll(() => page.evaluate(() => !!(currentChat() && currentChat().temporary))).toBe(true);
    await expect(page.locator('#sendBtn')).not.toHaveClass(/stop/);
    await expect(page.locator('#messagesInner')).not.toContainText('slow original before temporary chat');

    await sendMessage(page, 'temporary chat should stay usable');
    await waitForAssistantReply(page, 'Mock reply #2: temporary chat should stay usable');

    await expect.poll(() => page.evaluate((id) => {
      const chat = chatById(id);
      return !!(chat && (chat.messages || []).some(msg => (
        msg.role === 'assistant'
        && String(msg.content || '').includes('Mock reply #1: slow original before temporary chat')
      )));
    }, originalChatId), { timeout: 10_000 }).toBe(true);
    await page.evaluate((chatId) => window.AgentApp.require('chat').switchChat(chatId), originalChatId);
    await waitForAssistantReply(page, 'Mock reply #1: slow original before temporary chat');
    await expect(page.locator('#messagesInner')).not.toContainText('temporary chat should stay usable');

    clientErrors.expectNoErrors();
  });
});
