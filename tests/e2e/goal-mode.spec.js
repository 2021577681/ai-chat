const { test, expect } = require('@playwright/test');
const {
  configureMockProvider,
  gotoApp,
  waitForGenerating
} = require('./helpers');

async function openGoalPanel(page) {
  await page.locator('#goalBtn').click();
  await expect(page.locator('#goalModal')).toHaveClass(/show/);
}

async function createGoalFromPanel(page, objective) {
  await page.fill('#goalObjectiveInput', objective);
  await page.fill('#goalMaxTurnsInput', '3');
  await page.locator('[data-action="createGoalFromUi"]').click();
}

function datetimeLocalFromNow(ms) {
  const d = new Date(Date.now() + ms);
  const pad = value => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function waitForGoalStatus(page, objective, status) {
  await expect.poll(() => page.evaluate(({ objective, status }) => {
    const goals = window.AgentApp.require('goalCore').listGoals();
    const goal = goals.find(item => item && item.objective === objective);
    return goal ? goal.status : '';
  }, { objective, status }), { timeout: 20_000 }).toBe(status);
}

async function ensureCurrentChat(page) {
  const currentId = await page.evaluate(() => window.AgentApp.require('state').state.currentId);
  if (currentId) return currentId;
  await page.locator('[data-action="newChat"]').first().click();
  await expect.poll(() => page.evaluate(() => window.AgentApp.require('state').state.currentId)).toBeTruthy();
  return page.evaluate(() => window.AgentApp.require('state').state.currentId);
}

async function goalSnapshot(page) {
  return page.evaluate(() => {
    const state = window.AgentApp.require('state').state;
    const chat = window.AgentApp.require('state').currentChat();
    const goals = window.AgentApp.require('goalCore').listGoals();
    return {
      currentId: state.currentId,
      chatCount: (state.chats || []).length,
      chatGoalIds: chat && Array.isArray(chat.goalIds) ? [...chat.goalIds] : [],
      goals: goals.map(goal => ({
        id: goal.id,
        objective: goal.objective,
        status: goal.status,
        chatId: goal.chatId,
        turnCount: goal.turnCount
      })),
      messages: chat && Array.isArray(chat.messages)
        ? chat.messages.map(msg => ({
            role: msg.role,
            content: msg.content || '',
            goalId: msg.goalId || '',
            goalFinal: !!msg._goalFinal,
            goalGuidance: !!msg._goalGuidance
          }))
        : []
    };
  });
}

test.describe('goal mode workflows', () => {
  test('runs multiple goals in the current chat without creating goal-only conversations', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, { goalScenario: true });
    await configureMockProvider(page);
    await ensureCurrentChat(page);

    const before = await goalSnapshot(page);
    expect(before.currentId).toBeTruthy();

    await openGoalPanel(page);
    await createGoalFromPanel(page, 'E2E first reusable goal');
    await waitForGoalStatus(page, 'E2E first reusable goal', 'complete');

    const afterFirst = await goalSnapshot(page);
    expect(afterFirst.currentId).toBe(before.currentId);
    expect(afterFirst.chatCount).toBe(before.chatCount);
    expect(afterFirst.goals.find(goal => goal.objective === 'E2E first reusable goal').chatId).toBe(before.currentId);
    expect(afterFirst.chatGoalIds).toContain(afterFirst.goals.find(goal => goal.objective === 'E2E first reusable goal').id);
    expect(afterFirst.messages.some(msg => msg.role === 'assistant' && String(msg.content).includes('Goal complete: E2E first reusable goal'))).toBe(true);
    expect(afterFirst.messages.filter(msg => msg.goalFinal).length).toBe(1);

    await createGoalFromPanel(page, 'E2E second reusable goal');
    await waitForGoalStatus(page, 'E2E second reusable goal', 'complete');

    const afterSecond = await goalSnapshot(page);
    expect(afterSecond.currentId).toBe(before.currentId);
    expect(afterSecond.chatCount).toBe(before.chatCount);
    expect(afterSecond.goals.filter(goal => goal.chatId === before.currentId)).toHaveLength(2);
    expect(afterSecond.chatGoalIds).toEqual(expect.arrayContaining(afterSecond.goals.map(goal => goal.id)));
    expect(afterSecond.messages.filter(msg => msg.goalFinal)).toHaveLength(2);
    expect(JSON.stringify(afterSecond)).not.toContain('"goal_"');
    expect(backend.llmCalls.length).toBeGreaterThanOrEqual(4);

    clientErrors.expectNoErrors();
  });

  test('creates a scheduled goal and only runs it after the selected time arrives', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, { goalScenario: true });
    await configureMockProvider(page);
    await ensureCurrentChat(page);

    await page.locator('#scheduleBtn').click();
    await expect(page.locator('#schedulePicker')).not.toHaveAttribute('hidden', '');
    await page.fill('#scheduleTimeInput', datetimeLocalFromNow(1500));

    await openGoalPanel(page);
    await createGoalFromPanel(page, 'E2E scheduled goal');
    await expect(page.locator('#schedulePicker')).toHaveAttribute('hidden', '');

    await expect.poll(() => page.evaluate(() => {
      const goal = window.AgentApp.require('goalCore').listGoals().find(item => item.objective === 'E2E scheduled goal');
      return goal ? { status: goal.status, scheduledStatus: goal.scheduled && goal.scheduled.status } : null;
    })).toEqual({ status: 'paused', scheduledStatus: 'waiting' });
    expect(backend.llmCalls).toHaveLength(0);

    await waitForGoalStatus(page, 'E2E scheduled goal', 'complete');
    expect(backend.llmCalls.length).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#messagesInner')).toContainText('Goal complete: E2E scheduled goal');

    clientErrors.expectNoErrors();
  });

  test('accepts normal mid-run guidance while a goal is running and continues in the same chat', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, {
      goalScenario: true,
      delayForLlm(body, callNumber) {
        return callNumber === 1 ? 1200 : 20;
      }
    });
    await configureMockProvider(page);
    await ensureCurrentChat(page);

    const before = await goalSnapshot(page);
    await openGoalPanel(page);
    await createGoalFromPanel(page, 'E2E guided goal');
    await page.locator('#goalModal [data-action="closeGoalPanel"]').click();
    await expect(page.locator('#goalModal')).not.toHaveClass(/show/);
    await waitForGenerating(page);

    await page.fill('#input', 'E2E midrun guidance: use the revised approach');
    await page.locator('#sendBtn').click();

    await waitForGoalStatus(page, 'E2E guided goal', 'complete');
    await expect(page.locator('#messagesInner')).toContainText('E2E midrun guidance: use the revised approach');

    const after = await goalSnapshot(page);
    expect(after.currentId).toBe(before.currentId);
    expect(after.chatCount).toBe(before.chatCount);
    expect(after.messages.some(msg => msg.goalGuidance && String(msg.content).includes('revised approach'))).toBe(true);
    expect(after.messages.filter(msg => msg.goalFinal)).toHaveLength(1);
    expect(backend.llmCalls.some(call => JSON.stringify(call.body).includes('用户中途引导'))).toBe(true);
    expect(backend.llmCalls.some(call => JSON.stringify(call.body).includes('E2E midrun guidance: use the revised approach'))).toBe(true);

    clientErrors.expectNoErrors();
  });
});
