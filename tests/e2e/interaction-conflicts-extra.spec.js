const { test, expect } = require('@playwright/test');
const {
  configureMockProvider,
  gotoApp,
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

async function setFieldAndChange(locator, value) {
  await locator.evaluate((el, nextValue) => {
    el.value = nextValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}

async function setCheckboxAndChange(locator, checked) {
  await locator.evaluate((el, nextValue) => {
    el.checked = nextValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, checked);
}

async function taskQueueItems(page) {
  return page.evaluate(() => ensureTaskQueue().items.map(item => ({
    id: item.id,
    text: item.text,
    order: item.order,
    status: item.status,
    mode: item.mode,
    useTools: !!item.useTools,
    exposeOutput: !!item.exposeOutput,
    dependsOnTasksText: item.dependsOnTasksText || ''
  })));
}

async function debateStatus(page) {
  return page.evaluate(() => {
    const chat = currentChat();
    return chat && chat.debate ? chat.debate.status : '';
  });
}

test.describe('extra interaction conflicts without real API keys', () => {
  test('task queue auto schedule can be edited, visualized, paused, stopped, retried, skipped, and cleared', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);
    await configureMockProvider(page);

    await openSettingsSection(page, 'taskQueue');
    await page.fill('#taskQueueInput', 'Break this feature delivery into executable E2E tasks');
    await page.locator('[data-action="taskQueueAutoSchedule"]').click();

    await expect.poll(() => taskQueueItems(page), { timeout: 15_000 }).toHaveLength(3);
    expect(backend.llmCalls.length).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#taskQueueList .task-queue-item')).toHaveCount(3);

    const ids = (await taskQueueItems(page)).map(item => item.id);
    const row = id => page.locator(`#taskQueueList .task-queue-item[data-task-id="${id}"]`);

    await row(ids[0]).locator('textarea[data-input-action="taskQueueUpdateItemText"]').fill('Edited E2E scheduled research task');
    await setFieldAndChange(row(ids[2]).locator('input[data-change-action="taskQueueUpdateItemOrder"]'), '2');
    await setFieldAndChange(row(ids[2]).locator('select[data-change-action="taskQueueUpdateItemMode"]'), 'normal');
    await setCheckboxAndChange(row(ids[2]).locator('input[data-change-action="taskQueueUpdateItemTools"]'), true);
    await setFieldAndChange(row(ids[2]).locator('input[data-change-action="taskQueueUpdateItemDepends"]'), '1');

    await expect.poll(() => taskQueueItems(page)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids[0], text: 'Edited E2E scheduled research task' }),
      expect.objectContaining({ id: ids[2], order: 2, mode: 'normal', useTools: true, dependsOnTasksText: '1' })
    ]));

    await page.locator('[data-action="openTaskQueueTree"]').click();
    await expect(page.locator('#taskQueueTreeModal')).toHaveClass(/show/);
    await expect(page.locator('#taskQueueTreeWrap .task-queue-tree-node')).toHaveCount(3);
    await page.locator('[data-action="renderTaskQueueTree"]').click();
    await expect(page.locator('#taskQueueTreeEdges')).toBeVisible();
    await page.locator('[data-action="closeTaskQueueTree"]').click();
    await expect(page.locator('#taskQueueTreeModal')).not.toHaveClass(/show/);

    await page.locator('[data-action="taskQueueTogglePauseAll"]').click();
    await expect.poll(() => taskQueueItems(page).then(items => items.map(item => item.status))).toEqual(['paused', 'paused', 'paused']);

    await page.locator('[data-action="taskQueueStopAll"]').click();
    await expect.poll(() => taskQueueItems(page).then(items => items.map(item => item.status))).toEqual(['stopped', 'stopped', 'stopped']);

    await row(ids[0]).locator('[data-action="taskQueueRetryItem"]').click();
    await expect.poll(() => taskQueueItems(page).then(items => items.find(item => item.id === ids[0]).status)).toBe('pending');
    await row(ids[0]).locator('[data-action="taskQueueSkipItem"]').click();
    await expect.poll(() => taskQueueItems(page).then(items => items.find(item => item.id === ids[0]).status)).toBe('skipped');

    await row(ids[1]).locator('[data-action="taskQueueRemoveItem"]').click();
    await expect.poll(() => taskQueueItems(page).then(items => items.length)).toBe(2);

    await page.locator('[data-action="taskQueueClearAll"]').click();
    await expect(page.locator('#taskQueueList .task-queue-item')).toHaveCount(0);
    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('task queue can stop an active item, retry it, finish it, and open the generated chat', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, {
      replyPrefix: 'Task active mock',
      delayForLlm(body, callNumber) {
        return callNumber === 1 ? 1_000 : 0;
      }
    });
    await configureMockProvider(page);

    await openSettingsSection(page, 'taskQueue');
    await page.fill('#taskQueueInput', 'active task queue item for stop and retry');
    await page.locator('[data-action="taskQueueAddTasks"]').click();
    await expect(page.locator('#taskQueueList .task-queue-item')).toHaveCount(1);
    const id = (await taskQueueItems(page))[0].id;
    const row = page.locator(`#taskQueueList .task-queue-item[data-task-id="${id}"]`);

    await page.locator('[data-action="startTaskQueue"]').click();
    await expect.poll(() => taskQueueItems(page).then(items => items[0].status), { timeout: 10_000 }).toBe('running');
    await row.locator('[data-action="taskQueueStopItem"]').click();
    await expect.poll(() => taskQueueItems(page).then(items => items[0].status), { timeout: 10_000 }).toBe('stopped');

    await row.locator('[data-action="taskQueueRetryItem"]').click();
    await expect.poll(() => taskQueueItems(page).then(items => items[0].status)).toBe('pending');
    await page.locator('[data-action="startTaskQueue"]').click();
    await expect.poll(() => taskQueueItems(page).then(items => items[0].status), { timeout: 20_000 }).toBe('done');
    expect(backend.llmCalls.length).toBeGreaterThanOrEqual(2);

    await row.locator('[data-action="taskQueueOpenChat"]').click();
    await expect(page.locator('#messagesInner')).toContainText('active task queue item for stop and retry');
    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });

  test('concurrent requests can be stopped from direct controls and history while settings remain usable', async ({ page }) => {
    const { clientErrors } = await gotoApp(page, {
      replyPrefix: 'Concurrent conflict mock',
      delayForLlm(body) {
        const serialized = JSON.stringify(body);
        return serialized.includes('complete quickly') ? 0 : 1_200;
      }
    });
    await configureMockProvider(page);

    await openSettingsSection(page, 'concurrentRequests');
    await page.fill('#concurrentPromptInput', 'stop selected concurrent conflict');
    await page.fill('#concurrentAgentCount', '3');
    await setCheckboxAndChange(page.locator('#concurrentUseTools'), false);
    await page.locator('[data-action="startConcurrentRequestFromUi"]').click();
    await expect.poll(() => page.evaluate(() => isAnyConcurrentChatRunning()), { timeout: 10_000 }).toBe(true);
    await page.locator('[data-action="stopSelectedConcurrentRequest"]').click();
    await expect.poll(() => page.evaluate(() => isAnyConcurrentChatRunning()), { timeout: 10_000 }).toBe(false);

    await page.fill('#concurrentPromptInput', 'stop all concurrent conflict');
    await page.locator('[data-action="startConcurrentRequestFromUi"]').click();
    await expect.poll(() => page.evaluate(() => isAnyConcurrentChatRunning()), { timeout: 10_000 }).toBe(true);
    await page.locator('[data-action="stopAllConcurrentRequests"]').click();
    await expect.poll(() => page.evaluate(() => isAnyConcurrentChatRunning()), { timeout: 10_000 }).toBe(false);

    await page.fill('#concurrentPromptInput', 'history stop concurrent conflict');
    await page.locator('[data-action="startConcurrentRequestFromUi"]').click();
    await expect.poll(() => page.evaluate(() => isAnyConcurrentChatRunning()), { timeout: 10_000 }).toBe(true);
    await page.locator('#concurrentHistoryList [data-handler="requestStopConcurrentChat"]:not([disabled])').first().click();
    await expect.poll(() => page.evaluate(() => isAnyConcurrentChatRunning()), { timeout: 10_000 }).toBe(false);

    await page.fill('#concurrentPromptInput', 'complete quickly from concurrent history');
    await page.locator('[data-action="startConcurrentRequestFromUi"]').click();
    await expect.poll(() => page.evaluate(() => isAnyConcurrentChatRunning()), { timeout: 15_000 }).toBe(false);
    await page.locator('#concurrentHistoryList [data-handler="chooseConcurrentChat"]').first().click();
    await expect(page.locator('#concurrentTargetSelect')).not.toHaveValue('new');
    await closeSettingsPageIfOpen(page);
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);

    await openSettingsSection(page, 'concurrentRequests');
    await page.locator('#concurrentHistoryList [data-handler="openConcurrentChat"]').first().click();
    await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);
    await expect(page.locator('#messagesInner')).toContainText('complete quickly from concurrent history');
    clientErrors.expectNoErrors();
  });

  test('debate mode can be stopped and resumed from settings, then handled through manual review actions', async ({ page }) => {
    const { clientErrors } = await gotoApp(page, {
      stream: true,
      replyPrefix: 'Debate conflict mock',
      delayForLlm(body, callNumber) {
        return callNumber === 1 ? 900 : 0;
      }
    });
    await configureMockProvider(page, { stream: true });

    await openSettingsSection(page, 'debateMode');
    await page.fill('#debateTopicInput', 'E2E debate should remain controllable while settings are opened');
    await page.fill('#debateTotalRounds', '3');
    await page.fill('#debateMaxExchanges', '3');
    await page.fill('#debateAnswerThreshold', '1');
    await page.locator('[data-action="startDebateFromUi"]').click();
    await expect.poll(() => debateStatus(page), { timeout: 10_000 }).toBe('running');

    await openSettingsSection(page, 'debateMode');
    await page.locator('#debateModeContent [data-handler="requestStopDebate"]:not([disabled])').first().click();
    await expect.poll(() => debateStatus(page), { timeout: 10_000 }).toBe('stopped');
    await expect.poll(() => page.evaluate(() => isAnyDebateRunning()), { timeout: 10_000 }).toBe(false);

    await page.locator('[data-action="continueCurrentDebate"]').click();
    await expect.poll(async () => ['running', 'waiting_manual'].includes(await debateStatus(page)), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => debateStatus(page), { timeout: 25_000 }).toBe('waiting_manual');

    await closeSettingsPageIfOpen(page);
    await expect(page.locator('[data-handler="debateManualPass"]')).toBeVisible();
    const judgeCardsBeforePass = await page.locator('.debate-judge-card').count();
    await page.locator('[data-handler="debateManualPass"]').first().click();
    await expect.poll(() => page.locator('.debate-judge-card').count(), { timeout: 25_000 }).toBeGreaterThan(judgeCardsBeforePass);
    await expect.poll(() => debateStatus(page), { timeout: 25_000 }).toBe('waiting_manual');

    await page.locator('[data-handler="debateManualWin"][data-extra-value="pro"]').first().click();
    await expect.poll(() => page.evaluate(() => {
      const chat = currentChat();
      return chat && chat.debate && chat.debate.score ? chat.debate.score.pro : 0;
    }), { timeout: 10_000 }).toBeGreaterThan(0);

    await openSettingsSection(page, 'debateMode');
    await page.locator('[data-action="stopCurrentDebate"]').click();
    await expect.poll(async () => ['stopped', 'completed'].includes(await debateStatus(page)), { timeout: 10_000 }).toBe(true);
    await page.locator('#debateModeContent [data-handler="openDebateChat"]').first().click();
    await expect(page.locator('#messagesInner')).toContainText('E2E debate should remain controllable');
    await closeSettingsPageIfOpen(page);
    clientErrors.expectNoErrors();
  });
});
